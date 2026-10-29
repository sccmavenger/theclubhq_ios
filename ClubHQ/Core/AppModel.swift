import Foundation
import Observation

/// App-wide state: which backend, who is signed in, their teams, and the selected team.
/// Injected into the environment from `MyApp` (DECISIONS D-018).
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case signedOut
        case onboarding
        case ready
    }

    private(set) var backend: any ClubHQBackend
    private(set) var phase: Phase = .launching
    private(set) var context: UserContext?
    var selectedTeamID: UUID? {
        didSet { UserDefaults.standard.set(selectedTeamID?.uuidString, forKey: Self.selectedTeamKey) }
    }
    /// A deep link waiting for the main UI to consume (push tap, inbox row, URL).
    var pendingDeepLink: DeepLink?
    /// Set after starting a club so the tab bar jumps to the new Club tab (D-044).
    var showClubTab = false
    /// An invite token captured before sign-in, consumed by onboarding. Saved on the device so it
    /// survives the app being closed while a new parent confirms their email.
    var pendingInviteToken: String? {
        didSet { UserDefaults.standard.set(pendingInviteToken, forKey: Self.pendingInviteKey) }
    }
    /// One-shot global error banner.
    var errorMessage: String?
    /// The first-run welcome tour to present over the main tabs, if any.
    var welcomeTour: Persona?
    /// Bumped whenever data changes elsewhere so open screens reload.
    private(set) var refreshToken = 0

    let store = SubscriptionStore()
    @ObservationIgnored let usage = UsageTracker()
    let hasLiveBackend: Bool
    private static let selectedTeamKey = "selectedTeamID"
    private static let pendingInviteKey = "pendingInviteToken"

    init(backend: (any ClubHQBackend)? = nil) {
        let live = SupabaseBackend.fromAppConfig()
        hasLiveBackend = live != nil
        self.backend = backend ?? live ?? DemoBackend()
        selectedTeamID = UserDefaults.standard.string(forKey: Self.selectedTeamKey).flatMap(UUID.init(uuidString:))
        pendingInviteToken = UserDefaults.standard.string(forKey: Self.pendingInviteKey)
        store.onVerifiedTransaction = { [weak self] jws in await self?.syncSubscription(jws: jws) }
        PushManager.shared.onToken = { [weak self] token in self?.registerDevice(token: token) }
        PushManager.shared.onOpen = { [weak self] link in self?.pendingDeepLink = link }
        usage.send = { [weak self] events in try await self?.backend.track(events) }
        usage.isEnabled = { [weak self] in
            guard let backend = self?.backend else { return false }
            return backend.hasSession && !backend.isDemo
        }
    }

    /// Records a UI-only usage moment (D-041). Names are `area.action`, e.g. "paywall.viewed".
    func track(_ name: String, teamID: UUID? = nil, props: [String: String] = [:]) {
        usage.track(name, teamID: teamID, props: props)
    }

    /// People this user blocked, as the server knows it (follows them across devices).
    var blockedUserIDs: Set<UUID> { Set(context?.blockedUserIds ?? []) }

    func updateBlockedUsers(_ ids: [UUID]) {
        context?.blockedUserIds = ids
    }

    /// Clubs this person directs (D-044). Non-empty shows the Club tab.
    var clubs: [ClubSummary] { context?.clubs ?? [] }

    /// Reminder switches as last loaded or saved (D-045).
    var notificationPrefs: NotificationPrefs { context?.notificationPrefs ?? NotificationPrefs() }

    func updateNotificationPrefs(_ prefs: NotificationPrefs) {
        context?.notificationPrefs = prefs
    }

    // MARK: - Derived state

    var teams: [TeamMembership] { context?.teams ?? [] }

    var selectedTeam: TeamMembership? {
        teams.first { $0.id == selectedTeamID } ?? teams.first
    }

    var isDemo: Bool { backend.isDemo }

    /// Which demo account is signed in (independent of which team is selected).
    var demoPersona: Persona? { (backend as? DemoBackend)?.persona }

    /// Device entitlement OR server entitlement (either is enough to *show* Pro).
    var isCoachPro: Bool { (context?.isCoachPro ?? false) || store.hasActiveSubscription }

    /// Upgrade prompts and the paywall show only when Coach Pro can actually be bought, and never
    /// in demo mode (a demo has no account to attach a real subscription to). DECISIONS D-034.
    var canSellPro: Bool { store.canPurchase && !isDemo }

    /// Free plan: 1 team as head coach; Pro: 3 (DECISIONS D-011).
    var canCreateAnotherTeam: Bool {
        let owned = context?.headCoachTeamCount ?? 0
        return owned == 0 || (isCoachPro && owned < 3)
    }

    // MARK: - Lifecycle

    func start() async {
        store.start()
        if backend.hasSession {
            await reloadContext()
            await store.syncCurrentEntitlements()
        } else {
            phase = .signedOut
        }
    }

    func reloadContext() async {
        do {
            let context = try await backend.loadContext()
            self.context = context
            if selectedTeamID == nil || !context.teams.contains(where: { $0.id == selectedTeamID }) {
                selectedTeamID = context.teams.first?.id
            }
            // A director with a club but no team of their own goes straight in (D-044).
            phase = context.teams.isEmpty && (context.clubs ?? []).isEmpty ? .onboarding : .ready
            refreshToken += 1
            // Someone already on a team who opened an invite before signing in: open it now.
            if phase == .ready, !backend.isDemo, let token = pendingInviteToken {
                pendingInviteToken = nil
                pendingDeepLink = .invite(token: token)
            }
            // The permission prompt itself comes from the welcome tour, with its reason on screen;
            // here we only re-register a device that's already allowed. Never in a demo walkthrough.
            if phase == .ready && !backend.isDemo { await PushManager.shared.registerIfAuthorized() }
        } catch BackendError.unauthorized {
            await signOut()
        } catch let error as BackendError where error.isSuspended {
            // An admin suspended the account (D-041): say why, then return to sign-in.
            await signOut()
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
            if context == nil { phase = .signedOut }
        }
    }

    /// Call after any sign-in path succeeds.
    func didAuthenticate() async {
        await reloadContext()
        await store.syncCurrentEntitlements()
        if let token = PushManager.shared.latestToken { registerDevice(token: token) }
    }

    func signOut() async {
        await usage.flush()
        usage.reset()
        await backend.signOut()
        context = nil
        selectedTeamID = nil
        welcomeTour = nil
        phase = .signedOut
    }

    // MARK: - Demo Mode (DECISIONS D-006)

    func startDemo(as persona: Persona) async {
        let demo = DemoBackend(persona: persona)
        backend = demo
        selectedTeamID = nil
        await reloadContext()
    }

    func switchDemoPersona(_ persona: Persona) async {
        guard let demo = backend as? DemoBackend else { return }
        demo.signIn(as: persona)
        selectedTeamID = nil
        await reloadContext()
    }

    func exitDemo() async {
        await backend.signOut()
        if let live = SupabaseBackend.fromAppConfig() { backend = live }
        context = nil
        phase = .signedOut
    }

    // MARK: - Deep links

    /// Set after a password-reset link signs the user in; the root view asks for a new password.
    var needsNewPassword = false

    func handle(url: URL) {
        guard let link = DeepLink(url: url) else { return }
        if case .authCallback(let fragment) = link {
            Task { await completeAuthRedirect(fragment: fragment) }
            return
        }
        if case .invite(let token) = link, phase != .ready {
            pendingInviteToken = token
            return
        }
        pendingDeepLink = link
    }

    func noteDataChanged() { refreshToken += 1 }

    /// The signed-in context for App Intents. Siri or Shortcuts can launch the app without any
    /// screen appearing, so load the context here if `start()` hasn't finished yet.
    func contextForIntents() async -> UserContext? {
        if context == nil, backend.hasSession { await reloadContext() }
        return context
    }

    // MARK: - Welcome tour

    /// Queues the tour for the selected team's persona the first time this user sees it.
    /// Demo mode skips it — the demo is already a guided look around.
    func showWelcomeTourIfNeeded() {
        guard phase == .ready, !isDemo, welcomeTour == nil,
              let userId = context?.userId, let persona = selectedTeam?.primaryPersona,
              !WelcomeTour.hasSeen(user: userId, persona: persona) else { return }
        welcomeTour = persona
    }

    /// Replays the tour from More. Works in demo mode too.
    func replayWelcomeTour() {
        welcomeTour = selectedTeam?.primaryPersona
    }

    func finishWelcomeTour(_ persona: Persona) {
        if let userId = context?.userId, !isDemo { WelcomeTour.markSeen(user: userId, persona: persona) }
        track("tour.finished", teamID: selectedTeamID, props: ["persona": "\(persona)"])
        welcomeTour = nil
    }

    private func completeAuthRedirect(fragment: String) async {
        // Email links always target the real backend, even if a demo is open.
        if backend.isDemo, let live = SupabaseBackend.fromAppConfig() { backend = live }
        do {
            let isRecovery = try await backend.completeAuthRedirect(fragment: fragment)
            await didAuthenticate()
            needsNewPassword = isRecovery
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Money & push plumbing

    func grantDemoPro() async {
        (backend as? DemoBackend)?.grantDemoPro()
        await reloadContext()
    }

    private func syncSubscription(jws: String) async {
        guard backend.hasSession else { return }
        do {
            _ = try await backend.syncSubscription(signedTransaction: jws)
            await reloadContext()
        } catch {
            // The device entitlement still unlocks UI; the server retries via App Store notifications.
        }
    }

    private func registerDevice(token: String) {
        guard backend.hasSession, !backend.isDemo else { return }
        Task {
            #if DEBUG
            let sandbox = true
            #else
            let sandbox = false
            #endif
            try? await backend.registerDevice(token: token, sandbox: sandbox)
        }
    }
}

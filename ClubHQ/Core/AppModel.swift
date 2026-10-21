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
    /// An invite token captured before sign-in, consumed by onboarding.
    var pendingInviteToken: String?
    /// One-shot global error banner.
    var errorMessage: String?
    /// Bumped whenever data changes elsewhere so open screens reload.
    private(set) var refreshToken = 0

    let store = SubscriptionStore()
    let hasLiveBackend: Bool
    private static let selectedTeamKey = "selectedTeamID"

    init(backend: (any ClubHQBackend)? = nil) {
        let live = SupabaseBackend.fromAppConfig()
        hasLiveBackend = live != nil
        self.backend = backend ?? live ?? DemoBackend()
        selectedTeamID = UserDefaults.standard.string(forKey: Self.selectedTeamKey).flatMap(UUID.init(uuidString:))
        store.onVerifiedTransaction = { [weak self] jws in await self?.syncSubscription(jws: jws) }
        PushManager.shared.onToken = { [weak self] token in self?.registerDevice(token: token) }
        PushManager.shared.onOpen = { [weak self] link in self?.pendingDeepLink = link }
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
            phase = context.teams.isEmpty ? .onboarding : .ready
            refreshToken += 1
            // Ask for push only for real accounts — never interrupt a demo walkthrough.
            if phase == .ready && !backend.isDemo { await PushManager.shared.requestAuthorizationIfNeeded() }
        } catch BackendError.unauthorized {
            await signOut()
        } catch {
            errorMessage = error.localizedDescription
            if context == nil { phase = .signedOut }
        }
    }

    /// Call after any sign-in path succeeds.
    func didAuthenticate() async {
        await reloadContext()
        if let token = PushManager.shared.latestToken { registerDevice(token: token) }
    }

    func signOut() async {
        await backend.signOut()
        context = nil
        selectedTeamID = nil
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

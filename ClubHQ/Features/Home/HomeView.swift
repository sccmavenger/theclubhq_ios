import SwiftUI

/// Persona-aware dashboard.
/// - Coach: next event with RSVP counts, what needs attention, quick actions.
/// - Parent: the *family view* — every child's upcoming events across all teams with
///   one-tap RSVP (the "too many apps" differentiator, PRODUCT_STRATEGY §1).
/// - Player: next event with self-RSVP and a jump into team chat.
struct HomeView: View {
    @Environment(AppModel.self) private var model

    @State private var events: [TeamEvent] = []
    @State private var rsvps: [RSVP] = []
    @State private var roster: [Player] = []
    @State private var unreadCount = 0
    @State private var amountDueCents = 0
    /// nil until dues load, so the dashboard never claims "all caught up" prematurely.
    @State private var unpaidCount: Int?
    @State private var latestAnnouncement: Announcement?
    @State private var sponsor: TeamSponsor?
    @State private var isLoading = true
    @State private var errorText: String?
    @State private var sheet: HomeSheet?
    /// Setup checklist inputs (head coach only); nil until loaded so steps never flash unchecked.
    @State private var hasAnyEvent: Bool?
    @State private var paymentsConnected = false
    @State private var checklistHidden = true

    private enum HomeSheet: String, Identifiable {
        case inbox, newEvent, announcement, invite, dues, paymentMethods
        var id: String { rawValue }
    }

    private var team: TeamMembership? { model.selectedTeam }
    private var persona: Persona { team?.primaryPersona ?? .parent }

    /// Parents see all their teams; staff and players focus on the selected team.
    private var focusTeams: [TeamMembership] {
        guard let team else { return [] }
        return persona == .parent ? model.teams.filter(\.isGuardian) : [team]
    }

    var body: some View {
        NavigationStack {
            List {
                if let errorText {
                    Section { Label(errorText, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) }
                }
                switch persona {
                case .coach: coachSections
                case .parent: familySections
                case .player: playerSections
                }
                if let sponsor { sponsorSection(sponsor) }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(greeting)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TeamSwitcher() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { sheet = .inbox } label: {
                        Image(systemName: unreadCount > 0 ? "bell.badge.fill" : "bell")
                            .symbolRenderingMode(.multicolor)
                    }
                    .accessibilityLabel(unreadCount > 0 ? "Notifications, \(unreadCount) unread" : "Notifications")
                }
            }
            .refreshable { await load() }
            .task(id: "\(model.refreshToken)-\(team?.id.uuidString ?? "")") { await load() }
            .navigationDestination(for: TeamEvent.self) { EventDetailView(eventID: $0.id) }
            .sheet(item: $sheet, onDismiss: { Task { await load() } }) { sheet in
                switch sheet {
                case .inbox: InboxView()
                case .newEvent: if let team { EventEditorView(draft: EventDraft(teamId: team.id)) }
                case .announcement: if let team { AnnouncementComposer(teamID: team.id) }
                case .invite: if let team { InviteFamiliesView(team: team) }
                case .dues: if let team { NavigationStack { DuesView(team: team) } }
                case .paymentMethods:
                    if let team {
                        NavigationStack {
                            PaymentMethodsView(team: team)
                                .toolbar {
                                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { self.sheet = nil } }
                                }
                        }
                    }
                }
            }
            .overlay {
                if isLoading && events.isEmpty { ProgressView() }
            }
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        let part = hour < 12 ? "Good morning" : (hour < 17 ? "Good afternoon" : "Good evening")
        let first = model.context?.displayName.components(separatedBy: " ").first ?? ""
        return first.isEmpty ? part : "\(part), \(first)"
    }

    // MARK: - Coach

    @ViewBuilder private var coachSections: some View {
        if let team, team.canManageRoster, !checklistHidden, let hasAnyEvent {
            SetupChecklistSection(steps: setupSteps(team: team, hasAnyEvent: hasAnyEvent), tint: team.tint) {
                WelcomeTour.hideChecklist(team: team.id)
                withAnimation { checklistHidden = true }
            }
        }
        if let team, let next = events.first(where: { $0.teamId == team.id && !$0.isCancelled }) {
            Section("Up next") {
                NavigationLink(value: next) {
                    EventSummaryRow(event: next, team: team)
                }
                RSVPSummaryBar(counts: counts(for: next))
            }
        } else if !isLoading {
            Section("Up next") {
                ContentUnavailableView {
                    Label("Nothing scheduled", systemImage: "calendar.badge.plus")
                } description: {
                    Text("Add your first practice or game — families get notified automatically.")
                } actions: {
                    Button("Add Event") { sheet = .newEvent }.buttonStyle(.borderedProminent)
                }
            }
        }

        Section("Needs attention") {
            if let next = events.first(where: { $0.teamId == team?.id && !$0.isCancelled }) {
                let missing = counts(for: next).noResponse
                AttentionRow(symbol: "hand.raised.fill", tint: missing > 0 ? .orange : .green,
                             title: missing > 0 ? "\(missing) haven't RSVP'd" : "Everyone has responded",
                             detail: next.displayTitle)
            }
            if let unpaidCount {
                Button { sheet = .dues } label: {
                    AttentionRow(symbol: "dollarsign.circle.fill", tint: unpaidCount > 0 ? .orange : .green,
                                 title: unpaidCount > 0 ? "\(unpaidCount) unpaid payments" : "Dues are all caught up",
                                 detail: AppConfig.cardPaymentsEnabled ? "Collect dues with \(DuesFee.disclosure), paid by families" : "Track dues and mark payments as paid")
                }
                .buttonStyle(.plain)
            }
            if roster.isEmpty && !isLoading {
                Button { sheet = .invite } label: {
                    AttentionRow(symbol: "person.badge.plus", tint: .accentColor, title: "Invite your families",
                                 detail: "Share one link — parents add their own kids")
                }
                .buttonStyle(.plain)
            }
        }

        Section("Quick actions") {
            QuickActionGrid(actions: [
                .init(title: "Event", symbol: "calendar.badge.plus") { sheet = .newEvent },
                .init(title: "Post", symbol: "megaphone.fill") { sheet = .announcement },
                .init(title: "Invite", symbol: "person.crop.circle.badge.plus") { sheet = .invite },
                .init(title: "Dues", symbol: "dollarsign.circle.fill") { sheet = .dues },
            ])
            .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        }
    }

    private func setupSteps(team: TeamMembership, hasAnyEvent: Bool) -> [SetupChecklistSection.Step] {
        [
            .init(id: "invite", title: "Invite your families", symbol: "person.crop.circle.badge.plus",
                  isDone: !roster.isEmpty) { sheet = .invite },
            .init(id: "event", title: "Add your first event", symbol: "calendar.badge.plus",
                  isDone: hasAnyEvent) { sheet = .newEvent },
            .init(id: "announce", title: "Post a welcome announcement", symbol: "megaphone.fill",
                  isDone: latestAnnouncement != nil) { sheet = .announcement },
            .init(id: "pay", title: "Set up how families pay you", symbol: "dollarsign.circle.fill",
                  isDone: team.hasPaymentHandles || paymentsConnected) { sheet = .paymentMethods },
        ]
    }

    // MARK: - Family (parent)

    @ViewBuilder private var familySections: some View {
        if amountDueCents > 0 {
            Section {
                Button { sheet = .dues } label: {
                    AttentionRow(symbol: "dollarsign.circle.fill", tint: .orange,
                                 title: "\(Money.format(cents: amountDueCents)) due",
                                 detail: AppConfig.cardPaymentsEnabled ? "Pay securely in ClubHQ — fees shown before you pay" : "See what's due and who it's for")
                }
                .buttonStyle(.plain)
            }
        }

        let upcoming = Array(events.filter { !$0.isPast }.prefix(8))
        if upcoming.isEmpty && !isLoading {
            Section("Coming up") {
                Text("No upcoming events in the next two weeks.").foregroundStyle(.secondary)
            }
        }
        // One section per event: the navigation row and each child's RSVP control are
        // separate list rows, so taps never collide.
        ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, event in
            if let eventTeam = model.teams.first(where: { $0.id == event.teamId }) {
                Section {
                    NavigationLink(value: event) {
                        EventSummaryRow(event: event, team: eventTeam, showTeam: focusTeams.count > 1)
                    }
                    ForEach(eventTeam.rsvpPlayers) { player in
                        ChildRSVPRow(player: player, event: event, rsvp: rsvp(event: event.id, player: player.id)) { status in
                            await setRSVP(event: event, player: player, status: status)
                        }
                    }
                } header: {
                    if index == 0 {
                        Text(focusTeams.count > 1 ? "Coming up · all your kids' teams" : "Coming up")
                    }
                }
            }
        }

        if let latestAnnouncement { announcementSection(latestAnnouncement) }
    }

    // MARK: - Player

    @ViewBuilder private var playerSections: some View {
        if let team, let me = team.playerSelf ?? team.rsvpPlayers.first,
           let next = events.first(where: { $0.teamId == team.id && !$0.isPast && !$0.isCancelled }) {
            Section("Up next") {
                NavigationLink(value: next) { EventSummaryRow(event: next, team: team) }
                ChildRSVPRow(player: me, event: next, rsvp: rsvp(event: next.id, player: me.id), label: "Are you in?") { status in
                    await setRSVP(event: next, player: me, status: status)
                }
            }
        }
        if let team {
            Section {
                TeamChatLink(team: team)
            }
        }
        if let latestAnnouncement { announcementSection(latestAnnouncement) }
    }

    // MARK: - Shared sections

    private func announcementSection(_ announcement: Announcement) -> some View {
        Section("Latest announcement") {
            VStack(alignment: .leading, spacing: 6) {
                Text(announcement.title).font(.headline)
                Text(announcement.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(4)
                Text(announcement.createdAt, format: .relative(presentation: .named))
                    .font(.caption).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 4)
        }
    }

    private func sponsorSection(_ sponsor: TeamSponsor) -> some View {
        Section {
            SponsorCard(sponsor: sponsor)
        } footer: {
            Text("Team sponsors support your team directly. ClubHQ never shows ads or tracks you.")
        }
    }

    // MARK: - Data

    private func counts(for event: TeamEvent) -> (yes: Int, maybe: Int, no: Int, noResponse: Int) {
        let detail = EventDetail(event: event, rsvps: rsvps.filter { $0.eventId == event.id }, attendance: [], roster: roster)
        return detail.counts
    }

    private func rsvp(event: UUID, player: UUID) -> RSVP? {
        rsvps.first { $0.eventId == event && $0.playerId == player }
    }

    private func setRSVP(event: TeamEvent, player: PlayerSummary, status: RSVPStatus) async {
        do {
            try await model.backend.setRSVP(eventID: event.id, playerID: player.id, status: status, note: nil)
            rsvps = try await model.backend.myRSVPs(eventIDs: events.map(\.id))
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }

    private func load() async {
        guard let team else { return }
        isLoading = true
        defer { isLoading = false }
        let backend = model.backend
        do {
            let from = Calendar.current.startOfDay(for: .now)
            let to = from.addingTimeInterval(14 * 86_400)
            // Load roster and RSVPs before publishing events so counts never flash as 0/0/0/0.
            if persona == .coach { roster = try await backend.roster(teamID: team.id) }
            let fresh = try await backend.events(teamIDs: focusTeams.map(\.id), from: from, to: to).filter { !$0.isCancelled || persona == .coach }
            rsvps = try await backend.myRSVPs(eventIDs: fresh.map(\.id))
            events = fresh
            errorText = nil
        } catch {
            errorText = "Couldn't refresh. Pull to try again."
        }
        // Secondary data: failures here shouldn't blank the dashboard.
        unreadCount = (try? await backend.inbox().filter(\.isUnread).count) ?? 0
        latestAnnouncement = (try? await backend.announcements(teamID: team.id))?.first
        sponsor = (try? await backend.sponsors(teamID: team.id))?.first
        if persona == .coach {
            let dues = try? await backend.dues(teamID: team.id)
            unpaidCount = dues?.requests.flatMap(\.unpaidItems).count
            checklistHidden = !team.canManageRoster || WelcomeTour.isChecklistHidden(team: team.id)
            if !checklistHidden {
                paymentsConnected = AppConfig.cardPaymentsEnabled && (dues?.paymentsConnected ?? false)
                // Any event counts, not just the next two weeks shown on the dashboard.
                if events.contains(where: { $0.teamId == team.id }) {
                    hasAnyEvent = true
                } else {
                    let now = Date.now
                    let wide = try? await backend.events(teamIDs: [team.id], from: now.addingTimeInterval(-180 * 86_400),
                                                         to: now.addingTimeInterval(365 * 86_400))
                    hasAnyEvent = wide.map { !$0.isEmpty }
                }
                // Decided once per team: an established team (players and events already) never
                // sees the card; a new team keeps it until the coach finishes or hides it.
                // A failed load can't tell new from established, so wait for a good one.
                if !WelcomeTour.isChecklistStarted(team: team.id) {
                    if errorText != nil || hasAnyEvent == nil {
                        checklistHidden = true
                    } else if !roster.isEmpty && hasAnyEvent == true {
                        WelcomeTour.hideChecklist(team: team.id)
                        checklistHidden = true
                    } else {
                        WelcomeTour.startChecklist(team: team.id)
                    }
                }
            }
        } else if persona == .parent {
            var due = 0
            for familyTeam in focusTeams {
                if let dues = try? await backend.dues(teamID: familyTeam.id) {
                    due += dues.requests.flatMap(\.unpaidItems).reduce(0) { $0 + $1.amountCents }
                }
            }
            amountDueCents = due
        }
    }
}

// MARK: - Components

/// Team picker in the navigation bar.
struct TeamSwitcher: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        if model.teams.count > 1 {
            Menu {
                Picker("Team", selection: $model.selectedTeamID) {
                    ForEach(model.teams) { team in
                        Label(team.name, systemImage: team.resolvedSport.symbolName).tag(Optional(team.id))
                    }
                }
            } label: {
                Label(model.selectedTeam?.name ?? "Teams", systemImage: model.selectedTeam?.resolvedSport.symbolName ?? "person.3")
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
                    .fixedSize()
            }
            .accessibilityLabel("Switch team")
        } else if let team = model.selectedTeam {
            Label(team.name, systemImage: team.resolvedSport.symbolName)
                .labelStyle(.titleAndIcon)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .fixedSize()
        }
    }
}

struct EventSummaryRow: View {
    let event: TeamEvent
    let team: TeamMembership
    var showTeam = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 2) {
                Text(event.startsAt.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(team.tint)
                Text(event.startsAt.formatted(.dateTime.day()))
                    .font(.title2.weight(.bold).monospacedDigit())
            }
            .frame(width: 44)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Image(systemName: event.eventType.symbolName).foregroundStyle(team.tint)
                    Text(event.displayTitle).font(.headline).lineLimit(1)
                }
                Text("\(event.startsAt.relativeDayLabel) · \(event.timeRangeLabel)")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let location = event.location {
                    HStack(spacing: 4) {
                        Image(systemName: "mappin.and.ellipse")
                        Text(location).lineLimit(1)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                if showTeam {
                    Text(team.name).font(.caption.weight(.semibold)).foregroundStyle(team.tint)
                }
                if event.isCancelled {
                    TagLabel(text: "Cancelled", tint: .red, systemImage: "xmark.octagon.fill")
                } else if let score = event.scoreLine {
                    TagLabel(text: score, tint: score.hasPrefix("W") ? .green : .secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct ChildRSVPRow: View {
    let player: PlayerSummary
    let event: TeamEvent
    let rsvp: RSVP?
    var label: String?
    let onSelect: (RSVPStatus) async -> Void
    @State private var pending: RSVPStatus?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label ?? player.firstName).font(.subheadline.weight(.semibold))
                Spacer()
                if !event.isRSVPOpen() {
                    Label("RSVP closed", systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
                } else if rsvp == nil {
                    Text("Needs response").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
            }
            RSVPPicker(selection: pending ?? rsvp?.status, isLocked: !event.isRSVPOpen()) { status in
                pending = status
                Task {
                    await onSelect(status)
                    pending = nil
                }
            }
        }
    }
}

struct RSVPSummaryBar: View {
    let counts: (yes: Int, maybe: Int, no: Int, noResponse: Int)

    var body: some View {
        HStack(spacing: 0) {
            stat(counts.yes, "Going", .green)
            stat(counts.maybe, "Maybe", .orange)
            stat(counts.no, "Out", .red)
            stat(counts.noResponse, "No reply", .secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func stat(_ value: Int, _ label: String, _ tint: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(tint)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct AttentionRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)
    }
}

struct QuickActionGrid: View {
    struct Action: Identifiable {
        let title: String
        let symbol: String
        let perform: () -> Void
        var id: String { title }
    }

    let actions: [Action]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 12)], spacing: 12) {
            ForEach(actions) { action in
                Button(action: action.perform) {
                    VStack(spacing: 6) {
                        Image(systemName: action.symbol).font(.title2)
                        Text(action.title)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

struct SponsorCard: View {
    let sponsor: TeamSponsor
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let url = sponsor.linkUrl { openURL(url) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "storefront.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .background(.quaternary, in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Team sponsor").font(.caption).foregroundStyle(.secondary)
                    Text(sponsor.name).font(.subheadline.weight(.semibold))
                    if let tagline = sponsor.tagline {
                        Text(tagline).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .disabled(sponsor.linkUrl == nil)
    }
}

#Preview("Parent") {
    HomeView().environment(AppModel.preview(.parent))
}

#Preview("Coach") {
    HomeView().environment(AppModel.preview(.coach))
}

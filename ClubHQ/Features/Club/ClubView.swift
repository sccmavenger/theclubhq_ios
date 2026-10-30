import SwiftUI

/// The Club tab (D-044): only for directors. Every team at a glance, grouped by grade, with
/// filters; club announcements and events; setup (club code, add teams, assign coaches).
/// Parents never see any of this (owner decision 6).
struct ClubView: View {
    @Environment(AppModel.self) private var model
    let club: ClubSummary
    /// Opens a team in the rest of the app (switches the selected team and the tab).
    var openTeam: (UUID) -> Void = { _ in }
    /// More (account, settings, sign out) opens from here when Club takes its tab.
    var showsAccountButton = false
    @State private var showAccount = false

    @State private var overview: ClubOverview?
    @State private var errorText: String?
    @State private var filter = ClubFilter()
    @State private var search = ""
    @State private var sheet: ClubSheet?
    @State private var eventToCancel: ClubOverview.ClubEvent?
    @State private var message: String?
    /// Reset after "Open Team" so the Club tab comes back to the team list, not a detail page.
    @State private var path: [ClubTeam] = []

    enum ClubSheet: Identifiable, Hashable {
        case addTeams, announcement, event, share
        case editEvent(ClubOverview.ClubEvent)
        var id: Self { self }
    }

    private var visibleTeams: [ClubTeam] {
        let query = search.trimmingCharacters(in: .whitespaces)
        return (overview?.teams ?? []).filter { team in
            filter.matches(team) && (query.isEmpty || [team.name, team.headCoaches.map(\.name).joined(separator: " ")].contains { $0.localizedStandardContains(query) })
        }
    }

    /// Teams grouped by grade ("6th Grade"), each group sorted by name.
    private var groups: [(title: String, teams: [ClubTeam])] {
        let byGrade = Dictionary(grouping: visibleTeams) { ClubGrouping.gradeSection($0.grade) }
        return byGrade.keys
            .sorted { lhs, rhs in
                if lhs == "Other teams" { return false }
                if rhs == "Other teams" { return true }
                return lhs.localizedStandardCompare(rhs) == .orderedAscending
            }
            .map { ($0, byGrade[$0]!.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) }
    }

    var body: some View {
        if club.isPending { pendingBody } else { clubBody }
    }

    /// A new club waits for a ClubHQ admin's approval (D-051); the director's own team works meanwhile.
    private var pendingBody: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Waiting for approval", systemImage: "hourglass")
            } description: {
                Text("We review new clubs before they go live, usually within a day. You'll get a notification when \(club.name) is on. Then you can add teams, invite coaches and message families.")
            } actions: {
                Button("Check Again") { Task { await model.reloadContext() } }.buttonStyle(.bordered)
            }
            .navigationTitle(club.name)
            .toolbar {
                if showsAccountButton {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showAccount = true } label: { Label("More", systemImage: "person.crop.circle") }
                    }
                }
            }
            .sheet(isPresented: $showAccount) { AccountView() }
        }
    }

    private var clubBody: some View {
        NavigationStack(path: $path) {
            List {
                if let overview {
                    header(overview)
                    if !overview.clubEvents.isEmpty { clubEventsSection(overview) }
                    if overview.teams.isEmpty {
                        ContentUnavailableView {
                            Label("No teams yet", systemImage: "person.3")
                        } description: {
                            Text("Add your teams, or send coaches the club code so they can bring their teams in.")
                        } actions: {
                            Button("Add Teams") { sheet = .addTeams }.buttonStyle(.borderedProminent)
                        }
                        .listRowBackground(Color.clear)
                    }
                    ForEach(groups, id: \.title) { group in
                        Section(group.title) {
                            ForEach(group.teams) { team in
                                NavigationLink(value: team) { ClubTeamRow(team: team) }
                            }
                        }
                    }
                    if !overview.teams.isEmpty && visibleTeams.isEmpty {
                        ContentUnavailableView.search(text: search)
                    }
                } else if let errorText {
                    ContentUnavailableView("Couldn't load the club", systemImage: "exclamationmark.triangle", description: Text(errorText))
                }
            }
            .navigationTitle(overview?.club.name ?? club.name)
            .searchable(text: $search, prompt: "Team or coach")
            .navigationDestination(for: ClubTeam.self) { team in
                ClubTeamDetailView(teamID: team.id, overview: $overview, openTeam: { id in
                    path = []
                    openTeam(id)
                }, reload: { await load() })
            }
            .toolbar {
                if showsAccountButton {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showAccount = true } label: { Label("More", systemImage: "person.crop.circle") }
                    }
                }
                ToolbarItem(placement: .topBarLeading) { filterMenu }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { sheet = .announcement } label: { Label("Club Announcement", systemImage: "megaphone") }
                        Button { sheet = .event } label: { Label("Club Event", systemImage: "calendar.badge.plus") }
                        Divider()
                        Button { sheet = .addTeams } label: { Label("Add Teams", systemImage: "person.3.sequence") }
                        Button { sheet = .share } label: { Label("Invite Coaches", systemImage: "qrcode") }
                        Divider()
                        // The director portal (D-053): bulk setup and the club at a glance on a computer.
                        Link(destination: URL(string: "https://teamclubhq.com/club")!) { Label("Club Portal on the Web", systemImage: "laptopcomputer") }
                    } label: {
                        Label("Club Actions", systemImage: "plus")
                    }
                }
            }
            .refreshable { await load() }
            .task(id: model.refreshToken) { await load() }
            .overlay { if overview == nil && errorText == nil { ProgressView() } }
            .sheet(isPresented: $showAccount) { AccountView() }
            .sheet(item: $sheet, onDismiss: { Task { await load() } }) { which in
                if let overview {
                    switch which {
                    case .addTeams: AddClubTeamsView(orgID: overview.club.id)
                    case .announcement: ClubComposerView(mode: .announcement, overview: overview)
                    case .event: ClubComposerView(mode: .event, overview: overview)
                    case .share: ClubCodeView(club: overview.club) { await resetCode() }
                    case .editEvent(let event): ClubEventEditView(event: event)
                    }
                }
            }
            .alert("Cancel \(eventToCancel?.title ?? "this event")?", isPresented: Binding(get: { eventToCancel != nil }, set: { if !$0 { eventToCancel = nil } }),
                   presenting: eventToCancel) { event in
                Button("Cancel on \(event.teamCount) Teams", role: .destructive) { Task { await cancel(event) } }
                Button("Keep Event", role: .cancel) {}
            } message: { event in
                Text("\(event.title) is cancelled on every team and families are told.")
            }
            .alert("Club", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(message ?? "") }
        }
    }

    // MARK: Sections

    private func header(_ overview: ClubOverview) -> some View {
        Section {
            // Equal-width columns across the whole row, and a full-width separator below, so the
            // stats don't bunch up off-center (TestFlight feedback, build 25).
            HStack(spacing: 0) {
                stat("\(overview.teams.count)", "teams")
                Divider().frame(height: 36)
                stat("\(overview.club.familyCount)", "families")
                Divider().frame(height: 36)
                stat("\(overview.teams.filter(\.needsAttention).count)", "need a coach", warn: overview.teams.contains(where: \.needsAttention))
            }
            .padding(.vertical, 8)
            .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
            Button { sheet = .share } label: {
                LabeledContent("Club code") {
                    Text(overview.club.code).font(.body.monospaced().weight(.semibold))
                }
            }
            .tint(.primary)
            if !filter.isEmpty {
                Button("Clear filters", systemImage: "line.3.horizontal.decrease.circle.fill") { filter = ClubFilter() }
            }
        } footer: {
            Text("Coaches enter the club code in More → Join a Club to bring their team in. Parents don't see the club.")
        }
    }

    private func stat(_ value: String, _ label: String, warn: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title2.bold().monospacedDigit()).foregroundStyle(warn ? .orange : .primary)
            Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func clubEventsSection(_ overview: ClubOverview) -> some View {
        Section("Club events") {
            ForEach(overview.clubEvents) { event in
                Button { sheet = .editEvent(event) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title).font(.headline)
                            Text([event.startsAt.formatted(date: .abbreviated, time: .shortened), event.location, ClubText.teams(event.teamCount)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityHint("Edits it on every team")
                // Not `role: .destructive`: that animates the row away before the coach confirms.
                .swipeActions {
                    Button("Cancel Event") { eventToCancel = event }.tint(.red)
                    Button("Edit") { sheet = .editEvent(event) }.tint(.blue)
                }
            }
        }
    }

    private var filterMenu: some View {
        Menu {
            if let overview {
                filterPicker("Season", values: overview.values(\.season), selection: $filter.seasons)
                filterPicker("Grade", values: overview.values(\.grade), selection: $filter.grades, label: { ClubGrouping.gradeLabel($0) ?? $0 })
                filterPicker("Gender", values: overview.values(\.gender), selection: $filter.genders, label: { $0.capitalized })
                filterPicker("Level", values: overview.values(\.level), selection: $filter.levels)
                if !filter.isEmpty { Button("Clear Filters", role: .destructive) { filter = ClubFilter() } }
            }
        } label: {
            Label("Filter", systemImage: filter.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
    }

    @ViewBuilder
    private func filterPicker(_ title: String, values: [String], selection: Binding<[String]>, label: @escaping (String) -> String = { $0 }) -> some View {
        if !values.isEmpty {
            Menu(title) {
                ForEach(values, id: \.self) { value in
                    Toggle(label(value), isOn: Binding(
                        get: { selection.wrappedValue.contains(value) },
                        set: { on in
                            if on { selection.wrappedValue.append(value) } else { selection.wrappedValue.removeAll { $0 == value } }
                        }
                    ))
                }
            }
        }
    }

    // MARK: Actions

    private func load() async {
        do {
            overview = try await model.backend.clubOverview(orgID: club.id)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func resetCode() async {
        do {
            let code = try await model.backend.clubResetCode(orgID: club.id)
            overview?.club.code = code
        } catch {
            message = error.localizedDescription
        }
    }

    private func cancel(_ event: ClubOverview.ClubEvent) async {
        do {
            let n = try await model.backend.clubEventCancel(clubEventID: event.clubEventId)
            message = "\(event.title) was cancelled on \(n) teams."
            await load()
            model.noteDataChanged()
        } catch {
            message = error.localizedDescription
        }
    }
}

/// One team in the Club tab: name, grouping, coach, roster and families, next event and RSVPs.
struct ClubTeamRow: View {
    let team: ClubTeam

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(team.name).font(.headline)
            if !team.groupingLine.isEmpty {
                Text(team.groupingLine).font(.caption).foregroundStyle(.secondary)
            }
            Group {
                if let coach = team.headCoaches.first {
                    Label(coach.name, systemImage: "person.fill")
                } else if let pending = team.pendingCoaches.first {
                    Label("Invited: \(pending.email ?? "coach")", systemImage: "envelope")
                } else {
                    Label("No coach yet", systemImage: "exclamationmark.circle").foregroundStyle(.orange)
                }
            }
            .font(.subheadline)
            HStack(spacing: 10) {
                Label("\(team.rosterCount)", systemImage: "person.3").accessibilityLabel("\(team.rosterCount) players")
                Label("\(team.familyCount)", systemImage: "house").accessibilityLabel("\(team.familyCount) families joined")
                if let next = team.nextEvent {
                    Text("Next: \(next.label) \(next.startsAt.formatted(.relative(presentation: .named)))")
                        .lineLimit(1)
                    if team.rosterCount > 0 {
                        Text("· RSVPs \(next.rsvpCount)/\(team.rosterCount)")
                            .foregroundStyle(Double(next.rsvpCount) / Double(team.rosterCount) < 0.5 ? .orange : .secondary)
                    }
                } else {
                    Text("Nothing scheduled").foregroundStyle(.orange)
                }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// The club code, ready to share with coaches, and a reset.
struct ClubCodeView: View {
    let club: ClubOverview.Club
    let reset: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false

    private var shareText: String {
        "Join \(club.name) on ClubHQ: get the app at teamclubhq.com, then More → Join a Club and enter code \(club.code)."
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Club code").font(.headline).foregroundStyle(.secondary)
                Text(club.code)
                    .font(.system(size: 40, weight: .bold, design: .monospaced))
                    .textSelection(.enabled)
                Text("Coaches enter this in More → Join a Club to bring an existing team in or start a new one. Parents join each team with that team's own code.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                ShareLink(item: shareText) { Label("Share with Coaches", systemImage: "square.and.arrow.up") }
                    .buttonStyle(BrandCTAButtonStyle())
                Button("Reset Code", role: .destructive) { confirmReset = true }
                Spacer()
            }
            .padding(24)
            .navigationTitle("Invite Coaches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Reset the club code?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset Code", role: .destructive) { Task { await reset() } }
            } message: {
                Text("The old code stops working. Coaches already in the club aren't affected.")
            }
        }
    }
}

#Preview("Club") {
    let model = AppModel.preview(.coach)
    ClubView(club: ClubSummary(id: UUID(), name: "3D Basketball Academy", teamCount: 8))
        .environment(model)
}

import SwiftUI

/// Upcoming (and optionally past) events, grouped by day. Families can view all their
/// teams at once; coaches add events here.
struct ScheduleView: View {
    @Environment(AppModel.self) private var model

    private enum Scope: String, CaseIterable, Identifiable {
        case upcoming = "Upcoming", past = "Past"
        var id: String { rawValue }
    }

    @State private var scope: Scope = .upcoming
    @State private var allTeams = true
    @State private var events: [TeamEvent] = []
    @State private var isLoading = true
    @State private var errorText: String?
    @State private var showEditor = false
    @State private var showCalendarSync = false
    @State private var showImport = false
    /// Tournament sheets the selected team imported from (head coach only, D-042).
    @State private var imports: [ScheduleImportInfo] = []
    @State private var importToRemove: ScheduleImportInfo?
    @State private var importMessage: String?

    private var team: TeamMembership? { model.selectedTeam }
    private var showsTeamFilter: Bool { model.teams.count > 1 }

    private var visibleTeams: [TeamMembership] {
        guard let team else { return [] }
        return showsTeamFilter && allTeams ? model.teams : [team]
    }

    private var grouped: [(day: Date, events: [TeamEvent])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: events) { calendar.startOfDay(for: $0.startsAt) }
        let days = groups.keys.sorted(by: scope == .upcoming ? (<) : (>))
        return days.map { ($0, groups[$0]!.sorted { $0.startsAt < $1.startsAt }) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Scope", selection: $scope) {
                        ForEach(Scope.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if showsTeamFilter {
                        Toggle("Show all my teams", isOn: $allTeams)
                    }
                }
                if let errorText {
                    Section { Text(errorText).foregroundStyle(.secondary) }
                }
                if !imports.isEmpty {
                    importsSection
                }
                if events.isEmpty && !isLoading {
                    ContentUnavailableView {
                        Label(scope == .upcoming ? "No upcoming events" : "No past events", systemImage: "calendar")
                    } description: {
                        Text(team?.canManageSchedule == true ? "Tap + to schedule a practice or game." : "Your coach hasn't scheduled anything yet.")
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(grouped, id: \.day) { group in
                    Section(group.day.relativeDayLabel) {
                        ForEach(group.events) { event in
                            if let eventTeam = model.teams.first(where: { $0.id == event.teamId }) {
                                NavigationLink(value: event) {
                                    EventSummaryRow(event: event, team: eventTeam, showTeam: visibleTeams.count > 1)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Schedule")
            .navigationDestination(for: TeamEvent.self) { EventDetailView(eventID: $0.id) }
            .toolbar {
                if team != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showCalendarSync = true } label: { Label("Calendar Sync", systemImage: "calendar.badge.checkmark") }
                    }
                }
                if team?.canManageSchedule == true {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button { showEditor = true } label: { Label("New Event", systemImage: "calendar.badge.plus") }
                            Button { showImport = true } label: { Label("Import Tournament Schedule", systemImage: "tablecells") }
                        } label: {
                            Label("Add", systemImage: "plus")
                        }
                    }
                }
            }
            .refreshable { await load() }
            .task(id: "\(model.refreshToken)-\(scope.rawValue)-\(allTeams)-\(team?.id.uuidString ?? "")") { await load() }
            .sheet(isPresented: $showEditor, onDismiss: { Task { await load() } }) {
                if let team { EventEditorView(draft: EventDraft(teamId: team.id)) }
            }
            .sheet(isPresented: $showCalendarSync) { CalendarSyncView() }
            .sheet(isPresented: $showImport, onDismiss: { Task { await load() } }) {
                if let team {
                    ScheduleImportView(team: team, backend: model.backend) { model.noteDataChanged() }
                }
            }
            .confirmationDialog(
                "Remove imported games?",
                isPresented: Binding(get: { importToRemove != nil }, set: { if !$0 { importToRemove = nil } }),
                titleVisibility: .visible,
                presenting: importToRemove
            ) { info in
                Button("Remove Games", role: .destructive) { Task { await remove(info) } }
            } message: { info in
                Text("Every game imported from \(info.title) is removed, with its RSVPs and attendance.")
            }
            .alert("Imported schedule", isPresented: Binding(get: { importMessage != nil }, set: { if !$0 { importMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(importMessage ?? "")
            }
            .overlay { if isLoading && events.isEmpty { ProgressView() } }
        }
    }

    /// Each imported tournament, with "Update from Sheet" and "Remove Games".
    private var importsSection: some View {
        Section {
            ForEach(imports) { info in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(info.title).font(.subheadline.weight(.semibold))
                        Text("As \(info.sheetTeamName) · updated \(info.lastImportedAt.formatted(.relative(presentation: .named)))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Menu {
                        Button { Task { await refresh(info) } } label: { Label("Update from Sheet", systemImage: "arrow.triangle.2.circlepath") }
                        if let url = URL(string: info.sourceUrl) {
                            Link(destination: url) { Label("Open Sheet", systemImage: "safari") }
                        }
                        Button(role: .destructive) { importToRemove = info } label: { Label("Remove Games", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.title3)
                    }
                    .accessibilityLabel("Options for \(info.title)")
                }
            }
        } header: {
            Text("Imported schedules")
        }
    }

    /// Re-reads the sheet and applies any changes the organizer made.
    private func refresh(_ info: ScheduleImportInfo) async {
        do {
            let result = try await model.backend.importCommit(
                teamID: info.teamId, url: info.sourceUrl, teamKey: info.sheetTeamKey, alias: info.sheetAlias, gameKeys: nil, firstDay: nil
            )
            var parts = ["\(result.updated) games checked"]
            if result.added > 0 { parts.append("\(result.added) new") }
            if result.cancelled > 0 { parts.append("\(result.cancelled) no longer in the sheet (marked cancelled)") }
            importMessage = parts.joined(separator: ", ") + "."
            model.noteDataChanged()
        } catch {
            importMessage = error.localizedDescription
        }
    }

    private func remove(_ info: ScheduleImportInfo) async {
        do {
            let removed = try await model.backend.importUndo(importID: info.id)
            importMessage = removed == 1 ? "1 game removed." : "\(removed) games removed."
            model.noteDataChanged()
        } catch {
            importMessage = error.localizedDescription
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let startOfToday = Calendar.current.startOfDay(for: .now)
            let ids = visibleTeams.map(\.id)
            switch scope {
            case .upcoming:
                events = try await model.backend.events(teamIDs: ids, from: startOfToday, to: nil)
            case .past:
                let from = startOfToday.addingTimeInterval(-180 * 86_400)
                events = try await model.backend.events(teamIDs: ids, from: from, to: .now).filter(\.isPast)
            }
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        if let team, team.canManageSchedule {
            imports = (try? await model.backend.scheduleImports(teamID: team.id)) ?? []
        } else {
            imports = []
        }
    }
}

#Preview {
    ScheduleView().environment(AppModel.preview(.parent))
}

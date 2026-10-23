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
                        Button { showEditor = true } label: { Label("New Event", systemImage: "plus") }
                    }
                }
            }
            .refreshable { await load() }
            .task(id: "\(model.refreshToken)-\(scope.rawValue)-\(allTeams)-\(team?.id.uuidString ?? "")") { await load() }
            .sheet(isPresented: $showEditor, onDismiss: { Task { await load() } }) {
                if let team { EventEditorView(draft: EventDraft(teamId: team.id)) }
            }
            .sheet(isPresented: $showCalendarSync) { CalendarSyncView() }
            .overlay { if isLoading && events.isEmpty { ProgressView() } }
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
    }
}

#Preview {
    ScheduleView().environment(AppModel.preview(.parent))
}

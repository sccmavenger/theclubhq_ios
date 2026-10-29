import SwiftUI

/// Event detail: logistics, my RSVP(s), and for coaches the full availability list,
/// attendance taking, and score entry.
struct EventDetailView: View {
    let eventID: UUID
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var detail: EventDetail?
    @State private var errorText: String?
    @State private var isTakingAttendance = false
    @State private var attendanceDraft: [UUID: AttendanceStatus] = [:]
    @State private var showEditor = false
    @State private var showScore = false
    @State private var confirmCancel = false

    private var team: TeamMembership? {
        guard let detail else { return nil }
        return model.teams.first { $0.id == detail.event.teamId }
    }

    var body: some View {
        Group {
            if let detail, let team {
                content(detail: detail, team: team)
            } else if let errorText {
                ContentUnavailableView("Couldn't load event", systemImage: "exclamationmark.triangle", description: Text(errorText))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(detail?.event.eventType.displayName ?? "Event")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.refreshToken) { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func content(detail: EventDetail, team: TeamMembership) -> some View {
        let event = detail.event
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        TagLabel(text: event.eventType.displayName, tint: team.tint, systemImage: event.eventType.symbolName)
                        if event.isCancelled { TagLabel(text: "Cancelled", tint: .red) }
                        if let score = event.scoreLine { TagLabel(text: score, tint: score.hasPrefix("W") ? .green : .secondary) }
                        if event.isImported { TagLabel(text: "Imported", tint: .secondary, systemImage: "tablecells") }
                    }
                    Text(event.displayTitle).font(.title2.bold())
                    Text(team.name).font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                LabeledContent {
                    Text(event.timeRangeLabel)
                } label: {
                    Label(event.startsAt.formatted(date: .complete, time: .omitted), systemImage: "clock")
                }
                if let location = event.location {
                    if let url = event.mapsURL {
                        Link(destination: url) {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(location).foregroundStyle(.primary)
                                    if let address = event.locationAddress {
                                        Text(address).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: "map.fill")
                            }
                        }
                    } else {
                        Label(location, systemImage: "mappin.and.ellipse")
                    }
                }
                if let notes = event.notes, !notes.isEmpty {
                    Label(notes, systemImage: "note.text")
                }
            }

            if !team.rsvpPlayers.isEmpty && !event.isCancelled {
                Section {
                    ForEach(team.rsvpPlayers) { player in
                        ChildRSVPRow(player: player, event: event, rsvp: detail.rsvp(for: player.id),
                                     label: player.id == team.playerSelf?.id ? "You" : player.firstName) { status in
                            await setRSVP(player: player.id, status: status)
                        }
                    }
                } header: {
                    Text("Your RSVP")
                } footer: {
                    Text(event.isRSVPOpen()
                         ? "RSVPs close \(event.effectiveRSVPCutoff.formatted(date: .abbreviated, time: .shortened))."
                         : "RSVPs are closed. Message your coach if plans change.")
                }
            }

            if team.canSeeAllRSVPs {
                availabilitySection(detail: detail, team: team)
            }

            Section {
                EventThreadLink(event: event, team: team)
            }
        }
        .toolbar {
            if team.canManageSchedule {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Edit Event", systemImage: "pencil") { showEditor = true }
                        if event.eventType == .game { Button("Enter Score", systemImage: "number") { showScore = true } }
                        Button(isTakingAttendance ? "Done Taking Attendance" : "Take Attendance", systemImage: "checklist") {
                            toggleAttendance(detail: detail)
                        }
                        if !event.isCancelled {
                            Divider()
                            Button("Cancel Event", systemImage: "xmark.octagon", role: .destructive) { confirmCancel = true }
                        }
                    } label: {
                        Label("Manage", systemImage: "ellipsis.circle")
                    }
                    // Anchored to the menu so the dialog points at the button that opened it,
                    // not the middle of the list (TestFlight feedback).
                    .confirmationDialog("Cancel this event?", isPresented: $confirmCancel, titleVisibility: .visible) {
                        Button("Cancel Event", role: .destructive) { Task { await cancel() } }
                    } message: {
                        Text("Everyone on the team will be notified.")
                    }
                }
            }
        }
        .sheet(isPresented: $showEditor, onDismiss: { Task { await load() } }) {
            EventEditorView(draft: EventDraft(event: event))
        }
        .sheet(isPresented: $showScore) {
            ScoreEntryView(event: event, teamName: team.name) { home, away in
                try await model.backend.setScore(eventID: event.id, homeScore: home, awayScore: away)
                await load()
            }
        }
    }

    @ViewBuilder
    private func availabilitySection(detail: EventDetail, team: TeamMembership) -> some View {
        Section {
            RSVPSummaryBar(counts: detail.counts)
            ForEach(detail.roster) { player in
                HStack {
                    JerseyBadge(number: player.jerseyNumber)
                    VStack(alignment: .leading) {
                        Text(player.fullName)
                        if let note = detail.rsvp(for: player.id)?.note {
                            Text("“\(note)”").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if isTakingAttendance {
                        Picker("Attendance", selection: Binding(
                            get: { attendanceDraft[player.id] ?? .present },
                            set: { attendanceDraft[player.id] = $0 }
                        )) {
                            ForEach(AttendanceStatus.allCases) { Text($0.displayName).tag($0) }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    } else if let attended = detail.attendance(for: player.id) {
                        TagLabel(text: attended.displayName, tint: attended.tint)
                    } else if let rsvp = detail.rsvp(for: player.id) {
                        Image(systemName: rsvp.status.symbolName).foregroundStyle(rsvp.status.tint)
                            .accessibilityLabel(rsvp.status.displayName)
                    } else {
                        Text("No reply").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if isTakingAttendance {
                AsyncButton(action: { await saveAttendance() }) {
                    Text("Save Attendance").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
        } header: {
            Text(isTakingAttendance ? "Attendance" : "Availability")
        }
    }

    // MARK: - Actions

    private func load() async {
        do {
            detail = try await model.backend.eventDetail(eventID: eventID)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func setRSVP(player: UUID, status: RSVPStatus) async {
        do {
            try await model.backend.setRSVP(eventID: eventID, playerID: player, status: status, note: nil)
            await load()
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }

    private func toggleAttendance(detail: EventDetail) {
        if !isTakingAttendance {
            // Pre-fill from RSVPs: "going" → present, "can't go" → excused.
            attendanceDraft = Dictionary(uniqueKeysWithValues: detail.roster.map { player in
                if let existing = detail.attendance(for: player.id) { return (player.id, existing) }
                return (player.id, detail.rsvp(for: player.id)?.status == .no ? .excused : .present)
            })
        }
        isTakingAttendance.toggle()
    }

    private func saveAttendance() async {
        do {
            try await model.backend.setAttendance(eventID: eventID, entries: attendanceDraft)
            isTakingAttendance = false
            await load()
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }

    private func cancel() async {
        do {
            try await model.backend.cancelEvent(id: eventID)
            model.noteDataChanged()
            await load()
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }
}

/// Final score entry for games.
struct ScoreEntryView: View {
    let event: TeamEvent
    let teamName: String
    let onSave: (Int, Int) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var ours = 0
    @State private var theirs = 0
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Stepper("\(teamName): \(ours)", value: $ours, in: 0...300)
                Stepper("\(event.opponent ?? "Opponent"): \(theirs)", value: $theirs, in: 0...300)
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .navigationTitle("Final Score")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Save") {
                        let isAway = event.homeAway == "away"
                        do {
                            try await onSave(isAway ? theirs : ours, isAway ? ours : theirs)
                            dismiss()
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                }
            }
            .onAppear {
                let isAway = event.homeAway == "away"
                ours = (isAway ? event.awayScore : event.homeScore) ?? 0
                theirs = (isAway ? event.homeScore : event.awayScore) ?? 0
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    NavigationStack {
        EventDetailView(eventID: UUID())
    }
    .environment(AppModel.preview(.coach))
}

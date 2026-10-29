import SwiftUI

/// One club team from the director's side: open it, coaches (assign, replace, remove), grouping.
struct ClubTeamDetailView: View {
    @Environment(AppModel.self) private var model
    let teamID: UUID
    @Binding var overview: ClubOverview?
    var openTeam: (UUID) -> Void
    var reload: () async -> Void

    @State private var showAssign = false
    @State private var coachToRemove: ClubTeam.Coach?
    @State private var editing = false
    @State private var message: String?

    private var team: ClubTeam? { overview?.teams.first { $0.id == teamID } }

    var body: some View {
        if let team {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(team.name).font(.title3.bold())
                        if !team.groupingLine.isEmpty { Text(team.groupingLine).foregroundStyle(.secondary) }
                        if let season = team.season { Text(season).font(.caption).foregroundStyle(.secondary) }
                    }
                    Button("Open Team", systemImage: "arrow.up.forward.app") { openTeam(team.id) }
                } footer: {
                    Text("You can do everything a head coach can on this team: schedule, roster, RSVPs, attendance, dues and team chat.")
                }
                Section("Coaches") {
                    ForEach(team.coaches, id: \.userId) { coach in
                        LabeledContent(coach.name, value: coach.role.displayName)
                            .swipeActions { Button("Remove", role: .destructive) { coachToRemove = coach } }
                    }
                    ForEach(team.pendingCoaches, id: \.code) { pending in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pending.email ?? "Invited coach")
                            Text("Invited · code \(pending.code)").font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                        .swipeActions {
                            Button("Cancel Invite", role: .destructive) { Task { await removeInvite(pending) } }
                            ShareLink(item: inviteText(pending.code)) { Label("Share", systemImage: "square.and.arrow.up") }.tint(.blue)
                        }
                    }
                    Button(team.coaches.isEmpty ? "Assign a Coach" : "Add a Coach", systemImage: "person.badge.plus") { showAssign = true }
                }
                Section("At a glance") {
                    LabeledContent("Players", value: "\(team.rosterCount)")
                    LabeledContent("Families joined", value: "\(team.familyCount)")
                    if let next = team.nextEvent {
                        LabeledContent("Next", value: "\(next.label), \(next.startsAt.formatted(date: .abbreviated, time: .shortened))")
                        LabeledContent("RSVPs", value: "\(next.rsvpCount) of \(team.rosterCount)")
                    }
                }
            }
            .navigationTitle(team.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .primaryAction) { Button("Edit") { editing = true } } }
            .sheet(isPresented: $showAssign, onDismiss: { Task { await reload() } }) {
                AssignCoachView(team: team) { await reload() }
            }
            .sheet(isPresented: $editing, onDismiss: { Task { await reload() } }) { EditClubTeamView(team: team) }
            .confirmationDialog("Remove \(coachToRemove?.name ?? "coach")?", isPresented: Binding(get: { coachToRemove != nil }, set: { if !$0 { coachToRemove = nil } }),
                                titleVisibility: .visible, presenting: coachToRemove) { coach in
                Button("Remove Coach", role: .destructive) { Task { await remove(coach) } }
            } message: { _ in
                Text("The team, its roster, schedule and families stay with the club. You can assign a new coach.")
            }
            .alert("Coaches", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(message ?? "") }
        }
    }

    private func inviteText(_ code: String) -> String {
        "You're invited to coach \(team?.name ?? "a team") with \(overview?.club.name ?? "our club") on ClubHQ. Get the app at teamclubhq.com, then More → Join a Club and enter code \(code)."
    }

    private func remove(_ coach: ClubTeam.Coach) async {
        do {
            try await model.backend.clubRemoveCoach(teamID: teamID, userID: coach.userId, email: nil)
            await reload()
        } catch { message = error.localizedDescription }
    }

    private func removeInvite(_ pending: ClubTeam.PendingCoach) async {
        do {
            try await model.backend.clubRemoveCoach(teamID: teamID, userID: nil, email: pending.email)
            await reload()
        } catch { message = error.localizedDescription }
    }
}

/// Put a coach on a team by email: added right away if they're on ClubHQ, otherwise a code to send.
struct AssignCoachView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let team: ClubTeam
    /// Refreshes the club right after the coach is added, before the sheet closes.
    var onAssigned: () async -> Void = {}
    @State private var email = ""
    @State private var role: TeamRole = .headCoach
    @State private var result: (CoachAssignment, String?)?
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                if let (assignment, inviteText) = result {
                    Section {
                        if assignment.status == .assigned {
                            Label("\(assignment.email) is now \(role == .headCoach ? "head coach" : "an assistant coach") of \(team.name). We told them.", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else {
                            Label("\(assignment.email) isn't on ClubHQ yet. Send them this code:", systemImage: "envelope.badge")
                            Text(assignment.code ?? "").font(.title2.monospaced().bold()).textSelection(.enabled)
                            if let inviteText { ShareLink(item: inviteText) { Label("Send Invite", systemImage: "square.and.arrow.up") } }
                        }
                    }
                } else {
                    Section {
                        TextField("coach@email.com", text: $email)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Picker("Role", selection: $role) {
                            Text("Head Coach").tag(TeamRole.headCoach)
                            Text("Assistant Coach").tag(TeamRole.assistantCoach)
                        }
                    } footer: {
                        Text("If they already use ClubHQ, they're added right away. Otherwise you'll get a code to send them.")
                    }
                    if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
                }
            }
            .navigationTitle("Coach for \(team.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(result == nil ? "Cancel" : "Done") { dismiss() } }
                if result == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        AsyncButton("Add") { await assign() }.disabled(!email.contains("@"))
                    }
                }
            }
        }
    }

    private func assign() async {
        do {
            result = try await model.backend.clubAssignCoach(teamID: team.id, email: email.trimmingCharacters(in: .whitespaces), role: role)
            errorText = nil
            await onAssigned()
        } catch { errorText = error.localizedDescription }
    }
}

/// Name, grade, gender, level and season of a club team.
struct EditClubTeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let team: ClubTeam
    @State private var fields: NewClubTeam
    @State private var errorText: String?

    init(team: ClubTeam) {
        self.team = team
        _fields = State(initialValue: NewClubTeam(name: team.name, grade: team.grade, gender: team.gender, level: team.level, season: team.season))
    }

    var body: some View {
        NavigationStack {
            Form {
                ClubTeamFields(team: $fields, showsCoach: false)
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            }
            .navigationTitle("Edit Team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Save") { await save() }.disabled(fields.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func save() async {
        do {
            try await model.backend.clubUpdateTeam(teamID: team.id, name: fields.name, grade: fields.grade, gender: fields.gender, level: fields.level, season: fields.season)
            model.noteDataChanged()
            dismiss()
        } catch { errorText = error.localizedDescription }
    }
}

/// Shared form rows for a club team.
struct ClubTeamFields: View {
    @Binding var team: NewClubTeam
    var showsCoach = true

    private func text(_ key: WritableKeyPath<NewClubTeam, String?>) -> Binding<String> {
        Binding(get: { team[keyPath: key] ?? "" }, set: { team[keyPath: key] = $0.isEmpty ? nil : $0 })
    }

    var body: some View {
        Section {
            TextField("Team name", text: $team.name)
            TextField("Grade (e.g. 6)", text: text(\.grade)).keyboardType(.numbersAndPunctuation)
            Picker("Gender", selection: Binding(get: { team.gender ?? "" }, set: { team.gender = $0.isEmpty ? nil : $0 })) {
                Text("Not set").tag("")
                Text("Boys").tag("boys")
                Text("Girls").tag("girls")
                Text("Coed").tag("coed")
            }
            TextField("Level (e.g. Elite, Gold)", text: text(\.level))
            TextField("Season (e.g. Fall 2026)", text: text(\.season))
            if showsCoach {
                TextField("Head coach email (optional)", text: text(\.coachEmail))
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        }
    }
}

/// Add one team, or paste a list (one team per line).
struct AddClubTeamsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let orgID: UUID

    enum Mode: String, CaseIterable, Identifiable { case one = "One Team", list = "Paste a List"; var id: Self { self } }
    @State private var mode: Mode = .one
    @State private var single = NewClubTeam(name: "")
    @State private var pasted = ""
    @State private var created: [CreatedClubTeam]?
    @State private var errorText: String?

    private var parsed: [NewClubTeam] { ClubGrouping.parseTeamList(pasted) }
    private var toCreate: [NewClubTeam] {
        mode == .one ? (single.name.trimmingCharacters(in: .whitespaces).isEmpty ? [] : [single]) : parsed
    }

    var body: some View {
        NavigationStack {
            Form {
                if let created {
                    Section("Added \(created.count) team\(created.count == 1 ? "" : "s")") {
                        ForEach(created) { team in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(team.name).font(.headline)
                                switch team.coach?.status {
                                case .assigned: Text("Coach added: \(team.coach?.email ?? "")").font(.caption).foregroundStyle(.green)
                                case .invited:
                                    Text("\(team.coach?.email ?? "Coach") isn't on ClubHQ yet · code \(team.coach?.code ?? "")").font(.caption)
                                    if let text = team.inviteText { ShareLink(item: text) { Label("Send Invite", systemImage: "square.and.arrow.up") }.font(.caption) }
                                case nil: Text("No coach yet").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } else {
                    Picker("Mode", selection: $mode) { ForEach(Mode.allCases) { Text($0.rawValue).tag($0) } }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                    if mode == .one {
                        ClubTeamFields(team: $single)
                    } else {
                        Section {
                            TextEditor(text: $pasted)
                                .font(.callout.monospaced())
                                .frame(minHeight: 140)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                        } header: {
                            Text("One team per line")
                        } footer: {
                            Text(verbatim: "Name, grade, gender, level, season, coach email: everything after the name is optional. Paste from a spreadsheet works too.\nExample: 3D Nation 6th Boys, 6, Boys, Elite, Fall 2026, coach@email.com")
                        }
                        if !parsed.isEmpty {
                            Section("\(parsed.count) team\(parsed.count == 1 ? "" : "s") to add") {
                                ForEach(parsed) { team in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(team.name)
                                        Text([ClubGrouping.gradeLabel(team.grade), team.gender?.capitalized, team.level, team.season, team.coachEmail].compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
                }
            }
            .navigationTitle("Add Teams")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(created == nil ? "Cancel" : "Done") { dismiss() } }
                if created == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        AsyncButton(toCreate.count > 1 ? "Add \(toCreate.count)" : "Add") { await create() }.disabled(toCreate.isEmpty)
                    }
                }
            }
        }
    }

    private func create() async {
        do {
            created = try await model.backend.clubCreateTeams(orgID: orgID, teams: toCreate)
            errorText = nil
            await model.reloadContext()
        } catch { errorText = error.localizedDescription }
    }
}

/// Club announcement or club event, sent to all teams or a filtered group, with a live preview.
struct ClubComposerView: View {
    enum Mode { case announcement, event }
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let overview: ClubOverview

    @State private var filter = ClubFilter()
    @State private var audience: ClubAudience?
    @State private var title = ""
    @State private var bodyText = ""
    @State private var draft: EventDraft
    @State private var sent: ClubAudience?
    @State private var errorText: String?

    init(mode: Mode, overview: ClubOverview) {
        self.mode = mode
        self.overview = overview
        var d = EventDraft(teamId: overview.teams.first?.id ?? UUID())
        d.eventType = .other
        _draft = State(initialValue: d)
    }

    private var matching: [ClubTeam] { overview.teams.filter(filter.matches) }

    var body: some View {
        NavigationStack {
            Form {
                if let sent {
                    Section {
                        Label("Sent to \(ClubText.teams(sent.teamCount)) · \(ClubText.people(sent.peopleCount))", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } footer: {
                        Text(mode == .announcement ? "It shows in each team's announcements as from \(overview.club.name)." : "It's on each team's schedule. Cancel it from the Club tab to cancel it everywhere.")
                    }
                } else {
                    audienceSection
                    if mode == .announcement {
                        Section("Announcement") {
                            TextField("Title", text: $title)
                            TextField("Message", text: $bodyText, axis: .vertical).lineLimit(4...10)
                        }
                    } else {
                        Section("Event") {
                            TextField("Title (e.g. Picture Day, Tryouts)", text: $draft.title)
                            Picker("Type", selection: $draft.eventType) { ForEach(EventType.allCases) { Text($0.displayName).tag($0) } }
                            DatePicker("Starts", selection: $draft.startsAt)
                            DatePicker("Ends", selection: $draft.endsAt, in: draft.startsAt...)
                            TextField("Location", text: $draft.location)
                            TextField("Address (optional)", text: $draft.locationAddress)
                            TextField("Notes (optional)", text: $draft.notes, axis: .vertical).lineLimit(2...5)
                        }
                    }
                    if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
                }
            }
            .navigationTitle(mode == .announcement ? "Club Announcement" : "Club Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(sent == nil ? "Cancel" : "Done") { dismiss() } }
                if sent == nil {
                    ToolbarItem(placement: .confirmationAction) { AsyncButton("Send") { await send() }.disabled(!canSend) }
                }
            }
            .task(id: filter) {
                audience = nil
                await refreshAudience()
            }
        }
    }

    private var canSend: Bool {
        guard !matching.isEmpty else { return false }
        return mode == .announcement
            ? !title.trimmingCharacters(in: .whitespaces).isEmpty && !bodyText.trimmingCharacters(in: .whitespaces).isEmpty
            : !draft.title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var audienceSection: some View {
        Section {
            groupToggles("Grade", values: overview.values(\.grade), selection: $filter.grades) { ClubGrouping.gradeLabel($0) ?? $0 }
            groupToggles("Gender", values: overview.values(\.gender), selection: $filter.genders) { $0.capitalized }
            groupToggles("Level", values: overview.values(\.level), selection: $filter.levels) { $0 }
            groupToggles("Season", values: overview.values(\.season), selection: $filter.seasons) { $0 }
        } header: {
            Text("Send to")
        } footer: {
            // Same shape while counting, so the fields below don't jump.
            Text("\(filter.isEmpty ? "Every team" : "Matching teams"): \(ClubText.teams(audience?.teamCount ?? matching.count)) · \(audience.map { ClubText.people($0.peopleCount) + "." } ?? "counting people…") Families with kids on two teams get it once.")
        }
    }

    @ViewBuilder
    private func groupToggles(_ title: String, values: [String], selection: Binding<[String]>, label: @escaping (String) -> String) -> some View {
        if values.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Text(title).font(.subheadline).foregroundStyle(.secondary)
                    ForEach(values, id: \.self) { value in
                        let on = selection.wrappedValue.contains(value)
                        Button(label(value)) {
                            if on { selection.wrappedValue.removeAll { $0 == value } } else { selection.wrappedValue.append(value) }
                        }
                        .buttonStyle(.bordered)
                        .tint(on ? .accentColor : .secondary)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
        }
    }

    private func refreshAudience() async {
        audience = try? await model.backend.clubAudience(orgID: overview.club.id, filter: filter)
    }

    private func send() async {
        do {
            switch mode {
            case .announcement:
                sent = try await model.backend.clubAnnouncement(orgID: overview.club.id, filter: filter, title: title, body: bodyText)
            case .event:
                sent = try await model.backend.clubEvent(orgID: overview.club.id, filter: filter, draft: draft)
            }
            model.noteDataChanged()
            errorText = nil
        } catch { errorText = error.localizedDescription }
    }
}

/// "1 team", "3 teams", "1 person", "4 people".
enum ClubText {
    static func teams(_ n: Int) -> String { n == 1 ? "1 team" : "\(n) teams" }
    static func people(_ n: Int) -> String { n == 1 ? "1 person" : "\(n) people" }
}

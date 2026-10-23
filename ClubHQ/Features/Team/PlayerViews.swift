import SwiftUI

/// Player profile. Coaches see notes and can edit; guardians and coaches can create a
/// 13+ player login (DECISIONS D-008). Emergency contacts are visible per RLS.
struct PlayerDetailView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var player: Player
    @State private var contacts: [EmergencyContact] = []
    @State private var inviteCode: PlayerInviteCode?
    @State private var inviteError: String?
    @State private var birthdateDraft = Calendar.current.date(byAdding: .year, value: -14, to: .now) ?? .now
    @State private var showEditor = false
    @State private var confirmArchive = false
    @State private var showCoParentInvite = false

    init(player: Player, team: TeamMembership) {
        self.team = team
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.player = player
    }

    private var isMyChild: Bool { team.linkedPlayers.contains { $0.id == player.id } }
    private var canInvitePlayer: Bool { (team.isHeadCoach || isMyChild) && !player.hasAccount }
    private var canInviteCoParent: Bool { team.isHeadCoach || isMyChild }
    private var age: Int? { AgePolicy.age(birthdate: player.birthdate) }

    var body: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    InitialsAvatar(name: player.fullName, size: 64, tint: team.tint)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.fullName).font(.title2.bold())
                        Text([player.jerseyNumber.map { "#\($0)" }, player.position].compactMap { $0 }.joined(separator: " · "))
                            .foregroundStyle(.secondary)
                        if player.hasAccount { TagLabel(text: "Has player login", tint: .green, systemImage: "person.crop.circle.badge.checkmark") }
                    }
                }
                .padding(.vertical, 6)
            }

            if team.isStaff || isMyChild {
                // Only show Details when there's something in it.
                if age != nil || (team.isStaff && player.notes?.isEmpty == false) {
                    Section("Details") {
                        if let age { LabeledContent("Age", value: "\(age)") }
                        if team.isStaff, let notes = player.notes, !notes.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Coach notes").font(.caption).foregroundStyle(.secondary)
                                Text(notes)
                            }
                        }
                    }
                }
                Section("Emergency contacts") {
                    if contacts.isEmpty {
                        Text("None on file").foregroundStyle(.secondary)
                    }
                    ForEach(contacts) { contact in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(contact.name ?? contact.relationship.displayName).font(.headline)
                            Text(contact.relationship.displayName).font(.caption).foregroundStyle(.secondary)
                            HStack(spacing: 16) {
                                if let tel = URL(string: "tel:\(contact.phone.filter { $0.isNumber || $0 == "+" })") {
                                    Link(destination: tel) { Label(contact.phone, systemImage: "phone.fill") }
                                }
                                if let email = contact.email, let mail = URL(string: "mailto:\(email)") {
                                    Link(destination: mail) { Label("Email", systemImage: "envelope.fill") }
                                }
                            }
                            .font(.subheadline)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            if canInviteCoParent {
                Section {
                    Button { showCoParentInvite = true } label: {
                        Label("Invite Co-Parent", systemImage: "person.2.badge.plus")
                    }
                } footer: {
                    Text("Another parent or guardian joins \(player.firstName)'s existing profile — no duplicate on the roster.")
                }
            }

            if canInvitePlayer {
                Section {
                    if let inviteCode {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(inviteCode.code)
                                .font(.largeTitle.monospaced().bold())
                                .textSelection(.enabled)
                            Text("\(player.firstName) enters this code in ClubHQ under “I'm a player”. Expires \(inviteCode.expiresAt.formatted(date: .abbreviated, time: .omitted)).")
                                .font(.caption).foregroundStyle(.secondary)
                            ShareLink(item: "Your ClubHQ player code for \(team.name): \(inviteCode.code)") {
                                Label("Send to \(player.firstName)", systemImage: "square.and.arrow.up")
                            }
                        }
                    } else if player.birthdate == nil {
                        // Needed for the 13+ check (D-008); guardians can set it here.
                        DatePicker("Birthdate", selection: $birthdateDraft, in: ...Date.now, displayedComponents: .date)
                        AsyncButton(action: saveBirthdate) {
                            Label("Save birthdate", systemImage: "calendar.badge.checkmark")
                        }
                    } else if let age, age < AgePolicy.minimumPlayerAccountAge {
                        Label("\(player.firstName) can have their own login at 13. Until then, you RSVP and follow the team for them.",
                              systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        AsyncButton(action: createInvite) {
                            Label("Create player login code", systemImage: "person.crop.circle.badge.plus")
                        }
                    }
                    if let inviteError { Text(inviteError).font(.footnote).foregroundStyle(.orange) }
                } header: {
                    Text("Player account")
                } footer: {
                    Text("For players 13 and older. Players see the schedule, RSVP for themselves, and use team chat — they can't send private messages.")
                }
            }
        }
        .navigationTitle(player.firstName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if team.canManageRoster {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Edit", systemImage: "pencil") { showEditor = true }
                        Button("Remove from Roster", systemImage: "archivebox", role: .destructive) { confirmArchive = true }
                    } label: {
                        Label("Manage", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $showCoParentInvite) {
            CoParentInviteView(player: player, team: team)
        }
        .sheet(isPresented: $showEditor) {
            PlayerEditorView(draft: PlayerDraft(player: player), sport: team.resolvedSport) { updated in
                player.firstName = updated.firstName
                player.lastName = updated.lastName
                player.jerseyNumber = updated.jerseyNumber.nilIfEmpty
                player.position = updated.position.nilIfEmpty
                player.birthdate = updated.birthdate.map(JSONCoding.formatDateOnly)
                player.notes = updated.notes.nilIfEmpty
            }
        }
        .confirmationDialog("Remove \(player.firstName) from the roster?", isPresented: $confirmArchive, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                Task {
                    try? await model.backend.archivePlayer(id: player.id)
                    model.noteDataChanged()
                    dismiss()
                }
            }
        } message: {
            Text("Their history (attendance, payments) is kept.")
        }
        .task {
            contacts = (try? await model.backend.emergencyContacts(playerID: player.id)) ?? []
        }
    }

    private func saveBirthdate() async {
        inviteError = nil
        do {
            try await model.backend.setPlayerBirthdate(playerID: player.id, birthdate: birthdateDraft)
            player.birthdate = JSONCoding.formatDateOnly(birthdateDraft)
            model.noteDataChanged()
        } catch {
            inviteError = error.localizedDescription
        }
    }

    private func createInvite() async {
        inviteError = nil
        do {
            inviteCode = try await model.backend.createPlayerInvite(playerID: player.id)
        } catch {
            inviteError = error.localizedDescription
        }
    }
}

/// Share sheet for a co-parent invite: a link tied to one child (DECISIONS D-035).
struct CoParentInviteView: View {
    let player: Player
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var invite: InviteLink?
    @State private var errorText: String?

    private var shareText: String {
        guard let invite else { return "" }
        return """
        Join \(player.firstName) on \(team.name) in ClubHQ — schedules, RSVPs, and team chat in one ad-free app.
        Tap to join: \(invite.url.absoluteString)
        Or download ClubHQ, choose "I'm a parent or guardian", and enter code: \(invite.token)
        """
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 50))
                    .foregroundStyle(team.tint)
                    .padding(.top, 32)
                    .accessibilityHidden(true)
                Text("Invite a co-parent")
                    .font(.title2.bold())
                Text("Send this to \(player.firstName)'s other parent or guardian. They'll join \(player.firstName)'s profile and get the same schedule, RSVPs, and announcements.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                if let invite {
                    VStack(spacing: 12) {
                        ShareLink(item: shareText) {
                            Label("Share Invite", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .tint(team.tint)
                        Text("Only for \(player.firstName) — don't post it in the team group chat. Works until \(invite.expiresAt.formatted(date: .abbreviated, time: .omitted)).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                } else if let errorText {
                    Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center)
                } else {
                    ProgressView()
                }
                Spacer()
            }
            .padding(.horizontal, 24)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task {
                do {
                    invite = try await model.backend.createGuardianInvite(playerID: player.id)
                } catch {
                    errorText = error.localizedDescription
                }
            }
        }
    }
}

struct PlayerEditorView: View {
    let sport: Sport
    var onSaved: ((PlayerDraft) -> Void)?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PlayerDraft
    @State private var hasBirthdate: Bool
    @State private var errorText: String?

    init(draft: PlayerDraft, sport: Sport, onSaved: ((PlayerDraft) -> Void)? = nil) {
        self.sport = sport
        self.onSaved = onSaved
        // `@State` is a macro in SDK 27: no declaration defaults, assign once here.
        self.draft = draft
        self.hasBirthdate = draft.birthdate != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Player") {
                    TextField("First name", text: $draft.firstName)
                    TextField("Last name", text: $draft.lastName)
                    TextField("Jersey number", text: $draft.jerseyNumber).keyboardType(.numberPad)
                    if sport.positions.isEmpty {
                        TextField("Position", text: $draft.position)
                    } else {
                        Picker("Position", selection: $draft.position) {
                            Text("None").tag("")
                            ForEach(sport.positions, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    Toggle("Birthdate", isOn: $hasBirthdate.animation())
                    if hasBirthdate {
                        DatePicker("Birthdate", selection: Binding(get: { draft.birthdate ?? .now }, set: { draft.birthdate = $0 }),
                                   in: ...Date.now, displayedComponents: .date)
                    }
                }
                Section {
                    TextField("Private notes", text: $draft.notes, axis: .vertical).lineLimit(2...6)
                } header: {
                    Text("Coach notes")
                } footer: {
                    Text("Visible to team staff only.")
                }
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .navigationTitle(draft.id == nil ? "Add Player" : "Edit Player")
            .keyboardDoneButton()
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: hasBirthdate) { _, isOn in if !isOn { draft.birthdate = nil } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Save") {
                        do {
                            try await model.backend.savePlayer(draft)
                            onSaved?(draft)
                            model.noteDataChanged()
                            dismiss()
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(!draft.isValid)
                }
            }
        }
    }
}

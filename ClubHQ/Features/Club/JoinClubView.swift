import SwiftUI

/// More → Join a Club (D-044). A coach code makes you coach of that team; the club code lets a
/// coach bring one of their teams into the club (roster and families come along) or start one.
struct JoinClubView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var preview: ClubInvitePreview?
    @State private var choice: Choice = .bring
    @State private var bringTeamID: UUID?
    @State private var newTeam = NewClubTeam(name: "")
    @State private var joinedTeamID: UUID?
    @State private var errorText: String?

    enum Choice: Hashable { case bring, start }

    var body: some View {
        NavigationStack {
            Form {
                if joinedTeamID != nil {
                    Section {
                        Label("You're in \(preview?.clubName ?? "the club").", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } footer: {
                        Text("Your team is now part of the club. Families don't see any change.")
                    }
                } else if let preview {
                    content(preview)
                } else {
                    Section {
                        TextField("Club or coach code", text: $code)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.title3.monospaced())
                            .onChange(of: code) { errorText = nil }
                    } footer: {
                        Text("Your club director can give you a club code, or a coach code for a specific team.")
                    }
                }
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            }
            .navigationTitle("Join a Club")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(joinedTeamID == nil ? "Cancel" : "Done") { dismiss() } }
                if joinedTeamID == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if preview == nil {
                            AsyncButton("Next") { await lookup() }.disabled(code.trimmingCharacters(in: .whitespaces).count < 8)
                        } else {
                            AsyncButton("Join") { await join() }.disabled(!canJoin)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ preview: ClubInvitePreview) -> some View {
        if preview.kind == .coach {
            Section {
                Text("\(preview.clubName) invited you to be \(preview.role == .assistantCoach ? "an assistant coach" : "head coach") of **\(preview.teamName ?? "a team")**.")
            }
        } else {
            Section("\(preview.clubName)") {
                Picker("How", selection: $choice) {
                    if !preview.movableTeams.isEmpty { Text("Bring my team").tag(Choice.bring) }
                    Text("Start a new team").tag(Choice.start)
                }
                .pickerStyle(.segmented)
            }
            if choice == .bring && !preview.movableTeams.isEmpty {
                Section {
                    Picker("Team", selection: $bringTeamID) {
                        Text("Choose…").tag(UUID?.none)
                        ForEach(preview.movableTeams) { Text($0.name).tag(UUID?.some($0.id)) }
                    }
                } footer: {
                    Text("The roster, schedule and families come along. The club's directors can then see and manage the team.")
                }
            } else {
                ClubTeamFields(team: $newTeam, showsCoach: false)
            }
        }
    }

    private var canJoin: Bool {
        guard let preview else { return false }
        if preview.kind == .coach { return true }
        if choice == .bring && !preview.movableTeams.isEmpty { return bringTeamID != nil }
        return !newTeam.name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func lookup() async {
        do {
            let found = try await model.backend.lookupClubInvite(code: code.trimmingCharacters(in: .whitespaces))
            preview = found
            choice = found.movableTeams.isEmpty ? .start : .bring
            errorText = nil
        } catch { errorText = error.localizedDescription }
    }

    private func join() async {
        guard let preview else { return }
        do {
            let teamID = try await model.backend.claimClubInvite(
                code: code.trimmingCharacters(in: .whitespaces),
                teamID: preview.kind == .clubCode && choice == .bring ? bringTeamID : nil,
                newTeam: preview.kind == .clubCode && (choice == .start || preview.movableTeams.isEmpty) ? newTeam : nil
            )
            joinedTeamID = teamID
            await model.reloadContext()
            model.selectedTeamID = teamID
        } catch { errorText = error.localizedDescription }
    }
}

/// More → Start a Club: the director creates the club, then adds teams in the Club tab.
struct StartClubView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Club name (e.g. 3D Basketball Academy)", text: $name)
                } footer: {
                    Text("You'll be the club's director: see every team, message families by grade or level, and add club events. You don't need to coach a team. Parents won't see the club, only their own team.")
                }
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            }
            .navigationTitle("Start a Club")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Create") { await create() }.disabled(name.trimmingCharacters(in: .whitespaces).count < 2)
                }
            }
        }
    }

    private func create() async {
        do {
            _ = try await model.backend.createClub(name: name.trimmingCharacters(in: .whitespaces))
            await model.reloadContext()
            model.showClubTab = true
            dismiss()
        } catch { errorText = error.localizedDescription }
    }
}

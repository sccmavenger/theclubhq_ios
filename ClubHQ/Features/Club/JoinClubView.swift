import SwiftUI

/// More → Join a Club (D-044). A coach code makes you coach of that team; the club code lets a
/// coach bring one of their teams into the club (roster and families come along) or start one.
/// A director code makes you one of the club's directors (D-053).
struct JoinClubView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var preview: ClubInvitePreview?
    @State private var choice: Choice = .bring
    @State private var bringTeamID: UUID?
    @State private var newTeam = NewClubTeam(name: "")
    @State private var joined = false
    @State private var errorText: String?

    enum Choice: Hashable { case bring, start }

    var body: some View {
        NavigationStack {
            Form {
                if joined, preview?.kind == .director {
                    Section {
                        Label("You're a director of \(preview?.clubName ?? "the club").", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } footer: {
                        Text("Open the Club tab to see every team. You can also manage the club on a computer at teamclubhq.com/club with this same login.")
                    }
                } else if joined {
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
                            .keyboardType(.asciiCapable)
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
                ToolbarItem(placement: .cancellationAction) { Button(joined ? "Done" : "Cancel") { dismiss() } }
                if !joined {
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
        if preview.kind == .director {
            Section {
                Text("\(preview.clubName) invited you to be a **director**.")
            } footer: {
                Text("Directors see every team in the club, act as head coach on any of them, message families and add club events. Private messages between coaches and parents stay private.")
            }
        } else if preview.kind == .coach {
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
        if preview.kind == .coach || preview.kind == .director { return true }
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
            joined = true
            await model.reloadContext()
            if let teamID { model.selectedTeamID = teamID } else { model.showClubTab = true }
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
                    Text("You'll be the club's director: see every team, message families by grade or level, and add club events. You don't need to coach a team. Parents won't see the club, only their own team.\n\nWe review new clubs before they go live, usually within a day. You'll get a notification when it's on.")
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

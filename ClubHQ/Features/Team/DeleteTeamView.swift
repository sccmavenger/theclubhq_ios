import SwiftUI

/// Delete a team for everyone (D-046). Independent teams: their head coach. Club teams: only the
/// club's directors. There's no undo in the app; ClubHQ support can restore it within 30 days,
/// then it's permanently deleted.
struct DeleteTeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let teamID: UUID
    let teamName: String
    /// Runs after the team is gone (e.g. refresh the Club tab).
    var onDeleted: () async -> Void = {}

    @State private var typed = ""
    @State private var tellFamilies = true
    @State private var errorText: String?

    private var matches: Bool {
        typed.trimmingCharacters(in: .whitespaces).lowercased() == teamName.trimmingCharacters(in: .whitespaces).lowercased()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("**\(teamName)** disappears for everyone: coaches, families and players.", systemImage: "person.3.sequence")
                    Label("Its schedule, chats, roster, RSVPs, attendance and dues go with it. Reminders and calendar feeds stop.", systemImage: "calendar.badge.minus")
                    Label("There's no undo in the app. If it was a mistake, contact ClubHQ support within 30 days. After that it's permanently deleted.", systemImage: "clock.badge.exclamationmark")
                } header: {
                    Text("What happens")
                }
                Section {
                    Toggle("Tell families the team was closed", isOn: $tellFamilies)
                }
                Section {
                    TextField(teamName, text: $typed)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onChange(of: typed) { errorText = nil }
                } header: {
                    Text("Type the team's name to confirm")
                }
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
                Section {
                    AsyncButton(role: .destructive) { await delete() } label: {
                        Text("Delete Team").frame(maxWidth: .infinity)
                    }
                    .disabled(!matches)
                }
            }
            .navigationTitle("Delete Team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func delete() async {
        do {
            try await model.backend.deleteTeam(teamID: teamID, confirmName: typed, notifyFamilies: tellFamilies)
            await onDeleted()
            await model.reloadContext()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

import SwiftUI

/// What a member is reporting from a conversation (App Review guideline 1.2).
enum ReportTarget: Identifiable {
    case message(ChatMessage)
    case conversation

    var id: String {
        switch self {
        case .message(let message): message.id.uuidString
        case .conversation: "conversation"
        }
    }
}

/// Sends a report straight to ClubHQ's moderation queue (DECISIONS D-041). If the server can't
/// take it (offline, outage), the caller falls back to the prefilled support email, so a report
/// is never lost.
struct ReportSheet: View {
    let target: ReportTarget
    let threadID: UUID
    let onFallback: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var reason: ReportReason = .harassment
    @State private var note = ""
    @State private var errorText: String?
    @State private var sent = false

    private var isConversation: Bool {
        if case .conversation = target { return true }
        return false
    }

    private var canSend: Bool {
        !isConversation || !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if case .message(let message) = target {
                    Section("Message") {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(message.authorName).font(.subheadline.weight(.semibold))
                            Text(message.hasPhoto && !message.hasText ? "📷 Photo" : message.body)
                                .lineLimit(4)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("What's wrong?") {
                    Picker("Reason", selection: $reason) {
                        ForEach(ReportReason.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    TextField(isConversation ? "What happened?" : "Anything else we should know? (optional)",
                              text: $note, axis: .vertical)
                        .lineLimit(3...6)
                } footer: {
                    Text("ClubHQ reviews reports within 24 hours. The person you report isn't told who reported them.")
                }
                if let errorText {
                    Section { Text(errorText).foregroundStyle(.red) }
                }
            }
            .navigationTitle(isConversation ? "Report a Concern" : "Report Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton(action: send) { Text("Send") }
                        .disabled(!canSend)
                }
            }
            .alert("Thanks for telling us", isPresented: $sent) {
                Button("OK") { dismiss() }
            } message: {
                Text("We'll review it within 24 hours.")
            }
        }
    }

    private func send() async {
        errorText = nil
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            switch target {
            case .message(let message):
                try await model.backend.reportMessage(id: message.id, reason: reason, note: trimmed.isEmpty ? nil : trimmed)
            case .conversation:
                try await model.backend.reportConversation(threadID: threadID, reason: reason, note: trimmed)
            }
            sent = true
        } catch let error as BackendError {
            if case .server(let status, _, _) = error, status < 500 {
                // Something about the report itself (e.g. the message is gone): say so.
                errorText = error.localizedDescription
            } else {
                dismiss()
                onFallback()
            }
        } catch {
            dismiss()
            onFallback()
        }
    }
}

#Preview {
    ReportSheet(target: .conversation, threadID: UUID(), onFallback: {})
        .environment(AppModel.preview(.parent))
}

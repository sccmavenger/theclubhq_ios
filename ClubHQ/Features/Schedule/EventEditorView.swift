import SwiftUI

/// Create or edit a practice, game, or other event. New events can repeat weekly.
struct EventEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventDraft
    @State private var errorText: String?

    init(draft: EventDraft) {
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.draft = draft
    }

    private var isNew: Bool { draft.id == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $draft.eventType) {
                        ForEach(EventType.allCases) { Label($0.displayName, systemImage: $0.symbolName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if draft.eventType == .game {
                        TextField("Opponent", text: $draft.opponent).textInputAutocapitalization(.words)
                        Picker("Home or away", selection: $draft.isHome) {
                            Text("Home").tag(true)
                            Text("Away").tag(false)
                        }
                    }
                    TextField(draft.eventType == .game ? "Title (optional)" : "Title (e.g. Practice)", text: $draft.title)
                }

                Section("When") {
                    DatePicker("Starts", selection: $draft.startsAt)
                    DatePicker("Ends", selection: $draft.endsAt, in: draft.startsAt...)
                    if isNew {
                        Stepper(value: $draft.repeatWeeks, in: 0...26) {
                            Text(draft.repeatWeeks == 0 ? "Doesn't repeat" : "Repeats weekly · \(draft.repeatWeeks + 1) events")
                        }
                    }
                }

                Section("Where") {
                    TextField("Venue (e.g. Rec-Plex North)", text: $draft.location)
                    TextField("Address (for directions)", text: $draft.locationAddress)
                        .textContentType(.fullStreetAddress)
                }

                Section("Notes") {
                    TextField("What to bring, jersey color, arrival time…", text: $draft.notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                if let errorText {
                    Section { Text(errorText).foregroundStyle(.red) }
                }
            }
            .navigationTitle(isNew ? "New Event" : "Edit Event")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: draft.startsAt) { old, new in
                // Keep the duration when the start moves.
                draft.endsAt = draft.endsAt.addingTimeInterval(new.timeIntervalSince(old))
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton(isNew ? "Add" : "Save", action: save)
                        .disabled(!draft.isValid)
                }
            }
        }
    }

    private func save() async {
        errorText = nil
        do {
            _ = try await model.backend.saveEvent(draft)
            model.noteDataChanged()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    EventEditorView(draft: EventDraft(teamId: UUID()))
        .environment(AppModel.preview(.coach))
}

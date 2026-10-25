import SwiftUI

/// Subscribe to a live calendar feed of every team's schedule (DECISIONS D-036).
/// Apple Calendar subscribes from the `webcal://` link; Google Calendar can only add a
/// calendar by URL from a computer, so that path copies the link instead.
struct CalendarSyncView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var feedURL: URL?
    @State private var errorText: String?
    @State private var copied = false
    @State private var confirmReset = false
    @State private var isWorking = false

    /// Same address with the webcal scheme, which iOS hands to Calendar as a subscription.
    private var webcalURL: URL? {
        guard let feedURL, var components = URLComponents(url: feedURL, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = "webcal"
        return components.url
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "calendar.badge.checkmark")
                            .font(.system(size: 40))
                            .foregroundStyle(.tint)
                        Text("Put the schedule in your calendar")
                            .font(.title3.bold())
                        Text("Practices and games from all your teams show up in your phone's calendar. When your coach changes or cancels something, your calendar updates on its own.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }

                if let errorText {
                    Section { Text(errorText).foregroundStyle(.secondary) }
                } else if feedURL == nil {
                    Section { ProgressView().frame(maxWidth: .infinity) }
                } else {
                    Section {
                        Button {
                            if let webcalURL { openURL(webcalURL) }
                        } label: {
                            Label("Subscribe in Calendar", systemImage: "calendar.badge.plus")
                        }
                    } footer: {
                        Text("iPhone asks you to confirm. Choose iCloud as the account to see it on all your Apple devices.")
                    }

                    Section {
                        Button {
                            UIPasteboard.general.url = feedURL
                            copied = true
                        } label: {
                            Label(copied ? "Link Copied" : "Copy Link", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                    } header: {
                        Text("Using Google Calendar?")
                    } footer: {
                        Text("Google only adds calendars by link on a computer: open calendar.google.com, click + next to Other calendars, choose From URL, and paste the link.")
                    }

                    Section {
                        Button("Reset Link", role: .destructive) { confirmReset = true }
                            .disabled(isWorking)
                            // Attached to the button so the dialog points at it, not the top of the list.
                            .confirmationDialog("Reset your calendar link?", isPresented: $confirmReset, titleVisibility: .visible) {
                                Button("Reset Link", role: .destructive) { Task { await load(reset: true) } }
                            } message: {
                                Text("The old link stops working, so calendars using it stop updating. Delete the old subscription from your calendar, then subscribe again.")
                            }
                    } footer: {
                        Text("Your calendar app decides how often to check for changes, so a last-minute change can take a while to show up there. ClubHQ notifications arrive right away. Keep this link private: anyone who has it can see your teams' schedules.")
                    }
                }
            }
            .navigationTitle("Calendar Sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await load(reset: false) }
            .onAppear { model.track("calendar_sync.opened") }
        }
    }

    private func load(reset: Bool) async {
        isWorking = true
        defer { isWorking = false }
        do {
            feedURL = try await model.backend.calendarFeedURL(reset: reset)
            copied = false
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    CalendarSyncView().environment(AppModel.preview(.parent))
}

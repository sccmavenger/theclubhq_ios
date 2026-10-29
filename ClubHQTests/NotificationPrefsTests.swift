import Foundation
import Testing
@testable import ClubHQ

/// Reminder switches (D-045).
@MainActor
struct NotificationPrefsTests {
    @Test func prefsDefaultOnAndDecodeFromServer() throws {
        #expect(NotificationPrefs() == NotificationPrefs(eventReminders: true, rsvpReminders: true))
        let json = #"{"event_reminders":false,"rsvp_reminders":true}"#
        let prefs = try JSONCoding.decoder.decode(NotificationPrefs.self, from: Data(json.utf8))
        #expect(!prefs.eventReminders && prefs.rsvpReminders)
    }

    @Test func demoSavesPrefs() async throws {
        let backend = DemoBackend(persona: .parent, latency: .zero)
        let saved = try await backend.setNotificationPrefs(NotificationPrefs(eventReminders: false, rsvpReminders: true))
        #expect(saved.eventReminders == false)
        let model = AppModel(backend: backend)
        await model.reloadContext()
        model.updateNotificationPrefs(saved)
        #expect(model.notificationPrefs.eventReminders == false)
    }
}

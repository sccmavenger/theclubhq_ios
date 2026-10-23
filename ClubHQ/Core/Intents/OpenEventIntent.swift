import AppIntents
import Foundation

/// Opens an event's detail screen. The first intent (D-039): it proves the entity plumbing
/// end to end, and Spotlight and widgets reuse it later to open what they show.
struct OpenEventIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Event"
    static let description = IntentDescription("Opens a practice, game or event in ClubHQ.")
    static let supportedModes: IntentModes = .foreground

    @Parameter(title: "Event") var target: EventEntity
    @Dependency private var model: AppModel

    func perform() async throws -> some IntentResult {
        // perform() isn't main-actor isolated, so hop before touching AppModel.
        // MainTabView consumes the link as soon as the tabs are on screen.
        let eventID = target.id
        let model = model
        await MainActor.run { model.pendingDeepLink = .event(eventID) }
        return .result()
    }
}

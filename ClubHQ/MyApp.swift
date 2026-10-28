import AppIntents
import SwiftUI

@main struct MyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        self.model = model
        // App Intents can run on a cold launch with no UI, so register before anything else (D-039).
        AppDependencyManager.shared.add(dependency: model)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .task {
                    await model.start()
                    #if DEBUG
                    // App Store screenshots: launch with `-ScreenshotPersona coach|parent|player`.
                    if let raw = UserDefaults.standard.string(forKey: "ScreenshotPersona"),
                       let persona = Persona(rawValue: raw) {
                        await model.startDemo(as: persona)
                        // `-ScreenshotOpen chat|event|tour` opens a detail screen (or the welcome tour) on top.
                        try? await Task.sleep(for: .seconds(1))  // let the tabs appear first
                        if let teamID = model.selectedTeam?.id {
                            switch UserDefaults.standard.string(forKey: "ScreenshotOpen") {
                            case "chat":
                                if let id = try? await model.backend.teamChatThreadID(teamID: teamID) {
                                    model.pendingDeepLink = .thread(id)
                                }
                            case "event":
                                if let event = try? await model.backend.events(teamIDs: [teamID], from: .now, to: nil).first {
                                    model.pendingDeepLink = .event(event.id)
                                }
                            case "tour":
                                model.replayWelcomeTour()
                            default: break
                            }
                        }
                    }
                    #endif
                }
                .onOpenURL { model.handle(url: $0) }
                // Coach Pro appears as soon as the App Store starts selling it (D-034).
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.store.loadProducts() } }
                    // Send queued usage events before iOS suspends the app (D-041).
                    if phase == .background { Task { await model.usage.flush() } }
                }
        }
    }
}

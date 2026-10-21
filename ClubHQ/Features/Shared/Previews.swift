import Foundation

extension AppModel {
    /// A signed-in demo model for SwiftUI previews.
    static func preview(_ persona: Persona = .coach) -> AppModel {
        let backend = DemoBackend(persona: persona, latency: .zero)
        let model = AppModel(backend: backend)
        Task { await model.reloadContext() }
        return model
    }
}

import Foundation
import FoundationModels

/// Whether Apple Intelligence features can run right now (DECISIONS D-039).
/// Every AI entry point asks this first: AI is optional, and the manual path always remains.
enum IntelligenceStatus: Equatable, Sendable {
    case available
    /// The device supports it, but the person hasn't turned Apple Intelligence on.
    case notEnabled
    /// The model is still downloading, or the system is busy. Try again later.
    case notReady
    /// The device can't run Apple Intelligence. Hide AI entry points entirely.
    case notEligible

    /// The on-device model's current status. Cheap to read; check when a screen appears.
    static var onDevice: IntelligenceStatus {
        switch SystemLanguageModel.default.availability {
        case .available: .available
        case .unavailable(.appleIntelligenceNotEnabled): .notEnabled
        case .unavailable(.modelNotReady): .notReady
        case .unavailable(.deviceNotEligible): .notEligible
        case .unavailable: .notReady
        }
    }

    /// Whether Private Cloud Compute can take a long, non-chat document (D-039: never chat).
    /// Callers still retry on-device when a PCC request fails, since it needs the network.
    static var canUseCloud: Bool {
        guard #available(iOS 27.0, *) else { return false }
        if case .available = PrivateCloudComputeLanguageModel().availability { return true }
        return false
    }

    var isAvailable: Bool { self == .available }

    /// Show the AI button at all? Ineligible devices never see it.
    var showsEntryPoint: Bool { self != .notEligible }

    /// A short explanation for a disabled AI button, or nil when it works (or is hidden).
    var explanation: String? {
        switch self {
        case .available, .notEligible: nil
        case .notEnabled: "Turn on Apple Intelligence in Settings to use this."
        case .notReady: "Apple Intelligence is still getting ready. Try again in a little while."
        }
    }
}

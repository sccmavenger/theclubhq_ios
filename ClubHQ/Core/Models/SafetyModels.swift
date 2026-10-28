import Foundation

/// Why a member reported a message or conversation. Raw values match `content_reports.reason`
/// on the server (DECISIONS D-041).
enum ReportReason: String, CaseIterable, Identifiable, Sendable {
    case harassment
    case inappropriate
    case spam
    case safety
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .harassment: "Bullying or harassment"
        case .inappropriate: "Inappropriate content"
        case .spam: "Spam"
        case .safety: "A child's safety"
        case .other: "Something else"
        }
    }
}

/// One first-party usage event (D-041): a short name and a few small values, never free text.
/// Stored only in ClubHQ's own database; nothing goes to a third party.
struct UsageEvent: Sendable, Equatable {
    let name: String
    var teamID: UUID?
    var props: [String: String] = [:]
    var at: Date = .now
}

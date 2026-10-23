import Foundation

enum ThreadKind: String, Codable, Sendable { case team, event, direct, group }

enum MessageAudience: String, Codable, CaseIterable, Identifiable, Sendable {
    case both, parents, staff
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .both: "Everyone"
        case .parents: "Parents & staff"
        case .staff: "Staff only"
        }
    }
}

struct MessageThread: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let teamId: UUID
    var kind: ThreadKind
    var eventId: UUID?
    var audience: MessageAudience
    var title: String?
    var pinned: Bool
    var updatedAt: Date
    var lastMessage: String?
    var lastMessageAt: Date?
    var lastAuthorName: String?
    var unread: Bool
    var muted: Bool

    var displayTitle: String {
        if let title, !title.isEmpty { return title }
        switch kind {
        case .event: return "Event discussion"
        case .direct: return "Direct message"
        case .group: return "Group"
        case .team: return "Team message"
        }
    }

    var isTeamChat: Bool { kind == .team && audience == .both && title == "Team chat" }
}

struct ThreadInfo: Codable, Sendable {
    let id: UUID
    var teamId: UUID
    var kind: ThreadKind
    var audience: MessageAudience
    var title: String?
    var canModerate: Bool
    var canPost: Bool
}

struct ChatMessage: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var authorId: UUID
    var authorName: String
    var body: String
    var createdAt: Date
    var editedAt: Date?
    var isDeleted: Bool
    var isMine: Bool
    /// Short-lived signed URL for a chat photo (D-036); nil for text-only messages.
    var imageUrl: URL? = nil
    var imageWidth: Int? = nil
    var imageHeight: Int? = nil

    var hasPhoto: Bool { imageUrl != nil && !isDeleted }
    /// Photo messages may have no caption.
    var hasText: Bool { !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

struct ThreadDetail: Codable, Sendable {
    var thread: ThreadInfo
    var messages: [ChatMessage]
}

struct Announcement: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var teamId: UUID
    var title: String
    var body: String
    var createdAt: Date
    var createdBy: UUID
}

enum NotificationKind: String, Codable, Sendable {
    case announcement, eventCreated = "event_created", eventUpdated = "event_updated"
    case eventReminder = "event_reminder", rsvpReminder = "rsvp_reminder"
    case messageNew = "message_new", eventThreadReply = "event_thread_reply"
    case familyJoined = "family_joined"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotificationKind(rawValue: raw) ?? .unknown
    }

    var symbolName: String {
        switch self {
        case .announcement: "megaphone.fill"
        case .eventCreated, .eventUpdated, .eventReminder: "calendar"
        case .rsvpReminder: "hand.raised.fill"
        case .messageNew, .eventThreadReply: "bubble.left.and.bubble.right.fill"
        case .familyJoined: "person.crop.circle.badge.plus"
        case .unknown: "bell.fill"
        }
    }
}

struct InboxItem: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var linkPath: String?
    var readAt: Date?
    var createdAt: Date
    var kind: NotificationKind
    var subject: String
    var body: String
    var teamId: UUID?
    var refId: UUID?

    var isUnread: Bool { readAt == nil }

    /// Native destination for the web-style link path the server stores.
    var destination: DeepLink? { linkPath.flatMap(DeepLink.init(path:)) }
}

/// In-app navigation targets shared by push notifications, inbox rows, and URLs.
nonisolated enum DeepLink: Hashable, Sendable {
    case event(UUID)
    case thread(UUID)
    case announcements
    case invite(token: String)
    case inbox
    /// Email confirmation / password reset; carries the URL fragment with the session.
    case authCallback(fragment: String)

    /// Parses web-style paths (`/event/<id>`, `/team/messages/<id>`, `/join/<token>`).
    init?(path: String) {
        let parts = path.split(separator: "/").map(String.init)
        switch parts.first {
        case "event" where parts.count >= 2:
            guard let id = UUID(uuidString: parts[1]) else { return nil }
            self = .event(id)
        case "team" where parts.count >= 3 && parts[1] == "messages":
            guard let id = UUID(uuidString: parts[2]) else { return nil }
            self = .thread(id)
        case "join" where parts.count >= 2:
            self = .invite(token: parts[1])
        case "parent", "team":
            self = .announcements
        case "notifications":
            self = .inbox
        default:
            return nil
        }
    }

    /// Parses `clubhq://join/<token>`, `https://teamclubhq.com/join/<token>`, and the auth
    /// callback in both forms (`clubhq://auth-callback#…`, `https://teamclubhq.com/auth/callback#…`).
    init?(url: URL) {
        let isSchemeCallback = url.scheme == AppConfig.urlScheme && url.host() == "auth-callback"
        let isWebCallback = url.scheme == "https" && url.path().hasPrefix("/auth/callback")
        if isSchemeCallback || isWebCallback {
            self = .authCallback(fragment: url.fragment() ?? url.query() ?? "")
            return
        }
        if url.scheme == AppConfig.urlScheme {
            self.init(path: "/\(url.host() ?? "")\(url.path())")
        } else {
            self.init(path: url.path())
        }
    }
}

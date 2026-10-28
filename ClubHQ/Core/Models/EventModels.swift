import Foundation

enum EventType: String, Codable, CaseIterable, Identifiable, Sendable {
    case practice, game, other
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .practice: "Practice"
        case .game: "Game"
        case .other: "Event"
        }
    }

    var symbolName: String {
        switch self {
        case .practice: "figure.run"
        case .game: "trophy.fill"
        case .other: "calendar"
        }
    }
}

enum RSVPStatus: String, Codable, CaseIterable, Identifiable, Sendable {
    case yes, maybe, no
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .yes: "Going"
        case .maybe: "Maybe"
        case .no: "Can't go"
        }
    }

    var symbolName: String {
        switch self {
        case .yes: "checkmark.circle.fill"
        case .maybe: "questionmark.circle.fill"
        case .no: "xmark.circle.fill"
        }
    }
}

enum AttendanceStatus: String, Codable, CaseIterable, Identifiable, Sendable {
    case present, late, absent, excused
    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}

struct TeamEvent: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let teamId: UUID
    var title: String
    var eventType: EventType
    var startsAt: Date
    var endsAt: Date?
    var location: String?
    var locationAddress: String?
    var notes: String?
    var opponent: String?
    var homeAway: String?
    var homeScore: Int?
    var awayScore: Int?
    var result: String?
    var cancelledAt: Date?
    var rsvpCutoffAt: Date?
    /// Set when the game came from a tournament sheet (D-042).
    var importId: UUID? = nil

    var isCancelled: Bool { cancelledAt != nil }
    var isImported: Bool { importId != nil }
    var isPast: Bool { (endsAt ?? startsAt.addingTimeInterval(3600)) < .now }

    /// RSVP lock time: explicit cutoff, else 4 hours before start (DECISIONS D-019).
    var effectiveRSVPCutoff: Date { rsvpCutoffAt ?? startsAt.addingTimeInterval(-RSVPRules.defaultCutoffLead) }

    func isRSVPOpen(now: Date = .now) -> Bool { !isCancelled && now < effectiveRSVPCutoff }

    var displayTitle: String {
        if eventType == .game, let opponent, !opponent.isEmpty {
            return "\(homeAway == "away" ? "@" : "vs") \(opponent)"
        }
        return title
    }

    /// "W 54–48" style result, from our perspective (home score is ours when home).
    var scoreLine: String? {
        guard let homeScore, let awayScore else { return nil }
        let (ours, theirs) = homeAway == "away" ? (awayScore, homeScore) : (homeScore, awayScore)
        let letter = ours > theirs ? "W" : (ours < theirs ? "L" : "T")
        return "\(letter) \(ours)–\(theirs)"
    }
}

enum RSVPRules {
    static let defaultCutoffLead: TimeInterval = 4 * 3600
}

struct RSVP: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var eventId: UUID
    var playerId: UUID
    var status: RSVPStatus
    var note: String?
    var respondedBy: UUID?
    var updatedAt: Date?
}

struct AttendanceRecord: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var eventId: UUID
    var playerId: UUID
    var status: AttendanceStatus
}

/// Everything the event screen needs in one load.
struct EventDetail: Sendable {
    var event: TeamEvent
    var rsvps: [RSVP]
    var attendance: [AttendanceRecord]
    var roster: [Player]

    func rsvp(for playerID: UUID) -> RSVP? { rsvps.first { $0.playerId == playerID } }
    func attendance(for playerID: UUID) -> AttendanceStatus? { attendance.first { $0.playerId == playerID }?.status }

    var counts: (yes: Int, maybe: Int, no: Int, noResponse: Int) {
        let active = roster.filter { $0.archivedAt == nil }
        let yes = active.filter { rsvp(for: $0.id)?.status == .yes }.count
        let maybe = active.filter { rsvp(for: $0.id)?.status == .maybe }.count
        let no = active.filter { rsvp(for: $0.id)?.status == .no }.count
        return (yes, maybe, no, active.count - yes - maybe - no)
    }
}

/// Fields a coach edits when creating/updating an event.
struct EventDraft: Equatable, Sendable {
    var id: UUID?
    var teamId: UUID
    var title = ""
    var eventType: EventType = .practice
    var startsAt: Date
    var endsAt: Date
    var location = ""
    var locationAddress = ""
    var notes = ""
    var opponent = ""
    var isHome = true
    var repeatWeeks = 0

    init(teamId: UUID, start: Date = EventDraft.defaultStart()) {
        self.teamId = teamId
        startsAt = start
        endsAt = start.addingTimeInterval(90 * 60)
    }

    init(event: TeamEvent) {
        id = event.id
        teamId = event.teamId
        title = event.title
        eventType = event.eventType
        startsAt = event.startsAt
        endsAt = event.endsAt ?? event.startsAt.addingTimeInterval(90 * 60)
        location = event.location ?? ""
        locationAddress = event.locationAddress ?? ""
        notes = event.notes ?? ""
        opponent = event.opponent ?? ""
        isHome = event.homeAway != "away"
    }

    var resolvedTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        if eventType == .game, !opponent.isEmpty { return "Game vs \(opponent)" }
        return eventType.displayName
    }

    var isValid: Bool { endsAt > startsAt }

    /// The top of the next hour when that's a plausible practice time (8 AM – 8 PM);
    /// otherwise the next 6 PM, so a late-night "Add Event" doesn't default to midnight.
    static func defaultStart(from date: Date = .now, calendar: Calendar = .current) -> Date {
        let hourStart = calendar.dateInterval(of: .hour, for: date)?.start ?? date
        let next = hourStart.addingTimeInterval(3600)
        if (8...20).contains(calendar.component(.hour, from: next)) { return next }
        let sixToday = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: date) ?? next
        return sixToday > date ? sixToday : calendar.date(byAdding: .day, value: 1, to: sixToday) ?? next
    }
}

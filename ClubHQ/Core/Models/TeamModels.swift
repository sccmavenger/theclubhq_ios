import Foundation

/// Mirrors the `app_role` enum (plus the new `player` value).
enum TeamRole: String, Codable, CaseIterable, Sendable {
    case superAdmin = "super_admin"
    case programDirector = "program_director"
    case headCoach = "head_coach"
    case assistantCoach = "assistant_coach"
    case teamManager = "team_manager"
    case parent
    case player

    var isStaff: Bool { [.headCoach, .assistantCoach, .teamManager, .programDirector, .superAdmin].contains(self) }

    var displayName: String {
        switch self {
        case .superAdmin: "Admin"
        case .programDirector: "Director"
        case .headCoach: "Head Coach"
        case .assistantCoach: "Assistant Coach"
        case .teamManager: "Team Manager"
        case .parent: "Guardian"
        case .player: "Player"
        }
    }
}

/// The three personas the app is designed around (DECISIONS D-007).
enum Persona: String, CaseIterable, Identifiable, Sendable {
    case coach, parent, player
    var id: String { rawValue }

    var title: String {
        switch self {
        case .coach: "Coach"
        case .parent: "Parent"
        case .player: "Player"
        }
    }
}

/// Supported sports (DECISIONS D-013). Unknown server values decode as `.other`.
enum Sport: String, Codable, CaseIterable, Identifiable, Sendable {
    case basketball, soccer, baseball, softball, volleyball, football, hockey, lacrosse, other
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Sport(rawValue: raw) ?? .other
    }

    var displayName: String { rawValue.capitalized }

    var symbolName: String {
        switch self {
        case .basketball: "basketball.fill"
        case .soccer: "soccerball"
        case .baseball, .softball: "baseball.fill"
        case .volleyball: "volleyball.fill"
        case .football: "football.fill"
        case .hockey: "hockey.puck.fill"
        case .lacrosse: "figure.lacrosse"
        case .other: "sportscourt.fill"
        }
    }

    var positions: [String] {
        switch self {
        case .basketball: ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"]
        case .soccer: ["Goalkeeper", "Defender", "Midfielder", "Forward"]
        case .baseball, .softball: ["Pitcher", "Catcher", "First Base", "Second Base", "Third Base", "Shortstop", "Left Field", "Center Field", "Right Field", "Utility"]
        case .volleyball: ["Setter", "Outside Hitter", "Opposite", "Middle Blocker", "Libero", "Defensive Specialist"]
        case .football: ["Quarterback", "Running Back", "Wide Receiver", "Tight End", "Offensive Line", "Defensive Line", "Linebacker", "Defensive Back", "Kicker"]
        case .hockey: ["Goalie", "Defense", "Center", "Wing"]
        case .lacrosse: ["Attack", "Midfield", "Defense", "Goalie"]
        case .other: []
        }
    }
}

/// A roster entry summary as returned in the user's context.
struct PlayerSummary: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let teamId: UUID
    var firstName: String
    var lastName: String
    var jerseyNumber: String?
    var birthdate: String?
    var position: String?

    var fullName: String { "\(firstName) \(lastName)" }
}

/// One team the signed-in user belongs to, with their roles on it.
struct TeamMembership: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var ageGroup: String?
    var season: String?
    var sport: Sport?
    var brandColor: String?
    /// Where families can pay the coach directly (bare handles, no @ or $). DECISIONS D-033.
    var venmoUsername: String?
    var cashappCashtag: String?
    var orgId: UUID?
    var roles: [TeamRole]
    var linkedPlayers: [PlayerSummary]
    var playerSelf: PlayerSummary?
    var isPro: Bool

    // MARK: Capabilities (DECISIONS D-007) — screens ask these, not role names.

    var isHeadCoach: Bool { roles.contains(.headCoach) || roles.contains(.superAdmin) }
    var isStaff: Bool { roles.contains(where: \.isStaff) }
    var isGuardian: Bool { !linkedPlayers.isEmpty || roles.contains(.parent) }
    var isPlayer: Bool { playerSelf != nil || roles.contains(.player) }

    var canManageRoster: Bool { isHeadCoach }
    var canManageSchedule: Bool { isHeadCoach }
    var canPostAnnouncements: Bool { isHeadCoach }
    var canTakeAttendance: Bool { isHeadCoach }
    var canStartThreads: Bool { isStaff }
    var canManageDues: Bool { isHeadCoach }
    var canSeeAllRSVPs: Bool { isStaff }
    /// Two-adult rule (DECISIONS D-009): players never start private conversations.
    var canMessagePrivately: Bool { isStaff || isGuardian }

    /// Players the current user may RSVP for on this team.
    var rsvpPlayers: [PlayerSummary] {
        var players = linkedPlayers
        if let playerSelf, !players.contains(playerSelf) { players.append(playerSelf) }
        return players
    }

    var primaryPersona: Persona {
        if isStaff { return .coach }
        if isGuardian { return .parent }
        return .player
    }

    var subtitle: String {
        [ageGroup, season].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
    }

    var resolvedSport: Sport { sport ?? .basketball }
}

/// Response of `mobile-api` `context`.
struct UserContext: Codable, Sendable {
    let userId: UUID
    var email: String
    var fullName: String?
    var isCoachPro: Bool
    var teams: [TeamMembership]
    /// People this user blocked, kept on the server so blocks follow them to every device (D-041).
    var blockedUserIds: [UUID]? = nil
    /// Reminder switches (D-045); missing from older servers means both on.
    var notificationPrefs: NotificationPrefs? = nil

    var headCoachTeamCount: Int { teams.filter(\.isHeadCoach).count }
    var displayName: String {
        if let fullName, !fullName.trimmingCharacters(in: .whitespaces).isEmpty { return fullName }
        return email.components(separatedBy: "@").first ?? "You"
    }
}

/// Full roster row (`players` table).
struct Player: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let teamId: UUID
    var firstName: String
    var lastName: String
    var jerseyNumber: String?
    var position: String?
    var birthdate: String?
    var notes: String?
    var archivedAt: Date?
    var userId: UUID?

    var fullName: String { "\(firstName) \(lastName)" }
    var initials: String { "\(firstName.prefix(1))\(lastName.prefix(1))".uppercased() }
    var hasAccount: Bool { userId != nil }
}

/// Fields a coach edits on a roster entry.
struct PlayerDraft: Equatable, Sendable {
    var id: UUID?
    var teamId: UUID
    var firstName = ""
    var lastName = ""
    var jerseyNumber = ""
    var position = ""
    var birthdate: Date?
    var notes = ""

    init(teamId: UUID) { self.teamId = teamId }

    init(player: Player) {
        id = player.id
        teamId = player.teamId
        firstName = player.firstName
        lastName = player.lastName
        jerseyNumber = player.jerseyNumber ?? ""
        position = player.position ?? ""
        birthdate = player.birthdate.flatMap(JSONCoding.parseDateOnly)
        notes = player.notes ?? ""
    }

    var isValid: Bool {
        !firstName.trimmingCharacters(in: .whitespaces).isEmpty && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

enum EmergencyRelationship: String, Codable, CaseIterable, Identifiable, Sendable {
    case mother, father, guardian, other
    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}

struct EmergencyContact: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var playerId: UUID
    var relationship: EmergencyRelationship
    var name: String?
    var phone: String
    var email: String?
}

/// A person on the team, with a display name the server is allowed to share.
struct TeamMember: Codable, Identifiable, Hashable, Sendable {
    let userId: UUID
    var name: String
    var roles: [TeamRole]
    var children: [String]
    var id: UUID { userId }

    var roleSummary: String {
        if roles.contains(where: \.isStaff) {
            return roles.filter(\.isStaff).map(\.displayName).joined(separator: ", ")
        }
        if roles.contains(.parent) {
            return children.isEmpty ? "Guardian" : "Guardian of \(children.joined(separator: ", "))"
        }
        return roles.contains(.player) ? "Player" : "Member"
    }
}

/// Input for `create-team`.
struct NewTeamRequest: Equatable, Sendable {
    var teamName = ""
    var sport: Sport = .basketball
    var ageGroup = ""
    var season = ""
    var isClub = false
    var clubName = ""
    /// Optional "How did you hear about ClubHQ?" answer (D-041).
    var heardFrom: AcquisitionSource?
}

/// Answers to "How did you hear about ClubHQ?". Raw values match `profiles.acquisition_source`.
enum AcquisitionSource: String, CaseIterable, Identifiable, Sendable {
    case appStore = "app_store"
    case friendOrCoach = "friend_or_coach"
    case clubOrLeague = "club_or_league"
    case socialMedia = "social_media"
    case webSearch = "web_search"
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .appStore: "Searching the App Store"
        case .friendOrCoach: "A friend or another coach"
        case .clubOrLeague: "My club or league"
        case .socialMedia: "Social media"
        case .webSearch: "A web search"
        case .other: "Somewhere else"
        }
    }
}

/// A child a guardian adds when accepting a team invite.
struct NewChildRequest: Equatable, Sendable {
    var firstName = ""
    var lastName = ""
    var jerseyNumber = ""
    var position = ""
    var birthdate: Date?
    var relationship: EmergencyRelationship = .guardian
    var contactName = ""
    var contactPhone = ""
    var contactEmail = ""
    var contactRelationship: EmergencyRelationship = .guardian

    var isValid: Bool {
        !firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
            && contactPhone.filter(\.isNumber).count >= 7
            && !contactName.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

struct TeamPreview: Codable, Hashable, Sendable {
    let id: UUID
    var name: String
    var ageGroup: String?
    var season: String?
    var sport: Sport?
}

struct InvitePreview: Codable, Sendable {
    /// Set on a co-parent invite: the child the second guardian is joining (D-035).
    struct InvitedPlayer: Codable, Hashable, Sendable {
        let id: UUID
        var firstName: String
    }

    var valid: Bool
    var team: TeamPreview?
    var player: InvitedPlayer?
    var alreadyOnTeam: Bool?
}

struct InviteLink: Codable, Sendable {
    var token: String
    var expiresAt: Date

    var url: URL { AppConfig.webBaseURL.appending(path: "join/\(token)") }

    /// "ABCDE FGHJK": easier to read aloud and type.
    var spacedToken: String {
        guard token.count == 10 else { return token }
        return "\(token.prefix(5)) \(token.suffix(5))"
    }
}

struct PlayerInviteCode: Codable, Sendable {
    var code: String
    var expiresAt: Date
}

struct TeamSponsor: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var teamId: UUID
    var name: String
    var tagline: String?
    var logoUrl: URL?
    var linkUrl: URL?
}

/// Age in whole years on `date`, or nil when no birthdate (COPPA gate, DECISIONS D-008).
enum AgePolicy {
    static let minimumPlayerAccountAge = 13

    static func age(birthdate: String?, on date: Date = .now, calendar: Calendar = .current) -> Int? {
        guard let birthdate, let birth = JSONCoding.parseDateOnly(birthdate) else { return nil }
        return calendar.dateComponents([.year], from: birth, to: date).year
    }

    static func canHaveOwnAccount(birthdate: String?, on date: Date = .now) -> Bool {
        guard let age = age(birthdate: birthdate, on: date) else { return false }
        return age >= minimumPlayerAccountAge
    }
}

/// Which automatic reminders this person gets (D-045). Both default to on.
struct NotificationPrefs: Codable, Hashable, Sendable {
    /// The day before and 2 hours before each event.
    var eventReminders = true
    /// A nudge before the RSVP cutoff when a child hasn't responded.
    var rsvpReminders = true
}

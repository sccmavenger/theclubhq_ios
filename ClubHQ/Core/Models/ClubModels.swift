import Foundation

// Clubs (DECISIONS D-044, docs/CLUBS.md). These mirror the `mobile-api` club actions.

/// A club this person directs (from `context`). Drives the Club tab.
struct ClubSummary: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var brandColor: String?
    var teamCount: Int
}

/// Response of `club-overview`.
struct ClubOverview: Codable, Sendable {
    struct Club: Codable, Hashable, Sendable {
        var id: UUID
        var name: String
        var brandColor: String?
        var timeZone: String?
        /// Code coaches enter in Account → Join a Club.
        var code: String
        var familyCount: Int
    }

    struct Director: Codable, Hashable, Sendable {
        var userId: UUID
        var name: String
    }

    struct ClubEvent: Codable, Hashable, Identifiable, Sendable {
        var clubEventId: UUID
        var title: String
        var eventType: EventType
        var startsAt: Date
        var teamCount: Int
        var id: UUID { clubEventId }
    }

    var club: Club
    var directors: [Director]
    var teams: [ClubTeam]
    var clubEvents: [ClubEvent]

    /// Values present across the club's teams, for the filter menus (sorted naturally).
    func values(_ key: KeyPath<ClubTeam, String?>) -> [String] {
        Array(Set(teams.compactMap { $0[keyPath: key] }.filter { !$0.isEmpty }))
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
}

struct ClubTeam: Codable, Identifiable, Hashable, Sendable {
    struct Coach: Codable, Hashable, Sendable {
        var userId: UUID
        var name: String
        var role: TeamRole
    }

    struct PendingCoach: Codable, Hashable, Sendable {
        var email: String?
        var code: String
        var role: TeamRole
    }

    struct NextEvent: Codable, Hashable, Sendable {
        var id: UUID
        var title: String
        var eventType: EventType
        var opponent: String?
        var homeAway: String?
        var startsAt: Date
        var rsvpCount: Int

        var label: String {
            if eventType == .game, let opponent, !opponent.isEmpty { return "\(homeAway == "away" ? "@" : "vs") \(opponent)" }
            return title
        }
    }

    let id: UUID
    var name: String
    var grade: String?
    var gender: String?
    var level: String?
    var season: String?
    var sport: Sport?
    var coaches: [Coach]
    var pendingCoaches: [PendingCoach]
    var rosterCount: Int
    var familyCount: Int
    var nextEvent: NextEvent?

    var headCoaches: [Coach] { coaches.filter { $0.role == .headCoach } }

    /// "6th · Boys · Gold" — whatever the club filled in.
    var groupingLine: String {
        [ClubGrouping.gradeLabel(grade), gender?.capitalized, level].compactMap { $0 }.joined(separator: " · ")
    }

    /// Needs the director's attention: no coach at all, or nobody has joined yet.
    var needsAttention: Bool { coaches.isEmpty && pendingCoaches.isEmpty }
}

/// Which teams a club message or event goes to. Empty lists mean "any".
struct ClubFilter: Codable, Hashable, Sendable {
    var grades: [String] = []
    var genders: [String] = []
    var levels: [String] = []
    var seasons: [String] = []
    var teamIds: [UUID] = []

    var isEmpty: Bool { grades.isEmpty && genders.isEmpty && levels.isEmpty && seasons.isEmpty && teamIds.isEmpty }

    func matches(_ team: ClubTeam) -> Bool {
        (teamIds.isEmpty || teamIds.contains(team.id))
            && (grades.isEmpty || team.grade.map(grades.contains) == true)
            && (genders.isEmpty || team.gender.map(genders.contains) == true)
            && (levels.isEmpty || team.level.map(levels.contains) == true)
            && (seasons.isEmpty || team.season.map(seasons.contains) == true)
    }
}

/// Response of `club-audience`: who a message or event would reach.
struct ClubAudience: Codable, Hashable, Sendable {
    var teamCount: Int
    var peopleCount: Int
}

/// A team to create (one, or a line of a pasted list).
struct NewClubTeam: Codable, Hashable, Sendable, Identifiable {
    var name: String
    var grade: String?
    var gender: String?
    var level: String?
    var season: String?
    var coachEmail: String?
    var id: String { [name, grade, gender, level, season, coachEmail].compactMap { $0 }.joined(separator: "|") }
}

/// Result of putting a coach on a team.
struct CoachAssignment: Codable, Hashable, Sendable {
    enum Status: String, Codable, Sendable { case assigned, invited }
    var status: Status
    var email: String
    /// One-time code for a coach who isn't on ClubHQ yet.
    var code: String?
}

struct CreatedClubTeam: Codable, Hashable, Sendable, Identifiable {
    var teamId: UUID
    var name: String
    var coach: CoachAssignment?
    /// Ready-to-send text with the coach code, for the share sheet.
    var inviteText: String?
    var id: UUID { teamId }
}

/// Response of `lookup-club-invite`.
struct ClubInvitePreview: Codable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable { case clubCode = "club_code", coach }
    struct MovableTeam: Codable, Hashable, Sendable, Identifiable {
        var id: UUID
        var name: String
    }
    var kind: Kind
    var clubName: String
    var teamName: String?
    var role: TeamRole?
    /// Teams the caller head-coaches that could move into the club.
    var movableTeams: [MovableTeam]
}

enum ClubGrouping {
    /// "6" → "6th"; anything else as typed ("U12", "2033", "JV").
    static func gradeLabel(_ grade: String?) -> String? {
        guard let grade, !grade.isEmpty else { return nil }
        guard let n = Int(grade) else { return grade }
        let suffix = (11...13).contains(n % 100) ? "th" : (["th", "st", "nd", "rd"] + Array(repeating: "th", count: 6))[n % 10]
        return "\(n)\(suffix)"
    }

    /// Section title for a grade group in the Club tab.
    static func gradeSection(_ grade: String?) -> String {
        guard let label = gradeLabel(grade) else { return "Other teams" }
        return Int(grade ?? "") != nil ? "\(label) Grade" : label
    }

    /// Parses a pasted team list: one team per line, comma- or tab-separated:
    /// `Name, grade, gender, level, season, coach email`. Columns after the name are optional;
    /// an email in any column is taken as the coach.
    nonisolated static func parseTeamList(_ text: String) -> [NewClubTeam] {
        text.split(whereSeparator: \.isNewline).compactMap { line in
            let cells = line.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "\t" })
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard let name = cells.first, !name.isEmpty, name.lowercased() != "name", name.lowercased() != "team" else { return nil }
            var rest = Array(cells.dropFirst())
            let email = rest.first { $0.contains("@") }
            rest.removeAll { $0.contains("@") }
            func at(_ i: Int) -> String? { i < rest.count && !rest[i].isEmpty ? rest[i] : nil }
            let grade = at(0).map { $0.replacingOccurrences(of: #"(?i)(st|nd|rd|th)( grade)?$"#, with: "", options: .regularExpression) }
            return NewClubTeam(name: name, grade: grade, gender: at(1).flatMap(normalizeGender), level: at(2), season: at(3), coachEmail: email)
        }
    }

    nonisolated static func normalizeGender(_ value: String) -> String? {
        switch value.lowercased() {
        case "boys", "boy", "b", "m", "male": "boys"
        case "girls", "girl", "g", "f", "female": "girls"
        case "coed", "co-ed", "mixed": "coed"
        default: nil
        }
    }
}

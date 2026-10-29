import Foundation

// Tournament schedule import from a Google Sheets link (DECISIONS D-042).
// These mirror `mobile-api` `import-preview` / `import-commit`.

/// Everything the server read from a tournament sheet, plus its best guess at the coach's team.
struct ImportPreview: Codable, Sendable {
    struct Source: Codable, Hashable, Sendable {
        var url: String
        /// "google_sheet", "cnr_league" (D-043) or "ical" (D-047). Older servers don't send it.
        var kind: String?
        var title: String
        var sheetTitle: String?
        /// Zone the tournament's times are in (from the venue addresses), e.g. "America/Chicago".
        var timeZone: String
        var dates: [String]
        var homeNote: String?
        var tabCount: Int
        /// The sheet only says "Sat"/"Sun" and nothing gives the dates; ask the coach.
        var needsDates: Bool
        /// Calendar feeds: the app it came from ("TeamSnap", "GameChanger"…).
        var provider: String? = nil
        /// Something the coach should know, e.g. all-day items that weren't included.
        var notice: String? = nil
    }

    enum Outcome: String, Codable, Sendable {
        /// One team stands out: ask "Is this your team?"
        case clear
        /// A few close candidates: ask "Which one is yours?"
        case choices
        /// No good guess: show the full list.
        case none
    }

    struct Match: Codable, Hashable, Sendable {
        var outcome: Outcome
        var teamKeys: [String]
    }

    struct PreviousImport: Codable, Hashable, Sendable {
        var id: UUID
        var teamKey: String
        var alias: String?
        var eventCount: Int
    }

    var source: Source
    var match: Match
    var teams: [ImportTeam]
    var brackets: [ImportBracket]
    var games: [ImportGame]
    var previousImport: PreviousImport?
    /// Keys of games already on the schedule from an earlier import of this link that the coach
    /// kept ("Keep Games, Remove from List"). Importing updates them.
    var keptKeys: [String]? = nil
    var existingEvents: [ImportExistingEvent]

    var timeZone: TimeZone { TimeZone(identifier: source.timeZone) ?? .current }

    /// League sites list every team but load one team's games at a time.
    var isLeague: Bool { source.kind == "cnr_league" }
    /// A team calendar feed (D-047): one team, games plus practices and other events.
    var isCalendar: Bool { source.kind == "ical" }
    /// The league site and organizers who say "team on the right is home" (D-042, D-043).
    var homeIsRight: Bool { isLeague || source.homeNote != nil }

    /// Adds games loaded for another team (league sources), keeping what we already have.
    mutating func merge(_ other: ImportPreview) {
        let known = Set(games.map(\.key))
        games += other.games.filter { !known.contains($0.key) }
        for team in other.teams where team.gameCount != nil {
            if let i = teams.firstIndex(where: { $0.key == team.key }) { teams[i].gameCount = team.gameCount }
        }
        let existing = Set(existingEvents.map(\.id))
        existingEvents += other.existingEvents.filter { !existing.contains($0.id) }
        keptKeys = Array(Set((keptKeys ?? []) + (other.keptKeys ?? [])))
    }

    func team(_ key: String) -> ImportTeam? { teams.first { $0.key == key } }
    func bracket(for team: ImportTeam) -> ImportBracket? { brackets.first { $0.name == team.bracket } }

    /// The team's games; `alias` is a bracket-tab name the coach said is theirs.
    func games(for teamKey: String, alias: String? = nil) -> [ImportGame] {
        let team = team(teamKey)
        let aliasName = alias?.lowercased()
        return games
            .filter { game in
                if game.left.teamKey == teamKey || game.right.teamKey == teamKey { return true }
                guard let aliasName, let team, game.bracket == team.bracket else { return false }
                return game.left.name.lowercased() == aliasName || game.right.name.lowercased() == aliasName
            }
            .sorted { ($0.startsAt ?? .distantFuture) < ($1.startsAt ?? .distantFuture) }
    }

    /// Teams grouped by bracket for the full list, in sheet order.
    var teamsByBracket: [(title: String, teams: [ImportTeam])] {
        var order: [String] = []
        var groups: [String: [ImportTeam]] = [:]
        for team in teams {
            let title = team.bracketTitle ?? team.bracket ?? "Other teams"
            if groups[title] == nil { order.append(title) }
            groups[title, default: []].append(team)
        }
        // League divisions read best in grade order ("2nd Boys" … "8th Girls"); sheets keep their tab order.
        if isLeague { order.sort { $0.localizedStandardCompare($1) == .orderedAscending } }
        return order.map { ($0, groups[$0]!.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }) }
    }

    /// Existing events that overlap a game (same team, within the game's hour).
    func clashes(with game: ImportGame) -> [ImportExistingEvent] {
        guard let start = game.startsAt else { return [] }
        let end = start.addingTimeInterval(60 * 60)
        return existingEvents.filter { event in
            let eventEnd = event.endsAt ?? event.startsAt.addingTimeInterval(90 * 60)
            return event.startsAt < end && eventEnd > start
        }
    }
}

struct ImportTeam: Codable, Identifiable, Hashable, Sendable {
    var key: String
    var name: String
    /// "6", "9" (freshmen), "jv", "varsity".
    var grade: String?
    var gender: String?
    var coach: String?
    var bracket: String?
    var bracketTitle: String?
    /// Nil when the games haven't been loaded yet (league teams load when picked).
    var gameCount: Int?

    var id: String { key }

    /// "6th Boys · Coach Danny Guillory"
    var detailLine: String {
        var parts: [String] = []
        let level = [ScheduleImportText.gradeLabel(grade), gender?.capitalized].compactMap { $0 }.joined(separator: " ")
        if !level.isEmpty { parts.append(level) }
        if let coach, !coach.isEmpty { parts.append("Coach \(coach)") }
        return parts.joined(separator: " · ")
    }

    var gameCountLabel: String? {
        guard let gameCount else { return nil }
        return gameCount == 1 ? "1 game" : "\(gameCount) games"
    }
}

struct ImportBracket: Codable, Hashable, Sendable {
    var name: String
    var title: String
    /// Names in the bracket tab that didn't connect to a listed team.
    var unmatchedNames: [String]
}

struct ImportGame: Codable, Identifiable, Hashable, Sendable {
    struct Side: Codable, Hashable, Sendable {
        var name: String
        var teamKey: String?
        var score: Int?
        var placeholder: Bool
    }

    var key: String
    var bracket: String
    var round: String?
    var left: Side
    var right: Side
    var startsAt: Date?
    var dayLabel: String
    var timeLabel: String
    var location: String?
    var venueName: String?
    var address: String?
    var court: String?
    /// "game", "practice" or "other". Calendar feeds (D-047) have all three; older servers send nothing.
    var eventType: String? = nil
    /// The calendar's own title ("Practice", "Hawks vs Lions").
    var title: String? = nil
    /// "home"/"away" when the calendar says so.
    var homeAway: String? = nil

    var id: String { key }

    var isGame: Bool { eventType == nil || eventType == "game" }

    func ourSide(teamKey: String, alias: String?) -> (us: Side, them: Side) {
        if left.teamKey == teamKey { return (left, right) }
        if right.teamKey == teamKey { return (right, left) }
        if let alias, left.name.lowercased() == alias.lowercased() { return (left, right) }
        return (right, left)
    }

    /// "Beal Center · Court 6"
    var placeLabel: String? {
        guard let venueName else { return location }
        return court.map { "\(venueName) · Court \($0)" } ?? venueName
    }

    /// "vs X", or "@ X" when we're the away team (`homeIsRight`: the source puts the home team on the right).
    func opponentLabel(teamKey: String, alias: String?, homeIsRight: Bool = false) -> String {
        let (us, them) = ourSide(teamKey: teamKey, alias: alias)
        if !isGame { return title ?? "Event" }
        if them.placeholder { return homeAway == nil ? "Opponent TBD (\(them.name))" : "Game · opponent TBD" }
        if let homeAway { return homeAway == "away" ? "@ \(them.name)" : "vs \(them.name)" }
        return homeIsRight && us == left ? "@ \(them.name)" : "vs \(them.name)"
    }

    /// "W 50–24" from our side, when both scores are in.
    func scoreLine(teamKey: String, alias: String?) -> String? {
        let (us, them) = ourSide(teamKey: teamKey, alias: alias)
        guard let ours = us.score, let theirs = them.score else { return nil }
        let letter = ours > theirs ? "W" : (ours < theirs ? "L" : "T")
        return "\(letter) \(ours)–\(theirs)"
    }
}

struct ImportExistingEvent: Codable, Identifiable, Hashable, Sendable {
    var id: UUID
    var title: String
    var eventType: EventType
    var opponent: String?
    var homeAway: String?
    var startsAt: Date
    var endsAt: Date?

    var displayTitle: String {
        if eventType == .game, let opponent, !opponent.isEmpty { return "\(homeAway == "away" ? "@" : "vs") \(opponent)" }
        return title
    }
}

/// Response of `import-commit`.
struct ImportResult: Codable, Hashable, Sendable {
    var importId: UUID
    var added: Int
    var updated: Int
    /// Games from a different team (picked earlier) that were swapped out.
    var removed: Int
    /// Games the organizer deleted from the sheet.
    var cancelled: Int
    /// Games whose date couldn't be worked out.
    var skipped: Int
    /// Games still to be played: these can be announced to families.
    var upcoming: Int
    var eventIds: [UUID]
    /// Check for Changes on a team calendar told families what changed (D-047).
    var notified: Bool? = nil
}

/// A link the team imported from (`schedule_imports`).
struct ScheduleImportInfo: Codable, Identifiable, Hashable, Sendable {
    var id: UUID
    var teamId: UUID
    var sourceUrl: String
    var title: String
    var sheetTeamKey: String
    var sheetTeamName: String
    var sheetAlias: String?
    var lastImportedAt: Date
    /// The import's games (start times only), embedded by PostgREST.
    var events: [GameTime]? = nil

    struct GameTime: Codable, Hashable, Sendable {
        var startsAt: Date
        var cancelledAt: Date? = nil
    }

    /// Every game has been played (or cancelled), so there's nothing left to check for.
    func isFinished(now: Date = .now) -> Bool {
        let games = events ?? []
        return !games.isEmpty && !games.contains { $0.cancelledAt == nil && $0.startsAt.addingTimeInterval(3600) > now }
    }
}

enum ImportReportReason: String, Codable, CaseIterable, Identifiable, Sendable {
    case teamMissing = "team_missing", gamesWrong = "games_wrong", unreadable, other
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .teamMissing: "My team isn't listed"
        case .gamesWrong: "My games are wrong"
        case .unreadable: "The sheet didn't load"
        case .other: "Something else"
        }
    }
}

/// Small text helpers shared by the import screens.
enum ScheduleImportText {
    /// "6" → "6th", "9" → "Freshmen", "jv" → "JV".
    static func gradeLabel(_ grade: String?) -> String? {
        guard let grade else { return nil }
        switch grade {
        case "9": return "Freshmen"
        case "jv": return "JV"
        case "varsity": return "Varsity"
        default:
            guard let n = Int(grade) else { return grade }
            let suffix = (11...13).contains(n % 100) ? "th" : (["th", "st", "nd", "rd"] + Array(repeating: "th", count: 6))[n % 10]
            return "\(n)\(suffix)"
        }
    }

    /// The grade in a ClubHQ team's name or age group ("3D Nation 6th Grade" → "6"), matching the server's rules.
    static func grade(in text: String?) -> String? {
        guard let text = text?.lowercased() else { return nil }
        if let match = text.firstMatch(of: /\b(\d{1,2})(st|nd|rd|th)\b/), let n = Int(match.1), (1...12).contains(n) { return String(n) }
        if text.contains("freshm") || text.contains("frosh") { return "9" }
        if text.firstMatch(of: /\bjv\b/) != nil { return "jv" }
        if text.contains("varsity") { return "varsity" }
        return nil
    }

    static func gender(in text: String?) -> String? {
        guard let text = text?.lowercased() else { return nil }
        if text.firstMatch(of: /\b(girls?|women|ladies)\b/) != nil { return "girls" }
        if text.firstMatch(of: /\b(boys?|men)\b/) != nil { return "boys" }
        return nil
    }

    /// True when the text looks like a Google Sheets link (the server checks properly).
    static func looksLikeSheetLink(_ text: String) -> Bool {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return url.host() == "docs.google.com" && url.path().contains("/spreadsheets/")
    }

    /// True for CNR league links (cnr….stlbasketball.com pages and webcal feeds).
    static func looksLikeLeagueLink(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "webcal://", with: "https://")
        guard let host = URL(string: trimmed)?.host()?.lowercased() else { return false }
        return host.hasPrefix("cnr") && host.hasSuffix(".stlbasketball.com")
    }
}

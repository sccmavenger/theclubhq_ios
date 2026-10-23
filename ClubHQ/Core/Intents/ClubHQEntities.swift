import AppIntents
import Foundation

// App Intents entities (DECISIONS D-039). Siri, Shortcuts, Spotlight and widgets all refer to
// ClubHQ data through these. IDs are the server UUIDs, so saved shortcuts survive reinstalls and
// work on every device. Never change what an entity's `id` means.

// MARK: - Team

struct TeamEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Team"
    static let defaultQuery = TeamQuery()

    let id: UUID
    @Property(title: "Name") var name: String
    @Property(title: "Sport") var sport: String
    var subtitle: String
    var symbolName: String

    @MainActor init(team: TeamMembership) {
        id = team.id
        subtitle = team.subtitle
        symbolName = team.resolvedSport.symbolName
        name = team.name
        sport = team.resolvedSport.displayName
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: subtitle.isEmpty ? "\(sport)" : "\(subtitle)",
            image: DisplayRepresentation.Image(systemName: symbolName)
        )
    }
}

struct TeamQuery: EntityStringQuery {
    @Dependency private var model: AppModel

    func entities(for identifiers: [UUID]) async throws -> [TeamEntity] {
        let ids = Set(identifiers)
        return await model.intentTeams().filter { ids.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [TeamEntity] {
        await model.intentTeams().filter { $0.name.localizedStandardContains(string) }
    }

    /// A family has a handful of teams, so suggesting all of them stays cheap.
    func suggestedEntities() async throws -> [TeamEntity] {
        await model.intentTeams()
    }
}

// MARK: - Child

/// A player the signed-in user can RSVP for: their own child, or themself as a 13+ player.
/// One child on two teams is two roster rows, so two entities (each says which team).
struct ChildEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Player"
    static let defaultQuery = ChildQuery()

    let id: UUID
    let teamID: UUID
    @Property(title: "Name") var name: String
    @Property(title: "Team") var teamName: String

    @MainActor init(player: PlayerSummary, team: TeamMembership) {
        id = player.id
        teamID = team.id
        name = player.fullName
        teamName = team.name
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(teamName)",
            image: DisplayRepresentation.Image(systemName: "person.fill")
        )
    }
}

struct ChildQuery: EntityStringQuery {
    @Dependency private var model: AppModel

    func entities(for identifiers: [UUID]) async throws -> [ChildEntity] {
        let ids = Set(identifiers)
        return await model.intentChildren().filter { ids.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [ChildEntity] {
        await model.intentChildren().filter { $0.name.localizedStandardContains(string) }
    }

    func suggestedEntities() async throws -> [ChildEntity] {
        await model.intentChildren()
    }
}

// MARK: - Event

struct EventEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Event"
    static let defaultQuery = EventQuery()

    let id: UUID
    let teamID: UUID
    @Property(title: "Title") var title: String
    @Property(title: "Starts") var startsAt: Date
    @Property(title: "Location") var location: String?
    @Property(title: "Team") var teamName: String
    @Property(title: "Cancelled") var isCancelled: Bool
    var symbolName: String

    @MainActor init(event: TeamEvent, teamName: String) {
        id = event.id
        teamID = event.teamId
        symbolName = event.eventType.symbolName
        title = event.displayTitle
        startsAt = event.startsAt
        location = event.location
        self.teamName = teamName
        isCancelled = event.isCancelled
    }

    var displayRepresentation: DisplayRepresentation {
        let when = startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
        let place = location.map { " · \($0)" } ?? ""
        return DisplayRepresentation(
            title: isCancelled ? "\(title) (cancelled)" : "\(title)",
            subtitle: "\(teamName) · \(when)\(place)",
            image: DisplayRepresentation.Image(systemName: symbolName)
        )
    }
}

struct EventQuery: EntityStringQuery {
    @Dependency private var model: AppModel

    /// Saved shortcuts can point at past events, so resolve against a window that reaches back.
    func entities(for identifiers: [UUID]) async throws -> [EventEntity] {
        let ids = Set(identifiers)
        let since = Date.now.addingTimeInterval(-180 * 24 * 3600)
        return try await model.intentEvents(from: since).filter { ids.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [EventEntity] {
        try await model.intentEvents(from: .now).filter {
            $0.title.localizedStandardContains(string)
                || $0.teamName.localizedStandardContains(string)
                || ($0.location?.localizedStandardContains(string) ?? false)
        }
    }

    /// The next few upcoming events: what someone is most likely to pick.
    func suggestedEntities() async throws -> [EventEntity] {
        Array(try await model.intentEvents(from: .now).filter { !$0.isCancelled }.prefix(15))
    }
}

// MARK: - Data access

extension AppModel {
    func intentTeams() async -> [TeamEntity] {
        await contextForIntents()?.teams.map(TeamEntity.init(team:)) ?? []
    }

    func intentChildren() async -> [ChildEntity] {
        let teams = await contextForIntents()?.teams ?? []
        return teams.flatMap { team in team.rsvpPlayers.map { ChildEntity(player: $0, team: team) } }
    }

    /// Events on every team the user belongs to, soonest first, in one backend call.
    func intentEvents(from start: Date) async throws -> [EventEntity] {
        let teams = await contextForIntents()?.teams ?? []
        guard !teams.isEmpty else { return [] }
        let names = Dictionary(uniqueKeysWithValues: teams.map { ($0.id, $0.name) })
        let events = try await backend.events(teamIDs: teams.map(\.id), from: start, to: nil)
        return events
            .sorted { $0.startsAt < $1.startsAt }
            .map { EventEntity(event: $0, teamName: names[$0.teamId] ?? "") }
    }
}

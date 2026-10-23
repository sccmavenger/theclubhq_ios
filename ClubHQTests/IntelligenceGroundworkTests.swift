import Foundation
import Testing
@testable import ClubHQ

/// Phase 0 of the Apple Intelligence track (D-039): the fixture set Phase 1 is scored against,
/// the availability gate, and the App Intents data access. None of these need the model.
@MainActor
struct IntelligenceGroundworkTests {

    // MARK: - Schedule-import fixtures

    struct FixtureFile: Decodable {
        let samples: [Sample]
    }

    struct Sample: Decodable {
        let id: String
        let category: String
        let source: String
        let referenceDate: String
        let text: String
        let teamHint: String?
        let expected: [ExpectedEvent]
    }

    struct ExpectedEvent: Decodable {
        let type: String
        let start: String
        let end: String?
        let location: String?
        let opponent: String?
    }

    private final class BundleToken {}

    static func loadFixtures() throws -> [Sample] {
        let bundle = Bundle(for: BundleToken.self)
        let url = try #require(bundle.url(forResource: "schedule-import-text", withExtension: "json"))
        return try JSONDecoder().decode(FixtureFile.self, from: Data(contentsOf: url)).samples
    }

    /// Local wall-clock times, exactly as a flyer states them.
    static func parseLocal(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = string.contains("T") ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"
        return formatter.date(from: string)
    }

    @Test func fixturesAreWellFormed() throws {
        let samples = try Self.loadFixtures()
        #expect(samples.count >= 10)
        #expect(Set(samples.map(\.id)).count == samples.count, "Sample ids must be unique")
        for sample in samples {
            #expect(["golden", "edge", "adversarial"].contains(sample.category), "\(sample.id)")
            #expect(Self.parseLocal(sample.referenceDate) != nil, "\(sample.id) referenceDate")
            #expect(!sample.text.isEmpty, "\(sample.id) text")
            for event in sample.expected {
                #expect(EventType(rawValue: event.type) != nil, "\(sample.id) type \(event.type)")
                let start = try #require(Self.parseLocal(event.start), "\(sample.id) start")
                if let end = event.end {
                    let endDate = try #require(Self.parseLocal(end), "\(sample.id) end")
                    #expect(endDate > start, "\(sample.id) ends after it starts")
                }
            }
        }
    }

    /// Phase 1 is only meaningful if the set covers each kind of input (Evaluations guidance).
    @Test func fixturesCoverEveryCategory() throws {
        let samples = try Self.loadFixtures()
        let byCategory = Dictionary(grouping: samples, by: \.category)
        #expect(byCategory["golden", default: []].count >= 3)
        #expect(byCategory["edge", default: []].count >= 3)
        #expect(byCategory["adversarial", default: []].count >= 2)
        #expect(samples.contains { $0.expected.isEmpty }, "Needs samples where the right answer is no events")
    }

    // MARK: - Availability gate

    @Test(arguments: [IntelligenceStatus.available, .notEnabled, .notReady, .notEligible])
    func availabilityGate(status: IntelligenceStatus) {
        switch status {
        case .available:
            #expect(status.isAvailable && status.showsEntryPoint && status.explanation == nil)
        case .notEnabled, .notReady:
            #expect(!status.isAvailable && status.showsEntryPoint && status.explanation != nil)
        case .notEligible:
            #expect(!status.isAvailable && !status.showsEntryPoint && status.explanation == nil)
        }
    }

    // MARK: - App Intents data access

    @Test func parentEntitiesComeFromTheirTeams() async throws {
        let model = AppModel(backend: DemoBackend(persona: .parent, latency: .zero))
        // No `start()`: intents can run before it, so the helpers must load the context themselves.

        let teams = await model.intentTeams()
        #expect(!teams.isEmpty)
        #expect(Set(teams.map(\.id)) == Set(model.teams.map(\.id)))

        let children = await model.intentChildren()
        let expectedChildren = model.teams.flatMap(\.rsvpPlayers).map(\.id)
        #expect(!children.isEmpty)
        #expect(children.map(\.id) == expectedChildren)

        let events = try await model.intentEvents(from: .now)
        #expect(!events.isEmpty)
        #expect(events.map(\.startsAt) == events.map(\.startsAt).sorted(), "Soonest first")
        #expect(events.allSatisfy { event in teams.contains { $0.id == event.teamID } })
        #expect(events.allSatisfy { !$0.teamName.isEmpty })
    }

    @Test func signedOutUserHasNoEntities() async throws {
        let model = AppModel(backend: DemoBackend(persona: nil, latency: .zero))
        #expect(await model.intentTeams().isEmpty)
        #expect(await model.intentChildren().isEmpty)
        #expect(try await model.intentEvents(from: .now).isEmpty)
    }
}

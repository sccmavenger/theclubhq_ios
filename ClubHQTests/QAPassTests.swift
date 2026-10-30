import Foundation
import Testing
@testable import ClubHQ

/// Fixes from the first full test pass (exploratory pass on the simulator, D-052).
@MainActor
struct QAPassTests {
    @Test func rsvpCutoffIsFourHoursBeforeWhenThereIsTime() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let tomorrow = now.addingTimeInterval(30 * 3600)
        #expect(RSVPRules.cutoff(forStart: tomorrow, now: now) == tomorrow.addingTimeInterval(-4 * 3600))
    }

    @Test func sameDayEventStaysOpenUntilItStarts() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let tonight = now.addingTimeInterval(3 * 3600) // less than 4 hours' notice
        #expect(RSVPRules.cutoff(forStart: tonight, now: now) == tonight)
    }

    @Test func demoEventCreatedTodayTakesRSVPs() async throws {
        let demo = DemoBackend(persona: .coach)
        let teamID = try #require(try await demo.loadContext().teams.first?.id)
        var draft = EventDraft(teamId: teamID)
        draft.startsAt = .now.addingTimeInterval(45 * 60)
        draft.endsAt = draft.startsAt.addingTimeInterval(3600)
        let ids = try await demo.saveEvent(draft)
        let event = try await demo.eventDetail(eventID: try #require(ids.first)).event
        #expect(event.isRSVPOpen(), "An event 45 minutes away should still take RSVPs")
    }
}

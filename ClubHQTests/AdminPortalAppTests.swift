import Foundation
import Testing
@testable import ClubHQ

/// App-side pieces of the admin portal launch gate (D-041): usage batching, reports and blocks,
/// and the suspension error.
@MainActor
struct AdminPortalAppTests {

    // MARK: - Usage tracker

    @Test func trackerDoesNothingWhenDisabled() async {
        let tracker = UsageTracker(batchSize: 2, delay: .seconds(60))
        var sent: [UsageEvent] = []
        tracker.send = { sent += $0 }
        tracker.track("paywall.viewed")
        await tracker.flush()
        #expect(sent.isEmpty)
        #expect(tracker.pending.isEmpty)
    }

    @Test func trackerSendsQueuedEventsOnFlush() async {
        let tracker = UsageTracker(batchSize: 10, delay: .seconds(60))
        var sent: [UsageEvent] = []
        tracker.isEnabled = { true }
        tracker.send = { sent += $0 }
        let team = UUID()
        tracker.track("tour.finished", teamID: team, props: ["persona": "coach"])
        tracker.track("paywall.viewed")
        await tracker.flush()
        #expect(sent.map(\.name) == ["tour.finished", "paywall.viewed"])
        #expect(sent.first?.teamID == team)
        #expect(sent.first?.props["persona"] == "coach")
        #expect(tracker.pending.isEmpty)
    }

    @Test func trackerKeepsEventsWhenSendingFails() async {
        struct Offline: Error {}
        let tracker = UsageTracker(batchSize: 10, delay: .seconds(60))
        tracker.isEnabled = { true }
        tracker.send = { _ in throw Offline() }
        tracker.track("calendar_sync.opened")
        await tracker.flush()
        #expect(tracker.pending.map(\.name) == ["calendar_sync.opened"])
    }

    @Test func trackerCapsTheQueue() {
        let tracker = UsageTracker(batchSize: 1_000, delay: .seconds(60))
        tracker.isEnabled = { true }
        for i in 0..<250 { tracker.track("event.\(i)") }
        #expect(tracker.pending.count == 200)
        #expect(tracker.pending.first?.name == "event.50") // oldest dropped first
        tracker.reset()
    }

    // MARK: - Reports and blocks (Demo backend)

    @Test func demoReportsAndBlocks() async throws {
        let backend = DemoBackend(persona: .parent, latency: .zero)
        let context = try await backend.loadContext()
        let teamID = try #require(context.teams.first?.id)
        let threadID = try await backend.teamChatThreadID(teamID: teamID)
        let detail = try await backend.threadDetail(threadID: threadID, since: nil)
        let other = try #require(detail.messages.first { !$0.isMine })

        try await backend.reportMessage(id: other.id, reason: .harassment, note: nil)
        await #expect(throws: BackendError.self) {
            try await backend.reportConversation(threadID: threadID, reason: .other, note: "   ")
        }
        try await backend.reportConversation(threadID: threadID, reason: .other, note: "Something happened")

        #expect(try await backend.blockUser(id: other.authorId) == [other.authorId])
        #expect(try await backend.unblockAllUsers().isEmpty)
        let me = try #require(backend.currentUserID)
        await #expect(throws: BackendError.self) { _ = try await backend.blockUser(id: me) }
    }

    @Test func suspensionCodesAreRecognized() {
        let fromAPI = BackendError.from(status: 403, code: "account_suspended", message: "This account has been suspended.")
        let fromAuth = BackendError.from(status: 400, code: "user_banned", message: "User is banned")
        #expect(fromAPI.isSuspended)
        #expect(fromAuth.isSuspended)
        #expect(fromAuth.localizedDescription.contains("suspended"))
        #expect(!BackendError.unauthorized.isSuspended)
    }

    @Test func contextDecodesBlockedUsers() throws {
        let blocked = UUID()
        let json = """
        {"user_id":"\(UUID().uuidString)","email":"a@b.c","full_name":null,"is_coach_pro":false,"teams":[],"blocked_user_ids":["\(blocked.uuidString)"]}
        """
        let context = try JSONCoding.decoder.decode(UserContext.self, from: Data(json.utf8))
        #expect(context.blockedUserIds == [blocked])
        let older = try JSONCoding.decoder.decode(UserContext.self, from: Data(#"{"user_id":"\#(UUID().uuidString)","email":"a@b.c","is_coach_pro":false,"teams":[]}"#.utf8))
        #expect(older.blockedUserIds == nil)
    }
}

import Foundation

/// First-party usage analytics (DECISIONS D-041). Records UI-only moments the server can't see
/// on its own (a paywall viewed, the tour finished) and sends them in small batches to
/// ClubHQ's own database. No third-party SDK, no advertising identifiers, no free text.
/// Server-side actions (events created, messages posted, …) are recorded by the server itself.
final class UsageTracker {
    /// Sends a batch; set by `AppModel` to the current backend.
    var send: (([UsageEvent]) async throws -> Void)?
    /// Tracking happens only with a signed-in, non-demo account.
    var isEnabled: () -> Bool = { false }

    private(set) var pending: [UsageEvent] = []
    private var flushTask: Task<Void, Never>?
    private let batchSize: Int
    private let delay: Duration
    /// Kept small: analytics must never grow memory or retry forever while offline.
    private let maxPending = 200

    init(batchSize: Int = 20, delay: Duration = .seconds(20)) {
        self.batchSize = batchSize
        self.delay = delay
    }

    func track(_ name: String, teamID: UUID? = nil, props: [String: String] = [:]) {
        guard isEnabled() else { return }
        pending.append(UsageEvent(name: name, teamID: teamID, props: props))
        if pending.count > maxPending { pending.removeFirst(pending.count - maxPending) }
        if pending.count >= batchSize {
            Task { await flush() }
        } else if flushTask == nil {
            flushTask = Task { [weak self, delay] in
                try? await Task.sleep(for: delay)
                await self?.flush()
            }
        }
    }

    /// Sends everything queued now (also called when the app goes to the background or signs out).
    func flush() async {
        flushTask?.cancel()
        flushTask = nil
        guard !pending.isEmpty, let send else { return }
        let batch = Array(pending.prefix(50))
        pending.removeFirst(batch.count)
        do {
            try await send(batch)
        } catch {
            // Offline or a server hiccup: keep the batch for the next flush.
            pending.insert(contentsOf: batch, at: 0)
            if pending.count > maxPending { pending.removeLast(pending.count - maxPending) }
        }
    }

    func reset() {
        flushTask?.cancel()
        flushTask = nil
        pending.removeAll()
    }
}

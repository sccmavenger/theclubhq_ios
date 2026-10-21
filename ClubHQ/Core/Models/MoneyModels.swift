import Foundation

enum DuesStatus: String, Codable, Sendable {
    case unpaid, processing, paid, waived

    var displayName: String {
        switch self {
        case .unpaid: "Unpaid"
        case .processing: "Processing"
        case .paid: "Paid"
        case .waived: "Waived"
        }
    }

    var isSettled: Bool { self == .paid || self == .waived }
}

struct DuesItem: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var playerId: UUID
    var amountCents: Int
    var status: DuesStatus
    var paidAt: Date?
    var playerName: String
}

struct DuesRequest: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var title: String
    var description: String?
    var amountCents: Int
    var dueDate: String?
    var createdAt: Date
    var items: [DuesItem]

    var collectedCents: Int { items.filter { $0.status == .paid }.reduce(0) { $0 + $1.amountCents } }
    var expectedCents: Int { items.filter { $0.status != .waived }.reduce(0) { $0 + $1.amountCents } }
    var unpaidItems: [DuesItem] { items.filter { $0.status == .unpaid } }
    var progress: Double { expectedCents == 0 ? 1 : Double(collectedCents) / Double(expectedCents) }
    var dueDateValue: Date? { dueDate.flatMap(JSONCoding.parseDateOnly) }
}

struct DuesOverview: Codable, Sendable {
    struct FeePolicy: Codable, Sendable { var percentBps: Int; var flatCents: Int }
    var paymentsEnabled: Bool
    var paymentsConnected: Bool
    var fee: FeePolicy
    var requests: [DuesRequest]
}

struct CheckoutSession: Codable, Sendable {
    var url: URL
    var subtotalCents: Int
    var feeCents: Int
    var totalCents: Int
}

/// ClubHQ's all-in, per-checkout family fee (DECISIONS D-011).
/// Must match `checkoutFeeCents` in `supabase/functions/_shared/stripe.ts`.
enum DuesFee {
    static let percentBasisPoints = 290
    static let flatCents = 79

    static func fee(forSubtotal subtotal: Int) -> Int {
        guard subtotal > 0 else { return 0 }
        let percent = (Double(subtotal) * Double(percentBasisPoints) / 10_000).rounded()
        return Int(percent) + flatCents
    }

    static var disclosure: String { "2.9% + $0.79 per checkout" }
}

enum Money {
    static func format(cents: Int, currencyCode: String = "USD") -> String {
        (Decimal(cents) / 100).formatted(.currency(code: currencyCode))
    }

    /// Parses user input like "125", "$125.50", "125.5" into cents.
    static func cents(from text: String) -> Int? {
        let cleaned = text.filter { $0.isNumber || $0 == "." }
        guard !cleaned.isEmpty, let value = Decimal(string: cleaned) else { return nil }
        var cents = value * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &cents, 0, .plain)
        return NSDecimalNumber(decimal: rounded).intValue
    }
}

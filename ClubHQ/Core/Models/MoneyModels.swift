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

/// Venmo / Cash App links for paying the coach directly (DECISIONS D-033).
///
/// Neither app offers an official payments API, so these are the public link formats:
/// `venmo.com/<username>?txn=pay&amount=&note=` and `cash.app/$<cashtag>/<amount>`. They open
/// the app when installed and the website otherwise. Venmo pre-fills amount and note; Cash App
/// only the amount. Rules must match `paymentHandle()` in `supabase/functions/mobile-api`.
nonisolated enum PaymentHandles {
    /// Bare Venmo username from "@name", "name", or a pasted venmo.com link; nil if invalid.
    static func venmoUsername(from raw: String) -> String? {
        let handle = bareHandle(raw)
        return handle.wholeMatch(of: /[A-Za-z0-9_-]{5,30}/) != nil ? handle : nil
    }

    /// Bare $Cashtag from "$name", "name", or a pasted cash.app link; nil if invalid.
    static func cashtag(from raw: String) -> String? {
        let handle = bareHandle(raw)
        let valid = handle.wholeMatch(of: /[A-Za-z0-9]{1,20}/) != nil && handle.contains(where: \.isLetter)
        return valid ? handle : nil
    }

    static func venmoURL(username: String, cents: Int, note: String) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "venmo.com"
        components.path = "/\(username)"
        components.queryItems = [
            URLQueryItem(name: "txn", value: "pay"),
            URLQueryItem(name: "amount", value: amountString(cents)),
            URLQueryItem(name: "note", value: note),
        ]
        return components.url
    }

    static func cashAppURL(cashtag: String, cents: Int) -> URL? {
        URL(string: "https://cash.app/$\(cashtag)/\(amountString(cents))")
    }

    /// "1000" for whole dollars, otherwise "1000.50".
    static func amountString(_ cents: Int) -> String {
        cents % 100 == 0 ? "\(cents / 100)" : String(format: "%d.%02d", cents / 100, cents % 100)
    }

    private static func bareHandle(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        text = text.replacing(/^https?:\/\//.ignoresCase(), with: "")
        text = text.replacing(/^(www\.)?(venmo\.com\/(u\/)?|cash\.app\/)/.ignoresCase(), with: "")
        text = String(text.prefix { !"/?#".contains($0) })
        if text.first == "@" || text.first == "$" { text.removeFirst() }
        return text
    }
}

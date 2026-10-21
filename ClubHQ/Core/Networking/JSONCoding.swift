import Foundation

/// Shared JSON coders. The backend speaks snake_case (PostgREST rows and `mobile-api`
/// responses alike), so one decoder works everywhere.
enum JSONCoding {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = parseTimestamp(raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognized date: \(raw)")
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatTimestamp(date))
        }
        return encoder
    }()

    /// Parses Postgres `timestamptz` output (`2026-10-13 12:00:00.123456+00`, `...T...+00:00`),
    /// JavaScript `toISOString()` output (`...123Z`), and plain dates (`2026-10-13`).
    nonisolated static func parseTimestamp(_ raw: String) -> Date? {
        var value = raw.trimmingCharacters(in: .whitespaces)
        if value.count == 10 {
            return dateOnlyFormatter.date(from: value)
        }
        value = value.replacingOccurrences(of: " ", with: "T")
        // Normalize "+00" → "+00:00" so ISO8601 parsing accepts it.
        if let range = value.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
            value.replaceSubrange(range, with: value[range] + ":00")
        }
        // Trim fractional seconds to milliseconds; the formatter rejects microseconds.
        if let dot = value.firstIndex(of: "."),
           let end = value[dot...].firstIndex(where: { $0 == "Z" || $0 == "+" || $0 == "-" }) {
            let fraction = value[value.index(after: dot)..<end]
            let millis = String(fraction.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
            value.replaceSubrange(value.index(after: dot)..<end, with: millis)
        }
        return fractionalFormatter.date(from: value) ?? plainFormatter.date(from: value)
    }

    nonisolated static func formatTimestamp(_ date: Date) -> String {
        fractionalFormatter.string(from: date)
    }

    /// `yyyy-MM-dd` for Postgres `date` columns. These are *calendar days* (due dates,
    /// birthdates), so they use the device's time zone — a UTC formatter shifts the
    /// displayed day by one in the Americas.
    nonisolated static func formatDateOnly(_ date: Date) -> String {
        dateOnlyFormatter.string(from: date)
    }

    nonisolated static func parseDateOnly(_ raw: String) -> Date? {
        dateOnlyFormatter.date(from: raw)
    }

    nonisolated(unsafe) private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let plainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    nonisolated private static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

/// Lets `mobile-api` actions take loosely-typed parameter dictionaries without
/// declaring a struct per call.
enum JSONValue: Encodable, Sendable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral {
    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .int(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }

    static func optional(_ value: String?) -> JSONValue {
        guard let value, !value.isEmpty else { return .null }
        return .string(value)
    }

    static func uuid(_ value: UUID) -> JSONValue { .string(value.uuidString.lowercased()) }
    static func date(_ value: Date) -> JSONValue { .string(JSONCoding.formatTimestamp(value)) }
}

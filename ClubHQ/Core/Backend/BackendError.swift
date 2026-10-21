import Foundation

/// Errors surfaced to the UI. `code` values mirror `mobile-api`'s stable error codes.
enum BackendError: LocalizedError, Equatable {
    case unauthorized
    case network(String)
    case decoding(String)
    case upgradeRequired(String)
    case notConfigured(String)
    case server(status: Int, code: String, message: String)

    static func from(status: Int, code: String, message: String) -> BackendError {
        switch code {
        case "upgrade_required": .upgradeRequired(message)
        case "not_configured": .notConfigured(message)
        default: .server(status: status, code: code, message: message)
        }
    }

    var code: String {
        switch self {
        case .unauthorized: "unauthorized"
        case .network: "network"
        case .decoding: "decoding"
        case .upgradeRequired: "upgrade_required"
        case .notConfigured: "not_configured"
        case .server(_, let code, _): code
        }
    }

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Your session ended. Please sign in again."
        case .network: "You appear to be offline. Check your connection and try again."
        case .decoding: "Something unexpected came back from the server. Please update the app or try again."
        case .upgradeRequired(let message): message
        case .notConfigured: "This feature isn't set up on the server yet."
        case .server(_, let code, let message):
            Self.friendlyAuthMessages[code] ?? message
        }
    }

    /// Plain-English text for Supabase Auth error codes people actually hit.
    private static let friendlyAuthMessages: [String: String] = [
        "invalid_credentials": "That email and password don't match.",
        "email_not_confirmed": "Please confirm your email first. We just sent you a new code.",
        "otp_expired": "That code is wrong or has expired. Check the latest email or tap Resend.",
        "over_email_send_rate_limit": "Too many emails were sent just now. Please wait a minute and try again.",
        "over_request_rate_limit": "Too many attempts. Please wait a minute and try again.",
        "weak_password": "Choose a stronger password — at least 8 characters.",
        "user_already_exists": "An account with this email already exists. Try signing in.",
        "email_address_invalid": "That email address doesn't look right.",
        "signup_disabled": "New sign-ups are paused right now. Please try again later.",
    ]

    var isEmailNotConfirmed: Bool { code == "email_not_confirmed" }

    var isUpgradeRequired: Bool {
        if case .upgradeRequired = self { return true }
        return false
    }
}

import Foundation

/// Persisted Supabase auth session.
struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userID: UUID
    var email: String?

    var isExpiringSoon: Bool { expiresAt.timeIntervalSinceNow < 60 }

    // Explicit keys: the shared snake_case coders would turn `user_id` back into `userId`,
    // not `userID`, so a saved session could never be read back (users signed out on relaunch).
    enum CodingKeys: String, CodingKey {
        case accessToken, refreshToken, expiresAt, email
        case userID = "userId"
    }
}

/// Thin async/await client over Supabase's HTTP APIs (DECISIONS D-004):
/// GoTrue (`/auth/v1`), PostgREST (`/rest/v1`), and Edge Functions (`/functions/v1`).
@Observable
final class SupabaseClient {
    let baseURL: URL
    let publishableKey: String
    private(set) var session: AuthSession?

    @ObservationIgnored private let urlSession: URLSession
    @ObservationIgnored private let keychain: KeychainStore
    @ObservationIgnored private var refreshTask: Task<AuthSession, Error>?
    private static let sessionKey = "supabase.session"

    init(baseURL: URL, publishableKey: String, urlSession: URLSession = .shared, keychain: KeychainStore = KeychainStore()) {
        self.baseURL = baseURL
        self.publishableKey = publishableKey
        self.urlSession = urlSession
        self.keychain = keychain
        if let data = keychain.data(for: Self.sessionKey) {
            session = try? JSONCoding.decoder.decode(AuthSession.self, from: data)
        }
    }

    // MARK: - Auth

    struct TokenResponse: Decodable {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int
        let user: AuthUser
    }

    struct AuthUser: Decodable {
        let id: UUID
        let email: String?
    }

    /// Sign-up returns either a session (email confirmation off) or just the user.
    private struct SignUpResponse: Decodable {
        let accessToken: String?
        let refreshToken: String?
        let expiresIn: Int?
        let user: AuthUser?
        let id: UUID?
    }

    func signIn(email: String, password: String) async throws {
        let response: TokenResponse = try await authRequest(
            path: "token", query: [URLQueryItem(name: "grant_type", value: "password")],
            body: ["email": .string(email), "password": .string(password)]
        )
        store(response)
    }

    /// Returns `true` when a session was created, `false` when email confirmation is required.
    func signUp(email: String, password: String, fullName: String) async throws -> Bool {
        let response: SignUpResponse = try await authRequest(
            path: "signup", query: [Self.redirectItem],
            body: [
                "email": .string(email),
                "password": .string(password),
                "data": .object(["full_name": .string(fullName)]),
            ]
        )
        if let access = response.accessToken, let refresh = response.refreshToken,
           let expires = response.expiresIn, let user = response.user {
            store(TokenResponse(accessToken: access, refreshToken: refresh, expiresIn: expires, user: user))
            return true
        }
        return false
    }

    /// Sign in with Apple via the OIDC `id_token` grant (DECISIONS D-015).
    func signInWithApple(idToken: String, nonce: String) async throws {
        let response: TokenResponse = try await authRequest(
            path: "token", query: [URLQueryItem(name: "grant_type", value: "id_token")],
            body: ["provider": "apple", "id_token": .string(idToken), "nonce": .string(nonce)]
        )
        store(response)
    }

    func sendPasswordReset(email: String) async throws {
        let _: EmptyResponse = try await authRequest(path: "recover", query: [Self.redirectItem], body: ["email": .string(email)])
    }

    /// Email links land on teamclubhq.com/auth/callback, which hands the session to the app.
    /// Must be in the project's Auth → URL Configuration → Redirect URLs allow-list.
    private static var redirectItem: URLQueryItem {
        URLQueryItem(name: "redirect_to", value: AppConfig.authRedirectURL.absoluteString)
    }

    enum RedirectKind: String { case signup, recovery, magiclink, invite, emailChange = "email_change", unknown }

    /// Completes an email-link redirect whose URL fragment carries the session
    /// (`access_token=…&refresh_token=…&expires_in=…&type=…`).
    @discardableResult
    func completeRedirect(fragment: String) async throws -> RedirectKind {
        var items: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? String($0) }
            if parts.count == 2 { items[parts[0]] = parts[1] }
        }
        if let description = items["error_description"] {
            throw BackendError.server(status: 400, code: items["error_code"] ?? "link_invalid",
                                      message: description.replacingOccurrences(of: "+", with: " "))
        }
        guard let access = items["access_token"], let refresh = items["refresh_token"] else {
            throw BackendError.server(status: 400, code: "link_invalid", message: "This link is incomplete. Request a new one from the app.")
        }
        // Resolve the user behind the token (also proves the token is valid).
        var request = URLRequest(url: baseURL.appending(path: "auth/v1/user"))
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        let user: AuthUser = try await send(request)
        store(TokenResponse(accessToken: access, refreshToken: refresh, expiresIn: Int(items["expires_in"] ?? "") ?? 3600, user: user))
        return RedirectKind(rawValue: items["type"] ?? "") ?? .unknown
    }

    /// What a 6-digit email code is for. `email` confirms a sign-up; `recovery` resets a password.
    enum EmailCodePurpose: String { case signup = "email", recovery }

    /// Verifies a 6-digit email code and signs the user in (DECISIONS D-029).
    func verifyEmailCode(email: String, code: String, purpose: EmailCodePurpose) async throws {
        let response: TokenResponse = try await authRequest(
            path: "verify", query: [],
            body: ["type": .string(purpose.rawValue), "email": .string(email), "token": .string(code)]
        )
        store(response)
    }

    /// Sends a fresh sign-up confirmation code.
    func resendSignupCode(email: String) async throws {
        let _: EmptyResponse = try await authRequest(path: "resend", query: [], body: ["type": "signup", "email": .string(email)])
    }

    /// Sets a new password for the signed-in user (after a recovery link).
    func updatePassword(_ password: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "auth/v1/user"))
        request.httpMethod = "PUT"
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(try await validAccessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])
        let _: EmptyResponse = try await send(request)
    }

    func signOut() async {
        if let token = session?.accessToken {
            var request = URLRequest(url: baseURL.appending(path: "auth/v1/logout"))
            request.httpMethod = "POST"
            request.setValue(publishableKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await urlSession.data(for: request)
        }
        clearSession()
    }

    func clearSession() {
        session = nil
        keychain.remove(Self.sessionKey)
    }

    /// A valid access token, refreshing first if needed. Concurrent callers share one refresh.
    func validAccessToken() async throws -> String {
        guard let current = session else { throw BackendError.unauthorized }
        if !current.isExpiringSoon { return current.accessToken }
        if let refreshTask { return try await refreshTask.value.accessToken }
        let task = Task { () throws -> AuthSession in
            let response: TokenResponse = try await authRequest(
                path: "token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                body: ["refresh_token": .string(current.refreshToken)]
            )
            return store(response)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            return try await task.value.accessToken
        } catch BackendError.server(let status, _, _) where status == 400 || status == 401 {
            clearSession() // refresh token revoked or expired
            throw BackendError.unauthorized
        }
    }

    @discardableResult
    private func store(_ response: TokenResponse) -> AuthSession {
        let newSession = AuthSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(response.expiresIn)),
            userID: response.user.id,
            email: response.user.email
        )
        session = newSession
        if let data = try? JSONCoding.encoder.encode(newSession) {
            keychain.set(data, for: Self.sessionKey)
        }
        return newSession
    }

    private func authRequest<T: Decodable>(path: String, query: [URLQueryItem], body: [String: JSONValue]) async throws -> T {
        var url = baseURL.appending(path: "auth/v1/\(path)")
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    // MARK: - PostgREST

    enum Method: String { case get = "GET", post = "POST", patch = "PATCH", delete = "DELETE" }

    /// GET rows from PostgREST. `query` uses PostgREST syntax, e.g. `("team_id", "eq.<uuid>")`.
    func rest<T: Decodable>(_ table: String, query: [(String, String)] = []) async throws -> T {
        try await rest(.get, table, query: query)
    }

    /// Query PostgREST with an explicit method and optional body.
    func rest<T: Decodable>(
        _ method: Method,
        _ table: String,
        query: [(String, String)] = [],
        body: (any Encodable)? = nil,
        prefer: String? = nil
    ) async throws -> T {
        var url = baseURL.appending(path: "rest/v1/\(table)")
        if !query.isEmpty { url.append(queryItems: query.map { URLQueryItem(name: $0.0, value: $0.1) }) }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        try await authorize(&request)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONCoding.encoder.encode(body)
        }
        request.setValue(prefer ?? "return=representation", forHTTPHeaderField: "Prefer")
        return try await send(request)
    }

    /// Fire-and-forget variant for writes whose response body we don't need.
    func restWrite(
        _ method: Method,
        _ table: String,
        query: [(String, String)] = [],
        body: (any Encodable)? = nil,
        prefer: String = "return=minimal"
    ) async throws {
        let _: EmptyResponse = try await rest(method, table, query: query, body: body, prefer: prefer)
    }

    // MARK: - Edge Functions

    /// Calls `mobile-api` (DECISIONS D-005) with `{ "action": action, ...params }`.
    func invoke<T: Decodable>(_ action: String, _ params: [String: JSONValue] = [:]) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: "functions/v1/mobile-api"))
        request.httpMethod = "POST"
        try await authorize(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload = params
        payload["action"] = .string(action)
        request.httpBody = try JSONEncoder().encode(payload)
        return try await send(request)
    }

    // MARK: - Storage

    /// PUTs bytes to a Storage signed upload URL (the `uploadToSignedUrl` contract). The
    /// token in the URL authorizes the upload; `mobile-api` issued it after its own checks.
    func uploadToSignedURL(_ url: URL, data: Data, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        request.httpBody = data
        let _: EmptyResponse = try await send(request)
    }

    // MARK: - Transport

    private func authorize(_ request: inout URLRequest) async throws {
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(try await validAccessToken())", forHTTPHeaderField: "Authorization")
    }

    /// Decodes a value that may arrive as a string or a number (GoTrue's `code` is numeric,
    /// PostgREST's is a string like "42501").
    private struct LooseString: Decodable {
        let value: String
        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let string = try? container.decode(String.self) { value = string }
            else { value = String(try container.decode(Int.self)) }
        }
    }

    private struct ErrorEnvelope: Decodable {
        struct Inner: Decodable { let code: String?; let message: String? }
        let error: Inner?
        // GoTrue / PostgREST shapes
        let msg: String?
        let message: String?
        let errorDescription: String?
        let errorCode: String?
        let code: LooseString?
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw BackendError.network(error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let envelope = try? JSONCoding.decoder.decode(ErrorEnvelope.self, from: data)
            let code = envelope?.error?.code ?? envelope?.errorCode ?? envelope?.code?.value ?? "http_\(status)"
            let message = envelope?.error?.message ?? envelope?.errorDescription ?? envelope?.msg ?? envelope?.message
                ?? HTTPURLResponse.localizedString(forStatusCode: status)
            if status == 401 && code != "invalid_credentials" { throw BackendError.unauthorized }
            throw BackendError.from(status: status, code: code, message: message)
        }
        if let empty = EmptyResponse() as? T { return empty }
        do {
            return try JSONCoding.decoder.decode(T.self, from: data)
        } catch {
            throw BackendError.decoding("\(T.self): \(error)")
        }
    }
}

struct EmptyResponse: Decodable {}

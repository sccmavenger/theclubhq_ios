import Foundation
import Testing
@testable import ClubHQ

/// App-side fixes from the 2026-10-30 security/QA review (D-050).
@MainActor
@Suite(.serialized)
struct SecurityReviewTests {
    /// Answers `auth/v1/user` with whichever user the test sets.
    final class StubAuthServer: URLProtocol {
        nonisolated(unsafe) static var userID = UUID()
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            let body = Data(#"{"id":"\#(Self.userID.uuidString)","email":"someone@example.com"}"#.utf8)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private func makeClient() -> SupabaseClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubAuthServer.self]
        // Its own keychain service, so the test never touches a real saved session.
        let keychain = KeychainStore(service: "app.clubhq.tests.\(UUID().uuidString)")
        return SupabaseClient(baseURL: URL(string: "https://example.supabase.co")!, publishableKey: "test",
                              urlSession: URLSession(configuration: config), keychain: keychain)
    }

    @Test func authLinkForAnotherAccountCantReplaceTheSignedInOne() async throws {
        let client = makeClient()
        defer { client.clearSession() }
        let parent = UUID()
        StubAuthServer.userID = parent
        try await client.completeRedirect(fragment: "access_token=a&refresh_token=b&expires_in=3600&type=signup")
        #expect(client.session?.userID == parent)

        // A link someone else crafted: their tokens, for their account.
        StubAuthServer.userID = UUID()
        await #expect(throws: BackendError.self) {
            try await client.completeRedirect(fragment: "access_token=x&refresh_token=y&expires_in=3600&type=magiclink")
        }
        #expect(client.session?.userID == parent)
    }

    @Test func authLinkForTheSameAccountStillWorks() async throws {
        let client = makeClient()
        defer { client.clearSession() }
        let parent = UUID()
        StubAuthServer.userID = parent
        try await client.completeRedirect(fragment: "access_token=a&refresh_token=b&expires_in=3600&type=signup")
        // A password-reset link for the same person refreshes the session.
        let kind = try await client.completeRedirect(fragment: "access_token=c&refresh_token=d&expires_in=3600&type=recovery")
        #expect(kind == .recovery)
        #expect(client.session?.accessToken == "c")
    }

    /// Sign-out stops this account's pushes on the phone (demo backend records nothing, so this
    /// checks the live path is wired: the protocol requires the call).
    @Test func backendsCanUnregisterADevice() async throws {
        try await DemoBackend().unregisterDevice(token: String(repeating: "a", count: 64))
    }
}

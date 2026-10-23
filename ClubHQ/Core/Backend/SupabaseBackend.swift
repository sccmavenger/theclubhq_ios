import Foundation

/// Production backend: PostgREST for RLS-safe reads/writes, `mobile-api` for anything
/// privileged or aggregated (DECISIONS D-005).
final class SupabaseBackend: ClubHQBackend {
    let client: SupabaseClient
    let isDemo = false

    init(client: SupabaseClient) {
        self.client = client
    }

    /// Backend built from `AppConfig`, or nil when no Supabase project is configured.
    static func fromAppConfig() -> SupabaseBackend? {
        guard AppConfig.isBackendConfigured, let url = URL(string: AppConfig.supabaseURL) else { return nil }
        return SupabaseBackend(client: SupabaseClient(baseURL: url, publishableKey: AppConfig.supabasePublishableKey))
    }

    var currentUserID: UUID? { client.session?.userID }
    var hasSession: Bool { client.session != nil }

    private func uid() throws -> String {
        guard let id = currentUserID else { throw BackendError.unauthorized }
        return id.uuidString.lowercased()
    }

    private func eq(_ id: UUID) -> String { "eq.\(id.uuidString.lowercased())" }
    private func inList(_ ids: [UUID]) -> String { "in.(\(ids.map { $0.uuidString.lowercased() }.joined(separator: ",")))" }

    // MARK: - Auth

    func signIn(email: String, password: String) async throws {
        try await client.signIn(email: email, password: password)
    }

    func signUp(fullName: String, email: String, password: String) async throws -> SignUpOutcome {
        let signedIn = try await client.signUp(email: email, password: password, fullName: fullName)
        if signedIn { try? await updateProfile(fullName: fullName) }
        return signedIn ? .signedIn : .confirmEmail
    }

    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws {
        try await client.signInWithApple(idToken: idToken, nonce: nonce)
        // Apple only shares the name on first authorization — persist it right away.
        if let fullName, !fullName.isEmpty { try? await updateProfile(fullName: fullName) }
    }

    func sendPasswordReset(email: String) async throws {
        try await client.sendPasswordReset(email: email)
    }

    func verifyEmailCode(email: String, code: String, isRecovery: Bool) async throws {
        try await client.verifyEmailCode(email: email, code: code, purpose: isRecovery ? .recovery : .signup)
    }

    func resendSignupCode(email: String) async throws {
        try await client.resendSignupCode(email: email)
    }

    func setPlayerBirthdate(playerID: UUID, birthdate: Date) async throws {
        let _: OK = try await client.invoke("set-player-birthdate", [
            "player_id": .uuid(playerID), "birthdate": .string(JSONCoding.formatDateOnly(birthdate)),
        ])
    }

    func completeAuthRedirect(fragment: String) async throws -> Bool {
        try await client.completeRedirect(fragment: fragment) == .recovery
    }

    func updatePassword(_ password: String) async throws {
        try await client.updatePassword(password)
    }

    func signOut() async {
        await client.signOut()
    }

    func deleteAccount() async throws {
        let _: OK = try await client.invoke("delete-account")
        client.clearSession()
    }

    // MARK: - Context & teams

    func loadContext() async throws -> UserContext {
        try await client.invoke("context")
    }

    func updateProfile(fullName: String) async throws {
        let _: OK = try await client.invoke("update-profile", ["full_name": .string(fullName)])
    }

    func createTeam(_ request: NewTeamRequest) async throws -> UUID {
        struct Created: Decodable { let teamId: UUID }
        let created: Created = try await client.invoke("create-team", [
            "team_name": .string(request.teamName),
            "sport": .string(request.sport.rawValue),
            "age_group": .optional(request.ageGroup),
            "season": .optional(request.season),
            "org_type": .string(request.isClub ? "club" : "independent"),
            "org_name": .optional(request.isClub ? request.clubName : request.teamName),
        ])
        return created.teamId
    }

    func updateTeamColor(teamID: UUID, hex: String?) async throws {
        let _: OK = try await client.invoke("update-team", ["team_id": .uuid(teamID), "brand_color": .optional(hex)])
    }

    func updatePaymentHandles(teamID: UUID, venmoUsername: String?, cashappCashtag: String?) async throws {
        // Empty string clears the handle on the server.
        let _: OK = try await client.invoke("update-team", [
            "team_id": .uuid(teamID),
            "venmo_username": .string(venmoUsername ?? ""),
            "cashapp_cashtag": .string(cashappCashtag ?? ""),
        ])
    }

    func createInvite(teamID: UUID) async throws -> InviteLink {
        try await client.invoke("create-invite", ["team_id": .uuid(teamID)])
    }

    func lookupInvite(token: String) async throws -> InvitePreview {
        try await client.invoke("lookup-invite", ["token": .string(token)])
    }

    func claimInvite(token: String, child: NewChildRequest, allowDuplicate: Bool) async throws -> UUID {
        struct Claimed: Decodable { let teamId: UUID }
        let claimed: Claimed = try await client.invoke("claim-invite", [
            "token": .string(token),
            "allow_duplicate": .bool(allowDuplicate),
            "child": .object([
                "first_name": .string(child.firstName),
                "last_name": .string(child.lastName),
                "jersey_number": .optional(child.jerseyNumber),
                "position": .optional(child.position),
                "birthdate": .optional(child.birthdate.map(JSONCoding.formatDateOnly)),
                "parent_relationship": .string(child.relationship.rawValue),
                "contacts": .array([.object([
                    "relationship": .string(child.contactRelationship.rawValue),
                    "name": .optional(child.contactName),
                    "phone": .string(child.contactPhone),
                    "email": .optional(child.contactEmail),
                ])]),
            ]),
        ])
        return claimed.teamId
    }

    func claimGuardianInvite(token: String, relationship: EmergencyRelationship) async throws -> UUID {
        struct Claimed: Decodable { let teamId: UUID }
        let claimed: Claimed = try await client.invoke("claim-invite", [
            "token": .string(token),
            "parent_relationship": .string(relationship.rawValue),
        ])
        return claimed.teamId
    }

    func createGuardianInvite(playerID: UUID) async throws -> InviteLink {
        try await client.invoke("create-guardian-invite", ["player_id": .uuid(playerID)])
    }

    func createPlayerInvite(playerID: UUID) async throws -> PlayerInviteCode {
        try await client.invoke("create-player-invite", ["player_id": .uuid(playerID)])
    }

    func claimPlayerInvite(code: String) async throws -> UUID {
        struct Claimed: Decodable { let teamId: UUID }
        let claimed: Claimed = try await client.invoke("claim-player-invite", ["code": .string(code)])
        return claimed.teamId
    }

    func teamMembers(teamID: UUID) async throws -> [TeamMember] {
        struct Response: Decodable { let members: [TeamMember] }
        let response: Response = try await client.invoke("team-members", ["team_id": .uuid(teamID)])
        return response.members.sorted { $0.name < $1.name }
    }

    func sponsors(teamID: UUID) async throws -> [TeamSponsor] {
        let today = JSONCoding.formatDateOnly(.now)
        // Tolerate the table not existing yet (migration not applied) — sponsors are optional.
        return (try? await client.rest("team_sponsors", query: [
            ("team_id", eq(teamID)),
            ("starts_on", "lte.\(today)"),
            ("or", "(ends_on.is.null,ends_on.gte.\(today))"),
        ])) ?? []
    }

    // MARK: - Roster

    func roster(teamID: UUID) async throws -> [Player] {
        try await client.rest("players", query: [
            ("team_id", eq(teamID)),
            ("archived_at", "is.null"),
            ("order", "last_name.asc,first_name.asc"),
        ])
    }

    func savePlayer(_ draft: PlayerDraft) async throws {
        var row: [String: JSONValue] = [
            "first_name": .string(draft.firstName.trimmingCharacters(in: .whitespaces)),
            "last_name": .string(draft.lastName.trimmingCharacters(in: .whitespaces)),
            "jersey_number": .optional(draft.jerseyNumber),
            "position": .optional(draft.position),
            "birthdate": .optional(draft.birthdate.map(JSONCoding.formatDateOnly)),
            "notes": .optional(draft.notes),
        ]
        if let id = draft.id {
            try await client.restWrite(.patch, "players", query: [("id", eq(id))], body: row)
        } else {
            row["team_id"] = .uuid(draft.teamId)
            row["created_by"] = .string(try uid())
            try await client.restWrite(.post, "players", body: row)
        }
    }

    func archivePlayer(id: UUID) async throws {
        try await client.restWrite(.patch, "players", query: [("id", eq(id))], body: ["archived_at": JSONValue.date(.now)])
    }

    func emergencyContacts(playerID: UUID) async throws -> [EmergencyContact] {
        try await client.rest("player_emergency_contacts", query: [("player_id", eq(playerID)), ("order", "created_at.asc")])
    }

    // MARK: - Schedule

    func events(teamIDs: [UUID], from: Date, to: Date?) async throws -> [TeamEvent] {
        guard !teamIDs.isEmpty else { return [] }
        var query: [(String, String)] = [
            ("team_id", inList(teamIDs)),
            ("starts_at", "gte.\(JSONCoding.formatTimestamp(from))"),
            ("order", "starts_at.asc"),
            ("limit", "200"),
        ]
        if let to { query.append(("starts_at", "lt.\(JSONCoding.formatTimestamp(to))")) }
        return try await client.rest("events", query: query)
    }

    func eventDetail(eventID: UUID) async throws -> EventDetail {
        let events: [TeamEvent] = try await client.rest("events", query: [("id", eq(eventID))])
        guard let event = events.first else {
            throw BackendError.server(status: 404, code: "not_found", message: "This event is no longer available.")
        }
        async let rsvps: [RSVP] = client.rest("rsvps", query: [("event_id", eq(eventID))])
        async let attendance: [AttendanceRecord] = client.rest("attendance", query: [("event_id", eq(eventID))])
        async let roster = roster(teamID: event.teamId)
        return try await EventDetail(event: event, rsvps: rsvps, attendance: attendance, roster: roster)
    }

    func myRSVPs(eventIDs: [UUID]) async throws -> [RSVP] {
        guard !eventIDs.isEmpty else { return [] }
        return try await client.rest("rsvps", query: [("event_id", inList(eventIDs))])
    }

    func saveEvent(_ draft: EventDraft) async throws -> [UUID] {
        struct Saved: Decodable { let eventIds: [UUID] }
        var params: [String: JSONValue] = [
            "team_id": .uuid(draft.teamId),
            "title": .string(draft.resolvedTitle),
            "event_type": .string(draft.eventType.rawValue),
            "starts_at": .date(draft.startsAt),
            "ends_at": .date(draft.endsAt),
            "location": .optional(draft.location),
            "location_address": .optional(draft.locationAddress),
            "notes": .optional(draft.notes),
        ]
        if draft.eventType == .game {
            params["opponent"] = .optional(draft.opponent)
            params["home_away"] = .string(draft.isHome ? "home" : "away")
        }
        if let id = draft.id {
            params["event_id"] = .uuid(id)
        } else if draft.repeatWeeks > 0 {
            params["repeat_weeks"] = .int(draft.repeatWeeks)
        }
        let saved: Saved = try await client.invoke("save-event", params)
        return saved.eventIds
    }

    func cancelEvent(id: UUID) async throws {
        let _: OK = try await client.invoke("cancel-event", ["event_id": .uuid(id)])
    }

    func setRSVP(eventID: UUID, playerID: UUID, status: RSVPStatus, note: String?) async throws {
        let _: OK = try await client.invoke("set-rsvp", [
            "event_id": .uuid(eventID),
            "player_id": .uuid(playerID),
            "status": .string(status.rawValue),
            "note": .optional(note),
        ])
    }

    func setAttendance(eventID: UUID, entries: [UUID: AttendanceStatus]) async throws {
        guard !entries.isEmpty else { return }
        let marker = try uid()
        let rows: [[String: JSONValue]] = entries.map { playerID, status in
            [
                "event_id": .uuid(eventID),
                "player_id": .uuid(playerID),
                "status": .string(status.rawValue),
                "marked_by": .string(marker),
            ]
        }
        try await client.restWrite(
            .post, "attendance", query: [("on_conflict", "event_id,player_id")], body: rows,
            prefer: "resolution=merge-duplicates,return=minimal"
        )
    }

    func setScore(eventID: UUID, homeScore: Int, awayScore: Int) async throws {
        let rows: [TeamEvent] = try await client.rest("events", query: [("id", eq(eventID))])
        var event = rows.first
        event?.homeScore = homeScore
        event?.awayScore = awayScore
        let result: JSONValue
        switch event?.scoreLine?.first {
        case "W": result = .string("win")
        case "L": result = .string("loss")
        case .some: result = .string("tie")
        case nil: result = .null
        }
        try await client.restWrite(.patch, "events", query: [("id", eq(eventID))], body: [
            "home_score": JSONValue.int(homeScore),
            "away_score": .int(awayScore),
            "result": result,
        ])
    }

    func teamAttendance(teamID: UUID) async throws -> [AttendanceRecord] {
        try await client.rest("attendance", query: [
            ("select", "id,event_id,player_id,status,events!inner(team_id)"),
            ("events.team_id", eq(teamID)),
            ("limit", "5000"),
        ])
    }

    // MARK: - Messaging

    func threads(teamID: UUID) async throws -> [MessageThread] {
        struct Response: Decodable { let threads: [MessageThread] }
        let response: Response = try await client.invoke("list-threads", ["team_id": .uuid(teamID)])
        return response.threads
    }

    func teamChatThreadID(teamID: UUID) async throws -> UUID {
        struct Response: Decodable { let threadId: UUID }
        let response: Response = try await client.invoke("team-chat", ["team_id": .uuid(teamID)])
        return response.threadId
    }

    func threadDetail(threadID: UUID, since: Date?) async throws -> ThreadDetail {
        var params: [String: JSONValue] = ["thread_id": .uuid(threadID)]
        if let since { params["since"] = .date(since) }
        return try await client.invoke("list-messages", params)
    }

    func postMessage(threadID: UUID, body: String) async throws {
        struct Posted: Decodable { let id: UUID }
        let _: Posted = try await client.invoke("post-message", ["thread_id": .uuid(threadID), "body": .string(body)])
    }

    func createThread(teamID: UUID, title: String, audience: MessageAudience, body: String) async throws -> UUID {
        struct Created: Decodable { let threadId: UUID }
        let created: Created = try await client.invoke("create-thread", [
            "team_id": .uuid(teamID), "title": .optional(title), "audience": .string(audience.rawValue), "body": .string(body),
        ])
        return created.threadId
    }

    func deleteMessage(id: UUID) async throws {
        let _: OK = try await client.invoke("delete-message", ["message_id": .uuid(id)])
    }

    func setMute(threadID: UUID, muted: Bool) async throws {
        let _: OK = try await client.invoke("set-mute", ["thread_id": .uuid(threadID), "muted": .bool(muted)])
    }

    func announcements(teamID: UUID) async throws -> [Announcement] {
        try await client.rest("announcements", query: [("team_id", eq(teamID)), ("order", "created_at.desc"), ("limit", "50")])
    }

    func createAnnouncement(teamID: UUID, title: String, body: String) async throws {
        struct Created: Decodable { let id: UUID }
        let _: Created = try await client.invoke("create-announcement", [
            "team_id": .uuid(teamID), "title": .string(title), "body": .string(body),
        ])
    }

    // MARK: - Inbox & push

    func inbox() async throws -> [InboxItem] {
        struct Response: Decodable { let items: [InboxItem] }
        let response: Response = try await client.invoke("inbox")
        return response.items
    }

    func markRead(id: UUID?) async throws {
        let params: [String: JSONValue] = id.map { ["id": .uuid($0)] } ?? ["all": true]
        let _: OK = try await client.invoke("mark-read", params)
    }

    func registerDevice(token: String, sandbox: Bool) async throws {
        let _: OK = try await client.invoke("register-device", [
            "token": .string(token), "environment": .string(sandbox ? "sandbox" : "production"),
        ])
    }

    // MARK: - Money

    func syncSubscription(signedTransaction: String) async throws -> Bool {
        struct Response: Decodable { let isCoachPro: Bool }
        let response: Response = try await client.invoke("sync-subscription", ["signed_transaction": .string(signedTransaction)])
        return response.isCoachPro
    }

    func dues(teamID: UUID) async throws -> DuesOverview {
        try await client.invoke("list-dues", ["team_id": .uuid(teamID)])
    }

    func createDues(teamID: UUID, title: String, description: String?, amountCents: Int, dueDate: Date?) async throws {
        struct Created: Decodable { let requestId: UUID }
        let _: Created = try await client.invoke("create-dues", [
            "team_id": .uuid(teamID),
            "title": .string(title),
            "description": .optional(description),
            "amount_cents": .int(amountCents),
            "due_date": .optional(dueDate.map(JSONCoding.formatDateOnly)),
        ])
    }

    func setDuesStatus(itemID: UUID, status: DuesStatus) async throws {
        let _: OK = try await client.invoke("set-dues-status", ["item_id": .uuid(itemID), "status": .string(status.rawValue)])
    }

    func remindUnpaid(requestID: UUID) async throws -> Int {
        struct Response: Decodable { let reminded: Int }
        let response: Response = try await client.invoke("remind-unpaid", ["request_id": .uuid(requestID)])
        return response.reminded
    }

    func connectPayments(teamID: UUID) async throws -> URL {
        struct Response: Decodable { let url: URL }
        let response: Response = try await client.invoke("connect-payments", ["team_id": .uuid(teamID)])
        return response.url
    }

    func refreshPayments(teamID: UUID) async throws {
        struct Response: Decodable { let paymentsEnabled: Bool }
        let _: Response = try await client.invoke("refresh-payments", ["team_id": .uuid(teamID)])
    }

    func checkout(itemIDs: [UUID]) async throws -> CheckoutSession {
        try await client.invoke("checkout", ["item_ids": .array(itemIDs.map(JSONValue.uuid))])
    }
}

/// `{ "ok": true }` responses.
private struct OK: Decodable {}

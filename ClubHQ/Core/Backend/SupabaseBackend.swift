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
        // The version lets support see which build someone is on (admin portal, D-041).
        try await client.invoke("context", ["app_version": .string(AppConfig.appVersion)])
    }

    func updateProfile(fullName: String) async throws {
        let _: OK = try await client.invoke("update-profile", ["full_name": .string(fullName)])
    }

    func setNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs {
        struct Saved: Decodable { let notificationPrefs: NotificationPrefs }
        let saved: Saved = try await client.invoke("set-notification-prefs", [
            "event_reminders": .bool(prefs.eventReminders), "rsvp_reminders": .bool(prefs.rsvpReminders),
        ])
        return saved.notificationPrefs
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
            "heard_from": .optional(request.heardFrom?.rawValue),
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

    func resetInvite(teamID: UUID) async throws -> InviteLink {
        try await client.invoke("reset-invite", ["team_id": .uuid(teamID)])
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
        // Upcoming (no end date) shows the next 200. A bounded range (Past, Season Report: six
        // months) must be complete: at 200, a busy family's most recent past games were cut off and
        // the season record was computed from the oldest slice (QA review, D-050).
        var query: [(String, String)] = [
            ("team_id", inList(teamIDs)),
            ("starts_at", "gte.\(JSONCoding.formatTimestamp(from))"),
            ("order", "starts_at.asc"),
            ("limit", to == nil ? "200" : "1000"), // 1000 is also the server's row cap
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
            // Weekly repeats and notification times use the coach's local time (D-037).
            "time_zone": .string(TimeZone.current.identifier),
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
        let _: OK = try await client.invoke("cancel-event", ["event_id": .uuid(id), "time_zone": .string(TimeZone.current.identifier)])
    }

    func calendarFeedURL(reset: Bool) async throws -> URL {
        struct Response: Decodable { let url: URL }
        let response: Response = try await client.invoke(reset ? "reset-calendar-feed" : "calendar-feed")
        return response.url
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

    func deleteTeam(teamID: UUID, confirmName: String, notifyFamilies: Bool) async throws {
        let _: OK = try await client.invoke("delete-team", [
            "team_id": .uuid(teamID), "confirm_name": .string(confirmName), "notify_families": .bool(notifyFamilies),
        ])
    }

    // MARK: - Clubs (D-044)

    private func filterJSON(_ filter: ClubFilter) -> JSONValue {
        .object([
            "grades": .array(filter.grades.map(JSONValue.string)),
            "genders": .array(filter.genders.map(JSONValue.string)),
            "levels": .array(filter.levels.map(JSONValue.string)),
            "seasons": .array(filter.seasons.map(JSONValue.string)),
            "team_ids": .array(filter.teamIds.map { .string($0.uuidString.lowercased()) }),
        ])
    }

    func createClub(name: String) async throws -> UUID {
        struct Created: Decodable { let orgId: UUID }
        let created: Created = try await client.invoke("create-club", ["name": .string(name), "time_zone": .string(TimeZone.current.identifier)])
        return created.orgId
    }

    func clubOverview(orgID: UUID) async throws -> ClubOverview {
        try await client.invoke("club-overview", ["org_id": .uuid(orgID)])
    }

    func clubResetCode(orgID: UUID) async throws -> String {
        struct Code: Decodable { let code: String }
        let response: Code = try await client.invoke("club-reset-code", ["org_id": .uuid(orgID)])
        return response.code
    }

    func clubCreateTeams(orgID: UUID, teams: [NewClubTeam]) async throws -> [CreatedClubTeam] {
        struct Created: Decodable { let teams: [CreatedClubTeam] }
        let rows: [JSONValue] = teams.map { team in
            .object([
                "name": .string(team.name), "grade": .optional(team.grade), "gender": .optional(team.gender),
                "level": .optional(team.level), "season": .optional(team.season), "coach_email": .optional(team.coachEmail),
            ])
        }
        let created: Created = try await client.invoke("club-create-teams", ["org_id": .uuid(orgID), "teams": .array(rows)])
        return created.teams
    }

    func clubUpdateTeam(teamID: UUID, name: String?, grade: String?, gender: String?, level: String?, season: String?) async throws {
        var params: [String: JSONValue] = ["team_id": .uuid(teamID)]
        if let name { params["name"] = .string(name) }
        // "" clears a field on the server.
        params["grade"] = .string(grade ?? "")
        params["gender"] = .string(gender ?? "")
        params["level"] = .string(level ?? "")
        params["season"] = .string(season ?? "")
        let _: OK = try await client.invoke("club-update-team", params)
    }

    func clubAssignCoach(teamID: UUID, email: String, role: TeamRole) async throws -> (CoachAssignment, inviteText: String?) {
        struct Assigned: Decodable { let status: CoachAssignment.Status; let email: String; let code: String?; let inviteText: String? }
        let r: Assigned = try await client.invoke("club-assign-coach", ["team_id": .uuid(teamID), "email": .string(email), "role": .string(role.rawValue)])
        return (CoachAssignment(status: r.status, email: r.email, code: r.code), r.inviteText)
    }

    func clubRemoveCoach(teamID: UUID, userID: UUID?, email: String?) async throws {
        var params: [String: JSONValue] = ["team_id": .uuid(teamID)]
        if let userID { params["user_id"] = .uuid(userID) }
        if let email { params["email"] = .string(email) }
        let _: OK = try await client.invoke("club-remove-coach", params)
    }

    func lookupClubInvite(code: String) async throws -> ClubInvitePreview {
        try await client.invoke("lookup-club-invite", ["token": .string(code)])
    }

    func claimClubInvite(code: String, teamID: UUID?, newTeam: NewClubTeam?) async throws -> UUID {
        struct Claimed: Decodable { let teamId: UUID }
        var params: [String: JSONValue] = ["token": .string(code)]
        if let teamID { params["team_id"] = .uuid(teamID) }
        if let newTeam {
            params["team_name"] = .string(newTeam.name)
            params["grade"] = .optional(newTeam.grade)
            params["gender"] = .optional(newTeam.gender)
            params["level"] = .optional(newTeam.level)
            params["season"] = .optional(newTeam.season)
        }
        let claimed: Claimed = try await client.invoke("claim-club-invite", params)
        return claimed.teamId
    }

    func clubAudience(orgID: UUID, filter: ClubFilter) async throws -> ClubAudience {
        try await client.invoke("club-audience", ["org_id": .uuid(orgID), "filter": filterJSON(filter)])
    }

    func clubAnnouncement(orgID: UUID, filter: ClubFilter, title: String, body: String) async throws -> ClubAudience {
        try await client.invoke("club-announcement", ["org_id": .uuid(orgID), "filter": filterJSON(filter), "title": .string(title), "body": .string(body)])
    }

    func clubEvent(orgID: UUID, filter: ClubFilter, draft: EventDraft) async throws -> ClubAudience {
        try await client.invoke("club-event", [
            "org_id": .uuid(orgID), "filter": filterJSON(filter), "title": .string(draft.resolvedTitle),
            "event_type": .string(draft.eventType.rawValue), "starts_at": .date(draft.startsAt), "ends_at": .date(draft.endsAt),
            "location": .optional(draft.location), "location_address": .optional(draft.locationAddress), "notes": .optional(draft.notes),
            "time_zone": .string(TimeZone.current.identifier),
        ])
    }

    func clubEventCancel(clubEventID: UUID) async throws -> Int {
        struct Cancelled: Decodable { let cancelled: Int }
        let r: Cancelled = try await client.invoke("club-event-cancel", ["club_event_id": .uuid(clubEventID)])
        return r.cancelled
    }

    // MARK: - Schedule import (D-042)

    func importPreview(teamID: UUID, url: String, firstDay: String?, teamKey: String?) async throws -> ImportPreview {
        try await client.invoke("import-preview", [
            "team_id": .uuid(teamID), "url": .string(url), "first_day": .optional(firstDay), "team_key": .optional(teamKey),
            "time_zone": .string(TimeZone.current.identifier),
        ])
    }

    func importCommit(teamID: UUID, url: String, teamKey: String, alias: String?, gameKeys: [String]?, firstDay: String?) async throws -> ImportResult {
        var params: [String: JSONValue] = [
            "team_id": .uuid(teamID), "url": .string(url), "team_key": .string(teamKey),
            "alias": .optional(alias), "first_day": .optional(firstDay),
            "time_zone": .string(TimeZone.current.identifier),
        ]
        if let gameKeys { params["game_keys"] = .array(gameKeys.map(JSONValue.string)) }
        return try await client.invoke("import-commit", params)
    }

    func importUndo(importID: UUID) async throws -> Int {
        struct Removed: Decodable { let removed: Int }
        let response: Removed = try await client.invoke("import-undo", ["import_id": .uuid(importID)])
        return response.removed
    }

    func importDetach(importID: UUID) async throws -> Int {
        struct Kept: Decodable { let kept: Int }
        let response: Kept = try await client.invoke("import-detach", ["import_id": .uuid(importID)])
        return response.kept
    }

    func importNotify(importID: UUID) async throws -> Bool {
        struct Sent: Decodable { let sent: Bool }
        let response: Sent = try await client.invoke("import-notify", ["import_id": .uuid(importID)])
        return response.sent
    }

    func importReport(teamID: UUID?, url: String, reason: ImportReportReason, note: String?) async throws {
        var params: [String: JSONValue] = ["url": .string(String(url.prefix(500))), "reason": .string(reason.rawValue), "note": .optional(note)]
        if let teamID { params["team_id"] = .uuid(teamID) }
        let _: OK = try await client.invoke("import-report", params)
    }

    func scheduleImports(teamID: UUID) async throws -> [ScheduleImportInfo] {
        try await client.rest("schedule_imports", query: [
            ("team_id", eq(teamID)),
            ("select", "id,team_id,source_url,title,sheet_team_key,sheet_team_name,sheet_alias,last_imported_at,events(starts_at,cancelled_at)"),
            ("order", "last_imported_at.desc"),
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

    func postPhoto(threadID: UUID, photo: ChatPhoto, caption: String) async throws {
        struct Upload: Decodable { let uploadUrl: URL; let path: String }
        struct Posted: Decodable { let id: UUID }
        let upload: Upload = try await client.invoke("create-photo-upload", ["thread_id": .uuid(threadID)])
        try await client.uploadToSignedURL(upload.uploadUrl, data: photo.jpeg, contentType: "image/jpeg")
        let _: Posted = try await client.invoke("post-message", [
            "thread_id": .uuid(threadID), "body": .string(caption), "image_path": .string(upload.path),
            "image_width": .int(photo.width), "image_height": .int(photo.height),
        ])
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

    // MARK: - Safety & analytics (D-041)

    func reportMessage(id: UUID, reason: ReportReason, note: String?) async throws {
        struct Reported: Decodable { let reportId: UUID }
        let _: Reported = try await client.invoke("report-content", [
            "message_id": .uuid(id), "reason": .string(reason.rawValue), "note": .optional(note),
        ])
    }

    func reportConversation(threadID: UUID, reason: ReportReason, note: String) async throws {
        struct Reported: Decodable { let reportId: UUID }
        let _: Reported = try await client.invoke("report-content", [
            "thread_id": .uuid(threadID), "reason": .string(reason.rawValue), "note": .string(note),
        ])
    }

    func blockUser(id: UUID) async throws -> [UUID] {
        struct Response: Decodable { let blockedUserIds: [UUID] }
        let response: Response = try await client.invoke("block-user", ["user_id": .uuid(id)])
        return response.blockedUserIds
    }

    func unblockAllUsers() async throws -> [UUID] {
        struct Response: Decodable { let blockedUserIds: [UUID] }
        let response: Response = try await client.invoke("unblock-user")
        return response.blockedUserIds
    }

    func track(_ events: [UsageEvent]) async throws {
        guard !events.isEmpty else { return }
        struct Response: Decodable { let accepted: Int }
        let _: Response = try await client.invoke("track", [
            "app_version": .string(AppConfig.appVersion),
            "events": .array(events.map { event in
                .object([
                    "name": .string(event.name),
                    "team_id": event.teamID.map(JSONValue.uuid) ?? .null,
                    "props": .object(event.props.mapValues(JSONValue.string)),
                    "at": .date(event.at),
                ])
            }),
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

    func unregisterDevice(token: String) async throws {
        let _: OK = try await client.invoke("unregister-device", ["token": .string(token)])
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

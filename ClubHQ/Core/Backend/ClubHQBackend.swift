import Foundation

enum SignUpOutcome: Equatable {
    case signedIn
    case confirmEmail
}

/// Everything the UI can ask of the server. Two implementations: `SupabaseBackend`
/// (production) and `DemoBackend` (in-memory, DECISIONS D-006). Views never know which.
@MainActor
protocol ClubHQBackend: AnyObject {
    var isDemo: Bool { get }
    var currentUserID: UUID? { get }
    var hasSession: Bool { get }

    // MARK: Auth
    func signIn(email: String, password: String) async throws
    func signUp(fullName: String, email: String, password: String) async throws -> SignUpOutcome
    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws
    func sendPasswordReset(email: String) async throws
    /// Verifies a 6-digit emailed code (`isRecovery` = password reset) and signs the user in.
    func verifyEmailCode(email: String, code: String, isRecovery: Bool) async throws
    func resendSignupCode(email: String) async throws
    /// Guardian or head coach records a player's birthdate (needed for 13+ player logins).
    func setPlayerBirthdate(playerID: UUID, birthdate: Date) async throws
    /// Finishes an email-link sign-in; returns true when the link was a password reset.
    func completeAuthRedirect(fragment: String) async throws -> Bool
    func updatePassword(_ password: String) async throws
    func signOut() async
    func deleteAccount() async throws

    // MARK: Context & teams
    func loadContext() async throws -> UserContext
    func updateProfile(fullName: String) async throws
    /// Saves the reminder switches and returns what the server stored (D-045).
    func setNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs
    func createTeam(_ request: NewTeamRequest) async throws -> UUID
    func updateTeamColor(teamID: UUID, hex: String?) async throws
    /// Saves the team's Venmo username / $Cashtag (nil clears). Returns the normalized values.
    func updatePaymentHandles(teamID: UUID, venmoUsername: String?, cashappCashtag: String?) async throws
    func createInvite(teamID: UUID) async throws -> InviteLink
    /// Head coach replaces the team code; the old link and code stop working (D-036).
    func resetInvite(teamID: UUID) async throws -> InviteLink
    func lookupInvite(token: String) async throws -> InvitePreview
    /// `allowDuplicate` confirms a second child with the same name as one already on the team.
    func claimInvite(token: String, child: NewChildRequest, allowDuplicate: Bool) async throws -> UUID
    /// Co-parent invite: links the caller to the invite's existing child as a guardian (D-035).
    func claimGuardianInvite(token: String, relationship: EmergencyRelationship) async throws -> UUID
    /// A guardian of the child, or the head coach, invites a second guardian.
    func createGuardianInvite(playerID: UUID) async throws -> InviteLink
    func createPlayerInvite(playerID: UUID) async throws -> PlayerInviteCode
    func claimPlayerInvite(code: String) async throws -> UUID
    func teamMembers(teamID: UUID) async throws -> [TeamMember]
    func sponsors(teamID: UUID) async throws -> [TeamSponsor]

    // MARK: Roster
    func roster(teamID: UUID) async throws -> [Player]
    func savePlayer(_ draft: PlayerDraft) async throws
    func archivePlayer(id: UUID) async throws
    func emergencyContacts(playerID: UUID) async throws -> [EmergencyContact]

    // MARK: Schedule
    func events(teamIDs: [UUID], from: Date, to: Date?) async throws -> [TeamEvent]
    func eventDetail(eventID: UUID) async throws -> EventDetail
    func myRSVPs(eventIDs: [UUID]) async throws -> [RSVP]
    func saveEvent(_ draft: EventDraft) async throws -> [UUID]
    func cancelEvent(id: UUID) async throws
    func setRSVP(eventID: UUID, playerID: UUID, status: RSVPStatus, note: String?) async throws
    /// The caller's secret calendar subscription URL (https); `reset` replaces it (D-036).
    func calendarFeedURL(reset: Bool) async throws -> URL
    func setAttendance(eventID: UUID, entries: [UUID: AttendanceStatus]) async throws
    func setScore(eventID: UUID, homeScore: Int, awayScore: Int) async throws
    func teamAttendance(teamID: UUID) async throws -> [AttendanceRecord]

    // MARK: Schedule import (D-042)
    /// Reads a tournament's Google Sheet and guesses which team is ours. Saves nothing.
    /// `firstDay` ("yyyy-MM-dd") is only needed when the sheet doesn't say when it starts.
    /// `teamKey` loads that team's games from a league site (D-043), whose games load per team.
    func importPreview(teamID: UUID, url: String, firstDay: String?, teamKey: String?) async throws -> ImportPreview
    /// Saves the chosen team's games (all of them when `gameKeys` is nil). Importing the same link
    /// again updates those games; a different team swaps them. Sends no notifications.
    func importCommit(teamID: UUID, url: String, teamKey: String, alias: String?, gameKeys: [String]?, firstDay: String?) async throws -> ImportResult
    /// Removes every game an import added.
    func importUndo(importID: UUID) async throws -> Int
    /// Removes the import from the list but keeps its games as ordinary games. Returns how many were kept.
    func importDetach(importID: UUID) async throws -> Int
    /// One notification about the import's upcoming games. Returns false when none are upcoming.
    func importNotify(importID: UUID) async throws -> Bool
    func importReport(teamID: UUID?, url: String, reason: ImportReportReason, note: String?) async throws
    /// Links this team imported from, newest first.
    func scheduleImports(teamID: UUID) async throws -> [ScheduleImportInfo]

    // MARK: Clubs (D-044)
    /// Starts a club with the caller as director. Returns the club's id.
    func createClub(name: String) async throws -> UUID
    func clubOverview(orgID: UUID) async throws -> ClubOverview
    func clubResetCode(orgID: UUID) async throws -> String
    func clubCreateTeams(orgID: UUID, teams: [NewClubTeam]) async throws -> [CreatedClubTeam]
    func clubUpdateTeam(teamID: UUID, name: String?, grade: String?, gender: String?, level: String?, season: String?) async throws
    func clubAssignCoach(teamID: UUID, email: String, role: TeamRole) async throws -> (CoachAssignment, inviteText: String?)
    /// Removes a coach (by account) or a pending invite (by email). The team stays.
    func clubRemoveCoach(teamID: UUID, userID: UUID?, email: String?) async throws
    func lookupClubInvite(code: String) async throws -> ClubInvitePreview
    /// Coach code → coach of that team. Club code → bring `teamID` in, or start `newTeam`.
    func claimClubInvite(code: String, teamID: UUID?, newTeam: NewClubTeam?) async throws -> UUID
    func clubAudience(orgID: UUID, filter: ClubFilter) async throws -> ClubAudience
    func clubAnnouncement(orgID: UUID, filter: ClubFilter, title: String, body: String) async throws -> ClubAudience
    func clubEvent(orgID: UUID, filter: ClubFilter, draft: EventDraft) async throws -> ClubAudience
    func clubEventCancel(clubEventID: UUID) async throws -> Int

    // MARK: Messaging
    func threads(teamID: UUID) async throws -> [MessageThread]
    func teamChatThreadID(teamID: UUID) async throws -> UUID
    func threadDetail(threadID: UUID, since: Date?) async throws -> ThreadDetail
    func postMessage(threadID: UUID, body: String) async throws
    /// Uploads an already-downsized, metadata-free JPEG and posts it with an optional caption.
    func postPhoto(threadID: UUID, photo: ChatPhoto, caption: String) async throws
    func createThread(teamID: UUID, title: String, audience: MessageAudience, body: String) async throws -> UUID
    func deleteMessage(id: UUID) async throws
    func setMute(threadID: UUID, muted: Bool) async throws
    func announcements(teamID: UUID) async throws -> [Announcement]
    func createAnnouncement(teamID: UUID, title: String, body: String) async throws

    // MARK: Safety & analytics (App Review 1.2, D-041)
    /// Sends a message report to ClubHQ's moderation queue (reviewed within 24 hours).
    func reportMessage(id: UUID, reason: ReportReason, note: String?) async throws
    /// Reports a whole conversation; the note says what happened.
    func reportConversation(threadID: UUID, reason: ReportReason, note: String) async throws
    /// Blocks a member everywhere this user signs in. Returns the full block list.
    func blockUser(id: UUID) async throws -> [UUID]
    /// Clears every block. Returns the (now empty) block list.
    func unblockAllUsers() async throws -> [UUID]
    /// First-party usage events, batched.
    func track(_ events: [UsageEvent]) async throws

    // MARK: Inbox & push
    func inbox() async throws -> [InboxItem]
    func markRead(id: UUID?) async throws
    func registerDevice(token: String, sandbox: Bool) async throws

    // MARK: Money
    func syncSubscription(signedTransaction: String) async throws -> Bool
    func dues(teamID: UUID) async throws -> DuesOverview
    func createDues(teamID: UUID, title: String, description: String?, amountCents: Int, dueDate: Date?) async throws
    func setDuesStatus(itemID: UUID, status: DuesStatus) async throws
    func remindUnpaid(requestID: UUID) async throws -> Int
    func connectPayments(teamID: UUID) async throws -> URL
    func refreshPayments(teamID: UUID) async throws
    func checkout(itemIDs: [UUID]) async throws -> CheckoutSession
}

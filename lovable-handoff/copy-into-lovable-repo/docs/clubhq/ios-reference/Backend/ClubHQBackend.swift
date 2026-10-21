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
    func createTeam(_ request: NewTeamRequest) async throws -> UUID
    func updateTeamColor(teamID: UUID, hex: String?) async throws
    func createInvite(teamID: UUID) async throws -> InviteLink
    func lookupInvite(token: String) async throws -> InvitePreview
    func claimInvite(token: String, child: NewChildRequest) async throws -> UUID
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
    func setAttendance(eventID: UUID, entries: [UUID: AttendanceStatus]) async throws
    func setScore(eventID: UUID, homeScore: Int, awayScore: Int) async throws
    func teamAttendance(teamID: UUID) async throws -> [AttendanceRecord]

    // MARK: Messaging
    func threads(teamID: UUID) async throws -> [MessageThread]
    func teamChatThreadID(teamID: UUID) async throws -> UUID
    func threadDetail(threadID: UUID, since: Date?) async throws -> ThreadDetail
    func postMessage(threadID: UUID, body: String) async throws
    func createThread(teamID: UUID, title: String, audience: MessageAudience, body: String) async throws -> UUID
    func deleteMessage(id: UUID) async throws
    func setMute(threadID: UUID, muted: Bool) async throws
    func announcements(teamID: UUID) async throws -> [Announcement]
    func createAnnouncement(teamID: UUID, title: String, body: String) async throws

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

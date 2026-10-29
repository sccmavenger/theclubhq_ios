import Foundation

/// In-memory backend for Demo Mode, previews, and tests (DECISIONS D-006).
///
/// The seeded world has two teams and three demo personas so every role can be tried:
/// - **Coach**: head coach of *Mayhem Elite 14U* (basketball).
/// - **Parent**: guardian of Jordan (Mayhem Elite) and Mia (O'Fallon FC U10, soccer) —
///   showcases the cross-team family view.
/// - **Player**: Jordan Rivera (14) with their own player account.
final class DemoBackend: ClubHQBackend {
    let isDemo = true
    private(set) var persona: Persona?
    var latency: Duration

    private var world: DemoWorld
    private var blockedUserIDs: Set<UUID> = []
    private var scheduleImportRecords: [ScheduleImportInfo] = []
    private var notificationPrefs = NotificationPrefs()
    private var demoClub: ClubOverview?

    init(persona: Persona? = nil, latency: Duration = .milliseconds(120), now: Date = .now) {
        self.persona = persona
        self.latency = latency
        world = DemoWorld(now: now)
    }

    var currentUserID: UUID? { persona.map(world.userID(for:)) }
    var hasSession: Bool { persona != nil }

    func signIn(as persona: Persona) { self.persona = persona }

    private func pause() async {
        if latency > .zero { try? await Task.sleep(for: latency) }
    }

    private func me() throws -> UUID {
        guard let id = currentUserID else { throw BackendError.unauthorized }
        return id
    }

    private func notFound(_ what: String = "That item") -> BackendError {
        .server(status: 404, code: "not_found", message: "\(what) is no longer available.")
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async throws {
        await pause()
        persona = Persona.allCases.first { email.lowercased().hasPrefix($0.rawValue) } ?? .coach
    }

    func signUp(fullName: String, email: String, password: String) async throws -> SignUpOutcome {
        try await signIn(email: email, password: password)
        return .signedIn
    }

    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws {
        await pause()
        persona = .coach
    }

    func sendPasswordReset(email: String) async throws { await pause() }

    func completeAuthRedirect(fragment: String) async throws -> Bool { false }

    func verifyEmailCode(email: String, code: String, isRecovery: Bool) async throws {
        await pause()
        if persona == nil { persona = .coach }
    }

    func resendSignupCode(email: String) async throws { await pause() }

    func setPlayerBirthdate(playerID: UUID, birthdate: Date) async throws {
        guard let index = world.players.firstIndex(where: { $0.id == playerID }) else { throw notFound("Player") }
        world.players[index].birthdate = JSONCoding.formatDateOnly(birthdate)
    }

    func updatePassword(_ password: String) async throws { await pause() }

    func signOut() async { persona = nil }

    func deleteAccount() async throws {
        await pause()
        world = DemoWorld(now: .now)
        persona = nil
    }

    // MARK: - Context & teams

    func loadContext() async throws -> UserContext {
        await pause()
        let uid = try me()
        return world.context(for: uid)
    }

    func updateProfile(fullName: String) async throws {
        world.names[try me()] = fullName
    }

    func createTeam(_ request: NewTeamRequest) async throws -> UUID {
        await pause()
        let uid = try me()
        let owned = world.roles.filter { $0.userID == uid && $0.role == .headCoach }.count
        let pro = world.proUsers.contains(uid)
        if owned >= 3 { throw BackendError.server(status: 402, code: "team_limit", message: "You can be head coach of up to 3 teams.") }
        if owned >= 1 && !pro { throw BackendError.upgradeRequired("Coach Pro lets you run up to 3 teams.") }
        let team = DemoWorld.Team(id: UUID(), name: request.teamName, ageGroup: request.ageGroup.nilIfEmpty, season: request.season.nilIfEmpty, sport: request.sport, brandColor: nil)
        world.teams.append(team)
        world.roles.append(.init(userID: uid, teamID: team.id, role: .headCoach))
        return team.id
    }

    func updateTeamColor(teamID: UUID, hex: String?) async throws {
        guard world.isPro(team: teamID) else { throw BackendError.upgradeRequired("Team colors are a Coach Pro feature.") }
        guard let index = world.teams.firstIndex(where: { $0.id == teamID }) else { throw notFound("Team") }
        world.teams[index].brandColor = hex
    }

    func updatePaymentHandles(teamID: UUID, venmoUsername: String?, cashappCashtag: String?) async throws {
        guard let index = world.teams.firstIndex(where: { $0.id == teamID }) else { throw notFound("Team") }
        world.teams[index].venmoUsername = venmoUsername
        world.teams[index].cashappCashtag = cashappCashtag
    }

    func createInvite(teamID: UUID) async throws -> InviteLink {
        await pause()
        let token = world.inviteTokens.first { $0.value == teamID }?.key ?? "demo\(Int.random(in: 100_000...999_999))"
        world.inviteTokens[token] = teamID
        return InviteLink(token: token, expiresAt: .now.addingTimeInterval(365 * 86_400))
    }

    func resetInvite(teamID: UUID) async throws -> InviteLink {
        await pause()
        world.inviteTokens = world.inviteTokens.filter { $0.value != teamID }
        return try await createInvite(teamID: teamID)
    }

    func lookupInvite(token: String) async throws -> InvitePreview {
        await pause()
        // Typed codes arrive uppercased, so match demo tokens case-insensitively.
        func lookup(_ tokens: [String: UUID]) -> UUID? {
            tokens.first { $0.key.caseInsensitiveCompare(token) == .orderedSame }?.value
        }
        let coParentOf = lookup(world.guardianInviteTokens).flatMap { id in world.players.first { $0.id == id } }
        let teamID = coParentOf?.teamId ?? lookup(world.inviteTokens) ?? (token.lowercased().hasPrefix("demo") ? world.secondTeamID : nil)
        guard let teamID, let team = world.teams.first(where: { $0.id == teamID }) else { return InvitePreview(valid: false) }
        let uid = try me()
        let onTeam = world.context(for: uid).teams.contains { $0.id == teamID }
        return InvitePreview(valid: true, team: TeamPreview(id: team.id, name: team.name, ageGroup: team.ageGroup, season: team.season, sport: team.sport),
                             player: coParentOf.map { .init(id: $0.id, firstName: $0.firstName) }, alreadyOnTeam: onTeam)
    }

    func claimInvite(token: String, child: NewChildRequest, allowDuplicate: Bool) async throws -> UUID {
        let preview = try await lookupInvite(token: token)
        guard preview.valid, let teamID = preview.team?.id else {
            throw BackendError.server(status: 410, code: "expired", message: "This invite link has expired. Ask your coach for a new one.")
        }
        let uid = try me()
        let first = child.firstName.trimmingCharacters(in: .whitespaces)
        let last = child.lastName.trimmingCharacters(in: .whitespaces)
        if !allowDuplicate, world.players.contains(where: {
            $0.teamId == teamID && $0.archivedAt == nil
                && $0.firstName.caseInsensitiveCompare(first) == .orderedSame && $0.lastName.caseInsensitiveCompare(last) == .orderedSame
        }) {
            throw BackendError.server(status: 409, code: "possible_duplicate", message: "\(first) \(last) is already on this team.")
        }
        let player = Player(id: UUID(), teamId: teamID, firstName: child.firstName, lastName: child.lastName,
                            jerseyNumber: child.jerseyNumber.nilIfEmpty, position: child.position.nilIfEmpty,
                            birthdate: child.birthdate.map(JSONCoding.formatDateOnly), notes: nil, archivedAt: nil, userId: nil)
        world.players.append(player)
        world.links.append(.init(parentID: uid, playerID: player.id))
        world.contacts.append(EmergencyContact(id: UUID(), playerId: player.id, relationship: child.contactRelationship,
                                               name: child.contactName, phone: child.contactPhone, email: child.contactEmail.nilIfEmpty))
        notifyStaffFamilyJoined(teamID: teamID, playerID: player.id, by: uid,
                                subject: "\(world.name(of: uid)) added \(player.fullName) to the team", body: "Tap to see your roster.")
        return teamID
    }

    func claimGuardianInvite(token: String, relationship: EmergencyRelationship) async throws -> UUID {
        let preview = try await lookupInvite(token: token)
        guard preview.valid, let teamID = preview.team?.id, let playerID = preview.player?.id else {
            throw BackendError.server(status: 410, code: "expired", message: "This invite is no longer valid. Ask for a new one.")
        }
        let uid = try me()
        if !world.links.contains(where: { $0.parentID == uid && $0.playerID == playerID }) {
            world.links.append(.init(parentID: uid, playerID: playerID))
            let childName = world.players.first { $0.id == playerID }?.fullName ?? "their child"
            notifyStaffFamilyJoined(teamID: teamID, playerID: playerID, by: uid,
                                    subject: "\(world.name(of: uid)) joined as \(childName)'s guardian",
                                    body: "They'll get the schedule, announcements, and RSVPs.")
        }
        return teamID
    }

    /// Mirrors the server's `family_joined` fan-out to staff (D-035).
    private func notifyStaffFamilyJoined(teamID: UUID, playerID: UUID, by uid: UUID, subject: String, body: String) {
        let staff = Set(world.roles.filter { $0.teamID == teamID && $0.role.isStaff }.map(\.userID)).subtracting([uid])
        for userID in staff {
            let item = InboxItem(id: UUID(), linkPath: "/team", readAt: nil, createdAt: .now, kind: .familyJoined,
                                 subject: subject, body: body, teamId: teamID, refId: playerID)
            world.inbox[userID, default: []].insert(item, at: 0)
        }
    }

    func createGuardianInvite(playerID: UUID) async throws -> InviteLink {
        await pause()
        let token = world.guardianInviteTokens.first { $0.value == playerID }?.key ?? "COPA\(Int.random(in: 100_000...999_999))"
        world.guardianInviteTokens[token] = playerID
        return InviteLink(token: token, expiresAt: .now.addingTimeInterval(30 * 86_400))
    }

    func createPlayerInvite(playerID: UUID) async throws -> PlayerInviteCode {
        await pause()
        guard let player = world.players.first(where: { $0.id == playerID }) else { throw notFound("Player") }
        if player.userId != nil {
            throw BackendError.server(status: 409, code: "already_claimed", message: "\(player.firstName) already has a player account.")
        }
        guard player.birthdate != nil else {
            throw BackendError.server(status: 422, code: "birthdate_required", message: "Add a birthdate first — player accounts are for ages 13+.")
        }
        guard AgePolicy.canHaveOwnAccount(birthdate: player.birthdate) else {
            throw BackendError.server(status: 422, code: "too_young", message: "Player accounts are available from age 13. Younger players stay on a guardian's account.")
        }
        let code = String((0..<8).map { _ in "ABCDEFGHJKMNPQRSTUVWXYZ23456789".randomElement()! })
        world.playerCodes[code] = playerID
        return PlayerInviteCode(code: code, expiresAt: .now.addingTimeInterval(7 * 86_400))
    }

    func claimPlayerInvite(code: String) async throws -> UUID {
        await pause()
        guard let playerID = world.playerCodes[code.uppercased()],
              let index = world.players.firstIndex(where: { $0.id == playerID }) else {
            throw BackendError.server(status: 410, code: "expired", message: "That code isn't valid anymore. Ask your parent or coach for a new one.")
        }
        world.players[index].userId = try me()
        world.playerCodes[code.uppercased()] = nil
        return world.players[index].teamId
    }

    func teamMembers(teamID: UUID) async throws -> [TeamMember] {
        await pause()
        return world.members(of: teamID)
    }

    func sponsors(teamID: UUID) async throws -> [TeamSponsor] {
        world.sponsors.filter { $0.teamId == teamID }
    }

    // MARK: - Roster

    func roster(teamID: UUID) async throws -> [Player] {
        await pause()
        return world.players
            .filter { $0.teamId == teamID && $0.archivedAt == nil }
            .sorted { ($0.lastName, $0.firstName) < ($1.lastName, $1.firstName) }
    }

    func savePlayer(_ draft: PlayerDraft) async throws {
        await pause()
        let birthdate = draft.birthdate.map(JSONCoding.formatDateOnly)
        if let id = draft.id, let index = world.players.firstIndex(where: { $0.id == id }) {
            world.players[index].firstName = draft.firstName
            world.players[index].lastName = draft.lastName
            world.players[index].jerseyNumber = draft.jerseyNumber.nilIfEmpty
            world.players[index].position = draft.position.nilIfEmpty
            world.players[index].birthdate = birthdate
            world.players[index].notes = draft.notes.nilIfEmpty
        } else {
            world.players.append(Player(id: UUID(), teamId: draft.teamId, firstName: draft.firstName, lastName: draft.lastName,
                                        jerseyNumber: draft.jerseyNumber.nilIfEmpty, position: draft.position.nilIfEmpty,
                                        birthdate: birthdate, notes: draft.notes.nilIfEmpty, archivedAt: nil, userId: nil))
        }
    }

    func archivePlayer(id: UUID) async throws {
        guard let index = world.players.firstIndex(where: { $0.id == id }) else { throw notFound("Player") }
        world.players[index].archivedAt = .now
    }

    func emergencyContacts(playerID: UUID) async throws -> [EmergencyContact] {
        world.contacts.filter { $0.playerId == playerID }
    }

    // MARK: - Schedule

    func events(teamIDs: [UUID], from: Date, to: Date?) async throws -> [TeamEvent] {
        await pause()
        return world.events
            .filter { teamIDs.contains($0.teamId) && $0.startsAt >= from && (to == nil || $0.startsAt < to!) }
            .sorted { $0.startsAt < $1.startsAt }
    }

    func eventDetail(eventID: UUID) async throws -> EventDetail {
        await pause()
        guard let event = world.events.first(where: { $0.id == eventID }) else { throw notFound("This event") }
        return EventDetail(
            event: event,
            rsvps: world.rsvps.filter { $0.eventId == eventID },
            attendance: world.attendance.filter { $0.eventId == eventID },
            roster: try await roster(teamID: event.teamId)
        )
    }

    func myRSVPs(eventIDs: [UUID]) async throws -> [RSVP] {
        world.rsvps.filter { eventIDs.contains($0.eventId) }
    }

    func saveEvent(_ draft: EventDraft) async throws -> [UUID] {
        await pause()
        func make(id: UUID, weeks: Int) -> TeamEvent {
            // Same local start time every week, across Daylight Saving (D-037).
            let start = Calendar.current.date(byAdding: .day, value: weeks * 7, to: draft.startsAt) ?? draft.startsAt
            return TeamEvent(id: id, teamId: draft.teamId, title: draft.resolvedTitle, eventType: draft.eventType,
                      startsAt: start, endsAt: start.addingTimeInterval(draft.endsAt.timeIntervalSince(draft.startsAt)),
                      location: draft.location.nilIfEmpty, locationAddress: draft.locationAddress.nilIfEmpty, notes: draft.notes.nilIfEmpty,
                      opponent: draft.eventType == .game ? draft.opponent.nilIfEmpty : nil,
                      homeAway: draft.eventType == .game ? (draft.isHome ? "home" : "away") : nil,
                      homeScore: nil, awayScore: nil, result: nil, cancelledAt: nil, rsvpCutoffAt: nil)
        }
        if let id = draft.id, let index = world.events.firstIndex(where: { $0.id == id }) {
            var updated = make(id: id, weeks: 0)
            updated.homeScore = world.events[index].homeScore
            updated.awayScore = world.events[index].awayScore
            world.events[index] = updated
            return [id]
        }
        let created = (0...draft.repeatWeeks).map { make(id: UUID(), weeks: $0) }
        world.events.append(contentsOf: created)
        return created.map(\.id)
    }

    func cancelEvent(id: UUID) async throws {
        guard let index = world.events.firstIndex(where: { $0.id == id }) else { throw notFound("This event") }
        world.events[index].cancelledAt = .now
    }

    /// The demo has no server for a calendar app to fetch from.
    func calendarFeedURL(reset: Bool) async throws -> URL {
        await pause()
        throw BackendError.server(status: 409, code: "demo_unavailable",
                                  message: "Calendar sync needs a real account. Sign up to put your team's schedule in your phone's calendar.")
    }

    func setRSVP(eventID: UUID, playerID: UUID, status: RSVPStatus, note: String?) async throws {
        await pause()
        guard let event = world.events.first(where: { $0.id == eventID }) else { throw notFound("This event") }
        guard event.isRSVPOpen() else {
            throw BackendError.server(status: 409, code: "rsvp_locked", message: "RSVPs are closed for this event. Message your coach instead.")
        }
        let uid = try me()
        if let index = world.rsvps.firstIndex(where: { $0.eventId == eventID && $0.playerId == playerID }) {
            world.rsvps[index].status = status
            world.rsvps[index].note = note
            world.rsvps[index].respondedBy = uid
            world.rsvps[index].updatedAt = .now
        } else {
            world.rsvps.append(RSVP(id: UUID(), eventId: eventID, playerId: playerID, status: status, note: note, respondedBy: uid, updatedAt: .now))
        }
    }

    func setAttendance(eventID: UUID, entries: [UUID: AttendanceStatus]) async throws {
        await pause()
        for (playerID, status) in entries {
            if let index = world.attendance.firstIndex(where: { $0.eventId == eventID && $0.playerId == playerID }) {
                world.attendance[index].status = status
            } else {
                world.attendance.append(AttendanceRecord(id: UUID(), eventId: eventID, playerId: playerID, status: status))
            }
        }
    }

    func setScore(eventID: UUID, homeScore: Int, awayScore: Int) async throws {
        guard let index = world.events.firstIndex(where: { $0.id == eventID }) else { throw notFound("This event") }
        world.events[index].homeScore = homeScore
        world.events[index].awayScore = awayScore
    }

    func teamAttendance(teamID: UUID) async throws -> [AttendanceRecord] {
        let eventIDs = Set(world.events.filter { $0.teamId == teamID }.map(\.id))
        return world.attendance.filter { eventIDs.contains($0.eventId) }
    }

    func deleteTeam(teamID: UUID, confirmName: String, notifyFamilies: Bool) async throws {
        await pause()
        guard let team = world.teams.first(where: { $0.id == teamID }) else { throw notFound("That team") }
        guard confirmName.trimmingCharacters(in: .whitespaces).lowercased() == team.name.lowercased() else {
            throw BackendError.server(status: 400, code: "invalid_input", message: "Type the team's name exactly (\"\(team.name)\") to delete it.")
        }
        world.teams.removeAll { $0.id == teamID }
        world.roles.removeAll { $0.teamID == teamID }
        world.events.removeAll { $0.teamId == teamID }
    }

    // MARK: - Clubs (D-044)

    /// A sample club for previews and tests: eight teams across grades, genders and levels.
    static func sampleClubOverview(now: Date = .now) -> ClubOverview {
        func team(_ name: String, _ grade: String, _ gender: String, _ level: String?, coach: String?, roster: Int, families: Int, next: Int?) -> ClubTeam {
            ClubTeam(
                id: UUID(), name: name, grade: grade, gender: gender, level: level, season: "Fall 2026", sport: .basketball,
                coaches: coach.map { [.init(userId: UUID(), name: $0, role: .headCoach)] } ?? [],
                pendingCoaches: [], rosterCount: roster, familyCount: families,
                nextEvent: next.map { .init(id: UUID(), title: "Practice", eventType: .practice, opponent: nil, homeAway: nil,
                                            startsAt: now.addingTimeInterval(Double($0) * 86_400), rsvpCount: max(0, roster - 3)) }
            )
        }
        return ClubOverview(
            club: .init(id: UUID(), name: "3D Basketball Academy", brandColor: nil, timeZone: "America/Chicago", code: "3DBA2026FA", familyCount: 64),
            directors: [.init(userId: UUID(), name: "Danny Guillory")],
            teams: [
                team("3D Nation 2033 6th Boys", "6", "boys", "Elite", coach: "Danny Guillory", roster: 10, families: 9, next: 1),
                team("3D Nation 6th Boys Gold", "6", "boys", "Gold", coach: "Marcus Hill", roster: 9, families: 8, next: 2),
                team("3D Nation 6th Girls", "6", "girls", "Elite", coach: "Tara Wells", roster: 8, families: 8, next: 1),
                team("3D Nation 7th Boys", "7", "boys", "Elite", coach: "Chris Lane", roster: 11, families: 10, next: 3),
                team("3D Nation 7th Girls", "7", "girls", "Gold", coach: nil, roster: 7, families: 4, next: nil),
                team("3D Nation 8th Boys", "8", "boys", "Elite", coach: "Andre Moss", roster: 12, families: 11, next: 2),
                team("3D Nation 8th Girls", "8", "girls", "Elite", coach: "Kim Ortiz", roster: 9, families: 9, next: 4),
                team("3D Nation 5th Boys", "5", "boys", "Gold", coach: "Ray Diaz", roster: 10, families: 5, next: 1),
            ],
            clubEvents: [.init(clubEventId: UUID(), title: "Picture Day", eventType: .other, startsAt: now.addingTimeInterval(6 * 86_400), teamCount: 8)]
        )
    }

    private func club() throws -> ClubOverview {
        if demoClub == nil { demoClub = Self.sampleClubOverview() }
        return demoClub!
    }

    private func audience(_ filter: ClubFilter) throws -> ClubAudience {
        let teams = try club().teams.filter(filter.matches)
        return ClubAudience(teamCount: teams.count, peopleCount: teams.reduce(0) { $0 + $1.familyCount + $1.coaches.count })
    }

    func createClub(name: String) async throws -> UUID {
        await pause()
        let id = UUID()
        demoClub = ClubOverview(club: .init(id: id, name: name, brandColor: nil, timeZone: TimeZone.current.identifier, code: "DEMOCLUB01", familyCount: 0),
                                directors: [], teams: [], clubEvents: [])
        return id
    }

    func clubOverview(orgID: UUID) async throws -> ClubOverview {
        await pause()
        return try club()
    }

    func clubResetCode(orgID: UUID) async throws -> String {
        await pause()
        let code = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10))
        demoClub?.club.code = code
        return code
    }

    func clubCreateTeams(orgID: UUID, teams: [NewClubTeam]) async throws -> [CreatedClubTeam] {
        await pause()
        _ = try club()
        return teams.map { new in
            let id = UUID()
            let invite = new.coachEmail.map { CoachAssignment(status: .invited, email: $0, code: "COACH\(Int.random(in: 10000...99999))") }
            demoClub?.teams.append(ClubTeam(
                id: id, name: new.name, grade: new.grade, gender: new.gender, level: new.level, season: new.season, sport: .basketball,
                coaches: [], pendingCoaches: invite.map { [.init(email: $0.email, code: $0.code!, role: .headCoach)] } ?? [],
                rosterCount: 0, familyCount: 0, nextEvent: nil
            ))
            return CreatedClubTeam(teamId: id, name: new.name, coach: invite,
                                   inviteText: invite.map { "Join \(demoClub?.club.name ?? "the club") on ClubHQ with code \($0.code!)." })
        }
    }

    func clubUpdateTeam(teamID: UUID, name: String?, grade: String?, gender: String?, level: String?, season: String?) async throws {
        await pause()
        guard let i = demoClub?.teams.firstIndex(where: { $0.id == teamID }) else { throw notFound("That team") }
        if let name { demoClub?.teams[i].name = name }
        demoClub?.teams[i].grade = grade
        demoClub?.teams[i].gender = gender
        demoClub?.teams[i].level = level
        demoClub?.teams[i].season = season
    }

    func clubAssignCoach(teamID: UUID, email: String, role: TeamRole) async throws -> (CoachAssignment, inviteText: String?) {
        await pause()
        guard let i = demoClub?.teams.firstIndex(where: { $0.id == teamID }) else { throw notFound("That team") }
        let assignment = CoachAssignment(status: .invited, email: email, code: "COACH12345")
        demoClub?.teams[i].pendingCoaches.append(.init(email: email, code: "COACH12345", role: role))
        return (assignment, "Join on ClubHQ with code COACH12345.")
    }

    func clubRemoveCoach(teamID: UUID, userID: UUID?, email: String?) async throws {
        await pause()
        guard let i = demoClub?.teams.firstIndex(where: { $0.id == teamID }) else { throw notFound("That team") }
        if let userID { demoClub?.teams[i].coaches.removeAll { $0.userId == userID } }
        if let email { demoClub?.teams[i].pendingCoaches.removeAll { $0.email == email } }
    }

    func lookupClubInvite(code: String) async throws -> ClubInvitePreview {
        await pause()
        throw BackendError.server(status: 410, code: "expired", message: "Club codes work with a real account, not in Demo Mode.")
    }

    func claimClubInvite(code: String, teamID: UUID?, newTeam: NewClubTeam?) async throws -> UUID {
        await pause()
        throw BackendError.server(status: 410, code: "expired", message: "Club codes work with a real account, not in Demo Mode.")
    }

    func clubAudience(orgID: UUID, filter: ClubFilter) async throws -> ClubAudience {
        try audience(filter)
    }

    func clubAnnouncement(orgID: UUID, filter: ClubFilter, title: String, body: String) async throws -> ClubAudience {
        await pause()
        return try audience(filter)
    }

    func clubEvent(orgID: UUID, filter: ClubFilter, draft: EventDraft) async throws -> ClubAudience {
        await pause()
        let result = try audience(filter)
        demoClub?.clubEvents.append(.init(clubEventId: UUID(), title: draft.resolvedTitle, eventType: draft.eventType, startsAt: draft.startsAt, teamCount: result.teamCount))
        return result
    }

    func clubEventCancel(clubEventID: UUID) async throws -> Int {
        await pause()
        let count = demoClub?.clubEvents.first { $0.clubEventId == clubEventID }?.teamCount ?? 0
        demoClub?.clubEvents.removeAll { $0.clubEventId == clubEventID }
        return count
    }

    // MARK: - Notification preferences (D-045)

    func setNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs {
        await pause()
        notificationPrefs = prefs
        return prefs
    }

    // MARK: - Schedule import (D-042)

    /// A real `import-preview` response for the 2026 CNR tournament sheet, bundled for Demo Mode
    /// and previews. Any Google Sheets link returns it.
    static func sampleImportPreview() throws -> ImportPreview {
        guard let url = Bundle.main.url(forResource: "DemoScheduleImport", withExtension: "json") else {
            throw BackendError.server(status: 500, code: "internal", message: "The demo tournament is missing.")
        }
        return try JSONCoding.decoder.decode(ImportPreview.self, from: Data(contentsOf: url))
    }

    func importPreview(teamID: UUID, url: String, firstDay: String?, teamKey: String?) async throws -> ImportPreview {
        await pause()
        guard ScheduleImportText.looksLikeSheetLink(url) else {
            throw BackendError.server(status: 422, code: "not_a_sheet", message: "That isn't a Google Sheets link. Paste the link the organizer shared (it starts with docs.google.com/spreadsheets).")
        }
        var preview = try Self.sampleImportPreview()
        if let previous = scheduleImportRecords.first(where: { $0.teamId == teamID }) {
            let count = world.events.filter { $0.importId == previous.id }.count
            preview.previousImport = .init(id: previous.id, teamKey: previous.sheetTeamKey, alias: previous.sheetAlias, eventCount: count)
            preview.match = .init(outcome: .clear, teamKeys: [previous.sheetTeamKey])
        }
        return preview
    }

    func importCommit(teamID: UUID, url: String, teamKey: String, alias: String?, gameKeys: [String]?, firstDay: String?) async throws -> ImportResult {
        await pause()
        let preview = try Self.sampleImportPreview()
        guard let team = preview.team(teamKey) else { throw notFound("That team") }
        let games = preview.games(for: teamKey, alias: alias).filter { $0.startsAt != nil && (gameKeys?.contains($0.key) ?? true) }
        let importID = scheduleImportRecords.first(where: { $0.teamId == teamID })?.id ?? UUID()
        let removed = world.events.filter { $0.importId == importID }.count
        world.events.removeAll { $0.importId == importID }
        scheduleImportRecords.removeAll { $0.id == importID }
        scheduleImportRecords.insert(ScheduleImportInfo(
            id: importID, teamId: teamID, sourceUrl: preview.source.url, title: preview.source.title,
            sheetTeamKey: teamKey, sheetTeamName: team.name, sheetAlias: alias, lastImportedAt: .now
        ), at: 0)
        let created = games.map { game -> TeamEvent in
            let (us, them) = game.ourSide(teamKey: teamKey, alias: alias)
            let start = game.startsAt!
            return TeamEvent(
                id: UUID(), teamId: teamID, title: "\(game.round ?? "Game") · \(preview.source.title)", eventType: .game,
                startsAt: start, endsAt: start.addingTimeInterval(3600), location: game.placeLabel, locationAddress: game.address,
                notes: "Imported from \(preview.source.title).", opponent: them.placeholder ? "TBD (\(them.name))" : them.name,
                homeAway: "home", homeScore: us.score, awayScore: them.score, result: nil, cancelledAt: nil, rsvpCutoffAt: nil,
                importId: importID
            )
        }
        world.events.append(contentsOf: created)
        return ImportResult(
            importId: importID, added: created.count, updated: 0, removed: removed, cancelled: 0, skipped: 0,
            upcoming: created.filter { $0.startsAt > .now }.count, eventIds: created.map(\.id)
        )
    }

    func importUndo(importID: UUID) async throws -> Int {
        await pause()
        let removed = world.events.filter { $0.importId == importID }.count
        world.events.removeAll { $0.importId == importID }
        scheduleImportRecords.removeAll { $0.id == importID }
        return removed
    }

    func importDetach(importID: UUID) async throws -> Int {
        await pause()
        var kept = 0
        for i in world.events.indices where world.events[i].importId == importID {
            world.events[i].importId = nil
            kept += 1
        }
        scheduleImportRecords.removeAll { $0.id == importID }
        return kept
    }

    func importNotify(importID: UUID) async throws -> Bool {
        await pause()
        return world.events.contains { $0.importId == importID && $0.startsAt > .now }
    }

    func importReport(teamID: UUID?, url: String, reason: ImportReportReason, note: String?) async throws {
        await pause()
    }

    func scheduleImports(teamID: UUID) async throws -> [ScheduleImportInfo] {
        scheduleImportRecords.filter { $0.teamId == teamID }.map { record in
            var info = record
            info.events = world.events.filter { $0.importId == record.id }.map { .init(startsAt: $0.startsAt, cancelledAt: $0.cancelledAt) }
            return info
        }
    }

    // MARK: - Messaging

    func threads(teamID: UUID) async throws -> [MessageThread] {
        await pause()
        let uid = try me()
        let context = world.context(for: uid)
        guard let membership = context.teams.first(where: { $0.id == teamID }) else { return [] }
        return world.threads
            .filter { $0.teamId == teamID && world.canRead(thread: $0, membership: membership) }
            .map { thread in
                var thread = thread
                let last = world.messages.filter { $0.threadID == thread.id }.max { $0.message.createdAt < $1.message.createdAt }
                thread.lastMessage = last.map { stored in
                    let message = stored.message
                    if message.isDeleted { return "[deleted]" }
                    if message.imageUrl != nil { return message.hasText ? "📷 \(message.body.prefix(138))" : "📷 Photo" }
                    return String(message.body.prefix(140))
                }
                thread.lastMessageAt = last?.message.createdAt
                thread.lastAuthorName = last.map { world.name(of: $0.message.authorId) }
                let readAt = world.reads[ReadKey(userID: uid, threadID: thread.id)]
                thread.unread = last.map { $0.message.authorId != uid && (readAt == nil || readAt! < $0.message.createdAt) } ?? false
                thread.muted = world.mutes.contains(ReadKey(userID: uid, threadID: thread.id))
                return thread
            }
            .sorted { ($0.pinned ? 1 : 0, $0.lastMessageAt ?? $0.updatedAt) > ($1.pinned ? 1 : 0, $1.lastMessageAt ?? $1.updatedAt) }
    }

    func teamChatThreadID(teamID: UUID) async throws -> UUID {
        if let thread = world.threads.first(where: { $0.teamId == teamID && $0.isTeamChat }) { return thread.id }
        let thread = MessageThread(id: UUID(), teamId: teamID, kind: .team, eventId: nil, audience: .both, title: "Team chat",
                                   pinned: true, updatedAt: .now, lastMessage: nil, lastMessageAt: nil, lastAuthorName: nil, unread: false, muted: false)
        world.threads.append(thread)
        return thread.id
    }

    func threadDetail(threadID: UUID, since: Date?) async throws -> ThreadDetail {
        if since == nil { await pause() }
        let uid = try me()
        guard let thread = world.threads.first(where: { $0.id == threadID }) else { throw notFound("This conversation") }
        let membership = world.context(for: uid).teams.first { $0.id == thread.teamId }
        world.reads[ReadKey(userID: uid, threadID: threadID)] = .now
        let messages = world.messages
            .filter { $0.threadID == threadID && (since == nil || $0.message.createdAt > since!) }
            .map { stored -> ChatMessage in
                var message = stored.message
                message.authorName = world.name(of: message.authorId)
                message.isMine = message.authorId == uid
                if message.isDeleted {
                    message.body = "[deleted]"
                    message.imageUrl = nil
                }
                return message
            }
            .sorted { $0.createdAt < $1.createdAt }
        let info = ThreadInfo(id: thread.id, teamId: thread.teamId, kind: thread.kind, audience: thread.audience, title: thread.title,
                              canModerate: membership?.isHeadCoach ?? false,
                              canPost: membership.map { $0.canMessagePrivately || thread.kind == .team } ?? false)
        return ThreadDetail(thread: info, messages: messages)
    }

    func postMessage(threadID: UUID, body: String) async throws {
        let uid = try me()
        guard let index = world.threads.firstIndex(where: { $0.id == threadID }) else { throw notFound("This conversation") }
        let message = ChatMessage(id: UUID(), authorId: uid, authorName: "", body: body, createdAt: .now, editedAt: nil, isDeleted: false, isMine: true)
        world.messages.append(.init(threadID: threadID, message: message))
        world.threads[index].updatedAt = .now
    }

    /// Demo photos live in the caches folder and are shown through file URLs.
    func postPhoto(threadID: UUID, photo: ChatPhoto, caption: String) async throws {
        await pause()
        let uid = try me()
        guard let index = world.threads.firstIndex(where: { $0.id == threadID }) else { throw notFound("This conversation") }
        let file = URL.cachesDirectory.appending(path: "demo-chat-\(UUID().uuidString).jpg")
        try photo.jpeg.write(to: file)
        let message = ChatMessage(id: UUID(), authorId: uid, authorName: "", body: caption, createdAt: .now, editedAt: nil,
                                  isDeleted: false, isMine: true, imageUrl: file, imageWidth: photo.width, imageHeight: photo.height)
        world.messages.append(.init(threadID: threadID, message: message))
        world.threads[index].updatedAt = .now
    }

    func createThread(teamID: UUID, title: String, audience: MessageAudience, body: String) async throws -> UUID {
        await pause()
        let thread = MessageThread(id: UUID(), teamId: teamID, kind: .team, eventId: nil, audience: audience, title: title.nilIfEmpty,
                                   pinned: false, updatedAt: .now, lastMessage: nil, lastMessageAt: nil, lastAuthorName: nil, unread: false, muted: false)
        world.threads.append(thread)
        try await postMessage(threadID: thread.id, body: body)
        return thread.id
    }

    func deleteMessage(id: UUID) async throws {
        guard let index = world.messages.firstIndex(where: { $0.message.id == id }) else { throw notFound("This message") }
        world.messages[index].message.isDeleted = true
    }

    // MARK: Safety & analytics: a demo has no moderation queue or analytics, so reports and
    // events go nowhere; blocks last for the session.

    func reportMessage(id: UUID, reason: ReportReason, note: String?) async throws {
        await pause()
        guard world.messages.contains(where: { $0.message.id == id }) else { throw notFound("This message") }
    }

    func reportConversation(threadID: UUID, reason: ReportReason, note: String) async throws {
        await pause()
        guard !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BackendError.server(status: 400, code: "invalid_input", message: "Tell us what happened so we can look into it.")
        }
    }

    func blockUser(id: UUID) async throws -> [UUID] {
        guard id != (try me()) else {
            throw BackendError.server(status: 400, code: "invalid_input", message: "You can't block yourself.")
        }
        blockedUserIDs.insert(id)
        return Array(blockedUserIDs)
    }

    func unblockAllUsers() async throws -> [UUID] {
        blockedUserIDs.removeAll()
        return []
    }

    func track(_ events: [UsageEvent]) async throws {}

    func setMute(threadID: UUID, muted: Bool) async throws {
        let key = ReadKey(userID: try me(), threadID: threadID)
        if muted { world.mutes.insert(key) } else { world.mutes.remove(key) }
    }

    func announcements(teamID: UUID) async throws -> [Announcement] {
        world.announcements.filter { $0.teamId == teamID }.sorted { $0.createdAt > $1.createdAt }
    }

    func createAnnouncement(teamID: UUID, title: String, body: String) async throws {
        await pause()
        world.announcements.append(Announcement(id: UUID(), teamId: teamID, title: title, body: body, createdAt: .now, createdBy: try me()))
    }

    // MARK: - Inbox & push

    func inbox() async throws -> [InboxItem] {
        await pause()
        return world.inbox[try me()] ?? []
    }

    func markRead(id: UUID?) async throws {
        let uid = try me()
        world.inbox[uid] = (world.inbox[uid] ?? []).map { item in
            var item = item
            if id == nil || item.id == id { item.readAt = item.readAt ?? .now }
            return item
        }
    }

    func registerDevice(token: String, sandbox: Bool) async throws {}

    // MARK: - Money

    func syncSubscription(signedTransaction: String) async throws -> Bool {
        let uid = try me()
        world.proUsers.insert(uid)
        return true
    }

    /// Demo-only shortcut used by the paywall when StoreKit products aren't available.
    func grantDemoPro() {
        if let uid = currentUserID { world.proUsers.insert(uid) }
    }

    func dues(teamID: UUID) async throws -> DuesOverview {
        await pause()
        let uid = try me()
        let membership = world.context(for: uid).teams.first { $0.id == teamID }
        let myPlayers = Set(membership?.linkedPlayers.map(\.id) ?? [])
        let requests = world.dues
            .filter { $0.teamID == teamID }
            .map { stored -> DuesRequest in
                var request = stored.request
                if membership?.isStaff != true { request.items = request.items.filter { myPlayers.contains($0.playerId) } }
                return request
            }
            .filter { membership?.isStaff == true || !$0.items.isEmpty }
        return DuesOverview(paymentsEnabled: world.paymentsEnabled.contains(teamID), paymentsConnected: world.paymentsEnabled.contains(teamID),
                            fee: .init(percentBps: DuesFee.percentBasisPoints, flatCents: DuesFee.flatCents), requests: requests)
    }

    func createDues(teamID: UUID, title: String, description: String?, amountCents: Int, dueDate: Date?) async throws {
        await pause()
        let items = world.players.filter { $0.teamId == teamID && $0.archivedAt == nil }.map {
            DuesItem(id: UUID(), playerId: $0.id, amountCents: amountCents, status: .unpaid, paidAt: nil, playerName: $0.fullName)
        }
        let request = DuesRequest(id: UUID(), title: title, description: description, amountCents: amountCents,
                                  dueDate: dueDate.map(JSONCoding.formatDateOnly), createdAt: .now, items: items)
        world.dues.insert(.init(teamID: teamID, request: request), at: 0)
    }

    func setDuesStatus(itemID: UUID, status: DuesStatus) async throws {
        for r in world.dues.indices {
            if let i = world.dues[r].request.items.firstIndex(where: { $0.id == itemID }) {
                world.dues[r].request.items[i].status = status
                world.dues[r].request.items[i].paidAt = status == .paid ? .now : nil
            }
        }
    }

    func remindUnpaid(requestID: UUID) async throws -> Int {
        guard let stored = world.dues.first(where: { $0.request.id == requestID }) else { throw notFound("This request") }
        guard world.isPro(team: stored.teamID) else { throw BackendError.upgradeRequired("Payment reminders are a Coach Pro feature.") }
        return Set(stored.request.unpaidItems.map(\.playerId)).count
    }

    func connectPayments(teamID: UUID) async throws -> URL {
        await pause()
        world.paymentsEnabled.insert(teamID)
        return URL(string: "https://connect.stripe.com/express/onboarding/demo")!
    }

    func refreshPayments(teamID: UUID) async throws {}

    func checkout(itemIDs: [UUID]) async throws -> CheckoutSession {
        await pause()
        let items = world.dues.flatMap(\.request.items).filter { itemIDs.contains($0.id) }
        let subtotal = items.reduce(0) { $0 + $1.amountCents }
        // Demo: mark paid immediately so the flow is visible end to end.
        for id in itemIDs { try await setDuesStatus(itemID: id, status: .paid) }
        let fee = DuesFee.fee(forSubtotal: subtotal)
        return CheckoutSession(url: URL(string: "https://checkout.stripe.com/demo")!, subtotalCents: subtotal, feeCents: fee, totalCents: subtotal + fee)
    }
}

struct ReadKey: Hashable {
    let userID: UUID
    let threadID: UUID
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

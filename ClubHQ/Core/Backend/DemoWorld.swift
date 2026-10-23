import Foundation

/// Seed data and relationship rules for `DemoBackend`. Times are relative to `now` so
/// the demo always shows an upcoming practice, a game this weekend, and a recent result.
struct DemoWorld {
    struct Team { let id: UUID; var name: String; var ageGroup: String?; var season: String?; var sport: Sport; var brandColor: String?
        var venmoUsername: String? = nil; var cashappCashtag: String? = nil }
    struct Role { let userID: UUID; let teamID: UUID; let role: TeamRole }
    struct Link { let parentID: UUID; let playerID: UUID }
    struct StoredMessage { let threadID: UUID; var message: ChatMessage }
    struct StoredDues { let teamID: UUID; var request: DuesRequest }

    var teams: [Team] = []
    var roles: [Role] = []
    var links: [Link] = []
    var players: [Player] = []
    var contacts: [EmergencyContact] = []
    var events: [TeamEvent] = []
    var rsvps: [RSVP] = []
    var attendance: [AttendanceRecord] = []
    var threads: [MessageThread] = []
    var messages: [StoredMessage] = []
    var reads: [ReadKey: Date] = [:]
    var mutes: Set<ReadKey> = []
    var announcements: [Announcement] = []
    var inbox: [UUID: [InboxItem]] = [:]
    var dues: [StoredDues] = []
    var paymentsEnabled: Set<UUID> = []
    var proUsers: Set<UUID> = []
    var inviteTokens: [String: UUID] = [:]
    /// Co-parent invite token → player.
    var guardianInviteTokens: [String: UUID] = [:]
    var playerCodes: [String: UUID] = [:]
    var sponsors: [TeamSponsor] = []
    var names: [UUID: String] = [:]

    // Stable cast
    let coachID = UUID()
    let assistantID = UUID()
    let parentID = UUID()
    let playerUserID = UUID()
    let otherCoachID = UUID()
    let mayhemID = UUID()
    let fcID = UUID()
    var secondTeamID: UUID { fcID }

    init(now: Date) {
        let calendar = Calendar.current
        func day(_ offset: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            let base = calendar.startOfDay(for: now)
            let date = calendar.date(byAdding: .day, value: offset, to: base)!
            return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date)!
        }
        func years(ago: Int, month: Int = 3) -> String {
            let year = calendar.component(.year, from: now) - ago
            return String(format: "%04d-%02d-14", year, month)
        }

        names = [
            coachID: "Taylor Brooks", assistantID: "Sam Ortiz", parentID: "Alex Rivera",
            playerUserID: "Jordan Rivera", otherCoachID: "Lena Park",
        ]

        teams = [
            Team(id: mayhemID, name: "Mayhem Elite 14U", ageGroup: "14U", season: "Fall 2026", sport: .basketball, brandColor: nil,
                 venmoUsername: "Coach-Demo", cashappCashtag: "CoachDemo"),
            Team(id: fcID, name: "O'Fallon FC U10", ageGroup: "U10", season: "Fall 2026", sport: .soccer, brandColor: nil),
        ]
        roles = [
            Role(userID: coachID, teamID: mayhemID, role: .headCoach),
            Role(userID: assistantID, teamID: mayhemID, role: .assistantCoach),
            Role(userID: otherCoachID, teamID: fcID, role: .headCoach),
            Role(userID: parentID, teamID: mayhemID, role: .parent),
            Role(userID: parentID, teamID: fcID, role: .parent),
            Role(userID: playerUserID, teamID: mayhemID, role: .player),
        ]

        // Mayhem roster
        let mayhemRoster: [(String, String, String, String, Int)] = [
            ("Jordan", "Rivera", "3", "Point Guard", 14), ("Dev", "Shah", "11", "Shooting Guard", 14),
            ("Eli", "Green", "22", "Small Forward", 13), ("Noah", "Kim", "5", "Power Forward", 14),
            ("Marcus", "Lee", "34", "Center", 14), ("Caleb", "Brooks", "1", "Point Guard", 13),
            ("Isaiah", "Ford", "15", "Small Forward", 14), ("Luca", "Bianchi", "8", "Shooting Guard", 12),
        ]
        for (first, last, jersey, position, age) in mayhemRoster {
            players.append(Player(id: UUID(), teamId: mayhemID, firstName: first, lastName: last, jerseyNumber: jersey,
                                  position: position, birthdate: years(ago: age), notes: nil, archivedAt: nil,
                                  userId: first == "Jordan" ? playerUserID : nil))
        }
        let fcRoster: [(String, String, String, String)] = [
            ("Mia", "Rivera", "7", "Midfielder"), ("Sofia", "Lopez", "9", "Forward"), ("Emma", "Chen", "4", "Defender"),
            ("Lily", "Patel", "1", "Goalkeeper"), ("Zoe", "Adams", "10", "Midfielder"), ("Grace", "Wu", "6", "Defender"),
        ]
        for (first, last, jersey, position) in fcRoster {
            players.append(Player(id: UUID(), teamId: fcID, firstName: first, lastName: last, jerseyNumber: jersey,
                                  position: position, birthdate: years(ago: 10, month: 6), notes: nil, archivedAt: nil, userId: nil))
        }
        let jordan = players[0]
        let mia = players.first { $0.firstName == "Mia" }!
        links = [Link(parentID: parentID, playerID: jordan.id), Link(parentID: parentID, playerID: mia.id)]
        contacts = [
            EmergencyContact(id: UUID(), playerId: jordan.id, relationship: .mother, name: "Alex Rivera", phone: "(636) 555-0142", email: "alex@example.com"),
            EmergencyContact(id: UUID(), playerId: mia.id, relationship: .mother, name: "Alex Rivera", phone: "(636) 555-0142", email: "alex@example.com"),
        ]
        players[0].notes = "Strong court vision. Working on left-hand finishing."

        // Schedule
        let gym = ("Rec-Plex North", "425 Spencer Rd, St. Peters, MO 63376")
        func event(_ team: UUID, _ type: EventType, _ title: String, _ start: Date, minutes: Int = 90, location: (String, String)? = nil,
                   opponent: String? = nil, home: Bool = true, score: (Int, Int)? = nil) -> TeamEvent {
            TeamEvent(id: UUID(), teamId: team, title: title, eventType: type, startsAt: start, endsAt: start.addingTimeInterval(TimeInterval(minutes * 60)),
                      location: location?.0, locationAddress: location?.1, notes: type == .game ? "Arrive 30 minutes early. Dark jerseys." : nil,
                      opponent: opponent, homeAway: type == .game ? (home ? "home" : "away") : nil,
                      homeScore: score?.0, awayScore: score?.1, result: nil, cancelledAt: nil, rsvpCutoffAt: nil)
        }
        let lastGame = event(mayhemID, .game, "Game vs Gateway Hoops", day(-3, 10), minutes: 60, location: gym, opponent: "Gateway Hoops", score: (54, 48))
        let lastPractice = event(mayhemID, .practice, "Practice", day(-2, 18), location: gym)
        let nextPractice = event(mayhemID, .practice, "Practice", day(1, 18), location: gym)
        let nextGame = event(mayhemID, .game, "Game at STL Stars", day(4, 11), minutes: 60, location: ("Chesterfield Athletic Center", "16365 Lydia Hill Dr, Chesterfield, MO"), opponent: "STL Stars", home: false)
        events = [
            lastGame, lastPractice, nextPractice, nextGame,
            event(mayhemID, .practice, "Practice", day(6, 18), location: gym),
            event(mayhemID, .practice, "Shooting clinic", day(8, 17), minutes: 60, location: gym),
            event(mayhemID, .game, "Game vs Lake Saint Louis Lakers", day(11, 9), minutes: 60, location: gym, opponent: "Lake Saint Louis Lakers"),
            event(fcID, .practice, "Practice", day(2, 17, 30), minutes: 60, location: ("Fort Zumwalt Park", "1000 Jessup Ln, O'Fallon, MO")),
            event(fcID, .game, "Game vs Lake St. Louis SC", day(4, 9), minutes: 60, location: ("Fort Zumwalt Park", "1000 Jessup Ln, O'Fallon, MO"), opponent: "Lake St. Louis SC"),
            event(fcID, .practice, "Practice", day(9, 17, 30), minutes: 60, location: ("Fort Zumwalt Park", "1000 Jessup Ln, O'Fallon, MO")),
        ]

        let mayhemPlayers = players.filter { $0.teamId == mayhemID }
        for (index, player) in mayhemPlayers.enumerated() where index != 0 && index < 6 {
            rsvps.append(RSVP(id: UUID(), eventId: nextGame.id, playerId: player.id, status: index == 4 ? .no : .yes,
                              note: index == 4 ? "Family wedding, sorry!" : nil, respondedBy: parentID, updatedAt: now))
        }
        rsvps.append(RSVP(id: UUID(), eventId: nextPractice.id, playerId: mayhemPlayers[1].id, status: .yes, note: nil, respondedBy: parentID, updatedAt: now))
        for (index, player) in mayhemPlayers.enumerated() {
            attendance.append(AttendanceRecord(id: UUID(), eventId: lastPractice.id, playerId: player.id, status: index == 6 ? .absent : (index == 3 ? .late : .present)))
            attendance.append(AttendanceRecord(id: UUID(), eventId: lastGame.id, playerId: player.id, status: index == 7 ? .excused : .present))
        }

        // Messaging
        func thread(_ team: UUID, _ title: String, _ audience: MessageAudience, pinned: Bool = false) -> MessageThread {
            MessageThread(id: UUID(), teamId: team, kind: .team, eventId: nil, audience: audience, title: title, pinned: pinned,
                          updatedAt: now, lastMessage: nil, lastMessageAt: nil, lastAuthorName: nil, unread: false, muted: false)
        }
        let chat = thread(mayhemID, "Team chat", .both, pinned: true)
        let carpool = thread(mayhemID, "Saturday carpool", .parents)
        let staff = thread(mayhemID, "Coaches", .staff)
        let fcChat = thread(fcID, "Team chat", .both, pinned: true)
        threads = [chat, carpool, staff, fcChat]
        // Conversation times are anchored to real clock times on previous days, so the demo
        // (and App Store screenshots) always read naturally regardless of when it's opened.
        let priyaID = UUID(), marcusID = UUID()
        names[priyaID] = "Priya Shah"
        names[marcusID] = "Marcus Green"
        func say(_ thread: MessageThread, _ author: UUID, _ body: String, day dayOffset: Int, _ hour: Int, _ minute: Int) {
            messages.append(StoredMessage(threadID: thread.id, message: ChatMessage(
                id: UUID(), authorId: author, authorName: "", body: body,
                createdAt: day(dayOffset, hour, minute), editedAt: nil, isDeleted: false, isMine: false)))
        }
        say(chat, coachID, "Great win Saturday! 54–48 — proud of the defensive effort in the 4th. 🏀", day: -2, 18, 5)
        say(chat, parentID, "So fun to watch. Thanks coaches!", day: -2, 18, 12)
        say(chat, priyaID, "Dev hasn't stopped talking about that last steal 😂", day: -2, 18, 20)
        say(chat, playerUserID, "Can we run the press again at practice?", day: -2, 19, 2)
        say(chat, coachID, "Absolutely. We'll work on the press and free throws Thursday.", day: -2, 19, 10)
        say(chat, marcusID, "Is the Saturday game still at 11? Want to plan the drive to Chesterfield.", day: -1, 16, 41)
        say(chat, coachID, "Yes — tip-off 11:00, please arrive by 10:30. Dark jerseys.", day: -1, 16, 55)
        say(chat, parentID, "We can take two kids if anyone needs a ride 🚗", day: -1, 17, 3)
        say(chat, coachID, "Reminder: next practice is 6pm at Rec-Plex North. Bring both jerseys 👕", day: -1, 19, 30)
        say(carpool, parentID, "I can drive 3 kids to Chesterfield on Saturday — leaving O'Fallon at 10:00.", day: -1, 12, 15)
        say(carpool, coachID, "Thanks Alex! Dev and Eli's families are looking for rides.", day: -1, 13, 2)
        say(staff, assistantID, "I'll bring the new practice pinnies Tuesday.", day: -1, 9, 40)
        say(fcChat, otherCoachID, "Shin guards required at every practice this season, please!", day: -1, 15, 20)

        announcements = [
            Announcement(id: UUID(), teamId: mayhemID, title: "Fall tournament registration",
                         body: "We're entered in the Gateway Fall Classic (Nov 8–9). Dues cover the entry fee. Please RSVP to both games by Wednesday.",
                         createdAt: now.addingTimeInterval(-86_400 * 2), createdBy: coachID),
            Announcement(id: UUID(), teamId: mayhemID, title: "Uniform pickup",
                         body: "New reversible jerseys are in! Pick them up before Tuesday's practice.",
                         createdAt: now.addingTimeInterval(-86_400 * 6), createdBy: coachID),
            Announcement(id: UUID(), teamId: fcID, title: "Picture day",
                         body: "Team photos before the game on Saturday — arrive by 8:30 in full uniform.",
                         createdAt: now.addingTimeInterval(-86_400), createdBy: otherCoachID),
        ]

        // Money
        let duesItems = mayhemPlayers.enumerated().map { index, player in
            DuesItem(id: UUID(), playerId: player.id, amountCents: 15_000, status: index < 5 && index != 0 ? .paid : (index == 7 ? .waived : .unpaid),
                     paidAt: index < 5 && index != 0 ? now.addingTimeInterval(-86_400 * Double(index)) : nil, playerName: player.fullName)
        }
        let tournamentItems = mayhemPlayers.map {
            DuesItem(id: UUID(), playerId: $0.id, amountCents: 4_000, status: .unpaid, paidAt: nil, playerName: $0.fullName)
        }
        dues = [
            StoredDues(teamID: mayhemID, request: DuesRequest(id: UUID(), title: "Gateway Fall Classic entry", description: "Covers tournament entry and referee fees.",
                                                              amountCents: 4_000, dueDate: JSONCoding.formatDateOnly(day(7, 12)), createdAt: now.addingTimeInterval(-86_400), items: tournamentItems)),
            StoredDues(teamID: mayhemID, request: DuesRequest(id: UUID(), title: "Fall season dues", description: "Gym rental, jerseys, and league fees for Fall 2026.",
                                                              amountCents: 15_000, dueDate: JSONCoding.formatDateOnly(day(-5, 12)), createdAt: now.addingTimeInterval(-86_400 * 20), items: duesItems)),
        ]
        paymentsEnabled = [mayhemID]
        sponsors = [TeamSponsor(id: UUID(), teamId: mayhemID, name: "Mid-Rivers Pizza Co.", tagline: "Proud sponsor of Mayhem Elite — 10% off team nights",
                                logoUrl: nil, linkUrl: nil)]

        // Inbox
        func item(_ kind: NotificationKind, _ subject: String, _ body: String, team: UUID, ref: UUID?, path: String?, hoursAgo: Double, read: Bool = false) -> InboxItem {
            InboxItem(id: UUID(), linkPath: path, readAt: read ? now : nil, createdAt: now.addingTimeInterval(-hoursAgo * 3600),
                      kind: kind, subject: subject, body: body, teamId: team, refId: ref)
        }
        let familyInbox = [
            item(.messageNew, "Team chat", "Reminder: practice tomorrow 6pm at Rec-Plex North. Bring both jerseys.", team: mayhemID, ref: chat.id, path: "/team/messages/\(chat.id.uuidString)", hoursAgo: 0.75),
            item(.eventCreated, "New: Game at STL Stars", "Saturday 11:00 AM · Chesterfield Athletic Center", team: mayhemID, ref: nextGame.id, path: "/event/\(nextGame.id.uuidString)", hoursAgo: 20),
            item(.announcement, "Picture day", "Team photos before the game on Saturday.", team: fcID, ref: nil, path: "/parent", hoursAgo: 24, read: true),
        ]
        inbox = [
            parentID: familyInbox,
            playerUserID: [familyInbox[0], familyInbox[1]],
            coachID: [
                item(.messageNew, "Saturday carpool", "I can drive 3 kids to Chesterfield on Saturday.", team: mayhemID, ref: carpool.id, path: "/team/messages/\(carpool.id.uuidString)", hoursAgo: 5),
                item(.rsvpReminder, "3 players haven't responded", "Game at STL Stars — RSVPs close 4 hours before tip-off.", team: mayhemID, ref: nextGame.id, path: "/event/\(nextGame.id.uuidString)", hoursAgo: 8),
            ],
        ]
    }

    // MARK: - Queries

    func userID(for persona: Persona) -> UUID {
        switch persona {
        case .coach: coachID
        case .parent: parentID
        case .player: playerUserID
        }
    }

    func name(of userID: UUID) -> String { names[userID] ?? "Member" }

    func isPro(team teamID: UUID) -> Bool {
        roles.contains { $0.teamID == teamID && $0.role == .headCoach && proUsers.contains($0.userID) }
    }

    func context(for uid: UUID) -> UserContext {
        let teamIDs = Set(roles.filter { $0.userID == uid }.map(\.teamID))
            .union(links.filter { $0.parentID == uid }.compactMap { link in players.first { $0.id == link.playerID }?.teamId })
        let memberships = teams.filter { teamIDs.contains($0.id) }.map { team -> TeamMembership in
            let teamRoles = roles.filter { $0.userID == uid && $0.teamID == team.id }.map(\.role)
            let linked = links.filter { $0.parentID == uid }
                .compactMap { link in players.first { $0.id == link.playerID && $0.teamId == team.id && $0.archivedAt == nil } }
                .map(summary)
            let me = players.first { $0.teamId == team.id && $0.userId == uid }.map(summary)
            return TeamMembership(id: team.id, name: team.name, ageGroup: team.ageGroup, season: team.season, sport: team.sport,
                                  brandColor: team.brandColor, venmoUsername: team.venmoUsername,
                                  cashappCashtag: team.cashappCashtag, orgId: nil, roles: teamRoles, linkedPlayers: linked, playerSelf: me,
                                  isPro: isPro(team: team.id))
        }
        return UserContext(userId: uid, email: "\(name(of: uid).lowercased().replacingOccurrences(of: " ", with: "."))@example.com",
                           fullName: name(of: uid), isCoachPro: proUsers.contains(uid), teams: memberships)
    }

    func summary(_ player: Player) -> PlayerSummary {
        PlayerSummary(id: player.id, teamId: player.teamId, firstName: player.firstName, lastName: player.lastName,
                      jerseyNumber: player.jerseyNumber, birthdate: player.birthdate, position: player.position)
    }

    /// Mirrors `private.can_read_thread` (incl. the new player rule).
    func canRead(thread: MessageThread, membership: TeamMembership) -> Bool {
        if membership.isStaff { return true }
        switch thread.audience {
        case .both: return membership.isGuardian || membership.isPlayer
        case .parents: return membership.isGuardian
        case .staff: return false
        }
    }

    func members(of teamID: UUID) -> [TeamMember] {
        var result: [UUID: TeamMember] = [:]
        for role in roles where role.teamID == teamID && role.role.isStaff {
            result[role.userID, default: TeamMember(userId: role.userID, name: name(of: role.userID), roles: [], children: [])].roles.append(role.role)
        }
        for link in links {
            guard let player = players.first(where: { $0.id == link.playerID && $0.teamId == teamID }) else { continue }
            var member = result[link.parentID, default: TeamMember(userId: link.parentID, name: name(of: link.parentID), roles: [], children: [])]
            if !member.roles.contains(.parent) { member.roles.append(.parent) }
            member.children.append(player.firstName)
            result[link.parentID] = member
        }
        for player in players where player.teamId == teamID {
            guard let uid = player.userId else { continue }
            result[uid, default: TeamMember(userId: uid, name: player.fullName, roles: [], children: [])].roles.append(.player)
        }
        return result.values.sorted { $0.name < $1.name }
    }
}

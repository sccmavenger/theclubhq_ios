import Foundation
import Testing
@testable import ClubHQ

/// Clubs (D-044), app side: pasted team lists, grouping, filters, director capabilities.
@MainActor
struct ClubTests {
    @Test func pastedListParsesCommasTabsAndEmails() {
        let text = """
        Team, Grade, Gender, Level, Season, Coach
        3D Nation 6th Boys, 6th, Boys, Elite, Fall 2026, coach@example.com
        3D Nation 6th Girls\t6\tGirls\tGold
        7th Boys Select
        """
        let teams = ClubGrouping.parseTeamList(text)
        #expect(teams.count == 3, "the header row is skipped")
        #expect(teams[0] == NewClubTeam(name: "3D Nation 6th Boys", grade: "6", gender: "boys", level: "Elite", season: "Fall 2026", coachEmail: "coach@example.com"))
        #expect(teams[1].gender == "girls" && teams[1].level == "Gold" && teams[1].coachEmail == nil)
        #expect(teams[2] == NewClubTeam(name: "7th Boys Select"))
    }

    @Test func gradeLabelsAndSections() {
        #expect(ClubGrouping.gradeLabel("6") == "6th")
        #expect(ClubGrouping.gradeLabel("3") == "3rd")
        #expect(ClubGrouping.gradeLabel("U12") == "U12")
        #expect(ClubGrouping.gradeSection("8") == "8th Grade")
        #expect(ClubGrouping.gradeSection(nil) == "Other teams")
    }

    @Test func filterMatchesEveryChosenGroup() throws {
        let overview = DemoBackend.sampleClubOverview()
        #expect(overview.teams.filter(ClubFilter().matches).count == 8)
        let sixthBoys = ClubFilter(grades: ["6"], genders: ["boys"])
        #expect(overview.teams.filter(sixthBoys.matches).map(\.name) == ["3D Nation 2033 6th Boys", "3D Nation 6th Boys Gold"])
        let elite = ClubFilter(levels: ["Elite"])
        #expect(overview.teams.filter(elite.matches).count == 5)
        #expect(overview.values(\.grade) == ["5", "6", "7", "8"])
        #expect(overview.teams.filter(\.needsAttention).map(\.name) == ["3D Nation 7th Girls"])
    }

    @Test func directorsActAsHeadCoachButAreMarkedAsDirectors() {
        let team = TeamMembership(id: UUID(), name: "6th Girls", roles: [.programDirector], linkedPlayers: [], isPro: true)
        #expect(team.isHeadCoach && team.canManageSchedule && team.canManageRoster)
        #expect(team.isClubDirectorOnly)
        let coach = TeamMembership(id: UUID(), name: "6th Girls", roles: [.headCoach, .programDirector], linkedPlayers: [], isPro: true)
        #expect(!coach.isClubDirectorOnly)
    }

    @Test func contextDecodesClubsAndClubAnnouncements() throws {
        let json = #"{"user_id":"0f97d776-45f5-4aff-97c8-19c885970c99","email":"d@example.com","full_name":"D","is_coach_pro":false,"teams":[],"clubs":[{"id":"1c9f0288-38ce-4a4d-9755-d34a42187290","name":"3D Basketball Academy","brand_color":null,"team_count":21}]}"#
        let context = try JSONCoding.decoder.decode(UserContext.self, from: Data(json.utf8))
        #expect(context.clubs?.first?.name == "3D Basketball Academy" && context.clubs?.first?.teamCount == 21)
        let a = #"{"id":"1c9f0288-38ce-4a4d-9755-d34a42187290","team_id":"1c9f0288-38ce-4a4d-9755-d34a42187290","title":"Picture day","body":"Bring jerseys","created_at":"2026-10-29T12:00:00Z","created_by":"0f97d776-45f5-4aff-97c8-19c885970c99","from_club":"3D Basketball Academy"}"#
        #expect(try JSONCoding.decoder.decode(Announcement.self, from: Data(a.utf8)).fromClub == "3D Basketball Academy")
        #expect(context.clubs?.first?.isPending == false, "Older servers don't send pending: the club is active")
    }

    /// New clubs wait for approval (D-051); the Club tab shows that instead of an error.
    @Test func pendingClubsAreFlagged() throws {
        let json = #"{"id":"1c9f0288-38ce-4a4d-9755-d34a42187290","name":"New Club","brand_color":null,"team_count":0,"pending":true}"#
        #expect(try JSONCoding.decoder.decode(ClubSummary.self, from: Data(json.utf8)).isPending)
    }

    @Test func demoClubAddsTeamsAndAudience() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let id = try await backend.createClub(name: "QA Club")
        let created = try await backend.clubCreateTeams(orgID: id, teams: [NewClubTeam(name: "A", grade: "6", gender: "boys", coachEmail: "c@x.com"), NewClubTeam(name: "B", grade: "7")])
        #expect(created.count == 2 && created[0].coach?.status == .invited)
        let overview = try await backend.clubOverview(orgID: id)
        #expect(overview.teams.map(\.name) == ["A", "B"])
        #expect(try await backend.clubAudience(orgID: id, filter: ClubFilter(grades: ["6"])).teamCount == 1)
    }
}

/// Deleting a team (D-046): who may, and the demo flow.
@MainActor
struct DeleteTeamTests {
    @Test func onlyHeadCoachOfIndependentOrDirectorOfClub() {
        func team(_ roles: [TeamRole], club: Bool?) -> TeamMembership {
            TeamMembership(id: UUID(), name: "T", roles: roles, linkedPlayers: [], isPro: false, isClubTeam: club)
        }
        #expect(team([.headCoach], club: false).canDeleteTeam)
        #expect(team([.headCoach], club: nil).canDeleteTeam, "older servers: treated as independent")
        #expect(!team([.assistantCoach], club: false).canDeleteTeam)
        #expect(!team([.parent], club: false).canDeleteTeam)
        #expect(!team([.headCoach], club: true).canDeleteTeam, "a club team's coach can't")
        #expect(team([.programDirector], club: true).canDeleteTeam)
    }

    @Test func demoDeleteNeedsTheNameAndRemovesTheTeam() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let team = try #require(try await backend.loadContext().teams.first(where: \.isHeadCoach))
        await #expect(throws: BackendError.self) {
            try await backend.deleteTeam(teamID: team.id, confirmName: "nope", notifyFamilies: false)
        }
        try await backend.deleteTeam(teamID: team.id, confirmName: team.name.uppercased(), notifyFamilies: true)
        #expect(try await backend.loadContext().teams.contains { $0.id == team.id } == false)
    }
}

/// Club portal Phase A in the app (D-053): director codes and editing a club event.
@MainActor
struct ClubPortalAppTests {
    @Test func directorCodePreviewDecodes() throws {
        let json = #"{"kind":"director","club_name":"3D Basketball Academy","team_name":null,"role":"program_director","movable_teams":[]}"#
        let preview = try JSONCoding.decoder.decode(ClubInvitePreview.self, from: Data(json.utf8))
        #expect(preview.kind == .director)
        #expect(preview.role == .programDirector)
    }

    @Test func clubEventDecodesWithAndWithoutPlace() throws {
        let old = #"{"club_event_id":"6F1C2A6E-1111-4C59-9D3B-1B1B1B1B1B1B","title":"Picture Day","event_type":"other","starts_at":"2026-11-08T18:00:00Z","team_count":24}"#
        let new = #"{"club_event_id":"6F1C2A6E-1111-4C59-9D3B-1B1B1B1B1B1B","title":"Picture Day","event_type":"other","starts_at":"2026-11-08T18:00:00Z","ends_at":null,"location":"Academy gym","location_address":null,"notes":"Home jersey","team_count":24}"#
        let a = try JSONCoding.decoder.decode(ClubOverview.ClubEvent.self, from: Data(old.utf8))
        let b = try JSONCoding.decoder.decode(ClubOverview.ClubEvent.self, from: Data(new.utf8))
        #expect(a.location == nil && b.location == "Academy gym" && b.notes == "Home jersey")
    }

    @Test func clubEventEditValidation() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var edit = ClubEventEdit(event: .init(clubEventId: UUID(), title: "Tryouts", eventType: .other, startsAt: start, teamCount: 3))
        #expect(edit.isValid && edit.location.isEmpty)
        edit.endsAt = start.addingTimeInterval(-60)
        #expect(!edit.isValid)
        edit.endsAt = start.addingTimeInterval(3600)
        edit.title = "  "
        #expect(!edit.isValid)
    }

    @Test func demoEditUpdatesTheClubEvent() async throws {
        let backend = DemoBackend()
        let orgID = try await backend.createClub(name: "Demo Club")
        let created = try await backend.clubCreateTeams(orgID: orgID, teams: [NewClubTeam(name: "8th Boys Elite", grade: "8")])
        var draft = EventDraft(teamId: try #require(created.first).teamId)
        draft.title = "Picture Day"
        _ = try await backend.clubEvent(orgID: orgID, filter: ClubFilter(), draft: draft)
        let event = try #require(try await backend.clubOverview(orgID: orgID).clubEvents.first)
        var edit = ClubEventEdit(event: event)
        edit.location = "Main gym"
        _ = try await backend.clubEventUpdate(clubEventID: event.clubEventId, edit: edit, notify: true)
        #expect(try await backend.clubOverview(orgID: orgID).clubEvents.first?.location == "Main gym")
    }
}

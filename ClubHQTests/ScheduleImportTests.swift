import Foundation
import Testing
@testable import ClubHQ

/// Tournament schedule import (D-042), app side. Uses the bundled `import-preview` response for
/// the real 2026 CNR sheet (the same one Demo Mode shows).
@MainActor
struct ScheduleImportTests {
    private let me = "6b-carter:3d-nation-2033-6th-boys"
    private let cnr = "https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vQoH24Yk3kQM7zd5_uX8JOXgwmHYN8pCKl8jAemdHtFo2ldPSo-sNFtJnQRF5Qsjre9JFGOstXi2urS/pubhtml?pli=1"

    private func coachTeam(_ backend: DemoBackend, name: String? = nil) async throws -> TeamMembership {
        var team = try #require(try await backend.loadContext().teams.first(where: \.isHeadCoach))
        if let name { team.name = name }
        return team
    }

    // MARK: - Preview model

    @Test func previewDecodesTheRealTournament() throws {
        let preview = try DemoBackend.sampleImportPreview()
        #expect(preview.source.title == "2026 CNR October 3-4 Tournament")
        #expect(preview.source.timeZone == "America/Chicago")
        #expect(preview.teams.count == 76)
        #expect(preview.games.count == 112)
        #expect(preview.match.outcome == .clear)
        #expect(preview.match.teamKeys == [me])
        #expect(preview.teamsByBracket.count == 17)
    }

    @Test func ownerGamesReadFromOurSide() throws {
        let preview = try DemoBackend.sampleImportPreview()
        let games = preview.games(for: me)
        #expect(games.count == 3)
        #expect(games.map { $0.opponentLabel(teamKey: me, alias: nil) } == ["vs STL Grizzlies", "vs Rise & Reign Maroon", "vs Arch city Select Gold"])
        #expect(games.map { $0.scoreLine(teamKey: me, alias: nil) } == ["L 26–30", "W 50–24", "L 33–37"])
        #expect(games.map(\.placeLabel) == ["Beal Center · Court 6", "Beal Center · Court 6", "Beal Center · Court 5"])
        #expect(games.first?.startsAt == JSONCoding.parseTimestamp("2026-10-03T21:00:00.000Z"))
        #expect(games.last?.round == "3rd Place Game")
    }

    @Test func aliasFindsGamesByBracketName() throws {
        let preview = try DemoBackend.sampleImportPreview()
        let elite = try #require(preview.teams.first { $0.name == "Elite Status Freshmen Boys" })
        let bracket = try #require(preview.bracket(for: elite))
        #expect(bracket.unmatchedNames == ["Elite status"])
        let plain = preview.games(for: elite.key).count
        #expect(preview.games(for: elite.key, alias: "Elite status").count > plain)
    }

    @Test func clashesFlagOverlappingEvents() throws {
        var preview = try DemoBackend.sampleImportPreview()
        let game = try #require(preview.games(for: me).first)
        let start = try #require(game.startsAt)
        preview.existingEvents = [
            ImportExistingEvent(id: UUID(), title: "Practice", eventType: .practice, opponent: nil, homeAway: nil,
                                startsAt: start.addingTimeInterval(-30 * 60), endsAt: start.addingTimeInterval(30 * 60)),
            ImportExistingEvent(id: UUID(), title: "Team dinner", eventType: .other, opponent: nil, homeAway: nil,
                                startsAt: start.addingTimeInterval(3 * 3600), endsAt: nil),
        ]
        #expect(preview.clashes(with: game).map(\.title) == ["Practice"])
    }

    @Test func textHelpers() {
        #expect(ScheduleImportText.gradeLabel("6") == "6th")
        #expect(ScheduleImportText.gradeLabel("3") == "3rd")
        #expect(ScheduleImportText.gradeLabel("11") == "11th")
        #expect(ScheduleImportText.gradeLabel("9") == "Freshmen")
        #expect(ScheduleImportText.grade(in: "3D Nation 6th Grade") == "6")
        #expect(ScheduleImportText.grade(in: "Mayhem Elite 14U") == nil)
        #expect(ScheduleImportText.gender(in: "Knights 7th Girls") == "girls")
        #expect(ScheduleImportText.looksLikeSheetLink(cnr))
        #expect(!ScheduleImportText.looksLikeSheetLink("https://example.com/schedule"))
    }

    // MARK: - Flow

    @Test func happyPathImportsThreeGamesThenUndoes() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let team = try await coachTeam(backend, name: "3D Nation 6th Grade")
        var changes = 0
        let flow = ScheduleImportFlow(team: team, backend: backend) { changes += 1 }
        flow.url = cnr
        await flow.read()
        #expect(flow.errorMessage == nil)
        #expect(flow.path == [.confirm])

        await flow.choose(me)
        #expect(flow.path == [.confirm, .preview])
        #expect(flow.selectedCount == 3)
        #expect(flow.levelWarning == nil)

        await flow.commit()
        #expect(flow.path == [.done])
        #expect(flow.result?.added == 3)
        #expect(flow.result?.upcoming == 0)
        #expect(flow.canUndo)
        #expect(!flow.hasUpcomingSelection)
        let imported = try await backend.events(teamIDs: [team.id], from: .distantPast, to: nil).filter(\.isImported)
        #expect(imported.count == 3)
        #expect(changes == 1)

        await flow.undo()
        #expect(flow.isUndone)
        let left = try await backend.events(teamIDs: [team.id], from: .distantPast, to: nil).filter(\.isImported)
        #expect(left.isEmpty)
    }

    @Test func uncheckedGamesAreSkipped() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let flow = ScheduleImportFlow(team: try await coachTeam(backend), backend: backend)
        flow.url = cnr
        await flow.read()
        await flow.choose(me)
        flow.toggle(try #require(flow.chosenGames.last))
        #expect(flow.selectedCount == 2)
        await flow.commit()
        #expect(flow.result?.added == 2)
    }

    @Test func notMyTeamPicksAnotherAndWarnsAboutGrade() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let flow = ScheduleImportFlow(team: try await coachTeam(backend, name: "3D Nation 6th Grade"), backend: backend)
        flow.url = cnr
        await flow.read()
        flow.path.append(.list(noGuess: false))
        await flow.choose("7b-miller:arch-city-select-gold-7th-boys")
        #expect(flow.path.last == .preview)
        #expect(flow.levelWarning?.contains("6th grade, but this team is 7th") == true)
        flow.changeTeam()
        #expect(flow.path == [.list(noGuess: false)])
    }

    @Test func wrongLinkExplainsItself() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let flow = ScheduleImportFlow(team: try await coachTeam(backend), backend: backend)
        flow.url = "https://example.com/schedule"
        await flow.read()
        #expect(flow.errorCode == "not_a_sheet")
        #expect(flow.errorMessage?.contains("Google Sheets") == true)
        #expect(flow.path.isEmpty)
    }

    @Test func secondImportRemembersTheTeam() async throws {
        let backend = DemoBackend(persona: .coach, latency: .zero)
        let team = try await coachTeam(backend, name: "Saturday Squad")
        let first = ScheduleImportFlow(team: team, backend: backend)
        first.url = cnr
        await first.read()
        first.path.append(.list(noGuess: false))
        await first.choose("8b-drexler:mavericks-2031-blue-8th-boys")
        await first.commit()

        let again = ScheduleImportFlow(team: team, backend: backend)
        again.url = cnr
        await again.read()
        #expect(again.preview?.match.teamKeys == ["8b-drexler:mavericks-2031-blue-8th-boys"])
        #expect(again.preview?.previousImport?.eventCount == first.result?.added)
        await again.choose("8b-drexler:mavericks-2031-blue-8th-boys")
        #expect(again.isReimport)
        await again.commit()
        // Undo would remove the games from the first import too, so it isn't offered.
        #expect(!again.canUndo)
        #expect(try await backend.scheduleImports(teamID: team.id).count == 1)
    }

    // MARK: - CNR league (D-043)

    @Test func leagueGamesMergeAndAwayGamesShowAt() throws {
        var preview = try DemoBackend.sampleImportPreview()
        preview.source.kind = "cnr_league"
        #expect(preview.isLeague && preview.homeIsRight)
        let games = preview.games(for: me)
        let key = try #require(preview.teams.first { $0.key == me }?.key)

        // A league preview only carries the guessed teams' games; picking another loads more.
        var partial = preview
        partial.games = []
        if let i = partial.teams.firstIndex(where: { $0.key == key }) { partial.teams[i].gameCount = nil }
        #expect(partial.team(key)?.gameCountLabel == nil)
        partial.merge(preview)
        #expect(partial.games(for: me).count == games.count)
        #expect(partial.team(key)?.gameCount == 3)
        partial.merge(preview)
        #expect(partial.games.count == preview.games.count, "merging twice adds nothing")

        // We're on the right (home) in every CNR October game; flip one to see "@".
        var away = try #require(games.first)
        swap(&away.left, &away.right)
        #expect(away.opponentLabel(teamKey: me, alias: nil, homeIsRight: true) == "@ STL Grizzlies")
        #expect(games[0].opponentLabel(teamKey: me, alias: nil, homeIsRight: true) == "vs STL Grizzlies")
    }

    @Test func leagueLinksAreRecognized() {
        #expect(ScheduleImportText.looksLikeLeagueLink("https://cnrschedule.stlbasketball.com/"))
        #expect(ScheduleImportText.looksLikeLeagueLink("webcal://cnrnovdec2026schedules.stlbasketball.com/3d-nation-2033-6th-boys.ics"))
        #expect(!ScheduleImportText.looksLikeLeagueLink("https://stlbasketball.com.example.com/"))
    }
}

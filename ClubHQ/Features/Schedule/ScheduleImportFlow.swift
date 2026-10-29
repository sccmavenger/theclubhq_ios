import Foundation
import Observation

/// One screen of the schedule import (D-042 sheets, D-043 league, D-047 calendars). The link screen is the root.
enum ImportStep: Hashable {
    /// "Is this your team?" — one strong match.
    case confirm
    /// "Which one is yours?" — a few close matches.
    case choices
    /// Every team, grouped by bracket. `noGuess` when nothing matched well.
    case list(noGuess: Bool)
    /// The team is listed but none of its bracket's games use that name.
    case alias
    case preview
    case report(ImportReportReason)
    case done
}

/// State for the import sheet: the link, what the server read, and the coach's choices.
@MainActor
@Observable
final class ScheduleImportFlow {
    let team: TeamMembership
    private let backend: any ClubHQBackend
    private let onChange: () -> Void

    var path: [ImportStep] = []
    var url = ""
    var errorMessage: String?
    var errorCode: String?
    /// The sheet doesn't say when the tournament starts, so the coach picks the first day.
    var needsFirstDay = false
    var firstDay = Calendar.current.startOfDay(for: .now)

    private(set) var preview: ImportPreview?
    /// Loading a league team's games after the coach picks it.
    private(set) var isLoadingTeam = false
    private(set) var chosenKey: String?
    private(set) var alias: String?
    var selectedGameKeys: Set<String> = []
    private(set) var result: ImportResult?
    private(set) var isUndone = false
    private(set) var familiesNotified = false
    /// Closes the whole import sheet (a pushed step's own `dismiss` only pops that step).
    var close: () -> Void = {}

    init(team: TeamMembership, backend: any ClubHQBackend, onChange: @escaping () -> Void = {}) {
        self.team = team
        self.backend = backend
        self.onChange = onChange
    }

    var chosenTeam: ImportTeam? { chosenKey.flatMap { preview?.team($0) } }

    /// Team calendars (D-047) bring practices and other events too, so they count "events".
    var isCalendar: Bool { preview?.isCalendar == true }

    /// "1 game" / "3 games", or "1 event" / "3 events" for a calendar. `capitalized` for buttons.
    func count(_ n: Int, capitalized: Bool = false) -> String {
        let noun = isCalendar ? (n == 1 ? "event" : "events") : (n == 1 ? "game" : "games")
        return "\(n) \(capitalized ? noun.capitalized : noun)"
    }

    /// The chosen team's games, in time order.
    var chosenGames: [ImportGame] {
        guard let preview, let chosenKey else { return [] }
        return preview.games(for: chosenKey, alias: alias)
    }

    var importableGames: [ImportGame] { chosenGames.filter { $0.startsAt != nil } }
    /// Importing the same team from the same link again updates its games.
    var isReimport: Bool {
        guard chosenKey != nil else { return false }
        return preview?.previousImport?.teamKey == chosenKey || keptGameCount > 0
    }
    /// The chosen team's games already on the schedule from an earlier import the coach kept.
    var keptGameCount: Int {
        let kept = Set(preview?.keptKeys ?? [])
        return chosenGames.filter { kept.contains($0.key) }.count
    }
    var selectedCount: Int { importableGames.filter { selectedGameKeys.contains($0.key) }.count }
    /// Some checked games are still to be played, so families can be told after importing.
    var hasUpcomingSelection: Bool {
        importableGames.contains { selectedGameKeys.contains($0.key) && ($0.startsAt ?? .distantPast) > .now }
    }
    /// Undo removes everything the import added, so it's only offered the first time; after that,
    /// "Remove Games" on the Schedule screen is the deliberate way out.
    private(set) var canUndo = false

    private var firstDayParam: String? { needsFirstDay ? JSONCoding.formatDateOnly(firstDay) : nil }

    // MARK: Steps

    /// Reads the sheet, then goes to the step that fits how sure the match is.
    func read() async {
        errorMessage = nil
        errorCode = nil
        let link = url.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let preview = try await backend.importPreview(teamID: team.id, url: link, firstDay: firstDayParam, teamKey: nil)
            if preview.source.needsDates && !needsFirstDay {
                needsFirstDay = true
                errorMessage = "This sheet only lists days of the week. Pick the tournament's first day, then try again."
                return
            }
            self.preview = preview
            route(preview)
        } catch {
            errorCode = (error as? BackendError)?.code
            errorMessage = error.localizedDescription
        }
    }

    private func route(_ preview: ImportPreview) {
        // A calendar feed is one team's calendar: straight to its events.
        if preview.isCalendar, let key = preview.match.teamKeys.first {
            chosenKey = key
            alias = nil
            selectAllGames()
            path = [.preview]
            return
        }
        switch preview.match.outcome {
        case .clear:
            if let previous = preview.previousImport, previous.teamKey == preview.match.teamKeys.first {
                alias = previous.alias
            }
            path = [.confirm]
        case .choices:
            path = [.choices]
        case .none:
            path = [.list(noGuess: true)]
        }
    }

    /// The coach picked a team: preview its games, or ask which bracket name is theirs.
    /// League teams' games load on demand (D-043).
    func choose(_ key: String) async {
        guard !isLoadingTeam else { return }
        if preview?.isLeague == true, preview?.team(key)?.gameCount == nil {
            isLoadingTeam = true
            defer { isLoadingTeam = false }
            errorMessage = nil
            do {
                let more = try await backend.importPreview(
                    teamID: team.id, url: url.trimmingCharacters(in: .whitespacesAndNewlines), firstDay: nil, teamKey: key
                )
                preview?.merge(more)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        if key != chosenKey { alias = preview?.previousImport?.teamKey == key ? preview?.previousImport?.alias : nil }
        chosenKey = key
        if chosenGames.isEmpty {
            path.append(.alias)
        } else {
            selectAllGames()
            path.append(.preview)
        }
    }

    func chooseAlias(_ name: String) {
        alias = name
        selectAllGames()
        path.append(.preview)
    }

    /// Back to the full list from the preview ("Change team").
    func changeTeam() {
        path = [.list(noGuess: false)]
    }

    func toggle(_ game: ImportGame) {
        guard game.startsAt != nil else { return }
        if selectedGameKeys.contains(game.key) { selectedGameKeys.remove(game.key) } else { selectedGameKeys.insert(game.key) }
    }

    private func selectAllGames() {
        selectedGameKeys = Set(importableGames.map(\.key))
    }

    func commit() async {
        guard let chosenKey else { return }
        errorMessage = nil
        let keys = importableGames.map(\.key).filter(selectedGameKeys.contains)
        let firstImport = preview?.previousImport == nil
        do {
            result = try await backend.importCommit(
                teamID: team.id, url: url.trimmingCharacters(in: .whitespacesAndNewlines), teamKey: chosenKey, alias: alias,
                gameKeys: keys.count == importableGames.count ? nil : keys, firstDay: firstDayParam
            )
            isUndone = false
            familiesNotified = false
            canUndo = firstImport
            onChange()
            path = [.done]
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func undo() async {
        guard let result else { return }
        do {
            _ = try await backend.importUndo(importID: result.importId)
            isUndone = true
            onChange()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func notifyFamilies() async {
        guard let result else { return }
        do {
            familiesNotified = try await backend.importNotify(importID: result.importId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendReport(reason: ImportReportReason, note: String) async -> Bool {
        do {
            let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
            try await backend.importReport(teamID: team.id, url: url, reason: reason, note: trimmed.isEmpty ? nil : trimmed)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Start over with a different link.
    func reset() {
        path = []
        url = ""
        preview = nil
        chosenKey = nil
        alias = nil
        result = nil
        errorMessage = nil
        errorCode = nil
        needsFirstDay = false
    }

    // MARK: Warnings

    /// "Your ClubHQ team looks like 6th grade, but this team is 7th." Nil when they agree or we can't tell.
    var levelWarning: String? {
        guard let sheetTeam = chosenTeam else { return nil }
        var problems: [String] = []
        let ourGrade = ScheduleImportText.grade(in: team.name) ?? ScheduleImportText.grade(in: team.ageGroup)
        let theirGrades = [sheetTeam.grade, ScheduleImportText.grade(in: sheetTeam.name)].compactMap { $0 }
        if let ourGrade, !theirGrades.isEmpty, !theirGrades.contains(ourGrade),
           let ours = ScheduleImportText.gradeLabel(ourGrade), let theirs = ScheduleImportText.gradeLabel(theirGrades[0]) {
            problems.append("\(team.name) looks like \(ours) grade, but this team is \(theirs).")
        }
        let ourGender = ScheduleImportText.gender(in: team.name) ?? ScheduleImportText.gender(in: team.ageGroup)
        if let ourGender, let theirs = sheetTeam.gender, ourGender != theirs {
            problems.append("\(team.name) looks like a \(ourGender) team, but this one plays with the \(theirs).")
        }
        return problems.isEmpty ? nil : problems.joined(separator: " ")
    }
}

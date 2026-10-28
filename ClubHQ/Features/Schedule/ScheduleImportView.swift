import SwiftUI

/// Import a tournament schedule from the organizer's Google Sheets link (D-042):
/// paste the link → confirm or pick the team → review its games → import.
struct ScheduleImportView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var flow: ScheduleImportFlow

    init(team: TeamMembership, backend: any ClubHQBackend, onChange: @escaping () -> Void = {}) {
        _flow = State(initialValue: ScheduleImportFlow(team: team, backend: backend, onChange: onChange))
    }

    var body: some View {
        @Bindable var flow = flow
        NavigationStack(path: $flow.path) {
            ImportLinkStep(flow: flow)
                .navigationDestination(for: ImportStep.self) { step in
                    Group {
                        switch step {
                        case .confirm: ImportConfirmStep(flow: flow)
                        case .choices: ImportChoicesStep(flow: flow)
                        case .list(let noGuess): ImportTeamListStep(flow: flow, noGuess: noGuess)
                        case .alias: ImportAliasStep(flow: flow)
                        case .preview: ImportPreviewStep(flow: flow)
                        case .report(let reason): ImportReportStep(flow: flow, reason: reason)
                        case .done: ImportDoneStep(flow: flow)
                        }
                    }
                    .toolbar {
                        if step != .done {
                            ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { flow.close() } }
                        }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { flow.close() } }
                }
        }
        .onAppear { flow.close = { dismiss() } }
    }
}

// MARK: - Link

private struct ImportLinkStep: View {
    @Bindable var flow: ScheduleImportFlow
    @FocusState private var linkFocused: Bool

    var body: some View {
        Form {
            Section {
                TextField("docs.google.com/spreadsheets/…", text: $flow.url, axis: .vertical)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .lineLimit(1...3)
                    .focused($linkFocused)
                    .accessibilityLabel("Tournament schedule link")
                PasteButton(payloadType: String.self) { strings in
                    if let text = strings.first { flow.url = text.trimmingCharacters(in: .whitespacesAndNewlines) }
                }
                .labelStyle(.titleAndIcon)
            } header: {
                Text("Tournament schedule link")
            } footer: {
                Text("Paste the Google Sheets link the organizer shared. We'll find your team and show its games before anything is added.")
            }

            if flow.needsFirstDay {
                Section {
                    DatePicker("First day", selection: $flow.firstDay, displayedComponents: .date)
                } footer: {
                    Text("The sheet says \"Sat\" and \"Sun\" but not which weekend.")
                }
            }

            if let error = flow.errorMessage {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    if flow.errorCode == "no_games" || flow.errorCode == "unreadable" {
                        Button("Report this sheet") { flow.path.append(.report(flow.errorCode == "no_games" ? .gamesWrong : .unreadable)) }
                    }
                }
            }
        }
        .navigationTitle("Import Schedule")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                AsyncButton {
                    linkFocused = false
                    await flow.read()
                } label: {
                    Text("Find My Team")
                }
                .buttonStyle(BrandCTAButtonStyle())
                .disabled(flow.url.trimmingCharacters(in: .whitespaces).isEmpty)
                Text("Reading a big tournament can take a few seconds.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding()
            .background(.bar)
        }
    }
}

// MARK: - Picking the team

/// The shared row for a sheet team: name, level and coach, bracket, game count.
private struct ImportTeamRow: View {
    let team: ImportTeam
    var showBracket = true

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(team.name).font(.headline)
            if !team.detailLine.isEmpty {
                Text(team.detailLine).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                if showBracket, let bracket = team.bracketTitle ?? team.bracket {
                    Text(bracket).lineLimit(1)
                    Text("·")
                }
                Text(team.gameCountLabel)
                    .foregroundStyle(team.gameCount == 0 ? .orange : .secondary)
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct ImportConfirmStep: View {
    let flow: ScheduleImportFlow

    var body: some View {
        if let preview = flow.preview, let key = preview.match.teamKeys.first, let team = preview.team(key) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    TournamentHeader(source: preview.source)
                    Text("Is this your team?").font(.title2.bold())
                    VStack(alignment: .leading, spacing: 10) {
                        ImportTeamRow(team: team)
                        if let first = preview.games(for: key, alias: flow.alias).first {
                            Divider()
                            GameLine(game: first, teamKey: key, alias: flow.alias, timeZone: preview.timeZone)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.Brand.surface, in: .rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.Brand.border))
                    if preview.previousImport?.teamKey == key {
                        Label("You picked this team last time.", systemImage: "clock.arrow.circlepath")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    Button("Yes, That's Us") { flow.choose(key) }
                        .buttonStyle(BrandCTAButtonStyle())
                    Button("Not My Team") { flow.path.append(.list(noGuess: false)) }
                        .font(.headline)
                        .padding(.vertical, 8)
                }
                .padding()
                .background(.bar)
            }
            .navigationTitle("Your Team")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ImportChoicesStep: View {
    let flow: ScheduleImportFlow

    var body: some View {
        if let preview = flow.preview {
            List {
                Section {
                    TournamentHeader(source: preview.source)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    ForEach(preview.match.teamKeys.compactMap(preview.team), id: \.key) { team in
                        Button { flow.choose(team.key) } label: { ImportTeamRow(team: team) }
                            .tint(.primary)
                    }
                } header: {
                    Text("Which one is yours?")
                } footer: {
                    Text("These look closest to \(flow.team.name).")
                }
                Section {
                    Button("None of these — show all teams") { flow.path.append(.list(noGuess: false)) }
                }
            }
            .navigationTitle("Your Team")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ImportTeamListStep: View {
    let flow: ScheduleImportFlow
    let noGuess: Bool
    @State private var search = ""

    private func matches(_ team: ImportTeam) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return true }
        return [team.name, team.coach, team.bracket, team.bracketTitle].compactMap { $0 }
            .contains { $0.localizedStandardContains(query) }
    }

    var body: some View {
        if let preview = flow.preview {
            let groups = preview.teamsByBracket
                .map { (title: $0.title, teams: $0.teams.filter(matches)) }
                .filter { !$0.teams.isEmpty }
            List {
                if noGuess {
                    Section {
                        Label("We couldn't tell which team is yours. Search by team, coach, or bracket.", systemImage: "magnifyingglass")
                            .font(.subheadline)
                    }
                }
                ForEach(groups, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.teams) { team in
                            Button { flow.choose(team.key) } label: { ImportTeamRow(team: team, showBracket: false) }
                                .tint(.primary)
                        }
                    }
                }
                if groups.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
                Section {
                    Button("My team isn't listed") { flow.path.append(.report(.teamMissing)) }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Team, coach, or bracket")
            .navigationTitle("All Teams")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ImportAliasStep: View {
    let flow: ScheduleImportFlow

    var body: some View {
        if let preview = flow.preview, let team = flow.chosenTeam {
            let names = preview.bracket(for: team)?.unmatchedNames ?? []
            List {
                Section {
                    Text(names.isEmpty
                         ? "\(team.name) is listed, but no games are posted for it yet. Check back once the organizer publishes the schedule."
                         : "\(team.name) is listed in \(team.bracketTitle ?? "its bracket"), but the games there use a different name. Which of these is you?")
                }
                if !names.isEmpty {
                    Section("Names in this bracket") {
                        ForEach(names, id: \.self) { name in
                            Button(name) { flow.chooseAlias(name) }
                        }
                    }
                }
                Section {
                    Button("Report a problem with this sheet") { flow.path.append(.report(.gamesWrong)) }
                    Button("Pick a different team") { flow.changeTeam() }
                }
            }
            .navigationTitle("Find Your Games")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Preview

private struct ImportPreviewStep: View {
    let flow: ScheduleImportFlow

    var body: some View {
        if let preview = flow.preview, let team = flow.chosenTeam, let key = flow.chosenKey {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(team.name).font(.title3.bold())
                        Text([team.bracketTitle, team.coach.map { "Coach \($0)" }].compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Button("Change Team") { flow.changeTeam() }
                }
                notices(preview: preview, key: key)
                Section {
                    ForEach(flow.chosenGames) { game in
                        ImportGameRow(
                            game: game, teamKey: key, alias: flow.alias, timeZone: preview.timeZone,
                            isSelected: flow.selectedGameKeys.contains(game.key),
                            clashes: preview.clashes(with: game)
                        ) { flow.toggle(game) }
                    }
                } header: {
                    Text("Games")
                }
                if let error = flow.errorMessage {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    AsyncButton {
                        await flow.commit()
                    } label: {
                        let verb = flow.isReimport ? "Update" : "Import"
                        Text(flow.selectedCount == 1 ? "\(verb) 1 Game" : "\(verb) \(flow.selectedCount) Games")
                    }
                    .buttonStyle(BrandCTAButtonStyle())
                    .disabled(flow.selectedCount == 0)
                    Text(flow.hasUpcomingSelection
                         ? "Families aren't notified. You can tell them on the next screen."
                         : "These games already happened, so families won't be notified.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding()
                .background(.bar)
            }
            .navigationTitle("Review Games")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder
    private func notices(preview: ImportPreview, key: String) -> some View {
        let previous = preview.previousImport
        let zoneDiffers = preview.timeZone.secondsFromGMT() != TimeZone.current.secondsFromGMT()
        if flow.levelWarning != nil || previous != nil || zoneDiffers || preview.source.homeNote != nil {
            Section {
                if let warning = flow.levelWarning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
                if let previous {
                    if previous.teamKey == key {
                        Label("You imported this tournament before. Importing again updates those \(previous.eventCount) games instead of adding copies.", systemImage: "arrow.triangle.2.circlepath")
                    } else {
                        Label("You picked \(preview.team(previous.teamKey)?.name ?? "another team") last time. Importing now replaces those games.", systemImage: "arrow.left.arrow.right")
                    }
                }
                if zoneDiffers, let zone = preview.timeZone.localizedName(for: .generic, locale: .current) {
                    Label("Times are \(zone), where the games are played.", systemImage: "globe.americas")
                }
                if let note = preview.source.homeNote {
                    Label("\(note).", systemImage: "tshirt")
                }
            }
            .font(.subheadline)
        }
    }
}

/// One game in the review list. Tapping toggles whether it's imported.
private struct ImportGameRow: View {
    let game: ImportGame
    let teamKey: String
    let alias: String?
    let timeZone: TimeZone
    let isSelected: Bool
    let clashes: [ImportExistingEvent]
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: game.startsAt == nil ? "calendar.badge.exclamationmark" : (isSelected ? "checkmark.circle.fill" : "circle"))
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                VStack(alignment: .leading, spacing: 4) {
                    GameLine(game: game, teamKey: teamKey, alias: alias, timeZone: timeZone)
                    if let address = game.address {
                        Text(address).font(.caption).foregroundStyle(.secondary)
                    }
                    if game.startsAt == nil {
                        Text("No date in the sheet — this game won't be imported.").font(.caption).foregroundStyle(.orange)
                    }
                    ForEach(clashes) { clash in
                        Label("Overlaps \(clash.displayTitle) at \(clash.startsAt.formatted(date: .omitted, time: .shortened))", systemImage: "exclamationmark.circle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            }
        }
        .tint(.primary)
        .disabled(game.startsAt == nil)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(isSelected ? "Will be imported. Double-tap to skip it." : "Skipped. Double-tap to import it.")
    }
}

/// "Sat, Oct 3 · 4:00 PM", opponent, round, place and score — in the tournament's time zone.
private struct GameLine: View {
    let game: ImportGame
    let teamKey: String
    let alias: String?
    let timeZone: TimeZone

    private var whenLabel: String {
        guard let start = game.startsAt else { return [game.dayLabel, game.timeLabel].filter { !$0.isEmpty }.joined(separator: " ") }
        var day = Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day()
        day.timeZone = timeZone
        var time = Date.FormatStyle.dateTime.hour().minute()
        time.timeZone = timeZone
        return "\(start.formatted(day)) · \(start.formatted(time))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(whenLabel).font(.subheadline.weight(.semibold))
                Spacer()
                if let score = game.scoreLine(teamKey: teamKey, alias: alias) {
                    TagLabel(text: score, tint: score.hasPrefix("W") ? .green : .secondary)
                }
            }
            Text(game.opponentLabel(teamKey: teamKey, alias: alias)).font(.headline)
            Text([game.round, game.placeLabel].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

private struct TournamentHeader: View {
    let source: ImportPreview.Source

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(source.title, systemImage: "trophy.fill")
                .font(.headline)
            Text("Read from Google Sheets").font(.caption).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Done

private struct ImportDoneStep: View {
    let flow: ScheduleImportFlow

    private var headline: String {
        guard let result = flow.result else { return "Done" }
        if flow.isUndone { return "Import undone" }
        if result.added == 0 && result.updated > 0 { return result.updated == 1 ? "1 game updated" : "\(result.updated) games updated" }
        return result.added == 1 ? "1 game added" : "\(result.added) games added"
    }

    var body: some View {
        if let result = flow.result {
            ScrollView {
                VStack(spacing: 16) {
                    Image(systemName: flow.isUndone ? "arrow.uturn.backward.circle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(flow.isUndone ? Color.secondary : Color.green)
                        .accessibilityHidden(true)
                    Text(headline).font(.title2.bold())
                    if !flow.isUndone {
                        VStack(spacing: 6) {
                            if result.added > 0 && result.updated > 0 { Text("\(result.updated) already on your schedule were updated.") }
                            if result.removed > 0 { Text("\(result.removed) games from the team you picked before were removed.") }
                            if result.cancelled > 0 { Text("\(result.cancelled) games no longer in the sheet were marked cancelled.") }
                            if result.skipped > 0 { Text("\(result.skipped) games had no date and were skipped.") }
                            Text(result.upcoming == 0
                                 ? "These games already happened, so they're under Past on the schedule, with scores."
                                 : "They're on the schedule now. Families see them right away.")
                        }
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    if let error = flow.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.subheadline)
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    if !flow.isUndone && result.upcoming > 0 {
                        if flow.familiesNotified {
                            Label("Families notified", systemImage: "bell.badge.fill").font(.headline).foregroundStyle(.green)
                        } else {
                            AsyncButton { await flow.notifyFamilies() } label: {
                                Label(result.upcoming == 1 ? "Notify Families About 1 Game" : "Notify Families About \(result.upcoming) Games", systemImage: "bell")
                            }
                            .font(.headline)
                        }
                    }
                    Button("Done") { flow.close() }
                        .buttonStyle(BrandCTAButtonStyle())
                    if !flow.isUndone && flow.canUndo {
                        AsyncButton(role: .destructive) { await flow.undo() } label: { Text("Undo Import") }
                            .padding(.vertical, 6)
                    }
                }
                .padding()
                .background(.bar)
            }
            .navigationTitle("Imported")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden()
        }
    }
}

// MARK: - Report

private struct ImportReportStep: View {
    let flow: ScheduleImportFlow
    @State var reason: ImportReportReason
    @State private var note = ""
    @State private var sent = false

    init(flow: ScheduleImportFlow, reason: ImportReportReason) {
        self.flow = flow
        _reason = State(initialValue: reason)
    }

    var body: some View {
        Form {
            if sent {
                Section {
                    Label("Thanks — we'll take a look at this sheet.", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                }
            } else {
                Section {
                    Text(reason == .teamMissing
                         ? "We couldn't find \(flow.team.name) in this tournament. Tell us your team's name in the sheet and we'll improve the reader."
                         : "Tell us what went wrong and we'll improve the reader.")
                }
                Section("What happened?") {
                    Picker("Problem", selection: $reason) {
                        ForEach(ImportReportReason.allCases) { Text($0.displayName).tag($0) }
                    }
                    TextField("Your team's name in the sheet, or what looks wrong", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                }
                Section {
                    AsyncButton { sent = await flow.sendReport(reason: reason, note: note) } label: { Text("Send Report") }
                } footer: {
                    Text("We'll send the sheet link and your note to the ClubHQ team.")
                }
                if let error = flow.errorMessage {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }
            }
            Section {
                Button("Try a Different Link") { flow.reset() }
                Button("Add Games Myself") { flow.close() }
            }
        }
        .navigationTitle("Report a Problem")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview("Import") {
    let model = AppModel.preview(.coach)
    let world = DemoWorld(now: .now)
    if let team = world.context(for: world.userID(for: .coach)).teams.first {
        ScheduleImportView(team: team, backend: model.backend)
            .environment(model)
    }
}

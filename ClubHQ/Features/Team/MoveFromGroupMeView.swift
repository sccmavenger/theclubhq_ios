import SwiftUI

/// Coach guide for moving a team off GroupMe (or any group chat) in about two weeks
/// (DECISIONS D-036). Four ready-to-paste messages with the team's invite link, code, and
/// switch date filled in. Progress and the date are kept per team on this device.
struct MoveFromGroupMeView: View {
    let team: TeamMembership
    /// Shows a Done button when presented as a sheet rather than pushed.
    var showsDoneButton = false

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var invite: InviteLink?
    @State private var rosterCount: Int?
    @State private var errorText: String?
    @State private var copiedStep: Step.ID?
    @AppStorage private var doneStepsRaw: String
    @AppStorage private var switchDateRaw: Double

    init(team: TeamMembership, showsDoneButton: Bool = false) {
        self.team = team
        self.showsDoneButton = showsDoneButton
        _doneStepsRaw = AppStorage(wrappedValue: "", "groupMeMoveDone.\(team.id.uuidString)")
        _switchDateRaw = AppStorage(wrappedValue: 0, "groupMeMoveSwitchDate.\(team.id.uuidString)")
    }

    struct Step: Identifiable {
        let id: String
        let title: String
        let when: String
        let message: String
        let note: String?
    }

    // MARK: Switch date

    /// Defaults to 10 days out: enough for a reminder and a couple of practices.
    private var switchDate: Binding<Date> {
        Binding {
            switchDateRaw > 0 ? Date(timeIntervalSince1970: switchDateRaw)
                : Calendar.current.date(byAdding: .day, value: 10, to: Calendar.current.startOfDay(for: .now)) ?? .now
        } set: {
            switchDateRaw = Calendar.current.startOfDay(for: $0).timeIntervalSince1970
        }
    }

    private var switchDay: String { switchDate.wrappedValue.formatted(.dateTime.weekday(.wide).month(.wide).day()) }

    private var reminderDay: String {
        let date = Calendar.current.date(byAdding: .day, value: -4, to: switchDate.wrappedValue) ?? switchDate.wrappedValue
        return max(date, Calendar.current.startOfDay(for: .now)).formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    private var wrapUpDay: String {
        (Calendar.current.date(byAdding: .day, value: 7, to: switchDate.wrappedValue) ?? switchDate.wrappedValue)
            .formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    // MARK: Messages

    private var steps: [Step] {
        guard let invite else { return [] }
        let link = invite.url.absoluteString
        let code = invite.spacedToken
        return [
            Step(id: "announce", title: "Announce the move", when: "Today", message: """
                Hi \(team.name) families! We're moving the team to ClubHQ, one free, ad-free app for our schedule, RSVPs, team chat, and photos.

                Starting \(switchDay), the schedule, changes, and RSVPs will only be in ClubHQ, so please join before then:
                1. Tap this link: \(link)
                2. Install ClubHQ, create an account, and add your child.
                Already have the app? Choose "I'm a parent or guardian" and enter team code \(code).

                One parent per family joins first. Then send your co-parent an invite from your child's profile in the app, so you share one profile instead of making two. Players don't need their own account.
                """, note: "Pin this message in GroupMe so late arrivals see it."),
            Step(id: "remind", title: "Send a reminder", when: reminderDay, message: """
                Quick reminder: \(team.name) moves to ClubHQ on \(switchDay). If you haven't joined yet, tap \(link) or enter team code \(code) in the app. RSVPs are already in ClubHQ, so that's where I'll see who's coming.
                """, note: rosterNote),
            Step(id: "switch", title: "Switch day", when: switchDay, message: """
                Starting today, ClubHQ is home for \(team.name): schedule, changes, RSVPs, and team chat. I won't post schedule updates here anymore. Still need to join? \(link) (team code \(code))
                """, note: "From now on, answer schedule questions in GroupMe with \"It's in ClubHQ\" instead of the answer."),
            Step(id: "wrapup", title: "Wrap up GroupMe", when: wrapUpDay, message: """
                Thanks, everyone! Everything for \(team.name) is in ClubHQ now, so I'm going to stop using this group. If you haven't joined: \(link)
                """, note: "Then rename the group so anyone who opens it knows where to go, for example \"\(team.name): moved to ClubHQ\". Only the group's owner or an admin can rename it. Ending the group deletes it for everyone and can't be undone, so save any photos you want first."),
        ]
    }

    private var rosterNote: String? {
        guard let rosterCount else { return nil }
        switch rosterCount {
        case 0: return "No families have joined yet. Inviting in person at pickup usually gets things moving."
        case 1: return "1 child is on your ClubHQ roster so far. Compare with your GroupMe members to see who's missing."
        default: return "\(rosterCount) kids are on your ClubHQ roster so far. Compare with your GroupMe members to see who's missing."
        }
    }

    private var doneSteps: Set<String> { Set(doneStepsRaw.split(separator: ",").map(String.init)) }

    private func setDone(_ id: String, _ done: Bool) {
        var ids = doneSteps
        if done { ids.insert(id) } else { ids.remove(id) }
        doneStepsRaw = ids.sorted().joined(separator: ",")
    }

    // MARK: Body

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Move your team in about two weeks")
                        .font(.headline)
                    Text("Post these four messages in your GroupMe. Each one already has your invite link, team code, and switch date. Copy it, then paste it into the group.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                DatePicker("Switch day", selection: switchDate, in: Calendar.current.startOfDay(for: .now)..., displayedComponents: .date)
            } footer: {
                Text("After this day, the schedule and RSVPs live only in ClubHQ.")
            }

            if let errorText {
                Section { Text(errorText).foregroundStyle(.secondary) }
            } else if invite == nil {
                Section { ProgressView().frame(maxWidth: .infinity) }
            }

            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                Section {
                    stepCard(step, number: index + 1)
                }
            }

            if invite != nil {
                Section("What works") {
                    TipRow(symbol: "person.2.wave.2", title: "Invite in person",
                           detail: "At practice pickup, ask parents to join on the spot. It takes a few minutes, and you can answer questions right there.")
                    TipRow(symbol: "person.crop.circle.badge.plus", title: "One parent per family first",
                           detail: "If both parents use the team code, your roster gets two copies of the same child. The second parent should use the co-parent invite instead.")
                    TipRow(symbol: "hand.raised", title: "Make RSVP the reason",
                           detail: "Ask for RSVPs for the next game in ClubHQ only. Families join when it's where you'll look.")
                    TipRow(symbol: "iphone", title: "iPhone only for now",
                           detail: "ClubHQ isn't on Android yet. Keep any Android families in the loop by text until it is.")
                }
            }
        }
        .navigationTitle("Move from GroupMe")
        .onAppear { model.track("groupme_guide.opened", teamID: team.id) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsDoneButton {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { await load() }
    }

    private func stepCard(_ step: Step, number: Int) -> some View {
        let isDone = doneSteps.contains(step.id)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Button {
                    setDone(step.id, !isDone)
                } label: {
                    Image(systemName: isDone ? "checkmark.circle.fill" : "\(number).circle")
                        .font(.title2)
                        .foregroundStyle(isDone ? team.tint : Color.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isDone ? "Mark step \(number) not done" : "Mark step \(number) done")
                VStack(alignment: .leading, spacing: 2) {
                    Text(step.title).font(.headline).strikethrough(isDone)
                    Text(step.when).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Text(step.message)
                .font(.callout)
                .textSelection(.enabled)
                // List rows can under-measure multi-line text ending in a long URL, which cut
                // off step 4 in testing; let the message take the height it needs.
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                // Grouped-list cells are secondarySystemBackground in dark mode; tertiary stands out in both.
                .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 12))
            HStack(spacing: 12) {
                Button {
                    UIPasteboard.general.string = step.message
                    setDone(step.id, true)
                    withAnimation { copiedStep = step.id }
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        withAnimation { if copiedStep == step.id { copiedStep = nil } }
                    }
                } label: {
                    // Explicit icon + text (TestFlight feedback, build 13): the animated Label swap
                    // left an empty icon slot, so "Copy" sat right of center.
                    HStack(spacing: 6) {
                        Image(systemName: copiedStep == step.id ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                        Text(copiedStep == step.id ? "Copied" : "Copy")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                ShareLink(item: step.message) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.regular)
            if let note = step.note {
                Label(note, systemImage: "lightbulb")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
    }

    private func load() async {
        do {
            invite = try await model.backend.createInvite(teamID: team.id)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        rosterCount = try? await model.backend.roster(teamID: team.id).count
    }
}

private struct TipRow: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol)
        }
        .padding(.vertical, 2)
    }
}

/// Waits for the demo context to load, then shows the guide for the coach's team.
private struct MoveFromGroupMePreview: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            if let team = model.selectedTeam {
                MoveFromGroupMeView(team: team)
            } else {
                ProgressView()
            }
        }
    }
}

#Preview {
    MoveFromGroupMePreview().environment(AppModel.preview(.coach))
}

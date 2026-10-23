import SwiftUI
import UserNotifications

/// Remembers which first-run tours a user has seen — per account *and* per persona, so a coach
/// who later joins a team as a parent still gets the parent tour once.
enum WelcomeTour {
    private static func seenKey(user: UUID, persona: Persona) -> String {
        "welcomeTourSeen.\(user.uuidString).\(persona.rawValue)"
    }

    static func hasSeen(user: UUID, persona: Persona) -> Bool {
        UserDefaults.standard.bool(forKey: seenKey(user: user, persona: persona))
    }

    static func markSeen(user: UUID, persona: Persona) {
        UserDefaults.standard.set(true, forKey: seenKey(user: user, persona: persona))
    }

    private static func checklistKey(team: UUID) -> String { "setupChecklistHidden.\(team.uuidString)" }

    static func isChecklistHidden(team: UUID) -> Bool {
        UserDefaults.standard.bool(forKey: checklistKey(team: team))
    }

    static func hideChecklist(team: UUID) {
        UserDefaults.standard.set(true, forKey: checklistKey(team: team))
    }

    private static func checklistStartedKey(team: UUID) -> String { "setupChecklistStarted.\(team.uuidString)" }

    /// Set the first time the checklist is shown for a team, so it persists across launches.
    static func isChecklistStarted(team: UUID) -> Bool {
        UserDefaults.standard.bool(forKey: checklistStartedKey(team: team))
    }

    static func startChecklist(team: UUID) {
        UserDefaults.standard.set(true, forKey: checklistStartedKey(team: team))
    }
}

/// One-screen, role-specific welcome shown the first time a user reaches the main tabs.
/// It's also where ClubHQ asks for notification permission — with the reason right above the button.
struct WelcomeTourView: View {
    let persona: Persona
    let team: TeamMembership
    @Environment(\.dismiss) private var dismiss
    /// nil until loaded; decides between "Turn On Alerts" and a plain "Get Started".
    @State private var notificationStatus: UNAuthorizationStatus?

    private struct Point: Identifiable {
        let symbol: String
        let title: String
        let detail: String
        var id: String { title }
    }

    private var title: String {
        switch persona {
        case .coach: "You're the coach of \(team.name)"
        case .parent:
            if let child = childNames { "You're in! \(child) \(team.linkedPlayers.count > 1 ? "are" : "is") on \(team.name)" }
            else { "Welcome to \(team.name)" }
        case .player: "Welcome to \(team.name)"
        }
    }

    private var childNames: String? {
        let names = team.linkedPlayers.map(\.firstName)
        return names.isEmpty ? nil : names.formatted(.list(type: .and))
    }

    private var points: [Point] {
        switch persona {
        case .coach:
            [
                Point(symbol: "calendar", title: "Schedule", detail: "Add practices and games. Families are notified automatically."),
                Point(symbol: "hand.raised.fill", title: "RSVPs", detail: "See who's coming before every event."),
                Point(symbol: "megaphone.fill", title: "Messages & announcements", detail: "One place instead of group texts."),
                Point(symbol: "dollarsign.circle.fill", title: "Dues", detail: "Request money and track who's paid."),
            ]
        case .parent:
            [
                Point(symbol: "checkmark.circle.fill", title: "RSVP in one tap", detail: "Let the coach know if \(childNames ?? "your child") can make it."),
                Point(symbol: "bell.badge.fill", title: "Never miss a change", detail: "Rain-outs and time changes reach you right away."),
                Point(symbol: "bubble.left.and.bubble.right.fill", title: "Messages", detail: "Message the coach and see team announcements."),
                Point(symbol: "dollarsign.circle.fill", title: "Payments", detail: "See what's due and pay your coach directly."),
            ]
        case .player:
            [
                Point(symbol: "checkmark.circle.fill", title: "Tell your coach you're in", detail: "RSVP to practices and games in one tap."),
                Point(symbol: "calendar", title: "Your schedule", detail: "Every practice and game, with times and places."),
                Point(symbol: "bubble.left.and.bubble.right.fill", title: "Team chat", detail: "Stay in the loop with your team."),
            ]
        }
    }

    private var asksForAlerts: Bool { notificationStatus == .notDetermined }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 14) {
                        Image(systemName: team.resolvedSport.symbolName)
                            .font(.largeTitle)
                            .foregroundStyle(.white)
                            .frame(width: 72, height: 72)
                            .background(team.tint.gradient, in: .rect(cornerRadius: 18))
                            .accessibilityHidden(true)
                        Text(title)
                            .font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 22) {
                        ForEach(points) { point in
                            HStack(alignment: .top, spacing: 16) {
                                Image(systemName: point.symbol)
                                    .font(.title2)
                                    .foregroundStyle(team.tint)
                                    .frame(width: 36)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(point.title).font(.headline)
                                    Text(point.detail).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 48)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(spacing: 12) {
                if asksForAlerts {
                    Text("Turn on alerts so you hear about schedule changes the moment they happen.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                AsyncButton {
                    if asksForAlerts { await PushManager.shared.requestAuthorizationIfNeeded() }
                    dismiss()
                } label: {
                    Text(asksForAlerts ? "Turn On Alerts" : "Get Started").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(team.tint)
                .disabled(notificationStatus == nil)

                if asksForAlerts {
                    Button("Not Now") { dismiss() }
                        .font(.subheadline)
                }
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 20)
        }
        .task {
            notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        }
    }
}

/// Coach-only "Get your team ready" card at the top of Home. Steps check themselves off
/// from real team data; the card can be hidden per team.
struct SetupChecklistSection: View {
    struct Step: Identifiable {
        let id: String
        let title: String
        let symbol: String
        let isDone: Bool
        let action: () -> Void
    }

    let steps: [Step]
    let tint: Color
    let onHide: () -> Void

    private var doneCount: Int { steps.filter(\.isDone).count }
    private var isComplete: Bool { doneCount == steps.count }

    var body: some View {
        Section {
            HStack(spacing: 14) {
                ZStack {
                    Circle().stroke(tint.opacity(0.2), lineWidth: 5)
                    Circle()
                        .trim(from: 0, to: steps.isEmpty ? 0 : Double(doneCount) / Double(steps.count))
                        .stroke(tint, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    if isComplete {
                        Image(systemName: "checkmark").font(.subheadline.bold()).foregroundStyle(tint)
                    }
                }
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isComplete ? "You're all set 🎉" : "Get your team ready").font(.headline)
                    Text(isComplete ? "Your team is ready to go." : "\(doneCount) of \(steps.count) done")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Button(isComplete ? "Done" : "Hide", action: onHide)
                    .font(.subheadline)
                    .buttonStyle(.borderless)
            }
            .accessibilityElement(children: .contain)

            if !isComplete {
                ForEach(steps) { step in
                    Button(action: step.action) {
                        HStack(spacing: 12) {
                            Image(systemName: step.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(step.isDone ? tint : Color.secondary)
                            Label(step.title, systemImage: step.symbol)
                                .foregroundStyle(step.isDone ? .secondary : .primary)
                                .strikethrough(step.isDone)
                            Spacer()
                            if !step.isDone {
                                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(step.isDone)
                    .accessibilityLabel(step.title)
                    .accessibilityValue(step.isDone ? "Done" : "Not done")
                }
            }
        }
    }
}

#Preview("Coach welcome") {
    WelcomeTourPreview(persona: .coach)
}

#Preview("Parent welcome") {
    WelcomeTourPreview(persona: .parent)
}

/// Waits for the demo context to load before showing the tour.
private struct WelcomeTourPreview: View {
    let persona: Persona
    @State private var model: AppModel

    init(persona: Persona) {
        self.persona = persona
        self.model = .preview(persona)
    }

    var body: some View {
        Group {
            if let team = model.selectedTeam {
                WelcomeTourView(persona: persona, team: team)
            } else {
                ProgressView()
            }
        }
        .environment(model)
    }
}

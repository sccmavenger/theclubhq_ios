import SwiftUI

/// Main tabs. Deep links (push taps, inbox rows, URLs) open as sheets over any tab.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    enum TabID: String, Hashable { case home, schedule, team, messages, club, more }
    @State private var selection: TabID = Self.initialTab

    private static var initialTab: TabID {
        #if DEBUG
        // App Store screenshots: launch with `-ScreenshotTab schedule` etc.
        if let raw = UserDefaults.standard.string(forKey: "ScreenshotTab"), let tab = TabID(rawValue: raw) {
            return tab
        }
        #endif
        return .home
    }
    @State private var presentedLink: PresentedLink?

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house.fill", value: TabID.home) {
                HomeView()
            }
            Tab("Schedule", systemImage: "calendar", value: TabID.schedule) {
                ScheduleView()
            }
            Tab("Team", systemImage: "person.3.fill", value: TabID.team) {
                TeamView()
            }
            Tab("Messages", systemImage: "bubble.left.and.bubble.right.fill", value: TabID.messages) {
                MessagesView()
            }
            // Directors only (D-044). Parents never see the club.
            if let club = model.clubs.first {
                Tab("Club", systemImage: "building.2.fill", value: TabID.club) {
                    ClubView(club: club) { teamID in
                        model.selectedTeamID = teamID
                        selection = .team
                    }
                }
            }
            Tab("More", systemImage: "ellipsis.circle.fill", value: TabID.more) {
                AccountView()
            }
        }
        // A different signed-in user (account or demo persona) gets fresh navigation
        // stacks in every tab, so nobody lands on the previous user's screens.
        .id(model.context?.userId)
        .tint(model.selectedTeam?.tint ?? .accentColor)
        .onChange(of: model.showClubTab) { _, show in
            if show {
                selection = .club
                model.showClubTab = false
            }
        }
        .onChange(of: model.pendingDeepLink, initial: true) { _, link in
            guard let link else { return }
            model.pendingDeepLink = nil
            route(link)
        }
        // First-run tour: once per user per persona, re-checked when switching to a team
        // where they have a different role (e.g. coach on one team, parent on another).
        .onChange(of: model.selectedTeam?.primaryPersona, initial: true) {
            model.showWelcomeTourIfNeeded()
        }
        .sheet(item: welcomeTourBinding) { persona in
            if let team = model.selectedTeam {
                WelcomeTourView(persona: persona, team: team)
            }
        }
        .sheet(item: $presentedLink) { presented in
            NavigationStack {
                Group {
                    switch presented.link {
                    case .event(let id):
                        EventDetailView(eventID: id)
                    case .thread(let id):
                        ChatView(threadID: id)
                    case .invite(let token):
                        JoinTeamView(initialToken: token)
                    case .announcements, .inbox, .authCallback:
                        EmptyView()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { presentedLink = nil }
                    }
                }
            }
        }
    }

    /// Any dismissal (button or swipe) marks the tour seen.
    private var welcomeTourBinding: Binding<Persona?> {
        Binding(
            get: { model.welcomeTour },
            set: { newValue in
                if newValue == nil, let shown = model.welcomeTour { model.finishWelcomeTour(shown) }
            }
        )
    }

    private func route(_ link: DeepLink) {
        switch link {
        case .announcements:
            selection = .team
        case .inbox:
            selection = .home
        default:
            presentedLink = PresentedLink(link: link)
        }
    }
}

private struct PresentedLink: Identifiable {
    let id = UUID()
    let link: DeepLink
}

#Preview {
    MainTabView()
        .environment(AppModel.preview(.parent))
}

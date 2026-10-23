import StoreKit
import SwiftUI

/// "More" tab: profile, teams, plan, privacy, and account management.
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var fullName = ""
    @State private var showPaywall = false
    @State private var showManageSubscription = false
    @State private var showAddTeam = false
    @State private var confirmDelete = false
    @State private var confirmSignOut = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                if model.isDemo { demoSection }

                Section("Profile") {
                    TextField("Your name", text: $fullName)
                        .textContentType(.name)
                        .onSubmit { Task { await saveName() } }
                    if let email = model.context?.email {
                        LabeledContent("Email", value: email)
                    }
                }

                Section {
                    ForEach(model.teams) { team in
                        Button {
                            model.selectedTeamID = team.id
                        } label: {
                            HStack {
                                Image(systemName: team.resolvedSport.symbolName).foregroundStyle(team.tint).frame(width: 28)
                                VStack(alignment: .leading) {
                                    Text(team.name).foregroundStyle(.primary)
                                    Text(team.roles.map(\.displayName).joined(separator: ", "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if team.id == model.selectedTeam?.id {
                                    Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                    }
                    Button("Add or Join a Team", systemImage: "plus.circle") { showAddTeam = true }
                } header: {
                    Text("My teams")
                }

                planSection

                Section("Notifications") {
                    Button("Notification Settings", systemImage: "bell.badge") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                }

                Section {
                    Button("Show App Tour", systemImage: "sparkles") { model.replayWelcomeTour() }
                    Link(destination: AppConfig.privacyPolicyURL) { Label("Privacy Policy", systemImage: "hand.raised.fill") }
                    Link(destination: AppConfig.termsURL) { Label("Terms of Service", systemImage: "doc.text.fill") }
                    if let mail = URL(string: "mailto:\(AppConfig.supportEmail)") {
                        Link(destination: mail) { Label("Contact Support", systemImage: "envelope.fill") }
                    }
                } header: {
                    Text("Privacy & help")
                } footer: {
                    Text("ClubHQ has no ads and no third-party trackers. We never sell your family's data.")
                }

                if let errorText {
                    Section { Text(errorText).foregroundStyle(.red) }
                }

                Section {
                    Button("Sign Out", role: .destructive) { confirmSignOut = true }
                    Button("Delete Account", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle("More")
            // Re-sync when the signed-in user changes (e.g. demo persona switch).
            .task(id: model.context?.userId) { fullName = model.context?.fullName ?? "" }
            .sheet(isPresented: $showPaywall) { PaywallView() }
            .sheet(isPresented: $showAddTeam) {
                NavigationStack {
                    JoinOrCreateList()
                        .navigationTitle("Add a Team")
                        // Trailing, so the button doesn't morph into the Back button when a flow is pushed.
                        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { showAddTeam = false } } }
                }
            }
            .manageSubscriptionsSheet(isPresented: $showManageSubscription, subscriptionGroupID: AppConfig.coachProGroupID)
            .confirmationDialog("Sign out of ClubHQ?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    Task { model.isDemo ? await model.exitDemo() : await model.signOut() }
                }
            }
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete Account", role: .destructive) { Task { await deleteAccount() } }
            } message: {
                Text("This removes your login, your team memberships, and your links to players. Teams where you're the only head coach are archived. This can't be undone.\(model.store.hasActiveSubscription ? " Active App Store subscriptions must be cancelled in Settings." : "")")
            }
            // Close after any successful join: a new team, or another child (or co-parent link)
            // on a team the user is already on, which leaves the team count unchanged.
            .onChange(of: model.teams.count + model.teams.reduce(0) { $0 + $1.linkedPlayers.count }) { old, new in
                if new > old { showAddTeam = false }
            }
        }
    }

    private var demoSection: some View {
        Section {
            Picker("Viewing as", selection: Binding(
                get: { model.demoPersona ?? .coach },
                set: { persona in Task { await model.switchDemoPersona(persona) } }
            )) {
                ForEach(Persona.allCases) { Label($0.title, systemImage: $0.symbolName).tag($0) }
            }
            .pickerStyle(.segmented)
        } header: {
            Text("Demo mode")
        } footer: {
            Text("Switch roles to see what coaches, parents, and players each experience. Demo data resets when you leave.")
        }
    }

    @ViewBuilder private var planSection: some View {
        let coachesATeam = model.teams.contains(where: \.isHeadCoach)
        // While Coach Pro isn't for sale, free coaches see no plan section at all (App Review 2.3.1).
        if model.isCoachPro || (coachesATeam && model.canSellPro) {
            Section {
                if model.isCoachPro {
                    Label("Coach Pro is active", systemImage: "sparkles").foregroundStyle(.purple)
                    // Only Apple subscriptions can be managed; complimentary (server-granted) Pro has nothing to show.
                    if !model.isDemo && model.store.hasActiveSubscription {
                        Button("Manage Subscription") { showManageSubscription = true }
                    }
                } else if model.canSellPro {
                    Button { showPaywall = true } label: {
                        HStack {
                            Label("Upgrade to Coach Pro", systemImage: "sparkles")
                            Spacer()
                            Text("Up to 3 teams").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    LabeledContent("Current plan", value: "Free")
                }
            } header: {
                Text("Plan")
            } footer: {
                if !model.isCoachPro {
                    Text("Free plan: one team as head coach with unlimited players, scheduling, RSVPs, chat, and payments. No ads, ever.")
                }
            }
        }
    }

    private func saveName() async {
        guard let name = fullName.nilIfEmpty else { return }
        do {
            try await model.backend.updateProfile(fullName: name)
            await model.reloadContext()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func deleteAccount() async {
        do {
            try await model.backend.deleteAccount()
            if model.isDemo { await model.exitDemo() } else { await model.signOut() }
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    AccountView().environment(AppModel.preview(.coach))
}

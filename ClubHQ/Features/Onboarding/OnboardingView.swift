import SwiftUI

/// First-run chooser for users with no teams yet. The same flows are reused from the
/// More tab ("Add a team") once the user is set up.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            JoinOrCreateList()
                .navigationTitle("Welcome\(model.context?.fullName.map { ", \($0.components(separatedBy: " ").first ?? $0)" } ?? "")")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Sign Out") { Task { await model.signOut() } }
                    }
                }
        }
    }
}

/// The three ways into a team.
struct JoinOrCreateList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Section {
                Text("How are you joining ClubHQ?")
                    .font(.title3.weight(.semibold))
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 0, trailing: 4))
            }
            Section {
                NavigationLink {
                    JoinTeamView(initialToken: model.pendingInviteToken ?? "")
                } label: {
                    OptionRow(symbol: "figure.2.and.child.holdinghands", title: "I'm a parent or guardian",
                              detail: "Enter the team code from your coach and add your child.")
                }
                NavigationLink {
                    CreateTeamView()
                } label: {
                    OptionRow(symbol: "list.clipboard.fill", title: "I'm a coach",
                              detail: "Create your team in under a minute. Free, no ads.")
                }
                NavigationLink {
                    PlayerCodeView()
                } label: {
                    OptionRow(symbol: "figure.basketball", title: "I'm a player (13+)",
                              detail: "Enter the code your parent or coach gave you.")
                }
            }
        }
    }
}

private struct OptionRow: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Create team (coach)

struct CreateTeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var request = NewTeamRequest()
    @State private var errorText: String?
    @State private var showPaywall = false

    var body: some View {
        Form {
            Section("Team") {
                TextField("Team name (e.g. Mayhem Elite 14U)", text: $request.teamName)
                    .textInputAutocapitalization(.words)
                Picker("Sport", selection: $request.sport) {
                    ForEach(Sport.allCases) { sport in
                        Label(sport.displayName, systemImage: sport.symbolName).tag(sport)
                    }
                }
                TextField("Age group (optional)", text: $request.ageGroup)
                TextField("Season (optional, e.g. Fall 2026)", text: $request.season)
            }
            Section {
                Toggle("Part of a club or league", isOn: $request.isClub)
                if request.isClub {
                    TextField("Club name", text: $request.clubName)
                }
            } footer: {
                Text("Optional — helps families recognize your club. Your team works the same either way.")
            }
            if !model.canCreateAnotherTeam {
                Section {
                    if model.canSellPro {
                        ProUpsellRow(title: "Run up to 3 teams with Coach Pro",
                                     message: "The free plan includes one team as head coach. Everything parents use stays free.")
                    } else {
                        Text(Self.oneTeamMessage).foregroundStyle(.secondary)
                    }
                }
            }
            if let errorText {
                Section { Text(errorText).foregroundStyle(.red) }
            }
            Section {
                AsyncButton(action: create) {
                    Text("Create Team").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(request.teamName.trimmingCharacters(in: .whitespaces).isEmpty
                          || (!model.canCreateAnotherTeam && !model.canSellPro))
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("New Team")
        .keyboardDoneButton()
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }

    private static let oneTeamMessage = "Each account can be head coach of one team. To help run another team, ask its head coach to invite you as an assistant."

    private func create() async {
        errorText = nil
        do {
            let teamID = try await model.backend.createTeam(request)
            model.selectedTeamID = teamID
            await model.reloadContext()
            dismiss()
        } catch let error as BackendError where error.isUpgradeRequired && model.canSellPro {
            showPaywall = true
        } catch let error as BackendError where error.isUpgradeRequired {
            // Coach Pro isn't for sale yet, so don't mention it (App Review 2.3.1).
            errorText = Self.oneTeamMessage
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - Join team (parent / guardian)

struct JoinTeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var linkText: String
    @State private var preview: InvitePreview?
    @State private var child = NewChildRequest()
    @State private var hasBirthdate = false
    @State private var errorText: String?
    @State private var isLooking = false

    init(initialToken: String = "") {
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.linkText = initialToken
    }

    /// Accepts a bare code ("ABCDE FGHJK"), an invite link, or the whole shared invite message.
    private var token: String {
        let trimmed = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        // A pasted message: find the invite link inside it.
        if let match = trimmed.firstMatch(of: /teamclubhq\.com\/join\/([A-Za-z0-9_-]+)/) { return String(match.1) }
        if let url = URL(string: trimmed), case .invite(let token)? = DeepLink(url: url) { return token }
        // "team code: ABCDE FGHJK" → the code itself.
        if let match = trimmed.firstMatch(of: /code:?\s*([A-Za-z0-9]{5}\s?[A-Za-z0-9]{5})/) {
            return String(match.1).replacingOccurrences(of: " ", with: "").uppercased()
        }
        let compact = trimmed.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
        return compact.count <= 12 ? compact.uppercased() : compact
    }

    private var sport: Sport { preview?.team?.sport ?? .basketball }

    var body: some View {
        Form {
            Section {
                TextField("Team code (e.g. ABCDE FGHJK)", text: $linkText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.title3.monospaced())
                    .onSubmit { Task { await lookUp() } }
                AsyncButton("Find Team", action: lookUp)
                    .disabled(token.filter { !$0.isWhitespace }.count < 8)
            } header: {
                Text("Team code")
            } footer: {
                Text("Get the code from your coach. Coaches find it in ClubHQ → Team → + → Invite Families. You can also paste the whole invite message.")
            }

            if let preview {
                if preview.valid, let team = preview.team {
                    Section("Team") {
                        Label {
                            VStack(alignment: .leading) {
                                Text(team.name).font(.headline)
                                Text([team.ageGroup, team.season].compactMap { $0 }.joined(separator: " · "))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: sport.symbolName)
                        }
                    }
                    childSection
                    contactSection
                    Section {
                        AsyncButton(action: join) {
                            Text("Join \(team.name)").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!child.isValid)
                        .listRowBackground(Color.clear)
                    } footer: {
                        Text("Your child's info is visible only to their team's coaches and is never sold or used for ads.")
                    }
                } else {
                    Section {
                        Label("This invite is expired or invalid. Ask your coach for a new link.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }
            }
            if let errorText {
                Section { Text(errorText).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Join a Team")
        .keyboardDoneButton()
        .task {
            if token.count >= 8, preview == nil { await lookUp() }
        }
    }

    private var childSection: some View {
        Section("Your child") {
            TextField("First name", text: $child.firstName).textContentType(.givenName)
            TextField("Last name", text: $child.lastName).textContentType(.familyName)
            TextField("Jersey number (optional)", text: $child.jerseyNumber).keyboardType(.numberPad)
            if !sport.positions.isEmpty {
                Picker("Position", selection: $child.position) {
                    Text("Not sure").tag("")
                    ForEach(sport.positions, id: \.self) { Text($0).tag($0) }
                }
            }
            Toggle("Add birthdate", isOn: $hasBirthdate.animation())
            if hasBirthdate {
                DatePicker("Birthdate", selection: Binding(get: { child.birthdate ?? .now }, set: { child.birthdate = $0 }),
                           in: ...Date.now, displayedComponents: .date)
            }
            Picker("You are their", selection: $child.relationship) {
                ForEach(EmergencyRelationship.allCases) { Text($0.displayName).tag($0) }
            }
        }
        .onChange(of: hasBirthdate) { _, isOn in if !isOn { child.birthdate = nil } }
    }

    private var contactSection: some View {
        Section {
            TextField("Name", text: $child.contactName).textContentType(.name)
            TextField("Phone", text: $child.contactPhone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            TextField("Email (optional)", text: $child.contactEmail).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never)
            Picker("Relationship", selection: $child.contactRelationship) {
                ForEach(EmergencyRelationship.allCases) { Text($0.displayName).tag($0) }
            }
        } header: {
            Text("Emergency contact")
        } footer: {
            Text("Required so coaches can reach a guardian during practices and games.")
        }
        .onAppear {
            if child.contactName.isEmpty { child.contactName = model.context?.fullName ?? "" }
        }
    }

    private func lookUp() async {
        errorText = nil
        do {
            preview = try await model.backend.lookupInvite(token: token)
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func join() async {
        errorText = nil
        do {
            let teamID = try await model.backend.claimInvite(token: token, child: child)
            model.pendingInviteToken = nil
            model.selectedTeamID = teamID
            await model.reloadContext()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - Player code (13+)

struct PlayerCodeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var errorText: String?

    var body: some View {
        Form {
            Section {
                TextField("8-character code", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.title3.monospaced())
            } footer: {
                Text("Player accounts are for ages 13 and up. Your parent or coach creates the code from your player profile.")
            }
            if let errorText {
                Section { Text(errorText).foregroundStyle(.red) }
            }
            Section {
                AsyncButton(action: claim) {
                    Text("Join My Team").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(code.trimmingCharacters(in: .whitespaces).count < 6)
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Player Code")
        .keyboardDoneButton()
    }

    private func claim() async {
        errorText = nil
        do {
            let teamID = try await model.backend.claimPlayerInvite(code: code.trimmingCharacters(in: .whitespaces))
            model.selectedTeamID = teamID
            await model.reloadContext()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    OnboardingView()
        .environment(AppModel.preview(.coach))
}

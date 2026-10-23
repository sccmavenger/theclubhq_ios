import SwiftUI

/// Team hub: roster, people, announcements, payments, and coach tools.
struct TeamView: View {
    @Environment(AppModel.self) private var model
    @State private var roster: [Player] = []
    @State private var members: [TeamMember] = []
    @State private var isLoading = true
    @State private var errorText: String?
    @State private var sheet: TeamSheet?

    private enum TeamSheet: String, Identifiable {
        case newPlayer, invite, announcement, groupMe
        var id: String { rawValue }
    }

    private var team: TeamMembership? { model.selectedTeam }

    var body: some View {
        NavigationStack {
            Group {
                if let team {
                    list(team: team)
                } else {
                    ContentUnavailableView("No team selected", systemImage: "person.3")
                }
            }
            .navigationTitle(team?.name ?? "Team")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TeamSwitcher() }
                if team?.canManageRoster == true {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button("Invite Families", systemImage: "person.crop.circle.badge.plus") { sheet = .invite }
                            Button("Add Player", systemImage: "person.badge.plus") { sheet = .newPlayer }
                            Button("Post Announcement", systemImage: "megaphone") { sheet = .announcement }
                            Divider()
                            Button("Move from GroupMe", systemImage: "arrow.right.arrow.left") { sheet = .groupMe }
                        } label: {
                            Label("Add", systemImage: "plus")
                        }
                    }
                }
            }
            .sheet(item: $sheet, onDismiss: { Task { await load() } }) { sheet in
                if let team {
                    switch sheet {
                    case .newPlayer: PlayerEditorView(draft: PlayerDraft(teamId: team.id), sport: team.resolvedSport)
                    case .invite: InviteFamiliesView(team: team)
                    case .announcement: AnnouncementComposer(teamID: team.id)
                    case .groupMe: NavigationStack { MoveFromGroupMeView(team: team, showsDoneButton: true) }
                    }
                }
            }
            .task(id: "\(model.refreshToken)-\(team?.id.uuidString ?? "")") { await load() }
            .refreshable { await load() }
        }
    }

    private func list(team: TeamMembership) -> some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Image(systemName: team.resolvedSport.symbolName)
                        .font(.title)
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(team.tint.gradient, in: .rect(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(team.name).font(.headline)
                        Text([team.resolvedSport.displayName, team.subtitle].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                        HStack(spacing: 6) {
                            ForEach(team.roles.filter { $0 != .parent || team.linkedPlayers.isEmpty }, id: \.self) {
                                TagLabel(text: $0.displayName, tint: team.tint)
                            }
                            if team.isPro { TagLabel(text: "Pro", tint: .purple, systemImage: "sparkles") }
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                NavigationLink {
                    AnnouncementsView(team: team)
                } label: {
                    Label("Announcements", systemImage: "megaphone.fill")
                }
                if team.isStaff || team.isGuardian {
                    NavigationLink {
                        DuesView(team: team)
                    } label: {
                        Label(team.canManageDues ? "Dues & Payments" : "Payments", systemImage: "dollarsign.circle.fill")
                    }
                }
                // Season Report is a Coach Pro feature; hidden while Pro isn't for sale.
                if team.isStaff && (team.isPro || model.canSellPro) {
                    NavigationLink {
                        AttendanceReportView(team: team)
                    } label: {
                        Label("Season Report", systemImage: "chart.bar.fill")
                    }
                }
                if team.canManageRoster {
                    NavigationLink {
                        TeamSettingsView(team: team)
                    } label: {
                        Label("Team Settings", systemImage: "gearshape.fill")
                    }
                }
            }

            Section {
                if roster.isEmpty && !isLoading {
                    if team.canManageRoster {
                        Button { sheet = .invite } label: {
                            AttentionRow(symbol: "link", tint: team.tint, title: "Invite families with a link",
                                         detail: "Parents add their own kids — no typing rosters.")
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text("No players yet.").foregroundStyle(.secondary)
                    }
                }
                ForEach(roster) { player in
                    NavigationLink {
                        PlayerDetailView(player: player, team: team)
                    } label: {
                        HStack(spacing: 12) {
                            JerseyBadge(number: player.jerseyNumber)
                            VStack(alignment: .leading) {
                                Text(player.fullName)
                                if let position = player.position {
                                    Text(position).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if team.linkedPlayers.contains(where: { $0.id == player.id }) {
                                TagLabel(text: "Your child", tint: team.tint)
                            } else if team.playerSelf?.id == player.id {
                                TagLabel(text: "You", tint: team.tint)
                            }
                        }
                    }
                }
            } header: {
                Text("Roster · \(roster.count)")
            }

            if !members.isEmpty {
                Section("People") {
                    ForEach(members) { member in
                        HStack(spacing: 12) {
                            InitialsAvatar(name: member.name, tint: member.roles.contains(where: \.isStaff) ? team.tint : .secondary)
                            VStack(alignment: .leading) {
                                Text(member.name)
                                Text(member.roleSummary).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            if let errorText {
                Section { Text(errorText).foregroundStyle(.secondary) }
            }
        }
        .overlay { if isLoading && roster.isEmpty { ProgressView() } }
    }

    private func load() async {
        guard let team else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            roster = try await model.backend.roster(teamID: team.id)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        members = (try? await model.backend.teamMembers(teamID: team.id)) ?? []
    }
}

// MARK: - Invite families

struct InviteFamiliesView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var invite: InviteLink?
    @State private var errorText: String?
    @State private var confirmReset = false
    @State private var isResetting = false

    private var shareText: String {
        guard let invite else { return "" }
        return """
        Join \(team.name) on ClubHQ — schedules, RSVPs, and team chat in one ad-free app.
        Tap to join: \(invite.url.absoluteString)
        Or download ClubHQ, choose "I'm a parent or guardian", and enter team code: \(invite.token)
        """
    }

    private var spacedCode: String { invite?.spacedToken ?? "" }

    var body: some View {
        NavigationStack {
            ScrollView {
                inviteContent
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task {
                do {
                    invite = try await model.backend.createInvite(teamID: team.id)
                } catch {
                    errorText = error.localizedDescription
                }
            }
        }
    }

    private var inviteContent: some View {
        VStack(spacing: 24) {
            Image(systemName: "person.3.sequence.fill")
                .font(.system(size: 54))
                .foregroundStyle(team.tint)
                .padding(.top, 32)
            Text("Invite your families")
                .font(.title2.bold())
            Text("Share your team code in your group text or email. Parents create an account, enter the code, and add their child — no roster typing.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if let invite {
                VStack(spacing: 12) {
                    VStack(spacing: 4) {
                        Text("Team code").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(spacedCode)
                            .font(.system(size: 32, weight: .bold, design: .monospaced))
                            .textSelection(.enabled)
                            .accessibilityLabel("Team code \(invite.token.map(String.init).joined(separator: " "))")
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .background(.quaternary, in: .rect(cornerRadius: 12))
                    ShareLink(item: shareText) {
                        Label("Share Invite", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    Text("Works all season, until \(invite.expiresAt.formatted(date: .abbreviated, time: .omitted)). Families who already joined never need it again.")
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    NavigationLink {
                        MoveFromGroupMeView(team: team)
                    } label: {
                        Label("Moving from GroupMe? Step-by-step guide", systemImage: "arrow.right.arrow.left")
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.top, 4)
                }
            }
            if let errorText {
                Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center)
            } else if invite == nil {
                ProgressView()
            }
            if invite != nil {
                Button("Reset Code", role: .destructive) { confirmReset = true }
                    .font(.footnote)
                    .disabled(isResetting)
                    .padding(.top, 8)
                    // Attached to the button so the dialog points at it, not the top of the sheet.
                    .confirmationDialog("Reset the team code?", isPresented: $confirmReset, titleVisibility: .visible) {
                        Button("Reset Code", role: .destructive) { Task { await reset() } }
                    } message: {
                        Text("The current link and code stop working right away. Families who already joined aren't affected. Share the new invite with anyone still joining.")
                    }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }

    private func reset() async {
        isResetting = true
        defer { isResetting = false }
        do {
            invite = try await model.backend.resetInvite(teamID: team.id)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - Announcements

struct AnnouncementsView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @State private var announcements: [Announcement] = []
    @State private var showComposer = false
    @State private var isLoading = true
    @State private var reportFallbackShown = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            if announcements.isEmpty && !isLoading {
                ContentUnavailableView("No announcements yet", systemImage: "megaphone")
                    .listRowBackground(Color.clear)
            }
            ForEach(announcements) { announcement in
                VStack(alignment: .leading, spacing: 6) {
                    Text(announcement.title).font(.headline)
                    Text(announcement.body).font(.subheadline)
                    Text(announcement.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                .contextMenu {
                    Button("Report", systemImage: "exclamationmark.bubble") { report(announcement) }
                }
            }
        }
        .navigationTitle("Announcements")
        .alert("Report Copied", isPresented: $reportFallbackShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("No mail app is set up. The report has been copied. Paste it into an email to \(AppConfig.supportEmail) and we'll review it within 24 hours.")
        }
        .toolbar {
            if team.canPostAnnouncements {
                ToolbarItem(placement: .primaryAction) {
                    Button { showComposer = true } label: { Label("New", systemImage: "square.and.pencil") }
                }
            }
        }
        .sheet(isPresented: $showComposer, onDismiss: { Task { await load() } }) {
            AnnouncementComposer(teamID: team.id)
        }
        .task(id: model.refreshToken) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        announcements = (try? await model.backend.announcements(teamID: team.id)) ?? []
        isLoading = false
    }

    /// Prefilled report email identifying the announcement (App Review 1.2).
    private func report(_ announcement: Announcement) {
        let body = """
        I'd like to report this announcement as objectionable.

        Team: \(team.name)
        Title: \(announcement.title)
        Message: \(announcement.body)
        Posted: \(announcement.createdAt.formatted(date: .abbreviated, time: .shortened))

        Announcement ID: \(announcement.id.uuidString)
        Author ID: \(announcement.createdBy.uuidString)
        """
        guard let url = ReportMail.url(subject: "Report announcement in ClubHQ", body: body) else { return }
        openURL(url) { accepted in
            if !accepted {
                UIPasteboard.general.string = "To: \(AppConfig.supportEmail)\n\n\(body)"
                reportFallbackShown = true
            }
        }
    }
}

struct AnnouncementComposer: View {
    let teamID: UUID
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var bodyText = ""
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                TextField("Message", text: $bodyText, axis: .vertical).lineLimit(5...12)
                if let errorText { Text(errorText).foregroundStyle(.red) }
                Section {
                    EmptyView()
                } footer: {
                    Text("Everyone on the team gets this in their inbox and as a push notification.")
                }
            }
            .navigationTitle("Announcement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Post") {
                        do {
                            try await model.backend.createAnnouncement(teamID: teamID, title: title, body: bodyText)
                            model.noteDataChanged()
                            dismiss()
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(title.nilIfEmpty == nil || bodyText.nilIfEmpty == nil)
                }
            }
        }
    }
}

// MARK: - Team settings (Pro: brand color)

struct TeamSettingsView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @State private var color: Color = .accentColor
    @State private var errorText: String?

    private static let palette: [String] = ["#2457F5", "#D7263D", "#1B998B", "#F49D37", "#6A4C93", "#111827", "#0EA5E9", "#16A34A"]

    var body: some View {
        Form {
            if team.isPro || model.canSellPro {
            Section {
                if team.isPro {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], spacing: 12) {
                        ForEach(Self.palette, id: \.self) { hex in
                            Button {
                                Task { await setColor(hex) }
                            } label: {
                                Circle()
                                    .fill(Color(hex: hex) ?? .accentColor)
                                    .frame(width: 40, height: 40)
                                    .overlay {
                                        if team.brandColor == hex { Image(systemName: "checkmark").foregroundStyle(.white).bold() }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Team color \(hex)")
                        }
                    }
                    .padding(.vertical, 6)
                    Button("Use default color") { Task { await setColor(nil) } }
                } else {
                    ProUpsellRow(title: "Custom team colors", message: "Make the app feel like your team. Included with Coach Pro.")
                }
            } header: {
                Text("Team color")
            }
            }
            Section {
                NavigationLink {
                    PaymentMethodsView(team: team)
                } label: {
                    LabeledContent {
                        Text(team.hasPaymentHandles ? [team.venmoUsername.map { "@\($0)" }, team.cashappCashtag.map { "$\($0)" }]
                            .compactMap { $0 }.joined(separator: " · ") : "Not set")
                    } label: {
                        Label("Venmo & Cash App", systemImage: "dollarsign.circle")
                    }
                }
            } header: {
                Text("Payments")
            } footer: {
                Text("Families see Pay with Venmo and Pay with Cash App buttons on their dues.")
            }
            if let errorText { Text(errorText).foregroundStyle(.red) }
        }
        .navigationTitle("Team Settings")
    }

    private func setColor(_ hex: String?) async {
        do {
            try await model.backend.updateTeamColor(teamID: team.id, hex: hex)
            await model.reloadContext()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    TeamView().environment(AppModel.preview(.coach))
}

/// Invite sheet for the demo coach's team, once the context has loaded.
private struct InviteFamiliesPreview: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let team = model.selectedTeam { InviteFamiliesView(team: team) } else { ProgressView() }
    }
}

#Preview("Invite families") {
    InviteFamiliesPreview().environment(AppModel.preview(.coach))
}

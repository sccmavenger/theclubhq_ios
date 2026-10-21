import SwiftUI

/// Conversations for the selected team. Team chat is pinned on top. Staff can start
/// audience-targeted threads (everyone / parents / staff).
struct MessagesView: View {
    @Environment(AppModel.self) private var model
    @State private var threads: [MessageThread] = []
    @State private var isLoading = true
    @State private var errorText: String?
    @State private var showComposer = false
    @State private var path: [UUID] = []

    private var team: TeamMembership? { model.selectedTeam }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let team {
                    Section {
                        TeamChatLink(team: team, onOpen: { path.append($0) })
                    }
                }
                let others = threads.filter { !$0.isTeamChat }
                if !others.isEmpty {
                    Section("Threads") {
                        ForEach(others) { thread in
                            NavigationLink(value: thread.id) { ThreadRow(thread: thread) }
                        }
                    }
                }
                if let errorText {
                    Section { Text(errorText).foregroundStyle(.secondary) }
                }
                if team?.isPlayer == true && team?.isStaff == false && team?.isGuardian == false {
                    Section {
                        Label("Players can chat with the whole team. Coaches and parents can see team chat.", systemImage: "shield.lefthalf.filled")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Messages")
            .navigationDestination(for: UUID.self) { ChatView(threadID: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TeamSwitcher() }
                if team?.canStartThreads == true {
                    ToolbarItem(placement: .primaryAction) {
                        Button { showComposer = true } label: { Label("New Thread", systemImage: "square.and.pencil") }
                    }
                }
            }
            .sheet(isPresented: $showComposer, onDismiss: { Task { await load() } }) {
                if let team { NewThreadView(teamID: team.id) { path.append($0) } }
            }
            .task(id: "\(model.refreshToken)-\(team?.id.uuidString ?? "")") { await load() }
            .refreshable { await load() }
            .overlay { if isLoading && threads.isEmpty { ProgressView() } }
        }
    }

    private func load() async {
        guard let team else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            threads = try await model.backend.threads(teamID: team.id)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private struct ThreadRow: View {
    let thread: MessageThread

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: thread.audience == .staff ? "lock.fill" : (thread.audience == .parents ? "figure.2.and.child.holdinghands" : "person.3.fill"))
                .foregroundStyle(.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.displayTitle).font(.headline).lineLimit(1)
                    if thread.muted { Image(systemName: "bell.slash.fill").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if let at = thread.lastMessageAt {
                        Text(at, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let last = thread.lastMessage {
                    Text("\(thread.lastAuthorName.map { "\($0): " } ?? "")\(last)")
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(thread.audience.displayName).font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
            }
            if thread.unread {
                Circle().fill(Color.accentColor).frame(width: 10, height: 10).accessibilityLabel("Unread")
            }
        }
        .padding(.vertical, 2)
    }
}

/// Opens (creating on first use) the team-wide chat.
struct TeamChatLink: View {
    let team: TeamMembership
    var onOpen: ((UUID) -> Void)?
    @Environment(AppModel.self) private var model
    @State private var threadID: UUID?
    @State private var isOpening = false

    var body: some View {
        Group {
            if let onOpen {
                Button { Task { if let id = await resolve() { onOpen(id) } } } label: { label }
                    .buttonStyle(.plain)
            } else {
                NavigationLink {
                    if let threadID { ChatView(threadID: threadID) } else { ProgressView().task { _ = await resolve() } }
                } label: { label }
            }
        }
        .task { _ = await resolve() }
    }

    private var label: some View {
        HStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(team.tint.gradient, in: .circle)
            VStack(alignment: .leading) {
                Text("Team chat").font(.headline)
                Text("Coaches, parents, and players").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if isOpening {
                ProgressView()
            } else if onOpen != nil {
                // NavigationLink draws its own chevron; only the button variant needs one.
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
        }
        .contentShape(.rect)
    }

    private func resolve() async -> UUID? {
        if let threadID { return threadID }
        isOpening = true
        defer { isOpening = false }
        threadID = try? await model.backend.teamChatThreadID(teamID: team.id)
        return threadID
    }
}

/// From an event: jump to team chat to ask a question.
struct EventThreadLink: View {
    let event: TeamEvent
    let team: TeamMembership

    var body: some View {
        TeamChatLink(team: team)
    }
}

struct NewThreadView: View {
    let teamID: UUID
    let onCreated: (UUID) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var audience: MessageAudience = .parents
    @State private var bodyText = ""
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Subject", text: $title)
                    Picker("Who can see this", selection: $audience) {
                        ForEach(MessageAudience.allCases) { Text($0.displayName).tag($0) }
                    }
                } footer: {
                    Text(audience == .staff ? "Only coaches and team managers." : (audience == .parents ? "Guardians and staff. Players don't see this thread." : "Everyone on the team, including players."))
                }
                Section {
                    TextField("Message", text: $bodyText, axis: .vertical).lineLimit(4...10)
                }
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .navigationTitle("New Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Send") {
                        do {
                            let id = try await model.backend.createThread(teamID: teamID, title: title, audience: audience, body: bodyText)
                            dismiss()
                            onCreated(id)
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(bodyText.nilIfEmpty == nil)
                }
            }
        }
    }
}

#Preview {
    MessagesView().environment(AppModel.preview(.coach))
}

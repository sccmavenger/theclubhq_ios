import SwiftUI

/// A conversation. Polls every 5 s while visible (DECISIONS D-016).
struct ChatView: View {
    let threadID: UUID
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var detail: ThreadDetail?
    @State private var draft = ""
    @State private var isSending = false
    @State private var errorText: String?
    @State private var isMuted = false
    @State private var blockCandidate: ChatMessage?
    @State private var reportFallbackShown = false
    @FocusState private var composerFocused: Bool
    @Environment(\.openURL) private var openURL
    /// Comma-separated author IDs this user has blocked; their messages are hidden on this device
    /// (App Review guideline 1.2).
    @AppStorage("blockedAuthorIDs") private var blockedAuthorIDsRaw = ""

    private var blockedAuthorIDs: Set<UUID> {
        Set(blockedAuthorIDsRaw.split(separator: ",").compactMap { UUID(uuidString: String($0)) })
    }

    private var messages: [ChatMessage] {
        let blocked = blockedAuthorIDs
        return (detail?.messages ?? []).filter { $0.isMine || !blocked.contains($0.authorId) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    if detail != nil && messages.isEmpty {
                        ContentUnavailableView("No messages yet", systemImage: "bubble.left.and.bubble.right", description: Text("Say hi to the team."))
                            .padding(.top, 60)
                    }
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        let previous = index > 0 ? messages[index - 1] : nil
                        if previous == nil || !Calendar.current.isDate(previous!.createdAt, inSameDayAs: message.createdAt) {
                            Text(message.createdAt.relativeDayLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .padding(.top, 12)
                        }
                        MessageBubble(message: message, showAuthor: previous?.authorId != message.authorId,
                                      canDelete: message.isMine || detail?.thread.canModerate == true,
                                      onDelete: { Task { await delete(message) } },
                                      onReport: { report(message) },
                                      onBlock: { blockCandidate = message })
                        .id(message.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.last?.id) { _, last in
                if let last { withAnimation { proxy.scrollTo(last, anchor: .bottom) } }
            }
        }
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(detail?.thread.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await toggleMute() }
                } label: {
                    Label(isMuted ? "Unmute" : "Mute", systemImage: isMuted ? "bell.slash.fill" : "bell")
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Report a Concern", systemImage: "exclamationmark.bubble") { reportConversation() }
            }
            if !blockedAuthorIDs.isEmpty {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Unblock All Members", systemImage: "person.crop.circle.badge.checkmark") {
                        blockedAuthorIDsRaw = ""
                    }
                }
            }
        }
        .confirmationDialog("Block \(blockCandidate?.authorName ?? "this member")?",
                            isPresented: Binding(get: { blockCandidate != nil }, set: { if !$0 { blockCandidate = nil } }),
                            titleVisibility: .visible, presenting: blockCandidate) { message in
            Button("Block", role: .destructive) { block(message.authorId) }
            Button("Block and Report", role: .destructive) {
                block(message.authorId)
                report(message)
            }
        } message: { _ in
            Text("You won't see their messages on this device. Report them so we can review it.")
        }
        .alert("Report Copied", isPresented: $reportFallbackShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("No mail app is set up. The report has been copied. Paste it into an email to \(AppConfig.supportEmail) and we'll review it within 24 hours.")
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                await load()
            }
        }
    }

    @ViewBuilder private var composer: some View {
        if detail?.thread.canPost == false {
            Text("You can read this conversation but not reply.")
                .font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding()
                .background(.bar)
        } else {
            VStack(spacing: 4) {
                if let errorText {
                    Text(errorText).font(.caption).foregroundStyle(.red)
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Message", text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($composerFocused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 34))
                    }
                    .disabled(draft.nilIfEmpty == nil || isSending)
                    .accessibilityLabel("Send")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
        }
    }

    private func load() async {
        do {
            let isFirstLoad = detail == nil
            detail = try await model.backend.threadDetail(threadID: threadID, since: nil)
            // Mute state lives on the thread list; read it once, not on every poll.
            if isFirstLoad, let teamID = detail?.thread.teamId {
                isMuted = (try? await model.backend.threads(teamID: teamID).first { $0.id == threadID }?.muted) ?? isMuted
            }
            errorText = nil
        } catch {
            if detail == nil { errorText = error.localizedDescription }
        }
    }

    private func send() async {
        guard let body = draft.nilIfEmpty else { return }
        isSending = true
        defer { isSending = false }
        let previous = draft
        draft = ""
        // Optimistic: show the bubble immediately; the reload replaces it with the server copy.
        let pending = ChatMessage(id: UUID(), authorId: model.backend.currentUserID ?? UUID(), authorName: "",
                                  body: body, createdAt: .now, editedAt: nil, isDeleted: false, isMine: true)
        detail?.messages.append(pending)
        do {
            try await model.backend.postMessage(threadID: threadID, body: body)
            await load()
        } catch {
            detail?.messages.removeAll { $0.id == pending.id }
            draft = previous
            errorText = error.localizedDescription
        }
    }

    private func delete(_ message: ChatMessage) async {
        do {
            try await model.backend.deleteMessage(id: message.id)
            await load()
        } catch {
            errorText = error.localizedDescription
        }
    }

    /// Opens a prefilled email to ClubHQ support identifying the message, for moderation review.
    private func report(_ message: ChatMessage) {
        let body = """
        I'd like to report this message as objectionable.

        From: \(message.authorName)
        Sent: \(message.createdAt.formatted(date: .abbreviated, time: .shortened))
        Message: \(message.body)

        Thread ID: \(threadID.uuidString)
        Message ID: \(message.id.uuidString)
        Author ID: \(message.authorId.uuidString)
        """
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = AppConfig.supportEmail
        components.queryItems = [URLQueryItem(name: "subject", value: "Report message in ClubHQ"),
                                 URLQueryItem(name: "body", value: body)]
        guard let url = components.url else { return }
        openURL(url) { accepted in
            // No mail app configured: show the address and copy the report so it isn't lost.
            if !accepted {
                UIPasteboard.general.string = "To: \(AppConfig.supportEmail)\n\n\(body)"
                reportFallbackShown = true
            }
        }
    }

    /// General report about this conversation, reachable from the toolbar (long-press reports one message).
    private func reportConversation() {
        let body = """
        I'd like to report a concern in this conversation.

        What happened:


        Conversation: \(detail?.thread.title ?? "")
        Thread ID: \(threadID.uuidString)
        (Tip: long-press a specific message to report or block its author.)
        """
        guard let url = ReportMail.url(subject: "Report a concern in ClubHQ", body: body) else { return }
        openURL(url) { accepted in
            if !accepted {
                UIPasteboard.general.string = "To: \(AppConfig.supportEmail)\n\n\(body)"
                reportFallbackShown = true
            }
        }
    }

    private func block(_ authorID: UUID) {
        var ids = blockedAuthorIDs
        ids.insert(authorID)
        blockedAuthorIDsRaw = ids.map(\.uuidString).joined(separator: ",")
    }

    private func toggleMute() async {
        do {
            try await model.backend.setMute(threadID: threadID, muted: !isMuted)
            isMuted.toggle()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage
    let showAuthor: Bool
    let canDelete: Bool
    let onDelete: () -> Void
    let onReport: () -> Void
    let onBlock: () -> Void

    var body: some View {
        VStack(alignment: message.isMine ? .trailing : .leading, spacing: 2) {
            if showAuthor && !message.isMine {
                Text(message.authorName).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    .padding(.leading, 10)
            }
            Text(message.body)
                .italic(message.isDeleted)
                .foregroundStyle(message.isMine ? Color.white : Color.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(message.isMine ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color(.secondarySystemBackground)),
                            in: .rect(cornerRadius: 18))
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.body }
                    if canDelete && !message.isDeleted {
                        Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
                    }
                    if !message.isMine && !message.isDeleted {
                        Button("Report", systemImage: "exclamationmark.bubble", action: onReport)
                        Button("Block \(message.authorName)", systemImage: "hand.raised", role: .destructive, action: onBlock)
                    }
                }
            Text(message.createdAt.timeLabel).font(.caption2).foregroundStyle(.tertiary).padding(.horizontal, 10)
        }
        .frame(maxWidth: .infinity, alignment: message.isMine ? .trailing : .leading)
        .padding(message.isMine ? .leading : .trailing, 48)
        .accessibilityElement(children: .combine)
    }
}

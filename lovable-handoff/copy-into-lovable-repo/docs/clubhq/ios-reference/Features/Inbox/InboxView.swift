import SwiftUI

/// The in-app notification inbox — source of truth even when push is off.
struct InboxView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var items: [InboxItem] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            List {
                if items.isEmpty && !isLoading {
                    ContentUnavailableView("You're all caught up", systemImage: "bell")
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { item in
                    Button {
                        Task { await open(item) }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: item.kind.symbolName)
                                .foregroundStyle(item.isUnread ? Color.accentColor : .secondary)
                                .frame(width: 26)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.subject)
                                    .font(.subheadline.weight(item.isUnread ? .semibold : .regular))
                                    .foregroundStyle(.primary)
                                Text(item.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                                Text(item.createdAt, format: .relative(presentation: .named))
                                    .font(.caption).foregroundStyle(.tertiary)
                            }
                            Spacer(minLength: 0)
                            if item.isUnread {
                                Circle().fill(Color.accentColor).frame(width: 9, height: 9).padding(.top, 6)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Notifications")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("Mark All Read") { Task { await markAll() } }
                        .disabled(!items.contains(where: \.isUnread))
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .overlay { if isLoading && items.isEmpty { ProgressView() } }
        }
    }

    private func load() async {
        isLoading = true
        items = (try? await model.backend.inbox()) ?? []
        isLoading = false
    }

    private func open(_ item: InboxItem) async {
        try? await model.backend.markRead(id: item.id)
        if let destination = item.destination {
            dismiss()
            model.pendingDeepLink = destination
        } else {
            await load()
        }
    }

    private func markAll() async {
        try? await model.backend.markRead(id: nil)
        await load()
    }
}

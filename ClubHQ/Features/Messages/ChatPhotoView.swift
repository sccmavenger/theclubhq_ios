import SwiftUI

/// Downloaded chat photos, keyed by message ID. The chat polls every 5 s and each poll
/// returns freshly signed URLs (D-036), so caching by URL would re-download every time.
@MainActor
final class ChatImageCache {
    static let shared = ChatImageCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.totalCostLimit = 80 * 1024 * 1024 // roughly 80 MB of decoded pixels
    }

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func store(_ image: UIImage, for key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    /// Loads from the cache, a local file (demo and just-sent photos), or the signed URL.
    func load(_ url: URL, key: String) async throws -> UIImage {
        if let cached = image(for: key) { return cached }
        let data: Data
        if url.isFileURL {
            data = try Data(contentsOf: url)
        } else {
            let (downloaded, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            data = downloaded
        }
        guard let image = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
        let prepared = await image.byPreparingForDisplay() ?? image
        store(prepared, for: key)
        return prepared
    }
}

/// A photo inside a chat bubble. Reserves its final size from the stored dimensions so the
/// conversation doesn't jump while it loads.
struct ChatPhotoView: View {
    let message: ChatMessage
    var onOpen: (UIImage) -> Void = { _ in }

    @State private var image: UIImage?
    @State private var failed = false

    private var aspectRatio: CGFloat {
        guard let w = message.imageWidth, let h = message.imageHeight, w > 0, h > 0 else { return 4.0 / 3.0 }
        return min(max(CGFloat(w) / CGFloat(h), 0.5), 2.0) // very tall or wide photos get cropped
    }

    var body: some View {
        Color(.tertiarySystemFill)
            .aspectRatio(aspectRatio, contentMode: .fit)
            .frame(width: 240)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else if failed {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }
            .clipShape(.rect(cornerRadius: 16))
            .contentShape(.rect(cornerRadius: 16))
            .onTapGesture { if let image { onOpen(image) } }
            .accessibilityElement()
            .accessibilityLabel("Photo from \(message.isMine ? "you" : message.authorName)")
            .accessibilityAddTraits(.isImage)
            .accessibilityAction(named: "Open") { if let image { onOpen(image) } }
            .task(id: message.id) {
                guard let url = message.imageUrl else { return }
                image = ChatImageCache.shared.image(for: message.id.uuidString)
                guard image == nil else { return }
                do {
                    image = try await ChatImageCache.shared.load(url, key: message.id.uuidString)
                    failed = false
                } catch {
                    failed = true
                }
            }
    }
}

/// Demo team chat with a freshly posted photo, to see photo bubbles in the canvas.
private struct ChatWithPhotoPreview: View {
    @Environment(AppModel.self) private var model
    @State private var threadID: UUID?

    var body: some View {
        NavigationStack {
            if let threadID { ChatView(threadID: threadID) } else { ProgressView() }
        }
        .task(id: model.selectedTeam?.id) {
            guard threadID == nil, let team = model.selectedTeam,
                  let id = try? await model.backend.teamChatThreadID(teamID: team.id) else { return }
            let renderer = ImageRenderer(content: LinearGradient(colors: [.orange, .purple], startPoint: .top, endPoint: .bottom)
                .frame(width: 400, height: 300))
            if let data = renderer.uiImage?.jpegData(compressionQuality: 0.9), let photo = try? ChatPhoto.make(from: data) {
                try? await model.backend.postPhoto(threadID: id, photo: photo, caption: "Team photo after the win!")
            }
            threadID = id
        }
    }
}

#Preview("Chat with a photo") {
    ChatWithPhotoPreview().environment(AppModel.preview(.coach))
}

/// Full-screen photo with Share (which includes Save Image).
struct ChatPhotoViewer: View {
    let photo: ViewedPhoto
    @Environment(\.dismiss) private var dismiss

    struct ViewedPhoto: Identifiable {
        let id: UUID
        let image: UIImage
        let authorName: String
    }

    var body: some View {
        NavigationStack {
            Image(uiImage: photo.image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
                .accessibilityLabel("Photo from \(photo.authorName)")
                .navigationTitle(photo.authorName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                    ToolbarItem(placement: .primaryAction) {
                        let image = Image(uiImage: photo.image)
                        ShareLink(item: image, preview: SharePreview("Team photo", image: image))
                    }
                }
        }
        // Black backdrop: keep the title and buttons legible in light mode too.
        .preferredColorScheme(.dark)
    }
}

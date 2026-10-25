import SwiftUI

// ClubHQ brand palette and logos. Values live in ClubHQBrand.xcassets, and the
// semantic colors switch between light and dark mode automatically.
extension Color {
    enum Brand {
        // Semantic: use these in views
        static let background = Color("BrandBackground")
        static let surface = Color("BrandSurface")
        static let border = Color("BrandBorder")
        static let text = Color("BrandText")
        static let textSecondary = Color("BrandTextSecondary")
        static let accent = Color("BrandAccent")
        static let onAccent = Color("BrandOnAccent")
        static let cta = Color("BrandCTA")
        static let onCTA = Color("BrandOnCTA")

        // Raw brand colors: illustrations, marketing moments
        static let navy = Color("BrandNavy")
        static let midnight = Color("BrandMidnight")
        static let cyan = Color("BrandCyan")
        static let deepCyan = Color("BrandDeepCyan")
        static let orange = Color("BrandOrange")
        static let deepOrange = Color("BrandDeepOrange")
    }
}

extension Image {
    enum Brand {
        static let mark = Image("BrandMark")
        static let markWhite = Image("BrandMarkWhite")
        static let markOnNavy = Image("BrandMarkOnNavy")
        static let wordmark = Image("BrandWordmark")
        static let lockup = Image("BrandLockup")
        static let lockupStacked = Image("BrandLockupStacked")
    }
}

/// Primary call-to-action: orange with a navy label (7.05:1 contrast).
struct BrandCTAButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.Brand.onCTA)
            .tint(Color.Brand.onCTA)  // loading spinners inside the label
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(Color.Brand.cta, in: .rect(cornerRadius: 14))
            // Disabled until a form is complete (e.g. Sign In), so it needs a visible off state.
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
    }
}

#Preview("Brand") {
    VStack(spacing: 24) {
        HStack(spacing: 16) {
            BrandMark(size: 44)
            BrandMark(size: 72)
            BrandMark(size: 96)
        }
        Image.Brand.lockup.resizable().scaledToFit().frame(height: 36)
        Button("Create Team") {}.buttonStyle(BrandCTAButtonStyle())
        Button("Create Team") {}.buttonStyle(BrandCTAButtonStyle()).disabled(true)
    }
    .padding()
}

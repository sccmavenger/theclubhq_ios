import SwiftUI

/// The ClubHQ mark on its navy tile — matches the app icon.
struct BrandMark: View {
    var size: CGFloat = 44

    var body: some View {
        Image.Brand.markOnNavy
            .resizable()
            .scaledToFit()
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [Color(hex: "#1A4280") ?? Color.Brand.navy, Color.Brand.navy, Color.Brand.midnight],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: .rect(cornerRadius: size * 0.225, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// Circular initials avatar.
struct InitialsAvatar: View {
    let name: String
    var size: CGFloat = 36
    var tint: Color = .accentColor

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.map { String($0.prefix(1)) }.joined().uppercased()
    }

    var body: some View {
        Text(initials.isEmpty ? "?" : initials)
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.15), in: .circle)
            .accessibilityHidden(true)
    }
}

/// Jersey-number badge for roster rows.
struct JerseyBadge: View {
    let number: String?

    var body: some View {
        Text(number.map { "#\($0)" } ?? "—")
            .font(.subheadline.monospacedDigit().weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(minWidth: 40, alignment: .leading)
    }
}

/// Small capsule label (e.g., "Pro", "Cancelled", "Staff only").
struct TagLabel: View {
    let text: String
    var tint: Color = .accentColor
    var systemImage: String?

    var body: some View {
        // HStack rather than Label: Label's icon gap is sized for list rows and left a wide
        // hole between the sparkles and "Pro" (TestFlight feedback, build 25).
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            Text(text)
        }
        .accessibilityElement(children: .combine)
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(tint)
        .background(tint.opacity(0.14), in: .capsule)
    }
}

/// Three-way RSVP control. Disabled when RSVPs are locked.
struct RSVPPicker: View {
    let selection: RSVPStatus?
    var isLocked = false
    var compact = false
    let onSelect: (RSVPStatus) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(RSVPStatus.allCases) { status in
                let isSelected = selection == status
                Button {
                    onSelect(status)
                } label: {
                    Group {
                        if compact {
                            Image(systemName: status.symbolName)
                        } else {
                            Label(status.displayName, systemImage: status.symbolName)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                        }
                    }
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: compact ? nil : .infinity)
                        .padding(.vertical, 8)
                        .padding(.horizontal, compact ? 10 : 4)
                        .foregroundStyle(isSelected ? .white : status.tint)
                        .background(isSelected ? status.tint : status.tint.opacity(0.12), in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(status.displayName)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .disabled(isLocked)
        .opacity(isLocked ? 0.5 : 1)
    }
}

extension RSVPStatus {
    /// Darker than the system colors so white text on a selected pill meets WCAG AA (≥ 4.5:1).
    var tint: Color {
        switch self {
        case .yes: Color(red: 0.11, green: 0.52, blue: 0.24)   // #1C853D
        case .maybe: Color(red: 0.70, green: 0.36, blue: 0.0)  // #B35C00
        case .no: Color(red: 0.77, green: 0.16, blue: 0.16)    // #C42929
        }
    }
}

extension AttendanceStatus {
    var tint: Color {
        switch self {
        case .present: .green
        case .late: .orange
        case .absent: .red
        case .excused: .gray
        }
    }
}

extension DuesStatus {
    var tint: Color {
        switch self {
        case .paid: .green
        case .waived: .gray
        case .processing: .blue
        case .unpaid: .orange
        }
    }
}

/// Banner shown on Pro-gated features (never on anything a parent needs).
/// Prefilled email to ClubHQ support for reporting objectionable content (App Review 1.2).
enum ReportMail {
    static func url(subject: String, body: String) -> URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = AppConfig.supportEmail
        components.queryItems = [URLQueryItem(name: "subject", value: subject), URLQueryItem(name: "body", value: body)]
        return components.url
    }
}

struct ProUpsellRow: View {
    let title: String
    let message: String
    @Environment(AppModel.self) private var model
    @State private var showPaywall = false

    var body: some View {
        if model.canSellPro {
            upsellButton
        }
    }

    private var upsellButton: some View {
        Button { showPaywall = true } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary)
                    Text(message).font(.caption).foregroundStyle(Color.secondary)
                }
                Spacer(minLength: 0)
                TagLabel(text: "Pro")
            }
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }
}

extension Color {
    /// `#RRGGBB` → Color; nil for malformed input.
    init?(hex: String?) {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// Team colors tint text, links, toggles and buttons app-wide, so each one is adjusted for
/// readability (TestFlight feedback, build 25: dark red on black was hard to read). Keeps the hue
/// and saturation and moves lightness until the color reaches WCAG AA 4.5:1 against the darkest
/// card in dark mode (#2C2C2E) or the grouped background in light mode (#F2F2F7).
enum ReadableColor {
    static let minimumContrast = 4.5
    static let darkReference: (Double, Double, Double) = (0x2C / 255, 0x2C / 255, 0x2E / 255)
    static let lightReference: (Double, Double, Double) = (0xF2 / 255, 0xF2 / 255, 0xF7 / 255)

    /// White labels on filled buttons. 3:1 is AA for buttons and bold text; dark mode can't reach
    /// 4.5:1 for both text-on-card and white-on-color, so text gets 4.5:1 and labels 3:1.
    static let minimumLabelContrast = 3.0

    /// The readable version of an sRGB color for one appearance.
    static func adjusted(_ rgb: (Double, Double, Double), dark: Bool) -> (Double, Double, Double) {
        let reference = dark ? darkReference : lightReference
        let white = (1.0, 1.0, 1.0)
        var (h, s, l) = hsl(rgb)
        var color = rgb
        // Darken (light mode) or lighten (dark mode) until text on the background is readable.
        while contrast(color, reference) < minimumContrast, l > 0, l < 1 {
            l = dark ? min(1, l + 0.001) : max(0, l - 0.001)
            color = fromHSL(h, s, l)
        }
        // Dark mode: colors that are already light (orange, sky blue) leave white button labels
        // faint, so darken them as far as the text contrast allows.
        if dark {
            while contrast(white, color) < minimumLabelContrast, l > 0 {
                let candidate = fromHSL(h, s, l - 0.001)
                if contrast(candidate, reference) < minimumContrast { break }
                l -= 0.001
                color = candidate
            }
        }
        return color
    }

    static func contrast(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    static func luminance(_ c: (Double, Double, Double)) -> Double {
        func linear(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(c.0) + 0.7152 * linear(c.1) + 0.0722 * linear(c.2)
    }

    static func rgb(hex: String?) -> (Double, Double, Double)? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
    }

    /// A color that resolves to the readable shade for the current light/dark appearance.
    static func color(hex: String?) -> Color? {
        guard let rgb = rgb(hex: hex) else { return nil }
        let light = adjusted(rgb, dark: false), dark = adjusted(rgb, dark: true)
        return Color(uiColor: UIColor { traits in
            let c = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
        })
    }

    private static func hsl(_ c: (Double, Double, Double)) -> (Double, Double, Double) {
        let maxV = max(c.0, c.1, c.2), minV = min(c.0, c.1, c.2), l = (maxV + minV) / 2
        guard maxV != minV else { return (0, 0, l) }
        let d = maxV - minV
        let s = l > 0.5 ? d / (2 - maxV - minV) : d / (maxV + minV)
        var h: Double
        switch maxV {
        case c.0: h = (c.1 - c.2) / d + (c.1 < c.2 ? 6 : 0)
        case c.1: h = (c.2 - c.0) / d + 2
        default: h = (c.0 - c.1) / d + 4
        }
        h /= 6
        return (h, s, l)
    }

    private static func fromHSL(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
        guard s > 0 else { return (l, l, l) }
        func hue(_ p: Double, _ q: Double, _ t0: Double) -> Double {
            var t = t0
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1 / 6 { return p + (q - p) * 6 * t }
            if t < 1 / 2 { return q }
            if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
            return p
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
        return (hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3))
    }
}

/// The team colors a Pro coach can pick in Team Settings. Navy (#1E3A8A) replaced near-black
/// #111827, which disappeared in dark mode; swatches show the readable shade (`ReadableColor`).
enum TeamPalette {
    static let colors = ["#2457F5", "#D7263D", "#1B998B", "#F49D37", "#6A4C93", "#1E3A8A", "#0EA5E9", "#16A34A"]
}

extension TeamMembership {
    /// ClubHQ blue (#0077C2) when the team has no color of its own; both are contrast-adjusted.
    var tint: Color { ReadableColor.color(hex: brandColor) ?? ReadableColor.color(hex: "#0077C2") ?? .accentColor }
}

// MARK: - Formatting

extension Date {
    /// "Tue, Oct 14"
    var dayLabel: String { formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
    /// "6:00 PM"
    var timeLabel: String { formatted(date: .omitted, time: .shortened) }
    /// "Today", "Tomorrow", or "Tue, Oct 14"
    var relativeDayLabel: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(self) { return "Today" }
        if calendar.isDateInTomorrow(self) { return "Tomorrow" }
        if calendar.isDateInYesterday(self) { return "Yesterday" }
        return dayLabel
    }
}

extension TeamEvent {
    var timeRangeLabel: String {
        guard let endsAt else { return startsAt.timeLabel }
        return "\(startsAt.timeLabel) – \(endsAt.timeLabel)"
    }

    /// Apple Maps search URL for the address (or venue name).
    var mapsURL: URL? {
        guard let query = (locationAddress ?? location)?.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        return URL(string: "https://maps.apple.com/?q=\(query)")
    }
}

extension View {
    /// Adds a "Done" button above the keyboard — number and phone pads have no return key,
    /// so without this they can trap people on a form.
    func keyboardDoneButton() -> some View {
        toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
                .fontWeight(.semibold)
            }
        }
    }
}

/// A button that runs async work and shows a spinner while busy.
struct AsyncButton<Label: View>: View {
    var role: ButtonRole?
    let action: () async -> Void
    @ViewBuilder let label: () -> Label
    @State private var isRunning = false

    init(role: ButtonRole? = nil, action: @escaping () async -> Void, @ViewBuilder label: @escaping () -> Label) {
        self.role = role
        self.action = action
        self.label = label
    }

    var body: some View {
        Button(role: role) {
            guard !isRunning else { return }
            isRunning = true
            Task {
                await action()
                isRunning = false
            }
        } label: {
            ZStack {
                label().opacity(isRunning ? 0 : 1)
                if isRunning { ProgressView() }
            }
        }
        .disabled(isRunning)
    }
}

extension AsyncButton where Label == Text {
    init(_ title: String, role: ButtonRole? = nil, action: @escaping () async -> Void) {
        self.init(role: role, action: action) { Text(title) }
    }
}

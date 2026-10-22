import SwiftUI

/// The ClubHQ mark — the same "Home Court" artwork as the app icon
/// (design/app-icon/A-home-court), drawn natively so it stays crisp at any size.
struct BrandMark: View {
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            HomeCourtHouse()
                .fill(.white)
            HomeCourtLines()
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: size * 34 / 1024, lineCap: .round))
            Circle()
                .fill(Color.accentColor)
                .frame(width: size * 44 / 1024, height: size * 44 / 1024)
                .offset(y: size * (612 - 512) / 1024)
        }
        .frame(width: size, height: size)
        .background(
            LinearGradient(colors: [Color(hex: "#3B7BFF") ?? .accentColor, Color(hex: "#1838C9") ?? .accentColor],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .rect(cornerRadius: size * 0.225, style: .continuous)
        )
        .accessibilityHidden(true)
    }
}

/// House silhouette from the icon, in a 1024-unit design space scaled to the frame.
private struct HomeCourtHouse: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 1024
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(512, 196))
        path.addLine(to: p(822, 444))
        path.addQuadCurve(to: p(836, 474), control: p(836, 456))
        path.addLine(to: p(836, 776))
        path.addQuadCurve(to: p(784, 828), control: p(836, 828))
        path.addLine(to: p(240, 828))
        path.addQuadCurve(to: p(188, 776), control: p(188, 828))
        path.addLine(to: p(188, 474))
        path.addQuadCurve(to: p(202, 444), control: p(188, 456))
        path.closeSubpath()
        return path
    }
}

/// Center line and center circle.
private struct HomeCourtLines: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 1024
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 262 * s, y: rect.minY + 612 * s))
        path.addLine(to: CGPoint(x: rect.minX + 762 * s, y: rect.minY + 612 * s))
        path.addEllipse(in: CGRect(x: rect.minX + 400 * s, y: rect.minY + 500 * s, width: 224 * s, height: 224 * s))
        return path
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
        Label {
            Text(text)
        } icon: {
            if let systemImage { Image(systemName: systemImage) }
        }
        .labelStyle(.titleAndIcon)
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
    @State private var showPaywall = false

    var body: some View {
        if AppConfig.coachProPurchasesEnabled {
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
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    Text(message).font(.caption).foregroundStyle(.secondary)
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

extension TeamMembership {
    var tint: Color { Color(hex: brandColor) ?? .accentColor }
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

import Testing
@testable import ClubHQ

/// Team colors tint text app-wide, so every one must stay readable in both appearances
/// (TestFlight feedback, build 25: dark red on black).
@MainActor
struct ReadableColorTests {
    /// Every swatch, the ClubHQ blue, and the old near-black swatch some teams still have saved.
    static let colors = TeamPalette.colors + ["#0077C2", "#111827"]

    @Test(arguments: colors)
    func readableInDarkMode(hex: String) throws {
        let rgb = try #require(ReadableColor.rgb(hex: hex))
        let adjusted = ReadableColor.adjusted(rgb, dark: true)
        #expect(ReadableColor.contrast(adjusted, ReadableColor.darkReference) >= 4.5)
        #expect(ReadableColor.contrast(adjusted, (0, 0, 0)) >= 4.5) // plain black backgrounds too
        #expect(ReadableColor.contrast((1, 1, 1), adjusted) >= 3.0) // white label on a filled button
    }

    @Test(arguments: colors)
    func readableInLightMode(hex: String) throws {
        let rgb = try #require(ReadableColor.rgb(hex: hex))
        let adjusted = ReadableColor.adjusted(rgb, dark: false)
        #expect(ReadableColor.contrast(adjusted, ReadableColor.lightReference) >= 4.5)
        #expect(ReadableColor.contrast(adjusted, (1, 1, 1)) >= 4.5) // white cards too
        #expect(ReadableColor.contrast((1, 1, 1), adjusted) >= 4.5) // white label on a filled button
    }

    /// Colors that already pass are left exactly as the coach picked them.
    @Test func passingColorsAreUnchanged() throws {
        let navy = try #require(ReadableColor.rgb(hex: "#1E3A8A")) // already 9:1 in light mode
        let adjusted = ReadableColor.adjusted(navy, dark: false)
        #expect(abs(adjusted.0 - navy.0) < 0.001 && abs(adjusted.1 - navy.1) < 0.001 && abs(adjusted.2 - navy.2) < 0.001)
    }

    @Test func malformedHexIsRejected() {
        #expect(ReadableColor.rgb(hex: "red") == nil)
        #expect(ReadableColor.rgb(hex: "#12345") == nil)
        #expect(ReadableColor.rgb(hex: nil) == nil)
    }
}

import XCTest

/// Tap-through regression tests for the main flows (docs/TESTING.md, "ui" suite).
/// They use Demo mode, so they need no server or accounts and give the same result every run.
/// Every test launches with `-UITestReset`: signed out, no saved team, tour or invite.
final class ClubHQUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-UITestReset"]
        app.launch()
    }

    // MARK: Helpers

    /// Starts Demo mode as a persona from the sign-in screen and waits for the tabs.
    private func explore(as persona: String) {
        let button = app.buttons["Explore as \(persona)"]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "The sign-in screen should offer Demo mode as \(persona)")
        button.tap()
        XCTAssertTrue(tab("Home").waitForExistence(timeout: 15), "Demo mode should open the tabs")
    }

    private func tab(_ name: String) -> XCUIElement { app.tabBars.buttons[name] }

    private func open(tab name: String) {
        let t = tab(name)
        XCTAssertTrue(t.waitForExistence(timeout: 10), "\(name) tab is missing")
        t.tap()
    }

    // MARK: Tests

    func testSignInScreenOffersSignInAndDemo() {
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.secureTextFields["Password"].exists || app.textFields["Password"].exists)
        for persona in ["Coach", "Parent", "Player"] {
            XCTAssertTrue(app.buttons["Explore as \(persona)"].exists, "Demo as \(persona) is missing")
        }
    }

    func testCoachCanVisitEveryTab() {
        explore(as: "Coach")
        open(tab: "Schedule")
        XCTAssertTrue(app.navigationBars["Schedule"].waitForExistence(timeout: 10))
        open(tab: "Team")
        XCTAssertTrue(app.staticTexts["Team Settings"].waitForExistence(timeout: 10), "Coaches see Team Settings")
        open(tab: "Messages")
        XCTAssertTrue(app.navigationBars["Messages"].waitForExistence(timeout: 10))
        open(tab: "More")
        XCTAssertTrue(app.navigationBars["More"].waitForExistence(timeout: 10))
    }

    func testCoachPostsInTeamChat() {
        explore(as: "Coach")
        open(tab: "Messages")
        let chat = app.staticTexts["Team chat"]
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.tap()
        let field = app.textFields["Message"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        let text = "UI test \(Int.random(in: 1000...9999))"
        field.typeText(text)
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 10), "The sent message should appear in the chat")
    }

    func testParentCanRSVP() {
        explore(as: "Parent")
        let going = app.buttons["Going"].firstMatch
        XCTAssertTrue(going.waitForExistence(timeout: 15), "Parents see one-tap RSVP on Home")
        going.tap()
        XCTAssertTrue(app.buttons["Going"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Going"].firstMatch.isSelected, "Going should be selected after tapping it")
    }

    func testScheduleShowsUpcomingAndPast() {
        explore(as: "Coach")
        open(tab: "Schedule")
        let past = app.buttons["Past"]
        XCTAssertTrue(past.waitForExistence(timeout: 10))
        past.tap()
        XCTAssertFalse(app.staticTexts["Couldn't load the schedule"].waitForExistence(timeout: 3))
        app.buttons["Upcoming"].tap()
        XCTAssertTrue(app.navigationBars["Schedule"].exists)
    }

    func testCoachCopiesAGroupMeMessage() {
        explore(as: "Coach")
        open(tab: "Team")
        let add = app.buttons["Add"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Coaches have the + menu on Team")
        add.tap()
        let guide = app.buttons["Move from GroupMe"]
        XCTAssertTrue(guide.waitForExistence(timeout: 5))
        guide.tap()
        let copy = app.buttons["Copy"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 10), "Each step has a ready message with Copy")
        copy.tap()
        XCTAssertTrue(app.buttons["Copied"].firstMatch.waitForExistence(timeout: 3), "Copy confirms with Copied")
    }

    func testPlayerSeesNoCoachTools() {
        explore(as: "Player")
        open(tab: "Team")
        XCTAssertFalse(app.staticTexts["Team Settings"].waitForExistence(timeout: 3), "Players must not see Team Settings")
    }

    func testLeavingDemoReturnsToSignIn() {
        explore(as: "Coach")
        open(tab: "More")
        let signOut = app.buttons["Sign Out"].firstMatch
        for _ in 0..<6 where !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        let confirm = app.buttons.matching(identifier: "Sign Out").element(boundBy: 1)
        if confirm.waitForExistence(timeout: 5) { confirm.tap() } else { app.buttons["Sign Out"].firstMatch.tap() }
        XCTAssertTrue(app.buttons["Explore as Coach"].waitForExistence(timeout: 15), "Signing out should return to sign-in")
    }
}

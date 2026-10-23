import UIKit
import UserNotifications

/// APNs registration and notification taps (DECISIONS D-012).
/// The token is forwarded to `mobile-api` `register-device`; taps become `DeepLink`s.
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    /// Set by `AppModel`; receives the hex device token.
    var onToken: ((String) -> Void)?
    /// Set by `AppModel`; receives a tapped notification's destination.
    var onOpen: ((DeepLink) -> Void)?

    private(set) var latestToken: String?

    override private init() {
        super.init()
    }

    func configure() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Asks once (after the user has joined a team, when the value is obvious), then registers.
    func requestAuthorizationIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        default:
            break
        }
    }

    /// Registers for remote notifications only if the user has already allowed them — never prompts.
    func registerIfAuthorized() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if [.authorized, .provisional, .ephemeral].contains(status) {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        latestToken = token
        onToken?(token)
    }

    // Show banners while the app is open — coordination info is time-sensitive.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let path = response.notification.request.content.userInfo["link_path"] as? String
        guard let path, let link = DeepLink(path: path) else { return }
        await MainActor.run { onOpen?(link) }
    }
}

/// UIKit hooks SwiftUI doesn't expose (APNs token callbacks).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushManager.shared.configure()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected in the simulator without a push entitlement; the in-app inbox still works.
    }
}

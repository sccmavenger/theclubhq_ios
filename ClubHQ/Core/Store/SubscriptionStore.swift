import Foundation
import OSLog
import StoreKit

/// Coach Pro entitlement via StoreKit 2 (DECISIONS D-010).
///
/// The device is authoritative for *showing* Pro immediately after purchase; the server
/// (`sync-subscription` + App Store Server Notifications) is authoritative for *enforcing*
/// Pro limits like team count. Every verified transaction is forwarded to the server.
@Observable
final class SubscriptionStore {
    private(set) var hasActiveSubscription = false
    private(set) var activeProductID: String?
    /// The App Store returned the Coach Pro products for this storefront. False until Apple
    /// sells them (Paid Apps Agreement + approved subscriptions), offline, or in a storefront
    /// without the products.
    private(set) var productsAvailable = false

    /// Coach Pro can be sold right now (D-034).
    var canPurchase: Bool { AppConfig.coachProPurchasesEnabled && productsAvailable }

    /// Forwards a verified transaction's JWS to the backend.
    @ObservationIgnored var onVerifiedTransaction: ((String) async -> Void)?
    @ObservationIgnored private var updatesTask: Task<Void, Never>?

    func start() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
        Task {
            await loadProducts()
            await refreshEntitlements()
        }
    }

    func loadProducts() async {
        do {
            let products = try await Product.products(for: AppConfig.coachProProductIDs)
            productsAvailable = !products.isEmpty
            Self.log.info("Coach Pro products available: \(products.map(\.id), privacy: .public)")
        } catch {
            // Keep the last known value: a transient network error shouldn't hide Pro mid-session.
            Self.log.error("Coach Pro products failed to load: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static let log = Logger(subsystem: "com.teamclubhq.app", category: "store")

    /// Re-sends the current Coach Pro entitlement to the server (e.g. after sign-in or if an
    /// earlier sync failed while offline). The server verifies Apple's signature.
    func syncCurrentEntitlements() async {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  AppConfig.coachProProductIDs.contains(transaction.productID) else { continue }
            await onVerifiedTransaction?(result.jwsRepresentation)
        }
    }

    func refreshEntitlements() async {
        var active: String?
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  AppConfig.coachProProductIDs.contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            if let expiration = transaction.expirationDate, expiration < .now { continue }
            active = transaction.productID
        }
        activeProductID = active
        hasActiveSubscription = active != nil
    }

    /// Call from `onInAppPurchaseCompletion` and `Transaction.updates`.
    func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        if AppConfig.coachProProductIDs.contains(transaction.productID) {
            await onVerifiedTransaction?(result.jwsRepresentation)
        }
        await transaction.finish()
        await refreshEntitlements()
    }

    func handle(purchase: Product.PurchaseResult) async {
        if case .success(let verification) = purchase {
            await handle(verification)
        }
    }
}

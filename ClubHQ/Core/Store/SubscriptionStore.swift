import Foundation
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
        Task { await refreshEntitlements() }
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

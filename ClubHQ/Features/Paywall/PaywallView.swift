import StoreKit
import SwiftUI

/// Coach Pro paywall using StoreKit's `SubscriptionStoreView` (DECISIONS D-010/D-011).
/// Purchases carry `appAccountToken = Supabase user id` so the server can bind the
/// subscription to the right ClubHQ account.
///
/// If the App Store returns no products (no StoreKit configuration in development, or a
/// storefront without the product), we still show the full pitch instead of a bare
/// "unavailable" screen.
struct PaywallView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Availability { case loading, available, unavailable }
    @State private var availability: Availability = .loading

    var body: some View {
        Group {
            switch availability {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .available:
                store
            case .unavailable:
                fallback
            }
        }
        .task { await checkProducts() }
        .safeAreaInset(edge: .bottom) {
            if model.isDemo { demoUnlock }
        }
    }

    // MARK: - Store

    private var store: some View {
        SubscriptionStoreView(productIDs: AppConfig.coachProProductIDs) {
            PaywallMarketing()
        }
        .subscriptionStoreControlStyle(.prominentPicker)
        .storeButton(.visible, for: .restorePurchases)
        .storeButton(.visible, for: .cancellation) // the store's own close button (no second "Not Now")
        .subscriptionStorePolicyDestination(url: AppConfig.termsURL, for: .termsOfService)
        .subscriptionStorePolicyDestination(url: AppConfig.privacyPolicyURL, for: .privacyPolicy)
        .inAppPurchaseOptions { _ in
            guard let userID = model.backend.currentUserID else { return [] }
            return [.appAccountToken(userID)]
        }
        .onInAppPurchaseCompletion { _, result in
            if case .success(let purchase) = result {
                await model.store.handle(purchase: purchase)
                if model.store.hasActiveSubscription { dismiss() }
            }
        }
    }

    private var fallback: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    PaywallMarketing()
                    // Demo builds have no App Store products; the demo unlock button covers that case.
                    if !model.isDemo {
                        Label("Subscriptions aren't available on this device right now. Please try again later.", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.vertical, 24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
    }

    /// Demo builds can explore Pro without an App Store purchase.
    private var demoUnlock: some View {
        Button {
            Task {
                await model.grantDemoPro()
                dismiss()
            }
        } label: {
            Label("Demo: unlock Coach Pro", systemImage: "wand.and.stars")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .padding()
        .background(.bar)
    }

    private func checkProducts() async {
        let products = (try? await Product.products(for: AppConfig.coachProProductIDs)) ?? []
        availability = products.isEmpty ? .unavailable : .available
    }
}

/// The Coach Pro pitch, shared by the store and the fallback.
private struct PaywallMarketing: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)
            Text("Coach Pro")
                .font(.largeTitle.bold())
            Text("Save hours every season. Everything families use stays free — always.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 10) {
                benefit("person.3.sequence.fill", "Run up to 3 teams")
                benefit("chart.bar.fill", "Season attendance & availability reports")
                benefit("square.and.arrow.up", "Roster & attendance export")
                benefit("bell.badge.fill", "One-tap reminders for unpaid dues")
                benefit("paintpalette.fill", "Custom team colors")
            }
            .padding(.top, 4)
            // Prices and trial eligibility come from the App Store controls below (localized,
            // and only shown to people who actually qualify for the free trial).
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    private func benefit(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text).font(.subheadline)
        } icon: {
            // Fixed width so every row's text starts at the same position.
            Image(systemName: symbol).foregroundStyle(Color.accentColor).frame(width: 28)
        }
    }
}

#Preview {
    PaywallView().environment(AppModel.preview(.coach))
}

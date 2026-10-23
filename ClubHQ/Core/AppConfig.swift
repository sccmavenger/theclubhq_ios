import Foundation

/// Static configuration for the backend and store.
///
/// To connect a real Supabase project, set `supabaseURL` and `supabasePublishableKey`
/// (Project Settings → API). The publishable/anon key is designed to ship in clients;
/// Row Level Security protects the data. Leave them empty to run in Demo Mode (D-006).
nonisolated enum AppConfig {
    // Production: "TeamClubHQ" project (GFoceDigital org, Pro plan). DECISIONS D-024.
    static let supabaseURL = "https://qpchhtakmxcfqtbjjpvi.supabase.co"
    static let supabasePublishableKey = "sb_publishable_zH1AESb-lq1S8bIyeaPeyw_TN-YYD5o"

    /// Base URL of the teamclubhq.com site, used to build shareable invite links.
    static let webBaseURL = URL(string: "https://teamclubhq.com")!

    /// Turn on together with the Associated Domains entitlement (webcredentials:teamclubhq.com)
    /// once site/.well-known/apple-app-site-association is live.
    static let strongPasswordAutofillEnabled = false

    /// Turn on once the Apple provider is enabled in Supabase Auth (needs the Apple Team ID, OQ-05).
    static let signInWithAppleEnabled = false

    /// Where Supabase email links (confirm, reset password) land; see site/auth-callback.html.
    static let authRedirectURL = URL(string: "https://teamclubhq.com/auth/callback")!

    /// Custom URL scheme for deep links, e.g. `clubhq://join/<token>`.
    static let urlScheme = "clubhq"

    /// StoreKit product identifiers for Coach Pro (must match App Store Connect and
    /// `supabase/functions/_shared/appstore.ts`).
    static let coachProProductIDs = ["com.teamclubhq.pro.monthly", "com.teamclubhq.pro.yearly"]
    /// App Store Connect subscription group "Coach Pro" (created 2026-10-13).
    static let coachProGroupID = "22474078"
    /// Kill switch for selling Coach Pro. Even when on, upgrade prompts only appear once the
    /// App Store actually returns the products (`SubscriptionStore.productsAvailable`), which
    /// happens after the Paid Apps Agreement is active and the subscriptions are approved
    /// (DECISIONS D-034).
    static let coachProPurchasesEnabled = true
    /// Off until the Stripe Connect account and keys are live (OQ-08). While off, coaches can
    /// still request dues and mark cash/Venmo payments as paid; the Stripe setup button is hidden.
    static let cardPaymentsEnabled = false

    static let privacyPolicyURL = URL(string: "https://teamclubhq.com/privacy")!
    static let termsURL = URL(string: "https://teamclubhq.com/terms")!
    static let supportEmail = "info@teamclubhq.com"

    static var isBackendConfigured: Bool {
        !supabaseURL.isEmpty && !supabasePublishableKey.isEmpty && URL(string: supabaseURL) != nil
    }
}

import AuthenticationServices
import CryptoKit
import SwiftUI

/// Sign in / create account (DECISIONS D-029).
///
/// Email confirmation and password reset use 6-digit emailed codes typed into the app, so
/// registration works without any website or deep link. With no backend configured, the
/// screen leads with Demo Mode (D-006).
struct AuthView: View {
    @Environment(AppModel.self) private var model

    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign In"
        case signUp = "Create Account"
        var id: String { rawValue }
    }

    /// A pending email-code step, presented as its own screen.
    struct CodeStep: Identifiable, Hashable {
        let email: String
        let isRecovery: Bool
        var id: String { "\(email)-\(isRecovery)" }
    }

    /// Brand lockup height; grows with Dynamic Type so it keeps up with the text around it.
    @ScaledMetric(relativeTo: .title) private var lockupHeight: CGFloat = 36
    @State private var mode: Mode = .signIn
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var birthYear: Int?
    @State private var birthYearText = ""
    @State private var isWorking = false
    @State private var errorText: String?
    @State private var infoText: String?
    @State private var appleNonce = ""
    @State private var codeStep: CodeStep?
    @State private var showForgotPassword = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    header
                    if model.hasLiveBackend && model.pendingInviteToken != nil { inviteBanner }
                    if model.hasLiveBackend { credentialsCard }
                    demoCard
                    legal
                }
                .padding(20)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .scrollDismissesKeyboard(.interactively)
            .keyboardDoneButton()
            .navigationDestination(item: $codeStep) { step in
                EmailCodeView(step: step)
            }
            // Most invited parents are new here, so start them on Create Account.
            .onChange(of: model.pendingInviteToken, initial: true) { _, token in
                if token != nil { mode = .signUp }
            }
            .sheet(isPresented: $showForgotPassword) {
                ForgotPasswordView(initialEmail: email) { resetEmail in
                    showForgotPassword = false
                    codeStep = CodeStep(email: resetEmail, isRecovery: true)
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image.Brand.lockup
                .resizable()
                .scaledToFit()
                .frame(height: lockupHeight)
                .accessibilityLabel("ClubHQ")
                .accessibilityAddTraits(.isHeader)
            Text("Schedules, RSVPs, chat, and team payments — in one ad‑free app for coaches, parents, and players.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 24)
    }

    /// Shown when the app was opened from a team invite link: the code is saved, so after
    /// signing up the parent lands straight on the join form.
    private var inviteBanner: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "envelope.open.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("You're invited to join a team").font(.headline)
                Text("Create an account or sign in, and we'll take you right to it.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("You're invited to join a team. Create an account or sign in, and we'll take you right to it.")
    }

    private var credentialsCard: some View {
        VStack(spacing: 14) {
            Picker("Mode", selection: $mode.animation()) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            VStack(spacing: 10) {
                if mode == .signUp {
                    TextField("Full name", text: $fullName)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                PasswordField(placeholder: mode == .signUp ? "Password (8+ characters)" : "Password",
                              text: $password, isNewPassword: mode == .signUp)
                if mode == .signUp {
                    birthYearPicker
                }
            }
            // Custom field style (TestFlight feedback, build 2): the system rounded-border style
            // painted its own dark background in dark mode, hiding the password dots.
            .textFieldStyle(ClubFieldStyle())

            if let errorText {
                Text(errorText).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
            }
            if let infoText {
                Text(infoText).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await submit() }
            } label: {
                ZStack {
                    Text(mode.rawValue).opacity(isWorking ? 0 : 1)
                    // Overlaid at the text's size so the button doesn't grow while loading.
                    if isWorking { ProgressView().controlSize(.small) }
                }
            }
            .buttonStyle(BrandCTAButtonStyle())
            .disabled(!canSubmit || isWorking)

            if mode == .signIn {
                Button("Forgot password?") { showForgotPassword = true }
                    .font(.footnote)
            } else {
                Text("Coaches, parents, and players all start here. You'll pick your role next.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if AppConfig.signInWithAppleEnabled {
                HStack {
                    VStack { Divider() }
                    Text("or").font(.footnote).foregroundStyle(.secondary)
                    VStack { Divider() }
                }

                SignInWithAppleButton(mode == .signUp ? .signUp : .signIn) { request in
                    appleNonce = Self.randomNonce()
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = Self.sha256(appleNonce)
                } onCompletion: { result in
                    Task { await handleApple(result) }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 48)
                .clipShape(.capsule)
            }
        }
        .padding(18)
        .background(.background, in: .rect(cornerRadius: 20))
    }

    /// Neutral age screen (FTC COPPA guidance): asks for birth year without hinting at the
    /// cutoff. Under-13s are routed to a parent instead of creating an account (D-008).
    private var birthYearPicker: some View {
        // Plain 4-digit entry: fast, and neutral (no pre-selected year to nudge toward).
        TextField("Birth year (YYYY)", text: Binding(
            get: { birthYearText },
            set: { newValue in
                birthYearText = String(newValue.filter(\.isNumber).prefix(4))
                let current = Calendar.current.component(.year, from: .now)
                if let year = Int(birthYearText), birthYearText.count == 4, (current - 120...current).contains(year) {
                    birthYear = year
                } else {
                    birthYear = nil
                }
            }
        ))
        .keyboardType(.numberPad)
        .textContentType(.birthdateYear)
    }

    private var demoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(model.hasLiveBackend ? "Just looking?" : "Explore ClubHQ", systemImage: "play.circle.fill")
                .font(.headline)
            Text(model.hasLiveBackend
                 ? "Try a fully loaded demo team. Nothing you do here is saved."
                 : "This build isn't connected to a server yet. Pick a role to explore a demo team — nothing is saved.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                ForEach(Persona.allCases) { persona in
                    Button {
                        Task { await model.startDemo(as: persona) }
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: persona.symbolName).font(.title2).frame(height: 28)
                            Text(persona.title).font(.subheadline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Explore as \(persona.title)")
                }
            }
        }
        .padding(18)
        .background(.background, in: .rect(cornerRadius: 20))
    }

    private var legal: some View {
        VStack(spacing: 8) {
            if mode == .signUp && model.hasLiveBackend {
                Text("By creating an account you agree to the Terms and Privacy Policy.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 16) {
                Link("Privacy", destination: AppConfig.privacyPolicyURL)
                Link("Terms", destination: AppConfig.termsURL)
            }
            .font(.footnote)
        }
        .foregroundStyle(.secondary)
    }

    // MARK: - Actions

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    private var canSubmit: Bool {
        let base = trimmedEmail.contains("@") && trimmedEmail.contains(".")
        switch mode {
        case .signIn: return base && !password.isEmpty
        case .signUp: return base && password.count >= 8 && fullName.nilIfEmpty != nil && birthYear != nil
        }
    }

    private func submit() async {
        errorText = nil
        infoText = nil
        if mode == .signUp {
            // Neutral age screen: a blocked attempt is remembered for a day so the year can't
            // simply be changed and resubmitted (FTC COPPA guidance on age gates).
            let blockKey = "ageGateBlockedUntil"
            let blockedUntil = UserDefaults.standard.object(forKey: blockKey) as? Date
            let mightBeUnder13 = birthYear.map { Calendar.current.component(.year, from: .now) - $0 < AgePolicy.minimumPlayerAccountAge } ?? false
            if mightBeUnder13 || (blockedUntil ?? .distantPast) > .now {
                if mightBeUnder13 { UserDefaults.standard.set(Date.now.addingTimeInterval(86_400), forKey: blockKey) }
                errorText = "ClubHQ accounts are for ages 13 and up. Ask a parent or guardian to add you to your team from their account."
                return
            }
        }
        isWorking = true
        defer { isWorking = false }
        do {
            switch mode {
            case .signIn:
                try await model.backend.signIn(email: trimmedEmail, password: password)
                await model.didAuthenticate()
            case .signUp:
                let outcome = try await model.backend.signUp(fullName: fullName.trimmingCharacters(in: .whitespaces),
                                                             email: trimmedEmail, password: password)
                if outcome == .confirmEmail {
                    codeStep = CodeStep(email: trimmedEmail, isRecovery: false)
                } else {
                    await model.didAuthenticate()
                }
            }
        } catch let error as BackendError where error.isEmailNotConfirmed {
            // Signed up earlier but never confirmed: send a fresh code and go straight to entry.
            try? await model.backend.resendSignupCode(email: trimmedEmail)
            codeStep = CodeStep(email: trimmedEmail, isRecovery: false)
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8) else {
                errorText = "Apple didn't return a sign-in token. Please try again."
                return
            }
            let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
            isWorking = true
            defer { isWorking = false }
            do {
                try await model.backend.signInWithApple(idToken: idToken, nonce: appleNonce, fullName: name)
                await model.didAuthenticate()
            } catch {
                errorText = error.localizedDescription
            }
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorText = error.localizedDescription
            }
        }
    }

    static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in charset.randomElement(using: &generator)! })
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Fields

/// Sign-in field look: explicit adaptive colors so text, dots, and the cursor are
/// readable in light and dark mode, and iOS's Strong Password highlight can show through.
struct ClubFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .foregroundStyle(Color.primary)
            .tint(Color.accentColor)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12).strokeBorder(Color(.separator), lineWidth: 0.5)
            }
    }
}

/// Password entry with a show/hide toggle (common pattern; also makes typos easy to spot).
struct PasswordField: View {
    let placeholder: String
    @Binding var text: String
    var isNewPassword = false
    @State private var isRevealed = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if isRevealed {
                    TextField(placeholder, text: $text)
                } else {
                    SecureField(placeholder, text: $text)
                }
            }
            // `.newPassword` triggers iOS Strong Password autofill, which needs Associated Domains
            // (webcredentials:teamclubhq.com). Without them iOS replaced the field's contents on
            // every keystroke (TestFlight build 2), so sign-up kept only the last character.
            // Re-enable once the site's AASA file is live and the entitlement is added.
            .textContentType(isNewPassword && AppConfig.strongPasswordAutofillEnabled ? .newPassword : .password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .foregroundStyle(Color.primary)
            .textFieldStyle(.plain) // the parent's ClubFieldStyle would draw a second box inside this one
            .focused($focused)

            Button {
                isRevealed.toggle()
                focused = true // keep the keyboard up when toggling
            } label: {
                Image(systemName: isRevealed ? "eye.slash" : "eye")
                    .foregroundStyle(Color.secondary)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isRevealed ? "Hide password" : "Show password")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(minHeight: 48)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12).strokeBorder(Color(.separator), lineWidth: 0.5)
        }
    }
}

// MARK: - Email code entry

/// "Enter the 6-digit code we emailed you" — used for sign-up confirmation and password reset.
struct EmailCodeView: View {
    let step: AuthView.CodeStep
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var isVerifying = false
    @State private var errorText: String?
    @State private var infoText: String?
    @State private var resendAvailableAt = Date.now.addingTimeInterval(60)
    @FocusState private var focused: Bool

    private static let codeLength = 6

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: step.isRecovery ? "key.fill" : "envelope.badge.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Color.accentColor)
                    Text(step.isRecovery ? "Reset your password" : "Check your email")
                        .font(.title2.bold())
                    Text("We sent a \(Self.codeLength)-digit code to **\(step.email)**. Enter it below.")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
                .listRowBackground(Color.clear)
            }

            Section {
                TextField("123456", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode) // lets iOS offer the code from Mail
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .focused($focused)
                    .onChange(of: code) { _, newValue in
                        let digits = String(newValue.filter(\.isNumber).prefix(Self.codeLength))
                        if digits != newValue { code = digits }
                        if digits.count == Self.codeLength { Task { await verify() } }
                    }
                    .accessibilityLabel("\(Self.codeLength)-digit code")
            } footer: {
                if let errorText {
                    Text(errorText).foregroundStyle(.red)
                } else if let infoText {
                    Text(infoText)
                } else {
                    Text("Don't see it? Check spam or promotions for mail from info@teamclubhq.com.")
                }
            }

            Section {
                Button {
                    Task { await verify() }
                } label: {
                    ZStack {
                        Text("Continue").opacity(isVerifying ? 0 : 1)
                        if isVerifying { ProgressView().controlSize(.small) }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(code.count != Self.codeLength || isVerifying)
                .listRowBackground(Color.clear)

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let remaining = Int(resendAvailableAt.timeIntervalSince(context.date).rounded(.up))
                    Button(remaining > 0 ? "Resend code in \(remaining)s" : "Resend code") {
                        Task { await resend() }
                    }
                    .disabled(remaining > 0)
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(step.isRecovery ? "Reset Password" : "Confirm Email")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }

    private func verify() async {
        guard code.count == Self.codeLength, !isVerifying else { return }
        isVerifying = true
        errorText = nil
        defer { isVerifying = false }
        do {
            try await model.backend.verifyEmailCode(email: step.email, code: code, isRecovery: step.isRecovery)
            await model.didAuthenticate()
            if step.isRecovery { model.needsNewPassword = true }
        } catch {
            code = ""
            errorText = error.localizedDescription
        }
    }

    private func resend() async {
        errorText = nil
        do {
            if step.isRecovery {
                try await model.backend.sendPasswordReset(email: step.email)
            } else {
                try await model.backend.resendSignupCode(email: step.email)
            }
            infoText = "New code sent to \(step.email)."
            resendAvailableAt = .now.addingTimeInterval(60)
        } catch {
            errorText = error.localizedDescription
        }
    }
}

/// Collects the email for a password reset, then hands off to the code screen.
private struct ForgotPasswordView: View {
    let onCodeSent: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var email: String
    @State private var errorText: String?

    init(initialEmail: String, onCodeSent: @escaping (String) -> Void) {
        self.onCodeSent = onCodeSent
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.email = initialEmail
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text(errorText ?? "We'll email you a code to reset your password.")
                        .foregroundStyle(errorText == nil ? Color.secondary : Color.red)
                }
            }
            .navigationTitle("Forgot Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Send Code") {
                        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        do {
                            try await model.backend.sendPasswordReset(email: address)
                            onCodeSent(address)
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(!email.contains("@"))
                }
            }
        }
        .presentationDetents([.medium])
    }
}

extension Persona {
    var symbolName: String {
        switch self {
        case .coach: "list.clipboard.fill"
        case .parent: "figure.2.and.child.holdinghands"
        case .player: "figure.basketball"
        }
    }
}

#Preview {
    AuthView()
        .environment(AppModel(backend: DemoBackend()))
}

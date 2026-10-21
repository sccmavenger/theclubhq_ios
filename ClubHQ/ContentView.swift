import SwiftUI

/// Root router: launch → sign in → onboarding → main tabs.
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.phase {
            case .launching:
                LaunchView()
            case .signedOut:
                AuthView()
            case .onboarding:
                OnboardingView()
            case .ready:
                MainTabView()
            }
        }
        .animation(.default, value: model.phase)
        .sheet(isPresented: $model.needsNewPassword) {
            NewPasswordView()
        }
        .alert("Something went wrong", item: $model.errorMessage) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
    }
}

/// Shown after a password-reset email link signs the user in.
private struct NewPasswordView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirm = ""
    @State private var errorText: String?

    private var isValid: Bool { password.count >= 8 && password == confirm }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("New password", text: $password).textContentType(.newPassword)
                    SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
                } footer: {
                    Text(password.isEmpty || password.count >= 8 ? "Use at least 8 characters." : "Too short — use at least 8 characters.")
                }
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .navigationTitle("Set a New Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Later") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Save") {
                        do {
                            try await model.backend.updatePassword(password)
                            dismiss()
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(!isValid)
                }
            }
        }
        .interactiveDismissDisabled()
    }
}

private struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandMark(size: 72)
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

#Preview("Coach") {
    ContentView()
        .environment(AppModel.preview(.coach))
}

#Preview("Signed out") {
    ContentView()
        .environment(AppModel(backend: DemoBackend()))
}

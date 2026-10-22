import SwiftUI

/// Head coach enters the team's Venmo username and $Cashtag so families can pay dues
/// directly (DECISIONS D-033). Free on every plan.
struct PaymentMethodsView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var venmo: String
    @State private var cashtag: String
    @State private var errorText: String?

    init(team: TeamMembership) {
        self.team = team
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.venmo = team.venmoUsername ?? ""
        self.cashtag = team.cashappCashtag ?? ""
    }

    private var venmoValue: String? { venmo.trimmingCharacters(in: .whitespaces).isEmpty ? nil : PaymentHandles.venmoUsername(from: venmo) }
    private var cashtagValue: String? { cashtag.trimmingCharacters(in: .whitespaces).isEmpty ? nil : PaymentHandles.cashtag(from: cashtag) }
    private var venmoInvalid: Bool { !venmo.trimmingCharacters(in: .whitespaces).isEmpty && venmoValue == nil }
    private var cashtagInvalid: Bool { !cashtag.trimmingCharacters(in: .whitespaces).isEmpty && cashtagValue == nil }
    private var hasChanges: Bool { venmoValue != team.venmoUsername || cashtagValue != team.cashappCashtag }

    var body: some View {
        Form {
            Section {
                handleField(prefix: "@", placeholder: "Venmo username", text: $venmo)
                if venmoInvalid {
                    Text("Venmo usernames are 5–30 letters, numbers, dashes, or underscores.").font(.footnote).foregroundStyle(.red)
                } else if let venmoValue, let url = URL(string: "https://venmo.com/u/\(venmoValue)") {
                    Link(destination: url) { Label("Check it's you on Venmo", systemImage: "arrow.up.right.square") }
                }
            } header: {
                Text("Venmo")
            } footer: {
                Text("In Venmo, tap Me — your username is under your name. You can also paste your Venmo link.")
            }

            Section {
                handleField(prefix: "$", placeholder: "Cashtag", text: $cashtag)
                if cashtagInvalid {
                    Text("$Cashtags are up to 20 letters and numbers.").font(.footnote).foregroundStyle(.red)
                } else if let cashtagValue, let url = URL(string: "https://cash.app/$\(cashtagValue)") {
                    Link(destination: url) { Label("Check it's you on Cash App", systemImage: "arrow.up.right.square") }
                }
            } header: {
                Text("Cash App")
            } footer: {
                Text("In Cash App, tap your profile picture — your $Cashtag is under your name. You can also paste your cash.app link.")
            }

            Section {
                Label("Families see “Pay with Venmo” and “Pay with Cash App” buttons on their dues, with the amount filled in.",
                      systemImage: "person.2.fill")
                Label("Money goes straight to you. When it arrives, mark the player paid in Dues & Payments.",
                      systemImage: "checkmark.circle")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            if let errorText { Text(errorText).foregroundStyle(.red) }
        }
        .navigationTitle("Venmo & Cash App")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                AsyncButton("Save", action: save)
                    .disabled(venmoInvalid || cashtagInvalid || !hasChanges)
            }
        }
    }

    private func handleField(prefix: String, placeholder: String, text: Binding<String>) -> some View {
        HStack(spacing: 2) {
            Text(prefix).foregroundStyle(.secondary)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.done)
        }
    }

    private func save() async {
        do {
            try await model.backend.updatePaymentHandles(teamID: team.id, venmoUsername: venmoValue, cashappCashtag: cashtagValue)
            await model.reloadContext()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

extension TeamMembership {
    var hasPaymentHandles: Bool { venmoUsername != nil || cashappCashtag != nil }
}

#Preview {
    PaymentMethodsPreview(model: .preview(.coach))
}

/// Waits for the demo context to load before showing the editor.
private struct PaymentMethodsPreview: View {
    let model: AppModel
    var body: some View {
        NavigationStack {
            if let team = model.teams.first { PaymentMethodsView(team: team) } else { ProgressView() }
        }
        .environment(model)
    }
}

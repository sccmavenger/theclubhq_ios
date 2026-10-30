import ContactsUI
import SwiftUI

extension View {
    /// Presents the system contact picker to choose one email address (TestFlight feedback,
    /// build 22). The picker runs out of process, so ClubHQ never asks for Contacts access and only
    /// receives the address that was tapped.
    func contactEmailPicker(isPresented: Binding<Bool>, onPick: @escaping (String) -> Void) -> some View {
        background(ContactEmailPickerPresenter(isPresented: isPresented, onPick: onPick))
    }
}

/// A zero-size host that presents `CNContactPickerViewController` modally. The picker can't be
/// embedded in a SwiftUI sheet; it has to be presented by a UIKit view controller.
private struct ContactEmailPickerPresenter: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let onPick: (String) -> Void

    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

    func updateUIViewController(_ host: UIViewController, context: Context) {
        context.coordinator.parent = self
        guard isPresented, host.presentedViewController == nil else { return }
        let picker = CNContactPickerViewController()
        picker.delegate = context.coordinator
        picker.displayedPropertyKeys = [CNContactEmailAddressesKey]
        // Only people with an email can be picked; one email picks it directly, several show a list.
        picker.predicateForEnablingContact = NSPredicate(format: "emailAddresses.@count > 0")
        picker.predicateForSelectionOfContact = NSPredicate(format: "emailAddresses.@count == 1")
        host.present(picker, animated: true)
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, CNContactPickerDelegate {
        var parent: ContactEmailPickerPresenter
        init(parent: ContactEmailPickerPresenter) { self.parent = parent }

        func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
            finish(contact.emailAddresses.first.map { String($0.value) })
        }

        func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
            finish(contactProperty.value as? String)
        }

        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { finish(nil) }

        private func finish(_ email: String?) {
            parent.isPresented = false
            if let email { parent.onPick(email) }
        }
    }
}

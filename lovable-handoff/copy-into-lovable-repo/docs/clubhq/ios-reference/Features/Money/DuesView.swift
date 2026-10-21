import SwiftUI

/// Team dues. Coaches create payment requests and track who paid; guardians pay by card.
///
/// Dues are a real-world service, so payment happens on Stripe Checkout in Safari —
/// never In-App Purchase (App Store guideline 3.1.3(e), DECISIONS D-010). The fee is
/// shown before paying (PRODUCT_STRATEGY §1, "transparent fees").
struct DuesView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var overview: DuesOverview?
    @State private var errorText: String?
    @State private var showNewRequest = false
    @State private var selectedItems: Set<UUID> = []
    @State private var showPayConfirm = false
    @State private var awaitingReturn = false

    private var isCoach: Bool { team.canManageDues }

    var body: some View {
        List {
            if let errorText {
                Section { Text(errorText).foregroundStyle(.red) }
            }
            if let overview {
                if isCoach {
                    if AppConfig.cardPaymentsEnabled {
                        paymentsSetupSection(overview)
                    }
                    coachRequests(overview)
                } else {
                    familyItems(overview)
                }
            }
        }
        .navigationTitle(isCoach ? "Dues & Payments" : "Payments")
        .toolbar {
            if isCoach {
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewRequest = true } label: { Label("New Request", systemImage: "plus") }
                }
            }
        }
        .overlay { if overview == nil && errorText == nil { ProgressView() } }
        .task(id: model.refreshToken) { await load() }
        .refreshable { await load() }
        .onChange(of: scenePhase) { _, phase in
            // Returning from Stripe (onboarding or checkout) — refresh status.
            if phase == .active && awaitingReturn {
                awaitingReturn = false
                Task {
                    if isCoach { try? await model.backend.refreshPayments(teamID: team.id) }
                    await load()
                }
            }
        }
        .sheet(isPresented: $showNewRequest, onDismiss: { Task { await load() } }) {
            NewDuesRequestView(team: team)
        }
        .sheet(isPresented: $showPayConfirm) {
            if let overview {
                PayConfirmView(items: overview.requests.flatMap(\.items).filter { selectedItems.contains($0.id) },
                               titles: Dictionary(uniqueKeysWithValues: overview.requests.flatMap { r in r.items.map { ($0.id, r.title) } })) {
                    await checkout()
                }
            }
        }
    }

    // MARK: Coach

    @ViewBuilder
    private func paymentsSetupSection(_ overview: DuesOverview) -> some View {
        Section {
            if overview.paymentsEnabled {
                Label("Card payments are on", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(overview.paymentsConnected ? "Finish setting up payouts" : "Get paid by card")
                        .font(.headline)
                    Text("Connect a bank account through Stripe (about 5 minutes). Money goes straight to your team — ClubHQ never holds it.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    AsyncButton(action: connectPayments) {
                        Label(overview.paymentsConnected ? "Continue Setup" : "Set Up Payments", systemImage: "building.columns.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 4)
            }
        } footer: {
            Text("Families pay \(DuesFee.disclosure) on top of the amount due; your team receives the full amount. You can also mark cash or Venmo payments as paid.")
        }
    }

    @ViewBuilder
    private func coachRequests(_ overview: DuesOverview) -> some View {
        if overview.requests.isEmpty {
            ContentUnavailableView {
                Label("No payment requests", systemImage: "dollarsign.circle")
            } description: {
                Text("Create a request for season dues, tournament fees, or uniforms. Every family gets notified.")
            } actions: {
                Button("New Request") { showNewRequest = true }.buttonStyle(.borderedProminent)
            }
            .listRowBackground(Color.clear)
        }
        ForEach(overview.requests) { request in
            Section {
                NavigationLink {
                    DuesRequestDetailView(request: request, team: team)
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(request.title).font(.headline)
                            Spacer()
                            Text(Money.format(cents: request.amountCents)).monospacedDigit()
                        }
                        ProgressView(value: request.progress).tint(.green)
                        HStack {
                            Text("\(Money.format(cents: request.collectedCents)) of \(Money.format(cents: request.expectedCents)) collected")
                            Spacer()
                            if let due = request.dueDateValue { Text("Due \(due.formatted(date: .abbreviated, time: .omitted))") }
                        }
                        .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    // MARK: Family

    @ViewBuilder
    private func familyItems(_ overview: DuesOverview) -> some View {
        let unpaid = overview.requests.flatMap { request in request.items.filter { $0.status == .unpaid }.map { (request, $0) } }
        let settled = overview.requests.flatMap { request in request.items.filter { $0.status != .unpaid }.map { (request, $0) } }

        if unpaid.isEmpty {
            ContentUnavailableView("Nothing due", systemImage: "checkmark.circle", description: Text("You're all paid up for \(team.name)."))
                .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(unpaid, id: \.1.id) { request, item in
                    Button {
                        if selectedItems.contains(item.id) { selectedItems.remove(item.id) } else { selectedItems.insert(item.id) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: selectedItems.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(selectedItems.contains(item.id) ? Color.accentColor : .secondary)
                            VStack(alignment: .leading) {
                                Text(request.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                Text(item.playerName).font(.caption).foregroundStyle(.secondary)
                                if let due = request.dueDateValue {
                                    Text(due < .now ? "Past due" : "Due \(due.formatted(date: .abbreviated, time: .omitted))")
                                        .font(.caption).foregroundStyle(due < .now ? .red : .secondary)
                                }
                            }
                            Spacer()
                            Text(Money.format(cents: item.amountCents)).monospacedDigit().foregroundStyle(.primary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Due")
            } footer: {
                if !overview.paymentsEnabled {
                    Text("Card payments aren't set up for this team yet — pay your coach directly for now.")
                }
            }
            if overview.paymentsEnabled {
                Section {
                    Button {
                        showPayConfirm = true
                    } label: {
                        Text(selectedItems.isEmpty ? "Select items to pay" : "Review & Pay")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selectedItems.isEmpty)
                    .listRowBackground(Color.clear)
                }
            }
        }
        if !settled.isEmpty {
            Section("History") {
                ForEach(settled, id: \.1.id) { request, item in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(request.title).font(.subheadline)
                            Text(item.playerName).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        TagLabel(text: item.status.displayName, tint: item.status.tint)
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func load() async {
        do {
            let fresh = try await model.backend.dues(teamID: team.id)
            overview = fresh
            // Pre-select everything unpaid for a one-tap "pay all".
            if selectedItems.isEmpty && !isCoach {
                selectedItems = Set(fresh.requests.flatMap(\.unpaidItems).map(\.id))
            }
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func connectPayments() async {
        do {
            let url = try await model.backend.connectPayments(teamID: team.id)
            awaitingReturn = true
            if model.isDemo {
                await load()
            } else {
                openURL(url)
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func checkout() async {
        do {
            let session = try await model.backend.checkout(itemIDs: Array(selectedItems))
            showPayConfirm = false
            selectedItems = []
            if model.isDemo {
                await load()
            } else {
                awaitingReturn = true
                openURL(session.url)
            }
        } catch {
            errorText = error.localizedDescription
            showPayConfirm = false
        }
    }
}

/// Fee breakdown before leaving the app for checkout.
private struct PayConfirmView: View {
    let items: [DuesItem]
    let titles: [UUID: String]
    let onPay: () async -> Void
    @Environment(\.dismiss) private var dismiss

    private var subtotal: Int { items.reduce(0) { $0 + $1.amountCents } }
    private var fee: Int { DuesFee.fee(forSubtotal: subtotal) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(items) { item in
                        LabeledContent {
                            Text(Money.format(cents: item.amountCents)).monospacedDigit()
                        } label: {
                            VStack(alignment: .leading) {
                                Text(titles[item.id] ?? "Team payment")
                                Text(item.playerName).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    LabeledContent("Subtotal", value: Money.format(cents: subtotal))
                    LabeledContent("Service fee (\(DuesFee.disclosure))", value: Money.format(cents: fee))
                    LabeledContent {
                        Text(Money.format(cents: subtotal + fee)).bold()
                    } label: {
                        Text("Total").bold()
                    }
                } footer: {
                    Text("You'll finish on a secure Stripe checkout page. Your team receives \(Money.format(cents: subtotal)). Apple Pay and cards accepted.")
                }
                Section {
                    AsyncButton(action: onPay) {
                        Label("Pay \(Money.format(cents: subtotal + fee))", systemImage: "lock.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("Review Payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.large])
    }
}

/// Per-family status for one request; coaches record offline payments or waive.
struct DuesRequestDetailView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @State private var request: DuesRequest
    @State private var message: String?

    init(request: DuesRequest, team: TeamMembership) {
        self.team = team
        // `@State` is a macro in SDK 27: no declaration default, assign once here.
        self.request = request
    }

    var body: some View {
        List {
            Section {
                if let description = request.description { Text(description).foregroundStyle(.secondary) }
                LabeledContent("Per player", value: Money.format(cents: request.amountCents))
                LabeledContent("Collected", value: "\(Money.format(cents: request.collectedCents)) of \(Money.format(cents: request.expectedCents))")
            }
            Section {
                if team.isPro {
                    AsyncButton(action: remind) {
                        Label("Remind \(request.unpaidItems.count) unpaid", systemImage: "bell.badge")
                    }
                    .disabled(request.unpaidItems.isEmpty)
                } else {
                    ProUpsellRow(title: "One-tap payment reminders", message: "Nudge every unpaid family at once with Coach Pro.")
                }
                if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
            Section("Players") {
                ForEach(request.items) { item in
                    HStack {
                        Text(item.playerName)
                        Spacer()
                        Menu {
                            Button("Mark Paid (cash/Venmo)", systemImage: "checkmark.circle") { Task { await set(item, .paid) } }
                            Button("Waive", systemImage: "hand.raised") { Task { await set(item, .waived) } }
                            Button("Mark Unpaid", systemImage: "arrow.uturn.backward") { Task { await set(item, .unpaid) } }
                        } label: {
                            TagLabel(text: item.status.displayName, tint: item.status.tint)
                        }
                        .disabled(item.status == .processing)
                    }
                }
            }
        }
        .navigationTitle(request.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func set(_ item: DuesItem, _ status: DuesStatus) async {
        do {
            try await model.backend.setDuesStatus(itemID: item.id, status: status)
            if let index = request.items.firstIndex(where: { $0.id == item.id }) {
                request.items[index].status = status
            }
            model.noteDataChanged()
        } catch {
            message = error.localizedDescription
        }
    }

    private func remind() async {
        do {
            let count = try await model.backend.remindUnpaid(requestID: request.id)
            message = "Reminder sent to \(count) famil\(count == 1 ? "y" : "ies")."
        } catch {
            message = error.localizedDescription
        }
    }
}

struct NewDuesRequestView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var amountText = ""
    @State private var details = ""
    @State private var hasDueDate = true
    @State private var dueDate = Calendar.current.date(byAdding: .day, value: 14, to: .now) ?? .now
    @State private var errorText: String?

    private var amountCents: Int? { Money.cents(from: amountText) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What's it for? (e.g. Fall season dues)", text: $title)
                    TextField("Amount per player", text: $amountText).keyboardType(.decimalPad)
                    TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(2...4)
                }
                Section {
                    Toggle("Due date", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("Due", selection: $dueDate, in: Date.now..., displayedComponents: .date)
                    }
                }
                if let cents = amountCents, cents > 0 {
                    Section {
                        LabeledContent("Family pays", value: Money.format(cents: cents + DuesFee.fee(forSubtotal: cents)))
                        LabeledContent("Your team receives", value: Money.format(cents: cents))
                    } footer: {
                        Text("Applies to every active player on the roster. You can waive individual players afterwards.")
                    }
                }
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .navigationTitle("New Payment Request")
            .keyboardDoneButton()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    AsyncButton("Send") {
                        guard let cents = amountCents else { return }
                        do {
                            try await model.backend.createDues(teamID: team.id, title: title, description: details.nilIfEmpty,
                                                               amountCents: cents, dueDate: hasDueDate ? dueDate : nil)
                            model.noteDataChanged()
                            dismiss()
                        } catch {
                            errorText = error.localizedDescription
                        }
                    }
                    .disabled(title.nilIfEmpty == nil || (amountCents ?? 0) < 100)
                }
            }
        }
    }
}

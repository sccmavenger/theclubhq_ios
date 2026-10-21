import SwiftUI

/// Season attendance & record — a Coach Pro feature (PRODUCT_STRATEGY §4).
/// Free coaches see a preview of the team record plus an upsell; the data itself is
/// still available per-event, so nothing coordination-critical is paywalled.
struct AttendanceReportView: View {
    let team: TeamMembership
    @Environment(AppModel.self) private var model
    @State private var rows: [AttendanceSummary] = []
    @State private var record: (wins: Int, losses: Int, ties: Int) = (0, 0, 0)
    @State private var eventsCounted = 0
    @State private var isLoading = true

    var body: some View {
        List {
            Section("Season record") {
                HStack {
                    recordStat(record.wins, "Wins", .green)
                    recordStat(record.losses, "Losses", .red)
                    recordStat(record.ties, "Ties", .secondary)
                }
            }
            if team.isPro {
                Section {
                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(row.player.fullName)
                                Spacer()
                                Text(row.rate, format: .percent.precision(.fractionLength(0)))
                                    .monospacedDigit()
                                    .foregroundStyle(row.rate >= 0.8 ? .green : (row.rate >= 0.6 ? .orange : .red))
                            }
                            ProgressView(value: row.rate)
                                .tint(row.rate >= 0.8 ? .green : (row.rate >= 0.6 ? .orange : .red))
                            Text("\(row.present) present · \(row.late) late · \(row.absent) absent · \(row.excused) excused")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Attendance · \(eventsCounted) events tracked")
                } footer: {
                    Text("Late counts as attended. Excused absences don't count against the rate.")
                }
            } else {
                Section {
                    ProUpsellRow(title: "Season attendance report",
                                 message: "See each player's attendance rate and export the roster with Coach Pro.")
                }
            }
        }
        .navigationTitle("Season Report")
        .toolbar {
            if team.isPro, !rows.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: csv, preview: SharePreview("\(team.name) attendance.csv")) {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                }
            }
        }
        .overlay { if isLoading { ProgressView() } }
        .task { await load() }
    }

    private func recordStat(_ value: Int, _ label: String, _ tint: Color) -> some View {
        VStack {
            Text("\(value)").font(.largeTitle.bold().monospacedDigit()).foregroundStyle(tint)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    /// Roster + attendance as CSV for the share sheet (Pro export).
    private var csv: String {
        var lines = ["Player,Jersey,Present,Late,Absent,Excused,Rate"]
        for row in rows {
            let name = row.player.fullName.replacingOccurrences(of: "\"", with: "\"\"")
            lines.append("\"\(name)\",\(row.player.jerseyNumber ?? ""),\(row.present),\(row.late),\(row.absent),\(row.excused),\(Int((row.rate * 100).rounded()))%")
        }
        return lines.joined(separator: "\n")
    }

    private func load() async {
        defer { isLoading = false }
        let backend = model.backend
        let from = Calendar.current.date(byAdding: .month, value: -6, to: .now) ?? .now
        let events = (try? await backend.events(teamIDs: [team.id], from: from, to: .now)) ?? []
        let games = events.filter { $0.eventType == .game && !$0.isCancelled }
        record = games.compactMap(\.scoreLine).reduce(into: (0, 0, 0)) { result, line in
            switch line.first {
            case "W": result.0 += 1
            case "L": result.1 += 1
            default: result.2 += 1
            }
        }
        guard team.isPro else { return }
        let roster = (try? await backend.roster(teamID: team.id)) ?? []
        let records = (try? await backend.teamAttendance(teamID: team.id)) ?? []
        eventsCounted = Set(records.map(\.eventId)).count
        rows = AttendanceSummary.build(roster: roster, records: records)
    }
}

/// Per-player attendance tally. Pure, so it's unit-tested.
struct AttendanceSummary: Identifiable, Equatable {
    let player: Player
    var present = 0
    var late = 0
    var absent = 0
    var excused = 0
    var id: UUID { player.id }

    /// (present + late) / (present + late + absent); excused excluded. 1.0 when no data.
    var rate: Double {
        let counted = present + late + absent
        return counted == 0 ? 1 : Double(present + late) / Double(counted)
    }

    static func build(roster: [Player], records: [AttendanceRecord]) -> [AttendanceSummary] {
        let byPlayer = Dictionary(grouping: records, by: \.playerId)
        return roster.map { player in
            var summary = AttendanceSummary(player: player)
            for record in byPlayer[player.id] ?? [] {
                switch record.status {
                case .present: summary.present += 1
                case .late: summary.late += 1
                case .absent: summary.absent += 1
                case .excused: summary.excused += 1
                }
            }
            return summary
        }
        .sorted { $0.rate == $1.rate ? $0.player.lastName < $1.player.lastName : $0.rate > $1.rate }
    }
}

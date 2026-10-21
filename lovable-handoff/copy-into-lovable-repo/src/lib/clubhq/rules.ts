// ClubHQ business rules, labels, and formatting — ported 1:1 from the iOS app so web
// and iPhone behave identically. Pure functions only (no network, no React).
//
// Source: ClubHQ/Core/Models/*.swift, Features/Shared/UIComponents.swift,
// Features/Team/AttendanceReportView.swift, Features/Onboarding/OnboardingView.swift.

import type {
  AttendanceRecord,
  AttendanceStatus,
  DateOnly,
  DuesRequest,
  DuesStatus,
  EventDetail,
  EventDraft,
  EventType,
  MessageAudience,
  MessageThread,
  Persona,
  Player,
  PlayerSummary,
  Relationship,
  RSVP,
  RSVPStatus,
  Sport,
  TeamEvent,
  TeamMember,
  TeamMembership,
  TeamRole,
} from "./types";

// ---------------------------------------------------------------------------
// Feature flags — keep identical to the iOS app's AppConfig.
// ---------------------------------------------------------------------------

/** Off until Stripe Connect is live. While off: coaches still create dues and mark cash/Venmo
 *  payments; the "Set Up Payments" button and family card checkout are hidden. */
export const CARD_PAYMENTS_ENABLED = false;
/** The web app never sells Coach Pro (it's an App Store subscription). Never show upsells. */
export const COACH_PRO_PURCHASES_ENABLED = false;

export const SUPPORT_EMAIL = "info@teamclubhq.com";
export const PRIVACY_URL = "https://teamclubhq.com/privacy";
export const TERMS_URL = "https://teamclubhq.com/terms";
export const APP_STORE_URL = "https://teamclubhq.com/download";

// ---------------------------------------------------------------------------
// Roles, personas, capabilities (DECISIONS D-007: screens ask capabilities, not role names)
// ---------------------------------------------------------------------------

const STAFF_ROLES: TeamRole[] = ["head_coach", "assistant_coach", "team_manager", "program_director", "super_admin"];

export const ROLE_LABELS: Record<TeamRole, string> = {
  super_admin: "Admin",
  program_director: "Director",
  head_coach: "Head Coach",
  assistant_coach: "Assistant Coach",
  team_manager: "Team Manager",
  parent: "Guardian",
  player: "Player",
};

export const isStaffRole = (role: TeamRole): boolean => STAFF_ROLES.includes(role);

export interface Capabilities {
  isHeadCoach: boolean;
  isStaff: boolean;
  isGuardian: boolean;
  isPlayer: boolean;
  canManageRoster: boolean;
  canManageSchedule: boolean;
  canPostAnnouncements: boolean;
  canTakeAttendance: boolean;
  canStartThreads: boolean;
  canManageDues: boolean;
  canSeeAllRSVPs: boolean;
  /** Two-adult rule (D-009): players never start private conversations. */
  canMessagePrivately: boolean;
  /** Players this user may RSVP for: linked children, plus themselves if they're a player. */
  rsvpPlayers: PlayerSummary[];
  /** coach if any staff role; else parent if guardian; else player. Drives the Home layout. */
  primaryPersona: Persona;
}

export function capabilities(team: TeamMembership): Capabilities {
  const isHeadCoach = team.roles.includes("head_coach") || team.roles.includes("super_admin");
  const isStaff = team.roles.some(isStaffRole);
  const isGuardian = team.linked_players.length > 0 || team.roles.includes("parent");
  const isPlayer = team.player_self != null || team.roles.includes("player");
  const rsvpPlayers = [...team.linked_players];
  if (team.player_self && !rsvpPlayers.some((p) => p.id === team.player_self?.id)) rsvpPlayers.push(team.player_self);
  return {
    isHeadCoach,
    isStaff,
    isGuardian,
    isPlayer,
    canManageRoster: isHeadCoach,
    canManageSchedule: isHeadCoach,
    canPostAnnouncements: isHeadCoach,
    canTakeAttendance: isHeadCoach,
    canStartThreads: isStaff,
    canManageDues: isHeadCoach,
    canSeeAllRSVPs: isStaff,
    canMessagePrivately: isStaff || isGuardian,
    rsvpPlayers,
    primaryPersona: isStaff ? "coach" : isGuardian ? "parent" : "player",
  };
}

/** "Head Coach, Assistant Coach" · "Guardian of Maya, Leo" · "Player" · "Member" */
export function memberRoleSummary(member: TeamMember): string {
  const staff = member.roles.filter(isStaffRole);
  if (staff.length > 0) return staff.map((r) => ROLE_LABELS[r]).join(", ");
  if (member.roles.includes("parent")) {
    return member.children.length === 0 ? "Guardian" : `Guardian of ${member.children.join(", ")}`;
  }
  return member.roles.includes("player") ? "Player" : "Member";
}

/** "U12 · Fall 2026" */
export function teamSubtitle(team: { age_group: string | null; season: string | null }): string {
  return [team.age_group, team.season].filter((v): v is string => !!v && v.trim() !== "").join(" · ");
}

export const resolvedSport = (team: { sport: Sport | null }): Sport => team.sport ?? "basketball";

/** Free plan: 1 team as head coach; Coach Pro: up to 3 (D-011). */
export function canCreateAnotherTeam(headCoachTeamCount: number, isCoachPro: boolean): boolean {
  return headCoachTeamCount === 0 || (isCoachPro && headCoachTeamCount < 3);
}

// ---------------------------------------------------------------------------
// Sports & positions (D-013)
// ---------------------------------------------------------------------------

export const SPORTS: Sport[] = ["basketball", "soccer", "baseball", "softball", "volleyball", "football", "hockey", "lacrosse", "other"];

export const SPORT_LABELS: Record<Sport, string> = {
  basketball: "Basketball",
  soccer: "Soccer",
  baseball: "Baseball",
  softball: "Softball",
  volleyball: "Volleyball",
  football: "Football",
  hockey: "Hockey",
  lacrosse: "Lacrosse",
  other: "Other",
};

/** Empty for "other": show a free-text Position field instead of a picker. */
export const POSITIONS: Record<Sport, string[]> = {
  basketball: ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"],
  soccer: ["Goalkeeper", "Defender", "Midfielder", "Forward"],
  baseball: ["Pitcher", "Catcher", "First Base", "Second Base", "Third Base", "Shortstop", "Left Field", "Center Field", "Right Field", "Utility"],
  softball: ["Pitcher", "Catcher", "First Base", "Second Base", "Third Base", "Shortstop", "Left Field", "Center Field", "Right Field", "Utility"],
  volleyball: ["Setter", "Outside Hitter", "Opposite", "Middle Blocker", "Libero", "Defensive Specialist"],
  football: ["Quarterback", "Running Back", "Wide Receiver", "Tight End", "Offensive Line", "Defensive Line", "Linebacker", "Defensive Back", "Kicker"],
  hockey: ["Goalie", "Defense", "Center", "Wing"],
  lacrosse: ["Attack", "Midfield", "Defense", "Goalie"],
  other: [],
};

export const RELATIONSHIPS: Relationship[] = ["mother", "father", "guardian", "other"];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = { mother: "Mother", father: "Father", guardian: "Guardian", other: "Other" };

// ---------------------------------------------------------------------------
// Events, RSVP, attendance (D-019: RSVPs lock 4 hours before start unless a cutoff is set)
// ---------------------------------------------------------------------------

export const EVENT_TYPE_LABELS: Record<EventType, string> = { practice: "Practice", game: "Game", other: "Event" };
export const RSVP_LABELS: Record<RSVPStatus, string> = { yes: "Going", maybe: "Maybe", no: "Can't go" };
/** Display order of the three RSVP buttons. */
export const RSVP_ORDER: RSVPStatus[] = ["yes", "maybe", "no"];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" };
export const ATTENDANCE_ORDER: AttendanceStatus[] = ["present", "late", "absent", "excused"];

export const DEFAULT_RSVP_CUTOFF_LEAD_MS = 4 * 3600_000;

export function effectiveRsvpCutoff(event: TeamEvent): Date {
  return event.rsvp_cutoff_at
    ? new Date(event.rsvp_cutoff_at)
    : new Date(new Date(event.starts_at).getTime() - DEFAULT_RSVP_CUTOFF_LEAD_MS);
}

export function isRsvpOpen(event: TeamEvent, now = new Date()): boolean {
  return event.cancelled_at == null && now < effectiveRsvpCutoff(event);
}

/** Past = ended (or, with no end time, started more than an hour ago). */
export function isPast(event: TeamEvent, now = new Date()): boolean {
  const end = event.ends_at ? new Date(event.ends_at) : new Date(new Date(event.starts_at).getTime() + 3600_000);
  return end < now;
}

export const isCancelled = (event: TeamEvent): boolean => event.cancelled_at != null;

/** Games with an opponent show "vs Hawks" (home) or "@ Hawks" (away); everything else shows the title. */
export function eventDisplayTitle(event: TeamEvent): string {
  if (event.event_type === "game" && event.opponent && event.opponent.trim() !== "") {
    return `${event.home_away === "away" ? "@" : "vs"} ${event.opponent}`;
  }
  return event.title;
}

/** "W 54–48" from this team's perspective (our score first). null until both scores exist. */
export function scoreLine(event: TeamEvent): string | null {
  if (event.home_score == null || event.away_score == null) return null;
  const away = event.home_away === "away";
  const ours = away ? event.away_score : event.home_score;
  const theirs = away ? event.home_score : event.away_score;
  const letter = ours > theirs ? "W" : ours < theirs ? "L" : "T";
  return `${letter} ${ours}–${theirs}`;
}

/** Value stored in events.result when a coach saves a score. */
export function resultFromScore(homeAway: string | null, homeScore: number, awayScore: number): "win" | "loss" | "tie" {
  const away = homeAway === "away";
  const ours = away ? awayScore : homeScore;
  const theirs = away ? homeScore : awayScore;
  return ours > theirs ? "win" : ours < theirs ? "loss" : "tie";
}

/** Title sent to the server: typed title, else "Game vs <opponent>", else "Practice"/"Game"/"Event". */
export function resolvedEventTitle(draft: Pick<EventDraft, "title" | "event_type" | "opponent">): string {
  const trimmed = draft.title.trim();
  if (trimmed !== "") return trimmed;
  if (draft.event_type === "game" && draft.opponent.trim() !== "") return `Game vs ${draft.opponent.trim()}`;
  return EVENT_TYPE_LABELS[draft.event_type];
}

/** The next whole hour from now (default start for a new event). */
export function nextHour(from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Defaults for "New Event": next whole hour, 90 minutes long, practice, doesn't repeat. */
export function newEventDraft(teamId: string): EventDraft {
  const start = nextHour();
  return {
    team_id: teamId,
    title: "",
    event_type: "practice",
    starts_at: start,
    ends_at: new Date(start.getTime() + 90 * 60_000),
    location: "",
    location_address: "",
    notes: "",
    opponent: "",
    is_home: true,
    repeat_weeks: 0,
  };
}

export function eventDraftFrom(event: TeamEvent): EventDraft {
  const start = new Date(event.starts_at);
  return {
    id: event.id,
    team_id: event.team_id,
    title: event.title,
    event_type: event.event_type,
    starts_at: start,
    ends_at: event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 90 * 60_000),
    location: event.location ?? "",
    location_address: event.location_address ?? "",
    notes: event.notes ?? "",
    opponent: event.opponent ?? "",
    is_home: event.home_away !== "away",
    repeat_weeks: 0,
  };
}

/** When the start time moves, keep the duration (move the end by the same amount). */
export function moveEventStart(draft: EventDraft, newStart: Date): EventDraft {
  const delta = newStart.getTime() - draft.starts_at.getTime();
  return { ...draft, starts_at: newStart, ends_at: new Date(draft.ends_at.getTime() + delta) };
}

export const isEventDraftValid = (draft: EventDraft): boolean => draft.ends_at > draft.starts_at;

export interface RsvpCounts {
  yes: number;
  maybe: number;
  no: number;
  noResponse: number;
}

/** Counts across the active roster; players without an RSVP count as "No reply". */
export function rsvpCounts(roster: Player[], rsvps: RSVP[]): RsvpCounts {
  const active = roster.filter((p) => p.archived_at == null);
  const statusOf = (playerId: string) => rsvps.find((r) => r.player_id === playerId)?.status;
  const yes = active.filter((p) => statusOf(p.id) === "yes").length;
  const maybe = active.filter((p) => statusOf(p.id) === "maybe").length;
  const no = active.filter((p) => statusOf(p.id) === "no").length;
  return { yes, maybe, no, noResponse: active.length - yes - maybe - no };
}

/** Pre-fill for "Take Attendance": existing record, else "excused" if they RSVP'd no, else "present". */
export function attendancePrefill(detail: EventDetail): Record<string, AttendanceStatus> {
  const result: Record<string, AttendanceStatus> = {};
  for (const player of detail.roster) {
    const existing = detail.attendance.find((a) => a.player_id === player.id)?.status;
    const rsvp = detail.rsvps.find((r) => r.player_id === player.id)?.status;
    result[player.id] = existing ?? (rsvp === "no" ? "excused" : "present");
  }
  return result;
}

export interface AttendanceSummary {
  player: Player;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** (present + late) / (present + late + absent); excused excluded; 1 when no data. */
  rate: number;
}

/** Season report rows, best attendance first, ties by last name. */
export function attendanceSummaries(roster: Player[], records: AttendanceRecord[]): AttendanceSummary[] {
  return roster
    .map((player) => {
      const mine = records.filter((r) => r.player_id === player.id);
      const count = (s: AttendanceStatus) => mine.filter((r) => r.status === s).length;
      const present = count("present");
      const late = count("late");
      const absent = count("absent");
      const excused = count("excused");
      const counted = present + late + absent;
      return { player, present, late, absent, excused, rate: counted === 0 ? 1 : (present + late) / counted };
    })
    .sort((a, b) => (a.rate === b.rate ? a.player.last_name.localeCompare(b.player.last_name) : b.rate - a.rate));
}

/** Green ≥ 80%, orange ≥ 60%, red below. */
export function attendanceRateTone(rate: number): "good" | "warn" | "bad" {
  return rate >= 0.8 ? "good" : rate >= 0.6 ? "warn" : "bad";
}

/** Season record from past, non-cancelled games with scores. */
export function seasonRecord(events: TeamEvent[]): { wins: number; losses: number; ties: number } {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const event of events) {
    if (event.event_type !== "game" || event.cancelled_at) continue;
    const line = scoreLine(event);
    if (!line) continue;
    if (line.startsWith("W")) record.wins++;
    else if (line.startsWith("L")) record.losses++;
    else record.ties++;
  }
  return record;
}

/** Pro export: "Player,Jersey,Present,Late,Absent,Excused,Rate". */
export function attendanceCsv(rows: AttendanceSummary[]): string {
  const lines = ["Player,Jersey,Present,Late,Absent,Excused,Rate"];
  for (const row of rows) {
    const name = `${row.player.first_name} ${row.player.last_name}`.replace(/"/g, '""');
    lines.push(`"${name}",${row.player.jersey_number ?? ""},${row.present},${row.late},${row.absent},${row.excused},${Math.round(row.rate * 100)}%`);
  }
  return lines.join("\n");
}

/** Directions link (opens Google Maps on Android, any browser elsewhere). */
export function mapsUrl(event: TeamEvent): string | null {
  const query = event.location_address ?? event.location;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const AUDIENCE_LABELS: Record<MessageAudience, string> = { both: "Everyone", parents: "Parents & staff", staff: "Staff only" };

export const AUDIENCE_HELP: Record<MessageAudience, string> = {
  staff: "Only coaches and team managers.",
  parents: "Guardians and staff. Players don't see this thread.",
  both: "Everyone on the team, including players.",
};

/** The pinned team-wide chat is identified by kind/audience/title. */
export const isTeamChat = (thread: MessageThread): boolean =>
  thread.kind === "team" && thread.audience === "both" && thread.title === "Team chat";

export function threadDisplayTitle(thread: { title: string | null; kind: MessageThread["kind"] }): string {
  if (thread.title && thread.title !== "") return thread.title;
  switch (thread.kind) {
    case "event":
      return "Event discussion";
    case "direct":
      return "Direct message";
    case "group":
      return "Group";
    default:
      return "Team message";
  }
}

/** Chat polls this often while a conversation is open and the tab is visible (D-016). */
export const CHAT_POLL_MS = 5_000;

/** Blocked authors are hidden on this device only (App Review guideline 1.2 parity). */
export const BLOCKED_AUTHORS_STORAGE_KEY = "clubhq.blockedAuthorIds";

/** mailto: link for "Report" on a message. */
export function reportMessageMailto(input: {
  authorName: string;
  authorId: string;
  messageId: string;
  threadId: string;
  body: string;
  sentAt: Date;
}): string {
  const body = [
    "I'd like to report this message as objectionable.",
    "",
    `From: ${input.authorName}`,
    `Sent: ${input.sentAt.toLocaleString()}`,
    `Message: ${input.body}`,
    "",
    `Thread ID: ${input.threadId}`,
    `Message ID: ${input.messageId}`,
    `Author ID: ${input.authorId}`,
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Report message in ClubHQ")}&body=${encodeURIComponent(body)}`;
}

/** Inbox/notification link_path (web-style, from the server) → web app route. */
export function routeForLinkPath(linkPath: string | null): string | null {
  if (!linkPath) return null;
  const parts = linkPath.split("/").filter(Boolean);
  if (parts[0] === "event" && parts[1]) return `/events/${parts[1]}`;
  if (parts[0] === "team" && parts[1] === "messages" && parts[2]) return `/messages/${parts[2]}`;
  if (parts[0] === "join" && parts[1]) return `/join/${parts[1]}`;
  if (parts[0] === "parent" || parts[0] === "team") return "/team/announcements";
  if (parts[0] === "notifications") return "/inbox";
  return null;
}

// ---------------------------------------------------------------------------
// Invites & codes
// ---------------------------------------------------------------------------

/**
 * Accepts a bare team code ("ABCDE FGHJK", "abcde-fghjk"), an invite link
 * (https://teamclubhq.com/join/<code>, clubhq://join/<code>), or the whole shared invite message.
 */
export function parseInviteToken(input: string): string {
  const trimmed = input.trim();
  const link = trimmed.match(/(?:teamclubhq\.com|clubhq:\/)\/join\/([A-Za-z0-9_-]+)/);
  if (link) return link[1].length <= 12 ? link[1].toUpperCase() : link[1];
  const labelled = trimmed.match(/code:?\s*([A-Za-z0-9]{5}\s?[A-Za-z0-9]{5})/i);
  if (labelled) return labelled[1].replace(/\s/g, "").toUpperCase();
  const compact = trimmed.replace(/[\s-]/g, "");
  return compact.length <= 12 ? compact.toUpperCase() : compact;
}

/** "Find Team" is enabled once the parsed code has at least 8 characters. */
export const isPlausibleInviteToken = (token: string): boolean => token.replace(/\s/g, "").length >= 8;

/** "ABCDEFGHJK" → "ABCDE FGHJK" (easier to read aloud). */
export function spacedTeamCode(token: string): string {
  return token.length === 10 ? `${token.slice(0, 5)} ${token.slice(5)}` : token;
}

/** Text a head coach shares in a group text or email. Works for iPhone, Android, and computers. */
export function inviteShareText(teamName: string, token: string): string {
  return [
    `Join ${teamName} on ClubHQ — schedules, RSVPs, and team chat in one ad-free app.`,
    `iPhone: download ClubHQ, choose "I'm a parent or guardian", and enter team code: ${token}`,
    `Android or computer: https://app.teamclubhq.com/join/${token}`,
  ].join("\n");
}

/** A guardian's child form is complete when names are set and the emergency contact has a name and 7+ digit phone. */
export function isNewChildValid(child: {
  first_name: string;
  last_name: string;
  contact_name: string;
  contact_phone: string;
}): boolean {
  return (
    child.first_name.trim() !== "" &&
    child.last_name.trim() !== "" &&
    child.contact_name.trim() !== "" &&
    child.contact_phone.replace(/\D/g, "").length >= 7
  );
}

// ---------------------------------------------------------------------------
// Ages (COPPA, D-008)
// ---------------------------------------------------------------------------

export const MIN_ACCOUNT_AGE = 13;
export const AGE_GATE_STORAGE_KEY = "clubhq.ageGateBlockedUntil";
export const AGE_GATE_MESSAGE =
  "ClubHQ accounts are for ages 13 and up. Ask a parent or guardian to add you to your team from their account.";

/** Whole years between a YYYY-MM-DD birthdate and `on`, or null. */
export function ageFromBirthdate(birthdate: DateOnly | null, on = new Date()): number | null {
  const birth = parseDateOnly(birthdate);
  if (!birth) return null;
  let age = on.getFullYear() - birth.getFullYear();
  const beforeBirthday = on.getMonth() < birth.getMonth() || (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

export function canHaveOwnAccount(birthdate: DateOnly | null): boolean {
  const age = ageFromBirthdate(birthdate);
  return age != null && age >= MIN_ACCOUNT_AGE;
}

/** Sign-up birth year: 4 digits within the last 120 years, else null. */
export function parseBirthYear(text: string, now = new Date()): number | null {
  const digits = text.replace(/\D/g, "").slice(0, 4);
  const year = Number(digits);
  const current = now.getFullYear();
  return digits.length === 4 && year >= current - 120 && year <= current ? year : null;
}

/**
 * Neutral age screen (FTC COPPA guidance). Returns true when sign-up must be refused.
 * A refused attempt blocks sign-up on this browser for 24 hours so the year can't simply be changed.
 */
export function ageGateBlocks(birthYear: number, now = new Date()): boolean {
  const blockedUntil = Number(localStorage.getItem(AGE_GATE_STORAGE_KEY) ?? 0);
  const mightBeUnder13 = now.getFullYear() - birthYear < MIN_ACCOUNT_AGE;
  if (mightBeUnder13) localStorage.setItem(AGE_GATE_STORAGE_KEY, String(now.getTime() + 86_400_000));
  return mightBeUnder13 || blockedUntil > now.getTime();
}

// ---------------------------------------------------------------------------
// Money (D-010, D-011)
// ---------------------------------------------------------------------------

export const DUES_STATUS_LABELS: Record<DuesStatus, string> = { unpaid: "Unpaid", processing: "Processing", paid: "Paid", waived: "Waived" };
export const FEE_PERCENT_BPS = 290;
export const FEE_FLAT_CENTS = 79;
export const FEE_DISCLOSURE = "2.9% + $0.79 per checkout";

/** ClubHQ's all-in family fee per checkout. Must match the server (_shared/stripe.ts). */
export function duesFeeCents(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * FEE_PERCENT_BPS) / 10_000) + FEE_FLAT_CENTS;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatMoney = (cents: number): string => usd.format(cents / 100);

/** Parses "125", "$125.50", "125.5" → cents; null when there's no number. */
export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole || "0") * 100 + Math.round(Number(`0.${fraction || "0"}`) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export const collectedCents = (r: DuesRequest): number => r.items.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount_cents, 0);
export const expectedCents = (r: DuesRequest): number => r.items.filter((i) => i.status !== "waived").reduce((s, i) => s + i.amount_cents, 0);
export const unpaidItems = (r: DuesRequest) => r.items.filter((i) => i.status === "unpaid");
export function duesProgress(r: DuesRequest): number {
  const expected = expectedCents(r);
  return expected === 0 ? 1 : collectedCents(r) / expected;
}

// ---------------------------------------------------------------------------
// Dates. Timestamps display in the browser's local time zone.
// Date-only values (birthdate, due_date) are calendar days — never convert them through UTC,
// or the day shifts by one in the Americas.
// ---------------------------------------------------------------------------

export function formatDateOnly(date: Date): DateOnly {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateOnly(value: DateOnly | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Tue, Oct 14" */
export const dayLabel = (date: Date): string =>
  date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "6:00 PM" */
export const timeLabel = (date: Date): string => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today", "Tomorrow", "Yesterday", or "Tue, Oct 14" */
export function relativeDayLabel(date: Date, now = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, tomorrow)) return "Tomorrow";
  if (sameDay(date, yesterday)) return "Yesterday";
  return dayLabel(date);
}

/** "6:00 PM – 7:30 PM", or just the start time. */
export function timeRangeLabel(event: TeamEvent): string {
  const start = timeLabel(new Date(event.starts_at));
  return event.ends_at ? `${start} – ${timeLabel(new Date(event.ends_at))}` : start;
}

/** "Good morning, Dana" (before 12), "Good afternoon" (before 17), else "Good evening". */
export function greeting(fullName: string | null, email: string, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const display = fullName && fullName.trim() !== "" ? fullName : email.split("@")[0];
  const first = display.split(" ")[0];
  return first ? `${part}, ${first}` : part;
}

/** First + last initial, uppercased; "?" when empty. */
export function initials(name: string): string {
  const value = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return value || "?";
}

// ---------------------------------------------------------------------------
// Team color (Coach Pro)
// ---------------------------------------------------------------------------

export const DEFAULT_ACCENT = "#2457F5";
export const TEAM_COLOR_PALETTE = ["#2457F5", "#D7263D", "#1B998B", "#F49D37", "#6A4C93", "#111827", "#0EA5E9", "#16A34A"];

/** The team's brand color when valid, else the ClubHQ blue. */
export function teamTint(team: { brand_color: string | null }): string {
  return team.brand_color && /^#[0-9a-f]{6}$/i.test(team.brand_color) ? team.brand_color : DEFAULT_ACCENT;
}

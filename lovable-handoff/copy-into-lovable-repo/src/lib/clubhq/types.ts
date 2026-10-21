// ClubHQ data types — exactly what the production backend returns.
//
// Field names are snake_case because that is what PostgREST rows and the `mobile-api`
// Edge Function send. Do not rename them; use these types as-is.
// Timestamps are ISO-8601 strings (e.g. "2026-10-20T18:00:00+00:00").
// "Date-only" fields (birthdate, due_date, starts_on) are "YYYY-MM-DD" calendar days.
//
// Source of truth: ClubHQ iOS app (Core/Models/*.swift) and supabase/functions/mobile-api.

export type UUID = string;
/** ISO-8601 timestamp string. */
export type Timestamp = string;
/** "YYYY-MM-DD" calendar day. */
export type DateOnly = string;

// ---------------------------------------------------------------------------
// Enums (Postgres enums / validated strings)
// ---------------------------------------------------------------------------

export type TeamRole =
  | "super_admin"
  | "program_director"
  | "head_coach"
  | "assistant_coach"
  | "team_manager"
  | "parent"
  | "player";

export type Sport =
  | "basketball"
  | "soccer"
  | "baseball"
  | "softball"
  | "volleyball"
  | "football"
  | "hockey"
  | "lacrosse"
  | "other";

export type Relationship = "mother" | "father" | "guardian" | "other";

export type EventType = "practice" | "game" | "other";

export type HomeAway = "home" | "away";

export type RSVPStatus = "yes" | "maybe" | "no";

export type AttendanceStatus = "present" | "late" | "absent" | "excused";

export type ThreadKind = "team" | "event" | "direct" | "group";

export type MessageAudience = "both" | "parents" | "staff";

export type NotificationKind =
  | "announcement"
  | "event_created"
  | "event_updated"
  | "event_reminder"
  | "rsvp_reminder"
  | "message_new"
  | "event_thread_reply";

export type DuesStatus = "unpaid" | "processing" | "paid" | "waived";

export type Persona = "coach" | "parent" | "player";

// ---------------------------------------------------------------------------
// Context (mobile-api "context")
// ---------------------------------------------------------------------------

/** A roster entry as embedded in the user's context. */
export interface PlayerSummary {
  id: UUID;
  team_id: UUID;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
  birthdate: DateOnly | null;
  position: string | null;
  user_id?: UUID | null;
  archived_at?: Timestamp | null;
  /** Present on linked_players: how the signed-in guardian relates to this child. */
  relationship?: Relationship;
}

/** One team the signed-in user belongs to, with their roles on it. */
export interface TeamMembership {
  id: UUID;
  name: string;
  age_group: string | null;
  season: string | null;
  /** null on very old rows — treat as "basketball". */
  sport: Sport | null;
  /** "#RRGGBB" or null (Coach Pro feature). */
  brand_color: string | null;
  org_id: UUID | null;
  logo_url: string | null;
  roles: TeamRole[];
  /** Children the signed-in user is a guardian of, on this team. */
  linked_players: PlayerSummary[];
  /** The signed-in user's own roster entry (13+ player accounts), if any. */
  player_self: PlayerSummary | null;
  is_pro: boolean;
}

export interface UserContext {
  user_id: UUID;
  email: string;
  full_name: string | null;
  is_coach_pro: boolean;
  teams: TeamMembership[];
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/** Full `players` row. */
export interface Player {
  id: UUID;
  team_id: UUID;
  first_name: string;
  last_name: string;
  jersey_number: string | null;
  position: string | null;
  birthdate: DateOnly | null;
  /** Coach-only notes. RLS may hide this from non-staff. */
  notes: string | null;
  archived_at: Timestamp | null;
  /** Set when a 13+ player has claimed their own login. */
  user_id: UUID | null;
}

/** Fields a head coach edits on a roster entry. */
export interface PlayerDraft {
  id?: UUID;
  team_id: UUID;
  first_name: string;
  last_name: string;
  jersey_number: string;
  position: string;
  birthdate: DateOnly | null;
  notes: string;
}

export interface EmergencyContact {
  id: UUID;
  player_id: UUID;
  relationship: Relationship;
  name: string | null;
  phone: string;
  email: string | null;
}

/** A person on the team with a display name the server is allowed to share. */
export interface TeamMember {
  user_id: UUID;
  name: string;
  roles: TeamRole[];
  /** First names of the children this member is a guardian of. */
  children: string[];
}

// ---------------------------------------------------------------------------
// Teams & invites
// ---------------------------------------------------------------------------

export interface NewTeamRequest {
  team_name: string;
  sport: Sport;
  age_group: string;
  season: string;
  is_club: boolean;
  club_name: string;
}

/** A child a guardian adds when joining a team with a team code. */
export interface NewChildRequest {
  first_name: string;
  last_name: string;
  jersey_number: string;
  position: string;
  birthdate: DateOnly | null;
  /** How the signed-in guardian relates to the child. */
  relationship: Relationship;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  contact_relationship: Relationship;
}

export interface TeamPreview {
  id: UUID;
  name: string;
  age_group: string | null;
  season: string | null;
  sport: Sport | null;
}

export interface InvitePreview {
  valid: boolean;
  team?: TeamPreview;
  already_on_team?: boolean;
}

/** Team code ("token") a head coach shares with families. 10 characters, uppercase. */
export interface InviteLink {
  token: string;
  expires_at: Timestamp;
}

/** 8-character code a guardian or head coach creates for a 13+ player login. */
export interface PlayerInviteCode {
  code: string;
  expires_at: Timestamp;
}

export interface TeamSponsor {
  id: UUID;
  team_id: UUID;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  link_url: string | null;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** `events` row. */
export interface TeamEvent {
  id: UUID;
  team_id: UUID;
  title: string;
  event_type: EventType;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  location: string | null;
  location_address: string | null;
  notes: string | null;
  opponent: string | null;
  home_away: HomeAway | null;
  home_score: number | null;
  away_score: number | null;
  result: "win" | "loss" | "tie" | null;
  cancelled_at: Timestamp | null;
  rsvp_cutoff_at: Timestamp | null;
}

/** `rsvps` row. One per (event, player). */
export interface RSVP {
  id: UUID;
  event_id: UUID;
  player_id: UUID;
  status: RSVPStatus;
  note: string | null;
  responded_by: UUID | null;
  updated_at: Timestamp | null;
}

/** `attendance` row. One per (event, player). */
export interface AttendanceRecord {
  id: UUID;
  event_id: UUID;
  player_id: UUID;
  status: AttendanceStatus;
}

/** Everything the event screen needs in one load. */
export interface EventDetail {
  event: TeamEvent;
  rsvps: RSVP[];
  attendance: AttendanceRecord[];
  roster: Player[];
}

/** Fields a head coach edits when creating/updating an event. */
export interface EventDraft {
  id?: UUID;
  team_id: UUID;
  title: string;
  event_type: EventType;
  starts_at: Date;
  ends_at: Date;
  location: string;
  location_address: string;
  notes: string;
  opponent: string;
  is_home: boolean;
  /** New events only: 0 = doesn't repeat; N = N extra weekly copies (max 26). */
  repeat_weeks: number;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface MessageThread {
  id: UUID;
  team_id: UUID;
  kind: ThreadKind;
  event_id: UUID | null;
  audience: MessageAudience;
  title: string | null;
  pinned: boolean;
  created_by: UUID | null;
  updated_at: Timestamp;
  last_message: string | null;
  last_message_at: Timestamp | null;
  last_author_id: UUID | null;
  last_author_name: string | null;
  unread: boolean;
  muted: boolean;
}

export interface ThreadInfo {
  id: UUID;
  team_id: UUID;
  kind: ThreadKind;
  event_id: UUID | null;
  audience: MessageAudience;
  title: string | null;
  pinned: boolean;
  created_by: UUID | null;
  /** Head coach: may delete anyone's message. */
  can_moderate: boolean;
  /** False for player-only accounts in non-team threads (read-only). */
  can_post: boolean;
}

export interface ChatMessage {
  id: UUID;
  author_id: UUID;
  author_name: string;
  /** "[deleted]" when is_deleted. */
  body: string;
  created_at: Timestamp;
  edited_at: Timestamp | null;
  is_deleted: boolean;
  is_mine: boolean;
}

export interface ThreadDetail {
  thread: ThreadInfo;
  messages: ChatMessage[];
}

/** `announcements` row. */
export interface Announcement {
  id: UUID;
  team_id: UUID;
  title: string;
  body: string;
  created_at: Timestamp;
  created_by: UUID;
}

/** In-app notification (mobile-api "inbox"). The inbox is the source of truth for notifications on the web. */
export interface InboxItem {
  id: UUID;
  /** Web-style path, e.g. "/event/<id>", "/team/messages/<id>", "/parent", "/notifications". */
  link_path: string | null;
  read_at: Timestamp | null;
  created_at: Timestamp;
  kind: NotificationKind;
  subject: string;
  body: string;
  team_id: UUID | null;
  ref_id: UUID | null;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface DuesItem {
  id: UUID;
  player_id: UUID;
  amount_cents: number;
  status: DuesStatus;
  paid_at: Timestamp | null;
  player_name: string;
}

export interface DuesRequest {
  id: UUID;
  title: string;
  description: string | null;
  amount_cents: number;
  due_date: DateOnly | null;
  created_at: Timestamp;
  /** Staff see every player's item; guardians see only their own children's items. */
  items: DuesItem[];
}

export interface DuesOverview {
  payments_enabled: boolean;
  payments_connected: boolean;
  fee: { percent_bps: number; flat_cents: number };
  requests: DuesRequest[];
}

export interface CheckoutSession {
  url: string;
  subtotal_cents: number;
  fee_cents: number;
  total_cents: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type SignUpOutcome = "signed_in" | "confirm_email";

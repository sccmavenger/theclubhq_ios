// Live check for the club portal's server side (D-053) against the deployed mobile-api:
// my-clubs (the portal's gate), the new club-overview fields, club-team-detail, sent message
// history, editing a club event on every team, and second directors by one-time code.
// Throwaway accounts, all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d053_club_portal_check.mjs
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
const emailFor = (role) => `qa+d053-${role}-${stamp}@teamclubhq.com`;
async function makeUser(role) {
  const email = emailFor(role), password = `Qa!${crypto.randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, jwt: s.access_token };
}
const api = async (role, action, params = {}) => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  return { status: r.status, body: await r.json() };
};
const iso = (ms) => new Date(Date.now() + ms).toISOString();

let orgId;
try {
  for (const r of ["director", "director2", "coach", "parent", "outsider"]) await makeUser(r);

  // ----- The portal's gate ------------------------------------------------------
  orgId = (await api("director", "create-club", { name: `QA Portal Club ${stamp}`, time_zone: "America/Chicago" })).body.org_id;
  const pending = await api("director", "my-clubs");
  check("my-clubs lists a club waiting for approval as pending", pending.body.clubs?.length === 1 && pending.body.clubs[0].pending === true && pending.body.email === users.director.email, JSON.stringify(pending.body));
  await sql(`update organizations set club_approved_at = now() where id = '${orgId}'`);
  const mine = await api("director", "my-clubs");
  check("…and as active once approved", mine.body.clubs?.[0]?.id === orgId && mine.body.clubs[0].pending === false, JSON.stringify(mine.body));
  const none = await api("outsider", "my-clubs");
  check("someone who directs nothing gets no clubs", none.status === 200 && none.body.clubs?.length === 0, JSON.stringify(none.body));

  // ----- A club with two teams, a coach, a family, dues and events ---------------
  const created = (await api("director", "club-create-teams", { org_id: orgId, teams: [
    { name: "8th Boys Elite", grade: "8", gender: "boys", level: "Elite", coach_email: users.coach.email },
    { name: "8th Girls Gold", grade: "8", gender: "girls", level: "Gold", coach_email: emailFor("nobody") },
  ] })).body.teams;
  const [boys, girls] = created;
  await api("coach", "claim-club-invite", { token: boys.coach.code });
  const kids = await sql(`insert into players (team_id, first_name, last_name, jersey_number, created_by) values
    ('${boys.team_id}', 'Ava', 'QA', '3', '${users.director.id}'), ('${boys.team_id}', 'Ben', 'QA', '5', '${users.director.id}') returning id`);
  await sql(`insert into parent_player_links (player_id, parent_user_id, relationship) values ('${kids[0].id}', '${users.parent.id}', 'mother');
    insert into user_roles (user_id, role, team_id) values ('${users.parent.id}', 'parent', '${boys.team_id}');`);
  const req = (await sql(`insert into dues_requests (team_id, title, amount_cents, created_by) values ('${boys.team_id}', 'Fall fee', 12000, '${users.director.id}') returning id`))[0].id;
  await sql(`insert into dues_items (request_id, player_id, amount_cents, status) values ('${req}', '${kids[0].id}', 12000, 'paid'), ('${req}', '${kids[1].id}', 12000, 'unpaid')`);
  const game = (await api("director", "save-event", { team_id: boys.team_id, title: "Game", event_type: "game", opponent: "Rise", starts_at: iso(2 * 864e5), time_zone: "America/Chicago" })).body.event_ids[0];
  await api("parent", "set-rsvp", { event_id: game, player_id: kids[0].id, status: "yes" });

  // ----- Overview fields the portal uses ------------------------------------------
  const ov = (await api("director", "club-overview", { org_id: orgId })).body;
  const ovBoys = ov.teams?.find((t) => t.id === boys.team_id), ovGirls = ov.teams?.find((t) => t.id === girls.team_id);
  check("overview: club player and linked-player counts", ov.club?.player_count === 2 && ov.club?.linked_player_count === 1, JSON.stringify(ov.club));
  check("overview: linked players per team", ovBoys?.linked_player_count === 1 && ovGirls?.linked_player_count === 0, JSON.stringify([ovBoys?.linked_player_count, ovGirls?.linked_player_count]));
  check("overview: pending coach invites carry when they were sent", typeof ovGirls?.pending_coaches?.[0]?.invited_at === "string", JSON.stringify(ovGirls?.pending_coaches));
  check("overview: this week's events with RSVPs answered and roster size", ov.week_events?.some((e) => e.id === game && e.team_name === "8th Boys Elite" && e.rsvp_count === 1 && e.roster_count === 2), JSON.stringify(ov.week_events));
  check("overview: club RSVP health for the week", ov.club?.week_rsvps?.expected === 2 && ov.club?.week_rsvps?.answered === 1, JSON.stringify(ov.club?.week_rsvps));
  check("overview: directors marked with which one is me", ov.directors?.length === 1 && ov.directors[0].is_me === true, JSON.stringify(ov.directors));

  // ----- Team page --------------------------------------------------------------
  const td = await api("director", "club-team-detail", { team_id: boys.team_id });
  const ava = td.body.roster?.find((p) => p.first_name === "Ava"), ben = td.body.roster?.find((p) => p.first_name === "Ben");
  check("team page: roster with guardians linked", td.status === 200 && ava?.guardian_count === 1 && ben?.guardian_count === 0, JSON.stringify(td.body.roster));
  check("team page: what each family owes and dues totals", ben?.owes_cents === 12000 && ava?.owes_cents === 0 && td.body.dues?.requested_cents === 24000 && td.body.dues?.collected_cents === 12000 && td.body.dues?.families_owing === 1, JSON.stringify(td.body.dues));
  check("team page: upcoming events with going / maybe / can't counts", td.body.upcoming?.[0]?.id === game && td.body.upcoming[0].yes === 1 && td.body.upcoming[0].no === 0, JSON.stringify(td.body.upcoming));
  check("team page: coaches", td.body.coaches?.[0]?.user_id === users.coach.id && td.body.coaches[0].role === "head_coach", JSON.stringify(td.body.coaches));
  check("team page: no contact details anywhere (D-053)", !/@/.test(JSON.stringify(td.body.roster)) && !("email" in (td.body.coaches?.[0] ?? {})));
  check("a team's own coach can't open the club team page", (await api("coach", "club-team-detail", { team_id: boys.team_id })).status === 403);
  check("an outsider can't either", (await api("outsider", "club-team-detail", { team_id: boys.team_id })).status === 403);

  // ----- Sent message history -------------------------------------------------------
  await api("director", "club-announcement", { org_id: orgId, title: "Gym closed Thursday", body: "No practices Thursday." });
  await api("director", "club-announcement", { org_id: orgId, title: "Girls meeting", body: "Parents meeting Monday.", filter: { genders: ["girls"] } });
  const hist = await api("director", "club-announcements", { org_id: orgId });
  const s1 = hist.body.sends?.find((s) => s.title === "Gym closed Thursday"), s2 = hist.body.sends?.find((s) => s.title === "Girls meeting");
  check("history: one row per send, with how many teams it went to", hist.body.sends?.length === 2 && s1?.team_count === 2 && s2?.team_count === 1 && typeof s1?.sent_by === "string", JSON.stringify(hist.body));
  check("history is directors-only", (await api("coach", "club-announcements", { org_id: orgId })).status === 403);

  // ----- Edit a club event on every team --------------------------------------------
  const ce = (await api("director", "club-event", { org_id: orgId, title: "Picture Day", event_type: "other", starts_at: iso(6 * 864e5), location: "Academy gym" })).body;
  const ovEv = (await api("director", "club-overview", { org_id: orgId })).body.club_events?.find((e) => e.club_event_id === ce.club_event_id);
  check("club events in the overview carry place and notes for editing", ovEv?.location === "Academy gym" && "notes" in ovEv && "ends_at" in ovEv, JSON.stringify(ovEv));
  const newStart = iso(7 * 864e5);
  const upd = await api("director", "club-event-update", { club_event_id: ce.club_event_id, title: "Picture Day (moved)", starts_at: newStart, location: "Main gym" });
  const rows = await sql(`select title, starts_at, location, rsvp_cutoff_at from events where club_event_id='${ce.club_event_id}'`);
  check("editing changes it on every team", upd.status === 200 && upd.body.updated === 2 && rows.length === 2 && rows.every((r) => r.title === "Picture Day (moved)" && r.location === "Main gym" && new Date(r.starts_at).toISOString() === newStart), JSON.stringify({ upd: upd.body, rows }));
  check("…and moves the RSVP cutoff with it", rows.every((r) => new Date(r.rsvp_cutoff_at).getTime() === new Date(newStart).getTime() - 4 * 3600e3), JSON.stringify(rows.map((r) => r.rsvp_cutoff_at)));
  await new Promise((s) => setTimeout(s, 1500));
  const told = await sql(`select n.subject from notifications n join notification_sends s on s.notification_id=n.id where s.recipient_user_id='${users.parent.id}' and n.subject like 'Updated:%'`);
  check("families are told when the time or place moves", told.length === 1 && /Picture Day \(moved\)/.test(told[0].subject), JSON.stringify(told));
  check("a coach can't edit a club event", (await api("coach", "club-event-update", { club_event_id: ce.club_event_id, title: "Mine" })).status === 403);
  const bad = await api("director", "club-event-update", { club_event_id: ce.club_event_id, ends_at: iso(864e5) });
  check("an end before the start is refused", bad.status === 400, JSON.stringify(bad.body));

  // ----- Second director by code (D-053: full powers) ---------------------------------
  check("an outsider can't invite directors", (await api("outsider", "club-invite-director", { org_id: orgId, email: users.director2.email })).status === 403);
  const inv = await api("director", "club-invite-director", { org_id: orgId, email: users.director2.email });
  check("inviting a director gives a one-time code and a message to send", inv.status === 200 && /^[A-Z0-9]{10}$/.test(inv.body.code ?? "") && /Join a Club/.test(inv.body.invite_text ?? ""), JSON.stringify(inv.body));
  const ovP = (await api("director", "club-overview", { org_id: orgId })).body;
  check("the invite shows as pending in the overview", ovP.pending_directors?.some((d) => d.email === users.director2.email && d.code === inv.body.code), JSON.stringify(ovP.pending_directors));
  check("the invited person isn't a director until they accept", (await api("director2", "my-clubs")).body.clubs?.length === 0);
  const look = await api("director2", "lookup-club-invite", { token: inv.body.code });
  check("the code says it's a director invite for this club", look.body.kind === "director" && look.body.club_name === `QA Portal Club ${stamp}`, JSON.stringify(look.body));
  const claim = await api("director2", "claim-club-invite", { token: inv.body.code });
  check("accepting makes them a director", claim.status === 200 && claim.body.org_id === orgId && (await api("director2", "my-clubs")).body.clubs?.[0]?.id === orgId, JSON.stringify(claim.body));
  check("the code works once", (await api("outsider", "claim-club-invite", { token: inv.body.code })).status === 410);
  const td2 = await api("director2", "club-team-detail", { team_id: girls.team_id });
  check("the new director has full powers (team page, invite more directors)", td2.status === 200 && (await api("director2", "club-invite-director", { org_id: orgId, email: emailFor("third") })).status === 200);
  await new Promise((s) => setTimeout(s, 1500));
  const toldDir = await sql(`select n.subject from notifications n join notification_sends s on s.notification_id=n.id where s.recipient_user_id='${users.director.id}' and n.subject='New club director'`);
  check("the existing director is told", toldDir.length === 1, JSON.stringify(toldDir));
  const cancelInv = await api("director", "club-remove-director", { org_id: orgId, email: emailFor("third") });
  const ovC = (await api("director", "club-overview", { org_id: orgId })).body;
  check("a pending director invite can be cancelled", cancelInv.status === 200 && !ovC.pending_directors?.some((d) => d.email === emailFor("third")), JSON.stringify(ovC.pending_directors));
  const rm = await api("director2", "club-remove-director", { org_id: orgId, user_id: users.director.id });
  check("a director can remove another director", rm.status === 200 && (await api("director", "my-clubs")).body.clubs?.length === 0, JSON.stringify(rm.body));
  const last = await api("director2", "club-remove-director", { org_id: orgId, user_id: users.director2.id });
  check("the last director can't be removed", last.status === 400 && /at least one director/.test(last.body.error?.message ?? ""), JSON.stringify(last.body));
  const audit = await sql(`select action from audit_logs where target_id='${orgId}' order by created_at`);
  const acts = audit.map((a) => a.action);
  check("director changes are logged", ["club.director_invited", "club.director_joined", "club.director_removed"].every((a) => acts.includes(a)), JSON.stringify(acts));
} finally {
  if (orgId) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id='${orgId}'));
    delete from notifications where team_id in (select id from teams where org_id='${orgId}');
    delete from teams where org_id='${orgId}'; delete from user_roles where org_id='${orgId}';
    delete from audit_logs where target_id='${orgId}'; delete from organizations where id='${orgId}';`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids}); delete from audit_logs where actor_user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}

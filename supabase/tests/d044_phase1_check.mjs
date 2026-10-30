// Live check for clubs Phase 1 (D-044) against the deployed mobile-api: create a club, add teams
// (one coach already on ClubHQ, one invited by code), bring an existing team in with the club
// code, director powers, club announcements and events to filtered groups, one push per person,
// removing a coach. Throwaway accounts, all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d044_phase1_check.mjs
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
const emailFor = (role) => `qa+d044p1-${role}-${stamp}@teamclubhq.com`;
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
const rest = async (role, method, path, body) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let orgId, indieOrg;
try {
  for (const r of ["director", "coachA", "indie", "parentA", "parentB", "outsider"]) await makeUser(r);

  // ----- Create the club -----------------------------------------------------
  const club = await api("director", "create-club", { name: `QA Academy ${stamp}`, time_zone: "America/Chicago" });
  orgId = club.body.org_id;
  // New clubs wait for approval (D-051): no code, no director powers, until an admin approves.
  check("a director creates a club; it waits for approval", club.status === 200 && orgId && club.body.pending === true && club.body.code === null, JSON.stringify(club.body));
  const waiting = (await api("director", "context")).body;
  check("the director's context lists the club as pending", waiting.clubs?.some((c) => c.id === orgId && c.pending === true), JSON.stringify(waiting.clubs));
  const early = await api("director", "club-create-teams", { org_id: orgId, teams: [{ name: "Too early" }] });
  check("a pending club can't add teams yet", early.status === 403 && early.body.error?.code === "club_pending", JSON.stringify(early.body));
  const pend = await sql(`select private.is_internal_user('${users.director.id}') as i, (select count(*)::int from organizations where id = '${orgId}' and club_approved_at is null) as n`);
  check("it shows in the admin portal's approval list", pend[0]?.n === 1, JSON.stringify(pend));
  await sql(`update organizations set club_approved_at = now() where id = '${orgId}'`); // what admin-api approve-club does
  const dctx = (await api("director", "context")).body;
  check("once approved, the context lists the club as active", dctx.clubs?.some((c) => c.id === orgId && c.pending === false), JSON.stringify(dctx.clubs));

  // ----- Teams: one with an existing coach, one invited by code, one without -----
  const created = await api("director", "club-create-teams", { org_id: orgId, teams: [
    { name: "6th Boys Gold", grade: "6", gender: "boys", level: "Gold", season: "Fall 2026", coach_email: users.coachA.email },
    { name: "6th Girls", grade: "6", gender: "girls", season: "Fall 2026", coach_email: emailFor("newcoach") },
    { name: "7th Boys", grade: "7", gender: "boys", season: "Fall 2026" },
  ] });
  const [gold, girls, seventh] = created.body.teams ?? [];
  check("bulk team creation", created.status === 200 && created.body.teams?.length === 3, JSON.stringify(created.body).slice(0, 200));
  // Every coach gets a code and accepts (D-051): the director can't tell who already has an account.
  check("a coach already on ClubHQ gets a code too, not added without asking", gold?.coach?.status === "invited" && /^[A-Z0-9]{10}$/.test(gold?.coach?.code ?? ""), JSON.stringify(gold?.coach));
  check("a new coach gets a code and a message to send", girls?.coach?.status === "invited" && /Join a Club/.test(girls?.invite_text ?? ""), JSON.stringify(girls));
  check("the director sees the same answer either way", JSON.stringify(Object.keys(gold?.coach ?? {}).sort()) === JSON.stringify(Object.keys(girls?.coach ?? {}).sort()));
  const before = (await api("coachA", "context")).body;
  check("the existing coach isn't on the team until they accept", !before.teams?.some((t) => t.id === gold.team_id), JSON.stringify(before.teams?.map((t) => t.name)));
  await new Promise((s) => setTimeout(s, 2000));
  const told = await sql(`select n.subject, n.body from notifications n join notification_sends s on s.notification_id=n.id where s.recipient_user_id='${users.coachA.id}'`);
  check("…but gets the code privately in the app", told.some((n) => /invited you to coach 6th Boys Gold/.test(n.subject) && n.body.includes(gold.coach.code)), JSON.stringify(told));
  const accept = await api("coachA", "claim-club-invite", { token: gold.coach.code });
  const actx = (await api("coachA", "context")).body;
  check("after accepting, they're head coach", accept.status === 200 && actx.teams?.some((t) => t.id === gold.team_id && t.roles.includes("head_coach")), JSON.stringify(actx.teams?.map((t) => [t.name, t.roles])));

  // The invited coach signs up and uses the code.
  await makeUser("newcoach");
  const look = await api("newcoach", "lookup-club-invite", { token: girls.coach.code });
  check("a coach code shows the club and team", look.body.kind === "coach" && look.body.team_name === "6th Girls", JSON.stringify(look.body));
  const claim = await api("newcoach", "claim-club-invite", { token: girls.coach.code });
  check("…and makes them head coach", claim.status === 200 && claim.body.team_id === girls.team_id, JSON.stringify(claim.body));
  const reuse = await api("outsider", "claim-club-invite", { token: girls.coach.code });
  check("a coach code works once", reuse.status === 410, String(reuse.status));

  // A coach brings their existing team in with the club code.
  const indieTeam = (await api("indie", "create-team", { team_name: "Indie Hoopers", heard_from: "friend_or_coach" })).body;
  indieOrg = indieTeam.org_id;
  // The club code comes with approval: the director shares it from the Club tab (club-overview).
  const clubCode = (await api("director", "club-overview", { org_id: orgId })).body.club.code;
  const look2 = await api("indie", "lookup-club-invite", { token: clubCode });
  check("the club code offers the coach's own team to bring in", look2.body.kind === "club_code" && look2.body.movable_teams?.some((t) => t.id === indieTeam.team_id), JSON.stringify(look2.body));
  const brought = await api("indie", "claim-club-invite", { token: clubCode, team_id: indieTeam.team_id });
  const indieRow = (await sql(`select org_id from teams where id='${indieTeam.team_id}'`))[0];
  check("…and the team moves into the club", brought.status === 200 && indieRow.org_id === orgId, JSON.stringify(brought.body));

  // ----- Overview --------------------------------------------------------------
  const ov = await api("director", "club-overview", { org_id: orgId });
  const ovGold = ov.body.teams?.find((t) => t.id === gold.team_id);
  check("the overview lists all 4 teams with coaches", ov.status === 200 && ov.body.teams?.length === 4 && ovGold?.coaches?.[0]?.user_id === users.coachA.id && ovGold.grade === "6" && ovGold.level === "Gold", JSON.stringify(ov.body).slice(0, 300));
  check("outsiders and coaches can't open the club overview", (await api("outsider", "club-overview", { org_id: orgId })).status === 403 && (await api("coachA", "club-overview", { org_id: orgId })).status === 403);

  // ----- Families (one parent has kids on two teams) ----------------------------
  const kid = async (team, first, parent) => {
    const id = (await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${team}', '${first}', 'QA', '${users.director.id}') returning id`))[0].id;
    await sql(`insert into parent_player_links (player_id, parent_user_id, relationship) values ('${id}', '${users[parent].id}', 'mother');
      insert into user_roles (user_id, role, team_id) values ('${users[parent].id}', 'parent', '${team}');`);
  };
  await kid(gold.team_id, "Ava", "parentA");
  await kid(gold.team_id, "Ben", "parentB");
  await kid(girls.team_id, "Cara", "parentB");

  // ----- Director powers on a team --------------------------------------------
  const dPlayer = await rest("director", "POST", "players", { team_id: seventh.team_id, first_name: "Dan", last_name: "QA", created_by: users.director.id });
  check("the director edits a team's roster directly", dPlayer.status === 201, JSON.stringify(dPlayer.body));
  const dEvent = await api("director", "save-event", { team_id: seventh.team_id, title: "Practice", event_type: "practice", starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), time_zone: "America/Chicago" });
  check("the director schedules for a team", dEvent.status === 200, JSON.stringify(dEvent.body));
  check("coaches still can't touch other club teams", (await rest("coachA", "POST", "players", { team_id: girls.team_id, first_name: "X", last_name: "Y", created_by: users.coachA.id })).status >= 400);
  const chat = await api("director", "team-chat", { team_id: gold.team_id });
  const post = await api("director", "post-message", { thread_id: chat.body.thread_id, body: "Great win Saturday!" });
  check("the director posts in a team's chat", post.status === 200, JSON.stringify(post.body));

  // ----- Club announcement to 6th grade ----------------------------------------
  const aud = await api("director", "club-audience", { org_id: orgId, filter: { grades: ["6"] } });
  check("audience preview: 6th grade = 2 teams, 4 people", aud.body.team_count === 2 && aud.body.people_count === 4, JSON.stringify(aud.body));
  const ann = await api("director", "club-announcement", { org_id: orgId, title: "Picture day", body: "Bring jerseys Saturday.", filter: { grades: ["6"] } });
  const anns = await sql(`select team_id, from_club from announcements where title='Picture day' and team_id in ('${gold.team_id}','${girls.team_id}','${seventh.team_id}')`);
  check("the announcement lands on each 6th-grade team, labeled with the club", ann.status === 200 && anns.length === 2 && anns.every((a) => a.from_club === `QA Academy ${stamp}`), JSON.stringify(anns));
  const pushes = await sql(`select s.recipient_user_id from notification_sends s join notifications n on n.id=s.notification_id where n.subject like '%Picture day'`);
  check("one notification per person, even with kids on two teams", pushes.filter((x) => x.recipient_user_id === users.parentB.id).length === 1 && pushes.length === 4, JSON.stringify(pushes));
  const parentSees = await rest("parentA", "GET", `announcements?select=title,from_club&title=eq.Picture%20day`);
  check("a parent sees it on their own team only", parentSees.body?.length === 1 && parentSees.body[0].from_club, JSON.stringify(parentSees.body));

  // ----- Club event for boys teams ---------------------------------------------
  const ev = await api("director", "club-event", { org_id: orgId, title: "Tryouts", event_type: "other", starts_at: new Date(Date.now() + 7 * 864e5).toISOString(), location: "Beal Center", filter: { genders: ["boys"] } });
  const evRows = await sql(`select team_id from events where club_event_id='${ev.body.club_event_id}'`);
  check("a club event goes on every boys team (2), linked", ev.status === 200 && evRows.length === 2, JSON.stringify(ev.body));
  const ov2 = await api("director", "club-overview", { org_id: orgId });
  check("the overview lists the club event", ov2.body.club_events?.some((e) => e.club_event_id === ev.body.club_event_id && e.team_count === 2), JSON.stringify(ov2.body.club_events));
  const cancel = await api("director", "club-event-cancel", { club_event_id: ev.body.club_event_id });
  const cancelled = await sql(`select count(*)::int n from events where club_event_id='${ev.body.club_event_id}' and cancelled_at is not null`);
  check("cancelling it cancels it on every team", cancel.body.cancelled === 2 && cancelled[0].n === 2, JSON.stringify(cancel.body));

  // ----- Coach leaves; the team stays ------------------------------------------
  await api("director", "club-remove-coach", { team_id: gold.team_id, user_id: users.coachA.id });
  const left = await sql(`select (select count(*)::int from user_roles where team_id='${gold.team_id}' and user_id='${users.coachA.id}') roles, (select count(*)::int from players where team_id='${gold.team_id}') kids`);
  check("removing a coach keeps the team and its players", left[0].roles === 0 && left[0].kids === 2, JSON.stringify(left));

  // ----- Limits ------------------------------------------------------------------
  const own = await api("newcoach", "create-team", { team_name: "Newcoach Rec Team", heard_from: "friend_or_coach" });
  check("a club team doesn't use up a free coach's own team", own.status === 200, JSON.stringify(own.body));
  if (own.body.org_id) await sql(`delete from teams where id='${own.body.team_id}'; delete from organizations where id='${own.body.org_id}'`);
} finally {
  const orgs = [orgId, indieOrg].filter(Boolean).map((o) => `'${o}'`).join(",");
  if (orgs) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id in (${orgs})));
    delete from notifications where team_id in (select id from teams where org_id in (${orgs}));
    delete from messages where thread_id in (select id from message_threads where team_id in (select id from teams where org_id in (${orgs})));
    delete from message_threads where team_id in (select id from teams where org_id in (${orgs}));
    delete from teams where org_id in (${orgs}); delete from user_roles where org_id in (${orgs}); delete from organizations where id in (${orgs});`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}

// Core everyday flows, live (regression suite "live-core", docs/TESTING.md): announcements, RSVPs,
// dues and team members, end to end as a coach and two parents would use them. Behavior, not just
// permissions (the security probe covers those). Throwaway accounts, all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/core_flows_live_check.mjs
import { randomUUID } from "node:crypto";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${String(detail).slice(0, 300)}`}`); };
const stamp = Date.now(), users = {}, orgs = [];
async function makeUser(role) {
  const email = `qa+core-${role}-${stamp}@teamclubhq.com`, password = `Qa!${randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, jwt: s.access_token };
}
async function api(role, action, params = {}) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function rest(role, path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}` } });
  return r.json();
}
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const settle = () => new Promise((s) => setTimeout(s, 2000)); // notifications fan out in the background

try {
  for (const r of ["coach", "mom", "dad"]) { await makeUser(r); await api(r, "update-profile", { full_name: `Core ${r}` }); }
  const team = (await api("coach", "create-team", { team_name: `QA Core ${stamp}` })).body;
  orgs.push(team.org_id);
  const code = (await api("coach", "create-invite", { team_id: team.team_id })).body.token;
  const child = (who, first) => api(who, "claim-invite", { token: code, child: { first_name: first, last_name: `Core${stamp}`, parent_relationship: "mother", contacts: [{ relationship: "mother", phone: "5555550111" }] } });
  const ava = (await child("mom", "Ava")).body, ben = (await child("dad", "Ben")).body;
  check("two families joined with the team code", !!ava?.player_id && !!ben?.player_id, JSON.stringify({ ava, ben }));

  // ----- Announcements ---------------------------------------------------------------------
  const ann = await api("coach", "create-announcement", { team_id: team.team_id, title: "Picture day", body: "Wear home jerseys Saturday." });
  check("the coach posts an announcement", ann.status === 200 && !!ann.body?.id, JSON.stringify(ann.body));
  const momAnn = await rest("mom", `announcements?team_id=eq.${team.team_id}&select=title,body`);
  check("parents see it", momAnn.length === 1 && momAnn[0].title === "Picture day", JSON.stringify(momAnn));
  await settle();
  const momInbox = (await api("mom", "inbox")).body?.items ?? [];
  check("…and get it in their inbox", momInbox.some((i) => i.kind === "announcement" && i.subject === "Picture day"), JSON.stringify(momInbox.map((i) => i.subject)));
  const coachInbox = (await api("coach", "inbox")).body?.items ?? [];
  check("the coach isn't notified of their own announcement", !coachInbox.some((i) => i.subject === "Picture day"));

  // ----- RSVPs -------------------------------------------------------------------------------
  const ev = (await api("coach", "save-event", { team_id: team.team_id, title: "Practice", event_type: "practice", starts_at: iso(3 * 86400000), ends_at: iso(3 * 86400000 + 5400000), location: "Gym" })).body.event_ids[0];
  const rsvp = await api("mom", "set-rsvp", { event_id: ev, player_id: ava.player_id, status: "yes", note: "Running late" });
  check("a parent RSVPs Going for their child", rsvp.status === 200, JSON.stringify(rsvp.body));
  const change = await api("mom", "set-rsvp", { event_id: ev, player_id: ava.player_id, status: "maybe" });
  const rows = await rest("coach", `rsvps?event_id=eq.${ev}&select=player_id,status`);
  check("changing the answer updates it (one RSVP per child)", change.status === 200 && rows.length === 1 && rows[0].status === "maybe", JSON.stringify(rows));
  const otherKid = await api("mom", "set-rsvp", { event_id: ev, player_id: ben.player_id, status: "no" });
  check("a parent can't RSVP for another family's child", otherKid.status === 403, `status ${otherKid.status}`);
  const coachFor = await api("coach", "set-rsvp", { event_id: ev, player_id: ben.player_id, status: "yes" });
  check("the coach can RSVP for a player", coachFor.status === 200, JSON.stringify(coachFor.body));
  await api("coach", "cancel-event", { event_id: ev });
  const afterCancel = await api("mom", "set-rsvp", { event_id: ev, player_id: ava.player_id, status: "yes" });
  check("RSVPs to a cancelled event are refused", afterCancel.status === 409, `status ${afterCancel.status}`);

  // ----- Dues ----------------------------------------------------------------------------------
  const dues = await api("coach", "create-dues", { team_id: team.team_id, title: "Season fee", amount_cents: 15000, due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) });
  check("the coach requests dues from every player", dues.status === 200 && !!dues.body?.request_id, JSON.stringify(dues.body));
  const coachDues = (await api("coach", "list-dues", { team_id: team.team_id })).body;
  const req = coachDues?.requests?.find((r) => r.id === dues.body?.request_id);
  check("the coach sees one line per player", req?.items?.length === 2, JSON.stringify(req?.items));
  const momDues = (await api("mom", "list-dues", { team_id: team.team_id })).body;
  const momReq = momDues?.requests?.find((r) => r.id === dues.body?.request_id);
  check("a parent sees only their own child's line", momReq?.items?.length === 1 && momReq.items[0].player_id === ava.player_id, JSON.stringify(momReq?.items));
  const avaItem = req?.items?.find((i) => i.player_id === ava.player_id);
  const paid = await api("coach", "set-dues-status", { item_id: avaItem?.id, status: "paid" });
  const after = (await api("coach", "list-dues", { team_id: team.team_id })).body.requests.find((r) => r.id === dues.body.request_id);
  check("the coach marks a Venmo/cash payment as paid", paid.status === 200 && after.items.find((i) => i.player_id === ava.player_id)?.status === "paid", JSON.stringify(after.items));
  const momMark = await api("mom", "set-dues-status", { item_id: avaItem?.id, status: "waived" });
  check("a parent can't mark their own dues paid or waived", momMark.status === 403, `status ${momMark.status}`);
  const remind = await api("coach", "remind-unpaid", { request_id: dues.body.request_id });
  check("one-tap reminders stay a Coach Pro feature", remind.status === 402, `status ${remind.status}`);
  const handles = await api("coach", "update-team", { team_id: team.team_id, venmo_username: "@qa-core-team", cashapp_cashtag: "$QACore" });
  const ctx = (await api("mom", "context")).body.teams.find((t) => t.id === team.team_id);
  check("Venmo and Cash App handles reach families", handles.status === 200 && ctx?.venmo_username === "qa-core-team" && ctx?.cashapp_cashtag === "QACore", JSON.stringify({ v: ctx?.venmo_username, c: ctx?.cashapp_cashtag }));

  // ----- Team members ------------------------------------------------------------------------
  const members = (await api("dad", "team-members", { team_id: team.team_id })).body?.members ?? [];
  check("team members lists the coach and both families", members.length === 3 && members.some((m) => m.roles.includes("head_coach")), JSON.stringify(members.map((m) => [m.name, m.roles])));
} finally {
  const list = orgs.filter(Boolean).map((o) => `'${o}'`).join(",");
  if (list) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id in (${list})));
    delete from notifications where team_id in (select id from teams where org_id in (${list}));
    delete from teams where org_id in (${list}); delete from user_roles where org_id in (${list}); delete from organizations where id in (${list});`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids}); delete from user_roles where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}

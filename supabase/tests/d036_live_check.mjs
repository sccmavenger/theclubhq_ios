// Live end-to-end check for D-036 (chat photos, calendar feed, season-long team codes).
// Creates throwaway users and a team in production, exercises the API, then deletes it all.
//
// Run from the repo root:  set -a; source .env.local; set +a; node supabase/tests/d036_live_check.mjs
import { readFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
})).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const ANON = keys.find((k) => k.name === "anon").api_key;

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}

const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const stamp = Date.now();
const users = {};
async function makeUser(role) {
  const email = `qa+d036-${role}-${stamp}@teamclubhq.com`;
  const password = `Qa!${crypto.randomUUID()}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `QA ${role}` } }),
  })).json();
  const session = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json();
  users[role] = { id: created.id, jwt: session.access_token };
}
async function api(role, action, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return { status: res.status, body: await res.json() };
}

let teamId, orgId;
try {
  await Promise.all(["coach", "parent", "outsider"].map(makeUser));
  await api("coach", "update-profile", { full_name: "QA Coach" });

  const team = await api("coach", "create-team", { team_name: `QA D036 ${stamp}`, sport: "basketball" });
  teamId = team.body.team_id;
  orgId = team.body.org_id;
  check("coach creates team", !!teamId, JSON.stringify(team.body));

  // ---- Season-long team code + reset --------------------------------------------------
  const inv1 = await api("coach", "create-invite", { team_id: teamId });
  const days = (new Date(inv1.body.expires_at) - Date.now()) / 86_400_000;
  check("team code lasts ~a year", days > 364 && days < 366, `${days.toFixed(1)} days`);
  const inv2 = await api("coach", "create-invite", { team_id: teamId });
  check("reopening returns the same code", inv2.body.token === inv1.body.token);
  const parentReset = await api("parent", "reset-invite", { team_id: teamId });
  check("non-coach can't reset the code", parentReset.status === 403, `${parentReset.status}`);
  const reset = await api("coach", "reset-invite", { team_id: teamId });
  check("reset issues a new code", reset.status === 200 && reset.body.token && reset.body.token !== inv1.body.token);
  const oldLookup = await api("parent", "lookup-invite", { token: inv1.body.token });
  check("old code stops working after reset", oldLookup.body.valid === false, JSON.stringify(oldLookup.body));
  const inv3 = await api("coach", "create-invite", { team_id: teamId });
  check("after reset, invite screen shows the new code", inv3.body.token === reset.body.token);

  const claim = await api("parent", "claim-invite", {
    token: reset.body.token,
    child: { first_name: "Quinn", last_name: "Testkid", parent_relationship: "mother", contacts: [{ relationship: "mother", phone: "5555550100" }] },
  });
  check("parent joins with the new code", claim.status === 200, JSON.stringify(claim.body));

  // ---- Calendar feed ------------------------------------------------------------------
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(23, 0, 0, 0);
  const saved = await api("coach", "save-event", {
    team_id: teamId, title: "Practice", event_type: "practice", starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(), location: "Lincoln Gym, Court 2", repeat_weeks: 1,
    notes: "Bring both jerseys; water, too.",
  });
  const game = await api("coach", "save-event", {
    team_id: teamId, title: "Game", event_type: "game", opponent: "Rockets", home_away: "away",
    starts_at: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
  });
  await api("coach", "cancel-event", { event_id: saved.body.event_ids[1] });
  check("coach adds events", saved.body.event_ids?.length === 2 && game.body.event_ids?.length === 1);

  const feed = await api("parent", "calendar-feed");
  check("parent gets a feed URL", typeof feed.body.url === "string" && feed.body.url.includes("/functions/v1/calendar-feed/"), JSON.stringify(feed.body));
  const feedAgain = await api("parent", "calendar-feed");
  check("feed URL is stable", feedAgain.body.url === feed.body.url);
  const res = await fetch(feed.body.url); // no headers at all, like a calendar app
  const ics = await res.text();
  check("feed serves without auth headers", res.status === 200, `${res.status} ${ics.slice(0, 120)}`);
  check("feed is text/calendar", (res.headers.get("content-type") ?? "").startsWith("text/calendar"), res.headers.get("content-type"));
  check("feed has 3 events", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 3);
  check("cancelled event is marked", ics.includes("STATUS:CANCELLED") && ics.includes("SUMMARY:Cancelled: Practice"));
  check("away game title", ics.includes("SUMMARY:@ Rockets"));
  check("text is escaped", ics.includes("LOCATION:Lincoln Gym\\, Court 2") && ics.includes("Bring both jerseys\\; water\\, too."));
  check("lines use CRLF", ics.includes("\r\n") && !ics.replace(/\r\n/g, "").includes("\n"));
  check("no line over 75 octets", ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  check("no child names in the feed", !ics.includes("Quinn") && !ics.includes("Testkid"));
  check("coach feed also works", (await (await fetch((await api("coach", "calendar-feed")).body.url)).text()).includes("BEGIN:VEVENT"));
  const outsiderICS = await (await fetch((await api("outsider", "calendar-feed")).body.url)).text();
  check("outsider's feed has none of this team's events", !outsiderICS.includes("BEGIN:VEVENT"));
  const rotated = await api("parent", "reset-calendar-feed");
  check("reset gives a new URL", rotated.body.url && rotated.body.url !== feed.body.url);
  check("old feed URL returns 404", (await fetch(feed.body.url)).status === 404);
  check("new feed URL works", (await fetch(rotated.body.url)).status === 200);
  check("garbage token returns 404", (await fetch(`${SUPABASE_URL}/functions/v1/calendar-feed/nope.ics`)).status === 404);

  // ---- Chat photos --------------------------------------------------------------------
  const chat = await api("parent", "team-chat", { team_id: teamId });
  const threadId = chat.body.thread_id;
  const jpeg = readFileSync(new URL("./fixtures/chat-photo.jpg", import.meta.url));
  const upload = await api("parent", "create-photo-upload", { thread_id: threadId });
  check("parent gets a signed upload URL", upload.status === 200 && upload.body.upload_url && upload.body.path?.startsWith(`${teamId}/${threadId}/${users.parent.id}/`), JSON.stringify(upload.body));

  const early = await api("parent", "post-message", { thread_id: threadId, body: "", image_path: upload.body.path });
  check("can't post a photo before it's uploaded", early.status === 400, `${early.status}`);

  const put = await fetch(upload.body.upload_url, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: jpeg });
  check("PUT to the signed URL uploads", put.ok, `${put.status} ${await put.text()}`);

  const badType = await api("parent", "create-photo-upload", { thread_id: threadId });
  const png = await fetch(badType.body.upload_url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: jpeg });
  check("bucket rejects non-JPEG uploads", !png.ok, `${png.status}`);

  const outsiderUpload = await api("outsider", "create-photo-upload", { thread_id: threadId });
  check("outsider can't upload to the thread", outsiderUpload.status === 404 || outsiderUpload.status === 403, `${outsiderUpload.status}`);

  const coachSteal = await api("coach", "post-message", { thread_id: threadId, body: "", image_path: upload.body.path });
  check("someone else's photo path is refused", coachSteal.status === 400, `${coachSteal.status}`);

  const posted = await api("parent", "post-message", { thread_id: threadId, body: "", image_path: upload.body.path, image_width: 400, image_height: 400 });
  check("parent posts a photo-only message", posted.status === 200, JSON.stringify(posted.body));

  const list = await api("coach", "list-messages", { thread_id: threadId });
  const photoMsg = list.body.messages?.find((m) => m.id === posted.body.id);
  check("coach sees the photo with a signed URL", !!photoMsg?.image_url && photoMsg.image_width === 400, JSON.stringify(photoMsg));
  const img = await fetch(photoMsg.image_url);
  check("signed photo URL downloads the JPEG", img.ok && (img.headers.get("content-type") ?? "").includes("image/jpeg"), `${img.status} ${img.headers.get("content-type")}`);

  const threads = await api("coach", "list-threads", { team_id: teamId });
  check("thread preview says 📷 Photo", threads.body.threads?.find((t) => t.id === threadId)?.last_message === "📷 Photo");

  // Direct PostgREST insert pointing at another user's photo is blocked by the trigger.
  const direct = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${users.coach.jwt}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ thread_id: threadId, author_id: users.coach.id, body: "", image_path: upload.body.path }),
  });
  check("database blocks a forged image_path", !direct.ok, `${direct.status} ${await direct.text()}`);

  const textOnly = await api("parent", "post-message", { thread_id: threadId, body: "" });
  check("empty text without a photo is still rejected", textOnly.status === 400, `${textOnly.status}`);

  const del = await api("parent", "delete-message", { message_id: posted.body.id });
  check("author deletes the photo message", del.status === 200);
  // Check the bucket itself; a signed URL fetched moments ago may still be served from the CDN.
  const remaining = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select count(*)::int as n from storage.objects where bucket_id = 'chat-photos' and name = '${upload.body.path}'` }),
  }).then((r) => r.json());
  check("deleted photo file is removed from storage", remaining[0]?.n === 0, JSON.stringify(remaining));
  const fresh = await api("coach", "list-messages", { thread_id: threadId });
  const gone = fresh.body.messages?.find((m) => m.id === posted.body.id);
  check("deleted photo message has no image URL", gone?.is_deleted === true && gone.image_url === null, JSON.stringify(gone));
} finally {
  // ---- Cleanup --------------------------------------------------------------------------
  if (teamId) {
    const q = async (sql) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    }).then((r) => r.text());
    // Storage objects for this team (any thread), then the team and its org.
    const paths = JSON.parse(await q(`select name from storage.objects where bucket_id = 'chat-photos' and name like '${teamId}/%'`));
    if (Array.isArray(paths) && paths.length > 0) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/chat-photos`, {
        method: "DELETE", headers: adminHeaders, body: JSON.stringify({ prefixes: paths.map((p) => p.name) }),
      });
    }
    console.log("cleanup:", await q(`
      delete from public.notification_sends where notification_id in (select id from public.notifications where team_id = '${teamId}');
      delete from public.notifications where team_id = '${teamId}';
      delete from public.teams where id = '${teamId}';
      delete from public.organizations where id = '${orgId}';`));
  }
  for (const u of Object.values(users)) {
    if (u.id) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.join("\n"));
    process.exitCode = 1;
  }
}

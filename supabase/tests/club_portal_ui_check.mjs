// UI check for the club portal (D-053) in Chromium, against production data with throwaway
// accounts: sign-in gate (non-director, pending club, director), every screen, adding teams from
// a pasted list, a club message, a club event and its edit, inviting a director, no console errors.
//   set -a; source .env.local; set +a
//   PORTAL_URL=https://teamclubhq.com/club/ PW_CORE=/tmp/pw/node_modules/playwright-core node supabase/tests/club_portal_ui_check.mjs
// Local: serve site/ (e.g. `npx -y http-server site -p 8788 -c-1`) and use PORTAL_URL=http://localhost:8788/club/
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// playwright-core drives the installed Chrome; it's fetched into /tmp/pw on first run.
function loadPlaywright() {
  for (const p of [process.env.PW_CORE, "/tmp/pw/node_modules/playwright-core", "playwright-core"].filter(Boolean)) {
    try { return require(p); } catch { /* try the next */ }
  }
  require("node:child_process").execSync("npm i --silent --prefix /tmp/pw playwright-core", { stdio: "inherit" });
  return require("/tmp/pw/node_modules/playwright-core");
}
const { chromium } = loadPlaywright();
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const PORTAL = process.env.PORTAL_URL ?? "https://teamclubhq.com/club/";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/club-portal-shots";
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
async function makeUser(role) {
  const email = `qa+cpui-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `QA ${role}` } }) })).json();
  await sql(`update profiles set full_name='QA ${role}' where id='${u.id}'`);
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, password, jwt: s.access_token };
}
const api = async (role, action, params = {}) => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  return r.json();
};

let orgId, pendingOrg, browser;
const consoleErrors = [];
try {
  for (const r of ["director", "pendingdir", "parent"]) await makeUser(r);
  orgId = (await api("director", "create-club", { name: `QA Portal UI ${stamp}`, time_zone: "America/Chicago" })).org_id;
  await sql(`update organizations set club_approved_at = now() where id = '${orgId}'`);
  pendingOrg = (await api("pendingdir", "create-club", { name: `QA Pending ${stamp}` })).org_id;
  const created = (await api("director", "club-create-teams", { org_id: orgId, teams: [
    { name: "8th Boys Elite", grade: "8", gender: "boys", level: "Elite", season: "Fall 2026" },
    { name: "7th Girls Gold", grade: "7", gender: "girls", level: "Gold", season: "Fall 2026", coach_email: `qa+cpui-coach-${stamp}@teamclubhq.com` },
  ] })).teams;
  const boysId = created[0].team_id;
  await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${boysId}', 'Ava', 'QA', '${users.director.id}'), ('${boysId}', 'Ben', 'QA', '${users.director.id}')`);
  await api("director", "save-event", { team_id: boysId, title: "Game", event_type: "game", opponent: "Rise", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), time_zone: "America/Chicago" });

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  // Failed requests are checked by URL below (the wrong-password attempt is expected to fail).
  // Cloudflare injects its analytics beacon on the live site; the portal's CSP blocks it on purpose.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|cloudflareinsights/.test(m.text())) consoleErrors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !(r.url().includes("grant_type=password") && r.status() === 400)) consoleErrors.push(`${r.status()} ${r.url()}`); });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  await (await import("node:fs/promises")).mkdir(SHOTS, { recursive: true });
  const signIn = async (who) => {
    await page.goto(PORTAL);
    await page.fill("#email", users[who].email);
    await page.fill("#password", users[who].password);
    await page.click("button[type=submit]");
  };
  const signOut = async () => {
    await page.click("[data-signout]");
    await page.waitForSelector("#password");
  };

  // ----- Gate ------------------------------------------------------------------------------
  await page.goto(PORTAL);
  await page.fill("#email", users.director.email);
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-error]:not([hidden])");
  check("a wrong password says so in plain words", /don't match/.test(await page.textContent("[data-error]")));
  await signIn("parent");
  await page.waitForSelector("text=This portal is for club directors");
  check("a non-director is told the portal is for directors", true);
  await signOut();
  await signIn("pendingdir");
  await page.waitForSelector("text=is waiting for approval");
  check("a director of a pending club sees the waiting screen", true);
  await signOut();

  // ----- Overview ---------------------------------------------------------------------------
  await signIn("director");
  await page.waitForSelector("text=Needs your attention");
  const ovText = await page.textContent("#view");
  check("overview shows the club and its totals", ovText.includes(`QA Portal UI ${stamp}`) && /Teams/.test(ovText) && /Families joined/.test(ovText));
  check("overview flags the team with no coach", /1 team has no coach/.test(ovText), ovText.slice(0, 400));
  check("overview flags few families joined", /fewer than half the families/.test(ovText));
  check("this week lists the game", /vs Rise/.test(ovText));
  await shot("1-overview");

  // ----- Teams -------------------------------------------------------------------------------
  await page.click("nav >> text=Teams");
  await page.waitForSelector("table.teams");
  check("teams table groups by grade", (await page.textContent("table.teams")).includes("8th Grade") && (await page.textContent("table.teams")).includes("7th Grade"));
  await page.selectOption("[data-f=status]", "no-coach");
  check("status filter: no coach", (await page.$$("table.teams [data-pick]")).length === 1);
  await page.selectOption("[data-f=status]", "");
  await page.check("[data-pick-all]");
  check("selecting teams shows bulk actions", await page.isVisible("[data-bulk]") && /2 teams selected/.test(await page.textContent("[data-count]")));
  await shot("2-teams");

  // ----- Team page --------------------------------------------------------------------------
  await page.goto(`${PORTAL}#/teams/${boysId}`);
  await page.waitForSelector("text=Families join with the team code");
  const tp = await page.textContent("#view");
  check("team page: roster with family status", /Ava QA/.test(tp) && /Not joined/.test(tp));
  check("team page: coming up with RSVP columns", /vs Rise/.test(tp) && /No answer/.test(tp));
  await page.click("[data-show-code]");
  await page.waitForSelector("[data-family-code] .code");
  check("team page: shows the family join code and link", /teamclubhq\.com\/join\//.test(await page.textContent("[data-family-code]")));
  await page.click("[data-invite]");
  await page.fill("dialog #f-email", `qa+cpui-newcoach-${stamp}@teamclubhq.com`);
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog .code");
  check("inviting a coach shows a one-time code to send", /^[A-Z0-9]{10}$/.test((await page.textContent("dialog .code")).trim()));
  await shot("3-team-invite");
  await page.click("dialog [data-cancel]");
  await page.waitForSelector("text=Invited");

  // ----- Add teams from a pasted list ----------------------------------------------------------
  await page.click("nav >> text=Add teams");
  await page.fill("[data-paste]", "Team,Grade,Gender,Level,Season,Coach email\n6th Boys Gold,6th,B,Gold,Fall 2026,coach@bad\n6th Girls Select,6,Girls,Select,Fall 2026,\n8th Boys Elite,8,Boys,Elite,Fall 2026,");
  await page.dispatchEvent("[data-paste]", "input");
  const pv = await page.textContent("[data-preview]");
  check("the check flags a bad email and an existing team", /isn't an email/.test(pv) && /already exists/.test(pv) && /1 team ready/.test(pv), pv);
  await shot("4-add-teams");
  await page.click("[data-create]");
  await page.waitForSelector("[data-results]:not([hidden])");
  const made = await sql(`select count(*)::int n from teams where org_id='${orgId}' and name='6th Girls Select' and grade='6' and gender='girls'`);
  check("creating adds only the ready team, normalized", made[0].n === 1, JSON.stringify(made));

  // ----- Message ---------------------------------------------------------------------------------
  await page.click("nav >> text=Messages");
  await page.waitForSelector("[data-reach]:has-text('Reaches')");
  await page.click("label.chip-check:has-text('8th')");
  await page.waitForFunction(() => /Reaches 1 team/.test(document.querySelector("[data-reach]").textContent));
  check("picking 8th narrows the audience to 1 team", true);
  await page.fill("#m-title", "Picture Day");
  await page.fill("#m-body", "Sunday at the gym.");
  check("the preview shows what families see", /QA Portal UI .*: Picture Day/.test(await page.textContent("[data-pv-title]")));
  await shot("5-message");
  await page.click("[data-compose] button[type=submit]");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("details.sent:has-text('Picture Day')");
  const ann = await sql(`select count(*)::int n from announcements where team_id='${boysId}' and title='Picture Day' and from_club is not null`);
  check("sending posts it on the team, labeled with the club, and lists it under Sent", ann[0].n === 1);

  // ----- Club event and edit ----------------------------------------------------------------------
  await page.goto(`${PORTAL}#/events?new=1`);
  await page.waitForSelector("[data-reach]:has-text('Reaches')");
  await page.fill("#e-title", "Winter tryouts");
  await page.fill("#e-start", "2026-12-05T10:00");
  await page.fill("#e-loc", "Academy gym");
  await page.click("[data-new] button[type=submit]");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("text=Winter tryouts");
  await page.click("[data-edit-ev]");
  await page.fill("dialog #f-location", "Main gym");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("text=Main gym");
  const evs = await sql(`select count(*)::int n from events e join teams t on t.id=e.team_id where t.org_id='${orgId}' and e.title='Winter tryouts' and e.location='Main gym'`);
  check("a club event is added to every team and editing changes them all", evs[0].n === 3, JSON.stringify(evs));
  await shot("6-events");

  // ----- Settings: invite a director ------------------------------------------------------------------
  await page.click("nav >> text=Club settings");
  await page.waitForSelector("text=Directors");
  await page.click("[data-invite-dir]");
  await page.fill("dialog #f-email", `qa+cpui-dir2-${stamp}@teamclubhq.com`);
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog .code");
  check("adding a director gives a one-time director code", /^[A-Z0-9]{10}$/.test((await page.textContent("dialog .code")).trim()));
  await page.click("dialog [data-cancel]");
  await page.waitForSelector(`text=qa+cpui-dir2-${stamp}@teamclubhq.com`);
  await shot("7-settings");
  await page.click("nav >> text=Overview");
  await page.waitForSelector(".bar i", { state: "attached" });
  check("family bars are drawn (no inline styles under the CSP)", await page.evaluate(() => [...document.querySelectorAll(".bar i")].every((i) => i.style.width.endsWith("%"))));
  await page.click("nav >> text=Club settings");
  await page.waitForSelector("text=Directors");
  check("no contact export anywhere", !(await page.$("text=/Export/i")));

  // ----- Narrow screen -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("nav >> text=Overview");
  await page.waitForSelector("text=Needs your attention");
  await shot("8-phone");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) console.log("wide:", await page.evaluate(() => [...document.querySelectorAll("#view *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2 && !el.closest(".table-wrap")).slice(0, 6).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().right)}`).join(" | ")));
  check("fits a phone screen without sideways scrolling", overflow <= 2, `overflow ${overflow}px`);

  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} catch (e) {
  check("ran to the end", false, e.message);
} finally {
  await browser?.close();
  const orgs = [orgId, pendingOrg].filter(Boolean).map((o) => `'${o}'`).join(",");
  if (orgs) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id in (${orgs})));
    delete from notifications where team_id in (select id from teams where org_id in (${orgs}));
    delete from teams where org_id in (${orgs}); delete from user_roles where org_id in (${orgs});
    delete from audit_logs where target_id in (${orgs}); delete from organizations where id in (${orgs});`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids}); delete from audit_logs where actor_user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}

// Browser check of the admin portal (D-041): sign-in code, TOTP enrollment, every screen,
// and one moderation action, with throwaway QA accounts that are deleted at the end.
//   set -a; source .env.local; set +a
//   PORTAL_URL=http://localhost:8787 PW_CORE=/tmp/pw/node_modules/playwright-core node supabase/tests/admin_portal_ui_check.mjs
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "playwright-core");

const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const PORTAL = process.env.PORTAL_URL ?? "http://localhost:8787";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/admin-shots";
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN) throw new Error("source .env.local first");
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const ANON = keys.find((k) => k.name === "anon").api_key;
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
}).then((r) => r.json());

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  ok ? passed++ : failures.push(`${name} ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
function totp(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const stamp = Date.now();
const users = {};
async function makeUser(role) {
  const email = `qa+ui-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: created.id, email, jwt: s.access_token };
}
const api = async (role, action, params = {}) => (await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
  method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }),
})).json();

let team, browser;
const consoleErrors = [];
try {
  await Promise.all(["admin", "coach", "family"].map(makeUser));
  team = await api("coach", "create-team", { team_name: `QA UI ${stamp}` });
  const token = (await api("coach", "create-invite", { team_id: team.team_id })).token;
  await api("family", "claim-invite", { token, child: { first_name: "Jordan", last_name: `UI${stamp}`, parent_relationship: "father", contacts: [{ relationship: "father", phone: "5555550188" }] } });
  const thread = (await api("coach", "team-chat", { team_id: team.team_id })).thread_id;
  const msg = await api("coach", "post-message", { thread_id: thread, body: "UI check message" });
  await api("family", "report-content", { message_id: msg.id, reason: "spam", note: "UI check report" });
  await sql(`insert into platform_admins (email, role) values ('${users.admin.email}', 'owner')`);

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(PORTAL);
  await page.fill("#email", users.admin.email);
  await page.click("button[type=submit]");
  await page.waitForSelector("#code");
  check("sign-in asks for the emailed code", true);
  const link = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ type: "magiclink", email: users.admin.email }) })).json();
  await page.fill("#code", link.email_otp ?? link.properties?.email_otp);
  await page.click("button[type=submit]");
  await page.waitForSelector("#enroll-form");
  check("first sign-in requires authenticator setup", await page.isVisible("img.qr"));
  await page.screenshot({ path: `${SHOTS}/0-enroll.png` });
  await page.click("details summary");
  const secret = (await page.textContent("code.secret")).trim();
  await page.fill("#totp", totp(secret));
  await page.click("button[type=submit]");
  await page.waitForSelector(".topbar");
  check("after MFA the portal opens", await page.isVisible("text=Overview"));

  const screens = [["#/", "1-overview", "h1:has-text('Overview')"], ["#/teams", "2-teams", "h1:has-text('Teams')"], [`#/teams/${team.team_id}`, "3-team", `h1:has-text('QA UI ${stamp}')`],
    ["#/people", "4-people", "h1:has-text('People')"], [`#/people/${users.family.id}`, "5-person", ".actions"], [`#/people/${users.family.id}/view`, "6-viewas", "h1:has-text('What')"],
    ["#/moderation", "7-moderation", "h1:has-text('Moderation')"], ["#/grants", "8-grants", "h1:has-text('Pro grants')"], ["#/revenue", "9-revenue", "h1:has-text('Revenue')"],
    ["#/broadcast", "10-broadcast", "h1:has-text('Broadcast')"], ["#/audit", "11-audit", "h1:has-text('Audit log')"], ["#/settings", "12-settings", "h1:has-text('Settings')"]];
  for (const [hash, name, selector] of screens) {
    await page.evaluate((h) => (location.hash = h), hash);
    const ok = await page.waitForSelector(selector, { timeout: 15000 }).then(() => true).catch(() => false);
    const error = await page.$(".view > p.error");
    check(`screen ${hash} renders`, ok && !error, error ? await error.textContent() : "");
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }

  await page.evaluate(() => (location.hash = "#/teams"));
  await page.waitForSelector("tbody tr");
  await page.fill("#team-search", `qa ui ${stamp}`);
  await page.uncheck("#team-internal");
  const visible = await page.$$eval("tbody tr", (rows) => rows.filter((r) => !r.hidden).length);
  check("team search filters the list", visible === 1, `${visible} rows`);

  await page.evaluate(() => (location.hash = "#/moderation"));
  await page.waitForSelector("text=UI check message");
  check("moderation shows the reported snapshot", true);
  const card = page.locator("article.report", { hasText: "UI check message" });
  await card.locator("[data-resolve=dismissed]").click();
  await page.fill("dialog textarea[name=note]", "UI check dismissal");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector(".toast:has-text('Report resolved')");
  const status = (await sql(`select status from content_reports where team_id='${team.team_id}'`))[0]?.status;
  check("dismissing from the portal resolves the report", status === "dismissed", status);

  await page.evaluate((id) => (location.hash = `#/people/${id}`), users.family.id);
  await page.waitForSelector("#suspend");
  await page.click("#suspend");
  await page.fill("dialog textarea[name=reason]", "UI check");
  const submitDisabled = await page.isDisabled("dialog button[type=submit]");
  await page.fill("dialog input[name=__confirm]", users.family.email);
  const submitEnabled = !(await page.isDisabled("dialog button[type=submit]"));
  check("destructive actions need the typed confirmation", submitDisabled && submitEnabled);
  await page.click("dialog [data-cancel]");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (location.hash = "#/"));
  await page.waitForSelector(".hero");
  await page.screenshot({ path: `${SHOTS}/13-phone-overview.png`, fullPage: true });
  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser?.close();
  if (team?.team_id) {
    await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id='${team.team_id}');
      delete from notifications where team_id='${team.team_id}'; delete from content_reports where team_id='${team.team_id}';
      delete from teams where id='${team.team_id}'; delete from organizations where id='${team.org_id}';`);
  }
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from audit_logs where actor_user_id in (${ids}) or target_id in (${ids}); delete from platform_admins where email like 'qa+ui-%';`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}

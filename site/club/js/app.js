// ClubHQ Club Portal (D-053, docs/CLUB_PORTAL.md). A director signs in with their ClubHQ login
// and runs every team in the club. Everything goes through the app's own mobile-api club actions,
// so the portal can never do more than the director could in the app. No chat, no contact
// exports (D-053).
import * as api from "./api.js?v=1";
import { esc, html, raw, num, money, pct, dateTime, day, daysSince, plural, gradeLabel, gradeSection, cap, groupingLine, badge, toast, copy, dialog, run, localInput } from "./ui.js?v=1";

const app = document.getElementById("app");
const CLUB_KEY = "clubhq-club-selected";
let me = null;        // my-clubs
let club = null;      // the selected club summary
let overview = null;  // club-overview for the selected club

// ----- Boot and routing ------------------------------------------------------------------
window.addEventListener("hashchange", route);
boot();

async function boot() {
  if (!api.hasSession()) return renderSignIn();
  try {
    me = await api.act("my-clubs");
  } catch (e) {
    if (e.status === 401) return renderSignIn();
    return renderFatal(e.message);
  }
  const active = me.clubs.filter((c) => !c.pending);
  if (me.clubs.length === 0) return renderNotDirector();
  if (active.length === 0) return renderPending(me.clubs[0]);
  club = active.find((c) => c.id === localStorage.getItem(CLUB_KEY)) ?? active[0];
  localStorage.setItem(CLUB_KEY, club.id);
  route();
}

function parseHash() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

async function route() {
  if (!club) return;
  const { parts, params } = parseHash();
  const page = parts[0] ?? "";
  shell(page);
  const view = document.getElementById("view");
  view.innerHTML = '<p class="muted loading">Loading…</p>';
  try {
    if (page === "teams" && parts[1]) await teamPage(view, parts[1]);
    else if (page === "teams") await teamsPage(view, params);
    else if (page === "messages") await messagesPage(view, params);
    else if (page === "events") await eventsPage(view, params);
    else if (page === "add-teams") await addTeamsPage(view);
    else if (page === "settings") await settingsPage(view);
    else await overviewPage(view);
    sizeBars(view);
  } catch (e) {
    if (e.status === 401) return renderSignIn();
    view.innerHTML = html`<div class="card"><h2>Couldn't load this page</h2><p class="error">${e.message}</p><button class="btn" data-reload>Try again</button></div>`;
    view.querySelector("[data-reload]").onclick = route;
  }
  view.focus();
}

/** Bar widths are set from script: the portal's CSP allows no inline style attributes. */
function sizeBars(root) {
  root.querySelectorAll("[data-w]").forEach((el) => (el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w)))}%`));
}

async function loadOverview() {
  overview = await api.act("club-overview", { org_id: club.id });
  return overview;
}

// ----- Shell -------------------------------------------------------------------------------
const NAV = [
  ["", "Overview"], ["teams", "Teams"], ["messages", "Messages"], ["events", "Club events"], ["add-teams", "Add teams"], ["settings", "Club settings"],
];

function shell(page) {
  const active = me.clubs.filter((c) => !c.pending);
  const picker = active.length > 1
    ? html`<select class="club-picker" aria-label="Club">${raw(active.map((c) => html`<option value="${c.id}" ${raw(c.id === club.id ? "selected" : "")}>${c.name}</option>`).join(""))}</select>`
    : html`<b class="club-name">${club.name}</b>`;
  app.innerHTML = html`<div class="shell">
    <aside class="side">
      <a class="brand" href="#/"><img src="/icon-192.png" width="30" height="30" alt=""> <span>ClubHQ <small>Club portal</small></span></a>
      <div class="club-box">${raw(picker)}<small>Director</small></div>
      <nav aria-label="Club">${raw(NAV.map(([href, label]) => html`<a href="#/${href}" ${raw(page === href ? 'aria-current="page"' : "")}>${label}</a>`).join(""))}</nav>
      <div class="side-foot">
        <span>${me.full_name || me.email}</span>
        <button class="btn-link" data-signout>Sign out</button>
        <p class="muted small">Team chat and everything else is in the ClubHQ app.</p>
      </div>
    </aside>
    <main id="view" class="view" tabindex="-1"></main>
  </div>`;
  app.querySelector("[data-signout]").onclick = async () => {
    await api.signOut();
    localStorage.removeItem(CLUB_KEY);
    location.hash = "";
    renderSignIn();
  };
  app.querySelector(".club-picker")?.addEventListener("change", (e) => {
    club = active.find((c) => c.id === e.target.value);
    localStorage.setItem(CLUB_KEY, club.id);
    location.hash = "#/";
    route();
  });
}

// ----- Sign-in -----------------------------------------------------------------------------
function authCard(inner) {
  app.innerHTML = html`<div class="auth"><div class="card auth-card stack">
    <div class="brand-row"><img src="/icon-192.png" width="44" height="44" alt=""><div><strong>ClubHQ Club Portal</strong><div class="muted small">For club directors</div></div></div>
    ${raw(inner)}
  </div></div>`;
}

function renderSignIn(email = "") {
  authCard(html`<p class="muted small">Sign in with the same email and password you use in the ClubHQ app.</p>
    <form class="stack" data-form="password">
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${email}">
      <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <p class="error" data-error hidden></p>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <button class="btn-link" data-code>Signed up with Apple, or forgot your password? Email me a code</button>`);
  const form = app.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    const err = form.querySelector("[data-error]");
    err.hidden = true;
    btn.disabled = true;
    try {
      await api.signInWithPassword(form.elements.email.value.trim(), form.elements.password.value);
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
  app.querySelector("[data-code]").onclick = () => renderCodeRequest(form.elements.email.value.trim());
}

function renderCodeRequest(email = "") {
  authCard(html`<p class="muted small">We'll email a 6-digit code to the address on your ClubHQ account. If you use Sign in with Apple, that's the address Apple shares with us (it may be a private relay address that forwards to you).</p>
    <form class="stack">
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${email}">
      <p class="error" data-error hidden></p>
      <button class="btn btn-primary" type="submit">Email me a code</button>
    </form>
    <button class="btn-link" data-back>Use my password instead</button>`);
  const form = app.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]");
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api.sendCode(form.elements.email.value.trim());
      renderCodeEntry(form.elements.email.value.trim());
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
  app.querySelector("[data-back]").onclick = () => renderSignIn(form.elements.email.value.trim());
}

function renderCodeEntry(email) {
  authCard(html`<p>We sent a 6-digit code to <strong>${email}</strong>.</p>
    <form class="stack">
      <label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" required>
      <p class="error" data-error hidden></p>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <button class="btn-link" data-back>Use a different email</button>`);
  const form = app.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]");
    try {
      await api.verifyCode(email, form.elements.code.value.trim());
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  };
  app.querySelector("[data-back]").onclick = () => renderCodeRequest(email);
}

function signOutButton() {
  app.querySelector("[data-signout]").onclick = async () => {
    await api.signOut();
    renderSignIn();
  };
}

function renderNotDirector() {
  authCard(html`<h2>This portal is for club directors</h2>
    <p>${me.email} doesn't direct a club on ClubHQ. Coaches and families use the ClubHQ app for everything.</p>
    <p class="muted small">Starting a club? In the app, open More → Start a Club. Joining as a director? Ask your club's director for a director code, then enter it in More → Join a Club.</p>
    <div class="row"><a class="btn btn-primary" href="/download">Get the app</a><button class="btn" data-signout>Sign out</button></div>`);
  signOutButton();
}

function renderPending(c) {
  authCard(html`<h2>${c.name} is waiting for approval</h2>
    <p>We review new clubs before they go live, usually within a day. You'll get a notification in the app when it's on. Then you can manage it here.</p>
    <div class="row"><button class="btn btn-primary" data-again>Check again</button><button class="btn" data-signout>Sign out</button></div>`);
  app.querySelector("[data-again]").onclick = boot;
  signOutButton();
}

function renderFatal(message) {
  authCard(html`<h2>Something went wrong</h2><p class="error">${message}</p><div class="row"><button class="btn" data-again>Try again</button><button class="btn" data-signout>Sign out</button></div>`);
  app.querySelector("[data-again]").onclick = boot;
  signOutButton();
}

// ----- Health: what needs the director ------------------------------------------------------
const STALE_INVITE_DAYS = 3;
const QUIET_DAYS = 14;

function teamFlags(t) {
  const flags = [];
  if (t.coaches.length === 0 && t.pending_coaches.length === 0) flags.push(["no-coach", "No coach", "critical"]);
  else if (t.coaches.length === 0) flags.push(["invites", "Coach invited", "warning"]);
  if (t.pending_coaches.some((p) => daysSince(p.invited_at) > STALE_INVITE_DAYS)) flags.push(["stale", "Invite not accepted", "warning"]);
  if (t.roster_count === 0) flags.push(["no-players", "No players yet", "warning"]);
  else if (pct(t.linked_player_count, t.roster_count) < 50) flags.push(["families", "Few families joined", "critical"]);
  const nextIn = t.next_event ? (new Date(t.next_event.starts_at) - Date.now()) / 86_400_000 : Infinity;
  if (nextIn > QUIET_DAYS) flags.push(["quiet", `Nothing in ${QUIET_DAYS} days`, "warning"]);
  return flags;
}

function attention(ov) {
  const byFlag = (key) => ov.teams.filter((t) => teamFlags(t).some(([k]) => k === key));
  const names = (teams) => teams.slice(0, 4).map((t) => t.name).join(", ") + (teams.length > 4 ? ` and ${teams.length - 4} more` : "");
  const link = (teams, key) => (teams.length === 1 ? `#/teams/${teams[0].id}` : `#/teams?status=${key}`);
  const items = [];
  const add = (key, status, title, fix) => {
    const teams = byFlag(key);
    if (teams.length) items.push({ status, title: title(teams.length), detail: names(teams), href: link(teams, key), fix });
  };
  add("no-coach", "critical", (n) => `${plural(n, "team")} ${n === 1 ? "has" : "have"} no coach`, "Invite a coach");
  add("families", "critical", (n) => `${plural(n, "team")}: fewer than half the families have joined`, "Get the family code");
  add("stale", "warning", (n) => `${plural(n, "team")} with a coach invite not accepted after ${STALE_INVITE_DAYS} days`, "Resend");
  add("no-players", "warning", (n) => `${plural(n, "team")} ${n === 1 ? "has" : "have"} no players yet`, "Get the family code");
  add("quiet", "warning", (n) => `${plural(n, "team")} with nothing scheduled in the next ${QUIET_DAYS} days`, "Review");
  const soon = ov.week_events.filter((e) => new Date(e.starts_at) - Date.now() < 3 * 86_400_000 && e.roster_count > 0 && pct(e.rsvp_count, e.roster_count) < 50);
  if (soon.length) {
    items.push({ status: "warning", title: `${plural(soon.length, "event")} in the next 3 days with fewer than half the RSVPs in`,
      detail: soon.slice(0, 3).map((e) => `${e.team_name}: ${eventLabel(e)} ${day(e.starts_at)}`).join(" · "), href: `#/teams/${soon[0].team_id}`, fix: "Open" });
  }
  return items;
}

const eventLabel = (e) => (e.event_type === "game" && e.opponent ? `${e.home_away === "away" ? "@" : "vs"} ${e.opponent}` : e.title);

// ----- Overview ---------------------------------------------------------------------------------
async function overviewPage(view) {
  const ov = await loadOverview();
  const c = ov.club;
  const items = attention(ov);
  const headCoached = ov.teams.filter((t) => t.coaches.some((x) => x.role === "head_coach")).length;
  view.innerHTML = html`
    <div class="row between"><h1>${c.name}</h1>
      <div class="row"><a class="btn" href="#/events?new=1">Club event</a><a class="btn btn-primary" href="#/messages">Message families</a></div></div>
    <div class="tiles">
      ${raw(tile(num(ov.teams.length), "Teams", `${headCoached} with a head coach`, "#/teams"))}
      ${raw(tile(num(c.player_count), "Players", plural(c.family_count, "family", "families") + " on the app"))}
      ${raw(tile(c.player_count ? `${pct(c.linked_player_count, c.player_count)}%` : "—", "Families joined", `${num(c.linked_player_count)} of ${num(c.player_count)} players linked to a parent`))}
      ${raw(tile(c.week_rsvps.expected ? `${pct(c.week_rsvps.answered, c.week_rsvps.expected)}%` : "—", "RSVPs this week", c.week_rsvps.expected ? `${num(c.week_rsvps.answered)} of ${num(c.week_rsvps.expected)} answered` : "Nothing scheduled this week"))}
    </div>
    <div class="grid2">
      <section class="card"><h2>Needs your attention</h2>
        ${raw(items.length ? items.map((i) => html`<a class="alert" href="${i.href}">${raw(badge(i.status === "critical" ? "Now" : "Soon", i.status))}<div><b>${i.title}</b><small>${i.detail}</small></div><span class="btn btn-small">${i.fix}</span></a>`).join("")
          : html`<p class="muted">Nothing right now. Every team has a coach, families are joining and schedules are filled in.</p>`)}
      </section>
      <section class="card"><h2>This week</h2>
        ${raw(ov.week_events.length ? html`<table class="table"><tbody>${raw(ov.week_events.slice(0, 8).map((e) => html`<tr><td class="nowrap"><b>${dateTime(e.starts_at)}</b></td><td><a href="#/teams/${e.team_id}">${e.team_name}</a> · ${eventLabel(e)}${raw(e.club_event_id ? " " + badge("Club", "info") : "")}<br><span class="muted small">${e.location ?? ""}</span></td><td class="numcol">${e.rsvp_count}/${e.roster_count}</td></tr>`).join(""))}</tbody></table>
          ${raw(ov.week_events.length > 8 ? html`<p class="muted small">+ ${ov.week_events.length - 8} more this week</p>` : "")}`
          : html`<p class="muted">Nothing scheduled in the next 7 days.</p>`)}
      </section>
    </div>
    <section class="card"><div class="row between"><h2>Teams at a glance</h2><a href="#/teams">All teams</a></div>${raw(teamTable(ov.teams, false))}</section>`;
}

function tile(value, label, sub, href) {
  const inner = html`<div class="tile-value">${value}</div><div class="tile-label">${label}</div><div class="tile-sub muted">${sub}</div>`;
  return href ? html`<a class="card tile" href="${href}">${raw(inner)}</a>` : html`<div class="card tile">${raw(inner)}</div>`;
}

function teamTable(teams, selectable, selected = new Set()) {
  if (teams.length === 0) return html`<p class="muted">No teams match.</p>`;
  const groups = new Map();
  for (const t of [...teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const g = gradeSection(t.grade);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "Other teams" ? 1 : b === "Other teams" ? -1 : b.localeCompare(a, undefined, { numeric: true })));
  const cols = selectable ? 8 : 7;
  const rows = order.map((g) => html`<tr class="grp"><td colspan="${cols}">${g}</td></tr>${raw(groups.get(g).map((t) => {
    const head = t.coaches.filter((c) => c.role === "head_coach").map((c) => c.name).join(", ");
    const fam = pct(t.linked_player_count, t.roster_count);
    const flags = teamFlags(t).filter(([k]) => k !== "quiet");
    return html`<tr>
      ${raw(selectable ? html`<td><input type="checkbox" data-pick="${t.id}" aria-label="Select ${t.name}" ${raw(selected.has(t.id) ? "checked" : "")}></td>` : "")}
      <td><a href="#/teams/${t.id}"><b>${t.name}</b></a>${raw(groupingLine(t) ? html`<br><span class="tag">${groupingLine(t)}</span>` : "")}</td>
      <td>${raw(head ? esc(head) : t.pending_coaches.length ? badge("Invited", "warning") : badge("No coach", "critical"))}</td>
      <td class="numcol">${t.roster_count}</td>
      <td><span class="bar" aria-hidden="true"><i data-w="${fam}" class="${fam < 50 ? "low" : ""}"></i></span> ${t.roster_count ? `${fam}%` : "—"}</td>
      <td class="small">${raw(t.next_event ? html`${dateTime(t.next_event.starts_at)}<br><span class="muted">${eventLabel(t.next_event)}</span>` : badge("Nothing scheduled", "warning"))}</td>
      <td class="numcol">${t.next_event ? `${t.next_event.rsvp_count}/${t.roster_count}` : "—"}</td>
      <td>${raw(flags.map(([, label, s]) => badge(label, s)).join(" "))}</td>
    </tr>`;
  }).join(""))}`).join("");
  return html`<div class="table-wrap"><table class="table teams"><thead><tr>${raw(selectable ? '<th><input type="checkbox" data-pick-all aria-label="Select all"></th>' : "")}<th>Team</th><th>Head coach</th><th class="numcol">Players</th><th>Families joined</th><th>Next up</th><th class="numcol">RSVPs</th><th></th></tr></thead><tbody>${raw(rows)}</tbody></table></div>`;
}

// ----- Teams --------------------------------------------------------------------------------------
const STATUS_FILTERS = [["", "Any status"], ["no-coach", "No coach"], ["stale", "Invite not accepted"], ["families", "Few families joined"], ["no-players", "No players yet"], ["quiet", "Nothing scheduled"]];

async function teamsPage(view, params) {
  const ov = await loadOverview();
  const f = { q: "", grade: "", gender: "", level: "", season: "", status: params.get("status") ?? "" };
  const selected = new Set();
  const values = (key) => [...new Set(ov.teams.map((t) => t[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const select = (key, all, label = (v) => v) => html`<select data-f="${key}" aria-label="${all}"><option value="">${all}</option>${raw(values(key).map((v) => html`<option value="${v}">${label(v)}</option>`).join(""))}</select>`;
  view.innerHTML = html`<div class="row between"><h1>Teams <span class="muted small">${num(ov.teams.length)}</span></h1>
      <div class="row"><button class="btn" data-one>Add one team</button><a class="btn btn-primary" href="#/add-teams">Add teams from a list</a></div></div>
    <div class="row filters">
      <input type="search" data-f="q" placeholder="Search team or coach" aria-label="Search">
      ${raw(select("grade", "All grades", gradeLabel))}${raw(select("gender", "Boys and girls", cap))}${raw(select("level", "All levels"))}${raw(select("season", "All seasons"))}
      <select data-f="status" aria-label="Status">${raw(STATUS_FILTERS.map(([v, l]) => html`<option value="${v}" ${raw(v === f.status ? "selected" : "")}>${l}</option>`).join(""))}</select>
    </div>
    <div class="bulk" data-bulk hidden><b data-count></b>
      <button class="btn btn-small" data-bulk-msg>Message their families</button>
      <button class="btn btn-small" data-bulk-event>Add a club event</button>
      <button class="btn btn-small" data-bulk-edit>Set grade, level or season…</button>
      <span class="spacer"></span><button class="btn-link" data-bulk-clear>Clear</button></div>
    <div class="card" data-table></div>`;
  const tableBox = view.querySelector("[data-table]");
  const visible = () => ov.teams.filter((t) => {
    const q = f.q.toLowerCase();
    return (!q || t.name.toLowerCase().includes(q) || t.coaches.some((c) => c.name.toLowerCase().includes(q)))
      && (!f.grade || t.grade === f.grade) && (!f.gender || t.gender === f.gender) && (!f.level || t.level === f.level) && (!f.season || t.season === f.season)
      && (!f.status || teamFlags(t).some(([k]) => k === f.status));
  });
  const bulk = view.querySelector("[data-bulk]");
  const paint = () => {
    tableBox.innerHTML = teamTable(visible(), true, selected);
    sizeBars(tableBox);
    bulk.hidden = selected.size === 0;
    view.querySelector("[data-count]").textContent = `${plural(selected.size, "team")} selected`;
    tableBox.querySelectorAll("[data-pick]").forEach((b) => (b.onchange = () => {
      b.checked ? selected.add(b.dataset.pick) : selected.delete(b.dataset.pick);
      paint();
    }));
    const all = tableBox.querySelector("[data-pick-all]");
    if (all) {
      all.checked = visible().length > 0 && visible().every((t) => selected.has(t.id));
      all.onchange = () => {
        visible().forEach((t) => (all.checked ? selected.add(t.id) : selected.delete(t.id)));
        paint();
      };
    }
  };
  view.querySelectorAll("[data-f]").forEach((el) => (el.oninput = () => {
    f[el.dataset.f] = el.value;
    paint();
  }));
  view.querySelector("[data-bulk-msg]").onclick = () => (location.hash = `#/messages?teams=${[...selected].join(",")}`);
  view.querySelector("[data-bulk-event]").onclick = () => (location.hash = `#/events?new=1&teams=${[...selected].join(",")}`);
  view.querySelector("[data-bulk-clear]").onclick = () => {
    selected.clear();
    paint();
  };
  view.querySelector("[data-bulk-edit]").onclick = async (e) => {
    const v = await dialog({
      title: `Update ${plural(selected.size, "team")}`, message: html`<p class="muted small">Leave a box empty to keep each team's current value.</p>`,
      fields: [{ name: "grade", label: "Grade" }, { name: "level", label: "Level (Elite, Gold, Select…)" }, { name: "season", label: "Season" }], submit: "Update teams",
    });
    if (!v) return;
    const patch = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim()).map(([k, x]) => [k, x.trim().replace(/(st|nd|rd|th)( grade)?$/i, "")]));
    if (Object.keys(patch).length === 0) return;
    const ok = await run(e.target, async () => {
      for (const id of selected) await api.act("club-update-team", { team_id: id, ...patch });
    }, `Updated ${plural(selected.size, "team")}`);
    if (ok) route();
  };
  view.querySelector("[data-one]").onclick = () => addOneTeam();
  paint();
}

async function addOneTeam() {
  const v = await dialog({
    title: "Add a team",
    fields: [
      { name: "name", label: "Team name", required: true, max: 120 }, { name: "grade", label: "Grade or birth year", help: "e.g. 8, U12, 2033" },
      { name: "gender", label: "Boys or girls", type: "select", options: [{ value: "", label: "—" }, { value: "boys", label: "Boys" }, { value: "girls", label: "Girls" }, { value: "coed", label: "Coed" }] },
      { name: "level", label: "Level", help: "e.g. Elite, Gold, Select" }, { name: "season", label: "Season", help: "e.g. Fall 2026" },
      { name: "coach_email", label: "Head coach's email (optional)", type: "email", help: "They get a one-time code to accept. You can add one later." },
    ],
    submit: "Add team",
  });
  if (!v) return;
  const row = Object.fromEntries(Object.entries(v).filter(([, x]) => String(x).trim()).map(([k, x]) => [k, String(x).trim()]));
  const res = await run(null, () => api.act("club-create-teams", { org_id: club.id, teams: [row] }), `${row.name} added`);
  if (!res) return;
  const created = res.teams[0];
  if (created.coach?.code) await showCode("Send the coach their code", created.coach.email, created.coach.code, created.invite_text);
  location.hash = `#/teams/${created.team_id}`;
}

/** The one-time code a coach or director enters in the app, with ways to send it. */
function showCode(title, email, code, text) {
  const mail = `mailto:${encodeURIComponent(email ?? "")}?subject=${encodeURIComponent(`Your ${club.name} invite on ClubHQ`)}&body=${encodeURIComponent(text ?? "")}`;
  return dialog({
    title, submit: null, cancel: "Done",
    message: html`<p>${raw(email ? html`Send <b>${email}</b> this code.` : "Send this code.")} It works once.</p>
      <p class="code">${code}</p>
      <p class="snapshot small">${text ?? ""}</p>
      <div class="row"><button type="button" class="btn" data-copy="${text ?? code}">Copy message</button><a class="btn" href="${mail}">Open in email</a></div>`,
  });
}

// ----- One team -------------------------------------------------------------------------------------
async function teamPage(view, teamId) {
  const d = await api.act("club-team-detail", { team_id: teamId });
  const t = d.team;
  const joined = d.roster.filter((p) => p.guardian_count > 0).length;
  const next = d.upcoming[0];
  view.innerHTML = html`<p class="crumbs"><a href="#/teams">Teams</a></p>
    <div class="row between"><h1>${t.name} ${raw(groupingLine(t) ? html`<span class="tag">${groupingLine(t)}</span>` : "")}</h1>
      <div class="row"><button class="btn" data-edit>Edit</button><button class="btn btn-danger-outline" data-delete>Delete team</button></div></div>
    <div class="tiles">
      ${raw(tile(num(d.roster.length), "Players", t.season ?? ""))}
      ${raw(tile(d.roster.length ? `${pct(joined, d.roster.length)}%` : "—", "Families joined", `${joined} of ${d.roster.length} players linked`))}
      ${raw(tile(next ? day(next.starts_at) : "—", "Next up", next ? `${eventLabel(next)} · ${next.yes} going` : "Nothing scheduled"))}
      ${raw(tile(d.dues.requested_cents ? money(d.dues.collected_cents) : "—", "Dues collected", d.dues.requested_cents ? `of ${money(d.dues.requested_cents)} · ${plural(d.dues.families_owing, "family", "families")} owe` : "No dues requested"))}
    </div>
    <div class="grid2">
      <section class="card"><div class="row between"><h2>Coaches</h2><button class="btn btn-small" data-invite>Invite a coach</button></div>
        <table class="table"><tbody>
          ${raw(d.coaches.map((c) => html`<tr><td><b>${c.name}</b></td><td>${c.role === "head_coach" ? "Head coach" : "Assistant coach"}</td><td class="numcol"><button class="btn btn-small" data-remove="${c.user_id}" data-name="${c.name}">Remove</button></td></tr>`).join(""))}
          ${raw(d.pending_coaches.map((p) => html`<tr><td>${p.email ?? "Invited coach"}<br><span class="muted small">Invited ${day(p.invited_at)} · code <code>${p.code}</code></span></td><td>${p.role === "head_coach" ? "Head coach" : "Assistant"} ${raw(daysSince(p.invited_at) > STALE_INVITE_DAYS ? badge("Not accepted", "warning") : "")}</td>
            <td class="numcol"><button class="btn btn-small" data-resend="${p.code}" data-email="${p.email ?? ""}" data-role="${p.role}">Send again</button> <button class="btn-link" data-cancel-invite="${p.email ?? ""}">Cancel</button></td></tr>`).join(""))}
          ${raw(d.coaches.length + d.pending_coaches.length === 0 ? html`<tr><td colspan="3">${raw(badge("No coach", "critical"))} <span class="muted">Invite one. As a director you can also run the team yourself in the app.</span></td></tr>` : "")}
        </tbody></table>
        <p class="help">Coaches always accept a one-time code in the app (More → Join a Club). Removing a coach keeps the team, roster and families with the club.</p>
      </section>
      <section class="card"><h2>Families join with the team code</h2>
        <p class="muted small">Families add their own children with the team's code or link (D-048). Give it to the coach, or send it to families yourself.</p>
        <div data-family-code><button class="btn" data-show-code>Show the team code</button></div>
      </section>
    </div>
    <section class="card"><h2>Coming up</h2>
      ${raw(d.upcoming.length ? html`<table class="table"><thead><tr><th>When</th><th>What</th><th class="numcol">Going</th><th class="numcol">Maybe</th><th class="numcol">Can't</th><th class="numcol">No answer</th></tr></thead><tbody>
        ${raw(d.upcoming.map((e) => html`<tr><td class="nowrap">${dateTime(e.starts_at)}</td><td>${eventLabel(e)} ${raw(e.club_event_id ? badge("Club", "info") : "")}<br><span class="muted small">${e.location ?? ""}</span></td><td class="numcol">${e.yes}</td><td class="numcol">${e.maybe}</td><td class="numcol">${e.no}</td><td class="numcol">${Math.max(0, d.roster.length - e.yes - e.maybe - e.no)}</td></tr>`).join(""))}
      </tbody></table>` : html`<p class="muted">Nothing scheduled. The coach (or you, in the app) can add practices and games, or import a tournament schedule.</p>`)}
    </section>
    <section class="card"><h2>Roster</h2>
      ${raw(d.roster.length ? html`<table class="table"><thead><tr><th>#</th><th>Player</th><th>Family</th><th class="numcol">Dues owed</th></tr></thead><tbody>
        ${raw(d.roster.map((p) => html`<tr><td>${p.jersey_number ?? ""}</td><td>${p.first_name} ${p.last_name}</td><td>${raw(p.guardian_count ? badge(p.guardian_count === 1 ? "1 guardian" : `${p.guardian_count} guardians`, "good") : badge("Not joined", "critical"))}</td><td class="numcol">${p.owes_cents ? money(p.owes_cents) : "—"}</td></tr>`).join(""))}
      </tbody></table>` : html`<p class="muted">No players yet. Families add their children when they join with the team code.</p>`)}
      <p class="help">The roster, schedule, attendance, dues and team chat are managed in the ClubHQ app. Private messages between coaches and parents are never shown to directors.</p>
    </section>`;

  view.querySelector("[data-edit]").onclick = async () => {
    const v = await dialog({
      title: `Edit ${t.name}`,
      fields: [
        { name: "name", label: "Team name", value: t.name, required: true, max: 120 }, { name: "grade", label: "Grade or birth year", value: t.grade ?? "" },
        { name: "gender", label: "Boys or girls", type: "select", value: t.gender ?? "", options: [{ value: "", label: "—" }, { value: "boys", label: "Boys" }, { value: "girls", label: "Girls" }, { value: "coed", label: "Coed" }] },
        { name: "level", label: "Level", value: t.level ?? "" }, { name: "season", label: "Season", value: t.season ?? "" },
      ],
    });
    if (v && (await run(null, () => api.act("club-update-team", { team_id: t.id, ...v }), "Saved"))) route();
  };
  view.querySelector("[data-delete]").onclick = async () => {
    const v = await dialog({
      title: `Delete ${t.name}?`, danger: true, submit: "Delete team", confirmText: t.name,
      message: html`<p>The team disappears for everyone right away: its schedule, roster, chat and dues. There's no undo here. ClubHQ support can restore it for 30 days; after that it's gone for good.</p>`,
      fields: [{ name: "notify", label: "Tell the team's families it was closed", type: "checkbox", value: true }],
    });
    if (!v) return;
    if (await run(null, () => api.act("delete-team", { team_id: t.id, confirm_name: t.name, notify_families: v.notify }), `${t.name} was deleted`)) location.hash = "#/teams";
  };
  view.querySelector("[data-invite]").onclick = () => inviteCoach(t);
  view.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
    const ok = await dialog({ title: `Remove ${b.dataset.name}?`, danger: true, submit: "Remove coach", message: html`<p>They lose access to ${t.name}. The team, its roster, schedule and families stay with the club.</p>` });
    if (ok && (await run(b, () => api.act("club-remove-coach", { team_id: t.id, user_id: b.dataset.remove }), "Coach removed"))) route();
  }));
  view.querySelectorAll("[data-cancel-invite]").forEach((b) => (b.onclick = async () => {
    if (await run(b, () => api.act("club-remove-coach", { team_id: t.id, email: b.dataset.cancelInvite }), "Invite cancelled")) route();
  }));
  view.querySelectorAll("[data-resend]").forEach((b) => (b.onclick = () => {
    const text = `You're invited to coach ${t.name} with ${club.name} on ClubHQ. Get the app at teamclubhq.com, then More → Join a Club and enter code ${b.dataset.resend}.`;
    showCode("Send the coach their code", b.dataset.email, b.dataset.resend, text);
  }));
  view.querySelector("[data-show-code]").onclick = async (e) => {
    const inv = await run(e.target, () => api.act("create-invite", { team_id: t.id }));
    if (!inv) return;
    const link = `https://teamclubhq.com/join/${inv.token}`;
    const text = `Join ${t.name} on ClubHQ for the schedule, RSVPs and team news: ${link} (or enter code ${inv.token} in the app).`;
    view.querySelector("[data-family-code]").innerHTML = html`<p class="code">${inv.token}</p><p class="small"><a href="${link}" target="_blank" rel="noopener">${link}</a></p>
      <div class="row"><button class="btn" data-copy-code>Copy message for families</button></div>`;
    view.querySelector("[data-copy-code]").onclick = () => copy(text, "Copied. Paste it in a text or email to families.");
  };
}

async function inviteCoach(team) {
  const v = await dialog({
    title: `Invite a coach to ${team.name}`,
    fields: [
      { name: "email", label: "Coach's email", type: "email", required: true },
      { name: "role", label: "Role", type: "select", value: "head_coach", options: [{ value: "head_coach", label: "Head coach" }, { value: "assistant_coach", label: "Assistant coach" }] },
    ],
    submit: "Get invite code",
    message: html`<p class="muted small">They get a one-time code to enter in the app. If they already use ClubHQ, they also see it in the app.</p>`,
  });
  if (!v) return;
  const res = await run(null, () => api.act("club-assign-coach", { team_id: team.id, email: v.email.trim(), role: v.role }));
  if (!res) return;
  await showCode("Send the coach their code", res.email, res.code, res.invite_text);
  route();
}

// ----- Audience picker (messages and club events) --------------------------------------------------
function audienceBox(ov, preset) {
  const values = (key) => [...new Set(ov.teams.map((t) => t[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const group = (key, title, label = (v) => v) => {
    const vs = values(key);
    return vs.length ? html`<fieldset class="checks"><legend>${title}</legend>${raw(vs.map((v) => html`<label class="chip-check"><input type="checkbox" data-aud="${key}" value="${v}"> ${label(v)}</label>`).join(""))}</fieldset>` : "";
  };
  return html`<div class="audience stack">
    <p class="help">Pick nothing to reach every team. Picks in different rows narrow it down (for example 8th + Girls = 8th grade girls' teams).</p>
    ${raw(group("grade", "Grade", gradeLabel))}${raw(group("gender", "Boys or girls", cap))}${raw(group("level", "Level"))}${raw(group("season", "Season"))}
    <details ${raw(preset.length ? "open" : "")}><summary>Or pick teams (${preset.length || "any"})</summary>
      <div class="team-picks">${raw([...ov.teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((t) => html`<label class="check"><input type="checkbox" data-aud="team" value="${t.id}" ${raw(preset.includes(t.id) ? "checked" : "")}> ${t.name}</label>`).join(""))}</div>
    </details>
    <p class="reach" data-reach>…</p>
  </div>`;
}

function audienceFilter(root) {
  const pick = (key) => [...root.querySelectorAll(`[data-aud="${key}"]:checked`)].map((b) => b.value);
  return { grades: pick("grade"), genders: pick("gender"), levels: pick("level"), seasons: pick("season"), team_ids: pick("team") };
}

function wireAudience(root, onChange) {
  let timer = null, seq = 0;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const out = root.querySelector("[data-reach]");
      try {
        const a = await api.act("club-audience", { org_id: club.id, filter: audienceFilter(root) });
        if (mine !== seq) return;
        out.textContent = a.team_count ? `Reaches ${plural(a.team_count, "team")} · ${plural(a.people_count, "person", "people")} (families, players with their own login, and coaches). One notification each, even with kids on two teams.` : "No teams match. Change the picks.";
        out.dataset.teams = a.team_count;
        out.dataset.people = a.people_count;
        onChange?.(a);
      } catch (e) {
        out.textContent = e.message;
      }
    }, 250);
  };
  root.querySelectorAll("[data-aud]").forEach((b) => (b.onchange = update));
  update();
}

// ----- Messages ------------------------------------------------------------------------------------
async function messagesPage(view, params) {
  const [ov, hist] = await Promise.all([loadOverview(), api.act("club-announcements", { org_id: club.id })]);
  const preset = (params.get("teams") ?? "").split(",").filter(Boolean);
  view.innerHTML = html`<h1>Message families</h1>
    <div class="compose">
      <form class="card stack" data-compose>
        <h2>To</h2>${raw(audienceBox(ov, preset))}
        <label for="m-title">Title</label><input id="m-title" name="title" maxlength="140" required placeholder="Picture Day is Sunday">
        <label for="m-body">Message</label><textarea id="m-body" name="body" rows="6" maxlength="4000" required></textarea>
        <div class="row end"><button class="btn btn-primary" type="submit">Send</button></div>
      </form>
      <div>
        <section class="card"><h2>What families see</h2>
          <div class="phone"><div class="notif"><small>CLUBHQ · now</small><br><b data-pv-title>${club.name}: Your title</b><br><span data-pv-body class="muted">Your message…</span></div></div>
          <p class="help">It's posted as an announcement on each family's own team, labeled "From ${club.name}". Families never see a club area.</p></section>
        <section class="card"><h2>Sent</h2>
          ${raw(hist.sends.length ? hist.sends.map((s) => html`<details class="sent"><summary><b>${s.title}</b><br><span class="muted small">${dateTime(s.created_at)} · ${plural(s.team_count, "team")} · ${s.sent_by}</span></summary><p class="snapshot small">${s.body}</p></details>`).join("") : html`<p class="muted">Nothing sent yet.</p>`)}
        </section>
      </div>
    </div>`;
  const form = view.querySelector("[data-compose]");
  wireAudience(form);
  const pvTitle = view.querySelector("[data-pv-title]"), pvBody = view.querySelector("[data-pv-body]");
  form.elements.title.oninput = () => (pvTitle.textContent = `${club.name}: ${form.elements.title.value || "Your title"}`);
  form.elements.body.oninput = () => (pvBody.textContent = form.elements.body.value.slice(0, 160) || "Your message…");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const reach = form.querySelector("[data-reach]");
    const ok = await dialog({ title: "Send this message?", submit: "Send", message: html`<p><b>${form.elements.title.value}</b> goes to ${plural(Number(reach.dataset.teams ?? 0), "team")} and notifies ${plural(Number(reach.dataset.people ?? 0), "person", "people")}. It can't be unsent.</p>` });
    if (!ok) return;
    const res = await run(form.querySelector("[type=submit]"), () => api.act("club-announcement", { org_id: club.id, title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), filter: audienceFilter(form) }),
      (r) => `Sent to ${plural(r.team_count, "team")} · ${plural(r.people_count, "person", "people")}`);
    if (res) route();
  };
}

// ----- Club events -------------------------------------------------------------------------------------
async function eventsPage(view, params) {
  const ov = await loadOverview();
  const preset = (params.get("teams") ?? "").split(",").filter(Boolean);
  view.innerHTML = html`<div class="row between"><h1>Club events</h1></div>
    <p class="muted">One event on many teams: tryouts, a parent meeting, picture day. Editing or cancelling it changes it on every team.</p>
    <section class="card"><h2>Coming up</h2>
      ${raw(ov.club_events.length ? html`<table class="table"><tbody>${raw(ov.club_events.map((e) => html`<tr><td class="nowrap"><b>${dateTime(e.starts_at)}</b></td><td><b>${e.title}</b><br><span class="muted small">${e.location ?? ""} · ${plural(e.team_count, "team")}</span></td>
        <td class="numcol"><button class="btn btn-small" data-edit-ev="${e.club_event_id}">Edit</button> <button class="btn btn-small btn-danger-outline" data-cancel-ev="${e.club_event_id}">Cancel</button></td></tr>`).join(""))}</tbody></table>`
        : html`<p class="muted">No club events coming up.</p>`)}
    </section>
    <form class="card stack" data-new>
      <h2>New club event</h2>
      <div class="grid2 tight">
        <div class="stack">
          <label for="e-title">Title</label><input id="e-title" name="title" maxlength="140" required placeholder="Winter tryouts">
          <label for="e-type">Kind</label><select id="e-type" name="event_type"><option value="other">Event</option><option value="practice">Practice</option><option value="game">Game</option></select>
          <label for="e-start">Starts</label><input id="e-start" name="starts_at" type="datetime-local" required>
          <label for="e-end">Ends (optional)</label><input id="e-end" name="ends_at" type="datetime-local">
          <p class="help">Times are in your computer's time zone.</p>
          <label for="e-loc">Place</label><input id="e-loc" name="location" maxlength="200" placeholder="Academy gym">
          <label for="e-addr">Address</label><input id="e-addr" name="location_address" maxlength="300">
          <label for="e-notes">Notes</label><textarea id="e-notes" name="notes" rows="3" maxlength="2000"></textarea>
        </div>
        <div><h3>Which teams</h3>${raw(audienceBox(ov, preset))}</div>
      </div>
      <div class="row end"><button class="btn btn-primary" type="submit">Add to teams</button></div>
    </form>`;
  const form = view.querySelector("[data-new]");
  wireAudience(form);
  if (params.get("new")) form.elements.title.focus();
  const isoOf = (v) => (v ? new Date(v).toISOString() : null);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const reach = form.querySelector("[data-reach]");
    const ok = await dialog({ title: "Add this event?", submit: "Add event", message: html`<p><b>${form.elements.title.value}</b> is added to ${plural(Number(reach.dataset.teams ?? 0), "team")} and ${plural(Number(reach.dataset.people ?? 0), "person", "people")} are notified.</p>` });
    if (!ok) return;
    const body = { org_id: club.id, filter: audienceFilter(form), title: form.elements.title.value.trim(), event_type: form.elements.event_type.value, starts_at: isoOf(form.elements.starts_at.value), ends_at: isoOf(form.elements.ends_at.value),
      location: form.elements.location.value.trim(), location_address: form.elements.location_address.value.trim(), notes: form.elements.notes.value.trim() };
    if (await run(form.querySelector("[type=submit]"), () => api.act("club-event", body), (r) => `Added to ${plural(r.team_count, "team")}`)) location.hash = "#/events";
  };
  view.querySelectorAll("[data-edit-ev]").forEach((b) => (b.onclick = async () => {
    const ev = ov.club_events.find((x) => x.club_event_id === b.dataset.editEv);
    const v = await dialog({
      title: `Edit ${ev.title}`, submit: "Save on every team",
      fields: [
        { name: "title", label: "Title", value: ev.title, required: true, max: 140 },
        { name: "starts_at", label: "Starts", type: "datetime-local", value: localInput(ev.starts_at), required: true },
        { name: "ends_at", label: "Ends (optional)", type: "datetime-local", value: localInput(ev.ends_at) },
        { name: "location", label: "Place", value: ev.location ?? "" }, { name: "location_address", label: "Address", value: ev.location_address ?? "" },
        { name: "notes", label: "Notes", type: "textarea", value: ev.notes ?? "", rows: 3 },
        { name: "notify", label: "Tell families if the time or place changed", type: "checkbox", value: true },
      ],
    });
    if (!v) return;
    const body = { club_event_id: ev.club_event_id, title: v.title.trim(), starts_at: isoOf(v.starts_at), ends_at: isoOf(v.ends_at) ?? "", location: v.location.trim(), location_address: v.location_address.trim(), notes: v.notes.trim(), notify: v.notify };
    if (await run(b, () => api.act("club-event-update", body), (r) => `Updated on ${plural(r.updated, "team")}${r.people_count ? ` · ${plural(r.people_count, "person", "people")} told` : ""}`)) route();
  }));
  view.querySelectorAll("[data-cancel-ev]").forEach((b) => (b.onclick = async () => {
    const ev = ov.club_events.find((x) => x.club_event_id === b.dataset.cancelEv);
    const ok = await dialog({ title: `Cancel ${ev.title}?`, danger: true, submit: `Cancel on ${plural(ev.team_count, "team")}`, cancel: "Keep it", message: html`<p>It's cancelled on every team and families are told.</p>` });
    if (ok && (await run(b, () => api.act("club-event-cancel", { club_event_id: ev.club_event_id }), "Cancelled"))) route();
  }));
}

// ----- Add teams from a list -------------------------------------------------------------------------
const TEMPLATE = "Team,Grade,Gender,Level,Season,Coach email\n8th Boys Elite,8,Boys,Elite,Fall 2026,coach@example.com\n7th Girls Gold,7,Girls,Gold,Fall 2026,\n";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CSV or tab-separated rows, with quoted fields. */
function parseRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const sep = line.includes("\t") ? "\t" : ",";
    const cells = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

function normalizeGender(v) {
  const g = v.toLowerCase();
  if (["boys", "boy", "b", "m", "male"].includes(g)) return "boys";
  if (["girls", "girl", "g", "f", "female"].includes(g)) return "girls";
  if (["coed", "co-ed", "mixed"].includes(g)) return "coed";
  return null;
}

/** Same rules as the app's ClubGrouping.parseTeamList: name first, an email anywhere is the coach. */
function parseTeamList(text) {
  return parseRows(text).flatMap((cells) => {
    const name = cells[0];
    if (!name || ["name", "team", "team name"].includes(name.toLowerCase())) return [];
    const rest = cells.slice(1);
    const emailCell = rest.find((c) => c.includes("@")) ?? null;
    const others = rest.filter((c) => !c.includes("@"));
    const at = (i) => (others[i] ? others[i] : null);
    const rawGender = at(1);
    return [{
      name, grade: at(0)?.replace(/(st|nd|rd|th)( grade)?$/i, "") ?? null, gender: rawGender ? normalizeGender(rawGender) : null, rawGender,
      level: at(2), season: at(3), coach_email: emailCell ? emailCell.toLowerCase() : null,
    }];
  });
}

async function addTeamsPage(view) {
  const ov = await loadOverview();
  const existing = new Set(ov.teams.map((t) => t.name.trim().toLowerCase()));
  view.innerHTML = html`<h1>Add teams from a list</h1>
    <div class="grid2">
      <section class="card stack"><h2>1 · Paste or upload</h2>
        <p class="help">One team per line: <code>Team, Grade, Gender, Level, Season, Coach email</code>. Only the name is required. Copy the rows straight from a spreadsheet, or upload a .csv file.</p>
        <textarea data-paste rows="12" placeholder="8th Boys Elite, 8, Boys, Elite, Fall 2026, coach@example.com"></textarea>
        <div class="row"><label class="btn">Upload .csv<input type="file" accept=".csv,.txt,text/csv" data-file hidden></label>
          <a class="btn" download="clubhq-teams-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}">Download template</a></div>
      </section>
      <section class="card"><h2>2 · Check</h2><div data-preview><p class="muted">Paste your list to see what we'll create.</p></div></section>
    </div>
    <section class="card" data-results hidden></section>`;
  const paste = view.querySelector("[data-paste]");
  const preview = view.querySelector("[data-preview]");
  let rows = [];
  const check = () => {
    rows = parseTeamList(paste.value);
    const seen = new Set();
    for (const r of rows) {
      const key = r.name.trim().toLowerCase();
      r.problem = r.name.length > 120 ? "Name is too long" : r.coach_email && !EMAIL.test(r.coach_email) ? `"${r.coach_email}" isn't an email` : null;
      r.warning = existing.has(key) ? "A team with this name already exists" : seen.has(key) ? "Listed twice" : r.rawGender && !r.gender ? `"${r.rawGender}" isn't boys or girls; left blank` : null;
      r.skip = Boolean(r.problem) || existing.has(key) || seen.has(key);
      seen.add(key);
    }
    const ready = rows.filter((r) => !r.skip);
    preview.innerHTML = rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Team</th><th>Group</th><th>Coach</th><th></th></tr></thead><tbody>
        ${raw(rows.map((r) => html`<tr><td>${r.name}</td><td>${raw(groupingLine(r) ? html`<span class="tag">${groupingLine(r)}</span>` : html`<span class="muted">—</span>`)}${r.season ? ` · ${r.season}` : ""}</td><td>${raw(r.coach_email ? esc(r.coach_email) : '<span class="muted">none yet</span>')}</td>
          <td>${raw(r.problem ? badge(r.problem, "critical") : r.skip ? badge(`${r.warning} · skipped`, "warning") : r.warning ? badge(r.warning, "warning") : badge("Ready", "good"))}</td></tr>`).join(""))}
      </tbody></table></div>
      <div class="row between"><span class="muted small">${plural(ready.length, "team")} ready${rows.length > ready.length ? ` · ${rows.length - ready.length} skipped` : ""} · ${plural(ready.filter((r) => r.coach_email).length, "coach invite")}</span>
        <button class="btn btn-primary" data-create ${raw(ready.length ? "" : "disabled")}>Create ${plural(ready.length, "team")}</button></div>` : html`<p class="muted">Paste your list to see what we'll create.</p>`;
    preview.querySelector("[data-create]")?.addEventListener("click", (e) => create(e.target, ready));
  };
  paste.oninput = check;
  view.querySelector("[data-file]").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500_000) return toast("That file is too big. Use a list of teams under 500 KB.", true);
    paste.value = await file.text();
    check();
  };
  const create = async (button, ready) => {
    const results = [];
    const ok = await run(button, async () => {
      for (let i = 0; i < ready.length; i += 60) {
        const chunk = ready.slice(i, i + 60).map(({ name, grade, gender, level, season, coach_email }) => Object.fromEntries(Object.entries({ name, grade, gender, level, season, coach_email }).filter(([, v]) => v)));
        const res = await api.act("club-create-teams", { org_id: club.id, teams: chunk });
        results.push(...res.teams);
      }
    }, () => `Created ${plural(results.length, "team")}`);
    if (!ok && results.length === 0) return;
    const invites = results.filter((r) => r.coach?.code);
    const box = view.querySelector("[data-results]");
    box.hidden = false;
    box.innerHTML = html`<h2>3 · Send the coaches their codes</h2>
      <p class="muted">${plural(results.length, "team")} created. Each coach accepts with their own one-time code in the app (More → Join a Club).</p>
      ${raw(invites.length ? html`<table class="table"><thead><tr><th>Team</th><th>Coach</th><th>Code</th><th></th></tr></thead><tbody>${raw(invites.map((r) => html`<tr><td><a href="#/teams/${r.team_id}">${r.name}</a></td><td>${r.coach.email}</td><td><code>${r.coach.code}</code></td>
        <td class="numcol"><button class="btn btn-small" data-copy-one="${r.invite_text}">Copy message</button> <a class="btn btn-small" href="mailto:${encodeURIComponent(r.coach.email)}?subject=${encodeURIComponent(`Your ${club.name} invite on ClubHQ`)}&body=${encodeURIComponent(r.invite_text)}">Email</a></td></tr>`).join(""))}</tbody></table>
        <div class="row end"><button class="btn" data-copy-all>Copy all messages</button></div>` : html`<p class="muted">No coach emails were in the list. Invite coaches from each team's page.</p>`)}
      <div class="row"><a class="btn btn-primary" href="#/teams">Go to teams</a></div>`;
    box.querySelectorAll("[data-copy-one]").forEach((b) => (b.onclick = () => copy(b.dataset.copyOne, "Copied")));
    box.querySelector("[data-copy-all]")?.addEventListener("click", () => copy(invites.map((r) => `${r.coach.email}\n${r.invite_text}`).join("\n\n"), "Copied every invite"));
    paste.value = "";
    preview.innerHTML = html`<p class="muted">Done. Paste another list to add more.</p>`;
    box.scrollIntoView({ behavior: "smooth" });
  };
}

// ----- Club settings ------------------------------------------------------------------------------------
async function settingsPage(view) {
  const ov = await loadOverview();
  const c = ov.club;
  const codeText = `Bring your team into ${c.name} on ClubHQ: in the app, open More → Join a Club and enter code ${c.code}. Your roster, schedule and families come along.`;
  view.innerHTML = html`<h1>Club settings</h1>
    <div class="grid2">
      <section class="card"><h2>Club</h2>
        <dl class="kv"><dt>Name</dt><dd>${c.name}</dd><dt>Time zone</dt><dd>${c.time_zone ?? "America/Chicago"}</dd><dt>Teams</dt><dd>${num(ov.teams.length)}</dd><dt>Players</dt><dd>${num(c.player_count)}</dd></dl>
        <p class="help">To rename the club, email info@teamclubhq.com.</p>
        <h3>Club code for coaches</h3>
        <p class="help">A coach who already runs a team on ClubHQ enters this code to bring the team (roster, schedule, families) into the club, or to start a new club team.</p>
        <p class="code">${c.code}</p>
        <div class="row"><button class="btn" data-copy-code>Copy message for coaches</button><button class="btn btn-danger-outline" data-reset>New code</button></div>
      </section>
      <section class="card"><div class="row between"><h2>Directors</h2><button class="btn btn-small" data-invite-dir>Add a director</button></div>
        <p class="help">Every director has full powers: every team, messages and events, adding or removing teams and directors.</p>
        <table class="table"><tbody>
          ${raw(ov.directors.map((d) => html`<tr><td><b>${d.name}</b>${d.is_me ? " (you)" : ""}</td><td>Director</td><td class="numcol">${raw(ov.directors.length > 1 ? html`<button class="btn btn-small" data-remove-dir="${d.user_id}" data-name="${d.name}" data-me="${d.is_me ? "1" : ""}">${d.is_me ? "Leave" : "Remove"}</button>` : "")}</td></tr>`).join(""))}
          ${raw(ov.pending_directors.map((p) => html`<tr><td>${p.email}<br><span class="muted small">Invited ${day(p.invited_at)} · code <code>${p.code}</code></span></td><td>${raw(badge("Invited", "warning"))}</td><td class="numcol"><button class="btn btn-small" data-dir-code="${p.code}" data-email="${p.email}">Send again</button> <button class="btn-link" data-cancel-dir="${p.email}">Cancel</button></td></tr>`).join(""))}
        </tbody></table>
        <p class="help">A club always keeps at least one director.</p>
      </section>
    </div>
    <section class="card"><h2>Privacy</h2>
      <p class="small">Directors see each club team the way its head coach does. Private messages between coaches and parents are never shown to directors. Family contact details stay inside ClubHQ: reach families with club messages. Team chat is in the app.</p>
    </section>`;
  view.querySelector("[data-copy-code]").onclick = () => copy(codeText, "Copied");
  view.querySelector("[data-reset]").onclick = async (e) => {
    const ok = await dialog({ title: "Make a new club code?", danger: true, submit: "New code", message: html`<p>The old code stops working right away. Coaches already in the club aren't affected.</p>` });
    if (ok && (await run(e.target, () => api.act("club-reset-code", { org_id: club.id }), "New code ready"))) route();
  };
  const dirText = (code) => `You're invited to be a director of ${c.name} on ClubHQ. Get the app at teamclubhq.com, then More → Join a Club and enter code ${code}. The code works once, for 14 days. After that you can also manage the club at teamclubhq.com/club.`;
  view.querySelector("[data-invite-dir]").onclick = async () => {
    const v = await dialog({
      title: "Add a director", submit: "Get director code",
      message: html`<p class="muted small">They get a one-time code that works for 14 days. Directors have full powers, so only invite people you trust with every team and every child's information.</p>`,
      fields: [{ name: "email", label: "Their email", type: "email", required: true }],
    });
    if (!v) return;
    const res = await run(null, () => api.act("club-invite-director", { org_id: club.id, email: v.email.trim() }));
    if (!res) return;
    await showCode("Send the new director their code", res.email, res.code, res.invite_text);
    route();
  };
  view.querySelectorAll("[data-dir-code]").forEach((b) => (b.onclick = () => showCode("Send the new director their code", b.dataset.email, b.dataset.dirCode, dirText(b.dataset.dirCode))));
  view.querySelectorAll("[data-cancel-dir]").forEach((b) => (b.onclick = async () => {
    if (await run(b, () => api.act("club-remove-director", { org_id: club.id, email: b.dataset.cancelDir }), "Invite cancelled")) route();
  }));
  view.querySelectorAll("[data-remove-dir]").forEach((b) => (b.onclick = async () => {
    const self = b.dataset.me === "1";
    const ok = await dialog({
      title: self ? `Leave ${c.name}?` : `Remove ${b.dataset.name}?`, danger: true, submit: self ? "Leave club" : "Remove director",
      message: html`<p>${self ? "You'll lose access to every team in the club, here and in the app." : `${b.dataset.name} loses access to every team in the club.`} Teams, rosters and families aren't affected.</p>`,
    });
    if (!ok) return;
    if (!(await run(b, () => api.act("club-remove-director", { org_id: club.id, user_id: b.dataset.removeDir }), self ? "You left the club" : "Director removed"))) return;
    if (self) {
      localStorage.removeItem(CLUB_KEY);
      club = null;
      location.hash = "";
      boot();
    } else route();
  }));
}

// ClubHQ Admin portal (DECISIONS D-041, docs/ADMIN_PORTAL.md). Hash-routed single page app.
import * as api from "./api.js";
import { ago, badge, bindCharts, columnChart, date, dateTime, daysSince, dialog, esc, html, label, money, num, raw, run, toast } from "./ui.js";

const app = document.getElementById("app");
const state = { me: null, config: null, teams: null };

// =====================================================================================
// Gate: emailed code → admin check → TOTP (enroll or verify) → portal
// =====================================================================================
async function gate() {
  if (!api.hasSession()) return renderSignIn();
  let who;
  try {
    who = await api.rpc("admin_whoami");
  } catch (e) {
    if (e.status === 401) return renderSignIn();
    return renderFatal(e);
  }
  if (!who?.role) return renderNotAdmin(who?.email);
  if (who.aal !== "aal2") return renderMfa();
  state.me = who;
  state.config = await api.act("config").catch(() => ({}));
  renderShell();
  route();
}

function authCard(inner) {
  app.innerHTML = html`<main class="auth"><div class="card stack auth-card">
    <div class="brand-row"><img src="/icon-192.png" alt="" width="40" height="40"><div><strong>ClubHQ Admin</strong><div class="muted">Staff only</div></div></div>
    ${raw(inner)}</div></main>`;
}

function renderSignIn(email = "") {
  authCard(html`<form class="stack" id="email-form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" required value="${email}">
      <button class="btn btn-primary" type="submit">Email me a code</button>
      <p class="help">We'll email a 6-digit code. Then you'll confirm with your authenticator app.</p>
    </form>`);
  app.querySelector("#email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = app.querySelector("#email").value.trim().toLowerCase();
    const ok = await run(e.submitter, () => api.sendCode(value));
    if (ok) renderCode(value);
  });
}

function renderCode(email) {
  authCard(html`<form class="stack" id="code-form">
      <p>We sent a code to <strong>${email}</strong>.</p>
      <label for="code">6-digit code</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      <button class="btn btn-primary" type="submit">Continue</button>
      <button class="btn btn-link" type="button" id="back">Use a different email</button>
    </form>`);
  app.querySelector("#back").addEventListener("click", () => renderSignIn(email));
  app.querySelector("#code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await run(e.submitter, () => api.verifyCode(email, app.querySelector("#code").value.trim()));
    if (ok) gate();
  });
}

async function renderMfa() {
  let factors;
  try {
    factors = await api.totpFactors();
  } catch (e) {
    return renderFatal(e);
  }
  if (factors.length > 0) {
    authCard(html`<form class="stack" id="totp-form">
        <h1 class="h2">Authenticator code</h1>
        <p>Open your authenticator app and enter the code for <strong>ClubHQ Admin</strong>.</p>
        <input id="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Authenticator code">
        <button class="btn btn-primary" type="submit">Verify</button>
        <button class="btn btn-link" type="button" id="signout">Sign out</button>
      </form>`);
    app.querySelector("#signout").addEventListener("click", signOut);
    app.querySelector("#totp-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const ok = await run(e.submitter, () => api.verifyTotp(factors[0].id, app.querySelector("#totp").value.trim()));
      if (ok) gate();
    });
    return;
  }
  let enrollment;
  try {
    enrollment = await api.enrollTotp();
  } catch (e) {
    return renderFatal(e);
  }
  authCard(html`<form class="stack" id="enroll-form">
      <h1 class="h2">Set up two-step verification</h1>
      <p>Admin access always needs an authenticator app (Apple Passwords, 1Password, Google Authenticator…). Scan this code, then enter the 6 digits it shows.</p>
      <img class="qr" src="${enrollment.qr}" alt="QR code for your authenticator app" width="200" height="200">
      <details><summary>Can't scan? Enter this key</summary><code class="secret">${enrollment.secret}</code></details>
      <input id="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Authenticator code">
      <button class="btn btn-primary" type="submit">Turn on and continue</button>
    </form>`);
  app.querySelector("#enroll-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await run(e.submitter, () => api.verifyTotp(enrollment.id, app.querySelector("#totp").value.trim()), "Two-step verification is on.");
    if (ok) gate();
  });
}

function renderNotAdmin(email) {
  authCard(html`<div class="stack"><h1 class="h2">No admin access</h1>
    <p><strong>${email ?? "This account"}</strong> isn't a ClubHQ admin. Ask the owner to add you.</p>
    <button class="btn" id="signout">Sign out</button></div>`);
  app.querySelector("#signout").addEventListener("click", signOut);
}

function renderFatal(e) {
  authCard(html`<div class="stack"><p class="error">${e.message}</p><button class="btn" id="retry">Try again</button>
    <button class="btn btn-link" id="signout">Sign out</button></div>`);
  app.querySelector("#retry").addEventListener("click", gate);
  app.querySelector("#signout").addEventListener("click", signOut);
}

async function signOut() {
  await api.signOut();
  state.me = null;
  location.hash = "#/";
  renderSignIn();
}

// =====================================================================================
// Shell and routing
// =====================================================================================
const NAV = [
  ["#/", "Overview"], ["#/teams", "Teams"], ["#/people", "People"], ["#/moderation", "Moderation"],
  ["#/grants", "Grants"], ["#/revenue", "Revenue"], ["#/broadcast", "Broadcast"], ["#/audit", "Audit log"], ["#/settings", "Settings"],
];

function renderShell() {
  app.innerHTML = html`<header class="topbar">
      <a class="brand" href="#/"><img src="/icon-192.png" alt="" width="28" height="28"><span>ClubHQ Admin</span></a>
      <nav aria-label="Sections">${raw(NAV.map(([href, text]) => html`<a href="${href}" data-nav="${href}">${text}<span class="nav-count" data-count="${href}"></span></a>`).join(""))}</nav>
      <div class="me muted">${state.me.email} · ${label(state.me.role)}</div>
    </header>
    <main id="view" class="view" tabindex="-1"></main>`;
}

const ROUTES = [
  [/^#\/?$/, renderOverview],
  [/^#\/teams$/, renderTeams],
  [/^#\/teams\/([0-9a-f-]{36})$/, renderTeam],
  [/^#\/people$/, renderPeople],
  [/^#\/people\/([0-9a-f-]{36})$/, renderPerson],
  [/^#\/people\/([0-9a-f-]{36})\/view$/, renderViewAs],
  [/^#\/moderation$/, renderModeration],
  [/^#\/grants$/, renderGrants],
  [/^#\/revenue$/, renderRevenue],
  [/^#\/broadcast$/, renderBroadcast],
  [/^#\/audit$/, renderAudit],
  [/^#\/settings$/, renderSettings],
];

let routeToken = 0;
async function route() {
  if (!state.me) return;
  const view = document.getElementById("view");
  if (!view) return;
  const hash = (location.hash || "#/").split("?")[0]; // query (?q=, ?status=) is read by the view
  const top = "#/" + (hash.split("/")[1] ?? "");
  document.querySelectorAll("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.nav === top));
  const match = ROUTES.map(([re, fn]) => [hash.match(re), fn]).find(([m]) => m);
  const token = ++routeToken;
  view.innerHTML = `<p class="muted loading">Loading…</p>`;
  try {
    if (!match) {
      view.innerHTML = html`<h1>Not found</h1><p><a href="#/">Back to the overview</a></p>`;
      return;
    }
    const [m, fn] = match;
    const output = await fn(...m.slice(1));
    if (token !== routeToken) return; // a newer navigation won
    view.innerHTML = output.html;
    output.bind?.(view);
    view.focus({ preventScroll: true });
  } catch (e) {
    if (token !== routeToken) return;
    if (e.code === "mfa_required" || e.code === "not_admin" || e.status === 401) return gate();
    view.innerHTML = html`<p class="error">${e.message}</p>`;
  }
  refreshCounts();
}

async function refreshCounts() {
  const open = await api.rpc("admin_reports", { _status: "open" }).catch(() => null);
  const el = document.querySelector('[data-count="#/moderation"]');
  if (el && open) el.textContent = open.length ? ` ${open.length}` : "";
}

const reload = () => route();
async function teamsCache(force = false) {
  if (!state.teams || force) state.teams = await api.rpc("admin_teams");
  return state.teams;
}

function teamHealth(t) {
  if (t.archived_at) return ["Archived", "neutral"];
  if (daysSince(t.created_at) < 7) return ["New", "info"];
  const idle = daysSince(t.last_activity_at);
  if (idle <= 7) return ["Active", "good"];
  if (idle <= 14) return ["Slowing", "warning"];
  return ["Quiet", "critical"];
}

function kv(rows) {
  return html`<dl class="kv">${raw(rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${raw(v)}</dd>`).join(""))}</dl>`;
}

function table(head, rows, empty = "Nothing here yet.") {
  if (rows.length === 0) return html`<p class="muted">${empty}</p>`;
  return html`<div class="table-wrap"><table class="table"><thead><tr>${raw(head.map((h) => (h.startsWith("#") ? html`<th class="numcol">${h.slice(1)}</th>` : html`<th>${h}</th>`)).join(""))}</tr></thead>
    <tbody>${raw(rows.join(""))}</tbody></table></div>`;
}

const on = (root, selector, handler) => root.querySelectorAll(selector).forEach((el) => el.addEventListener("click", (e) => handler(el, e)));
const isOwner = () => state.me?.role === "owner";
const defaultExpiry = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const endOfDay = (d) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

// =====================================================================================
// Overview
// =====================================================================================
async function renderOverview() {
  const o = await api.rpc("admin_overview");
  const weeks = o.weekly.map((w) => ({ ...w, label: new Date(`${w.week}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }));
  const series = [
    { title: "Active teams per week", valueLabel: "active teams", points: weeks.map((w) => ({ label: w.label, value: w.active_teams })) },
    { title: "New signups per week", valueLabel: "signups", points: weeks.map((w) => ({ label: w.label, value: w.signups })) },
    { title: "Active people per week", valueLabel: "active people", points: weeks.map((w) => ({ label: w.label, value: w.active_users })) },
  ];
  const oldestHours = o.reports_oldest_open_at ? (Date.now() - new Date(o.reports_oldest_open_at).getTime()) / 3_600_000 : 0;
  const tile = (value, title, sub = "", href = "") => html`<a class="tile card" ${raw(href ? `href="${esc(href)}"` : "")}><div class="tile-value">${value}</div><div class="tile-label">${title}</div>${raw(sub ? html`<div class="tile-sub muted">${sub}</div>` : "")}</a>`;
  const breakdown = (obj, names = {}) => table(["Source", "#People"],
    Object.entries(obj ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => html`<tr><td>${names[k] ?? label(k)}</td><td class="numcol">${num(n)}</td></tr>`), "No data yet.");
  const SOURCES = { app_store: "App Store search", friend_or_coach: "Friend or another coach", club_or_league: "Club or league", social_media: "Social media", web_search: "Web search", other: "Other", unknown: "Didn't say" };
  const VIA = { created_team: "Created a team", team_code: "Team code or link", co_parent_invite: "Co-parent invite", player_code: "Player code", unknown: "Not recorded (before 1.0.1)" };
  return {
    html: html`<h1>Overview</h1>
      ${raw(o.deletions_due > 0 ? html`<div class="banner">${o.deletions_due} scheduled deletion(s) are due. <button class="btn btn-small" id="process-deletions">Delete them now</button></div>` : "")}
      ${raw(o.reports_open > 0 ? html`<div class="banner ${oldestHours > 16 ? "banner-critical" : ""}">${raw(badge(`${o.reports_open} open report${o.reports_open === 1 ? "" : "s"}`, oldestHours > 16 ? "critical" : "warning"))} The oldest is ${Math.floor(oldestHours)} h old; reports should be handled within 24 h. <a href="#/moderation">Open moderation</a></div>` : "")}
      <section class="hero card"><div class="hero-value">${num(o.teams_active_7d)}</div><div>teams active in the last 7 days <span class="muted">of ${num(o.teams_total)} teams</span></div></section>
      <section class="tiles">
        ${raw(tile(num(o.users_total), "People", `${num(o.users_new_7d)} new this week`, "#/people"))}
        ${raw(tile(num(o.users_active_7d), "Active people (7 d)", `${num(o.users_active_30d)} in 30 days`))}
        ${raw(tile(num(o.teams_total), "Teams", `${num(o.teams_new_7d)} new this week · ${num(o.clubs_total)} clubs`, "#/teams"))}
        ${raw(tile(num(o.pro_paid), "Paying Pro coaches", `${num(o.pro_trial)} in trial · ${num(o.pro_cancelling)} cancelling`, "#/revenue"))}
        ${raw(tile(money(o.mrr_cents_estimate), "Est. monthly revenue", "List prices, before Apple's cut", "#/revenue"))}
        ${raw(tile(num(o.pro_granted), "Pro grants active", "", "#/grants"))}
      </section>
      <section class="charts">${raw(series.map((s) => columnChart(s)).join(""))}</section>
      <section class="grid2">
        <div class="card"><h2>How coaches heard about us</h2>${raw(breakdown(o.acquisition, SOURCES))}</div>
        <div class="card"><h2>How people arrived</h2>${raw(breakdown(o.signup_via, VIA))}</div>
      </section>
      <section class="card"><h2>Feature usage, last 30 days</h2>
        ${raw(table(["Event", "#Times", "#People", "#Teams"], (o.feature_usage_30d ?? []).map((f) => html`<tr><td><code>${f.name}</code></td><td class="numcol">${num(f.events)}</td><td class="numcol">${num(f.users)}</td><td class="numcol">${num(f.teams)}</td></tr>`), "No usage recorded yet. It starts with the 1.0.1 backend."))}
      </section>
      <p class="muted small">Metrics exclude staff, QA and demo accounts (${num(o.internal_users)} accounts on @teamclubhq.com or marked deleted). App Store sandbox subscriptions: ${num(o.pro_sandbox)}.</p>`,
    bind(root) {
      bindCharts(root, series);
      root.querySelector("#process-deletions")?.addEventListener("click", async (e) => {
        const r = await run(e.currentTarget, () => api.act("process-deletions"), (x) => `${x.completed} account(s) deleted.`);
        if (r) reload();
      });
    },
  };
}

// =====================================================================================
// Teams
// =====================================================================================
async function renderTeams() {
  const teams = await teamsCache(true);
  const rowHtml = (t) => {
    const [text, status] = teamHealth(t);
    return html`<tr data-filter="${[t.name, t.org?.name, (t.head_coaches ?? []).join(" "), t.sport].join(" ").toLowerCase()}" data-health="${text}" data-internal="${t.internal}" data-pro="${t.is_pro}">
      <td><a href="#/teams/${t.id}">${t.name}</a>${raw(t.org?.type === "club" ? html`<div class="muted small">${t.org.name}</div>` : "")}</td>
      <td>${raw(badge(text, status))}</td>
      <td>${label(t.sport)}</td>
      <td>${(t.head_coaches ?? []).join(", ") || "—"}</td>
      <td class="numcol">${num(t.families)}</td>
      <td class="numcol">${num(t.events_next_14d)}</td>
      <td class="numcol">${num(t.messages_7d)}</td>
      <td>${ago(t.last_activity_at)}</td>
      <td>${raw(t.is_pro ? badge("Pro", "info") : "")}${raw(t.internal ? badge("Internal", "neutral") : "")}</td>
    </tr>`;
  };
  // Going quiet first: the teams that need a nudge are the ones to look at.
  const order = { Quiet: 0, Slowing: 1, New: 2, Active: 3, Archived: 4 };
  const sorted = [...teams].sort((a, b) => order[teamHealth(a)[0]] - order[teamHealth(b)[0]] || daysSince(b.last_activity_at) - daysSince(a.last_activity_at));
  return {
    html: html`<h1>Teams <span class="muted">${num(teams.length)}</span></h1>
      <div class="filters row">
        <input type="search" id="team-search" placeholder="Search team, club, coach, sport" aria-label="Search teams">
        <select id="team-health" aria-label="Health"><option value="">All teams</option><option>Quiet</option><option>Slowing</option><option>New</option><option>Active</option><option>Archived</option></select>
        <label class="check"><input type="checkbox" id="team-pro"> Pro only</label>
        <label class="check"><input type="checkbox" id="team-internal" checked> Hide internal</label>
      </div>
      <p class="help">Health: <strong>Quiet</strong> = no activity in 14 days · <strong>Slowing</strong> = 8–14 days · <strong>New</strong> = created this week. Activity is any message, event, RSVP, announcement or new member.</p>
      ${raw(table(["Team", "Health", "Sport", "Head coach", "#Families", "#Events next 14 d", "#Messages 7 d", "Last activity", ""], sorted.map(rowHtml), "No teams yet."))}`,
    bind(root) {
      const apply = () => {
        const q = root.querySelector("#team-search").value.trim().toLowerCase();
        const health = root.querySelector("#team-health").value;
        const pro = root.querySelector("#team-pro").checked;
        const hideInternal = root.querySelector("#team-internal").checked;
        root.querySelectorAll("tbody tr").forEach((tr) => {
          tr.hidden = (q && !tr.dataset.filter.includes(q)) || (health && tr.dataset.health !== health)
            || (pro && tr.dataset.pro !== "true") || (hideInternal && tr.dataset.internal === "true");
        });
      };
      root.querySelectorAll(".filters input, .filters select").forEach((el) => el.addEventListener("input", apply));
      apply();
    },
  };
}

async function renderTeam(teamId) {
  const d = await api.rpc("admin_team", { _team_id: teamId });
  const t = d.team;
  const [healthText, healthStatus] = teamHealth({ ...t, last_activity_at: d.counts.last_activity_at });
  const inviteURL = d.invite ? `https://teamclubhq.com/join/${d.invite.token}` : null;
  const members = d.members.map((m) => html`<tr><td><a href="#/people/${m.user_id}">${m.name || m.email}</a><div class="muted small">${m.email}</div></td>
      <td>${m.roles.map(label).join(", ")}</td><td>${date(m.joined_at)}</td><td>${raw(m.suspended_at ? badge("Suspended", "critical") : "")}</td></tr>`);
  const players = d.players.map((p) => html`<tr><td>${p.first_name} ${p.last_name}${raw(p.jersey_number ? html` <span class="muted">#${p.jersey_number}</span>` : "")}</td>
      <td class="numcol">${num(p.guardians)}</td><td>${p.has_account ? "Yes" : "—"}</td><td>${date(p.created_at)}</td>
      <td><button class="btn btn-small" data-move="${p.id}" data-name="${p.first_name} ${p.last_name}">Move…</button></td></tr>`);
  const threads = d.threads.map((th) => html`<tr><td>${th.title ?? label(th.kind)}${raw(th.deleted_at ? " " + badge("Deleted", "neutral") : "")}</td><td>${label(th.kind)} · ${label(th.audience)}</td>
      <td class="numcol">${num(th.message_count)}</td><td>${ago(th.last_message_at)}</td></tr>`);
  const grants = d.grants.map(grantRow);
  return {
    html: html`<p class="crumbs"><a href="#/teams">Teams</a> /</p>
      <h1>${t.name} ${raw(badge(healthText, healthStatus))} ${raw(t.is_pro ? badge("Pro", "info") : "")} ${raw(t.archived_at ? badge("Archived", "neutral") : "")}</h1>
      <div class="actions row">
        <button class="btn" id="rename">Rename</button>
        <button class="btn" id="grant">Grant Pro</button>
        <button class="btn" id="reset-code">Reset team code</button>
        <button class="btn ${t.archived_at ? "" : "btn-danger-outline"}" id="archive">${t.archived_at ? "Restore team" : "Archive team"}</button>
      </div>
      <section class="grid2">
        <div class="card"><h2>Details</h2>${raw(kv([
          ["Sport", esc(label(t.sport))], ["Age group", esc(t.age_group ?? "—")], ["Season", esc(t.season ?? "—")],
          ["Club", d.org ? html`${d.org.name} <span class="muted">(${label(d.org.type)}, ${num(d.org.team_count)} team${d.org.team_count === 1 ? "" : "s"})</span>` : "—"],
          ["Created", esc(dateTime(t.created_at))], ["Time zone", esc(t.time_zone ?? "—")],
          ["Payments", esc([t.has_venmo && "Venmo", t.has_cashapp && "Cash App"].filter(Boolean).join(", ") || "None set up")],
          ["Invite link", inviteURL ? html`<a href="${inviteURL}" target="_blank" rel="noopener">${inviteURL}</a> <button class="btn btn-small" id="copy-invite">Copy</button><div class="muted small">Good until ${date(d.invite.expires_at)}</div>` : "No live code"],
          ["Team id", html`<code>${t.id}</code>`],
        ]))}</div>
        <div class="card"><h2>Activity</h2>${raw(kv([
          ["Last activity", esc(ago(d.counts.last_activity_at))], ["Upcoming events", esc(num(d.counts.events_upcoming))], ["Events total", esc(num(d.counts.events_total))],
          ["RSVPs, 30 days", esc(num(d.counts.rsvps_30d))], ["Messages, 7 days", esc(num(d.counts.messages_7d))], ["Messages total", esc(num(d.counts.messages_total))],
          ["Announcements", esc(num(d.counts.announcements))],
          ["Dues", esc(`${num(d.dues.requests)} requests · ${money(d.dues.paid_cents)} paid · ${money(d.dues.unpaid_cents)} unpaid`)],
        ]))}</div>
      </section>
      <section class="card"><h2>People <span class="muted">${num(d.members.length)}</span></h2>${raw(table(["Name", "Roles", "Joined", ""], members))}</section>
      <section class="card"><h2>Roster <span class="muted">${num(d.players.length)}</span></h2>${raw(table(["Player", "#Guardians", "Own login", "Added", ""], players))}</section>
      <section class="card"><h2>Conversations</h2><p class="help">Counts only. Message content is visible only when it's reported (D-041).</p>${raw(table(["Conversation", "Kind", "#Messages", "Last message"], threads))}</section>
      <section class="grid2">
        <div class="card"><h2>Pro grants</h2>${raw(table(["Target", "Reason", "Ends", "Status", ""], grants, "No grants."))}</div>
        <div class="card"><h2>Reports</h2>${raw(table(["Reason", "Status", "Filed"], d.reports.map((r) => html`<tr><td>${label(r.reason)}</td><td>${label(r.status)}</td><td>${ago(r.created_at)}</td></tr>`), "No reports."))}</div>
      </section>
      <section class="card"><h2>Admin history</h2>${raw(auditTable(d.audit))}</section>`,
    bind(root) {
      root.querySelector("#copy-invite")?.addEventListener("click", () => navigator.clipboard.writeText(inviteURL).then(() => toast("Invite link copied.")));
      root.querySelector("#rename").addEventListener("click", async (e) => {
        const v = await dialog({ title: "Rename team", fields: [{ name: "name", label: "Team name", value: t.name, required: true, max: 120 }], submit: "Save" });
        if (v && (await run(e.target, () => api.act("update-team", { team_id: t.id, name: v.name }), "Team renamed."))) reload();
      });
      root.querySelector("#grant").addEventListener("click", (e) => grantDialog(e.target, "team", t.id, t.name));
      root.querySelector("#reset-code").addEventListener("click", async (e) => {
        const v = await dialog({ title: "Reset team code?", message: "The current link and code stop working right away. Families who already joined aren't affected. Send the coach the new link.", submit: "Reset code", danger: true });
        if (v && (await run(e.target, () => api.act("reset-team-code", { team_id: t.id }), "New code created."))) reload();
      });
      root.querySelector("#archive").addEventListener("click", async (e) => {
        const archiving = !t.archived_at;
        const v = await dialog({
          title: archiving ? "Archive this team?" : "Restore this team?",
          message: archiving ? "The team disappears from everyone's app. Nothing is deleted, and you can restore it." : "The team comes back for its members.",
          fields: [{ name: "note", label: "Note for the audit log", type: "textarea", required: archiving }],
          submit: archiving ? "Archive" : "Restore", danger: archiving, confirmText: archiving ? t.name : null,
        });
        if (v && (await run(e.target, () => api.act("set-team-archived", { team_id: t.id, archived: archiving, note: v.note }), archiving ? "Team archived." : "Team restored."))) reload();
      });
      on(root, "[data-move]", async (btn) => {
        const all = (await teamsCache()).filter((x) => x.id !== t.id && !x.archived_at);
        const v = await dialog({
          title: `Move ${btn.dataset.name}`,
          message: "Their future RSVPs on this team are removed. Guardians (and the player's own login) get access to the new team, and lose this one if they have no other child here.",
          fields: [{ name: "to", label: "New team", type: "select", options: all.map((x) => ({ value: x.id, label: `${x.name}${x.org?.type === "club" ? ` (${x.org.name})` : ""}` })), required: true }],
          submit: "Move player", danger: true,
        });
        if (v && (await run(btn, () => api.act("move-player", { player_id: btn.dataset.move, to_team_id: v.to }), "Player moved."))) reload();
      });
      bindGrantRevokes(root);
    },
  };
}

// =====================================================================================
// People
// =====================================================================================
async function renderPeople() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "").get("q") ?? "";
  const people = await api.rpc("admin_search_users", { _q: q });
  const rows = people.map((p) => html`<tr><td><a href="#/people/${p.id}">${p.full_name || p.email}</a><div class="muted small">${p.email}</div></td>
      <td>${(p.roles ?? []).map(label).join(", ") || "—"}</td><td class="numcol">${num(p.teams)}</td><td>${date(p.created_at)}</td><td>${ago(p.last_seen_at ?? p.last_sign_in_at)}</td>
      <td>${raw(p.suspended_at ? badge("Suspended", "critical") : "")}${raw(p.internal ? badge("Internal", "neutral") : "")}</td></tr>`);
  return {
    html: html`<h1>People</h1>
      <form class="filters row" id="people-search"><input type="search" name="q" value="${q}" placeholder="Email, name or account id" aria-label="Search people"><button class="btn btn-primary">Search</button></form>
      <p class="help">${q ? `Matches for “${q}” (up to 50).` : "Newest 50 accounts. Paste the sender's address from a support email to find them."}</p>
      ${raw(table(["Person", "Roles", "#Teams", "Joined", "Last seen", ""], rows, "No one matches."))}`,
    bind(root) {
      root.querySelector("#people-search").addEventListener("submit", (e) => {
        e.preventDefault();
        location.hash = `#/people?q=${encodeURIComponent(new FormData(e.target).get("q").trim())}`;
      });
    },
  };
}

async function renderPerson(userId) {
  const d = await api.rpc("admin_user", { _user_id: userId });
  const a = d.account, p = d.profile;
  const deletionPending = d.deletion && !d.deletion.completed_at && !d.deletion.cancelled_at;
  const name = p.full_name || a.email;
  const subRows = d.pro.subscriptions.map((s) => html`<tr><td>${s.product_id.endsWith("yearly") ? "Yearly" : "Monthly"}${raw(s.environment !== "Production" ? " " + badge("Sandbox", "neutral") : "")}</td>
      <td>${label(s.status)}${s.in_trial ? " (trial)" : ""}</td><td>${s.auto_renew ? "On" : "Off"}</td><td>${date(s.expires_at)}</td></tr>`);
  return {
    html: html`<p class="crumbs"><a href="#/people">People</a> /</p>
      <h1>${name} ${raw(p.suspended_at ? badge("Suspended", "critical") : "")} ${raw(d.pro.active ? badge("Pro", "info") : "")} ${raw(a.internal ? badge("Internal", "neutral") : "")}</h1>
      ${raw(deletionPending ? html`<div class="banner banner-critical">Scheduled for deletion on ${dateTime(d.deletion.scheduled_for)}: ${d.deletion.reason}</div>` : "")}
      ${raw(p.suspended_at ? html`<div class="banner">Suspended ${ago(p.suspended_at)}: ${p.suspended_reason ?? ""}</div>` : "")}
      <div class="actions row">
        <a class="btn" href="#/people/${a.id}/view">View as ${p.full_name?.split(" ")[0] || "user"}</a>
        <a class="btn" href="mailto:${a.email}">Email</a>
        <button class="btn" id="rename">Edit name</button>
        <button class="btn" id="reset">Send password-reset code</button>
        <button class="btn" id="warn">Send a warning</button>
        <button class="btn" id="grant">Grant Pro</button>
        ${raw(p.suspended_at && !deletionPending ? html`<button class="btn" id="unsuspend">Unsuspend</button>` : html`<button class="btn btn-danger-outline" id="suspend" ${raw(deletionPending ? "disabled" : "")}>Suspend</button>`)}
        ${raw(deletionPending ? html`<button class="btn" id="cancel-delete">Cancel deletion</button>` : html`<button class="btn btn-danger-outline" id="delete">Schedule deletion</button>`)}
        ${raw(isOwner() ? html`<button class="btn btn-danger-outline" id="delete-now">Delete now (legal)</button><button class="btn btn-danger-outline" id="merge">Merge into…</button>` : "")}
      </div>
      <section class="grid2">
        <div class="card"><h2>Account</h2>${raw(kv([
          ["Email", html`${a.email}${raw(a.email_confirmed_at ? "" : " " + badge("Unconfirmed", "warning"))}`],
          ["Phone", esc(p.phone ?? "—")],
          ["Joined", esc(dateTime(a.created_at))], ["Last sign-in", esc(ago(a.last_sign_in_at))], ["Last seen in app", esc(ago(p.last_seen_at))],
          ["App version", esc(p.app_version ?? "—")], ["Sign-in methods", esc((a.providers ?? []).map(label).join(", "))],
          ["How they arrived", esc(label(p.signup_via ?? "not recorded"))], ["Heard about us", esc(label(p.acquisition_source ?? "—"))],
          ["Active days, 30 d", esc(num(d.activity.active_days_30d))],
          ["Devices with push", esc(num(d.devices.length))],
          a.is_admin && ["Admin", esc(label(a.is_admin))],
          ["Account id", html`<code>${a.id}</code>`],
        ]))}</div>
        <div class="card"><h2>Teams</h2>
          ${raw(table(["Team", "Roles"], d.memberships.map((m) => html`<tr><td><a href="#/teams/${m.team_id}">${m.team_name}</a>${raw(m.archived_at ? " " + badge("Archived", "neutral") : "")}</td><td>${m.roles.map(label).join(", ")}</td></tr>`), "Not on any team."))}
          ${raw(d.org_roles.length ? html`<h3>Clubs</h3>${raw(table(["Club", "Role"], d.org_roles.map((o) => html`<tr><td>${o.org_name}</td><td>${label(o.role)}</td></tr>`)))}` : "")}
          <h3>Children</h3>
          ${raw(table(["Child", "Team", "Relationship"], d.children.map((c) => html`<tr><td>${c.name}</td><td><a href="#/teams/${c.team_id}">${c.team_name}</a></td><td>${label(c.relationship ?? "—")}</td></tr>`), "No children linked."))}
        </div>
      </section>
      <section class="grid2">
        <div class="card"><h2>Coach Pro</h2>
          <p>${raw(d.pro.active ? badge("Pro is active", "good") : badge("Free plan", "neutral"))}</p>
          ${raw(table(["Plan", "Status", "Auto-renew", "Expires"], subRows, "No App Store subscriptions."))}
          <h3>Grants</h3>${raw(table(["Target", "Reason", "Ends", "Status", ""], d.pro.grants.map(grantRow), "No grants."))}
        </div>
        <div class="card"><h2>Safety</h2>${raw(kv([
          ["Reports they filed", esc(num(d.reports_filed))],
          ["They block", esc(num(d.blocks.blocking))], ["Blocked by", esc(num(d.blocks.blocked_by))],
        ]))}
          <h3>Reports about them</h3>${raw(table(["Reason", "Status", "Outcome", "Filed"], d.reports_about.map((r) => html`<tr><td>${label(r.reason)}</td><td>${label(r.status)}</td><td>${label(r.resolution ?? "—")}</td><td>${ago(r.created_at)}</td></tr>`), "None."))}
        </div>
      </section>
      <section class="card"><h2>Recent activity</h2>${raw(table(["Event", "Source", "Version", "When"], d.activity.recent_events.map((e) => html`<tr><td><code>${e.name}</code></td><td>${e.source}</td><td>${e.app_version ?? "—"}</td><td>${dateTime(e.created_at)}</td></tr>`), "No usage events yet."))}</section>
      <section class="card"><h2>Admin history</h2>${raw(auditTable(d.audit))}</section>`,
    bind(root) {
      const act = (id, fn) => root.querySelector(id)?.addEventListener("click", (e) => fn(e.currentTarget));
      act("#rename", async (btn) => {
        const v = await dialog({ title: "Edit name", fields: [{ name: "full_name", label: "Full name", value: p.full_name || "", required: true, max: 120 }], submit: "Save" });
        if (v && (await run(btn, () => api.act("update-user", { user_id: a.id, full_name: v.full_name }), "Name updated."))) reload();
      });
      act("#reset", async (btn) => {
        const v = await dialog({ title: "Send a password-reset code?", message: `ClubHQ emails ${a.email} a 6-digit code. They enter it in the app (Sign In → Forgot password).`, submit: "Send code" });
        if (v) await run(btn, () => api.act("send-password-reset", { user_id: a.id }), "Reset code sent.");
      });
      act("#warn", async (btn) => {
        const v = await dialog({ title: `Send ${name} a warning`, message: "Sent as a push notification from ClubHQ.", fields: [{ name: "message", label: "Message", type: "textarea", required: true, max: 300, value: "Please keep team conversations respectful. Repeated reports can lead to suspension." }], submit: "Send" });
        if (!v) return;
        const r = await run(btn, () => api.act("warn-user", { user_id: a.id, message: v.message }));
        if (r) toast(r.configured ? `Sent to ${r.delivered} of ${r.devices} device(s).` : `Phone push isn't set up yet (OQ-04). Logged it; email ${r.email} instead.`, !r.configured);
      });
      act("#grant", (btn) => grantDialog(btn, "user", a.id, a.email));
      act("#suspend", async (btn) => {
        const v = await dialog({ title: `Suspend ${name}?`, message: "They're signed out within the hour and can't use the app until you unsuspend them. They can still delete their account.", fields: [{ name: "reason", label: "Reason (for the audit log)", type: "textarea", required: true, max: 500 }], submit: "Suspend", danger: true, confirmText: a.email });
        if (v && (await run(btn, () => api.act("suspend-user", { user_id: a.id, reason: v.reason }), "Suspended."))) reload();
      });
      act("#unsuspend", async (btn) => {
        const v = await dialog({ title: `Unsuspend ${name}?`, fields: [{ name: "note", label: "Note (optional)", type: "textarea" }], submit: "Unsuspend" });
        if (v && (await run(btn, () => api.act("unsuspend-user", { user_id: a.id, note: v.note }), "Unsuspended."))) reload();
      });
      act("#delete", async (btn) => {
        const v = await dialog({ title: `Schedule deletion of ${name}?`, message: "They're suspended now. Their account and data are deleted in 7 days unless you cancel. Teams where they're the only head coach are archived.", fields: [{ name: "reason", label: "Reason", type: "textarea", required: true, max: 500 }], submit: "Schedule deletion", danger: true, confirmText: a.email });
        if (v && (await run(btn, () => api.act("schedule-deletion", { user_id: a.id, reason: v.reason }), "Deletion scheduled."))) reload();
      });
      act("#cancel-delete", async (btn) => {
        if (await run(btn, () => api.act("cancel-deletion", { user_id: a.id }), "Deletion cancelled and account restored.")) reload();
      });
      act("#delete-now", async (btn) => {
        const v = await dialog({ title: `Delete ${name} now?`, message: "For legal or privacy requests. No grace period, and it can't be undone.", fields: [{ name: "reason", label: "Request details", type: "textarea", required: true, max: 500 }], submit: "Delete permanently", danger: true, confirmText: a.email });
        if (v && (await run(btn, () => api.act("delete-user-now", { user_id: a.id, reason: v.reason }), "Account deleted."))) location.hash = "#/people";
      });
      act("#merge", async (btn) => {
        const v = await dialog({ title: `Merge ${a.email} into another account`, message: "Teams, children, messages, subscriptions and grants move to the account they keep. This account is then deleted.", fields: [{ name: "email", label: "Email of the account to keep", type: "email", required: true }], submit: "Find account" });
        if (!v) return;
        const matches = (await api.rpc("admin_search_users", { _q: v.email.trim() })).filter((x) => x.email?.toLowerCase() === v.email.trim().toLowerCase());
        if (matches.length !== 1 || matches[0].id === a.id) return toast("No other account has exactly that email.", true);
        const ok = await dialog({ title: "Confirm merge", message: `Keep ${matches[0].email}, delete ${a.email}.`, submit: "Merge accounts", danger: true, confirmText: a.email });
        if (ok && (await run(btn, () => api.act("merge-users", { source_id: a.id, target_id: matches[0].id }), "Accounts merged."))) location.hash = `#/people/${matches[0].id}`;
      });
      bindGrantRevokes(root);
    },
  };
}

async function renderViewAs(userId) {
  const [d, person] = await Promise.all([api.rpc("admin_view_as", { _user_id: userId }), api.rpc("admin_user", { _user_id: userId })]);
  const name = person.profile.full_name || person.account.email;
  const kid = Object.fromEntries(d.children.map((c) => [c.id, c.name]));
  const teamName = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  return {
    html: html`<p class="crumbs"><a href="#/people/${userId}">${name}</a> /</p>
      <h1>What ${name} sees</h1>
      <div class="banner">Read-only. Chats are never shown here (D-041). This view was recorded in the audit log.</div>
      <section class="grid2">
        <div class="card"><h2>Teams</h2>${raw(table(["Team", "Their roles", ""], d.teams.map((t) => html`<tr><td><a href="#/teams/${t.id}">${t.name}</a></td><td>${(t.roles ?? []).map(label).join(", ") || "Parent"}</td><td>${raw(t.is_pro ? badge("Pro", "info") : "")}</td></tr>`), "No teams."))}</div>
        <div class="card"><h2>Children</h2>${raw(table(["Child", "Team"], d.children.map((c) => html`<tr><td>${c.name}</td><td>${teamName[c.team_id] ?? ""}</td></tr>`), "No children."))}</div>
      </section>
      <section class="card"><h2>Schedule, next 3 weeks</h2>${raw(table(["When", "Event", "Team", "Their RSVPs"], d.upcoming.map((e) => html`<tr${raw(e.cancelled_at ? ' class="struck"' : "")}><td>${dateTime(e.starts_at)}</td><td>${e.title}${e.location ? ` · ${e.location}` : ""}${e.cancelled_at ? " (cancelled)" : ""}</td><td>${teamName[e.team_id] ?? ""}</td>
          <td>${e.my_rsvps.map((r) => `${kid[r.player_id] ?? "Self"}: ${label(r.status)}`).join(", ") || "No reply"}</td></tr>`), "Nothing scheduled."))}</section>
      <section class="grid2">
        <div class="card"><h2>Dues owed</h2>${raw(table(["For", "Child", "#Amount", "Due"], d.dues_owed.map((x) => html`<tr><td>${x.title}</td><td>${kid[x.player_id] ?? ""}</td><td class="numcol">${money(x.amount_cents)}</td><td>${date(x.due_date)}</td></tr>`), "Nothing owed."))}</div>
        <div class="card"><h2>Inbox</h2><p class="help">Subjects only.</p>${raw(table(["Notification", "Kind", "When", ""], d.inbox.map((n) => html`<tr><td>${n.subject}</td><td>${label(n.kind)}</td><td>${ago(n.created_at)}</td><td>${n.is_read ? "" : "Unread"}</td></tr>`), "Empty."))}</div>
      </section>`,
  };
}

// =====================================================================================
// Moderation
// =====================================================================================
async function renderModeration() {
  const status = new URLSearchParams(location.hash.split("?")[1] ?? "").get("status") ?? "open";
  const reports = await api.rpc("admin_reports", { _status: status });
  const card = (r) => {
    const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
    const left = 24 - ageH;
    const clock = r.status !== "open" ? badge(label(r.resolution ?? r.status), "neutral")
      : left <= 0 ? badge(`Overdue by ${Math.ceil(-left)} h`, "critical")
      : left < 2 ? badge(`${Math.ceil(left * 60)} min left`, "serious")
      : left < 8 ? badge(`${Math.floor(left)} h left`, "warning") : badge(`${Math.floor(left)} h left`, "good");
    return html`<article class="card report stack" data-id="${r.id}">
      <div class="row between"><div>${raw(clock)} ${raw(badge(label(r.reason), "neutral"))} <span class="muted">${r.kind === "message" ? "Message" : "Conversation"} · ${r.team_name ?? "Deleted team"} · ${r.snapshot_thread_title ?? "Team chat"}</span></div><span class="muted small">${dateTime(r.created_at)}</span></div>
      ${raw(r.kind === "message" ? html`<blockquote class="snapshot"><div class="muted small">${r.snapshot_author_name ?? "Member"} wrote${r.message_deleted_at ? " (since deleted)" : ""}:</div>${r.snapshot_body || "(photo only)"}</blockquote>` : "")}
      ${raw(r.note ? html`<p><strong>Reporter's note:</strong> ${r.note}</p>` : "")}
      <p class="muted small">Reported by ${raw(r.reporter_id ? html`<a href="#/people/${r.reporter_id}">${r.reporter_email ?? "member"}</a>` : "a deleted account")}
        ${raw(r.author_id ? html` · Author <a href="#/people/${r.author_id}">${r.author_email ?? "member"}</a> (${r.author_report_count} report${r.author_report_count === 1 ? "" : "s"} total${r.author_suspended_at ? ", suspended" : ""})` : "")}</p>
      ${raw(r.resolution_note ? html`<p class="muted"><strong>Resolution:</strong> ${r.resolution_note}</p>` : "")}
      ${raw(r.status === "open" ? html`<div class="row actions">
        ${raw(r.has_photo ? `<button class="btn btn-small" data-photo>View photo</button>` : "")}
        ${raw(r.message_id ? `<button class="btn btn-small btn-danger-outline" data-resolve="removed">Remove message</button>` : "")}
        ${raw(r.author_id ? `<button class="btn btn-small" data-resolve="warned">Warn author</button><button class="btn btn-small btn-danger-outline" data-resolve="suspended">Suspend author</button>` : "")}
        <button class="btn btn-small" data-resolve="dismissed">Dismiss</button></div>` : r.has_photo ? `<div class="row"><button class="btn btn-small" data-photo>View photo</button></div>` : "")}
    </article>`;
  };
  return {
    html: html`<h1>Moderation</h1>
      <div class="filters row"><a class="chip" href="#/moderation" ${raw(status === "open" ? 'aria-current="true"' : "")}>Open</a><a class="chip" href="#/moderation?status=actioned" ${raw(status === "actioned" ? 'aria-current="true"' : "")}>Actioned</a><a class="chip" href="#/moderation?status=dismissed" ${raw(status === "dismissed" ? 'aria-current="true"' : "")}>Dismissed</a><a class="chip" href="#/moderation?status=all" ${raw(status === "all" ? 'aria-current="true"' : "")}>All</a></div>
      <p class="help">The app tells members that reports are reviewed within 24 hours. You see only what was reported, as it looked when it was reported.</p>
      <div class="stack">${raw(reports.length ? reports.map(card).join("") : html`<p class="muted">${status === "open" ? "No open reports. 🎉" : "Nothing here."}</p>`)}</div>`,
    bind(root) {
      on(root, "[data-photo]", async (btn) => {
        const id = btn.closest("[data-id]").dataset.id;
        const r = await run(btn, () => api.act("report-photo", { report_id: id }));
        if (r?.url) window.open(r.url, "_blank", "noopener");
      });
      on(root, "[data-resolve]", async (btn) => {
        const id = btn.closest("[data-id]").dataset.id;
        const report = reports.find((x) => x.id === id);
        const resolution = btn.dataset.resolve;
        const titles = { removed: "Remove this message?", warned: "Warn the author?", suspended: "Suspend the author?", dismissed: "Dismiss this report?" };
        const fields = [{ name: "note", label: "Note (kept with the report)", type: "textarea", required: resolution !== "dismissed" }];
        if (resolution === "removed" || resolution === "warned") {
          fields.push({ name: "warn_message", label: resolution === "warned" ? "Warning sent to the author" : "Also warn the author (optional)", type: "textarea", required: resolution === "warned", max: 300,
            value: resolution === "warned" ? "A message you posted in ClubHQ was reported. Please keep team conversations respectful." : "" });
        }
        const v = await dialog({
          title: titles[resolution],
          message: resolution === "suspended" ? "The message is removed and the author is suspended until you unsuspend them." : resolution === "removed" ? "It's removed for everyone in the conversation, photos included." : "",
          fields, submit: label(resolution === "dismissed" ? "dismiss" : resolution === "removed" ? "remove" : resolution === "warned" ? "send warning" : "suspend"),
          danger: resolution === "removed" || resolution === "suspended",
          confirmText: resolution === "suspended" ? report.author_email ?? "SUSPEND" : null,
        });
        if (!v) return;
        const r = await run(btn, () => api.act("resolve-report", { report_id: id, resolution, note: v.note, warn_message: v.warn_message }), "Report resolved.");
        if (r?.effects?.warning && !r.effects.warning.configured) toast("Phone push isn't set up yet (OQ-04), so the warning didn't reach their phone. Email them instead.", true);
        if (r) reload();
      });
    },
  };
}

// =====================================================================================
// Grants
// =====================================================================================
function grantRow(g) {
  const live = g.live ?? (!g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()));
  const status = g.revoked_at ? badge("Revoked", "neutral") : live ? badge("Active", "good") : badge("Expired", "neutral");
  const target = g.target_name ? html`${label(g.target_type)}: ${g.target_name}` : label(g.user_id ? "user" : g.team_id ? "team" : "club");
  return html`<tr><td>${raw(target)}</td><td>${g.reason}</td><td>${g.expires_at ? date(g.expires_at) : "No end date"}</td><td>${raw(status)}</td>
    <td>${raw(live ? html`<button class="btn btn-small" data-revoke="${g.id}">Revoke</button>` : "")}</td></tr>`;
}

function bindGrantRevokes(root) {
  on(root, "[data-revoke]", async (btn) => {
    const v = await dialog({ title: "Revoke this grant?", message: "Pro turns off right away unless they also pay through the App Store.", submit: "Revoke", danger: true });
    if (v && (await run(btn, () => api.act("revoke-grant", { grant_id: btn.dataset.revoke }), "Grant revoked."))) reload();
  });
}

async function grantDialog(button, targetType, targetId, targetName) {
  const v = await dialog({
    title: `Grant Coach Pro: ${targetName}`,
    message: targetType === "user" ? "Pro for this coach on every team they head-coach." : targetType === "team" ? "Pro features on this team, whoever coaches it." : "Pro on every team in this club.",
    fields: [
      { name: "reason", label: "Reason", required: true, max: 200, value: "Beta tester" },
      { name: "expires", label: isOwner() ? "Ends on (leave empty for no end date)" : "Ends on (up to 90 days)", type: "date", value: defaultExpiry(30), required: !isOwner() },
    ],
    submit: "Grant Pro",
  });
  if (v && (await run(button, () => api.act("grant-pro", { target_type: targetType, target_id: targetId, reason: v.reason, expires_at: endOfDay(v.expires) }), "Pro granted."))) reload();
}

async function renderGrants() {
  const [grants, teams] = await Promise.all([api.rpc("admin_grants"), teamsCache()]);
  const clubs = [...new Map(teams.filter((t) => t.org?.type === "club").map((t) => [t.org.id, t.org])).values()];
  return {
    html: html`<h1>Pro grants</h1>
      <p class="help">Pro = an App Store subscription or a grant. Grants switch themselves off when they end. To grant a person or a team, open them from People or Teams.</p>
      <div class="actions row">${raw(isOwner() ? html`<button class="btn" id="grant-club" ${raw(clubs.length ? "" : "disabled")}>Grant a whole club…</button>` : "")}</div>
      <section class="card">${raw(table(["Target", "Reason", "Ends", "Status", ""], grants.map(grantRow), "No grants yet."))}</section>`,
    bind(root) {
      root.querySelector("#grant-club")?.addEventListener("click", async (e) => {
        const v = await dialog({ title: "Which club?", fields: [{ name: "org", label: "Club", type: "select", options: clubs.map((c) => ({ value: c.id, label: c.name })), required: true }], submit: "Next" });
        if (v) grantDialog(e.target, "org", v.org, clubs.find((c) => c.id === v.org)?.name ?? "club");
      });
      bindGrantRevokes(root);
    },
  };
}

// =====================================================================================
// Revenue
// =====================================================================================
async function renderRevenue() {
  const [o, r] = await Promise.all([api.rpc("admin_overview"), api.rpc("admin_revenue")]);
  const subs = r.subscriptions.map((s) => html`<tr><td>${raw(s.user_id ? html`<a href="#/people/${s.user_id}">${s.email ?? s.user_id}</a>` : "—")}</td>
      <td>${s.product_id.endsWith("yearly") ? "Yearly" : "Monthly"}</td><td>${label(s.status)}${s.in_trial ? " (trial)" : ""}</td><td>${s.auto_renew ? "On" : "Off"}</td>
      <td>${date(s.expires_at)}</td><td>${s.environment === "Production" ? "" : raw(badge("Sandbox", "neutral"))}</td><td>${date(s.created_at)}</td></tr>`);
  const events = r.events.map((e) => html`<tr><td>${label(e.notification_type)}${e.subtype ? ` · ${label(e.subtype)}` : ""}</td><td>${raw(e.user_id ? html`<a href="#/people/${e.user_id}">${e.email ?? "user"}</a>` : "—")}</td>
      <td>${e.product_id?.endsWith("yearly") ? "Yearly" : "Monthly"}</td><td>${e.environment === "Production" ? "Production" : "Sandbox"}</td><td>${dateTime(e.received_at)}</td></tr>`);
  return {
    html: html`<h1>Revenue</h1>
      <section class="tiles">
        <div class="tile card"><div class="tile-value">${money(o.mrr_cents_estimate)}</div><div class="tile-label">Est. monthly revenue</div><div class="tile-sub muted">List prices ($9.99/mo, $69.99/yr); Apple keeps 15–30%</div></div>
        <div class="tile card"><div class="tile-value">${num(o.pro_paid)}</div><div class="tile-label">Paying</div></div>
        <div class="tile card"><div class="tile-value">${num(o.pro_trial)}</div><div class="tile-label">In free trial</div></div>
        <div class="tile card"><div class="tile-value">${num(o.pro_cancelling)}</div><div class="tile-label">Cancelling</div><div class="tile-sub muted">Auto-renew off; Pro until period end</div></div>
        <div class="tile card"><div class="tile-value">${num(o.pro_granted)}</div><div class="tile-label">Granted</div></div>
      </section>
      <section class="card"><h2>Subscriptions</h2>${raw(table(["Coach", "Plan", "Status", "Auto-renew", "Expires", "", "Started"], subs, "No subscriptions yet."))}</section>
      <section class="card"><h2>App Store events</h2><p class="help">Every notification Apple sends: new subscribers, renewals, cancellations, billing problems, refunds. History starts 2026-10-25.</p>${raw(table(["Event", "Coach", "Plan", "Environment", "Received"], events, "None yet."))}</section>
      <p class="muted small">For payouts, App Store Connect → Payments and Financial Reports is the source of truth.</p>`,
  };
}

// =====================================================================================
// Broadcast
// =====================================================================================
async function renderBroadcast() {
  const teams = await teamsCache();
  const clubs = [...new Map(teams.filter((t) => t.org?.type === "club").map((t) => [t.org.id, t.org])).values()];
  const preview = await api.rpc("admin_broadcast_preview", { _segment: { kind: "all" } });
  const KINDS = [["all", "Everyone"], ["coaches", "All coaches and staff"], ["head_coaches", "Head coaches"], ["parents", "Parents and guardians"], ["players", "Players (13+)"], ["pro_coaches", "Pro coaches"], ["team", "One team"], ["org", "One club"]];
  const history = preview.history.map((b) => html`<tr><td>${b.title}${b.is_test ? " " : ""}${raw(b.is_test ? badge("Test", "neutral") : "")}</td><td>${label(b.segment.kind)}</td>
      <td class="numcol">${num(b.recipients)}</td><td class="numcol">${num(b.delivered)}</td><td>${b.sent_by_email ?? ""}</td><td>${dateTime(b.created_at)}</td></tr>`);
  return {
    html: html`<h1>Broadcast</h1>
      ${raw(state.config?.apns_configured ? "" : html`<div class="banner banner-critical">${raw(badge("Push not set up", "critical"))} The APNs key isn't configured yet (OQ-04), so broadcasts are recorded but won't reach phones.</div>`)}
      <form class="card stack" id="bc-form">
        <label for="bc-kind">Audience</label>
        <select id="bc-kind" name="kind">${raw(KINDS.map(([v, t]) => html`<option value="${v}">${t}</option>`).join(""))}</select>
        <div id="bc-team-wrap" hidden><label for="bc-team">Team</label><select id="bc-team">${raw(teams.filter((t) => !t.archived_at).map((t) => html`<option value="${t.id}">${t.name}</option>`).join(""))}</select></div>
        <div id="bc-org-wrap" hidden><label for="bc-org">Club</label><select id="bc-org">${raw(clubs.map((c) => html`<option value="${c.id}">${c.name}</option>`).join(""))}</select></div>
        <p id="bc-count" class="muted" aria-live="polite">${num(preview.recipients)} people · ${num(preview.with_devices)} with push turned on</p>
        <label for="bc-title">Title</label><input id="bc-title" name="title" maxlength="80" required placeholder="New in ClubHQ">
        <label for="bc-body">Message</label><textarea id="bc-body" name="body" rows="3" maxlength="300" required></textarea>
        <div class="row"><button type="button" class="btn" id="bc-test">Send test to me</button><button type="submit" class="btn btn-primary">Send…</button></div>
        <p class="help">Suspended accounts never receive broadcasts. Every send is in the audit log.</p>
      </form>
      <section class="card"><h2>Recent broadcasts</h2>${raw(table(["Title", "Audience", "#Recipients", "#Delivered", "Sent by", "When"], history, "Nothing sent yet."))}</section>`,
    bind(root) {
      const kind = root.querySelector("#bc-kind");
      const segment = () => {
        const k = kind.value;
        return k === "team" ? { kind: k, id: root.querySelector("#bc-team").value } : k === "org" ? { kind: k, id: root.querySelector("#bc-org").value } : { kind: k };
      };
      let last = preview;
      const refresh = async () => {
        root.querySelector("#bc-team-wrap").hidden = kind.value !== "team";
        root.querySelector("#bc-org-wrap").hidden = kind.value !== "org";
        last = await api.rpc("admin_broadcast_preview", { _segment: segment() });
        root.querySelector("#bc-count").textContent = `${num(last.recipients)} people · ${num(last.with_devices)} with push turned on`;
      };
      root.querySelectorAll("#bc-kind, #bc-team, #bc-org").forEach((el) => el.addEventListener("change", () => refresh().catch((e) => toast(e.message, true))));
      const values = () => ({ title: root.querySelector("#bc-title").value.trim(), body: root.querySelector("#bc-body").value.trim() });
      root.querySelector("#bc-test").addEventListener("click", async (e) => {
        const v = values();
        if (!v.title || !v.body) return toast("Add a title and a message first.", true);
        const r = await run(e.target, () => api.act("broadcast", { ...v, segment: segment(), test: true }));
        if (r) toast(r.configured ? `Test sent to ${r.delivered} of your ${r.devices} device(s).` : "Recorded, but phone push isn't set up yet (OQ-04).", !r.configured);
      });
      root.querySelector("#bc-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = values();
        const ok = await dialog({ title: "Send this broadcast?", message: `“${v.title}” goes to ${num(last.recipients)} people (${num(last.with_devices)} with push). This can't be unsent.`, submit: "Send now", danger: true, confirmText: "SEND" });
        if (!ok) return;
        const r = await run(e.submitter, () => api.act("broadcast", { ...v, segment: segment(), test: false }));
        if (r) {
          toast(r.configured ? `Delivered to ${r.delivered} device(s).` : "Recorded, but phone push isn't set up yet (OQ-04).", !r.configured);
          reload();
        }
      });
    },
  };
}

// =====================================================================================
// Audit log
// =====================================================================================
function auditTable(rows) {
  return table(["Action", "By", "Details", "When"], rows.map((l) => html`<tr><td><code>${l.action.replace(/^admin\./, "")}</code></td><td>${l.actor_email ?? "—"}</td>
      <td class="small">${raw(l.target_table === "auth.users" && l.target_id ? html`<a href="#/people/${l.target_id}">person</a> ` : l.team_id ? html`<a href="#/teams/${l.team_id}">team</a> ` : "")}<code class="meta">${Object.keys(l.metadata ?? {}).length ? JSON.stringify(l.metadata) : ""}</code></td>
      <td>${dateTime(l.created_at)}</td></tr>`), "No admin actions yet.");
}

async function renderAudit() {
  const rows = await api.rpc("admin_audit", { _limit: 300 });
  return { html: html`<h1>Audit log</h1><p class="help">Every admin action, including each “view as” and every reported photo opened. Newest first.</p><section class="card">${raw(auditTable(rows))}</section>` };
}

// =====================================================================================
// Settings: admins and this device's alerts
// =====================================================================================
const ALERTS = [["report", "New reports"], ["team", "New teams"], ["subscription", "Subscription changes"], ["account", "Account deletions"]];

function urlB64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function renderSettings() {
  const admins = await api.rpc("admin_admins");
  const sub = await currentPushSubscription().catch(() => null);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const isiOS = /iPhone|iPad/.test(navigator.userAgent);
  const rows = admins.map((a) => html`<tr><td>${a.email}</td><td>${label(a.role)}</td><td>${a.removed_at ? "Removed" : a.claimed ? "Active" : "Invited (hasn't signed in)"}</td><td>${date(a.created_at)}</td>
      <td>${raw(isOwner() && !a.removed_at && a.email !== state.me.email ? html`<button class="btn btn-small" data-remove="${a.id}" data-email="${a.email}">Remove</button>` : "")}</td></tr>`);
  return {
    html: html`<h1>Settings</h1>
      <section class="card stack"><h2>Alerts on this device</h2>
        ${raw(!state.config?.web_push_configured ? html`<p class="error">Web push isn't configured on the server.</p>` : "")}
        ${raw(isiOS && !standalone ? html`<div class="banner">On iPhone, alerts work after you add this portal to your Home Screen: tap Share → <strong>Add to Home Screen</strong>, open it from there, and come back to this page.</div>` : "")}
        ${raw(!supported ? html`<p class="muted">This browser doesn't support web push.</p>` : html`
          <fieldset class="checks"><legend>Alert me about</legend>${raw(ALERTS.map(([v, t]) => html`<label class="check"><input type="checkbox" name="alert" value="${v}" checked> ${t}</label>`).join(""))}</fieldset>
          <div class="row">
            <button class="btn btn-primary" id="push-on">${sub ? "Update alerts" : "Turn on alerts"}</button>
            ${raw(sub ? `<button class="btn" id="push-test">Send a test</button><button class="btn" id="push-off">Turn off</button>` : "")}
          </div>
          <p class="muted small">${sub ? "Alerts are on for this device." : "Alerts are off for this device."}</p>`)}
      </section>
      <section class="card"><h2>Admins</h2>
        ${raw(table(["Email", "Role", "Status", "Added", ""], rows))}
        ${raw(isOwner() ? `<div class="row"><button class="btn" id="add-admin">Add an admin…</button></div>` : "")}
        <p class="help"><strong>Owner</strong> can do everything. <strong>Support</strong> can't delete now, merge accounts, manage admins, grant a whole club, or grant more than 90 days. Everyone needs an authenticator app.</p>
      </section>
      <section class="card stack"><h2>Session</h2><p class="muted">Signed in as ${state.me.email}. Sessions end after 12 hours.</p><div class="row"><button class="btn" id="signout">Sign out</button></div></section>`,
    bind(root) {
      root.querySelector("#signout").addEventListener("click", signOut);
      root.querySelector("#push-on")?.addEventListener("click", async (e) => {
        const alerts = [...root.querySelectorAll("input[name=alert]:checked")].map((i) => i.value);
        const ok = await run(e.target, async () => {
          if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser or iPhone settings.");
          const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
          await navigator.serviceWorker.ready;
          const s = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(state.config.vapid_public_key) }));
          const j = s.toJSON();
          await api.act("push-subscribe", { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, alerts, user_agent: navigator.userAgent.slice(0, 300) });
        }, "Alerts are on for this device.");
        if (ok) reload();
      });
      root.querySelector("#push-test")?.addEventListener("click", (e) => run(e.target, () => api.act("push-test"), (r) => (r.sent ? "Test alert sent." : "No alert was delivered. Try turning alerts off and on.")));
      root.querySelector("#push-off")?.addEventListener("click", async (e) => {
        const ok = await run(e.target, async () => {
          const s = await currentPushSubscription();
          if (s) {
            await api.act("push-unsubscribe", { endpoint: s.endpoint });
            await s.unsubscribe();
          }
        }, "Alerts are off for this device.");
        if (ok) reload();
      });
      root.querySelector("#add-admin")?.addEventListener("click", async (e) => {
        const v = await dialog({ title: "Add an admin", message: "They sign in here with this email and set up an authenticator app on first sign-in.", fields: [
          { name: "email", label: "Email", type: "email", required: true },
          { name: "role", label: "Role", type: "select", options: [{ value: "support", label: "Support" }, { value: "owner", label: "Owner" }], value: "support" },
        ], submit: "Add admin" });
        if (v && (await run(e.target, () => api.act("add-admin", v), "Admin added."))) reload();
      });
      on(root, "[data-remove]", async (btn) => {
        const v = await dialog({ title: `Remove ${btn.dataset.email}?`, message: "They lose admin access immediately.", submit: "Remove admin", danger: true, confirmText: btn.dataset.email });
        if (v && (await run(btn, () => api.act("remove-admin", { id: btn.dataset.remove }), "Admin removed."))) reload();
      });
    },
  };
}

// =====================================================================================
window.addEventListener("hashchange", route);
// Notification taps from the service worker land on a route.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (typeof e.data?.url === "string" && e.data.url.startsWith("#/")) location.hash = e.data.url;
});
gate();

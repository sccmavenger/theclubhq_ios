// Seeds "St. Louis Mavericks 14U", a full demo team for coach demos, owned by dguilloryjr@msn.com.
// Idempotent-ish: re-running reuses accounts and replaces the team. Never prints secrets.
import fs from "fs";
import postgres from "postgres";

const env = Object.fromEntries(fs.readFileSync("/Users/dannyjr/GitHub/ClubHQ/.env.local", "utf8").split("\n")
  .filter(l => l && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const U = env.SUPABASE_URL;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })).json();
const secret = keys.find(k => k.type === "secret").api_key;
const admin = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
const sql = postgres(env.SUPABASE_DB_URL, { ssl: "require", max: 1, onnotice: () => {} });

const OWNER_EMAIL = "dguilloryjr@msn.com";
const DEMO_PASSWORD = "ClubHQ-Demo-2026!";
const TEAM = "St. Louis Mavericks 14U";

async function ensureUser(email, fullName) {
  const [row] = await sql`select id from auth.users where email = ${email}`;
  if (row) return row.id;
  const r = await (await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: admin,
    body: JSON.stringify({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }) })).json();
  if (!r.id) throw new Error(`create ${email}: ${JSON.stringify(r).slice(0, 200)}`);
  return r.id;
}

const [owner] = await sql`select id from auth.users where email = ${OWNER_EMAIL}`;
if (!owner) throw new Error("owner account not found");
const coach = owner.id;

// Cast
const assistant = await ensureUser("info+mav-assistant@teamclubhq.com", "Marcus Bell");
const roster = [
  // first, last, jersey, position, age, parent first, parent last, relationship
  ["Jalen", "Carter", "3", "Point Guard", 14, "Tasha", "Carter", "mother"],
  ["Mason", "Reyes", "11", "Shooting Guard", 14, "Carlos", "Reyes", "father"],
  ["Ethan", "Brooks", "24", "Small Forward", 14, "Monica", "Brooks", "mother"],
  ["Noah", "Patel", "5", "Power Forward", 13, "Raj", "Patel", "father"],
  ["Isaiah", "Thompson", "32", "Center", 14, "Keisha", "Thompson", "mother"],
  ["Caleb", "Nguyen", "1", "Point Guard", 13, "Linh", "Nguyen", "mother"],
  ["Elijah", "Washington", "15", "Small Forward", 14, "Andre", "Washington", "father"],
  ["Lucas", "Schmidt", "8", "Shooting Guard", 13, "Erin", "Schmidt", "mother"],
  ["Aiden", "Harris", "21", "Power Forward", 14, "Derek", "Harris", "father"],
  ["Jordan", "Mitchell", "10", "Shooting Guard", 13, "Nicole", "Mitchell", "mother"],
  ["Cameron", "Lopez", "23", "Center", 14, "Gabriela", "Lopez", "mother"],
  ["Dylan", "Foster", "4", "Point Guard", 13, "Ryan", "Foster", "father"],
];
const parents = [];
for (const r of roster) {
  const slug = `${r[5]}.${r[6]}`.toLowerCase();
  parents.push(await ensureUser(`info+mav-${slug}@teamclubhq.com`, `${r[5]} ${r[6]}`));
}
const jalenLogin = await ensureUser("info+mav-jalen@teamclubhq.com", "Jalen Carter");
console.log("accounts ready:", parents.length + 3);

await sql.begin(async (tx) => {
  // Replace any previous copy of the demo team.
  const old = await tx`select id, org_id from public.teams where name = ${TEAM} and created_by = ${coach}`;
  for (const t of old) {
    await tx`delete from public.user_roles where team_id = ${t.id}`;
    await tx`delete from public.teams where id = ${t.id}`;
    await tx`delete from public.organizations where id = ${t.org_id}`;
  }

  // Complimentary Coach Pro for the owner (shows Pro features in demos; up to 3 teams).
  await tx`insert into public.app_store_subscriptions (original_transaction_id, user_id, product_id, status, expires_at, environment, auto_renew)
           values ('comp-owner-dguilloryjr', ${coach}, 'com.teamclubhq.pro.yearly', 'active', null, 'Comp', false)
           on conflict (original_transaction_id) do update set status = 'active', expires_at = null`;

  const [org] = await tx`insert into public.organizations (name, type, created_by) values (${TEAM}, 'independent', ${coach}) returning id`;
  const [team] = await tx`insert into public.teams (org_id, name, age_group, season, sport, brand_color, created_by)
                          values (${org.id}, ${TEAM}, '14U', 'Fall 2026', 'basketball', '#2457F5', ${coach}) returning id`;
  const T = team.id;
  await tx`insert into public.user_roles (user_id, role, team_id, org_id) values
           (${coach}, 'head_coach', ${T}, ${org.id}), (${assistant}, 'assistant_coach', ${T}, ${org.id})`;

  // Roster, guardians, emergency contacts.
  const playerIds = [];
  for (const [i, r] of roster.entries()) {
    const [first, last, jersey, position, age, pFirst, pLast, rel] = r;
    const birth = `${new Date().getFullYear() - age}-0${(i % 9) + 1}-1${i % 9}`;
    const [p] = await tx`insert into public.players (team_id, first_name, last_name, jersey_number, position, birthdate, created_by, notes)
      values (${T}, ${first}, ${last}, ${jersey}, ${position}, ${birth}, ${coach},
              ${i === 0 ? "Team captain. Great court vision — working on left-hand finishes." : i === 4 ? "Strong rebounder. Focus: free throws." : null})
      returning id`;
    playerIds.push(p.id);
    await tx`insert into public.parent_player_links (player_id, parent_user_id, relationship) values (${p.id}, ${parents[i]}, ${rel})`;
    await tx`insert into public.user_roles (user_id, role, team_id) values (${parents[i]}, 'parent', ${T})`;
    await tx`insert into public.player_emergency_contacts (player_id, relationship, name, phone, email, created_by)
             values (${p.id}, ${rel}, ${pFirst + " " + pLast}, ${"(314) 555-" + String(1200 + i * 7).padStart(4, "0")}, null, ${parents[i]})`;
  }
  // Jalen (14) has his own player login.
  await tx`update public.players set user_id = ${jalenLogin} where id = ${playerIds[0]}`;
  await tx`insert into public.user_roles (user_id, role, team_id) values (${jalenLogin}, 'player', ${T})`;

  // Schedule — local times in America/Chicago.
  const at = (dayOffset, hhmm) => tx`select ((current_date + ${dayOffset}::int) + ${hhmm}::time) at time zone 'America/Chicago' as t`.then(r => r[0].t);
  const gym = ["Rec-Plex North", "425 Spencer Rd, St. Peters, MO 63376"];
  const away = ["Chesterfield Athletic Center", "16365 Lydia Hill Dr, Chesterfield, MO 63017"];
  const events = [];
  async function event(day, time, minutes, type, title, loc, extra = {}) {
    const start = await at(day, time);
    const [e] = await tx`insert into public.events (team_id, title, event_type, starts_at, ends_at, location, location_address, notes,
        opponent, home_away, home_score, away_score, result, rsvp_cutoff_at, created_by)
      values (${T}, ${title}, ${type}, ${start}, ${new Date(start.getTime() + minutes * 60000)}, ${loc[0]}, ${loc[1]}, ${extra.notes ?? null},
        ${extra.opponent ?? null}, ${extra.homeAway ?? null}, ${extra.home ?? null}, ${extra.away ?? null}, ${extra.result ?? null},
        ${new Date(start.getTime() - 4 * 3600000)}, ${coach}) returning id, starts_at`;
    events.push({ ...e, type, day });
    return e;
  }
  // Past
  const g1 = await event(-12, "10:00", 60, "game", "Game vs Gateway Hoops", gym, { opponent: "Gateway Hoops", homeAway: "home", home: 52, away: 44, result: "win", notes: "Arrive 30 min early. Dark jerseys." });
  const p1 = await event(-9, "18:00", 90, "practice", "Practice", gym);
  const p2 = await event(-7, "18:00", 90, "practice", "Practice", gym);
  const g2 = await event(-5, "11:00", 60, "game", "Game at STL Stars", away, { opponent: "STL Stars", homeAway: "away", home: 41, away: 38, result: "loss", notes: "Arrive 30 min early. White jerseys." });
  const p3 = await event(-2, "18:00", 90, "practice", "Practice", gym);
  // Upcoming
  const p4 = await event(1, "18:00", 90, "practice", "Practice", gym, { notes: "Bring both jerseys. Shooting drills + press break." });
  const g3 = await event(4, "10:00", 60, "game", "Game vs Lake Saint Louis Lakers", gym, { opponent: "Lake Saint Louis Lakers", homeAway: "home", notes: "Arrive by 9:30. Dark jerseys." });
  await event(6, "18:00", 90, "practice", "Practice", gym);
  await event(8, "18:00", 90, "practice", "Practice", gym);
  await event(9, "19:00", 45, "other", "Team photos + parent meeting", gym, { notes: "Full uniform for photos. Parent meeting covers the tournament weekend." });
  await event(11, "09:00", 60, "game", "Gateway Fall Classic — Pool Game 1", away, { opponent: "MO Hoopers", homeAway: "away", notes: "Tournament weekend. Two pool games Saturday." });
  await event(11, "13:00", 60, "game", "Gateway Fall Classic — Pool Game 2", away, { opponent: "Metro East Elite", homeAway: "away" });
  await event(13, "18:00", 90, "practice", "Practice", gym);
  await event(15, "18:00", 90, "practice", "Practice", gym);
  await event(18, "11:00", 60, "game", "Game vs O'Fallon Panthers", gym, { opponent: "O'Fallon Panthers", homeAway: "home" });

  // Attendance on past events.
  for (const e of [g1, p1, p2, g2, p3]) {
    for (const [i, pid] of playerIds.entries()) {
      const status = (i + e.starts_at.getDate()) % 11 === 0 ? "absent" : (i + e.starts_at.getDate()) % 7 === 0 ? "late" : (i * 3 + e.starts_at.getDate()) % 13 === 0 ? "excused" : "present";
      await tx`insert into public.attendance (event_id, player_id, status, marked_by) values (${e.id}, ${pid}, ${status}, ${coach})`;
    }
  }
  // RSVPs for the next practice and next game.
  const rsvp = async (eid, idx, status, note = null) =>
    tx`insert into public.rsvps (event_id, player_id, status, note, responded_by) values (${eid}, ${playerIds[idx]}, ${status}, ${note}, ${parents[idx]})`;
  for (const i of [0, 1, 2, 3, 4, 6, 7, 9]) await rsvp(p4.id, i, "yes");
  await rsvp(p4.id, 5, "maybe", "Might be 15 min late — work runs late Thursdays.");
  await rsvp(p4.id, 8, "no", "Dentist appointment, sorry!");
  for (const i of [0, 1, 2, 4, 5, 6, 9, 10, 11]) await rsvp(g3.id, i, "yes");
  await rsvp(g3.id, 3, "no", "Out of town for a family wedding.");

  // Announcements
  const ann = [
    ["Gateway Fall Classic — we're in! 🏆", "We're entered in the Gateway Fall Classic (pool play on Saturday the " + new Date(Date.now() + 11 * 86400000).getDate() + "th). Entry fee is in the app under Payments. Please RSVP to both games by Wednesday.", -3],
    ["New reversible jerseys", "Jerseys are here! Pick them up at Thursday's practice. Sizes are on the roster sheet — let me know if anything doesn't fit.", -6],
    ["Welcome to the Mavericks", "Welcome to the Fall 2026 season! Everything lives in ClubHQ: schedule, RSVPs, team chat, and dues. Please add an emergency contact for your player.", -20],
  ];
  for (const [title, body, d] of ann) {
    await tx`insert into public.announcements (team_id, title, body, created_by, created_at) values (${T}, ${title}, ${body}, ${coach}, now() + ${d + " days"}::interval)`;
  }

  // Messaging
  const thread = async (title, audience, pinned) =>
    (await tx`insert into public.message_threads (team_id, kind, audience, title, pinned, created_by) values (${T}, 'team', ${audience}, ${title}, ${pinned}, ${coach}) returning id`)[0].id;
  const chat = await thread("Team chat", "both", true);
  const carpool = await thread("Tournament carpool", "parents", false);
  const staff = await thread("Coaches", "staff", false);
  const say = async (tid, author, body, dayOffset, hhmm) =>
    tx`insert into public.messages (thread_id, author_id, body, created_at) values (${tid}, ${author}, ${body}, ${await at(dayOffset, hhmm)})`;
  await say(chat, coach, "Tough one at STL Stars — lost by 3, but the second-half defense was our best of the season. Proud of you guys. 🏀", -5, "13:10");
  await say(chat, parents[0], "They played so hard. Thanks coaches!", -5, "13:22");
  await say(chat, jalenLogin, "Can we work on the press break at practice?", -5, "15:40");
  await say(chat, coach, "That's the plan for Thursday. Press break + free throws.", -5, "16:05");
  await say(chat, parents[4], "Isaiah wants to know if we're doing team shooting shirts for the tournament 👀", -3, "19:12");
  await say(chat, assistant, "Working on it — order form coming this week.", -3, "19:30");
  await say(chat, parents[1], "Is Saturday's game still at 10? Want to plan around Mason's sister's recital.", -1, "12:47");
  await say(chat, coach, "Yes — tip-off 10:00, arrive by 9:30. Dark jerseys.", -1, "13:02");
  await say(chat, coach, "Reminder: practice Thursday 6pm at Rec-Plex North. Bring both jerseys 👕", -1, "18:30");
  await say(carpool, parents[2], "I can drive 3 kids to Chesterfield for the tournament — leaving St. Peters at 7:45.", -2, "20:15");
  await say(carpool, parents[6], "That would be amazing. Elijah + Aiden need a ride if there's room!", -2, "20:31");
  await say(carpool, parents[8], "We can take 2 for the afternoon game.", -1, "08:05");
  await say(staff, assistant, "I'll bring the new pinnies and the shot clock Thursday.", -1, "09:40");
  await say(staff, coach, "Perfect. Let's split into two groups for press break reps.", -1, "10:02");
  await tx`update public.message_threads set updated_at = now() where team_id = ${T}`;
  await tx`insert into public.message_reads (user_id, thread_id, last_read_at) values (${coach}, ${staff}, now())`;

  // Dues (cash/Venmo recorded by the coach, since card payments aren't live yet).
  const [d1] = await tx`insert into public.dues_requests (team_id, title, description, amount_cents, due_date, created_by, created_at)
    values (${T}, 'Fall season dues', 'Gym rental, league fees, and reversible jerseys for Fall 2026.', 17500, current_date + 5, ${coach}, now() - interval '18 days') returning id`;
  const [d2] = await tx`insert into public.dues_requests (team_id, title, description, amount_cents, due_date, created_by, created_at)
    values (${T}, 'Gateway Fall Classic entry', 'Tournament entry and referee fees.', 4500, current_date + 9, ${coach}, now() - interval '3 days') returning id`;
  for (const [i, pid] of playerIds.entries()) {
    const paid = i < 8, waived = i === 11;
    await tx`insert into public.dues_items (request_id, player_id, amount_cents, status, paid_at, paid_by)
      values (${d1.id}, ${pid}, 17500, ${paid ? "paid" : waived ? "waived" : "unpaid"}, ${paid ? sql`now() - ${(i + 1) + " days"}::interval` : null}, ${paid ? coach : null})`;
    await tx`insert into public.dues_items (request_id, player_id, amount_cents, status, paid_at, paid_by)
      values (${d2.id}, ${pid}, 4500, ${i < 3 ? "paid" : "unpaid"}, ${i < 3 ? sql`now() - interval '1 day'` : null}, ${i < 3 ? coach : null})`;
  }

  // A couple of inbox notifications for the coach.
  const note = async (kind, subject, body, ref, link, hoursAgo) => {
    const [n] = await tx`insert into public.notifications (team_id, kind, subject, body, ref_id) values (${T}, ${kind}, ${subject}, ${body}, ${ref}) returning id`;
    await tx`insert into public.notification_sends (notification_id, recipient_user_id, recipient_email, status, link_path, created_at, apns_sent_at)
             values (${n.id}, ${coach}, ${OWNER_EMAIL}, 'sent', ${link}, now() - ${hoursAgo + " hours"}::interval, now())`;
  };
  await note("message_new", "Tournament carpool", "We can take 2 for the afternoon game.", carpool, `/team/messages/${carpool}`, 6);
  await note("rsvp_reminder", "2 players haven't RSVP'd", "Practice Thursday — RSVPs close 4 hours before.", p4.id, `/event/${p4.id}`, 10);

  // Team code for demoing the parent "join" flow.
  const code = "MAVS" + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "7");
  await tx`insert into public.team_invites (team_id, token, created_by, expires_at) values (${T}, ${code.slice(0, 10)}, ${coach}, now() + interval '90 days')`;
  console.log("team:", TEAM, "| players:", playerIds.length, "| events:", events.length, "| team code:", code.slice(0, 10));
});
await sql.end();

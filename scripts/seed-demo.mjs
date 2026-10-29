// 2.0 demo world (2026-10-29): wipes all app data and seeds 4 independent teams (one Avengers-themed)
// plus "Gateway Rise Basketball Club" with 16 teams. Every team has coaches, families, a schedule
// with past results and attendance, RSVPs, announcements, chats, dues and inbox items.
//
//   node seed-demo.mjs --wipe     wipe, then seed (asks for nothing; take a backup first)
//   node seed-demo.mjs            seed only (fails if the demo teams already exist)
//
// Kept on wipe: the owner's logins (KEEP_EMAILS), their profiles, platform admins, device tokens,
// calendar feeds and push subscriptions. Everything else in public.* and every other auth user goes.
// All demo accounts are info+…@teamclubhq.com (counted as internal, D-041) with DEMO_PASSWORD.
// Writes the demo logins to ClubHQ/.secrets/demo-logins.md. Never prints secrets.
// Needs the `postgres` package: run from a folder that has it installed.
import fs from "fs";
import postgres from "postgres";

const ROOT = "/Users/dannyjr/GitHub/ClubHQ";
const env = Object.fromEntries(fs.readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")
  .filter(l => l && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const U = env.SUPABASE_URL;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })).json();
const secret = keys.find(k => k.type === "secret").api_key;
const adminHeaders = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
const sql = postgres(env.SUPABASE_DB_URL, { ssl: "require", max: 4, onnotice: () => {} });

const OWNER_EMAIL = "dguilloryjr@msn.com";
const KEEP_EMAILS = ["dguilloryjr@msn.com", "dguilloryjr@gmail.com"];
const KEEP_TABLES = ["profiles", "platform_admins", "device_tokens", "calendar_feeds", "push_subscriptions", "admin_push_subscriptions"];
const DEMO_PASSWORD = "ClubHQ-Demo-2026!";
const TZ = "America/Chicago";
const SEASON = "Fall 2026";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
let seed = 20261029;
function rand() { // mulberry32: same demo every run
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rand() * a.length)];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Team/club code derived from a fixed key, so re-seeding on another day keeps the same codes
 *  (the App Review notes quote one). */
function stableCode(key, n = 10) {
  let h = 2166136261;
  for (const ch of `clubhq-demo:${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let out = "";
  for (let i = 0; i < n; i++) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) ^ i; out += CODE_ALPHABET[(h >>> 0) % CODE_ALPHABET.length]; }
  return out;
}

function tzOffset(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}
const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
  .formatToParts(new Date()).map(x => [x.type, x.value]));
/** Local Chicago time `hhmm` on today + dayOffset, as a Date. */
function at(dayOffset, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const local = Date.UTC(+todayParts.year, +todayParts.month - 1, +todayParts.day + dayOffset, h, m);
  let t = local - tzOffset(local);
  t = local - tzOffset(t);
  return new Date(t);
}
const weekday = (dayOffset) => at(dayOffset, "12:00").toLocaleDateString("en-US", { timeZone: TZ, weekday: "long" });
const dateLabel = (dayOffset) => at(dayOffset, "12:00").toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
/** Next offset (>= from) that falls on the weekday (0 = Sunday). */
function nextDow(from, dow) {
  for (let d = from; d < from + 7; d++) if (at(d, "12:00").toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }) === ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]) return d;
  return from;
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------
const usedEmails = new Set();
const accountQueue = [];
/** Reserves a demo login; created in bulk later. Returns a handle whose .id is filled in. */
function account(local, fullName) {
  let email = `info+${local}@teamclubhq.com`;
  for (let n = 2; usedEmails.has(email); n++) email = `info+${local}${n}@teamclubhq.com`;
  usedEmails.add(email);
  const a = { email, fullName, id: null };
  accountQueue.push(a);
  return a;
}
async function createAccounts() {
  const existing = new Map((await sql`select id, email from auth.users`).map(r => [r.email, r.id]));
  const todo = accountQueue.filter(a => { if (existing.has(a.email)) { a.id = existing.get(a.email); return false; } return true; });
  let done = 0;
  async function worker() {
    for (let a = todo.shift(); a; a = todo.shift()) {
      for (let attempt = 1; ; attempt++) {
        const r = await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders,
          body: JSON.stringify({ email: a.email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: a.fullName } }) });
        const j = await r.json();
        if (j.id) { a.id = j.id; break; }
        if (attempt >= 4) throw new Error(`create ${a.email}: ${JSON.stringify(j).slice(0, 200)}`);
        await new Promise(s => setTimeout(s, 1000 * attempt));
      }
      if (++done % 50 === 0) console.log(`  accounts: ${done}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
}

// ---------------------------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------------------------
const BOYS = ["Jalen", "Mason", "Ethan", "Noah", "Isaiah", "Caleb", "Elijah", "Lucas", "Aiden", "Jordan", "Cameron", "Dylan", "Marcus", "Xavier",
  "Tyler", "Brandon", "Jaden", "Micah", "Owen", "Carter", "Darius", "Miles", "Josiah", "Landon", "Bryce", "Malik", "Gavin", "Trey", "Andre",
  "Luke", "Devin", "Chase", "Kendrick", "Nolan", "Zion", "Elliot", "Jace", "Roman", "Amari", "Cole"];
const GIRLS = ["Ava", "Mia", "Zoe", "Harper", "Aaliyah", "Chloe", "Layla", "Nora", "Maya", "Riley", "Brooklyn", "Kennedy", "Jada", "Sophia",
  "Ella", "Avery", "Naomi", "Gabrielle", "Payton", "Kayla", "Sienna", "Imani", "Claire", "Morgan", "Destiny", "Lila", "Reagan", "Skylar",
  "Taylor", "Jasmine", "Addison", "Hailey", "Camila", "Sadie", "Nia", "Quinn", "Elena", "Brianna", "Kiara", "Paige"];
const LAST = ["Carter", "Reyes", "Brooks", "Patel", "Thompson", "Nguyen", "Washington", "Schmidt", "Harris", "Mitchell", "Lopez", "Foster", "Bennett",
  "Coleman", "Price", "Jenkins", "Hughes", "Ramirez", "Sullivan", "Wallace", "Henderson", "Diaz", "Kim", "Murphy", "Bryant", "Russell", "Griffin",
  "Hayes", "Myers", "Ford", "Hamilton", "Graham", "Sanders", "Perry", "Powell", "Long", "Patterson", "Simmons", "Butler", "Fisher", "Barnes",
  "Ross", "Morales", "Ortiz", "Jordan", "Reed", "Cook", "Bailey", "Bell", "Cooper", "Howard", "Ward", "Torres", "Peterson", "Gray", "James",
  "Watson", "Kelly", "Sanchez", "Rivera", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris", "Rogers", "Ellis", "Owens",
  "Wells", "Webb", "Tucker", "Mason", "Hunt", "Black", "Daniels", "Palmer", "Mills", "Nichols", "Grant", "Knight", "Ferguson", "Rose", "Stone",
  "Hawkins", "Dunn", "Perkins", "Hudson", "Spencer", "Gardner", "Stephens", "Payne", "Pierce", "Berry", "Matthews", "Arnold", "Wagner"];
const MOMS = ["Tasha", "Monica", "Keisha", "Linh", "Erin", "Nicole", "Gabriela", "Angela", "Jessica", "Brittany", "Lauren", "Danielle", "Tiffany",
  "Amanda", "Crystal", "Rachel", "Megan", "Latoya", "Priya", "Stephanie", "Heather", "Kimberly", "Vanessa", "Renee", "Alicia", "Courtney"];
const DADS = ["Carlos", "Raj", "Andre", "Derek", "Ryan", "Marcus", "Kevin", "Jason", "Brian", "Terrence", "Michael", "Chris", "Darnell", "Eric",
  "Anthony", "Jamal", "Greg", "Scott", "Victor", "Omar", "Nathan", "Travis", "Dwayne", "Paul", "Sean", "Tony"];

const usedKidNames = new Set();
function family(gender, last = null) {
  let first, surname;
  for (let i = 0; i < 200; i++) {
    first = pick(gender === "girls" ? GIRLS : BOYS); surname = last ?? pick(LAST);
    if (!usedKidNames.has(`${first} ${surname}`)) break;
  }
  usedKidNames.add(`${first} ${surname}`);
  const mom = rand() < 0.6;
  const pFirst = pick(mom ? MOMS : DADS);
  return { first, last: surname, parent: { first: pFirst, last: surname, rel: mom ? "mother" : "father" } };
}

// ---------------------------------------------------------------------------------------------
// Venues and opponents
// ---------------------------------------------------------------------------------------------
const GYMS = [
  ["Rec-Plex North", "425 Spencer Rd, St. Peters, MO 63376"], ["Chesterfield Athletic Center", "16365 Lydia Hill Dr, Chesterfield, MO 63017"],
  ["Vetta Sports Concord", "10 Concord Plaza, St. Louis, MO 63128"], ["Upward Fieldhouse", "4500 Hwy K, O'Fallon, MO 63368"],
  ["Kirkwood Community Center", "111 S Geyer Rd, Kirkwood, MO 63122"], ["The Factory Gym", "2001 Locust St, St. Louis, MO 63103"],
  ["Wentzville Rec Center", "1 Progress Dr, Wentzville, MO 63385"], ["Midwest Sports Complex", "3450 Hwy N, Cottleville, MO 63304"],
];
const FIELDS = [["Vetta Sports Complex", "1000 Vetta Way, Chesterfield, MO 63017"], ["Tilles Park Fields", "9551 Litzsinger Rd, Ladue, MO 63124"],
  ["World Wide Technology Soccer Park", "1 Soccer Park Rd, Fenton, MO 63026"], ["Lou Fusz Athletic Complex", "6051 Lou Fusz Way, St. Louis, MO 63128"]];
const BB_OPP = ["Gateway Hoops", "STL Stars", "Lake Saint Louis Lakers", "O'Fallon Panthers", "MO Hoopers", "Metro East Elite", "Brentwood Ballers",
  "Florissant Flight", "Webster Groves Statesmen", "Arch City Aces", "Kirkwood Pioneers", "Fenton Firebirds", "Ballwin Blaze", "St. Charles Storm"];
const SOCCER_OPP = ["Lou Fusz Athletic", "Scott Gallagher SC", "Missouri Rush", "St. Louis Development Academy", "Chesterfield Elite", "Kirkwood FC"];
const VB_OPP = ["Rockwood Thunder", "Gateway Juniors", "Kirkwood VBC", "Lindbergh Flyers", "Ellisville Elite", "Gateway Power"];

// ---------------------------------------------------------------------------------------------
// Team specs
// ---------------------------------------------------------------------------------------------
const logins = []; // [group, label, email]
const owner = { email: OWNER_EMAIL, fullName: "Danny Guillory", id: null };

const AVENGERS = [ // first, last, jersey, position, parent first, parent last, relationship
  ["Iron", "Man", "3", "Point Guard", "Howard", "Stark", "father"],
  ["Thor", "Odinson", "1", "Center", "Frigga", "Odinson", "mother"],
  ["The", "Hulk", "33", "Power Forward", "Rebecca", "Banner", "mother"],
  ["Black", "Widow", "8", "Shooting Guard", "Melina", "Vostokoff", "mother"],
  ["Hawkeye", "Barton", "11", "Shooting Guard", "Laura", "Barton", "mother"],
  ["Scarlet", "Witch", "6", "Small Forward", "Iryna", "Maximoff", "mother"],
  ["Quicksilver", "Maximoff", "7", "Point Guard", "Oleg", "Maximoff", "father"],
  ["The", "Vision", "9", "Small Forward", "Helen", "Cho", "guardian"],
  ["The", "Falcon", "4", "Shooting Guard", "Darlene", "Wilson", "mother"],
  ["War", "Machine", "21", "Power Forward", "Roberta", "Rhodes", "mother"],
  ["Black", "Panther", "15", "Small Forward", "Ramonda", "Udaku", "mother"],
  ["Spider-Man", "Parker", "10", "Point Guard", "May", "Parker", "guardian"],
  ["Doctor", "Strange", "14", "Center", "Beverly", "Strange", "mother"],
  ["Captain", "Marvel", "5", "Shooting Guard", "Marie", "Danvers", "mother"],
  ["Ant-Man", "Lang", "2", "Point Guard", "Maggie", "Lang", "mother"],
  ["The", "Wasp", "12", "Small Forward", "Janet", "Van Dyne", "mother"],
  ["Winter", "Soldier", "32", "Power Forward", "Winifred", "Barnes", "mother"],
];

function rosterFrom(gender, size, sport) {
  const positions = { basketball: ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"],
    soccer: ["Goalkeeper", "Defender", "Defender", "Midfielder", "Midfielder", "Forward"],
    volleyball: ["Setter", "Outside Hitter", "Opposite", "Middle Blocker", "Libero", "Defensive Specialist"] }[sport];
  const jerseys = shuffle(Array.from({ length: 35 }, (_, i) => String(i + 1)));
  return Array.from({ length: size }, (_, i) => {
    const f = family(gender);
    return [f.first, f.last, jerseys[i], positions[i % positions.length], f.parent.first, f.parent.last, f.parent.rel];
  });
}

const independents = [
  { key: "avengers", name: "Avengers 12U", sport: "basketball", age: 12, ageGroup: "12U", gender: "coed", color: "#B11313", venmo: "Avengers-12U",
    coach: account("avengers-captain-america", "Captain America"), assistant: account("avengers-nick-fury", "Nick Fury"),
    roster: AVENGERS, home: ["Avengers Compound (Upward Fieldhouse)", GYMS[3][1]], away: GYMS[1],
    opponents: ["Hydra Hoopers", "Chitauri Chargers", "Ultron Bots", "Dark Elves", "Thanos Titans", "Kree Raiders"], practiceTime: "17:30" },
  { key: "mavericks", name: "St. Louis Mavericks 14U", sport: "basketball", age: 14, ageGroup: "14U", gender: "boys", color: "#2457F5", venmo: "STL-Mavericks",
    coach: owner, assistant: account("mav-marcus-bell", "Marcus Bell"), roster: rosterFrom("boys", 12, "basketball"),
    home: GYMS[0], away: GYMS[1], opponents: BB_OPP.slice(0, 7), practiceTime: "18:00", playerLogin: 0 },
  { key: "gatewayfc", name: "Gateway FC 10U Girls", sport: "soccer", age: 10, ageGroup: "10U", gender: "girls", color: "#0E8A4F", venmo: "GatewayFC-10U",
    coach: account("gfc-coach-maria-alvarez", "Maria Alvarez"), assistant: account("gfc-coach-dana-kim", "Dana Kim"), roster: rosterFrom("girls", 14, "soccer"),
    home: FIELDS[0], away: FIELDS[2], opponents: SOCCER_OPP, practiceTime: "17:00" },
  { key: "aces", name: "Arch City Aces 14U Volleyball", sport: "volleyball", age: 14, ageGroup: "14U", gender: "girls", color: "#7A3FD1", venmo: "ArchCityAces",
    coach: account("aces-coach-tamara-reed", "Tamara Reed"), assistant: null, roster: rosterFrom("girls", 11, "volleyball"),
    home: GYMS[4], away: GYMS[2], opponents: VB_OPP, practiceTime: "19:00", playerLogin: 1 },
];

const CLUB = { name: "Gateway Rise Basketball Club", color: "#F26B1D" };
const clubTeamDefs = [
  [3, "boys", "Gold"], [4, "boys", "Elite"], [4, "girls", "Gold"], [5, "boys", "Elite"], [5, "boys", "Gold"], [5, "girls", "Elite"],
  [6, "boys", "Elite"], [6, "boys", "Gold"], [6, "girls", "Elite"], [6, "girls", "Gold"], [7, "boys", "Elite"], [7, "boys", "Gold"],
  [7, "girls", "Elite"], [8, "boys", "Elite"], [8, "boys", "Gold"], [8, "girls", "Elite"],
];
const COACHES = [["Darnell", "Hayes"], ["Kim", "Whitaker"], ["Jerome", "Banks"], ["Lisa", "Montgomery"], ["Tony", "Castillo"], ["Renee", "Douglas"],
  ["Malcolm", "Pierce"], ["Shawn", "Gibson"], ["Erica", "Lawson"], ["Corey", "Bradford"], ["Antoine", "Wright"], ["Megan", "Holt"],
  ["Rodney", "Fields"], ["Keith", "Marshall"], ["Brandon", "Lyles"], ["Tiana", "Woods"]];
const ASSISTANTS = [["Jamie", "Ruiz"], ["Chris", "Ogden"], ["Aaron", "Vance"], ["Dee", "Sutton"], ["Will", "Prescott"], ["Monique", "Carver"],
  ["Ty", "Brennan"], ["Leah", "Marsh"]];
const suffix = (n) => ["th", "st", "nd", "rd"][n] ?? "th";
const clubTeams = clubTeamDefs.map(([grade, gender, level], i) => {
  const g = gender === "boys" ? "Boys" : "Girls";
  const [cf, cl] = COACHES[i];
  const a = i % 2 === 0 ? ASSISTANTS[i / 2] : null;
  return {
    key: `rise-${grade}${gender[0]}-${level.toLowerCase()}`, name: `Rise ${grade}${suffix(grade)} ${g} ${level}`, sport: "basketball",
    age: grade + 6, ageGroup: `${grade}${suffix(grade)} Grade`, grade: String(grade), gender, level, color: CLUB.color,
    coach: account(`rise-coach-${slug(cf)}.${slug(cl)}`, `${cf} ${cl}`),
    assistant: a ? account(`rise-coach-${slug(a[0])}.${slug(a[1])}`, `${a[0]} ${a[1]}`) : null,
    roster: rosterFrom(gender, 10, "basketball"),
    home: GYMS[2 + (i % 6)], away: GYMS[(i + 3) % GYMS.length], opponents: shuffle(BB_OPP).slice(0, 7),
    practiceTime: ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30"][i % 6], playerLogin: grade >= 7 ? 2 : undefined,
  };
});
const director2 = account("rise-director-angela-price", "Angela Price");
// App Review: an account on no team, for trying Join, Create Team, Delete Team and Delete Account
// without touching the demo teams (docs/APP_STORE.md).
const reviewSpare = account("appreview-spare", "Sam Taylor");

// One family with kids on two club teams (one push, one calendar) and one across a club team and Avengers.
const twoTeamFamily = { team1: "rise-7b-elite", team2: "rise-5g-elite", parent: account("rise-parent-taylor.morgan", "Taylor Morgan") };

// Taylor Morgan is the first family on two club teams.
for (const k of [twoTeamFamily.team1, twoTeamFamily.team2]) {
  const t = clubTeams.find(c => c.key === k);
  const f = family(t.gender, "Morgan");
  t.roster[0] = [f.first, "Morgan", t.roster[0][2], t.roster[0][3], "Taylor", "Morgan", "mother"];
}
// Parents' accounts (one per family) and player logins.
for (const t of [...independents, ...clubTeams]) {
  const prefix = t.key.startsWith("rise") ? "rise" : t.key;
  t.families = t.roster.map(([, , , , pFirst, pLast], i) =>
    i === 0 && [twoTeamFamily.team1, twoTeamFamily.team2].includes(t.key)
      ? twoTeamFamily.parent
      : account(`${prefix}-parent-${slug(pFirst)}.${slug(pLast)}`, `${pFirst} ${pLast}`));
  if (t.playerLogin !== undefined) {
    const [first, last] = t.roster[t.playerLogin];
    t.playerAccount = account(`${t.key}-player-${slug(first)}.${slug(last)}`, `${first} ${last}`);
  }
  // A co-parent on the second family.
  const [, , , , , pLast, rel] = t.roster[1];
  t.coParent = t.key === "avengers"
    ? account("avengers-coparent-odin.odinson", "Odin Odinson")
    : account(`${prefix}-coparent-${slug(pLast)}`, `${rel === "mother" ? pick(DADS) : pick(MOMS)} ${pLast}`);
}
let emailById = new Map(); // user id → email, once accounts exist

// ---------------------------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------------------------
async function wipe() {
  const tables = (await sql`select tablename from pg_tables where schemaname = 'public'`).map(r => r.tablename)
    .filter(t => !KEEP_TABLES.includes(t));
  await sql.begin(async (tx) => {
    const gone = await tx`delete from auth.users where lower(email) <> all(${KEEP_EMAILS}) returning id`;
    await tx.unsafe(`truncate ${tables.map(t => `public."${t}"`).join(", ")} restart identity cascade`);
    console.log(`wiped: ${gone.length} users, ${tables.length} tables (kept ${KEEP_TABLES.join(", ")})`);
  });
}

// ---------------------------------------------------------------------------------------------
// Seed one team
// ---------------------------------------------------------------------------------------------
const MSG = {
  basketball: {
    win: (opp, us, them) => `Great win vs ${opp}, ${us}–${them}! Ball movement was the best it's been all season. 🏀`,
    loss: (opp, us, them) => `Tough one vs ${opp} (${us}–${them}), but the second-half defense was our best yet. Proud of this group.`,
    practice: "Practice focus this week: press break, closeouts, and free throws.",
    gear: "Both jerseys, water bottle, and court shoes (not the ones you wear outside!).",
  },
  soccer: {
    win: (opp, us, them) => `What a game vs ${opp}, ${us}–${them}! Loved the passing out of the back. ⚽`,
    loss: (opp, us, them) => `Lost ${us}–${them} to ${opp}, but we created so many chances. Keep your heads up!`,
    practice: "This week: first touch, 1v1 defending, and corner kicks.",
    gear: "Shin guards, cleats, both jerseys and a full water bottle.",
  },
  volleyball: {
    win: (opp, us, them) => `Won in two sets vs ${opp} (${us}–${them})! Serve receive was rock solid. 🏐`,
    loss: (opp, us, them) => `Dropped a close one to ${opp} (${us}–${them}). Our blocking is getting so much better.`,
    practice: "This week: serve receive, transition offense, and float serves.",
    gear: "Knee pads, court shoes, and both jerseys.",
  },
};

async function seedTeam(tx, t, org, ctx) {
  const coach = t.coach.id;
  const staff = [coach, t.assistant?.id].filter(Boolean);
  const [team] = await tx`insert into public.teams (org_id, name, age_group, season, sport, brand_color, venmo_username, time_zone, grade, gender, level, created_by)
    values (${org}, ${t.name}, ${t.ageGroup}, ${SEASON}, ${t.sport}, ${t.color}, ${t.venmo ?? null}, ${TZ}, ${t.grade ?? null}, ${t.gender ?? null}, ${t.level ?? null}, ${coach})
    returning id`;
  const T = team.id;
  t.id = T;
  await tx`insert into public.user_roles ${tx([{ user_id: coach, role: "head_coach", team_id: T, org_id: org },
    ...(t.assistant ? [{ user_id: t.assistant.id, role: "assistant_coach", team_id: T, org_id: org }] : [])])}`;

  // Roster, guardians, emergency contacts, co-parent, player login.
  const players = [];
  for (const [i, r] of t.roster.entries()) {
    const [first, last, jersey, position, pFirst, pLast, rel] = r;
    const birthYear = 2026 - t.age - (i % 3 === 0 ? 1 : 0);
    const birth = `${birthYear}-${String((i % 12) + 1).padStart(2, "0")}-${String(((i * 7) % 27) + 1).padStart(2, "0")}`;
    const notes = i === 0 ? "Team captain. Great vision — leads by example." : i === 3 ? "Working on confidence with the weak hand." : null;
    const [p] = await tx`insert into public.players (team_id, first_name, last_name, jersey_number, position, birthdate, notes, created_by)
      values (${T}, ${first}, ${last}, ${jersey}, ${position}, ${birth}, ${notes}, ${t.families[i].id}) returning id`;
    players.push({ id: p.id, first, last, parent: t.families[i].id, parentName: `${pFirst} ${pLast}` });
    await tx`insert into public.parent_player_links (player_id, parent_user_id, relationship) values (${p.id}, ${t.families[i].id}, ${rel})`;
    await tx`insert into public.player_emergency_contacts (player_id, relationship, name, phone, created_by)
      values (${p.id}, ${rel}, ${pFirst + " " + pLast}, ${"(314) 555-" + String(1000 + ((ctx.phone++ * 37) % 9000)).padStart(4, "0")}, ${t.families[i].id})`;
  }
  const parentIds = [...new Set(t.families.map(f => f.id))];
  for (const pid of parentIds) {
    await tx`insert into public.user_roles (user_id, role, team_id) values (${pid}, 'parent', ${T}) on conflict do nothing`;
  }
  // Co-parent on family #2.
  await tx`insert into public.parent_player_links (player_id, parent_user_id, relationship)
    values (${players[1].id}, ${t.coParent.id}, ${t.roster[1][6] === "mother" ? "father" : "mother"})`;
  await tx`insert into public.user_roles (user_id, role, team_id) values (${t.coParent.id}, 'parent', ${T})`;
  if (t.playerAccount) {
    await tx`update public.players set user_id = ${t.playerAccount.id} where id = ${players[t.playerLogin].id}`;
    await tx`insert into public.user_roles (user_id, role, team_id) values (${t.playerAccount.id}, 'player', ${T})`;
  }

  // Schedule.
  const events = [];
  async function event(day, time, minutes, type, title, loc, extra = {}) {
    const start = at(day, time);
    const [e] = await tx`insert into public.events (team_id, title, event_type, starts_at, ends_at, location, location_address, notes,
        opponent, home_away, home_score, away_score, result, rsvp_cutoff_at, club_event_id, created_by)
      values (${T}, ${title}, ${type}, ${start}, ${new Date(start.getTime() + minutes * 60000)}, ${loc[0]}, ${loc[1]}, ${extra.notes ?? null},
        ${extra.opponent ?? null}, ${extra.homeAway ?? null}, ${extra.home ?? null}, ${extra.away ?? null}, ${extra.result ?? null},
        ${new Date(start.getTime() - 4 * 3600000)}, ${extra.clubEventId ?? null}, ${extra.by ?? coach}) returning id, starts_at`;
    const ev = { ...e, type, day, title, opponent: extra.opponent, result: extra.result };
    events.push(ev);
    return ev;
  }
  const opp = [...t.opponents];
  const practiceDays = t.sport === "soccer" ? [2, 4] : [1, 3]; // Tue/Thu or Mon/Wed
  const gameScore = () => {
    if (t.sport === "soccer") return [Math.floor(rand() * 4), Math.floor(rand() * 3)];
    if (t.sport === "volleyball") return rand() < 0.6 ? [2, Math.floor(rand() * 2)] : [Math.floor(rand() * 2), 2];
    const base = 28 + t.age * 2;
    return [base + Math.floor(rand() * 16), base + Math.floor(rand() * 14)];
  };
  const gameLen = t.sport === "soccer" ? 75 : 60;
  const practiceLen = 90;
  const gameNote = (dark) => `Arrive 30 minutes early. ${dark ? "Dark" : "White"} jerseys.`;
  // Past: three weeks of practices and Saturday games with results.
  const past = [];
  for (const w of [-3, -2, -1]) {
    for (const dow of practiceDays) {
      const d = nextDow(w * 7, dow);
      if (d < 0) past.push(await event(d, t.practiceTime, practiceLen, "practice", "Practice", t.home));
    }
    const sat = nextDow(w * 7, 6);
    if (sat < 0) {
      const home = rand() < 0.5;
      const [us, them] = gameScore();
      const result = us > them ? "win" : us < them ? "loss" : "tie";
      const o = opp.shift();
      past.push(await event(sat, ["09:00", "10:30", "12:00"][Math.floor(rand() * 3)], gameLen, "game", `Game ${home ? "vs" : "at"} ${o}`,
        home ? t.home : t.away, { opponent: o, homeAway: home ? "home" : "away", home: home ? us : them, away: home ? them : us, result, notes: gameNote(home) }));
    }
  }
  // Upcoming: four weeks.
  const upcoming = [];
  for (const w of [0, 1, 2, 3]) {
    for (const dow of practiceDays) {
      const d = nextDow(w * 7, dow);
      if (d >= 1) {
        upcoming.push(await event(d, t.practiceTime, practiceLen, "practice", "Practice", t.home,
          upcoming.length === 0 ? { notes: `${MSG[t.sport].practice} ${MSG[t.sport].gear}` } : {}));
      }
    }
    const sat = nextDow(w * 7, 6);
    if (sat >= 1 && w !== 2) {
      const home = w % 2 === 0;
      const o = opp.shift() ?? pick(t.opponents);
      upcoming.push(await event(sat, ["09:00", "10:30", "12:00"][w % 3], gameLen, "game", `Game ${home ? "vs" : "at"} ${o}`,
        home ? t.home : t.away, { opponent: o, homeAway: home ? "home" : "away", notes: gameNote(home) }));
    }
    if (w === 2) { // tournament weekend
      const tourney = t.sport === "soccer" ? "Gateway Fall Cup" : t.sport === "volleyball" ? "Arch City Fall Invitational" : "Gateway Fall Classic";
      upcoming.push(await event(sat, "08:30", gameLen, "game", `${tourney} — Pool Game 1`, t.away, { opponent: pick(t.opponents), homeAway: "away",
        notes: "Tournament weekend. Check-in opens 45 minutes before the first game." }));
      upcoming.push(await event(sat, "12:30", gameLen, "game", `${tourney} — Pool Game 2`, t.away, { opponent: pick(t.opponents), homeAway: "home" }));
      upcoming.push(await event(sat + 1, "10:00", gameLen, "game", `${tourney} — Bracket (time TBD by seed)`, t.away,
        { notes: "Bracket game times post Saturday night. We'll update this as soon as they're out." }));
    }
  }
  if (!ctx.club) {
    upcoming.push(await event(nextDow(8, 5), "19:00", 45, "other", "Team photos + parent meeting", t.home,
      { notes: "Full uniform for photos. Parent meeting covers the tournament weekend and carpools." }));
  }
  // A cancelled practice to show cancellations.
  const cancelled = upcoming.find(e => e.type === "practice" && e.day > 9);
  if (cancelled) await tx`update public.events set cancelled_at = now() - interval '1 day', notes = 'Gym closed for a school event — no practice.' where id = ${cancelled.id}`;

  // Attendance on past events.
  const att = [];
  for (const e of past) for (const [i, p] of players.entries()) {
    const r = rand();
    att.push({ event_id: e.id, player_id: p.id, status: r < 0.82 ? "present" : r < 0.9 ? "late" : r < 0.95 ? "excused" : "absent", marked_by: coach });
  }
  if (att.length) await tx`insert into public.attendance ${tx(att)}`;

  // RSVPs: next practice and next game nearly full; the following two partly answered.
  const nextPractice = upcoming.find(e => e.type === "practice" && e.id !== cancelled?.id);
  const nextGames = upcoming.filter(e => e.type === "game");
  const notesNo = ["Out of town for a family wedding.", "Dentist appointment, sorry!", "Sick — resting up.", "School concert that night."];
  const notesMaybe = ["Might be 15 min late — work runs late.", "Depends on the carpool.", "Has a cold, will decide that morning."];
  const rsvps = [];
  for (const [k, e] of [nextPractice, nextGames[0], nextGames[1], upcoming.find(x => x.type === "practice" && x.day > 5)].filter(Boolean).entries()) {
    const share = [0.9, 0.85, 0.55, 0.4][k];
    for (const p of players) {
      if (rand() > share) continue;
      const r = rand();
      const status = r < 0.8 ? "yes" : r < 0.9 ? "maybe" : "no";
      rsvps.push({ event_id: e.id, player_id: p.id, status, responded_by: p.parent,
        note: status === "no" ? pick(notesNo) : status === "maybe" ? pick(notesMaybe) : null });
    }
  }
  if (rsvps.length) await tx`insert into public.rsvps ${tx(rsvps)}`;

  // Announcements.
  const last = past.filter(e => e.type === "game").at(-1);
  const tourneyGame = upcoming.find(e => e.title.includes("Pool Game 1"));
  const ann = [
    [`Welcome to ${SEASON}!`, `Welcome to the ${t.name} season! Everything lives in ClubHQ: schedule, RSVPs, team chat and dues. Please RSVP for every practice and game so we can plan.`, -24],
    ["Uniform pickup", `Uniforms are in! Pick them up at the next practice. ${MSG[t.sport].gear}`, -10],
  ];
  if (tourneyGame) ann.push([`${tourneyGame.title.split(" — ")[0]} — we're in! 🏆`,
    `We're entered in the ${tourneyGame.title.split(" — ")[0]} on ${weekday(tourneyGame.day)}, ${dateLabel(tourneyGame.day)}. Entry fee is under Payments. Please RSVP to all games by Wednesday.`, -2]);
  for (const [title, body, d] of ann) {
    await tx`insert into public.announcements (team_id, title, body, created_by, created_at) values (${T}, ${title}, ${body}, ${coach}, now() + ${d + " days"}::interval)`;
  }

  // Chats.
  const thread = async (title, audience, pinned) =>
    (await tx`insert into public.message_threads (team_id, kind, audience, title, pinned, created_by) values (${T}, 'team', ${audience}, ${title}, ${pinned}, ${coach}) returning id`)[0].id;
  const chat = await thread("Team chat", "both", true);
  const parentsThread = await thread("Parents — carpools & snacks", "parents", false);
  const staffThread = t.assistant ? await thread("Coaches", "staff", false) : null;
  const msgs = [];
  const say = (tid, author, body, day, hhmm) => msgs.push({ thread_id: tid, author_id: author, body, created_at: at(day, hhmm) });
  const P = (i) => players[i % players.length];
  // Last game's score from our side, so chat matches the schedule.
  let lastRecap = null;
  if (last) {
    const [{ home_score: hs, away_score: as }] = await tx`select home_score, away_score from public.events where id = ${last.id}`;
    const homeSide = last.title.includes(" vs ");
    const us = homeSide ? hs : as, them = homeSide ? as : hs;
    lastRecap = MSG[t.sport][us >= them ? "win" : "loss"](last.opponent, us, them);
  }
  if (t.key === "avengers") {
    say(chat, coach, "Avengers, assemble! Practice is mandatory — yes, that includes you, Thor. 🛡️", -6, "18:05");
    say(chat, P(0).parent, "Tony says he'll bring the new suits — I mean jerseys. Howard here, I'll make sure he does.", -6, "18:20");
    say(chat, P(1).parent, "Thor can't find his water bottle. Again. He's blaming Loki.", -5, "07:45");
    if (lastRecap) say(chat, coach, `${lastRecap} Hulk, great rebounding — but please stop breaking the backboard.`, last.day, "13:10");
    if (lastRecap) say(chat, P(2).parent, "We're paying for the backboard. Bruce is very sorry. 💚", last.day, "13:25");
    say(chat, t.assistant.id, "Reminder: NO flying during warmups. Falcon, War Machine — this means you.", -2, "19:00");
    say(chat, P(11).parent, `Peter will be a few minutes late ${weekday(nextPractice?.day ?? 1)}, he has a science fair. Says he'll swing by.`, -1, "16:40");
    say(chat, coach, `${weekday(nextPractice?.day ?? 1)} at 5:30: press break and team defense. Doctor Strange, you already know what happens, but come anyway.`, -1, "20:15");
    say(parentsThread, P(6).parent, "Pietro can drive anyone to the tournament. He'll be there before you finish asking.", -3, "21:00");
    say(parentsThread, P(7).parent, "Vision and Wanda need a ride Saturday if Pietro's car is full.", -2, "08:12");
    say(parentsThread, P(14).parent, "Snack sign-up: Scott is bringing ant-sized cookies. Very small. Very many.", -1, "12:30");
    say(staffThread, t.assistant.id, "Rotation idea for the tournament: start Widow, Hawkeye, Thor, Hulk, Iron Man. Bring Spider-Man off the bench for energy.", -1, "09:40");
    say(staffThread, coach, "Agreed. And Captain Marvel closes out the 4th. Nobody can guard her.", -1, "10:02");
  } else {
    if (lastRecap) say(chat, coach, lastRecap, last.day, "14:10");
    say(chat, P(0).parent, "Thanks coaches! They played so hard.", last?.day ?? -5, "14:32");
    if (t.playerAccount) say(chat, t.playerAccount.id, "Can we do more shooting drills this week?", (last?.day ?? -5), "17:40");
    say(chat, coach, `${MSG[t.sport].practice} See everyone ${weekday(nextPractice?.day ?? 1)}!`, (last?.day ?? -5) + 1, "09:00");
    say(chat, P(4).parent, "Is the next game still at the same time? Want to plan around a recital.", -1, "12:47");
    say(chat, coach, nextGames[0] ? `Yes — ${weekday(nextGames[0].day)} ${nextGames[0].starts_at.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}. Arrive 30 minutes early.` : "Yes, same time.", -1, "13:02");
    if (t.assistant) say(chat, t.assistant.id, "Great energy at practice this week. Keep it up!", -1, "20:30");
    say(parentsThread, P(2).parent, "I can drive 3 kids to the tournament — leaving at 7:30.", -2, "20:15");
    say(parentsThread, P(6).parent, `That would be amazing. ${P(6).first} needs a ride if there's room!`, -2, "20:31");
    say(parentsThread, P(8).parent, "We can take 2 for the afternoon game.", -1, "08:05");
    say(parentsThread, P(3).parent, "Snack sign-up for Saturday: we've got oranges and water covered. 🍊", -1, "18:44");
    if (staffThread) {
      say(staffThread, t.assistant.id, `I'll bring the pinnies and the ball bag ${weekday(nextPractice?.day ?? 1)}.`, -1, "09:40");
      say(staffThread, coach, "Perfect. Let's split into two groups for the first half of practice.", -1, "10:02");
    }
  }
  if (msgs.length) await tx`insert into public.messages ${tx(msgs)}`;
  await tx`update public.message_threads set updated_at = now() where team_id = ${T}`;
  await tx`insert into public.message_reads ${tx(staff.map(u => ({ user_id: u, thread_id: staffThread ?? chat, last_read_at: new Date() })))}`;

  // Dues (Venmo/Cash App recorded by the coach; card payments are off).
  const fee = t.sport === "volleyball" ? 32500 : t.age >= 12 ? 22500 : 17500;
  const [d1] = await tx`insert into public.dues_requests (team_id, title, description, amount_cents, due_date, created_by, created_at)
    values (${T}, 'Season dues', ${`Gym/field rental, league fees and uniforms for ${SEASON}.`}, ${fee}, current_date + 5, ${coach}, now() - interval '18 days') returning id`;
  const [d2] = await tx`insert into public.dues_requests (team_id, title, description, amount_cents, due_date, created_by, created_at)
    values (${T}, 'Tournament entry', 'Tournament entry and referee fees.', 4500, current_date + 9, ${coach}, now() - interval '3 days') returning id`;
  const items = [];
  for (const [i, p] of players.entries()) {
    const paid1 = i < Math.ceil(players.length * 0.65), waived = i === players.length - 1;
    items.push({ request_id: d1.id, player_id: p.id, amount_cents: fee, status: paid1 ? "paid" : waived ? "waived" : "unpaid",
      paid_at: paid1 ? new Date(Date.now() - (i + 1) * 86400000) : null, paid_by: paid1 ? coach : null });
    const paid2 = i < 3;
    items.push({ request_id: d2.id, player_id: p.id, amount_cents: 4500, status: paid2 ? "paid" : "unpaid",
      paid_at: paid2 ? new Date(Date.now() - 86400000) : null, paid_by: paid2 ? coach : null });
  }
  await tx`insert into public.dues_items ${tx(items)}`;

  // Inbox items (already delivered, so the dispatcher never pushes them).
  const note = async (kind, subject, body, ref, link, hoursAgo, recipients) => {
    const [n] = await tx`insert into public.notifications (team_id, kind, subject, body, ref_id, processed_at, created_at)
      values (${T}, ${kind}, ${subject}, ${body}, ${ref}, now(), now() - ${hoursAgo + " hours"}::interval) returning id`;
    await tx`insert into public.notification_sends ${tx(recipients.map(u => ({ notification_id: n.id, recipient_user_id: u, recipient_email: emailById.get(u), status: "sent", link_path: link,
      created_at: new Date(Date.now() - hoursAgo * 3600000), apns_sent_at: new Date(), sent_at: new Date() })))}`;
  };
  await note("message_new", "Parents — carpools & snacks", "We can take 2 for the afternoon game.", parentsThread, `/team/messages/${parentsThread}`, 6, [coach]);
  if (nextPractice) {
    const missing = players.length - rsvps.filter(r => r.event_id === nextPractice.id).length;
    await note("rsvp_reminder", `${missing} player${missing === 1 ? "" : "s"} haven't RSVP'd`, `Practice ${weekday(nextPractice.day)} — RSVPs close 4 hours before.`,
      nextPractice.id, `/event/${nextPractice.id}`, 10, [coach]);
  }
  await note("family_joined", "New family joined", `${players.at(-1).parentName} joined and added ${players.at(-1).first}.`, T, "/team", 30, [coach]);
  await note("announcement", ann.at(-1)[0], ann.at(-1)[1].slice(0, 140), T, "/team", 48, parentIds.slice(0, 4));
  if (nextGames[0]) await note("event_reminder", `${weekday(nextGames[0].day)}: ${nextGames[0].title}`, "Arrive 30 minutes early.", nextGames[0].id, `/event/${nextGames[0].id}`, 3, parentIds.slice(0, 4));

  // Team code (365 days, like the app's).
  const teamCode = stableCode(t.key);
  await tx`insert into public.team_invites (team_id, token, created_by, expires_at) values (${T}, ${teamCode}, ${coach}, now() + interval '365 days')`;
  t.code = teamCode;
  t.counts = { players: players.length, events: events.length, rsvps: rsvps.length, messages: msgs.length };
  t.upcoming = upcoming;
  return T;
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------
const [ownerRow] = await sql`select id from auth.users where email = ${OWNER_EMAIL}`;
if (!ownerRow) throw new Error("owner account not found");
owner.id = ownerRow.id;

if (process.argv.includes("--wipe")) await wipe();
console.log(`creating ${accountQueue.length} demo accounts…`);
await createAccounts();
emailById = new Map([...accountQueue.map(a => [a.id, a.email]), [owner.id, OWNER_EMAIL]]);
console.log("accounts ready");

await sql.begin(async (tx) => {
  const ctx = { phone: 1, club: false };
  // Owner: complimentary Coach Pro for demos.
  await tx`insert into public.pro_grants (user_id, reason, created_by) values (${owner.id}, 'Owner demo account (2.0 demo world)', ${owner.id})`;

  // Independent teams.
  for (const t of independents) {
    const [org] = await tx`insert into public.organizations (name, type, created_by, brand_color, time_zone)
      values (${t.name}, 'independent', ${t.coach.id}, ${t.color}, ${TZ}) returning id`;
    await seedTeam(tx, t, org.id, ctx);
    console.log(`  ${t.name}: ${JSON.stringify(t.counts)}`);
  }

  // Club.
  ctx.club = true;
  const [club] = await tx`insert into public.organizations (name, type, created_by, brand_color, time_zone)
    values (${CLUB.name}, 'club', ${owner.id}, ${CLUB.color}, ${TZ}) returning id`;
  await tx`insert into public.user_roles ${tx([owner.id, director2.id].map(u => ({ user_id: u, role: "program_director", team_id: null, org_id: club.id })))}`;
  await tx`insert into public.pro_grants (org_id, reason, created_by) values (${club.id}, 'Demo club (2.0 demo world)', ${owner.id})`;
  const clubCode = stableCode("club");
  await tx`insert into public.club_invites (org_id, kind, token, created_by) values (${club.id}, 'club_code', ${clubCode}, ${owner.id})`;
  for (const t of clubTeams) {
    await seedTeam(tx, t, club.id, ctx);
    console.log(`  ${t.name}: ${JSON.stringify(t.counts)}`);
  }

  // Club-wide announcements (one row per team, "From Gateway Rise Basketball Club").
  const clubAnn = [
    ["Winter league registration is open", "Registration for Winter League is open through Nov 20. Returning players keep their spot if registered by Nov 10. Questions? Message your coach.", -4],
    ["Club picture day is coming up", "Every team takes photos at Vetta Sports Concord. Full uniform, hair ready, and smiles! Your team's time slot is on your schedule.", -1],
  ];
  for (const [title, body, d] of clubAnn) {
    await tx`insert into public.announcements ${tx(clubTeams.map(t => ({ team_id: t.id, title, body, created_by: owner.id, from_club: CLUB.name,
      created_at: new Date(Date.now() + d * 86400000) })))}`;
  }
  // Club events across teams, linked by club_event_id.
  const clubEvent = async (title, type, day, timeFor, minutes, loc, notes, teams) => {
    const [{ id: ce }] = await tx`select gen_random_uuid() as id`;
    const rows = teams.map((t, i) => {
      const start = at(day, timeFor(i));
      return { team_id: t.id, title, event_type: type, starts_at: start, ends_at: new Date(start.getTime() + minutes * 60000), location: loc[0],
        location_address: loc[1], notes, rsvp_cutoff_at: new Date(start.getTime() - 4 * 3600000), club_event_id: ce, created_by: owner.id };
    });
    await tx`insert into public.events ${tx(rows)}`;
  };
  const sunday1 = nextDow(1, 0);
  await clubEvent("Club picture day", "other", sunday1, (i) => `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${["00", "15", "30", "45"][i % 4]}`, 15,
    GYMS[2], "Full uniform. Arrive 10 minutes before your team's slot.", clubTeams);
  await clubEvent("Club parent meeting", "other", nextDow(6, 2), () => "19:00", 60, GYMS[2],
    "Winter league, travel tournaments and volunteer roles. One parent per family, please.", clubTeams);
  await clubEvent("Spring tryouts info night (7th–8th)", "other", nextDow(15, 4), () => "18:30", 45, GYMS[3],
    "For 7th and 8th grade families thinking about the spring travel teams.", clubTeams.filter(t => Number(t.grade) >= 7));
  ctx.clubCode = clubCode;
  ctx.clubId = club.id;

  // Logins for the demo sheet.
  logins.push(["Owner", "Danny (you): head coach of St. Louis Mavericks 14U + director of the club", OWNER_EMAIL, "your own password"]);
  for (const t of independents) {
    if (t.coach !== owner) logins.push([t.name, `Head coach: ${t.coach.fullName}`, t.coach.email]);
    if (t.assistant) logins.push([t.name, `Assistant coach: ${t.assistant.fullName}`, t.assistant.email]);
    logins.push([t.name, `Parent of ${t.roster[0][0]} ${t.roster[0][1]}: ${t.families[0].fullName}`, t.families[0].email]);
    if (t.playerAccount) logins.push([t.name, `Player login (13+): ${t.playerAccount.fullName}`, t.playerAccount.email]);
    logins.push([t.name, `Team code`, t.code]);
  }
  logins.push(["App Review", `Spare account on no team: ${reviewSpare.fullName}`, reviewSpare.email]);
  logins.push([CLUB.name, `Second director: ${director2.fullName}`, director2.email]);
  logins.push([CLUB.name, `Club code (coaches bring a team in)`, clubCode]);
  logins.push([CLUB.name, `Parent with kids on two club teams: Taylor Morgan`, twoTeamFamily.parent.email]);
  for (const t of clubTeams) {
    logins.push([t.name, `Head coach: ${t.coach.fullName}`, t.coach.email]);
    logins.push([t.name, `Parent of ${t.roster[1][0]} ${t.roster[1][1]}: ${t.families[1].fullName}`, t.families[1].email]);
    if (t.playerAccount) logins.push([t.name, `Player login (13+): ${t.playerAccount.fullName}`, t.playerAccount.email]);
    logins.push([t.name, `Team code`, t.code]);
  }
});

// Mark the owner as internal so analytics ignore their demo activity (already listed; idempotent).
await sql`insert into private.internal_accounts (email, note) values (${OWNER_EMAIL}, 'Owner personal account: 2.0 demo world') on conflict (email) do nothing`;

const lines = [
  "# ClubHQ 2.0 demo logins (seeded " + new Date().toISOString().slice(0, 10) + ")",
  "",
  `Every demo account's password: \`${DEMO_PASSWORD}\` (sign in with email + password).`,
  "Emails go to info+…@teamclubhq.com, which has no inbox (OQ-16), so use password sign-in only.",
  "",
  "| Team | Who | Email / code |",
  "|---|---|---|",
  ...logins.map(([team, who, email]) => `| ${team} | ${who} | ${email} |`),
];
fs.writeFileSync(`${ROOT}/.secrets/demo-logins.md`, lines.join("\n") + "\n");
const [totals] = await sql`select (select count(*) from public.teams) teams, (select count(*) from public.players) players,
  (select count(*) from public.events) events, (select count(*) from auth.users) users, (select count(*) from public.messages) messages,
  (select count(*) from public.rsvps) rsvps, (select count(*) from public.announcements) announcements`;
console.log("totals:", JSON.stringify(totals));
console.log(`logins written to .secrets/demo-logins.md (${logins.length} rows)`);
await sql.end();

#!/usr/bin/env node
// ClubHQ regression runner (docs/TESTING.md).
//
//   node scripts/test/run.mjs quick                 # build + unit tests, offline, a few minutes
//   node scripts/test/run.mjs regression            # + live server checks, security probe, UI tests
//   node scripts/test/run.mjs full                  # + exploratory pass and release checklist (listed as to-dos)
//   node scripts/test/run.mjs regression --only security,live-d036
//   node scripts/test/run.mjs regression --skip app-ui --note "UI tests run in Xcode: 7/7"
//   node scripts/test/run.mjs map                   # coverage map: features, their tests, and gaps
//   node scripts/test/run.mjs affected [base]       # features and suites touched since base (default origin/main)
//
// Each run writes build/test-reports/<run>/report.md (plus one log per suite) and appends a line
// to docs/TEST_HISTORY.md. Exit code 1 if any suite failed. Live suites read .env.local themselves.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURES, SUITES, TIERS } from "./registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const XCODE_DEV = "/Applications/Xcode.app/Contents/Developer";
const SUITE_TIMEOUT_MS = 25 * 60_000;

const [cmd = "help", ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const list = (name) => (flag(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (cmd === "map") { printMap(); process.exit(0); }
if (cmd === "affected") { printAffected(rest.find((a) => !a.startsWith("--")) ?? "origin/main"); process.exit(0); }
if (!TIERS.includes(cmd)) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(cmd === "help" ? 0 : 1);
}
await runTier(cmd);

// ---------------------------------------------------------------------------------------------
async function runTier(tier) {
  const upTo = TIERS.indexOf(tier);
  const only = list("only"), skip = list("skip");
  const suites = SUITES.filter((s) => TIERS.indexOf(s.tier) <= upTo)
    .filter((s) => only.length === 0 || only.includes(s.id))
    .filter((s) => !skip.includes(s.id));
  const env = { ...process.env, ...loadEnvFile(join(ROOT, ".env.local")) };
  if (!env.DEVELOPER_DIR && existsSync(XCODE_DEV)) env.DEVELOPER_DIR = XCODE_DEV; // xcode-select may point at Command Line Tools
  const started = new Date();
  const runId = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${tier}`;
  const dir = join(ROOT, "build/test-reports", runId);
  mkdirSync(dir, { recursive: true });
  const commit = sh("git rev-parse --short HEAD");
  const dirty = sh("git status --porcelain").length > 0;
  console.log(`ClubHQ ${tier} run ${runId} @ ${commit}${dirty ? " (uncommitted changes)" : ""} — ${suites.length} suites\n`);

  let simulator = null;
  const results = [];
  for (const s of suites) {
    process.stdout.write(`▶ ${s.id.padEnd(14)} ${s.title} … `);
    const t0 = Date.now();
    let r;
    try {
      if (s.kind.startsWith("xcode") && !simulator) simulator = pickSimulator(env);
      r = await runSuite(s, { env, dir, simulator });
    } catch (e) {
      r = { status: "FAIL", detail: String(e.message ?? e).slice(0, 300) };
    }
    r.seconds = Math.round((Date.now() - t0) / 1000);
    results.push({ ...s, ...r });
    console.log(`${r.status}${r.counts ? ` (${r.counts})` : ""} ${r.seconds}s${r.detail ? ` — ${r.detail}` : ""}`);
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const blocked = results.filter((r) => r.status === "BLOCKED");
  const todo = results.filter((r) => r.status === "TODO");
  const overall = failed.length ? "FAIL" : blocked.length ? "PASS (with blocked suites)" : "PASS";
  const note = flag("note");
  writeFileSync(join(dir, "report.md"), report({ tier, runId, commit, dirty, started, results, overall, note }));
  const historyLine = `| ${started.toISOString().slice(0, 16).replace("T", " ")} | ${tier} | ${commit}${dirty ? "+" : ""} | ${overall} | ${results.filter((r) => r.status === "PASS").length} pass, ${failed.length} fail, ${blocked.length} blocked, ${todo.length} to-do | ${[...failed.map((f) => `FAIL ${f.id}`), note].filter(Boolean).join("; ")} |\n`;
  const history = join(ROOT, "docs/TEST_HISTORY.md");
  if (!existsSync(history)) writeFileSync(history, "# Test run history\n\nOne line per run of `scripts/test/run.mjs` (newest last). Reports live in `build/test-reports/` (not committed).\n\n| When (UTC) | Tier | Commit | Result | Suites | Notes |\n|---|---|---|---|---|---|\n");
  appendFileSync(history, historyLine);
  console.log(`\n${overall} — report: build/test-reports/${runId}/report.md`);
  if (todo.length) console.log(`To do by hand (docs/TESTING.md): ${todo.map((t) => t.id).join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}

async function runSuite(s, { env, dir, simulator }) {
  const log = join(dir, `${s.id}.log`);
  const project = ["-project", "ClubHQ.xcodeproj", "-scheme", "ClubHQ", "-derivedDataPath", "build/dd-regression"];
  switch (s.kind) {
    case "xcode-build": {
      const { code, out } = await run("xcodebuild", ["build", ...project, "-destination", `id=${simulator}`, "-quiet"], { env, log });
      return code === 0 ? { status: "PASS" } : { status: "FAIL", detail: firstLine(out, /error:/) ?? `exit ${code}` };
    }
    case "xcode-test": {
      const { code, out } = await run("xcodebuild", ["test", ...project, "-destination", `id=${simulator}`, `-only-testing:${s.target}`], { env, log });
      // Under Xcode's coding assistant, child processes can't open a pseudo-terminal, so the
      // simulator can't launch tests. Run them in Xcode (⌘U) or from Terminal instead.
      if (/Pseudo Terminal Setup Error/.test(out)) return { status: "BLOCKED", detail: "can't launch the simulator from this shell; run in Xcode (⌘U) or Terminal" };
      const counts = testCounts(out);
      return code === 0 ? { status: "PASS", counts } : { status: "FAIL", counts, detail: firstLine(out, /(error|failed|✘)/i) ?? `exit ${code}` };
    }
    case "deno-test": {
      const { code, out } = await run("npx", ["--yes", "deno", "test", "--allow-read", "--allow-env", s.path], { env, log });
      const m = stripAnsi(out).match(/(\d+) passed \| (\d+) failed/);
      return { status: code === 0 ? "PASS" : "FAIL", counts: m ? `${m[1]} passed, ${m[2]} failed` : undefined, detail: code === 0 ? undefined : firstLine(stripAnsi(out), /FAILED|error/) };
    }
    case "live": {
      if (!env.SUPABASE_ACCESS_TOKEN) return { status: "BLOCKED", detail: ".env.local is missing (live checks need the Supabase token)" };
      const { code, out } = await run("node", [s.file], { env, log });
      const m = out.match(/(\d+) passed, (\d+) failed/);
      const fails = out.split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 3).map((l) => l.slice(6, 120));
      // A check that finished all its assertions but hit a network blip on the way out still passed.
      const passed = m && m[2] === "0";
      return { status: passed ? "PASS" : "FAIL", counts: m ? `${m[1]} passed, ${m[2]} failed` : undefined, detail: passed ? undefined : (fails.join(" | ") || firstLine(out, /Error/) || `exit ${code}`) };
    }
    case "hygiene": {
      if (!env.SUPABASE_ACCESS_TOKEN) return { status: "BLOCKED", detail: ".env.local is missing" };
      const rows = await sql(env, `select (select count(*) from auth.users where email like 'qa+%')::int as users,
        (select count(*) from public.teams where name like 'Probe %' or name like 'QA %')::int as teams,
        (select count(*) from public.message_threads where kind <> 'team')::int as dm_threads`);
      writeFileSync(log, JSON.stringify(rows, null, 2));
      const r = rows?.[0];
      if (!r) return { status: "FAIL", detail: `couldn't query production: ${JSON.stringify(rows).slice(0, 200)}` };
      const clean = r.users === 0 && r.teams === 0 && r.dm_threads === 0;
      return { status: clean ? "PASS" : "FAIL", detail: clean ? undefined : `left over: ${r.users} qa users, ${r.teams} test teams, ${r.dm_threads} direct threads` };
    }
    case "manual":
      return { status: "TODO", detail: "by hand — see docs/TESTING.md" };
    default:
      return { status: "FAIL", detail: `unknown suite kind ${s.kind}` };
  }
}

// ---------------------------------------------------------------------------------------------
function printMap() {
  const byId = Object.fromEntries(SUITES.map((s) => [s.id, s]));
  console.log("Feature coverage (docs/TESTING.md)\n");
  for (const f of FEATURES) {
    const auto = f.suites.filter((id) => byId[id] && byId[id].kind !== "manual");
    const mark = auto.length === 0 ? "⚠︎ NO AUTOMATED TEST" : auto.some((id) => byId[id].kind === "live" || byId[id].kind === "xcode-test") ? "" : "(unit only)";
    console.log(`${f.name}${f.decisions.length ? ` [${f.decisions.join(", ")}]` : ""} ${mark}`);
    console.log(`    ${auto.length ? auto.join(", ") : "—"}`);
  }
  const gaps = FEATURES.filter((f) => f.suites.length === 0);
  const thin = FEATURES.filter((f) => f.suites.length > 0 && f.suites.every((id) => ["security"].includes(id)));
  console.log(`\nGaps: ${gaps.map((g) => g.name).join("; ") || "none"}`);
  console.log(`Covered only by the security probe (permissions, not behavior): ${thin.map((g) => g.name).join("; ") || "none"}`);
}

function printAffected(base) {
  const changed = sh(`git diff --name-only ${base}...HEAD`).split("\n").concat(sh("git status --porcelain").split("\n").map((l) => l.slice(3))).filter(Boolean);
  const touched = FEATURES.filter((f) => changed.some((c) => f.paths.some((p) => c.startsWith(p))));
  const suites = [...new Set(touched.flatMap((f) => f.suites))];
  console.log(`${changed.length} changed files since ${base}`);
  console.log(`Features touched: ${touched.map((f) => f.name).join("; ") || "none mapped"}`);
  console.log(`Suites that cover them: ${suites.join(", ") || "—"}`);
  console.log(`\nRun before shipping: node scripts/test/run.mjs regression   (a feature change always gets the whole regression tier;`);
  console.log(`while iterating:      node scripts/test/run.mjs regression --only ${suites.filter((s) => !["exploratory", "checklist"].includes(s)).join(",") || "app-unit"})`);
}

function report({ tier, runId, commit, dirty, started, results, overall, note }) {
  const rows = results.map((r) => `| ${r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : r.status === "BLOCKED" ? "⏸" : "📝"} ${r.status} | ${r.id} | ${r.title} | ${r.counts ?? ""} | ${r.seconds}s | ${(r.detail ?? "").replace(/\|/g, "/")} |`).join("\n");
  const touched = FEATURES.map((f) => {
    const mine = results.filter((r) => f.suites.includes(r.id));
    const state = mine.length === 0 ? "not covered" : mine.some((r) => r.status === "FAIL") ? "❌ broken" : mine.every((r) => r.status === "PASS") ? "✅" : "partly checked";
    return `| ${f.name} | ${state} |`;
  }).join("\n");
  return `# ClubHQ ${tier} run — ${overall}\n\n- Run: ${runId}\n- Commit: ${commit}${dirty ? " plus uncommitted changes" : ""}\n- Started: ${started.toISOString()}\n${note ? `- Note: ${note}\n` : ""}\n## Suites\n\n| Result | Suite | What it checks | Counts | Time | Detail |\n|---|---|---|---|---|---|\n${rows}\n\n## Features\n\n| Feature | State |\n|---|---|\n${touched}\n\nLogs for each suite are next to this report.\n`;
}

// ---------------------------------------------------------------------------------------------
function run(cmd, args, { env, log }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env });
    let out = "";
    const add = (d) => { out += d; };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { out += `\n[runner] timed out after ${SUITE_TIMEOUT_MS / 60000} min\n`; child.kill("SIGTERM"); }, SUITE_TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); writeFileSync(log, out); resolve({ code: code ?? 1, out }); });
  });
}

function sh(command) {
  try { return execSync(command, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

function pickSimulator(env) {
  const json = JSON.parse(execSync("xcrun simctl list devices available -j", { env, encoding: "utf8" }));
  const runtimes = Object.keys(json.devices).filter((k) => /iOS-27/.test(k)).sort().reverse();
  for (const rt of runtimes) {
    const phone = json.devices[rt].find((d) => /^iPhone 1[78] Pro$/.test(d.name)) ?? json.devices[rt].find((d) => d.name.startsWith("iPhone"));
    if (phone) return phone.udid;
  }
  throw new Error("no iOS 27 iPhone simulator found (Xcode → Settings → Components)");
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
}

async function sql(env, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  return res.json();
}

function testCounts(out) {
  const swift = out.match(/Test run with (\d+) tests? in \d+ suites? (passed|failed)[^\n]*/);
  if (swift) return `${swift[1]} tests ${swift[2]}`;
  const xc = [...out.matchAll(/Executed (\d+) tests?, with (\d+) failures?/g)].at(-1);
  return xc ? `${xc[1]} tests, ${xc[2]} failures` : undefined;
}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function firstLine(out, re) { return out.split("\n").find((l) => re.test(l))?.trim().slice(0, 200); }

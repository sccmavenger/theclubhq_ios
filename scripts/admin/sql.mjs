// Runs SQL against the TeamClubHQ project through the Management API.
//   set -a; source .env.local; set +a; node scripts/admin/sql.mjs "select 1"      (or a .sql file path)
import { readFileSync, existsSync } from "node:fs";
const { SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");
const arg = process.argv[2] ?? "";
const query = existsSync(arg) ? readFileSync(arg, "utf8") : arg;
const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const text = await res.text();
console.log(text.length > 4000 ? text.slice(0, 4000) + "…" : text);
if (!res.ok) process.exit(1);

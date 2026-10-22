// Usage: node scripts/asc/ship-build.mjs <build-number> "<What to Test text>"
// Use the number from the exported IPA (Xcode may bump it on upload), not the project setting.
// Waits for processing, sets What to Test, adds to the external group, submits for beta review.
import { asc, errs } from "./asc.mjs";
const [VERSION, WHATS_NEW] = process.argv.slice(2);
if (!VERSION || !WHATS_NEW) { console.log("usage: ship-build.mjs <build> <what to test>"); process.exit(1); }
const APP = "6822555956", EXTERNAL = "85905b3a-f4ab-49af-b2a1-9644645a1102";
const report = (label, r) => console.log(`${r.status < 300 ? "OK  " : "FAIL"} ${label} (${r.status})${r.status < 300 ? "" : " — " + errs(r).slice(0, 300)}`);
let build;
for (let i = 0; i < 60; i++) {
  build = (await asc("GET", `/v1/builds?filter[app]=${APP}&filter[version]=${VERSION}&fields[builds]=processingState,usesNonExemptEncryption,version,uploadedDate`)).json?.data?.[0];
  const st = build?.attributes.processingState;
  if (st === "VALID") break;
  if (st === "INVALID" || st === "FAILED") { console.log("processing failed", st); process.exit(1); }
  await new Promise(s => setTimeout(s, 20000));
}
console.log(`build ${VERSION}:`, JSON.stringify(build?.attributes));
// Guard: Xcode's export can renumber the build (manageAppVersionAndBuildNumber), so make sure
// this is the upload we just did and not an older build with the same number.
if (Date.now() - Date.parse(build.attributes.uploadedDate) > 3 * 3600 * 1000) {
  console.log(`build ${VERSION} was uploaded ${build.attributes.uploadedDate} — not a fresh upload. Check the real build number.`);
  process.exit(1);
}
const B = build.id;
const locs = (await asc("GET", `/v1/builds/${B}/betaBuildLocalizations`)).json?.data ?? [];
const en = locs.find(l => l.attributes.locale === "en-US");
report("What to Test", en
  ? await asc("PATCH", `/v1/betaBuildLocalizations/${en.id}`, { data: { type: "betaBuildLocalizations", id: en.id, attributes: { whatsNew: WHATS_NEW } } })
  : await asc("POST", "/v1/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew: WHATS_NEW }, relationships: { build: { data: { type: "builds", id: B } } } } }));
report("add to external group", await asc("POST", `/v1/betaGroups/${EXTERNAL}/relationships/builds`, { data: [{ type: "builds", id: B }] }));
for (const v of [String(Number(VERSION) - 2), String(Number(VERSION) - 1)]) {
  const id = (await asc("GET", `/v1/builds?filter[app]=${APP}&filter[version]=${v}`)).json.data[0].id;
  const s = (await asc("GET", `/v1/betaAppReviewSubmissions?filter[build]=${id}`)).json.data.map(d => d.attributes.betaReviewState);
  console.log(`build ${v} review:`, JSON.stringify(s));
}
report(`submit build ${VERSION} for Beta App Review`, await asc("POST", "/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: B } } } } }));
console.log(`build ${VERSION} detail:`, JSON.stringify((await asc("GET", `/v1/builds/${B}/buildBetaDetail`)).json.data.attributes));

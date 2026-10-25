// Usage: node scripts/asc/swap-review-build.mjs <build-number> [--with-coach-pro]
//          [--version-string 1.0.1] [--screenshots <dir>] [--any-age]
// Replaces the build on the in-review App Store version: cancels the active review submission,
// attaches the new build, syncs description + review notes from docs/app-store/metadata.json,
// keeps release = automatic after approval, and resubmits.
import fs from "fs";
import { asc, errs } from "./asc.mjs";
const APP = "6822555956", VERSION = "0588d610-4e32-4a8a-b5fe-431122f3c402";
const BUILD = process.argv[2];
// --with-coach-pro: also submit the Coach Pro subscriptions (first-time subscriptions must go
// with an app version) and add the Coach Pro sections to the listing and review notes (D-034).
// Requires the Paid Apps Agreement; untested until then.
const WITH_PRO = process.argv.includes("--with-coach-pro");
const SUB_GROUP = "22474078";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
// --version-string: rename the (never-released) version to match the build's marketing version.
const VERSION_STRING = arg("--version-string");
// --screenshots <dir>: replace all iPhone screenshots with the PNGs in <dir> (sorted by name), as
// one 6.9" set (APP_IPHONE_67). App Store Connect scales it down for smaller iPhones, so any other
// iPhone sets are deleted.
const SHOTS_DIR = arg("--screenshots");
// --any-age: skip the fresh-upload guard (for a build that's been in TestFlight a while).
const ANY_AGE = process.argv.includes("--any-age");
const meta = JSON.parse(fs.readFileSync(new URL("../../docs/app-store/metadata.json", import.meta.url), "utf8"));
const report = (l, r) => { console.log(`${r.status < 300 ? "OK  " : "FAIL"} ${l} (${r.status}) ${r.status < 300 ? "" : errs(r)}`); if (r.status >= 300) process.exit(1); return r; };
const sleep = ms => new Promise(s => setTimeout(s, ms));

let build;
for (let i = 0; i < 60; i++) {
  build = (await asc("GET", `/v1/builds?filter[app]=${APP}&filter[version]=${BUILD}&fields[builds]=processingState,uploadedDate`)).json?.data?.[0];
  if (build?.attributes.processingState === "VALID") break;
  await sleep(20000);
}
if (build?.attributes.processingState !== "VALID") { console.log("build not VALID:", JSON.stringify(build?.attributes)); process.exit(1); }
if (!ANY_AGE && Date.now() - Date.parse(build.attributes.uploadedDate) > 6 * 3600 * 1000) { console.log("build is not a fresh upload"); process.exit(1); }
console.log(`build ${BUILD} VALID, uploaded ${build.attributes.uploadedDate}`);

const subs = (await asc("GET", `/v1/apps/${APP}/reviewSubmissions?filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,READY_FOR_REVIEW`)).json.data;
for (const s of subs) report(`cancel submission ${s.id}`, await asc("PATCH", `/v1/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } }));
for (let i = 0; i < 30; i++) {
  const st = (await asc("GET", `/v1/appStoreVersions/${VERSION}`)).json.data.attributes.appStoreState;
  if (!["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(st)) { console.log("version state:", st); break; }
  await sleep(10000);
}
if (VERSION_STRING) report(`version string ${VERSION_STRING}`, await asc("PATCH", `/v1/appStoreVersions/${VERSION}`, { data: { type: "appStoreVersions", id: VERSION, attributes: { versionString: VERSION_STRING } } }));
report(`attach build ${BUILD}`, await asc("PATCH", `/v1/appStoreVersions/${VERSION}/relationships/build`, { data: { type: "builds", id: build.id } }));
report("release after approval", await asc("PATCH", `/v1/appStoreVersions/${VERSION}`, { data: { type: "appStoreVersions", id: VERSION, attributes: { releaseType: "AFTER_APPROVAL" } } }));
const loc = (await asc("GET", `/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`)).json.data.find(l => l.attributes.locale === "en-US");
let description = meta.version_1_0.description;
let notes = meta.app_review_information.notes;
if (WITH_PRO) {
  description = description.replace("PRIVACY FIRST", meta.version_1_0.coach_pro_description_section + "PRIVACY FIRST");
  notes += meta.app_review_information.coach_pro_review_notes;
  const subs = (await asc("GET", `/v1/subscriptionGroups/${SUB_GROUP}/subscriptions`)).json.data;
  const notReady = subs.filter((x) => x.attributes.state !== "READY_TO_SUBMIT" && x.attributes.state !== "WAITING_FOR_REVIEW");
  if (notReady.length) { console.log("subscriptions not ready:", notReady.map((x) => `${x.attributes.productId}=${x.attributes.state}`).join(", ")); process.exit(1); }
  for (const sub of subs.filter((x) => x.attributes.state === "READY_TO_SUBMIT")) {
    report(`submit ${sub.attributes.productId}`, await asc("POST", "/v1/subscriptionSubmissions", { data: { type: "subscriptionSubmissions", relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } } } }));
  }
}
if (SHOTS_DIR) await replaceScreenshots(loc.id, SHOTS_DIR);
report("description", await asc("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { description } } }));
const det = (await asc("GET", `/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`)).json.data;
report("review notes", await asc("PATCH", `/v1/appStoreReviewDetails/${det.id}`, { data: { type: "appStoreReviewDetails", id: det.id, attributes: { notes } } }));
const sub = report("create submission", await asc("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP } } } } })).json.data;
report("add version", await asc("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: VERSION } } } } }));
report("submit", await asc("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } }));
await sleep(5000);
const v = (await asc("GET", `/v1/appStoreVersions/${VERSION}?include=build`)).json;
console.log("final:", v.data.attributes.versionString, v.data.attributes.appStoreState, "release:", v.data.attributes.releaseType, "build:", v.included?.[0]?.attributes.version);

async function replaceScreenshots(locID, dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) { console.log("no PNGs in", dir); process.exit(1); }
  const sets = (await asc("GET", `/v1/appStoreVersionLocalizations/${locID}/appScreenshotSets`)).json.data;
  for (const s of sets.filter((x) => x.attributes.screenshotDisplayType.startsWith("APP_IPHONE"))) {
    report(`delete screenshot set ${s.attributes.screenshotDisplayType}`, await asc("DELETE", `/v1/appScreenshotSets/${s.id}`));
  }
  const set = report("create APP_IPHONE_67 set", await asc("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets",
    attributes: { screenshotDisplayType: "APP_IPHONE_67" }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locID } } } } })).json.data;
  for (const f of files) {
    const bytes = fs.readFileSync(`${dir}/${f}`);
    const shot = report(`reserve ${f}`, await asc("POST", "/v1/appScreenshots", { data: { type: "appScreenshots",
      attributes: { fileName: f, fileSize: bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } })).json.data;
    for (const op of shot.attributes.uploadOperations) {
      const res = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])),
        body: bytes.subarray(op.offset, op.offset + op.length) });
      if (!res.ok) { console.log(`FAIL upload ${f} (${res.status})`); process.exit(1); }
    }
    const md5 = (await import("crypto")).createHash("md5").update(bytes).digest("hex");
    report(`commit ${f}`, await asc("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } }));
  }
  for (let i = 0; i < 120; i++) {
    const shots = (await asc("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots`)).json.data;
    const states = shots.map((x) => x.attributes.assetDeliveryState?.state);
    if (states.some((st) => st === "FAILED")) { console.log("screenshot processing failed:", JSON.stringify(shots.map((x) => x.attributes.assetDeliveryState))); process.exit(1); }
    if (states.every((st) => st === "COMPLETE")) { console.log(`OK   ${shots.length} screenshots processed`); return; }
    await sleep(5000);
  }
  console.log("screenshots still processing; check App Store Connect"); process.exit(1);
}

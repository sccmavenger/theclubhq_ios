// Usage: node scripts/asc/swap-review-build.mjs <build-number>
// Replaces the build on the in-review App Store version: cancels the active review submission,
// attaches the new build, syncs description + review notes from docs/app-store/metadata.json,
// keeps release = automatic after approval, and resubmits.
import fs from "fs";
import { asc, errs } from "./asc.mjs";
const APP = "6822555956", VERSION = "0588d610-4e32-4a8a-b5fe-431122f3c402";
const BUILD = process.argv[2];
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
if (Date.now() - Date.parse(build.attributes.uploadedDate) > 6 * 3600 * 1000) { console.log("build is not a fresh upload"); process.exit(1); }
console.log(`build ${BUILD} VALID, uploaded ${build.attributes.uploadedDate}`);

const subs = (await asc("GET", `/v1/apps/${APP}/reviewSubmissions?filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,READY_FOR_REVIEW`)).json.data;
for (const s of subs) report(`cancel submission ${s.id}`, await asc("PATCH", `/v1/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } }));
for (let i = 0; i < 30; i++) {
  const st = (await asc("GET", `/v1/appStoreVersions/${VERSION}`)).json.data.attributes.appStoreState;
  if (!["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(st)) { console.log("version state:", st); break; }
  await sleep(10000);
}
report(`attach build ${BUILD}`, await asc("PATCH", `/v1/appStoreVersions/${VERSION}/relationships/build`, { data: { type: "builds", id: build.id } }));
report("release after approval", await asc("PATCH", `/v1/appStoreVersions/${VERSION}`, { data: { type: "appStoreVersions", id: VERSION, attributes: { releaseType: "AFTER_APPROVAL" } } }));
const loc = (await asc("GET", `/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`)).json.data.find(l => l.attributes.locale === "en-US");
report("description", await asc("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { description: meta.version_1_0.description } } }));
const det = (await asc("GET", `/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`)).json.data;
report("review notes", await asc("PATCH", `/v1/appStoreReviewDetails/${det.id}`, { data: { type: "appStoreReviewDetails", id: det.id, attributes: { notes: meta.app_review_information.notes } } }));
const sub = report("create submission", await asc("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP } } } } })).json.data;
report("add version", await asc("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: VERSION } } } } }));
report("submit", await asc("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } }));
await sleep(5000);
const v = (await asc("GET", `/v1/appStoreVersions/${VERSION}?include=build`)).json;
console.log("final:", v.data.attributes.versionString, v.data.attributes.appStoreState, "release:", v.data.attributes.releaseType, "build:", v.included?.[0]?.attributes.version);

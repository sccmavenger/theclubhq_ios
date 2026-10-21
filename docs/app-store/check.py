# Validates App Store metadata against Apple's field limits.
import json, pathlib, sys
m = json.loads((pathlib.Path(__file__).parent / "metadata.json").read_text())
limits = [
    ("name", m["app_information"]["name"], 30), ("subtitle", m["app_information"]["subtitle"], 30),
    ("promotional_text", m["version_1_0"]["promotional_text"], 170), ("description", m["version_1_0"]["description"], 4000),
    ("keywords", m["version_1_0"]["keywords"], 100), ("review_notes", m["app_review_information"]["notes"], 4000),
    ("beta_description", m["testflight"]["beta_app_description"], 4000), ("what_to_test", m["testflight"]["what_to_test"], 4000),
] + [(f"iap {s['product_id']} display", s["display_name"], 35) for s in m["in_app_purchases"]["subscriptions"]] \
  + [(f"iap {s['product_id']} description", s["description"], 55) for s in m["in_app_purchases"]["subscriptions"]]
ok = True
for name, text, limit in limits:
    status = "ok " if len(text) <= limit else "TOO LONG"
    ok &= len(text) <= limit
    print(f"{status} {name}: {len(text)}/{limit}")
kw = m["version_1_0"]["keywords"].split(",")
name_words = {w.lower() for w in m["app_information"]["name"].split()}
dupes = [k for k in kw if k in name_words]
print("keywords repeat app-name words:", dupes or "none", "| spaces after commas:", any(k != k.strip() for k in kw))
sys.exit(0 if ok else 1)

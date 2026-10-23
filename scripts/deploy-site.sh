#!/bin/zsh
# Publishes site/ to the Cloudflare Pages project "teamclubhq" (teamclubhq.com).
# Requires a one-time `npx wrangler login`. README.md is excluded from the upload.
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/site-deploy
rm -rf "$out" && cp -R site "$out" && rm -f "$out/README.md" && find "$out" -name .DS_Store -delete
npx -y wrangler@latest pages deploy "$out" --project-name teamclubhq --branch main \
  --commit-dirty=true --commit-message "${1:-Site update}"

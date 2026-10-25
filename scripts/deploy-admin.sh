#!/bin/zsh
# Publishes admin/ to the Cloudflare Pages project "clubhq-admin" (D-041).
# Requires a one-time `npx wrangler login`. Creates the project on first run.
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/admin-deploy
rm -rf "$out" && cp -R admin "$out" && find "$out" -name .DS_Store -delete
npx -y wrangler@latest pages project list 2>/dev/null | grep -q "clubhq-admin" \
  || npx -y wrangler@latest pages project create clubhq-admin --production-branch main --force
npx -y wrangler@latest pages deploy "$out" --project-name clubhq-admin --branch main \
  --commit-dirty=true --commit-message "${1:-Admin portal update}"

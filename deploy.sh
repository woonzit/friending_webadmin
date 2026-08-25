#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_HOST="${FRIENDING_WEBADMIN_HOST:-googlecloud@34.30.1.210}"
SSH_KEY="${FRIENDING_WEBADMIN_SSH_KEY:-$HOME/.ssh/googlecloud}"
TARGET="/opt/friending/admin"
PM2_NAME="friending-webadmin"
COMMIT_SHA="$(git -C "$SCRIPT_DIR" rev-parse --verify HEAD)"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

if [[ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]]; then
  echo "Refusing to deploy a dirty working tree." >&2
  exit 1
fi

if git -C "$SCRIPT_DIR" rev-parse --verify '@{upstream}' >/dev/null 2>&1; then
  read -r behind_count ahead_count < <(
    git -C "$SCRIPT_DIR" rev-list --left-right --count '@{upstream}...HEAD'
  )
  if [[ "$behind_count" != "0" || "$ahead_count" != "0" ]]; then
    echo "Refusing to deploy a commit that is not synchronized with its upstream." >&2
    exit 1
  fi
fi

if [[ "${1:-}" != "--go" ]]; then
  echo "Dry run only. Re-run with --go after reviewing this file list:"
  # Match both a normal checkout's directory and a linked worktree's .git file.
  rsync -azn --itemize-changes \
    --exclude '.git' \
    --exclude '.next/' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '*.tsbuildinfo' \
    --exclude '*.log' \
    -e "ssh -i $SSH_KEY -o BatchMode=yes" \
    "$SCRIPT_DIR/" "$SERVER_HOST:$TARGET/"
  exit 0
fi

cd "$SCRIPT_DIR"
npm test
npm run typecheck
npm run build
npm audit --omit=dev

# Match both a normal checkout's directory and a linked worktree's .git file.
rsync -az \
  --exclude '.git' \
  --exclude '.next/' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '*.tsbuildinfo' \
  --exclude '*.log' \
  -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$SCRIPT_DIR/" "$SERVER_HOST:$TARGET/"

ssh -i "$SSH_KEY" -o BatchMode=yes "$SERVER_HOST" "
  set -euo pipefail
  cd '$TARGET'
  test -f .env.local
  npm ci
  npm test
  npm run typecheck
  npm run build
  if pm2 describe '$PM2_NAME' >/dev/null 2>&1; then
    pm2 restart '$PM2_NAME' --update-env
  else
    pm2 start npm --name '$PM2_NAME' -- start
  fi
  printf '%s\n' '$COMMIT_SHA' > .deploy_commit
  pm2 save
"

echo "Deployed $COMMIT_SHA to https://friendingapp.com"

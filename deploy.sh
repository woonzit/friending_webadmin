#!/usr/bin/env bash

# Staged release of an exact, reviewed commit.
#
# The uploaded bytes are a `git archive` of HEAD, never the live working tree,
# so an untracked or ignored file can never reach production. The tar is
# hashed before and after extraction and the hash is printed with the commit,
# which is what `docs/DEPLOYMENT.md` asks you to record for the release.
#
# Order matters: publish `main` to its upstream FIRST, then deploy that exact
# commit. The guards below refuse anything else.

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
    echo "Publish main first, then re-run this script on the published commit." >&2
    exit 1
  fi
else
  echo "Refusing to deploy: HEAD has no upstream. Publish main first." >&2
  exit 1
fi

# Exact archive of the reviewed commit, hashed, then extracted to a stage.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ARCHIVE="$STAGE/webadmin-$COMMIT_SHA.tar"
git -C "$SCRIPT_DIR" archive --format=tar "$COMMIT_SHA" >"$ARCHIVE"
ARCHIVE_SHA256="$(shasum -a 256 "$ARCHIVE" | cut -d ' ' -f 1)"
mkdir -p "$STAGE/tree"
tar -xf "$ARCHIVE" -C "$STAGE/tree"
if [[ "$(shasum -a 256 "$ARCHIVE" | cut -d ' ' -f 1)" != "$ARCHIVE_SHA256" ]]; then
  echo "Archive changed while it was being extracted." >&2
  exit 1
fi

echo "Commit:  $COMMIT_SHA"
echo "Archive: sha256 $ARCHIVE_SHA256"

# `.deploy_commit` is written on the server and must never be overwritten from
# a workstation. `.env.local` is server-only. The rest cannot appear in an
# archive of tracked files and is excluded as defence in depth.
RSYNC_EXCLUDES=(
  --exclude '.env'
  --exclude '.env.local'
  --exclude '.deploy_commit'
  --exclude 'node_modules'
  --exclude '.next/'
  --exclude '.git'
  --exclude '*.tsbuildinfo'
  --exclude '*.log'
)

if [[ "${1:-}" != "--go" ]]; then
  echo "Dry run only. Re-run with --go after reviewing this file list:"
  rsync -azn --itemize-changes \
    "${RSYNC_EXCLUDES[@]}" \
    -e "ssh -i $SSH_KEY -o BatchMode=yes" \
    "$STAGE/tree/" "$SERVER_HOST:$TARGET/"
  exit 0
fi

cd "$SCRIPT_DIR"
npm test
npm run typecheck
npm run build
npm audit --omit=dev

# Never `--delete`: the server keeps `.env.local`, its build cache and its
# `.deploy_commit`.
rsync -az \
  "${RSYNC_EXCLUDES[@]}" \
  -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$STAGE/tree/" "$SERVER_HOST:$TARGET/"

# PM2 runs as the login user (`googlecloud`); its daemon owns
# friending-webadmin. Under `sudo` PM2 talks to root's daemon and reports the
# process as not found, so this block must never be wrapped in sudo.
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

echo "Deployed $COMMIT_SHA (archive sha256 $ARCHIVE_SHA256) to https://friendingapp.com"
echo "Run the post-deploy smoke in docs/DEPLOYMENT.md before you close the release."

# Friending Webadmin deployment

This document contains no credential values. Secret material stays on the
server and must never be pasted into source, commits, logs, screenshots, or AI
prompts.

## Runtime map

| Item | Value |
|---|---|
| Public URL | `https://friendingapp.com` |
| Server | `googlecloud@34.30.1.210` |
| Host override | `FRIENDING_WEBADMIN_HOST` |
| SSH key | `FRIENDING_WEBADMIN_SSH_KEY` or `$HOME/.ssh/googlecloud` |
| Application directory | `/opt/friending/admin` |
| Internal listener | `127.0.0.1:3006` |
| PM2 process | `friending-webadmin` |
| Core endpoint | `https://core.friending.com` |
| Core repository | `woonzit/friending_core` |
| Webadmin repository | `woonzit/friending_webadmin` |

The host is shared with other live products. Never modify `/opt/ingatlan`,
`/opt/zsakmany`, `/opt/friending/new`, `/opt/friending/pic`, `/opt/friending/coffee`, or unrelated
Apache vhosts.

## DNS and TLS

`friendingapp.com` has an A record for `34.30.1.210`.

Expected Apache TLS files:

```text
/etc/apache2/ssl/friendingapp_com.crt
/etc/apache2/ssl/friendingapp.com.key
/etc/apache2/ssl/friendingapp_com.ca-bundle
```

The private key must be owned by root and mode `0600`. Validate that the certificate and key match
before changing the vhost. Apache configuration is infrastructure-owned and is not stored in this
repository. The existing `friendingapp.com` vhost is in
`/etc/apache2/sites-available/000-default.conf`; back it up before replacing its old document-root
handling with a reverse proxy to `127.0.0.1:3006`.

Then run `sudo apache2ctl configtest` before `sudo systemctl reload apache2`.
Never reload Apache after a failed config test.

## Server-only environment

`/opt/friending/admin/.env.local` is mode `0600` and contains exactly these
server-only variables:

```text
CORE_API_BASE=https://core.friending.com
WEBADMIN_API_SECRET=<same value as Core WEBADMIN_SECRET>
WEBADMIN_SESSION_SECRET=<independent random value, at least 32 bytes>
```

Neither secret may use a `NEXT_PUBLIC_` prefix. The session key must not reuse
the Core secret.

## Authentication bootstrap

Core owns the `friending_new.admin_emails` allow-list. The first production
owner is bootstrapped once in MongoDB; all later administrators are managed
from the Admin users page. A bootstrap record contains:

```text
email, role=owner, is_active=true, created_at, updated_at
```

Login codes are short-lived and are sent through the existing Friending
transactional mail pipeline. The Next.js application signs its own host-only
HttpOnly session cookie and rechecks active Core membership on every protected
request.

## Deploy

A release ships one reviewed commit, in this order. `deploy.sh` implements
steps 2 to 7 and refuses to start unless step 1 has happened.

1. **Publish `main` first.** The commit must already exist on its upstream.
   The script refuses a dirty tree, a branch without an upstream, and a HEAD
   that is ahead of or behind that upstream — deploying an unpublished commit
   would leave production on a state nobody can fetch.
2. **Stage an exact archive.** `git archive` of that commit is written to a
   temporary tar, hashed with SHA-256, extracted, and hashed again. Only
   tracked files of the reviewed commit reach the stage; an untracked or
   ignored file on the workstation can never reach production. The script
   prints the commit and the archive hash — record both with the release.
3. **Local gates.** `npm test`, `npm run typecheck`, `npm run build` and
   `npm audit --omit=dev` run on the workstation before anything is uploaded.
4. **Upload the stage.** `rsync` without `--delete`, excluding `.env.local`,
   `.env`, `.deploy_commit`, `node_modules`, `.next/`, `.git`, build info and
   logs. The server keeps its own environment file, its build cache and its
   deploy record; nothing server-owned is overwritten from a workstation.
5. **Server gates.** `npm ci`, `npm test`, `npm run typecheck` and
   `npm run build` run again in `/opt/friending/admin`, and the script first
   asserts that `.env.local` is present.
6. **Restart PM2 as the `googlecloud` user.** The PM2 daemon that owns
   `friending-webadmin` belongs to that login user. Never wrap this in `sudo`:
   under `sudo` PM2 talks to root's daemon and reports the process as not
   found, which looks like a missing app while the real one keeps running the
   old code. The script restarts through the same SSH login, then writes the
   exact commit to `.deploy_commit` and runs `pm2 save`.
7. **Smoke.** Run the checks under *Verification* below before you call the
   release done.

The canonical commands are:

```bash
./deploy.sh        # dry run: itemized rsync of the staged archive
./deploy.sh --go   # gates, upload, server gates, restart, deploy record
```

The dry run stages and hashes the archive exactly like a real release, so the
file list it prints is the file list `--go` would upload.

Feature readiness flags are compatibility cutovers, not deploy conveniences. Flip a flag only
after its matching Core provider release is live and its authenticated boundary smoke has passed.
If Core is rolled back, un-flip the dependent Webadmin flag in the same recovery window; leaving a
new consumer enabled against an older provider intentionally fails closed and can make shared pages
such as registered-user detail unavailable.

## Verification

After deployment:

```bash
curl -sS -I https://friendingapp.com/login
curl -sS -I https://friendingapp.com/
curl -sS -X POST https://friendingapp.com/api/admin/overview \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://friendingapp.com' \
  -H 'X-Friending-Admin-Request: 1' \
  --data '{}'
```

Expected results:

- `/login` returns `200`;
- `/` redirects an unauthenticated visitor to `/login`;
- the admin proxy returns `401` without the signed cookie;
- TLS hostname and chain validate;
- `X-Robots-Tag`, CSP, frame, referrer and content-type headers are present;
- `pm2 describe friending-webadmin` is online with no unstable restart loop;
- the Apache error log contains no new proxy or TLS errors.

Do not use a real login-code request as a routine health check because it sends
mail and consumes the per-address rate limit.

Read the live `.deploy_commit` immediately before and after cutover, and verify
that the deployed source hashes match the archive hash the script printed.
Never overwrite a newer divergent release you did not publish.

## Rollback

A rollback is an ordinary release of the previous good commit — never an edit
on the server.

1. Identify the commit to return to: the value `.deploy_commit` held before the
   release, which is also the commit named in the previous release record.
2. Check that commit out locally (it is already published, so the upstream
   guard is satisfied) and run `./deploy.sh` then `./deploy.sh --go`. The same
   staged archive, gates, restart and deploy record apply.
3. Re-run the smoke checks and confirm `.deploy_commit` names the commit you
   rolled back to.

If the release also flipped a readiness switch, un-flip it in the same recovery
window: a consumer left enabled against a rolled-back provider fails closed and
can make shared pages unavailable. A rollback of Webadmin alone never requires a
Core rollback, but a Core rollback always requires un-flipping the dependent
Webadmin switch.

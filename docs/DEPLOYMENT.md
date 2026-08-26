# Freelove Webadmin deployment

This document contains no credential values. Secret material stays on the
server and must never be pasted into source, commits, logs, screenshots, or AI
prompts.

## Runtime map

| Item | Value |
|---|---|
| Public URL | `https://webadmin.freelove.hu` |
| Server | `googlecloud@34.30.1.210` |
| SSH key | `FREELOVE_WEBADMIN_SSH_KEY` or `$HOME/.ssh/googlecloud` |
| Application directory | `/opt/freelove/webadmin` |
| Internal listener | `127.0.0.1:3004` |
| PM2 process | `freelove-webadmin` |
| Core endpoint | `https://core.freelove.hu` |
| Core repository | `woonzit/freelove_core` |
| Webadmin repository | `woonzit/freelove_webadmin` |

The host is shared with other live products. Never modify `/opt/ingatlan`,
`/opt/zsakmany`, original Friending folders, or unrelated Apache vhosts.

## DNS and TLS

`webadmin.freelove.hu` has an A record for `34.30.1.210`.

Expected Apache TLS files:

```text
/etc/apache2/ssl/webadmin_freelove_hu.crt
/etc/apache2/ssl/webadmin.freelove.hu.key
/etc/apache2/ssl/webadmin_freelove_hu.ca-bundle
```

The private key must be owned by root and mode `0600`. Validate the certificate
and key match before enabling the vhost. Apache configuration is infrastructure-owned and is not
stored in this repository. If a separate infrastructure checkout is supplied, review its
`webadmin.freelove.hu` vhost template first. The enabled server file is:

```text
/etc/apache2/sites-available/freelove-webadmin.conf
```

Then run `sudo apache2ctl configtest` before `sudo systemctl reload apache2`.
Never reload Apache after a failed config test.

## Server-only environment

`/opt/freelove/webadmin/.env.local` is mode `0600` and contains exactly these
server-only variables:

```text
CORE_API_BASE=https://core.freelove.hu
WEBADMIN_API_SECRET=<same value as Core WEBADMIN_SECRET>
WEBADMIN_SESSION_SECRET=<independent random value, at least 32 bytes>
```

Neither secret may use a `NEXT_PUBLIC_` prefix. The session key must not reuse
the Core secret.

## Authentication bootstrap

Core owns the `freelove_new.admin_emails` allow-list. The first production
owner is bootstrapped once in MongoDB; all later administrators are managed
from the Admin users page. A bootstrap record contains:

```text
email, role=owner, is_active=true, created_at, updated_at
```

Login codes are short-lived and are sent through the existing Freelove
transactional mail pipeline. The Next.js application signs its own host-only
HttpOnly session cookie and rechecks active Core membership on every protected
request.

## Deploy

The canonical command is:

```bash
./deploy.sh
./deploy.sh --go
```

The first invocation is an itemized rsync dry run. The script refuses a dirty
or unpushed Git state. `--go` runs tests, TypeScript, a production build and the
production dependency audit locally; uploads without `--delete`; then repeats
install/tests/build on the server before restarting PM2 and recording the exact
commit in `.deploy_commit`.

The script deliberately excludes `.env.local`, `.git`, `.next`, `node_modules`
and logs.

## Verification

After deployment:

```bash
curl -sS -I https://webadmin.freelove.hu/login
curl -sS -I https://webadmin.freelove.hu/
curl -sS -X POST https://webadmin.freelove.hu/api/admin/overview \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://webadmin.freelove.hu' \
  -H 'X-Freelove-Admin-Request: 1' \
  --data '{}'
```

Expected results:

- `/login` returns `200`;
- `/` redirects an unauthenticated visitor to `/login`;
- the admin proxy returns `401` without the signed cookie;
- TLS hostname and chain validate;
- `X-Robots-Tag`, CSP, frame, referrer and content-type headers are present;
- `pm2 describe freelove-webadmin` is online with no unstable restart loop;
- the Apache error log contains no new proxy or TLS errors.

Do not use a real login-code request as a routine health check because it sends
mail and consumes the per-address rate limit.

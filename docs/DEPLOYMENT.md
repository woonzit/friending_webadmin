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

The canonical command is:

```bash
./deploy.sh
./deploy.sh --go
```

The first invocation is an itemized rsync dry run. The script refuses a dirty
or upstream-divergent Git state. `--go` runs tests, TypeScript, a production build and the
production dependency audit locally; uploads without `--delete`; then repeats
install/tests/build on the server before restarting PM2 and recording the exact
commit in `.deploy_commit`.

The script deliberately excludes `.env.local`, `.git`, `.next`, `node_modules`
and logs.

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

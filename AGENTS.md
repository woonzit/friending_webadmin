# Friending Webadmin — Shared Agent Instructions

This is the binding repository instruction file for every coding agent. `CLAUDE.md` imports it.
Keep permanent rules here; do not append chronological session logs or historical release
handoffs. Write technical documentation, code, comments, identifiers, commit messages, and
handoffs in English. Product copy remains bilingual English/Hungarian.

## Repository and runtime

- Product: **Friending Webadmin**
- Repository: `https://github.com/woonzit/friending_webadmin`
- Production URL: `https://friendingapp.com`
- Production path: `/opt/friending/admin`
- Runtime: Next.js on `127.0.0.1:3006`, behind shared Apache
- PM2 process: `friending-webadmin`
- Core API: `https://core.friending.com`
- Core repository: `https://github.com/woonzit/friending_core`

The checkout path is deliberately unspecified. Core, Join, and Android may be present as sibling
repositories, but no build, script, test, or instruction may depend on a developer username,
absolute workstation path, or particular workspace root. Legacy admin source and other products
are optional read-only references; never edit or deploy them as an incidental Webadmin task.

## Start and coordination

- Start every session with `git status --short --branch`, inspect the complete current diff, then
  read `git log --oneline -10`.
- Never assume a clean tree and never discard or overwrite changes you did not create.
- If agents work concurrently, use separate branches and Git worktrees. Never run two agents in
  the same directory.
- Before editing an overlapping area, inspect uncommitted work and recent commits.
- When the owner supplies `FRIENDING_COORDINATION_DIR`, treat that append-only shared folder as the
  live coordination board: inspect its newest entries at session start, before overlapping edits,
  before commit/delivery, and at least every three minutes during an active multi-agent lane. Never
  rewrite another agent's entry. If the folder is unavailable, say so explicitly; repository
  build and test workflows must remain standalone and must not depend on it.
- Keep `CLAUDE.md` as the one-line import. Shared rules and current state belong here.
- Stable feature delivery normally includes applicable gates, a descriptive local commit, and a
  factual handoff. Repository pushes and production deployment require current owner
  authorization; never bypass a disabled push URL. Documentation/tooling-only changes do not
  require a production restart when they cannot alter generated or runtime application behavior.

## Product boundary

Webadmin is the authenticated operations console for:

- overview and registered-user support;
- member moderation, profile content, albums, and media review;
- People hero and Join landing configuration;
- runtime configuration and signup/profile catalogues;
- profile presentation, tags, icebreakers, and user groups;
- support/help-centre, Footprints, presence, membership, and verification operations;
- administrator allow-list and immutable audit history;
- App Review sandbox readiness, guarded reset, and reset audit state.

Do not reintroduce AYI/Are You In, Deplug, curated activities/events, event creation/joining,
waiting room, mandatory walkthrough, or other retired Friending surfaces. Persona verification is
in scope only through its reviewed Core contract and dedicated operations surfaces.

The interface is dark-only and bilingual. English is the base/fallback locale and Hungarian is
fully supported. `messages/en.json` and `messages/hu.json` must keep identical key trees. Use the
bundled Proxima Nova fonts and never load remote fonts.

## Security model

- The browser never calls Core directly.
- `WEBADMIN_API_SECRET` is server-only. `lib/core.ts` attaches it to allow-listed
  `/v1/webadmin/*` calls; it must never reach a `NEXT_PUBLIC_*` variable, HTML, browser JavaScript,
  logs, tests, screenshots, or commits.
- `WEBADMIN_SESSION_SECRET` is independent from the Core secret and has at least 32 bytes of
  entropy.
- Login uses an allow-listed email and a short-lived six-digit email code validated by Core.
  Next.js then creates its own HMAC-signed, host-only, HttpOnly, Secure, SameSite=Lax cookie.
- Every dashboard render and every same-origin admin proxy call rechecks active membership through
  Core. Revocation must take effect without waiting for cookie expiry.
- Mutating browser requests require exact Origin/Host equality. Proxy actions are explicitly
  allow-listed; arbitrary Core paths cannot be forwarded.
- The authenticated server overwrites any caller-supplied admin identity with the session email.
- Owner-only actions remain owner-only. Editor/read capabilities come from Core and must not be
  reconstructed optimistically in the browser.
- Admin changes affecting users, media, campaigns, settings, catalogues, membership, or the admin
  allow-list require a Core-owned audit record.
- Never print, commit, document, or expose `.env` values, private keys, Mongo URIs, mail/provider
  credentials, API tokens, review codes, verification codes, or private evidence URLs.

## Architecture and Core contract

- Next.js App Router, React 18, strict TypeScript, and `next-intl` are the supported stack.
- No Tailwind and no CSS-in-JS. Shared tokens and responsive styles live in `app/globals.css`.
- Server-only modules import `server-only`.
- Client components call only same-origin `/api/admin/<allowed-action>` routes.
- Core's Webadmin surface uses URL-encoded form bodies and the legacy response envelope. HTTP may
  be 200 for a logical refusal; always evaluate `status_code` and the typed body.
- Parsers fail closed on malformed, partial, unknown, duplicate, or loosely typed successful
  payloads. A read error must never render as a proven empty state.
- Core owns authorization, validation, revisions, idempotency, persistence, mutations, audit, and
  sensitive evidence policy. The browser owns presentation and conservative client validation.
- Use exact optimistic revisions and caller-minted request IDs where the contract requires them.
  After an uncertain mutation response, reuse the same durable identity or read authoritative
  state; never manufacture a second logical action.
- Keep user-visible text in both locale files. Do not hardcode English or Hungarian copy in page
  components.
- Validate URLs, IDs, pagination, booleans, bounded text, file types, and response shapes at the
  server boundary as well as in presentation code.

## Media and sensitive evidence

- General admin image upload accepts only the explicitly supported formats and bounded sizes,
  normalizes EXIF orientation and dimensions through `sharp`, and forwards only after session and
  active-admin rechecks.
- Profile-field/tag icons accept only bounded PNG or sanitized SVG input. Core remains the final
  storage and URL authority.
- Profile-verification video uses the dedicated authenticated, no-store, Range-capable bridge.
  Queue access does not automatically grant evidence access or exact-birthday access.
- Never cache private evidence broadly, copy it into audit rows, expose direct storage paths, or
  weaken lease/conflict/break-glass rules for a visual test.
- Production mutation smoke must use an explicitly approved demo/review target and the narrowest
  reversible operation available.

## App Review sandbox

Core is the authority for the deterministic review identity, fixture, deletion/reprovisioning,
and scheduled recovery. Webadmin provides only authenticated operations surfaces:

- decode the complete closed fixture-v3 status contract;
- show all 33 readiness checks, 22 count witnesses, media/profile semantics, and lifecycle state;
- hide review identity fields unless Core deliberately projects them to the current operator;
- persist reset request ID and expected revision in `sessionStorage` before mutation;
- reuse that exact pair after timeout, lost response, or page reload;
- clear the pair only after observed convergence or a terminal input conflict;
- disable competing controls while deletion, reprovision, or reset is in progress;
- never display, store, infer, or offer a fallback review code.

`lib/appReviewSandbox.ts` intentionally keeps closed key lists. A compatible Core contract change
must be integrated here before operators can rely on a new status shape. Reset is not a generic
database restore and must never accept an arbitrary account, database, fixture path, or UID.

## Required checks

Run the cheapest focused test first. Before each commit run:

```bash
git diff --check
npm test
npm run typecheck
npm run build
```

Before push or release also run:

```bash
npm audit --omit=dev
```

The optimized build must preserve locale parity and every server/client boundary. Tests should
cover success, validation/refusal paths, guest and cross-origin rejection, role/capability gates,
malformed Core bodies, retry/idempotency behavior, and EN/HU tree parity as applicable.

Inspect hosted CI when authenticated access is available. Unavailable CI is not by itself a
pre-release blocker after an explicitly requested release and a complete green local/server gate.
A known CI failure is a blocker unless the user explicitly authorizes a bypass. Record the exact
unavailable or bypassed evidence.

Documentation-only work does not require unrelated authenticated browser or destructive database
checks. Any edited shell script must at least pass `bash -n` and its safe dry-run path.

## Deployment safety

- The canonical procedure is `docs/DEPLOYMENT.md` and `deploy.sh`.
- Host/key overrides are `FRIENDING_WEBADMIN_HOST` and `FRIENDING_WEBADMIN_SSH_KEY`; the conventional
  key default is `$HOME/.ssh/googlecloud`.
- The host is shared. Never modify unrelated directories, processes, databases, certificates, or
  vhosts.
- `friending-webadmin` binds only to `127.0.0.1:3006`.
- Deploy only a clean commit synchronized with its upstream. Read the live `.deploy_commit`
  immediately before cutover and never overwrite a newer divergent whole-tree release.
- The deploy script preserves `.env.local`, excludes generated/dependency trees, never uses
  `rsync --delete`, repeats tests/typecheck/build on the server, restarts PM2 only after success,
  and writes the exact `.deploy_commit`.
- Run `sudo apache2ctl configtest` before any Apache reload. A failed config test means no reload.
- Verify exact source hashes and `.deploy_commit`, not merely rsync or PM2 exit status.

Compatibility order matters: deploy a backward-compatible Core provider before a Webadmin
consumer that requires the new contract. Do not enable guarded rollout switches as a side effect
of deploying compatible code.

Post-deploy smoke covers HTTPS and HTTP redirect, public login, guest dashboard redirect,
same-origin unauthenticated 401, foreign-origin 403, required security headers, loopback-only
binding, PM2 stability, and every touched authenticated boundary. Do not send a real login code as
a routine health probe because it sends email and spends the rate limit.

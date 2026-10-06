# Membership confirmation boundary (T-899)

Authority: immutable Core `7f86b941`, `WebadminController::adminMe`,
`requireAdminActor`, and `Support\Webadmin::reply`. Tests that construct these
answers are DERIVED, not authenticated Core captures.

Membership is checked afresh on every protected request. A signed local session
identifies the actor; it does not prove current membership. No last-known-good
answer, client recovery state, capability block, or retry grants membership.

## Decision table

All bodies below must have their own strictly typed legacy envelope markers
(`message: 200`, `status: 200`, `can_send: 0`), boolean `success`, and integer
`status_code`. Transport failures cannot be overridden by a successful body.

| Core answer / local condition | Decision | Protected JSON bridge, writer/upload gate, direct intake | Protected server render | Client behavior |
| --- | --- | --- | --- | --- |
| No valid local session (missing, invalid, expired, locally revoked) | Definite non-member | 401 `auth-required`; no action/upload | Redirect `/login`; no protected data | `/login` |
| Local session read / configuration throws (not an established invalid session) | Unconfirmed | 503 `admin-membership-unconfirmed`; no Core action/upload | Neutral recovery shell; no protected page data, no redirect | In-place recovery; no login redirect |
| Complete `success: false`, logical 401, `admin-session-invalid` | Definite non-member | 401 `auth-required`; no action/upload | Redirect `/login`; no protected data | `/login` |
| Complete `success: false`, logical 403, `admin-revoked` | Definite non-member | 401 `auth-required`; no action/upload | Redirect `/login`; no protected data | `/login` |
| HTTP 200, complete `success: true`, logical 200, exact canonical session email and known canonical `owner` / `admin` / `viewer`, no contradictory `error` | Confirmed for this request only | Continue existing independent role/capability/body gates; no added permission | Existing capability-gated page | Existing behavior; recovery does not replay writes |
| Confirmed viewer / missing required capability | Membership confirmed, action unauthorized | Existing 403 action refusal; no action/upload | Existing capability refusal | Stay on page; no login redirect |
| Transport error, timeout, aborted check, or late answer after abandonment | Unconfirmed | 503 `admin-membership-unconfirmed`; no protected read, write, or upload | Neutral recovery shell; no protected page data, no redirect | Stay on page; retain drafts/unknown commands; retry membership with backoff, never replay a write |
| Core 5xx / storage failure / JSON encoding failure | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |
| Service-credential 401 `unauthorized`, unknown 401/403, or role denial | Unconfirmed (not a membership revocation proof) | Same 503 refusal | Same neutral shell | Same in-place recovery; no login redirect |
| Malformed 200: null/scalar/array, missing or loosely typed fields, unknown role, wrong actor, wrong legacy markers, conflicting success/error/status | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |
| Partial/malformed negative body or wrong error/status pair | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |

The boundary is wired in separate commits for the bridge, client, session
gates, layout, and direct intake gate. Their production-handler tests exercise
every applicable row above, including malformed 200 and abandoned requests
that receive a late positive or negative answer. EVERY unconfirmed client call
resolves immediately to an ordinary failure result with the distinct typed
`admin-membership-unconfirmed` code, including reads, writes and uploads.
It does NOT throw into existing callers. No Promise/request is held or re-sent:
a pre-write read cannot silently resume its command after recovery or an
account change. Existing read, write and helper callers run their normal
failure/busy cleanup and keep edits; no per-call exception conversion is
needed. A failed pre-write read is never permission to continue a command.

A dropped browser connection on a READ also resolves immediately with
`admin-membership-unconfirmed` / 503. The client cannot distinguish a dropped
read socket from an unavailable administrator check. This code is not proof
that membership was revoked or that the read never reached Core. The affected
presentation points show an EN/HU sentence about the temporarily unavailable
connection/access check instead of printing the machine code; the typed result
itself is unchanged. Busy state clears, edits remain, and recovery still sends
only its membership probe, never the original audited read or a follow-on write.

Pre-forward/local refusal and a lost write answer are different failure values.
For writes, only a locally blocked call or the bridge's pre-forward 503 uses
`admin-membership-unconfirmed`. An attempted JSON write/upload with a lost
connection or unreadable answer resolves `admin-request-outcome-unknown` / 502,
not the no-forward code. Its global warning remains visible; feature/durable
classifiers must retain unknown intent and check the record/audit before an
explicit retry. Profile-text Save also renders this distinction in EN/HU while
keeping the draft and clearing busy. Neither value resumes or replays a call.

Automatic recovery probes membership only. Its recovery event starts ONLY
registered read-only page loaders from the top: Overview when it has no data
and shows its load error; Research when its overview has never loaded and is
unconfirmed. Once either page has successfully loaded, it is NOT auto-reloaded;
its data, editor drafts and command owners remain untouched. No audited reads
are registered. Each mounted registered loader has at most seven recovery
attempts, with increasing delays (immediate, 1, 2, 4, 8, 16, 30 seconds).
Fresh healthy membership probes do not reset that budget; a request-specific
connection failure cannot loop forever. After exhaustion the page retains its
error and manual reload. Unmount cancels a scheduled attempt, and eligibility
is rechecked at execution. All other pages/editors rely on their existing manual reload,
plus a Shell-wide optional manual page reload after recovery. Ordinary request
failures clear the caller's busy state and show its existing error without
requiring that reload or losing drafts. The fallback has an explicit in-page second confirmation warning that
unsaved state/in-memory retry identities will be discarded and a previously
forwarded write may still finish. It never sends a mutation. A refused write
requires a new operator attempt and another fresh server membership check.

The browser imports only `adminClientReadActions` presentation metadata, not
the server bridge's complete action/access/normalizer table. Exact active-read
parity is tested. This set grants no server authority or automatic retry;
in particular its audited location/evidence entries are not registered loaders.

The five reported read-before-write flows (intake Publish, research Retry,
membership grant Retry, external-event command, external-event case resolution)
are tested against the real client through read outage and same/different actor
recovery: their original handlers end and send zero writes. Positive controls
reach each writer when its reads succeed. Membership grant Retry additionally
compares a fresh complete own-session proof with the editor's stored actor;
another account cannot inherit the pinned request. This does not claim an atomic
actor fence across the subsequent HTTP request; Core still binds every request.
Strict Core transports also check elapsed monotonic time after parsing: a
blocked event loop cannot delay the abort timer and turn an expired answer into
a grant or a definite revocation.

`adminMe` returns an identity only on a complete positive proof, `null` only
for a definite non-session/non-member, and throws the typed
`AdminMembershipUnconfirmedError` otherwise. Every server-render caller
handles that specific error with a neutral recovery component and no protected
page props/children. A fresh opaque render id makes a new unconfirmed server
result restart backoff even when Next reuses the neutral component. Only that
initial neutral page may refresh after a positive recovery probe; ongoing
client outages hide, but never unmount or refresh, existing editors.

Both the initial neutral shell and the loaded Shell's unconfirmed notice keep
Sign out visible. It uses only the same-origin local logout route, never a
Core/admin RPC. The loaded Shell keeps its existing router transition; the
neutral shell navigates to login only after confirmed local logout. Both obey
the retained research-command in-page departure guard before the logout POST.
Staying sends nothing and preserves the session/commands; signing out never
claims to cancel an earlier forwarded action. A local logout failure remains
visible and can be retried rather than claiming the session was cleared.

## Separate post-forward boundary

These six routes have already positively confirmed membership and attempted
the feature call: `upload-image`, `upload-video`, `upload-profile-icon`,
`upload-pinger-icon`, `support-media`, and `persona-member`. Their failure must
not be represented as a definite pre-forward refusal. The same-origin client
never queues or automatically retries any of these requests.

| Feature answer after forwarding | Bridge status | What the operator sees |
| --- | --- | --- |
| Complete `admin-session-invalid` / 401 or `admin-revoked` / 403 | 401 `auth-required` | `/login`; only these complete definite negatives force it |
| Complete known role denial `admin-write-required` / 403 or `owner-required` / 403 | 403, same role error | Remain on page; role refusal, no automatic retry |
| Bare, service, malformed or contradictory 401/403; unknown 403 | 502 `invalid-core-response` | Outcome not confirmed; check affected record/media/audit before an explicit retry |
| Complete named Core 5xx refusal with matching logical/HTTP status | Same status and name | Feature settlement remains authoritative; preserving a name does not prove no write, and storage failures remain uncertain |
| Successful/malformed/unreadable/mismatched 5xx, transport failure, timeout, or abandoned late answer | 502 (public transport error or `invalid-core-response`) | Same uncertainty notice; no claim that no write occurred, no automatic retry |
| Core's real success: image/video/profile icon top-level media fields, pinger nested `data`, support sent `message` OBJECT plus replay/capabilities, persona `profile` + `persona_admin` | Original feature response/projection | Existing success handling, no added permission; six source-derived production-route regressions |
| Other 2xx (including malformed feature bodies) | Passed to the original feature handler | AUTH classifier does not constrain feature success shapes; original per-feature validation remains |
| Existing named input/conflict refusal (other 4xx) | Existing feature status | Existing feature handling; no vocabulary change |

Real HTTP errors cannot be overwritten by a logical success body in these
opted-in transports. Uncertainty-notice dismissal is presentation only: it
does not settle, delete, regenerate or retry any durable command identity.

Support image sends retain their original file, actor target and request id
after `support-storage-unavailable` or an unreadable 500 transformed into
`invalid-core-response`. Explicit Retry reuses that same id; neither the
membership probe nor recovery sends the image again. The page ends an intent
only for its exact named input/moderation/idempotency conflicts, never because
an unknown transport error happens to contain "invalid" or "too-large".

The generic action bridge refuses to expose HTTP 5xx SUCCESS bodies as feature
success. Known synthesized transport failures retain public 502/504; malformed
or successful 5xx bodies become 502 `invalid-core-response`, `success: false`,
without feature data. A complete named Core refusal with matching logical
status keeps its name/status as on main, including 503
`dates-research-place-unavailable` and policy/storage refusals. Only the
existing pinned feature classifiers decide whether a named refusal proves
no write; keeping a refusal name does not add a settlement token. Ordinary
healthy feature successes retain their original handler-owned shapes.

### Global write-outcome notice: proof per name

Lost/malformed answers, synthetic transport failures and unproven named 5xx
feature/storage refusals raise the independent unknown-outcome notice. A
complete refusal envelope or an HTTP status class alone is not a no-write
proof. The pre-forward membership/auth/input refusals keep their existing
behavior. The short source-proven 5xx exemption table currently has one entry:

| Action | Named refusal / status | Core no-write proof |
| --- | --- | --- |
| `dates_event_research_area_save` | `dates-research-place-unavailable` / 503, complete matching envelope | Immutable Core main `68881e54f5c2e8e9cf4b7516c0816b9dfc9dc0b2`, `src/Services/DatesEventResearchAdminService.php:182-187` resolves the place before `DatesEventResearchCommands::execute` opens its transaction; `src/Services/DatesEventResearchAreaResolver.php:29,57,63` raises the refusal there |

A new name enters the client table only with its own Core source proof and a
regression test. The exemption only avoids raising a NEW global notice: it
never dismisses one from an earlier lost write, even after membership recovery
or a later definite refusal. Feature commands still own their idempotency and
settlement rules; `support-storage-unavailable`, for example, may follow a
stored message and keeps both the unknown notice and the original retry id.

## Deliberate cancellation and sign-in behavior

A browser request abandoned between its positive membership proof and its
feature forward is no longer forwarded. The bridge returns 503
`admin-membership-unconfirmed` while no feature was attempted; an abandoned
client ignores late data/navigation. This intentionally avoids continuing an
operator gesture after its caller has gone away. It cannot cancel a feature
that was already forwarded: that response is 504/unknown, and Core may finish.

Only the bridge's complete 401 `success: false`, `auth-required` response
proves sign-out to the browser. A proxy's bare 401 is not treated as proof of
revocation and does not clear the cookie or automatically navigate to login.
An ordinary page gets its failed-request result and its existing error/manual
retry UI. If the membership probe itself gets that answer, membership stays
unconfirmed, protected content stays hidden and the recovery/Sign out controls
remain visible. An unparseable write answer also shows the independent unknown
outcome warning; never infer no write. A later complete bridge auth-required
still navigates normally. A session-holding visitor cannot use the login form
while its membership check is unconfirmed; the neutral shell's local Sign out
is the explicit way to clear that session.

`persona-member` is a dedicated read-only lookup URI, not a generic action.
Its client metadata now suppresses the false lost-WRITE warning for lookup
failures; it still returns an unconfirmed failure immediately, and recovery never
replays it. Its server writer-role, capability, projection and fresh membership
checks are unchanged. No authorization, action allow-list, Core vocabulary or
audit policy was expanded.

## One timer-driven write exception: intake lease heartbeat

The lead explicitly exempts the existing `DatesIntakeReviewPage` maintenance
heartbeat from the no-operator-intent write rule. It carries no new operator
intent, is identical to released main, and is NOT triggered by recovery or a
held/re-sent Promise. Its regular timer is 120 seconds (with the existing
pre-expiry first renewal for an already-held lease). Every tick is a new
`dates_event_intake_lease` / `heartbeat` against the page's current revision;
while membership is unconfirmed, the client refuses it locally without a
bridge request. This is the one permitted timer-driven maintenance write,
not permission for any additional automatic command.

Immutable Core `3f0791d2548315c0a77a694f0e21825903a9f573`,
`DatesEventIntakeAdminService::lease` and `DatesEventIntakeProjection::lease`,
require an in-review intake at the exact revision and an unexpired lease owned
by this current actor. Wrong state/revision returns 409 `dates-intake-conflict`;
a missing/expired/other actor's lease returns 409 `dates-intake-lease-lost`.
Heartbeat writes no audit row. A new account cannot acquire or revive the
old lease by recovery, and an interrupted operator command is never resumed.
These are source/ruling facts, not a new live Core storage test.

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
rejects immediately with `AdminMembershipUnconfirmedClientError`, including
reads, writes and uploads. No Promise/request is held or re-sent: a pre-write
read cannot silently resume its command after recovery or an account change.
UI mutation handlers explicitly catch that typed refusal for their normal
error/busy cleanup; unrelated exceptions are rethrown. This never turns a
failed pre-write read into permission, and no rejected attempt is retried.

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
plus a Shell-wide manual page reload after recovery for an interrupted legacy
loader. That fallback has an explicit in-page second confirmation warning that
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
| 5xx, transport failure, timeout, or abandoned late answer | 502 (public transport error or `invalid-core-response`) | Same uncertainty notice; no claim that no write occurred, no automatic retry |
| Core's real success: image/video/profile icon top-level media fields, pinger nested `data`, support sent `message` OBJECT plus replay/capabilities, persona `profile` + `persona_admin` | Original feature response/projection | Existing success handling, no added permission; six source-derived production-route regressions |
| Other 2xx (including malformed feature bodies) | Passed to the original feature handler | AUTH classifier does not constrain feature success shapes; original per-feature validation remains |
| Existing named input/conflict refusal (other 4xx) | Existing feature status | Existing feature handling; no vocabulary change |

Real HTTP errors cannot be overwritten by a logical success body in these
opted-in transports. Uncertainty-notice dismissal is presentation only: it
does not settle, delete, regenerate or retry any durable command identity.

The generic action bridge also refuses to expose any HTTP 5xx as feature
success, even with a complete positive logical envelope. Known synthesized
transport failures retain their public 502/504; other 5xx become 502
`invalid-core-response` with `success: false` and no feature data. This happens
after forwarding, so it never proves that a write did not occur. Ordinary
healthy feature successes keep the original handler-owned shape.

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
failures; it still rejects an unconfirmed call immediately, and recovery never
replays it. Its server writer-role, capability, projection and fresh membership
checks are unchanged. No authorization, action allow-list, Core vocabulary or
audit policy was expanded.

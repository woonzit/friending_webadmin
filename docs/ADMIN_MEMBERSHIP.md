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
every applicable row above,
including malformed 200 and abandoned requests that receive a late positive or
negative answer. Auto-recovery is restricted to membership and read-only calls;
an operator retry of a refused write must pass a new membership check.
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
| 5xx, transport failure, timeout, malformed/truthy-success 200, or abandoned late answer | 502 (public transport error or `invalid-core-response`) | Same uncertainty notice; no claim that no write occurred, no automatic retry |
| Complete ordinary success | Existing feature response | Existing success handling, no added permission |
| Existing named input/conflict refusal (other 4xx) | Existing feature status | Existing feature handling; no vocabulary change |

Real HTTP errors cannot be overwritten by a logical success body in these
opted-in transports. Uncertainty-notice dismissal is presentation only: it
does not settle, delete, regenerate or retry any durable command identity.

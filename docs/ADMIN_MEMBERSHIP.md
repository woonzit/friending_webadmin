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
| Complete `success: false`, logical 401, `admin-session-invalid` | Definite non-member | 401 `auth-required`; no action/upload | Redirect `/login`; no protected data | `/login` |
| Complete `success: false`, logical 403, `admin-revoked` | Definite non-member | 401 `auth-required`; no action/upload | Redirect `/login`; no protected data | `/login` |
| HTTP 200, complete `success: true`, logical 200, exact canonical session email and known canonical `owner` / `admin` / `viewer`, no contradictory `error` | Confirmed for this request only | Continue existing independent role/capability/body gates; no added permission | Existing capability-gated page | Existing behavior; recovery does not replay writes |
| Confirmed viewer / missing required capability | Membership confirmed, action unauthorized | Existing 403 action refusal; no action/upload | Existing capability refusal | Stay on page; no login redirect |
| Transport error, timeout, aborted check, or late answer after abandonment | Unconfirmed | 503 `admin-membership-unconfirmed`; no protected read, write, or upload | Neutral recovery shell; no protected page data, no redirect | Stay on page; retain drafts/unknown commands; retry membership with backoff, never replay a write |
| Core 5xx / storage failure / JSON encoding failure | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |
| Service-credential 401 `unauthorized`, unknown 401/403, or role denial | Unconfirmed (not a membership revocation proof) | Same 503 refusal | Same neutral shell | Same in-place recovery; no login redirect |
| Malformed 200: null/scalar/array, missing or loosely typed fields, unknown role, wrong actor, wrong legacy markers, conflicting success/error/status | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |
| Partial/malformed negative body or wrong error/status pair | Unconfirmed | Same 503 refusal | Same neutral shell | Same in-place recovery |

The classifier commit establishes this table. Subsequent separately reviewed
commits wire the bridge, client, session gates, layout, and direct intake gate.
Their production-handler tests must exercise every applicable row above,
including malformed 200 and abandoned requests that receive a late positive or
negative answer. Auto-recovery is restricted to membership and read-only calls;
an operator retry of a refused write must pass a new membership check.

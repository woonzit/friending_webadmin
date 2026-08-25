# Per-user product-popup Webadmin contract proposal

Status: **PROPOSAL** for T-208. Provider implementation is T-108; consumer implementation is
T-206 after acceptance.

Provider: Friending Core. Consumer: Friending Webadmin. This document is normative where it uses
**MUST**, **MUST NOT**, **SHOULD**, or **SHOULD NOT**.

## Scope

This contract hardens the existing per-user actions:

- `admin_get_user_popup` — read the authoritative per-user resource;
- `admin_set_user_popup` — create or replace the member's product message;
- `admin_clear_user_popup` — clear the member's product message.

The popup is an in-app product/support message displayed to one known UID. It is not email, SMS,
push, support chat, a global campaign, a forced onboarding gate, or a replacement for a moderation
decision. T-206 supplies the editor and preview inside `/users/[uid]`.

## Transport and version negotiation

1. Requests remain `POST application/x-www-form-urlencoded` to the existing
   `/v1/webadmin/<action>` routes.
2. The browser never calls Core. The authenticated Next.js proxy rechecks active membership,
   supplies the server-only secret, and overwrites any body-supplied administrator identity.
3. The strict consumer **MUST** send `contract_version=1`; a success **MUST** echo
   `data.contract_version=1`.
4. Omitting the version preserves the current successful request/response fields (`popup`,
   `pop_id`, or an empty clear success). Core **MUST** still apply actor, audit, expiry, and safe
   mutation rules to pre-version callers.
5. Responses retain the legacy envelope. Numeric `status_code` is authoritative even when HTTP is
   200.
6. A versioned success contains exactly `success=true`, `status_code=200`, and the defined `data`.
   A refusal contains `success=false`, numeric `status_code`, closed `error`, and only the optional
   authoritative conflict `data` defined below.
7. The request tables list consumer-owned fields. Core also receives exactly one reserved `secret`
   and `admin_email` from the authenticated server; neither is accepted from browser-controlled
   input. Every other unknown field and every duplicate, array-valued, non-scalar, or loosely typed
   versioned field **MUST** be rejected. Boolean-like guessing is forbidden.
8. Version-1 material objects have closed key sets and responses are no-store. Additive response
   fields require a new contract version because the Webadmin parser fails closed.

## Common primitives

- `uid`: canonical positive base-10 integer in `1..2147483647`.
- `request_id`: canonical lowercase UUID v4 matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  Mutation request IDs are unique within this contract family. Core looks up the receipt and
  compares its full fingerprint before revision/state validation; actor email is part of the
  fingerprint, so a different actor gets a request-ID conflict rather than another actor's replay.
- `resource_revision`: integer in `0..2147483647`. Zero means this UID has never had an
  administrator popup resource; every successful set or clear increments it exactly once.
- `pop_id`: 1–128 safe ASCII characters matching
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Every non-replayed set mints a new value so the app can
  distinguish newly authored content.
- Timestamps are non-negative Unix seconds as JSON integers.
- Human-text limits count Unicode scalar values after trim and NFC normalization.

The resource revision **MUST** survive clear and must never return to zero. Core may retain a
tombstone or a separate per-UID revision record; the implementation is private. This prevents an
ABA race in which create → clear → create looks like the original empty resource.
Existing valid popup rows are backfilled once to resource/popup revision 1 without changing their
`pop_id` or member-visible copy; malformed legacy rows stop/report migration rather than becoming
an apparent empty resource.

## Capability model

Every versioned read returns:

```ts
type ProductPopupPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: Array<"product_popup_read" | "product_popup_write">;
};
```

The array is unique and lexicographically sorted. Current mapping: viewer = read; admin/owner =
read + write. Core owns this mapping and Webadmin **MUST NOT** infer write access from the role.

- `admin_get_user_popup` requires `product_popup_read`.
- `admin_set_user_popup` and `admin_clear_user_popup` require `product_popup_write` and recheck it
  at mutation time.
- Core **SHOULD** also expose these capabilities from `admin_me` for non-optimistic panel gating.

## Canonical popup resource

```ts
type ProductPopup = {
  pop_id: string;
  revision: number; // equals containing resource_revision
  status: "active" | "expired";
  title: string;   // 1..100 plain text
  message: string; // 1..1000 plain text
  repeat_mode: "once" | "until_expiry";
  expires_at: number;
  button: {
    action: "none" | "url" | "rate";
    title: string; // 0..60; required unless action=none
    url: string;   // empty unless action=url
  };
  created_at: number;
  created_by: string; // normalized administrator email, 3..320
  updated_at: number;
  updated_by: string; // normalized administrator email, 3..320
};

type ProductPopupResourceData = {
  contract_version: 1;
  principal: ProductPopupPrincipal;
  uid: number;
  resource_revision: number;
  popup: ProductPopup | null;
};
```

Cross-field rules:

- `popup=null` means explicitly clear/no popup, not read failure;
- a non-null popup revision equals `resource_revision` and is at least 1;
- `status=active` iff `expires_at` is greater than Core's response time; otherwise it is `expired`;
- `repeat_mode=once` preserves the existing “show once per pop_id” behavior;
- `repeat_mode=until_expiry` may re-show on app open, but never at or after `expires_at`;
- `button.action=none` requires empty title and URL;
- `button.action=rate` requires a non-empty title and empty URL;
- `button.action=url` requires a non-empty title and one valid HTTPS URL.

A button URL is at most 500 Unicode scalars, has scheme `https`, a non-empty hostname, no username
or password, and no control characters. Relative URLs, HTTP, JavaScript/data/file schemes, and
scheme-relative values are invalid. Core stores and returns the canonical URL.

The resource projection **MUST NOT** contain provider identifiers, device tokens, delivery/open
history, arbitrary app state, the member's contact data, or secret/raw audit details. Administrator
emails are internal operations metadata and must never be included in the member-facing popup
payload.

## Read action: `admin_get_user_popup`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uid` | yes | positive canonical UID |

The user must exist. Missing user and missing popup are distinct: a missing user is an error; an
existing user with no popup is a valid `popup=null` resource.

### Versioned success

The `data` object is exactly `ProductPopupResourceData`. Expired popups remain visible to the
operator as `status=expired` until explicitly cleared or replaced, but the member-facing Core
projection **MUST** suppress them.

## Set action: `admin_set_user_popup`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uid` | yes | positive canonical UID |
| `expected_revision` | yes | exact observed resource revision; zero only for never-authored resource |
| `request_id` | yes | caller-minted UUID v4 |
| `audit_reason` | yes | internal operator reason, 1..500 |
| `title` | yes | trimmed plain text, 1..100 |
| `message` | yes | trimmed plain text, 1..1000 |
| `repeat_mode` | yes | `once` or `until_expiry` |
| `expires_at` | yes | Unix seconds, within the allowed future horizon |
| `button_action` | yes | `none`, `url`, or `rate` |
| `button_title` | yes | empty for none; otherwise 1..60 |
| `button_url` | yes | canonical HTTPS URL only for url; otherwise empty |

At mutation time, `expires_at` **MUST** be at least five minutes and at most 30 days after Core's
current time. Webadmin **SHOULD** default to seven days and must make the exact expiry visible in
preview/confirmation. No mode permits “forced forever”. Core rejects overlong fields rather than
silently truncating them.

### Versioned success

```ts
type ProductPopupMutationData = ProductPopupResourceData & {
  replayed: boolean;
};
```

On a non-replayed set, `resource_revision` is exactly old + 1, `popup.revision` matches it, and a
fresh `pop_id` is minted. The durable mutation also creates exactly one deduplicated member-data
change intent keyed by the request ID; replay creates no second intent.

## Clear action: `admin_clear_user_popup`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uid` | yes | positive canonical UID |
| `expected_revision` | yes | exact observed resource revision |
| `request_id` | yes | caller-minted UUID v4 |
| `audit_reason` | yes | internal operator reason, 1..500 |

### Versioned success

The response is `ProductPopupMutationData` with `popup=null`, revision exactly old + 1, and
`replayed=false` for the first completion. Clearing an already-clear resource with a new request is
`product-popup-already-clear` with the current `ProductPopupResourceData` in `data`; replaying the
original successful clear returns the original success with `replayed=true`.

Core creates exactly one deduplicated member-data change intent after a successful first clear.
Hard deletion of the active popup row is allowed internally only if the revision/tombstone,
idempotency receipt, and notification intent remain authoritative.

## Concurrency, idempotency, and uncertain responses

1. Set/clear **MUST** condition on UID plus `expected_revision`; exactly one winning mutation
   increments the resource revision.
2. A stale expected revision returns `product-popup-conflict` and the current canonical
   `ProductPopupResourceData` in `data`; no content is merged and no mutation/notification occurs.
3. Core binds `request_id` to actor, action, UID, expected revision, audit reason, and normalized
   material payload. Receipt lookup/fingerprint comparison precedes state and revision checks.
   Same UUID + same material returns the original result with `replayed=true`; same UUID + different
   material returns `product-popup-request-id-conflict`.
4. A matching in-flight request returns `product-popup-request-in-progress`; retry uses the same
   identity. Receipts survive at least seven days and **SHOULD** survive 30 days.
5. Webadmin persists the request ID, UID, expected revision, action, and normalized draft in
   `sessionStorage` before mutation. Timeout/network/5xx/in-progress retains it. It clears only after
   parsed replay/convergence or a terminal validation/conflict response.
6. Core **MUST NOT** create a second popup, pop_id, notification intent, audit intent, or revision
   increment for a replay. First completion makes the state, receipt, audit evidence, and one
   deduplicated notification intent durable before success; downstream delivery may retry that same
   intent.

## Audit and sensitive-copy policy

Core **MUST** durably record an audit intent before changing the popup resource or commit audit and
resource atomically. Audit insertion failure returns `product-popup-audit-write-failed` and leaves
the resource untouched.

The durable audit contains actor email/role, action, UID, old/new revision, request ID, repeat mode,
expiry, button action, and hashes/lengths of operator reason and member-visible copy. It **MUST NOT**
copy the title, message, button URL, provider/device identifiers, or member contact data into the
general audit row. The canonical popup resource keeps the copy needed for delivery. A completion
outcome **SHOULD** be appended/recorded after the mutation.

## Closed error vocabulary

| Error | Status | Meaning / client behavior |
|---|---:|---|
| `product-popup-contract-version-invalid` | 400 | terminal |
| `product-popup-parameter-invalid` | 400 | unknown/duplicate/structured or incompatible fields |
| `product-popup-uid-invalid` | 422 | terminal |
| `product-popup-user-not-found` | 404 | terminal |
| `product-popup-title-invalid` | 422 | terminal |
| `product-popup-message-invalid` | 422 | terminal |
| `product-popup-repeat-mode-invalid` | 422 | terminal |
| `product-popup-expiry-invalid` | 422 | terminal |
| `product-popup-button-invalid` | 422 | terminal |
| `product-popup-button-url-invalid` | 422 | terminal |
| `product-popup-audit-reason-invalid` | 422 | terminal |
| `product-popup-revision-invalid` | 422 | terminal |
| `product-popup-request-id-invalid` | 422 | terminal |
| `product-popup-already-clear` | 409 | terminal; adopt current null resource |
| `product-popup-conflict` | 409 | terminal for gesture; adopt returned resource |
| `product-popup-request-id-conflict` | 409 | terminal; do not mint a retry for the gesture |
| `product-popup-request-in-progress` | 409 | retryable with same identity |
| `product-popup-read-required` | 403 | no read capability |
| `product-popup-write-required` | 403 | no write capability |
| `product-popup-audit-write-failed` | 503 | retry same identity; no resource mutation |
| `product-popup-stored-invalid` | 503 | fail whole read/mutation; never render partial data |
| `product-popup-read-failed` | 503 | retryable read failure |
| `product-popup-write-failed` | 503 | uncertain; retain identity and read authoritative state |
| `admin-revoked` | 403 | session/access invalidation path |
| `admin-session-invalid` | 403 | session/access invalidation path |
| `admin-write-required` | 403 | authenticated read-only operator attempted mutation |

Unknown error strings map to generic localized refusal copy. Only known session/revocation errors
invalidate the browser session.

## Pre-version compatibility

- `admin_get_user_popup` without a version keeps `popup: {...}|null` and the existing field names.
- `admin_set_user_popup` without a version keeps the existing title/message/forced/has-button field
  vocabulary and `pop_id` success. Core maps `forced` to `until_expiry`, otherwise `once`.
- A pre-version set that has no expiry **MUST** receive a server-authored seven-day expiry; no caller
  may create an indefinite forced popup after T-108. Member-facing projection suppresses it after
  expiry even if an older app only understands `forced`.
- `admin_clear_user_popup` without a version keeps its current success shape.
- Compatibility never bypasses active-admin/editor checks or the durable audit-before-mutation
  requirement. Pre-version operations may use a Core-minted internal request identity, but must
  still use atomic revision/state writes so one request cannot corrupt the resource.
- Existing member/client popup fields remain byte-compatible (`pop_id`, title/message, active,
  forced, button fields). New admin-only revision, expiry, receipt, and audit metadata **MUST NOT**
  leak into that member payload unless separately contracted.
- The compatibility projection maps `repeat_mode=until_expiry` to `forced=true` and `once` to
  `forced=false`; `active` is true only before expiry. `button.action=none` maps to
  `has_button=false` plus empty legacy button fields, while `url`/`rate` map to `has_button=true`
  with their canonical title/action and URL rules.

## Acceptance tests

Core T-108 **MUST** cover:

1. never-authored, active, expired, and explicitly cleared reads with exact closed projections;
2. valid once/until-expiry set, URL/rate/no-button variants, clear, and exact revision increments;
3. all scalar/boundary/Unicode/URL/expiry cross-field validation and rejection without truncation;
4. missing user versus existing user/no-popup distinction;
5. viewer read, viewer write refusal, admin/owner write, revoked actor, and actor overwrite;
6. two writers at one revision, stale clear/set, ABA prevention across clear, and no client-side
   merge;
7. identical replay, conflicting request ID (including actor mismatch), in-progress response,
   lost-response convergence, one pop_id, and one deduplicated member-data notification intent;
8. audit failure before mutation, safe audit negative fields, storage failure after intent, and
   authoritative retry;
9. stored malformed row fails the whole read rather than becoming null/default content;
10. pre-version response fixtures, forced-to-expiring compatibility, role-guard census, and
    disposable-storage revision/receipt tests.

Webadmin T-206 **MUST** cover strict parsers, guest 401, foreign-origin 403, Core-authored read/write
capabilities, URL and expiry validation, exact preview, conflict adoption, durable retry identity,
clear semantics, EN/HU parity, and the user-detail Help section.

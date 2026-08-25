# Canned-template Webadmin contract proposal

Status: **PROPOSAL** for T-208. Provider implementation is T-108; CRUD consumer implementation is
T-207(a) after acceptance.

Provider: Friending Core. Consumer: Friending Webadmin. This document is normative where it uses
**MUST**, **MUST NOT**, **SHOULD**, or **SHOULD NOT**.

## Scope

This contract hardens the existing reusable-template actions:

- `list_canned` — list/search one channel's templates;
- `save_canned` — create or update one template;
- `delete_canned` — remove one template from future use.

The channel vocabulary remains `email`, `sms`, and `push`. This contract deliberately excludes
`send_message`, `user_history`, recipient selection/preview, delivery providers, campaigns, and
delivery receipts. Those remain blocked on the T-107 dual-provider contract and T-207(b).

## Transport and version negotiation

1. Requests remain `POST application/x-www-form-urlencoded` to the existing
   `/v1/webadmin/<action>` routes.
2. The browser never calls Core. The same-origin Next.js proxy authenticates/rechecks the operator,
   attaches the server-only secret, and overwrites caller-supplied administrator identity.
3. The strict consumer sends `contract_version=1`; success echoes `data.contract_version=1`.
4. Omitting the version preserves the existing successful shapes: list `data[]`, save `canned`, and
   empty delete success. Core still applies active-admin, audit, and safe-write hardening.
5. The legacy envelope remains authoritative: HTTP can be 200 for a logical refusal; consumers
   evaluate numeric `status_code` and typed body.
6. Versioned success is exactly `success=true`, `status_code=200`, and the defined `data`. Refusal is
   `success=false`, numeric `status_code`, a closed `error`, and only optional conflict `data`.
7. The request tables list consumer-owned fields. Core also receives exactly one reserved `secret`
   and `admin_email` from the authenticated server; neither is accepted from browser-controlled
   input. Every other unknown field and every duplicate, array-valued, non-scalar, or loosely typed
   versioned field is rejected. Core does not truncate, coerce booleans, or accept partial objects.
8. Version-1 material uses closed key sets and no-store responses. Additive material requires a new
   contract version because the Webadmin parser fails closed on unknown keys.

## Common primitives

- `template_id`: lowercase Mongo-compatible 24-hex identifier matching `^[0-9a-f]{24}$`. Existing
  valid ids remain stable.
- `revision`: integer in `1..2147483647`; existing templates are backfilled to revision 1.
- `request_id`: canonical lowercase UUID v4 matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  Mutation request IDs are unique within this contract family. Core looks up the receipt and
  compares its full fingerprint before revision/state validation; actor email is part of the
  fingerprint, so a different actor gets a request-ID conflict rather than another actor's replay.
- `cursor`: opaque base64url string of 1–256 characters.
- Timestamps are non-negative Unix seconds as JSON integers.
- Plain-text bounds count Unicode scalar values after trim and NFC normalization.

## Capability model

Every versioned list response includes:

```ts
type CannedTemplatePrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: Array<"canned_templates_read" | "canned_templates_write">;
};
```

The array is unique and lexicographically sorted. Current mapping: viewer = read; admin/owner =
read + write. Core owns the mapping; Webadmin **MUST NOT** infer it from role.

- `list_canned` requires `canned_templates_read`.
- `save_canned` and `delete_canned` require `canned_templates_write` and recheck it at mutation.
- Core **SHOULD** also expose this block in `admin_me` for non-optimistic navigation/control gating.

## Canonical template

```ts
type CannedTemplate = {
  template_id: string;
  channel: "email" | "sms" | "push";
  revision: number;
  name: string; // 1..120 internal operator label
  format: "sanitized_html" | "plain_text";
  subject: string;
  body: string;
  created_at: number;
  created_by: string; // normalized administrator email, 3..320
  updated_at: number;
  updated_by: string; // normalized administrator email, 3..320
};
```

Channel rules are exact:

| Channel | Format | Subject | Body |
|---|---|---|---|
| `email` | `sanitized_html` | required, 1..200 plain-text scalars | required, sanitized result 1..50,000 scalars |
| `sms` | `plain_text` | exactly empty | required, 1..1,600 scalars |
| `push` | `plain_text` | required title, 1..80 scalars | required, 1..1,000 scalars |

Core **MUST** reject overlong push titles instead of applying the current silent clamp. SMS/push
bodies reject NUL and disallowed C0 controls other than newline/tab. The console **SHOULD** warn at
160 SMS characters and around 40 push-title characters, but those are cost/display guidance rather
than storage limits.

Email sanitization is a Core boundary, not a browser claim. The sanitized canonical output may
contain only `p`, `br`, `h1`, `h2`, `h3`, `strong`, `em`, `u`, `ul`, `ol`, `li`, `blockquote`, and
`a`. Only `href` and `title` are retained on links; href is absolute HTTPS or `mailto`, credentials
and control characters are forbidden, and rendering adds safe external-link behavior. Core rejects
malformed markup, forbidden URL schemes, event attributes, and active/embedded content including
scripts, styles, forms, iframes, objects, embeds, SVG, MathML, and images. It removes comments,
unwraps unsupported inert formatting elements while preserving their text, and drops attributes
other than the allowed link attributes. It then serializes one deterministic normalized fragment
and rechecks the non-empty and length bounds. Core returns and stores only that canonical body;
Webadmin previews only the returned/stored body in a sandboxed or otherwise non-executable
renderer.

The canonical projection **MUST NOT** include delivery-provider credentials, recipient data,
campaign state, send history, private evidence, or raw sanitizer diagnostics.

## List action: `list_canned`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `type` | yes | `email`, `sms`, or `push` (kept for route compatibility) |
| `query` | no | case-insensitive name query, 0..80; empty means all |
| `page_size` | no | integer `1..100`; default `50` |
| `cursor` | no | opaque cursor; empty means first page |

Rows sort by `(updated_at desc, template_id asc)`. Cursor identity binds to `type`, normalized
query, and page size; reuse with different inputs is `canned-template-cursor-invalid`.

### Versioned success

```ts
type CannedTemplateListData = {
  contract_version: 1;
  principal: CannedTemplatePrincipal;
  channel: "email" | "sms" | "push";
  query: string;
  templates: CannedTemplate[]; // 0..page_size, unique template_id
  next_cursor: string | null;
  total: number; // exact non-negative count for channel + query
};
```

Every row channel equals the requested channel. A proven empty result requires a fully valid
success, `templates=[]`, `next_cursor=null`, and `total=0`. A malformed stored row fails the entire
read with `canned-template-stored-invalid`; Core and Webadmin never skip it or display a false empty
state.

## Save action: `save_canned`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `id` | yes | empty for create; exact `template_id` for update (legacy field name retained) |
| `type` | yes | `email`, `sms`, or `push` |
| `expected_revision` | yes | `0` for create; exact positive observed revision for update |
| `request_id` | yes | caller-minted UUID v4 |
| `audit_reason` | yes | internal operator reason, 1..500 |
| `name` | yes | trimmed internal name, 1..120 |
| `subject` | yes | channel-specific value, including exact empty SMS subject |
| `body` | yes | channel-specific value |

Create requires `id=""` and `expected_revision=0`; Core generates the id and stores revision 1.
Update requires a valid id and revision at least 1. A template's channel is immutable after create;
moving content between channels is an explicit create followed by separately confirmed delete.

### Versioned success

```ts
type CannedTemplateSaveData = {
  contract_version: 1;
  template: CannedTemplate; // sanitized canonical content
  replayed: boolean;
};
```

A first update increments revision exactly once. Create returns revision 1. Webadmin replaces its
draft with the canonical returned row; it never assumes the browser HTML or whitespace survived
sanitization unchanged.

## Delete action: `delete_canned`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `id` | yes | exact template id |
| `expected_revision` | yes | exact observed positive revision |
| `request_id` | yes | caller-minted UUID v4 |
| `audit_reason` | yes | internal operator reason, 1..500 |

### Versioned success

```ts
type CannedTemplateDeleteData = {
  contract_version: 1;
  deleted: {
    template_id: string;
    channel: "email" | "sms" | "push";
    revision: number; // old revision + 1 tombstone revision
    deleted_at: number;
  };
  replayed: boolean;
};

type CannedTemplateConflictData =
  | { contract_version: 1; template: CannedTemplate; deleted: null }
  | {
      contract_version: 1;
      template: null;
      deleted: {
        template_id: string;
        channel: "email" | "sms" | "push";
        revision: number;
        deleted_at: number;
      };
    };
```

Delete removes the template from lists and future pickers but does not alter historical messages.
Core **SHOULD** retain a tombstone so revision and replay identity survive deletion and the same id
cannot be recreated. No versioned restore action is in scope.

## Concurrency, idempotency, and uncertain responses

1. Updates/deletes condition on template id + expected revision. Create reserves its generated id
   and request receipt once. Exactly one winning mutation advances revision.
2. A stale revision or update/delete of a tombstone returns `canned-template-conflict` with exactly
   `CannedTemplateConflictData` in `data`.
3. Core binds request ID to actor, action, template target/create intent, expected revision, audit
   reason, channel, and normalized content hash. Receipt lookup/fingerprint comparison precedes
   state and revision checks. Same identity/material returns the original success with
   `replayed=true`; different material returns `canned-template-request-id-conflict`.
4. A matching in-flight request returns `canned-template-request-in-progress`. The caller retains
   and retries the same identity. Receipts survive at least seven days and **SHOULD** survive 30.
5. Webadmin persists request ID, action, expected revision, id/channel, and normalized draft before
   mutation. Network/timeout/5xx/in-progress retains it; parsed convergence or terminal
   validation/conflict clears it.
6. A replay **MUST NOT** create a second row, increment revision twice, sanitize/send content twice,
   or duplicate audit intent. No route in this contract sends a member message.

## Audit and content policy

Core **MUST** durably record an audit intent before changing template storage or atomically commit
audit plus state. Audit failure returns `canned-template-audit-write-failed` and leaves storage
untouched.

Audit includes actor email/role, action, template id (or create request id), channel, old/new
revision, request id, name, content lengths/hashes, and audit-reason length/hash. The general audit
row **MUST NOT** copy the email HTML, SMS/push body, subject, links, recipients, provider data, or
future delivery receipts. A completion outcome **SHOULD** be appended or separately recorded.

## Closed error vocabulary

| Error | Status | Meaning / client behavior |
|---|---:|---|
| `canned-template-contract-version-invalid` | 400 | terminal |
| `canned-template-parameter-invalid` | 400 | unknown/duplicate/structured or incompatible fields |
| `canned-template-channel-invalid` | 422 | terminal |
| `canned-template-id-invalid` | 422 | terminal |
| `canned-template-name-invalid` | 422 | terminal |
| `canned-template-subject-invalid` | 422 | terminal |
| `canned-template-body-invalid` | 422 | terminal |
| `canned-template-html-invalid` | 422 | terminal sanitizer refusal |
| `canned-template-audit-reason-invalid` | 422 | terminal |
| `canned-template-revision-invalid` | 422 | terminal |
| `canned-template-request-id-invalid` | 422 | terminal |
| `canned-template-cursor-invalid` | 422 | terminal; restart first page |
| `canned-template-not-found` | 404 | terminal; authoritative list refresh |
| `canned-template-conflict` | 409 | terminal for gesture; adopt returned row/tombstone |
| `canned-template-channel-conflict` | 409 | immutable-channel refusal |
| `canned-template-request-id-conflict` | 409 | terminal; never mint a retry for the gesture |
| `canned-template-request-in-progress` | 409 | retryable with same identity |
| `canned-template-read-required` | 403 | no read capability |
| `canned-template-write-required` | 403 | no write capability |
| `canned-template-audit-write-failed` | 503 | retry same identity; no mutation |
| `canned-template-stored-invalid` | 503 | fail whole read/mutation; never skip row |
| `canned-template-read-failed` | 503 | retryable read failure |
| `canned-template-write-failed` | 503 | uncertain; retain identity and read authoritative list |
| `admin-revoked` | 403 | session/access invalidation path |
| `admin-session-invalid` | 403 | session/access invalidation path |
| `admin-write-required` | 403 | authenticated read-only operator attempted mutation |

Unknown errors map to generic localized refusal copy; only known session/revocation failures
invalidate the browser session.

## Pre-version compatibility

- Unversioned `list_canned` keeps `data[]` rows with `id`, `type`, `name`, `subject`, `body`,
  `created_at`, and `updated_at`.
- Unversioned `save_canned` keeps optional `id`, the existing type/name/subject/body fields, and
  top-level `canned` success. Existing push-title clamping may remain only on this compatibility
  branch; the strict branch rejects overlong data.
- Unversioned `delete_canned` keeps its empty success body.
- Existing ids and visible content remain stable through revision backfill and HTML sanitization.
  If existing email HTML cannot pass the accepted sanitizer, migration **MUST** stop/report it rather
  than silently delete or blank the template.
- Compatibility never permits inactive/read-only administrators to mutate and never permits a state
  change without durable pre-mutation audit evidence. Core may mint an internal request identity for
  a pre-version call, but storage writes remain atomic and bounded.
- No client/app route changes are part of this contract.

## Acceptance tests

Core T-108 **MUST** cover:

1. exact list success/empty/search/pagination/order for all three channels;
2. create/update/delete, revision backfill/increment, immutable channel, tombstone, and historical
   message non-mutation;
3. exact per-channel subject/body/format bounds, Unicode/control characters, no truncation, and
   deterministic email sanitizer allow/deny fixtures;
4. malformed, extra, duplicate, structured, partial, and stored-invalid input/rows;
5. viewer read, viewer write refusal, admin/owner write, revoked actor, and server-owned actor email;
6. two writers on one revision, create replay, update/delete conflict, and deleted-resource conflict;
7. identical replay, request-id payload conflict, in-progress response, lost response, and receipt
   retention with exactly one logical mutation;
8. audit failure before write, safe audit negative fields, storage failure after intent, and retry;
9. pre-version response fixtures and migration refusal for unsanitizable existing content;
10. role-guard census plus disposable-storage tests for revisions, tombstones, receipts, and indexes.

Webadmin T-207(a) **MUST** cover fail-closed parsers, guest 401, foreign-origin 403, Core-authored
capabilities, channel bounds, safe canonical preview, conflict adoption, durable retry identity,
delete confirmation, EN/HU parity, route-specific Help, and zero references to send/history actions.

## Lead amendment A-ENV (2026-08-26T02:35Z) — envelope key set

Core's shared `Webadmin::reply()` always appends the legacy trio. A versioned success body therefore has exactly
`{success, status_code, data, message, status, can_send}`. A versioned refusal has exactly
`{success, status_code, error, message, status, can_send}`, plus `data` only for the contracted conflict response.
The legacy trio remains transport metadata; Core does not remove it and consumers keep this top-level key set closed.

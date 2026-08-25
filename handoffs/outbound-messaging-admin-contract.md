# Outbound-messaging Webadmin contract proposal

Status: **PROPOSAL** for T-213. Provider implementation is T-108(d); consumer implementation is
T-207(b) after acceptance and provider release.

Provider: Friending Core. Consumer: Friending Webadmin. This document is normative where it uses
**MUST**, **MUST NOT**, **SHOULD**, or **SHOULD NOT**.

## Scope

This contract adds a strict, audited successor to the existing administrative message surface:

- `outbound_message_preview` — preview an explicit recipient set and its email/SMS/push
  availability;
- `send_message` with `contract_version=1` — send one bounded message to that explicit set;
- `user_history` with `contract_version=1` — read bounded delivery-history rows for one member;
- `user_history_detail` with `contract_version=1` — read the full canonical content for one exact
  history row.

The strict sender accepts only an explicit canonical list of 1..100 unique UIDs. A one-member
composer submits a one-item list. It never accepts a query, saved segment, geography, density,
cohort, event, membership group, campaign, or arbitrary selector. Restoring such a selector would
require a separate reviewed contract; it cannot be added to version 1.

The channel vocabulary is exactly `email`, `sms`, and `push`. Canned-template CRUD remains governed
by `canned-templates-admin-contract.md`. This contract permits reuse of one exact template revision
but does not grant template-edit authority.

The following are out of scope: scheduled campaigns, recurring sends, attachments, arbitrary
push/deep-link actions, the legacy `push_kind`, provider credentials or identifiers, contact-value
lookup, member-to-member chat, support-thread replies, curated events, and bulk recipient discovery.

## Evidence and fixed decisions

The predecessor `send_message` accepts an explicit UID list, performs per-UID email/SMS/push work,
returns partial results, and applies legacy ceilings. The predecessor `user_history` returns the
last 100 rows but leaks raw destinations and loosely typed provider errors. Version 1 preserves the
useful explicit-recipient primitive while replacing those unsafe projections and uncertain retry
semantics.

The lead fixed these T-213 values on 2026-08-26:

- at most 100 unique UIDs per request;
- a per-actor rolling ceiling of 500 dispatched recipients across all channels per 300 seconds;
- within that same window, a combined SMS+push ceiling of 200 dispatched recipients;
- one safe result per requested UID;
- no contact value or provider identifier in preview, send, history, audit, or logs;
- email and SMS use Core-owned outbox workers; push uses the D-015 outbox and snapshots the current
  `push_delivery_mode` when its worker first claims the row.

These are ceilings, not product claims that delivery is guaranteed.

## Transport, trust, and version negotiation

1. Requests remain `POST application/x-www-form-urlencoded` under `/v1/webadmin/<action>`.
2. The browser calls only the authenticated same-origin Next.js proxy. The proxy rechecks active
   membership, rejects foreign origins for mutation, injects the server-only secret, and overwrites
   caller-supplied administrator identity.
3. Strict requests send `contract_version=1`; every strict success echoes
   `data.contract_version=1`.
4. Existing unversioned `send_message` and `user_history` response shapes remain available only for
   compatibility. The new preview and detail actions have no unversioned branch.
5. The legacy response envelope remains authoritative: HTTP may be 200 for a logical refusal, so
   consumers evaluate numeric `status_code` and the typed body.
6. A strict success has exactly `{success, status_code, data, message, status, can_send}`. A strict
   refusal has exactly `{success, status_code, error, message, status, can_send}`, plus `data` only
   for the recipient-conflict projection defined below. The legacy trio is exactly
   `message=200`, `status=200`, and `can_send=0` on success.
7. The request tables list browser-owned fields. Core additionally receives exactly one reserved
   `secret` and `admin_email` from the authenticated server. Neither is accepted from browser
   input. Unknown, duplicate, array-valued, structured, non-scalar, partially typed, or incompatible
   versioned fields are rejected; Core does not truncate or loosely coerce them.
8. Strict responses are `Cache-Control: no-store`. Every nested version-1 object has a closed key
   set. Additive material requires a new contract version because Webadmin fails closed on unknown
   keys.

## Common primitives

- `uid`: canonical positive base-10 integer in `1..2147483647`.
- `uids`: a comma-separated string of 1..100 UIDs in strictly increasing numeric order, without
  whitespace, leading zeroes, empty elements, or duplicates. Example: `17,204,991`.
- `request_id`: caller-minted canonical lowercase UUID v4 matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
- `preview_id`: Core-minted canonical lowercase UUID v4. It is opaque to Webadmin and expires 300
  seconds after `evaluated_at`.
- `message_id` and `template_id`: lowercase 24-hex identifiers.
- `content_sha256`: lowercase 64-hex SHA-256 of the UTF-8 bytes of
  `format + NUL + subject + NUL + canonical body`.
- `revision`: integer in `1..2147483647`; the create-only send precondition is exact integer `0`.
- `cursor`: opaque base64url string matching `^[A-Za-z0-9_=-]{1,256}$`; padding is permitted.
- Timestamps are non-negative Unix seconds represented as JSON integers.
- Plain-text bounds count Unicode scalar values after trim and NFC normalization.
- Arrays described as sorted are unique and lexicographically or numerically sorted as stated.

## Capability and readiness model

Strict preview and history successes include:

```ts
type OutboundMessagingPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: Array<
    | "outbound_messages_history_read"
    | "outbound_messages_send"
  >;
};
```

The capability array is unique and lexicographically sorted. Current mapping: viewer receives
history read; admin/owner receive history read + send. Core owns the mapping and rechecks it for
every action. Webadmin **MUST NOT** infer capability from role.

- `outbound_message_preview` and versioned `send_message` require
  `outbound_messages_send`.
- Versioned `user_history` and `user_history_detail` require
  `outbound_messages_history_read`.
- Template selection additionally requires `canned_templates_read` from the separate canned
  principal. Template create/update/delete requires `canned_templates_write`; outbound send never
  implies it.

Core **MUST** expose an `admin_me.outbound_messaging` block containing exact
`{contract_version:1, contract_ready:boolean, capabilities:[...]}`. Webadmin keeps its compile-time
readiness false and all four actions out of the proxy allow-list until T-108(d) is deployed,
`contract_ready=true` is reviewed, and the cutover is explicitly accepted.

## Recipient availability policy

```ts
type OutboundChannelAvailability =
  | "available"
  | "channel_absent"
  | "opted_out"
  | "banned"
  | "not_migrated";

type OutboundRecipientPreview = {
  uid: number;
  display_name: string; // trimmed plain text, 0..120
  codename: string;     // lowercase canonical codename or empty, 0..64
  channels: {
    email: OutboundChannelAvailability;
    sms: OutboundChannelAvailability;
    push: OutboundChannelAvailability;
  };
};
```

Core evaluates each channel through one typed policy with this precedence:

1. `not_migrated`: the requested identity has no explicit reviewed Friending member mapping;
2. `banned`: the current member is banned, deleted, or otherwise prohibited from administrative
   dispatch;
3. `opted_out`: the authoritative channel preference forbids this administrative delivery;
4. `channel_absent`: the member is eligible but has no usable verified email, verified/owned phone,
   or enabled push registration;
5. `available`: the channel is eligible and currently resolvable.

For push, availability is aggregate under D-015: Core uses the current valid delivery mode and the
provider-aware registry, including legacy OneSignal state only through the explicit T-007 identity
mapping. It never uses same-number UID equality. The projection does not reveal whether FCM,
OneSignal, or both supplied availability.

Mere presence of an email, phone, token, or legacy row is not opt-in evidence. Missing, malformed,
or unreadable policy/storage is a whole-preview failure, not a guessed availability state. A
contact or provider resolver failure must never appear as `channel_absent`.

No response contains an email address, phone number, token, OneSignal identifier, partial/hash of
one, device identifier, provider response identifier, exact provider error, or credential state.

## Recipient preview: `outbound_message_preview`

### Request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uids` | yes | canonical explicit UID list, 1..100 entries |

### Success

```ts
type OutboundRateBucket = {
  limit: number;
  used: number;
  remaining: number;
};

type OutboundRecipientPreviewData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  preview_id: string;
  evaluated_at: number;
  expires_at: number; // evaluated_at + 300
  requested_count: number;
  recipients: OutboundRecipientPreview[];
  limits: {
    max_recipients_per_request: 100;
    window_seconds: 300;
    overall: OutboundRateBucket; // limit exactly 500
    sms_push: OutboundRateBucket; // limit exactly 200
  };
};
```

Recipients are in ascending UID order, exactly match the request, and contain no duplicate. Each
bucket satisfies `used + remaining = limit`, with non-negative safe integers. Counts are the
current normalized actor's rolling dispatch reservations as of `evaluated_at`; skipped recipients
do not consume them.

Core binds the preview to actor + exact UID list and retains or signs that binding through
`expires_at`. A preview is advisory: send rechecks membership, capabilities, availability, and
rate limits. A preview never reserves capacity, creates delivery rows, calls a provider, or proves
future deliverability.

If one stored member projection is malformed or a dependency read fails, the whole action fails.
Webadmin never drops that row or turns the response into an empty/partially available state.

## Canonical message content and template reuse

The strict sender supports two exact sources:

- `custom`: `template_id=""`, `template_revision=0`; Core validates and canonicalizes the supplied
  subject/body;
- `template`: valid `template_id` + exact observed positive `template_revision`, with
  `subject=""` and `body=""`; Core loads and sends that exact current canonical template revision.

The browser cannot label modified content as the original template. To edit a selected template
for one send, the console switches explicitly to `custom` and clears the template reference.

Channel content rules match the accepted canned-template contract:

| Channel | Format | Subject | Body |
|---|---|---|---|
| `email` | `sanitized_html` | required, 1..200 plain-text scalars | required, canonical sanitized result 1..50,000 scalars |
| `sms` | `plain_text` | exactly empty | required, 1..1,600 scalars |
| `push` | `plain_text` | required title, 1..80 scalars | required, 1..1,000 scalars |

Custom email uses the same deterministic Core sanitizer and allow-list as canned templates. Custom
SMS/push rejects NUL and disallowed C0 controls other than newline/tab. No branch truncates content.
There is no variable interpolation, recipient token, attachment, arbitrary URL/deep link, or
member-field substitution in version 1.

## Send action: versioned `send_message`

### Request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `preview_id` | yes | unexpired Core preview bound to this actor + exact UID list |
| `uids` | yes | same canonical list used by the preview |
| `type` | yes | `email`, `sms`, or `push` (legacy field name retained) |
| `content_source` | yes | `custom` or `template` |
| `template_id` | yes | empty for custom; valid id for template |
| `template_revision` | yes | `0` for custom; exact positive revision for template |
| `subject` | yes | channel/source-specific value, including exact empty where required |
| `body` | yes | channel/source-specific value, including exact empty for template |
| `allow_partial` | yes | exact `0` or `1` |
| `expected_revision` | yes | exact `0`; this is a create-only command |
| `request_id` | yes | caller-minted UUID v4 |
| `audit_reason` | yes | internal operator reason, trimmed NFC plain text, 1..500 |

The authenticated server owns `admin_email`. Supplying it, a query/filter/segment, `push_kind`,
provider choice, destination, scheduling field, attachment, or any other extra material is a
parameter refusal.

### Revalidation and partial behavior

Core re-evaluates all requested UIDs before dispatch:

- with `allow_partial=0`, any recipient whose selected channel is no longer `available` returns
  `outbound-message-recipient-conflict` and the fresh safe preview data; nothing is reserved,
  queued, or sent;
- with `allow_partial=1`, unavailable recipients become immutable `skipped` results using the exact
  availability reason, while available recipients continue;
- an all-skipped allowed-partial command is a valid audited completion with zero provider work;
- storage/read failures remain whole-command failures and never become per-recipient skips.

After availability is known, Core atomically checks and reserves the actor's rolling capacity.
Every recipient planned for dispatch consumes one overall reservation; SMS or push also consumes
one combined SMS+push reservation. If the full planned set would exceed either bucket, Core returns
`outbound-message-rate-limited`; no subset is selected and no recipient is dispatched. Concurrent
requests cannot exceed either ceiling. A replay never reserves again. Final provider failure does
not refund an attempted dispatch.

### Outbox and result semantics

The T-108 mutation service uses family `outbound-message`, expected revision `0`, and the complete
normalized material fingerprint. Its durable audit intent exists before any per-recipient delivery
row or provider-visible work.

Core creates one idempotent domain/delivery row per requested UID. A unique request+UID boundary
lets recovery converge after a partial storage failure without creating a second email, SMS, or
logical push. Email and SMS dispatch through their Core-owned outbox workers. Push dispatches
through the D-015 outbox, where the worker snapshots delivery mode and provider outcomes remain
independent.

```ts
type OutboundSkippedReason =
  | "channel_absent"
  | "opted_out"
  | "banned"
  | "not_migrated";

type OutboundFailureReason =
  | "provider_unavailable"
  | "provider_rejected"
  | "delivery_expired"
  | "delivery_failed";

type OutboundRecipientResult =
  | { uid: number; message_id: string; outcome: "sent"; reason: null }
  | { uid: number; message_id: string; outcome: "queued"; reason: null }
  | { uid: number; message_id: null; outcome: "skipped"; reason: OutboundSkippedReason }
  | { uid: number; message_id: string; outcome: "failed"; reason: OutboundFailureReason };

type OutboundMessageSendData = {
  contract_version: 1;
  request_id: string;
  preview_id: string;
  channel: "email" | "sms" | "push";
  requested_count: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  results: OutboundRecipientResult[];
  replayed: boolean;
};
```

Results are in ascending UID order and exactly cover the request. The four counts are non-negative
and sum to `requested_count`; each equals the corresponding result count. `sent` means the
applicable outbox already observed a provider-accepted terminal aggregate before the response.
`queued` means durable acceptance for later work, not provider delivery. `failed` is a terminal,
closed outcome already observed; raw provider detail is never projected. Push acceptance by one
provider and failure by another is represented as sent in this initial snapshot and later as
`partially_sent` in history, without exposing an identifier.

The send response is the immutable receipt-completion snapshot. Delivery can advance afterward;
versioned history is the authoritative current projection. A replay returns the original snapshot
with `replayed=true` and never dispatches again.

## Delivery history: versioned `user_history`

### Request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uid` | yes | canonical positive UID |
| `page_size` | no | integer `1..50`; default `25` |
| `cursor` | no | opaque cursor; empty means first page |

Rows sort by `(created_at desc, message_id asc)`. Cursor identity binds to UID and page size; reuse
with different material is `outbound-message-cursor-invalid`.

### Safe history row

```ts
type OutboundHistoryStatus =
  | "queued"
  | "sending"
  | "retrying"
  | "sent"
  | "partially_sent"
  | "failed"
  | "skipped"
  | "suppressed";

type OutboundHistoryReason = OutboundSkippedReason | OutboundFailureReason;

type OutboundHistoryEntry = {
  message_id: string;
  request_id: string;
  uid: number;
  channel: "email" | "sms" | "push";
  format: "sanitized_html" | "plain_text";
  subject: string;       // immutable canonical subject, 0..200
  body_excerpt: string;  // deterministic visible plain text, 0..500
  content_sha256: string;
  template: null | {
    template_id: string;
    revision: number;
  };
  status: OutboundHistoryStatus;
  status_reason: OutboundHistoryReason | null;
  push_mode: "fcm" | "onesignal" | "both" | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  sent_by: string;
};

type OutboundMessageHistoryData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  uid: number;
  evaluated_at: number;
  messages: OutboundHistoryEntry[];
  next_cursor: string | null;
  total: number;
};
```

The list row is intentionally bounded. `subject` is the immutable canonical subject actually
admitted for that member, not the current canned-template row. `body_excerpt` is derived from the
canonical body by extracting visible text for sanitized email HTML, decoding entities, applying
NFC, trimming, collapsing Unicode whitespace to one ASCII space, and taking the first 500 Unicode
scalars without an appended ellipsis. SMS subject is empty. `content_sha256` binds the exact full
canonical content available from the detail read.

`push_mode` is non-null only for push and records the D-015 first-claim mode snapshot; it is
configuration metadata, not a provider identifier.

`partially_sent` means at least one mode-enabled push provider accepted and another terminally
failed. The row deliberately does not reveal which provider, provider IDs, device/token counts,
addresses, phone numbers, provider HTTP status/body, credentials, retry payloads, or raw errors.
`status_reason` is null for queued/sending/retrying/sent/partially_sent and present only for a
matching skipped/suppressed/failed state.

Every row has the requested UID. IDs are unique. Timestamps satisfy
`created_at <= updated_at <= completed_at` when completed time is non-null. A proven empty history
requires a fully valid success with `messages=[]`, `next_cursor=null`, and `total=0`. One malformed
stored row fails the whole read with `outbound-message-stored-invalid`; Core and Webadmin never skip
it or display a false empty state.

## Full history content: `user_history_detail`

### Request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `uid` | yes | canonical positive UID |
| `message_id` | yes | exact history-row id belonging to that UID |

### Success

```ts
type OutboundHistoryDetailEntry = Omit<OutboundHistoryEntry, "body_excerpt"> & {
  body: string; // complete canonical sanitized HTML or plain text
};

type OutboundMessageHistoryDetailData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  evaluated_at: number;
  message: OutboundHistoryDetailEntry;
};
```

The detail entry has the same closed delivery metadata as a current list row, replaces only
`body_excerpt` with the complete canonical `body`, and preserves the same `content_sha256` rule.
The body obeys the original per-channel bound. Webadmin rechecks the hash and renders email HTML
only in a non-executable sandbox; SMS/push remain text. A row that exists for a different UID is
`outbound-message-not-found`, not a cross-member lookup. Malformed content or a hash mismatch fails
closed with `outbound-message-stored-invalid`.

The response still excludes destination values, provider identifiers/outcomes, device counts,
provider HTTP material, credentials, raw errors, and every field forbidden from history rows.

## Idempotency and uncertain responses

1. Core binds request ID to actor, action, exact UID list, preview identity, channel, partial choice,
   expected revision, template reference or normalized canonical content, and audit reason.
   Receipt lookup/fingerprint comparison precedes domain execution.
2. The released T-108 shared primitive provides one durable 30-day receipt claim and one durable
   pre-domain audit intent. An identical completion replays; changed material yields
   `outbound-message-request-id-conflict`; a live execution yields
   `outbound-message-request-in-progress`.
3. Per-recipient command/outbox identity derives from the logical request + UID. Domain recovery
   recognizes already-created rows, completes missing rows, and never creates a second logical send.
4. Webadmin mints and stores the request ID, preview ID, exact UID list, channel, content source,
   template revision or full normalized custom content, partial choice, expected revision, and audit
   reason in `sessionStorage` before mutation. If durable session storage is unavailable, send is
   disabled.
5. Network/timeout, malformed response, 5xx, and in-progress results retain the exact pending
   material. Parsed success or a terminal validation/conflict result clears it. A timeout never
   authorizes a new request ID or a second send.
6. An expired preview or rate-limit refusal ends that operator gesture: after the required wait or
   re-preview, Webadmin mints a new request ID. It does not silently change material under an old
   identity.
7. The receipt guarantees at-most-once logical command admission, not exactly-once external
   delivery. Provider APIs can retain an at-least-once crash window. Webadmin labels queued/unknown
   state honestly and reads history instead of manufacturing another logical send.

## Audit, privacy, and retention boundaries

Core **MUST** durably record the T-108 audit intent before capacity reservation, outbox insertion,
or provider-visible work. Audit failure returns `outbound-message-audit-write-failed` and leaves
rate state and every delivery outbox untouched.

The audit intent contains actor email/role, action, request ID, recipient count and deterministic
UID-list hash, channel, template id/revision or custom marker, content format plus subject/body
lengths and hashes, partial choice, rate-limit snapshot, and audit-reason length/hash. It references
the immutable domain command for exact target reconstruction.

The general audit row **MUST NOT** copy subject/body, audit-reason text, UID list, email/phone,
provider token/id, provider response, credential, HTTP body/status, device information, or deep
link. Completion annotation contains only the closed response status and aggregate counts. Provider
and transport logs follow the same negative list.

The immutable message domain row may retain canonical content and requested UID because strict
history needs it. Version 1 does not invent or change a retention duration: Core keeps the existing
administrative-message retention/erasure authority, and T-108(d) documents and tests its exact
behavior before release. Erasure removes contact/provider material and makes later delivery
impossible without rewriting the Core-owned audit fact. Storage tests must prove account deletion
cannot leave a claimable outbox for that member.

## Closed error vocabulary

| Error | Status | Meaning / client behavior |
|---|---:|---|
| `outbound-message-contract-version-invalid` | 400 | terminal |
| `outbound-message-parameter-invalid` | 400 | unknown, duplicate, structured, or incompatible fields |
| `outbound-message-uids-invalid` | 422 | malformed, unsorted, duplicate, empty, or invalid UID list |
| `outbound-message-recipient-limit` | 422 | more than 100 explicit UIDs |
| `outbound-message-preview-id-invalid` | 422 | malformed preview identity |
| `outbound-message-preview-expired` | 409 | terminal for gesture; obtain a new preview + request ID |
| `outbound-message-preview-conflict` | 409 | preview actor/UID binding mismatch |
| `outbound-message-recipient-conflict` | 409 | availability changed and partial send was not accepted; fresh preview in `data` |
| `outbound-message-channel-invalid` | 422 | terminal |
| `outbound-message-content-source-invalid` | 422 | terminal |
| `outbound-message-template-id-invalid` | 422 | terminal |
| `outbound-message-template-revision-invalid` | 422 | terminal |
| `outbound-message-template-not-found` | 404 | terminal; reload template list |
| `outbound-message-template-conflict` | 409 | template revision changed/deleted; reload template list |
| `outbound-message-subject-invalid` | 422 | terminal |
| `outbound-message-body-invalid` | 422 | terminal |
| `outbound-message-html-invalid` | 422 | terminal sanitizer refusal |
| `outbound-message-partial-invalid` | 422 | `allow_partial` is not exact `0`/`1` |
| `outbound-message-audit-reason-invalid` | 422 | terminal |
| `outbound-message-revision-invalid` | 422 | expected revision is not exact `0` |
| `outbound-message-request-id-invalid` | 422 | terminal |
| `outbound-message-rate-limited` | 429 | no dispatch; wait/re-preview and create a new gesture |
| `outbound-message-request-id-conflict` | 409 | terminal; never mint a retry for this gesture |
| `outbound-message-request-in-progress` | 409 | retryable with the exact same identity/material |
| `outbound-message-cursor-invalid` | 422 | terminal history cursor; restart first page |
| `outbound-message-message-id-invalid` | 422 | malformed detail-row identity |
| `outbound-message-not-found` | 404 | no history row for the requested UID + message id |
| `outbound-message-send-required` | 403 | no preview/send capability |
| `outbound-message-history-read-required` | 403 | no history capability |
| `outbound-message-audit-write-failed` | 503 | retry same identity; no reservation/dispatch occurred |
| `outbound-message-receipt-write-failed` | 503 | uncertain; retain exact identity/material |
| `outbound-message-recipient-read-failed` | 503 | preview/send recheck failed; do not infer absence |
| `outbound-message-stored-invalid` | 503 | history/send state malformed; fail whole operation |
| `outbound-message-read-failed` | 503 | retryable read failure |
| `outbound-message-write-failed` | 503 | uncertain; retain identity and read authoritative history |
| `admin-revoked` | 403 | session/access invalidation path |
| `admin-session-invalid` | 403 | session/access invalidation path |
| `admin-write-required` | 403 | authenticated read-only operator attempted send |

`outbound-message-recipient-conflict` carries exactly
`{contract_version:1, preview:OutboundRecipientPreviewData}` in `data`; the nested preview's
principal remains current. No other refusal carries `data`. Unknown errors remain failures and map
to generic localized copy. Only known session/revocation failures invalidate the Webadmin session.

## Pre-version compatibility

- Unversioned `send_message` keeps the predecessor request fields and top-level
  `{type,sent,failed,results}` success material needed by the PHP admin. It still requires an active
  editor, uses Core-owned outboxes, applies safe ceilings, and records durable audit evidence before
  dispatch. Core may mint its internal request identity for this compatibility branch.
- Unversioned `user_history` keeps the predecessor `data[]` row shape for compatibility. The strict
  browser never calls that branch and never receives its legacy raw `recipient` field.
- `user_history_detail` has no unversioned branch and can read only a strict canonical history row.
- Existing `admin_messages_log` rows are migrated or projected into strict history only if every
  required field can be canonicalized without inventing a provider outcome. Raw destination and
  provider values remain excluded. An incompatible row stops/reports the guarded migration rather
  than being silently dropped.
- The strict preview/send/history/detail actions are not allow-listed in Webadmin and no composer ships
  until T-108(d)'s contract, fixtures, migration, capabilities, and readiness are deployed and
  accepted.
- No member client route, notification payload, D-015 provider mode, template CRUD route, or
  support-thread route changes under this compatibility promise.

## Webadmin Help outline

T-207(b) extends `/users/[uid]` Help with separate sections and bilingual copy for:

1. **Channel availability** — explain the five safe states and that no contact/token value is shown;
2. **Recipient preview** — verify the exact named member(s), selected channel, 100-recipient request
   cap, and current rolling capacity before composing;
3. **Template or custom content** — select one exact canonical template revision, or detach to a
   custom bounded draft; explain email sandboxing and SMS/push guidance;
4. **Confirmation and audit** — require an internal reason, show the exact recipient count, and make
   the partial-send choice explicit;
5. **Result and recovery** — distinguish sent, queued, skipped, failed, timeout, replay, and
   in-progress; never advise creating a second request after uncertainty;
6. **Delivery history** — explain current status, bounded immutable content snapshot, exact-content
   detail read, actor/time, template provenance, hash verification, and why `partially_sent` does
   not reveal provider identifiers;
7. **Permissions and privacy** — distinguish send, history read, template read, and template edit;
   state that addresses, phones, tokens, credentials, and raw provider errors are unavailable.

The main UI shows product-language guidance, not route names, status codes, request fingerprints,
or provider diagnostics. Every visible string is present in both locale files with identical key
trees.

## Acceptance tests

Core T-108(d) **MUST** cover:

1. exact preview success for one and 100 UIDs, ascending canonical order, every availability state,
   exact cap arithmetic, preview expiry, and actor/UID binding;
2. rejection of zero/101 recipients, duplicates, unsorted/zero-padded UIDs, arrays, selector/query/
   event/geography fields, unknown keys, and malformed/partial input;
3. email/SMS/push availability from verified contact, opt-out, banned, explicit migration, D-015
   mode/provider registry, and T-007 no-UID-equality behavior, including resolver-failure refusal;
4. custom content bounds and sanitizer fixtures plus exact-template revision reuse, stale/deleted
   template conflict, immutable template provenance, and no variable/deep-link support;
5. all-available, allow-partial skip, deny-partial conflict, all-skipped completion, one safe result
   per UID, exact aggregate counts, and no contact/provider identifier in any JSON/log/audit row;
6. atomic concurrent overall 500/300-second and combined SMS+push 200/300-second ceilings,
   100-recipient request cap, replay without re-reservation, and zero arbitrary subset on refusal;
7. viewer history, viewer preview/send refusal, admin/owner send, revoked actor, server-owned actor
   identity, and separate canned-template read/write capabilities;
8. audit-intent failure before reservation/outbox/provider work, safe audit negative fields,
   per-recipient idempotent outbox creation, mid-batch storage failure, retry convergence, and
   account-erasure suppression;
9. identical replay, changed-material request-id conflict, in-progress response, lost response,
   receipt-completion failure, and one logical dispatch per UID;
10. history pagination/order/empty/current-status transitions, bounded deterministic excerpts,
    content hashes, exact detail ownership/full-content response, sanitized email sandbox material,
    D-015 partially-sent aggregate, malformed stored row refusal, and provider/contact negative
    projection tests;
11. unversioned request/response compatibility fixtures, guarded migration refusal/idempotence, role
    guard census, machine-error census, route construction, and disposable-storage suites.

Webadmin T-207(b) **MUST** cover strict success/refusal parsers, request normalizers and body limits,
guest 401, foreign-origin 403, active-admin recheck, Core-authored capability gates, one-item user
composer plus bounded explicit-list helpers, preview expiry/change, template/custom invariants,
sessionStorage-unavailable refusal, exact durable retry identity, partial results, history pagination,
bounded list snapshots, exact detail/hash checks and safe email sandbox, EN/HU parity, route-specific
Help, and exhaustive proof that no contact or provider identifier enters browser state, logs,
fixtures, screenshots, or commits.

## Lead acceptance requested

The lead has already fixed explicit-list scope and all three numeric ceilings. Please accept or
amend these remaining material choices before T-108(d) implementation:

1. add one new `outbound_message_preview` route while versioning the existing `send_message` and
   `user_history` routes;
2. template mode sends the exact server-stored revision; modified content becomes explicit custom
   content with no template attribution;
3. `allow_partial=0|1` controls availability changes, while rate-limit failure always dispatches no
   subset;
4. strict history includes canonical sent content, aggregate `partially_sent`, and push mode, but no
   provider-specific outcome or identifier.

## Lead acceptance + amendment A1 (2026-08-26T09:50Z)
All four requested choices are ACCEPTED (new `outbound_message_preview`; versioned branches of `send_message`/`user_history`;
exact template revision vs explicit custom content; `allow_partial=0|1` with rate-limit failures dispatching no subset; strict
history with aggregate `partially_sent` and push mode, no provider outcome/identifier). Amendment A1: a history ROW carries
only a bounded content snapshot (subject ≤ 200 scalars, body excerpt ≤ 500 scalars, `content_sha256`); the full canonical
body is returned by a separate `user_history_detail` read (same capability, one row by id) — keeps list reads bounded.

# Reported-content Webadmin contract proposal

Status: **PROPOSAL** for T-208. Provider implementation is T-108; consumer implementation is
T-205 after acceptance.

Provider: Friending Core. Consumer: Friending Webadmin. This document is normative where it uses
**MUST**, **MUST NOT**, **SHOULD**, or **SHOULD NOT**.

## Scope

This contract hardens the existing Webadmin actions:

- `moderation_reported_list` — queue, history, and exact-report read;
- `moderation_report_action` — confirm or reject one pending report.

It covers reports whose target is a user/profile or a chat message. It does not cover profile-photo
moderation, profile-verification evidence, Dates cases, Footprint reports, automatic account bans,
content deletion, or outbound notifications beyond the existing report-decision side effect.
A decision records whether the report is valid; any user restriction or content removal remains a
separate explicit audited operation.

## Transport and version negotiation

1. Requests **MUST** remain `POST` requests with an
   `application/x-www-form-urlencoded` body to `/v1/webadmin/<action>`.
2. The browser **MUST NOT** call Core. The Next.js same-origin proxy authenticates the operator,
   rechecks active membership, overwrites any caller-supplied admin identity, and attaches the
   server-only Webadmin secret.
3. The strict consumer **MUST** send `contract_version=1`. Core **MUST** return
   `data.contract_version=1` on a successful versioned response.
4. A caller that omits `contract_version` keeps the pre-version request/response shape. Core **MAY**
   add validation and audit safety to that path, but **MUST NOT** remove or rename its existing
   successful fields. The versioned Webadmin parser will not accept the pre-version shape.
5. Responses keep the legacy envelope. HTTP may be 200 for a logical refusal; the numeric
   `status_code` and body are authoritative.
6. A versioned success has exactly `success=true`, `status_code=200`, and the `data` object defined
   below. A versioned refusal has `success=false`, a numeric `status_code`, a closed `error` string,
   and only the optional conflict `data` described below.
7. The request tables list consumer-owned fields. Core also receives exactly one reserved `secret`
   and `admin_email` from the authenticated server; neither is accepted from browser-controlled
   input. Core **MUST** reject every other unknown field and every duplicate, array-valued,
   non-scalar, or loosely typed versioned field. Booleans, when added later, are exactly `0` or `1`;
   integers are canonical base-10 ASCII.
8. Responses **MUST** be no-store. Successful material objects use closed key sets. A compatible
   additive change therefore requires `contract_version=2`; the version-1 consumer fails closed on
   unknown, missing, duplicate, or wrongly typed material.

## Common primitives

- `request_id`: canonical lowercase UUID v4, matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  Mutation request IDs are unique within this contract family. Core looks up the receipt and
  compares its full fingerprint before evaluating current report state; actor email is part of the
  fingerprint, so a different actor gets a request-ID conflict rather than another actor's replay.
- `report_id`: 1–128 ASCII characters, matching
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Existing valid identifiers **MUST** remain stable.
- `revision`: integer in `1..2147483647`. Existing pending rows are backfilled to revision 1.
- `uid`: integer in `1..2147483647`.
- Timestamps: non-negative Unix seconds as JSON integers.
- Human text bounds count Unicode scalar values after trimming and NFC normalization.
- `cursor`: opaque base64url string of 1–256 characters. Consumers store/echo it and never parse it.

## Capability model

The versioned read response **MUST** include this Core-authored principal:

```ts
type ReportedContentPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: Array<
    "reported_content_read" | "reported_content_decide"
  >;
};
```

The array is unique and lexicographically sorted. The current role mapping is viewer = read;
admin/owner = read + decide. Core remains authoritative and may later grant a narrower role without
changing the capability names. Webadmin **MUST NOT** reconstruct capabilities from `role`.

- `moderation_reported_list` **MUST** require `reported_content_read`.
- `moderation_report_action` **MUST** require `reported_content_decide`.
- The mutation **MUST** recheck the capability even if the page previously rendered a button.
- Core **SHOULD** project the same capability block from `admin_me` so navigation can be hidden
  without an optimistic browser rule.

## Safe row projection

The versioned report object is exactly:

```ts
type ReportedIdentity = {
  uid: number;
  display_name: string; // 0..100
  username: string;     // 0..80, no leading @ requirement
};

type ReportedSubjectContent =
  | {
      kind: "profile";
      summary: string; // 0..500 plain text
    }
  | {
      kind: "chat_message";
      message_id: string | null; // stable-id grammar; null for an unavailable legacy target
      availability: "available" | "removed" | "unavailable";
      text: string; // 0..2000 plain text; empty unless availability=available
      sent_at: number | null;
      has_restricted_evidence: boolean;
    };

type ReportResolution = null | {
  decision: "confirmed" | "rejected";
  reason: string; // 1..500 internal operator reason
  decided_at: number;
  decided_by: string; // normalized active administrator email, 3..320
};

type ReportedContentReport = {
  report_id: string;
  status: "pending" | "confirmed" | "rejected";
  revision: number;
  target_type: "user" | "chat";
  reporter: ReportedIdentity;
  subject: ReportedIdentity;
  subject_content: ReportedSubjectContent;
  reason_code: string; // 1..64, ^[a-z0-9][a-z0-9._-]{0,63}$
  reason_text: string; // 0..500 member-supplied plain text
  created_at: number;
  resolution: ReportResolution;
};
```

Cross-field rules are mandatory:

- `target_type=user` requires `subject_content.kind=profile`;
- `target_type=chat` requires `subject_content.kind=chat_message`;
- `status=pending` requires `resolution=null`;
- a resolved status requires a non-null resolution whose `decision` equals the status;
- `text` is empty when chat availability is `removed` or `unavailable`;
- chat availability `available` requires a non-null `message_id` and non-null `sent_at`; null
  identity/time values are reserved for unavailable pre-version targets whose stable metadata was
  never stored;
- all user display strings are plain text, not HTML.

The projection **MUST NOT** contain phone/email, social/provider identifiers, birthday, exact
coordinates, relationship state, IP data, moderator session data, raw storage paths, private media
URLs, or unrestricted user/chat documents. Restricted attachments/evidence require a separate
future no-store, capability-gated bridge and are represented here only by
`has_restricted_evidence`.

If a stored row cannot be projected completely, the whole read fails with
`reported-content-stored-invalid`; Core and Webadmin **MUST NOT** silently skip it or manufacture an
empty queue.

## Read action: `moderation_reported_list`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `status` | no | `pending`, `confirmed`, `rejected`, or `all`; default `pending` |
| `target_type` | no | `user`, `chat`, or `all`; default `all` |
| `page_size` | no | integer `1..100`; default `50` |
| `cursor` | no | opaque cursor; empty means first page |
| `report_id` | no | exact stable id for a detail read |

When `report_id` is present, `status`, `target_type`, and `cursor` **MUST** be absent and
`page_size`, if present, **MUST** equal 1. This lets `/moderation/reports/[reportId]` reload directly
without adding an unassigned third Core action.

Pending pages are ordered oldest-first by `(created_at, report_id)`. Resolved/all pages are ordered
newest-first by `(created_at, report_id)`. A cursor binds to the normalized filter and page size;
reusing it with different filters is `reported-content-cursor-invalid`.

### Versioned success

```ts
type ReportedContentListData = {
  contract_version: 1;
  principal: ReportedContentPrincipal;
  filter: {
    status: "pending" | "confirmed" | "rejected" | "all";
    target_type: "user" | "chat" | "all";
    report_id: string | null;
  };
  reports: ReportedContentReport[]; // 0..page_size, unique report_id
  next_cursor: string | null;
  total: number; // exact non-negative count for the normalized filter
};
```

An empty queue is proven only by `success=true`, a valid data object, `reports=[]`,
`next_cursor=null`, and `total=0`. An exact `report_id` read returns zero or one row,
`next_cursor=null`, and `total` equal to 0 or 1.

## Decision action: `moderation_report_action`

### Versioned request

| Field | Required | Contract |
|---|---:|---|
| `contract_version` | yes | exact string `1` |
| `report_id` | yes | stable report id |
| `action` | yes | `confirmed` or `rejected` |
| `reason` | yes | trimmed internal operator reason, 1..500 |
| `expected_revision` | yes | exact currently observed revision |
| `request_id` | yes | caller-minted UUID v4 |

The authenticated server owns administrator identity. `admin_email`, if supplied by a hostile
browser body, is ignored/overwritten and never used as authorization evidence.

### Versioned success

```ts
type ReportedContentActionData = {
  contract_version: 1;
  report: ReportedContentReport; // resolved state, revision exactly old+1
  replayed: boolean;
};

type ReportedContentConflictData = {
  contract_version: 1;
  report: ReportedContentReport;
};
```

The action transitions only `pending -> confirmed|rejected`. It **MUST NOT** automatically ban,
suspend, delete content, expose evidence, or apply a second notification/side effect. The returned
row is the authoritative convergence result.

## Concurrency, idempotency, and uncertain responses

1. The storage mutation **MUST** condition on both `report_id` and `expected_revision`, and on the
   stored state being `pending`. Exactly one successful decision increments revision by one.
2. A stale revision, already-resolved report, or conflicting state returns
   `reported-content-conflict` with exactly `ReportedContentConflictData` in `data`; it never
   applies the requested decision.
3. Core **MUST** bind `request_id` to the normalized material request (actor, action, target,
   revision, decision, and reason). Receipt lookup/fingerprint comparison precedes state and
   revision checks, so the original completion replays even though the report is now resolved.
4. Repeating the same request after a lost response returns the original authoritative success with
   `replayed=true` and does not duplicate state change, notification, receipt, or audit intent.
5. Reusing the request ID with different material returns
   `reported-content-request-id-conflict`. A matching request still executing returns
   `reported-content-request-in-progress`; the caller retains and retries the same identity.
6. Idempotency receipts **MUST** survive at least seven days and **SHOULD** survive 30 days.
7. Webadmin persists a pending mutation's `request_id`, `report_id`, and `expected_revision` in
   `sessionStorage` until it observes convergence or a terminal input/conflict response. Network,
   timeout, 5xx, and in-progress responses retain the identity.

## Audit ordering

Core **MUST** durably record a Core-owned audit intent before report state or user-visible side
effects change, or commit the audit and state change atomically. Failure to create that durable row
returns `reported-content-audit-write-failed` and leaves the report untouched.

The audit intent includes actor email/role, action, report id, expected revision, decision,
request id, timestamp, and bounded reason length/hash. It **MUST NOT** copy chat text, report detail,
private evidence, direct storage locations, phone/email, or exact location. A completion outcome
**SHOULD** be attached or recorded after success. Even if that completion annotation fails, the
pre-mutation durable intent remains sufficient to prove who authorized the change.

## Closed error vocabulary

| Error | Status | Meaning / client behavior |
|---|---:|---|
| `reported-content-contract-version-invalid` | 400 | terminal; no request retained |
| `reported-content-parameter-invalid` | 400 | unknown/duplicate/structured or incompatible fields |
| `reported-content-filter-invalid` | 422 | terminal list filter refusal |
| `reported-content-cursor-invalid` | 422 | terminal; restart from first page |
| `reported-content-report-id-invalid` | 422 | terminal |
| `reported-content-decision-invalid` | 422 | terminal |
| `reported-content-reason-invalid` | 422 | terminal |
| `reported-content-revision-invalid` | 422 | terminal |
| `reported-content-request-id-invalid` | 422 | terminal |
| `reported-content-not-found` | 404 | terminal; authoritative reload |
| `reported-content-conflict` | 409 | terminal for this gesture; adopt returned current row |
| `reported-content-request-id-conflict` | 409 | terminal; never mint a retry for the same gesture |
| `reported-content-request-in-progress` | 409 | retryable with the same identity |
| `reported-content-read-required` | 403 | no read capability |
| `reported-content-decision-required` | 403 | no decision capability |
| `reported-content-audit-write-failed` | 503 | retryable with same identity; no mutation occurred |
| `reported-content-stored-invalid` | 503 | read/mutation refused; do not render partial data |
| `reported-content-read-failed` | 503 | retryable read failure |
| `reported-content-write-failed` | 503 | uncertain; retain identity and read authoritative state |
| `admin-revoked` | 403 | session/access invalidation path |
| `admin-session-invalid` | 403 | session/access invalidation path |
| `admin-write-required` | 403 | authenticated read-only operator attempted mutation |

Unknown errors remain failures and map to generic localized copy. Only the known session/revocation
errors send the browser to login.

## Compatibility requirements

- A request without `contract_version` **MUST** continue to expose the existing list fields used by
  the predecessor PHP admin (`data[]` rows with `id`, `type`, `reported`, `sender`, `reason`,
  `message`, and `created`) and the existing action success envelope.
- Compatibility does not permit mutation without an active administrator, editor authority, a
  durable pre-mutation audit intent, or an atomic pending-state transition.
- Existing client/app moderation routes remain unchanged. T-108 should put canonical projection,
  revisioning, receipts, and mutation policy in typed Support/Service code shared only where the
  semantics are actually identical.
- The strict Webadmin action is not allow-listed in `lib/adminActions.ts` and no UI ships until the
  provider contract and fixtures are deployed and accepted.

## Acceptance tests

Core T-108 **MUST** cover:

1. exact success, proven-empty, exact-detail, pagination, stable ordering, and closed filters;
2. malformed, partial, extra-key, duplicate, loosely typed, and stored-invalid responses/inputs;
3. active viewer read, viewer mutation refusal, admin/owner mutation, revoked admin, and missing
   actor identity;
4. safe projection negative tests for contacts, coordinates, IPs, full user documents, raw storage,
   and private evidence;
5. reason/action/id/revision/request-id bounds and Unicode edge cases;
6. two concurrent decisions at the same revision: exactly one state change, one side effect, and one
   winning completion;
7. identical replay, payload-conflicting replay, in-progress replay, and lost-response recovery;
8. audit insertion failure before mutation, domain write failure after audit intent, and durable
   audit evidence without copied report/chat evidence;
9. pre-version request/response compatibility fixtures;
10. role-guard census plus disposable-storage tests for revision backfill, conditional update,
    receipt uniqueness, and retry convergence.

Webadmin T-205 **MUST** cover strict parsers, guest 401, foreign-origin 403, read/write capability
gates, every closed refusal path, durable retry identity, EN/HU key parity, route-specific Help, and
the distinction between an empty queue and a failed/malformed read.

## Lead amendments (accepted, binding for T-108a / T-205)
- A1 (2026-08-25T17:58Z): an exact-detail read (`report_id` present) echoes `filter.status="all"`,
  `filter.target_type="all"`, and `filter.report_id=<the id>`; the returned row's own `status` is authoritative.
  Core MUST NOT echo the list default `pending` on a detail read.

## Lead amendment A-ENV (2026-08-26T02:35Z) — envelope key set

Core's shared `Webadmin::reply()` always appends the legacy trio. A versioned success body therefore has exactly
`{success, status_code, data, message, status, can_send}`. A versioned refusal has exactly
`{success, status_code, error, message, status, can_send}`, plus `data` only for the contracted conflict response.
The legacy trio remains transport metadata; Core does not remove it and consumers keep this top-level key set closed.

## Lead amendment A3 (2026-08-26T05:25Z) — reason excerpt and legacy client decisions

- `reason_text` in the versioned projection is Core's deterministic excerpt `contract_reason_text` (NFC, trimmed, ≤ 500 scalars)
  of the member-supplied message; the original stored `message` (legacy client contract, up to 3000 bytes) is preserved
  byte-for-byte and never projected. The row gains `reason_truncated: boolean` (true when the excerpt shortened the original).
  Existing rows are backfilled additively by the guarded migration; an over-long original never fails the queue read.
- The legacy client route `/v1/moderation/set_report_action` keeps its exact request/response/error vocabulary but performs the
  same conditional `pending → confirmed|rejected` transition (revision +1, `decided_by` = the authenticated moderator's
  normalized email, canonical `decision`, event side effect only for the winning transition). It carries no request id and
  uses no Webadmin receipt; a Webadmin decision and a client decision on the same report race on the revision, exactly one wins.

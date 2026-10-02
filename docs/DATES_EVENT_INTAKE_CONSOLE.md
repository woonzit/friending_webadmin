# AI-assisted event intake console — P2a (T-865 / T-885)

The console for "Draft from source" / "Vázlat forrásból": an administrator gives
Core a link, a flyer photo or a line of text; Core's intake worker has an AI
draft an event sheet and validates it deterministically; a reviewer compares
the draft with the source and either rejects it or publishes its events through
the existing P1 external-event editor and publisher. **The AI never publishes**,
and nothing of an intake is ever shown to members.

This document describes the Webadmin side only. Core is the authority for every
rule; the provider is the Core lane's contract `dates-event-intake-admin-v1`.

## Release boundary

- Provider: Core branch `claude/t865-p2-core` (T-884), tip
  `285b14a87c2e9977130d4b8a0bae19cb8bbb18b9`. Core is released first.
- Everything is inert while `dates_external_admin_drafts_enabled` is false, which
  is Core's default: no intake can be created or published, nothing is stored and
  the worker has nothing to do. Deploying this console enables nothing.
- Publishing a draft also needs the P1 switch `dates_external_publishing_enabled`.
- The two configuration bodies of the P1 corpus carry 41 settings from this Core
  on. A console without this change still reads them (unknown rows fall into the
  number field of the P1 page), which is why this console ships with Core.

## Routes

| Console | Core route | Capability mirrored |
|---|---|---|
| `POST /api/admin/dates-intake-create` (multipart) | `dates_event_intake_create` | `dates_external_event_manage` |
| `GET /api/admin/dates-intake-media` | `dates_event_intake_image` | `dates_external_event_review` |
| generic action `dates_event_intake_list` | same | review |
| generic action `dates_event_intake_detail` | same | review |
| generic action `dates_event_intake_lease` | same | review |
| generic action `dates_event_intake_reject` | same | review |
| generic action `dates_event_intake_publish` | same | manage |
| generic action `dates_event_intake_usage` | same | `dates_external_event_read` |

Creating an intake and reading a flyer are not generic actions: they are not in
the allow-list and cannot be reached through `/api/admin/[action]`. The mirror
only decides what the console offers and forwards; Core checks again, and every
refusal is shown with the token Core answered.

### Transport

The console reaches Core through `lib/core.ts` only. A number travels as its
decimal string, a boolean as `1` / `0`, an object as one JSON string, and a flyer
as a multipart part named `image_1` or `image_2`. Core's corpus is captured over
exactly this encoding (the manifest's `transport` provenance), after the lane's
first corpus turned out to have been dispatched with PHP ints and booleans that
no form body can carry. The console does not send `origin`.

### Flyers

A flyer is private evidence.

- Upload: `image_1` and optionally `image_2`, each at most 10 MiB, recognised as
  JPEG, PNG, WEBP or HEIC from its first bytes exactly as Core does. The bytes
  are forwarded unchanged (Core re-encodes them and drops the metadata) and are
  stored nowhere on the console. The general `upload-image` route is not used.
- Read: only Core's re-encoded JPEG, through `dates-intake-media`, to this
  console's own image element (`isTrustedAdminMediaRead`), for a reviewer, with
  `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `nosniff`,
  a sandboxing CSP and `Cross-Origin-Resource-Policy: same-origin`. No ETag, no
  range, no public URL. Core audits every read, so the page fetches a flyer only
  when the reviewer asks for it.
- A flyer is never rendered as, or offered as, the event image. The editor still
  uses category art only.

## Decoder rules

- Closed about shape (key sets) and about the vocabularies Core publishes in the
  corpus manifest; `tests/datesIntakeWire.test.mts` compares the console's lists
  with the manifest.
- Never stricter than Core on a value Core can store: free text is a string,
  a number is a number, and identifiers the contract does not declare closed
  (attendance mode, status signal, prohibited category, task, dropped-link field,
  the usage ledger's provider, model, task and channel) stay open and are shown
  as Core wrote them when the console has no translation.
- A list degrades per row. In the queue an unreadable display field marks the
  row; an unusable revision or hold removes its actions; a row whose identity,
  status or key set cannot be trusted is reported by position. On the review
  screen events, AI calls, source texts, flyers and whole sections degrade one
  by one and are named, never shown as empty.
- A value Core recomputes (counts, unions, derived booleans, clocks) never fails
  a page.
- Receipts of create, lease, reject, publish and the flyer read are strictly
  closed and bound to their request.

## Review, hold and publication

- The hold (Core's five-minute review lease) is taken explicitly, renewed every
  two minutes while the review screen is open, and released explicitly. Every
  lease action moves the intake's revision; commands and renewals are serialised
  so that a command always carries the newest revision. A superadmin may release
  another reviewer's hold (Core's rule); nobody can take over an unexpired one.
- Rejection: one of Core's nine reasons plus the audit note Core requires. The
  statement of reasons is Core's template for the reason, not free text.
- Publication: "Open in editor" prefills the P1 form (`DatesExternalEventForm`)
  from Core's `editor_input` for that event. A field Core does not know stays
  empty and the four confirmations are never ticked. The command is
  `dates_event_intake_publish` and runs through the P1 journal
  (`lib/datesExternalMutations.ts`): fresh access first, the exact command saved
  before it leaves, the same identity on a retry, and only a pinned Core refusal
  releases it. Core records the intake on the event's ledger, which is what makes
  the event `ai_assisted`.
- A multi-event intake is published one event at a time; `complete` says that an
  event is the last one the reviewer takes from it.

## The published event

From Core `3d4a0b40` on, the Admin projection of an external event says where
it came from:

- every row of `dates_external_event_list` ends with `ai_assisted` (boolean);
  the list shows the AI-assisted badge for a true row;
- the detail, and the `external_event` the activity detail embeds, end with
  `intake`: null for a manual event, otherwise exactly
  `{intake_id, channel, event_index}`. The provenance panel links back to
  `/dates/intakes/<intake_id>` and names the channel and which of the intake's
  events it was. Core derives the label and the reference from the same ledger
  record, so the decoder refuses one without the other.

Both keys are closed like the rest of the projection. A console without this
change refuses the new list and detail bodies (closed key sets), so this console
ships with that Core.

## What Core does not serve yet

- `sources` still has one row of kind `admin` for an event published from an
  intake. The console's decoder already accepts up to twenty rows and the six
  kinds.

## Evidence boundaries

Tests run the production decoders, console calls, server-route logic and page
callbacks against the 113 genuine Core bodies, and render the review panels
statically in EN and HU. Rows built from a genuine body for a branch no genuine
body carries are labelled DERIVED in the tests. Nothing here is a mounted
browser, an authenticated session or a live Core call.

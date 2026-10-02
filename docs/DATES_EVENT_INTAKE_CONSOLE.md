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

- Provider: Core branch `claude/t865-p2-core` (T-884, T-886), tip
  `32d418cff7a68217d9358959c297a469139586f0`. Core is released first, and this
  console needs that Core or a later one: it requires the `existing` marker on
  the create receipt and `suggestions_enabled` on the queue, which an earlier
  Core does not serve (a create would then read as "not known" and the queue as
  unreadable).
- Everything is inert while `dates_external_admin_drafts_enabled` is false, which
  is Core's default: no intake can be created or published, nothing is stored and
  the worker has nothing to do. Deploying this console enables nothing.
- Publishing a draft also needs the P1 switch `dates_external_publishing_enabled`.
- The two configuration bodies of the P1 corpus carry 50 settings from this Core
  on (the 33 of P1, the eight of the admin channel, the nine of the member
  channel). A console without this change still reads them (unknown rows fall into the
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
- Unknown is not empty. When a whole list (`events`, `ai_runs`, `source_texts`)
  cannot be read the projection holds `null` for it, not `[]`, and the page says
  that the section could not be read; the empty-state wording ("the AI produced
  no event", "no AI call") is used only for a list Core served empty. An
  unreadable result or decision is "could not be read", not "no answer yet".
  While events are unreadable the reject section says that the reviewer decides
  without having seen them.
- A value Core recomputes (counts, unions, derived booleans, clocks) never fails
  a page.
- Receipts of create, lease, reject, publish and the flyer read are strictly
  closed and bound to their request.

## Review, hold and publication

- The hold (Core's five-minute review lease) is taken explicitly, renewed every
  two minutes while the review screen is open, and released explicitly. Every
  lease action moves the intake's revision. One queue orders everything that
  reads or moves that revision: the first read, the worker poll, Refresh, the
  renewal and every command, so a slow read can neither overtake a renewal nor
  be overtaken by one. The revision the page holds only moves forward: a
  receipt raises it, and a read whose body is older than what the page holds is
  not adopted but issued once more. A superadmin may release
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
  event is the last one the reviewer takes from it. The console implies it only
  when it can see that nothing else is left and nothing is unknown
  (`datesIntakeCompletion`). With other readable events the reviewer may tick
  "this is the last one". With an event the console could not read - or whose
  editor prefill it could not read - the intake is never closed implicitly: the
  reviewer chooses between publishing and leaving the intake open (the default)
  and closing it knowing how many events were not read, and that choice is what
  is sent and what the confirmation repeats.
- Addresses that came with an intake (the submitted link, the page Core fetched,
  the three validation links) are untrusted. `DatesIntakeUrl` renders all of
  them: only a plain `https:` address without credentials is a link; `http:` and
  every other scheme is shown as text with a note.

## Command outcomes

Every intake command (create, hold, reject, publish) is settled by exactly two
things: a receipt bound to its request, or one of Core's pinned no-land
refusals in Core's own envelope. The list is closed and is the publication
journal's own (`refusalCodes` behind `datesExternalRefusal` in
`lib/datesExternalAdmin.ts`); it names only tokens Core raises inside the
command's transaction (after the receipt lookup, where the command has an
identity) or from a check of the request itself.

Everything else is **not known**, and is worded so: no answer, an unreadable
one, the bridge's `core-timeout`, `core-unavailable` and `invalid-core-response`,
any refusal of the bridge itself, a 5xx, `dates-admin-command-in-progress`,
`dates-admin-idempotency-conflict`, a capability refusal (it precedes the
receipt lookup) and any token outside the list. The notice shows the token
that was answered, when one was.

- **Create** ("Draft from source"). A create has no revision to fence it, and
  a browser cannot be where "exactly once" is guaranteed: it has several
  tabs, a clock its user sets and storage that is neither atomic nor
  trustworthy. **That a source cannot become two open drafts is Core's
  guarantee**: Core answers an identical resubmission by the same operator,
  while an open draft of the same source exists, with that draft - the
  ordinary create receipt with `existing: true` and the draft's id, revision
  and status as they are now (Core's proof:
  `tests/dates_event_intake_resubmission_storage_test.php`). The console keeps
  no state for it and does only what is safe and useful:
  - the create receipt is bound, not closed: `success`, the intake's id,
    revision and status, the audit id and the two markers `replayed` and
    `existing` are required and checked, any other key is tolerated. A new
    draft is revision 1 and `received`; an existing one is open. A body
    without the marker, or one that calls an ended draft "existing", is not a
    receipt: the outcome is not known;
  - a receipt takes the operator to that intake's review screen
    (`datesIntakeLanding`). When it carried `existing: true` the screen says,
    once, that the source had already been submitted and that this is its
    draft as it is now - information, not a success message for a new
    submission and not an error. That is remembered in memory for exactly
    that intake: it is never read from the address, and a reload or a later
    create forgets it;
  - while the panel is open, `createDatesIntakeSourceAttempts`
    (`lib/datesIntakeConsole.ts`) keeps the key across every outcome that is
    not known, so sending the same source again is the same request. Core's
    receipt or definitive refusal ends it; so does an edit of the source,
    which is another request. Nothing is locked. Two refusals Core raises
    before the receipt lookup from state that can change between attempts
    (`dates-intake-admin-drafts-disabled`, and `dates-intake-image-invalid`,
    which also covers a flyer that arrived incomplete) settle a first attempt
    only; on a retry they are not known;
  - after an unknown outcome a reminder is kept in the browser for the
    signed-in operator ("your submission at HH:MM may have arrived - check the
    queue, or simply submit the same source again", with the link). Submitting
    again after a reload is a new request under a new key, and that is fine:
    Core answers it with the open draft. It holds a time and a kind of source - no key, no
    content, no file name - is shown only to that operator, gates nothing,
    decides nothing, is never compared with the clock and can be dismissed at
    any time.
- **Reject** keeps its command (key included) until it is settled; the retry is
  that command.
- **Publish** is the P1 journal, unchanged.
- **Hold** has no identity; a not-known outcome is followed by a read.

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
  record, so the decoder refuses one without the other. The activity detail
  carries the label on both of its projections (the activity and the embedded
  event); the decoder refuses a body in which the two disagree.

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

# AI-assisted event intake console — P2a (T-865 / T-885)

The console for "Draft from source" / "Vázlat forrásból": an administrator gives
Core a link, a flyer photo or a line of text; Core's intake worker has an AI
draft an event sheet and validates it deterministically; a reviewer compares
the draft with the source and either rejects it or publishes its events through
the existing P1 external-event editor and publisher. **The AI never publishes**,
and nothing of an intake is ever shown to members.

This document describes the Webadmin side only. Core is the authority for every
rule; the provider is the Core lane's contract `dates-event-intake-admin-v1`.

## Release boundary and deploy order (D-143)

- Provider: Core branch `claude/t865-p2-core` (T-884, T-886, D-143, D-145),
  rebased onto Core main `33265e46`, pinned at
  `62cee304c68eaeda456ddf0b042cb340b8702d48` (the no-usage fix `2034a93a`; its
  bodies are those of `8a621565`). The intake corpus is vendored from that tip
  byte-identically (`tests/fixtures/dates_event_intake_admin_wire/`,
  161 bodies, set `4415fcb2…`); every console request in it carries the Admin
  intake contract selector (below). The P1 routes WITHOUT the selector are Core
  main's capture (`tests/fixtures/dates_external_admin_wire/`, 138 bodies, set
  `ba9ebf7a…`: the released set but four revision values, T-891), which the P2
  tip serves body for body.
- **Order: Core first, then this console.** The intake pages need Core's P2
  routes, the `existing` marker on the create receipt and `suggestions_enabled`
  on the queue; an earlier Core serves none of them.
- **The selector.** Core adds keys to bodies the RELEASED console (Webadmin
  `7825bc13`) reads with exact key sets: `ai_assisted` on an external list row,
  `intake` on an event's detail and on the event of an activity detail, and the
  settings of the two intake channels in the configuration read. By D-143 Core
  serves those additions only to a request that carries the Admin intake
  contract selector; a request without it is answered with bodies
  byte-identical to the released P1 corpus (Core main `07215298`, set
  `d84a3e16…`). This console sends the selector on every Dates Admin request
  (`dates_*`), server-side, as a server-owned parameter merged after the
  browser's body: `lib/datesAdminContract.ts`,
  `DATES_ADMIN_INTAKE_CONTRACT_SELECTOR` - the one place that names it:
  **`dates_event_intake_admin_contract_version=1`** (announced by the Core
  lane; "exactly 1 is the selector, anything else is without"). Nothing else
  depends on it: this console's decoders accept a P1 body with and without the
  additions. With the selector an intake setting is saveable; without it Core
  refuses the key (`dates-configuration-key-invalid`), as it does for the
  released console.
- **Dual shape.** In this console `ai_assisted` on a list row and `intake` on an
  event are optional. Absent means "not served here": the row is not marked as
  AI-assisted and the event shows no link back to an intake. The configuration
  page lists the settings Core serves (33 without the selector, 50 with it); the
  help marks a setting it documents but Core did not return as "not returned".
  The additions of the intake routes themselves are optional in the same way:
  `second_look` on an intake row (absent: not marked), `second_look_count` on
  the queue (absent: not known, nothing is shown) and
  `event_suggestion_consent` on the configuration read (absent: nothing is
  shown beside the member switch).
- **No decoder of a Core body checks an exact key set.** Every Dates decoder
  binds on its fields - each named key present and valid - and tolerates a key
  it does not know; the screens print named fields only, so a tolerated key is
  never shown. Closed vocabularies stay closed, each with a fallback. Where an
  exact key set used to tell two things apart, the difference is now said
  outright: an activity is external when it carries `origin`, a command's
  receipt echoes its `action`, a manual publication's receipt names no
  `intake`. What the console itself SENDS (request shapes) and what it stores
  for itself stay closed.

### What each side shows between the two deploys

| Moment | Released console `7825bc13` | This console |
|---|---|---|
| Today: Core main `07215298`, released console | everything as released | - |
| Core P2 deployed, console not yet (minutes) | Sends no selector, so every Dates page reads the P1 bodies it was released with: unchanged. It has no intake pages. | - |
| Then this console deployed | - | Sends the selector: external lists carry the AI badge, events link back to their intake, the configuration lists the intake settings, the intake pages work. |
| Wrong order: this console on Core main | - | The P1 Dates pages work: Core main ignores the selector parameter (below) and the decoders read the P1 bodies. The intake queue, review screen and AI usage page show Core's refusal / "could not be read" (the routes do not exist), never an empty queue; "Draft from source" is shown with the note that the switch could not be read, and a submission ends as "not known" (there is no such route, so nothing can have been created); the configuration lists the 33 P1 settings. Not a state to stay in: deploy Core first. |

### Rollback

- **A Core rollback to main `07215298` does not need a console rollback for the
  selector.** Read from Core's source at that commit (git objects; not run):
  the Dates Admin routes (`config/routes.php:1163-`, `WebadminDatesController`,
  `WebadminDatesExternalController` and their services) read their parameters
  by name with `$request->raw('…')`; `WebadminSecretMiddleware` inspects only
  `secret` / `admin_email`; no Dates Admin route enumerates the body or refuses
  an unknown body parameter, and the idempotent commands hash an explicit
  payload, not the request. So the old Core ignores the selector and answers
  with its P1 bodies, which this console decodes. If a Core is ever rolled back
  to one that DOES refuse unknown parameters, roll this console back with it.
- After such a rollback the intake pages lose their routes (they show the
  refusal; nothing is cached), and the P1 Dates pages keep working.
- A console rollback to `7825bc13` needs nothing of Core: it sends no selector.

### Switches

- Everything is inert while `dates_external_admin_drafts_enabled` and
  `dates_external_suggestions_enabled` are false, which is Core's default: no
  intake can be created or published, nothing is stored and the worker has
  nothing to do. Deploying this console enables nothing.
- **Turn the two switches on only after this console is live.** An event
  published from an intake is AI-assisted and may have a Places venue; the
  released console's detail fixes `ai_assisted` to `false`, `venue.place_id` to
  `null` and `venue.resolved_by` to `admin_pin` by literal, so such an event is
  outside what it decodes with or without the selector.
- Publishing a draft also needs the P1 switch `dates_external_publishing_enabled`.

### What leaves the server: named fields only (lead's ruling on D-143)

Tolerating a key is not the same as passing it on. The browser never receives
a raw Core body of a Dates Admin route: the bridge (`app/api/admin/[action]`
and the intake create route) hands it the body's **projection** - the fields
this console names (`DATES_ADMIN_NAMED` in `lib/datesAdminProjection.ts`, one
tree per route) - and nothing else. A refusal is Core's six refusal keys.

- **A key the console does not name is dropped**, silently: that is every
  additive change of Core until the console names the key. It is not in the
  response, so it cannot be rendered or read from the browser's memory.
- **A key on the deny-list is dropped and reported.** The list below is a
  maintained contract: a key Core must never send to this surface. When one
  arrives, the page is NOT failed; the key never reaches the browser; and the
  server writes one warning per response and key -
  `webadmin.dates_denied_key route=<route> family=<family> key=<path> count=<n>` -
  with the key's name and never its value, so that a leak in Core's projection
  is noticed instead of hidden. To add a key: put it in
  `DATES_ADMIN_DENIED_KEYS` and in this table (a test compares the two).
- **The value rules stay in the decoders**: a reporter that is not redacted, a
  note on a conflicted case, a decision of another case, a sensitive location
  without the scope are refused as before.

| Route (body family) | A key Core must never send here | Why |
|---|---|---|
| `dates_moderation_queue` (moderation-queue) | `cases[].internal_notes`, `cases[].text`, `cases[].message_text`, `cases[].snapshot`, `cases[].target_content_hash`, `cases[].reporter_uid`, `cases[].reporter_uids`, `cases[].external_message.text`, `cases[].external_message.snapshot`, `cases[].external_message.target_content_hash` | A queue row is metadata: never a note, never the reported content, never who reported. |
| `dates_moderation_detail` (moderation-case) | `case.text`, `case.message_text`, `case.snapshot`, `case.target_content_hash`, `case.reporter_uid`, `case.reporter_uids`, `case.external_message.text`, `case.external_message.snapshot`, `case.external_message.target_content_hash`, `decisions[].before`, `decisions[].after`, `decisions[].actor_email`, `decisions[].subject_uid`, `decisions[].text`, `reports[].reporter_uid`, `reports[].reporter_email`, `appeal.note`, `appeal.appellant_uid` | Case metadata: never the reported content, never who reported or appealed, never the acting moderator, the sanctioned member or the raw before / after of a decision; the appeal's note comes only from the audited evidence read. |
| `dates_moderation_evidence` (moderation-evidence) | `appeal_note.appellant_uid` | The appeal note is the appellant's words, not their identity. |
| `dates_moderation_resolve` (moderation-decision-receipt) | `target_result.text`, `target_result.before.text`, `target_result.after.text` | A receipt names states and revisions, never a message text. |
| `dates_external_event_list` (external-event-list) | `events[]._id`, `events[].host`, `events[].submitted_by_uid` | A list row has no member host, no database id and no submitter. |
| `dates_external_event_detail` (external-event) | `event._id`, `event.host`, `event.intake.provider`, `event.intake.admin_principal`, `event.intake.submitter_uid` | The reference to the intake names the intake, its channel and the event index: never the AI provider behind the draft, never a person. |
| `dates_activity_detail` (activity) | `external_event._id`, `external_event.host`, `external_event.intake.provider`, `external_event.intake.admin_principal`, `external_event.intake.submitter_uid` | The same, for the event embedded in an activity detail. |
| `dates_external_event_place_search` (place-search) | `places[].raw_provider` | A place is the fields the picker copies, never the provider's raw answer. |
| `dates_event_intake_list` (intake-queue) | `intakes[].submitter_uid`, `intakes[].member`, `intakes[].admin_principal`, `intakes[].source_texts`, `intakes[].inputs` | A queue row names no member and carries nothing of what was submitted. |
| `dates_event_intake_detail` (intake) | `intake.submitter_uid`, `intake.consent`, `intake.input_fingerprint`, `intake.open_claim`, `intake.structured_events`, `intake.processing`, `intake.notify`, `intake.inputs.origin_hint`, `intake.inputs.url_hash`, `intake.inputs.url_hashes`, `intake.inputs.images[].storage_key`, `intake.inputs.images[].sha256`, `intake.member.email`, `intake.member.phone`, `intake.member.name`, `intake.member.display_name`, `intake.ai_runs[].prompt`, `intake.ai_runs[].response`, `intake.ai_runs[].request`, `intake.ai_runs[].raw` | Of a member only what the `member` block serves; never the stored consent record, the member's origin hint, a storage key or a fingerprint; an AI run is usage metadata, never what was asked of the model or what it answered. |

`[]` stands for every element of a list. The keys come from three places: the
ones the released decoders used to catch by refusing the whole body; what
Core stores beside what it serves (read from Core's source: a decision's
`actor_email`, `subject_uid`, `before`, `after`; a report's `reporter_uid`; an
appeal's `appellant_uid` and `note`; an intake's `submitter_uid`, `consent`,
`inputs.origin_hint`, storage keys and fingerprints); and what an AI run must
never carry.

**Kept whole, by design** (`DATES_ADMIN_OPAQUE`) - the only parts of a Dates
body that reach the browser without being named field by field:

| Route | Part | What bounds it |
|---|---|---|
| `dates_activity_location` | `private_location` | The break-glass read of one activity's exact location: its own capability, a case and a reason per read, audited by Core; shown only after the operator asks. |
| `dates_moderation_evidence` | `evidence[].snapshot` | The evidence of one case: the separately authorised, audited evidence read; refused to a conflicted operator. The row around the snapshot is named fields. |
| `dates_moderation_evidence` | `evidence[].purge_at` | The date Core scheduled a released row's purge: a MongoDB date, which Core's JSON encoding serves as an extended-JSON object (`{"$date": …}`). Passed as served; every other key a Core evidence writer can put on a row is named (the inserts, a legal hold placed and released, an automatic hold closed, a restricted trail snapshot or an erased account). |
| `dates_activity_detail` | `activity.photo`, `activity.audience`, `activity.pending_public_revision` | An activity's own public data, which the activity editor shows and sends back unchanged (narrowing it here would write the narrowed value back). |
| `dates_configuration` | `settings[].value`, `settings[].effective_value`, `settings[].default_value`, `settings[].allowed_values` | A setting's values: data the editors show and send back; a setting row's other fields are named. |
| `dates_configuration_save` | `setting.value` | The value Core echoes of the setting that was just saved - the same data. |

One more reduction: the activity detail's `reports`, `notifications`,
`moderation_decisions` and `audit_history` are documents Core passes through
whole. They leave the server as their safe keys (the list the history panel
already used, `OPERATIONAL_RECORD_SAFE_KEYS`) and a count, `withheld_fields`;
until this change the whole documents reached the browser and were filtered
at render.

### The check that stays in the gate

`tests/datesAdminCompatibility.test.mts` (part of `npm test`):

- the released P1 corpus is vendored as a second fixture set
  (`tests/fixtures/dates_external_admin_wire_released/`, from Core main
  `07215298`, pinned by set and manifest digest);
- the released console's own decoder modules and its two wire tests are
  vendored byte-identically from `7825bc13`
  (`tests/fixtures/released_console_7825bc13/`, each file pinned by digest; not
  re-stated rules) and the wire tests are run unchanged, in a tree of their
  own, on the selector-less bodies: 127 tests must pass;
- the selector-less bodies are the PROVIDER's capture at its pinned tip
  (`tests/fixtures/dates_external_admin_wire/`): asserted to be the released
  corpus body for body (138 of 138; only the manifest, which binds the capture
  to its source, differs);
- as a control, the same released decoders refuse the genuine selector-carrying
  bodies (a manual event's list and detail, an AI-assisted activity detail).
  Of an AI-assisted event read WITHOUT the selector (D-145): the external list
  row decodes; the activity list reads and names the event's row as
  unreadable; and the external detail and the activity detail are refused by
  Core itself (`dates-external-intake-contract-required`, 426) - the released
  decoders read no body from it, and the released pages (their source is
  vendored too) show their load error, nothing else. That is why the switches
  are turned on only after this console is live;
- this console's decoders read both shapes of every P1 read that depends on the
  selector, on genuine bodies: without it the 9 lists, 13 details, the external
  activity detail and the 2 configuration reads of the P1 corpus; with it the
  manual and AI-assisted list and detail, the AI-assisted activity detail and
  the 50-row configuration of the intake corpus; the released-console list
  (its selector sibling minus the one key) and activity list; and the two
  refusals, read as refusals with their token. This console sends the
  selector, so it is never answered with them.

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
| generic action `dates_event_intake_ask_member` (T-886) | same | review |

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

- Closed about the vocabularies Core publishes in the corpus manifest, each
  with a fallback; `tests/datesIntakeWire.test.mts` compares the console's
  lists with the manifest. Bound on fields, never on an exact key set (D-143).
- Never stricter than Core on a value Core can store: free text is a string,
  a number is a number, and identifiers the contract does not declare closed
  (attendance mode, status signal, prohibited category, task, dropped-link field,
  the usage ledger's provider, model, task and channel) stay open and are shown
  as Core wrote them when the console has no translation.
- A list degrades per row. In the queue an unreadable display field marks the
  row; an unusable revision or hold removes its actions; a row whose identity
  or status cannot be trusted, or that lacks one of its fields, is reported by
  position. On the review
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
- A command's receipt (create, lease, reject, ask the member, publish) is
  **bound**, not exact-key: what identifies the command must be there and
  valid - `success`, the intake id, the revision the command leaves, the
  outcome where Core echoes it (the lease's four facts, `rejected` /
  `duplicate` with the reason, `member_confirming` with the fields asked,
  the publication's event and activity), an audit id of the right shape, the
  `replayed` / `existing` markers - and any other key is tolerated. A body that
  fails this is not a receipt: the outcome is "not known".
- Reads are bound on their fields in the same way (D-143): the queue, a row,
  the detail and each of its sections, the usage read, the flyer read. A key
  this console does not know is tolerated and never shown. The member block is
  rebuilt from the contract's fields, so a key Core might add to it is not even
  kept.

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

## Members' suggestions (T-886)

A member's suggestion is an intake of the same queue with
`channel: member_suggestion`; Core's contract is
`docs/DATES_EVENT_SUGGESTION_V1.md`, "The reviewer's side". What the console
adds for it:

- **Queue**: a channel filter (operators' drafts / members' suggestions) and a
  notice when `suggestions_enabled` is false.
- **Second looks in the queue**: Core marks a row that waits for a second look
  (`second_look: true`) and counts them on every queue read
  (`second_look_count`, whatever the page is filtered by). The row carries a
  badge; while any wait, a notice above the table says how many and leads to
  them; a filter shows all intakes, only the second looks or everything but
  them (`second_look` sent as a boolean, which the form encoder writes as `1` /
  `0`; no filter is no parameter). A mark the console cannot read is said on
  the row and removes no action; a count it cannot read is not shown - never a
  zero.
- **The member's side** (`DatesIntakeMemberPanel`): the intake's `member` block
  and nothing else of the member - a member number (or "the account was
  erased"), credit (named / asked not to be named), "going", the accepted
  consent version, where the member's look at the draft stands (state, time,
  due time, what a reviewer asked and the note), the member's changes as a
  diff (event, field, the AI's value, the member's value), the second look
  (when asked, the member's note, the first decision, the second decision) and
  the standing (strikes inside the window of the limit; a ban). No profile is
  linked and no other route is read. Every text of the member is rendered as
  plain text.
- The block is decoded part by part. A part the console cannot read is said to
  be unreadable in its place - never "none" - and then the member is not asked
  from this page. A block that cannot be trusted at all (or is missing on a
  suggestion, or present on an operator's draft) makes the whole side
  unreadable.
- **Ask the member** (`dates_event_intake_ask_member`): one to eight of the
  editable fields, an optional note the member reads (at most 500 graphemes),
  the audit reason. Offered on a suggestion in review to a reviewer; allowed
  when Core says `can_ask`, the member switch is not known to be off and the
  reviewer holds the intake - otherwise the form says which of these is
  missing. A dialog confirms it. The receipt names the time the answer is due,
  and that time is what the message shows. "Needs more info" is this command:
  Core has no other route for it, and the member's notice is `needs_info`.
- **Reject**: the statement of reasons is Core's template for the reason. With
  the reason `duplicate` the reviewer may name the event that is already there
  (typed, or picked from the events Core's own duplicate check pointed at): the
  suggestion then ends as `duplicate` of that event, and the receipt must say
  so twice. A name that is not an event id is refused on the form, never
  dropped. Before confirming, the reviewer reads what it means for the member:
  the notice, a strike for `spam_or_fake` with the served strikes and limit
  (or "standing unknown" / "nobody" for an erased account), and that a second
  look ends with this decision.
- **Publish**: a suggestion needs the member switch
  (`dates_external_suggestions_enabled`) instead of the draft switch; the
  console offers accordingly and Core decides. The confirmation says what the
  publication does for the member: named by number or not named, joined when
  they asked to go and the suggestion is a single event.
- **Second look**: a suggestion Core marks `second_look` - or, from a Core that
  does not serve the mark, one back in review with `re_review` set and no
  second decision - carries a mark at the top of the review screen; its
  decision is an ordinary publication or rejection.
- **The consent text beside the member switch**: with the selector the
  configuration read carries `event_suggestion_consent: { required_version,
  text_status }`. The configuration page shows it directly under
  `dates_external_suggestions_enabled`: `draft` (counsel has not approved the
  text members are served - a warning; Core does not stop the switch for it)
  and `approved` are states of the text; `missing` is a problem, shown as an
  error: the required version has no complete text in this release, so the
  member channel is closed whatever the switch says. A status the console does
  not know is "could not be read" - never approved. Saving a consent version
  that has no text is refused by Core (`dates-configuration-value-invalid`);
  the editor says "this version has no text yet" beside the field.
- **The published event**: the provenance panel says "published by Core without
  a reviewer" when none of the four administrator confirmations was given (the
  autopublish switch, default off).
- Nine settings (`dates_external_suggestions_enabled`, six limits and the strike
  rule, the consent version, `dates_external_autopublish_enabled`) follow the
  eight of the admin channel, each with its editor and help.

Asking and rejecting are compare-and-set on the intake's revision, like the
hold: a request sent twice under two keys is refused by Core the second time
(`dates-intake-conflict`). While the page is open an unanswered request keeps
its key for the retry; nothing is stored for it.

## Command outcomes

Every intake command (create, hold, reject, ask the member, publish) is settled by exactly two
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
  trustworthy. **That an operator's source does not become two open drafts
  is Core's guarantee, not this console's**: Core answers an identical
  resubmission by the same operator, while an open draft of the same source
  exists, with that draft - the ordinary create receipt with `existing: true`
  and the draft's id, revision and status as they are now (Core's proof for
  this channel: `tests/dates_event_intake_resubmission_storage_test.php`).
  The statement is about the operator's create, which is the only create this
  console has; what Core guarantees for the member channel is Core's contract
  to state (`docs/DATES_EVENT_SUGGESTION_V1.md`), not this document's. The
  console keeps no state for it and does only what is safe and useful:
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

## AI usage: calls whose cost is not known (D-145)

The usage read serves, since Core D-145, the calls whose cost is not known: a
call that was sent and whose answer never arrived or could not be settled
(`transport`), a call that failed in the worker before its cost was settled
(`unsettled`), or one whose worker stopped while it was outstanding and that
Core's clean-up closed (`reaped`). The provider may have charged for it, so
Core books it at its whole reservation as money spent: it is in
`spent_micro_usd`, counts against the cap, and is counted in
`ambiguous_calls` / `ambiguous_micro_usd` with the newest of them listed in
`ambiguous_runs` (provider, model, task, channel, source, the failure - a
transport's curl code, `response-too-large`, or `no-usage` for a successful
answer that carried no usage figures (Core `2034a93a`), empty for the other
two sources - the amount, the time); each usage row has its own
`ambiguous_calls`. The AI usage page says it plainly - "may have been charged
by the provider … counted as spent … not known whether the provider charged
it" - and lists the runs. All four keys are optional (D-143): a Core that
does not serve them shows nothing; figures that cannot be read are said to
be unreadable, never "none"; a run that cannot be read is counted; an
unknown source is shown as its token.

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

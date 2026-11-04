# Manual external-event console — P1 contract amendment

This is the manual, no-AI operator console authorized by T-865 and D-137–D-140.
It supersedes the older generic exclusion of AreYouIn for this assigned feature
only. The server remains the authority for permissions, validation, revisions,
deduplication, audit, retention, moderation and publication. Nothing here enables
an API, changes a production setting or deploys either product.

## Coordinated release boundary

Release the compatible Core provider before this consumer. Keep
`dates_external_publishing_enabled` OFF until the lead has accepted and released
both repositories. This switch is independent of member/storefront visibility;
deployment must not enable it as a side effect. Core checks publication and fact
updates after looking up successful idempotent receipts, so completed requests
can still replay after the switch is turned off. Safety/lifecycle commands remain
available according to their own capabilities and state rules.

The incremental console capture in `tests/fixtures/dates_external_admin_wire`
comes byte-for-byte from FINAL E1 Core `51140a6f2b995207af2e8140bf5d7d1e2323293c`.
Its manifest names generator/source `c94d144691b93c3aea3dd180def345c4d03a4e55`.
`tests/datesExternalWire.test.mts` independently pins its manifest, generator,
source checksum, complete 138-file inventory and every response byte hash:
94 successful responses and 44 refusals. The newest ten real list/detail bodies
cover sports match/participation, paid ticket and age18 Admin facts, sensitive
count-only attendance and America/Los_Angeles venue-local strings. All preceding
128 bodies remain byte-identical. Production editor round-trip and both-locale
controlled SSR probes exercise these genuine bodies; they are not browser mounts.
The earlier 21 additions left all
107 preceding bodies byte-identical. They are captured from actual member sends
through automatic prepublication cases, audited operator evidence/claim/decision
routes, current-state retries and author withdrawal. Both consumer corpora use
that same routed scenario; no held message or prepublication case is fabricated.
The original 43 editor bodies are unchanged; the next 45 additions cover hostless
moderation, existing activity-detail/lifecycle adapters and settings. They use
actual routed responses, audits and completed receipts; case/report intake is
synthetic setup, not proof of member intake. This is the **FINAL E1 provider
pin**, frozen for coordinated client adoption. Seven more
actual routed bodies cover the external reason catalogue, a seeded copy-only
save and replay, mixed/cohort refusals and a viewer capability refusal. The final
twelve preceding additions capture report-held list/detail, non-approving corrections and
reverification, safety cancellation, exact replays, post-write details and refused
held-case dismissal. Only the two earlier held queue/detail `allowed_actions`
arrays change, removing `dismiss`; the other 93 preceding bodies stay identical.

The existing reason editor accepts `external_event` only for activity reasons
and only as a singleton. A stored reason cannot cross the member/external
boundary; its bilingual copy, severity, order and same-cohort entry points stay
editable. The five unreleased external seeds use canonical
`reason_activity_{wrong_details,canceled,fake_or_scam,inappropriate,duplicate}`
IDs. No released IDs are renamed. The virtual `reason_activity_external_other`
fallback is not a stored editable row. The console validates the full catalogue
and binds successful save receipts to the submitted identity, revision and
fields; malformed/unknown replies never become a successful or empty catalogue.
The operator display isolates damaged reason rows instead of suppressing runtime
settings and publication controls. Only presentation copy can be shown as an
explicit unreadable field. Invalid reason identity, revision or cohort receives
a diagnostic with no editor; none is invented or repaired. Save receipts remain
strict and bound to the original identity/CAS and submitted edits.
Rows with unreadable presentation fields are read-only: their display substitutes
must never seed a whole-row save that clears stored copy. Fresh moderation access
distinguishes confirmed capability loss from failed/undecodable reads; neither
dispatches a decision or discards written reasons or a pending receipt journal.

## Served actions and authority

The browser calls only the existing authenticated same-origin admin proxy.
The six new allow-listed actions are:

- `dates_external_event_list` and `dates_external_event_detail`, requiring the
  fresh `dates_external_event_read` capability;
- `dates_external_event_publish`, `dates_external_event_update`,
  `dates_external_event_command` and `dates_external_event_place_search`,
  requiring fresh `dates_external_event_manage` and the existing write-role gate.

An owner label alone never grants a missing Dates capability. The server checks
current Core membership for every request, rejects foreign-origin/guest traffic,
validates the closed browser request, and supplies the authenticated actor. The
browser may supply neither Core credentials nor actor identity. Core's form
encoding and HTTP-200 legacy logical-status envelope are unchanged.

List/detail decoders reject partial, loose, contradictory or unknown successful
shapes. An invalid response is an error, not an empty list. List and count are
separate Core reads, so count skew under concurrent changes is accepted without
inventing snapshot consistency. Existing member rows permit Core's grapheme-
bounded free text (including interior tabs/newlines); only damaged presentation
fields are marked unreadable. Bad identity, host UID, CAS or origin is a
diagnostic row with no mutation controls, and a detail link exists only for a
valid activity ID. Other rows remain visible. External DTOs and every command
receipt retain strict decoding. Core's venue-local read strings are authoritative;
the decoder does not reinterpret them through a possibly different browser
timezone database. Source URLs are navigation links, not permission
to fetch arbitrary URLs. Private evidence is never part of the safe event DTO.

## Facts and publication

The create form publishes atomically. There is no server draft-save or republish
action. It captures title, EN/HU summaries, category, sensitive/attendee-list
policy, explicit local time and UTC offset, IANA timezone, public venue/pin,
organizer, source/official/ticket links, price and age limit. Core owns the final
time horizon, ticket-domain and venue policy. DST gaps and ambiguous offsets are
not silently repaired using the browser timezone. A blank end remains null in
the editor when Core estimated the category duration; displayed event facts
still show the computed end.

Four independent human attestations are mandatory: source, public venue,
timezone and safe content. Every fact edit clears them. A stored historical true
attestation does not pre-check a new edit. Images are category art only: no file
upload, member flyer, image scraping or inferred licensing is offered by P1.

Publication refuses both exact source-URL hash + local date and normalized
title + venue + local date duplicates. A later recurring occurrence can retain
the same source. The UI explains both refusal fences and never bypasses them.

Places suggestions are optional, transient assistance. Provider unavailability,
rate limiting and no results preserve manual entry. Google Maps and any required
third-party attribution stay visible; suggestions are not shown on a non-Google
map. The separate existing Google map frame confirms the public pin using its
origin/window-checked message contract. Selecting a suggestion does not carry a
place ID/provider provenance into publication or tick any attestation. Enabling
provider APIs/server keys is a separate release operation, not a console action.

## Revisions and unknown outcomes

External update/commands use the ledger revision; the linked activity has its
own revision. Mutation state is `event_status`; top-level `status:200` remains
the legacy envelope marker. The existing `dates_activity_command` adapter keeps
activity-CAS semantics and `idempotency_replayed`, with `external_revision`
separately identifying the ledger. Consumers must not interchange these fields.

Before dispatch, the operator identity, action, exact payload, both-revision
baseline, Core issue time and a fresh idempotency key are saved and read back
from session storage. One outstanding external mutation per operator/tab blocks
competing writes. Lost, malformed, transport, authorization and ambiguous
service responses retain the immutable command. Retry uses exactly the saved
bytes and key after a fresh independent access/time read; it does not reuse the
currently edited form. Navigation prevents stale UI adoption while an already
dispatched runner may finish reconciliation of its own durable identity.

Only an action/identity/revision-bound receipt or a known Core no-land refusal
can retire that exact stored command. Corrupt, replaced, inaccessible or expired
storage blocks new work; it is never silently cleared. Retry stops at six days,
before Core's seven-day receipt retention. A missing detail after a successful
but unacknowledged purge can recover its receipt through an independent fresh
authorization check. Stale CAS keeps the form and requires explicit reload and
review rather than an automatic rebase of an unreviewed mutation.

### Commands outside the journal (T-890)

The member-plane commands of the Dates console - case claim, heartbeat, release,
note, escalation and member resolution; activity edit, lifecycle command and
host transfer; setting, activity-type and report-reason saves; legal hold and
trail capture - are not journal commands. `datesCommandOutcome` (`lib/datesExternalAdmin.ts`) reads their
replies with the journal's classifier and one of two identities:

- **fresh** - the command is fenced in Core by a revision that its own write
  moves and that never moves back (a new report reason by its own existence,
  a purge by the activity being gone), so a repeat cannot write twice and each
  attempt carries a new key. Any readable refusal below
  500 answers the request and is worded as before. No answer, an unreadable
  one, the bridge's transport failure, a 5xx and `dates-admin-command-in-progress`
  are worded "the outcome is not known", not "failed". Nothing else changes on
  the page: there is no automatic reread (on the case page it would clear the
  evidence read, the break-glass choice and the confirmation); the case page
  offers "Refresh the case" beside the message.
- **kept** - a command Core does not durably fence would keep its key and be
  offered again as the same request. Since T-891 no command of the console is
  kept: the interim re-offer of the legal hold, the live-trail capture and the
  host-transfer request is retired, because Core fences all three now
  (Core `claude/core-hardening-20261002`, 33265e46). What a repeat under a NEW
  key does since then, per command:
  - **legal hold** (place, release): the page sends the case revision
    (`expected_revision`, both actions). Every hold write moves the case
    revision, so a repeat with the revision the page had read is refused as
    stale (`dates-admin-stale-revision`, 409, nothing written). After a
    refresh, the identical hold is answered as `unchanged` - "already in
    place" / "nothing was held" - and writes nothing.
  - **live-trail capture**: the capture moves the case revision, so a repeat
    with the old revision is refused as stale; the same window at the current
    revision is answered with the snapshot that exists (`existing: true`:
    "this window was already captured"), nothing stored.
  - **host-transfer request**: the request moves the activity revision, and so
    do a decline, an expiry and a cancel; a repeat with the old revision is
    refused as stale (`dates-stale-revision`) whatever became of the first
    transfer. A new transfer needs a refresh, which shows the pending one.

  So all three are **fresh**, worded like every revision-fenced command. This
  rests on Core T-891: a console of this kind on a Core without those fences
  would let a blind repeat write again, so the order is Core first, and a Core
  rollback below T-891 needs this console rolled back with it.

#### Receipts (T-891)

Every command's success body is checked against the request the page sent
(`lib/datesCommandReceipts.ts`, `lib/datesModerationRead.ts`), on Core's
genuine request / answer pairs (`tests/fixtures/dates_admin_command_wire`; the
requests are those of Core's generator; the corpus also holds three evidence
reads after a legal hold was placed, amended and released). A check binds on what
identifies the command - the target, the action, the revision the command
leaves - and tolerates keys it does not name. A success body that fails its
check is "the outcome is not known". No route is taken on the bare success
flag any more (`DATES_RECEIPT_CHECKS_PENDING` is empty).

| Command | The receipt binds |
|---|---|
| activity edit | the activity; revision = expected + 1 |
| activity end / cancel / soft delete / restore | the activity and the action; revision = expected + 1; ended / canceled / soft-deleted / not soft-deleted |
| activity purge | the activity; `purged: true`; revision = expected (the revision removed) |
| host-transfer request | a pending transfer of this activity to this member; with the command contract selector `activity_revision` = expected + 1, adopted at once |
| setting save | the key; revision = expected + 1 (the first save: 0 -> 1); the value is Core's normalised one, not compared with what was typed |
| activity-type save | the key; both revisions = expected + 1 |
| reason deactivation | the reason; inactive; revision = expected + 1 |
| member-case resolution | the case and the action; a decision; revision = expected + 1 |
| legal hold | the case, the action, the review date; with `expected_revision` also `hold_change` (placed / amended / released / unchanged), `revision` (= expected + 1, or = expected when unchanged) and `evidence_changed_count` (0 when unchanged) - all three or none; the revision is adopted |
| live-trail capture | the case and the window, a snapshot; with the command contract selector also `revision` and `existing` (= expected + 1 for a new snapshot, = expected for an existing one) - both or neither; the revision is adopted |

The command contract selector (`dates_admin_command_contract_version=1`) is
added by the server (`lib/datesAdminContract.ts`). Of the commands it goes with
the trail capture and the host transfer only; without it Core answers with the
released keys, and the checks read those too (the extension is absent, nothing
is adopted). The same selector goes with four reads - the activity detail, the
event content, the moderation queue and the case detail - where it asks Core
for what an event's host did (host moderation v1: removed and banned members,
who took content down and what a host removal kept, where a case's content
lives and what the host decided). Those additions are optional in the decoders:
a Core that does not serve them answers as before, and what would show them is
not rendered.
The browser receives the receipts through the projection, whose trees name
these keys (`lib/datesAdminProjection.ts`).

## Existing activity console and moderation boundary

The activity list supports `all`, `member` and `external` origins. External rows
have `host:null`, organizer identity, unlimited capacity and no host transfer.
Their linked detail shows the safe sources, submission channel, verification
tier and explicitly absent AI assistance. It does not invent a member UID 0.
Member edit/location/host-transfer controls are hidden for external events;
external actions use the dedicated editor and durable mutation runner.

Withdraw/cancel, manual reverify and official update use the external command.
End, soft delete, restore and purge use the existing activity command. Restore
only undoes soft deletion; it does not reopen a terminal event, clear pending
moderation or grant live access. Purge still requires Core's elevated capability,
retention eligibility and absence of open cases/legal holds. Reverify does not
start a fetch/AI job, clear moderation or send a notification.

Active, undeleted `in_review` events remain editable with Core's manage
capability. Corrections and fresh verification keep pending moderation, review
metadata and the read-only thread; they do not approve publication. The editor
explains this distinction in both languages and disables official thread updates
while held. Cancellation, withdrawal and end remain safety actions. Unknown or
contradictory `can_edit` projections still fail the closed decoder.
Durable `in_review` journals use the same exact actor/key/CAS recovery as other
editable states; official updates stay refused while held. A failed fresh
capability read reports unconfirmed access and sends no decision, rather than
asserting a permission denial that Core did not return.

The implemented moderation-A contract requires `target_type:external_event`,
`target_id:xev_*`, linked `activity_id:act_*`, non-member `target_uid:0`, separate
resolution actions and `dates_external_event_review`. Its closed case variant
adds `external_revision`, `external_status`, `external_target_available` and
`allowed_actions`. Both case-resolve and external-review capabilities are
freshly checked even for a completed receipt retry. The only five actions are
dismiss, restore content, remove content, cancel activity and remove activity;
there is no member sanction, participant/photo removal, prepublication or appeal
fallback. Queue membership does not grant evidence access or location capture.

Resolution saves the independent case/content revision pair, target baseline,
exact reasons, request key, actor and Core time before dispatch. A separate
per-actor/tab moderation journal blocks competing case writes while unresolved.
It follows the same six-day, never-silent-discard recovery policy as the editor.
A stale case or event revision requires explicit refresh and human review, not
automatic rebasing. Closed-case replay does not require claiming another lease.
Late navigation suppresses UI adoption but cannot discard an already dispatched
request's durable identity. A missing or mismatched second facts read blocks
new writes while preserving readable case history and exact receipt recovery.

Dismissal leaves content unchanged. While active content is held, Core removes
`dismiss` from `allowed_actions` and refuses it with
`dates-external-command-state-invalid`; closing that case would strand approval.
The console intersects its action vocabulary with those current server actions
and repeats that check before dispatch. Approval is an explicit, current-CAS
`restore_content` decision; a correction or source check cannot substitute for it.
Moderation cancellation marks it withdrawn,
not canceled upstream. Restore only approves nonterminal, undeleted, unexpired
content and never revives live sharing. Removal preserves an existing terminal
state. Explicit legal holds survive resolution; automatic case holds do not.
After permitted content purge, history remains readable with null content
revision/status and no event actions. Decision metadata is cross-bound to the
case's non-member target. Report reason snapshots accept only the two served
closed shapes: bilingual EN/HU or one captured locale/label; a captured label
is displayed as-is, never represented as a translation.

The six runtime settings are external visibility/default plus storefront
overrides, independent publication enablement, daily/per-event invite limits and
event lookahead. They use Core's existing audited CAS configuration path. The
three integer inputs preserve their raw strings for Core's strict parser. A
storefront map is JSON, never `[object Object]` or an accidental numeric control.
Availability's stored default is BE/ON; the independent publication rollout
default is KI/OFF. The full EN/HU category vocabulary follows the canonical
member-app labels, including Sports activity / Sportprogram and Other event /
Egyéb esemény. The closed App Review v4 expected external totals are 3 activities,
4 memberships, 3 threads, 5 thread members, 2 messages and 1 notification.
The protected fixture's operator-control distinction is follow-up T-880, not a
new P1 control or additional status key.
App Review's released 34-check/23-count closed keyset is unchanged at the initial
provider pin; no guessed keys or production fixture reset are introduced.

## Held external-thread message review

The lead's narrow prepublication extension uses the existing messages queue and
`dates_moderation_resolve`; it does not widen ordinary member-message actions.
The initial preparation against committed Core `1db0a709` is now exercised by
the genuine combined capture at `3ba2cda2`. `datesExternalMessageWire.test.mts`
exercises all 21 additions through the production metadata/evidence/claim/decision
boundaries; the page-handler tests also recover actual approve/reject replay
bodies after controlled lost replies. Counterfactuals and controlled transports
remain labelled synthetic. This is local consumer evidence, not production or
authenticated-browser acceptance; final compatible provider repinning still
belongs to the coordinated P1 release.

The closed case variant has `target_type:message`, `case_kind:prepublication`,
`queue:messages`, a real member author and `external_message` metadata containing
only `thread_id`, `revision`, `moderation_state` and `available`. Its current
`allowed_actions` can offer only `approve_content` and `reject_content`.
Unavailable but still-bound messages retain their current metadata; an unbound
target has a complete null identity/revision/state tuple. Neither grants a new
decision. Private text and immutable snapshots are absent from queue/detail and
remain behind the separately audited evidence read. Neither external target
offers live-location evidence scope or trail capture.

The decision body keeps the existing case revision; no invented target-CAS field
is sent. Core binds the original message revision/content hash inside the case.
A fresh actor, capability, case revision, target identity, current action and
unexpired own claim are checked before a new decision. The exact reasons/key and
safe message/activity/thread/author/revision baseline are saved before dispatch
in a separate per-actor/tab journal, never with message text or evidence. Closed
case recovery reuses that exact command after fresh permission/time checks and
does not require a new claim. Competing, unreadable or expired journals block
new message-case writes instead of silently discarding uncertainty.

Success requires the exact audited case/target revision transition: approval
makes the message visible with a fresh public sequence; rejection keeps the same
sequence and author-private rejected state. A receipt does not itself supply
current page authority. Unknown replies retain the original request for explicit
retry; exact no-land refusals require refreshed human review. Navigation fences
prevent late replies from repopulating another page. EN/HU identifies this as
message publication review, never approval or republication of the event.
In particular, Core's captured `dates-admin-stale-revision`409 originates from
the claimed-case check inside the receipted transaction before the target
decision. It clears only its exact journal and requires fresh human review;
the same machine name with a different status remains uncertain.

## Review of published events (D-149, T-908)

Research events that the AI verified are published without pre-moderation
(`team/handoffs/areyouin-autopublish-research.md`, D-149). The console's part is
review after publication: a "reviewed, OK" mark, an AI re-research of one event,
removal, the members' corrections queue, and why the system closed a research
intake. Nothing here enables a switch.

**Contract.** Core-B's review contract (Core
`claude/areyouin-autopub-20261102-core` c268ae4b, `docs/DATES_EXTERNAL_ADMIN_V1.md`
"The review contract selector (D-149)"). Its genuine corpus is vendored byte for
byte as `tests/fixtures/dates_external_review_wire` (77 bodies, generated at
3e151a15) and held by `tests/datesExternalReviewWire.test.mts` and the projection
census; there are no provisional bodies left. The server adds
`dates_external_admin_contract_version=2` (`lib/datesAdminContract.ts`) to the
external list, detail, update and command, to the three new routes (which refuse
a request without it), and to the intake list, the intake detail and the research
run detail (`system_closure`) - the set Core-B names as sufficient. Publication and
the place search keep their released requests. Every v2 key is optional in the
decoders, so the console also reads a Core without it.

**Reviewed mark (W1).** List rows and the detail show `admin_review`; the list
has a reviewed / not reviewed filter (`reviewed=true|false`, sent only when
chosen) and the quick view "Research, published, not reviewed"
(`channel=ai_research`, `status=published`, `reviewed=false`).
`mark_reviewed` (reason optional) and `clear_reviewed` (reason required) are
`dates_external_event_command` actions sent OUTSIDE the durable journal: they
are fenced by `expected_revision` and set a flag, so each attempt has a new key
(the `fresh` identity of `datesCommandOutcome`); the journal decoder refuses a
stored mark. A mark moves the ledger revision by one; its receipt binds the
event, activity, action, unchanged status and `admin_review`. The mark is
offered on published, rechecking and in-review events. `possible_duplicate_of`
links to the other event; `open_corrections` / `open_reports` link to the queue
and to the activity page (its moderation cases).

**Re-research (W2).** `dates_external_event_recheck` with optional instructions
(1-1000 characters, admin-only text). The receipt nests the job (`recheck`)
beside the legacy envelope's `status: 200`; the job object is the same in the
detail's `rechecks` (latest five) and in a list row's `last_recheck`. It starts a
paid job and a finished job does not stop another, so its identity is KEPT: the
exact request is saved per operator and event in session storage before it is
sent, an unanswered attempt is retried with the same key, and it is cleared only
by a receipt or a no-write refusal (`dates-recheck-open`,
`dates-research-budget-paused`, `dates-recheck-unavailable`,
`dates-recheck-instructions-invalid`, `dates-research-disabled`). Unreadable
saved evidence blocks new requests and is never cleared silently. While the
newest job is queued or running, the panel reads the detail every ten seconds
without touching the editor. Jobs show status, instructions, Core's reason in
words, cost and the change set; times are shown in the event's own zone.

**Remove (W3).** The `withdraw` command, relabelled "Remove event" /
"Esemény eltávolítása"; the header's Remove button selects it and focuses its
reason. Its journal, receipt and refusals are unchanged.

**Corrections (W4).** `/dates/corrections` lists
`dates_external_correction_list` (pending by default; review capability), row by
row: a damaged row is listed as unreadable and its neighbours stay. Only proposed
facts are shown, current beside proposed; member text is text; a purged event's
row (`current: null`) has no link or approval. "Approve and edit" opens
`/dates/external/<id>?correction=<cor_id>`:
- a fact correction prefills the editor (title, venue-local start / end - the UTC
  offset only when the wall time has exactly one - and an https website; a
  free-text place is a hint) and the save is the journaled update with
  `correction_id`; the four confirmations stay fresh;
- a `canceled` correction is approved by "Approve: record the cancellation", the
  `cancel` command with `correction_id`; a `postponed` one by "Approve: post an
  official update", the `official_update` command with `correction_id` (a known new
  date is an edit instead). Both are journal commands; their receipts end with
  `correction {correction_id, status: "approved"}`;
- an edit that changes nothing is refused with `dates-correction-no-change`; the
  console says so and points to rejecting with "already correct".
"Reject" sends `dates_external_correction_decide` with one of Core's reason codes
and a note (at most 500 graphemes, required for `other`), fenced by the
correction's state. A mark, a re-research or a decision changes the event
elsewhere: an untouched editor is read again, one with unsaved work asks for an
explicit refresh.

**Unknown facts.** An event published by research from a page that does not
state them has `organizer_name` / `organizer.name` null and `facts.is_free` null
(price text null). Core allows it only for an event from an `ai_research` intake
(credited to that channel): the decoders accept the nulls there and refuse them on
any other event. The list, the detail, the activity pages and the provenance say
"Not known" / "Nem ismert"; the editor of such an event offers "Organizer not
known" and "Free or paid: not known" and may save them back (an update only; an
unknown price needs no official link). A publication still needs both.

**System closures (W5).** `system_closure` (`{decision: research_not_publishable,
blocker}` or `{decision: duplicate, blocker: duplicate}`, null for a person's
decision) is read on intake rows, the intake detail and each research run
candidate (`lib/datesSystemClosure.ts`) and shown with the blocker in words; a
publication writer's machine code is shown as Core wrote it. The `autopublish`
help text describes the D-149 gate. An aggregator source shows its inherited
automatic publication read-only; its own override stays closed.

## Research yield: spans, ongoing and all-day events, stop details (D-149 yield)

Core's yield round (lane `claude/areyouin-research-yield-20261102`, ef10bc77;
`docs/DATES_EXTERNAL_ADMIN_V1.md` "Editor rules" and `drop_detail`). The console
binds Core's genuine bodies: `tests/fixtures/dates_external_review_wire` (90
bodies) and the research admin corpus re-pinned in
`tests/fixtures/dates_event_research_p3b_admin_wire` (204 bodies).

**Spans and ongoing events.** One rule, `datesExternalMaximumDuration`
(`lib/datesExternalInput.ts`), mirrors Core's `maximumDuration`:
- a festival or market may last 62 days and an exhibition 184; every other
  category 24 hours;
- an all-day event gets one more hour (a clock-change day);
- longer is `dates-external-duration-invalid`.

The list and detail decoders and the editor use the same rule. A festival,
market or exhibition may be ongoing: it keeps its real, past start when a
stated end is at least 24 hours away. Core judges that against its own clock,
so the console never refuses a past start itself. Core's refusal is
`dates-external-start-invalid`. Both refusals are shown in words on the
editor; a client-side over-long span is caught before sending.

**Showing time.** `lib/datesExternalSchedule.ts` and `DatesExternalWhen`
format in the event's own zone:
- a one-off event as before;
- a span longer than 25 hours as a date range;
- an all-day event without a clock time, its last day being the day before
  the exclusive end;
- a running span as "Running · until <last day>", using Core's `server_now`.

The list row carries no `all_day`, so the list shows a local
midnight-to-midnight row as all day. This is display only. The editor's
all-day box says that Core stores the event midnight to midnight and that
members on older app versions do not see it.

**Stop details.** With the external admin contract selector v2, each research
run candidate that stopped before becoming an intake carries `drop_detail`:
- stage;
- the extraction's answer and result, and the event count;
- the title match, with the extracted title;
- the validator's hard fails;
- the publication gate code;
- the fetch status.

The run detail shows it in words (`DatesResearchDropDetail`), reusing the
intake vocabularies and the closure blockers. Any code the console does not
know is shown as Core wrote it. A malformed detail, or a detail on a
candidate that became an intake, makes that candidate row unreadable.

## Research follow-ups: what the AI could not check (owner request 2026-11-03)

`/dates/research/followups` (HU "Kézi ellenőrzés", EN "Needs manual check") lists
the research candidates the AI could not check, so that the owner can look them up
in a browser and add the event by hand. Core decides which candidates they are,
from the run and intake documents, and stores only the operator's state (Core
`docs/DATES_EVENT_RESEARCH_ADMIN_V1.md`, "Research follow-ups"). The routes are
`dates_event_research_followups` (a reviewer's read) and
`dates_event_research_followup_save` (an administrator's write), behind the
research selector the bridge adds.

- One card per page: the title (and the extracted title when it differs), the
  date as found and the time the research read with its time zone, the venue,
  the city or source, the brief topic, the reason in words, the run that found
  it, how often it was seen, and the page link.
- The reason: the fetch answer ("The site refused the download (403)", "Not
  fetched (fetch budget)"), the validator's hard fails in short words ("Missing
  venue · Duration too long") or "Did not pass the publication check: <blocker>"
  (the closure vocabulary). A code the console does not know is shown as written.
- Links open in a new tab with `rel="noopener noreferrer"`: the original page
  (only an absolute http(s) URL decodes), a Google search of the title, venue and
  date, and the intake of a gate row.
- Filters (state, city, problem type) and the search are Core's; the counts beside
  them are Core's facets. Pages follow Core's cursor.
- Done, Dismiss and Reopen, with an optional note (500 characters), run through
  the research command boundary (`useResearchCommand`): a caller-minted
  idempotency key, the row's revision, the receipt bound to the key, state, note
  and next revision; a conflict rereads; an unknown outcome keeps the command and
  the note draft for the retry.
- Decoders fail closed per row (`lib/datesResearchFollowups.ts`); the bridge's
  projection names every served field (`lib/datesResearchProjection.ts`).

Evidence: `tests/datesResearchFollowups.test.mts` (Core's genuine corpus
`tests/fixtures/dates_event_research_followup_wire`, decoders, receipts, proxy
shapes, projection, EN/HU renders) and `tests/datesResearchFollowupsPage.test.mts`
(the page's reads and saves under a controlled hook scheduler).

## Evidence boundaries

Tests distinguish actual provider bytes, synthetic negative controls, production
source-handler tests with controlled I/O, and EN/HU React static rendering.
None is described as an authenticated browser or production smoke test. Full
tests, typecheck, optimized build, locale parity, dependency audit, whole authored
tree brand census and Git-free archive verification are required for the final
HEAVY handover. Lead review and final provider/consumer provenance remain release
prerequisites.

## Owner-authorized external artwork gallery

The dedicated `/api/admin/dates-external-media` bridge provides a public artwork
panel on an existing external event. Publish an intake through its normal review
flow, open the resulting event, and attach its artwork before treating the
research item as complete. The first image is featured; the external gallery is
limited to eight, independently of the member gallery's ten-image contract.

The bridge uses only the fixed Core media read, upload and command routes. Every
request checks the signed session, active Core membership and the corresponding
Dates capability; writes require same origin and the write capability. JPEG,
PNG and WebP uploads up to 10 MiB are normalized by Webadmin and independently
validated/re-encoded by Core. An operator supplies an audit reason, identifies
AI-generated or owned artwork, and confirms publication rights and safe content.
A source flyer or browser screenshot remains private intake evidence and must
never be reused as a public event image.

Image mutations use the external ledger revision and atomically advance both
ledger and activity revisions. The browser persists the original request before
dispatch. After an uncertain upload it requires the original file's SHA-256 and
reuses the same key and revision; no automatic recovery resends the upload.
A successful receipt is followed by a fresh gallery and event read. Fact edits
preserve the gallery. Held, deleted, terminal and ended events are read-only.
The last image cannot be removed; upload its replacement first.

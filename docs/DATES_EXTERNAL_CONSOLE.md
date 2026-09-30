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
comes byte-for-byte from Core `e6316dfcf248cbc91907200e727cc74fbfb1dcb1`.
Its manifest names generator/source `c1db4d13d5383f7a7495209f3cebd0fd2e501626`.
`tests/datesExternalWire.test.mts` independently pins its manifest, generator,
source checksum, complete 95-file inventory and every response byte hash.
The original 43 editor bodies are unchanged; the next 45 additions cover hostless
moderation, existing activity-detail/lifecycle adapters and settings. They use
actual routed responses, audits and completed receipts; case/report intake is
synthetic setup, not proof of member intake. This incremental capture is **not
the final P1 release pin**; final provider repinning remains required. Seven more
actual routed bodies cover the external reason catalogue, a seeded copy-only
save and replay, mixed/cohort refusals and a viewer capability refusal. Every
preceding 88-body response remains byte-identical.

The existing reason editor accepts `external_event` only for activity reasons
and only as a singleton. A stored reason cannot cross the member/external
boundary; its bilingual copy, severity, order and same-cohort entry points stay
editable. The five unreleased external seeds use canonical
`reason_activity_{wrong_details,canceled,fake_or_scam,inappropriate,duplicate}`
IDs. No released IDs are renamed. The virtual `reason_activity_external_other`
fallback is not a stored editable row. The console validates the full catalogue
and binds successful save receipts to the submitted identity, revision and
fields; malformed/unknown replies never become a successful or empty catalogue.

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
inventing snapshot consistency. Source URLs are navigation links, not permission
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

Dismissal leaves content unchanged. Moderation cancellation marks it withdrawn,
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
App Review's released 34-check/23-count closed keyset is unchanged at the initial
provider pin; no guessed keys or production fixture reset are introduced.

## Evidence boundaries

Tests distinguish actual provider bytes, synthetic negative controls, production
source-handler tests with controlled I/O, and EN/HU React static rendering.
None is described as an authenticated browser or production smoke test. Full
tests, typecheck, optimized build, locale parity, dependency audit, whole authored
tree brand census and Git-free archive verification are required for the final
HEAVY handover. Lead review and final provider/consumer provenance remain release
prerequisites.

import { OPERATIONAL_RECORD_SAFE_KEYS } from "@/lib/auditLog";
import { DATES_RESEARCH_NAMED } from "@/lib/datesResearchProjection";

/**
 * What of a Dates Core body leaves the server (lead's ruling on D-143).
 *
 * The browser never receives a raw Core body of a Dates Admin route. The
 * bridge hands it the PROJECTION of the body: the fields this console names,
 * and nothing else. A key Core adds tomorrow, or one a projection bug on
 * Core's side lets through, stops here - it is not in the response, so it
 * cannot be rendered, logged by the browser or read from its memory.
 *
 * Three kinds of key that are not named:
 * - unknown: dropped, silently. That is every additive change of Core
 *   until this console names the key.
 * - on the DENY-LIST (`DATES_ADMIN_DENIED_KEYS`): a key Core must never send
 *   to this surface (an actor's or a reporter's identity, a raw before / after
 *   block, a member's message text, an appeal's note, the AI provider behind an
 *   event ...). Dropped like any other, and reported: one warning per response
 *   and key on the server log - the route, the body family and the key's
 *   NAME, never its value - so that a leak in Core's projection is noticed
 *   instead of hidden. The page is not failed for it.
 * - none: a named key is kept as it is. The value rules stay where they were,
 *   in the decoders.
 *
 * Three parts of a body are kept WHOLE on purpose (`OPAQUE`), each bounded by
 * its own route and capability; they are listed in
 * docs/DATES_EVENT_INTAKE_CONSOLE.md and in `DATES_ADMIN_OPAQUE`.
 *
 * The trees below were generated from every genuine body of the four Dates
 * corpora and completed, where no genuine body fills a part, from the decoder
 * that reads it. `tests/datesAdminProjection.test.mts` holds them to both: the
 * projection of every genuine body is that body, unchanged.
 */

/** A scalar, or a list of scalars. An object where a scalar is named is not kept. */
const L = 1 as const;
/** Kept whole: a part that is data by design (see `DATES_ADMIN_OPAQUE`). */
const OPAQUE = "opaque" as const;
/**
 * A record Core passes through as a whole document (the activity page's
 * history panels). It is reduced to the keys that panel may show, and the
 * number of fields withheld is put beside them - the panel says "n withheld".
 */
class Summary { constructor(readonly keys: readonly string[]) {} }
/** A list is written `[element]`: one tree for every element. */
export type DatesNamedTree = typeof L | typeof OPAQUE | Summary | readonly DatesNamedTree[] | { readonly [key: string]: DatesNamedTree };

const leaves = (names: string): Record<string, typeof L> => Object.fromEntries(names.split(" ").map((name) => [name, L]));

const ENVELOPE = leaves("success status_code message status can_send server_now");
/** Core's refusal, and nothing beside it. */
const REFUSAL = leaves("success status_code error message status can_send");

// ---------------------------------------------------------------- activities

const ACTIVITY = {
  ...leaves("activity_id title activity_type lifecycle moderation_state pending_public_moderation_state time_mode start_at end_at location_mode city country_code "
    + "join_mode maximum_people going_count pending_count report_count soft_deleted revision created_at updated_at "
    // an external activity (`origin`) has an organizer and no member host
    + "origin external_event_id organizer_name organizer_url verification_tier ai_assisted can_host_transfer"),
  host: leaves("uid display_name"),
};
const EDITOR_INPUT = {
  ...leaves("title category start_at end_at timezone all_day is_free price_text age_restriction source_url attendee_list"),
  summary: leaves("hu en"), sensitive: leaves("flag reason"), venue: leaves("name formatted_address longitude latitude city country_code"),
  organizer: leaves("name website"), links: leaves("official_url ticket_url"), confirmations: leaves("source public_venue timezone content_safe"),
};
const EXTERNAL_ROW = leaves("external_event_id activity_id revision activity_revision status lifecycle moderation_state soft_deleted title category sensitive "
  + "start_at end_at start_local end_local timezone city country_code venue_name organizer_name verification_tier checked_at next_reverify_at credit_channel "
  + "going_count interested_count created_at updated_at can_edit ai_assisted");
const EXTERNAL_EVENT = {
  ...EXTERNAL_ROW,
  facts: { ...leaves("title category start_at end_at start_local end_local end_estimated all_day timezone is_free price_text age_restriction"),
    summary: leaves("hu en"), sensitive: leaves("flag reason") },
  venue: { ...leaves("place_id name formatted_address city city_key country_code resolved_by resolved_at"), point: leaves("type coordinates") },
  organizer: leaves("name website"), links: leaves("official_url ticket_url"), attendee_list: L,
  verification: { ...leaves("tier checked_at next_reverify_at"), admin_confirmations: leaves("source public_venue timezone content_safe") },
  image: leaves("kind url credit license_note"),
  sources: [leaves("kind url hostname source_id confirmed_at")],
  credit: leaves("channel submitted_by_uid anonymous first_submitter_uid"),
  editor_input: EDITOR_INPUT,
  intake: leaves("intake_id channel event_index"),
} as const;
const RECORD = new Summary(OPERATIONAL_RECORD_SAFE_KEYS);

// ---------------------------------------------------------------- moderation

const CASE = {
  ...leaves("case_id queue case_kind target_type target_id target_uid activity_id status severity escalated distinct_reporter_count report_count assignee_email "
    + "claimed_at claim_expires_at sla_due_at sla_breached revision created_at updated_at conflict_of_interest allowed_actions "
    + "external_revision external_status external_target_available"),
  capabilities: leaves("can_claim can_read_evidence can_resolve can_break_glass"),
  external_message: leaves("thread_id revision moderation_state available"),
};
const COMMAND_RECEIPT = leaves("case_id revision audit_id idempotency_replayed");
const TARGET_STATE = leaves("moderation_state revision sequence event_status activity_revision lifecycle soft_deleted");
const REASON = leaves("reason_id scope key name_en name_hu explanation_en explanation_hu active order severity comment_required entry_points escalation_category "
  + "system_owned catalog_version revision updated_at");

// ---------------------------------------------------------------- intake

const INTAKE_ROW = {
  ...leaves("intake_id revision channel status status_detail input_kind source_host image_count provider event_count published_count first_title earliest_start_at "
    + "hard_fails warning_count dedupe_decision decision_action created_at updated_at second_look research_run_id"),
  lease: leaves("holder until active mine"),
};
const EVIDENCE = leaves("quoted verified denotes match source quote model_confidence confidence");
const INTAKE_EVENT = {
  ...leaves("index published_external_event_id"),
  draft: { ...leaves("title summary_hu summary_en category sensitive sensitive_reason date_text_verbatim starts_local ends_local start_time_stated all_day year_inferred "
    + "attendance_mode organizer_name price_text is_free age_restriction status_signal"), venue: leaves("name address_text city country_code is_public_venue") },
  validation: {
    ...leaves("hard_fails warnings needs_more_info tier auto_publishable auto_blockers needs_public_venue_confirmation venue_similarity"),
    checks: { ...leaves("weekday_match venue_resolved public_place tz_from_venue urls_from_evidence quotes_verified content_safe"), witness: leaves("present date time venue") },
    schedule: leaves("timezone start_local end_local start_at end_at end_estimated all_day"),
    links: { ...leaves("official_url ticket_url organizer_url"), dropped: [leaves("field reason")] },
    venue: leaves("place_id name formatted_address latitude longitude city country_code timezone website_domain business_status"),
    venue_candidates: [leaves("place_id name formatted_address latitude longitude city country_code timezone similarity public_venue_warning")],
  },
  // Keyed by the evidence field (a closed vocabulary of the manifest).
  field_evidence: { title: EVIDENCE, date: EVIDENCE, time: EVIDENCE, venue: EVIDENCE, organizer: EVIDENCE, price: EVIDENCE, status: EVIDENCE },
  dedupe: { decision: L, candidates: [leaves("kind id similarity verdict")] },
  editor_input: EDITOR_INPUT,
};
/** The member's side: the nine keys the contract serves a reviewer. */
const MEMBER = {
  ...leaves("submitter_uid anonymous auto_going consent_version can_ask"),
  confirmation: leaves("state at due_at asked_by_reviewer fields note"),
  corrections: [leaves("index field from to")],
  re_review: { ...leaves("requested_at note decided_at"), first_decision: leaves("by at action reason_code") },
  standing: leaves("strikes strike_limit banned_until"),
};
const INTAKE_RECEIPT = leaves("intake_id revision status");
const STATEMENT = leaves("en hu");

/** The named fields of each Dates Admin route's success body. A route that is not here has no body the browser may see. */
export const DATES_ADMIN_NAMED: Readonly<Record<string, DatesNamedTree>> = {
  ...DATES_RESEARCH_NAMED,
  dates_activity_list: { ...ENVELOPE, ...leaves("page limit total"), activities: [ACTIVITY] },
  dates_activity_detail: {
    ...ENVELOPE,
    ...leaves("memberships_truncated chats_truncated reports_truncated report_count notifications_truncated notification_count"),
    activity: { ...ACTIVITY, ...leaves("details timezone auto_end_at tbd_expires_at live_sharing_state purge_eligible_at"),
      photo: OPAQUE, audience: OPAQUE, pending_public_revision: OPAQUE },
    location: { ...leaves("mode city country_code exact_location_redacted exact_location_route"), public_location: leaves("type coordinates") },
    memberships: [leaves("uid relationship live_access updated_at")],
    chat: leaves("thread_id read_only message_count pinned_message_id"),
    chats: [leaves("thread_id kind read_only closed_at member_count message_count pinned_message_id updated_at")],
    moderation_cases: [leaves("case_id queue status case_kind severity created_at")],
    // Core passes these through as whole documents; each is reduced to what the history panel may show.
    reports: [RECORD], notifications: [RECORD], moderation_decisions: [RECORD], audit_history: [RECORD],
    external_event: EXTERNAL_EVENT,
  },
  // Break-glass: the exact location, to an operator with the capability, per case, audited by Core.
  dates_activity_location: { ...ENVELOPE, private_location: OPAQUE },
  // T-891: the command receipts, named from Core's genuine bodies (tests/fixtures/dates_admin_command_wire).
  dates_activity_update: { ...ENVELOPE, ...leaves("activity_id revision moderation_state audit_id idempotency_replayed") },
  // `activity_revision` is served with the command contract selector (lib/datesAdminContract.ts).
  dates_activity_host_transfer: { ...ENVELOPE,
    ...leaves("transfer_id activity_id outgoing_host_uid target_uid transfer_status expires_at revision activity_revision audit_id idempotency_replayed") },
  dates_activity_type_save: { ...ENVELOPE, ...leaves("revision audit_id idempotency_replayed"),
    activity_type: leaves("key name_en name_hu order active revision system_owned deletable updated_at") },
  dates_reason_deactivate: { ...ENVELOPE, ...leaves("reason_id active revision referenced_report_count hard_delete_allowed audit_id idempotency_replayed") },
  // The saved setting is echoed; its value is data, like every setting's value.
  dates_configuration_save: { ...ENVELOPE, ...leaves("audit_id idempotency_replayed"), setting: { ...leaves("key revision"), value: OPAQUE } },
  dates_activity_command: { ...ENVELOPE,
    ...leaves("external_event_id activity_id revision activity_revision action event_status lifecycle soft_deleted external_revision audit_id idempotency_replayed purged") },
  dates_configuration: {
    ...ENVELOPE, known_limitation: L,
    // Served with the selector: the version of the suggestion terms a member must accept, and where its text stands.
    event_suggestion_consent: leaves("required_version text_status"),
    settings: [{ ...leaves("key type effective_scope minimum maximum system_owned deletable valid revision updated_at"),
      // A setting's value is data: the editor shows it and sends it back.
      value: OPAQUE, effective_value: OPAQUE, default_value: OPAQUE, allowed_values: OPAQUE,
      effective_by_storefront: [leaves("storefront effective_value")] }],
    activity_types: [leaves("key name_en name_hu order active revision system_owned deletable updated_at")],
  },
  dates_moderation_queue: { ...ENVELOPE, ...leaves("page limit total"), cases: [CASE] },
  dates_moderation_detail: {
    ...ENVELOPE, ...leaves("report_notes_withheld internal_notes_withheld evidence_requires_separate_audited_read"),
    case: CASE,
    reports: [{ ...leaves("report_id reason_id reason_key entry_point note severity status created_at reporter_identity_redacted"), reason_label_snapshot: leaves("locale label en hu") }],
    decisions: [{ ...leaves("decision_id case_id target_type target_id activity_id target_path action severity created_at expires_at appeal_outcome appeal_resolved_at"),
      user_visible_reason: STATEMENT }],
    appeal: { ...leaves("appeal_id case_id decision_id original_case_id target_type target_id status resolution created_at updated_at resolved_at"), user_visible_reason: STATEMENT },
    internal_notes: [leaves("note_id author_email text created_at")],
  },
  dates_moderation_evidence: {
    ...ENVELOPE, ...leaves("case_id redacted_sensitive_location_count break_glass_used audit_id"),
    // Core serves a row whole (minus `_id`); these are every key its evidence writers can put on one - on Core main, the
    // P2 branch and the T-891 branch alike: the inserts, a legal hold placed (`legal_basis`, `hold_updated_at`) and
    // released (`hold_released_at`, `hold_release_reason`, `hold_release_legal_basis`, `purge_at`), an automatic hold
    // closed (`automatic_hold_closed_at`), a restricted trail snapshot or an erased account (`restricted_access`).
    evidence: [{ ...leaves("evidence_id case_id report_id evidence_type sensitive_location target_revision immutable legal_hold hold_started_at hold_reason review_at created_at activity_id"),
      ...leaves("legal_basis hold_updated_at hold_released_at hold_release_reason hold_release_legal_basis automatic_hold_closed_at restricted_access"),
      // The snapshot IS the evidence: served only by this separately authorised, audited read.
      snapshot: OPAQUE,
      // A MongoDB date, which Core's JSON encoding serves as an extended-JSON object ({"$date": ...}): passed as served.
      purge_at: OPAQUE }],
    appeal_note: leaves("appeal_id note created_at"),
  },
  // `revision` and `existing` are served with the command contract selector (T-891).
  dates_moderation_trail_evidence: { ...ENVELOPE,
    ...leaves("case_id activity_id evidence_id captured_from captured_to point_count audit_id break_glass_used revision existing idempotency_replayed") },
  dates_moderation_claim: { ...ENVELOPE, ...COMMAND_RECEIPT, ...leaves("case_status assignee_email claim_expires_at break_glass_used") },
  dates_moderation_heartbeat: { ...ENVELOPE, ...COMMAND_RECEIPT, ...leaves("case_status claim_expires_at") },
  dates_moderation_release: { ...ENVELOPE, ...COMMAND_RECEIPT, ...leaves("case_status claim_expires_at") },
  dates_moderation_note: { ...ENVELOPE, ...COMMAND_RECEIPT, note_id: L },
  dates_moderation_escalate: { ...ENVELOPE, ...COMMAND_RECEIPT, ...leaves("escalated severity") },
  dates_moderation_resolve: {
    ...ENVELOPE, ...COMMAND_RECEIPT, ...leaves("case_status action decision_id break_glass_used"),
    target_result: { ...leaves("target_type target_id subject_uid activity_id target_path"), before: TARGET_STATE, after: TARGET_STATE },
  },
  // `revision`, `hold_change` and `evidence_changed_count` are served to a request that carries `expected_revision` (T-891).
  dates_moderation_legal_hold: { ...ENVELOPE,
    ...leaves("case_id legal_hold review_at evidence_count audit_id idempotency_replayed revision hold_change evidence_changed_count") },
  dates_moderation_sla: {
    ...ENVELOPE, ...leaves("open_count unassigned_count sla_breach_count oldest_unassigned_at median_seconds_to_claim median_seconds_to_resolve appeals_waiting"),
    age_buckets: leaves("under_1h 1h_to_6h 6h_to_24h over_24h"),
  },
  dates_reason_list: { ...ENVELOPE, catalog_version: L, reasons: [REASON] },
  dates_reason_save: { ...ENVELOPE, ...leaves("revision audit_id idempotency_replayed"), reason: REASON },
  dates_external_event_list: { ...ENVELOPE, ...leaves("page limit total capabilities"), events: [EXTERNAL_ROW] },
  dates_external_event_detail: { ...ENVELOPE, capabilities: L, event: EXTERNAL_EVENT },
  dates_external_event_place_search: {
    ...ENVELOPE, ...leaves("manual_entry provider attribution available unavailable_reason"),
    places: [{ ...leaves("place_id name formatted_address latitude longitude city country_code timezone public_venue_warning"), attributions: [leaves("provider uri")] }],
  },
  dates_external_event_publish: { ...ENVELOPE, ...leaves("replayed external_event_id revision activity_id activity_revision event_status audit_id") },
  dates_external_event_update: { ...ENVELOPE, ...leaves("replayed external_event_id revision activity_id activity_revision event_status audit_id") },
  dates_external_event_command: { ...ENVELOPE,
    ...leaves("replayed external_event_id activity_id revision activity_revision action event_status lifecycle soft_deleted audit_id thread_id message_id message_sequence") },
  dates_event_intake_list: {
    ...ENVELOPE, ...leaves("page limit total drafts_enabled suggestions_enabled second_look_count capabilities"), intakes: [INTAKE_ROW],
    // Keyed by status (a closed vocabulary of the manifest).
    status_counts: leaves("received screening extracting validating member_confirming in_review published merged rejected duplicate failed withdrawn expired awaiting_budget"),
  },
  dates_event_intake_detail: {
    ...ENVELOPE, capabilities: L,
    intake: {
      ...INTAKE_ROW,
      ...leaves("admin_principal result result_note prohibited_category prompt_injection_suspected validated_at budget_waiting_since images_delete_after retention_until content_purged_at"),
      inputs: { ...leaves("kind url text locale"), images: [{ ...leaves("index ready width height bytes"), safe_search: leaves("adult violence") }] },
      fetch: leaves("final_url http_status truncated fetched_at"),
      source_texts: [leaves("label text truncated")],
      events: [INTAKE_EVENT],
      ai_runs: [leaves("provider task model outcome input_tokens output_tokens cost_micro_usd cost_estimated at")],
      decision: { ...leaves("by at action reason_code"), statement: STATEMENT },
      duplicate_of: leaves("kind id"),
      member: MEMBER,
    },
  },
  dates_event_intake_usage: {
    ...ENVELOPE, ...leaves("drafts_enabled capabilities"),
    usage: { ...leaves("month cap_usd spent_micro_usd reserved_micro_usd remaining_micro_usd calls alert alert_at exhausted"),
      rows: [leaves("provider model task channel calls unanswered_calls input_tokens output_tokens cache_read_tokens cache_write_tokens reasoning_tokens cost_micro_usd estimated_cost_calls ambiguous_calls")],
      // D-145: the calls whose cost is not known, booked at their whole reservation, and the newest of them listed.
      ...leaves("ambiguous_calls ambiguous_micro_usd"),
      ambiguous_runs: [leaves("provider model task channel source failure booked_micro_usd at")] },
  },
  dates_event_intake_create: { ...ENVELOPE, ...leaves("replayed existing audit_id"), intake: INTAKE_RECEIPT },
  dates_event_intake_lease: { ...ENVELOPE, audit_id: L, intake: { ...INTAKE_RECEIPT, lease: leaves("holder until active mine") } },
  dates_event_intake_reject: { ...ENVELOPE, ...leaves("replayed audit_id"), intake: INTAKE_RECEIPT, decision: { ...leaves("action reason_code"), statement: STATEMENT } },
  dates_event_intake_ask_member: { ...ENVELOPE, ...leaves("replayed audit_id"), intake: INTAKE_RECEIPT, asked: leaves("fields due_at") },
  dates_event_intake_publish: { ...ENVELOPE, ...leaves("replayed external_event_id revision activity_id activity_revision event_status audit_id"),
    intake: { ...INTAKE_RECEIPT, published_count: L } },
};

/**
 * The parts kept whole, by route: each is data by design, and each is bounded
 * by its own route, capability and (for the two private reads) Core's audit.
 */
export const DATES_ADMIN_OPAQUE: Readonly<Record<string, readonly string[]>> = {
  // The exact location of one activity: the break-glass read, per case and reason, audited by Core.
  dates_activity_location: ["private_location"],
  // The evidence snapshots of one case: the separately authorised, audited evidence read.
  dates_moderation_evidence: ["evidence[].snapshot", "evidence[].purge_at"],
  // What the activity editor shows and sends back unchanged (an activity's own public data).
  dates_activity_detail: ["activity.photo", "activity.audience", "activity.pending_public_revision"],
  // A setting's values: the editors show them and send them back.
  dates_configuration: ["settings[].value", "settings[].effective_value", "settings[].default_value", "settings[].allowed_values"],
  dates_configuration_save: ["setting.value"],
};

/**
 * A maintained contract with Core: a key it must never send to this surface.
 * `family` is what the warning calls the body. A path names a key from the
 * top of the body; `[]` stands for every element of a list.
 */
export const DATES_ADMIN_DENIED_KEYS: Readonly<Record<string, { family: string; keys: readonly string[] }>> = {
  dates_moderation_queue: { family: "moderation-queue", keys: [
    // A queue row is metadata: never a note, never the reported content, never who reported.
    "cases[].internal_notes", "cases[].text", "cases[].message_text", "cases[].snapshot", "cases[].target_content_hash", "cases[].reporter_uid", "cases[].reporter_uids",
    "cases[].external_message.text", "cases[].external_message.snapshot", "cases[].external_message.target_content_hash"] },
  dates_moderation_detail: { family: "moderation-case", keys: [
    "case.text", "case.message_text", "case.snapshot", "case.target_content_hash", "case.reporter_uid", "case.reporter_uids",
    "case.external_message.text", "case.external_message.snapshot", "case.external_message.target_content_hash",
    // A decision row: Core stores the acting moderator, the sanctioned member and the raw before / after beside what it serves.
    "decisions[].before", "decisions[].after", "decisions[].actor_email", "decisions[].subject_uid", "decisions[].text",
    // A report: the reporter is redacted. The appeal: its note is served only by the audited evidence read.
    "reports[].reporter_uid", "reports[].reporter_email", "appeal.note", "appeal.appellant_uid"] },
  dates_moderation_evidence: { family: "moderation-evidence", keys: ["appeal_note.appellant_uid"] },
  dates_moderation_resolve: { family: "moderation-decision-receipt", keys: ["target_result.text", "target_result.before.text", "target_result.after.text"] },
  dates_external_event_list: { family: "external-event-list", keys: ["events[]._id", "events[].host", "events[].submitted_by_uid"] },
  dates_external_event_detail: { family: "external-event", keys: [
    // The reference to the intake: never the AI provider behind the draft, never a person.
    "event._id", "event.host", "event.intake.provider", "event.intake.admin_principal", "event.intake.submitter_uid"] },
  dates_activity_detail: { family: "activity", keys: [
    "external_event._id", "external_event.host", "external_event.intake.provider", "external_event.intake.admin_principal", "external_event.intake.submitter_uid"] },
  dates_external_event_place_search: { family: "place-search", keys: ["places[].raw_provider"] },
  dates_event_intake_list: { family: "intake-queue", keys: [
    // A queue row names no member and carries nothing of the submission's content.
    "intakes[].submitter_uid", "intakes[].member", "intakes[].admin_principal", "intakes[].source_texts", "intakes[].inputs"] },
  dates_event_intake_detail: { family: "intake", keys: [
    // Of a member only what the `member` block serves; never the stored consent record, the origin hint or a storage key.
    "intake.submitter_uid", "intake.consent", "intake.input_fingerprint", "intake.open_claim", "intake.structured_events", "intake.processing", "intake.notify",
    "intake.inputs.origin_hint", "intake.inputs.url_hash", "intake.inputs.url_hashes", "intake.inputs.images[].storage_key", "intake.inputs.images[].sha256",
    "intake.member.email", "intake.member.phone", "intake.member.name", "intake.member.display_name",
    // An AI run is usage metadata: never what was asked of the model or what it answered.
    "intake.ai_runs[].prompt", "intake.ai_runs[].response", "intake.ai_runs[].request", "intake.ai_runs[].raw"] },
};

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
const DROP = Symbol("drop");

function project(value: unknown, tree: DatesNamedTree, path: string, denied: ReadonlySet<string>, hits: Map<string, number>): unknown {
  if (tree === OPAQUE) return value;
  if (tree === L) return scalar(value) || (Array.isArray(value) && value.every(scalar)) ? value : DROP;
  if (tree instanceof Summary) {
    if (!plain(value)) return scalar(value) ? value : DROP;
    // The safe keys with a scalar value; everything else is counted, not sent (a nested value under a safe key too).
    const kept: Record<string, unknown> = {};
    let withheld = 0;
    for (const [key, item] of Object.entries(value)) {
      if (tree.keys.includes(key) && scalar(item)) kept[key] = item; else withheld++;
    }
    return { ...kept, withheld_fields: withheld };
  }
  if (Array.isArray(tree)) {
    if (!Array.isArray(value)) return scalar(value) ? value : DROP;
    const element = (tree as readonly DatesNamedTree[])[0];
    return value.map((item) => { const kept = project(item, element, `${path}[]`, denied, hits); return kept === DROP ? null : kept; });
  }
  // Named keys of an object. A scalar in its place carries no key and is left to the decoder; a list is not an object.
  if (!plain(value)) return scalar(value) ? value : DROP;
  const named = tree as { readonly [key: string]: DatesNamedTree }, out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const at = path === "" ? key : `${path}.${key}`;
    if (!Object.hasOwn(named, key)) {
      if (denied.has(at)) hits.set(at, (hits.get(at) ?? 0) + 1);
      continue;
    }
    const kept = project(item, named[key], at, denied, hits);
    if (kept !== DROP) out[key] = kept;
  }
  return out;
}

/**
 * The body the browser receives for a Dates Admin route, or `undefined` when
 * the route has no named body (the bridge then answers with its own error).
 * A refusal - anything that does not say `success: true` - is Core's six
 * refusal keys and nothing else. `warn` is given one line per denied key.
 */
export function projectDatesAdminBody(action: string, body: unknown, warn: (line: string) => void = () => undefined): unknown {
  if (!plain(body)) return body === null ? null : undefined;
  if (body.success !== true) return project(body, REFUSAL, "", new Set(), new Map());
  if (!Object.hasOwn(DATES_ADMIN_NAMED, action)) return undefined;
  const contract = Object.hasOwn(DATES_ADMIN_DENIED_KEYS, action) ? DATES_ADMIN_DENIED_KEYS[action] : null;
  const hits = new Map<string, number>();
  const projected = project(body, DATES_ADMIN_NAMED[action], "", new Set(contract?.keys ?? []), hits);
  // The key's NAME and how often it came - never a value.
  for (const [key, count] of hits) warn(`webadmin.dates_denied_key route=${action} family=${contract!.family} key=${key} count=${count}`);
  return projected;
}

/**
 * What the bridge sends to the browser. A denied key is written to the
 * console's server log here - in the form its other server-side warnings
 * have, `webadmin.<event> key=value ...` - so that the route handlers
 * themselves stay free of logging (a released test holds the bridge to that:
 * nothing of a Core body may reach a log from there). The line is built by
 * `projectDatesAdminBody` from the route, the family and the key's name only.
 */
export function projectDatesAdminResponse(action: string, body: unknown): unknown {
  return projectDatesAdminBody(action, body, (line) => console.warn(line));
}

/** Whether a route's bodies go through the projection: every Dates Admin route of Core. */
export function isDatesAdminRoute(action: string): boolean {
  return /^dates_[a-z0-9_]+$/.test(action);
}

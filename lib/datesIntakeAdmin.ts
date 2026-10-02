import { datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import {
  DATES_EXTERNAL_CATEGORIES, DATES_EXTERNAL_FRESH_CONFIRMATIONS, datesExternalTimeToInput,
  normalizeDatesExternalManualEvent, type DatesExternalCategory, type DatesExternalDraft,
} from "@/lib/datesExternalInput";

/**
 * T-865 P2a: the AI-assisted event intake ("Beküldések"), contract
 * `dates-event-intake-admin-v1`.
 *
 * Decoder rules (lessons of P1):
 * - closed about the VOCABULARIES Core publishes in the corpus manifest, each
 *   with a fallback; bound on FIELDS, never on an exact key set (D-143): a
 *   key this console does not know is tolerated in every body and part;
 * - never stricter than Core on a value Core can store: free text is a string,
 *   numbers are numbers, an identifier Core does not declare closed stays open;
 * - a list degrades PER ROW: an unreadable display field marks the row, an
 *   invalid identity, revision or lease removes its controls, and the rest of
 *   the page still renders;
 * - a value Core recomputes (counts, unions, derived booleans, clocks) never
 *   fails a page;
 * - a mutation receipt is bound to its request on what identifies the command
 *   (success, the intake, the revision the command leaves, the outcome where
 *   Core echoes it, an audit id of the right shape) and tolerates any other
 *   key: no exact-key-set check.
 */
export const DATES_INTAKE_PROXY_ACTIONS = [
  "dates_event_intake_list", "dates_event_intake_detail", "dates_event_intake_lease",
  "dates_event_intake_reject", "dates_event_intake_publish", "dates_event_intake_usage",
  // T-886: a reviewer sends a member's draft back to the member, once.
  "dates_event_intake_ask_member",
] as const;
export type DatesIntakeProxyAction = typeof DATES_INTAKE_PROXY_ACTIONS[number];

// The closed vocabularies of the wire, exactly as the corpus manifest publishes
// them (`vocabularies`); `tests/datesIntakeWire.test.mts` compares them.
export const DATES_INTAKE_STATUSES = ["received", "screening", "extracting", "validating", "member_confirming", "in_review", "published",
  "merged", "rejected", "duplicate", "failed", "withdrawn", "expired", "awaiting_budget"] as const;
export const DATES_INTAKE_STATUS_DETAILS = ["image-empty", "image-unreadable", "image-too-large", "image-dimensions", "image-encode-failed",
  "image-content-rejected", "screening-unavailable", "image-missing", "source-not-readable", "source-not-fetchable", "source-unreachable",
  "source-not-text", "source-too-large", "source-empty", "not-an-event", "prohibited-category", "ai-unavailable", "ai-refused",
  "ai-not-configured", "ai-budget-overrun", "venue-search-unavailable", "duplicate-source", "duplicate-event", "start-passed", "storage-unavailable",
  "attempts-exhausted", "account-erased"] as const;
export const DATES_INTAKE_CHANNELS = ["admin_draft", "member_suggestion", "ai_research"] as const;
/** The channels that have a writer today, offered as the queue's filter (the research channel is P3). */
export const DATES_INTAKE_QUEUE_CHANNELS = ["admin_draft", "member_suggestion"] as const;
export const DATES_INTAKE_INPUT_KINDS = ["url", "images", "text"] as const;
export const DATES_INTAKE_DECISION_ACTIONS = ["published", "rejected", "duplicate", "merged", "expired", "screening_rejected", "extraction_rejected",
  "withdrawn"] as const;
export const DATES_INTAKE_REJECT_REASONS = ["not_an_event", "date_unclear_or_past", "private_event", "duplicate", "prohibited_content",
  "unverifiable", "outside_area", "sensitive_not_allowed", "spam_or_fake"] as const;
export const DATES_INTAKE_LEASE_ACTIONS = ["claim", "heartbeat", "release"] as const;
export const DATES_INTAKE_RESULTS = ["event", "multiple_events", "not_an_event", "insufficient_information", "prohibited"] as const;
export const DATES_INTAKE_HARD_FAILS = ["not_an_event", "prohibited_category", "insufficient_information", "title_missing", "start_missing",
  "time_missing", "midnight_unconfirmed", "relative_date_unconfirmed", "local_time_nonexistent", "local_time_ambiguous", "start_in_past",
  "start_beyond_lookahead", "end_not_after_start", "duration_too_long", "weekday_mismatch", "online_only", "venue_not_public",
  "venue_unresolved", "venue_ambiguous", "venue_country_unavailable", "timezone_unknown"] as const;
export const DATES_INTAKE_WARNINGS = ["prompt_injection_suspected", "fallback_provider", "year_inferred", "start_at_midnight", "start_is_doors_time",
  "end_estimated", "date_ambiguous", "multiple_dates", "low_confidence_date", "low_confidence_time", "low_confidence_venue",
  "date_quote_unverified", "time_quote_unverified", "quotes_unverified", "witness_disagrees_date", "witness_disagrees_time",
  "witness_disagrees_venue", "venue_similarity_low", "possible_private_address", "venue_search_unavailable", "venue_unbounded",
  "venue_unclear", "city_missing", "possibly_private", "possibly_online", "official_url_dropped", "ticket_url_dropped",
  "organizer_url_dropped", "paid_without_official_link", "organizer_missing", "price_unclear", "sensitive", "status_canceled",
  "status_postponed", "status_sold_out", "low_legibility", "language_uncertain", "conflicting_information", "content_unscreened",
  "member_corrected"] as const;
export const DATES_INTAKE_AUTO_BLOCKERS = ["no_hard_fail", "warnings_benign", "primary_provider", "quotes_verified", "time_explicit", "confident",
  "venue_place_matches", "timezone_known", "country_available", "content_screened"] as const;
export const DATES_INTAKE_TIERS = ["official", "single_source"] as const;
export const DATES_INTAKE_WITNESS_VERDICTS = ["agrees", "disagrees", "absent"] as const;
export const DATES_INTAKE_EVIDENCE_FIELDS = ["title", "date", "time", "venue", "organizer", "price", "status"] as const;
export const DATES_INTAKE_EVIDENCE_MATCHES = ["exact", "loose"] as const;
export const DATES_INTAKE_DEDUPE_DECISIONS = ["new", "review", "duplicate"] as const;
export const DATES_INTAKE_DEDUPE_VERDICTS = ["duplicate", "review"] as const;
export const DATES_INTAKE_DEDUPE_KINDS = ["event", "intake"] as const;
export const DATES_INTAKE_LINK_DROP_REASONS = ["not_in_sources", "not_https", "domain_not_allowed"] as const;
export const DATES_AI_PROVIDERS = ["openai", "gemini", "anthropic"] as const;
export const DATES_AI_OUTCOMES = ["sheet", "verdict", "refused", "unavailable", "truncated", "invalid_output", "not_configured"] as const;
export const DATES_SAFE_SEARCH_LIKELIHOODS = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"] as const;
/** Where a member's look at their own draft stands (member channel). */
export const DATES_INTAKE_MEMBER_CONFIRMATION_STATES = ["awaiting", "confirmed", "corrected", "unchecked", "unanswered"] as const;
/** The fields of a draft a member may correct, and a reviewer may ask about. */
export const DATES_INTAKE_MEMBER_EDITABLE_FIELDS = ["title", "starts_local", "ends_local", "venue_name", "venue_address", "venue_city", "price_text",
  "is_free"] as const;
/** The statuses in which an intake is still open (Core: every status that is not terminal). */
export const DATES_INTAKE_OPEN_STATUSES = ["received", "screening", "extracting", "validating", "member_confirming", "in_review", "awaiting_budget"] as const;

/** Manifest vocabulary name => the console's list; the pin test walks this map. */
export const DATES_INTAKE_VOCABULARIES = {
  status: DATES_INTAKE_STATUSES, status_detail: DATES_INTAKE_STATUS_DETAILS, channel: DATES_INTAKE_CHANNELS,
  input_kind: DATES_INTAKE_INPUT_KINDS, decision_action: DATES_INTAKE_DECISION_ACTIONS, reject_reason: DATES_INTAKE_REJECT_REASONS,
  lease_action: DATES_INTAKE_LEASE_ACTIONS, result: DATES_INTAKE_RESULTS, hard_fail: DATES_INTAKE_HARD_FAILS, warning: DATES_INTAKE_WARNINGS,
  auto_blocker: DATES_INTAKE_AUTO_BLOCKERS, tier: DATES_INTAKE_TIERS, witness_verdict: DATES_INTAKE_WITNESS_VERDICTS,
  evidence_field: DATES_INTAKE_EVIDENCE_FIELDS, evidence_match: DATES_INTAKE_EVIDENCE_MATCHES, dedupe_decision: DATES_INTAKE_DEDUPE_DECISIONS,
  dedupe_verdict: DATES_INTAKE_DEDUPE_VERDICTS, dedupe_candidate_kind: DATES_INTAKE_DEDUPE_KINDS, category: DATES_EXTERNAL_CATEGORIES,
  link_drop_reason: DATES_INTAKE_LINK_DROP_REASONS, provider: DATES_AI_PROVIDERS, ai_outcome: DATES_AI_OUTCOMES,
  safe_search_likelihood: DATES_SAFE_SEARCH_LIKELIHOODS, member_confirmation_state: DATES_INTAKE_MEMBER_CONFIRMATION_STATES,
  member_editable_field: DATES_INTAKE_MEMBER_EDITABLE_FIELDS,
} as const;

/**
 * Values Core's schema knows but its wire contract does not declare closed
 * (they are not in the manifest). The console translates the ones it knows
 * and shows any other value as Core wrote it.
 */
export const DATES_INTAKE_KNOWN_ATTENDANCE_MODES = ["in_person", "online", "hybrid", "unknown"] as const;
export const DATES_INTAKE_KNOWN_STATUS_SIGNALS = ["scheduled", "canceled", "postponed", "sold_out", "unknown"] as const;
export const DATES_INTAKE_KNOWN_PROHIBITED_CATEGORIES = ["sexual_services", "weapons", "drugs", "gambling_promotion", "hate",
  "mlm_or_business_opportunity", "crypto_seminar", "private_party", "other"] as const;
export const DATES_INTAKE_KNOWN_TASKS = ["flyer_extract", "url_extract", "text_extract", "same_event"] as const;
export const DATES_INTAKE_KNOWN_LINK_FIELDS = ["official_url", "ticket_url", "organizer_url"] as const;

/** Core's limits on what an operator submits (DatesEventIntakePolicy / EventImageNormalizer). */
export const DATES_INTAKE_MAX_IMAGES = 2;
export const DATES_INTAKE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DATES_INTAKE_MAX_TEXT_GRAPHEMES = 500;
export const DATES_INTAKE_MAX_URL_LENGTH = 2048;
/** Core keeps a review lease for five minutes; the console renews it well inside that. */
export const DATES_INTAKE_LEASE_SECONDS = 300;
export const DATES_INTAKE_HEARTBEAT_SECONDS = 120;

type Guard<T> = (value: unknown) => value is T;
type Parsed<G> = G extends Guard<infer U> ? U : never;
type Shape = Record<string, Guard<unknown>>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bool: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
const literal = <T extends string | number | boolean | null>(expected: T): Guard<T> => (value): value is T => value === expected;
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Guard<number> => (value): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const number: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value);
/** Free text as Core serves it: any string; the cap only bounds what a page will hold. */
const string = (maximum = 64_000): Guard<string> => (value): value is string => typeof value === "string" && value.length <= maximum;
const oneOf = <T extends readonly string[]>(values: T): Guard<T[number]> => (value): value is T[number] =>
  typeof value === "string" && values.includes(value);
const nullable = <T>(guard: Guard<T>): Guard<T | null> => (value): value is T | null => value === null || guard(value);
const id = (prefix: string): Guard<string> => {
  const pattern = new RegExp(`^${prefix}_[a-f0-9]{32}$`);
  return (value): value is string => typeof value === "string" && pattern.test(value);
};
/**
 * Every body of Core - a read, a part of one, a receipt - is bound on its
 * fields: the named keys must be there and valid, and a key this console does
 * not know is tolerated (D-143). No decoder checks an exact key set. Closed
 * VOCABULARIES stay closed, each with its fallback (the part or the row is
 * said to be unreadable).
 */
const bound = <S extends Shape>(shape: S): Guard<{ [K in keyof S]: Parsed<S[K]> }> => {
  const keys = Object.keys(shape);
  return (value): value is { [K in keyof S]: Parsed<S[K]> } => record(value) && keys.every((key) => Object.hasOwn(value, key) && shape[key](value[key]));
};
const list = <T>(guard: Guard<T>, maximum: number): Guard<T[]> => (value): value is T[] =>
  Array.isArray(value) && value.length <= maximum && value.every(guard);
const capabilities: Guard<string[]> = (value): value is string[] => Array.isArray(value) && value.length <= 100
  && value.every((item) => typeof item === "string" && /^dates_[a-z0-9_]{1,90}$/.test(item)) && new Set(value).size === value.length;
/** Core answers with whole seconds; zero and far-future values are shown, not judged. */
const clock = integer(0);
const envelope = { success: literal(true), status_code: literal(200), message: literal(200), status: literal(200), can_send: literal(0), server_now: integer(1) };

export const datesIntakeId = id("xin");
const externalEventId = id("xev");
/** The id of an external event, as Core writes it. */
export const datesExternalEventId = externalEventId;
const auditId = id("aud");

/** A list whose items are read one by one: a damaged item is named, never fatal. */
export type DatesIntakeRows<T> = { items: T[]; unreadable: number[] };
function rows<T>(value: unknown, guard: Guard<T>, maximum: number): DatesIntakeRows<T> | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const items: T[] = [], unreadable: number[] = [];
  value.forEach((item, index) => { if (guard(item)) items.push(item); else unreadable.push(index); });
  return { items, unreadable };
}

// ---------------------------------------------------------------- lease

const LEASE = { holder: nullable(string(320)), until: integer(0), active: bool, mine: bool };
const leaseShape = bound(LEASE);
export type DatesIntakeLease = Parsed<typeof leaseShape>;
const leaseCoherent = (value: DatesIntakeLease) => value.active === (value.holder !== null) && (value.active || value.until === 0) && (!value.mine || value.active);
/** Core's own coherence rule for a projected lease (contract `lease coherence`). */
export const datesIntakeLease: Guard<DatesIntakeLease> = (value): value is DatesIntakeLease => leaseShape(value) && leaseCoherent(value);
/** The lease as a receipt echoes it: the same four facts, any other key tolerated. What they must say is the action's (below). */
const receiptLease: Guard<DatesIntakeLease> = bound(LEASE);

// ---------------------------------------------------------------- queue row

export type DatesIntakeStatus = typeof DATES_INTAKE_STATUSES[number];
type RowField = { [key: string]: Guard<unknown> };
/** Display fields of a row: an unreadable one is blanked and named, the row stays. */
const rowDisplayFields = {
  channel: oneOf(DATES_INTAKE_CHANNELS), status_detail: nullable(oneOf(DATES_INTAKE_STATUS_DETAILS)),
  input_kind: oneOf(DATES_INTAKE_INPUT_KINDS), source_host: nullable(string(2048)), image_count: integer(0),
  provider: nullable(oneOf(DATES_AI_PROVIDERS)), event_count: integer(0), published_count: integer(0),
  first_title: nullable(string()), earliest_start_at: nullable(clock), hard_fails: list(oneOf(DATES_INTAKE_HARD_FAILS), 100),
  warning_count: integer(0), dedupe_decision: nullable(oneOf(DATES_INTAKE_DEDUPE_DECISIONS)),
  decision_action: nullable(oneOf(DATES_INTAKE_DECISION_ACTIONS)), created_at: clock, updated_at: clock,
} satisfies RowField;
type RowDisplay = { [K in keyof typeof rowDisplayFields]: Parsed<(typeof rowDisplayFields)[K]> | null };
const ROW_KEYS = ["intake_id", "revision", "status", "lease", ...Object.keys(rowDisplayFields)];

export type DatesIntakeQueueRow = RowDisplay & {
  intake_id: string;
  status: DatesIntakeStatus;
  /** Null when Core's value cannot be used for a compare-and-set. */
  revision: number | null;
  /** Null when Core's lease cannot be trusted. */
  lease: DatesIntakeLease | null;
  /** False removes every action of the row; the row itself is still shown. */
  controls: boolean;
  unreadable_fields: string[];
};
export type DatesIntakeUnreadableRow = { index: number; intake_id: string | null };

/** `keys` are the keys the object must have (row, or row + detail); any other key is tolerated. */
function projectRow(value: unknown, keys: readonly string[]): DatesIntakeQueueRow | null {
  if (!record(value) || keys.some((key) => !Object.hasOwn(value, key))
    || !datesIntakeId(value.intake_id) || !oneOf(DATES_INTAKE_STATUSES)(value.status)) return null;
  const unreadable: string[] = [];
  const display = Object.fromEntries(Object.entries(rowDisplayFields).map(([key, guard]) => {
    if ((guard as Guard<unknown>)(value[key])) return [key, value[key]];
    unreadable.push(key);
    return [key, null];
  })) as RowDisplay;
  const revision = integer(1)(value.revision) ? value.revision : null;
  const lease = datesIntakeLease(value.lease) ? value.lease : null;
  if (revision === null) unreadable.push("revision");
  if (lease === null) unreadable.push("lease");
  return { ...display, intake_id: value.intake_id, status: value.status, revision, lease,
    controls: revision !== null && lease !== null, unreadable_fields: unreadable };
}

const statusCounts = bound(Object.fromEntries(DATES_INTAKE_STATUSES.map((status) => [status, integer(0)])) as Record<DatesIntakeStatus, Guard<number>>);
const queueGuard = bound({ ...envelope, intakes: ((value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 100),
  page: integer(1, 10000), limit: integer(1, 100), total: integer(0), status_counts: statusCounts, drafts_enabled: bool, suggestions_enabled: bool,
  capabilities });
export type DatesIntakeQueue = Omit<Parsed<typeof queueGuard>, "intakes"> & {
  intakes: DatesIntakeQueueRow[];
  unreadable_rows: DatesIntakeUnreadableRow[];
};

/** The review queue. Null only when the page itself cannot be trusted. */
export function projectDatesIntakeQueue(value: unknown, expected: { page: number; limit: number }): DatesIntakeQueue | null {
  if (!queueGuard(value) || value.page !== expected.page || value.limit !== expected.limit || value.intakes.length > value.limit) return null;
  const ids = value.intakes.map((row) => record(row) && datesIntakeId(row.intake_id) ? row.intake_id : null);
  const intakes: DatesIntakeQueueRow[] = [], unreadable_rows: DatesIntakeUnreadableRow[] = [];
  value.intakes.forEach((item, index) => {
    // Two rows with one identity cannot both be acted on; neither is.
    const duplicate = ids[index] !== null && ids.indexOf(ids[index]) !== ids.lastIndexOf(ids[index]);
    const row = duplicate ? null : projectRow(item, ROW_KEYS);
    if (row) intakes.push(row); else unreadable_rows.push({ index, intake_id: ids[index] });
  });
  return { ...value, intakes, unreadable_rows };
}

// ---------------------------------------------------------------- detail

const safeSearch = bound({ adult: oneOf(DATES_SAFE_SEARCH_LIKELIHOODS), violence: oneOf(DATES_SAFE_SEARCH_LIKELIHOODS) });
const imageGuard = bound({ index: integer(1, DATES_INTAKE_MAX_IMAGES), ready: bool, width: nullable(integer(0)), height: nullable(integer(0)),
  bytes: integer(0), safe_search: nullable(safeSearch) });
export type DatesIntakeImage = Parsed<typeof imageGuard>;
const fetchGuard = bound({ final_url: string(8192), http_status: integer(0, 999), truncated: bool, fetched_at: clock });
const sourceTextGuard = bound({ label: ((value: unknown): value is string => typeof value === "string" && /^(image|page|text):[0-9]$/.test(value)),
  text: string(400_000), truncated: bool });
export type DatesIntakeSourceText = Parsed<typeof sourceTextGuard>;
const aiRunGuard = bound({ provider: oneOf(DATES_AI_PROVIDERS), task: string(200), model: string(200), outcome: oneOf(DATES_AI_OUTCOMES),
  input_tokens: integer(0), output_tokens: integer(0), cost_micro_usd: integer(0), cost_estimated: bool, at: clock });
export type DatesIntakeAiRun = Parsed<typeof aiRunGuard>;
const statementGuard = bound({ en: string(2000), hu: string(2000) });
const decisionShape = bound({ by: string(320), at: clock, action: oneOf(DATES_INTAKE_DECISION_ACTIONS),
  reason_code: nullable(oneOf(DATES_INTAKE_REJECT_REASONS)), statement: nullable(statementGuard) });
export type DatesIntakeDecision = Parsed<typeof decisionShape>;
const decisionGuard: Guard<DatesIntakeDecision> = (value): value is DatesIntakeDecision => decisionShape(value)
  && (value.reason_code === null) === (value.statement === null);
const referenceGuard = bound({ kind: oneOf(DATES_INTAKE_DEDUPE_KINDS), id: string(200) });
export type DatesIntakeReference = Parsed<typeof referenceGuard>;

const draftGuard = bound({
  title: string(), summary_hu: string(), summary_en: string(), category: oneOf(DATES_EXTERNAL_CATEGORIES), sensitive: bool,
  sensitive_reason: nullable(string()), date_text_verbatim: nullable(string()), starts_local: nullable(string(64)),
  ends_local: nullable(string(64)), start_time_stated: bool, all_day: bool, year_inferred: bool, attendance_mode: string(64),
  venue: bound({ name: nullable(string()), address_text: nullable(string()), city: nullable(string()),
    country_code: nullable(string(16)), is_public_venue: nullable(bool) }),
  organizer_name: nullable(string()), price_text: nullable(string()), is_free: nullable(bool),
  // The model's own number, before Core bounds it for the editor: any integer is shown as it is.
  age_restriction: nullable(integer(Number.MIN_SAFE_INTEGER)), status_signal: string(64),
});
const placeShape = { place_id: nullable(string(512)), name: nullable(string()), formatted_address: nullable(string()),
  latitude: nullable(number), longitude: nullable(number), city: nullable(string()), country_code: nullable(string(16)),
  timezone: nullable(string(80)) };
const venueGuard = bound({ ...placeShape, website_domain: nullable(string(253)), business_status: nullable(string(64)) });
const candidateGuard = bound({ ...placeShape, similarity: number, public_venue_warning: bool });
export type DatesIntakeVenue = Parsed<typeof venueGuard>;
export type DatesIntakeVenueCandidate = Parsed<typeof candidateGuard>;
const witness = oneOf(DATES_INTAKE_WITNESS_VERDICTS);
const validationGuard = bound({
  hard_fails: list(oneOf(DATES_INTAKE_HARD_FAILS), 100), warnings: list(oneOf(DATES_INTAKE_WARNINGS), 100), needs_more_info: bool,
  tier: nullable(oneOf(DATES_INTAKE_TIERS)), auto_publishable: bool, auto_blockers: list(oneOf(DATES_INTAKE_AUTO_BLOCKERS), 100),
  needs_public_venue_confirmation: bool,
  checks: bound({ weekday_match: nullable(bool), venue_resolved: bool, public_place: bool, tz_from_venue: bool, urls_from_evidence: bool,
    quotes_verified: bool, content_safe: nullable(bool), witness: bound({ present: bool, date: witness, time: witness, venue: witness }) }),
  schedule: bound({ timezone: nullable(string(80)), start_local: nullable(string(64)), end_local: nullable(string(64)),
    start_at: nullable(clock), end_at: nullable(clock), end_estimated: bool, all_day: bool }),
  links: bound({ official_url: nullable(string(8192)), ticket_url: nullable(string(8192)), organizer_url: nullable(string(8192)),
    dropped: list(bound({ field: string(64), reason: oneOf(DATES_INTAKE_LINK_DROP_REASONS) }), 50) }),
  venue: nullable(venueGuard), venue_similarity: number, venue_candidates: list(candidateGuard, 50),
});
export type DatesIntakeValidation = Parsed<typeof validationGuard>;
const evidenceState = bound({ quoted: bool, verified: bool, denotes: nullable(bool), match: nullable(oneOf(DATES_INTAKE_EVIDENCE_MATCHES)),
  source: nullable(string(64)), quote: nullable(string()), model_confidence: nullable(number), confidence: nullable(number) });
export type DatesIntakeEvidenceState = Parsed<typeof evidenceState>;
const fieldEvidenceGuard = bound(Object.fromEntries(DATES_INTAKE_EVIDENCE_FIELDS.map((field) => [field, evidenceState])) as
  Record<typeof DATES_INTAKE_EVIDENCE_FIELDS[number], typeof evidenceState>);
const dedupeGuard = bound({ decision: oneOf(DATES_INTAKE_DEDUPE_DECISIONS),
  candidates: list(bound({ kind: oneOf(DATES_INTAKE_DEDUPE_KINDS), id: string(200), similarity: number, verdict: oneOf(DATES_INTAKE_DEDUPE_VERDICTS) }), 50) });

/**
 * Core's prefill for the P1 editor. Unlike a stored event, a field Core does
 * not know is null, and the four confirmations are always the reviewer's.
 */
const editorInputGuard = bound({
  title: string(), summary: bound({ hu: string(), en: string() }), category: oneOf(DATES_EXTERNAL_CATEGORIES),
  sensitive: bound({ flag: bool, reason: nullable(string()) }), start_at: nullable(integer(1)), end_at: nullable(integer(1)),
  timezone: nullable(string(80)), all_day: bool, is_free: nullable(bool), price_text: nullable(string()),
  age_restriction: nullable(integer(18, 99)),
  venue: nullable(bound({ name: string(), formatted_address: string(), latitude: number, longitude: number, city: string(),
    country_code: string(16) })),
  organizer: bound({ name: nullable(string()), website: nullable(string(8192)) }),
  links: bound({ official_url: nullable(string(8192)), ticket_url: nullable(string(8192)) }), source_url: nullable(string(8192)),
  attendee_list: oneOf(["visible", "count_only"] as const),
  confirmations: bound({ source: literal(false), public_venue: literal(false), timezone: literal(false), content_safe: literal(false) }),
});
export type DatesIntakeEditorInput = Parsed<typeof editorInputGuard>;

const eventShape = { index: integer(0, 99), published_external_event_id: nullable(externalEventId), draft: draftGuard,
  validation: nullable(validationGuard), field_evidence: nullable(fieldEvidenceGuard), dedupe: nullable(dedupeGuard) };
const EVENT_KEYS = [...Object.keys(eventShape), "editor_input"];
export type DatesIntakeEvent = { [K in keyof typeof eventShape]: Parsed<(typeof eventShape)[K]> } & {
  /** Null when Core offers no prefill, or when its prefill cannot be read (see `editor_unreadable`). */
  editor_input: DatesIntakeEditorInput | null;
  editor_unreadable: boolean;
};

function projectEvent(value: unknown, position: number): DatesIntakeEvent | null {
  if (!record(value) || EVENT_KEYS.some((key) => !Object.hasOwn(value, key))) return null;
  for (const [key, guard] of Object.entries(eventShape)) if (!(guard as Guard<unknown>)(value[key])) return null;
  // The index is the event's identity towards Core's publish route.
  if (value.index !== position) return null;
  const editor = value.editor_input === null ? null : editorInputGuard(value.editor_input) ? value.editor_input : undefined;
  return { ...(value as { [K in keyof typeof eventShape]: Parsed<(typeof eventShape)[K]> }),
    editor_input: editor ?? null, editor_unreadable: editor === undefined };
}

const inputsShape = { kind: oneOf(DATES_INTAKE_INPUT_KINDS), url: nullable(string(8192)), text: nullable(string()), locale: string(16) };
const DETAIL_KEYS = ["admin_principal", "inputs", "fetch", "source_texts", "result", "result_note", "prohibited_category",
  "prompt_injection_suspected", "validated_at", "events", "ai_runs", "decision", "duplicate_of", "budget_waiting_since",
  "images_delete_after", "retention_until", "content_purged_at", "member"];

// The member's side of a suggestion, as Core serves it to a reviewer - and nothing of the member beyond it.
const memberField = oneOf(DATES_INTAKE_MEMBER_EDITABLE_FIELDS);
export type DatesIntakeMemberField = typeof DATES_INTAKE_MEMBER_EDITABLE_FIELDS[number];
const memberConfirmation = bound({ state: oneOf(DATES_INTAKE_MEMBER_CONFIRMATION_STATES), at: nullable(clock), due_at: nullable(clock),
  asked_by_reviewer: bool, fields: list(memberField, 20), note: nullable(string(8000)) });
/** A corrected value is shown as text; Core serves a string, and a boolean for `is_free`. */
const memberValue: Guard<string | number | boolean | null> = (value): value is string | number | boolean | null =>
  value === null || typeof value === "boolean" || (typeof value === "string" && value.length <= 8000) || (typeof value === "number" && Number.isFinite(value));
const memberCorrection = bound({ index: integer(0, 99), field: memberField, from: memberValue, to: memberValue });
const memberFirstDecision = bound({ by: string(320), at: nullable(clock), action: oneOf(DATES_INTAKE_DECISION_ACTIONS),
  reason_code: nullable(oneOf(DATES_INTAKE_REJECT_REASONS)) });
const memberReReview = bound({ requested_at: nullable(clock), note: nullable(string(8000)), decided_at: nullable(clock),
  first_decision: nullable(memberFirstDecision) });
const memberStanding = bound({ strikes: integer(0), strike_limit: integer(0), banned_until: nullable(clock) });
const MEMBER_KEYS = ["submitter_uid", "anonymous", "auto_going", "consent_version", "confirmation", "corrections", "re_review", "standing", "can_ask"];
export type DatesIntakeMemberCorrection = Parsed<typeof memberCorrection>;
export type DatesIntakeMember = {
  /** Null once the account is erased: nobody to name, nothing to ask. */
  submitter_uid: number | null;
  /** The member asked not to be credited by name. */
  anonymous: boolean;
  auto_going: boolean;
  consent_version: number | null;
  confirmation: Parsed<typeof memberConfirmation> | null;
  /** The member's changes to the AI's draft, as a diff; a row that cannot be read is named, not dropped silently. */
  corrections: DatesIntakeRows<DatesIntakeMemberCorrection>;
  re_review: Parsed<typeof memberReReview> | null;
  standing: Parsed<typeof memberStanding> | null;
  /** Core's word on whether the member may still be asked (once per suggestion). */
  can_ask: boolean;
  /** Parts of the block served in a shape this console cannot read: unknown, not absent. */
  unreadable: string[];
};

/** The member block. `undefined` when the block itself cannot be trusted; its parts degrade one by one. */
function projectMember(value: unknown): DatesIntakeMember | null | undefined {
  if (value === null) return null;
  if (!record(value) || MEMBER_KEYS.some((key) => !Object.hasOwn(value, key))
    || !nullable(integer(1))(value.submitter_uid) || !bool(value.anonymous) || !bool(value.auto_going) || !nullable(integer(0))(value.consent_version)
    || !bool(value.can_ask)) return undefined;
  const unreadable: string[] = [];
  const part = <T>(key: string, guard: Guard<T>): T | null => {
    if (guard(value[key])) return value[key] as T;
    unreadable.push(key);
    return null;
  };
  const corrections = rows(value.corrections, memberCorrection, 800);
  if (!corrections) unreadable.push("corrections");
  // The block is rebuilt from the contract's fields, part by part: a key Core might add (D-143 tolerates it) is not
  // kept - of a member, this console holds what the contract serves a reviewer and nothing beyond it.
  const confirmation = part("confirmation", nullable(memberConfirmation)), look = part("re_review", nullable(memberReReview));
  const standing = part("standing", nullable(memberStanding)), first = look?.first_decision ?? null;
  const member: DatesIntakeMember = { submitter_uid: value.submitter_uid, anonymous: value.anonymous, auto_going: value.auto_going,
    consent_version: value.consent_version,
    confirmation: confirmation && { state: confirmation.state, at: confirmation.at, due_at: confirmation.due_at, asked_by_reviewer: confirmation.asked_by_reviewer,
      fields: [...confirmation.fields], note: confirmation.note },
    corrections: corrections ? { items: corrections.items.map((row) => ({ index: row.index, field: row.field, from: row.from, to: row.to })), unreadable: corrections.unreadable }
      : { items: [], unreadable: [] },
    re_review: look && { requested_at: look.requested_at, note: look.note, decided_at: look.decided_at,
      first_decision: first && { by: first.by, at: first.at, action: first.action, reason_code: first.reason_code } },
    standing: standing && { strikes: standing.strikes, strike_limit: standing.strike_limit, banned_until: standing.banned_until },
    // Nobody is asked on the strength of a block the console could not read whole.
    can_ask: value.can_ask, unreadable };
  if (unreadable.length > 0) member.can_ask = false;
  return member;
}

const detailEnvelope = bound({ ...envelope, intake: record, capabilities });

export type DatesIntakeDetail = DatesIntakeQueueRow & {
  admin_principal: string | null;
  inputs: { kind: typeof DATES_INTAKE_INPUT_KINDS[number]; url: string | null; text: string | null; locale: string;
    images: DatesIntakeRows<DatesIntakeImage> } | null;
  fetch: Parsed<typeof fetchGuard> | null;
  /** Null when the whole section cannot be read. That is "unknown", never "none": the page must say so. */
  source_texts: DatesIntakeRows<DatesIntakeSourceText> | null;
  result: typeof DATES_INTAKE_RESULTS[number] | null;
  result_note: string | null;
  prohibited_category: string | null;
  prompt_injection_suspected: boolean;
  validated_at: number | null;
  /**
   * Position-preserving: `events[i]` is Core's event `i`, or null when it cannot be read.
   * The whole list is null when the section itself cannot be read: unknown, not empty.
   */
  events: Array<DatesIntakeEvent | null> | null;
  /** Null when the whole section cannot be read. */
  ai_runs: DatesIntakeRows<DatesIntakeAiRun> | null;
  decision: DatesIntakeDecision | null;
  duplicate_of: DatesIntakeReference | null;
  budget_waiting_since: number | null;
  images_delete_after: number | null;
  retention_until: number | null;
  content_purged_at: number | null;
  /**
   * The member's side of a suggestion; null for an operator's draft. When the block cannot be read ("member" is then in
   * `unreadable_sections`) it is null too - and the intake is still a member's: `channel` says so.
   */
  member: DatesIntakeMember | null;
  /** Detail sections Core served in a shape this console cannot read. */
  unreadable_sections: string[];
};
export type DatesIntakeDetailRead = { intake: DatesIntakeDetail; capabilities: string[]; server_now: number };

/**
 * One intake for the reviewer. Null when the body is not this intake's detail
 * at all; a section that cannot be read is named in `unreadable_sections`
 * and shown as such, never as "nothing there".
 */
export function projectDatesIntakeDetail(value: unknown, intakeId: string): DatesIntakeDetailRead | null {
  if (!detailEnvelope(value) || !datesIntakeId(intakeId)) return null;
  const source = value.intake;
  const row = projectRow(source, [...ROW_KEYS, ...DETAIL_KEYS]);
  if (!row || row.intake_id !== intakeId) return null;
  const unreadable: string[] = [];
  const section = <T>(key: string, guard: Guard<T>, fallback: T): T => {
    if (guard(source[key])) return source[key] as T;
    unreadable.push(key);
    return fallback;
  };
  let inputs: DatesIntakeDetail["inputs"] = null;
  const rawInputs = source.inputs;
  if (record(rawInputs) && bound(inputsShape)(rawInputs) && Object.hasOwn(rawInputs, "images")) {
    const images = rows((rawInputs as Record<string, unknown>).images, imageGuard, DATES_INTAKE_MAX_IMAGES);
    if (images) inputs = { kind: rawInputs.kind as typeof DATES_INTAKE_INPUT_KINDS[number], url: rawInputs.url as string | null,
      text: rawInputs.text as string | null, locale: rawInputs.locale as string, images };
  }
  if (!inputs) unreadable.push("inputs");
  const texts = rows(source.source_texts, sourceTextGuard, 20), runs = rows(source.ai_runs, aiRunGuard, 100);
  if (!texts) unreadable.push("source_texts");
  if (!runs) unreadable.push("ai_runs");
  // An unreadable list is kept apart from an empty one all the way to the page.
  let events: Array<DatesIntakeEvent | null> | null = null;
  if (Array.isArray(source.events) && source.events.length <= 100) events = source.events.map(projectEvent);
  else unreadable.push("events");
  const intake: DatesIntakeDetail = {
    ...row,
    admin_principal: section("admin_principal", nullable(string(320)), null),
    inputs,
    fetch: section("fetch", nullable(fetchGuard), null),
    source_texts: texts,
    result: section("result", nullable(oneOf(DATES_INTAKE_RESULTS)), null),
    result_note: section("result_note", nullable(string()), null),
    prohibited_category: section("prohibited_category", nullable(string(200)), null),
    prompt_injection_suspected: section("prompt_injection_suspected", bool, false),
    validated_at: section("validated_at", nullable(clock), null),
    events,
    ai_runs: runs,
    decision: section("decision", nullable(decisionGuard), null),
    duplicate_of: section("duplicate_of", nullable(referenceGuard), null),
    budget_waiting_since: section("budget_waiting_since", nullable(clock), null),
    images_delete_after: section("images_delete_after", nullable(clock), null),
    retention_until: section("retention_until", nullable(clock), null),
    content_purged_at: section("content_purged_at", nullable(clock), null),
    member: null,
    unreadable_sections: unreadable,
  };
  // A member block exactly when it is a member's suggestion (Core's own rule); anything else is unreadable, not "no member".
  const member = projectMember(source.member), suggestion = row.channel === null ? null : row.channel === "member_suggestion";
  if (member === undefined || (suggestion !== null && (member !== null) !== suggestion)) unreadable.push("member");
  else intake.member = member;
  // A suspected injection that cannot be read must not look like "none".
  if (unreadable.includes("prompt_injection_suspected")) intake.prompt_injection_suspected = true;
  return { intake, capabilities: value.capabilities, server_now: value.server_now };
}

/** Where a duplicate or a dedupe candidate lives in this console, when its identity is readable. */
export function datesIntakeReferenceHref(reference: { kind: string; id: string }): string | null {
  if (reference.kind === "intake" && datesIntakeId(reference.id)) return `/dates/intakes/${reference.id}`;
  if (reference.kind === "event" && externalEventId(reference.id)) return `/dates/external/${reference.id}`;
  return null;
}

/**
 * The address to link to, or null when the value must stay text. An intake's
 * addresses are untrusted (submitted, fetched or extracted), so only a plain
 * `https:` address is ever clickable: not `http:` (Core may fetch it, a
 * reviewer's browser must not follow it over cleartext), no other scheme, and
 * no credentials in the address.
 */
export function datesIntakeLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value) || !/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "" ? value : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- what the reviewer may do

export type DatesIntakeAffordances = {
  claim: boolean; release: boolean; overrideRelease: boolean; reject: boolean; publish: boolean;
};
/** A rejection for one of these reasons is a strike against the member who suggested the event (Core: STRIKE_REASONS). */
export const DATES_INTAKE_STRIKE_REASONS: readonly string[] = ["spam_or_fake"];
/** A member's note to or from a reviewer: at most this many graphemes (Core: MAX_NOTE_GRAPHEMES). */
export const DATES_INTAKE_MAX_MEMBER_NOTE_GRAPHEMES = 500;

/**
 * What the console OFFERS. Core remains the authority: every one of these is
 * re-checked there and its refusal is shown as what it is.
 */
export function datesIntakeAffordances(intake: Pick<DatesIntakeQueueRow, "status" | "controls" | "lease" | "published_count"> & { channel?: string | null },
  access: { review: boolean; manage: boolean; superadmin: boolean; draftsEnabled: boolean; suggestionsEnabled?: boolean }): DatesIntakeAffordances {
  const open = intake.controls && intake.status === "in_review" && access.review && intake.lease !== null;
  const lease = intake.lease;
  // A member's suggestion is published under the member channel's switch, an operator's draft under the draft switch.
  const switchOn = intake.channel === "member_suggestion" ? access.suggestionsEnabled !== false : access.draftsEnabled;
  return {
    claim: open && !lease!.active,
    release: open && lease!.mine,
    overrideRelease: open && lease!.active && !lease!.mine && access.superadmin,
    // Core refuses a rejection once an event of the intake was published.
    reject: open && lease!.mine && intake.published_count === 0,
    publish: open && lease!.mine && access.manage && switchOn,
  };
}

/**
 * Whether the reviewer may send the draft back to the member, and if not, the
 * one reason the screen gives. Core decides (`can_ask`: a member's suggestion,
 * not asked before, the account still there, nothing published from it); the
 * console adds only what it can see - the hold, the switch, a block it could
 * not read - and Core re-checks all of it.
 */
export type DatesIntakeAskState = { offered: false } | { offered: true; allowed: true }
  | { offered: true; allowed: false; why: "unreadable" | "notAskable" | "switchOff" | "holdFirst" };
export function datesIntakeAskState(intake: Pick<DatesIntakeDetail, "status" | "controls" | "lease" | "channel" | "member" | "unreadable_sections">,
  access: { review: boolean; suggestionsEnabled: boolean | null }): DatesIntakeAskState {
  if (intake.channel !== "member_suggestion" || intake.status !== "in_review" || !access.review) return { offered: false };
  if (intake.member === null || intake.unreadable_sections.includes("member") || intake.member.unreadable.length > 0) return { offered: true, allowed: false, why: "unreadable" };
  if (!intake.member.can_ask) return { offered: true, allowed: false, why: "notAskable" };
  if (access.suggestionsEnabled === false) return { offered: true, allowed: false, why: "switchOff" };
  if (!intake.controls || intake.lease === null || !intake.lease.mine) return { offered: true, allowed: false, why: "holdFirst" };
  return { offered: true, allowed: true };
}

/** Whether the console would send this request to the member at all: a field chosen, a usable note or none, an audit reason. */
export function datesIntakeAskValid(fields: readonly unknown[], memberNote: string, reason: string): boolean {
  return datesIntakeAskFields([...fields]) && datesIntakeAuditNote(reason) && (memberNote.trim() === "" || datesIntakeMemberNote(memberNote.trim()));
}

/** The fields a reviewer asks the member to look at: one to eight of the editable ones, none twice (as Core checks). */
export const datesIntakeAskFields: Guard<DatesIntakeMemberField[]> = (value): value is DatesIntakeMemberField[] => Array.isArray(value) && value.length >= 1
  && value.length <= DATES_INTAKE_MEMBER_EDITABLE_FIELDS.length && value.every(memberField) && new Set(value).size === value.length;
/**
 * The note the member reads: optional; when given, not blank, no control
 * character but tab and line breaks, at most 500 graphemes after trimming
 * (DatesEventIntakeAdminService::askMember).
 */
export const datesIntakeMemberNote: Guard<string> = (value): value is string => typeof value === "string" && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  && phpTrim(value) !== "" && [...graphemes.segment(phpTrim(value))].length <= DATES_INTAKE_MAX_MEMBER_NOTE_GRAPHEMES;

/** The events of an intake that can still be opened in the editor. */
export function datesIntakePublishableEvents(intake: Pick<DatesIntakeDetail, "events" | "status">): number[] {
  if (intake.status !== "in_review") return [];
  return (intake.events ?? []).flatMap((event, index) => event && event.published_external_event_id === null && event.editor_input !== null ? [index] : []);
}

/**
 * The events of an intake this console cannot account for: an event it could
 * not decode (whether it was published is unknown too) and an unpublished
 * event whose editor prefill it could not decode. Unknown is not absent.
 */
export function datesIntakeUnreadableEvents(intake: Pick<DatesIntakeDetail, "events">): number[] {
  return (intake.events ?? []).flatMap((event, index) => event === null || (event.editor_unreadable && event.published_external_event_id === null) ? [index] : []);
}

export type DatesIntakeCompletion = {
  /** Other events that can still be opened in the editor. */
  remaining: number;
  /** Events this console could not read. They are unknown, not absent. */
  unreadable: number;
  /**
   * - `last`: nothing else is left and nothing is unknown; publishing this event finishes the intake.
   * - `choice`: other readable events remain; the reviewer may say this is the last one they take.
   * - `unreadable`: an event of the intake could not be read. The intake is never closed implicitly:
   *   the reviewer chooses, in words, and the choice is what is sent.
   */
  mode: "last" | "choice" | "unreadable";
  /**
   * The question the reviewer is asked, as an identity: which event is being
   * published, how many events the intake has, which of the others can still
   * be published and which could not be read. An answer belongs to exactly
   * one question; when a read changes any of this, it is a new question.
   */
  question: string;
};

/** What publishing event `eventIndex` means for the rest of the intake. */
export function datesIntakeCompletion(intake: Pick<DatesIntakeDetail, "events" | "status">, eventIndex: number): DatesIntakeCompletion {
  const others = datesIntakePublishableEvents(intake).filter((index) => index !== eventIndex);
  const unknown = datesIntakeUnreadableEvents(intake).filter((index) => index !== eventIndex);
  const mode = unknown.length > 0 ? "unreadable" : others.length > 0 ? "choice" : "last";
  return { remaining: others.length, unreadable: unknown.length, mode,
    question: [eventIndex, intake.events?.length ?? 0, mode, others.join("."), unknown.join(".")].join("|") };
}

/** The reviewer's answer, tied to the question it was given for. */
export type DatesIntakeCompletionAnswer = { question: string; close: boolean };

/**
 * Whether the reviewer chose to close the intake - for THIS question. An
 * answer given for another set of events (other siblings left, an event that
 * has since become unreadable or readable) is not carried over: the question
 * starts again from the safe default, "leave the intake open".
 */
export function datesIntakeCompletionChoice(answer: DatesIntakeCompletionAnswer | null, completion: DatesIntakeCompletion | null): boolean {
  return answer !== null && completion !== null && answer.question === completion.question ? answer.close : false;
}

/**
 * Whether a publication waiting for its confirmation still answers the
 * question the intake poses now. One that was prepared for another set of
 * events is not confirmable; the reviewer reviews it again.
 */
export function datesIntakeCandidateCurrent(candidate: { eventIndex: number; question: string } | null, intake: Pick<DatesIntakeDetail, "events" | "status"> | null): boolean {
  return candidate !== null && intake !== null && datesIntakePublishableEvents(intake).includes(candidate.eventIndex)
    && datesIntakeCompletion(intake, candidate.eventIndex).question === candidate.question;
}

/**
 * Core's `complete`: "this was the last event to publish from this intake".
 * It is implied only when the console can see that nothing else is left;
 * otherwise it is exactly what the reviewer chose, and the default is to
 * leave the intake open.
 */
export function datesIntakeCompleteFlag(completion: DatesIntakeCompletion, close: boolean): boolean {
  return completion.mode === "last" ? true : close;
}

/** Seconds Core will still honour the reviewer's hold; never negative. */
export function datesIntakeLeaseRemaining(lease: DatesIntakeLease | null, serverNow: number): number {
  return lease?.active ? Math.max(0, lease.until - serverNow) : 0;
}

/**
 * Milliseconds until the first renewal of a hold this page did not just take:
 * a minute before Core lets it go, at once when less than that is left, and
 * never later than the regular rhythm.
 */
export function datesIntakeHeartbeatDelay(lease: DatesIntakeLease | null, serverNow: number): number {
  const remaining = datesIntakeLeaseRemaining(lease, serverNow);
  return Math.min(DATES_INTAKE_HEARTBEAT_SECONDS, Math.max(1, remaining - 60)) * 1000;
}

// ---------------------------------------------------------------- editor prefill

/**
 * The P1 editor's draft from Core's prefill. Nothing is invented: a field
 * Core does not know stays empty for the reviewer, and the confirmations are
 * never ticked.
 */
export function datesIntakeEditorDraft(input: DatesIntakeEditorInput): DatesExternalDraft {
  const zone = input.timezone ?? "";
  const start = input.start_at !== null && zone ? datesExternalTimeToInput(input.start_at, zone) : null;
  const end = input.end_at !== null && zone ? datesExternalTimeToInput(input.end_at, zone) : null;
  return {
    title: input.title, summaryEn: input.summary.en, summaryHu: input.summary.hu, category: input.category as DatesExternalCategory,
    sensitive: input.sensitive.flag, sensitiveReason: input.sensitive.reason ?? "", attendeeList: input.attendee_list,
    startLocal: start?.local ?? "", startOffset: start?.offset ?? "", endLocal: end?.local ?? "", endOffset: end?.offset ?? "",
    timezone: zone, allDay: input.all_day, priceText: input.price_text ?? "", isFree: input.is_free === true,
    ageRestriction: input.age_restriction?.toString() ?? "",
    venueName: input.venue?.name ?? "", venueAddress: input.venue?.formatted_address ?? "",
    latitude: input.venue ? String(input.venue.latitude) : "", longitude: input.venue ? String(input.venue.longitude) : "",
    city: input.venue?.city ?? "", countryCode: input.venue?.country_code ?? "",
    organizerName: input.organizer.name ?? "", organizerWebsite: input.organizer.website ?? "",
    officialUrl: input.links.official_url ?? "", ticketUrl: input.links.ticket_url ?? "", sourceUrl: input.source_url ?? "",
    ...DATES_EXTERNAL_FRESH_CONFIRMATIONS,
  };
}

/** The fields of Core's prefill a person still has to supply before the P1 editor accepts it. */
export function datesIntakeEditorGaps(input: DatesIntakeEditorInput): string[] {
  const gaps: string[] = [];
  if (input.start_at === null) gaps.push("start");
  if (input.timezone === null) gaps.push("timezone");
  if (input.venue === null) gaps.push("venue");
  if (input.organizer.name === null) gaps.push("organizer");
  if (input.source_url === null) gaps.push("source");
  if (input.is_free === null) gaps.push("price");
  return gaps;
}

// ---------------------------------------------------------------- receipts

/**
 * The create receipt binds on what identifies the command - success, the
 * intake, its revision and status, the audit id - and on the two markers, and
 * tolerates keys it does not know.
 *
 * `existing: true` is not a new draft and not an error: the operator already
 * has an OPEN draft of this source, and `intake` is that draft as it is now -
 * any open status, any revision. Core, not the console, guarantees that a
 * source does not become two open drafts. `existing: false` is a new draft:
 * revision 1, `received`.
 */
const createReceipt = bound({ success: literal(true), status_code: literal(200), replayed: bool, existing: bool,
  intake: bound({ intake_id: datesIntakeId, revision: integer(1), status: oneOf(DATES_INTAKE_STATUSES) }), audit_id: auditId });
export type DatesIntakeCreateReceipt = Parsed<typeof createReceipt>;
export function decodeDatesIntakeCreateReceipt(value: unknown): DatesIntakeCreateReceipt | null {
  if (!createReceipt(value)) return null;
  const { revision, status } = value.intake;
  return (value.existing ? (DATES_INTAKE_OPEN_STATUSES as readonly string[]).includes(status) : revision === 1 && status === "received") ? value : null;
}

// What every receipt binds first: Core said it succeeded. Everything else Core adds (its clock, the legacy envelope keys,
// a key of a later contract) is tolerated.
const succeeded = { success: literal(true), status_code: literal(200) };
const leaseReceipt = bound({ ...succeeded, intake: bound({ intake_id: datesIntakeId, revision: integer(2), status: literal("in_review"),
  lease: receiptLease }), audit_id: nullable(auditId) });
export type DatesIntakeLeaseReceipt = Parsed<typeof leaseReceipt>;
export type DatesIntakeLeaseAction = typeof DATES_INTAKE_LEASE_ACTIONS[number];
/** A lease receipt answers exactly the request: this intake, the next revision, the lease that action leaves. */
export function decodeDatesIntakeLeaseReceipt(value: unknown, request: { intake_id: string; expected_revision: number; action: DatesIntakeLeaseAction }):
  DatesIntakeLeaseReceipt | null {
  if (!leaseReceipt(value) || value.intake.intake_id !== request.intake_id || value.intake.revision !== request.expected_revision + 1) return null;
  const lease = value.intake.lease;
  if (request.action === "release" ? lease.active || lease.mine || lease.holder !== null || value.audit_id === null
    : !lease.active || !lease.mine || lease.holder === null || lease.until < 1) return null;
  // A heartbeat is not audited; a claim is.
  if (request.action === "heartbeat" ? value.audit_id !== null : value.audit_id === null) return null;
  return value;
}

const rejectOutcome = oneOf(["rejected", "duplicate"] as const);
const rejectReceipt = bound({ ...succeeded, replayed: bool,
  intake: bound({ intake_id: datesIntakeId, revision: integer(2), status: rejectOutcome }),
  decision: bound({ action: rejectOutcome, reason_code: oneOf(DATES_INTAKE_REJECT_REASONS) }), audit_id: auditId });
export type DatesIntakeRejectReceipt = Parsed<typeof rejectReceipt>;
/**
 * A rejection receipt answers its request: this intake, the next revision, the
 * reason that was sent, and the outcome that request asks for - a rejection
 * that names the event already there ends the intake as a `duplicate` of it,
 * every other one as `rejected` (Core echoes the outcome twice; both must say it).
 */
export function decodeDatesIntakeRejectReceipt(value: unknown, request: { intake_id: string; expected_revision: number; reason_code: string;
  duplicate_of_external_event_id?: string }): DatesIntakeRejectReceipt | null {
  if (!rejectReceipt(value) || value.intake.intake_id !== request.intake_id || value.intake.revision !== request.expected_revision + 1
    || value.decision.reason_code !== request.reason_code) return null;
  const outcome = request.duplicate_of_external_event_id === undefined ? "rejected" : "duplicate";
  return value.intake.status === outcome && value.decision.action === outcome ? value : null;
}

const askReceipt = bound({ ...succeeded, replayed: bool,
  intake: bound({ intake_id: datesIntakeId, revision: integer(2), status: literal("member_confirming") }),
  asked: bound({ fields: list(memberField, DATES_INTAKE_MEMBER_EDITABLE_FIELDS.length), due_at: clock }), audit_id: auditId });
export type DatesIntakeAskReceipt = Parsed<typeof askReceipt>;
/** The draft is with the member: this intake, the next revision, and exactly the fields that were asked about. */
export function decodeDatesIntakeAskReceipt(value: unknown, request: { intake_id: string; expected_revision: number; fields: readonly string[] }):
  DatesIntakeAskReceipt | null {
  return askReceipt(value) && value.intake.intake_id === request.intake_id && value.intake.revision === request.expected_revision + 1
    && value.asked.fields.length === request.fields.length && request.fields.every((field) => (value.asked.fields as string[]).includes(field)) ? value : null;
}

const publishReceipt = bound({ ...succeeded, replayed: bool, external_event_id: externalEventId, revision: integer(1),
  // The activity is new, but not always at revision 1: a member's "going" is recorded with the publication (P2b).
  activity_id: id("act"), activity_revision: integer(1), event_status: literal("published"), audit_id: auditId,
  intake: bound({ intake_id: datesIntakeId, revision: integer(2), status: oneOf(["in_review", "published"] as const), published_count: integer(1) }) });
export type DatesIntakePublishReceipt = Parsed<typeof publishReceipt>;
/** The P1 publish receipt plus what became of the intake, bound to the request. */
export function decodeDatesIntakePublishReceipt(value: unknown, request: Record<string, unknown>): DatesIntakePublishReceipt | null {
  if (!publishReceipt(value) || value.intake.intake_id !== request.intake_id
    || value.intake.revision !== Number(request.intake_revision) + 1) return null;
  // "This was the last one" always finishes the intake.
  return request.complete === true && value.intake.status !== "published" ? null : value;
}

// ---------------------------------------------------------------- flyer read

const imageReceipt = bound({ ...envelope, image: bound({ index: integer(1, DATES_INTAKE_MAX_IMAGES), mime: literal("image/jpeg"),
  width: integer(0), height: integer(0), sha256: ((value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)),
  data_base64: string(20_000_000) }), audit_id: auditId });
export type DatesIntakeImageRead = Parsed<typeof imageReceipt>;
/** The shape of Core's audited flyer read; the bytes are checked where they are decoded. */
export function decodeDatesIntakeImage(value: unknown, index: number): DatesIntakeImageRead | null {
  return imageReceipt(value) && value.image.index === index ? value : null;
}

/**
 * The re-encoded flyer as bytes, or null. Only a JPEG is accepted: Core never
 * serves the upload, and nothing else may reach an <img> from this route.
 */
export function datesIntakeImageBytes(read: DatesIntakeImageRead): Uint8Array | null {
  const encoded = read.image.data_base64;
  if (encoded.length < 8 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)); } catch { return null; }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

/** The console's private flyer route; empty when the identity is not one Core would accept. */
export function datesIntakeMediaUrl(intakeId: string, index: number): string {
  return datesIntakeId(intakeId) && Number.isInteger(index) && index >= 1 && index <= DATES_INTAKE_MAX_IMAGES
    ? `/api/admin/dates-intake-media?intake_id=${intakeId}&index=${index}` : "";
}

// ---------------------------------------------------------------- usage

const usageRow = bound({ provider: string(64), model: string(200), task: string(200), channel: string(64), calls: integer(0),
  unanswered_calls: integer(0), input_tokens: integer(0), output_tokens: integer(0), cache_read_tokens: integer(0),
  cache_write_tokens: integer(0), reasoning_tokens: integer(0), cost_micro_usd: integer(0), estimated_cost_calls: integer(0) });
export type DatesAiUsageRow = Parsed<typeof usageRow>;
const month: Guard<string> = (value): value is string => typeof value === "string" && /^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
const usageGuard = bound({ ...envelope, usage: bound({ month, cap_usd: integer(0), spent_micro_usd: integer(0), reserved_micro_usd: integer(0),
  remaining_micro_usd: integer(0), calls: integer(0), alert: bool, alert_at: nullable(clock), exhausted: bool,
  rows: ((value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 500) }), drafts_enabled: bool, capabilities });
export type DatesAiUsage = Omit<Parsed<typeof usageGuard>["usage"], "rows"> & { rows: DatesAiUsageRow[]; unreadable_rows: number[] };
export type DatesAiUsageRead = { usage: DatesAiUsage; drafts_enabled: boolean; capabilities: string[]; server_now: number };

/** Month-to-date AI spend. `expectedMonth` is null for "the current month, as Core counts it". */
export function projectDatesAiUsage(value: unknown, expectedMonth: string | null): DatesAiUsageRead | null {
  if (!usageGuard(value) || (expectedMonth !== null && value.usage.month !== expectedMonth)) return null;
  const read = rows(value.usage.rows, usageRow, 500)!;
  return { usage: { ...value.usage, rows: read.items, unreadable_rows: read.unreadable }, drafts_enabled: value.drafts_enabled,
    capabilities: value.capabilities, server_now: value.server_now };
}

export function datesAiUsageMonth(value: unknown): value is string { return month(value); }

/** Share of the cap already spent or held, 0..1; null when there is no cap to measure against. */
export function datesAiUsageShare(usage: Pick<DatesAiUsage, "cap_usd" | "spent_micro_usd" | "reserved_micro_usd">): number | null {
  const cap = usage.cap_usd * 1_000_000;
  return cap > 0 ? Math.min(1, (usage.spent_micro_usd + usage.reserved_micro_usd) / cap) : null;
}

/** Micro-dollars as a dollar amount with enough digits to see a single call. */
export function datesMicroUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 10_000_000 ? 4 : 2 }).format(value / 1_000_000);
}

// ---------------------------------------------------------------- refusals

/** Every `dates-intake-*` token Core's contract names, with its logical status. */
export const DATES_INTAKE_REFUSALS: Readonly<Record<string, number>> = {
  "dates-intake-admin-drafts-disabled": 403, "dates-intake-claimed": 409, "dates-intake-conflict": 409,
  "dates-intake-duplicate-event-unavailable": 409, "dates-intake-event-unavailable": 409,
  "dates-intake-filter-invalid": 422, "dates-intake-id-invalid": 422, "dates-intake-image-invalid": 422, "dates-intake-image-unavailable": 404,
  "dates-intake-input-invalid": 422, "dates-intake-kind-invalid": 422, "dates-intake-lease-invalid": 422, "dates-intake-lease-lost": 409,
  "dates-intake-lease-owner-required": 403, "dates-intake-lease-required": 409, "dates-intake-locale-invalid": 422,
  "dates-intake-origin-invalid": 422, "dates-intake-reason-invalid": 422, "dates-intake-revision-invalid": 422,
  "dates-intake-source-not-readable": 422, "dates-intake-state-invalid": 409, "dates-intake-storage-unavailable": 503,
  "dates-intake-suggestions-disabled": 403,
  "dates-intake-text-invalid": 422, "dates-intake-unavailable": 404, "dates-intake-url-invalid": 422,
};

export type DatesIntakeRefusal =
  /** Core answered with its closed refusal envelope: this is what it said. */
  | { kind: "core"; error: string; status: number }
  /** The console's own bridge refused (session, origin, shape, transport). */
  | { kind: "bridge"; error: string; status: number }
  /** Nothing readable came back. */
  | { kind: "unreadable" };

export function datesIntakeRefusal(value: unknown): DatesIntakeRefusal {
  if (!record(value) || value.success !== false || typeof value.error !== "string" || !/^[a-z][a-z0-9-]{1,100}$/.test(value.error)
    || !integer(400, 599)(value.status_code)) return { kind: "unreadable" };
  // Core's refusal carries the legacy envelope (message, status, can_send) with its fixed values; the bridge's own carries
  // none of the three. Anything in between is neither. Another key is tolerated either way.
  const legacy = ["message", "status", "can_send"].filter((key) => Object.hasOwn(value, key));
  if (legacy.length === 3 && value.message === 200 && value.status === 200 && value.can_send === 0) return { kind: "core", error: value.error, status: value.status_code };
  return legacy.length === 0 ? { kind: "bridge", error: value.error, status: value.status_code } : { kind: "unreadable" };
}

/** A refusal that proves the operator lacks the capability, as opposed to a read that merely failed. */
export function datesIntakeCapabilityRefused(refusal: DatesIntakeRefusal): boolean {
  return refusal.kind !== "unreadable" && refusal.status === 403 && refusal.error === "dates-admin-capability-required";
}

// ---------------------------------------------------------------- the same-origin bridge

export function datesIntakeProxyCapabilityAuthorized(action: string, membership: unknown): boolean | undefined {
  if (!DATES_INTAKE_PROXY_ACTIONS.includes(action as DatesIntakeProxyAction)) return undefined;
  const principal = datesAdminPrincipal(membership);
  if (principal === null) return false;
  // Mirrors Core: the queue, a draft, the hold and a rejection are a reviewer's;
  // publishing is a manager's; what the AI has cost is readable by every Dates role.
  return hasDatesCapability(principal, action === "dates_event_intake_usage" ? "dates_external_event_read"
    : action === "dates_event_intake_publish" ? "dates_external_event_manage" : "dates_external_event_review");
}

const formInteger = (value: unknown, minimum: number, maximum: number): boolean =>
  integer(minimum, maximum)(value) || (typeof value === "string" && /^[1-9][0-9]*$/.test(value) && integer(minimum, maximum)(Number(value)));
const bodyKeys = (body: Record<string, unknown>, required: string[], optional: string[] = []): boolean =>
  required.every((key) => Object.hasOwn(body, key)) && Object.keys(body).every((key) => required.includes(key) || optional.includes(key));
const requestKey: Guard<string> = (value): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value);
/** Core's audit note: required, trimmed, at most 1000 characters (DatesModerationReadService::reason). */
export const datesIntakeAuditNote: Guard<string> = (value): value is string => typeof value === "string"
  && value.trim() !== "" && Array.from(value.trim()).length <= 1000;

/** Closed browser shape of the publish command; Core still owns every domain rule. */
export function normalizeDatesIntakePublishBody(body: Record<string, unknown>): Record<string, unknown> | null {
  return bodyKeys(body, ["intake_id", "intake_revision", "event_index", "complete", "event", "reason", "idempotency_key"])
    && datesIntakeId(body.intake_id) && integer(1)(body.intake_revision) && integer(0, 99)(body.event_index) && bool(body.complete)
    && normalizeDatesExternalManualEvent(body.event) !== null && datesIntakeAuditNote(body.reason) && requestKey(body.idempotency_key) ? body : null;
}

/** Undefined: not an intake action. Null: refused here. Otherwise the body Core receives. */
export function normalizeDatesIntakeProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!DATES_INTAKE_PROXY_ACTIONS.includes(action as DatesIntakeProxyAction)) return undefined;
  if (action === "dates_event_intake_list") {
    if (!bodyKeys(body, [], ["status", "channel", "page", "limit"])) return null;
    const forwarded: Record<string, unknown> = {};
    for (const [key, values] of [["status", DATES_INTAKE_STATUSES], ["channel", DATES_INTAKE_CHANNELS]] as const) {
      if (!Object.hasOwn(body, key) || body[key] === "") continue;
      if (!oneOf(values)(body[key])) return null;
      forwarded[key] = body[key];
    }
    // Core treats a present-but-empty page or limit as malformed: send a number or nothing.
    for (const [key, maximum] of [["page", 10000], ["limit", 100]] as const) {
      if (!Object.hasOwn(body, key)) continue;
      if (!formInteger(body[key], 1, maximum)) return null;
      forwarded[key] = Number(body[key]);
    }
    return forwarded;
  }
  if (action === "dates_event_intake_detail") return bodyKeys(body, ["intake_id"]) && datesIntakeId(body.intake_id) ? body : null;
  if (action === "dates_event_intake_usage") {
    if (!bodyKeys(body, [], ["month"])) return null;
    if (!Object.hasOwn(body, "month") || body.month === "") return {};
    return month(body.month) ? { month: body.month } : null;
  }
  if (action === "dates_event_intake_lease") return bodyKeys(body, ["intake_id", "action", "expected_revision"]) && datesIntakeId(body.intake_id)
    && oneOf(DATES_INTAKE_LEASE_ACTIONS)(body.action) && integer(1)(body.expected_revision) ? body : null;
  // A rejection as a duplicate may name the event that is already there; with any other reason Core refuses the name.
  if (action === "dates_event_intake_reject") return bodyKeys(body, ["intake_id", "expected_revision", "reason_code", "reason", "idempotency_key"],
    ["duplicate_of_external_event_id"])
    && datesIntakeId(body.intake_id) && integer(1)(body.expected_revision) && oneOf(DATES_INTAKE_REJECT_REASONS)(body.reason_code)
    && datesIntakeAuditNote(body.reason) && requestKey(body.idempotency_key)
    && (!Object.hasOwn(body, "duplicate_of_external_event_id") || (body.reason_code === "duplicate" && externalEventId(body.duplicate_of_external_event_id))) ? body : null;
  // The fields travel as a list (the bridge's form encoder writes it as the one JSON string Core reads).
  if (action === "dates_event_intake_ask_member") return bodyKeys(body, ["intake_id", "expected_revision", "fields", "reason", "idempotency_key"], ["member_note"])
    && datesIntakeId(body.intake_id) && integer(1)(body.expected_revision) && datesIntakeAskFields(body.fields)
    && datesIntakeAuditNote(body.reason) && requestKey(body.idempotency_key)
    && (!Object.hasOwn(body, "member_note") || datesIntakeMemberNote(body.member_note)) ? body : null;
  return normalizeDatesIntakePublishBody(body);
}

// ---------------------------------------------------------------- "Draft from source"

export type DatesIntakeSourceKind = typeof DATES_INTAKE_INPUT_KINDS[number];
export type DatesIntakeUploadType = "jpeg" | "png" | "webp" | "heic";
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

/** The image types Core accepts, recognised from the file's first bytes exactly as Core does. */
export function datesIntakeUploadType(header: Uint8Array): DatesIntakeUploadType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...header.slice(from, to));
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "jpeg";
  if (header.length >= 8 && header[0] === 0x89 && ascii(1, 4) === "PNG" && header[4] === 0x0d && header[5] === 0x0a
    && header[6] === 0x1a && header[7] === 0x0a) return "png";
  if (header.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (header.length >= 12 && ascii(4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(8, 12))) return "heic";
  return null;
}

/** PHP `trim()`, as Core applies it to the submitted line. */
const phpTrim = (value: string) => value.replace(/^[\x20\t\n\r\0\v]+|[\x20\t\n\r\0\v]+$/g, "");
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The line of text as Core will store it (control characters become spaces), or null when Core would refuse it. */
export function datesIntakeSourceText(value: unknown): string | null {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) return null;
  const text = phpTrim(value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu, " "));
  return text !== "" && [...graphemes.segment(text)].length <= DATES_INTAKE_MAX_TEXT_GRAPHEMES ? text : null;
}

/**
 * A plausible web address. Core's fetcher has the real fence (no credentials,
 * no address literal, no private host, no login-walled site) and answers with
 * its own refusal; this only stops what is plainly not an address.
 */
export function datesIntakeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = phpTrim(value);
  if (candidate === "" || candidate.length > DATES_INTAKE_MAX_URL_LENGTH || /[\x00-\x20\x7f\\]/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") && url.username === "" && url.password === ""
      ? candidate : null;
  } catch { return null; }
}

export type DatesIntakeCreateFields =
  | { kind: "url"; url: string; locale: "en" | "hu"; idempotency_key: string }
  | { kind: "text"; text: string; locale: "en" | "hu"; idempotency_key: string }
  | { kind: "images"; text: string | null; locale: "en" | "hu"; idempotency_key: string };

/**
 * The scalar part of a create request, as the console's server route accepts
 * it: exactly the one source the kind names (a flyer may come with a line of
 * text), as Core requires. `imageCount` is the number of files that arrived.
 */
export function normalizeDatesIntakeCreateFields(fields: Record<string, unknown>, imageCount: number): DatesIntakeCreateFields | null {
  const { kind, locale, idempotency_key: key } = fields;
  if (!oneOf(DATES_INTAKE_INPUT_KINDS)(kind) || (locale !== "en" && locale !== "hu") || !requestKey(key)) return null;
  const has = (name: string) => Object.hasOwn(fields, name) && fields[name] !== "" && fields[name] !== null && fields[name] !== undefined;
  if (kind === "url") {
    const url = datesIntakeSourceUrl(fields.url);
    return url !== null && !has("text") && imageCount === 0 ? { kind, url, locale, idempotency_key: key } : null;
  }
  if (has("url")) return null;
  if (kind === "text") {
    const text = datesIntakeSourceText(fields.text);
    return text !== null && imageCount === 0 ? { kind, text, locale, idempotency_key: key } : null;
  }
  if (imageCount < 1 || imageCount > DATES_INTAKE_MAX_IMAGES) return null;
  const text = has("text") ? datesIntakeSourceText(fields.text) : null;
  return has("text") && text === null ? null : { kind, text, locale, idempotency_key: key };
}

/** The statuses in which the worker still owns the intake and the page should keep asking. */
export const DATES_INTAKE_WORKING_STATUSES: readonly DatesIntakeStatus[] = ["received", "screening", "extracting", "validating", "awaiting_budget"];
export function datesIntakeInProgress(status: DatesIntakeStatus): boolean {
  return DATES_INTAKE_WORKING_STATUSES.includes(status);
}

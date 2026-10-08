import { DATES_ACTIVITY_TYPES, datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import {
  DATES_EXTERNAL_CATEGORIES, datesExternalDefaultDuration, datesExternalHttpsUrl,
  normalizeDatesExternalEditorInput, normalizeDatesExternalManualEvent,
  type DatesExternalEditorInput,
} from "@/lib/datesExternalInput";
import { DATES_INTAKE_CHANNELS, decodeDatesIntakePublishReceipt, normalizeDatesIntakePublishBody, type DatesIntakePublishReceipt } from "@/lib/datesIntakeAdmin";

export const DATES_EXTERNAL_ACTIONS = [
  "dates_external_event_list", "dates_external_event_detail",
  "dates_external_event_publish", "dates_external_event_update",
  "dates_external_event_command",
  "dates_external_event_place_search",
] as const;
export type DatesExternalAction = typeof DATES_EXTERNAL_ACTIONS[number];
export const DATES_EXTERNAL_STATUSES = ["in_review", "published", "rechecking", "canceled_upstream", "withdrawn", "ended", "merged_into", "rejected"] as const;
export const DATES_EXTERNAL_TIERS = ["admin", "official", "corroborated", "single_source"] as const;
export const DATES_EXTERNAL_CHANNELS = ["admin", "member_suggestion", "ai_research"] as const;
export const DATES_EXTERNAL_COMMANDS = ["withdraw", "cancel", "reverify", "official_update"] as const;

type Guard<T> = (value: unknown) => value is T;
type Parsed<T> = T extends Guard<infer U> ? U : never;
type Shape = Record<string, Guard<unknown>>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bool: Guard<boolean> = (value) => typeof value === "boolean";
const literal = <T extends string | number | boolean | null>(expected: T): Guard<T> => (value): value is T => value === expected;
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Guard<number> => (value): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const epoch = integer(1, 4_102_444_800);
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const text = (minimum: number, maximum: number): Guard<string> => (value): value is string => {
  if (typeof value !== "string" || value.length > 64000 || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value)) return false;
  const length = [...segmenter.segment(value)].length;
  return length >= minimum && length <= maximum;
};
const oneOf = <T extends readonly string[]>(values: T): Guard<T[number]> => (value): value is T[number] =>
  typeof value === "string" && values.includes(value);
const nullable = <T>(guard: Guard<T>): Guard<T | null> => (value): value is T | null => value === null || guard(value);
const id = (prefix: string): Guard<string> => (value): value is string => typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value);
/**
 * A body of Core is bound on its fields: each named key must be there and
 * valid, and a key this console does not know is tolerated (D-143). No decoder
 * of a Core body checks an exact key set; closed VOCABULARIES stay closed.
 */
const object = <S extends Shape>(shape: S): Guard<{ [K in keyof S]: Parsed<S[K]> }> => (value): value is { [K in keyof S]: Parsed<S[K]> } =>
  record(value) && Object.entries(shape).every(([key, guard]) => Object.hasOwn(value, key) ? guard(value[key]) : OPTIONAL.has(guard));
/**
 * A key Core serves only to a request that carried the Admin intake contract selector (D-143): absent, or present and
 * valid. Present-but-undefined cannot come out of JSON and is not accepted as "absent".
 */
const OPTIONAL = new WeakSet<Guard<unknown>>();
const optional = <T>(guard: Guard<T>): Guard<T | undefined> => {
  const made: Guard<T | undefined> = (value): value is T | undefined => guard(value);
  OPTIONAL.add(made);
  return made;
};
const array = <T>(guard: Guard<T>, maximum: number, minimum = 0): Guard<T[]> => (value): value is T[] =>
  Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(guard);
const capabilities: Guard<string[]> = (value): value is string[] => array(text(1, 100), 100)(value)
  && value.every((item) => /^dates_[a-z0-9_]+$/.test(item)) && new Set(value).size === value.length;
const localTimestamp: Guard<string> = (value): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value);

const rowShape = {
  external_event_id: id("xev"), activity_id: id("act"), revision: integer(1), activity_revision: integer(1),
  status: oneOf(DATES_EXTERNAL_STATUSES), lifecycle: oneOf(["draft", "active", "ended", "canceled"] as const),
  moderation_state: oneOf(["ok", "pending", "approved", "rejected", "removed", "appealed"] as const), soft_deleted: bool,
  title: text(3, 120), category: oneOf(DATES_EXTERNAL_CATEGORIES), sensitive: bool,
  start_at: epoch, end_at: epoch, start_local: localTimestamp, end_local: localTimestamp, timezone: text(1, 80),
  city: text(1, 120), country_code: ((v: unknown): v is string => typeof v === "string" && /^[A-Z]{2}$/.test(v)),
  venue_name: text(1, 200), organizer_name: text(1, 160), verification_tier: oneOf(DATES_EXTERNAL_TIERS),
  checked_at: epoch, next_reverify_at: epoch, credit_channel: oneOf(DATES_EXTERNAL_CHANNELS),
  going_count: integer(), interested_count: integer(), created_at: epoch, updated_at: epoch, can_edit: bool,
};
// P2a: the list row ends with the label the detail carries. `rowShape` stays the
// part both share; the detail has its own `ai_assisted` among its extra keys.
// D-143: Core serves the label only to a request that carried the Admin intake
// contract selector. Without it the row is the released P1 row, and the label
// is absent: absent means "not AI-assisted" (`ai_assisted !== true`).
const rowGuard = object({ ...rowShape, ai_assisted: optional(bool) });
export type DatesExternalRow = Parsed<typeof rowGuard>;
/** The intake an event was published from, as Core's ledger recorded it: never the provider, never a person. */
const intakeReferenceGuard = object({ intake_id: id("xin"), channel: oneOf(DATES_INTAKE_CHANNELS), event_index: integer(0) });
export type DatesExternalIntakeReference = Parsed<typeof intakeReferenceGuard>;

const envelope = { success: literal(true), status_code: literal(200), message: literal(200), status: literal(200), can_send: literal(0), server_now: epoch };
const placeText = (minimum: number, maximum: number): Guard<string> => (value): value is string => text(minimum, maximum)(value)
  && !/[\x7f-\x9f]/u.test(value);
const coordinate = (maximum: number): Guard<number> => (value): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
const placeGuard = object({ place_id: ((value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value)),
  name: placeText(1, 200), formatted_address: placeText(1, 400), city: placeText(1, 120), country_code: rowShape.country_code,
  latitude: coordinate(90), longitude: coordinate(180), timezone: nullable(text(1, 80)), public_venue_warning: bool,
  attributions: array(object({ provider: placeText(1, 200), uri: datesExternalHttpsUrl }), 20) });
export type DatesExternalPlace = Parsed<typeof placeGuard>;
const placesGuard = object({ ...envelope, places: array(placeGuard, 10), available: bool,
  unavailable_reason: nullable(oneOf(["provider_unavailable", "rate_limited"] as const)), manual_entry: literal(true),
  provider: literal("google_maps"), attribution: literal("Google Maps") });
export type DatesExternalPlaces = Parsed<typeof placesGuard>;
export function decodeDatesExternalPlaces(value: unknown): DatesExternalPlaces | null {
  if (!placesGuard(value) || (value.available ? value.unavailable_reason !== null
    : value.unavailable_reason === null || value.places.length !== 0)
    || new Set(value.places.map((place) => place.place_id)).size !== value.places.length) return null;
  for (const place of value.places) {
    if (place.timezone !== null) { try { new Intl.DateTimeFormat("en", { timeZone: place.timezone }); } catch { return null; } }
  }
  return value;
}
export function datesExternalPlaceQuery(value: unknown): value is string {
  return typeof value === "string" && placeText(2, 200)(value.trim());
}
const listGuard = object({ ...envelope, events: array(rowGuard, 100), page: integer(1, 10000), limit: integer(1, 100), total: integer(), capabilities });
export type DatesExternalList = Parsed<typeof listGuard>;

const freshEditor: Guard<DatesExternalEditorInput> = (value): value is DatesExternalEditorInput => normalizeDatesExternalEditorInput(value) !== null;
const multiline: Guard<string> = (value): value is string => typeof value === "string" && value.length > 0
  && !/[\x00-\x08\x0b-\x1f\x7f\uD800-\uDFFF]/u.test(value) && value.length <= 32000;
const factsShape = {
  title: text(3, 120), summary: object({ en: multiline, hu: multiline }), category: oneOf(DATES_EXTERNAL_CATEGORIES),
  sensitive: object({ flag: bool, reason: nullable(text(1, 300)) }), start_at: epoch, end_at: epoch,
  start_local: localTimestamp, end_local: localTimestamp, end_estimated: bool, all_day: bool, timezone: text(1, 80),
  is_free: bool, price_text: nullable(text(1, 200)), age_restriction: nullable(integer(18, 99)),
};
const coordinates: Guard<[number, number]> = (value): value is [number, number] => Array.isArray(value) && value.length === 2
  && value.every((item) => typeof item === "number" && Number.isFinite(item)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
// P2a: an event published from an intake keeps the Places id of the venue the
// reviewer left untouched; every other venue is an administrator's pin.
const venueShape = {
  place_id: nullable(((value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value))),
  name: text(1, 200), formatted_address: text(1, 400),
  point: object({ type: literal("Point"), coordinates }), city: text(1, 120), city_key: text(1, 512),
  country_code: rowShape.country_code, resolved_by: oneOf(["admin_pin", "places"] as const), resolved_at: epoch,
};
const organizerGuard = object({ name: text(1, 160), website: nullable(datesExternalHttpsUrl) });
const linksGuard = object({ official_url: nullable(datesExternalHttpsUrl), ticket_url: nullable(datesExternalHttpsUrl) });
const verificationGuard = object({ tier: oneOf(DATES_EXTERNAL_TIERS), checked_at: epoch, next_reverify_at: epoch,
  // Each is what an administrator confirmed. An event Core published without a reviewer (the member channel's
  // autopublish switch, default off) carries none - "no confirmation that nobody gave" - so they are booleans, not `true`.
  admin_confirmations: object({ source: bool, public_venue: bool, timezone: bool, content_safe: bool }) });
const sourceGuard = object({ source_id: id("src"), kind: oneOf(["admin", "flyer", "url", "web_search", "web_fetch", "research"] as const),
  url: datesExternalHttpsUrl, hostname: text(1, 253), confirmed_at: epoch });
const detailRowGuard = object({ ...rowShape, facts: object(factsShape), venue: object(venueShape), organizer: organizerGuard,
  links: linksGuard, attendee_list: oneOf(["visible", "count_only"] as const), verification: verificationGuard,
  image: object({ kind: literal("category_art"), url: literal(null), credit: literal(null), license_note: literal(null) }),
  credit: object({ channel: oneOf(DATES_EXTERNAL_CHANNELS), submitted_by_uid: nullable(integer(1)), anonymous: bool, first_submitter_uid: nullable(integer(1)) }),
  // P2a: true exactly when Core's ledger records the AI intake that drafted the event.
  // `intake` is null for a manual event and names the intake of an AI-drafted one.
  // D-143: `intake` is served only with the selector; absent means "not known here" and is shown as no link.
  sources: array(sourceGuard, 20, 1), ai_assisted: bool, editor_input: freshEditor, intake: optional(nullable(intakeReferenceGuard)) });
export type DatesExternalDetailRow = Parsed<typeof detailRowGuard>;
const detailGuard = object({ ...envelope, event: detailRowGuard, capabilities });
export type DatesExternalDetail = Parsed<typeof detailGuard>;

function rowConsistent(row: DatesExternalRow, caps: string[], now: number): boolean {
  return row.end_at > row.start_at && row.end_at - row.start_at <= (row.category === "festival" ? 14 : 1) * 86400
    // Core owns venue-local strings. Browser/PHP timezone databases can differ;
    // decoding a read must not reinterpret them through the browser database.
    && row.created_at <= row.updated_at && row.updated_at <= now && row.checked_at <= now
    && row.next_reverify_at >= row.checked_at
    && row.can_edit === (caps.includes("dates_external_event_manage") && ["published", "rechecking", "in_review"].includes(row.status)
      && row.lifecycle === "active" && !row.soft_deleted);
}

export function decodeDatesExternalList(value: unknown, expected: { page: number; limit: number }): DatesExternalList | null {
  if (!listGuard(value) || value.page !== expected.page || value.limit !== expected.limit
    || !value.capabilities.includes("dates_external_event_read") || value.events.length > value.limit
    || new Set(value.events.map((row) => row.external_event_id)).size !== value.events.length
    || new Set(value.events.map((row) => row.activity_id)).size !== value.events.length
    || !value.events.every((row) => rowConsistent(row, value.capabilities, value.server_now))) return null;
  // Core reads the page and count independently. Concurrent publication/purge
  // may change total between them; do not invent a snapshot-consistency promise.
  for (let index = 1; index < value.events.length; index++) {
    const previous = value.events[index - 1], current = value.events[index];
    if (previous.updated_at < current.updated_at || (previous.updated_at === current.updated_at && previous.external_event_id >= current.external_event_id)) return null;
  }
  return value;
}

export function decodeDatesExternalDetail(value: unknown, externalId: string): DatesExternalDetail | null {
  return detailGuard(value) && value.event.external_event_id === externalId
    && decodeDatesExternalEvent(value.event, value.capabilities, value.server_now) ? value : null;
}

/** Same safe nested DTO is served by the existing activity detail route. */
export function decodeDatesExternalEvent(value: unknown, caps: string[], now: number): DatesExternalDetailRow | null {
  if (!epoch(now) || !detailRowGuard(value) || !caps.includes("dates_external_event_read") || !rowConsistent(value, caps, now)) return null;
  const row = value, facts = row.facts, editor = row.editor_input;
  if (["title", "category", "start_at", "timezone"].some((key) =>
    row[key as keyof typeof row] !== facts[key as keyof typeof facts] || facts[key as keyof typeof facts] !== editor[key as keyof typeof editor])
    || row.end_at !== facts.end_at
    || (facts.end_estimated ? editor.end_at !== null || facts.end_at - facts.start_at !== datesExternalDefaultDuration(facts.category) : editor.end_at !== facts.end_at)
    || row.start_local !== facts.start_local || row.end_local !== facts.end_local || row.sensitive !== facts.sensitive.flag
    || facts.sensitive.flag !== editor.sensitive.flag || facts.sensitive.reason !== editor.sensitive.reason
    || facts.summary.en !== editor.summary.en || facts.summary.hu !== editor.summary.hu
    || facts.all_day !== editor.all_day || facts.is_free !== editor.is_free || facts.price_text !== editor.price_text
    || facts.age_restriction !== editor.age_restriction || row.attendee_list !== editor.attendee_list
    || (row.sensitive && row.attendee_list !== "count_only")
    || row.city !== row.venue.city || row.country_code !== row.venue.country_code || row.venue_name !== row.venue.name
    || row.venue.name !== editor.venue.name || row.venue.formatted_address !== editor.venue.formatted_address
    || row.venue.city !== editor.venue.city || row.venue.country_code !== editor.venue.country_code
    || row.venue.point.coordinates[0] !== editor.venue.longitude || row.venue.point.coordinates[1] !== editor.venue.latitude
    || row.organizer_name !== row.organizer.name || row.organizer.name !== editor.organizer.name || row.organizer.website !== editor.organizer.website
    || row.links.official_url !== editor.links.official_url || row.links.ticket_url !== editor.links.ticket_url
    || row.verification_tier !== row.verification.tier || row.checked_at !== row.verification.checked_at
    || row.next_reverify_at !== row.verification.next_reverify_at || row.sources[0].url !== editor.source_url
    || row.credit.channel !== row.credit_channel
    || (row.venue.resolved_by === "places") !== (row.venue.place_id !== null)
    // Core derives both from the same ledger record: an AI-assisted event names its intake, a manual one has none.
    // The rule binds the two when the reference is served at all (it is not, without the selector).
    || (row.intake !== undefined && row.ai_assisted !== (row.intake !== null))
    || (row.credit.channel === "admin" && (row.credit.submitted_by_uid !== null || row.credit.first_submitter_uid !== null || !row.credit.anonymous))
    || new Set(row.sources.map((source) => source.source_id)).size !== row.sources.length
    || row.sources.some((source) => new URL(source.url).hostname !== source.hostname || source.confirmed_at > now)) return null;
  return value;
}

const activityShape = {
  activity_id: id("act"), title: text(0, 120), activity_type: oneOf(DATES_ACTIVITY_TYPES),
  lifecycle: rowShape.lifecycle, moderation_state: rowShape.moderation_state,
  pending_public_moderation_state: nullable(rowShape.moderation_state), time_mode: oneOf(["now", "scheduled", "tbd"] as const),
  start_at: nullable(epoch), end_at: nullable(epoch), location_mode: oneOf(["live", "exact", "city"] as const),
  city: nullable(text(0, 120)), country_code: nullable(text(2, 3)), join_mode: oneOf(["auto", "approval"] as const), maximum_people: nullable(integer(1)),
  going_count: integer(), pending_count: integer(), report_count: integer(), soft_deleted: bool, revision: integer(1), created_at: epoch, updated_at: epoch,
};
// Member writers bound graphemes but permit interior tabs/newlines. Do not
// apply the stricter external editor's text policy to existing member rows.
const memberText = (maximum: number): Guard<string> => (value): value is string => typeof value === "string"
  && value.length <= 64000 && !/[\uD800-\uDFFF]/u.test(value) && [...segmenter.segment(value)].length <= maximum;
const memberActivityShape = { ...activityShape, title: memberText(120), city: nullable(memberText(120)) };
// Core projects the stored profile name as-is; there is no 200-grapheme DTO bound.
const memberHost = object({ uid: integer(1), display_name: memberText(64000) });
const externalActivityShape = { origin: literal("external"), external_event_id: id("xev"), host: literal(null),
  organizer_name: text(1, 160), organizer_url: nullable(datesExternalHttpsUrl), verification_tier: oneOf(DATES_EXTERNAL_TIERS),
  ai_assisted: bool, can_host_transfer: literal(false) };
/**
 * What tells the two kinds of activity apart is `origin` (and the event id that goes with it), not the size of the
 * key set: a member's activity carries neither, an external one carries `origin: "external"`. A row that names an
 * origin but is not a whole external row is nothing - it is never read as a member's activity.
 */
const externalMarked = (value: unknown) => record(value) && (Object.hasOwn(value, "origin") || Object.hasOwn(value, "external_event_id"));
const memberActivityFields = object({ ...memberActivityShape, host: memberHost });
const memberActivityGuard: Guard<Parsed<typeof memberActivityFields>> = (value): value is Parsed<typeof memberActivityFields> =>
  memberActivityFields(value) && !externalMarked(value);
const externalActivityGuard = object({ ...activityShape, ...externalActivityShape });
export type DatesActivityListRow = Parsed<typeof memberActivityGuard> | Parsed<typeof externalActivityGuard>;
const activityRowGuard: Guard<DatesActivityListRow> = (value): value is DatesActivityListRow => memberActivityGuard(value)
  || (externalActivityGuard(value) && value.time_mode === "scheduled" && value.start_at !== null && value.end_at !== null
    && value.end_at > value.start_at && value.location_mode === "exact" && value.join_mode === "auto" && value.maximum_people === null && value.pending_count === 0);
const activityListGuard = object({ ...envelope, activities: array(activityRowGuard, 100), page: integer(1, 10000), limit: integer(1, 100), total: integer() });
export function decodeDatesActivityList(value: unknown, expected: { page: number; limit: number }) {
  return activityListGuard(value) && value.page === expected.page && value.limit === expected.limit && value.activities.length <= value.limit
    && new Set(value.activities.map((row) => row.activity_id)).size === value.activities.length ? value : null;
}

export type DatesActivityUnreadableRow = { index: number; activity_id: string | null };
export type DatesActivityDisplayRow = DatesActivityListRow & { unreadable_fields?: string[] };

/** Repair presentation fields only; never invent identity, CAS, origin or host UID. */
function projectMemberActivity(value: unknown, detail: boolean) {
  if (!record(value) || Object.hasOwn(value, "origin") || Object.hasOwn(value, "external_event_id") || !record(value.host)) return null;
  const row: Record<string, unknown> & { host: Record<string, unknown> } = { ...value, host: { ...value.host } };
  const fields: string[] = [];
  if (!memberText(120)(row.title)) { row.title = ""; fields.push("title"); }
  if (!nullable(memberText(120))(row.city)) { row.city = null; fields.push("city"); }
  if (!memberText(64000)(row.host.display_name)) { row.host.display_name = ""; fields.push("host.display_name"); }
  if (detail && !(row.details === null || typeof row.details === "string")) { row.details = null; fields.push("details"); }
  if (detail ? !memberActivityDetailGuard(row) : !memberActivityGuard(row)) return null;
  return { row, fields };
}

/** Operator list projection: a damaged row cannot suppress its neighbours. */
export function projectDatesActivityList(value: unknown, expected: { page: number; limit: number }) {
  const guard = object({ ...envelope, activities: array(((_: unknown): _ is unknown => true), 100),
    page: integer(1, 10000), limit: integer(1, 100), total: integer() });
  if (!guard(value) || value.page !== expected.page || value.limit !== expected.limit || value.activities.length > value.limit) return null;
  const activities: DatesActivityDisplayRow[] = [], unreadable_rows: DatesActivityUnreadableRow[] = [];
  const ids = value.activities.map((row) => record(row) && id("act")(row.activity_id) ? row.activity_id : null);
  for (const [index, item] of value.activities.entries()) {
    const duplicate = ids[index] !== null && ids.filter((candidate) => candidate === ids[index]).length > 1;
    if (!duplicate && activityRowGuard(item)) { activities.push(item); continue; }
    const repaired = duplicate ? null : projectMemberActivity(item, false);
    if (repaired && memberActivityGuard(repaired.row)) activities.push({ ...repaired.row, unreadable_fields: repaired.fields });
    else unreadable_rows.push({ index, activity_id: ids[index] });
  }
  return { ...value, activities, unreadable_rows };
}

const activityDetailExtras = { details: nullable(((value: unknown): value is string => typeof value === "string")), photo: ((_: unknown): _ is unknown => true),
  photos: optional(array(object({ id: text(1, 100), url: text(1, 2048), moderation_state: oneOf(["pending", "approved", "rejected", "removed", "appealed"] as const) }), 10)),
  timezone: nullable(text(1, 80)), auto_end_at: nullable(epoch), tbd_expires_at: nullable(epoch), audience: nullable(record),
  pending_public_revision: nullable(record), live_sharing_state: oneOf(["off", "on", "paused"] as const), purge_eligible_at: nullable(epoch) };
const memberActivityDetailFields = object({ ...memberActivityShape, host: memberHost, ...activityDetailExtras });
const memberActivityDetailGuard: Guard<Parsed<typeof memberActivityDetailFields>> = (value): value is Parsed<typeof memberActivityDetailFields> =>
  memberActivityDetailFields(value) && !externalMarked(value);
const externalActivityDetailGuard = object({ ...activityShape, ...externalActivityShape, ...activityDetailExtras });
export type DatesActivityDetailRow = Parsed<typeof memberActivityDetailGuard> | Parsed<typeof externalActivityDetailGuard>;
export type DatesActivityDisplayDetail = DatesActivityDetailRow & { unreadable_fields?: string[] };

export function projectDatesActivityOriginDetail(response: unknown, activityId: string, caps: string[]):
  { activity: DatesActivityDisplayDetail; external: DatesExternalDetailRow | null } | null {
  const strict = decodeDatesActivityOriginDetail(response, activityId, caps);
  if (strict) return strict;
  if (!record(response) || response.success !== true || response.status_code !== 200 || response.status !== 200
    || response.message !== 200 || response.can_send !== 0 || !epoch(response.server_now) || Object.hasOwn(response, "external_event")) return null;
  const repaired = projectMemberActivity(response.activity, true);
  return repaired && memberActivityDetailGuard(repaired.row) && repaired.row.activity_id === activityId
    ? { activity: { ...repaired.row, unreadable_fields: repaired.fields }, external: null } : null;
}

/** Validate the changed origin boundary without trusting UID0 or mixed revisions. */
export function decodeDatesActivityOriginDetail(response: unknown, activityId: string, caps: string[]):
  { activity: DatesActivityDetailRow; external: DatesExternalDetailRow | null } | null {
  if (!record(response) || response.success !== true || response.status_code !== 200 || response.status !== 200
    || response.message !== 200 || response.can_send !== 0 || !epoch(response.server_now)) return null;
  const activity = response.activity;
  if (memberActivityDetailGuard(activity)) return activity.activity_id === activityId && !Object.hasOwn(response, "external_event")
    ? { activity, external: null } : null;
  if (!externalActivityDetailGuard(activity) || activity.activity_id !== activityId || activity.live_sharing_state !== "off"
    || activity.time_mode !== "scheduled" || activity.location_mode !== "exact" || activity.join_mode !== "auto"
    || activity.maximum_people !== null || activity.pending_count !== 0) return null;
  const external = decodeDatesExternalEvent(response.external_event, caps, response.server_now);
  if (!external || external.external_event_id !== activity.external_event_id || external.activity_id !== activityId
    || external.activity_revision !== activity.revision || external.title !== activity.title || external.start_at !== activity.start_at
    || external.end_at !== activity.end_at || external.timezone !== activity.timezone || external.city !== activity.city
    || external.country_code !== activity.country_code || external.soft_deleted !== activity.soft_deleted
    || external.lifecycle !== activity.lifecycle || external.moderation_state !== activity.moderation_state
    || external.organizer_name !== activity.organizer_name || external.organizer.website !== activity.organizer_url
    || external.verification_tier !== activity.verification_tier
    // One ledger record says whether the AI drafted the event; the two projections cannot disagree about it.
    || external.ai_assisted !== activity.ai_assisted) return null;
  return { activity, external };
}

export function datesExternalProxyCapabilityAuthorized(action: string, membership: unknown): boolean | undefined {
  if (!DATES_EXTERNAL_ACTIONS.includes(action as DatesExternalAction)) return undefined;
  const principal = datesAdminPrincipal(membership);
  const read = action === "dates_external_event_list" || action === "dates_external_event_detail";
  return principal !== null && hasDatesCapability(principal, read ? "dates_external_event_read" : "dates_external_event_manage");
}

const formInteger = (value: unknown, minimum: number, maximum: number): boolean =>
  integer(minimum, maximum)(value) || (typeof value === "string" && /^[1-9][0-9]*$/.test(value) && integer(minimum, maximum)(Number(value)));
const bodyKeys = (body: Record<string, unknown>, required: string[], optional: string[] = []): boolean =>
  required.every((key) => Object.hasOwn(body, key)) && Object.keys(body).every((key) => [...required, ...optional].includes(key));
const requestKey: Guard<string> = (value): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value);
const reason: Guard<string> = (value): value is string => typeof value === "string" && Array.from(value.trim()).length >= 3
  && Array.from(value).length <= 1000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uD800-\uDFFF]/u.test(value);
export function datesExternalOfficialText(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(value)) return false;
  const size = [...segmenter.segment(value.trim())].length;
  return size >= 1 && size <= 500;
}

const receiptShape = { ...envelope, external_event_id: id("xev"), activity_id: id("act"), revision: integer(1),
  activity_revision: integer(1), event_status: oneOf(DATES_EXTERNAL_STATUSES), audit_id: id("aud"), replayed: bool };
/**
 * The receipt of a publication or an update echoes no action; the receipt of a command echoes its own. That - not the
 * size of the key set - is what keeps one from being read as the other.
 */
const receiptFields = object(receiptShape);
const receiptGuard: Guard<Parsed<typeof receiptFields>> = (value): value is Parsed<typeof receiptFields> =>
  receiptFields(value) && !Object.hasOwn(value, "action");
const commandReceiptGuard = object({ ...receiptShape, action: oneOf(["withdraw", "cancel", "reverify"] as const),
  lifecycle: rowShape.lifecycle, soft_deleted: bool });
const updateReceiptGuard = object({ ...receiptShape, action: literal("official_update"), lifecycle: rowShape.lifecycle,
  soft_deleted: bool, thread_id: id("thr"), message_id: id("msg"), message_sequence: integer(1) });
const activityReceiptShape = { ...envelope, external_event_id: id("xev"), activity_id: id("act"), revision: integer(1),
  activity_revision: integer(1), external_revision: integer(1), audit_id: id("aud"), idempotency_replayed: bool };
const activityCommandReceiptGuard = object({ ...activityReceiptShape, action: oneOf(["end", "cancel", "soft_delete", "restore"] as const),
  event_status: oneOf(DATES_EXTERNAL_STATUSES), lifecycle: rowShape.lifecycle, soft_deleted: bool });
const activityPurgeReceiptGuard = object({ ...activityReceiptShape, purged: literal(true) });
export type DatesExternalReceipt = Parsed<typeof receiptGuard> | Parsed<typeof commandReceiptGuard> | Parsed<typeof updateReceiptGuard>
  | Parsed<typeof activityCommandReceiptGuard> | Parsed<typeof activityPurgeReceiptGuard> | DatesIntakePublishReceipt;
export type DatesExternalMutationBaseline = Pick<DatesExternalRow, "external_event_id" | "activity_id" | "revision" | "activity_revision" | "status" | "lifecycle" | "soft_deleted">;
/** `dates_event_intake_publish` (P2a) is the same publisher, entered from a reviewed AI intake. */
export type DatesExternalMutationAction = "dates_external_event_publish" | "dates_external_event_update" | "dates_external_event_command" | "dates_activity_command"
  | "dates_event_intake_publish";

export function decodeDatesExternalReceipt(value: unknown, action: DatesExternalMutationAction,
  body: Record<string, unknown>, baseline: DatesExternalMutationBaseline | null): DatesExternalReceipt | null {
  if (action === "dates_external_event_publish") {
    // A manual publication names no intake; the receipt that does is the intake publication's (decoded below).
    return baseline === null && receiptGuard(value) && !Object.hasOwn(value, "intake") && value.revision === 1 && value.activity_revision === 1
      && value.event_status === "published" ? value : null;
  }
  if (action === "dates_event_intake_publish") return baseline === null ? decodeDatesIntakePublishReceipt(value, body) : null;
  if (action === "dates_activity_command") {
    if (!baseline || body.activity_id !== baseline.activity_id || Number(body.expected_revision) !== baseline.activity_revision) return null;
    if (body.action === "purge") return activityPurgeReceiptGuard(value) && value.external_event_id === baseline.external_event_id
      && value.activity_id === baseline.activity_id && value.revision === baseline.activity_revision
      && value.activity_revision === baseline.activity_revision && value.external_revision === baseline.revision ? value : null;
    if (!activityCommandReceiptGuard(value) || value.action !== body.action || value.external_event_id !== baseline.external_event_id
      || value.activity_id !== baseline.activity_id || value.revision !== baseline.activity_revision + 1 || value.activity_revision !== value.revision
      || value.external_revision <= baseline.revision) return null;
    const terminal = body.action === "end" || body.action === "cancel";
    return value.event_status === (body.action === "end" ? "ended" : body.action === "cancel" ? "canceled_upstream" : baseline.status)
      && value.lifecycle === (terminal ? body.action === "end" ? "ended" : "canceled" : baseline.lifecycle)
      && value.soft_deleted === (body.action === "soft_delete") ? value : null;
  }
  if (!baseline || body.external_event_id !== baseline.external_event_id || Number(body.expected_revision) !== baseline.revision) return null;
  const command = action === "dates_external_event_command";
  if (command ? !(body.action === "official_update" ? updateReceiptGuard(value) : commandReceiptGuard(value)) : !receiptGuard(value)) return null;
  const receipt = value as Parsed<typeof receiptGuard> | Parsed<typeof commandReceiptGuard> | Parsed<typeof updateReceiptGuard>;
  if (receipt.external_event_id !== baseline.external_event_id || receipt.activity_id !== baseline.activity_id
    || receipt.revision !== baseline.revision + 1 || receipt.activity_revision <= baseline.activity_revision) return null;
  const status = command && body.action === "withdraw" ? "withdrawn" : command && body.action === "cancel" ? "canceled_upstream" : baseline.status;
  if (receipt.event_status !== status) return null;
  if (command && (!("action" in receipt) || receipt.action !== body.action || receipt.soft_deleted !== false
    || receipt.lifecycle !== (["withdraw", "cancel"].includes(String(body.action)) ? "canceled" : "active"))) return null;
  return receipt;
}

export type DatesExternalRefusal = { kind: "refused" | "uncertain"; error: string; status: number };
const refusalCodes: Readonly<Record<number, readonly string[]>> = {
  // Checked inside the transaction, after successful receipt replay lookup.
  // The intake tokens (P2a) are raised inside the publication's transaction too.
  // The same table settles the other intake commands (create, hold, reject),
  // so it names every token with which Core (285b14a8) refuses one of them
  // without writing: raised inside the command's transaction - after the
  // receipt lookup where the command has an identity - or by a check of the
  // request itself. It never names a transport failure, a 5xx,
  // `dates-admin-command-in-progress`, `dates-admin-idempotency-conflict` or a
  // capability refusal: none of those says whether an earlier attempt landed.
  // T-890: the two case commands no revision fences - the legal hold and the
  // live-trail capture - keep their identity like a journal command, so the
  // tokens with which Core (main 07215298) refuses them without writing are
  // named too. Every one is raised inside the command's transaction, after the
  // receipt lookup, or by a check of the request alone. Not named: the two that
  // depend on the clock and precede the lookup (`dates-legal-hold-review-invalid`,
  // `dates-trail-evidence-window-invalid`), and the conflict-of-interest refusals
  // (`dates-moderation-conflict`), which the accepted external-resolution
  // journal already treats as not settling a command.
  // The host-transfer request is the third command Core does not durably fence (its pending guard ends on a decline or
  // an expiry), so its tokens are named as well: all raised inside the request's transaction or by a check of the
  // request alone. Not named: `dates-disabled`, which is read from a switch before the receipt lookup.
  // P2b: the member channel's switch and the "duplicate of an event that is not there" refusal are raised inside the
  // publication's / the question's / the rejection's transaction too (Core 32d418cf).
  403: ["dates-external-publishing-disabled", "dates-intake-admin-drafts-disabled", "dates-intake-lease-owner-required",
    "dates-intake-suggestions-disabled"],
  404: ["dates-external-unavailable", "dates-admin-activity-unavailable", "dates-intake-unavailable",
    "dates-moderation-case-unavailable", "dates-moderation-evidence-unavailable", "dates-trail-evidence-unavailable",
    "dates-activity-unavailable"],
  409: ["dates-external-conflict", "dates-external-duplicate", "dates-external-content-state-invalid",
    "dates-external-projection-unavailable", "dates-external-command-state-invalid", "dates-external-thread-unavailable", "dates-thread-read-only",
    "dates-admin-stale-revision", "dates-admin-activity-purge-not-eligible", "dates-admin-activity-open-case", "dates-admin-activity-legal-hold",
    "dates-admin-activity-not-deleted", "dates-admin-activity-deleted", "dates-admin-activity-terminal",
    "dates-intake-conflict", "dates-intake-lease-required", "dates-intake-event-unavailable",
    "dates-intake-claimed", "dates-intake-lease-lost", "dates-intake-state-invalid",
    "dates-legal-hold-case-open", "dates-legal-hold-media-purge-started", "dates-trail-evidence-activity-unavailable",
    "dates-host-transfer-already-pending", "dates-host-transfer-target-not-joined", "dates-host-transfer-ineligible", "dates-stale-revision",
    "dates-intake-duplicate-event-unavailable"],
  // A request larger than Core reads at all.
  413: ["dates-intake-image-invalid"],
  422: ["dates-external-id-invalid", "dates-external-revision-invalid", "dates-external-filter-invalid", "dates-external-input-invalid",
    "dates-external-category-invalid", "dates-external-summary-invalid", "dates-external-sensitive-invalid", "dates-external-attendee-list-invalid",
    "dates-timezone-invalid", "dates-external-start-invalid", "dates-external-duration-invalid", "dates-external-time-invalid", "dates-external-age-invalid",
    "dates-external-organizer-invalid", "dates-external-url-invalid", "dates-external-source-required", "dates-external-price-invalid",
    "dates-external-paid-official-link-required", "dates-external-confirmation-required", "dates-external-venue-invalid", "dates-external-ticket-domain-invalid",
    "dates-title-invalid", "dates-admin-reason-required", "dates-admin-reason-invalid", "dates-admin-idempotency-invalid",
    "dates-external-command-invalid", "dates-update-text-invalid",
    "dates-intake-id-invalid", "dates-intake-revision-invalid", "dates-intake-input-invalid",
    "dates-intake-kind-invalid", "dates-intake-locale-invalid", "dates-intake-url-invalid", "dates-intake-source-not-readable",
    "dates-intake-text-invalid", "dates-intake-origin-invalid", "dates-intake-image-invalid", "dates-intake-reason-invalid",
    "dates-intake-lease-invalid",
    "dates-moderation-case-id-invalid", "dates-moderation-target-invalid", "dates-legal-hold-action-invalid",
    "dates-admin-revision-invalid", "dates-trail-evidence-range-too-large",
    "dates-host-transfer-target-invalid", "dates-admin-activity-id-invalid", "dates-admin-revision-required",
    "dates-event-icons-invalid", "dates-event-icon-invalid", "dates-event-icon-name-invalid",
    "dates-event-icon-image-required", "dates-event-icon-default-invalid",
    "dates-event-icon-removal-forbidden", "dates-event-icon-type-immutable",
    // The third-party pin catalogue (Core a356553a, DatesExternalPins::validate): each is raised by a check of the request
    // alone, before the command is looked up or run - and `-pins-invalid` also inside its transaction, for a stored
    // catalogue that does not validate.
    "dates-external-pins-invalid", "dates-external-pin-invalid", "dates-external-pin-name-invalid",
    "dates-external-pin-image-required", "dates-external-pin-color-invalid"],
};

/** Only pinned Core no-land refusals release an attempted command's identity. */
export function datesExternalRefusal(value: unknown): DatesExternalRefusal {
  const uncertain = { kind: "uncertain" as const, error: "unconfirmed", status: 0 };
  if (!record(value) || value.success !== false || typeof value.error !== "string" || !/^[a-z][a-z0-9-]{1,100}$/.test(value.error)
    || !integer(400, 599)(value.status_code)) return uncertain;
  // Core's refusal carries the legacy envelope (message, status, can_send) with its fixed values; the bridge's own
  // refusal carries none of the three. An envelope with only some of them, or with other values, is neither. Any
  // other key is tolerated: a refusal is bound on what it says, not on its exact key set.
  const legacy = ["message", "status", "can_send"].filter((key) => Object.hasOwn(value, key));
  const core = legacy.length === 3 && value.message === 200 && value.status === 200 && value.can_send === 0;
  const bridge = legacy.length === 0;
  if (!core && !bridge) return uncertain;
  // Revocation/proxy refusals can precede replay lookup after a prior success.
  // Conflicting keys, an in-progress command and server failures are not proof
  // that the earlier attempt did not land.
  return { kind: core && refusalCodes[value.status_code]?.includes(value.error) ? "refused" : "uncertain",
    error: value.error, status: value.status_code };
}

export type DatesCommandOutcome =
  | { kind: "success" }
  /** An answer to this request: it wrote nothing. */
  | { kind: "refused"; error: string }
  /** The command may or may not have landed. `error` is what was answered, when something readable was. */
  | { kind: "uncertain"; error: string | null };

/**
 * What a reply means for a Dates console command that is sent outside the
 * journal. `receipt` is the caller's own check of the success body.
 *
 * - `kept`: the command keeps its idempotency key across attempts, like a
 *   journal command, and the journal's rule applies unchanged: only a receipt
 *   or a pinned no-land refusal in Core's own envelope settles it. No page
 *   uses it since T-891 (Core fences the legal hold, the trail capture and the
 *   host transfer); it stays for a command Core cannot fence.
 * - `fresh`: the command is fenced by a revision (or by the existence of what
 *   it creates) and is sent under a new key each time, so a repeat cannot
 *   write twice. Every readable refusal below 500 answers this request. What
 *   stays unknown is whether an attempt landed when no answer came back, the
 *   answer was unreadable, the bridge named a transport failure, Core failed
 *   (5xx), or Core said the command is still in progress.
 */
export function datesCommandOutcome(response: unknown, receipt: boolean, identity: "kept" | "fresh"): DatesCommandOutcome {
  if (receipt) return { kind: "success" };
  const refusal = datesExternalRefusal(response);
  if (refusal.kind === "refused") return { kind: "refused", error: refusal.error };
  if (refusal.status === 0) return { kind: "uncertain", error: null };
  return identity === "fresh" && refusal.status < 500 && refusal.error !== "dates-admin-command-in-progress"
    ? { kind: "refused", error: refusal.error } : { kind: "uncertain", error: refusal.error };
}

/**
 * Routes whose success body the console could not check, taken as a receipt on
 * the bare success flag. EMPTY since T-891: the seven routes that were listed
 * here are checked on Core's genuine request / answer pairs
 * (lib/datesCommandReceipts.ts). A route is added here only with its reason,
 * and leaves it on the day its check exists.
 */
export const DATES_RECEIPT_CHECKS_PENDING: readonly string[] = [];

export function datesExternalBaseline(value: unknown): value is DatesExternalMutationBaseline {
  return object({ external_event_id: id("xev"), activity_id: id("act"), revision: integer(1), activity_revision: integer(1),
    status: oneOf(DATES_EXTERNAL_STATUSES), lifecycle: rowShape.lifecycle, soft_deleted: bool })(value);
}

/** The existing activity command is used only with a validated external baseline. */
export function normalizeDatesExternalPendingBody(action: string, body: Record<string, unknown>) {
  if (action === "dates_event_intake_publish") return normalizeDatesIntakePublishBody(body);
  if (action !== "dates_activity_command") return normalizeDatesExternalProxyBody(action, body);
  return bodyKeys(body, ["activity_id", "expected_revision", "action", "reason", "idempotency_key"])
    && id("act")(body.activity_id) && formInteger(body.expected_revision, 1, Number.MAX_SAFE_INTEGER)
    && oneOf(["end", "cancel", "soft_delete", "restore", "purge"] as const)(body.action)
    && reason(body.reason) && requestKey(body.idempotency_key) ? body : null;
}

/** Closed browser shape; Core still owns all authorization and domain policy. */
export function normalizeDatesExternalProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!DATES_EXTERNAL_ACTIONS.includes(action as DatesExternalAction)) return undefined;
  if (action === "dates_external_event_list") {
    if (!bodyKeys(body, [], ["status", "tier", "category", "channel", "city", "query", "start_from", "start_to", "page", "limit"])) return null;
    for (const [key, values] of [["status", DATES_EXTERNAL_STATUSES], ["tier", DATES_EXTERNAL_TIERS],
      ["category", DATES_EXTERNAL_CATEGORIES], ["channel", DATES_EXTERNAL_CHANNELS]] as const)
      if (Object.hasOwn(body, key) && body[key] !== "" && !oneOf(values)(body[key])) return null;
    for (const key of ["city", "query"]) if (Object.hasOwn(body, key)
      && (!text(0, 120)(body[key]) || Array.from(body[key] as string).length > 120)) return null;
    for (const [key, max] of [["page", 10000], ["limit", 100], ["start_from", 4_102_444_800], ["start_to", 4_102_444_800]] as const)
      if (Object.hasOwn(body, key) && !formInteger(body[key], 1, max)) return null;
    if (Object.hasOwn(body, "start_from") && Object.hasOwn(body, "start_to") && Number(body.start_from) > Number(body.start_to)) return null;
    return body;
  }
  if (action === "dates_external_event_detail") return bodyKeys(body, ["external_event_id"]) && id("xev")(body.external_event_id) ? body : null;
  if (action === "dates_external_event_place_search") return bodyKeys(body, ["query"], ["language"])
    && datesExternalPlaceQuery(body.query) && (!Object.hasOwn(body, "language") || oneOf(["en", "hu"] as const)(body.language)) ? body : null;
  if (action === "dates_external_event_command") {
    if (!oneOf(DATES_EXTERNAL_COMMANDS)(body.action)) return null;
    const fields = body.action === "reverify" ? ["confirmations"] : body.action === "official_update" ? ["text"] : [];
    if (!bodyKeys(body, ["action", "external_event_id", "expected_revision", "reason", "idempotency_key", ...fields])
      || !id("xev")(body.external_event_id) || !formInteger(body.expected_revision, 1, Number.MAX_SAFE_INTEGER)
      || !reason(body.reason) || !requestKey(body.idempotency_key)) return null;
    if (body.action === "reverify" && !object({ source: literal(true), public_venue: literal(true), timezone: literal(true), content_safe: literal(true) })(body.confirmations)) return null;
    if (body.action === "official_update" && !datesExternalOfficialText(body.text)) return null;
    return body;
  }
  const updating = action === "dates_external_event_update";
  if (!bodyKeys(body, ["event", "reason", "idempotency_key", ...(updating ? ["external_event_id", "expected_revision"] : [])])
    || normalizeDatesExternalManualEvent(body.event) === null || !reason(body.reason)
    || !requestKey(body.idempotency_key)
    || (updating && (!id("xev")(body.external_event_id) || !formInteger(body.expected_revision, 1, Number.MAX_SAFE_INTEGER)))) return null;
  return body;
}

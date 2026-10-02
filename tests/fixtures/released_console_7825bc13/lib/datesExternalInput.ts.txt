/** P1 manual facts only. Core owns publication, dedupe and current-time policy. */
export const DATES_EXTERNAL_CATEGORIES = [
  "sport_match", "sport_participation", "concert", "club_night", "festival",
  "theatre", "cinema", "exhibition", "talk", "workshop", "market", "food_drink",
  "community", "outdoor", "other",
] as const;

export type DatesExternalCategory = typeof DATES_EXTERNAL_CATEGORIES[number];
export type DatesExternalManualEvent = {
  title: string;
  summary: { en: string; hu: string };
  category: DatesExternalCategory;
  sensitive: { flag: boolean; reason: string | null };
  start_at: number;
  end_at: number | null;
  timezone: string;
  all_day: boolean;
  price_text: string | null;
  is_free: boolean;
  age_restriction: number | null;
  venue: {
    name: string; formatted_address: string; latitude: number; longitude: number;
    city: string; country_code: string;
  };
  organizer: { name: string; website: string | null };
  links: { official_url: string | null; ticket_url: string | null };
  source_url: string;
  attendee_list: "visible" | "count_only";
  confirmations: { source: true; public_venue: true; timezone: true; content_safe: true };
};

export type DatesExternalEditorInput = Omit<DatesExternalManualEvent, "confirmations"> & {
  confirmations: { source: false; public_venue: false; timezone: false; content_safe: false };
};

const MAX_EPOCH = 4_102_444_800;
const MAX_EVENT_BYTES = 32_000;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function document(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return document(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export function datesExternalTrim(value: string): string {
  // PHP trim(), not JS trim(): NBSP and other Unicode spaces are not discarded.
  return value.replace(/^[\x20\t\n\r\0\v]+|[\x20\t\n\r\0\v]+$/g, "");
}

function text(value: unknown, minimum: number, maximum: number, multiline = false): value is string {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)
    || (multiline ? /[\x00-\x08\x0B-\x1F\x7F]/u : /[\x00-\x1F\x7F]/u).test(value)) return false;
  const length = [...graphemes.segment(datesExternalTrim(value))].length;
  return length >= minimum && length <= maximum;
}

function optionalText(value: unknown, maximum: number): boolean {
  return value === null || text(value, 1, maximum);
}

function epoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_EPOCH;
}

/** Navigation only: this validation does not authorize server-side URL fetching. */
export function datesExternalHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[^\x21-\x7e]|\\/.test(value)) return false;
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes("@")) return false;
  const host = authority.replace(/:443$/, "").toLowerCase();
  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2 || labels.some((label) =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && url.username === "" && url.password === ""
      && url.port === "" && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
  } catch { return false; }
}

function optionalUrl(value: unknown): boolean {
  return value === null || datesExternalHttpsUrl(value);
}

function namedTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80 || !/^[A-Za-z0-9_+/-]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

export function datesExternalDefaultDuration(category: DatesExternalCategory): number {
  if (category === "concert" || category === "theatre") return 3 * 3600;
  if (category === "club_night") return 5 * 3600;
  if (category === "festival") return 10 * 3600;
  return 2 * 3600;
}

/**
 * Closed browser/server-boundary payload. This console sends all fields even
 * where Core supports omission; it neither mutates the receipt payload nor
 * guesses the server's current lookahead, ticket allow-list or stored state.
 */
function manualEvent(value: unknown, maximumBytes: number): DatesExternalManualEvent | null {
  if (!closed(value, ["title", "summary", "category", "sensitive", "start_at", "end_at",
    "timezone", "all_day", "price_text", "is_free", "age_restriction", "venue", "organizer",
    "links", "source_url", "attendee_list", "confirmations"])) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > maximumBytes) return null;
  } catch { return null; }
  const { summary, sensitive, venue, organizer, links, confirmations } = value;
  if (!closed(summary, ["en", "hu"]) || !text(summary.en, 1, 500, true) || !text(summary.hu, 1, 500, true)
    || !text(value.title, 3, 120) || !DATES_EXTERNAL_CATEGORIES.includes(value.category as DatesExternalCategory)
    || !closed(sensitive, ["flag", "reason"]) || typeof sensitive.flag !== "boolean"
    || !optionalText(sensitive.reason, 300) || (sensitive.flag && sensitive.reason === null)
    || !epoch(value.start_at) || (value.end_at !== null && !epoch(value.end_at))
    || !namedTimezone(value.timezone) || typeof value.all_day !== "boolean"
    || typeof value.is_free !== "boolean" || !optionalText(value.price_text, 200)
    || (value.age_restriction !== null && (typeof value.age_restriction !== "number"
      || !Number.isInteger(value.age_restriction) || value.age_restriction < 18 || value.age_restriction > 99))
    || !closed(venue, ["name", "formatted_address", "latitude", "longitude", "city", "country_code"])
    || !text(venue.name, 1, 200) || !text(venue.formatted_address, 1, 400) || !text(venue.city, 1, 120)
    || typeof venue.country_code !== "string" || !/^[A-Z]{2}$/.test(venue.country_code)
    || typeof venue.latitude !== "number" || !Number.isFinite(venue.latitude) || Math.abs(venue.latitude) > 90
    || typeof venue.longitude !== "number" || !Number.isFinite(venue.longitude) || Math.abs(venue.longitude) > 180
    || !closed(organizer, ["name", "website"]) || !text(organizer.name, 1, 160) || !optionalUrl(organizer.website)
    || !closed(links, ["official_url", "ticket_url"]) || !optionalUrl(links.official_url) || !optionalUrl(links.ticket_url)
    || (!value.is_free && links.official_url === null) || !datesExternalHttpsUrl(value.source_url)
    || !["visible", "count_only"].includes(value.attendee_list as string)
    || !closed(confirmations, ["source", "public_venue", "timezone", "content_safe"])
    || Object.values(confirmations).some((item) => item !== true)) return null;
  const duration = value.end_at === null
    ? datesExternalDefaultDuration(value.category as DatesExternalCategory) : Number(value.end_at) - value.start_at;
  if (duration <= 0 || duration > (value.category === "festival" ? 14 : 1) * 86400) return null;
  return value as DatesExternalManualEvent;
}

export function normalizeDatesExternalManualEvent(value: unknown): DatesExternalManualEvent | null {
  return manualEvent(value, MAX_EVENT_BYTES);
}

/** Read-only editor seed: a historical attestation must never pre-check this form. */
export function normalizeDatesExternalEditorInput(value: unknown): DatesExternalEditorInput | null {
  if (!document(value) || !closed(value.confirmations, ["source", "public_venue", "timezone", "content_safe"])
    || Object.values(value.confirmations).some((item) => item !== false)) return null;
  // Core expands omitted optional keys/defaults on reads. The request ceiling
  // is not a DTO ceiling; submission still rechecks the original 32 KB limit.
  const checked = manualEvent({ ...value,
    confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } }, MAX_EVENT_BYTES * 2);
  return checked ? value as DatesExternalEditorInput : null;
}

function wallClock(epochSeconds: number, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB-u-ca-iso8601-nu-latn", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(epochSeconds * 1000));
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  } catch { return null; }
}

/** Explicit offset distinguishes repeated DST times; roundtrip rejects gaps. */
export function datesExternalTimeFromInput(local: string, offset: string, timezone: string): number | null {
  const clock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!clock || !zone || !namedTimezone(timezone)) return null;
  const [, year, month, day, hour, minute, second = "00"] = clock;
  const calendar = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) / 1000;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (!epoch(calendar) || new Date(calendar * 1000).toISOString().slice(0, 19) !== normalized
    || +zone[2] > 14 || +zone[3] > 59 || (+zone[2] === 14 && +zone[3] !== 0)) return null;
  const signedMinutes = (zone[1] === "-" ? -1 : 1) * (+zone[2] * 60 + +zone[3]);
  const instant = calendar - signedMinutes * 60;
  return epoch(instant) && wallClock(instant, timezone) === normalized ? instant : null;
}

export function datesExternalTimeToInput(instant: number, timezone: string): { local: string; offset: string } | null {
  if (!epoch(instant) || !namedTimezone(timezone)) return null;
  const local = wallClock(instant, timezone);
  if (!local) return null;
  const minutes = (Date.parse(`${local}Z`) / 1000 - instant) / 60;
  if (!Number.isInteger(minutes) || Math.abs(minutes) > 14 * 60) return null;
  const absolute = Math.abs(minutes);
  const offset = `${minutes < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return datesExternalTimeFromInput(local, offset, timezone) === instant ? { local, offset } : null;
}

export type DatesExternalDraft = {
  title: string; summaryEn: string; summaryHu: string; category: DatesExternalCategory;
  sensitive: boolean; sensitiveReason: string; attendeeList: "visible" | "count_only";
  startLocal: string; startOffset: string; endLocal: string; endOffset: string; timezone: string; allDay: boolean;
  priceText: string; isFree: boolean; ageRestriction: string;
  venueName: string; venueAddress: string; latitude: string; longitude: string; city: string; countryCode: string;
  organizerName: string; organizerWebsite: string; officialUrl: string; ticketUrl: string; sourceUrl: string;
  confirmSource: boolean; confirmPublicVenue: boolean; confirmTimezone: boolean; confirmContentSafe: boolean;
};

export const DATES_EXTERNAL_FRESH_CONFIRMATIONS = {
  confirmSource: false, confirmPublicVenue: false, confirmTimezone: false, confirmContentSafe: false,
} as const;

export function datesExternalDraft(initial?: DatesExternalManualEvent | DatesExternalEditorInput | null): DatesExternalDraft {
  const start = initial ? datesExternalTimeToInput(initial.start_at, initial.timezone) : null;
  const end = initial?.end_at ? datesExternalTimeToInput(initial.end_at, initial.timezone) : null;
  return {
    title: initial?.title ?? "", summaryEn: initial?.summary.en ?? "", summaryHu: initial?.summary.hu ?? "",
    category: initial?.category ?? "other", sensitive: initial?.sensitive.flag ?? false,
    sensitiveReason: initial?.sensitive.reason ?? "", attendeeList: initial?.attendee_list ?? "visible",
    startLocal: start?.local ?? "", startOffset: start?.offset ?? "", endLocal: end?.local ?? "", endOffset: end?.offset ?? "",
    timezone: initial?.timezone ?? "", allDay: initial?.all_day ?? false,
    priceText: initial?.price_text ?? "", isFree: initial?.is_free ?? false, ageRestriction: initial?.age_restriction?.toString() ?? "",
    venueName: initial?.venue.name ?? "", venueAddress: initial?.venue.formatted_address ?? "",
    latitude: initial?.venue.latitude.toString() ?? "", longitude: initial?.venue.longitude.toString() ?? "",
    city: initial?.venue.city ?? "", countryCode: initial?.venue.country_code ?? "",
    organizerName: initial?.organizer.name ?? "", organizerWebsite: initial?.organizer.website ?? "",
    officialUrl: initial?.links.official_url ?? "", ticketUrl: initial?.links.ticket_url ?? "", sourceUrl: initial?.source_url ?? "",
    ...DATES_EXTERNAL_FRESH_CONFIRMATIONS,
  };
}

function decimalInput(value: string): number {
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
}

export function datesExternalDraftInput(draft: DatesExternalDraft):
  | { ok: true; event: DatesExternalManualEvent }
  | { ok: false; error: "startTime" | "endTime" | "confirmations" | "facts" } {
  const start = datesExternalTimeFromInput(draft.startLocal, draft.startOffset, draft.timezone);
  if (start === null) return { ok: false, error: "startTime" };
  const end = draft.endLocal === "" ? null : datesExternalTimeFromInput(draft.endLocal, draft.endOffset, draft.timezone);
  if (draft.endLocal !== "" && end === null) return { ok: false, error: "endTime" };
  if (!draft.confirmSource || !draft.confirmPublicVenue || !draft.confirmTimezone || !draft.confirmContentSafe)
    return { ok: false, error: "confirmations" };
  const trim = datesExternalTrim;
  const optional = (value: string) => trim(value) || null;
  const age = trim(draft.ageRestriction);
  const event = normalizeDatesExternalManualEvent({
    title: trim(draft.title), summary: { en: trim(draft.summaryEn), hu: trim(draft.summaryHu) }, category: draft.category,
    sensitive: { flag: draft.sensitive, reason: draft.sensitive ? optional(draft.sensitiveReason) : null },
    start_at: start, end_at: end, timezone: draft.timezone, all_day: draft.allDay,
    price_text: optional(draft.priceText), is_free: draft.isFree,
    age_restriction: age === "" ? null : /^[1-9][0-9]$/.test(age) ? Number(age) : NaN,
    venue: {
      name: trim(draft.venueName), formatted_address: trim(draft.venueAddress), city: trim(draft.city),
      latitude: decimalInput(trim(draft.latitude)), longitude: decimalInput(trim(draft.longitude)), country_code: trim(draft.countryCode),
    },
    organizer: { name: trim(draft.organizerName), website: optional(draft.organizerWebsite) },
    links: { official_url: optional(draft.officialUrl), ticket_url: optional(draft.ticketUrl) }, source_url: trim(draft.sourceUrl),
    attendee_list: draft.sensitive ? "count_only" : draft.attendeeList,
    confirmations: { source: true, public_venue: true, timezone: true, content_safe: true },
  });
  return event ? { ok: true, event } : { ok: false, error: "facts" };
}

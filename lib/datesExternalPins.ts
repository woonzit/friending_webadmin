import { datesCommandOutcome } from "./datesExternalAdmin";
import { DATES_EXTERNAL_CATEGORIES } from "./datesExternalInput";
import {
  EVENT_ICON_REASON_MAX, EVENT_ICON_REASON_MIN, eventIconImageURL, normalizeEventIconName, storedEventIconName, validEventIconEmoji,
  validEventIconOrder, validEventPinColor,
} from "./datesEventIcons";

/**
 * The catalogue of third-party ("external") event pins: Core's
 * `dates_external_pins` and `dates_external_pins_save`
 * (api/docs/DATES_EXTERNAL_PINS.md).
 *
 * The list is fixed. A third-party event has one of eleven general types; the
 * type follows from the fine category the intake gave the event, and an
 * administrator edits how each type's pin looks - never the list. So this
 * console holds the eleven keys closed: a read that does not carry exactly
 * these types once each is not an editable catalogue, and the bridge forwards
 * no other list. Which fine categories a type covers is Core's to say; the
 * console shows what the read carries and never sends it back.
 */
export const EXTERNAL_PIN_KEYS = ["sport", "music", "party", "festival", "arts", "learning", "market", "food", "community", "outdoor", "other"] as const;
export type DatesExternalPinKey = (typeof EXTERNAL_PIN_KEYS)[number];
/** Core's code default of the catalogue colour (`DatesExternalPins::DEFAULT_MARKER_COLOR`): what "reset" puts back. */
export const DEFAULT_EXTERNAL_PIN_COLOR = "#6D5BD0";

/** The fields an administrator edits; a save carries exactly these seven per type. */
export type DatesExternalPinFields = {
  key: DatesExternalPinKey; emoji: string; image_url: string | null;
  /** `null`: the catalogue's default colour. */
  marker_background_color: string | null;
  name_en: string; name_hu: string; order: number;
};
/** A row as it is read: the editable fields and the fine categories the type covers (read-only). */
export type DatesExternalPin = DatesExternalPinFields & { categories: string[] };
export type DatesExternalPinCatalog = { pins: DatesExternalPin[]; default_marker_background_color: string; revision: number };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** A colour that is set: `#RRGGBB` in upper case, never the `null` a single pin may carry. */
export const validExternalPinDefaultColor = (v: unknown): v is string => typeof v === "string" && validEventPinColor(v);
const pinKey = (v: unknown): v is DatesExternalPinKey => typeof v === "string" && (EXTERNAL_PIN_KEYS as readonly string[]).includes(v);

/** The editable fields of one row. `name` is the rule for the two names: as stored (read) or as this editor sends them. */
function pinFields(row: unknown, name: (v: unknown) => boolean): row is Record<string, unknown> & DatesExternalPinFields {
  return record(row) && pinKey(row.key) && validEventIconEmoji(row.emoji) && (row.image_url === null || eventIconImageURL(row.image_url))
    && (row.emoji !== "" || row.image_url !== null) && validEventPinColor(row.marker_background_color)
    && name(row.name_en) && name(row.name_hu) && validEventIconOrder(row.order);
}
/** Every one of the eleven types, once. */
function everyType(rows: readonly { key: string }[]): boolean {
  return rows.length === EXTERNAL_PIN_KEYS.length && new Set(rows.map(row => row.key)).size === EXTERNAL_PIN_KEYS.length;
}
/** The fine categories of the rows of a read: known ones, at least one per type, none under two types. */
function categoriesOf(rows: readonly Record<string, unknown>[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const list = row.categories;
    if (!Array.isArray(list) || list.length < 1 || list.length > DATES_EXTERNAL_CATEGORIES.length) return false;
    for (const category of list) {
      if (typeof category !== "string" || !(DATES_EXTERNAL_CATEGORIES as readonly string[]).includes(category) || seen.has(category)) return false;
      seen.add(category);
    }
  }
  return true;
}

/** The catalogue of a read or of a save's answer, or `null`: not a catalogue this console may show or send back. */
export function externalPinCatalog(value: unknown): DatesExternalPinCatalog | null {
  if (!record(value) || value.success !== true || value.status_code !== 200
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !validExternalPinDefaultColor(value.default_marker_background_color)
    || !Array.isArray(value.pins) || !value.pins.every(row => pinFields(row, storedEventIconName))
    || !everyType(value.pins) || !categoriesOf(value.pins)) return null;
  // The named fields as they were served: a stored name is read whatever its edges (lib/datesEventIcons.ts, storedEventIconName).
  const pins = (value.pins as DatesExternalPin[]).map(row => ({ key: row.key, emoji: row.emoji, image_url: row.image_url,
    marker_background_color: row.marker_background_color, name_en: row.name_en, name_hu: row.name_hu, order: row.order, categories: [...row.categories] }));
  return { pins, default_marker_background_color: value.default_marker_background_color, revision: value.revision as number };
}

/** The row as it is sent: exactly the seven editable keys, names and emoji without surrounding whitespace. */
export function externalPinForSave(pin: DatesExternalPinFields): DatesExternalPinFields {
  return { key: pin.key, emoji: pin.emoji.trim(), image_url: pin.image_url, marker_background_color: pin.marker_background_color,
    name_en: normalizeEventIconName(pin.name_en), name_hu: normalizeEventIconName(pin.name_hu), order: pin.order };
}
export const serializeExternalPins = (pins: readonly DatesExternalPinFields[]): string => JSON.stringify(pins.map(externalPinForSave));

export type ExternalPinSaveRequest = { pins: string; default_marker_background_color: string; expected_revision: number };

/**
 * Core's answer as the receipt of this very save: the stored catalogue one
 * revision on, with an audit id, carrying exactly the rows and the default
 * colour that were sent. Core answers the rows ordered by `order` then `key`,
 * so the comparison is by type, not by position. A catalogue Core stored
 * differently from what was sent (a name it trimmed, a colour it put into
 * upper case) is no receipt of that request - see `externalPinSaveOutcome`.
 */
export function externalPinReceipt(value: unknown, request: ExternalPinSaveRequest): DatesExternalPinCatalog | null {
  const catalog = externalPinCatalog(value);
  if (!catalog || !record(value) || typeof value.audit_id !== "string" || !/^aud_[a-f0-9]{32}$/.test(value.audit_id)
    || typeof value.idempotency_replayed !== "boolean" || catalog.revision !== request.expected_revision + 1
    || catalog.default_marker_background_color !== request.default_marker_background_color) return null;
  try {
    const sent = JSON.parse(request.pins) as DatesExternalPinFields[];
    const normalize = (rows: readonly DatesExternalPinFields[]) => JSON.stringify([...rows].sort((a, b) => a.key.localeCompare(b.key)).map(row =>
      [row.key, row.emoji, row.image_url, row.marker_background_color, row.name_en, row.name_hu, row.order]));
    return Array.isArray(sent) && normalize(catalog.pins) === normalize(sent) ? catalog : null;
  } catch { return null; }
}
/** A refused retry is not proof that the first, unanswered attempt did not commit. */
export function externalPinSaveOutcome(response: unknown, request: ExternalPinSaveRequest, retrying: boolean) {
  const receipt = externalPinReceipt(response, request);
  return { receipt, outcome: datesCommandOutcome(response, receipt !== null, retrying ? "kept" : "fresh") };
}

const PIN_ROW_KEYS = ["key", "emoji", "image_url", "marker_background_color", "name_en", "name_hu", "order"];
/** A name the console may send: a stored name whose edges the editor's normalisation leaves alone. */
const sendableName = (v: unknown): boolean => storedEventIconName(v) && normalizeEventIconName(v) === v;
/** The console's own request shape: every named key and no other. */
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => keys.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => keys.includes(key));
/**
 * The bridge's closed request shape for the two pin routes; Core still owns
 * authorization, the revision, the audit and every domain rule. The read
 * carries nothing. The save carries exactly the catalogue (the JSON text of the
 * eleven rows, each with exactly the seven editable keys), the default colour,
 * the expected revision, the reason and the caller-minted request key.
 * `null`: refused here, nothing is forwarded. `undefined`: not a pin route.
 */
export function normalizeDatesExternalPinsProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (action === "dates_external_pins") return exactKeys(body, []) ? body : null;
  if (action !== "dates_external_pins_save") return undefined;
  if (!exactKeys(body, ["pins", "default_marker_background_color", "expected_revision", "reason", "idempotency_key"])
    || typeof body.pins !== "string" || new TextEncoder().encode(body.pins).length > 200000
    || !validExternalPinDefaultColor(body.default_marker_background_color)
    || !Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 0
    || typeof body.reason !== "string" || body.reason.trim() !== body.reason
    || body.reason.length < EVENT_ICON_REASON_MIN || body.reason.length > EVENT_ICON_REASON_MAX
    || /[\x00-\x1f\x7f]/.test(body.reason)
    || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(body.idempotency_key)) return null;
  let rows: unknown;
  try { rows = JSON.parse(body.pins); } catch { return null; }
  if (!Array.isArray(rows) || !rows.every(row => pinFields(row, sendableName) && exactKeys(row, PIN_ROW_KEYS)) || !everyType(rows)) return null;
  return body;
}

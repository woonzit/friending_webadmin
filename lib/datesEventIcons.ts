import { datesCommandOutcome } from "./datesExternalAdmin";

export const EVENT_ICON_ACTIVITY_TYPES = ["sport", "travel", "hangout"] as const;
export type DatesEventIcon = {
  key: string; activity_type: "sport" | "travel" | "hangout"; emoji: string; image_url: string | null;
  name_en: string; name_hu: string; enabled: boolean; is_default: boolean; order: number;
  marker_background_color: string | null;
};
export const DEFAULT_EVENT_PIN_COLOR = "#F68B3F";
export const DEFAULT_EVENT_PIN_COLOR_DARK = "#FFA45F";
export const EVENT_ICON_NAME_MAX = 60;
export const EVENT_ICON_ORDER_MAX = 100000;
export const EVENT_ICON_MAX_COUNT = 128;
/** The console's own bounds of the audit reason (Core accepts 1 to 1000 characters). */
export const EVENT_ICON_REASON_MIN = 3;
export const EVENT_ICON_REASON_MAX = 500;
export const validEventPinColor = (value: unknown): value is string | null => value === null
  || typeof value === "string" && /^#[A-F0-9]{6}$/.test(value);
/** What an operator typed into the HEX field, as the contract's colour: six hex digits, `#` optional, any case. `null`: not a colour (yet). */
export function eventPinColorFromInput(text: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}
export type DatesEventIconCatalog = { icons: DatesEventIcon[]; revision: number };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const graphemes = (v: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)].length;
/**
 * A name as Core stored it: non-empty, bounded, no control character. Whether its
 * edges are whitespace is NOT judged here. Core and the browser do not agree on
 * what whitespace is (PHP `trim` knows six ASCII characters, JS `trim` every
 * Unicode space), and a name one side accepted must never make the catalogue
 * unreadable on the other. The editor trims before it sends
 * (`normalizeEventIconName`); what was stored is read as it is.
 */
export const storedEventIconName = (v: unknown): v is string => typeof v === "string" && v.length > 0
  && graphemes(v) <= EVENT_ICON_NAME_MAX && !/[\x00-\x1f\x7f]/.test(v);
/**
 * The editor's normalisation of a name before it is validated or sent: JS
 * `trim`, which removes every Unicode space (NBSP, ideographic space, narrow
 * NBSP, the Zs class), the line terminators and U+FEFF from both ends.
 */
export const normalizeEventIconName = (v: string): string => v.trim();
export const validEventIconEmoji = (v: unknown): v is string => typeof v === "string" && (v === "" ||
  (new TextEncoder().encode(v).length <= 64 && graphemes(v) === 1
    && /[\p{So}\u2600-\u27bf\u{1f000}-\u{1faff}]/u.test(v) && !/[\x00-\x1f\x7f<>]/.test(v)));
export const validEventIconKey = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9_-]{0,47}$/.test(v);
export const validEventIconOrder = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= EVENT_ICON_ORDER_MAX;
export function eventIconImageURL(v: unknown): v is string {
  return typeof v === "string" && v.length <= 1024
    && /^https:\/\/img\.friending\.co\/(?:api\/cache\/)?[a-zA-Z0-9_./-]+\.png$/.test(v) && !v.includes("..");
}
/** The closed row shape, shared by the read parser and the bridge's request check. `name` is the rule for the two names. */
function eventIconRows(value: unknown, name: (v: unknown) => boolean): value is DatesEventIcon[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > EVENT_ICON_MAX_COUNT) return false;
  const keys = new Set(), defaults = new Set();
  for (const row of value) {
    if (!record(row) || !validEventIconKey(row.key) || keys.has(row.key)
      || typeof row.activity_type !== "string" || !(EVENT_ICON_ACTIVITY_TYPES as readonly string[]).includes(row.activity_type) || !validEventIconEmoji(row.emoji)
      || (row.image_url !== null && !eventIconImageURL(row.image_url)) || !validEventPinColor(row.marker_background_color)
      || (!row.emoji && !row.image_url) || typeof row.enabled !== "boolean" || typeof row.is_default !== "boolean"
      || !validEventIconOrder(row.order) || !name(row.name_en) || !name(row.name_hu)) return false;
    if (row.is_default && (!row.enabled || defaults.has(row.activity_type))) return false;
    keys.add(row.key); if (row.is_default) defaults.add(row.activity_type);
  }
  return true;
}
export function eventIconCatalog(value: unknown): DatesEventIconCatalog | null {
  if (!record(value) || value.success !== true || value.status_code !== 200 || value.event_icon_contract_version !== 2
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !eventIconRows(value.icons, storedEventIconName)) return null;
  return { icons: value.icons, revision: value.revision as number };
}

/** A refused retry is not proof that the first, unanswered attempt did not commit. */
export function eventIconSaveOutcome(response: unknown, request: { expected_revision: number; icons: string }, retrying: boolean) {
  const receipt = eventIconReceipt(response, request);
  return { receipt, outcome: datesCommandOutcome(response, receipt !== null, retrying ? "kept" : "fresh") };
}
export function eventIconReceipt(value: unknown, request: { expected_revision: number; icons: string }): DatesEventIconCatalog | null {
  const catalog = eventIconCatalog(value);
  if (!catalog || !record(value) || value.status_code !== 200 || typeof value.audit_id !== "string"
    || !/^aud_[a-f0-9]{32}$/.test(value.audit_id) || typeof value.idempotency_replayed !== "boolean"
    || catalog.revision !== request.expected_revision + 1) return null;
  try {
    const sent = JSON.parse(request.icons) as DatesEventIcon[];
    const normalize = (rows: DatesEventIcon[]) => JSON.stringify([...rows].sort((a, b) => a.key.localeCompare(b.key)).map(r =>
      [r.key, r.activity_type, r.emoji, r.image_url, r.marker_background_color, r.name_en, r.name_hu, r.enabled, r.is_default, r.order]));
    return normalize(catalog.icons) === normalize(sent) ? catalog : null;
  } catch { return null; }
}

const ICON_ROW_KEYS = ["key", "activity_type", "emoji", "image_url", "marker_background_color", "name_en", "name_hu", "enabled", "is_default", "order"];
/** A name the console may send: a stored name whose edges the editor's normalisation leaves alone. */
const sendableEventIconName = (v: unknown): boolean => storedEventIconName(v) && normalizeEventIconName(v) === v;
/** The console's own request shape: every named key and no other (the rule of `bodyKeys` in lib/datesExternalAdmin.ts). */
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => keys.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => keys.includes(key));
/**
 * The bridge's closed request shape for the two icon routes; Core still owns
 * authorization, the revision, the audit and every domain rule. The read
 * carries nothing. The save carries exactly the catalogue (the JSON text of
 * rows with exactly the ten row keys), the expected revision, the reason and
 * the caller-minted request key. `null`: refused here, nothing is forwarded.
 */
export function normalizeDatesEventIconsProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (action === "dates_event_icons") return exactKeys(body, []) ? body : null;
  if (action !== "dates_event_icons_save") return undefined;
  if (!exactKeys(body, ["icons", "expected_revision", "reason", "idempotency_key"])
    || typeof body.icons !== "string" || new TextEncoder().encode(body.icons).length > 200000
    || !Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 0
    || typeof body.reason !== "string" || body.reason.trim() !== body.reason
    || body.reason.length < EVENT_ICON_REASON_MIN || body.reason.length > EVENT_ICON_REASON_MAX
    || /[\x00-\x1f\x7f]/.test(body.reason)
    || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(body.idempotency_key)) return null;
  let rows: unknown;
  try { rows = JSON.parse(body.icons); } catch { return null; }
  if (!eventIconRows(rows, sendableEventIconName) || !rows.every(row => exactKeys(row as unknown as Record<string, unknown>, ICON_ROW_KEYS))) return null;
  return body;
}

function channels(color: string): [number, number, number] {
  return [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16)) as [number, number, number];
}
/** WCAG relative luminance of a `#RRGGBB` colour, 0 (black) to 1 (white). */
export function eventPinLuminance(color: string): number {
  const [r, g, b] = channels(color).map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const VERY_LIGHT_PIN = 0.6;
/**
 * The two outlines of a pin in the console's previews, derived from its
 * background colour. `stroke` is the outline of the normal (filled) pin: white,
 * or a darker shade of the colour when the colour is so light that a white
 * outline and the white icon plate would vanish into it. `ring` is the colour
 * the selected (light) pin and the icon plate are outlined with: the assigned
 * colour itself, or the same darker shade for a very light colour.
 */
export function eventPinOutline(color: string): { stroke: string; ring: string; light: boolean } {
  if (!/^#[A-Fa-f0-9]{6}$/.test(color) || eventPinLuminance(color) <= VERY_LIGHT_PIN) return { stroke: "#FFFFFF", ring: color, light: false };
  const darker = `#${channels(color).map(value => Math.round(value * 0.55).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return { stroke: darker, ring: darker, light: true };
}

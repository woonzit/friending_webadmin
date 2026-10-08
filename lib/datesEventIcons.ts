import { datesCommandOutcome } from "./datesExternalAdmin";

export type DatesEventIcon = {
  key: string; activity_type: "sport" | "travel" | "hangout"; emoji: string; image_url: string | null;
  name_en: string; name_hu: string; enabled: boolean; is_default: boolean; order: number;
  marker_background_color: string | null;
};
export const DEFAULT_EVENT_PIN_COLOR = "#F68B3F";
export const DEFAULT_EVENT_PIN_COLOR_DARK = "#FFA45F";
export const validEventPinColor = (value: unknown): value is string | null => value === null
  || typeof value === "string" && /^#[A-F0-9]{6}$/.test(value);
export type DatesEventIconCatalog = { icons: DatesEventIcon[]; revision: number };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const graphemes = (v: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)].length;
const validName = (v: unknown) => typeof v === "string" && v.trim() === v && v.length > 0
  && graphemes(v) <= 60 && !/[\x00-\x1f\x7f]/.test(v);
const validEmoji = (v: unknown) => typeof v === "string" && (v === "" ||
  (new TextEncoder().encode(v).length <= 64 && graphemes(v) === 1
    && /[\p{So}\u2600-\u27bf\u{1f000}-\u{1faff}]/u.test(v) && !/[\x00-\x1f\x7f<>]/.test(v)));
export function eventIconImageURL(v: unknown): v is string {
  return typeof v === "string" && v.length <= 1024
    && /^https:\/\/img\.friending\.co\/(?:api\/cache\/)?[a-zA-Z0-9_./-]+\.png$/.test(v) && !v.includes("..");
}
export function eventIconCatalog(value: unknown): DatesEventIconCatalog | null {
  if (!record(value) || value.success !== true || value.status_code !== 200 || value.event_icon_contract_version !== 2
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.icons) || value.icons.length < 1 || value.icons.length > 128) return null;
  const keys = new Set(), defaults = new Set();
  for (const row of value.icons) {
    if (!record(row) || typeof row.key !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(row.key) || keys.has(row.key)
      || typeof row.activity_type !== "string" || !["sport", "travel", "hangout"].includes(row.activity_type) || !validEmoji(row.emoji)
      || (row.image_url !== null && !eventIconImageURL(row.image_url)) || !validEventPinColor(row.marker_background_color)
      || (!row.emoji && !row.image_url) || typeof row.enabled !== "boolean" || typeof row.is_default !== "boolean"
      || !Number.isSafeInteger(row.order) || (row.order as number) < 0 || (row.order as number) > 100000
      || !validName(row.name_en) || !validName(row.name_hu)) return null;
    if (row.is_default && (!row.enabled || defaults.has(row.activity_type))) return null;
    keys.add(row.key); if (row.is_default) defaults.add(row.activity_type);
  }
  return { icons: value.icons as DatesEventIcon[], revision: value.revision as number };
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

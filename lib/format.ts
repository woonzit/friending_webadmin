/**
 * The largest epoch second `new Date()` can represent. Beyond it the Date is Invalid and
 * `Intl.DateTimeFormat.format` throws a RangeError — inside render, which replaces the whole page
 * with a crash screen. A single out-of-range timestamp from Core must degrade to an em dash.
 */
const MAX_EPOCH_SECONDS = 8_640_000_000_000;

export function formatDate(epochSeconds: unknown, locale: string, withTime = false): string {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_EPOCH_SECONDS) return "—";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value * 1000));
}

/**
 * An unreadable value becomes an em dash, not a confident "0". These render operational counters —
 * an SLA breach count, a queue depth — where a fabricated zero reads as "nothing to do".
 */
export function formatNumber(value: unknown, locale: string): string {
  // `Number(null)`, `Number("")` and `Number([])` are all 0, so an absent counter would otherwise
  // render as a confident zero. Only an actual number or a numeric string counts.
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US").format(number);
}

export function isHttpsUrl(value: string, optional = false): boolean {
  if (!value.trim()) return optional;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isIsoCountryCode(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value.trim());
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function avatarUrl(value: unknown): string {
  const path = String(value ?? "").trim();
  if (!path) return "";
  if (/^https:\/\//i.test(path)) return path;
  return `https://img.friending.co/api/cache/${path.replace(/^\/+/, "")}`;
}

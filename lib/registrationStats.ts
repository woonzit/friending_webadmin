/**
 * Core's read-only registrations per signup platform (`registration_platform_stats`, schema 1,
 * P-092) for the overview, and the signup-platform vocabulary the Registered users list shares
 * with it (docs/REGISTRATION_PLATFORM_STATS.md in Core).
 *
 * A registration is a member account that exists now or was deleted since; system, demo, App
 * Review, synthetic, test and metrics-excluded accounts never count. Days are Budapest days. The
 * parser is strict: a loosely typed or internally inconsistent success is an error, never a partly
 * filled panel an operator could read as "no signups on this platform".
 */
export const SIGNUP_PLATFORMS = ["web", "ios", "android", "unknown"] as const;
export type SignupPlatform = (typeof SIGNUP_PLATFORMS)[number];
export type SignupPlatformFilter = SignupPlatform | "all";
export const REGISTRATION_STATS_RANGES = [30, 90] as const;
export type RegistrationStatsRange = (typeof REGISTRATION_STATS_RANGES)[number];
export const REGISTRATION_STATS_TIMEZONE = "Europe/Budapest";

export type RegistrationCountry = { country_code: string; count: number };
export type RegistrationBlock = {
  registered: number;
  accounts: number;
  deleted: number;
  new_today: number;
  new_7_days: number;
  new_30_days: number;
  deleted_30_days: number;
  legacy_converted: number;
  legacy_converted_30_days: number;
  with_photo: number;
  active_7_days: number;
  suspended: number;
  signed_in_30_days: number;
  gender: { male: number; female: number; other: number };
  top_countries: RegistrationCountry[];
};
export type RegistrationDay = Record<SignupPlatform, number> & { date: string; deleted: number };
export type RegistrationPlatformStats = {
  schema_version: 1;
  generated_at: number;
  timezone: typeof REGISTRATION_STATS_TIMEZONE;
  days: RegistrationStatsRange;
  platforms: Record<SignupPlatform, RegistrationBlock>;
  all: RegistrationBlock;
  daily: RegistrationDay[];
};

const COUNTERS = [
  "registered", "accounts", "deleted", "new_today", "new_7_days", "new_30_days", "deleted_30_days",
  "legacy_converted", "legacy_converted_30_days", "with_photo", "active_7_days", "suspended",
  "signed_in_30_days",
] as const;
/** `AdminRegistrationStatsService::COUNTRY_LIMIT`. */
const COUNTRY_LIMIT = 5;
const DAY_MS = 86_400_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function isSignupPlatform(value: unknown): value is SignupPlatform {
  return typeof value === "string" && (SIGNUP_PLATFORMS as readonly string[]).includes(value);
}

/** A list row's platform: Core names one of the four; anything else (or nothing) is null, not "unknown". */
export function signupPlatformFrom(value: unknown): SignupPlatform | null {
  return isSignupPlatform(value) ? value : null;
}

/** The Registered users filter from an address query value; anything else is "all". */
export function signupPlatformFilterFrom(value: string | null | undefined): SignupPlatformFilter {
  return signupPlatformFrom(value) ?? "all";
}

/** Core's own order for top countries: largest first, the unknown ("") code last among equals, then by code. */
function countryOrder(left: RegistrationCountry, right: RegistrationCountry): number {
  if (left.count !== right.count) return right.count - left.count;
  const leftUnknown = left.country_code === "" ? 1 : 0;
  const rightUnknown = right.country_code === "" ? 1 : 0;
  if (leftUnknown !== rightUnknown) return leftUnknown - rightUnknown;
  return left.country_code < right.country_code ? -1 : left.country_code > right.country_code ? 1 : 0;
}

function block(value: unknown): RegistrationBlock | null {
  const row = record(value);
  const gender = record(row?.gender);
  const countries = row?.top_countries;
  if (!row || !gender || !Array.isArray(countries) || countries.length > COUNTRY_LIMIT) return null;
  for (const key of COUNTERS) if (!count(row[key])) return null;
  if (!count(gender.male) || !count(gender.female) || !count(gender.other)) return null;
  const top: RegistrationCountry[] = [];
  for (const entry of countries) {
    const country = record(entry);
    if (!country || typeof country.country_code !== "string" || !/^(?:[A-Z]{2})?$/u.test(country.country_code)
      || !count(country.count) || country.count === 0) return null;
    if (top.some((seen) => seen.country_code === country.country_code)) return null;
    const next = { country_code: country.country_code, count: country.count };
    if (top.length > 0 && countryOrder(top[top.length - 1]!, next) >= 0) return null;
    top.push(next);
  }
  const parsed = Object.fromEntries(COUNTERS.map((key) => [key, row[key] as number])) as Omit<RegistrationBlock, "gender" | "top_countries">;
  const male = gender.male as number;
  const female = gender.female as number;
  const other = gender.other as number;
  // The counters are one census: a block that disagrees with itself is not shown.
  if (parsed.registered !== parsed.accounts + parsed.deleted
    || male + female + other !== parsed.accounts
    || top.reduce((sum, country) => sum + country.count, 0) > parsed.accounts
    || parsed.new_today > parsed.new_7_days || parsed.new_7_days > parsed.new_30_days
    || parsed.new_30_days > parsed.registered || parsed.deleted_30_days > parsed.deleted
    || parsed.legacy_converted_30_days > parsed.legacy_converted || parsed.legacy_converted > parsed.accounts
    || parsed.with_photo > parsed.accounts || parsed.active_7_days > parsed.accounts
    || parsed.suspended > parsed.accounts) return null;
  return { ...parsed, gender: { male, female, other }, top_countries: top };
}

function utcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const stamp = Date.UTC(year, month - 1, day);
  const back = new Date(stamp);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day
    ? stamp
    : null;
}

function day(value: unknown): RegistrationDay | null {
  const row = record(value);
  if (!row || typeof row.date !== "string" || utcDay(row.date) === null) return null;
  if (!count(row.deleted) || SIGNUP_PLATFORMS.some((key) => !count(row[key]))) return null;
  return {
    date: row.date,
    web: row.web as number,
    ios: row.ios as number,
    android: row.android as number,
    unknown: row.unknown as number,
    deleted: row.deleted as number,
  };
}

/** The Budapest calendar date of a Unix timestamp, as Core's series labels it. */
export function budapestDate(epochSeconds: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REGISTRATION_STATS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(epochSeconds * 1000));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Parses the `registration_platform_stats` envelope; null for anything but a complete schema-1 answer. */
export function registrationPlatformStats(
  response: unknown,
  expectedDays: RegistrationStatsRange,
): RegistrationPlatformStats | null {
  const envelope = record(response);
  const data = record(envelope?.data);
  if (envelope?.success !== true || envelope.status_code !== 200 || Object.hasOwn(envelope, "error")) return null;
  if (!data || data.schema_version !== 1) return null;
  if (!count(data.generated_at) || data.generated_at === 0 || data.timezone !== REGISTRATION_STATS_TIMEZONE) return null;
  if (data.days !== expectedDays) return null;
  const platforms = record(data.platforms);
  if (!platforms || Object.keys(platforms).join() !== SIGNUP_PLATFORMS.join()) return null;
  const parsedPlatforms = {} as Record<SignupPlatform, RegistrationBlock>;
  for (const key of SIGNUP_PLATFORMS) {
    const parsed = block(platforms[key]);
    if (!parsed) return null;
    parsedPlatforms[key] = parsed;
  }
  const all = block(data.all);
  if (!all) return null;
  for (const key of COUNTERS) {
    if (key === "signed_in_30_days") continue;
    const sum = SIGNUP_PLATFORMS.reduce((total, platform) => total + parsedPlatforms[platform][key], 0);
    if (sum !== all[key]) return null;
  }
  for (const gender of ["male", "female", "other"] as const) {
    const sum = SIGNUP_PLATFORMS.reduce((total, platform) => total + parsedPlatforms[platform].gender[gender], 0);
    if (sum !== all.gender[gender]) return null;
  }
  // A member may sign in on several platforms, so the overall figure is at most the platform sum.
  const signedIn = SIGNUP_PLATFORMS.reduce((total, platform) => total + parsedPlatforms[platform].signed_in_30_days, 0);
  if (all.signed_in_30_days > signedIn) return null;
  // One row per Budapest day, consecutive, oldest first, ending on the day it was generated.
  if (!Array.isArray(data.daily) || data.daily.length !== expectedDays) return null;
  const daily: RegistrationDay[] = [];
  for (const entry of data.daily) {
    const parsed = day(entry);
    if (!parsed) return null;
    const previous = daily[daily.length - 1];
    if (previous && utcDay(parsed.date)! - utcDay(previous.date)! !== DAY_MS) return null;
    daily.push(parsed);
  }
  if (daily[daily.length - 1]!.date !== budapestDate(data.generated_at)) return null;
  return {
    schema_version: 1,
    generated_at: data.generated_at,
    timezone: REGISTRATION_STATS_TIMEZONE,
    days: expectedDays,
    platforms: parsedPlatforms,
    all,
    daily,
  };
}

export type RegistrationStatsFailure = "daysInvalid" | "unavailable" | "error";

/**
 * Why a read failed: Core's 422 `registration-stats-days-invalid` (a range this console should
 * never send), its 503 `registration-stats-unavailable` (storage), or anything else.
 */
export function registrationStatsFailure(response: unknown): RegistrationStatsFailure {
  const envelope = record(response);
  if (envelope?.success !== false) return "error";
  if (envelope.status_code === 422 && envelope.error === "registration-stats-days-invalid") return "daysInvalid";
  if (envelope.status_code === 503 && envelope.error === "registration-stats-unavailable") return "unavailable";
  return "error";
}

/**
 * The same-origin bridge forwards `registration_platform_stats` with at most one
 * `days` of 30 or 90 (Core's RANGE_DAYS) and nothing else.
 */
export function normalizeRegistrationPlatformStatsProxyBody(
  action: string,
  body: Record<string, unknown>,
): { days?: RegistrationStatsRange } | null | undefined {
  if (action !== "registration_platform_stats") return undefined;
  const keys = Object.keys(body);
  if (keys.length === 0) return {};
  const days = body.days;
  return keys.length === 1 && keys[0] === "days"
    && (REGISTRATION_STATS_RANGES as readonly unknown[]).includes(days)
    ? { days: days as RegistrationStatsRange }
    : null;
}

/** Registrations of one day across the four platforms. */
export function dayTotal(row: RegistrationDay): number {
  return row.web + row.ios + row.android + row.unknown;
}

/** A whole-number share: 0 of 0 is 0 %. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Clean integer axis ticks from zero: every count up to 4, then 1-2-5 steps; the last tick is the top. */
export function chartTicks(max: number): number[] {
  if (max <= 4) return Array.from({ length: Math.max(max, 1) + 1 }, (_, index) => index);
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
}

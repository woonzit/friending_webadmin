/**
 * Core's read-only moderation insight for one member (`user_moderation_insight`,
 * schema 1, Core 7ea2766a `AdminMemberInsightService`): how and from where the
 * account was created, how it has signed in since, which other accounts were
 * seen on the same addresses, and what the member provided.
 *
 * Strict and closed: every object inside `data` must carry exactly Core's keys,
 * every value its type and bound, every vocabulary its known members in Core's
 * order. A loosely typed success is an error, never a partly filled panel an
 * operator could read as "nothing suspicious". The payload holds sign-in
 * addresses, so nothing here logs, stores or forwards it.
 */

export const INSIGHT_SCHEMA_VERSION = 1;
/** `AdminMemberInsightService::RECENT_LOGIN_LIMIT` / `SHARED_ACCOUNT_LIMIT`. */
export const INSIGHT_RECENT_LOGIN_LIMIT = 15;
export const INSIGHT_SHARED_ACCOUNT_LIMIT = 20;
/** Core's uid bound on this route (`WebadminController::userModerationInsight`). */
export const INSIGHT_MAX_UID = 2_147_483_647;

export const INSIGHT_PLATFORMS = ["web", "ios", "android", "unknown"] as const;
export type InsightPlatform = (typeof INSIGHT_PLATFORMS)[number];

/** `AdminMemberInsightService::methods()`, in the order Core lists them. */
export const INSIGHT_METHODS = ["email", "phone", "apple", "google", "facebook"] as const;
export type InsightMethod = (typeof INSIGHT_METHODS)[number];

/** `AdminMemberInsightService::assemble()` flags, in the order Core raises them. */
export const INSIGHT_FLAGS = [
  "signup-ip-country-differs",
  "shared-signup-ip",
  "shared-login-ip",
  "all-interests-selected",
  "empty-about",
  "no-return-after-signup",
  "logins-from-several-countries",
] as const;
export type InsightFlag = (typeof INSIGHT_FLAGS)[number];

export type InsightGeo = { country: string; country_code: string; city: string };
export type InsightLogin = InsightGeo & { at: number; ip: string; platform: InsightPlatform; app_build: string };
export type InsightTag = { key: string; name: string; named: boolean };
export type InsightAccount = {
  uid: number;
  display_name: string;
  created_at: number;
  platform: InsightPlatform;
  registered_from_signup_ip: boolean;
  shared_address_count: number;
  last_seen_on_shared_address_at: number;
  demo: boolean;
};

export type UserModerationInsight = {
  schema_version: 1;
  uid: number;
  signup: {
    at: number;
    platform: InsightPlatform;
    ip: string;
    ip_geo: InsightGeo | null;
    chosen_location: InsightGeo & { source: string };
    legal_source: string;
    email_verified: boolean;
    methods: InsightMethod[];
  };
  last_login: InsightLogin | null;
  last_seen_at: number;
  logins: {
    total: number;
    after_signup: number;
    distinct_addresses: number;
    distinct_countries: number;
    by_platform: Record<InsightPlatform, number>;
    recent: InsightLogin[];
    scanned: number;
  };
  shared_addresses: {
    registered_from_signup_ip: number;
    seen_on_any_address: number;
    accounts: InsightAccount[];
  };
  profile: { interests: number; interests_maximum: number; about_length: number };
  flags: InsightFlag[];
  provided: { interests: InsightTag[]; gender: string; visible_to: string; about_me: string };
};

type Row = Record<string, unknown>;

/** A plain object with exactly these keys (order-insensitive), or null. */
function exact(value: unknown, keys: readonly string[]): Row | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Row;
  const present = Object.keys(row);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(row, key)) ? row : null;
}

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Core's `text()`: control characters stripped, at most `limit` code points. */
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && [...value].length <= limit && !/\p{Cc}/u.test(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

const countryCode = (value: unknown): value is string =>
  typeof value === "string" && (value === "" || /^[A-Z]{2}$/.test(value));

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function ipv6(value: string): boolean {
  if (value.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(value)) return false;
  let body = value;
  let tailGroups = 0;
  const lastColon = body.lastIndexOf(":");
  if (body.includes(".")) {
    // An embedded IPv4 tail counts as two groups.
    if (!IPV4.test(body.slice(lastColon + 1))) return false;
    body = `${body.slice(0, lastColon + 1)}0`;
    tailGroups = 1;
  }
  const halves = body.split("::");
  if (halves.length > 2) return false;
  const groups = halves.map((half) => (half === "" ? [] : half.split(":")));
  if (groups.flat().some((group) => !/^[0-9A-Fa-f]{1,4}$/.test(group))) return false;
  const total = groups.flat().length + tailGroups;
  return halves.length === 2 ? total <= 7 : total === 8;
}

/** Core's `ip()`: a valid IPv4/IPv6 address, or "" when none was recorded. */
const ip = (value: unknown): value is string =>
  typeof value === "string" && (value === "" || IPV4.test(value) || (value.includes(":") && ipv6(value)));

/** Strictly increasing positions in Core's order: known, unique and canonical. */
function ordered<T extends string>(values: readonly T[], items: unknown): T[] | null {
  if (!Array.isArray(items)) return null;
  let last = -1;
  for (const item of items) {
    const index = typeof item === "string" ? (values as readonly string[]).indexOf(item) : -1;
    if (index <= last) return null;
    last = index;
  }
  return items as T[];
}

const GEO_KEYS = ["country", "country_code", "city"] as const;

function geo(value: unknown): InsightGeo | null {
  const row = exact(value, GEO_KEYS);
  return row && text(row.country, 120) && countryCode(row.country_code) && text(row.city, 120)
    ? { country: row.country, country_code: row.country_code, city: row.city }
    : null;
}

const LOGIN_KEYS = ["at", "ip", "platform", "app_build", ...GEO_KEYS] as const;

function login(value: unknown): InsightLogin | null {
  const row = exact(value, LOGIN_KEYS);
  return row && count(row.at) && ip(row.ip) && oneOf(INSIGHT_PLATFORMS, row.platform) && text(row.app_build, 24)
    && text(row.country, 120) && countryCode(row.country_code) && text(row.city, 120)
    ? {
      at: row.at,
      ip: row.ip,
      platform: row.platform,
      app_build: row.app_build,
      country: row.country,
      country_code: row.country_code,
      city: row.city,
    }
    : null;
}

const ACCOUNT_KEYS = [
  "uid",
  "display_name",
  "created_at",
  "platform",
  "registered_from_signup_ip",
  "shared_address_count",
  "last_seen_on_shared_address_at",
  "demo",
] as const;

function account(value: unknown): InsightAccount | null {
  const row = exact(value, ACCOUNT_KEYS);
  return row && count(row.uid) && row.uid > 0 && row.uid <= INSIGHT_MAX_UID && text(row.display_name, 80)
    && count(row.created_at) && oneOf(INSIGHT_PLATFORMS, row.platform)
    && typeof row.registered_from_signup_ip === "boolean" && count(row.shared_address_count)
    && count(row.last_seen_on_shared_address_at) && typeof row.demo === "boolean"
    ? {
      uid: row.uid,
      display_name: row.display_name,
      created_at: row.created_at,
      platform: row.platform,
      registered_from_signup_ip: row.registered_from_signup_ip,
      shared_address_count: row.shared_address_count,
      last_seen_on_shared_address_at: row.last_seen_on_shared_address_at,
      demo: row.demo,
    }
    : null;
}

function tag(value: unknown): InsightTag | null {
  const row = exact(value, ["key", "name", "named"]);
  return row && text(row.key, 80) && row.key !== "" && text(row.name, 80) && typeof row.named === "boolean"
    ? { key: row.key, name: row.name, named: row.named }
    : null;
}

function list<T>(value: unknown, limit: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

const sameLogin = (left: InsightLogin, right: InsightLogin): boolean =>
  LOGIN_KEYS.every((key) => left[key] === right[key]);

/** Interest keys are unbounded on legacy rows; this only keeps a hostile body bounded. */
const INTEREST_TAG_LIMIT = 500;

/**
 * The `user_moderation_insight` success envelope for `expectedUid`, or null.
 * The legacy envelope trio (`message`, `status`, `can_send`) Core's reply adds
 * is ignored; everything inside `data` is closed.
 */
export function userModerationInsight(response: unknown, expectedUid: number): UserModerationInsight | null {
  const envelope = response !== null && typeof response === "object" && !Array.isArray(response)
    ? response as Row
    : null;
  if (!envelope || envelope.success !== true || envelope.status_code !== 200) return null;
  const data = exact(envelope.data, [
    "schema_version",
    "uid",
    "signup",
    "last_login",
    "last_seen_at",
    "logins",
    "shared_addresses",
    "profile",
    "flags",
    "provided",
  ]);
  if (!data || data.schema_version !== INSIGHT_SCHEMA_VERSION || data.uid !== expectedUid) return null;

  const signup = exact(data.signup, [
    "at",
    "platform",
    "ip",
    "ip_geo",
    "chosen_location",
    "legal_source",
    "email_verified",
    "methods",
  ]);
  const chosen = exact(signup?.chosen_location, ["city", "country", "country_code", "source"]);
  const logins = exact(data.logins, [
    "total",
    "after_signup",
    "distinct_addresses",
    "distinct_countries",
    "by_platform",
    "recent",
    "scanned",
  ]);
  const byPlatform = exact(logins?.by_platform, INSIGHT_PLATFORMS);
  const shared = exact(data.shared_addresses, ["registered_from_signup_ip", "seen_on_any_address", "accounts"]);
  const profile = exact(data.profile, ["interests", "interests_maximum", "about_length"]);
  const provided = exact(data.provided, ["interests", "gender", "visible_to", "about_me"]);
  if (!signup || !chosen || !logins || !byPlatform || !shared || !profile || !provided) return null;

  const ipGeo = signup.ip_geo === null ? null : geo(signup.ip_geo);
  const chosenGeo = geo({ country: chosen.country, country_code: chosen.country_code, city: chosen.city });
  const lastLogin = data.last_login === null ? null : login(data.last_login);
  const recent = list(logins.recent, INSIGHT_RECENT_LOGIN_LIMIT, login);
  const accounts = list(shared.accounts, INSIGHT_SHARED_ACCOUNT_LIMIT, account);
  const interests = list(provided.interests, INTEREST_TAG_LIMIT, tag);
  const methods = ordered(INSIGHT_METHODS, signup.methods);
  const flags = ordered(INSIGHT_FLAGS, data.flags);
  if ((signup.ip_geo !== null && !ipGeo) || !chosenGeo || (data.last_login !== null && !lastLogin)
    || !recent || !accounts || !interests || !methods || !flags
    || !count(signup.at) || !oneOf(INSIGHT_PLATFORMS, signup.platform) || !ip(signup.ip)
    || !text(chosen.source, 32) || !text(signup.legal_source, 32) || typeof signup.email_verified !== "boolean"
    || !count(data.last_seen_at)
    || !count(logins.total) || !count(logins.after_signup) || !count(logins.distinct_addresses)
    || !count(logins.distinct_countries) || !count(logins.scanned)
    || !INSIGHT_PLATFORMS.every((name) => count(byPlatform[name]))
    || !count(shared.registered_from_signup_ip) || !count(shared.seen_on_any_address)
    || !count(profile.interests) || !count(profile.interests_maximum) || !count(profile.about_length)
    || !text(provided.gender, 40) || !text(provided.visible_to, 40) || !text(provided.about_me, 3000)) return null;

  // What Core's assembly makes true by construction; a body that breaks it is not Core's.
  const platformTotal = INSIGHT_PLATFORMS.reduce((sum, name) => sum + (byPlatform[name] as number), 0);
  if (platformTotal !== logins.scanned
    || logins.total < logins.scanned
    || logins.after_signup > logins.scanned
    || recent.length !== Math.min(logins.scanned, INSIGHT_RECENT_LOGIN_LIMIT)
    || (lastLogin === null) !== (recent.length === 0)
    || (lastLogin !== null && !sameLogin(lastLogin, recent[0]!))
    || shared.registered_from_signup_ip > shared.seen_on_any_address
    || accounts.length !== Math.min(shared.seen_on_any_address, INSIGHT_SHARED_ACCOUNT_LIMIT)
    || new Set(accounts.map((row) => row.uid)).size !== accounts.length
    || accounts.some((row) => row.uid === expectedUid)
    || (signup.ip === "" && (ipGeo !== null || accounts.some((row) => row.registered_from_signup_ip)))
    || new Set(interests.map((row) => row.key)).size !== interests.length
    || profile.interests < interests.length) return null;

  return {
    schema_version: INSIGHT_SCHEMA_VERSION,
    uid: expectedUid,
    signup: {
      at: signup.at,
      platform: signup.platform,
      ip: signup.ip,
      ip_geo: ipGeo,
      chosen_location: { ...chosenGeo, source: chosen.source },
      legal_source: signup.legal_source,
      email_verified: signup.email_verified,
      methods: [...methods],
    },
    last_login: lastLogin,
    last_seen_at: data.last_seen_at,
    logins: {
      total: logins.total,
      after_signup: logins.after_signup,
      distinct_addresses: logins.distinct_addresses,
      distinct_countries: logins.distinct_countries,
      by_platform: {
        web: byPlatform.web as number,
        ios: byPlatform.ios as number,
        android: byPlatform.android as number,
        unknown: byPlatform.unknown as number,
      },
      recent,
      scanned: logins.scanned,
    },
    shared_addresses: {
      registered_from_signup_ip: shared.registered_from_signup_ip,
      seen_on_any_address: shared.seen_on_any_address,
      accounts,
    },
    profile: {
      interests: profile.interests,
      interests_maximum: profile.interests_maximum,
      about_length: profile.about_length,
    },
    flags: [...flags],
    provided: {
      interests,
      gender: provided.gender,
      visible_to: provided.visible_to,
      about_me: provided.about_me,
    },
  };
}

/**
 * The bridge body for `user_moderation_insight`: exactly one canonical positive
 * uid, the only parameter Core reads. `undefined` for any other action, `null`
 * for a body the bridge refuses instead of forwarding.
 */
export function normalizeUserModerationInsightProxyBody(
  action: string,
  body: Record<string, unknown>,
): { uid: number } | null | undefined {
  if (action !== "user_moderation_insight") return undefined;
  const keys = Object.keys(body);
  const uid = body.uid;
  return keys.length === 1 && keys[0] === "uid"
    && typeof uid === "number" && Number.isSafeInteger(uid) && uid > 0 && uid <= INSIGHT_MAX_UID
    ? { uid }
    : null;
}

/**
 * Email delivery (ported from Freelove Webadmin 0c5b522 and its Core review fixes, 2026-11-02): when
 * each transactional email reached Mailgun and when Mailgun delivered it, with the receiving
 * server's answer when it held a message back. Core's `/v1/webadmin/mail_delivery` is read-only.
 *
 * This module closes the filters the bridge forwards and parses Core's answer, failing closed: a
 * partial, loosely typed, self-contradicting or mismatched answer is an error, never a list an
 * operator could read as "no emails" or "all delivered". The bridge runs the same parser before
 * anything reaches the browser, and adds one floor of its own: a read-only viewer never receives
 * unmasked recipient addresses, whatever Core sends.
 */

export const MAIL_DELIVERY_DAYS = [1, 7, 30] as const;
export type MailDeliveryDays = (typeof MAIL_DELIVERY_DAYS)[number];
/**
 * Friending Core's `MailDeliveryReadService::KINDS`, in its order: the outbox kinds Core writes.
 * Core reports any other stored kind as `other`, so a kind outside this list is a contract change.
 */
export const MAIL_DELIVERY_KINDS = [
  "email_auth_verification",
  "email_change_verification",
  "admin_login_verification",
  "admin_outbound_message",
  "user_report",
  "moderation_footprint_report",
  "support_request",
] as const;
export type MailDeliveryKind = (typeof MAIL_DELIVERY_KINDS)[number];
/** The state filter: the five row states plus `slow` (delivered later than `slow_seconds`). */
export const MAIL_DELIVERY_STATES = ["delivered", "slow", "pending", "retrying", "failed", "not_sent"] as const;
export type MailDeliveryStateFilter = (typeof MAIL_DELIVERY_STATES)[number];
export const MAIL_DELIVERY_ROW_STATES = ["delivered", "pending", "retrying", "failed", "not_sent"] as const;
export type MailDeliveryRowState = (typeof MAIL_DELIVERY_ROW_STATES)[number];

/** Core's page size, its by-domain cap and the highest page it accepts (`[1-9][0-9]{0,3}`). */
export const MAIL_DELIVERY_PAGE_SIZE = 50;
const DOMAIN_LIMIT = 10;
const MAX_PAGE = 9999;
const ADDRESS_MAX = 254;
const ISSUE_MAX_CODE_POINTS = 200;
const SEND_ERROR_MAX = 80;
const MASK = "•••";

export type MailDeliveryFilters = {
  days: MailDeliveryDays;
  kind: MailDeliveryKind | "";
  state: MailDeliveryStateFilter | "";
  /** Lowercased and trimmed; "" for every recipient. */
  email: string;
  page: number;
};
export const DEFAULT_MAIL_DELIVERY_FILTERS: MailDeliveryFilters = { days: 1, kind: "", state: "", email: "", page: 1 };

export type MailDeliveryIssue = { code: number | null; message: string };
export type MailDeliveryRow = {
  id: string;
  kind: MailDeliveryKind | "other";
  recipient: string;
  recipient_domain: string;
  created_at: number;
  handed_at: number | null;
  delivered_at: number | null;
  delivery_seconds: number | null;
  state: MailDeliveryRowState;
  send_error: string;
  delivery_attempts: number | null;
  temporary_failures: number;
  issue: MailDeliveryIssue | null;
};
export type MailDeliveryDomain = {
  domain: string;
  total: number;
  delivered: number;
  median_seconds: number | null;
  max_seconds: number | null;
  slow: number;
};
export type MailDeliverySummary = {
  total: number;
  counts: Record<MailDeliveryRowState, number>;
  median_seconds: number | null;
  p90_seconds: number | null;
  max_seconds: number | null;
  slow: number;
  by_domain: MailDeliveryDomain[];
};
export type MailDelivery = {
  filters: { days: MailDeliveryDays; kind: MailDeliveryKind | ""; state: MailDeliveryStateFilter | ""; email: string };
  summary: MailDeliverySummary;
  rows: MailDeliveryRow[];
  page: number;
  has_more: boolean;
  slow_seconds: number;
  /** The last complete Mailgun event poll. */
  synced_at: number | null;
  /** The last poll attempt, complete or not. */
  sync_attempted_at: number | null;
  /** A poll Mailgun did not answer after the last complete one; null once a later poll succeeded. */
  sync_failed_at: number | null;
  can_see_addresses: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const epoch = (value: unknown): value is number => count(value) && value > 0;
const optionalEpoch = (value: unknown): value is number | null => value === null || epoch(value);
const instant = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);
const seconds = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const codePoints = (value: string): number => [...value].length;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * A recipient filter Core's `FILTER_VALIDATE_EMAIL` accepts: ASCII, a dotted domain. Deliberately a
 * little narrower than Core, so the console never sends an address Core would refuse.
 */
const ADDRESS = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/** The canonical form of a recipient filter, or null when it is not one exact address. */
export function mailDeliveryAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  return address.length <= ADDRESS_MAX && ADDRESS.test(address) ? address : null;
}

/** Core's form body: the days and page always, the other three only when set. */
export type MailDeliveryCoreParams = {
  days: MailDeliveryDays;
  page: number;
  kind?: MailDeliveryKind;
  state?: MailDeliveryStateFilter;
  email?: string;
};

/** The filters a browser body (or a Core form body built from one) asks for, or null for anything else. */
export function mailDeliveryFilters(body: Record<string, unknown>): MailDeliveryFilters | null {
  if (Object.keys(body).some((key) => !["days", "kind", "state", "email", "page"].includes(key))) return null;
  const { days = 1, kind = "", state = "", email = "", page = 1 } = body;
  if (!(MAIL_DELIVERY_DAYS as readonly unknown[]).includes(days)) return null;
  if (kind !== "" && !oneOf(MAIL_DELIVERY_KINDS, kind)) return null;
  if (state !== "" && !oneOf(MAIL_DELIVERY_STATES, state)) return null;
  if (typeof email !== "string" || email.length > ADDRESS_MAX) return null;
  const address = email.trim() === "" ? "" : mailDeliveryAddress(email);
  if (address === null) return null;
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > MAX_PAGE) return null;
  return {
    days: days as MailDeliveryDays,
    kind: kind as MailDeliveryFilters["kind"],
    state: state as MailDeliveryFilters["state"],
    email: address,
    page: page as number,
  };
}

/** Core's form body for the filters: the defaults of the optional three are left out. */
export function mailDeliveryCoreParams(filters: MailDeliveryFilters): MailDeliveryCoreParams {
  return {
    days: filters.days,
    page: filters.page,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.email ? { email: filters.email } : {}),
  };
}

/**
 * The same-origin bridge forwards `mail_delivery` with exactly the five closed filters (each may be
 * left out for its default) and nothing else; anything else is refused before Core is called.
 */
export function normalizeMailDeliveryProxyBody(
  action: string,
  body: Record<string, unknown>,
): MailDeliveryCoreParams | null | undefined {
  if (action !== "mail_delivery") return undefined;
  const filters = mailDeliveryFilters(body);
  return filters ? mailDeliveryCoreParams(filters) : null;
}

/** Core's mask: at most two leading characters of the local part, the mask, then `@domain`. */
const MASKED = /^[^\s@]{0,2}•••@[^\s@]{1,253}$/u;
const DOMAIN = /^[a-z0-9.-]{1,253}$/u;

function issue(value: unknown): MailDeliveryIssue | null | undefined {
  if (value === null) return null;
  const row = record(value);
  if (!row || !(row.code === null || (count(row.code) && row.code <= 999))) return undefined;
  if (typeof row.message !== "string" || codePoints(row.message) > ISSUE_MAX_CODE_POINTS) return undefined;
  return { code: row.code as number | null, message: row.message };
}

function row(value: unknown, masked: boolean): MailDeliveryRow | null {
  const entry = record(value);
  if (!entry || typeof entry.id !== "string" || !/^[a-f0-9]{24}$/u.test(entry.id)) return null;
  if (!(entry.kind === "other" || oneOf(MAIL_DELIVERY_KINDS, entry.kind))) return null;
  if (!text(entry.recipient, 320) || !(entry.recipient === "" || entry.recipient.includes("@"))) return null;
  // A masked view carries only masked addresses; an unmasked one never carries the mask.
  if (entry.recipient !== "" && (masked ? !MASKED.test(entry.recipient) : entry.recipient.includes(MASK))) return null;
  if (!text(entry.recipient_domain, 253) || !(entry.recipient_domain === "" || DOMAIN.test(entry.recipient_domain))) return null;
  if (!epoch(entry.created_at) || !instant(entry.handed_at) || !instant(entry.delivered_at) || !seconds(entry.delivery_seconds)) return null;
  // Delivery time is Mailgun's acceptance to the receiving server's, rounded to a tenth of a second.
  const { handed_at: handed, delivered_at: delivered, delivery_seconds: delivery } = entry;
  if ((delivery === null) !== (handed === null || delivered === null)) return null;
  if (delivery !== null && Math.abs(Math.max(0, (delivered as number) - (handed as number)) - delivery) > 0.1) return null;
  if (!oneOf(MAIL_DELIVERY_ROW_STATES, entry.state)) return null;
  // Core names a send error only for an email that was never handed over.
  if (!text(entry.send_error, SEND_ERROR_MAX) || (entry.send_error !== "" && entry.state !== "not_sent")) return null;
  if (!(entry.delivery_attempts === null || count(entry.delivery_attempts)) || !count(entry.temporary_failures)) return null;
  const parsedIssue = issue(entry.issue);
  if (parsedIssue === undefined) return null;
  return {
    id: entry.id,
    kind: entry.kind as MailDeliveryRow["kind"],
    recipient: entry.recipient,
    recipient_domain: entry.recipient_domain,
    created_at: entry.created_at,
    handed_at: handed as number | null,
    delivered_at: delivered as number | null,
    delivery_seconds: delivery as number | null,
    state: entry.state,
    send_error: entry.send_error,
    delivery_attempts: entry.delivery_attempts as number | null,
    temporary_failures: entry.temporary_failures,
    issue: parsedIssue,
  };
}

/** Median, ninetieth percentile and slowest: all present or all absent, and in that order. */
function ordered(...values: Array<number | null>): boolean {
  if (values.every((value) => value === null)) return true;
  if (values.some((value) => value === null)) return false;
  return values.every((value, index) => index === 0 || (values[index - 1] as number) <= (value as number));
}

function domain(value: unknown, slowSeconds: number): MailDeliveryDomain | null {
  const entry = record(value);
  if (!entry || typeof entry.domain !== "string" || !(entry.domain === "?" || DOMAIN.test(entry.domain))) return null;
  if (!count(entry.total) || entry.total === 0 || !count(entry.delivered) || !count(entry.slow)) return null;
  if (!seconds(entry.median_seconds) || !seconds(entry.max_seconds)) return null;
  if (entry.delivered > entry.total || entry.slow > entry.delivered) return null;
  if ((entry.delivered === 0) !== (entry.max_seconds === null) || !ordered(entry.median_seconds, entry.max_seconds)) return null;
  if ((entry.slow > 0) !== (entry.max_seconds !== null && entry.max_seconds > slowSeconds)) return null;
  return {
    domain: entry.domain,
    total: entry.total,
    delivered: entry.delivered,
    median_seconds: entry.median_seconds,
    max_seconds: entry.max_seconds,
    slow: entry.slow,
  };
}

function summary(value: unknown, slowSeconds: number): MailDeliverySummary | null {
  const entry = record(value);
  const counts = record(entry?.counts);
  if (!entry || !counts || Object.keys(counts).length !== MAIL_DELIVERY_ROW_STATES.length) return null;
  const parsedCounts = {} as Record<MailDeliveryRowState, number>;
  for (const key of MAIL_DELIVERY_ROW_STATES) {
    if (!count(counts[key])) return null;
    parsedCounts[key] = counts[key] as number;
  }
  if (!count(entry.total) || entry.total !== MAIL_DELIVERY_ROW_STATES.reduce((sum, key) => sum + parsedCounts[key], 0)) return null;
  if (!seconds(entry.median_seconds) || !seconds(entry.p90_seconds) || !seconds(entry.max_seconds) || !count(entry.slow)) return null;
  if (!ordered(entry.median_seconds, entry.p90_seconds, entry.max_seconds) || entry.slow > entry.total) return null;
  if ((entry.slow > 0) !== (entry.max_seconds !== null && entry.max_seconds > slowSeconds)) return null;
  if (!Array.isArray(entry.by_domain) || entry.by_domain.length > DOMAIN_LIMIT) return null;
  const domains: MailDeliveryDomain[] = [];
  for (const item of entry.by_domain) {
    const parsed = domain(item, slowSeconds);
    if (!parsed || domains.some((seen) => seen.domain === parsed.domain)) return null;
    domains.push(parsed);
  }
  if (domains.reduce((sum, item) => sum + item.total, 0) > entry.total) return null;
  return {
    total: entry.total,
    counts: parsedCounts,
    median_seconds: entry.median_seconds,
    p90_seconds: entry.p90_seconds,
    max_seconds: entry.max_seconds,
    slow: entry.slow,
    by_domain: domains,
  };
}

/**
 * Core's answer for exactly these filters, or null. `viewer` is the bridge's own floor: when the
 * signed-in operator holds no write role, an answer that offers unmasked addresses is refused.
 */
export function mailDelivery(
  response: unknown,
  filters: MailDeliveryFilters,
  options: { viewer?: boolean } = {},
): MailDelivery | null {
  const envelope = record(response);
  const data = record(envelope?.data);
  if (envelope?.success !== true || envelope.status_code !== 200 || Object.hasOwn(envelope, "error") || !data) return null;
  // The answer is for the view that asked: a late answer for other filters is never shown.
  const echo = record(data.filters);
  if (!echo || Object.keys(echo).length !== 4 || echo.days !== filters.days || echo.kind !== filters.kind
    || echo.state !== filters.state || echo.email !== filters.email || data.page !== filters.page) return null;
  if (typeof data.can_see_addresses !== "boolean" || (options.viewer === true && data.can_see_addresses)) return null;
  if (!count(data.slow_seconds) || data.slow_seconds === 0 || typeof data.has_more !== "boolean") return null;
  if (!optionalEpoch(data.synced_at) || !optionalEpoch(data.sync_attempted_at) || !optionalEpoch(data.sync_failed_at)) return null;
  // A failure is reported only when it is newer than the last complete poll, and every poll is an attempt.
  const synced = data.synced_at ?? 0, failed = data.sync_failed_at ?? 0;
  if (data.sync_failed_at !== null && failed <= synced) return null;
  if (data.sync_attempted_at !== null && data.sync_attempted_at < Math.max(synced, failed)) return null;
  if ((data.synced_at !== null || data.sync_failed_at !== null) && data.sync_attempted_at === null) return null;
  const parsedSummary = summary(data.summary, data.slow_seconds);
  if (!parsedSummary || !Array.isArray(data.rows) || data.rows.length > MAIL_DELIVERY_PAGE_SIZE) return null;
  if (data.has_more && data.rows.length !== MAIL_DELIVERY_PAGE_SIZE) return null;
  const rows: MailDeliveryRow[] = [];
  for (const value of data.rows) {
    const parsed = row(value, !data.can_see_addresses);
    if (!parsed || rows.some((seen) => seen.id === parsed.id)) return null;
    // Newest first, and every row matches the filters it was listed under.
    if (rows.length > 0 && rows[rows.length - 1]!.created_at < parsed.created_at) return null;
    if (filters.kind && parsed.kind !== filters.kind) return null;
    if (filters.state === "slow" ? !(parsed.delivery_seconds !== null && parsed.delivery_seconds > data.slow_seconds)
      : filters.state !== "" && parsed.state !== filters.state) return null;
    // Core matches the address in any letter case and shows it as the outbox stored it.
    if (filters.email && data.can_see_addresses && parsed.recipient.toLowerCase() !== filters.email) return null;
    rows.push(parsed);
  }
  // Without a state filter the list is the summary's own population, page by page.
  if (filters.state === "" && rows.length + (filters.page - 1) * MAIL_DELIVERY_PAGE_SIZE > parsedSummary.total) return null;
  return {
    filters: { days: filters.days, kind: filters.kind, state: filters.state, email: filters.email },
    summary: parsedSummary,
    rows,
    page: filters.page,
    has_more: data.has_more,
    slow_seconds: data.slow_seconds,
    synced_at: data.synced_at,
    sync_attempted_at: data.sync_attempted_at,
    sync_failed_at: data.sync_failed_at,
    can_see_addresses: data.can_see_addresses,
  };
}

/**
 * What the bridge sends the browser for Core's successful answer to the forwarded `params`: only the
 * parsed answer, or null (an unknown Core response) when it does not parse in full. `viewer` is the
 * bridge's floor for an operator without a write role: unmasked addresses are never forwarded.
 */
export function normalizeMailDeliveryResponse(
  response: unknown,
  params: MailDeliveryCoreParams,
  options: { viewer: boolean },
): { success: true; status_code: 200; data: MailDelivery } | null {
  const filters = mailDeliveryFilters(params);
  const data = filters ? mailDelivery(response, filters, options) : null;
  return data ? { success: true, status_code: 200, data } : null;
}

export type MailDeliveryFailure = "invalid" | "unavailable" | "error";

/**
 * Why a read failed: Core's 422 `invalid-input` (a filter this console should never send), its 503
 * `mail-delivery-unavailable` (the outbox could not be read), or anything else.
 */
export function mailDeliveryFailure(response: unknown): MailDeliveryFailure {
  const envelope = record(response);
  if (envelope?.success !== false) return "error";
  if (envelope.status_code === 422 && envelope.error === "invalid-input") return "invalid";
  if (envelope.status_code === 503 && envelope.error === "mail-delivery-unavailable") return "unavailable";
  return "error";
}

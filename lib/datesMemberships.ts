/**
 * The members of an event as its page lists them, and what removed or banned
 * each of them (host moderation v1, Core docs/EVENT_HOST_MODERATION_V1.md).
 *
 * Core serves a membership row of `dates_activity_detail` whole. The bridge
 * hands the page the named part of it: the member, the relationship, and the
 * facts read here -
 * - `removed_at`, `removed_by_uid`, `removed_reason`: on a row that has them,
 *   from any Core;
 * - `removal_note` and `ban` (the whole subdocument), and a `null` for every
 *   one of the five a row does not have: only for a request with the command
 *   contract selector, from a Core that knows host moderation;
 * - `released_at`: the seat a restriction released. It names no host.
 *
 * So each fact is optional. Absent means "not served": the row is listed as
 * before, and what would show the fact is not rendered. A fact that IS served
 * and is not what Core writes makes the facts of that row unreadable: the row
 * says so, and is never shown as "not removed, not banned".
 *
 * The rule is Core's own (DatesHostModerationPolicy::removedEntry, removedBy):
 * a member is banned iff `ban.state` is `active`, and a ban outranks a removal
 * whatever the relationship is; otherwise a member whose relationship is
 * `removed` was removed - by moderation when the row says so
 * (`removed_reason: "moderation"`) or when a restriction released the seat
 * after the last host removal, by the host otherwise. The host's note belongs
 * to the host's removal only. Where Core's list for the host falls back on
 * "the host" without a host on the row, this page names nobody.
 */
export type DatesMembershipActor = { kind: "host"; uid: number } | { kind: "moderation" } | { kind: "unknown" };
export type DatesMembershipStanding =
  /** `by_uid`: the host who placed the ban; `null` when the row does not name one. */
  | { state: "banned"; at: number; by_uid: number | null; note: string | null }
  /** `at`: `null` when the row has no time of the removal. */
  | { state: "removed"; at: number | null; by: DatesMembershipActor; note: string | null };
/** A ban that was lifted: when and by whom, and when it had been placed. */
export type DatesMembershipLiftedBan = { at: number; by_uid: number | null; banned_at: number };
export type DatesMembershipRow = {
  /** `null`: the row does not carry a member id the page can print. */
  uid: number | null;
  relationship: string | null;
  /** Removed or banned now; `null`: neither, or not served. */
  standing: DatesMembershipStanding | null;
  lifted: DatesMembershipLiftedBan | null;
  /** The removal and ban facts of this row were served and cannot be read: `standing` and `lifted` say nothing. */
  unreadable: boolean;
};
export type DatesMemberships = {
  rows: DatesMembershipRow[];
  /**
   * How many of the listed members stand removed and how many banned; `null`
   * when Core did not serve the ban on every row (it cannot be said who is
   * banned), when a row is unreadable, or when there is no row.
   */
  counts: { removed: number; banned: number } | null;
};

/** Core's limit of a host's note (DatesHostModerationPolicy::NOTE_LIMIT), in characters. */
export const DATES_MEMBERSHIP_NOTE_MAX = 200;
export const DATES_MEMBERSHIP_BAN_STATES = ["active", "lifted"] as const;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const epoch = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000;
/** A member id, or the 0 Core leaves where there is none. */
const uidOrNone = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const noteText = (value: unknown): value is string => typeof value === "string" && Array.from(value).length <= DATES_MEMBERSHIP_NOTE_MAX;
/** An absent key and a `null` are both "the row has none". */
const none = (value: unknown): value is null | undefined => value === null || value === undefined;
const member = (value: number | null | undefined): number | null => typeof value === "number" && value > 0 ? value : null;
/** A note that is only space is no note, as Core reads it. */
const note = (value: string | null | undefined): string | null => typeof value === "string" && value.trim() !== "" ? value : null;

type Ban = { state: typeof DATES_MEMBERSHIP_BAN_STATES[number]; at: number; by_uid: number; note: string | null; lifted_at: number | null; lifted_by_uid: number | null };
/** The subdocument as Core writes it: placed (nothing lifted), or lifted (when, and by whom when the row says). */
function ban(value: unknown): value is Ban {
  if (!record(value) || !epoch(value.at) || !uidOrNone(value.by_uid) || !(value.note === null || noteText(value.note))) return false;
  if (value.state === "active") return value.lifted_at === null && value.lifted_by_uid === null;
  return value.state === "lifted" && epoch(value.lifted_at) && (value.lifted_by_uid === null || uidOrNone(value.lifted_by_uid));
}

function facts(row: Record<string, unknown>): Pick<DatesMembershipRow, "standing" | "lifted"> | null {
  if (!(none(row.removed_at) || epoch(row.removed_at)) || !(none(row.released_at) || epoch(row.released_at))
    || !(none(row.removed_by_uid) || uidOrNone(row.removed_by_uid)) || !(none(row.removed_reason) || (typeof row.removed_reason === "string" && row.removed_reason.length <= 40))
    || !(none(row.removal_note) || noteText(row.removal_note)) || !(none(row.ban) || ban(row.ban))) return null;
  const placed = none(row.ban) ? null : row.ban as Ban;
  const lifted = placed?.state === "lifted" ? { at: placed.lifted_at as number, by_uid: member(placed.lifted_by_uid), banned_at: placed.at } : null;
  if (placed?.state === "active") return { standing: { state: "banned", at: placed.at, by_uid: member(placed.by_uid), note: note(placed.note) }, lifted };
  if (row.relationship !== "removed") return { standing: null, lifted };
  const removedAt = (row.removed_at as number | null | undefined) ?? 0, releasedAt = (row.released_at as number | null | undefined) ?? 0;
  const host = member(row.removed_by_uid as number | null | undefined);
  const by: DatesMembershipActor = row.removed_reason === "moderation" || releasedAt > removedAt ? { kind: "moderation" } : host !== null ? { kind: "host", uid: host } : { kind: "unknown" };
  return { standing: { state: "removed", at: Math.max(removedAt, releasedAt) || null, by, note: by.kind === "host" ? note(row.removal_note as string | null | undefined) : null }, lifted };
}

/** The rows of an activity detail's `memberships`, in Core's order; a value that is not a list is no rows. */
export function datesMemberships(value: unknown): DatesMemberships {
  const list = Array.isArray(value) ? value : [];
  const rows = list.map((item): DatesMembershipRow => {
    if (!record(item)) return { uid: null, relationship: null, standing: null, lifted: null, unreadable: true };
    const read = facts(item);
    return { uid: member(typeof item.uid === "number" && Number.isSafeInteger(item.uid) ? item.uid : null), relationship: typeof item.relationship === "string" && item.relationship !== "" ? item.relationship : null,
      standing: read?.standing ?? null, lifted: read?.lifted ?? null, unreadable: read === null };
  });
  // Who is banned can be counted only where Core says of every listed member whether they are.
  const countable = rows.length > 0 && rows.every((row) => !row.unreadable) && list.every((item) => record(item) && Object.hasOwn(item, "ban"));
  return { rows, counts: countable ? { removed: rows.filter((row) => row.standing?.state === "removed").length, banned: rows.filter((row) => row.standing?.state === "banned").length } : null };
}

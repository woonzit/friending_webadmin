// Fail-closed parsers for the footprints-v1 admin payloads
// (handoffs/product-to-core/footprints-v1/DESIGN.md §6).

export const FOOTPRINT_GENDERS = ["male", "female", "other"] as const;
export type FootprintGender = (typeof FOOTPRINT_GENDERS)[number];

export type FootprintSettings = {
  dailyLimit: number;
  messageMaxLength: number;
  revision: number;
};

export type FootprintBadge = {
  id: string;
  labels: { en: string; hu: string };
  imageUrl: string;
  senderGenders: string[];
  senderGroupIds: string[];
  recipientGenders: string[];
  recipientGroupIds: string[];
  sortOrder: number;
  active: boolean;
  archived: boolean;
  revision: number;
};

export type FootprintCastGroup = {
  id: string;
  labels: { en: string; hu: string };
  active: boolean;
};

export type FootprintsAdminPayload = {
  settings: FootprintSettings;
  badges: FootprintBadge[];
  castGroups: FootprintCastGroup[];
  openReports: number;
};

export type FootprintReportUser = {
  id: number;
  name: string;
  avatar: string;
};

/**
 * Core's closed member reason set (`FootprintReportPolicy::REASONS`) plus
 * `unspecified`, which Core answers for a report stored before the contract.
 * Core maps any other stored value to `unspecified`, so nothing else is valid.
 */
export const FOOTPRINT_REPORT_REASONS = [
  "spam",
  "inapropriate",
  "aggression",
  "hate",
  "commercial",
  "criminal",
  "underage",
  "other",
  "unspecified",
] as const;
export type FootprintReportReason = (typeof FOOTPRINT_REPORT_REASONS)[number];

/** `FootprintReportPolicy::RESOLUTIONS`. */
export const FOOTPRINT_REPORT_RESOLUTIONS = ["dismissed", "message_removed"] as const;
export type FootprintReportResolution = (typeof FOOTPRINT_REPORT_RESOLUTIONS)[number];

/** The `action` values `resolve_footprint_report` takes. */
export const FOOTPRINT_REPORT_ACTIONS = ["dismiss", "remove_message"] as const;
export type FootprintReportAction = (typeof FOOTPRINT_REPORT_ACTIONS)[number];

export type FootprintReportStatus = "open" | "resolved";

/** `FootprintReportPolicy::NOTE_MAX_LENGTH`, code points. */
export const FOOTPRINT_REPORT_NOTE_MAX = 500;
/** The resolution note bound (`ModerationPolicy::normalizeReason`, 300 code points). */
export const FOOTPRINT_RESOLUTION_NOTE_MAX = 300;
/** `FootprintReportPolicy::MAX_QUEUE_LIMIT`; the console asks for smaller pages. */
export const FOOTPRINT_REPORT_MAX_PAGE = 100;
export const FOOTPRINT_REPORT_PAGE_SIZE = 50;

export type FootprintState = {
  exists: boolean;
  hidden: boolean;
  messageRemoved: boolean;
};

export type FootprintReport = {
  id: string;
  footprintId: string;
  reporter: FootprintReportUser | null;
  sender: FootprintReportUser | null;
  badgeLabel: string;
  /** Empty when the badge has no artwork (legacy data); the row renders a placeholder. */
  badgeImage: string;
  message: string;
  createdAt: number;
  status: FootprintReportStatus;
  resolvedBy: string;
  /**
   * Whether the row carried Core's additive P-066 fields. A Core without them
   * sends none, and every field below is then `null`.
   */
  extended: boolean;
  /** `null` when unknown (no extended fields, or a stored row without the uid). */
  reporterUid: number | null;
  senderUid: number | null;
  reason: FootprintReportReason | null;
  note: string | null;
  footprintCreatedAt: number | null;
  resolution: FootprintReportResolution | null;
  resolutionNote: string | null;
  resolvedAt: number | null;
  footprintState: FootprintState | null;
  senderReportCount: number | null;
};

export type FootprintReportPage = {
  reports: FootprintReport[];
  hasMore: boolean;
  nextCursor: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmptyText(value: unknown): string | null {
  const parsed = text(value);
  return parsed && parsed.trim() !== "" ? parsed : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringList(
  value: unknown,
  accepts: (item: string) => boolean,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !accepts(item) || parsed.includes(item)) return null;
    parsed.push(item);
  }
  return parsed;
}

function mongoId(value: unknown): string | null {
  const parsed = text(value);
  return parsed && /^[0-9a-f]{24}$/.test(parsed) ? parsed : null;
}

function localizedLabels(value: unknown): { en: string; hu: string } | null {
  const labels = record(value);
  const en = nonEmptyText(labels?.en);
  const hu = nonEmptyText(labels?.hu);
  return en && hu ? { en, hu } : null;
}

function badge(value: unknown): FootprintBadge | null {
  const row = record(value);
  if (!row) return null;
  const id = mongoId(row.id);
  const labels = localizedLabels(row.labels);
  // Core's adminBadgeWire answers `""` for a badge stored without artwork (legacy
  // data; saveBadge itself requires one). The catalogue shows it with a blank
  // placeholder instead of refusing every badge, and its editor asks for a new image.
  const imageUrl = text(row.image_url);
  const senderGenders = stringList(
    row.sender_genders,
    (item) => FOOTPRINT_GENDERS.includes(item as FootprintGender),
  );
  const senderGroupIds = stringList(row.sender_group_ids, (item) => mongoId(item) !== null);
  const recipientGenders = stringList(
    row.recipient_genders,
    (item) => FOOTPRINT_GENDERS.includes(item as FootprintGender),
  );
  const recipientGroupIds = stringList(row.recipient_group_ids, (item) => mongoId(item) !== null);
  const sortOrder = integer(row.sort_order, 0, 100_000);
  const active = boolean(row.active);
  const archived = boolean(row.archived);
  const revision = integer(row.revision, 1);
  if (
    !id || !labels || imageUrl === null
    || !senderGenders || !senderGroupIds || !recipientGenders || !recipientGroupIds
    || sortOrder === null || active === null || archived === null || revision === null
  ) return null;
  return {
    id,
    labels,
    imageUrl,
    senderGenders,
    senderGroupIds,
    recipientGenders,
    recipientGroupIds,
    sortOrder,
    active,
    archived,
    revision,
  };
}

export function footprintsAdminPayload(value: unknown): FootprintsAdminPayload | null {
  const body = record(value);
  if (!body) return null;
  const settings = record(body.settings);
  const dailyLimit = integer(settings?.daily_limit, 1, 1_000);
  const messageMaxLength = integer(settings?.message_max_length, 1, 500);
  const revision = integer(settings?.revision, 0);
  const openReports = integer(body.open_reports, 0);
  if (
    !settings
    || dailyLimit === null
    || messageMaxLength === null
    || revision === null
    || openReports === null
    || !Array.isArray(body.badges)
    || !Array.isArray(body.cast_groups)
  ) return null;
  const badges: FootprintBadge[] = [];
  for (const row of body.badges) {
    const parsed = badge(row);
    if (!parsed || badges.some((item) => item.id === parsed.id)) return null;
    badges.push(parsed);
  }
  const castGroups: FootprintCastGroup[] = [];
  for (const row of body.cast_groups) {
    const group = record(row);
    const id = mongoId(group?.id);
    const labels = localizedLabels(group?.labels);
    const active = boolean(group?.active);
    if (!group || !id || !labels || active === null || castGroups.some((item) => item.id === id)) {
      return null;
    }
    castGroups.push({ id, labels, active });
  }
  const knownGroups = new Set(castGroups.map((group) => group.id));
  if (badges.some((item) => (
    item.senderGroupIds.some((id) => !knownGroups.has(id))
    || item.recipientGroupIds.some((id) => !knownGroups.has(id))
  ))) return null;
  return {
    settings: {
      dailyLimit,
      messageMaxLength,
      revision,
    },
    badges,
    castGroups,
    openReports,
  };
}

function reportUser(value: unknown): FootprintReportUser | null {
  const row = record(value);
  if (!row) return null;
  const id = integer(row.id, 1);
  if (id === null) return null;
  const displayName = record(row.displayname);
  const name = nonEmptyText(displayName?.value)
    ?? nonEmptyText(row.displayname)
    ?? nonEmptyText(row.username)
    ?? `#${id}`;
  const avatar = text(row.avatar);
  if (avatar === null) return null;
  return {
    id,
    name,
    avatar,
  };
}

/** Code points, the unit Core bounds text in (`mb_strlen`). */
export function codePointLength(value: string): number {
  return [...value].length;
}

/** A nullable bounded text; `undefined` refuses the row. Core sends `null`, never `""`. */
function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value === "" || codePointLength(value) > maximum) return undefined;
  return value;
}

/** A nullable positive epoch second; `undefined` refuses the row. */
function optionalTimestamp(value: unknown): number | null | undefined {
  if (value === null) return null;
  return integer(value, 1) ?? undefined;
}

/** A stored uid; Core casts a missing one to 0, which the console reads as unknown. */
function storedUid(value: unknown): number | null | undefined {
  const parsed = integer(value, 0);
  if (parsed === null) return undefined;
  return parsed === 0 ? null : parsed;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : null;
}

/** Core's page cursor, `FootprintReportPolicy::queueCursor()`: `created_at:id`. */
const REPORT_CURSOR = /^\d{1,12}:[0-9a-f]{24}$/;

export function isFootprintReportCursor(value: unknown): value is string {
  return typeof value === "string" && REPORT_CURSOR.test(value);
}

const EXTENDED_REPORT_KEYS = [
  "reporter_uid",
  "sender_uid",
  "reason",
  "note",
  "footprint_created_at",
  "resolution",
  "resolution_note",
  "resolved_at",
  "footprint_state",
  "sender_report_count",
] as const;

function footprintReportRow(raw: unknown, expectedStatus: FootprintReportStatus): FootprintReport | null {
  const row = record(raw);
  const id = mongoId(row?.id);
  const footprintId = mongoId(row?.footprint_id);
  const message = text(row?.message);
  const createdAt = integer(row?.created_at, 1);
  const status = text(row?.status);
  const resolvedBy = text(row?.resolved_by);
  if (
    !row || !id || !footprintId || message === null || createdAt === null
    || status !== expectedStatus || resolvedBy === null
  ) return null;
  const reporter = row.reporter === null ? null : reportUser(row.reporter);
  const sender = row.sender === null ? null : reportUser(row.sender);
  if ((row.reporter !== null && !reporter) || (row.sender !== null && !sender)) return null;
  const badgeRow = record(row.badge);
  const labels = badgeRow ? localizedLabels(badgeRow.labels) : null;
  // Core's adminBadgeWire answers `""` for a badge stored without artwork. That is a
  // row without a picture, not a malformed queue: only a non-string refuses it.
  const badgeImage = badgeRow ? text(badgeRow.image_url) : null;
  if (row.badge !== null && (!badgeRow || !labels || badgeImage === null)) return null;

  const base = {
    id,
    footprintId,
    reporter,
    sender,
    badgeLabel: labels?.en ?? "",
    badgeImage: badgeImage ?? "",
    message,
    createdAt,
    status: expectedStatus,
    resolvedBy,
  };

  // A Core without P-066 sends none of the additive keys; a Core with it sends
  // all of them. Anything in between is refused rather than half-trusted.
  const present = EXTENDED_REPORT_KEYS.filter((key) => Object.hasOwn(row, key));
  if (present.length === 0) {
    return {
      ...base,
      extended: false,
      reporterUid: null,
      senderUid: null,
      reason: null,
      note: null,
      footprintCreatedAt: null,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      footprintState: null,
      senderReportCount: null,
    };
  }
  if (present.length !== EXTENDED_REPORT_KEYS.length) return null;

  const reporterUid = storedUid(row.reporter_uid);
  const senderUid = storedUid(row.sender_uid);
  const reason = oneOf(FOOTPRINT_REPORT_REASONS, row.reason);
  const note = optionalText(row.note, FOOTPRINT_REPORT_NOTE_MAX);
  const footprintCreatedAt = optionalTimestamp(row.footprint_created_at);
  const resolution = row.resolution === null ? null : oneOf(FOOTPRINT_REPORT_RESOLUTIONS, row.resolution) ?? undefined;
  const resolutionNote = optionalText(row.resolution_note, FOOTPRINT_RESOLUTION_NOTE_MAX);
  const resolvedAt = optionalTimestamp(row.resolved_at);
  const stateRow = record(row.footprint_state);
  const exists = boolean(stateRow?.exists);
  const hidden = boolean(stateRow?.hidden);
  const messageRemoved = boolean(stateRow?.message_removed);
  const senderReportCount = integer(row.sender_report_count, 0);
  if (
    reporterUid === undefined || senderUid === undefined || reason === null
    || note === undefined || footprintCreatedAt === undefined
    || resolution === undefined || resolutionNote === undefined || resolvedAt === undefined
    || !stateRow || Object.keys(stateRow).length !== 3
    || exists === null || hidden === null || messageRemoved === null
    || senderReportCount === null
  ) return null;
  // Core builds cards only for positive uids, and a card describes the member the row names.
  if (reporter && reporter.id !== reporterUid) return null;
  if (sender && sender.id !== senderUid) return null;
  // Core reads a missing footprint as all-false; a hidden or cleared one exists.
  if (!exists && (hidden || messageRemoved)) return null;
  // An open report has no outcome. A resolved one always names its kind: Core
  // reads one closed before resolutions existed as `dismissed`.
  if (expectedStatus === "open" && (resolution !== null || resolutionNote !== null || resolvedAt !== null)) {
    return null;
  }
  if (expectedStatus === "resolved" && resolution === null) return null;

  return {
    ...base,
    extended: true,
    reporterUid,
    senderUid,
    reason,
    note,
    footprintCreatedAt,
    resolution,
    resolutionNote,
    resolvedAt,
    footprintState: { exists, hidden, messageRemoved },
    senderReportCount,
  };
}

/**
 * One page of `footprint_reports`. The response is bound to the requested tab
 * (`report_status`, because the shared envelope owns `status`), every row must
 * parse and ids may not repeat: one bad row refuses the page, so a read error
 * never looks like a shorter queue. An empty badge picture is not a bad row.
 *
 * `has_more` / `next_cursor` are both absent on a Core older than P-066 (one
 * bounded page); otherwise both are present, and a continuation needs Core's
 * cursor. `limit` is the page size the console asked for, when it asked.
 */
export function footprintReportPage(
  value: unknown,
  expectedStatus: FootprintReportStatus,
  limit: number | null = null,
): FootprintReportPage | null {
  const body = record(value);
  if (!body || body.report_status !== expectedStatus || !Array.isArray(body.reports)) return null;
  const reports: FootprintReport[] = [];
  const ids = new Set<string>();
  for (const raw of body.reports) {
    const parsed = footprintReportRow(raw, expectedStatus);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    reports.push(parsed);
  }
  const hasMoreKey = Object.hasOwn(body, "has_more");
  const cursorKey = Object.hasOwn(body, "next_cursor");
  if (!hasMoreKey && !cursorKey) return { reports, hasMore: false, nextCursor: null };
  if (!hasMoreKey || !cursorKey || typeof body.has_more !== "boolean") return null;
  if (limit !== null && reports.length > limit) return null;
  if (!body.has_more) return body.next_cursor === null ? { reports, hasMore: false, nextCursor: null } : null;
  // Core names the last row of a full page.
  if (!isFootprintReportCursor(body.next_cursor) || reports.length === 0) return null;
  if (limit !== null && reports.length !== limit) return null;
  const last = reports[reports.length - 1]!;
  if (body.next_cursor !== `${last.createdAt}:${last.id}`) return null;
  return { reports, hasMore: true, nextCursor: body.next_cursor };
}

/**
 * The `resolve_footprint_report` success. `resolved: true` is the proof of the
 * mutation; the resolved row is additive (a Core without P-066 sends none), and
 * an unreadable one is not trusted: both come back as `report: null`, and the
 * page reloads authoritative state instead.
 */
export function footprintReportResolveResult(
  value: unknown,
): { report: FootprintReport | null } | null {
  const body = record(value);
  if (!body || body.success !== true || body.resolved !== true) return null;
  if (!Object.hasOwn(body, "report")) return { report: null };
  return { report: footprintReportRow(body.report, "resolved") };
}

/**
 * The resolution note as Core stores it (`ModerationPolicy::normalizeReason`):
 * whitespace runs collapsed, trimmed. `null` when it is over the bound, which
 * the console refuses instead of letting Core cut it.
 */
export function normalizedFootprintResolutionNote(value: string): string | null {
  const note = value.replace(/\s+/gu, " ").trim();
  return codePointLength(note) <= FOOTPRINT_RESOLUTION_NOTE_MAX ? note : null;
}

/**
 * Remove message is offered only when Core has proved it understands the action
 * (the row carries the P-066 footprint state; an older Core would silently
 * dismiss), the report is open, and the footprint still has a message to clear.
 */
export function canRemoveFootprintMessage(
  report: Pick<FootprintReport, "status" | "footprintState" | "message">,
): boolean {
  return report.status === "open"
    && report.footprintState !== null
    && report.footprintState.exists
    && !report.footprintState.messageRemoved
    && report.message.trim() !== "";
}

export type FootprintStateKey = "missing" | "visible" | "hidden" | "messageRemoved";

/** The footprint's current state as label keys; empty when Core did not say. */
export function footprintStateKeys(report: Pick<FootprintReport, "footprintState">): FootprintStateKey[] {
  const state = report.footprintState;
  if (!state) return [];
  if (!state.exists) return ["missing"];
  const keys: FootprintStateKey[] = [state.hidden ? "hidden" : "visible"];
  if (state.messageRemoved) keys.push("messageRemoved");
  return keys;
}

/** The member a report row links to: the raw uid, or the card's when Core sent no uid. */
export function footprintReportMemberUid(
  report: FootprintReport,
  side: "reporter" | "sender",
): number | null {
  return side === "reporter"
    ? report.reporterUid ?? report.reporter?.id ?? null
    : report.senderUid ?? report.sender?.id ?? null;
}

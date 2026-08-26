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

export type FootprintReport = {
  id: string;
  footprintId: string;
  reporter: FootprintReportUser | null;
  sender: FootprintReportUser | null;
  badgeLabel: string;
  badgeImage: string;
  message: string;
  createdAt: number;
  status: string;
  resolvedBy: string;
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
  const imageUrl = nonEmptyText(row.image_url);
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
    !id || !labels || !imageUrl
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

export function footprintReports(
  value: unknown,
  expectedStatus: "open" | "resolved",
): FootprintReport[] | null {
  const body = record(value);
  if (!body || body.report_status !== expectedStatus || !Array.isArray(body.reports)) return null;
  const reports: FootprintReport[] = [];
  for (const raw of body.reports) {
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
    const badgeImage = badgeRow ? nonEmptyText(badgeRow.image_url) : null;
    if (row.badge !== null && (!badgeRow || !labels || !badgeImage)) return null;
    reports.push({
      id,
      footprintId,
      reporter,
      sender,
      badgeLabel: labels?.en ?? "",
      badgeImage: badgeImage ?? "",
      message,
      createdAt,
      status,
      resolvedBy,
    });
  }
  return reports;
}

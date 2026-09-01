export type DatesAdminPrincipal = {
  email: string;
  role: "support_viewer" | "moderator" | "senior_moderator" | "administrator" | "superadmin";
  rank: number;
  linked_uid: number | null;
  sensitive_location: boolean;
  break_glass: boolean;
  capabilities: string[];
};

export type DatesCaseSummary = {
  case_id: string;
  queue: string;
  case_kind: string;
  target_type: string;
  target_id: string;
  target_uid: number;
  activity_id: string | null;
  status: string;
  severity: string;
  escalated: boolean;
  distinct_reporter_count: number;
  report_count: number;
  assignee_email: string | null;
  claimed_at: number | null;
  claim_expires_at: number | null;
  sla_due_at: number;
  sla_breached: boolean;
  revision: number;
  created_at: number;
  updated_at: number;
  conflict_of_interest: boolean;
  capabilities: {
    can_claim: boolean;
    can_read_evidence: boolean;
    can_resolve: boolean;
    can_break_glass: boolean;
  };
};

export type DatesModerationSla = {
  open_count: number;
  unassigned_count: number;
  sla_breach_count: number;
  oldest_unassigned_at: number | null;
  age_buckets: Record<string, number>;
  median_seconds_to_claim: number | null;
  median_seconds_to_resolve: number | null;
  appeals_waiting: number;
};

const ROLES = new Set([
  "support_viewer",
  "moderator",
  "senior_moderator",
  "administrator",
  "superadmin",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeDatesPrincipal(value: unknown): DatesAdminPrincipal | null {
  const row = record(value);
  if (!row) return null;
  const role = typeof row.role === "string" ? row.role : "";
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const rank = row.rank;
  const linkedUid = row.linked_uid;
  const capabilities = row.capabilities;
  if (
    !ROLES.has(role)
    || !email.includes("@")
    || !Number.isInteger(rank)
    || Number(rank) < 0
    || (linkedUid !== null && (!Number.isInteger(linkedUid) || Number(linkedUid) <= 0))
    || typeof row.sensitive_location !== "boolean"
    || typeof row.break_glass !== "boolean"
    || !Array.isArray(capabilities)
    || capabilities.some((item) => typeof item !== "string")
  ) return null;
  return {
    email,
    role: role as DatesAdminPrincipal["role"],
    rank: Number(rank),
    linked_uid: linkedUid === null ? null : Number(linkedUid),
    sensitive_location: row.sensitive_location,
    break_glass: row.break_glass,
    capabilities: capabilities as string[],
  };
}

export function datesAdminPrincipal(value: unknown): DatesAdminPrincipal | null {
  const response = record(value);
  return response?.success === true ? normalizeDatesPrincipal(response.dates) : null;
}

export function hasDatesCapability(
  principal: DatesAdminPrincipal,
  capability: string,
): boolean {
  return principal.capabilities.includes(capability);
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function optionalNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = nonNegativeInteger(value);
  return parsed === null ? undefined : parsed;
}

function optionalPositiveInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function datesModerationSla(value: unknown): DatesModerationSla | null {
  const source = record(value);
  if (!source || source.success !== true) return null;

  const openCount = nonNegativeInteger(source.open_count);
  const unassignedCount = nonNegativeInteger(source.unassigned_count);
  const breachCount = nonNegativeInteger(source.sla_breach_count);
  const oldest = optionalPositiveInteger(source.oldest_unassigned_at);
  const medianClaim = optionalNonNegativeInteger(source.median_seconds_to_claim);
  const medianResolve = optionalNonNegativeInteger(source.median_seconds_to_resolve);
  const appealsWaiting = nonNegativeInteger(source.appeals_waiting);
  const ageBuckets = record(source.age_buckets);
  const ageBucketKeys = ["under_1h", "1h_to_6h", "6h_to_24h", "over_24h"];
  const ageBucketCounts = ageBuckets
    ? ageBucketKeys.map((key) => nonNegativeInteger(ageBuckets[key]))
    : [];
  if (
    openCount === null
    || unassignedCount === null
    || breachCount === null
    || oldest === undefined
    || medianClaim === undefined
    || medianResolve === undefined
    || appealsWaiting === null
    || !ageBuckets
    || Object.keys(ageBuckets).length !== ageBucketKeys.length
    || ageBucketKeys.some((key) => !Object.hasOwn(ageBuckets, key))
    || ageBucketCounts.some((count) => count === null)
    || ageBucketCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0) !== openCount
    || unassignedCount > openCount
    || breachCount > openCount
    || appealsWaiting > openCount
    || (unassignedCount === 0) !== (oldest === null)
  ) return null;

  return {
    open_count: openCount,
    unassigned_count: unassignedCount,
    sla_breach_count: breachCount,
    oldest_unassigned_at: oldest,
    age_buckets: ageBuckets as Record<string, number>,
    median_seconds_to_claim: medianClaim,
    median_seconds_to_resolve: medianResolve,
    appeals_waiting: appealsWaiting,
  };
}

export function createAdminIdempotencyKey(prefix: string): string {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").slice(0, 35) || "dates-admin";
  return `${safePrefix}:${crypto.randomUUID()}`;
}

export function epochFromLocalInput(value: string): number | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

export function localInputFromEpoch(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "";
  const date = new Date(value * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function parseEntryPoints(value: string): string[] {
  return Array.from(new Set(
    value.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-z][a-z0-9_]{1,63}$/.test(item)),
  ));
}

export function configurationInputValue(type: string, raw: string): unknown {
  if (type === "boolean") return raw === "true";
  if (type === "integer") return Number.parseInt(raw, 10);
  if (type === "nullable_integer") return raw.trim() === "" ? null : Number.parseInt(raw, 10);
  if (type === "quiet_hours") {
    const [start = "", end = ""] = raw.split("|");
    return { start, end };
  }
  return raw;
}

/** `dates_enabled` has one home: the shared section-availability control. */
export function datesRuntimeSettingVisible(key: unknown): boolean {
  return typeof key === "string" && key !== "dates_enabled";
}

/** Refuse the retired second writer while preserving this shared action for every other Dates row. */
export function datesAvailabilityWriteIsRetired(action: string, value: unknown): boolean {
  return action === "dates_configuration_save" && record(value)?.key === "dates_enabled";
}

export function resolutionActions(value: Pick<DatesCaseSummary, "queue" | "case_kind" | "target_type">): string[] {
  if (value.queue === "appeals" || value.case_kind === "appeal") return ["uphold", "overturn"];
  if (value.case_kind === "prepublication") {
    return ["approve_content", "reject_content"];
  }
  if (value.target_type === "activity") {
    return ["dismiss", "restore_content", "remove_content", "remove_photo", "cancel_activity", "remove_activity", "warn", "restrict_dates", "suspend_account"];
  }
  if (value.target_type === "review") {
    return ["dismiss", "restore_content", "remove_content", "remove_review", "warn", "restrict_dates", "suspend_account"];
  }
  if (value.target_type === "message") {
    return ["dismiss", "restore_content", "remove_content", "warn", "restrict_dates", "suspend_account"];
  }
  return ["dismiss", "warn", "restrict_dates", "suspend_account", "remove_participant"];
}

export function humanizeMachineKey(value: string): string {
  return value.replace(/^dates_/, "").replaceAll("_", " ");
}

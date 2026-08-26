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
  const role = String(row?.role ?? "");
  const email = String(row?.email ?? "").trim().toLowerCase();
  if (!row || !ROLES.has(role) || !email.includes("@")) return null;
  return {
    email,
    role: role as DatesAdminPrincipal["role"],
    rank: Number(row.rank) || 0,
    linked_uid: Number(row.linked_uid) > 0 ? Number(row.linked_uid) : null,
    sensitive_location: row.sensitive_location === true,
    break_glass: row.break_glass === true,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function hasDatesCapability(
  principal: DatesAdminPrincipal | null,
  capability: string,
): boolean {
  return principal?.capabilities.includes(capability) ?? false;
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

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

export type DatesCaseInternalNote = {
  note_id: string;
  author_email: string;
  text: string;
  created_at: number;
};

/**
 * The internal notes of a case detail (AYI-044 / AYI-075). Core returns
 * `internal_notes` (oldest first, the newest DATES_CASE_NOTE_LIMIT) and
 * `internal_notes_withheld`, which is true with an empty list when the
 * principal has a conflict of interest on the case.
 * - "unsupported": neither key, i.e. a Core from before notes were returned.
 *   The page says the notes cannot be shown; it never implies there are none.
 * - "withheld": the conflict-of-interest answer.
 * - "ready": the decoded notes, oldest first.
 * - "invalid": anything else. It is never rendered as an empty list.
 */
export type DatesCaseInternalNotes =
  | { status: "unsupported" }
  | { status: "withheld" }
  | { status: "ready"; notes: DatesCaseInternalNote[] }
  | { status: "invalid" };

/** Core's cap on returned notes (DatesModerationReadService::INTERNAL_NOTE_LIMIT). */
export const DATES_CASE_NOTE_LIMIT = 200;
/** Core's bound on a note, in characters (DatesModerationReadService::reason). */
const DATES_CASE_NOTE_TEXT_LIMIT = 1000;
const DATES_CASE_NOTE_KEYS = ["note_id", "author_email", "text", "created_at"];
/** The largest epoch second a Date can hold; beyond it rendering the time throws. */
const MAX_EPOCH_SECONDS = 8_640_000_000_000;

function datesCaseInternalNote(value: unknown): DatesCaseInternalNote | null {
  const row = record(value);
  if (
    !row
    || Object.keys(row).length !== DATES_CASE_NOTE_KEYS.length
    || DATES_CASE_NOTE_KEYS.some((key) => !Object.hasOwn(row, key))
  ) return null;
  const { note_id: noteId, author_email: authorEmail, text, created_at: createdAt } = row;
  if (
    typeof noteId !== "string"
    || !/^nt_[a-f0-9]{32}$/.test(noteId)
    || typeof authorEmail !== "string"
    || !authorEmail.includes("@")
    || authorEmail.length > 320
    || typeof text !== "string"
    // Core stores the note after PHP trim(), which strips only ASCII space,
    // \t, \n, \r, \0 and \x0B. JS trim() also strips NBSP and the Unicode
    // spaces, so a note Core accepted (for example a lone NBSP) would turn the
    // whole list invalid. Only the empty string is outside Core's contract.
    || text === ""
    || Array.from(text).length > DATES_CASE_NOTE_TEXT_LIMIT
    || !Number.isInteger(createdAt)
    || Number(createdAt) <= 0
    || Number(createdAt) > MAX_EPOCH_SECONDS
  ) return null;
  return { note_id: noteId, author_email: authorEmail, text, created_at: Number(createdAt) };
}

export function datesCaseInternalNotes(value: unknown): DatesCaseInternalNotes {
  const response = record(value);
  if (!response) return { status: "invalid" };
  const hasNotes = Object.hasOwn(response, "internal_notes");
  const hasWithheld = Object.hasOwn(response, "internal_notes_withheld");
  if (!hasNotes && !hasWithheld) return { status: "unsupported" };
  const notes = response.internal_notes;
  const withheld = response.internal_notes_withheld;
  if (!Array.isArray(notes) || typeof withheld !== "boolean") return { status: "invalid" };
  if (withheld) return notes.length === 0 ? { status: "withheld" } : { status: "invalid" };
  if (notes.length > DATES_CASE_NOTE_LIMIT) return { status: "invalid" };
  const decoded: DatesCaseInternalNote[] = [];
  const ids = new Set<string>();
  for (const item of notes) {
    const note = datesCaseInternalNote(item);
    if (!note || ids.has(note.note_id)) return { status: "invalid" };
    ids.add(note.note_id);
    decoded.push(note);
  }
  // Core already sends them oldest first; the sort is stable, so notes written
  // in the same second keep Core's order.
  decoded.sort((left, right) => left.created_at - right.created_at);
  return { status: "ready", notes: decoded };
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

/** Frozen Core vocabulary, including the readable legacy key. */
export const DATES_ACTIVITY_TYPES = ["sport", "date", "travel", "hangout"] as const;
export type DatesActivityTypeAvailability = { key: string; active: boolean };

export function datesActivityTypeRetired(key: string): boolean {
  return key === "date";
}

/** Both old and P0 Core return the frozen four-key catalogue. Never infer availability. */
export function datesActivityTypeAvailability(value: unknown): DatesActivityTypeAvailability[] | null {
  const response = record(value);
  if (response?.success !== true || !Array.isArray(response.activity_types)
    || response.activity_types.length !== DATES_ACTIVITY_TYPES.length) return null;
  const result: DatesActivityTypeAvailability[] = [];
  const seen = new Set<string>();
  for (const value of response.activity_types) {
    const row = record(value);
    if (!row || typeof row.key !== "string" || typeof row.active !== "boolean"
      || !DATES_ACTIVITY_TYPES.some((key) => key === row.key) || seen.has(row.key)) return null;
    seen.add(row.key);
    result.push({ key: row.key, active: row.active && !datesActivityTypeRetired(row.key) });
  }
  return result;
}

/** Existing inactive types may be retained, but never newly assigned (AYI-077). */
export function datesActivityTypeChoices(
  catalogue: DatesActivityTypeAvailability[] | null,
  existingType?: string,
): string[] {
  return DATES_ACTIVITY_TYPES.filter((key) => key === existingType
    || (!datesActivityTypeRetired(key) && catalogue?.some((row) => row.key === key && row.active)));
}

/** The activity edit form, as the console holds it before building Core's change set. */
export type DatesActivityEditDraft = {
  title: string;
  details: string;
  activityType: string;
  locationMode: string;
  city: string;
  countryCode: string;
  timeMode: string;
  startAt: string;
  endAt: string;
  timezone: string;
  joinMode: string;
  maximumPeople: string;
  audience: string;
  reason: string;
};

/**
 * The `changes` object for `dates_activity_update`.
 *
 * An approval-mode activity has no capacity. Core sets `maximum_people` to null
 * itself when the resulting join mode is approval, but it refuses an explicit
 * `maximum_people: null` with dates-admin-activity-value-invalid (AYI-013), so
 * the key is left out in approval mode instead of being sent as null. That is
 * accepted both by a Core that refuses the null and by one that tolerates it.
 */
export function datesActivityEditChanges(
  draft: DatesActivityEditDraft,
  audience: Record<string, unknown>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {
    title: draft.title.trim(),
    details: draft.details.trim() || null,
    activity_type: draft.activityType,
    location_mode: draft.locationMode,
    city: draft.city.trim() || null,
    country_code: draft.countryCode.trim().toUpperCase() || null,
    time_mode: draft.timeMode,
    timezone: draft.timezone.trim(),
    audience,
    join_mode: draft.joinMode,
  };
  if (draft.joinMode === "auto") {
    changes.maximum_people = Number.parseInt(draft.maximumPeople, 10);
  }
  if (draft.timeMode === "scheduled") {
    changes.start_at = epochFromLocalInput(draft.startAt);
    changes.end_at = epochFromLocalInput(draft.endAt);
  }
  return changes;
}

export const DATES_REPORT_SCOPES = ["user", "activity", "message", "review"] as const;

/**
 * Report entry points a reason can list, per reason scope (AYI-014).
 *
 * A reason is offered and accepted only where its entry_points contain the
 * entry point the report arrives with, so a value no client sends makes the
 * reason unreachable. Each list is the union of Core's seeded catalogue
 * (config/dates_v1_fixture.json) and what reaches Core today:
 * - iOS sends `detail` for the activity and for its host and participants,
 *   and `review` for reviews;
 * - Core's own report targets carry `check_in` (post-activity check-in),
 *   `direct_chat_header` (direct chat counterpart) and `message_action`
 *   (a chat message and its sender).
 * The seeded-only values (`card`, `profile`, `participant`, `chat_header`,
 * `message`) stay valid so a seeded reason can still be edited and saved.
 * Core validates a saved reason against the same per-scope lists
 * (DatesContract::REPORT_ENTRY_POINTS) and refuses an empty list or any other
 * value with dates-report-entry-points-invalid.
 */
export const DATES_REPORT_ENTRY_POINTS: Readonly<Record<typeof DATES_REPORT_SCOPES[number], readonly string[]>> = {
  user: ["detail", "participant", "profile", "check_in", "chat_header", "direct_chat_header", "message_action"],
  activity: ["detail", "card", "check_in"],
  message: ["message_action", "message"],
  review: ["review"],
};

export function datesReportEntryPointsFor(scope: string): readonly string[] {
  return Object.hasOwn(DATES_REPORT_ENTRY_POINTS, scope)
    ? DATES_REPORT_ENTRY_POINTS[scope as keyof typeof DATES_REPORT_ENTRY_POINTS]
    : [];
}

export type DatesReasonEntryPoints =
  | { ok: true; entryPoints: string[] }
  | { ok: false; error: "empty" }
  | { ok: false; error: "unknown"; tokens: string[] };

/**
 * Reads the comma-separated entry-point field of a report reason. Nothing is
 * dropped silently: an empty list and any token outside the scope's
 * vocabulary are refused and named, because Core stores both and the reason
 * then either matches no report or is refused on every submission.
 */
export function datesReasonEntryPoints(scope: string, value: string): DatesReasonEntryPoints {
  const allowed = datesReportEntryPointsFor(scope);
  const tokens = Array.from(new Set(
    value.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== ""),
  ));
  if (tokens.length === 0) return { ok: false, error: "empty" };
  const unknown = tokens.filter((item) => !allowed.includes(item));
  if (unknown.length > 0) return { ok: false, error: "unknown", tokens: unknown };
  return { ok: true, entryPoints: tokens };
}

/**
 * Whether a reason save was refused for its entry points. The editor shows
 * this under the entry-point field, like its own check, instead of as a raw
 * error code at the top of the page.
 */
export function datesReasonEntryPointsRefused(error: unknown): boolean {
  return error === "dates-report-entry-points-invalid";
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

/**
 * The "effective" text of a runtime setting row: always Core's effective_value,
 * never the unsaved draft (AYI-074). Quiet hours are an object on the wire;
 * a malformed one is shown as unknown rather than guessed.
 */
export function datesSettingEffectiveText(
  type: string,
  effective: unknown,
  booleans?: { on: string; off: string },
): string {
  if (type === "quiet_hours") {
    const row = record(effective);
    return row && typeof row.start === "string" && typeof row.end === "string"
      ? `${row.start}–${row.end}`
      : "—";
  }
  if (booleans && typeof effective === "boolean") return effective ? booleans.on : booleans.off;
  return String(effective ?? "null");
}

export type DatesStorefrontEffectiveRow = { storefront: string; effective: boolean };

/**
 * AYI-074: a setting row's `effective_value` is the GLOBAL answer (no
 * storefront), which is what members get where AreYouIn has no storefront
 * override. A Core that fixes AYI-074 also sends `effective_by_storefront` on
 * the rollout switches: what each switch resolves to in every storefront that
 * has its own AreYouIn availability.
 * - "unsupported": the key is absent (a Core from before it); only the global
 *   answer is known and the console says so.
 * - "notApplicable": null, a setting that does not depend on the storefront.
 * - "ready": the storefront rows, sorted; empty when no storefront overrides.
 * - "invalid": anything else. It is reported, never shown as "no overrides".
 */
export type DatesStorefrontEffective =
  | { status: "unsupported" }
  | { status: "notApplicable" }
  | { status: "ready"; rows: DatesStorefrontEffectiveRow[] }
  | { status: "invalid" };

export function datesSettingStorefrontEffective(setting: unknown): DatesStorefrontEffective {
  const row = record(setting);
  if (!row || !Object.hasOwn(row, "effective_by_storefront")) return { status: "unsupported" };
  const value = row.effective_by_storefront;
  if (value === null) return { status: "notApplicable" };
  if (!Array.isArray(value) || value.length > 512) return { status: "invalid" };
  const rows: DatesStorefrontEffectiveRow[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = record(item);
    if (
      !entry
      || Object.keys(entry).length !== 2
      || typeof entry.storefront !== "string"
      || !/^[A-Z]{3}$/.test(entry.storefront)
      || seen.has(entry.storefront)
      || typeof entry.effective_value !== "boolean"
    ) return { status: "invalid" };
    seen.add(entry.storefront);
    rows.push({ storefront: entry.storefront, effective: entry.effective_value });
  }
  rows.sort((left, right) => left.storefront.localeCompare(right.storefront));
  return { status: "ready", rows };
}

/** `dates_enabled` has one home: the shared section-availability control. */
export function datesRuntimeSettingVisible(key: unknown): boolean {
  return typeof key === "string" && key !== "dates_enabled";
}

/** Refuse the retired second writer while preserving this shared action for every other Dates row. */
export function datesAvailabilityWriteIsRetired(action: string, value: unknown): boolean {
  return action === "dates_configuration_save" && record(value)?.key === "dates_enabled";
}

export function isDatesAppealCase(value: Pick<DatesCaseSummary, "queue" | "case_kind">): boolean {
  return value.queue === "appeals" || value.case_kind === "appeal";
}

/** Every decision Core accepts for this kind of case, before role gates. */
export function resolutionActions(value: Pick<DatesCaseSummary, "queue" | "case_kind" | "target_type">): string[] {
  if (isDatesAppealCase(value)) return ["uphold", "overturn"];
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

const RESTRICTING_RESOLUTIONS = new Set(["restrict_dates", "suspend_account"]);

/**
 * The decisions this principal may take on the case (AYI-076). Core's
 * can_resolve only covers the claim, lease and conflict state, so the role
 * gates Core applies at resolve time are mirrored here:
 * - every resolution needs dates_case_resolve;
 * - an appeal needs dates_appeal_resolve (DatesModerationCommandService::resolve);
 * - restrict_dates and suspend_account need dates_restrict_user
 *   (DatesModerationCommandService::resolveStandard).
 * Core still enforces all three; this only stops offering what it refuses.
 */
export function permittedResolutionActions(
  value: Pick<DatesCaseSummary, "queue" | "case_kind" | "target_type">,
  principal: Pick<DatesAdminPrincipal, "capabilities">,
): string[] {
  if (!principal.capabilities.includes("dates_case_resolve")) return [];
  if (isDatesAppealCase(value)) {
    return principal.capabilities.includes("dates_appeal_resolve") ? resolutionActions(value) : [];
  }
  const restrict = principal.capabilities.includes("dates_restrict_user");
  return resolutionActions(value).filter((action) => restrict || !RESTRICTING_RESOLUTIONS.has(action));
}

/** An appeal needs dates_appeal_resolve; without it the principal cannot decide one. */
export function datesAppealBlockedByRole(
  value: Pick<DatesCaseSummary, "queue" | "case_kind">,
  principal: Pick<DatesAdminPrincipal, "capabilities">,
): boolean {
  return isDatesAppealCase(value) && !principal.capabilities.includes("dates_appeal_resolve");
}

/**
 * Whether the principal's role allows claiming this case. Core's can_claim
 * reflects only case state (open, unclaimed or expired, no conflict); the
 * claim command itself needs dates_case_claim, and claiming an appeal the
 * principal cannot decide would only hold the lease against those who can.
 */
export function datesCaseClaimableByRole(
  value: Pick<DatesCaseSummary, "queue" | "case_kind">,
  principal: Pick<DatesAdminPrincipal, "capabilities">,
): boolean {
  return principal.capabilities.includes("dates_case_claim") && !datesAppealBlockedByRole(value, principal);
}

export function humanizeMachineKey(value: string): string {
  return value.replace(/^dates_/, "").replaceAll("_", " ");
}

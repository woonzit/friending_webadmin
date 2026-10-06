/** T-896: counts-only event research wire. Extra keys are ignored; lists fail per row. */
export const DATES_RESEARCH_ACTIONS = [
  "dates_event_research_overview", "dates_event_research_defaults_save", "dates_event_research_area_save",
  "dates_event_research_source_save", "dates_event_research_source_run_now",
  "dates_event_research_area_run_now", "dates_event_research_discovery_resume",
  "dates_event_research_run_list", "dates_event_research_run_detail", "dates_event_intake_batch_decide",
] as const;
export type DatesResearchAction = typeof DATES_RESEARCH_ACTIONS[number];
export const DATES_RESEARCH_MODES = ["auto", "on", "off"] as const;
export const DATES_RESEARCH_SCOPE_KINDS = ["city", "radius"] as const;
export const DATES_RESEARCH_SOURCE_TYPES = ["official", "aggregator"] as const;
export const DATES_RESEARCH_NOT_RUNNING_REASONS = ["research_off", "mode_off", "auto_cities_off", "below_threshold", "section_unavailable", "budget_paused", "discovery_bound_exceeded"] as const;
export const DATES_RESEARCH_ROBOTS_STATES = ["unknown", "allowed", "disallowed", "unreachable"] as const;
export const DATES_RESEARCH_RUN_KINDS = ["source", "area"] as const;
export const DATES_RESEARCH_RUN_TRIGGERS = ["schedule", "manual"] as const;
export const DATES_RESEARCH_RUN_STATUSES = ["queued", "running", "completed", "unchanged", "skipped_target_met", "blocked_by_robots", "fetch_failed", "budget_paused", "failed", "provider_unavailable"] as const;
export const DATES_RESEARCH_CANDIDATE_OUTCOMES = ["imported", "would_import", "duplicate", "dropped"] as const;
export const DATES_RESEARCH_DROP_REASONS = ["past_date", "outside_window", "outside_area", "known_url", "no_event_page", "fetch_failed", "validation_failed", "over_cap", "robots_disallowed", "blocked_domain"] as const;
export const DATES_RESEARCH_DOMAIN_TYPES = ["official", "aggregator", "blocked"] as const;
export const DATES_RESEARCH_PAUSE_REASONS = ["reservation_exceeded", "tool_bound_exceeded"] as const;
export const DATES_RESEARCH_BATCH_OUTCOMES = ["published", "rejected", "refused"] as const;
export const DATES_RESEARCH_VALUE_FIELDS = ["cadence_hours", "scope", "member_threshold", "target_events", "window_days", "autopublish"] as const;
export const DATES_RESEARCH_LIMIT_FIELDS = ["cadence_hours", "radius_km", "member_threshold", "target_events", "window_days", "max_events"] as const;

export type ResearchMode = typeof DATES_RESEARCH_MODES[number];
export type ResearchSourceType = typeof DATES_RESEARCH_SOURCE_TYPES[number];
export type ResearchRunStatus = typeof DATES_RESEARCH_RUN_STATUSES[number];
export type ResearchDropReason = typeof DATES_RESEARCH_DROP_REASONS[number];
export type ResearchScope = { kind: "city"; radius_km: null } | { kind: "radius"; radius_km: number };
export type ResearchValues = { cadence_hours: number; scope: ResearchScope; member_threshold: number; target_events: number; window_days: number; autopublish: boolean };
export type ResearchOverrides = { [K in keyof ResearchValues]: ResearchValues[K] | null };
export type ResearchModels = Record<"openai" | "gemini", string>;
export type ResearchModelOptions = Record<"openai" | "gemini", string[]>;
export type ResearchDomain = { domain: string; type: typeof DATES_RESEARCH_DOMAIN_TYPES[number] };
export type ResearchDefaults = ResearchValues & { enabled: boolean; auto_cities_enabled: boolean; revision: number; updated_at: number | null; updated_by: string | null;
  research_models?: ResearchModels | null; domains?: ResearchRows<ResearchDomain> | null };
export type ResearchLimits = { [K in typeof DATES_RESEARCH_LIMIT_FIELDS[number]]: { min: number; max: number } } & {
  batch_intakes?: { min: number; max: number }; domains?: { min: number; max: number } | null;
};
export type ResearchCenter = { latitude: number; longitude: number };
export type ResearchBounds = { southwest: ResearchCenter; northeast: ResearchCenter };
export type ResearchLastRun = { run_id: string; status: ResearchRunStatus; finished_at: number | null; found: number; imported: number };
export type ResearchArea = {
  area_id: string; revision: number; label: string; place_id: string; country_code: string; center: ResearchCenter; bounds: ResearchBounds | null;
  mode: ResearchMode; proposed: boolean; overrides: ResearchOverrides; effective: ResearchValues;
  member_count: number; member_count_at: number | null; running: boolean; not_running_reason: typeof DATES_RESEARCH_NOT_RUNNING_REASONS[number] | null;
  stock: { upcoming: number; target: number; missing: number }; last_run: ResearchLastRun | null; next_run_at: number | null; month_cost_micro_usd: number;
};
export type ResearchSource = {
  source_id: string; revision: number; url: string; registrable_domain: string; label: string; type: ResearchSourceType; area_id: string | null;
  cadence_hours: number; max_events: number; window_days: number | null; autopublish: boolean | null; enabled: boolean; archived: boolean;
  effective: { window_days: number; autopublish: boolean }; robots: { state: typeof DATES_RESEARCH_ROBOTS_STATES[number]; checked_at: number | null };
  stock: { upcoming: number; max: number; missing: number }; last_check: ResearchLastRun | null; next_check_at: number | null; month_cost_micro_usd: number;
};
export type ResearchBudget = { month: string; cap_micro_usd: number; spent_micro_usd: number; reserved_micro_usd: number; research_spent_micro_usd: number; research_stop_at_micro_usd: number; research_paused: boolean };
export type ResearchEstimateComponent = { monthly_checks: number; monthly_cost_micro_usd: number | null; basis: "unmeasured" | "last_completed_run"; last_run_id: string | null; last_run_cost_micro_usd: number | null };
export type ResearchEstimate = { monthly_checks: number; monthly_cost_micro_usd: number | null; basis: string; area?: ResearchEstimateComponent | null; source?: ResearchEstimateComponent | null };
export type ResearchDiscoveryAdmission = { openai_admitted: boolean; openai_reason: null; gemini_admitted: false; gemini_reason: "unbounded_search_queries";
  pause: { reason: typeof DATES_RESEARCH_PAUSE_REASONS[number]; run_id: string; at: number } | null };
export type ResearchToolUsage = { requested_cap: number; echoed_cap: number | null; tool_items: number; action_counts: Record<"search" | "open_page" | "find_in_page" | "unknown", number> };
export type ResearchUnreadable = { index: number; id: string | null };
export type ResearchRows<T> = { rows: T[]; unreadable: ResearchUnreadable[] };
export type ResearchOverview = {
  defaults: ResearchDefaults | null; areas: ResearchRows<ResearchArea>; sources: ResearchRows<ResearchSource>;
  budget: ResearchBudget; estimate: ResearchEstimate; limits: ResearchLimits; server_now: number;
  research_model_options?: ResearchModelOptions | null; discovery_admission?: ResearchDiscoveryAdmission | null;
};
export type ResearchRun = {
  run_id: string; kind: typeof DATES_RESEARCH_RUN_KINDS[number]; dry_run: boolean; trigger: typeof DATES_RESEARCH_RUN_TRIGGERS[number];
  source_id: string | null; area_id: string | null; status: ResearchRunStatus; found: number; imported: number; duplicates: number;
  dropped: { reason: ResearchDropReason; count: number }[]; cost_micro_usd: number; started_at: number | null; finished_at: number | null;
  source_revision_before?: number | null; source_revision_after?: number | null; area_revision_before?: number | null; area_revision_after?: number | null;
  discovery_tool_usage?: ResearchToolUsage | null;
};
export type ResearchCandidate = { title: string; date_text: string; url_host: string; outcome: typeof DATES_RESEARCH_CANDIDATE_OUTCOMES[number]; reason: ResearchDropReason | null; intake_id: string | null };
export type ResearchRunList = ResearchRows<ResearchRun> & { next_cursor: string | null };
export type ResearchRunDetail = { run: ResearchRun; candidates: ResearchRows<ResearchCandidate> | null };
export type ResearchBatchResult = { intake_id: string; outcome: typeof DATES_RESEARCH_BATCH_OUTCOMES[number]; refusal: string | null; external_event_id: string | null };

export const researchRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const researchNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const researchInteger = (value: unknown, minimum = 0): value is number => researchNumber(value) && Number.isSafeInteger(value) && value >= minimum;
export const researchString = (value: unknown): value is string => typeof value === "string";
export const researchId = (value: unknown): value is string => researchString(value) && value !== "";
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const nullable = <T>(value: unknown, test: (value: unknown) => value is T): value is T | null => value === null || test(value);
export const researchOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => researchString(value) && options.includes(value as T);
const clock = (value: unknown): value is number => researchInteger(value);
const fieldNumbers = (value: Record<string, unknown>, fields: string[]) => fields.every((key) => researchInteger(value[key]));
const positiveValues = (value: Record<string, unknown>, fields: string[]) => fields.every((key) => researchNumber(value[key]) && (value[key] as number) > 0);

export function researchSuccess(value: unknown): value is Record<string, unknown> {
  return researchRecord(value) && value.success === true && value.status_code === 200
    && (!Object.hasOwn(value, "message") || value.message === 200)
    && (!Object.hasOwn(value, "status") || value.status === 200)
    && (!Object.hasOwn(value, "can_send") || value.can_send === 0);
}

export function decodeResearchScope(value: unknown): ResearchScope | null {
  if (!researchRecord(value)) return null;
  if (value.kind === "city" && (value.radius_km === null || value.radius_km === undefined)) return { kind: "city", radius_km: null };
  return value.kind === "radius" && researchNumber(value.radius_km) && value.radius_km > 0 ? { kind: "radius", radius_km: value.radius_km } : null;
}

export function decodeResearchValues(value: unknown): ResearchValues | null {
  if (!researchRecord(value) || !positiveValues(value, ["cadence_hours", "member_threshold", "target_events", "window_days"]) || !boolean(value.autopublish)) return null;
  const scope = decodeResearchScope(value.scope);
  return scope ? { cadence_hours: value.cadence_hours as number, member_threshold: value.member_threshold as number, target_events: value.target_events as number,
    window_days: value.window_days as number, autopublish: value.autopublish, scope } : null;
}

export function decodeResearchOverrides(value: unknown): ResearchOverrides | null {
  if (!researchRecord(value) || DATES_RESEARCH_VALUE_FIELDS.some((key) => !Object.hasOwn(value, key))) return null;
  const result: ResearchOverrides = { cadence_hours: null, scope: null, member_threshold: null, target_events: null, window_days: null, autopublish: null };
  for (const key of ["cadence_hours", "member_threshold", "target_events", "window_days"] as const) {
    if (value[key] === null) continue;
    if (!researchNumber(value[key]) || value[key] <= 0) return null;
    result[key] = value[key];
  }
  if (!nullable(value.autopublish, boolean)) return null;
  result.autopublish = value.autopublish;
  if (value.scope !== null) { result.scope = decodeResearchScope(value.scope); if (!result.scope) return null; }
  return result;
}

export function decodeResearchDefaults(value: unknown): ResearchDefaults | null {
  const values = decodeResearchValues(value);
  if (!values || !researchRecord(value) || !boolean(value.enabled) || !boolean(value.auto_cities_enabled) || !researchInteger(value.revision)
    || !nullable(value.updated_at, clock) || !nullable(value.updated_by, researchString)) return null;
  return { ...values, enabled: value.enabled, auto_cities_enabled: value.auto_cities_enabled, revision: value.revision, updated_at: value.updated_at, updated_by: value.updated_by,
    ...(Object.hasOwn(value, "research_models") ? { research_models: decodeResearchModels(value.research_models) } : {}),
    ...(Object.hasOwn(value, "domains") ? { domains: rowList(value.domains, decodeResearchDomain, "domain") } : {}) };
}
export function decodeResearchModels(value: unknown): ResearchModels | null {
  return researchRecord(value) && researchId(value.openai) && researchId(value.gemini) ? { openai: value.openai, gemini: value.gemini } : null;
}
export function decodeResearchDomain(value: unknown): ResearchDomain | null {
  return researchRecord(value) && researchId(value.domain) && researchOneOf(value.type, DATES_RESEARCH_DOMAIN_TYPES) ? { domain: value.domain, type: value.type } : null;
}
function modelOptions(value: unknown): ResearchModelOptions | null {
  if (!researchRecord(value) || !["openai", "gemini"].every((key) => Array.isArray(value[key]) && (value[key] as unknown[]).every(researchId)
    && new Set(value[key] as string[]).size === (value[key] as string[]).length)) return null;
  return { openai: [...value.openai as string[]], gemini: [...value.gemini as string[]] };
}
function discoveryAdmission(value: unknown): ResearchDiscoveryAdmission | null {
  if (!researchRecord(value) || !boolean(value.openai_admitted) || value.openai_reason !== null || value.gemini_admitted !== false
    || value.gemini_reason !== "unbounded_search_queries") return null;
  let pause: ResearchDiscoveryAdmission["pause"] = null;
  if (value.pause !== null) {
    if (!researchRecord(value.pause) || !researchOneOf(value.pause.reason, DATES_RESEARCH_PAUSE_REASONS) || !researchId(value.pause.run_id) || !clock(value.pause.at)) return null;
    pause = { reason: value.pause.reason, run_id: value.pause.run_id, at: value.pause.at };
  }
  return { openai_admitted: value.openai_admitted, openai_reason: null, gemini_admitted: false, gemini_reason: "unbounded_search_queries", pause };
}
function estimateComponent(value: unknown): ResearchEstimateComponent | null {
  if (!researchRecord(value) || !researchNumber(value.monthly_checks) || !nullable(value.monthly_cost_micro_usd, researchNumber)
    || !researchOneOf(value.basis, ["unmeasured", "last_completed_run"] as const) || !nullable(value.last_run_id, researchId) || !nullable(value.last_run_cost_micro_usd, researchNumber)) return null;
  return { monthly_checks: value.monthly_checks, monthly_cost_micro_usd: value.monthly_cost_micro_usd, basis: value.basis, last_run_id: value.last_run_id, last_run_cost_micro_usd: value.last_run_cost_micro_usd };
}
function toolUsage(value: unknown): ResearchToolUsage | null {
  if (!researchRecord(value) || !fieldNumbers(value, ["requested_cap", "tool_items"]) || !nullable(value.echoed_cap, researchInteger)
    || !researchRecord(value.action_counts) || !fieldNumbers(value.action_counts, ["search", "open_page", "find_in_page", "unknown"])) return null;
  return { requested_cap: value.requested_cap as number, echoed_cap: value.echoed_cap, tool_items: value.tool_items as number,
    action_counts: { search: value.action_counts.search as number, open_page: value.action_counts.open_page as number, find_in_page: value.action_counts.find_in_page as number, unknown: value.action_counts.unknown as number } };
}

function lastRun(value: unknown): ResearchLastRun | null {
  if (!researchRecord(value) || !researchId(value.run_id) || !researchOneOf(value.status, DATES_RESEARCH_RUN_STATUSES)
    || !nullable(value.finished_at, clock) || !fieldNumbers(value, ["found", "imported"])) return null;
  return { run_id: value.run_id, status: value.status, finished_at: value.finished_at, found: value.found as number, imported: value.imported as number };
}
function bounds(value: unknown): ResearchBounds | null {
  if (!researchRecord(value) || !researchRecord(value.southwest) || !researchRecord(value.northeast)
    || !researchNumber(value.southwest.latitude) || !researchNumber(value.southwest.longitude) || !researchNumber(value.northeast.latitude) || !researchNumber(value.northeast.longitude)) return null;
  return { southwest: { latitude: value.southwest.latitude, longitude: value.southwest.longitude }, northeast: { latitude: value.northeast.latitude, longitude: value.northeast.longitude } };
}
export function decodeResearchArea(value: unknown): ResearchArea | null {
  if (!researchRecord(value) || !researchId(value.area_id) || !researchInteger(value.revision, 1) || !researchString(value.label) || !researchId(value.place_id)
    || !researchString(value.country_code) || !researchRecord(value.center) || !researchNumber(value.center.latitude) || !researchNumber(value.center.longitude)
    || !researchOneOf(value.mode, DATES_RESEARCH_MODES) || !boolean(value.proposed) || !fieldNumbers(value, ["member_count", "month_cost_micro_usd"])
    || !nullable(value.member_count_at, clock) || !nullable(value.next_run_at, clock) || !boolean(value.running)
    || !nullable(value.not_running_reason, (v): v is ResearchArea["not_running_reason"] & string => researchOneOf(v, DATES_RESEARCH_NOT_RUNNING_REASONS))
    || !researchRecord(value.stock) || !fieldNumbers(value.stock, ["upcoming", "target", "missing"])) return null;
  const effective = decodeResearchValues(value.effective), overrides = decodeResearchOverrides(value.overrides);
  const box = value.bounds === null ? null : bounds(value.bounds), last = value.last_run === null ? null : lastRun(value.last_run);
  if (!effective || !overrides || (value.bounds !== null && !box) || (value.last_run !== null && !last)) return null;
  return { area_id: value.area_id, revision: value.revision, label: value.label, place_id: value.place_id, country_code: value.country_code,
    center: { latitude: value.center.latitude, longitude: value.center.longitude }, bounds: box, mode: value.mode, proposed: value.proposed, effective, overrides,
    member_count: value.member_count as number, member_count_at: value.member_count_at, running: value.running, not_running_reason: value.not_running_reason,
    stock: { upcoming: value.stock.upcoming as number, target: value.stock.target as number, missing: value.stock.missing as number }, last_run: last,
    next_run_at: value.next_run_at, month_cost_micro_usd: value.month_cost_micro_usd as number };
}

export function decodeResearchSource(value: unknown): ResearchSource | null {
  if (!researchRecord(value) || !researchId(value.source_id) || !researchInteger(value.revision, 1) || !["url", "registrable_domain", "label"].every((key) => researchString(value[key]))
    || !researchOneOf(value.type, DATES_RESEARCH_SOURCE_TYPES) || !nullable(value.area_id, researchId) || !positiveValues(value, ["cadence_hours", "max_events"])
    || !nullable(value.window_days, researchNumber) || !nullable(value.autopublish, boolean) || !boolean(value.enabled)
    || (Object.hasOwn(value, "archived") && !boolean(value.archived)) || !researchRecord(value.effective) || !researchNumber(value.effective.window_days) || !boolean(value.effective.autopublish)
    || !researchRecord(value.robots) || !researchOneOf(value.robots.state, DATES_RESEARCH_ROBOTS_STATES) || !nullable(value.robots.checked_at, clock)
    || !researchRecord(value.stock) || !fieldNumbers(value.stock, ["upcoming", "max", "missing"]) || !nullable(value.next_check_at, clock) || !researchInteger(value.month_cost_micro_usd)) return null;
  const last = value.last_check === null ? null : lastRun(value.last_check);
  if (value.last_check !== null && !last) return null;
  return { source_id: value.source_id, revision: value.revision, url: value.url as string, registrable_domain: value.registrable_domain as string, label: value.label as string,
    type: value.type, area_id: value.area_id, cadence_hours: value.cadence_hours as number, max_events: value.max_events as number, window_days: value.window_days,
    autopublish: value.autopublish, enabled: value.enabled, archived: value.archived === true,
    effective: { window_days: value.effective.window_days, autopublish: value.effective.autopublish }, robots: { state: value.robots.state, checked_at: value.robots.checked_at },
    stock: { upcoming: value.stock.upcoming as number, max: value.stock.max as number, missing: value.stock.missing as number }, last_check: last,
    next_check_at: value.next_check_at, month_cost_micro_usd: value.month_cost_micro_usd };
}

function rowList<T>(value: unknown, decode: (value: unknown) => T | null, idKey: string): ResearchRows<T> | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((row) => idKey !== "" && researchRecord(row) && researchId(row[idKey]) ? row[idKey] as string : null);
  const rows: T[] = [], unreadable: ResearchUnreadable[] = [];
  value.forEach((raw, index) => {
    const id = ids[index], duplicate = id !== null && ids.indexOf(id) !== ids.lastIndexOf(id);
    const row = duplicate ? null : decode(raw);
    if (row) rows.push(row); else unreadable.push({ index, id });
  });
  return { rows, unreadable };
}
export function decodeResearchLimits(value: unknown): ResearchLimits | null {
  if (!researchRecord(value)) return null;
  const limits = {} as ResearchLimits;
  for (const key of DATES_RESEARCH_LIMIT_FIELDS) {
    const range = value[key];
    if (!researchRecord(range) || !researchNumber(range.min) || !researchNumber(range.max) || range.min > range.max) return null;
    limits[key] = { min: range.min, max: range.max };
  }
  if (Object.hasOwn(value, "batch_intakes")) {
    const range = value.batch_intakes;
    if (!researchRecord(range) || !researchInteger(range.min, 1) || !researchInteger(range.max, range.min)) return null;
    limits.batch_intakes = { min: range.min, max: range.max };
  }
  if (Object.hasOwn(value, "domains")) {
    const range = value.domains;
    // An unavailable additive limit disables only domain-policy writes, not the overview.
    limits.domains = researchRecord(range) && researchInteger(range.min) && researchInteger(range.max, range.min)
      ? { min: range.min, max: range.max } : null;
  }
  return limits;
}
export function decodeResearchOverview(value: unknown): ResearchOverview | null {
  if (!researchSuccess(value) || !clock(value.server_now) || !researchRecord(value.budget) || !researchString(value.budget.month)
    || !fieldNumbers(value.budget, ["cap_micro_usd", "spent_micro_usd", "reserved_micro_usd", "research_spent_micro_usd", "research_stop_at_micro_usd"]) || !boolean(value.budget.research_paused)
    || !researchRecord(value.estimate) || !researchNumber(value.estimate.monthly_checks) || !nullable(value.estimate.monthly_cost_micro_usd, researchNumber)
    || !researchString(value.estimate.basis)) return null;
  const limits = decodeResearchLimits(value.limits), areas = rowList(value.areas, decodeResearchArea, "area_id"), sources = rowList(value.sources, decodeResearchSource, "source_id");
  if (!limits || !areas || !sources) return null;
  return { defaults: decodeResearchDefaults(value.defaults), areas, sources, limits, server_now: value.server_now,
    budget: { month: value.budget.month, cap_micro_usd: value.budget.cap_micro_usd as number, spent_micro_usd: value.budget.spent_micro_usd as number,
      reserved_micro_usd: value.budget.reserved_micro_usd as number,
      research_spent_micro_usd: value.budget.research_spent_micro_usd as number, research_stop_at_micro_usd: value.budget.research_stop_at_micro_usd as number, research_paused: value.budget.research_paused },
    estimate: { monthly_checks: value.estimate.monthly_checks, monthly_cost_micro_usd: value.estimate.monthly_cost_micro_usd, basis: value.estimate.basis,
      ...(Object.hasOwn(value.estimate, "area") ? { area: estimateComponent(value.estimate.area) } : {}),
      ...(Object.hasOwn(value.estimate, "source") ? { source: estimateComponent(value.estimate.source) } : {}) },
    ...(Object.hasOwn(value, "research_model_options") ? { research_model_options: modelOptions(value.research_model_options) } : {}),
    ...(Object.hasOwn(value, "discovery_admission") ? { discovery_admission: discoveryAdmission(value.discovery_admission) } : {}) };
}
export function decodeResearchRun(value: unknown): ResearchRun | null {
  if (!researchRecord(value) || !researchId(value.run_id) || !researchOneOf(value.kind, DATES_RESEARCH_RUN_KINDS) || !boolean(value.dry_run)
    || !researchOneOf(value.trigger, DATES_RESEARCH_RUN_TRIGGERS) || !nullable(value.source_id, researchId) || !nullable(value.area_id, researchId)
    || !researchOneOf(value.status, DATES_RESEARCH_RUN_STATUSES) || !fieldNumbers(value, ["found", "imported", "duplicates", "cost_micro_usd"])
    || !nullable(value.started_at, clock) || !nullable(value.finished_at, clock) || !Array.isArray(value.dropped)) return null;
  const dropped: ResearchRun["dropped"] = [];
  for (const entry of value.dropped) {
    if (!researchRecord(entry) || !researchOneOf(entry.reason, DATES_RESEARCH_DROP_REASONS) || !researchInteger(entry.count)) return null;
    dropped.push({ reason: entry.reason, count: entry.count });
  }
  const revisions: Pick<ResearchRun, "source_revision_before" | "source_revision_after" | "area_revision_before" | "area_revision_after"> = {};
  for (const key of ["source_revision_before", "source_revision_after", "area_revision_before", "area_revision_after"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    if (value[key] !== null && !researchInteger(value[key], 1)) return null;
    revisions[key] = value[key];
  }
  const usage = Object.hasOwn(value, "discovery_tool_usage") && value.discovery_tool_usage !== null ? toolUsage(value.discovery_tool_usage) : null;
  if (value.discovery_tool_usage != null && !usage) return null;
  return { run_id: value.run_id, kind: value.kind, dry_run: value.dry_run, trigger: value.trigger, source_id: value.source_id, area_id: value.area_id,
    status: value.status, found: value.found as number, imported: value.imported as number, duplicates: value.duplicates as number, dropped,
    cost_micro_usd: value.cost_micro_usd as number, started_at: value.started_at, finished_at: value.finished_at, ...revisions,
    ...(Object.hasOwn(value, "discovery_tool_usage") ? { discovery_tool_usage: usage } : {}) };
}
export function decodeResearchRunList(value: unknown): ResearchRunList | null {
  if (!researchSuccess(value) || !nullable(value.next_cursor, researchString)) return null;
  const rows = rowList(value.runs, decodeResearchRun, "run_id");
  return rows ? { ...rows, next_cursor: value.next_cursor } : null;
}
function candidate(value: unknown): ResearchCandidate | null {
  if (!researchRecord(value) || !["title", "date_text", "url_host"].every((key) => researchString(value[key]))
    || !researchOneOf(value.outcome, DATES_RESEARCH_CANDIDATE_OUTCOMES)
    || !nullable(value.reason, (v): v is ResearchDropReason => researchOneOf(v, DATES_RESEARCH_DROP_REASONS)) || !nullable(value.intake_id, researchId)) return null;
  return { title: value.title as string, date_text: value.date_text as string, url_host: value.url_host as string, outcome: value.outcome, reason: value.reason, intake_id: value.intake_id };
}
export function decodeResearchRunDetail(value: unknown, runId: string): ResearchRunDetail | null {
  if (!researchSuccess(value)) return null;
  const run = decodeResearchRun(value.run);
  return run && run.run_id === runId ? { run, candidates: rowList(researchRecord(value.run) ? value.run.candidates : undefined, candidate, "") } : null;
}
export function decodeResearchBatchResult(value: unknown): ResearchBatchResult | null {
  if (!researchRecord(value) || !researchId(value.intake_id) || !researchOneOf(value.outcome, DATES_RESEARCH_BATCH_OUTCOMES)
    || !nullable(value.refusal, researchString) || !nullable(value.external_event_id, researchId)) return null;
  return { intake_id: value.intake_id, outcome: value.outcome, refusal: value.refusal, external_event_id: value.external_event_id };
}
/** Terminal replays report the actual stored outcome, never re-decide for a later requested action. */
export function decodeResearchBatchRows(value: unknown, ids: readonly string[]): ResearchRows<ResearchBatchResult> | null {
  if (!researchSuccess(value) || !Array.isArray(value.results) || value.results.length !== ids.length) return null;
  const received = value.results.map((row) => researchRecord(row) && researchId(row.intake_id) ? row.intake_id : null);
  if (new Set(received).size !== ids.length || received.some((id) => id === null || !ids.includes(id))) return null;
  return rowList(value.results, decodeResearchBatchResult, "intake_id");
}
export function decodeResearchBatchReceipt(value: unknown, ids: readonly string[]): ResearchBatchResult[] | null {
  const results = decodeResearchBatchRows(value, ids);
  return results && results.unreadable.length === 0 ? results.rows : null;
}

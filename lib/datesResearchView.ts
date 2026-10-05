import { DATES_RESEARCH_VALUE_FIELDS, type ResearchArea, type ResearchBudget, type ResearchDefaults, type ResearchEstimate,
  type ResearchLimits, type ResearchOverrides, type ResearchScope, type ResearchValues } from "@/lib/datesResearchAdmin";

export type ResearchDistanceUnit = "km" | "mi";
export type ResearchTimeUnit = "hours" | "days";
const KM_PER_MILE = 1.609344;
export function researchDistanceUnit(country: string): ResearchDistanceUnit { return ["US", "GB"].includes(country.toUpperCase()) ? "mi" : "km"; }
export function researchDistanceFromKm(value: number, unit: ResearchDistanceUnit): number { return unit === "mi" ? value / KM_PER_MILE : value; }
export function researchDistanceToKm(value: number, unit: ResearchDistanceUnit): number { return unit === "mi" ? value * KM_PER_MILE : value; }
export function researchTimeFromHours(value: number, unit: ResearchTimeUnit): number { return unit === "days" ? value / 24 : value; }
export function researchTimeToHours(value: number, unit: ResearchTimeUnit): number { return unit === "days" ? value * 24 : value; }
/** Rendering never writes the rounded display back. Only an input change changes canonical units. */
export function researchInputNumber(value: number): string { return Number(value.toPrecision(12)).toString(); }
export function researchEffective<K extends keyof ResearchValues>(defaults: ResearchValues, overrides: ResearchOverrides, key: K): { value: ResearchValues[K]; source: "global" | "own" } {
  const own = overrides[key];
  return { value: own === null ? defaults[key] : own, source: own === null ? "global" : "own" };
}
export function researchEffectiveValues(defaults: ResearchValues, overrides: ResearchOverrides): ResearchValues {
  return Object.fromEntries(DATES_RESEARCH_VALUE_FIELDS.map((key) => [key, researchEffective(defaults, overrides, key).value])) as ResearchValues;
}
export function researchRunningState(defaults: Pick<ResearchDefaults, "enabled" | "auto_cities_enabled">,
  area: Pick<ResearchArea, "mode" | "member_count">, values: ResearchValues, sectionAvailable: boolean, budgetPaused: boolean): { running: boolean; reason: ResearchArea["not_running_reason"] } {
  const reason = !defaults.enabled ? "research_off" : area.mode === "off" ? "mode_off" : !sectionAvailable ? "section_unavailable"
    : budgetPaused ? "budget_paused" : area.mode === "auto" && !defaults.auto_cities_enabled ? "auto_cities_off"
      : area.mode === "auto" && area.member_count < values.member_threshold ? "below_threshold" : null;
  return { running: reason === null, reason };
}
export function researchStock(upcoming: number, target: number) { return { upcoming, target, missing: Math.max(0, target - upcoming), met: upcoming >= target, share: target > 0 ? Math.min(1, upcoming / target) : null }; }
export function researchCost(microUsd: number, locale: string): string {
  return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(microUsd / 1_000_000);
}
export function researchMonthlyEstimate(estimate: ResearchEstimate, budget: ResearchBudget) {
  return { measured: estimate.monthly_cost_micro_usd !== null, checks: estimate.monthly_checks, microUsd: estimate.monthly_cost_micro_usd,
    share: estimate.monthly_cost_micro_usd === null || budget.cap_micro_usd <= 0 ? null : estimate.monthly_cost_micro_usd / budget.cap_micro_usd };
}
export function researchValuesIssue(values: ResearchValues, limits: ResearchLimits): string | null {
  for (const key of ["cadence_hours", "member_threshold", "target_events", "window_days"] as const) {
    if (!Number.isFinite(values[key]) || values[key] < limits[key].min || values[key] > limits[key].max) return key;
  }
  if (values.scope.kind === "radius" && (!Number.isFinite(values.scope.radius_km) || values.scope.radius_km < limits.radius_km.min || values.scope.radius_km > limits.radius_km.max)) return "radius_km";
  return null;
}
export function researchEmptyOverrides(): ResearchOverrides { return { cadence_hours: null, scope: null, member_threshold: null, target_events: null, window_days: null, autopublish: null }; }
export function researchDefaultValues(defaults: ResearchDefaults): ResearchValues {
  return { cadence_hours: defaults.cadence_hours, member_threshold: defaults.member_threshold, target_events: defaults.target_events,
    window_days: defaults.window_days, autopublish: defaults.autopublish, scope: { ...defaults.scope } as ResearchScope };
}
/** A conflict changes the authority/revision, preserving only the operator's edits over the new row. */
export function researchEditsAfterConflict<T extends object>(baseline: T, draft: T, stored: T): T {
  function merge(before: unknown, edited: unknown, current: unknown): unknown {
    if (JSON.stringify(edited) === JSON.stringify(before)) return current;
    const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!object(before) || !object(edited) || !object(current) || Object.hasOwn(edited, "kind")) return edited;
    const result = { ...current };
    for (const key of Object.keys(edited)) result[key] = merge(before[key], edited[key], current[key]);
    return result;
  }
  return merge(baseline, draft, stored) as T;
}

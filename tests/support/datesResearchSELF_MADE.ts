/** SELF-MADE from the P3a draft and Core's chat clarifications. NOT provider captures. Removed when the genuine corpus arrives. */
import type { ResearchArea, ResearchBudget, ResearchDefaults, ResearchLimits, ResearchRun, ResearchSource } from "../../lib/datesResearchAdmin.ts";
export const SELF_MADE_ENVELOPE = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1791216000 };
export const SELF_MADE_DEFAULTS: ResearchDefaults = { enabled: false, auto_cities_enabled: false, member_threshold: 5, cadence_hours: 168,
  scope: { kind: "city", radius_km: null }, target_events: 15, window_days: 30, autopublish: false, revision: 0, updated_at: null, updated_by: null };
export const SELF_MADE_LIMITS: ResearchLimits = { cadence_hours: { min: 6, max: 2160 }, radius_km: { min: 1, max: 160 }, member_threshold: { min: 1, max: 100000 },
  target_events: { min: 1, max: 200 }, window_days: { min: 1, max: 180 }, max_events: { min: 1, max: 100 }, batch_intakes: { min: 1, max: 25 } };
export const SELF_MADE_AREA: ResearchArea = { area_id: "xra_00000000000000000000000000000001", revision: 1, label: "Budapest", place_id: "self-made-place", country_code: "HU",
  center: { latitude: 47.5, longitude: 19.05 }, bounds: { southwest: { latitude: 47.4, longitude: 18.9 }, northeast: { latitude: 47.6, longitude: 19.2 } },
  mode: "auto", proposed: true, overrides: { cadence_hours: null, scope: null, member_threshold: null, target_events: null, window_days: null, autopublish: null },
  effective: { cadence_hours: 168, scope: { kind: "city", radius_km: null }, member_threshold: 5, target_events: 15, window_days: 30, autopublish: false },
  member_count: 24, member_count_at: 1791215990, running: false, not_running_reason: "research_off", stock: { upcoming: 4, target: 15, missing: 11 }, last_run: null, next_run_at: null, month_cost_micro_usd: 0 };
export const SELF_MADE_SOURCE: ResearchSource = { source_id: "xrs_00000000000000000000000000000001", revision: 1, url: "https://events.example.test/calendar", registrable_domain: "example.test", label: "Official calendar",
  type: "official", area_id: SELF_MADE_AREA.area_id, cadence_hours: 24, max_events: 10, window_days: null, autopublish: null, enabled: true, archived: false,
  effective: { window_days: 30, autopublish: false }, robots: { state: "unknown", checked_at: null }, stock: { upcoming: 0, max: 10, missing: 10 }, last_check: null, next_check_at: null, month_cost_micro_usd: 0 };
export const SELF_MADE_BUDGET: ResearchBudget = { month: "2026-10", cap_micro_usd: 50000000, spent_micro_usd: 1000000, reserved_micro_usd: 0, research_spent_micro_usd: 0, research_stop_at_micro_usd: 35000000, research_paused: false };
export const SELF_MADE_RUN: ResearchRun = { run_id: "xrr_00000000000000000000000000000001", kind: "source", dry_run: true, trigger: "manual", source_id: SELF_MADE_SOURCE.source_id, area_id: SELF_MADE_AREA.area_id,
  status: "completed", found: 3, imported: 0, duplicates: 1, dropped: [{ reason: "past_date", count: 1 }], cost_micro_usd: 1234, started_at: 1791215900, finished_at: 1791215950 };
export const SELF_MADE_OVERVIEW = { ...SELF_MADE_ENVELOPE, defaults: SELF_MADE_DEFAULTS, areas: [SELF_MADE_AREA], sources: [SELF_MADE_SOURCE], budget: SELF_MADE_BUDGET,
  estimate: { monthly_checks: 30, monthly_cost_micro_usd: null, basis: "not_measured" }, limits: SELF_MADE_LIMITS };
export const SELF_MADE_CANDIDATE = { title: "Public event", date_text: "Tomorrow at 19:00", url_host: "example.test", outcome: "would_import", reason: null, intake_id: null };

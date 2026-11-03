import type { DatesNamedTree } from "@/lib/datesAdminProjection";
const leaf = (names: string) => Object.fromEntries(names.split(" ").map((name) => [name, 1 as const]));
const envelope = leaf("success status_code message status can_send server_now capabilities replayed audit_id");
const scope = leaf("kind radius_km");
const values = { ...leaf("cadence_hours member_threshold target_events window_days autopublish"), scope };
const models = leaf("openai gemini");
const defaults = { ...values, ...leaf("enabled auto_cities_enabled revision updated_at updated_by"), research_models: models, domains: [leaf("domain type")] };
const last = leaf("run_id status finished_at found imported");
const runSummary = {
  ...leaf("run_id kind dry_run trigger source_id area_id status found imported duplicates cost_micro_usd started_at finished_at source_revision_before source_revision_after area_revision_before area_revision_after"),
  dropped: [leaf("reason count")],
  discovery_tool_usage: { ...leaf("requested_cap echoed_cap tool_items"), action_counts: leaf("search open_page find_in_page unknown") },
};
const area = {
  ...leaf("area_id revision label place_id country_code mode proposed member_count member_count_at running not_running_reason next_run_at month_cost_micro_usd"),
  center: leaf("latitude longitude"), bounds: { southwest: leaf("latitude longitude"), northeast: leaf("latitude longitude") }, overrides: values, effective: values,
  stock: leaf("upcoming target missing"), last_run: runSummary,
};
const source = {
  ...leaf("source_id revision url registrable_domain label type area_id cadence_hours max_events window_days autopublish enabled archived next_check_at month_cost_micro_usd"),
  effective: leaf("window_days autopublish"), robots: leaf("state checked_at"), stock: leaf("upcoming max missing"), last_check: last,
};
const run = {
  // D-149, served with the external admin contract selector v2: why the SYSTEM closed the candidate's intake.
  // D-149 yield: why a candidate stopped before it became an intake (`hard_fails` is a list of codes).
  ...runSummary, candidates: [{ ...leaf("title date_text url_host outcome reason intake_id"), system_closure: leaf("decision blocker"),
    drop_detail: leaf("stage provider_outcome extraction_result events_extracted title_match extracted_title hard_fails gate http_status") }],
};
// Research follow-ups (owner request 2026-11-03): an event's discovered and extracted public facts, why it stopped, and
// the operator's own state. No member, prompt, page text or provider answer.
const followupState = leaf("key state note revision updated_by updated_at");
const followup = {
  ...leaf("key group reason title extracted_title date_text venue_name url url_host topic area_id area_label source_id source_label run_id run_kind run_dry_run run_created_at seen_count intake_id state note revision updated_by updated_at"),
  found: leaf("starts_local ends_local timezone start_at end_at all_day venue_name venue_address city"),
  detail: leaf("stage http_status hard_fails gate title_match extraction_result"),
};
/** Counts and public source metadata only. No raw document, member, provider prompt or response is kept. */
export const DATES_RESEARCH_NAMED: Readonly<Record<string, DatesNamedTree>> = {
  dates_event_research_overview: {
    ...envelope, defaults, areas: [area], sources: [source],
    budget: leaf("month cap_micro_usd spent_micro_usd reserved_micro_usd research_spent_micro_usd research_stop_at_micro_usd research_paused"),
    estimate: { ...leaf("monthly_checks monthly_cost_micro_usd basis"), area: leaf("monthly_checks monthly_cost_micro_usd basis last_run_id last_run_cost_micro_usd"), source: leaf("monthly_checks monthly_cost_micro_usd basis last_run_id last_run_cost_micro_usd") },
    research_model_options: models,
    discovery_admission: { ...leaf("openai_admitted openai_reason gemini_admitted gemini_reason"), pause: leaf("reason run_id at") },
    limits: Object.fromEntries(["cadence_hours", "radius_km", "member_threshold", "target_events", "window_days", "max_events", "batch_intakes", "domains"].map((key) => [key, leaf("min max")])),
  },
  dates_event_research_defaults_save: { ...envelope, defaults },
  dates_event_research_discovery_resume: { ...envelope, defaults },
  dates_event_research_area_save: { ...envelope, area },
  dates_event_research_source_save: { ...envelope, source },
  dates_event_research_source_run_now: { ...envelope, ...leaf("run_id source_id dry_run source_revision") },
  dates_event_research_area_run_now: { ...envelope, ...leaf("run_id area_id dry_run area_revision") },
  dates_event_research_run_list: { ...envelope, ...leaf("next_cursor limit"), runs: [run] },
  dates_event_research_run_detail: { ...envelope, run },
  dates_event_intake_batch_decide: { ...envelope, results: [leaf("intake_id outcome refusal external_event_id")] },
  dates_event_research_followups: { ...envelope, ...leaf("next_cursor limit horizon_days runs_scanned truncated"), followups: [followup],
    counts: { states: leaf("open done dismissed"), groups: leaf("fetch validation gate other"), areas: [leaf("area_id label count")] } },
  dates_event_research_followup_save: { ...envelope, followup: followupState },
};
/** A selected conflict serves only the same public/counts-only row as the corresponding save. */
export const DATES_RESEARCH_CONFLICT_NAMED: Readonly<Record<string, DatesNamedTree>> = {
  dates_event_research_defaults_save: defaults,
  dates_event_research_discovery_resume: defaults,
  dates_event_research_area_save: area,
  dates_event_research_source_save: source,
  dates_event_research_source_run_now: source,
  dates_event_research_area_run_now: area,
  dates_event_research_followup_save: followupState,
};

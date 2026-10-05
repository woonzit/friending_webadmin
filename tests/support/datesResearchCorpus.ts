import { readFileSync } from "node:fs";
import { decodeResearchArea, decodeResearchDefaults, decodeResearchLimits, decodeResearchOverview, decodeResearchSource,
  type ResearchRun } from "../../lib/datesResearchAdmin.ts";

export function researchFixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/dates_event_research_admin_wire/${name}`, import.meta.url), "utf8"));
}
// Unchanged provider captures. See datesResearchProviderPin.json and the read-only Git proof script.
export const GENUINE_EMPTY_OVERVIEW = researchFixture("admin-overview-empty.json");
export const GENUINE_POPULATED_OVERVIEW = researchFixture("admin-overview-populated.json");
export const GENUINE_DEFAULTS = decodeResearchDefaults(GENUINE_EMPTY_OVERVIEW.defaults)!;
export const GENUINE_AREA = decodeResearchArea(researchFixture("admin-area-created-receipt.json").area)!;
export const GENUINE_SOURCE = decodeResearchSource(researchFixture("admin-source-official-created.json").source)!;
export const GENUINE_LIMITS = decodeResearchLimits(GENUINE_EMPTY_OVERVIEW.limits)!;

// DERIVED: combine genuine rows from different captures for isolated consumer branches.
// This is not a captured response or evidence of provider/geocoding/pipeline behaviour.
export const DERIVED_OVERVIEW = { ...structuredClone(GENUINE_EMPTY_OVERVIEW), areas: [GENUINE_AREA], sources: [GENUINE_SOURCE] };
export const DERIVED_ENVELOPE = Object.fromEntries(["success", "status_code", "message", "status", "can_send", "server_now"].map((key) => [key, GENUINE_EMPTY_OVERVIEW[key]]));
// PROVISIONAL DERIVED Part B models. Replaced by genuine run/candidate captures at the FINAL pin.
export const DERIVED_RUN: ResearchRun = { run_id: "rru_00000000000000000000000000000001", kind: "source", dry_run: true,
  trigger: "manual", source_id: GENUINE_SOURCE.source_id, area_id: GENUINE_AREA.area_id, status: "completed", found: 3, imported: 0,
  duplicates: 1, dropped: [{ reason: "past_date", count: 1 }], cost_micro_usd: 1234,
  started_at: GENUINE_EMPTY_OVERVIEW.server_now - 100, finished_at: GENUINE_EMPTY_OVERVIEW.server_now - 50 };
export const DERIVED_CANDIDATE = { title: "Derived consumer candidate", date_text: "Tomorrow at 19:00", url_host: GENUINE_SOURCE.registrable_domain,
  outcome: "would_import", reason: null, intake_id: null };
if (!decodeResearchOverview(DERIVED_OVERVIEW) || !GENUINE_DEFAULTS || !GENUINE_AREA || !GENUINE_SOURCE || !GENUINE_LIMITS) throw new Error("genuine research corpus cannot supply consumer models");

import { readFileSync } from "node:fs";
import { decodeResearchArea, decodeResearchDefaults, decodeResearchLimits, decodeResearchOverview, decodeResearchRunDetail, decodeResearchSource } from "../../lib/datesResearchAdmin.ts";

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
const dryDetail = researchFixture("admin-run-dry-completed.json");
export const GENUINE_RUN = decodeResearchRunDetail(dryDetail, dryDetail.run.run_id)!.run;
export const GENUINE_CANDIDATE = decodeResearchRunDetail(dryDetail, dryDetail.run.run_id)!.candidates!.rows.find((row) => row.outcome === "would_import")!;

// DERIVED: combine genuine rows from different captures for isolated consumer branches.
// This is not a captured response or evidence of provider/geocoding/pipeline behaviour.
export const DERIVED_OVERVIEW = { ...structuredClone(GENUINE_EMPTY_OVERVIEW), areas: [GENUINE_AREA], sources: [GENUINE_SOURCE] };
export const DERIVED_ENVELOPE = Object.fromEntries(["success", "status_code", "message", "status", "can_send", "server_now"].map((key) => [key, GENUINE_EMPTY_OVERVIEW[key]]));
if (!decodeResearchOverview(DERIVED_OVERVIEW) || !GENUINE_DEFAULTS || !GENUINE_AREA || !GENUINE_SOURCE || !GENUINE_LIMITS || !GENUINE_RUN || !GENUINE_CANDIDATE) throw new Error("genuine research corpus cannot supply consumer models");

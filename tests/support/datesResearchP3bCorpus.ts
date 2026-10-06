import { readFileSync } from "node:fs";
import { decodeResearchOverview } from "../../lib/datesResearchAdmin";

/** Unmodified genuine HTTP bodies from accepted Core 5f03015b, never mocks. */
export function p3bResearchFixture(file: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/dates_event_research_p3b_admin_wire/${file}`, import.meta.url), "utf8"));
}
export const P3B_MANIFEST = p3bResearchFixture("manifest.json");
export const P3B_EMPTY_OVERVIEW = decodeResearchOverview(p3bResearchFixture("admin-overview-empty.json"))!;

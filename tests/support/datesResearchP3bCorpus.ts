import { readFileSync } from "node:fs";
import { decodeResearchOverview } from "../../lib/datesResearchAdmin";

/**
 * Unmodified genuine HTTP bodies, never mocks: accepted Core 5f03015b, re-vendored byte for byte from the D-149 yield
 * lane (Core ef10bc77, 204 bodies) with the four contract-2 `drop_detail` captures (datesResearchP3bProviderPin.json).
 */
export function p3bResearchFixture(file: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/dates_event_research_p3b_admin_wire/${file}`, import.meta.url), "utf8"));
}
export const P3B_MANIFEST = p3bResearchFixture("manifest.json");
export const P3B_EMPTY_OVERVIEW = decodeResearchOverview(p3bResearchFixture("admin-overview-empty.json"))!;

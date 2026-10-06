import test from "node:test";
import assert from "node:assert/strict";
import { prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { GENUINE_AREA, DERIVED_ENVELOPE } from "./support/datesResearchCorpus.ts";

test("DERIVED source-audited pre-write/transaction-aborted validation refusals settle only at their documented status", async () => {
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_area_save", {
    place_id: "derived_city", mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Reviewed city boundaries",
  })!;
  // Core 7f86b941 AdminService:102–113,133,178–189,211,221,263;
  // Policy:75–83,200; BatchService:63. DatesAdminException defaults to 422.
  // These are DERIVED classifier cases, not new HTTP/persistence captures.
  for (const [error, status_code] of Object.entries({ "dates-research-place-invalid": 422, "dates-research-scope-invalid": 422,
    "dates-research-id-invalid": 422, "dates-research-revision-invalid": 422, "dates-research-mode-invalid": 422,
    "dates-research-source-type-invalid": 422, "dates-research-not-found": 404, "dates-intake-reason-invalid": 422 })) {
    const response = { ...DERIVED_ENVELOPE, success: false, error, status_code };
    assert.deepEqual(await runResearchCommand(async () => response, command), { kind: "refused", error });
    for (const wrongStatus of [409, 500, 503])
      assert.equal((await runResearchCommand(async () => ({ ...response, status_code: wrongStatus }), command)).kind, "uncertain");
  }
});

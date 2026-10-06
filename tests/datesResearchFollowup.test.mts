import test from "node:test";
import assert from "node:assert/strict";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { GENUINE_AREA, DERIVED_ENVELOPE, researchFixture } from "./support/datesResearchCorpus.ts";

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
test("GENUINE scheduled-open receipt settles stale-page aliases independently of the page's expected revision", () => {
  const body = researchFixture("admin-source-run-scheduled-open-replay.json");
  for (const expected_revision of [1, 2, 5, 99]) {
    const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
      source_id: body.source_id, dry_run: body.dry_run, expected_revision,
    })!;
    assert.equal(decodeResearchCommandReceipt(command, body)?.kind, "success", "classify unchanged genuine receipt against DERIVED stale/reread commands");
    for (const change of [{ source_id: "foreign" }, { dry_run: !body.dry_run }, { source_revision: 1 }, { source_revision: "2" }, { replayed: false }])
      assert.equal(decodeResearchCommandReceipt(command, { ...body, ...change }), null);
  }
});
test("DERIVED same-mode replay ahead by two revisions is accepted, but a new receipt at that revision is not", () => {
  const body = { ...researchFixture("admin-source-run-scheduled-open-replay.json"), source_revision: 7 };
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
    source_id: body.source_id, dry_run: body.dry_run, expected_revision: 5,
  })!;
  assert.equal(decodeResearchCommandReceipt(command, body)?.kind, "success");
  assert.equal(decodeResearchCommandReceipt(command, { ...body, replayed: false, audit_id: "aud_derived" }), null);
});

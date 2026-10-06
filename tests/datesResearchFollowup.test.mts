import test from "node:test";
import assert from "node:assert/strict";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { GENUINE_AREA, GENUINE_SOURCE, DERIVED_ENVELOPE, researchFixture } from "./support/datesResearchCorpus.ts";

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
test("GENUINE open-run conflict explains Core's public stored state; DERIVED duplicate/archive/city conflicts do not claim a revision change", async () => {
  const conflict = researchFixture("admin-source-save-open-conflict.json"), row = conflict.current;
  const fields = Object.fromEntries(["url", "label", "type", "area_id", "cadence_hours", "max_events", "window_days", "autopublish", "enabled", "archived"].map((key) => [key, row[key]]));
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_save", {
    ...fields, source_id: row.source_id, expected_revision: row.revision, reason: "Reviewed source configuration",
  })!;
  const open = await runResearchCommand(async () => conflict, command);
  assert.equal(open.kind, "conflict"); if (open.kind === "conflict") assert.equal(open.cause, "source_open_run");
  const classify = async (current: unknown, request = command) => {
    const answer = await runResearchCommand(async () => ({ ...conflict, current }), request);
    assert.equal(answer.kind, "conflict"); return answer.kind === "conflict" ? answer.cause : undefined;
  };
  assert.equal(await classify({ ...row, archived: true }), "source_archived");
  const create = prepareResearchCommand("admin@example.test", command.action, { ...fields, reason: "Register this source" })!;
  assert.equal(await classify(row, create), "url_owned");
  assert.equal(await classify({ ...row, archived: true }, create), "archived_url_owned");
  assert.equal(await classify({ ...row, source_id: GENUINE_SOURCE.source_id, url: "https://foreign.example.org/" }), undefined, "never infer a cause from a foreign row");
  assert.equal(await classify({ unknown: "future row" }), undefined);
  const city = prepareResearchCommand("admin@example.test", "dates_event_research_area_save", {
    place_id: GENUINE_AREA.place_id, mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Register this city",
  })!;
  assert.equal(await classify(GENUINE_AREA, city), "city_registered");
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

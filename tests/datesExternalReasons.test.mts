import { adminMembershipRefusalForUi } from "../lib/adminMembershipClientError.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesReasonEntryPoints, datesReasonEntryPointsRefused, datesReportEntryPointsFor } from "../lib/datesAdmin.ts";
import { datesCommandOutcome } from "../lib/datesExternalAdmin.ts";
import { datesAdminReasons, datesReasonSaveReceipt, projectDatesAdminReasons } from "../lib/datesReasons.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_admin_wire/admin-reason-${name}.json`, import.meta.url), "utf8"));
const list = fixture("list-external");
const external = list.reasons.find((row: any) => row.key === "wrong_details");
const receipt = fixture("save-external");
const submitted = {
  reason_id: external.reason_id, scope: "activity", key: "wrong_details",
  name_en: "Incorrect event details", name_hu: "Pontatlan eseményadatok",
  explanation_en: external.explanation_en, explanation_hu: external.explanation_hu,
  severity: external.severity, order: external.order, active: external.active,
  comment_required: external.comment_required, entry_points: ["external_event"],
  escalation_category: external.escalation_category, expected_revision: external.revision,
  reason: "Clarify the translated label", idempotency_key: "reason-copy-only-edit-1",
};

test("external_event is an activity-only singleton and an existing reason cannot change cohort", () => {
  assert.deepEqual(datesReasonEntryPoints("activity", " EXTERNAL_EVENT, external_event "), { ok: true, entryPoints: ["external_event"] });
  for (const value of ["external_event,detail", "card,external_event", "external_event,check_in"])
    assert.deepEqual(datesReasonEntryPoints("activity", value), { ok: false, error: "mixedExternal" });
  for (const scope of ["user", "message", "review", "unknown"])
    assert.deepEqual(datesReasonEntryPoints(scope, "external_event"), { ok: false, error: "unknown", tokens: ["external_event"] });
  assert.deepEqual(datesReasonEntryPoints("activity", "detail", ["external_event"]), { ok: false, error: "cohort" });
  assert.deepEqual(datesReasonEntryPoints("activity", "external_event", ["detail"]), { ok: false, error: "cohort" });
  assert.deepEqual(datesReasonEntryPoints("activity", "card,check_in", ["detail"]), { ok: true, entryPoints: ["card", "check_in"] });
  assert.deepEqual(datesReportEntryPointsFor("activity", ["external_event"]), ["external_event"]);
  assert.deepEqual(datesReportEntryPointsFor("activity", ["detail"]), ["detail", "card", "check_in"]);
});

test("genuine reason list keeps every member row and five external seeds with corrected immutable IDs", () => {
  assert.deepEqual(datesAdminReasons(list, "activity"), list.reasons);
  assert.deepEqual(datesAdminReasons(list, "all"), list.reasons);
  assert.equal(datesAdminReasons(list, "user"), null);
  const externalRows = datesAdminReasons(list, "activity")!.filter((row) => row.entry_points.includes("external_event"));
  assert.deepEqual(externalRows.map((row) => row.key), ["wrong_details", "canceled", "fake_or_scam", "inappropriate", "duplicate"]);
  for (const row of externalRows) assert.equal(row.reason_id, `reason_activity_${row.key}`);
  assert.equal(list.reasons.length, 14);
  assert.ok(list.reasons.every((row: any) => row.reason_id !== "reason_activity_external_other"), "Virtual fallback is not an editable stored row");
});

test("reason list rejects incomplete, loosely typed, duplicate and mixed-cohort successful bodies", () => {
  for (const key of Object.keys(external)) {
    const invalid = structuredClone(list); delete invalid.reasons[1][key];
    assert.equal(datesAdminReasons(invalid, "activity"), null, `missing ${key}`);
  }
  for (const change of [{ scope: "external_event" }, { entry_points: ["external_event", "detail"] }, { entry_points: ["external_event", "external_event"] },
    { entry_points: ["EXTERNAL_EVENT"] }, { entry_points: [] }, { active: 1 }, { revision: "1" }, { order: -1 }, { severity: ["medium"] },
    { catalog_version: 2 }, { reason_id: "reason_user_wrong_details" }]) {
    const invalid = structuredClone(list); Object.assign(invalid.reasons[1], change);
    assert.equal(datesAdminReasons(invalid, "activity"), null, JSON.stringify(change));
  }
  for (const change of [{ success: "true" }, { status_code: 422 }, { catalog_version: 2 }, { reasons: null },
    { reasons: [external, external] }]) assert.equal(datesAdminReasons({ ...list, ...change }, "activity"), null);
  // D-143: the catalogue and its rows are bound on their fields; a key this console does not know is tolerated.
  const wider = structuredClone(list); Object.assign(wider.reasons[1], { extra: true });
  assert.ok(datesAdminReasons({ ...wider, extra: true }, "activity"));
});

for (const name of ["save-external", "save-external-replay"]) test(`genuine ${name} acknowledges the exact ID, edits and revision`, () => {
  const body = fixture(name);
  assert.deepEqual(datesReasonSaveReceipt(body, submitted), body.reason);
  for (const change of [{ expected_revision: 2 }, { reason_id: "reason_activity_canceled" }, { entry_points: ["detail"] },
    { name_en: "Other label" }, { scope: "user" }]) assert.equal(datesReasonSaveReceipt(body, { ...submitted, ...change }), null);
  for (const change of [{ revision: "2" }, { idempotency_replayed: 1 }, { audit_id: null }, { reason: undefined }])
    assert.equal(datesReasonSaveReceipt({ ...body, ...change }, submitted), null);
  // D-143: the receipt binds on the reason it acknowledges, the revision and the audit id; an unknown key is tolerated.
  assert.deepEqual(datesReasonSaveReceipt({ ...body, extra: true }, submitted), body.reason);
});

for (const name of ["cohort", "member-cohort", "mixed", "save-viewer"]) test(`genuine ${name} refusal never becomes a list or receipt`, () => {
  const body = fixture(`${name}-denied`);
  assert.equal(datesAdminReasons(body, "activity"), null);
  assert.equal(datesReasonSaveReceipt(body, submitted), null);
  assert.equal(datesReasonEntryPointsRefused(body.error), name !== "save-viewer");
  assert.equal(body.status_code, name === "save-viewer" ? 403 : 422);
});

// Execute the actual production editor callback with controlled transport and
// Core's captured bodies. This is not a mounted browser or a new provider run.
const source = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const editor = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "ReasonEditor");
assert.ok(editor?.body);
const functions = editor.body.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
  && ["save", "showEntryPointsError"].includes(node.name?.text ?? ""));
const compiled = ts.transpileModule(functions.map((node) => node.getText(tree)).join("\n") + "\nexports.save = save;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness(response: unknown, overrides: Record<string, unknown> = {}) {
  const calls: Array<{ action: string; body: any }> = [], errors: string[] = [], inline: string[] = [], unknown: Array<string | null> = []; let saved = 0;
  const context: any = { exports: {}, adminMembershipRefusalForUi, reason: external, scope: "activity", keyName: "wrong_details", nameEn: submitted.name_en, nameHu: submitted.name_hu,
    explanationEn: submitted.explanation_en, explanationHu: submitted.explanation_hu, severity: "medium", order: "10", active: true, commentRequired: true,
    entryPoints: "external_event", escalationCategory: "integrity", auditReason: submitted.reason, canManage: true, busy: false,
    allowedEntryPoints: "external_event", datesReasonEntryPoints, datesReasonEntryPointsRefused, datesReasonSaveReceipt,
    createAdminIdempotencyKey: () => submitted.idempotency_key, t: (key: string) => key, setBusy: () => {},
    setEntryPointsError: (value: string | null) => { if (value) inline.push(value); }, onInlineError: () => {},
    adminCall: async (action: string, body: unknown) => { calls.push({ action, body }); return response; },
    datesCommandOutcome, onUnknown: (error: string | null) => unknown.push(error),
    onError: (error: string) => errors.push(error), onSaved: async () => { saved++; }, ...overrides };
  vm.runInNewContext(compiled, context);
  return { calls, errors, inline, unknown, saved: () => saved, save: () => context.exports.save({ preventDefault() {} }) };
}
test("production reason editor sends the captured seed's copy-only update and accepts the real replay", async () => {
  for (const name of ["save-external", "save-external-replay"]) {
    const h = harness(fixture(name)); await h.save();
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ action: "dates_reason_save", body: submitted }]);
    assert.equal(h.saved(), 1); assert.deepEqual(h.errors, []); assert.deepEqual(h.inline, []);
  }
});
test("production editor stops invalid cohort changes and viewer callbacks before dispatch", async () => {
  for (const [entryPoints, expected] of [["external_event,detail", "entryPointsMixedExternal"], ["detail", "entryPointsCohort"]]) {
    const h = harness(receipt, { entryPoints }); await h.save();
    assert.equal(h.calls.length, 0); assert.deepEqual(h.inline, [expected]); assert.equal(h.saved(), 0);
  }
  const member = { ...external, entry_points: ["detail"] };
  const h = harness(receipt, { reason: member }); await h.save();
  assert.equal(h.calls.length, 0); assert.deepEqual(h.inline, ["entryPointsCohort"]);
  const viewer = harness(receipt, { canManage: false }); await viewer.save(); assert.equal(viewer.calls.length, 0);
});
test("production editor preserves Core's inline cohort refusals and rejects malformed success", async () => {
  for (const name of ["cohort", "member-cohort", "mixed"]) {
    const h = harness(fixture(`${name}-denied`)); await h.save();
    assert.deepEqual(h.inline, ["entryPointsRefused"]); assert.equal(h.saved(), 0);
  }
  for (const body of [{ success: true }, { ...receipt, reason: { ...receipt.reason, reason_id: "reason_activity_canceled" } }]) {
    // T-890: a success this console cannot read as the receipt may still have been written. It is announced as an
    // unknown outcome (still named by what was wrong with it), no longer as a plain failure.
    const h = harness(body); await h.save(); assert.deepEqual(h.unknown, ["dates-reason-contract-invalid"]); assert.deepEqual(h.errors, []); assert.equal(h.saved(), 0);
  }
  const viewer = harness(fixture("save-viewer-denied")); await viewer.save();
  assert.deepEqual(viewer.errors, ["dates-admin-capability-required"]); assert.equal(viewer.saved(), 0);
});
test("display-only reason repairs cannot be written back as cleared fields", async () => {
  for (const field of ["name_en", "name_hu", "explanation_en", "explanation_hu"]) {
    const h = harness(receipt, { reason: { ...external, unreadable_fields: [field] } });
    await h.save(); assert.equal(h.calls.length, 0); assert.equal(h.saved(), 0);
  }
  assert.match(source, /canManage=\{canManageReasons && !reason\.unreadable_fields\?\.length\}/);
});

test("the configuration read isolates row diagnostics and both locales explain cohort immutability", () => {
  assert.match(source, /projectDatesAdminReasons\(reasonResponse, scope\)/);
  assert.match(source, /setReasons\(nextReasons\.reasons\)/);
  assert.match(source, /setUnreadableReasons\(nextReasons\.unreadable_rows\)/);
  for (const locale of ["en", "hu"]) {
    const copy = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.configuration;
    for (const key of ["entryPointsMixedExternal", "entryPointsCohort", "entryPointsRefused"])
      assert.ok(typeof copy[key] === "string" && copy[key].length > 30);
    assert.match(copy.entryPointsHint, /external_event/);
  }
});

test("a legacy or unreadable reason cannot hide the publishing settings or other reasons", () => {
  const valid = projectDatesAdminReasons(list, "activity"); assert.ok(valid);
  assert.deepEqual(valid, { reasons: list.reasons, unreadable_rows: [] });
  const display = structuredClone(list); Object.assign(display.reasons[0], { name_en: null, explanation_hu: ["not displayed"] });
  const projected = projectDatesAdminReasons(display, "activity"); assert.ok(projected);
  assert.equal(projected.reasons.length, 14); assert.deepEqual(projected.unreadable_rows, []);
  assert.equal(projected.reasons[0].reason_id, list.reasons[0].reason_id); assert.equal(projected.reasons[0].revision, list.reasons[0].revision);
  assert.equal(projected.reasons[0].name_en, ""); assert.equal(projected.reasons[0].explanation_hu, null);
  assert.deepEqual(projected.reasons[0].unreadable_fields, ["name_en", "explanation_hu"]);
  for (const changed of [{ entry_points: [] }, { entry_points: ["legacy_entry"] }, { revision: "1" }, { reason_id: "invalid" },
    { scope: "external_event" }, { severity: ["medium"] }]) {
    const legacy = structuredClone(list); Object.assign(legacy.reasons[0], changed);
    const page = projectDatesAdminReasons(legacy, "activity"); assert.ok(page);
    assert.equal(page.reasons.length, 13); assert.equal(page.unreadable_rows.length, 1);
    assert.equal(page.unreadable_rows[0].reason_id, changed.reason_id === "invalid" ? null : list.reasons[0].reason_id);
    assert.equal(datesAdminReasons(legacy, "activity"), null, "the strict command/read witness is not weakened");
  }
  assert.equal(projectDatesAdminReasons({ ...list, success: false }, "activity"), null);
  assert.equal(projectDatesAdminReasons({ ...list, reasons: null }, "activity"), null);
});

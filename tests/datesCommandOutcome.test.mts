import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createAdminIdempotencyKey, datesReasonEntryPoints, datesReasonEntryPointsRefused } from "../lib/datesAdmin.ts";
import {
  datesActivityCommandReceipt, datesActivityTypeSaveReceipt, datesActivityUpdateReceipt, datesCaseResolutionReceipt, datesHostTransferReceipt,
  datesReasonDeactivateReceipt, datesSettingSaveReceipt,
} from "../lib/datesCommandReceipts.ts";
import { DATES_RECEIPT_CHECKS_PENDING, datesCommandOutcome, datesExternalRefusal } from "../lib/datesExternalAdmin.ts";
import {
  DatesCaseReadFence, datesConsoleCommandReceipt, datesLegalHoldCommandReceipt, datesLegalHoldReceipt, datesTrailEvidenceCommandReceipt, datesTrailEvidenceReceipt,
  isDatesConsoleCommand,
} from "../lib/datesModerationRead.ts";

// T-890: what a reply means for the commands of the Dates console that do not
// go through the publication journal, and what the three pages do with it.
// The pages' own functions are extracted from their source and run with React
// state replaced by recorders; `adminCall` is a stand-in for the bridge. Core
// is a small model TRANSCRIBED from Core main 07215298 (named where it is
// defined). No browser, no mounted page, no Core process.
const P1 = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, P1), "utf8"));
/** A genuine body of the command corpus (T-891, Core 33265e46); its requests are in that corpus's generator. */
const command = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_admin_command_wire/${name}.json`, import.meta.url), "utf8"));
/** A genuine body of the intake corpus (the P1 routes as Core serves them with the Admin intake contract selector). */
const intake = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_event_intake_admin_wire/${name}.json`, import.meta.url), "utf8"));
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null));
const core = (error: string, status: number) => ({ success: false, status_code: status, error, message: 200, status: 200, can_send: 0 });
const bridge = (error: string, status: number) => ({ success: false, status_code: status, error });
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function functionsOf(file: string, component: string) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const owner = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === component);
  assert.ok(owner?.body, component);
  return { source, text: (name: string) => {
    const found = owner.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(found, `${component}.${name}`); return found.getText(tree);
  } };
}
/** A translator that shows which message was chosen and with what. */
const translator = (prefix: string) => (key: string, values?: Record<string, unknown>) =>
  `${prefix}${key}${values && Object.keys(values).length ? `:${Object.values(values).join(",")}` : ""}`;

/** Every reply that does not say whether a command landed. */
const LOST: ReadonlyArray<[string, unknown, string | null]> = [
  ["no answer", null, null],
  ["a thrown transport", new Error("offline"), null],
  ["an unreadable success", { success: true }, null],
  ["the bridge's timeout", bridge("core-timeout", 504), "core-timeout"],
  ["Core unreachable", bridge("core-unavailable", 502), "core-unavailable"],
  ["an unreadable Core body", bridge("invalid-core-response", 502), "invalid-core-response"],
  ["Core's server failure", core("dates-admin-unavailable", 503), "dates-admin-unavailable"],
  ["Core's command-in-progress", core("dates-admin-command-in-progress", 409), "dates-admin-command-in-progress"],
];

// ---------------------------------------------------------------- the classification

test("a kept command is settled only by a receipt or a pinned no-land refusal; a fenced one by any readable refusal below 500", () => {
  assert.deepEqual(datesCommandOutcome({ anything: 1 }, true, "kept"), { kind: "success" });
  for (const [name, reply, token] of LOST) {
    if (reply instanceof Error) continue;
    assert.deepEqual(datesCommandOutcome(reply, false, "kept"), { kind: "uncertain", error: token }, `kept: ${name}`);
    assert.deepEqual(datesCommandOutcome(reply, false, "fresh"), { kind: "uncertain", error: token }, `fresh: ${name}`);
  }
  // Core's genuine refusals of the legal hold and of a case command.
  const open = fixture("admin-moderation-hold-open-denied"), viewer = fixture("admin-moderation-hold-viewer-denied"), conflict = fixture("admin-moderation-key-conflict-denied");
  assert.deepEqual([open.error, viewer.error, conflict.error], ["dates-legal-hold-case-open", "dates-admin-capability-required", "dates-admin-idempotency-conflict"]);
  assert.deepEqual(datesCommandOutcome(open, false, "kept"), { kind: "refused", error: open.error });
  // A capability check precedes Core's receipt lookup, and a key conflict says the key is taken by another payload:
  // neither says whether an earlier attempt under this key landed.
  for (const body of [viewer, conflict]) assert.deepEqual(datesCommandOutcome(body, false, "kept"), { kind: "uncertain", error: body.error });
  // A command sent under a new key each time has no earlier attempt under that key: the same replies answer it.
  for (const body of [open, viewer, conflict]) assert.deepEqual(datesCommandOutcome(body, false, "fresh"), { kind: "refused", error: body.error });
  // The tokens with which Core refuses the two unfenced commands without writing (TRANSCRIBED from Core main 07215298:
  // DatesModerationCommandService::legalHold and caseInSession, DatesTrailEvidenceService::capture).
  for (const [error, status] of [["dates-moderation-case-unavailable", 404], ["dates-moderation-evidence-unavailable", 404], ["dates-trail-evidence-unavailable", 404],
    ["dates-legal-hold-case-open", 409], ["dates-legal-hold-media-purge-started", 409], ["dates-trail-evidence-activity-unavailable", 409], ["dates-admin-stale-revision", 409],
    ["dates-moderation-case-id-invalid", 422], ["dates-moderation-target-invalid", 422], ["dates-legal-hold-action-invalid", 422], ["dates-admin-revision-invalid", 422],
    ["dates-trail-evidence-range-too-large", 422], ["dates-admin-reason-required", 422], ["dates-admin-idempotency-invalid", 422]] as const) {
    assert.deepEqual(datesCommandOutcome(core(error, status), false, "kept"), { kind: "refused", error }, error);
    // The token alone is not enough: another status, or the bridge's envelope, is not Core's pinned refusal.
    assert.equal(datesCommandOutcome(core(error, status === 409 ? 422 : 409), false, "kept").kind, "uncertain", error);
    assert.equal(datesCommandOutcome(bridge(error, status), false, "kept").kind, "uncertain", error);
  }
  // Raised before the receipt lookup from the clock, or left to the accepted journal's judgement: they settle nothing.
  for (const [error, status] of [["dates-legal-hold-review-invalid", 422], ["dates-trail-evidence-window-invalid", 422], ["dates-moderation-conflict", 403],
    ["dates-sensitive-location-capability-required", 403]] as const)
    assert.deepEqual(datesCommandOutcome(core(error, status), false, "kept"), { kind: "uncertain", error }, error);
  assert.equal(datesExternalRefusal(fixture("admin-moderation-conflict-denied")).kind, "uncertain", "the P1 journal's reading of the conflict refusal is unchanged");
});

test("the trail capture's receipt is bound to its case and its window, and - with the selector - to the revision it leaves", () => {
  // Core's genuine pairs (command corpus, generator lines 422-428 released, 518-522 with the selector).
  const caseId = `cas_${"3".padStart(32, "0")}`;
  const request = (expected: number, from: number) => ({ case_id: caseId, expected_revision: expected, captured_from: from, captured_to: 1789999940,
    reason: "Synthetic incident window.", break_glass: false });
  for (const name of ["admin-trail-capture", "admin-trail-capture-replay", "admin-trail-capture-existing"]) {
    const body = command(name), expected = name.endsWith("existing") ? 2 : 1;
    assert.equal(datesTrailEvidenceReceipt(body, caseId, 1789999400, 1789999940), true, name);
    assert.deepEqual(datesTrailEvidenceCommandReceipt(body, request(expected, 1789999400)), { existing: null, revision: null }, `${name}: the released shape says neither`);
  }
  assert.deepEqual(datesTrailEvidenceCommandReceipt(command("admin-trail-selected-capture"), request(2, 1789999700)), { existing: false, revision: 3 });
  assert.deepEqual(datesTrailEvidenceCommandReceipt(command("admin-trail-selected-capture-replay"), request(2, 1789999700)), { existing: false, revision: 3 });
  assert.deepEqual(datesTrailEvidenceCommandReceipt(command("admin-trail-selected-existing"), request(3, 1789999700)), { existing: true, revision: 3 });
  // The released fields bind as before: another case, snapshot, audit or window is not this capture's receipt.
  const receipt = command("admin-trail-selected-capture");
  for (const change of [{ success: false }, { status_code: 409 }, { case_id: "cas_" + "f".repeat(32) }, { evidence_id: "evi_1" }, { evidence_id: null }, { audit_id: "" },
    { captured_from: 1789999701 }, { captured_to: 1789999941 },
    // ... and the two that are served with the selector agree with each other and with the request, or are both absent.
    { revision: 4 }, { revision: 2 }, { existing: true }, { existing: "false" }, { revision: null }])
    assert.equal(datesTrailEvidenceCommandReceipt({ ...receipt, ...change }, request(2, 1789999700)), null, JSON.stringify(change));
  const { existing: _existing, ...half } = receipt;
  assert.equal(datesTrailEvidenceCommandReceipt(half, request(2, 1789999700)), null, "one of the two without the other");
  assert.equal(datesTrailEvidenceCommandReceipt(receipt, request(3, 1789999700)), null, "another revision was sent");
  assert.equal(datesTrailEvidenceCommandReceipt(receipt, { ...request(2, 1789999700), expected_revision: "2" }), null);
  assert.ok(datesTrailEvidenceCommandReceipt({ ...receipt, future: 1 }, request(2, 1789999700)), "a key it does not name is tolerated");
  for (const value of [null, "ok", [], { success: true }]) assert.equal(datesTrailEvidenceCommandReceipt(value, request(2, 1789999700)), null);
});

test("the legal hold's receipt says what the command did, bound to the request's revision; the released shape still binds", () => {
  // Core's genuine pairs (command corpus, generator lines 385-417): case 1 without expected_revision (the released shape),
  // case 2 with it (the extended shape).
  const hold = (number: number, action: "place" | "release", reviewAt: number | null, extra: Record<string, unknown> = {}) => ({ case_id: `cas_${String(number).padStart(32, "0")}`,
    action, reason: "Synthetic.", legal_basis: "Synthetic.", break_glass: false, review_at: reviewAt, ...extra });
  for (const [name, action, reviewAt] of [["admin-hold-place", "place", 1790086400], ["admin-hold-place-unchanged", "place", 1790086400], ["admin-hold-place-replay", "place", 1790086400],
    ["admin-hold-amend", "place", 1790172800], ["admin-hold-release", "release", null], ["admin-hold-release-unchanged", "release", null]] as const) {
    assert.deepEqual(datesLegalHoldCommandReceipt(command(name), hold(1, action, reviewAt)), { hold_change: null, revision: null }, name);
    // The released shape cannot tell a placement from "already in place": the same audit id, the same body.
    assert.equal(datesLegalHoldReceipt(command(name), `cas_${"1".padStart(32, "0")}`, action, reviewAt), true, name);
  }
  assert.deepEqual(command("admin-hold-place-unchanged"), { ...command("admin-hold-place") }, "without expected_revision an identical place answers the first receipt");
  const EXTENDED = [["admin-hold-selected-placed", "place", 1790086400, 1, "placed", 2], ["admin-hold-selected-unchanged", "place", 1790086400, 2, "unchanged", 2],
    ["admin-hold-selected-amended", "place", 1790172800, 2, "amended", 3], ["admin-hold-selected-released", "release", null, 3, "released", 4],
    ["admin-hold-selected-release-unchanged", "release", null, 4, "unchanged", 4]] as const;
  for (const [name, action, reviewAt, expected, change, revision] of EXTENDED) {
    const request = hold(2, action, reviewAt, { expected_revision: expected });
    assert.deepEqual(datesLegalHoldCommandReceipt(command(name), request), { hold_change: change, revision }, name);
    // The same answer to another revision, another action or another case is not this command's receipt.
    assert.equal(datesLegalHoldCommandReceipt(command(name), { ...request, expected_revision: expected + 1 }), null, `${name} +1`);
    assert.equal(datesLegalHoldCommandReceipt(command(name), hold(1, action, reviewAt, { expected_revision: expected })), null, `${name} case`);
    assert.equal(datesLegalHoldCommandReceipt(command(name), { ...request, action: action === "place" ? "release" : "place", review_at: action === "place" ? null : 1790086400 }), null);
    assert.equal(datesLegalHoldCommandReceipt(command(name), { ...request, expected_revision: String(expected) }), null, `${name}: a revision that is not a number`);
  }
  // The extension agrees with itself: all three or none; a change the action cannot have; an unchanged hold that moved
  // the revision or changed evidence rows; more rows changed than the case has.
  const placed = command("admin-hold-selected-placed"), request = hold(2, "place", 1790086400, { expected_revision: 1 });
  for (const change of [{ hold_change: "released" }, { hold_change: "unchanged" }, { hold_change: "held" }, { revision: 3 }, { revision: "2" }, { evidence_changed_count: 3 },
    { evidence_changed_count: -1 }]) assert.equal(datesLegalHoldCommandReceipt({ ...placed, ...change }, request), null, JSON.stringify(change));
  for (const key of ["revision", "hold_change", "evidence_changed_count"]) {
    const { [key]: _gone, ...partial } = placed;
    assert.equal(datesLegalHoldCommandReceipt(partial, request), null, `without ${key}`);
  }
  const unchanged = command("admin-hold-selected-unchanged"), again = hold(2, "place", 1790086400, { expected_revision: 2 });
  assert.equal(datesLegalHoldCommandReceipt({ ...unchanged, evidence_changed_count: 2 }, again), null);
  assert.equal(datesLegalHoldCommandReceipt({ ...unchanged, revision: 3 }, again), null);
  assert.ok(datesLegalHoldCommandReceipt({ ...placed, future: true }, request), "a key it does not name is tolerated");
  for (const name of ["admin-hold-selected-stale-denied", "admin-hold-selected-malformed-denied", "admin-hold-viewer-denied", "admin-hold-release-open-denied"])
    assert.equal(datesLegalHoldCommandReceipt(command(name), request), null, name);
});

// ---------------------------------------------------------------- Core, as far as these commands go

/**
 * The two case commands as Core T-891 does them (Core claude/core-hardening-20261002 33265e46, the Core lane's
 * hand-over and the genuine bodies of its command corpus). Same key: the stored receipt is replayed. A new key:
 * the request's `expected_revision` must be the case revision (else `dates-admin-stale-revision`, nothing written).
 * A hold WRITE moves the revision; an identical place, or a release where nothing is held, writes nothing and
 * answers `unchanged`. A capture moves the revision; the same window at the current revision answers the snapshot
 * that exists (`existing: true`).
 */
function coreModel(caseId: string, start = 7) {
  const commands = new Map<string, { hash: string; result: Record<string, unknown> }>();
  const writes: Array<{ operation: string; key: string }> = [];
  let revision = start, held: string | null = null, sequence = 0;
  const windows = new Map<string, string>();
  const hex = (prefix: string) => `${prefix}_${(++sequence).toString(16).padStart(32, "0")}`;
  function answer(action: string, body: Record<string, any>): Record<string, unknown> {
    const operation = action === "dates_moderation_legal_hold" ? "moderation.case.legal_hold" : "moderation.case.capture_trail";
    const { idempotency_key: key, ...payload } = body;
    assert.match(String(key), /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);
    const hash = JSON.stringify(payload), existing = commands.get(`${operation}\u0000${key}`);
    if (existing) return existing.hash === hash ? { ...existing.result, idempotency_replayed: true } : core("dates-admin-idempotency-conflict", 409);
    if (body.case_id !== caseId) return core("dates-moderation-case-unavailable", 404);
    if (body.expected_revision !== revision) return core("dates-admin-stale-revision", 409);
    let result: Record<string, unknown>;
    if (action === "dates_moderation_legal_hold") {
      const state = body.action === "place" ? `${body.legal_basis}|${body.review_at}` : null;
      const change = state === held ? "unchanged" : body.action === "release" ? "released" : held === null ? "placed" : "amended";
      if (change !== "unchanged") { writes.push({ operation, key }); revision++; held = state; }
      result = { ...command(body.action === "place" ? "admin-hold-selected-placed" : "admin-hold-selected-released"), case_id: caseId, review_at: body.action === "place" ? body.review_at : null,
        audit_id: hex("aud"), revision, hold_change: change, evidence_changed_count: change === "unchanged" ? 0 : 2 };
    } else {
      const window = `${body.captured_from}|${body.captured_to}`, known = windows.get(window);
      if (!known) { writes.push({ operation, key }); revision++; windows.set(window, hex("evi")); }
      result = { ...command("admin-trail-selected-capture"), case_id: caseId, evidence_id: windows.get(window), captured_from: body.captured_from, captured_to: body.captured_to,
        audit_id: hex("aud"), revision, existing: Boolean(known) };
    }
    commands.set(`${operation}\u0000${key}`, { hash, result });
    return result;
  }
  return { writes, answer, revision: () => revision };
}

// ---------------------------------------------------------------- the moderation case page

const casePage = functionsOf("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", "DatesModerationCase");
const CASE_ID = fixture("admin-moderation-hold-place").case_id as string;
const caseCode = compile(`${["mutate", "commandSettled", "adoptCaseRevision", "executeConfirmed", "prepareLegalHold", "captureTrailEvidence", "addNote"]
  .map(casePage.text).join("\n")}
  exports.mutate = mutate; exports.executeConfirmed = executeConfirmed; exports.prepareLegalHold = prepareLegalHold;
  exports.captureTrailEvidence = captureTrailEvidence; exports.addNote = addNote;`);

function caseHarness(reply: (action: string, body: Record<string, any>) => unknown, caseId = CASE_ID, revision = 7) {
  const sent: Array<{ action: string; body: Record<string, any> }> = [], state: Record<string, any> = {}, writes: string[] = [];
  const readFence = new DatesCaseReadFence();
  const context: any = { exports: {}, caseId, writeLocked: false, busy: false, mutationBusy: { current: false }, readFence, lifetime: { current: 0 },
    isDatesConsoleCommand, datesConsoleCommandReceipt, datesLegalHoldCommandReceipt, datesTrailEvidenceCommandReceipt, datesCommandOutcome, datesCaseResolutionReceipt,
    createAdminIdempotencyKey, t: translator(""), commandOutcome: translator("outcome."), load: async () => { writes.push("load"); },
    isDatesExternalMessageCase: () => false, datesLegalHoldAllowed: () => true, epochFromLocalInput: (value: string) => Number(value),
    data: { case: { case_id: caseId, revision, target_type: "activity", activity_id: "act_" + "0".repeat(31) + "2", conflict_of_interest: false, status: "actioned" } },
    principal: { email: "moderator@example.test" }, breakGlass: false, confirmed: null,
    holdAction: "place", holdReason: "Preservation request 2026/118.", legalBasis: "Court order 12.Pk.50.118/2026.", holdReviewAt: "1790086400",
    trailFrom: "1789990000", trailTo: "1789993600", trailReason: "Route during the reported incident.", note: "Checked the report against the thread.", noteReason: "",
    adminCall: async (action: string, body: Record<string, any>) => {
      sent.push({ action, body: plain(body) });
      const value = reply(action, plain(body));
      if (value instanceof Error) throw value;
      return value;
    } };
  // `setData` takes React's updater: the page's own adoption runs on the harness's copy of the case.
  context.setData = (update: unknown) => { context.data = typeof update === "function" ? (update as (value: unknown) => unknown)(context.data) : update; writes.push("Data"); };
  for (const name of ["Busy", "Evidence", "Feedback", "Confirmed", "HoldReason", "LegalBasis", "HoldReviewAt", "TrailFrom", "TrailTo", "TrailReason",
    "Note", "NoteReason", "ResolutionReason", "VisibleReasonEn", "VisibleReasonHu", "RestrictionExpiry"])
    context[`set${name}`] = (value: unknown) => {
      state[name] = value; writes.push(name);
      if (name === "Confirmed") context.confirmed = value;
    };
  vm.runInNewContext(caseCode, context);
  return { context, state, writes, sent, readFence, api: context.exports as Record<string, (...values: any[]) => Promise<any>> };
}
const submit = { preventDefault() {} };

for (const action of ["place", "release"] as const) test(`legal hold ${action}: a lost reply is an unknown outcome, and the blind repeat is refused as stale - one write`, async () => {
  for (const [name, lost, token] of LOST) {
    const model = coreModel(CASE_ID);
    if (action === "release") model.answer("dates_moderation_legal_hold", { case_id: CASE_ID, action: "place", reason: "x", legal_basis: "Court order.", break_glass: false,
      review_at: 1790086400, expected_revision: 7, idempotency_key: "dates-legal-hold-place:00000000-0000-4000-8000-000000000000" });
    let lose = true;
    const h = caseHarness((sentAction, body) => { const answer = model.answer(sentAction, body); return lose ? lost : answer; }, CASE_ID, model.revision());
    h.context.holdAction = action;
    // The operator fills the form and confirms: the page's own two steps. The request carries the case revision (T-891).
    h.api.prepareLegalHold(submit);
    const prepared = plain(h.state.Confirmed);
    assert.equal(prepared.kind, "legal_hold"); assert.equal(prepared.payload.action, action); assert.equal(prepared.payload.expected_revision, model.revision());
    assert.match(prepared.payload.idempotency_key, new RegExp(`^dates-legal-hold-${action}:[0-9a-f-]{36}$`));
    const writes = model.writes.length;
    await h.api.executeConfirmed();
    assert.equal(model.writes.length, writes + 1, `${name}: Core applied it`);
    // Not a failure: the outcome is not known, said with the operator's own "Refresh the case"; nothing is kept, and the
    // form keeps what was sent.
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}`, refresh: true }, name);
    assert.equal(h.state.Confirmed, null); assert.equal(h.writes.includes("load"), false, "the page does not reread by itself");
    for (const field of ["HoldReason", "LegalBasis", "HoldReviewAt"]) assert.equal(h.writes.includes(field), false, field);
    // The operator repeats it without refreshing: a new key, the revision the page had read. Core refuses it as stale.
    lose = false;
    h.api.prepareLegalHold(submit); await h.api.executeConfirmed();
    assert.notEqual(h.sent[1].body.idempotency_key, h.sent[0].body.idempotency_key);
    assert.equal(model.writes.length, writes + 1, `${name}: no second write`);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: "operationFailed:dates-admin-stale-revision" });
    // After a refresh the same hold is answered for what it is: already so, nothing written.
    h.context.data = { case: { ...h.context.data.case, revision: model.revision() } };
    h.api.prepareLegalHold(submit); await h.api.executeConfirmed();
    assert.equal(model.writes.length, writes + 1, `${name}: still one write`);
    assert.deepEqual(plain(h.state.Feedback), { tone: "success", text: action === "place" ? "legalHoldAlreadyInPlace" : "legalHoldNothingHeld" });
  }
});

test("legal hold: Core's genuine answers say what the command did, the revision is adopted, and stale or malformed is a refusal", async () => {
  // Case 2 of the command corpus (generator lines 405-417), each request as the page builds it from its form.
  const CASE_2 = `cas_${"2".padStart(32, "0")}`;
  const run = async (reply: unknown, revision: number, action: "place" | "release", basis: string, reviewAt: string) => {
    const h = caseHarness(() => reply, CASE_2, revision);
    Object.assign(h.context, { holdAction: action, legalBasis: basis, holdReviewAt: reviewAt, holdReason: "Synthetic legal retention." });
    h.api.prepareLegalHold(submit); await h.api.executeConfirmed();
    return h;
  };
  for (const [name, revision, action, basis, reviewAt, text, adopted] of [
    ["admin-hold-selected-placed", 1, "place", "Synthetic authority request.", "1790086400", "legalHoldPlaced", 2],
    ["admin-hold-selected-unchanged", 2, "place", "Synthetic authority request.", "1790086400", "legalHoldAlreadyInPlace", 2],
    ["admin-hold-selected-amended", 2, "place", "Synthetic court order.", "1790172800", "legalHoldAmended", 3],
    ["admin-hold-selected-released", 3, "release", "Synthetic letter of withdrawal.", "", "legalHoldReleased", 4],
    ["admin-hold-selected-release-unchanged", 4, "release", "Synthetic letter of withdrawal.", "", "legalHoldNothingHeld", 4]] as const) {
    const h = await run(command(name), revision, action, basis, reviewAt);
    assert.equal(h.sent[0].body.expected_revision, revision, name);
    assert.deepEqual(plain(h.state.Feedback), { tone: "success", text }, name);
    // The receipt's revision is adopted at once (never backwards), and the case is read again.
    assert.equal(h.context.data.case.revision, adopted, name); assert.ok(h.writes.includes("load"), name);
    for (const field of ["HoldReason", "LegalBasis", "HoldReviewAt"]) assert.equal(h.state[field], "", `${name}: ${field}`);
  }
  // A receipt that names a revision below the one the page holds does not move it back.
  const behind = caseHarness(() => command("admin-hold-selected-placed"), CASE_2, 1);
  behind.context.data.case.revision = 1; await behind.api.mutate("dates_moderation_legal_hold", { case_id: CASE_2, action: "place", reason: "x", legal_basis: "y", break_glass: false,
    review_at: 1790086400, expected_revision: 1, idempotency_key: "dates-legal-hold-place:00000000-0000-4000-8000-000000000001" }, "legalHoldUpdated");
  assert.equal(behind.context.data.case.revision, 2);
  behind.context.data.case.revision = 9; await behind.api.mutate("dates_moderation_legal_hold", { case_id: CASE_2, action: "place", reason: "x", legal_basis: "y", break_glass: false,
    review_at: 1790086400, expected_revision: 1, idempotency_key: "dates-legal-hold-place:00000000-0000-4000-8000-000000000002" }, "legalHoldUpdated");
  assert.equal(behind.context.data.case.revision, 9, "never backwards");
  // The released shape (a Core without T-891) is still a receipt: the generic wording, nothing adopted.
  const released = await run(command("admin-hold-place"), 7, "place", "Synthetic authority request.", "1790086400");
  // (case 1's receipt in answer to case 2's request is not one; on its own case it is)
  assert.equal(released.state.Feedback.text, "outcome.unknown:");
  const own = caseHarness(() => command("admin-hold-place"), `cas_${"1".padStart(32, "0")}`, 7); own.api.prepareLegalHold(submit); await own.api.executeConfirmed();
  assert.deepEqual(plain(own.state.Feedback), { tone: "success", text: "legalHoldUpdated" }); assert.equal(own.context.data.case.revision, 7);
  // Stale (409) and malformed (422): refusals, worded as every refusal of the page; nothing is adopted or cleared.
  for (const name of ["admin-hold-selected-stale-denied", "admin-hold-selected-malformed-denied", "admin-hold-viewer-denied", "admin-hold-release-open-denied"]) {
    const h = await run(command(name), 1, "place", "Synthetic court order.", "1790172800");
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${command(name).error}` }, name);
    assert.equal(h.context.data.case.revision, 1); assert.equal(h.writes.includes("load"), false); assert.equal(h.writes.includes("HoldReason"), false);
  }
  // A member-case resolution is fenced by the case revision: a refusal is a refusal.
  const resolve = caseHarness(() => fixture("admin-moderation-hold-viewer-denied"));
  resolve.context.confirmed = { kind: "resolve", label: "Dismiss", payload: { case_id: CASE_ID, expected_revision: 7, action: "dismiss", idempotency_key: "dates-case-resolve:00000000-0000-4000-8000-000000000001" } };
  await resolve.api.executeConfirmed();
  assert.equal(resolve.state.Feedback.text, "operationFailed:dates-admin-capability-required");
  // Its receipt is bound since T-891, on Core's genuine pair (command corpus, generator lines 504-510): the answer to this
  // case's dismissal at revision 2 is a receipt; the same answer to another revision or another case is not.
  const dismissal = (revision: number, caseId = `cas_${"4".padStart(32, "0")}`) => ({ kind: "resolve", label: "Dismiss", payload: { case_id: caseId, expected_revision: revision,
    action: "dismiss", reason: "Synthetic review: no violation found.", user_visible_reason_en: "No violation was found.", user_visible_reason_hu: "Nem találtunk szabálysértést.",
    expires_at: null, break_glass: false, idempotency_key: "dates-case-resolve:command-0092" } });
  for (const [confirmed, text, adopted] of [[dismissal(2), "resolved", 3], [dismissal(3), "outcome.unknown:", 2], [dismissal(2, CASE_ID), "outcome.unknown:", 2]] as const) {
    const h = caseHarness(() => command("admin-resolve-dismiss"), confirmed.payload.case_id, 2); h.context.confirmed = confirmed; await h.api.executeConfirmed();
    assert.equal(h.state.Feedback.text, text, JSON.stringify(confirmed.payload).slice(0, 80)); assert.equal(h.context.data.case.revision, adopted);
  }
});

test("trail capture: a lost reply is an unknown outcome; the blind repeat is refused as stale, the same window later is the snapshot that exists", async () => {
  for (const [name, lost, token] of LOST) {
    const model = coreModel(CASE_ID);
    let lose = true;
    const h = caseHarness((action, body) => { const answer = model.answer(action, body); return lose ? lost : answer; });
    await h.api.captureTrailEvidence(submit);
    assert.equal(model.writes.length, 1, `${name}: Core stored the snapshot`);
    const first = h.sent[0].body;
    assert.deepEqual({ ...first, idempotency_key: null }, { case_id: CASE_ID, expected_revision: 7, captured_from: 1789990000, captured_to: 1789993600,
      reason: "Route during the reported incident.", break_glass: false, idempotency_key: null });
    assert.match(first.idempotency_key, /^dates-case-trail-evidence:[0-9a-f-]{36}$/);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}`, refresh: true }, name);
    for (const field of ["TrailFrom", "TrailTo", "TrailReason"]) assert.equal(h.writes.includes(field), false, "the form keeps what was sent");
    // Submitted again without a refresh: a new key, the old revision - refused as stale, no second snapshot.
    lose = false;
    await h.api.captureTrailEvidence(submit);
    assert.notEqual(h.sent[1].body.idempotency_key, first.idempotency_key);
    assert.equal(model.writes.length, 1, `${name}: one snapshot`);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: "operationFailed:dates-admin-stale-revision" });
    // After a refresh, the same window: Core answers with the snapshot that exists, and says so.
    h.context.data = { case: { ...h.context.data.case, revision: model.revision() } };
    await h.api.captureTrailEvidence(submit);
    assert.equal(model.writes.length, 1, `${name}: still one snapshot`);
    assert.deepEqual(plain(h.state.Feedback), { tone: "success", text: "trailEvidenceExisting" });
    for (const field of ["TrailFrom", "TrailTo", "TrailReason"]) assert.equal(h.state[field], "", field);
  }
  // Core's genuine answers (command corpus, generator lines 422-428 and 518-522), each to the request the page builds.
  const CASE_3 = `cas_${"3".padStart(32, "0")}`;
  for (const [name, revision, from, text, adopted] of [["admin-trail-selected-capture", 2, "1789999700", "trailEvidenceCaptured", 3],
    ["admin-trail-selected-capture-replay", 2, "1789999700", "trailEvidenceCaptured", 3], ["admin-trail-selected-existing", 3, "1789999700", "trailEvidenceExisting", 3],
    ["admin-trail-capture", 1, "1789999400", "trailEvidenceCaptured", 1], ["admin-trail-capture-existing", 2, "1789999400", "trailEvidenceCaptured", 2]] as const) {
    const h = caseHarness(() => command(name), CASE_3, revision);
    Object.assign(h.context, { trailFrom: from, trailTo: "1789999940", trailReason: "Synthetic incident window." });
    await h.api.captureTrailEvidence(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "success", text }, name);
    assert.equal(h.context.data.case.revision, adopted, `${name}: adopted (the released shape names no revision)`);
  }
  // Refusals answer the request.
  for (const name of ["admin-trail-capture-stale-denied", "admin-trail-capture-viewer-denied", "admin-trail-selected-version-denied"]) {
    const h = caseHarness(() => command(name)); await h.api.captureTrailEvidence(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${command(name).error}` }, name);
  }
  // An invalid window never becomes a command.
  const invalid = caseHarness(() => assert.fail("not sent")); invalid.context.trailTo = "1789980000";
  await invalid.api.captureTrailEvidence(submit); assert.equal(invalid.sent.length, 0); assert.equal(invalid.state.Feedback.text, "trailEvidenceInputInvalid");
});

test("a revision-fenced case command is worded as unknown when nothing says whether it landed, and its refusals stay refusals", async () => {
  const note = fixture("admin-moderation-claim");
  for (const [name, lost, token] of LOST) {
    const h = caseHarness(() => lost); await h.api.addNote(submit);
    // Wording only (review finding): the message, with the operator's own "Refresh the case" beside it - and nothing else.
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}`, refresh: true }, name);
    // No reread: `load()` would clear the evidence that was read, the principal, the confirmation, the break-glass choice
    // and the sensitive-evidence selection, and under a continuing outage put the load-error surface in the page's place.
    assert.equal(h.writes.includes("load"), false, "the page does not reread by itself");
    assert.deepEqual(h.writes.filter((name) => !["Evidence", "Busy", "Feedback"].includes(name)), [], "no other state is written");
    assert.deepEqual(h.writes.filter((name) => name === "Evidence").length, 1, "only what every command did before: the evidence view is closed when a command starts");
    assert.equal(h.writes.includes("Note"), false, "what the operator typed stays");
    assert.equal(h.writes.includes("Data"), false, "nothing is adopted without a receipt");
  }
  // Core's genuine refusals answer the request: the wording and the behaviour are what they were.
  for (const name of ["admin-moderation-revision-stale-denied", "admin-moderation-hold-viewer-denied", "admin-moderation-key-conflict-denied"]) {
    const body = fixture(name), h = caseHarness(() => body); await h.api.addNote(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${body.error}` }); assert.equal(h.writes.includes("load"), false);
  }
  // A receipt of another command is not a receipt (the genuine claim receipt in answer to a note).
  const wrong = caseHarness(() => note); await wrong.api.addNote(submit);
  assert.equal(wrong.state.Feedback.text, "outcome.unknown:");
  // The reread is the operator's: one button beside the message, and `mutate` itself calls `load()` only after a receipt.
  assert.match(casePage.source, /\{feedback\.refresh && <> <button type="button" className="button button-secondary button-small" disabled=\{busy\} onClick=\{\(\) => void load\(\)\}>\{commandOutcome\("refreshCase"\)\}<\/button><\/>\}/);
  const mutateSource = casePage.text("mutate");
  assert.equal((mutateSource.match(/await load\(\)/g) ?? []).length, 1, "after success only");
  assert.ok(mutateSource.indexOf("await load()") > mutateSource.indexOf('setFeedback({ tone: "success"'));
  // Since T-891 every command of the page is fenced by the case revision: each attempt carries its own key, and nothing
  // is kept for a same-request retry any more (the interim re-offer of the hold and the capture is retired).
  assert.doesNotMatch(casePage.source, /"kept"|DatesUnansweredCommand|holdCommand|trailCommand|retryLegalHold|sendTrailEvidence/);
  assert.match(casePage.source, /const outcome = datesCommandOutcome\(response, settled !== null, "fresh"\);/);
  assert.match(casePage.text("prepareLegalHold"), /expected_revision: data\.case\.revision,/);
  assert.throws(() => readFileSync(new URL("../components/DatesUnansweredCommand.tsx", import.meta.url)), /ENOENT/);
  assert.doesNotMatch(casePage.source, /KeptCommand|sessionStorage|localStorage|setItem|removeItem/);
  assert.throws(() => readFileSync(new URL("../lib/datesKeptCommand.ts", import.meta.url)), /ENOENT/);
});

// ---------------------------------------------------------------- the activity page

const activityPage = functionsOf("../app/(dashboard)/dates/[activityId]/page.tsx", "DatesActivityDetailPage");
const activityCode = compile(`${["reportFailure", "executeCommand", "requestTransfer", "adoptActivityRevision"].map(activityPage.text).join("\n")}
  exports.executeCommand = executeCommand; exports.requestTransfer = requestTransfer;`);
const ACTIVITY_ID = "act_" + "0".repeat(31) + "2";

/**
 * TRANSCRIBED from Core main 07215298, DatesAdminActivityService::command (411-640): the write is a replace with
 * `revision: expected` in its selector, so a repeat under a new key after a landed write is `dates-admin-stale-revision`.
 */
function activityModel(revision: number) {
  const writes: string[] = [];
  return { writes, answer(body: Record<string, any>) {
    if (body.expected_revision !== revision) return core("dates-admin-stale-revision", 409);
    revision++; writes.push(body.idempotency_key);
    // Core's genuine receipt of a member activity's end (T-891 corpus), for this activity and revision.
    return { ...command("admin-activity-end"), activity_id: body.activity_id, revision };
  } };
}
function activityHarness(reply: (action: string, body: Record<string, any>) => unknown) {
  const sent: Array<{ action: string; body: Record<string, any> }> = [], state: Record<string, any> = {}, writes: string[] = [];
  const context: any = { exports: {}, busy: false, activityId: ACTIVITY_ID,
    data: { activity: { activity_id: ACTIVITY_ID, revision: 4, host: { uid: 7 } } }, pendingCommand: { action: "end", reason: "Reported as over." },
    transferUid: "42", transferReason: "The host asked for it.", datesCommandOutcome, datesActivityCommandReceipt, datesActivityUpdateReceipt, datesHostTransferReceipt,
    createAdminIdempotencyKey, t: translator(""), commandOutcome: translator("outcome."),
    load: async () => { writes.push("load"); }, window: { location: { assign: (target: string) => { writes.push(`go:${target}`); } } },
    adminCall: async (action: string, body: Record<string, any>) => { sent.push({ action, body: plain(body) }); return reply(action, plain(body)); } };
  for (const name of ["Busy", "Feedback", "PendingCommand", "CommandReason", "TransferUid", "TransferReason"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); };
  context.setData = (update: unknown) => { context.data = typeof update === "function" ? (update as (value: unknown) => unknown)(context.data) : update; writes.push("Data"); };
  vm.runInNewContext(activityCode, context);
  return { context, state, writes, sent, api: context.exports as Record<string, (...values: any[]) => Promise<any>> };
}

test("activity commands: a lost reply is an unknown outcome, and Core's revision keeps the blind repeat from writing twice", async () => {
  for (const [name, lost, token] of LOST) {
    if (lost instanceof Error) continue; // adminCall never throws: it answers null
    const model = activityModel(4);
    // Since T-891 an unreadable success is no receipt here either: it is one of the replies that leave the outcome unknown.
    let lose = true;
    const h = activityHarness((_action, body) => { const answer = model.answer(body); return lose ? lost : answer; });
    await h.api.executeCommand();
    assert.equal(model.writes.length, 1);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}` }, name);
    assert.equal(h.writes.includes("load"), false, "the page is not read again by itself: that would discard the edit form");
    // The operator repeats it without refreshing: a new key, the old revision - Core refuses it, and says why.
    lose = false; h.context.pendingCommand = { action: "end", reason: "Reported as over." };
    await h.api.executeCommand();
    assert.equal(model.writes.length, 1, `${name}: no second write`);
    assert.notEqual(h.sent[1].body.idempotency_key, h.sent[0].body.idempotency_key);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: "operationFailed:dates-admin-stale-revision" });
  }
  // Core's genuine answers to the genuine requests (T-891 corpus, generator lines 443-461): receipts; a receipt of another
  // activity or revision is not one; and refusals that are worded as they were.
  const onActivity = (number: number, revision: number, action: string, reply: unknown) => {
    const h = activityHarness(() => reply);
    h.context.data = { activity: { activity_id: `act_${number.toString(16).padStart(32, "0")}`, revision, host: { uid: 7 } } };
    h.context.pendingCommand = { action, reason: "Synthetic." };
    return h;
  };
  const done = onActivity(12, 1, "end", command("admin-activity-end")); await done.api.executeCommand();
  assert.deepEqual(plain(done.state.Feedback), { tone: "success", text: "commandDone" }); assert.ok(done.writes.includes("load"));
  for (const [number, revision, action, name] of [[13, 1, "cancel", "admin-activity-cancel"], [14, 1, "soft_delete", "admin-activity-soft-delete"],
    [14, 2, "restore", "admin-activity-restore"]] as const) {
    const h = onActivity(number, revision, action, command(name)); await h.api.executeCommand();
    assert.equal(h.state.Feedback.text, "commandDone", name);
  }
  const purged = onActivity(14, 4, "purge", command("admin-activity-purge")); await purged.api.executeCommand(); assert.ok(purged.writes.includes("go:/dates"));
  // The purge receipt of another activity does not take the operator away from this one.
  const elsewhere = onActivity(15, 4, "purge", command("admin-activity-purge")); await elsewhere.api.executeCommand();
  assert.equal(elsewhere.writes.includes("go:/dates"), false); assert.equal(elsewhere.state.Feedback.text, "outcome.unknown:");
  const misbound = onActivity(12, 2, "end", command("admin-activity-end")); await misbound.api.executeCommand();
  assert.equal(misbound.state.Feedback.text, "outcome.unknown:", "a receipt one revision off is not this command's");
  for (const name of ["admin-activity-command-stale-denied", "admin-activity-command-viewer-denied", "admin-activity-purge-hold-denied"]) {
    const body = fixture(name), h = activityHarness(() => body); await h.api.executeCommand();
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${body.error}` }, name);
  }
  assert.match(activityPage.source, /datesCommandOutcome\(response, datesActivityUpdateReceipt\(response, request\), "fresh"\)/);
  assert.match(activityPage.source, /datesCommandOutcome\(response, datesActivityCommandReceipt\(response, request\), "fresh"\)/);
  assert.match(activityPage.source, /const response = await adminCall\("dates_activity_update", request\);/);
  assert.match(activityPage.source, /const response = await adminCall\("dates_activity_command", request\);/);
});

/**
 * A host-transfer request as Core T-891 does it (Core claude/core-hardening-20261002 33265e46, the Core lane's hand-over
 * and its genuine bodies). Same key: the stored receipt. A new key: `expected_revision` must be the activity revision
 * (else `dates-stale-revision`). The request moves the activity revision, and so do a decline, an expiry and a cancel -
 * so a request repeated with the revision it was first sent with is stale whatever became of the first transfer.
 */
function transferModel(revision: number) {
  const receipts = new Map<string, Record<string, unknown>>(), inserted: string[] = [];
  let pending = false, sequence = 0;
  return { inserted, revision: () => revision, decline() { pending = false; revision++; }, answer(body: Record<string, any>) {
    const replay = receipts.get(body.idempotency_key);
    if (replay) return { ...replay, idempotency_replayed: true };
    if (body.expected_revision !== revision) return core("dates-stale-revision", 409);
    if (pending) return core("dates-host-transfer-already-pending", 409);
    pending = true; revision++; inserted.push(body.idempotency_key);
    // Core's genuine receipt with the command contract selector, for this activity and target.
    const receipt = { ...command("admin-host-transfer-selected"), transfer_id: `trf_${(++sequence).toString(16).padStart(32, "0")}`, activity_id: body.activity_id,
      target_uid: body.target_uid, activity_revision: revision };
    receipts.set(body.idempotency_key, receipt);
    return receipt;
  } };
}

test("host transfer (T-891): a lost reply is an unknown outcome; repeated with the old revision it is refused as stale - one transfer", async () => {
  for (const [name, lost, token] of LOST) {
    if (lost instanceof Error) continue; // adminCall never throws: it answers null
    const model = transferModel(4);
    let lose = true;
    const h = activityHarness((_action, body) => { const answer = model.answer(body); return lose ? lost : answer; });
    await h.api.requestTransfer(submit);
    assert.equal(model.inserted.length, 1, `${name}: Core created the transfer`);
    const first = h.sent[0].body;
    assert.deepEqual({ ...first, idempotency_key: null }, { activity_id: ACTIVITY_ID, target_uid: 42, expected_revision: 4, reason: "The host asked for it.", idempotency_key: null });
    assert.match(first.idempotency_key, /^dates-host-transfer:[0-9a-f-]{36}$/);
    // Worded like every revision-fenced command: not known, check before repeating. Nothing is kept or offered again.
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}` }, name);
    for (const field of ["TransferUid", "TransferReason"]) assert.equal(h.writes.includes(field), false, "the form keeps what was sent");
    assert.equal(h.writes.includes("load"), false);
    // The target declines meanwhile - the case in which Core main would have created a second transfer. The form sent
    // again is a new key with the revision the page had read: Core refuses it as stale.
    model.decline(); lose = false;
    await h.api.requestTransfer(submit);
    assert.notEqual(h.sent[1].body.idempotency_key, first.idempotency_key);
    assert.equal(model.inserted.length, 1, `${name}: one transfer`);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: "operationFailed:dates-stale-revision" });
  }
  // Core's genuine answers (command corpus, generator lines 466-471 and 528-531), each to the request the page builds.
  for (const [name, number, target, adopted] of [["admin-host-transfer-selected", 16, "70316", 2], ["admin-host-transfer-selected-replay", 16, "70316", 2],
    ["admin-host-transfer", 15, "70315", 1], ["admin-host-transfer-replay", 15, "70315", 1]] as const) {
    const h = activityHarness(() => command(name));
    h.context.data = { activity: { activity_id: `act_${number.toString(16).padStart(32, "0")}`, revision: 1, host: { uid: 7 } } }; h.context.activityId = h.context.data.activity.activity_id;
    Object.assign(h.context, { transferUid: target, transferReason: "Synthetic transfer to the confirmed participant." });
    await h.api.requestTransfer(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "success", text: "transferRequested" }, name);
    // With the selector the activity revision the request left is adopted; the released shape names none.
    assert.equal(h.context.data.activity.revision, adopted, name); assert.ok(h.writes.includes("load"), name);
    for (const field of ["TransferUid", "TransferReason"]) assert.equal(h.state[field], "", field);
  }
  // A receipt of another activity or target is not this request's; refusals answer the request.
  const other = activityHarness(() => command("admin-host-transfer-selected")); await other.api.requestTransfer(submit);
  assert.equal(other.state.Feedback.text, "outcome.unknown:"); assert.equal(other.context.data.activity.revision, 4);
  for (const name of ["admin-host-transfer-stale-denied", "admin-host-transfer-administrator-denied"]) {
    const h = activityHarness(() => command(name)); await h.api.requestTransfer(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${command(name).error}` }, name);
  }
  // A running request is not doubled.
  const running = activityHarness(() => assert.fail("not sent")); running.context.busy = true;
  await running.api.requestTransfer(submit); assert.equal(running.sent.length, 0);
  // The page: no re-offer, nothing stored, the bound receipt and the fresh identity.
  assert.doesNotMatch(activityPage.source, /transferCommand|sendTransfer|DatesUnansweredCommand|"kept"|sessionStorage|localStorage|setItem/);
  assert.match(activityPage.source, /const outcome = datesCommandOutcome\(response, receipt !== null, "fresh"\);/);
  assert.match(activityPage.source, /const receipt = datesHostTransferReceipt\(response, request\);/);
});

// ---------------------------------------------------------------- the configuration page

const configuration = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
function editorSave(component: string) {
  const tree = ts.createSourceFile("page.tsx", configuration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === component);
  assert.ok(editor?.body);
  const functions = editor.body.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ["save", "showEntryPointsError", "deactivate"].includes(node.name?.text ?? ""));
  return compile(`${functions.map((node) => node.getText(tree)).join("\n")}\nexports.save = save; exports.deactivate = typeof deactivate === "function" ? deactivate : null;`);
}

/**
 * TRANSCRIBED from Core main 07215298, DatesReasonAdminService::save (105-217): the reason's id is `reason_<scope>_<key>`;
 * a save without `expected_revision` creates it, and when the row already exists that same save is refused as
 * `dates-admin-stale-revision` (162-168). Creating a reason is therefore fenced by its own existence.
 */
function reasonModel() {
  const rows = new Map<string, number>(), writes: string[] = [];
  return { writes, answer(body: Record<string, any>) {
    const id = `reason_${body.scope}_${body.key}`, current = rows.get(id);
    if (current === undefined ? Object.hasOwn(body, "expected_revision") : body.expected_revision !== current) return core("dates-admin-stale-revision", 409);
    rows.set(id, (current ?? 0) + 1); writes.push(body.idempotency_key);
    return { success: true };
  } };
}

test("configuration saves: a lost reply is an unknown outcome; creating a reason twice is refused by Core, not written twice", async () => {
  const reasonCode = editorSave("ReasonEditor");
  function reasonHarness(reply: (body: Record<string, any>) => unknown) {
    const sent: Array<Record<string, any>> = [], errors: unknown[] = [], unknown: Array<string | null> = []; let saved = 0;
    const context: any = { exports: {}, reason: null, scope: "activity", keyName: "Wrong_Details", nameEn: "Wrong details", nameHu: "Hibás adatok", explanationEn: "", explanationHu: "",
      severity: "medium", order: "10", active: true, commentRequired: false, entryPoints: "detail", escalationCategory: "", auditReason: "A reason members asked for.", canManage: true,
      busy: false, allowedEntryPoints: "detail", datesReasonEntryPoints, datesReasonEntryPointsRefused, datesCommandOutcome, datesReasonDeactivateReceipt, createAdminIdempotencyKey, t: translator(""),
      // The receipt check itself is covered on Core's genuine bodies in tests/datesExternalReasons.test.mts.
      datesReasonSaveReceipt: (value: any) => value?.success === true ? value : null,
      setBusy: () => {}, setEntryPointsError: () => {}, onInlineError: () => {}, onError: (error: unknown) => errors.push(error), onUnknown: (error: string | null) => unknown.push(error),
      onSaved: async () => { saved++; }, adminCall: async (_action: string, body: Record<string, any>) => { sent.push(plain(body)); return reply(plain(body)); } };
    vm.runInNewContext(reasonCode, context);
    return { sent, errors, unknown, context, saved: () => saved, save: () => context.exports.save(submit), deactivate: () => context.exports.deactivate() };
  }
  for (const [name, lost, token] of LOST) {
    // adminCall never throws. The reason save HAS a receipt check; this harness stands in a permissive one, and the
    // unreadable success is tested with the real decoder on Core's genuine bodies in tests/datesExternalReasons.test.mts.
    if (lost instanceof Error || (lost as any)?.success === true) continue;
    const model = reasonModel();
    let lose = true;
    const h = reasonHarness((body) => { const answer = model.answer(body); return lose ? lost : answer; });
    await h.save();
    assert.equal(model.writes.length, 1, `${name}: Core created the reason`);
    assert.deepEqual(h.unknown, [token], name);
    assert.deepEqual(h.errors, []); assert.equal(h.saved(), 0);
    assert.equal(Object.hasOwn(h.sent[0], "expected_revision"), false, "a new reason carries no revision");
    assert.equal(h.sent[0].key, "wrong_details");
    // The blind repeat: a new key, still no revision. Core refuses it because the reason exists; nothing is written twice.
    lose = false;
    await h.save();
    assert.equal(model.writes.length, 1, `${name}: no second write`);
    assert.notEqual(h.sent[1].idempotency_key, h.sent[0].idempotency_key);
    assert.deepEqual(h.errors, ["dates-admin-stale-revision"]);
  }
  // Core's genuine capability refusal stays a refusal; a first save that Core answers is saved.
  const viewer = reasonHarness(() => fixture("admin-reason-save-viewer-denied")); await viewer.save();
  assert.deepEqual(viewer.errors, ["dates-admin-capability-required"]); assert.deepEqual(viewer.unknown, []);
  const model = reasonModel(), ok = reasonHarness((body) => model.answer(body)); await ok.save();
  assert.equal(ok.saved(), 1); assert.deepEqual([ok.errors, ok.unknown], [[], []]);

  // The setting and the activity-type saves, and the reason's deactivation, read a reply the same way. Their receipts are
  // bound since T-891: the genuine pairs below are Core's (command corpus, generator lines 476-496).
  const settingCode = editorSave("SettingEditor");
  const SLA = { key: "dates_report_sla_hours", revision: 1 }, FIRST = { key: "dates_reinvite_cooldown_hours", revision: 0 };
  for (const [reply, expected, setting] of [[null, { unknown: [null], errors: [], saved: 0 }, SLA], [bridge("core-timeout", 504), { unknown: ["core-timeout"], errors: [], saved: 0 }, SLA],
    [core("dates-admin-unavailable", 503), { unknown: ["dates-admin-unavailable"], errors: [], saved: 0 }, SLA],
    [command("admin-configuration-save-stale-denied"), { unknown: [], errors: ["dates-admin-stale-revision"], saved: 0 }, SLA],
    [core("dates-configuration-value-invalid", 422), { unknown: [], errors: ["dates-configuration-value-invalid"], saved: 0 }, SLA],
    // An unreadable success is no receipt: the outcome is not known.
    [{ success: true }, { unknown: [null], errors: [], saved: 0 }, SLA],
    // Core's genuine receipts, each to its own request - an existing row (1 -> 2) and the first save of a setting (0 -> 1).
    [command("admin-configuration-save"), { unknown: [], errors: [], saved: 1 }, SLA],
    [command("admin-configuration-save-first"), { unknown: [], errors: [], saved: 1 }, FIRST],
    [command("admin-configuration-save-first-replay"), { unknown: [], errors: [], saved: 1 }, FIRST],
    // ... and to a request it does not answer: another setting, or the revision the editor had read is another.
    [command("admin-configuration-save"), { unknown: [null], errors: [], saved: 0 }, FIRST],
    [command("admin-configuration-save"), { unknown: [null], errors: [], saved: 0 }, { key: SLA.key, revision: 2 }],
    // Core's genuine refusals of the route: refusals, not unknown outcomes.
    [command("admin-configuration-save-viewer-denied"), { unknown: [], errors: ["dates-admin-capability-required"], saved: 0 }, SLA],
    [intake("admin-configuration-save-released-console-denied"), { unknown: [], errors: ["dates-configuration-key-invalid"], saved: 0 }, SLA],
    [intake("admin-configuration-save-consent-text-missing-denied"), { unknown: [], errors: ["dates-configuration-value-invalid"], saved: 0 }, SLA]] as const) {
    const run = async (key: string, revision: number) => {
      const errors: unknown[] = [], unknown: Array<string | null> = [], problems: string[] = [], sent: Array<Record<string, unknown>> = []; let saved = 0;
      const context: any = { exports: {}, editable: true, reason: "Raised after the pilot.", busy: false, value: "12", items: [], setting: { key, type: "integer", revision },
        DATES_AI_MODEL_SETTING_KEYS: [], datesModelIdValid: () => true, datesStringListProblem: () => null, configurationInputValue: (_type: string, value: string) => Number(value),
        DATES_CONSENT_VERSION_SETTING: "dates_event_suggestion_consent_version",
        datesCommandOutcome, datesSettingSaveReceipt, createAdminIdempotencyKey, t: translator(""), setProblem: (text: string) => { if (text !== "") problems.push(text); }, setBusy: () => {},
        adminCall: async (_action: string, body: Record<string, unknown>) => { sent.push(plain(body)); return reply; },
        onError: (error: unknown) => errors.push(error), onUnknown: (error: string | null) => unknown.push(error), onSaved: async () => { saved++; } };
      vm.runInNewContext(settingCode, context);
      await context.exports.save(submit);
      assert.deepEqual({ ...sent[0], idempotency_key: null }, { key, value: 12, expected_revision: revision, reason: "Raised after the pilot.", idempotency_key: null });
      return { unknown, errors, saved, problems };
    };
    const { problems, ...outcome } = await run(setting.key, setting.revision);
    assert.deepEqual(outcome, expected, JSON.stringify(reply)); assert.deepEqual(problems, []);
    // The consent version: Core's `value-invalid` there means "this version has no text in this release", and is said
    // so beside the field instead of as a bare token. Every other refusal or unknown outcome of that setting reads as
    // above; a receipt of another setting is, there too, not this save's.
    const consent = await run("dates_event_suggestion_consent_version", setting.revision), noText = (expected.errors as readonly string[]).includes("dates-configuration-value-invalid");
    assert.deepEqual(consent, noText ? { unknown: [], errors: [], saved: 0, problems: ["consentVersionNoText"] }
      : expected.saved === 1 ? { unknown: [null], errors: [], saved: 0, problems: [] } : { ...expected, problems: [] }, JSON.stringify(reply));
  }
  // The activity type and the reason's deactivation, on their genuine pairs.
  const typeCode = editorSave("ActivityTypeEditor");
  for (const [reply, revision, expected] of [[command("admin-activity-type-save"), 1, { unknown: [], errors: [], saved: 1 }],
    [command("admin-activity-type-save-replay"), 1, { unknown: [], errors: [], saved: 1 }], [command("admin-activity-type-save"), 2, { unknown: [null], errors: [], saved: 0 }],
    [{ success: true }, 1, { unknown: [null], errors: [], saved: 0 }], [command("admin-activity-type-save-stale-denied"), 1, { unknown: [], errors: ["dates-admin-stale-revision"], saved: 0 }]] as const) {
    const errors: unknown[] = [], unknown: Array<string | null> = []; let saved = 0;
    const context: any = { exports: {}, activityType: { key: "sport", revision }, retired: false, nameEn: "Sports activity", nameHu: "Sportprogram", order: "5", active: true,
      reason: "Synthetic label correction.", busy: false, datesCommandOutcome, datesActivityTypeSaveReceipt, createAdminIdempotencyKey, setBusy: () => {},
      adminCall: async () => reply, onError: (error: unknown) => errors.push(error), onUnknown: (error: string | null) => unknown.push(error), onSaved: async () => { saved++; } };
    vm.runInNewContext(typeCode, context); await context.exports.save(submit);
    assert.deepEqual({ unknown, errors, saved }, expected, `type ${JSON.stringify(reply).slice(0, 60)} at ${revision}`);
  }
  for (const [reply, reasonId, expected] of [[command("admin-reason-deactivate"), "reason_activity_fixture_one", { unknown: [], errors: [], saved: 1 }],
    [command("admin-reason-deactivate-replay"), "reason_activity_fixture_one", { unknown: [], errors: [], saved: 1 }],
    [command("admin-reason-deactivate"), "reason_activity_fixture_two", { unknown: [null], errors: [], saved: 0 }],
    [{ success: true }, "reason_activity_fixture_one", { unknown: [null], errors: [], saved: 0 }],
    [command("admin-reason-deactivate-stale-denied"), "reason_activity_fixture_one", { unknown: [], errors: ["dates-admin-stale-revision"], saved: 0 }]] as const) {
    const h = reasonHarness(() => reply);
    h.context.reason = { reason_id: reasonId, revision: 1, active: true }; h.context.auditReason = "Synthetic retirement of a reason.";
    await h.deactivate();
    assert.deepEqual({ unknown: h.unknown, errors: h.errors, saved: h.saved() }, expected, `deactivate ${reasonId}`);
  }
  assert.match(configuration, /const DATES_CONSENT_VERSION_SETTING = "dates_event_suggestion_consent_version";/);
  assert.equal(intake("admin-configuration-save-consent-text-missing-denied").error, "dates-configuration-value-invalid");
  for (const check of ["datesSettingSaveReceipt", "datesActivityTypeSaveReceipt", "datesReasonDeactivateReceipt"])
    assert.ok(configuration.includes(`datesCommandOutcome(response, ${check}(response, request), "fresh")`), check);
  assert.equal((configuration.match(/onError=\{failure\} onUnknown=\{unknown\}/g) ?? []).length, 4, "every editor reports an unknown outcome");
  assert.match(configuration, /function unknown\(error: string \| null\) \{\s+setFeedback\(\{ tone: "error", text: commandOutcome\(error === null \? "unknown" : "unknownAnswered", \{ error: error \?\? "" \}\) \}\);\s+\}/);
  assert.doesNotMatch(configuration, /"kept"/);
});

// ---------------------------------------------------------------- receipts

test("review finding: a success body is a receipt only where a check proven on genuine Core bodies exists - since T-891 on every route", () => {
  // The list of routes taken on the bare success flag is EMPTY: the seven that were on it have checks proven on Core's
  // genuine request / answer pairs (tests/datesAdminCommandWire.test.mts), and the stand-in itself is gone.
  assert.deepEqual([...DATES_RECEIPT_CHECKS_PENDING], []);
  assert.doesNotMatch(readFileSync(new URL("../lib/datesExternalAdmin.ts", import.meta.url), "utf8"), /datesUncheckedReceipt/);
  const files = ["../app/(dashboard)/dates/[activityId]/page.tsx", "../app/(dashboard)/dates/configuration/page.tsx", "../app/(dashboard)/dates/moderation/[caseId]/page.tsx"];
  const pages = files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(pages, /datesUncheckedReceipt|datesCommandOutcome\(response, response\?\.success|datesCommandOutcome\(response, true/);
  // Each command of the three pages names its bound check at the one place it classifies a reply.
  for (const call of ["datesActivityUpdateReceipt(response, request)", "datesActivityCommandReceipt(response, request)", "datesHostTransferReceipt(response, request)",
    "datesSettingSaveReceipt(response, request)", "datesActivityTypeSaveReceipt(response, request)", "datesReasonDeactivateReceipt(response, request)",
    "datesCaseResolutionReceipt(response, payload)", "datesLegalHoldCommandReceipt(response, payload)", "datesTrailEvidenceCommandReceipt(response, payload)"])
    assert.equal(pages.split(call).length - 1, 1, call);
  // Every `datesCommandOutcome(` of the three pages gets a check's verdict (or the moderation page's `receipt`, chosen per route).
  for (const match of pages.matchAll(/datesCommandOutcome\(response, (.+?), (?:"fresh"|"kept"|identity)\);/g))
    assert.match(match[1], /^(datesActivityUpdateReceipt|datesActivityCommandReceipt|datesHostTransferReceipt|datesSettingSaveReceipt|datesActivityTypeSaveReceipt|datesReasonDeactivateReceipt|receipt !== null$|settled !== null$|Boolean\(response\?\.success && datesReasonSaveReceipt)/, match[0]);
  assert.equal((pages.match(/datesCommandOutcome\(/g) ?? []).length, 8, "the eight classified replies of the three pages");
  assert.equal([...pages.matchAll(/datesCommandOutcome\(response, (.+?), (?:"fresh"|"kept"|identity)\);/g)].length, 8, "each of them read above");

  // Where a check exists it is proven on Core's genuine bodies and binds on what identifies the command, and a success
  // body that fails it is "not known": never a failure, never a success. (The two released P1 decoders below are
  // exact-key-set checks; the checks still to be written for the listed routes are to tolerate additional keys.)
  const place = fixture("admin-moderation-hold-place"), release = fixture("admin-moderation-hold-release");
  assert.equal(datesLegalHoldReceipt(place, place.case_id, "place", place.review_at), true);
  assert.equal(datesLegalHoldReceipt(release, release.case_id, "release", null), true);
  for (const [body, action, reviewAt] of [[{ success: true }, "place", place.review_at], [{ ...place, case_id: "cas_" + "f".repeat(32) }, "place", place.review_at],
    [place, "release", null], [{ ...place, review_at: place.review_at + 1 }, "place", place.review_at], [release, "place", place.review_at]] as const) {
    assert.equal(datesLegalHoldReceipt(body, place.case_id, action, reviewAt), false);
    assert.deepEqual(datesCommandOutcome(body, datesLegalHoldReceipt(body, place.case_id, action, reviewAt), "kept"), { kind: "uncertain", error: null });
  }
  for (const name of ["admin-claim", "admin-heartbeat", "admin-release", "admin-note", "admin-escalate"]) {
    const body = JSON.parse(readFileSync(new URL(`./fixtures/dates_moderation_console_wire/${name}.json`, import.meta.url), "utf8"));
    const action = `dates_moderation_${name.slice("admin-".length)}`;
    assert.ok(datesConsoleCommandReceipt(body, action, body.case_id, body.revision - 1), name);
    assert.equal(datesConsoleCommandReceipt({ success: true }, action, body.case_id, body.revision - 1), null, name);
    assert.deepEqual(datesCommandOutcome({ success: true }, false, "fresh"), { kind: "uncertain", error: null });
  }
});

// ---------------------------------------------------------------- copy

test("the unknown-outcome copy exists in both languages; the re-offer's copy is gone with it", () => {
  for (const locale of ["en", "hu"]) {
    const copy = messagesOf(locale).datesAdmin.commandOutcome;
    assert.deepEqual(Object.keys(copy), ["unknown", "unknownAnswered", "refreshCase"], locale);
    assert.match(copy.unknownAnswered, /\{error\}/, `${locale}.unknownAnswered`);
    for (const key of ["unknown", "refreshCase"]) assert.doesNotMatch(copy[key], /\{/, `${locale}.${key}`);
    // What a hold and a capture can now say they did (T-891).
    const detail = messagesOf(locale).datesAdmin.caseDetail;
    for (const key of ["legalHoldPlaced", "legalHoldAmended", "legalHoldReleased", "legalHoldAlreadyInPlace", "legalHoldNothingHeld", "trailEvidenceExisting"])
      assert.ok(detail[key].length > 10 && !detail[key].includes("{"), `${locale}.${key}`);
  }
  assert.notEqual(messagesOf("en").datesAdmin.commandOutcome.unknown, messagesOf("hu").datesAdmin.commandOutcome.unknown);
  assert.match(messagesOf("en").datesAdmin.caseDetail.legalHoldAlreadyInPlace, /already in place/);
  assert.match(messagesOf("en").datesAdmin.caseDetail.legalHoldNothingHeld, /Nothing was held/);
  assert.match(messagesOf("en").datesAdmin.caseDetail.trailEvidenceExisting, /already captured/);
});

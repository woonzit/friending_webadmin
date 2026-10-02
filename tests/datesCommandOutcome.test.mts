import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import ts from "typescript";
import DatesUnansweredCommand from "../components/DatesUnansweredCommand.tsx";
import { createAdminIdempotencyKey, datesReasonEntryPoints, datesReasonEntryPointsRefused } from "../lib/datesAdmin.ts";
import { datesCommandOutcome, datesExternalRefusal } from "../lib/datesExternalAdmin.ts";
import { prepareDatesKeptCommand, readDatesKeptCommand, runDatesKeptCommand } from "../lib/datesKeptCommand.ts";
import { DatesCaseReadFence, datesConsoleCommandReceipt, datesTrailEvidenceReceipt, isDatesConsoleCommand } from "../lib/datesModerationRead.ts";

// T-890: what a reply means for the commands of the Dates console that do not
// go through the publication journal, and what the three pages do with it.
// The pages' own functions are extracted from their source and run with React
// state replaced by recorders; `adminCall` is a stand-in for the bridge. Core
// is a small model TRANSCRIBED from Core main 07215298 (named where it is
// defined). No browser, no mounted page, no Core process.
const P1 = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, P1), "utf8"));
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

test("the trail capture's receipt is bound to its case and its window", () => {
  // TRANSCRIBED from DatesTrailEvidenceService::capture's return (Core main 07215298); no genuine body of this route is vendored.
  const receipt = { success: true, status_code: 200, case_id: "cas_" + "0".repeat(31) + "1", activity_id: "act_" + "0".repeat(31) + "2", evidence_id: "evi_" + "0".repeat(31) + "3",
    captured_from: 1789990000, captured_to: 1789993600, point_count: 12, audit_id: "aud_" + "0".repeat(31) + "4", break_glass_used: false, idempotency_replayed: false,
    server_now: 1790000000, message: 200, status: 200, can_send: 0 };
  assert.equal(datesTrailEvidenceReceipt(receipt, receipt.case_id, 1789990000, 1789993600), true);
  assert.equal(datesTrailEvidenceReceipt({ ...receipt, idempotency_replayed: true }, receipt.case_id, 1789990000, 1789993600), true);
  for (const change of [{ success: false }, { status_code: 409 }, { case_id: "cas_" + "f".repeat(32) }, { evidence_id: "evi_1" }, { evidence_id: null }, { audit_id: "" },
    { captured_from: 1789990001 }, { captured_to: 1789993601 }])
    assert.equal(datesTrailEvidenceReceipt({ ...receipt, ...change }, receipt.case_id, 1789990000, 1789993600), false, JSON.stringify(change));
  for (const value of [null, "ok", [], { success: true }]) assert.equal(datesTrailEvidenceReceipt(value, receipt.case_id, 1789990000, 1789993600), false);
  assert.equal(datesTrailEvidenceReceipt(receipt, receipt.case_id, "1789990000", 1789993600), false);
});

// ---------------------------------------------------------------- Core, as far as these commands go

/**
 * TRANSCRIBED from Core main 07215298. `DatesAdminIdempotencyService::execute` (lines 42-97): a command row keyed by
 * (actor, operation, key); an existing completed row is replayed when the payload hash matches, refused as
 * `dates-admin-idempotency-conflict` when it does not; otherwise the callback runs and its result is stored.
 * `legalHold` (DatesModerationCommandService 478-626) and `capture` (DatesTrailEvidenceService 19-232) have no
 * compare-and-set of their own: under a NEW key each runs again - a second hold write with a new `hold_started_at`
 * and a second audit row, or a second evidence snapshot. `capture` checks the case revision but does not move it.
 */
function coreModel(caseId: string) {
  const commands = new Map<string, { hash: string; result: Record<string, unknown> }>();
  const writes: Array<{ operation: string; key: string }> = [];
  let sequence = 0;
  const hex = (prefix: string) => `${prefix}_${(++sequence).toString(16).padStart(32, "0")}`;
  function answer(action: string, body: Record<string, any>): Record<string, unknown> {
    const operation = action === "dates_moderation_legal_hold" ? "moderation.case.legal_hold" : "moderation.case.capture_trail";
    const { idempotency_key: key, ...payload } = body;
    assert.match(String(key), /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);
    const hash = JSON.stringify(payload), existing = commands.get(`${operation}\u0000${key}`);
    if (existing) return existing.hash === hash ? { ...existing.result, idempotency_replayed: true } : core("dates-admin-idempotency-conflict", 409);
    if (body.case_id !== caseId) return core("dates-moderation-case-unavailable", 404);
    writes.push({ operation, key });
    const result = action === "dates_moderation_legal_hold"
      // The genuine receipt bodies of the P1 corpus, with what Core generates per write.
      ? { ...fixture(body.action === "place" ? "admin-moderation-hold-place" : "admin-moderation-hold-release"), case_id: caseId,
        review_at: body.action === "place" ? body.review_at : null, audit_id: hex("aud") }
      : { success: true, status_code: 200, case_id: caseId, activity_id: "act_" + "0".repeat(31) + "2", evidence_id: hex("evi"), captured_from: body.captured_from,
        captured_to: body.captured_to, point_count: 3, audit_id: hex("aud"), break_glass_used: false, idempotency_replayed: false, server_now: 1790000000,
        message: 200, status: 200, can_send: 0 };
    commands.set(`${operation}\u0000${key}`, { hash, result });
    return result;
  }
  return { writes, answer };
}

// ---------------------------------------------------------------- the saved command

const ACTOR = "moderator@example.test", STORE_KEY = "friending:dates-case-command:pending:v1:moderator%40example.test";
/** The tab's session storage: it outlives the component, a reload and a move to another case page. */
function tabStorage() {
  const rows = new Map<string, string>();
  return { rows, storage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } } };
}
const CASE_ID = fixture("admin-moderation-hold-place").case_id as string;
const holdBody = (action: "place" | "release", key = `dates-legal-hold-${action}:00000000-0000-4000-8000-000000000001`) => ({ case_id: CASE_ID, action,
  reason: "Preservation request 2026/118.", legal_basis: "Court order 12.Pk.50.118/2026.", break_glass: false, review_at: action === "place" ? 1790086400 : null, idempotency_key: key });
const trailBody = { case_id: CASE_ID, expected_revision: 7, captured_from: 1789990000, captured_to: 1789993600, reason: "Route during the reported incident.", break_glass: false,
  idempotency_key: "dates-case-trail-evidence:00000000-0000-4000-8000-000000000001" };

test("a saved command is exactly one of the two bodies the case page sends, per operator, and an unreadable record blocks", async () => {
  const hold = prepareDatesKeptCommand(ACTOR, "dates_moderation_legal_hold", holdBody("place"), 1790000000);
  assert.deepEqual(hold, { version: 1, actor: ACTOR, issued_at: 1790000000, action: "dates_moderation_legal_hold", body: holdBody("place") });
  assert.ok(prepareDatesKeptCommand(ACTOR, "dates_moderation_legal_hold", holdBody("release"), 1790000000));
  assert.ok(prepareDatesKeptCommand(ACTOR, "dates_moderation_trail_evidence", trailBody, 1790000000));
  // Core bounds a reason at 1000 characters (DatesModerationReadService::reason); the store is not stricter.
  assert.ok(prepareDatesKeptCommand(ACTOR, "dates_moderation_trail_evidence", { ...trailBody, reason: "x".repeat(1000) }, 1790000000));
  for (const [action, body] of [["dates_moderation_legal_hold", { ...holdBody("place"), review_at: null }], ["dates_moderation_legal_hold", { ...holdBody("release"), review_at: 1790086400 }],
    ["dates_moderation_legal_hold", { ...holdBody("place"), action: "extend" }], ["dates_moderation_legal_hold", { ...holdBody("place"), case_id: "cas_1" }],
    ["dates_moderation_legal_hold", { ...holdBody("place"), reason: "  " }], ["dates_moderation_legal_hold", { ...holdBody("place"), legal_basis: "x".repeat(1001) }],
    ["dates_moderation_legal_hold", { ...holdBody("place"), idempotency_key: "short" }], ["dates_moderation_legal_hold", { ...holdBody("place"), extra: 1 }],
    ["dates_moderation_legal_hold", trailBody], ["dates_moderation_trail_evidence", holdBody("place")], ["dates_moderation_trail_evidence", { ...trailBody, captured_to: trailBody.captured_from }],
    ["dates_moderation_trail_evidence", { ...trailBody, expected_revision: "7" }], ["dates_moderation_trail_evidence", { ...trailBody, break_glass: "0" }],
    ["dates_moderation_note", trailBody]] as const)
    assert.equal(prepareDatesKeptCommand(ACTOR, action as any, body as any, 1790000000), null, JSON.stringify(body).slice(0, 80));
  assert.equal(prepareDatesKeptCommand("Moderator@Example.test", "dates_moderation_legal_hold", holdBody("place"), 1790000000), null, "the operator as Core names them");
  // The record is per operator, in the journal's storage; anything unreadable under the key blocks and stays.
  const tab = tabStorage();
  assert.deepEqual(readDatesKeptCommand(tab.storage, ACTOR), { kind: "empty" });
  assert.deepEqual(readDatesKeptCommand(null, ACTOR), { kind: "blocked" });
  assert.equal((await runDatesKeptCommand(hold!, tab.storage, 1790000000, async () => null)).kind, "uncertain");
  assert.deepEqual([...tab.rows.keys()], [STORE_KEY]);
  assert.deepEqual(readDatesKeptCommand(tab.storage, ACTOR), { kind: "pending", command: hold });
  assert.deepEqual(readDatesKeptCommand(tab.storage, "colleague@example.test"), { kind: "empty" });
  for (const raw of ["{", "null", JSON.stringify({ ...hold, actor: "colleague@example.test" }), JSON.stringify({ ...hold, version: 2 }), JSON.stringify({ ...hold, body: { ...hold!.body, action: "extend" } }), "x".repeat(17000)]) {
    tab.rows.set(STORE_KEY, raw);
    assert.deepEqual(readDatesKeptCommand(tab.storage, ACTOR), { kind: "blocked" });
    assert.deepEqual(await runDatesKeptCommand(hold!, tab.storage, 1790000000, async () => assert.fail("not sent")), { kind: "blocked" });
    assert.equal(tab.rows.get(STORE_KEY), raw, "never cleared silently");
  }
});

// ---------------------------------------------------------------- the moderation case page

const casePage = functionsOf("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", "DatesModerationCase");
const caseCode = compile(`${["mutate", "runKept", "retryKept", "executeConfirmed", "prepareLegalHold", "captureTrailEvidence", "addNote"].map(casePage.text).join("\n")}
  exports.mutate = mutate; exports.runKept = runKept; exports.retryKept = retryKept; exports.executeConfirmed = executeConfirmed; exports.prepareLegalHold = prepareLegalHold;
  exports.captureTrailEvidence = captureTrailEvidence; exports.addNote = addNote;`);

/** One mounted case page. `tab` is the storage it shares with every other page of the tab; `kept` starts as the page's effect reads it. */
function caseHarness(reply: (action: string, body: Record<string, any>) => unknown, tab = tabStorage(), options: { caseId?: string; fields?: boolean } = {}) {
  const sent: Array<{ action: string; body: Record<string, any> }> = [], state: Record<string, any> = {}, writes: string[] = [];
  const readFence = new DatesCaseReadFence(), clock = { now: 1790000000 }, caseId = options.caseId ?? CASE_ID, filled = options.fields !== false;
  const context: any = { exports: {}, caseId, writeLocked: false, busy: false, mutationBusy: { current: false }, readFence, lifetime: { current: 0 },
    isDatesConsoleCommand, datesConsoleCommandReceipt, datesCommandOutcome, createAdminIdempotencyKey, prepareDatesKeptCommand, readDatesKeptCommand, runDatesKeptCommand,
    datesExternalBrowserStorage: () => tab.storage, nowSeconds: () => clock.now,
    t: translator(""), commandOutcome: translator("outcome."), load: async () => { writes.push("load"); },
    isDatesExternalMessageCase: () => false, datesLegalHoldAllowed: () => true, epochFromLocalInput: (value: string) => Number(value),
    data: { case: { case_id: caseId, revision: 7, target_type: "activity", activity_id: "act_" + "0".repeat(31) + "2", conflict_of_interest: false, status: "actioned" } },
    principal: { email: ACTOR }, breakGlass: false, confirmed: null, kept: readDatesKeptCommand(tab.storage, ACTOR),
    // After a reload the forms are empty: nothing of the command lives in the component.
    holdAction: "place", holdReason: filled ? "Preservation request 2026/118." : "", legalBasis: filled ? "Court order 12.Pk.50.118/2026." : "", holdReviewAt: filled ? "1790086400" : "",
    trailFrom: filled ? "1789990000" : "", trailTo: filled ? "1789993600" : "", trailReason: filled ? "Route during the reported incident." : "",
    note: "Checked the report against the thread.", noteReason: "",
    adminCall: async (action: string, body: Record<string, any>) => {
      sent.push({ action, body: plain(body) });
      const value = reply(action, plain(body));
      if (value instanceof Error) throw value;
      return value;
    } };
  for (const name of ["Busy", "Evidence", "Feedback", "Confirmed", "Kept", "HoldReason", "LegalBasis", "HoldReviewAt", "TrailFrom", "TrailTo", "TrailReason",
    "Note", "NoteReason", "ResolutionReason", "VisibleReasonEn", "VisibleReasonHu", "RestrictionExpiry"])
    context[`set${name}`] = (value: unknown) => {
      state[name] = value; writes.push(name);
      // The functions read these two through the component's scope.
      if (name === "Confirmed" || name === "Kept") context[name.toLowerCase()] = value;
    };
  vm.runInNewContext(caseCode, context);
  return { context, state, writes, sent, readFence, clock, tab, saved: () => readDatesKeptCommand(tab.storage, ACTOR),
    api: context.exports as Record<string, (...values: any[]) => Promise<any>> };
}
const submit = { preventDefault() {} };

for (const action of ["place", "release"] as const) test(`legal hold ${action}: the first attempt lands, its reply is lost, the page is reloaded, and the retry ends in that attempt's receipt - one write`, async () => {
  for (const [name, lost, token] of LOST) {
    const model = coreModel(CASE_ID);
    let lose = true;
    const answer = (sentAction: string, body: Record<string, any>) => { const value = model.answer(sentAction, body); return lose ? lost : value; };
    const h = caseHarness(answer);
    h.context.holdAction = action;
    // The operator fills the form and confirms: the page's own two steps.
    h.api.prepareLegalHold(submit);
    const prepared = plain(h.state.Confirmed);
    assert.equal(prepared.kind, "legal_hold"); assert.equal(prepared.payload.action, action);
    assert.match(prepared.payload.idempotency_key, new RegExp(`^dates-legal-hold-${action}:[0-9a-f-]{36}$`));
    await h.api.executeConfirmed();
    assert.equal(model.writes.length, 1, `${name}: Core applied the hold`);
    // The page does not call it a failure, and the command - key included - is in the tab's storage, not in the page.
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.kept:" : `outcome.keptAnswered:${token}` }, name);
    const saved = h.saved();
    assert.deepEqual(saved.kind === "pending" && saved.command, { version: 1, actor: ACTOR, issued_at: 1790000000, action: "dates_moderation_legal_hold", body: prepared.payload }, name);
    assert.deepEqual(plain(h.state.Kept), plain(saved)); assert.equal(h.state.Confirmed, null); assert.ok(h.writes.includes("load"));
    // While it waits the form cannot make another command.
    h.api.prepareLegalHold(submit);
    assert.equal(h.state.Confirmed, null, "no second command is prepared");

    // RELOAD (or a move to another page and back): a new page of the same tab, its forms empty. It reads the record...
    lose = false;
    const reloaded = caseHarness(answer, h.tab, { fields: false });
    assert.deepEqual(plain(reloaded.context.kept), plain(saved), "the record is what the new page starts from");
    reloaded.api.prepareLegalHold(submit);
    assert.equal(reloaded.writes.includes("Confirmed"), false, "and makes no new command");
    // ...and sends the saved request again; Core answers with the first attempt's receipt.
    await reloaded.api.retryKept();
    assert.equal(model.writes.length, 1, `${name}: the retry wrote nothing`);
    assert.deepEqual([h.sent.length, reloaded.sent.length], [1, 1]);
    assert.deepEqual(reloaded.sent[0], h.sent[0], "byte-for-byte the same request, from another page instance");
    assert.deepEqual(plain(reloaded.state.Feedback), { tone: "success", text: "legalHoldUpdated" });
    assert.deepEqual(reloaded.saved(), { kind: "empty" }, "settled by the receipt"); assert.deepEqual(plain(reloaded.state.Kept), { kind: "empty" });
    assert.equal(h.tab.rows.size, 0);
  }
});

test("legal hold: what Core would do with a new key, and which answers settle the saved command", async () => {
  // The hazard itself, on the model of Core: the same hold under a new key is applied a second time.
  const model = coreModel(CASE_ID), { idempotency_key: _key, ...body } = holdBody("place");
  model.answer("dates_moderation_legal_hold", { ...body, idempotency_key: createAdminIdempotencyKey("dates-legal-hold-place") });
  model.answer("dates_moderation_legal_hold", { ...body, idempotency_key: createAdminIdempotencyKey("dates-legal-hold-place") });
  assert.equal(model.writes.length, 2, "Core has no revision for a hold: a new key is a new write");

  const operation = () => ({ kind: "legal_hold", label: "Release", payload: holdBody("release") });
  // Core's genuine definitive refusal on the first attempt: shown as it is, nothing stays saved.
  const open = caseHarness(() => fixture("admin-moderation-hold-open-denied"));
  open.context.confirmed = operation(); await open.api.executeConfirmed();
  assert.deepEqual(plain(open.state.Feedback), { tone: "error", text: "operationFailed:dates-legal-hold-case-open" });
  assert.deepEqual(open.saved(), { kind: "empty" }); assert.equal(open.writes.includes("load"), false, "a refusal changes nothing else on the page");
  // An unknown outcome, then replies that say nothing about the first attempt: Core still running it, a capability
  // refusal (before the receipt lookup), a review date that has passed meanwhile (the clock, before the lookup), a timeout.
  let reply: unknown = null;
  const kept = caseHarness(() => reply);
  kept.context.confirmed = operation(); await kept.api.executeConfirmed();
  assert.equal(kept.saved().kind, "pending");
  for (const answer of [core("dates-admin-command-in-progress", 409), fixture("admin-moderation-hold-viewer-denied"), core("dates-legal-hold-review-invalid", 422), bridge("core-timeout", 504)]) {
    reply = answer; await kept.api.retryKept();
    assert.equal(kept.saved().kind, "pending", String((answer as any).error));
    assert.equal(kept.state.Feedback.text, `outcome.keptAnswered:${(answer as any).error}`);
  }
  // The same definitive refusal as the answer to a retry settles it too: Core raises it after the receipt lookup.
  reply = fixture("admin-moderation-hold-open-denied"); await kept.api.retryKept();
  assert.deepEqual(kept.saved(), { kind: "empty" }); assert.equal(kept.state.Feedback.text, "operationFailed:dates-legal-hold-case-open");
  assert.equal(kept.sent.length, 6); assert.equal(new Set(kept.sent.map((call) => JSON.stringify(call))).size, 1, "six requests, one body, one key");
  // A receipt for another case or another action is not this command's receipt.
  for (const wrong of [{ ...fixture("admin-moderation-hold-release"), case_id: "cas_" + "f".repeat(32) }, fixture("admin-moderation-hold-place")]) {
    const other = caseHarness(() => wrong); other.context.confirmed = operation(); await other.api.executeConfirmed();
    assert.equal(other.saved().kind, "pending"); assert.equal(other.state.Feedback.text, "outcome.kept:");
  }
  // The page left the case while the request was in flight: the record is in the storage, whatever became of the page.
  const moved = caseHarness(() => null); moved.context.confirmed = operation();
  const pending = moved.api.executeConfirmed(); moved.readFence.invalidate(); await pending;
  const left = moved.saved();
  assert.deepEqual(left.kind === "pending" && left.command.body, holdBody("release"));
  assert.equal(moved.state.Feedback, null, "nothing is announced on a page that moved on");
  // Another write is running: nothing is sent and nothing is saved.
  const busy = caseHarness(() => assert.fail("not sent")); busy.context.mutationBusy.current = true; busy.context.confirmed = operation();
  await busy.api.executeConfirmed();
  assert.equal(busy.sent.length, 0); assert.deepEqual(busy.saved(), { kind: "empty" });
  // A saved command belongs to its case: another case's page shows it (with a link) but neither resends it nor makes a new one.
  const elsewhere = caseHarness(() => assert.fail("not sent"), kept.tab, { caseId: "cas_" + "e".repeat(32) });
  elsewhere.tab.rows.set(STORE_KEY, JSON.stringify(prepareDatesKeptCommand(ACTOR, "dates_moderation_legal_hold", holdBody("release"), 1790000000)));
  elsewhere.context.kept = readDatesKeptCommand(elsewhere.tab.storage, ACTOR);
  await elsewhere.api.retryKept(); elsewhere.api.prepareLegalHold(submit); await elsewhere.api.captureTrailEvidence(submit);
  assert.equal(elsewhere.sent.length, 0); assert.equal(elsewhere.writes.includes("Confirmed"), false); assert.equal(elsewhere.saved().kind, "pending");
  // After six days Core no longer keeps the receipt: a resend would be a new write, so there is none. The record stays.
  const old = caseHarness(() => assert.fail("not sent"), elsewhere.tab);
  old.clock.now = 1790000000 + 6 * 86400;
  await old.api.retryKept();
  assert.deepEqual(plain(old.state.Feedback), { tone: "error", text: "outcome.expired" }); assert.equal(old.sent.length, 0); assert.equal(old.saved().kind, "pending");
  // A tab that cannot keep the record sends nothing.
  const none = caseHarness(() => assert.fail("not sent")); none.context.datesExternalBrowserStorage = () => null; none.context.confirmed = operation();
  await none.api.executeConfirmed();
  assert.deepEqual(plain(none.state.Feedback), { tone: "error", text: "outcome.blocked" }); assert.equal(none.sent.length, 0);
  // A hold the store would not keep as it is (no review date) is not sent either.
  const invalid = caseHarness(() => assert.fail("not sent")); invalid.context.confirmed = { kind: "legal_hold", label: "Place", payload: { ...holdBody("place"), review_at: null } };
  await invalid.api.executeConfirmed();
  assert.deepEqual(plain(invalid.state.Feedback), { tone: "error", text: "outcome.invalid" }); assert.equal(invalid.sent.length, 0);
  // Core answered but the tab could not clear the record: the page says so, and the record still offers the same request.
  const stuck = caseHarness(() => fixture("admin-moderation-hold-release"));
  stuck.context.datesExternalBrowserStorage = () => ({ ...stuck.tab.storage, removeItem: () => { throw new Error("SecurityError"); } });
  stuck.context.confirmed = operation(); await stuck.api.executeConfirmed();
  assert.deepEqual(plain(stuck.state.Feedback), { tone: "success", text: "legalHoldUpdated outcome.retained" }); assert.equal(stuck.saved().kind, "pending");
  // A member-case resolution is fenced by the case revision: a refusal is a refusal, and nothing is saved.
  const resolve = caseHarness(() => fixture("admin-moderation-hold-viewer-denied"));
  resolve.context.confirmed = { kind: "resolve", label: "Dismiss", payload: { case_id: CASE_ID, expected_revision: 7, action: "dismiss", idempotency_key: "dates-case-resolve:00000000-0000-4000-8000-000000000001" } };
  await resolve.api.executeConfirmed();
  assert.equal(resolve.state.Feedback.text, "operationFailed:dates-admin-capability-required"); assert.deepEqual(resolve.saved(), { kind: "empty" });
});

test("trail capture: the first attempt lands, its reply is lost, the page is reloaded, and the retry ends in that attempt's receipt - one snapshot", async () => {
  for (const [name, lost, token] of LOST) {
    const model = coreModel(CASE_ID);
    let lose = true;
    const answer = (action: string, body: Record<string, any>) => { const value = model.answer(action, body); return lose ? lost : value; };
    const h = caseHarness(answer);
    await h.api.captureTrailEvidence(submit);
    assert.equal(model.writes.length, 1, `${name}: Core stored the snapshot`);
    const first = h.sent[0].body;
    assert.deepEqual({ ...first, idempotency_key: null }, { ...trailBody, idempotency_key: null });
    assert.match(first.idempotency_key, /^dates-case-trail-evidence:[0-9a-f-]{36}$/);
    assert.equal(h.state.Feedback.text, token === null ? "outcome.kept:" : `outcome.keptAnswered:${token}`, name);
    const saved = h.saved();
    assert.deepEqual(saved.kind === "pending" && saved.command.body, first, `${name}: the command is saved with its key`);
    for (const field of ["TrailFrom", "TrailTo", "TrailReason"]) assert.equal(h.writes.includes(field), false, "the form keeps what was sent");
    // Submitting the form again makes no new command while this one waits.
    await h.api.captureTrailEvidence(submit);
    assert.equal(h.sent.length, 1);
    // RELOAD: a new page, empty form. The saved request again; Core replays the first attempt's receipt.
    lose = false;
    const reloaded = caseHarness(answer, h.tab, { fields: false });
    await reloaded.api.captureTrailEvidence(submit);
    assert.equal(reloaded.sent.length, 0, "the empty form sends nothing, and the saved command is not replaced");
    await reloaded.api.retryKept();
    assert.equal(model.writes.length, 1, `${name}: one snapshot`);
    assert.deepEqual(reloaded.sent[0].body, first);
    assert.deepEqual(plain(reloaded.state.Feedback), { tone: "success", text: "trailEvidenceCaptured" });
    assert.deepEqual(reloaded.saved(), { kind: "empty" });
  }
  // The hazard on the model of Core: the case revision is checked, not moved, so a new key stores a second snapshot.
  const model = coreModel(CASE_ID), { idempotency_key: _key, ...body } = trailBody;
  for (let attempt = 0; attempt < 2; attempt++) model.answer("dates_moderation_trail_evidence", { ...body, idempotency_key: createAdminIdempotencyKey("dates-case-trail-evidence") });
  assert.equal(model.writes.length, 2);
  // Core's definitive refusals settle it (first attempt and retry alike); the window check against the clock does not.
  for (const [answer, settled] of [[core("dates-trail-evidence-unavailable", 404), true], [core("dates-admin-stale-revision", 409), true],
    [core("dates-trail-evidence-range-too-large", 422), true], [core("dates-trail-evidence-window-invalid", 422), false],
    [core("dates-sensitive-location-capability-required", 403), false]] as const) {
    const h = caseHarness(() => answer); await h.api.captureTrailEvidence(submit);
    assert.equal(h.saved().kind, settled ? "empty" : "pending", answer.error);
    assert.equal(h.state.Feedback.text, settled ? `operationFailed:${answer.error}` : `outcome.keptAnswered:${answer.error}`);
  }
  // An invalid window never becomes a command.
  const invalid = caseHarness(() => assert.fail("not sent")); invalid.context.trailTo = "1789980000";
  await invalid.api.captureTrailEvidence(submit); assert.equal(invalid.sent.length, 0); assert.equal(invalid.state.Feedback.text, "trailEvidenceInputInvalid");
  assert.deepEqual(invalid.saved(), { kind: "empty" });
});

test("a revision-fenced case command is worded as unknown when nothing says whether it landed, and its refusals stay refusals", async () => {
  const note = fixture("admin-moderation-claim");
  for (const [name, lost, token] of LOST) {
    const h = caseHarness(() => lost); await h.api.addNote(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: token === null ? "outcome.unknown:" : `outcome.unknownAnswered:${token}` }, name);
    assert.ok(h.writes.includes("load"), "the case is read again: its revision and notes show whether it landed");
    assert.equal(h.writes.includes("Note"), false, "what the operator typed stays");
    assert.deepEqual(h.saved(), { kind: "empty" }, "a fenced command is not saved: Core refuses a stale repeat");
  }
  // Core's genuine refusals answer the request: the wording and the behaviour are what they were.
  for (const name of ["admin-moderation-revision-stale-denied", "admin-moderation-hold-viewer-denied", "admin-moderation-key-conflict-denied"]) {
    const body = fixture(name), h = caseHarness(() => body); await h.api.addNote(submit);
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${body.error}` }); assert.equal(h.writes.includes("load"), false);
  }
  // A receipt of another command is not a receipt (the genuine claim receipt in answer to a note).
  const wrong = caseHarness(() => note); await wrong.api.addNote(submit);
  assert.equal(wrong.state.Feedback.text, "outcome.unknown:");
  // A saved command does not block the fenced commands of the case.
  const tab = tabStorage(); tab.rows.set(STORE_KEY, JSON.stringify(prepareDatesKeptCommand(ACTOR, "dates_moderation_legal_hold", holdBody("place"), 1790000000)));
  const beside = caseHarness(() => bridge("core-timeout", 504), tab); await beside.api.addNote(submit);
  assert.equal(beside.sent.length, 1); assert.equal(beside.saved().kind, "pending");

  // The page: the record is read whenever the operator is established, shown before everything else, and never removed by the page.
  const source = casePage.source;
  assert.match(source, /useEffect\(\(\) => \{ if \(operatorEmail !== null\) setKept\(readDatesKeptCommand\(datesExternalBrowserStorage\(\), operatorEmail\)\); \}, \[operatorEmail\]\);/);
  assert.match(source, /\{kept\.kind !== "empty" && <DatesUnansweredCommand read=\{kept\} caseId=\{caseId\} now=\{nowSeconds\(\)\} busy=\{busy\} onRetry=\{\(\) => void retryKept\(\)\} \/>\}/);
  assert.ok(source.indexOf("<DatesUnansweredCommand") < source.indexOf("onSubmit={captureTrailEvidence}"));
  assert.equal((source.match(/setKept\(/g) ?? []).length, 2, "the effect, and the runner after each attempt - both from the storage");
  assert.doesNotMatch(source, /removeItem|setItem|sessionStorage|localStorage|onDiscard|holdCommand|trailCommand/);
  assert.equal((source.match(/disabled=\{keptLocked\}/g) ?? []).length, 7, "the four fields of the hold form and the three of the capture form");
  assert.match(source, /const keptLocked = kept\.kind !== "empty";/);
  // `mutate` sends only fenced commands now; the two unfenced ones cannot reach Core except through the saved record.
  assert.equal((source.match(/datesCommandOutcome\(response, receipt, "fresh"\)/g) ?? []).length, 1);
  assert.equal((source.match(/"dates_moderation_legal_hold"/g) ?? []).length, 2, "prepared for saving, and named in the retry - never passed to mutate");
  assert.equal((source.match(/"dates_moderation_trail_evidence"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /mutate\("dates_moderation_(legal_hold|trail_evidence)"/);
});

// ---------------------------------------------------------------- the activity page

const activityPage = functionsOf("../app/(dashboard)/dates/[activityId]/page.tsx", "DatesActivityDetailPage");
const activityCode = compile(`${["reportFailure", "executeCommand", "requestTransfer"].map(activityPage.text).join("\n")}
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
    return { ...fixture("admin-activity-end"), activity_id: body.activity_id, revision };
  } };
}
function activityHarness(reply: (action: string, body: Record<string, any>) => unknown) {
  const sent: Array<{ action: string; body: Record<string, any> }> = [], state: Record<string, any> = {}, writes: string[] = [];
  const context: any = { exports: {}, busy: false, data: { activity: { activity_id: ACTIVITY_ID, revision: 4, host: { uid: 7 } } }, pendingCommand: { action: "end", reason: "Reported as over." },
    transferUid: "42", transferReason: "The host asked for it.", datesCommandOutcome, createAdminIdempotencyKey, t: translator(""), commandOutcome: translator("outcome."),
    load: async () => { writes.push("load"); }, window: { location: { assign: (target: string) => { writes.push(`go:${target}`); } } },
    adminCall: async (action: string, body: Record<string, any>) => { sent.push({ action, body: plain(body) }); return reply(action, plain(body)); } };
  for (const name of ["Busy", "Feedback", "PendingCommand", "CommandReason", "TransferUid", "TransferReason"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); };
  vm.runInNewContext(activityCode, context);
  return { context, state, writes, sent, api: context.exports as Record<string, (...values: any[]) => Promise<any>> };
}

test("activity commands: a lost reply is an unknown outcome, and Core's revision keeps the blind repeat from writing twice", async () => {
  for (const [name, lost, token] of LOST) {
    // adminCall never throws: it answers null. And this page has no receipt decoder: any body that says success is
    // taken as one, as before (not changed here).
    if (lost instanceof Error || (lost as any)?.success === true) continue;
    const model = activityModel(4);
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
  // Core's genuine answers: a receipt, and refusals that are worded as they were.
  const done = activityHarness(() => fixture("admin-activity-end")); await done.api.executeCommand();
  assert.deepEqual(plain(done.state.Feedback), { tone: "success", text: "commandDone" }); assert.ok(done.writes.includes("load"));
  const purged = activityHarness(() => fixture("admin-activity-purge")); purged.context.pendingCommand = { action: "purge", reason: "Retention." };
  await purged.api.executeCommand(); assert.ok(purged.writes.includes("go:/dates"));
  for (const name of ["admin-activity-command-stale-denied", "admin-activity-command-viewer-denied", "admin-activity-purge-hold-denied"]) {
    const body = fixture(name), h = activityHarness(() => body); await h.api.executeCommand();
    assert.deepEqual(plain(h.state.Feedback), { tone: "error", text: `operationFailed:${body.error}` }, name);
  }
  // The host transfer: the same two wordings. Core fences it with `dates-host-transfer-already-pending` (TRANSCRIBED:
  // DatesHostTransferService::request 59-65), which is a refusal like any other.
  const lost = activityHarness(() => null); await lost.api.requestTransfer(submit);
  assert.equal(lost.state.Feedback.text, "outcome.unknown:"); assert.equal(lost.writes.includes("TransferUid"), false);
  const pending = activityHarness(() => core("dates-host-transfer-already-pending", 409)); await pending.api.requestTransfer(submit);
  assert.equal(pending.state.Feedback.text, "operationFailed:dates-host-transfer-already-pending");
  assert.equal((activityPage.source.match(/datesCommandOutcome\(response, response\?\.success === true, "fresh"\)/g) ?? []).length, 3, "save, command, host transfer");
  assert.doesNotMatch(activityPage.source, /"kept"/);
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
      busy: false, allowedEntryPoints: "detail", datesReasonEntryPoints, datesReasonEntryPointsRefused, datesCommandOutcome, createAdminIdempotencyKey, t: translator(""),
      // The receipt check itself is covered on Core's genuine bodies in tests/datesExternalReasons.test.mts.
      datesReasonSaveReceipt: (value: any) => value?.success === true ? value : null,
      setBusy: () => {}, setEntryPointsError: () => {}, onInlineError: () => {}, onError: (error: unknown) => errors.push(error), onUnknown: (error: string | null) => unknown.push(error),
      onSaved: async () => { saved++; }, adminCall: async (_action: string, body: Record<string, any>) => { sent.push(plain(body)); return reply(plain(body)); } };
    vm.runInNewContext(reasonCode, context);
    return { sent, errors, unknown, saved: () => saved, save: () => context.exports.save(submit) };
  }
  for (const [name, lost, token] of LOST) {
    // The unreadable success is covered with the real receipt decoder in tests/datesExternalReasons.test.mts.
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

  // The setting and the activity-type saves, and the reason's deactivation, read a reply the same way.
  const settingCode = editorSave("SettingEditor");
  for (const [reply, expected] of [[null, { unknown: [null], errors: [], saved: 0 }], [bridge("core-timeout", 504), { unknown: ["core-timeout"], errors: [], saved: 0 }],
    [core("dates-admin-unavailable", 503), { unknown: ["dates-admin-unavailable"], errors: [], saved: 0 }],
    [core("dates-admin-stale-revision", 409), { unknown: [], errors: ["dates-admin-stale-revision"], saved: 0 }],
    [core("dates-configuration-value-invalid", 422), { unknown: [], errors: ["dates-configuration-value-invalid"], saved: 0 }],
    [{ success: true }, { unknown: [], errors: [], saved: 1 }]] as const) {
    const errors: unknown[] = [], unknown: Array<string | null> = []; let saved = 0;
    const context: any = { exports: {}, editable: true, reason: "Raised after the pilot.", busy: false, value: "5", items: [], setting: { key: "dates_max_active_hosted", type: "integer", revision: 3 },
      DATES_AI_MODEL_SETTING_KEYS: [], datesModelIdValid: () => true, datesStringListProblem: () => null, configurationInputValue: (_type: string, value: string) => Number(value),
      datesCommandOutcome, createAdminIdempotencyKey, t: translator(""), setProblem: () => {}, setBusy: () => {}, adminCall: async () => reply,
      onError: (error: unknown) => errors.push(error), onUnknown: (error: string | null) => unknown.push(error), onSaved: async () => { saved++; } };
    vm.runInNewContext(settingCode, context);
    await context.exports.save(submit);
    assert.deepEqual({ unknown, errors, saved }, expected, JSON.stringify(reply));
  }
  assert.equal((configuration.match(/datesCommandOutcome\(response, response\?\.success === true, "fresh"\)/g) ?? []).length, 3, "setting, activity type, deactivation");
  assert.equal((configuration.match(/onError=\{failure\} onUnknown=\{unknown\}/g) ?? []).length, 4, "every editor reports an unknown outcome");
  assert.match(configuration, /function unknown\(error: string \| null\) \{\s+setFeedback\(\{ tone: "error", text: commandOutcome\(error === null \? "unknown" : "unknownAnswered", \{ error: error \?\? "" \}\) \}\);\s+\}/);
  assert.doesNotMatch(configuration, /"kept"/);
});

// ---------------------------------------------------------------- copy

test("the unknown-outcome copy exists in both languages and the saved-command notice renders each of its states", () => {
  const keys = ["unknown", "unknownAnswered", "kept", "keptAnswered", "pending", "retry", "saved", "open", "expired", "blocked", "invalid", "retained",
    "actionHoldPlace", "actionHoldRelease", "actionTrail"];
  const place = prepareDatesKeptCommand(ACTOR, "dates_moderation_legal_hold", holdBody("place"), 1790000000)!;
  const trail = prepareDatesKeptCommand(ACTOR, "dates_moderation_trail_evidence", trailBody, 1790000000)!;
  for (const locale of ["en", "hu"]) {
    const copy = messagesOf(locale).datesAdmin.commandOutcome;
    assert.deepEqual(Object.keys(copy), keys, locale);
    for (const key of ["unknownAnswered", "keptAnswered"]) assert.match(copy[key], /\{error\}/, `${locale}.${key}`);
    for (const key of keys.filter((name) => !name.endsWith("Answered"))) assert.doesNotMatch(copy[key], /\{/, `${locale}.${key}`);
    const show = (read: any, caseId = CASE_ID, now = 1790000100, busy = false) => {
      const errors: string[] = [];
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
        createElement(DatesUnansweredCommand, { read, caseId, now, busy, onRetry: () => undefined })));
      assert.deepEqual(errors, []); return html;
    };
    const has = (html: string, key: string) => html.includes(copy[key].replaceAll("'", "&#x27;"));
    assert.equal(show({ kind: "empty" }), "");
    // On the page of its case: what it is, when, why - and one button, the same request again. No discard anywhere.
    const here = show({ kind: "pending", command: place });
    for (const key of ["saved", "pending", "actionHoldPlace", "retry"]) assert.ok(has(here, key), `${locale}.${key}`);
    assert.ok(here.includes("Preservation request 2026/118.") && here.includes(CASE_ID));
    assert.equal((here.match(/<button/g) ?? []).length, 1); assert.doesNotMatch(here, /href=/);
    assert.doesNotMatch(here, /dates-legal-hold-place:|Court order/, "neither the key nor the legal basis is shown");
    assert.ok(has(show({ kind: "pending", command: { ...place, body: holdBody("release") } }), "actionHoldRelease"));
    assert.ok(has(show({ kind: "pending", command: trail }), "actionTrail"));
    assert.match(show({ kind: "pending", command: place }, CASE_ID, 1790000100, true), /<button[^>]* disabled=""/);
    // On another case's page: a link to its case, no button.
    const elsewhere = show({ kind: "pending", command: place }, "cas_" + "e".repeat(32));
    assert.ok(has(elsewhere, "open") && elsewhere.includes(`href="/dates/moderation/${CASE_ID}"`)); assert.doesNotMatch(elsewhere, /<button/);
    // After six days: it stays, and cannot be sent.
    const old = show({ kind: "pending", command: place }, CASE_ID, 1790000000 + 6 * 86400);
    assert.ok(has(old, "expired")); assert.doesNotMatch(old, /<button/);
    // A store that cannot be read.
    const blocked = show({ kind: "blocked" });
    assert.ok(has(blocked, "blocked")); assert.doesNotMatch(blocked, /<button/);
  }
  assert.notEqual(messagesOf("en").datesAdmin.commandOutcome.unknown, messagesOf("hu").datesAdmin.commandOutcome.unknown);
});

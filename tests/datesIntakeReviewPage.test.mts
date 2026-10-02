import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { readDatesExternalPending } from "../lib/datesExternalMutations.ts";
import { datesIntakeEditorDraft, datesIntakeHeartbeatDelay, projectDatesIntakeDetail } from "../lib/datesIntakeAdmin.ts";
import { createDatesIntakeSerial, prepareDatesIntakeReject, readDatesIntakeDetail, runDatesIntakeLease, runDatesIntakePublish, runDatesIntakeReject } from "../lib/datesIntakeConsole.ts";

// The review screen's own callbacks (load, hold, reject, publish) executed as
// written, with React state replaced by recorders and the bridge by genuine
// Core bodies. Source-handler regressions: no browser, no mounted component.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const xin = (number: number) => "xin_" + number.toString(16).padStart(32, "0");
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null));
const source = readFileSync(new URL("../components/DatesIntakeReviewPage.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("DatesIntakeReviewPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "DatesIntakeReviewPage")!;
assert.ok(page?.body);
const declared = (name: string) => page.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
const loadDeclaration = page.body!.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find((node) => node.name.getText(tree) === "load")!;
assert.ok(loadDeclaration.initializer && ts.isCallExpression(loadDeclaration.initializer));
for (const name of ["command", "lease", "reject", "publish"]) assert.ok(declared(name), name);
const gone = tree.statements.find((node) => ts.isVariableStatement(node) && node.getText(tree).startsWith("const GONE"))!;
const code = ts.transpileModule(`${gone.getText(tree)}
  const load = ${(loadDeclaration.initializer as ts.CallExpression).arguments[0].getText(tree)};
  ${["command", "lease", "reject", "publish"].map((name) => declared(name).getText(tree)).join("\n")}
  exports.load = load; exports.lease = lease; exports.reject = reject; exports.publish = publish;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

const actor = "admin@example.test";
const identity = (capabilities = ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage"]) => ({ success: true, role: "admin",
  dates: { email: actor, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false, break_glass: false, capabilities } });
const oneRow = { ...fixture("admin-list-empty"), limit: 1 };
const externalList = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1790000000, events: [], page: 1, limit: 1, total: 0,
  capabilities: identity().dates.capabilities };

function harness(intakeId: string, answers: Record<string, unknown>) {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const sent: Array<{ action: string; body: any }> = [], writes: string[] = [], state: Record<string, any> = {};
  const table = { admin_me: identity(), dates_event_intake_list: oneRow, dates_external_event_list: externalList, ...answers } as Record<string, unknown>;
  const context: any = { exports: {}, intakeId, generation: { current: 0 }, lifetime: { current: 0 }, busyRef: { current: false }, revision: { current: null },
    pendingRef: { current: false }, serial: { current: createDatesIntakeSerial() }, operator: null, rejectCode: "duplicate", rejectNote: "Already listed as another intake.",
    readDatesIntakeDetail, runDatesIntakeLease, runDatesIntakeReject, runDatesIntakePublish, prepareDatesIntakeReject, readDatesExternalPending,
    datesExternalBrowserStorage: () => storage,
    adminCall: async (action: string, body: any) => { sent.push({ action, body });
      const answer = table[action]; return typeof answer === "function" ? (answer as (body: unknown) => unknown)(body) : answer; } };
  for (const name of ["State", "Result", "Operator", "Problem", "Notice", "Busy", "Pending", "OpenEvent", "Complete", "Candidate", "RejectCommand", "RejectNote", "ConfirmReject"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); if (name === "Operator") context.operator = value; };
  vm.runInNewContext(code, context);
  const commands = sent.filter.bind(sent);
  return { context, state, writes, sent, table, rows, storage, api: context.exports as { load: (signal?: AbortSignal, mode?: string) => Promise<void>;
    lease: (action: string) => Promise<void>; reject: (retry: unknown) => Promise<void>; publish: (input: unknown) => Promise<void> },
    calls: (action: string) => commands((call) => call.action === action) };
}
function confirmedEvent() {
  const prefill = projectDatesIntakeDetail(fixture("admin-detail-in-review-official"), xin(4))!.intake.events[0]!.editor_input!;
  const made = datesExternalDraftInput({ ...datesIntakeEditorDraft(prefill), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.ok(made.ok);
  return made.event;
}

test("the first read shows the intake; a later read that merely fails never wipes the page or the reviewer's draft", async () => {
  const detail = fixture("admin-detail-in-review-official"), h = harness(xin(4), { dates_event_intake_detail: detail });
  await h.api.load();
  assert.equal(h.state.State, "ready"); assert.equal(h.state.Result.read.intake.intake_id, xin(4)); assert.equal(h.state.Result.draftsEnabled, true);
  assert.equal(h.context.revision.current, detail.intake.revision); assert.equal(h.state.Pending.kind, "empty"); assert.equal(h.state.Problem, null);
  // The worker's poll and the reload after a command are quiet: an unreadable reply changes nothing at all.
  h.table.dates_event_intake_detail = null;
  let before = [...h.writes];
  await h.api.load(undefined, "quiet");
  assert.deepEqual(h.writes, before); assert.equal(h.context.revision.current, detail.intake.revision);
  // The Refresh button keeps the page too, and says that it could not read.
  await h.api.load(undefined, "refresh");
  assert.deepEqual(h.writes.slice(before.length), ["Notice"]); assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "detail.refreshFailed" });
  assert.equal(h.state.State, "ready");
  // A confirmed loss of the capability, or Core saying the intake is gone, does replace the page - in every mode.
  for (const [answer, who, problem] of [[fixture("admin-list-viewer-denied"), identity(["dates_external_event_read"]), { kind: "denied" }],
    [fixture("admin-detail-not-found-denied"), identity(), { kind: "refused", error: "dates-intake-unavailable" }]] as const) {
    const lost = harness(xin(4), { dates_event_intake_detail: detail }); await lost.api.load();
    lost.table.dates_event_intake_detail = answer; lost.table.admin_me = who;
    await lost.api.load(undefined, "quiet");
    assert.equal(lost.state.State, "error"); assert.equal(lost.state.Result, null); assert.equal(lost.context.revision.current, null);
    assert.deepEqual(plain(lost.state.Problem), problem);
  }
  // The first read distinguishes the same three failures and never shows an empty intake.
  const failed = harness(xin(4), { dates_event_intake_detail: null }); await failed.api.load();
  assert.equal(failed.state.State, "error"); assert.deepEqual(plain(failed.state.Problem), { kind: "unconfirmed" });
});

test("a reply to an earlier read never replaces a newer one", async () => {
  const older = fixture("admin-detail-in-review-multi"), newer = fixture("admin-detail-in-review-partial");
  let release!: (value: unknown) => void;
  const slow = new Promise((resolve) => { release = resolve; });
  let first = true;
  const h = harness(xin(6), { dates_event_intake_detail: () => { if (first) { first = false; return slow; } return newer; } });
  const stale = h.api.load(), fresh = h.api.load(undefined, "quiet");
  await fresh;
  assert.equal(h.state.Result.read.intake.published_count, 1);
  const writes = [...h.writes];
  release(older); await stale;
  assert.deepEqual(h.writes, writes); assert.equal(h.state.Result.read.intake.published_count, 1); assert.equal(h.context.revision.current, newer.intake.revision);
  // After unmount nothing is adopted either.
  const controller = new AbortController(), gone = harness(xin(6), { dates_event_intake_detail: newer });
  const pending = gone.api.load(controller.signal); controller.abort(); await pending;
  assert.deepEqual(gone.writes, ["State"], "only the loading state set before the request");
});

test("a hold is taken with the revision the page holds, once, and the intake is read again", async () => {
  const detail = fixture("admin-detail-in-review-text"), receipt = fixture("admin-lease-claim");
  const h = harness(detail.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_lease: receipt });
  await h.api.load();
  h.context.revision.current = receipt.intake.revision - 1;
  const first = h.api.lease("claim"); await h.api.lease("claim"); await first;
  assert.equal(h.calls("dates_event_intake_lease").length, 1, "a second click while busy sends nothing");
  assert.deepEqual(plain(h.calls("dates_event_intake_lease")[0].body), { intake_id: detail.intake.intake_id, expected_revision: receipt.intake.revision - 1, action: "claim" });
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "lease.done.claim" });
  assert.equal(h.calls("dates_event_intake_detail").length, 2, "read again after the command");
  assert.equal(h.context.busyRef.current, false); assert.equal(h.state.Busy, false);
  // Core's genuine refusals are shown as their tokens.
  for (const name of ["lease-claimed", "lease-conflict", "lease-owner-required"]) {
    const refused = harness(detail.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_lease: fixture(`admin-${name}-denied`) });
    await refused.api.load(); await refused.api.lease(name === "lease-owner-required" ? "release" : "claim");
    assert.deepEqual(plain(refused.state.Notice), { tone: "error", key: "refused", error: fixture(`admin-${name}-denied`).error });
  }
  // Without a readable revision there is no command.
  const blind = harness(detail.intake.intake_id, { dates_event_intake_detail: null }); await blind.api.load(); await blind.api.lease("claim");
  assert.equal(blind.calls("dates_event_intake_lease").length, 0);
  // Letting go closes the editor: a publication needs the hold.
  const release = harness(detail.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_lease: fixture("admin-lease-release") });
  await release.api.load(); release.context.revision.current = fixture("admin-lease-release").intake.revision - 1;
  await release.api.lease("release");
  assert.equal(release.state.OpenEvent, null); assert.deepEqual(plain(release.state.Notice), { tone: "success", key: "lease.done.release" });
});

test("a rejection keeps its identity across an unanswered attempt, and Core's refusal is shown as it is", async () => {
  const detail = fixture("admin-detail-leased-by-other"), receipt = fixture("admin-reject-duplicate");
  let answer: unknown = null;
  const h = harness(receipt.intake.intake_id, { dates_event_intake_detail: { ...detail, intake: { ...detail.intake, intake_id: receipt.intake.intake_id } }, dates_event_intake_reject: () => answer });
  await h.api.load();
  h.context.revision.current = receipt.intake.revision - 1;
  await h.api.reject(null);
  const first = plain(h.calls("dates_event_intake_reject")[0].body);
  assert.deepEqual({ ...first, idempotency_key: null }, { intake_id: receipt.intake.intake_id, expected_revision: receipt.intake.revision - 1, reason_code: "duplicate",
    reason: "Already listed as another intake.", idempotency_key: null });
  assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "reject.uncertain" });
  assert.deepEqual(plain(h.state.RejectCommand), first, "the unanswered command is kept for the retry");
  assert.equal(h.state.ConfirmReject, false);
  // The retry is that command, key included; Core's replayed receipt settles it.
  answer = { ...receipt, replayed: true };
  await h.api.reject(h.state.RejectCommand);
  assert.deepEqual(plain(h.calls("dates_event_intake_reject")[1].body), first);
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "reject.done" }); assert.equal(h.state.RejectCommand, null); assert.equal(h.state.RejectNote, "");
  for (const name of ["reject-lease-required", "reject-state-invalid", "reject-conflict"]) {
    const refused = harness(receipt.intake.intake_id, { dates_event_intake_detail: null, dates_event_intake_reject: fixture(`admin-${name}-denied`) });
    refused.context.revision.current = 9;
    await refused.api.reject(null);
    assert.deepEqual(plain(refused.state.Notice), { tone: "error", key: "refused", error: fixture(`admin-${name}-denied`).error });
    assert.equal(refused.state.RejectCommand, null);
  }
  // No reason note, no command.
  const empty = harness(receipt.intake.intake_id, {}); empty.context.revision.current = 9; empty.context.rejectNote = "   ";
  await empty.api.reject(null);
  assert.equal(empty.calls("dates_event_intake_reject").length, 0); assert.deepEqual(plain(empty.state.Notice), { tone: "error", key: "reject.invalid" });
});

test("publishing an event goes through the journal with the newest revision; partial, complete and refused answers are told apart", async () => {
  const partial = fixture("admin-publish-partial"), detail = fixture("admin-detail-in-review-partial");
  const candidate = { eventIndex: 0, event: confirmedEvent(), reason: "Source and public venue verified.", complete: false };
  const h = harness(partial.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_publish: partial });
  await h.api.load();
  // A heartbeat moved the revision after the form was opened: the command carries the newest one.
  h.context.revision.current = partial.intake.revision - 1;
  await h.api.publish({ candidate });
  const sent = plain(h.calls("dates_event_intake_publish")[0].body);
  assert.deepEqual({ ...sent, idempotency_key: null, event: null }, { intake_id: partial.intake.intake_id, intake_revision: partial.intake.revision - 1, event_index: 0,
    complete: false, reason: candidate.reason, idempotency_key: null, event: null });
  assert.deepEqual(sent.event.confirmations, { source: true, public_venue: true, timezone: true, content_safe: true });
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "publish.donePartial", eventId: partial.external_event_id });
  assert.equal(h.state.OpenEvent, null); assert.equal(h.state.Candidate, null); assert.equal(h.state.Pending.kind, "empty"); assert.equal(h.rows.size, 0);
  assert.equal(h.context.pendingRef.current, false);
  // The last event finishes the intake.
  const complete = fixture("admin-publish-complete"), done = harness(complete.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_publish: complete });
  await done.api.load(); done.context.revision.current = complete.intake.revision - 1;
  await done.api.publish({ candidate: { ...candidate, eventIndex: 2, complete: true } });
  assert.deepEqual(plain(done.state.Notice), { tone: "success", key: "publish.done", eventId: complete.external_event_id });
  assert.equal(plain(done.calls("dates_event_intake_publish")[0].body).complete, true);
  // A lost hold or a moved revision: Core's token is shown and the reviewer's form stays open for another try.
  for (const name of ["publish-lease-required", "publish-conflict", "publish-drafts-disabled", "publish-publishing-disabled", "publish-confirmation-required"]) {
    const refused = harness(partial.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_publish: fixture(`admin-${name}-denied`) });
    await refused.api.load(); await refused.api.publish({ candidate });
    assert.deepEqual(plain(refused.state.Notice), { tone: "error", key: "refused", error: fixture(`admin-${name}-denied`).error });
    assert.equal(refused.writes.includes("OpenEvent"), false, name); assert.equal(refused.rows.size, 0);
  }
  // The event is no longer there to publish: the editor closes.
  const unavailable = harness(partial.intake.intake_id, { dates_event_intake_detail: detail, dates_event_intake_publish: fixture("admin-publish-event-unavailable-denied") });
  await unavailable.api.load(); await unavailable.api.publish({ candidate });
  assert.equal(unavailable.state.OpenEvent, null);
});

test("an unanswered publication stays saved, pauses the hold's renewal, and only the same command is retried", async () => {
  const receipt = fixture("admin-publish"), detail = fixture("admin-detail-in-review-url");
  const candidate = { eventIndex: 0, event: confirmedEvent(), reason: "Source and public venue verified.", complete: false };
  let answer: unknown = null;
  const h = harness(receipt.intake.intake_id, { dates_event_intake_detail: { ...detail, intake: { ...detail.intake, intake_id: receipt.intake.intake_id } }, dates_event_intake_publish: () => answer });
  await h.api.load(); h.context.revision.current = receipt.intake.revision - 1;
  await h.api.publish({ candidate });
  assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "publish.uncertain" });
  assert.equal(h.state.Pending.kind, "pending"); assert.equal(h.context.pendingRef.current, true, "the heartbeat skips while a saved command holds its revision");
  assert.equal(h.rows.size, 1);
  const first = plain(h.calls("dates_event_intake_publish")[0].body);
  // A different publication cannot leave while that one is outstanding.
  await h.api.publish({ candidate: { ...candidate, eventIndex: 1 } });
  assert.equal(h.calls("dates_event_intake_publish").length, 1); assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "publish.blocked" });
  // The page reload finds the saved command again.
  await h.api.load(undefined, "quiet");
  assert.equal(h.state.Pending.kind, "pending");
  answer = fixture("admin-publish-replay");
  await h.api.publish({ retry: h.state.Pending.pending });
  assert.deepEqual(plain(h.calls("dates_event_intake_publish")[1].body), first);
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "publish.done", eventId: receipt.external_event_id });
  assert.equal(h.rows.size, 0); assert.equal(h.context.pendingRef.current, false);
  // Fresh access that cannot be confirmed sends nothing.
  const denied = harness(receipt.intake.intake_id, { dates_event_intake_detail: detail, dates_external_event_list: null, dates_event_intake_publish: receipt });
  await denied.api.load(); denied.context.revision.current = 10;
  await denied.api.publish({ candidate });
  assert.equal(denied.calls("dates_event_intake_publish").length, 0); assert.deepEqual(plain(denied.state.Notice), { tone: "error", key: "publish.access" });
});

test("a hold taken earlier is renewed before it runs out, and the regular rhythm stays inside Core's five minutes", () => {
  const lease = (until: number) => ({ holder: "admin@example.test", until, active: true, mine: true });
  const now = 1790000000;
  assert.equal(datesIntakeHeartbeatDelay(lease(now + 300), now), 120_000, "a hold just taken: the regular rhythm");
  assert.equal(datesIntakeHeartbeatDelay(lease(now + 100), now), 40_000, "a minute before Core lets it go");
  assert.equal(datesIntakeHeartbeatDelay(lease(now + 45), now), 1_000);
  assert.equal(datesIntakeHeartbeatDelay(lease(now - 5), now), 1_000);
  assert.equal(datesIntakeHeartbeatDelay(null, now), 1_000);
  assert.match(source, /const early = firstBeat\.current < DATES_INTAKE_HEARTBEAT_SECONDS \* 1000 \? setTimeout\(beat, firstBeat\.current\) : null;/);
  assert.match(source, /const timer = setInterval\(beat, DATES_INTAKE_HEARTBEAT_SECONDS \* 1000\);/);
  // The messages the callbacks name all exist in both languages.
  for (const locale of ["en", "hu"]) {
    const copy = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.intake;
    for (const key of ["detail.refreshFailed", "lease.done.claim", "lease.done.release", "lease.uncertain", "reject.invalid", "reject.uncertain", "reject.done",
      "publish.done", "publish.donePartial", "publish.doneRetained", "publish.refusedRetained", "publish.uncertain", "publish.blocked", "publish.expired",
      "publish.access", "publish.invalid", "access.denied", "access.refused", "access.unconfirmed"])
      assert.equal(typeof key.split(".").reduce((node: any, part) => node?.[part], copy), "string", `${locale}.${key}`);
  }
});

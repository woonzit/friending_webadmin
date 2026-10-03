import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { readDatesExternalPending } from "../lib/datesExternalMutations.ts";
import { datesIntakeCandidateCurrent, datesIntakeCompleteFlag, datesIntakeCompletion, datesIntakeCompletionChoice, datesIntakeEditorDraft, datesIntakeHeartbeatDelay,
  projectDatesIntakeDetail } from "../lib/datesIntakeAdmin.ts";
import { createDatesIntakeSerial, prepareDatesIntakeAsk, prepareDatesIntakeReject, readDatesIntakeDetail, runDatesIntakeAsk, runDatesIntakeLease, runDatesIntakePublish,
  runDatesIntakeReject } from "../lib/datesIntakeConsole.ts";

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
const callback = (name: string) => {
  const declaration = page.body!.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find((node) => node.name.getText(tree) === name)!;
  assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(tree) === "useCallback", name);
  return (declaration.initializer as ts.CallExpression).arguments[0].getText(tree);
};
const FUNCTIONS = ["advance", "heartbeat", "command", "lease", "reject", "ask", "publish", "propose"];
for (const name of FUNCTIONS) assert.ok(declared(name), name);
const gone = tree.statements.find((node) => ts.isVariableStatement(node) && node.getText(tree).startsWith("const GONE"))!;
const code = ts.transpileModule(`${gone.getText(tree)}
  const read = ${callback("read")};
  const load = ${callback("load")};
  ${FUNCTIONS.map((name) => declared(name).getText(tree)).join("\n")}
  exports.read = read; exports.load = load; exports.heartbeat = heartbeat;
  exports.lease = lease; exports.reject = reject; exports.ask = ask; exports.publish = publish; exports.propose = propose;`,
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
    duplicateOf: "", askDraft: null,
    readDatesIntakeDetail, runDatesIntakeLease, runDatesIntakeReject, runDatesIntakePublish, prepareDatesIntakeReject, readDatesExternalPending,
    runDatesIntakeAsk, prepareDatesIntakeAsk,
    datesIntakeCompleteFlag, writeBlocked: false, can: { publish: true }, openEvent: null, completion: null, close: false,
    datesExternalBrowserStorage: () => storage,
    adminCall: async (action: string, body: any) => { sent.push({ action, body });
      const answer = table[action]; return typeof answer === "function" ? (answer as (body: unknown) => unknown)(body) : answer; } };
  for (const name of ["State", "Result", "Operator", "Problem", "Notice", "Busy", "Pending", "OpenEvent", "Answer", "Candidate", "RejectCommand", "RejectNote", "ConfirmReject", "StaleRead",
    "DuplicateOf", "AskDraft", "AskCommand"])
    context[`set${name}`] = (value: unknown) => { state[name] = typeof value === "function" ? value(state[name]) : value; writes.push(name);
      if (name === "Operator") context.operator = value; };
  vm.runInNewContext(code, context);
  const commands = sent.filter.bind(sent);
  return { context, state, writes, sent, table, rows, storage, api: context.exports as { load: (signal?: AbortSignal, mode?: string) => Promise<void>;
    read: (signal?: AbortSignal, mode?: string) => Promise<void>; heartbeat: (life: number) => Promise<void>;
    lease: (action: string) => Promise<void>; reject: (retry: unknown) => Promise<void>; ask: (retry: unknown) => Promise<void>; publish: (input: unknown) => Promise<void>;
    propose: (facts: unknown, reason: string) => void },
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

const settle = () => new Promise((resolve) => setImmediate(resolve));
const readableRevision = (body: unknown, id: string) => projectDatesIntakeDetail(body, id)?.intake.revision ?? null;

test("reads take their turn; a reply to an earlier read never replaces a newer one, and nothing is adopted after unmount", async () => {
  const older = fixture("admin-detail-in-review-multi"), newer = fixture("admin-detail-in-review-partial");
  assert.ok(older.intake.revision < newer.intake.revision);
  const slowFirst = () => {
    let release!: (value: unknown) => void, first = true;
    const slow = new Promise((resolve) => { release = resolve; });
    return { answer: () => { if (first) { first = false; return slow; } return newer; }, release };
  };
  // Through the page's queue the second read is not even issued until the first is answered.
  const queued = slowFirst(), q = harness(xin(6), { dates_event_intake_detail: queued.answer });
  const one = q.api.load(), two = q.api.load(undefined, "quiet");
  await settle();
  assert.equal(q.calls("dates_event_intake_detail").length, 1, "the second read waits for the first");
  queued.release(older); await one;
  assert.equal(q.context.revision.current, older.intake.revision);
  await two;
  assert.equal(q.calls("dates_event_intake_detail").length, 2);
  assert.equal(q.state.Result.read.intake.published_count, 1); assert.equal(q.context.revision.current, newer.intake.revision);
  // Two reads that do overlap (outside the queue): the earlier one's reply is dropped.
  const direct = slowFirst(), h = harness(xin(6), { dates_event_intake_detail: direct.answer });
  const stale = h.api.read(), fresh = h.api.read(undefined, "quiet");
  await fresh;
  assert.equal(h.state.Result.read.intake.published_count, 1);
  const writes = [...h.writes];
  direct.release(older); await stale;
  assert.deepEqual(h.writes, writes); assert.equal(h.state.Result.read.intake.published_count, 1); assert.equal(h.context.revision.current, newer.intake.revision);
  // After unmount nothing is adopted either: not from a read in flight, not from one still waiting for its turn.
  const controller = new AbortController(), gone = harness(xin(6), { dates_event_intake_detail: newer });
  const pending = gone.api.read(controller.signal); controller.abort(); await pending;
  assert.deepEqual(gone.writes, ["State"], "only the loading state set before the request");
  const waiting = new AbortController(), never = harness(xin(6), { dates_event_intake_detail: newer });
  const turn = never.api.load(waiting.signal); waiting.abort(); await turn;
  assert.deepEqual(never.writes, []); assert.equal(never.calls("dates_event_intake_detail").length, 0);
});

test("review finding: a slow read cannot take the revision back behind a heartbeat, and the next command sends the newest revision", async () => {
  // One intake through its genuine receipts: claimed at revision 10, heartbeat to 11, release to 12.
  const text = fixture("admin-detail-in-review-text"), claim = fixture("admin-lease-claim"), beat = fixture("admin-lease-heartbeat"), release = fixture("admin-lease-release");
  const id = text.intake.intake_id;
  assert.deepEqual([claim.intake.intake_id, beat.intake.intake_id, release.intake.intake_id], [id, id, id]);
  assert.deepEqual([claim.intake.revision, beat.intake.revision, release.intake.revision], [10, 11, 12]);
  // DERIVED: the genuine detail as Core serves it at each of those revisions.
  const at = (receipt: any) => ({ ...text, intake: { ...text.intake, revision: receipt.intake.revision, lease: receipt.intake.lease } });
  const leaseAnswer = (body: any) => body.action === "heartbeat" ? beat : release;
  const slowDetail = () => { let open!: (value: unknown) => void; const reply = new Promise((resolve) => { open = resolve; }); return { reply, open }; };

  // 1. The reviewer's interleaving, as the page now orders it: the read was issued first, so the heartbeat waits for it.
  {
    const h = harness(id, { dates_event_intake_detail: at(claim), dates_event_intake_lease: leaseAnswer });
    await h.api.load();
    assert.equal(h.context.revision.current, 10);
    const slow = slowDetail(); h.table.dates_event_intake_detail = () => slow.reply;
    const poll = h.api.load(undefined, "quiet");
    const tick = h.context.serial.current(() => h.api.heartbeat(0));
    await settle();
    assert.equal(h.calls("dates_event_intake_lease").length, 0, "no heartbeat while the read is unanswered");
    h.table.dates_event_intake_detail = at(release);
    slow.open(at(claim)); await poll; await tick;
    assert.deepEqual(plain(h.calls("dates_event_intake_lease")[0].body), { intake_id: id, expected_revision: 10, action: "heartbeat" });
    assert.equal(h.context.revision.current, 11, "the heartbeat's receipt is the last word");
    assert.equal(h.state.Result.read.intake.revision, 11); assert.equal(h.state.Result.read.intake.lease.until, beat.intake.lease.until);
    // The next command is sent with 11 and Core accepts it: no false conflict.
    await h.api.lease("release");
    assert.deepEqual(plain(h.calls("dates_event_intake_lease")[1].body), { intake_id: id, expected_revision: 11, action: "release" });
    assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "lease.done.release" });
    assert.equal(h.context.revision.current, 12);
  }

  // 2. The revision never moves backwards even when a read does overlap a heartbeat (the read is called outside the
  //    queue here, which is exactly the interleaving the page had): the older body is not adopted, the read is issued again.
  for (const second of ["current", "stale"] as const) {
    const h = harness(id, { dates_event_intake_detail: at(claim), dates_event_intake_lease: leaseAnswer });
    await h.api.load();
    const slow = slowDetail(); h.table.dates_event_intake_detail = () => slow.reply;
    const late = h.api.read(undefined, "quiet");
    await h.api.heartbeat(0);
    assert.equal(h.context.revision.current, 11);
    const writes = [...h.writes];
    h.table.dates_event_intake_detail = second === "current" ? at(beat) : at(claim);
    slow.open(at(claim)); await late;
    assert.equal(h.calls("dates_event_intake_detail").length, 3, "the first read, the overtaken one, and its one re-issue");
    assert.equal(h.context.revision.current, 11, "never 10 again");
    if (second === "current") assert.equal(h.state.Result.read.intake.revision, 11);
    else assert.deepEqual(h.writes, writes, "a body older than the page's revision is not adopted at all");
    await h.api.lease("release");
    assert.deepEqual(plain(h.calls("dates_event_intake_lease")[1].body), { intake_id: id, expected_revision: 11, action: "release" });
  }

  // 3. A Refresh that only ever gets an older body says that it could not refresh.
  {
    const h = harness(id, { dates_event_intake_detail: at(beat) });
    await h.api.load(); h.table.dates_event_intake_detail = at(claim);
    await h.api.load(undefined, "refresh");
    assert.equal(h.context.revision.current, 11); assert.equal(h.state.Result.read.intake.revision, 11);
    assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "detail.refreshFailed" });
    // A first read after an error starts from nothing and adopts what Core serves.
    await h.api.load(undefined, "initial");
    assert.equal(h.context.revision.current, 10); assert.equal(h.state.State, "ready");
  }

  // The heartbeat renews nothing while a command is busy, a publication is saved, or the page was left.
  for (const change of [{ busyRef: { current: true } }, { pendingRef: { current: true } }, { lifetime: { current: 1 } }]) {
    const h = harness(id, { dates_event_intake_detail: at(claim), dates_event_intake_lease: leaseAnswer });
    await h.api.load(); Object.assign(h.context, change); await h.api.heartbeat(0);
    assert.equal(h.calls("dates_event_intake_lease").length, 0, JSON.stringify(change));
  }
  // A heartbeat Core refuses is followed by a read (inside the queue, so directly), not by a guess.
  const lost = harness(id, { dates_event_intake_detail: at(claim), dates_event_intake_lease: fixture("admin-lease-lost-denied") });
  await lost.api.load(); await lost.api.heartbeat(0);
  assert.equal(lost.calls("dates_event_intake_detail").length, 2); assert.equal(lost.context.revision.current, 10);

  // Every read the page issues from outside a command goes through the queue; code already in the queue reads directly.
  assert.match(source, /const load = useCallback\(\(signal\?: AbortSignal, mode: "initial" \| "quiet" \| "refresh" = "initial"\) =>\s+serial\.current\(\(\) => read\(signal, mode\)\), \[read\]\);/);
  assert.match(source, /const beat = \(\) => \{ void serial\.current\(\(\) => heartbeatRef\.current\(life\)\); \};/);
  assert.equal((source.match(/\bread\(/g) ?? []).length, 6, "the queued wrapper, the heartbeat's follow-up and the four commands");
  assert.equal((source.match(/revision\.current = /g) ?? []).length, 4, "reset on a first read, reset on a lost page, a read's adoption, and advance()");
});

test("a hold is taken with the revision the page holds, once, and the intake is read again", async () => {
  const detail = fixture("admin-detail-in-review-text"), receipt = fixture("admin-lease-claim");
  assert.equal(detail.intake.revision, receipt.intake.revision - 1);
  // After the claim Core serves the intake at the receipt's revision, held by the reviewer (DERIVED from the two genuine bodies).
  const claimed = { ...detail, intake: { ...detail.intake, revision: receipt.intake.revision, lease: receipt.intake.lease } };
  const h: ReturnType<typeof harness> = harness(detail.intake.intake_id, { dates_event_intake_lease: receipt,
    dates_event_intake_detail: () => h.calls("dates_event_intake_lease").length > 0 ? claimed : detail });
  await h.api.load();
  const first = h.api.lease("claim"); await h.api.lease("claim"); await first;
  assert.equal(h.calls("dates_event_intake_lease").length, 1, "a second click while busy sends nothing");
  assert.deepEqual(plain(h.calls("dates_event_intake_lease")[0].body), { intake_id: detail.intake.intake_id, expected_revision: receipt.intake.revision - 1, action: "claim" });
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "lease.done.claim" });
  assert.equal(h.calls("dates_event_intake_detail").length, 2, "read again after the command");
  assert.equal(h.context.revision.current, receipt.intake.revision); assert.equal(h.state.Result.read.intake.lease.mine, true);
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
  // Review finding: a timeout the bridge names, Core's in-progress reply and a server failure keep the command too -
  // none of them says whether the rejection landed - and the notice shows what was answered.
  for (const reply of [{ success: false, status_code: 504, error: "core-timeout" }, { success: false, status_code: 502, error: "core-unavailable" },
    { success: false, status_code: 409, error: "dates-admin-command-in-progress", message: 200, status: 200, can_send: 0 },
    { success: false, status_code: 503, error: "dates-admin-unavailable", message: 200, status: 200, can_send: 0 }]) {
    const kept = harness(receipt.intake.intake_id, { dates_event_intake_detail: null, dates_event_intake_reject: reply });
    kept.context.revision.current = 9;
    await kept.api.reject(null);
    const sent = plain(kept.calls("dates_event_intake_reject")[0].body);
    assert.deepEqual(plain(kept.state.Notice), { tone: "error", key: "reject.uncertain", error: reply.error });
    assert.deepEqual(plain(kept.state.RejectCommand), sent, `${reply.error}: the same command, key included, is the retry`);
    // The retry is that command, and Core's replay settles it.
    kept.table.dates_event_intake_reject = { ...receipt, replayed: true }; kept.context.revision.current = receipt.intake.revision - 1;
    await kept.api.reject({ ...kept.state.RejectCommand, expected_revision: receipt.intake.revision - 1 });
    assert.equal(plain(kept.calls("dates_event_intake_reject")[1].body).idempotency_key, sent.idempotency_key);
  }
  // The hold: the same replies are "not known" with the token, never "Core refused".
  for (const reply of [{ success: false, status_code: 504, error: "core-timeout" },
    { success: false, status_code: 503, error: "dates-admin-unavailable", message: 200, status: 200, can_send: 0 }]) {
    const hold = harness(receipt.intake.intake_id, { dates_event_intake_detail: null, dates_event_intake_lease: reply });
    hold.context.revision.current = 9;
    await hold.api.lease("claim");
    assert.deepEqual(plain(hold.state.Notice), { tone: "error", key: "lease.uncertain", error: reply.error });
  }
  const silent = harness(receipt.intake.intake_id, { dates_event_intake_detail: null, dates_event_intake_lease: null });
  silent.context.revision.current = 9; await silent.api.lease("claim");
  assert.deepEqual(plain(silent.state.Notice), { tone: "error", key: "lease.uncertain" });
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

test("review finding: with an unreadable sibling the page sends complete=false unless the reviewer explicitly closes the intake", async () => {
  // DERIVED - the reviewer's scenario: the genuine programme intake cut to two events, the second one undecodable.
  const base = fixture("admin-detail-in-review-multi");
  const body = { ...base, intake: { ...base.intake, event_count: 2, events: [base.intake.events[0], { ...base.intake.events[1], draft: { ...base.intake.events[1].draft, category: "hackathon" } }] } };
  const receipt = fixture("admin-publish-partial"), event = confirmedEvent();
  async function run(explicitClose: boolean) {
    const h = harness(base.intake.intake_id, { dates_event_intake_detail: body, dates_event_intake_publish: receipt });
    await h.api.load();
    const intake = h.state.Result.read.intake;
    assert.equal(intake.events[1], null, "the sibling is unknown to this console");
    h.context.revision.current = receipt.intake.revision - 1;
    // The page's own state at the moment the form is submitted: event 0 open, the choice as the reviewer left it.
    Object.assign(h.context, { openEvent: 0, completion: datesIntakeCompletion(intake, 0), close: explicitClose });
    h.api.propose(event, "Source and public venue verified.");
    const candidate = plain(h.state.Candidate);
    await h.api.publish({ candidate: h.state.Candidate });
    return { candidate, sent: plain(h.calls("dates_event_intake_publish")[0].body) };
  }
  // Default: the readable event is published, the intake stays open; Core is NOT told this was the last event.
  const kept = await run(false);
  assert.equal(kept.candidate.complete, false); assert.equal(kept.candidate.unreadable, 1);
  assert.equal(kept.sent.complete, false); assert.equal(kept.sent.event_index, 0);
  // Only the reviewer's explicit choice closes it, and that choice is what is sent.
  const closed = await run(true);
  assert.equal(closed.candidate.complete, true); assert.equal(closed.sent.complete, true);
  // Control, genuine one-event intake: nothing unknown, so the publication does finish the intake.
  const single = fixture("admin-detail-in-review-official"), h = harness(single.intake.intake_id, { dates_event_intake_detail: single, dates_event_intake_publish: fixture("admin-publish") });
  await h.api.load();
  Object.assign(h.context, { openEvent: 0, completion: datesIntakeCompletion(h.state.Result.read.intake, 0), close: false });
  h.api.propose(event, "Source and public venue verified.");
  assert.equal(h.state.Candidate.complete, true); assert.equal(h.state.Candidate.unreadable, 0);
  // Nothing is proposed while the page is blocked, without the capability, or without an open event.
  for (const change of [{ writeBlocked: true }, { can: { publish: false } }, { openEvent: null }, { completion: null }]) {
    const blocked = harness(single.intake.intake_id, {});
    Object.assign(blocked.context, { openEvent: 0, completion: { remaining: 0, unreadable: 0, mode: "last", question: "0|1|last||" }, close: false }, change);
    blocked.api.propose(event, "x"); assert.equal(blocked.writes.includes("Candidate"), false, JSON.stringify(change));
  }
  // The page takes the flag from the completion and from nothing else.
  assert.match(source, /complete: datesIntakeCompleteFlag\(completion, close\)/);
  assert.doesNotMatch(source, /publishable\.length === 1/);
  assert.match(source, /<DatesIntakeCompletionChoice completion=\{completion\} close=\{close\} disabled=\{writeBlocked\}\s+onChange=\{\(next\) => setAnswer\(\{ question: completion\.question, close: next \}\)\} \/>/);
});

test("review recheck: a served revision this console cannot read never replaces a known one", async () => {
  // The genuine receipts of one intake again: claimed at 10, heartbeat to 11, release to 12.
  const text = fixture("admin-detail-in-review-text"), claim = fixture("admin-lease-claim"), beat = fixture("admin-lease-heartbeat"), release = fixture("admin-lease-release");
  const id = text.intake.intake_id;
  const at = (receipt: any) => ({ ...text, intake: { ...text.intake, revision: receipt.intake.revision, lease: receipt.intake.lease } });
  // DERIVED: the same detail with the revision in shapes Core does not serve today - a future type, a fraction, nothing.
  for (const malformed of ["12", 12.5, null, { value: 12 }, -1]) {
    const h = harness(id, { dates_event_intake_detail: at(claim), dates_event_intake_lease: (body: any) => body.action === "heartbeat" ? beat : release });
    await h.api.load(); await h.api.heartbeat(0);
    assert.equal(h.context.revision.current, 11);
    const shown = plain(h.state.Result.read.intake);
    assert.equal(shown.revision, 11); assert.equal(shown.controls, true); assert.equal(shown.lease.mine, true);
    const unreadable = { ...at(beat), intake: { ...at(beat).intake, revision: malformed } };
    assert.equal(readableRevision(unreadable, id), null, `${JSON.stringify(malformed)}: the projection has no revision`);
    h.table.dates_event_intake_detail = unreadable;
    let writes = [...h.writes];
    // The worker's poll and the read after a command: the page keeps what it holds, and marks the read.
    await h.api.load(undefined, "quiet");
    assert.equal(h.context.revision.current, 11, "the known revision stays");
    assert.deepEqual(h.writes.slice(writes.length), ["StaleRead"]); assert.equal(h.state.StaleRead, true);
    assert.deepEqual(plain(h.state.Result.read.intake), shown, "controls and the hold stay as they were read");
    // Refresh says that it could not refresh.
    writes = [...h.writes];
    await h.api.load(undefined, "refresh");
    assert.deepEqual(h.writes.slice(writes.length), ["StaleRead", "Notice"]);
    assert.deepEqual(plain(h.state.Notice), { tone: "error", key: "detail.refreshFailed" }); assert.equal(h.context.revision.current, 11);
    // The hold is still renewed, with the revision the page knows, and the next command carries the receipt's.
    h.table.dates_event_intake_lease = (body: any) => body.action === "heartbeat" ? { ...beat, intake: { ...beat.intake, revision: 12 } } : { ...release, intake: { ...release.intake, revision: 13 } };
    h.table.dates_event_intake_detail = unreadable;
    await h.api.heartbeat(0);
    assert.deepEqual(plain(h.calls("dates_event_intake_lease").at(-1)!.body), { intake_id: id, expected_revision: 11, action: "heartbeat" });
    assert.equal(h.context.revision.current, 12);
    await h.api.lease("release");
    assert.deepEqual(plain(h.calls("dates_event_intake_lease").at(-1)!.body), { intake_id: id, expected_revision: 12, action: "release" });
    assert.equal(h.context.revision.current, 13, "never null");
    // A read that is whole again is adopted and clears the mark.
    h.table.dates_event_intake_detail = { ...text, intake: { ...text.intake, revision: 13, lease: release.intake.lease } };
    await h.api.load(undefined, "quiet");
    assert.equal(h.state.StaleRead, false); assert.equal(h.state.Result.read.intake.revision, 13);
  }
  // A first read has nothing to protect: the unreadable revision is shown as it is, with the controls off.
  const first = harness(id, { dates_event_intake_detail: { ...text, intake: { ...text.intake, revision: "9" } } });
  await first.api.load();
  assert.equal(first.state.State, "ready"); assert.equal(first.context.revision.current, null); assert.equal(first.state.Result.read.intake.controls, false);
  await first.api.lease("claim"); assert.equal(first.calls("dates_event_intake_lease").length, 0, "no command without a revision");
  // The mark is shown as words, in both languages.
  assert.match(source, /\{staleRead && state === "ready" && <p className="alert alert-warning" role="status">\{t\("detail\.revisionUnreadable"\)\}<\/p>\}/);
  for (const locale of ["en", "hu"]) assert.equal(typeof JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.intake.detail.revisionUnreadable, "string");
});

test("review recheck: a completion choice belongs to the set of events it was made for; a Refresh that changes the set asks again", async () => {
  // DERIVED - the reviewer's scenario: the genuine programme intake cut to two readable events...
  const base = fixture("admin-detail-in-review-multi"), id = base.intake.intake_id;
  const two = { ...base, intake: { ...base.intake, event_count: 2, events: base.intake.events.slice(0, 2) } };
  // ...and the same intake as a later read serves it, the sibling now in a shape this console cannot decode.
  const damaged = { ...two, intake: { ...two.intake, events: [two.intake.events[0], { ...two.intake.events[1], draft: { ...two.intake.events[1].draft, category: "hackathon" } }] } };
  const before = projectDatesIntakeDetail(two, id)!.intake, after = projectDatesIntakeDetail(damaged, id)!.intake;
  const ordinary = datesIntakeCompletion(before, 0), dangerous = datesIntakeCompletion(after, 0);
  assert.deepEqual([ordinary.mode, dangerous.mode], ["choice", "unreadable"]);
  assert.notEqual(ordinary.question, dangerous.question);
  // The reviewer ticks the ordinary "this is the last one".
  const answer = { question: ordinary.question, close: true };
  assert.equal(datesIntakeCompletionChoice(answer, ordinary), true);
  // After the Refresh the question is another one: the old tick is not an answer to it.
  assert.equal(datesIntakeCompletionChoice(answer, dangerous), false, "back at the safe default");
  assert.equal(datesIntakeCompleteFlag(dangerous, datesIntakeCompletionChoice(answer, dangerous)), false);
  // Every change of the set asks again: a sibling published elsewhere, a sibling that became readable again, another
  // event opened, an event added. The same set keeps the answer.
  const partial = projectDatesIntakeDetail(fixture("admin-detail-in-review-partial"), fixture("admin-detail-in-review-partial").intake.intake_id)!.intake;
  const whole = projectDatesIntakeDetail(base, id)!.intake;
  const questions = [ordinary, dangerous, datesIntakeCompletion(before, 1), datesIntakeCompletion(whole, 0), datesIntakeCompletion(partial, 1),
    datesIntakeCompletion({ ...after, events: [after.events![0], after.events![1], null] }, 0)].map((completion) => completion.question);
  assert.equal(new Set(questions).size, questions.length, "six different questions");
  for (const question of questions.slice(1)) assert.equal(datesIntakeCompletionChoice({ question, close: true }, ordinary), false);
  assert.equal(datesIntakeCompletionChoice(answer, datesIntakeCompletion(projectDatesIntakeDetail(two, id)!.intake, 0)), true, "an unchanged set keeps the answer");
  assert.equal(datesIntakeCompletionChoice(null, ordinary), false); assert.equal(datesIntakeCompletionChoice(answer, null), false);
  // An explicit choice made under the new question is honoured, and is what the page sends.
  assert.equal(datesIntakeCompletionChoice({ question: dangerous.question, close: true }, dangerous), true);

  // The page, as it is: the read adopts the damaged body; the tick made before it does not reach Core.
  const receipt = fixture("admin-publish-partial"), event = confirmedEvent();
  const h = harness(id, { dates_event_intake_detail: two, dates_event_intake_publish: receipt });
  await h.api.load();
  const ticked = { question: datesIntakeCompletion(h.state.Result.read.intake, 0).question, close: true };
  h.table.dates_event_intake_detail = damaged;
  await h.api.load(undefined, "refresh");
  const shown = h.state.Result.read.intake;
  assert.equal(shown.events[1], null);
  h.context.revision.current = receipt.intake.revision - 1;
  // What the component derives on that render, with its own two functions.
  const completion = datesIntakeCompletion(shown, 0);
  Object.assign(h.context, { openEvent: 0, completion, close: datesIntakeCompletionChoice(ticked, completion) });
  h.api.propose(event, "Source and public venue verified.");
  assert.equal(h.state.Candidate.complete, false); assert.equal(h.state.Candidate.question, completion.question);
  await h.api.publish({ candidate: h.state.Candidate });
  assert.equal(plain(h.calls("dates_event_intake_publish")[0].body).complete, false, "the intake is left open");

  // A publication already waiting for its confirmation when the set changes is not confirmable any more.
  const prepared = { eventIndex: 0, question: ordinary.question };
  assert.equal(datesIntakeCandidateCurrent(prepared, before), true);
  assert.equal(datesIntakeCandidateCurrent(prepared, after), false);
  assert.equal(datesIntakeCandidateCurrent(prepared, null), false); assert.equal(datesIntakeCandidateCurrent(null, before), false);
  // ...nor one whose event was published meanwhile (the genuine partly published intake: event 0 is done).
  assert.equal(datesIntakeCandidateCurrent({ eventIndex: 0, question: datesIntakeCompletion(partial, 0).question }, partial), false);

  // The page derives both from the question and keeps no bare boolean.
  assert.match(source, /const close = datesIntakeCompletionChoice\(answer, completion\);/);
  assert.match(source, /const confirmable = datesIntakeCandidateCurrent\(candidate, intake\) \? candidate : null;/);
  assert.match(source, /\{confirmable && <ConfirmDialog [^\n]+\n\s+onCancel=\{[^\n]+\} onConfirm=\{\(\) => void publish\(\{ candidate: confirmable \}\)\}>/);
  assert.match(source, /\{candidate && !confirmable && <p className="alert alert-warning" role="status">\{t\("editor\.changed"\)\}<\/p>\}/);
  assert.doesNotMatch(source, /setComplete|useState\(false\);\s+const \[candidate/);
  assert.doesNotMatch(source, /publish\(\{ candidate \}\)/);
  for (const locale of ["en", "hu"]) assert.equal(typeof JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.intake.editor.changed, "string");
});

// ---------------------------------------------------------------- T-886: the member-intake side

test("T-886: asking the member sends one request with the page's revision; the receipt moves the revision and the draft leaves the reviewer", async () => {
  const before = fixture("admin-detail-member-in-review"), after = fixture("admin-detail-member-asked"), receipt = fixture("admin-ask-member");
  const id = receipt.intake.intake_id;
  assert.equal(before.intake.intake_id, id); assert.equal(after.intake.intake_id, id); assert.equal(after.intake.revision, receipt.intake.revision);
  let asked = false;
  // The switch is read from Core's genuine queue body of the member channel (on); the empty queue of the other tests was captured with it off.
  const h = harness(id, { dates_event_intake_detail: () => asked ? after : before, dates_event_intake_ask_member: () => { asked = true; return receipt; },
    dates_event_intake_list: { ...fixture("admin-list-member-channel"), limit: 1 } });
  assert.equal(fixture("admin-list-empty").suggestions_enabled, false);
  await h.api.load();
  assert.equal(h.state.Result.read.intake.member.can_ask, true); assert.equal(h.state.Result.suggestionsEnabled, true);
  // The genuine receipt answers revision 13 (the hold the reviewer took in between); the page holds that revision.
  h.context.revision.current = receipt.intake.revision - 1;
  h.context.askDraft = { fields: ["starts_local", "venue_address"], note: " Biztosan reggel 9-kor kezdődik? ", reason: " The flyer and the text disagree. " };
  h.context.openEvent = 0;
  await h.api.ask(null);
  const sent = plain(h.calls("dates_event_intake_ask_member"));
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0].body, idempotency_key: null }, { intake_id: id, expected_revision: receipt.intake.revision - 1, fields: ["starts_local", "venue_address"],
    reason: "The flyer and the text disagree.", idempotency_key: null, member_note: "Biztosan reggel 9-kor kezdődik?" });
  assert.match(sent[0].body.idempotency_key, /^dates-intake-ask:[0-9a-f-]{36}$/);
  // The time in the message is the one Core answered with - not the browser's clock, not a constant of the console.
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "ask.done", time: receipt.asked.due_at });
  assert.equal(h.state.AskDraft, null); assert.equal(h.state.AskCommand, null); assert.equal(h.state.OpenEvent, null); assert.equal(h.state.Candidate, null);
  assert.equal(h.context.revision.current, receipt.intake.revision, "the receipt's revision, then the read's");
  // The page then shows what Core says now: with the member, asked by a reviewer, not askable again.
  const shown = h.state.Result.read.intake;
  assert.equal(shown.status, "member_confirming");
  assert.deepEqual(plain(shown.member.confirmation), { state: "awaiting", at: null, due_at: receipt.asked.due_at, asked_by_reviewer: true,
    fields: ["starts_local", "venue_address"], note: "Biztosan reggel 9-kor kezdődik?" });
  assert.equal(shown.member.can_ask, false);

  // The receipt alone moves the revision: when the read that follows cannot be made, the page still holds the
  // revision Core answered with, and the next command would go out with it.
  let answered = false;
  const blind = harness(id, { dates_event_intake_detail: () => answered ? null : before, dates_event_intake_ask_member: () => { answered = true; return receipt; },
    dates_event_intake_list: { ...fixture("admin-list-member-channel"), limit: 1 } });
  await blind.api.load(); blind.context.revision.current = receipt.intake.revision - 1;
  blind.context.askDraft = { fields: ["starts_local", "venue_address"], note: "", reason: "why" };
  await blind.api.ask(null);
  assert.deepEqual(plain(blind.state.Notice), { tone: "success", key: "ask.done", time: receipt.asked.due_at });
  assert.equal(blind.context.revision.current, receipt.intake.revision); assert.equal(blind.state.Result.read.intake.status, "in_review", "the failed read wiped nothing");

  // Nothing is sent for a request the console itself would not make, or without a draft.
  for (const draft of [null, { fields: [], note: "", reason: "why" }, { fields: ["title"], note: "", reason: "  " }, { fields: ["title"], note: "x".repeat(501), reason: "why" }]) {
    const none = harness(id, { dates_event_intake_detail: before, dates_event_intake_ask_member: receipt });
    await none.api.load(); none.context.askDraft = draft;
    await none.api.ask(null);
    assert.equal(none.calls("dates_event_intake_ask_member").length, 0, JSON.stringify(draft)?.slice(0, 60));
    assert.deepEqual(plain(none.state.Notice), { tone: "error", key: "ask.invalid" });
  }
});

test("T-886: an unanswered request to the member keeps its identity for the retry; Core's refusal is shown as it is and ends it", async () => {
  const before = fixture("admin-detail-member-in-review"), receipt = fixture("admin-ask-member"), id = receipt.intake.intake_id;
  const draft = { fields: ["title"], note: "", reason: "The title is cut off." };
  for (const reply of [null, { success: false, status_code: 504, error: "core-timeout" }, { success: false, status_code: 502, error: "core-unavailable" },
    { success: false, status_code: 409, error: "dates-admin-command-in-progress", message: 200, status: 200, can_send: 0 },
    { success: false, status_code: 503, error: "dates-admin-unavailable", message: 200, status: 200, can_send: 0 }, { success: true },
    fixture("admin-ask-member-viewer-denied")]) {
    const kept = harness(id, { dates_event_intake_detail: before, dates_event_intake_ask_member: reply });
    await kept.api.load(); kept.context.revision.current = receipt.intake.revision - 1; kept.context.askDraft = draft;
    await kept.api.ask(null);
    const sent = plain(kept.calls("dates_event_intake_ask_member")[0].body);
    const error = reply && (reply as { success: boolean }).success === false ? (reply as { error: string }).error : undefined;
    // Not known: never "sent", never "refused".
    assert.deepEqual(plain(kept.state.Notice), { tone: "error", key: "ask.uncertain", ...(error === undefined ? {} : { error }) }, JSON.stringify(reply));
    assert.deepEqual(plain(kept.state.AskCommand), sent, "the same command, key included, is the retry");
    // The retry is that command; Core's genuine replay settles it. A request with the title only is answered by a
    // receipt about the title only, so the replay is DERIVED from the genuine one by its echoed fields.
    kept.table.dates_event_intake_ask_member = { ...fixture("admin-ask-member-replay"), asked: { fields: ["title"], due_at: receipt.asked.due_at } };
    await kept.api.ask(kept.state.AskCommand);
    assert.deepEqual(plain(kept.calls("dates_event_intake_ask_member")[1].body), sent);
    assert.deepEqual(plain(kept.state.Notice), { tone: "success", key: "ask.done", time: receipt.asked.due_at }); assert.equal(kept.state.AskCommand, null);
  }
  for (const name of ["ask-member-lease-required", "ask-member-state-invalid", "ask-member-not-a-suggestion", "ask-member-suggestions-disabled", "ask-member-input-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`);
    const refused = harness(id, { dates_event_intake_detail: before, dates_event_intake_ask_member: refusal });
    await refused.api.load(); refused.context.askDraft = draft;
    await refused.api.ask(null);
    assert.deepEqual(plain(refused.state.Notice), { tone: "error", key: "refused", error: refusal.error }, name);
    assert.equal(refused.state.AskCommand, null, name);
    assert.equal(refused.calls("dates_event_intake_detail").length, 2, "read again after the refusal");
  }
});

test("T-886: a rejection names the event it duplicates only with the reason duplicate, and the outcome is said as what it is", async () => {
  const detail = fixture("admin-detail-member-in-review"), receipt = fixture("admin-duplicate-of-event"), id = receipt.intake.intake_id;
  const event = fixture("admin-detail-member-duplicate").intake.duplicate_of.id;
  const body = { ...detail, intake: { ...detail.intake, intake_id: id } };
  const h = harness(id, { dates_event_intake_detail: body, dates_event_intake_reject: receipt });
  await h.api.load(); h.context.revision.current = receipt.intake.revision - 1;
  Object.assign(h.context, { rejectCode: "duplicate", rejectNote: "The same yoga morning is already listed.", duplicateOf: ` ${event} ` });
  await h.api.reject(null);
  const sent = plain(h.calls("dates_event_intake_reject")[0].body);
  assert.deepEqual({ ...sent, idempotency_key: null }, { intake_id: id, expected_revision: receipt.intake.revision - 1, reason_code: "duplicate",
    reason: "The same yoga morning is already listed.", idempotency_key: null, duplicate_of_external_event_id: event });
  assert.deepEqual(plain(h.state.Notice), { tone: "success", key: "reject.doneDuplicate" });
  assert.equal(h.state.DuplicateOf, ""); assert.equal(h.state.RejectNote, ""); assert.equal(h.state.RejectCommand, null);
  // With any other reason a typed name is not sent (the field is not on screen then, and the page clears it on a change of reason).
  const other = harness(id, { dates_event_intake_detail: body, dates_event_intake_reject: fixture("admin-reject-member-spam") });
  await other.api.load(); other.context.revision.current = 11;
  Object.assign(other.context, { rejectCode: "spam_or_fake", rejectNote: "Not an event.", duplicateOf: event });
  await other.api.reject(null);
  assert.equal(Object.hasOwn(plain(other.calls("dates_event_intake_reject")[0].body), "duplicate_of_external_event_id"), false);
  assert.match(source, /onChange=\{\(change\) => \{ setRejectCommand\(null\); setDuplicateOf\(""\); setRejectCode\(change\.target\.value\); \}\}/);
  // A name that is not an event id is never sent and never dropped: the command is not made.
  const wrong = harness(id, { dates_event_intake_detail: body, dates_event_intake_reject: receipt });
  await wrong.api.load(); wrong.context.revision.current = receipt.intake.revision - 1;
  Object.assign(wrong.context, { rejectCode: "duplicate", rejectNote: "Already listed.", duplicateOf: "xev_5" });
  await wrong.api.reject(null);
  assert.equal(wrong.calls("dates_event_intake_reject").length, 0); assert.deepEqual(plain(wrong.state.Notice), { tone: "error", key: "reject.invalid" });
  assert.match(source, /if \(namedDuplicate !== "" && !datesExternalEventId\(namedDuplicate\)\) \{ setNotice\(\{ tone: "error", key: "reject\.duplicateInvalid" \}\); return; \}/);
  // Core's genuine refusal of an event that is not there keeps nothing and says so with its token.
  const missing = harness(id, { dates_event_intake_detail: body, dates_event_intake_reject: fixture("admin-reject-duplicate-event-unavailable-denied") });
  await missing.api.load(); missing.context.revision.current = receipt.intake.revision - 1;
  Object.assign(missing.context, { rejectCode: "duplicate", rejectNote: "Already listed.", duplicateOf: event });
  await missing.api.reject(null);
  assert.deepEqual(plain(missing.state.Notice), { tone: "error", key: "refused", error: "dates-intake-duplicate-event-unavailable" }); assert.equal(missing.state.RejectCommand, null);
  // An unanswered named rejection keeps the name with its identity: the retry is that command.
  const lost = harness(id, { dates_event_intake_detail: body, dates_event_intake_reject: null });
  await lost.api.load(); lost.context.revision.current = receipt.intake.revision - 1;
  Object.assign(lost.context, { rejectCode: "duplicate", rejectNote: "Already listed.", duplicateOf: event });
  await lost.api.reject(null);
  assert.equal(plain(lost.state.RejectCommand).duplicate_of_external_event_id, event);
  lost.table.dates_event_intake_reject = { ...receipt, replayed: true }; lost.context.duplicateOf = "";
  await lost.api.reject(lost.state.RejectCommand);
  assert.deepEqual(plain(lost.calls("dates_event_intake_reject")[1].body), plain(lost.calls("dates_event_intake_reject")[0].body));
  assert.deepEqual(plain(lost.state.Notice), { tone: "success", key: "reject.doneDuplicate" });
});

test("T-886: what the review screen shows and offers for a member's suggestion is wired to Core's word, not to the page's guess", () => {
  // The member's side, the second-look mark, and the switch that publishing a suggestion needs.
  assert.match(source, /<DatesIntakeMemberPanel intake=\{intake\} \/>/);
  assert.match(source, /\{datesIntakeSecondLookOpen\(intake\) && <p className="alert alert-warning" role="status">\{t\("detail\.secondLook"\)\}<\/p>\}/);
  assert.match(source, /draftsEnabled: result\?\.draftsEnabled !== false, suggestionsEnabled: result\?\.suggestionsEnabled !== false \};/);
  assert.match(source, /const asking = intake \? datesIntakeAskState\(intake, \{ review: access\.review, suggestionsEnabled: result\?\.suggestionsEnabled \?\? null \}\) : null;/);
  // The form proposes; a dialog confirms; the command reads the draft the dialog showed.
  assert.match(source, /onReview=\{\(draft\) => \{ if \(datesIntakeAskValid\(draft\.fields, draft\.note, draft\.reason\)\) setAskDraft\(draft\); else setNotice\(\{ tone: "error", key: "ask\.invalid" \}\); \}\}/);
  assert.match(source, /\{askDraft && <ConfirmDialog title=\{t\("ask\.title"\)\}[^\n]+\n\s+onCancel=\{\(\) => \{ if \(!busyRef\.current\) setAskDraft\(null\); \}\} onConfirm=\{\(\) => void ask\(null\)\}>/);
  assert.match(source, /onRetry=\{\(\) => \{ if \(askCommand\) void ask\(askCommand\); \}\}/); assert.match(source, /onChanged=\{\(\) => setAskCommand\(null\)\}/);
  // Before a rejection and before a publication the reviewer is told what it means for the member.
  assert.equal((source.match(/<DatesIntakeMemberRejectNotes intake=\{intake\} reasonCode=\{rejectCode\} namesEvent=\{namedDuplicate !== ""\} \/>/g) ?? []).length, 2, "in the form and in the confirmation");
  assert.match(source, /\{suggestion && intake && <DatesIntakeMemberPublishNotes member=\{intake\.member\} events=\{intake\.events\?\.length \?\? 0\} secondLookStrike=\{datesIntakeSecondLookStrike\(intake\)\} \/>\}/);
  // The events Core's own duplicate check pointed at are offered as the name; nothing else is.
  assert.match(source, /item\.kind === "event" && datesExternalEventId\(item\.id\) \? \[item\.id\] : \[\]/);
  // No member data is fetched for this screen: the page reads the detail, the operator and the one-row queue - nothing of a member.
  assert.doesNotMatch(source, /admin_user|user_detail|member_detail|users\/|\/members\//);
});

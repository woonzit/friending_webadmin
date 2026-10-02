import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { readDatesExternalPending } from "../lib/datesExternalMutations.ts";
import { datesIntakeCompleteFlag, datesIntakeCompletion, datesIntakeEditorDraft, datesIntakeHeartbeatDelay, projectDatesIntakeDetail } from "../lib/datesIntakeAdmin.ts";
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
const callback = (name: string) => {
  const declaration = page.body!.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find((node) => node.name.getText(tree) === name)!;
  assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(tree) === "useCallback", name);
  return (declaration.initializer as ts.CallExpression).arguments[0].getText(tree);
};
const FUNCTIONS = ["advance", "heartbeat", "command", "lease", "reject", "publish", "propose"];
for (const name of FUNCTIONS) assert.ok(declared(name), name);
const gone = tree.statements.find((node) => ts.isVariableStatement(node) && node.getText(tree).startsWith("const GONE"))!;
const code = ts.transpileModule(`${gone.getText(tree)}
  const read = ${callback("read")};
  const load = ${callback("load")};
  ${FUNCTIONS.map((name) => declared(name).getText(tree)).join("\n")}
  exports.read = read; exports.load = load; exports.heartbeat = heartbeat;
  exports.lease = lease; exports.reject = reject; exports.publish = publish; exports.propose = propose;`,
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
    datesIntakeCompleteFlag, writeBlocked: false, can: { publish: true }, openEvent: null, completion: null, complete: false,
    datesExternalBrowserStorage: () => storage,
    adminCall: async (action: string, body: any) => { sent.push({ action, body });
      const answer = table[action]; return typeof answer === "function" ? (answer as (body: unknown) => unknown)(body) : answer; } };
  for (const name of ["State", "Result", "Operator", "Problem", "Notice", "Busy", "Pending", "OpenEvent", "Complete", "Candidate", "RejectCommand", "RejectNote", "ConfirmReject"])
    context[`set${name}`] = (value: unknown) => { state[name] = typeof value === "function" ? value(state[name]) : value; writes.push(name);
      if (name === "Operator") context.operator = value; };
  vm.runInNewContext(code, context);
  const commands = sent.filter.bind(sent);
  return { context, state, writes, sent, table, rows, storage, api: context.exports as { load: (signal?: AbortSignal, mode?: string) => Promise<void>;
    read: (signal?: AbortSignal, mode?: string) => Promise<void>; heartbeat: (life: number) => Promise<void>;
    lease: (action: string) => Promise<void>; reject: (retry: unknown) => Promise<void>; publish: (input: unknown) => Promise<void>;
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
  assert.equal((source.match(/\bread\(/g) ?? []).length, 5, "the queued wrapper, the heartbeat's follow-up and the three commands");
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
    Object.assign(h.context, { openEvent: 0, completion: datesIntakeCompletion(intake, 0), complete: explicitClose });
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
  Object.assign(h.context, { openEvent: 0, completion: datesIntakeCompletion(h.state.Result.read.intake, 0), complete: false });
  h.api.propose(event, "Source and public venue verified.");
  assert.equal(h.state.Candidate.complete, true); assert.equal(h.state.Candidate.unreadable, 0);
  // Nothing is proposed while the page is blocked, without the capability, or without an open event.
  for (const change of [{ writeBlocked: true }, { can: { publish: false } }, { openEvent: null }, { completion: null }]) {
    const blocked = harness(single.intake.intake_id, {});
    Object.assign(blocked.context, { openEvent: 0, completion: { remaining: 0, unreadable: 0, mode: "last" }, complete: false }, change);
    blocked.api.propose(event, "x"); assert.equal(blocked.writes.includes("Candidate"), false, JSON.stringify(change));
  }
  // The page takes the flag from the completion and from nothing else.
  assert.match(source, /complete: datesIntakeCompleteFlag\(completion, complete\)/);
  assert.doesNotMatch(source, /publishable\.length === 1/);
  assert.match(source, /<DatesIntakeCompletionChoice completion=\{completion\} close=\{complete\} disabled=\{writeBlocked\} onChange=\{setComplete\} \/>/);
});

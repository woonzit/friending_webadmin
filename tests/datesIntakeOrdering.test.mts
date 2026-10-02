import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readDatesAiUsage, readDatesIntakeQueue, runDatesIntakeLease } from "../lib/datesIntakeConsole.ts";

// The queue page's own load, effect and lease callbacks under controlled
// request ordering (the T-876 lesson). Source-handler regressions run against
// the production functions, not React or browser mounts.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
function component(path: string, name: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration?.body);
  return { source, tree, body: declaration.body };
}
function compile(source: string) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }
// Values created inside the vm context belong to another realm; compare their plain content.
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((done) => { resolve = done; }); return { promise, resolve }; }
function callbacks(page: ReturnType<typeof component>) {
  const declaration = page.body.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find((node) => node.name.getText(page.tree) === "load");
  assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer));
  const effect = page.body.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(page.tree) === "useEffect");
  assert.ok(effect && ts.isExpressionStatement(effect) && ts.isCallExpression(effect.expression));
  return { load: declaration.initializer.arguments[0].getText(page.tree), effect: effect.expression.arguments[0].getText(page.tree),
    dependencies: effect.expression.arguments[1].getText(page.tree) };
}
const identity = (capabilities: string[]) => ({ success: true, role: "admin", dates: { email: "operator@example.test", role: "moderator", rank: 20,
  linked_uid: null, sensitive_location: false, break_glass: false, capabilities } });
const reviewer = identity(["dates_external_event_read", "dates_external_event_review"]);

const queue = component("../app/(dashboard)/dates/intakes/page.tsx", "DatesIntakeQueuePage");
const queueCallbacks = callbacks(queue);
const queueCode = compile(`exports.load = ${queueCallbacks.load}; exports.effect = ${queueCallbacks.effect};`);
const lease = queue.body.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "lease");
assert.ok(lease);

function queueHarness() {
  const loadGeneration = { current: 0 }, writes: string[] = [], state = { queue: null as any, status: "ready", operator: null as any, problem: null as any };
  function render(status: string, page: number, limit = 40) {
    const response = deferred(), membership = deferred(); let pending: Promise<void> | undefined;
    const context: any = { exports: {}, AbortController, status, channel: "", page, PAGE_SIZE: limit, loadGeneration, readDatesIntakeQueue,
      adminCall: (action: string) => action === "admin_me" ? membership.promise : response.promise,
      setState: (value: string) => { state.status = value; writes.push("state"); },
      setQueue: (value: unknown) => { state.queue = value; writes.push("queue"); },
      setOperator: (value: unknown) => { state.operator = value; writes.push("operator"); },
      setProblem: (value: unknown) => { state.problem = value; writes.push("problem"); } };
    vm.runInNewContext(queueCode, context);
    context.load = (signal?: AbortSignal) => { pending = context.exports.load(signal); return pending; };
    return { load: context.exports.load as (signal?: AbortSignal) => Promise<void>,
      reply: (value: unknown, who: unknown = reviewer) => { response.resolve(value); membership.resolve(who); },
      effect: () => ({ cleanup: context.exports.effect() as () => void, pending: pending! }) };
  }
  return { render, state, writes, loadGeneration };
}

test("intake queue Refresh and Retry share one generation that the effect cleanup invalidates", () => {
  assert.match(queue.source, /loadGeneration = useRef\(0\)/);
  assert.equal(queueCallbacks.dependencies, "[load]");
  assert.match(queueCallbacks.load, /const generation = \+\+loadGeneration\.current;/);
  assert.match(queueCallbacks.load, /if \(signal\?\.aborted \|\| generation !== loadGeneration\.current\) return;/);
  assert.match(queueCallbacks.effect, /controller\.abort\(\); \+\+loadGeneration\.current;/);
});

for (const older of ["success", "failure"] as const) test(`intake queue drops a late ${older} of an earlier filter after the filter changed`, async () => {
  const all = fixture("admin-list-all"), review = fixture("admin-list-in-review");
  const h = queueHarness(), old = h.render("", 1, all.limit), oldPending = old.load();
  const fresh = h.render("in_review", 1, review.limit), current = fresh.effect();
  fresh.reply(review); await current.pending;
  assert.equal(h.state.status, "ready"); assert.equal(h.state.queue.intakes.length, review.intakes.length);
  const writes = [...h.writes], shown = h.state.queue;
  // The superseded reply arrives last and changes nothing: not the rows, not the state, not the error.
  old.reply(older === "success" ? all : null); await oldPending;
  assert.deepEqual(h.writes, writes); assert.equal(h.state.queue, shown); assert.equal(h.state.status, "ready"); assert.equal(h.state.problem, null);
});

test("intake queue drops the reply of a manual refresh that a page change superseded, and of anything after unmount", async () => {
  const list = fixture("admin-list-page-two");
  const h = queueHarness(), first = h.render("", 1, list.limit), mount = first.effect();
  const refresh = h.render("", 1, list.limit), refreshing = refresh.load();
  const next = h.render("", list.page, list.limit), moved = next.effect();
  next.reply(list); await moved.pending;
  const writes = [...h.writes];
  first.reply(fixture("admin-list-all")); refresh.reply(fixture("admin-list-all")); await Promise.all([mount.pending, refreshing]);
  assert.deepEqual(h.writes, writes); assert.equal(h.state.queue.page, list.page);
  // Unmount invalidates even a request that was started without an AbortSignal.
  const late = h.render("", list.page, list.limit), latePending = late.load();
  moved.cleanup(); const after = [...h.writes];
  late.reply(list); await latePending;
  assert.deepEqual(h.writes, after);
});

test("the current intake queue reply is ready, a confirmed capability loss, Core's refusal, or unconfirmed - never an empty queue", async () => {
  const list = fixture("admin-list-in-review");
  const cases: Array<[unknown, unknown, unknown]> = [
    [fixture("admin-list-viewer-denied"), identity(["dates_external_event_read"]), { kind: "denied" }],
    [fixture("admin-list-filter-invalid-denied"), reviewer, { kind: "refused", error: "dates-intake-filter-invalid" }],
    [null, reviewer, { kind: "unconfirmed" }], [{ success: true, intakes: [] }, reviewer, { kind: "unconfirmed" }], [list, null, { kind: "unconfirmed" }],
  ];
  for (const [response, who, problem] of cases) {
    const h = queueHarness(), current = h.render("in_review", 1, list.limit), pending = current.load();
    current.reply(response, who); await pending;
    assert.equal(h.state.status, "error"); assert.equal(h.state.queue, null); assert.equal(h.state.operator, null); assert.deepEqual(plain(h.state.problem), problem);
  }
  const ok = queueHarness(), current = ok.render("in_review", 1, list.limit), pending = current.load();
  current.reply(list); await pending;
  assert.equal(ok.state.status, "ready"); assert.equal(ok.state.problem, null); assert.equal(ok.state.operator.review, true);
});

function leaseHarness(answer: unknown) {
  const sent: unknown[] = [], writes: string[] = [], state: any = {}, loadGeneration = { current: 0 }, busyRef = { current: false };
  const response = deferred();
  const context: any = { exports: {}, busyRef, loadGeneration, runDatesIntakeLease,
    adminCall: (action: string, body: unknown) => { sent.push({ action, body }); return response.promise; },
    setBusy: (value: string) => { state.busy = value; }, setNotice: (value: unknown) => { state.notice = value; writes.push("notice"); },
    load: async () => { writes.push("load"); } };
  vm.runInNewContext(compile(`${lease.getText(queue.tree)}; exports.lease = lease;`), context);
  return { sent, writes, state, loadGeneration, busyRef, reply: () => response.resolve(answer), lease: context.exports.lease as (row: unknown, action: string) => Promise<void> };
}

test("a hold taken from the queue sends the row's revision once and reads the queue again", async () => {
  const receipt = fixture("admin-lease-claim");
  const row = { intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 };
  const h = leaseHarness(receipt), first = h.lease(row, "claim");
  await h.lease(row, "claim");
  assert.equal(h.sent.length, 1, "a second click while the first is in flight sends nothing");
  h.reply(); await first;
  assert.deepEqual(h.sent, [{ action: "dates_event_intake_lease", body: { intake_id: row.intake_id, expected_revision: row.revision, action: "claim" } }]);
  assert.deepEqual(plain(h.state.notice), { tone: "success", key: "lease.done.claim" });
  assert.deepEqual(h.writes, ["notice", "notice", "load"]); assert.equal(h.busyRef.current, false); assert.equal(h.state.busy, "");
  // Core's genuine refusal is shown as its token, and the queue is read again either way.
  const refused = leaseHarness(fixture("admin-lease-claimed-denied")), pending = refused.lease(row, "claim");
  refused.reply(); await pending;
  assert.deepEqual(plain(refused.state.notice), { tone: "error", key: "refused", error: "dates-intake-claimed" });
  assert.equal(refused.writes.at(-1), "load");
  // A row whose revision could not be read has no command at all.
  const blind = leaseHarness(receipt); await blind.lease({ intake_id: row.intake_id, revision: null }, "claim");
  assert.equal(blind.sent.length, 0);
  // The answer to a hold is not adopted by a queue that has moved on.
  const moved = leaseHarness(receipt), stale = moved.lease(row, "claim");
  moved.loadGeneration.current++; moved.reply(); await stale;
  assert.deepEqual(moved.writes, ["notice"], "only the notice that was cleared before sending");
});

const usage = component("../app/(dashboard)/dates/ai-usage/page.tsx", "DatesAiUsagePage");
const usageCallbacks = callbacks(usage);
test("AI usage page drops the late reply of an earlier month", async () => {
  assert.equal(usageCallbacks.dependencies, "[load]");
  const code = compile(`exports.load = ${usageCallbacks.load};`);
  const loadGeneration = { current: 0 }, state: any = {}, writes: string[] = [];
  function render(month: string) {
    const response = deferred();
    const context: any = { exports: {}, month, loadGeneration, readDatesAiUsage,
      adminCall: (action: string) => action === "admin_me" ? Promise.resolve(identity(["dates_external_event_read"])) : response.promise,
      setState: (value: string) => { state.status = value; writes.push("state"); }, setRead: (value: unknown) => { state.read = value; writes.push("read"); },
      setProblem: (value: unknown) => { state.problem = value; writes.push("problem"); } };
    vm.runInNewContext(code, context);
    return { load: context.exports.load as () => Promise<void>, reply: (value: unknown) => response.resolve(value) };
  }
  const september = render("2026-09"), old = september.load();
  const current = render(""), fresh = current.load();
  current.reply(fixture("admin-usage-month")); await fresh;
  assert.equal(state.read.usage.usage.month, "2026-10"); assert.equal(state.read.review, false); assert.equal(state.read.awaitingBudget, null);
  const before = [...writes];
  september.reply(fixture("admin-usage-earlier-month")); await old;
  assert.deepEqual(writes, before); assert.equal(state.read.usage.usage.month, "2026-10");
});

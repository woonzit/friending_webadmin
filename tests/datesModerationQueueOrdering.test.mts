import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesModerationQueue, datesModerationConsoleSla } from "../lib/datesModerationRead.ts";

// Execute the actual production callbacks, not a copied implementation. This is
// a source-handler test with controlled reply ordering, not a React/browser mount.
// Queue/SLA bodies are the pinned Core captures; null is a transport/refusal control.
const source = readFileSync(new URL("../app/(dashboard)/dates/moderation/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("queue.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = tree.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "DatesModerationQueuePage");
assert.ok(component?.body);
const declarations = component.body.statements.flatMap(node =>
  ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
const loadDeclaration = declarations.find(node => node.name.getText(tree) === "load");
assert.ok(loadDeclaration?.initializer && ts.isCallExpression(loadDeclaration.initializer));
assert.equal(loadDeclaration.initializer.expression.getText(tree), "useCallback");
const effectStatement = component.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "useEffect");
assert.ok(effectStatement && ts.isExpressionStatement(effectStatement) && ts.isCallExpression(effectStatement.expression));
const effect = effectStatement.expression;
const compiled = ts.transpileModule(
  `exports.load = ${loadDeclaration.initializer.arguments[0].getText(tree)};
   exports.effect = ${effect.arguments[0].getText(tree)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
const fixture = (name: string) => JSON.parse(readFileSync(
  new URL(`./fixtures/dates_moderation_console_wire/admin-${name}.json`, import.meta.url), "utf8"));
const closed = fixture("queue-closed"), breached = fixture("queue-breached");
const populatedSla = fixture("sla-populated"), emptySla = fixture("sla-empty");
const closedFilters = { queue: "all", status: "closed", assignee: "all", search: "", slaBreached: false };
const breachedFilters = { ...closedFilters, status: "open", slaBreached: true };
const pageSize = /const PAGE_SIZE = (\d+);/.exec(source);
assert.ok(pageSize);

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(complete => { resolve = complete; });
  return { promise, resolve };
}

function harness() {
  // React retains this ref across callback instances/renders. The wiring test
  // below requires the production component to own it with useRef(0).
  const loadGeneration = { current: 0 };
  const state = { rows: [] as any[], total: 0, sla: null as unknown, status: "ready" };
  const writes: string[] = [];
  const requests: Array<{ action: string; body: Record<string, unknown>; signal?: AbortSignal }> = [];
  function render(filters = closedFilters, page = 1) {
    const queue = deferred(), sla = deferred();
    let effectPending: Promise<void> | undefined;
    const context: any = {
      exports: {}, AbortController, filters, page, rows: state.rows,
      PAGE_SIZE: Number(pageSize![1]), loadGeneration,
      datesModerationQueue, datesModerationConsoleSla,
      adminCall: (action: string, body: Record<string, unknown>, signal?: AbortSignal) => {
        requests.push({ action, body, signal });
        assert.ok(["dates_moderation_queue", "dates_moderation_sla"].includes(action));
        return action === "dates_moderation_queue" ? queue.promise : sla.promise;
      },
      setRows: (rows: any[]) => { state.rows = rows; writes.push("rows"); },
      setTotal: (total: number) => { state.total = total; writes.push("total"); },
      setSla: (value: unknown) => { state.sla = value; writes.push("sla"); },
      setState: (status: string) => { state.status = status; writes.push(`state:${status}`); },
    };
    vm.runInNewContext(compiled, context);
    const load = context.exports.load as (signal?: AbortSignal) => Promise<void>;
    context.load = (signal?: AbortSignal) => { effectPending = load(signal); return effectPending; };
    return {
      load, queue, sla,
      effect() {
        const cleanup = context.exports.effect() as () => void;
        assert.ok(effectPending);
        return { cleanup, pending: effectPending };
      },
      reply(body: unknown, summary: unknown = populatedSla) {
        queue.resolve(structuredClone(body)); sla.resolve(structuredClone(summary));
      },
    };
  }
  return { state, writes, requests, render };
}

function assertCurrent(state: ReturnType<typeof harness>["state"], body = breached, sla = emptySla) {
  assert.deepEqual(state.rows, body.cases);
  assert.equal(state.total, body.total);
  assert.deepEqual(state.sla, datesModerationConsoleSla(sla));
  assert.equal(state.status, "ready");
}

test("queue owns one persistent request generation and keeps Refresh/Retry on the guarded load", () => {
  const generation = declarations.find(node => node.name.getText(tree) === "loadGeneration");
  assert.ok(generation?.initializer && ts.isCallExpression(generation.initializer));
  assert.equal(generation.initializer.expression.getText(tree), "useRef");
  assert.equal(generation.initializer.arguments[0].getText(tree), "0");
  assert.equal(effect.arguments[1].getText(tree), "[filters, page]");
  assert.equal((source.match(/void load\(\)/g) ?? []).length, 2, "Refresh and Retry share the same callback");
  assert.equal(Number(pageSize[1]), 40);
});

test("older completed load and subsequent fresh load can both install valid authority", async () => {
  const h = harness();
  const old = h.render(), first = old.load();
  old.reply(closed); await first;
  assertCurrent(h.state, closed, populatedSla);
  const fresh = h.render(breachedFilters), second = fresh.load();
  fresh.reply(breached, emptySla); await second;
  assertCurrent(h.state);
});

for (const ordering of ["older-first", "older-last"] as const) {
  test(`manual Closed refresh followed by Open+breached effect keeps current rows: ${ordering}`, async () => {
    const h = harness();
    const old = h.render(), oldPending = old.load(); // Real Refresh/Retry path: no signal.
    const fresh = h.render(breachedFilters), freshPending = fresh.load(new AbortController().signal);
    assert.equal(h.requests[0].signal, undefined);
    assert.equal(h.requests[0].body.status, "closed");
    assert.equal(h.requests[2].body.status, "open");
    assert.equal(h.requests[2].body.sla_breached, true);
    if (ordering === "older-first") {
      old.reply(closed); await oldPending;
      fresh.reply(breached, emptySla); await freshPending;
    } else {
      fresh.reply(breached, emptySla); await freshPending;
      const before = [...h.writes];
      old.reply(closed); await oldPending;
      assert.deepEqual(h.writes, before, "stale success may not write rows, count, SLA or state");
    }
    assertCurrent(h.state);
  });
}

test("two manual refreshes of the same filter use latest-request ownership too", async () => {
  const h = harness(), all = { ...closedFilters, status: "all" };
  const old = h.render(all), oldPending = old.load();
  const fresh = h.render(all), freshPending = fresh.load();
  fresh.reply(breached, emptySla); await freshPending;
  old.reply(closed); await oldPending;
  assertCurrent(h.state);
});

for (const staleFailure of ["queue", "sla"] as const) {
  test(`older manual ${staleFailure} failure cannot clear current SLA or install an error`, async () => {
    const h = harness();
    const old = h.render(), oldPending = old.load();
    const fresh = h.render(breachedFilters), freshPending = fresh.load();
    fresh.reply(breached, emptySla); await freshPending;
    const before = [...h.writes];
    old.reply(staleFailure === "queue" ? null : closed, staleFailure === "sla" ? null : populatedSla);
    await oldPending;
    assert.deepEqual(h.writes, before);
    assertCurrent(h.state);
  });
}

test("a current refusal stays an error instead of becoming an older successful queue", async () => {
  const h = harness();
  const old = h.render(), oldPending = old.load();
  const fresh = h.render(breachedFilters), freshPending = fresh.load();
  fresh.reply(null); await freshPending;
  assert.equal(h.state.status, "error");
  assert.equal(h.state.sla, null);
  const before = [...h.writes];
  old.reply(closed); await oldPending;
  assert.deepEqual(h.writes, before);
  assert.equal(h.state.status, "error");
});

test("effect cleanup invalidates both effect-owned and signal-less manual replies on unmount", async () => {
  const h = harness();
  const effect = h.render(), mounted = effect.effect();
  const manual = h.render(), pending = manual.load();
  mounted.cleanup();
  assert.equal(h.requests[0].signal?.aborted, true);
  assert.equal(h.requests[2].signal, undefined);
  const before = [...h.writes];
  effect.reply(closed); manual.reply(closed);
  await Promise.all([mounted.pending, pending]);
  assert.deepEqual(h.writes, before);
});

test("filter/page cleanup rejects a late manual reply even before the replacement effect starts", async () => {
  const h = harness();
  const initial = h.render(), mounted = initial.effect();
  initial.reply(closed); await mounted.pending;
  const manual = h.render(), pending = manual.load();
  mounted.cleanup();
  const before = [...h.writes];
  manual.reply(breached, emptySla); await pending;
  assert.deepEqual(h.writes, before);
  assertCurrent(h.state, closed, populatedSla);
  const pageTwo = h.render(breachedFilters, 2), next = pageTwo.effect();
  assert.equal(h.requests[4].body.page, 2);
  pageTwo.reply(null); await next.pending; // An actual failed read stays a visible error.
  assert.equal(h.state.status, "error");
  next.cleanup();
});

test("an already aborted invocation issues no reads and cannot invalidate the live request", async () => {
  const h = harness();
  const fresh = h.render(breachedFilters), pending = fresh.load();
  const aborted = h.render(), controller = new AbortController();
  controller.abort();
  const stale = aborted.load(controller.signal);
  aborted.reply(closed); await stale;
  assert.equal(h.requests.length, 2);
  fresh.reply(breached, emptySla); await pending;
  assertCurrent(h.state);
});

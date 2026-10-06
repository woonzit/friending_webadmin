import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesAdminPrincipal, hasDatesCapability } from "../lib/datesAdmin.ts";
import { decodeDatesExternalList, decodeDatesExternalPlaces, datesExternalPlaceQuery } from "../lib/datesExternalAdmin.ts";
import { datesExternalTimeFromInput } from "../lib/datesExternalInput.ts";
import { prepareDatesExternalPending, readDatesExternalPending, runDatesExternalMutation, readDatesExternalMutationAccess } from "../lib/datesExternalMutations.ts";
import { decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";

// Actual production callbacks under controlled request ordering. These are
// source-handler regressions, not React/browser mounts or provider captures.
function component(path: string, name: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration?.body);
  return { source, tree, body: declaration.body };
}
function compile(source: string) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((done) => { resolve = done; }); return { promise, resolve }; }
const capabilities = ["dates_external_event_read", "dates_external_event_manage"];
const identity = { success: true, dates: { email: "operator@example.test", role: "administrator", rank: 40, linked_uid: null,
  sensitive_location: false, break_glass: false, capabilities } };
const envelope = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1_790_000_000 };
const list = (page: number) => ({ ...envelope, events: [], page, limit: 40, total: 0, capabilities });
const queue = component("../app/(dashboard)/dates/external/page.tsx", "DatesExternalEventsPage");
const declaration = queue.body.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find((node) => node.name.getText(queue.tree) === "load");
assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer));
const effect = queue.body.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(queue.tree) === "useEffect");
assert.ok(effect && ts.isExpressionStatement(effect) && ts.isCallExpression(effect.expression));
const callback = compile(`exports.load = ${declaration.initializer.arguments[0].getText(queue.tree)};
  exports.effect = ${effect.expression.arguments[0].getText(queue.tree)};`);

function listHarness() {
  const loadGeneration = { current: 0 }, writes: string[] = [], state = { data: null as any, status: "ready", principal: null as any };
  function render(page: number) {
    const response = deferred(), membership = deferred(); let pending: Promise<void> | undefined;
    const context: any = { exports: {}, AbortController, page, PAGE_SIZE: 40, loadGeneration,
      filters: { status: "", tier: "", category: "", channel: "", city: "", query: "", startFrom: "", startTo: "" },
      datesAdminPrincipal, hasDatesCapability, decodeDatesExternalList, datesExternalTimeFromInput,
      adminCall: (action: string) => action === "admin_me" ? membership.promise : response.promise,
      setState: (value: string) => { state.status = value; writes.push("state"); },
      setData: (value: unknown) => { state.data = value; writes.push("data"); },
      setPrincipal: (value: unknown) => { state.principal = value; writes.push("principal"); } };
    vm.runInNewContext(callback, context);
    context.load = (signal?: AbortSignal) => { pending = context.exports.load(signal); return pending; };
    return { load: context.exports.load as (signal?: AbortSignal) => Promise<void>,
      reply: (value: unknown = list(page), who: unknown = identity) => { response.resolve(value); membership.resolve(who); },
      effect: () => ({ cleanup: context.exports.effect() as () => void, pending: pending! }) };
  }
  return { render, state, writes, loadGeneration };
}

test("external list Refresh/Retry share a persistent generation invalidated by effect cleanup", () => {
  assert.match(queue.source, /loadGeneration = useRef\(0\)/);
  assert.equal((queue.source.match(/void load\(\)/g) ?? []).length, 2);
  assert.equal(effect.expression.arguments[1].getText(queue.tree), "[load]");
});
for (const olderResult of ["success", "failure"] as const) test(`external list drops late manual-refresh ${olderResult} after a page change`, async () => {
  const h = listHarness(), old = h.render(1), oldPending = old.load();
  const fresh = h.render(2), current = fresh.effect(); fresh.reply(); await current.pending;
  const writes = [...h.writes]; old.reply(olderResult === "success" ? list(1) : null); await oldPending;
  assert.deepEqual(h.writes, writes); assert.equal(h.state.data.page, 2); assert.equal(h.state.status, "ready");
});
test("external list unmount invalidates even requests started without an AbortSignal", async () => {
  const h = listHarness(), first = h.render(1), mount = first.effect(); first.reply(); await mount.pending;
  const refresh = h.render(1), pending = refresh.load(); mount.cleanup(); const writes = [...h.writes];
  refresh.reply(); await pending; assert.deepEqual(h.writes, writes);
});
test("current external-list malformed response or revoked identity is an error, never an empty success", async () => {
  for (const invalidIdentity of [false, true]) {
    const h = listHarness(), current = h.render(1), pending = current.load();
    current.reply(invalidIdentity ? list(1) : { success: true, events: [] }, invalidIdentity ? null : identity); await pending;
    assert.equal(h.state.status, "error"); assert.equal(h.state.data, null); assert.equal(h.state.principal, null);
  }
});

const places = component("../components/DatesExternalPlaceSearch.tsx", "DatesExternalPlaceSearch");
const search = places.body.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "search");
assert.ok(search);
test("optional place lookup rejects late or newly locked responses without overwriting manual entry", async () => {
  for (const change of ["generation", "lock", "abort"] as const) {
    const response = deferred(), writes: string[] = [], generation = { current: 0 }, locked = { current: false }, controller = { current: null as AbortController | null };
    const context: any = { exports: {}, AbortController, generation, locked, controller, query: "Public venue", locale: "en",
      datesExternalPlaceQuery, decodeDatesExternalPlaces, adminCall: () => response.promise,
      setState: () => writes.push("state"), setResult: () => writes.push("result") };
    vm.runInNewContext(compile(`${search.getText(places.tree)}; exports.search = search;`), context);
    const pending = context.exports.search();
    if (change === "generation") generation.current++; else if (change === "lock") locked.current = true; else controller.current!.abort();
    const before = [...writes]; response.resolve({ ...envelope, available: true, unavailable_reason: null, manual_entry: true, provider: "google_maps", attribution: "Google Maps", places: [] });
    await pending; assert.deepEqual(writes, before, change);
  }
});

const editor = component("../components/DatesExternalEditorPage.tsx", "DatesExternalEditorPage");
const commandAllowed = editor.body.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "commandAllowed");
assert.ok(commandAllowed);
test("actual held editor offers non-approving corrections and safety actions but no thread update", () => {
  const body = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-held-detail.json", import.meta.url), "utf8"));
  assert.ok(decodeDatesExternalDetail(body, body.event.external_event_id));
  const context: any = { exports: {}, event: body.event, principal: { ...identity.dates, capabilities: body.capabilities },
    ACTIVITY_COMMANDS: ["end", "soft_delete", "restore", "purge"], hasDatesCapability };
  vm.runInNewContext(compile(`${commandAllowed.getText(editor.tree)}; exports.allowed = commandAllowed;`), context);
  for (const action of ["reverify", "cancel", "withdraw", "end", "soft_delete"]) assert.equal(context.exports.allowed(action), true, action);
  for (const action of ["official_update", "restore", "purge"]) assert.equal(context.exports.allowed(action), false, action);
  context.event = { ...body.event, can_edit: false };
  for (const action of ["reverify", "cancel", "withdraw", "official_update", "end"]) assert.equal(context.exports.allowed(action), false, action);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    assert.ok(messages.datesAdmin.external.editor.held.length > 80);
  }
  assert.match(editor.source, /event\?\.status === "in_review".*t\("editor\.held"\)/);
});
const execute = editor.body.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "execute");
assert.ok(execute);
const actor = "operator@example.test", now = envelope.server_now;
const baseline = { external_event_id: "xev_" + "a".repeat(32), activity_id: "act_" + "b".repeat(32),
  revision: 2, activity_revision: 5, status: "published" as const, lifecycle: "active" as const, soft_deleted: false };
const proposed = { action: "dates_external_event_command", body: { external_event_id: baseline.external_event_id,
  expected_revision: 2, action: "cancel", reason: "Checked cancellation" }, baseline };

function mutationHarness() {
  const access = deferred(), response = deferred(), lifetime = { current: 0 }, values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const writes: string[] = [], sent: unknown[] = [], state: any = {};
  const context: any = { exports: {}, lifetime, busyRef: { current: false }, principal: identity.dates,
    readDatesExternalMutationAccess: () => access.promise, datesExternalBrowserStorage: () => storage,
    prepareDatesExternalPending, readDatesExternalPending, runDatesExternalMutation,
    adminCall: (action: string, body: unknown) => { sent.push({ action, body }); return response.promise; },
    router: { replace: () => writes.push("navigate") }, load: async () => writes.push("load") };
  for (const name of ["Busy", "Feedback", "CanManage", "Pending", "Candidate", "CompletedCreate", "NeedsReload"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); };
  vm.runInNewContext(compile(`${execute.getText(editor.tree)}; exports.execute = execute;`), context);
  return { access, response, lifetime, writes, sent, state, storage, execute: context.exports.execute as (candidate: unknown, retry?: unknown) => Promise<void> };
}

test("editor blocks duplicate clicks before fresh authorization and retains exact uncertain payload", async () => {
  const h = mutationHarness(), first = h.execute(proposed); await h.execute(proposed);
  assert.equal(h.sent.length, 0); h.access.resolve({ actor, serverNow: now });
  await new Promise((done) => setImmediate(done)); assert.equal(h.sent.length, 1);
  assert.equal(readDatesExternalPending(h.storage, actor).kind, "pending");
  h.response.resolve(null); await first;
  assert.equal(h.state.Feedback.key, "uncertain");
  await h.execute(proposed); assert.equal(h.sent.length, 1, "a competing new identity never escapes storage fencing");
});

test("editor never dispatches after unmount or actor change during fresh authorization", async () => {
  for (const change of ["unmount", "actor"] as const) {
    const h = mutationHarness(), operation = h.execute(proposed);
    if (change === "unmount") h.lifetime.current++;
    const writes = [...h.writes]; h.access.resolve({ actor: change === "actor" ? "other@example.test" : actor, serverNow: now }); await operation;
    assert.equal(h.sent.length, 0); assert.equal(readDatesExternalPending(h.storage, actor).kind, "empty");
    if (change === "unmount") assert.deepEqual(h.writes, writes); else assert.equal(h.state.Feedback.key, "access");
  }
});

test("unmount after dispatch leaves uncertain retry evidence and suppresses UI adoption", async () => {
  const h = mutationHarness(), operation = h.execute(proposed); h.access.resolve({ actor, serverNow: now });
  await new Promise((done) => setImmediate(done)); assert.equal(h.sent.length, 1);
  h.lifetime.current++; const writes = [...h.writes]; h.response.resolve(null); await operation;
  assert.deepEqual(h.writes, writes); assert.equal(readDatesExternalPending(h.storage, actor).kind, "pending");
});

test("missing detail after a purge still exposes only the saved receipt-recovery path", async () => {
  const declaration = editor.body.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find((node) => node.name.getText(editor.tree) === "load");
  assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer));
  const pending = prepareDatesExternalPending(actor, "dates_activity_command", { activity_id: baseline.activity_id,
    expected_revision: 5, action: "purge", reason: "Retention checked" }, { ...baseline, soft_deleted: true }, now);
  assert.ok(pending);
  const state: any = {}, context: any = { exports: {}, externalId: baseline.external_event_id, generation: { current: 0 },
    FRESH: {}, datesAdminPrincipal, hasDatesCapability, decodeDatesExternalDetail, decodeDatesExternalList,
    datesExternalBrowserStorage: () => null, readDatesExternalPending: () => ({ kind: "pending", pending }), readDatesExternalMutationAccess,
    adminCall: async (action: string) => action === "admin_me" ? { ...identity, dates: { ...identity.dates, capabilities: [...capabilities, "dates_activity_command", "dates_activity_purge"] } }
      : action === "dates_external_event_detail" ? { success: false, error: "dates-external-unavailable" } : { ...list(1), limit: 1 } };
  for (const name of ["State", "Principal", "CanManage", "Data", "EditorOpened", "Pending", "Feedback"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; };
  vm.runInNewContext(compile(`exports.load = ${declaration.initializer.arguments[0].getText(editor.tree)};`), context);
  await context.exports.load();
  assert.equal(state.State, "ready"); assert.equal(state.Data, null); assert.equal(state.EditorOpened, false);
  assert.equal(state.Pending.pending, pending); assert.equal(state.Feedback.key, "recoveryOnly");
});

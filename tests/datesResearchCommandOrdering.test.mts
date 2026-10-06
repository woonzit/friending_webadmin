import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { confirmResearchRetryActor, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { DERIVED_ENVELOPE, GENUINE_AREA, GENUINE_DEFAULTS, researchFixture } from "./support/datesResearchCorpus.ts";
import { researchDefaultValues } from "../lib/datesResearchView.ts";

// Execute the production hook's handlers with a controlled hook scheduler and
// command transport. This is not a React/browser mount or a provider capture.
const file = readFileSync(new URL("../components/DatesResearchControls.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("controls.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "useResearchCommand");
assert.ok(fn);
const code = ts.transpileModule(`${fn.getText(tree)}\nexports.hook = useResearchCommand;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const identity = (email = "operator@example.test", capabilities = ["dates_external_event_manage"]) => ({ success: true, dates: {
  email, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false, break_glass: false, capabilities,
} }); // DERIVED membership, not an authenticated session capture.
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function harness(preflight: () => Promise<unknown> = async () => identity()) {
  const slots: any[] = [], effects: (() => void)[] = [], calls: any[] = [], reads: any[] = [], success: any[] = [], conflicts: string[] = [];
  let index = 0;
  const context: any = { exports: {}, prepareResearchCommand, confirmResearchRetryActor,
    useTranslations: () => (key: string) => key, retainResearchCommandNavigation: () => () => {},
    adminCall: (action: string, body: object) => { reads.push({ action, body }); return preflight(); },
    runResearchCommand: (_send: unknown, command: unknown) => new Promise((resolve) => calls.push({ command, resolve })),
    useState: (initial: unknown) => {
      const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
    },
    useRef: (initial: unknown) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect: (effect: () => void, dependencies: unknown[]) => {
      const slot = index++, old = slots[slot]; slots[slot] = dependencies;
      if (!old || dependencies.some((value, i) => value !== old[i])) effects.push(effect);
    } };
  vm.runInNewContext(code, context);
  function render(actor = "operator@example.test") {
    index = 0;
    const result = context.exports.hook(actor, async (answer: unknown) => { success.push(answer); }, async () => { conflicts.push(actor); });
    for (const effect of effects.splice(0)) effect();
    return result;
  }
  return { render, calls, reads, success, conflicts };
}
const input = { source_id: "xrs_" + "1".repeat(32), expected_revision: 1, dry_run: true };
test("DERIVED domain-policy refusal after an unknown save retains the same hook command and retry identity", async () => {
  const h = harness(), first = h.render().submit("dates_event_research_defaults_save", { expected_revision: GENUINE_DEFAULTS.revision,
    reason: "Reviewed domain policy", values: { ...researchDefaultValues(GENUINE_DEFAULTS), enabled: GENUINE_DEFAULTS.enabled,
      auto_cities_enabled: GENUINE_DEFAULTS.auto_cities_enabled, research_models: { openai: "derived-openai", gemini: "derived-gemini" },
      domains: [{ domain: "events.example.org", type: "official" }] } });
  const original = h.calls[0].command, bytes = JSON.stringify(original.body);
  h.calls[0].resolve({ kind: "uncertain", error: null }); await first;
  const retry = h.render().retry(); await flush();
  h.calls[1].resolve(await runResearchCommand(async () => ({ ...DERIVED_ENVELOPE, success: false, status_code: 400, error: "dates-research-domains-invalid" }), original));
  await retry;
  const state = h.render(); assert.equal(state.pending, original); assert.equal(state.retained, true);
  assert.equal(state.outcome.kind, "uncertain"); assert.equal(state.outcome.error, "dates-research-domains-invalid");
  assert.equal(JSON.stringify(state.pending.body), bytes); assert.equal(h.calls.length, 2);
});
test("GENUINE place refusal releases the production hook so another city can be submitted without a page reload", async () => {
  const h = harness();
  const body = { place_id: "derived_first", mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Choose a supported city" };
  const first = h.render().submit("dates_event_research_area_save", body);
  h.calls[0].resolve(await runResearchCommand(async () => researchFixture("admin-place-unavailable-denied.json"), h.calls[0].command)); await first;
  const settled = h.render(); assert.equal(settled.retained, false); assert.equal(settled.pending, null); assert.equal(settled.outcome.kind, "refused");
  const second = settled.submit("dates_event_research_area_save", { ...body, place_id: "derived_second" });
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].command.body.place_id, "derived_second");
  assert.notEqual(h.calls[0].command.body.idempotency_key, h.calls[1].command.body.idempotency_key);
  h.calls[1].resolve({ kind: "refused", error: "dates-research-place-unavailable" }); await second;
});
test("GENUINE city-unavailable answer on DERIVED retry keeps the first attempt unknown and reloads, rather than settling the whole command", async () => {
  const h = harness(), first = h.render().submit("dates_event_research_area_save", {
    place_id: GENUINE_AREA.place_id, mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Choose a supported city",
  });
  const original = h.calls[0].command; h.calls[0].resolve({ kind: "uncertain", error: "core-timeout" }); await first;
  const retry = h.render().retry(); await flush(); assert.equal(h.calls[1].command, original);
  h.calls[1].resolve(await runResearchCommand(async () => researchFixture("admin-place-unavailable-denied.json"), original)); await retry;
  const state = h.render(); assert.equal(state.pending, original); assert.equal(state.retained, true); assert.equal(state.outcome.kind, "uncertain");
  assert.equal(state.outcome.retryNoWrite, true); assert.deepEqual(h.conflicts, ["operator@example.test"]); assert.equal(h.success.length, 0);
  const recover = state.retry(); await flush(); assert.equal(h.calls[2].command, original);
  h.calls[2].resolve({ kind: "success", replayed: true, receipt: GENUINE_AREA }); await recover;
  assert.equal(h.render().retained, false); assert.equal(h.success.length, 1);
});
test("DERIVED generic retry failure makes no no-write claim and does not pretend its unknown response can refresh away uncertainty", async () => {
  const h = harness(), first = h.render().submit("dates_event_research_source_run_now", input);
  h.calls[0].resolve({ kind: "uncertain", error: "core-timeout" }); await first;
  const retry = h.render().retry(); await flush(); h.calls[1].resolve({ kind: "uncertain", error: "dates-admin-unavailable" }); await retry;
  assert.equal(h.render().outcome.retryNoWrite, undefined); assert.equal(h.render().retained, true); assert.equal(h.conflicts.length, 0);
});
test("research command is retained before sending and rapid double submits cannot create another identity", async () => {
  const h = harness(), first = h.render();
  const pending = first.submit("dates_event_research_source_run_now", input);
  await first.submit("dates_event_research_source_run_now", input);
  assert.equal(h.calls.length, 1);
  assert.ok(h.render().pending); assert.equal(h.render().busy, true);
  h.calls[0].resolve({ kind: "uncertain", error: null }); await pending;
  const unanswered = h.render(), original = unanswered.pending;
  assert.equal(unanswered.outcome.kind, "uncertain");
  await unanswered.submit("dates_event_research_source_run_now", { ...input, dry_run: false }); assert.equal(h.calls.length, 1);
  const retry = unanswered.retry(); await flush(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].command, original);
  assert.deepEqual(h.reads, [{ action: "admin_me", body: {} }]);
  h.calls[1].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await retry;
  assert.equal(h.render().pending, null); assert.equal(h.success.length, 1);
});
test("an unknown actor hides the command but preserves a safe same-actor retry after the in-flight response", async () => {
  const h = harness(), submit = h.render().submit("dates_event_research_source_run_now", input);
  const original = h.calls[0].command;
  assert.equal(h.render("").pending, null); assert.equal(h.render("").retained, true, "hiding an unknown actor's retry does not allow an editor to discard it");
  h.calls[0].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await submit;
  assert.equal(h.success.length, 0);
  const recovered = h.render(); assert.equal(recovered.pending, original); assert.equal(recovered.outcome.kind, "uncertain");
  const retry = recovered.retry(); await flush(); assert.equal(h.calls[1].command, original);
  h.calls[1].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await retry;
  assert.equal(h.success.length, 1); assert.equal(h.render().pending, null);
});
test("a confirmed new actor never sees, retries or adopts the previous actor's in-flight command", async () => {
  const h = harness(), pending = h.render().submit("dates_event_research_source_run_now", input);
  assert.equal(h.render("other@example.test").pending, null);
  h.calls[0].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await pending;
  const current = h.render("other@example.test"); assert.equal(current.pending, null); assert.equal(current.outcome, null); assert.equal(h.success.length, 0);
  await current.retry(); assert.equal(h.calls.length, 1);
  const next = current.submit("dates_event_research_source_run_now", input); assert.equal(h.calls[1].command.actor, "other@example.test");
  h.calls[1].resolve({ kind: "conflict", error: "dates-research-conflict" }); await next;
  assert.deepEqual(h.conflicts, ["other@example.test"]); assert.equal(h.render("other@example.test").pending, null);
});
for (const [kind, read] of [
  ["actor_changed", async () => identity("other@example.test")], ["not_authorized", async () => identity("operator@example.test", [])],
  ["unconfirmed", async () => ({ success: false })], ["unconfirmed", async () => { throw new Error("lost membership response"); }],
] as const) test(`DERIVED retry preflight ${kind}: retains the unknown command and sends no mutation`, async () => {
  const h = harness(read), first = h.render().submit("dates_event_research_source_run_now", input), original = h.calls[0].command;
  h.calls[0].resolve({ kind: "uncertain", error: null }); await first;
  await h.render().retry(); const state = h.render();
  assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1); assert.equal(state.pending, original); assert.equal(state.retained, true);
  assert.equal(state.outcome.kind, "uncertain"); assert.equal(state.outcome.retryBlocked, kind); assert.equal(state.busy, false);
});
test("DERIVED retry preflight: rapid retries cannot overlap; a fresh matching actor sends the identical frozen command", async () => {
  let answer!: (value: unknown) => void;
  const h = harness(() => new Promise((resolve) => { answer = resolve; })), first = h.render().submit("dates_event_research_source_run_now", input);
  h.calls[0].resolve({ kind: "uncertain", error: null }); await first;
  const state = h.render(), original = state.pending, bytes = JSON.stringify(original.body), retry = state.retry();
  await state.retry(); assert.equal(h.reads.length, 1); assert.equal(h.calls.length, 1); assert.equal(h.render().busy, true);
  answer(identity()); await flush(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].command, original); assert.equal(JSON.stringify(h.calls[1].command.body), bytes);
  h.calls[1].resolve({ kind: "success", replayed: true, receipt: {}, runId: "derived_existing_run" }); await retry;
  assert.equal(h.render().retained, false);
});
test("DERIVED retry preflight: an identity change during the fresh read fences the retry before mutation", async () => {
  let answer!: (value: unknown) => void;
  const h = harness(() => new Promise((resolve) => { answer = resolve; })), first = h.render().submit("dates_event_research_source_run_now", input);
  h.calls[0].resolve({ kind: "uncertain", error: null }); await first;
  const retry = h.render().retry(); h.render("other@example.test"); answer(identity()); await retry;
  assert.equal(h.calls.length, 1); assert.equal(h.render("other@example.test").pending, null); assert.equal(h.success.length, 0);
});
test("DERIVED blocked retry retains already known partial batch outcomes", async () => {
  const h = harness(async () => ({ success: false })), first = h.render().submit("dates_event_research_source_run_now", input);
  const partial = { rows: [{ intake_id: "derived_intake", outcome: "published" }], unreadable: [{ index: 1, id: "derived_future" }] };
  h.calls[0].resolve({ kind: "uncertain", error: null, partial }); await first; await h.render().retry();
  assert.equal(h.render().outcome.partial, partial); assert.equal(h.calls.length, 1);
});
test("DERIVED explicit discard releases the local identity, requests a reload and never claims the unknown Core work was canceled", async () => {
  const h = harness(), first = h.render().submit("dates_event_research_source_run_now", input);
  await h.render().discard(); assert.equal(h.render().retained, true, "a busy request cannot be discarded");
  const partial = { rows: [{ intake_id: "derived_intake", outcome: "published" }], unreadable: [{ index: 1, id: "derived_future" }] };
  h.calls[0].resolve({ kind: "uncertain", error: "unknown-core-name", partial }); await first;
  await h.render().discard(); const state = h.render();
  assert.equal(state.retained, false); assert.equal(state.pending, null); assert.equal(state.outcome.kind, "uncertain");
  assert.equal(state.outcome.discarded, true); assert.equal(state.outcome.partial, partial); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.conflicts, ["operator@example.test"], "the existing reload callback is requested without a mutating send");
  const next = state.submit("dates_event_research_source_run_now", input); assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ kind: "uncertain", error: null }); await next;
});
test("DERIVED stale discard handler cannot clear a newer retained command", async () => {
  const h = harness(), first = h.render().submit("dates_event_research_source_run_now", input);
  h.calls[0].resolve({ kind: "uncertain", error: null }); await first; const old = h.render(); await old.discard();
  const next = h.render().submit("dates_event_research_source_run_now", input); h.calls[1].resolve({ kind: "uncertain", error: null }); await next;
  const current = h.render(); await old.discard(); assert.equal(h.render().pending, current.pending); assert.equal(h.conflicts.length, 1);
});
test("DERIVED discard UI requires an in-page warning and a second explicit choice, without a browser dialog", () => {
  const feedback = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "ResearchCommandFeedback")!;
  const slots: any[] = []; let index = 0, discards = 0;
  const context: any = { exports: {}, React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useTranslations: () => (key: string) => key,
    useState: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (value: any) => { slots[slot] = value; }]; },
  };
  vm.runInNewContext(ts.transpileModule(feedback.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const command: any = { pending: {}, busy: false, outcome: { kind: "uncertain", error: null }, retry: () => {}, discard: () => { discards++; } };
  const flat = (node: any): any[] => Array.isArray(node) ? node.flatMap(flat) : node && typeof node === "object" && "type" in node ? [node, ...flat(node.children)] : [node];
  const draw = () => { index = 0; return flat(context.exports.ResearchCommandFeedback({ command })); };
  let nodes = draw(); nodes.find((node) => node?.type === "button" && node.children.includes("command.discard")).props.onClick();
  nodes = draw(); assert.ok(nodes.includes("command.discardWarning")); assert.equal(discards, 0);
  nodes.find((node) => node?.type === "button" && node.children.includes("cancel")).props.onClick();
  nodes = draw(); assert.equal(nodes.includes("command.discardWarning"), false); assert.equal(discards, 0);
  nodes.find((node) => node?.type === "button" && node.children.includes("command.discard")).props.onClick(); nodes = draw();
  nodes.find((node) => node?.type === "button" && node.children.includes("command.discardConfirm")).props.onClick();
  assert.equal(discards, 1); assert.equal(draw().includes("command.discardWarning"), false);
});

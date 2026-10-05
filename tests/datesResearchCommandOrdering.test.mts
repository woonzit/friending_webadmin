import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { prepareResearchCommand } from "../lib/datesResearchConsole.ts";

// Execute the production hook's handlers with a controlled hook scheduler and
// command transport. This is not a React/browser mount or a provider capture.
const file = readFileSync(new URL("../components/DatesResearchControls.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("controls.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "useResearchCommand");
assert.ok(fn);
const code = ts.transpileModule(`${fn.getText(tree)}\nexports.hook = useResearchCommand;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const slots: any[] = [], effects: (() => void)[] = [], calls: any[] = [], success: any[] = [], conflicts: string[] = [];
  let index = 0;
  const context: any = { exports: {}, prepareResearchCommand, adminCall: () => {},
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
  return { render, calls, success, conflicts };
}
const input = { source_id: "xrs_" + "1".repeat(32), expected_revision: 1, dry_run: true };
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
  const retry = unanswered.retry(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].command, original);
  h.calls[1].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await retry;
  assert.equal(h.render().pending, null); assert.equal(h.success.length, 1);
});
test("an unknown actor hides the command but preserves a safe same-actor retry after the in-flight response", async () => {
  const h = harness(), submit = h.render().submit("dates_event_research_source_run_now", input);
  const original = h.calls[0].command;
  assert.equal(h.render("").pending, null);
  h.calls[0].resolve({ kind: "success", receipt: {}, runId: "xrr_example" }); await submit;
  assert.equal(h.success.length, 0);
  const recovered = h.render(); assert.equal(recovered.pending, original); assert.equal(recovered.outcome.kind, "uncertain");
  const retry = recovered.retry(); assert.equal(h.calls[1].command, original);
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

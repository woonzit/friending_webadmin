import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DATES_INTAKE_HARD_FAILS } from "../lib/datesIntakeAdmin.ts";
import { datesSystemClosureBlockerWorded } from "../lib/datesSystemClosure.ts";
import * as followups from "../lib/datesResearchFollowups.ts";
import { formatDate, formatNumber } from "../lib/format.ts";

// The production page's handlers under a controlled hook scheduler; not a browser/React mount. Element descriptors
// show which reads the page sends and which saves its controls submit. The list value is Core's genuine open list.
const source = readFileSync(new URL("../components/DatesResearchFollowups.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("DatesResearchFollowups.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const genuine = followups.decodeResearchFollowupList(JSON.parse(readFileSync(new URL("./fixtures/dates_event_research_followup_wire/webadmin-followups-open.json", import.meta.url), "utf8")))!;
const ready = (manage = true) => ({ kind: "ready", value: genuine, operator: { email: "admin@example.test", capabilities: [] }, manage });
type Element = { type: any; props: any; children: any[] };
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
}
function harness() {
  const slots: any[] = [], effects: (() => void)[] = [], reads: { body: Record<string, unknown>; resolve: (value: any) => void }[] = [];
  const submits: { action: string; body: Record<string, unknown> }[] = [], actors: string[] = [];
  let index = 0;
  const context: any = { exports: {}, AbortController,
    React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useLocale: () => "en", useTranslations: () => (key: string) => key, adminCall: () => {}, formatDate, formatNumber, DATES_INTAKE_HARD_FAILS, datesSystemClosureBlockerWorded,
    ...followups,
    // Bodies are copied into this realm: the page builds them inside the VM context.
    readResearchFollowups: (_send: unknown, body: Record<string, unknown>) => new Promise((resolve) => reads.push({ body: JSON.parse(JSON.stringify(body)), resolve })),
    useResearchCommand: (actor: string) => { actors.push(actor); return { busy: false, retained: false, pending: null, outcome: null,
      submit: async (action: string, body: Record<string, unknown>) => { submits.push({ action, body: structuredClone(body) }); } }; },
    useState: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback: (callback: any, deps: any[]) => { const slot = index++, old = slots[slot]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[slot] = { callback, deps }; return slots[slot].callback; },
    useEffect: (effect: any, deps: any[]) => { const slot = index++, old = slots[slot]; slots[slot] = deps; if (!old || deps.some((value, i) => value !== old[i])) effects.push(effect); },
  };
  for (const name of ["Link", "PageHeader", "DatesAdminTabs", "ErrorPanel", "LoadingPanel", "ResearchCommandFeedback"]) context[name] = name;
  vm.runInNewContext(code, context);
  function render() { index = 0; const result = context.exports.default(); for (const effect of effects.splice(0)) effect(); return elements(result); }
  async function answer(value: any) { assert.ok(reads.length, "a read is pending"); reads.shift()!.resolve(value); await Promise.resolve(); await Promise.resolve(); }
  const cards = (nodes: Element[]) => nodes.filter((node) => node.type === context.exports.ResearchFollowupCard);
  return { render, answer, reads, submits, actors, cards };
}

test("the first read asks for the open rows only; a ready answer mounts one card per row with write authority", async () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.reads.map((read) => read.body), [{ state: "open" }]);
  await h.answer(ready());
  const nodes = h.render();
  assert.deepEqual(h.cards(nodes).map((node) => node.props.row.key), genuine.followups.rows.map((row) => row.key));
  assert.ok(h.cards(nodes).every((node) => node.props.manage === true && node.props.busy === false));
  assert.equal(h.actors.at(-1), "admin@example.test");
  assert.ok(nodes.some((node) => node.type === "ResearchSubnav" || node.type?.name === "ResearchSubnav"));
});

test("Done and Dismiss submit the row's key, revision and the note as typed; an untouched note is the saved one", async () => {
  const h = harness();
  h.render(); await h.answer(ready());
  let card = h.cards(h.render())[7];
  assert.equal(card.props.row.title, "Art of Noise");
  card.props.onSave("done");
  assert.deepEqual(h.submits.at(-1), { action: "dates_event_research_followup_save", body: { key: card.props.row.key, state: "done", expected_revision: 0 } });
  card.props.onNote("  Added by hand. ");
  card = h.cards(h.render())[7];
  assert.equal(card.props.note, "  Added by hand. ");
  card.props.onSave("dismissed");
  assert.deepEqual(h.submits.at(-1)!.body, { key: card.props.row.key, state: "dismissed", expected_revision: 0, note: "  Added by hand. " });
  // Another row keeps its own (empty) draft.
  assert.equal(h.cards(h.render())[0].props.note, "");
});

test("filters reset the cursor; the next page sends the cursor; the search is sent only when submitted", async () => {
  const h = harness();
  h.render(); await h.answer(ready());
  let nodes = h.render();
  const [city, group] = nodes.filter((node) => node.type === "select");
  group.props.onChange({ target: { value: "gate" } });
  h.render();
  assert.deepEqual(h.reads.at(-1)!.body, { group: "gate", state: "open" });
  await h.answer({ ...ready(), value: { ...genuine, next_cursor: `1800000000:rru_${"2".repeat(32)}:12` } });
  nodes = h.render();
  nodes.find((node) => node.type === "button" && node.children.includes("next"))!.props.onClick();
  h.render();
  assert.deepEqual(h.reads.at(-1)!.body, { group: "gate", state: "open", cursor: `1800000000:rru_${"2".repeat(32)}:12` });
  await h.answer(ready());
  nodes = h.render();
  nodes.filter((node) => node.type === "select")[0].props.onChange({ target: { value: "none" } });
  h.render();
  assert.deepEqual(h.reads.at(-1)!.body, { area_id: "none", group: "gate", state: "open" }, "a filter change drops the cursor");
  await h.answer(ready());
  nodes = h.render();
  nodes.find((node) => node.type === "input" && node.props.type === "search")!.props.onChange({ target: { value: "  SFMOMA " } });
  const before = h.reads.length;
  h.render();
  assert.equal(h.reads.length, before, "typing does not read");
  h.render().find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  h.render();
  assert.deepEqual(h.reads.at(-1)!.body, { area_id: "none", group: "gate", state: "open", q: "SFMOMA" });
  await h.answer(ready());
  h.render().find((node) => node.type === "button" && node.props["aria-pressed"] === false && node.children.includes("stateFilters.done"))!.props.onClick();
  h.render();
  assert.deepEqual(h.reads.at(-1)!.body, { area_id: "none", group: "gate", state: "done", q: "SFMOMA" });
  assert.ok(city);
});

test("a denied or unavailable read shows no rows and fences write authority; a failed refresh keeps the rows but not the authority", async () => {
  for (const kind of ["denied", "unavailable"] as const) {
    const h = harness();
    h.render(); await h.answer({ kind });
    const nodes = h.render();
    assert.equal(h.cards(nodes).length, 0, kind);
    assert.equal(h.actors.at(-1), "", kind);
  }
  const h = harness();
  h.render(); await h.answer(ready());
  h.render().find((node) => node.type === "PageHeader")!.props.actions.props.onClick();
  await h.answer({ kind: "unconfirmed" });
  const nodes = h.render();
  assert.ok(h.cards(nodes).length > 0 && h.cards(nodes).every((node) => node.props.manage === false), "the mounted rows lose their controls");
  assert.equal(h.actors.at(-1), "");
  const readOnly = harness();
  readOnly.render(); await readOnly.answer(ready(false));
  assert.ok(readOnly.cards(readOnly.render()).every((node) => node.props.manage === false), "a reviewer gets no controls");
});

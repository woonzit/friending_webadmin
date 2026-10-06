import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as research from "../lib/datesResearchAdmin.ts";
import * as view from "../lib/datesResearchView.ts";
import * as proxy from "../lib/datesResearchProxy.ts";
import { confirmResearchRetryActor, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { formatNumber } from "../lib/format.ts";
import { DERIVED_ENVELOPE, GENUINE_RUN, GENUINE_AREA, GENUINE_DEFAULTS, GENUINE_LIMITS, GENUINE_SOURCE } from "./support/datesResearchCorpus.ts";

// DERIVED scheduled-completion conflict. Execute the production editor, draft
// effect and command hook with controlled hooks/transport. Not a React/browser
// mount, provider capture or real worker run.
const editors = readFileSync(new URL("../components/DatesResearchEditors.tsx", import.meta.url), "utf8");
const editorTree = ts.createSourceFile("editors.tsx", editors, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const controls = readFileSync(new URL("../components/DatesResearchControls.tsx", import.meta.url), "utf8");
const controlTree = ts.createSourceFile("controls.tsx", controls, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = controlTree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "useResearchCommand");
assert.ok(hook);
const code = ts.transpileModule([hook.getText(controlTree), ...editorTree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(editorTree))].join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
type Element = { type: any; props: any; children: any[] };
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
test("DERIVED retained command locks every editor field, including when actor fencing hides the visible pending command", () => {
  const context: any = { exports: {}, ...research, ...view, ...proxy, formatNumber,
    React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useLocale: () => "en", useTranslations: () => (key: string) => key, useEffect: () => {}, useState: (value: any) => [value, () => {}],
    useResearchCommand: () => ({ busy: false, retained: true, pending: null, submit: () => {} }) };
  for (const name of ["ResearchCommandFeedback", "ResearchDuration", "ResearchHelp", "ResearchReason", "ResearchSaveIssue", "ResearchValuesFields", "AppearanceMapPicker"]) context[name] = name;
  vm.runInNewContext(ts.transpileModule(editorTree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(editorTree)).join("\n"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const props = { defaults: GENUINE_DEFAULTS, actor: "operator@example.test", manage: true, limits: GENUINE_LIMITS, reload: async () => {}, close: () => {} };
  for (const [name, extra] of [["ResearchDefaultsEditor", {}], ["ResearchAreaEditor", { row: GENUINE_AREA }], ["ResearchSourceEditor", { row: GENUINE_SOURCE, areas: [GENUINE_AREA] }]] as const) {
    const nodes = elements(context.exports[name]({ ...props, ...extra }));
    for (const node of nodes.filter((node) => ["input", "select", "button", "ResearchReason", "ResearchValuesFields", "ResearchDuration", "AppearanceMapPicker"].includes(node.type)))
      assert.equal(node.props.disabled, true, `${name}: ${node.type} is locked while the original command is retained`);
  }
});

test("DERIVED unreadable city: changing a source override to inheritance shows unknown effective values without guessing or writing", () => {
  const slots: any[] = [], calls: any[] = []; let index = 0;
  const row = { ...GENUINE_SOURCE, area_id: GENUINE_AREA.area_id, window_days: 21, autopublish: false,
    effective: { window_days: 21, autopublish: false } };
  const context: any = { exports: {}, ...research, ...view, ...proxy, formatNumber,
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useLocale: () => "en", useTranslations: () => (key: string) => key, useEffect: () => {},
    useState: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useResearchCommand: () => ({ busy: false, pending: null, retained: false, submit: (action: string, body: any) => calls.push({ action, body: structuredClone(body) }) }),
  };
  for (const name of ["ResearchCommandFeedback", "ResearchDuration", "ResearchHelp", "ResearchReason", "ResearchSaveIssue"]) context[name] = name;
  vm.runInNewContext(ts.transpileModule(editorTree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(editorTree)).join("\n"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const render = () => { index = 0; return elements(context.exports.ResearchSourceEditor({ row, defaults: GENUINE_DEFAULTS, areas: [],
    actor: "operator@example.test", manage: true, limits: GENUINE_LIMITS, reload: async () => {}, close: () => {} })); };
  const toggles = (nodes: Element[]) => nodes.filter((node) => node.type === "label" && node.props.className === "research-inherit").map((label) => elements(label.children).find((node) => node.type === "input")!);
  let nodes = render(); toggles(nodes)[0].props.onChange({ target: { checked: true } });
  nodes = render(); toggles(nodes)[1].props.onChange({ target: { checked: true } });
  nodes = render();
  const window = nodes.find((node) => node.type === "input" && node.props.max === GENUINE_LIMITS.window_days.max)!;
  assert.equal(window.props.value, ""); assert.equal(window.props.placeholder, "effectiveUnavailable");
  for (const field of ["window_days", "autopublish"]) {
    const help = nodes.find((node) => node.type === "ResearchHelp" && node.props.field === field)!;
    assert.equal(help.props.effective, "effectiveUnavailable"); assert.equal(help.props.unavailableInheritance, true);
  }
  assert.equal(calls.length, 0, "draft inheritance changes never write automatically");
  nodes.find((node) => node.type === "ResearchReason")!.props.onChange("Use the configured city values");
  nodes = render(); nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1); assert.equal(calls[0].body.window_days, null); assert.equal(calls[0].body.autopublish, null);
  toggles(nodes)[0].props.onChange({ target: { checked: false } });
  nodes = render(); toggles(nodes)[1].props.onChange({ target: { checked: false } });
  nodes = render();
  assert.equal(nodes.find((node) => node.type === "input" && node.props.max === GENUINE_LIMITS.window_days.max)!.props.value, 21);
  assert.equal(nodes.find((node) => node.type === "ResearchHelp" && node.props.field === "autopublish")!.props.unavailableInheritance, false);
});

test("DERIVED scheduled check finishes with an open source editor: conflict reload keeps edits and requires an explicit second save", async () => {
  const before = research.decodeResearchSource({ ...GENUINE_SOURCE, revision: 2, last_check: {
    run_id: GENUINE_RUN.run_id, status: "running", finished_at: null, found: 3, imported: 0,
  } })!;
  let backend = research.decodeResearchSource({ ...before, revision: 3, month_cost_micro_usd: 1234, last_check: {
    ...before.last_check, status: "completed", finished_at: GENUINE_RUN.finished_at, imported: 1,
  } })!;
  assert.ok(before && backend);
  const slots: any[] = [], effects: (() => void)[] = [], calls: Record<string, unknown>[] = [];
  let index = 0, dirty = false, reloads = 0, closes = 0;
  const props = { row: before, defaults: GENUINE_DEFAULTS, areas: [GENUINE_AREA], actor: "operator@example.test", manage: true, limits: GENUINE_LIMITS,
    reload: async () => { reloads++; props.row = backend; }, close: () => { closes++; } };
  const context: any = { exports: {}, ...research, ...view, ...proxy, prepareResearchCommand, runResearchCommand, confirmResearchRetryActor, formatNumber,
    retainResearchCommandNavigation: () => () => {},
    React: { createElement: (type: any, value: any, ...children: any[]) => ({ type, props: value ?? {}, children }) },
    useLocale: () => "en", useTranslations: () => (key: string) => key,
    useState: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; dirty = true; }]; },
    useRef: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect: (effect: () => void, deps: any[]) => { const slot = index++, old = slots[slot]; slots[slot] = deps;
      if (!old || deps.some((value, i) => value !== old[i])) effects.push(effect); },
    adminCall: async (action: string, body: Record<string, unknown>) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return projectDatesAdminBody(action, { ...DERIVED_ENVELOPE, success: false, status_code: 409,
        error: "dates-research-conflict", current: backend });
      backend = research.decodeResearchSource({ ...backend, label: body.label, cadence_hours: body.cadence_hours, revision: 4 })!;
      return { ...DERIVED_ENVELOPE, replayed: false, audit_id: "aud_derived_source_save", source: backend };
    },
  };
  for (const name of ["AppearanceMapPicker", "ResearchCommandFeedback", "ResearchDuration", "ResearchHelp", "ResearchReason", "ResearchSaveIssue", "ResearchValuesFields"]) context[name] = name;
  vm.runInNewContext(code, context);
  function render(): Element[] {
    for (let attempt = 0; attempt < 10; attempt++) {
      index = 0; dirty = false;
      const result = elements(context.exports.ResearchSourceEditor(props));
      for (const effect of effects.splice(0)) effect();
      if (!dirty) return result;
    }
    throw new Error("Editor effects did not settle");
  }
  const label = (nodes: Element[]) => nodes.find((node) => node.type === "input" && node.props.type === "text")!;
  let nodes = render();
  label(nodes).props.onChange({ target: { value: "Unsaved collection label" } });
  nodes = render(); nodes.find((node) => node.type === "ResearchDuration")!.props.onChange(48);
  nodes = render(); nodes.find((node) => node.type === "ResearchReason")!.props.onChange("Keep edits after scheduled completion");
  nodes = render(); nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  await flush(); nodes = render();
  assert.equal(calls.length, 1, "the conflict/reload never automatically resends");
  assert.equal(calls[0].expected_revision, 2); assert.equal(reloads, 1); assert.equal(closes, 0);
  assert.equal(props.row.revision, 3); assert.equal(props.row.last_check?.status, "completed");
  assert.equal(label(nodes).props.value, "Unsaved collection label");
  assert.equal(nodes.find((node) => node.type === "ResearchDuration")!.props.hours, 48);
  assert.equal(nodes.find((node) => node.type === "ResearchReason")!.props.value, "Keep edits after scheduled completion");
  assert.equal(nodes.find((node) => node.type === "ResearchCommandFeedback")!.props.command.outcome.kind, "conflict");
  nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  await flush(); render();
  assert.equal(calls.length, 2); assert.equal(calls[1].expected_revision, 3);
  assert.equal(calls[1].label, "Unsaved collection label"); assert.equal(calls[1].cadence_hours, 48);
  assert.notEqual(calls[0].idempotency_key, calls[1].idempotency_key, "the explicit revised save is a new command after a definitive conflict");
  assert.equal(reloads, 2); assert.equal(closes, 1); assert.equal(backend.revision, 4);
});

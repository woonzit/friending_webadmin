import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as research from "../lib/datesResearchAdmin.ts";
import * as view from "../lib/datesResearchView.ts";
import * as proxy from "../lib/datesResearchProxy.ts";
import { confirmResearchRetryActor, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { DERIVED_ENVELOPE, GENUINE_AREA, GENUINE_DEFAULTS, GENUINE_LIMITS } from "./support/datesResearchCorpus.ts";

// DERIVED production handlers with controlled hooks/transport. Not a browser,
// React mount, genuine P3b capture, provider call or persistence claim.
const parse = (path: string) => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const discovery = parse("../components/DatesResearchDiscovery.tsx"), editors = parse("../components/DatesResearchEditors.tsx"), controls = parse("../components/DatesResearchControls.tsx");
const fn = (tree: ts.SourceFile, name: string) => tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(tree);
const code = ts.transpileModule([fn(editors, "useResearchDraft"), fn(controls, "useResearchCommand"),
  ...discovery.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(discovery))].join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
type Element = { type: any; props: any; children: any[] };
const elements = (node: any): Element[] => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
const base = () => ({ ...research, ...view, ...proxy, exports: {}, prepareResearchCommand, runResearchCommand, confirmResearchRetryActor,
  retainResearchCommandNavigation: () => () => {},
  React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
  useTranslations: () => (key: string) => key, useLocale: () => "en" });
test("DERIVED P3b policy controls follow returned domain limits, never a console count constant", () => {
  const models = { openai: "derived-openai", gemini: "derived-gemini" };
  const defaults = research.decodeResearchDefaults({ ...GENUINE_DEFAULTS, research_models: models,
    domains: [{ domain: "events.example.org", type: "official" }] })!;
  const changes: unknown[] = [];
  const context: any = { ...base(), useState: (value: any) => [value === "" ? "Reviewed policy" : value, (next: unknown) => changes.push(next)],
    useRef: (value: any) => ({ current: value }), useEffect: () => {} };
  for (const name of ["ResearchCommandFeedback", "ResearchHelp", "ResearchReason"]) context[name] = name;
  vm.runInNewContext(code, context);
  const props = { defaults, actor: "admin@example.test", manage: true, options: { openai: [models.openai], gemini: [models.gemini] }, reload: async () => {} };
  const controls = (range: unknown) => elements(context.exports.ResearchDomainEditor({ ...props, limits: { ...GENUINE_LIMITS, domains: range } }));
  for (const [range, addDisabled, saveDisabled] of [[{ min: 0, max: 0 }, true, true], [{ min: 0, max: 1 }, true, false],
    [{ min: 0, max: 2 }, false, false], [{ min: 2, max: 3 }, false, true]] as const) {
    const nodes = controls(range), add = nodes.find((node) => node.type === "button" && node.children.includes("discovery.addDomain"))!;
    assert.equal(add.props.disabled, addDisabled); assert.equal(nodes.find((node) => node.type === "button" && node.props.type === "submit")!.props.disabled, saveDisabled);
    const before = changes.length; add.props.onClick(); assert.equal(changes.length, before + (addDisabled ? 0 : 1), "handler also enforces the current add limit");
  }
  for (const range of [null, undefined]) {
    const nodes = controls(range);
    assert.ok(nodes.some((node) => node.children.includes("discovery.policyUnavailable")));
    assert.equal(nodes.some((node) => node.type === "button" && node.props.type === "submit"), false);
    const before = changes.length; nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} }); assert.equal(changes.length, before);
  }
});
test("DERIVED P3b area controls require fresh master, city eligibility, admitted discovery and an idle command", () => {
  const context: any = base(); vm.runInNewContext(code, context);
  const calls: any[] = [], command = { busy: false, retained: false, pending: null, submit: (action: string, body: unknown) => calls.push({ action, body: structuredClone(body) }) };
  for (const master of [false, true]) for (const running of [false, true]) for (const admitted of [false, true]) for (const busy of [false, true]) for (const retained of [false, true]) {
    const nodes = elements(context.exports.ResearchAreaRunButtons({ row: { ...GENUINE_AREA, running }, defaults: { ...GENUINE_DEFAULTS, enabled: master },
      admission: { openai_admitted: admitted }, manage: true, command: { ...command, busy, retained } }));
    const buttons = nodes.filter((node) => node.type === "button"); assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.equal(button.props.disabled, !master || !running || !admitted || busy || retained);
      if (!button.props.disabled) button.props.onClick();
    }
  }
  assert.deepEqual(calls, [true, false].map((dry_run) => ({ action: "dates_event_research_area_run_now", body: { area_id: GENUINE_AREA.area_id, expected_revision: GENUINE_AREA.revision, dry_run } })));
  for (const defaults of [null, { ...GENUINE_DEFAULTS, enabled: true }]) {
    const props = { row: { ...GENUINE_AREA, running: true }, defaults, admission: null, manage: true, command };
    assert.ok(elements(context.exports.ResearchAreaRunButtons(props)).filter((node) => node.type === "button").every((node) => node.props.disabled));
    assert.deepEqual(elements(context.exports.ResearchAreaRunButtons({ ...props, admission: undefined })), []);
    assert.deepEqual(elements(context.exports.ResearchAreaRunButtons({ ...props, manage: false })), []);
  }
});
test("DERIVED P3b policy conflict keeps domain edits, adopts fresh global/model values and submits only on explicit second save", async () => {
  const slots: any[] = [], effects: (() => void)[] = [], calls: any[] = [];
  let index = 0, dirty = false;
  const models = { openai: "derived-openai-old", gemini: "derived-gemini" };
  const initial = { ...GENUINE_DEFAULTS, revision: 1, research_models: models, domains: [{ domain: "old.example.org", type: "official" }] };
  let backend: any = { ...initial, revision: 2, enabled: true, research_models: { ...models, openai: "derived-openai-new" } };
  const props = { defaults: research.decodeResearchDefaults(initial)!, actor: "admin@example.test", manage: true, limits: { ...GENUINE_LIMITS, domains: { min: 0, max: 100 } },
    options: { openai: [models.openai, backend.research_models.openai], gemini: [models.gemini] }, reload: async () => { props.defaults = research.decodeResearchDefaults(backend)!; } };
  const context: any = { ...base(),
    useState: (initialValue: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initialValue; return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; dirty = true; }]; },
    useRef: (initialValue: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initialValue }; return slots[slot]; },
    useEffect: (effect: () => void, dependencies: any[]) => { const slot = index++, old = slots[slot]; slots[slot] = dependencies; if (!old || dependencies.some((value, at) => value !== old[at])) effects.push(effect); },
    adminCall: async (_action: string, body: any) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return { ...DERIVED_ENVELOPE, success: false, status_code: 409, error: "dates-research-conflict", current: backend };
      backend = { ...backend, ...body.values, revision: 3 };
      return { ...DERIVED_ENVELOPE, defaults: backend, replayed: false, audit_id: "aud_derived_policy" };
    },
  };
  for (const name of ["ResearchCommandFeedback", "ResearchHelp", "ResearchReason"]) context[name] = name;
  vm.runInNewContext(code, context);
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) { index = 0; dirty = false; const nodes = elements(context.exports.ResearchDomainEditor(props)); for (const effect of effects.splice(0)) effect(); if (!dirty) return nodes; }
    throw new Error("policy effects did not settle");
  }
  const domainInput = (nodes: Element[]) => nodes.find((node) => node.type === "input" && node.props.placeholder === "discovery.domainPlaceholder")!;
  let nodes = render(); domainInput(nodes).props.onChange({ target: { value: "edited.example.org" } });
  nodes = render(); nodes.filter((node) => node.type === "select").at(-1)!.props.onChange({ target: { value: "blocked" } });
  nodes = render(); nodes.find((node) => node.type === "ResearchReason")!.props.onChange("Keep domain edits after a conflict");
  nodes = render(); nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve)); nodes = render();
  assert.equal(calls.length, 1, "reload never resends automatically"); assert.equal(domainInput(nodes).props.value, "edited.example.org");
  assert.equal(nodes.filter((node) => node.type === "select")[0].props.value, "derived-openai-new");
  nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve)); nodes = render();
  assert.equal(calls.length, 2); assert.equal(calls[1].expected_revision, 2); assert.equal(calls[1].values.enabled, true);
  assert.deepEqual(calls[1].values.domains, [{ domain: "edited.example.org", type: "blocked" }]);
  assert.equal(calls[1].values.research_models.openai, "derived-openai-new");
  assert.notEqual(calls[0].idempotency_key, calls[1].idempotency_key, "a settled conflict permits an explicit new logical save");
  assert.equal(domainInput(nodes).props.value, "edited.example.org", "the typed receipt retains domain rows without double decoding");
});

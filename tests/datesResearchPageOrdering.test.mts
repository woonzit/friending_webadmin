import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { decodeResearchOverview } from "../lib/datesResearchAdmin.ts";
import { researchCost, researchDistanceUnit, researchMonthlyEstimate, researchStock } from "../lib/datesResearchView.ts";
import { formatDate, formatNumber } from "../lib/format.ts";
import { DERIVED_OVERVIEW, GENUINE_SOURCE } from "./support/datesResearchCorpus.ts";

// Production page handlers under a controlled hook scheduler; not a browser/React mount.
// Element descriptors verify stable mounted editor identity and actor/write props.
const source = readFileSync(new URL("../app/(dashboard)/dates/research/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const ready = (email = "operator@example.test") => ({ kind: "ready", value: decodeResearchOverview(DERIVED_OVERVIEW),
  operator: { email, capabilities: ["dates_external_event_review", "dates_external_event_manage"] }, manage: true });
type Element = { type: any; props: any; children: any[] };
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
}
function harness() {
  const slots: any[] = [], effects: (() => void)[] = [], requests: ((value: any) => void)[] = [], actors: string[] = [];
  let index = 0;
  const context: any = { exports: {}, window: { location: { href: "https://admin.example.test/dates/research" } }, URL, AbortController,
    React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useLocale: () => "en", useTranslations: () => (key: string) => key, adminCall: () => {},
    DATES_RESEARCH_VALUE_FIELDS: [], researchCost, researchDistanceUnit, researchMonthlyEstimate, researchStock, formatDate, formatNumber,
    readResearchOverview: () => new Promise((resolve) => requests.push(resolve)),
    useResearchCommand: (actor: string) => { actors.push(actor); return { busy: false, retained: false, pending: null, outcome: null }; },
    useState: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback: (callback: any, deps: any[]) => { const slot = index++, old = slots[slot]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[slot] = { callback, deps }; return slots[slot].callback; },
    useEffect: (effect: any, deps: any[]) => { const slot = index++, old = slots[slot]; slots[slot] = deps; if (!old || deps.some((value, i) => value !== old[i])) effects.push(effect); },
  };
  for (const name of ["PageHeader", "DatesAdminTabs", "DatesResearchRuns", "ResearchAreaEditor", "ResearchDefaultsEditor", "ResearchSourceEditor", "ResearchCommandFeedback", "ResearchHelp", "ResearchValue", "ErrorPanel", "LoadingPanel"]) context[name] = name;
  vm.runInNewContext(code, context);
  function render() { index = 0; const result = context.exports.default(); for (const effect of effects.splice(0)) effect(); return elements(result); }
  async function answer(value: any) { assert.ok(requests.length); requests.shift()!(value); await Promise.resolve(); await Promise.resolve(); }
  function refresh(nodes: Element[]) { nodes.find((node) => node.type === "PageHeader")!.props.actions.props.onClick(); }
  return { render, answer, refresh, actors, sourceRow: (props: any) => elements(context.SourceRow(props)) };
}
test("DERIVED source row: new checks require the master switch; disabled-source preview is allowed and archives allow neither", () => {
  const h = harness(), calls: { action: string; body: Record<string, unknown> }[] = [];
  const command = { busy: false, pending: null, submit: (action: string, body: Record<string, unknown>) => { calls.push({ action, body: structuredClone(body) }); } };
  for (const master of [true, false]) for (const [enabled, archived] of [[false, false], [true, false], [true, true], [false, true]]) {
    const row = { ...GENUINE_SOURCE, enabled, archived };
    const read = ready(); read.value!.defaults!.enabled = master;
    const nodes = h.sourceRow({ row, read, command, onEdit: () => {}, editing: false });
    const preview = nodes.find((node) => node.type === "button" && node.children.includes("test"))!;
    const real = nodes.find((node) => node.type === "button" && node.children.includes("runNow"))!;
    assert.equal(preview.props.disabled, !master || archived);
    assert.equal(real.props.disabled, !master || archived || !enabled);
    if (!preview.props.disabled) {
      preview.props.onClick();
      assert.deepEqual(calls.at(-1)?.body, { source_id: row.source_id, expected_revision: row.revision, dry_run: true });
    }
    if (!real.props.disabled) {
      real.props.onClick();
      assert.deepEqual(calls.at(-1)?.body, { source_id: row.source_id, expected_revision: row.revision, dry_run: false });
    }
  }
  const unknown = ready(); unknown.value!.defaults = null;
  const blocked = h.sourceRow({ row: GENUINE_SOURCE, read: unknown, command, onEdit: () => {}, editing: false });
  for (const label of ["test", "runNow"]) assert.equal(blocked.find((node) => node.type === "button" && node.children.includes(label))!.props.disabled, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.action === "dates_event_research_source_run_now"));
});
test("DERIVED city row: an absent count timestamp is not a measured zero", async () => {
  const h = harness(); h.render(); const read = ready();
  const area = read.value!.areas.rows[0]; area.member_count = 0; area.member_count_at = null;
  await h.answer(read); let nodes = h.render();
  const city = nodes.find((node) => node.type === "tr" && node.props.key === area.area_id)!;
  const memberCell = city.children[1]; assert.equal(memberCell.children[0], "membersNotCounted");
  h.refresh(nodes); const counted = ready(); counted.value!.areas.rows[0].member_count = 0; counted.value!.areas.rows[0].member_count_at = 1770000000;
  await h.answer(counted); nodes = h.render();
  const current = nodes.find((node) => node.type === "tr" && node.props.key === area.area_id)!;
  assert.equal(elements(current.children[1]).some((node) => node.children.includes("0")), true, "an actual measured zero remains zero");
});
for (const kind of ["unconfirmed", "denied", "unavailable"] as const) test(`research page ${kind}: fences stale actor and preserves mounted drafts/command owners`, async () => {
  const h = harness(); h.render(); await h.answer(ready());
  let nodes = h.render(); const before = nodes.find((node) => node.type === "ResearchDefaultsEditor")!;
  assert.equal(before.props.actor, "operator@example.test"); assert.equal(before.props.manage, true);
  nodes.find((node) => node.type === "button" && node.children.includes("addSource"))!.props.onClick();
  nodes = h.render(); const sourceEditor = nodes.find((node) => node.type === "ResearchSourceEditor")!;
  h.refresh(nodes); await h.answer({ kind }); nodes = h.render();
  const defaults = nodes.find((node) => node.type === "ResearchDefaultsEditor")!, source = nodes.find((node) => node.type === "ResearchSourceEditor")!;
  assert.equal(defaults.props.key, before.props.key); assert.equal(source.props.key, sourceEditor.props.key);
  assert.equal(defaults.props.actor, ""); assert.equal(source.props.actor, ""); assert.equal(defaults.props.manage, false); assert.equal(source.props.manage, false);
  assert.equal(h.actors.at(-1), ""); assert.equal(nodes.find((node) => node.type === "DatesResearchRuns")!.props.active, false);
  assert.equal(nodes.find((node) => node.type === "div" && Object.hasOwn(node.props, "hidden"))!.props.hidden, kind !== "unconfirmed");
  assert.equal(nodes.some((node) => node.type === "button" && node.children.includes("addSource")), false);
  h.refresh(nodes); await h.answer(ready()); nodes = h.render();
  assert.equal(nodes.find((node) => node.type === "ResearchSourceEditor")!.props.key, sourceEditor.props.key);
  assert.equal(h.actors.at(-1), "operator@example.test"); assert.equal(nodes.find((node) => node.type === "ResearchDefaultsEditor")!.props.manage, true);
  h.refresh(nodes); await h.answer(ready("other@example.test")); nodes = h.render();
  assert.notEqual(nodes.find((node) => node.type === "ResearchSourceEditor")!.props.key, sourceEditor.props.key, "a confirmed different actor never owns the old draft/command instance");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as research from "../lib/datesResearchAdmin.ts";
import * as view from "../lib/datesResearchView.ts";
import * as format from "../lib/format.ts";
import { GENUINE_RUN } from "./support/datesResearchCorpus.ts";

// DERIVED production component scheduler/transport; not a browser mount or a worker run.
const file = readFileSync(new URL("../components/DatesResearchRuns.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("runs.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
type Element = { type: any; props: any; children: any[] };
const elements = (node: any): Element[] => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
test("DERIVED polling terminal transition reloads overview once, not after every terminal detail read", async () => {
  const slots: any[] = [], effects: (() => void)[] = [], timers = new Map<number, () => void>();
  let index = 0, dirty = false, timerId = 0, terminal = false, unreadable = false, reloads = 0;
  const context: any = { ...research, ...view, ...format, exports: {}, AbortController, adminCall: () => {},
    React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    Link: "link", ErrorPanel: "error", LoadingPanel: "loading", ResearchHelp: "help", useTranslations: () => (key: string) => key, useLocale: () => "en",
    window: { setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, () => { timers.delete(id); callback(); }); return id; }, clearTimeout: (id: number) => timers.delete(id) },
    readResearchRuns: async () => ({ rows: [], unreadable: [], next_cursor: null }),
    readResearchRun: async () => unreadable ? null : ({ run: { ...GENUINE_RUN, status: terminal ? "completed" : "queued" }, candidates: { rows: [], unreadable: [] } }),
    useState: (value: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = value; return [slots[slot], (next: any) => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; dirty = true; }]; },
    useRef: (value: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: value }; return slots[slot]; },
    useCallback: (callback: any, deps: any[]) => { const slot = index++, old = slots[slot]; if (!old || deps.some((value, at) => value !== old.deps[at])) slots[slot] = { callback, deps }; return slots[slot].callback; },
    useEffect: (effect: () => void, deps: any[]) => { const slot = index++, old = slots[slot]; slots[slot] = deps; if (!old || deps.some((value, at) => value !== old[at])) effects.push(effect); },
  };
  vm.runInNewContext(code, context);
  const props = { areas: [], sources: [], focusRunId: GENUINE_RUN.run_id, refresh: 0, onRunFinished: async () => { reloads++; } };
  async function render() {
    for (let attempt = 0; attempt < 20; attempt++) {
      index = 0; dirty = false; const nodes = elements(context.exports.default(props)); effects.splice(0).forEach((effect) => effect());
      await Promise.resolve(); await Promise.resolve(); if (!dirty) return nodes;
    }
    throw new Error("run effects did not settle");
  }
  let nodes = await render(); assert.equal(reloads, 0); assert.equal(timers.size, 1);
  unreadable = true; timers.values().next().value!(); nodes = await render(); assert.equal(reloads, 0, "a failed poll is not completion proof");
  const refreshDetail = (nodes: Element[]) => {
    const detail = nodes.find((node) => node.type === "section" && node.props.className === "research-run-detail")!;
    elements(detail).find((node) => node.type === "button" && node.children.includes("refresh"))!.props.onClick();
  };
  unreadable = false; terminal = true; refreshDetail(nodes); nodes = await render(); assert.equal(reloads, 1);
  refreshDetail(nodes);
  await render(); assert.equal(reloads, 1, "the same terminal receipt never causes a refresh loop");
});

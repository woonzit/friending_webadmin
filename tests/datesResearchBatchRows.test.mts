import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DATES_INTAKE_REJECT_REASONS } from "../lib/datesIntakeAdmin.ts";
import { researchAuditReason } from "../lib/datesResearchProxy.ts";

// DERIVED consumer-only outcome; production batch component handlers/element
// descriptors are executed, without claiming a mounted browser/provider run.
const source = readFileSync(new URL("../components/DatesResearchBatch.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("batch.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function render(actor: string) {
  const command = { actor: "operator@example.test", action: "dates_event_intake_batch_decide", body: { intake_ids: ["xin_known", "xin_future"] } };
  const partial = { rows: [{ intake_id: "xin_known", outcome: "published", refusal: null, external_event_id: "xev_known" }], unreadable: [{ index: 1, id: "xin_future" }] };
  const outcome = { kind: "uncertain", error: null, partial };
  const context: any = { exports: {}, DATES_INTAKE_REJECT_REASONS, researchAuditReason, Link: "Link", ResearchReason: "ResearchReason", ResearchCommandFeedback: "Feedback",
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useTranslations: () => (key: string, values?: object) => values ? `${key}:${JSON.stringify(values)}` : key,
    useState: (initial: any) => [typeof initial === "function" ? initial() : initial, () => {}], useRef: (initial: any) => ({ current: initial }),
    useMemo: (fn: any) => fn(), useEffect: () => {}, useResearchCommand: () => ({ busy: false, retained: true, pending: command, outcome }),
  };
  vm.runInNewContext(code, context);
  return { element: context.exports.default({ runId: "rru_derived", rows: [], actor, manage: true, reload: async () => {} }), command, outcome };
}
test("DERIVED partial batch: one future row is unavailable, known outcomes remain visible, command feedback stays uncertain", () => {
  const { element, command, outcome } = render("operator@example.test");
  const flat = (node: any): any[] => Array.isArray(node) ? node.flatMap(flat) : node && typeof node === "object" && "type" in node ? [node, ...flat(node.children)] : [node];
  const nodes = flat(element), strings = nodes.filter((value) => typeof value === "string");
  assert.equal(strings.filter((value) => value.startsWith("unreadableRow:")).length, 1);
  assert.ok(strings.includes("xin_future")); assert.ok(strings.includes("batch.outcomes.published"));
  assert.equal(nodes.find((node) => node?.type === "Feedback").props.command.pending, command);
  assert.equal(nodes.find((node) => node?.type === "Feedback").props.command.outcome, outcome);
  for (const key of ["batch.publish", "batch.reject"]) assert.equal(nodes.find((node) => node?.type === "button" && node.children.includes(key)).props.disabled, true);
  assert.equal(render("").element, null, "unknown actors see none of the prior results or retry controls");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
import * as proxy from "../lib/datesResearchProxy.ts";
import * as research from "../lib/datesResearchAdmin.ts";
import * as view from "../lib/datesResearchView.ts";
import { GENUINE_DEFAULTS, GENUINE_LIMITS } from "./support/datesResearchCorpus.ts";

// DERIVED drafts and controlled production render/handlers, not a React/browser
// mount, provider capture, Core policy proof or persistence observation.
const source = readFileSync(new URL("../components/DatesResearchDiscovery.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("discovery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selected = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ResearchDomainEditor"
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(tree) === "policyDraft"));
const code = ts.transpileModule(selected.map((node) => node.getText(tree)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
type Element = { type: any; props: any; children: any[] };
const elements = (node: any): Element[] => Array.isArray(node) ? node.flatMap(elements)
  : node && typeof node === "object" && "type" in node ? [node, ...elements(node.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join("")
  : node && typeof node === "object" && "children" in node ? text(node.children) : typeof node === "string" ? node : "";
const row = (domain: string) => ({ domain, type: "official" as const });
test("DERIVED domain hints identify every normalized duplicate and syntax error without changing drafts", () => {
  const rows = [row("events.example.org"), row(" EVENTS.EXAMPLE.ORG "), row("bad_name.example.org"), row("other.example.org"), row("events.example.org")];
  const before = structuredClone(rows);
  assert.deepEqual(proxy.researchDomainDraftIssues(rows), [{ kind: "duplicate", otherIndex: 1 }, { kind: "duplicate", otherIndex: 0 },
    { kind: "invalid" }, null, { kind: "duplicate", otherIndex: 0 }]);
  assert.deepEqual(rows, before); assert.equal(proxy.researchDomainsValid(rows), false);
});
test("DERIVED domain hints use the same PHP trim/syntax rule and make no public-host or count decision", () => {
  for (const value of ["", "https://events.example.org", "events.example.org/path", "bad_name.example.org", "localhost", "\u00a0events.example.org"]) {
    assert.deepEqual(proxy.researchDomainDraftIssues([row(value)]), [{ kind: "invalid" }]);
    assert.equal(proxy.researchDomainsValid([row(value)]), false);
  }
  assert.deepEqual(proxy.researchDomainDraftIssues([row("\x00\t EVENTS.EXAMPLE.ORG \r\n")]), [null]);
  assert.deepEqual(proxy.researchDomainDraftIssues([row("127.0.0.1")]), [null], "Core, not this syntax hint, rejects non-public hosts");
  assert.deepEqual(proxy.researchDomainDraftIssues([]), []);
  assert.equal(proxy.researchDomainDraftIssues(Array.from({ length: 101 }, (_, index) => row(`events${index}.example.org`))).every((issue) => issue === null), true);
});
function harness(locale: "en" | "hu", domains: research.ResearchDomain[], retained = false) {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  let draft = { research_models: { openai: "derived-openai", gemini: "derived-gemini" }, domains };
  const calls: any[] = [];
  const pending = retained ? Object.freeze({ body: Object.freeze({ idempotency_key: "derived-original-retry-key" }) }) : null;
  const context: any = { ...proxy, ...research, ...view, exports: {},
    React: { Fragment: "fragment", createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }) },
    useTranslations: (namespace: string) => createTranslator({ locale, messages, namespace }),
    useState: () => ["Reviewed domain policy", () => {}],
    useResearchDraft: (_initial: unknown, revision: number) => ({ draft, revision, set: (next: typeof draft) => { draft = next; } }),
    useResearchCommand: () => ({ busy: false, retained, pending, outcome: retained ? { kind: "uncertain", error: "dates-research-domains-invalid" } : null,
      submit: (...args: any[]) => calls.push(args) }),
    ResearchCommandFeedback: "ResearchCommandFeedback", ResearchHelp: "ResearchHelp", ResearchReason: "ResearchReason" };
  vm.runInNewContext(code, context);
  const defaults = { ...GENUINE_DEFAULTS, research_models: draft.research_models, domains: { rows: domains, unreadable: [] } };
  const props = { defaults, options: { openai: [draft.research_models.openai], gemini: [draft.research_models.gemini] },
    limits: { ...GENUINE_LIMITS, domains: { min: 0, max: 100 } }, actor: "operator@example.test", manage: true, reload: async () => {} };
  return { render: () => elements(context.exports.ResearchDomainEditor(props)), calls, pending, copy: messages.datesAdmin.research.discovery,
    translator: createTranslator({ locale, messages, namespace: "datesAdmin.research.discovery" }) };
}
for (const locale of ["en", "hu"] as const) test(`DERIVED ${locale} domain editor names the bad rows and ties every error to its field`, () => {
  const cases: [research.ResearchDomain[], number[]][] = [[[row("events.example.org")], []],
    [[row("events.example.org"), row(" EVENTS.EXAMPLE.ORG ")], [0, 1]], [[row("events.example.org"), row("bad_name.example.org")], [1]]];
  for (const [domains, invalid] of cases) {
    const h = harness(locale, [...domains]), nodes = h.render();
    const inputs = nodes.filter((node) => node.type === "input" && node.props.placeholder === "events.example.org");
    assert.equal(inputs.length, domains.length);
    assert.equal(nodes.find((node) => node.type === "button" && node.props.type === "submit")!.props.disabled, invalid.length > 0);
    inputs.forEach((input, index) => {
      const issue = proxy.researchDomainDraftIssues(domains)[index];
      assert.equal(input.props["aria-invalid"], invalid.includes(index) ? true : undefined);
      if (!issue) { assert.equal(input.props["aria-describedby"], undefined); return; }
      const error = nodes.find((node) => node.props.id === input.props["aria-describedby"]);
      assert.ok(error); assert.equal(error.props.className, "field-error");
      const expected = issue.kind === "invalid" ? h.translator("domainInvalid", { row: index + 1 })
        : h.translator("domainDuplicate", { row: index + 1, other: issue.otherIndex + 1 });
      assert.equal(text(error), expected);
    });
    const labels = nodes.filter((node) => node.type === "label");
    for (let index = 0; index < domains.length; index++) assert.ok(labels.some((label) => text(label).includes(h.translator("domainRow", { row: index + 1 }))));
    const before = h.calls.length; nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
    assert.equal(h.calls.length, before + (invalid.length === 0 ? 1 : 0), "invalid drafts cannot bypass the disabled Save through form submit");
  }
});
test("DERIVED domain editor clears corrected diagnostics without trimming or rewriting draft text", () => {
  const h = harness("en", [row("events.example.org"), row(" EVENTS.EXAMPLE.ORG ")]);
  const inputs = h.render().filter((node) => node.type === "input" && node.props.placeholder === "events.example.org");
  inputs[1].props.onChange({ target: { value: " OTHER.EXAMPLE.ORG " } });
  const nodes = h.render();
  assert.equal(nodes.some((node) => node.props["aria-invalid"] === true), false);
  assert.equal(nodes.filter((node) => node.type === "input" && node.props.placeholder === "events.example.org")[1].props.value, " OTHER.EXAMPLE.ORG ");
  assert.equal(nodes.find((node) => node.type === "button" && node.props.type === "submit")!.props.disabled, false);
});
test("DERIVED domain diagnostics never release or replace a retained unknown command", () => {
  const h = harness("en", [row("events.example.org"), row("bad_name.example.org")], true), nodes = h.render();
  const feedback = nodes.find((node) => node.type === "ResearchCommandFeedback")!;
  assert.equal(feedback.props.command.pending, h.pending); assert.equal(feedback.props.command.retained, true);
  assert.equal(feedback.props.command.outcome.kind, "uncertain");
  nodes.find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 0); assert.equal(feedback.props.command.pending.body.idempotency_key, "derived-original-retry-key");
});

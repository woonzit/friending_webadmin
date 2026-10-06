import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "../lib/adminMembership.ts";
import { adminMembershipFailureText } from "../lib/adminMembershipFailureText.ts";

const sites = [
  ["components/ProfilePresenceConfiguration.tsx", 1], ["components/ProfileVerificationConfiguration.tsx", 1],
  ["app/(dashboard)/dates/[activityId]/page.tsx", 1], ["app/(dashboard)/dates/moderation/[caseId]/page.tsx", 1],
  ["components/UserModerationPanel.tsx", 1], ["components/AdminImageEditor.tsx", 2], ["components/FootprintReportsPanel.tsx", 1],
] as const;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
for (const locale of ["en", "hu"]) for (const [path, count] of sites) test(`DERIVED ${locale} operator failure text: actual presentation expressions in ${path}`, () => {
  const source = read(path), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = []; let errorCode = "";
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "adminMembershipFailureText") calls.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "errorCode") errorCode = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.equal(calls.length, count, "each reported presentation point is wired, including both image-editor errors");
  assert.match(source, /const membership = useTranslations\("adminMembership"\)/);
  const messages = JSON.parse(read(`messages/${locale}.json`));
  for (const call of calls) for (const error of [ADMIN_MEMBERSHIP_UNCONFIRMED, "core-unavailable", "admin-request-outcome-unknown", "future-feature-error"]) {
    const context: any = { exports: {}, response: { success: false, error }, error, loadError: error, saveError: error, actionError: error,
      adminMembershipFailureText, membership: (key: string) => messages.adminMembership[key], t: () => "existing localized feature fallback" };
    vm.runInNewContext(ts.transpileModule(`${errorCode}\nexports.text=${call.getText(tree)};`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    assert.equal(context.exports.text, error === ADMIN_MEMBERSHIP_UNCONFIRMED ? messages.adminMembership.requestUnconfirmed : "existing localized feature fallback");
    assert.ok(!context.exports.text.includes(ADMIN_MEMBERSHIP_UNCONFIRMED));
  }
});
test("operator failure copy is presentation-only: missing/ordinary/unknown-write values keep their caller's exact fallback", () => {
  for (const error of [undefined, null, "", "core-unavailable", "admin-request-outcome-unknown", { error: ADMIN_MEMBERSHIP_UNCONFIRMED }]) {
    assert.equal(adminMembershipFailureText(error, "unchanged fallback", "human membership sentence"), "unchanged fallback");
  }
  assert.equal(adminMembershipFailureText(ADMIN_MEMBERSHIP_UNCONFIRMED, "fallback", "human membership sentence"), "human membership sentence");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AdminMembershipNotice from "../components/AdminMembershipNotice.tsx";

// DERIVED DOM/network adapters for the actual neutral-shell logout function.
const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = file("components/AdminLogoutButton.tsx"), tree = ts.createSourceFile("logout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "logoutWithoutCore");
assert.ok(fn);
const code = ts.transpileModule(fn.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
test("DERIVED neutral logout: the departure guard resolves before the local POST; Stay sends/navigates nothing", async () => {
  let choose!: (leave: boolean) => void;
  const requests: unknown[] = [], routes: string[] = [], context: any = { exports: {},
    confirmResearchNavigation: () => new Promise<boolean>(resolve => { choose = resolve; }),
    fetch: async (...args: any[]) => { requests.push(args); return { ok: true }; }, window: { location: { assign: (route: string) => routes.push(route) } } };
  vm.runInNewContext(code, context);
  let pending = context.exports.logoutWithoutCore(); assert.equal(requests.length, 0); choose(false); await pending;
  assert.deepEqual(requests, []); assert.deepEqual(routes, []);
  pending = context.exports.logoutWithoutCore(); assert.equal(requests.length, 0); choose(true); await pending;
  assert.equal(requests.length, 1); assert.equal((requests[0] as any[])[0], "/api/auth/logout");
  assert.equal((requests[0] as any[])[1].method, "POST"); assert.deepEqual(routes, ["/login"]);
});
test("DERIVED neutral logout: failed local HTTP or connection never claims logout or navigates", async () => {
  for (const network of [false, true]) {
    const context: any = { exports: {}, confirmResearchNavigation: async () => true,
      fetch: async () => { if (network) throw new Error("DERIVED local disconnect"); return { ok: false }; },
      window: { location: { assign: () => assert.fail("unconfirmed local logout cannot navigate") } } };
    vm.runInNewContext(code, context); await assert.rejects(context.exports.logoutWithoutCore());
  }
  assert.doesNotMatch(source, /adminCall|adminMembershipRecovery|coreCall/);
  assert.doesNotMatch(file("app/api/auth/logout/route.ts"), /coreCall|adminMe\(/);
});
for (const locale of ["en", "hu"]) test(`DERIVED ${locale} unknown membership notice has reachable Sign out with no identity`, () => {
  const messages = JSON.parse(file(`messages/${locale}.json`));
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" }, createElement(AdminMembershipNotice, { visible: true })));
  assert.ok(html.includes(messages.common.logout)); assert.doesNotMatch(html, /operator@example|PROTECTED_/);
  assert.match(file("components/Shell.tsx"), /<AdminMembershipNotice visible=\{membershipUnconfirmed\} onLogout=\{logout\}/);
  assert.match(file("components/AdminMembershipUnavailable.tsx"), /<AdminMembershipNotice visible/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createResearchNavigationGuard } from "../lib/datesResearchNavigation.ts";
import { ResearchNavigationNoticeView } from "../components/DatesResearchNavigationNotice.tsx";

// DERIVED browser-event surfaces run the real guard callbacks. No mounted
// React/Next browser or authenticated session is claimed by these probes.
function harness() {
  const pageEvents = new Map<string, { callback: Function; capture: unknown }>(), browserEvents = new Map<string, { callback: Function; capture: unknown }>();
  const navigations: string[] = [], snapshots: unknown[] = [];
  const surface = (events: typeof pageEvents) => ({
    addEventListener: (name: string, callback: Function, capture: unknown) => { assert.equal(events.has(name), false, "only one shared guard listener"); events.set(name, { callback, capture }); },
    removeEventListener: (name: string, callback: Function, capture: unknown) => { const old = events.get(name); if (old) { assert.equal(old.callback, callback); assert.equal(old.capture, capture); events.delete(name); } },
  });
  const browser = { ...surface(browserEvents), location: { href: "https://admin.example.test/dates/research" },
    confirm: () => { throw new Error("browser dialogs suppressed"); }, alert: () => { throw new Error("browser dialogs suppressed"); } };
  const guard = createResearchNavigationGuard(browser as unknown as Window, surface(pageEvents) as unknown as Document);
  const unsubscribe = guard.subscribe(() => snapshots.push(guard.getSnapshot()));
  function dispatch(link: any, options: any = {}) {
    let prevented = false, stopped = false;
    const event = { button: 0, target: { closest: () => link }, defaultPrevented: false, ...options,
      preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
    pageEvents.get("click")?.callback(event); if (!prevented) navigations.push(link.href); return { prevented, stopped };
  }
  function click(href = "/dates/intakes", options: any = {}) {
    const link = { href: new URL(href, browser.location.href).href, target: options.linkTarget ?? "", isConnected: true,
      hasAttribute: (name: string) => name === "download" && !!options.download, click: () => {} };
    link.click = () => { dispatch(link); }; return dispatch(link, options);
  }
  return { browser, pageEvents, browserEvents, navigations, snapshots, guard, click, unsubscribe };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
test("DERIVED retained navigation: console, sidebar and batch links get a visible in-page choice even when browser dialogs are suppressed", async () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  assert.equal(h.pageEvents.get("click")!.capture, true);
  for (const href of ["/dates/intakes", "/users", "/dates/intakes/derived_intake", "/dates/external/derived_event"]) {
    assert.deepEqual(h.click(href), { prevented: true, stopped: true });
    assert.deepEqual(h.guard.getSnapshot(), { kind: "confirm", message: "leave-confirmation" });
    h.guard.choose(false); await flush();
  }
  assert.equal(h.navigations.length, 0); h.click(); h.guard.choose(true); await flush();
  assert.deepEqual(h.navigations, ["https://admin.example.test/dates/intakes"], "approved replay reaches the ordinary link handler exactly once");
  release(); assert.equal(h.pageEvents.size, 0); assert.equal(h.browserEvents.size, 0); h.unsubscribe();
});
test("DERIVED retained navigation: anchors, query-only links, downloads, new tabs and non-navigation schemes do not lose the page", () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  for (const [href, options] of [["#research-sources", {}], ["?run_id=derived", {}], ["/dates/intakes", { linkTarget: "_blank" }],
    ["/dates/intakes", { ctrlKey: true }], ["/dates/intakes", { metaKey: true }], ["/dates/intakes", { shiftKey: true }],
    ["/dates/intakes", { button: 1 }], ["/dates/intakes", { download: true }], ["/dates/intakes", { defaultPrevented: true }],
    ["/dates/intakes", { target: { closest: () => null } }], ["mailto:operator@example.test", {}], ["javascript:void(0)", {}]] as const)
    assert.deepEqual(h.click(href, options), { prevented: false, stopped: false });
  assert.equal(h.guard.getSnapshot(), null); release(); h.unsubscribe();
});
test("DERIVED retained navigation: owners share one notice and a missing notice surface never silently traps links", async () => {
  const h = harness(), first = h.guard.retain("first-owner", "first-history"), second = h.guard.retain("second-owner", "second-history");
  h.click(); assert.equal(h.guard.getSnapshot()!.message, "first-owner"); h.guard.choose(false); await flush(); first();
  h.click(); assert.equal(h.guard.getSnapshot()!.message, "second-owner"); h.guard.choose(false); await flush();
  h.unsubscribe(); assert.deepEqual(h.click(), { prevented: false, stopped: false });
  assert.deepEqual(h.guard.getSnapshot(), { kind: "history", message: "second-history" });
  assert.equal(await h.guard.request(), true); second(); assert.equal(h.pageEvents.size, 0); assert.equal(h.browserEvents.size, 0);
});
test("DERIVED retained navigation: unload delegates to the browser; history keeps a non-blocking Shell notice after the old page unmounts", () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  let prevented = false; const event = { returnValue: "unchanged", preventDefault: () => { prevented = true; } };
  h.browserEvents.get("beforeunload")!.callback(event); assert.equal(prevented, true); assert.equal(event.returnValue, "");
  assert.equal(h.browserEvents.get("popstate")!.capture, true);
  h.browser.location.href += "#research-runs"; h.browserEvents.get("popstate")!.callback({}); assert.equal(h.guard.getSnapshot(), null);
  h.browser.location.href = "https://admin.example.test/dates/intakes"; h.browserEvents.get("popstate")!.callback({});
  release(); assert.deepEqual(h.guard.getSnapshot(), { kind: "history", message: "history-warning" });
  h.guard.choose(false); assert.equal(h.guard.getSnapshot(), null); h.unsubscribe();
});
function compile(text: string) { return ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; }
test("DERIVED production Logout warns before its POST/router transition and Stay leaves the session alone", async () => {
  const source = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let logout: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "logout") logout = node; ts.forEachChild(node, visit); }; visit(tree); assert.ok(logout);
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning"), calls: unknown[] = [];
  const context: any = { exports: {}, confirmResearchNavigation: () => h.guard.request(), fetch: async (...args: unknown[]) => { calls.push(args); },
    router: { replace: (url: string) => calls.push(url), refresh: () => calls.push("refresh") } };
  vm.runInNewContext(compile(`${logout.getText(tree)}\nexports.logout=logout;`), context);
  let pending = context.exports.logout(); assert.equal(calls.length, 0); h.guard.choose(false); await pending; assert.equal(calls.length, 0);
  pending = context.exports.logout(); h.guard.choose(true); await pending;
  assert.equal(calls.length, 3); assert.equal((calls[0] as any[])[0], "/api/auth/logout"); assert.deepEqual(calls.slice(1), ["/login", "refresh"]);
  release(); h.unsubscribe();
});
test("DERIVED production Draft-from-source navigation warns without losing a retained batch; Stay reloads the queue", async () => {
  const source = readFileSync(new URL("../app/(dashboard)/dates/intakes/page.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("queue.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onCreated" && node.initializer && ts.isJsxExpression(node.initializer)) handler = node.initializer.expression; ts.forEachChild(node, visit); }; visit(tree); assert.ok(handler);
  const h = harness(), release = h.guard.retain("batch-confirmation", "batch-history"), routes: string[] = []; let reloads = 0;
  const context: any = { exports: {}, confirmResearchNavigation: () => h.guard.request(), datesIntakeLanding: (receipt: any) => `/dates/intakes/${receipt.intake_id}`,
    load: async () => { reloads++; }, router: { push: (url: string) => routes.push(url) } };
  vm.runInNewContext(compile(`exports.created=(${handler.getText(tree)});`), context);
  let pending = context.exports.created({ intake_id: "derived_created" }); assert.equal(routes.length, 0); h.guard.choose(false); await pending;
  assert.equal(reloads, 1); assert.equal(routes.length, 0); assert.equal(h.pageEvents.size, 1);
  pending = context.exports.created({ intake_id: "derived_created" }); h.guard.choose(true); await pending;
  assert.deepEqual(routes, ["/dates/intakes/derived_created"]); release(); h.unsubscribe();
});
for (const locale of ["en", "hu"]) test(`DERIVED ${locale}: navigation choice and history notice render real in-page copy without browser dialogs`, () => {
  // Existing shared ConfirmDialog uses the repo's classic test JSX runtime.
  (globalThis as any).React = React;
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")), copy = messages.datesAdmin.research;
  for (const kind of ["confirm", "history"] as const) {
    const errors: unknown[] = [];
    const html = renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: (error) => errors.push(error) },
      React.createElement(ResearchNavigationNoticeView, { notice: { kind, message: copy.navigation[kind] }, choose: () => {} })));
    assert.deepEqual(errors, []); assert.ok(html.includes(kind === "confirm" ? 'role="alertdialog"' : 'role="status"'));
    if (kind === "confirm") assert.ok(html.includes(copy.navigation.leave));
  }
});

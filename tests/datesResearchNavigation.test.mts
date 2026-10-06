import test from "node:test";
import assert from "node:assert/strict";
import { createResearchNavigationGuard } from "../lib/datesResearchNavigation.ts";

// DERIVED browser-event surfaces run the real guard callbacks. No mounted
// React/Next browser or authenticated session is claimed by these probes.
function harness() {
  const pageEvents = new Map<string, { callback: Function; capture: unknown }>(), browserEvents = new Map<string, { callback: Function; capture: unknown }>();
  const confirmations: string[] = [], alerts: string[] = []; let answer = false;
  const surface = (events: typeof pageEvents) => ({
    addEventListener: (name: string, callback: Function, capture: unknown) => { assert.equal(events.has(name), false, "only one shared guard listener"); events.set(name, { callback, capture }); },
    removeEventListener: (name: string, callback: Function, capture: unknown) => { const old = events.get(name); if (old) { assert.equal(old.callback, callback); assert.equal(old.capture, capture); events.delete(name); } },
  });
  const browser = { ...surface(browserEvents), location: { href: "https://admin.example.test/dates/research" },
    confirm: (text: string) => { confirmations.push(text); return answer; }, alert: (text: string) => { alerts.push(text); } };
  const page = surface(pageEvents), guard = createResearchNavigationGuard(browser as unknown as Window, page as unknown as Document);
  function click(href = "/dates/intakes", options: any = {}) {
    let prevented = false, stopped = false;
    const link = { href: new URL(href, browser.location.href).href, target: options.target ?? "", hasAttribute: (name: string) => name === "download" && !!options.download };
    const event = { button: 0, target: { closest: () => link }, defaultPrevented: false, ...options,
      preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
    pageEvents.get("click")?.callback(event); return { prevented, stopped };
  }
  return { browser, pageEvents, browserEvents, confirmations, alerts, guard, click, approve: () => { answer = true; } };
}
test("DERIVED retained navigation: console tab, sidebar and batch links can be canceled before their handlers run", () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  assert.equal(h.pageEvents.get("click")!.capture, true);
  for (const href of ["/dates/intakes", "/users", "/dates/intakes/derived_intake", "/dates/external/derived_event"])
    assert.deepEqual(h.click(href), { prevented: true, stopped: true });
  assert.equal(h.confirmations.length, 4); h.approve(); assert.deepEqual(h.click(), { prevented: false, stopped: false });
  release(); assert.equal(h.pageEvents.size, 0); assert.equal(h.browserEvents.size, 0);
  h.click(); assert.equal(h.confirmations.length, 5);
});
test("DERIVED retained navigation: anchors and query changes on the same page, downloads and new tabs do not discard its owner", () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  for (const [href, options] of [["#research-sources", {}], ["?run_id=derived", {}], ["/dates/intakes", { target: "_blank" }],
    ["/dates/intakes", { ctrlKey: true }], ["/dates/intakes", { metaKey: true }], ["/dates/intakes", { shiftKey: true }],
    ["/dates/intakes", { button: 1 }], ["/dates/intakes", { download: true }], ["/dates/intakes", { defaultPrevented: true }],
    ["/dates/intakes", { target: { closest: () => null } }]] as const)
    assert.deepEqual(h.click(href, options), { prevented: false, stopped: false });
  assert.equal(h.confirmations.length, 0); release();
});
test("DERIVED retained navigation: multiple commands share one prompt; releasing one owner keeps protection for another", () => {
  const h = harness(), first = h.guard.retain("first-owner", "first-history"), second = h.guard.retain("second-owner", "second-history");
  h.click(); assert.deepEqual(h.confirmations, ["first-owner"]); first();
  h.click(); assert.deepEqual(h.confirmations, ["first-owner", "second-owner"]); assert.equal(h.pageEvents.size, 1);
  second(); assert.equal(h.pageEvents.size, 0); assert.equal(h.browserEvents.size, 0);
});
test("DERIVED retained navigation: unload asks the browser to warn; history capture warns before Next without changing history", () => {
  const h = harness(), release = h.guard.retain("leave-confirmation", "history-warning");
  let prevented = false;
  const event = { returnValue: "unchanged", preventDefault: () => { prevented = true; } };
  h.browserEvents.get("beforeunload")!.callback(event); assert.equal(prevented, true); assert.equal(event.returnValue, "");
  assert.equal(h.browserEvents.get("popstate")!.capture, true);
  h.browser.location.href += "#research-runs"; h.browserEvents.get("popstate")!.callback({}); assert.equal(h.alerts.length, 0);
  h.browser.location.href = "https://admin.example.test/dates/intakes"; h.browserEvents.get("popstate")!.callback({});
  assert.deepEqual(h.alerts, ["history-warning"]); release();
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { FriendingStartPolicyView } from "../components/FriendingStartConfiguration.tsx";
import { ADMIN_HELP_PAGES } from "../lib/adminHelp.ts";
import {
  FRIENDING_START_METHODS,
  FRIENDING_START_POLICY_INITIAL_MODEL,
  friendingStartPolicyNewlyDisabled,
  friendingStartPolicyReadOutcome,
  friendingStartPolicyReducer,
  friendingStartPolicySaveBody,
  friendingStartPolicySaveOutcome,
  friendingStartPolicySendable,
  type FriendingStartPolicyEvent,
  type FriendingStartPolicyModel,
} from "../lib/friendingStartPolicy.ts";
import { ORIGIN, base, clone, editing, loaded, refusal, run, stateBody, type Json } from "./support/friendingStartCorpus.mts";

// The Friending Start panel on Configuration: its own save handlers, what it shows in each state in both languages, its
// copy, its help topic and where it is mounted. The contract under it is tests/friendingStartPolicy.test.mts.

// ---------------------------------------------------------------- the panel's own handlers

const COMPONENT = readFileSync(new URL("../components/FriendingStartConfiguration.tsx", import.meta.url), "utf8");
function handler(name: string): string {
  const tree = ts.createSourceFile("FriendingStartConfiguration.tsx", COMPONENT, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; else ts.forEachChild(node, visit); };
  visit(tree);
  assert.ok(found, name);
  return found.getText(tree);
}
/** The component's real `requestSave` and `executeSave`; the hooks' state, the dialog and the transport are DERIVED seams. */
function panel(model: FriendingStartPolicyModel, answers: unknown[]) {
  const calls: Array<{ action: string; body: unknown }> = [], events: FriendingStartPolicyEvent[] = [], confirming: unknown[] = [];
  const context: any = { exports: {}, model, inFlight: { current: false },
    dispatch: (event: FriendingStartPolicyEvent) => { events.push(event); context.model = friendingStartPolicyReducer(context.model, event); },
    setConfirming: (value: unknown) => { confirming.push(value); },
    adminCall: async (action: string, body?: unknown) => { calls.push({ action, body }); return answers.shift() ?? null; },
    friendingStartPolicySendable, friendingStartPolicySaveBody, friendingStartPolicySaveOutcome, friendingStartPolicyReadOutcome, friendingStartPolicyNewlyDisabled };
  vm.runInNewContext(ts.transpileModule(`${handler("executeSave")}\n${handler("requestSave")}\nexports.requestSave = requestSave; exports.executeSave = executeSave;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { calls, events, confirming, context, requestSave: context.exports.requestSave as () => void, executeSave: context.exports.executeSave as () => Promise<void> };
}

test("the panel's own save: both methods off is never sent, a method switched off is confirmed first, and a 409 is followed by one read", async () => {
  const both = base();
  Object.assign(both.data.configuration, { radar_enabled: true, touch_enabled: true });
  const none = run([{ type: "toggled", method: "radar_enabled", value: false }, { type: "toggled", method: "touch_enabled", value: false }], loaded(both));
  const blocked = panel(none, []);
  blocked.requestSave();
  await blocked.executeSave();
  assert.deepEqual(blocked.calls, [], "nothing leaves the browser"); assert.deepEqual(blocked.events, []); assert.deepEqual(blocked.confirming, []);

  // One method off: the operator is asked first, and only the confirmed save is sent - once, as the exact command.
  const touchOff = run([{ type: "toggled", method: "touch_enabled", value: false }], loaded(both));
  const saved = clone(both);
  Object.assign(saved.data.configuration, { revision: both.data.configuration.revision + 1, touch_enabled: false });
  const asked = panel(touchOff, [saved]);
  asked.requestSave();
  assert.deepEqual(asked.confirming.map((value) => [...(value as string[])]), [["touch_enabled"]]);
  assert.deepEqual(asked.calls, [], "asking sends nothing");
  await asked.executeSave();
  assert.deepEqual(asked.calls.map((call) => ({ action: call.action, body: JSON.parse(JSON.stringify(call.body)) })), [{ action: "save_friending_start_policy",
    body: { expected_revision: both.data.configuration.revision, configuration: { schema_version: 1, radar_enabled: true, touch_enabled: false } } }]);
  assert.equal(asked.context.model.notice.key, "saved"); assert.equal(asked.context.model.busy, false); assert.equal(asked.context.inFlight.current, false);
  assert.deepEqual(asked.confirming.at(-1), null, "the dialog closes with the answer");

  // Switching a method ON needs no confirmation: it goes straight out.
  const touchOn = run([{ type: "toggled", method: "touch_enabled", value: true }], loaded(base()));
  const direct = panel(touchOn, [null]);
  direct.requestSave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(direct.calls.length, 1); assert.equal(direct.context.model.notice.key, "notConfirmed");
  assert.deepEqual(direct.context.model.draft, { radar_enabled: true, touch_enabled: true }, "no answer: the draft is kept");

  // A 409: the newer revision is read once, and the draft stays on top of it.
  const winner = clone(both);
  Object.assign(winner.data.configuration, { revision: both.data.configuration.revision + 3 });
  const raced = panel(touchOff, [refusal("friending-start-policy-conflict"), winner]);
  await raced.executeSave();
  assert.deepEqual(raced.calls.map((call) => call.action), ["save_friending_start_policy", "friending_start_policy"]);
  assert.deepEqual(raced.context.model.notice, { tone: "error", key: "conflict", revision: both.data.configuration.revision + 3 });
  assert.deepEqual(raced.context.model.draft, { radar_enabled: true, touch_enabled: false });
  // A second click while a request is in flight does nothing.
  const busy = panel(touchOff, [saved]);
  busy.context.inFlight.current = true;
  await busy.executeSave();
  assert.deepEqual(busy.calls, []);
});

// ---------------------------------------------------------------- the panel, rendered

const messages = (locale: "en" | "hu"): Json => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function render(model: FriendingStartPolicyModel, locale: "en" | "hu" = "en"): string {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: messages(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(FriendingStartPolicyView, { model, onToggle() {}, onSave() {}, onDiscard() {}, onReload() {} }),
  ));
  assert.deepEqual(errors, [], "every message the panel asks for exists");
  return html;
}
const saveButton = (html: string) => html.match(/<button[^>]*data-friending-start-save="save"[^>]*>[^<]*<\/button>/)?.[0] ?? null;
const switches = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

for (const locale of ["en", "hu"] as const) test(`${locale}: a read that failed shows no switch at all, and says nothing was assumed`, () => {
  const copy = messages(locale).configuration.friendingStart;
  for (const [model, phase, text] of [[loaded(refusal("friending-start-policy-unavailable")), "unavailable", copy.unavailable], [loaded(null), "unavailable", copy.unavailable],
    [loaded({ success: true }), "error", copy.loadError]] as const) {
    const html = render(model, locale);
    assert.match(html, new RegExp(`data-friending-start-phase="${phase}"`));
    assert.ok(html.includes(escaped(text)), text);
    assert.deepEqual(switches(html), [], "a failed read is never drawn as 'off'");
    assert.equal(saveButton(html), null);
    assert.ok(html.includes(`>${escaped(copy.reload)}</button>`));
    assert.equal(html.includes(escaped(copy.disabled)), false); assert.equal(html.includes(escaped(copy.enabled)), false);
  }
  const loading = render(FRIENDING_START_POLICY_INITIAL_MODEL, locale);
  assert.ok(loading.includes(escaped(copy.loading))); assert.deepEqual(switches(loading), []);
});

for (const locale of ["en", "hu"] as const) test(`${locale}: ${ORIGIN}: a read-only operator sees the switches locked and no save; a writer's draft offers it`, () => {
  const copy = messages(locale).configuration.friendingStart;
  const viewer = render(loaded(stateBody("a viewer's state", (state) => !state.can_write)), locale);
  assert.equal(saveButton(viewer), null);
  assert.match(viewer, /data-friending-start-read-only="true"/); assert.ok(viewer.includes(escaped(copy.readOnly)));
  assert.equal(switches(viewer).length, FRIENDING_START_METHODS.length);
  assert.equal(switches(viewer).filter((input) => / disabled=""/.test(input)).length, FRIENDING_START_METHODS.length);
  assert.equal(viewer.includes(escaped(copy.discard)), false);

  const { edited } = editing();
  const draft = render(edited, locale);
  assert.doesNotMatch(draft, /data-friending-start-read-only/);
  assert.equal(saveButton(draft), `<button class="button button-primary" type="button" data-friending-start-save="save">${escaped(copy.save)}</button>`);
  assert.equal(switches(draft).filter((input) => / disabled=""/.test(input)).length, 0);
  assert.ok(draft.includes(escaped(copy.unsaved))); assert.ok(draft.includes(escaped(copy.changed)));
  // Each switch shows the draft, and each method is described.
  for (const method of FRIENDING_START_METHODS) {
    const card = draft.slice(draft.indexOf(`data-friending-start-method="${method}"`)).split("</article>")[0];
    assert.equal(/ checked=""/.test(card), edited.draft![method], method);
    assert.ok(card.includes(escaped(copy.methods[method].title))); assert.ok(card.includes(escaped(copy.methods[method].copy)));
    assert.ok(card.includes(escaped(edited.draft![method] ? copy.enabled : copy.disabled)));
  }
  // Saving: the button says so and nothing can be changed under the request.
  const sending = render(run([{ type: "saveStarted" }], edited), locale);
  assert.match(saveButton(sending)!, new RegExp(`disabled="">${escaped(copy.saving)}</button>$`));
  assert.equal(switches(sending).filter((input) => / disabled=""/.test(input)).length, FRIENDING_START_METHODS.length);
});

for (const locale of ["en", "hu"] as const) test(`${locale}: ${ORIGIN}: a conflict is explained over the kept draft, an unconfirmed save says so, and both keep the switches as the operator left them`, () => {
  const copy = messages(locale).configuration.friendingStart;
  const { edited, sent } = editing();
  const winner = base();
  Object.assign(winner.data.configuration, { revision: sent.expected_revision + 4, radar_enabled: !edited.draft!.radar_enabled || !edited.draft!.touch_enabled, touch_enabled: edited.draft!.radar_enabled });
  const rebased = run([{ type: "saveStarted" }, { type: "saveFinished", outcome: { kind: "conflict" } },
    { type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome(winner) }], edited);
  const html = render(rebased, locale);
  assert.match(html, /data-friending-start-notice="conflict"/);
  assert.ok(html.includes(escaped(`${copy.conflict.replace("{revision}", String(sent.expected_revision + 4))} ${copy.conflictDraftKept}`)));
  for (const method of FRIENDING_START_METHODS) {
    const card = html.slice(html.indexOf(`data-friending-start-method="${method}"`)).split("</article>")[0];
    assert.equal(/ checked=""/.test(card), edited.draft![method], `${method} still shows the operator's choice`);
  }
  assert.doesNotMatch(saveButton(html)!, /disabled/, "the kept draft can be saved onto the revision that won");
  // A winner that already says what the draft says leaves nothing to save, and does not claim a kept draft.
  const same = base();
  Object.assign(same.data.configuration, { revision: sent.expected_revision + 4, ...edited.draft });
  const agreed = render(run([{ type: "saveStarted" }, { type: "saveFinished", outcome: { kind: "conflict" } },
    { type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome(same) }], edited), locale);
  assert.equal(agreed.includes(escaped(copy.conflictDraftKept)), false); assert.match(saveButton(agreed)!, /disabled=""/);

  const lost = render(run([{ type: "saveStarted" }, { type: "saveFinished", outcome: friendingStartPolicySaveOutcome(null, sent) }], edited), locale);
  assert.match(lost, /data-friending-start-notice="notConfirmed"/); assert.ok(lost.includes(escaped(copy.notConfirmed)));
  assert.ok(lost.includes(`>${escaped(copy.reload)}</button>`), "reload is offered to check what is stored");
  for (const method of FRIENDING_START_METHODS) {
    const card = lost.slice(lost.indexOf(`data-friending-start-method="${method}"`)).split("</article>")[0];
    assert.equal(/ checked=""/.test(card), edited.draft![method], method);
  }
  // Core's 422, a lost write role and an answer the console does not understand each have their own words.
  for (const [outcome, key] of [[{ kind: "invalid" }, "invalid"], [{ kind: "unexpected" }, "unexpected"], [{ kind: "writeRequired" }, "writeRequired"]] as const) {
    const said = render(run([{ type: "saveStarted" }, { type: "saveFinished", outcome }], edited), locale);
    assert.match(said, new RegExp(`data-friending-start-notice="${key}"`)); assert.ok(said.includes(escaped(copy[key])), key);
  }
});

for (const locale of ["en", "hu"] as const) test(`${locale}: with both methods off the panel says why it will not save, and offers no save to press`, () => {
  const copy = messages(locale).configuration.friendingStart;
  const both = base();
  Object.assign(both.data.configuration, { radar_enabled: true, touch_enabled: true });
  const none = run([{ type: "toggled", method: "radar_enabled", value: false }, { type: "toggled", method: "touch_enabled", value: false }], loaded(both));
  const html = render(none, locale);
  assert.match(html, /<div id="friending-start-both-off" class="alert alert-error" role="alert" data-friending-start-both-off="true">/);
  assert.ok(html.includes(escaped(copy.bothOff)));
  assert.match(saveButton(html)!, /disabled=""/); assert.match(saveButton(html)!, /aria-describedby="friending-start-both-off"/);
  assert.equal(switches(html).filter((input) => / checked=""/.test(input)).length, 0, "the switches show what the operator did");
  assert.equal(switches(html).filter((input) => / disabled=""/.test(input)).length, 0, "and either can be switched back on");
  assert.equal(html.includes(escaped(copy.unsaved)), false, "'unsaved changes' would suggest it can be saved");
  assert.ok(html.includes(`>${escaped(copy.discard)}</button>`));
  // One back on: the explanation goes, the save comes back.
  const one = render(run([{ type: "toggled", method: "touch_enabled", value: true }], none), locale);
  assert.doesNotMatch(one, /data-friending-start-both-off/); assert.doesNotMatch(saveButton(one)!, /disabled/);
  // A viewer is never told to switch something on.
  const viewerBody = stateBody("a viewer's state", (state) => !state.can_write);
  assert.doesNotMatch(render(loaded(viewerBody), locale), /data-friending-start-both-off/);
});

test("the copy says what the two methods really are, in both languages with the same keys", () => {
  const en = messages("en").configuration.friendingStart, hu = messages("hu").configuration.friendingStart;
  const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object"
    ? Object.entries(value as Json).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];
  assert.deepEqual(keys(en).sort(), keys(hu).sort());
  assert.deepEqual(Object.keys(en.methods), [...FRIENDING_START_METHODS]);
  for (const method of FRIENDING_START_METHODS) for (const leaf of ["title", "short", "copy"]) {
    assert.ok(en.methods[method][leaf] && hu.methods[method][leaf], `${method}.${leaf}`);
  }
  for (const key of ["saved", "conflict", "revision"]) { assert.match(en[key], /\{revision\}/, `en.${key}`); assert.match(hu[key], /\{revision\}/, `hu.${key}`); }
  assert.match(en.confirmCopy, /\{methods\}/); assert.match(hu.confirmCopy, /\{methods\}/);
  // Radar: both open Friending Start and tap each other in the list of people nearby; Bluetooth and the local network.
  assert.match(en.methods.radar_enabled.copy, /Both people open Friending Start and tap each other in the list of people nearby/);
  assert.match(en.methods.radar_enabled.copy, /Bluetooth and the local network/);
  assert.match(hu.methods.radar_enabled.copy, /Mindketten megnyitják a Friending Startot/); assert.match(hu.methods.radar_enabled.copy, /Bluetoothon és a helyi hálózaton/);
  // Touch: phones touched together; on iPhone radio range and a simultaneous bump - NOT NFC, and why.
  assert.match(en.methods.touch_enabled.copy, /touch their phones together/);
  assert.match(en.methods.touch_enabled.copy, /On iPhone this is detected from the phones' radio range and a simultaneous bump, not NFC, because iOS offers no phone-to-phone NFC to apps/);
  assert.match(hu.methods.touch_enabled.copy, /összeérintik a telefonjukat/); assert.match(hu.methods.touch_enabled.copy, /nem NFC-vel, mert az iOS nem ad az appoknak két telefon közötti NFC-t/);
  for (const copy of [en, hu]) assert.doesNotMatch(JSON.stringify([copy.methods.radar_enabled, copy.title, copy.subtitle]), /NFC/, "nothing but the touch method mentions NFC, and only to say it is not used");
  for (const text of [en.touchNote, hu.touchNote]) assert.match(text, /NFC/);
  // Friendship is made only with a method that is on; switching one off reaches members with their next configuration read.
  assert.match(en.subtitle, /Friendship is made only in the app's Friending Start screen, with a method that is switched on here/);
  assert.match(hu.subtitle, /Barátság csak az app Friending Start képernyőjén jön létre, egy itt bekapcsolt módszerrel/);
  assert.match(en.scope, /the next time their app reads its configuration/); assert.match(hu.scope, /legközelebb beolvassa a beállításait/);
  assert.match(en.bothOff, /At least one method has to stay on/); assert.match(hu.bothOff, /Legalább az egyik módszernek bekapcsolva kell maradnia/);
  // Hungarian is Hungarian: only the product name, the revision line's shape and nothing else may coincide.
  const same = keys(en).filter((path) => { const read = (tree: any) => path.split(".").reduce((node, key) => node[key], tree); return read(en) === read(hu); });
  assert.deepEqual(same, ["title"]);
  // No article directly before the revision number in Hungarian ("az 1." but "a 5."): the number follows a colon or opens the phrase.
  for (const key of ["saved", "conflict", "revision"]) assert.doesNotMatch(hu[key], /\baz? \{revision\}/, key);
});

test("the help topic exists in the catalogue and in both languages, and tells the operator when a switched-off method takes effect", () => {
  const page = ADMIN_HELP_PAGES.find((entry) => entry.key === "configuration");
  assert.ok(page);
  const sections = page.sections as readonly string[];
  assert.equal(sections.indexOf("friendingStart"), sections.indexOf("locationAccess") + 1, "beside the panel it is modelled on");
  const en = messages("en").adminHelp.pages.configuration.sections.friendingStart, hu = messages("hu").adminHelp.pages.configuration.sections.friendingStart;
  assert.deepEqual(Object.keys(en.actions), Object.keys(hu.actions));
  assert.match(en.guidance, /takes effect for each member the next time their app reads its configuration/);
  assert.match(hu.guidance, /akkor lép életbe, amikor az appja legközelebb beolvassa a beállításait/);
  assert.match(en.guidance, /not NFC, because iOS offers apps no NFC between two phones/); assert.match(hu.guidance, /nem NFC-vel, mert az iOS nem ad az appoknak két telefon közötti NFC-t/);
  assert.match(en.guidance, /Bluetooth and the local network/); assert.match(hu.guidance, /Bluetoothon és a helyi hálózaton/);
  assert.match(en.purpose, /Friendship is made only with a method that is on/); assert.match(hu.purpose, /Barátság csak bekapcsolt módszerrel jön létre/);
  // The button the help names is the button the panel has.
  for (const locale of ["en", "hu"] as const) {
    const all = messages(locale);
    assert.ok(all.adminHelp.pages.configuration.sections.friendingStart.actions["2"].includes(all.configuration.friendingStart.save), locale);
  }
});

test("the Configuration page mounts the panel after location access without parting its neighbours, and the proxy applies its normaliser", () => {
  const page = readFileSync(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(page, /<LocationAccessConfiguration \/>\s*<FriendingStartConfiguration \/>\s*<ProfileVerificationConfiguration \/>/);
  // The mount strings the neighbouring panels' own tests pin are untouched.
  assert.match(page, /<ProfilePresenceConfiguration \/>\s*<LocationAccessConfiguration \/>/);
  assert.match(page, /<WelcomeMessageConfiguration \/>/);
  assert.equal(page.match(/<FriendingStartConfiguration \/>/g)?.length, 1);
  assert.match(route, /const normalizedFriendingStartBody = normalizeFriendingStartPolicyProxyBody\(action, body\);\s+if \(normalizedFriendingStartBody === null\) \{\s+return bridgeError\("invalid-input", 400\);\s+\}\s+if \(normalizedFriendingStartBody !== undefined\) body = normalizedFriendingStartBody;/);
  assert.ok(route.indexOf("normalizeFriendingStartPolicyProxyBody(action, body)") < route.indexOf("const result = await coreCall("), "before anything is forwarded");
  // The component asks Core through the same-origin bridge only, by the two allow-listed actions.
  assert.deepEqual([...COMPONENT.matchAll(/adminCall\("([a-z_]+)"/g)].map((match) => match[1]).sort(),
    ["friending_start_policy", "friending_start_policy", "save_friending_start_policy"]);
  assert.doesNotMatch(COMPONENT, /fetch\(|localStorage|sessionStorage/);
});

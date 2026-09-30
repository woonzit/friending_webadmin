import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { datesExternalDraft, DATES_EXTERNAL_CATEGORIES } from "../lib/datesExternalInput.ts";
import { appearanceMapMoveAccepted, isTrustedAppearanceMapEvent, parseAppearanceMapFrameMessage } from "../lib/appearanceMap.ts";

const form = readFileSync(new URL("../components/DatesExternalEventForm.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../components/DatesExternalVenueMap.tsx", import.meta.url), "utf8");

test("manual form copy covers every draft field and category in EN and HU", () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const copy = messages.datesAdmin.external.form;
    for (const field of Object.keys(datesExternalDraft())) assert.ok(copy[field], `${locale}.${field}`);
    assert.deepEqual(Object.keys(copy.categories).sort(), [...DATES_EXTERNAL_CATEGORIES].sort());
    for (const error of ["startTime", "endTime", "facts", "confirmations", "reason"]) assert.ok(copy.errors[error]);
    for (const key of ["manualOnly", "timeHint", "endHint", "mapHint", "mapUnavailable", "imagePolicy"]) assert.ok(copy[key]);
  }
  assert.doesNotMatch(form, /adminCall|fetch\(|type="file"/);
  assert.match(form, /datesExternalDraftInput\(draft\)/);
  assert.match(form, /fieldset className="dates-external-fields" disabled=\{disabled\}/);
  assert.match(form, /\.\.\.current, \.\.\.DATES_EXTERNAL_FRESH_CONFIRMATIONS, \[key\]: value/);
  assert.match(form, /if \(disabled\) return;/);
});

// Execute the production message handler in a controlled hook closure. This
// proves its event/lock logic, not a mounted map, a browser or a provider call.
function receiver() {
  const ast = ts.createSourceFile("DatesExternalVenueMap.tsx", map, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "receive") handler = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler);
  const source = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;
  const frameWindow = {};
  const frame = { current: { contentWindow: frameWindow } };
  const disabledRef = { current: false };
  const moves: unknown[] = [];
  const onMoveRef = { current: (point: unknown) => { moves.push(point); } };
  let ready = 0;
  const receive = new Function("isTrustedAppearanceMapEvent", "parseAppearanceMapFrameMessage", "appearanceMapMoveAccepted",
    "window", "frame", "disabledRef", "onMoveRef", "setReadyGeneration", `${source}; return receive;`)(
    isTrustedAppearanceMapEvent, parseAppearanceMapFrameMessage, appearanceMapMoveAccepted,
    { location: { origin: "https://console.example" } }, frame, disabledRef, onMoveRef,
    (update: (current: number) => number) => { ready = update(ready); },
  );
  const message = (data: unknown, origin = "https://console.example", sender: object = frameWindow) => receive({ data, origin, source: sender });
  return { message, moves, disabledRef, onMoveRef, ready: () => ready };
}

test("venue map accepts only its own same-origin frame and closed finite-coordinate messages", () => {
  const scope = receiver();
  const data = { type: "friending.appearance-map.moved", center: { latitude: 47.5, longitude: 19.04 } };
  scope.message(data, "https://evil.example");
  scope.message(data, "https://console.example", {});
  scope.message({ ...data, center: { latitude: NaN, longitude: 19 } });
  scope.message({ ...data, center: { latitude: 91, longitude: 19 } });
  scope.message({ ...data, injected: true });
  assert.deepEqual(scope.moves, []);
  scope.message(data);
  assert.deepEqual(scope.moves, [data.center]);
});

test("venue map uses the current disabled flag and callback, including after a write begins", () => {
  const scope = receiver();
  const data = { type: "friending.appearance-map.moved", center: { latitude: 1, longitude: 2 } };
  scope.disabledRef.current = true;
  scope.message(data);
  assert.deepEqual(scope.moves, []);
  const fresh: unknown[] = [];
  scope.onMoveRef.current = (point) => { fresh.push(point); };
  scope.disabledRef.current = false;
  scope.message(data);
  assert.deepEqual(scope.moves, []);
  assert.deepEqual(fresh, [data.center]);
});

test("each frame-ready handshake resends coordinates, including a locale reload", () => {
  const scope = receiver();
  scope.message({ type: "friending.appearance-map.ready" });
  scope.message({ type: "friending.appearance-map.ready" });
  assert.equal(scope.ready(), 2);
  assert.match(map, /\[hasKey, readyGeneration, center, language\]/);
  assert.doesNotMatch(map, /onLoad=|setReady\(false\)/, "an iframe load must not race the ready message");
});

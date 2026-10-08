import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalPinsConfiguration from "../components/DatesExternalPinsConfiguration.tsx";
import { EventIconPin } from "../components/DatesPinControls.tsx";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { DATES_EXTERNAL_CATEGORIES } from "../lib/datesExternalInput.ts";
import {
  EXTERNAL_PIN_EDITOR_INITIAL, externalPinDirty, externalPinEditorReducer, externalPinHold, externalPinProblems, externalPinSaveBlock, externalPinSaveCommand,
  type ExternalPinCommand, type ExternalPinEditorAction, type ExternalPinEditorState,
} from "../lib/datesExternalPinEditor.ts";
import {
  DEFAULT_EXTERNAL_PIN_COLOR, EXTERNAL_PIN_KEYS, externalPinCatalog, externalPinReceipt, externalPinSaveOutcome, normalizeDatesExternalPinsProxyBody,
  serializeExternalPins, type DatesExternalPinCatalog, type DatesExternalPinFields,
} from "../lib/datesExternalPins.ts";

// GENUINE: byte copies of Core's own corpus of the two pin routes (tests/fixtures/dates_external_pins_wire/provenance.txt).
// Every use below goes through the bridge's projection first, as the browser receives them.
const FIXTURES = new URL("./fixtures/dates_external_pins_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, FIXTURES));
const raw = (file: string) => JSON.parse(bytes(file).toString("utf8"));
const routeOf = (name: string) => name.startsWith("webadmin-pins-save") ? "dates_external_pins_save" : "dates_external_pins";
const wire = (name: string) => projectDatesAdminBody(routeOf(name), raw(`${name}.json`));
const catalogOf = (name: string): DatesExternalPinCatalog => { const catalog = externalPinCatalog(wire(name)); assert.ok(catalog, name); return catalog; };
/** The parameters Core's generator posted for the genuine receipt: a form this console never sends (see provenance.txt). */
const GENERATOR_FORM = raw("webadmin-pins-save.request") as { pins: string; default_marker_background_color: string; expected_revision: number; reason: string; idempotency_key: string };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));

/** The types and the fine categories each covers, as the specification lists them (team/handoffs/areyouin-submission-system.md, section 1). */
const SPECIFIED: Record<string, string[]> = {
  sport: ["sport_match", "sport_participation"], music: ["concert"], party: ["club_night"], festival: ["festival"], arts: ["theatre", "cinema", "exhibition"],
  learning: ["talk", "workshop"], market: ["market"], food: ["food_drink"], community: ["community"], outdoor: ["outdoor"], other: ["other"],
};

test("the corpus is Core's, byte for byte: every body has the sha256 its manifest names", () => {
  const manifest = raw("manifest.json") as { contract: string; source_commit: string; fixture_set_sha256: string; fixtures: { file: string; sha256: string; consumer: string }[] };
  assert.equal(manifest.contract, "dates-external-pins-v1");
  // The pin (docs/WIRE_CORPUS_PINNING.md): a body or a manifest changed here does not pass as Core's.
  assert.equal(manifest.source_commit, "a356553affc4a2afddad46e5b38345d9d2f34df7");
  assert.equal(manifest.fixture_set_sha256, "396410cdfafe787e6b54bc4cc1853ff9a69706e166412e908bed6a7097031bbd");
  const lines = manifest.fixtures.map(({ file, sha256 }) => {
    assert.equal(createHash("sha256").update(bytes(file)).digest("hex"), sha256, file);
    return `${file}\0${sha256}`;
  });
  assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), manifest.fixture_set_sha256);
  // Beside Core's files only the note on where they come from and the reconstructed request.
  assert.deepEqual(readdirSync(FIXTURES).sort(), [...manifest.fixtures.map(item => item.file), "manifest.json", "provenance.txt", "webadmin-pins-save.request"].sort());
  assert.equal(manifest.fixtures.filter(item => item.consumer === "webadmin").length, 9);
});

test("genuine reads decode: the code defaults, then the saved catalogue in Core's order", () => {
  const defaults = catalogOf("webadmin-pins-read-default");
  assert.equal(defaults.revision, 0);
  assert.equal(defaults.default_marker_background_color, DEFAULT_EXTERNAL_PIN_COLOR);
  assert.deepEqual(defaults.pins.map(pin => pin.key), [...EXTERNAL_PIN_KEYS]);
  assert.ok(defaults.pins.every(pin => pin.marker_background_color === null && pin.image_url === null));
  assert.deepEqual(Object.fromEntries(defaults.pins.map(pin => [pin.key, pin.categories])), SPECIFIED);
  assert.deepEqual(defaults.pins.flatMap(pin => pin.categories).sort(), [...DATES_EXTERNAL_CATEGORIES].sort(), "every fine category has its type");
  assert.deepEqual(defaults.pins.map(pin => [pin.emoji, pin.name_hu, pin.name_en, pin.order]).slice(0, 3),
    [["⚽", "Sport", "Sports", 10], ["🎵", "Zene, koncert", "Music", 20], ["🪩", "Buli, éjszakai élet", "Nightlife", 30]]);

  const saved = catalogOf("webadmin-pins-read-saved");
  assert.equal(saved.revision, 1);
  assert.equal(saved.default_marker_background_color, "#5B4BC4");
  assert.equal(saved.pins[0].key, "music", "rows come ordered by `order`, then key");
  const byKey = Object.fromEntries(saved.pins.map(pin => [pin.key, pin]));
  assert.deepEqual([byKey.party.marker_background_color, byKey.arts.emoji, byKey.arts.image_url, byKey.other.name_hu, byKey.music.order],
    ["#FF2D95", "", "https://img.friending.co/dates/pins/arts.png", "Minden más", 5]);
  // A read is a catalogue, not a receipt.
  assert.equal(externalPinReceipt(wire("webadmin-pins-read-saved"), { pins: serializeExternalPins(saved.pins), default_marker_background_color: "#5B4BC4", expected_revision: 0 }), null);
});

test("the catalogue is closed and fail closed: exactly the eleven types, typed fields, known categories", () => {
  const body = wire("webadmin-pins-read-saved") as { pins: Record<string, unknown>[] } & Record<string, unknown>;
  assert.ok(externalPinCatalog(body));
  for (const patch of [{ success: false }, { status_code: 503 }, { revision: -1 }, { revision: "1" }, { default_marker_background_color: null },
    { default_marker_background_color: "#5b4bc4" }, { default_marker_background_color: "violet" }, { pins: [] }, { pins: body.pins.slice(1) },
    { pins: [...body.pins, body.pins[0]] }, { pins: [body.pins[0], ...body.pins.slice(0, -1)] }, { pins: Object.fromEntries(body.pins.entries()) }]) {
    assert.equal(externalPinCatalog({ ...body, ...patch }), null, JSON.stringify(patch).slice(0, 80));
  }
  const row = (patch: Record<string, unknown>, at = 1) => ({ ...body, pins: body.pins.map((pin, index) => index === at ? { ...pin, ...patch } : pin) });
  for (const patch of [{ key: "cinema" }, { key: "Sport" }, { emoji: "ab" }, { emoji: "⚽⚽" }, { emoji: "", image_url: null }, { image_url: "https://evil.test/a.png" },
    { image_url: "https://img.friending.co/a.svg" }, { marker_background_color: "#ff2d95" }, { marker_background_color: "" }, { name_en: "" }, { name_hu: "Spo\nrt" },
    { name_en: "x".repeat(61) }, { order: 1.5 }, { order: -1 }, { order: "10" }, { order: 100001 }, { categories: [] }, { categories: "sport_match" },
    { categories: ["sport_match", "sport_match"] }, { categories: ["surprise"] }, { categories: undefined }]) {
    assert.equal(externalPinCatalog(row(patch)), null, JSON.stringify(patch));
  }
  // A category under two types is no catalogue either: each fine category belongs to exactly one type.
  const taken = body.pins.find(pin => pin.key !== body.pins[1].key)!.categories as string[];
  assert.equal(externalPinCatalog(row({ categories: [taken[0]] })), null);
  // What Core may change without the console being wrong: which known category sits under which type.
  const moved = copy(body);
  const arts = moved.pins.find(pin => pin.key === "arts")!, learning = moved.pins.find(pin => pin.key === "learning")!;
  arts.categories = ["theatre", "exhibition"]; learning.categories = ["talk", "workshop", "cinema"];
  assert.deepEqual(externalPinCatalog(moved)?.pins.find(pin => pin.key === "learning")?.categories, ["talk", "workshop", "cinema"]);
  // A stored name is read whatever its edges; the editor trims what it sends.
  const edged = externalPinCatalog(row({ name_hu: " Sport " }, body.pins.findIndex(pin => pin.key === "sport")));
  assert.ok(edged);
  assert.equal((JSON.parse(serializeExternalPins(edged.pins)) as DatesExternalPinFields[]).find(pin => pin.key === "sport")!.name_hu, "Sport");
});

// ---------------------------------------------------------------- the editor's state (the reducer the component runs)

const reduce = (state: ExternalPinEditorState, ...actions: ExternalPinEditorAction[]) => actions.reduce(externalPinEditorReducer, state);
const loaded = (name = "webadmin-pins-read-default") => reduce(EXTERNAL_PIN_EDITOR_INITIAL, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf(name), force: false });
/** The edits of the genuine save, made the way the operator makes them in this editor. */
const GENUINE_EDITS: ExternalPinEditorAction[] = [
  { type: "edited", key: "party", patch: { marker_background_color: "#FF2D95" } },
  { type: "edited", key: "arts", patch: { emoji: "", image_url: "https://img.friending.co/dates/pins/arts.png" } },
  { type: "edited", key: "other", patch: { name_hu: " Minden más " } },
  { type: "edited", key: "music", patch: { order: 5 } },
  { type: "defaultColor", value: "#5B4BC4" },
  { type: "reason", value: `  ${GENERATOR_FORM.reason} ` },
];
const mint = () => GENERATOR_FORM.idempotency_key;
const noMint = () => { throw new Error("a retained command must not get a new request key"); };
const genuineCommand = () => { const command = externalPinSaveCommand(reduce(loaded(), ...GENUINE_EDITS), true, mint); assert.ok(command); return command; };

test("genuine save receipt and its replay settle the request this editor sends; Core's refusals are named", () => {
  const command = genuineCommand();
  // The same catalogue as Core's generator posted, in this console's form: the editable fields only, colours in upper
  // case, names trimmed.
  const posted = JSON.parse(GENERATOR_FORM.pins) as (DatesExternalPinFields & { categories?: string[] })[];
  assert.deepEqual(JSON.parse(command.pins), posted.map(({ categories: _categories, ...pin }) => ({ ...pin,
    marker_background_color: pin.marker_background_color?.toUpperCase() ?? null, name_en: pin.name_en.trim(), name_hu: pin.name_hu.trim() })));
  assert.deepEqual({ ...command, pins: "" }, { pins: "", default_marker_background_color: "#5B4BC4", expected_revision: 0, reason: GENERATOR_FORM.reason, idempotency_key: GENERATOR_FORM.idempotency_key });
  assert.equal(normalizeDatesExternalPinsProxyBody("dates_external_pins_save", { ...command }) !== null, true, "the bridge forwards exactly this shape");

  for (const [name, replayed] of [["webadmin-pins-save", false], ["webadmin-pins-save-replay", true]] as const) {
    const body = wire(name) as { idempotency_replayed: boolean };
    assert.equal(body.idempotency_replayed, replayed);
    const receipt = externalPinReceipt(body, command);
    assert.ok(receipt, name);
    assert.equal(receipt.revision, 1);
    assert.equal(externalPinSaveOutcome(body, command, replayed).outcome.kind, "success");
    // The same body is no receipt for another revision, another default colour or another catalogue.
    assert.equal(externalPinReceipt(body, { ...command, expected_revision: 1 }), null);
    assert.equal(externalPinReceipt(body, { ...command, default_marker_background_color: DEFAULT_EXTERNAL_PIN_COLOR }), null);
    const other = JSON.parse(command.pins); other[2].marker_background_color = null;
    assert.equal(externalPinReceipt(body, { ...command, pins: JSON.stringify(other) }), null);
    assert.equal(externalPinReceipt({ ...body, audit_id: undefined }, command), null, "success without an audit id is not a receipt");
  }
  // Refusals Core raises without writing settle a first attempt and a retry alike.
  for (const [name, error] of [["webadmin-pins-save-stale", "dates-admin-stale-revision"], ["webadmin-pins-save-type-missing", "dates-external-pins-invalid"],
    ["webadmin-pins-save-default-color-null", "dates-external-pin-color-invalid"], ["webadmin-pins-save-no-image", "dates-external-pin-image-required"]] as const) {
    for (const retrying of [false, true]) assert.deepEqual(externalPinSaveOutcome(wire(name), command, retrying).outcome, { kind: "refused", error }, `${name} ${retrying}`);
  }
  // The capability check precedes Core's receipt lookup: it answers a first attempt, and says nothing about an earlier one.
  assert.deepEqual(externalPinSaveOutcome(wire("webadmin-pins-save-viewer"), command, false).outcome, { kind: "refused", error: "dates-admin-capability-required" });
  assert.deepEqual(externalPinSaveOutcome(wire("webadmin-pins-save-viewer"), command, true).outcome, { kind: "uncertain", error: "dates-admin-capability-required" });
});

test("genuine: the generator's own form is refused by this bridge, and Core's answer to it is no receipt of that literal form", () => {
  const literal = { pins: GENERATOR_FORM.pins, default_marker_background_color: GENERATOR_FORM.default_marker_background_color, expected_revision: GENERATOR_FORM.expected_revision };
  const posted = JSON.parse(GENERATOR_FORM.pins) as (DatesExternalPinFields & { categories?: string[] })[];
  assert.deepEqual([literal.default_marker_background_color, posted.find(pin => pin.key === "party")!.marker_background_color, posted.find(pin => pin.key === "other")!.name_hu,
    posted.find(pin => pin.key === "sport")!.categories], ["#5b4bc4", "#ff2d95", " Minden más ", ["sport_match", "sport_participation"]]);
  assert.equal(normalizeDatesExternalPinsProxyBody("dates_external_pins_save", { ...GENERATOR_FORM }), null, "this console's bridge answers 400 and forwards nothing");
  // Core accepted it and stored it normalised, so what came back is not what was sent: never "saved", and never "not
  // saved", which would be false. Unknown, until the stored catalogue is read.
  for (const name of ["webadmin-pins-save", "webadmin-pins-save-replay"]) {
    assert.ok(externalPinCatalog(wire(name)));
    for (const retrying of [false, true]) assert.deepEqual(externalPinSaveOutcome(wire(name), literal, retrying), { receipt: null, outcome: { kind: "uncertain", error: null } });
  }
});

test("lost response: the reducer keeps the one command until Core's replay settles it", () => {
  let state = loaded();
  assert.equal(externalPinHold(state), false);
  state = reduce(state, ...GENUINE_EDITS);
  assert.equal(externalPinDirty(state), true);
  assert.deepEqual(externalPinProblems(state.pins), []);
  const command = externalPinSaveCommand(state, true, mint);
  assert.ok(command);

  const sent: ExternalPinCommand[] = [];
  const attempt = (response: unknown) => {
    const next = externalPinSaveCommand(state, true, noMint);
    assert.ok(next);
    sent.push(next);
    state = reduce(state, { type: "saveStarted", command: next }, { type: "saveAnswered", response });
  };
  // 1. No answer at all (the write may have landed).
  sent.push(command);
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: null });
  assert.deepEqual(state.outcome, { kind: "unknown" });
  assert.equal(state.pending, command);
  assert.equal(state.busy, false);
  // 2. Meanwhile nothing may replace the retained command or the edits: not a catalogue read that was not asked for,
  //    not an edit of a type or of the default colour, not a new reason.
  const before = state;
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf("webadmin-pins-read-default"), force: false });
  assert.equal(state.pending, command);
  assert.equal(state.pins, before.pins);
  assert.equal(reduce(state, { type: "edited", key: "sport", patch: { name_en: "Other" } }, { type: "defaultColor", value: "#000000" }, { type: "reason", value: "x" }), state);
  // 3. A retry that the bridge refuses proves nothing about the first attempt; neither does a timeout.
  attempt({ success: false, status_code: 403, error: "dates-admin-capability-required" });
  assert.deepEqual(state.outcome, { kind: "unknown" });
  assert.equal(state.pending, command);
  attempt({ success: false, status_code: 504, error: "core-timeout" });
  assert.equal(state.pending, command);
  // 4. Core's genuine replay of the committed command settles it.
  attempt(wire("webadmin-pins-save-replay"));
  assert.deepEqual(state.outcome, { kind: "saved" });
  assert.equal(state.pending, null);
  assert.equal(state.revision, 1);
  assert.equal(state.reason, "");
  assert.equal(state.defaultColor, "#5B4BC4");
  assert.equal(state.pins[0].key, "music", "the stored order is adopted");
  assert.equal(state.pins.find(pin => pin.key === "other")!.name_hu, "Minden más");
  assert.equal(externalPinHold(state), false);
  assert.equal(sent.length, 4);
  assert.ok(sent.every(item => item === command), "one logical write: every attempt was the same command object");
  assert.equal(externalPinSaveCommand(state, true, mint), null, "nothing left to save");
});

test("the uncertain state has an explicit exit: a forced read of the stored catalogue", () => {
  let state = reduce(loaded(), ...GENUINE_EDITS);
  const command = externalPinSaveCommand(state, true, mint)!;
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: { success: false, status_code: 502, error: "admin-request-outcome-unknown" } });
  assert.equal(state.pending, command);
  // A forced read that fails releases nothing.
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: null, force: true });
  assert.equal(state.pending, command);
  assert.equal(state.loadFailed, true);
  assert.equal(externalPinDirty(state), true);
  // A forced read that answers shows what is stored and drops the command and the edits.
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf("webadmin-pins-read-saved"), force: true });
  assert.equal(state.pending, null);
  assert.equal(state.loadFailed, false);
  assert.equal(state.outcome, null);
  assert.equal(state.revision, 1);
  assert.equal(externalPinHold(state), false);
  assert.equal(state.reason, "");
});

test("a proven refusal releases the command and keeps the edits; an unforced read never replaces them", () => {
  let state = reduce(loaded(), ...GENUINE_EDITS);
  const command = externalPinSaveCommand(state, true, mint)!;
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: wire("webadmin-pins-save-stale") });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-admin-stale-revision" });
  assert.equal(state.pending, null);
  assert.equal(externalPinDirty(state), true);
  assert.equal(state.reason, `  ${GENERATOR_FORM.reason} `);
  const edits = state.pins;
  state = reduce(state, { type: "loaded", catalog: catalogOf("webadmin-pins-read-saved"), force: false });
  assert.equal(state.pins, edits, "dirty edits survive a read nobody asked for");
  assert.equal(state.revision, 0);
  assert.equal(state.defaultColor, "#5B4BC4");
  // A first load that fails is not an empty catalogue: there is no revision, nothing to save.
  const failed = reduce(EXTERNAL_PIN_EDITOR_INITIAL, { type: "requestStarted" }, { type: "loaded", catalog: null, force: false });
  assert.equal(failed.revision, null);
  assert.equal(failed.loadFailed, true);
  assert.equal(externalPinSaveCommand(failed, true, mint), null);
  assert.equal(reduce(failed, { type: "defaultColor", value: "#000000" }), failed, "nothing to edit before a catalogue is read");
});

test("nothing is sent while a field Core would refuse is invalid, and the reason is required", () => {
  let state = loaded();
  assert.equal(externalPinSaveBlock(state, true), "clean");
  assert.equal(externalPinSaveBlock(state, true, true), "problems", "a half-typed value is named before 'nothing changed'");
  assert.equal(externalPinSaveBlock(state, false), "readOnly");
  const problemsOf = (patch: Partial<DatesExternalPinFields>) => externalPinProblems([{ ...state.pins[0], ...patch }]).map(problem => `${problem.key}.${problem.field}.${problem.code}`);
  assert.deepEqual(problemsOf({ name_en: "   " }), ["sport.name_en.required"]);
  assert.deepEqual(problemsOf({ name_hu: "é".repeat(61) }), ["sport.name_hu.tooLong"]);
  assert.deepEqual(problemsOf({ name_hu: "é".repeat(60) }), []);
  assert.deepEqual(problemsOf({ emoji: "" }), ["sport.emoji.required"]);
  assert.deepEqual(problemsOf({ emoji: "", image_url: "https://img.friending.co/dates/pins/sport.png" }), []);
  assert.deepEqual(problemsOf({ emoji: "ab" }), ["sport.emoji.invalid"]);
  for (const order of [1.5, -1, 100001, Number.NaN]) assert.deepEqual(problemsOf({ order }), ["sport.order.invalid"], String(order));
  assert.deepEqual(problemsOf({ marker_background_color: "#8a7" }), ["sport.marker_background_color.invalid"]);
  // An invalid field blocks the whole catalogue, whichever type is open.
  state = reduce(state, { type: "edited", key: "food", patch: { name_hu: "" } }, { type: "reason", value: "Rename" });
  assert.equal(externalPinSaveBlock(state, true), "problems");
  assert.equal(externalPinSaveCommand(state, true, mint), null);
  // Valid edits, no reason yet.
  state = reduce(state, { type: "edited", key: "food", patch: { name_hu: "Gasztro és italok" } }, { type: "reason", value: " a " });
  assert.equal(externalPinSaveBlock(state, true), "reason");
  assert.equal(externalPinSaveBlock(state, true, true), "problems", "a half-typed HEX value blocks the save");
  state = reduce(state, { type: "reason", value: "abc" });
  assert.equal(externalPinSaveBlock(state, true), null);
  assert.equal(externalPinSaveCommand(state, false, mint), null);
  assert.equal(externalPinSaveCommand({ ...state, busy: true }, true, mint), null);
  // The default colour alone is a change of the catalogue.
  state = reduce(loaded(), { type: "defaultColor", value: "#112233" }, { type: "reason", value: "New default" });
  assert.equal(externalPinDirty(state), true);
  assert.equal(externalPinSaveCommand(state, true, mint)?.default_marker_background_color, "#112233");
  assert.equal(externalPinDirty(reduce(state, { type: "defaultColor", value: DEFAULT_EXTERNAL_PIN_COLOR })), false, "back to what is stored is no change");
});

test("editing rules: the list is fixed, the default colour is never absent, a pin's own colour may be", () => {
  let state = loaded("webadmin-pins-read-saved");
  const byKey = (key: string) => state.pins.find(pin => pin.key === key)!;
  // Neither a type's key nor the categories it covers can be edited, whatever a patch carries.
  state = reduce(state, { type: "edited", key: "party", patch: { key: "sport", categories: ["concert"], name_en: "Clubbing" } as never });
  assert.deepEqual([byKey("party").key, byKey("party").categories, byKey("party").name_en], ["party", ["club_night"], "Clubbing"]);
  assert.equal(state.pins.length, 11);
  assert.equal(reduce(state, { type: "edited", key: "cinema", patch: { name_en: "x" } }), state, "there is no such type");
  assert.equal(reduce(state, { type: "selected", key: "cinema" }), state);
  assert.equal(reduce(state, { type: "selected", key: "food" }).selected, "food");
  // Only a whole colour replaces the default.
  for (const value of ["", "#5b4bc4", "#FFF", "violet"]) assert.equal(reduce(state, { type: "defaultColor", value }), state, value);
  // Back to the default colour is `null` on the pin, never a stored copy of the default.
  state = reduce(state, { type: "edited", key: "party", patch: { marker_background_color: null } });
  const sent = JSON.parse(serializeExternalPins(state.pins)) as Record<string, unknown>[];
  assert.equal(sent.find(pin => pin.key === "party")!.marker_background_color, null);
  // What is sent is the seven editable fields of each type, and nothing of what the read added.
  assert.ok(sent.every(pin => Object.keys(pin).join() === "key,emoji,image_url,marker_background_color,name_en,name_hu,order"));
  // A saved notice ends with the next edit; a refusal stays until the next save.
  const saved = reduce({ ...state, outcome: { kind: "saved" } }, { type: "edited", key: "food", patch: { order: 7 } });
  assert.equal(saved.outcome, null);
  const refused = reduce({ ...state, outcome: { kind: "refused", error: "dates-admin-stale-revision" } }, { type: "defaultColor", value: "#000000" });
  assert.deepEqual(refused.outcome, { kind: "refused", error: "dates-admin-stale-revision" });
});

// ---------------------------------------------------------------- the bridge

test("the bridge forwards only the closed shape of the two pin routes, and adds no selector of its own", () => {
  const good = { ...genuineCommand() };
  assert.equal(normalizeDatesExternalPinsProxyBody("dates_external_pins_save", good), good);
  assert.deepEqual(normalizeDatesExternalPinsProxyBody("dates_external_pins", {}), {});
  assert.equal(normalizeDatesExternalPinsProxyBody("dates_external_pins", { page: 1 }), null);
  assert.equal(normalizeDatesExternalPinsProxyBody("dates_event_icons_save", { anything: 1 }), undefined, "other routes are not this function's");
  const rows = (change: (rows: Record<string, unknown>[]) => void) => { const next = JSON.parse(good.pins); change(next); return JSON.stringify(next); };
  for (const [label, body] of Object.entries({
    "an extra key": { ...good, dates_event_icon_contract_version: 2 },
    "a missing key": { pins: good.pins, expected_revision: 0, reason: good.reason, idempotency_key: good.idempotency_key },
    "no default colour": { ...good, default_marker_background_color: null },
    "a lowercase default colour": { ...good, default_marker_background_color: "#5b4bc4" },
    "a revision as text": { ...good, expected_revision: "0" },
    "a negative revision": { ...good, expected_revision: -1 },
    "no reason": { ...good, reason: "" },
    "an untrimmed reason": { ...good, reason: " colours " },
    "a short key": { ...good, idempotency_key: "short" },
    "pins as a list": { ...good, pins: JSON.parse(good.pins) },
    "pins that are not JSON": { ...good, pins: "[" },
    "an empty catalogue": { ...good, pins: "[]" },
    "ten types": { ...good, pins: rows(next => { next.pop(); }) },
    "a type twice": { ...good, pins: rows(next => { next[1].key = next[0].key; }) },
    "a twelfth type": { ...good, pins: rows(next => { next.push({ ...next[0], key: "cinema" }); }) },
    "an unknown type instead of a known one": { ...good, pins: rows(next => { next[0].key = "cinema"; }) },
    "a row that carries its categories": { ...good, pins: rows(next => { next[0].categories = ["concert"]; }) },
    "a row without its colour key": { ...good, pins: rows(next => { delete next[0].marker_background_color; }) },
    "a lowercase colour": { ...good, pins: rows(next => { next[2].marker_background_color = "#ff2d95"; }) },
    "an untrimmed name": { ...good, pins: rows(next => { next[0].name_en = "Music "; }) },
    "a foreign image": { ...good, pins: rows(next => { next[0].image_url = "https://evil.test/a.png"; }) },
    "neither emoji nor image": { ...good, pins: rows(next => { next[0].emoji = ""; }) },
    "a fractional order": { ...good, pins: rows(next => { next[0].order = 1.5; }) },
  })) assert.equal(normalizeDatesExternalPinsProxyBody("dates_external_pins_save", body as Record<string, unknown>), null, label);
  // Core asks for no contract selector on these routes; the bridge's own Dates selector is all it adds.
  for (const action of ["dates_external_pins", "dates_external_pins_save"]) {
    assert.deepEqual(Object.keys(withDatesAdminContract(action, {})), ["dates_event_intake_admin_contract_version"]);
  }
});

test("what the browser receives is the named fields of a pin body, and nothing Core might add", () => {
  for (const name of ["webadmin-pins-read-default", "webadmin-pins-read-saved", "webadmin-pins-save", "webadmin-pins-save-replay"]) {
    const body = raw(`${name}.json`), wider = copy(body);
    wider.updated_by = "operator@example.test"; wider.pins[0].stored_internal = { any: "thing" };
    assert.deepEqual(projectDatesAdminBody(routeOf(name), wider), body, name);
  }
});

// ---------------------------------------------------------------- what is drawn

test("a third-party pin has its own outline and takes the catalogue's colour by day and at night", () => {
  const art = { emoji: "🎵", image_url: null, marker_background_color: null };
  const markup = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(EventIconPin, { icon: art, ...props }));
  const path = (html: string) => /<path d="([^"]+)"/.exec(html)![1];
  const member = markup({}), external = markup({ shape: "external", defaultColor: "#6D5BD0" });
  assert.match(member, /class="dates-event-icon-pin"/);
  assert.match(external, /class="dates-event-icon-pin external"/);
  assert.notEqual(path(external), path(member));
  // The same box and the same tip: only the head differs.
  for (const html of [member, external]) { assert.match(html, /viewBox="0 0 48 60"/); assert.match(path(html), /24 57\.5/); }
  for (const dark of [false, true]) assert.match(markup({ shape: "external", defaultColor: "#6D5BD0", dark }), /--event-pin-color:#6D5BD0;--event-pin-stroke:#FFFFFF;--event-pin-ring:#6D5BD0/);
  // A colour of its own wins over the catalogue's; a member pin keeps the orange of its mode.
  assert.match(renderToStaticMarkup(createElement(EventIconPin, { icon: { ...art, marker_background_color: "#FF2D95" }, shape: "external", defaultColor: "#6D5BD0" })), /--event-pin-color:#FF2D95/);
  assert.match(markup({ dark: true }), /--event-pin-color:#FFA45F/);
  assert.match(markup({ shape: "external", defaultColor: "not a colour" }), /--event-pin-color:#F68B3F/, "a default that is no colour is not painted");
  assert.match(markup({ shape: "external", defaultColor: "#6D5BD0", selected: true, size: "small" }), /class="dates-event-icon-pin external small selected"/);
});

function render(locale: string, state: ExternalPinEditorState, canManage = true) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesExternalPinsConfiguration, { canManage, initialState: state })));
  assert.deepEqual(errors, [], `${locale}: every message exists`);
  return html;
}
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

test("the editor renders the genuine catalogue whole in English and Hungarian", () => {
  for (const locale of ["en", "hu"] as const) {
    const copyOf = messagesOf(locale).datesAdmin, state = reduce(loaded("webadmin-pins-read-saved"), { type: "selected", key: "arts" });
    const html = render(locale, state);
    assert.ok(html.includes(escaped(copyOf.externalPins.title)));
    // Eleven tiles in Core's order, each with its name in the page's language and its fine categories in words.
    assert.equal((html.match(/class="dates-event-icon-choice/g) ?? []).length, 11);
    for (const pin of state.pins) {
      assert.ok(html.includes(`<strong>${escaped(locale === "hu" ? pin.name_hu : pin.name_en)}</strong>`), `${locale}: ${pin.key}`);
      for (const category of pin.categories) assert.ok(html.includes(`<span>${escaped(copyOf.external.form.categories[category])}</span>`), `${locale}: ${category}`);
    }
    assert.ok(html.indexOf(`value="music"`) < html.indexOf(`value="sport"`), "the stored order");
    // No machine token of a category leaks as text.
    assert.doesNotMatch(html.replace(/value="[^"]*"/g, ""), />(sport_match|club_night|food_drink)</);
    // The open type: its categories, its image, both names; the list has no add, no remove, no switch, no type filter.
    for (const category of ["theatre", "cinema", "exhibition"]) assert.ok(html.includes(`<li>${escaped(copyOf.external.form.categories[category])}</li>`));
    assert.ok(html.includes('src="https://img.friending.co/dates/pins/arts.png"'));
    assert.ok(html.includes(`value="${escaped(state.pins.find(pin => pin.key === "arts")!.name_hu)}"`));
    assert.doesNotMatch(html, /type="checkbox"|<select/);
    for (const absent of [copyOf.eventIcons.add, copyOf.eventIcons.enabled, copyOf.eventIcons.default, copyOf.eventIcons.filterAll]) assert.equal(html.includes(`>${escaped(absent)}<`), false, absent);
    // The catalogue's colour, in its own field and on every pin without a colour of its own; the one custom colour on its pin.
    assert.ok(html.includes(`value="#5B4BC4"`));
    assert.equal((html.match(/class="dates-event-icon-pin external large"[^>]*--event-pin-color:#5B4BC4/g) ?? []).length, 10);
    assert.equal((html.match(/class="dates-event-icon-pin external large"[^>]*--event-pin-color:#FF2D95/g) ?? []).length, 1);
    // Day and night previews in the external shape, and one member pin beside it.
    assert.equal((html.match(/class="dates-event-pin-preview (day|night)"/g) ?? []).length, 2);
    assert.equal((html.match(/class="dates-event-icon-pin small"/g) ?? []).length, 1, "one member pin, in the comparison");
    assert.ok(html.includes(escaped(copyOf.externalPins.compareMember)) && html.includes(escaped(copyOf.externalPins.compareExternal)));
    // Nothing changed yet: the save is blocked and says why.
    assert.ok(html.includes(escaped(copyOf.eventIcons.blockClean)));
  }
});

test("the editor says what blocks a save, and offers the two exits of a save in doubt", () => {
  for (const locale of ["en", "hu"] as const) {
    const copyOf = messagesOf(locale).datesAdmin;
    assert.ok(render(locale, loaded(), false).includes(escaped(copyOf.externalPins.blockReadOnly)));
    assert.ok(render(locale, EXTERNAL_PIN_EDITOR_INITIAL).includes(escaped(copyOf.externalPins.loading)));
    assert.ok(render(locale, reduce(EXTERNAL_PIN_EDITOR_INITIAL, { type: "loaded", catalog: null, force: false })).includes(escaped(copyOf.externalPins.loadError)));
    // A problem in a type that is not open is listed by the type's name.
    const broken = render(locale, reduce(loaded(), { type: "edited", key: "food", patch: { emoji: "" } }, { type: "reason", value: "Icons" }));
    assert.ok(broken.includes(escaped(copyOf.externalPins.problemsElsewhere)) && broken.includes(escaped(copyOf.eventIcons.problems.emoji.required)));
    const command = genuineCommand();
    const doubt = render(locale, reduce(reduce(loaded(), ...GENUINE_EDITS), { type: "saveStarted", command }, { type: "saveAnswered", response: null }));
    for (const text of [copyOf.eventIcons.unknown, copyOf.eventIcons.retry, copyOf.eventIcons.reloadFromServer]) assert.ok(doubt.includes(escaped(text)), text);
    assert.match(doubt, /<fieldset class="dates-event-icon-fields" disabled="">/, "the fields are locked while the outcome is in doubt");
    const stale = render(locale, reduce(reduce(loaded(), ...GENUINE_EDITS), { type: "saveStarted", command }, { type: "saveAnswered", response: wire("webadmin-pins-save-stale") }));
    assert.ok(stale.includes(escaped(copyOf.eventIcons.refusedStale)));
    const saved = render(locale, reduce(reduce(loaded(), ...GENUINE_EDITS), { type: "saveStarted", command }, { type: "saveAnswered", response: wire("webadmin-pins-save") }));
    assert.ok(saved.includes(escaped(copyOf.externalPins.saved)));
  }
});

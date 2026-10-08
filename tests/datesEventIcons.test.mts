import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_EVENT_PIN_COLOR, eventIconCatalog, eventIconImageURL, eventIconReceipt, eventIconSaveOutcome, eventPinColorFromInput, eventPinLuminance,
  eventPinOutline, normalizeDatesEventIconsProxyBody, normalizeEventIconName, validEventPinColor, type DatesEventIcon, type DatesEventIconCatalog,
} from "../lib/datesEventIcons.ts";
import {
  EVENT_ICON_EDITOR_INITIAL, eventIconDirty, eventIconEditorReducer, eventIconHold, eventIconProblems, eventIconSaveBlock, eventIconSaveCommand,
  serializeEventIcons, type EventIconCommand, type EventIconEditorAction, type EventIconEditorState,
} from "../lib/datesEventIconEditor.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { EventIconPin } from "../components/DatesEventIconsConfiguration.tsx";

// GENUINE: the bodies Core 81b7161b answered on the two icon routes (tests/fixtures/dates_event_icons_wire/provenance.txt).
// Every use below goes through the bridge's projection first, as the browser receives them.
const FIXTURES = new URL("./fixtures/dates_event_icons_wire/", import.meta.url);
const raw = (file: string) => JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"));
const wire = (name: string) => projectDatesAdminBody(name.split("-")[0], raw(`${name}.json`));
const GENUINE_FORM = raw("dates_event_icons_save.request") as { icons: string; expected_revision: string; reason: string; idempotency_key: string };
const GENUINE_REQUEST = { icons: GENUINE_FORM.icons, expected_revision: Number(GENUINE_FORM.expected_revision) };
const catalogOf = (name: string): DatesEventIconCatalog => { const catalog = eventIconCatalog(wire(name)); assert.ok(catalog, name); return catalog; };

const icon: DatesEventIcon = { key: "yoga", activity_type: "sport", emoji: "🧘", image_url: null, marker_background_color: null, name_en: "Yoga", name_hu: "Jóga", enabled: true, is_default: true, order: 10 };
const catalog = { success: true, status_code: 200, event_icon_contract_version: 2, icons: [icon], revision: 1 };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test("genuine contract-v2 reads decode; the contract-v1 read of the same Core is refused", () => {
  const bootstrap = catalogOf("dates_event_icons-bootstrap");
  assert.equal(bootstrap.revision, 0);
  assert.equal(bootstrap.icons.length, 17);
  assert.ok(bootstrap.icons.every(row => row.marker_background_color === null));
  const stored = catalogOf("dates_event_icons");
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.icons.filter(row => row.marker_background_color !== null).map(row => [row.key, row.marker_background_color]),
    [["yoga", "#8A72D8"], ["cycling", "#2B9D8F"], ["music", "#E47768"], ["icon_1a2b3c4d", "#E6B640"]]);
  const older = wire("dates_event_icons-contract-v1") as { success: boolean; event_icon_contract_version: number; icons: object[] };
  assert.equal(older.success, true);
  assert.equal(older.event_icon_contract_version, 1);
  assert.equal(Object.hasOwn(older.icons[0], "marker_background_color"), false);
  assert.equal(eventIconCatalog(older), null, "an older contract is not an editable catalogue: no colour could be sent back");
});

test("genuine save receipt and its replay settle the genuine request; refusals are named", () => {
  for (const [name, replayed] of [["dates_event_icons_save", false], ["dates_event_icons_save-replay", true]] as const) {
    const body = wire(name) as { idempotency_replayed: boolean };
    assert.equal(body.idempotency_replayed, replayed);
    const receipt = eventIconReceipt(body, GENUINE_REQUEST);
    assert.ok(receipt, name);
    assert.equal(receipt.revision, 1);
    assert.equal(eventIconSaveOutcome(body, GENUINE_REQUEST, replayed).outcome.kind, "success");
    // The same body is no receipt for another revision or another catalogue.
    assert.equal(eventIconReceipt(body, { ...GENUINE_REQUEST, expected_revision: 1 }), null);
    const other = JSON.parse(GENUINE_REQUEST.icons); other[1].marker_background_color = null;
    assert.equal(eventIconReceipt(body, { ...GENUINE_REQUEST, icons: JSON.stringify(other) }), null);
  }
  for (const [name, error] of [["dates_event_icons_save-stale", "dates-admin-stale-revision"], ["dates_event_icons_save-name-invalid", "dates-event-icon-name-invalid"]] as const) {
    for (const retrying of [false, true]) assert.deepEqual(eventIconSaveOutcome(wire(name), GENUINE_REQUEST, retrying).outcome, { kind: "refused", error });
  }
});

test("icon catalogue is versioned, typed, unique and fail closed", () => {
  assert.ok(eventIconCatalog(catalog));
  for (const patch of [{ event_icon_contract_version: 1 }, { event_icon_contract_version: 3 }, { revision: -1 }, { icons: [] }, { icons: [icon, icon] },
    { icons: [{ ...icon, enabled: false }] }, { icons: [{ ...icon, image_url: "https://evil.test/a.png" }] }, { status_code: 503 }, { success: false }]) {
    assert.equal(eventIconCatalog({ ...catalog, ...patch }), null);
  }
  for (const patch of [{ activity_type: ["sport"] }, { emoji: "not an emoji" }, { emoji: "a" }, { emoji: "☕☕" }, { name_en: "x".repeat(10000) },
    { name_en: "" }, { name_hu: "Jó\nga" }, { order: 1.5 }, { order: -1 }, { enabled: 1 }, { key: "Yoga" }]) {
    assert.equal(eventIconCatalog({ ...catalog, icons: [{ ...icon, ...patch }] }), null, JSON.stringify(patch));
  }
});

test("a name Core stored is read whatever its edges; the editor trims what it sends", () => {
  // DERIVED from the genuine read. Core 81b7161b trims names with JavaScript's own set and no longer serves such a
  // name; a Core before it kept these characters (PHP `trim` knows six ASCII ones). The parser's rule does not depend
  // on which Core answers: a name is read as it was served.
  for (const edge of ["\u00A0", "\u3000", "\u202F", "\uFEFF", " "]) {
    const body = copy(wire("dates_event_icons")) as { icons: DatesEventIcon[] };
    body.icons[1].name_en = `Yoga${edge}`; body.icons[2].name_hu = `${edge}Foci`;
    const read = eventIconCatalog(body);
    assert.ok(read, `the catalogue stays readable with U+${edge.codePointAt(0)!.toString(16)} at a name's edge`);
    // The receipt of a save that carried such a name as it was stored is still a receipt.
    const request = { icons: JSON.stringify(body.icons), expected_revision: 0 };
    assert.ok(eventIconReceipt({ ...body, revision: 1, audit_id: `aud_${"a".repeat(32)}`, idempotency_replayed: false }, request));
    // What the editor sends is trimmed, so the next save normalises the stored name.
    const sent = JSON.parse(serializeEventIcons(read.icons)) as DatesEventIcon[];
    assert.equal(sent[1].name_en, "Yoga");
    assert.equal(sent[2].name_hu, "Foci");
    assert.equal(normalizeEventIconName(`${edge}Yoga${edge}`), "Yoga");
  }
});

test("genuine: a save sent with untrimmed names is stored trimmed, so Core's answer is no receipt of it; the outcome stays unknown until a forced read", () => {
  // The form an editor that does not trim would have sent: two names with a no-break space at an edge. It is not this
  // console's: its editor trims before it sends and its bridge refuses the form. Core 81b7161b itself accepts it.
  const NBSP = "\xA0";
  const form = raw("dates_event_icons_save-nbsp-names.request") as typeof GENUINE_FORM;
  const request = { icons: form.icons, expected_revision: Number(form.expected_revision) };
  const sent = JSON.parse(form.icons) as DatesEventIcon[];
  const names = (rows: DatesEventIcon[]) => [rows.find(row => row.key === "yoga")!.name_en, rows.find(row => row.key === "football")!.name_hu];
  assert.deepEqual(names(sent), [`Park yoga${NBSP}`, `${NBSP}Kispályás foci${NBSP}`]);
  assert.equal(normalizeDatesEventIconsProxyBody("dates_event_icons_save", { ...form, expected_revision: request.expected_revision }), null,
    "this console's bridge answers 400 and forwards nothing");

  for (const [name, replayed] of [["dates_event_icons_save-nbsp-names", false], ["dates_event_icons_save-nbsp-names-replay", true]] as const) {
    const answer = wire(name) as { success: boolean; revision: number; idempotency_replayed: boolean };
    assert.deepEqual([answer.success, answer.revision, answer.idempotency_replayed], [true, 2, replayed]);
    // Core committed the save: its answer is a readable catalogue, with the names trimmed.
    const stored = eventIconCatalog(answer);
    assert.ok(stored, name);
    assert.deepEqual(names(stored.icons), ["Park yoga", "Kispályás foci"]);
    // It is not a receipt of the request: the catalogue that came back is not the catalogue that was sent.
    assert.equal(eventIconReceipt(answer, request), null);
    // And it is not a refusal either. First attempt or retry, the console says "unknown" - never "saved", and never
    // "not saved", which would be false: the write landed.
    for (const retrying of [false, true]) assert.deepEqual(eventIconSaveOutcome(answer, request, retrying), { receipt: null, outcome: { kind: "uncertain", error: null } });
    // The same answer IS the receipt of the same catalogue sent the way this editor sends it.
    assert.ok(eventIconReceipt(answer, { ...request, icons: serializeEventIcons(sent) }));
  }

  // The state machine with that command in flight (as an older tab would hold it).
  const command: EventIconCommand = { ...request, reason: form.reason, idempotency_key: form.idempotency_key };
  let state: EventIconEditorState = { ...loaded("dates_event_icons"), icons: sent, reason: form.reason };
  assert.equal(state.revision, 1);
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: wire("dates_event_icons_save-nbsp-names") });
  assert.deepEqual(state.outcome, { kind: "unknown" });
  assert.equal(state.pending, command);
  // A retry sends the very same command, Core replays the very same answer: still unknown, for as long as it is retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(eventIconSaveCommand(state, true, noMint), command);
    state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: wire("dates_event_icons_save-nbsp-names-replay") });
    assert.deepEqual(state.outcome, { kind: "unknown" });
    assert.equal(state.pending, command);
    assert.equal(state.revision, 1, "nothing of the unread answer is adopted");
  }
  // The exit: "Reload from server" reads what is stored - the committed, trimmed catalogue - and releases the command.
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf("dates_event_icons-after-nbsp-save"), force: true });
  assert.equal(state.pending, null);
  assert.equal(state.outcome, null);
  assert.equal(state.revision, 2);
  assert.deepEqual(names(state.icons), ["Park yoga", "Kispályás foci"]);
  assert.equal(eventIconHold(state), false);
  assert.equal(eventIconSaveCommand(state, true, mint), null, "nothing is left to send: no second write");
});

test("pin colors are validated and included in the exact save receipt", () => {
  for (const color of [null, "#8A72D8", "#000000", "#FFFFFF"]) {
    assert.equal(validEventPinColor(color), true);
    assert.ok(eventIconCatalog({ ...catalog, icons: [{ ...icon, marker_background_color: color }] }));
  }
  for (const color of [undefined, "", "orange", "#FFF", "#ff00ff", "#FF000080", true, ["#000000"]]) {
    assert.equal(validEventPinColor(color), false);
    assert.equal(eventIconCatalog({ ...catalog, icons: [{ ...icon, marker_background_color: color }] }), null);
  }
  const request = { icons: JSON.stringify([{ ...icon, marker_background_color: "#8A72D8" }]), expected_revision: 0 };
  const receipt = { ...catalog, audit_id: `aud_${"a".repeat(32)}`, idempotency_replayed: false };
  assert.equal(eventIconReceipt(receipt, request), null, "a receipt that dropped the colour is not a receipt");
  assert.ok(eventIconReceipt({ ...receipt, icons: [{ ...icon, marker_background_color: "#8A72D8" }] }, request));
  assert.equal(eventIconReceipt(catalog, { ...request, icons: JSON.stringify([icon]) }), null, "success alone is not enough");
  for (const [typed, color] of [["#8a72d8", "#8A72D8"], ["8A72D8", "#8A72D8"], [" #8A72d8 ", "#8A72D8"], ["#8A7", null], ["", null], ["#8A72D8FF", null], ["orange", null]] as const) {
    assert.equal(eventPinColorFromInput(typed), color, typed);
  }
});

test("a very light pin color gets a darker outline; the others keep the white one", () => {
  for (const color of ["#FFFFFF", "#F4F4F4", "#FFF7B0", "#E6F0FF"]) {
    const outline = eventPinOutline(color);
    assert.equal(outline.light, true, color);
    assert.equal(outline.stroke, outline.ring);
    assert.match(outline.stroke, /^#[0-9A-F]{6}$/);
    assert.ok(eventPinLuminance(outline.stroke) < eventPinLuminance(color) / 2, `${color} -> ${outline.stroke} is clearly darker`);
  }
  for (const color of [DEFAULT_EVENT_PIN_COLOR, "#FFA45F", "#8A72D8", "#2B9D8F", "#E47768", "#E6B640", "#000000"]) {
    assert.deepEqual(eventPinOutline(color), { stroke: "#FFFFFF", ring: color, light: false });
  }
  const markup = (color: string | null, selected = false) => renderToStaticMarkup(createElement(EventIconPin, { icon: { ...icon, marker_background_color: color }, selected }));
  assert.match(markup("#FFFFFF"), /--event-pin-stroke:#8C8C8C;--event-pin-ring:#8C8C8C;--event-pin-plate:#8C8C8C/);
  assert.match(markup(null), /--event-pin-color:#F68B3F;--event-pin-stroke:#FFFFFF;--event-pin-ring:#F68B3F;--event-pin-plate:transparent/);
  assert.match(renderToStaticMarkup(createElement(EventIconPin, { icon, dark: true })), /--event-pin-color:#FFA45F/);
  assert.match(markup("#8A72D8", true), /class="dates-event-icon-pin selected"[^>]*--event-pin-ring:#8A72D8/);
});

test("server owns the color contract selector only for icon routes", () => {
  for (const action of ["dates_event_icons", "dates_event_icons_save"]) {
    assert.equal(withDatesAdminContract(action, { dates_event_icon_contract_version: 1 }).dates_event_icon_contract_version, 2);
  }
  assert.equal(withDatesAdminContract("dates_configuration", {}).dates_event_icon_contract_version, undefined);
});

test("only managed PNG assets can become map pins", () => {
  assert.ok(eventIconImageURL("https://img.friending.co/icons/yoga.png"));
  for (const url of ["https://x@img.friending.co/a.png", "https://img.friending.co/a.svg", "https://img.friending.co/../a.png", "https://img.friending.co/a.png?x=1"]) assert.equal(eventIconImageURL(url), false);
});

// ---------------------------------------------------------------- the editor's state (the reducer the component runs)

const reduce = (state: EventIconEditorState, ...actions: EventIconEditorAction[]) => actions.reduce(eventIconEditorReducer, state);
const loaded = (name = "dates_event_icons-bootstrap") => reduce(EVENT_ICON_EDITOR_INITIAL, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf(name), force: false });
/** The edits of the genuine request, made the way the operator makes them. */
const GENUINE_EDITS: EventIconEditorAction[] = [
  { type: "edited", key: "yoga", patch: { marker_background_color: "#8A72D8" } },
  { type: "edited", key: "cycling", patch: { marker_background_color: "#2B9D8F" } },
  { type: "edited", key: "music", patch: { marker_background_color: "#E47768" } },
  { type: "edited", key: "drinks", patch: { name_en: "Wine & drinks " } },
  { type: "edited", key: "drinks", patch: { enabled: false } },
  { type: "added", key: "icon_1a2b3c4d", activity_type: "hangout" },
  { type: "edited", key: "icon_1a2b3c4d", patch: { name_en: "Karaoke", name_hu: "\u00A0Karaoke", emoji: "🎤", marker_background_color: "#E6B640" } },
  { type: "reason", value: "  Assign pin colours " },
];
const mint = () => GENUINE_FORM.idempotency_key;
const noMint = () => { throw new Error("a retained command must not get a new request key"); };

test("lost response: the reducer keeps the one command until Core's replay settles it", () => {
  let state = loaded();
  assert.equal(eventIconHold(state), false);
  state = reduce(state, ...GENUINE_EDITS);
  assert.equal(eventIconDirty(state), true);
  assert.deepEqual(eventIconProblems(state.icons), []);
  const command = eventIconSaveCommand(state, true, mint);
  assert.ok(command);
  // What the editor builds from those edits is the genuine request: same catalogue, revision, reason and key.
  assert.deepEqual(JSON.parse(command.icons), JSON.parse(GENUINE_FORM.icons));
  assert.deepEqual({ ...command, icons: "" }, { icons: "", expected_revision: 0, reason: "Assign pin colours", idempotency_key: GENUINE_FORM.idempotency_key });
  assert.equal(normalizeDatesEventIconsProxyBody("dates_event_icons_save", { ...command }) !== null, true, "the bridge forwards exactly this shape");

  const sent: EventIconCommand[] = [];
  const attempt = (response: unknown) => {
    const next = eventIconSaveCommand(state, true, noMint);
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
  // 2. Meanwhile nothing may replace the retained command or the edits: not a catalogue read that was not asked
  //    for (a language switch, a router refresh), not an edit, not a new reason.
  const before = state;
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf("dates_event_icons-bootstrap"), force: false });
  assert.equal(state.pending, command);
  assert.equal(state.icons, before.icons);
  assert.equal(reduce(state, { type: "edited", key: "yoga", patch: { name_en: "Other" } }, { type: "added", key: "icon_ffffffff", activity_type: "sport" },
    { type: "removed", key: "icon_1a2b3c4d" }, { type: "reason", value: "x" }), state);
  // 3. A retry that the bridge refuses proves nothing about the first attempt.
  attempt({ success: false, status_code: 403, error: "dates-admin-capability-required" });
  assert.deepEqual(state.outcome, { kind: "unknown" });
  assert.equal(state.pending, command);
  attempt({ success: false, status_code: 504, error: "core-timeout" });
  assert.equal(state.pending, command);
  // 4. Core's genuine replay of the committed command settles it.
  attempt(wire("dates_event_icons_save-replay"));
  assert.deepEqual(state.outcome, { kind: "saved" });
  assert.equal(state.pending, null);
  assert.equal(state.revision, 1);
  assert.equal(state.reason, "");
  assert.equal(eventIconHold(state), false);
  assert.ok(state.knownKeys.includes("icon_1a2b3c4d"));
  assert.equal(sent.length, 4);
  assert.ok(sent.every(item => item === command), "one logical write: every attempt was the same command object");
  assert.equal(eventIconSaveCommand(state, true, mint), null, "nothing left to save");
});

test("the uncertain state has an explicit exit: a forced read of the stored catalogue", () => {
  let state = reduce(loaded(), ...GENUINE_EDITS);
  const command = eventIconSaveCommand(state, true, mint)!;
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: { success: false, status_code: 502, error: "admin-request-outcome-unknown" } });
  assert.equal(state.pending, command);
  // A forced read that fails releases nothing.
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: null, force: true });
  assert.equal(state.pending, command);
  assert.equal(state.loadFailed, true);
  assert.equal(eventIconDirty(state), true);
  // A forced read that answers shows what is stored and drops the command and the edits.
  state = reduce(state, { type: "requestStarted" }, { type: "loaded", catalog: catalogOf("dates_event_icons"), force: true });
  assert.equal(state.pending, null);
  assert.equal(state.loadFailed, false);
  assert.equal(state.outcome, null);
  assert.equal(state.revision, 1);
  assert.equal(eventIconHold(state), false);
  assert.equal(state.reason, "");
});

test("a proven refusal releases the command and keeps the edits; an unforced read never replaces them", () => {
  let state = reduce(loaded(), ...GENUINE_EDITS);
  const command = eventIconSaveCommand(state, true, mint)!;
  state = reduce(state, { type: "saveStarted", command }, { type: "saveAnswered", response: wire("dates_event_icons_save-stale") });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-admin-stale-revision" });
  assert.equal(state.pending, null);
  assert.equal(eventIconDirty(state), true);
  assert.equal(state.reason, "  Assign pin colours ");
  const edits = state.icons;
  state = reduce(state, { type: "loaded", catalog: catalogOf("dates_event_icons"), force: false });
  assert.equal(state.icons, edits, "dirty edits survive a read nobody asked for");
  assert.equal(state.revision, 0);
  // A first load that fails is not an empty catalogue: there is no revision, nothing to save.
  const failed = reduce(EVENT_ICON_EDITOR_INITIAL, { type: "requestStarted" }, { type: "loaded", catalog: null, force: false });
  assert.equal(failed.revision, null);
  assert.equal(failed.loadFailed, true);
  assert.equal(eventIconSaveCommand(failed, true, mint), null);
});

test("nothing is sent while a field Core would refuse is invalid, and the reason is required", () => {
  let state = loaded();
  assert.equal(eventIconSaveBlock(state, true), "clean");
  assert.equal(eventIconSaveBlock(state, true, true), "problems", "a half-typed value is named before 'nothing changed'");
  assert.equal(eventIconSaveBlock(state, false), "readOnly");
  state = reduce(state, { type: "added", key: "icon_0000aaaa", activity_type: "sport" }, { type: "reason", value: "New sport icon" });
  assert.equal(state.selected, "icon_0000aaaa");
  assert.deepEqual(eventIconProblems(state.icons).map(problem => `${problem.key}.${problem.field}.${problem.code}`),
    ["icon_0000aaaa.name_hu.required", "icon_0000aaaa.name_en.required", "icon_0000aaaa.emoji.required"]);
  assert.equal(eventIconSaveBlock(state, true), "problems");
  assert.equal(eventIconSaveCommand(state, true, mint), null);
  const problemsOf = (patch: Partial<DatesEventIcon>) => eventIconProblems([{ ...icon, ...patch }]).map(problem => `${problem.field}.${problem.code}`);
  assert.deepEqual(problemsOf({ name_en: " \u00A0 " }), ["name_en.required"]);
  assert.deepEqual(problemsOf({ name_hu: "é".repeat(61) }), ["name_hu.tooLong"]);
  assert.deepEqual(problemsOf({ name_hu: "é".repeat(60) }), []);
  assert.deepEqual(problemsOf({ name_en: "Yo\tga" }), ["name_en.invalid"]);
  assert.deepEqual(problemsOf({ emoji: "ab" }), ["emoji.invalid"]);
  assert.deepEqual(problemsOf({ emoji: "☕☕" }), ["emoji.invalid"]);
  assert.deepEqual(problemsOf({ emoji: " ☕ " }), [], "the emoji is trimmed like the names");
  assert.deepEqual(problemsOf({ emoji: "", image_url: "https://img.friending.co/api/cache/icons/a.png" }), []);
  assert.deepEqual(problemsOf({ emoji: "" }), ["emoji.required"]);
  for (const order of [1.5, -1, 100001, Number.NaN]) assert.deepEqual(problemsOf({ order }), ["order.invalid"], String(order));
  assert.deepEqual(problemsOf({ marker_background_color: "#8a7" }), ["marker_background_color.invalid"]);
  // The mistaken new icon can be removed again; a stored one cannot.
  state = reduce(state, { type: "removed", key: "icon_0000aaaa" });
  assert.equal(eventIconDirty(state), false);
  assert.equal(state.selected, "books");
  assert.equal(reduce(state, { type: "removed", key: "yoga" }), state);
  // Valid edits, no reason yet.
  state = reduce(state, { type: "reason", value: " a " }, { type: "edited", key: "yoga", patch: { marker_background_color: "#8A72D8" } });
  assert.equal(eventIconSaveBlock(state, true), "reason");
  assert.equal(eventIconSaveBlock(state, true, true), "problems", "a half-typed HEX value blocks the save");
  state = reduce(state, { type: "reason", value: "abc" });
  assert.equal(eventIconSaveBlock(state, true), null);
  assert.equal(eventIconSaveCommand(state, false, mint), null);
  assert.equal(eventIconSaveCommand({ ...state, busy: true }, true, mint), null);
});

test("editing rules: one default per type, a stored icon keeps its type, the default colour is null", () => {
  let state = loaded();
  const byKey = (key: string) => state.icons.find(row => row.key === key)!;
  assert.equal(byKey("running").is_default, true);
  state = reduce(state, { type: "edited", key: "yoga", patch: { is_default: true } });
  assert.deepEqual([byKey("yoga").is_default, byKey("running").is_default, byKey("hiking").is_default], [true, false, true]);
  state = reduce(state, { type: "edited", key: "yoga", patch: { enabled: false } });
  assert.deepEqual([byKey("yoga").enabled, byKey("yoga").is_default], [false, false]);
  state = reduce(state, { type: "edited", key: "yoga", patch: { is_default: true } });
  assert.equal(byKey("yoga").is_default, false, "a disabled icon cannot be the default");
  state = reduce(state, { type: "edited", key: "yoga", patch: { activity_type: "travel" } });
  assert.equal(byKey("yoga").activity_type, "sport", "the type of a stored icon does not change");
  state = reduce(state, { type: "added", key: "icon_0000bbbb", activity_type: "sport" }, { type: "edited", key: "icon_0000bbbb", patch: { is_default: true } },
    { type: "edited", key: "icon_0000bbbb", patch: { activity_type: "travel" } });
  assert.deepEqual([byKey("icon_0000bbbb").activity_type, byKey("icon_0000bbbb").is_default, byKey("hiking").is_default], ["travel", false, true]);
  assert.equal(byKey("icon_0000bbbb").marker_background_color, null);
  assert.equal(byKey("icon_0000bbbb").order, 180);
  // Back to the default colour is `null`, never a stored orange.
  state = reduce(loaded("dates_event_icons"), { type: "edited", key: "yoga", patch: { marker_background_color: null } });
  assert.equal(JSON.parse(serializeEventIcons(state.icons)).find((row: DatesEventIcon) => row.key === "yoga").marker_background_color, null);
});

test("the bridge forwards only the closed shape of the two icon routes", () => {
  const good = { icons: GENUINE_FORM.icons, expected_revision: 0, reason: GENUINE_FORM.reason, idempotency_key: GENUINE_FORM.idempotency_key };
  assert.equal(normalizeDatesEventIconsProxyBody("dates_event_icons_save", good), good);
  assert.deepEqual(normalizeDatesEventIconsProxyBody("dates_event_icons", {}), {});
  assert.equal(normalizeDatesEventIconsProxyBody("dates_event_icons", { page: 1 }), null);
  assert.equal(normalizeDatesEventIconsProxyBody("dates_configuration_save", { anything: 1 }), undefined, "other routes are not this function's");
  const rows = (change: (rows: Record<string, unknown>[]) => void) => { const next = JSON.parse(GENUINE_FORM.icons); change(next); return JSON.stringify(next); };
  for (const [label, body] of Object.entries({
    "an extra key": { ...good, dates_event_icon_contract_version: 1 },
    "a missing key": { icons: good.icons, expected_revision: 0, reason: good.reason },
    "a revision as text": { ...good, expected_revision: "0" },
    "a negative revision": { ...good, expected_revision: -1 },
    "no reason": { ...good, reason: "" },
    "an untrimmed reason": { ...good, reason: " colours " },
    "a short key": { ...good, idempotency_key: "short" },
    "icons as a list": { ...good, icons: JSON.parse(good.icons) },
    "icons that are not JSON": { ...good, icons: "[" },
    "an empty catalogue": { ...good, icons: "[]" },
    "an unknown row key": { ...good, icons: rows(next => { next[0].surprise = true; }) },
    "a row without its colour key": { ...good, icons: rows(next => { delete next[0].marker_background_color; }) },
    "a lowercase colour": { ...good, icons: rows(next => { next[1].marker_background_color = "#8a72d8"; }) },
    "an untrimmed name": { ...good, icons: rows(next => { next[0].name_en = "Running\u00A0"; }) },
    "a duplicate key": { ...good, icons: rows(next => { next[1].key = next[0].key; }) },
    "a foreign image": { ...good, icons: rows(next => { next[0].image_url = "https://evil.test/a.png"; }) },
    "a fractional order": { ...good, icons: rows(next => { next[0].order = 1.5; }) },
  })) assert.equal(normalizeDatesEventIconsProxyBody("dates_event_icons_save", body as Record<string, unknown>), null, label);
});

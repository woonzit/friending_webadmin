import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesSuggestionLeaderboardCard from "../components/DatesSuggestionLeaderboardCard.tsx";
import { authPolicyVocabularyResponse } from "../lib/authPolicyConfiguration.ts";
import { datesConfigurationRawValue, datesRuntimeSettingVisible, datesSettingEditable, datesSettingEffectiveText, datesSettingStorefrontEffective } from "../lib/datesAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { DATES_RUNTIME_HELP_KEYS } from "../lib/datesRuntimeHelp.ts";
import {
  LEADERBOARD_EDITOR_INITIAL, LEADERBOARD_ENABLED, LEADERBOARD_ENABLED_OVERRIDES, LEADERBOARD_SCOPE, LEADERBOARD_SCOPE_OVERRIDES, LEADERBOARD_SETTING_KEYS,
  isLeaderboardSettingKey, leaderboardChangedKeys, leaderboardDirty, leaderboardDraft, leaderboardDraftIssue, leaderboardDraftValues, leaderboardEdited, leaderboardEditorReducer,
  leaderboardHalfRows, leaderboardHold, leaderboardPlan, leaderboardSaveBlock, leaderboardSaveQueue, leaderboardSettings, leaderboardVerdict, normalizeDatesLeaderboardProxyBody,
  type LeaderboardAuthority, type LeaderboardCommand, type LeaderboardDraft, type LeaderboardEditorAction, type LeaderboardEditorState, type LeaderboardRead,
} from "../lib/datesSuggestionLeaderboard.ts";

const bytes = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
const fixture = (path: string) => JSON.parse(bytes(path).toString("utf8"));
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// GENUINE, Core main a5bbba5c (docs/WIRE_CORPUS_PINNING.md). The configuration read with the intake selector, whose
// last four rows are the leaderboard's at their defaults; Core's leaderboard corpus with the four rows before and
// after its saves, the receipts of two of those saves and its refusal of a bad value; and, of the same route in the
// command corpus, a stale refusal, a missing capability and a save with its replay.
const LEADERBOARD = "dates_suggestion_leaderboard_member_wire";
const CONFIGURATION = fixture("dates_event_intake_admin_wire/admin-configuration.json");
const RELEASED = fixture("dates_event_intake_admin_wire/admin-configuration-released-console.json");
const ROWS = fixture(`${LEADERBOARD}/webadmin-configuration-leaderboard-settings.json`) as { default: Record<string, any>[]; saved: Record<string, any>[] };
const save = (name: string) => projectDatesAdminBody("dates_configuration_save", fixture(`${LEADERBOARD}/webadmin-setting-save-${name}.json`));
const SAVED_SCOPE_OVERRIDES = save("scope-overrides"), SAVED_ENABLED_OVERRIDES = save("enabled-overrides");
const VALUE_INVALID = save("scope-overrides-invalid-denied");
const STALE = fixture("dates_admin_command_wire/admin-configuration-save-stale-denied.json");
const VIEWER = fixture("dates_admin_command_wire/admin-configuration-save-viewer-denied.json");

/**
 * DERIVED rows: Core's genuine four rows with other values and revisions in them, for the states its capture does not
 * hold (a country in both maps under a default that is on, an invalid stored value, ...). Core serves a value and its
 * effective value alike for a valid row, and `[]` for an empty map.
 */
const rowsWith = (values: { enabled?: unknown; enabledOverrides?: unknown; scope?: unknown; scopeOverrides?: unknown } = {}, revisions: number[] = [0, 0, 0, 0]) =>
  [values.enabled ?? false, values.enabledOverrides ?? [], values.scope ?? "country", values.scopeOverrides ?? []].map((value, index) => ({ ...ROWS.default[index],
    value, effective_value: value, revision: revisions[index], updated_at: revisions[index] === 0 ? null : 1790000000 }));
/** The configuration read as the browser receives it, with the given rows in the place of Core's last four. */
const readWith = (rows: unknown[]) => (projectDatesAdminBody("dates_configuration", { ...CONFIGURATION, settings: [...CONFIGURATION.settings.slice(0, -4), ...rows] }) as { settings: any[] }).settings;
const authorityOf = (rows: unknown[]): LeaderboardAuthority => { const read = leaderboardSettings(readWith(rows)); assert.equal(read.status, "ready"); return (read as { authority: LeaderboardAuthority }).authority; };
/**
 * DERIVED receipt: Core's genuine receipt of a leaderboard save with another of the four settings, value and revision
 * in it - and, for a replay, with the one flag a genuine replay differs in. The first test below holds the builder to
 * Core's two genuine receipts and to its genuine replay.
 */
const receiptOf = (command: LeaderboardCommand, replayed = false) => ({ ...copy(SAVED_SCOPE_OVERRIDES as Record<string, unknown>), idempotency_replayed: replayed,
  setting: { key: command.key, value: typeof command.value === "string" && command.value.startsWith("{") ? JSON.parse(command.value) : command.value, revision: command.expected_revision + 1 } });

const STORED = () => rowsWith({ enabled: false, enabledOverrides: { HUN: true, USA: false }, scope: "country", scopeOverrides: { HUN: "city", USA: "country" } }, [1, 3, 0, 2]);
const VOCABULARY = authPolicyVocabularyResponse(fixture("auth_policy_wire/webadmin-vocabulary-clean.json"))!;
const KNOWN = new Set(VOCABULARY.storefronts.map(storefront => storefront.alpha3));

test("the leaderboard corpus is Core's, byte for byte, and the builders above reproduce its genuine bodies", () => {
  const manifest = fixture(`${LEADERBOARD}/manifest.json`);
  // The pin (docs/WIRE_CORPUS_PINNING.md); the manifest and generator digests were read from Core's git objects at a5bbba5c.
  assert.equal(sha256(bytes(`${LEADERBOARD}/manifest.json`)), "aadf510cc80a947b7637c51e781a42cdc558261031cc32f0931294f91c0dba39");
  assert.deepEqual([manifest.contract, manifest.source_commit, manifest.fixture_set_sha256, manifest.provenance.generator_sha256], ["dates-suggestion-leaderboard-v1",
    "7175aabe9268a3e42b2aa832add2049b699a59a4", "77fe61840ea49a3d0de1bde82f634e3a45c7e80042596d23d29663312bbe40d3", "e6f658ac4bb10804e0aff0528dc5cf79e36b50a2de61a6c4f21dbea71479229b"]);
  assert.deepEqual(manifest.selectors.webadmin, { dates_event_intake_admin_contract_version: 1 }, "the selector this console's bridge adds to every Dates request");
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string }) => {
    assert.equal(sha256(bytes(`${LEADERBOARD}/${entry.file}`)), entry.sha256, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(sha256(lines.join("\n")), manifest.fixture_set_sha256);
  assert.deepEqual(readdirSync(new URL(`./fixtures/${LEADERBOARD}/`, import.meta.url)).sort(), [...manifest.fixtures.map((entry: { file: string }) => entry.file), "manifest.json"].sort());
  // Six bodies are the console's; the fifteen of the app are vendored only so that the set digest can be recomputed.
  assert.deepEqual([manifest.fixtures.length, manifest.fixtures.filter((entry: { consumer: string }) => entry.consumer === "webadmin").length], [21, 6]);

  // Core's two captures of the default rows agree: the excerpt, and the last four rows of the whole configuration read.
  assert.deepEqual(ROWS.default, CONFIGURATION.settings.slice(-4));
  assert.deepEqual(rowsWith(), ROWS.default, "the derived rows at their defaults are the genuine rows");
  // The derived receipt is the genuine one for the two saves Core captured ...
  const base = { reason: "Submission leaderboard rollout.", idempotency_key: "suggestion-leaderboard-save-000004", expected_revision: 0 };
  assert.deepEqual(receiptOf({ ...base, key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true}' }), SAVED_ENABLED_OVERRIDES);
  assert.deepEqual(receiptOf({ ...base, key: LEADERBOARD_SCOPE_OVERRIDES, value: '{"HUN":"city"}' }), SAVED_SCOPE_OVERRIDES);
  // ... and a replay differs from its first answer in the one flag, as Core's genuine replay of a setting save does.
  const first = fixture("dates_admin_command_wire/admin-configuration-save-first.json"), replay = fixture("dates_admin_command_wire/admin-configuration-save-first-replay.json");
  assert.deepEqual(replay, { ...first, idempotency_replayed: true });
  assert.deepEqual([VALUE_INVALID, save("enabled-overrides-invalid-denied"), save("scope-invalid-denied")].map(body => [(body as any).error, (body as any).status_code]),
    Array(3).fill(["dates-configuration-value-invalid", 422]));
});

test("the four settings have one editor: the generic list neither shows them nor meets the type it does not know", () => {
  assert.deepEqual([...LEADERBOARD_SETTING_KEYS].sort(), ["dates_suggestion_leaderboard_enabled", "dates_suggestion_leaderboard_enabled_overrides",
    "dates_suggestion_leaderboard_scope", "dates_suggestion_leaderboard_scope_overrides"]);
  for (const key of LEADERBOARD_SETTING_KEYS) {
    assert.equal(isLeaderboardSettingKey(key), true);
    assert.equal(datesRuntimeSettingVisible(key), true, "the generic rule is not what hides them");
    assert.equal(DATES_RUNTIME_HELP_KEYS.includes(key as never), false, "their help is the card's, not the runtime dialog's");
  }
  for (const key of ["dates_external_suggestions_enabled", "dates_enabled", "dates_suggestion_leaderboard", "", null, 4]) assert.equal(isLeaderboardSettingKey(key), false, String(key));
  // The page drops exactly these four from the generic list and hands them to the card (read from the page's source).
  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /datesRuntimeSettingVisible\(setting\?\.key\) && !isLeaderboardSettingKey\(setting\?\.key\)/);
  assert.match(page, /setLeaderboard\(leaderboardSettings\(configuration\.settings\)\)/);

  // GENUINE: Core serves 54 rows with the selector, the four last, the scope map of a type the generic editor has no
  // editor for. What the page lists is the other 49 (the section switch has its own home too), every one editable.
  const served = readWith(ROWS.default);
  assert.deepEqual(served, CONFIGURATION.settings, "the projection keeps the rows whole");
  assert.equal(served.length, 54);
  assert.deepEqual(served.slice(-4).map(row => [row.key, row.type]), [[LEADERBOARD_ENABLED, "boolean"], [LEADERBOARD_ENABLED_OVERRIDES, "storefront_overrides"],
    [LEADERBOARD_SCOPE, "enum"], [LEADERBOARD_SCOPE_OVERRIDES, "storefront_enum_overrides"]]);
  const listed = served.filter(row => datesRuntimeSettingVisible(row.key) && !isLeaderboardSettingKey(row.key));
  assert.equal(listed.length, 49);
  assert.ok(listed.every(row => datesSettingEditable(row.type) && row.type !== "storefront_enum_overrides"));
  // Were such a row ever listed, the generic editor would show it read-only as Core sent it - never a number field, never "[object Object]".
  assert.equal(datesSettingEditable("storefront_enum_overrides"), false);
  for (const row of [...ROWS.default, ...ROWS.saved]) {
    assert.doesNotMatch(datesConfigurationRawValue(row.type, row.value), /object Object/, row.key);
    assert.notEqual(datesSettingEffectiveText(row.type, row.effective_value, { on: "ON", off: "OFF" }), "—", row.key);
    assert.equal(datesSettingStorefrontEffective(row).status, "notApplicable", row.key);
  }
  assert.equal(datesConfigurationRawValue("storefront_enum_overrides", ROWS.saved[3].value), '{"HUN":"city"}');
});

test("the rows are read by key, revision and the shape of their value; anything else is not shown as the stored state", () => {
  // GENUINE: without the selector Core serves none of them (the released console's read); with it, the defaults.
  assert.deepEqual(leaderboardSettings((projectDatesAdminBody("dates_configuration", RELEASED) as { settings: unknown[] }).settings), { status: "absent" });
  const defaults = authorityOf(ROWS.default);
  assert.deepEqual(defaults, { values: { enabled: false, scope: "country", enabledOverrides: {}, scopeOverrides: {} },
    revisions: { [LEADERBOARD_ENABLED]: 0, [LEADERBOARD_ENABLED_OVERRIDES]: 0, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 0 }, invalid: [] });
  // GENUINE: after Core's saves - on for Austria and Hungary, by city in Hungary.
  const saved = authorityOf(ROWS.saved);
  assert.deepEqual(saved.values, { enabled: false, scope: "country", enabledOverrides: { AUT: true, HUN: true }, scopeOverrides: { HUN: "city" } });
  assert.deepEqual(saved.revisions, { [LEADERBOARD_ENABLED]: 0, [LEADERBOARD_ENABLED_OVERRIDES]: 3, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 1 });
  // The type's name is Core's to choose: the same values under other type names read the same.
  assert.deepEqual(authorityOf(ROWS.saved.map(row => ({ ...row, type: "anything" }))), saved);

  const unreadable = (rows: unknown[], label: string) => assert.deepEqual(leaderboardSettings(readWith(rows)), { status: "unreadable" }, label);
  unreadable(STORED().slice(1), "three of the four");
  unreadable([...STORED(), STORED()[0]], "a row twice");
  const change = (at: number, patch: Record<string, unknown>) => STORED().map((row, index) => index === at ? { ...row, ...patch } : row);
  for (const [at, patch] of [[0, { value: "true" }], [0, { value: 1 }], [0, { revision: -1 }], [0, { revision: "1" }], [0, { valid: "yes" }],
    [1, { value: { hun: true } }], [1, { value: { HUN: "on" } }], [1, { value: { ALL: true } }], [1, { value: [true] }], [1, { value: "{}" }],
    [2, { value: "world" }], [2, { value: null }], [3, { value: { HUN: "world" } }], [3, { value: { HUN: true } }]] as const) unreadable(change(at, patch), JSON.stringify(patch));
  assert.deepEqual(leaderboardSettings(null), { status: "unreadable" });
  assert.deepEqual(leaderboardSettings({ settings: [] }), { status: "unreadable" });

  // DERIVED from Core's read (DatesConfigurationAdminService::read): a row that does not validate is served with
  // `valid: false`, its raw stored value, and what is in effect instead of it. The control shows the latter.
  const broken = authorityOf(change(3, { value: "garbage", effective_value: [], valid: false }));
  assert.deepEqual([broken.values.scopeOverrides, broken.invalid], [{}, [LEADERBOARD_SCOPE_OVERRIDES]]);
  const off = authorityOf(change(0, { value: "yes", effective_value: false, valid: false }));
  assert.deepEqual([off.values.enabled, off.invalid], [false, [LEADERBOARD_ENABLED]]);
  // A map that names a storefront outside Core's vocabulary is "not valid" and still resolves: its countries are shown.
  const foreign = { HUN: "city", XXA: "country" };
  const flagged = authorityOf(change(3, { value: foreign, effective_value: foreign, valid: false }));
  assert.deepEqual([flagged.values.scopeOverrides, flagged.invalid], [foreign, [LEADERBOARD_SCOPE_OVERRIDES]]);
  unreadable(change(3, { value: "garbage", effective_value: "garbage", valid: false }), "an invalid row whose effective value cannot be read either");
});

test("a country row carries both answers and is written into both maps, in the form Core's own capture sent", () => {
  const authority = authorityOf(ROWS.default);
  const draft: LeaderboardDraft = { ...leaderboardDraft(authority.values), rows: [{ storefront: "HUN", enabled: true, scope: "city" }] };
  assert.deepEqual(leaderboardDraftValues(draft), { enabled: false, scope: "country", enabledOverrides: { HUN: true }, scopeOverrides: { HUN: "city" } });
  let minted = 0;
  const plan = leaderboardPlan(authority, draft, "Submission leaderboard rollout.", () => `leaderboard:${String(++minted).padStart(16, "0")}`);
  // "Hungary: on, city" is one row and two commands, the scope first. A map travels as the JSON text of an object:
  // these are the bytes Core's generator put into the `value` field of its two genuine saves (`{"HUN":true}`,
  // `{"HUN":"city"}`), and Core's answers to them are the receipts of these commands.
  assert.deepEqual(plan, [
    { key: LEADERBOARD_SCOPE_OVERRIDES, value: '{"HUN":"city"}', expected_revision: 0, reason: "Submission leaderboard rollout.", idempotency_key: "leaderboard:0000000000000001" },
    { key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true}', expected_revision: 0, reason: "Submission leaderboard rollout.", idempotency_key: "leaderboard:0000000000000002" },
  ]);
  assert.deepEqual(plan.map(command => leaderboardVerdict(command.key === LEADERBOARD_SCOPE_OVERRIDES ? SAVED_SCOPE_OVERRIDES : SAVED_ENABLED_OVERRIDES, command, false)), Array(2).fill({ kind: "success" }));
  for (const command of plan) assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration_save", { ...command }) !== null, true, "the bridge forwards exactly this shape");

  // Every row changed: the four commands go scopes first, each fenced by its own revision. The switch is a boolean
  // (the bridge writes "1" / "0" into the form), the scope its token.
  const stored = authorityOf(STORED());
  const all = leaderboardPlan(stored, { enabled: true, scope: "city", rows: [{ storefront: "USA", enabled: true, scope: "city" }, { storefront: "AUT", enabled: false, scope: "country" }] }, "Everything", () => "leaderboard:0000000000000009");
  assert.deepEqual(all.map(command => [command.key, command.value, command.expected_revision]), [[LEADERBOARD_SCOPE, "city", 0], [LEADERBOARD_SCOPE_OVERRIDES, '{"AUT":"country","USA":"city"}', 2],
    [LEADERBOARD_ENABLED, true, 1], [LEADERBOARD_ENABLED_OVERRIDES, '{"AUT":false,"USA":true}', 3]]);
  // Removing the last country stores an empty map, as an object.
  assert.deepEqual(leaderboardPlan(stored, { enabled: false, scope: "country", rows: [] }, "None", () => "leaderboard:0000000000000009").map(command => command.value), ["{}", "{}"]);
  // Nothing changed, nothing is sent: the stored state round-trips, whatever the order of the rows.
  assert.deepEqual(leaderboardChangedKeys(stored, leaderboardDraft(stored.values)), []);
  assert.deepEqual(leaderboardChangedKeys(stored, { ...leaderboardDraft(stored.values), rows: [...leaderboardDraft(stored.values).rows].reverse() }), []);
  assert.deepEqual(leaderboardChangedKeys(stored, { ...leaderboardDraft(stored.values), enabled: true }), [LEADERBOARD_ENABLED], "one changed row is one command");
});

test("genuine: a country stored in only one of the two maps is shown with the default for the other, and completed by the next save", () => {
  // Core's own capture ends like this: Austria has a switch of its own and no scope.
  const saved = authorityOf(ROWS.saved);
  assert.deepEqual(leaderboardHalfRows(saved.values), ["AUT"]);
  const draft = leaderboardDraft(saved.values);
  assert.deepEqual(draft, { enabled: false, scope: "country", rows: [{ storefront: "AUT", enabled: true, scope: "country" }, { storefront: "HUN", enabled: true, scope: "city" }] }, "what each resolves to");
  // Saving stores Austria's scope too; its switch map already holds both countries and is not written again.
  assert.deepEqual(leaderboardPlan(saved, draft, "Complete", () => "leaderboard:0000000000000001").map(command => [command.key, command.value, command.expected_revision]),
    [[LEADERBOARD_SCOPE_OVERRIDES, '{"AUT":"country","HUN":"city"}', 1]]);
  // There is something to save, and nothing of the operator's to protect: a later read simply replaces what is shown,
  // without the "your changes were kept" notice.
  const untouched = reduce(LEADERBOARD_EDITOR_INITIAL, { type: "authority", authority: saved, force: false });
  assert.deepEqual([leaderboardDirty(untouched), leaderboardEdited(untouched), leaderboardHold(untouched), leaderboardSaveBlock(untouched, true, KNOWN)], [true, false, false, "reason"]);
  const next = reduce(untouched, { type: "authority", authority: authorityOf(STORED()), force: false });
  assert.deepEqual([next.rebased, next.draft!.rows.map(row => row.storefront)], [false, ["HUN", "USA"]]);
  // DERIVED: the other way round, and both at once.
  const half = authorityOf(rowsWith({ enabled: false, scope: "city", enabledOverrides: { HUN: true }, scopeOverrides: { USA: "country" } }, [1, 1, 1, 1]));
  assert.deepEqual(leaderboardHalfRows(half.values), ["HUN", "USA"]);
  assert.deepEqual(leaderboardDraft(half.values).rows, [{ storefront: "HUN", enabled: true, scope: "city" }, { storefront: "USA", enabled: false, scope: "country" }]);
  assert.deepEqual(leaderboardChangedKeys(half, leaderboardDraft(half.values)), [LEADERBOARD_SCOPE_OVERRIDES, LEADERBOARD_ENABLED_OVERRIDES]);
  assert.deepEqual(leaderboardHalfRows(authorityOf(STORED()).values), []);
});

test("the rows cannot be saved with a missing, repeated or unknown country", () => {
  const base = leaderboardDraft(authorityOf(STORED()).values);
  assert.equal(leaderboardDraftIssue(base, KNOWN), null);
  assert.equal(leaderboardDraftIssue({ ...base, rows: [...base.rows, { storefront: "", enabled: true, scope: "country" }] }, KNOWN), "storefront");
  assert.equal(leaderboardDraftIssue({ ...base, rows: [...base.rows, { storefront: "hun", enabled: true, scope: "country" }] }, KNOWN), "storefront");
  assert.equal(leaderboardDraftIssue({ ...base, rows: [...base.rows, base.rows[0]] }, KNOWN), "duplicateStorefront");
  assert.equal(leaderboardDraftIssue({ ...base, rows: [...base.rows, { storefront: "XXA", enabled: true, scope: "country" }] }, KNOWN), "vocabulary");
  // Without the vocabulary a country cannot be judged; the card then lets no row be added or changed.
  assert.equal(leaderboardDraftIssue({ ...base, rows: [...base.rows, { storefront: "XXA", enabled: true, scope: "country" }] }, null), null);
  // Core's vocabulary has the three countries of its capture and of these tests.
  for (const code of ["AUT", "HUN", "USA"]) assert.equal(KNOWN.has(code), true, code);
});

// ---------------------------------------------------------------- the card's state (the reducer the component runs)

const reduce = (state: LeaderboardEditorState, ...actions: LeaderboardEditorAction[]) => actions.reduce(leaderboardEditorReducer, state);
const opened = (rows: unknown[] = ROWS.default) => reduce(LEADERBOARD_EDITOR_INITIAL, { type: "authority", authority: authorityOf(rows), force: false });
const HUNGARY: LeaderboardDraft = { enabled: false, scope: "country", rows: [{ storefront: "HUN", enabled: true, scope: "city" }] };
const minter = () => { let count = 0; return () => `leaderboard:${String(++count).padStart(16, "0")}`; };
const noMint = () => { throw new Error("a retained command must not get a new request key"); };
const edited = () => reduce(opened(), { type: "edited", draft: HUNGARY }, { type: "reason", value: " Submission leaderboard rollout. " });

test("genuine receipts: a save is one command per changed setting; each receipt moves the stored state on, the last one ends the save", () => {
  let state = edited();
  assert.equal(leaderboardDirty(state), true);
  assert.equal(leaderboardSaveBlock(state, true, KNOWN), null);
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  assert.deepEqual(queue.map(command => [command.key, command.reason]), [[LEADERBOARD_SCOPE_OVERRIDES, "Submission leaderboard rollout."], [LEADERBOARD_ENABLED_OVERRIDES, "Submission leaderboard rollout."]]);
  state = reduce(state, { type: "saveStarted", queue });
  assert.deepEqual([state.busy, state.attempts, state.queue.length], [true, 1, 2]);
  assert.equal(reduce(state, { type: "edited", draft: { ...HUNGARY, enabled: true } }, { type: "reason", value: "x" }), state, "nothing changes under a running save");
  // Core's genuine receipt of the scope map ...
  state = reduce(state, { type: "commandAnswered", response: SAVED_SCOPE_OVERRIDES });
  assert.deepEqual([state.busy, state.attempts, state.queue.length, state.outcome], [true, 1, 1, null], "the second command goes out at once");
  assert.deepEqual([state.authority!.values.scopeOverrides, state.authority!.revisions[LEADERBOARD_SCOPE_OVERRIDES], state.authority!.values.enabledOverrides], [{ HUN: "city" }, 1, {}]);
  // ... and of the switch map.
  state = reduce(state, { type: "commandAnswered", response: SAVED_ENABLED_OVERRIDES });
  assert.deepEqual([state.busy, state.queue.length, state.outcome, state.reason], [false, 0, { kind: "saved" }, ""]);
  assert.deepEqual(state.authority!.revisions, { [LEADERBOARD_ENABLED]: 0, [LEADERBOARD_ENABLED_OVERRIDES]: 1, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 1 });
  assert.equal(leaderboardHold(state), false);
  assert.deepEqual(leaderboardSaveQueue(state, true, KNOWN, minter()), [], "nothing left to save");
  // The read that follows the save brings the same state (DERIVED rows): nothing moves, the notice stays.
  const after = rowsWith({ enabledOverrides: { HUN: true }, scopeOverrides: { HUN: "city" } }, [0, 1, 0, 1]);
  assert.equal(reduce(state, { type: "authority", authority: authorityOf(after), force: false }), state);
  // A success body that is not the receipt of this command is not one: another setting's, another revision's, or
  // one without an audit id.
  for (const response of [SAVED_ENABLED_OVERRIDES, receiptOf({ ...queue[0], expected_revision: 4 }), { ...copy(SAVED_SCOPE_OVERRIDES as object), audit_id: undefined }]) {
    assert.deepEqual(leaderboardVerdict(response, queue[0], false), { kind: "uncertain", error: null });
  }
});

test("genuine refusals: half way, what was saved stays saved and is said, the rest stays an unsaved edit", () => {
  let state = edited();
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  // The scope map is saved (Core's receipt); the switch map meets a stale revision (Core's refusal of this route).
  state = reduce(state, { type: "saveStarted", queue }, { type: "commandAnswered", response: SAVED_SCOPE_OVERRIDES }, { type: "commandAnswered", response: STALE });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-admin-stale-revision", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [LEADERBOARD_SCOPE_OVERRIDES] });
  assert.deepEqual([state.busy, state.queue.length, state.reason], [false, 0, " Submission leaderboard rollout. "]);
  assert.deepEqual(state.draft, HUNGARY, "the edits are kept");
  assert.deepEqual(leaderboardChangedKeys(state.authority!, state.draft!), [LEADERBOARD_ENABLED_OVERRIDES], "only the refused setting is left to save");
  // The page reads the configuration again: someone else's value arrives, the edits stay and are flagged for review.
  const theirs = authorityOf(rowsWith({ enabledOverrides: { AUT: true }, scopeOverrides: { HUN: "city" } }, [0, 1, 0, 1]));
  state = reduce(state, { type: "authority", authority: theirs, force: false });
  assert.deepEqual([state.rebased, state.draft, state.authority], [true, HUNGARY, theirs]);
  // Saving again sends one new command against the new revision, under a new key.
  const again = leaderboardSaveQueue(state, true, KNOWN, () => "leaderboard:00000000000000aa");
  assert.deepEqual(again, [{ key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true}', expected_revision: 1, reason: "Submission leaderboard rollout.", idempotency_key: "leaderboard:00000000000000aa" }]);
  state = reduce(state, { type: "saveStarted", queue: again });
  assert.equal(state.rebased, false);
  // A first attempt is answered by any readable refusal of Core: a missing capability, or a value Core does not take.
  assert.deepEqual(reduce(state, { type: "commandAnswered", response: VIEWER }).outcome, { kind: "refused", error: "dates-admin-capability-required", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [] });
  state = reduce(state, { type: "commandAnswered", response: VALUE_INVALID });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-configuration-value-invalid", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [] });
  assert.deepEqual([state.queue.length, state.draft], [0, HUNGARY]);
});

test("lost response: the command in doubt and the ones after it are kept and re-sent as they are, until Core's replay settles them", () => {
  let state = edited();
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  // 1. No answer to the first command (it may have landed).
  state = reduce(state, { type: "saveStarted", queue }, { type: "commandAnswered", response: null });
  assert.deepEqual(state.outcome, { kind: "unknown", key: LEADERBOARD_SCOPE_OVERRIDES, saved: [] });
  assert.deepEqual([state.busy, state.queue, state.attempts], [false, queue, 1]);
  assert.equal(leaderboardHold(state), true);
  assert.equal(leaderboardSaveBlock(state, true, KNOWN), null, "the retained commands can be sent whatever the page shows");
  // 2. Nothing replaces them: not an edit, not a reason, not a configuration read that nobody asked for.
  const held = state;
  assert.equal(reduce(state, { type: "edited", draft: leaderboardDraft(state.authority!.values) }, { type: "reason", value: "x" },
    { type: "authority", authority: authorityOf(ROWS.saved), force: false }), held);
  // 3. The retry is the same objects. A refusal that precedes Core's receipt lookup, a value refusal that is not a
  //    pinned no-land answer of a kept command, or a timeout proves nothing about the first attempt.
  const retry = leaderboardSaveQueue(state, true, KNOWN, noMint);
  assert.equal(retry, queue);
  state = reduce(state, { type: "saveStarted", queue: retry });
  assert.equal(state.attempts, 2);
  for (const response of [VIEWER, VALUE_INVALID, { success: false, status_code: 504, error: "core-timeout" }]) {
    state = reduce(state, { type: "commandAnswered", response });
    assert.deepEqual([state.outcome?.kind, state.queue], ["unknown", queue]);
    state = reduce(state, { type: "saveStarted", queue: leaderboardSaveQueue(state, true, KNOWN, noMint) });
  }
  assert.equal(state.attempts, 5);
  // 4. Core's replay of the committed command settles it (DERIVED: the genuine receipt with the replay flag); the
  //    save goes on with the next command, a first attempt.
  state = reduce(state, { type: "commandAnswered", response: receiptOf(queue[0], true) });
  assert.deepEqual([state.busy, state.queue, state.attempts, state.saved], [true, [queue[1]], 1, [LEADERBOARD_SCOPE_OVERRIDES]]);
  // 5. The second one is lost too: it is the one in doubt now, and what was saved before it is said.
  state = reduce(state, { type: "commandAnswered", response: { success: false, status_code: 502, error: "admin-request-outcome-unknown" } });
  assert.deepEqual(state.outcome, { kind: "unknown", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [LEADERBOARD_SCOPE_OVERRIDES] });
  const rest = leaderboardSaveQueue(state, true, KNOWN, noMint);
  assert.deepEqual(rest, [queue[1]]);
  assert.equal(rest[0], queue[1], "the very object, so the very request key");
  state = reduce(state, { type: "saveStarted", queue: rest }, { type: "commandAnswered", response: receiptOf(queue[1], true) });
  assert.deepEqual([state.outcome, state.queue.length, leaderboardHold(state)], [{ kind: "saved" }, 0, false]);
  // A stale refusal of a RETRY is Core's own no-land answer: it releases the command.
  let stale = reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: null }, { type: "saveStarted", queue }, { type: "commandAnswered", response: STALE });
  assert.deepEqual([stale.outcome?.kind, stale.queue.length], ["refused", 0]);
  stale = reduce(stale, { type: "saveStarted", queue: [] });
  assert.equal(stale.busy, false, "an empty plan starts nothing");
});

test("the uncertain state has an explicit exit, and a read never replaces what the operator holds unless asked", () => {
  let state = edited();
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  state = reduce(state, { type: "saveStarted", queue }, { type: "commandAnswered", response: null });
  // The operator asked for what is stored (Core's genuine rows after its saves): the command, the edits and the reason are dropped.
  const stored = authorityOf(ROWS.saved);
  state = reduce(state, { type: "authority", authority: stored, force: true });
  assert.deepEqual(state, { ...LEADERBOARD_EDITOR_INITIAL, authority: stored, draft: leaderboardDraft(stored.values) });
  // Nothing held (DERIVED rows without a half row): a later read simply replaces what is shown, and an old refusal with it.
  state = reduce(LEADERBOARD_EDITOR_INITIAL, { type: "authority", authority: authorityOf(STORED()), force: false });
  assert.equal(leaderboardHold(state), false);
  const later = authorityOf(rowsWith({ enabled: true }, [1, 0, 0, 0]));
  state = reduce({ ...state, outcome: { kind: "refused", error: "x", key: LEADERBOARD_ENABLED, saved: [] } }, { type: "authority", authority: later, force: false });
  assert.deepEqual([state.authority, state.draft!.enabled, state.outcome, state.rebased], [later, true, null, false]);
  // A row whose country is not chosen yet is nothing to save, and still the operator's: a read does not take it away.
  const adding = reduce(state, { type: "edited", draft: { ...state.draft!, rows: [{ storefront: "", enabled: false, scope: "country" }] } });
  assert.deepEqual([leaderboardDirty(adding), leaderboardHold(adding), leaderboardSaveBlock(adding, true, KNOWN)], [false, true, "storefront"]);
  assert.equal(reduce(adding, { type: "authority", authority: stored, force: false }).draft!.rows.length, 1);
  // Before any read there is nothing to edit or save.
  assert.equal(reduce(LEADERBOARD_EDITOR_INITIAL, { type: "edited", draft: HUNGARY }), LEADERBOARD_EDITOR_INITIAL);
  assert.deepEqual(leaderboardSaveQueue(LEADERBOARD_EDITOR_INITIAL, true, KNOWN, minter()), []);
});

test("what blocks a save is named: no permission, nothing changed, a row to fix, no reason", () => {
  const clean = opened(STORED());
  assert.equal(leaderboardSaveBlock(clean, false, KNOWN), "readOnly");
  assert.equal(leaderboardSaveBlock(clean, true, KNOWN), "clean");
  assert.equal(leaderboardSaveBlock(opened(), true, KNOWN), "clean", "Core's defaults are nothing to save");
  const dirty = reduce(clean, { type: "edited", draft: { ...clean.draft!, scope: "city" } });
  assert.equal(leaderboardSaveBlock(dirty, true, KNOWN), "reason");
  assert.equal(leaderboardSaveBlock(reduce(dirty, { type: "reason", value: " ab " }), true, KNOWN), "reason");
  const ready = reduce(dirty, { type: "reason", value: "abc" });
  assert.equal(leaderboardSaveBlock(ready, true, KNOWN), null);
  assert.deepEqual(leaderboardSaveQueue(ready, false, KNOWN, minter()), []);
  assert.deepEqual(leaderboardSaveQueue({ ...ready, busy: true }, true, KNOWN, minter()), []);
  const unknown = reduce(ready, { type: "edited", draft: { ...ready.draft!, rows: [...ready.draft!.rows, { storefront: "XXA", enabled: true, scope: "city" }] } });
  assert.equal(leaderboardSaveBlock(unknown, true, KNOWN), "vocabulary");
  // A row whose stored value Core reports as invalid is written by the next save even if nothing else changed.
  const invalid = opened(STORED().map((row, index) => index === 2 ? { ...row, value: 7, effective_value: "country", valid: false } : row));
  assert.deepEqual([leaderboardDirty(invalid), leaderboardSaveBlock(invalid, true, KNOWN)], [true, "reason"]);
  assert.deepEqual(leaderboardSaveQueue(reduce(invalid, { type: "reason", value: "Repair" }), true, KNOWN, minter()).map(command => [command.key, command.value]), [[LEADERBOARD_SCOPE, "country"]]);
  // A stored storefront outside the vocabulary is shown, blocks the save, and is written once it is replaced or removed.
  const foreign = { HUN: "city", XXA: "country" };
  const flagged = opened(STORED().map((row, index) => index === 3 ? { ...row, value: foreign, effective_value: foreign, valid: false } : row));
  assert.deepEqual(flagged.draft!.rows.map(row => row.storefront), ["HUN", "USA", "XXA"]);
  assert.equal(leaderboardSaveBlock(flagged, true, KNOWN), "vocabulary");
  const fixed = reduce(flagged, { type: "edited", draft: { ...flagged.draft!, rows: flagged.draft!.rows.filter(row => row.storefront !== "XXA") } }, { type: "reason", value: "Remove the unknown storefront" });
  assert.deepEqual(leaderboardSaveQueue(fixed, true, KNOWN, minter()).map(command => [command.key, command.value]), [[LEADERBOARD_SCOPE_OVERRIDES, '{"HUN":"city","USA":"country"}']]);
});

// ---------------------------------------------------------------- the bridge

test("the bridge forwards a leaderboard setting only in its closed value, and leaves every other setting alone", () => {
  const base = { expected_revision: 2, reason: "Leaderboard", idempotency_key: "leaderboard:0000000000000001" };
  const good: Record<string, unknown>[] = [{ ...base, key: LEADERBOARD_ENABLED, value: true }, { ...base, key: LEADERBOARD_SCOPE, value: "city" },
    { ...base, key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true,"USA":false}' }, { ...base, key: LEADERBOARD_ENABLED_OVERRIDES, value: "{}" },
    { ...base, key: LEADERBOARD_SCOPE_OVERRIDES, value: '{"HUN":"city"}' }];
  for (const body of good) assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration_save", body), body, JSON.stringify(body.value));
  assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration_save", { key: "dates_report_sla_hours", value: 12, anything: 1 }), undefined, "another setting is not this function's");
  assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration", { key: LEADERBOARD_ENABLED }), undefined, "another route is not this function's");
  for (const [label, body] of Object.entries({
    "a switch as text": { ...good[0], value: "true" },
    "a switch as a number": { ...good[0], value: 1 },
    // GENUINE: the three values Core's capture was refused for (`dates-configuration-value-invalid`) do not leave the console.
    "Core's refused scope": { ...good[1], value: "street" },
    "Core's refused switch map": { ...good[2], value: '{"HUN":"yes"}' },
    "Core's refused scope map": { ...good[4], value: '{"HUN":"street"}' },
    "a map as an object": { ...good[2], value: { HUN: true } },
    "a map that is a list": { ...good[2], value: "[]" },
    "a map that is not JSON": { ...good[2], value: "{" },
    "a lowercase country": { ...good[2], value: '{"hun":true}' },
    "the ALL pseudo-country": { ...good[2], value: '{"ALL":true}' },
    "a switch map with a scope in it": { ...good[2], value: '{"HUN":"city"}' },
    "a scope map with a switch in it": { ...good[4], value: '{"HUN":true}' },
    "an extra key": { ...good[0], effective_value: true },
    "no reason": { ...good[0], reason: "" },
    "an untrimmed reason": { ...good[0], reason: " x y " },
    "a revision as text": { ...good[0], expected_revision: "2" },
    "a negative revision": { ...good[0], expected_revision: -1 },
    "a short key": { ...good[0], idempotency_key: "short" },
    "no request key": { key: LEADERBOARD_ENABLED, value: true, expected_revision: 2, reason: "Leaderboard" },
  })) assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration_save", body as Record<string, unknown>), null, label);
});

// ---------------------------------------------------------------- what is drawn

function render(locale: string, props: Partial<Parameters<typeof DatesSuggestionLeaderboardCard>[0]> & { read: LeaderboardRead }) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesSuggestionLeaderboardCard, { canManage: true, suggestionsOn: true, onReload: () => undefined, initialVocabulary: VOCABULARY, ...props })));
  assert.deepEqual(errors, [], `${locale}: every message exists`);
  return html;
}
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const ready = (rows: unknown[]): LeaderboardRead => ({ status: "ready", authority: authorityOf(rows) });

test("genuine rows: the card renders Core's stored state with the default row, one row per country and the scope explained", () => {
  for (const locale of ["en", "hu"] as const) {
    const text = messagesOf(locale).datesAdmin.suggestionLeaderboard;
    const html = render(locale, { read: ready(ROWS.saved), initialState: opened(ROWS.saved) });
    assert.ok(html.includes(escaped(text.title)) && html.includes(escaped(text.defaultTitle)));
    // Austria and Hungary, by name in the page's language, each with a switch and a scope.
    assert.equal((html.match(/class="dates-leaderboard-row"/g) ?? []).length, 2);
    assert.ok(html.includes(`<option value="AUT" selected="">${locale === "hu" ? "Ausztria" : "Austria"} · AUT</option>`));
    assert.ok(html.includes(`<option value="HUN" selected="">${locale === "hu" ? "Magyarország" : "Hungary"} · HUN</option>`));
    // A country that has a row cannot be chosen for another one.
    assert.equal((html.match(/<option value="HUN" disabled="">/g) ?? []).length, 1);
    assert.equal((html.match(/<option value="USA" disabled="">/g) ?? []).length, 0);
    // Three switches (default off, Austria on, Hungary on) and three scopes (country; Austria's is the default's; city).
    assert.deepEqual((html.match(/<input type="checkbox"[^>]*>/g) ?? []).map(input => input.includes("checked")), [false, true, true]);
    assert.deepEqual([...html.matchAll(/<option value="(country|city)" selected="">/g)].map(match => match[1]), ["country", "country", "city"]);
    // Austria is stored in one map only: said, and saving (once a reason is given) completes it.
    assert.ok(html.includes(escaped(text.halfRows.replace("{codes}", "AUT"))));
    assert.ok(html.includes(escaped(text.blockReason.replace("{min}", "3"))));
    // One helper line for each scope.
    for (const scope of ["country", "city"] as const) assert.ok(html.includes(`<p><strong>${escaped(text.scopes[scope])}:</strong> ${escaped(text.scopeHelp[scope])}</p>`), scope);
    assert.equal(html.includes(escaped(text.suggestionsOff)), false);
    // Core's defaults: no country, nothing to save.
    const defaults = render(locale, { read: ready(ROWS.default), initialState: opened() });
    assert.ok(defaults.includes(escaped(text.emptyCountries)) && defaults.includes(escaped(text.addCountry)) && defaults.includes(escaped(text.block.clean)));
    assert.equal((defaults.match(/class="dates-leaderboard-row"/g) ?? []).length, 0);
  }
  // The owner's wording of the two scopes.
  const hu = messagesOf("hu").datesAdmin.suggestionLeaderboard;
  assert.equal(`${hu.scopes.country}: ${hu.scopeHelp.country}`, "Ország: mindenki, aki az adott országban küldött be megjelent eseményt.");
  assert.equal(`${hu.scopes.city}: ${hu.scopeHelp.city}`, "Város: a tag aktuális városának ranglistája.");
});

test("the card says what it cannot show or save, and offers the two exits of a save in doubt", () => {
  for (const locale of ["en", "hu"] as const) {
    const text = messagesOf(locale).datesAdmin.suggestionLeaderboard, shared = messagesOf(locale).datesAdmin.eventIcons;
    assert.ok(render(locale, { read: { status: "absent" } }).includes(escaped(text.absent)));
    assert.ok(render(locale, { read: { status: "unreadable" } }).includes(escaped(text.unreadable)));
    assert.ok(render(locale, { read: ready(ROWS.default), initialState: opened(), suggestionsOn: false }).includes(escaped(text.suggestionsOff)));
    assert.ok(render(locale, { read: ready(ROWS.default), initialState: opened(), canManage: false }).includes(escaped(text.block.readOnly)));
    // A stored country Core's vocabulary does not have (the row is then "not valid" and still in effect) is shown,
    // flagged, and blocks the save.
    const map = { XXA: "city" };
    const foreign = rowsWith({ enabledOverrides: { XXA: true } }, [0, 1, 0, 1]).map((row, index) => index === 3 ? { ...row, value: map, effective_value: map, valid: false } : row);
    const flagged = render(locale, { read: ready(foreign), initialState: opened(foreign) });
    assert.ok(flagged.includes(escaped(text.vocabularyWarning.replace("{codes}", "XXA"))) && flagged.includes(escaped(text.block.vocabulary)));
    assert.ok(flagged.includes(`<option value="XXA" selected="">${escaped(text.unknownCountry.replace("{code}", "XXA"))}</option>`));
    assert.ok(flagged.includes(escaped(text.invalidStored.replace("{settings}", text.settings[LEADERBOARD_SCOPE_OVERRIDES]))));
    // A save in doubt: which setting, what was saved before it, the fields locked, and both exits.
    const queue = leaderboardSaveQueue(edited(), true, KNOWN, minter());
    const doubt = reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: SAVED_SCOPE_OVERRIDES }, { type: "commandAnswered", response: null });
    const html = render(locale, { read: ready(ROWS.default), initialState: doubt });
    assert.ok(html.includes(escaped(text.unknown.replace("{setting}", text.settings[LEADERBOARD_ENABLED_OVERRIDES]))));
    assert.ok(html.includes(escaped(text.savedBefore.replace("{settings}", text.settings[LEADERBOARD_SCOPE_OVERRIDES]))));
    for (const button of [shared.retry, shared.reloadFromServer]) assert.ok(html.includes(`>${escaped(button)}</button>`), button);
    assert.match(html, /<fieldset class="dates-leaderboard-fields" disabled="">/);
    // Core's refusals name the setting and keep the edits on the page: a stale revision in words, another by its token.
    for (const [refusal, said] of [[STALE, text.refusedStale.replace("{setting}", text.settings[LEADERBOARD_SCOPE_OVERRIDES])],
      [VALUE_INVALID, text.refused.replace("{setting}", text.settings[LEADERBOARD_SCOPE_OVERRIDES]).replace("{error}", "dates-configuration-value-invalid")]] as const) {
      const refused = render(locale, { read: ready(ROWS.default), initialState: reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: copy(refusal) }) });
      assert.ok(refused.includes(escaped(said)), said);
      assert.ok(refused.includes(`<option value="HUN" selected="">`));
    }
    assert.ok(render(locale, { read: ready(ROWS.default), initialState: reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: SAVED_SCOPE_OVERRIDES },
      { type: "commandAnswered", response: SAVED_ENABLED_OVERRIDES }) }).includes(escaped(text.saved)));
  }
});

test("without the list of countries the rows are shown by their codes and cannot be changed", () => {
  // No vocabulary was given, so the card is in its "loading" state on a server render.
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: messagesOf("en"), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesSuggestionLeaderboardCard, { read: ready(ROWS.saved), canManage: true, suggestionsOn: null, onReload: () => undefined, initialState: opened(ROWS.saved) })));
  assert.deepEqual(errors, []);
  assert.ok(html.includes(messagesOf("en").datesAdmin.suggestionLeaderboard.countriesLoading));
  assert.ok(html.includes('<option value="HUN" selected="">HUN</option>') && html.includes('<option value="AUT" selected="">AUT</option>'));
  assert.equal((html.match(/<select disabled=""/g) ?? []).length, 4, "the two country pickers and the two scope selects of the rows");
  assert.equal((html.match(/<select/g) ?? []).length, 5, "the default scope stays editable");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesSuggestionLeaderboardCard from "../components/DatesSuggestionLeaderboardCard.tsx";
import { authPolicyVocabularyResponse } from "../lib/authPolicyConfiguration.ts";
import { datesRuntimeSettingVisible } from "../lib/datesAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { DATES_RUNTIME_HELP_KEYS } from "../lib/datesRuntimeHelp.ts";
import {
  LEADERBOARD_EDITOR_INITIAL, LEADERBOARD_ENABLED, LEADERBOARD_ENABLED_OVERRIDES, LEADERBOARD_SCOPE, LEADERBOARD_SCOPE_OVERRIDES, LEADERBOARD_SETTING_KEYS,
  isLeaderboardSettingKey, leaderboardChangedKeys, leaderboardDirty, leaderboardDraft, leaderboardDraftIssue, leaderboardDraftValues, leaderboardEditorReducer,
  leaderboardHalfRows, leaderboardHold, leaderboardPlan, leaderboardSaveBlock, leaderboardSaveQueue, leaderboardSettings, leaderboardVerdict, normalizeDatesLeaderboardProxyBody,
  type LeaderboardAuthority, type LeaderboardCommand, type LeaderboardDraft, type LeaderboardEditorAction, type LeaderboardEditorState, type LeaderboardRead,
} from "../lib/datesSuggestionLeaderboard.ts";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8"));
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// GENUINE: Core's configuration read with the intake selector, its receipt of a setting save and two of its refusals.
const CONFIGURATION = fixture("dates_event_intake_admin_wire/admin-configuration.json");
const RECEIPT = fixture("dates_admin_command_wire/admin-configuration-save.json");
const STALE = fixture("dates_admin_command_wire/admin-configuration-save-stale-denied.json");
const VIEWER = fixture("dates_admin_command_wire/admin-configuration-save-viewer-denied.json");

/**
 * PROVISIONAL. Core has not published the four leaderboard rows yet (checked against Core main 7276444d on 2026-10-09:
 * neither DatesEventIntakeSettings nor DatesConfigurationAdminService names them). The rows below are written to the
 * specification (team/handoffs/areyouin-submission-system.md, section 3) in the row shape of the genuine read above,
 * and the receipts are the genuine receipt with another setting in it. When Core's corpus carries them, these two
 * builders are replaced by its bodies. The decoder does not bind on the `type` Core gives a row, so the name of the
 * scope map's type - which the specification does not fix - is not assumed anywhere but here.
 */
const TEMPLATE = CONFIGURATION.settings.find((row: { key: string }) => row.key === "dates_external_events_enabled_overrides");
const provisionalRow = (key: string, type: string, value: unknown, fallback: unknown, revision: number, extra: Record<string, unknown> = {}) => ({ ...TEMPLATE, key, type,
  value, effective_value: value, default_value: fallback, allowed_values: type === "enum" ? ["country", "city"] : null, revision, updated_at: revision === 0 ? null : 1790000000, ...extra });
const provisionalRows = (values: { enabled?: unknown; enabledOverrides?: unknown; scope?: unknown; scopeOverrides?: unknown } = {}, revisions: number[] = [0, 0, 0, 0]) => [
  provisionalRow(LEADERBOARD_ENABLED, "boolean", values.enabled ?? false, false, revisions[0]),
  provisionalRow(LEADERBOARD_ENABLED_OVERRIDES, "storefront_overrides", values.enabledOverrides ?? [], [], revisions[1]),
  provisionalRow(LEADERBOARD_SCOPE, "enum", values.scope ?? "country", "country", revisions[2]),
  provisionalRow(LEADERBOARD_SCOPE_OVERRIDES, "storefront_scope_overrides", values.scopeOverrides ?? [], [], revisions[3]),
];
/** The configuration read as the browser receives it, with the given leaderboard rows after Core's own. */
const readWith = (rows: unknown[]) => (projectDatesAdminBody("dates_configuration", { ...CONFIGURATION, settings: [...CONFIGURATION.settings, ...rows] }) as { settings: unknown[] }).settings;
const authorityOf = (rows: unknown[]): LeaderboardAuthority => { const read = leaderboardSettings(readWith(rows)); assert.equal(read.status, "ready"); return (read as { authority: LeaderboardAuthority }).authority; };
/** Core's receipt of one command (provisional, see above): the saved row one revision on. */
const receiptOf = (command: LeaderboardCommand, replayed = false) => projectDatesAdminBody("dates_configuration_save", { ...RECEIPT, idempotency_replayed: replayed,
  setting: { key: command.key, value: typeof command.value === "string" && command.value.startsWith("{") ? JSON.parse(command.value) : command.value, revision: command.expected_revision + 1 } });

const STORED = () => provisionalRows({ enabled: false, enabledOverrides: { HUN: true, USA: false }, scope: "country", scopeOverrides: { HUN: "city", USA: "country" } }, [1, 3, 0, 2]);
const VOCABULARY = authPolicyVocabularyResponse(fixture("auth_policy_wire/webadmin-vocabulary-clean.json"))!;
const KNOWN = new Set(VOCABULARY.storefronts.map(storefront => storefront.alpha3));

test("the four settings have one editor: they are not rows of the generic list, and the list's own rows are untouched", () => {
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
  const generic = readWith(STORED()).filter((row: any) => datesRuntimeSettingVisible(row.key) && !isLeaderboardSettingKey(row.key));
  assert.equal(generic.length, CONFIGURATION.settings.filter((row: { key: string }) => row.key !== "dates_enabled").length);
});

test("the rows are read by key, revision and the shape of their value; anything else is not shown as the stored state", () => {
  assert.deepEqual(leaderboardSettings(readWith([])), { status: "absent" }, "GENUINE: the Core of today serves none of them");
  const defaults = authorityOf(provisionalRows());
  assert.deepEqual(defaults, { values: { enabled: false, scope: "country", enabledOverrides: {}, scopeOverrides: {} },
    revisions: { [LEADERBOARD_ENABLED]: 0, [LEADERBOARD_ENABLED_OVERRIDES]: 0, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 0 }, invalid: [] });
  const stored = authorityOf(STORED());
  assert.deepEqual(stored.values, { enabled: false, scope: "country", enabledOverrides: { HUN: true, USA: false }, scopeOverrides: { HUN: "city", USA: "country" } });
  assert.deepEqual(stored.revisions, { [LEADERBOARD_ENABLED]: 1, [LEADERBOARD_ENABLED_OVERRIDES]: 3, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 2 });
  // The type's name is Core's to choose: the same values under other type names read the same.
  assert.deepEqual(authorityOf(STORED().map(row => ({ ...row, type: "anything" }))), stored);

  const unreadable = (rows: unknown[], label: string) => assert.deepEqual(leaderboardSettings(readWith(rows)), { status: "unreadable" }, label);
  unreadable(STORED().slice(1), "three of the four");
  unreadable([...STORED(), STORED()[0]], "a row twice");
  const change = (at: number, patch: Record<string, unknown>) => STORED().map((row, index) => index === at ? { ...row, ...patch } : row);
  for (const [at, patch] of [[0, { value: "true" }], [0, { value: 1 }], [0, { revision: -1 }], [0, { revision: "1" }], [0, { valid: "yes" }],
    [1, { value: { hun: true } }], [1, { value: { HUN: "on" } }], [1, { value: { ALL: true } }], [1, { value: [true] }], [1, { value: "{}" }],
    [2, { value: "world" }], [2, { value: null }], [3, { value: { HUN: "world" } }], [3, { value: { HUN: true } }]] as const) unreadable(change(at, patch), JSON.stringify(patch));
  assert.deepEqual(leaderboardSettings(null), { status: "unreadable" });
  assert.deepEqual(leaderboardSettings({ settings: [] }), { status: "unreadable" });

  // A stored value Core reports as invalid is not what members get: the default is, and the next save writes the row.
  const broken = authorityOf(change(3, { value: "garbage", valid: false }));
  assert.deepEqual(broken.values.scopeOverrides, {});
  assert.deepEqual(broken.invalid, [LEADERBOARD_SCOPE_OVERRIDES]);
  unreadable(change(3, { value: "garbage", valid: false, default_value: "garbage" }), "an invalid row whose default cannot be read either");
});

test("a country row carries both answers and is written into both maps", () => {
  const authority = authorityOf(provisionalRows());
  const draft: LeaderboardDraft = { ...leaderboardDraft(authority.values), rows: [{ storefront: "HUN", enabled: true, scope: "city" }] };
  assert.deepEqual(leaderboardDraftValues(draft), { enabled: false, scope: "country", enabledOverrides: { HUN: true }, scopeOverrides: { HUN: "city" } });
  let minted = 0;
  const plan = leaderboardPlan(authority, draft, "Leaderboard for Hungary", () => `leaderboard:${String(++minted).padStart(16, "0")}`);
  // "Hungary: on, city" is one row and two commands, the scope first.
  assert.deepEqual(plan, [
    { key: LEADERBOARD_SCOPE_OVERRIDES, value: '{"HUN":"city"}', expected_revision: 0, reason: "Leaderboard for Hungary", idempotency_key: "leaderboard:0000000000000001" },
    { key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true}', expected_revision: 0, reason: "Leaderboard for Hungary", idempotency_key: "leaderboard:0000000000000002" },
  ]);
  for (const command of plan) assert.equal(normalizeDatesLeaderboardProxyBody("dates_configuration_save", { ...command }) !== null, true, "the bridge forwards exactly this shape");

  // Every row changed: the four commands go scopes first, each fenced by its own revision.
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

test("a country stored in only one of the two maps is shown with the default for the other, and completed by the next save", () => {
  const half = authorityOf(provisionalRows({ enabled: false, scope: "city", enabledOverrides: { HUN: true }, scopeOverrides: { USA: "country" } }, [1, 1, 1, 1]));
  assert.deepEqual(leaderboardHalfRows(half.values), ["HUN", "USA"]);
  const draft = leaderboardDraft(half.values);
  assert.deepEqual(draft.rows, [{ storefront: "HUN", enabled: true, scope: "city" }, { storefront: "USA", enabled: false, scope: "country" }], "what each resolves to");
  assert.deepEqual(leaderboardChangedKeys(half, draft), [LEADERBOARD_SCOPE_OVERRIDES, LEADERBOARD_ENABLED_OVERRIDES], "saving stores both answers for both");
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
});

// ---------------------------------------------------------------- the card's state (the reducer the component runs)

const reduce = (state: LeaderboardEditorState, ...actions: LeaderboardEditorAction[]) => actions.reduce(leaderboardEditorReducer, state);
const opened = (rows: unknown[] = provisionalRows()) => reduce(LEADERBOARD_EDITOR_INITIAL, { type: "authority", authority: authorityOf(rows), force: false });
const HUNGARY: LeaderboardDraft = { enabled: false, scope: "country", rows: [{ storefront: "HUN", enabled: true, scope: "city" }] };
const minter = () => { let count = 0; return () => `leaderboard:${String(++count).padStart(16, "0")}`; };
const noMint = () => { throw new Error("a retained command must not get a new request key"); };
const edited = () => reduce(opened(), { type: "edited", draft: HUNGARY }, { type: "reason", value: " Leaderboard for Hungary " });

test("a save is one command per changed setting; each receipt moves the stored state on, the last one ends the save", () => {
  let state = edited();
  assert.equal(leaderboardDirty(state), true);
  assert.equal(leaderboardSaveBlock(state, true, KNOWN), null);
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  assert.deepEqual(queue.map(command => [command.key, command.reason]), [[LEADERBOARD_SCOPE_OVERRIDES, "Leaderboard for Hungary"], [LEADERBOARD_ENABLED_OVERRIDES, "Leaderboard for Hungary"]]);
  state = reduce(state, { type: "saveStarted", queue });
  assert.deepEqual([state.busy, state.attempts, state.queue.length], [true, 1, 2]);
  assert.equal(reduce(state, { type: "edited", draft: { ...HUNGARY, enabled: true } }, { type: "reason", value: "x" }), state, "nothing changes under a running save");
  state = reduce(state, { type: "commandAnswered", response: receiptOf(queue[0]) });
  assert.deepEqual([state.busy, state.attempts, state.queue.length, state.outcome], [true, 1, 1, null], "the second command goes out at once");
  assert.deepEqual([state.authority!.values.scopeOverrides, state.authority!.revisions[LEADERBOARD_SCOPE_OVERRIDES], state.authority!.values.enabledOverrides], [{ HUN: "city" }, 1, {}]);
  state = reduce(state, { type: "commandAnswered", response: receiptOf(queue[1]) });
  assert.deepEqual([state.busy, state.queue.length, state.outcome, state.reason], [false, 0, { kind: "saved" }, ""]);
  assert.deepEqual(state.authority!.revisions, { [LEADERBOARD_ENABLED]: 0, [LEADERBOARD_ENABLED_OVERRIDES]: 1, [LEADERBOARD_SCOPE]: 0, [LEADERBOARD_SCOPE_OVERRIDES]: 1 });
  assert.equal(leaderboardHold(state), false);
  assert.deepEqual(leaderboardSaveQueue(state, true, KNOWN, minter()), [], "nothing left to save");
  // The read that follows the save brings the same state: nothing moves, the notice stays.
  const after = provisionalRows({ enabledOverrides: { HUN: true }, scopeOverrides: { HUN: "city" } }, [0, 1, 0, 1]);
  assert.equal(reduce(state, { type: "authority", authority: authorityOf(after), force: false }), state);
  // A success body that is not the receipt of this command is not one: another key, another revision, no audit id.
  for (const response of [receiptOf(queue[1]), receiptOf({ ...queue[0], expected_revision: 4 }), { ...(receiptOf(queue[0]) as object), audit_id: undefined }]) {
    assert.deepEqual(leaderboardVerdict(response, queue[0], false), { kind: "uncertain", error: null });
  }
});

test("a refusal half way: what was saved stays saved and is said, the rest stays an unsaved edit", () => {
  let state = edited();
  const queue = leaderboardSaveQueue(state, true, KNOWN, minter());
  // GENUINE refusals of the setting save: a stale revision, then a missing capability.
  state = reduce(state, { type: "saveStarted", queue }, { type: "commandAnswered", response: receiptOf(queue[0]) }, { type: "commandAnswered", response: STALE });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-admin-stale-revision", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [LEADERBOARD_SCOPE_OVERRIDES] });
  assert.deepEqual([state.busy, state.queue.length, state.reason], [false, 0, " Leaderboard for Hungary "]);
  assert.deepEqual(state.draft, HUNGARY, "the edits are kept");
  assert.deepEqual(leaderboardChangedKeys(state.authority!, state.draft!), [LEADERBOARD_ENABLED_OVERRIDES], "only the refused setting is left to save");
  // The page reads the configuration again: someone else's value arrives, the edits stay and are flagged for review.
  const theirs = authorityOf(provisionalRows({ enabledOverrides: { AUT: true }, scopeOverrides: { HUN: "city" } }, [0, 1, 0, 1]));
  state = reduce(state, { type: "authority", authority: theirs, force: false });
  assert.deepEqual([state.rebased, state.draft, state.authority], [true, HUNGARY, theirs]);
  // Saving again sends one new command against the new revision, under a new key.
  const again = leaderboardSaveQueue(state, true, KNOWN, () => "leaderboard:00000000000000aa");
  assert.deepEqual(again, [{ key: LEADERBOARD_ENABLED_OVERRIDES, value: '{"HUN":true}', expected_revision: 1, reason: "Leaderboard for Hungary", idempotency_key: "leaderboard:00000000000000aa" }]);
  state = reduce(state, { type: "saveStarted", queue: again });
  assert.equal(state.rebased, false);
  // A first attempt is answered by any readable refusal of Core.
  state = reduce(state, { type: "commandAnswered", response: VIEWER });
  assert.deepEqual(state.outcome, { kind: "refused", error: "dates-admin-capability-required", key: LEADERBOARD_ENABLED_OVERRIDES, saved: [] });
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
    { type: "authority", authority: authorityOf(STORED()), force: false }), held);
  // 3. The retry is the same objects. A refusal that precedes Core's receipt lookup, or a timeout, proves nothing.
  const retry = leaderboardSaveQueue(state, true, KNOWN, noMint);
  assert.equal(retry, queue);
  state = reduce(state, { type: "saveStarted", queue: retry });
  assert.equal(state.attempts, 2);
  state = reduce(state, { type: "commandAnswered", response: VIEWER });
  assert.deepEqual([state.outcome?.kind, state.queue], ["unknown", queue]);
  state = reduce(state, { type: "saveStarted", queue: leaderboardSaveQueue(state, true, KNOWN, noMint) }, { type: "commandAnswered", response: { success: false, status_code: 504, error: "core-timeout" } });
  assert.deepEqual([state.outcome?.kind, state.queue, state.attempts], ["unknown", queue, 3]);
  // 4. Core's replay of the committed command settles it; the save goes on with the next command, a first attempt.
  state = reduce(state, { type: "saveStarted", queue: leaderboardSaveQueue(state, true, KNOWN, noMint) }, { type: "commandAnswered", response: receiptOf(queue[0], true) });
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
  // The operator asked for what is stored: the command, the edits and the reason are dropped.
  const stored = authorityOf(STORED());
  state = reduce(state, { type: "authority", authority: stored, force: true });
  assert.deepEqual(state, { ...LEADERBOARD_EDITOR_INITIAL, authority: stored, draft: leaderboardDraft(stored.values) });
  assert.equal(leaderboardHold(state), false);
  // Nothing held: a later read simply replaces what is shown, and an old refusal with it.
  const later = authorityOf(provisionalRows({ enabled: true }, [1, 0, 0, 0]));
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
  const dirty = reduce(clean, { type: "edited", draft: { ...clean.draft!, scope: "city" } });
  assert.equal(leaderboardSaveBlock(dirty, true, KNOWN), "reason");
  assert.equal(leaderboardSaveBlock(reduce(dirty, { type: "reason", value: " ab " }), true, KNOWN), "reason");
  const ready = reduce(dirty, { type: "reason", value: "abc" });
  assert.equal(leaderboardSaveBlock(ready, true, KNOWN), null);
  assert.deepEqual(leaderboardSaveQueue(ready, false, KNOWN, minter()), []);
  assert.deepEqual(leaderboardSaveQueue({ ...ready, busy: true }, true, KNOWN, minter()), []);
  const unknown = reduce(ready, { type: "edited", draft: { ...ready.draft!, rows: [...ready.draft!.rows, { storefront: "XXA", enabled: true, scope: "city" }] } });
  assert.equal(leaderboardSaveBlock(unknown, true, KNOWN), "vocabulary");
  // A row whose stored value is invalid is written by the next save even if nothing else changed.
  const invalid = opened(STORED().map((row, index) => index === 2 ? { ...row, value: 7, valid: false } : row));
  assert.deepEqual([leaderboardDirty(invalid), leaderboardSaveBlock(invalid, true, KNOWN)], [true, "reason"]);
  assert.deepEqual(leaderboardSaveQueue(reduce(invalid, { type: "reason", value: "Repair" }), true, KNOWN, minter()).map(command => [command.key, command.value]), [[LEADERBOARD_SCOPE, "country"]]);
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
    "an unknown scope": { ...good[1], value: "world" },
    "a map as an object": { ...good[2], value: { HUN: true } },
    "a map that is a list": { ...good[2], value: "[]" },
    "a map that is not JSON": { ...good[2], value: "{" },
    "a lowercase country": { ...good[2], value: '{"hun":true}' },
    "the ALL pseudo-country": { ...good[2], value: '{"ALL":true}' },
    "a switch map with a scope in it": { ...good[2], value: '{"HUN":"city"}' },
    "a scope map with a switch in it": { ...good[4], value: '{"HUN":true}' },
    "a scope map with an unknown scope": { ...good[4], value: '{"HUN":"world"}' },
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

test("the card renders the default row and one row per country, with the scope explained, in English and Hungarian", () => {
  for (const locale of ["en", "hu"] as const) {
    const text = messagesOf(locale).datesAdmin.suggestionLeaderboard;
    const html = render(locale, { read: ready(STORED()), initialState: opened(STORED()) });
    assert.ok(html.includes(escaped(text.title)) && html.includes(escaped(text.defaultTitle)));
    // Two countries, by name in the page's language, each with a switch and a scope.
    assert.equal((html.match(/class="dates-leaderboard-row"/g) ?? []).length, 2);
    assert.ok(html.includes(`<option value="HUN" selected="">${locale === "hu" ? "Magyarország" : "Hungary"} · HUN</option>`));
    assert.ok(html.includes(`<option value="USA" selected="">${locale === "hu" ? "Egyesült Államok" : "United States"} · USA</option>`));
    // A country that has a row cannot be chosen for another one.
    assert.equal((html.match(/<option value="USA" disabled="">/g) ?? []).length, 1);
    assert.equal((html.match(/<option value="AUT" disabled="">/g) ?? []).length, 0);
    // Three switches (default off, Hungary on, United States off) and three scope selects (country, city, country).
    assert.deepEqual((html.match(/<input type="checkbox"[^>]*>/g) ?? []).map(input => input.includes("checked")), [false, true, false]);
    assert.deepEqual([...html.matchAll(/<option value="(country|city)" selected="">/g)].map(match => match[1]), ["country", "city", "country"]);
    // One helper line for each scope.
    for (const scope of ["country", "city"] as const) assert.ok(html.includes(`<p><strong>${escaped(text.scopes[scope])}:</strong> ${escaped(text.scopeHelp[scope])}</p>`), scope);
    assert.ok(html.includes(escaped(text.block.clean)));
    assert.equal(html.includes(escaped(text.suggestionsOff)), false);
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
    assert.ok(render(locale, { read: ready(provisionalRows()), initialState: opened(), suggestionsOn: false }).includes(escaped(text.suggestionsOff)));
    const empty = render(locale, { read: ready(provisionalRows()), initialState: opened() });
    assert.ok(empty.includes(escaped(text.emptyCountries)) && empty.includes(escaped(text.addCountry)));
    assert.ok(render(locale, { read: ready(provisionalRows()), initialState: opened(), canManage: false }).includes(escaped(text.block.readOnly)));
    // A stored country Core's vocabulary does not have is shown, flagged, and blocks the save.
    const foreign = provisionalRows({ enabledOverrides: { XXA: true }, scopeOverrides: { XXA: "city" } }, [0, 1, 0, 1]);
    const flagged = render(locale, { read: ready(foreign), initialState: opened(foreign) });
    assert.ok(flagged.includes(escaped(text.vocabularyWarning.replace("{codes}", "XXA"))) && flagged.includes(escaped(text.block.vocabulary)));
    assert.ok(flagged.includes(`<option value="XXA" selected="">${escaped(text.unknownCountry.replace("{code}", "XXA"))}</option>`));
    // A country in only one of the two maps, and a row whose stored value is invalid, are said.
    const half = provisionalRows({ enabledOverrides: { HUN: true } }, [0, 1, 0, 0]);
    assert.ok(render(locale, { read: ready(half), initialState: opened(half) }).includes(escaped(text.halfRows.replace("{codes}", "HUN"))));
    const invalid = provisionalRows().map((row, index) => index === 0 ? { ...row, value: "on", valid: false } : row);
    assert.ok(render(locale, { read: ready(invalid), initialState: opened(invalid) }).includes(escaped(text.invalidStored.replace("{settings}", text.settings[LEADERBOARD_ENABLED]))));
    // A save in doubt: which setting, what was saved before it, the fields locked, and both exits.
    const queue = leaderboardSaveQueue(edited(), true, KNOWN, minter());
    const doubt = reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: receiptOf(queue[0]) }, { type: "commandAnswered", response: null });
    const html = render(locale, { read: ready(provisionalRows()), initialState: doubt });
    assert.ok(html.includes(escaped(text.unknown.replace("{setting}", text.settings[LEADERBOARD_ENABLED_OVERRIDES]))));
    assert.ok(html.includes(escaped(text.savedBefore.replace("{settings}", text.settings[LEADERBOARD_SCOPE_OVERRIDES]))));
    for (const button of [shared.retry, shared.reloadFromServer]) assert.ok(html.includes(`>${escaped(button)}</button>`), button);
    assert.match(html, /<fieldset class="dates-leaderboard-fields" disabled="">/);
    // A stale refusal names the setting and keeps the edits on the page.
    const refused = reduce(edited(), { type: "saveStarted", queue }, { type: "commandAnswered", response: copy(STALE) });
    const stale = render(locale, { read: ready(provisionalRows()), initialState: refused });
    assert.ok(stale.includes(escaped(text.refusedStale.replace("{setting}", text.settings[LEADERBOARD_SCOPE_OVERRIDES]))));
    assert.ok(stale.includes(`<option value="HUN" selected="">`));
  }
});

test("without the list of countries the rows are shown by their codes and cannot be changed", () => {
  // No vocabulary was given, so the card is in its "loading" state on a server render.
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: messagesOf("en"), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesSuggestionLeaderboardCard, { read: ready(STORED()), canManage: true, suggestionsOn: null, onReload: () => undefined, initialState: opened(STORED()) })));
  assert.deepEqual(errors, []);
  assert.ok(html.includes(messagesOf("en").datesAdmin.suggestionLeaderboard.countriesLoading));
  assert.ok(html.includes('<option value="HUN" selected="">HUN</option>'));
  assert.equal((html.match(/<select disabled=""/g) ?? []).length, 4, "the two country pickers and the two scope selects of the rows");
  assert.equal((html.match(/<select/g) ?? []).length, 5, "the default scope stays editable");
});

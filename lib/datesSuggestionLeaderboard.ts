import { datesSettingSaveReceipt } from "./datesCommandReceipts";
import { datesCommandOutcome, type DatesCommandOutcome } from "./datesExternalAdmin";

/**
 * The submission leaderboard's switch and scope (AreYouIn -> Configuration).
 *
 * Four rows of the Dates configuration, each with its own revision:
 * the default answer and the scope, and for each of them a map of storefront
 * (ISO alpha-3) overrides. The request's storefront decides, as for the other
 * AreYouIn switches. The console shows them as ONE control: a default row and
 * one row per country, and a country row always carries both answers ("Hungary:
 * on, city"), so it is written into both maps.
 *
 * They are saved through `dates_configuration_save`, one row per command. A
 * save is therefore up to four commands, sent in a fixed order and stopped at
 * the first one that is not confirmed; the state below (without React) is what
 * keeps a partly written save honest:
 *
 * - a command whose outcome is unknown is kept with its request key and is the
 *   next thing sent; only its receipt, a refusal that proves nothing was
 *   written, or a read the operator asked for releases it;
 * - what a save has already written is taken into the stored values at once,
 *   so the rest of the edits stay visible as what they are: not saved yet;
 * - a configuration read never replaces unsaved edits or a retained command
 *   unless the operator asked for exactly that.
 */

export const LEADERBOARD_ENABLED = "dates_suggestion_leaderboard_enabled";
export const LEADERBOARD_ENABLED_OVERRIDES = "dates_suggestion_leaderboard_enabled_overrides";
export const LEADERBOARD_SCOPE = "dates_suggestion_leaderboard_scope";
export const LEADERBOARD_SCOPE_OVERRIDES = "dates_suggestion_leaderboard_scope_overrides";
/**
 * The four rows, in the order a save writes them: the scopes before the
 * switches, so that a leaderboard never becomes visible with a scope the
 * operator has not chosen yet.
 */
export const LEADERBOARD_SETTING_KEYS = [LEADERBOARD_SCOPE, LEADERBOARD_SCOPE_OVERRIDES, LEADERBOARD_ENABLED, LEADERBOARD_ENABLED_OVERRIDES] as const;
export type LeaderboardSettingKey = (typeof LEADERBOARD_SETTING_KEYS)[number];
export const isLeaderboardSettingKey = (key: unknown): key is LeaderboardSettingKey => typeof key === "string" && (LEADERBOARD_SETTING_KEYS as readonly string[]).includes(key);

/** `country`: everyone who submitted a published event in that country. `city`: the board of the member's current city. */
export const LEADERBOARD_SCOPES = ["country", "city"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];
export const LEADERBOARD_REASON_MIN = 3;
export const LEADERBOARD_REASON_MAX = 1000;
const MAX_OVERRIDES = 512;

export type LeaderboardValues = {
  enabled: boolean;
  scope: LeaderboardScope;
  enabledOverrides: Readonly<Record<string, boolean>>;
  scopeOverrides: Readonly<Record<string, LeaderboardScope>>;
};
export type LeaderboardAuthority = {
  /** What is stored - of a row Core reports as invalid, what is in effect instead of it. */
  values: LeaderboardValues;
  revisions: Readonly<Record<LeaderboardSettingKey, number>>;
  /** The rows whose stored value Core reports as invalid: the next save writes them whatever else changed. */
  invalid: readonly LeaderboardSettingKey[];
};
export type LeaderboardRead =
  /** This Core serves none of the four rows (a Core from before the leaderboard). */
  | { status: "absent" }
  /** Some of them, or a value this console cannot read: nothing is shown as if it were the stored state. */
  | { status: "unreadable" }
  | { status: "ready"; authority: LeaderboardAuthority };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const storefront = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value) && value !== "ALL";
const scope = (value: unknown): value is LeaderboardScope => typeof value === "string" && (LEADERBOARD_SCOPES as readonly string[]).includes(value);
const bool = (value: unknown): value is boolean => typeof value === "boolean";

/** A storefront map. Core's empty associative PHP map is `[]` on a read; a map the browser sends is always an object. */
function overrides<T>(value: unknown, item: (entry: unknown) => entry is T, fromBrowser = false): Record<string, T> | null {
  if (Array.isArray(value)) return !fromBrowser && value.length === 0 ? {} : null;
  if (!record(value) || Object.keys(value).length > MAX_OVERRIDES) return null;
  const map: Record<string, T> = {};
  for (const code of Object.keys(value).sort()) {
    const entry = value[code];
    if (!storefront(code) || !item(entry)) return null;
    map[code] = entry;
  }
  return map;
}

const PARSERS: Record<LeaderboardSettingKey, (value: unknown) => unknown | null> = {
  [LEADERBOARD_ENABLED]: value => bool(value) ? value : null,
  [LEADERBOARD_SCOPE]: value => scope(value) ? value : null,
  [LEADERBOARD_ENABLED_OVERRIDES]: value => overrides(value, bool),
  [LEADERBOARD_SCOPE_OVERRIDES]: value => overrides(value, scope),
};

/**
 * The four rows out of the configuration read's `settings` (the whole list,
 * as Core served it; they are its last four, of the types `boolean`,
 * `storefront_overrides`, `enum` and `storefront_enum_overrides`). A row is
 * bound on its key, its revision and the shape of its value - not on the name
 * Core gives its type, which the generic setting editor does not know for the
 * scope map and need not: these rows are never rows of its list.
 *
 * A row Core reports as not valid (`valid: false`) carries the raw stored
 * value, which may be anything. What members get in its place is the row's
 * `effective_value`, and that is what the control shows: the default for a
 * switch or a scope that is not one, an empty map for a map that is not one -
 * and, for a map that names a storefront Core's vocabulary no longer has, the
 * map itself, which still resolves (the control then flags that country).
 */
export function leaderboardSettings(settings: unknown): LeaderboardRead {
  if (!Array.isArray(settings)) return { status: "unreadable" };
  const rows = settings.filter((row): row is Record<string, unknown> => record(row) && isLeaderboardSettingKey(row.key));
  if (rows.length === 0) return { status: "absent" };
  const parsed: Partial<Record<LeaderboardSettingKey, unknown>> = {}, revisions: Partial<Record<LeaderboardSettingKey, number>> = {};
  const invalid: LeaderboardSettingKey[] = [];
  for (const row of rows) {
    const key = row.key as LeaderboardSettingKey;
    if (Object.hasOwn(parsed, key) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0 || typeof row.valid !== "boolean") return { status: "unreadable" };
    const value = PARSERS[key](row.valid ? row.value : row.effective_value);
    if (value === null) return { status: "unreadable" };
    parsed[key] = value;
    revisions[key] = row.revision as number;
    if (!row.valid) invalid.push(key);
  }
  if (rows.length !== LEADERBOARD_SETTING_KEYS.length) return { status: "unreadable" };
  return { status: "ready", authority: {
    values: { enabled: parsed[LEADERBOARD_ENABLED] as boolean, scope: parsed[LEADERBOARD_SCOPE] as LeaderboardScope,
      enabledOverrides: parsed[LEADERBOARD_ENABLED_OVERRIDES] as Record<string, boolean>, scopeOverrides: parsed[LEADERBOARD_SCOPE_OVERRIDES] as Record<string, LeaderboardScope> },
    revisions: revisions as Record<LeaderboardSettingKey, number>,
    invalid: LEADERBOARD_SETTING_KEYS.filter(key => invalid.includes(key)),
  } };
}

/** One country of the control: both answers, always. `storefront: ""`: a new row whose country is not chosen yet. */
export type LeaderboardRow = { storefront: string; enabled: boolean; scope: LeaderboardScope };
export type LeaderboardDraft = { enabled: boolean; scope: LeaderboardScope; rows: LeaderboardRow[] };

/**
 * The stored values as the control shows them. A country that is in only one
 * of the two maps gets the default for the answer it lacks - which is what it
 * resolves to - and is listed by `leaderboardHalfRows`: the next save writes
 * it into both maps.
 */
export function leaderboardDraft(values: LeaderboardValues): LeaderboardDraft {
  const codes = [...new Set([...Object.keys(values.enabledOverrides), ...Object.keys(values.scopeOverrides)])].sort();
  return { enabled: values.enabled, scope: values.scope,
    rows: codes.map(code => ({ storefront: code, enabled: values.enabledOverrides[code] ?? values.enabled, scope: values.scopeOverrides[code] ?? values.scope })) };
}
export function leaderboardHalfRows(values: LeaderboardValues): string[] {
  return [...new Set([...Object.keys(values.enabledOverrides), ...Object.keys(values.scopeOverrides)])].sort()
    .filter(code => Object.hasOwn(values.enabledOverrides, code) !== Object.hasOwn(values.scopeOverrides, code));
}

/** What the control would store: a country row goes into both maps. Rows without a country are not part of it. */
export function leaderboardDraftValues(draft: LeaderboardDraft): LeaderboardValues {
  const rows = draft.rows.filter(row => row.storefront !== "").sort((left, right) => left.storefront.localeCompare(right.storefront));
  return { enabled: draft.enabled, scope: draft.scope,
    enabledOverrides: Object.fromEntries(rows.map(row => [row.storefront, row.enabled])),
    scopeOverrides: Object.fromEntries(rows.map(row => [row.storefront, row.scope])) };
}

export type LeaderboardDraftIssue = "storefront" | "duplicateStorefront" | "vocabulary";
/**
 * Why the rows cannot be saved, or `null`. `known` is Core's storefront
 * vocabulary; without it (`null`: it could not be read) a country cannot be
 * checked - the control then does not let a row be added or changed.
 */
export function leaderboardDraftIssue(draft: LeaderboardDraft, known: ReadonlySet<string> | null): LeaderboardDraftIssue | null {
  const seen = new Set<string>();
  for (const row of draft.rows) {
    if (!storefront(row.storefront)) return "storefront";
    if (seen.has(row.storefront)) return "duplicateStorefront";
    seen.add(row.storefront);
  }
  return known !== null && draft.rows.some(row => !known.has(row.storefront)) ? "vocabulary" : null;
}

/**
 * A value as the card sends it - the form Core's `dates_configuration_save`
 * reads for each of the four rows (Core 7175aabe):
 * - the switch as a boolean. The bridge writes it into the form as "1" / "0",
 *   which `DatesConfigurationAdminService::strictBoolean` reads;
 * - the scope as its token, `country` or `city`;
 * - a map as the JSON text of an object, storefronts sorted, `{}` when empty.
 *   A form field is text, so this is the one form a map has on the wire, and
 *   Core decodes it itself: `storefrontOverrides()` for the switches and
 *   `DatesSuggestionLeaderboardPolicy::scopeOverridesForWrite()` for the
 *   scopes both `json_decode` a string. (An object handed to the bridge would
 *   leave it as these same bytes; Core's own capture sent `{"HUN":true}` and
 *   `{"HUN":"city"}`.)
 */
function wireValue(key: LeaderboardSettingKey, values: LeaderboardValues): boolean | string {
  if (key === LEADERBOARD_ENABLED) return values.enabled;
  if (key === LEADERBOARD_SCOPE) return values.scope;
  const map = key === LEADERBOARD_ENABLED_OVERRIDES ? values.enabledOverrides : values.scopeOverrides;
  return JSON.stringify(Object.fromEntries(Object.keys(map).sort().map(code => [code, map[code]])));
}

/** The rows a save of this draft would write, in the order it writes them. */
export function leaderboardChangedKeys(authority: LeaderboardAuthority, draft: LeaderboardDraft): LeaderboardSettingKey[] {
  const next = leaderboardDraftValues(draft);
  return LEADERBOARD_SETTING_KEYS.filter(key => authority.invalid.includes(key) || wireValue(key, next) !== wireValue(key, authority.values));
}

export type LeaderboardCommand = { key: LeaderboardSettingKey; value: boolean | string; expected_revision: number; reason: string; idempotency_key: string };
/** One `dates_configuration_save` command per changed row, each fenced by its own revision and with its own request key. */
export function leaderboardPlan(authority: LeaderboardAuthority, draft: LeaderboardDraft, reason: string, mintKey: () => string): LeaderboardCommand[] {
  const next = leaderboardDraftValues(draft);
  return leaderboardChangedKeys(authority, draft).map(key => ({ key, value: wireValue(key, next), expected_revision: authority.revisions[key], reason, idempotency_key: mintKey() }));
}

/**
 * What Core's answer means for one command. A first attempt is fenced by the
 * row's revision; a repeat keeps its request key, so only a receipt or a
 * refusal Core raises without writing settles it.
 */
export function leaderboardVerdict(response: unknown, command: LeaderboardCommand, retrying: boolean): DatesCommandOutcome {
  return datesCommandOutcome(response, datesSettingSaveReceipt(response, command), retrying ? "kept" : "fresh");
}

/** The stored values after a command that Core confirmed: its row carries what was sent, one revision on. */
function applied(authority: LeaderboardAuthority, command: LeaderboardCommand): LeaderboardAuthority {
  const values = { ...authority.values };
  if (command.key === LEADERBOARD_ENABLED) values.enabled = command.value as boolean;
  else if (command.key === LEADERBOARD_SCOPE) values.scope = command.value as LeaderboardScope;
  else if (command.key === LEADERBOARD_ENABLED_OVERRIDES) values.enabledOverrides = JSON.parse(command.value as string);
  else values.scopeOverrides = JSON.parse(command.value as string);
  return { values, revisions: { ...authority.revisions, [command.key]: command.expected_revision + 1 }, invalid: authority.invalid.filter(key => key !== command.key) };
}

export type LeaderboardOutcome =
  | { kind: "saved" }
  /** `key` was refused, nothing of it was written; `saved` are the rows this save had already written. */
  | { kind: "refused"; error: string; key: LeaderboardSettingKey; saved: readonly LeaderboardSettingKey[] }
  | { kind: "unknown"; key: LeaderboardSettingKey; saved: readonly LeaderboardSettingKey[] };
export type LeaderboardEditorState = {
  /** `null`: no configuration with the four rows was read yet. */
  authority: LeaderboardAuthority | null;
  draft: LeaderboardDraft | null;
  reason: string;
  busy: boolean;
  /** The commands of the save that is running or in doubt; the first is the one in flight or in doubt. Re-sent as these very objects. */
  queue: readonly LeaderboardCommand[];
  /** How often the first command of `queue` was sent. */
  attempts: number;
  /** The rows the running save has written so far. */
  saved: readonly LeaderboardSettingKey[];
  outcome: LeaderboardOutcome | null;
  /** The stored values changed under unsaved edits; the edits were kept and are to be reviewed. */
  rebased: boolean;
};
export const LEADERBOARD_EDITOR_INITIAL: LeaderboardEditorState = {
  authority: null, draft: null, reason: "", busy: false, queue: [], attempts: 0, saved: [], outcome: null, rebased: false,
};

export type LeaderboardEditorAction =
  /** A configuration read answered with the four rows. `force`: the operator asked to replace what is here. */
  | { type: "authority"; authority: LeaderboardAuthority; force: boolean }
  | { type: "edited"; draft: LeaderboardDraft }
  | { type: "reason"; value: string }
  | { type: "saveStarted"; queue: readonly LeaderboardCommand[] }
  | { type: "commandAnswered"; response: unknown };

/** There is something to save: a row whose value differs from what is stored (or whose stored value is invalid). */
export const leaderboardDirty = (state: LeaderboardEditorState): boolean => state.authority !== null && state.draft !== null
  && leaderboardChangedKeys(state.authority, state.draft).length > 0;
/**
 * The operator's hand is on the control: it no longer shows what the stored
 * values show. That includes a new row whose country is not chosen yet, which
 * is nothing to save; it does not include what is to be saved without anyone
 * having edited it (a country stored in one map only, an invalid stored row).
 */
export const leaderboardEdited = (state: LeaderboardEditorState): boolean => state.authority !== null && state.draft !== null
  && JSON.stringify(state.draft) !== JSON.stringify(leaderboardDraft(state.authority.values));
/** Unsaved edits or a command in doubt: what a reload must not silently replace. */
export const leaderboardHold = (state: LeaderboardEditorState): boolean => state.queue.length > 0 || leaderboardEdited(state);
const sameAuthority = (left: LeaderboardAuthority, right: LeaderboardAuthority): boolean => LEADERBOARD_SETTING_KEYS.every(key => left.revisions[key] === right.revisions[key]
  && left.invalid.includes(key) === right.invalid.includes(key) && wireValue(key, left.values) === wireValue(key, right.values));

export function leaderboardEditorReducer(state: LeaderboardEditorState, action: LeaderboardEditorAction): LeaderboardEditorState {
  switch (action.type) {
    case "authority": {
      const stored = { authority: action.authority, draft: leaderboardDraft(action.authority.values), rebased: false };
      // The operator asked for what is stored: the edits, the reason and a command in doubt are dropped.
      if (action.force || state.authority === null || state.draft === null) return { ...LEADERBOARD_EDITOR_INITIAL, ...stored };
      // A command in doubt carries its own revision: nothing moves until it is settled.
      if (state.queue.length > 0) return state;
      if (sameAuthority(state.authority, action.authority)) return state;
      // Unsaved edits stay; they now stand against the newer stored values.
      if (leaderboardHold(state)) return { ...state, authority: action.authority, rebased: true };
      // Nothing was being edited: what is stored replaces what was shown. A refusal that was shown is over.
      return { ...state, ...stored, outcome: state.outcome?.kind === "saved" ? state.outcome : null };
    }
    case "edited":
      if (state.busy || state.queue.length > 0 || state.authority === null) return state;
      return { ...state, draft: action.draft, outcome: state.outcome?.kind === "saved" ? null : state.outcome };
    case "reason": return state.busy || state.queue.length > 0 ? state : { ...state, reason: action.value };
    case "saveStarted": {
      if (state.busy || action.queue.length === 0) return state;
      const retained = state.queue.length > 0 && state.queue[0] === action.queue[0];
      return { ...state, busy: true, outcome: null, rebased: false, queue: action.queue, attempts: retained ? state.attempts + 1 : 1, saved: retained ? state.saved : [] };
    }
    case "commandAnswered": {
      const [command, ...rest] = state.queue;
      if (command === undefined || state.authority === null) return { ...state, busy: false };
      const verdict = leaderboardVerdict(action.response, command, state.attempts > 1);
      if (verdict.kind === "success") {
        const authority = applied(state.authority, command), saved = [...state.saved, command.key];
        // The next command goes out at once, for the first time.
        if (rest.length > 0) return { ...state, authority, saved, queue: rest, attempts: 1 };
        return { ...state, authority, draft: leaderboardDraft(authority.values), saved: [], queue: [], attempts: 0, busy: false, reason: "", outcome: { kind: "saved" } };
      }
      if (verdict.kind === "refused") {
        // Nothing of this command and nothing after it was written; what went before it stays written.
        return { ...state, busy: false, queue: [], attempts: 0, saved: [], outcome: { kind: "refused", error: verdict.error, key: command.key, saved: state.saved } };
      }
      return { ...state, busy: false, outcome: { kind: "unknown", key: command.key, saved: state.saved } };
    }
  }
}

export type LeaderboardSaveBlock = "readOnly" | "clean" | "reason" | LeaderboardDraftIssue;
/** Why nothing can be saved now, or `null`. */
export function leaderboardSaveBlock(state: LeaderboardEditorState, canManage: boolean, known: ReadonlySet<string> | null): LeaderboardSaveBlock | null {
  if (!canManage) return "readOnly";
  // The retained commands are re-sent exactly as they were; nothing on the page can block or change them.
  if (state.queue.length > 0) return null;
  if (state.authority === null || state.draft === null) return "clean";
  const issue = leaderboardDraftIssue(state.draft, known);
  if (issue !== null) return issue;
  if (!leaderboardDirty(state)) return "clean";
  return state.reason.trim().length < LEADERBOARD_REASON_MIN ? "reason" : null;
}

/**
 * The commands the Save button sends: the retained ones while an outcome is
 * in doubt (the same objects, so the same request keys and values), a new plan
 * otherwise. Empty: nothing may be sent.
 */
export function leaderboardSaveQueue(state: LeaderboardEditorState, canManage: boolean, known: ReadonlySet<string> | null, mintKey: () => string): readonly LeaderboardCommand[] {
  if (state.busy || state.authority === null || state.draft === null || leaderboardSaveBlock(state, canManage, known) !== null) return [];
  return state.queue.length > 0 ? state.queue : leaderboardPlan(state.authority, state.draft, state.reason.trim(), mintKey);
}

/** The console's own request shape: every named key and no other. */
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => keys.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => keys.includes(key));
/**
 * The bridge's closed shape for a `dates_configuration_save` of one of the
 * four leaderboard rows; Core still owns authorization, the revision, the
 * audit and the storefront vocabulary. `null`: refused here, nothing is
 * forwarded. `undefined`: another setting or another route - not this
 * function's.
 */
export function normalizeDatesLeaderboardProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (action !== "dates_configuration_save" || !isLeaderboardSettingKey(body.key)) return undefined;
  if (!exactKeys(body, ["key", "value", "expected_revision", "reason", "idempotency_key"])
    || !Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 0
    || typeof body.reason !== "string" || body.reason.trim() !== body.reason
    || body.reason.length < LEADERBOARD_REASON_MIN || body.reason.length > LEADERBOARD_REASON_MAX || /[\x00-\x1f\x7f]/.test(body.reason)
    || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(body.idempotency_key)) return null;
  if (body.key === LEADERBOARD_ENABLED) return bool(body.value) ? body : null;
  if (body.key === LEADERBOARD_SCOPE) return scope(body.value) ? body : null;
  if (typeof body.value !== "string" || body.value.length > 16000) return null;
  let map: unknown;
  try { map = JSON.parse(body.value); } catch { return null; }
  return (body.key === LEADERBOARD_ENABLED_OVERRIDES ? overrides(map, bool, true) : overrides(map, scope, true)) === null ? null : body;
}

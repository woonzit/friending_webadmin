import {
  EVENT_ICON_MAX_COUNT, EVENT_ICON_NAME_MAX, EVENT_ICON_ORDER_MAX, EVENT_ICON_REASON_MIN,
  eventIconSaveOutcome, normalizeEventIconName, validEventIconEmoji, validEventIconOrder, validEventPinColor,
  type DatesEventIcon, type DatesEventIconCatalog,
} from "./datesEventIcons";

/**
 * The state of the event icon editor, without React: what is loaded, what the
 * operator changed, and the one save command that may be in doubt. The
 * component (components/DatesEventIconsConfiguration.tsx) runs this reducer and
 * owns only presentation, so the rules below are the rules the page has:
 *
 * - a catalogue read never replaces unsaved edits or a retained command unless
 *   the operator asked for exactly that (`force`);
 * - a save whose outcome is unknown keeps its command, object and request key,
 *   and the next attempt sends that same command; only a receipt, a refusal
 *   that proves nothing was written, or a forced read of the stored catalogue
 *   releases it;
 * - nothing is sent while a field Core would refuse is invalid.
 */

export type EventIconField = "name_en" | "name_hu" | "emoji" | "order" | "marker_background_color";
export type EventIconProblemCode = "required" | "tooLong" | "invalid";
export type EventIconProblem = { key: string; field: EventIconField; code: EventIconProblemCode };

const graphemes = (value: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;

/** The row as it is sent: exactly the ten contract keys, names and emoji without surrounding whitespace. */
export function eventIconForSave(icon: DatesEventIcon): DatesEventIcon {
  return { key: icon.key, activity_type: icon.activity_type, emoji: icon.emoji.trim(), image_url: icon.image_url,
    marker_background_color: icon.marker_background_color, name_en: normalizeEventIconName(icon.name_en),
    name_hu: normalizeEventIconName(icon.name_hu), enabled: icon.enabled, is_default: icon.is_default, order: icon.order };
}
export const serializeEventIcons = (icons: readonly DatesEventIcon[]): string => JSON.stringify(icons.map(eventIconForSave));

function nameProblem(value: string): EventIconProblemCode | null {
  const name = normalizeEventIconName(value);
  if (name === "") return "required";
  if (/[\x00-\x1f\x7f]/.test(name)) return "invalid";
  return graphemes(name) > EVENT_ICON_NAME_MAX ? "tooLong" : null;
}

/** Every field Core's catalogue validation would refuse, by icon and field. Empty: the catalogue may be sent. */
export function eventIconProblems(icons: readonly DatesEventIcon[]): EventIconProblem[] {
  const problems: EventIconProblem[] = [];
  for (const icon of icons) {
    for (const field of ["name_hu", "name_en"] as const) {
      const code = nameProblem(icon[field]);
      if (code) problems.push({ key: icon.key, field, code });
    }
    const emoji = icon.emoji.trim();
    if (emoji === "" && icon.image_url === null) problems.push({ key: icon.key, field: "emoji", code: "required" });
    else if (!validEventIconEmoji(emoji)) problems.push({ key: icon.key, field: "emoji", code: "invalid" });
    if (!validEventIconOrder(icon.order)) problems.push({ key: icon.key, field: "order", code: "invalid" });
    if (!validEventPinColor(icon.marker_background_color)) problems.push({ key: icon.key, field: "marker_background_color", code: "invalid" });
  }
  return problems;
}

export type EventIconCommand = { icons: string; expected_revision: number; reason: string; idempotency_key: string };
export type EventIconOutcome = { kind: "saved" } | { kind: "refused"; error: string } | { kind: "unknown" };
export type EventIconEditorState = {
  icons: DatesEventIcon[];
  /** `null`: no catalogue was ever read; there is nothing to show or save. */
  revision: number | null;
  /** The loaded catalogue as it would be sent; what `icons` is compared with. */
  baseline: string;
  /** Icons Core has stored: they cannot be removed and their type cannot change. */
  knownKeys: readonly string[];
  selected: string;
  reason: string;
  busy: boolean;
  loadFailed: boolean;
  /** The save command whose outcome is not known yet. Re-sent as this very object. */
  pending: EventIconCommand | null;
  /** How often `pending` was sent. */
  attempts: number;
  outcome: EventIconOutcome | null;
};
export const EVENT_ICON_EDITOR_INITIAL: EventIconEditorState = {
  icons: [], revision: null, baseline: "", knownKeys: [], selected: "", reason: "", busy: false, loadFailed: false, pending: null, attempts: 0, outcome: null,
};

export type EventIconEditorAction =
  | { type: "requestStarted" }
  | { type: "requestFinished" }
  /** A catalogue read answered. `catalog: null`: it could not be read. `force`: the operator asked to replace what is here. */
  | { type: "loaded"; catalog: DatesEventIconCatalog | null; force: boolean }
  | { type: "selected"; key: string }
  | { type: "edited"; key: string; patch: Partial<Omit<DatesEventIcon, "key">> }
  | { type: "added"; key: string; activity_type: DatesEventIcon["activity_type"] }
  | { type: "removed"; key: string }
  | { type: "reason"; value: string }
  | { type: "saveStarted"; command: EventIconCommand }
  | { type: "saveAnswered"; response: unknown };

export const eventIconDirty = (state: EventIconEditorState): boolean => state.revision !== null && serializeEventIcons(state.icons) !== state.baseline;
/** Unsaved edits or a command in doubt: what a reload must not silently replace. */
export const eventIconHold = (state: EventIconEditorState): boolean => state.pending !== null || eventIconDirty(state);

function adopt(state: EventIconEditorState, catalog: DatesEventIconCatalog, outcome: EventIconOutcome | null): EventIconEditorState {
  return { ...state, icons: catalog.icons, revision: catalog.revision, baseline: serializeEventIcons(catalog.icons),
    knownKeys: catalog.icons.map(icon => icon.key), reason: "", pending: null, attempts: 0, loadFailed: false, outcome,
    selected: catalog.icons.some(icon => icon.key === state.selected) ? state.selected : catalog.icons[0]?.key ?? "" };
}

export function eventIconEditorReducer(state: EventIconEditorState, action: EventIconEditorAction): EventIconEditorState {
  switch (action.type) {
    case "requestStarted": return { ...state, busy: true };
    case "requestFinished": return { ...state, busy: false };
    case "loaded": {
      const idle = { ...state, busy: false };
      // A failed read changes nothing: the edits, the retained command and what was shown all stay.
      if (action.catalog === null) return { ...idle, loadFailed: true };
      if (!action.force && eventIconHold(state)) return { ...idle, loadFailed: false };
      return adopt(idle, action.catalog, null);
    }
    case "selected": return state.icons.some(icon => icon.key === action.key) ? { ...state, selected: action.key } : state;
    case "reason": return state.pending !== null ? state : { ...state, reason: action.value };
    case "edited": {
      const target = state.icons.find(icon => icon.key === action.key);
      if (state.pending !== null || !target) return state;
      const patch = { ...action.patch };
      if (state.knownKeys.includes(action.key)) delete patch.activity_type;
      const next = { ...target, ...patch };
      // A disabled icon, or one moved to another type, is not that type's default.
      if (!next.enabled || next.activity_type !== target.activity_type) next.is_default = false;
      const claims = next.is_default && !target.is_default;
      return { ...state, outcome: state.outcome?.kind === "saved" ? null : state.outcome,
        icons: state.icons.map(icon => icon.key === action.key ? next
          : claims && icon.activity_type === next.activity_type && icon.is_default ? { ...icon, is_default: false } : icon) };
    }
    case "added": {
      if (state.pending !== null || state.revision === null || state.icons.length >= EVENT_ICON_MAX_COUNT
        || state.icons.some(icon => icon.key === action.key)) return state;
      const last = Math.max(0, ...state.icons.map(icon => validEventIconOrder(icon.order) ? icon.order : 0));
      return { ...state, selected: action.key, outcome: state.outcome?.kind === "saved" ? null : state.outcome,
        icons: [...state.icons, { key: action.key, activity_type: action.activity_type, emoji: "", image_url: null, marker_background_color: null,
          name_en: "", name_hu: "", enabled: true, is_default: false, order: Math.min(EVENT_ICON_ORDER_MAX, last + 10) }] };
    }
    case "removed": {
      const index = state.icons.findIndex(icon => icon.key === action.key);
      if (state.pending !== null || index < 0 || state.knownKeys.includes(action.key) || state.icons.length < 2) return state;
      const icons = state.icons.filter(icon => icon.key !== action.key);
      return { ...state, icons, selected: state.selected === action.key ? icons[Math.min(index, icons.length - 1)].key : state.selected };
    }
    case "saveStarted":
      return { ...state, busy: true, outcome: null, attempts: state.pending === action.command ? state.attempts + 1 : 1, pending: action.command };
    case "saveAnswered": {
      if (state.pending === null) return { ...state, busy: false };
      // The first attempt is fenced by the revision; a repeat keeps its request key, so only a receipt or a
      // refusal Core raises without writing settles it (lib/datesExternalAdmin.ts, datesCommandOutcome).
      const { receipt, outcome } = eventIconSaveOutcome(action.response, state.pending, state.attempts > 1);
      if (receipt) return adopt({ ...state, busy: false }, receipt, { kind: "saved" });
      if (outcome.kind === "refused") return { ...state, busy: false, pending: null, attempts: 0, outcome: { kind: "refused", error: outcome.error } };
      return { ...state, busy: false, outcome: { kind: "unknown" } };
    }
  }
}

export type EventIconSaveBlock = "readOnly" | "clean" | "problems" | "reason";
/** Why nothing can be saved now, or `null`. `draftInvalid`: a field holds text that is not a value yet (the HEX field). */
export function eventIconSaveBlock(state: EventIconEditorState, canManage: boolean, draftInvalid = false): EventIconSaveBlock | null {
  if (!canManage) return "readOnly";
  // The retained command is re-sent exactly as it was; nothing on the page can block or change it.
  if (state.pending !== null) return null;
  // A half-typed value is the operator's next step even before anything counts as changed.
  if (draftInvalid) return "problems";
  if (!eventIconDirty(state)) return "clean";
  if (eventIconProblems(state.icons).length > 0) return "problems";
  return state.reason.trim().length < EVENT_ICON_REASON_MIN ? "reason" : null;
}

/**
 * The command the Save button sends: the retained one while an outcome is in
 * doubt (the same object, so the same request key and the same catalogue), a
 * new one otherwise. `null`: nothing may be sent.
 */
export function eventIconSaveCommand(state: EventIconEditorState, canManage: boolean, mintKey: () => string, draftInvalid = false): EventIconCommand | null {
  if (state.busy || state.revision === null || eventIconSaveBlock(state, canManage, draftInvalid) !== null) return null;
  return state.pending ?? { icons: serializeEventIcons(state.icons), expected_revision: state.revision, reason: state.reason.trim(), idempotency_key: mintKey() };
}

import { EVENT_ICON_REASON_MIN } from "./datesEventIcons";
import { pinRowProblems, type EventIconField, type EventIconProblemCode } from "./datesEventIconEditor";
import {
  externalPinSaveOutcome, serializeExternalPins, validExternalPinDefaultColor,
  type DatesExternalPin, type DatesExternalPinCatalog, type DatesExternalPinFields,
} from "./datesExternalPins";

/**
 * The state of the third-party pin editor, without React: what is loaded, what
 * the operator changed, and the one save command that may be in doubt. The
 * component (components/DatesExternalPinsConfiguration.tsx) runs this reducer
 * and owns only presentation. The rules are those of the member icon editor
 * (lib/datesEventIconEditor.ts):
 *
 * - a catalogue read never replaces unsaved edits or a retained command unless
 *   the operator asked for exactly that (`force`);
 * - a save whose outcome is unknown keeps its command, object and request key,
 *   and the next attempt sends that same command; only a receipt, a refusal
 *   that proves nothing was written, or a forced read of the stored catalogue
 *   releases it;
 * - nothing is sent while a field Core would refuse is invalid.
 *
 * What differs is the catalogue: the eleven types are fixed, so there is
 * nothing to add, remove, disable or make a default; and the catalogue has one
 * field of its own, the colour of every pin without a colour of its own.
 */

export type ExternalPinProblem = { key: string; field: EventIconField; code: EventIconProblemCode };
/** Every field Core's catalogue validation would refuse, by type and field. Empty: the catalogue may be sent. */
export function externalPinProblems(pins: readonly DatesExternalPinFields[]): ExternalPinProblem[] {
  return pins.flatMap(pin => pinRowProblems(pin).map(problem => ({ key: pin.key, ...problem })));
}

export type ExternalPinCommand = { pins: string; default_marker_background_color: string; expected_revision: number; reason: string; idempotency_key: string };
export type ExternalPinOutcome = { kind: "saved" } | { kind: "refused"; error: string } | { kind: "unknown" };
export type ExternalPinEditorState = {
  pins: DatesExternalPin[];
  /** The catalogue's default colour as it is edited: always a colour (a half-typed one stays in the field). */
  defaultColor: string;
  /** `null`: no catalogue was ever read; there is nothing to show or save. */
  revision: number | null;
  /** The loaded catalogue as it would be sent; what the rows and the default colour are compared with. */
  baseline: string;
  selected: string;
  reason: string;
  busy: boolean;
  loadFailed: boolean;
  /** The save command whose outcome is not known yet. Re-sent as this very object. */
  pending: ExternalPinCommand | null;
  /** How often `pending` was sent. */
  attempts: number;
  outcome: ExternalPinOutcome | null;
};
export const EXTERNAL_PIN_EDITOR_INITIAL: ExternalPinEditorState = {
  pins: [], defaultColor: "", revision: null, baseline: "", selected: "", reason: "", busy: false, loadFailed: false, pending: null, attempts: 0, outcome: null,
};

export type ExternalPinEditorAction =
  | { type: "requestStarted" }
  | { type: "requestFinished" }
  /** A catalogue read answered. `catalog: null`: it could not be read. `force`: the operator asked to replace what is here. */
  | { type: "loaded"; catalog: DatesExternalPinCatalog | null; force: boolean }
  | { type: "selected"; key: string }
  | { type: "edited"; key: string; patch: Partial<Omit<DatesExternalPinFields, "key">> }
  | { type: "defaultColor"; value: string }
  | { type: "reason"; value: string }
  | { type: "saveStarted"; command: ExternalPinCommand }
  | { type: "saveAnswered"; response: unknown };

const serialize = (pins: readonly DatesExternalPinFields[], defaultColor: string): string => `${defaultColor} ${serializeExternalPins(pins)}`;
export const externalPinDirty = (state: ExternalPinEditorState): boolean => state.revision !== null && serialize(state.pins, state.defaultColor) !== state.baseline;
/** Unsaved edits or a command in doubt: what a reload must not silently replace. */
export const externalPinHold = (state: ExternalPinEditorState): boolean => state.pending !== null || externalPinDirty(state);

function adopt(state: ExternalPinEditorState, catalog: DatesExternalPinCatalog, outcome: ExternalPinOutcome | null): ExternalPinEditorState {
  return { ...state, pins: catalog.pins, defaultColor: catalog.default_marker_background_color, revision: catalog.revision,
    baseline: serialize(catalog.pins, catalog.default_marker_background_color), reason: "", pending: null, attempts: 0, loadFailed: false, outcome,
    selected: catalog.pins.some(pin => pin.key === state.selected) ? state.selected : catalog.pins[0]?.key ?? "" };
}
/** An edit ends the "saved" notice; a refusal stays until the next save. */
const afterEdit = (outcome: ExternalPinOutcome | null) => outcome?.kind === "saved" ? null : outcome;

export function externalPinEditorReducer(state: ExternalPinEditorState, action: ExternalPinEditorAction): ExternalPinEditorState {
  switch (action.type) {
    case "requestStarted": return { ...state, busy: true };
    case "requestFinished": return { ...state, busy: false };
    case "loaded": {
      const idle = { ...state, busy: false };
      // A failed read changes nothing: the edits, the retained command and what was shown all stay.
      if (action.catalog === null) return { ...idle, loadFailed: true };
      if (!action.force && externalPinHold(state)) return { ...idle, loadFailed: false };
      return adopt(idle, action.catalog, null);
    }
    case "selected": return state.pins.some(pin => pin.key === action.key) ? { ...state, selected: action.key } : state;
    case "reason": return state.pending !== null ? state : { ...state, reason: action.value };
    case "edited": {
      const target = state.pins.find(pin => pin.key === action.key);
      if (state.pending !== null || !target) return state;
      // Only the editable fields: the type and the categories it covers are Core's.
      const { emoji, image_url, marker_background_color, name_en, name_hu, order } = { ...target, ...action.patch };
      const next = { ...target, emoji, image_url, marker_background_color, name_en, name_hu, order };
      return { ...state, outcome: afterEdit(state.outcome), pins: state.pins.map(pin => pin.key === action.key ? next : pin) };
    }
    case "defaultColor":
      // The default is never absent: only a whole colour replaces it.
      if (state.pending !== null || state.revision === null || !validExternalPinDefaultColor(action.value)) return state;
      return { ...state, outcome: afterEdit(state.outcome), defaultColor: action.value };
    case "saveStarted":
      return { ...state, busy: true, outcome: null, attempts: state.pending === action.command ? state.attempts + 1 : 1, pending: action.command };
    case "saveAnswered": {
      if (state.pending === null) return { ...state, busy: false };
      // The first attempt is fenced by the revision; a repeat keeps its request key, so only a receipt or a
      // refusal Core raises without writing settles it (lib/datesExternalAdmin.ts, datesCommandOutcome).
      const { receipt, outcome } = externalPinSaveOutcome(action.response, state.pending, state.attempts > 1);
      if (receipt) return adopt({ ...state, busy: false }, receipt, { kind: "saved" });
      if (outcome.kind === "refused") return { ...state, busy: false, pending: null, attempts: 0, outcome: { kind: "refused", error: outcome.error } };
      return { ...state, busy: false, outcome: { kind: "unknown" } };
    }
  }
}

export type ExternalPinSaveBlock = "readOnly" | "clean" | "problems" | "reason";
/** Why nothing can be saved now, or `null`. `draftInvalid`: a field holds text that is not a value yet (a HEX field). */
export function externalPinSaveBlock(state: ExternalPinEditorState, canManage: boolean, draftInvalid = false): ExternalPinSaveBlock | null {
  if (!canManage) return "readOnly";
  // The retained command is re-sent exactly as it was; nothing on the page can block or change it.
  if (state.pending !== null) return null;
  // A half-typed value is the operator's next step even before anything counts as changed.
  if (draftInvalid) return "problems";
  if (!externalPinDirty(state)) return "clean";
  if (externalPinProblems(state.pins).length > 0) return "problems";
  return state.reason.trim().length < EVENT_ICON_REASON_MIN ? "reason" : null;
}

/**
 * The command the Save button sends: the retained one while an outcome is in
 * doubt (the same object, so the same request key and the same catalogue), a
 * new one otherwise. `null`: nothing may be sent.
 */
export function externalPinSaveCommand(state: ExternalPinEditorState, canManage: boolean, mintKey: () => string, draftInvalid = false): ExternalPinCommand | null {
  if (state.busy || state.revision === null || externalPinSaveBlock(state, canManage, draftInvalid) !== null) return null;
  return state.pending ?? { pins: serializeExternalPins(state.pins), default_marker_background_color: state.defaultColor,
    expected_revision: state.revision, reason: state.reason.trim(), idempotency_key: mintKey() };
}

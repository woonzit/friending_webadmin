import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { policyActor, policyExactObject, policyInteger, type PolicyJsonObject } from "@/lib/policyWire";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/**
 * The operator's Friending Start setting: which of the two in-person methods
 * may make two members friends. Friendship is made only in the app's Friending
 * Start screen, by a method that is enabled here:
 *
 * - `radar_enabled`: both members open Friending Start and tap each other in
 *   the list of people nearby (found over Bluetooth and the local network);
 * - `touch_enabled`: both members open Friending Start and touch their phones
 *   together (on iPhone: the two phones are in radio range and register a bump
 *   at the same moment - not NFC, which iOS does not offer to apps between two
 *   phones).
 *
 * Core stores the setting, serves it to the apps in their configuration and
 * refuses a method that is switched off. At least one method is always on:
 * Core refuses a save with both off, and this console never sends one.
 *
 * Modelled end to end on lib/locationAccessPolicy.ts (same envelope, same
 * compare-and-set revision, same Core-authored `can_write`). Pure: no
 * `server-only` import, so the proxy normalizes bodies with the same module the
 * browser decodes with and the tests exercise it under plain Node.
 *
 * Core's two Webadmin actions:
 * - `friending_start_policy` reads `{configuration, can_write}`; a store Core
 *   cannot read is `503 friending-start-policy-unavailable`, never a guess.
 * - `save_friending_start_policy` takes `expected_revision` plus exactly
 *   `{schema_version, radar_enabled, touch_enabled}`; it is a compare-and-set
 *   (`409` on a stale revision), and both methods off is `422`.
 */
export const FRIENDING_START_POLICY_SCHEMA_VERSION = 1 as const;
export const FRIENDING_START_POLICY_ACTIONS = [
  "friending_start_policy",
  "save_friending_start_policy",
] as const;
/** The two methods, in the order Core serves and the panel renders them. */
export const FRIENDING_START_METHODS = [
  "radar_enabled",
  "touch_enabled",
] as const;
export const FRIENDING_START_POLICY_REVISION_MAX = 2_147_483_647 as const;
/** The saver's e-mail, bounded as Core bounds an actor: UTF-8 bytes. */
export const FRIENDING_START_POLICY_ACTOR_MAX_BYTES = 320 as const;

export type FriendingStartPolicyAction = (typeof FRIENDING_START_POLICY_ACTIONS)[number];
export type FriendingStartMethod = (typeof FRIENDING_START_METHODS)[number];

/** What the operator edits: the two switches and nothing else. */
export type FriendingStartPolicyDraft = Record<FriendingStartMethod, boolean>;

export type FriendingStartPolicyConfiguration = FriendingStartPolicyDraft & {
  schema_version: typeof FRIENDING_START_POLICY_SCHEMA_VERSION;
  revision: number;
  updated_at: number;
  updated_by: string;
};

export type FriendingStartPolicyState = {
  configuration: FriendingStartPolicyConfiguration;
  /** Core's own answer for this actor; the console never reconstructs it from a role. */
  can_write: boolean;
};

export type FriendingStartPolicySaveBody = {
  expected_revision: number;
  configuration: FriendingStartPolicyDraft & {
    schema_version: typeof FRIENDING_START_POLICY_SCHEMA_VERSION;
  };
};

const CONFIGURATION_KEYS = [
  "schema_version",
  "revision",
  "radar_enabled",
  "touch_enabled",
  "updated_at",
  "updated_by",
] as const;
const CANDIDATE_KEYS = ["schema_version", ...FRIENDING_START_METHODS] as const;

/** A setting members can make friends with: at least one method is on. */
export function friendingStartPolicyUsable(draft: FriendingStartPolicyDraft): boolean {
  return FRIENDING_START_METHODS.some((method) => draft[method]);
}

function configurationShape(value: unknown): FriendingStartPolicyConfiguration | null {
  const source = policyExactObject(value, CONFIGURATION_KEYS);
  const revision = policyInteger(source?.revision, 0, FRIENDING_START_POLICY_REVISION_MAX);
  const updatedAt = policyInteger(source?.updated_at);
  const updatedBy = policyActor(source?.updated_by, FRIENDING_START_POLICY_ACTOR_MAX_BYTES);
  if (!source || source.schema_version !== FRIENDING_START_POLICY_SCHEMA_VERSION
    || revision === null || updatedAt === null || updatedBy === null
    || typeof source.radar_enabled !== "boolean"
    || typeof source.touch_enabled !== "boolean") return null;
  // Core refuses to store both methods off, so a body that says so is not a
  // state it can serve: it is refused rather than shown as "nothing enabled".
  if (!source.radar_enabled && !source.touch_enabled) return null;
  // Revision 0 exists only as Core's compiled default, before any save: both
  // methods on and nobody named. A stored row always carries revision 1 or
  // more, so a revision 0 with anything else is refused rather than displayed.
  if (revision === 0 && (updatedAt !== 0 || updatedBy !== ""
    || !source.radar_enabled || !source.touch_enabled)) return null;
  return {
    schema_version: FRIENDING_START_POLICY_SCHEMA_VERSION,
    revision,
    radar_enabled: source.radar_enabled,
    touch_enabled: source.touch_enabled,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

/**
 * The console read (and a successful save, which answers the same shape).
 * Anything short of the complete legacy envelope with exactly
 * `{configuration, can_write}` is refused - the `friending_start` block of the
 * app configuration included - so a partial or foreign body can never render as
 * an editable setting.
 */
export function friendingStartPolicyStateResponse(value: unknown): FriendingStartPolicyState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = policyExactObject(envelope?.data, ["configuration", "can_write"]);
  const configuration = configurationShape(data?.configuration);
  return data && configuration && typeof data.can_write === "boolean"
    ? { configuration, can_write: data.can_write }
    : null;
}

/**
 * Every refusal this pair of actions is known to produce, with the logical
 * status it must carry. The first block is the same-origin bridge and
 * `coreCall`, the second is Core's actor gate, the third is the policy
 * controller.
 */
export const FRIENDING_START_POLICY_ERROR_STATUSES: Readonly<Record<string, number>> = {
  unauthorized: 401,
  "auth-required": 401,
  "bad-origin": 403,
  "not-found": 404,
  "admin-write-required": 403,
  "invalid-input": 400,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
  "invalid-core-response": 502,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "friending-start-policy-invalid": 422,
  "friending-start-policy-conflict": 409,
  "friending-start-policy-unavailable": 503,
};

/** A recognised refusal whose error and logical status agree, or null. */
export function friendingStartPolicyError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && Object.hasOwn(FRIENDING_START_POLICY_ERROR_STATUSES, error)
    && FRIENDING_START_POLICY_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

/**
 * Core, or the path to it, failed: a complete refusal - Core's or the bridge's
 * - under a 5xx status, whatever it is called. A failure this console has no
 * name for (the bridge's unconfirmed membership, a refusal Core adds later)
 * is still "nothing is known", never "refused".
 */
function serverSideFailure(value: unknown): boolean {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  return envelope !== null && envelope.status_code >= 500;
}

export type FriendingStartPolicyReadOutcome =
  | { kind: "ready"; state: FriendingStartPolicyState }
  /** Core or the path to it failed (5xx, or no answer at all): nothing is known. */
  | { kind: "unavailable" }
  /** Core answered, but not with a state this console can trust. */
  | { kind: "error" };

export function friendingStartPolicyReadOutcome(response: unknown): FriendingStartPolicyReadOutcome {
  const state = friendingStartPolicyStateResponse(response);
  if (state) return { kind: "ready", state };
  // `adminCall` answers null when the request never produced a readable body.
  if (response === null || response === undefined) return { kind: "unavailable" };
  return serverSideFailure(response) ? { kind: "unavailable" } : { kind: "error" };
}

export type FriendingStartPolicySaveOutcome =
  | { kind: "saved"; state: FriendingStartPolicyState; changed: boolean }
  /** `409`: the revision moved underneath this draft. */
  | { kind: "conflict" }
  /** 5xx or no answer: the save is not confirmed either way. */
  | { kind: "unavailable" }
  /** `403 admin-write-required`, from the bridge floor or from Core. */
  | { kind: "writeRequired" }
  /** `422` from Core (both methods off, among others) or `400` from the bridge. */
  | { kind: "invalid" }
  /** A success that is malformed or does not match the request, or an unknown refusal. */
  | { kind: "unexpected" };

/**
 * Classify a save answer against the exact command that was sent. A success
 * counts only when it proves this command: the requested switches at the
 * one-step revision, or at the same revision for a save that changed nothing.
 */
export function friendingStartPolicySaveOutcome(
  response: unknown,
  sent: FriendingStartPolicySaveBody,
): FriendingStartPolicySaveOutcome {
  const state = friendingStartPolicyStateResponse(response);
  if (state) {
    const matches = FRIENDING_START_METHODS.every(
      (method) => state.configuration[method] === sent.configuration[method],
    );
    const revision = state.configuration.revision;
    if (matches && revision === sent.expected_revision + 1) {
      return { kind: "saved", state, changed: true };
    }
    if (matches && revision === sent.expected_revision) {
      return { kind: "saved", state, changed: false };
    }
    return { kind: "unexpected" };
  }
  if (response === null || response === undefined) return { kind: "unavailable" };
  const error = friendingStartPolicyError(response);
  if (error === "friending-start-policy-conflict") return { kind: "conflict" };
  if (error === "admin-write-required") return { kind: "writeRequired" };
  if (error === "friending-start-policy-invalid" || error === "invalid-input") return { kind: "invalid" };
  if (serverSideFailure(response)) return { kind: "unavailable" };
  return { kind: "unexpected" };
}

export function friendingStartPolicyDraftFrom(
  configuration: FriendingStartPolicyConfiguration,
): FriendingStartPolicyDraft {
  return {
    radar_enabled: configuration.radar_enabled,
    touch_enabled: configuration.touch_enabled,
  };
}

export function friendingStartPolicyDirty(
  configuration: FriendingStartPolicyConfiguration,
  draft: FriendingStartPolicyDraft,
): boolean {
  return FRIENDING_START_METHODS.some((method) => configuration[method] !== draft[method]);
}

/** Methods the draft turns OFF relative to the stored setting; each one takes a way to make friends away and needs a confirmation. */
export function friendingStartPolicyNewlyDisabled(
  configuration: FriendingStartPolicyConfiguration,
  draft: FriendingStartPolicyDraft,
): FriendingStartMethod[] {
  return FRIENDING_START_METHODS.filter((method) => configuration[method] && !draft[method]);
}

/** The exact command Core accepts: the stored revision and the three candidate keys. */
export function friendingStartPolicySaveBody(
  expectedRevision: number,
  draft: FriendingStartPolicyDraft,
): FriendingStartPolicySaveBody {
  return {
    expected_revision: expectedRevision,
    configuration: {
      schema_version: FRIENDING_START_POLICY_SCHEMA_VERSION,
      radar_enabled: draft.radar_enabled,
      touch_enabled: draft.touch_enabled,
    },
  };
}

/**
 * `undefined` is another family, `null` is refused, and only a rebuilt exact
 * object may reach Core. The read carries nothing but the server-owned actor;
 * the save carries exactly the revision and the three candidate keys, and
 * `coreCall` JSON-encodes `configuration` into one form field. Both methods
 * off is refused here as it is by Core: a request that cannot be stored is
 * not forwarded.
 */
export function normalizeFriendingStartPolicyProxyBody(
  action: string,
  body: PolicyJsonObject,
): PolicyJsonObject | null | undefined {
  if (!(FRIENDING_START_POLICY_ACTIONS as readonly string[]).includes(action)) return undefined;
  if (action === "friending_start_policy") {
    return policyExactObject(body, []) ? Object.create(null) as PolicyJsonObject : null;
  }
  const source = policyExactObject(body, ["expected_revision", "configuration"]);
  const revision = policyInteger(source?.expected_revision, 0, FRIENDING_START_POLICY_REVISION_MAX);
  const candidate = policyExactObject(source?.configuration, CANDIDATE_KEYS);
  if (revision === null || !candidate
    || candidate.schema_version !== FRIENDING_START_POLICY_SCHEMA_VERSION
    || typeof candidate.radar_enabled !== "boolean"
    || typeof candidate.touch_enabled !== "boolean") return null;
  const draft = { radar_enabled: candidate.radar_enabled, touch_enabled: candidate.touch_enabled };
  if (!friendingStartPolicyUsable(draft)) return null;
  return Object.assign(Object.create(null), friendingStartPolicySaveBody(revision, draft)) as PolicyJsonObject;
}

// ------------------------------------------------------------ panel state

export type FriendingStartPolicyNotice =
  | { tone: "success"; key: "saved"; revision: number }
  | { tone: "success"; key: "unchanged" }
  | { tone: "error"; key: "conflict"; revision: number }
  | { tone: "error"; key: "conflictReloadFailed" }
  | { tone: "error"; key: "notConfirmed" }
  | { tone: "error"; key: "writeRequired" }
  | { tone: "error"; key: "invalid" }
  | { tone: "error"; key: "unexpected" };

export type FriendingStartPolicyModel = {
  phase: "loading" | "ready" | "unavailable" | "error";
  stored: FriendingStartPolicyState | null;
  draft: FriendingStartPolicyDraft | null;
  busy: boolean;
  notice: FriendingStartPolicyNotice | null;
};

export type FriendingStartPolicyEvent =
  | { type: "loadStarted" }
  | { type: "loaded"; outcome: FriendingStartPolicyReadOutcome }
  | { type: "toggled"; method: FriendingStartMethod; value: boolean }
  | { type: "discarded" }
  | { type: "saveStarted" }
  | { type: "saveFinished"; outcome: FriendingStartPolicySaveOutcome }
  /** The follow-up read after a `409`, which keeps the draft either way. */
  | { type: "conflictReloaded"; outcome: FriendingStartPolicyReadOutcome };

export const FRIENDING_START_POLICY_INITIAL_MODEL: FriendingStartPolicyModel = {
  phase: "loading",
  stored: null,
  draft: null,
  busy: false,
  notice: null,
};

/** Whether the panel may offer a save at all: Core said this actor can write. */
export function friendingStartPolicyCanSave(model: FriendingStartPolicyModel): boolean {
  return model.phase === "ready" && model.stored?.can_write === true && model.draft !== null;
}

/**
 * The draft can be sent: this actor may write, something differs from what is
 * stored, and at least one method stays on. A draft with both methods off is a
 * step on the way from one method to the other - it may be on the screen, it is
 * never a command.
 */
export function friendingStartPolicySendable(model: FriendingStartPolicyModel): boolean {
  return friendingStartPolicyCanSave(model) && !model.busy && model.stored !== null && model.draft !== null
    && friendingStartPolicyDirty(model.stored.configuration, model.draft)
    && friendingStartPolicyUsable(model.draft);
}

/**
 * The panel's whole state machine, kept pure so every transition is tested
 * without a browser. The rule it exists for: an operator's unsaved choices are
 * never thrown away by a save that did not land. Only an explicit reload or
 * discard, or a confirmed save, replaces the draft.
 */
export function friendingStartPolicyReducer(
  model: FriendingStartPolicyModel,
  event: FriendingStartPolicyEvent,
): FriendingStartPolicyModel {
  switch (event.type) {
    case "loadStarted":
      return { ...model, phase: "loading", busy: true, notice: null };
    case "loaded":
      if (event.outcome.kind === "ready") {
        return {
          phase: "ready",
          stored: event.outcome.state,
          draft: friendingStartPolicyDraftFrom(event.outcome.state.configuration),
          busy: false,
          notice: null,
        };
      }
      return { phase: event.outcome.kind, stored: null, draft: null, busy: false, notice: null };
    case "toggled":
      if (!friendingStartPolicyCanSave(model) || model.busy || !model.draft) return model;
      return {
        ...model,
        draft: { ...model.draft, [event.method]: event.value },
        // A conflict notice explains what the switches show; anything else is stale now.
        notice: model.notice?.key === "conflict" ? model.notice : null,
      };
    case "discarded":
      if (!model.stored || model.busy) return model;
      return {
        ...model,
        draft: friendingStartPolicyDraftFrom(model.stored.configuration),
        notice: null,
      };
    case "saveStarted":
      // Both methods off is never sent: the panel says why, and nothing starts.
      return friendingStartPolicySendable(model) ? { ...model, busy: true, notice: null } : model;
    case "saveFinished": {
      const outcome = event.outcome;
      if (outcome.kind === "saved") {
        return {
          phase: "ready",
          stored: outcome.state,
          draft: friendingStartPolicyDraftFrom(outcome.state.configuration),
          busy: false,
          notice: outcome.changed
            ? { tone: "success", key: "saved", revision: outcome.state.configuration.revision }
            : { tone: "success", key: "unchanged" },
        };
      }
      if (outcome.kind === "conflict") {
        // Still busy: the caller reads the new revision next (`conflictReloaded`),
        // and the draft stays exactly as the operator left it.
        return { ...model, busy: true, notice: null };
      }
      if (outcome.kind === "writeRequired" && model.stored) {
        // Core says this actor can no longer write: show what is stored, read-only.
        return {
          ...model,
          stored: { ...model.stored, can_write: false },
          draft: friendingStartPolicyDraftFrom(model.stored.configuration),
          busy: false,
          notice: { tone: "error", key: "writeRequired" },
        };
      }
      const key = outcome.kind === "unavailable" ? "notConfirmed"
        : outcome.kind === "invalid" ? "invalid"
          : outcome.kind === "writeRequired" ? "writeRequired"
            : "unexpected";
      return { ...model, busy: false, notice: { tone: "error", key } };
    }
    case "conflictReloaded":
      if (event.outcome.kind === "ready") {
        const state = event.outcome.state;
        // Adopt the new authoritative revision under the operator's draft, so
        // the next save is an informed overwrite rather than a second 409. An
        // actor who lost write access meanwhile sees the stored values instead.
        return {
          phase: "ready",
          stored: state,
          draft: state.can_write && model.draft
            ? model.draft
            : friendingStartPolicyDraftFrom(state.configuration),
          busy: false,
          notice: state.can_write
            ? { tone: "error", key: "conflict", revision: state.configuration.revision }
            : { tone: "error", key: "writeRequired" },
        };
      }
      return { ...model, busy: false, notice: { tone: "error", key: "conflictReloadFailed" } };
    default:
      return model;
  }
}

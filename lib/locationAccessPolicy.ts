import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/**
 * The operator's device-location access policy (P-073 Part B): whether a
 * compatible app must hold a device location before nearby discovery and
 * before signup. It is client UX policy only; Core stores and serves it and
 * enforces nothing with it.
 *
 * Pure: no `server-only` import, so the proxy normalizes bodies with the same
 * module the browser decodes with and the tests exercise it under plain Node.
 * Pinned on Core's `tests/fixtures/location_access_policy_wire.json`, copied
 * byte-identical into this repository's `tests/fixtures`.
 *
 * Core's two Webadmin actions:
 * - `location_access_policy` reads `{configuration, can_write}`; a malformed
 *   store is `503 location-access-policy-unavailable`, never an all-off guess.
 * - `save_location_access_policy` takes `expected_revision` plus exactly
 *   `{schema_version, required_for_nearby, required_for_signup}`; it is a
 *   compare-and-set (`409` on a stale revision) audited in the same
 *   transaction, and an unchanged save returns the current state unaudited.
 */
export const LOCATION_ACCESS_POLICY_SCHEMA_VERSION = 1 as const;
export const LOCATION_ACCESS_POLICY_ACTIONS = [
  "location_access_policy",
  "save_location_access_policy",
] as const;
/** The two independent switches, in the order Core serves and the panel renders them. */
export const LOCATION_ACCESS_POLICY_FLAGS = [
  "required_for_nearby",
  "required_for_signup",
] as const;
export const LOCATION_ACCESS_POLICY_REVISION_MAX = 2_147_483_647 as const;
/** Core's `LocationAccessPolicy::MAX_ACTOR_BYTES`, measured in UTF-8 bytes. */
export const LOCATION_ACCESS_POLICY_ACTOR_MAX_BYTES = 320 as const;

export type LocationAccessPolicyAction = (typeof LOCATION_ACCESS_POLICY_ACTIONS)[number];
export type LocationAccessPolicyFlag = (typeof LOCATION_ACCESS_POLICY_FLAGS)[number];

/** What the operator edits: the two switches and nothing else. */
export type LocationAccessPolicyDraft = Record<LocationAccessPolicyFlag, boolean>;

export type LocationAccessPolicyConfiguration = LocationAccessPolicyDraft & {
  schema_version: typeof LOCATION_ACCESS_POLICY_SCHEMA_VERSION;
  revision: number;
  updated_at: number;
  updated_by: string;
};

export type LocationAccessPolicyState = {
  configuration: LocationAccessPolicyConfiguration;
  /** Core's own answer for this actor; the console never reconstructs it from a role. */
  can_write: boolean;
};

export type LocationAccessPolicySaveBody = {
  expected_revision: number;
  configuration: LocationAccessPolicyDraft & {
    schema_version: typeof LOCATION_ACCESS_POLICY_SCHEMA_VERSION;
  };
};

type JsonObject = Record<string, unknown>;

const CONFIGURATION_KEYS = [
  "schema_version",
  "revision",
  "required_for_nearby",
  "required_for_signup",
  "updated_at",
  "updated_by",
] as const;
const CANDIDATE_KEYS = ["schema_version", ...LOCATION_ACCESS_POLICY_FLAGS] as const;
const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

/** Exact key sets: Core states them as the contract, so an extra key is a provider change. */
function exactObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? source
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum
    ? value
    : null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** The saver's e-mail as Core stores it: trimmed, control-free, at most 320 UTF-8 bytes. */
function actor(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()
    || hasUnpairedSurrogate(value) || PLAIN_TEXT_CONTROL.test(value)) return null;
  return new TextEncoder().encode(value).length <= LOCATION_ACCESS_POLICY_ACTOR_MAX_BYTES
    ? value
    : null;
}

function configurationShape(value: unknown): LocationAccessPolicyConfiguration | null {
  const source = exactObject(value, CONFIGURATION_KEYS);
  const revision = integer(source?.revision, 0, LOCATION_ACCESS_POLICY_REVISION_MAX);
  const updatedAt = integer(source?.updated_at);
  const updatedBy = actor(source?.updated_by);
  if (!source || source.schema_version !== LOCATION_ACCESS_POLICY_SCHEMA_VERSION
    || revision === null || updatedAt === null || updatedBy === null
    || typeof source.required_for_nearby !== "boolean"
    || typeof source.required_for_signup !== "boolean") return null;
  // Revision 0 exists only as Core's compiled default (`LocationAccessPolicy::
  // defaults()`): both switches off and nobody named. A stored row always
  // carries revision 1 or more, so a revision 0 with anything else set is not a
  // state Core can serve and is refused rather than displayed.
  if (revision === 0 && (updatedAt !== 0 || updatedBy !== ""
    || source.required_for_nearby || source.required_for_signup)) return null;
  return {
    schema_version: LOCATION_ACCESS_POLICY_SCHEMA_VERSION,
    revision,
    required_for_nearby: source.required_for_nearby,
    required_for_signup: source.required_for_signup,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

/**
 * The console read (and a successful save, which answers the same shape).
 * Anything short of the complete legacy envelope with exactly
 * `{configuration, can_write}` is refused, including Core's public
 * `/v1/app/location_access_policy` projection, so a partial or foreign body
 * can never render as an editable all-off policy.
 */
export function locationAccessPolicyStateResponse(value: unknown): LocationAccessPolicyState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = exactObject(envelope?.data, ["configuration", "can_write"]);
  const configuration = configurationShape(data?.configuration);
  return data && configuration && typeof data.can_write === "boolean"
    ? { configuration, can_write: data.can_write }
    : null;
}

/**
 * Every refusal this pair of actions can produce, with the logical status it
 * must carry. The first block is the same-origin bridge and `coreCall`, the
 * second is Core's actor gate, the third is the policy controller.
 */
export const LOCATION_ACCESS_POLICY_ERROR_STATUSES: Readonly<Record<string, number>> = {
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
  "location-access-policy-invalid": 422,
  "location-access-policy-conflict": 409,
  "location-access-policy-revision-exhausted": 503,
  "location-access-policy-unavailable": 503,
};

/** A recognised refusal whose error and logical status agree, or null. */
export function locationAccessPolicyError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && Object.hasOwn(LOCATION_ACCESS_POLICY_ERROR_STATUSES, error)
    && LOCATION_ACCESS_POLICY_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

function serverSideFailure(error: string | null): boolean {
  return error !== null && LOCATION_ACCESS_POLICY_ERROR_STATUSES[error] >= 500;
}

export type LocationAccessPolicyReadOutcome =
  | { kind: "ready"; state: LocationAccessPolicyState }
  /** Core or the path to it failed (5xx, or no answer at all): nothing is known. */
  | { kind: "unavailable" }
  /** Core answered, but not with a state this console can trust. */
  | { kind: "error" };

export function locationAccessPolicyReadOutcome(response: unknown): LocationAccessPolicyReadOutcome {
  const state = locationAccessPolicyStateResponse(response);
  if (state) return { kind: "ready", state };
  // `adminCall` answers null when the request never produced a readable body.
  if (response === null || response === undefined) return { kind: "unavailable" };
  return serverSideFailure(locationAccessPolicyError(response))
    ? { kind: "unavailable" }
    : { kind: "error" };
}

export type LocationAccessPolicySaveOutcome =
  | { kind: "saved"; state: LocationAccessPolicyState; changed: boolean }
  /** `409`: the revision moved underneath this draft. */
  | { kind: "conflict" }
  /** 5xx or no answer: the save is not confirmed either way. */
  | { kind: "unavailable" }
  /** `403 admin-write-required`, from the bridge floor or from Core. */
  | { kind: "writeRequired" }
  /** `422` from Core or `400` from the bridge. */
  | { kind: "invalid" }
  /** A success that is malformed or does not match the request, or an unknown refusal. */
  | { kind: "unexpected" };

/**
 * Classify a save answer against the exact command that was sent. A success
 * counts only when it proves this command: the requested switches at the
 * one-step revision, or at the same revision for Core's unaudited no-op.
 */
export function locationAccessPolicySaveOutcome(
  response: unknown,
  sent: LocationAccessPolicySaveBody,
): LocationAccessPolicySaveOutcome {
  const state = locationAccessPolicyStateResponse(response);
  if (state) {
    const matches = LOCATION_ACCESS_POLICY_FLAGS.every(
      (flag) => state.configuration[flag] === sent.configuration[flag],
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
  const error = locationAccessPolicyError(response);
  if (error === "location-access-policy-conflict") return { kind: "conflict" };
  if (error === "admin-write-required") return { kind: "writeRequired" };
  if (error === "location-access-policy-invalid" || error === "invalid-input") return { kind: "invalid" };
  if (serverSideFailure(error)) return { kind: "unavailable" };
  return { kind: "unexpected" };
}

export function locationAccessPolicyDraftFrom(
  configuration: LocationAccessPolicyConfiguration,
): LocationAccessPolicyDraft {
  return {
    required_for_nearby: configuration.required_for_nearby,
    required_for_signup: configuration.required_for_signup,
  };
}

export function locationAccessPolicyDirty(
  configuration: LocationAccessPolicyConfiguration,
  draft: LocationAccessPolicyDraft,
): boolean {
  return LOCATION_ACCESS_POLICY_FLAGS.some((flag) => configuration[flag] !== draft[flag]);
}

/** Switches the draft turns ON relative to the stored policy; each one needs a confirmation. */
export function locationAccessPolicyNewlyRequired(
  configuration: LocationAccessPolicyConfiguration,
  draft: LocationAccessPolicyDraft,
): LocationAccessPolicyFlag[] {
  return LOCATION_ACCESS_POLICY_FLAGS.filter((flag) => draft[flag] && !configuration[flag]);
}

/** The exact command Core accepts: the stored revision and the three candidate keys. */
export function locationAccessPolicySaveBody(
  expectedRevision: number,
  draft: LocationAccessPolicyDraft,
): LocationAccessPolicySaveBody {
  return {
    expected_revision: expectedRevision,
    configuration: {
      schema_version: LOCATION_ACCESS_POLICY_SCHEMA_VERSION,
      required_for_nearby: draft.required_for_nearby,
      required_for_signup: draft.required_for_signup,
    },
  };
}

/**
 * `undefined` is another family, `null` is refused, and only a rebuilt exact
 * object may reach Core. The read carries nothing but the server-owned actor;
 * the save carries exactly the revision and the three candidate keys, and
 * `coreCall` JSON-encodes `configuration` into one form field.
 */
export function normalizeLocationAccessPolicyProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(LOCATION_ACCESS_POLICY_ACTIONS as readonly string[]).includes(action)) return undefined;
  if (action === "location_access_policy") {
    return exactObject(body, []) ? Object.create(null) as JsonObject : null;
  }
  const source = exactObject(body, ["expected_revision", "configuration"]);
  const revision = integer(source?.expected_revision, 0, LOCATION_ACCESS_POLICY_REVISION_MAX);
  const candidate = exactObject(source?.configuration, CANDIDATE_KEYS);
  if (revision === null || !candidate
    || candidate.schema_version !== LOCATION_ACCESS_POLICY_SCHEMA_VERSION
    || typeof candidate.required_for_nearby !== "boolean"
    || typeof candidate.required_for_signup !== "boolean") return null;
  return Object.assign(Object.create(null), locationAccessPolicySaveBody(revision, {
    required_for_nearby: candidate.required_for_nearby,
    required_for_signup: candidate.required_for_signup,
  })) as JsonObject;
}

// ------------------------------------------------------------ panel state

export type LocationAccessPolicyNotice =
  | { tone: "success"; key: "saved"; revision: number }
  | { tone: "success"; key: "unchanged" }
  | { tone: "error"; key: "conflict"; revision: number }
  | { tone: "error"; key: "conflictReloadFailed" }
  | { tone: "error"; key: "notConfirmed" }
  | { tone: "error"; key: "writeRequired" }
  | { tone: "error"; key: "invalid" }
  | { tone: "error"; key: "unexpected" };

export type LocationAccessPolicyModel = {
  phase: "loading" | "ready" | "unavailable" | "error";
  stored: LocationAccessPolicyState | null;
  draft: LocationAccessPolicyDraft | null;
  busy: boolean;
  notice: LocationAccessPolicyNotice | null;
};

export type LocationAccessPolicyEvent =
  | { type: "loadStarted" }
  | { type: "loaded"; outcome: LocationAccessPolicyReadOutcome }
  | { type: "toggled"; flag: LocationAccessPolicyFlag; value: boolean }
  | { type: "discarded" }
  | { type: "saveStarted" }
  | { type: "saveFinished"; outcome: LocationAccessPolicySaveOutcome }
  /** The follow-up read after a `409`, which keeps the draft either way. */
  | { type: "conflictReloaded"; outcome: LocationAccessPolicyReadOutcome };

export const LOCATION_ACCESS_POLICY_INITIAL_MODEL: LocationAccessPolicyModel = {
  phase: "loading",
  stored: null,
  draft: null,
  busy: false,
  notice: null,
};

/** Whether the panel may offer a save at all: Core said this actor can write. */
export function locationAccessPolicyCanSave(model: LocationAccessPolicyModel): boolean {
  return model.phase === "ready" && model.stored?.can_write === true && model.draft !== null;
}

/**
 * The panel's whole state machine, kept pure so every transition is tested
 * without a browser. The rule it exists for: an operator's unsaved choices are
 * never thrown away by a save that did not land. Only an explicit reload or
 * discard, or a confirmed save, replaces the draft.
 */
export function locationAccessPolicyReducer(
  model: LocationAccessPolicyModel,
  event: LocationAccessPolicyEvent,
): LocationAccessPolicyModel {
  switch (event.type) {
    case "loadStarted":
      return { ...model, phase: "loading", busy: true, notice: null };
    case "loaded":
      if (event.outcome.kind === "ready") {
        return {
          phase: "ready",
          stored: event.outcome.state,
          draft: locationAccessPolicyDraftFrom(event.outcome.state.configuration),
          busy: false,
          notice: null,
        };
      }
      return { phase: event.outcome.kind, stored: null, draft: null, busy: false, notice: null };
    case "toggled":
      if (!locationAccessPolicyCanSave(model) || model.busy || !model.draft) return model;
      return {
        ...model,
        draft: { ...model.draft, [event.flag]: event.value },
        // A conflict notice explains what the switches show; anything else is stale now.
        notice: model.notice?.key === "conflict" ? model.notice : null,
      };
    case "discarded":
      if (!model.stored || model.busy) return model;
      return {
        ...model,
        draft: locationAccessPolicyDraftFrom(model.stored.configuration),
        notice: null,
      };
    case "saveStarted":
      return locationAccessPolicyCanSave(model) && !model.busy
        ? { ...model, busy: true, notice: null }
        : model;
    case "saveFinished": {
      const outcome = event.outcome;
      if (outcome.kind === "saved") {
        return {
          phase: "ready",
          stored: outcome.state,
          draft: locationAccessPolicyDraftFrom(outcome.state.configuration),
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
          draft: locationAccessPolicyDraftFrom(model.stored.configuration),
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
            : locationAccessPolicyDraftFrom(state.configuration),
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

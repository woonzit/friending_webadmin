import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/**
 * Closed browser projection for the into-tag moderation Webadmin contract
 * (T-682, D-107 §3 + R10).
 *
 * Every shape here was written against the captured Core envelopes in
 * `tests/fixtures/into_tag_moderation_wire/`, not against the design prose:
 * the corpus is the contract and the test re-checks its sha256 on every run.
 *
 * Two properties separate this plane from `/profile-tags` next door and are
 * why the decoders are strict rather than tolerant:
 *
 *   1. ONE revision guards the whole plane. Every decide and every settings
 *      write moves it, and a stale one answers 409 carrying `data.current`
 *      for the console to adopt. There is no per-row optimistic lock.
 *   2. A decision is receipted. The same `request_id` retried with IDENTICAL
 *      material replays (`replayed: true`); the same id with DIFFERENT
 *      material is a conflict, not a replay. So a request id is minted once
 *      per logical change and reused for as long as the outcome is unknown.
 *
 * `rejected` is a permanent ban and `merged` is an alias, so a row that reads
 * wrong must fail closed into the error state rather than render a decision
 * surface over material the console did not understand.
 */

export const INTO_TAG_MODERATION_SCHEMA_VERSION = 1;
export const INTO_TAG_MODERATION_PAGE_SIZE = 50;
export const INTO_TAG_MODERATION_LIMIT_MAX = 200;
export const INTO_TAG_MODERATION_REASON_MAX_LENGTH = 500;

/** The Webadmin mutation family; the audit id is derived from it (see below). */
export const INTO_TAG_MODERATION_FAMILY = "into_tag_moderation";

export const INTO_TAG_MODERATION_ACTIONS = [
  "into_tag_moderation_list",
  "into_tag_moderation_decide",
  "into_tag_moderation_settings",
] as const;

export const INTO_TAG_MODERATION_STATES = [
  "approved",
  "pending",
  "rejected",
  "merged",
] as const;

/** The four queue tabs, in the order D-107 §4 lists them. */
export const INTO_TAG_MODERATION_TABS = [
  "pending",
  "approved",
  "rejected",
  "merged",
] as const;

/** Everything `into_tag_moderation_list` accepts as `state`. */
export const INTO_TAG_MODERATION_LIST_STATES = [
  ...INTO_TAG_MODERATION_STATES,
  "all",
] as const;

export const INTO_TAG_PROVENANCES = [
  "seed",
  "member",
  "legacy-user-created",
  "admin",
] as const;

export const INTO_TAG_VERDICTS = ["approve", "reject", "merge"] as const;

/**
 * Core's capability pair. `into_tag_moderation_read` is the list gate;
 * `into_tag_moderation` is the decide/settings gate. They are NOT ordered
 * lexicographically on the wire — Core appends the decide capability after the
 * read one — so the decoder pins Core's order rather than inventing a sort.
 */
export const INTO_TAG_MODERATION_CAPABILITIES = [
  "into_tag_moderation_read",
  "into_tag_moderation",
] as const;

export const INTO_TAG_MODERATION_ROLES = ["viewer", "editor", "approver", "owner"] as const;

export type IntoTagModerationState = (typeof INTO_TAG_MODERATION_STATES)[number];
export type IntoTagModerationTab = (typeof INTO_TAG_MODERATION_TABS)[number];
export type IntoTagModerationListState = (typeof INTO_TAG_MODERATION_LIST_STATES)[number];
export type IntoTagProvenance = (typeof INTO_TAG_PROVENANCES)[number];
export type IntoTagVerdict = (typeof INTO_TAG_VERDICTS)[number];
export type IntoTagModerationCapability = (typeof INTO_TAG_MODERATION_CAPABILITIES)[number];
export type IntoTagModerationRole = (typeof INTO_TAG_MODERATION_ROLES)[number];

export type IntoTagModerationPrincipal = {
  role: IntoTagModerationRole;
  capabilities: IntoTagModerationCapability[];
};

export type IntoTagModerationCounts = {
  approved: number;
  pending: number;
  rejected: number;
  merged: number;
};

export type IntoTagModerationPropagation = {
  selections: number;
  userinfo: number;
  user_into: number;
  used_into: number;
  filters: number;
};

export type IntoTagModerationItem = {
  key: string;
  label: string;
  label_hu: string;
  /** May be empty: a merged row releases its fold, and a fold conflict parks it. */
  label_fold: string;
  moderation_state: IntoTagModerationState;
  /** May be empty when a stored row predates the provenance field. */
  provenance: IntoTagProvenance | "";
  created_by_uid: number;
  created_at: number;
  active: boolean;
  member_count: number;
  source_member_count: number;
  merged_into: string;
  /** An operator email, or the migration actor `migration:into-tag-moderation-v1`. */
  moderated_by: string;
  moderated_at: number;
  moderation_reason: string;
  revision: number;
};

export type IntoTagModerationListData = {
  schema_version: 1;
  state: IntoTagModerationListState;
  items: IntoTagModerationItem[];
  /** Empty string means "this was the last page" — Core does not send null here. */
  next_cursor: string;
  counts: IntoTagModerationCounts;
  member_creation_enabled: boolean;
  revision: number;
  principal: IntoTagModerationPrincipal;
};

export type IntoTagModerationDecisionData = {
  revision: number;
  item: IntoTagModerationItem;
  propagated: IntoTagModerationPropagation;
  counts: IntoTagModerationCounts;
  replayed: boolean;
  audit_id: string;
};

export type IntoTagModerationSettingsData = {
  member_creation_enabled: boolean;
  revision: number;
  counts: IntoTagModerationCounts;
  replayed: boolean;
  audit_id: string;
};

export type IntoTagModerationConflictData = {
  current: {
    revision: number;
    member_creation_enabled: boolean;
    counts: IntoTagModerationCounts;
  };
};

/**
 * `merge_into` is present ONLY on a merge. Core refuses a non-empty target on
 * approve/reject, and the key is absent rather than empty so the request bytes
 * match the captured envelopes exactly.
 */
export type IntoTagModerationDecidePayload = {
  request_id: string;
  expected_revision: number;
  key: string;
  verdict: IntoTagVerdict;
  reason: string;
  merge_into?: string;
};

export type IntoTagModerationSettingsPayload = {
  request_id: string;
  expected_revision: number;
  member_creation_enabled: boolean;
};

const ITEM_KEY = /^[a-z0-9][a-z0-9_+-]{0,63}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIT_ID = /^wai:[0-9a-f]{64}$/;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const MAX_EPOCH = Number.MAX_SAFE_INTEGER;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Additive Core fields stay tolerated; the named ones must all be present. */
function requiredObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  return raw && keys.every((key) => Object.hasOwn(raw, key)) ? raw : null;
}

function integer(value: unknown, minimum: number, maximum = 2_147_483_647): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

/**
 * Bounded operator-visible text. Deliberately NOT NFC- or trim-normalized:
 * these strings come from a legacy vocabulary members typed years ago, and
 * refusing a stray trailing space would blank the queue rather than protect it.
 * Control characters are still refused, because those only ever break rendering.
 */
function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || DISALLOWED_CONTROL.test(value)) return null;
  return Array.from(value).length <= maximum ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : null;
}

function itemKey(value: unknown): string | null {
  return typeof value === "string" && ITEM_KEY.test(value) ? value : null;
}

/** An optional key: the empty string is a real, contracted value here. */
function optionalItemKey(value: unknown): string | null {
  return value === "" ? "" : itemKey(value);
}

export function isIntoTagModerationRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

function counts(value: unknown): IntoTagModerationCounts | null {
  const raw = requiredObject(value, ["approved", "pending", "rejected", "merged"]);
  if (!raw) return null;
  const approved = integer(raw.approved, 0, MAX_EPOCH);
  const pending = integer(raw.pending, 0, MAX_EPOCH);
  const rejected = integer(raw.rejected, 0, MAX_EPOCH);
  const merged = integer(raw.merged, 0, MAX_EPOCH);
  return approved === null || pending === null || rejected === null || merged === null
    ? null
    : { approved, pending, rejected, merged };
}

function propagation(value: unknown): IntoTagModerationPropagation | null {
  const keys = ["selections", "userinfo", "user_into", "used_into", "filters"] as const;
  const raw = requiredObject(value, keys);
  if (!raw) return null;
  const decoded: Record<string, number> = {};
  for (const key of keys) {
    const count = integer(raw[key], 0, MAX_EPOCH);
    if (count === null) return null;
    decoded[key] = count;
  }
  return decoded as IntoTagModerationPropagation;
}

function principal(value: unknown): IntoTagModerationPrincipal | null {
  const raw = requiredObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, INTO_TAG_MODERATION_ROLES);
  if (!raw || role === null || !Array.isArray(raw.capabilities)) return null;
  const capabilities: IntoTagModerationCapability[] = [];
  for (const entry of raw.capabilities) {
    const capability = oneOf(entry, INTO_TAG_MODERATION_CAPABILITIES);
    if (capability === null || capabilities.includes(capability)) return null;
    capabilities.push(capability);
  }
  // Core builds the list read-first and appends decide; anything else is a
  // shape this console has never seen and must not be authorized from.
  if (capabilities[0] !== "into_tag_moderation_read") return null;
  return { role, capabilities };
}

/**
 * One queue row.
 *
 * Two contract invariants are enforced here rather than merely displayed,
 * because a console that renders them wrong is a console that offers the wrong
 * button:
 *
 *   `active === true`  =>  `moderation_state === "approved"`  (D-107 R2)
 *   `merged_into !== ""` <=> `moderation_state === "merged"`  (decide unsets it)
 */
export function intoTagModerationItem(value: unknown): IntoTagModerationItem | null {
  const raw = requiredObject(value, [
    "key",
    "label",
    "label_hu",
    "label_fold",
    "moderation_state",
    "provenance",
    "created_by_uid",
    "created_at",
    "active",
    "member_count",
    "source_member_count",
    "merged_into",
    "moderated_by",
    "moderated_at",
    "moderation_reason",
    "revision",
  ]);
  if (!raw) return null;
  const key = itemKey(raw.key);
  const label = text(raw.label, 200);
  const labelHu = text(raw.label_hu, 200);
  const labelFold = text(raw.label_fold, 200);
  const state = oneOf(raw.moderation_state, INTO_TAG_MODERATION_STATES);
  const provenance = raw.provenance === ""
    ? ""
    : oneOf(raw.provenance, INTO_TAG_PROVENANCES);
  const createdByUid = integer(raw.created_by_uid, 0, MAX_EPOCH);
  const createdAt = integer(raw.created_at, 0, MAX_EPOCH);
  const memberCount = integer(raw.member_count, 0, MAX_EPOCH);
  const sourceMemberCount = integer(raw.source_member_count, 0, MAX_EPOCH);
  const mergedInto = optionalItemKey(raw.merged_into);
  const moderatedBy = text(raw.moderated_by, 320);
  const moderatedAt = integer(raw.moderated_at, 0, MAX_EPOCH);
  const reason = text(raw.moderation_reason, INTO_TAG_MODERATION_REASON_MAX_LENGTH);
  const revision = integer(raw.revision, 0, MAX_EPOCH);
  if (
    key === null
    || label === null
    || labelHu === null
    || labelFold === null
    || state === null
    || provenance === null
    || createdByUid === null
    || createdAt === null
    || typeof raw.active !== "boolean"
    || memberCount === null
    || sourceMemberCount === null
    || mergedInto === null
    || moderatedBy === null
    || moderatedAt === null
    || reason === null
    || revision === null
    || (raw.active && state !== "approved")
    || (mergedInto !== "") !== (state === "merged")
    || mergedInto === key
  ) return null;
  return {
    key,
    label,
    label_hu: labelHu,
    label_fold: labelFold,
    moderation_state: state,
    provenance,
    created_by_uid: createdByUid,
    created_at: createdAt,
    active: raw.active,
    member_count: memberCount,
    source_member_count: sourceMemberCount,
    merged_into: mergedInto,
    moderated_by: moderatedBy,
    moderated_at: moderatedAt,
    moderation_reason: reason,
    revision,
  };
}

/** Core pages the queue by `key` ascending; the cursor IS the last key served. */
export function intoTagModerationItemsAreOrdered(items: IntoTagModerationItem[]): boolean {
  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1].key >= items[index].key) return false;
  }
  return true;
}

export function intoTagModerationListData(value: unknown): IntoTagModerationListData | null {
  const raw = requiredObject(value, [
    "schema_version",
    "state",
    "items",
    "next_cursor",
    "counts",
    "member_creation_enabled",
    "revision",
    "principal",
  ]);
  if (!raw || raw.schema_version !== INTO_TAG_MODERATION_SCHEMA_VERSION) return null;
  const state = oneOf(raw.state, INTO_TAG_MODERATION_LIST_STATES);
  const nextCursor = optionalItemKey(raw.next_cursor);
  const listCounts = counts(raw.counts);
  const revision = integer(raw.revision, 0, MAX_EPOCH);
  const actor = principal(raw.principal);
  if (
    state === null
    || nextCursor === null
    || listCounts === null
    || typeof raw.member_creation_enabled !== "boolean"
    || revision === null
    || !actor
    || !Array.isArray(raw.items)
    || raw.items.length > INTO_TAG_MODERATION_LIMIT_MAX
  ) return null;

  const items: IntoTagModerationItem[] = [];
  for (const entry of raw.items) {
    const item = intoTagModerationItem(entry);
    // The filtered tab must contain only its own state, or the operator would
    // approve a row they believe is pending.
    if (!item || (state !== "all" && item.moderation_state !== state)) return null;
    items.push(item);
  }
  if (
    !intoTagModerationItemsAreOrdered(items)
    || (nextCursor !== "" && nextCursor !== items[items.length - 1]?.key)
    || (items.length === 0 && nextCursor !== "")
  ) return null;

  return {
    schema_version: 1,
    state,
    items,
    next_cursor: nextCursor,
    counts: listCounts,
    member_creation_enabled: raw.member_creation_enabled,
    revision,
    principal: actor,
  };
}

export function intoTagModerationListResponse(value: unknown): IntoTagModerationListData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? intoTagModerationListData(envelope.data) : null;
}

function auditId(value: unknown): string | null {
  return typeof value === "string" && AUDIT_ID.test(value) ? value : null;
}

export function intoTagModerationDecisionData(
  value: unknown,
): IntoTagModerationDecisionData | null {
  const raw = requiredObject(value, [
    "revision",
    "item",
    "propagated",
    "counts",
    "replayed",
    "audit_id",
  ]);
  if (!raw) return null;
  const revision = integer(raw.revision, 0, MAX_EPOCH);
  const item = intoTagModerationItem(raw.item);
  const propagated = propagation(raw.propagated);
  const decisionCounts = counts(raw.counts);
  const receipt = auditId(raw.audit_id);
  return revision === null
    || !item
    || !propagated
    || !decisionCounts
    || typeof raw.replayed !== "boolean"
    || receipt === null
    // A decided row is never left pending: every verdict lands in one of the
    // three terminal states, so a `pending` receipt is a response this console
    // must not adopt as proof the decision happened.
    || item.moderation_state === "pending"
    ? null
    : {
        revision,
        item,
        propagated,
        counts: decisionCounts,
        replayed: raw.replayed,
        audit_id: receipt,
      };
}

export function intoTagModerationDecisionResponse(
  value: unknown,
): IntoTagModerationDecisionData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? intoTagModerationDecisionData(envelope.data) : null;
}

export function intoTagModerationSettingsData(
  value: unknown,
): IntoTagModerationSettingsData | null {
  const raw = requiredObject(value, [
    "member_creation_enabled",
    "revision",
    "counts",
    "replayed",
    "audit_id",
  ]);
  if (!raw) return null;
  const revision = integer(raw.revision, 0, MAX_EPOCH);
  const settingsCounts = counts(raw.counts);
  const receipt = auditId(raw.audit_id);
  return typeof raw.member_creation_enabled !== "boolean"
    || revision === null
    || !settingsCounts
    || typeof raw.replayed !== "boolean"
    || receipt === null
    ? null
    : {
        member_creation_enabled: raw.member_creation_enabled,
        revision,
        counts: settingsCounts,
        replayed: raw.replayed,
        audit_id: receipt,
      };
}

export function intoTagModerationSettingsResponse(
  value: unknown,
): IntoTagModerationSettingsData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? intoTagModerationSettingsData(envelope.data) : null;
}

/**
 * The 409 that carries the plane's authoritative state. A stale revision is
 * recoverable — adopt `current` and re-ask — which is why it decodes into data
 * rather than into the flat refusal path.
 */
export function intoTagModerationConflictResponse(
  value: unknown,
): IntoTagModerationConflictData | null {
  const envelope = webadminErrorEnvelope(value, "required");
  const data = requiredObject(envelope?.data, ["current"]);
  const current = requiredObject(data?.current, [
    "revision",
    "member_creation_enabled",
    "counts",
  ]);
  const revision = integer(current?.revision, 0, MAX_EPOCH);
  const currentCounts = counts(current?.counts);
  return envelope?.status_code === 409
    && envelope.error === "into-tag-moderation-conflict"
    && current !== null
    && revision !== null
    && currentCounts !== null
    && typeof current.member_creation_enabled === "boolean"
    ? {
        current: {
          revision,
          member_creation_enabled: current.member_creation_enabled,
          counts: currentCounts,
        },
      }
    : null;
}

/** Every refusal this console can be served, with the status Core pairs it with. */
export const INTO_TAG_MODERATION_ERROR_STATUSES = {
  "into-tag-moderation-conflict": 409,
  "into-tag-item-not-found": 404,
  "into-tag-verdict-invalid": 422,
  "into-tag-merge-target-invalid": 422,
  "into-tag-request-invalid": 422,
  "into-tag-state-invalid": 422,
  "into-tag-moderation-unavailable": 503,
  "into-tag-moderation-write-failed": 503,
  "catalog-admin-session-invalid": 401,
  "catalog-admin-revoked": 403,
  "catalog-admin-capability-required": 403,
} as const;

export const INTO_TAG_MODERATION_ERROR_KEYS = {
  "into-tag-moderation-conflict": "conflict",
  "into-tag-item-not-found": "itemNotFound",
  "into-tag-verdict-invalid": "verdictInvalid",
  "into-tag-merge-target-invalid": "mergeTargetInvalid",
  "into-tag-request-invalid": "requestInvalid",
  "into-tag-state-invalid": "stateInvalid",
  "into-tag-moderation-unavailable": "unavailable",
  "into-tag-moderation-write-failed": "writeFailed",
  "catalog-admin-session-invalid": "sessionInvalid",
  "catalog-admin-revoked": "revoked",
  "catalog-admin-capability-required": "capabilityRequired",
} as const;

export type IntoTagModerationErrorKey =
  | (typeof INTO_TAG_MODERATION_ERROR_KEYS)[keyof typeof INTO_TAG_MODERATION_ERROR_KEYS]
  | "generic";

const ERROR_KEY_MAP = new Map<string, IntoTagModerationErrorKey>(
  Object.entries(INTO_TAG_MODERATION_ERROR_KEYS),
);

/**
 * A refusal after which retrying the SAME request id is pointless or wrong.
 * Everything else — a dropped connection, a bridge transport failure, an
 * unknown code — leaves the outcome unknown, so the request id is kept and the
 * operator may retry it into a replay instead of a second decision.
 */
const TERMINAL_ERRORS = new Set<string>([
  "into-tag-moderation-conflict",
  "into-tag-item-not-found",
  "into-tag-verdict-invalid",
  "into-tag-merge-target-invalid",
  "into-tag-request-invalid",
  "into-tag-state-invalid",
  "catalog-admin-session-invalid",
  "catalog-admin-revoked",
  "catalog-admin-capability-required",
]);

export function intoTagModerationErrorKey(value: unknown): IntoTagModerationErrorKey {
  return ERROR_KEY_MAP.get(typeof value === "string" ? value : "") ?? "generic";
}

/** Decode a flat refusal. A 409 carrying data belongs to the conflict decoder. */
export function intoTagModerationErrorResponse(value: unknown): string | null {
  const core = webadminErrorEnvelope(value);
  const envelope = core
    ?? (webadminErrorEnvelope(value, "required") ? null : adminBridgeErrorEnvelope(value));
  const error = typeof envelope?.error === "string"
    && Object.hasOwn(INTO_TAG_MODERATION_ERROR_STATUSES, envelope.error)
    ? envelope.error as keyof typeof INTO_TAG_MODERATION_ERROR_STATUSES
    : null;
  return envelope !== null
    && error !== null
    && error !== "into-tag-moderation-conflict"
    && envelope.status_code === INTO_TAG_MODERATION_ERROR_STATUSES[error]
    ? error
    : null;
}

export function intoTagModerationShouldRetainRequest(value: unknown): boolean {
  return !TERMINAL_ERRORS.has(typeof value === "string" ? value : "");
}

export function intoTagModerationCanDecide(actor: IntoTagModerationPrincipal): boolean {
  return actor.capabilities.includes("into_tag_moderation");
}

/**
 * A moderator's reason. Optional by contract (`""` is accepted and stored), so
 * this normalizes rather than requires — `null` means "the operator typed
 * something Core would refuse", not "the operator typed nothing".
 */
export function normalizeIntoTagModerationReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Core squeezes runs of whitespace and trims before measuring, so the console
  // measures the same string Core will store.
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (DISALLOWED_CONTROL.test(normalized)) return null;
  return Array.from(normalized).length <= INTO_TAG_MODERATION_REASON_MAX_LENGTH
    ? normalized
    : null;
}

/**
 * The exact decide body. `merge_into` travels only with a merge verdict: Core
 * refuses a non-empty target on approve/reject with `into-tag-merge-target-invalid`,
 * so sending an empty one on every request would be a needless way to be wrong.
 */
export function intoTagModerationDecidePayload(
  key: unknown,
  verdict: unknown,
  mergeInto: unknown,
  reason: unknown,
  expectedRevision: unknown,
  requestId: unknown,
): IntoTagModerationDecidePayload | null {
  const decidedKey = itemKey(key);
  const decidedVerdict = oneOf(verdict, INTO_TAG_VERDICTS);
  const revision = integer(expectedRevision, 0, MAX_EPOCH);
  const normalizedReason = normalizeIntoTagModerationReason(reason);
  const id = isIntoTagModerationRequestId(requestId) ? requestId : null;
  if (
    decidedKey === null
    || decidedVerdict === null
    || revision === null
    || normalizedReason === null
    || id === null
  ) return null;
  if (decidedVerdict !== "merge") {
    return mergeInto === undefined || mergeInto === null || mergeInto === ""
      ? {
          request_id: id,
          expected_revision: revision,
          key: decidedKey,
          verdict: decidedVerdict,
          reason: normalizedReason,
        }
      : null;
  }
  const target = itemKey(mergeInto);
  return target === null || target === decidedKey
    ? null
    : {
        request_id: id,
        expected_revision: revision,
        key: decidedKey,
        verdict: "merge",
        merge_into: target,
        reason: normalizedReason,
      };
}

export function intoTagModerationSettingsPayload(
  memberCreationEnabled: unknown,
  expectedRevision: unknown,
  requestId: unknown,
): IntoTagModerationSettingsPayload | null {
  const revision = integer(expectedRevision, 0, MAX_EPOCH);
  const id = isIntoTagModerationRequestId(requestId) ? requestId : null;
  return typeof memberCreationEnabled === "boolean" && revision !== null && id !== null
    ? {
        request_id: id,
        expected_revision: revision,
        member_creation_enabled: memberCreationEnabled,
      }
    : null;
}

/**
 * A row a merge may target: Core refuses any target that is not approved AND
 * active, and refuses merging a row into itself.
 */
export function intoTagModerationMergeTargets(
  items: IntoTagModerationItem[],
  sourceKey: string,
  query: string,
): IntoTagModerationItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (
    item.moderation_state === "approved"
    && item.active
    && item.key !== sourceKey
    && (needle === ""
      || item.key.includes(needle)
      || item.label.toLowerCase().includes(needle)
      || item.label_hu.toLowerCase().includes(needle))
  ));
}

/**
 * The receipt Core will mint for a request id, recomputed locally.
 *
 * `WebadminMutationPolicy::auditId()` is `"wai:" + sha256(family \0 request_id)`,
 * so a receipt can be checked against the request the operator actually sent
 * rather than merely displayed. Returns `null` where WebCrypto is unavailable
 * (an insecure context), which means "cannot verify", never "does not match".
 */
export async function intoTagModerationAuditId(requestId: string): Promise<string | null> {
  if (!isIntoTagModerationRequestId(requestId)) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const bytes = new TextEncoder().encode(`${INTO_TAG_MODERATION_FAMILY}\u0000${requestId}`);
    const digest = await subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `wai:${hex}`;
  } catch {
    return null;
  }
}

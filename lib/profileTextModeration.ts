import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Accepted T-214 Core ↔ Webadmin contract v1, including lead amendments A1–A7. */
export const PROFILE_TEXT_MODERATION_CONTRACT_VERSION = 1 as const;
export const PROFILE_TEXT_MODERATION_FIELDS = ["headline", "about_me"] as const;
export const PROFILE_TEXT_MODERATION_STATUSES = ["pending", "accepted", "denied"] as const;
export const PROFILE_TEXT_MODERATION_DECISIONS = ["accepted", "denied"] as const;
export const PROFILE_TEXT_MODERATION_CAPABILITIES = [
  "profile_text_moderation_read",
  "profile_text_moderation_decide",
] as const;
export const PROFILE_TEXT_MODERATION_ACTIONS = [
  "moderation_profile_text_list",
  "moderation_profile_text_action",
] as const;

export type ProfileTextModerationField = (typeof PROFILE_TEXT_MODERATION_FIELDS)[number];
export type ProfileTextModerationStatus = (typeof PROFILE_TEXT_MODERATION_STATUSES)[number];
export type ProfileTextModerationDecision = (typeof PROFILE_TEXT_MODERATION_DECISIONS)[number];
export type ProfileTextModerationCapability = (typeof PROFILE_TEXT_MODERATION_CAPABILITIES)[number];
export type ProfileTextModerationAction = (typeof PROFILE_TEXT_MODERATION_ACTIONS)[number];
export type ProfileTextModerationRole = "viewer" | "admin" | "owner";
export type ProfileTextModerationFilterField = ProfileTextModerationField | "all";

export type ProfileTextModerationPrincipal = {
  role: ProfileTextModerationRole;
  capabilities: ProfileTextModerationCapability[];
};

export type ProfileTextModerationAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  principal: ProfileTextModerationPrincipal;
  actions: ProfileTextModerationAction[];
};

export type ProfileTextModerationItem = {
  uid: number;
  field: ProfileTextModerationField;
  text: string;
  text_length: number;
  content_sha256: string;
  status: ProfileTextModerationStatus;
  revision: number;
  status_updated_at: number;
  member: { display_name: string; username: string };
};

export type ProfileTextModerationList = {
  contract_version: 1;
  principal: ProfileTextModerationPrincipal;
  actions: ProfileTextModerationAction[];
  filter: { field: ProfileTextModerationFilterField; uid: number | null };
  items: ProfileTextModerationItem[];
  next_cursor: string | null;
  total: number;
};

export type ProfileTextModerationListExpectation = {
  field: ProfileTextModerationFilterField;
  uid: number | null;
  page_size: number;
  /**
   * Rows already loaded for this exact filter before the page being decoded:
   * 0 for a first page, the loaded count for a named continuation. The decoder
   * binds `total` and `next_cursor` to it (T-414 B1): a terminal page must
   * complete the queue exactly, a continuation must leave rows to load, and an
   * empty first page proves emptiness only with `total=0`.
   */
  loaded_before?: number;
};

export type ProfileTextModerationMutation = {
  contract_version: 1;
  item: ProfileTextModerationItem;
  replayed: boolean;
};

export type ProfileTextModerationConflict = {
  contract_version: 1;
  current: ProfileTextModerationItem | null;
};

type JsonObject = Record<string, unknown>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/u;
const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

// Exact objects are reserved for browser-owned commands and persisted retry identities.
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

function requiredObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function scalarLength(value: string): number {
  return [...value].length;
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

function phpTrim(value: string): string {
  return value.replace(/^[\u0000\u0009-\u000d\u0020]+|[\u0000\u0009-\u000d\u0020]+$/gu, "");
}

function canonicalProfileText(value: unknown, field: ProfileTextModerationField): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)) return null;
  let normalized = value.normalize("NFC").replace(/\r\n|\r/gu, "\n");
  let withoutControls = "";
  for (const scalar of normalized) {
    const allowedMultilineControl = field === "about_me" && (scalar === "\n" || scalar === "\t");
    if (!/\p{C}/u.test(scalar) || allowedMultilineControl) withoutControls += scalar;
  }
  normalized = field === "about_me"
    ? withoutControls.replace(/[ \t]+/gu, " ")
    : withoutControls.replace(/\s+/gu, " ");
  normalized = phpTrim(normalized);
  const maximum = field === "headline" ? 200 : 3000;
  const length = scalarLength(normalized);
  return normalized === value && length >= 1 && length <= maximum ? value : null;
}

function canonicalPlainText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value) || value !== value.normalize("NFC")) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  return scalarLength(value) <= maximum ? value : null;
}

function canonicalReason(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)
    || value !== value.normalize("NFC") || value !== value.trim()) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  const length = scalarLength(value);
  return length >= 1 && length <= 300 ? value : null;
}

export function profileTextModerationReasonIsValid(value: unknown): value is string {
  return canonicalReason(value) !== null;
}

function orderedUnique<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map((entry) => oneOf(entry, canonical));
  if (parsed.some((entry) => entry === null)) return null;
  const rows = parsed as T[number][];
  if (new Set(rows).size !== rows.length) return null;
  const expected = canonical.filter((entry) => rows.includes(entry));
  return expected.length === rows.length && expected.every((entry, index) => entry === rows[index])
    ? rows
    : null;
}

function exactOrdered(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function expectedCapabilities(role: ProfileTextModerationRole): ProfileTextModerationCapability[] {
  return role === "viewer"
    ? ["profile_text_moderation_read"]
    : [...PROFILE_TEXT_MODERATION_CAPABILITIES];
}

function expectedActions(principal: ProfileTextModerationPrincipal): ProfileTextModerationAction[] {
  return PROFILE_TEXT_MODERATION_ACTIONS.filter((action) => action === "moderation_profile_text_list"
    ? principal.capabilities.includes("profile_text_moderation_read")
    : principal.capabilities.includes("profile_text_moderation_decide"));
}

function profileTextModerationPrincipal(value: unknown): ProfileTextModerationPrincipal | null {
  const source = requiredObject(value, ["role", "capabilities"]);
  const role = oneOf(source?.role, ["viewer", "admin", "owner"] as const);
  const capabilities = orderedUnique(source?.capabilities, PROFILE_TEXT_MODERATION_CAPABILITIES);
  if (!role || !capabilities || !exactOrdered(capabilities, expectedCapabilities(role))) return null;
  return { role, capabilities };
}

export function profileTextModerationAdminMe(value: unknown): ProfileTextModerationAdminMe | null {
  const source = requiredObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
  const principal = profileTextModerationPrincipal(source?.principal);
  if (source?.contract_version !== 1 || typeof source.contract_ready !== "boolean" || !principal) return null;
  const actions = source.contract_ready ? expectedActions(principal) : [];
  if (!exactOrdered(source.actions, actions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    principal,
    actions,
  };
}

export const PROFILE_TEXT_MODERATION_ACTION_CAPABILITY: Record<
  ProfileTextModerationAction,
  ProfileTextModerationCapability
> = {
  moderation_profile_text_list: "profile_text_moderation_read",
  moderation_profile_text_action: "profile_text_moderation_decide",
};

export function profileTextModerationProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!(PROFILE_TEXT_MODERATION_ACTIONS as readonly string[]).includes(action)) return null;
  const block = profileTextModerationAdminMe(record(membership)?.profile_text_moderation);
  const typedAction = action as ProfileTextModerationAction;
  return Boolean(block?.contract_ready
    && block.actions.includes(typedAction)
    && block.principal.capabilities.includes(PROFILE_TEXT_MODERATION_ACTION_CAPABILITY[typedAction]));
}

export async function profileTextContentSha256(
  uid: number,
  field: ProfileTextModerationField,
  text: string,
): Promise<string> {
  const material = `friending-profile-text-v1\0${uid}\0${field}\0${text}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function profileTextModerationItem(value: unknown): Promise<ProfileTextModerationItem | null> {
  const source = requiredObject(value, [
    "uid", "field", "text", "text_length", "content_sha256", "status",
    "revision", "status_updated_at", "member",
  ]);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  const field = oneOf(source?.field, PROFILE_TEXT_MODERATION_FIELDS);
  if (uid === null || !field) return null;
  const text = canonicalProfileText(source?.text, field);
  const length = integer(source?.text_length, 1, field === "headline" ? 200 : 3000);
  const status = oneOf(source?.status, PROFILE_TEXT_MODERATION_STATUSES);
  const revision = integer(source?.revision, 1, 2_147_483_647);
  const updatedAt = integer(source?.status_updated_at, 0, Number.MAX_SAFE_INTEGER);
  const hash = typeof source?.content_sha256 === "string" && SHA256.test(source.content_sha256)
    ? source.content_sha256
    : null;
  const member = requiredObject(source?.member, ["display_name", "username"]);
  const displayName = canonicalPlainText(member?.display_name, 100);
  const username = canonicalPlainText(member?.username, 120);
  if (!text || length !== scalarLength(text) || !hash || !status || revision === null || updatedAt === null
    || displayName === null || username === null) return null;
  try {
    if (await profileTextContentSha256(uid, field, text) !== hash) return null;
  } catch {
    return null;
  }
  return {
    uid,
    field,
    text,
    text_length: length,
    content_sha256: hash,
    status,
    revision,
    status_updated_at: updatedAt,
    member: { display_name: displayName, username },
  };
}

function itemOrder(left: ProfileTextModerationItem, right: ProfileTextModerationItem): number {
  return left.status_updated_at - right.status_updated_at
    || left.uid - right.uid
    || PROFILE_TEXT_MODERATION_FIELDS.indexOf(left.field) - PROFILE_TEXT_MODERATION_FIELDS.indexOf(right.field);
}

export async function profileTextModerationListResponse(
  value: unknown,
  expected: ProfileTextModerationListExpectation,
): Promise<ProfileTextModerationList | null> {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = requiredObject(envelope?.data, [
    "contract_version", "principal", "actions", "filter", "items", "next_cursor", "total",
  ]);
  const principal = profileTextModerationPrincipal(source?.principal);
  if (source?.contract_version !== 1 || !principal || !exactOrdered(source.actions, expectedActions(principal))) return null;
  const filterSource = requiredObject(source.filter, ["field", "uid"]);
  const field = oneOf(filterSource?.field, ["headline", "about_me", "all"] as const);
  const uid = filterSource?.uid === null ? null : integer(filterSource?.uid, 1, 2_147_483_647);
  const total = integer(source.total, 0, Number.MAX_SAFE_INTEGER);
  const nextCursor = source.next_cursor === null
    ? null
    : typeof source.next_cursor === "string" && CURSOR.test(source.next_cursor) ? source.next_cursor : undefined;
  if (!field || uid === null && filterSource?.uid !== null || total === null || nextCursor === undefined
    || field !== expected.field || uid !== expected.uid || !Number.isSafeInteger(expected.page_size)
    || expected.page_size < 1 || expected.page_size > 100
    || !Array.isArray(source.items) || source.items.length > expected.page_size) return null;
  const items: ProfileTextModerationItem[] = [];
  for (const candidate of source.items) {
    const item = await profileTextModerationItem(candidate);
    if (!item || item.status !== "pending" || (field !== "all" && item.field !== field)
      || (uid !== null && item.uid !== uid)) return null;
    items.push(item);
  }
  const loadedBefore = expected.loaded_before ?? 0;
  if (!Number.isSafeInteger(loadedBefore) || loadedBefore < 0) return null;
  const loaded = loadedBefore + items.length;
  if (new Set(items.map((item) => `${item.uid}:${item.field}`)).size !== items.length
    || items.some((item, index) => index > 0 && itemOrder(items[index - 1], item) >= 0)
    || total < items.length || (total === 0 && (items.length !== 0 || nextCursor !== null))
    || (items.length === 0 && nextCursor !== null)
    // Page-kind cardinality (T-414 B1): terminal pages complete the queue exactly;
    // continuations carry at least one row and leave rows to load.
    || (nextCursor === null ? loaded !== total : (items.length === 0 || loaded >= total))) return null;
  return {
    contract_version: 1,
    principal,
    actions: expectedActions(principal),
    filter: { field, uid },
    items,
    next_cursor: nextCursor,
    total,
  };
}

export async function profileTextModerationMutationResponse(value: unknown): Promise<ProfileTextModerationMutation | null> {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = requiredObject(envelope?.data, ["contract_version", "item", "replayed"]);
  const item = await profileTextModerationItem(source?.item);
  return source?.contract_version === 1 && item && item.status !== "pending" && typeof source.replayed === "boolean"
    ? { contract_version: 1, item, replayed: source.replayed }
    : null;
}

export async function profileTextModerationConflict(value: unknown): Promise<ProfileTextModerationConflict | null> {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409 || envelope.error !== "profile-text-moderation-conflict") return null;
  const source = requiredObject(envelope.data, ["contract_version", "current"]);
  if (source?.contract_version !== 1) return null;
  if (source.current === null) return { contract_version: 1, current: null };
  const current = await profileTextModerationItem(source.current);
  return current ? { contract_version: 1, current } : null;
}

export const PROFILE_TEXT_MODERATION_ERROR_STATUSES: Readonly<Record<string, number>> = {
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
  "profile-text-moderation-read-required": 403,
  "profile-text-moderation-decision-required": 403,
  "profile-text-moderation-contract-version-required": 422,
  "profile-text-moderation-contract-version-invalid": 422,
  "profile-text-moderation-request-invalid": 422,
  "profile-text-moderation-filter-invalid": 422,
  "profile-text-moderation-cursor-invalid": 422,
  "profile-text-moderation-member-invalid": 422,
  "profile-text-moderation-field-invalid": 422,
  "profile-text-moderation-decision-invalid": 422,
  "profile-text-moderation-revision-invalid": 422,
  "profile-text-moderation-content-hash-invalid": 422,
  "profile-text-moderation-reason-invalid": 422,
  "profile-text-moderation-request-id-invalid": 422,
  "profile-text-moderation-member-not-found": 404,
  "profile-text-moderation-conflict": 409,
  "profile-text-moderation-request-id-conflict": 409,
  "profile-text-moderation-request-in-progress": 409,
  "profile-text-moderation-stored-invalid": 503,
  "profile-text-moderation-schema-unavailable": 503,
  "profile-text-moderation-read-failed": 503,
  "profile-text-moderation-audit-write-failed": 503,
  "profile-text-moderation-receipt-write-failed": 503,
  "profile-text-moderation-write-failed": 503,
};

export function profileTextModerationError(value: unknown): string | null {
  const core = webadminErrorEnvelope(value);
  // A Core conflict carries `data`; do not let the tolerant bridge subset
  // reinterpret that versioned envelope as a plain bridge refusal.
  const envelope = core ?? (webadminErrorEnvelope(value, "required") ? null : adminBridgeErrorEnvelope(value));
  const error = envelope?.error;
  return error && Object.hasOwn(PROFILE_TEXT_MODERATION_ERROR_STATUSES, error)
    && PROFILE_TEXT_MODERATION_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

export type ProfileTextModerationErrorKey =
  | "sessionInvalid"
  | "badOrigin"
  | "routeNotFound"
  | "readRequired"
  | "decisionRequired"
  | "requestInvalid"
  | "tooLarge"
  | "temporarilyUnavailable"
  | "invalidResponse"
  | "contractVersion"
  | "filterInvalid"
  | "cursorInvalid"
  | "memberInvalid"
  | "fieldInvalid"
  | "decisionInvalid"
  | "revisionInvalid"
  | "hashInvalid"
  | "reasonInvalid"
  | "requestIdInvalid"
  | "memberNotFound"
  | "requestIdConflict"
  | "requestInProgress"
  | "storedInvalid"
  | "schemaUnavailable"
  | "auditWriteFailed"
  | "receiptWriteFailed"
  | "writeFailed"
  | "generic";

const PROFILE_TEXT_MODERATION_ERROR_KEYS: Readonly<Record<string, ProfileTextModerationErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "bad-origin": "badOrigin",
  "not-found": "routeNotFound",
  "profile-text-moderation-read-required": "readRequired",
  "admin-write-required": "decisionRequired",
  "profile-text-moderation-decision-required": "decisionRequired",
  "invalid-input": "requestInvalid",
  "profile-text-moderation-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "profile-text-moderation-read-failed": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
  "profile-text-moderation-contract-version-required": "contractVersion",
  "profile-text-moderation-contract-version-invalid": "contractVersion",
  "profile-text-moderation-filter-invalid": "filterInvalid",
  "profile-text-moderation-cursor-invalid": "cursorInvalid",
  "profile-text-moderation-member-invalid": "memberInvalid",
  "profile-text-moderation-field-invalid": "fieldInvalid",
  "profile-text-moderation-decision-invalid": "decisionInvalid",
  "profile-text-moderation-revision-invalid": "revisionInvalid",
  "profile-text-moderation-content-hash-invalid": "hashInvalid",
  "profile-text-moderation-reason-invalid": "reasonInvalid",
  "profile-text-moderation-request-id-invalid": "requestIdInvalid",
  "profile-text-moderation-member-not-found": "memberNotFound",
  "profile-text-moderation-request-id-conflict": "requestIdConflict",
  "profile-text-moderation-request-in-progress": "requestInProgress",
  "profile-text-moderation-stored-invalid": "storedInvalid",
  "profile-text-moderation-schema-unavailable": "schemaUnavailable",
  "profile-text-moderation-audit-write-failed": "auditWriteFailed",
  "profile-text-moderation-receipt-write-failed": "receiptWriteFailed",
  "profile-text-moderation-write-failed": "writeFailed",
};

export function profileTextModerationErrorKey(error: string | null): ProfileTextModerationErrorKey {
  return error && Object.hasOwn(PROFILE_TEXT_MODERATION_ERROR_KEYS, error)
    ? PROFILE_TEXT_MODERATION_ERROR_KEYS[error]
    : "generic";
}

export function profileTextModerationShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.hasOwn(PROFILE_TEXT_MODERATION_ERROR_STATUSES, error)
    || error === "profile-text-moderation-request-in-progress"
    || error === "profile-text-moderation-audit-write-failed"
    || error === "profile-text-moderation-receipt-write-failed"
    || error === "profile-text-moderation-write-failed"
    || PROFILE_TEXT_MODERATION_ERROR_STATUSES[error] >= 500;
}

function normalizeListBody(body: JsonObject): JsonObject | null {
  // Same-origin request bodies remain closed so undeclared fields cannot reach Core.
  if (!hasOnlyKeys(body, ["contract_version", "field", "uid", "page_size", "cursor"])
    || body.contract_version !== 1) return null;
  const field = body.field === undefined
    ? "all"
    : oneOf(body.field, ["headline", "about_me", "all"] as const);
  const uid = body.uid === undefined ? undefined : integer(body.uid, 1, 2_147_483_647);
  const pageSize = body.page_size === undefined ? 50 : integer(body.page_size, 1, 100);
  const cursor = body.cursor === undefined || body.cursor === ""
    ? undefined
    : typeof body.cursor === "string" && CURSOR.test(body.cursor) ? body.cursor : null;
  if (!field || body.uid !== undefined && uid === null || pageSize === null || cursor === null) return null;
  return Object.assign(Object.create(null), {
    contract_version: 1,
    field,
    ...(uid === undefined ? {} : { uid }),
    page_size: pageSize,
    ...(cursor === undefined ? {} : { cursor }),
  });
}

function normalizeActionBody(body: JsonObject): JsonObject | null {
  const source = exactObject(body, [
    "contract_version", "uid", "field", "decision", "expected_revision",
    "content_sha256", "reason", "request_id",
  ]);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  const field = oneOf(source?.field, PROFILE_TEXT_MODERATION_FIELDS);
  const decision = oneOf(source?.decision, PROFILE_TEXT_MODERATION_DECISIONS);
  const revision = integer(source?.expected_revision, 1, 2_147_483_647);
  const hash = typeof source?.content_sha256 === "string" && SHA256.test(source.content_sha256)
    ? source.content_sha256
    : null;
  const reason = canonicalReason(source?.reason);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  return source?.contract_version === 1 && uid !== null && field && decision && revision !== null
    && hash && reason && requestId
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      uid,
      field,
      decision,
      expected_revision: revision,
      content_sha256: hash,
      reason,
      request_id: requestId,
    })
    : null;
}

/** `undefined` is another family, `null` is refused, and an object alone may reach Core. */
export function normalizeProfileTextModerationProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(PROFILE_TEXT_MODERATION_ACTIONS as readonly string[]).includes(action)) return undefined;
  return action === "moderation_profile_text_list" ? normalizeListBody(body) : normalizeActionBody(body);
}

export type ProfileTextModerationPendingMutation = {
  version: 1;
  action: "moderation_profile_text_action";
  target: string;
  payload: JsonObject;
};

export const PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY = "friending.profile-text-moderation.pending-mutation.v1";

function pendingTarget(payload: JsonObject): string | null {
  return typeof payload.uid === "number" && oneOf(payload.field, PROFILE_TEXT_MODERATION_FIELDS)
    ? `${payload.uid}:${payload.field}`
    : null;
}

export function profileTextModerationPendingMutation(
  target: string,
  body: JsonObject,
): ProfileTextModerationPendingMutation | null {
  const payload = normalizeActionBody(body);
  const expectedTarget = payload ? pendingTarget(payload) : null;
  return payload && target === expectedTarget
    ? { version: 1, action: "moderation_profile_text_action", target, payload }
    : null;
}

export function profileTextModerationPendingFrom(value: unknown): ProfileTextModerationPendingMutation | null {
  // Persisted retry identity remains exact so replay cannot acquire new semantics.
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  return source?.version === 1 && source.action === "moderation_profile_text_action"
    && typeof source.target === "string"
    ? profileTextModerationPendingMutation(source.target, record(source.payload) ?? {})
    : null;
}

export async function profileTextModerationPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: ProfileTextModerationPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = profileTextModerationPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

export function profileTextModerationMutationConverged(
  pending: ProfileTextModerationPendingMutation,
  result: ProfileTextModerationMutation,
): boolean {
  const canonical = profileTextModerationPendingFrom(pending);
  if (!canonical) return false;
  const payload = canonical.payload;
  return result.item.uid === payload.uid
    && result.item.field === payload.field
    && result.item.status === payload.decision
    && result.item.content_sha256 === payload.content_sha256
    && result.item.revision === Number(payload.expected_revision) + 1;
}

export function profileTextModerationConflictMatchesPending(
  pending: ProfileTextModerationPendingMutation,
  conflict: ProfileTextModerationConflict,
): boolean {
  const canonical = profileTextModerationPendingFrom(pending);
  if (!canonical) return false;
  return conflict.current === null || (conflict.current.uid === canonical.payload.uid
    && conflict.current.field === canonical.payload.field);
}

export function profileTextModerationFilterField(value: unknown): ProfileTextModerationFilterField {
  return oneOf(value, ["headline", "about_me", "all"] as const) ?? "all";
}

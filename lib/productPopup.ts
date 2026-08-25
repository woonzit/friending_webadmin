import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Closed browser model for the per-user product-popup Webadmin contract. */

export const PRODUCT_POPUP_CONTRACT_VERSION = 1;
export const PRODUCT_POPUP_MIN_FUTURE_SECONDS = 5 * 60;
export const PRODUCT_POPUP_MAX_FUTURE_SECONDS = 30 * 24 * 60 * 60;
export const PRODUCT_POPUP_DEFAULT_FUTURE_SECONDS = 7 * 24 * 60 * 60;

export const PRODUCT_POPUP_REPEAT_MODES = ["once", "until_expiry"] as const;
export const PRODUCT_POPUP_BUTTON_ACTIONS = ["none", "url", "rate"] as const;
export const PRODUCT_POPUP_CAPABILITIES = [
  "product_popup_read",
  "product_popup_write",
] as const;

export type ProductPopupRepeatMode = (typeof PRODUCT_POPUP_REPEAT_MODES)[number];
export type ProductPopupButtonAction = (typeof PRODUCT_POPUP_BUTTON_ACTIONS)[number];
export type ProductPopupCapability = (typeof PRODUCT_POPUP_CAPABILITIES)[number];

export type ProductPopupPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: ProductPopupCapability[];
};

export type ProductPopupButton = {
  action: ProductPopupButtonAction;
  title: string;
  url: string;
};

export type ProductPopup = {
  pop_id: string;
  revision: number;
  status: "active" | "expired";
  title: string;
  message: string;
  repeat_mode: ProductPopupRepeatMode;
  expires_at: number;
  button: ProductPopupButton;
  created_at: number;
  created_by: string;
  updated_at: number;
  updated_by: string;
};

export type ProductPopupResourceData = {
  contract_version: 1;
  principal: ProductPopupPrincipal;
  uid: number;
  resource_revision: number;
  evaluated_at: number;
  popup: ProductPopup | null;
};

export type ProductPopupMutationData = ProductPopupResourceData & {
  replayed: boolean;
};

export type ProductPopupConflictData = {
  error: "product-popup-conflict" | "product-popup-already-clear";
  resource: ProductPopupResourceData;
};

export type ProductPopupDraft = {
  title: string;
  message: string;
  repeatMode: ProductPopupRepeatMode;
  expiresAt: number;
  buttonAction: ProductPopupButtonAction;
  buttonTitle: string;
  buttonUrl: string;
  auditReason: string;
};

export type ProductPopupSetPayload = {
  contract_version: 1;
  uid: number;
  expected_revision: number;
  request_id: string;
  audit_reason: string;
  title: string;
  message: string;
  repeat_mode: ProductPopupRepeatMode;
  expires_at: number;
  button_action: ProductPopupButtonAction;
  button_title: string;
  button_url: string;
};

export type ProductPopupSetMaterial = Omit<
  ProductPopupSetPayload,
  "contract_version" | "uid" | "expected_revision" | "request_id"
>;

export type ProductPopupClearPayload = {
  contract_version: 1;
  uid: number;
  expected_revision: number;
  request_id: string;
  audit_reason: string;
};

export type ProductPopupPendingMutation =
  | { version: 1; action: "set"; payload: ProductPopupSetPayload }
  | { version: 1; action: "clear"; payload: ProductPopupClearPayload };

export type ProductPopupDraftError =
  | "uid"
  | "revision"
  | "requestId"
  | "auditReason"
  | "title"
  | "message"
  | "repeatMode"
  | "expiry"
  | "button"
  | "buttonUrl";

export type ProductPopupPayloadResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: ProductPopupDraftError };

const POP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const URL_CONTROL = /\p{Cc}/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  if (!raw) return null;
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? raw
    : null;
}

function integer(value: unknown, minimum: number, maximum = 2_147_483_647): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function boundedWireText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  if (
    value.trim() !== value
    || value.normalize("NFC") !== value
    || DISALLOWED_CONTROL.test(value)
    || UNPAIRED_SURROGATE.test(value)
  ) return null;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum ? value : null;
}

function normalizedText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  return boundedWireText(value.trim().normalize("NFC"), minimum, maximum);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T
    : null;
}

function uid(value: unknown): number | null {
  return integer(value, 1);
}

function revision(value: unknown): number | null {
  return integer(value, 0);
}

function canonicalRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

function normalizedRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return canonicalRequestId(value.toLowerCase());
}

function popId(value: unknown): string | null {
  return typeof value === "string" && POP_ID.test(value) ? value : null;
}

function normalizedEmail(value: unknown): string | null {
  const parsed = boundedWireText(value, 3, 320);
  return parsed && parsed === parsed.toLowerCase() && EMAIL.test(parsed) ? parsed : null;
}

export function canonicalProductPopupUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFC");
  if (
    normalized === ""
    || URL_CONTROL.test(normalized)
    || UNPAIRED_SURROGATE.test(normalized)
    || Array.from(normalized).length > 500
  ) return null;
  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname === ""
      || parsed.username !== ""
      || parsed.password !== ""
    ) return null;
    const canonical = parsed.toString();
    return Array.from(canonical).length <= 500 ? canonical : null;
  } catch {
    return null;
  }
}

function canonicalWireUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value || value.normalize("NFC") !== value) {
    return null;
  }
  const canonical = canonicalProductPopupUrl(value);
  return canonical === value ? canonical : null;
}

function principal(value: unknown): ProductPopupPrincipal | null {
  const raw = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, ["viewer", "admin", "owner"] as const);
  if (!raw || role === null || !Array.isArray(raw.capabilities)) return null;
  const capabilities: ProductPopupCapability[] = [];
  for (const item of raw.capabilities) {
    const capability = oneOf(item, PRODUCT_POPUP_CAPABILITIES);
    if (capability === null || capabilities.includes(capability)) return null;
    capabilities.push(capability);
  }
  if (
    !capabilities.includes("product_popup_read")
    || capabilities.some((capability, index) => (
      index > 0 && capabilities[index - 1] > capability
    ))
  ) return null;
  return { role, capabilities };
}

function button(value: unknown): ProductPopupButton | null {
  const raw = exactObject(value, ["action", "title", "url"]);
  const action = oneOf(raw?.action, PRODUCT_POPUP_BUTTON_ACTIONS);
  if (!raw || action === null) return null;
  const title = boundedWireText(raw.title, action === "none" ? 0 : 1, 60);
  const url = action === "url"
    ? canonicalWireUrl(raw.url)
    : boundedWireText(raw.url, 0, 0);
  if (
    title === null
    || url === null
    || (action === "none" && title !== "")
  ) return null;
  return { action, title, url };
}

function structuralSetPayload(value: unknown): ProductPopupSetPayload | null {
  const raw = exactObject(value, [
    "contract_version",
    "uid",
    "expected_revision",
    "request_id",
    "audit_reason",
    "title",
    "message",
    "repeat_mode",
    "expires_at",
    "button_action",
    "button_title",
    "button_url",
  ]);
  if (!raw || raw.contract_version !== 1) return null;
  const parsedUid = uid(raw.uid);
  const expectedRevision = revision(raw.expected_revision);
  const requestId = canonicalRequestId(raw.request_id);
  const auditReason = boundedWireText(raw.audit_reason, 1, 500);
  const title = boundedWireText(raw.title, 1, 100);
  const message = boundedWireText(raw.message, 1, 1000);
  const repeatMode = oneOf(raw.repeat_mode, PRODUCT_POPUP_REPEAT_MODES);
  const expiresAt = integer(raw.expires_at, 0, Number.MAX_SAFE_INTEGER);
  const buttonAction = oneOf(raw.button_action, PRODUCT_POPUP_BUTTON_ACTIONS);
  if (
    parsedUid === null
    || expectedRevision === null
    || requestId === null
    || auditReason === null
    || title === null
    || message === null
    || repeatMode === null
    || expiresAt === null
    || buttonAction === null
  ) return null;
  const parsedButton = button({
    action: buttonAction,
    title: raw.button_title,
    url: raw.button_url,
  });
  if (!parsedButton) return null;
  return {
    contract_version: 1,
    uid: parsedUid,
    expected_revision: expectedRevision,
    request_id: requestId,
    audit_reason: auditReason,
    title,
    message,
    repeat_mode: repeatMode,
    expires_at: expiresAt,
    button_action: parsedButton.action,
    button_title: parsedButton.title,
    button_url: parsedButton.url,
  };
}

function structuralClearPayload(value: unknown): ProductPopupClearPayload | null {
  const raw = exactObject(value, [
    "contract_version",
    "uid",
    "expected_revision",
    "request_id",
    "audit_reason",
  ]);
  if (!raw || raw.contract_version !== 1) return null;
  const parsedUid = uid(raw.uid);
  const expectedRevision = revision(raw.expected_revision);
  const requestId = canonicalRequestId(raw.request_id);
  const auditReason = boundedWireText(raw.audit_reason, 1, 500);
  return parsedUid !== null
    && expectedRevision !== null
    && requestId !== null
    && auditReason !== null
    ? {
        contract_version: 1,
        uid: parsedUid,
        expected_revision: expectedRevision,
        request_id: requestId,
        audit_reason: auditReason,
      }
    : null;
}

export function productPopupDefaultExpiry(nowSeconds: number): number | null {
  const now = integer(nowSeconds, 0, Number.MAX_SAFE_INTEGER);
  return now === null || now > Number.MAX_SAFE_INTEGER - PRODUCT_POPUP_DEFAULT_FUTURE_SECONDS
    ? null
    : now + PRODUCT_POPUP_DEFAULT_FUTURE_SECONDS;
}

export function normalizeProductPopupAuditReason(value: unknown): string | null {
  return normalizedText(value, 1, 500);
}

export function productPopupExpiryIsAllowed(expiresAt: unknown, nowSeconds: unknown): boolean {
  const expiry = integer(expiresAt, 0, Number.MAX_SAFE_INTEGER);
  const now = integer(nowSeconds, 0, Number.MAX_SAFE_INTEGER);
  if (expiry === null || now === null) return false;
  const delta = expiry - now;
  return delta >= PRODUCT_POPUP_MIN_FUTURE_SECONDS
    && delta <= PRODUCT_POPUP_MAX_FUTURE_SECONDS;
}

export function productPopupSetPayload(
  rawUid: unknown,
  rawRevision: unknown,
  draft: ProductPopupDraft,
  rawRequestId: unknown,
  nowSeconds: unknown,
): ProductPopupPayloadResult<ProductPopupSetPayload> {
  const parsedUid = uid(rawUid);
  if (parsedUid === null) return { ok: false, error: "uid" };
  const expectedRevision = revision(rawRevision);
  if (expectedRevision === null) return { ok: false, error: "revision" };
  const requestId = normalizedRequestId(rawRequestId);
  if (requestId === null) return { ok: false, error: "requestId" };
  const material = productPopupSetMaterial(draft, nowSeconds);
  if (!material.ok) return material;
  return {
    ok: true,
    payload: {
      contract_version: 1,
      uid: parsedUid,
      expected_revision: expectedRevision,
      request_id: requestId,
      ...material.payload,
    },
  };
}

export function productPopupSetMaterial(
  draft: ProductPopupDraft,
  nowSeconds: unknown,
): ProductPopupPayloadResult<ProductPopupSetMaterial> {
  const auditReason = normalizeProductPopupAuditReason(draft.auditReason);
  if (auditReason === null) return { ok: false, error: "auditReason" };
  const title = normalizedText(draft.title, 1, 100);
  if (title === null) return { ok: false, error: "title" };
  const message = normalizedText(draft.message, 1, 1000);
  if (message === null) return { ok: false, error: "message" };
  const repeatMode = oneOf(draft.repeatMode, PRODUCT_POPUP_REPEAT_MODES);
  if (repeatMode === null) return { ok: false, error: "repeatMode" };
  if (!productPopupExpiryIsAllowed(draft.expiresAt, nowSeconds)) {
    return { ok: false, error: "expiry" };
  }
  const expiresAt = integer(draft.expiresAt, 0, Number.MAX_SAFE_INTEGER)!;
  const buttonAction = oneOf(draft.buttonAction, PRODUCT_POPUP_BUTTON_ACTIONS);
  if (buttonAction === null) return { ok: false, error: "button" };
  const buttonTitle = normalizedText(draft.buttonTitle, buttonAction === "none" ? 0 : 1, 60);
  if (buttonTitle === null || (buttonAction === "none" && buttonTitle !== "")) {
    return { ok: false, error: "button" };
  }
  let buttonUrl = "";
  if (buttonAction === "url") {
    const canonical = canonicalProductPopupUrl(draft.buttonUrl);
    if (!canonical) return { ok: false, error: "buttonUrl" };
    buttonUrl = canonical;
  } else if (draft.buttonUrl.trim() !== "") {
    return { ok: false, error: "button" };
  }
  return {
    ok: true,
    payload: {
      audit_reason: auditReason,
      title,
      message,
      repeat_mode: repeatMode,
      expires_at: expiresAt,
      button_action: buttonAction,
      button_title: buttonTitle,
      button_url: buttonUrl,
    },
  };
}

export function productPopupClearPayload(
  rawUid: unknown,
  rawRevision: unknown,
  rawAuditReason: unknown,
  rawRequestId: unknown,
): ProductPopupPayloadResult<ProductPopupClearPayload> {
  const parsedUid = uid(rawUid);
  if (parsedUid === null) return { ok: false, error: "uid" };
  const expectedRevision = revision(rawRevision);
  if (expectedRevision === null) return { ok: false, error: "revision" };
  const requestId = normalizedRequestId(rawRequestId);
  if (requestId === null) return { ok: false, error: "requestId" };
  const auditReason = normalizeProductPopupAuditReason(rawAuditReason);
  return auditReason === null
    ? { ok: false, error: "auditReason" }
    : {
        ok: true,
        payload: {
          contract_version: 1,
          uid: parsedUid,
          expected_revision: expectedRevision,
          request_id: requestId,
          audit_reason: auditReason,
        },
      };
}

export function productPopupPendingMutation(value: unknown): ProductPopupPendingMutation | null {
  const raw = exactObject(value, ["version", "action", "payload"]);
  if (!raw || raw.version !== 1) return null;
  if (raw.action === "set") {
    const payload = structuralSetPayload(raw.payload);
    return payload ? { version: 1, action: "set", payload } : null;
  }
  if (raw.action === "clear") {
    const payload = structuralClearPayload(raw.payload);
    return payload ? { version: 1, action: "clear", payload } : null;
  }
  return null;
}

export function productPopupPendingSet(
  payload: ProductPopupSetPayload,
): ProductPopupPendingMutation {
  return { version: 1, action: "set", payload };
}

export function productPopupPendingClear(
  payload: ProductPopupClearPayload,
): ProductPopupPendingMutation {
  return { version: 1, action: "clear", payload };
}

export function productPopupCanWrite(value: ProductPopupPrincipal): boolean {
  return value.capabilities.includes("product_popup_write");
}

export function productPopupPendingStorageKey(rawUid: number): string {
  return `friending.product-popup.pending-mutation.v1:${rawUid}`;
}

function popup(
  value: unknown,
  resourceRevision: number,
  evaluatedAt: number,
): ProductPopup | null {
  const raw = exactObject(value, [
    "pop_id",
    "revision",
    "status",
    "title",
    "message",
    "repeat_mode",
    "expires_at",
    "button",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ]);
  if (!raw) return null;
  const id = popId(raw.pop_id);
  const popupRevision = integer(raw.revision, 1);
  const status = oneOf(raw.status, ["active", "expired"] as const);
  const title = boundedWireText(raw.title, 1, 100);
  const message = boundedWireText(raw.message, 1, 1000);
  const repeatMode = oneOf(raw.repeat_mode, PRODUCT_POPUP_REPEAT_MODES);
  const expiresAt = integer(raw.expires_at, 0, Number.MAX_SAFE_INTEGER);
  const parsedButton = button(raw.button);
  const createdAt = integer(raw.created_at, 0, Number.MAX_SAFE_INTEGER);
  const createdBy = normalizedEmail(raw.created_by);
  const updatedAt = integer(raw.updated_at, 0, Number.MAX_SAFE_INTEGER);
  const updatedBy = normalizedEmail(raw.updated_by);
  if (
    id === null
    || popupRevision === null
    || popupRevision !== resourceRevision
    || status === null
    || title === null
    || message === null
    || repeatMode === null
    || expiresAt === null
    || parsedButton === null
    || createdAt === null
    || createdBy === null
    || updatedAt === null
    || updatedBy === null
    || updatedAt < createdAt
    || evaluatedAt < updatedAt
    || expiresAt <= updatedAt
    || status !== (expiresAt > evaluatedAt ? "active" : "expired")
  ) return null;
  return {
    pop_id: id,
    revision: popupRevision,
    status,
    title,
    message,
    repeat_mode: repeatMode,
    expires_at: expiresAt,
    button: parsedButton,
    created_at: createdAt,
    created_by: createdBy,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

/** Decode the exact version-1 resource projection, including A1's Core clock. */
export function productPopupResourceData(value: unknown): ProductPopupResourceData | null {
  const raw = exactObject(value, [
    "contract_version",
    "principal",
    "uid",
    "resource_revision",
    "evaluated_at",
    "popup",
  ]);
  if (!raw || raw.contract_version !== 1) return null;
  const actor = principal(raw.principal);
  const parsedUid = uid(raw.uid);
  const resourceRevision = revision(raw.resource_revision);
  const evaluatedAt = integer(raw.evaluated_at, 0, Number.MAX_SAFE_INTEGER);
  if (!actor || parsedUid === null || resourceRevision === null || evaluatedAt === null) return null;
  const parsedPopup = raw.popup === null ? null : popup(raw.popup, resourceRevision, evaluatedAt);
  if (raw.popup !== null && parsedPopup === null) return null;
  if (parsedPopup !== null && resourceRevision === 0) return null;
  return {
    contract_version: 1,
    principal: actor,
    uid: parsedUid,
    resource_revision: resourceRevision,
    evaluated_at: evaluatedAt,
    popup: parsedPopup,
  };
}

export function productPopupReadResponse(value: unknown): ProductPopupResourceData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope
    ? productPopupResourceData(envelope.data)
    : null;
}

export function productPopupMutationData(value: unknown): ProductPopupMutationData | null {
  const raw = exactObject(value, [
    "contract_version",
    "principal",
    "uid",
    "resource_revision",
    "evaluated_at",
    "popup",
    "replayed",
  ]);
  if (!raw || typeof raw.replayed !== "boolean") return null;
  const resource = productPopupResourceData({
    contract_version: raw.contract_version,
    principal: raw.principal,
    uid: raw.uid,
    resource_revision: raw.resource_revision,
    evaluated_at: raw.evaluated_at,
    popup: raw.popup,
  });
  return resource && productPopupCanWrite(resource.principal)
    ? { ...resource, replayed: raw.replayed }
    : null;
}

function mutationResponse(value: unknown): ProductPopupMutationData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope
    ? productPopupMutationData(envelope.data)
    : null;
}

export function productPopupSetResponse(value: unknown): ProductPopupMutationData | null {
  const parsed = mutationResponse(value);
  return parsed?.popup ? parsed : null;
}

export function productPopupClearResponse(value: unknown): ProductPopupMutationData | null {
  const parsed = mutationResponse(value);
  return parsed && parsed.popup === null && parsed.resource_revision >= 2 ? parsed : null;
}

export function productPopupConflictResponse(value: unknown): ProductPopupConflictData | null {
  const envelope = webadminErrorEnvelope(value, "required");
  const error = oneOf(envelope?.error, [
    "product-popup-conflict",
    "product-popup-already-clear",
  ] as const);
  const resource = productPopupResourceData(envelope?.data);
  if (
    envelope?.status_code !== 409
    || error === null
    || !resource
    || !productPopupCanWrite(resource.principal)
    || (error === "product-popup-already-clear" && resource.popup !== null)
  ) return null;
  return { error, resource };
}

export const PRODUCT_POPUP_ERROR_KEYS = {
  "product-popup-contract-version-invalid": "contractVersionInvalid",
  "product-popup-parameter-invalid": "parameterInvalid",
  "product-popup-uid-invalid": "uidInvalid",
  "product-popup-user-not-found": "userNotFound",
  "product-popup-title-invalid": "titleInvalid",
  "product-popup-message-invalid": "messageInvalid",
  "product-popup-repeat-mode-invalid": "repeatModeInvalid",
  "product-popup-expiry-invalid": "expiryInvalid",
  "product-popup-button-invalid": "buttonInvalid",
  "product-popup-button-url-invalid": "buttonUrlInvalid",
  "product-popup-audit-reason-invalid": "auditReasonInvalid",
  "product-popup-revision-invalid": "revisionInvalid",
  "product-popup-request-id-invalid": "requestIdInvalid",
  "product-popup-already-clear": "alreadyClear",
  "product-popup-conflict": "conflict",
  "product-popup-request-id-conflict": "requestIdConflict",
  "product-popup-request-in-progress": "requestInProgress",
  "product-popup-read-required": "readRequired",
  "product-popup-write-required": "writeRequired",
  "product-popup-audit-write-failed": "auditWriteFailed",
  "product-popup-stored-invalid": "storedInvalid",
  "product-popup-read-failed": "readFailed",
  "product-popup-write-failed": "writeFailed",
  "admin-revoked": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-write-required": "writeRequired",
} as const;

export const PRODUCT_POPUP_ERROR_STATUSES: Record<
  keyof typeof PRODUCT_POPUP_ERROR_KEYS,
  number
> = {
  "product-popup-contract-version-invalid": 400,
  "product-popup-parameter-invalid": 400,
  "product-popup-uid-invalid": 422,
  "product-popup-user-not-found": 404,
  "product-popup-title-invalid": 422,
  "product-popup-message-invalid": 422,
  "product-popup-repeat-mode-invalid": 422,
  "product-popup-expiry-invalid": 422,
  "product-popup-button-invalid": 422,
  "product-popup-button-url-invalid": 422,
  "product-popup-audit-reason-invalid": 422,
  "product-popup-revision-invalid": 422,
  "product-popup-request-id-invalid": 422,
  "product-popup-already-clear": 409,
  "product-popup-conflict": 409,
  "product-popup-request-id-conflict": 409,
  "product-popup-request-in-progress": 409,
  "product-popup-read-required": 403,
  "product-popup-write-required": 403,
  "product-popup-audit-write-failed": 503,
  "product-popup-stored-invalid": 503,
  "product-popup-read-failed": 503,
  "product-popup-write-failed": 503,
  "admin-revoked": 403,
  "admin-session-invalid": 403,
  "admin-write-required": 403,
};

export type ProductPopupErrorKey =
  | (typeof PRODUCT_POPUP_ERROR_KEYS)[keyof typeof PRODUCT_POPUP_ERROR_KEYS]
  | "generic";

const ERROR_KEY_MAP = new Map<string, ProductPopupErrorKey>(
  Object.entries(PRODUCT_POPUP_ERROR_KEYS),
);

const TERMINAL_MUTATION_ERRORS = new Set([
  "product-popup-contract-version-invalid",
  "product-popup-parameter-invalid",
  "product-popup-uid-invalid",
  "product-popup-user-not-found",
  "product-popup-title-invalid",
  "product-popup-message-invalid",
  "product-popup-repeat-mode-invalid",
  "product-popup-expiry-invalid",
  "product-popup-button-invalid",
  "product-popup-button-url-invalid",
  "product-popup-audit-reason-invalid",
  "product-popup-revision-invalid",
  "product-popup-request-id-invalid",
  "product-popup-already-clear",
  "product-popup-conflict",
  "product-popup-request-id-conflict",
  "product-popup-read-required",
  "product-popup-write-required",
  "admin-revoked",
  "admin-session-invalid",
  "admin-write-required",
]);

export function productPopupErrorKey(value: unknown): ProductPopupErrorKey {
  return ERROR_KEY_MAP.get(typeof value === "string" ? value : "") ?? "generic";
}

/** Decode refusals without authoritative conflict data. */
export function productPopupErrorResponse(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value);
  const error = typeof envelope?.error === "string"
    && Object.prototype.hasOwnProperty.call(PRODUCT_POPUP_ERROR_STATUSES, envelope.error)
    ? envelope.error as keyof typeof PRODUCT_POPUP_ERROR_STATUSES
    : null;
  return envelope !== null
    && error !== null
    && error !== "product-popup-conflict"
    && error !== "product-popup-already-clear"
    && envelope.status_code === PRODUCT_POPUP_ERROR_STATUSES[error]
    ? error
    : null;
}

export function productPopupShouldRetainMutation(value: unknown): boolean {
  const error = typeof value === "string" ? value : "";
  return !TERMINAL_MUTATION_ERRORS.has(error);
}

function popupMatchesSetPayload(
  popupValue: ProductPopup,
  payload: ProductPopupSetPayload,
): boolean {
  return popupValue.title === payload.title
    && popupValue.message === payload.message
    && popupValue.repeat_mode === payload.repeat_mode
    && popupValue.expires_at === payload.expires_at
    && popupValue.button.action === payload.button_action
    && popupValue.button.title === payload.button_title
    && popupValue.button.url === payload.button_url;
}

/** A read may prove a lost response converged without sending another write. */
export function productPopupResourceConverged(
  resource: ProductPopupResourceData,
  pending: ProductPopupPendingMutation,
): boolean {
  if (
    resource.uid !== pending.payload.uid
    || resource.resource_revision !== pending.payload.expected_revision + 1
  ) return false;
  return pending.action === "clear"
    ? resource.popup === null
    : resource.popup !== null && popupMatchesSetPayload(resource.popup, pending.payload);
}

export function productPopupMutationConverged(
  result: ProductPopupMutationData,
  pending: ProductPopupPendingMutation,
): boolean {
  return productPopupResourceConverged(result, pending);
}

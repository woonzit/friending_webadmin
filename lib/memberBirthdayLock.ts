import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

export const MEMBER_BIRTHDAY_LOCK_ACTION = "reset_member_birthday_lock" as const;

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AUDIT_ID = /^wai:[0-9a-f]{64}$/u;

const CORE_ERROR_STATUS = {
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "birthday-lock-contract-version-required": 422,
  "birthday-lock-contract-version-invalid": 422,
  "birthday-lock-request-invalid": 422,
  "birthday-lock-uid-invalid": 422,
  "birthday-lock-request-id-invalid": 422,
  "birthday-lock-member-not-found": 404,
  "birthday-lock-conflict": 409,
  "birthday-lock-request-id-conflict": 409,
  "birthday-lock-request-in-progress": 409,
  "birthday-lock-stored-invalid": 503,
  "birthday-lock-read-failed": 503,
  "birthday-lock-audit-write-failed": 503,
  "birthday-lock-receipt-write-failed": 503,
  "birthday-lock-write-failed": 503,
} as const;

const BRIDGE_ERROR_STATUS = {
  "bad-origin": 403,
  "not-found": 404,
  "too-large": 413,
  "auth-required": 401,
  "admin-write-required": 403,
  "invalid-input": 400,
  "core-timeout": 504,
  "core-unavailable": 502,
  "invalid-core-response": 502,
} as const;

export type MemberBirthdayLockResetPayload = {
  contract_version: 1;
  uid: number;
  request_id: string;
};

export type MemberBirthdayLockReceipt = {
  request_id: string;
  audit_id: string;
  replayed: boolean;
};

export type MemberBirthdayLockResetResult = {
  contract_version: 1;
  uid: number;
  changed: boolean;
  birthday_locked: false;
  remaining_changes: 1;
  receipt: MemberBirthdayLockReceipt;
};

export type MemberBirthdayLockRefusal = {
  error: string;
  status_code: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && [...expected].sort().every((key, index) => actual[index] === key);
}

function uid(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function memberBirthdayLockResetPayload(
  memberUid: unknown,
  requestId: unknown,
): MemberBirthdayLockResetPayload | null {
  const normalizedUid = uid(memberUid);
  return normalizedUid !== null && typeof requestId === "string" && REQUEST_ID.test(requestId)
    ? { contract_version: 1, uid: normalizedUid, request_id: requestId }
    : null;
}

/** Strict action-specific browser-to-proxy boundary; `undefined` means another action. */
export function normalizeMemberBirthdayLockProxyBody(
  action: string,
  value: unknown,
): MemberBirthdayLockResetPayload | null | undefined {
  if (action !== MEMBER_BIRTHDAY_LOCK_ACTION) return undefined;
  const source = record(value);
  if (!source || !exactKeys(source, ["contract_version", "uid", "request_id"])) return null;
  if (source.contract_version !== 1) return null;
  return memberBirthdayLockResetPayload(source.uid, source.request_id);
}

export function memberBirthdayLockResetResponse(
  value: unknown,
  expectedUid?: number,
  expectedRequestId?: string,
): MemberBirthdayLockResetResult | null {
  const rawEnvelope = record(value);
  if (!rawEnvelope || !exactKeys(rawEnvelope, [
    "success", "status_code", "data", "message", "status", "can_send",
  ])) return null;
  const envelope = webadminDataSuccessEnvelope(value);
  const data = record(envelope?.data);
  if (!data || !exactKeys(data, [
    "contract_version", "uid", "changed", "birthday_locked", "remaining_changes", "receipt",
  ])) return null;
  const memberUid = uid(data.uid);
  const receipt = record(data.receipt);
  if (data.contract_version !== 1
    || memberUid === null
    || typeof data.changed !== "boolean"
    || data.birthday_locked !== false
    || data.remaining_changes !== 1
    || !receipt
    || !exactKeys(receipt, ["request_id", "audit_id", "replayed"])
    || typeof receipt.request_id !== "string"
    || !REQUEST_ID.test(receipt.request_id)
    || typeof receipt.audit_id !== "string"
    || !AUDIT_ID.test(receipt.audit_id)
    || typeof receipt.replayed !== "boolean"
    || (expectedUid !== undefined && memberUid !== expectedUid)
    || (expectedRequestId !== undefined && receipt.request_id !== expectedRequestId)) return null;

  return {
    contract_version: 1,
    uid: memberUid,
    changed: data.changed,
    birthday_locked: false,
    remaining_changes: 1,
    receipt: {
      request_id: receipt.request_id,
      audit_id: receipt.audit_id,
      replayed: receipt.replayed,
    },
  };
}

export function memberBirthdayLockRefusal(value: unknown): MemberBirthdayLockRefusal | null {
  const core = webadminErrorEnvelope(value);
  if (core) {
    const expectedStatus = CORE_ERROR_STATUS[core.error as keyof typeof CORE_ERROR_STATUS];
    return expectedStatus !== undefined && core.status_code === expectedStatus
      ? { error: core.error, status_code: core.status_code }
      : null;
  }
  const bridge = adminBridgeErrorEnvelope(value);
  const expectedStatus = bridge
    ? BRIDGE_ERROR_STATUS[bridge.error as keyof typeof BRIDGE_ERROR_STATUS]
    : undefined;
  return bridge && expectedStatus !== undefined && bridge.status_code === expectedStatus
    ? { error: bridge.error, status_code: bridge.status_code }
    : null;
}

export type MemberBirthdayLockErrorMessageKey =
  | "authorization"
  | "invalidRequest"
  | "memberNotFound"
  | "conflict"
  | "storedInvalid"
  | "unavailable";

export function memberBirthdayLockErrorMessageKey(
  error: string,
): MemberBirthdayLockErrorMessageKey {
  if (["admin-session-invalid", "admin-revoked", "admin-write-required", "auth-required", "bad-origin"].includes(error)) {
    return "authorization";
  }
  if ([
    "birthday-lock-contract-version-required", "birthday-lock-contract-version-invalid",
    "birthday-lock-request-invalid", "birthday-lock-uid-invalid",
    "birthday-lock-request-id-invalid", "invalid-input", "too-large", "not-found",
  ].includes(error)) return "invalidRequest";
  if (error === "birthday-lock-member-not-found") return "memberNotFound";
  if ([
    "birthday-lock-conflict", "birthday-lock-request-id-conflict",
    "birthday-lock-request-in-progress",
  ].includes(error)) return "conflict";
  if (error === "birthday-lock-stored-invalid") return "storedInvalid";
  return "unavailable";
}

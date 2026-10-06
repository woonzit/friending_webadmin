/**
 * Administrator-grant flows as pure async functions over an injected admin call.
 *
 * The member panel owns presentation state only. Every decision about when a grant request
 * identity is kept, replayed, reconciled or released lives here, so it can be tested against a
 * mocked bridge. Core already replays a `membership_admin_grant` receipt for a repeated
 * `request_id` with the same body (before its revision check), so resending the exact pinned
 * request after an unknown outcome can never grant twice.
 */

import {
  membershipActionErrorKey,
  membershipGrantChanged,
  membershipMutationOutcome,
  membershipPinnedMutation,
  membershipUserDetail,
  type MembershipActionErrorKey,
  type MembershipGrantBaseline,
  type MembershipGrantPreview,
  type MembershipPinnedMutation,
  type MembershipUserDetail,
} from "@/lib/membership";
import { classifyAdminMembership } from "@/lib/adminMembership";

/** The same-origin bridge (`adminCall`), injected so flows stay testable. */
export type MembershipAdminCall = (
  action: string,
  body?: Record<string, unknown>,
) => Promise<{ success?: unknown; error?: unknown; data?: unknown; [key: string]: unknown } | null>;

/**
 * A grant request sent to Core. While its outcome is unknown the exact body (request ID and
 * expected revision included) stays pinned and every grant control stays locked, so a retry can
 * only replay that request; `baseline` is the grant it was based on.
 */
export type MembershipPendingGrant = {
  pinned: MembershipPinnedMutation;
  baseline: MembershipGrantBaseline;
  uncertain: boolean;
};

/**
 * Reads one member's authoritative membership detail; `null` when it could not be read. The
 * `unavailable` fallback carries no grant, so it can never be compared with a pinned baseline and
 * is treated as unreadable.
 */
export async function membershipReadUserDetail(
  call: MembershipAdminCall,
  uid: number,
): Promise<MembershipUserDetail | null> {
  let response;
  try { response = await call("membership_user_detail", { uid }); } catch { return null; }
  const parsed = response?.success === true ? membershipUserDetail(response.data) : null;
  return parsed && parsed.uid === uid && parsed.effective_membership.lifecycle_state !== "unavailable"
    ? parsed
    : null;
}

export type MembershipGrantSubmitResult =
  | { kind: "granted"; detail: MembershipUserDetail; pending: null }
  /** The member's grant changed after an unknown outcome: most likely this request applied. */
  | { kind: "uncertainResolved"; detail: MembershipUserDetail; pending: null }
  | { kind: "uncertain"; detail: MembershipUserDetail | null; pending: MembershipPendingGrant }
  | { kind: "refused"; errorKey: MembershipActionErrorKey; detail: MembershipUserDetail | null; pending: null }
  /**
   * Nothing was sent: the member's current grant is not at the preview's revision (or could not be
   * read to confirm it), so the preview is stale and must be requested again.
   */
  | { kind: "previewStale"; detail: MembershipUserDetail | null; pending: null };

/**
 * Issues or replays one administrator grant. A first attempt pins the body against the preview's
 * grant revision. When the loaded member is not at that revision, the member is read first, and
 * the grant is sent only if the fresh grant is at the preview's revision, so the baseline pairs the
 * right grant identity with it. Otherwise nothing is sent and a new preview is required: a baseline
 * taken from a different grant could later be misread as "most likely applied".
 *
 * A replay (`pending` set) re-reads the member first and stops if the baseline changed or cannot
 * be read. It needs no preview and never edits the pinned body, including for older pins without
 * an identity fence. `persist` runs with the
 * exact request immediately before every send, so a page reload during or after the call can
 * restore the same identity; a failed storage write never blocks the send.
 */
export async function membershipSubmitGrant(
  call: MembershipAdminCall,
  input: {
    /** The owner of this editor/persisted retry, never the newly signed-in actor. */
    actor: string | null;
    uid: number;
    pending: MembershipPendingGrant | null;
    detail: MembershipUserDetail;
    preview: MembershipGrantPreview | null;
    body: Record<string, unknown>;
    mintRequestId: () => string;
    persist?: (pending: MembershipPendingGrant) => void;
  },
): Promise<MembershipGrantSubmitResult> {
  let attempt = input.pending;
  let known: MembershipUserDetail | null = null;
  // An explicit Retry never migrates a retained grant to another account.
  // This is a fresh own-session proof, not a browser authority/cache.
  let identity;
  try { identity = await call("admin_me", {}); } catch { identity = null; }
  const actor = input.actor;
  const confirmed = actor && classifyAdminMembership({ status: identity?.status_code as number, data: identity }, actor);
  if (!confirmed || confirmed.kind !== "confirmed" || confirmed.role === "viewer") {
    return attempt ? { kind: "uncertain", detail: null, pending: { ...attempt, uncertain: true } }
      : { kind: "previewStale", detail: null, pending: null };
  }
  if (attempt) {
    known = await membershipReadUserDetail(call, input.uid);
    if (!known) return { kind: "uncertain", detail: null, pending: { ...attempt, uncertain: true } };
    if (membershipGrantChanged(attempt.baseline, known)) {
      return { kind: "refused", errorKey: "grantConflict", detail: known, pending: null };
    }
  } else {
    const preview = input.preview;
    if (!preview) return { kind: "previewStale", detail: null, pending: null };
    let baselineDetail = input.detail;
    const matchesPreview = (detail: MembershipUserDetail) =>
      (detail.admin_grant?.revision ?? 0) === preview.current_grant_revision
      && (preview.current_grant_id === undefined
        || (detail.admin_grant?.grant_id ?? null) === preview.current_grant_id);
    if (!matchesPreview(baselineDetail)) {
      known = await membershipReadUserDetail(call, input.uid);
      if (!known || !matchesPreview(known)) {
        return { kind: "previewStale", detail: known, pending: null };
      }
      baselineDetail = known;
    }
    attempt = {
      pinned: membershipPinnedMutation(null, {
        ...input.body,
        uid: input.uid,
        expected_revision: preview.current_grant_revision,
        expected_grant_id: baselineDetail.admin_grant?.grant_id ?? null,
      }, input.mintRequestId),
      baseline: {
        grant_id: baselineDetail.admin_grant?.grant_id ?? null,
        revision: preview.current_grant_revision,
      },
      uncertain: false,
    };
  }
  input.persist?.(attempt);
  let response;
  try { response = await call("membership_admin_grant", attempt.pinned.body); } catch {
    return { kind: "uncertain", detail: known, pending: { ...attempt, uncertain: true } };
  }
  const granted = response?.success === true ? membershipUserDetail(response.data) : null;
  const adopted = granted !== null && granted.uid === input.uid;
  const outcome = membershipMutationOutcome("grant_create", response, adopted);
  if (outcome === "success" && granted) return { kind: "granted", detail: granted, pending: null };
  if (outcome === "uncertain") {
    const uncertain = { ...attempt, uncertain: true };
    const refreshed = await membershipReadUserDetail(call, input.uid);
    if (refreshed && membershipGrantChanged(uncertain.baseline, refreshed)) {
      return { kind: "uncertainResolved", detail: refreshed, pending: null };
    }
    return { kind: "uncertain", detail: refreshed ?? known, pending: uncertain };
  }
  // A definite refusal or a conflict releases the request identity.
  const conflict = outcome === "conflict" ? membershipUserDetail(response?.data) : null;
  if (outcome === "conflict") known = await membershipReadUserDetail(call, input.uid);
  return {
    kind: "refused",
    errorKey: membershipActionErrorKey("grant_create", response?.error),
    detail: known ?? (conflict && conflict.uid === input.uid ? conflict : null),
    pending: null,
  };
}

export type MembershipPendingGrantCheck =
  /** The grant changed against the baseline (identity or revision): most likely it applied. */
  | { kind: "changed"; detail: MembershipUserDetail }
  /** The member still has the baseline grant; the request may or may not still arrive. */
  | { kind: "unchanged"; detail: MembershipUserDetail }
  /** The member could not be read; nothing about the pinned request can be concluded. */
  | { kind: "unreadable" };

/**
 * Compares a fresh member read against a pinned grant's baseline (grant identity and revision).
 * A refresh releases the pin only on `changed`; a discard releases it on `changed` or `unchanged`
 * and keeps it when the member cannot be read.
 */
export async function membershipCheckPendingGrant(
  call: MembershipAdminCall,
  uid: number,
  pending: MembershipPendingGrant,
): Promise<MembershipPendingGrantCheck> {
  const refreshed = await membershipReadUserDetail(call, uid);
  if (!refreshed) return { kind: "unreadable" };
  return membershipGrantChanged(pending.baseline, refreshed)
    ? { kind: "changed", detail: refreshed }
    : { kind: "unchanged", detail: refreshed };
}

// ------------------------------------------------------ pinned grant persistence

/**
 * A pinned grant survives a page reload in `sessionStorage` (one browser tab) under one key per
 * signed-in administrator and member. The entry holds only what a replay or a discard needs:
 * member UID, request ID, body fingerprint, baseline grant identity and revision, and when the
 * request was first pinned. The fingerprint is the canonical material body (preset, start mode,
 * custom expiry, normalized reason, UID, expected revision and optional grant ID), so a restored retry resends exactly
 * the pinned request. No session, credential or Core secret is ever stored.
 */
export const MEMBERSHIP_PENDING_GRANT_STORAGE_PREFIX = "friending.membership.pending-grant.v1";

/** A stored pin older than this is released on restore; the operator re-reads the member instead. */
export const MEMBERSHIP_PENDING_GRANT_TTL_MS = 30 * 60 * 1000;

/** A pin dated further ahead of this browser's clock was not written by this flow. */
const PENDING_GRANT_CLOCK_SKEW_MS = 60 * 1000;

const PENDING_GRANT_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PENDING_GRANT_WIRE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const PENDING_GRANT_RECORD_KEYS = ["baseline", "created_at", "fingerprint", "request_id", "uid", "version"];
const PENDING_GRANT_BODY_KEYS = ["custom_expires_at", "expected_revision", "preset_id", "reason", "start_mode", "uid"];
const PENDING_GRANT_PRESETS = ["plus_week", "plus_month", "plus_quarter", "custom"] as const;
const PENDING_GRANT_START_MODES = ["extend", "start_now"] as const;

export type MembershipPendingGrantStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The pinned request's form values, so a restored lock shows exactly what a retry resends. */
export type MembershipPendingGrantRequest = {
  preset_id: (typeof PENDING_GRANT_PRESETS)[number];
  start_mode: (typeof PENDING_GRANT_START_MODES)[number];
  custom_expires_at: string | null;
  reason: string;
};

export type MembershipPendingGrantRestore =
  /** Nothing usable was stored (absent, unreadable storage, or a malformed entry, which is removed). */
  | { kind: "none" }
  /** The stored pin was older than the TTL and was removed; nothing is locked. */
  | { kind: "expired" }
  /** The loaded member no longer has the baseline grant: most likely the request applied. Removed. */
  | { kind: "resolved" }
  /** The same request is pinned again, with its outcome unknown. */
  | { kind: "restored"; pending: MembershipPendingGrant; request: MembershipPendingGrantRequest; createdAt: number };

type StoredPendingGrant = {
  pending: MembershipPendingGrant;
  request: MembershipPendingGrantRequest;
  createdAt: number;
};

/** The browser tab's `sessionStorage`, or `null` where it is absent or access throws. */
export function membershipSessionStorage(): MembershipPendingGrantStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Normalizes the signed-in administrator's e-mail from `admin_me`; `null` disables persistence. */
export function membershipAdminScope(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && email.includes("@") && !/\s/u.test(email) ? email : null;
}

/** One key per administrator and member; `null` when either is unusable. */
export function membershipPendingGrantStorageKey(admin: string | null, uid: number): string | null {
  const scope = membershipAdminScope(admin);
  if (!scope || !Number.isSafeInteger(uid) || uid <= 0) return null;
  return `${MEMBERSHIP_PENDING_GRANT_STORAGE_PREFIX}:${encodeURIComponent(scope)}:${uid}`;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]) ? source : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Decodes the pinned body back out of its fingerprint; anything but the exact canonical grant body fails. */
function pendingGrantRequest(
  fingerprint: string,
  uid: number,
  expectedRevision: number,
  expectedGrantId: string | null,
  requestId: string,
): { pinned: MembershipPinnedMutation; request: MembershipPendingGrantRequest } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fingerprint);
  } catch {
    return null;
  }
  // Old pins retain their original body and receipt fingerprint. Never add a fence on restore.
  const hasGrantId = !!parsed && typeof parsed === "object" && "expected_grant_id" in parsed;
  const body = exactRecord(parsed, hasGrantId
    ? [...PENDING_GRANT_BODY_KEYS, "expected_grant_id"].sort()
    : PENDING_GRANT_BODY_KEYS);
  if (!body || body.uid !== uid || body.expected_revision !== expectedRevision) return null;
  if (hasGrantId && body.expected_grant_id !== expectedGrantId) return null;
  const preset = PENDING_GRANT_PRESETS.find((value) => value === body.preset_id);
  const startMode = PENDING_GRANT_START_MODES.find((value) => value === body.start_mode);
  const reason = body.reason;
  const expiry = body.custom_expires_at;
  if (!preset || !startMode || typeof reason !== "string") return null;
  if (reason !== reason.trim().replace(/\s+/gu, " ") || reason.length < 3 || reason.length > 500) return null;
  const expiryValid = preset === "custom"
    ? typeof expiry === "string" && PENDING_GRANT_WIRE_INSTANT.test(expiry) && Number.isFinite(Date.parse(expiry))
    : expiry === null;
  if (!expiryValid) return null;
  const pinned = membershipPinnedMutation(null, body, () => requestId);
  // A value that is not byte-identical to the canonical encoding was not written by this flow.
  if (pinned.fingerprint !== fingerprint) return null;
  return {
    pinned,
    request: { preset_id: preset, start_mode: startMode, custom_expires_at: expiry as string | null, reason },
  };
}

function storedPendingGrant(value: unknown, uid: number): StoredPendingGrant | null {
  const source = exactRecord(value, PENDING_GRANT_RECORD_KEYS);
  if (!source || source.version !== 1 || source.uid !== uid) return null;
  const requestId = source.request_id;
  const fingerprint = source.fingerprint;
  const createdAt = source.created_at;
  const baseline = exactRecord(source.baseline, ["grant_id", "revision"]);
  if (typeof requestId !== "string" || !PENDING_GRANT_UUID_V4.test(requestId)) return null;
  if (typeof fingerprint !== "string" || fingerprint.length > 4096) return null;
  if (!nonNegativeInteger(createdAt) || createdAt === 0 || !baseline || !nonNegativeInteger(baseline.revision)) return null;
  const grantId = baseline.grant_id;
  if (grantId !== null && (typeof grantId !== "string" || grantId === "" || grantId.length > 120)) return null;
  const decoded = pendingGrantRequest(fingerprint, uid, baseline.revision, grantId, requestId);
  if (!decoded) return null;
  return {
    pending: { pinned: decoded.pinned, baseline: { grant_id: grantId, revision: baseline.revision }, uncertain: true },
    request: decoded.request,
    createdAt,
  };
}

function readStoredPendingGrant(storage: MembershipPendingGrantStorage, key: string): unknown {
  try {
    const serialized = storage.getItem(key);
    return serialized === null ? undefined : JSON.parse(serialized);
  } catch {
    return null;
  }
}

/**
 * Stores the pinned grant for this administrator and member. A re-store of the same request keeps
 * its original `created_at`, so retries never extend the expiry. Returns `false` (and the caller
 * keeps the in-memory pin) when there is no scope, the request would not restore, or storage throws.
 */
export function membershipStorePendingGrant(
  storage: MembershipPendingGrantStorage | null,
  admin: string | null,
  uid: number,
  pending: MembershipPendingGrant,
  now: number,
): boolean {
  const key = membershipPendingGrantStorageKey(admin, uid);
  if (!storage || !key) return false;
  const existing = storedPendingGrant(readStoredPendingGrant(storage, key), uid);
  const samePin = existing !== null
    && existing.pending.pinned.body.request_id === pending.pinned.body.request_id
    && existing.pending.pinned.fingerprint === pending.pinned.fingerprint;
  const record = {
    version: 1,
    uid,
    request_id: pending.pinned.body.request_id,
    fingerprint: pending.pinned.fingerprint,
    baseline: { grant_id: pending.baseline.grant_id, revision: pending.baseline.revision },
    created_at: samePin ? existing.createdAt : Math.trunc(now),
  };
  // Never write an entry the restore path would refuse.
  if (!storedPendingGrant(record, uid)) return false;
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Removes the stored pin for this administrator and member; `false` when storage throws. */
export function membershipClearPendingGrant(
  storage: MembershipPendingGrantStorage | null,
  admin: string | null,
  uid: number,
): boolean {
  const key = membershipPendingGrantStorageKey(admin, uid);
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Stores a pinned grant, or clears it once the request is released (success, refusal, discard). */
export function membershipRememberPendingGrant(
  storage: MembershipPendingGrantStorage | null,
  admin: string | null,
  uid: number,
  pending: MembershipPendingGrant | null,
  now: number,
): boolean {
  return pending
    ? membershipStorePendingGrant(storage, admin, uid, pending, now)
    : membershipClearPendingGrant(storage, admin, uid);
}

/**
 * Restores a pinned grant after a page reload. A malformed or foreign entry is removed and ignored;
 * an entry older than the TTL is removed as `expired`. When the freshly loaded member no longer has
 * the baseline grant (identity or revision), the entry is removed as `resolved`, exactly as a
 * refresh releases an in-memory pin. Otherwise the same request comes back pinned with an unknown
 * outcome. An `unavailable` member detail proves nothing about the grant, so the entry is left
 * untouched until a readable detail is loaded.
 */
export function membershipRestorePendingGrant(
  storage: MembershipPendingGrantStorage | null,
  input: { admin: string | null; uid: number; detail: MembershipUserDetail; now: number },
): MembershipPendingGrantRestore {
  const key = membershipPendingGrantStorageKey(input.admin, input.uid);
  if (!storage || !key || input.detail.uid !== input.uid
    || input.detail.effective_membership.lifecycle_state === "unavailable") return { kind: "none" };
  const raw = readStoredPendingGrant(storage, key);
  if (raw === undefined) return { kind: "none" };
  const stored = storedPendingGrant(raw, input.uid);
  if (!stored || stored.createdAt > input.now + PENDING_GRANT_CLOCK_SKEW_MS) {
    membershipClearPendingGrant(storage, input.admin, input.uid);
    return { kind: "none" };
  }
  if (input.now - stored.createdAt > MEMBERSHIP_PENDING_GRANT_TTL_MS) {
    membershipClearPendingGrant(storage, input.admin, input.uid);
    return { kind: "expired" };
  }
  if (membershipGrantChanged(stored.pending.baseline, input.detail)) {
    membershipClearPendingGrant(storage, input.admin, input.uid);
    return { kind: "resolved" };
  }
  return { kind: "restored", pending: stored.pending, request: stored.request, createdAt: stored.createdAt };
}

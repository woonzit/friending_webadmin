/**
 * Strict projection of the App Review sandbox Webadmin responses.
 *
 * The sandbox is the protected reviewer identity plus the scoped fixture built
 * around it. Browser code consumes a closed projection of Core's status payload
 * and never carries the raw document; an unexpected shape decodes to `null`
 * and renders as a load error rather than as a half-drawn page.
 */

export const APP_REVIEW_RESET_CONFIRMATION = "RESET APP REVIEW";

export const APP_REVIEW_CONTROL_STATES = ["absent", "prepared", "ready"] as const;
export type AppReviewControlState = (typeof APP_REVIEW_CONTROL_STATES)[number];

export const APP_REVIEW_RESET_STATES = ["idle", "running", "finishing", "failed"] as const;
export type AppReviewResetState = (typeof APP_REVIEW_RESET_STATES)[number];

export const APP_REVIEW_REPROVISION_STATES = [
  "idle", "deleting", "pending", "provisioning", "failed",
] as const;
export type AppReviewReprovisionState = (typeof APP_REVIEW_REPROVISION_STATES)[number];

export const APP_REVIEW_CHECK_KEYS = [
  "account_active",
  "control",
  "env_uid",
  "env_login",
  "reset_converged",
  "reprovision_converged",
  "reviewer_baseline",
  "profile_semantics",
  "media_files",
  "albums",
  "members",
  "reviewer_photos",
  "counterpart_photos",
  "album_access",
  "friends",
  "friend_requests",
  "visitors",
  "footprints",
  "photo_likes",
  "chat_rooms",
  "chat_messages",
  "mutes",
  "blocks",
  "notifications",
  "plus_grant",
  "verification_grant",
  "dates_activities",
  "dates_memberships",
  "dates_threads",
  "dates_thread_members",
  "dates_messages",
  "dates_notifications",
  "dates_semantics",
  "content",
] as const;
export type AppReviewCheckKey = (typeof APP_REVIEW_CHECK_KEYS)[number];

export const APP_REVIEW_COUNT_KEYS = [
  "members",
  "albums",
  "chat_rooms",
  "chat_messages",
  "friends",
  "friend_requests",
  "visitors",
  "notifications",
  "reviewer_photos",
  "counterpart_photos",
  "album_access",
  "footprints",
  "photo_likes",
  "mutes",
  "blocks",
  "plus_grant",
  "verification_grant",
  "dates_activities",
  "dates_memberships",
  "dates_threads",
  "dates_thread_members",
  "dates_messages",
  "dates_notifications",
] as const;
export type AppReviewCountKey = (typeof APP_REVIEW_COUNT_KEYS)[number];

export type AppReviewCheck = {
  key: AppReviewCheckKey;
  ok: boolean;
  actual: string | number | boolean;
  expected: string | number | boolean;
};

export type AppReviewSandboxStatus = {
  schemaVersion: 1;
  fixture: string;
  fixtureVersion: number;
  contentComplete: boolean;
  control: {
    present: boolean;
    state: AppReviewControlState;
    reviewUid: number;
    resetRevision: number;
    fixtureVersion: number;
    resetState: AppReviewResetState;
    lastResetAt: number;
    lastResetBy: string;
    lastResetRequestId: string;
    resetError: string;
    reprovisionState: AppReviewReprovisionState;
  };
  env: {
    loginEnabled: boolean;
    uidConfigured: number;
    uidMatchesControl: boolean;
    codeConfigured: boolean;
    emailConfigured: boolean;
    phoneConfigured: boolean;
    email?: string;
    phone?: string;
    demoSystemEnabled: boolean;
  };
  ready: boolean;
  resetConfirmation: string;
  counts: Record<AppReviewCountKey, number>;
  media: { expected: number; valid: number; ready: boolean };
  checks: AppReviewCheck[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function decodeCheck(value: unknown): AppReviewCheck | null {
  const raw = object(value);
  if (!raw) return null;
  const key = oneOf(raw.key, APP_REVIEW_CHECK_KEYS);
  const ok = bool(raw.ok);
  const actual = scalar(raw.actual);
  const expected = scalar(raw.expected);
  if (key === null || ok === null || actual === null || expected === null) return null;
  return { key, ok, actual, expected };
}

/** Decode Core's `app_review_sandbox_status` data block. `null` on any shape surprise. */
export function appReviewSandboxStatus(value: unknown): AppReviewSandboxStatus | null {
  const raw = object(value);
  if (!raw || raw.schema_version !== 1) return null;
  const control = object(raw.control);
  const env = object(raw.env);
  const counts = object(raw.counts);
  const media = object(raw.media);
  if (!control || !env || !counts || !media || !Array.isArray(raw.checks)) return null;

  const fixture = text(raw.fixture);
  const fixtureVersion = nonNegative(raw.fixture_version);
  const contentComplete = bool(raw.content_complete);
  const ready = bool(raw.ready);
  const resetConfirmation = text(raw.reset_confirmation);
  if (
    fixture === null || fixtureVersion === null || contentComplete === null ||
    ready === null || resetConfirmation === null
  ) {
    return null;
  }

  const present = bool(control.present);
  const state = oneOf(control.state, APP_REVIEW_CONTROL_STATES);
  const reviewUid = nonNegative(control.review_uid);
  const resetRevision = nonNegative(control.reset_revision);
  const controlFixtureVersion = nonNegative(control.fixture_version);
  const resetState = oneOf(control.reset_state, APP_REVIEW_RESET_STATES);
  const lastResetAt = nonNegative(control.last_reset_at);
  const lastResetBy = text(control.last_reset_by);
  const lastResetRequestId = text(control.last_reset_request_id);
  const resetError = text(control.reset_error);
  const reprovisionState = oneOf(control.reprovision_state, APP_REVIEW_REPROVISION_STATES);
  if (
    present === null || state === null || reviewUid === null || resetRevision === null ||
    controlFixtureVersion === null || resetState === null || lastResetAt === null ||
    lastResetBy === null || lastResetRequestId === null || resetError === null ||
    reprovisionState === null
  ) {
    return null;
  }

  const loginEnabled = bool(env.login_enabled);
  const uidConfigured = nonNegative(env.uid_configured);
  const uidMatchesControl = bool(env.uid_matches_control);
  const codeConfigured = bool(env.code_configured);
  const emailConfigured = bool(env.email_configured);
  const phoneConfigured = bool(env.phone_configured);
  const email = env.email === undefined ? undefined : text(env.email);
  const phone = env.phone === undefined ? undefined : text(env.phone);
  const demoSystemEnabled = bool(env.demo_system_enabled);
  if (
    loginEnabled === null || uidConfigured === null || uidMatchesControl === null ||
    codeConfigured === null || emailConfigured === null || phoneConfigured === null ||
    email === null || phone === null || demoSystemEnabled === null
  ) {
    return null;
  }

  const decodedCounts = {} as Record<AppReviewCountKey, number>;
  for (const key of APP_REVIEW_COUNT_KEYS) {
    if (!Object.hasOwn(counts, key)) return null;
    const count = nonNegative(counts[key]);
    if (count === null) return null;
    decodedCounts[key] = count;
  }

  const checks: AppReviewCheck[] = [];
  const seenChecks = new Set<AppReviewCheckKey>();
  for (const entry of raw.checks) {
    const check = decodeCheck(entry);
    if (!check || seenChecks.has(check.key)) return null;
    seenChecks.add(check.key);
    checks.push(check);
  }
  if (seenChecks.size !== APP_REVIEW_CHECK_KEYS.length) return null;

  const mediaExpected = nonNegative(media.expected);
  const mediaValid = nonNegative(media.valid);
  const mediaReady = bool(media.ready);
  if (
    mediaExpected === null || mediaValid === null || mediaReady === null ||
    mediaValid > mediaExpected || mediaReady !== (mediaExpected > 0 && mediaValid === mediaExpected)
  ) return null;

  return {
    schemaVersion: 1,
    fixture,
    fixtureVersion,
    contentComplete,
    control: {
      present,
      state,
      reviewUid,
      resetRevision,
      fixtureVersion: controlFixtureVersion,
      resetState,
      lastResetAt,
      lastResetBy,
      lastResetRequestId,
      resetError,
      reprovisionState,
    },
    env: {
      loginEnabled,
      uidConfigured,
      uidMatchesControl,
      codeConfigured,
      emailConfigured,
      phoneConfigured,
      email,
      phone,
      demoSystemEnabled,
    },
    ready,
    resetConfirmation,
    counts: decodedCounts,
    media: { expected: mediaExpected, valid: mediaValid, ready: mediaReady },
    checks,
  };
}

export type AppReviewResetResult = {
  status: AppReviewSandboxStatus;
  replayed: boolean;
};

export type AppReviewPendingReset = {
  requestId: string;
  expectedRevision: number;
};

/** Decode Core's `app_review_sandbox_reset` data block. */
export function appReviewResetResult(value: unknown): AppReviewResetResult | null {
  const raw = object(value);
  if (!raw) return null;
  const status = appReviewSandboxStatus(raw.status);
  const replayed = bool(raw.replayed);
  if (!status || replayed === null) return null;
  return { status, replayed };
}

/**
 * Every refusal the reset route can answer, mapped to an `appReview.errors.*`
 * message key. Unknown names fall to the generic entry so an unlisted Core
 * refusal still reads as a refusal, never as a blank line.
 */
export const APP_REVIEW_RESET_ERROR_KEYS = {
  "invalid-request-id": "invalidRequestId",
  "confirmation-required": "confirmationRequired",
  "invalid-revision": "invalidRevision",
  "revision-conflict": "revisionConflict",
  "reset-in-progress": "resetInProgress",
  "idempotency-conflict": "idempotencyConflict",
  "review-account-missing": "reviewAccountMissing",
  "review-account-state-invalid": "reviewAccountStateInvalid",
  "review-counterparts-invalid": "reviewCounterpartsInvalid",
  "transactions-unavailable": "transactionsUnavailable",
  "reset-failed": "resetFailed",
  "admin-write-required": "writeRequired",
  "admin-revoked": "writeRequired",
  "admin-session-invalid": "writeRequired",
  "app-review-sandbox-unavailable": "unavailable",
} as const;

export type AppReviewResetErrorKey =
  | (typeof APP_REVIEW_RESET_ERROR_KEYS)[keyof typeof APP_REVIEW_RESET_ERROR_KEYS]
  | "generic";

export function appReviewResetErrorKey(error: unknown): AppReviewResetErrorKey {
  const name = typeof error === "string" ? error : "";
  // A Map lookup, not a property read: `constructor` must not resolve to a key.
  const table = new Map<string, AppReviewResetErrorKey>(
    Object.entries(APP_REVIEW_RESET_ERROR_KEYS),
  );
  return table.get(name) ?? "generic";
}

const APP_REVIEW_RESET_TERMINAL_INPUT_ERRORS = new Set([
  "invalid-request-id",
  "confirmation-required",
  "invalid-revision",
  "revision-conflict",
  "idempotency-conflict",
]);

/**
 * Network/service failures and a failed post-commit convergence are retryable
 * with the exact same idempotency key. Only authoritative input conflicts end
 * that request and permit the next gesture to mint a new UUID.
 */
export function appReviewResetShouldRetainRequest(error: unknown): boolean {
  return !APP_REVIEW_RESET_TERMINAL_INPUT_ERRORS.has(typeof error === "string" ? error : "");
}

export function appReviewPendingReset(value: unknown): AppReviewPendingReset | null {
  const raw = object(value);
  if (!raw) return null;
  const requestId = text(raw.requestId);
  const expectedRevision = nonNegative(raw.expectedRevision);
  if (
    requestId === null
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || expectedRevision === null
  ) return null;
  return { requestId: requestId.toLowerCase(), expectedRevision };
}

/** True only after Core has published this request's fully converged revision. */
export function appReviewResetConverged(
  status: AppReviewSandboxStatus,
  pending: AppReviewPendingReset,
): boolean {
  return status.control.resetState === "idle"
    && status.control.reprovisionState === "idle"
    && status.control.lastResetRequestId === pending.requestId
    && status.control.resetRevision === pending.expectedRevision + 1
    && status.ready;
}

/**
 * A reset is offered only when it can succeed: a present, ready control
 * record and no reset currently holding the lease. `ready` is deliberately NOT
 * a precondition — the reset is how a not-ready sandbox becomes ready.
 */
export function appReviewResetAvailable(
  status: AppReviewSandboxStatus,
  hasPendingRequest = false,
): boolean {
  return status.control.present
    && status.control.state === "ready"
    && status.control.reprovisionState === "idle"
    && (
      status.control.resetState === "idle"
      || status.control.resetState === "failed"
      || (status.control.resetState === "finishing" && hasPendingRequest)
    );
}

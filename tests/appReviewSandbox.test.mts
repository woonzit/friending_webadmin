import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APP_REVIEW_CHECK_KEYS,
  APP_REVIEW_COUNT_KEYS,
  APP_REVIEW_RESET_CONFIRMATION,
  APP_REVIEW_RESET_ERROR_KEYS,
  appReviewPendingReset,
  appReviewResetAvailable,
  appReviewResetConverged,
  appReviewResetErrorKey,
  appReviewResetResult,
  appReviewResetShouldRetainRequest,
  appReviewSandboxStatus,
} from "../lib/appReviewSandbox.ts";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";

function statusFixture(): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const key of APP_REVIEW_COUNT_KEYS) counts[key] = 0;
  return {
    schema_version: 1,
    fixture: "app_review_v1",
    fixture_version: 3,
    content_complete: true,
    control: {
      present: true,
      state: "ready",
      review_uid: 626001,
      reset_revision: 2,
      fixture_version: 3,
      reset_state: "idle",
      last_reset_at: 1787000000,
      last_reset_by: "owner@friending.com",
      last_reset_request_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      reset_error: "",
      reprovision_state: "idle",
    },
    env: {
      login_enabled: true,
      uid_configured: 626001,
      uid_matches_control: true,
      code_configured: true,
      email_configured: true,
      phone_configured: true,
      email: "review@friending.com",
      phone: "15128014040",
      demo_system_enabled: true,
    },
    ready: true,
    reset_confirmation: APP_REVIEW_RESET_CONFIRMATION,
    counts,
    media: { expected: 58, valid: 58, ready: true },
    checks: APP_REVIEW_CHECK_KEYS.map((key) => ({ key, ok: true, actual: 1, expected: 1 })),
  };
}

/**
 * Pinned from Core c0a4212: fixed checks and counts come from
 * `src/Services/AppReviewSandboxService.php`; ordered fixture checks come from
 * `src/Services/AppReviewFixtureV1.php`; Dates counts come from
 * `src/Services/AppReviewDatesFixtureService.php`.
 */
test("the pinned Core c0a4212 status decodes and owns the exact closed key order and set", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/app_review_sandbox/status-core-c0a4212.json", import.meta.url),
    "utf8",
  )) as { source_commit: unknown; status: Record<string, unknown> };
  assert.deepEqual(Object.keys(fixture), ["source_commit", "status"]);
  assert.equal(fixture.source_commit, "c0a4212710bff4f3eafd5879c3536289f87c644b");

  const rawChecks = fixture.status.checks as Array<{ key: string }>;
  const rawCounts = fixture.status.counts as Record<string, unknown>;
  const checkKeys = rawChecks.map((check) => check.key);
  const countKeys = Object.keys(rawCounts);
  assert.deepEqual(checkKeys, [...APP_REVIEW_CHECK_KEYS], "Core check display order equals the Webadmin closed list");
  assert.deepEqual(countKeys, [...APP_REVIEW_COUNT_KEYS], "Core count insertion order equals the Webadmin closed list");
  assert.equal(new Set(checkKeys).size, checkKeys.length, "Core check keys are a set, with no duplicates");
  assert.equal(new Set(countKeys).size, countKeys.length, "Core count keys are a set, with no duplicates");
  assert.deepEqual([...new Set(checkKeys)].sort(), [...APP_REVIEW_CHECK_KEYS].sort(), "Core and Webadmin check sets are equal");
  assert.deepEqual([...new Set(countKeys)].sort(), [...APP_REVIEW_COUNT_KEYS].sort(), "Core and Webadmin count sets are equal");

  const decoded = appReviewSandboxStatus(fixture.status);
  assert.ok(decoded, "the full Core-derived status is accepted by the fail-closed decoder");
  assert.deepEqual(decoded.checks.map((check) => check.key), checkKeys);
  assert.deepEqual(Object.keys(decoded.counts), countKeys);
});

test("the status decoder accepts the documented shape and projects it", () => {
  const status = appReviewSandboxStatus(statusFixture());
  assert.ok(status);
  assert.equal(status.control.reviewUid, 626001);
  assert.equal(status.control.resetRevision, 2);
  assert.equal(status.env.uidMatchesControl, true);
  assert.equal(status.env.email, "review@friending.com");
  assert.equal(status.media.ready, true);
  assert.equal(status.ready, true);
  assert.equal(status.checks.length, APP_REVIEW_CHECK_KEYS.length);
  assert.equal(status.checks.at(-1)?.key, "content");
  assert.equal(status.resetConfirmation, "RESET APP REVIEW");
});

test("viewer status may hide identifiers while retaining configuration evidence", () => {
  const raw = statusFixture();
  delete (raw.env as Record<string, unknown>).email;
  delete (raw.env as Record<string, unknown>).phone;
  const status = appReviewSandboxStatus(raw);
  assert.ok(status);
  assert.equal(status.env.email, undefined);
  assert.equal(status.env.phone, undefined);
  assert.equal(status.env.emailConfigured, true);
  assert.equal(status.env.phoneConfigured, true);
});

test("unknown count witnesses are ignored while missing or invalid known material fails closed", () => {
  const additive = statusFixture();
  (additive.counts as Record<string, unknown>).invented = 1;
  assert.deepEqual(appReviewSandboxStatus(additive), appReviewSandboxStatus(statusFixture()));

  const cases: Array<(raw: Record<string, unknown>) => void> = [
    (raw) => { raw.schema_version = 2; },
    (raw) => { delete raw.control; },
    (raw) => { (raw.control as Record<string, unknown>).state = "unknown"; },
    (raw) => { (raw.control as Record<string, unknown>).reset_state = "paused"; },
    (raw) => { (raw.control as Record<string, unknown>).reprovision_state = "restoring"; },
    (raw) => { (raw.control as Record<string, unknown>).review_uid = -1; },
    (raw) => { (raw.env as Record<string, unknown>).login_enabled = "yes"; },
    (raw) => { delete (raw.counts as Record<string, unknown>).members; },
    (raw) => { (raw.checks as unknown[]).pop(); },
    (raw) => { (raw.checks as unknown[])[1] = (raw.checks as unknown[])[0]; },
    (raw) => { (raw.checks as unknown[]).push({ key: "invented", ok: true, actual: 1, expected: 1 }); },
    (raw) => { (raw.checks as unknown[]).push({ key: "members", ok: "true", actual: 1, expected: 1 }); },
    (raw) => { (raw.media as Record<string, unknown>).valid = 57; },
    (raw) => { (raw.media as Record<string, unknown>).ready = "yes"; },
    (raw) => { raw.ready = 1; },
    (raw) => { delete raw.reset_confirmation; },
  ];
  for (const mutate of cases) {
    const raw = statusFixture();
    mutate(raw);
    assert.equal(appReviewSandboxStatus(raw), null, `expected null for ${mutate.toString()}`);
  }
  assert.equal(appReviewSandboxStatus(null), null);
  assert.equal(appReviewSandboxStatus([]), null);
});

test("the reset result carries the status and the replay flag", () => {
  const result = appReviewResetResult({ status: statusFixture(), replayed: true });
  assert.ok(result);
  assert.equal(result.replayed, true);
  assert.equal(result.status.control.resetRevision, 2);
  assert.equal(appReviewResetResult({ status: statusFixture() }), null);
  assert.equal(appReviewResetResult({ status: {}, replayed: false }), null);
});

test("every reset refusal Core names has a message key, and unknowns fall to generic", () => {
  for (const [name, key] of Object.entries(APP_REVIEW_RESET_ERROR_KEYS)) {
    assert.equal(appReviewResetErrorKey(name), key);
  }
  assert.equal(appReviewResetErrorKey("something-new"), "generic");
  assert.equal(appReviewResetErrorKey(undefined), "generic");
  // A prototype name must not resolve through the lookup.
  assert.equal(appReviewResetErrorKey("constructor"), "generic");
});

test("only terminal input conflicts discard an idempotent reset request", () => {
  for (const error of [
    "invalid-request-id", "confirmation-required", "invalid-revision",
    "revision-conflict", "idempotency-conflict",
  ]) {
    assert.equal(appReviewResetShouldRetainRequest(error), false, error);
  }
  for (const error of [
    undefined, "reset-in-progress", "reset-failed", "transactions-unavailable",
    "app-review-sandbox-unavailable", "review-account-state-invalid",
    "review-counterparts-invalid",
  ]) {
    assert.equal(appReviewResetShouldRetainRequest(error), true, String(error));
  }
});

test("pending request persistence is strict and convergence names the exact request", () => {
  const pending = appReviewPendingReset({
    requestId: "6F1C2D3E-4A5B-4C6D-8E9F-0A1B2C3D4E5F",
    expectedRevision: 1,
  });
  assert.deepEqual(pending, {
    requestId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    expectedRevision: 1,
  });
  const status = appReviewSandboxStatus(statusFixture());
  assert.ok(status && pending);
  assert.equal(appReviewResetConverged(status, pending), true);
  assert.equal(appReviewResetConverged(status, { ...pending, requestId: crypto.randomUUID() }), false);
  status.ready = false;
  assert.equal(appReviewResetConverged(status, pending), false);
  assert.equal(appReviewPendingReset({ requestId: "not-a-uuid", expectedRevision: 1 }), null);
  assert.equal(appReviewPendingReset({ requestId: pending.requestId, expectedRevision: -1 }), null);
});

test("a reset is offered only from a ready control record that is not mid-reset", () => {
  const ready = appReviewSandboxStatus(statusFixture());
  assert.ok(ready);
  assert.equal(appReviewResetAvailable(ready), true);

  const running = appReviewSandboxStatus({
    ...statusFixture(),
    control: { ...(statusFixture().control as Record<string, unknown>), reset_state: "running" },
  });
  assert.ok(running);
  assert.equal(appReviewResetAvailable(running), false);

  const finishing = appReviewSandboxStatus({
    ...statusFixture(),
    control: { ...(statusFixture().control as Record<string, unknown>), reset_state: "finishing" },
  });
  assert.ok(finishing);
  assert.equal(appReviewResetAvailable(finishing), false);
  assert.equal(appReviewResetAvailable(finishing, true), true);

  const reprovisioning = appReviewSandboxStatus({
    ...statusFixture(),
    control: { ...(statusFixture().control as Record<string, unknown>), reprovision_state: "provisioning" },
  });
  assert.ok(reprovisioning);
  assert.equal(appReviewResetAvailable(reprovisioning, true), false);

  const absent = appReviewSandboxStatus({
    ...statusFixture(),
    control: {
      ...(statusFixture().control as Record<string, unknown>),
      present: false,
      state: "absent",
      review_uid: 0,
    },
  });
  assert.ok(absent);
  assert.equal(appReviewResetAvailable(absent), false);

  // Readiness itself is not a precondition; reset is also the repair action.
  ready.ready = false;
  assert.equal(appReviewResetAvailable(ready), true);
});

test("the two actions are allow-listed with the read/write split the design names", () => {
  assert.ok(ADMIN_ACTIONS.includes("app_review_sandbox_status" as never));
  assert.ok(ADMIN_ACTIONS.includes("app_review_sandbox_reset" as never));
  assert.equal(adminActionAccess("app_review_sandbox_status"), "read");
  assert.equal(adminActionAccess("app_review_sandbox_reset"), "write");
});

test("the closed key lists are the ones the page renders", () => {
  assert.deepEqual([...APP_REVIEW_CHECK_KEYS], [
    "account_active", "control", "env_uid", "env_login", "reset_converged", "reprovision_converged",
    "reviewer_baseline", "profile_semantics", "media_files", "albums", "members", "reviewer_photos",
    "counterpart_photos", "album_access", "friends", "friend_requests", "visitors", "footprints",
    "photo_likes", "chat_rooms", "chat_messages", "mutes", "blocks", "notifications", "plus_grant",
    "verification_grant",
    "dates_activities", "dates_memberships", "dates_threads", "dates_thread_members", "dates_messages",
    "dates_notifications", "dates_semantics", "content",
  ]);
  assert.deepEqual([...APP_REVIEW_COUNT_KEYS], [
    "members", "albums", "chat_rooms", "chat_messages", "friends", "friend_requests",
    "visitors", "notifications", "reviewer_photos", "counterpart_photos", "album_access",
    "footprints", "photo_likes", "mutes", "blocks", "plus_grant", "verification_grant", "dates_activities",
    "dates_memberships", "dates_threads", "dates_thread_members", "dates_messages", "dates_notifications",
  ]);
});

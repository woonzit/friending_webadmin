import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_ADDRESS_RULE,
  clientAddress,
  createRequestThrottle,
  isAdminWriteRole,
  normalizeAdminRole,
  readBoundedJsonObject,
  requestCodeFailure,
  throttleKey,
  verifyCodeFailure,
} from "../lib/authPolicy.ts";
import {
  createSessionRevocationList,
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  verifyActiveSessionToken,
  verifySessionToken,
} from "../lib/sessionCodec.ts";

const secret = "a".repeat(64);
const now = 1_800_000_000;

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

test("login throttle allows a normal sign-in and denies a grinding caller", () => {
  const throttle = createRequestThrottle({ limit: 3, windowSeconds: 600 });
  const key = throttleKey("203.0.113.9", "owner@example.com");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(throttle.check(key, now + attempt).allowed, true);
  }
  const denied = throttle.check(key, now + 10);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 590);
  // Denial does not extend the window; the caller is admitted again after it.
  assert.equal(throttle.check(key, now + 600).allowed, true);
});

test("login throttle keys are independent and the address rule admits real console use", () => {
  const throttle = createRequestThrottle(AUTH_ADDRESS_RULE);
  const office = "198.51.100.4";
  for (let call = 0; call < AUTH_ADDRESS_RULE.limit; call += 1) {
    assert.equal(throttle.check(office, now).allowed, true);
  }
  assert.equal(throttle.check(office, now).allowed, false);
  assert.equal(throttle.check("198.51.100.5", now).allowed, true);
  // A real sign-in costs one request_code plus one or two verify_code calls, so
  // the office budget covers many administrators inside one window.
  assert.ok(AUTH_ADDRESS_RULE.limit >= 12);
});

test("login throttle bounds its key map and evicts instead of growing", () => {
  const throttle = createRequestThrottle({ limit: 1, windowSeconds: 600 }, 8);
  for (let index = 0; index < 500; index += 1) {
    throttle.check(throttleKey("203.0.113.9", `attacker-${index}@example.com`), now);
  }
  assert.equal(throttle.size(), 8);
  // Expired windows are reclaimed rather than evicted.
  throttle.check("fresh@example.com", now + 600);
  assert.ok(throttle.size() <= 8);
});

test("the throttle key uses the address Apache saw, not the one the caller claimed", () => {
  assert.equal(
    clientAddress(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })),
    "203.0.113.9",
  );
  assert.equal(clientAddress(headers({ "x-real-ip": "203.0.113.10" })), "203.0.113.10");
  // No forwarded address means no caller-scoped key, so the routes skip the
  // per-address rule rather than throttling every administrator on one shared key.
  assert.equal(clientAddress(headers({})), "");
  assert.equal(clientAddress(headers({ "x-forwarded-for": " , " })), "");
});

test("every verify-code failure Core can distinguish looks identical to the client", () => {
  const outcomes = [
    verifyCodeFailure(401, "invalid"),
    verifyCodeFailure(410, "expired"),
    verifyCodeFailure(401, "invalid-code"),
    verifyCodeFailure(500, "query-failed"),
    verifyCodeFailure(200, undefined),
  ];
  for (const outcome of outcomes) {
    assert.deepEqual(outcome, { status: 401, error: "invalid" });
  }
});

test("verify-code keeps only the already-identified ban and this server's own outage separable", () => {
  assert.deepEqual(verifyCodeFailure(429, "banned"), { status: 429, error: "banned" });
  assert.deepEqual(
    verifyCodeFailure(502, "core-unavailable"),
    { status: 502, error: "request-failed" },
  );
  // A Core response that merely claims the transport failed is still collapsed.
  assert.deepEqual(verifyCodeFailure(401, "core-unavailable"), { status: 401, error: "invalid" });
  // A Core timeout is a 504 carrying its own code. On the admin bridge that distinction matters,
  // because a mutation may still have landed; on the login path it tells an unauthenticated caller
  // nothing about the address, so it collapses into the same single answer as every other outage.
  assert.deepEqual(
    verifyCodeFailure(504, "core-timeout"),
    { status: 502, error: "request-failed" },
  );
  assert.deepEqual(
    requestCodeFailure(504, "core-timeout"),
    { status: 502, error: "request-failed" },
  );
  // The client must never receive the raw transport code, or the login form falls through to its
  // generic branch and a second distinguishable outage state leaks.
  for (const failure of [verifyCodeFailure(504, "core-timeout"), requestCodeFailure(504, "core-timeout")]) {
    assert.notEqual(failure.error, "core-timeout");
  }
});

test("request-code collapses account state the same way", () => {
  for (const error of ["cooldown", "hourly-cap", "invalid-email", "query-failed"]) {
    assert.deepEqual(requestCodeFailure(429, error), { status: 502, error: "request-failed" });
  }
  assert.deepEqual(requestCodeFailure(429, "banned"), { status: 429, error: "banned" });
});

test("only owner and admin roles may write; viewer, unknown and absent roles may not", () => {
  assert.equal(isAdminWriteRole("owner"), true);
  assert.equal(isAdminWriteRole(" Admin "), true);
  assert.equal(isAdminWriteRole("viewer"), false);
  assert.equal(isAdminWriteRole("something-new"), false);
  // A membership response Core cannot produce must not open the write path.
  assert.equal(isAdminWriteRole(undefined), false);
  assert.equal(isAdminWriteRole(""), false);
  // Display and authorization now agree on malformed membership data.
  assert.equal(normalizeAdminRole(null), "");
  assert.equal(normalizeAdminRole("something-new"), "");
  assert.equal(normalizeAdminRole(" Viewer "), "viewer");
});

test("public auth JSON parsing enforces declared and actual byte limits", async () => {
  const request = (raw: string, declared?: string) => ({
    headers: headers(declared === undefined ? {} : { "content-length": declared }),
    text: async () => raw,
  });

  assert.deepEqual(
    await readBoundedJsonObject(request('{"email":"owner@example.com"}'), 64),
    { kind: "ok", value: { email: "owner@example.com" } },
  );
  assert.deepEqual(
    await readBoundedJsonObject(request('{"email":"owner@example.com"}', "4097"), 4096),
    { kind: "too-large" },
  );
  assert.deepEqual(
    await readBoundedJsonObject(request(JSON.stringify({ value: "é".repeat(40) })), 64),
    { kind: "too-large" },
  );
  assert.deepEqual(await readBoundedJsonObject(request("[]"), 64), { kind: "invalid" });
  assert.deepEqual(await readBoundedJsonObject(request("{"), 64), { kind: "invalid" });
});

test("logout makes a previously valid session token unusable without touching other sessions", () => {
  const revocations = createSessionRevocationList();
  const token = createSessionToken("owner@example.com", secret, now);
  const other = createSessionToken("second@example.com", secret, now);
  assert.equal(verifyActiveSessionToken(token, secret, now + 60, revocations)?.email, "owner@example.com");

  const payload = verifySessionToken(token, secret, now + 60);
  assert.ok(payload);
  revocations.revoke(payload.nonce, payload.exp, now + 60);

  assert.equal(verifyActiveSessionToken(token, secret, now + 120, revocations), null);
  // The signature and expiry are still perfectly valid — only the nonce is denied.
  assert.equal(verifySessionToken(token, secret, now + 120)?.email, "owner@example.com");
  // A concurrent session of another administrator is unaffected.
  assert.equal(
    verifyActiveSessionToken(other, secret, now + 120, revocations)?.email,
    "second@example.com",
  );
});

test("the revocation list drops entries once the token they cover has expired", () => {
  const revocations = createSessionRevocationList();
  const token = createSessionToken("owner@example.com", secret, now);
  const payload = verifySessionToken(token, secret, now);
  assert.ok(payload);
  revocations.revoke(payload.nonce, payload.exp, now);
  assert.equal(revocations.size(), 1);
  assert.equal(revocations.isRevoked(payload.nonce, now + SESSION_MAX_AGE_SECONDS), false);
  assert.equal(revocations.size(), 0);
  // A nonce for an already-expired token is never stored.
  revocations.revoke(payload.nonce, payload.exp, now + SESSION_MAX_AGE_SECONDS);
  assert.equal(revocations.size(), 0);
});

test("the revocation list is bounded and rejects malformed nonces", () => {
  const revocations = createSessionRevocationList(4);
  for (let index = 0; index < 50; index += 1) {
    revocations.revoke(`nonce${String(index).padStart(16, "0")}`, now + 100, now);
  }
  assert.equal(revocations.size(), 4);
  revocations.revoke("short", now + 100, now);
  assert.equal(revocations.isRevoked("short", now), false);
});

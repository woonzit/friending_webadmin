import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "../lib/sessionCodec.ts";

const secret = "a".repeat(64);
const otherSecret = "b".repeat(64);
const now = 1_800_000_000;

test("session codec round-trips a normalized admin email", () => {
  const token = createSessionToken(" Admin@Example.COM ", secret, now);
  const payload = verifySessionToken(token, secret, now + 10);
  assert.equal(payload?.email, "admin@example.com");
  assert.equal(payload?.iat, now);
  assert.equal(payload?.exp, now + SESSION_MAX_AGE_SECONDS);
});

test("session codec rejects tampering and the wrong key", () => {
  const token = createSessionToken("admin@example.com", secret, now);
  const [payload, signature] = token.split(".");
  assert.equal(verifySessionToken(`${payload}x.${signature}`, secret, now), null);
  assert.equal(verifySessionToken(token, otherSecret, now), null);
});

test("session codec rejects expired and implausible tokens", () => {
  const token = createSessionToken("admin@example.com", secret, now);
  assert.equal(verifySessionToken(token, secret, now + SESSION_MAX_AGE_SECONDS), null);
  assert.equal(verifySessionToken(token, secret, now - 120), null);
  assert.equal(verifySessionToken("not-a-token", secret, now), null);
});

test("session codec requires a valid email and a long signing key", () => {
  assert.throws(() => createSessionToken("invalid", secret, now), /invalid-session-email/);
  assert.throws(
    () => createSessionToken("admin@example.com", "short", now),
    /session-secret-too-short/,
  );
});

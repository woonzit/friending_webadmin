import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createSessionToken,
  legacySessionUpgrade,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "../lib/sessionCodec.ts";

const secret = "a".repeat(64);
const otherSecret = "b".repeat(64);
const now = 1_800_000_000;

function signedLifetime(seconds: number): string {
  const payload = JSON.parse(Buffer.from(createSessionToken("admin@example.com", secret, now).split(".")[0], "base64url").toString());
  payload.exp = now + seconds;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

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

test("a new session lasts a full day, including beyond the previous twelve-hour boundary", () => {
  const token = createSessionToken("admin@example.com", secret, now);
  assert.ok(verifySessionToken(token, secret, now + 12 * 3600 + 1));
  assert.ok(verifySessionToken(token, secret, now + 24 * 3600 - 1));
  assert.equal(verifySessionToken(token, secret, now + 24 * 3600), null);
});

test("old twelve-hour sessions retain their real expiry; other signed lifetimes stay invalid", () => {
  const token = signedLifetime(12 * 3600);
  assert.ok(verifySessionToken(token, secret, now + 12 * 3600 - 1));
  assert.equal(verifySessionToken(token, secret, now + 12 * 3600), null);
  for (const hours of [1, 13, 25, 48]) assert.equal(verifySessionToken(signedLifetime(hours * 3600), secret, now + 1), null);
});

test("a legacy upgrade preserves sign-in time, aligns the cookie expiry and never rolls again", () => {
  const session = verifySessionToken(signedLifetime(12 * 3600), secret, now + 3600);
  assert.ok(session);
  const upgrade = legacySessionUpgrade(session, secret, now + 3600);
  assert.ok(upgrade);
  assert.equal(upgrade.maxAge, 23 * 3600);
  const upgraded = verifySessionToken(upgrade.token, secret, now + 13 * 3600);
  assert.ok(upgraded);
  assert.equal(upgraded.iat, now);
  assert.equal(upgraded.exp, now + 24 * 3600);
  assert.equal(legacySessionUpgrade(upgraded, secret, now + 13 * 3600), null);
  assert.equal(legacySessionUpgrade(session, secret, now + 12 * 3600), null);
});

test("session codec requires a valid email and a long signing key", () => {
  assert.throws(() => createSessionToken("invalid", secret, now), /invalid-session-email/);
  assert.throws(
    () => createSessionToken("admin@example.com", "short", now),
    /session-secret-too-short/,
  );
});

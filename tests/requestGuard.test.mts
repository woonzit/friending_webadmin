import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isSameOrigin,
  isTrustedAdminMediaRead,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

test("same-origin requests with the admin marker are trusted", () => {
  const value = headers({
    origin: "https://webadmin.freelove.hu",
    host: "webadmin.freelove.hu",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  });
  assert.equal(isSameOrigin(value), true);
  assert.equal(isTrustedAdminRequest(value), true);
});

test("foreign, missing-origin and unmarked requests fail closed", () => {
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://freelove.hu",
    host: "webadmin.freelove.hu",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    host: "webadmin.freelove.hu",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://webadmin.freelove.hu",
    host: "webadmin.freelove.hu",
  })), false);
});

test("host comparison includes the development port", () => {
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3004",
    host: "localhost:3004",
  })), true);
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3005",
    host: "localhost:3004",
  })), false);
});

test("private media subresources require a same-host source and fail direct or cross-site opens", () => {
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://webadmin.freelove.hu/profile-verification/abc",
    host: "webadmin.freelove.hu",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    origin: "https://webadmin.freelove.hu",
    host: "webadmin.freelove.hu",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "webadmin.freelove.hu",
    "sec-fetch-site": "none",
  })), false, "a copied evidence URL may not be opened directly");
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://evil.example/",
    host: "webadmin.freelove.hu",
    "sec-fetch-site": "cross-site",
  })), false);
});

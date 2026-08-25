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
  assert.equal(ADMIN_REQUEST_HEADER, "x-friending-admin-request");
  const value = headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  });
  assert.equal(isSameOrigin(value), true);
  assert.equal(isTrustedAdminRequest(value), true);
});

test("foreign, missing-origin and unmarked requests fail closed", () => {
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friending.com",
    host: "friendingapp.com",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    host: "friendingapp.com",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
  })), false);
});

test("host comparison includes the development port", () => {
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3006",
    host: "localhost:3006",
  })), true);
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3005",
    host: "localhost:3006",
  })), false);
});

test("private media subresources require a same-host source and fail direct or cross-site opens", () => {
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://friendingapp.com/profile-verification/abc",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "none",
  })), false, "a copied evidence URL may not be opened directly");
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://evil.example/",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
  })), false);
});

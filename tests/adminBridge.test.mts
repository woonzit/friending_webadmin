import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminBridgeCoreTransportError,
  adminBridgeErrorEnvelope,
} from "../lib/adminBridge.ts";

test("the same-origin bridge refusal is exact and carries its logical status", () => {
  assert.deepEqual(adminBridgeErrorEnvelope({
    success: false,
    status_code: 403,
    error: "admin-write-required",
  }), {
    success: false,
    status_code: 403,
    error: "admin-write-required",
  });

  for (const malformed of [
    { success: false, error: "admin-write-required" },
    { success: false, status_code: "403", error: "admin-write-required" },
    { success: false, status_code: 399, error: "admin-write-required" },
    { success: true, status_code: 403, error: "admin-write-required" },
    { success: false, status_code: 403, error: "" },
    { success: false, status_code: 403, error: "admin-write-required", detail: "extra" },
  ]) assert.equal(adminBridgeErrorEnvelope(malformed), null, JSON.stringify(malformed));
});

test("only exact coreCall transport failures gain a bridge status", () => {
  for (const [error, status] of [
    ["core-timeout", 504],
    ["core-unavailable", 502],
    ["invalid-core-response", 502],
  ] as const) {
    assert.deepEqual(adminBridgeCoreTransportError(status, { success: false, error }), {
      success: false,
      status_code: status,
      error,
    });
  }

  for (const [status, malformed] of [
    [502, { success: false, error: "core-timeout" }],
    [504, { success: false, error: "core-unavailable" }],
    [504, { success: false, error: "invalid-core-response" }],
    [502, { success: false, error: "core-unavailable", detail: "extra" }],
    [502, { success: true, error: "core-unavailable" }],
    [502, { success: false, error: "invented" }],
    [502, null],
  ] as const) assert.equal(adminBridgeCoreTransportError(status, malformed), null);
});

test("every generic bridge-generated refusal uses the status-bearing response helper", async () => {
  const route = await readFile(
    new URL("../app/api/admin/[action]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /\{ success: false, status_code: status, error \}/,
    "the response body carries the same logical status as HTTP",
  );
  assert.match(
    route,
    /adminBridgeCoreTransportError\(result\.status, result\.data\)[\s\S]*?bridgeError\(transportError\.error, transportError\.status_code\)/,
    "coreCall transport failures leave the generic proxy through bridgeError",
  );
  for (const [error, status] of [
    ["bad-origin", 403],
    ["not-found", 404],
    ["too-large", 413],
    ["auth-required", 401],
    ["persona-capability-required", 403],
    ["admin-write-required", 403],
    ["invalid-input", 400],
  ] as const) {
    assert.match(route, new RegExp(`bridgeError\\("${error}", ${status}\\)`), error);
  }
  assert.doesNotMatch(route, /NextResponse\.json\(\{ success: false, error:/);
});

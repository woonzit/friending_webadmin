import test from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

const EMPTY_MODULE_URL = "data:text/javascript,";
const LOADER_SOURCE = `export function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" };
  return next(specifier, context);
}`;
type ResolveNext = (specifier: string, context: unknown) => unknown;
type ResolveHook = (specifier: string, context: unknown, next: ResolveNext) => unknown;
const moduleApi = nodeModule as unknown as {
  registerHooks?: (hooks: { resolve: ResolveHook }) => void;
  register?: (specifier: string, parentURL: string) => void;
};
if (typeof moduleApi.registerHooks === "function") {
  moduleApi.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: EMPTY_MODULE_URL, shortCircuit: true, format: "module" };
      }
      return next(specifier, context);
    },
  });
} else if (typeof moduleApi.register === "function") {
  moduleApi.register("data:text/javascript," + encodeURIComponent(LOADER_SOURCE), import.meta.url);
} else {
  throw new Error("no module resolution hook API available");
}

const secret = "test-webadmin-api-secret-0000000000";
process.env.WEBADMIN_API_SECRET = secret;
process.env.CORE_API_BASE = "https://core.invalid";
const { coreMultipartCall } = await import("../lib/core.ts");

test("support multipart forwarding keeps the server-owned secret and image bytes", async () => {
  const realFetch = globalThis.fetch;
  let captured: { input: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    captured = { input: String(input), init: init ?? {} };
    return { status: 200, json: async () => ({ success: true, status_code: 200 }) } as Response;
  }) as typeof globalThis.fetch;
  try {
    const result = await coreMultipartCall(
      "support_send",
      { uid: 42, admin_email: "admin@example.test", request_id: "id", secret: "attacker" },
      { buffer: Buffer.from([0, 1, 2]), mime: "image/jpeg", filename: "support.jpg" },
    );
    assert.equal(result.status, 200);
    assert.ok(captured);
    assert.equal(captured.input, "https://core.invalid/v1/webadmin/support_send");
    const body = captured.init.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get("secret"), secret);
    assert.equal(body.getAll("secret").length, 1);
    assert.equal(body.get("admin_email"), "admin@example.test");
    const image = body.get("image");
    assert.ok(image instanceof File);
    assert.equal(image.type, "image/jpeg");
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [0, 1, 2]);
    assert.deepEqual(captured.init.headers, { Accept: "application/json" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

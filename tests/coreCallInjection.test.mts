import test from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

// `lib/core.ts` carries the shared Core credential and is therefore a
// `server-only` module. Plain Node has no React Server Component resolution
// condition, so the marker package is pointed at an empty module for this test.
// Nothing else about the module under test is replaced.
const EMPTY_MODULE_URL = "data:text/javascript,";
const LOADER_SOURCE = `export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" };
  }
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
  // Node 20 has no synchronous hook API.
  moduleApi.register(
    "data:text/javascript," + encodeURIComponent(LOADER_SOURCE),
    import.meta.url,
  );
} else {
  throw new Error("no module resolution hook API available");
}

// Obvious placeholder, never a real credential. Only its length matters.
const FAKE_API_SECRET = "test-webadmin-api-secret-0000000000";
process.env.WEBADMIN_API_SECRET = FAKE_API_SECRET;
process.env.CORE_API_BASE = "https://core.invalid";

const { coreCall, mergeCoreParams, RESERVED_CORE_PARAMS, isReservedCoreParam } = await import(
  "../lib/core.ts"
);

type Captured = { url: string; body: URLSearchParams };

const realFetch = globalThis.fetch;
let captured: Captured | null = null;

function stubFetch(payload: unknown = { success: true, status_code: 200 }, ok = true) {
  captured = null;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    captured = {
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? "")),
    };
    return {
      status: 200,
      json: async () => {
        if (!ok) throw new SyntaxError("not json");
        return payload;
      },
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function sentBody(): URLSearchParams {
  assert.ok(captured, "expected coreCall to reach fetch");
  return captured.body;
}

test("a request-body `secret` cannot override the server credential", async () => {
  stubFetch();
  try {
    await coreCall("list_users", { secret: "attacker", page: 1 });
    const body = sentBody();
    assert.equal(body.get("secret"), FAKE_API_SECRET);
    assert.equal(body.getAll("secret").length, 1);
    assert.equal(body.get("page"), "1");
  } finally {
    restoreFetch();
  }
});

test("every reserved key is dropped from request-derived input", () => {
  assert.deepEqual([...RESERVED_CORE_PARAMS], ["secret", "admin_email"]);
  for (const key of RESERVED_CORE_PARAMS) {
    assert.equal(isReservedCoreParam(key), true);
    const merged = mergeCoreParams({ [key]: "attacker" }, {});
    assert.equal(key in merged, false);
  }
  assert.equal(isReservedCoreParam("page"), false);
});

test("mergeCoreParams keeps the server-owned actor identity authoritative", () => {
  const merged = mergeCoreParams(
    { admin_email: "attacker@example.test", secret: "attacker", page: 3, q: "hello" },
    { admin_email: "owner@example.test" },
  );
  assert.equal(merged.admin_email, "owner@example.test");
  assert.equal("secret" in merged, false);
  assert.equal(merged.page, 3);
  assert.equal(merged.q, "hello");
});

test("mergeCoreParams does not let a JSON body reassign the result prototype", () => {
  const body = JSON.parse('{"__proto__": {"polluted": true}, "page": 1}') as Record<
    string,
    unknown
  >;
  const merged = mergeCoreParams(body, { admin_email: "owner@example.test" });
  assert.equal(Object.getPrototypeOf(merged), null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(merged.page, 1);
});

test("the proxy merge survives being handed to coreCall", async () => {
  stubFetch();
  try {
    await coreCall(
      "save_hero",
      mergeCoreParams(
        { secret: "attacker", admin_email: "attacker@example.test", title: "x" },
        { admin_email: "owner@example.test" },
      ),
    );
    const body = sentBody();
    assert.equal(body.get("secret"), FAKE_API_SECRET);
    assert.equal(body.get("admin_email"), "owner@example.test");
    assert.equal(body.get("title"), "x");
  } finally {
    restoreFetch();
  }
});

test("PHP parameter-name folding vectors never reach the wire", async () => {
  stubFetch();
  try {
    await coreCall("list_users", {
      "admin.email": "attacker@example.test",
      "admin email": "attacker@example.test",
      "admin[email": "attacker@example.test",
      "admin-email": "attacker@example.test",
      Secret: "attacker",
      SECRET: "attacker",
      _internal: "x",
      "1bad": "x",
      ["a".repeat(65)]: "x",
      admin_email: "owner@example.test",
    });
    const body = sentBody();
    assert.equal(body.get("secret"), FAKE_API_SECRET);
    assert.equal(body.get("admin_email"), "owner@example.test");
    assert.deepEqual([...body.keys()].sort(), ["admin_email", "secret"]);
  } finally {
    restoreFetch();
  }
});

test("ordinary values are encoded and forwarded", async () => {
  stubFetch();
  try {
    await coreCall("save_landing", {
      enabled: true,
      disabled: false,
      count: 12,
      label: "café & more",
      nested: { a: 1 },
      missing: null,
    });
    const body = sentBody();
    assert.equal(body.get("enabled"), "1");
    assert.equal(body.get("disabled"), "0");
    assert.equal(body.get("count"), "12");
    assert.equal(body.get("label"), "café & more");
    assert.equal(body.get("nested"), '{"a":1}');
    assert.equal(body.get("missing"), "");
  } finally {
    restoreFetch();
  }
});

test("the action segment is validated before any request is made", async () => {
  stubFetch();
  try {
    for (const action of [
      "../overview",
      "overview/../add_admin",
      "OVERVIEW",
      "overview ",
      "overview%2fadd_admin",
      "",
      "a",
      "1overview",
      "_overview",
      "over view",
      "a".repeat(65),
    ]) {
      const result = await coreCall(action, {});
      assert.equal(result.status, 404, `expected ${JSON.stringify(action)} to be rejected`);
      assert.equal(result.data, null);
      assert.equal(captured, null, `expected ${JSON.stringify(action)} not to reach fetch`);
    }
  } finally {
    restoreFetch();
  }
});

test("the accepted action is posted to the webadmin path", async () => {
  stubFetch();
  try {
    await coreCall("admin_me", { admin_email: "owner@example.test" });
    assert.equal(captured?.url, "https://core.invalid/v1/webadmin/admin_me");
  } finally {
    restoreFetch();
  }
});

test("the logical status_code wins and transport failures fail closed", async () => {
  stubFetch({ success: false, status_code: 403, error: "admin-write-required" });
  try {
    const denied = await coreCall("save_hero", {});
    assert.equal(denied.status, 403);
  } finally {
    restoreFetch();
  }

  stubFetch({ success: true }, false);
  try {
    const malformed = await coreCall("overview", {});
    assert.equal(malformed.status, 502);
    assert.deepEqual(malformed.data, { success: false, error: "invalid-core-response" });
  } finally {
    restoreFetch();
  }

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof globalThis.fetch;
  try {
    const unavailable = await coreCall("overview", {});
    assert.equal(unavailable.status, 502);
    assert.deepEqual(unavailable.data, { success: false, error: "core-unavailable" });
  } finally {
    restoreFetch();
  }
});

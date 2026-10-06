import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER, type MembershipCase } from "./support/adminMembershipCases.mts";

// Actual production POST function; controlled session/Core/Next adapters.
// DERIVED handler execution, not mounted Next or authenticated provider proof.
const source = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function bridge(answer: MembershipCase, action: string, config: { guest?: boolean; sessionThrows?: boolean; throws?: boolean; finalMe?: MembershipCase; abandonBody?: boolean; featureAnswer?: { status: number; data: unknown; abandoned?: boolean } } = {}) {
  const controller = new AbortController(), forwarded: string[] = [], checks: unknown[] = [];
  let bodyReads = 0;
  const context: any = { exports: {}, Buffer, JSON, ...actions, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership,
    adminBridgeCoreTransportError, isTrustedAdminRequest, withDatesAdminContract,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
    readAdminSession: async () => { if (config.sessionThrows) throw new Error("DERIVED cookie read failure"); return config.guest ? null : { email: MEMBERSHIP_EMAIL }; },
    coreCall: async (name: string, payload: Record<string, unknown>, timeout: number, options: unknown) => {
      assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      if (name === "admin_me") {
        checks.push(options);
        assert.equal((options as { signal: AbortSignal }).signal, controller.signal);
        assert.equal((options as { membershipCheck: boolean }).membershipCheck, true);
        if (config.throws) throw new Error("DERIVED service setup failure");
        const value = checks.length > 1 && config.finalMe ? config.finalMe : answer;
        if (value.abandoned) controller.abort();
        return { status: value.status, data: value.data };
      }
      forwarded.push(name); if (config.featureAnswer?.abandoned) controller.abort();
      return config.featureAnswer ?? { status: 200, data: { success: true, protected_value: "derived protected result" } };
    },
    mergeCoreParams: (input: Record<string, unknown>, owned: Record<string, unknown>) => ({ ...input, ...owned }),
    datesAvailabilityWriteIsRetired: () => false, isDatesAdminRoute: () => false,
    NextResponse: { json: (value: unknown, options: ResponseInit) => new Response(JSON.stringify(value), options) },
  };
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    for (const item of node.importClause.namedBindings.elements) {
      const name = item.name.text;
      if (context[name] !== undefined || name === "NextRequest") continue;
      assert.match(name, /^(normalize[A-Za-z]+|[A-Za-z]+(?:Authorized|RetryAuthorized)|projectDatesAdminResponse)$/);
      context[name] = () => undefined;
    }
  }
  vm.runInNewContext(code, context);
  const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" });
  const response = await context.exports.POST({ headers, signal: controller.signal, text: async () => {
    bodyReads++; if (config.abandonBody) controller.abort(); return "{}";
  } }, { params: Promise.resolve({ action }) }) as Response;
  return { status: response.status, body: await response.json(), headers: response.headers, checks, forwarded, bodyReads };
}

for (const answer of MEMBERSHIP_CASES) for (const action of ["overview", "set_settings"]) {
  test(`DERIVED action gate / ${action}: ${answer.name}`, async () => {
    const result = await bridge(answer, action);
    const viewerWrite = answer.kind === "confirmed" && (answer.data as { role: string }).role === "viewer" && action === "set_settings";
    const expected = answer.kind === "unconfirmed" ? 503 : answer.kind === "revoked" ? 401 : viewerWrite ? 403 : 200;
    assert.equal(result.status, expected); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.checks.length, 1, "confirmation is fresh on this request");
    assert.deepEqual(result.forwarded, expected === 200 ? [action] : []);
    if (expected !== 200) assert.equal(result.body.protected_value, undefined);
    if (expected === 503) { assert.equal(result.body.error, ADMIN_MEMBERSHIP_UNCONFIRMED); assert.equal(result.bodyReads, 0); }
    if (expected === 401) assert.equal(result.body.error, "auth-required");
  });
}
test("DERIVED action gate: a local non-session never reaches Core", async () => {
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { guest: true });
  assert.equal(result.status, 401); assert.equal(result.checks.length, 0); assert.deepEqual(result.forwarded, []);
});
test("DERIVED action gate: service setup failure is unconfirmed and accepts no action", async () => {
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { throws: true });
  assert.equal(result.status, 503); assert.deepEqual(result.forwarded, []);
});
test("DERIVED action gate: a local session-read exception is unconfirmed, not signed out, and sends nothing", async () => {
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { sessionThrows: true });
  assert.equal(result.status, 503); assert.equal(result.body.error, ADMIN_MEMBERSHIP_UNCONFIRMED);
  assert.equal(result.checks.length, 0); assert.equal(result.bodyReads, 0); assert.deepEqual(result.forwarded, []);
});
test("DERIVED action gate: a slow request body abandoned after membership does not forward a write", async () => {
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { abandonBody: true });
  assert.equal(result.status, 503); assert.deepEqual(result.forwarded, []);
});
test("DERIVED membership read: a positive first check cannot bless a malformed or revoked second admin_me reply", async () => {
  for (const finalMe of MEMBERSHIP_CASES.filter((answer) => answer.kind !== "confirmed")) {
    const result = await bridge({ name: "confirmed", status: 200, data: MEMBERSHIP_MEMBER, kind: "confirmed" }, "admin_me", { finalMe });
    assert.equal(result.status, finalMe.kind === "revoked" ? 401 : 503, finalMe.name);
    assert.equal(result.body.email, undefined); assert.equal(result.checks.length, 2); assert.deepEqual(result.forwarded, []);
  }
});
test("DERIVED action gate: only a complete definite revocation after forwarding can force login; unknown 401s stay errors", async () => {
  for (const answer of MEMBERSHIP_CASES.filter((row) => row.status === 401 || row.kind === "revoked")) {
    const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { featureAnswer: answer });
    assert.equal(result.status, answer.abandoned ? 504 : answer.kind === "revoked" ? 401 : 502, answer.name);
    assert.deepEqual(result.forwarded, ["set_settings"], "the already forwarded write is never represented as a pre-forward refusal");
    assert.equal(result.body.error, answer.abandoned ? "core-timeout" : answer.kind === "revoked" ? "auth-required" : "invalid-core-response");
  }
});
test("DERIVED action gate: an abandoned late feature answer never returns protected data or claims that no action was forwarded", async () => {
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { featureAnswer: { status: 200, data: { success: true, protected_value: "derived" }, abandoned: true } });
  assert.equal(result.status, 504); assert.equal(result.body.error, "core-timeout"); assert.equal(result.body.protected_value, undefined);
  assert.deepEqual(result.forwarded, ["set_settings"]);
});
for (const status of [500, 503]) for (const action of ["overview", "set_settings"]) {
  test(`DERIVED generic post-forward ${action} / HTTP ${status}: even a complete success body is an unknown outcome`, async () => {
    for (const data of [{ ...MEMBERSHIP_MEMBER, protected_value: "DERIVED must not escape" }, { success: true, data: { count: 2 } },
      { ...MEMBERSHIP_MEMBER, success: false, status_code: 403, error: "admin-revoked" }, { success: false, error: "storage-failed" }, null]) {
      const result = await bridge(MEMBERSHIP_CASES[0], action, { featureAnswer: { status, data } });
      assert.equal(result.status, 502); assert.deepEqual(result.body, { success: false, status_code: 502, error: "invalid-core-response" });
      assert.deepEqual(result.forwarded, [action]); assert.equal(result.headers.get("cache-control"), "no-store");
    }
  });
}
test("DERIVED generic post-forward: named synthesized transport failures retain public status, while healthy feature success is unchanged", async () => {
  for (const [status, error] of [[502, "core-unavailable"], [504, "core-timeout"], [502, "invalid-core-response"]] as const) {
    const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { featureAnswer: { status, data: { success: false, error } } });
    assert.equal(result.status, status); assert.deepEqual(result.body, { success: false, status_code: status, error });
  }
  const data = { success: true, message: { smid: 91 }, protected_value: "DERIVED healthy feature response" };
  const result = await bridge(MEMBERSHIP_CASES[0], "set_settings", { featureAnswer: { status: 200, data } });
  assert.equal(result.status, 200); assert.deepEqual(result.body, data);
});

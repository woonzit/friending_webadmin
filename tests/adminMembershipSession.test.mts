import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "../lib/adminMembership.ts";
import { MEMBERSHIP_CASES } from "./support/adminMembershipCases.mts";
import { DerivedNextResponse, serverModule, sessionHarness, writerRequest, WRITER_ROUTES } from "./support/adminMembershipServerHarness.mts";
import { SESSION_VERSION } from "../lib/sessionCodec.ts";
import type { NextResponse } from "next/server";

for (const answer of MEMBERSHIP_CASES) {
  test(`DERIVED session identity gate: ${answer.name}`, async () => {
    const h = await sessionHarness(answer);
    if (answer.kind === "unconfirmed") await assert.rejects(h.api.adminMe(h.controller.signal), h.api.AdminMembershipUnconfirmedError);
    else if (answer.kind === "revoked") assert.equal(await h.api.adminMe(h.controller.signal), null);
    else {
      const identity = await h.api.adminMe(h.controller.signal); assert.equal(identity?.email, (answer.data as { email: string }).email);
      assert.equal(identity?.role, (answer.data as { role: string }).role);
      assert.equal(identity?.personaConsoleReady, false, "positive membership does not synthesize capabilities");
    }
    assert.equal(h.calls.length, 1);
  });
  test(`DERIVED session writer gate: ${answer.name}`, async () => {
    const h = await sessionHarness(answer), result = await h.api.requireAdminWriter(h.controller.signal);
    const viewer = (answer.data as { role?: string } | null)?.role === "viewer";
    if (answer.kind === "confirmed" && !viewer) { assert.equal(result.ok, true); if (result.ok) assert.equal(result.membership, answer.data); }
    else {
      assert.equal(result.ok, false);
      if (!result.ok) { assert.equal(result.status, answer.kind === "unconfirmed" ? 503 : answer.kind === "revoked" ? 401 : 403);
        assert.equal(result.error, answer.kind === "unconfirmed" ? ADMIN_MEMBERSHIP_UNCONFIRMED : answer.kind === "revoked" ? "auth-required" : "admin-write-required"); }
    }
    assert.equal(h.calls.length, 1);
  });
  test(`DERIVED every upload/private-read writer entry point: ${answer.name}`, async () => {
    for (const route of WRITER_ROUTES) {
      const h = await sessionHarness(answer), incoming = writerRequest(h.controller.signal); let forwarded = 0;
      const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse: DerivedNextResponse,
        requireAdminWriter: h.api.requireAdminWriter, coreCall: async () => { forwarded++; throw new Error("unexpected feature call"); },
        coreBinaryCall: async () => { forwarded++; throw new Error("unexpected private bytes"); } });
      const response = await (module.POST ?? module.GET)(incoming.request) as Response;
      const data = await response.json(); assert.equal(forwarded, 0, route);
      if (answer.kind === "unconfirmed" || answer.kind === "revoked") {
        assert.equal(response.status, answer.kind === "unconfirmed" ? 503 : 401, route);
        assert.equal(data.error, answer.kind === "unconfirmed" ? ADMIN_MEMBERSHIP_UNCONFIRMED : "auth-required", route);
        assert.equal(incoming.bodyReads, 0, `${route}: no upload decode, protected read or write`);
        assert.equal(data.data, undefined); assert.equal(data.email, undefined);
      } else if ((answer.data as { role: string }).role === "viewer") {
        assert.equal(response.status, 403); assert.equal(data.error, "admin-write-required"); assert.equal(incoming.bodyReads, 0);
      } else { assert.notEqual(response.status, 401); assert.notEqual(response.status, 503); }
      assert.equal(h.calls.length, 1, `${route}: fresh membership on each independent request`);
    }
  });
}
test("DERIVED session gates: absent, invalid, expired and locally revoked tokens are definite non-sessions, with no Core query", async () => {
  for (const token of ["", "invalid-token", "expired"]) for (const gate of ["adminMe", "requireAdminWriter"] as const) {
    const h = await sessionHarness(MEMBERSHIP_CASES[0]); h.state.token = token === "expired" ? h.expiredToken : token;
    const result = await h.api[gate](h.controller.signal);
    if (gate === "adminMe") assert.equal(result, null); else assert.equal((result as { status: number }).status, 401);
    assert.equal(h.calls.length, 0);
  }
  const h = await sessionHarness(MEMBERSHIP_CASES[0]); await h.api.revokeCurrentAdminSession();
  assert.equal(await h.api.adminMe(), null); assert.equal((await h.api.requireAdminWriter() as { status: number }).status, 401); assert.equal(h.calls.length, 0);
});
test("DERIVED upload gates: abandoned form parsing cannot decode or forward bytes after an earlier positive membership read", async () => {
  for (const route of WRITER_ROUTES.filter((route) => !["persona-member", "profile-verification-evidence"].includes(route))) {
    const h = await sessionHarness(MEMBERSHIP_CASES[0]), incoming = writerRequest(h.controller.signal); let normalized = 0, forwarded = 0;
    incoming.request.formData = async () => { h.controller.abort(); return new FormData(); };
    const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse: DerivedNextResponse, requireAdminWriter: h.api.requireAdminWriter,
      normalizeAdminImage: async () => { normalized++; }, normalizeSupportImage: async () => { normalized++; }, validateAdminProfileIcon: () => { normalized++; },
      validateAdminVideo: () => { normalized++; }, coreCall: async () => { forwarded++; }, coreMultipartCall: async () => { forwarded++; } });
    const response = await module.POST(incoming.request) as Response;
    assert.equal(response.status, 503, route); assert.equal((await response.json()).error, ADMIN_MEMBERSHIP_UNCONFIRMED);
    assert.equal(normalized, 0); assert.equal(forwarded, 0);
  }
});
test("DERIVED session gates: cookie/transport setup exceptions are unconfirmed, never identities or signed-out proofs", async () => {
  for (const field of ["cookiesThrow", "coreThrows"] as const) {
    const h = await sessionHarness(MEMBERSHIP_CASES[0]); h.state[field] = true;
    await assert.rejects(h.api.adminMe(), h.api.AdminMembershipUnconfirmedError);
    const result = await h.api.requireAdminWriter(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 503);
  }
});
test("DERIVED session gates: a previous positive answer is never cached for the next request", async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]); assert.ok(await h.api.adminMe());
  h.state.answer = MEMBERSHIP_CASES.find((row) => row.name === "null 200")!;
  await assert.rejects(h.api.adminMe(), h.api.AdminMembershipUnconfirmedError);
  const result = await h.api.requireAdminWriter(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 503);
  assert.equal(h.calls.length, 3);
});

test("DERIVED legacy session cookie upgrade keeps the original deadline and secure cookie attributes", async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]);
  const now = Math.floor(Date.now() / 1000), issued = now - 3600;
  const writes: unknown[][] = [];
  const response = { cookies: { set: (...args: unknown[]) => writes.push(args) } } as unknown as NextResponse;
  h.api.upgradeLegacyAdminSessionCookie(response, {
    v: SESSION_VERSION, email: "owner@example.com", iat: issued, exp: issued + 12 * 3600, nonce: "derived_nonce_12345678",
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "flwa_session");
  const options = writes[0][2] as ReturnType<typeof h.api.adminCookieOptions>;
  assert.equal(options.httpOnly, true); assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax"); assert.equal(options.path, "/");
  assert.ok(options.maxAge >= 23 * 3600 - 1 && options.maxAge <= 23 * 3600);
  assert.equal("domain" in options, false);
  h.state.token = writes[0][1] as string;
  const session = await h.api.readAdminSession(); assert.ok(session);
  assert.equal(session.iat, issued); assert.equal(session.exp, issued + 24 * 3600);
  h.api.upgradeLegacyAdminSessionCookie(response, session);
  assert.equal(writes.length, 1, "the upgraded cookie does not become a rolling session");
});

test("DERIVED legacy cookie upgrade never renews a session that expired during a request", async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]);
  const now = Math.floor(Date.now() / 1000);
  const response = { cookies: { set: () => assert.fail("expired cookie must not be renewed") } } as unknown as NextResponse;
  h.api.upgradeLegacyAdminSessionCookie(response, {
    v: SESSION_VERSION, email: "owner@example.com", iat: now - 12 * 3600, exp: now, nonce: "derived_nonce_12345678",
  });
});

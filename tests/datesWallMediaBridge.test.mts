import test from "node:test";
import assert from "node:assert/strict";
import { serveDatesWallMedia, WALL_MEDIA_LIMIT } from "../lib/datesWallMediaBridge.ts";
import { MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";

const email = "operator@example.test";
const fields = { case_id: "cas_" + "a".repeat(32), evidence_id: "evi_" + "b".repeat(32), break_glass: false, include_sensitive_location: false, reason: null };
const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "x-friending-admin-request": "1", "sec-fetch-site": "same-origin" });
function harness() {
  const state = { calls: [] as Record<string, unknown>[], bytes: new Uint8Array([255, 216, 255, 217]),
    mime: "image/jpeg", role: "moderator", membershipStatus: 200, session: { email } as { email: string } | null };
  const deps = { session: async () => state.session,
    core: async () => ({ status: state.membershipStatus, data: { ...MEMBERSHIP_MEMBER, role: "admin", dates: {
      email, role: state.role, rank: 20, linked_uid: null, sensitive_location: false, break_glass: false,
      capabilities: state.role === "moderator" ? ["dates_evidence_read"] : [],
    } } }),
    binary: async (_action: string, payload: Record<string, unknown>) => { state.calls.push(payload); return new Response(state.bytes, { headers: { "Content-Type": state.mime } }); } };
  return { state, deps };
}
const request = (body: unknown = fields, h = headers) => ({ headers: h, body: async () => body });
test("wall media is private, live-authorized and uses only the session actor", async () => {
  const { state, deps } = harness(); const result = await serveDatesWallMedia(request(), deps);
  assert.equal(result.status, 200); assert.deepEqual(result.bytes, state.bytes);
  assert.match(result.headers["Cache-Control"], /no-store/); assert.equal(state.calls[0].admin_email, email);
  assert.equal((await serveDatesWallMedia(request({ ...fields, admin_email: "attacker@example.test" }), deps)).status, 400);
});
test("cross-origin, unconfirmed/revoked membership and read-only operators receive no media", async () => {
  const { state, deps } = harness();
  assert.equal((await serveDatesWallMedia(request(fields, new Headers()), deps)).status, 403);
  state.session = null; assert.equal((await serveDatesWallMedia(request(), deps)).status, 401);
  state.session = { email }; state.membershipStatus = 503;
  assert.equal((await serveDatesWallMedia(request(), deps)).status, 503);
  state.membershipStatus = 200; state.role = "support_viewer";
  assert.equal((await serveDatesWallMedia(request(), deps)).status, 403); assert.equal(state.calls.length, 0);
});
test("an unexpected MIME and oversized response cannot become active content", async () => {
  const { state, deps } = harness(); state.mime = "text/html";
  assert.equal((await serveDatesWallMedia(request(), deps)).status, 403);
  state.mime = "video/mp4"; state.bytes = new Uint8Array(WALL_MEDIA_LIMIT + 1);
  assert.equal((await serveDatesWallMedia(request(), deps)).status, 502);
});

test("private video object URLs are playable without granting blob scripts or connections", async () => {
  const { contentSecurityPolicy } = await import("../next.config.mjs");
  const directives = new Map<string, string[]>(contentSecurityPolicy.split(";").map((part: string) => {
    const [name, ...sources] = part.trim().split(/\s+/); return [name!, sources];
  }));
  assert.deepEqual(directives.get("media-src"), ["'self'", "https:", "blob:"]);
  assert.equal(directives.get("script-src")?.includes("blob:"), false);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  const { state, deps } = harness(); state.mime = "video/mp4";
  const reply = await serveDatesWallMedia(request(), deps);
  assert.equal(reply.status, 200); assert.equal(reply.headers["Content-Type"], "video/mp4");
});

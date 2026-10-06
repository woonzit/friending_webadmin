import test from "node:test";
import assert from "node:assert/strict";
import { classifyAdminMembership } from "../lib/adminMembership.ts";

// DERIVED canonical answers from immutable Core 7f86b941's actual adminMe,
// requireAdminActor and Webadmin::reply. No running Core or socket is claimed.
const email = "operator@example.test";
const envelope = { message: 200, status: 200, can_send: 0 };
const member = { ...envelope, success: true, status_code: 200, email, role: "admin", dates: { capabilities: ["derived-capability"] } };
const refusal = (status_code: number, error: string) => ({ ...envelope, success: false, status_code, error });

for (const role of ["owner", "admin", "viewer"] as const) test(`DERIVED membership table: a complete, own-actor ${role} is confirmed, with additive capability fields preserved`, () => {
  const body = { ...member, role, extra: { unknown: true } };
  const answer = classifyAdminMembership({ status: 200, data: body }, email);
  assert.equal(answer.kind, "confirmed");
  if (answer.kind === "confirmed") { assert.equal(answer.membership, body); assert.equal(answer.email, email); assert.equal(answer.role, role); }
});
for (const [status, error] of [[401, "admin-session-invalid"], [403, "admin-revoked"]] as const)
  test(`DERIVED membership table: only the complete ${error}/${status} answer is a definite non-member`, () => {
    assert.deepEqual(classifyAdminMembership({ status, data: refusal(status, error) }, email), { kind: "revoked" });
  });

for (const [name, status, data] of [
  ["transport unavailable", 502, { success: false, error: "core-unavailable" }],
  ["transport timeout", 504, { success: false, error: "core-timeout" }],
  ["malformed transport", 502, { success: false, error: "invalid-core-response" }],
  ["Core storage failure", 500, refusal(500, "query-failed")],
  ["service credential failure", 401, refusal(401, "unauthorized")],
  ["unknown 401", 401, refusal(401, "unknown")],
  ["unknown 403", 403, refusal(403, "unknown")],
  ["role denial is not revocation", 403, refusal(403, "admin-write-required")],
  ["unexpected negative status", 200, refusal(403, "admin-revoked")],
  ["wrong revocation pair", 401, refusal(401, "admin-revoked")],
  ["wrong session pair", 403, refusal(403, "admin-session-invalid")],
  ["5xx cannot grant despite a positive body", 503, member],
  ["5xx cannot revoke despite a negative body", 503, refusal(403, "admin-revoked")],
  ["null 200", 200, null], ["array 200", 200, []], ["string 200", 200, "true"],
  ["missing success", 200, { ...envelope, status_code: 200, email, role: "admin" }],
  ["truthy success", 200, { ...member, success: "true" }],
  ["numeric success", 200, { ...member, success: 1 }],
  ["missing email", 200, { ...member, email: undefined }],
  ["foreign email", 200, { ...member, email: "other@example.test" }],
  ["noncanonical email", 200, { ...member, email: " OPERATOR@example.test " }],
  ["missing role", 200, { ...member, role: undefined }],
  ["unknown role", 200, { ...member, role: "editor" }],
  ["noncanonical role", 200, { ...member, role: " Admin " }],
  ["numeric role", 200, { ...member, role: 1 }],
  ["loosely typed logical status", 200, { ...member, status_code: "200" }],
  ["contradictory logical status", 200, { ...member, status_code: 403 }],
  ["missing legacy marker", 200, { ...member, can_send: undefined }],
  ["malformed legacy marker", 200, { ...member, message: "200" }],
  ["contradictory success error", 200, { ...member, error: "admin-revoked" }],
  ["partial definite refusal", 403, { success: false, status_code: 403, error: "admin-revoked" }],
  ["loosely typed definite refusal", 403, { ...refusal(403, "admin-revoked"), success: "false" }],
  ["refusal with data ambiguity", 403, { ...refusal(403, "admin-revoked"), data: null }],
] as const) test(`DERIVED membership table: ${name} is unconfirmed and grants nothing`, () => {
  assert.deepEqual(classifyAdminMembership({ status, data }, email), { kind: "unconfirmed" });
});

test("DERIVED membership table: an abandoned check discards late positive and negative answers", () => {
  for (const answer of [{ status: 200, data: member }, { status: 403, data: refusal(403, "admin-revoked") }, { status: 401, data: refusal(401, "admin-session-invalid") }])
    assert.deepEqual(classifyAdminMembership(answer, email, true), { kind: "unconfirmed" });
});
test("DERIVED membership table: an absent expected actor or prototype-only positive fields never confirms membership", () => {
  assert.deepEqual(classifyAdminMembership({ status: 200, data: member }, ""), { kind: "unconfirmed" });
  assert.deepEqual(classifyAdminMembership({ status: 200, data: Object.create(member) }, email), { kind: "unconfirmed" });
});

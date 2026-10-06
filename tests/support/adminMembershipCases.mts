// DERIVED answers, from Core 7f86b941's adminMe / requireAdminActor / reply.
// Deliberately malformed variants are substitutions, never provider captures.
export const MEMBERSHIP_EMAIL = "operator@example.test";
export const MEMBERSHIP_LEGACY = { message: 200, status: 200, can_send: 0 };
export const MEMBERSHIP_MEMBER = { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, email: MEMBERSHIP_EMAIL, role: "admin" };
export const membershipRefusal = (status_code: number, error: string) => ({ ...MEMBERSHIP_LEGACY, success: false, status_code, error });
export type MembershipCase = { name: string; status: number; data: unknown; kind: "confirmed" | "revoked" | "unconfirmed"; abandoned?: boolean };
export const MEMBERSHIP_CASES: MembershipCase[] = [
  ...["owner", "admin", "viewer"].map((role) => ({ name: `complete ${role}`, status: 200, data: { ...MEMBERSHIP_MEMBER, role }, kind: "confirmed" as const })),
  { name: "session invalid", status: 401, data: membershipRefusal(401, "admin-session-invalid"), kind: "revoked" },
  { name: "revoked", status: 403, data: membershipRefusal(403, "admin-revoked"), kind: "revoked" },
  ...([
    ["transport unavailable", 502, { success: false, error: "core-unavailable" }],
    ["transport timeout", 504, { success: false, error: "core-timeout" }],
    ["invalid transport JSON", 502, { success: false, error: "invalid-core-response" }],
    ["Core storage failure", 500, membershipRefusal(500, "query-failed")],
    ["service credential failure", 401, membershipRefusal(401, "unauthorized")],
    ["unknown 401", 401, membershipRefusal(401, "unknown")],
    ["unknown 403", 403, membershipRefusal(403, "unknown")],
    ["role denial", 403, membershipRefusal(403, "admin-write-required")],
    ["unexpected negative status", 200, membershipRefusal(403, "admin-revoked")],
    ["wrong revocation pair", 401, membershipRefusal(401, "admin-revoked")],
    ["wrong session pair", 403, membershipRefusal(403, "admin-session-invalid")],
    ["HTTP 5xx positive", 503, MEMBERSHIP_MEMBER],
    ["HTTP 5xx negative", 503, membershipRefusal(403, "admin-revoked")],
    ["null 200", 200, null], ["array 200", 200, []], ["string 200", 200, "true"],
    ["missing success", 200, { ...MEMBERSHIP_LEGACY, status_code: 200, email: MEMBERSHIP_EMAIL, role: "admin" }],
    ["truthy success", 200, { ...MEMBERSHIP_MEMBER, success: "true" }],
    ["numeric success", 200, { ...MEMBERSHIP_MEMBER, success: 1 }],
    ["missing email", 200, { ...MEMBERSHIP_MEMBER, email: undefined }],
    ["foreign email", 200, { ...MEMBERSHIP_MEMBER, email: "other@example.test" }],
    ["noncanonical email", 200, { ...MEMBERSHIP_MEMBER, email: " OPERATOR@example.test " }],
    ["missing role", 200, { ...MEMBERSHIP_MEMBER, role: undefined }],
    ["unknown role", 200, { ...MEMBERSHIP_MEMBER, role: "editor" }],
    ["noncanonical role", 200, { ...MEMBERSHIP_MEMBER, role: " Admin " }],
    ["numeric role", 200, { ...MEMBERSHIP_MEMBER, role: 1 }],
    ["string status", 200, { ...MEMBERSHIP_MEMBER, status_code: "200" }],
    ["contradictory logical status", 200, { ...MEMBERSHIP_MEMBER, status_code: 403 }],
    ["missing legacy", 200, { ...MEMBERSHIP_MEMBER, can_send: undefined }],
    ["bad legacy", 200, { ...MEMBERSHIP_MEMBER, message: "200" }],
    ["success with error", 200, { ...MEMBERSHIP_MEMBER, error: "admin-revoked" }],
    ["partial negative", 403, { success: false, status_code: 403, error: "admin-revoked" }],
    ["loosely typed negative", 403, { ...membershipRefusal(403, "admin-revoked"), success: "false" }],
    ["ambiguous negative data", 403, { ...membershipRefusal(403, "admin-revoked"), data: null }],
  ] as [string, number, unknown][]).map(([name, status, data]) => ({ name, status, data, kind: "unconfirmed" as const })),
  ...[
    { name: "late positive", status: 200, data: MEMBERSHIP_MEMBER },
    { name: "late revocation", status: 403, data: membershipRefusal(403, "admin-revoked") },
    { name: "late invalid session", status: 401, data: membershipRefusal(401, "admin-session-invalid") },
  ].map((answer) => ({ ...answer, kind: "unconfirmed" as const, abandoned: true })),
];

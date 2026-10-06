import { webadminEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

export const ADMIN_MEMBERSHIP_UNCONFIRMED = "admin-membership-unconfirmed" as const;

export type AdminMembershipDecision =
  | { kind: "confirmed"; membership: Record<string, unknown>; email: string; role: "owner" | "admin" | "viewer" }
  | { kind: "revoked" }
  | { kind: "unconfirmed" };

/**
 * Core 7f86b941 adminMe/requireAdminActor and Webadmin::reply are the authority.
 * An unknown answer is not a negative membership proof, and never a grant.
 * A late answer to an abandoned check authorizes nothing, including a read.
 */
export function classifyAdminMembership(
  result: { status: number; data: unknown },
  expectedEmail: string,
  abandoned = false,
): AdminMembershipDecision {
  if (abandoned) return { kind: "unconfirmed" };
  const denied = webadminErrorEnvelope(result.data);
  if (denied?.status_code === result.status
    && ((result.status === 401 && denied.error === "admin-session-invalid")
      || (result.status === 403 && denied.error === "admin-revoked"))) {
    return { kind: "revoked" };
  }
  const positive = webadminEnvelope(result.data, true, ["email", "role"]);
  const expected = expectedEmail.trim().toLowerCase();
  if (result.status !== 200 || positive?.status_code !== 200 || !expected
    || positive.email !== expected
    || (positive.role !== "owner" && positive.role !== "admin" && positive.role !== "viewer")
    || Object.hasOwn(result.data as object, "error")) return { kind: "unconfirmed" };
  // Preserve the additive capability siblings for their existing independent
  // authorization checks. Parsing the envelope alone would drop those fields.
  return { kind: "confirmed", membership: result.data as Record<string, unknown>, email: expected, role: positive.role };
}

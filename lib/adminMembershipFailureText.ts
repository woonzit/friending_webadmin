import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";

/** Presentation only: keep the typed request result and feature settlement unchanged. */
export function adminMembershipFailureText(error: unknown, fallback: string, unconfirmed: string): string {
  return error === ADMIN_MEMBERSHIP_UNCONFIRMED ? unconfirmed : fallback;
}

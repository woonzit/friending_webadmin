import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
/** A typed failure VALUE, not an exception, suspended call or replay grant. */
export function adminMembershipFailure(): { success: false; status_code: 503; error: typeof ADMIN_MEMBERSHIP_UNCONFIRMED } {
  return { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED };
}

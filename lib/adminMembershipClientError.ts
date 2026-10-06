import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
export const ADMIN_REQUEST_OUTCOME_UNKNOWN = "admin-request-outcome-unknown" as const;
/** A typed failure VALUE, not an exception, suspended call or replay grant. */
export function adminMembershipFailure(): { success: false; status_code: 503; error: typeof ADMIN_MEMBERSHIP_UNCONFIRMED } {
  return { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED };
}
/** The request was attempted but its answer is lost; NEVER claim no write. */
export function adminRequestOutcomeUnknownFailure(): { success: false; status_code: 502; error: typeof ADMIN_REQUEST_OUTCOME_UNKNOWN } {
  return { success: false, status_code: 502, error: ADMIN_REQUEST_OUTCOME_UNKNOWN };
}

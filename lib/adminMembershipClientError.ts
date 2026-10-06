import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
import type { AdminResponse } from "@/lib/adminClient";

/** A stopped call, never a suspended request or permission to replay it. */
export class AdminMembershipUnconfirmedClientError extends Error {
  readonly error = ADMIN_MEMBERSHIP_UNCONFIRMED;
  readonly status_code = 503;
  readonly success = false;
  constructor() { super(ADMIN_MEMBERSHIP_UNCONFIRMED); this.name = "AdminMembershipUnconfirmedClientError"; }
}

/** UI mutation handlers catch a STOPPED call and render their normal refusal;
 * this is not a read adapter and never resumes a suspended command chain. */
export function adminMembershipRefusalForUi(error: unknown): AdminResponse {
  if (!(error instanceof AdminMembershipUnconfirmedClientError)) throw error;
  return { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED };
}

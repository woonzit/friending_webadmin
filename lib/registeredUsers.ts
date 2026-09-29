import {
  signupPlatformFrom,
  type SignupPlatform,
  type SignupPlatformFilter,
} from "@/lib/registrationStats";

/**
 * The Registered users (`list_users`) additions of T-863 S9: the signup platform and the
 * old-app import marker on every row, with a closed `signup_platform` filter that Core echoes
 * in the envelope (P-092).
 */

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export type RegisteredUserSignup = {
  /** Null when the row carries no known platform value (never guessed as "unknown"). */
  platform: SignupPlatform | null;
  /** Imported from the old Friending app by the member integration (`member_import`). */
  legacyConverted: boolean;
};

export function registeredUserSignup(row: unknown): RegisteredUserSignup {
  const source = record(row);
  return {
    platform: signupPlatformFrom(source?.signup_platform),
    legacyConverted: source?.legacy_converted === true,
  };
}

/**
 * Whether Core applied the requested signup-platform filter: it echoes the normalised value
 * (`all` when none was sent) in every successful envelope, the early empty answer included.
 */
export function signupPlatformFilterApplied(response: unknown, requested: SignupPlatformFilter): boolean {
  return record(response)?.signup_platform === requested;
}

export type RegisteredUsersRefusal = "signupPlatformInvalid";

/** Core's definite 422 refusals of a Registered users filter value. */
export function registeredUsersRefusal(response: unknown): RegisteredUsersRefusal | null {
  const envelope = record(response);
  if (envelope?.success !== false || envelope.status_code !== 422) return null;
  if (envelope.error === "signup-platform-invalid") return "signupPlatformInvalid";
  return null;
}

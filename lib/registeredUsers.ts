import {
  signupPlatformFrom,
  type SignupPlatform,
  type SignupPlatformFilter,
} from "@/lib/registrationStats";

/**
 * The Registered users (`list_users`) additions of T-863 S9: the signup platform and the
 * old-app import marker on every row, with a closed `signup_platform` filter that Core echoes
 * in the envelope (P-092); and whether the stored phone is PROVEN, with the country the proof
 * covers, with a closed `phone_check` filter Core echoes the same way (P-093).
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

/** The Registered users account-type filter (`demo_mode`), also readable from `?type=`. */
export const ACCOUNT_TYPE_FILTERS = ["all", "real", "demo"] as const;
export type AccountTypeFilter = (typeof ACCOUNT_TYPE_FILTERS)[number];

export function accountTypeFilterFrom(value: string | null | undefined): AccountTypeFilter {
  return typeof value === "string" && (ACCOUNT_TYPE_FILTERS as readonly string[]).includes(value)
    ? value as AccountTypeFilter
    : "all";
}

/**
 * The Registered users address for a platform and account type; defaults are left out, so the
 * plain list stays `/users`. The overview's platform cards open `?platform=<p>&type=real`.
 */
export function registeredUsersHref(platform: SignupPlatformFilter, type: AccountTypeFilter): string {
  const query = new URLSearchParams();
  if (platform !== "all") query.set("platform", platform);
  if (type !== "all") query.set("type", type);
  const text = query.toString();
  return text ? `/users?${text}` : "/users";
}

/**
 * Whether Core applied the requested signup-platform filter: it echoes the normalised value
 * (`all` when none was sent) in every successful envelope, the early empty answer included.
 */
export function signupPlatformFilterApplied(response: unknown, requested: SignupPlatformFilter): boolean {
  return record(response)?.signup_platform === requested;
}

/** Core's `AdminPhoneCheckView::FILTERS`, in the order the console offers them. */
export const PHONE_CHECK_FILTERS = ["all", "verified_any", "verified_nanp", "verified_hu", "unverified"] as const;
export type PhoneCheckFilter = (typeof PHONE_CHECK_FILTERS)[number];

export function phoneCheckFilterFrom(value: unknown): PhoneCheckFilter {
  return typeof value === "string" && (PHONE_CHECK_FILTERS as readonly string[]).includes(value)
    ? value as PhoneCheckFilter
    : "all";
}

export type RegisteredUserPhoneCheck = {
  /** Only a stored `phone_is_verified === true` proves the phone. */
  verified: boolean;
  /** The countries the proof covers, e.g. "US/CA" or "HU"; "" when unproven or unknown. */
  country: string;
};

/**
 * A row's `phone_check` ({phone_verified, phone_country}, `AdminPhoneCheckView::row`), or null
 * when it is absent or not Core's shape: the column then shows nothing rather than a guess.
 * The country is "" or ISO alpha-2 codes joined by "/", and only a proven phone has one.
 */
export function registeredUserPhoneCheck(row: unknown): RegisteredUserPhoneCheck | null {
  const check = record(record(row)?.phone_check);
  if (!check || Object.keys(check).length !== 2) return null;
  const verified = check.phone_verified;
  const country = check.phone_country;
  if (typeof verified !== "boolean" || typeof country !== "string") return null;
  if (!/^(?:[A-Z]{2}(?:\/[A-Z]{2})*)?$/u.test(country)) return null;
  if (!verified && country !== "") return null;
  return { verified, country };
}

/** Whether Core applied the requested phone filter (echoed like the platform filter). */
export function phoneCheckFilterApplied(response: unknown, requested: PhoneCheckFilter): boolean {
  return record(response)?.phone_check === requested;
}

export type RegisteredUsersRefusal = "signupPlatformInvalid" | "phoneCheckInvalid";

/** Core's definite 422 refusals of a Registered users filter value. */
export function registeredUsersRefusal(response: unknown): RegisteredUsersRefusal | null {
  const envelope = record(response);
  if (envelope?.success !== false || envelope.status_code !== 422) return null;
  if (envelope.error === "signup-platform-invalid") return "signupPlatformInvalid";
  if (envelope.error === "phone-check-filter-invalid") return "phoneCheckInvalid";
  return null;
}

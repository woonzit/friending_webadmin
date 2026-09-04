/**
 * Registered-user detail projection.
 *
 * `user_detail` returns Core's whole profile document. The page renders a small, fixed subset of
 * it, so casting the response into React state put fields nobody displays into every
 * administrator's browser and DOM — among them `last_location.lat/.lng` and `hometown.lat/.lng`,
 * the member's full-precision login and home coordinates. The console shows a city string and has
 * no message key for a coordinate anywhere.
 *
 * That is a data-minimisation defect rather than a privilege failure: every recipient is an
 * authenticated active administrator who already sees this member's phone, verified email and
 * photographs on the same page. It is still worth closing, because the same product requires a
 * capability, a bound case, a stated reason and an audit row before releasing the equivalent datum
 * for a Dates activity, and because a value that is never projected cannot leak from a screenshot,
 * a browser extension or a bug report.
 *
 * The honest limit: this stops the fields entering state and the DOM. They are still in the HTTP
 * response body, so the authoritative fix is a Core-side projection on `user_detail`. Requested
 * separately; this is the half the console owns.
 *
 * Shaped like `lib/auditLog.ts`: parse and project, never cast.
 */

import {
  membershipUserDetail,
  unavailableMembershipUserDetail,
  type MembershipUserDetail,
} from "@/lib/membership";
import { pushChannels, type PushChannels } from "@/lib/pushAdmin";
import { verificationAccess, type VerificationAccess } from "@/lib/verificationAdmin";

/**
 * D-122 (T-729/T-730). Core's own closed vocabulary for how the app shows an
 * age. `null` is the console's fourth state and NOT one of Core's: it means
 * "this response did not state one", which is what a Core older than T-729
 * sends and what an unrecognised value has to become here.
 */
export const AGE_DISPLAY_VALUES = ["exact", "generation", "hidden"] as const;

export type AgeDisplay = (typeof AGE_DISPLAY_VALUES)[number];

export const TRIP_INTENTS = ["new_friends", "activities", "networking", "local_tips", "events", "dates"] as const;
export type TripIntent = (typeof TRIP_INTENTS)[number];

export type UserDetailTrip = {
  city: string;
  country: string;
  arrival_at: number;
  departure_at: number;
  show_to_locals: boolean;
  intents: TripIntent[];
  status: string;
  updated_at: number;
};

export type UserDetailLocation = {
  city: string;
  region: string;
  country: string;
  country_code: string;
  location_name: string;
};

export type UserDetailProfile = {
  uid: number;
  display_name: string;
  user_name: string;
  codename: string;
  about_me: string;
  headline: string;
  age: number;
  birthyear: number;
  generation: string;
  /**
   * The three D-122 support facts, decoded ADDITIVELY and fail-open: an absent
   * key is `null` and prints as an em dash, never a guessed `hidden` /`false`.
   *
   * Fail-open is deliberate here and is the opposite of the rule the member
   * clients follow. A client that cannot read `age_display` must fall back to
   * `hidden`, because guessing wrong exposes an age the member asked to keep
   * private. This console renders no age from these fields at all — they are a
   * diagnostic that answers "why can this member not turn 'show my age' on?" —
   * so printing a definite "Hidden" for a value the server never sent would
   * invent a support answer, which is the failure that matters here.
   *
   * `realdob === false` is the whole point of the trio: it is the only field
   * that explains a `profile-birthday-unconfirmed` refusal on a member whose
   * age looks perfectly ordinary from this page.
   */
  age_display: AgeDisplay | null;
  birthday_locked: boolean | null;
  realdob: boolean | null;
  created: number;
  last_seen: number;
  phone_e164: string;
  email: string;
  email_is_real: boolean;
  /** The page renders only yes/no, so the identifier itself is never carried. */
  has_apple_id: boolean;
  avatar_thumb: string;
  last_location: UserDetailLocation | null;
  hometown: UserDetailLocation | null;
};

export type UserDetailImage = {
  image_id: string;
  thumb: string;
  full: string;
  mod_status: "accepted" | "pending" | "denied";
};

export type UserDetail = {
  profile: UserDetailProfile;
  images: UserDetailImage[];
  /** The five tag arrays flattened to the labels the page prints; row identifiers are dropped. */
  tags: string[];
  /** Safe, typed entitlement/store/admin-grant projection owned by Membership V1. */
  membership: MembershipUserDetail;
  /** Boolean-only provider registration state; raw identifiers never enter this model. */
  push_channels: PushChannels | null;
  /** Bounded Core-authored gate for the separate Verification support read. */
  verification_access: VerificationAccess | null;
  /** Stored operator data, independent of the member-facing Travel switch. */
  trip: UserDetailTrip | null;
};

const MOD_STATUSES = ["accepted", "pending", "denied"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Absent, null and anything that is not a boolean all read as "not stated". */
function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function ageDisplay(value: unknown): AgeDisplay | null {
  return typeof value === "string" && (AGE_DISPLAY_VALUES as readonly string[]).includes(value)
    ? value as AgeDisplay
    : null;
}

/** D-123: only this additive block degrades to null when absent or malformed. */
function trip(value: unknown): UserDetailTrip | null {
  const source = record(value);
  if (!source) return null;
  const boundedText = (value: unknown, max: number): value is string =>
    typeof value === "string" && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
  const timestamp = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000;
  if (!boundedText(source.city, 120) || source.city.trim() === ""
    || !boundedText(source.country, 120)
    || !timestamp(source.arrival_at) || !timestamp(source.departure_at)
    || source.departure_at < source.arrival_at || !timestamp(source.updated_at)
    || typeof source.show_to_locals !== "boolean"
    || !boundedText(source.status, 80) || source.status.trim() === ""
    || !Array.isArray(source.intents) || source.intents.length > TRIP_INTENTS.length
    || !source.intents.every((intent): intent is TripIntent =>
      typeof intent === "string" && (TRIP_INTENTS as readonly string[]).includes(intent))
    || new Set(source.intents).size !== source.intents.length) return null;

  // Project only the eight display fields; extra keys (including coordinates) stay out of state.
  return {
    city: source.city,
    country: source.country,
    arrival_at: source.arrival_at,
    departure_at: source.departure_at,
    show_to_locals: source.show_to_locals,
    intents: [...source.intents],
    status: source.status,
    updated_at: source.updated_at,
  };
}

/** Non-finite and non-numeric both become 0, which every consumer renders as an em dash. */
function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Only the five administrative place names the page joins. A latitude or longitude present on the
 * source object is dropped here and never reaches state.
 */
function location(value: unknown): UserDetailLocation | null {
  const source = record(value);
  if (!source) return null;
  const projected: UserDetailLocation = {
    city: text(source.city),
    region: text(source.region),
    country: text(source.country),
    country_code: text(source.country_code),
    location_name: text(source.location_name),
  };
  return Object.values(projected).some((entry) => entry !== "") ? projected : null;
}

function image(value: unknown): UserDetailImage | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.image_id);
  if (id === "") return null;
  const status = text(source.mod_status);
  return {
    image_id: id,
    thumb: text(source.thumb),
    full: text(source.full),
    mod_status: (MOD_STATUSES as readonly string[]).includes(status)
      ? status as UserDetailImage["mod_status"]
      : "accepted",
  };
}

/** Each tag row exposes its label under one of several historical key names. */
function tagLabel(value: unknown): string {
  const source = record(value);
  if (!source) return "";
  for (const key of ["value", "name", "label", "key"]) {
    const candidate = text(source[key]);
    if (candidate !== "") return candidate;
  }
  return "";
}

const TAG_FIELDS = ["about_me", "into_tags", "my_life_tags", "sport_tags", "interest_tags"] as const;

/**
 * Parse a `user_detail` payload, failing closed. A response without a usable profile is an error,
 * not a blank page — `AGENTS.md`: "Treat malformed success responses as errors."
 */
export function userDetail(
  value: unknown,
  requirePushChannels = false,
  requireVerificationAccess = false,
): UserDetail | null {
  const source = record(value);
  const profileSource = record(source?.profile);
  if (!source || !profileSource) return null;

  const uid = Number(profileSource.uid);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  const membership = source.membership === undefined
    ? unavailableMembershipUserDetail(uid)
    : membershipUserDetail(source.membership);
  if (!membership || membership.uid !== uid) return null;

  let parsedPushChannels: PushChannels | null = null;
  if (source.push_channels === undefined) {
    if (requirePushChannels) return null;
  } else {
    parsedPushChannels = pushChannels(source.push_channels);
    if (!parsedPushChannels) return null;
  }

  let parsedVerificationAccess: VerificationAccess | null = null;
  if (source.verification_access === undefined) {
    if (requireVerificationAccess) return null;
  } else {
    parsedVerificationAccess = verificationAccess(source.verification_access);
    if (!parsedVerificationAccess) return null;
  }

  const images: UserDetailImage[] = [];
  if (source.images !== undefined) {
    if (!Array.isArray(source.images)) return null;
    for (const entry of source.images) {
      const parsed = image(entry);
      if (parsed) images.push(parsed);
    }
  }

  const tags: string[] = [];
  for (const field of TAG_FIELDS) {
    const rows = source[field];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      const label = tagLabel(row);
      if (label !== "") tags.push(label);
    }
  }

  return {
    profile: {
      uid,
      display_name: text(profileSource.display_name),
      user_name: text(profileSource.user_name),
      codename: text(profileSource.codename),
      about_me: text(profileSource.about_me),
      headline: text(profileSource.headline),
      age: count(profileSource.age),
      birthyear: count(profileSource.birthyear),
      generation: text(profileSource.generation),
      age_display: ageDisplay(profileSource.age_display),
      birthday_locked: optionalBoolean(profileSource.birthday_locked),
      realdob: optionalBoolean(profileSource.realdob),
      created: count(profileSource.created),
      last_seen: count(profileSource.last_seen),
      phone_e164: text(profileSource.phone_e164),
      email: text(profileSource.email),
      email_is_real: profileSource.email_is_real === true,
      has_apple_id: text(profileSource.apple_id) !== "",
      avatar_thumb: text(profileSource.avatar_thumb),
      last_location: location(profileSource.last_location),
      hometown: location(profileSource.hometown),
    },
    images,
    tags,
    membership,
    push_channels: parsedPushChannels,
    verification_access: parsedVerificationAccess,
    trip: trip(source.trip),
  };
}

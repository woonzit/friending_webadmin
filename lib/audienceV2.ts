/**
 * V2 catalogue rule model — pure, contract-independent.
 *
 * The shape is fixed by the frozen `freelove-internal-classification-v1.2.md` §4, not by a Core
 * wire contract, so this module can be built and tested before Core publishes the Phase 1 admin
 * contract. Core remains authoritative for validation, storage and promotion; this is the console's
 * fail-closed reading of a rule plus the pure predicates DEC-006 gates on.
 *
 * Three separate policies, deliberately not one value (§2):
 *   eligibility — who may be offered the field or item
 *   visibility  — who may see a stored answer
 *   (audience reach is `MemberAudienceAuthorization` and is not modelled here at all)
 */

export type EligibilityMode = "all" | "rules" | "none";

/** Spec v2.5 §4 main gender values. Note these are the V2 vocabulary, not `male|female|other`. */
export const ELIGIBILITY_GENDERS = ["woman", "man", "nonbinary"] as const;
export type EligibilityGender = (typeof ELIGIBILITY_GENDERS)[number];

/** Spec v2.5 §8 Layer 1. The only intent axis an admin rule may target. */
export const LOOKING_FOR_VALUES = ["sex", "friends", "love"] as const;
export type LookingForValue = (typeof LOOKING_FOR_VALUES)[number];

export const ELIGIBILITY_MODES = ["all", "rules", "none"] as const;
export type VisibilityMode = "public" | "reciprocal_set";

/**
 * Axis names an admin rule may never target, because each one re-encodes the orientation inference
 * this work exists to remove (§3 [v1.1] and the §3 naming rule). `wants` is the load-bearing one:
 * it belongs in the eligibility *context* because `AudiencePolicyV2` needs it, and must not be
 * targetable by a rule. The rest are the legacy cast vocabulary under other names.
 *
 * This is a denylist on top of a closed allowlist, deliberately: the parser already rejects unknown
 * keys, so this exists to make the *reason* for the rejection explicit and testable.
 */
export const FORBIDDEN_ELIGIBILITY_AXES = [
  "wants",
  "wants_any",
  "wants_all",
  "orientation",
  "orientations",
  "orientations_any",
  "segment",
  "segments",
  "cast",
  "legacy_cast_v1",
] as const;

export type EligibilityRule = {
  mode: EligibilityMode;
  /** Empty means unrestricted on this axis. A non-empty list requires `gender_restriction_reason`. */
  genders_any: EligibilityGender[];
  /** Empty means unrestricted on this axis. */
  looking_for_any: LookingForValue[];
  /** Each entry is an opt-in the member must hold. More entries is a narrower rule. */
  required_opt_ins: string[];
  /**
   * §3 v1.2: a genuine gender restriction is "a rare exception, justified individually in the audit
   * and recorded with its reason". Required and non-empty whenever `genders_any` is non-empty.
   */
  gender_restriction_reason: string;
};

export type VisibilityRule =
  | { mode: "public" }
  | { mode: "reciprocal_set"; set_id: string };

export type AudienceRuleV2 = {
  rule_version: 2;
  eligibility: EligibilityRule;
  visibility: VisibilityRule;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Trimmed, non-empty, duplicate-free string list. Anything else is a parse failure. */
function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string" && item.trim() === item && item !== "")) {
    return null;
  }
  return new Set(value).size === value.length ? value as string[] : null;
}

function closedList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  const parsed = strings(value ?? []);
  if (!parsed) return null;
  return parsed.every((item) => (allowed as readonly string[]).includes(item))
    ? parsed as T[]
    : null;
}

/**
 * Why a rule was rejected. Returned instead of a bare `null` because WA-01's editor has to tell an
 * operator which of the five concepts is wrong, and `null` cannot carry that.
 */
export type AudienceRuleError =
  | "malformed"
  | "rule-version-unsupported"
  | "eligibility-mode-invalid"
  | "eligibility-axis-forbidden"
  | "eligibility-gender-invalid"
  | "eligibility-looking-for-invalid"
  | "eligibility-opt-in-invalid"
  | "gender-restriction-reason-required"
  | "eligibility-axis-set-on-non-rules-mode"
  | "visibility-mode-invalid"
  | "reciprocal-set-id-required"
  | "reciprocal-set-id-on-public";

export type AudienceRuleResult =
  | { ok: true; rule: AudienceRuleV2 }
  | { ok: false; error: AudienceRuleError };

const MAX_REASON_LENGTH = 500;
const SET_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Parse a V2 rule, failing closed. Anything unrecognised is an error, never a permissive default —
 * an eligibility rule that fails open offers a field to a cohort it should not reach, which is the
 * exact defect class this model replaces.
 */
export function audienceRuleV2(value: unknown): AudienceRuleResult {
  const source = record(value);
  if (!source) return { ok: false, error: "malformed" };
  if (source.rule_version !== 2) return { ok: false, error: "rule-version-unsupported" };

  const eligibility = record(source.eligibility);
  const visibility = record(source.visibility);
  if (!eligibility || !visibility) return { ok: false, error: "malformed" };

  for (const axis of FORBIDDEN_ELIGIBILITY_AXES) {
    if (axis in eligibility) return { ok: false, error: "eligibility-axis-forbidden" };
  }

  const mode = String(eligibility.mode ?? "");
  if (!(ELIGIBILITY_MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: "eligibility-mode-invalid" };
  }

  const genders = closedList(eligibility.genders_any, ELIGIBILITY_GENDERS);
  if (!genders) return { ok: false, error: "eligibility-gender-invalid" };
  const lookingFor = closedList(eligibility.looking_for_any, LOOKING_FOR_VALUES);
  if (!lookingFor) return { ok: false, error: "eligibility-looking-for-invalid" };
  const optIns = strings(eligibility.required_opt_ins ?? []);
  if (!optIns || !optIns.every((item) => SET_ID_PATTERN.test(item))) {
    return { ok: false, error: "eligibility-opt-in-invalid" };
  }

  const axesUsed = genders.length > 0 || lookingFor.length > 0 || optIns.length > 0;
  // `all` and `none` are absolute. Carrying conditions alongside them is ambiguous rather than
  // harmless: it hides whether the author meant the mode or the conditions.
  if (mode !== "rules" && axesUsed) {
    return { ok: false, error: "eligibility-axis-set-on-non-rules-mode" };
  }

  const reasonValue = eligibility.gender_restriction_reason;
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";
  if (reasonValue !== undefined && typeof reasonValue !== "string") {
    return { ok: false, error: "malformed" };
  }
  if (genders.length > 0 && (reason === "" || reason.length > MAX_REASON_LENGTH)) {
    return { ok: false, error: "gender-restriction-reason-required" };
  }

  const visibilityMode = String(visibility.mode ?? "");
  if (visibilityMode !== "public" && visibilityMode !== "reciprocal_set") {
    return { ok: false, error: "visibility-mode-invalid" };
  }
  const setId = typeof visibility.set_id === "string" ? visibility.set_id : "";
  if (visibilityMode === "reciprocal_set" && !SET_ID_PATTERN.test(setId)) {
    return { ok: false, error: "reciprocal-set-id-required" };
  }
  // Spec §8 [v2.2]: only opting into the *same* set unlocks that set's data. A public item carrying
  // a set id is the shape that made "any reciprocal item unlocks all of them" readable.
  if (visibilityMode === "public" && "set_id" in visibility) {
    return { ok: false, error: "reciprocal-set-id-on-public" };
  }

  return {
    ok: true,
    rule: {
      rule_version: 2,
      eligibility: {
        mode: mode as EligibilityMode,
        genders_any: genders,
        looking_for_any: lookingFor,
        required_opt_ins: optIns,
        gender_restriction_reason: genders.length > 0 ? reason : "",
      },
      visibility: visibilityMode === "public"
        ? { mode: "public" }
        : { mode: "reciprocal_set", set_id: setId },
    },
  };
}

/** `none` is "withheld pending review", not "inactive" and not "deleted". §4 [v1.2]. */
export function isWithheldPendingReview(rule: AudienceRuleV2): boolean {
  return rule.eligibility.mode === "none";
}

const MODE_BREADTH: Record<EligibilityMode, number> = { none: 0, rules: 1, all: 2 };

/**
 * Does `after` offer this item to anyone `before` did not?
 *
 * This is the predicate DEC-006 gates on. The version flip is close to safety-neutral when it
 * carries conservative defaults; the harm arrives when a rule starts offering content to a cohort
 * it should not reach, and that can happen in an ordinary edit long after promotion.
 *
 * Fail-closed: when breadth cannot be proven to be non-increasing, this returns `true`, so the
 * uncertain case requires the approval rather than skipping it. Narrowing is always free — the same
 * asymmetry as spec v2.5 §11 Gate 1, where a safety action is never gated.
 */
export function widensEligibility(before: EligibilityRule, after: EligibilityRule): boolean {
  const beforeBreadth = MODE_BREADTH[before.mode];
  const afterBreadth = MODE_BREADTH[after.mode];
  if (afterBreadth !== beforeBreadth) return afterBreadth > beforeBreadth;
  if (after.mode !== "rules") return false; // all→all and none→none change nothing.

  // An empty axis list means "unrestricted on this axis", so it is the widest possible value and a
  // non-empty list can never be wider than it.
  const allowsMore = (b: readonly string[], a: readonly string[]): boolean => {
    if (b.length === 0) return false;
    if (a.length === 0) return true;
    return a.some((item) => !b.includes(item));
  };
  if (allowsMore(before.genders_any, after.genders_any)) return true;
  if (allowsMore(before.looking_for_any, after.looking_for_any)) return true;
  // Opt-ins are requirements, so dropping one widens.
  return before.required_opt_ins.some((item) => !after.required_opt_ins.includes(item));
}

/**
 * Does `after` disclose a stored answer to anyone `before` did not?
 *
 * Kept separate from eligibility on purpose: conflating "may answer" with "may see" is the
 * mechanism behind the leak recorded as DEC-003, and separating the two controls is what fixes it
 * structurally rather than case by case (§4).
 */
export function widensVisibility(before: VisibilityRule, after: VisibilityRule): boolean {
  if (before.mode === "public") return false;
  if (after.mode === "public") return true;
  return after.set_id !== before.set_id;
}

/** Either kind of widening arms `catalog_widening_decide` under DEC-006. */
export function widensRule(before: AudienceRuleV2, after: AudienceRuleV2): boolean {
  return widensEligibility(before.eligibility, after.eligibility)
    || widensVisibility(before.visibility, after.visibility);
}

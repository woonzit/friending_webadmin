import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  audienceRuleV2,
  isWithheldPendingReview,
  widensEligibility,
  widensRule,
  widensVisibility,
  FORBIDDEN_ELIGIBILITY_AXES,
  type AudienceRuleV2,
} from "../lib/audienceV2.ts";

const rules = {
  rule_version: 2,
  eligibility: {
    mode: "rules",
    genders_any: ["man", "nonbinary"],
    looking_for_any: ["sex"],
    required_opt_ins: ["intimate_pack"],
    gender_restriction_reason: "Anatomy-specific prompt retained pending a neutral rewrite.",
  },
  visibility: { mode: "reciprocal_set", set_id: "kink" },
};

function parsed(value: unknown): AudienceRuleV2 {
  const result = audienceRuleV2(value);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.rule;
}

function rejects(value: unknown, error: string): void {
  const result = audienceRuleV2(value);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected a rejection");
  assert.equal(result.error, error);
}

test("the three eligibility modes parse and only `rules` may carry conditions", () => {
  assert.equal(parsed(rules).eligibility.mode, "rules");
  const all = { rule_version: 2, eligibility: { mode: "all" }, visibility: { mode: "public" } };
  assert.equal(parsed(all).eligibility.mode, "all");
  const none = { rule_version: 2, eligibility: { mode: "none" }, visibility: { mode: "public" } };
  assert.equal(isWithheldPendingReview(parsed(none)), true);
  assert.equal(isWithheldPendingReview(parsed(all)), false);

  rejects({ ...rules, eligibility: { ...rules.eligibility, mode: "everyone" } }, "eligibility-mode-invalid");
  // `all` or `none` carrying conditions hides whether the author meant the mode or the conditions.
  rejects(
    { rule_version: 2, eligibility: { mode: "all", genders_any: ["man"], gender_restriction_reason: "x" }, visibility: { mode: "public" } },
    "eligibility-axis-set-on-non-rules-mode",
  );
  rejects({ ...rules, rule_version: 1 }, "rule-version-unsupported");
  rejects(null, "malformed");
});

test("`wants` and every other orientation-inferring axis is refused by name", () => {
  for (const axis of FORBIDDEN_ELIGIBILITY_AXES) {
    const rule = structuredClone(rules) as Record<string, any>;
    rule.eligibility[axis] = ["anything"];
    rejects(rule, "eligibility-axis-forbidden");
  }
  // The load-bearing case, stated explicitly so a future edit cannot quietly drop it: a rule scoped
  // to `gender=man AND wants contains men` is functional orientation inference under another name.
  const wants = structuredClone(rules) as Record<string, any>;
  wants.eligibility.wants = ["men"];
  rejects(wants, "eligibility-axis-forbidden");
});

test("a gender restriction is refused without a stored reason", () => {
  const noReason = structuredClone(rules) as Record<string, any>;
  delete noReason.eligibility.gender_restriction_reason;
  rejects(noReason, "gender-restriction-reason-required");

  const blank = structuredClone(rules) as Record<string, any>;
  blank.eligibility.gender_restriction_reason = "   ";
  rejects(blank, "gender-restriction-reason-required");

  const tooLong = structuredClone(rules) as Record<string, any>;
  tooLong.eligibility.gender_restriction_reason = "x".repeat(501);
  rejects(tooLong, "gender-restriction-reason-required");

  // No gender axis, no reason needed — and the reason is not retained for a rule that has none.
  const noGender = structuredClone(rules) as Record<string, any>;
  noGender.eligibility.genders_any = [];
  assert.equal(parsed(noGender).eligibility.gender_restriction_reason, "");
});

test("closed vocabularies reject V1 values and unknown members", () => {
  const legacyGender = structuredClone(rules) as Record<string, any>;
  legacyGender.eligibility.genders_any = ["male"]; // the V1 vocabulary
  rejects(legacyGender, "eligibility-gender-invalid");

  const unknownIntent = structuredClone(rules) as Record<string, any>;
  unknownIntent.eligibility.looking_for_any = ["dating"]; // a Layer 2 item, not a Layer 1 group
  rejects(unknownIntent, "eligibility-looking-for-invalid");

  const duplicate = structuredClone(rules) as Record<string, any>;
  duplicate.eligibility.genders_any = ["man", "man"];
  rejects(duplicate, "eligibility-gender-invalid");
});

test("visibility keeps reciprocal sets named and never lets a public item carry one", () => {
  assert.deepEqual(parsed(rules).visibility, { mode: "reciprocal_set", set_id: "kink" });
  rejects({ ...rules, visibility: { mode: "reciprocal_set" } }, "reciprocal-set-id-required");
  rejects({ ...rules, visibility: { mode: "reciprocal_set", set_id: "Kink!" } }, "reciprocal-set-id-required");
  rejects({ ...rules, visibility: { mode: "public", set_id: "kink" } }, "reciprocal-set-id-on-public");
  rejects({ ...rules, visibility: { mode: "profile" } }, "visibility-mode-invalid");
});

test("widening is detected across modes, axes and opt-ins; narrowing never is", () => {
  const e = (over: Record<string, unknown> = {}) => ({
    mode: "rules" as const,
    genders_any: [],
    looking_for_any: [],
    required_opt_ins: [],
    gender_restriction_reason: "",
    ...over,
  });
  const none = { ...e(), mode: "none" as const };
  const all = { ...e(), mode: "all" as const };

  // Mode breadth.
  assert.equal(widensEligibility(none, all), true);
  assert.equal(widensEligibility(none, e()), true);
  assert.equal(widensEligibility(all, none), false);
  assert.equal(widensEligibility(all, all), false);
  assert.equal(widensEligibility(none, none), false);

  // An empty axis means unrestricted, so adding a restriction narrows and removing one widens.
  const men = e({ genders_any: ["man"] });
  const menAndNonbinary = e({ genders_any: ["man", "nonbinary"] });
  assert.equal(widensEligibility(men, menAndNonbinary), true);
  assert.equal(widensEligibility(menAndNonbinary, men), false);
  assert.equal(widensEligibility(men, e()), true, "dropping the gender axis entirely widens");
  assert.equal(widensEligibility(e(), men), false, "adding a gender axis narrows");

  // Intent axis behaves the same way.
  assert.equal(widensEligibility(e({ looking_for_any: ["sex"] }), e({ looking_for_any: ["sex", "love"] })), true);
  assert.equal(widensEligibility(e({ looking_for_any: ["sex", "love"] }), e({ looking_for_any: ["sex"] })), false);

  // Opt-ins are requirements: dropping one widens, adding one narrows.
  assert.equal(widensEligibility(e({ required_opt_ins: ["intimate_pack"] }), e()), true);
  assert.equal(widensEligibility(e(), e({ required_opt_ins: ["intimate_pack"] })), false);

  // A swap that is neither a superset nor a subset still widens, because someone new is offered it.
  assert.equal(widensEligibility(men, e({ genders_any: ["woman"] })), true);
});

test("disclosure widening is tracked separately from eligibility widening", () => {
  assert.equal(widensVisibility({ mode: "reciprocal_set", set_id: "kink" }, { mode: "public" }), true);
  assert.equal(widensVisibility({ mode: "public" }, { mode: "reciprocal_set", set_id: "kink" }), false);
  // Moving to a different set exposes the answer to a cohort that never opted into the first one.
  assert.equal(
    widensVisibility({ mode: "reciprocal_set", set_id: "kink" }, { mode: "reciprocal_set", set_id: "enm" }),
    true,
  );
  assert.equal(
    widensVisibility({ mode: "reciprocal_set", set_id: "kink" }, { mode: "reciprocal_set", set_id: "kink" }),
    false,
  );

  // Either kind arms the DEC-006 approval, and a rule narrowed on both axes never does.
  const narrow = parsed(rules);
  const wide = parsed({ ...rules, visibility: { mode: "public" } });
  assert.equal(widensRule(narrow, wide), true);
  assert.equal(widensRule(wide, narrow), false);
  assert.equal(widensRule(narrow, narrow), false);
});

test("the model states its own provenance and stays free of Core wire assumptions", async () => {
  const source = await readFile(new URL("../lib/audienceV2.ts", import.meta.url), "utf8");
  // The shape comes from the frozen spec, which is why this module can exist before the contract.
  assert.match(source, /friending-internal-classification-v1\.2\.md/);
  // No Core call, no bridge import: this stays a pure model until the Phase 1 contract lands.
  assert.doesNotMatch(source, /adminCall|coreCall|fetch\(/);
});

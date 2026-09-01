import assert from "node:assert/strict";
import test from "node:test";
import { userCastGroup, userCastGroupsPayload } from "../lib/userCastGroups.ts";
import { DISCLOSURE_ONLY_ORIENTATION_KEYS } from "../lib/orientationIntegrity.ts";

const group = {
  id: "64f000000000000000000001",
  key: "queer_men",
  labels: { en: "Queer men", hu: "Queer férfiak" },
  rules: [{ genders: ["male"], orientations: ["gay", "bisexual"] }],
  legacy_segment: "male_gay",
  sort_order: 100,
  active: true,
  system: false,
  revision: 1,
};

const segments = [{
  key: "male_gay",
  labels: { en: "Gay men", hu: "Meleg férfiak" },
}];

test("user-group parser fails closed on malformed membership rules", () => {
  assert.equal(userCastGroup(group)?.key, "queer_men");

  const noRules = structuredClone(group) as Record<string, any>;
  noRules.rules = [];
  assert.equal(userCastGroup(noRules), null);

  const badGender = structuredClone(group) as Record<string, any>;
  badGender.rules[0].genders = ["robot"];
  assert.equal(userCastGroup(badGender), null);

  const missingTranslation = structuredClone(group) as Record<string, any>;
  delete missingTranslation.labels.hu;
  assert.equal(userCastGroup(missingTranslation), null);

  const duplicate = structuredClone(group);
  assert.equal(userCastGroupsPayload({ groups: [group, duplicate], segments }), null);

  const danglingLegacy = structuredClone(group) as Record<string, any>;
  danglingLegacy.legacy_segment = "female_lesbian";
  assert.equal(userCastGroupsPayload({ groups: [danglingLegacy], segments }), null);

  for (const forbidden of DISCLOSURE_ONLY_ORIENTATION_KEYS) {
    const disclosureRule = structuredClone(group) as Record<string, any>;
    disclosureRule.rules[0].orientations = [forbidden];
    assert.equal(userCastGroup(disclosureRule), null, forbidden);
  }

  const customMatching = structuredClone(group) as Record<string, any>;
  customMatching.rules[0].orientations = ["custom_match"];
  assert.equal(
    userCastGroup(customMatching)?.rules[0].orientations[0],
    "custom_match",
  );
});

/*
 * T-565 retired `/user-groups`, so the page assertions that stood here went
 * with it. The DECODER stays: profile fields, profile tags, icebreakers and
 * signup options all embed this vocabulary in their own catalogue payloads.
 */

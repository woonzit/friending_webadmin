import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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

test("user-group page presents responsive rule cards and bounded vocabulary errors", async () => {
  const source = await readFile(new URL("../app/(dashboard)/user-groups/page.tsx", import.meta.url), "utf8");
  assert.match(source, /user-group-card-grid/);
  assert.match(source, /t\("ruleAnd"\)/);
  assert.match(source, /t\("ruleOr"\)/);
  assert.match(source, /cast-group-orientation-unknown/);
  assert.doesNotMatch(source, /<table/);
  assert.match(source, /containsDisclosureOnlyOrientation\(rule\.orientations\)/);
  assert.match(source, /cast-group-orientation-disclosure-forbidden/);
  assert.match(source, /isDisclosureOnlyOrientation\(option\.key\)/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { icebreakerCatalog } from "../lib/icebreakers.ts";

// T-630 (D-094): Friending has ONE icebreaker category, so the catalogue is
// friends-only. The label pair is what Core serves for `friends`
// (`api/src/Support/IcebreakerPolicy.php` GROUP_LABELS).
const friendsGroup = { key: "friends", labels: { en: "Friends cards", hu: "Barátság kártyák" } };
const friendsGroups = [friendsGroup];

// The two retired legacy deck keys, as refused INPUTS only: the decoder accepted
// the `friends,sex,love` triple during the T-630 transition and T-631 removed it.
const legacySexGroup = { key: "sex", labels: { en: "Legacy deck", hu: "Örökölt pakli" } };
const legacyLoveGroup = { key: "love", labels: { en: "Legacy deck", hu: "Örökölt pakli" } };

const valid = {
  schema_version: 1,
  groups: friendsGroups,
  member_sexes: [
    { key: "male", labels: { en: "Men", hu: "Férfiak" } },
    { key: "female", labels: { en: "Women", hu: "Nők" } },
    { key: "both", labels: { en: "Everyone", hu: "Mindenki" } },
  ],
  segments: [{ key: "female_lesbian", labels: { en: "Lesbian women", hu: "Leszbikus nők" } }],
  cast_groups: [],
  prompts: [{
    id: "abc",
    key: "friendship_goals",
    labels: { en: "Friendship goals = these 3 things:", hu: "Számomra a jó barátság három alapja:" },
    groups: ["friends"],
    member_sex: "both",
    audience: { mode: "global", segments: [] },
    sort_order: 10,
    active: true,
    revision: 1,
    system_owned: true,
    source: "builtin",
    legacy_ids: [],
  }],
};

const castGroup = {
  id: "64f000000000000000000001",
  key: "women_who_date_women",
  labels: { en: "Women who date women", hu: "Nőkkel ismerkedő nők" },
  rules: [{ genders: ["female"], orientations: ["lesbian", "bisexual"] }],
  legacy_segment: "female_lesbian",
  sort_order: 100,
  active: true,
  system: true,
  revision: 1,
};

function withGroups(groups: unknown) {
  const catalog = structuredClone(valid) as Record<string, unknown>;
  catalog.groups = groups;
  return catalog;
}

test("Icebreaker parser preserves independent card group and audience settings", () => {
  assert.equal(icebreakerCatalog(valid)?.prompts[0]?.groups[0], "friends");
  const missingCastGroups = structuredClone(valid) as Record<string, unknown>;
  delete missingCastGroups.cast_groups;
  assert.equal(icebreakerCatalog(missingCastGroups), null, "a missing audience catalogue is not an empty catalogue");
  const futureLocale = structuredClone(valid);
  (futureLocale.prompts[0].labels as Record<string, string>).de = "Freundschaftsziele = diese 3 Dinge:";
  assert.equal(icebreakerCatalog(futureLocale)?.prompts[0]?.labels.de, "Freundschaftsziele = diese 3 Dinge:");
  const invalid = structuredClone(valid);
  invalid.prompts[0].groups = ["unknown"];
  assert.equal(icebreakerCatalog(invalid), null);
  const incompleteTranslation = structuredClone(valid);
  incompleteTranslation.prompts[0].labels.hu = "";
  assert.equal(icebreakerCatalog(incompleteTranslation), null);
  const unknownSegment = structuredClone(valid);
  unknownSegment.prompts[0].audience = { mode: "segments", segments: ["unknown"] };
  assert.equal(icebreakerCatalog(unknownSegment), null);
  const invalidLocale = structuredClone(valid);
  (invalidLocale.prompts[0].labels as Record<string, string>)["invalid_locale!"] = "Invalid";
  assert.equal(icebreakerCatalog(invalidLocale), null);

  const targeted = structuredClone(valid) as Record<string, any>;
  targeted.cast_groups = [castGroup];
  targeted.prompts[0].audience = {
    mode: "segments",
    segments: [],
    genders: ["female"],
    group_ids: [castGroup.id],
  };
  const parsed = icebreakerCatalog(targeted);
  assert.deepEqual(parsed?.prompts[0]?.audience.genders, ["female"]);
  assert.deepEqual(parsed?.prompts[0]?.audience.group_ids, [castGroup.id]);

  const danglingGroup = structuredClone(targeted);
  danglingGroup.cast_groups = [];
  assert.equal(icebreakerCatalog(danglingGroup), null);
});

test("Icebreaker catalogue accepts exactly the one friends group (T-630, T-631) and refuses every other shape", () => {
  // The only shape: exactly [friends].
  const single = icebreakerCatalog(valid);
  assert.ok(single, "the friends-only catalogue must decode");
  assert.deepEqual(single.groups.map((group) => group.key), ["friends"]);
  assert.equal(single.groups[0].labels.hu, "Barátság kártyák");

  // Every other groups list fails closed — including the legacy triple the
  // decoder tolerated between the T-630 Webadmin and Core deploys (T-631).
  const refused: Array<[string, unknown]> = [
    ["empty", []],
    ["sex only", [legacySexGroup]],
    ["love only", [legacyLoveGroup]],
    ["friends,sex", [friendsGroup, legacySexGroup]],
    ["friends,love", [friendsGroup, legacyLoveGroup]],
    ["the legacy triple friends,sex,love", [friendsGroup, legacySexGroup, legacyLoveGroup]],
    ["reordered triple", [legacyLoveGroup, legacySexGroup, friendsGroup]],
    ["triple plus a fourth", [friendsGroup, legacySexGroup, legacyLoveGroup, { key: "extra", labels: { en: "Extra", hu: "Extra" } }]],
    ["friends twice", [friendsGroup, friendsGroup]],
    ["friends without a Hungarian label", [{ key: "friends", labels: { en: "Friends cards" } }]],
    ["not a list", "friends"],
  ];
  for (const [label, groups] of refused) {
    assert.equal(icebreakerCatalog(withGroups(groups)), null, `groups ${label} must be refused`);
  }

  // The member_sexes pin is untouched by the groups change.
  const sexesDrift = structuredClone(valid) as Record<string, any>;
  sexesDrift.member_sexes = sexesDrift.member_sexes.slice(0, 2);
  assert.equal(icebreakerCatalog(sexesDrift), null);

  // Prompt-level groups are exactly ["friends"]: empty, a legacy key (alone or
  // beside friends), the legacy triple, a fourth key and a duplicate all fail closed.
  const promptGroups: Array<[string, unknown]> = [
    ["empty", []],
    ["sex only", ["sex"]],
    ["love only", ["love"]],
    ["friends,sex", ["friends", "sex"]],
    ["the legacy triple", ["friends", "sex", "love"]],
    ["four groups", ["friends", "sex", "love", "extra"]],
    ["friends twice", ["friends", "friends"]],
  ];
  for (const [label, groups] of promptGroups) {
    const drifted = structuredClone(valid) as Record<string, any>;
    drifted.prompts[0].groups = groups;
    assert.equal(icebreakerCatalog(drifted), null, `a prompt with groups ${label} must be refused`);
  }
});

test("Icebreaker admin capabilities and page are explicitly wired", async () => {
  const actions = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  for (const action of ["list_icebreakers", "save_icebreaker_prompt", "archive_icebreaker_prompt"]) {
    assert.match(actions, new RegExp(`"${action}"`));
  }
  const page = await readFile(new URL("../app/(dashboard)/icebreakers/page.tsx", import.meta.url), "utf8");
  assert.match(page, /member_sex/);
  assert.match(page, /groups_json/);
  assert.match(page, /segments_json/);
  assert.match(page, /genders_json/);
  assert.match(page, /group_ids_json/);
  assert.match(page, /MemberAudienceSelector/);
  // T-630 / T-631: one category — the console never offers a group to choose,
  // never renders a group column, and always posts groups_json ["friends"].
  assert.match(page, /groups_json: JSON\.stringify\(\["friends"\]\)/);
  assert.doesNotMatch(page, /singleGroup|isSingleGroupCatalog/);
  assert.doesNotMatch(page, /<fieldset[^>]*><legend>\{t\("groups"\)\}/);
  assert.doesNotMatch(page, /t\("groups"\)/);
  assert.match(page, /colSpan=\{5\}/);
});

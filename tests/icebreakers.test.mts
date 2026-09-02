import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { icebreakerCatalog, isSingleGroupCatalog } from "../lib/icebreakers.ts";

// T-630 (D-094): Friending has ONE icebreaker category, so the primary catalogue
// is friends-only. The label pair is what Core serves for `friends`
// (`api/src/Support/IcebreakerPolicy.php` GROUP_LABELS).
const friendsGroups = [
  { key: "friends", labels: { en: "Friends cards", hu: "Barátság kártyák" } },
];

// Transition only: a Core still on the Freelove triple, with the labels it serves
// today ("Dates cards" / "Relationship cards"). T-631 deletes this shape with the
// decoder branch that accepts it.
const legacyTripleGroups = [
  { key: "friends", labels: { en: "Friends cards", hu: "Barátság kártyák" } },
  { key: "sex", labels: { en: "Dates cards", hu: "Randi kártyák" } },
  { key: "love", labels: { en: "Relationship cards", hu: "Kapcsolat kártyák" } },
];

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

test("Icebreaker catalogue accepts the friends-only groups (T-630) and, in transition only, the legacy triple", () => {
  // (a) target shape: exactly [friends]
  const single = icebreakerCatalog(valid);
  assert.ok(single, "the friends-only catalogue must decode");
  assert.deepEqual(single.groups.map((group) => group.key), ["friends"]);
  assert.equal(single.groups[0].labels.hu, "Barátság kártyák");
  assert.equal(isSingleGroupCatalog(single), true);

  // (b) transition shape: exactly [friends, sex, love], deleted by T-631
  const legacy = withGroups(legacyTripleGroups) as Record<string, any>;
  legacy.prompts[0].groups = ["love"];
  legacy.prompts.push({ ...structuredClone(valid.prompts[0]), id: "def", key: "nightclub_or_netflix", groups: ["friends", "sex", "love"] });
  const triple = icebreakerCatalog(legacy);
  assert.ok(triple, "the legacy triple must still decode during the transition");
  assert.deepEqual(triple.groups.map((group) => group.key), ["friends", "sex", "love"]);
  assert.equal(triple.groups[1].labels.en, "Dates cards");
  assert.deepEqual(triple.prompts.map((prompt) => prompt.groups), [["love"], ["friends", "sex", "love"]]);
  assert.equal(isSingleGroupCatalog(triple), false);

  // Widening to two shapes must not have loosened anything else: every other
  // groups list fails closed exactly as before.
  const refused: Array<[string, unknown]> = [
    ["empty", []],
    ["sex only", [legacyTripleGroups[1]]],
    ["love only", [legacyTripleGroups[2]]],
    ["friends,sex", [legacyTripleGroups[0], legacyTripleGroups[1]]],
    ["friends,love", [legacyTripleGroups[0], legacyTripleGroups[2]]],
    ["reordered triple", [legacyTripleGroups[2], legacyTripleGroups[1], legacyTripleGroups[0]]],
    ["triple plus a fourth", [...legacyTripleGroups, { key: "extra", labels: { en: "Extra", hu: "Extra" } }]],
    ["friends twice", [legacyTripleGroups[0], legacyTripleGroups[0]]],
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

  // Prompt-level groups: empty still fails closed, more than three still fails
  // closed, a duplicate still fails closed; `sex`/`love` on a prompt are tolerated
  // on either catalogue shape for the transition (T-631 narrows to `friends`).
  const emptyGroups = structuredClone(valid) as Record<string, any>;
  emptyGroups.prompts[0].groups = [];
  assert.equal(icebreakerCatalog(emptyGroups), null, "a prompt with no groups is refused");
  const fourGroups = structuredClone(valid) as Record<string, any>;
  fourGroups.prompts[0].groups = ["friends", "sex", "love", "extra"];
  assert.equal(icebreakerCatalog(fourGroups), null, "a prompt with four groups is refused");
  const duplicateGroups = structuredClone(valid) as Record<string, any>;
  duplicateGroups.prompts[0].groups = ["friends", "friends"];
  assert.equal(icebreakerCatalog(duplicateGroups), null, "a duplicated group is refused");
  const legacyPromptGroup = structuredClone(valid) as Record<string, any>;
  legacyPromptGroup.prompts[0].groups = ["sex"];
  assert.deepEqual(icebreakerCatalog(legacyPromptGroup)?.prompts[0]?.groups, ["sex"], "transition tolerance on a prompt");
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
  // T-630: the single-group catalogue drives the group fieldset, the "Card groups"
  // column, the empty-row span and the group validation off the same predicate,
  // and the draft always carries ["friends"] on it.
  assert.match(page, /isSingleGroupCatalog\(catalog\)/);
  assert.match(page, /groups: singleGroup \? \["friends"\] : prompt\?\.groups \?\? \["friends"\]/);
  assert.match(page, /\{singleGroup \? null : <fieldset/);
  assert.match(page, /\{singleGroup \? null : <th>\{t\("groups"\)\}<\/th>\}/);
  assert.match(page, /colSpan=\{singleGroup \? 5 : 6\}/);
  assert.match(page, /\(!singleGroup && editor\.groups\.length === 0\)/);
});

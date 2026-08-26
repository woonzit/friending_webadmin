import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { icebreakerCatalog } from "../lib/icebreakers.ts";

const valid = {
  schema_version: 1,
  groups: [
    { key: "friends", labels: { en: "Friends cards", hu: "Barátság kártyák" } },
    { key: "sex", labels: { en: "Sex cards", hu: "Szex kártyák" } },
    { key: "love", labels: { en: "Love cards", hu: "Szerelem kártyák" } },
  ],
  member_sexes: [
    { key: "male", labels: { en: "Men", hu: "Férfiak" } },
    { key: "female", labels: { en: "Women", hu: "Nők" } },
    { key: "both", labels: { en: "Everyone", hu: "Mindenki" } },
  ],
  segments: [{ key: "female_lesbian", labels: { en: "Lesbian women", hu: "Leszbikus nők" } }],
  prompts: [{
    id: "abc",
    key: "ideal_first_date",
    labels: { en: "My ideal first date", hu: "Az ideális első randim:" },
    groups: ["love"],
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

test("Icebreaker parser preserves independent card group and audience settings", () => {
  assert.equal(icebreakerCatalog(valid)?.prompts[0]?.groups[0], "love");
  const futureLocale = structuredClone(valid);
  (futureLocale.prompts[0].labels as Record<string, string>).de = "Mein ideales erstes Date";
  assert.equal(icebreakerCatalog(futureLocale)?.prompts[0]?.labels.de, "Mein ideales erstes Date");
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
});

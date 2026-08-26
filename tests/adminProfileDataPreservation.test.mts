import test from "node:test";
import assert from "node:assert/strict";
import { profileAnswersPayload } from "../components/UserProfileDataEditor.tsx";
import type { ProfileField } from "../lib/profileFields.ts";

function field(
  key: string,
  overrides: Partial<ProfileField> = {},
): ProfileField {
  return {
    key,
    labels: { en: key, hu: key },
    descriptions: {},
    selection: { mode: "multi", min_selected: 0, max_selected: 3 },
    audience: { mode: "global", segments: [] },
    icon: { url: "", mime: "" },
    sort_order: 10,
    active: true,
    revision: 1,
    system_owned: false,
    source: "admin",
    options: [],
    values: [],
    ...overrides,
  };
}

test("saving from the console keeps a member's answers to an archived field", () => {
  const fields = [
    field("pets", { values: ["dogs"] }),
    field("smoking", { active: false, values: ["never"] }),
  ];
  const answers = { pets: ["dogs"], smoking: ["never"] };

  const payload = profileAnswersPayload(fields, answers);

  // The editor renders only `pets`, but `save_user_profile_fields` replaces the
  // whole answer document, so omitting `smoking` would delete the member's answer.
  assert.deepEqual(payload, { pets: ["dogs"], smoking: ["never"] });
});

test("an edit to a rendered field still wins over the loaded value", () => {
  const fields = [field("pets", { values: ["dogs"] }), field("smoking", { active: false, values: ["never"] })];
  const payload = profileAnswersPayload(fields, { pets: ["cats"], smoking: ["never"] });
  assert.deepEqual(payload.pets, ["cats"]);
});

test("clearing a rendered answer is still submitted as an empty selection", () => {
  const fields = [field("pets", { values: ["dogs"] })];
  assert.deepEqual(profileAnswersPayload(fields, { pets: [] }), { pets: [] });
});

test("an archived field nobody answered is not added to the payload", () => {
  const fields = [field("pets", { values: ["dogs"] }), field("smoking", { active: false, values: [] })];
  const answers = { pets: ["dogs"], smoking: [] };
  assert.deepEqual(profileAnswersPayload(fields, answers), { pets: ["dogs"] });
});

test("answers for a field the member is no longer eligible for are left to Core to prune", () => {
  const fields = [
    field("pets", { values: ["dogs"] }),
    field("kids", { eligible: false, values: ["yes"] }),
    field("retired_kids", { active: false, eligible: false, values: ["yes"] }),
  ];
  const payload = profileAnswersPayload(fields, { pets: ["dogs"], kids: ["yes"], retired_kids: ["yes"] });
  assert.deepEqual(Object.keys(payload), ["pets"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  identityOptionGroups,
  profileFieldCatalog,
  profileSectionLayout,
  userProfileFields,
} from "../lib/profileFields.ts";

test("profile-field admin actions remain explicit authenticated capabilities", async () => {
  const source = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  for (const action of [
    "list_profile_fields",
    "save_profile_section_layout",
    "save_profile_field",
    "save_profile_field_option",
    "user_profile_fields",
    "save_user_profile_fields",
    "save_user_profile_identity",
  ]) assert.match(source, new RegExp(`"${action}"`));
});

test("profile section layout parser enforces the three presentation groups and tolerates a layout with or without the height builtin", () => {
  const source = {
    schema_version: 1,
    key: "profile_sections_v1",
    revision: 4,
    sections: [
      {
        key: "main_data",
        labels: { en: "Main data", hu: "Fő adatok" },
        subtitles: { en: "About me", hu: "Rólam" },
        sort_order: 10,
        items: [{ kind: "builtin", key: "display_name" }],
      },
      {
        key: "more_about_you",
        labels: { en: "More about you", hu: "Többet rólad" },
        subtitles: { en: "Personality and lifestyle", hu: "Személyiség és életmód" },
        sort_order: 20,
        items: [
          { kind: "builtin", key: "height_cm" },
          { kind: "field", key: "pets" },
        ],
      },
      {
        key: "lets_go_deeper",
        labels: { en: "Let's go deeper", hu: "Menjünk mélyebbre" },
        subtitles: {},
        sort_order: 30,
        items: [],
      },
    ],
    builtin_items: [
      { key: "display_name", labels: { en: "Display name", hu: "Megjelenített név" }, value_type: "text", icon_key: "display_name", editable: false },
      { key: "height_cm", labels: { en: "Height", hu: "Magasság" }, value_type: "height_cm", icon_key: "height", editable: true },
    ],
  };
  assert.equal(profileSectionLayout(source)?.sections[1]?.items[0]?.key, "height_cm");
  const invalid = structuredClone(source);
  invalid.sections[0].items.push(invalid.sections[1].items.shift()!);
  assert.equal(profileSectionLayout(invalid), null, "a height builtin outside more_about_you still fails");

  // T-632: Core no longer serves the height builtin. A layout without it (in
  // the sections and in builtin_items) decodes; nothing else is relaxed.
  const heightless = structuredClone(source);
  heightless.sections[1].items = heightless.sections[1].items.filter((item) => item.key !== "height_cm");
  heightless.builtin_items = heightless.builtin_items.filter((item) => item.key !== "height_cm");
  const parsedHeightless = profileSectionLayout(heightless);
  assert.deepEqual(parsedHeightless?.sections[1]?.items, [{ kind: "field", key: "pets" }]);
  assert.deepEqual(parsedHeightless?.builtin_items.map((item) => item.key), ["display_name"]);
  assert.equal(parsedHeightless?.revision, 4);
  const heightlessMissingSection = structuredClone(heightless);
  heightlessMissingSection.sections.pop();
  assert.equal(profileSectionLayout(heightlessMissingSection), null, "three sections are still required");

  // Hidden state survives, while the retired Layer 2 gate is ignored rather
  // than entering the draft and being round-tripped on the next save.
  const legacyGated = structuredClone(source) as Record<string, any>;
  legacyGated.sections[2].hidden = true;
  legacyGated.sections[2].gate = { layer2_keys: ["casual_fun", "short_term"] };
  const parsedLegacy = profileSectionLayout(legacyGated);
  assert.equal(parsedLegacy?.sections[2]?.hidden, true);
  assert.equal(Object.hasOwn(parsedLegacy?.sections[2] ?? {}, "gate"), false);
  assert.equal(parsedLegacy?.sections[0]?.hidden, false);

  // more_about_you cannot hide: Core refuses the save (profile-section-not-hideable),
  // with or without a height builtin in the layout.
  const hiddenHeight = structuredClone(source) as Record<string, any>;
  hiddenHeight.sections[1].hidden = true;
  assert.equal(profileSectionLayout(hiddenHeight), null);
  const hiddenHeightless = structuredClone(heightless) as Record<string, any>;
  hiddenHeightless.sections[1].hidden = true;
  assert.equal(profileSectionLayout(hiddenHeightless), null);
});

test("layout editor exposes the hide switch and no retired Layer 2 gate surface", async () => {
  const [source, css, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  assert.match(source, /t\("layoutHide"\)/);
  assert.match(source, /section\.key === "more_about_you"/);
  assert.match(source, /profile-section-not-hideable/);
  assert.doesNotMatch(source, /Layer2|layer2|layoutGate|profile-section-gate|section\.gate/);
  assert.doesNotMatch(css, /profile-layout-gate/);
  for (const raw of [enRaw, huRaw]) {
    const messages = JSON.parse(raw);
    assert.deepEqual(
      Object.keys(messages.profileFields).filter((key) => key.startsWith("layoutGate")),
      [],
    );
    assert.equal(Object.hasOwn(messages.userProfileEditor, "sectionGateClosed"), false);
    assert.doesNotMatch(JSON.stringify(messages.adminHelp.pages.profileFields), /Layer 2|gate/iu);
  }
});

test("profile field parsers preserve translations, eligibility and identity revisions", () => {
  const option = {
    field_key: "pets",
    key: "dog",
    option_id: 123,
    labels: { en: "Dog", hu: "Kutya" },
    sort_order: 10,
    active: true,
    revision: 1,
    system_owned: false,
    source: "custom",
    legacy_ids: [],
    selected: true,
    label: "Kutya",
  };
  const field = {
    key: "pets",
    labels: { en: "Pets", hu: "Háziállatok" },
    descriptions: {},
    selection: { mode: "multi", min_selected: 0, max_selected: 4 },
    audience: { mode: "global", segments: [] },
    icon: { url: "", mime: "" },
    sort_order: 10,
    active: true,
    eligible: true,
    revision: 2,
    system_owned: true,
    source: "builtin",
    options: [option],
    values: ["dog"],
  };
  assert.ok(profileFieldCatalog({ schema_version: 1, segments: [], cast_groups: [], fields: [field] }));
  assert.equal(
    profileFieldCatalog({ schema_version: 1, segments: [], fields: [field] }),
    null,
    "a missing cast-group catalogue is not an empty audience vocabulary",
  );
  const castGroup = {
    id: "64f000000000000000000001",
    key: "men_who_date_men",
    labels: { en: "Men who date men", hu: "Férfiakkal ismerkedő férfiak" },
    rules: [{ genders: ["male"], orientations: ["gay", "bisexual"] }],
    legacy_segment: "male_gay",
    sort_order: 100,
    active: true,
    system: true,
    revision: 1,
  };
  const targetedField = structuredClone(field) as Record<string, any>;
  targetedField.audience = {
    mode: "segments",
    segments: [],
    genders: ["male"],
    group_ids: [castGroup.id],
  };
  const targetedCatalog = profileFieldCatalog({
    schema_version: 1,
    segments: [],
    cast_groups: [castGroup],
    fields: [targetedField],
  });
  assert.deepEqual(targetedCatalog?.fields[0]?.audience.genders, ["male"]);
  assert.deepEqual(targetedCatalog?.fields[0]?.audience.group_ids, [castGroup.id]);
  assert.equal(profileFieldCatalog({
    schema_version: 1,
    segments: [],
    cast_groups: [],
    fields: [targetedField],
  }), null);
  const parsed = userProfileFields({
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    language: "hu",
    segment: { key: "male_gay", label: "Meleg férfiak" },
    identity: {
      gender: "male",
      subgender: "",
      subgender_selected: false,
      orientation: "gay",
      updated_at: 44,
      audience_status: "active",
      channels: ["mlm"],
      question_packs: ["common", "gay_intimate"],
    },
    layout: {
      schema_version: 1,
      revision: 2,
      sections: [
        {
          key: "more_about_you",
          title: "Többet rólad",
          subtitle: "Személyiség és életmód",
          items: [{
            kind: "builtin",
            key: "height_cm",
            label: "Magasság",
            icon_key: "height",
            value_type: "height",
            editable: true,
            value: 181,
            display_value: "181 cm",
            constraints: { minimum: 120, maximum: 230, step: 1, unit: "cm" },
          }],
        },
        {
          key: "lets_go_deeper",
          title: "Menjünk mélyebbre",
          subtitle: "Személyesebb kérdések",
          visibility: {
            gated: false,
            share_enabled: true,
            audience_note: "A kölcsönös közönség láthatja.",
            gate_open: false,
            gate_layer2_keys: ["dating"],
          },
          items: [{ kind: "field", key: "pets" }],
        },
      ],
    },
    fields: [field],
  });
  assert.equal(parsed?.identity.updated_at, 44);
  assert.equal(parsed?.height.value, 181);
  assert.equal(parsed?.fields[0]?.eligible, true);
  assert.equal(parsed?.sections.length, 2);
  assert.equal(parsed?.sections[1]?.key, "lets_go_deeper");
  assert.equal(parsed?.sections[1]?.title, "Menjünk mélyebbre");
  assert.deepEqual(parsed?.sections[1]?.visibility, {
    share_enabled: true,
    audience_note: "A kölcsönös közönség láthatja.",
  });
  assert.deepEqual(parsed?.sections[1]?.items[0], { kind: "field", key: "pets" });

  const invalidHeight = structuredClone({
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    language: "hu",
    segment: { key: "male_gay", label: "Meleg férfiak" },
    identity: {
      gender: "male",
      subgender: "",
      subgender_selected: false,
      orientation: "gay",
      updated_at: 44,
      audience_status: "active",
      channels: ["mlm"],
      question_packs: ["common", "gay_intimate"],
    },
    layout: {
      schema_version: 1,
      revision: 2,
      sections: [{
        key: "more_about_you",
        title: "Többet rólad",
        subtitle: "Személyiség és életmód",
        items: [{
          kind: "builtin",
          key: "height_cm",
          label: "Magasság",
          icon_key: "height",
          value_type: "height",
          editable: true,
          value: 231,
          display_value: "231 cm",
          constraints: { minimum: 120, maximum: 230, step: 1, unit: "cm" },
        }],
      }],
    },
    fields: [field],
  });
  assert.equal(userProfileFields(invalidHeight), null);
  const missingConstraints = structuredClone(invalidHeight) as Record<string, any>;
  missingConstraints.layout.sections[0].items[0].value = 181;
  delete missingConstraints.layout.sections[0].items[0].constraints;
  assert.equal(userProfileFields(missingConstraints), null, "a served height builtin still needs its constraints");

  // T-632: Core no longer serves the height builtin. The member editor payload
  // decodes with height null and the remaining builtins are read-only facts.
  const heightless = structuredClone(invalidHeight) as Record<string, any>;
  heightless.layout.sections = [
    {
      key: "main_data",
      title: "Fő adatok",
      subtitle: "Rólam",
      items: [{
        kind: "builtin",
        key: "display_name",
        label: "Megjelenített név",
        icon_key: "display_name",
        value_type: "text",
        editable: false,
        value: "Példa",
        display_value: "Példa",
      }],
    },
    {
      key: "more_about_you",
      title: "Többet rólad",
      subtitle: "Személyiség és életmód",
      items: [{ kind: "field", key: "pets" }],
    },
  ];
  const parsedHeightless = userProfileFields(heightless);
  assert.ok(parsedHeightless, "a payload without the height builtin decodes");
  assert.equal(parsedHeightless.height, null);
  assert.equal(parsedHeightless.sections.length, 2);
  assert.deepEqual(parsedHeightless.sections[0]?.items[0], {
    kind: "builtin",
    key: "display_name",
    label: "Megjelenített név",
    icon_key: "display_name",
    value_type: "text",
    editable: false,
    value: "Példa",
    display_value: "Példa",
  });
  assert.deepEqual(parsedHeightless.sections[1]?.items, [{ kind: "field", key: "pets" }]);
});

test("identity option parser keeps server audience constraints", () => {
  const groups = [
    {
      key: "gender",
      name_en: "Gender",
      name_hu: "Nem",
      options: [{ key: "male", name_en: "Man", name_hu: "Férfi", audiences: [], active: true }],
    },
    {
      key: "subgender",
      name_en: "Identity",
      name_hu: "Identitás",
      options: [{ key: "man", name_en: "Man", name_hu: "Férfi", audiences: ["male"], active: true }],
    },
    {
      key: "orientation",
      name_en: "Orientation",
      name_hu: "Orientáció",
      options: [{
        key: "gay",
        name_en: "Gay",
        name_hu: "Meleg",
        audiences: ["male", "other"],
        active: true,
      }],
    },
  ];
  const parsed = identityOptionGroups(groups);
  assert.deepEqual(parsed?.[2]?.options[0]?.audiences, ["male", "other"]);
  assert.equal(identityOptionGroups([]), null, "missing identity vocabulary is not three loaded-empty selectors");
  assert.equal(identityOptionGroups(groups.slice(1)), null, "all three bounded groups are required");
  assert.equal(identityOptionGroups([...groups, groups[0]]), null, "duplicates cannot stand in for a missing group");
});

test("registered-user editor forwards the editable height only while Core serves it", async () => {
  const source = await readFile(new URL("../components/UserProfileDataEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /builtin_values_json/);
  // With a served height builtin the value is posted under height_cm; without
  // one (T-632) the body is `{}` rather than a stray key Core will refuse.
  assert.match(source, /data\.height \? \{ height_cm: heightCm \} : \{\}/);
  assert.match(source, /renderHeightEditor\(data\.height\)/);
  assert.match(source, /height\.minimum/);
  assert.match(source, /height\.maximum/);
  assert.doesNotMatch(source, /data\.height\.(value|minimum|maximum|step|unit)/);
});

test("registered-user editor renders the server section layout instead of one flat list", async () => {
  const source = await readFile(new URL("../components/UserProfileDataEditor.tsx", import.meta.url), "utf8");
  // Sections come from the wire; an ineligible field is shown disabled with a
  // marker instead of vanishing, so lets_go_deeper never disappears silently.
  assert.match(source, /data\.sections\.map/);
  assert.match(source, /t\("sectionEmpty"\)/);
  assert.match(source, /t\("ineligibleField"\)/);
  assert.match(source, /t\("builtinReadOnly"\)/);
  assert.match(source, /t\("unassignedTitle"\)/);
  assert.doesNotMatch(source, /eligibleFields\.map/);
  assert.doesNotMatch(source, /sectionGateClosed|visibility\?\.gated|gate_open|gate_layer2_keys/);
});

test("profile-field audience editor uses the shared gender and user-group selector", async () => {
  const source = await readFile(new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url), "utf8");
  assert.match(source, /MemberAudienceSelector/);
  assert.match(source, /genders_json/);
  assert.match(source, /group_ids_json/);
  assert.match(source, /showAnswers/);
  assert.match(source, /expandedFields/);
  assert.match(source, /profileFieldCatalog\(raw\)/);
  assert.doesNotMatch(source, /castGroupsRef|source\.cast_groups === undefined/);

  const userPage = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  assert.match(userPage, /identityOptionGroups\(profileResponse\?\.identity_options\)/);
  assert.match(userPage, /!parsedIdentityGroups/);
});

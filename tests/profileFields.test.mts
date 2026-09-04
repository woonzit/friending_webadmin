import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import UserProfileDataEditor, {
} from "../components/UserProfileDataEditor.tsx";
import {
  identityOptionGroups,
  profileFieldCatalog,
  profileSectionLayout,
  type UserProfileFields,
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
  // The V2 row shape Core has served here since T-736 (D-019/D-119).
  const castGroup = {
    id: "64f000000000000000000001",
    key: "male_for_male",
    labels: { en: "Men visible to men", hu: "Férfiak, akiket férfiak láthatnak" },
    rules: [{ genders: ["man"], visible_to: ["male"] }],
    legacy_segment: "male_gay",
    sort_order: 100,
    active: true,
    protected: true,
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

test("identity option parser accepts the served gender catalogue without orientation", () => {
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
  // TERMINAL (T-669, Core 1d108591): `WebadminController::userProfileFields()`
  // projects the gender group alone. This is the shape the console must decode
  // or the whole /users/[uid] page darkens.
  const terminal = identityOptionGroups(groups.slice(0, 1));
  assert.deepEqual(terminal?.map((group) => group.key), ["gender"]);

  // DEPLOYED (Core 364c89e8): gender plus the two retired groups, still
  // decoded, still ignored by every surface.
  const parsed = identityOptionGroups(groups.slice(0, 2));
  assert.deepEqual(parsed?.map((group) => group.key), ["gender", "subgender"]);
  assert.deepEqual(parsed?.[1]?.options[0]?.audiences, ["male"]);
  assert.equal(identityOptionGroups(groups)?.length, 3, "a legacy orientation group stays rollout-compatible");

  // Widening did not weaken the group that is actually read: gender is still
  // required, duplicates are still refused, and a malformed row still fails.
  assert.equal(identityOptionGroups([]), null, "a missing gender vocabulary is not a loaded-empty selector");
  assert.equal(identityOptionGroups(groups.slice(1)), null, "the gender vocabulary remains required");
  assert.equal(identityOptionGroups([...groups, groups[0]]), null, "duplicates cannot stand in for a missing group");
  assert.equal(
    identityOptionGroups([{ ...groups[0], options: [{ key: 7, name_en: "Man", name_hu: "Férfi", audiences: [] }] }]),
    null,
    "a malformed option in the one served group is still a refusal",
  );
});

test("the registered-user identity block is a read-only fact and offers no write", async () => {
  // T-669 (D-103 §6.4): `save_user_profile_identity` is terminally 410
  // `feature-retired`, so the editor keeps no identity draft, no gender select
  // and no detailed-gender control at all — canonical gender is edited only in
  // the T-653 audience-visibility panel.
  const identityGroups = identityOptionGroups([
    {
      key: "gender",
      name_en: "Gender",
      name_hu: "Nem",
      options: [{ key: "male", name_en: "Man", name_hu: "Férfi", audiences: [], active: true }],
    },
  ]);
  assert.ok(identityGroups, "the terminal single-group catalogue must decode");
  const data: UserProfileFields = {
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    language: "en",
    segment: { key: "everyone", label: "Everyone" },
    identity: {
      gender: "male",
      orientation: "heterosexual",
      updated_at: 44,
      audience_status: "active",
      channels: ["people"],
      question_packs: ["common"],
    },
    // A pre-D-019 Core still serves the sidecar; it renders the derived-group
    // summary and nothing else.
    identity_editable: true,
    height: null,
    sections: [],
    fields: [],
  };
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const markup = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(UserProfileDataEditor, {
      uid: 123,
      data,
      identityGroups,
      onChange: () => {},
    }),
  ));
  assert.match(markup, />Gender</, "the gender the member holds is still shown");
  assert.match(markup, />Man</, "and rendered through Core's own label");
  assert.doesNotMatch(markup, /Detailed gender/);
  assert.doesNotMatch(markup, /Orientation/);
  assert.equal(markup.match(/<select/g)?.length, undefined, "no identity control at all");

  const source = await readFile(new URL("../components/UserProfileDataEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\borientation\b/);
  assert.doesNotMatch(source, /adminCall\("save_user_profile_identity"/u);
  assert.doesNotMatch(source, /profileIdentityPayload|subgender/u);
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

/**
 * Read the manifest-bound identity fragment from one of the two pinned corpora.
 *
 * `audience_visibility_admin_wire` is the DEPLOYED Core (`364c89e8`) and
 * `audience_visibility_admin_wire_t669` is the published T-669 Core (`cde98f52`;
 * re-pinned by T-771 from the rebased-away lane commit `1d108591`). Both
 * bodies are byte-identical copies of Core's own
 * `tests/fixtures/audience_visibility_wire/owner-profile-fields-identity.json`
 * (generator `tests/audience_visibility_fixture_dump.php`), and both rows plus
 * their sha256 come from the manifest Core published beside them.
 */
async function pinnedIdentityFragment(directory: string): Promise<Record<string, unknown>> {
  const fixtureDirectory = new URL(`./fixtures/${directory}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureDirectory), "utf8"));
  const row = manifest.fixtures.find(
    (entry: Record<string, string>) => entry.file === "owner-profile-fields-identity.json",
  );
  assert.ok(row, `${directory}: the identity fragment must stay listed in the copied Core manifest`);
  assert.equal(row.case, "owner_profile_fields_identity_fragment");
  const bytes = await readFile(new URL(row.file, fixtureDirectory));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    row.sha256,
    `${directory}/owner-profile-fields-identity.json changed after Core publication`,
  );
  return JSON.parse(bytes.toString("utf8")).data.profile_fields.identity;
}

test("the T-669 identity fragment is the terminal two-key block and decodes", async () => {
  const identity = await pinnedIdentityFragment("audience_visibility_admin_wire_t669");
  assert.deepEqual(
    Object.keys(identity),
    ["gender", "updated_at"],
    "the terminal identity contract is closed to exactly these two keys",
  );
  const parsed = userProfileFields({
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    language: "en",
    segment: { key: "male_gay", label: "Gay men" },
    identity,
    layout: { schema_version: 1, revision: 2, sections: [] },
    fields: [],
  });
  // `app/(dashboard)/users/[uid]/page.tsx` treats a null here as a page-level
  // failure, so this single assertion is the whole member console under T-669.
  assert.ok(parsed, "the T-669 Core payload must not darken /users/[uid]");
  assert.equal(parsed.identity.gender, identity.gender);
  assert.equal(parsed.identity.updated_at, identity.updated_at);
  assert.equal(parsed.identity_editable, false);
});

test("the deployed post-D-019 member payload decodes and renders (T-641)", async () => {
  const identity = await pinnedIdentityFragment("audience_visibility_admin_wire");
  assert.deepEqual(
    Object.keys(identity),
    ["gender", "subgender", "subgender_selected", "updated_at"],
    "the deployed identity contract is closed to exactly these four keys",
  );

  // The shape `ProfileAttributeService::payload()` answers today: the four-key
  // identity block, no `fields[].audience` and no `sections[].visibility` (both
  // deleted by `AudienceVisibilityProjectionPolicy::member()`), and no height
  // builtin (retired by T-632).
  const payload = {
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    builtin_revision: 2,
    language: "en",
    segment: { key: "male_gay", label: "Gay men" },
    identity,
    layout: {
      schema_version: 1,
      revision: 2,
      sections: [{
        key: "more_about_you",
        title: "More about you",
        subtitle: "Personality and lifestyle",
        items: [{ kind: "field", key: "pets" }],
      }],
    },
    fields: [{
      key: "pets",
      labels: { en: "Pets", hu: "Háziállatok" },
      descriptions: {},
      label: "Pets",
      description: "",
      selection: { mode: "multi", min_selected: 0, max_selected: 4 },
      icon: { url: "", mime: "" },
      sort_order: 10,
      active: true,
      eligible: true,
      revision: 2,
      system_owned: true,
      source: "builtin",
      options: [{
        field_key: "pets",
        key: "dog",
        option_id: 123,
        id: 123,
        labels: { en: "Dog", hu: "Kutya" },
        label: "Dog",
        sort_order: 10,
        active: true,
        revision: 1,
        system_owned: false,
        source: "custom",
        legacy_ids: [],
        selected: true,
      }],
      values: ["dog"],
    }],
  };
  const parsed = userProfileFields(payload);
  // `app/(dashboard)/users/[uid]/page.tsx` treats a null here as a page-level
  // failure, so this single assertion is the whole member console.
  assert.ok(parsed, "the deployed Core payload must not darken /users/[uid]");
  assert.equal(parsed.identity.gender, identity.gender);
  assert.equal(parsed.identity.updated_at, identity.updated_at);
  // The retired D-019 pair is IGNORED, not modelled and not refused.
  assert.equal("subgender" in parsed.identity, false);
  assert.equal("subgender_selected" in parsed.identity, false);
  // The retired keys decode as empty rather than as a refusal.
  assert.equal(parsed.identity.orientation, "");
  assert.equal(parsed.identity.audience_status, "");
  assert.deepEqual(parsed.identity.channels, []);
  assert.deepEqual(parsed.identity.question_packs, []);
  assert.equal(parsed.height, null);
  // The active projection is exactly the state in which Core answers 410
  // `feature-retired` to `save_user_profile_identity` (T-651), so the editor
  // must not offer that write.
  assert.equal(parsed.identity_editable, false);
  assert.equal(parsed.sections[0]?.visibility, undefined);
  // An absent audience block is an unrestricted field, never a fabricated
  // restriction.
  assert.deepEqual(parsed.fields[0]?.audience, {
    mode: "global",
    segments: [],
    genders: [],
    group_ids: [],
  });

  const identityGroups = identityOptionGroups([
    {
      key: "gender",
      name_en: "Gender",
      name_hu: "Nem",
      options: [{ key: "man", name_en: "Man", name_hu: "Férfi", audiences: [], active: true }],
    },
    {
      key: "subgender",
      name_en: "Detailed gender",
      name_hu: "Részletes nemi identitás",
      options: [{
        key: "trans_man",
        name_en: "Trans man",
        name_hu: "Transz férfi",
        audiences: ["man"],
        active: true,
      }],
    },
  ]);
  assert.ok(identityGroups);
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const markup = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(UserProfileDataEditor, {
      uid: 123,
      data: parsed,
      identityGroups,
      onChange: () => {},
    }),
  ));
  assert.match(markup, />Gender</);
  assert.match(markup, />Pets</);
  // T-651: under the active projection the identity block is a read-only
  // summary — no select, no save button, and the retired channel and
  // question-pack rows are gone rather than rendered as empty markers.
  assert.match(markup, /Identity is read-only here/);
  // The stored values still read, resolved through the whole option list so an
  // archived row or a mismatched audience cannot blank them out.
  assert.match(markup, />Man</);
  // T-669: the detailed gender is retired, so the fact row goes with the
  // control even though this deployed Core still serves a catalogue for it.
  assert.doesNotMatch(markup, />Trans man</);
  assert.doesNotMatch(markup, /Detailed gender/);
  assert.equal(markup.match(/<select/g), null);
  assert.doesNotMatch(markup, /Save gender/);
  assert.doesNotMatch(markup, /Discovery channels/);
  assert.doesNotMatch(markup, /Question packs/);
  // The derived group still reads, because it is what support needs.
  assert.match(markup, /male_gay/);
});

test("widening the member payload leaves every present value validated (T-641)", () => {
  const base = {
    schema_version: 1,
    catalog_version: 1,
    revision: 3,
    language: "en",
    segment: { key: "male_gay", label: "Gay men" },
    identity: {
      gender: "man",
      subgender: "trans_man",
      subgender_selected: true,
      updated_at: 1800000000,
    } as Record<string, unknown>,
    layout: { schema_version: 1, revision: 2, sections: [] },
    fields: [] as Array<Record<string, unknown>>,
  };
  assert.ok(userProfileFields(structuredClone(base)));

  // T-669: the retired D-019 pair is ignored on read, so the terminal block
  // decodes and a malformed leftover no longer darkens the page.
  const terminal = structuredClone(base);
  terminal.identity = { gender: "man", updated_at: 1800000000 };
  assert.ok(userProfileFields(terminal));
  for (const value of ["", 7, null, false]) {
    const stale = structuredClone(base);
    stale.identity = { ...terminal.identity, subgender: value, subgender_selected: value };
    assert.ok(
      userProfileFields(stale),
      `a retired subgender leftover is ignored, not refused: ${JSON.stringify(value)}`,
    );
  }

  // A legacy identity is still decoded exactly as strictly as before: all four
  // retired keys must be present and well-typed together.
  const legacy = structuredClone(base);
  legacy.identity = {
    ...legacy.identity,
    orientation: "gay",
    audience_status: "active",
    channels: ["mlm"],
    question_packs: ["common"],
  };
  assert.ok(userProfileFields(structuredClone(legacy)));
  for (const [key, value] of [
    ["orientation", 5],
    ["channels", "mlm"],
    ["question_packs", [7]],
    ["gender", 1],
  ] as Array<[string, unknown]>) {
    const broken = structuredClone(legacy);
    broken.identity = { ...broken.identity, [key]: value };
    assert.equal(userProfileFields(broken), null, `identity.${key} must stay validated`);
  }
  for (const key of ["orientation", "channels", "question_packs"]) {
    const partial = structuredClone(legacy);
    delete (partial.identity as Record<string, unknown>)[key];
    assert.equal(
      userProfileFields(partial),
      null,
      `a legacy identity missing ${key} is still a refusal, not a new shape`,
    );
  }

  // An absent audience decodes as global; a present one is validated unchanged.
  const row = {
    key: "pets",
    labels: { en: "Pets", hu: "Háziállatok" },
    descriptions: {},
    selection: { mode: "multi", min_selected: 0, max_selected: 4 },
    icon: { url: "", mime: "" },
    sort_order: 10,
    active: true,
    revision: 2,
    system_owned: true,
    source: "builtin",
    options: [],
    values: [],
  };
  const global = structuredClone(base);
  global.fields = [structuredClone(row)];
  assert.ok(userProfileFields(global));
  for (const audience of [
    "global",
    { mode: "everyone", segments: [], genders: [], group_ids: [] },
    { mode: "global", segments: ["male_gay"], genders: [], group_ids: [] },
    { mode: "segments", segments: [], genders: [], group_ids: [] },
    { mode: "segments", segments: [], genders: ["martian"], group_ids: [] },
    { mode: "segments", segments: [], genders: [], group_ids: ["not-an-object-id"] },
  ]) {
    const broken = structuredClone(base);
    broken.fields = [{ ...structuredClone(row), audience }];
    assert.equal(
      userProfileFields(broken),
      null,
      `a served audience block stays validated: ${JSON.stringify(audience)}`,
    );
  }
  // The catalogue console is not projection-filtered and keeps its audience.
  assert.ok(profileFieldCatalog({
    schema_version: 1,
    segments: [],
    cast_groups: [],
    fields: [{ ...structuredClone(row), audience: { mode: "global", segments: [] } }],
  }));
});

/**
 * T-651 (T-640 audit D6/D7).
 *
 * D6: Core retired the `height_cm` builtin with T-632 — it is gone from
 * `ProfileBuiltinFieldCatalog::DEFINITIONS` — so nothing can ever put a
 * `builtin:height_cm` row in a section layout. The console's guard against
 * removing that row, and the "fixed" marker beside it, were unreachable code
 * that also told the operator a lie about what the layout contains.
 *
 * D7: `ProfileFieldCatalog::saveField()` refuses any of the retired keys with
 * `profile-field-key-retired` before it normalizes anything. The console
 * mapped three error codes and fell through to a generic "could not be saved",
 * so an operator typing `body_type` learned nothing.
 */
test("the layout editor drops the dead height guard and names the retired-key refusal", async () => {
  const page = await readFile(
    new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /fixedHeight/);
  assert.doesNotMatch(page, /height_cm/);
  assert.doesNotMatch(page, /layoutHeightFixed/);
  // Every layout row is now removable and reorderable on the same terms.
  assert.match(page, /disabled=\{busy\} onClick=\{\(\) => removeItem\(sectionIndex, itemIndex\)\}/);
  assert.match(page, /if \(code === "profile-field-key-retired"\) return t\("keyRetired"\);/);

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    assert.equal(Object.hasOwn(messages.profileFields, "keyRetired"), true);
    assert.equal(Object.hasOwn(messages.profileFields, "layoutHeightFixed"), false);
    // Zero call sites since the selector never received it (audit D8).
    assert.equal(Object.hasOwn(messages.profileFields, "audienceSegmentsTitle"), false);
    // The page derives member_sex from the gender checkboxes (audit D8).
    assert.equal(Object.hasOwn(messages.icebreakers, "memberSex"), false);
  }
});

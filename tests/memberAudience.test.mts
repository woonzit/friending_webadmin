import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateLegacyAudience,
  representedLegacySegments,
} from "../lib/memberAudience.ts";
import type { UserCastGroup } from "../lib/userCastGroups.ts";

function group(overrides: Partial<UserCastGroup>): UserCastGroup {
  return {
    id: "64f000000000000000000001",
    key: "male_for_male",
    labels: { en: "Men visible to men", hu: "Férfiak, akiket férfiak láthatnak" },
    rules: [{ genders: ["man"], visible_to: ["male"] }],
    legacy_segment: "male_gay",
    sort_order: 100,
    active: true,
    protected: true,
    revision: 1,
    ...overrides,
  };
}

test("legacy audiences migrate only to an equivalent active system group", () => {
  const custom = group({
    id: "64f000000000000000000002",
    key: "custom_projection",
    protected: false,
    sort_order: 1,
  });
  const canonical = group({ id: "64f000000000000000000003" });
  assert.deepEqual(
    migrateLegacyAudience([], ["male_gay"], [custom, canonical]),
    { groupIds: [canonical.id], legacySegments: [] },
  );

  const inactive = group({ id: "64f000000000000000000004", active: false });
  assert.deepEqual(
    migrateLegacyAudience([], ["male_gay"], [custom, inactive]),
    { groupIds: [], legacySegments: ["male_gay"] },
  );
});

test("custom projections do not hide compatibility choices", () => {
  const custom = group({ protected: false });
  assert.equal(representedLegacySegments([custom]).has("male_gay"), false);
  assert.equal(representedLegacySegments([group({})]).has("male_gay"), true);
});

/**
 * T-769: Core spells the non-binary group's compatibility segment `other` on
 * the group row and `identity_unresolved` in the `segments` list published
 * beside it. Compared verbatim, the console would offer the same audience
 * twice — once as the group chip, once as an unrepresented legacy chip — and
 * would never migrate a stored `identity_unresolved` selection.
 */
test("the non-binary group represents the identity_unresolved segment", () => {
  const nonbinary = group({
    id: "64f000000000000000000007",
    key: "nonbinary_for_both",
    labels: { en: "Other or unresolved identity", hu: "Egyéb vagy még nem besorolt identitás" },
    rules: [{ genders: ["nonbinary"], visible_to: ["both"] }],
    legacy_segment: "other",
    sort_order: 700,
  });
  assert.equal(representedLegacySegments([nonbinary]).has("identity_unresolved"), true);
  assert.equal(representedLegacySegments([nonbinary]).has("other"), false);
  assert.deepEqual(
    migrateLegacyAudience([], ["identity_unresolved"], [nonbinary]),
    { groupIds: [nonbinary.id], legacySegments: [] },
  );
});

/**
 * D-096 (T-637) made the cast-group and legacy-segment axes inert in every
 * consumer that reads `UserAudiencePolicy::matches()` — profile fields,
 * icebreaker prompts and footprint badges all narrow by gender alone now. The
 * selections are still stored and echoed back, so the remaining editors keep
 * offering them; what they must not do is tell the operator they restrict
 * anything. T-671 removed the audience editor and its copy from signupOptions.
 */
test("the shared audience selector states that a group selection no longer restricts", async () => {
  const { readFile } = await import("node:fs/promises");
  const selector = await readFile(
    new URL("../components/MemberAudienceSelector.tsx", import.meta.url),
    "utf8",
  );
  // The note is keyed on a group being selected at all, not on both axes:
  // a group-only restriction is exactly the case that now means "everyone".
  assert.match(
    selector,
    /value\.groupIds\.length > 0 \|\| value\.legacySegments\.length > 0 \? \(\s*<p className="footprints-match-logic">\{labels\.groupsNotEnforced\}<\/p>/,
  );
  assert.match(selector, /\{labels\.groups\} <span>\{labels\.groupsRecorded\}<\/span>/);
  assert.doesNotMatch(selector, /matchBoth/);

  const en = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const hu = JSON.parse(
    await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  );
  for (const namespace of ["profileFields", "icebreakers"]) {
    for (const messages of [en, hu]) {
      assert.equal(Object.hasOwn(messages[namespace], "audienceMatchBoth"), false);
      assert.equal(Object.hasOwn(messages[namespace], "audienceGroupsRecorded"), true);
      assert.equal(Object.hasOwn(messages[namespace], "audienceGroupsNotEnforced"), true);
    }
    assert.doesNotMatch(en[namespace].audienceGroupsNotEnforced, /both/i);
    assert.doesNotMatch(hu[namespace].audienceGroupsNotEnforced, /mindkett/i);
  }
  for (const messages of [en, hu]) {
    assert.equal(Object.hasOwn(messages.signupOptions, "audienceGroupsRecorded"), false);
    assert.equal(Object.hasOwn(messages.signupOptions, "audienceGroupsNotEnforced"), false);
  }
  // The footprints console owns its own copy of the editor.
  assert.equal(Object.hasOwn(en.footprints, "matchBothAxes"), false);
  assert.equal(Object.hasOwn(hu.footprints, "matchBothAxes"), false);
  // Orphaned in both locales and factually wrong after T-637 (T-640 audit D8).
  assert.equal(Object.hasOwn(en.footprints, "audienceHint"), false);
  assert.equal(Object.hasOwn(hu.footprints, "audienceHint"), false);
  // Profile tags are the one consumer whose segment axis Core STILL enforces
  // (`ProfileTagCatalogPolicy::audienceAllowsIdentity()`), so its hint stays.
  assert.equal(Object.hasOwn(en.profileTags, "audienceHint"), true);
});

/**
 * The seven segments are `AudienceVisibilityPolicy::SYSTEM_GROUPS` read
 * through `profileSegment($gender, $visible_to)` — gender × who-can-see-me,
 * not an orientation. Only the profile-tag console labels them itself; every
 * other surface renders the labels Core sends.
 */
test("console-owned segment labels name gender and visibility, never an orientation", async () => {
  const { readFile } = await import("node:fs/promises");
  const en = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const hu = JSON.parse(
    await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(en.profileTags.segments, {
    male_hetero: "Men visible to women",
    male_gay: "Men visible to men",
    male_bisexual: "Men visible to everyone",
    female_hetero: "Women visible to men",
    female_lesbian: "Women visible to women",
    female_bisexual: "Women visible to everyone",
    identity_unresolved: "Gender or visibility not set",
  });
  // The segment KEYS keep their orientation-era spelling because Core owns
  // them (`ProfileFieldPolicy::SEGMENTS`); only the operator-visible text is
  // ours to fix, so the census walks values.
  const values = (value: unknown): string[] => (
    value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).flatMap(values)
      : [String(value)]
  );
  for (const messages of [en, hu]) {
    for (const text of values(messages.profileTags)) {
      assert.doesNotMatch(
        text,
        /heterosexual|bisexual|lesbian|gay men|heteroszex|biszex|leszbik|meleg férfi/i,
        text,
      );
    }
  }
  assert.deepEqual(Object.keys(en.profileTags.segments), Object.keys(hu.profileTags.segments));
});

/**
 * T-769, the rendering: with the seven V2 rows Core serves today the audience
 * picker draws seven group chips and drops the `identity_unresolved`
 * compatibility chip, because the non-binary group already represents it.
 * Before the fix `userCastGroup()` refused all seven rows, so `/profile-fields`
 * never reached this component at all.
 */
test("the audience picker draws the seven served groups and no duplicate legacy chip", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const MemberAudienceSelector = (await import("../components/MemberAudienceSelector.tsx")).default;
  const { userCastGroup } = await import("../lib/userCastGroups.ts");

  const envelope = JSON.parse(await readFile(
    new URL("./fixtures/audience_visibility_admin_wire_t669/admin-catalog.json", import.meta.url),
    "utf8",
  ));
  const groups = (envelope.data.groups as unknown[]).map((row) => userCastGroup(row)!);
  assert.equal(groups.filter(Boolean).length, 7);

  const legacyOptions = [
    "male_hetero", "male_gay", "male_bisexual",
    "female_hetero", "female_lesbian", "female_bisexual",
    "identity_unresolved",
  ].map((key) => ({ key, labels: { en: key, hu: key } }));

  const labels = {
    legend: "Audience", help: "help", global: "Everyone", custom: "Custom",
    globalHint: "hint", genders: "Genders", groups: "Groups", matchAny: "any",
    groupsRecorded: "recorded", groupsNotEnforced: "not enforced",
    required: "required", inactive: "inactive", legacy: "legacy",
    gender: { male: "Men", female: "Women", other: "Other" },
  };
  const markup = renderToStaticMarkup(createElement(MemberAudienceSelector, {
    value: { mode: "segments" as const, genders: [], groupIds: [groups[0].id], legacySegments: [] },
    groups,
    legacyOptions,
    locale: "hu",
    labels,
    onChange: () => {},
  }));

  for (const group of groups) {
    assert.ok(markup.includes(group.labels.hu), `${group.key} is drawn`);
  }
  // Six compatibility chips, not seven: the non-binary group represents the
  // seventh (`other` === `identity_unresolved`).
  assert.equal((markup.match(/is-legacy/gu) ?? []).length, 0);
  assert.ok(!markup.includes("identity_unresolved"), "no duplicate legacy chip");
});

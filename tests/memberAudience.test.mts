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
    key: "male_gay",
    labels: { en: "Gay men", hu: "Meleg férfiak" },
    rules: [{ genders: ["male"], orientations: ["gay"] }],
    legacy_segment: "male_gay",
    sort_order: 100,
    active: true,
    system: true,
    revision: 1,
    ...overrides,
  };
}

test("legacy audiences migrate only to an equivalent active system group", () => {
  const custom = group({
    id: "64f000000000000000000002",
    key: "custom_projection",
    system: false,
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
  const custom = group({ system: false });
  assert.equal(representedLegacySegments([custom]).has("male_gay"), false);
  assert.equal(representedLegacySegments([group({})]).has("male_gay"), true);
});

/**
 * D-096 (T-637) made the cast-group and legacy-segment axes inert in every
 * consumer that reads `UserAudiencePolicy::matches()` — signup option groups,
 * profile fields, icebreaker prompts and footprint badges all narrow by gender
 * alone now. The selections are still stored and echoed back, so the console
 * keeps offering them; what it must not do any more is tell the operator they
 * restrict anything.
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
  for (const namespace of ["signupOptions", "profileFields", "icebreakers"]) {
    for (const messages of [en, hu]) {
      assert.equal(Object.hasOwn(messages[namespace], "audienceMatchBoth"), false);
      assert.equal(Object.hasOwn(messages[namespace], "audienceGroupsRecorded"), true);
      assert.equal(Object.hasOwn(messages[namespace], "audienceGroupsNotEnforced"), true);
    }
    assert.doesNotMatch(en[namespace].audienceGroupsNotEnforced, /both/i);
    assert.doesNotMatch(hu[namespace].audienceGroupsNotEnforced, /mindkett/i);
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

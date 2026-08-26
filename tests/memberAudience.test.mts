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

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  castGroupProfileSegment,
  userCastGroup,
  userCastGroupsPayload,
} from "../lib/userCastGroups.ts";
import { audienceVisibilityCatalogResponse } from "../lib/audienceVisibilityAdmin.ts";
import { profileFieldCatalog } from "../lib/profileFields.ts";
import { icebreakerCatalog } from "../lib/icebreakers.ts";
import { footprintsAdminPayload } from "../lib/footprints.ts";

type Json = Record<string, any>;

/**
 * The seven V2 rows exactly as Core serves them. `cast_groups` on
 * `list_profile_fields`, on the icebreaker catalogue, on the footprints admin
 * payload and `groups` on the audience-visibility catalogue are ONE array —
 * every one of them is `UserCastGroupService::visibilityGroups(true)` — so the
 * pinned catalogue corpus is the authoritative `cast_groups` body too.
 */
const CORPUS = new URL(
  "./fixtures/audience_visibility_admin_wire_t669/admin-catalog.json",
  import.meta.url,
);

async function coreRows(): Promise<Json[]> {
  const envelope = JSON.parse(await readFile(CORPUS, "utf8"));
  return envelope.data.groups as Json[];
}

/** `ProfileFieldPolicy::SEGMENTS`, the `segments` list served beside them. */
const PROFILE_SEGMENTS = [
  "male_hetero", "male_gay", "male_bisexual",
  "female_hetero", "female_lesbian", "female_bisexual",
  "identity_unresolved",
].map((key) => ({ key, labels: { en: key, hu: key } }));

/** A custom (non-protected) group: no legacy segment, editable rules. */
const custom = {
  id: "64f000000000000000000001",
  key: "friends_in_budapest",
  labels: { en: "Friends in Budapest", hu: "Budapesti barátok" },
  rules: [
    { genders: ["man", "woman"], visible_to: ["male", "female", "both"] },
    { genders: ["nonbinary"], visible_to: ["both"] },
  ],
  legacy_segment: "",
  sort_order: 20,
  active: true,
  protected: false,
  revision: 4,
};

test("T-769: the seven V2 rows Core serves in cast_groups all decode", async () => {
  const rows = await coreRows();
  assert.equal(rows.length, 7, "the pinned corpus is the seven-row catalogue");
  const parsed = rows.map((row) => userCastGroup(row));
  assert.deepEqual(
    parsed.map((row, index) => (row ? row.key : `REFUSED:${rows[index].key}`)),
    [
      "male_for_male", "male_for_female", "male_for_both",
      "female_for_male", "female_for_female", "female_for_both",
      "nonbinary_for_both",
    ],
  );
  // Every rule is the V2 shape and nothing carries `orientations`.
  for (const row of parsed) {
    for (const rule of row!.rules) {
      assert.ok(rule.genders.length > 0 && rule.visible_to.length > 0);
      assert.equal(Object.hasOwn(rule, "orientations"), false);
    }
    assert.equal(typeof row!.protected, "boolean");
  }
  const nonbinary = parsed.find((row) => row!.key === "nonbinary_for_both")!;
  assert.deepEqual(nonbinary.rules, [{ genders: ["nonbinary"], visible_to: ["both"] }]);
  // The row spells the segment `other`; the catalogues' own `segments` list
  // spells the same segment `identity_unresolved`.
  assert.equal(nonbinary.legacy_segment, "other");
  assert.equal(castGroupProfileSegment("other"), "identity_unresolved");
  assert.equal(castGroupProfileSegment("male_gay"), "male_gay");
  assert.equal(castGroupProfileSegment(""), "");

  assert.ok(userCastGroup(custom), "a custom group decodes too");
});

test("T-769: the payload cross-check bridges `other` to `identity_unresolved`", async () => {
  const groups = await coreRows();
  const payload = userCastGroupsPayload({ groups, segments: PROFILE_SEGMENTS });
  assert.equal(payload?.groups.length, 7);
  assert.deepEqual(
    payload!.groups.map((group) => group.legacy_segment).slice(-1),
    ["other"],
  );

  // A segment no `segments` row names is still a dangling reference.
  const dangling = structuredClone(groups) as Json[];
  dangling[0].legacy_segment = "male_lesbian_unknown";
  assert.equal(userCastGroupsPayload({ groups: dangling, segments: PROFILE_SEGMENTS }), null);

  const duplicate = [...groups, structuredClone(groups[0])];
  assert.equal(userCastGroupsPayload({ groups: duplicate, segments: PROFILE_SEGMENTS }), null);
});

test("T-769: a legacy V1 row is REFUSED, and so is every V1 vocabulary value", async () => {
  const [row] = await coreRows();

  // The V1 shape `{genders[], orientations[]}` Core deleted in T-736. Core
  // itself refuses its whole catalogue (`audience-visibility-stored-invalid`)
  // for a legacy-shaped stored row, so this can no longer reach a console;
  // the console refusing it too keeps one authority, not two.
  const v1 = structuredClone(row) as Json;
  v1.rules = [{ genders: ["male"], orientations: ["gay", "bisexual"] }];
  v1.system = true;
  assert.equal(userCastGroup(v1), null, "V1 rules are refused");

  // Even with a valid V2 axis beside it, the V1 gender vocabulary is refused.
  const v1Genders = structuredClone(row) as Json;
  v1Genders.rules = [{ genders: ["male"], visible_to: ["male"] }];
  assert.equal(userCastGroup(v1Genders), null, "male/female/other are not V2 genders");

  const missingVisibleTo = structuredClone(row) as Json;
  delete missingVisibleTo.rules[0].visible_to;
  assert.equal(userCastGroup(missingVisibleTo), null);

  const unknownVisibleTo = structuredClone(row) as Json;
  unknownVisibleTo.rules[0].visible_to = ["everyone"];
  assert.equal(userCastGroup(unknownVisibleTo), null);

  // D-019: a non-binary identity is only ever visible to everyone.
  const nonbinaryNarrowed = structuredClone(custom) as Json;
  nonbinaryNarrowed.rules[1].visible_to = ["male"];
  assert.equal(userCastGroup(nonbinaryNarrowed), null);

  // Core normalizes both axes into the vocabulary's order on the way out.
  const unordered = structuredClone(custom) as Json;
  unordered.rules[0].visible_to = ["both", "male", "female"];
  assert.equal(userCastGroup(unordered), null);

  const repeated = structuredClone(custom) as Json;
  repeated.rules[0].genders = ["man", "man"];
  assert.equal(userCastGroup(repeated), null);

  const duplicateRules = structuredClone(custom) as Json;
  duplicateRules.rules = [duplicateRules.rules[1], structuredClone(duplicateRules.rules[1])];
  assert.equal(userCastGroup(duplicateRules), null);
});

test("T-769: the remaining structural checks are unchanged", async () => {
  const [row] = await coreRows();
  for (const [field, value] of [
    ["id", "not-an-object-id"],
    ["key", "Not A Key"],
    ["sort_order", -1],
    ["sort_order", 100001],
    ["revision", 0],
    ["active", "true"],
    ["protected", "true"],
  ] as const) {
    const broken = structuredClone(row) as Json;
    broken[field] = value;
    assert.equal(userCastGroup(broken), null, `${field}=${String(value)}`);
  }
  for (const field of ["id", "key", "labels", "rules", "sort_order", "active", "protected", "revision"]) {
    const broken = structuredClone(row) as Json;
    delete broken[field];
    assert.equal(userCastGroup(broken), null, `missing ${field}`);
  }
  const missingTranslation = structuredClone(row) as Json;
  delete missingTranslation.labels.hu;
  assert.equal(userCastGroup(missingTranslation), null);

  const emptyRules = structuredClone(row) as Json;
  emptyRules.rules = [];
  assert.equal(userCastGroup(emptyRules), null);

  const unknownSegment = structuredClone(row) as Json;
  unknownSegment.legacy_segment = "male_pansexual";
  assert.equal(userCastGroup(unknownSegment), null);

  // `editable_fields` is deliberately not pinned here — the profile-field and
  // icebreaker consoles never edit a group, and pinning a key nobody renders
  // is what darkened /profile-fields in the first place.
  const extraEditable = structuredClone(row) as Json;
  extraEditable.editable_fields = ["labels", "sort_order", "future_field"];
  assert.ok(userCastGroup(extraEditable), "an unread sibling key never refuses a row");
});

/**
 * `/audience-visibility` decodes the identical Core rows through its own,
 * stricter parser. If the two ever disagreed about a row Core actually
 * serves, one of the two consoles would be dark — the T-769 defect. This
 * pins them together on the real corpus.
 */
test("T-769: the cast-group decoder agrees with the audience console on the served rows", async () => {
  const envelope = JSON.parse(await readFile(CORPUS, "utf8"));
  const catalog = audienceVisibilityCatalogResponse(envelope);
  assert.ok(catalog, "the audience console decodes the corpus");
  const rows = envelope.data.groups as Json[];
  assert.equal(catalog!.groups.length, rows.length);
  for (const [index, row] of rows.entries()) {
    const mine = userCastGroup(row);
    const theirs = catalog!.groups[index];
    assert.ok(mine, `${row.key} decodes here too`);
    assert.equal(mine!.id, theirs.id);
    assert.equal(mine!.key, theirs.key);
    assert.equal(mine!.legacy_segment, theirs.legacy_segment);
    assert.equal(mine!.protected, theirs.protected);
    assert.equal(mine!.active, theirs.active);
    assert.equal(mine!.sort_order, theirs.sort_order);
    assert.equal(mine!.revision, theirs.revision);
    assert.deepEqual(mine!.rules, theirs.rules);
    assert.deepEqual({ en: mine!.labels.en, hu: mine!.labels.hu }, theirs.labels);
  }
});

/**
 * The defect itself: `list_profile_fields` used to answer `cast_groups: []`
 * and now answers the seven V2 rows, so the whole catalogue stopped decoding
 * and /profile-fields showed "A profiladat-katalógus betöltése nem sikerült".
 */
test("T-769: the full profile-field catalogue with the seven V2 rows decodes", async () => {
  const groups = await coreRows();
  const field = {
    id: "64f0000000000000000000ff",
    key: "pets",
    labels: { en: "Pets", hu: "Háziállatok" },
    descriptions: {},
    selection: { mode: "single", min_selected: 0, max_selected: 1 },
    audience: {
      mode: "segments",
      segments: ["identity_unresolved"],
      genders: ["male"],
      group_ids: [groups[0].id, groups[6].id],
    },
    icon: { url: "", mime: "" },
    sort_order: 10,
    active: true,
    revision: 1,
    system_owned: true,
    source: "builtin",
    options: [{
      id: "64f0000000000000000000fe",
      key: "dog",
      labels: { en: "Dog", hu: "Kutya" },
      sort_order: 10,
      active: true,
      system_owned: true,
      source: "builtin",
    }],
  };
  const catalog = profileFieldCatalog({
    schema_version: 2,
    segments: PROFILE_SEGMENTS,
    cast_groups: groups,
    fields: [field],
  });
  assert.ok(catalog, "the catalogue Core serves today decodes");
  assert.equal(catalog!.cast_groups.length, 7);
  assert.deepEqual(catalog!.fields[0].audience.group_ids, [groups[0].id, groups[6].id]);

  // The regression itself, stated as a refusal that must NOT happen: the
  // catalogue is not rejected merely because a rule has no `orientations`.
  assert.notEqual(catalog, null);

  // Still fail-closed: a field pointing at a group the catalogue omits.
  assert.equal(profileFieldCatalog({
    schema_version: 2,
    segments: PROFILE_SEGMENTS,
    cast_groups: groups.slice(0, 1),
    fields: [field],
  }), null);
});

test("T-769: the icebreaker catalogue with the seven V2 rows decodes", async () => {
  const groups = await coreRows();
  const catalog = icebreakerCatalog({
    schema_version: 1,
    groups: [{ key: "friends", labels: { en: "Friends cards", hu: "Barátság kártyák" } }],
    member_sexes: [
      { key: "male", labels: { en: "Men", hu: "Férfiak" } },
      { key: "female", labels: { en: "Women", hu: "Nők" } },
      { key: "both", labels: { en: "Everyone", hu: "Mindenki" } },
    ],
    segments: PROFILE_SEGMENTS,
    cast_groups: groups,
    prompts: [{
      id: "abc",
      key: "friendship_goals",
      labels: { en: "Friendship goals:", hu: "A jó barátság alapja:" },
      groups: ["friends"],
      member_sex: "both",
      audience: { mode: "segments", segments: [], genders: ["female"], group_ids: [groups[6].id] },
      sort_order: 10,
      active: true,
      revision: 1,
      system_owned: true,
      source: "builtin",
      legacy_ids: [],
    }],
  });
  assert.ok(catalog, "the icebreaker catalogue Core serves today decodes");
  assert.equal(catalog!.cast_groups.length, 7);
  assert.deepEqual(catalog!.prompts[0].audience.group_ids, [groups[6].id]);
});

/**
 * The footprints console reads `cast_groups` through its own tolerant decoder
 * (id, labels, active only). It was never part of the outage; this pins that
 * the V2 rows still go through it.
 */
test("T-769: the footprints admin payload accepts the V2 rows unchanged", async () => {
  const groups = await coreRows();
  const payload = footprintsAdminPayload({
    settings: { daily_limit: 5, message_max_length: 120, revision: 3 },
    badges: [{
      id: "64f0000000000000000000aa",
      labels: { en: "Coffee", hu: "Kávé" },
      image_url: "https://img.friending.co/api/cache/admin/footprints/coffee.png",
      sender_genders: [],
      sender_group_ids: [groups[0].id],
      recipient_genders: [],
      recipient_group_ids: [groups[6].id],
      sort_order: 10,
      active: true,
      archived: false,
      revision: 1,
    }],
    cast_groups: groups,
    open_reports: 0,
  });
  assert.equal(payload?.castGroups.length, 7);
});

/*
 * T-565 retired `/user-groups`, so the page assertions that stood here went
 * with it. The DECODER stays: profile fields, icebreakers and the footprints
 * console all embed this vocabulary in their own catalogue payloads.
 */

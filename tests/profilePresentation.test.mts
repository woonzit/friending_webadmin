import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  catalogImpact,
  isTagModerationLocked,
  movePresentationSource,
  moveTagGroup,
  moveTagItem,
  parsePresentationAdminPayload,
  parsePresentationRefusal,
  parseProfilePhotoInsights,
  parseProfileTagCatalogPayload,
  parseProfileTagPreview,
  parseTagCatalogSaveResult,
  serializePresentationLayout,
  serializeTagCatalog,
} from "../lib/profilePresentation.ts";
import { ADMIN_ACTIONS } from "../lib/adminActions.ts";

const emptyIcon = { url: "", mime: "" };
const globalAudience = { genders: [], segments: [] };

function presentationPayload() {
  return {
    schema_version: 1,
    layout: {
      schema_version: 1,
      key: "public_profile_v1",
      revision: 7,
      highlight_cloud: [{ kind: "field", key: "smoking" }],
      more_about_me: [{ kind: "builtin", key: "height_cm" }],
    },
    sources: {
      fields: [{
        kind: "field",
        key: "smoking",
        labels: { en: "Smoking", hu: "Dohányzás" },
        icon: emptyIcon,
        sample_values: { en: "Never", hu: "Soha" },
        active: true,
        audience: { mode: "global", segments: [] },
      }],
      builtins: [
        {
          source_key: "height_cm",
          labels: { en: "Height", hu: "Magasság" },
          icon: emptyIcon,
          layout_allowed: true,
          dedicated_section: "",
          revision: 2,
        },
        {
          source_key: "current_location",
          labels: { en: "Current location", hu: "Jelenlegi hely" },
          icon: emptyIcon,
          layout_allowed: false,
          dedicated_section: "location",
          revision: 1,
        },
      ],
    },
    reserved: { fields: [], builtins: ["current_location"] },
    section_order: ["hero_photos", "highlight_cloud", "biography"],
    accent_roles: ["male", "female", "neutral"],
  };
}

function tagCatalog(key: "what_im_into" | "my_story" | "interests") {
  return {
    schema_version: 1,
    key,
    labels: { en: key, hu: `${key}-hu` },
    subtitles: { en: "Subtitle", hu: "Alcím" },
    minimum_selected: 0,
    maximum_selected: key === "my_story" ? 4 : 10,
    active: true,
    revision: 3,
    legacy_field: key === "what_im_into" ? "into" : key === "my_story" ? "mylife" : "interests",
    groups: [{
      schema_version: 1,
      catalog_key: key,
      key: "general",
      labels: { en: "General", hu: "Általános" },
      sort_order: 10,
      active: true,
      audience: globalAudience,
      revision: 2,
      items: [{
        schema_version: 1,
        catalog_key: key,
        group_key: "general",
        key: key === "interests" ? "lgbtq+rights" : "coffee",
        labels: { en: "Coffee", hu: "Kávé" },
        sort_order: 10,
        active: true,
        audience: { genders: ["female"], segments: ["female_lesbian"] },
        icon: { url: "https://img.friending.co/api/cache/admin/profile-icons/coffee.svg", mime: "image/svg+xml" },
        emoji: "☕",
        revision: 4,
        selected_member_count: 12,
      }],
    }],
  };
}

function tagPayload() {
  return {
    schema_version: 1,
    catalogs: [tagCatalog("what_im_into"), tagCatalog("my_story"), tagCatalog("interests")],
  };
}

test("Profile Presentation inventory parser rejects duplicates and unmanaged icons", () => {
  const parsed = parsePresentationAdminPayload(presentationPayload());
  assert.equal(parsed?.layout.revision, 7);
  assert.equal(parsed?.sources.builtins[1]?.layout_allowed, false);

  const duplicate = structuredClone(presentationPayload());
  duplicate.layout.more_about_me = [{ kind: "field", key: "smoking" }];
  assert.equal(parsePresentationAdminPayload(duplicate), null);

  const unmanaged = structuredClone(presentationPayload());
  unmanaged.sources.builtins[0].icon = { url: "https://example.com/icon.svg", mime: "image/svg+xml" };
  assert.equal(parsePresentationAdminPayload(unmanaged), null);
});

test("T-663: the inventory reads the dropped-sources note and both dedicated markers", () => {
  // Absent is empty and a field with no flags is placeable, so a console built
  // against a Core that predates T-663 still opens.
  const legacy = parsePresentationAdminPayload(presentationPayload())!;
  assert.deepEqual(legacy.layout.dropped_sources, []);
  assert.equal(legacy.sources.fields[0]?.layout_allowed, true);
  assert.equal(legacy.sources.fields[0]?.dedicated_section, "");

  const healed = structuredClone(presentationPayload()) as Record<string, any>;
  healed.layout.dropped_sources = [{
    placement: "highlight_cloud",
    kind: "builtin",
    key: "looking_for",
    reason: "profile-presentation-source-not-found",
  }];
  healed.sources.fields[0].layout_allowed = false;
  healed.sources.fields[0].dedicated_section = "languages";
  const parsed = parsePresentationAdminPayload(healed)!;
  assert.equal(parsed.layout.dropped_sources.length, 1);
  assert.equal(parsed.layout.dropped_sources[0]?.key, "looking_for");
  assert.equal(parsed.layout.dropped_sources[0]?.reason, "profile-presentation-source-not-found");
  assert.equal(parsed.sources.fields[0]?.layout_allowed, false);
  assert.equal(parsed.sources.fields[0]?.dedicated_section, "languages");

  // A malformed note is refused rather than shown as an empty reassurance.
  const bad = structuredClone(healed) as Record<string, any>;
  bad.layout.dropped_sources = [{ placement: "nowhere", kind: "builtin", key: "x", reason: "y" }];
  assert.equal(parsePresentationAdminPayload(bad), null);
});

test("T-663: a refused save is read as one reason per item", () => {
  assert.deepEqual(
    parsePresentationRefusal({
      success: false,
      status_code: 422,
      error: "profile-presentation-layout-refused",
      details: {
        items: [
          {
            placement: "highlight_cloud",
            kind: "builtin",
            key: "hometown",
            reason: "profile-presentation-source-reserved",
          },
          {
            placement: "more_about_me",
            kind: "field",
            key: "smoking",
            reason: "profile-presentation-source-duplicate",
          },
        ],
      },
    }),
    [
      {
        placement: "highlight_cloud",
        kind: "builtin",
        key: "hometown",
        reason: "profile-presentation-source-reserved",
      },
      {
        placement: "more_about_me",
        kind: "field",
        key: "smoking",
        reason: "profile-presentation-source-duplicate",
      },
    ],
  );
  // Every other refusal keeps the generic banner: no details, no list.
  assert.deepEqual(parsePresentationRefusal({ success: false, error: "profile-presentation-conflict" }), []);
  assert.deepEqual(parsePresentationRefusal(null), []);
  assert.deepEqual(parsePresentationRefusal({ details: { items: [{ key: "x" }] } }), []);
});

test("layout drag operation is duplicate-safe and serializes one complete optimistic draft", () => {
  const parsed = parsePresentationAdminPayload(presentationPayload())!;
  const moved = movePresentationSource(parsed.layout, { kind: "field", key: "smoking" }, "more_about_me", 0);
  assert.deepEqual(moved.highlight_cloud, []);
  assert.deepEqual(moved.more_about_me.map((row) => `${row.kind}:${row.key}`), ["field:smoking", "builtin:height_cm"]);
  const serialized = serializePresentationLayout(moved);
  assert.equal(serialized.expected_revision, 7);
  assert.equal(serialized.layout.more_about_me.length, 2);
});

test("tag catalog parser enforces closed audience values and legacy punctuation", () => {
  const parsed = parseProfileTagCatalogPayload(tagPayload());
  assert.equal(parsed?.catalogs[2]?.groups[0]?.items[0]?.key, "lgbtq+rights");
  assert.deepEqual(parsed?.catalogs[0]?.groups[0]?.items[0]?.audience, {
    genders: ["female"],
    segments: ["female_lesbian"],
  });

  const invalid = structuredClone(tagPayload());
  invalid.catalogs[0].groups[0].items[0].audience.segments = ["client_supplied_cast"];
  assert.equal(parseProfileTagCatalogPayload(invalid), null);
});

test("group and item drag serialization owns ordering, one parent, archives, audience and icon removal", () => {
  const parsed = parseProfileTagCatalogPayload(tagPayload())!;
  const source = structuredClone(parsed.catalogs[0]);
  source.groups.push({
    key: "second",
    labels: { en: "Second", hu: "Második" },
    sort_order: 20,
    active: true,
    audience: globalAudience,
    revision: 1,
    items: [],
  });
  const movedGroup = moveTagGroup(source, 1, 0);
  assert.deepEqual(movedGroup.groups.map((group) => [group.key, group.sort_order]), [["second", 10], ["general", 20]]);
  const movedItem = moveTagItem(movedGroup, "general", "coffee", "second", 0);
  movedItem.groups[0].items[0].active = false;
  movedItem.groups[0].items[0].audience = { genders: ["female"], segments: ["female_bisexual"] };
  movedItem.groups[0].items[0].icon = emptyIcon;
  const serialized = serializeTagCatalog(movedItem) as { groups: Array<{ key: string; items: Array<Record<string, unknown>> }> };
  assert.equal(serialized.groups[0].key, "second");
  assert.equal(serialized.groups[0].items[0].active, false);
  assert.deepEqual(serialized.groups[0].items[0].audience, { genders: ["female"], segments: ["female_bisexual"] });
  assert.deepEqual(serialized.groups[0].items[0].icon, emptyIcon);
  assert.equal(serialized.groups[1].items.length, 0);
});

test("T-683 / T-686 B-5: the whole-catalogue save carries each item's moderation state", () => {
  // The console POSTs the ENTIRE catalogue on every save. Before this field
  // travelled, an ordinary drag-and-drop reorder restated every banned row as
  // unmoderated, and Core's `saveChildren` would have taken the draft's word
  // for it — a permanent ban erased by a reorder nobody meant as a decision.
  const moderated = structuredClone(tagPayload()) as Record<string, any>;
  const items = moderated.catalogs[0].groups[0].items;
  items[0].moderation_state = "approved";
  items.push({
    ...structuredClone(items[0]),
    key: "smoking",
    labels: { en: "Smoking", hu: "Dohányzás" },
    sort_order: 20,
    active: false,
    moderation_state: "rejected",
  });
  items.push({
    ...structuredClone(items[0]),
    key: "michaeljackson",
    labels: { en: "Michael Jackson", hu: "Michael Jackson" },
    sort_order: 30,
    active: false,
    moderation_state: "merged",
  });
  const parsed = parseProfileTagCatalogPayload(moderated);
  assert.ok(parsed);
  assert.deepEqual(
    parsed.catalogs[0].groups[0].items.map((item) => item.moderation_state),
    ["approved", "rejected", "merged"],
  );

  const serialized = serializeTagCatalog(parsed.catalogs[0]) as {
    groups: Array<{ items: Array<Record<string, unknown>> }>;
  };
  assert.deepEqual(
    serialized.groups[0].items.map((item) => item.moderation_state),
    ["approved", "rejected", "merged"],
  );

  // A row whose read stated nothing sends NOTHING: absent means "keep what is
  // stored", which is not the same as approved. Sending "approved" for an
  // unstated row would be the console deciding on Core's behalf.
  const unstated = parseProfileTagCatalogPayload(tagPayload())!;
  assert.equal(unstated.catalogs[0].groups[0].items[0].moderation_state, null);
  const unstatedWire = serializeTagCatalog(unstated.catalogs[0]) as {
    groups: Array<{ items: Array<Record<string, unknown>> }>;
  };
  assert.equal(Object.hasOwn(unstatedWire.groups[0].items[0], "moderation_state"), false);
});

test("T-683: an item read as active while not approved fails closed", () => {
  // `active === true` implies `approved` (D-107 R2), and Core enforces it on
  // its own read too. A row that reaches the console violating it is a
  // half-applied migration or a direct database edit, and rendering it as an
  // ordinary active tag would invite a save Core then refuses.
  const contradictory = structuredClone(tagPayload()) as Record<string, any>;
  contradictory.catalogs[0].groups[0].items[0].moderation_state = "rejected";
  contradictory.catalogs[0].groups[0].items[0].active = true;
  assert.equal(parseProfileTagCatalogPayload(contradictory), null);

  const invented = structuredClone(tagPayload()) as Record<string, any>;
  invented.catalogs[0].groups[0].items[0].moderation_state = "banned";
  assert.equal(parseProfileTagCatalogPayload(invented), null);

  assert.equal(isTagModerationLocked("rejected"), true);
  assert.equal(isTagModerationLocked("merged"), true);
  assert.equal(isTagModerationLocked("pending"), false);
  assert.equal(isTagModerationLocked("approved"), false);
  assert.equal(isTagModerationLocked(null), false);
});

test("catalog impact and Core archival warnings preserve selected-member consequences", () => {
  const parsed = parseProfileTagCatalogPayload(tagPayload())!;
  const original = parsed.catalogs[0];
  const draft = structuredClone(original);
  draft.groups[0].items[0].active = false;
  draft.maximum_selected = 5;
  assert.deepEqual(catalogImpact(original, draft), { selectedReferences: 12, limitLowered: true });

  const saved = parseTagCatalogSaveResult({
    catalog: draft,
    warnings: [
      { type: "item-grandfathered", key: "coffee", selected_member_count: 12 },
      { type: "selection-limit-grandfathered", key: "what_im_into", selected_member_count: 3 },
    ],
  });
  assert.equal(saved?.warnings.length, 2);
  assert.equal(saved?.warnings[0]?.selected_member_count, 12);
});

test("audience preview parser rejects an invented client segment", () => {
  const preview = {
    schema_version: 1,
    catalog_key: "what_im_into",
    catalog_revision: 3,
    language: "hu",
    gender: "female",
    segment: "female_lesbian",
    title: "Ami érdekel",
    subtitle: "Kedvencek",
    minimum_selected: 0,
    maximum_selected: 10,
    groups: [{ key: "general", label: "Általános", items: [{ key: "coffee", label: "Kávé", icon: emptyIcon, emoji: "☕" }] }],
  };
  assert.equal(parseProfileTagPreview(preview)?.groups[0]?.items[0]?.label, "Kávé");
  assert.equal(parseProfileTagPreview({ ...preview, segment: "browser_cast" }), null);
});

test("photo insight parser proves aggregate consistency without liker identities", () => {
  const data = {
    uid: 686409,
    display_name: "Demo",
    insights: {
      total_likes: 3,
      liked_photo_count: 1,
      top_photo_id: "64e779a8d640000000000002",
      photos: [
        { image_id: "64e779a8d640000000000002", likes_count: 3, rank: 1, order: 1, status: "active" },
        { image_id: "64e779a8d640000000000003", likes_count: 0, rank: null, order: 2, status: "pending" },
      ],
    },
  };
  assert.equal(parseProfilePhotoInsights(data)?.photos[1]?.rank, null);
  const inconsistent = structuredClone(data);
  inconsistent.insights.total_likes = 99;
  assert.equal(parseProfilePhotoInsights(inconsistent), null);
});

test("Webadmin pages keep conflicts local, expose managed icons, warnings and album ranks through explicit actions", async () => {
  for (const action of [
    "profile_presentation",
    "save_profile_presentation",
    "save_profile_presentation_source",
    "profile_tag_catalogs",
    "profile_tag_catalog_preview",
    "save_profile_tag_catalog",
    "profile_photo_insights",
  ]) assert.ok(ADMIN_ACTIONS.includes(action as never));

  const layoutPage = await readFile(new URL("../app/(dashboard)/profile-presentation/page.tsx", import.meta.url), "utf8");
  // T-730 lifted the built-in source editor out of the page so its markup can be
  // asserted directly; the managed-upload guarantee moved with it and is checked
  // on both halves rather than dropped.
  const sourceDialog = await readFile(new URL("../components/PresentationSourceDialog.tsx", import.meta.url), "utf8");
  const tagPage = await readFile(new URL("../app/(dashboard)/profile-tags/page.tsx", import.meta.url), "utf8");
  const albumPanel = await readFile(new URL("../components/UserAlbumsPanel.tsx", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(layoutPage, /profile-presentation-conflict/);
  assert.match(layoutPage, /PresentationSourceDialog/);
  assert.match(sourceDialog, /ProfileIconUploadField/);
  assert.match(layoutPage, /setError\(response\?\.error/);
  assert.match(tagPage, /profile-tag-catalog-conflict/);
  assert.match(tagPage, /window\.confirm/);
  assert.match(tagPage, /item-grandfathered|warnings/);
  assert.match(tagPage, /onDragStart/);
  assert.match(albumPanel, /profile_photo_insights/);
  assert.match(albumPanel, /top_photo_id/);
  assert.match(albumPanel, /insight\.rank/);
  // The 1.1 MB allowance moved out of the route and into the per-action policy module alongside the
  // timeout table, so the bridge now reads it rather than spelling it out. The guarantee it pinned —
  // that the allowance is scoped to this one action and nothing else — is asserted exhaustively
  // across every allow-listed action in `tests/adminActionLimits.test.mts`.
  assert.match(bridge, /adminActionBodyLimit\(action\)/);
  const actions = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  assert.match(actions, /save_profile_tag_catalog:\s*TAG_CATALOG_BODY_LIMIT_BYTES/);
});

test("the profile presentation preview hero glow follows its selected accent only", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\.presentation-phone-preview\s*\{[^}]*--presentation-preview-hero-glow:\s*rgba\(0, 189, 255, 0\.4\)/s,
    "the default preview keeps D-058's #00bdff glow",
  );
  assert.match(
    css,
    /\.presentation-phone-preview\.accent-female\s*\{[^}]*--presentation-preview-hero-glow:\s*rgba\(242, 59, 141, 0\.4\)/s,
    "the female app-preview variant alone restores its pink glow",
  );
  assert.match(
    css,
    /\.presentation-phone-preview\.accent-neutral\s*\{[^}]*--presentation-preview-hero-glow:\s*rgba\(194, 201, 210, 0\.4\)/s,
    "the neutral app-preview variant uses its neutral accent",
  );
  assert.match(
    css,
    /\.presentation-preview-hero\s*\{[^}]*radial-gradient\([^;]*var\(--presentation-preview-hero-glow\)/s,
    "the hero consumes the scoped accent instead of a global colour literal",
  );
  assert.equal(
    css.match(/rgba\(242, 59, 141,/g)?.length,
    2,
    "the magenta family appears only in the female hero and female chips",
  );
});

test("Hungarian Profile tag catalog navigation uses localized titles", async () => {
  const messages = JSON.parse(
    await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ) as {
    profileTags: {
      subtitle: string;
      catalogs: Record<string, string>;
    };
  };
  assert.deepEqual(messages.profileTags.catalogs, {
    what_im_into: "Ami érdekel",
    my_story: "Az én történetem",
    interests: "Érdeklődési köreim",
  });
  assert.doesNotMatch(messages.profileTags.subtitle, /What I'm Into|My Story|Interests/);
});

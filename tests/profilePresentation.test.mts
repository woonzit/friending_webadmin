import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  catalogImpact,
  movePresentationSource,
  moveTagGroup,
  moveTagItem,
  parsePresentationAdminPayload,
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
        icon: { url: "https://pic.freelove.hu/api/cache/admin/profile-icons/coffee.svg", mime: "image/svg+xml" },
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
  const tagPage = await readFile(new URL("../app/(dashboard)/profile-tags/page.tsx", import.meta.url), "utf8");
  const albumPanel = await readFile(new URL("../components/UserAlbumsPanel.tsx", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(layoutPage, /profile-presentation-conflict/);
  assert.match(layoutPage, /ProfileIconUploadField/);
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

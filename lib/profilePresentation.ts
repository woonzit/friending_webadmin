export type LocalizedText = Record<string, string>;

export type ManagedIcon = {
  url: string;
  mime: "" | "image/png" | "image/svg+xml";
};

export type PresentationSourceRef = {
  kind: "field" | "builtin";
  key: string;
};

export type PresentationFieldSource = PresentationSourceRef & {
  kind: "field";
  labels: LocalizedText;
  icon: ManagedIcon;
  sample_values: LocalizedText;
  active: boolean;
  audience: { mode: string; segments: string[] };
};

export type PresentationBuiltinSource = PresentationSourceRef & {
  kind: "builtin";
  labels: LocalizedText;
  icon: ManagedIcon;
  layout_allowed: boolean;
  dedicated_section: string;
  revision: number;
};

export type PresentationSource = PresentationFieldSource | PresentationBuiltinSource;

export type PresentationLayout = {
  schema_version: 1;
  key: "public_profile_v1";
  revision: number;
  highlight_cloud: PresentationSourceRef[];
  more_about_me: PresentationSourceRef[];
};

export type PresentationAdminPayload = {
  schema_version: 1;
  layout: PresentationLayout;
  sources: {
    fields: PresentationFieldSource[];
    builtins: PresentationBuiltinSource[];
  };
  reserved: { fields: string[]; builtins: string[] };
  section_order: string[];
  accent_roles: Array<"male" | "female" | "neutral">;
};

export type TagAudience = {
  genders: Array<"male" | "female" | "other">;
  segments: string[];
};

export type ProfileTagItem = {
  key: string;
  labels: LocalizedText;
  sort_order: number;
  active: boolean;
  audience: TagAudience;
  icon: ManagedIcon;
  emoji: string;
  revision: number;
  selected_member_count: number;
};

export type ProfileTagGroup = {
  key: string;
  labels: LocalizedText;
  sort_order: number;
  active: boolean;
  audience: TagAudience;
  revision: number;
  items: ProfileTagItem[];
};

export type ProfileTagCatalog = {
  key: "what_im_into" | "my_story" | "interests";
  labels: LocalizedText;
  subtitles: LocalizedText;
  minimum_selected: number;
  maximum_selected: number;
  active: boolean;
  revision: number;
  legacy_field: string;
  groups: ProfileTagGroup[];
};

export type ProfileTagCatalogPayload = {
  schema_version: 1;
  catalogs: ProfileTagCatalog[];
};

export type ProfileTagPreview = {
  schema_version: 1;
  catalog_key: ProfileTagCatalog["key"];
  catalog_revision: number;
  language: string;
  gender: TagAudience["genders"][number];
  segment: string;
  title: string;
  subtitle: string;
  minimum_selected: number;
  maximum_selected: number;
  groups: Array<{
    key: string;
    label: string;
    items: Array<{ key: string; label: string; icon: ManagedIcon; emoji: string }>;
  }>;
};

export type ProfileTagWarning = {
  type: "item-grandfathered" | "group-grandfathered" | "selection-limit-grandfathered";
  key: string;
  selected_member_count: number;
};

export type ProfilePhotoInsightRow = {
  image_id: string;
  likes_count: number;
  rank: number | null;
  order: number;
  status: string;
};

export type ProfilePhotoInsights = {
  uid: number;
  display_name: string;
  total_likes: number;
  liked_photo_count: number;
  top_photo_id: string | null;
  photos: ProfilePhotoInsightRow[];
};

const CATALOG_KEYS = ["what_im_into", "my_story", "interests"] as const;
export const TAG_GENDERS = ["male", "female", "other"] as const;
export const TAG_SEGMENTS = [
  "male_hetero",
  "male_gay",
  "male_bisexual",
  "female_hetero",
  "female_lesbian",
  "female_bisexual",
  "identity_unresolved",
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function stringList(value: unknown, maximum = 1_000): string[] | null {
  if (!Array.isArray(value) || value.length > maximum || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return [...value];
}

function closedStringList<const T extends readonly string[]>(value: unknown, allowed: T): Array<T[number]> | null {
  const values = stringList(value, allowed.length);
  if (!values || new Set(values).size !== values.length || values.some((item) => !allowed.includes(item))) {
    return null;
  }
  return values as Array<T[number]>;
}

function localized(value: unknown, required = true): LocalizedText | null {
  if (Array.isArray(value) && value.length === 0 && !required) return {};
  const source = record(value);
  if (!source) return null;
  const result: LocalizedText = {};
  for (const [language, text] of Object.entries(source)) {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language) || typeof text !== "string") return null;
    result[language] = text;
  }
  if (required && (!result.en?.trim() || !result.hu?.trim())) return null;
  return result;
}

function stableKey(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : null;
}

function tagItemKey(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_+\-]{0,63}$/.test(value) ? value : null;
}

function icon(value: unknown): ManagedIcon | null {
  const source = record(value);
  if (!source || typeof source.url !== "string" || typeof source.mime !== "string") return null;
  const url = source.url.trim();
  const mime = source.mime.toLowerCase();
  if (url === "") return mime === "" ? { url: "", mime: "" } : null;
  if (!(["image/png", "image/svg+xml"] as string[]).includes(mime)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "pic.freelove.hu") return null;
  } catch {
    return null;
  }
  return { url, mime: mime as ManagedIcon["mime"] };
}

export function normalizeManagedIcon(value: { url: string; mime: string }): ManagedIcon | null {
  return icon(value);
}

function sourceRef(value: unknown): PresentationSourceRef | null {
  const source = record(value);
  const key = stableKey(source?.key);
  if (!source || !key || (source.kind !== "field" && source.kind !== "builtin")) return null;
  return { kind: source.kind, key };
}

function layout(value: unknown): PresentationLayout | null {
  const source = record(value);
  const revision = integer(source?.revision);
  if (!source || source.schema_version !== 1 || source.key !== "public_profile_v1" || revision === null) return null;
  const seen = new Set<string>();
  const readPlacement = (raw: unknown): PresentationSourceRef[] | null => {
    if (!Array.isArray(raw) || raw.length > 200) return null;
    const rows: PresentationSourceRef[] = [];
    for (const value of raw) {
      const row = sourceRef(value);
      if (!row) return null;
      const identity = sourceIdentity(row);
      if (seen.has(identity)) return null;
      seen.add(identity);
      rows.push(row);
    }
    return rows;
  };
  const highlights = readPlacement(source.highlight_cloud);
  const more = readPlacement(source.more_about_me);
  if (!highlights || !more) return null;
  return {
    schema_version: 1,
    key: "public_profile_v1",
    revision,
    highlight_cloud: highlights,
    more_about_me: more,
  };
}

function fieldSource(value: unknown): PresentationFieldSource | null {
  const source = record(value);
  const key = stableKey(source?.key);
  const labels = localized(source?.labels);
  const managedIcon = icon(source?.icon);
  const samples = localized(source?.sample_values ?? {}, false);
  const audience = record(source?.audience);
  const segments = stringList(audience?.segments ?? [], 20);
  if (
    !source || source.kind !== "field" || !key || !labels || !managedIcon || !samples
    || typeof source.active !== "boolean" || !audience || typeof audience.mode !== "string" || !segments
  ) return null;
  return {
    kind: "field",
    key,
    labels,
    icon: managedIcon,
    sample_values: samples,
    active: source.active,
    audience: { mode: audience.mode, segments },
  };
}

function builtinSource(value: unknown): PresentationBuiltinSource | null {
  const source = record(value);
  const key = stableKey(source?.source_key ?? source?.key);
  const labels = localized(source?.labels);
  const managedIcon = icon(source?.icon);
  const revision = integer(source?.revision);
  if (
    !source || !key || !labels || !managedIcon || revision === null
    || typeof source.layout_allowed !== "boolean" || typeof source.dedicated_section !== "string"
  ) return null;
  return {
    kind: "builtin",
    key,
    labels,
    icon: managedIcon,
    layout_allowed: source.layout_allowed,
    dedicated_section: source.dedicated_section,
    revision,
  };
}

export function parsePresentationAdminPayload(value: unknown): PresentationAdminPayload | null {
  const source = record(value);
  const parsedLayout = layout(source?.layout);
  const rawSources = record(source?.sources);
  const reserved = record(source?.reserved);
  const reservedFields = stringList(reserved?.fields, 200);
  const reservedBuiltins = stringList(reserved?.builtins, 200);
  const sectionOrder = stringList(source?.section_order, 20);
  const accentRoles = closedStringList(source?.accent_roles, ["male", "female", "neutral"] as const);
  if (
    !source || source.schema_version !== 1 || !parsedLayout || !rawSources
    || !Array.isArray(rawSources.fields) || !Array.isArray(rawSources.builtins)
    || !reservedFields || !reservedBuiltins || !sectionOrder || !accentRoles
  ) return null;
  const fields = rawSources.fields.map(fieldSource);
  const builtins = rawSources.builtins.map(builtinSource);
  if (fields.some((row) => !row) || builtins.some((row) => !row)) return null;
  const sources = [...fields, ...builtins] as PresentationSource[];
  const sourceIds = new Set(sources.map(sourceIdentity));
  if (sourceIds.size !== sources.length) return null;
  if ([...parsedLayout.highlight_cloud, ...parsedLayout.more_about_me].some((row) => !sourceIds.has(sourceIdentity(row)))) {
    return null;
  }
  return {
    schema_version: 1,
    layout: parsedLayout,
    sources: {
      fields: fields as PresentationFieldSource[],
      builtins: builtins as PresentationBuiltinSource[],
    },
    reserved: { fields: reservedFields, builtins: reservedBuiltins },
    section_order: sectionOrder,
    accent_roles: accentRoles,
  };
}

function audience(value: unknown): TagAudience | null {
  const source = record(value);
  const genders = closedStringList(source?.genders ?? [], TAG_GENDERS);
  const segments = closedStringList(source?.segments ?? [], TAG_SEGMENTS);
  return source && genders && segments ? { genders, segments } : null;
}

function tagItem(value: unknown): ProfileTagItem | null {
  const source = record(value);
  const key = tagItemKey(source?.key);
  const labels = localized(source?.labels);
  const order = integer(source?.sort_order, 0, 1_000_000);
  const parsedAudience = audience(source?.audience);
  const managedIcon = icon(source?.icon);
  const revision = integer(source?.revision);
  const selectedCount = integer(source?.selected_member_count);
  if (
    !source || !key || !labels || order === null || typeof source.active !== "boolean"
    || !parsedAudience || !managedIcon || typeof source.emoji !== "string"
    || revision === null || selectedCount === null
  ) return null;
  return {
    key,
    labels,
    sort_order: order,
    active: source.active,
    audience: parsedAudience,
    icon: managedIcon,
    emoji: source.emoji,
    revision,
    selected_member_count: selectedCount,
  };
}

function tagGroup(value: unknown): ProfileTagGroup | null {
  const source = record(value);
  const key = stableKey(source?.key);
  const labels = localized(source?.labels);
  const order = integer(source?.sort_order, 0, 100_000);
  const parsedAudience = audience(source?.audience);
  const revision = integer(source?.revision);
  if (
    !source || !key || !labels || order === null || typeof source.active !== "boolean"
    || !parsedAudience || revision === null || !Array.isArray(source.items) || source.items.length > 1_000
  ) return null;
  const items = source.items.map(tagItem);
  if (items.some((row) => !row)) return null;
  return { key, labels, sort_order: order, active: source.active, audience: parsedAudience, revision, items: items as ProfileTagItem[] };
}

function tagCatalog(value: unknown): ProfileTagCatalog | null {
  const source = record(value);
  const labels = localized(source?.labels);
  const subtitles = localized(source?.subtitles ?? {}, false);
  const minimum = integer(source?.minimum_selected, 0, 20);
  const maximum = integer(source?.maximum_selected, 1, 20);
  const revision = integer(source?.revision);
  if (
    !source || !CATALOG_KEYS.includes(source.key as typeof CATALOG_KEYS[number]) || !labels || !subtitles
    || minimum === null || maximum === null || minimum > maximum || typeof source.active !== "boolean"
    || revision === null || typeof source.legacy_field !== "string" || !Array.isArray(source.groups)
    || source.groups.length > 60
  ) return null;
  const groups = source.groups.map(tagGroup);
  if (groups.some((row) => !row)) return null;
  const groupKeys = new Set<string>();
  const itemKeys = new Set<string>();
  for (const group of groups as ProfileTagGroup[]) {
    if (groupKeys.has(group.key)) return null;
    groupKeys.add(group.key);
    for (const item of group.items) {
      if (itemKeys.has(item.key)) return null;
      itemKeys.add(item.key);
    }
  }
  return {
    key: source.key as ProfileTagCatalog["key"],
    labels,
    subtitles,
    minimum_selected: minimum,
    maximum_selected: maximum,
    active: source.active,
    revision,
    legacy_field: source.legacy_field,
    groups: groups as ProfileTagGroup[],
  };
}

export function parseProfileTagCatalogPayload(value: unknown): ProfileTagCatalogPayload | null {
  const source = record(value);
  if (!source || source.schema_version !== 1 || !Array.isArray(source.catalogs) || source.catalogs.length !== 3) return null;
  const catalogs = source.catalogs.map(tagCatalog);
  if (catalogs.some((row) => !row)) return null;
  const keyed = new Map((catalogs as ProfileTagCatalog[]).map((catalog) => [catalog.key, catalog]));
  if (keyed.size !== 3 || CATALOG_KEYS.some((key) => !keyed.has(key))) return null;
  return { schema_version: 1, catalogs: CATALOG_KEYS.map((key) => keyed.get(key)!) };
}

export function parseProfileTagPreview(value: unknown): ProfileTagPreview | null {
  const source = record(value);
  const revision = integer(source?.catalog_revision);
  const minimum = integer(source?.minimum_selected, 0, 20);
  const maximum = integer(source?.maximum_selected, 1, 20);
  if (
    !source || source.schema_version !== 1 || !CATALOG_KEYS.includes(source.catalog_key as typeof CATALOG_KEYS[number])
    || revision === null || typeof source.language !== "string" || !TAG_GENDERS.includes(source.gender as never)
    || !TAG_SEGMENTS.includes(source.segment as never) || typeof source.title !== "string" || typeof source.subtitle !== "string"
    || minimum === null || maximum === null || minimum > maximum || !Array.isArray(source.groups)
  ) return null;
  const groups: ProfileTagPreview["groups"] = [];
  for (const rawGroup of source.groups) {
    const group = record(rawGroup);
    const key = stableKey(group?.key);
    if (!group || !key || typeof group.label !== "string" || !Array.isArray(group.items)) return null;
    const items: ProfileTagPreview["groups"][number]["items"] = [];
    for (const rawItem of group.items) {
      const item = record(rawItem);
      const itemKey = tagItemKey(item?.key);
      const managedIcon = icon(item?.icon);
      if (!item || !itemKey || typeof item.label !== "string" || !managedIcon || typeof item.emoji !== "string") return null;
      items.push({ key: itemKey, label: item.label, icon: managedIcon, emoji: item.emoji });
    }
    groups.push({ key, label: group.label, items });
  }
  return {
    schema_version: 1,
    catalog_key: source.catalog_key as ProfileTagCatalog["key"],
    catalog_revision: revision,
    language: source.language,
    gender: source.gender as ProfileTagPreview["gender"],
    segment: source.segment as string,
    title: source.title,
    subtitle: source.subtitle,
    minimum_selected: minimum,
    maximum_selected: maximum,
    groups,
  };
}

export function parseTagCatalogSaveResult(value: unknown): { catalog: ProfileTagCatalog; warnings: ProfileTagWarning[] } | null {
  const source = record(value);
  const catalog = tagCatalog(source?.catalog);
  if (!source || !catalog || !Array.isArray(source.warnings)) return null;
  const warnings: ProfileTagWarning[] = [];
  for (const raw of source.warnings) {
    const warning = record(raw);
    const count = integer(warning?.selected_member_count);
    if (
      !warning || !["item-grandfathered", "group-grandfathered", "selection-limit-grandfathered"].includes(String(warning.type))
      || typeof warning.key !== "string" || count === null
    ) return null;
    warnings.push({ type: warning.type as ProfileTagWarning["type"], key: warning.key, selected_member_count: count });
  }
  return { catalog, warnings };
}

export function parseProfilePhotoInsights(value: unknown): ProfilePhotoInsights | null {
  const source = record(value);
  const insight = record(source?.insights);
  const uid = integer(source?.uid, 1);
  const total = integer(insight?.total_likes);
  const likedCount = integer(insight?.liked_photo_count);
  if (
    !source || !insight || uid === null || typeof source.display_name !== "string"
    || total === null || likedCount === null || !Array.isArray(insight.photos) || insight.photos.length > 200
    || (insight.top_photo_id !== null && (typeof insight.top_photo_id !== "string" || !/^[a-f0-9]{24}$/i.test(insight.top_photo_id)))
  ) return null;
  const photos: ProfilePhotoInsightRow[] = [];
  const seen = new Set<string>();
  for (const raw of insight.photos) {
    const row = record(raw);
    const likes = integer(row?.likes_count);
    const order = integer(row?.order);
    const rank = row?.rank === null ? null : integer(row?.rank, 1);
    if (
      !row || typeof row.image_id !== "string" || !/^[a-f0-9]{24}$/i.test(row.image_id)
      || seen.has(row.image_id) || likes === null || order === null || rank === null && row.rank !== null
      || typeof row.status !== "string"
    ) return null;
    seen.add(row.image_id);
    photos.push({ image_id: row.image_id, likes_count: likes, order, rank, status: row.status });
  }
  const topId = insight.top_photo_id as string | null;
  if (topId !== null && !seen.has(topId)) return null;
  if (photos.reduce((sum, row) => sum + row.likes_count, 0) !== total) return null;
  if (photos.filter((row) => row.likes_count > 0).length !== likedCount) return null;
  return { uid, display_name: source.display_name, total_likes: total, liked_photo_count: likedCount, top_photo_id: topId, photos };
}

export function sourceIdentity(source: PresentationSourceRef): string {
  return `${source.kind}:${source.key}`;
}

export function movePresentationSource(
  layout: PresentationLayout,
  source: PresentationSourceRef,
  destination: "highlight_cloud" | "more_about_me" | "unused",
  index?: number,
): PresentationLayout {
  const identity = sourceIdentity(source);
  const next: PresentationLayout = {
    ...layout,
    highlight_cloud: layout.highlight_cloud.filter((row) => sourceIdentity(row) !== identity),
    more_about_me: layout.more_about_me.filter((row) => sourceIdentity(row) !== identity),
  };
  if (destination === "unused") return next;
  const placement = [...next[destination]];
  const insertion = Math.max(0, Math.min(index ?? placement.length, placement.length));
  placement.splice(insertion, 0, source);
  return { ...next, [destination]: placement };
}

export function serializePresentationLayout(layout: PresentationLayout): {
  expected_revision: number;
  layout: { highlight_cloud: PresentationSourceRef[]; more_about_me: PresentationSourceRef[] };
} {
  return {
    expected_revision: layout.revision,
    layout: {
      highlight_cloud: layout.highlight_cloud.map((row) => ({ ...row })),
      more_about_me: layout.more_about_me.map((row) => ({ ...row })),
    },
  };
}

function reindexCatalog(catalog: ProfileTagCatalog): ProfileTagCatalog {
  return {
    ...catalog,
    groups: catalog.groups.map((group, groupIndex) => ({
      ...group,
      sort_order: (groupIndex + 1) * 10,
      items: group.items.map((item, itemIndex) => ({ ...item, sort_order: (itemIndex + 1) * 10 })),
    })),
  };
}

export function moveTagGroup(catalog: ProfileTagCatalog, from: number, to: number): ProfileTagCatalog {
  if (from < 0 || from >= catalog.groups.length || to < 0 || to >= catalog.groups.length || from === to) return catalog;
  const groups = catalog.groups.map((group) => ({ ...group, items: [...group.items] }));
  const [group] = groups.splice(from, 1);
  groups.splice(to, 0, group);
  return reindexCatalog({ ...catalog, groups });
}

export function moveTagItem(
  catalog: ProfileTagCatalog,
  fromGroupKey: string,
  itemKey: string,
  toGroupKey: string,
  targetIndex?: number,
): ProfileTagCatalog {
  const groups = catalog.groups.map((group) => ({ ...group, items: [...group.items] }));
  const fromGroup = groups.find((group) => group.key === fromGroupKey);
  const toGroup = groups.find((group) => group.key === toGroupKey);
  const sourceIndex = fromGroup?.items.findIndex((item) => item.key === itemKey) ?? -1;
  if (!fromGroup || !toGroup || sourceIndex < 0) return catalog;
  const [item] = fromGroup.items.splice(sourceIndex, 1);
  const insertion = Math.max(0, Math.min(targetIndex ?? toGroup.items.length, toGroup.items.length));
  toGroup.items.splice(insertion, 0, item);
  return reindexCatalog({ ...catalog, groups });
}

export function serializeTagCatalog(catalog: ProfileTagCatalog): Record<string, unknown> {
  const normalized = reindexCatalog(catalog);
  return {
    key: normalized.key,
    expected_revision: normalized.revision,
    labels: normalized.labels,
    subtitles: normalized.subtitles,
    minimum_selected: normalized.minimum_selected,
    maximum_selected: normalized.maximum_selected,
    active: normalized.active,
    groups: normalized.groups.map((group) => ({
      key: group.key,
      labels: group.labels,
      sort_order: group.sort_order,
      active: group.active,
      audience: group.audience,
      items: group.items.map((item) => ({
        key: item.key,
        labels: item.labels,
        sort_order: item.sort_order,
        active: item.active,
        audience: item.audience,
        icon: item.icon,
        emoji: item.emoji,
      })),
    })),
  };
}

export function catalogImpact(original: ProfileTagCatalog, draft: ProfileTagCatalog): {
  selectedReferences: number;
  limitLowered: boolean;
} {
  const originalGroups = new Map(original.groups.map((group) => [group.key, group]));
  const originalItems = new Map(original.groups.flatMap((group) => group.items.map((item) => [item.key, { group, item }] as const)));
  const affected = new Set<string>();
  for (const group of draft.groups) {
    const beforeGroup = originalGroups.get(group.key);
    const groupChanged = Boolean(beforeGroup && (
      beforeGroup.active !== group.active || JSON.stringify(beforeGroup.audience) !== JSON.stringify(group.audience)
    ));
    for (const item of group.items) {
      const before = originalItems.get(item.key);
      if (!before) continue;
      if (
        groupChanged || before.group.key !== group.key || before.item.active !== item.active
        || JSON.stringify(before.item.audience) !== JSON.stringify(item.audience)
      ) affected.add(item.key);
    }
  }
  for (const [key] of originalItems) {
    if (!draft.groups.some((group) => group.items.some((item) => item.key === key))) affected.add(key);
  }
  return {
    selectedReferences: [...affected].reduce((sum, key) => sum + (originalItems.get(key)?.item.selected_member_count ?? 0), 0),
    limitLowered: draft.maximum_selected < original.maximum_selected,
  };
}

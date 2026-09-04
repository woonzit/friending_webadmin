import { userCastGroup, type UserCastGroup } from "@/lib/userCastGroups";

export type LocalizedText = Record<string, string>;

export type ProfileFieldOption = {
  id?: number;
  option_id: number;
  field_key: string;
  key: string;
  labels: LocalizedText;
  sort_order: number;
  active: boolean;
  revision: number;
  system_owned: boolean;
  source: string;
  legacy_ids: string[];
  selected?: boolean;
  label?: string;
};

export type ProfileField = {
  key: string;
  labels: LocalizedText;
  descriptions: LocalizedText;
  label?: string;
  description?: string;
  selection: {
    mode: "single" | "multi";
    min_selected: number;
    max_selected: number;
  };
  audience: {
    mode: "global" | "segments";
    segments: string[];
    genders: string[];
    group_ids: string[];
  };
  icon: { url: string; mime: string };
  sort_order: number;
  active: boolean;
  eligible?: boolean;
  revision: number;
  system_owned: boolean;
  source: string;
  options: ProfileFieldOption[];
  values?: string[];
};

export type ProfileSegment = {
  key: string;
  labels: LocalizedText;
};

export type ProfileFieldCatalog = {
  schema_version: number;
  segments: ProfileSegment[];
  cast_groups: UserCastGroup[];
  fields: ProfileField[];
};

export type ProfileSectionItem = {
  kind: "field" | "builtin";
  key: string;
};

export type ProfileSection = {
  key: "main_data" | "more_about_you" | "lets_go_deeper";
  labels: LocalizedText;
  subtitles: LocalizedText;
  sort_order: number;
  hidden: boolean;
  items: ProfileSectionItem[];
};

export type ProfileBuiltinItem = {
  key: string;
  labels: LocalizedText;
  value_type: string;
  icon_key: string;
  editable: boolean;
};

export type ProfileSectionLayout = {
  schema_version: number;
  key: string;
  revision: number;
  sections: ProfileSection[];
  builtin_items: ProfileBuiltinItem[];
};

export type UserProfileSectionItem =
  | { kind: "field"; key: string }
  | {
      kind: "builtin";
      key: string;
      label: string;
      icon_key: string;
      value_type: string;
      editable: boolean;
      value: unknown;
      display_value: string;
    };

export type UserProfileSectionVisibility = {
  share_enabled: boolean;
  audience_note: string;
  hidden?: boolean;
};

export type UserProfileSection = {
  key: string;
  title: string;
  subtitle: string;
  visibility?: UserProfileSectionVisibility;
  items: UserProfileSectionItem[];
};

export type UserProfileFields = {
  schema_version: number;
  catalog_version: number;
  revision: number;
  language: string;
  segment: { key: string; label: string };
  /**
   * `gender` and `updated_at` are the whole identity block after T-669
   * (D-103 §6.4). `subgender` and `subgender_selected` were the D-019 pair and
   * are no longer modelled: the T-669 Core stops serving them, the deployed
   * Core still does, and the console renders neither. `orientation`,
   * `audience_status`, `channels` and `question_packs` are the older legacy
   * keys, absent under audience-visibility readiness and decoding as `""` /
   * `[]` from then on. See `userProfileFields()` for the accepted shapes.
   */
  identity: {
    gender: string;
    orientation: string;
    updated_at: number;
    audience_status: string;
    channels: string[];
    question_packs: string[];
  };
  /**
   * True only for the LEGACY identity shape — the one Core serves while
   * `AudienceVisibilityReadinessService::ready()` is false.
   *
   * It no longer gates an editor. T-669 makes
   * `WebadminController::saveUserProfileIdentity()` answer 410
   * `feature-retired` UNCONDITIONALLY, so the console has no legacy identity
   * write left at all and canonical gender is edited only through the T-653
   * audience-visibility panel. What this flag still says is whether Core is
   * serving the pre-D-019 sidecar (`channels`, `question_packs`), which the
   * derived-group summary renders when present.
   */
  identity_editable: boolean;
  /**
   * Present only while Core still serves the editable `height_cm` builtin in
   * `more_about_you`; null once T-632 retires it (the editor then posts no
   * builtin value at all).
   */
  height: {
    value: number | null;
    minimum: number;
    maximum: number;
    step: number;
    unit: string;
  } | null;
  sections: UserProfileSection[];
  fields: ProfileField[];
};

export type IdentityOption = {
  key: string;
  labels: LocalizedText;
  audiences: string[];
  active: boolean;
};

export type IdentityOptionGroup = {
  key: "gender" | "subgender" | "orientation";
  labels: LocalizedText;
  options: IdentityOption[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textMap(value: unknown): LocalizedText | null {
  if (Array.isArray(value) && value.length === 0) return {};
  const source = record(value);
  if (!source) return null;
  const result: LocalizedText = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item !== "string") return null;
    result[key] = item;
  }
  return result;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function option(value: unknown, fieldKey: string): ProfileFieldOption | null {
  const source = record(value);
  const labels = textMap(source?.labels);
  const legacyIds = strings(source?.legacy_ids ?? []);
  if (
    !source
    || typeof source.key !== "string"
    || !labels
    || typeof source.sort_order !== "number"
    || typeof source.active !== "boolean"
    || !legacyIds
  ) return null;
  return {
    id: typeof source.id === "number" ? source.id : undefined,
    option_id: typeof source.option_id === "number"
      ? source.option_id
      : typeof source.id === "number" ? source.id : 0,
    field_key: typeof source.field_key === "string" ? source.field_key : fieldKey,
    key: source.key,
    labels,
    sort_order: source.sort_order,
    active: source.active,
    revision: typeof source.revision === "number" ? source.revision : 0,
    system_owned: source.system_owned === true,
    source: typeof source.source === "string" ? source.source : "",
    legacy_ids: legacyIds,
    selected: typeof source.selected === "boolean" ? source.selected : undefined,
    label: typeof source.label === "string" ? source.label : undefined,
  };
}

/**
 * What an ABSENT `fields[].audience` decodes to.
 *
 * Under D-019 `AudienceVisibilityProjectionPolicy::member()` deletes every key
 * named `audience` from a member payload
 * (`api/src/Support/AudienceVisibilityProjectionPolicy.php:17`), and the admin
 * branch of `ProfileAttributeService::payload()` merges the catalogue row into
 * each field before that projection runs, so `/users/[uid]` receives field rows
 * with no audience block at all. An unrestricted field is the only reading that
 * cannot invent a restriction Core is not enforcing — the same "an empty list
 * and a missing list mean the same audience" reasoning already applied to
 * `group_ids` below. A block that IS present is validated exactly as before.
 *
 * `/profile-fields` reads `ProfileFieldCatalog::adminPayload()`, which is not
 * projection-filtered and still carries the block on every row.
 */
const ABSENT_AUDIENCE_MEANS_GLOBAL: Record<string, unknown> = {
  mode: "global",
  segments: [],
  genders: [],
  group_ids: [],
};

function field(value: unknown): ProfileField | null {
  const source = record(value);
  const labels = textMap(source?.labels);
  const descriptions = textMap(source?.descriptions ?? {});
  const selection = record(source?.selection);
  const audience = source && source.audience === undefined
    ? ABSENT_AUDIENCE_MEANS_GLOBAL
    : record(source?.audience);
  const icon = record(source?.icon);
  const segments = strings(audience?.segments);
  const genders = strings(audience?.genders ?? []);
  // Absent on payloads predating user-cast-groups-v1; never fabricated as a
  // failure, because an empty list and a missing list mean the same audience.
  const groupIds = strings(audience?.group_ids ?? []);
  const values = strings(source?.values ?? []);
  if (
    !source
    || typeof source.key !== "string"
    || !labels
    || !descriptions
    || !selection
    || !["single", "multi"].includes(String(selection.mode))
    || typeof selection.min_selected !== "number"
    || typeof selection.max_selected !== "number"
    || !audience
    || !["global", "segments"].includes(String(audience.mode))
    || !segments
    || !genders
    || genders.some((gender) => !["male", "female", "other"].includes(gender))
    || !groupIds
    || groupIds.some((id) => !/^[0-9a-f]{24}$/.test(id))
    || new Set(segments).size !== segments.length
    || new Set(genders).size !== genders.length
    || new Set(groupIds).size !== groupIds.length
    || (audience.mode === "global" && (segments.length !== 0 || genders.length !== 0 || groupIds.length !== 0))
    || (audience.mode === "segments" && segments.length === 0 && genders.length === 0 && groupIds.length === 0)
    || !icon
    || typeof icon.url !== "string"
    || typeof icon.mime !== "string"
    || typeof source.sort_order !== "number"
    || typeof source.active !== "boolean"
    || !Array.isArray(source.options)
    || !values
  ) return null;
  const fieldKey = source.key as string;
  const options = source.options.map((item) => option(item, fieldKey));
  if (options.some((item) => item === null)) return null;
  return {
    key: fieldKey,
    labels,
    descriptions,
    label: typeof source.label === "string" ? source.label : undefined,
    description: typeof source.description === "string" ? source.description : undefined,
    selection: {
      mode: selection.mode as "single" | "multi",
      min_selected: selection.min_selected,
      max_selected: selection.max_selected,
    },
    audience: {
      mode: audience.mode as "global" | "segments",
      segments,
      genders,
      group_ids: groupIds,
    },
    icon: { url: icon.url, mime: icon.mime },
    sort_order: source.sort_order,
    active: source.active,
    eligible: typeof source.eligible === "boolean" ? source.eligible : undefined,
    revision: typeof source.revision === "number" ? source.revision : 0,
    system_owned: source.system_owned === true,
    source: typeof source.source === "string" ? source.source : "",
    options: options as ProfileFieldOption[],
    values,
  };
}

export function profileFieldCatalog(value: unknown): ProfileFieldCatalog | null {
  const source = record(value);
  if (!source || !Array.isArray(source.fields) || !Array.isArray(source.segments)) return null;
  const fields = source.fields.map(field);
  if (fields.some((item) => item === null)) return null;
  const segments: ProfileSegment[] = [];
  for (const value of source.segments) {
    const row = record(value);
    const labels = textMap(row?.labels);
    if (!row || typeof row.key !== "string" || !labels) return null;
    segments.push({ key: row.key, labels });
  }
  const castGroups: UserCastGroup[] = [];
  if (!Array.isArray(source.cast_groups)) return null;
  for (const value of source.cast_groups) {
    const row = userCastGroup(value);
    if (!row) return null;
    castGroups.push(row);
  }
  if (
    new Set(castGroups.map((group) => group.id)).size !== castGroups.length
    || new Set(castGroups.map((group) => group.key)).size !== castGroups.length
    || (fields as ProfileField[]).some((item) => item.audience.segments.some(
      (segment) => !segments.some((known) => known.key === segment)
    ))
    || (fields as ProfileField[]).some((item) => item.audience.group_ids.some(
      (id) => !castGroups.some((known) => known.id === id)
    ))
  ) return null;
  return {
    schema_version: typeof source.schema_version === "number" ? source.schema_version : 1,
    segments,
    cast_groups: castGroups,
    fields: fields as ProfileField[],
  };
}

export function profileSectionLayout(value: unknown): ProfileSectionLayout | null {
  const source = record(value);
  if (
    !source
    || source.schema_version !== 1
    || source.key !== "profile_sections_v1"
    || !Number.isInteger(source.revision)
    || Number(source.revision) < 0
    || !Array.isArray(source.sections)
    || source.sections.length !== 3
    || !Array.isArray(source.builtin_items)
  ) return null;
  const sectionKeys = new Set(["main_data", "more_about_you", "lets_go_deeper"]);
  const sections: ProfileSection[] = [];
  const seenSections = new Set<string>();
  const seenItems = new Set<string>();
  for (const item of source.sections) {
    const section = record(item);
    const labels = textMap(section?.labels);
    const subtitles = textMap(section?.subtitles ?? {});
    if (
      !section
      || typeof section.key !== "string"
      || !sectionKeys.has(section.key)
      || seenSections.has(section.key)
      || !labels
      || !labels.en
      || !labels.hu
      || !subtitles
      || !Number.isInteger(section.sort_order)
      || Number(section.sort_order) < 0
      || !Array.isArray(section.items)
      || section.items.length > 150
    ) return null;
    const hidden = section.hidden === undefined ? false : section.hidden;
    // more_about_you cannot hide: Core refuses such a save with
    // profile-section-not-hideable, so a payload carrying it is malformed.
    if (typeof hidden !== "boolean" || (hidden && section.key === "more_about_you")) return null;
    const sectionItems: ProfileSectionItem[] = [];
    for (const rawItem of section.items) {
      const row = record(rawItem);
      if (
        !row
        || !["field", "builtin"].includes(String(row.kind))
        || typeof row.key !== "string"
        || !/^[a-z][a-z0-9_]{0,63}$/.test(row.key)
      ) return null;
      const identity = `${String(row.kind)}:${row.key}`;
      if (seenItems.has(identity)) return null;
      seenItems.add(identity);
      sectionItems.push({ kind: row.kind as ProfileSectionItem["kind"], key: row.key });
    }
    seenSections.add(section.key);
    sections.push({
      key: section.key as ProfileSection["key"],
      labels,
      subtitles,
      sort_order: Number(section.sort_order),
      hidden,
      items: sectionItems,
    });
  }
  const builtinItems: ProfileBuiltinItem[] = [];
  for (const item of source.builtin_items) {
    const row = record(item);
    const labels = textMap(row?.labels);
    if (
      !row
      || typeof row.key !== "string"
      || !labels
      || typeof row.value_type !== "string"
      || typeof row.icon_key !== "string"
      || typeof row.editable !== "boolean"
    ) return null;
    builtinItems.push({
      key: row.key,
      labels,
      value_type: row.value_type,
      icon_key: row.icon_key,
      editable: row.editable,
    });
  }
  // The height builtin is optional: T-632 retires it from Core, so a layout
  // with or without it decodes. While a layout still carries it, it may sit
  // only in more_about_you.
  const heightSection = sections.find((section) => section.items.some(
    (item) => item.kind === "builtin" && item.key === "height_cm",
  ));
  if (heightSection && heightSection.key !== "more_about_you") return null;
  return {
    schema_version: 1,
    key: "profile_sections_v1",
    revision: Number(source.revision),
    sections,
    builtin_items: builtinItems,
  };
}

export function userProfileFields(value: unknown): UserProfileFields | null {
  const source = record(value);
  const segment = record(source?.segment);
  const identity = record(source?.identity);
  const layout = record(source?.layout);
  // The identity shapes this route can carry. All three decode; only the
  // required key set differs, and `gender` plus `updated_at` is the whole of it.
  //
  // TERMINAL (T-669, `api` 1d108591): exactly `gender` and `updated_at`, from
  // `ProfileAttributeService::identityPayloadFromAudience()`. Pinned at
  // `tests/fixtures/audience_visibility_admin_wire_t669/owner-profile-fields-identity.json`.
  //
  // DEPLOYED (post-D-019, `api` 364c89e8): those two plus `subgender` and
  // `subgender_selected`, served whenever
  // `AudienceVisibilityReadinessService::ready()` is true — true on the live
  // server since 2026-08-28. Pinned byte-identically at
  // `tests/fixtures/audience_visibility_admin_wire/owner-profile-fields-identity.json`.
  //
  // LEGACY (pre-D-019): the deployed four plus `orientation`, `audience_status`,
  // `channels` and `question_packs`. Served only while readiness is false.
  //
  // The retired pair is IGNORED, not refused, so both shapes decode; every
  // legacy key that IS present is validated exactly as it always was, so this
  // widens what is accepted without weakening any known value. `audience_status`
  // has been optional-with-a-default since the key existed and stays that way.
  const legacyIdentity = identity !== null && (
    identity.orientation !== undefined
    || identity.channels !== undefined
    || identity.question_packs !== undefined
  );
  // In the legacy branch all three keys must be present and well-formed, exactly
  // as they had to be before; in the active branch none of them is served.
  const channels = strings(legacyIdentity ? identity?.channels : []);
  const questionPacks = strings(legacyIdentity ? identity?.question_packs : []);
  if (
    !source
    || !Array.isArray(source.fields)
    || !segment
    || typeof segment.key !== "string"
    || typeof segment.label !== "string"
    || !identity
    || typeof identity.gender !== "string"
    || (legacyIdentity && typeof identity.orientation !== "string")
    || !channels
    || !questionPacks
    || !layout
    || !Array.isArray(layout.sections)
  ) return null;
  let height: UserProfileFields["height"] | null = null;
  const sections: UserProfileSection[] = [];
  for (const rawSection of layout.sections) {
    const section = record(rawSection);
    if (
      !section
      || typeof section.key !== "string"
      || typeof section.title !== "string"
      || typeof section.subtitle !== "string"
      || !Array.isArray(section.items)
    ) return null;
    const sectionItems: UserProfileSectionItem[] = [];
    for (const rawItem of section.items) {
      const item = record(rawItem);
      if (!item || typeof item.key !== "string") return null;
      if (item.kind === "field") {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(item.key)) return null;
        sectionItems.push({ kind: "field", key: item.key });
        continue;
      }
      if (item.kind !== "builtin") return null;
      if (
        typeof item.label !== "string"
        || typeof item.value_type !== "string"
        || typeof item.editable !== "boolean"
        || typeof item.display_value !== "string"
      ) return null;
      sectionItems.push({
        kind: "builtin",
        key: item.key,
        label: item.label,
        icon_key: typeof item.icon_key === "string" ? item.icon_key : "",
        value_type: item.value_type,
        editable: item.editable,
        value: item.value,
        display_value: item.display_value,
      });
      if (item.key !== "height_cm") continue;
      const constraints = record(item.constraints);
      if (
        section.key !== "more_about_you"
        || height !== null
        || !constraints
        || !Number.isInteger(constraints.minimum)
        || !Number.isInteger(constraints.maximum)
        || !Number.isInteger(constraints.step)
        || typeof constraints.unit !== "string"
        || (item.value !== null && !Number.isInteger(item.value))
      ) return null;
      height = {
        value: item.value === null ? null : Number(item.value),
        minimum: Number(constraints.minimum),
        maximum: Number(constraints.maximum),
        step: Number(constraints.step),
        unit: constraints.unit,
      };
      if (
        height.value !== null
        && (height.value < height.minimum || height.value > height.maximum)
      ) return null;
    }
    let visibility: UserProfileSectionVisibility | undefined;
    const rawVisibility = record(section.visibility);
    if (
      rawVisibility
      && typeof rawVisibility.share_enabled === "boolean"
      && typeof rawVisibility.audience_note === "string"
    ) {
      visibility = {
        share_enabled: rawVisibility.share_enabled,
        audience_note: rawVisibility.audience_note,
        ...(typeof rawVisibility.hidden === "boolean" ? { hidden: rawVisibility.hidden } : {}),
      };
    }
    sections.push({
      key: section.key,
      title: section.title,
      subtitle: section.subtitle,
      ...(visibility ? { visibility } : {}),
      items: sectionItems,
    });
  }
  // A height builtin is optional (T-632); when one is served, its constraints
  // are validated exactly as before.
  if (height && (height.minimum < 0 || height.maximum <= height.minimum || height.step <= 0)) {
    return null;
  }
  const fields = source.fields.map(field);
  if (fields.some((item) => item === null)) return null;
  return {
    schema_version: typeof source.schema_version === "number" ? source.schema_version : 1,
    catalog_version: typeof source.catalog_version === "number" ? source.catalog_version : 1,
    revision: typeof source.revision === "number" ? source.revision : 0,
    language: typeof source.language === "string" ? source.language : "en",
    segment: { key: segment.key, label: segment.label },
    identity_editable: legacyIdentity,
    identity: {
      gender: identity.gender,
      orientation: typeof identity.orientation === "string" ? identity.orientation : "",
      updated_at: typeof identity.updated_at === "number" ? identity.updated_at : 0,
      audience_status: typeof identity.audience_status === "string" ? identity.audience_status : "",
      channels,
      question_packs: questionPacks,
    },
    height,
    sections,
    fields: fields as ProfileField[],
  };
}

export function identityOptionGroups(value: unknown): IdentityOptionGroup[] | null {
  if (!Array.isArray(value)) return null;
  const result: IdentityOptionGroup[] = [];
  for (const item of value) {
    const source = record(item);
    if (
      !source
      || !["gender", "subgender", "orientation"].includes(String(source.key))
      || !Array.isArray(source.options)
    ) return null;
    const options: IdentityOption[] = [];
    for (const item of source.options) {
      const row = record(item);
      const audiences = strings(row?.audiences ?? []);
      if (
        !row
        || typeof row.key !== "string"
        || typeof row.name_en !== "string"
        || typeof row.name_hu !== "string"
        || !audiences
      ) return null;
      options.push({
        key: row.key,
        labels: { en: row.name_en, hu: row.name_hu },
        audiences,
        active: row.active !== false,
      });
    }
    if (typeof source.name_en !== "string" || typeof source.name_hu !== "string") return null;
    result.push({
      key: source.key as IdentityOptionGroup["key"],
      labels: { en: source.name_en, hu: source.name_hu },
      options,
    });
  }
  const keys = result.map((group) => group.key);
  // Core omits retired identity groups from the admin catalogue, and T-669
  // leaves exactly one: `WebadminController::userProfileFields()` now projects
  // `gender` alone, where the deployed Core projects gender, subgender and
  // orientation. Gender is the only group any surface reads, so it is the only
  // one required; the two retired groups may coexist during a rolling
  // deployment and are ignored by the UI rather than refused.
  return result.length >= 1
    && result.length <= 3
    && new Set(keys).size === result.length
    && keys.includes("gender")
    ? result
    : null;
}

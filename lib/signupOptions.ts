import {
  type CastGroupSegment,
  type UserCastGroup,
  userCastGroupsPayload,
} from "@/lib/userCastGroups";

export type SignupOption = {
  key: string;
  name_en: string;
  name_hu: string;
  sort_order: number;
  active: boolean;
  is_custom: boolean;
  system_owned: boolean;
  audiences?: string[];
};

type SignupGroupAudience = {
  mode: "global" | "groups";
  genders: string[];
  group_ids: string[];
  segments: string[];
};

export type SignupOptionGroup = {
  key: string;
  name_en: string;
  name_hu: string;
  system_owned: boolean;
  required: boolean;
  custom_allowed: boolean;
  extensible_system: boolean;
  profile_field: string;
  question_pack: string;
  revision: number;
  icon: { url: string; mime: string };
  audience: SignupGroupAudience;
  options: SignupOption[];
};

export type SignupCatalog = {
  schema_version: number;
  cast_groups: UserCastGroup[];
  segments: CastGroupSegment[];
  groups: SignupOptionGroup[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return [...new Set(value as string[])];
}

/**
 * Decode exactly the question groups Core currently serves. Group keys are not
 * enumerated here: retiring a system group removes its card instead of making
 * the whole catalogue unreadable.
 */
export function signupOptionCatalog(raw: unknown): SignupCatalog | null {
  const catalog = record(raw);
  if (!catalog || !Array.isArray(catalog.groups)) return null;
  const castPayload = userCastGroupsPayload({
    groups: catalog.cast_groups,
    segments: catalog.segments,
  });
  if (!castPayload) return null;
  const groups: SignupOptionGroup[] = [];
  for (const value of catalog.groups) {
    const group = record(value);
    const icon = record(group?.icon);
    const audience = record(group?.audience);
    const genders = stringList(audience?.genders);
    const groupIds = stringList(audience?.group_ids);
    const segments = stringList(audience?.segments);
    if (
      !group
      || typeof group.key !== "string"
      || typeof group.name_en !== "string"
      || typeof group.name_hu !== "string"
      || typeof group.system_owned !== "boolean"
      || typeof group.required !== "boolean"
      || typeof group.custom_allowed !== "boolean"
      || typeof group.profile_field !== "string"
      || typeof group.question_pack !== "string"
      || !Number.isInteger(group.revision)
      || !icon
      || typeof icon.url !== "string"
      || typeof icon.mime !== "string"
      || !audience
      || (audience.mode !== "global" && audience.mode !== "groups")
      || !genders
      || !groupIds
      || !segments
      || !Array.isArray(group.options)
    ) return null;
    const options: SignupOption[] = [];
    for (const optionValue of group.options) {
      const option = record(optionValue);
      if (
        !option
        || typeof option.key !== "string"
        || typeof option.name_en !== "string"
        || typeof option.name_hu !== "string"
        || typeof option.sort_order !== "number"
        || typeof option.active !== "boolean"
        || typeof option.is_custom !== "boolean"
        || typeof option.system_owned !== "boolean"
        || (option.audiences !== undefined && !stringList(option.audiences))
      ) return null;
      options.push({
        key: option.key,
        name_en: option.name_en,
        name_hu: option.name_hu,
        sort_order: option.sort_order,
        active: option.active,
        is_custom: option.is_custom,
        system_owned: option.system_owned,
        ...(option.audiences ? { audiences: option.audiences as string[] } : {}),
      });
    }
    groups.push({
      key: group.key,
      name_en: group.name_en,
      name_hu: group.name_hu,
      system_owned: group.system_owned,
      required: group.required,
      custom_allowed: group.custom_allowed,
      extensible_system: group.extensible_system === true,
      profile_field: group.profile_field,
      question_pack: group.question_pack,
      revision: Number(group.revision),
      icon: { url: icon.url, mime: icon.mime },
      audience: {
        mode: audience.mode,
        genders,
        group_ids: groupIds,
        segments,
      },
      options,
    });
  }
  return {
    schema_version: typeof catalog.schema_version === "number" ? catalog.schema_version : 1,
    cast_groups: castPayload.groups,
    segments: castPayload.segments,
    groups,
  };
}

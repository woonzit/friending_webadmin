import { userCastGroup, type UserCastGroup } from "@/lib/userCastGroups";

export type IcebreakerLocalizedText = Record<string, string>;

export type IcebreakerReferenceOption = {
  key: string;
  labels: IcebreakerLocalizedText;
};

export type IcebreakerPrompt = {
  id: string;
  key: string;
  labels: IcebreakerLocalizedText;
  groups: Array<"friends" | "sex" | "love">;
  member_sex: "male" | "female" | "both";
  audience: { mode: "global" | "segments"; segments: string[]; genders: string[]; group_ids: string[] };
  sort_order: number;
  active: boolean;
  revision: number;
  system_owned: boolean;
  source: string;
  legacy_ids: string[];
};

export type IcebreakerCatalog = {
  schema_version: number;
  groups: IcebreakerReferenceOption[];
  member_sexes: IcebreakerReferenceOption[];
  segments: IcebreakerReferenceOption[];
  cast_groups: UserCastGroup[];
  prompts: IcebreakerPrompt[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim() === item && item !== "")
    && new Set(value).size === value.length
    ? value as string[]
    : null;
}

function textMap(value: unknown): IcebreakerLocalizedText | null {
  const source = record(value);
  if (!source) return null;
  const result: IcebreakerLocalizedText = {};
  for (const [key, item] of Object.entries(source)) {
    if (
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(key)
      || typeof item !== "string"
      || item.trim() !== item
      || item === ""
      || Array.from(item).length > 180
      || /[\u0000-\u001F\u007F]/u.test(item)
    ) return null;
    result[key] = item;
  }
  return result;
}

function options(value: unknown): IcebreakerReferenceOption[] | null {
  if (!Array.isArray(value)) return null;
  const result: IcebreakerReferenceOption[] = [];
  for (const item of value) {
    const row = record(item);
    const labels = textMap(row?.labels);
    if (
      !row
      || typeof row.key !== "string"
      || !/^[a-z][a-z0-9_]{0,63}$/.test(row.key)
      || !labels
      || typeof labels.en !== "string"
      || labels.en.trim() === ""
      || typeof labels.hu !== "string"
      || labels.hu.trim() === ""
    ) return null;
    result.push({ key: row.key, labels });
  }
  if (new Set(result.map((item) => item.key)).size !== result.length) return null;
  return result;
}

function prompt(value: unknown): IcebreakerPrompt | null {
  const source = record(value);
  const labels = textMap(source?.labels);
  const groups = strings(source?.groups);
  const audience = record(source?.audience);
  const segments = strings(audience?.segments);
  const genders = strings(audience?.genders ?? []);
  const groupIds = strings(audience?.group_ids ?? []);
  const legacyIds = strings(source?.legacy_ids ?? []);
  if (
    !source
    || typeof source.id !== "string"
    || typeof source.key !== "string"
    || !/^[a-z][a-z0-9_]{0,63}$/.test(source.key)
    || !labels
    || typeof labels.en !== "string"
    || labels.en.trim() === ""
    || typeof labels.hu !== "string"
    || labels.hu.trim() === ""
    || !groups
    || groups.length === 0
    || groups.length > 3
    || !groups.every((group) => ["friends", "sex", "love"].includes(group))
    || !["male", "female", "both"].includes(String(source.member_sex))
    || !audience
    || !["global", "segments"].includes(String(audience.mode))
    || !segments
    || !genders
    || genders.some((gender) => !["male", "female", "other"].includes(gender))
    || !groupIds
    || groupIds.some((id) => !/^[0-9a-f]{24}$/.test(id))
    || (audience.mode === "global" && segments.length !== 0)
    || (audience.mode === "global" && (genders.length !== 0 || groupIds.length !== 0))
    || (audience.mode === "segments" && segments.length === 0 && genders.length === 0 && groupIds.length === 0)
    || !Number.isInteger(source.sort_order)
    || Number(source.sort_order) < 0
    || Number(source.sort_order) > 100000
    || typeof source.active !== "boolean"
    || !Number.isInteger(source.revision)
    || Number(source.revision) < 0
    || typeof source.system_owned !== "boolean"
    || typeof source.source !== "string"
    || !legacyIds
  ) return null;
  return {
    id: typeof source.id === "string" ? source.id : "",
    key: source.key,
    labels,
    groups: groups as IcebreakerPrompt["groups"],
    member_sex: source.member_sex as IcebreakerPrompt["member_sex"],
    audience: {
      mode: audience.mode as IcebreakerPrompt["audience"]["mode"],
      segments,
      genders,
      group_ids: groupIds,
    },
    sort_order: Number(source.sort_order),
    active: source.active,
    revision: Number(source.revision),
    system_owned: source.system_owned,
    source: source.source,
    legacy_ids: legacyIds,
  };
}

export function icebreakerCatalog(value: unknown): IcebreakerCatalog | null {
  const source = record(value);
  const groups = options(source?.groups);
  const memberSexes = options(source?.member_sexes);
  const segments = options(source?.segments);
  const castGroups: UserCastGroup[] = [];
  if (!Array.isArray(source?.cast_groups)) return null;
  for (const value of source.cast_groups) {
    const row = userCastGroup(value);
    if (!row) return null;
    castGroups.push(row);
  }
  if (
    !source
    || source.schema_version !== 1
    || !groups
    || !memberSexes
    || !segments
    || groups.map((item) => item.key).join(",") !== "friends,sex,love"
    || memberSexes.map((item) => item.key).join(",") !== "male,female,both"
    || !Array.isArray(source.prompts)
  ) return null;
  const prompts = source.prompts.map(prompt);
  if (prompts.some((item) => item === null)) return null;
  const parsed = prompts as IcebreakerPrompt[];
  if (
    new Set(parsed.map((item) => item.key)).size !== parsed.length
    || parsed.some((item) => item.audience.segments.some(
      (segment) => !segments.some((known) => known.key === segment)
    ))
    || parsed.some((item) => item.audience.group_ids.some(
      (id) => !castGroups.some((known) => known.id === id)
    ))
    || new Set(castGroups.map((group) => group.id)).size !== castGroups.length
    || new Set(castGroups.map((group) => group.key)).size !== castGroups.length
  ) return null;
  return {
    schema_version: 1,
    groups,
    member_sexes: memberSexes,
    segments,
    cast_groups: castGroups,
    prompts: parsed,
  };
}

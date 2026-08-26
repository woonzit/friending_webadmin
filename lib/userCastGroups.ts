import { containsDisclosureOnlyOrientation } from "./orientationIntegrity.ts";

/**
 * Dynamic user cast groups (user-cast-groups-v1).
 *
 * A cast group is an administrator-created entity with its own MongoDB id:
 * localized labels plus rules — {genders[], orientations[]} pairs — deciding
 * which members belong. Membership is a set, so one member can belong to
 * several groups at once. The six seeded system groups reproduce the former
 * hardcoded segments; their key and legacy segment are immutable in Core and
 * they cannot be archived.
 *
 * Fail-closed in the sense of `lib/icebreakers.ts`: one unreadable row
 * invalidates the payload, because rendering a half-understood rule table
 * would show an operator an audience that is not the one Core enforces.
 */

export type CastGroupRule = {
  genders: string[];
  orientations: string[];
};

export type UserCastGroup = {
  id: string;
  key: string;
  labels: Record<string, string>;
  rules: CastGroupRule[];
  legacy_segment: string;
  sort_order: number;
  active: boolean;
  system: boolean;
  revision: number;
};

export type CastGroupSegment = {
  key: string;
  labels: Record<string, string>;
};

export type UserCastGroupsPayload = {
  groups: UserCastGroup[];
  segments: CastGroupSegment[];
};

export const CAST_GROUP_GENDERS = ["male", "female", "other"] as const;
const CAST_GROUP_SEGMENTS = new Set([
  "male_hetero", "male_gay", "male_bisexual",
  "female_hetero", "female_lesbian", "female_bisexual",
  "identity_unresolved",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textMap(value: unknown): Record<string, string> | null {
  const source = record(value);
  if (!source) return null;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(key)
      || typeof item !== "string"
      || item.trim() !== item
      || item === ""
      || Array.from(item).length > 80
      || /[\u0000-\u001F\u007F]/u.test(item)
    ) return null;
    result[key] = item;
  }
  return result;
}

function strings(value: unknown): string[] | null {
  if (
    !Array.isArray(value)
    || !value.every((item) => typeof item === "string" && item.trim() === item && item !== "")
    || new Set(value).size !== value.length
  ) return null;
  return value as string[];
}

export function userCastGroup(value: unknown): UserCastGroup | null {
  const source = record(value);
  const labels = textMap(source?.labels);
  if (
    !source
    || typeof source.id !== "string"
    || !/^[0-9a-f]{24}$/.test(source.id)
    || typeof source.key !== "string"
    || !/^[a-z][a-z0-9_]{0,63}$/.test(source.key)
    || !labels
    || typeof labels.en !== "string"
    || typeof labels.hu !== "string"
    || !Array.isArray(source.rules)
    || source.rules.length === 0
    || source.rules.length > 20
    || !Number.isInteger(source.sort_order)
    || Number(source.sort_order) < 0
    || Number(source.sort_order) > 100000
    || typeof source.active !== "boolean"
    || typeof source.system !== "boolean"
    || !Number.isInteger(source.revision)
    || Number(source.revision) < 1
  ) return null;
  const rules: CastGroupRule[] = [];
  for (const item of source.rules) {
    const rule = record(item);
    const genders = strings(rule?.genders);
    const orientations = strings(rule?.orientations);
    if (
      !rule
      || !genders
      || genders.length === 0
      || genders.some((gender) => !CAST_GROUP_GENDERS.includes(gender as typeof CAST_GROUP_GENDERS[number]))
      || !orientations
      || orientations.length === 0
      || orientations.some((orientation) => !/^[a-z][a-z0-9_]{0,63}$/.test(orientation))
      || containsDisclosureOnlyOrientation(orientations)
    ) return null;
    rules.push({ genders, orientations });
  }
  const legacySegment = typeof source.legacy_segment === "string" ? source.legacy_segment : "";
  if (legacySegment !== "" && !CAST_GROUP_SEGMENTS.has(legacySegment)) return null;
  return {
    id: source.id,
    key: source.key,
    labels,
    rules,
    legacy_segment: legacySegment,
    sort_order: Number(source.sort_order),
    active: source.active,
    system: source.system,
    revision: Number(source.revision),
  };
}

export function userCastGroupsPayload(value: unknown): UserCastGroupsPayload | null {
  const source = record(value);
  if (!source || !Array.isArray(source.groups) || !Array.isArray(source.segments)) return null;
  const groups: UserCastGroup[] = [];
  for (const item of source.groups) {
    const row = userCastGroup(item);
    if (!row) return null;
    groups.push(row);
  }
  const segments: CastGroupSegment[] = [];
  for (const item of source.segments) {
    const row = record(item);
    const labels = textMap(row?.labels);
    if (!row || typeof row.key !== "string" || !labels) return null;
    segments.push({ key: row.key, labels });
  }
  if (
    new Set(groups.map((group) => group.id)).size !== groups.length
    || new Set(groups.map((group) => group.key)).size !== groups.length
    || new Set(segments.map((segment) => segment.key)).size !== segments.length
    || groups.some((group) => group.legacy_segment !== ""
      && !segments.some((segment) => segment.key === group.legacy_segment))
  ) return null;
  return { groups, segments };
}

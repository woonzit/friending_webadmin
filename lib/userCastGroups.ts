/**
 * Audience ("cast") groups, as Core serves them under `cast_groups` since
 * T-736 (D-019 / D-119).
 *
 * A group is an administrator-visible entity with its own MongoDB id:
 * localized labels plus rules deciding which members belong. A rule is
 * gender × who-can-see-me — `{genders[], visible_to[]}` over the two closed
 * vocabularies below — never an orientation. Membership is a set, so one
 * member can belong to several groups at once. The seven protected system
 * groups reproduce the former hardcoded segments through `legacy_segment`;
 * their key, rule and segment are immutable in Core and they cannot be
 * archived.
 *
 * The former V1 rule shape `{genders[], orientations[]}` is REFUSED. T-736
 * deleted Core's V1 reader, and a legacy-shaped stored row now makes Core
 * refuse its whole catalogue (`audience-visibility-stored-invalid`), so no
 * V1 row can reach a console any more; accepting one here would leave this
 * decoder as the only place in the system that still believes in it.
 *
 * Fail-closed in the sense of `lib/icebreakers.ts` — one unreadable row
 * invalidates the payload — over exactly the fields a console reads or writes
 * back: id, key, labels, the rule vocabulary, legacy_segment, sort_order,
 * active, protected and revision. The sibling `editable_fields` is
 * deliberately NOT pinned here: nothing on these pages edits a group (that is
 * `/audience-visibility`, whose own decoder does pin it), and T-769 is the
 * lesson that a second, stricter authority over keys nobody renders only
 * darkens a page Core was serving correctly.
 */

/** D-019 identity axis (`identity_v2.gender`). */
export const CAST_GROUP_GENDERS = ["man", "woman", "nonbinary"] as const;
/** D-019 audience axis (`identity_v2.visible_to`). */
export const CAST_GROUP_VISIBILITY = ["male", "female", "both"] as const;

export type CastGroupGender = (typeof CAST_GROUP_GENDERS)[number];
export type CastGroupVisibility = (typeof CAST_GROUP_VISIBILITY)[number];

/**
 * Compatibility segments a protected group may project onto. The first seven
 * are `ProfileFieldPolicy::SEGMENTS`; `other` is the eighth spelling Core
 * gives the non-binary group on the wire
 * (`AudienceVisibilityPolicy::LEGACY_SEGMENT_OTHER`) for the same segment the
 * catalogues list as `identity_unresolved`.
 */
const CAST_GROUP_PROFILE_SEGMENTS = [
  "male_hetero", "male_gay", "male_bisexual",
  "female_hetero", "female_lesbian", "female_bisexual",
  "identity_unresolved",
] as const;

const CAST_GROUP_SEGMENT_OTHER = "other";
const CAST_GROUP_SEGMENTS = new Set<string>([
  ...CAST_GROUP_PROFILE_SEGMENTS,
  CAST_GROUP_SEGMENT_OTHER,
]);

/**
 * The one name a catalogue's own `segments` list uses for a group's
 * compatibility segment. Core answers `other` on the group row and
 * `identity_unresolved` in every `segments` list it publishes beside it
 * (`AudienceVisibilityPolicy::profileSegment()` bridges the two), so a
 * console that compares the two spellings verbatim would both refuse the
 * catalogue and offer the same audience twice.
 */
export function castGroupProfileSegment(legacySegment: string): string {
  return legacySegment === CAST_GROUP_SEGMENT_OTHER ? "identity_unresolved" : legacySegment;
}

export type CastGroupRule = {
  genders: CastGroupGender[];
  visible_to: CastGroupVisibility[];
};

export type UserCastGroup = {
  id: string;
  key: string;
  labels: Record<string, string>;
  rules: CastGroupRule[];
  legacy_segment: string;
  sort_order: number;
  active: boolean;
  /** Core's `protected`: a seeded system group, immutable except label and order. */
  protected: boolean;
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

/**
 * A rule axis: a non-empty subset of the closed vocabulary, without repeats
 * and in the vocabulary's own order — Core normalizes both axes that way on
 * the way out (`UserCastGroupService::strictStoredRuleValues()`).
 */
function ruleValues<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => typeof item === "string" && canonical.includes(item))) return null;
  const parsed = value as T[number][];
  if (new Set(parsed).size !== parsed.length) return null;
  const expected = canonical.filter((item) => parsed.includes(item));
  return expected.length === parsed.length && expected.every((item, index) => item === parsed[index])
    ? parsed
    : null;
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
    || typeof source.protected !== "boolean"
    || !Number.isInteger(source.revision)
    || Number(source.revision) < 1
  ) return null;
  const rules: CastGroupRule[] = [];
  for (const item of source.rules) {
    const rule = record(item);
    const genders = ruleValues(rule?.genders, CAST_GROUP_GENDERS);
    const visibleTo = ruleValues(rule?.visible_to, CAST_GROUP_VISIBILITY);
    if (
      !rule
      || !genders
      || !visibleTo
      // D-019: a non-binary identity is only ever visible to everyone.
      || (genders.includes("nonbinary") && (visibleTo.length !== 1 || visibleTo[0] !== "both"))
    ) return null;
    rules.push({ genders, visible_to: visibleTo });
  }
  const fingerprints = rules.map((rule) => JSON.stringify(rule));
  if (new Set(fingerprints).size !== fingerprints.length) return null;
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
    protected: source.protected,
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
      && !segments.some((segment) => segment.key === castGroupProfileSegment(group.legacy_segment)))
  ) return null;
  return { groups, segments };
}

import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Accepted D-019 Core ↔ Webadmin contract, including lead amendments A1–A6. */
export const AUDIENCE_VISIBILITY_CONTRACT_VERSION = 1 as const;
export const AUDIENCE_VISIBILITY_GENDERS = ["man", "woman", "nonbinary"] as const;
export const AUDIENCE_VISIBILITY_VALUES = ["male", "female", "both"] as const;
export const AUDIENCE_VISIBILITY_CAPABILITIES = [
  "audience_visibility_catalog_read",
  "audience_visibility_member_read",
  "audience_visibility_group_write",
  "audience_visibility_intent_write",
] as const;
export const AUDIENCE_VISIBILITY_ADMIN_ACTIONS = [
  "audience_visibility_catalog",
  "audience_visibility_member_detail",
  "save_audience_visibility_group",
  "archive_audience_visibility_group",
  "save_audience_visibility_intent",
  "archive_audience_visibility_intent",
  "set_audience_visibility_intent_limit",
] as const;
export const AUDIENCE_VISIBILITY_MUTATION_ACTIONS = [
  "save_audience_visibility_group",
  "archive_audience_visibility_group",
  "save_audience_visibility_intent",
  "archive_audience_visibility_intent",
  "set_audience_visibility_intent_limit",
] as const;
export const AUDIENCE_VISIBILITY_TABS = ["groups", "retirement", "intents"] as const;

export const AUDIENCE_VISIBILITY_LEGACY_TYPES = [
  "sex_cut",
  "sex_dick",
  "sex_dirty",
  "sex_fetish",
  "sex_fisting",
  "sex_hiv_status",
  "sex_meet",
  "sex_preference",
  "sex_safety",
  "sex_sm",
  "sexualty",
  "filter_position",
  "i_am_into",
  "my_tribes",
] as const;

export const AUDIENCE_VISIBILITY_INITIAL_INTENT_KEYS = [
  "people_to_meet_irl",
  "couple_friends",
  "gaming",
  "volunteer",
  "workouts_sports",
  "travel",
  "live_music",
  "nights_out",
  "coworking",
  "faith_studies",
  "arts_culture",
  "roommate",
  "kid_playdates",
  "anything",
] as const;

export type AudienceVisibilityGender = (typeof AUDIENCE_VISIBILITY_GENDERS)[number];
export type AudienceVisibilityValue = (typeof AUDIENCE_VISIBILITY_VALUES)[number];
export type AudienceVisibilityCapability = (typeof AUDIENCE_VISIBILITY_CAPABILITIES)[number];
export type AudienceVisibilityAdminAction = (typeof AUDIENCE_VISIBILITY_ADMIN_ACTIONS)[number];
export type AudienceVisibilityMutationAction = (typeof AUDIENCE_VISIBILITY_MUTATION_ACTIONS)[number];
export type AudienceVisibilityTab = (typeof AUDIENCE_VISIBILITY_TABS)[number];

export type AudienceVisibilityPrincipal = {
  role: "" | "viewer" | "editor" | "approver" | "owner";
  capabilities: AudienceVisibilityCapability[];
};

export type AudienceVisibilityAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  principal: AudienceVisibilityPrincipal;
  actions: AudienceVisibilityAdminAction[];
};

export type AudienceVisibilityRule = {
  genders: AudienceVisibilityGender[];
  visible_to: AudienceVisibilityValue[];
};

export type AudienceVisibilityGroup = {
  id: string;
  key: string;
  labels: { en: string; hu: string };
  rules: AudienceVisibilityRule[];
  legacy_segment: string;
  sort_order: number;
  active: boolean;
  protected: boolean;
  revision: number;
  editable_fields: string[];
};

export type AudienceVisibilityRetirementManifest = {
  sha256: string;
  matching_orientation: "retired";
  layer1_intent: "retired";
  legacy_catalogue_types: string[];
  profile_questions: Array<{
    key: "dick_size" | "circumcision" | "sexual_position" | "safer_sex";
    labels: { en: string; hu: string };
    reason: "sex_or_anatomy";
    state: "retired";
  }>;
  retained_questions: Array<{
    key: "body_hair";
    labels: { en: "Body hair"; hu: "Testszőrzet" };
    state: "active";
    change: "neutral_general_all_groups";
  }>;
};

export type AudienceVisibilityIntent = {
  key: string;
  labels: { en: string; hu: string };
  sort_order: number;
  archived: boolean;
};

export type AudienceVisibilityIntents = {
  schema_version: 2;
  title: { en: string; hu: string };
  intents_revision: number;
  selection_min: 0;
  selection_max: number;
  items: AudienceVisibilityIntent[];
};

export type AudienceVisibilityCatalog = {
  contract_version: 1;
  gender_values: ["man", "woman", "nonbinary"];
  visible_to_values: ["male", "female", "both"];
  groups: AudienceVisibilityGroup[];
  group_manifest_sha256: string;
  retirement_manifest: AudienceVisibilityRetirementManifest;
  intents: AudienceVisibilityIntents;
};

export type AudienceVisibilityMemberDetail = {
  contract_version: 1;
  uid: number;
  gender: AudienceVisibilityGender | null;
  visible_to: AudienceVisibilityValue;
  revision: number;
  group: null | { id: string; key: string; legacy_segment: string };
};

export type AudienceVisibilityGroupMutation = {
  contract_version: 1;
  group: AudienceVisibilityGroup;
  replayed: boolean;
};

export type AudienceVisibilityIntentMutation = {
  contract_version: 1;
  intents: AudienceVisibilityIntents;
  replayed: boolean;
};

export type AudienceVisibilityConflict =
  | { kind: "group"; group: AudienceVisibilityGroup }
  | { kind: "intents"; intents: AudienceVisibilityIntents };

type JsonObject = Record<string, unknown>;

const GROUP_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const MONGO_ID = /^[0-9a-f]{24}$/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PROTECTED_EDITABLE_FIELDS = ["labels", "sort_order"] as const;
const CUSTOM_EDITABLE_FIELDS = ["key", "labels", "rules", "sort_order", "active"] as const;

const PROTECTED_GROUPS: ReadonlyArray<{
  key: string;
  gender: AudienceVisibilityGender;
  visible_to: AudienceVisibilityValue;
  legacy_segment: string;
}> = [
  { key: "male_for_male", gender: "man", visible_to: "male", legacy_segment: "male_gay" },
  { key: "male_for_female", gender: "man", visible_to: "female", legacy_segment: "male_hetero" },
  { key: "male_for_both", gender: "man", visible_to: "both", legacy_segment: "male_bisexual" },
  { key: "female_for_male", gender: "woman", visible_to: "male", legacy_segment: "female_hetero" },
  { key: "female_for_female", gender: "woman", visible_to: "female", legacy_segment: "female_lesbian" },
  { key: "female_for_both", gender: "woman", visible_to: "both", legacy_segment: "female_bisexual" },
  { key: "nonbinary_for_both", gender: "nonbinary", visible_to: "both", legacy_segment: "other" },
];

const RETIRED_QUESTIONS = [
  { key: "dick_size", en: "Penis size", hu: "Péniszméret" },
  { key: "circumcision", en: "Circumcision", hu: "Körülmetélés" },
  { key: "sexual_position", en: "Position", hu: "Pozíció" },
  { key: "safer_sex", en: "Safer sex", hu: "Biztonságosabb szex" },
] as const;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function exactObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? source
    : null;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function canonicalText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string" || value !== value.trim() || value !== value.normalize("NFC") || hasUnsafeText(value)) {
    return null;
  }
  const length = [...value].length;
  return length >= minimum && length <= maximum ? value : null;
}

function localizedPair(value: unknown, maximum: number): { en: string; hu: string } | null {
  const source = exactObject(value, ["en", "hu"]);
  const en = canonicalText(source?.en, 1, maximum);
  const hu = canonicalText(source?.hu, 1, maximum);
  return en && hu && en.replace(/\s+/gu, " ") === en && hu.replace(/\s+/gu, " ") === hu
    ? { en, hu }
    : null;
}

function orderedUnique<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((entry) => oneOf(entry, canonical));
  if (rows.some((entry) => entry === null)) return null;
  const parsed = rows as T[number][];
  if (new Set(parsed).size !== parsed.length) return null;
  const expected = canonical.filter((entry) => parsed.includes(entry));
  return expected.length === parsed.length
    && expected.every((entry, index) => entry === parsed[index])
    ? parsed
    : null;
}

function exactOrdered(value: unknown, expected: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.length !== expected.length) return null;
  return value.every((entry, index) => entry === expected[index]) ? [...expected] : null;
}

function visibilityRule(value: unknown): AudienceVisibilityRule | null {
  const source = exactObject(value, ["genders", "visible_to"]);
  const genders = orderedUnique(source?.genders, AUDIENCE_VISIBILITY_GENDERS);
  const visibleTo = orderedUnique(source?.visible_to, AUDIENCE_VISIBILITY_VALUES);
  if (!genders || genders.length === 0 || !visibleTo || visibleTo.length === 0) return null;
  if (genders.includes("nonbinary") && (visibleTo.length !== 1 || visibleTo[0] !== "both")) return null;
  return { genders, visible_to: visibleTo };
}

function visibilityGroup(value: unknown): AudienceVisibilityGroup | null {
  const source = exactObject(value, [
    "id", "key", "labels", "rules", "legacy_segment", "sort_order",
    "active", "protected", "revision", "editable_fields",
  ]);
  const id = typeof source?.id === "string" && MONGO_ID.test(source.id) ? source.id : null;
  const key = typeof source?.key === "string" && GROUP_KEY.test(source.key) ? source.key : null;
  const labels = localizedPair(source?.labels, 80);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  const revision = integer(source?.revision, 1, 2_147_483_647);
  if (!id || !key || !labels || !Array.isArray(source?.rules) || source.rules.length < 1
    || source.rules.length > 20 || sortOrder === null || revision === null
    || typeof source.active !== "boolean" || typeof source.protected !== "boolean"
    || typeof source.legacy_segment !== "string") return null;
  const rules = source.rules.map(visibilityRule);
  if (rules.some((rule) => rule === null)) return null;
  const parsedRules = rules as AudienceVisibilityRule[];
  const ruleFingerprints = parsedRules.map((rule) => JSON.stringify(rule));
  if (new Set(ruleFingerprints).size !== ruleFingerprints.length) return null;

  const protectedDefinition = PROTECTED_GROUPS.find((row) => row.key === key);
  const expectedEditable = source.protected ? PROTECTED_EDITABLE_FIELDS : CUSTOM_EDITABLE_FIELDS;
  if (!exactOrdered(source.editable_fields, expectedEditable)) return null;
  if (source.protected) {
    if (!protectedDefinition || source.active !== true || parsedRules.length !== 1
      || parsedRules[0].genders.length !== 1 || parsedRules[0].genders[0] !== protectedDefinition.gender
      || parsedRules[0].visible_to.length !== 1 || parsedRules[0].visible_to[0] !== protectedDefinition.visible_to
      || source.legacy_segment !== protectedDefinition.legacy_segment) return null;
  } else if (protectedDefinition || source.legacy_segment !== "") {
    return null;
  }

  return {
    id,
    key,
    labels,
    rules: parsedRules,
    legacy_segment: source.legacy_segment,
    sort_order: sortOrder,
    active: source.active,
    protected: source.protected,
    revision,
    editable_fields: [...expectedEditable],
  };
}

function sortedRows<T extends { sort_order: number; key: string }>(rows: T[]): boolean {
  return rows.every((row, index) => index === 0
    || rows[index - 1].sort_order < row.sort_order
    || (rows[index - 1].sort_order === row.sort_order && rows[index - 1].key < row.key));
}

function retirementManifest(value: unknown): AudienceVisibilityRetirementManifest | null {
  const source = exactObject(value, [
    "sha256", "matching_orientation", "layer1_intent", "legacy_catalogue_types",
    "profile_questions", "retained_questions",
  ]);
  if (typeof source?.sha256 !== "string" || !SHA256.test(source.sha256)
    || source.matching_orientation !== "retired" || source.layer1_intent !== "retired"
    || !exactOrdered(source.legacy_catalogue_types, AUDIENCE_VISIBILITY_LEGACY_TYPES)
    || !Array.isArray(source.profile_questions) || source.profile_questions.length !== RETIRED_QUESTIONS.length
    || !Array.isArray(source.retained_questions) || source.retained_questions.length !== 1) return null;

  const questions: AudienceVisibilityRetirementManifest["profile_questions"] = [];
  for (const [index, expected] of RETIRED_QUESTIONS.entries()) {
    const row = exactObject(source.profile_questions[index], ["key", "labels", "reason", "state"]);
    const labels = localizedPair(row?.labels, 80);
    if (row?.key !== expected.key || labels?.en !== expected.en || labels.hu !== expected.hu
      || row.reason !== "sex_or_anatomy" || row.state !== "retired") return null;
    questions.push({ key: expected.key, labels, reason: "sex_or_anatomy", state: "retired" });
  }
  const retained = exactObject(source.retained_questions[0], ["key", "labels", "state", "change"]);
  const retainedLabels = localizedPair(retained?.labels, 80);
  if (retained?.key !== "body_hair" || retainedLabels?.en !== "Body hair"
    || retainedLabels.hu !== "Testszőrzet" || retained.state !== "active"
    || retained.change !== "neutral_general_all_groups") return null;

  return {
    sha256: source.sha256,
    matching_orientation: "retired",
    layer1_intent: "retired",
    legacy_catalogue_types: [...AUDIENCE_VISIBILITY_LEGACY_TYPES],
    profile_questions: questions,
    retained_questions: [{
      key: "body_hair",
      labels: { en: "Body hair", hu: "Testszőrzet" },
      state: "active",
      change: "neutral_general_all_groups",
    }],
  };
}

function visibilityIntent(value: unknown): AudienceVisibilityIntent | null {
  const source = exactObject(value, ["key", "labels", "sort_order", "archived"]);
  const key = typeof source?.key === "string" && GROUP_KEY.test(source.key) ? source.key : null;
  const labels = localizedPair(source?.labels, 180);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  return source && key && labels && sortOrder !== null && typeof source.archived === "boolean"
    ? { key, labels, sort_order: sortOrder, archived: source.archived }
    : null;
}

export function audienceVisibilityIntents(value: unknown): AudienceVisibilityIntents | null {
  const source = exactObject(value, [
    "schema_version", "title", "intents_revision", "selection_min", "selection_max", "items",
  ]);
  const title = localizedPair(source?.title, 180);
  const revision = integer(source?.intents_revision, 1, 2_147_483_647);
  const maximum = integer(source?.selection_max, 1, 5);
  if (source?.schema_version !== 2 || title?.en !== "What are you looking for?"
    || title.hu !== "Mit keresel?" || revision === null || source.selection_min !== 0
    || maximum === null || !Array.isArray(source.items) || source.items.length < 14
    || source.items.length > 1000) return null;
  const items = source.items.map(visibilityIntent);
  if (items.some((item) => item === null)) return null;
  const parsedItems = items as AudienceVisibilityIntent[];
  if (!sortedRows(parsedItems) || new Set(parsedItems.map((item) => item.key)).size !== parsedItems.length
    || AUDIENCE_VISIBILITY_INITIAL_INTENT_KEYS.some((key) => !parsedItems.some((item) => item.key === key))) return null;
  return {
    schema_version: 2,
    title: { en: title.en, hu: title.hu },
    intents_revision: revision,
    selection_min: 0,
    selection_max: maximum,
    items: parsedItems,
  };
}

function catalogData(value: unknown): AudienceVisibilityCatalog | null {
  const source = exactObject(value, [
    "contract_version", "gender_values", "visible_to_values", "groups",
    "group_manifest_sha256", "retirement_manifest", "intents",
  ]);
  if (source?.contract_version !== 1
    || !exactOrdered(source.gender_values, AUDIENCE_VISIBILITY_GENDERS)
    || !exactOrdered(source.visible_to_values, AUDIENCE_VISIBILITY_VALUES)
    || !Array.isArray(source.groups) || source.groups.length < PROTECTED_GROUPS.length
    || source.groups.length > 1000 || typeof source.group_manifest_sha256 !== "string"
    || !SHA256.test(source.group_manifest_sha256)) return null;
  const groups = source.groups.map(visibilityGroup);
  const retirement = retirementManifest(source.retirement_manifest);
  const intents = audienceVisibilityIntents(source.intents);
  if (groups.some((group) => group === null) || !retirement || !intents) return null;
  const parsedGroups = groups as AudienceVisibilityGroup[];
  const ids = parsedGroups.map((group) => group.id);
  const keys = parsedGroups.map((group) => group.key);
  const protectedKeys = parsedGroups.filter((group) => group.protected).map((group) => group.key);
  if (!sortedRows(parsedGroups) || new Set(ids).size !== ids.length || new Set(keys).size !== keys.length
    || !exactOrdered(protectedKeys, PROTECTED_GROUPS.map((row) => row.key))) return null;
  return {
    contract_version: 1,
    gender_values: [...AUDIENCE_VISIBILITY_GENDERS],
    visible_to_values: [...AUDIENCE_VISIBILITY_VALUES],
    groups: parsedGroups,
    group_manifest_sha256: source.group_manifest_sha256,
    retirement_manifest: retirement,
    intents,
  };
}

function principal(value: unknown): AudienceVisibilityPrincipal | null {
  const source = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(source?.role, ["", "viewer", "editor", "approver", "owner"] as const);
  const capabilities = orderedUnique(source?.capabilities, AUDIENCE_VISIBILITY_CAPABILITIES);
  if (role === null || !capabilities) return null;
  const expected = role === ""
    ? []
    : role === "viewer"
      ? AUDIENCE_VISIBILITY_CAPABILITIES.slice(0, 2)
      : [...AUDIENCE_VISIBILITY_CAPABILITIES];
  return exactOrdered(capabilities, expected) ? { role, capabilities } : null;
}

export const AUDIENCE_VISIBILITY_ACTION_CAPABILITY: Record<
  AudienceVisibilityAdminAction,
  AudienceVisibilityCapability
> = {
  audience_visibility_catalog: "audience_visibility_catalog_read",
  audience_visibility_member_detail: "audience_visibility_member_read",
  save_audience_visibility_group: "audience_visibility_group_write",
  archive_audience_visibility_group: "audience_visibility_group_write",
  save_audience_visibility_intent: "audience_visibility_intent_write",
  archive_audience_visibility_intent: "audience_visibility_intent_write",
  set_audience_visibility_intent_limit: "audience_visibility_intent_write",
};

export function audienceVisibilityAdminMe(value: unknown): AudienceVisibilityAdminMe | null {
  const source = exactObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
  const parsedPrincipal = principal(source?.principal);
  if (source?.contract_version !== 1 || typeof source.contract_ready !== "boolean" || !parsedPrincipal) return null;
  const expectedActions = source.contract_ready
    ? AUDIENCE_VISIBILITY_ADMIN_ACTIONS.filter((action) => parsedPrincipal.capabilities.includes(
      AUDIENCE_VISIBILITY_ACTION_CAPABILITY[action],
    ))
    : [];
  if (!exactOrdered(source.actions, expectedActions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    principal: parsedPrincipal,
    actions: [...expectedActions],
  };
}

export function audienceVisibilityProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!(AUDIENCE_VISIBILITY_ADMIN_ACTIONS as readonly string[]).includes(action)) return null;
  const block = audienceVisibilityAdminMe(record(membership)?.audience_visibility);
  const typedAction = action as AudienceVisibilityAdminAction;
  return Boolean(block?.contract_ready
    && block.actions.includes(typedAction)
    && block.principal.capabilities.includes(AUDIENCE_VISIBILITY_ACTION_CAPABILITY[typedAction]));
}

function successData<T>(value: unknown, parser: (data: unknown) => T | null): T | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? parser(envelope.data) : null;
}

export function audienceVisibilityCatalogResponse(value: unknown): AudienceVisibilityCatalog | null {
  return successData(value, catalogData);
}

export function audienceVisibilityGroupMutationResponse(value: unknown): AudienceVisibilityGroupMutation | null {
  return successData(value, (data) => {
    const source = exactObject(data, ["contract_version", "group", "replayed"]);
    const group = visibilityGroup(source?.group);
    return source?.contract_version === 1 && group && typeof source.replayed === "boolean"
      ? { contract_version: 1, group, replayed: source.replayed }
      : null;
  });
}

export function audienceVisibilityIntentMutationResponse(value: unknown): AudienceVisibilityIntentMutation | null {
  return successData(value, (data) => {
    const source = exactObject(data, ["contract_version", "intents", "replayed"]);
    const intents = audienceVisibilityIntents(source?.intents);
    return source?.contract_version === 1 && intents && typeof source.replayed === "boolean"
      ? { contract_version: 1, intents, replayed: source.replayed }
      : null;
  });
}

export function audienceVisibilityMemberDetailResponse(value: unknown): AudienceVisibilityMemberDetail | null {
  return successData(value, (data) => {
    const source = exactObject(data, ["contract_version", "uid", "gender", "visible_to", "revision", "group"]);
    const uid = integer(source?.uid, 1, 2_147_483_647);
    const gender = source?.gender === null ? null : oneOf(source?.gender, AUDIENCE_VISIBILITY_GENDERS);
    const visibleTo = oneOf(source?.visible_to, AUDIENCE_VISIBILITY_VALUES);
    const revision = integer(source?.revision, 1, 2_147_483_647);
    if (source?.contract_version !== 1 || uid === null || gender === null && source.gender !== null
      || !visibleTo || revision === null) return null;
    if (gender === null) {
      return source.group === null && visibleTo === "both"
        ? { contract_version: 1, uid, gender: null, visible_to: "both", revision, group: null }
        : null;
    }
    const group = exactObject(source.group, ["id", "key", "legacy_segment"]);
    const definition = PROTECTED_GROUPS.find((row) => row.gender === gender && row.visible_to === visibleTo);
    if (!definition || typeof group?.id !== "string" || !MONGO_ID.test(group.id)
      || group.key !== definition.key || group.legacy_segment !== definition.legacy_segment) return null;
    return {
      contract_version: 1,
      uid,
      gender,
      visible_to: visibleTo,
      revision,
      group: { id: group.id, key: definition.key, legacy_segment: definition.legacy_segment },
    };
  });
}

export function audienceVisibilityConflict(value: unknown): AudienceVisibilityConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409 || envelope.error !== "audience-visibility-conflict") return null;
  const groupData = exactObject(envelope.data, ["contract_version", "group"]);
  const group = visibilityGroup(groupData?.group);
  if (groupData?.contract_version === 1 && group) return { kind: "group", group };
  const intentsData = exactObject(envelope.data, ["contract_version", "intents"]);
  const intents = audienceVisibilityIntents(intentsData?.intents);
  return intentsData?.contract_version === 1 && intents ? { kind: "intents", intents } : null;
}

export const AUDIENCE_VISIBILITY_ERROR_STATUSES: Readonly<Record<string, number>> = {
  unauthorized: 401,
  "auth-required": 401,
  "bad-origin": 403,
  "not-found": 404,
  "admin-write-required": 403,
  "invalid-input": 400,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
  "invalid-core-response": 502,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "catalog-admin-capability-required": 403,
  "audience-visibility-contract-version-required": 422,
  "audience-visibility-contract-version-invalid": 422,
  "audience-visibility-request-invalid": 422,
  "audience-visibility-request-id-invalid": 422,
  "audience-visibility-request-id-conflict": 409,
  "audience-visibility-request-in-progress": 409,
  "audience-visibility-group-invalid": 422,
  "audience-visibility-group-not-found": 404,
  "audience-visibility-group-protected": 403,
  "audience-visibility-conflict": 409,
  "audience-visibility-member-not-found": 404,
  "audience-visibility-stored-invalid": 503,
  "audience-visibility-schema-unavailable": 503,
  "audience-visibility-write-failed": 503,
  "audience-visibility-audit-write-failed": 503,
};

export function audienceVisibilityError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && AUDIENCE_VISIBILITY_ERROR_STATUSES[error] === envelope.status_code ? error : null;
}

/** Unknown, in-progress, transport, malformed, and server failures keep the exact command. */
export function audienceVisibilityShouldRetainMutation(error: string | null): boolean {
  return error === null
    || error === "audience-visibility-request-in-progress"
    || error === "audience-visibility-write-failed"
    || (AUDIENCE_VISIBILITY_ERROR_STATUSES[error] ?? 0) >= 500;
}

function exactBody(body: JsonObject, keys: readonly string[]): JsonObject | null {
  return exactObject(body, keys);
}

function requestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

function auditReason(value: unknown): string | null {
  return canonicalText(value, 1, 300);
}

function parseCanonicalMaterial<T>(
  value: unknown,
  parser: (candidate: unknown) => T | null,
): T | null {
  if (typeof value !== "string") return parser(value);
  try {
    const decoded = JSON.parse(value) as unknown;
    const parsed = parser(decoded);
    return parsed && JSON.stringify(parsed) === value ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedGroupMaterial(value: unknown): Pick<AudienceVisibilityGroup, "key" | "labels" | "rules" | "sort_order" | "active"> | null {
  const source = exactObject(value, ["key", "labels", "rules", "sort_order", "active"]);
  const key = typeof source?.key === "string" && GROUP_KEY.test(source.key) ? source.key : null;
  const labels = localizedPair(source?.labels, 80);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  if (!source || !key || !labels || sortOrder === null || typeof source.active !== "boolean"
    || !Array.isArray(source.rules) || source.rules.length < 1 || source.rules.length > 20) return null;
  const rules = source.rules.map(visibilityRule);
  if (rules.some((rule) => rule === null)) return null;
  const parsedRules = rules as AudienceVisibilityRule[];
  if (new Set(parsedRules.map((rule) => JSON.stringify(rule))).size !== parsedRules.length) return null;
  return { key, labels, rules: parsedRules, sort_order: sortOrder, active: source.active };
}

function normalizeCatalogRead(body: JsonObject): JsonObject | null {
  const source = exactBody(body, ["contract_version"]);
  return source?.contract_version === 1 ? Object.assign(Object.create(null), { contract_version: 1 }) : null;
}

function normalizeMemberRead(body: JsonObject): JsonObject | null {
  const source = exactBody(body, ["contract_version", "uid"]);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  return source?.contract_version === 1 && uid !== null
    ? Object.assign(Object.create(null), { contract_version: 1, uid })
    : null;
}

function normalizeGroupSave(body: JsonObject): JsonObject | null {
  const source = exactBody(body, [
    "contract_version", "request_id", "expected_revision", "audit_reason", "id",
    "group_key", "labels_json", "rules_json", "sort_order", "active",
  ]);
  const id = source?.id === "" ? "" : typeof source?.id === "string" && MONGO_ID.test(source.id) ? source.id : null;
  const revision = integer(source?.expected_revision, 0, 2_147_483_647);
  const request = requestId(source?.request_id);
  const reason = auditReason(source?.audit_reason);
  const key = typeof source?.group_key === "string" && GROUP_KEY.test(source.group_key) ? source.group_key : null;
  const labels = parseCanonicalMaterial(source?.labels_json, (value) => localizedPair(value, 80));
  const rules = parseCanonicalMaterial(source?.rules_json, (value) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
    const parsed = value.map(visibilityRule);
    if (parsed.some((rule) => rule === null)) return null;
    const rows = parsed as AudienceVisibilityRule[];
    return new Set(rows.map((rule) => JSON.stringify(rule))).size === rows.length ? rows : null;
  });
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  if (source?.contract_version !== 1 || id === null || revision === null || !request || !reason || !key
    || !labels || !rules || sortOrder === null || typeof source.active !== "boolean"
    || (id === "" ? revision !== 0 : revision < 1)) return null;
  return Object.assign(Object.create(null), {
    contract_version: 1,
    request_id: request,
    expected_revision: revision,
    audit_reason: reason,
    id,
    group_key: key,
    labels_json: JSON.stringify(labels),
    rules_json: JSON.stringify(rules),
    sort_order: sortOrder,
    active: source.active,
  });
}

function normalizeGroupArchive(body: JsonObject): JsonObject | null {
  const source = exactBody(body, [
    "contract_version", "request_id", "expected_revision", "audit_reason", "id", "archived",
  ]);
  const request = requestId(source?.request_id);
  const revision = integer(source?.expected_revision, 1, 2_147_483_647);
  const reason = auditReason(source?.audit_reason);
  return source?.contract_version === 1 && request && revision !== null && reason
    && typeof source.id === "string" && MONGO_ID.test(source.id) && typeof source.archived === "boolean"
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      request_id: request,
      expected_revision: revision,
      audit_reason: reason,
      id: source.id,
      archived: source.archived,
    })
    : null;
}

function normalizeIntentSave(body: JsonObject): JsonObject | null {
  const source = exactBody(body, [
    "contract_version", "request_id", "expected_intents_revision", "audit_reason",
    "key", "labels_json", "sort_order",
  ]);
  const request = requestId(source?.request_id);
  const revision = integer(source?.expected_intents_revision, 1, 2_147_483_647);
  const reason = auditReason(source?.audit_reason);
  const key = typeof source?.key === "string" && GROUP_KEY.test(source.key) ? source.key : null;
  const labels = parseCanonicalMaterial(source?.labels_json, (value) => localizedPair(value, 180));
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  return source?.contract_version === 1 && request && revision !== null && reason && key && labels && sortOrder !== null
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      request_id: request,
      expected_intents_revision: revision,
      audit_reason: reason,
      key,
      labels_json: JSON.stringify(labels),
      sort_order: sortOrder,
    })
    : null;
}

function normalizeIntentArchive(body: JsonObject): JsonObject | null {
  const source = exactBody(body, [
    "contract_version", "request_id", "expected_intents_revision", "audit_reason", "key", "archived",
  ]);
  const request = requestId(source?.request_id);
  const revision = integer(source?.expected_intents_revision, 1, 2_147_483_647);
  const reason = auditReason(source?.audit_reason);
  return source?.contract_version === 1 && request && revision !== null && reason
    && typeof source.key === "string" && GROUP_KEY.test(source.key) && typeof source.archived === "boolean"
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      request_id: request,
      expected_intents_revision: revision,
      audit_reason: reason,
      key: source.key,
      archived: source.archived,
    })
    : null;
}

function normalizeIntentLimit(body: JsonObject): JsonObject | null {
  const source = exactBody(body, [
    "contract_version", "request_id", "expected_intents_revision", "audit_reason", "selection_max",
  ]);
  const request = requestId(source?.request_id);
  const revision = integer(source?.expected_intents_revision, 1, 2_147_483_647);
  const reason = auditReason(source?.audit_reason);
  const maximum = integer(source?.selection_max, 1, 5);
  return source?.contract_version === 1 && request && revision !== null && reason && maximum !== null
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      request_id: request,
      expected_intents_revision: revision,
      audit_reason: reason,
      selection_max: maximum,
    })
    : null;
}

/** `undefined` is another family, `null` is refused, and an object alone may reach Core. */
export function normalizeAudienceVisibilityProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(AUDIENCE_VISIBILITY_ADMIN_ACTIONS as readonly string[]).includes(action)) return undefined;
  switch (action as AudienceVisibilityAdminAction) {
    case "audience_visibility_catalog": return normalizeCatalogRead(body);
    case "audience_visibility_member_detail": return normalizeMemberRead(body);
    case "save_audience_visibility_group": return normalizeGroupSave(body);
    case "archive_audience_visibility_group": return normalizeGroupArchive(body);
    case "save_audience_visibility_intent": return normalizeIntentSave(body);
    case "archive_audience_visibility_intent": return normalizeIntentArchive(body);
    case "set_audience_visibility_intent_limit": return normalizeIntentLimit(body);
  }
}

export type AudienceVisibilityPendingMutation = {
  version: 1;
  action: AudienceVisibilityMutationAction;
  target: string;
  payload: JsonObject;
};

export const AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY = "friending.audience-visibility.pending-mutation.v1";

function audienceVisibilityPendingTarget(
  action: AudienceVisibilityMutationAction,
  payload: JsonObject,
): string | null {
  switch (action) {
    case "save_audience_visibility_group":
      return payload.id === "" && typeof payload.group_key === "string"
        ? `new:${payload.group_key}`
        : typeof payload.id === "string" ? payload.id : null;
    case "archive_audience_visibility_group":
      return typeof payload.id === "string" ? payload.id : null;
    case "save_audience_visibility_intent":
    case "archive_audience_visibility_intent":
      return typeof payload.key === "string" ? payload.key : null;
    case "set_audience_visibility_intent_limit":
      return "selection-max";
  }
}

export function audienceVisibilityPendingMutation(
  action: AudienceVisibilityMutationAction,
  target: string,
  body: JsonObject,
): AudienceVisibilityPendingMutation | null {
  const parsedTarget = canonicalText(target, 1, 160);
  const payload = normalizeAudienceVisibilityProxyBody(action, body);
  const expectedTarget = payload ? audienceVisibilityPendingTarget(action, payload) : null;
  return parsedTarget && payload && parsedTarget === expectedTarget
    ? { version: 1, action, target: parsedTarget, payload }
    : null;
}

export function audienceVisibilityPendingFrom(value: unknown): AudienceVisibilityPendingMutation | null {
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  const action = oneOf(source?.action, AUDIENCE_VISIBILITY_MUTATION_ACTIONS);
  const target = canonicalText(source?.target, 1, 160);
  return source?.version === 1 && action && target
    ? audienceVisibilityPendingMutation(action, target, record(source.payload) ?? {})
    : null;
}

export async function audienceVisibilityPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: AudienceVisibilityPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = audienceVisibilityPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

function responseRevisionConverges(value: number, expected: unknown, creating = false): boolean {
  const parsed = integer(expected, creating ? 0 : 1, 2_147_483_647);
  if (parsed === null) return false;
  return creating ? value === 1 : value === parsed || value === parsed + 1;
}

/** A success clears durable identity only when its resource proves the exact command material. */
export function audienceVisibilityMutationConverged(
  pending: AudienceVisibilityPendingMutation,
  result: AudienceVisibilityGroupMutation | AudienceVisibilityIntentMutation,
): boolean {
  const canonical = audienceVisibilityPendingFrom(pending);
  if (!canonical) return false;
  const payload = canonical.payload;
  if (canonical.action === "save_audience_visibility_group" && "group" in result) {
    const creating = payload.id === "";
    return (creating ? result.group.key === payload.group_key : result.group.id === payload.id)
      && result.group.key === payload.group_key
      && JSON.stringify(result.group.labels) === payload.labels_json
      && JSON.stringify(result.group.rules) === payload.rules_json
      && result.group.sort_order === payload.sort_order
      && result.group.active === payload.active
      && responseRevisionConverges(result.group.revision, payload.expected_revision, creating);
  }
  if (canonical.action === "archive_audience_visibility_group" && "group" in result) {
    return result.group.id === payload.id
      && result.group.active === !payload.archived
      && responseRevisionConverges(result.group.revision, payload.expected_revision);
  }
  if (!("intents" in result)
    || !responseRevisionConverges(result.intents.intents_revision, payload.expected_intents_revision)) {
    return false;
  }
  if (canonical.action === "set_audience_visibility_intent_limit") {
    return result.intents.selection_max === payload.selection_max;
  }
  const item = result.intents.items.find((row) => row.key === payload.key);
  if (!item) return false;
  return canonical.action === "archive_audience_visibility_intent"
    ? item.archived === payload.archived
    : JSON.stringify(item.labels) === payload.labels_json && item.sort_order === payload.sort_order;
}

/** A 409 is adopted only when its canonical resource belongs to the saved command target. */
export function audienceVisibilityConflictMatchesPending(
  pending: AudienceVisibilityPendingMutation,
  conflict: AudienceVisibilityConflict,
): boolean {
  const canonical = audienceVisibilityPendingFrom(pending);
  if (!canonical) return false;
  if (canonical.action === "save_audience_visibility_group") {
    if (conflict.kind !== "group") return false;
    return canonical.payload.id === ""
      ? conflict.group.key === canonical.payload.group_key
      : conflict.group.id === canonical.payload.id;
  }
  if (canonical.action === "archive_audience_visibility_group") {
    return conflict.kind === "group" && conflict.group.id === canonical.payload.id;
  }
  return conflict.kind === "intents";
}

export function audienceVisibilityTab(value: unknown): AudienceVisibilityTab {
  return oneOf(value, AUDIENCE_VISIBILITY_TABS) ?? "groups";
}

/** Exported for focused tests and draft validation; never relaxes Core's final authority. */
export function audienceVisibilityGroupDraft(value: unknown) {
  return normalizedGroupMaterial(value);
}

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

/**
 * T-653, contract amendment "Amended by `opus-api-t653`" §2a. The member
 * identity write is published in its own `admin_me` block, NOT as a fifth
 * capability or an eighth action above.
 *
 * `exactOrdered()` pins both arrays of the `audience_visibility` block, so a
 * Core that appended to either one would make `audienceVisibilityAdminMe()`
 * return `null` on every deployed build — darkening the whole workspace and
 * refusing the seven actions that already work. Core therefore serves a sibling
 * `admin_me.audience_visibility_identity` of the identical shape, and these two
 * arrays are pinned exactly the same way for it.
 */
export const AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES = [
  "audience_visibility_member_write",
] as const;
export const AUDIENCE_VISIBILITY_IDENTITY_ACTIONS = [
  "save_audience_visibility_member_identity",
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

/** D-095 (T-632): the dating-specific profile questions Core retires from Friending; served order, any subset. */
export const AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS = [
  "piercings",
  "tattoos",
  "beard",
  "sexual_position",
  "safer_sex",
  "circumcision",
  "dick_size",
  "body_hair",
  "hair_color",
  "eye_color",
  "body_type",
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
export type AudienceVisibilityIdentityCapability =
  (typeof AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES)[number];
export type AudienceVisibilityIdentityAction = (typeof AUDIENCE_VISIBILITY_IDENTITY_ACTIONS)[number];
export type AudienceVisibilityMutationAction = (typeof AUDIENCE_VISIBILITY_MUTATION_ACTIONS)[number];
export type AudienceVisibilityTab = (typeof AUDIENCE_VISIBILITY_TABS)[number];
export type AudienceVisibilityRetiredProfileQuestionKey =
  (typeof AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS)[number];

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

export type AudienceVisibilityIdentityPrincipal = {
  role: "" | "viewer" | "editor" | "approver" | "owner";
  capabilities: AudienceVisibilityIdentityCapability[];
};

export type AudienceVisibilityIdentityAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  principal: AudienceVisibilityIdentityPrincipal;
  actions: AudienceVisibilityIdentityAction[];
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

export type AudienceVisibilityRetiredQuestion = {
  key: AudienceVisibilityRetiredProfileQuestionKey;
  labels: { en: string; hu: string };
  /** Served by the pre-T-632 manifest ("sex_or_anatomy"); optional on the T-632 one. */
  reason?: string;
  state: "retired";
};

/** Only the pre-T-632 manifest carries this row; T-634 removes it with the transition branch. */
export type AudienceVisibilityRetainedQuestion = {
  key: "body_hair";
  labels: { en: "Body hair"; hu: "Testszőrzet" };
  state: "active";
  change: "neutral_general_all_groups";
};

export type AudienceVisibilityRetirementManifest = {
  sha256: string;
  matching_orientation: "retired";
  layer1_intent: "retired";
  legacy_catalogue_types: string[];
  /** 1..11 rows in served order, keys within AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS, unique. */
  profile_questions: AudienceVisibilityRetiredQuestion[];
  /** Empty on the T-632 manifest; exactly the neutral body_hair row on the pre-T-632 one. */
  retained_questions: AudienceVisibilityRetainedQuestion[];
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

/**
 * The T-653 identity block of `audience_visibility_member_detail`.
 *
 * T-669 (D-103 §6.4) retires the detailed gender, so `identity_revision` — the
 * second optimistic axis — is the whole terminal block. A Core that predates
 * T-653 serves none of it and this reads `null`: the member row still decodes
 * and still renders read-only.
 *
 * `legacy_gender_detail` is NOT a console feature. It exists only because the
 * DEPLOYED Core (`364c89e8`) still requires `gender_detail` in the save body
 * (`AudienceVisibilityAdminPolicy::parseMemberIdentitySave` builds its field
 * list with `strictRequired`, which demands every listed field), while the
 * T-669 Core refuses the same key as retired. Carrying what was served lets the
 * save echo it back unchanged on the old Core and omit it on the new one, so
 * the console never rewrites a member's retired detail and never invents one.
 * `undefined` is the terminal Core; a string or `null` is the deployed one.
 */
export type AudienceVisibilityMemberIdentity = {
  /** `identity_v2.revision`; 0 means the member has no canonical document yet. */
  identity_revision: number;
  legacy_gender_detail?: string | null;
};

export type AudienceVisibilityMemberDetail = {
  contract_version: 1;
  uid: number;
  gender: AudienceVisibilityGender | null;
  visible_to: AudienceVisibilityValue;
  revision: number;
  group: null | { id: string; key: string; legacy_segment: string };
  identity: AudienceVisibilityMemberIdentity | null;
};

export type AudienceVisibilityMemberMutation = {
  contract_version: 1;
  member: AudienceVisibilityMemberDetail;
  replayed: boolean;
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
  | { kind: "intents"; intents: AudienceVisibilityIntents }
  | { kind: "member"; member: AudienceVisibilityMemberDetail };

type JsonObject = Record<string, unknown>;

const GROUP_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
/**
 * Shape only, and only for the RETIRED detail the deployed Core still serves
 * and still requires back. The vocabulary belonged to Core
 * (`IdentityV2Policy::genderDetails()`); pinning the 25 keys here would have
 * put a second authority in the browser. T-669 removes the console's control
 * for it entirely — this is what keeps a malformed served value from being
 * echoed back into a save.
 */
const GENDER_DETAIL = /^[a-z][a-z0-9_]{0,63}$/u;
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

// Pre-T-632 (D-019) manifest, matched exactly during the transition; T-634 deletes these pins with that branch.
const LEGACY_RETIRED_QUESTIONS = [
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

// Exact objects are reserved for browser-owned commands and persisted retry identities.
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

function requiredObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
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

function localizedPair(value: unknown, maximum: number, exact = false): { en: string; hu: string } | null {
  const source = exact ? exactObject(value, ["en", "hu"]) : requiredObject(value, ["en", "hu"]);
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

function visibilityRule(value: unknown, exact = false): AudienceVisibilityRule | null {
  const source = exact
    ? exactObject(value, ["genders", "visible_to"])
    : requiredObject(value, ["genders", "visible_to"]);
  const genders = orderedUnique(source?.genders, AUDIENCE_VISIBILITY_GENDERS);
  const visibleTo = orderedUnique(source?.visible_to, AUDIENCE_VISIBILITY_VALUES);
  if (!genders || genders.length === 0 || !visibleTo || visibleTo.length === 0) return null;
  if (genders.includes("nonbinary") && (visibleTo.length !== 1 || visibleTo[0] !== "both")) return null;
  return { genders, visible_to: visibleTo };
}

function visibilityGroup(value: unknown): AudienceVisibilityGroup | null {
  const source = requiredObject(value, [
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
  const rules = source.rules.map((rule) => visibilityRule(rule));
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

// T-632 row: key within the eleven, labels from the payload; reason/state are optional but may not contradict.
function retiredQuestion(value: unknown): AudienceVisibilityRetiredQuestion | null {
  const source = requiredObject(value, ["key", "labels"]);
  const key = oneOf(source?.key, AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS);
  const labels = localizedPair(source?.labels, 80);
  if (!source || !key || !labels) return null;
  if (Object.hasOwn(source, "state") && source.state !== "retired") return null;
  if (!Object.hasOwn(source, "reason")) return { key, labels, state: "retired" };
  const reason = canonicalText(source.reason, 1, 80);
  return reason ? { key, labels, reason, state: "retired" } : null;
}

// Pre-T-632 rows, exactly as Core published them under D-019.
function legacyRetiredQuestions(value: unknown[]): AudienceVisibilityRetiredQuestion[] | null {
  if (value.length !== LEGACY_RETIRED_QUESTIONS.length) return null;
  const questions: AudienceVisibilityRetiredQuestion[] = [];
  for (const [index, expected] of LEGACY_RETIRED_QUESTIONS.entries()) {
    const row = requiredObject(value[index], ["key", "labels", "reason", "state"]);
    const labels = localizedPair(row?.labels, 80);
    if (row?.key !== expected.key || labels?.en !== expected.en || labels.hu !== expected.hu
      || row.reason !== "sex_or_anatomy" || row.state !== "retired") return null;
    questions.push({ key: expected.key, labels, reason: "sex_or_anatomy", state: "retired" });
  }
  return questions;
}

function legacyRetainedQuestion(value: unknown): AudienceVisibilityRetainedQuestion | null {
  const retained = requiredObject(value, ["key", "labels", "state", "change"]);
  const labels = localizedPair(retained?.labels, 80);
  if (retained?.key !== "body_hair" || labels?.en !== "Body hair" || labels.hu !== "Testszőrzet"
    || retained.state !== "active" || retained.change !== "neutral_general_all_groups") return null;
  return {
    key: "body_hair",
    labels: { en: "Body hair", hu: "Testszőrzet" },
    state: "active",
    change: "neutral_general_all_groups",
  };
}

// Two shapes: the T-632 manifest (1..11 retired rows as served, nothing retained) and, until T-634,
// the pre-T-632 one (four exact rows plus the neutral body_hair row). An empty retained list selects the former.
function retirementManifest(value: unknown): AudienceVisibilityRetirementManifest | null {
  const source = requiredObject(value, [
    "sha256", "matching_orientation", "layer1_intent", "legacy_catalogue_types",
    "profile_questions", "retained_questions",
  ]);
  if (typeof source?.sha256 !== "string" || !SHA256.test(source.sha256)
    || source.matching_orientation !== "retired" || source.layer1_intent !== "retired"
    || !exactOrdered(source.legacy_catalogue_types, AUDIENCE_VISIBILITY_LEGACY_TYPES)
    || !Array.isArray(source.profile_questions) || source.profile_questions.length === 0
    || source.profile_questions.length > AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS.length
    || !Array.isArray(source.retained_questions) || source.retained_questions.length > 1) return null;

  let questions: AudienceVisibilityRetiredQuestion[] | null;
  let retained: AudienceVisibilityRetainedQuestion[];
  if (source.retained_questions.length === 0) {
    const rows = source.profile_questions.map(retiredQuestion);
    questions = rows.every((row: AudienceVisibilityRetiredQuestion | null) => row !== null)
      ? rows as AudienceVisibilityRetiredQuestion[]
      : null;
    retained = [];
  } else {
    questions = legacyRetiredQuestions(source.profile_questions);
    const row = legacyRetainedQuestion(source.retained_questions[0]);
    if (!row) return null;
    retained = [row];
  }
  if (!questions || new Set(questions.map((row) => row.key)).size !== questions.length) return null;

  return {
    sha256: source.sha256,
    matching_orientation: "retired",
    layer1_intent: "retired",
    legacy_catalogue_types: [...AUDIENCE_VISIBILITY_LEGACY_TYPES],
    profile_questions: questions,
    retained_questions: retained,
  };
}

function visibilityIntent(value: unknown): AudienceVisibilityIntent | null {
  const source = requiredObject(value, ["key", "labels", "sort_order", "archived"]);
  const key = typeof source?.key === "string" && GROUP_KEY.test(source.key) ? source.key : null;
  const labels = localizedPair(source?.labels, 180);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  return source && key && labels && sortOrder !== null && typeof source.archived === "boolean"
    ? { key, labels, sort_order: sortOrder, archived: source.archived }
    : null;
}

export function audienceVisibilityIntents(value: unknown): AudienceVisibilityIntents | null {
  const source = requiredObject(value, [
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
  const source = requiredObject(value, [
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
  const source = requiredObject(value, ["role", "capabilities"]);
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
  const source = requiredObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
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

/**
 * The sibling `admin_me.audience_visibility_identity` block (T-653 §2a).
 *
 * Same shape and the same exact-ordered pins as the block above, and tolerant
 * of the whole block being absent: a Core that predates the amendment simply
 * has no key here, this answers `null`, and the editor stays hidden.
 */
export function audienceVisibilityIdentityAdminMe(value: unknown): AudienceVisibilityIdentityAdminMe | null {
  const source = requiredObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
  const principalSource = requiredObject(source?.principal, ["role", "capabilities"]);
  const role = oneOf(principalSource?.role, ["", "viewer", "editor", "approver", "owner"] as const);
  const capabilities = orderedUnique(
    principalSource?.capabilities,
    AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES,
  );
  if (source?.contract_version !== 1 || typeof source.contract_ready !== "boolean"
    || role === null || !capabilities) return null;
  // Reading a member is a viewer affordance; changing one's canonical gender is
  // an editor one, exactly like the group and intent writes.
  const expectedCapabilities = role === "" || role === "viewer"
    ? []
    : [...AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES];
  if (!exactOrdered(capabilities, expectedCapabilities)) return null;
  const expectedActions = source.contract_ready && expectedCapabilities.length > 0
    ? [...AUDIENCE_VISIBILITY_IDENTITY_ACTIONS]
    : [];
  if (!exactOrdered(source.actions, expectedActions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    principal: { role, capabilities: [...expectedCapabilities] },
    actions: [...expectedActions],
  };
}

/** Whether the sibling block authorizes the one identity action it publishes. */
export function audienceVisibilityIdentityWriteAuthorized(membership: unknown): boolean {
  const block = audienceVisibilityIdentityAdminMe(record(membership)?.audience_visibility_identity);
  return Boolean(block?.contract_ready
    && block.actions.includes(AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0])
    && block.principal.capabilities.includes(AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES[0]));
}

export function audienceVisibilityProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if ((AUDIENCE_VISIBILITY_IDENTITY_ACTIONS as readonly string[]).includes(action)) {
    // Authorized ONLY by the sibling block, never by the top-level role and
    // never by the four-capability block beside it.
    return audienceVisibilityIdentityWriteAuthorized(membership);
  }
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
    const source = requiredObject(data, ["contract_version", "group", "replayed"]);
    const group = visibilityGroup(source?.group);
    return source?.contract_version === 1 && group && typeof source.replayed === "boolean"
      ? { contract_version: 1, group, replayed: source.replayed }
      : null;
  });
}

export function audienceVisibilityIntentMutationResponse(value: unknown): AudienceVisibilityIntentMutation | null {
  return successData(value, (data) => {
    const source = requiredObject(data, ["contract_version", "intents", "replayed"]);
    const intents = audienceVisibilityIntents(source?.intents);
    return source?.contract_version === 1 && intents && typeof source.replayed === "boolean"
      ? { contract_version: 1, intents, replayed: source.replayed }
      : null;
  });
}

/** The whole terminal block after T-669: one key, the second optimistic axis. */
const MEMBER_IDENTITY_KEYS = ["identity_revision"] as const;
/** The retired T-653 siblings the DEPLOYED Core still serves beside it. */
const MEMBER_IDENTITY_LEGACY_KEYS = ["gender_detail", "show_gender_detail"] as const;

/**
 * The T-653 block, decoded against BOTH served shapes.
 *
 * `identity_revision` alone is the T-669 Core; the same key with
 * `gender_detail` and `show_gender_detail` beside it is the deployed one. Both
 * decode. `{ identity: null }` is a Core that predates T-653 entirely — the
 * member row still decodes and the panel stays read-only, because without
 * `identity_revision` there is no second axis to guard a write with.
 *
 * The retired pair is still VALIDATED when served, and still all-or-none: a
 * half-served or malformed legacy pair fails the whole member decode, exactly
 * as it did before. What changed is that its ABSENCE is now the expected
 * terminal shape rather than a partial read.
 */
function memberIdentity(source: JsonObject): { identity: AudienceVisibilityMemberIdentity | null } | null {
  if (!MEMBER_IDENTITY_KEYS.every((key) => Object.hasOwn(source, key))) {
    // A pre-T-653 Core serves neither the axis nor the retired pair. A body
    // that carries the retired pair without the axis is not a shape any Core
    // ever served and cannot be guarded, so it fails closed.
    return MEMBER_IDENTITY_LEGACY_KEYS.some((key) => Object.hasOwn(source, key))
      ? null
      : { identity: null };
  }
  const revision = integer(source.identity_revision, 0, 2_147_483_647);
  if (revision === null) return null;
  const legacy = MEMBER_IDENTITY_LEGACY_KEYS.filter((key) => Object.hasOwn(source, key));
  if (legacy.length === 0) return { identity: { identity_revision: revision } };
  if (legacy.length !== MEMBER_IDENTITY_LEGACY_KEYS.length) return null;
  const raw = source.gender_detail;
  const detail = raw === null
    ? null
    : typeof raw === "string" && GENDER_DETAIL.test(raw) ? raw : undefined;
  const shown = source.show_gender_detail;
  if (detail === undefined || typeof shown !== "boolean") return null;
  // Core forces the disclosure toggle false when there is no detail to
  // disclose (`AudienceVisibilityAdminService::memberGenderDetail`), so the
  // pair cannot legitimately arrive as "no detail, shown".
  if (detail === null && shown) return null;
  return { identity: { identity_revision: revision, legacy_gender_detail: detail } };
}

function memberDetail(data: unknown): AudienceVisibilityMemberDetail | null {
  const source = requiredObject(data, ["contract_version", "uid", "gender", "visible_to", "revision", "group"]);
  if (!source) return null;
  const uid = integer(source.uid, 1, 2_147_483_647);
  const gender = source.gender === null ? null : oneOf(source.gender, AUDIENCE_VISIBILITY_GENDERS);
  const visibleTo = oneOf(source.visible_to, AUDIENCE_VISIBILITY_VALUES);
  const revision = integer(source.revision, 1, 2_147_483_647);
  const identity = memberIdentity(source);
  if (source.contract_version !== 1 || uid === null || gender === null && source.gender !== null
    || !visibleTo || revision === null || !identity) return null;
  if (gender === null) {
    // An unresolved member has no canonical gender, so Core projects no detail
    // and no derived group, and the audience can only be the open default.
    return source.group === null && visibleTo === "both"
      && (identity.identity?.legacy_gender_detail ?? null) === null
      ? {
        contract_version: 1,
        uid,
        gender: null,
        visible_to: "both",
        revision,
        group: null,
        identity: identity.identity,
      }
      : null;
  }
  const group = requiredObject(source.group, ["id", "key", "legacy_segment"]);
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
    identity: identity.identity,
  };
}

export function audienceVisibilityMemberDetailResponse(value: unknown): AudienceVisibilityMemberDetail | null {
  return successData(value, memberDetail);
}

/** T-653 §7b. Success carries the complete canonical member plus the replay flag. */
export function audienceVisibilityMemberIdentityMutationResponse(
  value: unknown,
): AudienceVisibilityMemberMutation | null {
  return successData(value, (data) => {
    const source = requiredObject(data, ["contract_version", "member", "replayed"]);
    const member = memberDetail(source?.member);
    return source?.contract_version === 1 && member && typeof source.replayed === "boolean"
      ? { contract_version: 1, member, replayed: source.replayed }
      : null;
  });
}

export function audienceVisibilityConflict(value: unknown): AudienceVisibilityConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409 || envelope.error !== "audience-visibility-conflict") return null;
  const data = record(envelope.data);
  const branches = ["group", "intents", "member"].filter((key) => data && Object.hasOwn(data, key));
  if (branches.length !== 1) return null;
  const groupData = requiredObject(envelope.data, ["contract_version", "group"]);
  const group = visibilityGroup(groupData?.group);
  if (groupData?.contract_version === 1 && group) return { kind: "group", group };
  const intentsData = requiredObject(envelope.data, ["contract_version", "intents"]);
  const intents = audienceVisibilityIntents(intentsData?.intents);
  if (intentsData?.contract_version === 1 && intents) return { kind: "intents", intents };
  // T-653 §7b: the member-identity conflict carries the canonical member, so
  // the panel adopts it and asks for a fresh operator gesture.
  const memberData = requiredObject(envelope.data, ["contract_version", "member"]);
  const member = memberDetail(memberData?.member);
  return memberData?.contract_version === 1 && member ? { kind: "member", member } : null;
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
  // T-653 §7b additions. `feature-retired` is the same machine error the legacy
  // identity route answers, deliberately, so a stale console is told the feature
  // is gone rather than that a field name was unrecognised.
  "feature-retired": 410,
  "identity-gender-invalid": 422,
  "identity-gender-detail-invalid": 422,
  "identity-gender-detail-mismatch": 422,
  "profile-visibility-fixed": 422,
  "audience-visibility-member-unresolved": 409,
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
  // Same-origin request bodies remain exact so undeclared fields cannot reach Core.
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
  const labels = localizedPair(source?.labels, 80, true);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  if (!source || !key || !labels || sortOrder === null || typeof source.active !== "boolean"
    || !Array.isArray(source.rules) || source.rules.length < 1 || source.rules.length > 20) return null;
  const rules = source.rules.map((rule) => visibilityRule(rule, true));
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
  const labels = parseCanonicalMaterial(source?.labels_json, (value) => localizedPair(value, 80, true));
  const rules = parseCanonicalMaterial(source?.rules_json, (value) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
    const parsed = value.map((rule) => visibilityRule(rule, true));
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
  const labels = parseCanonicalMaterial(source?.labels_json, (value) => localizedPair(value, 180, true));
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

/**
 * T-653 §7b, in the contract's order — the EIGHT-field terminal body, or the
 * deployed nine-field one when `gender_detail` is present.
 *
 * Both Cores validate this body with `strictRequired`, which refuses an
 * unlisted key AND a missing listed one, so exactly one of the two bodies is
 * acceptable at a time and the difference is not optional:
 *
 * - deployed `364c89e8` lists `gender_detail` → the eight-field body is
 *   refused `audience-visibility-request-invalid`;
 * - T-669 `1d108591` lists `gender_detail` as RETIRED → the nine-field body is
 *   refused `feature-retired` (410).
 *
 * The choice is therefore made from what Core SERVED on the member, never from
 * a console flag: `audienceVisibilityMemberIdentityBody()` includes the key iff
 * the member payload carried it, and echoes the served value so the retired
 * axis is never rewritten by a console that no longer edits it.
 *
 * `gender_detail` is a form field, so the empty string is the absent detail and
 * Core stores it as `null`. `expected_identity_revision` may be 0 — that is the
 * value a member with no canonical `identity_v2` echoes back, and the one that
 * creates the document. The other retired identity axes have no branch here at
 * all: an exact body cannot carry `orientation` or `relationship_status`.
 */
function normalizeMemberIdentitySave(body: JsonObject): JsonObject | null {
  const legacyDetail = Object.hasOwn(body, "gender_detail");
  const source = exactBody(body, legacyDetail
    ? [
      "contract_version", "request_id", "expected_revision", "expected_identity_revision",
      "audit_reason", "uid", "gender", "gender_detail", "visible_to",
    ]
    : [
      "contract_version", "request_id", "expected_revision", "expected_identity_revision",
      "audit_reason", "uid", "gender", "visible_to",
    ]);
  const request = requestId(source?.request_id);
  const revision = integer(source?.expected_revision, 1, 2_147_483_647);
  const identityRevision = integer(source?.expected_identity_revision, 0, 2_147_483_647);
  const reason = auditReason(source?.audit_reason);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  const gender = oneOf(source?.gender, AUDIENCE_VISIBILITY_GENDERS);
  const visibleTo = oneOf(source?.visible_to, AUDIENCE_VISIBILITY_VALUES);
  const rawDetail = source?.gender_detail;
  const detail = !legacyDetail
    ? ""
    : rawDetail === "" ? "" : typeof rawDetail === "string" && GENDER_DETAIL.test(rawDetail) ? rawDetail : null;
  if (source?.contract_version !== 1 || !request || revision === null || identityRevision === null
    || !reason || uid === null || !gender || !visibleTo || detail === null) return null;
  // Core enforces the same rule on the owner route; refusing it here keeps a
  // fixed-audience gender from spending a receipt on a certain refusal.
  if (gender === "nonbinary" && visibleTo !== "both") return null;
  const normalized: JsonObject = Object.assign(Object.create(null), {
    contract_version: 1,
    request_id: request,
    expected_revision: revision,
    expected_identity_revision: identityRevision,
    audit_reason: reason,
    uid,
    gender,
  });
  if (legacyDetail) normalized.gender_detail = detail;
  normalized.visible_to = visibleTo;
  return normalized;
}

/** `undefined` is another family, `null` is refused, and an object alone may reach Core. */
export function normalizeAudienceVisibilityProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if ((AUDIENCE_VISIBILITY_IDENTITY_ACTIONS as readonly string[]).includes(action)) {
    return normalizeMemberIdentitySave(body);
  }
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
  // Persisted retry identity remains exact so replay cannot acquire new semantics.
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

export type AudienceVisibilityIdentityDraft = {
  /** `""` while an unresolved member has no gender chosen yet. */
  gender: AudienceVisibilityGender | "";
  visible_to: AudienceVisibilityValue;
  audit_reason: string;
};

/**
 * The exact command the member-identity editor posts, or `null`.
 *
 * Both optimistic axes come from the member payload the panel is displaying —
 * never from a value the browser kept across a reload — so a console that never
 * read the member cannot guess a revision. `null` covers a Core with no T-653
 * keys (nothing to guard with), an unchosen gender, an unusable audit reason,
 * and every shape the proxy would refuse anyway.
 *
 * The retired `gender_detail` is included iff the SERVED member carried it, and
 * then only as an echo of the served value — the console has no control for it
 * after T-669, so a save must leave that axis exactly as Core reported it.
 */
export function audienceVisibilityMemberIdentityBody(
  member: AudienceVisibilityMemberDetail,
  draft: AudienceVisibilityIdentityDraft,
  request: string,
): JsonObject | null {
  if (!member.identity || draft.gender === "") return null;
  const command: JsonObject = Object.assign(Object.create(null), {
    contract_version: 1,
    request_id: request,
    expected_revision: member.revision,
    expected_identity_revision: member.identity.identity_revision,
    audit_reason: draft.audit_reason,
    uid: member.uid,
    gender: draft.gender,
  });
  if (member.identity.legacy_gender_detail !== undefined) {
    command.gender_detail = member.identity.legacy_gender_detail ?? "";
  }
  command.visible_to = draft.visible_to;
  return normalizeMemberIdentitySave(command);
}

/**
 * Whether the draft asks for exactly what is stored.
 *
 * Core answers such a request with success and the current revisions, which is
 * what makes a replay safe — but it still spends a receipt and writes an audit
 * row, so the editor does not offer it. A member with no canonical `identity_v2`
 * is never unchanged: the document has to be created before it can match.
 */
export function audienceVisibilityIdentityUnchanged(
  member: AudienceVisibilityMemberDetail,
  draft: AudienceVisibilityIdentityDraft,
): boolean {
  if (!member.identity || member.identity.identity_revision < 1) return false;
  // The retired detail is echoed, never edited, so it can never differ and has
  // no place in this comparison.
  return member.gender === draft.gender && member.visible_to === draft.visible_to;
}

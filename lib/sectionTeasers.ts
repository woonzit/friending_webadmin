import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/**
 * Accepted Webadmin section-teaser family contract v1 (T-722/T-723, owner
 * decision D-120: the "soft off" teaser).
 *
 * Pure: no `server-only` import, so the proxy normalizes bodies with the same
 * module the browser decodes with and the tests exercise under plain Node. It
 * is pinned on Core's committed `section_teasers_wire` corpus, copied
 * byte-identical into `tests/fixtures/section_teasers_wire`.
 *
 * The family is DELIBERATELY separate from `section_availability`: the on/off
 * answer stays per storefront in the settings transaction, while `hidden` and
 * the copy are global per section and carry their own revision, their own
 * receipt and their own save. Core publishes a teaser to a member only when the
 * section is OFF for that storefront AND `hidden` is false; enforcement is
 * unchanged either way.
 */
export const SECTION_TEASERS_CONTRACT_VERSION = 1 as const;
/** The `ios_appconfig` block's OWN version; the app plane moves independently. */
export const SECTION_TEASERS_APP_CONTRACT_VERSION = 1 as const;

/** The closed section vocabulary, in Core's publication order. */
export const SECTION_TEASER_SECTIONS = ["travel", "dates"] as const;
export const SECTION_TEASER_LANGUAGES = ["en", "hu"] as const;
export const SECTION_TEASERS_ACTIONS = [
  "section_teasers_get",
  "save_section_teasers",
] as const;

/**
 * Core measures CHARACTERS (scalars), not bytes, and the EMPTY STRING is valid
 * — it means "serve the compiled copy". Whitespace-only and untrimmed copy is
 * refused, which is why the canonical check below is not a simple length test.
 */
export const SECTION_TEASERS_TITLE_MAX = 40 as const;
export const SECTION_TEASERS_DESCRIPTION_MAX = 400 as const;
export const SECTION_TEASERS_AUDIT_REASON_MAX = 300 as const;
export const SECTION_TEASERS_REVISION_MAX = 2_147_483_647 as const;

export const SECTION_TEASERS_TARGET = "section_teasers:v1" as const;

/**
 * `admin_me` does NOT advertise a `section_teasers` capability block, exactly as
 * it does not advertise `mode_cards`. The two names Core checks are recorded
 * here so the console states which gate it is relying on, and the proxy applies
 * the independent global role floor (`read` = any active administrator,
 * `write` = owner/admin) in `lib/adminActions.ts`. Core remains the authority
 * and answers `section-teasers-read-required` / `section-teasers-edit-required`
 * for a principal this floor lets through.
 */
export const SECTION_TEASERS_CORE_READ_CAPABILITY = "section_teasers_read" as const;
export const SECTION_TEASERS_CORE_EDIT_CAPABILITY = "section_teasers_edit" as const;

export type SectionTeaserKey = (typeof SECTION_TEASER_SECTIONS)[number];
export type SectionTeaserLanguage = (typeof SECTION_TEASER_LANGUAGES)[number];
export type SectionTeasersAction = (typeof SECTION_TEASERS_ACTIONS)[number];

export type SectionTeaserText = Record<SectionTeaserLanguage, string>;

export type SectionTeaser = {
  key: SectionTeaserKey;
  hidden: boolean;
  title: SectionTeaserText;
  description: SectionTeaserText;
};

export type SectionTeasersState = {
  contract_version: 1;
  teasers: SectionTeaser[];
  revision: number;
  updated_at: number;
  updated_by: string;
};

export type SectionTeasersMutation = SectionTeasersState & {
  no_change: boolean;
  replayed: boolean;
};

export type SectionTeasersConflict = { current: SectionTeasersState };

/** One published member teaser: `null`, or exactly the two resolved strings. */
export type SectionTeaserPublication = { title: string; description: string };

/** The public `ios_appconfig.section_teasers` block, decoded for the corpus test. */
export type SectionTeasersAppBlock = {
  contract_version: 1;
  teasers: Record<SectionTeaserKey, SectionTeaserPublication | null>;
};

type JsonObject = Record<string, unknown>;

export type SectionTeaserInput = {
  hidden: boolean;
  title: SectionTeaserText;
  description: SectionTeaserText;
};

export type SectionTeasersSavePayload = JsonObject & {
  contract_version: 1;
  sections: Record<SectionTeaserKey, SectionTeaserInput>;
  expected_revision: number;
  request_id: string;
  audit_reason: string;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

/** Exact objects are reserved for browser-owned commands and served key sets. */
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

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum
    ? value
    : null;
}

export function sectionTeaserTextLength(value: string): number {
  return [...value].length;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Core's rule for one teaser leaf, mirrored: NFC-normalized, trimmed,
 * control-free, at most `max` scalars — and the EMPTY string, which is the
 * documented way to ask for the compiled copy. A whitespace-only value is
 * therefore refused here rather than silently sent as "blank".
 */
function canonicalCopy(value: unknown, max: number): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)
    || value !== value.normalize("NFC") || value !== value.trim()) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  return sectionTeaserTextLength(value) <= max ? value : null;
}

export function sectionTeaserCopyIsValid(value: unknown, max: number): value is string {
  return canonicalCopy(value, max) !== null;
}

/** Core requires 1..300 characters and refuses a blank or untrimmed reason. */
export function sectionTeasersAuditReasonIsValid(value: unknown): value is string {
  const reason = canonicalCopy(value, SECTION_TEASERS_AUDIT_REASON_MAX);
  return reason !== null && reason !== "";
}

function sectionTeaserText(value: unknown, max: number): SectionTeaserText | null {
  const source = exactObject(value, SECTION_TEASER_LANGUAGES);
  if (!source) return null;
  const en = canonicalCopy(source.en, max);
  const hu = canonicalCopy(source.hu, max);
  return en !== null && hu !== null ? { en, hu } : null;
}

function sectionTeaser(value: unknown, expected: SectionTeaserKey): SectionTeaser | null {
  // Exact keys: Core states the four-key row as the contract, so an extra key
  // is a provider change this console has not been taught, not an addition to
  // tolerate.
  const source = exactObject(value, ["key", "hidden", "title", "description"]);
  if (!source || source.key !== expected || typeof source.hidden !== "boolean") return null;
  const title = sectionTeaserText(source.title, SECTION_TEASERS_TITLE_MAX);
  const description = sectionTeaserText(source.description, SECTION_TEASERS_DESCRIPTION_MAX);
  return title && description
    ? { key: expected, hidden: source.hidden, title, description }
    : null;
}

/** The two rows, in the fixed order Core publishes and this console renders. */
function sectionTeasers(value: unknown): SectionTeaser[] | null {
  if (!Array.isArray(value) || value.length !== SECTION_TEASER_SECTIONS.length) return null;
  const decoded = SECTION_TEASER_SECTIONS.map((key, index) => sectionTeaser(value[index], key));
  return decoded.every((row): row is SectionTeaser => row !== null) ? decoded : null;
}

function sectionTeasersStateShape(value: unknown): SectionTeasersState | null {
  const source = requiredObject(value, [
    "contract_version",
    "teasers",
    "revision",
    "updated_at",
    "updated_by",
  ]);
  const teasers = sectionTeasers(source?.teasers);
  const revision = integer(source?.revision, 0, SECTION_TEASERS_REVISION_MAX);
  const updatedAt = integer(source?.updated_at, 0);
  const updatedBy = typeof source?.updated_by === "string"
    && !hasUnpairedSurrogate(source.updated_by)
    && !PLAIN_TEXT_CONTROL.test(source.updated_by)
    && sectionTeaserTextLength(source.updated_by) <= 320
    ? source.updated_by
    : null;
  return source?.contract_version === SECTION_TEASERS_CONTRACT_VERSION
    && teasers && revision !== null && updatedAt !== null && updatedBy !== null
    ? { contract_version: 1, teasers, revision, updated_at: updatedAt, updated_by: updatedBy }
    : null;
}

export function sectionTeasersStateResponse(value: unknown): SectionTeasersState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = record(envelope?.data);
  // `no_change` and `replayed` select the mutation variant. They are recognized
  // sibling fields, not arbitrary additions to a read response.
  if (data && (Object.hasOwn(data, "no_change") || Object.hasOwn(data, "replayed"))) return null;
  return envelope ? sectionTeasersStateShape(envelope.data) : null;
}

export function sectionTeasersMutationResponse(value: unknown): SectionTeasersMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = requiredObject(envelope?.data, [
    "contract_version",
    "teasers",
    "revision",
    "updated_at",
    "updated_by",
    "no_change",
    "replayed",
  ]);
  if (!source || typeof source.no_change !== "boolean"
    || typeof source.replayed !== "boolean") return null;
  const state = sectionTeasersStateShape({
    contract_version: source.contract_version,
    teasers: source.teasers,
    revision: source.revision,
    updated_at: source.updated_at,
    updated_by: source.updated_by,
  });
  return state ? { ...state, no_change: source.no_change, replayed: source.replayed } : null;
}

/** The only refusal allowed to carry data; a malformed `current` fails closed. */
export function sectionTeasersConflictResponse(value: unknown): SectionTeasersConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (envelope?.error !== "section-teasers-conflict" || envelope.status_code !== 409) return null;
  const source = requiredObject(envelope.data, ["current"]);
  const current = sectionTeasersStateShape(source?.current);
  return current ? { current } : null;
}

function sectionTeaserPublication(value: unknown): SectionTeaserPublication | null | undefined {
  if (value === null) return null;
  const source = exactObject(value, ["title", "description"]);
  const title = canonicalCopy(source?.title, SECTION_TEASERS_TITLE_MAX);
  const description = canonicalCopy(source?.description, SECTION_TEASERS_DESCRIPTION_MAX);
  // Core resolves the compiled fallback itself, so a PUBLISHED teaser never
  // carries an empty string. A blank one is a provider defect, not a modal.
  return title && description ? { title, description } : undefined;
}

/**
 * The public `ios_appconfig` block. This console never fetches it; the decoder
 * exists so the corpus test proves the console and the app read the same two
 * sections out of the same bytes.
 */
export function sectionTeasersAppBlock(value: unknown): SectionTeasersAppBlock | null {
  const source = exactObject(value, ["contract_version", "teasers"]);
  const rows = exactObject(source?.teasers, SECTION_TEASER_SECTIONS);
  if (source?.contract_version !== SECTION_TEASERS_APP_CONTRACT_VERSION || !rows) return null;
  const teasers = {} as SectionTeasersAppBlock["teasers"];
  for (const key of SECTION_TEASER_SECTIONS) {
    const published = sectionTeaserPublication(rows[key]);
    if (published === undefined) return null;
    teasers[key] = published;
  }
  return { contract_version: 1, teasers };
}

export const SECTION_TEASERS_ERROR_STATUSES: Readonly<Record<string, number>> = {
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
  "section-teasers-read-required": 403,
  "section-teasers-edit-required": 403,
  "section-teasers-contract-version-required": 422,
  "section-teasers-contract-version-invalid": 422,
  "section-teasers-request-invalid": 422,
  "section-teasers-sections-invalid": 422,
  "section-teasers-hidden-invalid": 422,
  "section-teasers-title-invalid": 422,
  "section-teasers-description-invalid": 422,
  "section-teasers-audit-reason-invalid": 422,
  "section-teasers-revision-invalid": 422,
  "section-teasers-request-id-invalid": 422,
  "section-teasers-conflict": 409,
  "section-teasers-request-id-conflict": 409,
  "section-teasers-request-in-progress": 409,
  "section-teasers-stored-invalid": 503,
  "section-teasers-read-failed": 503,
  "section-teasers-audit-write-failed": 503,
  "section-teasers-receipt-write-failed": 503,
  "section-teasers-write-failed": 503,
};

/**
 * Decode only no-data refusals. The conflict branch is parsed above and is
 * deliberately excluded here; a malformed conflict must stay unknown so the
 * pending command cannot be dropped on a partial response.
 */
export function sectionTeasersError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && error !== "section-teasers-conflict"
    && Object.hasOwn(SECTION_TEASERS_ERROR_STATUSES, error)
    && SECTION_TEASERS_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

/**
 * The closed set of leaves a 422 may point at. A save carries ten editable
 * values plus the reason and the revision, so the refusal names one — but the
 * pointer is DATA from the wire and is only believed when it is one of the
 * leaves this console actually renders.
 */
export const SECTION_TEASERS_FIELD_POINTERS: readonly string[] = [
  "sections",
  "expected_revision",
  "request_id",
  "audit_reason",
  ...SECTION_TEASER_SECTIONS.flatMap((section) => [
    `sections.${section}`,
    `sections.${section}.hidden`,
    ...(["title", "description"] as const).flatMap((slot) => [
      `sections.${section}.${slot}`,
      ...SECTION_TEASER_LANGUAGES.map((language) => `sections.${section}.${slot}.${language}`),
    ]),
  ]),
];

export function sectionTeasersFieldPointer(value: unknown): string | null {
  const source = record(value);
  const field = source?.field;
  return typeof field === "string" && SECTION_TEASERS_FIELD_POINTERS.includes(field)
    ? field
    : null;
}

export type SectionTeasersErrorKey =
  | "sessionInvalid"
  | "badOrigin"
  | "routeNotFound"
  | "readRequired"
  | "editRequired"
  | "requestInvalid"
  | "tooLarge"
  | "temporarilyUnavailable"
  | "invalidResponse"
  | "contractVersion"
  | "sectionsInvalid"
  | "hiddenInvalid"
  | "titleInvalid"
  | "descriptionInvalid"
  | "auditReasonInvalid"
  | "revisionInvalid"
  | "requestIdInvalid"
  | "conflict"
  | "requestIdConflict"
  | "requestInProgress"
  | "storedInvalid"
  | "auditWriteFailed"
  | "receiptWriteFailed"
  | "writeFailed"
  | "generic";

const SECTION_TEASERS_ERROR_KEYS: Readonly<Record<string, SectionTeasersErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "bad-origin": "badOrigin",
  "not-found": "routeNotFound",
  "section-teasers-read-required": "readRequired",
  "admin-write-required": "editRequired",
  "section-teasers-edit-required": "editRequired",
  "invalid-input": "requestInvalid",
  "section-teasers-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "section-teasers-read-failed": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
  "section-teasers-contract-version-required": "contractVersion",
  "section-teasers-contract-version-invalid": "contractVersion",
  "section-teasers-sections-invalid": "sectionsInvalid",
  "section-teasers-hidden-invalid": "hiddenInvalid",
  "section-teasers-title-invalid": "titleInvalid",
  "section-teasers-description-invalid": "descriptionInvalid",
  "section-teasers-audit-reason-invalid": "auditReasonInvalid",
  "section-teasers-revision-invalid": "revisionInvalid",
  "section-teasers-request-id-invalid": "requestIdInvalid",
  "section-teasers-conflict": "conflict",
  "section-teasers-request-id-conflict": "requestIdConflict",
  "section-teasers-request-in-progress": "requestInProgress",
  "section-teasers-stored-invalid": "storedInvalid",
  "section-teasers-audit-write-failed": "auditWriteFailed",
  "section-teasers-receipt-write-failed": "receiptWriteFailed",
  "section-teasers-write-failed": "writeFailed",
};

export function sectionTeasersErrorKey(error: string | null): SectionTeasersErrorKey {
  return error && Object.hasOwn(SECTION_TEASERS_ERROR_KEYS, error)
    ? SECTION_TEASERS_ERROR_KEYS[error]
    : "generic";
}

/**
 * Whether the SAME command must be retried rather than re-minted. An unknown
 * outcome, a server-side failure and `request-in-progress` all leave the write
 * undecided, so the console keeps the request id and replays it.
 */
export function sectionTeasersShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.hasOwn(SECTION_TEASERS_ERROR_STATUSES, error)
    || error === "section-teasers-request-in-progress"
    || SECTION_TEASERS_ERROR_STATUSES[error] >= 500;
}

// --------------------------------------------------------------- the command

function sectionTeaserInput(value: unknown): SectionTeaserInput | null {
  const source = exactObject(value, ["hidden", "title", "description"]);
  if (!source || typeof source.hidden !== "boolean") return null;
  const title = sectionTeaserText(source.title, SECTION_TEASERS_TITLE_MAX);
  const description = sectionTeaserText(source.description, SECTION_TEASERS_DESCRIPTION_MAX);
  return title && description ? { hidden: source.hidden, title, description } : null;
}

function normalizeGetBody(body: JsonObject): JsonObject | null {
  // Same-origin request bodies stay exact so an undeclared field cannot reach Core.
  const source = exactObject(body, ["contract_version"]);
  return source?.contract_version === SECTION_TEASERS_CONTRACT_VERSION
    ? Object.assign(Object.create(null), { contract_version: 1 })
    : null;
}

function normalizeSaveBody(body: JsonObject): SectionTeasersSavePayload | null {
  const source = exactObject(body, [
    "contract_version", "sections", "expected_revision", "request_id", "audit_reason",
  ]);
  const rawSections = exactObject(source?.sections, SECTION_TEASER_SECTIONS);
  const revision = integer(source?.expected_revision, 0, SECTION_TEASERS_REVISION_MAX);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  const auditReason = source && sectionTeasersAuditReasonIsValid(source.audit_reason)
    ? source.audit_reason
    : null;
  if (source?.contract_version !== SECTION_TEASERS_CONTRACT_VERSION
    || !rawSections || revision === null || !requestId || auditReason === null) return null;
  const sections: Partial<Record<SectionTeaserKey, SectionTeaserInput>> = {};
  for (const key of SECTION_TEASER_SECTIONS) {
    const row = sectionTeaserInput(rawSections[key]);
    if (!row) return null;
    sections[key] = row;
  }
  return Object.assign(Object.create(null), {
    contract_version: 1,
    // Rebuilt in publication order so the JSON Core receives is stable, which
    // is what makes a receipt fingerprint reproducible across a retry.
    sections: Object.fromEntries(SECTION_TEASER_SECTIONS.map((key) => [key, sections[key]])),
    expected_revision: revision,
    request_id: requestId,
    audit_reason: auditReason,
  }) as SectionTeasersSavePayload;
}

/** `undefined` is another family, `null` is refused, an object may reach Core. */
export function normalizeSectionTeasersProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(SECTION_TEASERS_ACTIONS as readonly string[]).includes(action)) return undefined;
  return action === "section_teasers_get" ? normalizeGetBody(body) : normalizeSaveBody(body);
}

// ------------------------------------------------------------- the draft

export type SectionTeaserDraft = {
  hidden: boolean;
  title: SectionTeaserText;
  description: SectionTeaserText;
};

export type SectionTeasersDraft = Record<SectionTeaserKey, SectionTeaserDraft>;

export function sectionTeasersDraftFrom(state: SectionTeasersState): SectionTeasersDraft {
  const draft = {} as SectionTeasersDraft;
  for (const section of SECTION_TEASER_SECTIONS) {
    const served = state.teasers.find((row) => row.key === section);
    draft[section] = {
      // An unreadable row would already have failed the decoder; the fallback
      // is today's behaviour, which is the fully hidden section.
      hidden: served?.hidden ?? true,
      title: { en: served?.title.en ?? "", hu: served?.title.hu ?? "" },
      description: { en: served?.description.en ?? "", hu: served?.description.hu ?? "" },
    };
  }
  return draft;
}

export function sectionTeasersDraftWithSection(
  draft: SectionTeasersDraft,
  section: SectionTeaserKey,
  changes: Partial<SectionTeaserDraft>,
): SectionTeasersDraft {
  return { ...draft, [section]: { ...draft[section], ...changes } };
}

export type SectionTeasersDraftIssue =
  | "title"
  | "description";

/**
 * The first leaf Core would refuse, or `null`. Blank is deliberately VALID and
 * means the compiled copy, so this only catches an over-long, untrimmed,
 * whitespace-only or control-bearing value.
 */
export function sectionTeasersDraftIssue(
  draft: SectionTeasersDraft,
): { section: SectionTeaserKey; issue: SectionTeasersDraftIssue; language: SectionTeaserLanguage } | null {
  for (const section of SECTION_TEASER_SECTIONS) {
    for (const language of SECTION_TEASER_LANGUAGES) {
      if (!sectionTeaserCopyIsValid(draft[section].title[language], SECTION_TEASERS_TITLE_MAX)) {
        return { section, issue: "title", language };
      }
      if (!sectionTeaserCopyIsValid(
        draft[section].description[language],
        SECTION_TEASERS_DESCRIPTION_MAX,
      )) {
        return { section, issue: "description", language };
      }
    }
  }
  return null;
}

export function sectionTeasersSavePayload(
  draft: SectionTeasersDraft,
  expectedRevision: number,
  requestId: string,
  auditReason: string,
): SectionTeasersSavePayload | null {
  return normalizeSaveBody({
    contract_version: 1,
    sections: Object.fromEntries(SECTION_TEASER_SECTIONS.map((section) => [section, {
      hidden: draft[section].hidden,
      title: { ...draft[section].title },
      description: { ...draft[section].description },
    }])),
    expected_revision: expectedRevision,
    request_id: requestId,
    audit_reason: auditReason,
  });
}

// ------------------------------------------------------------- convergence

/** Does the served state carry exactly the values this command asked for? */
export function sectionTeasersStateMatchesPayload(
  payload: SectionTeasersSavePayload,
  state: SectionTeasersState,
): boolean {
  return SECTION_TEASER_SECTIONS.every((section, index) => {
    const wanted = payload.sections[section];
    const served = state.teasers[index];
    return Boolean(wanted && served && served.key === section
      && served.hidden === wanted.hidden
      && SECTION_TEASER_LANGUAGES.every((language) =>
        served.title[language] === wanted.title[language]
        && served.description[language] === wanted.description[language]));
  });
}

/** A decoded mutation proves either the exact no-op or one revision transition. */
export function sectionTeasersMutationConverged(
  payload: SectionTeasersSavePayload,
  result: SectionTeasersMutation,
): boolean {
  if (!sectionTeasersStateMatchesPayload(payload, result)) return false;
  return result.no_change
    ? result.revision === payload.expected_revision
    : result.revision === payload.expected_revision + 1;
}

/**
 * A read after a lost response may prove the command landed without another
 * write. Only the requested copy at the exact no-op or one-step revision is
 * sufficient; a later or ambiguous revision stays pending.
 */
export function sectionTeasersStateConverged(
  payload: SectionTeasersSavePayload,
  state: SectionTeasersState,
): boolean {
  return sectionTeasersStateMatchesPayload(payload, state)
    && (state.revision === payload.expected_revision
      || state.revision === payload.expected_revision + 1);
}

/**
 * Conflict rebasing. The 409 body IS the authoritative state, so the console
 * adopts it without a second round trip: `hidden` and the copy are what another
 * operator stored, and the returned draft is the truth the operator must edit
 * from. `satisfied` says the conflict already carries this command's values, so
 * the write it was racing had in fact applied it.
 */
export function sectionTeasersDraftAfterConflict(
  conflict: SectionTeasersConflict,
  payload: SectionTeasersSavePayload | null,
): { state: SectionTeasersState; draft: SectionTeasersDraft; satisfied: boolean } {
  return {
    state: conflict.current,
    draft: sectionTeasersDraftFrom(conflict.current),
    satisfied: payload !== null
      && sectionTeasersStateMatchesPayload(payload, conflict.current),
  };
}

// ------------------------------------------------------------- the preview

/**
 * Core's compiled fallback copy. It is Core's MEMBER-facing copy, not console
 * chrome, which is why it lives here beside the contract rather than in
 * `messages/*.json`: the console needs it only to show an operator what a BLANK
 * field will actually publish, and `tests/sectionTeasersWire.test.mts` asserts
 * it byte-for-byte against Core's two compiled `appconfig` bodies, so it cannot
 * drift from what members are served.
 */
export const SECTION_TEASERS_COMPILED_COPY:
  Readonly<Record<SectionTeaserLanguage, SectionTeaserPublication>> = {
    en: {
      title: "Coming soon",
      description: "This part of Friending is not available yet. Check back soon.",
    },
    hu: {
      title: "Hamarosan",
      description: "A Friending ennek a része még nem érhető el. Nézz vissza hamarosan.",
    },
  };

/**
 * What a member would read in the modal for this draft and language: the
 * authored copy, or Core's compiled copy for every leaf left blank. Core
 * resolves each leaf independently, so a filled title with a blank description
 * publishes the authored title beside the compiled description.
 */
export function sectionTeaserPreview(
  draft: SectionTeaserDraft,
  language: SectionTeaserLanguage,
): SectionTeaserPublication {
  return {
    title: draft.title[language] || SECTION_TEASERS_COMPILED_COPY[language].title,
    description: draft.description[language]
      || SECTION_TEASERS_COMPILED_COPY[language].description,
  };
}

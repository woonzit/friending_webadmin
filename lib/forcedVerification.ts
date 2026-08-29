import { getCountryDataList } from "countries-list";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { webadminDataSuccessEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/**
 * Forced verification + Waiting Room — the Webadmin side of
 * `handoffs/forced-verification-waiting-room-contract.md` v1 §4 (D-053 /
 * D-053a, Amendment v1.1). Pure module shared by the proxy route, the
 * dashboard page and the "Forced & waiting room" tab; no `server-only`
 * import because the client renders the same closed parsers.
 *
 * Core owns storage (`app_settings`), validation, the revision, audit and
 * the gate itself. This module only decodes Core's exact material, keeps the
 * editor draft coherent and refuses to forward anything Core would not
 * accept. Key lists are closed on purpose: a compatible Core change is
 * integrated here (and re-bound to the published `verification_forced_wire`
 * fixture corpus) before operators can rely on it.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const FORCED_VERIFICATION_ACTIONS = [
  "verification_forced_console",
  "verification_forced_save",
  "verification_forced_impact_preview",
] as const;
export type ForcedVerificationAction = (typeof FORCED_VERIFICATION_ACTIONS)[number];

export const FORCED_VERIFICATION_METHODS = ["persona", "video"] as const;
export type ForcedVerificationMethod = (typeof FORCED_VERIFICATION_METHODS)[number];
export type ForcedMethods = Record<ForcedVerificationMethod, boolean>;

export const WAITING_ROOM_LOCALES = ["en", "hu"] as const;
export type WaitingRoomLocale = (typeof WAITING_ROOM_LOCALES)[number];

export const WAITING_ROOM_COPY_FIELDS = ["title", "subtitle", "description"] as const;
export type WaitingRoomCopyField = (typeof WAITING_ROOM_COPY_FIELDS)[number];
export type WaitingRoomCopy = Record<WaitingRoomCopyField, string>;
/** A per-storefront override carries only the fields it sets; an absent field inherits. */
export type WaitingRoomCopyOverride = Partial<WaitingRoomCopy>;

/** Contract §4: title ≤ 60, subtitle ≤ 90, description ≤ 400 code points. */
export const WAITING_ROOM_COPY_LIMITS: Readonly<Record<WaitingRoomCopyField, number>> = {
  title: 60,
  subtitle: 90,
  description: 400,
};

/** Contract §2: server-owned integer, seeded 1, first save → 2, max 2^53 − 1. */
export const FORCED_VERIFICATION_REVISION_MAX = 9_007_199_254_740_991;

export const FORCED_VERIFICATION_DOCUMENT_KEYS = ["default", "overrides", "copy_default", "copy_overrides"] as const;
export const FORCED_VERIFICATION_CONSOLE_KEYS = [
  "revision", ...FORCED_VERIFICATION_DOCUMENT_KEYS, "compiled_defaults", "storefront_catalogue_hint",
] as const;
export const FORCED_VERIFICATION_STOREFRONT_HINT = "alpha-3";

/** Contract §6 + Amendment v1.1 — pinned so a drifting Core default is noticed, never silently adopted. */
export const WAITING_ROOM_COMPILED_COPY: Readonly<Record<WaitingRoomLocale, WaitingRoomCopy>> = {
  en: {
    title: "One more step before you meet people",
    subtitle: "Verification is required in your region",
    description: "To keep Friending safe, members in your region must verify their identity before using the app. It takes about two minutes and your documents are never shown to other members.",
  },
  hu: {
    title: "Még egy lépés, mielőtt ismerkedsz",
    subtitle: "A régiódban hitelesítés szükséges",
    description: "A Friending biztonsága érdekében a régiódban minden tagnak igazolnia kell a személyazonosságát, mielőtt használná az appot. Ez körülbelül két percet vesz igénybe, és a dokumentumaidat más tagok soha nem látják.",
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForcedVerificationDocument = {
  default: ForcedMethods;
  /** Sorted alpha-3 keys; an override replaces the whole method set (contract §1). */
  overrides: Record<string, ForcedMethods>;
  copy_default: Record<WaitingRoomLocale, WaitingRoomCopy>;
  /** Sorted alpha-3 keys; each locale object carries only overridden fields. */
  copy_overrides: Record<string, Partial<Record<WaitingRoomLocale, WaitingRoomCopyOverride>>>;
};

export type ForcedVerificationConsole = {
  revision: number;
  document: ForcedVerificationDocument;
  compiled_defaults: { copy: Record<WaitingRoomLocale, WaitingRoomCopy> };
  storefront_catalogue_hint: typeof FORCED_VERIFICATION_STOREFRONT_HINT;
};

export type ForcedVerificationSaved = {
  revision: number;
  document: ForcedVerificationDocument;
};

export type ForcedVerificationImpactCounts = {
  members_seen: number;
  would_be_gated: number;
  satisfied: number;
};

export type ForcedVerificationImpactRow = ForcedVerificationImpactCounts & { storefront: string };

export type ForcedVerificationImpact = {
  by_storefront: ForcedVerificationImpactRow[];
  unknown_storefront: ForcedVerificationImpactCounts;
  computed_at: string;
};

/**
 * Core's per-operator projection of the forced console (the T-219 / D-049
 * block pattern, separate from `admin_me.verification` whose action list is
 * closed). `contract_ready=false` carries no actions.
 */
export type ForcedVerificationAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  actions: ForcedVerificationAction[];
};

export type ForcedVerificationAccess = {
  /** The tab exists for this operator (`verification_forced_console`). */
  visible: boolean;
  /** Switches, copy editor, impact preview and save (`verification_forced_save`). */
  editable: boolean;
};

// ---------------------------------------------------------------------------
// Storefront catalogue (App Store storefront = ISO 3166-1 alpha-3, D-049 model)
// ---------------------------------------------------------------------------

export type ForcedStorefront = { alpha2: string; alpha3: string; englishName: string };
export type LocalizedForcedStorefront = ForcedStorefront & { name: string };

const NON_ISO_REGIONS = new Set(["AC", "TA"]);

const STOREFRONT_CATALOGUE: ForcedStorefront[] = getCountryDataList()
  .filter((country) => !country.userAssigned && !NON_ISO_REGIONS.has(country.iso2))
  .map((country) => ({ alpha2: country.iso2, alpha3: country.iso3, englishName: country.name }))
  .filter((country) => /^[A-Z]{2}$/.test(country.alpha2) && /^[A-Z]{3}$/.test(country.alpha3))
  .sort((left, right) => left.alpha3.localeCompare(right.alpha3));

const STOREFRONT_CODES: ReadonlySet<string> = new Set(STOREFRONT_CATALOGUE.map((country) => country.alpha3));
const STOREFRONT_ALPHA2: ReadonlyMap<string, string> = new Map(STOREFRONT_CATALOGUE.map((country) => [country.alpha3, country.alpha2]));

export const FORCED_STOREFRONTS: readonly ForcedStorefront[] = STOREFRONT_CATALOGUE;

export function isForcedStorefront(value: unknown): value is string {
  return typeof value === "string" && STOREFRONT_CODES.has(value);
}

export function localizedForcedStorefronts(locale: string): LocalizedForcedStorefront[] {
  const supportedLocale = locale === "hu" ? "hu" : "en";
  const displayNames = new Intl.DisplayNames([supportedLocale], { type: "region" });
  const collator = new Intl.Collator(supportedLocale, { sensitivity: "base" });
  return STOREFRONT_CATALOGUE
    .map((country) => ({ ...country, name: displayNames.of(country.alpha2) ?? country.englishName }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

export function forcedStorefrontName(alpha3: string, locale: string): string {
  const alpha2 = STOREFRONT_ALPHA2.get(alpha3);
  if (!alpha2) return alpha3;
  try {
    return new Intl.DisplayNames([locale === "hu" ? "hu" : "en"], { type: "region" }).of(alpha2) ?? alpha3;
  } catch {
    return alpha3;
  }
}

// ---------------------------------------------------------------------------
// Strict parsers (fail closed: exact keys, exact types, closed domains)
// ---------------------------------------------------------------------------

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(source: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(source);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) return false;
  if (required.some((key) => !Object.hasOwn(source, key))) return false;
  return new Set(keys).size === keys.length;
}

function subsetKeys(source: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(source).every((key) => allowed.includes(key));
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function revision(value: unknown, minimum = 1): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= FORCED_VERIFICATION_REVISION_MAX
    ? value
    : null;
}

/** Code-point length, the unit Core measures (`mb_strlen`). */
export function waitingRoomTextLength(value: string): number {
  return [...value].length;
}

function copyText(value: unknown, field: WaitingRoomCopyField): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return null;
  if (value.trim() === "" || waitingRoomTextLength(value) > WAITING_ROOM_COPY_LIMITS[field]) return null;
  return value;
}

export function parseForcedMethods(value: unknown): ForcedMethods | null {
  const source = record(value);
  if (!source || !exactKeys(source, FORCED_VERIFICATION_METHODS)) return null;
  if (typeof source.persona !== "boolean" || typeof source.video !== "boolean") return null;
  return { persona: source.persona, video: source.video };
}

function sortedEntries<T>(source: Record<string, unknown>, parseValue: (value: unknown) => T | null): Record<string, T> | null {
  const keys = Object.keys(source);
  if (keys.length > STOREFRONT_CATALOGUE.length) return null;
  const output: Record<string, T> = {};
  for (const key of [...keys].sort()) {
    if (!isForcedStorefront(key)) return null;
    const parsed = parseValue(source[key]);
    if (parsed === null) return null;
    output[key] = parsed;
  }
  return output;
}

/** `{"<ALPHA3>": {persona, video}}` — an object even when empty (Core container identity), never an array. */
export function parseForcedOverrides(value: unknown): Record<string, ForcedMethods> | null {
  const source = record(value);
  return source ? sortedEntries(source, parseForcedMethods) : null;
}

export function parseWaitingRoomCopy(value: unknown): WaitingRoomCopy | null {
  const source = record(value);
  if (!source || !exactKeys(source, WAITING_ROOM_COPY_FIELDS)) return null;
  const title = copyText(source.title, "title");
  const subtitle = copyText(source.subtitle, "subtitle");
  const description = copyText(source.description, "description");
  if (title === null || subtitle === null || description === null) return null;
  return { title, subtitle, description };
}

export function parseWaitingRoomCopyOverride(value: unknown): WaitingRoomCopyOverride | null {
  const source = record(value);
  if (!source || !subsetKeys(source, WAITING_ROOM_COPY_FIELDS)) return null;
  const output: WaitingRoomCopyOverride = {};
  for (const field of WAITING_ROOM_COPY_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    const text = copyText(source[field], field);
    if (text === null) return null;
    output[field] = text;
  }
  return output;
}

function parseLocalizedCopy(value: unknown): Record<WaitingRoomLocale, WaitingRoomCopy> | null {
  const source = record(value);
  if (!source || !exactKeys(source, WAITING_ROOM_LOCALES)) return null;
  const en = parseWaitingRoomCopy(source.en);
  const hu = parseWaitingRoomCopy(source.hu);
  return en && hu ? { en, hu } : null;
}

function parseLocalizedCopyOverride(value: unknown): Partial<Record<WaitingRoomLocale, WaitingRoomCopyOverride>> | null {
  const source = record(value);
  if (!source || !subsetKeys(source, WAITING_ROOM_LOCALES)) return null;
  const output: Partial<Record<WaitingRoomLocale, WaitingRoomCopyOverride>> = {};
  for (const locale of WAITING_ROOM_LOCALES) {
    if (!Object.hasOwn(source, locale)) continue;
    const parsed = parseWaitingRoomCopyOverride(source[locale]);
    if (parsed === null) return null;
    output[locale] = parsed;
  }
  return output;
}

export function parseWaitingRoomCopyOverrides(value: unknown): ForcedVerificationDocument["copy_overrides"] | null {
  const source = record(value);
  return source ? sortedEntries(source, parseLocalizedCopyOverride) : null;
}

function documentFields(source: Record<string, unknown>): ForcedVerificationDocument | null {
  const defaults = parseForcedMethods(source.default);
  const overrides = parseForcedOverrides(source.overrides);
  const copyDefault = parseLocalizedCopy(source.copy_default);
  const copyOverrides = parseWaitingRoomCopyOverrides(source.copy_overrides);
  if (!defaults || !overrides || !copyDefault || !copyOverrides) return null;
  return { default: defaults, overrides, copy_default: copyDefault, copy_overrides: copyOverrides };
}

/** The exact four-key document Core stores and the console submits. */
export function parseForcedVerificationDocument(value: unknown): ForcedVerificationDocument | null {
  const source = record(value);
  if (!source || !exactKeys(source, FORCED_VERIFICATION_DOCUMENT_KEYS)) return null;
  return documentFields(source);
}

/** `verification_forced_console` material (contract §4). */
export function parseForcedVerificationConsole(value: unknown): ForcedVerificationConsole | null {
  const source = record(value);
  if (!source || !exactKeys(source, FORCED_VERIFICATION_CONSOLE_KEYS)) return null;
  const parsedRevision = revision(source.revision);
  const document = documentFields(source);
  const compiled = record(source.compiled_defaults);
  const compiledCopy = compiled && exactKeys(compiled, ["copy"]) ? parseLocalizedCopy(compiled.copy) : null;
  if (parsedRevision === null || !document || !compiledCopy || source.storefront_catalogue_hint !== FORCED_VERIFICATION_STOREFRONT_HINT) return null;
  return {
    revision: parsedRevision,
    document,
    compiled_defaults: { copy: compiledCopy },
    storefront_catalogue_hint: FORCED_VERIFICATION_STOREFRONT_HINT,
  };
}

/** `verification_forced_save` material: `{ revision, …the stored document… }`. */
export function parseForcedVerificationSaved(value: unknown): ForcedVerificationSaved | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["revision", ...FORCED_VERIFICATION_DOCUMENT_KEYS])) return null;
  const parsedRevision = revision(source.revision, 2);
  const document = documentFields(source);
  return parsedRevision !== null && document ? { revision: parsedRevision, document } : null;
}

function impactCounts(source: Record<string, unknown>): ForcedVerificationImpactCounts | null {
  const seen = count(source.members_seen);
  const gated = count(source.would_be_gated);
  const satisfied = count(source.satisfied);
  if (seen === null || gated === null || satisfied === null || gated > seen || satisfied > seen) return null;
  return { members_seen: seen, would_be_gated: gated, satisfied };
}

/** `verification_forced_impact_preview` material: counts only, never uids. */
export function parseForcedVerificationImpact(value: unknown): ForcedVerificationImpact | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["by_storefront", "unknown_storefront", "computed_at"])) return null;
  if (!Array.isArray(source.by_storefront) || source.by_storefront.length > STOREFRONT_CATALOGUE.length) return null;
  const rows: ForcedVerificationImpactRow[] = [];
  const seen = new Set<string>();
  for (const raw of source.by_storefront) {
    const row = record(raw);
    if (!row || !exactKeys(row, ["storefront", "members_seen", "would_be_gated", "satisfied"])) return null;
    const counts = impactCounts(row);
    if (!counts || !isForcedStorefront(row.storefront) || seen.has(row.storefront)) return null;
    seen.add(row.storefront);
    rows.push({ storefront: row.storefront, ...counts });
  }
  const unknown = record(source.unknown_storefront);
  const unknownCounts = unknown && exactKeys(unknown, ["members_seen", "would_be_gated", "satisfied"]) ? impactCounts(unknown) : null;
  const computedAt = typeof source.computed_at === "string" && TIMESTAMP.test(source.computed_at) && Number.isFinite(Date.parse(source.computed_at))
    ? source.computed_at
    : null;
  if (!unknownCounts || computedAt === null) return null;
  return { by_storefront: rows, unknown_storefront: unknownCounts, computed_at: computedAt };
}

/** `admin_me.verification_forced` — absent or malformed means "no console" for this operator. */
export function parseForcedVerificationAdminMe(value: unknown): ForcedVerificationAdminMe | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["contract_version", "contract_ready", "actions"])) return null;
  if (source.contract_version !== 1 || typeof source.contract_ready !== "boolean" || !Array.isArray(source.actions)) return null;
  const actions = source.actions as unknown[];
  if (actions.some((action) => !(FORCED_VERIFICATION_ACTIONS as readonly unknown[]).includes(action))) return null;
  if (new Set(actions).size !== actions.length) return null;
  const ordered = FORCED_VERIFICATION_ACTIONS.filter((action) => actions.includes(action));
  if (!ordered.every((action, index) => action === actions[index])) return null;
  if (!source.contract_ready && ordered.length !== 0) return null;
  return { contract_version: 1, contract_ready: source.contract_ready, actions: ordered };
}

/**
 * What the current operator may do, from Core's projection only: the local
 * readiness switch can hide the console, never grant it.
 */
export function forcedVerificationAccess(projection: ForcedVerificationAdminMe | null, contractReady: boolean): ForcedVerificationAccess {
  if (!contractReady || !projection || !projection.contract_ready) return { visible: false, editable: false };
  const visible = projection.actions.includes("verification_forced_console");
  return { visible, editable: visible && projection.actions.includes("verification_forced_save") };
}

// ---------------------------------------------------------------------------
// Editor draft ↔ document
// ---------------------------------------------------------------------------

export type ForcedOverrideRow = ForcedMethods & { storefront: string };
/** Editor form of a storefront copy override: every field present, blank = inherit. */
export type WaitingRoomCopyOverrideDraft = Record<WaitingRoomLocale, WaitingRoomCopy>;

export type ForcedVerificationDraft = {
  default: ForcedMethods;
  overrides: ForcedOverrideRow[];
  copy_default: Record<WaitingRoomLocale, WaitingRoomCopy>;
  copy_overrides: Record<string, WaitingRoomCopyOverrideDraft>;
};

export type ForcedVerificationDraftIssue =
  | "storefront"
  | "duplicateStorefront"
  | "copyRequired"
  | "copyTooLong"
  | "copyControl";

export function emptyWaitingRoomCopyOverrideDraft(): WaitingRoomCopyOverrideDraft {
  return { en: { title: "", subtitle: "", description: "" }, hu: { title: "", subtitle: "", description: "" } };
}

export function forcedVerificationDraft(document: ForcedVerificationDocument): ForcedVerificationDraft {
  const copyOverrides: Record<string, WaitingRoomCopyOverrideDraft> = {};
  for (const [storefront, locales] of Object.entries(document.copy_overrides)) {
    const draft = emptyWaitingRoomCopyOverrideDraft();
    for (const locale of WAITING_ROOM_LOCALES) {
      const override = locales[locale];
      if (!override) continue;
      for (const field of WAITING_ROOM_COPY_FIELDS) draft[locale][field] = override[field] ?? "";
    }
    copyOverrides[storefront] = draft;
  }
  return {
    default: { ...document.default },
    overrides: Object.entries(document.overrides).map(([storefront, methods]) => ({ storefront, ...methods })),
    copy_default: { en: { ...document.copy_default.en }, hu: { ...document.copy_default.hu } },
    copy_overrides: copyOverrides,
  };
}

function copyIssue(value: string, field: WaitingRoomCopyField, required: boolean): ForcedVerificationDraftIssue | null {
  const trimmed = value.trim();
  if (trimmed === "") return required ? "copyRequired" : null;
  if (CONTROL_CHARACTERS.test(trimmed) || (field !== "description" && /[\n\r]/.test(trimmed))) return "copyControl";
  if (waitingRoomTextLength(trimmed) > WAITING_ROOM_COPY_LIMITS[field]) return "copyTooLong";
  return null;
}

/** Conservative client validation; Core's `verification-forced-invalid` remains the authority. */
export function validateForcedVerificationDraft(draft: ForcedVerificationDraft): ForcedVerificationDraftIssue | null {
  const seen = new Set<string>();
  if (draft.overrides.length > STOREFRONT_CATALOGUE.length) return "storefront";
  for (const row of draft.overrides) {
    if (!isForcedStorefront(row.storefront)) return "storefront";
    if (seen.has(row.storefront)) return "duplicateStorefront";
    seen.add(row.storefront);
  }
  for (const locale of WAITING_ROOM_LOCALES) {
    for (const field of WAITING_ROOM_COPY_FIELDS) {
      const issue = copyIssue(draft.copy_default[locale][field], field, true);
      if (issue) return issue;
    }
  }
  const copyStorefronts = Object.keys(draft.copy_overrides);
  if (copyStorefronts.length > STOREFRONT_CATALOGUE.length) return "storefront";
  for (const storefront of copyStorefronts) {
    if (!isForcedStorefront(storefront)) return "storefront";
    for (const locale of WAITING_ROOM_LOCALES) {
      for (const field of WAITING_ROOM_COPY_FIELDS) {
        const issue = copyIssue(draft.copy_overrides[storefront][locale][field], field, false);
        if (issue) return issue;
      }
    }
  }
  return null;
}

/**
 * The canonical document for a valid draft (`null` otherwise): trimmed text,
 * storefront keys sorted, blank override fields absent, empty locale and
 * storefront override objects dropped.
 */
export function forcedVerificationDocumentFromDraft(draft: ForcedVerificationDraft): ForcedVerificationDocument | null {
  if (validateForcedVerificationDraft(draft) !== null) return null;
  const overrides: Record<string, ForcedMethods> = {};
  for (const row of [...draft.overrides].sort((left, right) => left.storefront.localeCompare(right.storefront))) {
    overrides[row.storefront] = { persona: row.persona, video: row.video };
  }
  const copyOverrides: ForcedVerificationDocument["copy_overrides"] = {};
  for (const storefront of Object.keys(draft.copy_overrides).sort()) {
    const locales: Partial<Record<WaitingRoomLocale, WaitingRoomCopyOverride>> = {};
    for (const locale of WAITING_ROOM_LOCALES) {
      const override: WaitingRoomCopyOverride = {};
      for (const field of WAITING_ROOM_COPY_FIELDS) {
        const text = draft.copy_overrides[storefront][locale][field].trim();
        if (text !== "") override[field] = text;
      }
      if (Object.keys(override).length > 0) locales[locale] = override;
    }
    if (Object.keys(locales).length > 0) copyOverrides[storefront] = locales;
  }
  const trimCopy = (copy: WaitingRoomCopy): WaitingRoomCopy => ({
    title: copy.title.trim(),
    subtitle: copy.subtitle.trim(),
    description: copy.description.trim(),
  });
  return {
    default: { persona: draft.default.persona, video: draft.default.video },
    overrides,
    copy_default: { en: trimCopy(draft.copy_default.en), hu: trimCopy(draft.copy_default.hu) },
    copy_overrides: copyOverrides,
  };
}

// ---------------------------------------------------------------------------
// Resolution (contract §1: storefront override → global default; copy per field)
// ---------------------------------------------------------------------------

/** The effective method set: an exact storefront override replaces the whole set, else the global default. */
export function resolveForcedMethods(document: ForcedVerificationDocument, storefront: string | null): ForcedMethods {
  const override = storefront === null ? undefined : document.overrides[storefront];
  return override ? { ...override } : { ...document.default };
}

export function forcedMethodList(methods: ForcedMethods): ForcedVerificationMethod[] {
  return FORCED_VERIFICATION_METHODS.filter((method) => methods[method]);
}

/** The Waiting Room copy the app would show: per-field storefront override, else the global default of the same locale. */
export function resolveWaitingRoomCopy(
  document: ForcedVerificationDocument,
  storefront: string | null,
  locale: WaitingRoomLocale,
): WaitingRoomCopy {
  const base = document.copy_default[locale];
  const override = storefront === null ? undefined : document.copy_overrides[storefront]?.[locale];
  return {
    title: override?.title ?? base.title,
    subtitle: override?.subtitle ?? base.subtitle,
    description: override?.description ?? base.description,
  };
}

/** Every storefront that carries a method or a copy override, sorted. */
export function forcedVerificationStorefronts(document: ForcedVerificationDocument): string[] {
  return [...new Set([...Object.keys(document.overrides), ...Object.keys(document.copy_overrides)])].sort();
}

// ---------------------------------------------------------------------------
// Canonical material comparison
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = record(value);
  if (source) {
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function forcedVerificationDocumentsEqual(left: ForcedVerificationDocument, right: ForcedVerificationDocument): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

// ---------------------------------------------------------------------------
// Response decoders (T-468 discipline: exact envelopes, closed (name, status)
// refusal maps split by envelope source, everything else uncertain)
// ---------------------------------------------------------------------------

export type ForcedRefusal = { ok: false; kind: "refused"; error: string; status: number };
export type ForcedUncertain = { ok: false; kind: "uncertain"; error: string };
export type ForcedDecode<T> = { ok: true; value: T } | ForcedRefusal | ForcedUncertain;

/**
 * Closed Core refusal vocabulary, bound from the published T-470 corpus
 * manifest (`tests/fixtures/verification_forced_wire/manifest.json`:
 * `control_plane_error_statuses` + `boundary_error_statuses`), each with its
 * exact `status_code`. A refusal proves the write did not land. Together with
 * the 503 family below it must equal the published maps exactly (pinned by
 * `tests/verificationForcedWire.test.mts`).
 */
export const FORCED_CORE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["verification-forced-conflict", 409],
  ["verification-forced-invalid", 422],
  ["verification-forced-default-invalid", 422],
  ["verification-forced-overrides-invalid", 422],
  ["verification-forced-copy-default-invalid", 422],
  ["verification-forced-copy-overrides-invalid", 422],
  ["verification-forced-revision-invalid", 422],
  ["admin-write-required", 403],
  ["admin-session-invalid", 401],
  ["unauthorized", 401],
  ["admin-revoked", 403],
]);

/**
 * Core answers after which a write may still have landed, and the read-side
 * "stored document is malformed" state (`verification-forced-unavailable`,
 * contract §2: the gate fails SAFE while the console reports it).
 */
export const FORCED_CORE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["verification-forced-write-failed", 503],
  ["verification-forced-unavailable", 503],
]);

/** Closed bridge refusal vocabulary (`app/api/admin/[action]/route.ts`), answered before Core is called. */
export const FORCED_BRIDGE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["invalid-input", 400],
  ["auth-required", 401],
  ["bad-origin", 403],
  ["admin-write-required", 403],
  ["verification-capability-required", 403],
  ["not-found", 404],
  ["too-large", 413],
]);

/** The bridge's transport trio: Core was called and its answer is unknown. */
export const FORCED_BRIDGE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["core-timeout", 504],
  ["core-unavailable", 502],
  ["invalid-core-response", 502],
]);

export const FORCED_VERIFICATION_UNAVAILABLE_ERROR = "verification-forced-unavailable";

function uncertain(error: string): ForcedUncertain {
  return { ok: false, kind: "uncertain", error };
}

function classifyRefusal(
  error: string,
  status: number,
  refusals: ReadonlyMap<string, number>,
  uncertains: ReadonlyMap<string, number>,
): ForcedRefusal | ForcedUncertain {
  if (refusals.get(error) === status) return { ok: false, kind: "refused", error, status };
  if (uncertains.get(error) === status) return uncertain(error);
  return uncertain("unknown-refusal");
}

/**
 * Envelope-source and material closure: the bridge map applies only to the
 * exact three-key bridge envelope, the Core map only to the exact legacy
 * trio envelope WITHOUT `data` (contract §4: refusals never carry `data`).
 */
function decodeRefusal(value: unknown): ForcedRefusal | ForcedUncertain | null {
  const bridge = adminBridgeErrorEnvelope(value);
  if (bridge) {
    return classifyRefusal(bridge.error, bridge.status_code, FORCED_BRIDGE_REFUSAL_STATUSES, FORCED_BRIDGE_UNCERTAIN_STATUSES);
  }
  const core = webadminErrorEnvelope(value, "forbidden");
  if (core) {
    return classifyRefusal(core.error, core.status_code, FORCED_CORE_REFUSAL_STATUSES, FORCED_CORE_UNCERTAIN_STATUSES);
  }
  return webadminErrorEnvelope(value, "required") ? uncertain("refusal-with-data") : null;
}

function decodeMaterial<T>(value: unknown, parse: (data: unknown) => T | null): ForcedDecode<T> {
  if (value === null || value === undefined) return uncertain("no-response");
  const success = webadminDataSuccessEnvelope(value);
  if (success) {
    const parsed = parse(success.data);
    return parsed === null ? uncertain("malformed-material") : { ok: true, value: parsed };
  }
  return decodeRefusal(value) ?? uncertain("malformed-envelope");
}

export function decodeForcedConsoleResponse(value: unknown): ForcedDecode<ForcedVerificationConsole> {
  return decodeMaterial(value, parseForcedVerificationConsole);
}

export function decodeForcedImpactResponse(value: unknown): ForcedDecode<ForcedVerificationImpact> {
  return decodeMaterial(value, parseForcedVerificationImpact);
}

/**
 * `verification_forced_save`: exact success envelope whose stored document
 * equals the submitted material and whose revision moved past the expected
 * one. An unbound "success" is uncertain, never adopted.
 */
export function decodeForcedSaveResponse(
  value: unknown,
  submitted: { expected_revision: number; document: ForcedVerificationDocument },
): ForcedDecode<ForcedVerificationSaved> {
  const decoded = decodeMaterial(value, parseForcedVerificationSaved);
  if (!decoded.ok) return decoded;
  if (decoded.value.revision <= submitted.expected_revision) return uncertain("unbound-revision");
  if (!forcedVerificationDocumentsEqual(decoded.value.document, submitted.document)) return uncertain("unbound-material");
  return decoded;
}

// ---------------------------------------------------------------------------
// Proxy body normalization (`app/api/admin/[action]/route.ts`)
// ---------------------------------------------------------------------------

export function isForcedVerificationAction(action: string): action is ForcedVerificationAction {
  return (FORCED_VERIFICATION_ACTIONS as readonly string[]).includes(action);
}

/**
 * Per-call recheck of Core's `admin_me.verification_forced` projection at the
 * proxy: `null` for actions outside this family, `false` unless Core lists
 * the exact action for the current operator right now.
 */
export function forcedVerificationProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!isForcedVerificationAction(action)) return null;
  const block = parseForcedVerificationAdminMe(record(membership)?.verification_forced);
  return block !== null && block.contract_ready && block.actions.includes(action);
}

/**
 * The browser sends JSON; Core receives a form body where `document` is the
 * canonical JSON string of exactly `{default, overrides, copy_default,
 * copy_overrides}` (`lib/core.ts` serialises nested objects). Anything the
 * strict parsers refuse is answered `invalid-input` here, before Core.
 */
export function normalizeForcedVerificationProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!isForcedVerificationAction(action)) return undefined;
  switch (action) {
    case "verification_forced_console":
      return exactKeys(body, []) ? {} : null;
    case "verification_forced_save": {
      if (!exactKeys(body, ["expected_revision", "document"])) return null;
      const expectedRevision = revision(body.expected_revision);
      const document = parseForcedVerificationDocument(body.document);
      if (expectedRevision === null || !document) return null;
      return { expected_revision: expectedRevision, document };
    }
    case "verification_forced_impact_preview": {
      if (!exactKeys(body, ["document"])) return null;
      const document = parseForcedVerificationDocument(body.document);
      return document ? { document } : null;
    }
    default:
      return null;
  }
}

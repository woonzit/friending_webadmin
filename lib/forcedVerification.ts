import { getCountryDataList } from "countries-list";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { httpsWireUrl, wellFormedUtf16 } from "@/lib/appearanceRules";
import { webadminDataSuccessEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/**
 * Forced verification + Waiting Room — the Webadmin side of
 * `handoffs/forced-verification-waiting-room-contract.md` v1 §4 (D-053 /
 * D-053a, Amendments v1.1–v1.5). Pure module shared by the proxy route, the
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

/** The bounded text fields of a Waiting Room copy block (contract §4). */
export const WAITING_ROOM_COPY_FIELDS = ["title", "subtitle", "description"] as const;
export type WaitingRoomCopyField = (typeof WAITING_ROOM_COPY_FIELDS)[number];
/** Amendment v1.5: the per-language URL behind the Waiting Room's round "?" button; `null` = no button. */
export const WAITING_ROOM_HELP_URL_FIELD = "help_url" as const;
/** Every key of a copy block, in the order Core compares the key list. */
export const WAITING_ROOM_COPY_KEYS = [...WAITING_ROOM_COPY_FIELDS, WAITING_ROOM_HELP_URL_FIELD] as const;
export type WaitingRoomCopyKey = (typeof WAITING_ROOM_COPY_KEYS)[number];
export type WaitingRoomCopy = Record<WaitingRoomCopyField, string> & { help_url: string | null };
/**
 * A per-storefront override carries only the fields it sets; an absent field
 * inherits. `help_url` inherits by omission like the texts — it is never `null` here.
 */
export type WaitingRoomCopyOverride = Partial<Record<WaitingRoomCopyField, string>> & { help_url?: string };

/** Contract §4: title ≤ 60, subtitle ≤ 90, description ≤ 400 code points. */
export const WAITING_ROOM_COPY_LIMITS: Readonly<Record<WaitingRoomCopyField, number>> = {
  title: 60,
  subtitle: 90,
  description: 400,
};

/** Amendment v1.5: an `https://` URL of at most 2048 UTF-8 bytes after the PHP-compatible trim. */
export const WAITING_ROOM_HELP_URL_MAX_BYTES = 2048;

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
    help_url: null,
  },
  hu: {
    title: "Még egy lépés, mielőtt ismerkedsz",
    subtitle: "A régiódban hitelesítés szükséges",
    description: "A Friending biztonsága érdekében a régiódban minden tagnak igazolnia kell a személyazonosságát, mielőtt használná az appot. Ez körülbelül két percet vesz igénybe, és a dokumentumaidat más tagok soha nem látják.",
    help_url: null,
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
  /**
   * Sorted alpha-3 keys. Core requires EXACTLY the `en` and `hu` containers on
   * every storefront entry (`ForcedVerificationPolicy::normalizeCopyOverrides`),
   * so both are always present; each carries only the overridden fields and an
   * empty object is the valid "inherit every field" container.
   */
  copy_overrides: Record<string, Record<WaitingRoomLocale, WaitingRoomCopyOverride>>;
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

/**
 * Core's `copyText` control class: C0 except TAB, LF and CR, then DEL and the C1
 * range U+0080-U+009F. NEL (U+0085) is therefore a control wherever it sits; at an
 * edge it is also boundary whitespace, and the control refusal is reported first.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * PHP `trim()` strips only `" \t\n\r\0\x0B"`. JavaScript's `String.prototype.trim()`
 * would also strip Unicode whitespace such as U+00A0, which Core refuses at a copy
 * boundary instead of normalising it away — so canonicalisation trims exactly as
 * Core does and any remaining boundary whitespace is a refusal, never a repair.
 */
const PHP_TRIM_EDGE = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g;
export function forcedCopyTrim(value: string): string {
  return value.replace(PHP_TRIM_EDGE, "");
}

/**
 * Core's `BOUNDARY_WHITESPACE_PATTERN`: a Unicode separator (`\p{Z}`), C0 whitespace,
 * NEL or BOM at either edge. A value made only of such whitespace matches as well.
 */
const BOUNDARY_WHITESPACE = /^[\p{Z}\u0009-\u000D\u0085\uFEFF]|[\p{Z}\u0009-\u000D\u0085\uFEFF]$/u;
export function hasBoundaryWhitespace(value: string): boolean {
  return BOUNDARY_WHITESPACE.test(value);
}

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

/** Published copy exactly as Core's `copyText` accepts it: non-empty, PHP-trimmed, no boundary whitespace, bounded, no controls. */
function copyText(value: unknown, field: WaitingRoomCopyField): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return null;
  if (value === "" || forcedCopyTrim(value) !== value || hasBoundaryWhitespace(value)) return null;
  if (waitingRoomTextLength(value) > WAITING_ROOM_COPY_LIMITS[field]) return null;
  return value;
}

/** Core's `webUrl()` control set — C0, DEL and C1 — anywhere in a URL (a line break is never URL content). */
const URL_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
/**
 * The authority as PHP `parse_url` delimits it (Core's `helpUrl`): everything after
 * `https://` up to the first `/`, `?` or `#`. A backslash is authority content there,
 * so `https://example.com\@evil.test/` is user `example.com\` at host `evil.test` for
 * Core, although the WHATWG parser behind `httpsWireUrl` reads it as host `example.com`
 * with path `/@evil.test/`. The credential check must read Core's span.
 */
const PHP_URL_AUTHORITY = /^https:\/\/([^/?#]*)/;

/** UTF-8 bytes of the PHP-trimmed value, the unit Core bounds a URL in (`strlen`). For the editor counter only. */
export function waitingRoomHelpUrlByteLength(value: string): number {
  return new TextEncoder().encode(forcedCopyTrim(value)).length;
}

/**
 * Why an editor value is not a Waiting Room help URL (Amendment v1.5); `null`
 * when it is one, or when it is blank (blank = "no button" on the global
 * default, "inherit" on an override — the caller decides). Rules, in order:
 * well-formed UTF-16 and no control character in the PHP-trimmed value (a
 * lone surrogate can never reach Core as UTF-8); at most 2048 UTF-8 bytes;
 * the appearance console's non-repairing `https://` gate (no `http:`, no
 * form `new URL()` would silently repair); and no credentials — PHP's
 * `parse_url` reads anything before the last `@` of the authority as
 * `user[:pass]`, and that authority ends at the first `/`, `?` or `#` (never at
 * a backslash), so any `@` in that span refuses. The raw trimmed value is what
 * is kept and compared, never a re-serialised form.
 */
export function waitingRoomHelpUrlIssue(value: string): ForcedVerificationDraftIssue | null {
  const trimmed = forcedCopyTrim(value);
  if (trimmed === "") return null;
  if (!wellFormedUtf16(trimmed) || URL_CONTROL_CHARACTERS.test(trimmed)) return "copyHelpUrlControl";
  if (new TextEncoder().encode(trimmed).length > WAITING_ROOM_HELP_URL_MAX_BYTES) return "copyHelpUrlTooLong";
  if (!httpsWireUrl(trimmed)) return "copyHelpUrlInvalid";
  if ((PHP_URL_AUTHORITY.exec(trimmed)?.[1] ?? "").includes("@")) return "copyHelpUrlCredentials";
  return null;
}

/**
 * A published `help_url`: `null`, or a string that is exactly its PHP-trimmed
 * self and passes every editor rule. `undefined` = refused (an empty string is
 * not the `null` form, and an untrimmed value is not proven state).
 */
function helpUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value === "" || forcedCopyTrim(value) !== value) return undefined;
  return waitingRoomHelpUrlIssue(value) === null ? value : undefined;
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

/**
 * A full copy block. `help_url` is optional on READ only: the pinned T-470
 * corpus predates Amendment v1.5 and an absent value resolves to `null`
 * exactly as Core resolves it; the console itself always emits the key.
 */
export function parseWaitingRoomCopy(value: unknown): WaitingRoomCopy | null {
  const source = record(value);
  if (!source || !exactKeys(source, WAITING_ROOM_COPY_FIELDS, [WAITING_ROOM_HELP_URL_FIELD])) return null;
  const title = copyText(source.title, "title");
  const subtitle = copyText(source.subtitle, "subtitle");
  const description = copyText(source.description, "description");
  const help = Object.hasOwn(source, WAITING_ROOM_HELP_URL_FIELD) ? helpUrl(source.help_url) : null;
  if (title === null || subtitle === null || description === null || help === undefined) return null;
  // Key order is what Core compares on the way back in: `help_url` last.
  return { title, subtitle, description, help_url: help };
}

export function parseWaitingRoomCopyOverride(value: unknown): WaitingRoomCopyOverride | null {
  const source = record(value);
  if (!source || !subsetKeys(source, WAITING_ROOM_COPY_KEYS)) return null;
  const output: WaitingRoomCopyOverride = {};
  for (const field of WAITING_ROOM_COPY_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    const text = copyText(source[field], field);
    if (text === null) return null;
    output[field] = text;
  }
  if (Object.hasOwn(source, WAITING_ROOM_HELP_URL_FIELD)) {
    // An override inherits by omitting the key; `null` is not an override value.
    const help = helpUrl(source.help_url);
    if (help === undefined || help === null) return null;
    output.help_url = help;
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

/**
 * A storefront copy override as Core stores it: exactly the `en` and `hu`
 * containers, each holding only overridden fields. A partial container ({} or
 * one locale only) is refused rather than treated as proven state — Core would
 * reject the same shape on the way back in.
 */
function parseLocalizedCopyOverride(value: unknown): Record<WaitingRoomLocale, WaitingRoomCopyOverride> | null {
  const source = record(value);
  if (!source || !exactKeys(source, WAITING_ROOM_LOCALES)) return null;
  const en = parseWaitingRoomCopyOverride(source.en);
  const hu = parseWaitingRoomCopyOverride(source.hu);
  return en && hu ? { en, hu } : null;
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
/** Editor form of one copy block: every key a string. A blank `help_url` is `null` on the global default and "inherit" on an override. */
export type WaitingRoomCopyDraft = Record<WaitingRoomCopyKey, string>;
/** Editor form of a storefront copy override: every field present, blank = inherit. */
export type WaitingRoomCopyOverrideDraft = Record<WaitingRoomLocale, WaitingRoomCopyDraft>;

export type ForcedVerificationDraft = {
  default: ForcedMethods;
  overrides: ForcedOverrideRow[];
  copy_default: Record<WaitingRoomLocale, WaitingRoomCopyDraft>;
  copy_overrides: Record<string, WaitingRoomCopyOverrideDraft>;
};

export type ForcedVerificationDraftIssue =
  | "storefront"
  | "duplicateStorefront"
  | "copyRequired"
  | "copyTooLong"
  | "copyControl"
  | "copyWhitespace"
  | "copyHelpUrlInvalid"
  | "copyHelpUrlTooLong"
  | "copyHelpUrlControl"
  | "copyHelpUrlCredentials";

export function emptyWaitingRoomCopyDraft(): WaitingRoomCopyDraft {
  return { title: "", subtitle: "", description: "", help_url: "" };
}

export function emptyWaitingRoomCopyOverrideDraft(): WaitingRoomCopyOverrideDraft {
  return { en: emptyWaitingRoomCopyDraft(), hu: emptyWaitingRoomCopyDraft() };
}

/** The editor form of a published copy block (`help_url: null` edits as a blank field). */
export function waitingRoomCopyDraft(copy: WaitingRoomCopy): WaitingRoomCopyDraft {
  return { title: copy.title, subtitle: copy.subtitle, description: copy.description, help_url: copy.help_url ?? "" };
}

export function forcedVerificationDraft(document: ForcedVerificationDocument): ForcedVerificationDraft {
  const copyOverrides: Record<string, WaitingRoomCopyOverrideDraft> = {};
  for (const [storefront, locales] of Object.entries(document.copy_overrides)) {
    const draft = emptyWaitingRoomCopyOverrideDraft();
    for (const locale of WAITING_ROOM_LOCALES) {
      const override = locales[locale];
      if (!override) continue;
      for (const key of WAITING_ROOM_COPY_KEYS) draft[locale][key] = override[key] ?? "";
    }
    copyOverrides[storefront] = draft;
  }
  return {
    default: { ...document.default },
    overrides: Object.entries(document.overrides).map(([storefront, methods]) => ({ storefront, ...methods })),
    copy_default: { en: waitingRoomCopyDraft(document.copy_default.en), hu: waitingRoomCopyDraft(document.copy_default.hu) },
    copy_overrides: copyOverrides,
  };
}

function copyIssue(value: string, field: WaitingRoomCopyField, required: boolean): ForcedVerificationDraftIssue | null {
  const trimmed = forcedCopyTrim(value);
  if (trimmed === "") return required ? "copyRequired" : null;
  if (CONTROL_CHARACTERS.test(trimmed) || (field !== "description" && /[\n\r]/.test(trimmed))) return "copyControl";
  if (hasBoundaryWhitespace(trimmed)) return "copyWhitespace";
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
    const helpIssue = waitingRoomHelpUrlIssue(draft.copy_default[locale].help_url);
    if (helpIssue) return helpIssue;
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
      const helpIssue = waitingRoomHelpUrlIssue(draft.copy_overrides[storefront][locale].help_url);
      if (helpIssue) return helpIssue;
    }
  }
  return null;
}

/**
 * The canonical document for a valid draft (`null` otherwise): PHP-trimmed text
 * (Unicode boundary whitespace is a validation refusal, never trimmed), storefront
 * keys sorted, blank override fields absent, empty locale and storefront override
 * objects dropped.
 */
export function forcedVerificationDocumentFromDraft(draft: ForcedVerificationDraft): ForcedVerificationDocument | null {
  if (validateForcedVerificationDraft(draft) !== null) return null;
  const overrides: Record<string, ForcedMethods> = {};
  for (const row of [...draft.overrides].sort((left, right) => left.storefront.localeCompare(right.storefront))) {
    overrides[row.storefront] = { persona: row.persona, video: row.video };
  }
  const copyOverrides: ForcedVerificationDocument["copy_overrides"] = {};
  for (const storefront of Object.keys(draft.copy_overrides).sort()) {
    // `en` is inserted before `hu` because Core compares the key list exactly.
    // A locale the operator left blank travels as an empty object, never as a
    // missing key: an entry with one locale is refused by Core.
    const locales = {} as Record<WaitingRoomLocale, WaitingRoomCopyOverride>;
    let fields = 0;
    for (const locale of WAITING_ROOM_LOCALES) {
      const override: WaitingRoomCopyOverride = {};
      for (const field of WAITING_ROOM_COPY_FIELDS) {
        const text = forcedCopyTrim(draft.copy_overrides[storefront][locale][field]);
        if (text !== "") override[field] = text;
      }
      // A blank help URL inherits by omission (Amendment v1.5), like a blank text.
      const help = forcedCopyTrim(draft.copy_overrides[storefront][locale].help_url);
      if (help !== "") override.help_url = help;
      locales[locale] = override;
      fields += Object.keys(override).length;
    }
    // A storefront whose two containers are both empty overrides nothing at all.
    if (fields > 0) copyOverrides[storefront] = locales;
  }
  const trimCopy = (copy: WaitingRoomCopyDraft): WaitingRoomCopy => {
    const help = forcedCopyTrim(copy.help_url);
    return {
      title: forcedCopyTrim(copy.title),
      subtitle: forcedCopyTrim(copy.subtitle),
      description: forcedCopyTrim(copy.description),
      // Always present on the global default (`null` = no button), and last: Core compares the key list in order.
      help_url: help === "" ? null : help,
    };
  };
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
    help_url: override?.help_url ?? base.help_url,
  };
}

/** Every storefront that carries a method or a copy override, sorted. */
export function forcedVerificationStorefronts(document: ForcedVerificationDocument): string[] {
  return [...new Set([...Object.keys(document.overrides), ...Object.keys(document.copy_overrides)])].sort();
}

// ---------------------------------------------------------------------------
// Draft preview (contract Amendment v1.4: copy is presentation, not authorization)
// ---------------------------------------------------------------------------

/** The method set a draft would force for a storefront: the first exact override row, else the global default. */
export function resolveDraftForcedMethods(draft: ForcedVerificationDraft, storefront: string | null): ForcedMethods {
  const row = storefront === null ? undefined : draft.overrides.find((entry) => entry.storefront === storefront);
  return row ? { persona: row.persona, video: row.video } : { ...draft.default };
}

export type WaitingRoomPreviewCopy = { copy: WaitingRoomCopy; compiledFields: WaitingRoomCopyKey[] };

/**
 * The Waiting Room copy a preview renders for a draft: per field the non-blank storefront
 * override, else the global default of the same locale. A malformed or missing value
 * degrades to the compiled copy for that field only and is reported in `compiledFields`;
 * the forced methods are never affected by copy (Amendment v1.4). The help URL follows
 * the same chain, ending in the compiled `null`: the round "?" button exists only for an
 * effective, well-formed URL, and a malformed value degrades to "no button" (v1.5).
 */
export function previewWaitingRoomCopy(
  draft: ForcedVerificationDraft,
  storefront: string | null,
  locale: WaitingRoomLocale,
  compiled: Record<WaitingRoomLocale, WaitingRoomCopy>,
): WaitingRoomPreviewCopy {
  const override = storefront === null ? undefined : draft.copy_overrides[storefront]?.[locale];
  const copy: WaitingRoomCopy = { ...compiled[locale] };
  const compiledFields: WaitingRoomCopyKey[] = [];
  for (const field of WAITING_ROOM_COPY_FIELDS) {
    const overrideText = override ? override[field] : "";
    const candidate = forcedCopyTrim(overrideText) !== "" ? overrideText : draft.copy_default[locale][field];
    if (copyIssue(candidate, field, true) === null) copy[field] = forcedCopyTrim(candidate);
    else compiledFields.push(field);
  }
  const overrideHelp = override ? override.help_url : "";
  const helpCandidate = forcedCopyTrim(overrideHelp) !== "" ? overrideHelp : draft.copy_default[locale].help_url;
  const help = forcedCopyTrim(helpCandidate);
  if (waitingRoomHelpUrlIssue(helpCandidate) !== null) compiledFields.push(WAITING_ROOM_HELP_URL_FIELD);
  else if (help !== "") copy.help_url = help;
  return { copy, compiledFields };
}

/** Every storefront a draft names in a method row or a copy override, sorted; blank rows are skipped. */
export function forcedVerificationDraftStorefronts(draft: ForcedVerificationDraft): string[] {
  const rows = draft.overrides.map((row) => row.storefront).filter((storefront) => storefront !== "");
  return [...new Set([...rows, ...Object.keys(draft.copy_overrides)])].sort();
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
 * equals the submitted material and whose revision is the EXACT successor of
 * the expected one. Core increments an accepted save by exactly one
 * (`ForcedVerificationAdminService::save`), so a skipped, unchanged or stale
 * revision is an unbound "success": uncertain, never adopted.
 */
export function decodeForcedSaveResponse(
  value: unknown,
  submitted: { expected_revision: number; document: ForcedVerificationDocument },
): ForcedDecode<ForcedVerificationSaved> {
  const decoded = decodeMaterial(value, parseForcedVerificationSaved);
  if (!decoded.ok) return decoded;
  if (decoded.value.revision !== submitted.expected_revision + 1) return uncertain("unbound-revision");
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

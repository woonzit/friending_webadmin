import { getCountryDataList } from "countries-list";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { wellFormedUtf16 } from "@/lib/appearanceRules";
import { webadminDataSuccessEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/**
 * Mandatory verification + Waiting Room — the SHARED presentation layer of the
 * T-617 method console (`handoffs/verification-method-console-contract.md`).
 *
 * This module owns exactly two things that Core also owns, and that both the
 * method console and its phone preview depend on: the closed App Store
 * storefront catalogue (ISO 3166-1 alpha-3, D-049 model) and the Waiting Room
 * copy vocabulary with its byte-for-byte Core validators — bounded Unicode
 * text, PHP-compatible trimming, boundary-whitespace refusal, the RFC 3986
 * `help_url` rules and the compiled defaults. Core reuses
 * `ForcedVerificationPolicy` to normalize the T-617 document, so these rules
 * must not drift from it.
 *
 * The retired half of D-053 — the two independent `{persona, video}` booleans,
 * the `verification_forced_*` action family and its decoders — is gone with
 * T-617 (contract §6.1: the Admin calls none of them, and Core answers
 * `verification-forced-read-only` on the save). The scalar
 * `persona | video | none` document, its endpoints and its editor live in
 * `lib/verificationMethod.ts`.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

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
  // Same-origin command material stays exact so undeclared fields cannot reach Core.
  const keys = Object.keys(source);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) return false;
  if (required.some((key) => !Object.hasOwn(source, key))) return false;
  return new Set(keys).size === keys.length;
}

function requiredKeys(source: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(source, key));
}

/**
 * How strictly a key list is read. `server` tolerates additive fields on a Core
 * READ; `exact` is used for outbound command material, so an undeclared field
 * can never reach Core.
 */
export type KeyPolicy = "server" | "exact";

function acceptedKeys(
  source: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  policy: KeyPolicy,
): boolean {
  return policy === "exact"
    ? exactKeys(source, required, optional)
    : requiredKeys(source, required);
}

function subsetKeys(source: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(source).every((key) => allowed.includes(key));
}

export function waitingRoomTextLength(value: string): number {
  return [...value].length;
}

/** Published copy exactly as Core's `copyText` accepts it: valid UTF-8, non-empty, PHP-trimmed, no boundary whitespace, bounded, no controls. */
function copyText(value: unknown, field: WaitingRoomCopyField): string | null {
  if (typeof value !== "string" || !wellFormedUtf16(value) || CONTROL_CHARACTERS.test(value)) return null;
  if (value === "" || forcedCopyTrim(value) !== value || hasBoundaryWhitespace(value)) return null;
  if (waitingRoomTextLength(value) > WAITING_ROOM_COPY_LIMITS[field]) return null;
  return value;
}

/** Core's `webUrl()` control set — C0, DEL and C1 — anywhere in a URL (a line break is never URL content). */
const URL_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
/** Core c0a4212 `ForcedVerificationPolicy::HELP_URL_CHARACTER_PATTERN`: RFC 3986 ASCII URL characters only. */
const HELP_URL_CHARACTER_PATTERN = /^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;
/** Core c0a4212 `ForcedVerificationPolicy::HELP_URL_HOST_PATTERN`: DNS labels, including punycode, but no raw IDN or IPv6. */
const HELP_URL_HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
/** Core c0a4212 requires a present port to be canonical decimal in the inclusive range 1...65535. */
const HELP_URL_PORT_PATTERN = /^[1-9][0-9]{0,4}$/;
const HELP_URL_PORT_MAX = 65_535;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
/**
 * The authority as PHP `parse_url` delimits it (Core's `helpUrl`): everything after
 * `https://` up to the first `/`, `?` or `#`. Core's ASCII character pattern refuses
 * a backslash before any authority parsing can reinterpret it.
 */
const PHP_URL_AUTHORITY = /^https:\/\/([^/?#]*)/;

/** UTF-8 bytes of the raw editor value, the unit Core bounds a URL in (`strlen`). For the editor counter only. */
export function waitingRoomHelpUrlByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Why an editor value is not a Waiting Room help URL (Amendment v1.5); `null`
 * only when the raw value is one. This deliberately mirrors Core c0a4212
 * `src/Support/ForcedVerificationPolicy.php::helpUrl`: well-formed text;
 * at most 2048 raw UTF-8 bytes; RFC 3986 ASCII characters with valid percent
 * escapes; exact lowercase `https://`; a non-empty DNS-style host; an optional
 * canonical port in 1...65535; and no credentials. The draft-only empty-string
 * sentinel is handled separately by `waitingRoomHelpUrlDraftIssue`.
 */
export function waitingRoomHelpUrlIssue(value: unknown): ForcedVerificationDraftIssue | null {
  if (typeof value !== "string" || value === "") return "copyHelpUrlInvalid";
  if (!wellFormedUtf16(value) || URL_CONTROL_CHARACTERS.test(value)) return "copyHelpUrlControl";
  if (new TextEncoder().encode(value).length > WAITING_ROOM_HELP_URL_MAX_BYTES) return "copyHelpUrlTooLong";
  if (
    !HELP_URL_CHARACTER_PATTERN.test(value) ||
    MALFORMED_PERCENT_ESCAPE.test(value) ||
    !value.startsWith("https://")
  ) return "copyHelpUrlInvalid";

  const authority = PHP_URL_AUTHORITY.exec(value)?.[1] ?? "";
  if (authority === "") return "copyHelpUrlInvalid";
  if (authority.includes("@")) return "copyHelpUrlCredentials";
  const colon = authority.indexOf(":");
  const host = colon === -1 ? authority : authority.slice(0, colon);
  const port = colon === -1 ? null : authority.slice(colon + 1);
  if (!HELP_URL_HOST_PATTERN.test(host)) return "copyHelpUrlInvalid";
  if (
    port !== null &&
    (!HELP_URL_PORT_PATTERN.test(port) || Number.parseInt(port, 10) > HELP_URL_PORT_MAX)
  ) return "copyHelpUrlInvalid";
  return null;
}

/** Empty is the editor's explicit no-button/inherit sentinel; every non-empty value uses Core's strict validator. */
export function waitingRoomHelpUrlDraftIssue(value: string): ForcedVerificationDraftIssue | null {
  return value === "" ? null : waitingRoomHelpUrlIssue(value);
}

/**
 * A published `help_url`: `null`, or a raw string that passes every Core rule.
 * `undefined` = refused (an empty string is not the `null` form).
 */
function helpUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return waitingRoomHelpUrlIssue(value) === null ? value : undefined;
}

/**
 * A full copy block. `help_url` is optional on READ only: the pinned T-470
 * corpus predates Amendment v1.5 and an absent value resolves to `null`
 * exactly as Core resolves it; the console itself always emits the key.
 */
export function parseWaitingRoomCopy(
  value: unknown,
  policy: KeyPolicy = "server",
): WaitingRoomCopy | null {
  const source = record(value);
  if (!source || !acceptedKeys(
    source,
    WAITING_ROOM_COPY_FIELDS,
    [WAITING_ROOM_HELP_URL_FIELD],
    policy,
  )) return null;
  const title = copyText(source.title, "title");
  const subtitle = copyText(source.subtitle, "subtitle");
  const description = copyText(source.description, "description");
  const help = Object.hasOwn(source, WAITING_ROOM_HELP_URL_FIELD) ? helpUrl(source.help_url) : null;
  if (title === null || subtitle === null || description === null || help === undefined) return null;
  // Key order is what Core compares on the way back in: `help_url` last.
  return { title, subtitle, description, help_url: help };
}

export function parseWaitingRoomCopyOverride(
  value: unknown,
  policy: KeyPolicy = "server",
): WaitingRoomCopyOverride | null {
  const source = record(value);
  if (!source || (policy === "exact" && !subsetKeys(source, WAITING_ROOM_COPY_KEYS))) return null;
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

// ---------------------------------------------------------------------------
// Editor draft ↔ document
// ---------------------------------------------------------------------------

/** Editor form of one copy block: every key a string. A blank `help_url` is `null` on the global default and "inherit" on an override. */
export type WaitingRoomCopyDraft = Record<WaitingRoomCopyKey, string>;
/** Editor form of a storefront copy override: every field present, blank = inherit. */
export type WaitingRoomCopyOverrideDraft = Record<WaitingRoomLocale, WaitingRoomCopyDraft>;

export type ForcedVerificationDraftIssue =
  | "storefront"
  | "duplicateStorefront"
  | "copyRequired"
  | "copyTooLong"
  | "copyControl"
  | "copyMalformedText"
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

/**
 * Why an editor value is not acceptable Waiting Room copy; `null` when it is.
 * `required` distinguishes a complete global field from an override field,
 * where blank means "inherit". Shared with the T-617 method-console editor.
 */
export function waitingRoomCopyIssue(value: string, field: WaitingRoomCopyField, required: boolean): ForcedVerificationDraftIssue | null {
  const trimmed = forcedCopyTrim(value);
  if (trimmed === "") return required ? "copyRequired" : null;
  if (!wellFormedUtf16(trimmed)) return "copyMalformedText";
  if (CONTROL_CHARACTERS.test(trimmed) || (field !== "description" && /[\n\r]/.test(trimmed))) return "copyControl";
  if (hasBoundaryWhitespace(trimmed)) return "copyWhitespace";
  if (waitingRoomTextLength(trimmed) > WAITING_ROOM_COPY_LIMITS[field]) return "copyTooLong";
  return null;
}

/** Conservative client validation; Core's `verification-forced-invalid` remains the authority. */
// ---------------------------------------------------------------------------
// Copy preview (D-053 Amendment v1.4: copy is presentation, not authorization)
// ---------------------------------------------------------------------------

export type WaitingRoomPreviewCopy = { copy: WaitingRoomCopy; compiledFields: WaitingRoomCopyKey[] };

/**
 * The Waiting Room copy a preview renders: per field the non-blank storefront
 * override, else the global draft value of the same locale. A malformed or
 * missing value degrades to the COMPILED copy for that field only and is
 * reported in `compiledFields`; the mandatory method is never affected by copy.
 * The help URL follows the same chain, ending in the compiled `null`: the round
 * "?" button exists only for an effective, well-formed URL, and a malformed
 * value degrades to "no button".
 */
export function previewWaitingRoomCopy(
  override: WaitingRoomCopyDraft | null,
  globalDraft: WaitingRoomCopyDraft,
  locale: WaitingRoomLocale,
  compiled: Record<WaitingRoomLocale, WaitingRoomCopy>,
): WaitingRoomPreviewCopy {
  const copy: WaitingRoomCopy = { ...compiled[locale] };
  const compiledFields: WaitingRoomCopyKey[] = [];
  for (const field of WAITING_ROOM_COPY_FIELDS) {
    const overrideText = override ? override[field] : "";
    const candidate = forcedCopyTrim(overrideText) !== "" ? overrideText : globalDraft[field];
    if (waitingRoomCopyIssue(candidate, field, true) === null) copy[field] = forcedCopyTrim(candidate);
    else compiledFields.push(field);
  }
  const overrideHelp = override ? override.help_url : "";
  const helpCandidate = overrideHelp !== "" ? overrideHelp : globalDraft.help_url;
  if (helpCandidate === "") {
    // The compiled default is null: no help button is a valid configured state.
  } else if (waitingRoomHelpUrlIssue(helpCandidate) !== null) {
    compiledFields.push(WAITING_ROOM_HELP_URL_FIELD);
  } else {
    copy.help_url = helpCandidate;
  }
  return { copy, compiledFields };
}

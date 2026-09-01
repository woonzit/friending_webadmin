import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { wellFormedUtf16 } from "@/lib/appearanceRules";
import { webadminDataSuccessEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/**
 * Persona verification screens copy — the Webadmin side of
 * `handoffs/persona-screens-contract.md` v1 (D-077, D-080 R1–R5, D-089,
 * T-551, T-594).
 * Pure module shared by the proxy route and the console card; no `server-only`
 * import because the browser runs the same closed parsers.
 *
 * Core owns storage (`app_settings`), validation, the revision, the audit row
 * and the published block. This module decodes Core's exact material, keeps the
 * editor draft coherent, and refuses to forward anything Core would not accept.
 *
 * ===========================================================================
 * R2 — THE RULE THIS MODULE EXISTS TO KEEP, AND WHY IT IS A SIGNATURE
 * ===========================================================================
 *
 * Core resolves for the request's language and publishes ONLY that language's
 * block; a slot the requested language has no stored value for is OMITTED, and
 * the app renders its own compiled string. Stated as the invariant every lane
 * must preserve: NO ENGLISH STRING AN OPERATOR TYPED CAN EVER APPEAR IN A
 * HUNGARIAN SESSION.
 *
 * Core can no longer break that. THIS CONSOLE CAN — and it is the only thing
 * left that can. If the editor pre-fills the Hungarian box from the English
 * value, or from `compiled_reference`, and an operator presses save, Core
 * publishes an operator-typed "Hungarian" value that is English, behaving
 * perfectly the whole way. That is D-077 reintroduced by hand.
 *
 * So the draft functions below take ONE argument each:
 *
 *   personaScreensDraft(copyDefault)              — the stored document only
 *   personaScreensDocumentFromDraft(draft)        — the draft only
 *
 * `compiled_reference` is not in their scope, is not reachable from them, and
 * is not passed to them; neither is any notion of "the other language", because
 * `languageDraft()` is a single subscript that cannot reach a sibling key. This
 * is the same argument `PersonaScreensPolicy::appConfigBlock()` makes in Core:
 * there is no `??` chain for a future editor to extend, because there is
 * nothing to extend it to. `tests/personaScreens.test.mts` pins both arities.
 *
 * The reference meets the draft in exactly one place — `personaScreenPreview()`
 * — whose result is display text and can reach no document.
 *
 * An empty COMPILED-COPY editor box is CORRECT and means "this language has no
 * stored value; the app uses its own compiled string". The optional PRE link is
 * deliberately different: it has no compiled default, so either empty control
 * means no button. Keeping those two kinds of slot separate below is part of the
 * contract rather than a presentation convenience.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies (contract §2; served on the console read so the browser
// does not hardcode them, and pinned here so a drift is noticed)
// ---------------------------------------------------------------------------

export const PERSONA_SCREENS_ACTIONS = [
  "persona_screens_console",
  "persona_screens_save",
] as const;
export type PersonaScreensAction = (typeof PERSONA_SCREENS_ACTIONS)[number];

export const PERSONA_SCREEN_KEYS = ["pre", "success", "failed"] as const;
export type PersonaScreenKey = (typeof PERSONA_SCREEN_KEYS)[number];

export const PERSONA_SCREEN_SLOTS = ["headline", "subtitle", "cta"] as const;
export type PersonaScreenSlot = (typeof PERSONA_SCREEN_SLOTS)[number];

export const PERSONA_SCREEN_EXTERNAL_LINK_SLOT = "external_link" as const;
export const PERSONA_SCREEN_EXTERNAL_LINK_FIELDS = ["label", "url"] as const;
export type PersonaScreenExternalLinkField =
  (typeof PERSONA_SCREEN_EXTERNAL_LINK_FIELDS)[number];

/** D-089: the structured slot is PRE-only and sits between subtitle and CTA. */
export const PERSONA_SCREEN_PRESENTATION_SLOTS = {
  pre: ["headline", "subtitle", PERSONA_SCREEN_EXTERNAL_LINK_SLOT, "cta"],
  success: PERSONA_SCREEN_SLOTS,
  failed: PERSONA_SCREEN_SLOTS,
} as const satisfies Readonly<Record<
  PersonaScreenKey,
  readonly (PersonaScreenSlot | typeof PERSONA_SCREEN_EXTERNAL_LINK_SLOT)[]
>>;

export const PERSONA_SCREEN_LANGUAGES = ["en", "hu"] as const;
export type PersonaScreenLanguage = (typeof PERSONA_SCREEN_LANGUAGES)[number];

/**
 * Contract §6, in UTF-8 BYTES rather than characters: the cap bounds the launch
 * payload, and a Hungarian accented character costs two bytes, so a Hungarian
 * operator has fewer characters than an English one for the same slot.
 */
export const PERSONA_SCREEN_SLOT_BYTE_LIMITS: Readonly<Record<PersonaScreenSlot, number>> = {
  headline: 120,
  subtitle: 320,
  cta: 40,
};

export const PERSONA_SCREEN_EXTERNAL_LINK_FIELD_BYTE_LIMITS:
  Readonly<Record<PersonaScreenExternalLinkField, number>> = {
  label: 80,
  url: 2048,
};
export const PERSONA_SCREEN_EXTERNAL_LINK_URL_SCHEMES = ["https"] as const;

export const PERSONA_SCREENS_CONTRACT_VERSION = 1;
/** Contract §9: this family's OWN revision, seeded 1 — never the forced-verification counter. */
export const PERSONA_SCREENS_REVISION_MAX = 9_007_199_254_740_991;

export const PERSONA_SCREENS_DOCUMENT_KEYS = ["copy_default"] as const;
export const PERSONA_SCREENS_CONSOLE_KEYS = [
  "revision",
  "copy_default",
  "compiled_reference",
  "reference_authority",
  "screens",
  "slots",
  "languages",
  "slot_byte_limits",
] as const;
export const PERSONA_SCREENS_SAVED_KEYS = ["revision", "copy_default"] as const;

/** Contract §7: the label for the mirror, so the console can say where the reference came from. */
export const PERSONA_SCREENS_REFERENCE_AUTHORITY = "ios:Localizable.strings:verification.screen.*";

export const PERSONA_SCREENS_UNAVAILABLE_ERROR = "persona-screens-unavailable";
export const PERSONA_SCREENS_CONFLICT_ERROR = "persona-screens-conflict";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any subset — a slot appears only where an operator stored something. */
export type PersonaScreenExternalLink = Partial<Record<PersonaScreenExternalLinkField, string>>;
export type PersonaScreenSlotMap = Partial<Record<PersonaScreenSlot, string>> & {
  /** PRE-only. A valid one-field object is retained but publishes no button. */
  external_link?: PersonaScreenExternalLink;
};
export type PersonaScreenMap = Partial<Record<PersonaScreenKey, PersonaScreenSlotMap>>;
export type PersonaScreensCopyDefault = Partial<Record<PersonaScreenLanguage, PersonaScreenMap>>;

/**
 * The iOS compiled strings Core mirrors, COMPLETE for both languages
 * (contract §7). Placeholder text and preview text only: it is never a value,
 * never the initial content of a save, and never crosses into a draft.
 */
export type PersonaScreensReference =
  Record<PersonaScreenLanguage, Record<PersonaScreenKey, Record<PersonaScreenSlot, string>>>;

export type PersonaScreensConsole = {
  revision: number;
  copy_default: PersonaScreensCopyDefault;
  compiled_reference: PersonaScreensReference;
  reference_authority: string;
  screens: readonly PersonaScreenKey[];
  slots: readonly PersonaScreenSlot[];
  languages: readonly PersonaScreenLanguage[];
  slot_byte_limits: Record<PersonaScreenSlot, number>;
};

export type PersonaScreensDocument = { copy_default: PersonaScreensCopyDefault };
export type PersonaScreensSaved = { revision: number; copy_default: PersonaScreensCopyDefault };

/** Core's `admin_me.persona_screens` projection (contract §5). */
export type PersonaScreensAdminMe = {
  contract_version: number;
  contract_ready: boolean;
  actions: PersonaScreensAction[];
};

/** What the current operator may do, derived from Core's projection only. */
export type PersonaScreensAccess = { visible: boolean; editable: boolean };

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(source: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(source);
  return keys.length === required.length && required.every((key) => Object.hasOwn(source, key));
}

/** Contract §2: seeded 1, incremented by exactly one per accepted save. */
function parseRevision(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= PERSONA_SCREENS_REVISION_MAX
    ? value
    : null;
}

/** UTF-8 bytes, the unit Core measures a slot in (`strlen`). */
export function personaScreenSlotByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

/**
 * Core `PersonaScreensPolicy::BOUNDARY_WHITESPACE_PATTERN`. The zero-width
 * characters are refused at the BOUNDARY only, never in the middle: U+200D is
 * the emoji zero-width joiner, so refusing it everywhere would reject a
 * legitimate "Get started 👨‍👩‍👧".
 */
const BOUNDARY_WHITESPACE_CLASS = "[\\p{Z}\\u0009-\\u000D\\u0085\\u200B-\\u200D\\u2060\\uFEFF]";
const BOUNDARY_WHITESPACE = new RegExp(
  `^${BOUNDARY_WHITESPACE_CLASS}|${BOUNDARY_WHITESPACE_CLASS}$`,
  "u",
);
/** Core `PersonaScreensPolicy::CONTROL_CHARACTER_PATTERN`: C0, C1, and the two line/paragraph separators. */
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/u;

/** Core's PHP `trim()` character set, which is not JavaScript's. */
const PHP_TRIM_EDGE = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g;
export function personaScreenTrim(value: string): string {
  return value.replace(PHP_TRIM_EDGE, "");
}

/**
 * READ-time acceptance for one stored slot value, mirroring Core's
 * `readableText()`. Deliberately looser than the write check: R5's markup and
 * the HTML refusal are write-time rules, so a value stored before them still
 * decodes rather than blanking a slot the operator can see.
 */
function readableBoundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string"
    || value === ""
    || !wellFormedUtf16(value)
    || personaScreenTrim(value) !== value
    || personaScreenSlotByteLength(value) > limit
    || BOUNDARY_WHITESPACE.test(value)
    || CONTROL_CHARACTERS.test(value)) return null;
  return value;
}

function readableSlotText(value: unknown, slot: PersonaScreenSlot): string | null {
  return readableBoundedText(value, PERSONA_SCREEN_SLOT_BYTE_LIMITS[slot]);
}

/**
 * Core's D-089 URL gate: one case-insensitive scheme, an absolute host, and no
 * userinfo. The raw string is retained; URL is used only to validate it.
 *
 * PHP's `FILTER_VALIDATE_URL` accepts ASCII URL syntax rather than silently
 * punycoding input. The explicit ASCII and host-label checks keep the browser
 * from accepting a string Core would refuse before the shared structural
 * checks are applied.
 */
export function personaScreenExternalLinkUrlAllowed(value: string): boolean {
  if (!/^[\x21-\x7E]+$/u.test(value)
    || !/^https:\/\//iu.test(value)
    || value.includes("\\")) return false;

  const authorityEnd = value.slice("https://".length).search(/[/?#]/u);
  const authority = authorityEnd === -1
    ? value.slice("https://".length)
    : value.slice("https://".length, "https://".length + authorityEnd);
  // Even empty userinfo produces a `user` key in Core's `parse_url()` result.
  if (authority === "" || authority.includes("@")) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== "https:"
      || parsed.hostname === ""
      || parsed.username !== ""
      || parsed.password !== "") return false;
    if (parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")) {
      return /^\[[0-9a-f:.]+\]$/iu.test(parsed.hostname);
    }
    const hostname = parsed.hostname.endsWith(".")
      ? parsed.hostname.slice(0, -1)
      : parsed.hostname;
    return hostname.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
  } catch {
    return false;
  }
}

function readableExternalLinkField(
  value: unknown,
  field: PersonaScreenExternalLinkField,
): string | null {
  const text = readableBoundedText(
    value,
    PERSONA_SCREEN_EXTERNAL_LINK_FIELD_BYTE_LIMITS[field],
  );
  if (text === null) return null;
  return field === "url" && !personaScreenExternalLinkUrlAllowed(text) ? null : text;
}

/** Strict console/saved-response decoding of the structured stored slot. */
function parseReadableExternalLink(value: unknown): PersonaScreenExternalLink | null {
  const source = record(value);
  if (!source) return null;
  const keys = Object.keys(source);
  if (keys.length === 0
    || keys.some((field) => !(PERSONA_SCREEN_EXTERNAL_LINK_FIELDS as readonly string[])
      .includes(field))) return null;
  const link: PersonaScreenExternalLink = {};
  for (const field of PERSONA_SCREEN_EXTERNAL_LINK_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    const text = readableExternalLinkField(source[field], field);
    if (text === null) return null;
    link[field] = text;
  }
  return link;
}

// ---------------------------------------------------------------------------
// Console material
// ---------------------------------------------------------------------------

/**
 * Core's console read is the STRICT projection: `PersonaScreensConfigurationService
 * ::strictSnapshot()` refuses a stored document outside the closed vocabulary
 * and answers `persona-screens-unavailable` instead, so an operator is never
 * shown a silently repaired version of what is stored. This parser is strict
 * for the same reason — an unknown key here means the payload is not the one
 * the contract describes, and adopting it would put an unowned string in front
 * of an operator as if it were theirs.
 */
export function parsePersonaScreensCopyDefault(value: unknown): PersonaScreensCopyDefault | null {
  const languages = record(value);
  if (!languages) return null;
  const result: PersonaScreensCopyDefault = {};
  for (const language of Object.keys(languages)) {
    if (!(PERSONA_SCREEN_LANGUAGES as readonly string[]).includes(language)) return null;
    const screens = record(languages[language]);
    if (!screens) return null;
    const parsedScreens: PersonaScreenMap = {};
    for (const screen of Object.keys(screens)) {
      if (!(PERSONA_SCREEN_KEYS as readonly string[]).includes(screen)) return null;
      const slots = record(screens[screen]);
      if (!slots) return null;
      const parsedSlots: PersonaScreenSlotMap = {};
      for (const slot of Object.keys(slots)) {
        if (!(PERSONA_SCREEN_PRESENTATION_SLOTS[screen as PersonaScreenKey] as readonly string[])
          .includes(slot)) return null;
        if (slot === PERSONA_SCREEN_EXTERNAL_LINK_SLOT) {
          const link = parseReadableExternalLink(slots[slot]);
          if (link === null) return null;
          parsedSlots.external_link = link;
          continue;
        }
        const text = readableSlotText(slots[slot], slot as PersonaScreenSlot);
        if (text === null) return null;
        parsedSlots[slot as PersonaScreenSlot] = text;
      }
      // Core omits an empty screen; an explicitly empty one is a shape the
      // contract does not describe, so it is refused rather than flattened.
      if (Object.keys(parsedSlots).length === 0) return null;
      parsedScreens[screen as PersonaScreenKey] = parsedSlots;
    }
    if (Object.keys(parsedScreens).length === 0) return null;
    result[language as PersonaScreenLanguage] = parsedScreens;
  }
  return result;
}

/** The complete two-language mirror. Anything short of complete is not a reference. */
export function parsePersonaScreensReference(value: unknown): PersonaScreensReference | null {
  const languages = record(value);
  if (!languages || !exactKeys(languages, PERSONA_SCREEN_LANGUAGES)) return null;
  const reference = {} as PersonaScreensReference;
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    const screens = record(languages[language]);
    if (!screens || !exactKeys(screens, PERSONA_SCREEN_KEYS)) return null;
    const parsedScreens = {} as Record<PersonaScreenKey, Record<PersonaScreenSlot, string>>;
    for (const screen of PERSONA_SCREEN_KEYS) {
      const slots = record(screens[screen]);
      if (!slots || !exactKeys(slots, PERSONA_SCREEN_SLOTS)) return null;
      const parsedSlots = {} as Record<PersonaScreenSlot, string>;
      for (const slot of PERSONA_SCREEN_SLOTS) {
        const text = readableSlotText(slots[slot], slot);
        if (text === null) return null;
        parsedSlots[slot] = text;
      }
      parsedScreens[screen] = parsedSlots;
    }
    reference[language] = parsedScreens;
  }
  return reference;
}

function parseClosedList<T extends string>(value: unknown, expected: readonly T[]): T[] | null {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((entry, index) => value[index] === entry)
    ? [...expected]
    : null;
}

export function parsePersonaScreensConsole(value: unknown): PersonaScreensConsole | null {
  const source = record(value);
  if (!source || !exactKeys(source, PERSONA_SCREENS_CONSOLE_KEYS)) return null;
  const revision = parseRevision(source.revision);
  const copyDefault = parsePersonaScreensCopyDefault(source.copy_default);
  const reference = parsePersonaScreensReference(source.compiled_reference);
  const screens = parseClosedList(source.screens, PERSONA_SCREEN_KEYS);
  const slots = parseClosedList(source.slots, PERSONA_SCREEN_SLOTS);
  const languages = parseClosedList(source.languages, PERSONA_SCREEN_LANGUAGES);
  const limits = record(source.slot_byte_limits);
  if (revision === null
    || copyDefault === null
    || reference === null
    || screens === null
    || slots === null
    || languages === null
    || !limits
    || !exactKeys(limits, PERSONA_SCREEN_SLOTS)
    || source.reference_authority !== PERSONA_SCREENS_REFERENCE_AUTHORITY) return null;
  // The caps decide what the editor lets an operator type. A Core that moved
  // one is a contract change, not a value to adopt silently.
  for (const slot of PERSONA_SCREEN_SLOTS) {
    if (limits[slot] !== PERSONA_SCREEN_SLOT_BYTE_LIMITS[slot]) return null;
  }
  return {
    revision,
    copy_default: copyDefault,
    compiled_reference: reference,
    reference_authority: PERSONA_SCREENS_REFERENCE_AUTHORITY,
    screens,
    slots,
    languages,
    slot_byte_limits: { ...PERSONA_SCREEN_SLOT_BYTE_LIMITS },
  };
}

export function parsePersonaScreensSaved(value: unknown): PersonaScreensSaved | null {
  const source = record(value);
  if (!source || !exactKeys(source, PERSONA_SCREENS_SAVED_KEYS)) return null;
  const revision = parseRevision(source.revision);
  const copyDefault = parsePersonaScreensCopyDefault(source.copy_default);
  return revision === null || copyDefault === null
    ? null
    : { revision, copy_default: copyDefault };
}

// ---------------------------------------------------------------------------
// Editor draft ↔ document
// ---------------------------------------------------------------------------

/**
 * The editor grid: every language and compiled-copy slot present as a string,
 * plus the two dedicated PRE-link controls.
 *
 * For a compiled-copy slot, `""` means NOTHING IS STORED and the app renders its
 * own compiled string. For either link control, `""` means the optional button
 * is absent; there is no compiled link to fall back to. Empty strings never
 * reach the wire in either case.
 */
export type PersonaScreensLanguageDraft =
  Record<PersonaScreenKey, Record<PersonaScreenSlot, string>> & {
    external_link: Record<PersonaScreenExternalLinkField, string>;
  };
export type PersonaScreensDraft = Record<PersonaScreenLanguage, PersonaScreensLanguageDraft>;

/** One language's screens out of the stored map. A single subscript, with no sibling in reach. */
function languageDraft(
  copyDefault: PersonaScreensCopyDefault,
  language: PersonaScreenLanguage,
): PersonaScreensLanguageDraft {
  const stored = copyDefault[language] ?? {};
  const screens = {} as PersonaScreensLanguageDraft;
  for (const screen of PERSONA_SCREEN_KEYS) {
    const slots = {} as Record<PersonaScreenSlot, string>;
    for (const slot of PERSONA_SCREEN_SLOTS) {
      slots[slot] = stored[screen]?.[slot] ?? "";
    }
    screens[screen] = slots;
  }
  screens.external_link = {
    label: stored.pre?.external_link?.label ?? "",
    url: stored.pre?.external_link?.url ?? "",
  };
  return screens;
}

/**
 * Build the editor grid from the stored document AND NOTHING ELSE.
 *
 * One parameter, on purpose (see the R2 note at the top of this file): there is
 * no reference to fall back to and no second language to borrow from, so a
 * blank Hungarian box can only be filled by a person typing Hungarian into it.
 */
export function personaScreensDraft(copyDefault: PersonaScreensCopyDefault): PersonaScreensDraft {
  const draft = {} as PersonaScreensDraft;
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    draft[language] = languageDraft(copyDefault, language);
  }
  return draft;
}

export function personaScreensDraftWithValue(
  draft: PersonaScreensDraft,
  language: PersonaScreenLanguage,
  screen: PersonaScreenKey,
  slot: PersonaScreenSlot,
  value: string,
): PersonaScreensDraft {
  return {
    ...draft,
    [language]: {
      ...draft[language],
      [screen]: { ...draft[language][screen], [slot]: value },
    },
  };
}

export function personaScreensDraftWithExternalLinkValue(
  draft: PersonaScreensDraft,
  language: PersonaScreenLanguage,
  field: PersonaScreenExternalLinkField,
  value: string,
): PersonaScreensDraft {
  return {
    ...draft,
    [language]: {
      ...draft[language],
      external_link: { ...draft[language].external_link, [field]: value },
    },
  };
}

/**
 * The document a save carries, from the draft AND NOTHING ELSE.
 *
 * A blank box is dropped, not sent: omission is how an operator says "use the
 * app's own copy for this slot", and it is the only way to say it. A screen or
 * a language left entirely blank disappears with its slots, which is the shape
 * Core stores and republishes.
 */
export function personaScreensDocumentFromDraft(draft: PersonaScreensDraft): PersonaScreensDocument {
  const copyDefault: PersonaScreensCopyDefault = {};
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    const screens: PersonaScreenMap = {};
    for (const screen of PERSONA_SCREEN_KEYS) {
      const slots: PersonaScreenSlotMap = {};
      for (const slot of PERSONA_SCREEN_SLOTS) {
        const value = draft[language][screen][slot];
        if (value !== "") slots[slot] = value;
      }
      if (screen === "pre") {
        const externalLink: PersonaScreenExternalLink = {};
        for (const field of PERSONA_SCREEN_EXTERNAL_LINK_FIELDS) {
          const value = draft[language].external_link[field];
          if (value !== "") externalLink[field] = value;
        }
        // An empty pair means switched off. A one-field pair is intentionally
        // retained so an operator can save work in progress; publication below
        // still withholds the whole button until both fields are usable.
        if (Object.keys(externalLink).length > 0) slots.external_link = externalLink;
      }
      if (Object.keys(slots).length > 0) screens[screen] = slots;
    }
    if (Object.keys(screens).length > 0) copyDefault[language] = screens;
  }
  return { copy_default: copyDefault };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = record(value);
  if (source) {
    return `{${Object.keys(source).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function personaScreensDocumentsEqual(
  left: PersonaScreensCopyDefault,
  right: PersonaScreensCopyDefault,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** How many slots each language carries — the same shape Core writes to the audit row. */
export function personaScreensSlotCounts(
  copyDefault: PersonaScreensCopyDefault,
): Record<PersonaScreenLanguage, number> {
  const counts = {} as Record<PersonaScreenLanguage, number>;
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    counts[language] = PERSONA_SCREEN_KEYS.reduce(
      (total, screen) => total + Object.keys(copyDefault[language]?.[screen] ?? {}).length,
      0,
    );
  }
  return counts;
}

/** The UI's 9-slot copy count, kept separate from Core's audit slot count. */
export function personaScreensCompiledSlotCounts(
  copyDefault: PersonaScreensCopyDefault,
): Record<PersonaScreenLanguage, number> {
  const counts = {} as Record<PersonaScreenLanguage, number>;
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    counts[language] = PERSONA_SCREEN_KEYS.reduce(
      (total, screen) => total + PERSONA_SCREEN_SLOTS
        .filter((slot) => typeof copyDefault[language]?.[screen]?.[slot] === "string").length,
      0,
    );
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Conservative local validation (contract §6: mirror the rules for immediate
// feedback, but Core's answer is authoritative and names the control)
// ---------------------------------------------------------------------------

export type PersonaScreenSlotIssue =
  | "overCap"
  | "untrimmed"
  | "boundaryWhitespace"
  | "control"
  | "markup"
  | "angleBrackets"
  | "malformedText"
  | "invalidHttpsUrl";

function personaScreenBoundedTextIssue(
  value: string,
  limit: number,
): Exclude<PersonaScreenSlotIssue, "invalidHttpsUrl"> | null {
  if (value === "") return null;
  if (!wellFormedUtf16(value)) return "malformedText";
  if (personaScreenSlotByteLength(value) > limit) return "overCap";
  if (personaScreenTrim(value) !== value) return "untrimmed";
  if (BOUNDARY_WHITESPACE.test(value)) return "boundaryWhitespace";
  if (CONTROL_CHARACTERS.test(value)) return "control";
  // R5: the `{{highlight}}` markup does not come back. Refused, never stripped:
  // silently repairing would show the operator a saved value they did not type.
  if (value.includes("{{") || value.includes("}}")) return "markup";
  if (value.includes("<") || value.includes(">")) return "angleBrackets";
  return null;
}

/**
 * Why Core would refuse this value, or `null` when it would accept it.
 *
 * An EMPTY value is not an issue: it is the operator saying "leave this slot to
 * the app", and `personaScreensDocumentFromDraft` never sends it. Core refuses
 * an empty string, which is why it must never reach the wire — not a reason to
 * mark the control red while the operator is clearing it.
 */
export function personaScreenSlotIssue(
  value: string,
  slot: PersonaScreenSlot,
): PersonaScreenSlotIssue | null {
  return personaScreenBoundedTextIssue(value, PERSONA_SCREEN_SLOT_BYTE_LIMITS[slot]);
}

/** Empty is valid-but-off; a present URL must pass Core's exact D-089 gate. */
export function personaScreenExternalLinkFieldIssue(
  value: string,
  field: PersonaScreenExternalLinkField,
): PersonaScreenSlotIssue | null {
  const issue = personaScreenBoundedTextIssue(
    value,
    PERSONA_SCREEN_EXTERNAL_LINK_FIELD_BYTE_LIMITS[field],
  );
  if (issue !== null) return issue;
  if (field === "url" && value !== "" && !personaScreenExternalLinkUrlAllowed(value)) {
    return "invalidHttpsUrl";
  }
  return null;
}

export type PersonaScreenSlotAddress = {
  language: PersonaScreenLanguage;
  screen: PersonaScreenKey;
  slot: PersonaScreenSlot;
};

export type PersonaScreenExternalLinkFieldAddress = {
  language: PersonaScreenLanguage;
  screen: "pre";
  externalLinkField: PersonaScreenExternalLinkField;
};

export type PersonaScreenFieldAddress =
  | PersonaScreenSlotAddress
  | PersonaScreenExternalLinkFieldAddress;

/** Core's field path for one control — `copy_default.hu.pre.headline`. */
export function personaScreenFieldPath(address: PersonaScreenFieldAddress): string {
  return "externalLinkField" in address
    ? `copy_default.${address.language}.pre.external_link.${address.externalLinkField}`
    : `copy_default.${address.language}.${address.screen}.${address.slot}`;
}

export type PersonaScreenDraftIssue = PersonaScreenFieldAddress & {
  issue: PersonaScreenSlotIssue;
};

export function personaScreensDraftIssues(
  draft: PersonaScreensDraft,
): PersonaScreenDraftIssue[] {
  const issues: PersonaScreenDraftIssue[] = [];
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    for (const screen of PERSONA_SCREEN_KEYS) {
      for (const slot of PERSONA_SCREEN_SLOTS) {
        const issue = personaScreenSlotIssue(draft[language][screen][slot], slot);
        if (issue) issues.push({ language, screen, slot, issue });
      }
    }
    for (const externalLinkField of PERSONA_SCREEN_EXTERNAL_LINK_FIELDS) {
      const issue = personaScreenExternalLinkFieldIssue(
        draft[language].external_link[externalLinkField],
        externalLinkField,
      );
      if (issue) issues.push({ language, screen: "pre", externalLinkField, issue });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// What the app will actually show
// ---------------------------------------------------------------------------

export type PersonaScreenExternalLinkState =
  | { kind: "off" }
  | { kind: "missingLabel" }
  | { kind: "missingUrl" }
  | {
      kind: "invalid";
      field: PersonaScreenExternalLinkField;
      issue: PersonaScreenSlotIssue;
    }
  | { kind: "visible"; link: { label: string; url: string } };

/**
 * One language's optional-link outcome from that language's draft alone. A
 * half-pair is valid stored work, but never a button; an invalid field blocks a
 * save and also cannot appear in the preview.
 */
export function personaScreenExternalLinkState(
  draft: PersonaScreensDraft,
  language: PersonaScreenLanguage,
): PersonaScreenExternalLinkState {
  const { label, url } = draft[language].external_link;
  for (const field of PERSONA_SCREEN_EXTERNAL_LINK_FIELDS) {
    const issue = personaScreenExternalLinkFieldIssue(
      draft[language].external_link[field],
      field,
    );
    if (issue) return { kind: "invalid", field, issue };
  }
  if (label === "" && url === "") return { kind: "off" };
  if (label === "") return { kind: "missingLabel" };
  if (url === "") return { kind: "missingUrl" };
  return { kind: "visible", link: { label, url } };
}

function readableExternalLinkPair(value: unknown): { label: string; url: string } | null {
  const source = record(value);
  if (!source) return null;
  const label = readableExternalLinkField(source.label, "label");
  const url = readableExternalLinkField(source.url, "url");
  return label === null || url === null ? null : { label, url };
}

export type PersonaScreensPublishedBlock = {
  contract_version: number;
  lang: PersonaScreenLanguage;
  screens: PersonaScreenMap;
};

/**
 * The block Core will publish in `ios_appconfig` for one language — the
 * console's mirror of `PersonaScreensPolicy::appConfigBlock()`, so an operator
 * can be told how many of the nine compiled slots their save actually reaches,
 * and whether the separate optional link publishes.
 *
 * ONE LANGUAGE'S SLOTS IN, ONE LANGUAGE'S BLOCK OUT, for the same reason Core
 * shapes it that way: the other language is not in scope here either.
 */
export function personaScreensPublishedBlock(
  screens: PersonaScreenMap,
  language: PersonaScreenLanguage,
): PersonaScreensPublishedBlock {
  const published: PersonaScreenMap = {};
  for (const screen of PERSONA_SCREEN_KEYS) {
    const slots = screens[screen];
    if (!slots) continue;
    const emitted: PersonaScreenSlotMap = {};
    for (const slot of PERSONA_SCREEN_PRESENTATION_SLOTS[screen]) {
      if (slot === PERSONA_SCREEN_EXTERNAL_LINK_SLOT) {
        const link = readableExternalLinkPair(slots.external_link);
        if (link !== null) emitted.external_link = link;
        continue;
      }
      const value = readableSlotText(slots[slot], slot);
      if (value !== null) emitted[slot] = value;
    }
    // A screen with no usable slot is omitted, never emitted as `{}`.
    if (Object.keys(emitted).length > 0) published[screen] = emitted;
  }
  return { contract_version: PERSONA_SCREENS_CONTRACT_VERSION, lang: language, screens: published };
}

/** A single subscript into the stored map; an absent language yields nothing to publish. */
export function personaScreensForLanguage(
  copyDefault: PersonaScreensCopyDefault,
  language: PersonaScreenLanguage,
): PersonaScreenMap {
  return copyDefault[language] ?? {};
}

export type PersonaScreenPreviewSource = "operator" | "compiled";
export type PersonaScreenPreviewSlot = { text: string; source: PersonaScreenPreviewSource };
export type PersonaScreenPreview = Record<PersonaScreenSlot, PersonaScreenPreviewSlot>;

/**
 * What one screen looks like on a member's phone for one language: the
 * operator's words where they typed some, the app's own compiled string
 * everywhere else. DISPLAY ONLY — no caller can turn this back into a document.
 *
 * `source` is read off the DRAFT, never by comparing the two strings. An
 * operator may legitimately retype a compiled string word for word, and a
 * preview that decided by comparison would then label their value "compiled"
 * and quietly teach them that saving changed nothing. That confusion is exactly
 * the T-588 defect in the Core corpus, and it is not repeated here.
 */
export function personaScreenPreview(
  draft: PersonaScreensDraft,
  reference: PersonaScreensReference,
  language: PersonaScreenLanguage,
  screen: PersonaScreenKey,
): PersonaScreenPreview {
  const preview = {} as PersonaScreenPreview;
  for (const slot of PERSONA_SCREEN_SLOTS) {
    const typed = draft[language][screen][slot];
    preview[slot] = typed === ""
      ? { text: reference[language][screen][slot], source: "compiled" }
      : { text: typed, source: "operator" };
  }
  return preview;
}

// ---------------------------------------------------------------------------
// Response decoders (T-468 discipline: exact envelopes, closed (name, status)
// refusal maps split by envelope source, everything else uncertain)
// ---------------------------------------------------------------------------

export type PersonaScreensRefusal = {
  ok: false;
  kind: "refused";
  error: string;
  status: number;
  /** 409 only: the revision the save lost to, so the console can say what it reloaded to. */
  currentRevision: number | null;
  /** 422 only: the exact control Core refused, e.g. `copy_default.hu.pre.headline`. */
  field: string | null;
};
export type PersonaScreensUncertain = { ok: false; kind: "uncertain"; error: string };
export type PersonaScreensDecode<T> =
  { ok: true; value: T } | PersonaScreensRefusal | PersonaScreensUncertain;

/**
 * Closed Core refusal vocabulary, bound from the published T-550 corpus
 * (`tests/fixtures/persona_screens_wire/`) and Core's
 * `PersonaScreensAdminPolicy::ERROR_STATUSES`. A refusal proves the write did
 * not land.
 */
export const PERSONA_SCREENS_CORE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["admin-session-invalid", 401],
  ["admin-revoked", 403],
  ["admin-write-required", 403],
  ["persona-screens-conflict", 409],
  ["persona-screens-invalid", 422],
  ["persona-screens-copy-default-invalid", 422],
  ["persona-screens-revision-invalid", 422],
]);

/**
 * The 503 family: a write that may still have landed, and the read-side
 * "stored document is malformed" state. The app is unaffected in both — it
 * keeps rendering its compiled screens — but the console must not pretend it
 * knows what is stored.
 */
export const PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["persona-screens-write-failed", 503],
  ["persona-screens-unavailable", 503],
]);

/** Closed bridge refusal vocabulary (`app/api/admin/[action]/route.ts`), answered before Core is called. */
export const PERSONA_SCREENS_BRIDGE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["invalid-input", 400],
  ["auth-required", 401],
  ["bad-origin", 403],
  ["admin-write-required", 403],
  ["persona-screens-capability-required", 403],
  ["not-found", 404],
  ["too-large", 413],
]);

/** The bridge's transport trio: Core was called and its answer is unknown. */
export const PERSONA_SCREENS_BRIDGE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["core-timeout", 504],
  ["core-unavailable", 502],
  ["invalid-core-response", 502],
]);

function uncertain(error: string): PersonaScreensUncertain {
  return { ok: false, kind: "uncertain", error };
}

function refusalDetail(value: unknown, error: string, status: number): PersonaScreensRefusal {
  const source = record(value) ?? {};
  const currentRevision = status === 409 ? parseRevision(source.current_revision) : null;
  const field = status === 422 && typeof source.field === "string" && source.field !== ""
    ? source.field
    : null;
  return { ok: false, kind: "refused", error, status, currentRevision, field };
}

function classifyRefusal(
  value: unknown,
  error: string,
  status: number,
  refusals: ReadonlyMap<string, number>,
  uncertains: ReadonlyMap<string, number>,
): PersonaScreensRefusal | PersonaScreensUncertain {
  if (refusals.get(error) === status) return refusalDetail(value, error, status);
  if (uncertains.get(error) === status) return uncertain(error);
  return uncertain("unknown-refusal");
}

/**
 * Envelope-source closure: the Core map applies only to the legacy trio
 * envelope WITHOUT `data` (a refusal never carries material), the bridge map
 * only to the bridge's own three-key envelope.
 */
function decodeRefusal(value: unknown): PersonaScreensRefusal | PersonaScreensUncertain | null {
  const core = webadminErrorEnvelope(value, "forbidden");
  if (core) {
    return classifyRefusal(
      value,
      core.error,
      core.status_code,
      PERSONA_SCREENS_CORE_REFUSAL_STATUSES,
      PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES,
    );
  }
  if (webadminErrorEnvelope(value, "required")) return uncertain("refusal-with-data");
  const bridge = adminBridgeErrorEnvelope(value);
  return bridge
    ? classifyRefusal(
      value,
      bridge.error,
      bridge.status_code,
      PERSONA_SCREENS_BRIDGE_REFUSAL_STATUSES,
      PERSONA_SCREENS_BRIDGE_UNCERTAIN_STATUSES,
    )
    : null;
}

function decodeMaterial<T>(value: unknown, parse: (data: unknown) => T | null): PersonaScreensDecode<T> {
  if (value === null || value === undefined) return uncertain("no-response");
  const success = webadminDataSuccessEnvelope(value);
  if (success) {
    const parsed = parse(success.data);
    return parsed === null ? uncertain("malformed-material") : { ok: true, value: parsed };
  }
  return decodeRefusal(value) ?? uncertain("malformed-envelope");
}

export function decodePersonaScreensConsoleResponse(
  value: unknown,
): PersonaScreensDecode<PersonaScreensConsole> {
  return decodeMaterial(value, parsePersonaScreensConsole);
}

/**
 * `persona_screens_save`: an exact success envelope whose stored document
 * equals the submitted one and whose revision is the EXACT successor of the
 * expected one. Core increments an accepted save by exactly one and reads the
 * document back before answering, so a skipped, unchanged or stale revision is
 * an unbound "success": uncertain, never adopted.
 */
export function decodePersonaScreensSaveResponse(
  value: unknown,
  submitted: { expected_revision: number; document: PersonaScreensDocument },
): PersonaScreensDecode<PersonaScreensSaved> {
  const decoded = decodeMaterial(value, parsePersonaScreensSaved);
  if (!decoded.ok) return decoded;
  if (decoded.value.revision !== submitted.expected_revision + 1) return uncertain("unbound-revision");
  if (!personaScreensDocumentsEqual(decoded.value.copy_default, submitted.document.copy_default)) {
    return uncertain("unbound-material");
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// Capability projection and proxy body normalization
// ---------------------------------------------------------------------------

export function parsePersonaScreensAdminMe(value: unknown): PersonaScreensAdminMe | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["contract_version", "contract_ready", "actions"])) return null;
  if (source.contract_version !== PERSONA_SCREENS_CONTRACT_VERSION
    || typeof source.contract_ready !== "boolean"
    || !Array.isArray(source.actions)) return null;
  const actions = source.actions as unknown[];
  if (actions.some((action) => !(PERSONA_SCREENS_ACTIONS as readonly unknown[]).includes(action))) return null;
  if (new Set(actions).size !== actions.length) return null;
  const ordered = PERSONA_SCREENS_ACTIONS.filter((action) => actions.includes(action));
  if (!ordered.every((action, index) => action === actions[index])) return null;
  // A projection that is not ready may advertise nothing; the reverse would be
  // Core contradicting itself, and this layer fails closed on it.
  if (!source.contract_ready && ordered.length !== 0) return null;
  return {
    contract_version: PERSONA_SCREENS_CONTRACT_VERSION,
    contract_ready: source.contract_ready,
    actions: [...ordered],
  };
}

/**
 * What the current operator may do, from Core's projection only: an absent,
 * not-ready or unlisted projection hides the card, and nothing here grants it.
 */
export function personaScreensAccess(projection: PersonaScreensAdminMe | null): PersonaScreensAccess {
  if (!projection || !projection.contract_ready) return { visible: false, editable: false };
  const visible = projection.actions.includes("persona_screens_console");
  return { visible, editable: visible && projection.actions.includes("persona_screens_save") };
}

/**
 * Three outcomes rather than two, because they need different screens.
 *
 * `absent` is a Core that has not released this family here: the three screens
 * still work — they use the app's own copy — so the console says so quietly.
 * `unreadable` is a membership answer this layer could not trust, or a
 * `persona_screens` block that is present and not the contract's; that one
 * fails closed and loudly, because a malformed capability projection must never
 * render as a proven empty state.
 */
export type PersonaScreensProjection =
  | { kind: "ok"; value: PersonaScreensAdminMe }
  | { kind: "absent" }
  | { kind: "unreadable" };

export function personaScreensProjectionFrom(membership: unknown): PersonaScreensProjection {
  const outer = record(membership);
  if (!outer || outer.success !== true) return { kind: "unreadable" };
  if (!Object.hasOwn(outer, "persona_screens")) return { kind: "absent" };
  const value = parsePersonaScreensAdminMe(outer.persona_screens);
  return value === null ? { kind: "unreadable" } : { kind: "ok", value };
}

export function isPersonaScreensAction(action: string): action is PersonaScreensAction {
  return (PERSONA_SCREENS_ACTIONS as readonly string[]).includes(action);
}

/**
 * Per-call recheck of Core's `admin_me.persona_screens` projection at the
 * proxy: `null` for actions outside this family, `false` unless Core lists the
 * exact action for the current operator right now.
 */
export function personaScreensProxyCapabilityAuthorized(
  action: string,
  membership: unknown,
): boolean | null {
  if (!isPersonaScreensAction(action)) return null;
  const block = parsePersonaScreensAdminMe(record(membership)?.persona_screens);
  return block !== null && block.contract_ready && block.actions.includes(action);
}

/**
 * WRITE-time acceptance of a submitted slot value: everything the read accepts,
 * plus R5's markup refusal and R4's "no HTML". Mirrors Core's `writableText()`.
 */
function writableSlotText(value: unknown, slot: PersonaScreenSlot): string | null {
  const text = readableSlotText(value, slot);
  if (text === null) return null;
  return personaScreenSlotIssue(text, slot) === null ? text : null;
}

function writableExternalLinkField(
  value: unknown,
  field: PersonaScreenExternalLinkField,
): string | null {
  if (typeof value !== "string" || value === "") return null;
  return personaScreenExternalLinkFieldIssue(value, field) === null ? value : null;
}

/** Strictly `{copy_default: {...}}` — the exact document Core's `parseDocument()` accepts. */
export function parseExactPersonaScreensDocument(value: unknown): PersonaScreensDocument | null {
  const source = record(value);
  if (!source || !exactKeys(source, PERSONA_SCREENS_DOCUMENT_KEYS)) return null;
  const languages = record(source.copy_default);
  if (!languages) return null;
  const copyDefault: PersonaScreensCopyDefault = {};
  for (const language of Object.keys(languages)) {
    if (!(PERSONA_SCREEN_LANGUAGES as readonly string[]).includes(language)) return null;
    const screens = record(languages[language]);
    if (!screens) return null;
    const parsedScreens: PersonaScreenMap = {};
    let normalizedEmptyLink = false;
    for (const screen of Object.keys(screens)) {
      if (!(PERSONA_SCREEN_KEYS as readonly string[]).includes(screen)) return null;
      const slots = record(screens[screen]);
      if (!slots) return null;
      const parsedSlots: PersonaScreenSlotMap = {};
      for (const slot of Object.keys(slots)) {
        if (!(PERSONA_SCREEN_PRESENTATION_SLOTS[screen as PersonaScreenKey] as readonly string[])
          .includes(slot)) return null;
        if (slot === PERSONA_SCREEN_EXTERNAL_LINK_SLOT) {
          const sourceLink = record(slots[slot]);
          if (!sourceLink
            || Object.keys(sourceLink).some((field) =>
              !(PERSONA_SCREEN_EXTERNAL_LINK_FIELDS as readonly string[]).includes(field))) return null;
          const parsedLink: PersonaScreenExternalLink = {};
          for (const field of PERSONA_SCREEN_EXTERNAL_LINK_FIELDS) {
            if (!Object.hasOwn(sourceLink, field)) continue;
            const text = writableExternalLinkField(sourceLink[field], field);
            if (text === null) return null;
            parsedLink[field] = text;
          }
          if (Object.keys(parsedLink).length > 0) parsedSlots.external_link = parsedLink;
          else normalizedEmptyLink = true;
          continue;
        }
        const text = writableSlotText(slots[slot], slot as PersonaScreenSlot);
        if (text === null) return null;
        parsedSlots[slot as PersonaScreenSlot] = text;
      }
      if (Object.keys(parsedSlots).length === 0) {
        // Core canonicalizes precisely `{external_link:{}}` to absence. Keep
        // rejecting unrelated empty screen objects as this boundary always has.
        if (Object.keys(slots).length === 1
          && Object.hasOwn(slots, PERSONA_SCREEN_EXTERNAL_LINK_SLOT)
          && normalizedEmptyLink) continue;
        return null;
      }
      parsedScreens[screen as PersonaScreenKey] = parsedSlots;
    }
    if (Object.keys(parsedScreens).length === 0) {
      if (Object.keys(screens).length === 1 && normalizedEmptyLink) continue;
      return null;
    }
    copyDefault[language as PersonaScreenLanguage] = parsedScreens;
  }
  return { copy_default: copyDefault };
}

/**
 * The browser sends JSON; Core receives a form body where `document` is the
 * canonical JSON string of exactly `{copy_default}` (`lib/core.ts` serialises
 * nested objects). Anything the strict parser refuses is answered
 * `invalid-input` here, before Core.
 *
 * An empty `{"copy_default":{}}` is a legitimate save meaning "clear
 * everything": both languages then fall back to the compiled screens.
 */
export function normalizePersonaScreensProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!isPersonaScreensAction(action)) return undefined;
  switch (action) {
    case "persona_screens_console":
      return exactKeys(body, []) ? {} : null;
    case "persona_screens_save": {
      if (!exactKeys(body, ["expected_revision", "document"])) return null;
      const expectedRevision = parseRevision(body.expected_revision);
      const document = parseExactPersonaScreensDocument(body.document);
      // Core refuses a save at the ceiling because it could not increment.
      if (expectedRevision === null
        || expectedRevision >= PERSONA_SCREENS_REVISION_MAX
        || !document) return null;
      return { expected_revision: expectedRevision, document };
    }
    default:
      return null;
  }
}

/**
 * The new-member welcome message (P-091). Core posts it into every new
 * member's Help & Support conversation at registration and publishes the
 * administrator-editable text as the `welcome_message` entry of the ordinary
 * `get_settings` / `set_settings` map (docs/WELCOME_MESSAGE.md in Core).
 *
 * The value is exactly `{enabled, body: {hu, en}}`. Each body is trimmed the
 * way PHP's `trim()` trims, non-empty, at most 4000 code points and free of
 * control characters other than tab and newline — `WelcomeMessage::normalize`
 * in Core, mirrored here so the console refuses what Core would refuse before
 * it is sent. A present but malformed stored row reads back as `value: null`:
 * nothing is being sent, and the console shows that instead of a default.
 */

export const WELCOME_MESSAGE_SETTING_KEY = "welcome_message";
export const WELCOME_MESSAGE_LOCALES = ["hu", "en"] as const;
/** Core's support message limit (`SupportThreadService::MAX_BODY`), in code points. */
export const WELCOME_MESSAGE_MAX_BODY = 4000;

export type WelcomeMessageLocale = (typeof WELCOME_MESSAGE_LOCALES)[number];
export type WelcomeMessageValue = {
  enabled: boolean;
  body: Record<WelcomeMessageLocale, string>;
};
export type WelcomeMessageStored = {
  value: WelcomeMessageValue;
  updatedAt: number;
  updatedBy: string;
};

/**
 * One read of the setting:
 * - `ready`: Core's value, decoded;
 * - `corrupt`: the stored row is present but malformed (`value: null`), so
 *   Core sends nothing until a valid message is saved;
 * - `invalid`: anything else — a refusal, a transport failure, a Core without
 *   the setting, or a body this console cannot vouch for.
 */
export type WelcomeMessageRead =
  | { kind: "ready"; stored: WelcomeMessageStored }
  | { kind: "corrupt"; updatedAt: number; updatedBy: string }
  | { kind: "invalid" };

export type WelcomeMessageBodyIssue = "empty" | "tooLong" | "control";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** PHP's default `trim()` set: space, tab, newline, carriage return, NUL, vertical tab. */
function phpTrim(text: string): string {
  return text.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/gu, "");
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
// Core refuses every C0 control except tab (0x09) and newline (0x0A), and DEL.
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/u;

/** Unicode code points, as Core's `mb_strlen` counts them. */
export function welcomeMessageLength(text: string): number {
  return [...phpTrim(text)].length;
}

/** Why Core would refuse this body, or null when it would accept it. */
export function welcomeMessageBodyIssue(text: string): WelcomeMessageBodyIssue | null {
  const trimmed = phpTrim(text);
  if (trimmed === "") return "empty";
  if (FORBIDDEN_CONTROL.test(trimmed) || LONE_SURROGATE.test(trimmed)) return "control";
  if ([...trimmed].length > WELCOME_MESSAGE_MAX_BODY) return "tooLong";
  return null;
}

/** Core's `WelcomeMessage::normalize`: the canonical value, or null when Core would refuse it. */
export function normalizeWelcomeMessage(value: unknown): WelcomeMessageValue | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, ["enabled", "body"]) || typeof raw.enabled !== "boolean") return null;
  const body = record(raw.body);
  if (!body || !exactKeys(body, WELCOME_MESSAGE_LOCALES)) return null;
  const out: WelcomeMessageValue = { enabled: raw.enabled, body: { hu: "", en: "" } };
  for (const locale of WELCOME_MESSAGE_LOCALES) {
    const text = body[locale];
    if (typeof text !== "string" || welcomeMessageBodyIssue(text) !== null) return null;
    out.body[locale] = phpTrim(text);
  }
  return out;
}

export function welcomeMessageEqual(left: WelcomeMessageValue, right: WelcomeMessageValue): boolean {
  return left.enabled === right.enabled
    && WELCOME_MESSAGE_LOCALES.every((locale) => left.body[locale] === right.body[locale]);
}

function metadata(row: Record<string, unknown>): { updatedAt: number; updatedBy: string } | null {
  const updatedAt = row.updated_at;
  const updatedBy = row.updated_by;
  if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  if (typeof updatedBy !== "string") return null;
  return { updatedAt, updatedBy };
}

/**
 * Decode the `welcome_message` entry of a successful `get_settings` or
 * `set_settings` answer. Core publishes the normalised value, so anything
 * that is not already canonical is treated as a body this console cannot
 * vouch for rather than silently repaired.
 */
export function welcomeMessageSettingsRead(response: unknown): WelcomeMessageRead {
  const envelope = record(response);
  if (!envelope || envelope.success !== true || envelope.status_code !== 200) return { kind: "invalid" };
  const settings = record(envelope.settings);
  const row = record(settings?.[WELCOME_MESSAGE_SETTING_KEY]);
  if (!row || row.type !== "welcome_message" || !Object.hasOwn(row, "value")) return { kind: "invalid" };
  const meta = metadata(row);
  if (!meta) return { kind: "invalid" };
  if (row.value === null) return { kind: "corrupt", ...meta };
  const value = normalizeWelcomeMessage(row.value);
  if (!value || JSON.stringify(value) !== JSON.stringify(row.value)) return { kind: "invalid" };
  return { kind: "ready", stored: { value, ...meta } };
}

/** The `set_settings` body for this panel: only the welcome entry, canonical, or null when Core would refuse it. */
export function welcomeMessageSaveBody(
  draft: WelcomeMessageValue,
): { settings: { welcome_message: WelcomeMessageValue } } | null {
  const value = normalizeWelcomeMessage(draft);
  return value ? { settings: { welcome_message: value } } : null;
}

export type WelcomeMessageSaveOutcome =
  | { kind: "saved"; stored: WelcomeMessageStored }
  | { kind: "invalid" }
  | { kind: "writeRequired" }
  | { kind: "refused"; error: string }
  | { kind: "unknown" };

/**
 * Classify a `set_settings` answer for the value that was sent.
 *
 * Definite refusals write nothing: 422 `setting-invalid` (Core's answer for a
 * malformed welcome, `field: welcome_message`), 403 `admin-write-required`
 * (Core, or the same-origin bridge before Core) and any other 4xx refusal.
 * Everything else — a lost answer, a 5xx (Core writes the row before its
 * audit, so `write-failed` may follow a stored change), or a success whose
 * value is not the one sent — is unknown and must be read back.
 */
export function welcomeMessageSaveOutcome(
  response: unknown,
  sent: WelcomeMessageValue,
): WelcomeMessageSaveOutcome {
  const envelope = record(response);
  if (!envelope) return { kind: "unknown" };
  if (envelope.success === true) {
    const read = welcomeMessageSettingsRead(response);
    return read.kind === "ready" && welcomeMessageEqual(read.stored.value, sent)
      ? { kind: "saved", stored: read.stored }
      : { kind: "unknown" };
  }
  const status = envelope.status_code;
  const error = envelope.error;
  if (envelope.success !== false || typeof status !== "number" || typeof error !== "string" || error === "") {
    return { kind: "unknown" };
  }
  if (status === 422 && error === "setting-invalid"
    && (!Object.hasOwn(envelope, "field") || envelope.field === WELCOME_MESSAGE_SETTING_KEY)) {
    return { kind: "invalid" };
  }
  if (status === 403 && error === "admin-write-required") return { kind: "writeRequired" };
  if (Number.isSafeInteger(status) && status >= 400 && status < 500) return { kind: "refused", error };
  return { kind: "unknown" };
}

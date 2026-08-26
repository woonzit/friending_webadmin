/**
 * Client model for Core's `signup_photo_experience` singleton — revision 1 of the frozen
 * `signup-photo-experience` contract.
 *
 * The console reads the document with **both locales unresolved** (§4.1) and writes it back
 * **whole** (§4.2). Everything in this module is therefore the stored shape, never the localised
 * `photo_experience` block the app receives from `signup_options`.
 *
 * The parser is fail-closed in the same sense as `lib/icebreakers.ts`: one unreadable field
 * invalidates the whole document and the caller gets `null`. It never synthesises an empty
 * configuration, because the editor saves whole documents — a silently dropped tip item or locale
 * would be written back as a deletion the operator never asked for. Core already returns usable
 * defaults for an absent document (§4.1, `revision: 0`), so there is nothing legitimate for this
 * layer to invent.
 */

export const SIGNUP_PHOTO_SCHEMA_VERSION = 1;

/** §1: `tips.items` is capped at 12 entries. Six is the product default. */
export const MAX_TIP_ITEMS = 12;

/** §1: `min_photos` is 1..6 and `max_photos` is `min_photos`..6. */
export const MIN_PHOTO_COUNT = 1;
export const MAX_PHOTO_COUNT = 6;

/**
 * §1 and §5.6: a tip image must be an absolute `https://` URL whose origin is exactly the media
 * host, under the cache path. This is the established client trust boundary, so a URL the console
 * accepted but a device drops would be an invisible failure — the operator would see the picture
 * here and members would see nothing.
 */
export const PUBLIC_IMAGE_ORIGIN = "https://pic.freelove.hu";
export const PUBLIC_IMAGE_PATH_PREFIX = "/api/cache/";

export const MAX_TIP_KEY_LENGTH = 40;
export const MAX_CAPTION_LENGTH = 180;
export const MAX_TITLE_LENGTH = 180;
export const MAX_SUBTITLE_LENGTH = 300;
export const MAX_MODERATION_TEXT_LENGTH = 400;
export const MAX_LINK_TITLE_LENGTH = 120;
export const MAX_URL_LENGTH = 2048;
export const MAX_SORT_ORDER = 100_000;

const MAX_UPDATED_BY_LENGTH = 254;
const TIP_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

/** The two locales the product ships. Both keys must exist in every localised map. */
export const REQUIRED_LOCALES = ["en", "hu"] as const;

export type SignupPhotoLocalizedText = Record<string, string>;

export type SignupPhotoVerdict = "good" | "bad";

export type SignupPhotoTipItem = {
  key: string;
  caption: SignupPhotoLocalizedText;
  verdict: SignupPhotoVerdict;
  sort_order: number;
  image_female: string;
  /** `null` when unset. `image_female` is the fallback for every audience (§1). */
  image_male: string | null;
};

export type SignupPhotoModeration = {
  enabled: boolean;
  text: SignupPhotoLocalizedText;
  link_title: SignupPhotoLocalizedText;
  link_url: string;
};

export type SignupPhotoAvatar = {
  title: SignupPhotoLocalizedText;
  subtitle: SignupPhotoLocalizedText;
};

export type SignupPhotoTips = {
  title: SignupPhotoLocalizedText;
  items: SignupPhotoTipItem[];
};

export type SignupPhotoConfig = {
  schema_version: number;
  /** `0` when no document exists yet (§4.1). */
  revision: number;
  min_photos: number;
  max_photos: number;
  moderation: SignupPhotoModeration;
  avatar: SignupPhotoAvatar;
  tips: SignupPhotoTips;
  /** Unix seconds, or `null` when the document has never been written. */
  updated_at: number | null;
  updated_by: string;
};

/**
 * A tip row while it is being edited. `uid` is a browser-only identity: the stable `key` is an
 * editable field, so keying the React list on it would remount — and unfocus — the key input on
 * every keystroke, and keying on the array index would attach a row's upload state to a position
 * rather than to a row, so a reorder would move a pending upload error onto the wrong tip.
 * `signupPhotoSavePayload` lists the wire fields explicitly, so `uid` cannot reach Core.
 */
export type SignupPhotoTipDraft = SignupPhotoTipItem & { uid: string };

export type SignupPhotoTipsDraft = {
  title: SignupPhotoLocalizedText;
  items: SignupPhotoTipDraft[];
};

/** The editable half of the document. `schema_version` and the audit stamps are Core's. */
export type SignupPhotoDraft = {
  revision: number;
  min_photos: number;
  max_photos: number;
  moderation: SignupPhotoModeration;
  avatar: SignupPhotoAvatar;
  tips: SignupPhotoTipsDraft;
};

/**
 * Why a draft cannot be submitted. Each value has its own localised message, and each mirrors a
 * validation Core repeats — the console refuses first so the operator gets a field-level answer
 * instead of a round trip. The list is exported so the message files can be checked against it
 * exhaustively rather than one key at a time.
 */
export const SIGNUP_PHOTO_DRAFT_ISSUES = [
  "count",
  "moderation",
  "moderationLink",
  "avatar",
  "tipsTitle",
  "tipKey",
  "duplicateTipKey",
  "tipCaption",
  "tipImage",
  "tooManyTips",
] as const;

export type SignupPhotoDraftIssue = (typeof SIGNUP_PHOTO_DRAFT_ISSUES)[number];

/**
 * The failure identities `save_signup_photo_config` can answer with: §4.2's seven 422 codes, its
 * 409, and the two 500s Core's handler actually emits.
 *
 * The last two are not in §4.2's frozen list — they come from
 * `WebadminController::saveSignupPhotoConfig` and `SignupPhotoExperiencePolicy::ERROR_WRITE_FAILED`
 * — and they mean opposite things, which is why neither may fall through to a generic message:
 *
 * - `audit-write-failed`: the document **was** written and `revision` **was** bumped; only the
 *   `admin_audit_log` row failed, and the handler deliberately attaches the saved `config` so the
 *   caller can adopt it. Reporting this as a plain failure keeps a draft whose `expected_revision`
 *   is now one behind the stored document, so the operator's next save is answered with a 409.
 * - `signup-photo-config-write-failed`: the storage write itself threw, so there is nothing to
 *   adopt and no `config` in the body. The operator's draft is the only copy of their edit and must
 *   survive.
 *
 * `signup-photo-config-query-failed` is deliberately absent: it belongs to the *read* action, whose
 * only answer is the load error panel, so naming it would add a branch that can never be reached.
 */
export const SIGNUP_PHOTO_FAILURE_CODES = [
  "signup-photo-config-conflict",
  "signup-photo-config-invalid-count",
  "signup-photo-config-invalid-moderation",
  "signup-photo-config-invalid-avatar",
  "signup-photo-config-invalid-tips",
  "signup-photo-config-invalid-image-url",
  "signup-photo-config-duplicate-tip-key",
  "signup-photo-config-too-many-tips",
  "signup-photo-config-write-failed",
  "audit-write-failed",
] as const;

export type SignupPhotoFailureCode = (typeof SIGNUP_PHOTO_FAILURE_CODES)[number];

const FAILURE_CODE_SET: ReadonlySet<string> = new Set(SIGNUP_PHOTO_FAILURE_CODES);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

/**
 * A bounded, control-character-free string. Empty is legal: §4.1's no-document defaults are empty
 * strings in every localised map, and §4.2 only requires the moderation block when it is enabled.
 * Leading and trailing whitespace is rejected rather than trimmed, so what the parser returns is
 * byte-identical to what Core stored and a round trip cannot quietly rewrite the document.
 */
function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() !== value) return null;
  if (CONTROL_CHARACTERS.test(value)) return null;
  return Array.from(value).length <= max ? value : null;
}

/**
 * A locale map. Both `en` and `hu` must be *present*; whether they must be *filled* is a save-time
 * question (§4.2).
 *
 * A locale beyond those two is **accepted and carried**, but it does not survive a save, and this
 * console cannot make it survive one. Core's `SignupPhotoExperiencePolicy::localeMap()` projects
 * every map down to exactly `{en, hu}` on both paths — `normalize()` before the document is stored,
 * and `adminPayload()` before it is returned — so a `de` entry this editor submits is dropped
 * before storage, and a `de` entry already in Mongo is never read back. What the pass-through below
 * buys is therefore tolerance, not preservation: an unexpected locale is not a load failure.
 *
 * For a third language to work, Core has to change first: `localeMap()` must stop projecting onto
 * the fixed pair, `LOCALES` must list the new locale so the required-when-used checks cover it, and
 * `language()` must admit it on the public read path. The pass-through here starts preserving
 * something on the day that happens, and needs no change then — which is the only reason to keep
 * it, and not a reason to claim the guarantee today.
 */
function localizedText(value: unknown, max: number): SignupPhotoLocalizedText | null {
  const source = record(value);
  if (!source) return null;
  const result: SignupPhotoLocalizedText = {};
  for (const [locale, text] of Object.entries(source)) {
    if (!LOCALE_PATTERN.test(locale)) return null;
    const parsed = boundedText(text, max);
    if (parsed === null) return null;
    result[locale] = parsed;
  }
  for (const locale of REQUIRED_LOCALES) {
    if (typeof result[locale] !== "string") return null;
  }
  return result;
}

/**
 * §1: absolute `https://`, origin exactly `PUBLIC_IMAGE_ORIGIN`, path under the cache prefix.
 * `URL.origin` covers scheme, host and port together; embedded credentials are refused separately
 * because `origin` ignores them and `https://pic.freelove.hu@evil.example/…` would otherwise pass.
 */
export function isTrustedTipImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === PUBLIC_IMAGE_ORIGIN
    && parsed.username === ""
    && parsed.password === ""
    && parsed.pathname.startsWith(PUBLIC_IMAGE_PATH_PREFIX);
}

/**
 * §1: the moderation link is a policy page, so its host is deliberately unrestricted. It still has
 * to be absolute `https://` with no embedded credentials so every supplied client can open it
 * safely.
 */
export function isModerationLinkUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:"
    && parsed.hostname !== ""
    && parsed.username === ""
    && parsed.password === "";
}

function tipImage(value: unknown): string | null {
  const url = boundedText(value, MAX_URL_LENGTH);
  if (url === null || url === "") return null;
  return isTrustedTipImageUrl(url) ? url : null;
}

function tipItem(value: unknown): SignupPhotoTipItem | null {
  const source = record(value);
  const caption = localizedText(source?.caption, MAX_CAPTION_LENGTH);
  const sortOrder = integer(source?.sort_order);
  if (
    !source
    || typeof source.key !== "string"
    || !TIP_KEY_PATTERN.test(source.key)
    || !caption
    || (source.verdict !== "good" && source.verdict !== "bad")
    || sortOrder === null
    || sortOrder < 0
    || sortOrder > MAX_SORT_ORDER
  ) return null;

  const female = tipImage(source.image_female);
  if (female === null) return null;

  // Optional (§1). Absent, `null` and `""` all mean "no male variant"; anything present has to
  // clear the same trust boundary as the female image.
  const rawMale = source.image_male;
  let male: string | null = null;
  if (rawMale !== undefined && rawMale !== null && rawMale !== "") {
    male = tipImage(rawMale);
    if (male === null) return null;
  }

  return {
    key: source.key,
    caption,
    verdict: source.verdict,
    sort_order: sortOrder,
    image_female: female,
    image_male: male,
  };
}

function moderationBlock(value: unknown): SignupPhotoModeration | null {
  const source = record(value);
  const text = localizedText(source?.text, MAX_MODERATION_TEXT_LENGTH);
  const linkTitle = localizedText(source?.link_title, MAX_LINK_TITLE_LENGTH);
  const linkUrl = boundedText(source?.link_url, MAX_URL_LENGTH);
  if (
    !source
    || typeof source.enabled !== "boolean"
    || !text
    || !linkTitle
    || linkUrl === null
    || (linkUrl !== "" && !isModerationLinkUrl(linkUrl))
  ) return null;
  return { enabled: source.enabled, text, link_title: linkTitle, link_url: linkUrl };
}

function avatarBlock(value: unknown): SignupPhotoAvatar | null {
  const source = record(value);
  const title = localizedText(source?.title, MAX_TITLE_LENGTH);
  const subtitle = localizedText(source?.subtitle, MAX_SUBTITLE_LENGTH);
  if (!source || !title || !subtitle) return null;
  return { title, subtitle };
}

function tipsBlock(value: unknown): SignupPhotoTips | null {
  const source = record(value);
  const title = localizedText(source?.title, MAX_TITLE_LENGTH);
  if (!source || !title || !Array.isArray(source.items)) return null;
  // Over the cap is a document this editor cannot legally save back, so it is a load failure rather
  // than a silent truncation to twelve.
  if (source.items.length > MAX_TIP_ITEMS) return null;
  const items: SignupPhotoTipItem[] = [];
  for (const raw of source.items) {
    const item = tipItem(raw);
    if (!item) return null;
    items.push(item);
  }
  if (new Set(items.map((item) => item.key)).size !== items.length) return null;
  // Core emits the public payload sorted by `(sort_order, key)` (§2). The editor shows the same
  // order so the list on screen is the list members see.
  items.sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  return { title, items };
}

/**
 * The audit stamp is display metadata, but "unreadable" and "never written" are different answers
 * and the caller must be able to tell them apart. Absent, `null` and `0` all mean never written;
 * anything that is not a non-negative integer fails the parse rather than rendering as never.
 */
function auditTimestamp(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const seconds = integer(value);
  if (seconds === null || seconds < 0) return { ok: false };
  return { ok: true, value: seconds === 0 ? null : seconds };
}

/**
 * Parse Core's `config` object. Returns `null` on anything unreadable — the page then renders its
 * load error and offers a retry, exactly like the Icebreaker catalog.
 */
export function signupPhotoConfig(value: unknown): SignupPhotoConfig | null {
  const source = record(value);
  const revision = integer(source?.revision);
  const minPhotos = integer(source?.min_photos);
  const maxPhotos = integer(source?.max_photos);
  const moderation = moderationBlock(source?.moderation);
  const avatar = avatarBlock(source?.avatar);
  const tips = tipsBlock(source?.tips);
  if (
    !source
    || source.schema_version !== SIGNUP_PHOTO_SCHEMA_VERSION
    || revision === null
    || revision < 0
    || minPhotos === null
    || maxPhotos === null
    || minPhotos < MIN_PHOTO_COUNT
    || minPhotos > MAX_PHOTO_COUNT
    || maxPhotos < minPhotos
    || maxPhotos > MAX_PHOTO_COUNT
    || !moderation
    || !avatar
    || !tips
  ) return null;

  const stamp = auditTimestamp(source.updated_at);
  if (!stamp.ok) return null;
  const author = source.updated_by === undefined || source.updated_by === null
    ? ""
    : boundedText(source.updated_by, MAX_UPDATED_BY_LENGTH);
  if (author === null) return null;

  return {
    schema_version: SIGNUP_PHOTO_SCHEMA_VERSION,
    revision,
    min_photos: minPhotos,
    max_photos: maxPhotos,
    moderation,
    avatar,
    tips,
    updated_at: stamp.value,
    updated_by: author,
  };
}

/**
 * The typed failure identity of a Core response.
 *
 * §4.2 writes the failure identity as `status_code: 'signup-photo-config-conflict'`, while
 * `lib/core.ts` promotes a *numeric* `status_code` to the HTTP status and every existing console
 * section reads the string out of `error`. Both spellings are therefore read rather than guessed;
 * anything outside `SIGNUP_PHOTO_FAILURE_CODES` resolves to `""` and is reported as a generic
 * failure. A bare numeric 500 is deliberately one of those: three Core paths answer with one, and
 * two of them disagree about whether the write landed, so it must not be guessed into either.
 */
export function signupPhotoFailureCode(response: unknown): SignupPhotoFailureCode | "" {
  const row = record(response);
  if (!row) return "";
  for (const candidate of [row.error, row.status_code, row.error_code]) {
    if (typeof candidate === "string" && FAILURE_CODE_SET.has(candidate)) {
      return candidate as SignupPhotoFailureCode;
    }
  }
  // The browser never sees the HTTP status — `adminClient` returns the parsed body only — but the
  // numeric `status_code` survives in it. §4.2 gives this action exactly one 409, so a bare numeric
  // conflict is still unambiguous, and mistaking it for a generic failure would leave a discarded
  // draft on screen next to a document that had already moved on.
  if (Number(row.status_code) === 409) return "signup-photo-config-conflict";
  return "";
}

let uidCounter = 0;

function tipUid(): string {
  uidCounter += 1;
  return `tip-row-${uidCounter}`;
}

export function draftFromConfig(config: SignupPhotoConfig): SignupPhotoDraft {
  return {
    revision: config.revision,
    min_photos: config.min_photos,
    max_photos: config.max_photos,
    moderation: structuredClone(config.moderation),
    avatar: structuredClone(config.avatar),
    tips: {
      title: structuredClone(config.tips.title),
      items: config.tips.items.map((item) => ({ ...structuredClone(item), uid: tipUid() })),
    },
  };
}

/** Replace one locale in a map without disturbing the locales this console does not edit. */
export function withLocale(
  map: SignupPhotoLocalizedText,
  locale: string,
  value: string,
): SignupPhotoLocalizedText {
  return { ...map, [locale]: value };
}

/**
 * Keep the list in `(sort_order, key)` order, and renumber by position when two items share a
 * value. Duplicates are not merely untidy: with equal `sort_order`s the reorder buttons — which
 * swap the two values — would silently do nothing, and Core's `(sort_order, key)` emission would
 * put the items in an order the operator never chose.
 */
export function normalizeTipOrder(items: SignupPhotoTipDraft[]): SignupPhotoTipDraft[] {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  const unique = new Set(sorted.map((item) => item.sort_order)).size === sorted.length;
  if (unique) return sorted;
  return sorted.map((item, index) => ({ ...item, sort_order: (index + 1) * 10 }));
}

/** Swap an item with its neighbour by exchanging their `sort_order` values. */
export function movedTipItem(
  items: SignupPhotoTipDraft[],
  index: number,
  delta: -1 | 1,
): SignupPhotoTipDraft[] {
  const ordered = normalizeTipOrder(items);
  const target = index + delta;
  if (index < 0 || index >= ordered.length || target < 0 || target >= ordered.length) return ordered;
  const next = ordered.map((item) => ({ ...item }));
  const moving = next[index].sort_order;
  next[index].sort_order = next[target].sort_order;
  next[target].sort_order = moving;
  return normalizeTipOrder(next);
}

/** The first `tip_<n>` not already used, so a new row never collides with an existing key. */
export function nextTipKey(items: SignupPhotoTipItem[]): string {
  const used = new Set(items.map((item) => item.key));
  for (let index = 1; index <= MAX_TIP_ITEMS + 1; index += 1) {
    const key = `tip_${index}`;
    if (!used.has(key)) return key;
  }
  return `tip_${items.length + 1}`;
}

export function newTipItem(items: SignupPhotoTipDraft[]): SignupPhotoTipDraft {
  const highest = items.reduce((max, item) => Math.max(max, item.sort_order), 0);
  return {
    uid: tipUid(),
    key: nextTipKey(items),
    caption: { en: "", hu: "" },
    verdict: "good",
    sort_order: Math.min(highest + 10, MAX_SORT_ORDER),
    image_female: "",
    image_male: null,
  };
}

function filledInBothLocales(map: SignupPhotoLocalizedText): boolean {
  return REQUIRED_LOCALES.every((locale) => (map[locale] ?? "").trim() !== "");
}

/**
 * The parser refuses surrounding whitespace so a parsed document is byte-identical to the stored
 * one. Anything the editor submits therefore has to be trimmed on the way out — otherwise a stray
 * trailing space typed into a caption would save successfully and then make the very next load of
 * the page fail to parse.
 */
function trimmedMap(map: SignupPhotoLocalizedText): SignupPhotoLocalizedText {
  const result: SignupPhotoLocalizedText = {};
  for (const [locale, text] of Object.entries(map)) result[locale] = text.trim();
  return result;
}

/**
 * §4.2's required-when-used validation, repeated locally so the operator sees which field is at
 * fault instead of a generic 422. Core remains authoritative; this never relaxes anything.
 */
export function validateSignupPhotoDraft(draft: SignupPhotoDraft): SignupPhotoDraftIssue | null {
  if (
    !Number.isInteger(draft.min_photos)
    || !Number.isInteger(draft.max_photos)
    || draft.min_photos < MIN_PHOTO_COUNT
    || draft.min_photos > MAX_PHOTO_COUNT
    || draft.max_photos < draft.min_photos
    || draft.max_photos > MAX_PHOTO_COUNT
  ) return "count";

  // The URL is checked whenever it is non-empty, switched off or not. That is Core's rule, not a
  // stricter local one: `SignupPhotoExperiencePolicy::normalizeModeration()` refuses an unparseable
  // `link_url` before it looks at `enabled`, deliberately, so a broken address parked behind a
  // disabled toggle cannot go live the moment somebody flips it back on. Skipping the whole branch
  // while disabled made that a round-trip 422 that named no field — the one thing this function
  // exists to prevent.
  const moderationLink = draft.moderation.link_url.trim();
  if (moderationLink !== "" && !isModerationLinkUrl(moderationLink)) return "moderationLink";

  // What the toggle does govern is whether the block is *required*. Empty stays legal while the
  // notice is off, and the strings are not demanded either.
  if (draft.moderation.enabled && (
    !filledInBothLocales(draft.moderation.text)
    || !filledInBothLocales(draft.moderation.link_title)
    || moderationLink === ""
  )) return "moderation";

  if (!filledInBothLocales(draft.avatar.title) || !filledInBothLocales(draft.avatar.subtitle)) {
    return "avatar";
  }

  if (!filledInBothLocales(draft.tips.title)) return "tipsTitle";

  if (draft.tips.items.length > MAX_TIP_ITEMS) return "tooManyTips";

  const keys = new Set<string>();
  for (const item of draft.tips.items) {
    if (!TIP_KEY_PATTERN.test(item.key)) return "tipKey";
    if (keys.has(item.key)) return "duplicateTipKey";
    keys.add(item.key);
    if (!filledInBothLocales(item.caption)) return "tipCaption";
    if (!isTrustedTipImageUrl(item.image_female.trim())) return "tipImage";
    const male = (item.image_male ?? "").trim();
    if (male !== "" && !isTrustedTipImageUrl(male)) return "tipImage";
  }

  return null;
}

/**
 * The exact `save_signup_photo_config` parameters of §4.2. Whole-document replace: every block is
 * submitted every time, so a field this editor forgets to send is a field Core deletes.
 */
export function signupPhotoSavePayload(draft: SignupPhotoDraft): Record<string, unknown> {
  return {
    min_photos: draft.min_photos,
    max_photos: draft.max_photos,
    moderation_json: JSON.stringify({
      enabled: draft.moderation.enabled,
      text: trimmedMap(draft.moderation.text),
      link_title: trimmedMap(draft.moderation.link_title),
      link_url: draft.moderation.link_url.trim(),
    }),
    avatar_json: JSON.stringify({
      title: trimmedMap(draft.avatar.title),
      subtitle: trimmedMap(draft.avatar.subtitle),
    }),
    // The wire fields are listed one by one, so the browser-only `uid` cannot leak into the
    // document and a future draft-only field cannot leak either.
    tips_json: JSON.stringify({
      title: trimmedMap(draft.tips.title),
      items: draft.tips.items.map((item) => ({
        key: item.key,
        caption: trimmedMap(item.caption),
        verdict: item.verdict,
        sort_order: item.sort_order,
        image_female: item.image_female.trim(),
        image_male: (item.image_male ?? "").trim() === "" ? null : (item.image_male ?? "").trim(),
      })),
    }),
    expected_revision: draft.revision,
  };
}

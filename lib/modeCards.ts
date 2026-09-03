import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/**
 * Accepted Webadmin mode-card family contract v1 (T-706, owner decision D-115;
 * mode names D-116).
 *
 * Pure: no `server-only` import, so the proxy normalizes bodies with the same
 * module the browser decodes with and the tests exercise under plain Node. It
 * is pinned on Core's committed `mode_cards_wire` corpus, copied byte-identical
 * into `tests/fixtures/mode_cards_wire`.
 */
export const MODE_CARDS_CONTRACT_VERSION = 1 as const;
/** The `ios_appconfig` block's OWN version; the app plane moves independently. */
export const MODE_CARDS_APP_CONTRACT_VERSION = 1 as const;

/** The closed card vocabulary, in Core's publication order. */
export const MODE_CARDS = ["people", "dates"] as const;
export const MODE_CARD_LANGUAGES = ["en", "hu"] as const;
export const MODE_CARDS_ACTIONS = ["mode_cards_get", "save_mode_cards"] as const;

export const MODE_CARDS_TITLE_MAX = 40 as const;
export const MODE_CARDS_SUBTITLE_MAX = 180 as const;
export const MODE_CARDS_URL_MAX = 512 as const;
export const MODE_CARDS_REVISION_MAX = 2_147_483_647 as const;

/**
 * D-115 wants a square TRANSPARENT PNG drawn bare at the height of the
 * title+subtitle block. Core refuses anything else at save time; this console
 * refuses it before the upload, so an operator learns at the file picker rather
 * than after a round trip.
 */
export const MODE_CARDS_ICON_MIME = "image/png" as const;
export const MODE_CARDS_ICON_MIN_DIMENSION = 16 as const;
export const MODE_CARDS_ICON_MAX_DIMENSION = 512 as const;
/** The shared catalogue icon path's own decoded ceiling. */
export const MODE_CARDS_ICON_MAX_BYTES = 2_097_152 as const;

export const MODE_CARDS_TARGET = "mode_cards:v1" as const;

export type ModeCardKey = (typeof MODE_CARDS)[number];
export type ModeCardLanguage = (typeof MODE_CARD_LANGUAGES)[number];
export type ModeCardsAction = (typeof MODE_CARDS_ACTIONS)[number];

export type ModeCardText = Record<ModeCardLanguage, string>;
export type ModeCardIcon = { url: string; mime: typeof MODE_CARDS_ICON_MIME };

export type ModeCard = {
  key: ModeCardKey;
  title: ModeCardText;
  subtitle: ModeCardText;
  icon: ModeCardIcon | null;
};

export type ModeCardsState = {
  contract_version: 1;
  cards: ModeCard[];
  revision: number;
  updated_at: number;
  updated_by: string;
};

export type ModeCardsMutation = ModeCardsState & {
  no_change: boolean;
  replayed: boolean;
};

export type ModeCardsConflict = { current: ModeCardsState };

/** The public `ios_appconfig.mode_cards` block, decoded for the corpus test. */
export type ModeCardsAppBlock = { contract_version: 1; cards: ModeCard[] };

type JsonObject = Record<string, unknown>;

export type ModeCardInput = {
  title: ModeCardText;
  subtitle: ModeCardText;
  icon: ModeCardIcon | null;
};

export type ModeCardsSavePayload = JsonObject & {
  contract_version: 1;
  cards: Record<ModeCardKey, ModeCardInput>;
  expected_revision: number;
  request_id: string;
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

function scalarLength(value: string): number {
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

/** NFC-normalized, trimmed, control-free operator copy of 1..max scalars. */
function canonicalText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)
    || value !== value.normalize("NFC") || value !== value.trim()) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  const length = scalarLength(value);
  return length >= 1 && length <= max ? value : null;
}

export function modeCardTextIsValid(value: unknown, max: number): value is string {
  return canonicalText(value, max) !== null;
}

/** Core only ever serves an icon on its own managed https origin. */
function canonicalIconUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return null;
  if (value.length > MODE_CARDS_URL_MAX || !value.startsWith("https://")) return null;
  return hasUnpairedSurrogate(value) || PLAIN_TEXT_CONTROL.test(value) ? null : value;
}

function modeCardIcon(value: unknown): ModeCardIcon | null | undefined {
  if (value === null) return null;
  const source = exactObject(value, ["url", "mime"]);
  const url = canonicalIconUrl(source?.url);
  return url && source?.mime === MODE_CARDS_ICON_MIME
    ? { url, mime: MODE_CARDS_ICON_MIME }
    : undefined;
}

function modeCardText(value: unknown, max: number): ModeCardText | null {
  const source = exactObject(value, MODE_CARD_LANGUAGES);
  if (!source) return null;
  const en = canonicalText(source.en, max);
  const hu = canonicalText(source.hu, max);
  return en !== null && hu !== null ? { en, hu } : null;
}

function modeCard(value: unknown, expected: ModeCardKey): ModeCard | null {
  // Exact keys: Core states the four-key set as the contract, so an extra key
  // is a provider change this console has not been taught, not an addition to
  // tolerate.
  const source = exactObject(value, ["key", "title", "subtitle", "icon"]);
  if (!source || source.key !== expected) return null;
  const title = modeCardText(source.title, MODE_CARDS_TITLE_MAX);
  const subtitle = modeCardText(source.subtitle, MODE_CARDS_SUBTITLE_MAX);
  const icon = modeCardIcon(source.icon);
  return title && subtitle && icon !== undefined
    ? { key: expected, title, subtitle, icon }
    : null;
}

/** The two cards, in the fixed order Core publishes and the drawer renders. */
function modeCards(value: unknown): ModeCard[] | null {
  if (!Array.isArray(value) || value.length !== MODE_CARDS.length) return null;
  const decoded = MODE_CARDS.map((key, index) => modeCard(value[index], key));
  return decoded.every((card): card is ModeCard => card !== null) ? decoded : null;
}

function modeCardsStateShape(value: unknown): ModeCardsState | null {
  const source = requiredObject(value, [
    "contract_version",
    "cards",
    "revision",
    "updated_at",
    "updated_by",
  ]);
  const cards = modeCards(source?.cards);
  const revision = integer(source?.revision, 0, MODE_CARDS_REVISION_MAX);
  const updatedAt = integer(source?.updated_at, 0);
  const updatedBy = typeof source?.updated_by === "string" && !hasUnpairedSurrogate(source.updated_by)
    && !PLAIN_TEXT_CONTROL.test(source.updated_by) && scalarLength(source.updated_by) <= 320
    ? source.updated_by
    : null;
  return source?.contract_version === MODE_CARDS_CONTRACT_VERSION
    && cards && revision !== null && updatedAt !== null && updatedBy !== null
    ? { contract_version: 1, cards, revision, updated_at: updatedAt, updated_by: updatedBy }
    : null;
}

export function modeCardsStateResponse(value: unknown): ModeCardsState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = record(envelope?.data);
  // `no_change` and `replayed` select the mutation variant. They are recognized
  // sibling fields, not arbitrary additions to a read response.
  if (data && (Object.hasOwn(data, "no_change") || Object.hasOwn(data, "replayed"))) return null;
  return envelope ? modeCardsStateShape(envelope.data) : null;
}

export function modeCardsMutationResponse(value: unknown): ModeCardsMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = requiredObject(envelope?.data, [
    "contract_version",
    "cards",
    "revision",
    "updated_at",
    "updated_by",
    "no_change",
    "replayed",
  ]);
  if (!source || typeof source.no_change !== "boolean"
    || typeof source.replayed !== "boolean") return null;
  const state = modeCardsStateShape({
    contract_version: source.contract_version,
    cards: source.cards,
    revision: source.revision,
    updated_at: source.updated_at,
    updated_by: source.updated_by,
  });
  return state ? { ...state, no_change: source.no_change, replayed: source.replayed } : null;
}

/** The only refusal allowed to carry data; a malformed `current` fails closed. */
export function modeCardsConflictResponse(value: unknown): ModeCardsConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (envelope?.error !== "mode-cards-conflict" || envelope.status_code !== 409) return null;
  const source = requiredObject(envelope.data, ["current"]);
  const current = modeCardsStateShape(source?.current);
  return current ? { current } : null;
}

/**
 * The public `ios_appconfig` block. This console never fetches it; the decoder
 * exists so the corpus test proves the console and the app read the same two
 * cards out of the same bytes.
 */
export function modeCardsAppBlock(value: unknown): ModeCardsAppBlock | null {
  const source = exactObject(value, ["contract_version", "cards"]);
  const cards = modeCards(source?.cards);
  return source?.contract_version === MODE_CARDS_APP_CONTRACT_VERSION && cards
    ? { contract_version: 1, cards }
    : null;
}

export const MODE_CARDS_ERROR_STATUSES: Readonly<Record<string, number>> = {
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
  "mode-cards-read-required": 403,
  "mode-cards-edit-required": 403,
  "mode-cards-contract-version-required": 422,
  "mode-cards-contract-version-invalid": 422,
  "mode-cards-request-invalid": 422,
  "mode-cards-cards-invalid": 422,
  "mode-cards-title-invalid": 422,
  "mode-cards-subtitle-invalid": 422,
  "mode-cards-icon-invalid": 422,
  "mode-cards-icon-unmanaged": 422,
  "mode-cards-icon-dimensions-invalid": 422,
  "mode-cards-revision-invalid": 422,
  "mode-cards-request-id-invalid": 422,
  "mode-cards-conflict": 409,
  "mode-cards-request-id-conflict": 409,
  "mode-cards-request-in-progress": 409,
  "mode-cards-stored-invalid": 503,
  "mode-cards-read-failed": 503,
  "mode-cards-audit-write-failed": 503,
  "mode-cards-receipt-write-failed": 503,
  "mode-cards-write-failed": 503,
};

/**
 * Decode only no-data refusals. The conflict branch is parsed above and is
 * deliberately excluded here; a malformed conflict must stay unknown so the
 * durable identity cannot be cleared by a partial response.
 */
export function modeCardsError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && error !== "mode-cards-conflict"
    && Object.hasOwn(MODE_CARDS_ERROR_STATUSES, error)
    && MODE_CARDS_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

/**
 * The closed set of leaves a 422 may point at. A save carries twelve editable
 * values, so the refusal names one — but the pointer is DATA from the wire and
 * is only believed when it is one of the leaves this console actually renders.
 */
export const MODE_CARDS_FIELD_POINTERS: readonly string[] = [
  "cards",
  "expected_revision",
  "request_id",
  ...MODE_CARDS.flatMap((card) => [
    `cards.${card}`,
    `cards.${card}.icon`,
    `cards.${card}.icon.url`,
    `cards.${card}.icon.mime`,
    ...(["title", "subtitle"] as const).flatMap((slot) => [
      `cards.${card}.${slot}`,
      ...MODE_CARD_LANGUAGES.map((language) => `cards.${card}.${slot}.${language}`),
    ]),
  ]),
];

export function modeCardsFieldPointer(value: unknown): string | null {
  const source = record(value);
  const field = source?.field;
  return typeof field === "string" && MODE_CARDS_FIELD_POINTERS.includes(field) ? field : null;
}

export type ModeCardsErrorKey =
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
  | "cardsInvalid"
  | "titleInvalid"
  | "subtitleInvalid"
  | "iconInvalid"
  | "iconUnmanaged"
  | "iconDimensions"
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

const MODE_CARDS_ERROR_KEYS: Readonly<Record<string, ModeCardsErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "bad-origin": "badOrigin",
  "not-found": "routeNotFound",
  "mode-cards-read-required": "readRequired",
  "admin-write-required": "editRequired",
  "mode-cards-edit-required": "editRequired",
  "invalid-input": "requestInvalid",
  "mode-cards-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "mode-cards-read-failed": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
  "mode-cards-contract-version-required": "contractVersion",
  "mode-cards-contract-version-invalid": "contractVersion",
  "mode-cards-cards-invalid": "cardsInvalid",
  "mode-cards-title-invalid": "titleInvalid",
  "mode-cards-subtitle-invalid": "subtitleInvalid",
  "mode-cards-icon-invalid": "iconInvalid",
  "mode-cards-icon-unmanaged": "iconUnmanaged",
  "mode-cards-icon-dimensions-invalid": "iconDimensions",
  "mode-cards-revision-invalid": "revisionInvalid",
  "mode-cards-request-id-invalid": "requestIdInvalid",
  "mode-cards-conflict": "conflict",
  "mode-cards-request-id-conflict": "requestIdConflict",
  "mode-cards-request-in-progress": "requestInProgress",
  "mode-cards-stored-invalid": "storedInvalid",
  "mode-cards-audit-write-failed": "auditWriteFailed",
  "mode-cards-receipt-write-failed": "receiptWriteFailed",
  "mode-cards-write-failed": "writeFailed",
};

export function modeCardsErrorKey(error: string | null): ModeCardsErrorKey {
  return error && Object.hasOwn(MODE_CARDS_ERROR_KEYS, error)
    ? MODE_CARDS_ERROR_KEYS[error]
    : "generic";
}

export function modeCardsShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.hasOwn(MODE_CARDS_ERROR_STATUSES, error)
    || error === "mode-cards-request-in-progress"
    || MODE_CARDS_ERROR_STATUSES[error] >= 500;
}

// --------------------------------------------------------------- the command

function modeCardInput(value: unknown): ModeCardInput | null {
  const source = exactObject(value, ["title", "subtitle", "icon"]);
  if (!source) return null;
  const title = modeCardText(source.title, MODE_CARDS_TITLE_MAX);
  const subtitle = modeCardText(source.subtitle, MODE_CARDS_SUBTITLE_MAX);
  const icon = modeCardIcon(source.icon);
  return title && subtitle && icon !== undefined ? { title, subtitle, icon } : null;
}

function normalizeGetBody(body: JsonObject): JsonObject | null {
  // Same-origin request bodies stay exact so an undeclared field cannot reach Core.
  const source = exactObject(body, ["contract_version"]);
  return source?.contract_version === MODE_CARDS_CONTRACT_VERSION
    ? Object.assign(Object.create(null), { contract_version: 1 })
    : null;
}

function normalizeSaveBody(body: JsonObject): ModeCardsSavePayload | null {
  const source = exactObject(body, [
    "contract_version", "cards", "expected_revision", "request_id",
  ]);
  const rawCards = exactObject(source?.cards, MODE_CARDS);
  const revision = integer(source?.expected_revision, 0, MODE_CARDS_REVISION_MAX);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  if (source?.contract_version !== MODE_CARDS_CONTRACT_VERSION
    || !rawCards || revision === null || !requestId) return null;
  const cards: Partial<Record<ModeCardKey, ModeCardInput>> = {};
  for (const key of MODE_CARDS) {
    const card = modeCardInput(rawCards[key]);
    if (!card) return null;
    cards[key] = card;
  }
  return Object.assign(Object.create(null), {
    contract_version: 1,
    // Rebuilt in publication order so the JSON Core receives is stable, which
    // is what makes a receipt fingerprint reproducible across a retry.
    cards: Object.fromEntries(MODE_CARDS.map((key) => [key, cards[key]])),
    expected_revision: revision,
    request_id: requestId,
  }) as ModeCardsSavePayload;
}

/** `undefined` is another family, `null` is refused, an object may reach Core. */
export function normalizeModeCardsProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(MODE_CARDS_ACTIONS as readonly string[]).includes(action)) return undefined;
  return action === "mode_cards_get" ? normalizeGetBody(body) : normalizeSaveBody(body);
}

// ------------------------------------------------------- the durable identity

export type ModeCardsPendingMutation = {
  version: 1;
  action: "save_mode_cards";
  target: typeof MODE_CARDS_TARGET;
  payload: ModeCardsSavePayload;
};

export const MODE_CARDS_PENDING_STORAGE_KEY = "friending.mode-cards.pending-mutation.v1";

export function modeCardsPendingMutation(
  target: string,
  body: JsonObject,
): ModeCardsPendingMutation | null {
  const payload = normalizeSaveBody(body);
  return payload && target === MODE_CARDS_TARGET
    ? { version: 1, action: "save_mode_cards", target: MODE_CARDS_TARGET, payload }
    : null;
}

export function modeCardsPendingFrom(value: unknown): ModeCardsPendingMutation | null {
  // The persisted retry identity stays exact so a replay cannot acquire new
  // semantics from a storage value someone else wrote.
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  return source?.version === 1 && source.action === "save_mode_cards"
    && typeof source.target === "string"
    ? modeCardsPendingMutation(source.target, record(source.payload) ?? {})
    : null;
}

export async function modeCardsPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: ModeCardsPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = modeCardsPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(MODE_CARDS_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

// ------------------------------------------------------------- convergence

function sameIcon(a: ModeCardIcon | null, b: ModeCardIcon | null): boolean {
  return a === null || b === null ? a === b : a.url === b.url && a.mime === b.mime;
}

/** Does the served state carry exactly the copy this command asked for? */
export function modeCardsStateMatchesPayload(
  payload: ModeCardsSavePayload,
  state: ModeCardsState,
): boolean {
  return MODE_CARDS.every((key, index) => {
    const wanted = payload.cards[key];
    const served = state.cards[index];
    return Boolean(wanted && served && served.key === key
      && MODE_CARD_LANGUAGES.every((language) =>
        served.title[language] === wanted.title[language]
        && served.subtitle[language] === wanted.subtitle[language])
      && sameIcon(served.icon, wanted.icon));
  });
}

/** A decoded mutation proves either the exact no-op or one revision transition. */
export function modeCardsMutationConverged(
  pending: ModeCardsPendingMutation,
  result: ModeCardsMutation,
): boolean {
  const canonical = modeCardsPendingFrom(pending);
  if (!canonical || !modeCardsStateMatchesPayload(canonical.payload, result)) return false;
  return result.no_change
    ? result.revision === canonical.payload.expected_revision
    : result.revision === canonical.payload.expected_revision + 1;
}

/**
 * A read after a reload may prove a lost response converged without another
 * write. Only the requested copy at the exact no-op or one-step revision is
 * sufficient; a later or ambiguous revision stays pending.
 */
export function modeCardsStateConverged(
  pending: ModeCardsPendingMutation,
  state: ModeCardsState,
): boolean {
  const canonical = modeCardsPendingFrom(pending);
  return Boolean(canonical
    && modeCardsStateMatchesPayload(canonical.payload, state)
    && (state.revision === canonical.payload.expected_revision
      || state.revision === canonical.payload.expected_revision + 1));
}

export function modeCardsConflictSatisfiesPending(
  pending: ModeCardsPendingMutation,
  conflict: ModeCardsConflict,
): boolean {
  const canonical = modeCardsPendingFrom(pending);
  return Boolean(canonical && modeCardsStateMatchesPayload(canonical.payload, conflict.current));
}

// ---------------------------------------------------------------- the icon

export type ModeCardIconFileError = "empty" | "size" | "type" | "signature" | "dimensions";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/**
 * D-115's icon rule, read out of the PNG header itself: the signature, then
 * IHDR's width and height. Core re-checks the stored bytes and is the
 * authority; this exists so a wrong file is refused at the file picker instead
 * of after an upload the operator then has to undo.
 */
export function modeCardIconBytesError(
  bytes: Uint8Array,
  totalSize: number,
): ModeCardIconFileError | null {
  if (totalSize === 0) return "empty";
  if (totalSize > MODE_CARDS_ICON_MAX_BYTES) return "size";
  if (bytes.length < 24) return "signature";
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "signature";
  // IHDR must be the first chunk, with the fixed 13-byte length.
  if (uint32(bytes, 8) !== 13) return "signature";
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48
    || bytes[14] !== 0x44 || bytes[15] !== 0x52) return "signature";
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  return width === height
    && width >= MODE_CARDS_ICON_MIN_DIMENSION
    && width <= MODE_CARDS_ICON_MAX_DIMENSION
    ? null
    : "dimensions";
}

/** Reads only the first 24 bytes: the signature and IHDR carry the answer. */
export async function modeCardIconFileError(
  file: Pick<File, "size" | "type" | "slice">,
): Promise<ModeCardIconFileError | null> {
  if (file.size === 0) return "empty";
  if (file.size > MODE_CARDS_ICON_MAX_BYTES) return "size";
  if (file.type !== MODE_CARDS_ICON_MIME) return "type";
  return modeCardIconBytesError(new Uint8Array(await file.slice(0, 24).arrayBuffer()), file.size);
}

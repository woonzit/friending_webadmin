import { DATES_EXTERNAL_RETRY_SECONDS, type DatesExternalStorage } from "@/lib/datesExternalMutations";
import {
  DATES_INTAKE_INPUT_KINDS, DATES_INTAKE_MAX_IMAGE_BYTES, DATES_INTAKE_MAX_IMAGES, projectDatesIntakeDetail, projectDatesIntakeQueue,
  type DatesIntakeCreateReceipt, type DatesIntakeSourceKind, type DatesIntakeStatus,
} from "@/lib/datesIntakeAdmin";
import {
  createDatesIntakeSourceKey, submitDatesIntakeSource, type DatesIntakeCommandOutcome, type DatesIntakePost, type DatesIntakeSend,
  type DatesIntakeSourceDraft,
} from "@/lib/datesIntakeConsole";

/**
 * The durable record of a "Draft from source" submission whose outcome is not
 * known - its tombstone.
 *
 * A create has no revision to fence it: under a new idempotency key the same
 * source becomes a second intake, with its queue work and its AI spend. So
 * the key must outlive the page. Before a request leaves, the console writes
 * a tombstone to per-browser storage, scoped to the signed-in operator: the
 * key, the time, the input kind and a fingerprint of the inputs - for a flyer
 * the file's SHA-256, size and name, never its bytes, and never the link or
 * the text themselves. While a tombstone exists the source panel shows it
 * first, on any page and after any reload.
 *
 * A tombstone is retired by exactly these, and by nothing else:
 *  - Core's receipt for the same request (a resend under the same key);
 *  - Core's definitive no-write refusal (the journal's closed list);
 *  - a queue read made for it, long enough after the last attempt, that shows
 *    either no draft created by this operator since the submission (it did
 *    not arrive) or the drafts this operator did create since (it is there
 *    to be opened). The operator's wish alone retires nothing.
 */

/** Core keeps a command's receipt for seven days; the console stops resending a day earlier, like the journal. */
export const DATES_INTAKE_TOMBSTONE_RESEND_SECONDS = DATES_EXTERNAL_RETRY_SECONDS;
/** A queue read proves nothing about an attempt that may still be running in Core: the upload route alone may take a minute. */
export const DATES_INTAKE_TOMBSTONE_SETTLE_SECONDS = 180;
/** Allowance for the difference between this browser's clock and Core's when comparing with `created_at`. */
export const DATES_INTAKE_TOMBSTONE_SKEW_SECONDS = 300;
const EVIDENCE_PAGE_SIZE = 100, EVIDENCE_MAX_PAGES = 20, EVIDENCE_MAX_CANDIDATES = 50;

export type DatesIntakeTombstoneFile = { sha256: string; size: number; name: string };
export type DatesIntakeTombstone = {
  version: 1; actor: string; key: string;
  /** When the first attempt was made, and the latest one (console clock, seconds). */
  at: number; last_at: number;
  kind: DatesIntakeSourceKind; locale: "en" | "hu"; fingerprint: string; files: DatesIntakeTombstoneFile[];
};
export type DatesIntakeTombstoneRead =
  | { kind: "empty" }
  /** No usable storage, or a record that cannot be read. It is never cleared silently. */
  | { kind: "blocked" }
  | { kind: "pending"; tombstone: DatesIntakeTombstone };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const closed = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const actorValid = (value: unknown): value is string => typeof value === "string" && value === value.trim().toLowerCase() && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
const clock = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 4_102_444_800;
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const storageKey = (actor: string) => `friending:dates-intake:create:v1:${encodeURIComponent(actor)}`;

function fileValid(value: unknown): value is DatesIntakeTombstoneFile {
  return closed(value, ["sha256", "size", "name"]) && digest(value.sha256) && typeof value.size === "number" && Number.isSafeInteger(value.size)
    && value.size >= 1 && value.size <= DATES_INTAKE_MAX_IMAGE_BYTES && typeof value.name === "string" && value.name.length <= 255;
}
function tombstoneValid(value: unknown, actor: string): value is DatesIntakeTombstone {
  return closed(value, ["version", "actor", "key", "at", "last_at", "kind", "locale", "fingerprint", "files"]) && value.version === 1
    && actorValid(actor) && value.actor === actor && typeof value.key === "string" && /^dates-intake-create:[A-Za-z0-9._:-]{15,100}$/.test(value.key)
    && clock(value.at) && clock(value.last_at) && value.last_at >= value.at
    && typeof value.kind === "string" && (DATES_INTAKE_INPUT_KINDS as readonly string[]).includes(value.kind)
    && (value.locale === "en" || value.locale === "hu") && digest(value.fingerprint)
    && Array.isArray(value.files) && value.files.length <= DATES_INTAKE_MAX_IMAGES && value.files.every(fileValid)
    && (value.kind === "images") === (value.files.length > 0);
}
const same = (a: DatesIntakeTombstone, b: DatesIntakeTombstone) => JSON.stringify(a) === JSON.stringify(b);

/** Per-browser storage: a tombstone must survive a reload, a closed tab and a new one. */
export function datesIntakeTombstoneStorage(): DatesExternalStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readDatesIntakeTombstone(storage: DatesExternalStorage | null, actor: string): DatesIntakeTombstoneRead {
  if (!storage || !actorValid(actor)) return { kind: "blocked" };
  try {
    const raw = storage.getItem(storageKey(actor));
    if (raw === null) return { kind: "empty" };
    if (raw.length > 4000) return { kind: "blocked" };
    const value: unknown = JSON.parse(raw);
    return tombstoneValid(value, actor) ? { kind: "pending", tombstone: value } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}

function write(storage: DatesExternalStorage, tombstone: DatesIntakeTombstone): boolean {
  try {
    storage.setItem(storageKey(tombstone.actor), JSON.stringify(tombstone));
    const saved = readDatesIntakeTombstone(storage, tombstone.actor);
    return saved.kind === "pending" && same(saved.tombstone, tombstone);
  } catch { return false; }
}

/** Removes exactly this tombstone; never a replacement and never an unreadable record. */
function clear(storage: DatesExternalStorage, tombstone: DatesIntakeTombstone): boolean {
  const current = readDatesIntakeTombstone(storage, tombstone.actor);
  if (current.kind !== "pending" || current.tombstone.key !== tombstone.key) return false;
  try {
    storage.removeItem(storageKey(tombstone.actor));
    return storage.getItem(storageKey(tombstone.actor)) === null;
  } catch { return false; }
}

export async function datesSha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type DatesIntakeSourceFingerprint = { fingerprint: string; files: Array<{ sha256: string; size: number }> };

/**
 * The identity of a source's content: exactly what `submitDatesIntakeSource`
 * puts on the wire for it - the kind, the trimmed link, the text as it is
 * sent, each flyer's digest and size, in order. Two sources with one
 * fingerprint are one request; nothing of the content can be read back from it.
 */
export async function datesIntakeSourceFingerprint(draft: DatesIntakeSourceDraft, files: readonly Blob[]): Promise<DatesIntakeSourceFingerprint> {
  const flyers = draft.kind === "images" ? await Promise.all(files.map(async (file) => ({ sha256: await datesSha256Hex(await file.arrayBuffer()), size: file.size }))) : [];
  const url = draft.kind === "url" ? draft.url.trim() : null;
  const text = draft.kind !== "url" && draft.text.trim() !== "" ? draft.text : null;
  return { files: flyers, fingerprint: await datesSha256Hex(JSON.stringify(["dates-intake-create/v1", draft.kind, url, text, flyers.map((file) => [file.sha256, file.size])])) };
}

/**
 * Refusals Core's create route raises BEFORE it looks the request's identity
 * up, from something that can differ between two attempts of one request: the
 * default-off switch, and a flyer that did not arrive whole. For the first
 * attempt of an identity they prove that nothing was written. After an attempt
 * whose outcome is unknown they say nothing about that earlier attempt.
 */
const CREATE_REFUSED_BEFORE_REPLAY: readonly string[] = ["dates-intake-admin-drafts-disabled", "dates-intake-image-invalid"];

export type DatesIntakeSourceSend =
  | DatesIntakeCommandOutcome<DatesIntakeCreateReceipt>
  /** Nothing was sent: the browser cannot keep the record, or holds one that cannot be read. */
  | { kind: "blocked" }
  /** Nothing was sent: a submission is waiting, and these are not its inputs. */
  | { kind: "mismatch" }
  /** Nothing was sent: the waiting submission is older than Core keeps its receipt. */
  | { kind: "expired" };

export type DatesIntakeSourceDeps = {
  post: DatesIntakePost; storage: DatesExternalStorage | null;
  /** The signed-in operator, as Core's identity read names them. */
  actor: string;
  /** Seconds, on a clock corrected towards Core's where the page knows the difference. */
  now: () => number;
  mint?: () => string;
};

/**
 * Sends a source. The tombstone is written (or, for a resend, found and
 * matched) before anything leaves; it is removed only by Core's receipt or
 * Core's definitive refusal. Every other outcome leaves it in place.
 */
export async function sendDatesIntakeSource(deps: DatesIntakeSourceDeps, draft: DatesIntakeSourceDraft, files: ReadonlyArray<Blob & { name?: string }>,
  locale: "en" | "hu"): Promise<DatesIntakeSourceSend> {
  const { storage, actor } = deps;
  if (!storage || readDatesIntakeTombstone(storage, actor).kind === "blocked") return { kind: "blocked" };
  let identity: DatesIntakeSourceFingerprint;
  try { identity = await datesIntakeSourceFingerprint(draft, files); } catch { return { kind: "blocked" }; }
  const now = deps.now();
  if (!clock(now)) return { kind: "blocked" };
  // Read and written without anything in between: what another tab stored while the flyer was being hashed is seen here.
  const waiting = readDatesIntakeTombstone(storage, actor);
  if (waiting.kind === "blocked") return { kind: "blocked" };
  let tombstone: DatesIntakeTombstone;
  const resend = waiting.kind === "pending";
  if (waiting.kind === "pending") {
    // The same request, or none: a different source under this key would be another payload, and a new key a second intake.
    if (waiting.tombstone.fingerprint !== identity.fingerprint || waiting.tombstone.kind !== draft.kind) return { kind: "mismatch" };
    if (now - waiting.tombstone.at >= DATES_INTAKE_TOMBSTONE_RESEND_SECONDS) return { kind: "expired" };
    tombstone = { ...waiting.tombstone, last_at: Math.max(now, waiting.tombstone.last_at) };
  } else {
    tombstone = { version: 1, actor, key: (deps.mint ?? createDatesIntakeSourceKey)(), at: now, last_at: now, kind: draft.kind, locale, fingerprint: identity.fingerprint,
      files: identity.files.map((file, index) => ({ ...file, name: String(files[index]?.name ?? "").slice(0, 255) })) };
  }
  if (!tombstoneValid(tombstone, actor) || !write(storage, tombstone)) return { kind: "blocked" };
  // The locale is part of what Core hashes: a resend carries the first attempt's, whatever the page shows now.
  let outcome = await submitDatesIntakeSource(deps.post, draft, files, tombstone.locale, tombstone.key);
  if (outcome.kind === "refused" && resend && CREATE_REFUSED_BEFORE_REPLAY.includes(outcome.error)) outcome = { kind: "uncertain", error: outcome.error };
  if (outcome.kind !== "uncertain") clear(storage, tombstone);
  // The record must still be there when the outcome is not known; if something emptied the slot meanwhile, it is put back.
  else if (readDatesIntakeTombstone(storage, actor).kind === "empty") write(storage, tombstone);
  return outcome;
}

export type DatesIntakeTombstoneFound = { intake_id: string; input_kind: DatesIntakeSourceKind | null; status: DatesIntakeStatus; created_at: number };
export type DatesIntakeTombstoneEvidence =
  /** The queue shows no draft created by this operator since the submission: it did not arrive. */
  | { kind: "none"; key: string; covers: number; since: number; checked_at: number }
  /** The queue shows these drafts created by this operator since the submission. */
  | { kind: "found"; key: string; covers: number; since: number; checked_at: number; intakes: DatesIntakeTombstoneFound[] }
  /** The last attempt may still be running in Core: nothing can be concluded before `retry_at`. */
  | { kind: "early"; retry_at: number }
  /** The queue could not be read completely: nothing is known. */
  | { kind: "unconfirmed" };

/**
 * Looks for the submission in the queue. Core lists every view except the
 * review queue newest first (285b14a8: `created_at` descending), so the read
 * walks admin drafts from the newest until it passes the submission's time,
 * and asks Core who created each one it meets on the way. Any row, page or
 * detail it cannot read makes the whole answer "unconfirmed".
 */
export async function readDatesIntakeTombstoneEvidence(send: DatesIntakeSend, tombstone: DatesIntakeTombstone, now: number): Promise<DatesIntakeTombstoneEvidence> {
  if (!clock(now) || now - tombstone.last_at < DATES_INTAKE_TOMBSTONE_SETTLE_SECONDS) return { kind: "early", retry_at: tombstone.last_at + DATES_INTAKE_TOMBSTONE_SETTLE_SECONDS };
  const since = tombstone.at - DATES_INTAKE_TOMBSTONE_SKEW_SECONDS;
  const candidates: Array<{ intake_id: string; input_kind: DatesIntakeSourceKind | null; status: DatesIntakeStatus; created_at: number }> = [];
  let checkedAt: number | null = null, previous = Number.POSITIVE_INFINITY, complete = false;
  try {
    for (let page = 1; page <= EVIDENCE_MAX_PAGES && !complete; page++) {
      const queue = projectDatesIntakeQueue(await send("dates_event_intake_list", { channel: "admin_draft", page, limit: EVIDENCE_PAGE_SIZE }), { page, limit: EVIDENCE_PAGE_SIZE });
      if (!queue || queue.unreadable_rows.length > 0) return { kind: "unconfirmed" };
      checkedAt ??= queue.server_now;
      for (const row of queue.intakes) {
        // The walk relies on the order; a row out of order, or without a readable time, proves nothing.
        if (row.created_at === null || row.created_at > previous || row.channel !== "admin_draft") return { kind: "unconfirmed" };
        previous = row.created_at;
        if (row.created_at < since) { complete = true; break; }
        candidates.push({ intake_id: row.intake_id, input_kind: row.input_kind, status: row.status, created_at: row.created_at });
      }
      if (queue.intakes.length < EVIDENCE_PAGE_SIZE || page * EVIDENCE_PAGE_SIZE >= queue.total) complete = true;
    }
    if (!complete || checkedAt === null || candidates.length > EVIDENCE_MAX_CANDIDATES) return { kind: "unconfirmed" };
    const mine: DatesIntakeTombstoneFound[] = [];
    for (const candidate of candidates) {
      const detail = projectDatesIntakeDetail(await send("dates_event_intake_detail", { intake_id: candidate.intake_id }), candidate.intake_id);
      const creator = detail?.intake.admin_principal;
      if (!detail || typeof creator !== "string" || creator === "") return { kind: "unconfirmed" };
      if (creator.trim().toLowerCase() === tombstone.actor) mine.push(candidate);
    }
    // `covers` names the latest attempt this read was made after; a later attempt is not covered by it.
    return mine.length === 0 ? { kind: "none", key: tombstone.key, covers: tombstone.last_at, since, checked_at: checkedAt }
      : { kind: "found", key: tombstone.key, covers: tombstone.last_at, since, checked_at: checkedAt, intakes: mine };
  } catch { return { kind: "unconfirmed" }; }
}

/**
 * Retires a tombstone on the strength of a queue read made for it. False -
 * and nothing removed - when the evidence is for another submission, says
 * nothing, or is not what the storage holds now.
 */
export function retireDatesIntakeTombstone(storage: DatesExternalStorage | null, tombstone: DatesIntakeTombstone, evidence: DatesIntakeTombstoneEvidence | null): boolean {
  if (!storage || !evidence || (evidence.kind !== "none" && evidence.kind !== "found") || evidence.key !== tombstone.key) return false;
  const current = readDatesIntakeTombstone(storage, tombstone.actor);
  // An attempt made after the queue was read is not covered by that read.
  if (current.kind !== "pending" || !same(current.tombstone, tombstone) || evidence.covers !== current.tombstone.last_at) return false;
  return clear(storage, tombstone);
}

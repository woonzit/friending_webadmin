import { datesCommandOutcome } from "@/lib/datesExternalAdmin";
import { DATES_EXTERNAL_RETRY_SECONDS, type DatesExternalStorage } from "@/lib/datesExternalMutations";
import { datesLegalHoldReceipt, datesTrailEvidenceReceipt } from "@/lib/datesModerationRead";

/**
 * The saved command of a case action that Core does not fence (T-890): the
 * legal hold, which has no revision at all, and the live-trail capture, whose
 * revision check does not move the revision. Under a new idempotency key
 * either would be applied a second time, so the command - key included - is
 * saved before it leaves and stays saved until Core answers it.
 *
 * This is the publication journal's way, on the journal's own storage (the
 * tab's session storage, per operator): one saved command at a time; a retry
 * sends exactly the saved bytes; only a receipt bound to the command or a
 * pinned no-land refusal removes it; a record that cannot be read blocks new
 * commands and is never cleared silently. There is no discard.
 */
export const DATES_KEPT_ACTIONS = ["dates_moderation_legal_hold", "dates_moderation_trail_evidence"] as const;
export type DatesKeptAction = typeof DATES_KEPT_ACTIONS[number];
export type DatesKeptCommand = { version: 1; actor: string; issued_at: number; action: DatesKeptAction; body: Record<string, unknown> };
export type DatesKeptCommandRead = { kind: "empty" } | { kind: "blocked" } | { kind: "pending"; command: DatesKeptCommand };
export type DatesKeptOutcome =
  | { kind: "success"; retained: boolean }
  | { kind: "refused"; error: string; retained: boolean }
  | { kind: "uncertain"; error: string | null }
  /** Nothing was sent: no usable storage, an unreadable record, or another command is saved. */
  | { kind: "blocked" }
  /** Nothing was sent: the saved command is older than Core keeps its receipt. */
  | { kind: "expired" };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const closed = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const actorValid = (value: unknown): value is string => typeof value === "string" && value === value.trim().toLowerCase() && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 4_102_444_800;
const caseId = (value: unknown): value is string => typeof value === "string" && /^cas_[a-f0-9]{32}$/.test(value);
const text = (value: unknown, maximum: number) => typeof value === "string" && value.trim().length >= 3 && Array.from(value).length <= maximum;
const requestKey = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value);
const storageKey = (actor: string) => `friending:dates-case-command:pending:v1:${encodeURIComponent(actor)}`;

/** The exact bodies the case page sends; anything else is not a command this store keeps. */
function bodyValid(action: unknown, body: unknown): boolean {
  if (action === "dates_moderation_legal_hold") return closed(body, ["case_id", "action", "reason", "legal_basis", "break_glass", "review_at", "idempotency_key"])
    && caseId(body.case_id) && (body.action === "place" || body.action === "release") && text(body.reason, 1000) && text(body.legal_basis, 1000)
    && typeof body.break_glass === "boolean" && (body.action === "place" ? positive(body.review_at) : body.review_at === null) && requestKey(body.idempotency_key);
  if (action === "dates_moderation_trail_evidence") return closed(body, ["case_id", "expected_revision", "captured_from", "captured_to", "reason", "break_glass", "idempotency_key"])
    && caseId(body.case_id) && positive(body.expected_revision) && positive(body.captured_from) && positive(body.captured_to)
    && Number(body.captured_to) > Number(body.captured_from) && text(body.reason, 1000) && typeof body.break_glass === "boolean" && requestKey(body.idempotency_key);
  return false;
}
function commandValid(value: unknown, actor: string): value is DatesKeptCommand {
  return closed(value, ["version", "actor", "issued_at", "action", "body"]) && value.version === 1 && actorValid(actor) && value.actor === actor
    && positive(value.issued_at) && bodyValid(value.action, value.body);
}
const same = (a: DatesKeptCommand, b: DatesKeptCommand) => JSON.stringify(a) === JSON.stringify(b);

export function readDatesKeptCommand(storage: DatesExternalStorage | null, actor: string): DatesKeptCommandRead {
  if (!storage || !actorValid(actor)) return { kind: "blocked" };
  try {
    const raw = storage.getItem(storageKey(actor));
    if (raw === null) return { kind: "empty" };
    if (raw.length > 16000) return { kind: "blocked" };
    const value: unknown = JSON.parse(raw);
    return commandValid(value, actor) ? { kind: "pending", command: value } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}

/** The command as it will be saved and sent - a snapshot, so later edits of the form cannot change a retry. Null when it is not one. */
export function prepareDatesKeptCommand(actor: string, action: DatesKeptAction, body: Record<string, unknown>, now: number): DatesKeptCommand | null {
  try {
    const value: unknown = JSON.parse(JSON.stringify({ version: 1, actor, issued_at: now, action, body }));
    return commandValid(value, actor) ? value : null;
  } catch { return null; }
}

/** Remove only this exact command; never a replacement and never an unreadable record. */
function clear(storage: DatesExternalStorage, command: DatesKeptCommand): boolean {
  const current = readDatesKeptCommand(storage, command.actor);
  if (current.kind !== "pending" || !same(current.command, command)) return false;
  try {
    storage.removeItem(storageKey(command.actor));
    return storage.getItem(storageKey(command.actor)) === null;
  } catch { return false; }
}

/** Whether Core's reply is the receipt of exactly this command. */
export function datesKeptReceipt(command: DatesKeptCommand, response: unknown): boolean {
  const body = command.body;
  return command.action === "dates_moderation_legal_hold" ? datesLegalHoldReceipt(response, String(body.case_id), body.action, body.review_at)
    : datesTrailEvidenceReceipt(response, String(body.case_id), body.captured_from, body.captured_to);
}

/**
 * Saves the command (unless it is the one already saved), sends it, and
 * removes it only on its receipt or on a pinned no-land refusal. `now` is in
 * seconds.
 */
export async function runDatesKeptCommand(command: DatesKeptCommand, storage: DatesExternalStorage | null, now: number,
  send: (action: string, body: Record<string, unknown>) => Promise<unknown>): Promise<DatesKeptOutcome> {
  if (!storage || !commandValid(command, command?.actor) || !positive(now) || command.issued_at > now + 300) return { kind: "blocked" };
  if (now - command.issued_at >= DATES_EXTERNAL_RETRY_SECONDS) return { kind: "expired" };
  const previous = readDatesKeptCommand(storage, command.actor);
  if (previous.kind === "blocked" || (previous.kind === "pending" && !same(previous.command, command))) return { kind: "blocked" };
  try {
    if (previous.kind === "empty") storage.setItem(storageKey(command.actor), JSON.stringify(command));
    const saved = readDatesKeptCommand(storage, command.actor);
    if (saved.kind !== "pending" || !same(saved.command, command)) return { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
  let response: unknown = null;
  try { response = await send(command.action, command.body); } catch { return { kind: "uncertain", error: null }; }
  const outcome = datesCommandOutcome(response, datesKeptReceipt(command, response), "kept");
  if (outcome.kind === "uncertain") return outcome;
  const retained = !clear(storage, command);
  return outcome.kind === "success" ? { kind: "success", retained } : { kind: "refused", error: outcome.error, retained };
}

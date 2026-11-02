import { createAdminIdempotencyKey } from "@/lib/datesAdmin";
import {
  DATES_EXTERNAL_CORRECTION_FIELDS, datesCommandOutcome, datesExternalRecheckInstructions, decodeDatesExternalCorrectionDecision,
  decodeDatesExternalRecheckReceipt, decodeDatesExternalReviewReceipt, type DatesCommandOutcome, type DatesExternalCorrection,
  type DatesExternalCorrectionField, type DatesExternalRecheckReceipt, type DatesExternalReviewCommand, type DatesExternalRow,
} from "@/lib/datesExternalAdmin";
import {
  datesExternalDraft, datesExternalTimeFromInput, DATES_EXTERNAL_FRESH_CONFIRMATIONS,
  type DatesExternalDraft, type DatesExternalEditorInput,
} from "@/lib/datesExternalInput";

/**
 * D-149 (T-908): the console side of the review workflow of published external events - the "reviewed, OK" mark, an
 * AI re-research of one event, and the members' corrections. Wire guards live in lib/datesExternalAdmin.ts.
 */
type Send = (action: string, body: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------- reviewed mark

export type DatesExternalReviewTarget = Pick<DatesExternalRow, "external_event_id" | "activity_id" | "revision" | "status">;

/**
 * Marks an event "reviewed, OK", or clears the mark. The command is fenced by the ledger revision (`expected_revision`)
 * and its effect is a flag, so it is sent outside the durable journal under a new key each time (the `fresh` identity
 * of `datesCommandOutcome`): a repeat after an unanswered attempt is refused as stale or sets the same flag again.
 */
export function datesExternalReviewRequest(target: DatesExternalReviewTarget, action: DatesExternalReviewCommand, reason = ""): Record<string, unknown> {
  const trimmed = reason.trim();
  return { external_event_id: target.external_event_id, expected_revision: target.revision, action,
    ...(trimmed ? { reason: trimmed } : {}), idempotency_key: createAdminIdempotencyKey("dates-external-review") };
}
export async function runDatesExternalReview(send: Send, target: DatesExternalReviewTarget, request: Record<string, unknown>): Promise<DatesCommandOutcome> {
  let response: unknown;
  try { response = await send("dates_external_event_command", request); } catch { return { kind: "uncertain", error: null }; }
  return datesCommandOutcome(response, decodeDatesExternalReviewReceipt(response, request, target), "fresh");
}

// ---------------------------------------------------------------- re-research (one event)

/**
 * A re-research starts a paid AI job, and a finished job does not stop another from being started, so a repeat under a
 * new key could run twice. Its identity is therefore KEPT: the exact request is saved per operator and event before it
 * is sent, an unanswered attempt is retried with the same key (Core answers a replay with the same job), and the saved
 * request is cleared only by a receipt or a refusal that wrote nothing.
 */
export type DatesExternalRecheckPending = { version: 1; actor: string; issued_at: number; body: { external_event_id: string; instructions?: string; idempotency_key: string } };
export type DatesExternalRecheckStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const recheckKey = (actor: string, externalId: string) => `friending:dates-external:recheck:v1:${encodeURIComponent(actor)}:${externalId}`;

export function decodeDatesExternalRecheckPending(value: unknown, actor: string, externalId: string): DatesExternalRecheckPending | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, body = row.body as Record<string, unknown> | null;
  if (Object.keys(row).sort().join() !== "actor,body,issued_at,version" || row.version !== 1 || row.actor !== actor
    || !Number.isSafeInteger(row.issued_at) || Number(row.issued_at) <= 0 || !body || typeof body !== "object" || Array.isArray(body)
    || body.external_event_id !== externalId || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(body.idempotency_key)
    || Object.keys(body).some((key) => !["external_event_id", "instructions", "idempotency_key"].includes(key))
    || (Object.hasOwn(body, "instructions") && !datesExternalRecheckInstructions(body.instructions))) return null;
  return row as DatesExternalRecheckPending;
}
export type DatesExternalRecheckPendingRead = { kind: "empty" } | { kind: "pending"; pending: DatesExternalRecheckPending } | { kind: "blocked" };
export function readDatesExternalRecheckPending(storage: DatesExternalRecheckStorage | null, actor: string, externalId: string): DatesExternalRecheckPendingRead {
  if (!storage) return { kind: "blocked" };
  try {
    const raw = storage.getItem(recheckKey(actor, externalId));
    if (raw === null) return { kind: "empty" };
    const pending = raw.length <= 20000 ? decodeDatesExternalRecheckPending(JSON.parse(raw), actor, externalId) : null;
    return pending ? { kind: "pending", pending } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}
export function prepareDatesExternalRecheck(actor: string, externalId: string, instructions: string, issuedAt: number): DatesExternalRecheckPending | null {
  const text = instructions.trim() === "" ? undefined : instructions;
  if (text !== undefined && !datesExternalRecheckInstructions(text)) return null;
  const pending = { version: 1 as const, actor, issued_at: issuedAt,
    body: { external_event_id: externalId, ...(text === undefined ? {} : { instructions: text }), idempotency_key: createAdminIdempotencyKey("dates-external-recheck") } };
  return decodeDatesExternalRecheckPending(JSON.parse(JSON.stringify(pending)), actor, externalId);
}
export type DatesExternalRecheckOutcome =
  | { kind: "success"; receipt: DatesExternalRecheckReceipt; retained: boolean }
  | { kind: "refused"; error: string; retained: boolean }
  | { kind: "uncertain"; error: string | null }
  | { kind: "blocked" };
function clearRecheck(storage: DatesExternalRecheckStorage, pending: DatesExternalRecheckPending): boolean {
  const current = readDatesExternalRecheckPending(storage, pending.actor, pending.body.external_event_id);
  if (current.kind !== "pending" || JSON.stringify(current.pending) !== JSON.stringify(pending)) return false;
  try { storage.removeItem(recheckKey(pending.actor, pending.body.external_event_id)); return storage.getItem(recheckKey(pending.actor, pending.body.external_event_id)) === null; }
  catch { return false; }
}
/** Saves (or re-reads) the exact request, sends it, and clears it only on a receipt or a no-write refusal. */
export async function runDatesExternalRecheck(send: Send, storage: DatesExternalRecheckStorage | null, pending: DatesExternalRecheckPending): Promise<DatesExternalRecheckOutcome> {
  if (!storage) return { kind: "blocked" };
  const previous = readDatesExternalRecheckPending(storage, pending.actor, pending.body.external_event_id);
  if (previous.kind === "blocked" || (previous.kind === "pending" && JSON.stringify(previous.pending) !== JSON.stringify(pending))) return { kind: "blocked" };
  try {
    if (previous.kind === "empty") storage.setItem(recheckKey(pending.actor, pending.body.external_event_id), JSON.stringify(pending));
    const saved = readDatesExternalRecheckPending(storage, pending.actor, pending.body.external_event_id);
    if (saved.kind !== "pending" || JSON.stringify(saved.pending) !== JSON.stringify(pending)) return { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
  let response: unknown;
  try { response = await send("dates_external_event_recheck", pending.body); } catch { return { kind: "uncertain", error: null }; }
  const receipt = decodeDatesExternalRecheckReceipt(response, pending.body);
  const outcome = datesCommandOutcome(response, receipt !== null, "kept");
  if (outcome.kind === "success") return { kind: "success", receipt: receipt!, retained: !clearRecheck(storage, pending) };
  if (outcome.kind === "refused") return { kind: "refused", error: outcome.error, retained: !clearRecheck(storage, pending) };
  return outcome;
}

// ---------------------------------------------------------------- correction decision

/**
 * A rejection is fenced by the correction's state (a decided correction cannot be decided again), so it is sent under a
 * new key each time: a repeat after an unanswered attempt is refused, it cannot reject twice.
 */
export function datesExternalCorrectionRejectRequest(correctionId: string, reasonCode: string, note: string): Record<string, unknown> {
  const trimmed = note.trim();
  return { correction_id: correctionId, decision: "reject", reason_code: reasonCode, ...(trimmed ? { note: trimmed } : {}),
    idempotency_key: createAdminIdempotencyKey("dates-external-correction") };
}
export async function runDatesExternalCorrectionReject(send: Send, request: Record<string, unknown>): Promise<DatesCommandOutcome> {
  let response: unknown;
  try { response = await send("dates_external_correction_decide", request); } catch { return { kind: "uncertain", error: null }; }
  return datesCommandOutcome(response, decodeDatesExternalCorrectionDecision(response, request) !== null, "fresh");
}

// ---------------------------------------------------------------- refusals in words

/** The refusal tokens of the review workflow that have their own sentence (`datesAdmin.external.review.refusals.*`). */
export const DATES_EXTERNAL_REVIEW_REFUSALS: Readonly<Record<string, string>> = {
  "dates-recheck-open": "recheckOpen", "dates-recheck-unavailable": "recheckUnavailable", "dates-research-budget-paused": "budgetPaused",
  "dates-recheck-instructions-invalid": "instructionsInvalid", "dates-correction-unavailable": "correctionUnavailable",
  "dates-correction-state-invalid": "correctionDecided", "dates-correction-reason-invalid": "reasonInvalid",
  "dates-correction-id-invalid": "correctionUnavailable", "dates-external-unavailable": "eventUnavailable",
  "dates-admin-stale-revision": "stale", "dates-external-conflict": "stale", "dates-external-command-state-invalid": "stateInvalid",
  "dates-admin-capability-required": "capability", "admin-write-required": "capability",
};
export function datesExternalReviewRefusalKey(error: string | null): string {
  return error !== null && Object.hasOwn(DATES_EXTERNAL_REVIEW_REFUSALS, error) ? DATES_EXTERNAL_REVIEW_REFUSALS[error] : "other";
}

// ---------------------------------------------------------------- "approve and edit": the editor prefilled with a correction

/**
 * The UTC offset of a venue-local wall time, when exactly one exists. A wall time inside a DST gap has none and one
 * inside a repeated hour has two: both leave the offset empty, so the operator chooses it (the editor's own rule).
 */
export function datesExternalOffsetForLocal(local: string, timezone: string): string {
  const wall = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (!Number.isFinite(wall)) return "";
  const offsets = new Set<string>();
  for (const hours of [-26, -14, -2, 0, 2, 14, 26]) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(new Date(wall + hours * 3600_000));
      const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
      const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
      if (match) offsets.add(match[1] ? `${match[1]}${match[2]}:${match[3]}` : "+00:00");
    } catch { return ""; }
  }
  const seconds = local.length === 16 ? `${local}:00` : local;
  const valid = [...offsets].filter((offset) => datesExternalTimeFromInput(seconds, offset, timezone) !== null);
  return valid.length === 1 ? valid[0] : "";
}

export type DatesExternalCorrectionPrefill = {
  draft: DatesExternalDraft;
  /** The proposed facts that were put into the form. */
  applied: DatesExternalCorrectionField[];
  /** A proposed venue is free text: the operator resolves it to a public place with the place search. */
  venue: string | null;
  /** "canceled" or "postponed": not a fact of the form - the operator decides with the lifecycle commands or the dates. */
  status: string | null;
  /** A proposed fact the form could not take as it is (an unreadable time, a non-https link): shown, not applied. */
  unapplied: DatesExternalCorrectionField[];
};

/** The external event editor prefilled with a correction's proposed values. The four confirmations are always fresh. */
export function datesExternalCorrectionPrefill(input: DatesExternalEditorInput, correction: DatesExternalCorrection): DatesExternalCorrectionPrefill {
  const draft = { ...datesExternalDraft(input), ...DATES_EXTERNAL_FRESH_CONFIRMATIONS };
  const proposed = correction.proposed, applied: DatesExternalCorrectionField[] = [], unapplied: DatesExternalCorrectionField[] = [];
  const has = (key: DatesExternalCorrectionField) => Object.hasOwn(proposed, key);
  if (has("title") && typeof proposed.title === "string") { draft.title = proposed.title; applied.push("title"); }
  for (const [key, local, offset] of [["starts_local", "startLocal", "startOffset"], ["ends_local", "endLocal", "endOffset"]] as const) {
    if (!has(key)) continue;
    const value = proposed[key];
    if (value === null && key === "ends_local") { draft.endLocal = ""; draft.endOffset = ""; applied.push(key); continue; }
    if (typeof value !== "string") { unapplied.push(key); continue; }
    draft[local] = value.length === 16 ? `${value}:00` : value;
    draft[offset] = datesExternalOffsetForLocal(value, input.timezone);
    applied.push(key);
  }
  if (has("official_url")) {
    const url = proposed.official_url ?? null;
    // The editor publishes https links only; an http proposal is shown for the operator to check, not copied in.
    if (url === null || /^https:\/\//i.test(url)) { draft.officialUrl = url ?? ""; applied.push("official_url"); } else unapplied.push("official_url");
  }
  return { draft, applied, unapplied, venue: has("venue") && typeof proposed.venue === "string" ? proposed.venue : null,
    status: has("status") && typeof proposed.status === "string" ? proposed.status : null };
}

/** The proposed facts of a correction, in the member wire's order. */
export function datesExternalCorrectionProposedFields(correction: DatesExternalCorrection): DatesExternalCorrectionField[] {
  return DATES_EXTERNAL_CORRECTION_FIELDS.filter((key) => Object.hasOwn(correction.proposed, key));
}

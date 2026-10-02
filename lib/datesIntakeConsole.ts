import { createAdminIdempotencyKey, datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { datesExternalRefusal } from "@/lib/datesExternalAdmin";
import type { DatesExternalManualEvent } from "@/lib/datesExternalInput";
import {
  prepareDatesExternalPending, readDatesExternalMutationAccess, readDatesExternalPending, runDatesExternalMutation,
  type DatesExternalMutationOutcome, type DatesExternalPending, type DatesExternalStorage,
} from "@/lib/datesExternalMutations";
import {
  DATES_INTAKE_MAX_IMAGE_BYTES, DATES_INTAKE_MAX_IMAGES, DATES_INTAKE_REJECT_REASONS, datesAiUsageMonth, datesIntakeAuditNote,
  datesIntakeCapabilityRefused, datesIntakeId, datesIntakeRefusal, datesIntakeSourceText, datesIntakeSourceUrl, datesIntakeUploadType,
  decodeDatesIntakeCreateReceipt, decodeDatesIntakeLeaseReceipt, decodeDatesIntakeRejectReceipt, projectDatesAiUsage,
  projectDatesIntakeDetail, projectDatesIntakeQueue,
  type DatesAiUsageRead, type DatesIntakeCreateReceipt, type DatesIntakeDetailRead, type DatesIntakeLeaseAction,
  type DatesIntakeLeaseReceipt, type DatesIntakeQueue, type DatesIntakeRejectReceipt, type DatesIntakeSourceKind,
  type DatesIntakeStatus,
} from "@/lib/datesIntakeAdmin";

/**
 * The intake console's calls, kept out of the React components so that the
 * genuine Core bodies can be run through them in tests. `send` is the
 * same-origin bridge (`adminCall`); nothing here talks to Core directly.
 */
export type DatesIntakeSend = (action: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export const DATES_INTAKE_REVIEW = "dates_external_event_review";
export const DATES_INTAKE_MANAGE = "dates_external_event_manage";
export const DATES_INTAKE_READ = "dates_external_event_read";

export type DatesIntakeOperator = {
  principal: DatesAdminPrincipal;
  review: boolean; manage: boolean; read: boolean;
  /** Core lets only this role release a hold another reviewer still has. */
  superadmin: boolean;
};

export function datesIntakeOperator(identity: unknown): DatesIntakeOperator | null {
  const principal = datesAdminPrincipal(identity);
  return principal ? { principal, review: hasDatesCapability(principal, DATES_INTAKE_REVIEW), manage: hasDatesCapability(principal, DATES_INTAKE_MANAGE),
    read: hasDatesCapability(principal, DATES_INTAKE_READ), superadmin: principal.role === "superadmin" } : null;
}

/**
 * A read either arrived, was refused, or could not be established:
 * - `denied`: a CONFIRMED loss of the capability (Core or the bridge said so,
 *   or the operator's fresh identity does not carry it);
 * - `refused`: Core answered with another closed refusal, shown as it is;
 * - `unconfirmed`: nothing readable came back. It is never shown as "no
 *   permission" and never as an empty result.
 */
export type DatesIntakeRead<T> =
  | ({ kind: "ready"; operator: DatesIntakeOperator } & T)
  | { kind: "denied" }
  | { kind: "refused"; error: string; status: number }
  | { kind: "unconfirmed" };

function failedRead(response: unknown, operator: DatesIntakeOperator | null, capability: "review" | "read"): DatesIntakeRead<never> {
  const refusal = datesIntakeRefusal(response);
  if (datesIntakeCapabilityRefused(refusal) || (operator !== null && !operator[capability])) return { kind: "denied" };
  return refusal.kind === "core" ? { kind: "refused", error: refusal.error, status: refusal.status } : { kind: "unconfirmed" };
}

async function pair(send: DatesIntakeSend, action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<[unknown, unknown]> {
  try { return await Promise.all([send(action, body, signal), send("admin_me", {}, signal)]); } catch { return [null, null]; }
}

export type DatesIntakeQueueFilters = { status: string; channel: string; page: number; limit: number };

export async function readDatesIntakeQueue(send: DatesIntakeSend, filters: DatesIntakeQueueFilters, signal?: AbortSignal):
  Promise<DatesIntakeRead<{ queue: DatesIntakeQueue }>> {
  const [response, identity] = await pair(send, "dates_event_intake_list", filters, signal);
  const operator = datesIntakeOperator(identity), queue = projectDatesIntakeQueue(response, filters);
  return queue && operator?.review ? { kind: "ready", operator, queue } : failedRead(response, operator, "review");
}

export async function readDatesIntakeDetail(send: DatesIntakeSend, intakeId: string, signal?: AbortSignal):
  Promise<DatesIntakeRead<{ read: DatesIntakeDetailRead; draftsEnabled: boolean | null }>> {
  if (!datesIntakeId(intakeId)) return { kind: "unconfirmed" };
  let responses: [unknown, unknown, unknown];
  try {
    // The one-row queue read tells whether the draft switch is on; the detail does not carry it.
    responses = await Promise.all([send("dates_event_intake_detail", { intake_id: intakeId }, signal), send("admin_me", {}, signal),
      send("dates_event_intake_list", { page: 1, limit: 1 }, signal)]);
  } catch { return { kind: "unconfirmed" }; }
  const operator = datesIntakeOperator(responses[1]), read = projectDatesIntakeDetail(responses[0], intakeId);
  if (!read || !operator?.review) return failedRead(responses[0], operator, "review");
  // Unknown is not "off": Core refuses with its own token when the switch is off.
  return { kind: "ready", operator, read, draftsEnabled: projectDatesIntakeQueue(responses[2], { page: 1, limit: 1 })?.drafts_enabled ?? null };
}

export async function readDatesAiUsage(send: DatesIntakeSend, monthFilter: string | null, signal?: AbortSignal):
  Promise<DatesIntakeRead<{ usage: DatesAiUsageRead; awaitingBudget: number | null }>> {
  if (monthFilter !== null && !datesAiUsageMonth(monthFilter)) return { kind: "unconfirmed" };
  const [response, identity] = await pair(send, "dates_event_intake_usage", monthFilter === null ? {} : { month: monthFilter }, signal);
  const operator = datesIntakeOperator(identity), usage = projectDatesAiUsage(response, monthFilter);
  if (!usage || !operator?.read) return failedRead(response, operator, "read");
  // How many intakes wait for budget is the review queue's figure; a reader without that capability is told so.
  let awaitingBudget: number | null = null;
  if (operator.review) {
    try { awaitingBudget = projectDatesIntakeQueue(await send("dates_event_intake_list", { page: 1, limit: 1 }, signal), { page: 1, limit: 1 })
      ?.status_counts.awaiting_budget ?? null; } catch { awaitingBudget = null; }
  }
  return { kind: "ready", operator, usage, awaitingBudget };
}

/** Whether the "Draft from source" entry is offered, and why not when it is not. */
export type DatesIntakeDraftEntry = { state: "available" } | { state: "disabled" } | { state: "noCapability" } | { state: "unknown" };
export async function readDatesIntakeDraftEntry(send: DatesIntakeSend, signal?: AbortSignal): Promise<DatesIntakeDraftEntry> {
  // The usage read is the one every Dates role may make that carries the switch.
  const [response, identity] = await pair(send, "dates_event_intake_usage", {}, signal);
  const operator = datesIntakeOperator(identity), usage = projectDatesAiUsage(response, null);
  if (!operator || !usage) return operator && !operator.manage ? { state: "noCapability" } : { state: "unknown" };
  if (!operator.manage) return { state: "noCapability" };
  return { state: usage.drafts_enabled ? "available" : "disabled" };
}

// ---------------------------------------------------------------- commands

export type DatesIntakeCommandOutcome<T> =
  | { kind: "success"; receipt: T }
  /** Core's own pinned no-land refusal: this command wrote nothing, and its identity is spent. */
  | { kind: "refused"; error: string; status: number }
  /**
   * Everything else. The command may or may not have landed: no answer, an
   * unreadable one, the bridge's transport failure (`core-timeout`,
   * `core-unavailable`, `invalid-core-response`), any refusal of the bridge
   * itself, a 5xx, `dates-admin-command-in-progress`, or a token outside the
   * closed list. `error` is what was answered, when something readable was.
   * A command with an identity keeps it; the same request is the only retry.
   */
  | { kind: "uncertain"; error: string | null };

/**
 * One classification for every intake command, and it is the publication
 * journal's own (`datesExternalRefusal`): only a receipt bound to the request,
 * or one of Core's pinned no-land refusals in Core's own envelope, is an answer.
 */
function commandOutcome<T>(response: unknown, receipt: T | null): DatesIntakeCommandOutcome<T> {
  if (receipt) return { kind: "success", receipt };
  const refusal = datesExternalRefusal(response);
  return refusal.kind === "refused" ? { kind: "refused", error: refusal.error, status: refusal.status }
    : { kind: "uncertain", error: refusal.status === 0 ? null : refusal.error };
}

export async function runDatesIntakeLease(send: DatesIntakeSend, request: { intake_id: string; expected_revision: number; action: DatesIntakeLeaseAction }):
  Promise<DatesIntakeCommandOutcome<DatesIntakeLeaseReceipt>> {
  let response: unknown;
  try { response = await send("dates_event_intake_lease", { ...request }); } catch { return { kind: "uncertain", error: null }; }
  return commandOutcome(response, decodeDatesIntakeLeaseReceipt(response, request));
}

export type DatesIntakeRejectCommand = { intake_id: string; expected_revision: number; reason_code: typeof DATES_INTAKE_REJECT_REASONS[number];
  reason: string; idempotency_key: string };

/** One rejection, with the identity it keeps across a retry. Null when the console itself would not send it. */
export function prepareDatesIntakeReject(target: { intake_id: string; revision: number | null }, reasonCode: string, note: string): DatesIntakeRejectCommand | null {
  if (!datesIntakeId(target.intake_id) || target.revision === null || !Number.isSafeInteger(target.revision) || target.revision < 1
    || !(DATES_INTAKE_REJECT_REASONS as readonly string[]).includes(reasonCode) || !datesIntakeAuditNote(note)) return null;
  return { intake_id: target.intake_id, expected_revision: target.revision, reason_code: reasonCode as DatesIntakeRejectCommand["reason_code"],
    reason: note.trim(), idempotency_key: createAdminIdempotencyKey("dates-intake-reject") };
}

export async function runDatesIntakeReject(send: DatesIntakeSend, command: DatesIntakeRejectCommand):
  Promise<DatesIntakeCommandOutcome<DatesIntakeRejectReceipt>> {
  let response: unknown;
  try { response = await send("dates_event_intake_reject", { ...command }); } catch { return { kind: "uncertain", error: null }; }
  return commandOutcome(response, decodeDatesIntakeRejectReceipt(response, command));
}

// ---------------------------------------------------------------- publish through the P1 publisher

export type DatesIntakePublishCandidate = { intake_id: string; intake_revision: number; event_index: number; complete: boolean;
  event: DatesExternalManualEvent; reason: string };
export type DatesIntakePublishOutcome = DatesExternalMutationOutcome
  /** Fresh identity, capability or Core time could not be confirmed: nothing was sent. */
  | { kind: "access" }
  /** The console would not send this command (shape, bounds, a caller-supplied key). */
  | { kind: "invalid" };

/**
 * Publishes one event of an intake through the P1 publisher's journal: fresh
 * access first, the exact command persisted before it leaves, the same
 * identity on a retry, and only a pinned Core refusal releases it.
 */
export async function runDatesIntakePublish(send: DatesIntakeSend, storage: DatesExternalStorage | null, actor: string,
  input: { candidate: DatesIntakePublishCandidate } | { retry: DatesExternalPending }): Promise<DatesIntakePublishOutcome> {
  const retry = "retry" in input ? input.retry : null;
  if (retry && (retry.action !== "dates_event_intake_publish" || retry.actor !== actor)) return { kind: "invalid" };
  const access = await readDatesExternalMutationAccess((action, body) => send(action, body));
  if (!access || access.actor !== actor) return { kind: "access" };
  const operation = retry ?? prepareDatesExternalPending(access.actor, "dates_event_intake_publish",
    { ...("candidate" in input ? input.candidate : {}) }, null, access.serverNow);
  if (!operation) return { kind: "invalid" };
  return runDatesExternalMutation(operation, storage, access.serverNow, (action, body) => send(action, body));
}

/** The saved publish command of this intake, if the operator has one outstanding. */
export function datesIntakePendingPublish(storage: DatesExternalStorage | null, actor: string, intakeId: string): DatesExternalPending | null {
  const saved = readDatesExternalPending(storage, actor);
  return saved.kind === "pending" && saved.pending.action === "dates_event_intake_publish" && saved.pending.body.intake_id === intakeId
    ? saved.pending : null;
}

// ---------------------------------------------------------------- "Draft from source"

export type DatesIntakeSourceDraft = { kind: DatesIntakeSourceKind; url: string; text: string };
export type DatesIntakeSourceFile = { name: string; size: number; header: Uint8Array };
export type DatesIntakeSourceProblem = "url" | "text" | "imageCount" | "imageSize" | "imageType";

/** What the console checks before anything is sent; Core checks again and its refusal is shown. */
export function datesIntakeSourceProblem(draft: DatesIntakeSourceDraft, files: readonly DatesIntakeSourceFile[]): DatesIntakeSourceProblem | null {
  if (draft.kind === "url") return datesIntakeSourceUrl(draft.url) === null ? "url" : null;
  if (draft.kind === "text") return datesIntakeSourceText(draft.text) === null ? "text" : null;
  if (files.length < 1 || files.length > DATES_INTAKE_MAX_IMAGES) return "imageCount";
  if (files.some((file) => file.size < 1 || file.size > DATES_INTAKE_MAX_IMAGE_BYTES)) return "imageSize";
  if (files.some((file) => datesIntakeUploadType(file.header) === null)) return "imageType";
  return draft.text.trim() !== "" && datesIntakeSourceText(draft.text) === null ? "text" : null;
}

export type DatesIntakePost = (form: FormData) => Promise<unknown>;

/**
 * Hands the source to the console's server route. `key` is minted once per
 * source and reused on a retry, so a lost answer cannot create a second intake.
 */
export async function submitDatesIntakeSource(post: DatesIntakePost, draft: DatesIntakeSourceDraft, files: readonly Blob[], locale: "en" | "hu", key: string):
  Promise<DatesIntakeCommandOutcome<DatesIntakeCreateReceipt>> {
  const form = new FormData();
  form.set("kind", draft.kind);
  form.set("locale", locale);
  form.set("idempotency_key", key);
  if (draft.kind === "url") form.set("url", draft.url.trim());
  else if (draft.text.trim() !== "") form.set("text", draft.text);
  if (draft.kind === "images") files.forEach((file, index) => form.set(`image_${index + 1}`, file, `flyer-${index + 1}`));
  let response: unknown;
  try { response = await post(form); } catch { return { kind: "uncertain", error: null }; }
  return commandOutcome(response, decodeDatesIntakeCreateReceipt(response));
}

export function createDatesIntakeSourceKey(): string {
  return createAdminIdempotencyKey("dates-intake-create");
}

/**
 * Refusals Core's create route raises BEFORE it looks the request's identity
 * up, from something that can differ between two attempts of one request: the
 * default-off switch, and a flyer that did not arrive whole. For the first
 * attempt of an identity they prove that nothing was written. After an attempt
 * whose outcome is unknown they say nothing about that earlier attempt.
 */
const CREATE_REFUSED_BEFORE_REPLAY: readonly string[] = ["dates-intake-admin-drafts-disabled", "dates-intake-image-invalid"];

/**
 * The identity of one source across its attempts. The key is minted for the
 * first attempt and retired by exactly three things: Core's receipt, Core's
 * definitive no-write refusal, or the operator's explicit decision to give
 * the request up. A lost, unreadable, in-progress or transport answer keeps
 * it, and keeps the source locked, so that the retry is the same request.
 */
export type DatesIntakeSourceAttempts = {
  /** An earlier attempt has no known outcome: the source may not change until it is settled or given up. */
  readonly unanswered: boolean;
  send(post: DatesIntakePost, draft: DatesIntakeSourceDraft, files: readonly Blob[], locale: "en" | "hu"): Promise<DatesIntakeCommandOutcome<DatesIntakeCreateReceipt>>;
  /** The operator edited the source: a new request, a new identity. Refused (false) while an attempt is unanswered. */
  changed(): boolean;
  /** The operator gives the unanswered request up; the next one is a new command. */
  discard(): void;
};

export function createDatesIntakeSourceAttempts(mint: () => string = createDatesIntakeSourceKey): DatesIntakeSourceAttempts {
  let key = "", unanswered = false;
  return {
    get unanswered() { return unanswered; },
    async send(post, draft, files, locale) {
      if (key === "") key = mint();
      let outcome = await submitDatesIntakeSource(post, draft, files, locale, key);
      if (outcome.kind === "refused" && unanswered && CREATE_REFUSED_BEFORE_REPLAY.includes(outcome.error))
        outcome = { kind: "uncertain", error: outcome.error };
      if (outcome.kind === "uncertain") unanswered = true;
      else { key = ""; unanswered = false; }
      return outcome;
    },
    changed() {
      if (unanswered) return false;
      key = "";
      return true;
    },
    discard() { key = ""; unanswered = false; },
  };
}

// ---------------------------------------------------------------- pacing

/**
 * How long to wait before asking Core again while the worker still owns the
 * intake; null when the page should stop asking by itself. An intake waiting
 * for budget is retried by the worker once an hour, so it is not polled.
 */
export function datesIntakePollDelay(status: DatesIntakeStatus, elapsedMs: number): number | null {
  if (!["received", "screening", "extracting", "validating"].includes(status)) return null;
  if (elapsedMs < 60_000) return 3_000;
  return elapsedMs < 600_000 ? 10_000 : null;
}

/** Runs tasks one after another, so a lease renewal and a command never race for the same revision. */
export function createDatesIntakeSerial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}

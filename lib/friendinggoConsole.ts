import {
  FRIENDINGGO_AUDIENCES,
  FRIENDINGGO_BODY_MAX,
  FRIENDINGGO_CAPS,
  FRIENDINGGO_KINDS,
  FRIENDINGGO_PREHEADER_MAX,
  FRIENDINGGO_STATUSES,
  FRIENDINGGO_SUBJECT_MAX,
  friendingGoBody,
  friendingGoError,
  friendingGoOutcomeUnknown,
  friendingGoPreheader,
  friendingGoRetryAfter,
  friendingGoSendBody,
  friendingGoSendResult,
  friendingGoStatusBody,
  friendingGoSubject,
  isFriendingGoObjectId,
  type FriendingGoAudience,
  type FriendingGoEmailContent,
  type FriendingGoError,
  type FriendingGoKind,
  type FriendingGoProgress,
  type FriendingGoSendBody,
  type FriendingGoSendResult,
  type FriendingGoStatus,
  type FriendingGoStatusBody,
} from "@/lib/friendinggo";

/**
 * The FriendingGO console's browser-side state (D-153, T-937): what one tab hands the next, what an
 * operator has typed and not sent, and the write whose outcome is not known yet. All of it lives in
 * `sessionStorage` (this tab only) and is decoded exactly on the way back, so a stored value can never
 * acquire new meaning. Pure: the components pass the storage in.
 */

export const FRIENDINGGO_STORAGE_KEYS = {
  /** The people "Email selected" hands from the Preorders tab to the Email tab. */
  audience: "friending.friendinggo.audience.v1",
  /** What the operator is writing, so switching tabs never loses it. */
  composer: "friending.friendinggo.composer.v1",
  /** A test, draft or send whose outcome is unknown: retried with the same request id. */
  pendingEmail: "friending.friendinggo.pending-email.v1",
  /** A status change whose outcome is unknown: retried with the same request id. */
  pendingStatus: "friending.friendinggo.pending-status.v1",
} as const;

export type FriendingGoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A stored value, decoded; `null` when absent or unreadable (and then removed); `undefined` when storage is unavailable. */
export function friendingGoStored<T>(storage: FriendingGoStorage | null, key: string, decode: (value: unknown) => T | null): T | null | undefined {
  if (!storage) return undefined;
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return undefined; }
  if (raw === null) return null;
  let decoded: T | null = null;
  try { decoded = decode(JSON.parse(raw)); } catch { decoded = null; }
  if (decoded === null) friendingGoStore(storage, key, null);
  return decoded;
}

/** Store (or, with `null`, remove) a value; `false` when the browser refused. */
export function friendingGoStore(storage: FriendingGoStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// ------------------------------------------------------------------ audience

/**
 * One chosen person. The name and status are what the list showed when they were chosen (a draft
 * reopened from Core names only ids, so both may be unknown); Core's preview is the authority.
 */
export type FriendingGoSelected = { id: string; name: string; status: FriendingGoStatus | null };

export function friendingGoSelection(value: unknown): FriendingGoSelected[] | null {
  if (!Array.isArray(value) || value.length > FRIENDINGGO_CAPS.newsletter) return null;
  const seen = new Set<string>();
  const people: FriendingGoSelected[] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || !exactKeys(entry, ["id", "name", "status"]) || !isFriendingGoObjectId(entry.id) || seen.has(entry.id)) return null;
    if (typeof entry.name !== "string" || entry.name.length > 200) return null;
    if (!(entry.status === null || (FRIENDINGGO_STATUSES as readonly unknown[]).includes(entry.status))) return null;
    seen.add(entry.id);
    people.push({ id: entry.id, name: entry.name, status: entry.status as FriendingGoStatus | null });
  }
  return people;
}

/** Ids as the wire carries them: unique, sorted. */
export function friendingGoSelectionIds(selection: readonly FriendingGoSelected[]): string[] {
  return [...new Set(selection.map((person) => person.id))].sort();
}

// ------------------------------------------------------------------ composer

export type FriendingGoComposer = {
  kind: FriendingGoKind;
  audience: FriendingGoAudience;
  subject: string;
  preheader: string;
  body: string;
  /** The draft this content was opened from or saved as; "" for a new email. */
  campaignId: string;
};

export const EMPTY_FRIENDINGGO_COMPOSER: FriendingGoComposer = {
  kind: "newsletter",
  audience: "all_active",
  subject: "",
  preheader: "",
  body: "",
  campaignId: "",
};

/** Raw typing is kept a little past the caps, so an over-long field can still be shown and shortened. */
const RAW_SLACK = 1_000;

export function friendingGoComposer(value: unknown): FriendingGoComposer | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["kind", "audience", "subject", "preheader", "body", "campaignId"])) return null;
  if (!(FRIENDINGGO_KINDS as readonly unknown[]).includes(entry.kind) || !(FRIENDINGGO_AUDIENCES as readonly unknown[]).includes(entry.audience)) return null;
  if (typeof entry.subject !== "string" || entry.subject.length > FRIENDINGGO_SUBJECT_MAX + RAW_SLACK) return null;
  if (typeof entry.preheader !== "string" || entry.preheader.length > FRIENDINGGO_PREHEADER_MAX + RAW_SLACK) return null;
  if (typeof entry.body !== "string" || entry.body.length > FRIENDINGGO_BODY_MAX * 2 + RAW_SLACK) return null;
  if (entry.campaignId !== "" && !isFriendingGoObjectId(entry.campaignId)) return null;
  return {
    kind: entry.kind as FriendingGoKind,
    audience: entry.audience as FriendingGoAudience,
    subject: entry.subject,
    preheader: entry.preheader,
    body: entry.body,
    campaignId: entry.campaignId as string,
  };
}

export type FriendingGoComposerProblem =
  | "subject"
  | "preheader"
  | "body"
  | "audienceEmpty"
  | "directAudience"
  | "directTooMany"
  | "tooMany";

export type FriendingGoComposerResult =
  | { ok: true; value: FriendingGoEmailContent }
  | { ok: false; problems: FriendingGoComposerProblem[] };

/** What the composer would send: the canonical content, or every reason it cannot be sent yet. */
export function friendingGoComposerContent(
  composer: FriendingGoComposer,
  selection: readonly FriendingGoSelected[],
): FriendingGoComposerResult {
  const problems: FriendingGoComposerProblem[] = [];
  const subject = friendingGoSubject(composer.subject);
  const preheader = friendingGoPreheader(composer.preheader);
  const body = friendingGoBody(composer.body);
  if (subject === null) problems.push("subject");
  if (preheader === null) problems.push("preheader");
  if (body === null) problems.push("body");
  const ids = composer.audience === "selected" ? friendingGoSelectionIds(selection) : [];
  if (composer.kind === "direct" && composer.audience !== "selected") problems.push("directAudience");
  if (composer.audience === "selected") {
    if (ids.length === 0) problems.push("audienceEmpty");
    else if (composer.kind === "direct" && ids.length > FRIENDINGGO_CAPS.direct) problems.push("directTooMany");
    else if (ids.length > FRIENDINGGO_CAPS.newsletter) problems.push("tooMany");
  }
  if (problems.length > 0 || subject === null || preheader === null || body === null) return { ok: false, problems };
  return { ok: true, value: { kind: composer.kind, subject, preheader, body_html: body, audience: composer.audience, preorder_ids: ids } };
}

/** The wording alone is enough for a test send, which goes to the operator's own address. */
export function friendingGoComposerWording(composer: FriendingGoComposer):
  { ok: true; value: Pick<FriendingGoEmailContent, "kind" | "subject" | "preheader" | "body_html"> } | { ok: false; problems: FriendingGoComposerProblem[] } {
  const subject = friendingGoSubject(composer.subject);
  const preheader = friendingGoPreheader(composer.preheader);
  const body = friendingGoBody(composer.body);
  const problems: FriendingGoComposerProblem[] = [
    ...(subject === null ? ["subject" as const] : []),
    ...(preheader === null ? ["preheader" as const] : []),
    ...(body === null ? ["body" as const] : []),
  ];
  return subject !== null && preheader !== null && body !== null
    ? { ok: true, value: { kind: composer.kind, subject, preheader, body_html: body } }
    : { ok: false, problems };
}

/** The identity of a previewed content: a send is confirmed only against the preview of exactly this. */
export function friendingGoContentKey(content: FriendingGoEmailContent): string {
  return JSON.stringify([content.kind, content.subject, content.preheader, content.body_html, content.audience, content.preorder_ids.join(",")]);
}

/** Text with the merge tag inserted at the caret (or replacing the selected text). */
export function friendingGoInsert(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: `${text.slice(0, from)}${insert}${text.slice(to)}`, caret: from + insert.length };
}

// ------------------------------------------------------------------ pending writes

/**
 * A stored email command. `running`: the console was carrying a sliced send (or a resume) on when the page
 * went away (a tab switch, a reload); the next console that mounts in this tab continues it with the same
 * request id. Otherwise the outcome is unknown and the operator decides (Retry or Forget it).
 */
export type FriendingGoPendingEmail = { version: 1; command: FriendingGoSendBody; running: boolean };
export type FriendingGoPendingStatus = { version: 1; command: FriendingGoStatusBody; name: string };

function sameCommand(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(Object.keys(left).sort().map((key) => [key, left[key]]))
    === JSON.stringify(Object.keys(right).sort().map((key) => [key, right[key]]));
}

/** A stored pending email command, exactly as the bridge would accept it, or null. */
export function friendingGoPendingEmail(value: unknown): FriendingGoPendingEmail | null {
  const entry = record(value);
  const raw = record(entry?.command);
  if (!entry || !raw || !exactKeys(entry, ["version", "command", "running"]) || entry.version !== 1 || typeof entry.running !== "boolean") return null;
  const command = friendingGoSendBody(raw);
  // Only a send or a resume is ever carried on by itself.
  if (!command || !sameCommand(command, raw) || (entry.running && command.mode !== "send" && command.mode !== "resume")) return null;
  return { version: 1, command, running: entry.running };
}

export function friendingGoPendingStatus(value: unknown): FriendingGoPendingStatus | null {
  const entry = record(value);
  const raw = record(entry?.command);
  if (!entry || !raw || !exactKeys(entry, ["version", "command", "name"]) || entry.version !== 1) return null;
  if (typeof entry.name !== "string" || entry.name.length > 200) return null;
  const command = friendingGoStatusBody(raw);
  return command ? { version: 1, command, name: entry.name } : null;
}

// ------------------------------------------------------------------ a sliced send (Core rounds 2 and 3)

/**
 * How far the console carries one email command on its own before it hands the decision back to the
 * operator (the manual "Retry the same request"):
 * - `slices`: Core writes at least one batch of 50 per call, so 5,000 people need at most 100 `sending` answers;
 * - `stalls`: three `sending` answers without progress mean something is wrong;
 * - `waitBudgetSeconds`: the time spent waiting on `go-request-in-progress` (Core asks for about 8 s while
 *   an earlier call may still run, and takes a died send over after 120 s without progress) and after a
 *   timeout in the middle of a send; 180 s covers a takeover with room to spare (review P3-8);
 * - `timeoutWaitSeconds`: the pause before a timed-out slice is asked again with the same request id (P3-3).
 */
export const FRIENDINGGO_SEND_LIMITS = { slices: 120, stalls: 3, waitBudgetSeconds: 180, timeoutWaitSeconds: 2, continueDelayMs: 300 } as const;

export type FriendingGoSendLoop = { slices: number; stalls: number; waited: number; processed: number };
export const FRIENDINGGO_SEND_LOOP_START: FriendingGoSendLoop = { slices: 0, stalls: 0, waited: 0, processed: -1 };

export type FriendingGoSendStep =
  /** A test, a draft, or a send / resume Core answered `sent`: the command is settled. */
  | { kind: "done"; result: FriendingGoSendResult }
  /** Core answered `sending`: call again with the SAME command. */
  | { kind: "continue"; progress: FriendingGoProgress; delayMs: number }
  /** The same request is still running, or a slice timed out: wait, then call again with the same command. */
  | { kind: "wait"; seconds: number; reason: "in_progress" | "timeout" }
  /** The limits are reached while Core still answers `sending`: keep the command, the operator retries. */
  | { kind: "paused"; progress: FriendingGoProgress }
  /** The outcome is not known (timeout, 503, a lost answer, or the wait budget used up): keep the command. */
  | { kind: "unknown"; error: FriendingGoError | null }
  /** A named refusal: final for this request id. */
  | { kind: "refused"; error: FriendingGoError | null };

/** One answer to an email command, and what the console does next. Pure. */
export function friendingGoSendStep(
  response: unknown,
  command: FriendingGoSendBody,
  loop: FriendingGoSendLoop,
): { step: FriendingGoSendStep; loop: FriendingGoSendLoop } {
  const result = friendingGoSendResult(response, command);
  if (result) {
    if ((result.mode === "send" || result.mode === "resume") && result.campaign.state === "sending") {
      const progress = result.progress;
      const slices = loop.slices + 1;
      const stalls = progress.processed > loop.processed ? 0 : loop.stalls + 1;
      const next = { ...loop, slices, stalls, processed: Math.max(loop.processed, progress.processed) };
      return slices >= FRIENDINGGO_SEND_LIMITS.slices || stalls >= FRIENDINGGO_SEND_LIMITS.stalls
        ? { step: { kind: "paused", progress }, loop: next }
        : { step: { kind: "continue", progress, delayMs: FRIENDINGGO_SEND_LIMITS.continueDelayMs }, loop: next };
    }
    return { step: { kind: "done", result }, loop };
  }
  const left = FRIENDINGGO_SEND_LIMITS.waitBudgetSeconds - loop.waited;
  const retryAfter = friendingGoRetryAfter(response);
  if (retryAfter !== null && left > 0) {
    const seconds = Math.min(retryAfter, left);
    return { step: { kind: "wait", seconds, reason: "in_progress" }, loop: { ...loop, waited: loop.waited + seconds } };
  }
  const error = response === null ? null : friendingGoError(response);
  // A slice that timed out in the middle of a send is asked again (Core's overlap answer covers a call still running).
  if (error === "core-timeout" && loop.slices > 0 && left > 0) {
    const seconds = Math.min(FRIENDINGGO_SEND_LIMITS.timeoutWaitSeconds, left);
    return { step: { kind: "wait", seconds, reason: "timeout" }, loop: { ...loop, waited: loop.waited + seconds } };
  }
  return friendingGoOutcomeUnknown(response)
    ? { step: { kind: "unknown", error }, loop }
    : { step: { kind: "refused", error }, loop };
}

export type FriendingGoRunOutcome =
  | { kind: "done"; result: FriendingGoSendResult }
  | { kind: "paused"; progress: FriendingGoProgress }
  | { kind: "unknown"; error: FriendingGoError | null }
  | { kind: "refused"; error: FriendingGoError | null; response: unknown }
  /** The page went away; the command stays stored as `running`, and the next console continues it. */
  | { kind: "left" };

export type FriendingGoRunProgress = { progress: FriendingGoProgress | null; waitSeconds: number | null; waitReason: "in_progress" | "timeout" | null };

/**
 * Carry one stored email command to an outcome: call, follow `friendingGoSendStep`, keep the storage in
 * step (`running` while a send or resume is being carried on; removed on a final answer; kept, not running,
 * when the operator must decide). The adapters are injected, so the whole loop runs in tests.
 */
export async function runFriendingGoEmailCommand(stored: FriendingGoPendingEmail, adapters: {
  call: (command: FriendingGoSendBody) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
  alive: () => boolean;
  store: (pending: FriendingGoPendingEmail | null) => boolean;
  onProgress: (progress: FriendingGoRunProgress) => void;
}): Promise<FriendingGoRunOutcome> {
  const command = stored.command;
  const carried = command.mode === "send" || command.mode === "resume";
  if (carried) adapters.store({ ...stored, running: true });
  let loop = FRIENDINGGO_SEND_LOOP_START;
  let progress: FriendingGoProgress | null = null;
  for (;;) {
    const response = await adapters.call(command);
    const next = friendingGoSendStep(response, command, loop);
    loop = next.loop;
    const step = next.step;
    if (!adapters.alive()) return { kind: "left" };
    switch (step.kind) {
      case "continue":
        progress = step.progress;
        adapters.onProgress({ progress, waitSeconds: null, waitReason: null });
        await adapters.sleep(step.delayMs);
        if (!adapters.alive()) return { kind: "left" };
        continue;
      case "wait":
        adapters.onProgress({ progress, waitSeconds: step.seconds, waitReason: step.reason });
        await adapters.sleep(step.seconds * 1000);
        if (!adapters.alive()) return { kind: "left" };
        adapters.onProgress({ progress, waitSeconds: null, waitReason: null });
        continue;
      case "done":
        adapters.store(null);
        return { kind: "done", result: step.result };
      case "paused":
        adapters.store({ ...stored, running: false });
        return { kind: "paused", progress: step.progress };
      case "unknown":
        adapters.store({ ...stored, running: false });
        return { kind: "unknown", error: step.error };
      case "refused":
        adapters.store(null);
        return { kind: "refused", error: step.error, response };
    }
  }
}

// ------------------------------------------------------------------ the composer's decisions, pure

export type FriendingGoPreviewed = { key: string; counts: { selected: number; sendable: number }; cap: number } | null;

export type FriendingGoBuild =
  | { ok: true; command: FriendingGoSendBody }
  | { ok: false; reason: "problems" | "stalePreview" | "overCap" | "nothingToSend" };

/**
 * The command a composer action sends, or why it cannot: the wording for a test; the content for a draft;
 * for a send, the content AND a preview of exactly it whose audience is within the cap and has someone
 * to send to (review P3-1). `expected_sendable` is the previewed count.
 */
export function friendingGoBuildCommand(
  mode: "test" | "save_draft" | "send",
  composer: FriendingGoComposer,
  selection: readonly FriendingGoSelected[],
  previewed: FriendingGoPreviewed,
  requestId: string,
): FriendingGoBuild {
  if (mode === "test") {
    const words = friendingGoComposerWording(composer);
    return words.ok ? { ok: true, command: { mode, ...words.value, request_id: requestId } } : { ok: false, reason: "problems" };
  }
  const content = friendingGoComposerContent(composer, selection);
  if (!content.ok) return { ok: false, reason: "problems" };
  if (mode === "save_draft") return { ok: true, command: { mode, ...content.value, campaign_id: composer.campaignId, request_id: requestId } };
  if (!previewed || previewed.key !== friendingGoContentKey(content.value)) return { ok: false, reason: "stalePreview" };
  if (previewed.counts.selected > previewed.cap) return { ok: false, reason: "overCap" };
  if (previewed.counts.sendable < 1) return { ok: false, reason: "nothingToSend" };
  return { ok: true, command: { mode, ...content.value, campaign_id: composer.campaignId, request_id: requestId, expected_sendable: previewed.counts.sendable } };
}

export type FriendingGoHydration =
  | { kind: "continue"; pending: FriendingGoPendingEmail }
  | { kind: "pending"; pending: FriendingGoPendingEmail }
  | { kind: "openDraft"; id: string }
  | { kind: "askDraft"; id: string }
  | { kind: "none" };

/**
 * What the Email tab does when it mounts: a stored command comes first (a running send or resume is
 * continued with the same request id; any other waits for the operator); otherwise a `?draft=` link
 * opens that draft, asking first when the composer holds something that would be lost.
 */
export function friendingGoHydration(pending: FriendingGoPendingEmail | null, draftId: string | null, composer: FriendingGoComposer): FriendingGoHydration {
  if (pending) return pending.running ? { kind: "continue", pending } : { kind: "pending", pending };
  if (!draftId || composer.campaignId === draftId) return { kind: "none" };
  return composer.subject.trim() !== "" || composer.preheader.trim() !== "" || composer.body.trim() !== ""
    ? { kind: "askDraft", id: draftId }
    : { kind: "openDraft", id: draftId };
}

/**
 * The selection after a send: cleared only when it is still the audience that was sent; a selection made
 * meanwhile (another tab of the console) is kept (review P3-7).
 */
export function friendingGoSelectionAfterSend(selection: readonly FriendingGoSelected[], command: FriendingGoSendBody): FriendingGoSelected[] {
  if (command.mode !== "send" || command.audience !== "selected") return [...selection];
  const sent = command.preorder_ids.join(",");
  return friendingGoSelectionIds(selection).join(",") === sent ? [] : [...selection];
}

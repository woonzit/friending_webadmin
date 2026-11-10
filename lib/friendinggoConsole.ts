import {
  FRIENDINGGO_AUDIENCES,
  FRIENDINGGO_BODY_MAX,
  FRIENDINGGO_CAPS,
  FRIENDINGGO_KINDS,
  FRIENDINGGO_PREHEADER_MAX,
  FRIENDINGGO_STATUSES,
  FRIENDINGGO_SUBJECT_MAX,
  friendingGoBody,
  friendingGoPreheader,
  friendingGoSendBody,
  friendingGoStatusBody,
  friendingGoSubject,
  isFriendingGoObjectId,
  type FriendingGoAudience,
  type FriendingGoCounts,
  type FriendingGoEmailContent,
  type FriendingGoKind,
  type FriendingGoSendBody,
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

/**
 * Who of the selection will be left out, by status, but only when it agrees with Core's preview: the
 * statuses are the list's as it was read, so a breakdown that does not add up to Core's count is not shown.
 */
export function friendingGoLeftOut(
  selection: readonly FriendingGoSelected[],
  counts: FriendingGoCounts,
): Array<{ status: Exclude<FriendingGoStatus, "active">; count: number }> | null {
  if (selection.some((person) => person.status === null)) return null;
  const leftOut = (["unsubscribed", "bounced", "complained"] as const)
    .map((status) => ({ status, count: selection.filter((person) => person.status === status).length }))
    .filter((entry) => entry.count > 0);
  return leftOut.reduce((sum, entry) => sum + entry.count, 0) === counts.suppressed
    && selection.length === counts.selected ? leftOut : null;
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

export type FriendingGoPendingEmail = { version: 1; command: FriendingGoSendBody };
export type FriendingGoPendingStatus = { version: 1; command: FriendingGoStatusBody; name: string };

function sameCommand(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(Object.keys(left).sort().map((key) => [key, left[key]]))
    === JSON.stringify(Object.keys(right).sort().map((key) => [key, right[key]]));
}

/** A stored pending email command, exactly as the bridge would accept it, or null. */
export function friendingGoPendingEmail(value: unknown): FriendingGoPendingEmail | null {
  const entry = record(value);
  const raw = record(entry?.command);
  if (!entry || !raw || !exactKeys(entry, ["version", "command"]) || entry.version !== 1) return null;
  const command = friendingGoSendBody(raw);
  return command && sameCommand(command, raw) ? { version: 1, command } : null;
}

export function friendingGoPendingStatus(value: unknown): FriendingGoPendingStatus | null {
  const entry = record(value);
  const raw = record(entry?.command);
  if (!entry || !raw || !exactKeys(entry, ["version", "command", "name"]) || entry.version !== 1) return null;
  if (typeof entry.name !== "string" || entry.name.length > 200) return null;
  const command = friendingGoStatusBody(raw);
  return command ? { version: 1, command, name: entry.name } : null;
}

import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "./adminMembership";
import { ADMIN_REQUEST_OUTCOME_UNKNOWN } from "./adminMembershipClientError";
import { datesAdminPrincipal } from "./datesAdmin";
import { datesBodyKeys, datesBoolean, datesId, datesInteger, datesReason, datesRecord, datesRequestKey } from "./datesExternalAdmin";
import { datesIntakeRefusal } from "./datesIntakeAdmin";

/**
 * An event's member content as the console reads it: Core's
 * `dates_event_content` (the wall posts, comments, event chat, reviews and
 * personally hidden content of one event, twenty rows a page) and
 * `dates_event_content_review` (open, or reuse, a moderation case for one of
 * them or for the event itself).
 *
 * Everything here is a rule about a body or a request. What the panel does
 * with them - reading, paging, selecting, a command in doubt - is
 * lib/datesEventContentPanel.ts.
 */
export const EVENT_CONTENT_ACTIONS = ["dates_event_content", "dates_event_content_review"] as const;
/** The tabs. "hidden" lists the wall posts and comments a member hid for themselves. */
export const EVENT_CONTENT_KINDS = ["wall_post", "wall_comment", "message", "review", "hidden"] as const;
export type EventContentKind = typeof EVENT_CONTENT_KINDS[number];
/** What a listed row is. */
export const EVENT_CONTENT_ROW_KINDS = ["wall_post", "wall_comment", "message", "review"] as const;
export type EventContentRowKind = typeof EVENT_CONTENT_ROW_KINDS[number];
/** What a case can be opened for: a listed row, or the event. */
export const EVENT_REVIEW_KINDS = [...EVENT_CONTENT_ROW_KINDS, "activity"] as const;
export type EventReviewKind = typeof EVENT_REVIEW_KINDS[number];
/** What a row carries: Core's wall post kinds (`DatesWallPolicy::KINDS`); everything that is not a wall post is "text". */
export const EVENT_CONTENT_ATTACHMENTS = ["text", "photo", "video", "location", "link", "youtube", "tiktok"] as const;
export type EventContentAttachment = typeof EVENT_CONTENT_ATTACHMENTS[number];
export const EVENT_CONTENT_STATES = ["active", "pending", "moderated", "deleted"] as const;
export type EventContentState = typeof EVENT_CONTENT_STATES[number];
/** Core's page (`DatesEventContentAdminService::content`): a body with more rows is not this route's. */
export const EVENT_CONTENT_PAGE_SIZE = 20;
const TEXT_MAX = 16000;
const CURSOR_MAX = 4096;

export type EventContentRow = {
  id: string; kind: EventContentRowKind; author_uid: number | null; text: string;
  content_kind: EventContentAttachment; state: EventContentState;
  post_id: string | null; root_id: string | null; created_at: number; signal_at: number | null;
  has_media: boolean; hide_count: number; report_count: number; case_id: string | null; can_review: boolean;
};
export type EventContentPage = { items: EventContentRow[]; has_more: boolean; next_cursor: string | null };
export type EventReviewRequest = { activity_id: string; kind: EventReviewKind; target_id: string; reason: string;
  break_glass: boolean; idempotency_key: string };

const ID_PREFIX: Readonly<Record<EventReviewKind, string>> = { wall_post: "wpo", wall_comment: "wco", message: "msg", review: "rev", activity: "act" };
/**
 * One of a closed vocabulary, as a string. Never by way of `String(value)`: a
 * list of one (`["deleted"]`) reads as its element once it is turned into a
 * string, and a projection leaf lets a list of scalars through.
 */
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
const count = datesInteger(0);
const memberUid = datesInteger(1);
const memberText = (value: unknown): value is string => typeof value === "string" && value.length <= TEXT_MAX * 2 && Array.from(value).length <= TEXT_MAX;
const cursor = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= CURSOR_MAX;
const envelope = (value: unknown): value is Record<string, unknown> => datesRecord(value) && value.success === true && value.status_code === 200
  && value.message === 200 && value.status === 200 && value.can_send === 0 && value.event_content_version === 1;

// ---------------------------------------------------------------- the list

/** Every field of a row, each of its own type: the id is one of the row's kind, a count is a number, a flag a boolean. */
function rowFields(row: Record<string, unknown>): row is Record<string, unknown> & EventContentRow {
  return oneOf(EVENT_CONTENT_ROW_KINDS, row.kind) && datesId(ID_PREFIX[row.kind])(row.id)
    && (row.author_uid === null || memberUid(row.author_uid)) && memberText(row.text)
    && oneOf(EVENT_CONTENT_ATTACHMENTS, row.content_kind) && oneOf(EVENT_CONTENT_STATES, row.state)
    && (row.post_id === null || datesId("wpo")(row.post_id)) && (row.root_id === null || datesId("wco")(row.root_id))
    && count(row.created_at) && (row.signal_at === null || count(row.signal_at))
    && datesBoolean(row.has_media) && datesBoolean(row.can_review) && count(row.hide_count) && count(row.report_count)
    && (row.case_id === null || datesId("cas")(row.case_id));
}
/**
 * A row is of the tab that was asked for. The "hidden" tab lists wall posts
 * and comments, each with the time of its newest hide - and only that tab
 * carries one.
 */
const rowOfTab = (row: EventContentRow, kind: EventContentKind): boolean => kind === "hidden"
  ? (row.kind === "wall_post" || row.kind === "wall_comment") && row.signal_at !== null
  : row.kind === kind && row.signal_at === null;
/** A list asked for one post's comments carries that post's, and no other's. */
const rowOfPost = (row: EventContentRow, postId: string): boolean => postId === "" || row.post_id === postId;
/** A tombstone carries nothing of what was deleted: no text, no author, no media, and nothing to review. */
const tombstoneBare = (row: EventContentRow): boolean => row.state !== "deleted"
  || (row.text === "" && row.author_uid === null && !row.can_review && !row.has_media);
/** A comment that is still there belongs to a post. */
const commentHasPost = (row: EventContentRow): boolean => row.kind !== "wall_comment" || row.state === "deleted" || row.post_id !== null;
/** A full page and the cursor of the next one, or the last page and none. */
const paging = (body: Record<string, unknown>, rows: number): boolean => datesBoolean(body.has_more)
  && (body.has_more ? cursor(body.next_cursor) && rows === EVENT_CONTENT_PAGE_SIZE : body.next_cursor === null);
/** The named fields of a checked row, and nothing a body carried beside them. */
const rowOf = (row: EventContentRow): EventContentRow => ({ id: row.id, kind: row.kind, author_uid: row.author_uid, text: row.text,
  content_kind: row.content_kind, state: row.state, post_id: row.post_id, root_id: row.root_id, created_at: row.created_at, signal_at: row.signal_at,
  has_media: row.has_media, hide_count: row.hide_count, report_count: row.report_count, case_id: row.case_id, can_review: row.can_review });

/**
 * The page of a read, or `null`: not the page that was asked for (another
 * event, tab or post), or not a page at all. One row that breaks a rule fails
 * the page - a list with a row left out would read as "that is all there is".
 */
export function eventContentPage(value: unknown, activityId: string, kind: EventContentKind, postId = ""): EventContentPage | null {
  if (!envelope(value) || !datesId("act")(activityId) || value.activity_id !== activityId || value.kind !== kind
    || !datesId("aud")(value.audit_id) || !count(value.server_now)
    || !Array.isArray(value.items) || value.items.length > EVENT_CONTENT_PAGE_SIZE || !paging(value, value.items.length)) return null;
  const items: EventContentRow[] = [], seen = new Set<string>();
  for (const row of value.items as unknown[]) {
    if (!datesRecord(row) || !rowFields(row) || seen.has(row.id)
      || !rowOfTab(row, kind) || !rowOfPost(row, postId) || !tombstoneBare(row) || !commentHasPost(row)) return null;
    seen.add(row.id);
    items.push(rowOf(row));
  }
  return { items, has_more: value.has_more as boolean, next_cursor: value.next_cursor as string | null };
}

/** Why a read shows no list. Never "there is nothing": that is a page with no rows. */
export type EventContentProblem =
  /** Core refused because the operator is party to the event (`dates-moderation-conflict`); break-glass is the way through. */
  | { kind: "conflict" }
  /** Another refusal for who is asking: a capability, a role. */
  | { kind: "forbidden"; error: string }
  /** The event, or what was asked of it, is not there. */
  | { kind: "not-found" }
  /** The console could not confirm the operator's membership; nothing was asked of Core. */
  | { kind: "unconfirmed" }
  /** Another answer to this request: what was asked is not valid. */
  | { kind: "refused"; error: string }
  /** Core or the connection failed. `error`: what was answered, when something readable was. */
  | { kind: "unavailable"; error: string | null }
  /** Core answered with a success this console cannot verify. */
  | { kind: "malformed" };

/** What a read that is not a page (`eventContentPage` gave `null`) was instead. */
export function eventContentReadProblem(response: unknown): EventContentProblem {
  if (datesRecord(response) && response.success === true) return { kind: "malformed" };
  const refusal = datesIntakeRefusal(response);
  if (refusal.kind === "unreadable") return datesRecord(response) ? { kind: "malformed" } : { kind: "unavailable", error: null };
  if (refusal.error === ADMIN_MEMBERSHIP_UNCONFIRMED) return { kind: "unconfirmed" };
  if (refusal.error === "dates-moderation-conflict") return { kind: "conflict" };
  if (refusal.status === 401 || refusal.status === 403) return { kind: "forbidden", error: refusal.error };
  if (refusal.status === 404) return { kind: "not-found" };
  return refusal.status < 500 ? { kind: "refused", error: refusal.error } : { kind: "unavailable", error: refusal.error };
}
/** The operator may not see this content: whatever of it is on the screen goes. */
export const eventContentAuthorityProblem = (problem: EventContentProblem): boolean => problem.kind === "conflict" || problem.kind === "forbidden";

// ---------------------------------------------------------------- the command

/** Core's receipt of this very request: the event, the kind and the target it names, and the case. */
export function eventContentReviewReceipt(value: unknown, request: EventReviewRequest): { case_id: string; created: boolean } | null {
  return envelope(value) && value.activity_id === request.activity_id && value.kind === request.kind && value.target_id === request.target_id
    && datesId("cas")(value.case_id) && datesId("aud")(value.audit_id) && datesBoolean(value.created) && datesBoolean(value.idempotency_replayed)
    ? { case_id: value.case_id, created: value.created } : null;
}

export type EventReviewOutcome =
  | { kind: "opened"; case_id: string; created: boolean }
  /** An answer to this request, and no case of it. `problem`: what the answer was, in the terms of a read. */
  | { kind: "refused"; error: string; problem: EventContentProblem }
  /** Nothing says whether a case was opened. `error`: what was answered, when something readable was. */
  | { kind: "doubt"; error: string | null };

/**
 * What a reply means for a request to open a case, the first time and on a
 * repeat under the same key alike.
 *
 * Any readable refusal below 500 settles the request, except "the command is
 * still running". That is more than the general rule of a kept command
 * (`datesCommandOutcome`, "kept": only a pinned no-land refusal settles),
 * because several of this route's refusals are raised before Core looks the
 * key up - the event is gone, the operator is conflicted, the reason is not
 * valid - and so do not prove that an earlier attempt opened nothing. It is
 * safe here for one reason: Core opens a case only when the target has no open
 * one and otherwise answers with that case
 * (`DatesEventContentAdminService::review`), so a later request under a new
 * key cannot open a second case - at worst it finds the one an unanswered
 * attempt opened, which the list also shows as the row's existing case.
 *
 * What stays in doubt: no answer, an unreadable one, a failure of Core or of
 * the connection (5xx), and "still running".
 */
export function eventContentReviewOutcome(response: unknown, request: EventReviewRequest): EventReviewOutcome {
  const receipt = eventContentReviewReceipt(response, request);
  if (receipt) return { kind: "opened", ...receipt };
  const refusal = datesIntakeRefusal(response);
  // The client's own "the answer was lost" is not an answer.
  if (refusal.kind === "unreadable" || refusal.error === ADMIN_REQUEST_OUTCOME_UNKNOWN) return { kind: "doubt", error: null };
  return refusal.status < 500 && refusal.error !== "dates-admin-command-in-progress"
    ? { kind: "refused", error: refusal.error, problem: eventContentReadProblem(response) } : { kind: "doubt", error: refusal.error };
}

// ---------------------------------------------------------------- the bridge

/** The read needs the evidence capability, the command the right to take a case as well - as in Core. `null`: another action. */
export function eventContentProxyAuthorized(action: string, membership: unknown): boolean | null {
  if (!(EVENT_CONTENT_ACTIONS as readonly string[]).includes(action)) return null;
  const principal = datesAdminPrincipal(membership);
  return !!principal && principal.capabilities.includes("dates_evidence_read")
    && (action !== "dates_event_content_review" || principal.capabilities.includes("dates_case_claim"));
}

/** What both requests carry: the event, and the conflict-of-interest scope - a break-glass request has its reason. */
const requestScope = (body: Record<string, unknown>): boolean => datesId("act")(body.activity_id)
  && (body.break_glass === undefined || datesBoolean(body.break_glass))
  && (body.reason === undefined || datesReason(body.reason)) && (body.break_glass !== true || datesReason(body.reason));
/** The list: a tab; one post's comments on the comments tab only; the next page. */
const readRequest = (body: Record<string, unknown>): boolean => datesBodyKeys(body, ["activity_id", "kind"], ["break_glass", "reason", "post_id", "cursor"])
  && requestScope(body) && oneOf(EVENT_CONTENT_KINDS, body.kind)
  && (body.post_id === undefined || (body.kind === "wall_comment" && datesId("wpo")(body.post_id)))
  && (body.cursor === undefined || cursor(body.cursor));
/** The command: always a reason; a target that is an id of its kind; and "the event" is this event, never another. */
const reviewRequest = (body: Record<string, unknown>): boolean => datesBodyKeys(body, ["activity_id", "kind", "target_id", "reason", "idempotency_key"], ["break_glass"])
  && requestScope(body) && datesReason(body.reason) && oneOf(EVENT_REVIEW_KINDS, body.kind) && datesId(ID_PREFIX[body.kind])(body.target_id)
  && (body.kind !== "activity" || body.target_id === body.activity_id) && datesRequestKey(body.idempotency_key);

/** Closed request shape, or `null`; `undefined`: another action. The actor and the secret are the authenticated server's alone. */
export function normalizeEventContentBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (action === "dates_event_content") return readRequest(body) ? { ...body } : null;
  if (action === "dates_event_content_review") return reviewRequest(body) ? { ...body } : null;
  return undefined;
}

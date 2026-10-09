import {
  eventContentAuthorityProblem, eventContentPage, eventContentReadProblem, eventContentReviewOutcome,
  type EventContentKind, type EventContentPage, type EventContentProblem, type EventContentRow, type EventContentRowKind, type EventReviewRequest,
} from "./datesEventContent";

/**
 * What the "Content & signals" panel of an event page is doing: the one place
 * that says which read is wanted, which rows are shown, what is selected and
 * where a request to open a case stands. The component renders this state and
 * sends what it asks for; it decides nothing itself, so every rule below is
 * tested without a browser (tests/datesEventContentPanel.test.mts).
 *
 * The rules, in short:
 * - Nothing is read until the operator asks ("shown"): a read shows members'
 *   content and Core records it.
 * - Every read has a ticket. A new read raises it; an answer to an older
 *   ticket is dropped. "Loading" is the state of the newest ticket and ends
 *   with its answer, so a superseded read can leave nothing behind.
 * - A list that cannot be read is a named problem, never an empty list. The
 *   next page failing keeps the rows that were read - unless the failure says
 *   the operator may not see them.
 * - A selection is of a row that is listed: another tab, post or access
 *   scope, and a re-read without the row, end it.
 * - A request to open a case is sent once and re-sent as the very same
 *   object. Any answer settles it; while it is in doubt the list can be read
 *   again, and a row that then shows an open case settles it too.
 */

/** The conflict-of-interest scope a read and a request are sent with. */
export type EventContentAccess = { break_glass: boolean; reason: string };

/** What a case is asked for, as it was when it was chosen: the list may be re-read or cleared under it. */
export type EventReviewTarget =
  | { kind: "activity"; id: string }
  | { kind: EventContentRowKind; id: string; reply: boolean; author_uid: number | null; excerpt: string; cut: boolean };

export type EventContentRead =
  /** Nothing was asked for yet: the panel is closed. */
  | { status: "idle" }
  /** The read of the newest ticket is on its way. `more`: the next page of the list that is shown. */
  | { status: "loading"; more: boolean }
  | { status: "ready" }
  /** `more`: the next page failed and the rows that were read are still shown. Otherwise there is no list. */
  | { status: "failed"; more: boolean; problem: EventContentProblem };

export type EventReviewCommand =
  | { status: "idle" }
  /** Sent and not answered. `attempts`: how often this very request has gone out. */
  | { status: "sending"; request: EventReviewRequest; attempts: number }
  /** Not answered, or answered unclearly (`error`): the same request can go again, or be set aside. */
  | { status: "doubt"; request: EventReviewRequest; attempts: number; error: string | null };

export type EventReviewNotice =
  | { kind: "refused"; error: string }
  /** A re-read showed an open case of the target of a request in doubt. */
  | { kind: "exists"; case_id: string }
  | { kind: "opened"; case_id: string };

export type EventContentPanelState = {
  activityId: string;
  kind: EventContentKind;
  /** One post's comments, on the comments tab; "" for all. */
  postId: string;
  access: EventContentAccess;
  ticket: number;
  read: EventContentRead;
  page: EventContentPage | null;
  target: EventReviewTarget | null;
  reason: string;
  command: EventReviewCommand;
  notice: EventReviewNotice | null;
};

export type EventContentPanelAction =
  /** "Show content and signals": the first read. */
  | { type: "shown" }
  /** A tab, or one post's comments. */
  | { type: "listChosen"; kind: EventContentKind; postId: string }
  | { type: "accessApplied"; access: EventContentAccess }
  /** Read the list that is asked for again, from its first page. */
  | { type: "refreshed" }
  | { type: "moreAsked" }
  | { type: "readAnswered"; ticket: number; response: unknown }
  | { type: "targetChosen"; target: EventReviewTarget }
  | { type: "reasonTyped"; value: string }
  /** The form is closed; a request in doubt is set aside. */
  | { type: "targetDropped" }
  | { type: "reviewStarted"; request: EventReviewRequest }
  | { type: "reviewAnswered"; request: EventReviewRequest; response: unknown };

export const EVENT_REVIEW_REASON_MIN = 3;
export const EVENT_REVIEW_REASON_MAX = 1000;
/** How much of a row's text names it in the form. */
export const EVENT_REVIEW_EXCERPT = 80;

export function eventContentPanelInitial(activityId: string): EventContentPanelState {
  return { activityId, kind: "wall_post", postId: "", access: { break_glass: false, reason: "" }, ticket: 0, read: { status: "idle" }, page: null,
    target: null, reason: "", command: { status: "idle" }, notice: null };
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
/** A row as the target of a request: its kind, its author and the start of its text, on one line. */
export function eventReviewTargetOf(row: EventContentRow): EventReviewTarget {
  const letters = [...graphemes.segment(row.text.replace(/\s+/gu, " ").trim())].map((part) => part.segment);
  return { kind: row.kind, id: row.id, reply: row.root_id !== null, author_uid: row.author_uid,
    excerpt: letters.slice(0, EVENT_REVIEW_EXCERPT).join("").trimEnd(), cut: letters.length > EVENT_REVIEW_EXCERPT };
}

/** A reason Core and the bridge take: at least three characters that are not space, at most a thousand. */
export const eventReviewReasonValid = (reason: string): boolean => Array.from(reason.trim()).length >= EVENT_REVIEW_REASON_MIN
  && Array.from(reason).length <= EVENT_REVIEW_REASON_MAX;
/** Break-glass is asked for with a reason, or not at all. */
export const eventContentAccessValid = (access: EventContentAccess): boolean => !access.break_glass || eventReviewReasonValid(access.reason);

/** The panel was asked to show the list (it may still be loading, or have failed). */
export const eventContentShown = (state: EventContentPanelState): boolean => state.read.status !== "idle";
/**
 * A request is on its way or in doubt. What it was made from stays as it is
 * until it is settled: the list that is asked for, the access scope, the target
 * and the reason.
 */
export const eventContentHeld = (state: EventContentPanelState): boolean => state.command.status !== "idle";

/** The body of the read the newest ticket stands for. */
export function eventContentReadBody(state: EventContentPanelState): Record<string, unknown> {
  const cursor = state.read.status === "loading" && state.read.more ? state.page?.next_cursor ?? null : null;
  return { activity_id: state.activityId, kind: state.kind, ...(state.postId === "" ? {} : { post_id: state.postId }), ...(cursor === null ? {} : { cursor }),
    break_glass: state.access.break_glass, ...(state.access.break_glass ? { reason: state.access.reason } : {}) };
}

/**
 * The request the form sends now, or `null`: there is nothing to send. A
 * request in doubt is returned as the very object that was sent - the same
 * reason, scope and key - whatever the form or the access scope says since;
 * `key` is used for a new request only.
 */
export function eventReviewRequest(state: EventContentPanelState, key: string): EventReviewRequest | null {
  if (state.command.status === "doubt") return state.command.request;
  if (state.command.status !== "idle" || state.target === null || !eventReviewReasonValid(state.reason)) return null;
  return { activity_id: state.activityId, kind: state.target.kind, target_id: state.target.id, reason: state.reason.trim(),
    break_glass: state.access.break_glass, idempotency_key: key };
}

/** A new read: the next ticket. The first page replaces the list; the next page is added to it. */
const reading = (state: EventContentPanelState, more: boolean): EventContentPanelState =>
  ({ ...state, ticket: state.ticket + 1, read: { status: "loading", more }, page: more ? state.page : null });
/** A selected row is not listed any more. The event itself is not a row and stays selected. */
const withoutRowTarget = (state: EventContentPanelState): EventContentPanelState => state.target === null || state.target.kind === "activity"
  ? state : { ...state, target: null, reason: "" };
/** The rows of the next page after the ones that are shown; a row that moved onto it is not shown twice. */
const appended = (shown: EventContentPage, next: EventContentPage): EventContentPage =>
  ({ ...next, items: [...shown.items, ...next.items.filter((row) => !shown.items.some((old) => old.id === row.id))] });

/** After the first page of a list was read: a selected row stays selected only if it is listed and can still be reviewed. */
function selectionOnList(state: EventContentPanelState): EventContentPanelState {
  const target = state.target;
  if (target === null || target.kind === "activity" || eventContentHeld(state)) return state;
  const row = state.page?.items.find((item) => item.id === target.id);
  return row && row.can_review ? { ...state, target: eventReviewTargetOf(row) } : withoutRowTarget(state);
}

/**
 * A request in doubt against a list that was just read: when the target's row
 * shows an open case, there is nothing left to wait for. The request asked for
 * "a case of this content", Core answers a repeat with the open case of the
 * target (`DatesEventContentAdminService::review`), and that case is on the
 * screen - so the request is over and the operator is pointed at the case.
 */
function doubtOnList(state: EventContentPanelState): EventContentPanelState {
  if (state.command.status !== "doubt") return state;
  const target = state.command.request.target_id;
  const row = state.page?.items.find((item) => item.id === target);
  return row && row.case_id !== null
    ? { ...state, command: { status: "idle" }, target: null, reason: "", notice: { kind: "exists", case_id: row.case_id } } : state;
}

function readAnswered(state: EventContentPanelState, response: unknown): EventContentPanelState {
  const more = state.read.status === "loading" && state.read.more;
  const page = eventContentPage(response, state.activityId, state.kind, state.postId);
  if (page === null) {
    const problem = eventContentReadProblem(response);
    // The next page failed: the rows that were read stay. A refusal for who is asking is different - what is shown goes.
    const kept = more && state.page !== null && !eventContentAuthorityProblem(problem);
    const failed: EventContentPanelState = { ...state, read: { status: "failed", more: kept, problem }, page: kept ? state.page : null };
    return kept || eventContentHeld(state) ? failed : withoutRowTarget(failed);
  }
  const listed: EventContentPanelState = { ...state, read: { status: "ready" }, page: more && state.page !== null ? appended(state.page, page) : page };
  return doubtOnList(more ? listed : selectionOnList(listed));
}

function reviewAnswered(state: EventContentPanelState, request: EventReviewRequest, attempts: number, response: unknown): EventContentPanelState {
  const outcome = eventContentReviewOutcome(response, request);
  if (outcome.kind === "doubt") return { ...state, command: { status: "doubt", request, attempts, error: outcome.error } };
  if (outcome.kind === "opened") {
    // The page leaves for the case; until it has, the row shows it like any other row with a case.
    const page = state.page && { ...state.page, items: state.page.items.map((row) => row.id === request.target_id ? { ...row, case_id: outcome.case_id } : row) };
    return { ...state, page, command: { status: "idle" }, target: null, reason: "", notice: { kind: "opened", case_id: outcome.case_id } };
  }
  // Refused: the request is over (lib/datesEventContent.ts, eventContentReviewOutcome, says why that is safe on a repeat too).
  const settled: EventContentPanelState = { ...state, command: { status: "idle" }, notice: { kind: "refused", error: outcome.error } };
  // What was asked is not valid, or the content is gone: the list and the form stay, so that the reason can be put right.
  if (!eventContentAuthorityProblem(outcome.problem)) return settled;
  // Refused for who is asking: the operator may not see this content, so what is shown of it goes - and a read that is
  // still on its way is not let in afterwards (its ticket is over).
  return withoutRowTarget({ ...settled, ticket: state.ticket + 1, read: { status: "failed", more: false, problem: outcome.problem }, page: null });
}

export function eventContentPanelReducer(state: EventContentPanelState, action: EventContentPanelAction): EventContentPanelState {
  switch (action.type) {
    case "shown":
      return eventContentShown(state) ? state : reading(state, false);
    case "listChosen": {
      const postId = action.kind === "wall_comment" ? action.postId : "";
      // The list that is shown, asked for again by its own tab: nothing changes - no blank list, no read to lose.
      if (!eventContentShown(state) || eventContentHeld(state) || (action.kind === state.kind && postId === state.postId)) return state;
      return reading(withoutRowTarget({ ...state, kind: action.kind, postId, notice: null }), false);
    }
    case "accessApplied": {
      const access = { break_glass: action.access.break_glass, reason: action.access.reason.trim() };
      if (eventContentHeld(state) || !eventContentAccessValid(access)) return state;
      // Another scope is another list: the rows read under the earlier one go, and a row selected among them with them.
      return eventContentShown(state) ? reading(withoutRowTarget({ ...state, access, notice: null }), false) : { ...state, access };
    }
    case "refreshed":
      // Also while a request is in doubt: reading the list again is how the operator finds out what became of it.
      return !eventContentShown(state) || state.command.status === "sending" ? state : reading(state, false);
    case "moreAsked": {
      const next = state.read.status === "ready" || (state.read.status === "failed" && state.read.more);
      return next && !eventContentHeld(state) && state.page !== null && state.page.has_more ? reading(state, true) : state;
    }
    case "readAnswered":
      return action.ticket === state.ticket && state.read.status === "loading" ? readAnswered(state, action.response) : state;
    case "targetChosen":
      return eventContentHeld(state) ? state : { ...state, target: action.target, reason: "", notice: null };
    case "reasonTyped":
      return eventContentHeld(state) || state.target === null ? state : { ...state, reason: action.value };
    case "targetDropped":
      if (state.command.status === "sending") return state;
      // Setting a request in doubt aside gives its key up. That cannot open a second case: Core answers a later request
      // for the same content with the case an unanswered attempt opened, and Refresh shows that case on the row.
      return { ...state, command: { status: "idle" }, target: null, reason: "", notice: null };
    case "reviewStarted": {
      const { command, target } = state;
      if (command.status === "doubt") {
        return action.request === command.request ? { ...state, command: { status: "sending", request: command.request, attempts: command.attempts + 1 } } : state;
      }
      if (command.status !== "idle" || target === null || action.request.kind !== target.kind || action.request.target_id !== target.id) return state;
      return { ...state, command: { status: "sending", request: action.request, attempts: 1 }, notice: null };
    }
    case "reviewAnswered":
      return state.command.status === "sending" && state.command.request === action.request
        ? reviewAnswered(state, action.request, state.command.attempts, action.response) : state;
  }
}

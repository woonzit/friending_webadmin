import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVENT_REVIEW_EXCERPT, eventContentAccessValid, eventContentHeld, eventContentPanelInitial, eventContentPanelReducer, eventContentReadBody,
  eventReviewReasonValid, eventReviewRequest, eventReviewTargetOf,
  type EventContentPanelAction, type EventContentPanelState,
} from "../lib/datesEventContentPanel.ts";
import type { EventReviewRequest } from "../lib/datesEventContent.ts";

// The panel's state machine on Core's genuine bodies (tests/fixtures/dates_event_content_wire). Nothing here needs a browser:
// the component renders this state and sends what it asks for.
const root = new URL("./fixtures/dates_event_content_wire/", import.meta.url);
const body = (name: string) => JSON.parse(readFileSync(new URL(name + ".json", root), "utf8"));
const posts = body("admin-wall-posts"), comments = body("admin-comments-page"), receipt = body("admin-wall-review");
const activity: string = posts.activity_id;
const core = (status_code: number, error: string) => ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 });
const run = (state: EventContentPanelState, ...actions: EventContentPanelAction[]) => actions.reduce(eventContentPanelReducer, state);
/** The panel with the wall posts read. */
const listed = () => run(eventContentPanelInitial(activity), { type: "shown" }, { type: "readAnswered", ticket: 1, response: posts });
/** The first comments page (twenty rows and a cursor) read. */
const paged = () => run(listed(), { type: "listChosen", kind: "wall_comment", postId: "" }, { type: "readAnswered", ticket: 2, response: comments });
const hex = (seed: number) => seed.toString(16).padStart(32, "0");
/** A last page: the rows given, no cursor. */
const lastPage = (rows: unknown[]) => ({ ...comments, items: rows, has_more: false, next_cursor: null });
const KEY = "content:00000000-0000-4000-8000-000000000001";
/** The first reviewable wall post selected, with a reason, and its request sent. */
function sent(reason = "Proactive safety check") {
  const row = posts.items[0];
  const chosen = run(listed(), { type: "targetChosen", target: eventReviewTargetOf(row) }, { type: "reasonTyped", value: reason });
  const request = eventReviewRequest(chosen, KEY)!;
  return { row, chosen, request, state: run(chosen, { type: "reviewStarted", request }) };
}

test("nothing is read until the operator asks; then every read has a ticket and a body that says what is wanted", () => {
  const closed = eventContentPanelInitial(activity);
  assert.equal(closed.shown, false); assert.deepEqual(closed.read, { status: "idle" }); assert.equal(closed.page, null); assert.equal(closed.ticket, 0);
  // Closed, nothing but "show" asks for a read.
  for (const action of [{ type: "refreshed" }, { type: "moreAsked" }, { type: "listChosen", kind: "message", postId: "" }, { type: "readAnswered", ticket: 0, response: posts }] as EventContentPanelAction[]) {
    assert.equal(eventContentPanelReducer(closed, action), closed, action.type);
  }
  // An access scope applied to a closed panel is a scope, not a read: it goes with the first read when that is asked for.
  const scopedClosed = run(closed, { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } });
  assert.equal(scopedClosed.shown, false); assert.deepEqual(scopedClosed.read, { status: "idle" }); assert.equal(scopedClosed.ticket, 0);
  assert.deepEqual(eventContentReadBody(run(scopedClosed, { type: "shown" })), { activity_id: activity, kind: "wall_post", break_glass: true, reason: "Cleared by the duty lead" });
  const shown = run(closed, { type: "shown" });
  assert.equal(shown.shown, true); assert.deepEqual(shown.read, { status: "loading", more: false }); assert.equal(shown.ticket, 1);
  assert.deepEqual(eventContentReadBody(shown), { activity_id: activity, kind: "wall_post", break_glass: false });
  assert.equal(run(shown, { type: "shown" }), shown, "shown once");
  const ready = run(shown, { type: "readAnswered", ticket: 1, response: posts });
  assert.deepEqual(ready.read, { status: "ready" }); assert.equal(ready.page?.items.length, posts.items.length);
  // One post's comments, under break-glass: both travel with the read, and a post filter never leaves the comments tab.
  const post = posts.items[0].id;
  const scoped = run(ready, { type: "accessApplied", access: { break_glass: true, reason: "  Cleared by the duty lead " } }, { type: "listChosen", kind: "wall_comment", postId: post });
  assert.deepEqual(eventContentReadBody(scoped), { activity_id: activity, kind: "wall_comment", post_id: post, break_glass: true, reason: "Cleared by the duty lead" });
  assert.equal(run(scoped, { type: "listChosen", kind: "message", postId: post }).postId, "");
  // Break-glass without a reason is not a scope.
  assert.equal(run(ready, { type: "accessApplied", access: { break_glass: true, reason: " a " } }), ready);
  assert.equal(eventContentAccessValid({ break_glass: false, reason: "" }), true); assert.equal(eventContentAccessValid({ break_glass: true, reason: "ab" }), false);
});

test("the next page is added to the rows that are shown, a row that moved onto it is not shown twice, and its cursor is the list's", () => {
  const first = paged();
  assert.equal(first.page?.items.length, 20); assert.equal(first.page?.has_more, true);
  const asking = run(first, { type: "moreAsked" });
  assert.deepEqual(asking.read, { status: "loading", more: true }); assert.equal(asking.ticket, 3);
  assert.equal(asking.page, first.page, "the rows stay while the next page is read");
  assert.deepEqual(eventContentReadBody(asking), { activity_id: activity, kind: "wall_comment", cursor: comments.next_cursor, break_glass: false });
  // A comment was written in between: the last row of the first page is the first row of the second.
  const fresh = [1, 2, 3].map((seed) => ({ ...comments.items[0], id: "wco_" + hex(seed) }));
  const merged = run(asking, { type: "readAnswered", ticket: 3, response: lastPage([comments.items[19], ...fresh]) });
  assert.deepEqual(merged.read, { status: "ready" });
  assert.deepEqual(merged.page?.items.map((row) => row.id), [...comments.items.map((row: any) => row.id), ...fresh.map((row) => row.id)]);
  assert.equal(new Set(merged.page?.items.map((row) => row.id)).size, 23);
  assert.equal(merged.page?.has_more, false); assert.equal(merged.page?.next_cursor, null);
  assert.equal(run(merged, { type: "moreAsked" }), merged, "there is no page after the last");
  // The first page is asked for without a cursor, whatever was read before.
  assert.equal(Object.hasOwn(eventContentReadBody(run(merged, { type: "refreshed" })), "cursor"), false);
});

test("a next page that fails keeps the rows that were read and says so; a refusal for who is asking takes them away", () => {
  const asking = run(paged(), { type: "moreAsked" });
  for (const [response, problem] of [[core(503, "dates-admin-unavailable"), { kind: "unavailable", error: "dates-admin-unavailable" }], [null, { kind: "unavailable", error: null }],
    [{ ...comments, items: "none" }, { kind: "malformed" }], [core(422, "dates-event-content-invalid"), { kind: "refused", error: "dates-event-content-invalid" }],
    [{ success: false, status_code: 503, error: "admin-membership-unconfirmed" }, { kind: "unconfirmed" }]] as const) {
    const failed = run(asking, { type: "readAnswered", ticket: 3, response });
    assert.deepEqual(failed.read, { status: "failed", more: true, problem }); assert.equal(failed.page, asking.page, JSON.stringify(problem));
    // The same page can be asked for again, with the cursor the list still has.
    const again = run(failed, { type: "moreAsked" });
    assert.deepEqual(again.read, { status: "loading", more: true }); assert.equal(eventContentReadBody(again).cursor, comments.next_cursor);
  }
  for (const [response, problem] of [[core(403, "dates-moderation-conflict"), { kind: "conflict" }],
    [{ success: false, status_code: 403, error: "dates-admin-capability-required" }, { kind: "forbidden", error: "dates-admin-capability-required" }]] as const) {
    const refused = run(asking, { type: "readAnswered", ticket: 3, response });
    assert.deepEqual(refused.read, { status: "failed", more: false, problem }); assert.equal(refused.page, null);
    assert.equal(run(refused, { type: "moreAsked" }), refused);
  }
  // The first page failing is a named problem and no list - never an empty one.
  const first = run(eventContentPanelInitial(activity), { type: "shown" }, { type: "readAnswered", ticket: 1, response: core(404, "dates-event-content-unavailable") });
  assert.deepEqual(first.read, { status: "failed", more: false, problem: { kind: "not-found" } }); assert.equal(first.page, null);
  const empty = run(eventContentPanelInitial(activity), { type: "shown" }, { type: "readAnswered", ticket: 1, response: { ...posts, items: [] } });
  assert.deepEqual(empty.read, { status: "ready" }); assert.deepEqual(empty.page?.items, []);
});

test("the tab of the list that is shown changes nothing: no blank list, and a read on its way still ends", () => {
  const ready = listed();
  assert.equal(run(ready, { type: "listChosen", kind: "wall_post", postId: "" }), ready, "the very same state: nothing to render again");
  // While the read is on its way: it stays the newest, and its answer ends "loading".
  const loading = run(eventContentPanelInitial(activity), { type: "shown" });
  const clicked = run(loading, { type: "listChosen", kind: "wall_post", postId: "" }, { type: "listChosen", kind: "wall_post", postId: "ignored-off-the-comments-tab" });
  assert.equal(clicked, loading); assert.equal(clicked.ticket, 1);
  assert.deepEqual(run(clicked, { type: "readAnswered", ticket: 1, response: posts }).read, { status: "ready" });
  // The comments tab with one post's comments shown IS another list: all comments.
  const post = posts.items[0].id;
  const scoped = run(ready, { type: "listChosen", kind: "wall_comment", postId: post });
  assert.equal(run(scoped, { type: "listChosen", kind: "wall_comment", postId: post }), scoped);
  const all = run(scoped, { type: "listChosen", kind: "wall_comment", postId: "" });
  assert.equal(all.postId, ""); assert.equal(all.ticket, scoped.ticket + 1); assert.deepEqual(all.read, { status: "loading", more: false });
});

test("an answer to a read that was superseded is dropped, and the newest read always ends loading", () => {
  const first = run(eventContentPanelInitial(activity), { type: "shown" });
  const second = run(first, { type: "listChosen", kind: "wall_comment", postId: "" });
  assert.equal(second.ticket, 2); assert.equal(second.page, null);
  // The wall posts arrive late: not the comments tab's rows, and not the end of its loading either.
  const late = run(second, { type: "readAnswered", ticket: 1, response: posts });
  assert.equal(late, second);
  const ready = run(late, { type: "readAnswered", ticket: 2, response: comments });
  assert.deepEqual(ready.read, { status: "ready" }); assert.equal(ready.page?.items.every((row) => row.kind === "wall_comment"), true);
  // An answer to the right ticket that is another tab's body is not this list.
  assert.deepEqual(run(second, { type: "readAnswered", ticket: 2, response: posts }).read, { status: "failed", more: false, problem: { kind: "malformed" } });
  // Refresh during a read, and a second answer to a ticket that was answered.
  const refreshed = run(second, { type: "refreshed" });
  assert.equal(refreshed.ticket, 3); assert.equal(run(refreshed, { type: "readAnswered", ticket: 2, response: comments }), refreshed);
  assert.equal(run(ready, { type: "readAnswered", ticket: 2, response: lastPage([]) }), ready);
  // A late next page after the list was replaced does not come back as "the list".
  const more = run(paged(), { type: "moreAsked" });
  const replaced = run(more, { type: "listChosen", kind: "review", postId: "" });
  assert.equal(run(replaced, { type: "readAnswered", ticket: more.ticket, response: lastPage([]) }), replaced);
});

test("a selection is of a row that is listed: another tab, post filter or access scope, and a re-read without it, end it", () => {
  const row = posts.items[0], target = eventReviewTargetOf(row);
  assert.deepEqual(target, { kind: "wall_post", id: row.id, reply: false, author_uid: row.author_uid, excerpt: row.text, cut: false });
  const chosen = run(listed(), { type: "targetChosen", target }, { type: "reasonTyped", value: "Looks like spam" });
  assert.equal(chosen.target, target); assert.equal(chosen.reason, "Looks like spam");
  for (const action of [{ type: "listChosen", kind: "message", postId: "" }, { type: "listChosen", kind: "wall_comment", postId: row.id },
    { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } }] as EventContentPanelAction[]) {
    const moved = run(chosen, action);
    assert.equal(moved.target, null, action.type); assert.equal(moved.reason, ""); assert.deepEqual(moved.read, { status: "loading", more: false });
  }
  // Read again: listed and reviewable keeps the selection and the reason; gone, deleted or not reviewable ends it.
  const again = run(chosen, { type: "refreshed" });
  assert.equal(again.target, target, "kept while the list is read");
  const kept = run(again, { type: "readAnswered", ticket: again.ticket, response: posts });
  assert.equal(kept.target?.id, row.id); assert.equal(kept.reason, "Looks like spam");
  const without = { ...posts, items: posts.items.slice(1) };
  const tombstone = { ...posts, items: [{ ...row, state: "deleted", text: "", author_uid: null, can_review: false, has_media: false }, ...posts.items.slice(1)] };
  for (const response of [without, tombstone, core(503, "dates-admin-unavailable")]) {
    const gone = run(again, { type: "readAnswered", ticket: again.ticket, response });
    assert.equal(gone.target, null); assert.equal(gone.reason, "");
  }
  // The next page adds rows and takes none away: the selection stays.
  const comment = comments.items.find((item: any) => item.can_review);
  const deep = run(paged(), { type: "targetChosen", target: eventReviewTargetOf(comment) }, { type: "moreAsked" });
  assert.equal(run(deep, { type: "readAnswered", ticket: deep.ticket, response: lastPage([]) }).target?.id, comment.id);
  // The event itself is not a row: it stays selected across lists.
  const whole = run(listed(), { type: "targetChosen", target: { kind: "activity", id: activity } }, { type: "reasonTyped", value: "The whole event" }, { type: "listChosen", kind: "review", postId: "" });
  assert.deepEqual(whole.target, { kind: "activity", id: activity }); assert.equal(whole.reason, "The whole event");
  // Another target starts with an empty reason; cancel closes the form.
  assert.equal(run(chosen, { type: "targetChosen", target: eventReviewTargetOf(posts.items[1]) }).reason, "");
  const dropped = run(chosen, { type: "targetDropped" }); assert.equal(dropped.target, null); assert.equal(dropped.reason, "");
});

test("a row is named in words: its kind, whether it is a reply, its author and the start of its text on one line", () => {
  const reply = comments.items.find((item: any) => item.root_id !== null);
  assert.equal((eventReviewTargetOf(reply) as { reply: boolean }).reply, true);
  const long = eventReviewTargetOf({ ...posts.items[0], text: `  first line\n\nsecond\tline ${"é".repeat(200)}` }) as { excerpt: string; cut: boolean };
  assert.equal(long.cut, true); assert.equal([...long.excerpt].length, EVENT_REVIEW_EXCERPT); assert.ok(long.excerpt.startsWith("first line second line é"));
  // A family emoji is one letter: it is never cut in half.
  const family = "👨‍👩‍👧‍👦";
  const emoji = eventReviewTargetOf({ ...posts.items[0], text: family.repeat(EVENT_REVIEW_EXCERPT + 1) }) as { excerpt: string; cut: boolean };
  assert.equal(emoji.excerpt, family.repeat(EVENT_REVIEW_EXCERPT)); assert.equal(emoji.cut, true);
  assert.deepEqual(eventReviewTargetOf({ ...posts.items[0], text: "" }), { kind: "wall_post", id: posts.items[0].id, reply: false, author_uid: posts.items[0].author_uid, excerpt: "", cut: false });
});

test("a request is made from the selection, sent once, and what it was made from stays as it is until it is settled", () => {
  const { row, chosen, request, state } = sent("  Proactive safety check ");
  assert.deepEqual(request, { activity_id: activity, kind: "wall_post", target_id: row.id, reason: "Proactive safety check", break_glass: false, idempotency_key: KEY });
  assert.deepEqual(state.command, { status: "sending", request, attempts: 1 }); assert.equal(state.command.status === "sending" && state.command.request, request);
  // No reason, no request; and nothing is sent twice.
  for (const reason of ["", "ab", "  a  ", "x".repeat(1001)]) {
    assert.equal(eventReviewReasonValid(reason), false); assert.equal(eventReviewRequest(run(chosen, { type: "reasonTyped", value: reason }), KEY), null);
  }
  assert.equal(eventReviewRequest(listed(), KEY), null, "nothing is selected");
  assert.equal(eventReviewRequest(state, "content:another"), null, "a request on its way is not made again");
  assert.equal(run(state, { type: "reviewStarted", request: { ...request } }), state);
  // A request that is not of the selection is not this form's.
  assert.equal(run(chosen, { type: "reviewStarted", request: { ...request, target_id: posts.items[1].id } }), chosen);
  // Held: the list, the scope, the selection and the reason cannot change under a request.
  assert.equal(eventContentHeld(state), true);
  for (const action of [{ type: "listChosen", kind: "message", postId: "" }, { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } },
    { type: "targetChosen", target: eventReviewTargetOf(posts.items[1]) }, { type: "reasonTyped", value: "another reason" }, { type: "targetDropped" }, { type: "moreAsked" },
    { type: "refreshed" }] as EventContentPanelAction[]) assert.equal(run(state, action), state, action.type);
  // An answer to another request is not this one's.
  assert.equal(run(state, { type: "reviewAnswered", request: { ...request }, response: receipt }), state);
  // Break-glass that is applied goes with the request.
  const urgent = run(listed(), { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } });
  const reread = run(urgent, { type: "readAnswered", ticket: urgent.ticket, response: posts }, { type: "targetChosen", target: eventReviewTargetOf(row) }, { type: "reasonTyped", value: "Checked under break-glass" });
  assert.equal(eventReviewRequest(reread, KEY)?.break_glass, true);
});

test("Core's receipt ends the request and puts the case on the row", () => {
  const { row, request, state } = sent();
  const opened = run(state, { type: "reviewAnswered", request, response: receipt });
  assert.deepEqual(opened.command, { status: "idle" }); assert.deepEqual(opened.notice, { kind: "opened", case_id: receipt.case_id });
  assert.equal(opened.target, null); assert.equal(opened.reason, "");
  assert.equal(opened.page?.items.find((item) => item.id === row.id)?.case_id, receipt.case_id);
  assert.equal(opened.page?.items.filter((item) => item.case_id === receipt.case_id).length, 1);
});

test("a refusal settles a request and keeps the list; a refusal for who is asking takes the content off the screen", () => {
  const { row, request, state } = sent();
  for (const [status, error] of [[422, "dates-admin-reason-invalid"], [404, "dates-event-content-unavailable"], [422, "dates-event-content-invalid"]] as const) {
    const refused = run(state, { type: "reviewAnswered", request, response: core(status, error) });
    assert.deepEqual(refused.command, { status: "idle" }); assert.deepEqual(refused.notice, { kind: "refused", error });
    assert.equal(refused.page, state.page, `${error}: the list is not wiped`); assert.deepEqual(refused.read, { status: "ready" });
    assert.equal(refused.target?.id, row.id); assert.equal(refused.reason, "Proactive safety check", "the reason is still there to put right");
    // The next attempt is a new request under a new key.
    assert.equal(eventReviewRequest(refused, "content:second")?.idempotency_key, "content:second");
  }
  for (const [response, problem] of [[core(403, "dates-moderation-conflict"), { kind: "conflict" }],
    [{ success: false, status_code: 403, error: "dates-admin-capability-required" }, { kind: "forbidden", error: "dates-admin-capability-required" }]] as const) {
    const more = run(state, { type: "reviewAnswered", request, response });
    assert.deepEqual(more.command, { status: "idle" }); assert.equal(more.page, null); assert.equal(more.target, null);
    assert.deepEqual(more.read, { status: "failed", more: false, problem }, "not a blank panel: the problem is the state");
    assert.equal(more.notice?.kind, "refused");
  }
  // A next page that was on its way when access was refused does not bring rows back.
  const first = paged(), comment = comments.items.find((item: any) => item.can_review);
  const chosen = run(first, { type: "targetChosen", target: eventReviewTargetOf(comment) }, { type: "reasonTyped", value: "Checked the thread" }, { type: "moreAsked" });
  const asked = eventReviewRequest(chosen, KEY)!;
  const refused = run(chosen, { type: "reviewStarted", request: asked }, { type: "reviewAnswered", request: asked, response: core(403, "dates-moderation-conflict") });
  assert.equal(refused.page, null);
  const late = run(refused, { type: "readAnswered", ticket: chosen.ticket, response: lastPage([]) });
  assert.equal(late, refused); assert.equal(late.page, null);
  // The event as a whole needs no list. Refused for a conflict before the list was ever asked for, the problem is said -
  // and the list stays closed: neither the refusal nor the break-glass scope applied after it reads members' content.
  const whole = run(eventContentPanelInitial(activity), { type: "targetChosen", target: { kind: "activity", id: activity } }, { type: "reasonTyped", value: "The whole event" });
  const wholeRequest = eventReviewRequest(whole, KEY)!;
  assert.deepEqual(wholeRequest, { activity_id: activity, kind: "activity", target_id: activity, reason: "The whole event", break_glass: false, idempotency_key: KEY });
  const conflicted = run(whole, { type: "reviewStarted", request: wholeRequest }, { type: "reviewAnswered", request: wholeRequest, response: core(403, "dates-moderation-conflict") });
  assert.deepEqual(conflicted.read, { status: "failed", more: false, problem: { kind: "conflict" } }); assert.deepEqual(conflicted.target, { kind: "activity", id: activity });
  assert.equal(conflicted.shown, false); assert.equal(conflicted.page, null);
  for (const action of [{ type: "refreshed" }, { type: "moreAsked" }, { type: "listChosen", kind: "message", postId: "" }] as EventContentPanelAction[]) assert.equal(run(conflicted, action), conflicted, action.type);
  const cleared = run(conflicted, { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } });
  assert.equal(cleared.shown, false); assert.deepEqual(cleared.read, { status: "idle" }, "no read, and the refusal that is over is not shown any more");
  assert.equal(cleared.notice, null); assert.equal(cleared.reason, "The whole event");
  assert.equal(eventReviewRequest(cleared, "content:under-break-glass")?.break_glass, true, "the next request goes under the scope");
  assert.deepEqual(run(cleared, { type: "shown" }).read, { status: "loading", more: false }, "the list is still there to ask for");
});

test("a request in doubt goes out again as the very same object, and any answer to it settles it - there is no dead end", () => {
  const { row, request, state } = sent();
  for (const [response, error] of [[null, null], [{ success: false, status_code: 502, error: "admin-request-outcome-unknown" }, null],
    [{ success: false, status_code: 504, error: "core-timeout" }, "core-timeout"], [core(503, "dates-admin-unavailable"), "dates-admin-unavailable"],
    [core(409, "dates-admin-command-in-progress"), "dates-admin-command-in-progress"], [{ success: false, status_code: 503, error: "admin-membership-unconfirmed" }, "admin-membership-unconfirmed"]] as const) {
    const doubt = run(state, { type: "reviewAnswered", request, response });
    assert.deepEqual(doubt.command, { status: "doubt", request, attempts: 1, error }, String(error));
    assert.equal(doubt.page, state.page, "the list is not wiped"); assert.equal(doubt.target?.id, row.id);
  }
  const doubt = run(state, { type: "reviewAnswered", request, response: null });
  // The same request, key and reason - whatever key is offered, and whatever was typed or applied since (nothing can be).
  const again = eventReviewRequest(doubt, "content:a-second-key");
  assert.equal(again, request, "the very object that was sent"); assert.equal(again?.idempotency_key, KEY);
  assert.equal(run(doubt, { type: "reasonTyped", value: "changed" }).reason, "Proactive safety check");
  assert.equal(run(doubt, { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } }), doubt);
  assert.equal(run(doubt, { type: "reviewStarted", request: { ...request, idempotency_key: "content:a-second-key" } }), doubt, "another request cannot take its place");
  const resent = run(doubt, { type: "reviewStarted", request: again! });
  assert.deepEqual(resent.command, { status: "sending", request, attempts: 2 });
  // The repeat is answered. Whatever the answer is - a receipt, or a refusal Core raises before it even looks the key up -
  // the request is over and the panel is free again. (Before, only a receipt ended it: every other answer left "retry".)
  assert.deepEqual(run(resent, { type: "reviewAnswered", request, response: { ...receipt, created: false, idempotency_replayed: true } }).notice, { kind: "opened", case_id: receipt.case_id });
  for (const [status, error] of [[404, "dates-event-content-unavailable"], [403, "dates-moderation-conflict"], [409, "dates-admin-idempotency-conflict"], [422, "dates-event-content-invalid"]] as const) {
    const settled = run(resent, { type: "reviewAnswered", request, response: core(status, error) });
    assert.deepEqual(settled.command, { status: "idle" }, error); assert.deepEqual(settled.notice, { kind: "refused", error }); assert.equal(eventContentHeld(settled), false);
    assert.notEqual(run(settled, { type: "listChosen", kind: "message", postId: "" }), settled, "the tabs work again");
  }
  // Still no answer: still in doubt, counted, and still the same request.
  const twice = run(resent, { type: "reviewAnswered", request, response: null });
  assert.deepEqual(twice.command, { status: "doubt", request, attempts: 2, error: null }); assert.equal(eventReviewRequest(twice, "content:third"), request);
});

test("while a request is in doubt the list can be read again; a case on the target's row settles it, and it can be set aside", () => {
  const { row, request, state } = sent();
  const doubt = run(state, { type: "reviewAnswered", request, response: null });
  const reading = run(doubt, { type: "refreshed" });
  assert.deepEqual(reading.read, { status: "loading", more: false }); assert.equal(reading.command, doubt.command, "the request is not touched by a read");
  assert.equal(reading.target?.id, row.id, "and its target is still named while the rows are away");
  // The attempt went through: the row has a case. The request is over, and the notice points at the case.
  const withCase = { ...posts, items: posts.items.map((item: any) => item.id === row.id ? { ...item, case_id: receipt.case_id } : item) };
  const found = run(reading, { type: "readAnswered", ticket: reading.ticket, response: withCase });
  assert.deepEqual(found.command, { status: "idle" }); assert.deepEqual(found.notice, { kind: "exists", case_id: receipt.case_id });
  assert.equal(found.target, null); assert.equal(found.reason, ""); assert.equal(eventContentHeld(found), false);
  // It did not: the row has none, the request is still in doubt and still the same.
  const none = run(reading, { type: "readAnswered", ticket: reading.ticket, response: posts });
  assert.equal(none.command, doubt.command); assert.equal(none.target?.id, row.id); assert.equal(eventReviewRequest(none, "content:x"), request);
  // The read failing changes nothing about the request either.
  const unread = run(reading, { type: "readAnswered", ticket: reading.ticket, response: core(503, "dates-admin-unavailable") });
  assert.equal(unread.command, doubt.command); assert.equal(unread.target?.id, row.id); assert.equal(unread.read.status, "failed");
  // Another row's case is not this request's.
  const other = { ...posts, items: posts.items.map((item: any) => item.id === posts.items[1].id ? { ...item, case_id: receipt.case_id } : item) };
  assert.equal(run(reading, { type: "readAnswered", ticket: reading.ticket, response: other }).command, doubt.command);
  // Set aside: the panel is free; the next request for the same row is a new one (Core answers it with the open case, if any).
  const aside = run(doubt, { type: "targetDropped" });
  assert.deepEqual(aside.command, { status: "idle" }); assert.equal(aside.target, null); assert.equal(aside.page, doubt.page);
  const anew = run(aside, { type: "targetChosen", target: eventReviewTargetOf(row) }, { type: "reasonTyped", value: "Second look" });
  assert.equal(eventReviewRequest(anew, "content:new-key")?.idempotency_key, "content:new-key");
  // Not while it is on its way.
  assert.equal(run(state, { type: "targetDropped" }), state);
});

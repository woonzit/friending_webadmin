import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { eventContentPage, eventContentReadProblem, eventContentReviewOutcome, eventContentReviewReceipt, normalizeEventContentBody, eventContentProxyAuthorized,
  type EventContentKind, type EventReviewRequest } from "../lib/datesEventContent.ts";
import { projectDatesAdminBody, projectDatesAdminResponse } from "../lib/datesAdminProjection.ts";
import { datesCommandOutcome } from "../lib/datesExternalAdmin.ts";
import { isAdminActionAllowed, adminActionAccess } from "../lib/adminActions.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";

const root = new URL("./fixtures/dates_event_content_wire/", import.meta.url);
const body = (name: string) => JSON.parse(readFileSync(new URL(name + ".json", root), "utf8"));
const sample = body("admin-wall-posts");
const activity = sample.activity_id;
const review = body("admin-wall-review");
const request: EventReviewRequest = { activity_id: activity, kind: "wall_post", target_id: review.target_id,
  reason: "Proactive safety check", break_glass: false, idempotency_key: "owned-command-1234567890" };

test("event content is read from source-bound genuine Core controller responses", () => {
  for (const entry of body("manifest").fixtures) {
    const bytes = readFileSync(new URL(entry.file, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.file);
  }
  for (const name of ["admin-wall-posts", "admin-wall-hidden", "admin-wall-comments", "admin-event-messages", "admin-event-reviews", "admin-comments-page"]) {
    const original = body(name);
    const projected = projectDatesAdminResponse("dates_event_content", original);
    assert.deepEqual(projected, original);
    assert.ok(eventContentPage(projected, activity, original.kind as EventContentKind), name);
  }
  assert.equal(eventContentPage(body("admin-comments-page"), activity, "wall_comment")?.items.length, 20);
  assert.ok(eventContentReviewReceipt(projectDatesAdminResponse("dates_event_content_review", review), request));
});

test("malformed, partial and foreign event inventories never become an empty list", () => {
  for (const field of ["success", "status_code", "message", "status", "can_send", "event_content_version", "activity_id", "kind", "items", "has_more", "next_cursor", "audit_id", "server_now"]) {
    const changed = structuredClone(sample); delete changed[field];
    assert.equal(eventContentPage(changed, activity, "wall_post"), null, field);
  }
  assert.equal(eventContentPage(sample, "act_" + "0".repeat(32), "wall_post"), null);
  assert.equal(eventContentPage(sample, activity, "wall_comment"), null);
  for (const [field, value] of [["author_uid", "102"], ["hide_count", -1], ["report_count", "1"], ["has_media", 1], ["can_review", "true"], ["state", "other"], ["case_id", "bad"], ["root_id", "bad"], ["text", null]] as const) {
    const changed = structuredClone(sample); changed.items[0][field] = value;
    assert.equal(eventContentPage(changed, activity, "wall_post"), null, field);
  }
  const duplicate = structuredClone(sample); duplicate.items.push(duplicate.items[0]);
  assert.equal(eventContentPage(duplicate, activity, "wall_post"), null);
  const stale = structuredClone(sample); stale.items[0].state = "deleted";
  assert.equal(eventContentPage(stale, activity, "wall_post"), null, "deleted content must not carry text or authority");
  assert.equal(eventContentPage({ ...sample, has_more: true, next_cursor: "cursor" }, activity, "wall_post"), null, "incomplete pagination");
});

test("named projection strips private identity, coordinates and asset bytes, and names a leaked reporter or hider on the server log", () => {
  const extra = structuredClone(sample); extra.items[0].reporter_uids = [999]; extra.items[0].hider_uids = [998]; extra.items[1].hider_uids = [997];
  extra.items[0].location = { latitude: 1, longitude: 1 }; extra.items[0].asset = { data: "private" }; extra.secret = "forbidden";
  const lines: string[] = [];
  assert.deepEqual(projectDatesAdminBody("dates_event_content", extra, (line) => lines.push(line)), sample);
  // Who reported or hid is on the deny-list: dropped like any unnamed key, and reported by name and count - never by value.
  assert.deepEqual(lines.sort(), ["webadmin.dates_denied_key route=dates_event_content family=event-content key=items[].hider_uids count=2",
    "webadmin.dates_denied_key route=dates_event_content family=event-content key=items[].reporter_uids count=1"]);
  assert.doesNotMatch(lines.join("\n"), /99[789]/);
});

test("a list asked for one post's comments is that post's, and the hidden tab is wall content with the time of its newest hide", () => {
  const comments = body("admin-wall-comments"), post = comments.items[0].post_id as string;
  assert.ok(comments.items.every((row: any) => row.post_id === post), "the genuine list is one post's");
  assert.equal(eventContentPage(comments, activity, "wall_comment", post)?.items.length, comments.items.length);
  assert.equal(eventContentPage(comments, activity, "wall_comment", "wpo_" + "0".repeat(32)), null, "another post's comments are not the answer to this question");
  const foreign = structuredClone(comments); foreign.items[2].post_id = "wpo_" + "0".repeat(32);
  assert.equal(eventContentPage(foreign, activity, "wall_comment", post), null, "one row of another post fails the page");
  assert.ok(eventContentPage(foreign, activity, "wall_comment"), "unscoped, comments of several posts are one list");
  const orphan = structuredClone(comments); orphan.items.find((row: any) => row.state !== "deleted").post_id = null;
  assert.equal(eventContentPage(orphan, activity, "wall_comment"), null, "a comment that is still there belongs to a post");

  const hidden = body("admin-wall-hidden");
  assert.equal(eventContentPage(hidden, activity, "hidden")?.items[0].signal_at, hidden.items[0].signal_at);
  for (const [field, value] of [["signal_at", null], ["kind", "message"], ["kind", "review"]] as const) {
    const changed = structuredClone(hidden); changed.items[0][field] = value;
    if (field === "kind") changed.items[0].id = (value === "message" ? "msg_" : "rev_") + "0".repeat(32);
    assert.equal(eventContentPage(changed, activity, "hidden"), null, `${field}=${value}`);
  }
  // Only the hidden tab carries a hide time.
  const timed = structuredClone(sample); timed.items[0].signal_at = 1791559027;
  assert.equal(eventContentPage(timed, activity, "wall_post"), null);
});

test("a scalar is a scalar: a list of one never reads as its element, in a row or in a request", () => {
  // A projection leaf keeps a list of scalars, so the decoder is where `["deleted"]` has to stop.
  for (const [field, value] of [["state", ["deleted"]], ["state", ["active"]], ["content_kind", ["photo"]], ["kind", ["wall_post"]], ["id", [sample.items[0].id]],
    ["post_id", ["wpo_" + "0".repeat(32)]], ["case_id", ["cas_" + "0".repeat(32)]], ["author_uid", [102]], ["created_at", [1]], ["text", ["x"]]] as const) {
    const odd = structuredClone(sample); odd.items[0][field] = value;
    const projected = projectDatesAdminBody("dates_event_content", odd) as any;
    assert.deepEqual(projected.items[0][field], value, `${field}: the projection passes a list of scalars on`);
    assert.equal(eventContentPage(projected, activity, "wall_post"), null, `${field}=${JSON.stringify(value)}`);
  }
  assert.equal(eventContentPage({ ...sample, kind: ["wall_post"] }, activity, "wall_post"), null);
  for (const [field, value] of [["content_kind", "gif"], ["id", "wco_" + "0".repeat(32)], ["post_id", "wco_" + "0".repeat(32)], ["created_at", -1], ["created_at", 1.5], ["signal_at", "1"]] as const) {
    const changed = structuredClone(sample); changed.items[0][field] = value;
    assert.equal(eventContentPage(changed, activity, "wall_post"), null, `${field}=${value}`);
  }
  const page = body("admin-comments-page");
  assert.equal(eventContentPage({ ...page, items: [...page.items, { ...page.items[0], id: "wco_" + "0".repeat(32) }] }, activity, "wall_comment"), null, "more rows than a page");
  assert.equal(eventContentPage({ ...page, has_more: false }, activity, "wall_comment"), null, "a last page carries no cursor");
  assert.equal(eventContentPage({ ...page, has_more: "true" }, activity, "wall_comment"), null);

  for (const kind of [["wall_post"], ["activity"]]) assert.equal(normalizeEventContentBody("dates_event_content_review", { ...request, kind } as any), null, JSON.stringify(kind));
  assert.equal(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: ["hidden"] } as any), null);
  assert.equal(normalizeEventContentBody("dates_event_content_review", { ...request, target_id: [request.target_id] } as any), null);
  assert.equal(normalizeEventContentBody("dates_event_content", { activity_id: [activity], kind: "hidden" } as any), null);
});

test("a read that is not a page says what it was instead", () => {
  const core = (status_code: number, error: string) => ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 });
  const bridge = (status_code: number, error: string) => ({ success: false, status_code, error });
  assert.deepEqual(eventContentReadProblem(core(403, "dates-moderation-conflict")), { kind: "conflict" });
  assert.deepEqual(eventContentReadProblem(bridge(403, "dates-admin-capability-required")), { kind: "forbidden", error: "dates-admin-capability-required" });
  assert.deepEqual(eventContentReadProblem(core(404, "dates-event-content-unavailable")), { kind: "not-found" });
  assert.deepEqual(eventContentReadProblem(bridge(503, "admin-membership-unconfirmed")), { kind: "unconfirmed" });
  assert.deepEqual(eventContentReadProblem(core(422, "dates-event-content-invalid")), { kind: "refused", error: "dates-event-content-invalid" });
  assert.deepEqual(eventContentReadProblem(bridge(504, "core-timeout")), { kind: "unavailable", error: "core-timeout" });
  assert.deepEqual(eventContentReadProblem(core(503, "dates-admin-unavailable")), { kind: "unavailable", error: "dates-admin-unavailable" });
  assert.deepEqual(eventContentReadProblem(null), { kind: "unavailable", error: null });
  // A success this console cannot verify, and an envelope that is neither Core's nor the bridge's.
  assert.deepEqual(eventContentReadProblem({ ...sample, items: "none" }), { kind: "malformed" });
  assert.deepEqual(eventContentReadProblem({ success: false, status_code: 403, error: "dates-moderation-conflict", message: 200 }), { kind: "malformed" });
});

test("review receipts bind activity, content type and exact target; an unknown answer keeps the command", () => {
  for (const field of ["case_id", "audit_id", "created", "idempotency_replayed", "event_content_version", "kind", "target_id", "activity_id"]) {
    const changed = structuredClone(review); delete changed[field];
    assert.equal(eventContentReviewReceipt(changed, request), null, field);
    assert.equal(datesCommandOutcome(changed, false, "kept").kind, "uncertain");
  }
  assert.equal(eventContentReviewReceipt(review, { ...request, target_id: "wpo_" + "0".repeat(32) }), null);
  assert.equal(datesCommandOutcome(null, false, "kept").kind, "uncertain");
  for (const field of ["created", "idempotency_replayed", "case_id"]) {
    assert.equal(eventContentReviewReceipt({ ...review, [field]: [review[field]] }, request), null, `${field} as a list`);
  }
});

test("any answer to a request for a case settles it, the first time and on a repeat alike; only silence, a failure and 'still running' leave it in doubt", () => {
  const core = (status_code: number, error: string) => ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 });
  assert.deepEqual(eventContentReviewOutcome(review, request), { kind: "opened", case_id: review.case_id, created: true });
  assert.deepEqual(eventContentReviewOutcome({ ...review, created: false, idempotency_replayed: true }, request), { kind: "opened", case_id: review.case_id, created: false });
  // Refusals Core raises before it looks the key up: the general rule of a kept command (datesCommandOutcome, "kept") never
  // settles on them, which left the panel with nothing but the same refusal again. Core reuses the target's open case, so
  // releasing the key cannot open a second one.
  for (const [status, error, problem] of [[404, "dates-event-content-unavailable", { kind: "not-found" }], [422, "dates-event-content-invalid", { kind: "refused", error: "dates-event-content-invalid" }],
    [403, "dates-moderation-conflict", { kind: "conflict" }], [422, "dates-admin-reason-invalid", { kind: "refused", error: "dates-admin-reason-invalid" }],
    [409, "dates-admin-idempotency-conflict", { kind: "refused", error: "dates-admin-idempotency-conflict" }]] as const) {
    assert.equal(datesCommandOutcome(core(status, error), false, "kept").kind, error === "dates-admin-reason-invalid" ? "refused" : "uncertain", `${error}: the general rule`);
    assert.deepEqual(eventContentReviewOutcome(core(status, error), request), { kind: "refused", error, problem }, error);
  }
  assert.deepEqual(eventContentReviewOutcome({ success: false, status_code: 403, error: "dates-admin-capability-required" }, request),
    { kind: "refused", error: "dates-admin-capability-required", problem: { kind: "forbidden", error: "dates-admin-capability-required" } });
  // In doubt, with what was answered ...
  assert.deepEqual(eventContentReviewOutcome(core(409, "dates-admin-command-in-progress"), request), { kind: "doubt", error: "dates-admin-command-in-progress" });
  assert.deepEqual(eventContentReviewOutcome(core(503, "dates-admin-unavailable"), request), { kind: "doubt", error: "dates-admin-unavailable" });
  assert.deepEqual(eventContentReviewOutcome({ success: false, status_code: 504, error: "core-timeout" }, request), { kind: "doubt", error: "core-timeout" });
  assert.deepEqual(eventContentReviewOutcome({ success: false, status_code: 503, error: "admin-membership-unconfirmed" }, request), { kind: "doubt", error: "admin-membership-unconfirmed" });
  // ... and with no answer: nothing came back, the client's own "the answer was lost", a success that is not this request's receipt.
  assert.deepEqual(eventContentReviewOutcome(null, request), { kind: "doubt", error: null });
  assert.deepEqual(eventContentReviewOutcome({ success: false, status_code: 502, error: "admin-request-outcome-unknown" }, request), { kind: "doubt", error: null });
  assert.deepEqual(eventContentReviewOutcome({ ...review, target_id: "wpo_" + "0".repeat(32) }, request), { kind: "doubt", error: null });
});

test("proxy admits only closed event-scoped requests and fresh evidence/claim capabilities", () => {
  assert.deepEqual(normalizeEventContentBody("dates_event_content_review", request), request);
  assert.ok(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: "hidden" }));
  for (const changed of [{ ...request, admin_email: "spoof@example.test" }, { ...request, secret: "spoof" }, { ...request, target_id: "bad" },
    { ...request, kind: "activity" }, { ...request, reason: "" }, { ...request, break_glass: "true" }, { ...request, idempotency_key: "short" }]) {
    assert.equal(normalizeEventContentBody("dates_event_content_review", changed), null);
  }
  assert.equal(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: "hidden", cursor: "" }), null);
  assert.equal(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: "wall_post", post_id: request.target_id }), null);
  assert.ok(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: "wall_comment", post_id: request.target_id, cursor: "c".repeat(4096) }));
  for (const changed of [{ kind: "wall_comment", cursor: "c".repeat(4097) }, { kind: "wall_comment", post_id: "wco_" + "0".repeat(32) }, { kind: "activity" }, { kind: "wall_post", target_id: request.target_id },
    { kind: "wall_post", break_glass: true }, { kind: "wall_post", break_glass: true, reason: "  a " }, { kind: "wall_post", reason: "ab" }, { kind: "wall_post", admin_email: "spoof@example.test" }]) {
    assert.equal(normalizeEventContentBody("dates_event_content", { activity_id: activity, ...changed }), null, JSON.stringify(changed));
  }
  assert.ok(normalizeEventContentBody("dates_event_content", { activity_id: activity, kind: "wall_post", break_glass: true, reason: "Conflict reviewed with the duty lead" }));
  // "The event" is this event: a case for the whole of another event is not asked for from this one.
  const whole = { ...request, kind: "activity", target_id: activity };
  assert.deepEqual(normalizeEventContentBody("dates_event_content_review", whole), whole);
  assert.equal(normalizeEventContentBody("dates_event_content_review", { ...whole, target_id: "act_" + "0".repeat(32) }), null);
  for (const changed of [{ ...request, kind: "hidden" }, { ...request, reason: "   " }, { ...request, cursor: "c" }, { ...request, post_id: request.target_id }]) {
    assert.equal(normalizeEventContentBody("dates_event_content_review", changed), null, JSON.stringify(changed));
  }
  const { reason: _reason, ...unreasoned } = request;
  assert.equal(normalizeEventContentBody("dates_event_content_review", unreasoned), null);
  const member = (caps: string[]) => ({ success: true, dates: { email: "operator@example.test", role: "moderator", rank: 20,
    linked_uid: null, sensitive_location: false, break_glass: false, capabilities: caps } });
  assert.equal(eventContentProxyAuthorized("dates_event_content", member([])), false);
  assert.equal(eventContentProxyAuthorized("dates_event_content", member(["dates_evidence_read"])), true);
  assert.equal(eventContentProxyAuthorized("dates_event_content_review", member(["dates_evidence_read"])), false);
  assert.equal(eventContentProxyAuthorized("dates_event_content_review", member(["dates_evidence_read", "dates_case_claim"])), true);
  assert.equal(eventContentProxyAuthorized("dates_event_content", null), false);
  assert.equal(eventContentProxyAuthorized("unrelated", null), null);
  assert.equal(isAdminActionAllowed("dates_event_content"), true);
  assert.equal(isAdminActionAllowed("dates_event_content_review"), true);
  assert.equal(adminActionAccess("dates_event_content_review"), "dates_write");
  assert.equal(isAdminClientReadAction("dates_event_content"), true);
  assert.equal(isAdminClientReadAction("dates_event_content_review"), false);
});

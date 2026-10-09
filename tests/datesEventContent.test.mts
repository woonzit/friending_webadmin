import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { eventContentPage, eventContentReviewReceipt, normalizeEventContentBody, eventContentProxyAuthorized,
  type EventContentKind, type EventReviewRequest } from "../lib/datesEventContent.ts";
import { projectDatesAdminResponse } from "../lib/datesAdminProjection.ts";
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

test("named projection strips private identity, coordinates and asset bytes", () => {
  const extra = structuredClone(sample); extra.items[0].reporter_uids = [999]; extra.items[0].hider_uids = [998];
  extra.items[0].location = { latitude: 1, longitude: 1 }; extra.items[0].asset = { data: "private" }; extra.secret = "forbidden";
  assert.deepEqual(projectDatesAdminResponse("dates_event_content", extra), sample);
});

test("review receipts bind activity, content type and exact target; an unknown answer keeps the command", () => {
  for (const field of ["case_id", "audit_id", "created", "idempotency_replayed", "event_content_version", "kind", "target_id", "activity_id"]) {
    const changed = structuredClone(review); delete changed[field];
    assert.equal(eventContentReviewReceipt(changed, request), null, field);
    assert.equal(datesCommandOutcome(changed, false, "kept").kind, "uncertain");
  }
  assert.equal(eventContentReviewReceipt(review, { ...request, target_id: "wpo_" + "0".repeat(32) }), null);
  assert.equal(datesCommandOutcome(null, false, "kept").kind, "uncertain");
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

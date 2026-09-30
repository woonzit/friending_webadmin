import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DATES_EXTERNAL_ACTIONS, datesExternalProxyCapabilityAuthorized, decodeDatesExternalDetail,
  decodeDatesExternalList, normalizeDatesExternalProxyBody,
  decodeDatesExternalReceipt, datesExternalRefusal, type DatesExternalMutationBaseline,
  decodeDatesActivityList, decodeDatesActivityOriginDetail,
} from "../lib/datesExternalAdmin.ts";
import { datesExternalTimeToInput, normalizeDatesExternalEditorInput, normalizeDatesExternalManualEvent } from "../lib/datesExternalInput.ts";
import { isAdminActionAllowed } from "../lib/adminActions.ts";

const now = Date.parse("2026-10-01T12:00:00Z") / 1000;
const externalId = "xev_" + "a".repeat(32);
const activityId = "act_" + "b".repeat(32);
const caps = ["dates_external_event_read", "dates_external_event_manage"];
const envelope = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now };
const local = (instant: number) => { const result = datesExternalTimeToInput(instant, "Europe/Budapest")!; return result.local + result.offset; };

// Synthetic shape/counterfactual controls. Genuine Core bodies will be pinned
// independently from the final provider corpus; these are not response evidence.
function sample() {
  const start = Date.parse("2026-11-10T18:00:00+01:00") / 1000, end = start + 3 * 3600;
  const input = {
    title: "Community concert", summary: { en: "A concert.", hu: "Egy koncert." }, category: "concert",
    sensitive: { flag: false, reason: null }, start_at: start, end_at: end, timezone: "Europe/Budapest",
    all_day: false, is_free: true, price_text: null, age_restriction: null,
    venue: { name: "Public square", formatted_address: "1 Example Street", latitude: 47.5, longitude: 19.04, city: "Budapest", country_code: "HU" },
    organizer: { name: "Community orchestra", website: "https://orchestra.example/" },
    links: { official_url: "https://orchestra.example/concert", ticket_url: null }, source_url: "https://events.example/concert",
    attendee_list: "visible", confirmations: { source: true, public_venue: true, timezone: true, content_safe: true },
  };
  const row = {
    external_event_id: externalId, activity_id: activityId, revision: 2, activity_revision: 5,
    status: "published", lifecycle: "active", moderation_state: "ok", soft_deleted: false,
    title: input.title, category: input.category, sensitive: false, start_at: start, end_at: end,
    start_local: local(start), end_local: local(end), timezone: input.timezone, city: input.venue.city,
    country_code: "HU", venue_name: input.venue.name, organizer_name: input.organizer.name,
    verification_tier: "admin", checked_at: now - 60, next_reverify_at: now + 86400,
    credit_channel: "admin", going_count: 0, interested_count: 0, created_at: now - 100, updated_at: now - 60, can_edit: true,
  };
  const detail = {
    ...envelope, capabilities: [...caps], event: {
      ...row, facts: { title: input.title, summary: input.summary, category: input.category, sensitive: input.sensitive,
        start_at: start, end_at: end, start_local: local(start), end_local: local(end), end_estimated: false,
        all_day: false, timezone: input.timezone, is_free: true, price_text: null, age_restriction: null },
      venue: { place_id: null, name: input.venue.name, formatted_address: input.venue.formatted_address,
        point: { type: "Point", coordinates: [19.04, 47.5] }, city: "Budapest", city_key: "budapest", country_code: "HU", resolved_by: "admin_pin", resolved_at: now - 60 },
      organizer: input.organizer, links: input.links, attendee_list: "visible",
      verification: { tier: "admin", checked_at: now - 60, next_reverify_at: now + 86400, admin_confirmations: input.confirmations },
      image: { kind: "category_art", url: null, credit: null, license_note: null },
      credit: { channel: "admin", submitted_by_uid: null, anonymous: true, first_submitter_uid: null },
      sources: [{ source_id: "src_" + "c".repeat(32), kind: "admin", url: input.source_url, hostname: "events.example", confirmed_at: now - 60 }],
      ai_assisted: false, editor_input: { ...input, confirmations: { source: false, public_venue: false, timezone: false, content_safe: false } },
    },
  };
  return { input, row, detail, list: { ...envelope, capabilities: [...caps], events: [row], page: 1, limit: 40, total: 1 } };
}

test("strict external reads accept populated and empty pages and distinguish ledger/activity revisions", () => {
  const { list, detail } = sample();
  assert.ok(decodeDatesExternalList(list, { page: 1, limit: 40 }));
  assert.ok(decodeDatesExternalList({ ...list, total: 0, events: [] }, { page: 1, limit: 40 }));
  assert.ok(decodeDatesExternalDetail(detail, externalId));
  assert.equal(decodeDatesExternalDetail(detail, externalId)?.event.revision, 2);
  assert.equal(decodeDatesExternalDetail(detail, externalId)?.event.activity_revision, 5);
  assert.equal(decodeDatesExternalList({ success: true, events: [] }, { page: 1, limit: 40 }), null);
});

test("every required list row key is checked and unknown keys do not become trusted material", () => {
  for (const key of Object.keys(sample().row)) {
    const value: any = sample().list; delete value.events[0][key];
    assert.equal(decodeDatesExternalList(value, { page: 1, limit: 40 }), null, key);
  }
  const value: any = sample().list; value.events[0].host = { uid: 0 };
  assert.equal(decodeDatesExternalList(value, { page: 1, limit: 40 }), null);
});

test("list refuses envelope, pagination, duplicate, ordering and loosely typed success defects", () => {
  const mutations: Array<(v: any) => void> = [
    (v) => { v.status = "published"; }, (v) => { v.data = {}; }, (v) => { v.message = "200"; },
    (v) => { v.events[0].going_count = "0"; }, (v) => { v.events[0].interested_count = -1; },
    (v) => { v.events[0].can_edit = "true"; }, (v) => { v.events[0].start_at *= 1000; },
    (v) => { v.events[0].start_local = "2026-11-10T18:00:00+02:00"; },
    (v) => { v.events[0].credit_channel = "browser"; }, (v) => { v.capabilities = []; },
    (v) => { v.capabilities.push(v.capabilities[0]); }, (v) => { v.total = -1; },
    (v) => { v.events.push(v.events[0]); v.total = 2; }, (v) => { v.page = 2; },
  ];
  for (const mutate of mutations) { const value = sample().list; mutate(value); assert.equal(decodeDatesExternalList(value, { page: 1, limit: 40 }), null); }
  const value = sample().list;
  value.events.push({ ...value.events[0], external_event_id: "xev_" + "0".repeat(32), activity_id: "act_" + "d".repeat(32) }); value.total = 2;
  assert.equal(decodeDatesExternalList(value, { page: 1, limit: 40 }), null, "equal timestamps require ascending ID");
  value.events.reverse(); assert.ok(decodeDatesExternalList(value, { page: 1, limit: 40 }));
  assert.ok(decodeDatesExternalList({ ...sample().list, total: 0 }, { page: 1, limit: 40 }), "separate count may observe a later purge");
  assert.ok(decodeDatesExternalList({ ...sample().list, events: [] }, { page: 1, limit: 40 }), "separate count may observe a later publication");
});

test("support-viewer rows remain read-only; a forged edit flag fails closed", () => {
  const value = sample().list;
  value.capabilities = ["dates_external_event_read"];
  assert.equal(decodeDatesExternalList(value, { page: 1, limit: 40 }), null);
  value.events[0].can_edit = false;
  assert.ok(decodeDatesExternalList(value, { page: 1, limit: 40 }));
});

test("detail binds all editor facts to the projected event and never reuses historical confirmations", () => {
  const mutations: Array<(v: any) => void> = [
    (v) => { v.event.external_event_id = "xev_" + "d".repeat(32); },
    (v) => { v.event.editor_input.title = "Another title"; },
    (v) => { v.event.editor_input.confirmations.source = true; },
    (v) => { v.event.editor_input.venue.longitude = 20; },
    (v) => { v.event.venue.point.coordinates.reverse(); },
    (v) => { v.event.facts.end_estimated = "false"; },
    (v) => { v.event.sources = []; }, (v) => { v.event.sources[0].hostname = "trusted.example"; },
    (v) => { v.event.sources.push(v.event.sources[0]); },
    (v) => { v.event.verification.checked_at -= 1; }, (v) => { v.event.image.kind = "flyer"; },
    (v) => { v.event.ai_assisted = true; }, (v) => { v.event._id = "internal"; },
    (v) => { v.event.credit.submitted_by_uid = 12; }, (v) => { v.event.credit.anonymous = false; },
  ];
  for (const mutate of mutations) { const value = sample().detail; mutate(value); assert.equal(decodeDatesExternalDetail(value, externalId), null); }
  const { input, detail } = sample();
  assert.ok(normalizeDatesExternalManualEvent(input));
  assert.equal(normalizeDatesExternalManualEvent(detail.event.editor_input), null);
  assert.ok(normalizeDatesExternalEditorInput(detail.event.editor_input));
  assert.equal(normalizeDatesExternalEditorInput(input), null);
});

test("only actual routes are allow-listed and explicit fresh capabilities authorize the proxy", () => {
  for (const action of DATES_EXTERNAL_ACTIONS) assert.equal(isAdminActionAllowed(action), true);
  for (const action of ["dates_external_event_republish", "dates_external_event_draft", "dates_external_raw_query", "dates_external_event_List"])
    assert.equal(isAdminActionAllowed(action), false);
  const principal = { success: true, dates: { email: "operator@example.test", role: "administrator", rank: 40,
    linked_uid: null, sensitive_location: false, break_glass: false, capabilities: [...caps] } };
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_publish", principal), true);
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_list", principal), true);
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_publish", { success: true, role: "owner" }), false);
  principal.dates.capabilities = ["dates_external_event_read"];
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_publish", principal), false);
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_list", principal), true);
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_configuration", principal), undefined);
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /datesExternalProxyCapabilityAuthorized\(action, membership\.data\)/);
  assert.match(route, /normalizeDatesExternalProxyBody\(action, body\)/);
});

test("proxy payloads remain closed, bounded and uncoerced", () => {
  const payload = { event: sample().input, reason: "Checked source", idempotency_key: "external-publish:00000000-0000-4000-8000-000000000001" };
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", payload), payload);
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", { ...payload, admin_email: "other@example.test" }), null);
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", { ...payload, event: JSON.stringify(payload.event) }), null);
  const update = { ...payload, external_event_id: externalId, expected_revision: 2 };
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_update", update), update);
  for (const revision of [true, 1.5, "02", " 2", "2.0", 0, -1])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_update", { ...update, expected_revision: revision }), null);
  for (const filter of [{ status: "all" }, { tier: "admin_verified" }, { query: "bad\nquery" }, { limit: 101 },
    { page: "01" }, { start_from: "0" }, { start_from: 3, start_to: 2 }, { sort: "browser" }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_list", filter), null, JSON.stringify(filter));
  assert.deepEqual(normalizeDatesExternalProxyBody("dates_external_event_list", { status: "", page: 1, limit: 40 }), { status: "", page: 1, limit: 40 });
});

test("estimated end remains absent in the editor while computed facts retain the category duration", () => {
  const value: any = sample().detail;
  value.event.facts.end_estimated = true;
  assert.equal(decodeDatesExternalDetail(value, externalId), null);
  value.event.editor_input.end_at = null;
  assert.ok(decodeDatesExternalDetail(value, externalId));
  value.event.facts.end_at += 60; value.event.end_at += 60;
  value.event.end_local = local(value.event.end_at); value.event.facts.end_local = value.event.end_local;
  assert.equal(decodeDatesExternalDetail(value, externalId), null);
});

test("command requests cannot smuggle fields, skip reverify attestations or send unbounded updates", () => {
  const base = { external_event_id: externalId, expected_revision: 2, reason: "Checked source", idempotency_key: "external-command:000000000000001" };
  for (const action of ["withdraw", "cancel"]) {
    assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...base, action }));
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...base, action, text: "Hidden update" }), null);
  }
  const reverify = { ...base, action: "reverify", confirmations: sample().input.confirmations };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", reverify));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...reverify, confirmations: { ...reverify.confirmations, source: false } }), null);
  for (const text of ["", " ", "x".repeat(501), "bad\u0085update", "bad\u0000update"])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...base, action: "official_update", text }), null);
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...base, action: "official_update", text: "👨‍👩‍👧‍👦".repeat(500) }));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...base, action: "republish" }), null);
});

test("receipts bind action, both identities and ledger CAS without confusing the legacy status field", () => {
  const baseline: DatesExternalMutationBaseline = { external_event_id: externalId, activity_id: activityId, revision: 2,
    activity_revision: 5, status: "published", lifecycle: "active", soft_deleted: false };
  const body = { external_event_id: externalId, expected_revision: 2 };
  const receipt = { ...envelope, external_event_id: externalId, activity_id: activityId, revision: 3, activity_revision: 7,
    event_status: "published", audit_id: "aud_" + "d".repeat(32), replayed: false };
  assert.ok(decodeDatesExternalReceipt(receipt, "dates_external_event_update", body, baseline));
  for (const change of [{ status: "published" }, { event_status: undefined }, { activity_id: "act_" + "e".repeat(32) },
    { revision: 4 }, { activity_revision: 5 }, { replayed: "false" }, { private: "extra" }])
    assert.equal(decodeDatesExternalReceipt({ ...receipt, ...change }, "dates_external_event_update", body, baseline), null);
  const publish = { ...receipt, revision: 1, activity_revision: 1 };
  assert.ok(decodeDatesExternalReceipt(publish, "dates_external_event_publish", {}, null));
  assert.equal(decodeDatesExternalReceipt(publish, "dates_external_event_publish", {}, baseline), null);
  for (const action of ["withdraw", "cancel", "reverify", "official_update"]) {
    const value: any = { ...receipt, action, lifecycle: ["withdraw", "cancel"].includes(action) ? "canceled" : "active", soft_deleted: false,
      event_status: action === "withdraw" ? "withdrawn" : action === "cancel" ? "canceled_upstream" : "published" };
    if (action === "official_update") Object.assign(value, { thread_id: "thr_" + "1".repeat(32), message_id: "msg_" + "2".repeat(32), message_sequence: 1 });
    assert.ok(decodeDatesExternalReceipt(value, "dates_external_event_command", { ...body, action }, baseline), action);
    assert.equal(decodeDatesExternalReceipt(value, "dates_external_event_update", body, baseline), null);
    value.soft_deleted = true;
    assert.equal(decodeDatesExternalReceipt(value, "dates_external_event_command", { ...body, action }, baseline), null);
  }
});

test("only exact pinned no-land refusals permit retiring a mutation identity", () => {
  const refusal = { success: false, status_code: 409, error: "dates-external-duplicate", message: 200, status: 200, can_send: 0 };
  assert.equal(datesExternalRefusal(refusal).kind, "refused");
  for (const value of [null, { ...refusal, status: "409" }, { ...refusal, extra: true }, { ...refusal, status_code: "409" },
    { success: false, status_code: 409, error: refusal.error }, { ...refusal, error: "dates-admin-idempotency-conflict" },
    { ...refusal, error: "dates-admin-command-in-progress" }, { ...refusal, status_code: 503, error: "dates-external-storage-unavailable" },
    { ...refusal, status_code: 403, error: "dates-admin-capability-required" }])
    assert.equal(datesExternalRefusal(value).kind, "uncertain");
});

function activitySample() {
  const { row, detail } = sample();
  const activity = { activity_id: activityId, title: row.title, activity_type: "hangout", host: null, lifecycle: row.lifecycle,
    moderation_state: row.moderation_state, pending_public_moderation_state: null, time_mode: "scheduled", start_at: row.start_at,
    end_at: row.end_at, location_mode: "exact", city: row.city, country_code: row.country_code, join_mode: "auto", maximum_people: null,
    going_count: row.going_count, pending_count: 0, report_count: 0, soft_deleted: false, revision: row.activity_revision,
    created_at: row.created_at, updated_at: row.updated_at, origin: "external", external_event_id: externalId,
    organizer_name: row.organizer_name, organizer_url: detail.event.organizer.website, verification_tier: row.verification_tier,
    ai_assisted: false, can_host_transfer: false };
  const extras = { details: "A concert.", photo: null, timezone: row.timezone, auto_end_at: null, tbd_expires_at: null,
    audience: null, pending_public_revision: null, live_sharing_state: "off", purge_eligible_at: null };
  return { activity, list: { ...envelope, activities: [activity], page: 1, limit: 40, total: 1 },
    detail: { ...envelope, activity: { ...activity, ...extras }, external_event: detail.event } };
}

test("activity list discriminates real hostless external rows from unchanged member keysets", () => {
  assert.ok(decodeDatesActivityList(activitySample().list, { page: 1, limit: 40 }));
  for (const key of ["origin", "external_event_id", "organizer_name", "organizer_url", "verification_tier", "ai_assisted", "can_host_transfer"]) {
    const value: any = activitySample().list; delete value.activities[0][key];
    assert.equal(decodeDatesActivityList(value, { page: 1, limit: 40 }), null, key);
  }
  for (const change of [{ host: { uid: 0, display_name: "System" } }, { host: { uid: 12, display_name: "Member" } },
    { maximum_people: 100 }, { origin: ["external"] }, { ai_assisted: true }, { can_host_transfer: true }, { pending_count: 1 }, { start_at: null }]) {
    const value = activitySample().list; Object.assign(value.activities[0], change);
    assert.equal(decodeDatesActivityList(value, { page: 1, limit: 40 }), null);
  }
  const member: any = activitySample().list;
  for (const key of ["origin", "external_event_id", "organizer_name", "organizer_url", "verification_tier", "ai_assisted", "can_host_transfer"]) delete member.activities[0][key];
  member.activities[0].host = { uid: 12, display_name: "Member" }; member.activities[0].maximum_people = 4;
  assert.ok(decodeDatesActivityList(member, { page: 1, limit: 40 }));
  member.activities[0].host.uid = 0;
  assert.equal(decodeDatesActivityList(member, { page: 1, limit: 40 }), null);
});

test("activity detail binds ledger and activity identity, revision, facts and non-host controls", () => {
  assert.ok(decodeDatesActivityOriginDetail(activitySample().detail, activityId, caps));
  for (const mutate of [(value: any) => { value.external_event.activity_revision++; },
    (value: any) => { value.activity.title = "Different title"; }, (value: any) => { value.activity.organizer_name = "Other organizer"; },
    (value: any) => { delete value.external_event; }, (value: any) => { value.activity.live_sharing_state = "on"; },
    (value: any) => { value.external_event.credit.submitted_by_uid = 12; }, (value: any) => { value.activity.host = { uid: 0, display_name: "" }; }]) {
    const value = activitySample().detail; mutate(value); assert.equal(decodeDatesActivityOriginDetail(value, activityId, caps), null);
  }
  const source = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  for (const capability of ["dates_activity_edit", "dates_activity_command", "dates_host_transfer"])
    assert.match(source, new RegExp(`!isExternal && hasDatesCapability\\(principal, "${capability}"\\)`));
  assert.equal((source.match(/data\.activity\.host === null/g) ?? []).length, 4, "handlers as well as visible controls reject hostless generic writes");
});

test("external activity-command receipts keep activity CAS separate from ledger revision", () => {
  const baseline: DatesExternalMutationBaseline = { external_event_id: externalId, activity_id: activityId,
    revision: 2, activity_revision: 5, status: "published", lifecycle: "active", soft_deleted: false };
  const body = { activity_id: activityId, expected_revision: 5, action: "soft_delete" };
  const receipt = { ...envelope, activity_id: activityId, external_event_id: externalId, revision: 6, activity_revision: 6,
    external_revision: 3, event_status: "published", lifecycle: "active", soft_deleted: true, action: "soft_delete",
    audit_id: "aud_" + "d".repeat(32), idempotency_replayed: false };
  assert.ok(decodeDatesExternalReceipt(receipt, "dates_activity_command", body, baseline));
  for (const change of [{ revision: 3 }, { external_revision: 2 }, { activity_revision: 7 }, { soft_deleted: false }, { lifecycle: "canceled" }, { replayed: false }])
    assert.equal(decodeDatesExternalReceipt({ ...receipt, ...change }, "dates_activity_command", body, baseline), null);
  assert.equal(decodeDatesExternalReceipt(receipt, "dates_activity_command", { ...body, expected_revision: 2 }, baseline), null);
  const purged = { ...envelope, activity_id: activityId, external_event_id: externalId, revision: 5, activity_revision: 5, external_revision: 2,
    audit_id: receipt.audit_id, idempotency_replayed: true, purged: true };
  assert.ok(decodeDatesExternalReceipt(purged, "dates_activity_command", { ...body, action: "purge" }, { ...baseline, soft_deleted: true }));
});

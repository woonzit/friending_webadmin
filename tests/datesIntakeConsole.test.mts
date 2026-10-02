import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { readDatesExternalPending } from "../lib/datesExternalMutations.ts";
import { datesIntakeEditorDraft, projectDatesIntakeDetail } from "../lib/datesIntakeAdmin.ts";
import {
  createDatesIntakeSerial, createDatesIntakeSourceKey, datesIntakeOperator, datesIntakePendingPublish, datesIntakePollDelay, datesIntakeSourceProblem,
  prepareDatesIntakeReject, readDatesAiUsage, readDatesIntakeDetail, readDatesIntakeDraftEntry, readDatesIntakeQueue, runDatesIntakeLease,
  runDatesIntakePublish, runDatesIntakeReject, submitDatesIntakeSource,
} from "../lib/datesIntakeConsole.ts";

// The intake console's calls, run as they are against the genuine Core bodies
// of tests/fixtures/dates_event_intake_admin_wire. `send` stands in for the
// same-origin bridge; nothing here mounts a page or opens a socket.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const xin = (number: number) => "xin_" + number.toString(16).padStart(32, "0");
const ROLES = {
  support_viewer: ["dates_external_event_read"],
  moderator: ["dates_external_event_read", "dates_external_event_review"],
  administrator: ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage"],
  superadmin: ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage", "dates_activity_purge"],
};
const identity = (role: keyof typeof ROLES = "administrator", email = "admin@example.test") => ({ success: true, role: "admin",
  dates: { email, role, rank: 40, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: ROLES[role] } });
/** A bridge that answers each action from a table and records what was sent. */
function bridge(answers: Record<string, unknown>) {
  const sent: Array<{ action: string; body: Record<string, unknown> }> = [];
  const send = async (action: string, body: Record<string, unknown>) => {
    sent.push({ action, body });
    const answer = answers[action];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? (answer as (body: Record<string, unknown>) => unknown)(body) : answer;
  };
  return { send, sent };
}
function memoryStorage() {
  const rows = new Map<string, string>();
  return { rows, storage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } } };
}
const capabilityRefusal = { success: false, status_code: 403, error: "dates-admin-capability-required" };

test("operator affordances come from the fresh Dates identity, never from the global role", () => {
  assert.deepEqual({ ...datesIntakeOperator(identity("moderator"))!, principal: null }, { principal: null, review: true, manage: false, read: true, superadmin: false });
  assert.deepEqual({ ...datesIntakeOperator(identity("superadmin"))!, principal: null }, { principal: null, review: true, manage: true, read: true, superadmin: true });
  assert.equal(datesIntakeOperator({ success: true, role: "owner" }), null, "a global owner without a Dates block has no Dates capability");
  assert.equal(datesIntakeOperator(null), null);
});

test("queue read: ready, a confirmed capability loss, Core's own refusal and a failed read are four different answers", async () => {
  const filters = { status: "in_review", channel: "", page: 1, limit: 3 };
  const list = fixture("admin-list-in-review");
  const ready = await readDatesIntakeQueue(bridge({ dates_event_intake_list: list, admin_me: identity("moderator") }).send, { ...filters, limit: list.limit });
  assert.equal(ready.kind, "ready");
  assert.equal(ready.kind === "ready" && ready.queue.intakes.length, list.intakes.length);
  assert.equal(ready.kind === "ready" && ready.operator.manage, false);
  // The genuine viewer refusal, and the bridge's own capability refusal: both are a confirmed loss.
  for (const answer of [fixture("admin-list-viewer-denied"), capabilityRefusal])
    assert.deepEqual(await readDatesIntakeQueue(bridge({ dates_event_intake_list: answer, admin_me: identity("support_viewer") }).send, filters), { kind: "denied" });
  // A decodable queue for an operator whose fresh identity no longer carries the capability is a loss too.
  assert.deepEqual(await readDatesIntakeQueue(bridge({ dates_event_intake_list: list, admin_me: identity("support_viewer") }).send, { ...filters, limit: list.limit }), { kind: "denied" });
  // Core's genuine filter refusal is shown as what it is.
  assert.deepEqual(await readDatesIntakeQueue(bridge({ dates_event_intake_list: fixture("admin-list-filter-invalid-denied"), admin_me: identity() }).send, filters),
    { kind: "refused", error: "dates-intake-filter-invalid", status: 422 });
  // Nothing readable, a transport failure, an undecodable body or an unreadable identity: unconfirmed, never "no permission" and never empty.
  for (const answers of [{ dates_event_intake_list: null, admin_me: identity() }, { dates_event_intake_list: new Error("offline"), admin_me: identity() },
    { dates_event_intake_list: { success: true, intakes: [] }, admin_me: identity() }, { dates_event_intake_list: list, admin_me: null },
    { dates_event_intake_list: { success: false, status_code: 502, error: "core-unavailable" }, admin_me: identity() }])
    assert.deepEqual(await readDatesIntakeQueue(bridge(answers).send, { ...filters, limit: list.limit }), { kind: "unconfirmed" });
});

test("detail read carries the draft switch from the queue and keeps the four answers apart", async () => {
  const detail = fixture("admin-detail-in-review-official"), list = fixture("admin-list-empty");
  const h = bridge({ dates_event_intake_detail: detail, admin_me: identity(), dates_event_intake_list: { ...list, limit: 1 } });
  const ready = await readDatesIntakeDetail(h.send, xin(4));
  assert.equal(ready.kind, "ready");
  assert.equal(ready.kind === "ready" && ready.draftsEnabled, true);
  assert.deepEqual(h.sent.map((call) => [call.action, call.body]), [["dates_event_intake_detail", { intake_id: xin(4) }], ["admin_me", {}],
    ["dates_event_intake_list", { page: 1, limit: 1 }]]);
  // DERIVED: the same one-row queue with the switch off.
  const off = await readDatesIntakeDetail(bridge({ dates_event_intake_detail: detail, admin_me: identity(), dates_event_intake_list: { ...list, limit: 1, drafts_enabled: false } }).send, xin(4));
  assert.equal(off.kind === "ready" && off.draftsEnabled, false);
  // An unreadable queue leaves the switch unknown; it is not reported as off.
  const unknown = await readDatesIntakeDetail(bridge({ dates_event_intake_detail: detail, admin_me: identity(), dates_event_intake_list: null }).send, xin(4));
  assert.equal(unknown.kind === "ready" && unknown.draftsEnabled, null);
  assert.deepEqual(await readDatesIntakeDetail(bridge({ dates_event_intake_detail: fixture("admin-detail-not-found-denied"), admin_me: identity(), dates_event_intake_list: list }).send, xin(0xfff)),
    { kind: "refused", error: "dates-intake-unavailable", status: 404 });
  assert.deepEqual(await readDatesIntakeDetail(bridge({ dates_event_intake_detail: capabilityRefusal, admin_me: identity("support_viewer"), dates_event_intake_list: capabilityRefusal }).send, xin(4)), { kind: "denied" });
  // Another intake's body for this page, or nothing at all, is unconfirmed.
  assert.deepEqual(await readDatesIntakeDetail(bridge({ dates_event_intake_detail: detail, admin_me: identity(), dates_event_intake_list: list }).send, xin(5)), { kind: "unconfirmed" });
  const none = bridge({});
  assert.deepEqual(await readDatesIntakeDetail(none.send, "xin_../../users"), { kind: "unconfirmed" });
  assert.equal(none.sent.length, 0, "an identifier Core would refuse is never sent");
});

test("usage read needs only the read capability; the waiting-for-budget count is the reviewers' queue figure", async () => {
  const usage = fixture("admin-usage-month"), list = { ...fixture("admin-list-empty"), limit: 1 };
  const viewer = bridge({ dates_event_intake_usage: usage, admin_me: identity("support_viewer"), dates_event_intake_list: capabilityRefusal });
  const read = await readDatesAiUsage(viewer.send, null);
  assert.equal(read.kind, "ready");
  assert.equal(read.kind === "ready" && read.usage.usage.spent_micro_usd, 216588);
  assert.equal(read.kind === "ready" && read.awaitingBudget, null);
  assert.deepEqual(viewer.sent.map((call) => call.action), ["dates_event_intake_usage", "admin_me"], "a reader is not sent to a route it cannot use");
  assert.deepEqual(viewer.sent[0].body, {});
  // DERIVED: a queue count of three intakes waiting for budget.
  const waiting = { ...list, status_counts: { ...list.status_counts, awaiting_budget: 3 } };
  const reviewer = await readDatesAiUsage(bridge({ dates_event_intake_usage: fixture("admin-usage-earlier-month"), admin_me: identity("moderator"), dates_event_intake_list: waiting }).send, "2026-09");
  assert.equal(reviewer.kind === "ready" && reviewer.awaitingBudget, 3);
  assert.equal(reviewer.kind === "ready" && reviewer.usage.usage.month, "2026-09");
  // The answer for another month, Core's genuine filter refusal, and a month Core would refuse.
  assert.deepEqual(await readDatesAiUsage(bridge({ dates_event_intake_usage: usage, admin_me: identity() }).send, "2026-09"), { kind: "unconfirmed" });
  assert.deepEqual(await readDatesAiUsage(bridge({ dates_event_intake_usage: fixture("admin-usage-filter-invalid-denied"), admin_me: identity() }).send, "2026-10"),
    { kind: "refused", error: "dates-intake-filter-invalid", status: 422 });
  const none = bridge({});
  assert.deepEqual(await readDatesAiUsage(none.send, "October"), { kind: "unconfirmed" }); assert.equal(none.sent.length, 0);
});

test("\"Draft from source\" is offered only to a manager, and disabled with the reason while the switch is off", async () => {
  const usage = fixture("admin-usage-empty");
  assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: usage, admin_me: identity() }).send), { state: "available" });
  // DERIVED: Core's default, the switch off (every genuine usage body was captured with it on).
  assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: { ...usage, drafts_enabled: false }, admin_me: identity() }).send), { state: "disabled" });
  for (const role of ["moderator", "support_viewer"] as const)
    assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: usage, admin_me: identity(role) }).send), { state: "noCapability" });
  assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: null, admin_me: identity("moderator") }).send), { state: "noCapability" });
  // A failed read is not "off": the entry stays, and Core answers if the switch is off.
  assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: null, admin_me: identity() }).send), { state: "unknown" });
  assert.deepEqual(await readDatesIntakeDraftEntry(bridge({ dates_event_intake_usage: usage, admin_me: null }).send), { state: "unknown" });
});

for (const action of ["claim", "heartbeat", "release"] as const) test(`lease ${action}: the genuine receipt, the genuine refusals and a lost answer`, async () => {
  const receipt = fixture(`admin-lease-${action}`);
  const request = { intake_id: receipt.intake.intake_id, expected_revision: receipt.intake.revision - 1, action };
  const h = bridge({ dates_event_intake_lease: receipt });
  const done = await runDatesIntakeLease(h.send, request);
  assert.equal(done.kind, "success");
  assert.equal(done.kind === "success" && done.receipt.intake.revision, request.expected_revision + 1);
  assert.deepEqual(h.sent, [{ action: "dates_event_intake_lease", body: request }]);
  for (const name of ["lease-claimed", "lease-conflict", "lease-lost", "lease-owner-required", "lease-revision-invalid", "lease-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`);
    assert.deepEqual(await runDatesIntakeLease(bridge({ dates_event_intake_lease: refusal }).send, request),
      { kind: "refused", error: refusal.error, status: refusal.status_code, core: true });
  }
  assert.deepEqual(await runDatesIntakeLease(bridge({ dates_event_intake_lease: capabilityRefusal }).send, request),
    { kind: "refused", error: "dates-admin-capability-required", status: 403, core: false });
  // A receipt for another request, an unreadable body and a thrown transport are all "read the intake again".
  for (const answer of [fixture("admin-lease-release-idle"), null, { success: true }, new Error("offline")])
    assert.deepEqual(await runDatesIntakeLease(bridge({ dates_event_intake_lease: answer }).send, { ...request, expected_revision: 1 }), { kind: "uncertain" });
});

test("rejection: one identity per command, kept across a retry, and Core's genuine answers", async () => {
  const receipt = fixture("admin-reject-spam-or-fake");
  const target = { intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 };
  const command = prepareDatesIntakeReject(target, "spam_or_fake", "  The flyer advertises nothing that takes place.  ")!;
  assert.ok(command);
  assert.equal(command.reason, "The flyer advertises nothing that takes place.");
  assert.match(command.idempotency_key, /^dates-intake-reject:[0-9a-f-]{36}$/);
  assert.equal(command.expected_revision, target.revision);
  for (const [code, note, revision] of [["nonsense", "note", 5], ["duplicate", "", 5], ["duplicate", "   ", 5], ["duplicate", "x".repeat(1001), 5],
    ["duplicate", "note", null], ["duplicate", "note", 0]] as const) assert.equal(prepareDatesIntakeReject({ intake_id: target.intake_id, revision }, code, note), null);
  assert.equal(prepareDatesIntakeReject({ intake_id: "xin_1", revision: 5 }, "duplicate", "note"), null);
  // A one-character note is Core's to accept: it requires a note, not a length.
  assert.ok(prepareDatesIntakeReject(target, "duplicate", "x"));
  const lost = bridge({ dates_event_intake_reject: null });
  assert.deepEqual(await runDatesIntakeReject(lost.send, command), { kind: "uncertain" });
  // The retry is the same command, key included, and Core's replay settles it.
  const replay = bridge({ dates_event_intake_reject: { ...receipt, replayed: true } });
  const done = await runDatesIntakeReject(replay.send, command);
  assert.equal(done.kind, "success");
  assert.deepEqual(replay.sent[0].body, lost.sent[0].body);
  assert.equal(done.kind === "success" && done.receipt.decision.statement.hu, receipt.decision.statement.hu);
  for (const name of ["reject-lease-required", "reject-conflict", "reject-state-invalid", "reject-note-required", "reject-reason-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`);
    assert.deepEqual(await runDatesIntakeReject(bridge({ dates_event_intake_reject: refusal }).send, command),
      { kind: "refused", error: refusal.error, status: refusal.status_code, core: true });
  }
  // The receipt of a rejection with another reason is not this command's receipt.
  assert.deepEqual(await runDatesIntakeReject(bridge({ dates_event_intake_reject: fixture("admin-reject-duplicate") }).send, command), { kind: "uncertain" });
});

/** The editor document a reviewer confirmed, built from a genuine Core prefill. */
function confirmedEvent() {
  const prefill = projectDatesIntakeDetail(fixture("admin-detail-in-review-official"), xin(4))!.intake.events[0]!.editor_input!;
  const made = datesExternalDraftInput({ ...datesIntakeEditorDraft(prefill), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.ok(made.ok);
  return made.event;
}
// The fresh-access read the P1 publisher's journal makes before every command (a one-row external list).
const externalList = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1790000000, events: [], page: 1, limit: 1, total: 0,
  capabilities: ROLES.administrator };

test("publishing from an intake goes through the P1 journal: fresh access, saved before it leaves, same command on a retry", async () => {
  const receipt = fixture("admin-publish"), actor = "admin@example.test";
  const candidate = { intake_id: receipt.intake.intake_id, intake_revision: receipt.intake.revision - 1, event_index: 0, complete: false,
    event: confirmedEvent(), reason: "Source and public venue verified." };
  const memory = memoryStorage();
  let savedAtDispatch = 0;
  const h = bridge({ admin_me: identity(), dates_external_event_list: externalList,
    dates_event_intake_publish: () => { savedAtDispatch = memory.rows.size; return null; } });
  // The answer is lost: the command stays saved, and the page can find it for this intake.
  assert.deepEqual(await runDatesIntakePublish(h.send, memory.storage, actor, { candidate }), { kind: "uncertain", error: "unconfirmed" });
  assert.equal(savedAtDispatch, 1);
  const saved = datesIntakePendingPublish(memory.storage, actor, candidate.intake_id)!;
  assert.ok(saved);
  assert.equal(datesIntakePendingPublish(memory.storage, actor, xin(0xabc)), null);
  const first = h.sent.find((call) => call.action === "dates_event_intake_publish")!.body;
  assert.deepEqual({ ...first, idempotency_key: null }, { ...candidate, idempotency_key: null });
  assert.match(String(first.idempotency_key), /^dates-external:[0-9a-f-]{36}$/);
  // A second, different command cannot leave while this one is outstanding.
  assert.deepEqual(await runDatesIntakePublish(h.send, memory.storage, actor, { candidate: { ...candidate, event_index: 1 } }), { kind: "blocked" });
  assert.equal(h.sent.filter((call) => call.action === "dates_event_intake_publish").length, 1);
  // The retry sends the saved command and the replayed receipt clears it.
  const retry = bridge({ admin_me: identity(), dates_external_event_list: externalList, dates_event_intake_publish: fixture("admin-publish-replay") });
  const done = await runDatesIntakePublish(retry.send, memory.storage, actor, { retry: saved });
  assert.equal(done.kind, "success");
  assert.deepEqual(retry.sent.find((call) => call.action === "dates_event_intake_publish")!.body, first);
  assert.equal(readDatesExternalPending(memory.storage, actor).kind, "empty");
});

test("publishing sends nothing without fresh manage access, for another operator, or with an unusable command", async () => {
  const receipt = fixture("admin-publish"), actor = "admin@example.test";
  const candidate = { intake_id: receipt.intake.intake_id, intake_revision: receipt.intake.revision - 1, event_index: 0, complete: true,
    event: confirmedEvent(), reason: "Source and public venue verified." };
  for (const answers of [{ admin_me: identity("moderator"), dates_external_event_list: externalList }, { admin_me: null, dates_external_event_list: externalList },
    { admin_me: identity(), dates_external_event_list: null }, { admin_me: identity("administrator", "other@example.test"), dates_external_event_list: externalList }]) {
    const memory = memoryStorage(), h = bridge({ ...answers, dates_event_intake_publish: receipt });
    assert.deepEqual(await runDatesIntakePublish(h.send, memory.storage, actor, { candidate }), { kind: "access" });
    assert.equal(h.sent.some((call) => call.action === "dates_event_intake_publish"), false); assert.equal(memory.rows.size, 0);
  }
  const ok = { admin_me: identity(), dates_external_event_list: externalList, dates_event_intake_publish: receipt };
  for (const change of [{ event_index: 100 }, { intake_revision: 0 }, { reason: "" }, { intake_id: "xin_1" }]) {
    const memory = memoryStorage(), h = bridge(ok);
    assert.deepEqual(await runDatesIntakePublish(h.send, memory.storage, actor, { candidate: { ...candidate, ...change } }), { kind: "invalid" });
    assert.equal(h.sent.some((call) => call.action === "dates_event_intake_publish"), false);
  }
  // Without browser storage the exact command could not be kept for a retry, so it is not sent.
  const h = bridge(ok);
  assert.deepEqual(await runDatesIntakePublish(h.send, null, actor, { candidate }), { kind: "blocked" });
  assert.equal(h.sent.some((call) => call.action === "dates_event_intake_publish"), false);
  // Core's genuine no-land refusals release the command; the page shows the token.
  for (const name of ["publish-lease-required", "publish-conflict", "publish-drafts-disabled", "publish-publishing-disabled", "publish-event-unavailable"]) {
    const memory = memoryStorage(), refusal = fixture(`admin-${name}-denied`);
    assert.deepEqual(await runDatesIntakePublish(bridge({ ...ok, dates_event_intake_publish: refusal }).send, memory.storage, actor, { candidate }),
      { kind: "refused", error: refusal.error, retained: false });
    assert.equal(memory.rows.size, 0);
  }
});

test("a source is checked before it is sent: exactly one source of the chosen kind, a real image type, at most 10 MiB", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
  const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  const file = (header: Uint8Array, size = 2048) => ({ name: "flyer", size, header });
  assert.equal(datesIntakeSourceProblem({ kind: "url", url: " https://akvariumklub.hu/programok/acidarab/ ", text: "" }, []), null);
  for (const url of ["", "akvariumklub.hu", "ftp://example.test/a", "javascript:alert(1)", "https://user:secret@example.test/", "https://localhost/", `https://example.test/${"a".repeat(2048)}`])
    assert.equal(datesIntakeSourceProblem({ kind: "url", url, text: "" }, []), "url", url.slice(0, 40));
  assert.equal(datesIntakeSourceProblem({ kind: "text", url: "", text: "Fradi–Újpest szombaton a Groupama Arénában" }, []), null);
  assert.equal(datesIntakeSourceProblem({ kind: "text", url: "", text: "é".repeat(500) }, []), null);
  // Core counts graphemes: 500 family emoji are 500, not 5,500.
  assert.equal(datesIntakeSourceProblem({ kind: "text", url: "", text: "👨‍👩‍👧‍👦".repeat(500) }, []), null);
  for (const text of ["", "   ", "é".repeat(501)]) assert.equal(datesIntakeSourceProblem({ kind: "text", url: "", text }, []), "text");
  for (const header of [jpeg, png, webp, heic]) assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(header)]), null);
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "Városligeti programok novemberben" }, [file(jpeg), file(png)]), null);
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, []), "imageCount");
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(jpeg), file(jpeg), file(jpeg)]), "imageCount");
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(jpeg, 10 * 1024 * 1024)]), null, "exactly 10 MiB is Core's cap");
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(jpeg, 10 * 1024 * 1024 + 1)]), "imageSize");
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(jpeg, 0)]), "imageSize");
  for (const header of [new Uint8Array(Buffer.from("GIF89a..........")), new Uint8Array(Buffer.from("<svg xmlns='http")), new Uint8Array(Buffer.from("%PDF-1.7 .......")), new Uint8Array([])])
    assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "" }, [file(header)]), "imageType");
  assert.equal(datesIntakeSourceProblem({ kind: "images", url: "", text: "é".repeat(501) }, [file(jpeg)]), "text");
});

test("a source travels as one multipart form with one identity; Core's genuine answers come back as they are", async () => {
  const key = createDatesIntakeSourceKey();
  assert.match(key, /^dates-intake-create:[0-9a-f-]{36}$/);
  const forms: FormData[] = [];
  const post = (answer: unknown) => async (form: FormData) => { forms.push(form); if (answer instanceof Error) throw answer; return answer; };
  const fields = (form: FormData) => Object.fromEntries([...form.entries()].map(([name, value]) => [name, typeof value === "string" ? value : `file:${value.size}`]));
  const link = await submitDatesIntakeSource(post(fixture("admin-create-url")), { kind: "url", url: " https://akvariumklub.hu/programok/acidarab/ ", text: "ignored" }, [], "hu", key);
  assert.equal(link.kind, "success");
  assert.deepEqual(fields(forms[0]), { kind: "url", locale: "hu", idempotency_key: key, url: "https://akvariumklub.hu/programok/acidarab/" });
  const line = await submitDatesIntakeSource(post(fixture("admin-create-text")), { kind: "text", url: "", text: "Fradi–Újpest szombaton a Groupama Arénában" }, [], "en", key);
  assert.equal(line.kind === "success" && line.receipt.intake.status, "received");
  assert.deepEqual(fields(forms[1]), { kind: "text", locale: "en", idempotency_key: key, text: "Fradi–Újpest szombaton a Groupama Arénában" });
  const flyers = [new Blob([new Uint8Array(10)]), new Blob([new Uint8Array(20)])];
  const upload = await submitDatesIntakeSource(post(fixture("admin-create-images-with-text")), { kind: "images", url: "", text: "Városligeti programok novemberben" }, flyers, "hu", key);
  assert.equal(upload.kind, "success");
  assert.deepEqual(fields(forms[2]), { kind: "images", locale: "hu", idempotency_key: key, text: "Városligeti programok novemberben", image_1: "file:10", image_2: "file:20" });
  // A flyer alone carries no text field at all: Core treats a present text as given.
  await submitDatesIntakeSource(post(fixture("admin-create-images")), { kind: "images", url: "", text: "  " }, flyers.slice(0, 1), "hu", key);
  assert.deepEqual(fields(forms[3]), { kind: "images", locale: "hu", idempotency_key: key, image_1: "file:10" });
  // The same request again finds the first intake: Core's genuine replay.
  const replay = await submitDatesIntakeSource(post(fixture("admin-create-text-replay")), { kind: "text", url: "", text: "Fradi–Újpest szombaton a Groupama Arénában" }, [], "en", key);
  assert.equal(replay.kind === "success" && replay.receipt.replayed, true);
  assert.equal(replay.kind === "success" && line.kind === "success" && replay.receipt.intake.intake_id === line.receipt.intake.intake_id, true);
  for (const name of ["create-drafts-disabled", "create-source-not-readable", "create-url-invalid", "create-text-invalid", "create-image-invalid",
    "create-input-invalid", "create-kind-invalid", "create-locale-invalid", "create-key-conflict", "create-idempotency-invalid", "create-moderator"]) {
    const refusal = fixture(`admin-${name}-denied`);
    assert.deepEqual(await submitDatesIntakeSource(post(refusal), { kind: "url", url: "https://example.test/", text: "" }, [], "hu", key),
      { kind: "refused", error: refusal.error, status: refusal.status_code, core: true });
  }
  for (const answer of [null, new Error("offline"), { success: true }])
    assert.deepEqual(await submitDatesIntakeSource(post(answer), { kind: "url", url: "https://example.test/", text: "" }, [], "hu", key), { kind: "uncertain" });
});

test("the page keeps asking only while the worker owns the intake, and stops by itself", () => {
  for (const status of ["received", "screening", "extracting", "validating"] as const) {
    assert.equal(datesIntakePollDelay(status, 0), 3000);
    assert.equal(datesIntakePollDelay(status, 59_999), 3000);
    assert.equal(datesIntakePollDelay(status, 60_000), 10_000);
    assert.equal(datesIntakePollDelay(status, 600_000), null);
  }
  // Waiting for budget is retried by the worker hourly; a decided or reviewable intake changes only by a person.
  for (const status of ["awaiting_budget", "in_review", "published", "rejected", "duplicate", "failed", "expired", "member_confirming", "merged", "withdrawn"] as const)
    assert.equal(datesIntakePollDelay(status, 0), null, status);
});

test("commands are serialised: a lease renewal can never interleave with a command for the same revision", async () => {
  const serial = createDatesIntakeSerial(), order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = serial(async () => { order.push("heartbeat:start"); await gate; order.push("heartbeat:end"); return 1; });
  const second = serial(async () => { order.push("publish:start"); return 2; });
  const failing = serial(async () => { throw new Error("refused"); });
  const last = serial(async () => { order.push("after-failure"); return 3; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["heartbeat:start"]);
  release();
  assert.deepEqual([await first, await second], [1, 2]);
  await assert.rejects(failing, /refused/);
  assert.equal(await last, 3);
  assert.deepEqual(order, ["heartbeat:start", "heartbeat:end", "publish:start", "after-failure"]);
});

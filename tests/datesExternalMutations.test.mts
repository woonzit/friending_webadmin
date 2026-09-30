import assert from "node:assert/strict";
import test from "node:test";
import { DATES_EXTERNAL_RETRY_SECONDS, decodeDatesExternalPending, prepareDatesExternalPending, readDatesExternalPending,
  runDatesExternalMutation, type DatesExternalStorage } from "../lib/datesExternalMutations.ts";
import { readDatesExternalMutationAccess } from "../lib/datesExternalMutations.ts";
import type { DatesExternalMutationBaseline } from "../lib/datesExternalAdmin.ts";

const actor = "operator@example.test", now = 1_790_000_000;
const baseline: DatesExternalMutationBaseline = { external_event_id: "xev_" + "a".repeat(32), activity_id: "act_" + "b".repeat(32),
  revision: 2, activity_revision: 5, status: "published", lifecycle: "active", soft_deleted: false };
function pending() {
  return prepareDatesExternalPending(actor, "dates_external_event_command", {
    external_event_id: baseline.external_event_id, expected_revision: 2, action: "cancel", reason: "Confirmed cancellation",
  }, baseline, now)!;
}
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const receipt = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now,
  external_event_id: baseline.external_event_id, activity_id: baseline.activity_id, revision: 3, activity_revision: 6,
  event_status: "canceled_upstream", audit_id: "aud_" + "c".repeat(32), replayed: false, action: "cancel", lifecycle: "canceled", soft_deleted: false };

test("pending identity is closed, operator-bound and snapshots the original command", () => {
  const value = pending(); assert.ok(value);
  assert.ok(decodeDatesExternalPending(value, actor));
  assert.notEqual(value.baseline, baseline);
  for (const changed of [{ ...value, actor: "someone@example.test" }, { ...value, issued_at: "1790000000" },
    { ...value, baseline: null }, { ...value, extra: true }, { ...value, body: { ...value.body, expected_revision: 3 } }])
    assert.equal(decodeDatesExternalPending(changed, actor), null);
  assert.equal(prepareDatesExternalPending(actor, value.action, value.body, baseline, now), null, "caller cannot choose a replacement request identity");
  const body = { ...value.body }; delete body.idempotency_key;
  const next = prepareDatesExternalPending(actor, value.action, body, baseline, now)!;
  body.reason = "Edited after preparation";
  assert.equal(next.body.reason, value.body.reason);
});

test("durable persistence and exact readback precede every send", async () => {
  for (const broken of [null, { getItem: () => null, setItem: () => { throw Error("full"); }, removeItem: () => {} },
    { getItem: () => null, setItem: () => {}, removeItem: () => {} }]) {
    let sent = 0;
    assert.deepEqual(await runDatesExternalMutation(pending(), broken, now, async () => { sent++; return receipt; }), { kind: "blocked" });
    assert.equal(sent, 0);
  }
  const store = storage(), value = pending();
  const result = await runDatesExternalMutation(value, store, now, async (action, body) => {
    assert.equal(action, value.action); assert.deepEqual(body, value.body);
    assert.deepEqual(readDatesExternalPending(store, actor), { kind: "pending", pending: value });
    return receipt;
  });
  assert.equal(result.kind, "success"); assert.equal(result.kind === "success" && result.retained, false);
  assert.deepEqual(readDatesExternalPending(store, actor), { kind: "empty" });
});

test("lost responses and malformed receipts retain identical bytes across reload and retry", async () => {
  const store = storage(), value = pending(), sent: string[] = [];
  const first = await runDatesExternalMutation(value, store, now, async (action, body) => { sent.push(JSON.stringify({ action, body })); throw Error("lost"); });
  assert.equal(first.kind, "uncertain");
  const recovered = readDatesExternalPending(store, actor); assert.equal(recovered.kind, "pending");
  if (recovered.kind !== "pending") return;
  const malformed = await runDatesExternalMutation(recovered.pending, store, now + 60, async (action, body) => {
    sent.push(JSON.stringify({ action, body })); return { ...receipt, revision: 99 };
  });
  assert.equal(malformed.kind, "uncertain");
  const success = await runDatesExternalMutation(recovered.pending, store, now + 120, async (action, body) => {
    sent.push(JSON.stringify({ action, body })); return { ...receipt, replayed: true };
  });
  assert.equal(success.kind, "success"); assert.equal(new Set(sent).size, 1);
});

test("revocation, key conflict and service errors cannot erase earlier outcome evidence", async () => {
  for (const [status_code, error] of [[403, "dates-admin-capability-required"], [409, "dates-admin-idempotency-conflict"],
    [409, "dates-admin-command-in-progress"], [503, "dates-external-storage-unavailable"]] as const) {
    const store = storage(), value = pending();
    const result = await runDatesExternalMutation(value, store, now, async () => ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 }));
    assert.equal(result.kind, "uncertain", error); assert.equal(readDatesExternalPending(store, actor).kind, "pending");
  }
  const store = storage();
  const result = await runDatesExternalMutation(pending(), store, now, async () => ({ success: false, status_code: 409, error: "dates-external-conflict", message: 200, status: 200, can_send: 0 }));
  assert.equal(result.kind, "refused"); assert.deepEqual(readDatesExternalPending(store, actor), { kind: "empty" });
});

test("expired, future, corrupt and competing pending entries block rather than replace evidence", async () => {
  const store = storage(), value = pending(); let sent = 0;
  const send = async () => { sent++; return receipt; };
  assert.deepEqual(await runDatesExternalMutation(value, store, now + DATES_EXTERNAL_RETRY_SECONDS, send), { kind: "expired" });
  assert.deepEqual(await runDatesExternalMutation(value, store, now - 301, send), { kind: "blocked" });
  await runDatesExternalMutation(value, store, now, async () => null);
  assert.deepEqual(await runDatesExternalMutation(pending(), store, now, send), { kind: "blocked" });
  const key = [...store.values.keys()][0]; store.values.set(key, "corrupt");
  assert.equal(readDatesExternalPending(store, actor).kind, "blocked");
  assert.deepEqual(await runDatesExternalMutation(value, store, now, send), { kind: "blocked" });
  assert.equal(store.values.get(key), "corrupt"); assert.equal(sent, 0);
});

test("successful server receipt is not mislabeled when local cleanup fails or another entry replaces it", async () => {
  const base = storage(), store: DatesExternalStorage = { ...base, removeItem: () => { throw Error("unavailable"); } };
  const result = await runDatesExternalMutation(pending(), store, now, async () => receipt);
  assert.equal(result.kind, "success"); assert.equal(result.kind === "success" && result.retained, true);
  const replacementStore = storage(), value = pending(), replacement = pending();
  const replaced = await runDatesExternalMutation(value, replacementStore, now, async () => {
    replacementStore.values.set([...replacementStore.values.keys()][0], JSON.stringify(replacement)); return receipt;
  });
  assert.equal(replaced.kind, "success"); assert.equal(replaced.kind === "success" && replaced.retained, true);
  assert.deepEqual(readDatesExternalPending(replacementStore, actor), { kind: "pending", pending: replacement });
});

test("fresh mutation authority requires both real capability projections and fresh Core time", async () => {
  const capabilities = ["dates_external_event_read", "dates_external_event_manage"];
  const identity = { success: true, dates: { email: actor, role: "administrator", rank: 40, linked_uid: null,
    sensitive_location: false, break_glass: false, capabilities } };
  const list = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now,
    events: [], page: 1, limit: 1, total: 0, capabilities };
  assert.deepEqual(await readDatesExternalMutationAccess(async (action) => action === "admin_me" ? identity : list), { actor, serverNow: now });
  for (const principal of [null, { success: true, role: "owner" }, { ...identity, dates: { ...identity.dates, capabilities: [] } }])
    assert.equal(await readDatesExternalMutationAccess(async (action) => action === "admin_me" ? principal : list), null);
  assert.equal(await readDatesExternalMutationAccess(async (action) => action === "admin_me" ? identity : { ...list, capabilities: ["dates_external_event_read"] }), null);
  assert.equal(await readDatesExternalMutationAccess(async () => { throw Error("network"); }), null);
});

test("external soft-delete/restore retries preserve activity CAS even for terminal records", async () => {
  const ended = { ...baseline, status: "ended" as const, lifecycle: "ended" as const, soft_deleted: true };
  const value = prepareDatesExternalPending(actor, "dates_activity_command", { activity_id: baseline.activity_id,
    expected_revision: baseline.activity_revision, action: "restore", reason: "Undo deletion only" }, ended, now);
  assert.ok(value);
  assert.equal(prepareDatesExternalPending(actor, "dates_activity_command", { ...value.body, idempotency_key: undefined }, ended, now), null);
  const store = storage(), sent: string[] = [];
  const first = await runDatesExternalMutation(value, store, now, async (_, body) => { sent.push(JSON.stringify(body)); return null; });
  assert.equal(first.kind, "uncertain");
  const restored = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now,
    external_event_id: baseline.external_event_id, activity_id: baseline.activity_id, revision: 6, activity_revision: 6, external_revision: 3,
    event_status: "ended", lifecycle: "ended", soft_deleted: false, action: "restore", audit_id: "aud_" + "c".repeat(32), idempotency_replayed: true };
  assert.equal((await runDatesExternalMutation(value, store, now + 60, async (_, body) => { sent.push(JSON.stringify(body)); return restored; })).kind, "success");
  assert.equal(new Set(sent).size, 1);
});

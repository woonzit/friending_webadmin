import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  membershipGrantPreview,
  membershipPinnedMutation,
  membershipUserDetail,
  type MembershipGrantPreview,
  type MembershipUserDetail,
} from "../lib/membership.ts";
import {
  MEMBERSHIP_PENDING_GRANT_STORAGE_PREFIX,
  MEMBERSHIP_PENDING_GRANT_TTL_MS,
  membershipAdminScope,
  membershipCheckPendingGrant,
  membershipClearPendingGrant,
  membershipPendingGrantStorageKey,
  membershipReadUserDetail,
  membershipRememberPendingGrant,
  membershipRestorePendingGrant,
  membershipSessionStorage,
  membershipStorePendingGrant,
  membershipSubmitGrant as submitGrant,
  type MembershipAdminCall,
  type MembershipPendingGrant,
} from "../lib/membershipFlows.ts";

// Existing grant/detail regressions use a DERIVED positively confirmed, fixed
// actor adapter. Separate T-899 tests exercise the REAL client and actor changes.
const membershipSubmitGrant = (call: MembershipAdminCall, input: Omit<Parameters<typeof submitGrant>[1], "actor">) => submitGrant(
  async (action, body) => action === "admin_me"
    ? { message: 200, status: 200, can_send: 0, success: true, status_code: 200, email: "owner@example.invalid", role: "owner" }
    : call(action, body), { ...input, actor: "owner@example.invalid" });

const ISO = "2026-08-15T12:00:00Z";
const LATER = "2026-09-15T12:00:00Z";

type Reply = { success?: unknown; error?: unknown; data?: unknown } | null;

/** A scripted bridge: each call must match the next expected action and returns its reply. */
function mockCall(script: Array<[string, Reply]>) {
  const calls: Array<{ action: string; body: Record<string, unknown> | undefined }> = [];
  const call: MembershipAdminCall = async (action, body) => {
    calls.push({ action, body: body === undefined ? undefined : structuredClone(body) });
    const next = script.shift();
    assert.ok(next, `unexpected call ${action}`);
    assert.equal(action, next[0], "the flow called an unexpected action");
    return next[1];
  };
  return { call, calls, done: () => assert.equal(script.length, 0, "every scripted reply was consumed") };
}

function minter() {
  let count = 0;
  return () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
}

function grantWire(id: string, revision: number) {
  return {
    grant_id: id, tier: "plus", preset_id: "plus_month", starts_at: ISO, expires_at: LATER,
    status: "active", current: true, revision, reason: "Support recovery",
    created_by: "owner@example.invalid", created_at: ISO, updated_by: "owner@example.invalid", updated_at: ISO,
    revoked_by: "", revoked_at: null,
  };
}

function detailWire(grant: ReturnType<typeof grantWire> | null, uid = 321) {
  return {
    schema_version: 1,
    uid,
    effective_membership: {
      schema_version: 1,
      tier: grant ? "plus" : "free",
      entitled: grant !== null,
      lifecycle_state: grant ? "active" : "none",
      effective_starts_at: grant ? ISO : null,
      effective_expires_at: grant ? LATER : null,
      next_transition_at: grant ? LATER : null,
      first_subscribed_at: grant ? ISO : null,
      sources: grant ? [{ kind: "admin_grant", state: "active", starts_at: ISO, expires_at: LATER, auto_renews: null, contributes_to_access: true }] : [],
      revision: 1,
      server_time: ISO,
      configuration_revision: 3,
      configuration_ready_for_enforcement: false,
      capabilities: { invisible_presence: false, hide_profile_visit: false, vip_badge: false, quick_phrases: false },
      quotas: {
        footprint_send: { scope: "utc_day", mode: "finite", used: 0, limit: 5, remaining: 5, reset_at: LATER },
        pinger_send: { scope: "utc_day", mode: "unlimited", used: 0, reset_at: LATER },
        private_album_access: { scope: "concurrent", mode: "unlimited", used: 0 },
        quick_phrase_slots: { scope: "concurrent", mode: "disabled", used: 0 },
      },
      badge: { eligible: false, hidden: false, visible: false },
    },
    store_sources: [],
    admin_grant: grant,
    history: [],
  };
}

/** The `user_detail` fallback Core embeds when the membership subsystem cannot answer. */
function unavailableWire(uid = 321) {
  return {
    schema_version: 1,
    uid,
    effective_membership: { tier: "unknown", entitled: false, lifecycle_state: "unavailable" },
    store_sources: [],
    admin_grant: null,
    history: [],
  };
}

function detail(grant: ReturnType<typeof grantWire> | null): MembershipUserDetail {
  const parsed = membershipUserDetail(detailWire(grant));
  assert.ok(parsed);
  return parsed;
}

function preview(currentRevision: number, currentId?: string | null): MembershipGrantPreview {
  const parsed = membershipGrantPreview({
    schema_version: 1,
    uid: 321,
    server_time: ISO,
    current_grant_revision: currentRevision,
    ...(currentId === undefined ? {} : { current_grant_id: currentId }),
    current_effective_expires_at: null,
    schedule: { tier: "plus", preset_id: "plus_month", start_mode: "extend", base_at: ISO, starts_at: ISO, expires_at: LATER, status: "active" },
    store_overlap: false,
    resulting_effective_expires_at: LATER,
  });
  assert.ok(parsed);
  return parsed;
}

const GRANT_BODY = { preset_id: "plus_month", start_mode: "extend", custom_expires_at: null, reason: "Support recovery" };
const GRANT_A = "11111111-1111-4111-8111-111111111111";
const GRANT_B = "22222222-2222-4222-8222-222222222222";

test("grant previews accept the optional identity and refuse malformed or inconsistent identities", () => {
  assert.equal(preview(1, GRANT_A).current_grant_id, GRANT_A);
  assert.equal(preview(0, null).current_grant_id, null);
  assert.equal(preview(1).current_grant_id, undefined);
  const wire = { schema_version: 1, ...preview(1) };
  for (const current_grant_id of ["", "g1", 123, [], {}, null]) {
    assert.equal(membershipGrantPreview({ ...wire, current_grant_id }), null);
  }
  assert.equal(membershipGrantPreview({ ...wire, current_grant_id: GRANT_A, current_grant_revision: 0 }), null);
});

test("a preview identity distinguishes replacement grants with the same revision", async () => {
  const stale = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire(GRANT_B, 1)) }]]);
  const refused = await membershipSubmitGrant(stale.call, {
    uid: 321, pending: null, detail: detail(grantWire(GRANT_B, 1)), preview: preview(1, GRANT_A), body: GRANT_BODY,
    mintRequestId: () => assert.fail("a stale preview cannot mint a request"),
  });
  stale.done();
  assert.equal(refused.kind, "previewStale");
  assert.equal(refused.detail?.admin_grant?.grant_id, GRANT_B);

  const current = mockCall([["membership_admin_grant", { success: true, data: detailWire(grantWire(GRANT_A, 2)) }]]);
  await membershipSubmitGrant(current.call, {
    uid: 321, pending: null, detail: detail(grantWire(GRANT_A, 1)), preview: preview(1, GRANT_A), body: GRANT_BODY, mintRequestId: minter(),
  });
  current.done();
  assert.equal(current.calls[0]!.body!.expected_grant_id, GRANT_A);
  assert.equal(current.calls[0]!.body!.expected_revision, 1);
});

test("every pinned retry checks identity and revision first, including old pins without a grant fence", async () => {
  for (const legacy of [false, true]) {
    const pending: MembershipPendingGrant = {
      pinned: membershipPinnedMutation(null, {
        ...GRANT_BODY, uid: 321, expected_revision: 1, ...(legacy ? {} : { expected_grant_id: GRANT_A }),
      }, minter()),
      baseline: { grant_id: GRANT_A, revision: 1 }, uncertain: true,
    };
    for (const changed of [grantWire(GRANT_B, 1), grantWire(GRANT_A, 2), null]) {
      const bridge = mockCall([["membership_user_detail", { success: true, data: detailWire(changed) }]]);
      const result = await membershipSubmitGrant(bridge.call, {
        uid: 321, pending, detail: detail(grantWire(GRANT_A, 1)), preview: null, body: GRANT_BODY,
        mintRequestId: () => assert.fail("a retry cannot mint a request"),
        persist: () => assert.fail("a stopped retry cannot be sent"),
      });
      bridge.done();
      assert.equal(result.kind, "refused");
      assert.equal(result.kind === "refused" && result.errorKey, "grantConflict");
      assert.equal(result.pending, null);
    }
    const bridge = mockCall([
      ["membership_user_detail", { success: true, data: detailWire(grantWire(GRANT_A, 1)) }],
      ["membership_admin_grant", { success: true, data: detailWire(grantWire(GRANT_A, 2)) }],
    ]);
    const result = await membershipSubmitGrant(bridge.call, {
      uid: 321, pending, detail: detail(grantWire(GRANT_A, 1)), preview: null, body: GRANT_BODY, mintRequestId: minter(),
    });
    bridge.done();
    assert.equal(result.kind, "granted");
    assert.equal(JSON.stringify(bridge.calls[1]!.body), JSON.stringify(pending.pinned.body), "the original receipt body is preserved byte for byte");
  }
});

test("invalid grant identities are definite technical refusals and release the pin", async () => {
  const bridge = mockCall([["membership_admin_grant", { success: false, error: "membership-admin-grant-id-invalid" }]]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(grantWire(GRANT_A, 1)), preview: preview(1, GRANT_A), body: GRANT_BODY, mintRequestId: minter(),
  });
  bridge.done();
  assert.deepEqual(result, { kind: "refused", errorKey: "grantIdInvalid", detail: null, pending: null });
});

test("a grant Core answers is adopted; the body is pinned to the preview revision", async () => {
  const bridge = mockCall([["membership_admin_grant", { success: true, data: detailWire(grantWire("g1", 1)) }]]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  bridge.done();
  assert.equal(result.kind, "granted");
  assert.equal(result.pending, null);
  assert.deepEqual(bridge.calls[0]!.body, {
    ...GRANT_BODY, uid: 321, expected_revision: 0, expected_grant_id: null, request_id: "00000000-0000-4000-8000-000000000001",
  });
});

test("a timed-out grant stays pinned; the retry replays the same request_id and body", async () => {
  const mint = minter();
  const first = mockCall([
    ["membership_admin_grant", { success: false, error: "core-timeout" }],
    ["membership_user_detail", { success: true, data: detailWire(null) }],
  ]);
  const uncertain = await membershipSubmitGrant(first.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: mint,
  });
  first.done();
  assert.equal(uncertain.kind, "uncertain", "a timeout whose reload shows the old grant stays unknown");
  assert.ok(uncertain.pending?.uncertain);
  assert.deepEqual(uncertain.pending.baseline, { grant_id: null, revision: 0 });

  const retry = mockCall([
    ["membership_user_detail", { success: true, data: detailWire(null) }],
    ["membership_admin_grant", null],
    ["membership_user_detail", { success: true, data: detailWire(grantWire("g9", 1)) }],
  ]);
  const resolved = await membershipSubmitGrant(retry.call, {
    uid: 321, pending: uncertain.pending, detail: detail(null), preview: preview(0), body: { ...GRANT_BODY, reason: "edited" }, mintRequestId: mint,
  });
  retry.done();
  assert.deepEqual(retry.calls[1]!.body, first.calls[0]!.body, "a retry replays the pinned body, never the edited form");
  assert.equal(retry.calls[1]!.body!.request_id, "00000000-0000-4000-8000-000000000001", "the request_id is reused");
  assert.equal(resolved.kind, "uncertainResolved", "a new grant identity after an unknown outcome most likely is this request");
  assert.equal(resolved.pending, null);

  const unreadable = mockCall([
    ["membership_user_detail", { success: false, error: "core-unavailable" }],
  ]);
  const stillUnknown = await membershipSubmitGrant(unreadable.call, {
    uid: 321, pending: uncertain.pending, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: mint,
  });
  assert.equal(stillUnknown.kind, "uncertain");
  assert.equal(stillUnknown.detail, null);
  assert.ok(stillUnknown.pending?.uncertain, "an unreadable member keeps the request pinned and locked");
  assert.equal(stillUnknown.pending?.pinned.body.request_id, uncertain.pending.pinned.body.request_id);
  unreadable.done();
});

test("a success body that fails the strict parser is uncertain, never a success", async () => {
  const bridge = mockCall([
    ["membership_admin_grant", { success: true, data: { uid: 321, schema_version: 1 } }],
    ["membership_user_detail", { success: true, data: detailWire(grantWire("g1", 1)) }],
  ]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  bridge.done();
  assert.equal(result.kind, "uncertainResolved", "the reload shows the new grant, so the pin is released as most likely applied");

  const unchanged = mockCall([
    ["membership_admin_grant", { success: true, data: detailWire(grantWire("g1", 1), 999) }],
    ["membership_user_detail", { success: true, data: detailWire(null) }],
  ]);
  const foreign = await membershipSubmitGrant(unchanged.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  unchanged.done();
  assert.equal(foreign.kind, "uncertain", "another member's detail is never adopted as this grant's answer");
});

test("a stale member view is re-read so the grant baseline pairs identity with the preview revision", async () => {
  // The page still shows no grant, but Core's preview is already at another operator's grant g2 r1.
  const bridge = mockCall([
    ["membership_user_detail", { success: true, data: detailWire(grantWire("g2", 1)) }],
    ["membership_admin_grant", { success: false, error: "core-timeout" }],
    ["membership_user_detail", { success: true, data: detailWire(grantWire("g2", 1)) }],
  ]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(1), body: GRANT_BODY, mintRequestId: minter(),
  });
  bridge.done();
  assert.equal(result.kind, "uncertain", "the other operator's grant is not mistaken for this request");
  assert.deepEqual(result.pending?.baseline, { grant_id: "g2", revision: 1 });
  assert.equal(bridge.calls[1]!.body!.expected_grant_id, "g2", "older previews still pin the loaded baseline identity");
});

test("a grant revision that moved since the preview returns previewStale and sends nothing", async () => {
  const moved = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire("g2", 2)) }]]);
  const mint = minter();
  const stale = await membershipSubmitGrant(moved.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(1), body: GRANT_BODY, mintRequestId: mint,
  });
  moved.done();
  assert.equal(stale.kind, "previewStale");
  assert.equal(stale.pending, null, "nothing is pinned, so nothing can later read as most likely applied");
  assert.equal(stale.detail?.admin_grant?.revision, 2, "the fresh member is handed back for adoption");
  assert.deepEqual(moved.calls.map((entry) => entry.action), ["membership_user_detail"], "no grant request is sent");
  assert.equal(mint(), "00000000-0000-4000-8000-000000000001", "no request identity was minted");

  // A loaded member already at the preview's revision needs no read and is sent as previewed.
  const current = mockCall([["membership_admin_grant", { success: true, data: detailWire(grantWire("g2", 4)) }]]);
  const currentResult = await membershipSubmitGrant(current.call, {
    uid: 321, pending: null, detail: detail(grantWire("g2", 3)), preview: preview(3), body: GRANT_BODY, mintRequestId: minter(),
  });
  current.done();
  assert.equal(currentResult.kind, "granted");

  const unreadable = mockCall([["membership_user_detail", { success: false, error: "core-unavailable" }]]);
  const unreadableResult = await membershipSubmitGrant(unreadable.call, {
    uid: 321, pending: null, detail: detail(grantWire("g1", 1)), preview: preview(2), body: GRANT_BODY, mintRequestId: minter(),
  });
  unreadable.done();
  assert.deepEqual(unreadableResult, { kind: "previewStale", detail: null, pending: null }, "an unconfirmed baseline is never sent");

  const none = mockCall([]);
  assert.deepEqual(await membershipSubmitGrant(none.call, {
    uid: 321, pending: null, detail: detail(null), preview: null, body: GRANT_BODY, mintRequestId: minter(),
  }), { kind: "previewStale", detail: null, pending: null }, "a first attempt without a preview sends nothing");
  assert.equal(none.calls.length, 0);
});

test("grant conflicts re-read Core's member and refusals release the request", async () => {
  const conflict = mockCall([["membership_admin_grant", {
    success: false, error: "membership-admin-conflict", data: detailWire(grantWire("g3", 2)),
  }], ["membership_user_detail", { success: true, data: detailWire(grantWire("g3", 3)) }]]);
  const conflictResult = await membershipSubmitGrant(conflict.call, {
    uid: 321, pending: null, detail: detail(grantWire("g3", 1)), preview: preview(1), body: GRANT_BODY, mintRequestId: minter(),
  });
  assert.equal(conflictResult.kind, "refused");
  assert.equal(conflictResult.pending, null);
  assert.equal(conflictResult.kind === "refused" && conflictResult.errorKey, "grantConflict");
  assert.equal(conflictResult.detail?.admin_grant?.revision, 3);
  conflict.done();

  const foreign = mockCall([["membership_admin_grant", {
    success: false, error: "membership-admin-conflict", data: detailWire(grantWire("g3", 2), 999),
  }], ["membership_user_detail", { success: true, data: detailWire(null, 999) }]]);
  const foreignResult = await membershipSubmitGrant(foreign.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  assert.equal(foreignResult.detail, null, "another member's detail is never adopted");

  const invalid = mockCall([["membership_admin_grant", { success: false, error: "membership-admin-reason-invalid" }]]);
  const invalidResult = await membershipSubmitGrant(invalid.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  assert.deepEqual(invalidResult, { kind: "refused", errorKey: "validation", detail: null, pending: null });

  const reused = mockCall([["membership_admin_grant", { success: false, error: "membership-admin-request-id-conflict" }]]);
  const reusedResult = await membershipSubmitGrant(reused.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
  });
  assert.equal(reusedResult.kind === "refused" && reusedResult.errorKey, "requestConflict");
});

test("a pending grant check compares grant identity and revision against a fresh read", async () => {
  const pending = {
    pinned: { fingerprint: "f", body: { request_id: "r", uid: 321 } },
    baseline: { grant_id: "g1", revision: 1 },
    uncertain: true,
  };
  const sameRevisionNewId = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire("g2", 1)) }]]);
  assert.equal((await membershipCheckPendingGrant(sameRevisionNewId.call, 321, pending)).kind, "changed", "a replacement grant can restart at revision 1");

  const bumped = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire("g1", 2)) }]]);
  assert.equal((await membershipCheckPendingGrant(bumped.call, 321, pending)).kind, "changed");

  const same = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire("g1", 1)) }]]);
  assert.equal((await membershipCheckPendingGrant(same.call, 321, pending)).kind, "unchanged");

  const unreadable = mockCall([["membership_user_detail", null]]);
  assert.deepEqual(await membershipCheckPendingGrant(unreadable.call, 321, pending), { kind: "unreadable" });

  const otherMember = mockCall([["membership_user_detail", { success: true, data: detailWire(grantWire("g1", 1), 999) }]]);
  assert.deepEqual(await membershipCheckPendingGrant(otherMember.call, 321, pending), { kind: "unreadable" });

  // The unavailable fallback carries no grant; it must never read as "the grant disappeared".
  const unavailable = mockCall([["membership_user_detail", { success: true, data: unavailableWire() }]]);
  assert.deepEqual(await membershipCheckPendingGrant(unavailable.call, 321, pending), { kind: "unreadable" });
  const read = mockCall([["membership_user_detail", { success: true, data: unavailableWire() }]]);
  assert.equal(await membershipReadUserDetail(read.call, 321), null);
});

// ------------------------------------------------------ pinned grant persistence

const ADMIN = "operator@example.invalid";
const T0 = Date.parse("2026-09-28T10:00:00Z");

/** An in-memory `sessionStorage` stand-in; each operation can be made to throw. */
function memoryStorage(fail: { get?: boolean; set?: boolean; remove?: boolean } = {}) {
  const entries = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      if (fail.get) throw new Error("storage blocked");
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (fail.set) throw new Error("quota exceeded");
      entries.set(key, String(value));
    },
    removeItem(key: string): void {
      if (fail.remove) throw new Error("storage blocked");
      entries.delete(key);
    },
  };
  return { storage, entries };
}

/** Pins one grant through an uncertain first attempt, storing it the way the panel does. */
async function uncertainPinnedGrant(storage: ReturnType<typeof memoryStorage>["storage"], admin = ADMIN) {
  const bridge = mockCall([
    ["membership_admin_grant", { success: false, error: "core-timeout" }],
    ["membership_user_detail", { success: true, data: detailWire(null) }],
  ]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
    persist: (pinned) => { membershipRememberPendingGrant(storage, admin, 321, pinned, T0); },
  });
  bridge.done();
  assert.equal(result.kind, "uncertain");
  assert.ok(result.pending);
  membershipRememberPendingGrant(storage, admin, 321, result.pending, T0 + 2_000);
  return { pending: result.pending, sent: bridge.calls[0]!.body! };
}

test("a pinned grant is stored before the send and a reload restores the same request and lock", async () => {
  const { storage, entries } = memoryStorage();
  const storedAtSend: number[] = [];
  const bridge = mockCall([
    ["membership_admin_grant", { success: false, error: "core-timeout" }],
    ["membership_user_detail", { success: true, data: detailWire(null) }],
  ]);
  const call: MembershipAdminCall = async (action, body) => {
    if (action === "membership_admin_grant") storedAtSend.push(entries.size);
    return bridge.call(action, body);
  };
  const first = await membershipSubmitGrant(call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
    persist: (pinned) => { membershipRememberPendingGrant(storage, ADMIN, 321, pinned, T0); },
  });
  bridge.done();
  assert.deepEqual(storedAtSend, [1], "the request identity is stored before Core can apply it");
  assert.equal(first.kind, "uncertain");
  assert.ok(first.pending);
  membershipRememberPendingGrant(storage, ADMIN, 321, first.pending, T0 + 5_000);

  const key = membershipPendingGrantStorageKey(ADMIN, 321);
  assert.equal(MEMBERSHIP_PENDING_GRANT_STORAGE_PREFIX, "friending.membership.pending-grant.v1");
  assert.equal(key, "friending.membership.pending-grant.v1:operator%40example.invalid:321");
  const stored = JSON.parse(entries.get(key!)!);
  assert.deepEqual(Object.keys(stored).sort(), ["baseline", "created_at", "fingerprint", "request_id", "uid", "version"],
    "only the listed request metadata is stored");
  assert.deepEqual(stored.baseline, { grant_id: null, revision: 0 });
  assert.equal(stored.request_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(stored.created_at, T0, "re-storing the same request keeps the time it was first pinned");
  assert.equal(entries.get(key!)!.includes(ADMIN), false, "the administrator scopes the key, not the value");

  // The page reloads: nothing is in memory, the member still has the baseline grant.
  const restored = membershipRestorePendingGrant(storage, { admin: ADMIN, uid: 321, detail: detail(null), now: T0 + 10 * 60_000 });
  assert.equal(restored.kind, "restored");
  if (restored.kind !== "restored") return;
  assert.equal(restored.createdAt, T0);
  assert.equal(restored.pending.uncertain, true, "a restored pin always has an unknown outcome and stays locked");
  assert.deepEqual(restored.pending, { ...first.pending, uncertain: true });
  assert.deepEqual(restored.request, {
    preset_id: "plus_month", start_mode: "extend", custom_expires_at: null, reason: "Support recovery",
  }, "the locked form shows exactly what a retry resends");

  // Retry after the reload needs no preview and replays the pinned body byte for byte.
  const retry = mockCall([
    ["membership_user_detail", { success: true, data: detailWire(null) }],
    ["membership_admin_grant", { success: true, data: detailWire(grantWire("g1", 1)) }],
  ]);
  const replayed = await membershipSubmitGrant(retry.call, {
    uid: 321, pending: restored.pending, detail: detail(null), preview: null, body: { ...GRANT_BODY, reason: "edited" },
    mintRequestId: () => assert.fail("a replay never mints a new request identity"),
    persist: (pinned) => { membershipRememberPendingGrant(storage, ADMIN, 321, pinned, T0 + 11 * 60_000); },
  });
  retry.done();
  assert.deepEqual(retry.calls[1]!.body, bridge.calls[0]!.body);
  assert.equal(replayed.kind, "granted");
  assert.equal(JSON.parse(entries.get(key!)!).created_at, T0, "a retry never extends the expiry");
  membershipRememberPendingGrant(storage, ADMIN, 321, replayed.pending, T0 + 11 * 60_000);
  assert.equal(entries.size, 0, "success clears the stored pin");
});

test("a custom-expiry grant pin round-trips through storage", async () => {
  const { storage } = memoryStorage();
  const body = { preset_id: "custom", start_mode: "start_now", custom_expires_at: "2026-10-28T09:30:00Z", reason: "Re-registered member" };
  const bridge = mockCall([
    ["membership_admin_grant", null],
    ["membership_user_detail", { success: true, data: detailWire(grantWire("g4", 2)) }],
  ]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(grantWire("g4", 2)), preview: preview(2), body, mintRequestId: minter(),
    persist: (pinned) => { membershipRememberPendingGrant(storage, ADMIN, 321, pinned, T0); },
  });
  bridge.done();
  assert.equal(result.kind, "uncertain");
  const restored = membershipRestorePendingGrant(storage, { admin: ADMIN, uid: 321, detail: detail(grantWire("g4", 2)), now: T0 });
  assert.equal(restored.kind, "restored");
  if (restored.kind === "restored") {
    assert.deepEqual(restored.request, body);
    assert.deepEqual(restored.pending.baseline, { grant_id: "g4", revision: 2 });
  }
});

test("a pre-fence pin restores without adding an identity to its receipt body", () => {
  const { storage } = memoryStorage();
  const pending: MembershipPendingGrant = {
    pinned: membershipPinnedMutation(null, { ...GRANT_BODY, uid: 321, expected_revision: 1 }, minter()),
    baseline: { grant_id: GRANT_A, revision: 1 }, uncertain: true,
  };
  assert.equal(membershipStorePendingGrant(storage, ADMIN, 321, pending, T0), true);
  const result = membershipRestorePendingGrant(storage, { admin: ADMIN, uid: 321, detail: detail(grantWire(GRANT_A, 1)), now: T0 });
  assert.equal(result.kind, "restored");
  if (result.kind === "restored") {
    assert.deepEqual(result.pending, pending);
    assert.equal("expected_grant_id" in result.pending.pinned.body, false);
  }
});

test("a stored grant pin is scoped to the signed-in administrator and the member", async () => {
  const { storage, entries } = memoryStorage();
  await uncertainPinnedGrant(storage);
  assert.equal(entries.size, 1);

  for (const other of [
    { admin: "second@example.invalid", uid: 321 },
    { admin: ADMIN, uid: 999 },
    { admin: null, uid: 321 },
  ]) {
    const otherDetail = membershipUserDetail(detailWire(null, other.uid));
    assert.ok(otherDetail);
    const restored = membershipRestorePendingGrant(storage, { ...other, detail: otherDetail, now: T0 + 60_000 });
    assert.deepEqual(restored, { kind: "none" }, JSON.stringify(other));
    assert.equal(entries.size, 1, "another administrator's or member's pin is left untouched");
  }
  assert.equal(membershipRestorePendingGrant(storage, {
    admin: "  Operator@Example.INVALID ", uid: 321, detail: detail(null), now: T0 + 60_000,
  }).kind, "restored", "the e-mail scope is normalized");

  assert.equal(membershipAdminScope(undefined), null);
  assert.equal(membershipAdminScope("not an email"), null);
  assert.equal(membershipAdminScope(42), null);
  assert.equal(membershipPendingGrantStorageKey(ADMIN, 0), null);
  const unscoped = memoryStorage();
  const { pending } = await uncertainPinnedGrant(unscoped.storage, "");
  assert.equal(unscoped.entries.size, 0, "without an administrator scope nothing is persisted");
  assert.equal(membershipStorePendingGrant(unscoped.storage, null, 321, pending, T0), false);
});

test("a stored grant pin expires after 30 minutes and a clock-skewed entry is dropped", async () => {
  assert.equal(MEMBERSHIP_PENDING_GRANT_TTL_MS, 30 * 60_000);
  const edge = memoryStorage();
  await uncertainPinnedGrant(edge.storage);
  assert.equal(membershipRestorePendingGrant(edge.storage, {
    admin: ADMIN, uid: 321, detail: detail(null), now: T0 + MEMBERSHIP_PENDING_GRANT_TTL_MS,
  }).kind, "restored", "a pin exactly at the limit is still restored");

  const expired = memoryStorage();
  await uncertainPinnedGrant(expired.storage);
  assert.deepEqual(membershipRestorePendingGrant(expired.storage, {
    admin: ADMIN, uid: 321, detail: detail(null), now: T0 + MEMBERSHIP_PENDING_GRANT_TTL_MS + 1,
  }), { kind: "expired" });
  assert.equal(expired.entries.size, 0, "an expired pin is removed");
  assert.deepEqual(membershipRestorePendingGrant(expired.storage, {
    admin: ADMIN, uid: 321, detail: detail(null), now: T0 + MEMBERSHIP_PENDING_GRANT_TTL_MS + 2,
  }), { kind: "none" }, "an expired pin is reported once");

  const future = memoryStorage();
  await uncertainPinnedGrant(future.storage);
  assert.deepEqual(membershipRestorePendingGrant(future.storage, {
    admin: ADMIN, uid: 321, detail: detail(null), now: T0 - 5 * 60_000,
  }), { kind: "none" });
  assert.equal(future.entries.size, 0, "a pin dated in the future was not written by this flow");
});

test("a malformed or tampered stored grant pin is removed and never replayed", async () => {
  const key = membershipPendingGrantStorageKey(ADMIN, 321)!;
  const { storage, entries } = memoryStorage();
  await uncertainPinnedGrant(storage);
  const valid = JSON.parse(entries.get(key)!);
  const fingerprint = JSON.parse(valid.fingerprint);

  const tampered: Array<[string, unknown]> = [
    ["not JSON", "{"],
    ["an extra key", { ...valid, admin: ADMIN }],
    ["a missing key", { ...valid, created_at: undefined }],
    ["another version", { ...valid, version: 2 }],
    ["another member", { ...valid, uid: 999 }],
    ["a malformed request ID", { ...valid, request_id: "retry-1" }],
    ["a baseline at another revision than the body", { ...valid, baseline: { grant_id: null, revision: 1 } }],
    ["a baseline at another identity than the body", { ...valid, baseline: { grant_id: GRANT_A, revision: 0 } }],
    ["an empty baseline grant ID", { ...valid, baseline: { grant_id: "", revision: 0 } }],
    ["a non-canonical fingerprint", { ...valid, fingerprint: JSON.stringify(fingerprint, null, 1) }],
    ["a body for another member", { ...valid, fingerprint: JSON.stringify({ ...fingerprint, uid: 999 }) }],
    ["an unknown body key", { ...valid, fingerprint: JSON.stringify({ ...fingerprint, tier: "plus" }) }],
    ["an unknown preset", { ...valid, fingerprint: JSON.stringify({ ...fingerprint, preset_id: "plus_year" }) }],
    ["a custom preset without expiry", { ...valid, fingerprint: JSON.stringify({ ...fingerprint, preset_id: "custom" }) }],
    ["an unnormalized reason", { ...valid, fingerprint: JSON.stringify({ ...fingerprint, reason: " Support  recovery" }) }],
    ["a zero creation time", { ...valid, created_at: 0 }],
  ];
  for (const [label, value] of tampered) {
    entries.set(key, typeof value === "string" ? value : JSON.stringify(value));
    assert.deepEqual(
      membershipRestorePendingGrant(storage, { admin: ADMIN, uid: 321, detail: detail(null), now: T0 + 60_000 }),
      { kind: "none" },
      label,
    );
    assert.equal(entries.has(key), false, `${label} is removed`);
  }
});

test("a restored pin is released when the loaded member no longer has the baseline grant", async () => {
  const { storage, entries } = memoryStorage();
  await uncertainPinnedGrant(storage);
  assert.deepEqual(membershipRestorePendingGrant(storage, {
    admin: ADMIN, uid: 321, detail: detail(grantWire("g9", 1)), now: T0 + 60_000,
  }), { kind: "resolved" }, "the grant changed while the page was away: most likely the request applied");
  assert.equal(entries.size, 0);
});

test("an unavailable member detail neither restores nor releases a stored pin", async () => {
  const { storage, entries } = memoryStorage();
  await uncertainPinnedGrant(storage);
  const unavailable = membershipUserDetail(unavailableWire());
  assert.ok(unavailable);
  assert.deepEqual(membershipRestorePendingGrant(storage, {
    admin: ADMIN, uid: 321, detail: unavailable, now: T0 + 60_000,
  }), { kind: "none" });
  assert.equal(entries.size, 1, "the pin waits for a readable member");
  assert.equal(membershipRestorePendingGrant(storage, {
    admin: ADMIN, uid: 321, detail: detail(null), now: T0 + 90_000,
  }).kind, "restored");
});

test("a definite refusal or a discard clears the stored pin; an unreadable member keeps it", async () => {
  const refusal = memoryStorage();
  const { pending } = await uncertainPinnedGrant(refusal.storage);
  const refused = mockCall([
    ["membership_user_detail", { success: true, data: detailWire(null) }],
    ["membership_admin_grant", { success: false, error: "membership-admin-reason-invalid" }],
  ]);
  const refusedResult = await membershipSubmitGrant(refused.call, {
    uid: 321, pending, detail: detail(null), preview: null, body: GRANT_BODY, mintRequestId: minter(),
    persist: (pinned) => { membershipRememberPendingGrant(refusal.storage, ADMIN, 321, pinned, T0 + 60_000); },
  });
  assert.equal(refusedResult.kind, "refused");
  membershipRememberPendingGrant(refusal.storage, ADMIN, 321, refusedResult.pending, T0 + 60_000);
  assert.equal(refusal.entries.size, 0, "a refusal releases the stored identity");

  const discard = memoryStorage();
  const discarded = await uncertainPinnedGrant(discard.storage);
  const unreadable = mockCall([["membership_user_detail", null]]);
  assert.equal((await membershipCheckPendingGrant(unreadable.call, 321, discarded.pending)).kind, "unreadable");
  assert.equal(discard.entries.size, 1, "without a fresh read the pin stays stored");
  const unchanged = mockCall([["membership_user_detail", { success: true, data: detailWire(null) }]]);
  assert.equal((await membershipCheckPendingGrant(unchanged.call, 321, discarded.pending)).kind, "unchanged");
  assert.equal(membershipClearPendingGrant(discard.storage, ADMIN, 321), true);
  assert.equal(discard.entries.size, 0, "a discard releases the stored identity");
});

test("storage that throws never blocks a grant or escapes the persistence helpers", async () => {
  const broken = memoryStorage({ get: true, set: true, remove: true });
  const bridge = mockCall([["membership_admin_grant", { success: true, data: detailWire(grantWire("g1", 1)) }]]);
  const result = await membershipSubmitGrant(bridge.call, {
    uid: 321, pending: null, detail: detail(null), preview: preview(0), body: GRANT_BODY, mintRequestId: minter(),
    persist: (pinned) => { assert.equal(membershipRememberPendingGrant(broken.storage, ADMIN, 321, pinned, T0), false); },
  });
  bridge.done();
  assert.equal(result.kind, "granted", "the grant is still sent with an in-memory pin");
  const pending: MembershipPendingGrant = {
    pinned: { fingerprint: "{}", body: { request_id: "00000000-0000-4000-8000-000000000001" } },
    baseline: { grant_id: null, revision: 0 },
    uncertain: true,
  };
  assert.equal(membershipStorePendingGrant(broken.storage, ADMIN, 321, pending, T0), false, "an unrestorable pin is never written");
  assert.equal(membershipClearPendingGrant(broken.storage, ADMIN, 321), false);
  assert.deepEqual(membershipRestorePendingGrant(broken.storage, { admin: ADMIN, uid: 321, detail: detail(null), now: T0 }), { kind: "none" });

  const writeOnlyFails = memoryStorage({ set: true });
  const { pending: pinned } = await uncertainPinnedGrant(writeOnlyFails.storage);
  assert.equal(membershipStorePendingGrant(writeOnlyFails.storage, ADMIN, 321, pinned, T0), false);
  assert.equal(membershipSessionStorage(), null, "outside a browser there is no session storage");

  const removeFails = memoryStorage({ remove: true });
  removeFails.entries.set(membershipPendingGrantStorageKey(ADMIN, 321)!, "{");
  assert.deepEqual(
    membershipRestorePendingGrant(removeFails.storage, { admin: ADMIN, uid: 321, detail: detail(null), now: T0 }),
    { kind: "none" },
    "a malformed entry that cannot be removed is still ignored",
  );

  const source = readFileSync(new URL("../lib/membershipFlows.ts", import.meta.url), "utf8");
  assert.match(source, /try \{\s*return typeof window === "undefined" \? null : window\.sessionStorage;\s*\} catch \{/,
    "even reaching sessionStorage can throw and is guarded");
});

test("the member panel routes grants through the pinned flow and locks competing mutations", () => {
  const panel = readFileSync(new URL("../components/UserMembershipPanel.tsx", import.meta.url), "utf8");
  // Grants never mint a fresh identity in the panel; the flow pins and replays it.
  assert.doesNotMatch(panel, /adminCall\("membership_admin_grant",/);
  assert.match(panel, /membershipSubmitGrant\(adminCall, \{/);
  assert.match(panel, /persist: \(pinned\) => \{\s*membershipRememberPendingGrant\(/);
  assert.match(panel, /setAdminScope\(membershipAdminScope\(response\?\.email\)\)/);
  assert.match(panel, /membershipRestorePendingGrant\(membershipSessionStorage\(\)/);
  assert.match(panel, /result\.kind === "previewStale"\) \{[\s\S]*setPreview\(null\);[\s\S]*grant\.previewStale/);
  // A pending grant locks the grant form, the expiry editor and revocation.
  assert.match(panel, /const grantLocked = pendingGrant !== null;/);
  assert.match(panel, /const expiryValid = canEditGrant && !grantLocked/);
  assert.match(panel, /if \(!owner \|\| grantLocked \|\|/);
  assert.match(panel, /disabled=\{!validReason\(expiryReason\) \|\| Boolean\(busy\) \|\| grantLocked\}/);
  // Expiry and revoke read the authoritative member after an unknown outcome.
  for (const [action, kind] of [["membership_admin_grant_update", "expiry_update"], ["membership_admin_grant_revoke", "grant_revoke"]]) {
    assert.match(panel, new RegExp(`adminCall\\("${action}", \\{\\s*uid,\\s*expected_revision: currentGrant.revision,\\s*expected_grant_id: currentGrant.grant_id,`));
    assert.match(panel, new RegExp(`membershipMutationOutcome\\("${kind}", response, adopted\\)[\\s\\S]*if \\(outcome === "uncertain" \\|\\| outcome === "conflict"\\) await reloadDetail\\(\\);`));
  }
  // A discard reads first and keeps the pin when the member cannot be read.
  assert.match(panel, /async function discardPendingGrant\(\) \{[\s\S]*membershipCheckPendingGrant\([\s\S]*grant\.discardUnreadable/);
});

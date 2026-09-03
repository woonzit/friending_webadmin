import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import test from "node:test";
import {
  ADMIN_ACTION_ACCESS,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  INTO_TAG_MODERATION_ACTIONS,
  INTO_TAG_MODERATION_ERROR_KEYS,
  INTO_TAG_MODERATION_ERROR_STATUSES,
  INTO_TAG_MODERATION_TABS,
  intoTagModerationAuditId,
  intoTagModerationCanDecide,
  intoTagModerationConflictResponse,
  intoTagModerationDecidePayload,
  intoTagModerationDecisionResponse,
  intoTagModerationErrorKey,
  intoTagModerationErrorResponse,
  intoTagModerationItem,
  intoTagModerationListResponse,
  intoTagModerationMergeTargets,
  intoTagModerationSettingsPayload,
  intoTagModerationSettingsResponse,
  intoTagModerationShouldRetainRequest,
  normalizeIntoTagModerationReason,
  type IntoTagModerationItem,
} from "../lib/intoTagModeration.ts";

type JsonObject = Record<string, unknown>;

const CORPUS = new URL(
  "./fixtures/into_tag_moderation_wire/t682-into-tag-moderation-envelopes.json",
  import.meta.url,
);
const CORPUS_BYTES = readFileSync(CORPUS);
const corpus = JSON.parse(CORPUS_BYTES.toString("utf8")) as {
  webadmin_actions: Record<string, {
    route: string;
    capability: string;
    envelopes: Array<{ case: string; request: JsonObject; response: JsonObject }>;
  }>;
};

const READ_FILE = (path: string) =>
  new Promise<string>((resolve, reject) =>
    readFile(new URL(path, import.meta.url), "utf8", (error, value) =>
      error ? reject(error) : resolve(value)));

/** One captured Core body, by action and the corpus's own case label. */
function envelope(action: string, label: string): JsonObject {
  const found = corpus.webadmin_actions[action]?.envelopes.find((row) => row.case === label);
  assert.ok(found, `${action} / ${label} must exist in the corpus`);
  return structuredClone(found.response);
}

function request(action: string, label: string): JsonObject {
  const found = corpus.webadmin_actions[action]?.envelopes.find((row) => row.case === label);
  assert.ok(found, `${action} / ${label} must exist in the corpus`);
  return structuredClone(found.request);
}

function data(value: JsonObject): JsonObject {
  assert.ok(value.data && typeof value.data === "object");
  return value.data as JsonObject;
}

function items(value: JsonObject): JsonObject[] {
  return data(value).items as JsonObject[];
}

const UUID = "0f9e2f7a-1c4d-4f9b-9a02-6b6f9d2ac311";
const OTHER_UUID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

test("the fixture is the published T-682 capture, byte for byte", () => {
  // Provenance, not decoration. Every decoder below was written against THESE
  // bytes rather than the design prose, so an edited body must fail here.
  assert.equal(
    createHash("sha256").update(CORPUS_BYTES).digest("hex"),
    "42bf71bcd5178e9579dbb8118cc9c21d60ef769fd30a35f05cc46786b61ba1ce",
    "re-copy team/handoffs/t682-into-tag-moderation-envelopes.json and update this digest",
  );
  assert.deepEqual(Object.keys(corpus.webadmin_actions).sort(), [
    "into_tag_moderation_decide",
    "into_tag_moderation_list",
    "into_tag_moderation_settings",
    "save_profile_tag_catalog",
  ]);
  // Core gates the read on its own capability and the two mutations on the
  // decide capability; the console must not conflate the two.
  assert.equal(corpus.webadmin_actions.into_tag_moderation_list.capability, "into_tag_moderation_read");
  assert.equal(corpus.webadmin_actions.into_tag_moderation_decide.capability, "into_tag_moderation");
  assert.equal(corpus.webadmin_actions.into_tag_moderation_settings.capability, "into_tag_moderation");
});

test("the captured list envelopes decode as exact, ordered, single-state pages", () => {
  const first = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 pending, first page"));
  assert.ok(first);
  assert.equal(first.state, "pending");
  assert.deepEqual(first.items.map((row) => row.key), ["board-games", "bouldering", "ice-baths"]);
  // The cursor IS the last key of the page, not an opaque token.
  assert.equal(first.next_cursor, "ice-baths");
  assert.deepEqual(first.counts, { approved: 3, pending: 7, rejected: 1, merged: 1 });
  assert.equal(first.member_creation_enabled, true);
  assert.equal(first.revision, 1);
  assert.equal(first.items[0].provenance, "member");
  assert.equal(first.items[0].created_by_uid, 70001);
  assert.equal(first.items[0].active, false);

  const second = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 pending, second page (cursor)"));
  assert.ok(second);
  assert.equal(request("into_tag_moderation_list", "200 pending, second page (cursor)").cursor, "board-games");
  assert.equal(second.next_cursor, "kitesurf-school");

  const rejected = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 rejected (the ban list)"));
  assert.ok(rejected);
  assert.equal(rejected.items[0].moderation_state, "rejected");
  assert.equal(rejected.items[0].provenance, "legacy-user-created");
  assert.equal(rejected.items[0].moderated_by, "moderator@friending.com");
  // A last page reports the empty string, never null.
  assert.equal(rejected.next_cursor, "");

  const merged = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 merged (the aliases)"));
  assert.ok(merged);
  assert.equal(merged.items[0].merged_into, "music");
  assert.equal(merged.items[0].moderation_state, "merged");
});

test("the four tabs are the four states Core filters by, in the reviewed order", () => {
  assert.deepEqual([...INTO_TAG_MODERATION_TABS], ["pending", "approved", "rejected", "merged"]);
  for (const tab of INTO_TAG_MODERATION_TABS) {
    // Every tab must be a state the captured list envelopes can actually
    // answer with; a tab Core would refuse is a dead tab.
    assert.ok(["pending", "approved", "rejected", "merged"].includes(tab));
  }
});

test("a malformed page fails closed instead of rendering as a shorter queue", () => {
  for (const mutate of [
    // A row of another state on a filtered tab: the operator would approve a
    // row they believe is pending.
    (raw: JsonObject) => { (items(raw)[0] as JsonObject).moderation_state = "approved"; },
    // The invariant `active === true => approved`.
    (raw: JsonObject) => { (items(raw)[0] as JsonObject).active = true; },
    // A merge target on a row that is not merged, and the reverse.
    (raw: JsonObject) => { (items(raw)[0] as JsonObject).merged_into = "music"; },
    // Out of order, so an appended page could not be trusted to continue.
    (raw: JsonObject) => { data(raw).items = [items(raw)[1], items(raw)[0], items(raw)[2]]; },
    // A duplicate key inside one page.
    (raw: JsonObject) => { data(raw).items = [items(raw)[0], items(raw)[0]]; },
    // A cursor that is not the last key served.
    (raw: JsonObject) => { data(raw).next_cursor = "zzz-not-a-page"; },
    (raw: JsonObject) => { data(raw).next_cursor = null; },
    (raw: JsonObject) => { data(raw).revision = -1; },
    (raw: JsonObject) => { data(raw).member_creation_enabled = "true"; },
    (raw: JsonObject) => { delete data(raw).counts; },
    (raw: JsonObject) => { (data(raw).counts as JsonObject).pending = "7"; },
    (raw: JsonObject) => { data(raw).schema_version = 2; },
    (raw: JsonObject) => { delete data(raw).principal; },
    (raw: JsonObject) => { raw.success = false; },
    (raw: JsonObject) => { raw.status_code = 503; },
    (raw: JsonObject) => { raw.message = 0; },
  ]) {
    const raw = envelope("into_tag_moderation_list", "200 pending, first page");
    mutate(raw);
    assert.equal(intoTagModerationListResponse(raw), null, mutate.toString());
  }

  // Additive Core fields stay tolerated; the contract is closed, not frozen.
  const additive = envelope("into_tag_moderation_list", "200 pending, first page");
  additive.trace_id = "not-contracted";
  data(additive).debug = true;
  (items(additive)[0] as JsonObject).future_field = 1;
  assert.ok(intoTagModerationListResponse(additive));
});

test("an empty page is a proven empty queue, and only with an empty cursor", () => {
  const empty = envelope("into_tag_moderation_list", "200 merged (the aliases)");
  data(empty).items = [];
  const parsed = intoTagModerationListResponse(empty);
  assert.ok(parsed);
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.next_cursor, "");

  const contradictory = envelope("into_tag_moderation_list", "200 merged (the aliases)");
  data(contradictory).items = [];
  data(contradictory).next_cursor = "michaeljackson";
  assert.equal(intoTagModerationListResponse(contradictory), null);
});

test("capabilities, not role names, decide whether the controls exist", () => {
  const owner = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 pending, first page"));
  const viewer = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 as a viewer (read only)"));
  assert.ok(owner);
  assert.ok(viewer);
  assert.deepEqual(owner.principal.capabilities, ["into_tag_moderation_read", "into_tag_moderation"]);
  assert.deepEqual(viewer.principal.capabilities, ["into_tag_moderation_read"]);
  assert.equal(intoTagModerationCanDecide(owner.principal), true);
  assert.equal(intoTagModerationCanDecide(viewer.principal), false);

  // A viewer whose ROLE happens to read "owner" still cannot decide.
  const roleOnly = envelope("into_tag_moderation_list", "200 as a viewer (read only)");
  (data(roleOnly).principal as JsonObject).role = "owner";
  const parsed = intoTagModerationListResponse(roleOnly);
  assert.ok(parsed);
  assert.equal(intoTagModerationCanDecide(parsed.principal), false);

  for (const capabilities of [
    ["into_tag_moderation"],
    ["into_tag_moderation", "into_tag_moderation_read"],
    ["into_tag_moderation_read", "into_tag_moderation_read"],
    ["into_tag_moderation_read", "reported_content_decide"],
    [],
  ]) {
    const raw = envelope("into_tag_moderation_list", "200 pending, first page");
    (data(raw).principal as JsonObject).capabilities = capabilities;
    assert.equal(intoTagModerationListResponse(raw), null, JSON.stringify(capabilities));
  }
});

test("the captured decide receipts decode with their propagation counts", () => {
  const approve = intoTagModerationDecisionResponse(envelope("into_tag_moderation_decide", "200 approve"));
  assert.ok(approve);
  assert.equal(approve.revision, 2);
  assert.equal(approve.item.key, "bouldering");
  assert.equal(approve.item.moderation_state, "approved");
  assert.equal(approve.item.active, true);
  assert.equal(approve.replayed, false);
  // An approval touches nobody: it only widens what may be picked.
  assert.deepEqual(approve.propagated, { selections: 0, userinfo: 0, user_into: 0, used_into: 0, filters: 0 });

  const reject = intoTagModerationDecisionResponse(envelope("into_tag_moderation_decide", "200 reject (with propagation counts)"));
  assert.ok(reject);
  assert.equal(reject.item.moderation_state, "rejected");
  assert.equal(reject.item.active, false);
  // A rejection is a deletion from every holder, and the receipt says so.
  assert.deepEqual(reject.propagated, { selections: 1, userinfo: 1, user_into: 1, used_into: 1, filters: 1 });

  const merge = intoTagModerationDecisionResponse(envelope("into_tag_moderation_decide", "200 merge"));
  assert.ok(merge);
  assert.equal(merge.item.merged_into, "hiking");
  assert.equal(merge.counts.merged, 2);
});

test("a replay is distinguished from a first application by the receipt alone", () => {
  const applied = intoTagModerationDecisionResponse(envelope("into_tag_moderation_decide", "200 merge"));
  const replayed = intoTagModerationDecisionResponse(envelope("into_tag_moderation_decide", "200 replay of an identical request"));
  assert.ok(applied);
  assert.ok(replayed);
  assert.equal(applied.replayed, false);
  assert.equal(replayed.replayed, true);
  // Same request id, same audit id, same resulting revision: retrying an
  // uncertain write is safe precisely because these three agree.
  assert.equal(applied.audit_id, replayed.audit_id);
  assert.equal(applied.revision, replayed.revision);
  assert.deepEqual(applied.item, replayed.item);
  assert.equal(
    request("into_tag_moderation_decide", "200 replay of an identical request").request_id,
    request("into_tag_moderation_decide", "200 merge").request_id,
  );
});

test("a decision receipt that still reads pending is not proof of a decision", () => {
  const raw = envelope("into_tag_moderation_decide", "200 approve");
  (data(raw).item as JsonObject).moderation_state = "pending";
  (data(raw).item as JsonObject).active = false;
  assert.equal(intoTagModerationDecisionResponse(raw), null);

  for (const mutate of [
    (value: JsonObject) => { delete data(value).propagated; },
    (value: JsonObject) => { (data(value).propagated as JsonObject).filters = "1"; },
    (value: JsonObject) => { data(value).audit_id = "bc3f83cd"; },
    (value: JsonObject) => { data(value).audit_id = "wai:not-hex"; },
    (value: JsonObject) => { data(value).replayed = "false"; },
    (value: JsonObject) => { delete data(value).revision; },
  ]) {
    const broken = envelope("into_tag_moderation_decide", "200 approve");
    mutate(broken);
    assert.equal(intoTagModerationDecisionResponse(broken), null, mutate.toString());
  }
});

test("the settings action carries the same revision, receipt and replay contract", () => {
  const enabled = intoTagModerationSettingsResponse(envelope("into_tag_moderation_settings", "200 enable"));
  const replay = intoTagModerationSettingsResponse(envelope("into_tag_moderation_settings", "200 replay of an identical request"));
  assert.ok(enabled);
  assert.ok(replay);
  assert.equal(enabled.member_creation_enabled, true);
  assert.equal(enabled.revision, 1);
  assert.equal(enabled.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(enabled.audit_id, replay.audit_id);
  // The captured enable request carries the DEFAULT-off revision 0, which is
  // the state the plane ships in and must stay in through the import window.
  assert.equal(request("into_tag_moderation_settings", "200 enable").expected_revision, 0);
});

test("the 409 hands back the authoritative plane state for both writes", () => {
  for (const raw of [
    envelope("into_tag_moderation_decide", "409 stale expected_revision"),
    envelope("into_tag_moderation_settings", "409 stale expected_revision"),
  ]) {
    const conflict = intoTagModerationConflictResponse(raw);
    assert.ok(conflict);
    assert.ok(conflict.current.revision > 0);
    assert.equal(typeof conflict.current.member_creation_enabled, "boolean");
    assert.equal(typeof conflict.current.counts.pending, "number");
    // The recoverable conflict must not also decode as a flat refusal, or the
    // console would show a dead end instead of adopting the current state.
    assert.equal(intoTagModerationErrorResponse(raw), null);
    assert.equal(intoTagModerationDecisionResponse(raw), null);
  }

  // A request id reused with NEW material is a conflict without data: there is
  // nothing to adopt, because the id itself is spent.
  const spent = envelope("into_tag_moderation_decide", "409 request id reused with new material");
  assert.equal(intoTagModerationConflictResponse(spent), null);
  assert.equal(intoTagModerationErrorResponse(spent), null);
  assert.equal(spent.error, "into-tag-moderation-conflict");
});

test("every captured refusal routes to localized copy at its exact status", () => {
  const captured: Array<[string, string, string]> = [
    ["into_tag_moderation_list", "422 unknown state", "into-tag-state-invalid"],
    ["into_tag_moderation_list", "401 unknown operator", "catalog-admin-session-invalid"],
    ["into_tag_moderation_list", "403 revoked operator", "catalog-admin-revoked"],
    ["into_tag_moderation_decide", "422 unknown verdict", "into-tag-verdict-invalid"],
    ["into_tag_moderation_decide", "422 merge target not approved", "into-tag-merge-target-invalid"],
    ["into_tag_moderation_decide", "422 malformed request id", "into-tag-request-invalid"],
    ["into_tag_moderation_decide", "404 unknown key", "into-tag-item-not-found"],
    ["into_tag_moderation_decide", "403 viewer may not decide", "catalog-admin-capability-required"],
  ];
  for (const [action, label, code] of captured) {
    const raw = envelope(action, label);
    assert.equal(intoTagModerationErrorResponse(raw), code, label);
    assert.equal(raw.status_code, INTO_TAG_MODERATION_ERROR_STATUSES[code as keyof typeof INTO_TAG_MODERATION_ERROR_STATUSES], label);
    assert.notEqual(intoTagModerationErrorKey(code), "generic", label);
  }

  // A known code served at the wrong status is not the refusal it claims to be.
  const wrongStatus = envelope("into_tag_moderation_decide", "404 unknown key");
  wrongStatus.status_code = 422;
  assert.equal(intoTagModerationErrorResponse(wrongStatus), null);

  // The same-origin bridge's own transport failures still route.
  assert.equal(
    intoTagModerationErrorKey(intoTagModerationErrorResponse({ success: false, status_code: 502, error: "core-unavailable" })),
    "generic",
  );
  assert.equal(intoTagModerationErrorKey("unknown-code"), "generic");
  assert.equal(intoTagModerationErrorKey(null), "generic");
});

test("only a terminal refusal releases the request id", () => {
  // Anything that leaves the outcome unknown keeps the id, so a retry replays
  // rather than deciding a second time.
  for (const uncertain of [null, "", "core-timeout", "core-unavailable", "into-tag-moderation-write-failed", "into-tag-moderation-unavailable"]) {
    assert.equal(intoTagModerationShouldRetainRequest(uncertain), true, String(uncertain));
  }
  for (const terminal of Object.keys(INTO_TAG_MODERATION_ERROR_KEYS).filter((code) =>
    !code.endsWith("write-failed") && !code.endsWith("moderation-unavailable"))) {
    assert.equal(intoTagModerationShouldRetainRequest(terminal), false, terminal);
  }
});

test("the decide body is minted exactly as the captured requests are shaped", () => {
  const approve = intoTagModerationDecidePayload("bouldering", "approve", undefined, "a real activity", 1, UUID);
  assert.deepEqual(approve, {
    request_id: UUID,
    expected_revision: 1,
    key: "bouldering",
    verdict: "approve",
    reason: "a real activity",
  });
  // `merge_into` is ABSENT on approve/reject, exactly as the captured requests
  // are; a non-empty one there is refused by Core outright.
  assert.equal(Object.hasOwn(approve!, "merge_into"), false);
  assert.equal(intoTagModerationDecidePayload("bouldering", "approve", "hiking", "", 1, UUID), null);

  const merge = intoTagModerationDecidePayload("night-hiking", "merge", "hiking", "a variant", 3, UUID);
  assert.equal(merge?.merge_into, "hiking");
  // Merging a row into itself, or with no target at all, is refused locally.
  assert.equal(intoTagModerationDecidePayload("hiking", "merge", "hiking", "", 3, UUID), null);
  assert.equal(intoTagModerationDecidePayload("night-hiking", "merge", "", "", 3, UUID), null);

  // A reason is optional, and Core squeezes whitespace before measuring, so
  // the console measures the same string Core will store.
  assert.equal(intoTagModerationDecidePayload("bouldering", "approve", undefined, "  spaced   out  ", 1, UUID)?.reason, "spaced out");
  assert.equal(normalizeIntoTagModerationReason(""), "");
  assert.equal(normalizeIntoTagModerationReason("x".repeat(500))?.length, 500);
  assert.equal(normalizeIntoTagModerationReason("x".repeat(501)), null);
  assert.equal(normalizeIntoTagModerationReason(42), null);

  for (const badRequestId of ["not-a-uuid", "", UUID.toUpperCase(), "0f9e2f7a-1c4d-1f9b-9a02-6b6f9d2ac311"]) {
    assert.equal(intoTagModerationDecidePayload("bouldering", "approve", undefined, "", 1, badRequestId), null, badRequestId);
  }
  assert.equal(intoTagModerationDecidePayload("bouldering", "ban", undefined, "", 1, UUID), null);
  assert.equal(intoTagModerationDecidePayload("Bouldering", "approve", undefined, "", 1, UUID), null);
  assert.equal(intoTagModerationDecidePayload("bouldering", "approve", undefined, "", -1, UUID), null);

  const settings = intoTagModerationSettingsPayload(false, 4, OTHER_UUID);
  assert.deepEqual(settings, { request_id: OTHER_UUID, expected_revision: 4, member_creation_enabled: false });
  assert.equal(intoTagModerationSettingsPayload("false", 4, OTHER_UUID), null);
  assert.equal(intoTagModerationSettingsPayload(false, 4, "nope"), null);
});

test("the audit receipt is derivable from the request the browser sent", async () => {
  // `wai:sha256(family NUL request_id)`. Every captured receipt is checked
  // against its own captured request id, so a receipt bound to some other
  // request cannot pass as proof that this one landed.
  const receipts: Array<[string, string]> = [
    ["into_tag_moderation_decide", "200 approve"],
    ["into_tag_moderation_decide", "200 merge"],
    ["into_tag_moderation_settings", "200 enable"],
  ];
  for (const [action, label] of receipts) {
    const requestId = request(action, label).request_id as string;
    const auditId = data(envelope(action, label)).audit_id as string;
    assert.equal(await intoTagModerationAuditId(requestId), auditId, label);
  }
  assert.notEqual(await intoTagModerationAuditId(UUID), await intoTagModerationAuditId(OTHER_UUID));
  assert.equal(await intoTagModerationAuditId("not-a-uuid"), null);
});

test("a merge target must be approved, active and not the row being merged", () => {
  const parsed = intoTagModerationListResponse(envelope("into_tag_moderation_list", "200 pending, first page"));
  assert.ok(parsed);
  const approved = (state: string, active: boolean, key: string): IntoTagModerationItem => ({
    ...parsed.items[0],
    key,
    label: key,
    label_hu: key,
    moderation_state: state as IntoTagModerationItem["moderation_state"],
    active,
    merged_into: state === "merged" ? "music" : "",
  });
  const pool = [
    approved("approved", true, "hiking"),
    approved("approved", false, "archived-hiking"),
    approved("pending", false, "night-hiking"),
    approved("rejected", false, "smoking"),
    approved("merged", false, "michaeljackson"),
  ];
  assert.deepEqual(intoTagModerationMergeTargets(pool, "night-hiking", "").map((row) => row.key), ["hiking"]);
  assert.deepEqual(intoTagModerationMergeTargets(pool, "hiking", "").map((row) => row.key), []);
  assert.deepEqual(intoTagModerationMergeTargets(pool, "x", "HIK").map((row) => row.key), ["hiking"]);
  assert.deepEqual(intoTagModerationMergeTargets(pool, "x", "nothing").map((row) => row.key), []);
});

test("a row decodes only with the whole contracted field set", () => {
  const row = items(envelope("into_tag_moderation_list", "200 pending, first page"))[0] as JsonObject;
  assert.ok(intoTagModerationItem(structuredClone(row)));
  for (const key of Object.keys(row)) {
    const missing = structuredClone(row);
    delete missing[key];
    assert.equal(intoTagModerationItem(missing), null, `missing ${key}`);
  }
  // The migration actor is not an email, so `moderated_by` must not be one.
  const migrated = structuredClone(row);
  migrated.moderation_state = "rejected";
  migrated.moderated_by = "migration:into-tag-moderation-v1";
  migrated.moderated_at = 1788099000;
  assert.equal(intoTagModerationItem(migrated)?.moderated_by, "migration:into-tag-moderation-v1");
  // A fold conflict parks the fold, and a stored row can predate provenance.
  const foldless = structuredClone(row);
  foldless.label_fold = "";
  foldless.provenance = "";
  assert.equal(intoTagModerationItem(foldless)?.provenance, "");
});

test("the three actions are allow-listed at the reviewed access floor", () => {
  for (const action of INTO_TAG_MODERATION_ACTIONS) {
    assert.ok(isAdminActionAllowed(action), action);
  }
  assert.equal(ADMIN_ACTION_ACCESS.into_tag_moderation_list, "read");
  assert.equal(ADMIN_ACTION_ACCESS.into_tag_moderation_decide, "write");
  assert.equal(ADMIN_ACTION_ACCESS.into_tag_moderation_settings, "write");

  const viewer = adminPrincipalFrom({ success: true, role: "viewer" });
  const editor = adminPrincipalFrom({ success: true, role: "admin" });
  assert.equal(isAdminActionAuthorized("into_tag_moderation_list", viewer), true);
  // The global viewer/editor floor is independent of Core's own capability
  // check, and a viewer must fail it before the request is ever forwarded.
  assert.equal(isAdminActionAuthorized("into_tag_moderation_decide", viewer), false);
  assert.equal(isAdminActionAuthorized("into_tag_moderation_settings", viewer), false);
  assert.equal(isAdminActionAuthorized("into_tag_moderation_decide", editor), true);
  assert.equal(isAdminActionAllowed("into_tag_moderation_delete"), false);
});

test("the queue renders the receipted surfaces the contract requires", async () => {
  const source = await READ_FILE("../components/IntoTagModerationQueue.tsx");

  // The four tabs, the cursor page and the capability gate.
  assert.match(source, /INTO_TAG_MODERATION_TABS\.map/u);
  assert.match(source, /role="tablist"/u);
  assert.match(source, /aria-selected=\{tab === value\}/u);
  assert.match(source, /load\(nextCursor, true\)/u);
  assert.match(source, /state === "forbidden"/u);
  assert.match(source, /forbiddenTitle/u);
  assert.match(source, /intoTagModerationCanDecide\(principal\)/u);
  assert.doesNotMatch(source, /principal\.role === /u, "the role must never gate a control");

  // Every write carries a freshly minted request id and the plane revision.
  assert.match(source, /crypto\.randomUUID\(\)/u);
  assert.match(source, /revisionRef\.current/u);
  assert.match(source, /intoTagModerationShouldRetainRequest/u);
  assert.match(source, /retryPending/u);

  // Conflict adopts the current state and re-reads rather than guessing.
  assert.match(source, /intoTagModerationConflictResponse/u);
  assert.match(source, /adoptConflict/u);

  // The receipt is rendered with its replay flag and verified against the id.
  assert.match(source, /intoTagModerationAuditId/u);
  assert.match(source, /receiptReplayed/u);

  // Bulk decisions, the merge picker and the member-creation switch.
  assert.match(source, /selected\.length === 0/u);
  assert.match(source, /intoTagModerationMergeTargets/u);
  assert.match(source, /into_tag_moderation_settings/u);
  assert.match(source, /switch-track/u);

  // A rejection removes a tag from every holder and bans it, so it is never
  // one click: it opens the reason dialog, and approve opens a confirm.
  assert.match(source, /ConfirmDialog/u);
  assert.match(source, /setDraft\(\{ verdict, keys, reason: "", mergeInto: "" \}\)/u);
  assert.match(source, /setApproveConfirm\(keys\)/u);
  assert.match(source, /button-danger/u);
});

test("/profile-tags round-trips the moderation state and routes its refusal", async () => {
  const page = await READ_FILE("../app/(dashboard)/profile-tags/page.tsx");
  const lib = await READ_FILE("../lib/profilePresentation.ts");

  // T-686 B-5: the whole-catalogue save must carry `moderation_state`.
  assert.match(lib, /moderation_state: item\.moderation_state/u);
  assert.match(lib, /item\.moderation_state === null \? \{\} :/u);

  assert.match(page, /profile-tag-item-moderation-locked/u);
  assert.match(page, /moderationLocked/u);
  assert.match(page, /isTagModerationLocked/u);
  assert.match(page, /moderationStates\./u);
  assert.match(page, /disabled=\{busy \|\| locked\}/u);
});

test("both locales name every closed into-tag vocabulary", async () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await READ_FILE(`../messages/${locale}.json`)) as JsonObject;
    const namespace = messages.intoTagModeration as JsonObject;
    assert.ok(namespace, locale);
    assert.deepEqual(Object.keys(namespace.states as JsonObject).sort(), ["approved", "merged", "pending", "rejected"]);
    assert.deepEqual(Object.keys(namespace.verdicts as JsonObject).sort(), ["approve", "merge", "reject"]);
    assert.deepEqual(Object.keys(namespace.provenance as JsonObject).sort(), [
      "admin",
      "legacy-user-created",
      "member",
      "seed",
      "unknown",
    ]);
    // Every routable refusal has copy, plus the two browser-side ones.
    const errorKeys = Object.values(INTO_TAG_MODERATION_ERROR_KEYS);
    assert.deepEqual(
      Object.keys(namespace.errors as JsonObject).sort(),
      [...new Set([...errorKeys, "generic", "reasonInvalid", "mergeTargets"])].sort(),
      locale,
    );
    assert.equal(typeof (messages.nav as JsonObject).intoTagModeration, "string");
    // The catalogue editor names the states it now badges.
    const profileTags = messages.profileTags as JsonObject;
    assert.deepEqual(Object.keys(profileTags.moderationStates as JsonObject).sort(), [
      "approved",
      "merged",
      "pending",
      "rejected",
      "unstated",
    ]);
    assert.equal(typeof profileTags.moderationLocked, "string");
  }
});

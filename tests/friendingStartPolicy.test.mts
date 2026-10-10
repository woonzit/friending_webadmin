import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminActionBodyLimit,
  adminActionTimeoutMs,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import {
  FRIENDING_START_METHODS,
  FRIENDING_START_POLICY_ACTIONS,
  FRIENDING_START_POLICY_ERROR_STATUSES,
  friendingStartPolicyCanSave,
  friendingStartPolicyDirty,
  friendingStartPolicyError,
  friendingStartPolicyNewlyDisabled,
  friendingStartPolicyReadOutcome,
  friendingStartPolicySaveBody,
  friendingStartPolicySaveOutcome,
  friendingStartPolicySendable,
  friendingStartPolicyStateResponse,
  friendingStartPolicyUsable,
  normalizeFriendingStartPolicyProxyBody,
} from "../lib/friendingStartPolicy.ts";
import {
  CORPUS, DERIVED, FIXTURE_BYTES, FIXTURE_SHA256, FIXTURE_SOURCE, ORIGIN, OTHERS, REFUSALS, STATES,
  base, decoded, editing, flags, loaded, readThenSaved, refusal, run, sameFlags, stateBody, type Json,
} from "./support/friendingStartCorpus.mts";

// The Friending Start setting as a contract: the corpus, the strict decoder, the refusals, the save's proof, the bridge
// and the panel's state machine. The corpus and its pin - and how Core's genuine file replaces the derived one - are in
// tests/support/friendingStartCorpus.mts. The panel itself is tests/friendingStartPanel.test.mts.

test(`${ORIGIN}: the file is the pinned one, names the two console routes and holds every answer the panel has a state for`, () => {
  assert.equal(createHash("sha256").update(FIXTURE_BYTES).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/friending_start_policy_wire.json must stay byte-identical to its source (${FIXTURE_SOURCE})`);
  // A derived corpus says so in the file, in the pin and in these titles; a genuine one in none of them.
  assert.equal(FIXTURE_SOURCE.startsWith("DERIVED"), DERIVED, "the pin names a Core commit exactly when the file is Core's");
  assert.equal(/^[0-9a-f]{40}$/.test(FIXTURE_SOURCE), !DERIVED);
  if (CORPUS.routes !== undefined) {
    assert.deepEqual([CORPUS.routes.read, CORPUS.routes.save].map((route: string) => route.replace("/v1/webadmin/", "")), [...FRIENDING_START_POLICY_ACTIONS]);
  }
  // What the panel shows needs each of these at least once.
  stateBody("a state a viewer reads (can_write false)", (state) => !state.can_write);
  stateBody("a state a writer reads (can_write true)", (state) => state.can_write);
  stateBody("a saved state (revision 1 or more)", (state) => state.configuration.revision >= 1);
  for (const [error, status] of [["friending-start-policy-conflict", 409], ["friending-start-policy-invalid", 422],
    ["admin-write-required", 403], ["friending-start-policy-unavailable", 503]] as const) {
    assert.equal(refusal(error).status_code, status, error);
  }
  readThenSaved();
});

test(`${ORIGIN}: the strict decoder accepts every console state exactly as served, and nothing else in the file`, () => {
  for (const [name, body] of STATES) {
    assert.deepEqual(decoded(body), { configuration: body.data.configuration, can_write: body.data.can_write }, name);
    // What Core can serve: at least one method on, and a never-saved setting is the default - both on, nobody named.
    const { configuration } = decoded(body);
    assert.equal(friendingStartPolicyUsable(configuration), true, name);
    if (configuration.revision === 0) assert.deepEqual(configuration, { schema_version: 1, revision: 0, radar_enabled: true, touch_enabled: true, updated_at: 0, updated_by: "" }, name);
  }
  // A refusal, and whatever else the file carries (the block the apps read has no envelope, no actor, no `can_write`),
  // is never an editable console state.
  for (const [name, body] of [...REFUSALS, ...OTHERS]) assert.equal(friendingStartPolicyStateResponse(body), null, name);
});

test(`${ORIGIN}: every refusal is read as its error at its exact logical status, and one the console has no name for is never "refused"`, () => {
  for (const [name, body] of REFUSALS) {
    const known = Object.hasOwn(FRIENDING_START_POLICY_ERROR_STATUSES, body.error);
    if (known) {
      assert.equal(FRIENDING_START_POLICY_ERROR_STATUSES[body.error], body.status_code, name);
      assert.equal(friendingStartPolicyError(body), body.error, name);
    } else {
      // Core may refuse with a name this console does not carry (the model has `-revision-exhausted`). By its status it
      // is then a failure of Core - nothing is known - or an answer the console does not understand; never a settled "no".
      assert.equal(friendingStartPolicyError(body), null, name);
      assert.equal(friendingStartPolicyReadOutcome(body).kind, body.status_code >= 500 ? "unavailable" : "error", name);
    }
  }
  const conflict = refusal("friending-start-policy-conflict");
  // A known error at the wrong status, or an unknown error, is not believed.
  assert.equal(friendingStartPolicyError({ ...conflict, status_code: 422 }), null);
  assert.equal(friendingStartPolicyError({ ...conflict, error: "invented" }), null);
  // Same-origin bridge refusals carry no legacy trio and are recognised too.
  assert.equal(friendingStartPolicyError({ success: false, status_code: 403, error: "admin-write-required" }), "admin-write-required");
  assert.equal(friendingStartPolicyError({ success: false, status_code: 504, error: "core-timeout" }), "core-timeout");
});

test("loose, partial or impossible successful bodies never become a state - least of all 'both methods off'", () => {
  assert.ok(friendingStartPolicyStateResponse(base()));
  for (const [field, values] of Object.entries({
    schema_version: [2, "1", true, null],
    revision: [-1, 1.5, "3", true, 2_147_483_648],
    radar_enabled: [1, "true", null, [true]],
    touch_enabled: [0, "false", null, [false]],
    updated_at: [-1, "0", 0.5, null],
    updated_by: [null, 5, " admin@example.test", "admin@example.test\n", "\ud800"],
    extra: [true],
  })) {
    for (const value of values) {
      const body = base();
      body.data.configuration[field] = value;
      assert.equal(friendingStartPolicyStateResponse(body), null, `${field}=${String(value)}`);
    }
  }
  for (const field of Object.keys(base().data.configuration)) {
    const body = base();
    delete body.data.configuration[field];
    assert.equal(friendingStartPolicyStateResponse(body), null, `missing ${field}`);
  }
  for (const mutate of [
    (body: Json) => { delete body.data.can_write; },
    (body: Json) => { body.data.can_write = "true"; },
    (body: Json) => { body.data.extra = 1; },
    (body: Json) => { body.success = false; },
    (body: Json) => { body.status_code = 201; },
    (body: Json) => { delete body.can_send; },
    (body: Json) => { body.error = "friending-start-policy-unavailable"; },
    (body: Json) => { body.data = body.data.configuration; },
  ]) {
    const body = base();
    mutate(body);
    assert.equal(friendingStartPolicyStateResponse(body), null);
  }
  // Core refuses to store both methods off: a body that says so is not a state, and is not shown as one.
  const none = base();
  Object.assign(none.data.configuration, { radar_enabled: false, touch_enabled: false });
  assert.equal(friendingStartPolicyStateResponse(none), null);
  assert.equal(friendingStartPolicyReadOutcome(none).kind, "error");
  // Revision 0 is only ever Core's compiled default: both methods on, nobody named.
  for (const patch of [
    { radar_enabled: false, touch_enabled: true, updated_at: 0, updated_by: "" },
    { radar_enabled: true, touch_enabled: false, updated_at: 0, updated_by: "" },
    { radar_enabled: true, touch_enabled: true, updated_at: 1, updated_by: "" },
    { radar_enabled: true, touch_enabled: true, updated_at: 0, updated_by: "admin@example.test" },
  ]) {
    const body = base();
    Object.assign(body.data.configuration, { revision: 0 }, patch);
    assert.equal(friendingStartPolicyStateResponse(body), null, JSON.stringify(patch));
  }
  const never = base();
  Object.assign(never.data.configuration, { revision: 0, radar_enabled: true, touch_enabled: true, updated_at: 0, updated_by: "" });
  assert.ok(friendingStartPolicyStateResponse(never));
  // The actor is bounded in UTF-8 BYTES: 160 two-byte letters fit, 161 do not.
  const fits = base();
  fits.data.configuration.updated_by = "é".repeat(160);
  assert.ok(friendingStartPolicyStateResponse(fits));
  const tooLong = base();
  tooLong.data.configuration.updated_by = "é".repeat(161);
  assert.equal(friendingStartPolicyStateResponse(tooLong), null);
});

test(`${ORIGIN}: a read that Core cannot serve is 'unavailable' - never a setting, and never 'all off'`, () => {
  assert.equal(friendingStartPolicyReadOutcome(stateBody("a writer's state", (state) => state.can_write)).kind, "ready");
  for (const unavailable of [
    refusal("friending-start-policy-unavailable"),
    { success: false, status_code: 502, error: "core-unavailable" },
    { success: false, status_code: 504, error: "core-timeout" },
    { success: false, status_code: 502, error: "invalid-core-response" },
    // The bridge could not confirm the operator's membership, and a refusal of Core this console has no name for.
    { success: false, status_code: 503, error: "admin-membership-unconfirmed" },
    { ...refusal("friending-start-policy-unavailable"), error: "friending-start-policy-revision-exhausted" },
    null,
    undefined,
  ]) {
    const outcome = friendingStartPolicyReadOutcome(unavailable);
    assert.deepEqual(outcome, { kind: "unavailable" }, JSON.stringify(unavailable));
  }
  for (const error of [...OTHERS.map(([, body]) => body), base().data, { success: true }, "nope", refusal("friending-start-policy-conflict"),
    { success: false, status_code: 404, error: "not-found" }]) {
    assert.deepEqual(friendingStartPolicyReadOutcome(error), { kind: "error" }, JSON.stringify(error));
  }
});

test(`${ORIGIN}: a save succeeds only when the answer proves the exact command`, () => {
  assert.deepEqual(friendingStartPolicySaveBody(0, { radar_enabled: true, touch_enabled: false }), {
    expected_revision: 0,
    configuration: { schema_version: 1, radar_enabled: true, touch_enabled: false },
  });
  // Every saved state of the corpus is the answer to exactly two commands: the save that made it, and that save repeated.
  let proved = 0;
  for (const [name, body] of STATES) {
    const state = decoded(body), revision = state.configuration.revision, switches = flags(state);
    if (revision < 1) continue;
    proved += 1;
    const made = friendingStartPolicySaveOutcome(body, friendingStartPolicySaveBody(revision - 1, switches));
    assert.equal(made.kind === "saved" && made.changed, true, `${name}: the save that made it`);
    const repeated = friendingStartPolicySaveOutcome(body, friendingStartPolicySaveBody(revision, switches));
    assert.equal(repeated.kind === "saved" && !repeated.changed, true, `${name}: the same save again changes nothing`);
    // A success that does not carry what was asked, or skips a revision, is not a save.
    const other = { radar_enabled: !switches.radar_enabled || !switches.touch_enabled, touch_enabled: switches.radar_enabled };
    assert.equal(sameFlags(other, switches), false);
    assert.equal(friendingStartPolicySaveOutcome(body, friendingStartPolicySaveBody(revision - 1, other)).kind, "unexpected", name);
    assert.equal(friendingStartPolicySaveOutcome(body, friendingStartPolicySaveBody(revision + 1, switches)).kind, "unexpected", name);
    if (revision >= 2) assert.equal(friendingStartPolicySaveOutcome(body, friendingStartPolicySaveBody(revision - 2, switches)).kind, "unexpected", name);
  }
  assert.ok(proved >= 1);

  const sent = friendingStartPolicySaveBody(1, { radar_enabled: false, touch_enabled: true });
  assert.equal(friendingStartPolicySaveOutcome(refusal("friending-start-policy-conflict"), sent).kind, "conflict");
  assert.equal(friendingStartPolicySaveOutcome(refusal("friending-start-policy-unavailable"), sent).kind, "unavailable");
  // Core's 422 is handled whatever it was for - both methods off is one reason it gives.
  assert.equal(friendingStartPolicySaveOutcome(refusal("friending-start-policy-invalid"), sent).kind, "invalid");
  assert.equal(friendingStartPolicySaveOutcome(refusal("admin-write-required"), sent).kind, "writeRequired");
  assert.equal(friendingStartPolicySaveOutcome({ success: false, status_code: 403, error: "admin-write-required" }, sent).kind, "writeRequired");
  assert.equal(friendingStartPolicySaveOutcome({ success: false, status_code: 400, error: "invalid-input" }, sent).kind, "invalid");
  // No answer, a failure of Core or of the path to it, and a 5xx refusal under a name the console does not carry:
  // not confirmed either way.
  for (const lost of [null, undefined, { success: false, status_code: 504, error: "core-timeout" }, { success: false, status_code: 502, error: "core-unavailable" },
    { success: false, status_code: 502, error: "admin-request-outcome-unknown" }, { success: false, status_code: 503, error: "admin-membership-unconfirmed" },
    { ...refusal("friending-start-policy-unavailable"), error: "friending-start-policy-revision-exhausted" }]) {
    assert.deepEqual(friendingStartPolicySaveOutcome(lost, sent), { kind: "unavailable" }, JSON.stringify(lost));
  }
  assert.equal(friendingStartPolicySaveOutcome({ success: false, status_code: 418, error: "teapot" }, sent).kind, "unexpected");
  for (const [, body] of OTHERS) assert.equal(friendingStartPolicySaveOutcome(body, sent).kind, "unexpected");
});

test("the proxy forwards only the exact read and save commands, and never a save with both methods off", () => {
  const read = normalizeFriendingStartPolicyProxyBody("friending_start_policy", {});
  assert.ok(read);
  assert.deepEqual(Object.keys(read), []);
  assert.equal(Object.getPrototypeOf(read), null);
  assert.equal(normalizeFriendingStartPolicyProxyBody("friending_start_policy", { admin_email: "x@y.z" }), null);

  const valid = {
    expected_revision: 4,
    configuration: { schema_version: 1, radar_enabled: false, touch_enabled: true },
  };
  const save = normalizeFriendingStartPolicyProxyBody("save_friending_start_policy", valid);
  assert.ok(save);
  assert.equal(Object.getPrototypeOf(save), null);
  assert.deepEqual({ ...save }, valid);
  // `coreCall` JSON-encodes the nested object into the one field Core decodes.
  assert.equal(JSON.stringify(save.configuration), "{\"schema_version\":1,\"radar_enabled\":false,\"touch_enabled\":true}");
  for (const [radar, touch] of [[true, true], [true, false], [false, true]]) {
    assert.ok(normalizeFriendingStartPolicyProxyBody("save_friending_start_policy",
      { expected_revision: 0, configuration: { schema_version: 1, radar_enabled: radar, touch_enabled: touch } }), `${radar}/${touch}`);
  }

  for (const invalid of [
    {},
    { ...valid, extra: 1 },
    { ...valid, admin_email: "x@y.z" },
    { configuration: valid.configuration },
    { expected_revision: 4 },
    { ...valid, expected_revision: "4" },
    { ...valid, expected_revision: -1 },
    { ...valid, expected_revision: 1.5 },
    { ...valid, expected_revision: 2_147_483_648 },
    { ...valid, configuration: JSON.stringify(valid.configuration) },
    { ...valid, configuration: { ...valid.configuration, schema_version: 2 } },
    { ...valid, configuration: { ...valid.configuration, touch_enabled: "true" } },
    { ...valid, configuration: { ...valid.configuration, radar_enabled: [true] } },
    { ...valid, configuration: { ...valid.configuration, revision: 4 } },
    { ...valid, configuration: { radar_enabled: false, touch_enabled: true } },
    // Nobody could become friends: Core refuses it (422), and it is not forwarded for Core to refuse.
    { ...valid, configuration: { schema_version: 1, radar_enabled: false, touch_enabled: false } },
  ]) {
    assert.equal(normalizeFriendingStartPolicyProxyBody("save_friending_start_policy", invalid as Json), null, JSON.stringify(invalid));
  }
  for (const other of ["get_settings", "location_access_policy", "save_location_access_policy"]) {
    assert.equal(normalizeFriendingStartPolicyProxyBody(other, { anything: true }), undefined, other);
  }
});

test("the two actions are allow-listed, classified, in the client's read list, and keep the default body limit and timeout", () => {
  const viewer = adminPrincipalFrom({ role: "viewer" });
  const admin = adminPrincipalFrom({ role: "admin" });
  const owner = adminPrincipalFrom({ role: "owner" });
  assert.deepEqual([...FRIENDING_START_POLICY_ACTIONS], ["friending_start_policy", "save_friending_start_policy"]);
  for (const action of FRIENDING_START_POLICY_ACTIONS) {
    assert.equal(isAdminActionAllowed(action), true, action);
    assert.equal((ADMIN_ACTIONS as readonly string[]).filter((listed) => listed === action).length, 1, `${action} is listed once`);
    // Two booleans and a revision: nothing about these requests needs more room or more time than any other.
    assert.equal(adminActionBodyLimit(action), adminActionBodyLimit("get_settings"), action);
    assert.equal(adminActionTimeoutMs(action), adminActionTimeoutMs("get_settings"), action);
  }
  assert.equal(adminActionAccess("friending_start_policy"), "read");
  assert.equal(adminActionAccess("save_friending_start_policy"), "write");
  // The read is presentation metadata for the browser's transport; the save is a write and is not in that list.
  assert.equal(isAdminClientReadAction("friending_start_policy"), true);
  assert.equal(isAdminClientReadAction("save_friending_start_policy"), false);
  for (const principal of [viewer, admin, owner]) {
    assert.equal(isAdminActionAuthorized("friending_start_policy", principal), true);
  }
  assert.equal(isAdminActionAuthorized("save_friending_start_policy", viewer), false);
  assert.equal(isAdminBridgeActionAuthorized("save_friending_start_policy", viewer, null), false);
  assert.equal(isAdminActionAuthorized("save_friending_start_policy", adminPrincipalFrom({ role: "unknown" })), false);
  assert.equal(isAdminActionAuthorized("save_friending_start_policy", admin), true);
  assert.equal(isAdminActionAuthorized("save_friending_start_policy", owner), true);
});

test(`${ORIGIN}: a viewer sees the setting but can neither edit nor save it`, () => {
  const model = loaded(stateBody("a viewer's state", (state) => !state.can_write));
  assert.equal(model.phase, "ready");
  assert.equal(friendingStartPolicyCanSave(model), false);
  assert.equal(friendingStartPolicySendable(model), false);
  for (const method of FRIENDING_START_METHODS) {
    const after = run([{ type: "toggled", method, value: !model.draft![method] }, { type: "saveStarted" }], model);
    assert.deepEqual(after, model, `a viewer's ${method} toggle and save are ignored`);
  }
});

test(`${ORIGIN}: a 409 keeps the draft and rebases it onto the winning revision`, () => {
  const { edited, sent } = editing();
  assert.equal(friendingStartPolicySendable(edited), true);
  const conflicted = run([
    { type: "saveStarted" },
    { type: "saveFinished", outcome: friendingStartPolicySaveOutcome(refusal("friending-start-policy-conflict"), sent) },
  ], edited);
  assert.equal(conflicted.busy, true, "the follow-up read is still in flight");
  assert.deepEqual(conflicted.draft, edited.draft);

  // Somebody else's save won, two revisions on, with other switches.
  const winner = base();
  Object.assign(winner.data.configuration, { revision: sent.expected_revision + 2, radar_enabled: !edited.draft!.radar_enabled || !edited.draft!.touch_enabled, touch_enabled: edited.draft!.radar_enabled });
  const rebased = run([{ type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome(winner) }], conflicted);
  assert.equal(rebased.busy, false);
  assert.equal(rebased.stored!.configuration.revision, sent.expected_revision + 2);
  assert.deepEqual(rebased.draft, edited.draft, "the operator's choices survive the conflict");
  assert.deepEqual(rebased.notice, { tone: "error", key: "conflict", revision: sent.expected_revision + 2 });
  assert.equal(friendingStartPolicySaveBody(rebased.stored!.configuration.revision, rebased.draft!).expected_revision, sent.expected_revision + 2,
    "the next save names the revision that won");

  const reloadFailed = run([
    { type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome(refusal("friending-start-policy-unavailable")) },
  ], conflicted);
  assert.deepEqual(reloadFailed.draft, conflicted.draft);
  assert.equal(reloadFailed.stored!.configuration.revision, sent.expected_revision);
  assert.deepEqual(reloadFailed.notice, { tone: "error", key: "conflictReloadFailed" });

  // The winner took the operator's write role away: the stored values are shown, read-only.
  const demoted = run([{ type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome({ ...winner, data: { ...winner.data, can_write: false } }) }], conflicted);
  assert.deepEqual(demoted.draft, flags(decoded(winner)));
  assert.deepEqual(demoted.notice, { tone: "error", key: "writeRequired" });

  // Editing after the conflict keeps its explanation; discarding returns to what is stored.
  const method = FRIENDING_START_METHODS.find((candidate) => !rebased.draft![candidate]) ?? FRIENDING_START_METHODS[0];
  const again = run([{ type: "toggled", method, value: !rebased.draft![method] }], rebased);
  assert.equal(again.notice?.key, "conflict");
  const discarded = run([{ type: "discarded" }], again);
  assert.deepEqual(discarded.draft, flags(decoded(winner)));
  assert.equal(discarded.notice, null);
});

test(`${ORIGIN}: a 5xx or no answer shows 'unavailable' on a read and 'not confirmed' on a save, with the draft kept`, () => {
  for (const failed of [refusal("friending-start-policy-unavailable"), null]) {
    const unavailable = loaded(failed);
    assert.equal(unavailable.phase, "unavailable");
    assert.equal(unavailable.stored, null);
    assert.equal(unavailable.draft, null, "nothing is assumed about the switches");
    assert.equal(friendingStartPolicyCanSave(unavailable), false);
  }
  const { edited, sent } = editing();
  for (const lost of [refusal("friending-start-policy-unavailable"), null, { success: false, status_code: 504, error: "core-timeout" }]) {
    const failed = run([{ type: "saveStarted" }, { type: "saveFinished", outcome: friendingStartPolicySaveOutcome(lost, sent) }], edited);
    assert.equal(failed.busy, false);
    assert.equal(failed.phase, "ready");
    assert.deepEqual(failed.draft, edited.draft);
    assert.equal(failed.stored!.configuration.revision, sent.expected_revision, "what is stored is not known to have moved");
    assert.deepEqual(failed.notice, { tone: "error", key: "notConfirmed" });
    assert.equal(friendingStartPolicySendable(failed), true, "the same draft can be sent again after a reload or as it is");
  }
});

test(`${ORIGIN}: a confirmed save adopts Core's answer, Core's 422 keeps the draft, and a lost write role goes read-only`, () => {
  const { saved: answer, edited, sent } = editing();
  const sending = run([{ type: "saveStarted" }], edited);
  assert.equal(sending.busy, true);
  assert.equal(run([{ type: "toggled", method: "radar_enabled", value: !sending.draft!.radar_enabled }, { type: "discarded" }, { type: "saveStarted" }], sending), sending,
    "nothing moves under a save that is on its way");

  const saved = run([{ type: "saveFinished", outcome: friendingStartPolicySaveOutcome(answer, sent) }], sending);
  assert.equal(saved.stored!.configuration.revision, sent.expected_revision + 1);
  assert.deepEqual(saved.draft, edited.draft);
  assert.deepEqual(saved.notice, { tone: "success", key: "saved", revision: sent.expected_revision + 1 });
  assert.equal(friendingStartPolicyDirty(saved.stored!.configuration, saved.draft!), false);
  assert.equal(friendingStartPolicySendable(saved), false, "nothing left to save");

  const invalid = run([{ type: "saveFinished", outcome: friendingStartPolicySaveOutcome(refusal("friending-start-policy-invalid"), sent) }], sending);
  assert.deepEqual(invalid.draft, edited.draft);
  assert.equal(invalid.busy, false);
  assert.deepEqual(invalid.notice, { tone: "error", key: "invalid" });

  const refused = run([{ type: "saveFinished", outcome: friendingStartPolicySaveOutcome(refusal("admin-write-required"), sent) }], sending);
  assert.equal(refused.stored!.can_write, false);
  assert.deepEqual(refused.draft, flags(refused.stored!));
  assert.equal(friendingStartPolicyCanSave(refused), false);
  assert.deepEqual(refused.notice, { tone: "error", key: "writeRequired" });
});

test("both methods off can be on the screen on the way from one method to the other, and is never a command", () => {
  const both = base();
  Object.assign(both.data.configuration, { radar_enabled: true, touch_enabled: true });
  const start = loaded(both);
  assert.equal(friendingStartPolicyUsable(start.draft!), true);
  // From "radar only" to "touch only" in the order an operator may well choose: radar off first.
  const radarOnly = run([{ type: "toggled", method: "touch_enabled", value: false }], start);
  assert.deepEqual(friendingStartPolicyNewlyDisabled(radarOnly.stored!.configuration, radarOnly.draft!), ["touch_enabled"]);
  assert.equal(friendingStartPolicySendable(radarOnly), true);
  const none = run([{ type: "toggled", method: "radar_enabled", value: false }], radarOnly);
  assert.deepEqual(none.draft, { radar_enabled: false, touch_enabled: false }, "the switches show what the operator did");
  assert.equal(friendingStartPolicyUsable(none.draft!), false);
  assert.equal(friendingStartPolicyDirty(none.stored!.configuration, none.draft!), true);
  assert.equal(friendingStartPolicyCanSave(none), true, "the operator may write - just not this");
  assert.equal(friendingStartPolicySendable(none), false);
  assert.equal(run([{ type: "saveStarted" }], none), none, "a save does not start");
  const touchOnly = run([{ type: "toggled", method: "touch_enabled", value: true }], none);
  assert.deepEqual(touchOnly.draft, { radar_enabled: false, touch_enabled: true });
  assert.equal(friendingStartPolicySendable(touchOnly), true);
  assert.deepEqual(friendingStartPolicyNewlyDisabled(touchOnly.stored!.configuration, touchOnly.draft!), ["radar_enabled"]);
  assert.equal(run([{ type: "saveStarted" }], touchOnly).busy, true);
  // Nothing to confirm when a method is only switched ON.
  const single = base();
  const back = run([{ type: "toggled", method: "touch_enabled", value: true }], loaded(single));
  assert.deepEqual(friendingStartPolicyNewlyDisabled(back.stored!.configuration, back.draft!), []);
  assert.equal(friendingStartPolicySendable(back), true);
});

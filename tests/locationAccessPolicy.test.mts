import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { LocationAccessPolicyView } from "../components/LocationAccessConfiguration.tsx";
import {
  adminActionAccess,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import {
  LOCATION_ACCESS_POLICY_ACTIONS,
  LOCATION_ACCESS_POLICY_ERROR_STATUSES,
  LOCATION_ACCESS_POLICY_FLAGS,
  LOCATION_ACCESS_POLICY_INITIAL_MODEL,
  locationAccessPolicyCanSave,
  locationAccessPolicyDirty,
  locationAccessPolicyError,
  locationAccessPolicyNewlyRequired,
  locationAccessPolicyReadOutcome,
  locationAccessPolicyReducer,
  locationAccessPolicySaveBody,
  locationAccessPolicySaveOutcome,
  locationAccessPolicyStateResponse,
  normalizeLocationAccessPolicyProxyBody,
  type LocationAccessPolicyEvent,
  type LocationAccessPolicyModel,
  type LocationAccessPolicyState,
} from "../lib/locationAccessPolicy.ts";

/**
 * Core's wire corpus for P-073 Part B, copied byte-identical from the Core
 * commit that introduced it. Every body is an actual controller response from
 * a disposable replica set (synthetic principals, nonzero `updated_at`
 * normalised), so the decoder is proved against what Core publishes.
 *
 * The pin names the S5 lane commit. If that commit is rebased before it
 * reaches Core `main`, re-pin to the published commit carrying the same bytes
 * (docs/WIRE_CORPUS_PINNING.md, T-771).
 */
const FIXTURE = new URL("./fixtures/location_access_policy_wire.json", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "c855e45951f247847a4c946012362b58aa513b25";
const FIXTURE_SHA256 = "7714b328a24ad5e6954d8b527bc4d475dc20a96c30890bf96dc78d51ba266454";
const FIXTURE_RESPONSES = [
  "viewer-default",
  "viewer-write-refused",
  "owner-default",
  "public-default",
  "invalid",
  "saved-1",
  "noop",
  "conflict",
  "saved-2",
  "owner-after-saves",
  "stored-invalid",
];

type Json = Record<string, any>;

async function corpus(): Promise<Record<string, Json>> {
  const parsed = JSON.parse(await readFile(FIXTURE, "utf8"));
  return parsed.responses as Record<string, Json>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ready(state: LocationAccessPolicyState | null): LocationAccessPolicyState {
  assert.ok(state, "the corpus body must decode");
  return state;
}

test("the vendored corpus is byte-identical to Core's and complete", async () => {
  const bytes = await readFile(FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/location_access_policy_wire.json must stay byte-identical to Core ${FIXTURE_SOURCE_COMMIT}`);
  const parsed = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(parsed.routes, {
    read: "/v1/webadmin/location_access_policy",
    save: "/v1/webadmin/save_location_access_policy",
    public: "/v1/app/location_access_policy",
  });
  assert.deepEqual(Object.keys(parsed.responses), FIXTURE_RESPONSES, "the corpus cannot silently grow or shrink");
  // The two console routes are exactly the two allow-listed actions.
  assert.deepEqual(
    [parsed.routes.read, parsed.routes.save].map((route: string) => route.replace("/v1/webadmin/", "")),
    [...LOCATION_ACCESS_POLICY_ACTIONS],
  );
});

test("the strict decoder accepts every console state in the corpus and nothing else", async () => {
  const responses = await corpus();
  const viewer = ready(locationAccessPolicyStateResponse(responses["viewer-default"]));
  assert.deepEqual(viewer, {
    configuration: {
      schema_version: 1,
      revision: 0,
      required_for_nearby: false,
      required_for_signup: false,
      updated_at: 0,
      updated_by: "",
    },
    can_write: false,
  });
  assert.equal(ready(locationAccessPolicyStateResponse(responses["owner-default"])).can_write, true);

  const saved1 = ready(locationAccessPolicyStateResponse(responses["saved-1"]));
  assert.deepEqual(saved1.configuration, {
    schema_version: 1,
    revision: 1,
    required_for_nearby: true,
    required_for_signup: false,
    updated_at: 1_700_000_000,
    updated_by: "owner@example.test",
  });
  assert.deepEqual(locationAccessPolicyStateResponse(responses.noop), saved1);
  const saved2 = ready(locationAccessPolicyStateResponse(responses["saved-2"]));
  assert.equal(saved2.configuration.revision, 2);
  assert.equal(saved2.configuration.required_for_nearby, false);
  assert.equal(saved2.configuration.required_for_signup, true);
  assert.deepEqual(locationAccessPolicyStateResponse(responses["owner-after-saves"]), saved2);

  // The public projection has no envelope trio, no actor and no `can_write`:
  // it must never be mistaken for an editable console state.
  for (const name of ["public-default", "viewer-write-refused", "invalid", "conflict", "stored-invalid"]) {
    assert.equal(locationAccessPolicyStateResponse(responses[name]), null, name);
  }
});

test("every corpus refusal decodes to its error at its exact logical status", async () => {
  const responses = await corpus();
  const expected: Record<string, [string, number]> = {
    "viewer-write-refused": ["admin-write-required", 403],
    invalid: ["location-access-policy-invalid", 422],
    conflict: ["location-access-policy-conflict", 409],
    "stored-invalid": ["location-access-policy-unavailable", 503],
  };
  for (const [name, [error, status]] of Object.entries(expected)) {
    assert.equal(responses[name].status_code, status, name);
    assert.equal(LOCATION_ACCESS_POLICY_ERROR_STATUSES[error], status, name);
    assert.equal(locationAccessPolicyError(responses[name]), error, name);
  }
  // A known error at the wrong status, or an unknown error, is not believed.
  assert.equal(locationAccessPolicyError({ ...responses.conflict, status_code: 422 }), null);
  assert.equal(locationAccessPolicyError({ ...responses.conflict, error: "invented" }), null);
  // Same-origin bridge refusals carry no legacy trio and are recognised too.
  assert.equal(locationAccessPolicyError({ success: false, status_code: 403, error: "admin-write-required" }), "admin-write-required");
  assert.equal(locationAccessPolicyError({ success: false, status_code: 504, error: "core-timeout" }), "core-timeout");
});

const base = () => ({
  success: true,
  status_code: 200,
  data: {
    configuration: {
      schema_version: 1,
      revision: 3,
      required_for_nearby: true,
      required_for_signup: false,
      updated_at: 1_700_000_000,
      updated_by: "admin@example.test",
    } as Json,
    can_write: true,
  } as Json,
  message: 200,
  status: 200,
  can_send: 0,
});

test("loose, partial or impossible successful bodies never become a state", () => {
  assert.ok(locationAccessPolicyStateResponse(base()));
  for (const [field, values] of Object.entries({
    schema_version: [2, "1", true, null],
    revision: [-1, 1.5, "3", true, 2_147_483_648],
    required_for_nearby: [1, "true", null],
    required_for_signup: [0, "false", null],
    updated_at: [-1, "0", 0.5, null],
    updated_by: [null, 5, " admin@example.test", "admin@example.test\n", "\ud800"],
    extra: [true],
  })) {
    for (const value of values) {
      const body = base();
      body.data.configuration[field] = value;
      assert.equal(locationAccessPolicyStateResponse(body), null, `${field}=${String(value)}`);
    }
  }
  for (const field of Object.keys(base().data.configuration)) {
    const body = base();
    delete body.data.configuration[field];
    assert.equal(locationAccessPolicyStateResponse(body), null, `missing ${field}`);
  }
  for (const mutate of [
    (body: Json) => { delete body.data.can_write; },
    (body: Json) => { body.data.can_write = "true"; },
    (body: Json) => { body.data.extra = 1; },
    (body: Json) => { body.success = false; },
    (body: Json) => { body.status_code = 201; },
    (body: Json) => { delete body.can_send; },
    (body: Json) => { body.error = "location-access-policy-unavailable"; },
  ]) {
    const body = base();
    mutate(body);
    assert.equal(locationAccessPolicyStateResponse(body), null);
  }
  // Revision 0 is only ever Core's compiled default: all off, nobody named.
  for (const patch of [
    { required_for_nearby: true, updated_at: 0, updated_by: "" },
    { required_for_nearby: false, updated_at: 1, updated_by: "" },
    { required_for_nearby: false, updated_at: 0, updated_by: "admin@example.test" },
  ]) {
    const body = base();
    Object.assign(body.data.configuration, { revision: 0 }, patch);
    assert.equal(locationAccessPolicyStateResponse(body), null, JSON.stringify(patch));
  }
  // Core bounds the actor in UTF-8 BYTES: 160 two-byte letters fit, 161 do not.
  const fits = base();
  fits.data.configuration.updated_by = "é".repeat(160);
  assert.ok(locationAccessPolicyStateResponse(fits));
  const tooLong = base();
  tooLong.data.configuration.updated_by = "é".repeat(161);
  assert.equal(locationAccessPolicyStateResponse(tooLong), null);
});

test("a read that Core cannot serve is 'unavailable', never an all-off default", async () => {
  const responses = await corpus();
  assert.equal(locationAccessPolicyReadOutcome(responses["owner-default"]).kind, "ready");
  for (const unavailable of [
    responses["stored-invalid"],
    { success: false, status_code: 502, error: "core-unavailable" },
    { success: false, status_code: 504, error: "core-timeout" },
    { success: false, status_code: 502, error: "invalid-core-response" },
    null,
  ]) {
    assert.equal(locationAccessPolicyReadOutcome(unavailable).kind, "unavailable", JSON.stringify(unavailable));
  }
  for (const error of [responses["public-default"], base().data, { success: true }, "nope"]) {
    assert.equal(locationAccessPolicyReadOutcome(error).kind, "error");
  }
});

test("a save succeeds only when the answer proves the exact command", async () => {
  const responses = await corpus();
  const first = locationAccessPolicySaveBody(0, { required_for_nearby: true, required_for_signup: false });
  assert.deepEqual(first, {
    expected_revision: 0,
    configuration: { schema_version: 1, required_for_nearby: true, required_for_signup: false },
  });
  const committed = locationAccessPolicySaveOutcome(responses["saved-1"], first);
  assert.equal(committed.kind, "saved");
  assert.equal(committed.kind === "saved" && committed.changed, true);

  const repeat = locationAccessPolicySaveBody(1, { required_for_nearby: true, required_for_signup: false });
  const noop = locationAccessPolicySaveOutcome(responses.noop, repeat);
  assert.equal(noop.kind === "saved" && noop.changed, false);

  const second = locationAccessPolicySaveBody(1, { required_for_nearby: false, required_for_signup: true });
  assert.equal(locationAccessPolicySaveOutcome(responses["saved-2"], second).kind, "saved");
  // A success that does not carry what was asked, or skips a revision, is not a save.
  assert.equal(locationAccessPolicySaveOutcome(responses["saved-2"], first).kind, "unexpected");
  assert.equal(locationAccessPolicySaveOutcome(responses["saved-2"], repeat).kind, "unexpected");

  assert.equal(locationAccessPolicySaveOutcome(responses.conflict, second).kind, "conflict");
  assert.equal(locationAccessPolicySaveOutcome(responses["stored-invalid"], second).kind, "unavailable");
  assert.equal(locationAccessPolicySaveOutcome(responses.invalid, second).kind, "invalid");
  assert.equal(locationAccessPolicySaveOutcome(responses["viewer-write-refused"], second).kind, "writeRequired");
  assert.equal(locationAccessPolicySaveOutcome(
    { success: false, status_code: 403, error: "admin-write-required" }, second).kind, "writeRequired");
  assert.equal(locationAccessPolicySaveOutcome(
    { success: false, status_code: 400, error: "invalid-input" }, second).kind, "invalid");
  assert.equal(locationAccessPolicySaveOutcome(
    { success: false, status_code: 504, error: "core-timeout" }, second).kind, "unavailable");
  assert.equal(locationAccessPolicySaveOutcome(
    { ...responses.conflict, error: "location-access-policy-revision-exhausted", status_code: 503 }, second).kind,
  "unavailable");
  assert.equal(locationAccessPolicySaveOutcome(null, second).kind, "unavailable");
  assert.equal(locationAccessPolicySaveOutcome({ success: false, status_code: 418, error: "teapot" }, second).kind,
    "unexpected");
});

test("the proxy forwards only the exact read and save commands", () => {
  const read = normalizeLocationAccessPolicyProxyBody("location_access_policy", {});
  assert.ok(read);
  assert.deepEqual(Object.keys(read), []);
  assert.equal(Object.getPrototypeOf(read), null);
  assert.equal(normalizeLocationAccessPolicyProxyBody("location_access_policy", { admin_email: "x@y.z" }), null);

  const valid = {
    expected_revision: 4,
    configuration: { schema_version: 1, required_for_nearby: false, required_for_signup: true },
  };
  const save = normalizeLocationAccessPolicyProxyBody("save_location_access_policy", valid);
  assert.ok(save);
  assert.equal(Object.getPrototypeOf(save), null);
  assert.deepEqual({ ...save }, valid);
  // `coreCall` JSON-encodes the nested object into the one field Core decodes.
  assert.equal(JSON.stringify(save.configuration),
    "{\"schema_version\":1,\"required_for_nearby\":false,\"required_for_signup\":true}");

  for (const invalid of [
    {},
    { ...valid, extra: 1 },
    { ...valid, admin_email: "x@y.z" },
    { configuration: valid.configuration },
    { ...valid, expected_revision: "4" },
    { ...valid, expected_revision: -1 },
    { ...valid, expected_revision: 1.5 },
    { ...valid, expected_revision: 2_147_483_648 },
    { ...valid, configuration: JSON.stringify(valid.configuration) },
    { ...valid, configuration: { ...valid.configuration, schema_version: 2 } },
    { ...valid, configuration: { ...valid.configuration, required_for_signup: "true" } },
    { ...valid, configuration: { ...valid.configuration, revision: 4 } },
    { ...valid, configuration: { required_for_nearby: false, required_for_signup: true } },
  ]) {
    assert.equal(normalizeLocationAccessPolicyProxyBody("save_location_access_policy", invalid as Json), null,
      JSON.stringify(invalid));
  }
  assert.equal(normalizeLocationAccessPolicyProxyBody("get_settings", { anything: true }), undefined);
});

test("reads are open to every administrator and the save is owner/admin only", () => {
  const viewer = adminPrincipalFrom({ role: "viewer" });
  const admin = adminPrincipalFrom({ role: "admin" });
  const owner = adminPrincipalFrom({ role: "owner" });
  assert.equal(isAdminActionAllowed("location_access_policy"), true);
  assert.equal(isAdminActionAllowed("save_location_access_policy"), true);
  assert.equal(adminActionAccess("location_access_policy"), "read");
  assert.equal(adminActionAccess("save_location_access_policy"), "write");
  for (const principal of [viewer, admin, owner]) {
    assert.equal(isAdminActionAuthorized("location_access_policy", principal), true);
  }
  assert.equal(isAdminActionAuthorized("save_location_access_policy", viewer), false);
  assert.equal(isAdminBridgeActionAuthorized("save_location_access_policy", viewer, null), false);
  assert.equal(isAdminActionAuthorized("save_location_access_policy", adminPrincipalFrom({ role: "unknown" })), false);
  assert.equal(isAdminActionAuthorized("save_location_access_policy", admin), true);
  assert.equal(isAdminActionAuthorized("save_location_access_policy", owner), true);
});

function run(events: LocationAccessPolicyEvent[], start = LOCATION_ACCESS_POLICY_INITIAL_MODEL): LocationAccessPolicyModel {
  return events.reduce(locationAccessPolicyReducer, start);
}

test("a viewer sees the policy but can neither edit nor save it", async () => {
  const responses = await corpus();
  const model = run([
    { type: "loadStarted" },
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["viewer-default"]) },
  ]);
  assert.equal(model.phase, "ready");
  assert.equal(locationAccessPolicyCanSave(model), false);
  const after = run([
    { type: "toggled", flag: "required_for_nearby", value: true },
    { type: "saveStarted" },
  ], model);
  assert.deepEqual(after, model, "a viewer's toggle and save are ignored");
});

test("a 409 keeps the draft and rebases it onto the winning revision", async () => {
  const responses = await corpus();
  const loaded = run([
    { type: "loadStarted" },
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_nearby", value: true },
  ]);
  assert.equal(locationAccessPolicyCanSave(loaded), true);
  assert.equal(locationAccessPolicyDirty(loaded.stored!.configuration, loaded.draft!), true);
  assert.deepEqual(locationAccessPolicyNewlyRequired(loaded.stored!.configuration, loaded.draft!), ["required_for_nearby"]);

  const sent = locationAccessPolicySaveBody(loaded.stored!.configuration.revision, loaded.draft!);
  const conflicted = run([
    { type: "saveStarted" },
    { type: "saveFinished", outcome: locationAccessPolicySaveOutcome(responses.conflict, sent) },
  ], loaded);
  assert.equal(conflicted.busy, true, "the follow-up read is still in flight");
  assert.deepEqual(conflicted.draft, { required_for_nearby: true, required_for_signup: false });

  const rebased = run([
    { type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(responses["owner-after-saves"]) },
  ], conflicted);
  assert.equal(rebased.busy, false);
  assert.equal(rebased.stored!.configuration.revision, 2);
  assert.deepEqual(rebased.draft, { required_for_nearby: true, required_for_signup: false },
    "the operator's choices survive the conflict");
  assert.deepEqual(rebased.notice, { tone: "error", key: "conflict", revision: 2 });
  assert.equal(locationAccessPolicySaveBody(rebased.stored!.configuration.revision, rebased.draft!).expected_revision, 2);

  const reloadFailed = run([
    { type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(responses["stored-invalid"]) },
  ], conflicted);
  assert.deepEqual(reloadFailed.draft, conflicted.draft);
  assert.equal(reloadFailed.stored!.configuration.revision, 0);
  assert.deepEqual(reloadFailed.notice, { tone: "error", key: "conflictReloadFailed" });

  // Editing after the conflict keeps its explanation; discarding returns to what is stored.
  const edited = run([{ type: "toggled", flag: "required_for_signup", value: true }], rebased);
  assert.equal(edited.notice?.key, "conflict");
  const discarded = run([{ type: "discarded" }], edited);
  assert.deepEqual(discarded.draft, { required_for_nearby: false, required_for_signup: true });
  assert.equal(discarded.notice, null);
});

test("503 shows 'unavailable' on read and keeps the draft on save", async () => {
  const responses = await corpus();
  const unavailable = run([
    { type: "loadStarted" },
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["stored-invalid"]) },
  ]);
  assert.equal(unavailable.phase, "unavailable");
  assert.equal(unavailable.stored, null);
  assert.equal(unavailable.draft, null);
  assert.equal(locationAccessPolicyCanSave(unavailable), false);

  const editing = run([
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_signup", value: true },
    { type: "saveStarted" },
  ]);
  const sent = locationAccessPolicySaveBody(0, editing.draft!);
  const failed = run([
    { type: "saveFinished", outcome: locationAccessPolicySaveOutcome(responses["stored-invalid"], sent) },
  ], editing);
  assert.equal(failed.busy, false);
  assert.equal(failed.phase, "ready");
  assert.deepEqual(failed.draft, { required_for_nearby: false, required_for_signup: true });
  assert.equal(failed.stored!.configuration.revision, 0);
  assert.deepEqual(failed.notice, { tone: "error", key: "notConfirmed" });
});

test("a confirmed save adopts Core's answer, and a lost write role goes read-only", async () => {
  const responses = await corpus();
  const editing = run([
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_nearby", value: true },
    { type: "saveStarted" },
  ]);
  const sent = locationAccessPolicySaveBody(0, editing.draft!);
  const saved = run([{ type: "saveFinished", outcome: locationAccessPolicySaveOutcome(responses["saved-1"], sent) }], editing);
  assert.equal(saved.stored!.configuration.revision, 1);
  assert.deepEqual(saved.draft, { required_for_nearby: true, required_for_signup: false });
  assert.deepEqual(saved.notice, { tone: "success", key: "saved", revision: 1 });
  assert.equal(locationAccessPolicyDirty(saved.stored!.configuration, saved.draft!), false);

  const refused = run([
    { type: "saveFinished", outcome: locationAccessPolicySaveOutcome(responses["viewer-write-refused"], sent) },
  ], editing);
  assert.equal(refused.stored!.can_write, false);
  assert.deepEqual(refused.draft, { required_for_nearby: false, required_for_signup: false });
  assert.equal(locationAccessPolicyCanSave(refused), false);
  assert.deepEqual(refused.notice, { tone: "error", key: "writeRequired" });
});

async function messages(locale: "en" | "hu"): Promise<Json> {
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
}

async function render(model: LocationAccessPolicyModel, locale: "en" | "hu" = "en"): Promise<string> {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: await messages(locale), timeZone: "UTC" },
    createElement(LocationAccessPolicyView, {
      model,
      onToggle() {},
      onSave() {},
      onDiscard() {},
      onReload() {},
    }),
  ));
}

test("the panel gates the save for a viewer and offers it to a writer", async () => {
  const responses = await corpus();
  const viewer = run([{ type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["viewer-default"]) }]);
  const viewerHtml = await render(viewer);
  assert.doesNotMatch(viewerHtml, /data-location-access-save/);
  assert.match(viewerHtml, /data-location-access-read-only/);
  assert.equal(viewerHtml.match(/type="checkbox"/g)?.length, LOCATION_ACCESS_POLICY_FLAGS.length);
  assert.equal(viewerHtml.match(/type="checkbox"[^>]*disabled=""/g)?.length, LOCATION_ACCESS_POLICY_FLAGS.length);
  assert.match(viewerHtml, /Never saved/);

  const writer = run([
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_signup", value: true },
  ]);
  const writerHtml = await render(writer);
  assert.doesNotMatch(writerHtml, /data-location-access-read-only/);
  assert.match(writerHtml, /<button[^>]*data-location-access-save="save"[^>]*>Save location access<\/button>/);
  assert.doesNotMatch(writerHtml, /<button[^>]*data-location-access-save="save"[^>]*disabled/);
  assert.doesNotMatch(writerHtml, /type="checkbox"[^>]*disabled=""/);
  assert.match(writerHtml, /You have unsaved changes\./);
});

test("the panel explains a conflict over the kept draft and shows an unavailable state", async () => {
  const responses = await corpus();
  const loaded = run([
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_nearby", value: true },
  ]);
  const rebased = run([
    { type: "saveStarted" },
    { type: "saveFinished", outcome: { kind: "conflict" } },
    { type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(responses["owner-after-saves"]) },
  ], loaded);
  const html = await render(rebased);
  assert.match(html, /data-location-access-notice="conflict"/);
  assert.match(html, /The stored version is now revision 2\. The switches still show your unsaved choices\./);
  // Nearby shows the operator's unsaved "on"; signup shows the winning revision's "on".
  assert.match(html, /data-location-access-flag="required_for_nearby"[\s\S]*?checked=""[\s\S]*?data-location-access-flag="required_for_signup"/);
  assert.match(html, /Required · unsaved/);

  const unavailable = run([{ type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["stored-invalid"]) }]);
  const unavailableHtml = await render(unavailable);
  assert.match(unavailableHtml, /data-location-access-phase="unavailable"/);
  assert.match(unavailableHtml, /Core cannot read the location access policy right now/);
  assert.match(unavailableHtml, />Reload<\/button>/);
  assert.doesNotMatch(unavailableHtml, /type="checkbox"/);

  const huHtml = await render(unavailable, "hu");
  assert.match(huHtml, /A Core most nem tudja kiolvasni a helyhozzáférési szabályt/);
  assert.match(huHtml, />Újratöltés<\/button>/);
});

function winner(revision: number, nearby: boolean, signup: boolean): Json {
  const body = base();
  Object.assign(body.data.configuration, {
    revision,
    required_for_nearby: nearby,
    required_for_signup: signup,
  });
  return body;
}

test("the conflict notice reads correctly for any winning revision and claims a kept draft only when one differs", async () => {
  const responses = await corpus();
  const editing = run([
    { type: "loaded", outcome: locationAccessPolicyReadOutcome(responses["owner-default"]) },
    { type: "toggled", flag: "required_for_nearby", value: true },
    { type: "saveStarted" },
    { type: "saveFinished", outcome: { kind: "conflict" } },
  ]);
  // Revision 1 is the likeliest winner. Hungarian needs "az 1." but "a 5.", so
  // no article may sit directly before the number in either language.
  for (const revision of [1, 5]) {
    const same = run([{ type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(winner(revision, true, false)) }], editing);
    const different = run([{ type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(winner(revision, false, true)) }], editing);
    assert.equal(locationAccessPolicyDirty(same.stored!.configuration, same.draft!), false);
    assert.equal(locationAccessPolicyDirty(different.stored!.configuration, different.draft!), true);

    const huSame = await render(same, "hu");
    assert.match(huSame, new RegExp(`A jelenlegi revízió: ${revision}\\.`));
    assert.doesNotMatch(huSame, new RegExp(`\\baz? ${revision}\\.`), "no article directly before the number");
    assert.doesNotMatch(huSame, /nem mentett beállításaidat mutatják/, "an equal draft is not an unsaved choice");
    const huDifferent = await render(different, "hu");
    assert.match(huDifferent, new RegExp(`A jelenlegi revízió: ${revision}\\. A kapcsolók továbbra is a te nem mentett beállításaidat mutatják\\.`));

    const enSame = await render(same, "en");
    assert.match(enSame, new RegExp(`The stored version is now revision ${revision}\\.`));
    assert.doesNotMatch(enSame, /still show your unsaved choices/);
    assert.doesNotMatch(enSame, /<button[^>]*data-location-access-save="save"(?![^>]*disabled)/, "nothing to save");
    const enDifferent = await render(different, "en");
    assert.match(enDifferent, /still show your unsaved choices/);
  }
});

test("the panel copy exists in both languages with the same keys", async () => {
  const en = (await messages("en")).configuration.locationAccess;
  const hu = (await messages("hu")).configuration.locationAccess;
  const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object"
    ? Object.entries(value as Json).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];
  assert.deepEqual(keys(en).sort(), keys(hu).sort());
  for (const flag of LOCATION_ACCESS_POLICY_FLAGS) {
    for (const leaf of ["title", "short", "copy"]) {
      assert.ok(en.flags[flag][leaf] && hu.flags[flag][leaf], `${flag}.${leaf}`);
    }
  }
  for (const key of ["saved", "conflict", "revision"]) {
    assert.match(en[key], /\{revision\}/, `en.${key}`);
    assert.match(hu[key], /\{revision\}/, `hu.${key}`);
  }
  assert.match(en.confirmCopy, /\{flags\}/);
  assert.match(hu.confirmCopy, /\{flags\}/);
});

test("the Configuration page mounts the panel and the proxy applies its normalizer", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<ProfilePresenceConfiguration \/>\s*<LocationAccessConfiguration \/>/);
  assert.match(route, /normalizeLocationAccessPolicyProxyBody\(action, body\)/);
});

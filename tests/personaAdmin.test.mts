import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
} from "../lib/contractReadiness.ts";
import {
  PERSONA_ADMIN_ACTIONS,
  PERSONA_ADMIN_BRIDGE_ERROR_STATUSES,
  PERSONA_ADMIN_CAPABILITY_ACTIONS,
  PERSONA_ADMIN_CONTRACT_VERSION,
  PERSONA_ADMIN_CORE_ERROR_STATUSES,
  PERSONA_ADMIN_ERROR_KEYS,
  PERSONA_ADMIN_MUTATION_ACTIONS,
  PERSONA_TRANSITIONED_CAPABILITY_ACTIONS,
  PERSONA_PENDING_STORAGE_KEY,
  PERSONA_START_FIELD_KEYS,
  PERSONA_START_SECTIONS,
  canonicalPersonaUid,
  canonicalPersonaRequestId,
  clonePersonaStartConfig,
  normalizePersonaProxyBody,
  normalizePersonaReason,
  normalizePersonaStartDraft,
  personaAdminCapabilitiesFrom,
  personaAdminErrorKey,
  personaAdminFailureResponse,
  personaCapabilityAllows,
  personaConflictResponse,
  personaForceMutationResponse,
  personaHighlightParts,
  personaMemberMutationConverged,
  personaMemberMutationResponse,
  personaPendingFrom,
  personaPendingMutation,
  personaPersistBeforeMutation,
  personaPreviewColor,
  personaPreviewImageUrl,
  personaProxyCapabilityAuthorized,
  personaShouldRetainMutation,
  personaStartConfigPatch,
  personaStartConfigResponse,
  personaStartDraftWithValue,
  personaStartFullPayload,
  personaStartResourceConverged,
  personaStartUpdateResponse,
  personaTargetFromUserDetail,
  personaTargetLookupData,
  personaTargetLookupResponse,
  type PersonaStartConfig,
} from "../lib/personaAdmin.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

type JsonObject = Record<string, unknown>;

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/persona_admin_contract_v1.json", import.meta.url), "utf8"),
) as Record<string, JsonObject>;

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function data(value: JsonObject): JsonObject {
  return object(value.data);
}

function configData(value: JsonObject): JsonObject {
  return object(data(value).config);
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function config(): PersonaStartConfig {
  const parsed = personaStartConfigResponse(fixtures.config_success);
  assert.ok(parsed);
  return parsed.config;
}

test("the version-1 fixture decodes one complete closed start configuration", () => {
  const parsed = config();
  assert.equal(PERSONA_START_FIELD_KEYS.length, 88);
  assert.equal(Object.keys(parsed).length, 88);
  assert.equal(parsed.progress_value, 0.25);
  assert.equal(parsed.title_main, "Verify in {{highlight}} to unlock Friending");
  assert.equal(parsed.trust_body_prefix, "Featured in ");
  assert.equal(parsed.benefit2_icon_url, "https://img.friending.co/api/cache/app/persona/bolt.png");

  const sectionFields = PERSONA_START_SECTIONS.flatMap((section) => section.fields);
  assert.equal(sectionFields.length, PERSONA_START_FIELD_KEYS.length);
  assert.equal(new Set(sectionFields).size, PERSONA_START_FIELD_KEYS.length);
  assert.deepEqual([...sectionFields].sort(), [...PERSONA_START_FIELD_KEYS].sort());

  const resource = personaStartConfigResponse(fixtures.config_success);
  assert.ok(resource);
  assert.equal(resource.contract_version, 1);
  assert.equal(resource.resource_revision, 7);
  assert.deepEqual(resource.config, parsed);
  assert.equal(personaStartUpdateResponse(fixtures.config_success), null);
  const payload = personaStartFullPayload(parsed);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), [...PERSONA_START_FIELD_KEYS].sort());
});

test("both locales cover the complete closed field, section, and error vocabularies", async () => {
  const sectionKeys = PERSONA_START_SECTIONS.map((section) => section.key).sort();
  const errorKeys = [...PERSONA_ADMIN_ERROR_KEYS, "generic"].sort();
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    ) as {
      personaAdmin?: {
        fields?: Record<string, unknown>;
        sections?: Record<string, unknown>;
        errors?: Record<string, unknown>;
      };
    };
    assert.deepEqual(
      Object.keys(messages.personaAdmin?.fields ?? {}).sort(),
      [...PERSONA_START_FIELD_KEYS].sort(),
      `${locale} Persona field copy`,
    );
    assert.deepEqual(
      Object.keys(messages.personaAdmin?.sections ?? {}).sort(),
      sectionKeys,
      `${locale} Persona section copy`,
    );
    assert.deepEqual(
      Object.keys(messages.personaAdmin?.errors ?? {}).sort(),
      errorKeys,
      `${locale} Persona error copy`,
    );
  }
});

test("config decoding ignores additions but fails on missing, loose, unsafe, or out-of-bound known values", () => {
  const contractLegalProgress = clone(fixtures.config_success);
  configData(contractLegalProgress).progress_value = 1.01;
  assert.equal(personaStartConfigResponse(contractLegalProgress)?.config.progress_value, 1.01);

  const additive = clone(fixtures.config_success);
  additive.trace_id = "not-contracted";
  data(additive).provider_state = "private";
  configData(additive).private_provider_key = "private";
  assert.deepEqual(personaStartConfigResponse(additive), personaStartConfigResponse(fixtures.config_success));

  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { raw.status_code = "200"; },
    (raw) => { data(raw).contract_version = 2; },
    (raw) => { data(raw).resource_revision = "7"; },
    (raw) => { delete configData(raw).active; },
    (raw) => { configData(raw).active = 1; },
    (raw) => { configData(raw).title_size = 80.5; },
    (raw) => { configData(raw).title_size = 81; },
    (raw) => { configData(raw).title_main = "x".repeat(201); },
    (raw) => { configData(raw).safety_body = "x".repeat(601); },
    (raw) => { configData(raw).trust_body_link_url = "http://example.test"; },
    (raw) => { configData(raw).trust_body_link_url = "https://user:pass@example.test/"; },
    (raw) => { configData(raw).benefit1_title = "unsafe\u0001text"; },
    (raw) => { configData(raw).benefit1_title = "unsafe\uD800text"; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.config_success);
    mutate(raw);
    assert.equal(personaStartConfigResponse(raw), null, mutate.toString());
  }
  assert.equal(personaStartConfigResponse(null), null);
  assert.equal(personaStartConfigResponse([]), null);

  const wrongLegacy = clone(fixtures.config_success);
  wrongLegacy.message = "200";
  assert.equal(personaStartConfigResponse(wrongLegacy), null);
});

test("draft normalization mirrors Core bounds without dirtying untouched legacy defaults", () => {
  const authoritative = config();
  const untouched = personaStartConfigPatch(authoritative, clonePersonaStartConfig(authoritative));
  assert.ok(untouched);
  assert.deepEqual(untouched.fields, []);
  assert.equal(untouched.normalized.trust_body_prefix, "Featured in ");

  let draft = clonePersonaStartConfig(authoritative);
  draft = personaStartDraftWithValue(draft, "title_main", "  Updated {{highlight}} title  ");
  draft = personaStartDraftWithValue(draft, "title_size", 100);
  draft = personaStartDraftWithValue(draft, "progress_value", -2);
  draft = personaStartDraftWithValue(draft, "benefit1_body", ` ${"🛡️".repeat(700)} `);
  const patch = personaStartConfigPatch(authoritative, draft);
  assert.ok(patch);
  assert.deepEqual(patch.fields, ["progress_value", "title_size", "title_main", "benefit1_body"]);
  assert.equal(patch.payload.progress_value, -2);
  assert.equal(patch.payload.title_size, 80);
  assert.equal(patch.payload.title_main, "Updated {{highlight}} title");
  assert.equal(Array.from(String(patch.payload.benefit1_body)).length, 600);

  const wholeDraft = normalizePersonaStartDraft(draft);
  assert.ok(wholeDraft);
  assert.equal(wholeDraft.trust_body_prefix, "Featured in");

  const unsafe = personaStartDraftWithValue(
    clonePersonaStartConfig(authoritative),
    "header_logo_url",
    "javascript:alert(1)",
  );
  assert.equal(personaStartConfigPatch(authoritative, unsafe), null);
});

test("legacy JSON slash and Unicode escapes are compared after decoding", () => {
  const encoded = JSON.stringify(fixtures.config_success)
    .replaceAll("/", "\\/")
    .replaceAll("Friending", "Fri\\u0065nding");
  const decoded = JSON.parse(encoded) as JsonObject;
  const parsed = personaStartConfigResponse(decoded);
  assert.ok(parsed);
  assert.equal(parsed.config.title_main, "Verify in {{highlight}} to unlock Friending");
  assert.equal(parsed.config.benefit2_icon_url, "https://img.friending.co/api/cache/app/persona/bolt.png");
});

test("admin_me Persona capabilities ignore additions and stay ordered, action-driven, and readiness-gated", () => {
  const viewer = personaAdminCapabilitiesFrom(fixtures.admin_me_viewer);
  const writer = personaAdminCapabilitiesFrom(fixtures.admin_me_writer);
  assert.ok(viewer && writer);
  assert.deepEqual(viewer.actions, ["read_start_config"]);
  assert.deepEqual(writer.actions, PERSONA_ADMIN_CAPABILITY_ACTIONS);
  assert.equal(personaCapabilityAllows(viewer, "read_start_config"), false);
  assert.equal(personaCapabilityAllows(writer, "force_verify"), false);
  const additive = clone(fixtures.admin_me_writer);
  additive.future_admin = true;
  object(additive.persona).provider_key = "private";
  assert.deepEqual(personaAdminCapabilitiesFrom(additive), writer);

  const readyWriterRaw = clone(fixtures.admin_me_writer);
  object(readyWriterRaw.persona).contract_ready = true;
  const readyWriter = personaAdminCapabilitiesFrom(readyWriterRaw);
  assert.ok(readyWriter);
  assert.equal(personaCapabilityAllows(readyWriter, "force_verify"), true);

  const transitionedWriter = clone(readyWriterRaw);
  object(transitionedWriter.persona).actions = [...PERSONA_TRANSITIONED_CAPABILITY_ACTIONS];
  assert.equal(personaAdminCapabilitiesFrom(transitionedWriter), null);
  assert.deepEqual(
    personaAdminCapabilitiesFrom(transitionedWriter, true)?.actions,
    PERSONA_TRANSITIONED_CAPABILITY_ACTIONS,
  );

  const roleIsNotAuthority = clone(readyWriterRaw);
  roleIsNotAuthority.role = "viewer";
  assert.equal(personaCapabilityAllows(personaAdminCapabilitiesFrom(roleIsNotAuthority), "apply_fake"), true);

  const malformed: Array<(raw: JsonObject) => void> = [
    (raw) => { object(raw.persona).contract_version = 2; },
    (raw) => { object(raw.persona).can_read = 1; },
    (raw) => { object(raw.persona).actions = ["read_start_config"]; },
    (raw) => { object(raw.persona).actions = [...PERSONA_ADMIN_CAPABILITY_ACTIONS].reverse(); },
    (raw) => { object(raw.persona).actions = [...PERSONA_ADMIN_CAPABILITY_ACTIONS, "provider_evidence"]; },
  ];
  for (const mutate of malformed) {
    const raw = clone(fixtures.admin_me_writer);
    mutate(raw);
    assert.equal(personaAdminCapabilitiesFrom(raw), null, mutate.toString());
  }
});

test("the proxy capability gate maps every Persona endpoint and rejects malformed or dormant principals", () => {
  const ready = clone(fixtures.admin_me_writer);
  object(ready.persona).contract_ready = true;
  for (const action of PERSONA_ADMIN_ACTIONS) {
    assert.equal(personaProxyCapabilityAuthorized(action, ready), true, action);
    assert.equal(personaProxyCapabilityAuthorized(action, fixtures.admin_me_writer), false, action);
  }
  assert.equal(personaProxyCapabilityAuthorized("overview", ready), null);
  assert.equal(personaProxyCapabilityAuthorized("admin_force_persona_verify", { success: true }), false);

  const viewerReady = clone(fixtures.admin_me_viewer);
  object(viewerReady.persona).contract_ready = true;
  assert.equal(personaProxyCapabilityAuthorized("persona_start_get_config_admin", viewerReady), true);
  assert.equal(personaProxyCapabilityAuthorized("persona_start_update_config", viewerReady), false);
  assert.equal(personaProxyCapabilityAuthorized("admin_apply_fake_persona", viewerReady), false);
});

test("the action-specific proxy boundary forwards only canonical contracted material", () => {
  assert.equal(normalizePersonaProxyBody("overview", {}), undefined);
  assert.deepEqual(
    { ...normalizePersonaProxyBody("persona_start_get_config_admin", { contract_version: 1 }) },
    { contract_version: 1 },
  );
  assert.equal(normalizePersonaProxyBody("persona_start_get_config_admin", {}), null);
  assert.equal(normalizePersonaProxyBody("persona_start_get_config_admin", { secret: "attacker" }), null);

  const mutationBase = {
    contract_version: 1,
    request_id: REQUEST_ID,
    expected_revision: 7,
    reason: "Approved support correction",
  };
  assert.deepEqual(
    { ...normalizePersonaProxyBody("persona_start_update_config", {
      ...mutationBase,
      active: false,
      progress_value: 0.5,
      title_size: 32,
      title_main: "Exact title",
      trust_body_link_url: "https://withpersona.com/",
    }) },
    {
      ...mutationBase,
      active: false,
      progress_value: 0.5,
      title_size: 32,
      title_main: "Exact title",
      trust_body_link_url: "https://withpersona.com/",
    },
  );
  assert.deepEqual(
    { ...normalizePersonaProxyBody("persona_start_update_config", {
      ...mutationBase,
      progress_value: 1.1,
    }) },
    { ...mutationBase, progress_value: 1.1 },
  );
  for (const invalid of [
    {},
    mutationBase,
    { ...mutationBase, contract_version: "1", active: false },
    { ...mutationBase, request_id: REQUEST_ID.toUpperCase(), active: false },
    { ...mutationBase, expected_revision: -1, active: false },
    { ...mutationBase, expected_revision: 2_147_483_648, active: false },
    { ...mutationBase, reason: " trailing ", active: false },
    { ...mutationBase, reason: "unsafe\nreason", active: false },
    { ...mutationBase, active: "0" },
    { ...mutationBase, progress_value: Number.NaN },
    { ...mutationBase, title_size: 81 },
    { ...mutationBase, title_main: " trailing " },
    { ...mutationBase, trust_body_link_url: "http://withpersona.com" },
    { ...mutationBase, unknown: "value" },
    { ...mutationBase, secret: "attacker", title_main: "x" },
    { ...mutationBase, admin_email: "attacker@example.test", title_main: "x" },
  ]) {
    assert.equal(normalizePersonaProxyBody("persona_start_update_config", invalid), null);
  }

  for (const action of [
    "admin_apply_fake_persona",
    "admin_revoke_fake_persona",
    "admin_force_persona_verify",
  ]) {
    const body = { ...mutationBase, uid: 42 };
    assert.deepEqual({ ...normalizePersonaProxyBody(action, body) }, body);
    assert.equal(normalizePersonaProxyBody(action, { ...mutationBase, uid: "42" }), null);
    assert.equal(normalizePersonaProxyBody(action, { ...mutationBase, uid: 42, expected_revision: 0 }), null);
    assert.equal(normalizePersonaProxyBody(action, { ...mutationBase, uid: 2_147_483_648 }), null);
    assert.equal(normalizePersonaProxyBody(action, { ...body, admin_email: "attacker@example.test" }), null);
  }
});

test("UID and target projections are canonical, bounded, and strip identity evidence additions", () => {
  assert.equal(canonicalPersonaUid("42"), 42);
  assert.equal(canonicalPersonaUid("0"), null);
  assert.equal(canonicalPersonaUid("042"), null);
  assert.equal(canonicalPersonaUid("+42"), null);
  assert.equal(canonicalPersonaUid("42.0"), null);
  assert.equal(canonicalPersonaUid(String(Number.MAX_SAFE_INTEGER + 1)), null);
  assert.equal(canonicalPersonaUid("2147483648"), null);

  const target = personaTargetFromUserDetail({
    success: true,
    status_code: 200,
    profile: {
      uid: 42,
      display_name: "Ada",
      persona_inquiry_id: "inq_private",
      provider_payload: { private: true },
      birthdate: "private",
    },
    persona_admin: { contract_version: 1, revision: 7 },
    message: 200,
    status: 200,
    can_send: 0,
  });
  assert.deepEqual(target, { uid: 42, displayName: "Ada", revision: 7 });
  assert.deepEqual(Object.keys(target ?? {}).sort(), ["displayName", "revision", "uid"]);
  assert.deepEqual(personaTargetLookupData(target!), { uid: 42, display_name: "Ada", revision: 7 });
  assert.deepEqual(personaTargetLookupResponse({
    success: true,
    status_code: 200,
    data: { uid: 42, display_name: "Ada", revision: 7 },
  }), target);
  assert.deepEqual(personaTargetLookupResponse({
    success: true,
    status_code: 200,
    data: { uid: 42, display_name: "Ada", revision: 7, birthdate: "private" },
    future_envelope: true,
  }), target, "a broad provider object is reduced to the dedicated browser projection");
  assert.equal(personaTargetFromUserDetail({ success: true, status_code: 200, profile: { uid: 42, display_name: "Ada" } }), null, "versioned member revision is required");
  assert.equal(personaTargetFromUserDetail({ success: true, status_code: 200, profile: { uid: 42, display_name: "bad\u0001name" }, persona_admin: { contract_version: 1, revision: 7 } }), null);
});

test("receipt-era mutation parsers ignore additions and require valid known revisions, replay flags, and material", () => {
  assert.deepEqual(personaMemberMutationResponse(fixtures.member_success), {
    contract_version: 1,
    uid: 42,
    revision: 8,
    replayed: false,
  });
  assert.deepEqual(personaForceMutationResponse(fixtures.force_success), {
    contract_version: 1,
    uid: 42,
    revision: 8,
    verify_image_url: "ab/able-user/1787684000hash_meetpic.jpeg",
    replayed: false,
  });

  const configMutation = clone(fixtures.config_success);
  data(configMutation).resource_revision = 8;
  data(configMutation).replayed = false;
  assert.equal(personaStartUpdateResponse(configMutation)?.resource_revision, 8);

  const additiveMember = clone(fixtures.member_success);
  additiveMember.trace = "future";
  data(additiveMember).reason = "must-not-return";
  assert.deepEqual(personaMemberMutationResponse(additiveMember), personaMemberMutationResponse(fixtures.member_success));
  const additiveForce = clone(fixtures.force_success);
  data(additiveForce).future_force = true;
  assert.deepEqual(personaForceMutationResponse(additiveForce), personaForceMutationResponse(fixtures.force_success));
  const additiveConfig = clone(configMutation);
  data(additiveConfig).future_config = true;
  assert.deepEqual(personaStartUpdateResponse(additiveConfig), personaStartUpdateResponse(configMutation));

  for (const mutate of [
    (raw: JsonObject) => { data(raw).replayed = "false"; },
    (raw: JsonObject) => { data(raw).revision = 0; },
    (raw: JsonObject) => { raw.status_code = 201; },
    (raw: JsonObject) => { raw.can_send = false; },
  ]) {
    const raw = clone(fixtures.member_success);
    mutate(raw);
    assert.equal(personaMemberMutationResponse(raw), null);
  }

  for (const path of [
    "/ab/user/hash_meetpic.jpeg",
    "ab/../hash_meetpic.jpeg",
    "ab/user/hash_meetpic.jpeg?token=private",
    "https://img.friending.co/api/cache/ab/user/hash_meetpic.jpeg",
    "ab/user/hash_free_pop_up.jpeg",
  ]) {
    const raw = clone(fixtures.force_success);
    data(raw).verify_image_url = path;
    assert.equal(personaForceMutationResponse(raw), null, path);
  }
});

test("every closed error requires its exact legacy envelope and status", () => {
  assert.equal(Object.keys(PERSONA_ADMIN_CORE_ERROR_STATUSES).length, 19);
  assert.equal(Object.keys(PERSONA_ADMIN_BRIDGE_ERROR_STATUSES).length, 9);
  assert.equal(PERSONA_ADMIN_ERROR_KEYS.length, 28);
  for (const [error, statusCode] of Object.entries(PERSONA_ADMIN_CORE_ERROR_STATUSES)) {
    const response = {
      success: false,
      status_code: statusCode,
      error,
      message: 200,
      status: 200,
      can_send: 0,
    };
    assert.equal(personaAdminFailureResponse(response)?.error, error, error);
    assert.equal(personaAdminErrorKey(error), error);
  }
  for (const [error, statusCode] of Object.entries(PERSONA_ADMIN_BRIDGE_ERROR_STATUSES)) {
    assert.equal(personaAdminFailureResponse({
      success: false,
      status_code: statusCode,
      error,
    })?.error, error, error);
  }
  assert.equal(personaAdminErrorKey("future-provider-error"), "generic");
  assert.equal(personaAdminErrorKey("constructor"), "generic");
  assert.equal(personaAdminFailureResponse({
    success: false,
    status_code: 409,
    error: "persona-conflict",
    data: { contract_version: 1, resource_revision: 8 },
    message: 200,
    status: 200,
    can_send: 0,
  }), null, "conflict data is parsed only by the conflict parser");
  assert.equal(personaAdminFailureResponse({
    success: false,
    status_code: 500,
    error: "future-provider-error",
    message: 200,
    status: 200,
    can_send: 0,
  }), null);
  assert.equal(personaAdminFailureResponse({
    success: false,
    status_code: 403,
    error: "persona-capability-required",
    message: 200,
    status: 200,
    can_send: 0,
  }), null, "bridge codes cannot widen into a Core envelope");
});

test("Persona conflicts select the two authoritative projections and ignore additions", () => {
  const configConflict = {
    success: false,
    status_code: 409,
    error: "persona-conflict",
    data: { contract_version: 1, resource_revision: 8 },
    message: 200,
    status: 200,
    can_send: 0,
  };
  const memberConflict = {
    ...configConflict,
    data: { contract_version: 1, uid: 42, revision: 9 },
  };
  assert.deepEqual(personaConflictResponse(configConflict), {
    kind: "config",
    contract_version: 1,
    resource_revision: 8,
  });
  assert.deepEqual(personaConflictResponse(memberConflict), {
    kind: "member",
    contract_version: 1,
    uid: 42,
    revision: 9,
  });
  assert.deepEqual(personaConflictResponse({
    ...configConflict,
    data: { contract_version: 1, resource_revision: 8, config: {} },
    trace: "future",
  }), personaConflictResponse(configConflict));
  assert.equal(personaConflictResponse({ ...configConflict, error: "persona-write-failed" }), null);
});

test("reasons, UUIDs, and durable pending rows are canonical and target-bound", async () => {
  assert.equal(canonicalPersonaRequestId(REQUEST_ID), REQUEST_ID);
  assert.equal(canonicalPersonaRequestId(REQUEST_ID.toUpperCase()), null);
  assert.equal(canonicalPersonaRequestId("123e4567-e89b-12d3-a456-426614174000"), null);
  assert.equal(normalizePersonaReason("  e\u0301rvényes indok  "), "érvényes indok");
  assert.equal(normalizePersonaReason("line\nbreak"), null);
  assert.equal(normalizePersonaReason("\u0000unsafe"), null);
  assert.equal(normalizePersonaReason("🛡".repeat(301)), null);

  const pending = personaPendingMutation("persona_start_update_config", {
    contract_version: 1,
    request_id: REQUEST_ID,
    expected_revision: 6,
    reason: "Approved correction",
    title_main: "Verify in {{highlight}} to unlock Friending",
  });
  assert.ok(pending);
  assert.equal(pending.target, "config:start");
  assert.deepEqual(personaPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(personaPendingFrom({ ...pending, target: "uid:42" }), null);
  assert.equal(personaPendingFrom({
    ...pending,
    payload: { ...pending.payload, secret: "attacker" },
  }), null);

  const events: string[] = [];
  const persisted = await personaPersistBeforeMutation(
    { setItem(key, value) {
      assert.equal(key, PERSONA_PENDING_STORAGE_KEY);
      assert.deepEqual(personaPendingFrom(JSON.parse(value)), pending);
      events.push("stored");
    } },
    pending,
    async () => {
      assert.deepEqual(events, ["stored"]);
      events.push("sent");
      return "response";
    },
  );
  assert.deepEqual(persisted, { ok: true, response: "response" });
  assert.deepEqual(events, ["stored", "sent"]);

  let sent = false;
  assert.deepEqual(await personaPersistBeforeMutation(
    { setItem() { throw new Error("private browsing"); } },
    pending,
    async () => { sent = true; return "never"; },
  ), { ok: false });
  assert.equal(sent, false);
});

test("canonical receipts and authoritative reads prove convergence without a second logical action", () => {
  const resource = personaStartConfigResponse(fixtures.config_success);
  assert.ok(resource);
  const configPending = personaPendingMutation("persona_start_update_config", {
    contract_version: 1,
    request_id: REQUEST_ID,
    expected_revision: 6,
    reason: "Approved correction",
    title_main: resource.config.title_main,
  });
  assert.ok(configPending);
  assert.equal(personaStartResourceConverged(resource, configPending), true);
  assert.equal(personaStartResourceConverged(
    { ...resource, resource_revision: 8 },
    configPending,
  ), false);

  const memberPending = personaPendingMutation("admin_apply_fake_persona", {
    contract_version: 1,
    uid: 42,
    request_id: REQUEST_ID,
    expected_revision: 7,
    reason: "Approved correction",
  });
  const memberResult = personaMemberMutationResponse(fixtures.member_success);
  assert.ok(memberPending && memberResult);
  assert.equal(personaMemberMutationConverged(memberResult, memberPending), true);
  assert.equal(personaMemberMutationConverged({ ...memberResult, revision: 7 }, memberPending), true, "already-applied synthetic marker is a same-revision canonical success");
  assert.equal(personaMemberMutationConverged({ ...memberResult, revision: 9 }, memberPending), false);

  assert.deepEqual(PERSONA_ADMIN_MUTATION_ACTIONS, [
    "persona_start_update_config",
    "admin_apply_fake_persona",
    "admin_revoke_fake_persona",
    "admin_force_persona_verify",
  ]);
  assert.equal(personaShouldRetainMutation("persona-request-in-progress"), true);
  assert.equal(personaShouldRetainMutation("persona-write-failed"), true);
  assert.equal(personaShouldRetainMutation("core-timeout"), true);
  assert.equal(personaShouldRetainMutation(null), true);
  assert.equal(personaShouldRetainMutation("persona-conflict"), false);
  assert.equal(personaShouldRetainMutation("persona-request-id-conflict"), false);
  assert.equal(personaShouldRetainMutation("user-not-found"), false);
});

test("preview helpers replace literal markers and suppress unsafe colors and remote images", () => {
  assert.deepEqual(
    personaHighlightParts("Before {{highlight}} after {{highlight}}.", "now"),
    [
      { text: "Before ", highlighted: false },
      { text: "now", highlighted: true },
      { text: " after ", highlighted: false },
      { text: "now", highlighted: true },
      { text: ".", highlighted: false },
    ],
  );
  assert.equal(personaPreviewColor("#7A7FFD", "#000000"), "#7A7FFD");
  assert.equal(personaPreviewColor("url(https://hostile.test)", "#000000"), "#000000");
  assert.equal(personaPreviewImageUrl("https://img.friending.co/api/cache/a.png"), "https://img.friending.co/api/cache/a.png");
  assert.equal(personaPreviewImageUrl("https://img.friending.co:444/api/cache/a.png"), null);
  assert.equal(personaPreviewImageUrl("https://tracking.example.test/pixel.png"), null);
  assert.equal(personaPreviewImageUrl("javascript:alert(1)"), null);
});

test("the released bridge keeps exact guest, origin, viewer, and writer gates", async () => {
  for (const action of PERSONA_ADMIN_ACTIONS) {
    assert.equal(isAdminActionAllowed(action), true);
    assert.equal(
      isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })),
      action === "persona_start_get_config_admin",
    );
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), true);
    assert.equal(
      isAdminActionAuthorized(action, adminPrincipalFrom({})),
      action === "persona_start_get_config_admin",
    );
  }

  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), true);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://hostile.example.test",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);

  const proxy = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  const originGate = proxy.indexOf("isTrustedAdminRequest(request.headers)");
  const allowListGate = proxy.indexOf("isAdminActionAllowed(action)");
  const sessionGate = proxy.indexOf("readAdminSession()");
  const capabilityGate = proxy.indexOf("personaProxyCapabilityAuthorized(");
  const bodyGate = proxy.indexOf("normalizePersonaProxyBody(action, body)");
  const identityMerge = proxy.indexOf("mergeCoreParams(body, { admin_email: session.email })");
  assert.ok(originGate >= 0 && allowListGate > originGate && sessionGate > allowListGate);
  assert.ok(capabilityGate > sessionGate && bodyGate > capabilityGate && identityMerge > bodyGate);
  assert.match(proxy, /if \(!session\)[\s\S]*?bridgeError\("auth-required", 401\)/);
  assert.match(proxy, /if \(!isTrustedAdminRequest\(request\.headers\)\)[\s\S]*?bridgeError\("bad-origin", 403\)/);
  assert.match(proxy, /if \(!isAdminActionAllowed\(action\)\)[\s\S]*?bridgeError\("not-found", 404\)/);
});

test("page, navigation, runtime readiness, confirmations, and same-origin calls share one cutover", async () => {
  const [page, shell, actions, route, memberRoute, component, model, session] = await Promise.all([
    readFile(new URL("../app/(dashboard)/persona/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/persona-member/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/PersonaAdminConsole.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/personaAdmin.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/session.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /if \(!me\?\.personaConsoleReady\) notFound\(\)/);
  assert.match(shell, /item\.key !== "persona" \|\| personaConsoleReady/);
  for (const action of PERSONA_ADMIN_ACTIONS) assert.match(actions, new RegExp(action));
  assert.match(route, /personaProxyCapabilityAuthorized/);
  assert.match(route, /normalizePersonaProxyBody/);

  const membershipCall = component.indexOf('adminCall("admin_me")');
  const configCall = component.indexOf('adminCall("persona_start_get_config_admin"');
  assert.ok(membershipCall >= 0 && configCall > membershipCall);
  for (const endpoint of PERSONA_ADMIN_ACTIONS) assert.match(component, new RegExp(endpoint));
  assert.equal(ADMIN_GRANTED_VERIFICATION_CONTRACT_READY, false);
  assert.match(component, /member\.adminGrantTransition/);
  assert.match(component, /adminCall\("persona-member", \{ uid: String\(uid\) \}\)/);
  assert.doesNotMatch(component, /adminCall\("user_detail"/);
  assert.match(memberRoute, /requireAdminWriter\(\)/);
  assert.match(component, /!ADMIN_GRANTED_VERIFICATION_CONTRACT_READY \|\| action === "force_verify"/);
  assert.match(memberRoute, /\["apply_fake", "revoke_fake", "force_verify"\]\.some/);
  assert.match(memberRoute, /isTrustedAdminRequest\(request\.headers\)/);
  assert.match(memberRoute, /coreCall\("user_detail"/);
  assert.match(memberRoute, /persona_contract_version: PERSONA_ADMIN_CONTRACT_VERSION/);
  assert.match(memberRoute, /personaTargetLookupData\(target\)/);
  assert.doesNotMatch(memberRoute, /json\(result\.data|NextResponse\.json\(result\.data/);
  assert.match(component, /personaCapabilityAllows\(capabilities, action/);
  assert.match(component, /<ConfirmDialog/);
  assert.match(component, /setMemberRecoveryRequired\(true\)/);
  assert.match(component, /setConfigRecoveryRequired\(true\)/);
  assert.match(component, /sessionStorage\.getItem\(PERSONA_PENDING_STORAGE_KEY\)/);
  assert.match(component, /personaPersistBeforeMutation/);
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /expected_revision: stored\.resource_revision/);
  assert.match(component, /expected_revision: target\.revision/);
  assert.match(component, /contract_version: PERSONA_ADMIN_CONTRACT_VERSION/);
  assert.doesNotMatch(component, /localStorage|setInterval|setTimeout|console\./);
  assert.doesNotMatch(component, /coreCall|core\.friending\.com|WEBADMIN_API_SECRET|provider_key|persona_inquiry/);
  assert.doesNotMatch(component, /verify_image_url/);
  assert.match(session, /personaCapabilityAllows\(persona, "read_start_config"\)/);
  assert.doesNotMatch(model, /console\.|provider_payload|birthdate|PERSONA_(?:PRODUCTION|SANDBOX)_KEY/);
});

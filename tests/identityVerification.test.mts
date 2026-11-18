import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIdentityBody, normalizeIdentityResponse, parseIdentityPayload } from "../lib/identityVerification.ts";
import { isAdminActionAllowed, isAdminBridgeActionAuthorized, adminPrincipalFrom } from "../lib/adminActions.ts";

const payload = { contract_version: 1, legacy_provider: "persona", can_write: true,
  configuration: { provider: "persona", min_ios_build: 245, workflow_id: "", revision: 0 },
  didit: { environment: "live", api_key: false, webhook_secret: false, application_id: false, media_hosts: false, environment_allowed: true, ready: false } };

test("identity provider projection is closed, typed and secret-free", () => {
  assert.ok(parseIdentityPayload(payload));
  assert.equal(parseIdentityPayload({ ...payload, api_key: "private" }), null);
  assert.equal(parseIdentityPayload({ ...payload, didit: { ...payload.didit, api_key: "private" } }), null);
  assert.equal(parseIdentityPayload({ ...payload, didit: { ...payload.didit, ready: true } }), null);
  assert.equal(parseIdentityPayload({ ...payload, configuration: { ...payload.configuration, min_ios_build: true } }), null);
  assert.equal(parseIdentityPayload({ ...payload, configuration: { ...payload.configuration, provider: ["persona"] } }), null);
  assert.equal(parseIdentityPayload({ ...payload, didit: { ...payload.didit, environment: ["live"] } }), null);
  assert.deepEqual(normalizeIdentityResponse({ success: false, status_code: 409, error: "identity-configuration-conflict", secret: "hidden" }, 200),
    { success: false, status_code: 409, error: "identity-configuration-conflict" });
});
test("identity answers count only with Core's HTTP 200 transport status", () => {
  const success = { success: true, status_code: 200, data: payload };
  assert.deepEqual(normalizeIdentityResponse(success, 200), { success: true, status_code: 200, data: payload });
  for (const status of [0, 201, 401, 500, 502, 503]) {
    assert.equal(normalizeIdentityResponse(success, status), null);
    assert.equal(normalizeIdentityResponse({ success: false, status_code: 409, error: "identity-configuration-conflict" }, status), null);
  }
});
test("identity writes carry only exact revision and validated candidate", () => {
  const action = "identity_verification_configuration_save";
  const configuration = { provider: "didit", min_ios_build: 245, workflow_id: "12345678-1234-1234-1234-123456789012" };
  const body = { expected_revision: 0, configuration_json: JSON.stringify(configuration) };
  assert.deepEqual(normalizeIdentityBody(action, body), body);
  assert.equal(normalizeIdentityBody(action, { ...body, api_key: "secret" }), null);
  assert.equal(normalizeIdentityBody(action, { ...body, configuration_json: JSON.stringify({ ...configuration, workflow_id: "" }) }), null);
  assert.deepEqual(normalizeIdentityBody("identity_verification_configuration", {}), {});
  assert.equal(normalizeIdentityBody("identity_verification_configuration", { uid: 1 }), null);
});
test("identity bridge action roles preserve read-only viewers", () => {
  assert.ok(isAdminActionAllowed("identity_verification_configuration_save"));
  const viewer = adminPrincipalFrom({ role: "viewer" });
  assert.equal(isAdminBridgeActionAuthorized("identity_verification_configuration_save", viewer), false);
});

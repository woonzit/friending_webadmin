import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WEBADMIN_LEGACY_CAN_SEND,
  WEBADMIN_LEGACY_MESSAGE,
  WEBADMIN_LEGACY_STATUS,
  webadminDataSuccessEnvelope,
  webadminEmptySuccessEnvelope,
  webadminEnvelope,
  webadminErrorEnvelope,
} from "../lib/webadminEnvelope.ts";

type JsonObject = Record<string, unknown>;

const LEGACY = {
  message: WEBADMIN_LEGACY_MESSAGE,
  status: WEBADMIN_LEGACY_STATUS,
  can_send: WEBADMIN_LEGACY_CAN_SEND,
} as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function fixture(name: string): Promise<JsonObject> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as JsonObject;
}

test("the shared A-ENV helper accepts exact data, empty, refusal, and conflict envelopes", () => {
  const success = { success: true, status_code: 200, data: { ok: true }, ...LEGACY };
  const empty = { success: true, status_code: 200, ...LEGACY };
  const failure = { success: false, status_code: 422, error: "field-invalid", ...LEGACY };
  const conflict = {
    success: false,
    status_code: 409,
    error: "resource-conflict",
    data: { revision: 2 },
    ...LEGACY,
  };

  assert.deepEqual(webadminDataSuccessEnvelope(success), success);
  assert.deepEqual(webadminEmptySuccessEnvelope(empty), empty);
  assert.deepEqual(webadminErrorEnvelope(failure), failure);
  assert.deepEqual(webadminErrorEnvelope(conflict, "required"), conflict);
  assert.deepEqual(
    webadminEnvelope({ success: true, status_code: 200, settings: {}, ...LEGACY }, true, ["settings"]),
    { success: true, status_code: 200, settings: {}, ...LEGACY },
  );
});

test("missing, additive, loose, or noncanonical legacy envelope fields fail closed", () => {
  const success = { success: true, status_code: 200, data: {}, ...LEGACY };
  for (const key of Object.keys(success)) {
    const raw = clone(success);
    delete raw[key as keyof typeof raw];
    assert.equal(webadminDataSuccessEnvelope(raw), null, `missing ${key}`);
  }
  for (const raw of [
    { ...success, trace_id: "not-contracted" },
    { ...success, success: 1 },
    { ...success, status_code: "200" },
    { ...success, status_code: 99 },
    { ...success, status_code: 600 },
    { ...success, message: "200" },
    { ...success, message: 201 },
    { ...success, status: "200" },
    { ...success, status: 201 },
    { ...success, can_send: false },
    { ...success, can_send: 1 },
  ]) assert.equal(webadminDataSuccessEnvelope(raw), null, JSON.stringify(raw));

  assert.equal(webadminDataSuccessEnvelope({ ...success, status_code: 201 }), null);
  assert.equal(webadminEmptySuccessEnvelope(success), null, "data may not appear on an empty success");
  assert.equal(webadminEmptySuccessEnvelope({ ...success, data: undefined }), null);
});

test("refusal data is present only on the declared conflict branch", () => {
  const failure = { success: false, status_code: 422, error: "field-invalid", ...LEGACY };
  const conflict = { ...failure, status_code: 409, data: { revision: 2 } };
  assert.equal(webadminErrorEnvelope(failure, "required"), null);
  assert.equal(webadminErrorEnvelope(conflict), null);
  assert.ok(webadminErrorEnvelope(conflict, "required"));
  assert.equal(webadminErrorEnvelope({ ...failure, error: "" }), null);
  assert.equal(webadminErrorEnvelope({ ...failure, error: 1 }), null);
  assert.equal(webadminErrorEnvelope({ ...failure, detail: "not-contracted" }), null);
});

test("all regenerated versioned fixtures carry the real Webadmin reply trio", async () => {
  const fixtureFiles = [
    "reported_content_contract_v1.json",
    "product_popup_contract_v1.json",
    "canned_templates_contract_v1.json",
    "outbound_messaging_contract_v1.json",
  ];
  for (const name of fixtureFiles) {
    const entries = await fixture(name);
    for (const [key, rawValue] of Object.entries(entries)) {
      const raw = rawValue as JsonObject;
      assert.equal(raw.message, 200, `${name}:${key}.message`);
      assert.equal(raw.status, 200, `${name}:${key}.status`);
      assert.equal(raw.can_send, 0, `${name}:${key}.can_send`);
      if (raw.success === true) {
        assert.ok(webadminDataSuccessEnvelope(raw), `${name}:${key} success envelope`);
      } else {
        assert.ok(webadminErrorEnvelope(raw, "required"), `${name}:${key} conflict envelope`);
      }
    }
  }

  const persona = await fixture("persona_admin_contract_v1.json");
  assert.ok(webadminDataSuccessEnvelope(persona.config_success));
  assert.ok(webadminDataSuccessEnvelope(persona.member_success));
  assert.ok(webadminDataSuccessEnvelope(persona.force_success));
});

test("every dormant console delegates transport parsing to the shared helper", async () => {
  const files = [
    "reportedContent.ts",
    "productPopup.ts",
    "cannedTemplates.ts",
    "personaAdmin.ts",
    "pushAdmin.ts",
    "outboundMessaging.ts",
    "footprintVisits.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8");
    assert.match(source, /@\/lib\/webadminEnvelope/, file);
  }
});

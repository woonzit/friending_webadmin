import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTranslator } from "next-intl";
import { adminCall } from "../lib/adminClient.ts";
import { WAITING_ROOM_COMPILED_COPY } from "../lib/forcedVerification.ts";
import {
  VERIFICATION_METHOD_CONFIRMATION_PHRASE,
  verificationMethodDocument,
  verificationMethodErrorResponse,
  verificationMethodPendingFrom,
  verificationMethodPendingMutation,
  verificationMethodPersistBeforeMutation,
  verificationMethodPhotoCopyGuidance,
  verificationMethodShouldRetainMutation,
  type MandatoryMethod,
  type VerificationMethodDocument,
} from "../lib/verificationMethod.ts";

// Core T-868: VerificationMethodPolicy::photoHelpConfigurationError. Existing
// copy codes carry logical 422 inside HTTP 200, not a new error vocabulary.
const DEFAULT_ERROR = "verification-method-copy-default-invalid";
const OVERRIDES_ERROR = "verification-method-copy-overrides-invalid";
const REQUEST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HELP_URL = "https://help.friending.com/verification";

function document(
  global: MandatoryMethod,
  overrides: Record<string, MandatoryMethod> = {},
): VerificationMethodDocument {
  return {
    global,
    overrides,
    waiting_room_copy: {
      default: {
        en: { ...WAITING_ROOM_COMPILED_COPY.en, help_url: null },
        hu: { ...WAITING_ROOM_COMPILED_COPY.hu, help_url: null },
      },
      overrides: Object.fromEntries(Object.keys(overrides).map((key) => [key, { en: {}, hu: {} }])),
    },
  };
}

function save(draft: VerificationMethodDocument) {
  const pending = verificationMethodPendingMutation("verification_method_save", {
    contract_version: 1, draft_json: draft, expected_revision: 4, request_id: REQUEST_ID,
  });
  assert.ok(pending);
  return pending;
}

function refusal(error: string, status_code = 422) {
  return { message: 200, status: 200, can_send: 0, success: false, status_code, error };
}

test("global photo copy refusals identify the bilingual default help requirement", () => {
  for (const missing of ["en", "hu", "both"]) {
    const draft = document("photo");
    if (missing === "hu") draft.waiting_room_copy.default.en.help_url = HELP_URL;
    if (missing === "en") draft.waiting_room_copy.default.hu.help_url = HELP_URL;
    const pending = save(draft);
    assert.equal(verificationMethodPhotoCopyGuidance(
      verificationMethodErrorResponse(refusal(DEFAULT_ERROR)), pending,
    ), "default", missing);
    assert.equal(verificationMethodShouldRetainMutation(DEFAULT_ERROR), false);
  }
});

test("explicit photo overrides select override guidance without changing the global method", () => {
  for (const global of ["persona", "video", "photo", "none"] as const) {
    const pending = save(document(global, { HUN: "photo", USA: "video" }));
    assert.equal(verificationMethodPhotoCopyGuidance(
      verificationMethodErrorResponse(refusal(OVERRIDES_ERROR)), pending,
    ), "overrides", global);
    assert.equal(verificationMethodShouldRetainMutation(OVERRIDES_ERROR), false);
  }
});

test("photo overrides can inherit both locale help links; guidance is not a new validator", () => {
  const draft = document("persona", { HUN: "photo" });
  draft.waiting_room_copy.default.en.help_url = `${HELP_URL}/en`;
  draft.waiting_room_copy.default.hu.help_url = `${HELP_URL}/hu`;
  const pending = save(draft);
  const before = JSON.stringify(pending);
  assert.deepEqual(pending.payload.draft_json, draft);
  // The code can also reject other copy fields. Even with help links present,
  // the notice asks to review copy, not falsely asserting a missing-link cause.
  assert.equal(verificationMethodPhotoCopyGuidance(OVERRIDES_ERROR, pending), "overrides");
  assert.equal(JSON.stringify(pending), before, "no links, identity or material are rewritten");
  assert.deepEqual(draft.waiting_room_copy.overrides.HUN, { en: {}, hu: {} });
});

test("non-photo scopes, mismatched copy scopes and other actions keep generic handling", () => {
  for (const method of ["persona", "video", "none"] as const) {
    const pending = save(document(method, { HUN: method }));
    for (const error of [DEFAULT_ERROR, OVERRIDES_ERROR] as const) {
      assert.equal(verificationMethodPhotoCopyGuidance(error, pending), null);
    }
  }
  assert.equal(verificationMethodPhotoCopyGuidance(DEFAULT_ERROR, save(document("video", { HUN: "photo" }))), null);
  assert.equal(verificationMethodPhotoCopyGuidance(OVERRIDES_ERROR, save(document("photo", { HUN: "video" }))), null);
  const apply = verificationMethodPendingMutation("verification_method_apply", {
    contract_version: 1, expected_revision: 4, normalized_fingerprint: "a".repeat(64),
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE, reason: "Review", request_id: REQUEST_ID,
  });
  assert.ok(apply);
  for (const error of [DEFAULT_ERROR, OVERRIDES_ERROR] as const) {
    assert.equal(verificationMethodPhotoCopyGuidance(error, apply), null);
    assert.equal(verificationMethodPhotoCopyGuidance(error, {
      ...save(document("photo")), action: "verification_method_console",
    }), null);
  }
});

test("malformed commands, status mismatches and unknown outcomes never become photo help errors", () => {
  const pending = save(document("photo", { HUN: "photo" }));
  for (const malformed of [
    null, {}, { ...pending, version: 2 }, { ...pending, extra: 1 },
    { ...pending, payload: { ...pending.payload, request_id: "invalid" } },
    { ...pending, payload: { ...pending.payload, draft_json: JSON.stringify(pending.payload.draft_json) } },
    { ...pending, payload: { ...pending.payload, draft_json: { global: "photo" } } },
  ]) {
    for (const error of [DEFAULT_ERROR, OVERRIDES_ERROR] as const) {
      assert.equal(verificationMethodPhotoCopyGuidance(error, malformed), null);
    }
  }
  for (const error of [DEFAULT_ERROR, OVERRIDES_ERROR] as const) {
    for (const status of [200, 400, 409, 500]) {
      const parsed = verificationMethodErrorResponse(refusal(error, status));
      assert.equal(parsed, null);
      assert.equal(verificationMethodPhotoCopyGuidance(parsed, pending), null);
      assert.equal(verificationMethodShouldRetainMutation(parsed), true);
    }
  }
  for (const error of [null, "verification-method-photo-unavailable", "verification-method-write-failed", "invalid-input"] as const) {
    assert.equal(verificationMethodPhotoCopyGuidance(error, pending), null);
  }
});

test("HTTP-200 logical-422 refusals reach photo guidance through the production transport and decoder", async (t) => {
  for (const [error, draft, expected] of [
    [DEFAULT_ERROR, document("photo"), "default"],
    [OVERRIDES_ERROR, document("persona", { HUN: "photo" }), "overrides"],
  ] as const) {
    const pending = save(draft);
    const sent: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    const fetchMock = t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      sent.push({ input, init });
      return new Response(JSON.stringify(refusal(error)), { status: 200 });
    });
    const response = await adminCall(pending.action, pending.payload);
    const parsed = verificationMethodErrorResponse(response);
    assert.equal(parsed, error);
    assert.equal(verificationMethodPhotoCopyGuidance(parsed, pending), expected);
    assert.equal(verificationMethodShouldRetainMutation(parsed), false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].input, "/api/admin/verification_method_save");
    assert.equal(sent[0].init?.method, "POST");
    assert.equal(sent[0].init?.cache, "no-store");
    assert.equal(sent[0].init?.body, JSON.stringify(pending.payload));
    fetchMock.mock.restore();
  }
});

test("an uncertain save retries its durable photo material, not a newer non-photo editor", async (t) => {
  const original = save(document("photo"));
  let stored = "";
  const requests: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    requests.push(init?.body);
    return new Response(JSON.stringify(refusal(DEFAULT_ERROR, requests.length === 1 ? 200 : 422)), { status: 200 });
  });
  const first = await verificationMethodPersistBeforeMutation(
    { setItem: (_key: string, value: string) => { stored = value; } }, original,
    () => adminCall(original.action, original.payload),
  );
  assert.ok(first.ok);
  assert.equal(verificationMethodShouldRetainMutation(verificationMethodErrorResponse(first.response)), true);
  const newerEditor = save(document("video"));
  const retained = verificationMethodPendingFrom(JSON.parse(stored));
  assert.ok(retained);
  assert.deepEqual(retained, original);
  const retry = await adminCall(retained.action, retained.payload);
  const error = verificationMethodErrorResponse(retry);
  assert.equal(error, DEFAULT_ERROR);
  assert.equal(verificationMethodPhotoCopyGuidance(error, retained), "default");
  assert.equal(verificationMethodPhotoCopyGuidance(error, newerEditor), null);
  assert.equal(verificationMethodShouldRetainMutation(error), false);
  assert.deepEqual(requests, [JSON.stringify(original.payload), JSON.stringify(original.payload)]);
  assert.equal(retained.payload.request_id, REQUEST_ID);
  assert.equal(retained.payload.expected_revision, 4);
});

test("both locales explain bilingual HTTPS help and allowed override inheritance", async () => {
  for (const locale of ["en", "hu"] as const) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const translate = createTranslator({ locale, messages, namespace: "verificationAdmin.methodPolicy" });
    assert.deepEqual(Object.keys(messages.verificationAdmin.methodPolicy.photoHelp).sort(), ["default", "overrides"]);
    for (const [error, draft] of [
      [DEFAULT_ERROR, document("photo")], [OVERRIDES_ERROR, document("video", { HUN: "photo" })],
    ] as const) {
      const key = verificationMethodPhotoCopyGuidance(error, save(draft));
      assert.ok(key);
      const copy = translate(`photoHelp.${key}`, { code: error });
      assert.ok(copy.includes(error));
      assert.match(copy, /HTTPS/u);
      assert.match(copy, locale === "en" ? /English.*Hungarian/u : /angol.*magyar/u);
      assert.match(copy, locale === "en" ? /Review the text and help links/u : /Ellenőrizd a szöveget és a súgólinkeket/u);
      if (key === "overrides") assert.match(copy, locale === "en" ? /inherited from the defaults/u : /alapbeállításából is örökölhető/u);
    }
  }
});

test("the console dispatches notice context captured before clearing a terminal receipt", async () => {
  const source = await readFile(new URL("../components/VerificationMethodScopesTable.tsx", import.meta.url), "utf8");
  assert.match(source, /const durable = pendingRef\.current \?\? next;[\s\S]*if \(!verificationMethodShouldRetainMutation\(error\)\) clearPending\(\);[\s\S]*setNotice\(refusalNotice\(error, durable\)\)/u);
  assert.match(source, /verificationMethodPhotoCopyGuidance\(error, command\)/u);
  assert.ok(source.includes('t(`photoHelp.${photoCopy}`, { code: error })'));
});

test("older photo documents without help links remain readable for repair", () => {
  const legacy = document("photo", { HUN: "photo" });
  assert.deepEqual(verificationMethodDocument(legacy), legacy);
  assert.ok(save(legacy), "Core supplies the write-time refusal; this change does not tighten reads or the proxy");
});

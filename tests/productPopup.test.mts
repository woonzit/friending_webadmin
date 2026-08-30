import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  PRODUCT_POPUP_ERROR_KEYS,
  PRODUCT_POPUP_ERROR_STATUSES,
  PRODUCT_POPUP_MAX_FUTURE_SECONDS,
  PRODUCT_POPUP_MIN_FUTURE_SECONDS,
  canonicalProductPopupUrl,
  normalizeProductPopupAuditReason,
  productPopupCanWrite,
  productPopupClearPayload,
  productPopupClearResponse,
  productPopupConflictResponse,
  productPopupDefaultExpiry,
  productPopupErrorKey,
  productPopupErrorResponse,
  productPopupExpiryIsAllowed,
  productPopupMutationConverged,
  productPopupPendingClear,
  productPopupPendingMutation,
  productPopupPendingSet,
  productPopupPendingStorageKey,
  productPopupReadResponse,
  productPopupResourceConverged,
  productPopupSetMaterial,
  productPopupSetPayload,
  productPopupSetResponse,
  productPopupShouldRetainMutation,
  type ProductPopupDraft,
} from "../lib/productPopup.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

type JsonObject = Record<string, unknown>;

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/product_popup_contract_v1.json", import.meta.url), "utf8"),
) as Record<string, JsonObject>;

const NOW = 1_787_674_800;
const REQUEST_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

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

function popup(value: JsonObject): JsonObject {
  return object(data(value).popup);
}

function button(value: JsonObject): JsonObject {
  return object(popup(value).button);
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function validDraft(overrides: Partial<ProductPopupDraft> = {}): ProductPopupDraft {
  return {
    title: "  PLUS is ready  ",
    message: "  Open the benefits selected for your account.  ",
    repeatMode: "until_expiry",
    expiresAt: 1_788_279_600,
    buttonAction: "url",
    buttonTitle: "  View benefits  ",
    buttonUrl: " https://FRIENDING.com/plus?source=popup ",
    auditReason: "  Approved support campaign  ",
    ...overrides,
  };
}

test("the accepted version-1 fixtures decode exact empty, active, expired, mutation, replay, and conflict resources", () => {
  const never = productPopupReadResponse(fixtures.never_authored);
  assert.ok(never);
  assert.equal(never.resource_revision, 0);
  assert.equal(never.popup, null);
  assert.equal(never.evaluated_at, NOW);

  const active = productPopupReadResponse(fixtures.active_url);
  assert.ok(active?.popup);
  assert.equal(active.popup.status, "active");
  assert.equal(active.popup.button.url, "https://friending.com/plus?source=popup");

  const expired = productPopupReadResponse(fixtures.expired_rate);
  assert.ok(expired?.popup);
  assert.equal(expired.popup.status, "expired");
  assert.equal(expired.popup.button.action, "rate");

  const cleared = productPopupReadResponse(fixtures.explicitly_cleared);
  assert.ok(cleared);
  assert.equal(cleared.resource_revision, 5);
  assert.equal(cleared.popup, null);

  const set = productPopupSetResponse(fixtures.set_success);
  const replay = productPopupSetResponse(fixtures.set_replay);
  const clear = productPopupClearResponse(fixtures.clear_success);
  assert.ok(set?.popup && replay?.popup && clear);
  assert.equal(set.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(clear.popup, null);

  const conflict = productPopupConflictResponse(fixtures.conflict);
  const alreadyClear = productPopupConflictResponse(fixtures.already_clear);
  assert.equal(conflict?.error, "product-popup-conflict");
  assert.equal(conflict?.resource.resource_revision, 4);
  assert.equal(alreadyClear?.error, "product-popup-already-clear");
  assert.equal(alreadyClear?.resource.popup, null);
});

test("Core's evaluated_at clock is required and alone determines the active or expired response status", () => {
  const atBoundary = clone(fixtures.active_url);
  data(atBoundary).evaluated_at = popup(atBoundary).expires_at;
  popup(atBoundary).status = "expired";
  assert.ok(productPopupReadResponse(atBoundary), "expiry equal to Core time is expired");

  const contradictions: Array<(raw: JsonObject) => void> = [
    (raw) => { delete data(raw).evaluated_at; },
    (raw) => { data(raw).evaluated_at = String(NOW); },
    (raw) => { data(raw).evaluated_at = -1; },
    (raw) => { popup(raw).status = "expired"; },
  ];
  for (const mutate of contradictions) {
    const raw = clone(fixtures.active_url);
    mutate(raw);
    assert.equal(productPopupReadResponse(raw), null, mutate.toString());
  }

  const independentTimestamps = clone(fixtures.active_url);
  data(independentTimestamps).evaluated_at = 100;
  popup(independentTimestamps).expires_at = 125;
  popup(independentTimestamps).updated_at = 150;
  popup(independentTimestamps).created_at = 200;
  popup(independentTimestamps).status = "active";
  assert.ok(
    productPopupReadResponse(independentTimestamps),
    "the contract states no created/updated/evaluated/expiry ordering beyond status vs evaluated_at",
  );
});

test("closed envelopes, principals, popup projections, and timestamps fail on every shape surprise", () => {
  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { raw.trace_id = "not-contracted"; },
    (raw) => { raw.status_code = "200"; },
    (raw) => { data(raw).contract_version = 2; },
    (raw) => { data(raw).provider_id = "private"; },
    (raw) => { object(data(raw).principal).role = "superadmin"; },
    (raw) => { object(data(raw).principal).capabilities = []; },
    (raw) => { object(data(raw).principal).capabilities = ["product_popup_read", "product_popup_read"]; },
    (raw) => { object(data(raw).principal).capabilities = ["product_popup_write", "product_popup_read"]; },
    (raw) => { object(data(raw).principal).capabilities = ["product_popup_read", "private_capability"]; },
    (raw) => { popup(raw).device_token = "private"; },
    (raw) => { popup(raw).pop_id = "bad/id"; },
    (raw) => { popup(raw).revision = 2; },
    (raw) => { popup(raw).title = " trailing "; },
    (raw) => { popup(raw).message = "Cafe\u0301"; },
    (raw) => { popup(raw).message = "unsafe\uD800text"; },
    (raw) => { popup(raw).created_by = "Admin@friending.com"; },
    (raw) => { popup(raw).created_at = -1; },
    (raw) => { data(raw).resource_revision = 0; popup(raw).revision = 0; },
    (raw) => { button(raw).debug = true; },
    (raw) => { button(raw).action = "none"; },
    (raw) => { button(raw).url = " https://friending.com/plus?source=popup"; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.active_url);
    mutate(raw);
    assert.equal(productPopupReadResponse(raw), null, mutate.toString());
  }

  assert.equal(productPopupReadResponse(null), null);
  assert.equal(productPopupReadResponse([]), null);

  const wrongSuccessKind = clone(fixtures.set_success);
  data(wrongSuccessKind).popup = null;
  assert.equal(productPopupSetResponse(wrongSuccessKind), null);
  assert.equal(productPopupClearResponse(fixtures.set_success), null);

  const viewerMutation = clone(fixtures.set_success);
  object(data(viewerMutation).principal).role = "viewer";
  object(data(viewerMutation).principal).capabilities = ["product_popup_read"];
  assert.equal(productPopupSetResponse(viewerMutation), null);

  const impossibleFirstClear = clone(fixtures.clear_success);
  data(impossibleFirstClear).resource_revision = 1;
  assert.equal(productPopupClearResponse(impossibleFirstClear), null);

  const badAlreadyClear = clone(fixtures.already_clear);
  data(badAlreadyClear).popup = clone(data(fixtures.conflict).popup);
  assert.equal(productPopupConflictResponse(badAlreadyClear), null);

  const viewerConflict = clone(fixtures.conflict);
  object(data(viewerConflict).principal).role = "viewer";
  object(data(viewerConflict).principal).capabilities = ["product_popup_read"];
  assert.equal(productPopupConflictResponse(viewerConflict), null);
});

test("write controls use only Core-authored capabilities and never infer from the role name", () => {
  const viewer = productPopupReadResponse(fixtures.never_authored);
  assert.ok(viewer);
  assert.equal(productPopupCanWrite(viewer.principal), false);

  const ownerReadOnly = clone(fixtures.never_authored);
  object(data(ownerReadOnly).principal).role = "owner";
  const parsedOwner = productPopupReadResponse(ownerReadOnly);
  assert.ok(parsedOwner);
  assert.equal(productPopupCanWrite(parsedOwner.principal), false);

  const viewerWriter = clone(fixtures.active_url);
  object(data(viewerWriter).principal).role = "viewer";
  const parsedViewer = productPopupReadResponse(viewerWriter);
  assert.ok(parsedViewer);
  assert.equal(productPopupCanWrite(parsedViewer.principal), true);
});

test("HTTPS destinations normalize canonically and reject credentials, unsafe schemes, and every control character", () => {
  assert.equal(
    canonicalProductPopupUrl("  https://EXAMPLE.com/a/../benefits?q=one  "),
    "https://example.com/benefits?q=one",
  );
  assert.equal(canonicalProductPopupUrl("https://example.com"), "https://example.com/");

  const legalWireSpelling = clone(fixtures.active_url);
  button(legalWireSpelling).url = "https://FRIENDING.com/a/../plus?source=popup";
  const normalizedWire = productPopupReadResponse(legalWireSpelling);
  assert.equal(
    normalizedWire?.popup?.button.url,
    "https://friending.com/plus?source=popup",
    "contract-legal URLs compare and render after normalization, not byte identity",
  );

  for (const invalid of [
    "http://example.com",
    "https://user:pass@example.com/path",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///tmp/secret",
    "/relative/path",
    "//example.com/path",
    "https://",
    "https://example.com/line\nbreak",
    "https://example.com/tab\tvalue",
    "https://example.com/control\u0085value",
    "https://example.com/unsafe\uD800value",
    `https://example.com/${"x".repeat(501)}`,
  ]) {
    assert.equal(canonicalProductPopupUrl(invalid), null, invalid);
  }
});

test("set material and payload validation normalize exact Unicode text, URL, horizon, and button cross-fields", () => {
  const material = productPopupSetMaterial(validDraft({
    title: "  PLUS is ready  ",
    auditReason: "  Approved Cafe\u0301 campaign  ",
  }), NOW);
  assert.deepEqual(material, {
    ok: true,
    payload: {
      audit_reason: "Approved Café campaign",
      title: "PLUS is ready",
      message: "Open the benefits selected for your account.",
      repeat_mode: "until_expiry",
      expires_at: 1_788_279_600,
      button_action: "url",
      button_title: "View benefits",
      button_url: "https://friending.com/plus?source=popup",
    },
  });

  const payload = productPopupSetPayload(
    42,
    3,
    validDraft(),
    REQUEST_ID.toUpperCase(),
    NOW,
  );
  assert.ok(payload.ok);
  assert.equal(payload.payload.request_id, REQUEST_ID);
  assert.equal(payload.payload.expected_revision, 3);
  assert.ok(material.ok);
  const previewMaterial = productPopupSetMaterial(validDraft(), NOW);
  assert.ok(previewMaterial.ok);
  assert.deepEqual(
    {
      audit_reason: payload.payload.audit_reason,
      title: payload.payload.title,
      message: payload.payload.message,
      repeat_mode: payload.payload.repeat_mode,
      expires_at: payload.payload.expires_at,
      button_action: payload.payload.button_action,
      button_title: payload.payload.button_title,
      button_url: payload.payload.button_url,
    },
    previewMaterial.payload,
    "preview material is the exact normalized mutation material",
  );

  assert.equal(productPopupExpiryIsAllowed(NOW + PRODUCT_POPUP_MIN_FUTURE_SECONDS, NOW), true);
  assert.equal(productPopupExpiryIsAllowed(NOW + PRODUCT_POPUP_MAX_FUTURE_SECONDS, NOW), true);
  assert.equal(productPopupExpiryIsAllowed(NOW + PRODUCT_POPUP_MIN_FUTURE_SECONDS - 1, NOW), false);
  assert.equal(productPopupExpiryIsAllowed(NOW + PRODUCT_POPUP_MAX_FUTURE_SECONDS + 1, NOW), false);
  assert.equal(productPopupDefaultExpiry(NOW), NOW + 7 * 24 * 60 * 60);
  assert.equal(normalizeProductPopupAuditReason("  Cafe\u0301 review  "), "Café review");

  const validNone = productPopupSetMaterial(validDraft({
    buttonAction: "none",
    buttonTitle: "   ",
    buttonUrl: "   ",
  }), NOW);
  assert.ok(validNone.ok);
  assert.equal(validNone.payload.button_title, "");
  assert.equal(validNone.payload.button_url, "");

  const validRate = productPopupSetMaterial(validDraft({
    buttonAction: "rate",
    buttonTitle: "Rate Friending",
    buttonUrl: "",
  }), NOW);
  assert.ok(validRate.ok);
  assert.equal(validRate.payload.button_action, "rate");

  const invalidDrafts: Array<[Partial<ProductPopupDraft>, string]> = [
    [{ title: "   " }, "title"],
    [{ title: "😀".repeat(101) }, "title"],
    [{ title: "unsafe\uD800title" }, "title"],
    [{ message: "x".repeat(1001) }, "message"],
    [{ auditReason: "\u0007unsafe" }, "auditReason"],
    [{ expiresAt: NOW + 299 }, "expiry"],
    [{ expiresAt: NOW + PRODUCT_POPUP_MAX_FUTURE_SECONDS + 1 }, "expiry"],
    [{ repeatMode: "forever" as ProductPopupDraft["repeatMode"] }, "repeatMode"],
    [{ buttonAction: "none", buttonTitle: "Unexpected", buttonUrl: "" }, "button"],
    [{ buttonAction: "rate", buttonTitle: "", buttonUrl: "" }, "button"],
    [{ buttonAction: "rate", buttonTitle: "Rate", buttonUrl: "https://example.com" }, "button"],
    [{ buttonAction: "url", buttonTitle: "Open", buttonUrl: "http://example.com" }, "buttonUrl"],
  ];
  for (const [override, expectedError] of invalidDrafts) {
    const result = productPopupSetMaterial(validDraft(override), NOW);
    assert.equal(result.ok, false, JSON.stringify(override));
    if (!result.ok) assert.equal(result.error, expectedError);
  }

  assert.equal(productPopupSetPayload(0, 3, validDraft(), REQUEST_ID, NOW).ok, false);
  assert.equal(productPopupSetPayload(42, -1, validDraft(), REQUEST_ID, NOW).ok, false);
  assert.equal(productPopupSetPayload(42, 3, validDraft(), "not-v4", NOW).ok, false);
});

test("clear and pending helpers preserve one exact retry identity without revalidating an elapsed expiry", () => {
  const setResult = productPopupSetPayload(42, 3, validDraft(), REQUEST_ID, NOW);
  assert.ok(setResult.ok);
  const pendingSet = productPopupPendingSet(setResult.payload);
  assert.deepEqual(productPopupPendingMutation(pendingSet), pendingSet);

  const muchLater = NOW + PRODUCT_POPUP_MAX_FUTURE_SECONDS * 2;
  assert.equal(productPopupExpiryIsAllowed(setResult.payload.expires_at, muchLater), false);
  assert.deepEqual(
    productPopupPendingMutation(JSON.parse(JSON.stringify(pendingSet))),
    pendingSet,
    "durable retry parsing is structural and does not mint a changed expiry",
  );

  const clearResult = productPopupClearPayload(
    42,
    3,
    "  Member requested removal  ",
    REQUEST_ID.toUpperCase(),
  );
  assert.deepEqual(clearResult, {
    ok: true,
    payload: {
      contract_version: 1,
      uid: 42,
      expected_revision: 3,
      request_id: REQUEST_ID,
      audit_reason: "Member requested removal",
    },
  });
  assert.ok(clearResult.ok);
  const pendingClear = productPopupPendingClear(clearResult.payload);
  assert.deepEqual(productPopupPendingMutation(pendingClear), pendingClear);
  assert.equal(productPopupPendingStorageKey(42), "friending.product-popup.pending-mutation.v1:42");

  for (const invalid of [
    { ...pendingSet, extra: true },
    { ...pendingSet, version: 2 },
    { ...pendingSet, action: "replace" },
    { ...pendingSet, payload: { ...pendingSet.payload, request_id: REQUEST_ID.toUpperCase() } },
    { ...pendingSet, payload: { ...pendingSet.payload, title: ` ${pendingSet.payload.title}` } },
  ]) {
    assert.equal(productPopupPendingMutation(invalid), null);
  }
  assert.deepEqual(productPopupPendingMutation({
    ...pendingSet,
    payload: {
      ...pendingSet.payload,
      button_url: "https://FRIENDING.com/plus?source=popup",
    },
  }), pendingSet, "durable state normalizes equivalent legal HTTPS spelling");
  assert.equal(productPopupClearPayload(42, 3, "   ", REQUEST_ID).ok, false);
});

test("authoritative reads and mutation responses clear only an exactly converged saved gesture", () => {
  const setPayload = productPopupSetPayload(42, 3, validDraft(), REQUEST_ID, NOW);
  assert.ok(setPayload.ok);
  const pendingSet = productPopupPendingSet(setPayload.payload);
  const set = productPopupSetResponse(fixtures.set_success);
  assert.ok(set);
  assert.equal(productPopupMutationConverged(set, pendingSet), true);
  assert.equal(productPopupResourceConverged(set, pendingSet), true);
  assert.equal(productPopupResourceConverged(set, {
    ...pendingSet,
    payload: { ...pendingSet.payload, title: "Different title" },
  }), false);
  assert.equal(productPopupResourceConverged(set, {
    ...pendingSet,
    payload: { ...pendingSet.payload, expected_revision: 4 },
  }), false);

  const clearPayload = productPopupClearPayload(42, 3, "Clear after support case", REQUEST_ID);
  assert.ok(clearPayload.ok);
  const pendingClear = productPopupPendingClear(clearPayload.payload);
  const clear = productPopupClearResponse(fixtures.clear_success);
  assert.ok(clear);
  assert.equal(productPopupMutationConverged(clear, pendingClear), true);
  assert.equal(productPopupResourceConverged(set, pendingClear), false);

  const conflicting = productPopupConflictResponse(fixtures.conflict);
  assert.ok(conflicting);
  assert.equal(productPopupResourceConverged(conflicting.resource, pendingSet), false);
});

test("every closed refusal has a localized route, exact status, and documented terminal or durable-retry policy", () => {
  const retryable = new Set([
    "product-popup-request-in-progress",
    "product-popup-audit-write-failed",
    "product-popup-stored-invalid",
    "product-popup-read-failed",
    "product-popup-write-failed",
  ]);
  const terminal = new Set([
    "product-popup-contract-version-invalid",
    "product-popup-parameter-invalid",
    "product-popup-uid-invalid",
    "product-popup-user-not-found",
    "product-popup-title-invalid",
    "product-popup-message-invalid",
    "product-popup-repeat-mode-invalid",
    "product-popup-expiry-invalid",
    "product-popup-button-invalid",
    "product-popup-button-url-invalid",
    "product-popup-audit-reason-invalid",
    "product-popup-revision-invalid",
    "product-popup-request-id-invalid",
    "product-popup-already-clear",
    "product-popup-conflict",
    "product-popup-request-id-conflict",
    "product-popup-read-required",
    "product-popup-write-required",
    "admin-revoked",
    "admin-session-invalid",
    "admin-write-required",
  ]);

  assert.equal(terminal.size + retryable.size, Object.keys(PRODUCT_POPUP_ERROR_KEYS).length);
  for (const [error, key] of Object.entries(PRODUCT_POPUP_ERROR_KEYS)) {
    assert.equal(productPopupErrorKey(error), key, error);
    assert.equal(productPopupShouldRetainMutation(error), retryable.has(error), error);
    assert.equal(terminal.has(error) || retryable.has(error), true, error);
    if (error !== "product-popup-conflict" && error !== "product-popup-already-clear") {
      assert.equal(productPopupErrorResponse({
        success: false,
        status_code: PRODUCT_POPUP_ERROR_STATUSES[
          error as keyof typeof PRODUCT_POPUP_ERROR_STATUSES
        ],
        error,
        message: 200,
        status: 200,
        can_send: 0,
      }), error);
    }
  }

  assert.equal(productPopupErrorKey("future-error"), "generic");
  assert.equal(productPopupErrorKey("constructor"), "generic");
  assert.equal(productPopupShouldRetainMutation("future-error"), true);
  assert.equal(productPopupShouldRetainMutation(undefined), true);
  assert.equal(productPopupErrorResponse({
    success: false,
    status_code: 503,
    error: "product-popup-title-invalid",
    message: 200,
    status: 200,
    can_send: 0,
  }), null, "known errors with the wrong status remain uncertain");
  assert.equal(productPopupErrorResponse({
    success: false,
    status_code: 422,
    error: "product-popup-title-invalid",
    message: 200,
    status: 200,
    can_send: 0,
    detail: "not contracted",
  }), null, "extra refusal fields remain uncertain");
  assert.equal(productPopupErrorResponse({
    success: false,
    status_code: 403,
    error: "admin-write-required",
  }), "admin-write-required");
});

test("the released popup bridge remains closed to guests and foreign origins, with exact role gates", async () => {
  const readAction = "admin_get_user_popup";
  const writeActions = ["admin_set_user_popup", "admin_clear_user_popup"];
  assert.equal(isAdminActionAllowed(readAction), true);
  assert.equal(isAdminActionAuthorized(readAction, adminPrincipalFrom({ role: "viewer" })), true);
  for (const action of writeActions) {
    assert.equal(isAdminActionAllowed(action), true);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })), false);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), true);
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
  assert.ok(originGate >= 0 && allowListGate > originGate && sessionGate > allowListGate);
  assert.match(proxy, /if \(!session\)[\s\S]*?bridgeError\("auth-required", 401\)/);
  assert.match(proxy, /if \(!isTrustedAdminRequest\(request\.headers\)\)[\s\S]*?bridgeError\("bad-origin", 403\)/);
  assert.match(proxy, /if \(!isAdminActionAllowed\(action\)\)[\s\S]*?bridgeError\("not-found", 404\)/);
});

test("user-detail activation, same-origin calls, exact preview, durable recovery, and Help remain one explicit cutover", async () => {
  const [page, panel, actions, model, en, hu] = await Promise.all([
    readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ProductPopupPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/productPopup.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);

  assert.match(actions, /admin_get_user_popup/);
  assert.match(actions, /admin_set_user_popup/);
  assert.match(actions, /admin_clear_user_popup/);
  assert.match(panel, /adminCall\("admin_get_user_popup"/);
  assert.match(panel, /"admin_set_user_popup"/);
  assert.match(panel, /"admin_clear_user_popup"/);
  assert.match(panel, /window\.sessionStorage\.setItem/);
  assert.match(panel, /productPopupResourceConverged/);
  assert.match(panel, /productPopupConflictResponse/);
  assert.match(panel, /productPopupErrorResponse/);
  assert.match(panel, /productPopupSetMaterial\(draftFromFields\(draft\)/);
  assert.match(panel, /setMaterialMatches\(preview, result\.payload\)/);
  assert.doesNotMatch(panel, /coreCall|core\.friending\.com|WEBADMIN_API_SECRET/);
  assert.match(model, /status !== \(expiresAt > evaluatedAt \? "active" : "expired"\)/);
  assert.doesNotMatch(model, /Date\.now/);

  const enMessages = JSON.parse(en) as JsonObject;
  const huMessages = JSON.parse(hu) as JsonObject;
  assert.deepEqual(
    Object.keys(object(enMessages.productPopup)).sort(),
    Object.keys(object(huMessages.productPopup)).sort(),
  );
  const enUserHelp = object(object(object(object(enMessages.adminHelp).pages).userDetail).sections);
  const huUserHelp = object(object(object(object(huMessages.adminHelp).pages).userDetail).sections);
  assert.ok(object(enUserHelp.productPopup));
  assert.ok(object(huUserHelp.productPopup));
});

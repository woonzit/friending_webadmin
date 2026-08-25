import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminActionBodyLimit,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import { CANNED_TEMPLATES_CONTRACT_READY } from "../lib/contractReadiness.ts";
import {
  CANNED_TEMPLATE_ACTIONS,
  CANNED_TEMPLATE_CAPABILITIES,
  CANNED_TEMPLATE_CHANNELS,
  CANNED_TEMPLATE_ERROR_KEYS,
  CANNED_TEMPLATE_ERROR_STATUSES,
  CANNED_TEMPLATE_PENDING_STORAGE_KEY,
  cannedTemplate,
  cannedTemplateCanWrite,
  cannedTemplateConflictMatches,
  cannedTemplateConflictResponse,
  cannedTemplateDeleteConverged,
  cannedTemplateDeletePayload,
  cannedTemplateDeleteResponse,
  cannedTemplateDraftMaterial,
  cannedTemplateEmailPreviewDocument,
  cannedTemplateErrorKey,
  cannedTemplateErrorResponse,
  cannedTemplateListPayload,
  cannedTemplateListResponse,
  cannedTemplatePendingDelete,
  cannedTemplatePendingMutation,
  cannedTemplatePendingSave,
  cannedTemplateSaveConverged,
  cannedTemplateSavePayload,
  cannedTemplateSaveResponse,
  cannedTemplateShouldRetainMutation,
  isCanonicalCannedEmailHtml,
  mergeCannedTemplatePages,
  normalizeCannedTemplateProxyBody,
  normalizeCannedTemplateQuery,
  type CannedTemplate,
  type CannedTemplateListData,
} from "../lib/cannedTemplates.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

type JsonObject = Record<string, unknown>;

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/canned_templates_contract_v1.json", import.meta.url), "utf8"),
) as Record<string, JsonObject>;

const UUID = "123e4567-e89b-42d3-a456-426614174000";

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

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function expected(channel: "email" | "sms" | "push", query = "") {
  const payload = cannedTemplateListPayload(channel, query);
  assert.ok(payload);
  return payload;
}

function emailList(): CannedTemplateListData {
  const parsed = cannedTemplateListResponse(fixtures.list_email, expected("email"));
  assert.ok(parsed);
  return parsed;
}

test("the accepted list fixtures decode exact principals, channels, ordering, and proven empty state", () => {
  const list = emailList();
  assert.equal(list.templates.length, 2);
  assert.equal(list.total, 2);
  assert.deepEqual(list.principal.capabilities, CANNED_TEMPLATE_CAPABILITIES);
  assert.equal(cannedTemplateCanWrite(list.principal), true);
  assert.deepEqual(list.templates.map((row) => row.template_id), [
    "000000000000000000000001",
    "000000000000000000000002",
  ]);

  const empty = cannedTemplateListResponse(
    fixtures.list_sms_viewer_empty,
    expected("sms", "nothing"),
  );
  assert.ok(empty);
  assert.equal(empty.templates.length, 0);
  assert.equal(empty.total, 0);
  assert.equal(cannedTemplateCanWrite(empty.principal), false);
  assert.equal(cannedTemplateCanWrite({
    role: "viewer",
    capabilities: ["canned_templates_read", "canned_templates_write"],
  }), true, "the Core-authored capability is authoritative; browser role inference is forbidden");
});

test("canonical email output has a closed HTML vocabulary and a no-network sandbox document", () => {
  const body = emailList().templates[0].body;
  assert.equal(isCanonicalCannedEmailHtml(body), true);
  assert.equal(
    isCanonicalCannedEmailHtml('<p><a href="mailto:support@friending.com">Support</a></p>'),
    true,
  );
  assert.equal(
    isCanonicalCannedEmailHtml('<p><a href="https://friending.com/?a=1&amp;b=2">Help</a></p>'),
    true,
  );
  for (const hostile of [
    '<script>alert(1)</script>',
    '<p onclick="alert(1)">Text</p>',
    '<p><img src="https://tracking.example.test/pixel"></p>',
    '<p><a href="javascript:alert(1)">Bad</a></p>',
    '<p><a href="https://user:pass@example.test">Bad</a></p>',
    '<p><a href="https://x"onclick="alert(1)">Bad</a></p>',
    '<p><!-- hidden -->Text</p>',
    '<p><strong>unclosed</p>',
    '<P>uppercase serializer drift</P>',
  ]) assert.equal(isCanonicalCannedEmailHtml(hostile), false, hostile);

  const document = cannedTemplateEmailPreviewDocument(body);
  assert.ok(document);
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /form-action 'none'/);
  assert.match(document, /class="canonical-link"/);
  assert.doesNotMatch(document, /href=/, "canonical links are visually retained but inert and network-free");
  assert.equal(cannedTemplateEmailPreviewDocument("<script>x</script>"), null);

  const spacedClose = '<p><a href="https://friending.com/help">Help</a ></p>';
  assert.equal(isCanonicalCannedEmailHtml(spacedClose), true);
  const spacedDocument = cannedTemplateEmailPreviewDocument(spacedClose);
  assert.ok(spacedDocument);
  assert.match(spacedDocument, /<span class="canonical-link">Help<\/span>/);
  assert.doesNotMatch(spacedDocument, /<\/?a\b/);
});

test("template rows fail closed on unknown, missing, loose, unsafe, or channel-incompatible material", () => {
  const template = clone(emailList().templates[0]) as unknown as JsonObject;
  const mutations: Array<(row: JsonObject) => void> = [
    (row) => { row.provider_key = "private"; },
    (row) => { delete row.revision; },
    (row) => { row.template_id = "ABC"; },
    (row) => { row.revision = "2"; },
    (row) => { row.name = " trailing "; },
    (row) => { row.format = "plain_text"; },
    (row) => { row.subject = ""; },
    (row) => { row.body = "<iframe></iframe>"; },
    (row) => { row.created_by = "Owner@Example.test"; },
    (row) => { row.updated_at = 99; },
  ];
  for (const mutate of mutations) {
    const row = clone(template);
    mutate(row);
    assert.equal(cannedTemplate(row), null, mutate.toString());
  }

  const sms = {
    ...template,
    template_id: "000000000000000000000010",
    channel: "sms",
    format: "plain_text",
    subject: "",
    body: "A bounded SMS template",
  };
  assert.ok(cannedTemplate(sms));
  assert.equal(cannedTemplate({ ...sms, subject: "No subject allowed" }), null);
  const push = { ...sms, channel: "push", subject: "Push title" };
  assert.ok(cannedTemplate(push));
  assert.equal(cannedTemplate({ ...push, subject: "x".repeat(81) }), null);
});

test("list parsing binds the response to the exact request and rejects false partial state", () => {
  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { raw.trace = "extra"; },
    (raw) => { data(raw).channel = "push"; },
    (raw) => { data(raw).query = "different"; },
    (raw) => { data(raw).total = 1; },
    (raw) => { data(raw).next_cursor = "bad cursor"; },
    (raw) => { object(data(raw).principal).capabilities = ["canned_templates_write", "canned_templates_read"]; },
    (raw) => { object(data(raw).principal).provider = "private"; },
    (raw) => { const rows = data(raw).templates as unknown[]; rows.reverse(); },
    (raw) => { const rows = data(raw).templates as unknown[]; rows.push(clone(rows[0])); data(raw).total = 3; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.list_email);
    mutate(raw);
    assert.equal(cannedTemplateListResponse(raw, expected("email")), null, mutate.toString());
  }
  assert.equal(cannedTemplateListResponse(fixtures.list_email, expected("email", "welcome")), null);

  const falseEmpty = clone(fixtures.list_sms_viewer_empty);
  data(falseEmpty).total = 1;
  assert.equal(cannedTemplateListResponse(falseEmpty, expected("sms", "nothing")), null);
});

test("list requests normalize bounded search and page material, while page merge preserves global order", () => {
  assert.deepEqual(cannedTemplateListPayload("push", "  Café  ", "", 100), {
    contract_version: 1,
    type: "push",
    query: "Café",
    page_size: 100,
    cursor: "",
  });
  assert.equal(normalizeCannedTemplateQuery("x".repeat(81)), null);
  assert.equal(normalizeCannedTemplateQuery("line\nbreak"), null);
  assert.equal(cannedTemplateListPayload("future", ""), null);
  assert.equal(cannedTemplateListPayload("email", "", "bad cursor"), null);
  assert.deepEqual(cannedTemplateListPayload("email", "", "page_two=="), {
    contract_version: 1,
    type: "email",
    query: "",
    page_size: 50,
    cursor: "page_two==",
  });

  const first = { ...emailList(), total: 3, next_cursor: "page_two" };
  const next: CannedTemplateListData = {
    ...first,
    templates: [{ ...first.templates[1], template_id: "000000000000000000000003", updated_at: 50 }],
    next_cursor: null,
  };
  const merged = mergeCannedTemplatePages(first, next);
  assert.ok(merged);
  assert.equal(merged.templates.length, 3);
  assert.equal(mergeCannedTemplatePages(first, { ...next, total: 99 }), null);
  assert.equal(mergeCannedTemplatePages(first, { ...next, templates: [first.templates[0]] }), null);
  assert.equal(mergeCannedTemplatePages({ ...first, next_cursor: null }, next), null);

  const truncatedFirstPage = clone(fixtures.list_email);
  data(truncatedFirstPage).total = 3;
  assert.equal(
    cannedTemplateListResponse(truncatedFirstPage, expected("email")),
    null,
    "a first page cannot omit both a row and its continuation cursor",
  );

  const repeatedCursor = clone(fixtures.list_email);
  data(repeatedCursor).next_cursor = "page_two";
  data(repeatedCursor).total = 3;
  const repeatedCursorRequest = cannedTemplateListPayload("email", "", "page_two");
  assert.ok(repeatedCursorRequest);
  assert.equal(
    cannedTemplateListResponse(repeatedCursor, repeatedCursorRequest),
    null,
    "a response cannot repeat the cursor used to request it",
  );

  const paddedNext = clone(fixtures.list_email);
  data(paddedNext).next_cursor = "page_two==";
  data(paddedNext).total = 3;
  assert.equal(
    cannedTemplateListResponse(paddedNext, expected("email"))?.next_cursor,
    "page_two==",
  );
});

test("draft validation applies exact channel bounds without silent truncation", () => {
  const email = cannedTemplateDraftMaterial("email", {
    name: "  Welcome  ",
    subject: "  Hello  ",
    body: "  <p>Raw source for Core sanitization</p>  ",
    auditReason: "  New onboarding copy  ",
  });
  assert.deepEqual(email, {
    ok: true,
    value: {
      name: "Welcome",
      subject: "Hello",
      body: "<p>Raw source for Core sanitization</p>",
      audit_reason: "New onboarding copy",
    },
  });
  assert.equal(cannedTemplateDraftMaterial("sms", {
    name: "SMS", subject: "forbidden", body: "Hello", auditReason: "Reviewed",
  }).ok, false);
  assert.equal(cannedTemplateDraftMaterial("push", {
    name: "Push", subject: "x".repeat(81), body: "Hello", auditReason: "Reviewed",
  }).ok, false);
  assert.equal(cannedTemplateDraftMaterial("sms", {
    name: "SMS", subject: "", body: "x".repeat(1_601), auditReason: "Reviewed",
  }).ok, false);
  assert.equal(cannedTemplateDraftMaterial("push", {
    name: "Push", subject: "Title", body: "bad\u0001body", auditReason: "Reviewed",
  }).ok, false);
  assert.equal(cannedTemplateDraftMaterial("push", {
    name: "Push", subject: "Title", body: "C1\u0085text", auditReason: "Reviewed",
  }).ok, true, "the contract forbids disallowed C0 controls, not safe C1 text");
});

test("save and delete builders bind one canonical UUID to exact revisioned material", () => {
  const current = emailList().templates[0];
  const update = cannedTemplateSavePayload("email", current, {
    name: current.name,
    subject: current.subject,
    body: "<p>Updated source</p>",
    auditReason: "Requested copy correction",
  }, UUID.toUpperCase());
  assert.ok(update.ok);
  assert.equal(update.value.id, current.template_id);
  assert.equal(update.value.expected_revision, 2);
  assert.equal(update.value.request_id, UUID);

  const create = cannedTemplateSavePayload("push", null, {
    name: "Profile reminder",
    subject: "Complete your profile",
    body: "Add a little more about yourself.",
    auditReason: "Approved lifecycle reminder",
  }, UUID);
  assert.ok(create.ok);
  assert.equal(create.value.id, "");
  assert.equal(create.value.expected_revision, 0);

  const deletion = cannedTemplateDeletePayload(current, "  Duplicate template  ", UUID);
  assert.ok(deletion.ok);
  assert.deepEqual(deletion.value, {
    contract_version: 1,
    id: current.template_id,
    expected_revision: 2,
    request_id: UUID,
    audit_reason: "Duplicate template",
  });
  assert.equal(cannedTemplateSavePayload("sms", current, {
    name: "x", subject: "", body: "x", auditReason: "x",
  }, UUID).ok, false);
});

test("the maximal four-byte email draft fits through the conservative proxy body ceiling", () => {
  const maximal = cannedTemplateSavePayload("email", null, {
    name: "Maximum email",
    subject: "Bounded subject",
    body: "😀".repeat(50_000),
    auditReason: "Contract-bound body-size proof",
  }, UUID);
  assert.ok(maximal.ok);
  assert.ok(
    Buffer.byteLength(JSON.stringify(maximal.value), "utf8") <= adminActionBodyLimit("save_canned"),
  );
});

test("the action-specific proxy forwards only complete canonical contract material", () => {
  assert.equal(normalizeCannedTemplateProxyBody("overview", {}), undefined);
  const list = expected("email");
  assert.deepEqual({ ...normalizeCannedTemplateProxyBody("list_canned", list) }, list);

  const save = cannedTemplateSavePayload("push", null, {
    name: "Profile reminder", subject: "Complete your profile",
    body: "Add a little more about yourself.", auditReason: "Approved reminder",
  }, UUID);
  assert.ok(save.ok);
  assert.deepEqual({ ...normalizeCannedTemplateProxyBody("save_canned", save.value) }, save.value);

  const deletion = cannedTemplateDeletePayload(emailList().templates[0], "Duplicate", UUID);
  assert.ok(deletion.ok);
  assert.deepEqual({ ...normalizeCannedTemplateProxyBody("delete_canned", deletion.value) }, deletion.value);

  for (const [action, value] of [
    ["list_canned", { ...list, secret: "attacker" }],
    ["list_canned", { ...list, contract_version: "1" }],
    ["save_canned", { ...save.value, admin_email: "attacker@example.test" }],
    ["save_canned", { ...save.value, subject: " trailing " }],
    ["delete_canned", { ...deletion.value, expected_revision: 0 }],
  ] as const) assert.equal(normalizeCannedTemplateProxyBody(action, value), null);
});

test("pending mutation storage is exact, durable, channel-bound, and rejects tampering", () => {
  assert.equal(CANNED_TEMPLATE_PENDING_STORAGE_KEY, "friending.canned-templates.pending-mutation.v1");
  const save = cannedTemplateSavePayload("push", null, {
    name: "Profile reminder", subject: "Complete your profile",
    body: "Add a little more about yourself.", auditReason: "Approved reminder",
  }, UUID);
  assert.ok(save.ok);
  const pendingSave = cannedTemplatePendingSave(save.value);
  assert.deepEqual(cannedTemplatePendingMutation(JSON.parse(JSON.stringify(pendingSave))), pendingSave);

  const deletion = cannedTemplateDeletePayload(emailList().templates[0], "Duplicate", UUID);
  assert.ok(deletion.ok);
  const pendingDelete = cannedTemplatePendingDelete("email", deletion.value);
  assert.deepEqual(cannedTemplatePendingMutation(JSON.parse(JSON.stringify(pendingDelete))), pendingDelete);
  assert.equal(cannedTemplatePendingMutation({ ...pendingDelete, channel: "future" }), null);
  assert.equal(cannedTemplatePendingMutation({ ...pendingSave, provider_receipt: "private" }), null);
  assert.equal(cannedTemplatePendingMutation({ ...pendingSave, payload: { ...pendingSave.payload, request_id: "bad" } }), null);
});

test("mutation responses converge only on the exact pending identity and canonical result", () => {
  const current = emailList().templates[0];
  const update = cannedTemplateSavePayload("email", current, {
    name: "Welcome email",
    subject: "Welcome to Friending",
    body: "<script>raw source is never previewed</script>",
    auditReason: "Approved canonical correction",
  }, UUID);
  assert.ok(update.ok);
  const pendingUpdate = cannedTemplatePendingSave(update.value);
  const saveResult = cannedTemplateSaveResponse(fixtures.save_email);
  assert.ok(saveResult);
  assert.equal(cannedTemplateSaveConverged(saveResult, pendingUpdate), true);
  assert.equal(cannedTemplateSaveConverged(
    { ...saveResult, template: { ...saveResult.template, revision: 4 } },
    pendingUpdate,
  ), false);

  const create = cannedTemplateSavePayload("push", null, {
    name: "Profile reminder", subject: "Complete your profile",
    body: "Add a little more about yourself.", auditReason: "Approved lifecycle reminder",
  }, UUID);
  assert.ok(create.ok);
  const createResult = cannedTemplateSaveResponse(fixtures.save_push_create);
  assert.ok(createResult);
  assert.equal(cannedTemplateSaveConverged(createResult, cannedTemplatePendingSave(create.value)), true);

  const deletion = cannedTemplateDeletePayload(current, "Duplicate", UUID);
  assert.ok(deletion.ok);
  const deleteResult = cannedTemplateDeleteResponse(fixtures.delete_email);
  assert.ok(deleteResult);
  assert.equal(cannedTemplateDeleteConverged(
    deleteResult,
    cannedTemplatePendingDelete("email", deletion.value),
  ), true);
});

test("conflicts adopt one exact authoritative row or tombstone and never merge drafts", () => {
  const current = emailList();
  const templateConflict = cannedTemplateConflictResponse(fixtures.conflict_template);
  assert.ok(templateConflict?.template);
  const update = cannedTemplateSavePayload("email", current.templates[0], {
    name: "Welcome email",
    subject: "Welcome to Friending",
    body: "<p>Updated source</p>",
    auditReason: "Approved canonical correction",
  }, UUID);
  assert.ok(update.ok);
  const pendingUpdate = cannedTemplatePendingSave(update.value);
  assert.equal(cannedTemplateConflictMatches(templateConflict, pendingUpdate), true);
  assert.equal(cannedTemplateConflictMatches({
    ...templateConflict,
    template: { ...templateConflict.template, channel: "push", format: "plain_text" },
  }, pendingUpdate), false);
  const deletedConflict = cannedTemplateConflictResponse(fixtures.conflict_deleted);
  assert.ok(deletedConflict?.deleted);
  const pendingDelete = cannedTemplateDeletePayload(current.templates[0], "Duplicate", UUID);
  assert.ok(pendingDelete.ok);
  assert.equal(cannedTemplateConflictMatches(
    deletedConflict,
    cannedTemplatePendingDelete("email", pendingDelete.value),
  ), true);

  const malformed = clone(fixtures.conflict_template);
  data(malformed).deleted = clone(data(fixtures.conflict_deleted).deleted);
  assert.equal(cannedTemplateConflictResponse(malformed), null);
});

test("every closed refusal has an exact status, localized key, and durable retry policy", () => {
  assert.equal(Object.keys(CANNED_TEMPLATE_ERROR_KEYS).length, 26);
  for (const [error, key] of Object.entries(CANNED_TEMPLATE_ERROR_KEYS)) {
    const response = {
      success: false,
      status_code: CANNED_TEMPLATE_ERROR_STATUSES[error as keyof typeof CANNED_TEMPLATE_ERROR_STATUSES],
      error,
      message: 200,
      status: 200,
      can_send: 0,
    };
    assert.equal(cannedTemplateErrorResponse(response), error);
    assert.equal(cannedTemplateErrorKey(error), key);
  }
  assert.equal(cannedTemplateErrorKey("future-provider-error"), "generic");
  assert.equal(cannedTemplateErrorResponse({
    success: false,
    status_code: 500,
    error: "canned-template-name-invalid",
    message: 200,
    status: 200,
    can_send: 0,
  }), null);
  assert.equal(cannedTemplateErrorResponse({
    success: false,
    status_code: 403,
    error: "admin-write-required",
  }), "admin-write-required");
  assert.equal(cannedTemplateShouldRetainMutation(null), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-request-in-progress"), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-audit-write-failed"), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-stored-invalid"), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-read-failed"), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-write-failed"), true);
  assert.equal(cannedTemplateShouldRetainMutation("canned-template-name-invalid"), false);
  assert.equal(cannedTemplateShouldRetainMutation("future-provider-error"), true);
});

test("the contract surface is CRUD-only and has no outbound send/history action", () => {
  assert.deepEqual(CANNED_TEMPLATE_ACTIONS, ["list_canned", "save_canned", "delete_canned"]);
  assert.deepEqual(CANNED_TEMPLATE_CHANNELS, ["email", "sms", "push"]);
  assert.equal(CANNED_TEMPLATE_ACTIONS.some((action) => /send|history/u.test(action)), false);
});

test("the dormant bridge is unreachable for guests, foreign origins, viewers, and owners", async () => {
  assert.equal(CANNED_TEMPLATES_CONTRACT_READY, false);
  for (const action of CANNED_TEMPLATE_ACTIONS) {
    assert.equal(isAdminActionAllowed(action), false);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })), false);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), false);
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
  const bodyGate = proxy.indexOf("normalizeCannedTemplateProxyBody(action, body)");
  const identityMerge = proxy.indexOf("mergeCoreParams(body, { admin_email: session.email })");
  assert.ok(originGate >= 0 && allowListGate > originGate && sessionGate > allowListGate);
  assert.ok(bodyGate > sessionGate && identityMerge > bodyGate);
  assert.match(proxy, /if \(!session\)[\s\S]*?bridgeError\("auth-required", 401\)/);
  assert.match(proxy, /if \(!isTrustedAdminRequest\(request\.headers\)\)[\s\S]*?bridgeError\("bad-origin", 403\)/);
  assert.match(proxy, /if \(!isAdminActionAllowed\(action\)\)[\s\S]*?bridgeError\("not-found", 404\)/);
});

test("page, navigation, proxy, durable recovery, confirmation, safe preview, and Help share one cutover", async () => {
  const [page, shell, actions, route, component, model, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/canned-templates/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/CannedTemplatesConsole.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cannedTemplates.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /if \(!CANNED_TEMPLATES_CONTRACT_READY\) notFound\(\)/);
  assert.match(shell, /ready: CANNED_TEMPLATES_CONTRACT_READY/);
  assert.match(shell, /NAV\.filter\(\(item\) => item\.ready !== false\)/);
  for (const action of CANNED_TEMPLATE_ACTIONS) {
    assert.doesNotMatch(actions, new RegExp(`"${action}"`));
    assert.match(`${component}\n${model}`, new RegExp(`"${action}"`));
  }
  assert.match(route, /normalizeCannedTemplateProxyBody\(action, body\)/);
  assert.match(component, /window\.sessionStorage\.setItem/);
  assert.match(component, /window\.sessionStorage\.getItem/);
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /<ConfirmDialog/);
  assert.match(component, /cannedTemplateConflictResponse/);
  assert.match(component, /cannedTemplateConflictMatches/);
  assert.doesNotMatch(component, /replaceCannedTemplate|removeCannedTemplate/);
  assert.match(component, /cannedTemplateSaveConverged/);
  assert.match(component, /cannedTemplateDeleteConverged/);
  assert.match(component, /sandbox=""/);
  assert.match(component, /<pre>\{draft\.body\}<\/pre>/);
  assert.match(model, /Content-Security-Policy/);
  assert.match(model, /default-src 'none'/);
  assert.doesNotMatch(`${component}\n${model}`, /send_message|user_history/);
  assert.doesNotMatch(component, /coreCall|core\.friending\.com|WEBADMIN_API_SECRET|console\./);

  const en = JSON.parse(enRaw) as JsonObject;
  const hu = JSON.parse(huRaw) as JsonObject;
  const enCanned = object(en.cannedTemplates);
  const huCanned = object(hu.cannedTemplates);
  assert.deepEqual(Object.keys(enCanned).sort(), Object.keys(huCanned).sort());
  const expectedErrorKeys = new Set([
    ...Object.values(CANNED_TEMPLATE_ERROR_KEYS),
    "generic",
    "persistenceUnavailable",
    "persistenceCleanupFailed",
  ]);
  const enErrors = object(enCanned.errors);
  const huErrors = object(huCanned.errors);
  assert.deepEqual(Object.keys(enErrors).sort(), [...expectedErrorKeys].sort());
  assert.deepEqual(Object.keys(huErrors).sort(), [...expectedErrorKeys].sort());
  for (const key of expectedErrorKeys) {
    assert.equal(typeof enErrors[key], "string", key);
    assert.equal(typeof huErrors[key], "string", key);
  }

  const enHelp = object(object(object(en.adminHelp).pages).cannedTemplates);
  const huHelp = object(object(object(hu.adminHelp).pages).cannedTemplates);
  assert.deepEqual(Object.keys(enHelp).sort(), Object.keys(huHelp).sort());
  assert.deepEqual(
    Object.keys(object(enHelp.sections)).sort(),
    ["canonicalPreview", "channels", "deleteBoundary", "editor", "listSearch", "revisionReceipts"],
  );
  assert.deepEqual(Object.keys(object(enHelp.sections)).sort(), Object.keys(object(huHelp.sections)).sort());
});

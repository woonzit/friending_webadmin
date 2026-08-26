import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  PROFILE_TEXT_MODERATION_ACTIONS,
  PROFILE_TEXT_MODERATION_CAPABILITIES,
  PROFILE_TEXT_MODERATION_DECISIONS,
  PROFILE_TEXT_MODERATION_ERROR_STATUSES,
  PROFILE_TEXT_MODERATION_FIELDS,
  PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY,
  PROFILE_TEXT_MODERATION_STATUSES,
  normalizeProfileTextModerationProxyBody,
  profileTextContentSha256,
  profileTextModerationAdminMe,
  profileTextModerationConflict,
  profileTextModerationConflictMatchesPending,
  profileTextModerationError,
  profileTextModerationErrorKey,
  profileTextModerationFilterField,
  profileTextModerationListResponse,
  profileTextModerationMutationConverged,
  profileTextModerationMutationResponse,
  profileTextModerationPendingFrom,
  profileTextModerationPendingMutation,
  profileTextModerationPersistBeforeMutation,
  profileTextModerationProxyCapabilityAuthorized,
  profileTextModerationReasonIsValid,
  profileTextModerationShouldRetainMutation,
  type ProfileTextModerationField,
  type ProfileTextModerationRole,
} from "../lib/profileTextModeration.ts";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import { PROFILE_TEXT_MODERATION_CONTRACT_READY } from "../lib/contractReadiness.ts";

type Json = Record<string, any>;

const UUID = "12345678-1234-4234-8234-123456789abc";
const BRIDGE_ERRORS = new Set([
  "auth-required",
  "bad-origin",
  "not-found",
  "admin-write-required",
  "invalid-input",
  "too-large",
  "core-unavailable",
  "core-timeout",
  "invalid-core-response",
]);

function success(data: unknown): Json {
  return { success: true, status_code: 200, data, message: 200, status: 200, can_send: 0 };
}

function refusal(error: string, statusCode: number, data?: unknown): Json {
  return data === undefined
    ? { success: false, status_code: statusCode, error, message: 200, status: 200, can_send: 0 }
    : { success: false, status_code: statusCode, error, data, message: 200, status: 200, can_send: 0 };
}

function block(role: ProfileTextModerationRole, ready = true): Json {
  const capabilities = role === "viewer"
    ? PROFILE_TEXT_MODERATION_CAPABILITIES.slice(0, 1)
    : [...PROFILE_TEXT_MODERATION_CAPABILITIES];
  const actions = ready
    ? role === "viewer" ? PROFILE_TEXT_MODERATION_ACTIONS.slice(0, 1) : [...PROFILE_TEXT_MODERATION_ACTIONS]
    : [];
  return {
    contract_version: 1,
    contract_ready: ready,
    principal: { role, capabilities },
    actions,
  };
}

function nodeHash(uid: number, field: ProfileTextModerationField, text: string): string {
  return createHash("sha256")
    .update(`friending-profile-text-v1\0${uid}\0${field}\0${text}`, "utf8")
    .digest("hex");
}

function item(overrides: Json = {}): Json {
  const uid = overrides.uid ?? 41;
  const field = overrides.field ?? "headline";
  const text = overrides.text ?? "Hello 👋";
  return {
    uid,
    field,
    text,
    text_length: overrides.text_length ?? [...text].length,
    content_sha256: overrides.content_sha256 ?? nodeHash(uid, field, text),
    status: overrides.status ?? "pending",
    revision: overrides.revision ?? 3,
    status_updated_at: overrides.status_updated_at ?? 100,
    member: overrides.member ?? { display_name: "Ada", username: "ada_41" },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => ![
      "uid", "field", "text", "text_length", "content_sha256", "status",
      "revision", "status_updated_at", "member",
    ].includes(key))),
  };
}

function listData(items: Json[], overrides: Json = {}): Json {
  return {
    contract_version: 1,
    principal: overrides.principal ?? block("admin").principal,
    actions: overrides.actions ?? [...PROFILE_TEXT_MODERATION_ACTIONS],
    filter: overrides.filter ?? { field: "all", uid: null },
    items,
    next_cursor: overrides.next_cursor ?? null,
    total: overrides.total ?? items.length,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => ![
      "principal", "actions", "filter", "next_cursor", "total",
    ].includes(key))),
  };
}

test("the dormant v1 vocabulary and conditional proxy surface are exact", () => {
  assert.equal(PROFILE_TEXT_MODERATION_CONTRACT_READY, false);
  assert.deepEqual(PROFILE_TEXT_MODERATION_FIELDS, ["headline", "about_me"]);
  assert.deepEqual(PROFILE_TEXT_MODERATION_STATUSES, ["pending", "accepted", "denied"]);
  assert.deepEqual(PROFILE_TEXT_MODERATION_DECISIONS, ["accepted", "denied"]);
  assert.deepEqual(PROFILE_TEXT_MODERATION_CAPABILITIES, [
    "profile_text_moderation_read",
    "profile_text_moderation_decide",
  ]);
  assert.deepEqual(PROFILE_TEXT_MODERATION_ACTIONS, [
    "moderation_profile_text_list",
    "moderation_profile_text_action",
  ]);
  assert.deepEqual(
    ADMIN_ACTIONS.filter((action) => PROFILE_TEXT_MODERATION_ACTIONS.includes(action as any)),
    [],
  );
  for (const action of PROFILE_TEXT_MODERATION_ACTIONS) assert.equal(adminActionAccess(action), null);
});

test("admin_me is exact, role-derived, action-ordered, and readiness-gated", () => {
  for (const role of ["viewer", "admin", "owner"] as const) {
    assert.deepEqual(profileTextModerationAdminMe(block(role)), block(role));
    assert.deepEqual(profileTextModerationAdminMe(block(role, false)), block(role, false));
  }
  assert.equal(profileTextModerationAdminMe({ ...block("admin"), extra: true }), null);
  assert.equal(profileTextModerationAdminMe({
    ...block("admin"),
    actions: [...PROFILE_TEXT_MODERATION_ACTIONS].reverse(),
  }), null);
  assert.equal(profileTextModerationAdminMe({
    ...block("viewer"),
    principal: { role: "viewer", capabilities: [...PROFILE_TEXT_MODERATION_CAPABILITIES] },
  }), null);
  assert.equal(profileTextModerationAdminMe({ ...block("owner", false), actions: [PROFILE_TEXT_MODERATION_ACTIONS[0]] }), null);
});

test("the bridge trusts only the exact profile-text capability block and keeps other floors", () => {
  const globalViewer = adminPrincipalFrom({ role: "viewer" });
  const adminMembership = { success: true, role: "viewer", profile_text_moderation: block("admin") };
  for (const action of PROFILE_TEXT_MODERATION_ACTIONS) {
    const capability = profileTextModerationProxyCapabilityAuthorized(action, adminMembership);
    assert.equal(capability, true);
    assert.equal(isAdminBridgeActionAuthorized(action, globalViewer, null, capability), true);
  }

  const viewerMembership = { success: true, role: "viewer", profile_text_moderation: block("viewer") };
  assert.equal(profileTextModerationProxyCapabilityAuthorized(PROFILE_TEXT_MODERATION_ACTIONS[0], viewerMembership), true);
  assert.equal(profileTextModerationProxyCapabilityAuthorized(PROFILE_TEXT_MODERATION_ACTIONS[1], viewerMembership), false);
  assert.equal(isAdminBridgeActionAuthorized(PROFILE_TEXT_MODERATION_ACTIONS[1], globalViewer, null, false), false);
  assert.equal(profileTextModerationProxyCapabilityAuthorized("overview", adminMembership), null);

  for (const membership of [
    { success: true, role: "owner" },
    { success: true, role: "owner", profile_text_moderation: { ...block("owner"), extra: true } },
    { success: true, role: "owner", profile_text_moderation: block("owner", false) },
  ]) {
    const capability = profileTextModerationProxyCapabilityAuthorized(PROFILE_TEXT_MODERATION_ACTIONS[1], membership);
    assert.equal(capability, false);
    assert.equal(isAdminBridgeActionAuthorized(PROFILE_TEXT_MODERATION_ACTIONS[1], globalViewer, null, capability), false);
  }
  assert.equal(isAdminBridgeActionAuthorized("save_hero", globalViewer, null, true), false);
});

test("the content witness uses the exact domain-separated UTF-8 bytes and Unicode scalar length", async () => {
  const text = "Árvíz 👩‍💻";
  assert.equal(await profileTextContentSha256(77, "about_me", text), nodeHash(77, "about_me", text));
  assert.equal([...text].length, 9);
  assert.notEqual(nodeHash(77, "headline", text), nodeHash(77, "about_me", text));
  assert.notEqual(nodeHash(77, "about_me", text), nodeHash(78, "about_me", text));
});

test("list decoding proves exact filters, pending rows, ordering, bounds, and non-empty truth", async () => {
  const first = item({ uid: 41, field: "headline", status_updated_at: 100 });
  const second = item({
    uid: 41,
    field: "about_me",
    text: "First line\nSecond line 👋",
    status_updated_at: 100,
  });
  const expectation = { field: "all" as const, uid: null, page_size: 2 };
  const body = success(listData([first, second], { total: 3, next_cursor: "opaque_page-2" }));
  const parsed = await profileTextModerationListResponse(body, expectation);
  assert.ok(parsed);
  assert.equal(parsed.items[1].text_length, [...second.text].length);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.next_cursor, "opaque_page-2");

  const empty = await profileTextModerationListResponse(success(listData([], { total: 0 })), {
    field: "all",
    uid: null,
    page_size: 50,
  });
  assert.deepEqual(empty?.items, []);
  assert.equal(empty?.next_cursor, null);

  assert.equal(await profileTextModerationListResponse({ ...body, trace: "extra" }, expectation), null);
  assert.equal(await profileTextModerationListResponse(success({ ...body.data, extra: true }), expectation), null);
  assert.equal(await profileTextModerationListResponse(body, { ...expectation, field: "headline" }), null);
  assert.equal(await profileTextModerationListResponse(body, { ...expectation, page_size: 1 }), null);
  assert.equal(await profileTextModerationListResponse(success(listData([second, first], { total: 2 })), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([first, first], { total: 2 })), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    { ...first, status: "accepted" },
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    { ...first, text_length: first.text_length + 1 },
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    { ...first, content_sha256: "0".repeat(64) },
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    item({ text: "Two  spaces" }),
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([first], {
    next_cursor: "padded=",
  })), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([first, second], { total: 1 })), expectation), null);
});

test("safe member identity is bounded plain text and rejects control or additive data", async () => {
  const expectation = { field: "all" as const, uid: null, page_size: 50 };
  assert.ok(await profileTextModerationListResponse(success(listData([
    item({ member: { display_name: "Ada 👩‍💻", username: "" } }),
  ])), expectation));
  assert.equal(await profileTextModerationListResponse(success(listData([
    item({ member: { display_name: "Ada", username: "ada", email: "private@example.com" } }),
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    item({ member: { display_name: "Ada\nLovelace", username: "ada" } }),
  ])), expectation), null);
  assert.equal(await profileTextModerationListResponse(success(listData([
    item({ member: { display_name: "A".repeat(101), username: "ada" } }),
  ])), expectation), null);
});

test("internal reasons preserve valid Unicode while refusing noncanonical controls and bounds", () => {
  assert.equal(profileTextModerationReasonIsValid("Reviewed 👩‍💻 unchanged text"), true);
  assert.equal(profileTextModerationReasonIsValid(" line break\n"), false);
  assert.equal(profileTextModerationReasonIsValid("line break\ninside"), false);
  assert.equal(profileTextModerationReasonIsValid(" "), false);
  assert.equal(profileTextModerationReasonIsValid("A".repeat(301)), false);
});

test("mutation and conflict decoders accept only exact complete authoritative fields", async () => {
  const accepted = item({ status: "accepted", revision: 4, status_updated_at: 200 });
  const mutation = await profileTextModerationMutationResponse(success({
    contract_version: 1,
    item: accepted,
    replayed: false,
  }));
  assert.ok(mutation);
  assert.equal(mutation.item.status, "accepted");
  assert.equal(await profileTextModerationMutationResponse(success({
    contract_version: 1,
    item: { ...accepted, status: "pending" },
    replayed: false,
  })), null);
  assert.equal(await profileTextModerationMutationResponse(success({
    contract_version: 1,
    item: accepted,
    replayed: 0,
  })), null);
  assert.equal(await profileTextModerationMutationResponse(success({
    contract_version: 1,
    item: accepted,
    replayed: false,
    extra: true,
  })), null);

  const current = item({ status: "pending", revision: 4, text: "Changed text" });
  assert.deepEqual(await profileTextModerationConflict(refusal("profile-text-moderation-conflict", 409, {
    contract_version: 1,
    current,
  })), { contract_version: 1, current });
  assert.deepEqual(await profileTextModerationConflict(refusal("profile-text-moderation-conflict", 409, {
    contract_version: 1,
    current: null,
  })), { contract_version: 1, current: null });
  assert.equal(await profileTextModerationConflict(refusal("profile-text-moderation-conflict", 409, {
    contract_version: 1,
    current,
    extra: true,
  })), null);
  assert.equal(await profileTextModerationConflict(refusal("profile-text-moderation-conflict", 422, {
    contract_version: 1,
    current,
  })), null);
});

test("proxy bodies normalize one exact command and refuse loose or caller-owned material", () => {
  const list = normalizeProfileTextModerationProxyBody("moderation_profile_text_list", {
    contract_version: 1,
  });
  assert.deepEqual({ ...list }, { contract_version: 1, field: "all", page_size: 50 });
  assert.deepEqual({ ...normalizeProfileTextModerationProxyBody("moderation_profile_text_list", {
    contract_version: 1,
    field: "headline",
    uid: 41,
    page_size: 100,
    cursor: "opaque_page-2",
  }) }, {
    contract_version: 1,
    field: "headline",
    uid: 41,
    page_size: 100,
    cursor: "opaque_page-2",
  });
  for (const bad of [
    { contract_version: "1" },
    { contract_version: 1, uid: "41" },
    { contract_version: 1, field: "future" },
    { contract_version: 1, cursor: "padded=" },
    { contract_version: 1, admin_email: "caller@example.com" },
    { contract_version: 1, secret: "caller" },
  ]) assert.equal(normalizeProfileTextModerationProxyBody("moderation_profile_text_list", bad), null);

  const action = {
    contract_version: 1,
    uid: 41,
    field: "headline",
    decision: "accepted",
    expected_revision: 3,
    content_sha256: nodeHash(41, "headline", "Hello 👋"),
    reason: "Reviewed unchanged text",
    request_id: UUID,
  };
  assert.deepEqual({ ...normalizeProfileTextModerationProxyBody("moderation_profile_text_action", action) }, action);
  for (const mutate of [
    (body: Json) => ({ ...body, extra: true }),
    (body: Json) => ({ ...body, uid: "41" }),
    (body: Json) => ({ ...body, field: "display_name" }),
    (body: Json) => ({ ...body, decision: "approve" }),
    (body: Json) => ({ ...body, expected_revision: 0 }),
    (body: Json) => ({ ...body, content_sha256: body.content_sha256.toUpperCase() }),
    (body: Json) => ({ ...body, reason: " trailing " }),
    (body: Json) => ({ ...body, request_id: UUID.toUpperCase() }),
  ]) assert.equal(normalizeProfileTextModerationProxyBody("moderation_profile_text_action", mutate(action)), null);
  assert.equal(normalizeProfileTextModerationProxyBody("overview", {}), undefined);
});

test("pending identity is target-bound, text-free, and persisted before the first request", async () => {
  const payload = {
    contract_version: 1,
    uid: 41,
    field: "headline",
    decision: "denied",
    expected_revision: 3,
    content_sha256: nodeHash(41, "headline", "Hello 👋"),
    reason: "Does not meet the profile standard",
    request_id: UUID,
  };
  const pending = profileTextModerationPendingMutation("41:headline", payload);
  assert.ok(pending);
  assert.deepEqual(profileTextModerationPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(JSON.stringify(pending).includes("Hello 👋"), false);
  assert.equal(Object.hasOwn(pending.payload, "text"), false);
  assert.equal(profileTextModerationPendingMutation("41:about_me", payload), null);
  assert.equal(profileTextModerationPendingFrom({ ...pending, extra: true }), null);

  const events: string[] = [];
  const result = await profileTextModerationPersistBeforeMutation({
    setItem(key, value) {
      assert.equal(key, PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY);
      assert.deepEqual(profileTextModerationPendingFrom(JSON.parse(value)), pending);
      events.push("persist");
    },
  }, pending, async () => {
    events.push("mutate");
    return "response";
  });
  assert.deepEqual(events, ["persist", "mutate"]);
  assert.deepEqual(result, { ok: true, response: "response" });

  let called = false;
  const refused = await profileTextModerationPersistBeforeMutation({
    setItem() { throw new Error("private mode"); },
  }, pending, async () => {
    called = true;
    return "never";
  });
  assert.deepEqual(refused, { ok: false });
  assert.equal(called, false);
});

test("success convergence and conflicts are bound to the exact saved target and material", async () => {
  const hash = nodeHash(41, "headline", "Hello 👋");
  const pending = profileTextModerationPendingMutation("41:headline", {
    contract_version: 1,
    uid: 41,
    field: "headline",
    decision: "accepted",
    expected_revision: 3,
    content_sha256: hash,
    reason: "Reviewed unchanged text",
    request_id: UUID,
  });
  assert.ok(pending);
  const result = await profileTextModerationMutationResponse(success({
    contract_version: 1,
    item: item({ status: "accepted", revision: 4, content_sha256: hash }),
    replayed: true,
  }));
  assert.ok(result);
  assert.equal(profileTextModerationMutationConverged(pending, result), true);
  assert.equal(profileTextModerationMutationConverged(pending, {
    ...result,
    item: { ...result.item, revision: 5 },
  }), false);
  assert.equal(profileTextModerationMutationConverged(pending, {
    ...result,
    item: { ...result.item, content_sha256: "0".repeat(64) },
  }), false);

  assert.equal(profileTextModerationConflictMatchesPending(pending, {
    contract_version: 1,
    current: item({ revision: 4, text: "Member changed this" }) as any,
  }), true);
  assert.equal(profileTextModerationConflictMatchesPending(pending, { contract_version: 1, current: null }), true);
  assert.equal(profileTextModerationConflictMatchesPending(pending, {
    contract_version: 1,
    current: item({ uid: 42 }) as any,
  }), false);
});

test("every refusal has an exact logical status, localized class, and safe retry policy", () => {
  for (const [error, status] of Object.entries(PROFILE_TEXT_MODERATION_ERROR_STATUSES)) {
    if (error === "profile-text-moderation-conflict") continue;
    const body = BRIDGE_ERRORS.has(error)
      ? { success: false, status_code: status, error }
      : refusal(error, status);
    assert.equal(profileTextModerationError(body), error, error);
    assert.notEqual(profileTextModerationErrorKey(error), "generic", error);
    assert.equal(profileTextModerationError({ ...body, status_code: status === 401 ? 403 : 401 }), null, error);
  }
  assert.equal(profileTextModerationError(refusal("future-error", 503)), null);
  assert.equal(profileTextModerationErrorKey("future-error"), "generic");
  assert.equal(profileTextModerationErrorKey("constructor"), "generic");
  assert.equal(profileTextModerationShouldRetainMutation(null), true);
  assert.equal(profileTextModerationShouldRetainMutation("future-error"), true);
  assert.equal(profileTextModerationShouldRetainMutation("constructor"), true);
  for (const error of [
    "core-unavailable",
    "core-timeout",
    "invalid-core-response",
    "profile-text-moderation-request-in-progress",
    "profile-text-moderation-stored-invalid",
    "profile-text-moderation-schema-unavailable",
    "profile-text-moderation-read-failed",
    "profile-text-moderation-audit-write-failed",
    "profile-text-moderation-receipt-write-failed",
    "profile-text-moderation-write-failed",
  ]) assert.equal(profileTextModerationShouldRetainMutation(error), true, error);
  for (const error of [
    "profile-text-moderation-member-not-found",
    "profile-text-moderation-conflict",
    "profile-text-moderation-request-id-conflict",
    "profile-text-moderation-reason-invalid",
    "admin-write-required",
  ]) assert.equal(profileTextModerationShouldRetainMutation(error), false, error);
});

test("filter parsing is closed and invalid URL input falls back to all fields", () => {
  assert.equal(profileTextModerationFilterField("headline"), "headline");
  assert.equal(profileTextModerationFilterField("about_me"), "about_me");
  assert.equal(profileTextModerationFilterField("all"), "all");
  assert.equal(profileTextModerationFilterField("about"), "all");
  assert.equal(profileTextModerationFilterField(["headline"]), "all");
});

test("route, navigation, session, UI, locales, and Help share one dormant no-bulk cutover", async () => {
  const [page, shell, bridge, actions, session, consoleSource, help, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/text-moderation/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/ProfileTextModerationConsole.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminHelp.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /if \(!PROFILE_TEXT_MODERATION_CONTRACT_READY\) notFound\(\)/);
  assert.match(page, /profileTextModerationConsoleReady/);
  assert.match(shell, /item\.key !== "textModeration" \|\| profileTextModerationConsoleReady/);
  assert.match(bridge, /profileTextModerationProxyCapabilityAuthorized/);
  assert.match(bridge, /normalizeProfileTextModerationProxyBody/);
  assert.match(bridge, /isAdminBridgeActionAuthorized\([\s\S]+profileTextModerationAuthorized/);
  assert.ok(bridge.indexOf("if (!isTrustedAdminRequest") < bridge.indexOf("if (!isAdminActionAllowed(action)"));
  assert.ok(bridge.indexOf("if (!isAdminActionAllowed(action)") < bridge.indexOf("await readAdminSession()"));
  assert.match(bridge, /const NO_STORE_HEADERS = \{ "Cache-Control": "no-store" \}/);
  assert.match(actions, /ACTIVE_PROFILE_TEXT_MODERATION_ACTIONS/);
  assert.match(session, /profileTextModerationAdminMe\(result\.data\.profile_text_moderation\)/);
  assert.match(consoleSource, /profileTextModerationPersistBeforeMutation\([\s\S]+adminCall\(next\.action/);
  assert.match(consoleSource, /window\.sessionStorage/);
  assert.match(consoleSource, /\{item\.text\}/);
  assert.doesNotMatch(consoleSource, /dangerouslySetInnerHTML|localStorage|console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(consoleSource, /selectAll|bulkAction|bulk_accept|bulk-accept/);
  assert.match(help, /route: "\/text-moderation"/);

  const en = JSON.parse(enRaw);
  const hu = JSON.parse(huRaw);
  assert.equal(en.nav.textModeration, "Profile text moderation");
  assert.equal(hu.nav.textModeration, "Profilszöveg-moderáció");
  assert.deepEqual(Object.keys(en.profileTextModeration).sort(), Object.keys(hu.profileTextModeration).sort());
  assert.deepEqual(
    Object.keys(en.profileTextModeration.errors).sort(),
    Object.keys(hu.profileTextModeration.errors).sort(),
  );
  assert.equal(Object.keys(en.adminHelp.pages.profileTextModeration.sections).length, 8);
  assert.deepEqual(
    Object.keys(en.adminHelp.pages.profileTextModeration.sections).sort(),
    Object.keys(hu.adminHelp.pages.profileTextModeration.sections).sort(),
  );
  assert.match(en.adminHelp.pages.profileTextModeration.sections.noBulk.guidance, /outside T-120/);
});

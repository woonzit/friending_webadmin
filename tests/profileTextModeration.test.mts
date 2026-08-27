import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
  type ProfileTextModerationFilterField,
  type ProfileTextModerationRole,
  type ProfileTextModerationStatus,
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

/**
 * Normative provider corpus published by Core T-120 at
 * `22c7186bf84ec748b129a47739037d94234da59f` and copied here byte-identically.
 * The manifest — not this file — is the authority on what the set contains; the
 * bindings below only declare which production decoder each published case must
 * survive, so a provider regeneration cannot silently change consumer meaning.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/profile_text_moderation_wire/", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "6a8d226aad51bbacebd478d122b6907447e74f5b";
const FIXTURE_SET_SHA256 = "34d2584376c163df123edc0f5c460fc28cc6c962c78fccafde4766c7045024cf";
const FIXTURE_PROVIDER_MANIFEST_SHA256 = "5f84f81c5c85d0f48aca52620843c7151547dd8653d01fdd7e0ea502488cf85c";
const FIXTURE_ROUTES = [
  "/v1/webadmin/admin_me",
  "/v1/webadmin/moderation_profile_text_list",
  "/v1/webadmin/moderation_profile_text_action",
  "contract://malformed-profile-text-response",
] as const;
/** No published browser projection may carry contact, location, or provenance material. */
const FORBIDDEN_MATERIAL = /email|phone|msisdn|latitude|longitude|location|address|import|evidence|persona|ip_address/iu;

type FixtureBinding =
  | { kind: "admin_me"; role: ProfileTextModerationRole; ready: boolean }
  | {
    kind: "list";
    field: ProfileTextModerationFilterField;
    uid: number | null;
    pageSize: number;
    items: number;
    total: number;
    paged: boolean;
  }
  | { kind: "mutation"; status: ProfileTextModerationStatus; replayed: boolean }
  | { kind: "conflict"; status: ProfileTextModerationStatus | null; revision: number | null }
  | { kind: "error"; error: string }
  | { kind: "malformed" };

/** Keyed by published file name; the manifest's own order is asserted separately. */
const FIXTURE_BINDINGS: Record<string, FixtureBinding> = {
  "admin-me-dormant-viewer.json": { kind: "admin_me", role: "viewer", ready: false },
  "admin-me-dormant-admin.json": { kind: "admin_me", role: "admin", ready: false },
  "admin-me-dormant-owner.json": { kind: "admin_me", role: "owner", ready: false },
  "admin-me-ready-viewer.json": { kind: "admin_me", role: "viewer", ready: true },
  "admin-me-ready-admin.json": { kind: "admin_me", role: "admin", ready: true },
  "admin-me-ready-owner.json": { kind: "admin_me", role: "owner", ready: true },
  "admin-me-revoked.json": { kind: "error", error: "admin-revoked" },
  "list-empty.json": { kind: "list", field: "all", uid: null, pageSize: 50, items: 0, total: 0, paged: false },
  "list-one-field.json": { kind: "list", field: "all", uid: null, pageSize: 50, items: 1, total: 1, paged: false },
  "list-two-fields-one-member.json": { kind: "list", field: "all", uid: 501, pageSize: 50, items: 2, total: 2, paged: false },
  "list-mixed-members.json": { kind: "list", field: "all", uid: null, pageSize: 50, items: 4, total: 4, paged: false },
  "list-uid-filtered.json": { kind: "list", field: "all", uid: 501, pageSize: 50, items: 2, total: 2, paged: false },
  "list-field-filtered.json": { kind: "list", field: "headline", uid: null, pageSize: 50, items: 2, total: 2, paged: false },
  "list-page-one.json": { kind: "list", field: "all", uid: null, pageSize: 2, items: 2, total: 4, paged: true },
  "list-page-two.json": { kind: "list", field: "all", uid: null, pageSize: 2, items: 2, total: 4, paged: false },
  "list-headline-bound.json": { kind: "list", field: "headline", uid: null, pageSize: 50, items: 1, total: 1, paged: false },
  "list-about-me-bound.json": { kind: "list", field: "about_me", uid: null, pageSize: 50, items: 1, total: 1, paged: false },
  "list-unicode-safe-identity.json": { kind: "list", field: "all", uid: 501, pageSize: 50, items: 2, total: 2, paged: false },
  "action-accepted-admin.json": { kind: "mutation", status: "accepted", replayed: false },
  "action-denied-owner.json": { kind: "mutation", status: "denied", replayed: false },
  "action-completed-replay.json": { kind: "mutation", status: "accepted", replayed: true },
  "action-receipt-recovery.json": { kind: "mutation", status: "accepted", replayed: false },
  "race-same-field-winner.json": { kind: "mutation", status: "accepted", replayed: false },
  "race-different-field-headline.json": { kind: "mutation", status: "accepted", replayed: false },
  "race-different-field-about-me.json": { kind: "mutation", status: "denied", replayed: false },
  "conflict-stale-revision.json": { kind: "conflict", status: "pending", revision: 3 },
  "conflict-changed-hash.json": { kind: "conflict", status: "pending", revision: 3 },
  "conflict-member-edit.json": { kind: "conflict", status: "pending", revision: 4 },
  "conflict-already-resolved.json": { kind: "conflict", status: "accepted", revision: 4 },
  "race-same-field-loser.json": { kind: "conflict", status: "accepted", revision: 4 },
  "race-member-edit-winner.json": { kind: "conflict", status: "pending", revision: 4 },
  "conflict-empty-field.json": { kind: "conflict", status: null, revision: null },
  "error-unauthorized.json": { kind: "error", error: "unauthorized" },
  "error-admin-session-invalid.json": { kind: "error", error: "admin-session-invalid" },
  "error-admin-revoked.json": { kind: "error", error: "admin-revoked" },
  "error-read-required.json": { kind: "error", error: "profile-text-moderation-read-required" },
  "error-decision-required.json": { kind: "error", error: "profile-text-moderation-decision-required" },
  "error-version-required.json": { kind: "error", error: "profile-text-moderation-contract-version-required" },
  "error-version-invalid.json": { kind: "error", error: "profile-text-moderation-contract-version-invalid" },
  "error-request-invalid.json": { kind: "error", error: "profile-text-moderation-request-invalid" },
  "error-filter-invalid.json": { kind: "error", error: "profile-text-moderation-filter-invalid" },
  "error-cursor-invalid.json": { kind: "error", error: "profile-text-moderation-cursor-invalid" },
  "error-member-invalid.json": { kind: "error", error: "profile-text-moderation-member-invalid" },
  "error-field-invalid.json": { kind: "error", error: "profile-text-moderation-field-invalid" },
  "error-decision-invalid.json": { kind: "error", error: "profile-text-moderation-decision-invalid" },
  "error-revision-invalid.json": { kind: "error", error: "profile-text-moderation-revision-invalid" },
  "error-content-hash-invalid.json": { kind: "error", error: "profile-text-moderation-content-hash-invalid" },
  "error-reason-invalid.json": { kind: "error", error: "profile-text-moderation-reason-invalid" },
  "error-request-id-invalid.json": { kind: "error", error: "profile-text-moderation-request-id-invalid" },
  "error-member-not-found.json": { kind: "error", error: "profile-text-moderation-member-not-found" },
  "error-request-id-conflict.json": { kind: "error", error: "profile-text-moderation-request-id-conflict" },
  "error-request-in-progress.json": { kind: "error", error: "profile-text-moderation-request-in-progress" },
  "error-stored-invalid.json": { kind: "error", error: "profile-text-moderation-stored-invalid" },
  "error-schema-unavailable.json": { kind: "error", error: "profile-text-moderation-schema-unavailable" },
  "error-read-failed.json": { kind: "error", error: "profile-text-moderation-read-failed" },
  "error-audit-write-failed.json": { kind: "error", error: "profile-text-moderation-audit-write-failed" },
  "error-receipt-write-failed.json": { kind: "error", error: "profile-text-moderation-receipt-write-failed" },
  "error-write-failed.json": { kind: "error", error: "profile-text-moderation-write-failed" },
  "malformed-extra-top-level.json": { kind: "malformed" },
  "malformed-missing-data.json": { kind: "malformed" },
  "malformed-status-type.json": { kind: "malformed" },
  "malformed-additive-item.json": { kind: "malformed" },
  "malformed-conflict-data.json": { kind: "malformed" },
};

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

test("the 63 published Core fixtures are byte-identical, manifest-bound, and inventory-exact", async () => {
  const manifest = await fixtureManifest();
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "contract_version",
    "source_commit",
    "provider_manifest_sha256",
    "fixture_set_sha256",
    "provenance",
    "fixtures",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract_version, 1);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.provider_manifest_sha256, FIXTURE_PROVIDER_MANIFEST_SHA256);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(manifest.provenance), [
    "generator",
    "generator_sha256",
    "wire_adapters",
    "cache_policy",
    "evaluated_at",
    "source_paths",
  ]);
  assert.equal(manifest.provenance.generator, "tests/profile_text_moderation_fixture_dump.php");
  assert.match(manifest.provenance.generator_sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(manifest.provenance.wire_adapters, {
    admin_me: "Friending\\Support\\Webadmin::reply",
    versioned_actions: "Friending\\Support\\Webadmin::noStoreReply",
  });
  assert.deepEqual(manifest.provenance.cache_policy, {
    admin_me: "pre-version-route-default",
    versioned_actions: "no-store",
  });
  assert.deepEqual(manifest.provenance.source_paths, ["composer.json", "config/", "public/", "src/"]);

  const rows: Json[] = manifest.fixtures;
  assert.equal(rows.length, 63);
  assert.deepEqual(rows.map((row) => row.file), Object.keys(FIXTURE_BINDINGS));
  assert.deepEqual(
    (await readdir(FIXTURE_DIRECTORY)).sort(),
    [...Object.keys(FIXTURE_BINDINGS), "manifest.json"].sort(),
  );

  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ["file", "route", "case", "consumer", "valid", "sha256"], row.file);
    assert.equal(row.consumer, "webadmin", row.file);
    assert.ok((FIXTURE_ROUTES as readonly string[]).includes(row.route), row.route);
    assert.equal(row.valid, FIXTURE_BINDINGS[row.file].kind !== "malformed", row.file);
    assert.equal(
      row.route === "contract://malformed-profile-text-response",
      FIXTURE_BINDINGS[row.file].kind === "malformed",
      row.file,
    );
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      row.sha256,
      `${row.file} changed after Core publication`,
    );
    if (row.valid) assert.doesNotMatch(bytes.toString("utf8"), FORBIDDEN_MATERIAL, row.file);
  }

  // Recompute Core's aggregate exactly as `profile_text_moderation_fixture_dump.php` does.
  assert.equal(
    createHash("sha256")
      .update(rows.map((row) => `${row.file}\0${row.sha256}`).join("\n"), "utf8")
      .digest("hex"),
    FIXTURE_SET_SHA256,
  );
});

test("every published fixture round-trips through the production decoder its case declares", async () => {
  const rows: Json[] = (await fixtureManifest()).fixtures;
  for (const row of rows) {
    const binding = FIXTURE_BINDINGS[row.file];
    const body = JSON.parse(await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8"));
    if (binding.kind === "admin_me") {
      const parsed = profileTextModerationAdminMe(body.profile_text_moderation);
      assert.deepEqual(parsed, block(binding.role, binding.ready), row.file);
      assert.equal(
        profileTextModerationProxyCapabilityAuthorized("moderation_profile_text_list", body),
        binding.ready,
        row.file,
      );
      assert.equal(
        profileTextModerationProxyCapabilityAuthorized("moderation_profile_text_action", body),
        binding.ready && binding.role !== "viewer",
        row.file,
      );
      continue;
    }
    if (binding.kind === "list") {
      const expectation = { field: binding.field, uid: binding.uid, page_size: binding.pageSize };
      const parsed = await profileTextModerationListResponse(body, expectation);
      assert.ok(parsed, row.file);
      assert.deepEqual(parsed.filter, { field: binding.field, uid: binding.uid }, row.file);
      assert.equal(parsed.items.length, binding.items, row.file);
      assert.equal(parsed.total, binding.total, row.file);
      assert.equal(parsed.next_cursor !== null, binding.paged, row.file);
      assert.ok(parsed.items.every((entry) => entry.status === "pending"), row.file);
      // A wrong filter or a page smaller than the published page must never decode.
      assert.equal(
        await profileTextModerationListResponse(body, { ...expectation, uid: 999_999 }),
        null,
        row.file,
      );
      if (binding.items > 1) {
        assert.equal(
          await profileTextModerationListResponse(body, { ...expectation, page_size: binding.items - 1 }),
          null,
          row.file,
        );
      }
      continue;
    }
    if (binding.kind === "mutation") {
      const parsed = await profileTextModerationMutationResponse(body);
      assert.ok(parsed, row.file);
      assert.equal(parsed.item.status, binding.status, row.file);
      assert.equal(parsed.replayed, binding.replayed, row.file);
      assert.equal(await profileTextModerationConflict(body), null, row.file);
      continue;
    }
    if (binding.kind === "conflict") {
      const parsed = await profileTextModerationConflict(body);
      assert.ok(parsed, row.file);
      assert.equal(parsed.current?.status ?? null, binding.status, row.file);
      assert.equal(parsed.current?.revision ?? null, binding.revision, row.file);
      assert.equal(await profileTextModerationMutationResponse(body), null, row.file);
      // A conflict is a refusal, never a decodable success or a plain error.
      assert.equal(profileTextModerationError(body), null, row.file);
      continue;
    }
    if (binding.kind === "error") {
      assert.equal(profileTextModerationError(body), binding.error, row.file);
      assert.equal(profileTextModerationAdminMe(body.profile_text_moderation), null, row.file);
      assert.equal(await profileTextModerationMutationResponse(body), null, row.file);
      assert.equal(await profileTextModerationConflict(body), null, row.file);
      continue;
    }
    const expectation = { field: "all" as const, uid: null, page_size: 50 };
    assert.equal(profileTextModerationAdminMe(body.profile_text_moderation), null, row.file);
    assert.equal(await profileTextModerationListResponse(body, expectation), null, row.file);
    assert.equal(await profileTextModerationMutationResponse(body), null, row.file);
    assert.equal(await profileTextModerationConflict(body), null, row.file);
    assert.equal(profileTextModerationError(body), null, row.file);
  }
});

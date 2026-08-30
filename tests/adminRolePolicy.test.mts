import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_ACCESS,
  adminActionAccess,
  adminPrincipalFrom,
  invalidatesAdminSession,
  isAdminActionAllowed,
  isAdminActionAuthorized,
  type AdminActionAccess,
} from "../lib/adminActions.ts";

const OWNER = adminPrincipalFrom({ role: "owner" });
const ADMIN = adminPrincipalFrom({ role: "admin" });
const VIEWER = adminPrincipalFrom({ role: "viewer" });

function actionsWithAccess(access: AdminActionAccess): string[] {
  return ADMIN_ACTIONS.filter((action) => adminActionAccess(action) === access);
}

test("every allow-listed action is classified, and nothing else is", () => {
  const listed = [...ADMIN_ACTIONS].sort();
  const classified = Object.keys(ADMIN_ACTION_ACCESS).sort();
  assert.deepEqual(classified, listed);
  assert.equal(new Set(listed).size, listed.length, "the allow-list must not repeat an action");
  for (const action of ADMIN_ACTIONS) {
    assert.ok(adminActionAccess(action), `${action} has no access class`);
  }
});

/** The People hero and App landing actions the D-052 appearance rules replace at cutover. */
const LEGACY_PLACEMENT_ACTIONS = [
  "list_hero",
  "save_hero",
  "delete_hero",
  "list_app_landing",
  "save_app_landing",
  "delete_app_landing",
];

test("the historically permissive bridge actions remain classified as writes", () => {
  // The matching Core release now uses its editor gate too. Keeping the console
  // classification explicit preserves defence in depth and prevents a future
  // backend regression from widening the browser surface.
  for (const action of [
    "save_landing",
    "delete_landing",
    "set_demo_visibility_permission",
  ]) {
    assert.equal(adminActionAccess(action), "write", `${action} must be a write`);
    assert.equal(isAdminActionAuthorized(action, VIEWER), false);
  }
});

test("the replaced hero and app-landing actions stay out of the allow-list", () => {
  // D-052 replaced these surfaces with /appearance and D-060 retired the switch
  // that used to carry them, so they are denied for everyone, owner included.
  for (const action of ["list_hero", "save_hero", "delete_hero", "list_app_landing", "save_app_landing", "delete_app_landing"]) {
    assert.equal(isAdminActionAllowed(action), false, action);
    assert.equal(action in ADMIN_ACTION_ACCESS, false, action);
    assert.equal(isAdminActionAuthorized(action, OWNER), false, action);
  }
  // The Join landing (web) surface is untouched by the cutover.
  for (const action of ["list_landing", "save_landing", "delete_landing"]) {
    assert.equal(isAdminActionAllowed(action), true, action);
  }
});

test("verification metadata stays readable while evidence and decisions require a writer", () => {
  for (const action of [
    "profile_verification_config",
    "profile_verification_queue",
    "profile_verification_detail",
  ]) {
    assert.equal(adminActionAccess(action), "read");
    assert.equal(isAdminActionAuthorized(action, VIEWER), true);
  }
  for (const action of [
    "save_profile_verification_config",
    "profile_verification_evidence",
    "profile_verification_decision",
    "profile_verification_lease",
  ]) {
    assert.equal(adminActionAccess(action), "write");
    assert.equal(isAdminActionAuthorized(action, VIEWER), false);
    assert.equal(isAdminActionAuthorized(action, ADMIN), true);
  }
});

test("only session failures invalidate the browser session", () => {
  assert.equal(invalidatesAdminSession(401, "invalid"), true);
  assert.equal(invalidatesAdminSession(403, "admin-revoked"), true);
  assert.equal(invalidatesAdminSession(403, "admin-session-invalid"), true);
  assert.equal(invalidatesAdminSession(403, "admin-write-required"), false);
  assert.equal(invalidatesAdminSession(403, "owner-required"), false);
  assert.equal(invalidatesAdminSession(403, "dates-admin-capability-required"), false);
  assert.equal(invalidatesAdminSession(422, "invalid-input"), false);
});

test("admin-allow-list mutations are owner-only", () => {
  for (const action of ["add_admin", "update_admin", "delete_admin"]) {
    assert.equal(adminActionAccess(action), "owner");
    assert.equal(isAdminActionAuthorized(action, OWNER), true);
    assert.equal(isAdminActionAuthorized(action, ADMIN), false);
    assert.equal(isAdminActionAuthorized(action, VIEWER), false);
  }
});

test("a viewer is denied every write and allowed every read", () => {
  const writes = [
    ...actionsWithAccess("write"),
    ...actionsWithAccess("owner"),
    ...actionsWithAccess("dates_write"),
  ];
  const reads = [...actionsWithAccess("read"), ...actionsWithAccess("dates_read")];
  assert.ok(writes.length > 0 && reads.length > 0);
  assert.equal(writes.length + reads.length, ADMIN_ACTIONS.length);

  for (const action of writes) {
    assert.equal(isAdminActionAuthorized(action, VIEWER), false, `viewer may not ${action}`);
  }
  for (const action of reads) {
    assert.equal(isAdminActionAuthorized(action, VIEWER), true, `viewer may ${action}`);
  }
});

test("admin and owner keep the access they have today", () => {
  for (const action of ADMIN_ACTIONS) {
    assert.equal(isAdminActionAuthorized(action, OWNER), true, `owner may ${action}`);
  }
  for (const action of ADMIN_ACTIONS) {
    const expected = adminActionAccess(action) !== "owner";
    assert.equal(isAdminActionAuthorized(action, ADMIN), expected, `admin vs ${action}`);
  }
});

test("an unknown or unclassified action is denied even for the owner", () => {
  for (const action of [
    "brand_new_action",
    "delete_everything",
    "",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ]) {
    assert.equal(isAdminActionAllowed(action), false, `${action} must not be allow-listed`);
    assert.equal(adminActionAccess(action), null);
    assert.equal(isAdminActionAuthorized(action, OWNER), false, `owner may not ${action}`);
  }
});

test("the allow-list is an exact match against a closed set", () => {
  assert.equal(isAdminActionAllowed("overview"), true);
  for (const action of [
    "../overview",
    "./overview",
    "overview/../add_admin",
    "overview/",
    "/overview",
    "overview%2f..%2fadd_admin",
    "%2e%2e%2foverview",
    "overview%20",
    "OVERVIEW",
    "Overview",
    "oVeRvIeW",
    " overview",
    "overview ",
    "overview\n",
    "overview\u0000",
    "over",
    "overview_extra",
    "list_users?x=1",
    "İist_users",
  ]) {
    assert.equal(isAdminActionAllowed(action), false, `${JSON.stringify(action)} must be rejected`);
    assert.equal(isAdminActionAuthorized(action, OWNER), false);
  }
});

test("a malformed membership payload cannot inherit write access", () => {
  for (const payload of [null, undefined, "owner", [], {}, { role: 42 }, { role: "root" }]) {
    const principal = adminPrincipalFrom(payload);
    assert.equal(isAdminActionAuthorized("save_hero", principal), false);
    assert.equal(isAdminActionAuthorized("add_admin", principal), false);
    assert.equal(isAdminActionAuthorized("dates_moderation_resolve", principal), false);
    // Reads stay open: membership was already proven by the caller, and Core
    // remains authoritative for every read it restricts.
    assert.equal(isAdminActionAuthorized("overview", principal), true);
  }
});

test("the role is read case- and whitespace-insensitively", () => {
  const principal = adminPrincipalFrom({ role: "  Owner " });
  assert.equal(principal.role, "owner");
  assert.equal(isAdminActionAuthorized("add_admin", principal), true);
});

test("Dates authority follows the Core rung, not only the global role", () => {
  // No `dates` block: Core derives the rung from the global role, and so do we.
  assert.equal(adminPrincipalFrom({ role: "owner" }).datesRole, "superadmin");
  assert.equal(adminPrincipalFrom({ role: "admin" }).datesRole, "administrator");
  assert.equal(adminPrincipalFrom({ role: "viewer" }).datesRole, "support_viewer");
  assert.equal(adminPrincipalFrom({ role: "root" }).datesRole, "");

  // An explicit rung wins, exactly as `DatesAdminAuthorizationService` reads it.
  const datesModerator = adminPrincipalFrom({ role: "viewer", dates: { role: "moderator" } });
  assert.equal(isAdminActionAuthorized("dates_moderation_resolve", datesModerator), true);
  assert.equal(isAdminActionAuthorized("dates_moderation_queue", datesModerator), true);
  // …but a Dates rung grants nothing outside Dates.
  assert.equal(isAdminActionAuthorized("save_hero", datesModerator), false);
  assert.equal(isAdminActionAuthorized("add_admin", datesModerator), false);

  const supportViewer = adminPrincipalFrom({ role: "admin", dates: { role: "support_viewer" } });
  assert.equal(isAdminActionAuthorized("dates_moderation_resolve", supportViewer), false);
  assert.equal(isAdminActionAuthorized("dates_moderation_queue", supportViewer), true);

  const garbageRung = adminPrincipalFrom({ role: "viewer", dates: { role: "root" } });
  assert.equal(garbageRung.datesRole, "support_viewer");
  assert.equal(isAdminActionAuthorized("dates_reason_save", garbageRung), false);
});

test("the Dates read/write split matches the Core capability ladder", () => {
  const reads = [
    "admin_me",
    "dates_activity_list",
    "dates_activity_detail",
    "dates_activity_location",
    "dates_configuration",
    "dates_moderation_queue",
    "dates_moderation_detail",
    "dates_moderation_evidence",
    "dates_moderation_sla",
    "dates_reason_list",
  ];
  const writes = [
    "dates_activity_update",
    "dates_activity_command",
    "dates_activity_host_transfer",
    "dates_configuration_save",
    "dates_activity_type_save",
    "dates_moderation_trail_evidence",
    "dates_moderation_claim",
    "dates_moderation_heartbeat",
    "dates_moderation_release",
    "dates_moderation_note",
    "dates_moderation_escalate",
    "dates_moderation_resolve",
    "dates_moderation_legal_hold",
    "dates_reason_save",
    "dates_reason_deactivate",
  ];
  for (const action of reads) {
    assert.ok(
      adminActionAccess(action) === "dates_read" || adminActionAccess(action) === "read",
      `${action} must be a read`,
    );
  }
  for (const action of writes) {
    assert.equal(adminActionAccess(action), "dates_write", `${action} must be a Dates write`);
  }
  assert.equal(reads.length + writes.length, 25);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  canComposeRestriction,
  parseModerationStatus,
  validModerationReason,
  validSuspendMinutesInput,
} from "../components/UserModerationPanel.tsx";
import { adminActionAccess, isAdminActionAllowed } from "../lib/adminActions.ts";

const WIRE = {
  banned: false,
  ban_reason: "",
  banned_at: 0,
  suspended: true,
  suspended_until: 1786300000,
  suspend_reason: "cool down",
  hidden_from_members: true,
  last_ip: "203.0.113.9",
  ip_banned: false,
  footprints_daily_limit: 5,
};

test("parses the complete Core moderation wire", () => {
  const parsed = parseModerationStatus(WIRE);
  assert.ok(parsed);
  assert.equal(parsed.suspended, true);
  assert.equal(parsed.suspended_until, 1786300000);
  assert.equal(parsed.suspend_reason, "cool down");
  assert.equal(parsed.hidden_from_members, true);
  assert.equal(parsed.last_ip, "203.0.113.9");
  assert.equal(parsed.footprints_daily_limit, 5);
});

test("refuses a payload missing a required boolean", () => {
  const { banned: _banned, ...rest } = WIRE;
  assert.equal(parseModerationStatus(rest), null);
  assert.equal(parseModerationStatus(null), null);
  assert.equal(parseModerationStatus([]), null);
  assert.equal(parseModerationStatus({ ...WIRE, suspended_until: "soon" }), null);
});

test("optional fields default instead of failing", () => {
  const parsed = parseModerationStatus({
    banned: true,
    banned_at: 100,
    suspended: false,
    suspended_until: 0,
    hidden_from_members: true,
  });
  assert.ok(parsed);
  assert.equal(parsed.ban_reason, "");
  assert.equal(parsed.last_ip, "");
  assert.equal(parsed.ip_banned, false);
  // Absent quota means "global default", which must stay distinguishable from 0.
  assert.equal(parsed.footprints_daily_limit, null);
});

test("moderation actions are allow-listed with Core-matching access", () => {
  const expected: Record<string, "read" | "write"> = {
    user_moderation: "read",
    suspend_user: "write",
    unsuspend_user: "write",
    ban_user: "write",
    unban_user: "write",
    ban_user_ip: "write",
    remove_ip_ban: "write",
    force_logout_user: "write",
    admin_save_user_content: "write",
    admin_set_main_photo: "write",
  };
  for (const [action, access] of Object.entries(expected)) {
    assert.equal(isAdminActionAllowed(action), true, action);
    assert.equal(adminActionAccess(action), access, action);
  }
});

test("restriction composer requires an auditable reason", () => {
  assert.equal(validModerationReason(""), false);
  assert.equal(validModerationReason("  \n  "), false);
  assert.equal(validModerationReason("Repeated harassment"), true);
});

test("custom suspension accepts only bounded whole minutes", () => {
  for (const valid of ["1", "10", "129600", " 60 "]) {
    assert.equal(validSuspendMinutesInput(valid), true, valid);
  }
  for (const invalid of ["", "0", "129601", "1.5", "1e3", "soon", "-10"]) {
    assert.equal(validSuspendMinutesInput(invalid), false, invalid);
  }
});

test("a suspension can be replaced or escalated without an unsafe lift-first gap", () => {
  assert.equal(canComposeRestriction({ banned: false }), true);
  assert.equal(canComposeRestriction({ banned: true }), false);
});

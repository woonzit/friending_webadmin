import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MemberAgePolicyRows } from "../components/MemberAgePolicyRows.tsx";
import {
  MEMBER_BIRTHDAY_LOCK_ACTION,
  memberBirthdayLockErrorMessageKey,
  memberBirthdayLockRefusal,
  memberBirthdayLockResetPayload,
  memberBirthdayLockResetResponse,
  normalizeMemberBirthdayLockProxyBody,
} from "../lib/memberBirthdayLock.ts";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";
import type { UserDetailProfile } from "../lib/userDetail.ts";

const UID = 75901;
const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";
const AUDIT_ID = `wai:${"a".repeat(64)}`;

function success(changed: boolean) {
  return {
    success: true,
    status_code: 200,
    data: {
      contract_version: 1,
      uid: UID,
      changed,
      birthday_locked: false,
      remaining_changes: 1,
      receipt: { request_id: REQUEST_ID, audit_id: AUDIT_ID, replayed: false },
    },
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function refusal(error: string, statusCode: number) {
  return {
    success: false,
    status_code: statusCode,
    error,
    message: 200,
    status: 200,
    can_send: 0,
  };
}

test("the proxy admits only the exact receipted reset body and classifies it as a write", () => {
  const payload = { contract_version: 1 as const, uid: UID, request_id: REQUEST_ID };
  assert.deepEqual(memberBirthdayLockResetPayload(UID, REQUEST_ID), payload);
  assert.deepEqual(normalizeMemberBirthdayLockProxyBody(MEMBER_BIRTHDAY_LOCK_ACTION, payload), payload);
  assert.equal(normalizeMemberBirthdayLockProxyBody("user_detail", payload), undefined);
  assert.equal(adminActionAccess(MEMBER_BIRTHDAY_LOCK_ACTION), "write");
  assert.equal(ADMIN_ACTIONS.filter((action) => action === MEMBER_BIRTHDAY_LOCK_ACTION).length, 1);

  for (const malformed of [
    {},
    { ...payload, contract_version: 2 },
    { ...payload, uid: 0 },
    { ...payload, uid: "75901" },
    { ...payload, request_id: "not-a-uuid" },
    { ...payload, extra: true },
  ]) assert.equal(
    normalizeMemberBirthdayLockProxyBody(MEMBER_BIRTHDAY_LOCK_ACTION, malformed),
    null,
    JSON.stringify(malformed),
  );
});

test("changed reset success decodes the exact state and receipt", () => {
  assert.deepEqual(memberBirthdayLockResetResponse(success(true), UID, REQUEST_ID), {
    contract_version: 1,
    uid: UID,
    changed: true,
    birthday_locked: false,
    remaining_changes: 1,
    receipt: { request_id: REQUEST_ID, audit_id: AUDIT_ID, replayed: false },
  });
});

test("already-unlocked success remains a receipted no-op", () => {
  const result = memberBirthdayLockResetResponse(success(false), UID, REQUEST_ID);
  assert.ok(result);
  assert.equal(result.changed, false);
  assert.equal(result.birthday_locked, false);
  assert.equal(result.remaining_changes, 1);
  assert.equal(result.receipt.request_id, REQUEST_ID);
});

test("known refusals decode with their exact logical status and unknown shapes fail closed", () => {
  const missing = refusal("birthday-lock-member-not-found", 404);
  assert.deepEqual(memberBirthdayLockRefusal(missing), {
    error: "birthday-lock-member-not-found",
    status_code: 404,
  });
  assert.equal(memberBirthdayLockErrorMessageKey("birthday-lock-member-not-found"), "memberNotFound");
  assert.equal(memberBirthdayLockErrorMessageKey("birthday-lock-request-id-conflict"), "conflict");
  assert.equal(memberBirthdayLockErrorMessageKey("birthday-lock-write-failed"), "unavailable");
  assert.deepEqual(memberBirthdayLockRefusal({
    success: false,
    status_code: 403,
    error: "admin-write-required",
  }), { error: "admin-write-required", status_code: 403 });
  assert.equal(memberBirthdayLockRefusal({
    success: false,
    status_code: 500,
    error: "admin-write-required",
  }), null);

  assert.equal(memberBirthdayLockRefusal(refusal("birthday-lock-member-not-found", 422)), null);
  assert.equal(memberBirthdayLockRefusal(refusal("invented-error", 404)), null);
  assert.equal(memberBirthdayLockResetResponse({ ...success(true), extra: true }), null);
  assert.equal(memberBirthdayLockResetResponse(success(true), UID + 1, REQUEST_ID), null);
  assert.equal(memberBirthdayLockResetResponse(success(true), UID, REQUEST_ID.replace(/.$/u, "d")), null);
});

test("the locked read-out owns the localized confirm control", async () => {
  const profile = {
    uid: UID,
    age_display: "exact",
    birthday_locked: true,
    realdob: true,
  } as UserDetailProfile;
  for (const [locale, label] of [["en", "Unlock birthday"], ["hu", "Zárolás feloldása"]] as const) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const markup = renderToStaticMarkup(createElement(
      NextIntlClientProvider,
      { locale, messages },
      createElement(MemberAgePolicyRows, { profile, uid: UID, onReset: async () => {} }),
    ));
    assert.match(markup, new RegExp(`>${label}<\\/button>`));
    assert.match(markup, /data-age-policy-row="Birthday lock"|data-age-policy-row="Születésnap zárolása"/u);
  }

  const component = await readFile(new URL("../components/MemberAgePolicyRows.tsx", import.meta.url), "utf8");
  assert.match(component, /window\.confirm\(t\("birthdayReset\.confirm"\)\)/u);
  assert.match(component, /globalThis\.crypto\?\.randomUUID\?\.\(\)/u);
  assert.match(component, /adminCall\("reset_member_birthday_lock", payload\)/u);
  assert.match(component, /await onReset\(\)/u);
  assert.match(component, /receipt\.request_id/u);
  assert.match(component, /receipt\.audit_id/u);
});

test("the page and same-origin proxy wire the action through the strict decoder", async () => {
  const page = await readFile(
    new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(page, /<MemberAgePolicyRows profile=\{profile\} uid=\{uid\} onReset=\{load\} \/>/u);
  assert.match(page, /setState\(\(current\) => current === "ready" \? current : "loading"\)/u);
  assert.match(route, /normalizeMemberBirthdayLockProxyBody\(action, body\)/u);
});

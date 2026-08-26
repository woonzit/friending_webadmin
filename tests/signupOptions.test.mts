import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../app/(dashboard)/signup-options/page.tsx", import.meta.url),
  "utf8",
);
const bridge = readFileSync(
  new URL("../app/api/admin/[action]/route.ts", import.meta.url),
  "utf8",
);
const actionAllowList = readFileSync(
  new URL("../lib/adminActions.ts", import.meta.url),
  "utf8",
);
const shell = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");

test("signup option actions are explicit authenticated bridge capabilities", () => {
  assert.match(actionAllowList, /"list_signup_options"/);
  assert.match(actionAllowList, /"save_signup_option_group"/);
  assert.match(actionAllowList, /"save_signup_option"/);
  assert.match(actionAllowList, /"delete_signup_option"/);
  assert.match(bridge, /isAdminActionAllowed/);
  assert.match(bridge, /readAdminSession\(\)/);
  assert.match(bridge, /isTrustedAdminRequest/);
  assert.match(shell, /href:\s*"\/signup-options"/);
});

test("system options expose rename-only controls while optional groups stay editable", () => {
  // user-cast-groups-v1: only the BUILT-IN rows of a system group are
  // label-only. A custom row — an administrator addition to the extensible
  // orientation group — owns its order, activation and audiences.
  assert.match(page, /const lockedMetadata = group\.system_owned && !draft\.is_custom/);
  assert.match(page, /disabled=\{!draft\.is_new \|\| lockedMetadata \|\| busy\}/);
  assert.match(page, /disabled=\{lockedMetadata \|\| busy\}/);
  assert.match(page, /\(group\.custom_allowed \|\| group\.extensible_system\) &&/);
  assert.match(page, /\(!group\.system_owned \|\| \(group\.extensible_system && option\.is_custom\)\) && option\.active &&/);
  assert.match(page, /group\.system_owned && !option\.is_custom \? t\("rename"\) : common\("edit"\)/);
});

test("extensible system additions carry gender audiences to Core", () => {
  assert.match(page, /const showAudiences = group\.extensible_system && draft\.is_custom/);
  assert.match(page, /audiences_json: JSON\.stringify\(optionDraft\.audiences\)/);
  // The audiences block rides ONLY on extensible custom rows; built-in rows
  // and open detail groups never send it.
  assert.match(page, /group\?\.extensible_system && optionDraft\.is_custom \? \{ audiences_json/);
  assert.match(page, /extensible_system: group\.extensible_system === true/);
});

test("matching orientation rejects profile-disclosure keys before save", () => {
  assert.match(page, /group\.key === "orientation" && isDisclosureOnlyOrientation\(option\.key\)/);
  assert.match(page, /optionDraft\.group_key === "orientation" && isDisclosureOnlyOrientation\(key\)/);
  assert.match(page, /signup-option-orientation-disclosure-forbidden/);
  assert.match(page, /orientationDisclosureForbidden/);
  assert.match(page, /matchingOrientationTitle/);
  assert.match(page, /matchingOrientationCopy/);
});

test("signup groups expose localized presentation and audience settings", () => {
  assert.match(page, /ProfileIconUploadField/);
  assert.match(page, /MemberAudienceSelector/);
  assert.match(page, /adminCall\("save_signup_option_group"/);
  assert.match(page, /genders_json: JSON\.stringify\(editingGroup\.audience\.genders\)/);
  assert.match(page, /group_ids_json: JSON\.stringify\(editingGroup\.audience\.groupIds\)/);
  assert.match(page, /segments_json: JSON\.stringify\(editingGroup\.audience\.legacySegments\)/);
  assert.match(page, /group\.system_owned \? \(/);
  assert.match(page, /group\.required \? t\("required"\) : t\("optional"\)/);
});

test("the catalog is compact until an operator opens a question card", () => {
  assert.match(page, /expanded\.has\(group\.key\)/);
  assert.match(page, /aria-expanded=\{open\}/);
  assert.match(page, /\{open && \(/);
  assert.match(page, /groupFilter/);
});

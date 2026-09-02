import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signupOptionCatalog } from "../lib/signupOptions.ts";

const page = readFileSync(
  new URL("../app/(dashboard)/signup-options/page.tsx", import.meta.url),
  "utf8",
);
const signupLibrary = readFileSync(
  new URL("../lib/signupOptions.ts", import.meta.url),
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
  // Only the BUILT-IN rows of a system group are label-only. A custom row in
  // any extensible system group owns its order, activation and audiences.
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
  assert.match(signupLibrary, /extensible_system: group\.extensible_system === true/);
});

test("a catalogue without retired groups decodes and the page renders only served groups", () => {
  const group = (key: string, required: boolean) => ({
    key,
    name_en: key === "gender" ? "Gender" : "Education",
    name_hu: key === "gender" ? "Nem" : "Végzettség",
    system_owned: key === "gender",
    required,
    custom_allowed: key !== "gender",
    extensible_system: false,
    profile_field: key,
    question_pack: key === "gender" ? "identity" : "common",
    revision: 1,
    icon: { url: "", mime: "" },
    audience: { mode: "global", genders: [], group_ids: [], segments: [] },
    options: [{
      key: key === "gender" ? "male" : "college",
      name_en: key === "gender" ? "Man" : "College",
      name_hu: key === "gender" ? "Férfi" : "Főiskola",
      sort_order: 10,
      active: true,
      is_custom: false,
      system_owned: key === "gender",
    }],
  });
  const parsed = signupOptionCatalog({
    schema_version: 2,
    cast_groups: [],
    segments: [],
    groups: [group("gender", true), group("education_level", false)],
  });
  assert.deepEqual(parsed?.groups.map((item) => item.key), ["gender", "education_level"]);
  assert.equal(parsed?.groups.filter((item) => item.required).length, 1);
  assert.match(page, /catalog\.groups\.filter\(\(group\) => group\.required\)\.length/);
  assert.match(page, /\{groups\.map\(\(group\) =>/);
  assert.match(page, /group\.required \? t\("required"\) : t\("optional"\)/);
  assert.doesNotMatch(page, /["'](?:orientation|looking_for|relationship_status)["']/);
});

test("retired member-orientation copy is absent in both locales", () => {
  const en = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  for (const key of [
    "matchingOrientationTitle",
    "matchingOrientationCopy",
    "orientationDisclosureForbidden",
    "extensibleSystemIntro",
  ]) {
    assert.equal(Object.hasOwn(en.signupOptions, key), false);
    assert.equal(Object.hasOwn(hu.signupOptions, key), false);
  }
  assert.equal(Object.hasOwn(en.userProfileEditor, "orientation"), false);
  assert.equal(Object.hasOwn(hu.userProfileEditor, "orientation"), false);
  assert.deepEqual(Object.keys(en.signupOptions).sort(), Object.keys(hu.signupOptions).sort());
  assert.doesNotMatch(JSON.stringify(en.adminHelp.pages.signupOptions), /orientation/i);
  assert.doesNotMatch(JSON.stringify(hu.adminHelp.pages.signupOptions), /orient/i);
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

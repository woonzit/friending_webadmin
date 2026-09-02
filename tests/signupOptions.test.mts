import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIGNUP_RETIRED_REQUIRED_GROUPS,
  signupOptionCatalog,
} from "../lib/signupOptions.ts";

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
  assert.equal(parsed?.groups.filter((item) => item.required_at_signup).length, 1);
  assert.match(page, /catalog\.groups\.filter\(\(group\) => group\.required_at_signup\)\.length/);
  assert.match(page, /\{groups\.map\(\(group\) =>/);
  assert.match(page, /group\.required_at_signup \? t\("required"\) : t\("optional"\)/);
  assert.doesNotMatch(page, /["'](?:orientation|looking_for|relationship_status)["']/);
});

test("the console badges Required only for a question the v3 signup actually asks", () => {
  // Core keeps `relationship_status` in REQUIRED_GROUPS until T-634 so the
  // installed decoders keep working, while the v3 ladder has no relationship
  // step and hard-sends `unspecified`. Badging it Required tells an operator
  // to protect an answer nobody is asked for.
  assert.deepEqual([...SIGNUP_RETIRED_REQUIRED_GROUPS], ["relationship_status"]);
  const group = (key: string, required: boolean) => ({
    key,
    name_en: key,
    name_hu: key,
    system_owned: true,
    required,
    custom_allowed: false,
    extensible_system: false,
    profile_field: key,
    question_pack: "identity",
    revision: 1,
    icon: { url: "", mime: "" },
    audience: { mode: "global", genders: [], group_ids: [], segments: [] },
    options: [],
  });
  // Exactly the seven groups Core's `adminGroups()` serves under readiness:
  // `orientation` and `looking_for` are withheld by
  // ADMIN_HIDDEN_GROUPS_WHEN_VISIBILITY_ACTIVE, so no row for them exists.
  const parsed = signupOptionCatalog({
    schema_version: 1,
    cast_groups: [],
    segments: [],
    groups: [
      group("gender", true),
      group("subgender", false),
      group("relationship_status", true),
      group("education_level", false),
      group("smoking", false),
      group("profession", false),
      group("have_kids", false),
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.groups.length, 7);
  assert.equal(parsed.groups.some((item) => item.key === "orientation"), false);
  assert.equal(parsed.groups.some((item) => item.key === "looking_for"), false);

  const relationship = parsed.groups.find((item) => item.key === "relationship_status");
  // The wire value is kept verbatim; only what the console renders changes.
  assert.equal(relationship?.required, true);
  assert.equal(relationship?.required_at_signup, false);
  assert.equal(parsed.groups.find((item) => item.key === "gender")?.required_at_signup, true);
  assert.deepEqual(
    parsed.groups.filter((item) => item.required_at_signup).map((item) => item.key),
    ["gender"],
  );
  // The card carries a visible marker instead of silently dropping the badge.
  assert.match(page, /group\.required && !group\.required_at_signup && <span className="badge badge-inactive">\{t\("notAskedAtSignup"\)\}/);
  assert.match(page, /\{t\("notAskedAtSignupCopy"\)\}/);
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
  assert.match(page, /group\.required_at_signup \? t\("required"\) : t\("optional"\)/);
});

test("the catalog is compact until an operator opens a question card", () => {
  assert.match(page, /expanded\.has\(group\.key\)/);
  assert.match(page, /aria-expanded=\{open\}/);
  assert.match(page, /\{open && \(/);
  assert.match(page, /groupFilter/);
});

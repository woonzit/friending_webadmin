import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  adminActionAccess,
  isAdminActionAllowed,
} from "../lib/adminActions.ts";

const page = readFileSync(
  new URL("../app/(dashboard)/signup-options/page.tsx", import.meta.url),
  "utf8",
);
const composer = readFileSync(
  new URL("../components/SignupPageComposer.tsx", import.meta.url),
  "utf8",
);
const actionAllowList = readFileSync(
  new URL("../lib/adminActions.ts", import.meta.url),
  "utf8",
);
const bridge = readFileSync(
  new URL("../app/api/admin/[action]/route.ts", import.meta.url),
  "utf8",
);
const profileFields = readFileSync(
  new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");
const decoder = readFileSync(new URL("../lib/signupPages.ts", import.meta.url), "utf8");

test("signup options is a one-read one-write page composer", () => {
  assert.match(page, /adminCall\("list_signup_options"\)/);
  assert.match(page, /adminCall\("save_signup_page_layout", body\)/);
  assert.match(page, /response\?\.success === true && response\.status_code === 200/);
  assert.match(actionAllowList, /"list_signup_options"/);
  assert.match(actionAllowList, /"save_signup_page_layout"/);
  assert.equal(adminActionAccess("list_signup_options"), "read");
  assert.equal(adminActionAccess("save_signup_page_layout"), "write");
  assert.match(bridge, /isAdminActionAllowed/);
  assert.match(bridge, /readAdminSession\(\)/);
  assert.match(bridge, /isTrustedAdminRequest/);
  assert.match(shell, /href:\s*"\/signup-options"/);
});

test("the option and question editors are removed from page and bridge", () => {
  const surface = `${page}\n${composer}`;
  for (const retired of [
    "save_signup_option_group",
    "save_signup_option",
    "delete_signup_option",
  ]) {
    assert.doesNotMatch(surface, new RegExp(retired));
    assert.equal(isAdminActionAllowed(retired), false, retired);
    assert.equal(adminActionAccess(retired), null, retired);
  }
  for (const retiredComponent of [
    "OptionDialog",
    "GroupDialog",
    "ConfirmDialog",
    "MemberAudienceSelector",
    "ProfileIconUploadField",
  ]) {
    assert.doesNotMatch(surface, new RegExp(retiredComponent));
  }
  assert.equal(existsSync(new URL("../lib/signupOptions.ts", import.meta.url)), false);
});

test("the composer wires nested drag, keyboard ordering and exact profile-field anchors", () => {
  assert.match(composer, /onDragStart/);
  assert.match(composer, /onDrop/);
  assert.match(composer, /movePage\(layout/);
  assert.match(composer, /moveItem\(layout/);
  assert.match(composer, /aria-label=\{t\("movePageUp"/);
  assert.match(composer, /aria-label=\{t\("moveItemUp"/);
  assert.match(composer, /href=\{`\/profile-fields#\$\{encodeURIComponent/);
  assert.match(profileFields, /<section id=\{field\.key\} className=\{`panel profile-field-card/);
  assert.match(composer, /requiredToggle/);
  assert.match(composer, /answersPreview/);
  assert.match(composer, /addHere/);
  assert.match(composer, /question\.required_min >= 1/);
  assert.match(composer, /systemRequiredMinimum/);
  assert.match(composer, /systemUnknownWarning/);
  assert.match(page, /warnings=\{payload\.warnings\}/);
  assert.match(decoder, /SIGNUP_SYSTEM_QUESTION_KEYS = \["gender", "visible_to", "intents"\]/);
  assert.match(decoder, /code: "unknown-system-question"/);
});

test("conflicts reload authority and 422 reasons stay on their page or item", () => {
  assert.match(page, /signupPageConflict\(response\)/);
  assert.match(page, /signupPageConflictLayout\(response\)/);
  assert.match(page, /const reloaded = await load\(\)/);
  assert.match(page, /signupPageSaveIssues\(response\)/);
  assert.match(page, /setServerIssues\(refusalIssues\)/);
  assert.match(composer, /issue\.page_key === page\.key && issue\.field_key === item\.field_key/);
  assert.match(composer, /signup-item-errors/);
  assert.doesNotMatch(composer, /issues\.map\([^\n]+alert alert-error/);
});

test("the console decodes the error names Core actually sends", () => {
  // T-671 shipped pinned on two names Core has never served, so a lost race and
  // a policy refusal both fell through to the generic save error with nothing
  // to fix (T-670 landing report, "two names it got wrong").
  assert.match(decoder, /"signup-page-conflict"/);
  assert.match(decoder, /"signup-page-layout-refused"/);
  assert.match(decoder, /details\.items/);
  assert.doesNotMatch(decoder, /=== "signup-page-layout-conflict"/);
  assert.doesNotMatch(decoder, /!== "signup-page-layout-invalid"/);
  assert.doesNotMatch(decoder, /source\.errors/);
});

test("an accepted save is adopted from Core's answer, not from the sent draft", () => {
  // The 200 repeats the whole payload — document, catalogue, System questions
  // and the rows THIS save healed — so re-using the draft would hide Core's
  // healing until the next read.
  assert.match(page, /const parsed = signupPagesPayload\(response\)/);
  assert.match(page, /parsed\.pages\.revision !== revision/);
  assert.match(page, /withRevision\(draft, revision\)/);
  assert.match(page, /adopt\(parsed\)/);
  assert.doesNotMatch(page, /dropped_items: \[\]/);
});

test("both locale trees remove editor copy and carry the composer copy", () => {
  const en = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  const removed = [
    "add",
    "addTitle",
    "editTitle",
    "rename",
    "deleteTitle",
    "deleteCopy",
    "deleteError",
    "deleted",
    "groupSettings",
    "groupEditTitle",
    "groupNameEn",
    "groupNameHu",
    "groupIcon",
    "groupSaveError",
    "groupConflict",
    "groupSaved",
    "systemAnswer",
    "systemAnswerCopy",
    "audiences",
    "audiencesHint",
    "audiencesRequired",
  ];
  const added = [
    "systemTitle",
    "systemBadge",
    "systemRequired",
    "systemOptional",
    "systemRequiredMinimum",
    "systemUnknownWarning",
    "pagesTitle",
    "firstPage",
    "pageTitleEn",
    "pageTitleHu",
    "hiddenToggle",
    "answersPreview",
    "requiredToggle",
    "editAnswers",
    "paletteTitle",
    "addHere",
    "layoutRevision",
    "discardDraft",
    "saveChanges",
    "conflictReloaded",
    "droppedNotice",
    "issuePageLimit",
    "issueItemLimit",
    "issueUnknownField",
    "issueFieldNotSelectable",
    "issueFieldArchived",
    "issueDuplicateField",
    "issueBlankTitle",
  ];
  for (const key of removed) {
    assert.equal(Object.hasOwn(en.signupOptions, key), false, `EN still has ${key}`);
    assert.equal(Object.hasOwn(hu.signupOptions, key), false, `HU still has ${key}`);
  }
  for (const key of added) {
    assert.equal(typeof en.signupOptions[key], "string", `EN lacks ${key}`);
    assert.equal(typeof hu.signupOptions[key], "string", `HU lacks ${key}`);
  }
  assert.deepEqual(Object.keys(en.signupOptions).sort(), Object.keys(hu.signupOptions).sort());
});

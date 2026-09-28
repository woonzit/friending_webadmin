import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ADMIN_ACTIONS } from "../lib/adminActions.ts";

test("profile photo moderation is an explicit authenticated admin capability", () => {
  assert.ok(ADMIN_ACTIONS.includes("moderation_pic_list"));
  assert.ok(ADMIN_ACTIONS.includes("moderation_image_action"));
});

test("photo moderation accepts legacy relative cache paths but restricts their public host", async () => {
  const source = await readFile(new URL("../app/(dashboard)/photo-moderation/page.tsx", import.meta.url), "utf8");
  assert.match(source, /avatarUrl\(value\)/);
  assert.match(source, /parsed\.hostname === "img\.friending\.co"/);
  assert.match(source, /image_action: action/);
  assert.match(source, /moderation_scan/);
});

test("registered-user galleries expose moderation status without client-side decisions", async () => {
  const source = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  // The closed status vocabulary moved into the projection when the page stopped casting Core's
  // payload; the page still renders the status and still makes no decision of its own.
  const parser = await readFile(new URL("../lib/userDetail.ts", import.meta.url), "utf8");
  assert.match(parser, /MOD_STATUSES = \["accepted", "pending", "denied"\]/);
  assert.match(source, /imageStatusPending/);
  assert.match(source, /href="\/photo-moderation"/);
  // The gallery must keep reading the server's verdict rather than deriving one from scan scores.
  assert.doesNotMatch(source, /adult|violence|racy|likelihood/i);
});

test("the queue ignores stale loads, offers write controls only to write roles and keeps receipts distinct", async () => {
  const source = await readFile(new URL("../app/(dashboard)/photo-moderation/page.tsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("../components/AdminImageEditor.tsx", import.meta.url), "utf8");
  const albums = await readFile(new URL("../components/UserAlbumsPanel.tsx", import.meta.url), "utf8");
  // Viewer and unknown roles fail closed: the footer renders only after admin_me proved a write role.
  assert.match(source, /isAdminWriteRole\(response.role\)/);
  assert.match(source, /canWrite \? <footer>/);
  assert.match(source, /if \(busy \|\| !canWrite\) return;/);
  assert.match(source, /window.confirm\(t\("rejectConfirm"\)\)/);
  // Only the newest queue request may settle the list, and the tabs cannot change mid-action.
  assert.match(source, /const generation = \+\+loadGeneration.current;/);
  assert.match(source, /if \(generation !== loadGeneration.current\) return;/);
  assert.match(source, /\}, \[scope\]\);/);
  assert.doesNotMatch(source, /items\.length, scope/);
  assert.match(source, /disabled=\{Boolean\(busy\) \|\| Boolean\(editing\)\}/);
  for (const mode of ["replace", "square"]) assert.ok(source.includes(`mode: "${mode}"`));
  for (const action of ["admin_get_image_data", "admin_replace_image", "set_image_square_crop"]) {
    assert.ok(ADMIN_ACTIONS.includes(action as typeof ADMIN_ACTIONS[number]));
    assert.ok(editor.includes(`adminCall("${action}"`));
  }
  // A square save neither overwrites nor approves the picture, so it has its own receipt.
  assert.match(source, /editing.mode === "square" \? "squareSaved" : "saved"/);
  assert.match(albums, /edited === "square" \? "squareSaved" : "saved"/);
  // Square mode refuses to frame without Core's original dimensions instead of guessing from the bitmap.
  assert.match(editor, /setLoadError\("image-dimensions-unknown"\)/);
  assert.match(editor, /savingRef.current\) return;/);
});

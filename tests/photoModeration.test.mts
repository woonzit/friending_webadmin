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

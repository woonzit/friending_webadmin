import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ADMIN_ACTIONS } from "../lib/adminActions.ts";

test("profile hub administration exposes only explicit allow-listed actions", () => {
  for (const action of [
    "user_profile_albums",
    "admin_delete_profile_album_image",
    "profile_location_policies",
    "save_profile_location_policy",
    "delete_profile_location_policy",
  ]) assert.ok(ADMIN_ACTIONS.includes(action as never));
});

test("profile location administration supports global and country-specific radius policies", async () => {
  const source = await readFile(new URL("../app/(dashboard)/profile-location/page.tsx", import.meta.url), "utf8");
  assert.match(source, /save_profile_location_policy/);
  assert.match(source, /delete_profile_location_policy/);
  assert.match(source, /countryCode/);
  assert.match(source, /globalDistance/);
  assert.match(source, /countryActive/);
  assert.match(source, /editingCountry/);
  assert.match(source, /common\("edit"\)/);
  assert.match(source, /alert-error/);
});

test("registered user administration can inspect and delete images from every album scope", async () => {
  const panel = await readFile(new URL("../components/UserAlbumsPanel.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  assert.match(panel, /user_profile_albums/);
  assert.match(panel, /admin_delete_profile_album_image/);
  assert.match(panel, /private_album/);
  assert.match(detail, /UserAlbumsPanel/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";

test("the server owns the gallery selector on detail and moderation calls", () => {
  for (const action of ["dates_activity_detail", "dates_moderation_evidence", "dates_moderation_resolve"]) {
    assert.equal(withDatesAdminContract(action, { dates_event_media_contract_version: 999 }).dates_event_media_contract_version, 1);
  }
  assert.equal(withDatesAdminContract("admin_me", {}).dates_event_media_contract_version, undefined);
  for (const action of ["dates_event_intake_publish", "dates_event_research_run_list", "dates_configuration", "dates_event_icons"]) {
    assert.equal(withDatesAdminContract(action, {}).dates_event_media_contract_version, undefined);
  }
});

test("activity gallery projection preserves every photo and excludes storage metadata", () => {
  const photos = ["one", "two"].map(id => ({ id, url: `https://img.friending.co/${id}.jpg`, moderation_state: "approved", storage_path: "/private/path" }));
  const body = projectDatesAdminBody("dates_activity_detail", { success: true, activity: { photos } }) as { activity: { photos: unknown[] } };
  assert.deepEqual(body.activity.photos, photos.map(({ storage_path: _, ...photo }) => photo));
});

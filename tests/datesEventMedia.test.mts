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

test("gallery captions name the moderation state in the page's language and never end in a separator", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NextIntlClientProvider } = await import("next-intl");
  const { default: DatesEventPhotos } = await import("../components/DatesEventPhotos.tsx");
  const { readFileSync } = await import("node:fs");
  const photo = (id: string, moderation_state?: unknown) => ({ id, url: `https://img.friending.co/api/cache/dates/${id}.jpg`, ...(moderation_state === undefined ? {} : { moderation_state }) });
  const source = { photos: [photo("one", "approved"), photo("two", "pending"), photo("three", "rejected"), photo("four", "removed"), photo("five", "appealed"),
    photo("six"), photo("seven", "quarantined"), { id: "eight", url: "http://img.friending.co/eight.jpg", moderation_state: "approved" }] };
  const captions = (locale: "en" | "hu", value: unknown) => {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const markup = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" }, createElement(DatesEventPhotos, { source: value })));
    return [...markup.matchAll(/<figcaption>(.*?)<\/figcaption>/g)].map((match) => match[1]);
  };
  assert.deepEqual(captions("en", source), ["Featured photo · Approved", "Photo 2 · Pending", "Photo 3 · Rejected", "Photo 4 · Removed", "Photo 5 · Appealed", "Photo 6", "Photo 7"]);
  assert.deepEqual(captions("hu", source), ["Kiemelt kép · Jóváhagyva", "2. kép · Függőben", "3. kép · Elutasítva", "4. kép · Eltávolítva", "5. kép · Fellebbezve", "6. kép", "7. kép"]);
  // An activity of an older Core (one `photo`, no gallery) and one without any photo.
  assert.deepEqual(captions("hu", { photo: photo("legacy", "approved") }), ["Kiemelt kép · Jóváhagyva"]);
  for (const empty of [{}, { photos: [] }, { photo: null }, null, "x", [photo("a", "approved")]]) assert.deepEqual(captions("en", empty), []);
});

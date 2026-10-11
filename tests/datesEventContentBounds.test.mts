import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventContentPage, type EventContentKind } from "../lib/datesEventContent.ts";

// DERIVED rows, not new genuine corpus bodies. Core validates these texts in
// graphemes (DatesWallPolicy, DatesChatPolicy, DatesReviewPolicy), then serves
// live text and removalSnapshot.text verbatim in DatesEventContentAdminService.
const body = (file: string, corpus = "dates_host_moderation_admin_wire") => JSON.parse(
  readFileSync(new URL(`./fixtures/${corpus}/${file}.json`, import.meta.url), "utf8"),
);
const examples = [
  { kind: "wall_post", limit: 4000, live: "admin-event-content-wall-posts", kept: "admin-event-content-wall-posts" },
  { kind: "wall_comment", limit: 1000, live: "admin-event-content-wall-comments", kept: "admin-event-content-wall-comments-host-erased" },
  { kind: "message", limit: 2000, live: "admin-event-content-messages", kept: "admin-event-content-messages" },
] as const;
const decode = (value: any) => eventContentPage(value, value.activity_id, value.kind as EventContentKind);

for (const sample of examples) for (const surface of ["live", "kept"] as const) {
  for (const [name, character] of [["family emoji", "👨‍👩‍👧‍👦"], ["decomposed accents", "a\u0301"], ["flags", "🇭🇺"]] as const) {
    test(`${sample.kind} ${surface} text preserves ${sample.limit} ${name} and refuses one extra grapheme`, () => {
      const page = body(sample[surface]);
      const index = page.items.findIndex((row: any) => surface === "kept" ? row.host_removed !== null : row.state === "active");
      assert.ok(index >= 0, "non-vacuous matching row");
      const row = page.items[index];
      const text = character.repeat(sample.limit);
      if (surface === "kept") row.host_removed.text = text;
      else row.text = text;
      const read = decode(page);
      assert.ok(read, "Core-valid content must not reject the entire page");
      assert.equal(surface === "kept" ? read.items[index].host_removed?.text : read.items[index].text, text, "evidence is never truncated");
      if (surface === "kept") row.host_removed.text += character;
      else row.text += character;
      assert.equal(decode(page), null, "the producer's grapheme bound still holds");
    });
  }
}

test("a live link row has no served link field or URL-length gate; its text uses the post bound", () => {
  const page = body("admin-event-content-wall-posts");
  const row = page.items.find((item: any) => item.state === "active");
  row.content_kind = "link";
  row.text = "👨‍👩‍👧‍👦".repeat(4000);
  const read = decode(page);
  assert.ok(read);
  assert.equal(Object.hasOwn(read.items.find(item => item.id === row.id)!, "link"), false,
    "DatesEventContentAdminService::row does not serve live links; do not invent one");
});

test("a review awaiting moderation uses Core's 280-grapheme public-note boundary", () => {
  const page = body("admin-event-reviews", "dates_event_content_wire");
  const row = page.items.find((item: any) => item.state === "pending");
  assert.ok(row);
  row.text = "a\u0301".repeat(280);
  assert.equal(decode(page)?.items.find(item => item.id === row.id)?.text, row.text);
  row.text += "a\u0301";
  assert.equal(decode(page), null);
});

// Core accepts at most 2,048 raw UTF-8 bytes, then percent-encodes non-ASCII
// path/query bytes. These outputs were independently reproduced by its real
// SafeExternalFetch::canonicalUrl, including IDNA and the inserted slash.
for (const [name, raw, stored] of [
  ["Unicode path", "https://example.com/" + "é".repeat(1000), "https://example.com/" + "%C3%A9".repeat(1000)],
  ["maximum raw bytes with IDNA and a query-only path", "https://é.é?" + "é".repeat(1017), "https://xn--9ca.xn--9ca/?" + "%C3%A9".repeat(1017)],
] as const) test(`a kept ${name} is bounded after Core canonicalization, not before it`, () => {
  assert.ok(Buffer.byteLength(raw, "utf8") <= 2048);
  assert.ok(stored.length > 2048);
  const page = body("admin-event-content-wall-posts");
  const index = page.items.findIndex((row: any) => row.host_removed?.link !== null && row.host_removed?.link !== undefined);
  assert.ok(index >= 0);
  page.items[index].host_removed.link.url = stored;
  assert.equal(decode(page)?.items[index].host_removed?.link?.url, stored);
});

test("the canonical stored-link ceiling remains finite and bad schemes/controls stay refused", () => {
  // Safe conservative upper bound: https prefix + separately bounded IDNA
  // host + 3x all remaining raw bytes + a possibly inserted slash.
  const maximum = 8 + 253 + 3 * (2048 - 8) + 1;
  for (const url of ["https://example.com/" + "a".repeat(maximum), "http://example.com/x", "javascript:alert(1)", "https://example.com/a\nb"]) {
    const page = body("admin-event-content-wall-posts");
    const row = page.items.find((item: any) => item.host_removed?.link);
    assert.ok(row);
    row.host_removed.link.url = url;
    assert.equal(decode(page), null);
  }
});

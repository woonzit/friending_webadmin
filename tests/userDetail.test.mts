import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { userDetail } from "../lib/userDetail.ts";

/** Shaped like a real `user_detail` response, including the fields the console must not carry. */
const response = {
  success: true,
  profile: {
    uid: 12345,
    display_name: "Example Member",
    user_name: "example",
    codename: "EX-1",
    about_me: "About text",
    headline: "Headline",
    age: 29,
    birthyear: 1997,
    generation: "millennial",
    created: 1700000000,
    last_seen: 1772366400,
    phone_e164: "+3612345678",
    email: "member@example.invalid",
    email_is_real: true,
    apple_id: "001234.abcdef.0001",
    height_cm: 178,
    avatar_thumb: "https://img.friending.co/a.jpg",
    last_location: { city: "Budapest", region: "Pest", country: "Hungary", country_code: "HU", location_name: "", lat: 47.4979, lng: 19.0402 },
    hometown: { city: "Szeged", region: "Csongrád", country: "Hungary", country_code: "HU", location_name: "", lat: 46.253, lng: 20.1414 },
    facebook_id: "SENTINEL-FACEBOOK", instagram: "SENTINEL-INSTAGRAM",
    twitter: "SENTINEL-TWITTER", tiktok: "SENTINEL-TIKTOK",
    birthday_stamp: 852076800, birthmonth: 1, birthday: 1,
  },
  images: [
    { image_id: "img1", thumb: "https://img.friending.co/t1.jpg", full: "https://img.friending.co/f1.jpg", is_avatar: true, mod_status: "pending", moderation_scan: { adult: "VERY_LIKELY" } },
  ],
  about_me: [{ id: "a1", value: "Coffee" }],
  into_tags: [{ key: "hiking", name: "Hiking" }],
  my_life_tags: [], sport_tags: [], interest_tags: [{ key: "chess", name: "Chess" }],
};

test("the projection carries exactly what the page renders", () => {
  const parsed = userDetail(response);
  assert.ok(parsed);
  assert.equal(parsed.profile.uid, 12345);
  assert.equal(parsed.profile.last_location?.city, "Budapest");
  assert.equal(parsed.profile.hometown?.city, "Szeged");
  assert.deepEqual(parsed.tags, ["Coffee", "Hiking", "Chess"]);
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0]?.mod_status, "pending");
});

test("coordinates never enter the projection, in either location block", () => {
  const parsed = userDetail(response);
  assert.ok(parsed);
  const serialized = JSON.stringify(parsed);
  for (const leak of ["47.4979", "19.0402", "46.253", "20.1414", "lat", "lng"]) {
    assert.ok(!serialized.includes(leak), `${leak} reached the projection`);
  }
  // The location object itself survives — only its coordinates are dropped.
  assert.deepEqual(Object.keys(parsed.profile.last_location ?? {}).sort(),
    ["city", "country", "country_code", "location_name", "region"]);
});

test("identifiers the page never renders are dropped, and apple id becomes a boolean", () => {
  const parsed = userDetail(response);
  assert.ok(parsed);
  const serialized = JSON.stringify(parsed);
  // Sentinels are deliberately long: a two-character marker collides with ordinary content
  // (the first attempt used "tt", which matches the "https" in every image URL).
  for (const leak of ["001234.abcdef.0001", "SENTINEL-FACEBOOK", "SENTINEL-INSTAGRAM",
                      "SENTINEL-TWITTER", "SENTINEL-TIKTOK", "852076800"]) {
    assert.ok(!serialized.includes(leak), `${leak} reached the projection`);
  }
  // The page shows only yes/no, so the identifier itself is never carried.
  assert.equal(parsed.profile.has_apple_id, true);
  assert.equal(userDetail({ ...response, profile: { ...response.profile, apple_id: "" } })?.profile.has_apple_id, false);
  // Per-image scan detail is not the gallery's business; the server verdict is.
  assert.ok(!serialized.includes("VERY_LIKELY"));
  assert.ok(!serialized.includes("is_avatar"));
});

test("a malformed payload is an error rather than a blank page", () => {
  assert.equal(userDetail(null), null);
  assert.equal(userDetail({}), null);
  assert.equal(userDetail({ profile: {} }), null);
  assert.equal(userDetail({ profile: { uid: 0 } }), null);
  assert.equal(userDetail({ profile: { uid: -3 } }), null);
  assert.equal(userDetail({ profile: { uid: "abc" } }), null);
  assert.equal(userDetail({ profile: { uid: 1.5 } }), null);
  assert.equal(userDetail({ ...response, images: "not an array" }), null);
  assert.equal(userDetail({ ...response, into_tags: {} }), null);
});

test("tolerated shapes are normalised rather than refused", () => {
  // Core returns numeric ids as strings on some surfaces; accept and normalise to a number so every
  // consumer sees one type.
  assert.equal(userDetail({ profile: { uid: "12345" } })?.profile.uid, 12345);
  // Optional blocks may legitimately be absent.
  const minimal = userDetail({ profile: { uid: 7 } });
  assert.equal(minimal?.profile.uid, 7);
  assert.deepEqual(minimal?.images, []);
  assert.deepEqual(minimal?.tags, []);
  assert.equal(minimal?.push_channels, null);
  assert.equal(minimal?.profile.last_location, null);
  // An all-empty location is null rather than a row of em dashes.
  assert.equal(userDetail({ profile: { uid: 7, hometown: { city: "", region: "" } } })?.profile.hometown, null);
  // An unknown moderation status falls back to the safe default rather than rendering undefined.
  assert.equal(userDetail({ profile: { uid: 7 }, images: [{ image_id: "i", mod_status: "wat" }] })?.images[0]?.mod_status, "accepted");
  // A non-finite number renders as an em dash, never as NaN.
  assert.equal(userDetail({ profile: { uid: 7, age: "old" } })?.profile.age, 0);
});

test("the page projects instead of casting, and states why", async () => {
  const page = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /as unknown as DetailData/);
  assert.match(page, /userDetail\(response, PUSH_MODE_CONTRACT_READY, VERIFICATION_CONTRACT_READY\)/);
  const parser = await readFile(new URL("../lib/userDetail.ts", import.meta.url), "utf8");
  assert.match(parser, /coordinates/i);
});

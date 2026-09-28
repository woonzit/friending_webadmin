import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import UserModerationInsight, { UserModerationInsightView } from "../components/UserModerationInsight.tsx";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  INSIGHT_FLAGS,
  INSIGHT_METHODS,
  INSIGHT_PLATFORMS,
  normalizeUserModerationInsightProxyBody,
  userModerationInsight,
} from "../lib/userModerationInsight.ts";

/**
 * Core's wire capture for P-074, copied byte-identical from the Core commit that
 * introduced it (7ea2766a, the last commit touching the file on Core main; its
 * `admin_member_insight_test.php --write` produces it). It is the exact envelope
 * the controller returns for the assembled example, minus the legacy trio
 * (`message`, `status`, `can_send`) that `Webadmin::noStoreReply` adds on the wire.
 */
const FIXTURE = new URL("./fixtures/user_moderation_insight_wire.json", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "7ea2766a034efc1157989587a3783f3949f182e0";
const FIXTURE_SHA256 = "fcb13743a65c8f652bafa42c78a1f53494eae4946edc3258d7844151c65dfd52";
const UID = 900;

type Json = Record<string, any>;

async function capture(): Promise<Json> {
  return JSON.parse(await readFile(FIXTURE, "utf8")) as Json;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function mutated(change: (data: Json) => void): Promise<Json> {
  const body = clone(await capture());
  change(body.data);
  return body;
}

async function refused(change: (data: Json) => void, why: string): Promise<void> {
  assert.equal(userModerationInsight(await mutated(change), UID), null, why);
}

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function render(locale: "en" | "hu", element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale],
    timeZone: "UTC",
    // A missing or malformed message is a test failure, never a rendered key.
    onError: (error: Error) => { throw error; },
  }, element));
}

test("the vendored capture is byte-identical to Core's", async () => {
  const bytes = await readFile(FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/user_moderation_insight_wire.json must stay byte-identical to Core ${FIXTURE_SOURCE_COMMIT}`);
  const body = JSON.parse(bytes.toString("utf8")) as Json;
  assert.deepEqual(Object.keys(body), ["success", "status_code", "data"]);
  assert.deepEqual(Object.keys(body.data), [
    "schema_version", "uid", "signup", "last_login", "last_seen_at", "logins",
    "shared_addresses", "profile", "flags", "provided",
  ]);
  // Friending's adaptation: no dating identity answers and no intents layers.
  assert.deepEqual(Object.keys(body.data.provided), ["interests", "gender", "visible_to", "about_me"]);
  assert.doesNotMatch(bytes.toString("utf8"), /orientation|relationship_status|gender_detail|intents|phone_gate/u);
});

test("the strict decoder accepts Core's capture, with and without the wire trio", async () => {
  const body = await capture();
  const parsed = userModerationInsight(body, UID);
  assert.ok(parsed);
  // Nothing is dropped, renamed or invented: the projection is the capture.
  assert.deepEqual(parsed, body.data);
  assert.deepEqual(userModerationInsight({ ...body, message: 200, status: 200, can_send: 0 }, UID), body.data);
});

test("the envelope must be Core's success for the requested member", async () => {
  const body = await capture();
  assert.equal(userModerationInsight(body, 901), null, "another member's insight");
  assert.equal(userModerationInsight({ ...body, success: "true" }, UID), null);
  assert.equal(userModerationInsight({ ...body, status_code: 202 }, UID), null);
  for (const error of [
    { success: false, status_code: 422, error: "uid-invalid" },
    { success: false, status_code: 404, error: "member-not-found" },
    { success: false, status_code: 503, error: "moderation-insight-unavailable" },
    { success: false, status_code: 403, error: "admin-revoked" },
  ]) {
    assert.equal(userModerationInsight(error, UID), null, error.error);
  }
  assert.equal(userModerationInsight(null, UID), null);
  assert.equal(userModerationInsight({ ...body, data: [] }, UID), null);
  await refused((data) => { data.schema_version = 2; }, "unknown schema");
});

test("every object inside data is closed: an unknown or missing key refuses", async () => {
  const paths: Array<[string, (data: Json) => Json]> = [
    ["data", (data) => data],
    ["signup", (data) => data.signup],
    ["ip_geo", (data) => data.signup.ip_geo],
    ["chosen_location", (data) => data.signup.chosen_location],
    ["last_login", (data) => data.last_login],
    ["logins", (data) => data.logins],
    ["by_platform", (data) => data.logins.by_platform],
    ["recent[0]", (data) => data.logins.recent[0]],
    ["shared_addresses", (data) => data.shared_addresses],
    ["accounts[0]", (data) => data.shared_addresses.accounts[0]],
    ["profile", (data) => data.profile],
    ["provided", (data) => data.provided],
    ["interests[0]", (data) => data.provided.interests[0]],
  ];
  for (const [name, at] of paths) {
    await refused((data) => { at(data).phone_number = "+3620"; }, `extra key in ${name}`);
    await refused((data) => {
      const row = at(data);
      delete row[Object.keys(row)[0]!];
    }, `missing key in ${name}`);
  }
});

test("closed vocabularies: flags, methods and platforms are known, unique and in Core's order", async () => {
  await refused((data) => { data.flags.push("new-signal"); }, "unknown flag");
  await refused((data) => { data.flags = ["empty-about", "shared-signup-ip"]; }, "flags out of order");
  await refused((data) => { data.flags = ["empty-about", "empty-about"]; }, "repeated flag");
  await refused((data) => { data.signup.methods = ["sms"]; }, "unknown method");
  await refused((data) => { data.signup.methods = ["google", "email"]; }, "methods out of order");
  await refused((data) => { data.signup.platform = "windows"; }, "unknown platform");
  await refused((data) => { data.logins.recent[1].platform = "IOS"; }, "platform casing");
  await refused((data) => { data.shared_addresses.accounts[0].platform = ""; }, "empty platform");
  assert.deepEqual(INSIGHT_PLATFORMS, ["web", "ios", "android", "unknown"]);
  assert.deepEqual(INSIGHT_METHODS, ["email", "phone", "apple", "google", "facebook"]);
  assert.equal(INSIGHT_FLAGS.length, 7);
});

test("values keep Core's types and code-point bounds", async () => {
  await refused((data) => { data.signup.at = "1000000"; }, "string time");
  await refused((data) => { data.last_seen_at = -1; }, "negative time");
  await refused((data) => { data.logins.total = 3.5; }, "fractional count");
  await refused((data) => { data.signup.email_verified = 1; }, "numeric boolean");
  await refused((data) => { data.shared_addresses.accounts[0].demo = "false"; }, "string boolean");
  await refused((data) => { data.shared_addresses.accounts[0].display_name = "x".repeat(81); }, "display name over 80");
  await refused((data) => { data.provided.about_me = "x".repeat(3001); }, "about over 3000");
  await refused((data) => { data.provided.gender = "x".repeat(41); }, "gender over 40");
  await refused((data) => { data.signup.chosen_location.source = "x".repeat(33); }, "source over 32");
  await refused((data) => { data.last_login.app_build = "x".repeat(25); }, "build over 24");
  await refused((data) => { data.provided.about_me = "Hi\u0007there"; }, "control character Core strips");
  await refused((data) => { data.signup.ip_geo.country_code = "us"; }, "lower-case country code");
  await refused((data) => { data.signup.chosen_location.country_code = "HUN"; }, "three-letter country code");
  await refused((data) => { data.provided.interests[0].key = ""; }, "empty interest key");
  // Bounds count code points, as Core's mb_substr does.
  assert.ok(userModerationInsight(await mutated((data) => {
    data.shared_addresses.accounts[0].display_name = "😀".repeat(80);
    data.provided.about_me = "é".repeat(3000);
  }), UID));
});

test("addresses are Core's validated IPs or empty", async () => {
  for (const address of ["256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "example.org", "1:2:3", "1::2::3", "::g", " 84.0.76.105"]) {
    await refused((data) => { data.logins.recent[0].ip = address; data.last_login.ip = address; }, address);
  }
  for (const address of ["", "84.0.76.105", "0.0.0.0", "2001:db8::1", "::", "::ffff:1.2.3.4", "2001:0DB8:0:0:0:0:0:1"]) {
    assert.ok(userModerationInsight(await mutated((data) => {
      data.logins.recent[0].ip = address;
      data.last_login.ip = address;
    }), UID), address);
  }
});

test("what Core's assembly makes true by construction is checked", async () => {
  await refused((data) => { data.last_login.at = 1; }, "the last sign-in is the newest recent row");
  await refused((data) => { data.last_login = null; }, "a member with sign-ins has a last sign-in");
  await refused((data) => { data.logins.by_platform.web = 1; }, "the platform split covers the scanned rows");
  await refused((data) => { data.logins.total = 2; }, "the total covers the scanned rows");
  await refused((data) => { data.logins.after_signup = 4; }, "return visits are scanned rows");
  await refused((data) => { data.logins.recent.pop(); }, "recent rows are the newest scanned, up to 15");
  await refused((data) => { data.shared_addresses.seen_on_any_address = 3; }, "all seen accounts are listed up to 20");
  await refused((data) => { data.shared_addresses.registered_from_signup_ip = 3; }, "signup-address accounts are seen accounts");
  await refused((data) => { data.shared_addresses.accounts[1].uid = 901; }, "an account appears once");
  await refused((data) => { data.shared_addresses.accounts[0].uid = UID; }, "the member does not share with itself");
  await refused((data) => { data.shared_addresses.accounts[0].uid = 0; }, "account uids are positive");
  await refused((data) => { data.provided.interests[1].key = "coffee"; }, "interest tags are unique");
  await refused((data) => { data.profile.interests = 1; }, "the stored count covers the shown tags");
  await refused((data) => { data.signup.ip = ""; }, "no signup address means no signup location and no same-address signup");
  const tooMany = await mutated((data) => {
    const row = data.shared_addresses.accounts[0];
    data.shared_addresses.accounts = Array.from({ length: 21 }, (_, index) => ({ ...row, uid: 1000 + index }));
    data.shared_addresses.seen_on_any_address = 21;
  });
  assert.equal(userModerationInsight(tooMany, UID), null, "Core lists at most 20 accounts");
});

test("a legacy-imported member without addresses or sign-ins reads as empty facts", () => {
  // AdminMemberInsightService degrades a member without register_ip or userlogin rows.
  const body = {
    success: true,
    status_code: 200,
    data: {
      schema_version: 1,
      uid: 8,
      signup: {
        at: 0,
        platform: "unknown",
        ip: "",
        ip_geo: null,
        chosen_location: { city: "", country: "", country_code: "", source: "" },
        legal_source: "",
        email_verified: false,
        methods: [],
      },
      last_login: null,
      last_seen_at: 0,
      logins: {
        total: 0, after_signup: 0, distinct_addresses: 0, distinct_countries: 0,
        by_platform: { web: 0, ios: 0, android: 0, unknown: 0 }, recent: [], scanned: 0,
      },
      shared_addresses: { registered_from_signup_ip: 0, seen_on_any_address: 0, accounts: [] },
      profile: { interests: 0, interests_maximum: 10, about_length: 0 },
      flags: ["empty-about", "no-return-after-signup"],
      provided: { interests: [], gender: "", visible_to: "", about_me: "" },
    },
    message: 200,
    status: 200,
    can_send: 0,
  };
  const parsed = userModerationInsight(body, 8);
  assert.ok(parsed);
  assert.deepEqual(parsed, body.data);
  for (const locale of ["en", "hu"] as const) {
    const html = render(locale, createElement(UserModerationInsightView, { data: parsed }));
    assert.ok(html.includes(MESSAGES[locale].userInsight.logins.never));
    assert.ok(html.includes(MESSAGES[locale].userInsight.shared.none));
    assert.ok(html.includes(MESSAGES[locale].userInsight.recent.none));
    assert.doesNotMatch(html, /<table/u);
  }
});

test("the bridge forwards exactly one canonical uid to this action", () => {
  assert.deepEqual(normalizeUserModerationInsightProxyBody("user_moderation_insight", { uid: 900 }), { uid: 900 });
  for (const body of [
    {},
    { uid: "900" },
    { uid: 0 },
    { uid: -1 },
    { uid: 1.5 },
    { uid: 2_147_483_648 },
    { uid: 900, lang: "hu" },
    { uid: 900, admin_email: "x@example.test" },
  ]) {
    assert.equal(normalizeUserModerationInsightProxyBody("user_moderation_insight", body), null, JSON.stringify(body));
  }
  assert.equal(normalizeUserModerationInsightProxyBody("user_detail", { uid: "x" }), undefined);
});

test("the insight is an allow-listed read any active administrator may run", async () => {
  assert.equal(ADMIN_ACTIONS.filter((action) => action === "user_moderation_insight").length, 1);
  assert.equal(adminActionAccess("user_moderation_insight"), "read");
  for (const role of ["viewer", "admin", "owner"]) {
    assert.equal(isAdminActionAuthorized("user_moderation_insight", adminPrincipalFrom({ role })), true, role);
  }
  const route = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /normalizeUserModerationInsightProxyBody\(action, body\)/);
  assert.match(route, /if \(normalizedInsightBody === null\) \{\s*return bridgeError\("invalid-input", 400\);/);
  assert.match(route, /const NO_STORE_HEADERS = \{ "Cache-Control": "no-store" \} as const;/);
});

test("the addresses never reach a log, storage or anything but the screen", async () => {
  const sources = await Promise.all([
    "../components/UserModerationInsight.tsx",
    "../lib/userModerationInsight.ts",
    "../app/api/admin/[action]/route.ts",
    "../lib/adminClient.ts",
    "../lib/core.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /console\.|sendBeacon|localStorage|sessionStorage|indexedDB|navigator\.clipboard|analytics|gtag|posthog|sentry/iu);
  }
  const component = sources[0]!;
  // One read, through the same-origin bridge only.
  assert.equal([...component.matchAll(/adminCall\(/g)].length, 1);
  assert.match(component, /adminCall\("user_moderation_insight", \{ uid \}, controller\.signal\)/);
  assert.doesNotMatch(component, /fetch\(/);
});

test("the panel is collapsed by default, loads only when opened and forgets on close", async () => {
  const component = await readFile(new URL("../components/UserModerationInsight.tsx", import.meta.url), "utf8");
  assert.match(component, /const \[open, setOpen\] = useState\(false\);/);
  assert.match(component, /if \(open\) void load\(\);\s*return \(\) => \{\s*inFlight\.current\?\.abort\(\);\s*setData\(null\);/);
  assert.match(component, /aria-expanded=\{open\}/);
  assert.match(component, /<Link href=\{`\/users\/\$\{account\.uid\}`\} prefetch=\{false\}>/);
  assert.equal([...component.matchAll(/<Link /g)].length, [...component.matchAll(/prefetch=\{false\}/g)].length);
  const page = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<UserModerationInsight key=\{`moderation-insight-\$\{uid\}`\} uid=\{uid\} \/>/);

  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].userInsight;
    const html = render(locale, createElement(UserModerationInsight, { uid: UID }));
    assert.ok(html.includes(copy.title));
    assert.ok(html.includes(copy.sensitive), "the sensitive-data note shows while collapsed");
    assert.match(html, /aria-expanded="false"/);
    assert.ok(html.includes(`>${copy.show}<`));
    assert.doesNotMatch(html, /\d+\.\d+\.\d+\.\d+|<table/u, "nothing is loaded or shown collapsed");
  }
});

test("the opened view renders the capture in both locales with member links", async () => {
  const data = userModerationInsight(await capture(), UID)!;
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].userInsight;
    const html = render(locale, createElement(UserModerationInsightView, { data }));
    for (const address of ["50.39.166.245", "84.0.76.105"]) assert.ok(html.includes(address), address);
    assert.match(html, /href="\/users\/901"/);
    // Shared-account links do not prefetch member pages when the panel opens.
    assert.equal([...html.matchAll(/href="\/users\/90[12]"/g)].length, 2);
    assert.match(html, /href="\/users\/902"/);
    assert.doesNotMatch(html, /\/preview/u);
    for (const flag of data.flags) {
      assert.ok(html.includes(copy.flags[flag]), flag);
      assert.doesNotMatch(html, new RegExp(`>${flag}<`, "u"), "a flag renders as copy, never its key");
    }
    assert.ok(html.includes("Hillsboro, United States"));
    assert.ok(html.includes("Budapest, Hungary"));
    assert.ok(html.includes(copy.methods.google));
    assert.ok(html.includes(copy.shared.demo));
    assert.ok(html.includes("Coffee"));
    assert.match(html, /class="tag insight-tag-raw"[^>]*>my-own-tag</u);
    assert.ok(html.includes("female · both"));
    assert.ok(html.includes("Hi there"));
    assert.equal([...html.matchAll(/<table/g)].length, 2);
    assert.doesNotMatch(html, /<button|<input|<form/u, "the view is read-only");
  }
});

test("EN and HU carry every flag, platform and method Core can send", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].userInsight;
    assert.deepEqual(Object.keys(copy.flags), [...INSIGHT_FLAGS]);
    assert.deepEqual(Object.keys(copy.platforms), [...INSIGHT_PLATFORMS]);
    assert.deepEqual(Object.keys(copy.methods), [...INSIGHT_METHODS]);
  }
});

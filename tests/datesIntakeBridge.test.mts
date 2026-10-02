import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { ADMIN_ACTION_ACCESS, adminPrincipalFrom, isAdminActionAllowed, isAdminBridgeActionAuthorized } from "../lib/adminActions.ts";
import {
  DATES_INTAKE_MEDIA_HEADERS, DATES_INTAKE_MAX_REQUEST_BYTES, serveDatesIntakeCreate, serveDatesIntakeMedia,
  type DatesIntakeBridgeDeps, type DatesIntakeBridgeFile,
} from "../lib/datesIntakeBridge.ts";
import {
  DATES_INTAKE_PROXY_ACTIONS, datesIntakeMediaUrl, datesIntakeProxyCapabilityAuthorized, normalizeDatesIntakeCreateFields,
  normalizeDatesIntakeProxyBody,
} from "../lib/datesIntakeAdmin.ts";

// The console's own side of the intake wire: the generic action bridge's
// closed shapes and capability mirror, and the two dedicated routes (flyer
// upload, flyer read) run as they are with the session and the Core transport
// injected. No server is mounted and no socket is opened.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const xin = (number: number) => "xin_" + number.toString(16).padStart(32, "0");
const email = "operator@example.test";
const CAPABILITIES = {
  support_viewer: ["dates_external_event_read"],
  moderator: ["dates_external_event_read", "dates_external_event_review"],
  administrator: ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage"],
};
const membership = (role: keyof typeof CAPABILITIES = "administrator") => ({ success: true, role: role === "support_viewer" ? "viewer" : "admin",
  dates: { email, role, rank: 40, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: CAPABILITIES[role] } });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);

function harness(answer: unknown = fixture("admin-create-text"), role: keyof typeof CAPABILITIES = "administrator") {
  const state = { session: { email } as { email: string } | null, member: { status: 200, data: membership(role) as unknown }, answer: { status: 200, data: answer },
    calls: [] as Array<{ action: string; payload: Record<string, unknown>; files?: DatesIntakeBridgeFile[]; timeout?: number }> };
  const deps: DatesIntakeBridgeDeps = {
    session: async () => state.session,
    core: async (action, payload, timeout) => { state.calls.push({ action, payload, timeout }); return action === "admin_me" ? state.member : state.answer; },
    coreFiles: async (action, payload, files, timeout) => { state.calls.push({ action, payload, files, timeout }); return state.answer; },
    requestId: () => "req-0000-0000-0001",
  };
  return { state, deps };
}
const sameOrigin = { origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" };
const headers = (values: Record<string, string | null>) => { const map = new Headers(); for (const [key, value] of Object.entries(values)) if (value !== null) map.set(key, value); return map; };

// ---------------------------------------------------------------- generic bridge

test("six intake routes travel as generic actions; creating an intake and reading a flyer cannot", () => {
  assert.deepEqual([...DATES_INTAKE_PROXY_ACTIONS], ["dates_event_intake_list", "dates_event_intake_detail", "dates_event_intake_lease",
    "dates_event_intake_reject", "dates_event_intake_publish", "dates_event_intake_usage"]);
  for (const action of DATES_INTAKE_PROXY_ACTIONS) assert.equal(isAdminActionAllowed(action), true);
  for (const action of ["dates_event_intake_create", "dates_event_intake_image", "dates_event_intake_merge", "dates_event_intake_List"])
    assert.equal(isAdminActionAllowed(action), false, action);
  const access = ADMIN_ACTION_ACCESS as Record<string, string>;
  for (const action of ["dates_event_intake_list", "dates_event_intake_detail", "dates_event_intake_usage"]) assert.equal(access[action], "dates_read");
  for (const action of ["dates_event_intake_lease", "dates_event_intake_reject", "dates_event_intake_publish"]) assert.equal(access[action], "dates_write");
  // The floor of the Dates ladder: a support viewer never reaches a command.
  const viewer = adminPrincipalFrom(membership("support_viewer"));
  assert.equal(isAdminBridgeActionAuthorized("dates_event_intake_lease", viewer, null), false);
  assert.equal(isAdminBridgeActionAuthorized("dates_event_intake_usage", viewer, null), true);
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /datesIntakeProxyCapabilityAuthorized\(action, membership\.data\) === false\) \{\s+return bridgeError\("dates-admin-capability-required", 403\)/);
  assert.match(route, /const intakeBody = normalizeDatesIntakeProxyBody\(action, body\);\s+if \(intakeBody === null\) return bridgeError\("invalid-input", 400\)/);
});

test("the bridge mirrors the one capability Core requires for each intake route", () => {
  const expected: Record<string, string> = { dates_event_intake_list: "moderator", dates_event_intake_detail: "moderator", dates_event_intake_lease: "moderator",
    dates_event_intake_reject: "moderator", dates_event_intake_publish: "administrator", dates_event_intake_usage: "support_viewer" };
  const order = ["support_viewer", "moderator", "administrator"] as const;
  for (const action of DATES_INTAKE_PROXY_ACTIONS) for (const role of order)
    assert.equal(datesIntakeProxyCapabilityAuthorized(action, membership(role)), order.indexOf(role) >= order.indexOf(expected[action] as typeof order[number]), `${action} as ${role}`);
  // Core's genuine capability lists agree: the moderator body carries review and not manage, the usage body read alone.
  assert.equal(fixture("admin-list-moderator").capabilities.includes("dates_external_event_manage"), false);
  // A global owner without a Dates block is not a reviewer, and another domain's action is not this mirror's business.
  assert.equal(datesIntakeProxyCapabilityAuthorized("dates_event_intake_list", { success: true, role: "owner" }), false);
  assert.equal(datesIntakeProxyCapabilityAuthorized("dates_external_event_list", membership()), undefined);
  assert.equal(datesIntakeProxyCapabilityAuthorized("dates_event_intake_create", membership()), undefined);
});

test("intake commands cross the bridge only in their closed shape", () => {
  const id = xin(1), key = "dates-intake-reject:00000000-0000-4000-8000-000000000001";
  // Queue: an empty filter is no filter; an empty page or limit is never forwarded (Core refuses a present-but-empty one).
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_list", { status: "", channel: "", page: 1, limit: 40 }), { page: 1, limit: 40 });
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_list", { status: "in_review", channel: "admin_draft", page: "2", limit: "3" }),
    { status: "in_review", channel: "admin_draft", page: 2, limit: 3 });
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_list", {}), {});
  for (const body of [{ status: "paused" }, { channel: "partner" }, { page: 0 }, { page: "" }, { limit: 101 }, { limit: "1.5" }, { query: "x" }, { admin_email: "a@b" }])
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_list", body), null, JSON.stringify(body));
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_detail", { intake_id: id }), { intake_id: id });
  for (const body of [{}, { intake_id: "xin_1" }, { intake_id: id, page: 1 }, { intake_id: id.toUpperCase() }])
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_detail", body), null);
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_usage", {}), {});
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_usage", { month: "" }), {});
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_usage", { month: "2026-09" }), { month: "2026-09" });
  for (const month of ["2026-13", "1999-01", "2026-9", "October"]) assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_usage", { month }), null);
  for (const action of ["claim", "heartbeat", "release"])
    assert.ok(normalizeDatesIntakeProxyBody("dates_event_intake_lease", { intake_id: id, action, expected_revision: 9 }));
  for (const body of [{ intake_id: id, action: "steal", expected_revision: 9 }, { intake_id: id, action: "claim", expected_revision: 0 },
    { intake_id: id, action: "claim", expected_revision: "9" }, { intake_id: id, action: "claim" }, { intake_id: id, action: "claim", expected_revision: 9, holder: "x@y" }])
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_lease", body), null, JSON.stringify(body));
  const reject = { intake_id: id, expected_revision: 9, reason_code: "duplicate", reason: "Already listed as another intake.", idempotency_key: key };
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_reject", reject), reject);
  for (const change of [{ reason_code: "boring" }, { reason: " " }, { reason: "x".repeat(1001) }, { idempotency_key: "short" }, { statement: { en: "Free text" } }])
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_reject", { ...reject, ...change }), null, JSON.stringify(Object.keys(change)));
  // Publishing: the P1 editor document with its four confirmations, the event's index and "last one" as real values.
  const prefill = fixture("admin-detail-in-review-official").intake.events[0].editor_input;
  const event = { ...prefill, confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } };
  const publish = { intake_id: id, intake_revision: 10, event_index: 0, complete: false, event, reason: "Source and public venue verified.", idempotency_key: key };
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_publish", publish), publish);
  for (const change of [{ event: prefill }, { event_index: "0" }, { event_index: 100 }, { complete: "false" }, { ai_assisted: false }, { external_event_id: "xev_" + "1".repeat(32) }])
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_publish", { ...publish, ...change }), null, JSON.stringify(Object.keys(change)));
  for (const key of ["intake_revision", "complete", "event_index", "reason", "idempotency_key"]) {
    const body: Record<string, unknown> = { ...publish }; delete body[key];
    assert.equal(normalizeDatesIntakeProxyBody("dates_event_intake_publish", body), null, key);
  }
  assert.equal(normalizeDatesIntakeProxyBody("dates_external_event_publish", publish), undefined, "another domain's action is left to its own guard");
});

// ---------------------------------------------------------------- create

function multipart(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) typeof value === "string" ? form.set(key, value) : form.set(key, value, "upload");
  return { headers: headers({ ...sameOrigin, "content-length": "4096" }), form: async () => form };
}
const KEY = "dates-intake-create:00000000-0000-4000-8000-000000000001";

test("create refuses a foreign origin, a guest, a revoked operator and a reviewer before anything reaches Core's create route", async () => {
  const fields = { kind: "text", text: "Fradi–Újpest szombaton a Groupama Arénában", locale: "hu", idempotency_key: KEY };
  for (const change of [{ origin: "https://attacker.example" }, { origin: null }, { "x-friending-admin-request": null }, { "sec-fetch-site": "cross-site" }]) {
    const h = harness(), request = multipart(fields);
    const reply = await serveDatesIntakeCreate({ ...request, headers: headers({ ...sameOrigin, "content-length": "4096", ...change }) }, h.deps);
    assert.equal(reply.status, 403); assert.equal(h.state.calls.length, 0);
  }
  const guest = harness(); guest.state.session = null;
  assert.equal((await serveDatesIntakeCreate(multipart(fields), guest.deps)).status, 401); assert.equal(guest.state.calls.length, 0);
  const revoked = harness(); revoked.state.member = { status: 403, data: { success: false, error: "admin-revoked" } };
  assert.equal((await serveDatesIntakeCreate(multipart(fields), revoked.deps)).status, 401);
  for (const role of ["moderator", "support_viewer"] as const) {
    const h = harness(undefined, role), reply = await serveDatesIntakeCreate(multipart(fields), h.deps);
    assert.deepEqual("json" in reply && reply.json, { success: false, status_code: 403, error: "dates-admin-capability-required" });
    assert.deepEqual(h.state.calls.map((call) => call.action), ["admin_me"]);
  }
  // A body larger than two flyers and their fields is refused from its declared length, before the session is even read.
  const big = harness(), request = multipart(fields);
  const reply = await serveDatesIntakeCreate({ ...request, headers: headers({ ...sameOrigin, "content-length": String(DATES_INTAKE_MAX_REQUEST_BYTES + 1) }) }, big.deps);
  assert.equal(reply.status, 413); assert.equal(big.state.calls.length, 0);
  assert.equal(DATES_INTAKE_MAX_REQUEST_BYTES, 21 * 1024 * 1024);
});

test("create forwards a link or a line of text as a form call with the server's own actor", async () => {
  const text = harness(fixture("admin-create-text"));
  const reply = await serveDatesIntakeCreate(multipart({ kind: "text", text: "  Fradi–Újpest szombaton a Groupama Arénában ", locale: "hu", idempotency_key: KEY }), text.deps);
  assert.equal(reply.status, 200);
  assert.deepEqual("json" in reply && reply.json, fixture("admin-create-text"));
  assert.equal(reply.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.deepEqual(text.state.calls[1], { action: "dates_event_intake_create", timeout: 20_000, payload: { admin_email: email, kind: "text", locale: "hu",
    idempotency_key: KEY, admin_request_id: "req-0000-0000-0001", text: "Fradi–Újpest szombaton a Groupama Arénában" } });
  const link = harness(fixture("admin-create-url"));
  await serveDatesIntakeCreate(multipart({ kind: "url", url: "https://akvariumklub.hu/programok/acidarab/", locale: "en", idempotency_key: KEY }), link.deps);
  assert.deepEqual(link.state.calls[1].payload, { admin_email: email, kind: "url", locale: "en", idempotency_key: KEY, admin_request_id: "req-0000-0000-0001",
    url: "https://akvariumklub.hu/programok/acidarab/" });
  assert.equal(link.state.calls[1].files, undefined);
});

test("create forwards one or two flyers as image_1 / image_2, unchanged, after the size and type check", async () => {
  const h = harness(fixture("admin-create-images-with-text"));
  const reply = await serveDatesIntakeCreate(multipart({ kind: "images", text: "Városligeti programok novemberben", locale: "hu", idempotency_key: KEY,
    image_1: new Blob([JPEG]), image_2: new Blob([PNG]) }), h.deps);
  assert.equal(reply.status, 200);
  const call = h.state.calls[1];
  assert.equal(call.action, "dates_event_intake_create"); assert.equal(call.timeout, 60_000);
  assert.deepEqual(call.payload, { admin_email: email, kind: "images", locale: "hu", idempotency_key: KEY, admin_request_id: "req-0000-0000-0001",
    text: "Városligeti programok novemberben" });
  assert.deepEqual(call.files!.map((file) => [file.field, file.mime, file.filename]), [["image_1", "image/jpeg", "flyer-1.jpg"], ["image_2", "image/png", "flyer-2.png"]]);
  assert.deepEqual(Buffer.from(call.files![0].bytes), JPEG); assert.deepEqual(Buffer.from(call.files![1].bytes), PNG);
  // No file name, path or metadata of the operator's machine is forwarded.
  assert.doesNotMatch(JSON.stringify(call.files!.map((file) => file.filename)), /upload/);
  const one = harness(fixture("admin-create-images"));
  await serveDatesIntakeCreate(multipart({ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([JPEG]) }), one.deps);
  assert.equal(one.state.calls[1].files!.length, 1); assert.equal(Object.hasOwn(one.state.calls[1].payload, "text"), false);
});

test("create refuses what Core would refuse, without sending it", async () => {
  const cases: Array<[Record<string, string | Blob>, number, string]> = [
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([Buffer.from("GIF89a..........")]) }, 415, "image-type-unsupported"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")]) }, 415, "image-type-unsupported"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) }, 413, "image-too-large"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([]) }, 400, "invalid-input"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY }, 400, "invalid-input"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_2: new Blob([JPEG]) }, 400, "invalid-input"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([JPEG]), image_3: new Blob([JPEG]) }, 400, "invalid-input"],
    [{ kind: "images", locale: "hu", idempotency_key: KEY, image_1: "not a file" }, 400, "invalid-input"],
    [{ kind: "images", url: "https://example.test/", locale: "hu", idempotency_key: KEY, image_1: new Blob([JPEG]) }, 400, "invalid-input"],
    [{ kind: "url", url: "https://example.test/", text: "and a line", locale: "hu", idempotency_key: KEY }, 400, "invalid-input"],
    [{ kind: "url", url: "https://example.test/", locale: "hu", idempotency_key: KEY, image_1: new Blob([JPEG]) }, 400, "invalid-input"],
    [{ kind: "text", text: "A line", locale: "hu", idempotency_key: KEY, image_1: new Blob([JPEG]) }, 400, "invalid-input"],
    [{ kind: "text", text: "é".repeat(501), locale: "hu", idempotency_key: KEY }, 400, "invalid-input"],
    [{ kind: "text", text: "A line", locale: "de", idempotency_key: KEY }, 400, "invalid-input"],
    [{ kind: "text", text: "A line", locale: "hu", idempotency_key: "short" }, 400, "invalid-input"],
    [{ kind: "fax", text: "A line", locale: "hu", idempotency_key: KEY }, 400, "invalid-input"],
    [{ kind: "text", text: "A line", locale: "hu", idempotency_key: KEY, admin_email: "owner@example.test" }, 400, "invalid-input"],
    [{ kind: "text", text: "A line", locale: "hu", idempotency_key: KEY, origin: "{}" }, 400, "invalid-input"],
  ];
  for (const [fields, status, error] of cases) {
    const h = harness(), reply = await serveDatesIntakeCreate(multipart(fields), h.deps);
    assert.deepEqual("json" in reply && reply.json, { success: false, status_code: status, error }, JSON.stringify(Object.keys(fields)));
    assert.deepEqual(h.state.calls.map((call) => call.action), ["admin_me"]);
    assert.equal(reply.headers["Cache-Control"], "private, no-store, max-age=0");
  }
  // 10 MiB exactly is Core's cap and is forwarded.
  const edge = harness(fixture("admin-create-images")), bytes = new Uint8Array(10 * 1024 * 1024); bytes.set(JPEG);
  assert.equal((await serveDatesIntakeCreate(multipart({ kind: "images", locale: "hu", idempotency_key: KEY, image_1: new Blob([bytes]) }), edge.deps)).status, 200);
  const broken = harness();
  const reply = await serveDatesIntakeCreate({ headers: headers({ ...sameOrigin, "content-length": "10" }), form: async () => { throw new Error("not multipart"); } }, broken.deps);
  assert.equal(reply.status, 400);
  assert.equal((await serveDatesIntakeCreate({ headers: headers(sameOrigin), form: async () => new FormData() }, harness().deps)).status, 400, "a length is required");
});

test("create shows Core's genuine refusals as they are and names a transport failure as one", async () => {
  const fields = { kind: "url", url: "https://www.facebook.com/events/1", locale: "hu", idempotency_key: KEY };
  for (const name of ["create-drafts-disabled", "create-source-not-readable", "create-url-invalid", "create-image-invalid", "create-key-conflict", "create-moderator"]) {
    const refusal = fixture(`admin-${name}-denied`), h = harness(refusal);
    h.state.answer = { status: refusal.status_code, data: refusal };
    const reply = await serveDatesIntakeCreate(multipart(fields), h.deps);
    assert.equal(reply.status, refusal.status_code); assert.deepEqual("json" in reply && reply.json, refusal);
  }
  const revoked = harness(); revoked.state.answer = { status: 403, data: fixture("admin-revoked-denied") };
  assert.equal((await serveDatesIntakeCreate(multipart(fields), revoked.deps)).status, 401, "a revocation Core reports mid-request ends the session");
  for (const [status, error] of [[502, "core-unavailable"], [504, "core-timeout"], [502, "invalid-core-response"]] as const) {
    const h = harness(); h.state.answer = { status, data: { success: false, error } };
    const reply = await serveDatesIntakeCreate(multipart(fields), h.deps);
    assert.deepEqual("json" in reply && reply.json, { success: false, status_code: status, error });
  }
  const garbage = harness(); garbage.state.answer = { status: 200, data: { success: false, error: "Something broke" } };
  assert.deepEqual("json" in (await serveDatesIntakeCreate(multipart(fields), garbage.deps)) && (await serveDatesIntakeCreate(multipart(fields), garbage.deps)).status, 502);
});

test("the scalar part of a create request names exactly one source", () => {
  const key = KEY;
  assert.deepEqual(normalizeDatesIntakeCreateFields({ kind: "url", url: " https://example.test/a ", locale: "hu", idempotency_key: key }, 0),
    { kind: "url", url: "https://example.test/a", locale: "hu", idempotency_key: key });
  // Core replaces control characters by a space and trims; the console forwards what Core will store.
  assert.deepEqual(normalizeDatesIntakeCreateFields({ kind: "text", text: " a\u0007b\n", locale: "en", idempotency_key: key }, 0),
    { kind: "text", text: "a b", locale: "en", idempotency_key: key });
  assert.deepEqual(normalizeDatesIntakeCreateFields({ kind: "images", locale: "hu", idempotency_key: key }, 2), { kind: "images", text: null, locale: "hu", idempotency_key: key });
  assert.deepEqual(normalizeDatesIntakeCreateFields({ kind: "images", text: "", locale: "hu", idempotency_key: key }, 1), { kind: "images", text: null, locale: "hu", idempotency_key: key });
  for (const [fields, images] of [[{ kind: "images", locale: "hu", idempotency_key: key }, 0], [{ kind: "images", locale: "hu", idempotency_key: key }, 3],
    [{ kind: "url", url: "https://example.test/", locale: "hu", idempotency_key: key }, 1], [{ kind: "url", locale: "hu", idempotency_key: key }, 0],
    [{ kind: "text", locale: "hu", idempotency_key: key }, 0], [{ kind: "text", text: "a", url: "https://example.test/", locale: "hu", idempotency_key: key }, 0]] as const)
    assert.equal(normalizeDatesIntakeCreateFields(fields, images), null, JSON.stringify(fields));
});

// ---------------------------------------------------------------- flyer read

const mediaHeaders = { host: "admin.example.test", "sec-fetch-site": "same-origin", "sec-fetch-dest": "image" };
const media = (query: string, values: Record<string, string | null> = mediaHeaders) => ({ headers: headers(values), searchParams: new URLSearchParams(query) });
// DERIVED: the genuine flyer-read receipt with real JPEG bytes in place of the corpus placeholder.
const flyer = () => { const body = fixture("admin-image-read"); return { ...body, image: { ...body.image, data_base64: JPEG.toString("base64") } }; };

test("the flyer URL is the console's own route and nothing else", () => {
  assert.equal(datesIntakeMediaUrl(xin(5), 1), `/api/admin/dates-intake-media?intake_id=${xin(5)}&index=1`);
  for (const [id, index] of [["xin_1", 1], [xin(5), 0], [xin(5), 3], [xin(5), 1.5], ["../../etc", 1]] as const) assert.equal(datesIntakeMediaUrl(id, index), "");
});

test("a flyer is served only to this console's own image element, to a reviewer, and never cacheably", async () => {
  const h = harness(flyer(), "moderator");
  const reply = await serveDatesIntakeMedia(media(`intake_id=${xin(5)}&index=1`), h.deps);
  assert.equal(reply.status, 200);
  assert.ok("bytes" in reply);
  assert.deepEqual(Buffer.from(reply.bytes), JPEG);
  assert.deepEqual(reply.headers, { ...DATES_INTAKE_MEDIA_HEADERS, "Content-Length": String(JPEG.length) });
  // Private evidence: nothing a browser, a proxy or a CDN could keep, sniff, embed elsewhere or refer onwards.
  assert.equal(reply.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(reply.headers.Pragma, "no-cache"); assert.equal(reply.headers.Expires, "0");
  assert.equal(reply.headers["Content-Type"], "image/jpeg"); assert.equal(reply.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(reply.headers["Cross-Origin-Resource-Policy"], "same-origin"); assert.equal(reply.headers["Referrer-Policy"], "no-referrer");
  assert.equal(reply.headers["Content-Security-Policy"], "default-src 'none'; sandbox");
  for (const name of ["ETag", "Last-Modified", "Accept-Ranges", "Access-Control-Allow-Origin", "Age"]) assert.equal(Object.keys(reply.headers).some((key) => key.toLowerCase() === name.toLowerCase()), false, name);
  assert.deepEqual(h.state.calls[1], { action: "dates_event_intake_image", timeout: 30_000,
    payload: { admin_email: email, intake_id: xin(5), index: 1, admin_request_id: "req-0000-0000-0001" } });
  // The same-host Referer of the console's <img referrerPolicy="same-origin"> is accepted too.
  assert.equal((await serveDatesIntakeMedia(media(`intake_id=${xin(5)}&index=1`, { host: "admin.example.test", referer: "https://admin.example.test/dates/intakes/x" }), harness(flyer()).deps)).status, 200);
});

test("a flyer read is refused for a direct visit, another site, a script fetch, a guest and a non-reviewer", async () => {
  const query = `intake_id=${xin(5)}&index=1`;
  for (const values of [{ host: "admin.example.test", "sec-fetch-site": "none", "sec-fetch-dest": "document" }, { host: "admin.example.test", "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" },
    { host: "admin.example.test", "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" }, { host: "admin.example.test", referer: "https://attacker.example/" },
    { host: "admin.example.test" }, { "sec-fetch-site": "same-origin", "sec-fetch-dest": "image" }] as Array<Record<string, string>>) {
    const h = harness(flyer()), reply = await serveDatesIntakeMedia(media(query, values), h.deps);
    assert.equal(reply.status, 403); assert.equal(h.state.calls.length, 0); assert.equal("bytes" in reply, false);
    assert.equal(reply.headers["Cache-Control"], "private, no-store, max-age=0");
  }
  const guest = harness(flyer()); guest.state.session = null;
  assert.equal((await serveDatesIntakeMedia(media(query), guest.deps)).status, 401);
  const viewer = harness(flyer(), "support_viewer"), denied = await serveDatesIntakeMedia(media(query), viewer.deps);
  assert.deepEqual("json" in denied && denied.json, { success: false, status_code: 403, error: "dates-admin-capability-required" });
  assert.deepEqual(viewer.state.calls.map((call) => call.action), ["admin_me"]);
  for (const bad of ["", `intake_id=${xin(5)}`, `intake_id=${xin(5)}&index=0`, `intake_id=${xin(5)}&index=3`, `intake_id=${xin(5)}&index=01`, "intake_id=xin_1&index=1",
    `intake_id=${xin(5)}&index=1&download=1`, `intake_id=${xin(5)}&index=1&admin_email=owner@example.test`]) {
    const h = harness(flyer()), reply = await serveDatesIntakeMedia(media(bad), h.deps);
    assert.equal(reply.status, 400, bad); assert.deepEqual(h.state.calls.map((call) => call.action), ["admin_me"]);
  }
});

test("only Core's re-encoded JPEG ever leaves the flyer route", async () => {
  const query = `intake_id=${xin(5)}&index=2`;
  // Core's genuine refusal for a flyer that is not there travels on as it is.
  const missing = fixture("admin-image-unavailable-denied"), gone = harness(); gone.state.answer = { status: 404, data: missing };
  const reply = await serveDatesIntakeMedia(media(query), gone.deps);
  assert.equal(reply.status, 404); assert.deepEqual("json" in reply && reply.json, missing);
  // The genuine corpus body carries a placeholder, not an image: it is not served as one.
  const placeholder = harness(fixture("admin-image-read"));
  assert.equal((await serveDatesIntakeMedia(media(`intake_id=${xin(5)}&index=1`), placeholder.deps)).status, 502);
  // The receipt of another flyer, another type, or bytes that are not a JPEG.
  const other = harness(flyer());
  assert.equal((await serveDatesIntakeMedia(media(query), other.deps)).status, 502, "index 1 answered for index 2");
  for (const change of [{ mime: "image/svg+xml" }, { data_base64: Buffer.from("<svg onload=alert(1)>").toString("base64") }, { data_base64: PNG.toString("base64") }, { data_base64: "" }]) {
    const body = flyer(), h = harness({ ...body, image: { ...body.image, ...change } });
    const answer = await serveDatesIntakeMedia(media(`intake_id=${xin(5)}&index=1`), h.deps);
    assert.equal(answer.status, 502); assert.equal("bytes" in answer, false);
  }
  const down = harness(); down.state.answer = { status: 502, data: { success: false, error: "core-unavailable" } };
  assert.deepEqual("json" in (await serveDatesIntakeMedia(media(query), down.deps)) && (await serveDatesIntakeMedia(media(query), down.deps)).status, 502);
  // The route file hands the bytes over with exactly these headers and has no other way out.
  const route = readFileSync(new URL("../app/api/admin/dates-intake-media/route.ts", import.meta.url), "utf8");
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /new NextResponse\(Buffer\.from\(reply\.bytes\), \{ status: reply\.status, headers: reply\.headers \}\)/);
  assert.doesNotMatch(route, /redirect|public\/|media_url|revalidate/);
});

// ---------------------------------------------------------------- Core transport for several files

const EMPTY_MODULE_URL = "data:text/javascript,";
type ResolveNext = (specifier: string, context: unknown) => unknown;
const moduleApi = nodeModule as unknown as { registerHooks?: (hooks: { resolve: (specifier: string, context: unknown, next: ResolveNext) => unknown }) => void;
  register?: (specifier: string, parentURL: string) => void };
if (typeof moduleApi.registerHooks === "function") moduleApi.registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { url: EMPTY_MODULE_URL, shortCircuit: true, format: "module" } : next(specifier, context); } });
else if (typeof moduleApi.register === "function") moduleApi.register("data:text/javascript," + encodeURIComponent(
  `export function resolve(specifier, context, next) { if (specifier === "server-only") return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" }; return next(specifier, context); }`), import.meta.url);
else throw new Error("no module resolution hook API available");
const secret = "test-webadmin-api-secret-0000000000";
process.env.WEBADMIN_API_SECRET = secret;
process.env.CORE_API_BASE = "https://core.invalid";
const { coreMultipartFilesCall, coreCall } = await import("../lib/core.ts");

test("the multi-file Core call posts image_1 / image_2 beside string fields, with the server-owned secret last", async () => {
  const realFetch = globalThis.fetch;
  let captured: { input: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => { captured = { input: String(input), init: init ?? {} };
    return { status: 200, json: async () => fixture("admin-create-images") } as Response; }) as typeof globalThis.fetch;
  try {
    const result = await coreMultipartFilesCall("dates_event_intake_create", { admin_email: email, kind: "images", locale: "hu", idempotency_key: KEY, secret: "attacker" },
      [{ field: "image_1", bytes: new Uint8Array(JPEG), mime: "image/jpeg", filename: "flyer-1.jpg" }, { field: "image_2", bytes: new Uint8Array(PNG), mime: "image/png", filename: "flyer-2.png" }]);
    assert.equal(result.status, 200);
    assert.ok(captured);
    const sent = captured as { input: string; init: RequestInit };
    assert.equal(sent.input, "https://core.invalid/v1/webadmin/dates_event_intake_create");
    const body = sent.init.body as FormData;
    assert.ok(body instanceof FormData);
    assert.deepEqual(body.getAll("secret"), [secret]);
    assert.deepEqual([body.get("kind"), body.get("locale"), body.get("admin_email")], ["images", "hu", email]);
    const first = body.get("image_1") as File, second = body.get("image_2") as File;
    assert.deepEqual([first.type, first.name, second.type, second.name], ["image/jpeg", "flyer-1.jpg", "image/png", "flyer-2.png"]);
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), JPEG);
    assert.equal(body.has("image"), false, "the intake route reads image_1 and image_2 only");
    // A file can never take the place of a scalar parameter, of the actor or of the credential.
    for (const field of ["secret", "admin_email", "kind", "Image_1", "image.1"]) {
      captured = null;
      const refused = await coreMultipartFilesCall("dates_event_intake_create", { admin_email: email, kind: "images" },
        [{ field, bytes: new Uint8Array(JPEG), mime: "image/jpeg", filename: "x.jpg" }]);
      assert.equal(refused.status, 400, field); assert.equal(captured, null);
    }
  } finally { globalThis.fetch = realFetch; }
});

test("the form encoding Core's intake routes are pinned against: a number as its decimal string, a boolean as 1 or 0, the event as one JSON string", async () => {
  const realFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => { body = String(init?.body); return { status: 200, json: async () => fixture("admin-publish") } as Response; }) as typeof globalThis.fetch;
  try {
    const event = { ...fixture("admin-detail-in-review-official").intake.events[0].editor_input, confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } };
    for (const complete of [false, true]) {
      await coreCall("dates_event_intake_publish", { admin_email: email, intake_id: xin(2), intake_revision: 10, event_index: 0, complete, event,
        reason: "Source and public venue verified.", idempotency_key: KEY });
      const sent = new URLSearchParams(body);
      assert.equal(sent.get("event_index"), "0"); assert.equal(sent.get("intake_revision"), "10");
      assert.equal(sent.get("complete"), complete ? "1" : "0");
      assert.deepEqual(JSON.parse(sent.get("event")!), event);
      assert.deepEqual(sent.getAll("secret"), [secret]);
    }
  } finally { globalThis.fetch = realFetch; }
});

test("review finding: a source keeps its identity through every answer that does not say whether the intake was made", async () => {
  const { createDatesIntakeSourceAttempts } = await import("../lib/datesIntakeConsole.ts");
  const draft = { kind: "text" as const, url: "", text: "Fradi–Újpest szombaton a Groupama Arénában" };
  const core = (error: string, status: number) => ({ status, data: { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 } });
  // The console's own route, run as it is: what the panel receives is what the bridge really answers.
  function console_() {
    const h = harness();
    let minted = 0;
    const attempts = createDatesIntakeSourceAttempts(() => `dates-intake-create:00000000-0000-4000-8000-${String(++minted).padStart(12, "0")}`);
    const post = async (form: FormData) => {
      const reply = await serveDatesIntakeCreate({ headers: headers({ ...sameOrigin, "content-length": "4096" }), form: async () => form }, h.deps);
      return "json" in reply ? reply.json : null;
    };
    const keys = () => h.state.calls.filter((call) => call.action === "dates_event_intake_create").map((call) => call.payload.idempotency_key);
    return { h, attempts, send: () => attempts.send(post, draft, [], "hu"), keys };
  }

  // The reviewer's scenario. Core creates the intake but its reply misses the console's timeout...
  const c = console_();
  c.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } };
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "core-timeout" });
  assert.equal(c.attempts.unanswered, true);
  // ...the retry meets the first execution still running...
  c.h.state.answer = core("dates-admin-command-in-progress", 409);
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "dates-admin-command-in-progress" });
  // ...and every other answer that proves nothing keeps the identity as well: Core unreachable, an unreadable body,
  // a server failure, storage down, a capability refusal that precedes the receipt lookup,
  c.h.state.answer = { status: 502, data: { success: false, error: "core-unavailable" } };
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "core-unavailable" });
  c.h.state.answer = { status: 200, data: { success: false, error: "Something broke" } };
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "invalid-core-response" });
  c.h.state.answer = core("dates-admin-unavailable", 503);
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "dates-admin-unavailable" });
  c.h.state.answer = core("dates-intake-storage-unavailable", 503);
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "dates-intake-storage-unavailable" });
  c.h.state.answer = { status: 403, data: fixture("admin-create-moderator-denied") };
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "dates-admin-capability-required" });
  // and - on a RETRY - the two refusals Core raises before it looks the identity up, from state that may have changed
  // since the first attempt: the switch turned off meanwhile, a flyer that did not arrive whole this time.
  for (const name of ["create-drafts-disabled", "create-image-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`); c.h.state.answer = { status: refusal.status_code, data: refusal };
    assert.deepEqual(await c.send(), { kind: "uncertain", error: refusal.error }, name);
  }
  // A lost session answers from the bridge without reaching Core: still nothing known about the first attempt.
  c.h.state.session = null;
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "auth-required" });
  c.h.state.session = { email };
  // While the outcome is unknown the source cannot become another request.
  assert.equal(c.attempts.changed(), false); assert.equal(c.attempts.unanswered, true);
  // The same request finally finds the intake of the first attempt: Core's genuine replay.
  c.h.state.answer = { status: 200, data: fixture("admin-create-text-replay") };
  const found = await c.send();
  assert.equal(found.kind === "success" && found.receipt.replayed, true);
  assert.equal(c.keys().length, 10, "ten requests reached Core's create route (the lost session did not)");
  assert.deepEqual([...new Set(c.keys())], ["dates-intake-create:00000000-0000-4000-8000-000000000001"], "one identity for all of them");
  assert.equal(c.attempts.unanswered, false); assert.equal(c.attempts.changed(), true);

  // Only a definitive no-write refusal retires the identity: each of Core's genuine ones, on a first attempt.
  for (const name of ["create-drafts-disabled", "create-source-not-readable", "create-url-invalid", "create-text-invalid", "create-image-invalid",
    "create-input-invalid", "create-kind-invalid", "create-locale-invalid", "create-origin-invalid", "create-idempotency-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`), fresh = console_();
    fresh.h.state.answer = { status: refusal.status_code, data: refusal };
    assert.deepEqual(await fresh.send(), { kind: "refused", error: refusal.error, status: refusal.status_code }, name);
    assert.equal(fresh.attempts.unanswered, false, name);
    fresh.h.state.answer = { status: 200, data: fixture("admin-create-text") };
    assert.equal((await fresh.send()).kind, "success");
    assert.deepEqual(fresh.keys(), ["dates-intake-create:00000000-0000-4000-8000-000000000001", "dates-intake-create:00000000-0000-4000-8000-000000000002"], `${name}: the next request is a new command`);
  }
  // A refusal of the request itself is the same answer the first attempt got, so it settles a retry too.
  const retried = console_();
  retried.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } }; await retried.send();
  const invalid = fixture("admin-create-text-invalid-denied"); retried.h.state.answer = { status: invalid.status_code, data: invalid };
  assert.deepEqual(await retried.send(), { kind: "refused", error: invalid.error, status: invalid.status_code });
  assert.equal(retried.attempts.unanswered, false);
  // Another payload under the key says nothing about the first attempt either.
  const conflict = console_(), taken = fixture("admin-create-key-conflict-denied");
  conflict.h.state.answer = { status: taken.status_code, data: taken };
  assert.deepEqual(await conflict.send(), { kind: "uncertain", error: taken.error }); assert.equal(conflict.attempts.unanswered, true);

  // An edit before anything is pending is a new request; after an unknown outcome only the operator's discard is.
  const edited = console_();
  edited.h.state.answer = { status: 200, data: fixture("admin-create-text") };
  assert.equal(edited.attempts.changed(), true);
  const given = console_();
  given.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } };
  await given.send(); await given.send();
  assert.equal(given.attempts.changed(), false);
  given.attempts.discard();
  assert.equal(given.attempts.unanswered, false); assert.equal(given.attempts.changed(), true);
  given.h.state.answer = { status: 200, data: fixture("admin-create-text") };
  assert.equal((await given.send()).kind, "success");
  assert.deepEqual(given.keys(), ["dates-intake-create:00000000-0000-4000-8000-000000000001", "dates-intake-create:00000000-0000-4000-8000-000000000001",
    "dates-intake-create:00000000-0000-4000-8000-000000000002"]);
  // An answer that never arrives at all (the fetch failed) keeps the identity too.
  const offline = createDatesIntakeSourceAttempts(() => KEY), sent: string[] = [];
  const dead = async (form: FormData) => { sent.push(String(form.get("idempotency_key"))); throw new Error("offline"); };
  assert.deepEqual(await offline.send(dead, draft, [], "hu"), { kind: "uncertain", error: null });
  assert.deepEqual(await offline.send(async (form) => { sent.push(String(form.get("idempotency_key"))); return null; }, draft, [], "hu"), { kind: "uncertain", error: null });
  assert.deepEqual(sent, [KEY, KEY]); assert.equal(offline.unanswered, true);
});

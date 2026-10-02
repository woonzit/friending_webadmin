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

/** Per-browser storage, as `window.localStorage` is one: it outlives the page, the tab and the component. */
function browserStorage() {
  const rows = new Map<string, string>();
  return { rows, storage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } } };
}

test("review finding and recheck: a source keeps its identity - in the browser's storage - through every answer that does not say whether the intake was made", async () => {
  const { sendDatesIntakeSource, readDatesIntakeTombstone, datesIntakeSourceFingerprint } = await import("../lib/datesIntakeTombstone.ts");
  const draft = { kind: "text" as const, url: "", text: "Fradi–Újpest szombaton a Groupama Arénában" };
  const core = (error: string, status: number) => ({ status, data: { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 } });
  // The console's own route, run as it is: what the panel receives is what the bridge really answers.
  function console_(browser = browserStorage()) {
    const h = harness();
    let minted = 0, now = 1790000000;
    const post = async (form: FormData) => {
      const reply = await serveDatesIntakeCreate({ headers: headers({ ...sameOrigin, "content-length": "4096" }), form: async () => form }, h.deps);
      return "json" in reply ? reply.json : null;
    };
    const deps = { post, storage: browser.storage, actor: email, now: () => now, mint: () => `dates-intake-create:00000000-0000-4000-8000-${String(++minted).padStart(12, "0")}` };
    const keys = () => h.state.calls.filter((call) => call.action === "dates_event_intake_create").map((call) => call.payload.idempotency_key);
    return { h, browser, deps, send: (source: typeof draft | { kind: "text"; url: string; text: string } = draft) => sendDatesIntakeSource(deps, source, [], "hu"), keys,
      waiting: () => readDatesIntakeTombstone(browser.storage, email), tick: (seconds: number) => { now += seconds; } };
  }

  // The reviewer's scenario. Core creates the intake but its reply misses the console's timeout...
  const c = console_();
  c.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } };
  assert.deepEqual(await c.send(), { kind: "uncertain", error: "core-timeout" });
  const first = c.waiting();
  assert.equal(first.kind, "pending");
  const identity = await datesIntakeSourceFingerprint(draft, []);
  assert.deepEqual(first.kind === "pending" && first.tombstone, { version: 1, actor: email, key: "dates-intake-create:00000000-0000-4000-8000-000000000001", at: 1790000000,
    last_at: 1790000000, kind: "text", locale: "hu", fingerprint: identity.fingerprint, files: [] });
  // The record holds a fingerprint, never the source: nothing of the text is in the browser's storage.
  const stored = [...c.browser.rows.entries()];
  assert.deepEqual(stored.map(([key]) => key), ["friending:dates-intake:create:v1:operator%40example.test"]);
  assert.doesNotMatch(stored[0][1], /Fradi|Groupama|Újpest/);
  // ...the retry meets the first execution still running...
  c.tick(20);
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
  assert.equal(c.waiting().kind, "pending");

  // THE RECHECK'S PATHS. The operator follows the link to the queue, reloads, closes the tab: the component and
  // everything in it are gone. A new panel - any page, any time later - finds the record in the browser's storage.
  const later = console_(c.browser);
  later.h.state.answer = { status: 200, data: fixture("admin-create-text") };
  const found = later.waiting();
  assert.deepEqual(found, first.kind === "pending" ? { kind: "pending", tombstone: { ...first.tombstone, last_at: 1790000020 } } : null);
  // A different source is not sent at all - not under the waiting key, and not under a new one.
  assert.deepEqual(await later.send({ kind: "text", url: "", text: "Egy másik esemény vasárnap" }), { kind: "mismatch" });
  assert.deepEqual(await later.send({ kind: "text", url: "", text: draft.text + " " }), { kind: "mismatch" }, "not even nearly the same text");
  assert.equal(later.keys().length, 0, "nothing reached Core"); assert.equal(later.waiting().kind, "pending");
  // The same source again, typed in again after the reload: it goes out under the FIRST key, and Core replays the receipt.
  later.h.state.answer = { status: 200, data: fixture("admin-create-text-replay") };
  const replay = await later.send();
  assert.equal(replay.kind === "success" && replay.receipt.replayed, true);
  assert.deepEqual(later.keys(), ["dates-intake-create:00000000-0000-4000-8000-000000000001"], "the new panel minted nothing");
  assert.equal(c.keys().length, 9, "nine requests of the first panel reached Core's create route (the lost session did not)");
  assert.deepEqual([...new Set([...c.keys(), ...later.keys()])], ["dates-intake-create:00000000-0000-4000-8000-000000000001"], "one identity for all ten");
  // Core's receipt retires the record.
  assert.deepEqual(later.waiting(), { kind: "empty" }); assert.equal(c.browser.rows.size, 0);

  // Only a definitive no-write refusal retires it otherwise: each of Core's genuine ones, on a first attempt.
  for (const name of ["create-drafts-disabled", "create-source-not-readable", "create-url-invalid", "create-text-invalid", "create-image-invalid",
    "create-input-invalid", "create-kind-invalid", "create-locale-invalid", "create-origin-invalid", "create-idempotency-invalid"]) {
    const refusal = fixture(`admin-${name}-denied`), fresh = console_();
    fresh.h.state.answer = { status: refusal.status_code, data: refusal };
    assert.deepEqual(await fresh.send(), { kind: "refused", error: refusal.error, status: refusal.status_code }, name);
    assert.deepEqual(fresh.waiting(), { kind: "empty" }, name);
    fresh.h.state.answer = { status: 200, data: fixture("admin-create-text") };
    assert.equal((await fresh.send()).kind, "success");
    assert.deepEqual(fresh.keys(), ["dates-intake-create:00000000-0000-4000-8000-000000000001", "dates-intake-create:00000000-0000-4000-8000-000000000002"], `${name}: the next request is a new command`);
  }
  // A refusal of the request itself is the same answer the first attempt got, so it settles a retry too.
  const retried = console_();
  retried.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } }; await retried.send();
  const invalid = fixture("admin-create-text-invalid-denied"); retried.h.state.answer = { status: invalid.status_code, data: invalid };
  assert.deepEqual(await retried.send(), { kind: "refused", error: invalid.error, status: invalid.status_code });
  assert.deepEqual(retried.waiting(), { kind: "empty" });
  // Another payload under the key says nothing about the first attempt either.
  const conflict = console_(), taken = fixture("admin-create-key-conflict-denied");
  conflict.h.state.answer = { status: taken.status_code, data: taken };
  assert.deepEqual(await conflict.send(), { kind: "uncertain", error: taken.error }); assert.equal(conflict.waiting().kind, "pending");

  // The record is written BEFORE the request leaves, so even a request the browser never saw answered is covered.
  const offline = console_();
  offline.deps.post = async () => { assert.equal(offline.waiting().kind, "pending", "saved before dispatch"); throw new Error("offline"); };
  assert.deepEqual(await offline.send(), { kind: "uncertain", error: null }); assert.equal(offline.waiting().kind, "pending");
  // The locale is part of what Core hashes: a resend from a page shown in English carries the first attempt's.
  const forms: FormData[] = [];
  const locale = console_(); locale.deps.post = async (form: FormData) => { forms.push(form); return null; };
  await sendDatesIntakeSource(locale.deps, draft, [], "hu"); await sendDatesIntakeSource(locale.deps, draft, [], "en");
  assert.deepEqual(forms.map((form) => [form.get("locale"), form.get("idempotency_key")]), [["hu", "dates-intake-create:00000000-0000-4000-8000-000000000001"],
    ["hu", "dates-intake-create:00000000-0000-4000-8000-000000000001"]]);
  // After six days Core no longer keeps the receipt: a resend could create a second intake, so there is none.
  const old = console_(); old.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } }; await old.send();
  old.tick(6 * 86400 - 1); assert.equal((await old.send()).kind, "uncertain");
  old.tick(1); assert.deepEqual(await old.send(), { kind: "expired" }); assert.equal(old.keys().length, 2); assert.equal(old.waiting().kind, "pending");

  // The record is per operator; another operator in the same browser is not blocked by it and cannot resend it.
  const shared = console_(); shared.h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } }; await shared.send();
  assert.deepEqual(readDatesIntakeTombstone(shared.browser.storage, "colleague@example.test"), { kind: "empty" });
  // A browser that cannot keep the record, and a record that cannot be read, send nothing - and the unreadable record stays.
  const none = console_(); none.deps.storage = null as any;
  assert.deepEqual(await sendDatesIntakeSource(none.deps, draft, [], "hu"), { kind: "blocked" }); assert.equal(none.keys().length, 0);
  const refusing = console_(); refusing.deps.storage = { ...refusing.browser.storage, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.deepEqual(await sendDatesIntakeSource(refusing.deps, draft, [], "hu"), { kind: "blocked" }); assert.equal(refusing.keys().length, 0);
  for (const raw of ["{", "null", JSON.stringify({ version: 2 }), JSON.stringify({ ...(first.kind === "pending" ? first.tombstone : {}), actor: "someone@example.test" }),
    JSON.stringify({ ...(first.kind === "pending" ? first.tombstone : {}), fingerprint: "short" }), JSON.stringify({ ...(first.kind === "pending" ? first.tombstone : {}), text: "the source" }),
    JSON.stringify({ ...(first.kind === "pending" ? first.tombstone : {}), kind: "images" }), "x".repeat(5000)]) {
    const corrupt = console_(); corrupt.browser.rows.set("friending:dates-intake:create:v1:operator%40example.test", raw);
    assert.deepEqual(corrupt.waiting(), { kind: "blocked" }, raw.slice(0, 40));
    assert.deepEqual(await corrupt.send(), { kind: "blocked" }); assert.equal(corrupt.keys().length, 0);
    assert.equal(corrupt.browser.rows.get("friending:dates-intake:create:v1:operator%40example.test"), raw, "never cleared silently");
  }
});

test("review recheck: a flyer is resent only when the same file is picked again; the record holds its digest, size and name, never its bytes", async () => {
  const { sendDatesIntakeSource, readDatesIntakeTombstone, datesSha256Hex } = await import("../lib/datesIntakeTombstone.ts");
  const browser = browserStorage(), h = harness(fixture("admin-create-images"));
  const file = (bytes: Buffer, name: string) => Object.assign(new Blob([bytes], { type: "image/jpeg" }), { name });
  const flyer = file(JPEG, "varosliget-november.jpg");
  const post = async (form: FormData) => {
    const reply = await serveDatesIntakeCreate({ headers: headers({ ...sameOrigin, "content-length": "4096" }), form: async () => form }, h.deps);
    return "json" in reply ? reply.json : null;
  };
  let now = 1790000000;
  const deps = { post, storage: browser.storage, actor: email, now: () => now, mint: () => KEY };
  const draft = { kind: "images" as const, url: "", text: "" };
  h.state.answer = { status: 504, data: { success: false, error: "core-timeout" } };
  assert.deepEqual(await sendDatesIntakeSource(deps, draft, [flyer], "hu"), { kind: "uncertain", error: "core-timeout" });
  const waiting = readDatesIntakeTombstone(browser.storage, email);
  assert.equal(waiting.kind, "pending");
  assert.deepEqual(waiting.kind === "pending" && waiting.tombstone.files, [{ sha256: await datesSha256Hex(JPEG), size: JPEG.length, name: "varosliget-november.jpg" }]);
  assert.equal(await datesSha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256, checked against the standard vector");
  assert.ok([...browser.rows.values()][0].length < 600, "a digest, a size and a name - not a megabyte of image");
  // After a reload the file input is empty. Another photo, the same photo with a line of text added, two photos: not sent.
  now += 600;
  h.state.answer = { status: 200, data: fixture("admin-create-images") };
  const other = Buffer.from(JPEG); other[other.length - 3] ^= 1;
  for (const [files, text] of [[[file(other, "varosliget-november.jpg")], ""], [[flyer], "Városligeti programok"], [[flyer, flyer], ""], [[], ""]] as const)
    assert.deepEqual(await sendDatesIntakeSource(deps, { ...draft, text }, files, "hu"), { kind: "mismatch" });
  assert.equal(h.state.calls.filter((call) => call.action === "dates_event_intake_create").length, 1, "only the first attempt reached Core");
  // The same bytes under another file name are the same flyer: the request is the same, and it goes out under the same key.
  const again = await sendDatesIntakeSource(deps, draft, [file(JPEG, "copy-of-flyer.jpg")], "en");
  assert.equal(again.kind, "success");
  const sent = h.state.calls.filter((call) => call.action === "dates_event_intake_create");
  assert.deepEqual(sent.map((call) => [call.payload.idempotency_key, call.payload.locale, call.files?.length]), [[KEY, "hu", 1], [KEY, "hu", 1]]);
  assert.deepEqual(readDatesIntakeTombstone(browser.storage, email), { kind: "empty" });
});

test("review recheck: only a queue read made for the submission can close its record - never the operator's wish alone", async () => {
  const { readDatesIntakeTombstone, readDatesIntakeTombstoneEvidence, retireDatesIntakeTombstone, sendDatesIntakeSource,
    DATES_INTAKE_TOMBSTONE_SETTLE_SECONDS, DATES_INTAKE_TOMBSTONE_SKEW_SECONDS } = await import("../lib/datesIntakeTombstone.ts");
  // Genuine Core bodies: the queue of admin drafts (newest first) and the detail of each row, which names its creator.
  const list = fixture("admin-list-all"), details = new Map<string, any>();
  for (const name of ["admin-detail-in-review-official", "admin-detail-in-review-images", "admin-detail-in-review-multi"]) { const body = fixture(name); details.set(body.intake.intake_id, body); }
  assert.deepEqual(list.intakes.map((row: any) => [row.channel, details.get(row.intake_id)?.intake.admin_principal]), [["admin_draft", "admin@example.test"],
    ["admin_draft", "admin@example.test"], ["admin_draft", "admin@example.test"]]);
  const newest = list.intakes[0].created_at as number, oldest = list.intakes[2].created_at as number;
  assert.ok(newest > oldest);
  function setup(actor: string, at: number, lastAt = at) {
    const browser = browserStorage();
    const tombstone = { version: 1 as const, actor, key: KEY, at, last_at: lastAt, kind: "text" as const, locale: "hu" as const, fingerprint: "c".repeat(64), files: [] };
    browser.rows.set(`friending:dates-intake:create:v1:${encodeURIComponent(actor)}`, JSON.stringify(tombstone));
    const sent: Array<{ action: string; body: any }> = [];
    const table: Record<string, (body: any) => unknown> = {
      dates_event_intake_list: (body) => ({ ...list, page: body.page, limit: body.limit }),
      dates_event_intake_detail: (body) => details.get(body.intake_id) ?? null };
    const send = async (action: string, body: Record<string, unknown>) => { sent.push({ action, body }); return table[action](body); };
    return { browser, tombstone, sent, table, send, waiting: () => readDatesIntakeTombstone(browser.storage, actor) };
  }
  const late = (at: number) => at + DATES_INTAKE_TOMBSTONE_SETTLE_SECONDS;

  // 1. Operator intent alone: no evidence, evidence that says nothing, evidence for another submission - nothing is removed.
  const wish = setup("admin@example.test", newest + 1000);
  for (const evidence of [null, { kind: "unconfirmed" }, { kind: "early", retry_at: 1 }, { kind: "none", key: "dates-intake-create:another-key-0000001", covers: wish.tombstone.last_at, since: 1, checked_at: 2 }] as const)
    assert.equal(retireDatesIntakeTombstone(wish.browser.storage, wish.tombstone, evidence), false);
  assert.equal(wish.waiting().kind, "pending");

  // 2. Too early: the last attempt may still be running in Core. No queue read is even made.
  assert.deepEqual(await readDatesIntakeTombstoneEvidence(wish.send, wish.tombstone, late(wish.tombstone.last_at) - 1), { kind: "early", retry_at: late(wish.tombstone.last_at) });
  assert.equal(wish.sent.length, 0);

  // 3. The queue shows no draft of this operator since the submission: it did not arrive, and the record may be closed.
  const none = await readDatesIntakeTombstoneEvidence(wish.send, wish.tombstone, late(wish.tombstone.last_at));
  assert.deepEqual(none, { kind: "none", key: KEY, covers: wish.tombstone.last_at, since: wish.tombstone.at - DATES_INTAKE_TOMBSTONE_SKEW_SECONDS, checked_at: list.server_now });
  assert.deepEqual(wish.sent.map((call) => [call.action, call.body.channel, call.body.limit]), [["dates_event_intake_list", "admin_draft", 100]], "admin drafts, newest first; no detail was needed");
  assert.equal(retireDatesIntakeTombstone(wish.browser.storage, wish.tombstone, none), true);
  assert.deepEqual(wish.waiting(), { kind: "empty" });

  // 4. The queue shows drafts this operator created since the submission: they are named, and it is NOT "did not arrive".
  const landed = setup("admin@example.test", oldest + 1);
  const found = await readDatesIntakeTombstoneEvidence(landed.send, landed.tombstone, late(landed.tombstone.last_at));
  assert.equal(found.kind, "found");
  assert.deepEqual(found.kind === "found" && found.intakes.map((row) => row.intake_id), list.intakes.map((row: any) => row.intake_id), "all three are within the clock allowance");
  assert.deepEqual(landed.sent.filter((call) => call.action === "dates_event_intake_detail").length, 3, "Core was asked who created each");
  // 5. A colleague's drafts are not this operator's: for another operator the same queue shows none.
  const colleague = setup("colleague@example.test", oldest + 1);
  assert.equal((await readDatesIntakeTombstoneEvidence(colleague.send, colleague.tombstone, late(colleague.tombstone.last_at))).kind, "none");
  assert.equal(colleague.sent.filter((call) => call.action === "dates_event_intake_detail").length, 3);

  // 6. An attempt made after the queue was read is not covered by that read: the record stays.
  const resent = setup("admin@example.test", newest + 1000);
  const before = await readDatesIntakeTombstoneEvidence(resent.send, resent.tombstone, late(resent.tombstone.last_at));
  const post = async () => null;
  // (the operator sends the same request again - here the stored fingerprint is what the source hashes to)
  const { datesIntakeSourceFingerprint } = await import("../lib/datesIntakeTombstone.ts");
  const source = { kind: "text" as const, url: "", text: "Fradi–Újpest szombaton" };
  const identified = { ...resent.tombstone, fingerprint: (await datesIntakeSourceFingerprint(source, [])).fingerprint };
  resent.browser.rows.set("friending:dates-intake:create:v1:admin%40example.test", JSON.stringify(identified));
  const stale = { ...before, key: KEY } as typeof before;
  assert.deepEqual(await sendDatesIntakeSource({ post, storage: resent.browser.storage, actor: "admin@example.test", now: () => late(identified.last_at) + 50 }, source, [], "hu"), { kind: "uncertain", error: null });
  const current = resent.waiting();
  assert.equal(current.kind === "pending" && current.tombstone.last_at, late(identified.last_at) + 50);
  assert.equal(retireDatesIntakeTombstone(resent.browser.storage, identified, stale), false, "the record the read was made for is no longer what the storage holds");
  assert.equal(current.kind === "pending" && retireDatesIntakeTombstone(resent.browser.storage, current.tombstone, stale), false, "and the old read does not cover the new attempt");
  assert.equal(resent.waiting().kind, "pending");

  // 7. Anything the read cannot be sure of is "unconfirmed", and closes nothing.
  const unsure = (change: (s: ReturnType<typeof setup>) => void) => { const s = setup("admin@example.test", oldest + 1); change(s); return readDatesIntakeTombstoneEvidence(s.send, s.tombstone, late(s.tombstone.last_at)); };
  for (const [name, change] of [
    ["the queue cannot be read", (s: any) => { s.table.dates_event_intake_list = () => null; }],
    ["Core refuses the queue (no review capability)", (s: any) => { s.table.dates_event_intake_list = () => fixture("admin-list-viewer-denied"); }],
    ["a row cannot be read", (s: any) => { s.table.dates_event_intake_list = (body: any) => ({ ...list, page: body.page, limit: body.limit, intakes: [list.intakes[0], { ...list.intakes[1], status: "sleeping" }] }); }],
    ["a row has no readable time", (s: any) => { s.table.dates_event_intake_list = (body: any) => ({ ...list, page: body.page, limit: body.limit, intakes: [{ ...list.intakes[0], created_at: "yesterday" }] }); }],
    ["the rows are not newest first", (s: any) => { s.table.dates_event_intake_list = (body: any) => ({ ...list, page: body.page, limit: body.limit, intakes: [...list.intakes].reverse() }); }],
    ["a row of another channel is served", (s: any) => { s.table.dates_event_intake_list = (body: any) => ({ ...list, page: body.page, limit: body.limit, intakes: [{ ...list.intakes[0], channel: "member_suggestion" }] }); }],
    ["a detail cannot be read", (s: any) => { s.table.dates_event_intake_detail = () => null; }],
    ["a detail names no creator", (s: any) => { s.table.dates_event_intake_detail = (body: any) => { const d = details.get(body.intake_id); return { ...d, intake: { ...d.intake, admin_principal: null } }; }; }],
    ["the transport fails", (s: any) => { s.table.dates_event_intake_list = () => { throw new Error("offline"); }; }],
  ] as const) assert.deepEqual(await unsure(change as any), { kind: "unconfirmed" }, name);
  // A queue with more admin drafts since the submission than the walk will read is not a proof either.
  const flood = setup("admin@example.test", 1000);
  flood.table.dates_event_intake_list = (body: any) => ({ ...list, page: body.page, limit: body.limit, total: 100000,
    intakes: Array.from({ length: 100 }, (_row, index) => ({ ...list.intakes[0], intake_id: "xin_" + (body.page * 1000 + index).toString(16).padStart(32, "0"), created_at: newest })) });
  assert.deepEqual(await readDatesIntakeTombstoneEvidence(flood.send, flood.tombstone, late(1000)), { kind: "unconfirmed" });
  assert.equal(flood.sent.length, 20, "twenty pages, then it gives up without a verdict");
});

test("review recheck: the record of an unanswered submission is still there when the answer is lost, whatever happened to the slot meanwhile", async () => {
  const { sendDatesIntakeSource, readDatesIntakeTombstone } = await import("../lib/datesIntakeTombstone.ts");
  const draft = { kind: "url" as const, url: " https://akvariumklub.hu/programok/acidarab/ ", text: "" };
  const browser = browserStorage();
  // Something empties the slot while the request is in flight (another tab settling its own submission, for instance).
  const deps = { storage: browser.storage, actor: email, now: () => 1790000000, mint: () => KEY, post: async () => { browser.rows.clear(); return null; } };
  assert.deepEqual(await sendDatesIntakeSource(deps, draft, [], "en"), { kind: "uncertain", error: null });
  const kept = readDatesIntakeTombstone(browser.storage, email);
  assert.equal(kept.kind === "pending" && kept.tombstone.key, KEY, "put back");
  assert.doesNotMatch([...browser.rows.values()][0], /akvariumklub/, "the link itself is not stored");
  // A record another tab wrote while this one was hashing its flyer is seen before anything is written or sent.
  const racing = browserStorage(), other = { version: 1, actor: email, key: "dates-intake-create:00000000-0000-4000-8000-00000000000f", at: 1789999990, last_at: 1789999990,
    kind: "text", locale: "hu", fingerprint: "d".repeat(64), files: [] };
  const slow = Object.assign(new Blob([JPEG]), { name: "flyer.jpg", arrayBuffer: async () => { racing.rows.set("friending:dates-intake:create:v1:operator%40example.test", JSON.stringify(other)); return JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length); } });
  let posted = 0;
  assert.deepEqual(await sendDatesIntakeSource({ storage: racing.storage, actor: email, now: () => 1790000000, mint: () => KEY, post: async () => { posted++; return null; } },
    { kind: "images", url: "", text: "" }, [slow], "hu"), { kind: "mismatch" });
  assert.equal(posted, 0); assert.deepEqual(JSON.parse([...racing.rows.values()][0]), other, "the other tab's record is untouched");
});

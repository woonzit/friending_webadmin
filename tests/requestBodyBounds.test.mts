import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readBoundedJsonObject } from "../lib/authPolicy.ts";
import { readBoundedFormData, readBoundedText } from "../lib/boundedStream.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";
import { serverModule } from "./support/adminMembershipServerHarness.mts";
import { chunkedBody, requestBody } from "./support/requestBody.mts";

// Every request body a route reads goes through lib/boundedStream.ts, which stops reading - and cancels the
// body - as soon as the route's limit is passed. Before, a body without a Content-Length was read to its end
// first (`request.text()` / `formData()`), and only then counted: the audit's probe took the server from 19 MB
// to 1,082 MB with one unauthenticated chunked POST of 300 MiB.

const MiB = 1024 * 1024, CHUNK = 64 * 1024, PROBE = 300 * MiB;
const encoder = new TextEncoder();
const SAME_ORIGIN = { origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin" };
const ADMIN = { ...SAME_ORIGIN, "x-friending-admin-request": "1" };
const NextResponse = { json: (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { ...init.headers, "Content-Type": "application/json" } }) };

/** The rule the routes applied before: all of `Request.text()`, then its UTF-8 length. */
async function textThenCount(bytes: Uint8Array, limit: number): Promise<string | null> {
  const text = await new Request("https://bounds.test/", { method: "POST", body: bytes }).text();
  return Buffer.byteLength(text, "utf8") > limit ? null : text;
}
function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("text: every body under, at and over the limit gets the answer `text()` and a byte count gave, in any chunking", async () => {
  const limit = 32, next = random(20261112), bodies: Uint8Array[] = [];
  const ascii = (n: number) => encoder.encode("x".repeat(n));
  for (let n = limit - 3; n <= limit + 5; n++) bodies.push(ascii(n), new Uint8Array([0xef, 0xbb, 0xbf, ...ascii(n)]));
  // A multibyte character ending exactly at, and one byte past, the limit; split, invalid and overlong sequences at the edge.
  for (const tail of ["é", "€", "😀"]) for (const n of [limit - encoder.encode(tail).length, limit - encoder.encode(tail).length + 1]) bodies.push(encoder.encode("x".repeat(n) + tail));
  for (const tail of [[0xff], [0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) for (let n = limit - 4; n <= limit + 1; n++) bodies.push(new Uint8Array([...ascii(n), ...tail]));
  bodies.push(new Uint8Array(limit + 4).fill(0xff), new Uint8Array(0));
  for (let i = 0; i < 400; i++) {
    const length = limit - 8 + Math.floor(next() * 16);
    bodies.push(Uint8Array.from({ length }, () => next() < 0.6 ? 0x61 : [0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xff, 0xef, 0xbb, 0xbf][Math.floor(next() * 13)]));
  }
  for (const bytes of bodies) for (const chunk of [1, 3, CHUNK]) {
    assert.equal(await readBoundedText(requestBody(bytes, { chunk }).body, limit), await textThenCount(bytes, limit), `${Buffer.from(bytes).toString("hex")} / ${chunk}`);
  }
});

test("text: a chunked body over the limit is refused after about the limit, and the rest is cancelled unread", async () => {
  const probe = chunkedBody(PROBE);
  assert.equal(await readBoundedText(probe.body, 4096), null);
  assert.ok(probe.state.pulled <= 4096 + 3 + CHUNK, `pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  const exact = requestBody("x".repeat(4096), { chunk: 1000 });
  assert.equal(await readBoundedText(exact.body, 4096), "x".repeat(4096), "a body of exactly the limit passes");
  assert.equal(await readBoundedText(requestBody("x".repeat(4097)).body, 4096), null);
  assert.equal(await readBoundedText(null, 10), "", "no body reads as the empty text, as text() does");
  await assert.rejects(readBoundedText(new ReadableStream<Uint8Array>({ pull(sink) { sink.error(new Error("DERIVED reset")); } }), 10), "a body that breaks rejects, as text() does");
});

test("login reader: chunked without a length, a lying length, exactly at the limit, and a broken body", async () => {
  const probe = chunkedBody(PROBE);
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers(), body: probe.body }), { kind: "too-large" });
  assert.ok(probe.state.pulled <= 4096 + 3 + CHUNK, `pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  const lying = chunkedBody(MiB);
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers({ "content-length": "10" }), body: lying.body }), { kind: "too-large" });
  assert.ok(lying.state.pulled <= 4096 + 3 + CHUNK); assert.equal(lying.state.cancelled, true);
  const prefix = '{"email":"', suffix = '"}', exact = prefix + "a".repeat(4096 - prefix.length - suffix.length) + suffix;
  assert.equal(encoder.encode(exact).byteLength, 4096);
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers(), body: requestBody(exact, { chunk: 7 }).body }), { kind: "ok", value: JSON.parse(exact) });
  const over = prefix + "é" + "a".repeat(4096 - prefix.length - suffix.length - 1) + suffix;
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers(), body: requestBody(over, { chunk: 11 }).body }), { kind: "too-large" }, "é is two bytes: one past");
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers(), body: null }), { kind: "ok", value: {} }, "an empty body is the empty object, as before");
  assert.deepEqual(await readBoundedJsonObject({ headers: new Headers(), body: new ReadableStream<Uint8Array>({ pull(sink) { sink.error(new Error("DERIVED reset")); } }) }), { kind: "invalid" });
});

/** The browser's multipart for `form`, with its Content-Type. */
async function multipart(form: FormData) {
  const encoded = new Response(form);
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), type: encoded.headers.get("content-type")! };
}
const entries = (form: FormData) => [...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : `${value.name}|${value.type}|${value.size}`]);
/** The headers of a multipart file part whose content then never ends. */
const endlessPart = (field: string) => ({
  type: "multipart/form-data; boundary=DERIVEDboundary",
  prefix: encoder.encode(`--DERIVEDboundary\r\nContent-Disposition: form-data; name="${field}"; filename="probe.png"\r\nContent-Type: image/png\r\n\r\n`),
});

test("form: the same FormData as formData() up to exactly the limit; past it null, the body cancelled", async () => {
  const form = new FormData(); form.set("uid", "123"); form.set("image", new File([new Uint8Array(70_000).fill(7)], "photo.png", { type: "image/png" }));
  const { bytes, type } = await multipart(form);
  const reference = await new Request("https://bounds.test/", { method: "POST", body: bytes, headers: { "content-type": type } }).formData();
  const exact = requestBody(bytes, { chunk: 4096 });
  assert.deepEqual(entries((await readBoundedFormData({ headers: new Headers({ "content-type": type }), body: exact.body }, bytes.byteLength))!), entries(reference));
  const short = requestBody(bytes, { chunk: 4096 });
  assert.equal(await readBoundedFormData({ headers: new Headers({ "content-type": type }), body: short.body }, bytes.byteLength - 1), null);
  assert.equal(short.state.cancelled, true);
  const part = endlessPart("image"), probe = chunkedBody(PROBE, { prefix: part.prefix });
  assert.equal(await readBoundedFormData({ headers: new Headers({ "content-type": part.type }), body: probe.body }, MiB), null);
  assert.ok(probe.state.pulled <= MiB + CHUNK, `pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  await assert.rejects(readBoundedFormData({ headers: new Headers({ "content-type": type }), body: requestBody(bytes.slice(0, 300)).body }, MiB), TypeError,
    "a body that does not parse rejects, as formData() does");
});

test("public login routes: one unauthenticated chunked 300 MiB POST is refused after about 4 KiB and never reaches Core", async () => {
  for (const route of ["request-code", "verify-code"]) {
    const core: string[] = [];
    const module = await serverModule(`app/api/auth/${route}/route.ts`, { NextResponse, coreCall: async (action: string) => { core.push(action); return { status: 200, data: { success: true } }; },
      ADMIN_COOKIE: "flwa_session", adminCookieOptions: () => ({}), issueAdminSession: () => assert.fail("no session for a refused body") });
    const probe = chunkedBody(PROBE);
    const response = await module.POST({ headers: new Headers({ ...SAME_ORIGIN, "content-type": "application/json" }), body: probe.body }) as Response;
    assert.equal(response.status, 413, route); assert.deepEqual(await response.json(), { ok: false, error: "too-large" });
    assert.deepEqual(core, []); assert.ok(probe.state.pulled <= 4096 + 3 + CHUNK, `${route} pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  }
  // A well-formed request is answered as before.
  const sent: unknown[] = [];
  const module = await serverModule("app/api/auth/request-code/route.ts", { NextResponse, coreCall: async (action: string, payload: unknown) => { sent.push([action, payload]); return { status: 200, data: { success: true } }; } });
  const response = await module.POST({ headers: new Headers(SAME_ORIGIN), body: requestBody('{"email":" Bounds@Example.test "}').body }) as Response;
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true }); assert.deepEqual(JSON.parse(JSON.stringify(sent)), [["request_code", { email: "bounds@example.test" }]]);
});

const member = { ...MEMBERSHIP_MEMBER, role: "owner", dates: { email: MEMBERSHIP_EMAIL, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false,
  break_glass: false, capabilities: ["dates_external_event_review", "dates_external_event_manage", "dates_external_event_read"] } };
const writer = { ok: true, session: { email: MEMBERSHIP_EMAIL }, role: "owner", membership: member };

test("admin proxy: a chunked body over the action's limit is refused after the membership check, read no further than the limit", async () => {
  for (const action of ["admin_me", "overview", "set_settings"]) {
    const core: string[] = [];
    const module = await serverModule("app/api/admin/[action]/route.ts", { NextResponse, readAdminSession: async () => ({ email: MEMBERSHIP_EMAIL }),
      coreCall: async (name: string) => { core.push(name); return { status: 200, data: member }; } });
    const { adminActionBodyLimit } = await import("../lib/adminActions.ts"), limit = adminActionBodyLimit(action), probe = chunkedBody(PROBE);
    const response = await module.POST({ headers: new Headers(ADMIN), signal: new AbortController().signal, body: probe.body }, { params: Promise.resolve({ action }) }) as Response;
    assert.equal(response.status, 413, action); assert.deepEqual(await response.json(), { success: false, status_code: 413, error: "too-large" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(core, ["admin_me"], "membership first, then the body; nothing forwarded");
    assert.ok(probe.state.pulled <= limit + 3 + CHUNK, `${action} pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  }
});

test("writer routes: a lying Content-Length does not let persona-member, the CSV export or an upload read past its limit", async () => {
  const text = { "persona-member": 256, "go-preorders-export": 1_024 } as const;
  for (const [route, limit] of Object.entries(text)) {
    const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse, requireAdminWriter: async () => writer, personaAdminCapabilitiesFrom: () => ({}),
      personaCapabilityAllows: () => true, friendingGoConsoleReady: () => true, coreCall: async () => assert.fail("nothing is forwarded") });
    const probe = chunkedBody(PROBE);
    const response = await module.POST({ headers: new Headers({ ...ADMIN, "content-length": "100" }), signal: new AbortController().signal, body: probe.body }) as Response;
    assert.equal(response.status, 413, route); assert.deepEqual(await response.json(), { success: false, status_code: 413, error: "too-large" });
    assert.ok(probe.state.pulled <= limit + 3 + CHUNK, `${route} pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  }
  const uploads = [
    ["upload-image", "image", "image-too-large", 15 * MiB + 512 * 1024], ["upload-video", "video", "video-too-large", 18 * MiB + 512 * 1024],
    ["upload-profile-icon", "icon", "profile-icon-too-large", 2 * MiB + 128 * 1024], ["upload-pinger-icon", "icon", "pinger-icon-too-large", 2 * MiB + 128 * 1024],
    ["support-media", "image", "support-image-too-large", 10 * MiB + 512 * 1024],
  ] as const;
  for (const [route, field, error, limit] of uploads) {
    let decoded = 0;
    const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse, requireAdminWriter: async () => writer,
      normalizeAdminImage: async () => { decoded++; }, normalizeSupportImage: async () => { decoded++; }, validateAdminVideo: () => { decoded++; }, validateAdminProfileIcon: () => { decoded++; },
      coreCall: async () => assert.fail("nothing is forwarded"), coreMultipartCall: async () => assert.fail("nothing is forwarded") });
    const part = endlessPart(field), probe = chunkedBody(PROBE, { prefix: part.prefix });
    const response = await module.POST({ headers: new Headers({ ...ADMIN, "content-length": "100", "content-type": part.type }), signal: new AbortController().signal, body: probe.body }) as Response;
    assert.equal(response.status, 413, route); assert.deepEqual(await response.json(), { success: false, error });
    assert.equal(decoded, 0); assert.ok(probe.state.pulled <= limit + CHUNK, `${route} pulled ${probe.state.pulled}`); assert.equal(probe.state.cancelled, true);
  }
});

test("Dates bridges: the intake flyers and the event artwork are read no further than the limit their declared length was held to", async () => {
  const deps = { NextResponse, randomUUID: () => "bounds-request-id", readAdminSession: async () => ({ email: MEMBERSHIP_EMAIL }),
    coreCall: async (name: string) => name === "admin_me" ? { status: 200, data: member } : assert.fail("nothing is forwarded"),
    coreMultipartFilesCall: async () => assert.fail("nothing is forwarded"), normalizeAdminImage: async () => assert.fail("nothing is decoded") };
  const intake = await serverModule("app/api/admin/dates-intake-create/route.ts", deps), artwork = await serverModule("app/api/admin/dates-external-media/route.ts", deps);
  const part = endlessPart("image_1"), flyers = chunkedBody(PROBE, { prefix: part.prefix });
  let response = await intake.POST({ headers: new Headers({ ...ADMIN, "content-length": "4096", "content-type": part.type }), signal: new AbortController().signal, body: flyers.body }) as Response;
  assert.equal(response.status, 413); assert.equal((await response.json()).error, "image-too-large");
  assert.ok(flyers.state.pulled <= 21 * MiB + CHUNK, `intake pulled ${flyers.state.pulled}`); assert.equal(flyers.state.cancelled, true);
  const image = endlessPart("image"), upload = chunkedBody(PROBE, { prefix: image.prefix });
  response = await artwork.POST({ headers: new Headers({ ...ADMIN, "content-length": "4096", "content-type": image.type }), signal: new AbortController().signal, body: upload.body }) as Response;
  assert.equal(response.status, 413); assert.equal((await response.json()).error, "invalid-input");
  assert.ok(upload.state.pulled <= 11 * MiB + CHUNK, `artwork pulled ${upload.state.pulled}`); assert.equal(upload.state.cancelled, true);
  const json = chunkedBody(PROBE);
  response = await artwork.POST({ headers: new Headers({ ...ADMIN, "content-length": "100", "content-type": "application/json" }), signal: new AbortController().signal, body: json.body }) as Response;
  assert.equal(response.status, 413); assert.equal((await response.json()).error, "invalid-input");
  assert.ok(json.state.pulled <= 16_000 + 3 + CHUNK, `artwork JSON pulled ${json.state.pulled}`); assert.equal(json.state.cancelled, true);
});

test("census: no route or bridge reads a request body except through lib/boundedStream.ts", () => {
  const root = new URL("../", import.meta.url).pathname, files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(join(root, dir))) { const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) walk(path); else if (/\.(ts|tsx)$/.test(name)) files.push(path); } };
  for (const dir of ["app", "lib", "components"]) walk(dir);
  files.splice(files.indexOf("lib/boundedStream.ts"), 1);
  const unbounded = /\b(?:request|req)\.(?:text|json|formData|arrayBuffer|blob)\(\s*\)|\b(?:request|req)\.body\b/g;
  const readers = new Map<string, string[]>();
  for (const path of files) {
    const hits = readFileSync(join(root, path), "utf8").match(unbounded);
    if (hits) readers.set(path, hits);
  }
  // `request.body` is handed only to the bounded readers; nothing calls a whole-body reader of a request.
  for (const [path, hits] of readers) for (const hit of hits) assert.equal(hit, "request.body", `${path}: ${hit}`);
  // The wall-media bridge hands its body to `requestFields`, which reads it with `readBoundedStream` (tests/datesWallMediaBridge.test.mts).
  const bounded = /readBounded(?:Text|FormData|Stream)\(request\.body|readBoundedFormData\(request,|body: request\.body|requestFields\(request\.body\)/;
  for (const [path] of readers) for (const line of readFileSync(join(root, path), "utf8").split("\n").filter((row) => row.includes("request.body"))) {
    assert.match(line, bounded, `${path}: ${line.trim()}`);
  }
});

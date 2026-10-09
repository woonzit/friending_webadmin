import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createAdminMembershipRecovery } from "../lib/adminMembershipRecovery.ts";
import { readBoundedStream } from "../lib/boundedStream.ts";
import { datesEvidenceRead } from "../lib/datesModerationRead.ts";
import { WALL_MEDIA_LIMIT, WALL_MEDIA_TYPES, wallMediaType } from "../lib/datesWallMedia.ts";
import { serveDatesWallMedia, WALL_MEDIA_REQUEST_LIMIT } from "../lib/datesWallMediaBridge.ts";
import { ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE } from "../lib/requestGuard.ts";
import { MEMBERSHIP_MEMBER, membershipRefusal } from "./support/adminMembershipCases.mts";
import { membershipClock } from "./support/adminMembershipClock.mts";
import { serverModule } from "./support/adminMembershipServerHarness.mts";

// The production bridge with DERIVED session, membership and Core transport: no server, no member media.
const email = "operator@example.test";
const fields = { case_id: "cas_" + "a".repeat(32), evidence_id: "evi_" + "b".repeat(32), break_glass: false, include_sensitive_location: false, reason: null as string | null };
const sameOrigin = { origin: "https://admin.example.test", host: "admin.example.test", "x-friending-admin-request": "1", "sec-fetch-site": "same-origin" };
const JPEG = new Uint8Array([255, 216, 255, 217]);
const stream = (value: unknown) => new Response(typeof value === "string" ? value : JSON.stringify(value)).body;
const core = (status_code: number, error: string) => membershipRefusal(status_code, error);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=UTF-8" } });

function harness() {
  const state = { calls: [] as Array<{ action: string; payload: Record<string, unknown>; range: string | null; signal?: AbortSignal }>,
    upstream: (() => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } })) as () => Response | null | Promise<Response | null>,
    role: "moderator", membership: null as null | { status: number; data: unknown }, session: { email } as { email: string } | null, sessionReads: 0 };
  const deps = {
    session: async () => { state.sessionReads++; return state.session; },
    core: async () => state.membership ?? { status: 200, data: { ...MEMBERSHIP_MEMBER, role: "admin", dates: {
      email, role: state.role, rank: 20, linked_uid: null, sensitive_location: false, break_glass: false,
      capabilities: state.role === "moderator" ? ["dates_evidence_read"] : [],
    } } },
    binary: async (action: string, payload: Record<string, unknown>, range: string | null, _timeout?: number, signal?: AbortSignal) => {
      state.calls.push({ action, payload, range, signal }); return state.upstream();
    },
  };
  return { state, deps };
}
const request = (body: unknown = fields, headers: Record<string, string> = sameOrigin, signal?: AbortSignal) => ({ headers: new Headers(headers), body: stream(body), signal });
const errorOf = (reply: Awaited<ReturnType<typeof serveDatesWallMedia>>) => "json" in reply ? (reply.json as { error?: string; status_code?: number }) : null;

test("wall media is private, live-authorized, sent as exactly the five fields of the read and under the session's actor only", async () => {
  const { state, deps } = harness();
  const reply = await serveDatesWallMedia(request({ ...fields, reason: "Checked with the duty lead", break_glass: true }), deps);
  assert.equal(reply.status, 200); assert.ok("bytes" in reply); assert.deepEqual(reply.bytes, JPEG);
  // Never cached, sniffed, embedded elsewhere or referred; the length is the bytes that were read, not a declared one.
  assert.equal(reply.headers["Content-Type"], "image/jpeg"); assert.equal(reply.headers["Content-Length"], String(JPEG.byteLength));
  assert.equal(reply.headers["X-Content-Type-Options"], "nosniff"); assert.equal(reply.headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.match(reply.headers["Cache-Control"], /private/); assert.match(reply.headers["Cache-Control"], /no-store/);
  assert.equal(reply.headers["Referrer-Policy"], "no-referrer"); assert.equal(reply.headers["Content-Security-Policy"], "default-src 'none'; sandbox");
  assert.deepEqual(state.calls.map((call) => [call.action, call.range]), [["dates_wall_evidence_media", null]]);
  assert.deepEqual(state.calls[0].payload, { ...fields, reason: "Checked with the duty lead", break_glass: true, admin_email: email });

  state.upstream = () => new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "Content-Type": "video/mp4; codecs=avc1" } });
  const clip = await serveDatesWallMedia(request(), deps);
  assert.equal(clip.status, 200); assert.equal(clip.headers["Content-Type"], "video/mp4"); assert.equal(clip.headers["Content-Length"], "4");
  // A browser cannot name the actor, nor add a field Core might read.
  for (const extra of [{ admin_email: "attacker@example.test" }, { secret: "x" }, { range: "bytes=0-" }, { kind: "video" }]) {
    assert.equal((await serveDatesWallMedia(request({ ...fields, ...extra }), deps)).status, 400, JSON.stringify(extra));
  }
  assert.equal(state.calls.length, 2);
});

test("another origin, a guest, an unconfirmed or revoked membership and an operator without the capability receive no media - and are answered before the body is looked at", async () => {
  const { state, deps } = harness();
  // A foreign origin, also when it carries the console's own header; and the console's origin without the header.
  for (const headers of [{}, { ...sameOrigin, origin: "https://evil.example" }, { ...sameOrigin, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { ...sameOrigin, "sec-fetch-site": "same-site" }, { origin: sameOrigin.origin, host: sameOrigin.host, "sec-fetch-site": "same-origin" }, { ...sameOrigin, host: "other.example.test" }]) {
    const reply = await serveDatesWallMedia(request(fields, headers), deps);
    assert.equal(reply.status, 403, JSON.stringify(headers)); assert.equal(errorOf(reply)?.error, "bad-origin");
  }
  assert.equal(state.sessionReads, 0, "another origin never reaches the session");

  // Who is asking comes first: without a session a malformed request is still "sign in", never a hint at the request's shape.
  state.session = null;
  for (const body of [fields, { case_id: "nonsense" }, "not json"]) {
    const reply = await serveDatesWallMedia(request(body), deps);
    assert.equal(reply.status, 401); assert.deepEqual(reply.json, { success: false, status_code: 401, error: "auth-required" });
  }
  state.session = { email };
  state.membership = { status: 503, data: { ...MEMBERSHIP_MEMBER } };
  assert.equal(errorOf(await serveDatesWallMedia(request(), deps))?.error, "admin-membership-unconfirmed");
  assert.equal((await serveDatesWallMedia(request({ case_id: "nonsense" }), deps)).status, 503);
  // Core says the operator is no longer one: signed out, not "try again".
  for (const revoked of [{ status: 403, data: core(403, "admin-revoked") }, { status: 401, data: core(401, "admin-session-invalid") }]) {
    state.membership = revoked;
    const reply = await serveDatesWallMedia(request(), deps);
    assert.equal(reply.status, 401, JSON.stringify(revoked.data)); assert.equal(errorOf(reply)?.error, "auth-required");
  }
  state.membership = null; state.role = "support_viewer";
  const denied = await serveDatesWallMedia(request({ case_id: "nonsense" }), deps);
  assert.equal(denied.status, 403); assert.equal(errorOf(denied)?.error, "dates-admin-capability-required");
  assert.equal(state.calls.length, 0, "nothing was asked of Core's media route");
});

test("a request that is not exactly a case, an evidence row and the scope of the read is refused before Core is asked", async () => {
  const { state, deps } = harness();
  const long = "é".repeat(1001);
  for (const changed of [{ case_id: "cas_" + "A".repeat(32) }, { case_id: "cas_" + "a".repeat(31) }, { case_id: "evi_" + "a".repeat(32) }, { case_id: ["cas_" + "a".repeat(32)] },
    { evidence_id: "evi_x" }, { evidence_id: "cas_" + "b".repeat(32) }, { evidence_id: 7 }, { break_glass: "true" }, { break_glass: 1 }, { include_sensitive_location: null },
    { reason: "" }, { reason: "   " }, { reason: 5 }, { reason: long }, { reason: ["why"] }]) {
    const reply = await serveDatesWallMedia(request({ ...fields, ...changed }), deps);
    assert.equal(reply.status, 400, JSON.stringify(changed)); assert.equal(errorOf(reply)?.error, "invalid-input");
  }
  for (const missing of Object.keys(fields)) {
    const body: Record<string, unknown> = { ...fields }; delete body[missing];
    assert.equal((await serveDatesWallMedia(request(body), deps)).status, 400, `without ${missing}`);
  }
  for (const body of ["not json", "[]", "null", "\"cas\"", ""]) assert.equal((await serveDatesWallMedia(request(body), deps)).status, 400, body);
  assert.equal((await serveDatesWallMedia({ headers: new Headers(sameOrigin), body: null }, deps)).status, 400);
  assert.equal((await serveDatesWallMedia(request({ ...fields, reason: "é".repeat(1000) }), deps)).status, 200, "a reason at Core's cap is one");
  state.calls.length = 0;
  // The bound is on the bytes that arrive, whatever length was declared - and a declared one over it is refused unread.
  const big = JSON.stringify({ ...fields, reason: "x".repeat(WALL_MEDIA_REQUEST_LIMIT) });
  const unread = await serveDatesWallMedia(request(big, { ...sameOrigin, "content-length": "120" }), deps);
  assert.equal(unread.status, 413); assert.equal(errorOf(unread)?.error, "too-large");
  assert.equal((await serveDatesWallMedia(request(fields, { ...sameOrigin, "content-length": String(WALL_MEDIA_REQUEST_LIMIT + 1) }), deps)).status, 413);
  assert.equal(state.calls.length, 0);
});

test("what Core answers instead of media is told apart: its refusal, a revoked operator, a failure - and nothing but the two types is ever served", async () => {
  const { state, deps } = harness();
  const answer = async (upstream: () => Response | null | Promise<Response | null>) => { state.upstream = upstream; return serveDatesWallMedia(request(), deps); };
  // Core's refusal travels on under its own status as its six keys, and nothing beside them.
  for (const [status, error] of [[403, "dates-moderation-conflict"], [404, "dates-evidence-unavailable"], [422, "dates-admin-reason-required"], [403, "dates-sensitive-location-capability-required"]] as const) {
    const reply = await answer(() => json({ ...core(status, error), debug: { path: "/srv/evidence/private" } }));
    assert.equal(reply.status, status, error); assert.deepEqual(reply.json, core(status, error));
    assert.match(reply.headers["Cache-Control"], /no-store/);
  }
  // Core is failing: its own word for it under its own status, or - when it cannot be read - the bridge's.
  const failing = await answer(() => json(core(503, "dates-admin-unavailable")));
  assert.equal(failing.status, 503); assert.equal(errorOf(failing)?.error, "dates-admin-unavailable");
  for (const [name, upstream, error] of [
    ["no connection", () => null, "core-unavailable"],
    ["a transport that throws", () => Promise.reject(new Error("DERIVED secret missing")), "core-unavailable"],
    ["the web server's own 500", () => json(core(403, "dates-moderation-conflict"), 500), "invalid-core-response"],
    ["HTML", () => new Response("<script>alert(1)</script>", { headers: { "Content-Type": "text/html" } }), "invalid-core-response"],
    ["an image type that is not one of the two", () => new Response(JPEG, { headers: { "Content-Type": "image/svg+xml" } }), "invalid-core-response"],
    ["no type at all", () => new Response(JPEG, { headers: { "Content-Type": "" } }), "invalid-core-response"],
    ["a JSON success", () => json({ ...MEMBERSHIP_MEMBER }), "invalid-core-response"],
    ["a refusal without a status", () => json({ success: false, error: "dates-moderation-conflict" }), "invalid-core-response"],
    ["an empty picture", () => new Response(new Uint8Array(0), { headers: { "Content-Type": "image/jpeg" } }), "invalid-core-response"],
    ["a clip over Core's cap", () => new Response(new Uint8Array(WALL_MEDIA_LIMIT + 1), { headers: { "Content-Type": "video/mp4" } }), "invalid-core-response"],
  ] as const) {
    const reply = await answer(upstream as () => Response | null | Promise<Response | null>);
    assert.equal(reply.status, 502, name); assert.equal(errorOf(reply)?.error, error, name); assert.equal("bytes" in reply, false, name);
  }
  assert.equal((await answer(() => new Response(new Uint8Array(WALL_MEDIA_LIMIT), { headers: { "Content-Type": "video/mp4" } }))).status, 200, "a clip at the cap is served");
  // Revoked between the membership check and the read: signed out, as on every other bridge. An unknown 401 is not a sign-out.
  for (const [status, error] of [[403, "admin-revoked"], [401, "admin-session-invalid"]] as const) {
    const reply = await answer(() => json(core(status, error)));
    assert.equal(reply.status, 401, error); assert.deepEqual(reply.json, { success: false, status_code: 401, error: "auth-required" });
  }
  const unknown = await answer(() => json(core(401, "unauthorized")));
  assert.equal(unknown.status, 502); assert.equal(errorOf(unknown)?.error, "invalid-core-response");
});

test("a browser that gives up stops the read of Core: its signal travels on, a late answer is dropped and its body cancelled", async () => {
  const { state, deps } = harness();
  const controller = new AbortController(); let cancelled = 0;
  state.upstream = () => {
    controller.abort();
    return new Response(new ReadableStream<Uint8Array>({ pull(sink) { sink.enqueue(JPEG); }, cancel() { cancelled++; } }), { headers: { "Content-Type": "image/jpeg" } });
  };
  const reply = await serveDatesWallMedia(request(fields, sameOrigin, controller.signal), deps);
  assert.equal(reply.status, 504); assert.equal(errorOf(reply)?.error, "core-timeout"); assert.equal("bytes" in reply, false);
  assert.equal(state.calls[0].signal, controller.signal, "the transport is given the request's own signal");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1, "the unread answer is cancelled, not left open");
  // Given up while the bytes arrive: nothing partial is served.
  const during = new AbortController(); let sent = 0, stopped = 0;
  state.upstream = () => new Response(new ReadableStream<Uint8Array>({
    pull(sink) { if (++sent === 2) during.abort(); sink.enqueue(new Uint8Array(1024)); }, cancel() { stopped++; },
  }), { headers: { "Content-Type": "video/mp4" } });
  const partial = await serveDatesWallMedia(request(fields, sameOrigin, during.signal), deps);
  assert.equal(partial.status, 504); assert.equal("bytes" in partial, false); assert.equal(stopped, 1);
  // Given up before Core was asked: nothing is asked.
  const before = new AbortController(); before.abort(); state.calls.length = 0;
  assert.equal((await serveDatesWallMedia(request(fields, sameOrigin, before.signal), deps)).status, 503);
  assert.equal(state.calls.length, 0);
  // The transport itself: Core's binary call takes the signal and stops with it.
  const source = readFileSync(new URL("../lib/core.ts", import.meta.url), "utf8");
  assert.match(source, /signal: signal \? AbortSignal\.any\(\[signal, AbortSignal\.timeout\(timeoutMs\)\]\) : AbortSignal\.timeout\(timeoutMs\)/);
});

test("one bounded reader serves the request body and Core's bytes; the route adds nothing of its own", async () => {
  const chunks = (sizes: number[], onCancel = () => undefined) => { let index = 0; return new ReadableStream<Uint8Array>({
    pull(sink) { if (index === sizes.length) sink.close(); else sink.enqueue(new Uint8Array(sizes[index++]).fill(index)); }, cancel: onCancel }); };
  assert.deepEqual(await readBoundedStream(chunks([2, 3]), 5), new Uint8Array([1, 1, 2, 2, 2]));
  assert.deepEqual(await readBoundedStream(chunks([]), 5), new Uint8Array(0));
  let cancelled = 0;
  assert.equal(await readBoundedStream(chunks([4, 4, 4], () => { cancelled++; }), 7), null); assert.equal(cancelled, 1, "the rest is never read");
  const gone = new AbortController(); gone.abort();
  assert.equal(await readBoundedStream(chunks([1]), 5, gone.signal), null);
  await assert.rejects(readBoundedStream(new ReadableStream<Uint8Array>({ pull(sink) { sink.error(new Error("DERIVED reset")); } }), 5));
  const route = readFileSync(new URL("../app/api/admin/dates-wall-media/route.ts", import.meta.url), "utf8");
  assert.match(route, /serveDatesWallMedia\(\s*\{ headers: request\.headers, body: request\.body, signal: request\.signal \},\s*\{ session: readAdminSession, core: coreCall, binary: coreBinaryCall \},/);
  assert.doesNotMatch(route, /getReader|JSON\.parse|export async function (GET|PUT|DELETE|PATCH)/, "POST only, and no second reader");
  assert.doesNotMatch(readFileSync(new URL("../lib/datesWallMediaBridge.ts", import.meta.url), "utf8"), /getReader|a-f0-9/, "the shared reader and the shared id rule");
});

test("private video object URLs are playable without granting blob scripts or connections", async () => {
  const { contentSecurityPolicy } = await import("../next.config.mjs");
  const directives = new Map<string, string[]>(contentSecurityPolicy.split(";").map((part: string) => {
    const [name, ...sources] = part.trim().split(/\s+/); return [name!, sources];
  }));
  assert.deepEqual(directives.get("media-src"), ["'self'", "https:", "blob:"]);
  assert.equal(directives.get("script-src")?.includes("blob:"), false);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
});

// ---------------------------------------------------------------- the browser's side

/** The production client module with a DERIVED fetch, window and timer - as tests/supportImageRetry.test.mts runs it. */
async function client(respond: () => Response | Promise<Response>) {
  const time = membershipClock(), redirects: string[] = [], calls: Array<{ url: string; options: RequestInit }> = [];
  const api = await serverModule("lib/adminClient.ts", {
    window: { location: { assign: (url: string) => redirects.push(url) } },
    createAdminMembershipRecovery: (probe: Parameters<typeof createAdminMembershipRecovery>[0], redirect: () => void) => createAdminMembershipRecovery(probe, redirect, time.clock),
    fetch: async (url: string, options: RequestInit) => { calls.push({ url, options }); return respond(); },
  }) as typeof import("../lib/adminClient.ts");
  return { api, redirects, calls };
}

test("the browser asks through the console's own header, is signed out on a definite 401 and starts the membership recovery on an unconfirmed one", async () => {
  const body = { case_id: fields.case_id, evidence_id: fields.evidence_id, reason: "Read for the open case", break_glass: false, include_sensitive_location: true };
  const served = await client(() => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } }));
  const media = await served.api.adminWallEvidenceMedia(body);
  assert.ok(media instanceof Blob); assert.equal(media.type, "image/jpeg"); assert.equal(media.size, JPEG.byteLength);
  assert.equal(served.calls.length, 1); assert.equal(served.calls[0].url, "/api/admin/dates-wall-media");
  const sent = served.calls[0].options;
  assert.equal(sent.method, "POST"); assert.equal(sent.cache, "no-store"); assert.deepEqual(JSON.parse(String(sent.body)), body);
  assert.equal(new Headers(sent.headers).get(ADMIN_REQUEST_HEADER), ADMIN_REQUEST_HEADER_VALUE);

  const signedOut = await client(() => json({ success: false, status_code: 401, error: "auth-required" }, 401));
  assert.equal(await signedOut.api.adminWallEvidenceMedia(body), null); assert.deepEqual(signedOut.redirects, ["/login"]);
  // A refusal is the caller's to show; it is not a sign-out.
  const refused = await client(() => json(core(403, "dates-moderation-conflict"), 403));
  assert.deepEqual(await refused.api.adminWallEvidenceMedia(body), core(403, "dates-moderation-conflict")); assert.deepEqual(refused.redirects, []);
  const unconfirmed = await client(() => json({ success: false, status_code: 503, error: "admin-membership-unconfirmed" }, 503));
  assert.equal(unconfirmed.api.adminMembershipRecovery.getSnapshot(), false);
  assert.equal((await unconfirmed.api.adminWallEvidenceMedia(body) as { error?: string }).error, "admin-membership-unconfirmed");
  assert.equal(unconfirmed.api.adminMembershipRecovery.getSnapshot(), true, "the console's membership recovery is started"); assert.deepEqual(unconfirmed.redirects, []);
  const dropped = await client(() => Promise.reject(new Error("DERIVED dropped connection")));
  assert.equal((await dropped.api.adminWallEvidenceMedia(body) as { error?: string }).error, "admin-membership-unconfirmed");
  assert.equal(dropped.api.adminMembershipRecovery.getSnapshot(), true);
  const given = new AbortController(); given.abort();
  const abandoned = await client(() => assert.fail("an abandoned read is not sent"));
  assert.equal(await abandoned.api.adminWallEvidenceMedia(body, given.signal), null); assert.equal(abandoned.calls.length, 0);

  const component = readFileSync(new URL("../components/DatesWallEvidenceMedia.tsx", import.meta.url), "utf8");
  assert.match(component, /adminWallEvidenceMedia\(\{ case_id: caseId, evidence_id: evidenceId, \.\.\.access \}, controller\.signal\)/);
  assert.match(component, /answer\.size <= WALL_MEDIA_LIMIT/);
  assert.doesNotMatch(component, /fetch\(|x-friending-admin-request|1024/, "the shared client, header and size constant");
  assert.deepEqual([...WALL_MEDIA_TYPES], ["image/jpeg", "video/mp4"]);
  assert.equal(wallMediaType({ wall_media: { mime: "video/mp4" } }), "video/mp4");
  for (const snapshot of [null, [], "x", {}, { wall_media: null }, { wall_media: { mime: "image/svg+xml" } }, { wall_media: { mime: ["image/jpeg"] } }]) assert.equal(wallMediaType(snapshot), null);
});

test("the media of an evidence list is read with the scope that list was read with, not with what the form says afterwards", async () => {
  const path = "../app/(dashboard)/dates/moderation/[caseId]/page.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true);
  let handler: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "readEvidence") handler = node; else ts.forEachChild(node, visit); };
  visit(tree); assert.ok(handler);
  const code = ts.transpileModule(`${handler.getText(tree)}\nexports.readEvidence = readEvidence;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const wire = JSON.parse(readFileSync(new URL("./fixtures/dates_moderation_wire/admin-evidence-report-moderator.json", import.meta.url), "utf8"));
  const sent: Record<string, unknown>[] = [], shown: any[] = [];
  // The production handler; the hooks' setters, the fence and the transport are DERIVED seams.
  const context: any = { exports: {}, data: { case: { conflict_of_interest: true, target_type: "message" }, appeal: null }, principal: { email }, busy: false,
    breakGlass: true, evidenceSensitive: true, evidenceReason: "  Conflict cleared by the duty lead  ", caseId: wire.case_id,
    datesExternalReviewAllowed: () => true, isDatesExternalMessageCase: () => false, readFence: { begin: () => 1, accepts: () => true },
    adminCall: async (action: string, body: Record<string, unknown>) => { sent.push({ action, ...body }); return { ...wire, break_glass_used: true }; },
    datesEvidenceRead, t: (key: string) => key, adminMembershipFailureText: () => "failed", membership: (key: string) => key,
    setEvidence: (value: unknown) => { shown.push(value); }, setBusy: () => undefined, setFeedback: () => undefined };
  vm.runInNewContext(code, context);
  await context.exports.readEvidence({ preventDefault() {} });
  const scope = { include_sensitive_location: true, break_glass: true, reason: "Conflict cleared by the duty lead" };
  assert.deepEqual(sent, [{ action: "dates_moderation_evidence", case_id: wire.case_id, ...scope }]);
  assert.equal(shown[0], null); assert.deepEqual({ ...shown.at(-1).sent }, scope, "the list keeps the scope it was read with");
  // The operator goes on typing: the list on the screen - and so its media - still carries the scope that was sent.
  context.evidenceReason = "something else entirely"; context.breakGlass = false;
  assert.deepEqual({ ...shown.at(-1).sent }, scope);
  assert.match(source, /<DatesWallEvidenceMedia source=\{entry\.snapshot\} caseId=\{item\.case_id\} evidenceId=\{String\(entry\.evidence_id\)\} access=\{evidence\.sent\} \/>/);
  assert.doesNotMatch(source, /reason=\{evidenceReason\}|sensitive=\{evidenceSensitive\}/);
  const component = readFileSync(new URL("../components/DatesWallEvidenceMedia.tsx", import.meta.url), "utf8");
  assert.match(component, /JSON\.stringify\(\[caseId, evidenceId, access\.break_glass, access\.include_sensitive_location, access\.reason\]\)/);
});

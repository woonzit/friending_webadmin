import test from "node:test";
import assert from "node:assert/strict";
import { decodeExternalMedia, decodeExternalMediaPending, externalMediaNoWrite, normalizeExternalMediaRequest } from "../lib/datesExternalMedia.ts";
import { serveExternalMedia } from "../lib/datesExternalMediaBridge.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_EMAIL, membershipRefusal } from "./support/adminMembershipCases.mts";

const XEV = "xev_" + "1".repeat(32), ACT = "act_" + "2".repeat(32), PIC = "pic_" + "3".repeat(32);
const env = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1800000000 };
const media = { contract_version: 1, external_event_id: XEV, activity_id: ACT, revision: 2, activity_revision: 2, maximum_photos: 8,
  photos: [{ id: PIC, url: "https://img.example.test/owned.jpg", moderation_state: "approved" }], featured_photo_id: PIC, can_manage: true };
const read = { ...env, media };
const receipt = { ...read, replayed: false, audit_id: "aud_" + "4".repeat(32) };
const upload = { action: "upload", external_event_id: XEV, expected_revision: 1, reason: "Our generated event illustration.",
  idempotency_key: "external-media:00000000-0000-4000-8000-000000000001", provenance: "ai_generated", rights_confirmed: "1" };
const headers = (multipart = false, sameOrigin = true) => new Headers({ origin: sameOrigin ? "https://admin.example.test" : "https://evil.example.test",
  host: "admin.example.test", "x-friending-admin-request": "1", "content-length": "2000", "content-type": multipart ? "multipart/form-data; boundary=test" : "application/json" });

test("external artwork has a closed, bounded, coherent featured-photo contract", () => {
  assert.deepEqual(decodeExternalMedia(read, XEV), media);
  assert.deepEqual(decodeExternalMedia(receipt, XEV, true), media);
  for (const patch of [{ maximum_photos: 10 }, { revision: "2" }, { contract_version: 2 }, { featured_photo_id: null }, { external_event_id: ACT },
    { photos: [...media.photos, ...media.photos] }, { photos: Array(9).fill(media.photos[0]) }, { photos: [{ ...media.photos[0], storage_path: "/private" }] },
    { photos: [{ ...media.photos[0], url: "javascript:alert(1)" }] }, { photos: [{ ...media.photos[0], moderation_state: "ok" }] }])
    assert.equal(decodeExternalMedia({ ...read, media: { ...media, ...patch } }, XEV), null, JSON.stringify(patch));
  for (const bad of [{ ...read, error: "contradiction" }, { ...read, status_code: 503 }, { ...read, can_send: 1 }, { ...receipt, audit_id: XEV }, { ...receipt, replayed: "false" }])
    assert.equal(decodeExternalMedia(bad, XEV, true), null);
});
test("browser input cannot supply an actor, Core path, URL, gallery, or unstated image rights", () => {
  assert.deepEqual(normalizeExternalMediaRequest(upload), upload);
  assert.equal(normalizeExternalMediaRequest({ ...upload, expected_revision: "1" })?.expected_revision, 1);
  assert.ok(normalizeExternalMediaRequest({ action: "read", external_event_id: XEV }));
  for (const patch of [{ admin_email: "attacker@example.test" }, { image_url: "https://other.example.test/image" }, { photos: [] }, { rights_confirmed: true },
    { provenance: "website" }, { expected_revision: "01" }, { reason: "x" }, { reason: "bad\u0000text" }, { idempotency_key: "short" }, { action: "purge" }])
    assert.equal(normalizeExternalMediaRequest({ ...upload, ...patch }), null);
  assert.equal(normalizeExternalMediaRequest({ action: "read", external_event_id: XEV, expected_revision: 1 }), null);
});
test("reload recovery retains the exact actor, target, revision, request key and file hash", () => {
  const pending = { version: 1, actor: MEMBERSHIP_EMAIL, request: upload, file_sha256: "a".repeat(64) };
  assert.deepEqual(decodeExternalMediaPending(pending, MEMBERSHIP_EMAIL, XEV), pending);
  assert.equal(decodeExternalMediaPending(pending, "other@example.test", XEV), null);
  assert.equal(decodeExternalMediaPending(pending, MEMBERSHIP_EMAIL, ACT), null);
  for (const patch of [{ file_sha256: null }, { version: 2 }, { file_sha256: "short" }, { file: "bytes must not live in localStorage" }])
    assert.equal(decodeExternalMediaPending({ ...pending, ...patch }, MEMBERSHIP_EMAIL, XEV), null);
});
test("a rejected image can be replaced, while timeouts and malformed results retain the original request", () => {
  assert.equal(externalMediaNoWrite({ success: false, status_code: 422, error: "image-invalid" }), "invalidFile");
  assert.equal(externalMediaNoWrite(membershipRefusal(422, "dates-photo-dimensions-invalid")), "invalidFile");
  assert.equal(externalMediaNoWrite(membershipRefusal(409, "dates-external-media-duplicate")), "duplicate");
  assert.equal(externalMediaNoWrite(membershipRefusal(403, "dates-external-publishing-disabled")), "publishingDisabled");
  for (const refusal of [membershipRefusal(503, "dates-photo-storage-unavailable"), membershipRefusal(409, "dates-admin-idempotency-conflict"),
    { success: false, status_code: 409, error: "dates-external-conflict" }, { success: true, error: "image-invalid", status_code: 422 }, null])
    assert.equal(externalMediaNoWrite(refusal), null);
});

function member(row: typeof MEMBERSHIP_CASES[number], manage = true) {
  if (row.kind !== "confirmed") return row.data;
  return { ...(row.data as object), dates: { email: MEMBERSHIP_EMAIL, role: manage ? "administrator" : "support_viewer", rank: manage ? 40 : 10,
    linked_uid: null, sensitive_location: false, break_glass: false, capabilities: ["dates_external_event_read", ...(manage ? ["dates_external_event_manage"] : [])] } };
}
async function bridge(config: { mode?: "read" | "upload" | "feature"; row?: typeof MEMBERSHIP_CASES[number]; guest?: boolean; manage?: boolean;
  origin?: boolean; raw?: unknown; form?: FormData; result?: { status: number; data: unknown }; abandon?: boolean } = {}) {
  const mode = config.mode ?? "read", row = config.row ?? MEMBERSHIP_CASES[0], controller = new AbortController();
  const calls: { action: string; payload: Record<string, unknown>; files?: unknown[] }[] = [];
  let parsed = 0, normalized = 0;
  const call = async (action: string, payload: Record<string, unknown>, _timeout?: number, options?: any) => {
    assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
    if (action === "admin_me") { if (row.abandoned) controller.abort(); return { status: row.status, data: member(row, config.manage !== false) }; }
    calls.push({ action, payload }); if (config.abandon) controller.abort();
    assert.equal(options.strictResponse, true); return config.result ?? { status: 200, data: mode === "read" ? read : receipt };
  };
  const form = config.form ?? new FormData();
  if (!config.form) {
    for (const [key, value] of Object.entries(upload)) form.set(key, String(value));
    form.set("image", new File(["DERIVED normalized by injected decoder"], "art.png", { type: "image/png" }));
  }
  const reply = await serveExternalMedia({ headers: headers(mode === "upload", config.origin !== false), signal: controller.signal,
    json: async () => { parsed++; return config.raw ?? (mode === "read" ? { action: "read", external_event_id: XEV }
      : { action: "feature", external_event_id: XEV, expected_revision: 1, photo_id: PIC, reason: "Choose featured artwork.", idempotency_key: upload.idempotency_key }); },
    form: async () => { parsed++; return form; } }, {
    session: async () => config.guest ? null : { email: MEMBERSHIP_EMAIL }, core: call,
    coreFiles: async (action, payload, files, timeout, options) => { const result = await call(action, payload, timeout, options); calls[calls.length - 1].files = files; return result; },
    normalize: async () => { normalized++; return { buffer: Buffer.from("DERIVED metadata-free JPEG"), mime: "image/jpeg", width: 320, height: 200 }; },
    requestId: () => "external-media-test-request-0001",
  });
  return { reply, calls, parsed, normalized };
}
for (const row of MEMBERSHIP_CASES) for (const mode of ["read", "upload"] as const) test(`artwork bridge ${mode}: ${row.name}`, async () => {
  const r = await bridge({ row, mode });
  const expected = row.kind === "unconfirmed" ? 503 : row.kind === "revoked" ? 401 : 200;
  assert.equal(r.reply.status, expected); assert.match(r.reply.headers["Cache-Control"], /no-store/);
  assert.equal(r.calls.length, expected === 200 ? 1 : 0); assert.equal(r.parsed, expected === 200 ? 1 : 0);
});
test("guest, foreign origin and viewer cannot send image bytes or image commands", async () => {
  for (const config of [{ guest: true, expected: 401 }, { origin: false, expected: 403 }, { manage: false, expected: 403 }]) {
    for (const mode of ["upload", "feature"] as const) {
      const r = await bridge({ ...config, mode }); assert.equal(r.reply.status, config.expected); assert.equal(r.calls.length, 0); assert.equal(r.normalized, 0);
    }
  }
});
test("upload forwards normalized bytes to exactly one fixed Core route with the authenticated actor", async () => {
  const r = await bridge({ mode: "upload" }); assert.equal(r.reply.status, 200); assert.equal(r.normalized, 1);
  assert.equal(r.calls[0].action, "dates_external_event_media_upload");
  assert.equal(r.calls[0].payload.rights_confirmed, "1"); assert.equal(r.calls[0].payload.action, undefined);
  assert.equal((r.calls[0].files![0] as any).mime, "image/jpeg");
  const form = new FormData(); for (const [key, value] of Object.entries(upload)) form.set(key, String(value)); form.append("reason", "duplicate");
  assert.equal((await bridge({ mode: "upload", form })).reply.status, 400);
});
test("late, malformed and wrong-revision results never become confirmed uploads", async () => {
  for (const config of [{ abandon: true }, { result: { status: 200, data: { ...receipt, media: { ...media, revision: 99 } } } },
    { result: { status: 503, data: receipt } }, { result: { status: 200, data: { success: true } } }]) {
    const r = await bridge({ mode: "upload", ...config }); assert.notEqual(r.reply.status, 200); assert.equal(r.calls.length, 1);
  }
  const revoked = await bridge({ result: { status: 403, data: membershipRefusal(403, "admin-revoked") } }); assert.equal(revoked.reply.status, 401);
});

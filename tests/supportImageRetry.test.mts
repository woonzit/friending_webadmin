import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createAdminMembershipRecovery } from "../lib/adminMembershipRecovery.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_EMAIL, MEMBERSHIP_LEGACY, membershipRefusal } from "./support/adminMembershipCases.mts";
import { DerivedNextResponse, serverModule, sessionHarness, writerRequest } from "./support/adminMembershipServerHarness.mts";
import { membershipClock } from "./support/adminMembershipClock.mts";

// Production support page handler + client + protected media route. Socket,
// normalization, hook setters and stored receipt are DERIVED controlled seams,
// not a mounted browser, live Core or real member message/storage operation.
const source = readFileSync(new URL("../app/(dashboard)/support/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("support.tsx", source, ts.ScriptTarget.Latest, true);
let handler: ts.FunctionDeclaration | undefined;
const visit = (node: ts.Node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "sendImage") handler = node;
  else ts.forEachChild(node, visit);
};
visit(tree);
assert.ok(handler);
const code = ts.transpileModule(`${handler.getText(tree)}\nexports.sendImage = sendImage;`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
type Intent = { uid: number; file: File; requestId: string };
function page(upload: (uid: number, file: File, requestId: string) => Promise<unknown>) {
  const state = { failed: null as Intent | null, error: "", conversationLoads: 0, threadLoads: 0 };
  const context: any = { exports: {}, imageSending: false, sending: false, adminUploadSupportImage: upload,
    conversationGenerationRef: { current: 1 }, t: (key: string) => key,
    setImageSending: (busy: boolean) => { context.imageSending = busy; },
    setSendError: (message: string) => { state.error = message; },
    setFailedImage: (value: Intent | null | ((current: Intent | null) => Intent | null)) => {
      state.failed = typeof value === "function" ? value(state.failed) : value;
    },
    loadConversation: async () => { state.conversationLoads++; }, loadThreads: async () => { state.threadLoads++; },
  };
  vm.runInNewContext(code, context);
  return { state, context, send: context.exports.sendImage as (intent: Intent) => Promise<void> };
}
const intent = () => ({ uid: 123, file: new File(["DERIVED upload"], "derived.png", { type: "image/png" }), requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });

for (const firstAnswer of [
  { name: "complete 503 support-storage-unavailable", status: 503, data: membershipRefusal(503, "support-storage-unavailable"), bridgeStatus: 503, bridgeError: "support-storage-unavailable" },
  { name: "unreadable Core 500", status: 500, data: null, bridgeStatus: 502, bridgeError: "invalid-core-response" },
]) test(`DERIVED support image: ${firstAnswer.name} retains the intent; explicit Retry reuses its original request id`, async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]), time = membershipClock();
  const forwarded: Record<string, unknown>[] = [], bridgeAnswers: { status: number; data: any }[] = [];
  const stored = new Map<string, unknown>();
  const route = await serverModule("app/api/admin/support-media/route.ts", {
    NextResponse: DerivedNextResponse, requireAdminWriter: h.api.requireAdminWriter,
    normalizeSupportImage: async () => ({ buffer: Buffer.from("DERIVED normalized JPEG"), mime: "image/jpeg" }),
    coreMultipartCall: async (action: string, payload: Record<string, unknown>) => {
      assert.equal(action, "support_send"); assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      forwarded.push(payload);
      const key = String(payload.request_id);
      if (!stored.has(key)) stored.set(key, { ...MEMBERSHIP_LEGACY, success: true, status_code: 200,
        message: { id: "DERIVED-message", smid: 91, kind: "image", request_id: key } });
      // Model a message stored before its answer is lost/refused. A new key
      // would create another message; the same key returns this stored receipt.
      return forwarded.length === 1 ? { status: firstAnswer.status, data: firstAnswer.data } : { status: 200, data: stored.get(key) };
    },
  });
  const client = await serverModule("lib/adminClient.ts", {
    window: { location: { assign: () => assert.fail("unknown feature outcome must not log out") } },
    createAdminMembershipRecovery: (probe: any, redirect: any) => createAdminMembershipRecovery(probe, redirect, time.clock),
    fetch: async (url: string, options: RequestInit) => {
      assert.equal(url, "/api/admin/support-media", "no automatic probe or repeat is needed for a readable feature failure");
      const incoming = writerRequest(h.controller.signal);
      incoming.request.formData = async () => options.body as FormData;
      const response = await route.POST(incoming.request) as Response;
      bridgeAnswers.push({ status: response.status, data: await response.clone().json() });
      return response;
    },
  }) as typeof import("../lib/adminClient.ts");
  const ui = page(client.adminUploadSupportImage), original = intent();
  await ui.send(original);
  assert.equal(ui.context.imageSending, false);
  assert.equal(ui.state.failed, original); assert.equal(ui.state.error, "imageSendError");
  assert.equal(bridgeAnswers[0].status, firstAnswer.bridgeStatus); assert.equal(bridgeAnswers[0].data.error, firstAnswer.bridgeError);
  assert.equal(forwarded.length, 1); assert.equal(stored.size, 1);
  assert.equal(client.adminWriteOutcomeNotice.getSnapshot(), true, "a storage refusal does not prove nothing was written");
  assert.equal(time.jobs.size, 0, "a readable feature failure schedules no automatic recovery/repeat");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(forwarded.length, 1, "neither recovery nor a timer repeats the send");
  assert.match(source, /onClick=\{\(\) => void sendImage\(failedImage\)\}/, "the actual Retry button passes the retained intent");
  await ui.send(ui.state.failed!);
  assert.deepEqual(forwarded.map(body => body.request_id), [original.requestId, original.requestId]);
  assert.equal(h.calls.length, 2, "each explicit send independently proves current membership");
  assert.equal(stored.size, 1, "Retry converges to one simulated stored message, never a new logical send");
  assert.equal(ui.state.failed, null); assert.equal(ui.context.imageSending, false);
  assert.equal(ui.state.conversationLoads, 1); assert.equal(ui.state.threadLoads, 1);
});

test("DERIVED support image: only exact input/moderation conflicts are final, never a transport code containing invalid", async () => {
  for (const error of ["support-image-under-review", "support-idempotency-conflict", "invalid-input", "support-user-invalid",
    "support-message-xor-invalid", "support-request-id-invalid", "support-image-invalid", "support-image-format-invalid",
    "support-image-dimensions-invalid", "support-image-too-large"]) {
    const ui = page(async () => ({ success: false, error })); await ui.send(intent());
    assert.equal(ui.state.failed, null, error); assert.equal(ui.context.imageSending, false);
  }
  for (const error of ["invalid-core-response", "support-storage-unavailable", "support-image-storage-unavailable", "future-invalid-answer", "future-too-large-answer", ""]) {
    const ui = page(async () => ({ success: false, error })), original = intent(); await ui.send(original);
    assert.equal(ui.state.failed, original, error); assert.equal(ui.context.imageSending, false);
  }
});

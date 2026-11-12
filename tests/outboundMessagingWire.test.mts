import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  OUTBOUND_MESSAGING_ACTIONS,
  OUTBOUND_MESSAGING_ERROR_STATUSES,
  mergeOutboundHistoryPages,
  normalizeOutboundMessagingResponse,
  outboundHistoryDetailMatchesEntry,
  outboundHistoryDetailPayload,
  outboundHistoryDetailResponse,
  outboundHistoryPayload,
  outboundHistoryResponse,
  outboundMessagingAccess,
  outboundMessagingErrorResponse,
  outboundPreviewPayload,
  outboundRecipientPreviewResponse,
  outboundSendOutcome,
  type OutboundSendPayload,
} from "../lib/outboundMessaging.ts";

/**
 * Core's outbound-messaging wire corpus (contract `outbound-messaging-webadmin-v1`): 51 bodies Core's route
 * table answered to the bridge's exact form fields, for owner, admin, viewer, a revoked operator and a wrong
 * server secret. Every body is decoded here by the console's own decoders and its bridge projection, as Core
 * means it. THE PIN (docs/WIRE_CORPUS_PINNING.md): re-vendoring is one step, copy the directory from the Core
 * commit's git objects and replace these values with what the new files say. A changed `set` means a BODY
 * changed: stop and review, not a re-pin.
 */
const PIN = {
  /** The Core commit the directory was copied from (lane tip, branch claude/outbound-verify-20261112). */
  core: "1eb790b17a3f94ce405fc9ff4a636937c2f4e56c",
  /** sha256 of manifest.json. */
  manifest: "fe755a242e760277722444aa6843a863e9b57ec56da1d7a962dd987b6f8113bc",
  /** The manifest's source binding (an ancestor of `core`). */
  source_commit: "1b3fba21a2e95717a1e224441cf2d227fe413393",
  /** `fixture_set_sha256`: the 51 bodies. */
  set: "cdc9b1b9995d681752e3d1354a81b34d799392620925388944cd388398269274",
  /** sha256 of Core's generator, tests/outbound_messaging_wire_capture_test.php. */
  generator: "9fdd0ec5ba22f222dec7e1f6f23e3dae3629b93ed895d8ad702f2d08e288c187",
};

type Json = Record<string, any>;
type Entry = { file: string; route: string; consumer: string; http_status: number; status_code: number; sha256: string; extract?: string };
const DIRECTORY = new URL("./fixtures/outbound_messaging_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, DIRECTORY));
const body = (file: string): Json => JSON.parse(bytes(file).toString("utf8"));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MANIFEST = body("manifest.json") as { schema_version: number; contract: string; source_commit: string; fixture_set_sha256: string;
  selectors: Json; provenance: Json; fixtures: Entry[] };
const actionOf = (entry: Entry) => entry.route.replace(/^\/v1\/webadmin\//, "");

/** A send the answer binds: its request id, preview, channel and members; the content is not read back. */
function sendFor(data: Json | null, label: string, uids = "4201"): OutboundSendPayload {
  const type = data?.channel ?? "push";
  return {
    contract_version: 1, preview_id: data?.preview_id ?? "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    uids: data ? data.results.map((row: Json) => row.uid).join(",") : uids, type, content_source: "custom", template_id: "",
    template_revision: 0, subject: type === "sms" ? "" : "Subject", body: "Body", allow_partial: 0, expected_revision: 0,
    request_id: data?.request_id ?? "6a000000-0000-4000-8000-0000000000ff", audit_reason: label,
  };
}

test("the outbound corpus is Core's, byte for byte, pinned to the lane tip", () => {
  assert.equal(sha256(bytes("manifest.json")), PIN.manifest);
  assert.deepEqual([MANIFEST.schema_version, MANIFEST.contract, MANIFEST.source_commit, MANIFEST.fixture_set_sha256, MANIFEST.provenance.generator_sha256],
    [1, "outbound-messaging-webadmin-v1", PIN.source_commit, PIN.set, PIN.generator]);
  assert.equal(MANIFEST.provenance.generator, "tests/outbound_messaging_wire_capture_test.php");
  // The selector the capture sent with every call is the one this console's bodies carry.
  assert.deepEqual(MANIFEST.selectors, { webadmin: { contract_version: 1 } });
  assert.equal(MANIFEST.fixtures.length, 51);
  const lines = MANIFEST.fixtures.map((entry) => {
    assert.equal(sha256(bytes(entry.file)), entry.sha256, entry.file);
    assert.equal(entry.http_status, 200, `${entry.file}: Core answers HTTP 200 for a logical refusal too`);
    const raw = body(entry.file);
    if (entry.extract === undefined) {
      assert.equal(raw.status_code, entry.status_code, entry.file);
      assert.deepEqual([raw.message, raw.status, raw.can_send], [200, 200, 0], `${entry.file}: the legacy trio`);
    }
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(sha256(lines.join("\n")), PIN.set);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), [...MANIFEST.fixtures.map((entry) => entry.file), "manifest.json"].sort());
  const routes = new Set(MANIFEST.fixtures.map(actionOf));
  assert.deepEqual([...routes].sort(), ["admin_me", ...OUTBOUND_MESSAGING_ACTIONS].sort(), "every route the panel calls has genuine captures");
});

test("every Core body decodes as Core means it, through the decoders and the bridge's projection", async () => {
  const page1 = body("history-page-1-admin.json");
  let decoded = 0;
  for (const entry of MANIFEST.fixtures) {
    const raw = body(entry.file);
    const action = actionOf(entry);
    if (action === "admin_me") {
      // `admin_me.outbound_messaging`, extracted: always ready; only the send capability differs by role.
      assert.equal(entry.extract, "/outbound_messaging");
      assert.deepEqual(outboundMessagingAccess({ outbound_messaging: raw }), { kind: "ready", canSend: entry.consumer !== "viewer" }, entry.file);
      decoded += 1;
      continue;
    }
    if (raw.success === true) {
      let request: Json | null = null;
      if (action === "outbound_message_preview") {
        request = outboundPreviewPayload(raw.data.recipients.map((row: Json) => row.uid));
        assert.ok(request && outboundRecipientPreviewResponse(raw, request as never), entry.file);
      } else if (action === "send_message") {
        request = sendFor(raw.data, entry.file);
        const outcome = outboundSendOutcome(raw, request as OutboundSendPayload);
        assert.equal(outcome.kind, "sent", entry.file);
        assert.equal(outcome.kind === "sent" && outcome.data.replayed, entry.file.startsWith("send-replay"), entry.file);
      } else if (action === "user_history") {
        const second = entry.file === "history-page-2-admin.json";
        const size = entry.file.startsWith("history-page-") ? page1.data.messages.length : 25;
        request = outboundHistoryPayload(raw.data.uid, second ? page1.data.next_cursor : "", size);
        assert.ok(request && outboundHistoryResponse(raw, request as never), entry.file);
      } else {
        request = outboundHistoryDetailPayload(raw.data.message.uid, raw.data.message.message_id);
        assert.ok(request && await outboundHistoryDetailResponse(raw, request as never), `${entry.file}: body hash-checked`);
      }
      const projected = await normalizeOutboundMessagingResponse(action, raw, request!);
      assert.equal(projected?.status_code, 200, `${entry.file}: projected`);
      decoded += 1;
      continue;
    }
    // A refusal: its name at its contract status, rebuilt by the bridge. The two membership refusals never get
    // there (the bridge signs the operator out first), and `unauthorized` is Core's answer to a wrong server
    // secret, which the bridge answers as invalid-core-response.
    if (entry.consumer === "revoked" || entry.consumer === "none") {
      assert.ok(["admin-revoked", "unauthorized"].includes(raw.error), entry.file);
      decoded += 1;
      continue;
    }
    assert.equal(outboundMessagingErrorResponse(raw), raw.error, entry.file);
    assert.equal(OUTBOUND_MESSAGING_ERROR_STATUSES[raw.error as keyof typeof OUTBOUND_MESSAGING_ERROR_STATUSES], raw.status_code, entry.file);
    const conflictUids = raw.error === "outbound-message-recipient-conflict" ? raw.data.preview.recipients.map((row: Json) => row.uid).join(",") : "4201";
    const request = action === "send_message" ? sendFor(null, entry.file, conflictUids)
      : action === "outbound_message_preview" ? outboundPreviewPayload([4201])!
        : action === "user_history" ? outboundHistoryPayload(4201)! : outboundHistoryDetailPayload(4201, "66a10bba80d90fcf1369c5d7")!;
    const projected = await normalizeOutboundMessagingResponse(action, raw, request as Json);
    assert.ok(projected, `${entry.file}: projected`);
    assert.deepEqual({ ...projected.body, data: undefined }, { success: false, status_code: raw.status_code, error: raw.error, message: 200, status: 200, can_send: 0, data: undefined });
    if (action === "send_message") {
      // Every send refusal Core produced is definite: nothing was admitted under that request id.
      assert.equal(outboundSendOutcome(raw, request as OutboundSendPayload).kind, "refused", entry.file);
    }
    decoded += 1;
  }
  assert.equal(decoded, 51);
});

test("W1: a suppressed row with Core's delivery reason keeps the member's history readable", async () => {
  const history = body("history-suppressed.json");
  const parsed = outboundHistoryResponse(history, outboundHistoryPayload(history.data.uid)!);
  assert.deepEqual(parsed?.messages.map((row) => [row.status, row.status_reason]), [["suppressed", "delivery_expired"]]);
  const detail = body("detail-suppressed.json");
  const exact = await outboundHistoryDetailResponse(detail, outboundHistoryDetailPayload(detail.data.message.uid, detail.data.message.message_id)!);
  assert.equal(exact?.message.status_reason, "delivery_expired");
  assert.equal(outboundHistoryDetailMatchesEntry(exact!.message, parsed!.messages[0]), true);
  const skipped = body("history-skipped.json");
  assert.deepEqual(outboundHistoryResponse(skipped, outboundHistoryPayload(skipped.data.uid)!)?.messages.map((row) => row.status_reason), ["opted_out"]);
});

test("W2: an imported member's mixed-case legacy codename is Core's projection, accepted as served", () => {
  const preview = body("preview-legacy-codename.json");
  assert.equal(outboundRecipientPreviewResponse(preview, outboundPreviewPayload([4208])!)?.recipients[0].codename, "Hana4208");
});

test("the two history pages merge into the full history; every detail is its row's message", async () => {
  const page1 = body("history-page-1-admin.json"), page2 = body("history-page-2-admin.json"), full = body("history-full-viewer.json");
  const size = page1.data.messages.length;
  const first = outboundHistoryResponse(page1, outboundHistoryPayload(4201, "", size)!)!;
  const second = outboundHistoryResponse(page2, outboundHistoryPayload(4201, page1.data.next_cursor, size)!)!;
  const merged = mergeOutboundHistoryPages(first, second);
  const whole = outboundHistoryResponse(full, outboundHistoryPayload(4201)!)!;
  assert.deepEqual(merged?.messages.map((row) => row.message_id), whole.messages.map((row) => row.message_id));
  for (const file of MANIFEST.fixtures.map((entry) => entry.file).filter((file) => file.startsWith("detail-") && body(file).success === true)) {
    const raw = body(file);
    const detail = (await outboundHistoryDetailResponse(raw, outboundHistoryDetailPayload(raw.data.message.uid, raw.data.message.message_id)!))!.message;
    const row = whole.messages.find((entry) => entry.message_id === detail.message_id);
    if (row) assert.equal(outboundHistoryDetailMatchesEntry(detail, row), true, file);
  }
});

test("a replay answers the first admission, not the current state: the history says what happened since", () => {
  const replay = body("send-replay-after-delivery.json");
  const outcome = outboundSendOutcome(replay, sendFor(replay.data, "replay"));
  assert.ok(outcome.kind === "sent" && outcome.data.replayed);
  assert.equal(outcome.kind === "sent" && outcome.data.results[0].outcome, "queued", "Core's stored admission snapshot");
  const history = outboundHistoryResponse(body("history-full-viewer.json"), outboundHistoryPayload(4201)!)!;
  const row = history.messages.find((entry) => entry.request_id === replay.data.request_id);
  assert.deepEqual([row?.status, row?.status_reason], ["failed", "delivery_failed"], "the SMS failed after it was admitted");
});

test("no Core body names a contact, a device or a provider field", () => {
  const forbiddenKey = /(?:address|phone|token|destination|provider|device|credential|http_status|http_body|recipient_email)/iu;
  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}[${index}]`)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Json)) {
      assert.doesNotMatch(key, forbiddenKey, `${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  }
  for (const entry of MANIFEST.fixtures) visit(body(entry.file), entry.file);
});

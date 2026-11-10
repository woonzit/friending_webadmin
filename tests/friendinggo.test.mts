import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { adminPostForwardError } from "../lib/adminPostForward.ts";
import { webadminErrorEnvelope } from "../lib/webadminEnvelope.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { MAIL_DELIVERY_KINDS, mailDelivery, normalizeMailDeliveryProxyBody, DEFAULT_MAIL_DELIVERY_FILTERS } from "../lib/mailDelivery.ts";
import * as go from "../lib/friendinggo.ts";
import * as csv from "../lib/friendinggoExport.ts";
import * as state from "../lib/friendinggoConsole.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";

type Json = Record<string, any>;

/**
 * GENUINE: tests/fixtures/go_preorders_wire, copied byte for byte (git archive) from the Core lane tip
 * `bc4b0ba3` (T-936 round 2, branch lane/t936-go-preorders, not yet on Core main): Core's storage suite
 * `tests/go_preorders_storage_test.php` captured every route against an owned replica set with the clock
 * pinned to 1800000000 (docs/GO_PREORDERS_V1.md). 66 bodies: the 54 `webadmin-*` bodies this console
 * reads and the twelve `goweb-*` bodies of the web tier, vendored only so that the set digest can be
 * recomputed. Round 2 added the sliced send (`-send-sending`), the died send and its takeover
 * (`-send-in-progress`, `-send-taken-over`), the drafts filter, the body limit and the self-unsubscribe
 * lock. DERIVED, and marked so at each use: a genuine body with one stated change (the negative
 * controls, a value no capture holds such as a fractional delivery time).
 *
 * THE PIN (docs/WIRE_CORPUS_PINNING.md). Re-vendoring is one step: copy the directory from the Core
 * commit and replace these values with what the new files say. A changed `set` means a BODY changed:
 * stop and review, not a re-pin.
 */
const PIN = {
  /** The Core commit the directory was copied from, from its git objects. */
  core: "bc4b0ba3e5e4753feb3324926de6e7f8cad28203",
  /** sha256 of manifest.json. */
  manifest: "8ad24c61b29e567bfc65e11503d71df1e603fa26291f0118773964ac1c66bd9c",
  /** The manifest's source binding (an ancestor of `core`). */
  source_commit: "895dbc1e690c9e449703cad0871e1d1d3ae2484f",
  /** `fixture_set_sha256`: the 66 bodies. */
  set: "9f6257c802cc2e886617a91641624e410d0def037bfee478b89cb572167b8c92",
  /** sha256 of Core's generator, tests/go_preorders_storage_test.php. */
  generator: "efaadf61eb07a75023ae5746862fc65814d8e92c92e67d552200e82817f5fff8",
};
const DIRECTORY = new URL("./fixtures/go_preorders_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, DIRECTORY));
const fixture = (name: string): Json => JSON.parse(bytes(`${name}.json`).toString("utf8"));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Entry = { file: string; consumer: string; route: string; http_status: number; status_code: number; sha256: string };
const MANIFEST = fixture("manifest") as { schema_version: number; contract: string; source_commit: string; fixture_set_sha256: string;
  selectors: Record<string, unknown>; provenance: Record<string, any>; fixtures: Entry[] };

const OWNER = fixture("webadmin-go-preorders-owner"), VIEWER = fixture("webadmin-go-preorders-viewer");
const SEARCH = fixture("webadmin-go-preorders-search"), EXPORT = fixture("webadmin-go-preorders-export");
const PREVIEW = fixture("webadmin-go-email-preview"), PREVIEW_ALL = fixture("webadmin-go-email-preview-all-active");
const SEND = fixture("webadmin-go-email-send"), SEND_REPLAY = fixture("webadmin-go-email-send-replay");
const SEND_DIRECT = fixture("webadmin-go-email-send-direct"), SEND_ALL = fixture("webadmin-go-email-send-all-active");
const DRAFT = fixture("webadmin-go-email-send-draft"), DRAFT_UPDATE = fixture("webadmin-go-email-send-draft-update");
const TEST_SEND = fixture("webadmin-go-email-send-test");
const CAMPAIGNS = fixture("webadmin-go-email-campaigns"), DETAIL = fixture("webadmin-go-email-campaign-detail");
const DRAFTS = fixture("webadmin-go-email-campaigns-drafts");
const SENDING = fixture("webadmin-go-email-send-sending"), IN_PROGRESS = fixture("webadmin-go-email-send-in-progress");
const TAKEN_OVER = fixture("webadmin-go-email-send-taken-over");
const DETAIL_VIEWER = fixture("webadmin-go-email-campaign-detail-viewer");
const UNSUBSCRIBE = fixture("webadmin-go-set-status-unsubscribe"), RESUBSCRIBE = fixture("webadmin-go-set-status-resubscribe");
const UNCHANGED = fixture("webadmin-go-set-status-unchanged"), STATUS_REPLAY = fixture("webadmin-go-set-status-replay");

const ALL: go.FriendingGoListFilters = { ...go.DEFAULT_FRIENDINGGO_LIST_FILTERS };
const BODY = PREVIEW.data.body_html as string;
/** The audience of Core's captured newsletter (the campaign detail names it): two active people and Eve, unsubscribed. */
const THREE = ["000000000000000000006001", "000000000000000000006003", "000000000000000000006004"];
const NEWSLETTER: go.FriendingGoEmailContent = {
  kind: "newsletter", subject: "FriendingGO update", preheader: "What is new with your cat tag", body_html: BODY, audience: "selected", preorder_ids: THREE,
};
const HUNDRED_ONE = Array.from({ length: 101 }, (_, index) => (0x7000 + index).toString(16).padStart(24, "0"));
/** Core's captured commands, transcribed from the receipts they answered (the request ids are Core's generator's). */
const COMMANDS = {
  send: { ...NEWSLETTER, mode: "send", campaign_id: "", request_id: "00000011-0000-4000-8000-000000000011", expected_sendable: 2 },
  sendAll: { ...NEWSLETTER, audience: "all_active", preorder_ids: [], mode: "send", campaign_id: "", request_id: "00000014-0000-4000-8000-000000000014", expected_sendable: 3 },
  draft: { kind: "direct", subject: "A note for you", preheader: "", body_html: "<p>Hi {{first_name}}</p>", audience: "selected",
    preorder_ids: ["000000000000000000006001"], mode: "save_draft", campaign_id: "", request_id: "0000000c-0000-4000-8000-00000000000c" },
  draftUpdate: { kind: "direct", subject: "A short note for you", preheader: "", body_html: "<p>Hi {{first_name}}</p>", audience: "selected",
    preorder_ids: ["000000000000000000006001"], mode: "save_draft", campaign_id: "00000000000000000000600a", request_id: "0000000d-0000-4000-8000-00000000000d" },
  direct: { kind: "direct", subject: "A short note for you", preheader: "", body_html: "<p>Hi {{first_name}}</p>", audience: "selected",
    preorder_ids: ["000000000000000000006001"], mode: "send", campaign_id: "00000000000000000000600a", request_id: "0000000e-0000-4000-8000-00000000000e", expected_sendable: 1 },
  test: { mode: "test", kind: "newsletter", subject: "FriendingGO update", preheader: "What is new with your cat tag", body_html: BODY, request_id: "0000000b-0000-4000-8000-00000000000b" },
  // The two 101-recipient newsletters of the sliced and the died send (Core's generator names 101 active people;
  // the parser does not read the ids back, so they are stand-ins of the right count).
  sliced: { kind: "newsletter", subject: "More news for everyone", preheader: "", body_html: "<p>Hi {{first_name}}</p>", audience: "selected",
    preorder_ids: HUNDRED_ONE, mode: "send", campaign_id: "", request_id: "0000001f-0000-4000-8000-00000000001f", expected_sendable: 101 },
  takenOver: { kind: "newsletter", subject: "News for everyone", preheader: "", body_html: "<p>Hi {{first_name}}</p>", audience: "selected",
    preorder_ids: HUNDRED_ONE, mode: "send", campaign_id: "", request_id: "0000001e-0000-4000-8000-00000000001e", expected_sendable: 101 },
} as const satisfies Record<string, go.FriendingGoSendBody>;

test("the FriendingGO corpus is Core's, byte for byte, pinned to the lane tip", () => {
  assert.equal(sha256(bytes("manifest.json")), PIN.manifest);
  assert.deepEqual([MANIFEST.schema_version, MANIFEST.contract, MANIFEST.source_commit, MANIFEST.fixture_set_sha256, MANIFEST.provenance.generator_sha256],
    [1, "go-preorders-v1", PIN.source_commit, PIN.set, PIN.generator]);
  assert.equal(MANIFEST.provenance.generator, "tests/go_preorders_storage_test.php");
  // The selector the capture sent with every Webadmin call is the one this console's bridge adds.
  assert.deepEqual(MANIFEST.selectors, { webadmin: { contract_version: go.FRIENDINGGO_CONTRACT_VERSION } });
  assert.equal(MANIFEST.fixtures.length, 66);
  const lines = MANIFEST.fixtures.map((entry) => {
    assert.equal(sha256(bytes(entry.file)), entry.sha256, entry.file);
    const body = JSON.parse(bytes(entry.file).toString("utf8"));
    assert.equal(entry.status_code, body.status_code, entry.file);
    if (entry.consumer === "webadmin") {
      // Webadmin answers HTTP 200 for a logical refusal too, with the legacy trio.
      assert.equal(entry.http_status, 200, entry.file);
      assert.deepEqual([body.message, body.status, body.can_send], [200, 200, 0], entry.file);
      assert.ok((go.FRIENDINGGO_ACTIONS as readonly string[]).includes(entry.route.replace(/^\/v1\/webadmin\//, "")), entry.route);
    } else {
      assert.equal(entry.consumer, "goweb", entry.file);
    }
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(sha256(lines.join("\n")), PIN.set);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), [...MANIFEST.fixtures.map((entry) => entry.file), "manifest.json"].sort());
  // Every route this console calls has genuine captures.
  const routes = new Set(MANIFEST.fixtures.filter((entry) => entry.consumer === "webadmin").map((entry) => entry.route.replace(/^\/v1\/webadmin\//, "")));
  assert.deepEqual([...routes].sort(), [...go.FRIENDINGGO_ACTIONS].sort());
  assert.ok(bytes("webadmin-go-preorders-viewer.json").toString("utf8").includes("\"ev•••@example.com\""), "the mask arrives as UTF-8");
});

test("Core's successful captures are read in full: nothing added, nothing dropped", () => {
  assert.deepEqual(go.friendingGoPreorders(OWNER, ALL), OWNER.data);
  assert.deepEqual(go.friendingGoPreorders(VIEWER, ALL, { viewer: true }), VIEWER.data);
  assert.deepEqual(go.friendingGoPreorders(SEARCH, { q: "ca", status: "active", page: 1 }), SEARCH.data);
  assert.deepEqual(go.friendingGoExport(EXPORT, { q: "", status: "active" }), EXPORT.data);
  for (const body of [UNSUBSCRIBE, RESUBSCRIBE, UNCHANGED, STATUS_REPLAY]) assert.deepEqual(go.friendingGoStatusResult(body), body.data);
  assert.deepEqual(go.friendingGoPreview(PREVIEW, NEWSLETTER), PREVIEW.data);
  assert.deepEqual(go.friendingGoPreview(PREVIEW_ALL, { ...NEWSLETTER, audience: "all_active", preorder_ids: [] }), PREVIEW_ALL.data);
  for (const [body, command] of [[SEND, COMMANDS.send], [SEND_REPLAY, COMMANDS.send], [SEND_ALL, COMMANDS.sendAll], [DRAFT, COMMANDS.draft],
    [DRAFT_UPDATE, COMMANDS.draftUpdate], [SEND_DIRECT, COMMANDS.direct], [TEST_SEND, COMMANDS.test],
    [SENDING, COMMANDS.sliced], [TAKEN_OVER, COMMANDS.takenOver]] as const) {
    assert.deepEqual(go.friendingGoSendResult(body, command), body.data, command.request_id);
  }
  assert.deepEqual(go.friendingGoCampaigns(CAMPAIGNS, 1), CAMPAIGNS.data);
  assert.deepEqual(go.friendingGoCampaigns(DRAFTS, 1, "draft"), DRAFTS.data);
  assert.equal(go.friendingGoCampaigns(DRAFTS, 1), null, "a drafts-only answer is not the whole list");
  assert.equal(go.friendingGoCampaigns(CAMPAIGNS, 1, "draft"), null, "the whole list is not the drafts");
  assert.deepEqual(go.friendingGoCampaignDetail(DETAIL, "000000000000000000006002", 1), DETAIL.data);
  assert.deepEqual(go.friendingGoCampaignDetail(DETAIL_VIEWER, "000000000000000000006002", 1, { viewer: true }), DETAIL_VIEWER.data);
  // The same answers without the legacy trio, as the bridge forwards them.
  const { message: _m, status: _s, can_send: _c, ...bare } = OWNER;
  assert.deepEqual(go.friendingGoPreorders(bare, ALL), OWNER.data);
  // A parsed answer parses again to itself (the browser reads what the bridge projected).
  const projected = { success: true, status_code: 200, data: go.friendingGoPreview(PREVIEW, NEWSLETTER) };
  assert.deepEqual(go.friendingGoPreview(projected, NEWSLETTER), PREVIEW.data);
});

test("the viewer views mask what Core said they mask, and the bridge's floor refuses anything else", () => {
  assert.equal(go.friendingGoPreorders(OWNER, ALL, { viewer: true }), null, "unmasked rows never reach a viewer");
  assert.equal(go.friendingGoCampaignDetail(DETAIL, "000000000000000000006002", 1, { viewer: true }), null);
  // An unmasked address or phone in a masked view, or the mask in an unmasked one, is refused.
  const leak = clone(VIEWER); leak.data.rows[2].phone = "+19195550103";
  assert.equal(go.friendingGoPreorders(leak, ALL), null);
  const mail = clone(VIEWER); mail.data.rows[0].email = "eve.moss@example.com";
  assert.equal(go.friendingGoPreorders(mail, ALL), null);
  const mask = clone(OWNER); mask.data.rows[0].email = "ev•••@example.com";
  assert.equal(go.friendingGoPreorders(mask, ALL), null);
  const writer = clone(VIEWER); writer.data.can_write = true;
  assert.equal(go.friendingGoPreorders(writer, ALL, { viewer: true }), null, "a viewer is never offered writes");
  for (const row of go.friendingGoPreorders(VIEWER, ALL)!.rows) {
    assert.ok(row.email.includes(go.FRIENDINGGO_MASK));
    assert.ok(row.phone === null || /^\+1•••••••\d{3}$/u.test(row.phone));
  }
});

test("a partial, loosely typed or self-contradicting answer is never a list, a preview or a send", () => {
  const refused = (base: Json, change: (data: Json, body: Json) => void, parse: (body: Json) => unknown, why: string) => {
    const body = clone(base); change(body.data, body);
    assert.equal(parse(body), null, why);
  };
  const list = (body: Json) => go.friendingGoPreorders(body, ALL);
  for (const value of [null, [], { success: false }, { ...OWNER, status_code: 422 }, { ...OWNER, error: "x" }, { ...OWNER, success: "true" }, { ...OWNER, data: [] }]) {
    assert.equal(list(value as Json), null, JSON.stringify(value)?.slice(0, 50));
  }
  refused(OWNER, (d) => { d.contract_version = 2; }, list, "another contract version");
  refused(OWNER, (d) => { d.filters.q = "a"; }, list, "an answer for another search");
  refused(OWNER, (d) => { d.page = 2; }, list, "another page");
  refused(OWNER, (d) => { d.filters.extra = 1; }, list, "an unknown echo");
  refused(OWNER, (d) => { d.totals.all = 6; }, list, "totals that do not add up");
  refused(OWNER, (d) => { delete d.totals.complained; }, list, "a missing total");
  refused(OWNER, (d) => { d.matching = 6; }, list, "more matching than signed up");
  refused(OWNER, (d) => { d.has_more = true; }, list, "more pages behind a short page");
  refused(OWNER, (d) => { d.rows.reverse(); }, list, "rows not newest first");
  refused(OWNER, (d) => { d.rows[1] = d.rows[0]; }, list, "a repeated row");
  refused(OWNER, (d) => { d.rows[0].status = "paused"; }, list, "an unknown status");
  refused(OWNER, (d) => { d.rows[0].status_source = "import"; }, list, "an unknown status source");
  refused(OWNER, (d) => { d.rows[0].id = "../x"; }, list, "an unsafe id");
  refused(OWNER, (d) => { d.rows[0].phone = "9195550101"; }, list, "a phone outside the NANP form");
  refused(OWNER, (d) => { d.rows[0].city_from_list = true; d.rows[0].city_id = null; }, list, "a listed city without an id");
  refused(OWNER, (d) => { d.rows[0].confirmation = { outbound_id: null, state: "delivered" }; }, list, "a delivery state without an outbox row");
  refused(OWNER, (d) => { d.rows[0].consent.text_version = "v 1"; }, list, "a consent version outside its grammar");
  refused(OWNER, (d) => { d.rows[0].created_at = "1799994400"; }, list, "a loosely typed time");
  refused(OWNER, (d) => { d.rows[0].updated_at = d.rows[0].created_at - 1; }, list, "updated before created");
  refused(OWNER, (d) => { d.rows[0].can_resubscribe = "yes"; }, list, "a loose can_resubscribe");
  refused(OWNER, (d) => { delete d.rows[0].can_resubscribe; }, list, "a row without can_resubscribe");
  refused(OWNER, (d) => { d.rows[2].can_resubscribe = true; }, list, "an active row offered a resubscribe");
  refused(OWNER, (d) => { d.rows[0].can_resubscribe = true; }, list, "a self unsubscribe offered a resubscribe");
  refused(OWNER, (d) => { d.rows[0].status_source = "webadmin"; }, list, "a round-1 status source");
  refused(OWNER, (d) => { d.rows[2].confirmation.state = "skipped"; }, list, "skipped beside an outbox row");
  const search = (body: Json) => go.friendingGoPreorders(body, { q: "ca", status: "active", page: 1 });
  refused(SEARCH, (d) => { d.rows[0].status = "bounced"; }, search, "a row outside the status filter");

  const exported = (body: Json) => go.friendingGoExport(body, { q: "", status: "active" });
  refused(EXPORT, (d) => { d.row_count = 4; }, exported, "a row count that is not the rows");
  refused(EXPORT, (d) => { d.truncated = true; }, exported, "truncated below the limit");
  refused(EXPORT, (d) => { d.rows[0].email = "cl•••@example.org"; }, exported, "a masked export");
  refused(EXPORT, (d) => { d.export = false; }, exported, "not an export");

  const preview = (body: Json) => go.friendingGoPreview(body, NEWSLETTER);
  refused(PREVIEW, (d) => { d.subject = "Other"; }, preview, "a preview of other content");
  refused(PREVIEW, (d) => { d.counts.sendable = 3; }, preview, "counts that do not add up");
  refused(PREVIEW, (d) => { d.counts.suppressed_by_reason.bounced = 1; }, preview, "reasons that do not add up");
  refused(PREVIEW, (d) => { delete d.counts.suppressed_by_reason; }, preview, "counts without their reasons");
  refused(PREVIEW, (d) => { d.counts.suppressed_by_reason.missing = 0; }, preview, "an unknown reason");
  refused(PREVIEW, (d) => { d.counts = { selected: 2, sendable: 2, suppressed: 0 }; }, preview, "a count that is not the people named");
  refused(PREVIEW, (d) => { d.cap = 100; }, preview, "another type's cap");
  refused(PREVIEW, (d) => { d.merge_tags = ["{{city}}", "{{first_name}}"]; }, preview, "other merge tags");
  refused(PREVIEW, (d) => { d.sample.first_name = "Sam"; }, preview, "other sample values");
  refused(PREVIEW, (d) => { d.html = d.html.replace("</head>", "<script>alert(1)</script></head>"); }, preview, "a script in the layout");
  refused(PREVIEW, (d) => { d.html = d.html.replace("<body ", "<body onload=\"x()\" "); }, preview, "an event handler in the layout");
  refused(PREVIEW, (d) => { d.html = d.html.replace("<head>", "<head><meta http-equiv=\"refresh\" content=\"0\">"); }, preview, "a refresh in the layout");
  refused(PREVIEW, (d) => { d.body_html = "<script>x</script>"; }, preview, "a body outside the tag set");
  refused(PREVIEW, (d) => { d.extra = 1; }, preview, "an unknown key");

  const sent = (body: Json) => go.friendingGoSendResult(body, COMMANDS.send);
  refused(SEND, (d) => { d.receipt.request_id = "00000012-0000-4000-8000-000000000012"; }, sent, "another request's receipt");
  refused(SEND, (d) => { d.campaign.subject = "Other"; }, sent, "another campaign");
  refused(SEND, (d) => { d.campaign.state = "draft"; }, sent, "a send answered by a draft");
  refused(SEND, (d) => { d.campaign.counts.queued = 3; }, sent, "counts that do not add up");
  refused(SEND, (d) => { d.campaign.counts = null; }, sent, "a send without counts");
  refused(SEND, (d) => { d.mode = "test"; }, sent, "another mode");
  refused(SEND, (d) => { d.receipt.replayed = "no"; }, sent, "a loose receipt");
  refused(SEND, (d) => { delete d.progress; }, sent, "a send without its progress");
  refused(SEND, (d) => { d.progress.processed = 2; }, sent, "a sent campaign not wholly processed");
  refused(SEND, (d) => { d.campaign.counts.suppressed_by_reason = { unsubscribed: 0, bounced: 1, complained: 1 }; }, sent, "reasons that do not add up");
  const sliced = (body: Json) => go.friendingGoSendResult(body, COMMANDS.sliced);
  refused(SENDING, (d) => { d.progress.processed = 101; }, sliced, "sending, yet everyone processed");
  refused(SENDING, (d) => { d.progress.total = 100; }, sliced, "a total that is not the audience");
  refused(SENDING, (d) => { d.progress.processed = 49; }, sliced, "progress that is not the counts so far");
  refused(SENDING, (d) => { d.campaign.counts.queued = 102; }, sliced, "more queued than selected");
  assert.equal(go.friendingGoSendResult(SEND_DIRECT, { ...COMMANDS.direct, campaign_id: "000000000000000000006002" }), null, "another draft");
  assert.equal(go.friendingGoSendResult(DRAFT, { ...COMMANDS.draft, mode: "send", expected_sendable: 1 } as go.FriendingGoSendBody), null, "a draft answering a send");
  refused(DRAFT, (d) => { d.campaign.sent_at = 1800000660; }, (body) => go.friendingGoSendResult(body, COMMANDS.draft), "a draft with a send time");

  const campaigns = (body: Json) => go.friendingGoCampaigns(body, 1);
  refused(CAMPAIGNS, (d) => { d.campaigns.reverse(); }, campaigns, "campaigns not newest first");
  refused(CAMPAIGNS, (d) => { d.campaigns[1].audience.count = null; }, campaigns, "a sent campaign without its count");
  refused(CAMPAIGNS, (d) => { d.campaigns[4].audience.mode = "all_active"; }, campaigns, "a direct email to everyone");
  refused(CAMPAIGNS, (d) => { delete d.filters; }, campaigns, "a list without its filter echo");
  refused(DRAFTS, (d) => { d.campaigns.push({ ...CAMPAIGNS.data.campaigns[1], created_at: 1 }); }, (body) => go.friendingGoCampaigns(body, 1, "draft"), "a sent campaign among the drafts");
  const detail = (body: Json) => go.friendingGoCampaignDetail(body, "000000000000000000006002", 1);
  refused(DETAIL, (d) => { d.delivery_counts.delivered = 2; }, detail, "deliveries that are not the queued messages");
  refused(DETAIL, (d) => { d.recipients.reverse(); }, detail, "recipients not by preorder id");
  refused(DETAIL, (d) => { d.recipients[2].outbound_id = "000000000000000000006007"; }, detail, "a left-out recipient with a message");
  refused(DETAIL, (d) => { d.recipients[0].suppressed_reason = "bounced"; }, detail, "a reason on a queued recipient");
  refused(DETAIL, (d) => { d.recipients[1].delivered_at = 1800001102; d.recipients[1].delivery_state = null; }, detail, "a delivery time without a state");
  refused(DETAIL, (d) => { d.campaign.audience.preorder_ids.pop(); }, detail, "ids that are not the count");
  assert.equal(go.friendingGoCampaignDetail(DETAIL, "000000000000000000006007", 1), null, "another campaign's detail");
});

test("round 2: who may resubscribe, why a row is locked, and the left-out reasons, as Core's captures say", () => {
  // delivered_at is a float on Core's side; the capture's is a whole number already. A fraction is fine too (DERIVED).
  const fraction = clone(DETAIL); fraction.data.recipients[0].delivered_at = 1800001102.4;
  assert.equal(go.friendingGoCampaignDetail(fraction, "000000000000000000006002", 1)?.recipients[0]?.delivered_at, 1800001102.4);
  // can_resubscribe (contract §10.2): only an unsubscribe an administrator made.
  const rows = go.friendingGoPreorders(OWNER, ALL)!.rows;
  const eve = rows.find((row) => row.name === "Eve Moss")!, dan = rows.find((row) => row.name === "Dan Ruiz")!;
  assert.deepEqual([eve.status, eve.status_source, eve.can_resubscribe], ["unsubscribed", "self", false]);
  assert.equal(go.friendingGoNextStatus(eve), null, "a self unsubscribe is locked for the console");
  assert.equal(go.friendingGoLockReason(eve.status, eve.status_source), "self");
  assert.deepEqual([dan.status, dan.status_source, go.friendingGoNextStatus(dan), go.friendingGoLockReason(dan.status, dan.status_source)],
    ["bounced", "feedback", null, "bounced"]);
  for (const row of rows.filter((item) => item.status === "active")) assert.equal(go.friendingGoNextStatus(row), "unsubscribed", row.name);
  const unsubscribed = go.friendingGoStatusResult(UNSUBSCRIBE)!.preorder;
  assert.deepEqual([unsubscribed.status_source, unsubscribed.can_resubscribe, go.friendingGoNextStatus(unsubscribed)], ["admin", true, "active"],
    "the console may undo its own unsubscribe");
  assert.equal(go.friendingGoLockReason("unsubscribed", "feedback"), "feedback");
  assert.equal(go.friendingGoLockReason("complained", "feedback"), "complained");
  // Core's two lock refusals name the reason.
  assert.equal(go.friendingGoLock(fixture("webadmin-go-set-status-locked")), "bounced");
  assert.equal(go.friendingGoLock(fixture("webadmin-go-set-status-self-locked")), "self");
  assert.equal(go.friendingGoLock(SEND), null);
  // Left-out reasons in the preview, the send answer, the refusal and the campaign.
  assert.deepEqual(go.friendingGoPreview(PREVIEW, NEWSLETTER)!.counts.suppressed_by_reason, { unsubscribed: 1, bounced: 0, complained: 0 });
  assert.deepEqual(go.friendingGoSendResult(SEND, COMMANDS.send)!.campaign.counts!.suppressed_by_reason, { unsubscribed: 1, bounced: 0, complained: 0 });
  assert.deepEqual(go.friendingGoCampaignDetail(DETAIL, "000000000000000000006002", 1)!.campaign.counts!.suppressed_by_reason, { unsubscribed: 1, bounced: 0, complained: 0 });
  assert.deepEqual(go.friendingGoRefusalCounts(fixture("webadmin-go-email-send-audience-empty"))!.counts.suppressed_by_reason, { unsubscribed: 1, bounced: 1, complained: 0 });
  // A confirmation the mailbox limit skipped has no outbox row (DERIVED: no capture holds one).
  const skipped = clone(OWNER); skipped.data.rows[2].confirmation = { outbound_id: null, state: "skipped" };
  assert.equal(go.friendingGoPreorders(skipped, ALL)?.rows[2]?.confirmation.state, "skipped");
});

test("round 2: a sliced send is carried on with the same request until it is sent; a died send is waited for and taken over", () => {
  // Core's sliced send: 50 of 101 written, `sending`.
  const sending = go.friendingGoSendResult(SENDING, COMMANDS.sliced)!;
  assert.equal(sending.mode, "send");
  assert.deepEqual([sending.mode === "send" && sending.campaign.state, sending.mode === "send" && sending.progress], ["sending", { processed: 50, total: 101 }]);
  let step = state.friendingGoSendStep(SENDING, COMMANDS.sliced, state.FRIENDINGGO_SEND_LOOP_START);
  assert.deepEqual(step.step, { kind: "continue", progress: { processed: 50, total: 101 }, delayMs: state.FRIENDINGGO_SEND_LIMITS.continueDelayMs });
  // The same answer again and again is no progress: after three the console stops and hands it to the operator.
  for (let round = 0; round < state.FRIENDINGGO_SEND_LIMITS.stalls; round += 1) step = state.friendingGoSendStep(SENDING, COMMANDS.sliced, step.loop);
  assert.deepEqual(step.step, { kind: "paused", progress: { processed: 50, total: 101 } });
  // Core's died send: the same request answers in progress (wait 120 s), then the takeover finishes it.
  assert.equal(go.friendingGoRetryAfter(IN_PROGRESS), 120);
  assert.equal(go.friendingGoOutcomeUnknown(IN_PROGRESS), true, "never a refusal: retry the same request id");
  const waited = state.friendingGoSendStep(IN_PROGRESS, COMMANDS.takenOver, state.FRIENDINGGO_SEND_LOOP_START);
  assert.deepEqual(waited.step, { kind: "wait", seconds: 120 });
  const finished = state.friendingGoSendStep(TAKEN_OVER, COMMANDS.takenOver, waited.loop);
  assert.equal(finished.step.kind, "done");
  assert.deepEqual(finished.step.kind === "done" && finished.step.result.mode === "send" && finished.step.result.progress, { processed: 101, total: 101 });
  // Waits are bounded too: after three, the in-progress answer is an unknown outcome kept for a manual retry.
  let loop = state.FRIENDINGGO_SEND_LOOP_START;
  for (let round = 0; round < state.FRIENDINGGO_SEND_LIMITS.waits; round += 1) loop = state.friendingGoSendStep(IN_PROGRESS, COMMANDS.takenOver, loop).loop;
  assert.deepEqual(state.friendingGoSendStep(IN_PROGRESS, COMMANDS.takenOver, loop).step, { kind: "unknown", error: "go-request-in-progress" });
  // A test, a draft and a whole send settle at once; a lost answer is kept; a receipted refusal is final.
  assert.equal(state.friendingGoSendStep(SEND, COMMANDS.send, state.FRIENDINGGO_SEND_LOOP_START).step.kind, "done");
  assert.equal(state.friendingGoSendStep(TEST_SEND, COMMANDS.test, state.FRIENDINGGO_SEND_LOOP_START).step.kind, "done");
  assert.deepEqual(state.friendingGoSendStep(null, COMMANDS.send, state.FRIENDINGGO_SEND_LOOP_START).step, { kind: "unknown", error: null });
  assert.deepEqual(state.friendingGoSendStep({ success: false, status_code: 504, error: "core-timeout" }, COMMANDS.send, state.FRIENDINGGO_SEND_LOOP_START).step,
    { kind: "unknown", error: "core-timeout" });
  assert.deepEqual(state.friendingGoSendStep(fixture("webadmin-go-email-send-audience-changed"), { ...COMMANDS.send, request_id: "00000012-0000-4000-8000-000000000012" },
    state.FRIENDINGGO_SEND_LOOP_START).step, { kind: "refused", error: "go-email-audience-changed" });
  // A sending answer for another request is not progress of this one.
  assert.deepEqual(state.friendingGoSendStep(SENDING, COMMANDS.takenOver, state.FRIENDINGGO_SEND_LOOP_START).step, { kind: "unknown", error: null });
  // The rounds are bounded: Core writes at least 50 a call, so 5,000 people need at most 100 calls.
  assert.ok(state.FRIENDINGGO_SEND_LIMITS.rounds > go.FRIENDINGGO_CAPS.newsletter / 50);
  let rounds = { ...state.FRIENDINGGO_SEND_LOOP_START, rounds: state.FRIENDINGGO_SEND_LIMITS.rounds - 1 };
  assert.equal(state.friendingGoSendStep(SENDING, COMMANDS.sliced, rounds).step.kind, "paused");
  rounds = { ...rounds, rounds: 1 };
  assert.equal(state.friendingGoSendStep(SENDING, COMMANDS.sliced, rounds).step.kind, "continue");
});

test("every refusal Core captured keeps its name and status, and says whether the request may have run", () => {
  for (const entry of MANIFEST.fixtures.filter((item) => item.consumer === "webadmin" && item.status_code !== 200)) {
    const body = JSON.parse(bytes(entry.file).toString("utf8"));
    const error = go.friendingGoError(body);
    assert.equal(error, body.error, entry.file);
    assert.equal(go.FRIENDINGGO_ERRORS[error!].status, entry.status_code, entry.file);
    // `go-request-in-progress` is the one captured refusal that is not final: the same request id is retried.
    assert.equal(go.friendingGoOutcomeUnknown(body), error === "go-request-in-progress", `${entry.file}: final unless still running`);
  }
  assert.deepEqual(go.friendingGoRefusalCounts(fixture("webadmin-go-email-send-audience-changed")),
    { counts: { selected: 3, sendable: 2, suppressed: 1, suppressed_by_reason: { unsubscribed: 1, bounced: 0, complained: 0 } }, cap: null });
  assert.deepEqual(go.friendingGoRefusalCounts(fixture("webadmin-go-email-send-too-large")),
    { counts: { selected: 101, sendable: 101, suppressed: 0, suppressed_by_reason: { unsubscribed: 0, bounced: 0, complained: 0 } }, cap: 100 });
  assert.deepEqual(go.friendingGoRateLimit(fixture("webadmin-go-email-send-rate-limited")), { limit: 3, window_seconds: 3600 });
  assert.equal(go.friendingGoError(fixture("webadmin-go-email-preview-body-too-large")), "go-email-body-too-large");
  // Unknown outcomes: the same request id is retried (review P3-5), never re-minted.
  const derived = (error: string, status: number) => ({ success: false, status_code: status, error, message: 200, status: 200, can_send: 0 });
  for (const value of [IN_PROGRESS, derived("go-preorders-unavailable", 503),
    { success: false, status_code: 504, error: "core-timeout" }, { success: false, status_code: 502, error: "invalid-core-response" },
    { success: false, status_code: 502, error: "admin-request-outcome-unknown" }, { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED },
    SEND, null, { success: false, status_code: 500, error: "go-email-audience-changed" }]) {
    assert.equal(go.friendingGoOutcomeUnknown(value), true, JSON.stringify(value)?.slice(0, 60));
  }
  for (const value of [{ success: false, status_code: 400, error: "invalid-input" }, { success: false, status_code: 403, error: "admin-write-required" },
    { success: false, status_code: 403, error: "friendinggo-capability-required" }]) {
    assert.equal(go.friendingGoOutcomeUnknown(value), false, "a bridge refusal before forwarding");
  }
  assert.equal(go.friendingGoError({ ...derived("go-email-audience-changed", 422) }), null, "a name at the wrong status is not that refusal");
});

test("the bridge forwards only each route's closed, canonical fields and the contract version", () => {
  const v = { contract_version: 1 };
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_preorders", {}) }, { ...v, q: "", status: "", page: 1 });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_preorders", { q: "ca", status: "active", page: 2 }) }, { ...v, q: "ca", status: "active", page: 2 });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_preorder_set_status", { preorder_id: THREE[0], status: "unsubscribed", request_id: COMMANDS.send.request_id }) },
    { ...v, preorder_id: THREE[0], status: "unsubscribed", request_id: COMMANDS.send.request_id });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_preview", { ...NEWSLETTER }) }, { ...v, ...NEWSLETTER, preorder_ids: THREE.join(",") });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_send", { ...COMMANDS.send }) },
    { ...v, mode: "send", kind: "newsletter", subject: NEWSLETTER.subject, preheader: NEWSLETTER.preheader, body_html: BODY, audience: "selected",
      preorder_ids: THREE.join(","), request_id: COMMANDS.send.request_id, expected_sendable: 2 });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_send", { ...COMMANDS.direct }) },
    { ...v, ...COMMANDS.direct, preorder_ids: "000000000000000000006001" });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_send", { ...COMMANDS.test }) }, { ...v, ...COMMANDS.test }, "a test carries no audience");
  const { campaign_id: _none, ...sendAll } = COMMANDS.sendAll;
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_send", { ...COMMANDS.sendAll }) }, { ...v, ...sendAll, preorder_ids: "" },
    "a new campaign names no draft, and everyone active names nobody");
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_campaigns", {}) }, { ...v, page: 1 });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_campaigns", { campaign_id: "000000000000000000006002", page: 3 }) },
    { ...v, page: 3, campaign_id: "000000000000000000006002" });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_campaigns", { state: "draft", page: 1 }) }, { ...v, page: 1, state: "draft" });
  assert.deepEqual({ ...go.normalizeFriendingGoProxyBody("go_email_campaigns", { state: "" }) }, { ...v, page: 1 }, "every state: no filter sent");
  assert.equal(go.normalizeFriendingGoProxyBody("mail_delivery", { anything: 1 }), undefined);

  const refusedBodies: Array<[string, Json]> = [
    ["go_preorders", { export: "1" }], ["go_preorders", { q: " Ca " }], ["go_preorders", { q: "x".repeat(101) }], ["go_preorders", { q: "a\nb" }],
    ["go_preorders", { status: "paused" }], ["go_preorders", { page: 0 }], ["go_preorders", { page: "2" }], ["go_preorders", { page: 10000 }],
    ["go_preorders", { admin_email: "x@example.test" }], ["go_preorders", { secret: "x" }],
    ["go_preorder_set_status", { preorder_id: THREE[0], status: "bounced", request_id: COMMANDS.send.request_id }],
    ["go_preorder_set_status", { preorder_id: THREE[0], status: "active", request_id: "not-a-uuid" }],
    ["go_preorder_set_status", { preorder_id: THREE[0], status: "active" }],
    ["go_email_preview", { ...NEWSLETTER, preorder_ids: [...THREE].reverse() }],
    ["go_email_preview", { ...NEWSLETTER, preorder_ids: [THREE[0], THREE[0]] }],
    ["go_email_preview", { ...NEWSLETTER, preorder_ids: [] }],
    ["go_email_preview", { ...NEWSLETTER, audience: "all_active" }],
    ["go_email_preview", { ...NEWSLETTER, kind: "direct", audience: "all_active", preorder_ids: [] }],
    ["go_email_preview", { ...NEWSLETTER, subject: " FriendingGO  update" }],
    ["go_email_preview", { ...NEWSLETTER, subject: "" }],
    ["go_email_preview", { ...NEWSLETTER, subject: "x".repeat(151) }],
    ["go_email_preview", { ...NEWSLETTER, preheader: "a\tb" }],
    ["go_email_preview", { ...NEWSLETTER, body_html: "<p onclick=\"x\">Hi</p>" }],
    ["go_email_preview", { ...NEWSLETTER, body_html: "<p>Hi" }],
    ["go_email_preview", { ...NEWSLETTER, body_html: " <p>Hi</p>" }],
    ["go_email_preview", { ...NEWSLETTER, body_html: "<p><a href=\"http://x.test\">x</a></p>" }],
    ["go_email_preview", { ...NEWSLETTER, extra: 1 }],
    ["go_email_send", { ...COMMANDS.send, expected_sendable: 0 }],
    ["go_email_send", { ...COMMANDS.send, expected_sendable: 4 }],
    ["go_email_send", { ...COMMANDS.send, expected_sendable: "2" }],
    ["go_email_send", (() => { const { expected_sendable: _e, ...rest } = COMMANDS.send; return rest; })()],
    ["go_email_send", { ...COMMANDS.send, request_id: "0000000B-0000-4000-8000-00000000000B" }],
    ["go_email_send", { ...COMMANDS.send, request_id: "00000011-0000-1000-8000-000000000011" }],
    ["go_email_send", { ...COMMANDS.send, campaign_id: "x" }],
    ["go_email_send", { ...COMMANDS.draft, expected_sendable: 1 }],
    ["go_email_send", { ...COMMANDS.test, audience: "selected", preorder_ids: THREE }],
    ["go_email_send", { ...COMMANDS.send, mode: "schedule" }],
    ["go_email_campaigns", { campaign_id: "6002" }], ["go_email_campaigns", { page: 1, q: "x" }],
    ["go_email_campaigns", { state: "paused" }], ["go_email_campaigns", { state: "draft", campaign_id: "000000000000000000006007" }],
  ];
  for (const [action, body] of refusedBodies) assert.equal(go.normalizeFriendingGoProxyBody(action, body), null, `${action} ${JSON.stringify(body).slice(0, 80)}`);
});

test("the largest preview or send a browser may build fits the raised body ceiling", () => {
  const ids = Array.from({ length: go.FRIENDINGGO_CAPS.newsletter }, (_, index) => index.toString(16).padStart(24, "0")).sort();
  const astral = "😺";
  const body: Json = {
    ...COMMANDS.send,
    subject: astral.repeat(go.FRIENDINGGO_SUBJECT_MAX),
    preheader: astral.repeat(go.FRIENDINGGO_PREHEADER_MAX),
    body_html: astral.repeat(go.FRIENDINGGO_BODY_MAX),
    preorder_ids: ids,
    campaign_id: "000000000000000000006009",
    expected_sendable: go.FRIENDINGGO_CAPS.newsletter,
  };
  assert.ok(go.normalizeFriendingGoProxyBody("go_email_send", body), "the maximal send is a valid command");
  assert.equal(go.normalizeFriendingGoProxyBody("go_email_send", { ...body, body_html: astral.repeat(go.FRIENDINGGO_BODY_MAX + 1) }), null, "one character over the cap");
  const size = Buffer.byteLength(JSON.stringify(body), "utf8");
  assert.ok(size < actions.adminActionBodyLimit("go_email_send"), `${size} bytes`);
  assert.equal(actions.adminActionBodyLimit("go_email_send"), 400_000);
  assert.equal(actions.adminActionBodyLimit("go_email_preview"), 400_000);
  assert.equal(go.FRIENDINGGO_BODY_MAX, 50_000, "one body limit (Core round 2, GoPreorderPolicy::BODY_MAX)");
  assert.equal(go.FRIENDINGGO_SUBJECT_MAX, 150);
});

test("access classes, the client's read set and the capability gate", () => {
  const expected: Record<go.FriendingGoAction, string> = {
    go_preorders: "read", go_preorder_set_status: "write", go_email_preview: "read", go_email_send: "write", go_email_campaigns: "read",
  };
  for (const [action, access] of Object.entries(expected)) {
    assert.equal(actions.ADMIN_ACTIONS.filter((item) => item === action).length, 1, action);
    assert.equal(actions.adminActionAccess(action), access, action);
    assert.equal(isAdminClientReadAction(action), access === "read", action);
    for (const role of ["viewer", "admin", "owner"]) {
      assert.equal(actions.isAdminActionAuthorized(action, actions.adminPrincipalFrom({ role })), access === "read" || role !== "viewer", `${action} ${role}`);
    }
  }
  assert.equal(actions.isAdminActionAllowed("go-preorders-export"), false, "the export is a dedicated route, never an action");
  assert.equal(go.friendingGoAdminMe({ ready: true, contract_version: 1 }), true);
  for (const value of [undefined, null, {}, { ready: true }, { ready: "true", contract_version: 1 }, { ready: true, contract_version: 2 },
    { ready: false, contract_version: 1 }, { ready: true, contract_version: 1, extra: 1 }, [true]]) {
    assert.equal(go.friendingGoAdminMe(value), false, JSON.stringify(value));
  }
  assert.equal(go.friendingGoProxyCapabilityAuthorized("go_preorders", { ...MEMBERSHIP_MEMBER }), false);
  assert.equal(go.friendingGoProxyCapabilityAuthorized("go_preorders", { ...MEMBERSHIP_MEMBER, friendinggo: { ready: true, contract_version: 1 } }), true);
  assert.equal(go.friendingGoProxyCapabilityAuthorized("mail_delivery", {}), null);
});

// The actual production POST of the bridge, run with controlled session, membership and Core adapters
// (the tests/mailDelivery.test.mts technique), and this feature's real normalizers.
function compileRoute(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: string[] = [];
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    for (const item of node.importClause.namedBindings.elements) imports.push(item.name.text);
  }
  return { source, code, imports };
}
const BRIDGE = compileRoute("../app/api/admin/[action]/route.ts");
function NextResponseStub(body: BodyInit, init: ResponseInit) { return new Response(body, init); }
NextResponseStub.json = (value: unknown, init: ResponseInit) => new Response(JSON.stringify(value), init);
const READY = { friendinggo: { ready: true, contract_version: 1 } };
const HEADERS = { origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" };

async function bridge(action: string, role: string, body: unknown, answer: { status: number; data: unknown }, membership: Json = READY) {
  const forwarded: Array<Record<string, unknown>> = [];
  const context: any = {
    exports: {}, Buffer, JSON, ...actions, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, adminBridgeCoreTransportError,
    webadminErrorEnvelope, isTrustedAdminRequest, withDatesAdminContract, ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
    normalizeMailDeliveryProxyBody, normalizeFriendingGoProxyBody: go.normalizeFriendingGoProxyBody,
    normalizeFriendingGoResponse: go.normalizeFriendingGoResponse, friendingGoProxyCapabilityAuthorized: go.friendingGoProxyCapabilityAuthorized,
    readAdminSession: async () => ({ email: MEMBERSHIP_EMAIL }),
    coreCall: async (name: string, payload: Record<string, unknown>) => {
      assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      if (name === "admin_me") return { status: 200, data: { ...MEMBERSHIP_MEMBER, ...membership, role } };
      assert.equal(name, action);
      forwarded.push({ ...payload });
      return answer;
    },
    mergeCoreParams: (input: Record<string, unknown>, owned: Record<string, unknown>) => ({ ...input, ...owned }),
    datesAvailabilityWriteIsRetired: () => false, isDatesAdminRoute: () => false, NextResponse: NextResponseStub,
  };
  for (const name of BRIDGE.imports) if (context[name] === undefined && name !== "NextRequest") context[name] = () => undefined;
  vm.runInNewContext(BRIDGE.code, context);
  const response = await context.exports.POST({ headers: new Headers(HEADERS), signal: new AbortController().signal, text: async () => JSON.stringify(body) },
    { params: Promise.resolve({ action }) }) as Response;
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control"), forwarded };
}
const strip = (body: Json) => { const { message: _m, status: _s, can_send: _c, ...rest } = body; return rest; };

test("DERIVED bridge: each route forwards its closed fields with the version and returns only the parsed answer", async () => {
  const list = await bridge("go_preorders", "owner", {}, { status: 200, data: OWNER });
  assert.equal(list.status, 200);
  assert.equal(list.cache, "no-store");
  assert.deepEqual(list.forwarded, [{ contract_version: 1, q: "", status: "", page: 1, admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(list.body, strip(OWNER), "no legacy trio, nothing unparsed");
  const extra = clone(OWNER); extra.data.rows[0].internal = "never forwarded";
  assert.equal(JSON.stringify((await bridge("go_preorders", "admin", {}, { status: 200, data: extra })).body).includes("internal"), false);
  const other = await bridge("go_preorders", "owner", { q: "ca", status: "active" }, { status: 200, data: OWNER });
  assert.deepEqual(other.body, { success: false, status_code: 502, error: "invalid-core-response" }, "an answer for other filters");

  const preview = await bridge("go_email_preview", "viewer", { ...NEWSLETTER }, { status: 200, data: PREVIEW });
  assert.equal(preview.status, 200, "a viewer may preview");
  assert.deepEqual(preview.forwarded, [{ contract_version: 1, ...NEWSLETTER, preorder_ids: THREE.join(","), admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(preview.body, strip(PREVIEW));

  const send = await bridge("go_email_send", "admin", { ...COMMANDS.send }, { status: 200, data: SEND });
  assert.deepEqual(send.body, strip(SEND));
  assert.equal(send.forwarded[0]!.request_id, COMMANDS.send.request_id, "the browser's request id travels unchanged");
  assert.equal(send.forwarded[0]!.expected_sendable, 2);
  const status = await bridge("go_preorder_set_status", "owner", { preorder_id: "00000000000000000000600f", status: "unsubscribed", request_id: "00000001-0000-4000-8000-000000000001" },
    { status: 200, data: UNSUBSCRIBE });
  assert.deepEqual(status.body, strip(UNSUBSCRIBE));
  const wrongReceipt = await bridge("go_preorder_set_status", "owner", { preorder_id: "00000000000000000000600f", status: "active", request_id: "00000009-0000-4000-8000-000000000009" },
    { status: 200, data: RESUBSCRIBE });
  assert.equal(wrongReceipt.body.error, "invalid-core-response", "a receipt for another request is not this answer");
  const detail = await bridge("go_email_campaigns", "owner", { campaign_id: "000000000000000000006002" }, { status: 200, data: DETAIL });
  assert.deepEqual(detail.forwarded, [{ contract_version: 1, page: 1, campaign_id: "000000000000000000006002", admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(detail.body, strip(DETAIL));
  const drafts = await bridge("go_email_campaigns", "admin", { state: "draft", page: 1 }, { status: 200, data: DRAFTS });
  assert.deepEqual(drafts.forwarded, [{ contract_version: 1, page: 1, state: "draft", admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(drafts.body, strip(DRAFTS));
  const sliced = await bridge("go_email_send", "owner", { ...COMMANDS.sliced }, { status: 200, data: SENDING });
  assert.deepEqual(sliced.body, strip(SENDING), "a sending slice reaches the page with its progress");
  const running = await bridge("go_email_send", "owner", { ...COMMANDS.takenOver }, { status: 409, data: IN_PROGRESS });
  assert.deepEqual(running.body, IN_PROGRESS, "the in-progress refusal keeps retry_after_seconds");
});

test("DERIVED bridge: a viewer never receives an address or a phone number, and never reaches a write", async () => {
  const leak = await bridge("go_preorders", "viewer", {}, { status: 200, data: OWNER });
  assert.deepEqual(leak.body, { success: false, status_code: 502, error: "invalid-core-response" });
  assert.equal(JSON.stringify(leak.body).includes("eve.moss@example.com"), false);
  const masked = await bridge("go_preorders", "viewer", {}, { status: 200, data: VIEWER });
  assert.deepEqual(masked.body, strip(VIEWER));
  const detailLeak = await bridge("go_email_campaigns", "viewer", { campaign_id: "000000000000000000006002" }, { status: 200, data: DETAIL });
  assert.equal(detailLeak.body.error, "invalid-core-response");
  assert.deepEqual((await bridge("go_email_campaigns", "viewer", { campaign_id: "000000000000000000006002" }, { status: 200, data: DETAIL_VIEWER })).body, strip(DETAIL_VIEWER));
  for (const [action, body] of [["go_email_send", { ...COMMANDS.test }], ["go_preorder_set_status", { preorder_id: THREE[0], status: "unsubscribed", request_id: COMMANDS.send.request_id }]] as const) {
    const denied = await bridge(action, "viewer", body, { status: 200, data: SEND });
    assert.equal(denied.status, 403, action);
    assert.equal(denied.body.error, "admin-write-required", action);
    assert.deepEqual(denied.forwarded, [], `${action} is refused before Core`);
  }
});

test("DERIVED bridge: without Core's capability block, with a bad body or with export, nothing reaches Core; refusals keep their receipt", async () => {
  const absent = await bridge("go_preorders", "owner", {}, { status: 200, data: OWNER }, {});
  assert.equal(absent.status, 403);
  assert.equal(absent.body.error, "friendinggo-capability-required");
  assert.deepEqual(absent.forwarded, []);
  for (const [action, body] of [["go_preorders", { export: "1" }], ["go_preorders", { q: "Ca" }], ["go_email_send", { ...COMMANDS.send, expected_sendable: 0 }],
    ["go_email_preview", { ...NEWSLETTER, admin_email: "other@example.test" }]] as const) {
    const result = await bridge(action, "owner", body, { status: 200, data: OWNER });
    assert.equal(result.status, 400, `${action} ${JSON.stringify(body).slice(0, 40)}`);
    assert.deepEqual(result.forwarded, []);
  }
  // Core's receipted refusal reaches the page as Core sent it: its counts and its receipt.
  const changed = fixture("webadmin-go-email-send-audience-changed");
  const refused = await bridge("go_email_send", "owner", { ...COMMANDS.send, request_id: "00000012-0000-4000-8000-000000000012" }, { status: 409, data: changed });
  assert.deepEqual(refused.body, changed);
  assert.equal(refused.status, 409);
  // A malformed success is unknown, never a send.
  const broken = clone(SEND); broken.data.campaign.counts.queued = 7;
  assert.deepEqual((await bridge("go_email_send", "owner", { ...COMMANDS.send }, { status: 200, data: broken })).body,
    { success: false, status_code: 502, error: "invalid-core-response" });
  assert.match(BRIDGE.source, /const friendingGoBody = normalizeFriendingGoProxyBody\(action, body\);\s*if \(friendingGoBody === null\) \{\s*return bridgeError\("invalid-input", 400\);/);
  assert.ok(BRIDGE.source.indexOf("normalizeFriendingGoProxyBody(action, body)") < BRIDGE.source.indexOf("const result = await coreCall("));
  assert.match(BRIDGE.source, /normalizeFriendingGoResponse\(action, result\.data, friendingGoBody, \{ viewer: principal\.role !== "owner" && principal\.role !== "admin" \}\)/);
});

// The dedicated CSV route, run the same way.
const EXPORT_ROUTE = compileRoute("../app/api/admin/go-preorders-export/route.ts");
async function exportRoute(body: unknown, writer: Json, answer: { status: number; data: unknown }, headers: Record<string, string> = HEADERS) {
  const forwarded: Array<Record<string, unknown>> = [];
  const context: any = {
    exports: {}, Buffer, JSON, Date, Number, String, ADMIN_MEMBERSHIP_UNCONFIRMED, adminPostForwardError, isTrustedAdminRequest,
    FRIENDINGGO_CONTRACT_VERSION: go.FRIENDINGGO_CONTRACT_VERSION, friendingGoConsoleReady: go.friendingGoConsoleReady, friendingGoError: go.friendingGoError,
    friendingGoExport: go.friendingGoExport, friendingGoExportFilters: go.friendingGoExportFilters,
    friendingGoCsv: csv.friendingGoCsv, friendingGoExportFilename: csv.friendingGoExportFilename,
    requireAdminWriter: async () => writer,
    coreCall: async (name: string, payload: Record<string, unknown>) => { assert.equal(name, "go_preorders"); forwarded.push({ ...payload }); return answer; },
    NextResponse: NextResponseStub,
  };
  for (const name of EXPORT_ROUTE.imports) if (context[name] === undefined && name !== "NextRequest") context[name] = () => undefined;
  vm.runInNewContext(EXPORT_ROUTE.code, context);
  const response = await context.exports.POST({ headers: new Headers(headers), signal: new AbortController().signal, text: async () => JSON.stringify(body) }) as Response;
  const raw = Buffer.from(await response.arrayBuffer());
  // `Response.text()` drops a byte-order mark; the file's bytes keep it.
  return { response, raw, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(raw), forwarded };
}
const OWNER_WRITER = { ok: true, session: { email: MEMBERSHIP_EMAIL }, role: "owner", membership: { ...MEMBERSHIP_MEMBER, ...READY, role: "owner" } };

test("DERIVED CSV route: a writer gets Core's export as a UTF-8 CSV file, and the request carries export=1", async () => {
  const { response, raw, text, forwarded } = await exportRoute({ q: "", status: "active" }, OWNER_WRITER, { status: 200, data: EXPORT });
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 with a byte-order mark");
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, [{ contract_version: 1, q: "", status: "active", export: 1, admin_email: MEMBERSHIP_EMAIL }]);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="friendinggo-preorders-\d{4}-\d{2}-\d{2}\.csv"$/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-friendinggo-row-count"), "3");
  assert.equal(response.headers.get("x-friendinggo-truncated"), "0");
  assert.ok(text.startsWith("﻿Name,First name,Email,Phone,City,"), "the byte-order mark, then the header");
  const lines = text.slice(1).split("\r\n");
  assert.equal(lines.length, 5, "header, three rows, and the final CRLF");
  assert.equal(lines[4], "");
  // Phone numbers start with "+": the formula guard prefixes them, so a spreadsheet keeps them as text.
  assert.equal(lines[1], "Cleo Park,Cleo,cleo@example.org,'+19195550103,\"Cary, NC\",,no,active,2027-01-15T06:23:20Z,,2027-01-15T06:23:20Z,2026-11-10,2027-01-15T06:23:20Z,friending.com/go,pending,00000000000000000000600f");
  assert.equal(csv.friendingGoExportFilename(new Date("2026-11-10T23:59:59Z")), "friendinggo-preorders-2026-11-10.csv");
});

test("DERIVED CSV route: role, origin, capability and filters are checked before Core; Core's refusal keeps its name", async () => {
  const viewer = await exportRoute({}, { ok: false, error: "admin-write-required", status: 403 }, { status: 200, data: EXPORT });
  assert.equal(viewer.response.status, 403);
  assert.deepEqual(JSON.parse(viewer.text), { success: false, status_code: 403, error: "admin-write-required" });
  assert.deepEqual(viewer.forwarded, []);
  const foreign = await exportRoute({}, OWNER_WRITER, { status: 200, data: EXPORT }, { ...HEADERS, origin: "https://evil.example" });
  assert.equal(foreign.response.status, 403);
  assert.deepEqual(foreign.forwarded, []);
  const noBlock = await exportRoute({}, { ...OWNER_WRITER, membership: { ...MEMBERSHIP_MEMBER, role: "owner" } }, { status: 200, data: EXPORT });
  assert.equal(JSON.parse(noBlock.text).error, "friendinggo-capability-required");
  for (const body of [{ q: "A" }, { status: "paused" }, { page: 1 }, [], "x"]) {
    const bad = await exportRoute(body, OWNER_WRITER, { status: 200, data: EXPORT });
    assert.equal(bad.response.status, 400, JSON.stringify(body));
    assert.deepEqual(bad.forwarded, []);
  }
  const denied = fixture("webadmin-go-preorders-export-viewer-denied");
  const refused = await exportRoute({}, OWNER_WRITER, { status: 403, data: denied });
  assert.deepEqual(JSON.parse(refused.text), { success: false, status_code: 403, error: "admin-write-required" });
  const filter = fixture("webadmin-go-preorders-filter-invalid");
  assert.deepEqual(JSON.parse((await exportRoute({}, OWNER_WRITER, { status: 422, data: filter })).text), { success: false, status_code: 422, error: "go-filter-invalid" });
  // Core's export for other filters, or a masked one, is never a file.
  for (const answer of [EXPORT, VIEWER]) {
    const wrong = await exportRoute({ q: "", status: "" }, OWNER_WRITER, { status: 200, data: answer });
    assert.equal(wrong.response.status, 502);
    assert.equal(JSON.parse(wrong.text).error, "invalid-core-response");
  }
});

test("CSV: RFC 4180 quoting and the formula-injection guard (review P3-6)", () => {
  assert.equal(csv.friendingGoCsvCell("plain"), "plain");
  assert.equal(csv.friendingGoCsvCell("Cary, NC"), "\"Cary, NC\"");
  assert.equal(csv.friendingGoCsvCell("Say \"hi\""), "\"Say \"\"hi\"\"\"");
  assert.equal(csv.friendingGoCsvCell("two\nlines"), "\"two\nlines\"");
  assert.equal(csv.friendingGoCsvCell("a\rb"), "\"a\rb\"");
  for (const [value, cell] of [
    ["=HYPERLINK(\"https://x.test\",\"y\")", "\"'=HYPERLINK(\"\"https://x.test\"\",\"\"y\"\")\""],
    ["+1 234", "'+1 234"], ["-2+3", "'-2+3"], ["@SUM(A1)", "'@SUM(A1)"], ["\tcmd", "'\tcmd"], ["\r=1", "\"'\r=1\""],
    ["=1,2", "\"'=1,2\""], ["Ana =1", "Ana =1"], ["", ""],
  ] as const) assert.equal(csv.friendingGoCsvCell(value), cell, JSON.stringify(value));
  // A whole DERIVED row: Core refuses URLs and <> in names, but not a leading =, + - or @.
  const row = { ...go.friendingGoExport(EXPORT, { q: "", status: "active" })!.rows[0]!, name: "=cmd|'/C calc'!A0", first_name: "@x", city_label: "-Raleigh" };
  const file = csv.friendingGoCsv([row]);
  const [, line] = file.slice(1).split("\r\n");
  assert.ok(line!.startsWith("'=cmd|'/C calc'!A0,'@x,cleo@example.org,'+19195550103,'-Raleigh,"), line);
  assert.equal(csv.FRIENDINGGO_CSV_COLUMNS.length, csv.friendingGoCsvRow(row).length);
  assert.ok(file.endsWith("\r\n"));
});

test("the console's stored state decodes exactly, and a retry can never acquire new meaning", () => {
  const pending = { version: 1, command: { ...COMMANDS.send } };
  assert.deepEqual(state.friendingGoPendingEmail(clone(pending)), pending);
  for (const variant of [{ ...pending, version: 2 }, { ...pending, extra: 1 }, { version: 1, command: { ...COMMANDS.send, expected_sendable: 9 } },
    { version: 1, command: { ...COMMANDS.send, preorder_ids: [...THREE].reverse() } }, { version: 1, command: { ...COMMANDS.test, audience: "selected" } }]) {
    assert.equal(state.friendingGoPendingEmail(variant), null, JSON.stringify(variant).slice(0, 80));
  }
  const status = { version: 1, command: { preorder_id: THREE[0], status: "unsubscribed", request_id: COMMANDS.send.request_id }, name: "Ava Stone" };
  assert.deepEqual(state.friendingGoPendingStatus(clone(status)), status);
  assert.equal(state.friendingGoPendingStatus({ ...status, command: { ...status.command, status: "bounced" } }), null);
  // Storage: unreadable values are removed, a blocked storage is reported, never thrown.
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  assert.equal(state.friendingGoStore(storage, "k", pending), true);
  assert.deepEqual(state.friendingGoStored(storage, "k", state.friendingGoPendingEmail), pending);
  map.set("k", "{not json");
  assert.equal(state.friendingGoStored(storage, "k", state.friendingGoPendingEmail), null);
  assert.equal(map.has("k"), false);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(state.friendingGoStored(blocked, "k", state.friendingGoPendingEmail), undefined);
  assert.equal(state.friendingGoStore(blocked, "k", pending), false);
  assert.equal(state.friendingGoStore(null, "k", pending), false);
});

test("the composer turns typing into exactly the canonical content, or says every reason it cannot be sent", () => {
  const people: state.FriendingGoSelected[] = [
    { id: THREE[2]!, name: "Eve Moss", status: "unsubscribed" }, { id: THREE[0]!, name: "Ava Stone", status: "active" }, { id: THREE[1]!, name: "Ben Carter", status: "active" },
  ];
  const composer: state.FriendingGoComposer = { kind: "newsletter", audience: "selected", subject: "  FriendingGO  update ", preheader: "What is new with your cat tag",
    body: `\n${BODY}\n`, campaignId: "" };
  const result = state.friendingGoComposerContent(composer, people);
  assert.ok(result.ok);
  assert.deepEqual(result.value, NEWSLETTER, "trimmed, spaces collapsed, ids sorted");
  assert.equal(state.friendingGoContentKey(result.value), state.friendingGoContentKey(NEWSLETTER));
  const long = state.friendingGoComposerContent({ ...composer, body: `<p>${"a".repeat(go.FRIENDINGGO_BODY_MAX - 7)}</p>` }, people);
  assert.ok(long.ok, "exactly 50,000 characters");
  const over = state.friendingGoComposerContent({ ...composer, body: `<p>${"a".repeat(go.FRIENDINGGO_BODY_MAX - 6)}</p>` }, people);
  assert.deepEqual(over.ok ? [] : over.problems, ["body"], "one more is refused before Core");
  const bad = state.friendingGoComposerContent({ ...composer, kind: "direct", audience: "all_active", subject: "", body: "<p>open" }, []);
  assert.deepEqual(bad.ok ? [] : bad.problems, ["subject", "body", "directAudience"]);
  const many = Array.from({ length: 101 }, (_, index) => ({ id: index.toString(16).padStart(24, "0"), name: "", status: null }));
  const direct = state.friendingGoComposerContent({ ...composer, kind: "direct" }, many);
  assert.deepEqual(direct.ok ? [] : direct.problems, ["directTooMany"]);
  assert.deepEqual(state.friendingGoComposerContent({ ...composer }, []).ok ? [] : (state.friendingGoComposerContent({ ...composer }, []) as { problems: string[] }).problems, ["audienceEmpty"]);
  assert.deepEqual(state.friendingGoInsert("Hi !", 3, 3, "{{first_name}}"), { text: "Hi {{first_name}}!", caret: 17 });
  assert.deepEqual(state.friendingGoInsert("Hi you!", 3, 6, "{{city}}"), { text: "Hi {{city}}!", caret: 11 });
  assert.deepEqual(state.friendingGoComposer(clone(composer)), composer);
  assert.equal(state.friendingGoComposer({ ...composer, campaignId: "x" }), null);
  assert.deepEqual(state.friendingGoSelection(clone(people)), people);
  assert.equal(state.friendingGoSelection([...people, people[0]]), null, "a person twice");
});

test("the write paths mint a request id once, store it before sending, and retry exactly the stored command", () => {
  const email = readFileSync(new URL("../components/FriendingGoEmailConsole.tsx", import.meta.url), "utf8");
  const preorders = readFileSync(new URL("../components/FriendingGoPreordersConsole.tsx", import.meta.url), "utf8");
  for (const source of [email, preorders]) {
    assert.equal(source.match(/crypto\.randomUUID\(\)/gu)?.length, 1, "one place mints an id");
    assert.doesNotMatch(source, /useAdminReadRecovery/);
  }
  assert.match(email, /if \(!friendingGoStore\(browserStorage\(\), FRIENDINGGO_STORAGE_KEYS\.pendingEmail, stored\)\) \{[\s\S]*?return;\s*\}\s*setPending\(stored\);\s*void execute\(stored\);/u);
  assert.match(email, /onRetryPending=\{\(\) => \{ if \(pending\) void execute\(pending\); \}\}/u);
  assert.match(preorders, /if \(!friendingGoStore\(browserStorage\(\), FRIENDINGGO_STORAGE_KEYS\.pendingStatus, command\)\) \{[\s\S]*?return;\s*\}\s*setPending\(command\);\s*void settleStatus\(command\);/u);
  assert.match(preorders, /onRetryStatus=\{\(\) => \{ if \(pending\) void settleStatus\(pending\); \}\}/u);
  // An unknown outcome and a paused send keep the command; a sending slice is carried on with the same command.
  assert.match(email, /\} else if \(step\.kind === "unknown"\) \{\s*\/\/[^\n]*\n\s*setPending\(stored\);/u);
  assert.match(email, /\} else if \(step\.kind === "paused"\) \{\s*\/\/[^\n]*\n\s*setPending\(stored\);/u);
  assert.match(email, /response = await adminCall\("go_email_send", \{ \.\.\.command \}\);\s*const next = friendingGoSendStep\(response, command, loop\);/u);
  // Write access comes from Core's answer, never from the role (Core round 2).
  assert.match(email, /setAccess\(list \? \{ load: "ready", canWrite: list\.can_write, active: list\.totals\.active \}/u);
  const page = readFileSync(new URL("../app/(dashboard)/friendinggo/email/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /isAdminWriteRole|\.role\b/u);
});

test("Email delivery reads Core's three FriendingGO kinds (review P1-1, DERIVED from its genuine capture)", () => {
  const owner = JSON.parse(readFileSync(new URL("./fixtures/mail_delivery_wire/owner-30-days.json", import.meta.url), "utf8"));
  const filters = { ...DEFAULT_MAIL_DELIVERY_FILTERS, days: 30 as const };
  for (const kind of ["go_preorder_confirmation", "go_direct_email", "go_newsletter"]) {
    assert.ok((MAIL_DELIVERY_KINDS as readonly string[]).includes(kind), kind);
    const body = clone(owner); body.data.rows[0].kind = kind;
    assert.equal(mailDelivery(body, filters)?.rows[0]?.kind, kind, `a ${kind} row no longer fails the page`);
    assert.deepEqual(normalizeMailDeliveryProxyBody("mail_delivery", { kind }), { days: 1, page: 1, kind });
  }
  const messages = ["en", "hu"].map((locale) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")));
  for (const locale of messages) for (const kind of MAIL_DELIVERY_KINDS) assert.equal(typeof locale.mailDelivery.kind[kind], "string", kind);
});

test("message tables: every refusal has its text, in both locales, and the section is in the navigation and the help", () => {
  const messages = { en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")), hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")) };
  const keys = [...new Set([...Object.values(go.FRIENDINGGO_ERRORS).map((entry) => entry.key), ...go.FRIENDINGGO_CONSOLE_ERROR_KEYS])].sort();
  const tree = (value: unknown): unknown => value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Json).sort().map(([key, child]) => [key, tree(child)])) : null;
  assert.deepEqual(tree(messages.en.friendinggo), tree(messages.hu.friendinggo), "identical key trees");
  for (const locale of ["en", "hu"] as const) {
    const copy = messages[locale].friendinggo;
    assert.deepEqual(Object.keys(copy.errors).sort(), keys, locale);
    for (const status of go.FRIENDINGGO_STATUSES) assert.equal(typeof copy.status[status], "string");
    for (const source of go.FRIENDINGGO_STATUS_SOURCES) assert.equal(typeof copy.statusSource[source], "string");
    for (const key of go.FRIENDINGGO_DELIVERY_COUNT_KEYS) assert.equal(typeof copy.delivery[key], "string");
    assert.deepEqual(Object.keys(copy.preorders.status.locked).sort(), ["bounced", "complained", "feedback", "self", "unsubscribed"]);
    assert.deepEqual(Object.keys(copy.statusSource).sort(), [...go.FRIENDINGGO_STATUS_SOURCES].sort());
    assert.equal(messages[locale].nav.friendingGo, "FriendingGO");
    for (const page of ["friendingGoPreorders", "friendingGoEmail", "friendingGoSent"]) assert.ok(messages[locale].adminHelp.pages[page], `${locale} ${page}`);
    // Viewers search names and cities only (contract §10.4), and the hint says so.
    assert.match(copy.preorders.filters.viewerSearch, locale === "en" ? /names and cities only/u : /csak neveket és városokat/u);
  }
  const shell = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\{ href: "\/friendinggo", key: "friendingGo", icon: "friendingGo" \}/);
  assert.match(shell, /item\.key !== "friendingGo" \|\| friendingGoConsoleReady/);
  const layout = readFileSync(new URL("../app/(dashboard)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /friendingGoConsoleReady=\{me\.friendingGoConsoleReady\}/);
  for (const page of ["friendinggo/page.tsx", "friendinggo/email/page.tsx", "friendinggo/sent/page.tsx"]) {
    assert.match(readFileSync(new URL(`../app/(dashboard)/${page}`, import.meta.url), "utf8"), /if \(!me\?\.friendingGoConsoleReady\) notFound\(\);/u, page);
  }
  const session = readFileSync(new URL("../lib/session.ts", import.meta.url), "utf8");
  assert.match(session, /friendingGoConsoleReady: friendingGoConsoleReady\(data\),/);
});

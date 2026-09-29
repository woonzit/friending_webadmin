import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";
import {
  FOOTPRINT_ROLLOUT_MODES,
  FOOTPRINT_REPORT_REASONS,
  FOOTPRINT_REPORT_RESOLUTIONS,
  canRemoveFootprintMessage,
  footprintReportMemberUid,
  footprintReportPage,
  footprintReportResolveResult,
  footprintStateKeys,
  footprintsAdminPayload,
  isFootprintReportCursor,
  normalizedFootprintResolutionNote,
} from "../lib/footprints.ts";

type Json = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const GROUP_ID = "111111111111111111111111";
const BADGE_ID = "222222222222222222222222";
const REPORT_ID = "333333333333333333333333";
const EVENT_ID = "444444444444444444444444";
const REPORT_ID_2 = "555555555555555555555555";
const EVENT_ID_2 = "666666666666666666666666";

const ADMIN_PAYLOAD = {
  settings: { daily_limit: 5, message_max_length: 40, revision: 2 },
  badges: [{
    id: BADGE_ID,
    labels: { en: "Very hot!", hu: "Nagyon dögös!" },
    image_url: "https://pic.example.test/api/cache/admin/uploads/badge.png",
    sender_genders: ["male"],
    sender_group_ids: [GROUP_ID],
    recipient_genders: ["male"],
    recipient_group_ids: [GROUP_ID],
    sort_order: 100,
    active: true,
    archived: false,
    revision: 1,
  }],
  cast_groups: [{
    id: GROUP_ID,
    labels: { en: "Gay men", hu: "Meleg férfiak" },
    active: true,
  }],
  open_reports: 1,
};

test("parses the complete two-sided footprint admin contract", () => {
  const parsed = footprintsAdminPayload(ADMIN_PAYLOAD);
  assert.ok(parsed);
  assert.equal(parsed.badges[0]?.senderGroupIds[0], GROUP_ID);
  assert.equal(parsed.badges[0]?.recipientGenders[0], "male");
  assert.equal(parsed.castGroups[0]?.labels.hu, "Meleg férfiak");
  assert.equal(parsed.castGroups[0]?.active, true);
});

test("fails closed instead of skipping malformed badges or cast groups", () => {
  assert.equal(footprintsAdminPayload({ ...ADMIN_PAYLOAD, badges: [{}] }), null);
  assert.equal(footprintsAdminPayload({ ...ADMIN_PAYLOAD, cast_groups: [{}] }), null);
  assert.equal(footprintsAdminPayload({ ...ADMIN_PAYLOAD, open_reports: "1" }), null);
  assert.equal(footprintsAdminPayload({
    ...ADMIN_PAYLOAD,
    badges: [{ ...ADMIN_PAYLOAD.badges[0], sender_group_ids: ["unknown"] }],
  }), null);
});

test("a catalogue badge stored without artwork no longer refuses the whole catalogue", () => {
  // Core's adminBadgeWire answers `(string) ($badge['image_url'] ?? '')`, so a legacy
  // badge without artwork arrives as "". The grid renders its blank placeholder.
  const parsed = footprintsAdminPayload({
    ...ADMIN_PAYLOAD,
    badges: [{ ...ADMIN_PAYLOAD.badges[0], image_url: "" }],
  });
  assert.ok(parsed);
  assert.equal(parsed.badges[0]?.imageUrl, "");
  // Only the empty string widened: a missing or non-string picture is still malformed.
  for (const imageUrl of [null, 7, undefined, ["x"]]) {
    assert.equal(footprintsAdminPayload({
      ...ADMIN_PAYLOAD,
      badges: [{ ...ADMIN_PAYLOAD.badges[0], image_url: imageUrl }],
    }), null, String(imageUrl));
  }
});

/**
 * The rows Core d5d9767c (P-066) answers from `FootprintService::reportWireRows()`:
 * the keys the shipped console read first, then the additive ten. Core has no
 * wire capture for this queue, so these follow its code: `reason` through
 * `storedReason()`, `resolution` through `storedResolution()`, nullable notes and
 * times, the uids cast with `(int)`, and `footprint_state` from the event read.
 */
const OPEN_ROW = {
  id: REPORT_ID,
  footprint_id: EVENT_ID,
  reporter: { id: 42, displayname: { value: "Reporter" }, avatar: "" },
  sender: { id: 84, displayname: "Sender", avatar: "avatar.jpg" },
  badge: {
    id: BADGE_ID,
    labels: { en: "Very hot!", hu: "Nagyon dögös!" },
    image_url: "https://pic.example.test/badge.png",
    sender_genders: [],
    sender_group_ids: [],
    recipient_genders: [],
    recipient_group_ids: [],
    sort_order: 100,
    active: true,
    archived: false,
    revision: 1,
    updated_at: 1_786_000_000,
  },
  message: "Hello",
  created_at: 1_786_300_000,
  status: "open",
  resolved_by: "",
  reporter_uid: 42,
  sender_uid: 84,
  reason: "aggression",
  note: "He keeps writing this",
  footprint_created_at: 1_786_299_000,
  resolution: null,
  resolution_note: null,
  resolved_at: null,
  footprint_state: { exists: true, hidden: true, message_removed: false },
  sender_report_count: 3,
};

const RESOLVED_ROW = {
  ...OPEN_ROW,
  id: REPORT_ID_2,
  footprint_id: EVENT_ID_2,
  status: "resolved",
  resolved_by: "ops@example.test",
  resolution: "message_removed",
  resolution_note: "Insults",
  resolved_at: 1_786_400_000,
  footprint_state: { exists: true, hidden: true, message_removed: true },
};

/** The legacy row the shipped console read before P-066: none of the additive keys. */
const LEGACY_ROW = Object.fromEntries(
  Object.entries(OPEN_ROW).filter(([key]) => ![
    "reporter_uid", "sender_uid", "reason", "note", "footprint_created_at", "resolution",
    "resolution_note", "resolved_at", "footprint_state", "sender_report_count",
  ].includes(key)),
);

function envelope(status: "open" | "resolved", reports: unknown[], paging: Json | null = { has_more: false, next_cursor: null }): Json {
  // The real legacy envelope: Webadmin::reply rewrites `status` and adds the trio.
  return {
    success: true,
    status_code: 200,
    report_status: status,
    reports,
    ...(paging ?? {}),
    message: 200,
    status: 200,
    can_send: 0,
  };
}

test("report pages bind to the requested tab and survive the real legacy envelope", () => {
  const page = footprintReportPage(envelope("open", [OPEN_ROW]), "open");
  assert.ok(page);
  assert.equal(page.reports[0]?.reporter?.name, "Reporter");
  assert.equal(footprintReportPage(envelope("open", [OPEN_ROW]), "resolved"), null);
  assert.deepEqual(footprintReportPage(envelope("open", []), "open"), { reports: [], hasMore: false, nextCursor: null });
  assert.equal(footprintReportPage({ ...envelope("resolved", []) }, "open"), null);
});

test("an extended P-066 row parses every additive field", () => {
  const open = footprintReportPage(envelope("open", [OPEN_ROW]), "open")!.reports[0]!;
  assert.equal(open.extended, true);
  assert.equal(open.reporterUid, 42);
  assert.equal(open.senderUid, 84);
  assert.equal(open.reason, "aggression");
  assert.equal(open.note, "He keeps writing this");
  assert.equal(open.footprintCreatedAt, 1_786_299_000);
  assert.equal(open.resolution, null);
  assert.equal(open.resolutionNote, null);
  assert.equal(open.resolvedAt, null);
  assert.deepEqual(open.footprintState, { exists: true, hidden: true, messageRemoved: false });
  assert.equal(open.senderReportCount, 3);
  assert.equal(open.badgeLabel, "Very hot!");

  const resolved = footprintReportPage(envelope("resolved", [RESOLVED_ROW]), "resolved")!.reports[0]!;
  assert.equal(resolved.resolution, "message_removed");
  assert.equal(resolved.resolutionNote, "Insults");
  assert.equal(resolved.resolvedAt, 1_786_400_000);
  assert.equal(resolved.resolvedBy, "ops@example.test");
});

test("a legacy row without the additive keys still reads, with nothing invented", () => {
  const page = footprintReportPage(envelope("open", [LEGACY_ROW], null), "open");
  assert.ok(page);
  assert.equal(page.hasMore, false);
  const row = page.reports[0]!;
  assert.equal(row.extended, false);
  assert.equal(row.reason, null);
  assert.equal(row.footprintState, null);
  assert.equal(row.senderReportCount, null);
  // Member links fall back to the cards; Remove message needs Core's proof of support.
  assert.equal(footprintReportMemberUid(row, "reporter"), 42);
  assert.equal(footprintReportMemberUid(row, "sender"), 84);
  assert.equal(canRemoveFootprintMessage(row), false);
});

test("an empty badge image_url is tolerated per row; the rest of the page still reads", () => {
  const blank = { ...OPEN_ROW, id: REPORT_ID_2, badge: { ...OPEN_ROW.badge, image_url: "" } };
  const page = footprintReportPage(envelope("open", [OPEN_ROW, blank]), "open");
  assert.ok(page, "one badge without artwork must not refuse the whole queue");
  assert.equal(page.reports.length, 2);
  assert.equal(page.reports[0]?.badgeImage, "https://pic.example.test/badge.png");
  assert.equal(page.reports[1]?.badgeImage, "");
  assert.equal(page.reports[1]?.badgeLabel, "Very hot!");
  // A row whose badge is gone (null) is also fine; a malformed badge is still refused.
  assert.ok(footprintReportPage(envelope("open", [{ ...OPEN_ROW, badge: null }]), "open"));
  for (const badge of [
    { ...OPEN_ROW.badge, image_url: null },
    { ...OPEN_ROW.badge, image_url: 3 },
    { ...OPEN_ROW.badge, labels: [] },
    "badge",
  ]) {
    assert.equal(footprintReportPage(envelope("open", [OPEN_ROW, { ...blank, badge }]), "open"), null);
  }
});

test("known values keep their validation: malformed or partial rows refuse the page", () => {
  const refused = (status: "open" | "resolved", row: Json, why: string) =>
    assert.equal(footprintReportPage(envelope(status, [row]), status), null, why);
  refused("open", {}, "empty row");
  refused("open", { ...OPEN_ROW, created_at: "yesterday" }, "string time");
  refused("open", { ...OPEN_ROW, status: "resolved" }, "row from another tab");
  const partial = clone(OPEN_ROW) as Json;
  delete partial.sender_report_count;
  refused("open", partial, "partial additive key set");
  refused("open", { ...OPEN_ROW, reason: "insult" }, "reason outside Core's closed set");
  refused("open", { ...OPEN_ROW, reason: null }, "Core always names a reason (unspecified)");
  refused("open", { ...OPEN_ROW, note: "" }, "Core sends null for no note");
  refused("open", { ...OPEN_ROW, note: "x".repeat(501) }, "note over 500 code points");
  refused("open", { ...OPEN_ROW, reporter_uid: 43 }, "card of another member");
  refused("open", { ...OPEN_ROW, sender_uid: -1 }, "negative uid");
  refused("open", { ...OPEN_ROW, sender_report_count: "3" }, "string count");
  refused("open", { ...OPEN_ROW, footprint_state: { exists: true, hidden: false } }, "partial state");
  refused("open", { ...OPEN_ROW, footprint_state: { exists: true, hidden: false, message_removed: false, x: 1 } }, "unknown state key");
  refused("open", { ...OPEN_ROW, footprint_state: { exists: false, hidden: true, message_removed: false } }, "a missing footprint cannot be hidden");
  refused("open", { ...OPEN_ROW, resolution: "dismissed" }, "open report with an outcome");
  refused("open", { ...OPEN_ROW, resolved_at: 1_786_400_000 }, "open report with a resolution time");
  refused("open", { ...OPEN_ROW, footprint_created_at: 0 }, "Core sends null, never 0");
  refused("resolved", { ...RESOLVED_ROW, resolution: null }, "resolved report without its kind");
  refused("resolved", { ...RESOLVED_ROW, resolution: "confirmed" }, "resolution outside Core's set");
  refused("resolved", { ...RESOLVED_ROW, resolution_note: "x".repeat(301) }, "resolution note over 300 code points");
  // The 300/500 bounds are code points, as Core counts them.
  assert.ok(footprintReportPage(envelope("resolved", [{ ...RESOLVED_ROW, resolution_note: "😀".repeat(300) }]), "resolved"));
  assert.ok(footprintReportPage(envelope("open", [{ ...OPEN_ROW, note: "😀".repeat(500) }]), "open"));
  // Duplicate ids refuse the page.
  assert.equal(footprintReportPage(envelope("open", [OPEN_ROW, OPEN_ROW]), "open"), null);
});

test("a stored row without a uid reads as unknown, never as member 0", () => {
  // `(int) ($row['sender_uid'] ?? 0)`: Core builds no card for uid 0.
  const row = footprintReportPage(envelope("open", [{ ...OPEN_ROW, sender_uid: 0, sender: null }]), "open")!.reports[0]!;
  assert.equal(row.senderUid, null);
  assert.equal(footprintReportMemberUid(row, "sender"), null);
  assert.equal(footprintReportPage(envelope("open", [{ ...OPEN_ROW, sender_uid: 0 }]), "open"), null,
    "a card cannot describe an unknown member");
  // A banned member has no card, but the raw uid still links to the member page.
  const banned = footprintReportPage(envelope("open", [{ ...OPEN_ROW, sender: null }]), "open")!.reports[0]!;
  assert.equal(footprintReportMemberUid(banned, "sender"), 84);
});

test("pagination follows Core's cursor exactly and refuses anything half-said", () => {
  const cursor = `${OPEN_ROW.created_at}:${OPEN_ROW.id}`;
  assert.equal(isFootprintReportCursor(cursor), true);
  const more = footprintReportPage(envelope("open", [OPEN_ROW], { has_more: true, next_cursor: cursor }), "open", 1);
  assert.deepEqual(more && { hasMore: more.hasMore, nextCursor: more.nextCursor }, { hasMore: true, nextCursor: cursor });
  const page = (paging: Json | null, limit: number | null = 1, rows: unknown[] = [OPEN_ROW]) =>
    footprintReportPage(envelope("open", rows, paging), "open", limit);
  assert.equal(page({ has_more: true, next_cursor: null }), null, "continuation without a cursor");
  assert.equal(page({ has_more: true, next_cursor: "abc" }), null, "not Core's cursor");
  assert.equal(page({ has_more: true, next_cursor: `1:${OPEN_ROW.id}` }), null, "cursor that does not name the last row");
  assert.equal(page({ has_more: true, next_cursor: cursor }, 2), null, "a continuation page is full");
  assert.equal(page({ has_more: true, next_cursor: cursor }, 1, []), null, "an empty page cannot continue");
  assert.equal(page({ has_more: false, next_cursor: cursor }), null, "a last page has no cursor");
  assert.equal(page({ has_more: "false", next_cursor: null }), null, "string boolean");
  assert.equal(page({ has_more: false }), null, "half of the pair");
  assert.equal(page({ next_cursor: null }), null, "the other half");
  assert.equal(page({ has_more: false, next_cursor: null }, 1, [OPEN_ROW, { ...OPEN_ROW, id: REPORT_ID_2 }]), null,
    "more rows than the console asked for");
  assert.ok(page(null, 1), "a Core without paging answers one bounded page");
});

test("the resolve answer proves the mutation; the resolved row is trusted only when it reads", () => {
  const answer = { success: true, status_code: 200, resolved: true, report: RESOLVED_ROW, message: 200, status: 200, can_send: 0 };
  const result = footprintReportResolveResult(answer, REPORT_ID_2);
  assert.equal(result?.report?.id, REPORT_ID_2);
  assert.equal(result?.report?.resolution, "message_removed");
  assert.deepEqual(footprintReportResolveResult({ success: true, status_code: 200, resolved: true }, REPORT_ID_2), { report: null });
  assert.deepEqual(footprintReportResolveResult({ ...answer, report: OPEN_ROW }, REPORT_ID), { report: null });
  assert.equal(footprintReportResolveResult({ ...answer, resolved: false }, REPORT_ID_2), null);
  assert.equal(footprintReportResolveResult({ success: false, status_code: 422, error: "footprint-report-action-invalid" }, REPORT_ID_2), null);
  assert.equal(footprintReportResolveResult(null, REPORT_ID_2), null);
});

test("a resolved row for another report is not an answer to this request", () => {
  // RESOLVED_ROW is report REPORT_ID_2; the console asked to resolve REPORT_ID.
  const answer = { success: true, status_code: 200, resolved: true, report: RESOLVED_ROW };
  assert.equal(footprintReportResolveResult(answer, REPORT_ID), null);
  assert.equal(footprintReportResolveResult({ ...answer, report: { ...RESOLVED_ROW, id: REPORT_ID } }, REPORT_ID)?.report?.id, REPORT_ID);
});

test("the resolution note is normalized like Core's and bounded instead of cut", () => {
  assert.equal(normalizedFootprintResolutionNote("  spam \n\t again  "), "spam again");
  assert.equal(normalizedFootprintResolutionNote(""), "");
  assert.equal(normalizedFootprintResolutionNote("😀".repeat(300)), "😀".repeat(300));
  assert.equal(normalizedFootprintResolutionNote("😀".repeat(301)), null);
});

test("Remove message needs Core's footprint state and a message to clear", () => {
  const open = footprintReportPage(envelope("open", [OPEN_ROW]), "open")!.reports[0]!;
  assert.equal(canRemoveFootprintMessage(open), true);
  assert.deepEqual(footprintStateKeys(open), ["hidden"]);
  const state = (footprint_state: Json, extra: Json = {}) =>
    footprintReportPage(envelope("open", [{ ...OPEN_ROW, footprint_state, ...extra }]), "open")!.reports[0]!;
  assert.equal(canRemoveFootprintMessage(state({ exists: false, hidden: false, message_removed: false })), false);
  assert.deepEqual(footprintStateKeys(state({ exists: false, hidden: false, message_removed: false })), ["missing"]);
  assert.equal(canRemoveFootprintMessage(state({ exists: true, hidden: true, message_removed: true })), false);
  assert.deepEqual(footprintStateKeys(state({ exists: true, hidden: false, message_removed: true })), ["visible", "messageRemoved"]);
  assert.equal(canRemoveFootprintMessage(state({ exists: true, hidden: true, message_removed: false }, { message: "" })), false);
  const resolved = footprintReportPage(envelope("resolved", [RESOLVED_ROW]), "resolved")!.reports[0]!;
  assert.equal(canRemoveFootprintMessage(resolved), false);
});

test("the queue pages, gates both resolutions on a write role and confirms with a note", async () => {
  const panel = await readFile(new URL("../components/FootprintReportsPanel.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/(dashboard)/footprints/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<FootprintReportsPanel/);
  assert.doesNotMatch(page, /resolve_footprint_report|footprint_reports/);
  // Pages: an explicit limit, then Core's cursor; a late page of an old tab is dropped.
  assert.match(panel, /adminCall\("footprint_reports", \{\s*status: nextStatus,\s*limit: FOOTPRINT_REPORT_PAGE_SIZE,/);
  assert.match(panel, /adminCall\("footprint_reports", \{\s*status,\s*cursor,\s*limit: FOOTPRINT_REPORT_PAGE_SIZE,/);
  assert.match(panel, /if \(requestId !== request\.current\) return;/);
  // Both resolutions are Core editor actions: rendered only after admin_me proved a write role,
  // re-checked in the handlers, and sent only from the confirmation dialog.
  assert.match(panel, /setAccess\(isAdminWriteRole\(response\.role\) \? "write" : "read"\)/);
  assert.match(panel, /const canWrite = access === "write";/);
  assert.match(panel, /canWrite \? \(\s*<span className="footprints-report-actions">/);
  assert.match(panel, /if \(!canWrite\) return;\s*setNotice\(null\);/);
  assert.match(panel, /if \(!pending \|\| !canWrite \|\| busy\) return;/);
  assert.match(panel, /<ConfirmDialog[\s\S]*onConfirm=\{\(\) => void confirmAction\(\)\}/);
  assert.equal([...panel.matchAll(/adminCall\("resolve_footprint_report"/g)].length, 1);
  assert.match(panel, /adminCall\("resolve_footprint_report", \{\s*id: report\.id,\s*action,\s*note: normalizedNote,\s*\}\)/);
  assert.match(panel, /canRemoveFootprintMessage\(report\) \?/);
  // The answer is bound to the requested report; an uncertain or foreign one
  // re-reads the queue instead of offering a blind retry.
  assert.match(panel, /footprintReportResolveResult\(response, report\.id\)/);
  assert.match(panel, /if \(!result\) \{[\s\S]*?void load\(status\);/);
  // Member links from the raw uids, so a member without a card still links.
  assert.match(panel, /href=\{`\/users\/\$\{uid\}`\}/);
  assert.equal(adminActionAccess("footprint_reports"), "read");
  assert.equal(adminActionAccess("resolve_footprint_report"), "write");
  assert.ok(ADMIN_ACTIONS.includes("admin_me"));
});

test("every reason, state and outcome Core can send has EN and HU copy", async () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const copy = messages.footprints;
    assert.deepEqual(Object.keys(copy.reportReasons), [...FOOTPRINT_REPORT_REASONS]);
    assert.deepEqual(Object.keys(copy.reportResolution), [...FOOTPRINT_REPORT_RESOLUTIONS]);
    assert.deepEqual(Object.keys(copy.reportState), ["missing", "visible", "hidden", "messageRemoved"]);
    // The single Resolve button is gone; its key went with it.
    assert.equal(Object.hasOwn(copy, "resolve"), false);
  }
});

/**
 * T-651 (T-640 audit D5/D8). `FootprintPolicy::audienceMatches()` delegates to
 * the gender-only `UserAudiencePolicy::matches()` since D-096, so a badge
 * restricted to one cast group is offered to everyone. The console keeps the
 * control — the selection is stored and echoed back — but stops claiming the
 * two axes are ANDed.
 */
test("the badge audience editor no longer promises cast-group narrowing", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    new URL("../app/(dashboard)/footprints/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /matchBothAxes/);
  assert.doesNotMatch(page, /audienceHint/);
  // The note fires on a group-only selection too, which is the case that now
  // silently means "everyone".
  assert.match(
    page,
    /\{groupIds\.length > 0 \? \(\s*<p className="footprints-match-logic">\{t\("groupsNotEnforced"\)\}<\/p>/,
  );
  assert.match(page, /\{t\("chipGroups"\)\} <span>\{t\("groupsRecorded"\)\}<\/span>/);

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    assert.equal(Object.hasOwn(messages.footprints, "groupsRecorded"), true);
    assert.equal(Object.hasOwn(messages.footprints, "groupsNotEnforced"), true);
    // The old hint asserted "must BOTH pass" and had zero call sites.
    assert.doesNotMatch(JSON.stringify(messages.footprints), /BOTH|EGYÜTT/);
  }
});

test("P-045: the footprint admin reports which daily limit is live, and an unknown value claims nothing", async () => {
  assert.equal(footprintsAdminPayload(ADMIN_PAYLOAD)?.rolloutMode, null, "an older Core says nothing");
  for (const mode of FOOTPRINT_ROLLOUT_MODES) {
    assert.equal(footprintsAdminPayload({ ...ADMIN_PAYLOAD, rollout_mode: mode })?.rolloutMode, mode);
  }
  for (const value of ["Legacy", "shadow", "", 1, null, true]) {
    const parsed = footprintsAdminPayload({ ...ADMIN_PAYLOAD, rollout_mode: value });
    assert.ok(parsed, `${JSON.stringify(value)}: the rest of the page still loads`);
    assert.equal(parsed.rolloutMode, null, JSON.stringify(value));
  }
  const page = await readFile(new URL("../app/(dashboard)/footprints/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{payload\.rolloutMode \? \(/);
  assert.match(page, /data-footprint-rollout=\{payload\.rolloutMode\}/);
  assert.match(page, /t\(`limitRollout\.\$\{payload\.rolloutMode\}`\)/);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(messages.footprints.limitRollout), [...FOOTPRINT_ROLLOUT_MODES]);
    assert.match(messages.adminHelp.pages.footprints.sections.memberOverride.guidance,
      new RegExp(messages.footprints.settingsTitle));
  }
});

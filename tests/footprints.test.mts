import test from "node:test";
import assert from "node:assert/strict";
import {
  footprintReports,
  footprintsAdminPayload,
} from "../lib/footprints.ts";

const GROUP_ID = "111111111111111111111111";
const BADGE_ID = "222222222222222222222222";
const REPORT_ID = "333333333333333333333333";
const EVENT_ID = "444444444444444444444444";

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

const OPEN_REPORTS = {
  // The shared Webadmin envelope owns `status` and rewrites it to 200.  Core
  // therefore carries the selected report tab in an unambiguous field.
  status: 200,
  report_status: "open",
  reports: [{
    id: REPORT_ID,
    footprint_id: EVENT_ID,
    reporter: { id: 42, displayname: { value: "Reporter" }, avatar: "" },
    sender: { id: 84, displayname: "Sender", avatar: "avatar.jpg" },
    badge: {
      labels: { en: "Very hot!", hu: "Nagyon dögös!" },
      image_url: "https://pic.example.test/badge.png",
    },
    message: "Hello",
    created_at: 1_786_300_000,
    status: "open",
    resolved_by: "",
  }],
};

test("report parser binds the response to the requested tab", () => {
  const parsed = footprintReports(OPEN_REPORTS, "open");
  assert.ok(parsed);
  assert.equal(parsed[0]?.reporter?.name, "Reporter");
  assert.equal(footprintReports(OPEN_REPORTS, "resolved"), null);
});

test("an empty report page survives the real legacy response envelope", () => {
  assert.deepEqual(footprintReports({
    success: true,
    status_code: 200,
    status: 200,
    report_status: "open",
    reports: [],
    message: 200,
    can_send: 0,
  }, "open"), []);
  assert.equal(footprintReports({
    status: 200,
    report_status: "resolved",
    reports: [],
  }, "open"), null);
});

test("report parser rejects a partial row instead of silently dropping it", () => {
  assert.equal(footprintReports({ ...OPEN_REPORTS, reports: [{}] }, "open"), null);
  assert.equal(footprintReports({
    ...OPEN_REPORTS,
    reports: [{ ...OPEN_REPORTS.reports[0], created_at: "yesterday" }],
  }, "open"), null);
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

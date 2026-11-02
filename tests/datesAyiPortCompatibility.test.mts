import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { operationalRecordSummary } from "../lib/auditLog.ts";
import {
  datesActivityConflict, datesCaseClaimableByRole, datesCaseInternalNotes, datesExternalReviewAllowed, permittedResolutionActions,
  type DatesAdminPrincipal, type DatesCaseSummary,
} from "../lib/datesAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesCaseResolutionEffect, datesCaseResolutionReceipt } from "../lib/datesCommandReceipts.ts";
import { datesCommandOutcome, projectDatesActivityOriginDetail } from "../lib/datesExternalAdmin.ts";
import { datesMemberships } from "../lib/datesMemberships.ts";
import { datesCaseDetail, datesLegalHoldAllowed, datesLegalHoldCommandReceipt, datesModerationQueue } from "../lib/datesModerationRead.ts";

// The AreYouIn port of Core (branch claude/freelove-port2-20261102-core-ayi, tip b50e9423, on live Core e311d69d).
// Webadmin deploys first and Core follows, so the console reads BOTH shapes. This file holds it to both, on genuine bodies:
//
// - LIVE: tests/fixtures/dates_ayi_live_e311d69d - the 16 bodies the port moved, as the live Core serves them: byte
//   copies of what this console had vendored (Webadmin 7515a72), byte-identical to the same files at Core e311d69d
//   (git objects; `git -C <core> show e311d69d:tests/fixtures/<corpus>/<file> | cmp - <file>`). Pinned below.
// - NEW: the same files in the six re-vendored corpora (pinned by their own tests), byte copies of Core b50e9423.
//
// For each body the difference is proven from bytes, and both shapes are read the way the browser receives them:
// through the bridge's projection, then the page's own decoder. What no genuine body holds is DERIVED from a genuine
// body, with the change Core's code makes, and marked so.
const LIVE = new URL("./fixtures/dates_ayi_live_e311d69d/", import.meta.url);
const NEW = new URL("./fixtures/", import.meta.url);
const LIVE_PIN: Record<string, string> = {
  "dates_admin_command_wire/admin-hold-selected-amended.json": "3af14e3b5f44a484c1a81bf971ac9d4f098d597d0272440e02bd62c43b5a2f7c",
  "dates_admin_command_wire/admin-hold-selected-placed.json": "793f9e4d54b5f308aec0f689b00f21267f08c7e8014f42e48790c18c088b7165",
  "dates_admin_command_wire/admin-hold-selected-unchanged.json": "a6989918ee71cd0f84c50b8097de8e48f77cfebb4a9881dfa0bd0763db1cb275",
  "dates_event_intake_admin_wire/admin-activity-detail-ai-assisted.json": "cc0b89c299cda17fcf19f0c8999acbd0ba86ff33263c7941d007b92f0bf8adf3",
  "dates_external_admin_wire/admin-activity-detail-external.json": "0b500a843cae67a2d5adcfb1f77aa65414bee556fd1173478d9c663471d73550",
  "dates_host_moderation_admin_wire/admin-activity-detail-memberships.json": "515c18add49cc10fb5ea929fd3fd9f0f4aade3a768a5500d81354fbb8e023613",
  "dates_host_moderation_admin_wire/admin-activity-detail.json": "e4dc5e99bf44ae0dc5681d44902978d5fcee744f51544ac8255fba437666df4c",
  "dates_moderation_console_wire/admin-queue-breached.json": "52c3463f9b4dfa329ad133a032640852815a12b8378e218d9c6da3f5719d9870",
  "dates_moderation_console_wire/admin-queue-mine.json": "4fc904467af81caf690a40b4a4db0133035eaab26bf19bd1f0dacb13592bee78",
  "dates_moderation_console_wire/admin-queue-page-one.json": "837542bb69c32656f8b063c73beb5e84c0e192a0701170800adc237c38999641",
  "dates_moderation_console_wire/admin-queue-page-two.json": "68dbf6c32520e0b18ae2fd91e52d96fd91857379df84253bce26bd6258f75c6e",
  "dates_moderation_console_wire/admin-queue-search.json": "33c24ef57942507fcdf113be21c52546c71f3919e8420957988e7f0de048127d",
  "dates_moderation_console_wire/admin-queue-unassigned.json": "da8ba9f468c59929a22cf55d710d4b0ad78f398eb8433ab6eee153e1fd521a68",
  "dates_moderation_console_wire/admin-queue-unknown-role.json": "fb11747dcfde14dbb0c8a12ddc8eda399b30cf75934faa94c0de4a2930007dbb",
  "dates_moderation_wire/admin-detail-appeal-viewer.json": "1c2d951baabc57bd7b523bec3419cc0f4e26d589951d07fac4d6ba41997dd862",
  "dates_moderation_wire/admin-detail-report-viewer.json": "397cd984a3f336479289ed541c2975e4191a22143986aa174dba5e64db4f866e",
};
const NOW = 1790000000;
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const text = (root: URL, file: string) => readFileSync(new URL(file, root), "utf8");
const live = (file: string) => JSON.parse(text(LIVE, file));
const current = (file: string) => JSON.parse(text(NEW, file));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
/** What the browser receives: the bridge's projection. Nothing of a genuine or derived body here is on the deny-list. */
const sent = (route: string, body: unknown) => projectDatesAdminBody(route, body, (line) => assert.fail(line)) as any;

const QUEUES = ["breached", "mine", "page-one", "page-two", "search", "unassigned", "unknown-role"].map((name) => `dates_moderation_console_wire/admin-queue-${name}.json`);
const DETAILS = ["appeal", "report"].map((name) => `dates_moderation_wire/admin-detail-${name}-viewer.json`);
const HOLDS = ["placed", "unchanged", "amended"].map((name) => `dates_admin_command_wire/admin-hold-selected-${name}.json`);
const ACTIVITIES = ["dates_event_intake_admin_wire/admin-activity-detail-ai-assisted.json", "dates_external_admin_wire/admin-activity-detail-external.json",
  "dates_host_moderation_admin_wire/admin-activity-detail.json"];
const EXCERPT = "dates_host_moderation_admin_wire/admin-activity-detail-memberships.json";

// Core's principals of the two captures (tests/dates_moderation_console_fixture_dump.php, tests/dates_moderation_fixture_dump.php:
// `viewer` is a support viewer - so is the `unknown` role - and `moderator` a moderator) and their capabilities
// (DatesAdminAuthorizationService::capabilities).
const BASE = ["dates_activity_read", "dates_case_read", "dates_reason_read", "dates_sla_read", "dates_audit_read", "dates_configuration_read", "dates_external_event_read"];
const MODERATOR = [...BASE, "dates_case_claim", "dates_case_resolve", "dates_evidence_read", "dates_case_note", "dates_external_event_review"];
const SENIOR = [...MODERATOR, "dates_appeal_resolve", "dates_restrict_user", "dates_legal_hold", "dates_trail_evidence_capture"];
const principal = (email: string, role: DatesAdminPrincipal["role"], capabilities: string[]): DatesAdminPrincipal =>
  ({ email, role, rank: { support_viewer: 10, moderator: 20, senior_moderator: 30, administrator: 40, superadmin: 50 }[role], linked_uid: null,
    sensitive_location: role !== "support_viewer" && role !== "moderator", break_glass: role !== "support_viewer" && role !== "moderator", capabilities });
const VIEWER = principal("viewer@example.invalid", "support_viewer", BASE);
const CAPTURED_BY: Record<string, DatesAdminPrincipal> = { "dates_moderation_console_wire/admin-queue-mine.json": principal("moderator@example.invalid", "moderator", MODERATOR) };

/**
 * What the case page offers on a case, by the page's own expressions (app/(dashboard)/dates/moderation/[caseId]/page.tsx,
 * held to its source below): claim, evidence, a decision, break-glass and a legal hold.
 */
function offers(item: DatesCaseSummary, who: DatesAdminPrincipal) {
  const assignedToMe = item.assignee_email?.toLowerCase() === who.email.toLowerCase();
  const leaseActive = (item.claim_expires_at || 0) > NOW;
  const canBreakGlass = item.capabilities.can_break_glass && who.break_glass;
  const actions = permittedResolutionActions(item, who);
  return {
    claim: datesCaseClaimableByRole(item, who) && (item.capabilities.can_claim || (item.conflict_of_interest && canBreakGlass)),
    evidence: datesExternalReviewAllowed(item, who) && (item.capabilities.can_read_evidence || (item.conflict_of_interest && canBreakGlass)),
    resolve: actions.length > 0 && (item.capabilities.can_resolve || (item.conflict_of_interest && canBreakGlass && assignedToMe && leaseActive)),
    breakGlass: canBreakGlass,
    hold: datesLegalHoldAllowed(item, who, "place", false),
  };
}

test("the live bodies are the 16 the port moved, byte for byte as live Core serves them, each pinned", () => {
  const found = readdirSync(LIVE).flatMap((corpus) => readdirSync(new URL(`${corpus}/`, LIVE)).map((file) => `${corpus}/${file}`)).sort();
  assert.deepEqual(found, Object.keys(LIVE_PIN).sort());
  for (const [file, digest] of Object.entries(LIVE_PIN)) {
    assert.equal(sha256(readFileSync(new URL(file, LIVE))), digest, file);
    // ... and each differs from what Core b50e9423 serves in its place (that body is pinned by its corpus's own test).
    assert.notEqual(sha256(readFileSync(new URL(file, NEW))), digest, file);
  }
  assert.equal(found.length, QUEUES.length + DETAILS.length + HOLDS.length + ACTIVITIES.length + 1);
});

test("what moved, from bytes: capability values that only go from true to false, three appended keys, and the activity page's projection", () => {
  // Nine case bodies: the same lines but capability VALUES, each true -> false. No key added or removed; Core offers
  // less, never more (a support viewer is not offered a claim, a moderator not an appeal).
  let flips = 0;
  for (const file of [...QUEUES, ...DETAILS]) {
    const before = text(LIVE, file).split("\n"), after = text(NEW, file).split("\n");
    assert.equal(before.length, after.length, file);
    const changed = before.flatMap((line, index) => line === after[index] ? [] : [[line, after[index]]]);
    assert.ok(changed.length > 0, file);
    for (const [was, now] of changed) {
      assert.match(was, /^\s*"can_(claim|read_evidence|resolve|break_glass)": true,?$/, file);
      assert.equal(now, was.replace(": true", ": false"), file);
    }
    flips += changed.length;
  }
  assert.equal(flips, 16);
  // Three place receipts gained one line, `media_unavailable: []`; two activity details two lines, the conflict booleans.
  for (const [files, lines] of [[HOLDS, ['"media_unavailable": [],']], [ACTIVITIES.slice(0, 2), ['"conflict_of_interest": false,', '"audit_reasons_withheld": false,']]] as const) {
    for (const file of files) {
      const after = text(NEW, file).split("\n");
      assert.deepEqual(after.filter((line) => (lines as readonly string[]).includes(line.trim())).map((line) => line.trim()), [...lines], file);
      assert.equal(after.filter((line) => !(lines as readonly string[]).includes(line.trim())).join("\n"), text(LIVE, file), file);
    }
  }
  // The whole event page: the two booleans appended; every other part the same but the membership rows (Core's allow-list
  // now: the same values, without the stored row's other fields) and the decisions (the case read's metadata of the same rows).
  const before = live(ACTIVITIES[2]), after = current(ACTIVITIES[2]);
  assert.deepEqual(Object.keys(after).filter((key) => !Object.hasOwn(before, key)), ["conflict_of_interest", "audit_reasons_withheld"]);
  assert.deepEqual([after.conflict_of_interest, after.audit_reasons_withheld], [false, false]);
  assert.deepEqual(Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])), ["memberships", "moderation_decisions"]);
  const ALLOW = ["uid", "relationship", "relationship_archive_state", "live_access", "invited_at", "requested_at", "joined_at", "left_at", "removed_at", "declined_at",
    "withdrawn_at", "invalidated_at", "released_at", "created_at", "updated_at", "released_reason", "removed_by_uid", "removed_reason", "removal_note", "ban"];
  const SELECTOR_ONLY = ["removed_by_uid", "removed_reason", "removal_note", "ban"];
  const rows = (was: Record<string, unknown>[], now: Record<string, unknown>[], keys: string[], label: string) => {
    assert.deepEqual(now.map((row) => row.uid), was.map((row) => row.uid), label);
    now.forEach((row, index) => {
      assert.deepEqual(Object.keys(row), keys, `${label} ${row.uid}`);
      // A value both shapes carry is the same value; a key only the new shape names is null (the row has none).
      for (const key of keys) assert.deepEqual(row[key], Object.hasOwn(was[index], key) ? was[index][key] : null, `${label} ${row.uid}: ${key}`);
    });
  };
  // (Without the selector Core no longer names who removed a member or why: those two values are gone, not nulled.)
  const released = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !["removed_by_uid", "removed_reason"].includes(key)));
  rows(before.memberships, after.memberships, ALLOW, "page");
  const excerptBefore = live(EXCERPT), excerptAfter = current(EXCERPT);
  rows(excerptBefore.with_contract, excerptAfter.with_contract, ALLOW, "with the selector");
  rows(excerptBefore.released.map(released), excerptAfter.released, ALLOW.filter((key) => !SELECTOR_ONLY.includes(key)), "without the selector");
  const DECISION = ["decision_id", "case_id", "target_type", "target_id", "activity_id", "target_path", "action", "severity", "user_visible_reason", "created_at",
    "expires_at", "appeal_outcome", "appeal_resolved_at"];
  assert.equal(after.moderation_decisions.length, before.moderation_decisions.length);
  after.moderation_decisions.forEach((row: Record<string, unknown>, index: number) => {
    assert.deepEqual(Object.keys(row), DECISION);
    for (const key of DECISION) assert.deepEqual(row[key], before.moderation_decisions[index][key] ?? null, key);
  });
});

test("cases, both shapes: every row decodes, and the case page offers the same actions to the principal of the capture", () => {
  const page = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  // The mirror above is the page's own gating, expression for expression.
  for (const expression of ["const canBreakGlass = item.capabilities.can_break_glass && principal.break_glass;",
    "const mayClaim = datesCaseClaimableByRole(item, principal) && (item.capabilities.can_claim || (item.conflict_of_interest && canBreakGlass));",
    "const mayReadEvidence = datesExternalReviewAllowed(item, principal) && (item.capabilities.can_read_evidence || (item.conflict_of_interest && canBreakGlass));",
    "const mayResolve = actions.length > 0 && (item.capabilities.can_resolve || (item.conflict_of_interest && canBreakGlass && assignedToMe && leaseActive));",
    "const leaseActive = (item.claim_expires_at || 0) > Math.floor(Date.now() / 1000);"]) assert.ok(page.includes(expression), expression);
  for (const file of QUEUES) {
    const was = live(file), now = current(file), who = CAPTURED_BY[file] ?? VIEWER;
    const before = datesModerationQueue(sent("dates_moderation_queue", was), { page: was.page, limit: was.limit });
    const after = datesModerationQueue(sent("dates_moderation_queue", now), { page: now.page, limit: now.limit });
    assert.ok(before && after, file);
    assert.deepEqual(after.cases.map(({ capabilities: _c, ...row }) => row), before.cases.map(({ capabilities: _c, ...row }) => row), file);
    after.cases.forEach((row, index) => assert.deepEqual(offers(row, who), offers(before.cases[index], who), `${file} ${row.case_id}`));
  }
  for (const file of DETAILS) {
    const was = live(file), now = current(file);
    const before = datesCaseDetail(sent("dates_moderation_detail", was), was.case.case_id), after = datesCaseDetail(sent("dates_moderation_detail", now), now.case.case_id);
    assert.ok(before && after, file);
    assert.deepEqual({ ...after, case: { ...after.case, capabilities: null } }, { ...before, case: { ...before.case, capabilities: null } }, file);
    assert.deepEqual(offers(after.case, VIEWER), offers(before.case, VIEWER), file);
    assert.deepEqual(datesCaseInternalNotes(now), datesCaseInternalNotes(was), file);
  }
  // The flags matter where the console's role gate does not already decide: a moderator on the appeal of `mine` is offered
  // neither a claim nor a decision with either shape, because the console never offered an appeal to a moderator.
  const mine = current(QUEUES[1]).cases[0];
  assert.deepEqual([mine.queue, mine.capabilities.can_claim, mine.capabilities.can_resolve, live(QUEUES[1]).cases[0].capabilities.can_resolve], ["appeals", false, false, true]);
  assert.deepEqual(offers(mine, CAPTURED_BY[QUEUES[1]]), { claim: false, evidence: true, resolve: false, breakGlass: false, hold: false });
});

test("the moderator of an appealed decision: notes withheld with or without the conflict flag, nothing offered; anything else withheld is refused", () => {
  // DERIVED from Core's genuine appeal detail (b50e9423) as Core serves it to the moderator whose decision is appealed
  // (DatesModerationReadService::detail, `$notesWithheld`): every flag false, notes withheld and empty. The branch tip
  // b50e9423 serves `conflict_of_interest: false` beside them; its review fix serves `true`. Both are read; so is the
  // live shape (the genuine bodies above).
  const genuine = current(DETAILS[0]);
  assert.deepEqual(genuine.case.capabilities, { can_claim: false, can_read_evidence: false, can_resolve: false, can_break_glass: false });
  const withheld = { ...copy(genuine), report_notes_withheld: true, internal_notes: [], internal_notes_withheld: true };
  const fixed = { ...copy(withheld), case: { ...copy(withheld.case), conflict_of_interest: true } };
  const senior = principal("senior@example.invalid", "senior_moderator", SENIOR);
  for (const [name, body] of [["b50e9423", withheld], ["review fix", fixed]] as const) {
    const read = datesCaseDetail(sent("dates_moderation_detail", body), body.case.case_id);
    assert.ok(read, name); assert.equal(read.report_notes_withheld, true, name);
    assert.deepEqual(datesCaseInternalNotes(body), { status: "withheld" }, name);
    // Even a senior moderator with break-glass is offered nothing: Core refuses that moderator every command.
    const offered = offers(read.case, senior);
    assert.deepEqual({ ...offered, hold: undefined }, { claim: false, evidence: false, resolve: false, breakGlass: false, hold: undefined }, name);
  }
  // With the conflict flag the page's own gate closes the hold as well (no break-glass for that moderator).
  assert.equal(offers(datesCaseDetail(fixed, fixed.case.case_id)!.case, senior).hold, false);
  // Withheld without a conflict is Core's only on an appeal whose flags are all false. Anything else is refused.
  const report = current(DETAILS[1]);
  for (const [name, body] of [
    ["a flag offered", { ...copy(withheld), case: { ...copy(withheld.case), capabilities: { ...withheld.case.capabilities, can_read_evidence: true } } }],
    ["break-glass offered", { ...copy(withheld), case: { ...copy(withheld.case), capabilities: { ...withheld.case.capabilities, can_break_glass: true } } }],
    ["a report case", { ...copy(report), report_notes_withheld: true, internal_notes: [], internal_notes_withheld: true, reports: report.reports.map((row: any) => ({ ...row, note: null })) }],
    ["only one of the two withheld", { ...copy(withheld), internal_notes_withheld: false }],
    ["notes shown while withheld", { ...copy(withheld), internal_notes: genuine.internal_notes }],
    ["a conflict that withholds nothing", { ...copy(genuine), case: { ...copy(genuine.case), conflict_of_interest: true } }],
  ] as const) assert.equal(datesCaseDetail(sent("dates_moderation_detail", body), body.case.case_id), null, name);
});

test("the activity page, both shapes: the same activity, members and history, and the conflict said only where Core says it", () => {
  const CAPS = ["dates_external_event_read", "dates_external_event_manage"];
  for (const file of ACTIVITIES) {
    const was = sent("dates_activity_detail", live(file)), now = sent("dates_activity_detail", current(file)), id = was.activity.activity_id;
    // The projection passes the two booleans; the live page has neither, and the page says nothing then.
    assert.deepEqual([now.conflict_of_interest, now.audit_reasons_withheld], [false, false], file);
    assert.equal(Object.hasOwn(was, "conflict_of_interest") || Object.hasOwn(was, "audit_reasons_withheld"), false, file);
    assert.deepEqual(datesActivityConflict(was), { status: "unsupported" }, file);
    assert.deepEqual(datesActivityConflict(now), { status: "ready", conflict: false, audit_reasons_withheld: false }, file);
    const before = projectDatesActivityOriginDetail(was, id, CAPS), after = projectDatesActivityOriginDetail(now, id, CAPS);
    assert.ok(before && after, file); assert.deepEqual(after, before, file);
    assert.deepEqual(datesMemberships(now.memberships), datesMemberships(was.memberships), file);
    // The history panels show the same pairs; a decision now withholds one field less (Core no longer serves it).
    for (const panel of ["reports", "notifications", "moderation_decisions", "audit_history"])
      assert.deepEqual(now[panel].map((row: unknown) => operationalRecordSummary(row).shown), was[panel].map((row: unknown) => operationalRecordSummary(row).shown), `${file} ${panel}`);
  }
  // The membership excerpt of another event, both ways: with the selector the rows read the same; without it a removal
  // is still a removal, with its time, and nobody is named.
  const excerptBefore = live(EXCERPT), excerptAfter = current(EXCERPT), host = current(ACTIVITIES[2]);
  const read = (rows: unknown) => datesMemberships(sent("dates_activity_detail", { ...host, memberships: rows }).memberships);
  assert.deepEqual(read(excerptAfter.with_contract), read(excerptBefore.with_contract));
  const releasedBefore = read(excerptBefore.released), releasedAfter = read(excerptAfter.released);
  assert.deepEqual(releasedAfter.rows.map((row) => [row.uid, row.standing?.state ?? null, row.standing?.state === "removed" ? row.standing.at : null]),
    releasedBefore.rows.map((row) => [row.uid, row.standing?.state ?? null, row.standing?.state === "removed" ? row.standing.at : null]));
  assert.ok(releasedAfter.rows.every((row) => row.standing === null || (row.standing.state === "removed" && row.standing.by.kind === "unknown")));

  // DERIVED: the page of an operator with a conflict of interest (DatesAdminActivityService::detail): both booleans true,
  // an audit row without its reason, and a notification whose recipient is not named.
  const conflicted = { ...copy(host), conflict_of_interest: true, audit_reasons_withheld: true,
    audit_history: [{ audit_id: "aud_" + "7".repeat(32), action: "dates.activity.update", actor_email: "admin@example.invalid", actor_role: "administrator",
      target_type: "activity", target_id: host.activity.activity_id, reason: null, sensitive_read: false, created_at: NOW }],
    notifications: [{ notification_id: "ntf_" + "8".repeat(32), event_type: "dates.report.resolved", uid: null, recipient_identity_redacted: true,
      copy_key: "dates_report_resolved", read: false, created_at: NOW }] };
  const page = sent("dates_activity_detail", conflicted);
  assert.deepEqual(datesActivityConflict(page), { status: "ready", conflict: true, audit_reasons_withheld: true });
  assert.deepEqual(page.notifications, [{ notification_id: conflicted.notifications[0].notification_id, recipient_identity_redacted: true, created_at: NOW, withheld_fields: 4 }]);
  assert.ok(operationalRecordSummary(page.notifications[0]).shown.some((pair) => pair.key === "recipient_identity_redacted" && pair.value === "true"));
  // The audit row: its safe keys; the actor's address, the target and the (withheld) reason are counted, not sent.
  assert.deepEqual(page.audit_history, [{ audit_id: conflicted.audit_history[0].audit_id, action: "dates.activity.update", actor_role: "administrator",
    target_type: "activity", sensitive_read: false, created_at: NOW, withheld_fields: 3 }]);
  assert.doesNotMatch(JSON.stringify(page), /admin@example\.invalid|"uid":null|copy_key/);
  // Served and not two booleans: said to be unreadable, never "no conflict".
  for (const change of [{ conflict_of_interest: "true" }, { audit_reasons_withheld: null }, { conflict_of_interest: 1, audit_reasons_withheld: 1 }])
    assert.deepEqual(datesActivityConflict({ ...host, ...change }), { status: "invalid" }, JSON.stringify(change));
  const { audit_reasons_withheld: _withheld, ...half } = host;
  assert.deepEqual(datesActivityConflict(half), { status: "invalid" }, "one of the two without the other");
  for (const value of [null, [], "x"]) assert.deepEqual(datesActivityConflict(value), { status: "invalid" });
  // The page says it: the conflict at the top, an unreadable answer as such, the withheld reasons in the history section.
  const source = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const conflict = datesActivityConflict\(data\);/);
  assert.match(source, /\{conflict\.status === "ready" && conflict\.conflict && <div className="alert alert-warning page-alert"><strong>\{t\("conflictTitle"\)\}<\/strong> \{t\("conflictCopy"\)\}<\/div>\}/);
  assert.match(source, /\{conflict\.status === "invalid" && <div className="alert alert-error page-alert" role="status">\{t\("conflictUnreadable"\)\}<\/div>\}/);
  assert.match(source, /\{conflict\.status === "ready" && conflict\.audit_reasons_withheld && <p className="alert alert-warning">\{t\("auditReasonsWithheld"\)\}<\/p>\}/);
});

test("legal hold and resolution receipts, both shapes: the browser receives what the page words", () => {
  // Core's genuine place receipts of case 2 (generator lines 405-417), live and new.
  const request = (reviewAt: number, expected: number) => ({ case_id: `cas_${"2".padStart(32, "0")}`, action: "place", reason: "Synthetic.", legal_basis: "Synthetic.",
    break_glass: false, review_at: reviewAt, expected_revision: expected });
  for (const [file, reviewAt, expected] of [[HOLDS[0], 1790086400, 1], [HOLDS[1], 1790086400, 2], [HOLDS[2], 1790172800, 2]] as const) {
    const was = sent("dates_moderation_legal_hold", live(file)), now = sent("dates_moderation_legal_hold", current(file));
    assert.deepEqual(now, current(file), file); assert.deepEqual(was, live(file), file);
    const before = datesLegalHoldCommandReceipt(was, request(reviewAt, expected)), after = datesLegalHoldCommandReceipt(now, request(reviewAt, expected));
    assert.ok(before && after, file);
    assert.deepEqual({ ...after, media_unavailable: null }, before, file);
    assert.deepEqual([before.media_unavailable, after.media_unavailable], [null, []], file);
  }
  // A Core before b50e9423 refused a hold over media it had begun to delete (409); the page still words it as a refusal.
  const purge = { success: false, status_code: 409, error: "dates-legal-hold-media-purge-started", message: 200, status: 200, can_send: 0 };
  assert.deepEqual(sent("dates_moderation_legal_hold", purge), purge);
  assert.deepEqual(datesCommandOutcome(purge, false, "fresh"), { kind: "refused", error: "dates-legal-hold-media-purge-started" });
  // Core b50e9423's refusal of an approval whose host cannot publish reaches the page as Core's six keys, a refusal.
  const host = { ...purge, error: "dates-moderation-host-unavailable" };
  assert.deepEqual(sent("dates_moderation_resolve", host), host);
  assert.deepEqual(datesCommandOutcome(host, false, "fresh"), { kind: "refused", error: "dates-moderation-host-unavailable" });
  // DERIVED from Core's genuine dismissal (command corpus, case 4 at revision 2) with the target result of a withdrawal:
  // every key of it reaches the browser, and the page's reader says what happened.
  const genuine = JSON.parse(readFileSync(new URL("./fixtures/dates_admin_command_wire/admin-resolve-dismiss.json", import.meta.url), "utf8"));
  const replacement = { ...genuine, target_result: { ...genuine.target_result, target_path: "pending_public_revision",
    before: { pending_revision: 3, moderation_state: "pending" }, after: { pending_public_revision: null, withdrawn: "host_unavailable" } } };
  const draft = { ...genuine, target_result: { ...genuine.target_result, after: { withdrawn: "host_unavailable" } } };
  const dismissal = { case_id: genuine.case_id, expected_revision: 2, action: "dismiss" };
  for (const [body, effect] of [[genuine, null], [replacement, "replacement_withdrawn"], [draft, "draft_kept"]] as const) {
    const received = sent("dates_moderation_resolve", body);
    assert.deepEqual(received, body); assert.equal(datesCaseResolutionReceipt(received, dismissal), true); assert.equal(datesCaseResolutionEffect(received), effect);
  }
});

test("EN and HU copy of the port: every key in both languages, in their own words", () => {
  const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin;
  const en = messages("en"), hu = messages("hu");
  const CASE = ["hostUnavailableRefused", "hostUnavailableCopy", "withdrawSubmission", "submissionWithdrawn", "submissionDraftKept", "restorationSkippedHostUnavailable",
    "legalHoldMediaUnavailable", "holdMediaPhoto", "holdMediaPhotoUnnamed", "holdMediaActivityPhotos", "legalHoldMediaPurgeStarted"];
  for (const key of CASE) {
    assert.equal(typeof en.caseDetail[key], "string", key); assert.equal(typeof hu.caseDetail[key], "string", key); assert.notEqual(en.caseDetail[key], hu.caseDetail[key], key);
  }
  for (const state of ["deleting", "completed"]) assert.notEqual(en.caseDetail.holdMediaStates[state], hu.caseDetail.holdMediaStates[state]);
  for (const key of ["conflictTitle", "conflictCopy", "conflictUnreadable", "auditReasonsWithheld"]) {
    assert.equal(typeof en.activityDetail[key], "string", key); assert.notEqual(en.activityDetail[key], hu.activityDetail[key], key);
  }
  // The placeholders are the same in both languages.
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of ["legalHoldMediaUnavailable", "holdMediaPhoto", "holdMediaPhotoUnnamed", "holdMediaActivityPhotos"])
    assert.deepEqual(placeholders(hu.caseDetail[key]), placeholders(en.caseDetail[key]), key);
  // The withdrawal is offered under its own name, which names the Dismiss action in each language.
  assert.match(en.caseDetail.withdrawSubmission, /^Dismiss/); assert.match(hu.caseDetail.withdrawSubmission, /^Elutasítás/);
  const page = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{hostUnavailable && isDatesActivitySubmissionCase\(item\) && <p className="alert alert-warning">\{t\("hostUnavailableCopy"\)\}<\/p>\}/);
  assert.match(page, /\{actions\.map\(\(action\) => <option key=\{action\} value=\{action\}>\{resolutionLabel\(action\)\}<\/option>\)\}/);
  assert.match(page, /label: resolutionLabel\(resolutionAction\),/);
});

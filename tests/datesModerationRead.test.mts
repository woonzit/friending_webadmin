import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesCaseHistory from "../components/DatesCaseHistory.tsx";
import { DatesCaseReadFence, datesCaseDetail, datesEvidenceRead, datesLegalHoldAllowed } from "../lib/datesModerationRead.ts";
import type { DatesAdminPrincipal } from "../lib/datesAdmin.ts";

// Byte-for-byte provider corpus from released Core tip 8fe14ecf8507ab20a7c9014063db276fc96c054b.
// Source commit names the generator/runtime inputs, not its mechanical capture commit.
const DIRECTORY = new URL("./fixtures/dates_moderation_wire/", import.meta.url);
// T-872: source-only manifest refresh to Core 8fe14ecf; bodies and generator unchanged.
const SOURCE = "9b32a516a7c10ef3b6b3072a9e45bd2cac409f23";
const MANIFEST_SHA = "26cdfea5c282672e559305601ca407fa0d7c01148331b07973e2729b6d2a067b";
const GENERATOR_SHA = "e212ec243b70589995a8d6c15c38873724f84d4fb9185f87be77cff2a5202354";
const SET_SHA = "f1a67c9a0c16b8c9f6e410e5ed4691351e01af8c10f87f387e06726ca768dd1e";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const report = fixture("admin-detail-report-viewer");
const appeal = fixture("admin-detail-appeal-viewer");

test("Dates moderation corpus is the complete provider-owned nine-response capture", () => {
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  const manifest = fixture("manifest");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  assert.equal(manifest.contract, "dates-moderation-read-v1");
  assert.equal(manifest.fixtures.length, 9);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), ["manifest.json", ...manifest.fixtures.map((entry: { file: string }) => entry.file)].sort());
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string; consumer: string; http_status: number }) => {
    assert.equal(entry.consumer, "webadmin");
    assert.equal(entry.http_status, 200, "logical refusals retain the Core HTTP envelope");
    assert.equal(hash(readFileSync(new URL(entry.file, DIRECTORY))), entry.sha256, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), SET_SHA);
});

for (const name of ["admin-detail-report-viewer", "admin-detail-report-conflicted", "admin-detail-appeal-viewer"]) {
  test(`${name}: populated provider metadata decodes without exposing private snapshots`, () => {
    const body = fixture(name);
    const decoded = datesCaseDetail(body, body.case.case_id);
    assert.ok(decoded);
    assert.equal(decoded.case.case_id, body.case.case_id);
    assert.doesNotMatch(JSON.stringify(decoded), /EVIDENCE_ONLY_|before|after|actor_email|appellant_uid/);
    if (name.endsWith("conflicted")) {
      assert.equal(decoded.report_notes_withheld, true);
      assert.equal(decoded.reports[0].note, null);
    } else if (name.includes("appeal")) {
      assert.equal(decoded.appeal?.appeal_id, body.appeal.appeal_id);
    } else {
      assert.equal(decoded.decisions.length, 1);
      assert.equal(decoded.reports[0].note, "Report context");
    }
  });
}

for (const name of ["admin-evidence-report-moderator", "admin-evidence-appeal-senior", "admin-evidence-report-break-glass"]) {
  test(`${name}: evidence is bound to case, appeal and explicitly requested access`, () => {
    const body = fixture(name);
    const scope = { case_id: body.case_id, appeal_id: body.appeal_note?.appeal_id ?? null,
      include_sensitive_location: name.endsWith("break-glass"), break_glass: name.endsWith("break-glass") };
    const decoded = datesEvidenceRead(body, scope);
    assert.ok(decoded);
    assert.equal(decoded.audit_id, body.audit_id);
    assert.deepEqual(decoded.appeal_note, body.appeal_note);
    assert.equal(decoded.evidence.length, body.evidence.length);
    assert.equal(datesEvidenceRead(body, { ...scope, case_id: "cas_ffffffffffffffffffffffffffffffff" }), null);
    if (scope.include_sensitive_location) {
      assert.equal(datesEvidenceRead(body, { ...scope, include_sensitive_location: false }), null);
      assert.equal(datesEvidenceRead(body, { ...scope, break_glass: false }), null);
    }
  });
}

for (const name of ["admin-evidence-viewer-denied", "admin-evidence-conflict-denied", "admin-evidence-original-moderator-denied"]) {
  test(`${name}: a real HTTP-200 logical refusal never decodes as an empty success`, () => {
    const body = fixture(name);
    assert.equal(body.status_code, 403);
    assert.equal(datesCaseDetail(body, report.case.case_id), null);
    assert.equal(datesEvidenceRead(body, { case_id: report.case.case_id, appeal_id: null, include_sensitive_location: false, break_glass: false }), null);
  });
}

test("detail refuses partial, loose, duplicate, cross-case and private metadata", () => {
  const corruptions = [
    (row: any) => { delete row.report_notes_withheld; },
    (row: any) => { row.report_notes_withheld = "false"; },
    (row: any) => { row.decisions[0].before = { photo: { url: "private.jpg" } }; },
    (row: any) => { row.decisions[0].actor_email = "private@example.invalid"; },
    (row: any) => { row.decisions[0].future_private_field = "private"; },
    (row: any) => { delete row.decisions[0].appeal_outcome; },
    (row: any) => { row.decisions[0].user_visible_reason.en = {}; },
    (row: any) => { row.decisions[0].created_at = 9_000_000_000_000; },
    (row: any) => { row.decisions.push(row.decisions[0]); },
    (row: any) => { row.reports.push(row.reports[0]); },
    (row: any) => { row.reports[0].reporter_identity_redacted = false; },
    (row: any) => { row.reports[0].reporter_uid = 123; },
    (row: any) => { row.case.capabilities.can_read_evidence = "true"; },
    (row: any) => { row.case.revision = "3"; },
    (row: any) => { row.decisions[0].case_id = "cas_ffffffffffffffffffffffffffffffff"; },
    (row: any) => { row.case.conflict_of_interest = true; },
    (row: any) => { row.success = false; },
  ];
  for (const corrupt of corruptions) {
    const body = structuredClone(report);
    corrupt(body);
    assert.equal(datesCaseDetail(body, report.case.case_id), null, corrupt.toString());
  }
  assert.equal(datesCaseDetail(report, "cas_ffffffffffffffffffffffffffffffff"), null);
  for (const key of ["note", "appellant_uid", "future_private_field"]) {
    const body = structuredClone(appeal);
    body.appeal[key] = "private";
    assert.equal(datesCaseDetail(body, appeal.case.case_id), null, key);
  }
  const conflict = fixture("admin-detail-report-conflicted");
  conflict.reports[0].note = "Previously loaded note";
  assert.equal(datesCaseDetail(conflict, conflict.case.case_id), null);
});

test("evidence refuses a missing audit, missing/foreign appeal, leaked location and malformed rows", () => {
  const source = fixture("admin-evidence-appeal-senior");
  const scope = { case_id: source.case_id, appeal_id: source.appeal_note.appeal_id, include_sensitive_location: false, break_glass: false };
  for (const corrupt of [
    (row: any) => { delete row.audit_id; },
    (row: any) => { row.audit_id = "unverified"; },
    (row: any) => { delete row.appeal_note; },
    (row: any) => { row.appeal_note = null; },
    (row: any) => { row.appeal_note.appeal_id = "apl_ffffffffffffffffffffffffffffffff"; },
    (row: any) => { row.appeal_note.appellant_uid = 123; },
    (row: any) => { row.appeal_note.note = "x".repeat(501); },
    (row: any) => { row.evidence.push(row.evidence[0]); },
    (row: any) => { row.evidence[0].case_id = report.case.case_id; },
    (row: any) => { row.evidence[0].sensitive_location = true; },
    (row: any) => { row.evidence[0].snapshot = null; },
    (row: any) => { row.redacted_sensitive_location_count = "1"; },
  ]) {
    const body = structuredClone(source);
    corrupt(body);
    assert.equal(datesEvidenceRead(body, scope), null, corrupt.toString());
  }
  assert.equal(datesEvidenceRead(source, { ...scope, appeal_id: null }), null);
  source.appeal_note.note = "😀".repeat(500);
  assert.ok(datesEvidenceRead(source, scope), "Core counts Unicode code points, not UTF-16 units");
  source.appeal_note.note = "\u00a0";
  assert.ok(datesEvidenceRead(source, scope), "do not apply JS trim to Core's retained text");
});

test("late replies cannot repopulate evidence after refresh, scope change or unmount", async () => {
  for (const boundary of ["refresh", "scope change", "unmount"]) {
    const fence = new DatesCaseReadFence();
    const ticket = fence.begin();
    let finish!: (value: string) => void;
    let visible: string | null = null;
    const pending = new Promise<string>((resolve) => { finish = resolve; }).then((value) => {
      if (fence.accepts(ticket)) visible = value;
    });
    fence.invalidate();
    finish("private stale response");
    await pending;
    assert.equal(visible, null, boundary);
    const old = fence.begin();
    const current = fence.begin();
    assert.equal(fence.accepts(old), false);
    assert.equal(fence.accepts(current), true);
  }
  const page = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<DatesModerationCase key=\{caseId\} caseId=\{caseId\}/);
  assert.match(page, /return \(\) => \{ readFence\.invalidate\(\); \+\+lifetime\.current;/);
  assert.equal((page.match(/if \(!readFence\.accepts\(ticket\)\)/g) ?? []).length, 6, "detail, external facts, evidence, ordinary mutation and both external decision boundaries check their generation");
  const evidenceFunction = page.slice(page.indexOf("async function readEvidence"), page.indexOf("async function addNote"));
  assert.ok(evidenceFunction.indexOf("setEvidence(null)") < evidenceFunction.indexOf("await adminCall"));
  assert.match(evidenceFunction, /datesEvidenceRead\(response, \{ case_id: caseId/);
  assert.doesNotMatch(page, /safeJson\(data\.appeal\)|safeJson\(decision\)|response as unknown as CaseDetail/);
});

test("legal hold respects closed cases, role, conflict and explicit break-glass consent", () => {
  const item = datesCaseDetail(report, report.case.case_id)!.case;
  const senior: DatesAdminPrincipal = { email: "senior@example.invalid", role: "senior_moderator", rank: 30,
    linked_uid: null, sensitive_location: true, break_glass: true, capabilities: ["dates_legal_hold"] };
  assert.equal(datesLegalHoldAllowed(item, senior, "place", false), true);
  for (const status of ["new", "in_review", "appealed", "unknown"]) {
    assert.equal(datesLegalHoldAllowed({ ...item, status }, senior, "release", true), false, status);
  }
  for (const status of ["actioned", "dismissed", "closed"]) {
    assert.equal(datesLegalHoldAllowed({ ...item, status }, senior, "release", false), true, status);
  }
  const conflict = { ...item, conflict_of_interest: true, capabilities: { ...item.capabilities, can_break_glass: true } };
  assert.equal(datesLegalHoldAllowed(conflict, senior, "place", false), false);
  assert.equal(datesLegalHoldAllowed(conflict, senior, "place", true), true);
  assert.equal(datesLegalHoldAllowed(conflict, { ...senior, break_glass: false }, "place", true), false);
  assert.equal(datesLegalHoldAllowed(item, { ...senior, capabilities: [] }, "place", true), false);
  assert.equal(datesLegalHoldAllowed(item, senior, "invented", false), false);
});

for (const locale of ["en", "hu"]) {
  test(`decision/appeal metadata renders named safe fields in ${locale}, never raw documents`, () => {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const detail = datesCaseDetail(report, report.case.case_id)!;
    const appealDetail = datesCaseDetail(appeal, appeal.case.case_id)!;
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" },
      createElement(DatesCaseHistory, { decisions: detail.decisions, appeal: appealDetail.appeal })));
    assert.ok(html.includes(messages.datesAdmin.caseDetail.actions.remove_photo));
    assert.ok(html.includes(messages.datesAdmin.caseDetail.originalDecision));
    assert.ok(html.includes(renderToStaticMarkup(createElement("p", null,
      messages.datesAdmin.caseDetail.appealNoteAuditedOnly)).slice(3, -4)));
    assert.ok(html.includes("Photo removed") && html.includes("Fénykép eltávolítva"));
    assert.doesNotMatch(html, /<pre|EVIDENCE_ONLY_|actor_email|appellant_uid|before|after/);
  });
}

for (const locale of ["en", "hu"] as const) {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.datesAdmin.caseDetail;
  const renderHistory = (status: string, resolution: string | null, outcome: string | null) => {
    // Synthetic populated variants of provider captures, with values written by
    // DatesModerationCommandService::resolveAppeal; the pinned bytes stay untouched.
    const reportWire = structuredClone(report);
    reportWire.decisions[0].appeal_outcome = outcome;
    reportWire.decisions[0].appeal_resolved_at = outcome === null ? null : 1_790_000_000;
    const appealWire = structuredClone(appeal);
    Object.assign(appealWire.appeal, {
      status, resolution, resolved_at: resolution === null ? null : 1_790_000_000,
      updated_at: 1_790_000_000,
    });
    const decisionDetail = datesCaseDetail(reportWire, reportWire.case.case_id);
    const appealDetail = datesCaseDetail(appealWire, appealWire.case.case_id);
    assert.ok(decisionDetail && appealDetail, "populated outcomes must pass the production decoder");
    return renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "UTC", onError: (error) => { throw error; },
    }, createElement(DatesCaseHistory, { decisions: decisionDetail.decisions, appeal: appealDetail.appeal })));
  };
  const assertRow = (html: string, title: string, value: string, count = 1) => {
    const row = renderToStaticMarkup(createElement("dt", null, title))
      + renderToStaticMarkup(createElement("dd", null, value));
    assert.equal(html.split(row).length - 1, count, `${title}: ${value}`);
  };

  for (const outcome of ["upheld", "overturned"] as const) {
    test(`resolved ${outcome} has explicit ${locale} copy in all three history fields`, () => {
      const expected = {
        en: { upheld: "Original decision upheld", overturned: "Original decision overturned" },
        hu: { upheld: "Az eredeti döntés helybenhagyva", overturned: "Az eredeti döntés visszavonva" },
      }[locale][outcome];
      const html = renderHistory(outcome, outcome, outcome);
      assertRow(html, copy.recordStatus, expected);
      assertRow(html, copy.appealOutcome, expected, 2);
      assert.doesNotMatch(html, />(?:upheld|overturned)</i, "no raw machine outcome in any field");
    });
  }

  test(`unresolved, unknown and action fallbacks stay intact in ${locale} history`, () => {
    const unresolved = renderHistory("new", null, null);
    assertRow(unresolved, copy.recordStatus, messages.datesAdmin.moderation.statuses.new);
    assertRow(unresolved, copy.appealOutcome, "—", 2);

    // Negative control: an unknown future value must not acquire a known outcome label.
    const unknown = renderHistory("future_status", "future_outcome", "future_outcome");
    assertRow(unknown, copy.recordStatus, "future status");
    assertRow(unknown, copy.appealOutcome, "future outcome", 2);
    for (const action of ["uphold", "overturn"] as const) {
      const legacy = renderHistory("new", action, null);
      assertRow(legacy, copy.appealOutcome, copy.actions[action]);
      assertRow(legacy, copy.appealOutcome, "—");
    }
  });
}

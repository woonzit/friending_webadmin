import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  auditDetailSummary,
  auditRows,
  AUDIT_DETAIL_SAFE_KEYS,
  AUDIT_DETAIL_VALUE_MAX,
} from "../lib/auditLog.ts";

const row = {
  id: "abc",
  actor_email: "operator@example.invalid",
  action: "profile.field.save",
  target: "profile_field:body_type",
  details: { key: "body_type", revision: 4, active: true },
  created_at: 1785950000,
};

test("a malformed audit payload is an error, never a partially rendered table", () => {
  assert.equal(auditRows([row])?.length, 1);
  assert.equal(auditRows(null), null);
  assert.equal(auditRows({}), null);
  assert.equal(auditRows([null]), null);
  assert.equal(auditRows([{ ...row, actor_email: 42 }]), null);
  assert.equal(auditRows([{ ...row, action: undefined }]), null);
  assert.equal(auditRows([{ ...row, created_at: "yesterday" }]), null);
  // One unreadable row invalidates the page rather than silently disappearing from it.
  assert.equal(auditRows([row, { id: "x" }]), null);
});

test("tolerated shapes are normalised rather than rejected", () => {
  // Core types `details` as a free-form array, so its absence is normal.
  assert.deepEqual(auditRows([{ ...row, details: undefined }])?.[0]?.details, {});
  assert.deepEqual(auditRows([{ ...row, details: ["not", "an", "object"] }])?.[0]?.details, {});
  assert.equal(auditRows([{ ...row, target: null }])?.[0]?.target, "");
  // A numeric id is stringified rather than refused; Mongo ids arrive both ways.
  assert.equal(auditRows([{ ...row, id: 17 }])?.[0]?.id, "17");
});

test("the photo-likes feature-switch target remains visible in its audit row", async () => {
  const target = "feature_switches:v1:likes";
  const parsed = auditRows([{
    ...row,
    action: "feature_switches_set",
    target,
  }]);
  assert.equal(parsed?.[0]?.target, target);

  const page = await readFile(new URL("../app/(dashboard)/audit/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<td>\{row\.target \|\| "—"\}<\/td>/u);
});

test("only allow-listed keys are rendered and everything else is counted, not shown", () => {
  const summary = auditDetailSummary({
    key: "body_type",
    revision: 3,
    before: { answers: ["a private answer"] },
    after: { answers: ["another private answer"] },
    member_answer: "something sensitive",
  });
  assert.deepEqual(summary.shown, [{ key: "key", value: "body_type" }, { key: "revision", value: "3" }]);
  assert.equal(summary.withheld, 3);

  // The withheld values must not appear anywhere in the rendered output.
  const rendered = JSON.stringify(summary);
  for (const secret of ["a private answer", "another private answer", "something sensitive"]) {
    assert.ok(!rendered.includes(secret), `${secret} leaked`);
  }
  // Nor may the withheld key names, which are themselves a hint about what was stored.
  for (const key of ["before", "after", "member_answer"]) {
    assert.ok(!rendered.includes(key), `${key} leaked`);
  }
});

test("a nested value is withheld even under an allow-listed key", () => {
  // `reason` is allow-listed as a string. An object under the same key is not the same thing.
  const summary = auditDetailSummary({ reason: { text: "sensitive" }, revision: 1 });
  assert.deepEqual(summary.shown, [{ key: "revision", value: "1" }]);
  assert.equal(summary.withheld, 1);
  assert.ok(!JSON.stringify(summary).includes("sensitive"));

  const arrayUnderSafeKey = auditDetailSummary({ key: ["a", "b"] });
  assert.deepEqual(arrayUnderSafeKey.shown, []);
  assert.equal(arrayUnderSafeKey.withheld, 1);
});

test("long values are truncated and empty ones are treated as withheld", () => {
  const long = auditDetailSummary({ reason: "x".repeat(500) });
  assert.equal(long.shown.length, 1);
  assert.equal(long.shown[0]?.value.length, AUDIT_DETAIL_VALUE_MAX + 1, "truncated plus the ellipsis");
  assert.ok(long.shown[0]?.value.endsWith("…"));

  assert.deepEqual(auditDetailSummary({ reason: "   " }), { shown: [], withheld: 1 });
  assert.deepEqual(auditDetailSummary({ revision: Number.NaN }), { shown: [], withheld: 1 });
  assert.deepEqual(auditDetailSummary(null), { shown: [], withheld: 0 });
  assert.deepEqual(auditDetailSummary("a string"), { shown: [], withheld: 0 });
});

test("booleans render as words so a false flag is visibly false, not blank", () => {
  const summary = auditDetailSummary({ dates_break_glass: false, dates_sensitive_location: true });
  assert.deepEqual(summary.shown, [
    { key: "dates_break_glass", value: "false" },
    { key: "dates_sensitive_location", value: "true" },
  ]);
  assert.equal(summary.withheld, 0);
});

test("the allow-list is a deliberate list and the page uses it instead of stringifying", async () => {
  // A prototype key must never resolve to an allow-listed one.
  assert.deepEqual(auditDetailSummary({ __proto__: { key: "x" } }), { shown: [], withheld: 0 });
  assert.ok(AUDIT_DETAIL_SAFE_KEYS.length > 0);
  assert.equal(new Set(AUDIT_DETAIL_SAFE_KEYS).size, AUDIT_DETAIL_SAFE_KEYS.length, "no duplicates");
  // Nothing that names a member or their content belongs in the list.
  for (const forbidden of ["answers", "before", "after", "values", "email", "phone", "orientation"]) {
    assert.ok(!(AUDIT_DETAIL_SAFE_KEYS as readonly string[]).includes(forbidden), forbidden);
  }

  const page = await readFile(new URL("../app/(dashboard)/audit/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /JSON\.stringify\(row\.details\)/);
  assert.doesNotMatch(page, /as AuditRow\[\]/);
  assert.match(page, /auditRows\(response\.data\)/);
  assert.match(page, /auditDetailSummary\(row\.details\)/);

  // The two classes the redaction introduces must actually be styled, or the row renders unreadably.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.audit-detail-pair\s*\{/);
  assert.match(css, /\.audit-detail-withheld\s*\{/);
});

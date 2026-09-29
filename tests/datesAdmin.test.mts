import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATES_ADMIN_ACTIONS, isAdminActionAllowed } from "../lib/adminActions.ts";
import {
  configurationInputValue,
  createAdminIdempotencyKey,
  DATES_CASE_NOTE_LIMIT,
  DATES_REPORT_ENTRY_POINTS,
  DATES_REPORT_SCOPES,
  datesActivityEditChanges,
  datesAdminPrincipal,
  datesAppealBlockedByRole,
  datesCaseClaimableByRole,
  datesCaseInternalNotes,
  datesReasonEntryPoints,
  datesReasonEntryPointsRefused,
  datesReportEntryPointsFor,
  datesAvailabilityWriteIsRetired,
  datesModerationSla,
  datesRuntimeSettingVisible,
  datesSettingEffectiveText,
  datesSettingStorefrontEffective,
  hasDatesCapability,
  normalizeDatesPrincipal,
  permittedResolutionActions,
  resolutionActions,
} from "../lib/datesAdmin.ts";
import {
  DATES_LIVE_TRAIL_RETENTION_KEY,
  DATES_RUNTIME_HELP_GROUPS,
  DATES_RUNTIME_HELP_KEYS,
  datesLiveRetentionUnset,
} from "../lib/datesRuntimeHelp.ts";

const EXPECTED_DATES_ACTIONS = [
  "admin_me",
  "dates_activity_list",
  "dates_activity_detail",
  "dates_activity_location",
  "dates_activity_update",
  "dates_activity_command",
  "dates_activity_host_transfer",
  "dates_configuration",
  "dates_configuration_save",
  "dates_activity_type_save",
  "dates_moderation_queue",
  "dates_moderation_detail",
  "dates_moderation_evidence",
  "dates_moderation_trail_evidence",
  "dates_moderation_claim",
  "dates_moderation_heartbeat",
  "dates_moderation_release",
  "dates_moderation_note",
  "dates_moderation_escalate",
  "dates_moderation_resolve",
  "dates_moderation_legal_hold",
  "dates_moderation_sla",
  "dates_reason_list",
  "dates_reason_save",
  "dates_reason_deactivate",
] as const;

const EXPECTED_RUNTIME_HELP_KEYS = [
  "dates_creation_enabled",
  "dates_live_sharing_enabled",
  "dates_reviews_enabled",
  "dates_digest_enabled",
  "dates_default_scheduled_duration_minutes",
  "dates_tbd_expiry_days",
  "dates_now_lifetime_hours",
  "dates_now_warning_minutes",
  "dates_decline_cooldown_hours",
  "dates_invalidated_visibility_hours",
  "dates_maximum_headcount_limit",
  "dates_creation_rate_limit",
  "dates_request_rate_limit",
  "dates_rejoin_rate_limit",
  "dates_chat_message_rate_limit",
  "dates_live_point_rate_limit",
  "dates_report_sla_hours",
  "dates_distinct_report_suspend_threshold",
  "dates_activity_soft_delete_retention_days",
  "dates_live_trail_retention_days",
  "moderation_evidence_retention_days",
  "dates_digest_frequency",
  "dates_digest_quiet_hours",
] as const;

test("Dates Core bridge actions are an exact explicit allow-list", () => {
  assert.deepEqual(DATES_ADMIN_ACTIONS, EXPECTED_DATES_ACTIONS);
  for (const action of EXPECTED_DATES_ACTIONS) assert.equal(isAdminActionAllowed(action), true);
  assert.equal(isAdminActionAllowed("dates_raw_mongo_query"), false);
  assert.equal(isAdminActionAllowed("dates_activity_hard_delete"), false);
});

test("Dates principal projection fails closed and exposes only server capabilities", () => {
  assert.equal(normalizeDatesPrincipal(null), null);
  assert.equal(normalizeDatesPrincipal({ email: "bad", role: "superadmin", capabilities: [] }), null);
  assert.equal(normalizeDatesPrincipal({ email: "a@example.test", role: "owner", capabilities: [] }), null);
  const principal = normalizeDatesPrincipal({
    email: "Admin@Example.Test",
    role: "senior_moderator",
    rank: 30,
    linked_uid: 42,
    sensitive_location: true,
    break_glass: false,
    capabilities: ["dates_case_read", "dates_evidence_read"],
  });
  assert.equal(principal?.email, "admin@example.test");
  assert.equal(principal?.linked_uid, 42);
  assert.deepEqual(principal?.capabilities, ["dates_case_read", "dates_evidence_read"]);
  assert.equal(hasDatesCapability(principal, "dates_evidence_read"), true);
  assert.equal(hasDatesCapability(principal, "dates_activity_purge"), false);
  assert.equal(normalizeDatesPrincipal({
    email: "admin@example.test",
    role: "senior_moderator",
    rank: 30,
    linked_uid: 42,
    sensitive_location: true,
    break_glass: false,
  }), null, "a missing capability catalogue is not an empty catalogue");
  assert.equal(normalizeDatesPrincipal({
    email: "admin@example.test",
    role: "senior_moderator",
    rank: 30,
    linked_uid: 42,
    sensitive_location: true,
    break_glass: false,
    capabilities: ["dates_case_read", 123],
  }), null, "a malformed capability catalogue is not filtered into authority");
  assert.equal(datesAdminPrincipal({ success: false, dates: principal }), null);
  assert.equal(datesAdminPrincipal({ success: true }), null);
  assert.deepEqual(datesAdminPrincipal({ success: true, dates: principal }), principal);
});

test("Dates SLA projection keeps explicit zero/null distinct from missing or malformed findings", () => {
  const empty = {
    success: true,
    open_count: 0,
    unassigned_count: 0,
    sla_breach_count: 0,
    oldest_unassigned_at: null,
    age_buckets: { under_1h: 0, "1h_to_6h": 0, "6h_to_24h": 0, over_24h: 0 },
    median_seconds_to_claim: null,
    median_seconds_to_resolve: null,
    appeals_waiting: 0,
  };
  assert.deepEqual(datesModerationSla(empty), {
    open_count: 0,
    unassigned_count: 0,
    sla_breach_count: 0,
    oldest_unassigned_at: null,
    age_buckets: { under_1h: 0, "1h_to_6h": 0, "6h_to_24h": 0, over_24h: 0 },
    median_seconds_to_claim: null,
    median_seconds_to_resolve: null,
    appeals_waiting: 0,
  });
  for (const key of [
    "open_count",
    "unassigned_count",
    "sla_breach_count",
    "oldest_unassigned_at",
    "age_buckets",
    "median_seconds_to_claim",
    "median_seconds_to_resolve",
    "appeals_waiting",
  ]) {
    const missing = { ...empty } as Record<string, unknown>;
    delete missing[key];
    assert.equal(datesModerationSla(missing), null, `missing ${key}`);
  }
  assert.equal(datesModerationSla({ ...empty, age_buckets: { under_1h: -1 } }), null);
  assert.equal(datesModerationSla({ ...empty, median_seconds_to_claim: Number.NaN }), null);
  assert.equal(datesModerationSla({ ...empty, unassigned_count: 1 }), null, "null oldest cannot mean none waiting when the queue count is positive");
});

test("resolution options remain bounded by case target and kind", () => {
  assert.deepEqual(resolutionActions({ queue: "activities", case_kind: "prepublication", target_type: "activity" }), ["approve_content", "reject_content"]);
  assert.deepEqual(resolutionActions({ queue: "appeals", case_kind: "appeal", target_type: "activity" }), ["uphold", "overturn"]);
  assert.deepEqual(resolutionActions({ queue: "messages", case_kind: "reports", target_type: "message" }), ["dismiss", "restore_content", "remove_content", "warn", "restrict_dates", "suspend_account"]);
  assert.equal(resolutionActions({ queue: "users", case_kind: "reports", target_type: "user" }).includes("remove_participant"), true);
  assert.equal(resolutionActions({ queue: "users", case_kind: "reports", target_type: "user" }).includes("purge"), false);
});

test("resolution and claim options follow the principal's capabilities (AYI-076)", () => {
  // Core's DatesAdminAuthorizationService::capabilities() per role.
  const base = ["dates_activity_read", "dates_case_read", "dates_reason_read", "dates_sla_read", "dates_audit_read", "dates_configuration_read"];
  const supportViewer = { capabilities: base };
  const moderator = { capabilities: [...base, "dates_case_claim", "dates_case_resolve", "dates_evidence_read", "dates_case_note"] };
  const senior = { capabilities: [...moderator.capabilities, "dates_appeal_resolve", "dates_restrict_user", "dates_legal_hold", "dates_trail_evidence_capture"] };

  const userCase = { queue: "users", case_kind: "reports", target_type: "user" };
  const activityCase = { queue: "activities", case_kind: "reports", target_type: "activity" };
  const messageCase = { queue: "messages", case_kind: "reports", target_type: "message" };
  const reviewCase = { queue: "reviews", case_kind: "reports", target_type: "review" };
  const appealCase = { queue: "appeals", case_kind: "appeal", target_type: "activity" };
  const prepublication = { queue: "activities", case_kind: "prepublication", target_type: "activity" };

  // A moderator is never offered what Core refuses with dates-admin-capability-required.
  for (const item of [userCase, activityCase, messageCase, reviewCase]) {
    const offered = permittedResolutionActions(item, moderator);
    assert.equal(offered.includes("restrict_dates"), false);
    assert.equal(offered.includes("suspend_account"), false);
    assert.deepEqual(offered, resolutionActions(item).filter((action) => !["restrict_dates", "suspend_account"].includes(action)));
    assert.deepEqual(permittedResolutionActions(item, senior), resolutionActions(item));
  }
  assert.deepEqual(permittedResolutionActions(userCase, moderator), ["dismiss", "warn", "remove_participant"]);
  assert.deepEqual(permittedResolutionActions(prepublication, moderator), ["approve_content", "reject_content"]);
  assert.deepEqual(permittedResolutionActions(appealCase, moderator), []);
  assert.deepEqual(permittedResolutionActions({ ...appealCase, queue: "activities" }, moderator), [], "an appeal kind outside the appeals queue is still an appeal");
  assert.deepEqual(permittedResolutionActions(appealCase, senior), ["uphold", "overturn"]);
  for (const item of [userCase, activityCase, appealCase, prepublication]) {
    assert.deepEqual(permittedResolutionActions(item, supportViewer), []);
  }

  assert.equal(datesAppealBlockedByRole(appealCase, moderator), true);
  assert.equal(datesAppealBlockedByRole(appealCase, senior), false);
  assert.equal(datesAppealBlockedByRole(userCase, moderator), false);
  assert.equal(datesCaseClaimableByRole(userCase, moderator), true);
  assert.equal(datesCaseClaimableByRole(appealCase, moderator), false, "a moderator's claim would only hold the appeal's lease");
  assert.equal(datesCaseClaimableByRole(appealCase, senior), true);
  assert.equal(datesCaseClaimableByRole(userCase, supportViewer), false);

  const page = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const actions = permittedResolutionActions\(item, principal\)/);
  assert.match(page, /const mayResolve = actions\.length > 0 &&/);
  assert.match(page, /datesCaseClaimableByRole\(item, principal\) &&/);
  assert.match(page, /permittedResolutionActions\(data\.case, principal\)\.includes\(resolutionAction\)/);
  assert.equal(/resolutionActions\(next\.case\)/.test(page), false, "the initial choice comes from the permitted list");
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    for (const key of ["appealClaimUnavailable", "appealDecisionUnavailable", "restrictionActionsUnavailable"]) {
      assert.equal(typeof messages.datesAdmin.caseDetail[key], "string", `${locale}.${key}`);
    }
  }
});

test("case detail internal notes decode strictly and tolerate an older Core (AYI-044, AYI-075)", () => {
  const first = { note_id: `nt_${"a".repeat(32)}`, author_email: "moderator@example.test", text: "Called the host, waiting for screenshots.", created_at: 1_790_000_000 };
  const second = { note_id: `nt_${"b".repeat(32)}`, author_email: "senior@example.test", text: "Screenshots arrived via support ticket 123.\nSecond line.", created_at: 1_790_000_600 };
  const sameSecond = { note_id: `nt_${"c".repeat(32)}`, author_email: "moderator@example.test", text: "Same second, written later.", created_at: 1_790_000_600 };
  const detail = (extra: Record<string, unknown>) => ({ success: true, case: { case_id: "cas_1" }, reports: [], decisions: [], appeal: null, ...extra });

  // Core 140d5bd0: oldest first, exact keys.
  assert.deepEqual(
    datesCaseInternalNotes(detail({ internal_notes: [first, second], internal_notes_withheld: false })),
    { status: "ready", notes: [first, second] },
  );
  assert.deepEqual(
    datesCaseInternalNotes(detail({ internal_notes: [], internal_notes_withheld: false })),
    { status: "ready", notes: [] },
  );
  // Rendered oldest first even if the order drifts; same-second notes keep Core's order.
  assert.deepEqual(
    datesCaseInternalNotes(detail({ internal_notes: [second, sameSecond, first], internal_notes_withheld: false })),
    { status: "ready", notes: [first, second, sameSecond] },
  );
  // Conflict of interest: Core sends [] and true.
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [], internal_notes_withheld: true })), { status: "withheld" });
  // A Core from before 140d5bd0 sends neither key: not an empty list.
  assert.deepEqual(datesCaseInternalNotes(detail({})), { status: "unsupported" });

  const invalid = { status: "invalid" };
  assert.deepEqual(datesCaseInternalNotes(null), invalid);
  assert.deepEqual(datesCaseInternalNotes([]), invalid);
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [first] })), invalid, "the withheld flag is part of the contract");
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes_withheld: false })), invalid, "the list is part of the contract");
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: null, internal_notes_withheld: false })), invalid);
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: {}, internal_notes_withheld: false })), invalid);
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [], internal_notes_withheld: "false" })), invalid);
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [first], internal_notes_withheld: true })), invalid, "notes are never shown to a conflicted principal");
  assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [first, first], internal_notes_withheld: false })), invalid, "duplicate note ids");
  assert.deepEqual(
    datesCaseInternalNotes(detail({ internal_notes: Array.from({ length: DATES_CASE_NOTE_LIMIT + 1 }, (_, index) => ({ ...first, note_id: `nt_${index.toString(16).padStart(32, "0")}` })), internal_notes_withheld: false })),
    invalid,
    "more than Core ever returns",
  );
  assert.equal(
    datesCaseInternalNotes(detail({ internal_notes: Array.from({ length: DATES_CASE_NOTE_LIMIT }, (_, index) => ({ ...first, note_id: `nt_${index.toString(16).padStart(32, "0")}` })), internal_notes_withheld: false })).status,
    "ready",
  );
  const { text: _text, ...missingText } = first;
  for (const note of [
    missingText,
    { ...first, extra: true },
    { ...first, note_id: "" },
    { ...first, note_id: "nt_123" },
    { ...first, note_id: 42 },
    { ...first, author_email: "" },
    { ...first, author_email: "moderator" },
    { ...first, author_email: null },
    { ...first, text: "" },
    { ...first, text: "x".repeat(1001) },
    { ...first, text: ["not text"] },
    { ...first, created_at: 0 },
    { ...first, created_at: -5 },
    { ...first, created_at: 1.5 },
    { ...first, created_at: "1790000000" },
    { ...first, created_at: 9_000_000_000_000 },
    "note",
    null,
  ]) {
    assert.deepEqual(datesCaseInternalNotes(detail({ internal_notes: [second, note], internal_notes_withheld: false })), invalid, JSON.stringify(note));
  }
  // Only "" is refused: Core's PHP trim() keeps NBSP and the Unicode spaces
  // that JS trim() strips, so such a stored note is valid and is rendered.
  for (const text of ["\u00a0", "\u2003", "\u3000note", "note\u00a0"]) {
    assert.deepEqual(
      datesCaseInternalNotes(detail({ internal_notes: [{ ...first, text }], internal_notes_withheld: false })),
      { status: "ready", notes: [{ ...first, text }] },
      JSON.stringify(text),
    );
  }
  // Core bounds a note at 1,000 characters, not UTF-16 units.
  assert.equal(datesCaseInternalNotes(detail({ internal_notes: [{ ...first, text: "😀".repeat(1000) }], internal_notes_withheld: false })).status, "ready");

  const page = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setNotes\(datesCaseInternalNotes\(response\)\)/);
  assert.match(page, /notes\.status === "withheld" \? <p className="alert alert-warning">\{t\("notesWithheld"\)\}/);
  assert.match(page, /notes\.status === "invalid" \? <p className="alert alert-error">\{t\("notesInvalid"\)\}/);
  assert.match(page, /notes\.status === "unsupported" \? <p className="page-subtitle">\{t\("notesUnsupported"\)\}/);
  assert.match(page, /notes\.notes\.map\(\(entry\) => <li key=\{entry\.note_id\}>/);
  assert.match(page, /\{entry\.author_email\}/);
  assert.match(page, /formatDate\(entry\.created_at, locale, true\)/);
  assert.match(page, /\{entry\.text\}/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const copy = messages.datesAdmin.caseDetail;
    for (const key of ["notesTitle", "notesCopy", "noNotes", "notesWithheld", "notesUnsupported", "notesInvalid"]) {
      assert.equal(typeof copy[key], "string", `${locale}.${key}`);
    }
    assert.match(copy.notesLimited, /\{limit\}/);
    // The old copy promised a visibility the console never delivered.
    assert.doesNotMatch(copy.noteCopy, /audit readers|audit-olvasók/);
    assert.doesNotMatch(messages.adminHelp.pages.datesModerationDetail.sections.history.purpose, /claims, notes|claimet, jegyzetet/);
  }
});

test("the Hungarian claim panel says \"átvétel\", like the appeal sentences", () => {
  const hu = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")).datesAdmin.caseDetail;
  assert.equal(hu.claim, "Ügy átvétele");
  // The appeal sentences already say "átvesz"; the rest of the panel matches them.
  assert.match(hu.appealClaimUnavailable, /nem veheted át/);
  assert.match(hu.appealDecisionUnavailable, /átvehesse/);
  for (const key of ["claimTitle", "claimCopy", "claimExpiry", "heartbeat", "claimUnavailable", "claimed", "leaseExtended"]) {
    assert.match(hu[key], /[Áá]tvé|[Áá]tvett|vehető át|át kell venned/, key);
  }
  for (const [key, value] of Object.entries(hu)) {
    if (typeof value === "string") assert.doesNotMatch(value, /claim|lease/i, `hu.caseDetail.${key}`);
  }
});

test("activity edits leave maximum_people out in approval mode (AYI-013)", () => {
  const draft = {
    title: "  Morning run  ",
    details: "",
    activityType: "sport",
    locationMode: "city",
    city: "Budapest",
    countryCode: "hu",
    timeMode: "tbd",
    startAt: "",
    endAt: "",
    timezone: "Europe/Budapest",
    joinMode: "approval",
    maximumPeople: "",
    audience: "{}",
    reason: "typo",
  };
  const approval = datesActivityEditChanges(draft, {});
  // Core refuses an explicit null capacity; approval mode clears it on its own.
  assert.equal(Object.hasOwn(approval, "maximum_people"), false);
  assert.doesNotMatch(JSON.stringify(approval), /maximum_people/);
  assert.equal(approval.join_mode, "approval");
  assert.equal(approval.title, "Morning run");
  assert.equal(approval.details, null);
  assert.equal(approval.country_code, "HU");
  assert.equal(Object.hasOwn(approval, "start_at"), false);

  // A leftover capacity in the draft is still not sent once the mode is approval.
  assert.equal(Object.hasOwn(datesActivityEditChanges({ ...draft, maximumPeople: "8" }, {}), "maximum_people"), false);

  const auto = datesActivityEditChanges({ ...draft, joinMode: "auto", maximumPeople: "12" }, {});
  assert.equal(auto.maximum_people, 12);

  const scheduled = datesActivityEditChanges({
    ...draft,
    timeMode: "scheduled",
    startAt: "2026-10-01T10:00",
    endAt: "2026-10-01T12:00",
  }, {});
  assert.equal(typeof scheduled.start_at, "number");
  assert.equal(Number(scheduled.end_at) - Number(scheduled.start_at), 7200);

  const page = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /datesActivityEditChanges\(draft, audience\)/);
  assert.equal(/maximum_people:\s*draft/.test(page), false, "the page no longer builds the capacity change itself");
});

test("report-reason entry points use the vocabulary Core seeds and clients send (AYI-014)", () => {
  assert.deepEqual([...DATES_REPORT_SCOPES], ["user", "activity", "message", "review"]);
  // Core's seeded catalogue (config/dates_v1_fixture.json) must stay editable.
  const seeded: Record<string, string[]> = {
    user: ["profile", "participant", "chat_header", "check_in"],
    activity: ["card", "detail", "check_in"],
    message: ["message"],
    review: ["review"],
  };
  // What reaches Core today: iOS literals and the targets Core itself serializes.
  const sent: Record<string, string[]> = {
    user: ["detail", "check_in", "direct_chat_header", "message_action"],
    activity: ["detail", "check_in"],
    message: ["message_action"],
    review: ["review"],
  };
  for (const scope of DATES_REPORT_SCOPES) {
    const allowed = DATES_REPORT_ENTRY_POINTS[scope];
    assert.equal(new Set(allowed).size, allowed.length, `${scope} has no duplicates`);
    for (const value of [...seeded[scope], ...sent[scope]]) {
      assert.ok(allowed.includes(value), `${scope} allows ${value}`);
    }
    assert.deepEqual(datesReasonEntryPoints(scope, allowed.join(",")), { ok: true, entryPoints: [...allowed] });
  }
  assert.deepEqual(datesReportEntryPointsFor("owner"), []);

  assert.deepEqual(
    datesReasonEntryPoints("user", " Detail, participant ,detail,, "),
    { ok: true, entryPoints: ["detail", "participant"] },
  );
  assert.deepEqual(datesReasonEntryPoints("user", ""), { ok: false, error: "empty" });
  assert.deepEqual(datesReasonEntryPoints("user", " , ,"), { ok: false, error: "empty" });
  // The retired placeholder values are named, not silently dropped.
  assert.deepEqual(
    datesReasonEntryPoints("activity", "detail, activity_menu, chat_message, profile_menu"),
    { ok: false, error: "unknown", tokens: ["activity_menu", "chat_message", "profile_menu"] },
  );
  assert.deepEqual(datesReasonEntryPoints("user", "profile, INVALID VALUE"), { ok: false, error: "unknown", tokens: ["invalid value"] });
  // A value is valid only for the scopes that can report from it.
  assert.deepEqual(datesReasonEntryPoints("review", "detail"), { ok: false, error: "unknown", tokens: ["detail"] });
  assert.deepEqual(datesReasonEntryPoints("message", "review"), { ok: false, error: "unknown", tokens: ["review"] });
  assert.deepEqual(datesReasonEntryPoints("owner", "detail"), { ok: false, error: "unknown", tokens: ["detail"] });

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /datesReasonEntryPoints\(scope, entryPoints\)/);
  assert.match(page, /entry_points: parsedEntryPoints\.entryPoints/);
  assert.match(page, /placeholder=\{allowedEntryPoints\}/);
  assert.equal(page.includes("entryPointsPlaceholder"), false);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const configuration = messages.datesAdmin.configuration;
    assert.equal(Object.hasOwn(configuration, "entryPointsPlaceholder"), false, `${locale} placeholder retired`);
    assert.match(configuration.entryPointsHint, /\{values\}/);
    assert.equal(typeof configuration.entryPointsEmpty, "string");
    assert.match(configuration.entryPointsUnknown, /\{values\}.*\{allowed\}/);
    assert.doesNotMatch(JSON.stringify(configuration), /activity_menu|profile_menu/);
  }
});

test("Core's entry-point refusal is shown under the field, like the console's own check", () => {
  // Core 8997bee3: dates_reason_save refuses an empty or unknown list with this code.
  assert.equal(datesReasonEntryPointsRefused("dates-report-entry-points-invalid"), true);
  for (const error of ["dates-report-entry-point-invalid", "dates-report-reason-order-invalid", "core-unavailable", "", null, undefined]) {
    assert.equal(datesReasonEntryPointsRefused(error), false, String(error));
  }

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  const save = page.slice(page.indexOf("adminCall(\"dates_reason_save\""), page.indexOf("async function deactivate()"));
  assert.match(save, /if \(datesReasonEntryPointsRefused\(response\?\.error\)\) \{\s*showEntryPointsError\(t\("entryPointsRefused", \{ allowed: allowedEntryPoints \}\)\);\s*return;\s*\}\s*onError\(response\?\.error\);/);
  // The same inline slot the client-side check writes to.
  assert.match(page, /\{entryPointsError && <small className="field-error" role="alert">\{entryPointsError\}<\/small>\}/);
  // An inline refusal (Core's or the console's own) clears the page-level error
  // an earlier failed save left above it, and leaves a success notice alone.
  assert.match(page, /function showEntryPointsError\(message: string\) \{\s*setEntryPointsError\(message\);\s*onInlineError\(\);\s*\}/);
  assert.match(page, /function clearFailure\(\) \{ setFeedback\(\(current\) => current\?\.tone === "error" \? null : current\); \}/);
  assert.equal(page.match(/onInlineError=\{clearFailure\}/g)?.length, 2, "both reason editors clear it");
  const localCheck = page.slice(page.indexOf("const parsedEntryPoints = datesReasonEntryPoints"), page.indexOf("setEntryPointsError(null);\n    setBusy(true);"));
  assert.match(localCheck, /showEntryPointsError\(parsedEntryPoints\.error === "empty"/);
  assert.doesNotMatch(page.slice(page.indexOf("async function save(event: React.FormEvent) {\n    event.preventDefault();\n    if (auditReason")), /setEntryPointsError\(t\(/);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const refused = messages.datesAdmin.configuration.entryPointsRefused;
    assert.match(refused, /\{allowed\}/, `${locale}.entryPointsRefused`);
    assert.doesNotMatch(refused, /dates-report-entry-points-invalid/, "a readable sentence, not the code");
  }
});

test("admin payload helpers normalize idempotency, catalog and setting values", () => {
  assert.match(createAdminIdempotencyKey("Dates Setting Save"), /^dates-setting-save:[0-9a-f-]{36}$/);
  assert.equal(configurationInputValue("boolean", "false"), false);
  assert.equal(configurationInputValue("integer", "42"), 42);
  assert.equal(configurationInputValue("nullable_integer", ""), null);
  assert.deepEqual(configurationInputValue("quiet_hours", "22:00|08:00"), { start: "22:00", end: "08:00" });
});

test("Dates availability has no second control, writer, route, permission, or navigation entry", () => {
  assert.equal(datesRuntimeSettingVisible("dates_enabled"), false);
  assert.equal(datesRuntimeSettingVisible("dates_creation_enabled"), true);
  assert.equal(datesRuntimeSettingVisible(null), false);
  assert.equal(datesAvailabilityWriteIsRetired("dates_configuration_save", {
    key: "dates_enabled",
  }), true);
  assert.equal(datesAvailabilityWriteIsRetired("dates_configuration_save", {
    key: "dates_creation_enabled",
  }), false);
  assert.equal(datesAvailabilityWriteIsRetired("dates_configuration", {
    key: "dates_enabled",
  }), false);
  // The shared route remains necessary for every non-availability Dates setting.
  assert.ok(EXPECTED_DATES_ACTIONS.includes("dates_configuration_save"));
  assert.equal(EXPECTED_DATES_ACTIONS.some((action) => action.includes("enabled")), false);

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  const helpModel = readFileSync(new URL("../lib/datesRuntimeHelp.ts", import.meta.url), "utf8");
  const help = readFileSync(new URL("../components/DatesRuntimeSettingsHelp.tsx", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("../components/DatesAdminTabs.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(page, /datesRuntimeSettingVisible\(setting\?\.key\)/);
  assert.match(route, /datesAvailabilityWriteIsRetired\(action, body\)/);
  assert.doesNotMatch(`${page}\n${helpModel}\n${help}\n${tabs}`, /dates_enabled/u);

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    assert.equal(Object.hasOwn(messages.datesAdmin.configuration.runtimeHelp.settings, "dates_enabled"), false);
  }
});

test("Dates runtime help covers every bounded Core setting in both locales", () => {
  assert.deepEqual(DATES_RUNTIME_HELP_KEYS, EXPECTED_RUNTIME_HELP_KEYS);
  assert.equal(new Set(DATES_RUNTIME_HELP_KEYS).size, EXPECTED_RUNTIME_HELP_KEYS.length);
  assert.equal(DATES_RUNTIME_HELP_GROUPS.length, 5);

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/DatesRuntimeSettingsHelp.tsx", import.meta.url), "utf8");
  assert.match(page, /runtimeHelp\.button/);
  assert.match(page, /DatesRuntimeSettingsHelp/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /effective_value/);
  assert.match(component, /default_value/);

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const help = messages.datesAdmin.configuration.runtimeHelp;
    assert.match(help.button, /^\?\s/);
    assert.equal(typeof help.beforeChangingCopy, "string");
    for (const key of EXPECTED_RUNTIME_HELP_KEYS) {
      const entry = help.settings[key];
      assert.equal(typeof entry?.title, "string", `${locale}.${key}.title`);
      assert.equal(typeof entry?.purpose, "string", `${locale}.${key}.purpose`);
      assert.equal(typeof entry?.effect, "string", `${locale}.${key}.effect`);
      assert.equal(typeof entry?.caution, "string", `${locale}.${key}.caution`);
    }
  }
});

test("unset live-trail retention turns live sharing off, not the worker (Core be03922a)", () => {
  const retention = (effective: unknown) => ({ key: DATES_LIVE_TRAIL_RETENTION_KEY, effective_value: effective });
  const other = { key: "dates_live_sharing_enabled", effective_value: true };
  assert.equal(DATES_LIVE_TRAIL_RETENTION_KEY, "dates_live_trail_retention_days");
  // Production with the seeded null: Core's effective value is 0.
  assert.equal(datesLiveRetentionUnset([other, retention(0)]), true);
  assert.equal(datesLiveRetentionUnset([retention(null)]), true);
  assert.equal(datesLiveRetentionUnset([retention(-1)]), true);
  assert.equal(datesLiveRetentionUnset([retention("30")]), true, "a malformed value does not prove a retention");
  assert.equal(datesLiveRetentionUnset([retention(1.5)]), true);
  assert.equal(datesLiveRetentionUnset([other, retention(1)]), false);
  assert.equal(datesLiveRetentionUnset([retention(30)]), false);
  assert.equal(datesLiveRetentionUnset([other]), false, "a missing row proves nothing");
  assert.equal(datesLiveRetentionUnset([]), false);

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{datesLiveRetentionUnset\(settings\) && <div className="alert alert-warning page-alert" role="status"><strong>\{t\("liveRetentionUnsetTitle"\)\}<\/strong> \{t\("liveRetentionUnsetCopy"\)\}<\/div>\}/);
  assert.match(page, /setting\.key === DATES_LIVE_TRAIL_RETENTION_KEY \? t\("liveRetentionPlaceholder"\)/);
  const help = readFileSync(new URL("../components/DatesRuntimeSettingsHelp.tsx", import.meta.url), "utf8");
  assert.match(help, /settingKey === DATES_LIVE_TRAIL_RETENTION_KEY && setting && datesLiveRetentionUnset\(\[setting\]\)/);
  assert.match(help, /t\("liveRetentionUnset"\)/);

  const en = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  assert.equal(hu.datesAdmin.configuration.liveRetentionUnsetTitle, "Az élő helymegosztás ki van kapcsolva, amíg nincs beállítva megőrzési idő.");
  for (const messages of [en, hu]) {
    const configuration = messages.datesAdmin.configuration;
    for (const key of ["liveRetentionPlaceholder", "liveRetentionUnsetTitle", "liveRetentionUnsetCopy"]) {
      assert.equal(typeof configuration[key], "string", key);
    }
    assert.equal(typeof configuration.runtimeHelp.liveRetentionUnset, "string");
    const effect = configuration.runtimeHelp.settings.dates_live_trail_retention_days.effect;
    // The worker no longer refuses to run while retention is unset.
    assert.doesNotMatch(effect, /refuses unsafe processing|megtagadja a nem biztonságos feldolgozást/);
    assert.match(effect, /worker/);
    assert.match(configuration.liveRetentionUnsetCopy, /dates_live_trail_retention_days/);
  }
  assert.match(en.datesAdmin.configuration.runtimeHelp.settings.dates_live_trail_retention_days.effect, /keeps running.*logs a warning/);
  assert.match(hu.datesAdmin.configuration.runtimeHelp.settings.dates_live_trail_retention_days.effect, /tovább fut.*figyelmeztetést naplóz/);
});

test("Dates pages use the authenticated bridge and keep destructive controls explicit", () => {
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /isTrustedAdminRequest/);
  assert.match(route, /readAdminSession\(\)/);
  assert.match(route, /admin_email:\s*session\.email/);
  assert.match(route, /isAdminActionAllowed/);

  const pageFiles = [
    "../app/(dashboard)/dates/page.tsx",
    "../app/(dashboard)/dates/[activityId]/page.tsx",
    "../app/(dashboard)/dates/moderation/page.tsx",
    "../app/(dashboard)/dates/moderation/[caseId]/page.tsx",
    "../app/(dashboard)/dates/configuration/page.tsx",
  ];
  const pages = pageFiles.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(pages, /core\.friending\.com|WEBADMIN_SECRET|fetch\s*\(/);
  assert.match(pages, /adminCall\(/);
  assert.match(pages, /expected_revision/);
  assert.match(pages, /idempotency_key/);
  assert.match(pages, /ConfirmDialog/);
  assert.match(pages, /dates_moderation_evidence/);
  assert.match(pages, /dates_moderation_trail_evidence/);
  assert.match(pages, /dates_reason_deactivate/);
  assert.match(pages, /reason\?\.active === true/);
  for (const filter of [
    "host_uid", "going_min", "going_max", "pending_min", "pending_max",
    "report_min", "report_max", "maximum_min", "maximum_max",
    "created_from", "created_to", "updated_from", "updated_to", "time_from", "time_to",
  ]) assert.match(pages, new RegExp(`"${filter}"`));

  const principalPages = pageFiles
    .filter((file) => !file.endsWith("moderation/page.tsx"))
    .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
  for (const page of principalPages) {
    assert.match(page, /datesAdminPrincipal\(identity\)/);
    assert.match(page, /!nextPrincipal/);
    assert.doesNotMatch(page, /normalizeDatesPrincipal\(identity\?\.dates\)/);
  }
  const activity = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  assert.match(activity, /Array\.isArray\(response\.notifications\)/);
  assert.doesNotMatch(activity, /notifications\s*\|\|\s*\[\]/);
  const moderation = readFileSync(new URL("../app/(dashboard)/dates/moderation/page.tsx", import.meta.url), "utf8");
  assert.match(moderation, /datesModerationSla\(slaResponse\)/);
  assert.match(moderation, /state === "ready" && sla/);
  assert.doesNotMatch(moderation, /as unknown as Sla/);
});

test("D-116: the console names the dating mode AreYouIn in both languages, never Date/Randi", () => {
  const en = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  // The verification console's AreYouIn feature rows.
  assert.deepEqual(
    ["access", "create", "join"].map((key) => en.verificationAdmin.features.dates[key].title),
    ["Open AreYouIn", "Create an AreYouIn activity", "Join an AreYouIn activity"],
  );
  assert.deepEqual(
    ["access", "create", "join"].map((key) => hu.verificationAdmin.features.dates[key].title),
    ["AreYouIn megnyitása", "AreYouIn aktivitás létrehozása", "Csatlakozás AreYouIn aktivitáshoz"],
  );
  // The mode-card editor's description of the card and the button-radius help.
  assert.equal(en.appearance.modeSwitcher.cardsCopy.dates, "The AreYouIn mode: activities members host and join.");
  assert.equal(hu.appearance.modeSwitcher.cardsCopy.dates, "Az AreYouIn mód: programok, amelyeket a tagok szerveznek, és amelyekhez csatlakozhatnak.");
  assert.match(en.appearance.landingComposer.buttons.radiusHelp, /account and AreYouIn—/);
  assert.match(hu.appearance.landingComposer.buttons.radiusHelp, /az AreYouIn szekcióban is;/);
  for (const [locale, messages] of [["en", en], ["hu", hu]] as const) {
    const text = JSON.stringify([
      messages.verificationAdmin.features.dates,
      messages.appearance.modeSwitcher.cardsCopy,
      messages.appearance.landingComposer.buttons.radiusHelp,
    ]);
    assert.doesNotMatch(text, /\bDates?\b|[Rr]andi|dating/, `${locale} still names the mode Date/Randi`);
  }
  // English takes "an" before AreYouIn.
  assert.doesNotMatch(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"), /\b[Aa] AreYouIn\b/);
});

test("a setting row's effective text is Core's effective value, never the unsaved draft (AYI-074)", () => {
  assert.equal(datesSettingEffectiveText("quiet_hours", { start: "23:00", end: "07:30" }), "23:00–07:30");
  for (const malformed of [null, "22:00|08:00", { start: "22:00" }, { start: 22, end: 8 }, []]) {
    assert.equal(datesSettingEffectiveText("quiet_hours", malformed), "—", JSON.stringify(malformed));
  }
  assert.equal(datesSettingEffectiveText("boolean", false), "false");
  assert.equal(datesSettingEffectiveText("boolean", false, { on: "Enabled", off: "Disabled" }), "Disabled");
  assert.equal(datesSettingEffectiveText("boolean", true, { on: "Enabled", off: "Disabled" }), "Enabled");
  assert.equal(datesSettingEffectiveText("integer", 120, { on: "Enabled", off: "Disabled" }), "120");
  assert.equal(datesSettingEffectiveText("nullable_integer", null), "null");
  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /t\("effective", \{ value: datesSettingEffectiveText\(setting\.type, setting\.effective_value, booleans\) \}\)/);
  assert.doesNotMatch(page, /value\.replace\("\|", "–"\)/, "the draft is not shown as the effective value");
});

test("rollout switches show the per-storefront answer next to the global one (AYI-074)", () => {
  // Core before the fix: no key at all; only the global answer is known.
  assert.deepEqual(datesSettingStorefrontEffective({ key: "dates_creation_enabled", effective_value: false }), { status: "unsupported" });
  // Core with the fix: null on settings that do not depend on the storefront.
  assert.deepEqual(datesSettingStorefrontEffective({ key: "dates_tbd_expiry_days", effective_by_storefront: null }), { status: "notApplicable" });
  // "Off globally, on for HUN": the HUN row carries HUN's answer.
  assert.deepEqual(
    datesSettingStorefrontEffective({
      key: "dates_creation_enabled",
      effective_value: false,
      effective_scope: "global",
      effective_by_storefront: [{ storefront: "USA", effective_value: false }, { storefront: "HUN", effective_value: true }],
    }),
    { status: "ready", rows: [{ storefront: "HUN", effective: true }, { storefront: "USA", effective: false }] },
  );
  assert.deepEqual(datesSettingStorefrontEffective({ effective_by_storefront: [] }), { status: "ready", rows: [] });
  for (const malformed of [
    {},
    [{ storefront: "HUN" }],
    [{ storefront: "HUN", effective_value: "true" }],
    [{ storefront: "hun", effective_value: true }],
    [{ storefront: "HU", effective_value: true }],
    [{ storefront: "HUN", effective_value: true, extra: 1 }],
    [{ storefront: "HUN", effective_value: true }, { storefront: "HUN", effective_value: false }],
    "HUN",
  ]) {
    assert.deepEqual(datesSettingStorefrontEffective({ effective_by_storefront: malformed }), { status: "invalid" }, JSON.stringify(malformed));
  }
  assert.deepEqual(datesSettingStorefrontEffective(null), { status: "unsupported" });

  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const storefronts = datesSettingStorefrontEffective\(setting\);/);
  assert.match(page, /storefronts\.status === "ready" && storefronts\.rows\.length > 0 && <small>\{t\("effectiveByStorefront"/);
  assert.match(page, /storefronts\.status === "invalid" && <span className="dates-danger-text">\{t\("effectiveByStorefrontInvalid"\)\}/);
  assert.match(page, /datesSettingStorefrontEffective\(setting\)\.status === "unsupported"\) && <p className="alert alert-info">\{t\("effectiveByStorefrontUnsupported"\)\}/);
  const help = readFileSync(new URL("../components/DatesRuntimeSettingsHelp.tsx", import.meta.url), "utf8");
  assert.match(help, /datesSettingStorefrontEffective\(setting\)/);
  for (const locale of ["en", "hu"]) {
    const configuration = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.configuration;
    assert.match(configuration.effective, /\{value\}/);
    assert.match(configuration.effective, /global|globális/);
    assert.match(configuration.effectiveByStorefront, /\{values\}/);
    for (const key of ["effectiveByStorefrontInvalid", "effectiveByStorefrontUnsupported"]) assert.equal(typeof configuration[key], "string");
    assert.match(configuration.runtimeHelp.effectiveValue, /global|globális/);
    // The old note called the (global) effective value "the operational witness".
    assert.doesNotMatch(configuration.runtimeHelp.effectiveNote, /operational witness|üzemeltetési tényt/);
    assert.match(configuration.runtimeHelp.effectiveNote, /global|globális/);
  }
});

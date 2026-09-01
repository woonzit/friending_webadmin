import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATES_ADMIN_ACTIONS, isAdminActionAllowed } from "../lib/adminActions.ts";
import {
  configurationInputValue,
  createAdminIdempotencyKey,
  datesAdminPrincipal,
  datesAvailabilityWriteIsRetired,
  datesModerationSla,
  datesRuntimeSettingVisible,
  hasDatesCapability,
  normalizeDatesPrincipal,
  parseEntryPoints,
  resolutionActions,
} from "../lib/datesAdmin.ts";
import {
  DATES_RUNTIME_HELP_GROUPS,
  DATES_RUNTIME_HELP_KEYS,
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

test("admin payload helpers normalize idempotency, catalog and setting values", () => {
  assert.match(createAdminIdempotencyKey("Dates Setting Save"), /^dates-setting-save:[0-9a-f-]{36}$/);
  assert.deepEqual(parseEntryPoints("chat_message, activity_menu, chat_message, INVALID VALUE"), ["chat_message", "activity_menu"]);
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

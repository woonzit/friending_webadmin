import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  membershipActionErrorKey,
  membershipConfiguration,
  membershipConfigurationCandidate,
  membershipExpiryChange,
  membershipGrantPreview,
  membershipListSummary,
  membershipPlanIsDirty,
  membershipPlanPreview,
  membershipPlanValidationIssues,
  membershipShouldGuardInternalNavigation,
  membershipStoreContribution,
  membershipStoreProductRows,
  membershipUtcInstant,
  membershipUserDetail,
} from "../lib/membership.ts";
import { adminActionAccess } from "../lib/adminActions.ts";

const ISO = "2026-08-15T12:00:00Z";
const LATER = "2026-09-15T12:00:00Z";

function configurationFixture() {
  return {
    configuration: {
      _id: "membership_v1",
      schema_version: 1,
      revision: 3,
      ready_for_enforcement: false,
      capabilities: {
        invisible_presence: { free: false, plus: true },
        hide_profile_visit: { free: false, plus: true },
        vip_badge: { free: false, plus: true },
      },
      quotas: {
        footprint_send: { scope: "utc_day", free: { mode: "finite", value: 5 }, plus: { mode: "finite", value: 20 } },
        pinger_send: { scope: "utc_day", free: { mode: "finite", value: 0 }, plus: { mode: "unlimited", value: null } },
        private_album_access: { scope: "concurrent", free: { mode: "finite", value: 0 }, plus: { mode: "unlimited", value: null } },
        quick_phrase_slots: { scope: "concurrent", free: { mode: "disabled", value: null }, plus: { mode: "finite", value: 20 } },
      },
      admin_grant_presets: {
        plus_week: { tier: "plus", period: "P1W" },
        plus_month: { tier: "plus", period: "P1M" },
        plus_quarter: { tier: "plus", period: "P3M" },
      },
      updated_at: 1770000000,
      updated_by: "owner@example.invalid",
    },
    bounds: {
      footprint_send: { scope: "utc_day", min: 0, max: 1000 },
      pinger_send: { scope: "utc_day", min: 0, max: 10000 },
      private_album_access: { scope: "concurrent", min: 0, max: 1000 },
      quick_phrase_slots: { scope: "concurrent", min: 0, max: 50 },
    },
    tiers: ["free", "plus"],
    capability_keys: ["invisible_presence", "hide_profile_visit", "vip_badge"],
    rollout: {
      projection_writes_enabled: false,
      feature_enforcement_enabled: false,
      legacy_compat_enabled: true,
    },
    store_products: {
      apple: [
        { product_id: "com.friending.app.subscription1m", tier: "plus", period: "P1M" },
        { product_id: "com.friending.app.subscription3m", tier: "plus", period: "P3M" },
        { product_id: "com.friending.app.subscription6m", tier: "plus", period: "P6M" },
      ],
      google: [],
    },
  };
}

function userDetailFixture() {
  return {
    schema_version: 1,
    uid: 123,
    effective_membership: {
      schema_version: 1,
      tier: "plus",
      entitled: true,
      lifecycle_state: "active",
      effective_starts_at: ISO,
      effective_expires_at: LATER,
      next_transition_at: LATER,
      first_subscribed_at: ISO,
      sources: [{
        kind: "apple",
        state: "active",
        starts_at: ISO,
        expires_at: LATER,
        auto_renews: true,
        contributes_to_access: true,
      }],
      revision: 4,
      server_time: ISO,
      configuration_revision: 3,
      configuration_ready_for_enforcement: false,
      capabilities: {
        invisible_presence: true,
        hide_profile_visit: true,
        vip_badge: true,
        quick_phrases: true,
      },
      quotas: {
        footprint_send: { scope: "utc_day", mode: "finite", used: 2, limit: 20, remaining: 18, reset_at: LATER },
        pinger_send: { scope: "utc_day", mode: "unlimited", used: 4, reset_at: LATER },
        private_album_access: { scope: "concurrent", mode: "unlimited", used: 3 },
        quick_phrase_slots: { scope: "concurrent", mode: "finite", used: 2, limit: 20, remaining: 18 },
      },
      badge: { eligible: true, hidden: false, visible: true },
    },
    store_sources: [{
      source_id: "SENSITIVE-PROVIDER-IDENTIFIER",
      platform: "apple",
      environment: "Production",
      product_id: "com.friending.app.subscription1",
      base_plan_id: "",
      tier: "plus",
      provider_state: "active",
      normalized_state: "active",
      first_purchased_at: ISO,
      current_period_started_at: ISO,
      expires_at: LATER,
      grace_expires_at: null,
      auto_renews: true,
      verification_status: "verified",
      last_verified_at: ISO,
      raw_receipt: "SECRET-RECEIPT",
    }],
    admin_grant: null,
    history: [{
      kind: "admin",
      action: "membership.admin_grant.grant",
      actor: "owner@example.invalid",
      reason: "Support recovery",
      created_at: ISO,
      request_id: "SENSITIVE-IDEMPOTENCY-KEY",
    }],
  };
}

test("membership configuration ignores additive catalogue fields, stays bounded, and projects a safe save body", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  assert.equal(parsed.configuration.quotas.footprint_send.plus.value, 20);
  assert.equal(parsed.store_products.apple.length, 3);

  const candidate = membershipConfigurationCandidate(parsed.configuration);
  assert.equal("revision" in candidate, false);
  assert.equal("updated_at" in candidate, false);
  assert.equal("updated_by" in candidate, false);
  assert.equal("_id" in candidate, false);

  const outOfBounds = configurationFixture();
  outOfBounds.configuration.quotas.quick_phrase_slots.plus.value = 51;
  assert.equal(membershipConfiguration(outOfBounds), null);

  const additive = configurationFixture();
  Object.assign(additive.configuration.capabilities, { arbitrary_paid_access: { free: true, plus: true } });
  Object.assign(additive.configuration.capabilities.vip_badge, { future_tier: true });
  Object.assign(additive.configuration.quotas, { future_quota: { scope: "utc_day" } });
  Object.assign(additive.configuration.admin_grant_presets, { future_preset: { tier: "plus", period: "P1Y" } });
  Object.assign(additive.bounds, { future_quota: { scope: "utc_day", min: 0, max: 1 } });
  assert.deepEqual(membershipConfiguration(additive), membershipConfiguration(configurationFixture()));

  const missingCapability = configurationFixture();
  delete (missingCapability.configuration.capabilities as Record<string, unknown>).invisible_presence;
  assert.equal(membershipConfiguration(missingCapability), null);
});

test("membership configuration accepts only Core's closed Apple product periods", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  assert.deepEqual(
    parsed.store_products.apple.map(({ product_id, period }) => ({ product_id, period })),
    [
      { product_id: "com.friending.app.subscription1m", period: "P1M" },
      { product_id: "com.friending.app.subscription3m", period: "P3M" },
      { product_id: "com.friending.app.subscription6m", period: "P6M" },
    ],
  );

  for (const period of ["P1W", "P1Y"]) {
    const invalid = configurationFixture();
    invalid.store_products.apple[0].period = period;
    assert.equal(membershipConfiguration(invalid), null, `${period} must fail closed for Apple`);
  }
});

test("plan dirty state compares editable material and ignores server metadata", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  const authoritative = parsed.configuration;
  const sameMaterial = structuredClone(authoritative);
  sameMaterial.revision += 7;
  sameMaterial.updated_at += 100;
  sameMaterial.updated_by = "another-owner@example.invalid";
  assert.equal(membershipPlanIsDirty(authoritative, sameMaterial), false);

  const capabilityEdit = structuredClone(authoritative);
  capabilityEdit.capabilities.invisible_presence.free = true;
  assert.equal(membershipPlanIsDirty(authoritative, capabilityEdit), true);

  const quotaEdit = structuredClone(authoritative);
  quotaEdit.quotas.footprint_send.plus.value = 21;
  assert.equal(membershipPlanIsDirty(authoritative, quotaEdit), true);

  const readinessEdit = structuredClone(authoritative);
  readinessEdit.ready_for_enforcement = true;
  assert.equal(membershipPlanIsDirty(authoritative, readinessEdit), true);
});

test("plan validation reports every invalid rule against Core bounds", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  const draft = structuredClone(parsed.configuration);
  draft.quotas.footprint_send.scope = "concurrent";
  draft.quotas.footprint_send.free.value = -1;
  draft.quotas.pinger_send.plus = { mode: "finite", value: 10_001 };
  draft.quotas.private_album_access.free = { mode: "unlimited", value: 5 };
  draft.quotas.quick_phrase_slots.plus.value = null;

  const issues = membershipPlanValidationIssues(draft, parsed.bounds);
  assert.deepEqual(
    issues.map((issue) => [issue.kind, issue.quota, issue.tier]),
    [
      ["scope_mismatch", "footprint_send", null],
      ["finite_value_invalid", "footprint_send", "free"],
      ["finite_value_invalid", "pinger_send", "plus"],
      ["non_finite_value", "private_album_access", "free"],
      ["finite_value_invalid", "quick_phrase_slots", "plus"],
    ],
  );
  assert.deepEqual(
    issues.find((issue) => issue.quota === "quick_phrase_slots"),
    {
      kind: "finite_value_invalid",
      quota: "quick_phrase_slots",
      tier: "plus",
      expected_scope: "concurrent",
      min: 0,
      max: 50,
    },
  );
});

test("member benefit and administrator preset previews derive only from the draft", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  const draft = structuredClone(parsed.configuration);
  draft.capabilities.hide_profile_visit.free = true;
  draft.quotas.footprint_send.plus.value = 42;
  const preview = membershipPlanPreview(draft);
  const free = preview.tiers.find((tier) => tier.tier === "free");
  const plus = preview.tiers.find((tier) => tier.tier === "plus");
  assert.equal(free?.capabilities.find((row) => row.key === "hide_profile_visit")?.enabled, true);
  assert.equal(plus?.quotas.find((row) => row.key === "footprint_send")?.value, 42);
  assert.deepEqual(
    preview.presets.map((preset) => [preset.key, preset.tier, preset.period]),
    [
      ["plus_week", "plus", "P1W"],
      ["plus_month", "plus", "P1M"],
      ["plus_quarter", "plus", "P3M"],
    ],
  );
});

test("membership machine errors map to closed action-specific localized keys", () => {
  assert.equal(membershipActionErrorKey("configuration_save", "membership-configuration-conflict"), "configurationConflict");
  assert.equal(membershipActionErrorKey("grant_create", "membership-admin-conflict"), "grantConflict");
  assert.equal(membershipActionErrorKey("expiry_update", "membership-admin-conflict"), "expiryConflict");
  assert.equal(membershipActionErrorKey("grant_revoke", "membership-admin-conflict"), "revokeConflict");
  assert.equal(membershipActionErrorKey("grant_preview", "membership-admin-grant-expiry-invalid"), "expiryInvalid");
  assert.equal(membershipActionErrorKey("grant_preview", "membership-admin-grant-horizon-exceeded"), "horizonExceeded");
  assert.equal(membershipActionErrorKey("grant_revoke", "admin-owner-required"), "ownerRequired");
  assert.equal(membershipActionErrorKey("configuration_save", "core-timeout"), "timeout");
  assert.equal(membershipActionErrorKey("configuration_save", "core-unavailable"), "unavailable");
  assert.equal(membershipActionErrorKey("grant_create", undefined), "invalidResponse");
  assert.equal(membershipActionErrorKey("grant_create", "new-server-error-with-private-detail"), "unknown");

  const actualCoreVocabulary = [
    "admin-owner-required",
    "admin-revoked",
    "admin-session-invalid",
    "admin-write-required",
    "membership-admin-conflict",
    "membership-admin-grant-expiry-invalid",
    "membership-admin-grant-horizon-exceeded",
    "membership-admin-grant-invalid",
    "membership-admin-grant-not-found",
    "membership-admin-unavailable",
    "membership-admin-reason-invalid",
    "membership-admin-request-id-conflict",
    "membership-admin-request-id-invalid",
    "membership-admin-revision-invalid",
    "membership-admin-use-expiry-update",
    "membership-admin-write-failed",
    "membership-configuration-capabilities-invalid",
    "membership-configuration-conflict",
    "membership-configuration-invalid",
    "membership-configuration-presets-invalid",
    "membership-configuration-quotas-invalid",
    "membership-configuration-request-id-conflict",
    "membership-configuration-schema-invalid",
    "membership-configuration-stored-invalid",
    "membership-configuration-unavailable",
    "membership-configuration-write-failed",
    "membership-user-invalid",
    "membership-user-not-found",
  ];
  for (const code of actualCoreVocabulary) {
    assert.notEqual(
      membershipActionErrorKey("grant_create", code),
      "unknown",
      `${code} lost its safe localized category`,
    );
  }
});

test("dirty navigation guard targets App Router route changes but not same-page controls", () => {
  const current = "https://friendingapp.com/membership?tab=plans#limits";
  assert.equal(membershipShouldGuardInternalNavigation(current, "/users"), true);
  assert.equal(membershipShouldGuardInternalNavigation(current, "/membership?tab=members"), true);
  assert.equal(membershipShouldGuardInternalNavigation(current, "/membership?tab=plans#preview"), false);
  assert.equal(membershipShouldGuardInternalNavigation(current, current), false);
  assert.equal(membershipShouldGuardInternalNavigation(current, "https://core.friending.com/health"), false);
  assert.equal(membershipShouldGuardInternalNavigation(current, "http://["), false);
});

test("member detail keeps operational facts and drops provider secrets", () => {
  const parsed = membershipUserDetail(userDetailFixture());
  assert.ok(parsed);
  assert.equal(parsed.effective_membership.tier, "plus");
  assert.equal(parsed.store_sources[0]?.product_id, "com.friending.app.subscription1");
  const serialized = JSON.stringify(parsed);
  for (const secret of ["SENSITIVE-PROVIDER-IDENTIFIER", "SECRET-RECEIPT", "SENSITIVE-IDEMPOTENCY-KEY", "raw_receipt", "source_id", "request_id"]) {
    assert.equal(serialized.includes(secret), false, `${secret} reached browser state`);
  }
});

test("malformed paid state fails closed instead of becoming PLUS", () => {
  const malformed = userDetailFixture();
  malformed.effective_membership.quotas.footprint_send.remaining = -1;
  assert.equal(membershipUserDetail(malformed), null);

  const summary = membershipListSummary({ tier: "plus", entitled: true, lifecycle_state: "active", source_kinds: "apple" });
  assert.equal(summary.tier, "unknown");
  assert.equal(summary.entitled, false);
  assert.equal(summary.lifecycle_state, "unavailable");
});

test("Registered Users membership summaries keep tier, lifecycle, expiry, and source truth separate", () => {
  const plus = membershipListSummary({
    tier: "plus",
    entitled: true,
    lifecycle_state: "active",
    effective_expires_at: LATER,
    first_subscribed_at: ISO,
    source_kinds: ["admin_grant", "apple", "admin_grant"],
  });
  assert.deepEqual(plus, {
    tier: "plus",
    entitled: true,
    lifecycle_state: "active",
    effective_expires_at: LATER,
    first_subscribed_at: ISO,
    source_kinds: ["admin_grant", "apple"],
  });

  const expired = membershipListSummary({
    tier: "free",
    entitled: false,
    lifecycle_state: "expired",
    effective_expires_at: null,
    first_subscribed_at: ISO,
    source_kinds: ["legacy_compat"],
  });
  assert.equal(expired.tier, "free");
  assert.equal(expired.lifecycle_state, "expired");
  assert.deepEqual(expired.source_kinds, ["legacy_compat"]);

  for (const incoherent of [
    { tier: "plus", entitled: false, lifecycle_state: "active", effective_expires_at: LATER, first_subscribed_at: ISO, source_kinds: ["apple"] },
    { tier: "plus", entitled: true, lifecycle_state: "active", effective_expires_at: null, first_subscribed_at: ISO, source_kinds: ["apple"] },
    { tier: "plus", entitled: true, lifecycle_state: "active", effective_expires_at: LATER, first_subscribed_at: ISO, source_kinds: [] },
    { tier: "free", entitled: false, lifecycle_state: "active", effective_expires_at: null, first_subscribed_at: ISO, source_kinds: ["apple"] },
    { tier: "free", entitled: false, lifecycle_state: "none", effective_expires_at: null, first_subscribed_at: null, source_kinds: ["apple"] },
    { tier: "free", entitled: false, lifecycle_state: "scheduled", effective_expires_at: null, first_subscribed_at: ISO, source_kinds: [] },
    { tier: "free", entitled: false, lifecycle_state: "unavailable", effective_expires_at: null, first_subscribed_at: null, source_kinds: [] },
  ]) {
    assert.deepEqual(membershipListSummary(incoherent), {
      tier: "unknown",
      entitled: false,
      lifecycle_state: "unavailable",
      effective_expires_at: null,
      first_subscribed_at: null,
      source_kinds: [],
    });
  }
});

test("membership list instants are rendered as explicit UTC rather than operator-local time", () => {
  assert.equal(membershipUtcInstant("2026-08-15T12:34:56Z"), "2026-08-15 12:34:56 UTC");
  assert.equal(membershipUtcInstant(null), null);
  assert.equal(membershipUtcInstant("2026-08-15T12:34:56+02:00"), null);
  assert.equal(membershipUtcInstant("not-an-instant"), null);
});

test("grant preview requires the exact revisioned schedule shape", () => {
  const preview = membershipGrantPreview({
    schema_version: 1,
    uid: 123,
    server_time: ISO,
    current_grant_revision: 4,
    current_effective_expires_at: LATER,
    schedule: {
      tier: "plus",
      preset_id: "plus_month",
      start_mode: "extend",
      base_at: LATER,
      starts_at: ISO,
      expires_at: "2026-10-15T12:00:00Z",
      status: "active",
    },
    store_overlap: true,
    resulting_effective_expires_at: "2026-10-15T12:00:00Z",
  });
  assert.ok(preview);
  assert.equal(preview.current_grant_revision, 4);
  assert.equal(preview.store_overlap, true);
  assert.equal(membershipGrantPreview({ ...preview, schema_version: 2 }), null);
});

test("membership bridge actions mirror Core's read/write/owner gates", () => {
  assert.equal(adminActionAccess("membership_configuration"), "read");
  assert.equal(adminActionAccess("membership_user_detail"), "read");
  assert.equal(adminActionAccess("save_membership_configuration"), "write");
  assert.equal(adminActionAccess("membership_admin_grant_preview"), "write");
  assert.equal(adminActionAccess("membership_admin_grant"), "write");
  assert.equal(adminActionAccess("membership_admin_grant_update"), "write");
  assert.equal(adminActionAccess("membership_admin_grant_revoke"), "owner");
});

test("store evidence distinguishes verification, contribution, and ambiguous drift", () => {
  const detail = membershipUserDetail(userDetailFixture());
  assert.ok(detail);
  const store = detail.store_sources[0];
  assert.ok(store);

  assert.equal(membershipStoreContribution(
    store,
    detail.effective_membership.sources,
    detail.store_sources,
  ), true);
  assert.equal(membershipStoreContribution(
    { ...store, verification_status: "pending" },
    detail.effective_membership.sources,
    detail.store_sources,
  ), false, "unverified evidence can never be presented as contributing");
  assert.equal(membershipStoreContribution(
    store,
    detail.effective_membership.sources.map((source) => ({ ...source, contributes_to_access: false })),
    detail.store_sources,
  ), false, "a matched terminal/non-contributing source stays visibly non-contributing");
  assert.equal(membershipStoreContribution(
    store,
    [...detail.effective_membership.sources, ...detail.effective_membership.sources],
    detail.store_sources,
  ), null, "an ambiguous match fails closed to unknown");
  assert.equal(membershipStoreContribution(
    store,
    detail.effective_membership.sources,
    [...detail.store_sources, { ...store }],
  ), null, "duplicate retained evidence cannot be attributed to one projected source");
});

test("the operator catalogue keeps non-empty Google products beside Apple", () => {
  const parsed = membershipConfiguration(configurationFixture());
  assert.ok(parsed);
  parsed.store_products.google.push({
    product_id: "friending_plus",
    tier: "plus",
    period: "P1M",
  });
  const rows = membershipStoreProductRows(parsed);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.at(-1), {
    platform: "google",
    product_id: "friending_plus",
    tier: "plus",
    period: "P1M",
  });

  const page = readFileSync(new URL("../app/(dashboard)/membership/page.tsx", import.meta.url), "utf8");
  assert.match(page, /membershipStoreProductRows\(catalogue\)/);
  assert.match(page, /products\.platforms\.\$\{product\.platform\}/);
});

test("the plan editor wires dirty guards, full validation, and draft previews", () => {
  const page = readFileSync(new URL("../app/(dashboard)/membership/page.tsx", import.meta.url), "utf8");
  assert.match(page, /membershipPlanIsDirty\(catalogue\.configuration, draft\)/);
  assert.match(page, /window\.addEventListener\("beforeunload", guard\)/);
  assert.match(page, /document\.addEventListener\("click", guard, true\)/);
  assert.match(page, /closest<HTMLAnchorElement>\("a\[href\]"\)/);
  assert.match(page, /anchor\.hasAttribute\("download"\)/);
  assert.match(page, /event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/);
  assert.match(page, /window\.confirm\(t\("dirty\.leaveConfirm"\)\)/);
  assert.match(page, /membershipPlanValidationIssues\(draft, catalogue\.bounds\)/);
  assert.match(page, /validationIssues\.map/);
  assert.match(page, /membershipPlanPreview\(draft\)/);
  assert.match(page, /planPreview\.tiers\.map/);
  assert.match(page, /planPreview\.presets\.map/);
  assert.match(page, /errorKey === "configurationConflict"[\s\S]*adopt\(response\?\.data\)/);
  assert.doesNotMatch(page, /saveError[\s\S]*\{ code:/);
});

test("expiry edits are classified before choosing the confirmation strength", () => {
  assert.equal(membershipExpiryChange(LATER, "2026-09-01T12:00:00Z"), "shorten");
  assert.equal(membershipExpiryChange(LATER, "2026-10-01T12:00:00Z"), "extend");
  assert.equal(membershipExpiryChange(LATER, LATER), "unchanged");
  assert.equal(membershipExpiryChange(LATER, null), "invalid");
});

test("the user panel renders truthful owner detail and stronger warning paths", () => {
  const panel = readFileSync(new URL("../components/UserMembershipPanel.tsx", import.meta.url), "utf8");
  for (const field of [
    "effective_starts_at",
    "effective_expires_at",
    "next_transition_at",
    "status.capabilities",
    "status.badge",
    "quota.remaining",
    "quota.reset_at",
    "source.verification_status",
    "source.current_period_started_at",
    "source.grace_expires_at",
    "source.base_plan_id",
    "currentGrant.created_by",
    "currentGrant.updated_at",
  ]) {
    assert.equal(panel.includes(field), true, `${field} must remain visible in the operator panel`);
  }
  assert.match(panel, /membershipStoreContribution\([\s\S]*source,[\s\S]*status\.sources,[\s\S]*detail\.store_sources/);
  assert.match(panel, /grant\.overlapConfirm/);
  assert.match(panel, /expiryShortenConfirm/);
  assert.match(panel, /membershipActionErrorKey\("grant_create"/);
  assert.match(panel, /membershipActionErrorKey\("expiry_update"/);
  assert.match(panel, /membershipActionErrorKey\("grant_revoke"/);
  assert.doesNotMatch(panel, /actionError[\s\S]*code/);
  assert.match(panel, /response\?\.success === true \? normalizeAdminRole\(response\.role\) : ""/);
  assert.match(panel, /adminAccess === "loading" \? <LoadingPanel \/> : adminAccess === "error" \? \(/);
  assert.match(panel, /<ErrorPanel message=\{t\("accessUnavailable"\)\}/);
  assert.match(panel, /if \(status\.lifecycle_state === "unavailable"\) \{/);
  const unavailableBranch = panel.indexOf('if (status.lifecycle_state === "unavailable")');
  const emptyStoreFinding = panel.indexOf('t("store.none")');
  const emptyHistoryFinding = panel.indexOf('t("history.none")');
  assert.ok(unavailableBranch >= 0 && unavailableBranch < emptyStoreFinding && unavailableBranch < emptyHistoryFinding);

  const english = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hungarian = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  assert.equal(english.membershipUser.store.title, "Store evidence");
  assert.match(english.membershipUser.store.copy, /verification/);
  assert.doesNotMatch(english.membershipUser.store.title, /Verified/);
  assert.equal(
    english.membershipUser.firstSubscribed,
    "Earliest membership source",
    "the aggregate timestamp must not be mislabeled as a verified payment",
  );
  assert.match(english.membershipUser.history.copy, /100/);
  assert.match(hungarian.membershipUser.history.copy, /100/);
  assert.match(english.membershipUser.accessUnavailable, /could not be verified/);
  assert.match(hungarian.membershipUser.accessUnavailable, /nem sikerült ellenőrizni/);
  for (const messages of [english.membershipErrors, hungarian.membershipErrors]) {
    assert.equal(Object.values(messages).some((value) => String(value).includes("{code}")), false);
    assert.equal(typeof messages.unknown, "string");
    assert.ok(messages.unknown.length > 0);
  }
});

test("Registered Users renders server-paged membership truth without inventing local filters", () => {
  const page = readFileSync(new URL("../app/(dashboard)/users/page.tsx", import.meta.url), "utf8");
  assert.match(page, /membershipListSummary\(row\.membership\)/);
  assert.match(page, /membershipUtcInstant\(membership\.effective_expires_at\)/);
  assert.match(page, /states\.\$\{membership\.lifecycle_state\}/);
  assert.match(page, /membership\.source_kinds\.map/);
  assert.match(page, /membershipExpiryUtc/);
  assert.match(page, /membershipEarliestSourceUtc/);
  assert.doesNotMatch(page, /membershipSince|membershipUntil/);
  assert.doesNotMatch(page, /membership_tier|membership_lifecycle|membership_source|membership_expires_/);

  const english = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hungarian = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8"));
  assert.match(english.users.membershipExpiryUtc, /UTC/);
  assert.match(hungarian.users.membershipExpiryUtc, /UTC/);
  assert.match(english.users.membershipSummaryNote, /does not prove a verified Store purchase/);
  assert.match(hungarian.users.membershipSummaryNote, /nem bizonyít ellenőrzött Store-vásárlást/);
  assert.deepEqual(Object.keys(english.users.membershipSources), [
    "apple",
    "google",
    "admin_grant",
    "legacy_compat",
  ]);
  assert.deepEqual(Object.keys(hungarian.users.membershipSources), Object.keys(english.users.membershipSources));
});

test("global membership filters and paid-versus-granted dates stay blocked on an explicit Core contract", () => {
  const contract = readFileSync(
    new URL("../docs/membership-registered-users-core-requirements.md", import.meta.url),
    "utf8",
  );
  for (const requirement of [
    "membership_tier",
    "membership_lifecycle",
    "membership_source",
    "membership_expiry",
    "membership_expires_from",
    "membership_expires_before",
    "effective_starts_at",
    "first_verified_store_purchase_at",
    "first_granted_at",
    "legacy_compat_started_at",
  ]) {
    assert.equal(contract.includes(`\`${requirement}\``), true, `${requirement} contract is undocumented`);
  }
  assert.match(contract, /before `total`, sort, skip and limit/);
  assert.match(contract, /must not emulate it by filtering or sorting the 25 already-returned rows/);
  assert.match(contract, /not proof of a verified payment/);
});

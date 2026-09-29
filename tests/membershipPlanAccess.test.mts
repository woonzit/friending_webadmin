import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  MembershipCapabilityTable,
  MembershipPlanAccessNotice,
  MembershipQuotaTable,
} from "../components/MembershipPlanEditor.tsx";
import {
  membershipActionErrorKey,
  membershipConfiguration,
  membershipMutationOutcome,
  membershipPlanEditAccess,
  type MembershipConfiguration,
  type MembershipPlanEditAccess,
} from "../lib/membership.ts";

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function catalogue(ready: boolean): MembershipConfiguration {
  const parsed = membershipConfiguration({
    configuration: {
      _id: "membership_v1",
      schema_version: 1,
      revision: 3,
      ready_for_enforcement: ready,
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
    rollout: { projection_writes_enabled: false, feature_enforcement_enabled: false, legacy_compat_enabled: true },
    store_products: {
      apple: [{ product_id: "com.friending.app.subscription1m", tier: "plus", period: "P1M" }],
      google: [],
    },
  });
  assert.ok(parsed);
  return parsed;
}

function render(locale: "en" | "hu", element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale],
    timeZone: "UTC",
    onError: (error: Error) => { throw error; },
  }, element));
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function editor(ready: boolean, editable: boolean): string {
  const value = catalogue(ready);
  const noop = () => undefined;
  return render("en", createElement("div", null,
    createElement(MembershipCapabilityTable, { draft: value.configuration, editable, onChange: noop }),
    createElement(MembershipQuotaTable, {
      draft: value.configuration, bounds: value.bounds, editable, validationIssues: [], onMode: noop, onValue: noop,
    }),
  ));
}

test("edit access follows the role and the STORED plan's readiness", () => {
  const draftPlan = catalogue(false).configuration;
  const livePlan = catalogue(true).configuration;
  const matrix: Array<[string, boolean, MembershipPlanEditAccess]> = [
    ["owner", false, "owner"],
    ["owner", true, "owner"],
    ["admin", false, "editor"],
    ["admin", true, "liveOwnerOnly"],
    ["viewer", false, "readOnly"],
    ["viewer", true, "liveOwnerOnly"],
    ["", false, "readOnly"],
    ["Owner", false, "readOnly"],
  ];
  for (const [role, ready, expected] of matrix) {
    assert.equal(membershipPlanEditAccess(role, ready ? livePlan : draftPlan), expected, `${role} / ready=${ready}`);
  }
});

test("Core's live-plan refusal is a definite, named refusal", () => {
  assert.equal(membershipActionErrorKey("configuration_save", "membership-configuration-owner-required"), "planLiveOwnerRequired");
  assert.equal(
    membershipMutationOutcome("configuration_save", { success: false, error: "membership-configuration-owner-required" }, false),
    "refused",
    "nothing was written: it is never reconciled as an unknown outcome",
  );
  for (const locale of ["en", "hu"] as const) {
    const errors = MESSAGES[locale].membershipErrors;
    assert.equal(typeof errors.planLiveOwnerRequired, "string");
    assert.equal(typeof errors.planLiveOwnerRequiredAdopted, "string");
    assert.notEqual(errors.planLiveOwnerRequired, errors.ownerRequired);
  }
});

test("the notice explains the lock in both locales, and only for liveOwnerOnly", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].membershipConfig.liveLock;
    const html = render(locale, createElement(MembershipPlanAccessNotice, { access: "liveOwnerOnly" }));
    assert.ok(html.includes(escaped(copy.title)));
    assert.ok(html.includes(escaped(copy.copy)));
    assert.match(html, /data-plan-access="liveOwnerOnly"/);
    for (const access of ["owner", "editor", "readOnly"] as const) {
      assert.equal(render(locale, createElement(MembershipPlanAccessNotice, { access })), "", access);
    }
  }
});

test("a locked editor disables every switch, select and value input; an editable one none", () => {
  const locked = editor(true, false);
  const controls = [...locked.matchAll(/<(input|select)\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(controls.length >= 3 * 2 + 4 * 2, "every capability switch and quota control renders");
  for (const control of controls) assert.match(control, /disabled=""/, control);
  const open = editor(false, true);
  assert.doesNotMatch(open, /disabled=""/);
});

test("the Membership page derives access from the stored plan and reloads the plan on Core's refusal", async () => {
  const page = await readFile(new URL("../app/(dashboard)/membership/page.tsx", import.meta.url), "utf8");
  assert.equal([...page.matchAll(/membershipPlanEditAccess\(adminRole, catalogue\.configuration\)/g)].length, 2);
  assert.doesNotMatch(page, /membershipPlanEditAccess\([^)]*draft/);
  assert.match(page, /const planEditable = access === "owner" \|\| access === "editor";/);
  assert.match(page, /const saveDisabled = saving \|\| !planEditable \|\| !dirty \|\| validationIssues\.length > 0;/);
  assert.match(page, /<MembershipPlanAccessNotice access=\{access\} \/>/);
  assert.match(page, /<MembershipCapabilityTable draft=\{draft\} editable=\{planEditable\} onChange=\{capability\} \/>/);
  assert.match(page, /editable=\{planEditable\}\s*validationIssues=\{validationIssues\}/);
  assert.match(page, /if \(access === "liveOwnerOnly"\) \{\s*setNotice\(\{ tone: "error", text: membershipErrors\("planLiveOwnerRequired"\) \}\);\s*return;/);
  assert.match(page, /errorKey === "planLiveOwnerRequired"\) \{\s*const liveAdopted = adopt\(response\?\.data\);/);
  assert.match(page, /liveAdopted \? "planLiveOwnerRequiredAdopted" : "planLiveOwnerRequired"/);
  // The readiness marker stays owner-only in every state.
  assert.match(page, /<input type="checkbox" disabled=\{!owner\} checked=\{draft\.ready_for_enforcement\}/);
  assert.doesNotMatch(page, /disabled=\{!editor\}/);
});

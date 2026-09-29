import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import UserMembershipPanel from "../components/UserMembershipPanel.tsx";
import {
  MEMBERSHIP_CAPABILITIES,
  MEMBERSHIP_QUOTAS,
  membershipLiveAccess,
  membershipLiveQuickPhrases,
  membershipUserDetail,
  unavailableMembershipUserDetail,
  type MembershipLiveAccess,
} from "../lib/membership.ts";

/**
 * Core's live_access capture for P-100 Part B, copied byte-identical from Core fe97dec8, the last
 * Core main commit touching tests/fixtures/membership_live_access_wire.json
 * (`membership_gate_reads_storage_test.php --write`): the block MembershipAdminService::userDetail
 * adds for a legacy FREE member, a legacy PLUS member by administrator grant, an enforced FREE
 * member with a moderator footprint ceiling of 2, an enforced PLUS member and the deny mode.
 */
const FIXTURE = new URL("./fixtures/membership_live_access_wire.json", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "fe97dec87ec4037abb1a49cda9f669ed0dbbfb97";
const FIXTURE_SHA256 = "f05656440f27e8a03d7922449893286b6969a0c755028222460fbe775fa6a76b";

type Json = Record<string, any>;
const corpus = JSON.parse(await readFile(FIXTURE, "utf8")) as Json;
const blocks = corpus.live_access as Record<string, Json>;

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

const ISO = "2026-08-15T12:00:00Z";
const LATER = "2026-09-15T12:00:00Z";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A membership_user_detail body; `live` is added only when given. */
function detailWire(live?: unknown): Json {
  const wire: Json = {
    schema_version: 1,
    uid: 123,
    effective_membership: {
      schema_version: 1,
      tier: "free",
      entitled: false,
      lifecycle_state: "none",
      effective_starts_at: null,
      effective_expires_at: null,
      next_transition_at: null,
      first_subscribed_at: null,
      sources: [],
      revision: 0,
      server_time: ISO,
      configuration_revision: 3,
      configuration_ready_for_enforcement: false,
      capabilities: { invisible_presence: false, hide_profile_visit: false, vip_badge: false, quick_phrases: false },
      quotas: {
        footprint_send: { scope: "utc_day", mode: "finite", used: 0, limit: 5, remaining: 5, reset_at: LATER },
        pinger_send: { scope: "utc_day", mode: "finite", used: 0, limit: 0, remaining: 0, reset_at: LATER },
        private_album_access: { scope: "concurrent", mode: "finite", used: 1, limit: 0, remaining: 0 },
        quick_phrase_slots: { scope: "concurrent", mode: "disabled", used: 0 },
      },
      badge: { eligible: false, hidden: false, visible: false },
    },
    store_sources: [],
    admin_grant: null,
    history: [],
  };
  if (live !== undefined) wire.live_access = live;
  return wire;
}

function renderPanel(locale: "en" | "hu", live?: unknown): string {
  const detail = membershipUserDetail(detailWire(live));
  assert.ok(detail);
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale],
    timeZone: "UTC",
    onError: (error: Error) => { throw error; },
  }, createElement(UserMembershipPanel, { uid: 123, initial: detail })));
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function present(value: unknown): MembershipLiveAccess {
  const read = membershipLiveAccess(value);
  assert.equal(read.state, "present");
  return (read as { state: "present"; access: MembershipLiveAccess }).access;
}

test("the vendored capture is byte-identical to Core's", async () => {
  assert.equal(createHash("sha256").update(await readFile(FIXTURE)).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/membership_live_access_wire.json must stay byte-identical to Core ${FIXTURE_SOURCE_COMMIT}`);
  assert.deepEqual(corpus.rollout_modes, ["legacy", "enforced", "deny"]);
  assert.deepEqual(corpus.routes, ["/v1/webadmin/membership_user_detail", "/v1/webadmin/user_detail"]);
});

test("every captured block decodes exactly, per-day quotas with their reset and concurrent ones without", () => {
  for (const [name, block] of Object.entries(blocks)) {
    const access = present(block);
    assert.equal(access.rollout_mode, block.rollout_mode, name);
    assert.equal(access.quick_phrases_available, block.quick_phrases_available, name);
    assert.deepEqual(access.capabilities, block.capabilities, name);
    assert.deepEqual(Object.keys(access.quotas), [...MEMBERSHIP_QUOTAS], name);
    for (const key of MEMBERSHIP_QUOTAS) {
      assert.deepEqual(access.quotas[key], { reset_at: null, ...block.quotas[key] }, `${name}.${key}`);
    }
  }
  const ceiling = present(blocks["enforced-free-ceiling-2"]);
  assert.equal(ceiling.quotas.footprint_send.limit, 2, "the moderator's ceiling shows");
  const legacy = present(blocks["legacy-free"]);
  assert.equal(legacy.quotas.footprint_send.enforced, false, "the legacy path is marked");
  assert.equal(legacy.quotas.quick_phrase_slots.enforced, true, "quick phrases follow the plan in every mode");
});

test("saved chat phrases right now: the server switch, then Core's eligibility rule", () => {
  assert.equal(membershipLiveQuickPhrases(present(blocks["legacy-free"])), "disabled");
  assert.equal(membershipLiveQuickPhrases(present(blocks["legacy-plus-admin-grant"])), "enabled");
  const off = clone(blocks["legacy-plus-admin-grant"]);
  off.quick_phrases_available = false;
  assert.equal(membershipLiveQuickPhrases(present(off)), "unavailable");
  const zero = clone(blocks["enforced-plus"]);
  zero.quotas.quick_phrase_slots = { ...zero.quotas.quick_phrase_slots, limit: 0, remaining: 0 };
  assert.equal(membershipLiveQuickPhrases(present(zero)), "disabled");
});

test("absent is unknown, a malformed block is invalid, and neither fails the member detail", () => {
  assert.deepEqual(membershipLiveAccess(undefined), { state: "absent" });
  assert.deepEqual(membershipUserDetail(detailWire())?.live_access, { state: "absent" });
  assert.deepEqual(unavailableMembershipUserDetail(123).live_access, { state: "absent" });
  assert.equal(membershipUserDetail(detailWire(blocks["enforced-plus"]))?.live_access.state, "present");

  const variants: Array<[string, (block: Json) => void]> = [
    ["rollout mode", (block) => { block.rollout_mode = "shadow"; }],
    ["switch type", (block) => { block.quick_phrases_available = "true"; }],
    ["missing capability", (block) => { delete block.capabilities.vip_badge; }],
    ["capability type", (block) => { block.capabilities.vip_badge = 1; }],
    ["missing quota", (block) => { delete block.quotas.pinger_send; }],
    ["wrong scope", (block) => { block.quotas.private_album_access.scope = "utc_day"; }],
    ["mode", (block) => { block.quotas.pinger_send.mode = "capped"; }],
    ["remaining disagrees", (block) => { block.quotas.footprint_send.remaining = 19; }],
    ["negative used", (block) => { block.quotas.footprint_send.used = -1; }],
    ["string limit", (block) => { block.quotas.footprint_send.limit = "20"; }],
    ["limit on unlimited", (block) => { block.quotas.pinger_send.limit = 5; }],
    ["per-day quota without reset", (block) => { delete block.quotas.footprint_send.reset_at; }],
    ["concurrent quota with reset", (block) => { block.quotas.quick_phrase_slots.reset_at = LATER; }],
    ["reset not an instant", (block) => { block.quotas.pinger_send.reset_at = "tomorrow"; }],
    ["enforced type", (block) => { block.quotas.pinger_send.enforced = "true"; }],
  ];
  for (const [why, change] of variants) {
    const block = clone(blocks["enforced-plus"]);
    change(block);
    assert.deepEqual(membershipLiveAccess(block), { state: "invalid" }, why);
    const detail = membershipUserDetail(detailWire(block));
    assert.ok(detail, `${why}: the rest of the member detail still loads`);
    assert.deepEqual(detail.live_access, { state: "invalid" }, why);
  }
  for (const value of [null, [], "legacy", 1]) {
    assert.deepEqual(membershipLiveAccess(value), { state: "invalid" }, JSON.stringify(value));
  }
});

test("with live access the panel shows Right now beside the saved plan and Core's own rollout", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].membershipUser;
    const legacy = renderPanel(locale, blocks["legacy-plus-admin-grant"]);
    assert.ok(legacy.includes(escaped(copy.live.rollout.legacy)));
    assert.match(legacy, /data-live-rollout-state="legacy"/);
    assert.doesNotMatch(legacy, /data-rollout-state=/, "the inference banner is replaced");
    assert.match(legacy, /data-plan-label="legacy"/, "the saved plan is labeled with Core's mode at once");
    assert.ok(legacy.includes(escaped(copy.capabilities.titleLive)));
    // The saved plan says FREE has nothing; the member really has PLUS by an administrator grant.
    for (const key of MEMBERSHIP_CAPABILITIES) {
      assert.match(legacy, new RegExp(`data-live-capability="${key}" data-live-value="enabled"`), key);
    }
    assert.match(legacy, /data-live-capability="quick_phrases" data-live-value="enabled"/);
    for (const key of MEMBERSHIP_QUOTAS) assert.match(legacy, new RegExp(`data-live-quota="${key}"`), key);
    assert.match(legacy, /data-live-quota="footprint_send" data-live-enforced="false"/);
    assert.match(legacy, /data-live-quota="quick_phrase_slots" data-live-enforced="true"/);
    assert.ok(legacy.includes(escaped(copy.live.legacyRule)));
    assert.ok(legacy.includes(escaped(copy.live.planRule)));

    const enforced = renderPanel(locale, blocks["enforced-free-ceiling-2"]);
    assert.ok(enforced.includes(escaped(copy.live.rollout.enforced)));
    assert.match(enforced, /data-live-capability="vip_badge" data-live-value="disabled"/);
    assert.doesNotMatch(enforced, /data-live-enforced="false"/);

    const deny = renderPanel(locale, blocks["deny-free"]);
    assert.ok(deny.includes(escaped(copy.live.rollout.deny)));
    assert.match(deny, /role="alert" data-live-rollout-state="deny"/);

    const off = clone(blocks["legacy-plus-admin-grant"]);
    off.quick_phrases_available = false;
    const switchedOff = renderPanel(locale, off);
    assert.match(switchedOff, /data-live-capability="quick_phrases" data-live-value="unavailable"/);
    assert.ok(switchedOff.includes(escaped(copy.live.quickPhrasesOff)));
  }
});

test("without live access the Part A inference stays; a malformed block says so", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].membershipUser;
    const absent = renderPanel(locale);
    assert.doesNotMatch(absent, /data-live-/u, "nothing live is claimed");
    assert.ok(absent.includes(escaped(copy.capabilities.title)));
    assert.doesNotMatch(absent, /data-rollout-state|data-plan-label/, "the inference waits for Core's configuration read");

    const block = clone(blocks["enforced-plus"]);
    block.rollout_mode = "shadow";
    const invalid = renderPanel(locale, block);
    assert.match(invalid, /data-live-access="invalid"/);
    assert.ok(invalid.includes(escaped(copy.live.invalid)));
    assert.doesNotMatch(invalid, /data-live-capability|data-live-quota|data-live-rollout-state/);
  }
});

test("the configuration read runs only while Core sends no live access", async () => {
  const panel = await readFile(new URL("../components/UserMembershipPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /const liveAccessPresent = detail\.live_access\.state === "present";/);
  assert.match(panel, /if \(!liveAccessPresent\) void loadRollout\(\);\s*\}, \[liveAccessPresent, loadRollout\]\);/);
  assert.match(panel, /setNotice\(null\);\s*if \(!liveAccessPresent\) void loadRollout\(\);/);
  assert.match(panel, /const shownRollout: RolloutState = live \? live\.rollout_mode : rollout;/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import AdminMembershipNotice from "../components/AdminMembershipNotice.tsx";
import { createAdminMembershipRecovery, type MembershipRecoveryAnswer } from "../lib/adminMembershipRecovery.ts";
import { membershipClock } from "./support/adminMembershipClock.mts";
import { MEMBERSHIP_CASES } from "./support/adminMembershipCases.mts";
import { serverModule, sessionHarness } from "./support/adminMembershipServerHarness.mts";

// Actual server pages/layout and session classifier. Presentation/Next control
// adapters are DERIVED: this is not a mounted Next/RSC browser claim.
const paths = ["app/(dashboard)/layout.tsx", "app/login/page.tsx", "app/(dashboard)/persona/page.tsx", "app/(dashboard)/verification/page.tsx",
  "app/(dashboard)/audience-visibility/page.tsx", "app/(dashboard)/text-moderation/page.tsx", "app/(frames)/appearance-map/page.tsx"];
class Navigation extends Error { constructor(readonly target: string) { super(target); } }
const neutral = () => createElement("section", { "data-membership": "unconfirmed" }, "DERIVED neutral presentation");
const shell = ({ children }: { children: React.ReactNode }) => createElement("main", {}, children);

for (const row of MEMBERSHIP_CASES) test(`DERIVED server render gate / every adminMe caller: ${row.name}`, async () => {
  for (const path of paths) {
    const h = await sessionHarness(row);
    const module = await serverModule(path, { adminMe: () => h.api.adminMe(h.controller.signal), AdminMembershipUnconfirmedError: h.api.AdminMembershipUnconfirmedError,
      Shell: shell, AdminMembershipUnavailable: neutral, LoginForm: () => createElement("form", {}, "PUBLIC_LOGIN"),
      PersonaAdminConsole: () => createElement("div", {}, "PROTECTED_CONSOLE"), VerificationAdminConsole: () => createElement("div", {}, "PROTECTED_CONSOLE"),
      AudienceVisibilityAdminConsole: () => createElement("div", {}, "PROTECTED_CONSOLE"), ProfileTextModerationConsole: () => createElement("div", {}, "PROTECTED_CONSOLE"),
      AppearanceMapFrame: () => createElement("div", {}, "PROTECTED_MAP"), PROFILE_TEXT_MODERATION_CONTRACT_READY: true,
      redirect: (target: string) => { throw new Navigation(target); }, notFound: () => { throw new Navigation("not-found"); },
      getLocale: async () => "en", getTranslations: async () => () => "public refusal copy" });
    let element: React.ReactElement | undefined, navigation: Navigation | undefined;
    try { element = await module.default({ children: createElement("div", {}, "PROTECTED_CHILD"), searchParams: Promise.resolve({}) }); }
    catch (error) { assert.ok(error instanceof Navigation, path); navigation = error; }
    assert.equal(h.calls.length, 1, `${path}: fresh membership, no last-known-good grant`);
    if (row.kind === "unconfirmed") {
      assert.equal(navigation, undefined, `${path}: an outage is not a redirect/404`); assert.equal(element?.type, neutral);
      assert.deepEqual(Object.keys(element!.props), ["checkId"], "only an opaque presentation id crosses the neutral render boundary");
      assert.match(element!.props.checkId, /^[a-f0-9-]{36}$/);
      const html = renderToStaticMarkup(element!); assert.match(html, /data-membership="unconfirmed"/); assert.doesNotMatch(html, /PROTECTED_|PUBLIC_LOGIN/);
    } else if (row.kind === "revoked") {
      if (path.includes("layout")) assert.equal(navigation?.target, "/login");
      else if (path.includes("login")) assert.ok(renderToStaticMarkup(element!).includes("PUBLIC_LOGIN"));
      else if (path.includes("appearance-map")) assert.doesNotMatch(renderToStaticMarkup(element!), /PROTECTED_MAP/);
      else assert.equal(navigation?.target, "not-found");
    } else {
      if (path.includes("layout")) assert.ok(renderToStaticMarkup(element!).includes("PROTECTED_CHILD"));
      else if (path.includes("login")) assert.equal(navigation?.target, "/");
      else if (path.includes("appearance-map")) assert.ok(renderToStaticMarkup(element!).includes("PROTECTED_MAP"));
      else assert.equal(navigation?.target, "not-found", "membership alone never invents the missing feature capability");
    }
  }
});
test("DERIVED layout: an absent signed session redirects as before and does not query Core", async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]); h.state.token = "";
  const module = await serverModule(paths[0], { adminMe: h.api.adminMe, AdminMembershipUnconfirmedError: h.api.AdminMembershipUnconfirmedError,
      AdminMembershipUnavailable: neutral, Shell: shell, redirect: (target: string) => { throw new Navigation(target); } });
  await assert.rejects(module.default({ children: "PROTECTED_CHILD" }), (error: unknown) => error instanceof Navigation && error.target === "/login");
  assert.equal(h.calls.length, 0);
});
test("DERIVED neutral recovery effect: a later unconfirmed server result restarts backoff after an earlier positive probe; no editor refresh exists here", async () => {
  const time = membershipClock(); let answer: MembershipRecoveryAnswer = "confirmed", refreshes = 0;
  const recovery = createAdminMembershipRecovery(async () => answer, () => assert.fail("no revocation supplied"), time.clock);
  const effects: { job: () => () => void; deps: unknown[] }[] = [];
  const module = await serverModule("components/AdminMembershipUnavailable.tsx", { adminMembershipRecovery: recovery, AdminMembershipNotice,
    useRouter: () => ({ refresh: () => { refreshes++; } }), useTranslations: () => () => "DERIVED public copy",
    useEffect: (job: () => () => void, deps: unknown[]) => effects.push({ job, deps }) });
  module.default({ checkId: "derived-first-server-render" }); const release = effects[0].job();
  assert.equal(recovery.getSnapshot(), true); await time.tick(); assert.equal(refreshes, 1); assert.equal(recovery.getSnapshot(), false);
  release(); answer = "unconfirmed";
  module.default({ checkId: "derived-second-server-render" }); const secondRelease = effects[1].job();
  assert.notEqual(effects[0].deps[0], effects[1].deps[0]); await time.tick();
  assert.equal(recovery.getSnapshot(), true); assert.equal(refreshes, 1); assert.equal(time.jobs.size, 1); secondRelease();
});
for (const locale of ["en", "hu"]) test(`DERIVED static neutral render ${locale}: only public brand and membership recovery copy; no identity or page children`, async () => {
  const module = await serverModule("components/AdminMembershipUnavailable.tsx", { adminMembershipRecovery: createAdminMembershipRecovery(async () => "unconfirmed", () => {}),
    AdminMembershipNotice, useRouter: () => ({ refresh: () => assert.fail("SSR effects do not run") }), useEffect, useTranslations });
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" }, createElement(module.default, { checkId: "derived-opaque-render-id" })));
  assert.match(html, /data-membership="unconfirmed"/); assert.ok(html.includes(messages.adminMembership.title));
  assert.doesNotMatch(html, /operator@example|PROTECTED_|login|derived-opaque-render-id/);
});

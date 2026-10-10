import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_HELP_PAGES,
  ADMIN_HELP_REDIRECTS,
  adminHelpGuideForPath,
  adminHelpPageForPath,
  adminHelpSections,
  type AdminHelpConsoleReadiness,
} from "../lib/adminHelp.ts";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  FEATURE_SWITCHES_CONTRACT_READY,
  PERSONA_START_EDITOR_VISIBLE,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "../lib/contractReadiness.ts";
import { APP_REVIEW_CHECK_KEYS, APP_REVIEW_COUNT_KEYS } from "../lib/appReviewSandbox.ts";

type JsonObject = Record<string, unknown>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function record(value: unknown, label: string): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

function nonEmpty(value: unknown, label: string, minimumLength = 1): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const result = String(value).trim();
  assert.ok(result.length >= minimumLength, `${label} must be detailed`);
  return result;
}

async function pageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(target);
    return entry.isFile() && entry.name === "page.tsx" ? [target] : [];
  }));
  return nested.flat();
}

function routeForPageFile(file: string): string {
  const relative = path.relative(path.join(root, "app", "(dashboard)"), file);
  const directory = path.dirname(relative).split(path.sep).join("/");
  return directory === "." ? "/" : `/${directory}`;
}

function examplePath(route: string): string {
  return route.replace(/\[[^\]]+\]/g, "example-id");
}

test("all authenticated routes have a live guide or an explicit redirect to one", async () => {
  const files = await pageFiles(path.join(root, "app", "(dashboard)"));
  const actualRoutes = files.map(routeForPageFile).sort();
  const helpRoutes = [
    ...ADMIN_HELP_PAGES.map((page) => page.route),
    ...ADMIN_HELP_REDIRECTS.map((entry) => entry.route),
  ].sort();

  // 39: 41 with T-468's Appearance & placements page (the map document lives
  // outside the dashboard shell), minus the two T-565 retired ones. T-683 adds
  // the into-tag moderation queue (40). T-863 splits the census: the two
  // redirect-only D-052 routes (/heroes, /app-landing) no longer carry guides of
  // their own, so 38 live guides plus 2 redirects. T-865 P1 adds the external
  // events list, create and detail screens: 41 live guides plus 2 redirects.
  // T-865 P2a adds the intake queue, the intake review screen and the AI usage
  // page: 44 live guides plus 2 redirects.
  // T-896 adds Research: 45 live guides plus the same two redirects.
  assert.equal(actualRoutes.length, 47, "the current screen census changed; review every new or removed screen");
  assert.equal(ADMIN_HELP_PAGES.length, 45, "review the live-screen census");
  assert.equal(ADMIN_HELP_REDIRECTS.length, 2, "review the retired-route census");
  assert.deepEqual(helpRoutes, actualRoutes);
  assert.equal(new Set(helpRoutes).size, helpRoutes.length, "a screen may have only one help document");
});

test("retired redirect routes resolve to the live guide and stay redirect-only pages", async () => {
  for (const entry of ADMIN_HELP_REDIRECTS) {
    const destination = ADMIN_HELP_PAGES.find((page) => page.route === entry.destination);
    assert.ok(destination, `${entry.route} must target an inventoried live screen`);
    assert.equal(adminHelpPageForPath(entry.route)?.key, destination.key);
    assert.equal(adminHelpGuideForPath(entry.route, ALL_READY)?.key, destination.key);
    const source = await readFile(path.join(root, "app", "(dashboard)", entry.route.slice(1), "page.tsx"), "utf8");
    assert.ok(source.includes(`redirect("${entry.destination}")`), `${entry.route} must redirect to ${entry.destination}`);
    assert.doesNotMatch(source, /<[^>]+>/, "a redirect route must not silently grow an unreviewed interface");
  }
});

test("exact and dynamic routes resolve to the intended guide and nothing generic", () => {
  for (const page of ADMIN_HELP_PAGES) {
    const resolved = adminHelpPageForPath(examplePath(page.route));
    assert.equal(resolved?.key, page.key, `${page.route} must resolve to ${page.key}`);
  }

  for (const unknown of [
    "/unknown",
    "/users/one/two",
    "/profile-verification/case/evidence",
    "/dates/configuration/extra",
    "/dates/moderation/case/extra",
    "/heroes/extra",
    "/app-landing/extra",
  ]) {
    assert.equal(adminHelpPageForPath(unknown), null, `${unknown} must not receive unrelated help`);
  }
});

test("every inventoried functional section has detailed English and Hungarian help", async () => {
  const totalSections = ADMIN_HELP_PAGES.reduce((sum, page) => sum + page.sections.length, 0);
  // 237 in the combined dormant release: T-218 adds the feature-switch family
  // guidance, and T-219 adds the independent admin-granted verification guide.
  // T-468 adds the eight Appearance & placements sections and T-476 its save/conflict section (246);
  // T-471 adds the forced verification / Waiting Room tab section (247). T-565
  // retires User groups (4) and Layer 2 intents (6) with their pages (237).
  // T-569 documents `AudienceVisibilityUserPanel`, which T-539 opened on
  // /users/<uid> with no guide in either locale (238). T-551 documents the
  // Persona verification-screens console that replaced the T-581 placeholder
  // on /persona (239). T-671 replaces all five signup-options topics with the
  // five composer topics below; T-701 updates the System topic for the third
  // locked question without changing that census, so the total remains 239. T-683 adds
  // the six into-tag moderation topics and one moderation-state topic on
  // /profile-tags, where the item badge and the locked-row refusal now live (246).
  // T-712 adds the D-114 looking-for answer-limits topic, which documents the
  // first WRITE this page performs outside the layout save (247).
  // T-706 adds the Mode switcher cards section on /appearance, where D-115's two
  // operator-editable mode cards live (248). T-723 adds the D-120 soft-off
  // teaser topic on /configuration, the first control on that page that changes
  // what a member SEES while the section stays refused server-side (249). T-757
  // adds the Invite results topic on /invite-configuration, the first panel on
  // that page that renders Core-computed statistics rather than the stored
  // configuration (250). T-863 retires the eleven sections of the two redirect-only
  // guides (/heroes 5, /app-landing 6) and documents eight panels the audit found
  // with no topic: Overview's signup metrics, the photo editor, section
  // availability, the sign-in policy and its allowed phone countries on
  // /configuration, and the landing buttons, footer and QR reader on /appearance
  // (247). T-863 S5 (P-073) adds the location access panel on /configuration, which
  // has its own revision and its own save (248). T-863 S9 (P-101) adds the member
  // topic for restoring PLUS after a re-registration, a support procedure that the
  // membership panel's grant controls carry out (249). T-863 S9 (P-091) adds the
  // new-member welcome message panel on /configuration, saved on its own (250). T-863 S9
  // (P-092) adds the registrations-by-platform panel on the overview (251). T-863 S9
  // (P-058) adds the membership topic on who may change a plan marked ready (252).
  // T-863 S11 (P-007, D-135) adds the gesture photo selfie: the photo-method topic on
  // /verification (with its iOS rollout precondition), the gesture catalogue and photo
  // wording topic on /configuration, and the whole-set photo review on the case page (255).
  // T-865 P1 adds eight sections across external list, create and detail.
  // T-865 P2a adds eleven: "Draft from source" on the external list (1), the
  // intake queue (3), the intake review screen (5) and the AI usage page (2).
  // T-896 adds five research topics and one run-batch topic on the intake queue.
  // The submission system adds two on /dates/configuration: the third-party event pins and the submission leaderboard (282).
  // Friending Start adds the methods panel on /configuration (radar, touch), which has its own revision and its own save (283).
  // The event page's "Content & signals" panel, which shipped with no topic, gets one (284).
  // Host moderation adds the case page's "Host review" section: what the event's host was shown and decided (285).
  assert.equal(totalSections, 285, "review the functional-section census when the UI changes");
  assert.deepEqual(
    ADMIN_HELP_PAGES.find((page) => page.route === "/signup-options")?.sections,
    [
      "systemQuestions",
      "selectionLimits",
      "pageLayout",
      "questionPalette",
      "draftSaving",
      "answersElsewhere",
    ],
    "the signup-options guide must inventory the composer rather than the retired option editor",
  );

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const help = record(messages.adminHelp, `${locale}.adminHelp`);
    const pages = record(help.pages, `${locale}.adminHelp.pages`);

    assert.equal(help.button, "Help", `${locale} must show the literal requested Help label`);
    assert.deepEqual(Object.keys(pages).sort(), ADMIN_HELP_PAGES.map((page) => page.key).sort());

    for (const page of ADMIN_HELP_PAGES) {
      const copy = record(pages[page.key], `${locale}.${page.key}`);
      nonEmpty(copy.title, `${locale}.${page.key}.title`, 8);
      nonEmpty(copy.summary, `${locale}.${page.key}.summary`, 80);

      const steps = record(copy.steps, `${locale}.${page.key}.steps`);
      assert.ok(Object.keys(steps).length >= 3, `${locale}.${page.key} needs a novice workflow`);
      for (const [key, value] of Object.entries(steps)) {
        nonEmpty(value, `${locale}.${page.key}.steps.${key}`, 45);
      }

      const sections = record(copy.sections, `${locale}.${page.key}.sections`);
      assert.deepEqual(Object.keys(sections).sort(), [...page.sections].sort());
      if (page.key === "signupOptions") {
        const systemQuestions = record(
          sections.systemQuestions,
          `${locale}.${page.key}.systemQuestions`,
        );
        assert.match(
          nonEmpty(systemQuestions.purpose, `${locale}.${page.key}.systemQuestions.purpose`, 55),
          locale === "en" ? /What are you looking for\?/u : /Mit keresel\?/u,
        );
        // D-114. The console can now CHANGE that row's limits, and the ceiling
        // is NOT the answer count — installed iOS builds refuse a maximum above
        // five outright. A guide that omitted that would invite the one edit
        // that breaks every signup.
        const selectionLimits = record(
          sections.selectionLimits,
          `${locale}.${page.key}.selectionLimits`,
        );
        assert.match(
          nonEmpty(selectionLimits.guidance, `${locale}.${page.key}.selectionLimits.guidance`, 45),
          locale === "en" ? /five/u : /ötnél/u,
        );
      }
      for (const sectionKey of page.sections) {
        const section = record(sections[sectionKey], `${locale}.${page.key}.${sectionKey}`);
        nonEmpty(section.title, `${locale}.${page.key}.${sectionKey}.title`, 5);
        nonEmpty(section.purpose, `${locale}.${page.key}.${sectionKey}.purpose`, 55);
        nonEmpty(section.guidance, `${locale}.${page.key}.${sectionKey}.guidance`, 45);
        const actions = record(section.actions, `${locale}.${page.key}.${sectionKey}.actions`);
        assert.ok(Object.keys(actions).length >= 2, `${locale}.${page.key}.${sectionKey} needs actionable guidance`);
        for (const [key, value] of Object.entries(actions)) {
          nonEmpty(value, `${locale}.${page.key}.${sectionKey}.actions.${key}`, 25);
        }
      }
    }
  }
});

test("independently saved or operator-facing embedded tools have dedicated help topics", () => {
  const required: Record<string, string[]> = {
    overview: ["metrics", "signupMetrics", "registrations"],
    userDetail: ["membership", "membershipRestore"],
    photoModeration: ["imageEditing"],
    configuration: ["sectionAvailability", "sectionTeasers", "featureSwitches", "authPolicy", "phoneCountries", "locationAccess", "friendingStart", "welcomeMessage"],
    appearance: ["landing", "landingButtons", "landingFooter", "landingQr", "modeSwitcher", "saving"],
    // The event page's audited "Content & signals" panel: its own reads, and the way into a case.
    datesActivityDetail: ["contentSignals"],
    // What the event's host was shown of a case and decided about it.
    datesModerationDetail: ["hostReview"],
  };
  for (const [key, sections] of Object.entries(required)) {
    const page = ADMIN_HELP_PAGES.find((entry) => entry.key === key);
    assert.ok(page, key);
    for (const section of sections) {
      assert.ok((page.sections as readonly string[]).includes(section), `${key}.${section}`);
    }
  }
});

test("the event page guide documents the Content & signals panel by the names the panel itself shows, in both languages", async () => {
  const page = ADMIN_HELP_PAGES.find((entry) => entry.key === "datesActivityDetail");
  assert.ok(page);
  // The panel is the first panel of the page, and its topic the first of the guide.
  assert.equal(page.sections[0], "contentSignals");
  const source = await readFile(path.join(root, "app", "(dashboard)", "dates", "[activityId]", "page.tsx"), "utf8");
  const mounted = source.indexOf("<DatesEventContentPanel ");
  assert.ok(mounted > 0 && mounted < source.indexOf('<h2>{t("overview")}</h2>'), "the panel is mounted above the overview");
  // The panel decides from the operator's capabilities whether it renders at all, after the page is on the screen:
  // no catalogue gate can express that, so the topic's own copy names it.
  const panel = await readFile(path.join(root, "components", "DatesEventContentPanel.tsx"), "utf8");
  assert.match(panel, /const canRead = hasDatesCapability\(principal, "dates_evidence_read"\);/);
  assert.match(panel, /const canReview = canRead && hasDatesCapability\(principal, "dates_case_claim"\);/);
  assert.match(panel, /if \(!canRead\) return null;/);
  assert.equal(Object.hasOwn(page, "sectionReady"), false);

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const topic = messages.adminHelp.pages.datesActivityDetail.sections.contentSignals;
    const copy = messages.datesAdmin.eventContent;
    assert.equal(topic.title, copy.title, `${locale}: the topic carries the panel's own title`);
    // The controls are quoted by the labels the operator sees on them.
    assert.ok(topic.actions["1"].includes(copy.show), `${locale}: ${copy.show}`);
    for (const label of [copy.openReview, copy.reviewMedia, copy.reviewEvent]) {
      assert.ok(topic.actions["2"].includes(label), `${locale}: ${label}`);
    }
    // What the panel shows: the four kinds of member content, reported or not, and the personal hides.
    assert.match(topic.purpose, locale === "en"
      ? /wall posts, comments and replies, event chat messages and reviews — whether or not anyone reported it, and what individual members hid for themselves/u
      : /falposztokat, kommenteket és válaszokat, eseménychat-üzeneteket és értékeléseket –, akkor is, ha senki sem jelentette be, valamint azt, amit egy-egy tag a maga számára elrejtett/u);
    // Opening a case removes nothing, as the panel's own form says where the request is made.
    assert.match(topic.guidance, locale === "en" ? /^Opening a case does not remove content: / : /^Az ügy megnyitása nem távolít el tartalmat: /u);
    assert.match(copy.reviewCopy, locale === "en" ? /This does not remove content\./ : /Ez még nem távolítja el a tartalmat\./u);
    // Who sees the panel, and who may open a case from it.
    assert.match(topic.guidance, locale === "en"
      ? /shown only to operators who may read evidence, and opening a case also requires the right to claim cases/
      : /csak az látja, aki bizonyítékot olvashat; ügyet pedig az nyithat innen, akinek az ügyek átvételére is van joga/u);
  }
});

test("host moderation is documented where the operator meets it: the queue, the case and the event page, in both languages and in the console's own words", async () => {
  const caseGuide = ADMIN_HELP_PAGES.find((entry) => entry.key === "datesModerationDetail");
  assert.ok(caseGuide);
  // The section sits between the claim panel and the reports, and so does its topic.
  assert.deepEqual(caseGuide.sections.slice(0, 4), ["overview", "claim", "hostReview", "reports"]);
  const casePage = await readFile(path.join(root, "app", "(dashboard)", "dates", "moderation", "[caseId]", "page.tsx"), "utf8");
  const mounted = casePage.indexOf("<DatesCaseHostReview ");
  assert.ok(mounted > casePage.indexOf('{t("claimTitle")}') && mounted < casePage.indexOf('{t("reportsTitle")}'));

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const pages = messages.adminHelp.pages, dates = messages.datesAdmin, hu = locale === "hu";
    // The case guide: the topic carries the section's own title, names the four decisions, and says what a host's decision is not.
    const topic = pages.datesModerationDetail.sections.hostReview;
    assert.equal(topic.title, dates.caseDetail.hostReview.title, locale);
    assert.match(topic.purpose, hu ? /megtartotta, eltávolította a tartalmat, eltávolította a tagot vagy kitiltotta a tagot/u : /kept it, removed the content, removed the member or banned the member/);
    assert.match(topic.purpose, hu ? /Egy tagról szóló ügy az egész appban egyetlen ügy/u : /A case about a member is one case for the whole app/);
    assert.match(topic.guidance, hu ? /^A host döntése nem zárja le az ügyet, és nem moderációs döntés: /u : /^The host's decision does not close the case and is not a moderation decision: /);
    assert.match(topic.guidance, hu ? /A host soha nem látja, ki tett bejelentést, és a bejelentő megjegyzését sem\./u : /The host is never shown who reported, nor a reporter's note\./);
    assert.match(topic.guidance, hu ? /csak olvasható/u : /read-only/);
    // The overview of the case names the target by where the content lives, with the labels the page prints, and the event as a link.
    const kinds = dates.moderation.targetKinds, lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
    for (const label of [kinds.wall_post, kinds.wall_comment, kinds.activity_chat, kinds.direct_chat]) {
      assert.ok(pages.datesModerationDetail.sections.overview.purpose.includes(lower(label)), `${locale} case overview: ${label}`);
      assert.ok(pages.datesModeration.sections.caseQueue.purpose.includes(lower(label)), `${locale} queue: ${label}`);
    }
    assert.match(pages.datesModerationDetail.sections.overview.purpose, hu ? /az esemény azonosítója pedig az esemény oldalára visz/u : /the event is a link to its page/);
    // The queue guide: the badge, and that a host's decision never closes a case.
    assert.match(pages.datesModeration.sections.caseQueue.purpose, hu ? /egy jelvény pedig azt mutatja, látja-e az ügyet az esemény hostja, és hogyan döntött/u
      : /a badge says whether the event's host is shown the case and what the host decided/);
    assert.match(pages.datesModeration.sections.caseQueue.guidance, hu ? /A host döntése soha nem zárja le az ügyet/u : /A host's decision never closes a case/);
    // The event guide: removed and banned members, and that the console only shows them.
    const members = pages.datesActivityDetail.sections.membershipsChats;
    assert.match(members.purpose, hu ? /Akit a host eltávolított vagy kitiltott az eseményről/u : /A member the host removed or banned from the event/);
    assert.match(members.purpose, hu ? /a feloldott kitiltás feloldottként jelenik meg/u : /a lifted ban is shown as lifted/);
    assert.match(members.guidance, hu ? /A kitiltás erősebb az eltávolításnál\..*kitiltani vagy kitiltást feloldani innen nem lehet/u : /A ban outranks a removal\..*the console has no ban or unban control/);
    // ... and content the host removed, in the topic of the panel that shows it.
    const content = pages.datesActivityDetail.sections.contentSignals;
    assert.match(content.purpose, hu ? /a szerzője, az esemény hostja vagy moderációs döntés távolította-e el/u : /whether its author, the event's host or a moderation decision removed it/);
    assert.match(content.guidance, hu ? /a megőrzött hivatkozás pedig szövegként/u : /a kept link is printed as text/);
    // One word for the member who hosts an event, in every guide of the feature: the console's "host". "Szervező" /
    // "organizer" is the console's word for the organizer of an external event, a different party.
    for (const section of [topic, members, content, pages.datesModeration.sections.caseQueue]) {
      assert.doesNotMatch(JSON.stringify(section).replace(/nem tagi szervezőt|non-member organizer/gu, ""), /szervező|organizer|házigazda/iu, locale);
    }
  }
});

test("App Review help counts stay aligned with the closed runtime contract in both languages", async () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const sections = messages.adminHelp.pages.appReview.sections;
    assert.match(sections.checks.purpose, new RegExp(`\\b${APP_REVIEW_CHECK_KEYS.length}\\b`));
    assert.match(sections.counts.purpose, new RegExp(`\\b${APP_REVIEW_COUNT_KEYS.length}\\b`));
  }
});

test("the overview guide describes the cards the page renders, not the retired campaign counter", async () => {
  const source = await readFile(path.join(root, "app", "(dashboard)", "page.tsx"), "utf8");
  const cards = source.slice(source.indexOf("const stats = ["), source.indexOf("];", source.indexOf("const stats = [")));
  assert.equal(cards.match(/label: t\(/g)?.length, 4, "the overview renders four stat cards");
  assert.doesNotMatch(cards, /activeHeroes/);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const overview = messages.adminHelp.pages.overview.sections;
    assert.match(overview.metrics.purpose, locale === "en" ? /\bfour\b/u : /\bnégy\b/u);
    assert.doesNotMatch(JSON.stringify(overview), locale === "en" ? /\bsix\b|People campaigns/u : /\bhat\b|People-kampány/u);
  }
});

test("the overview quick action to Appearance & placements describes that page, not People hero media", async () => {
  const source = await readFile(path.join(root, "app", "(dashboard)", "page.tsx"), "utf8");
  assert.match(source, /href="\/appearance">\s*<strong>\{t\("manageAppearance"\)\}<\/strong><span>\{t\("manageAppearanceCopy"\)\}<\/span>/);
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const overview = messages.overview;
    assert.equal(overview.manageHeroes, undefined, `${locale}: the People hero shortcut copy is retired`);
    assert.ok(overview.manageAppearance.includes(messages.appearance.title), `${locale}: the shortcut names the page it opens`);
    assert.doesNotMatch(overview.manageAppearanceCopy, /People hero|reorder|átrendez/u);
  }
});

test("the feature-switch Help census names all three gates and permanent Visitors", async () => {
  for (const locale of ["en", "hu"] as const) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const pages = record(record(messages.adminHelp, `${locale}.adminHelp`).pages, `${locale}.pages`);
    const configuration = record(
      record(record(pages.configuration, `${locale}.configuration`).sections, `${locale}.sections`).featureSwitches,
      `${locale}.featureSwitches`,
    );
    const footprints = record(
      record(record(pages.footprints, `${locale}.footprints`).sections, `${locale}.sections`).featureSwitchesPointer,
      `${locale}.featureSwitchesPointer`,
    );
    const combined = `${configuration.title} ${configuration.purpose} ${configuration.guidance} ${footprints.purpose} ${footprints.guidance}`;
    assert.match(combined, /Hey/u);
    assert.match(combined, /Footprint/u);
    assert.match(combined, locale === "en" ? /photo likes/iu : /fotókedvel/iu);
    assert.match(combined, locale === "en" ? /Visitors (?:is|remain)/u : /Látogatók/u);
  }
});

test("the authenticated shell always renders the visible accessible Help control", async () => {
  const shell = await readFile(path.join(root, "components", "Shell.tsx"), "utf8");
  const component = await readFile(path.join(root, "components", "AdminHelp.tsx"), "utf8");

  assert.match(shell, /import AdminHelp from "@\/components\/AdminHelp"/);
  // The dialog receives the same four Core-projected booleans the sidebar
  // filter uses, so a guide cannot outlive the screen it documents (T-566).
  assert.match(shell, /<AdminHelp\n\s+personaConsoleReady=\{personaConsoleReady\}/);
  assert.match(shell, /verificationConsoleReady=\{verificationConsoleReady\}/);
  assert.match(shell, /audienceVisibilityConsoleReady=\{audienceVisibilityConsoleReady\}/);
  assert.match(shell, /profileTextModerationConsoleReady=\{profileTextModerationConsoleReady\}/);
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /<HelpIcon \/>/);
  assert.match(component, /t\("button"\)/);
  assert.match(component, /adminHelpGuideForPath\(pathname, readiness\)/);
  assert.match(component, /adminHelpSections\(page\)/);
  assert.match(component, /sections\.map/);
  assert.doesNotMatch(component, /page\.sections\.map/, "a withheld section must not be rendered anyway");
});

/**
 * T-566. The catalogue is a census of route FILES, so coverage alone cannot
 * tell whether a documented screen renders. These tests DERIVE the gates from
 * the page sources rather than restating them, so a screen that grows or loses
 * a `notFound()` gate and does not tell Help fails here instead of shipping a
 * guide to a 404.
 */
const CONTRACT_CONSTANTS: Record<string, boolean> = {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  FEATURE_SWITCHES_CONTRACT_READY,
  PERSONA_START_EDITOR_VISIBLE,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
};

const ALL_READY: AdminHelpConsoleReadiness = {
  personaConsoleReady: true,
  verificationConsoleReady: true,
  audienceVisibilityConsoleReady: true,
  profileTextModerationConsoleReady: true,
};

test("every help entry declares the same readiness its route checks", async () => {
  const files = await pageFiles(path.join(root, "app", "(dashboard)"));
  const byRoute = new Map(ADMIN_HELP_PAGES.map((page) => [page.route, page]));

  for (const file of files) {
    const route = routeForPageFile(file);
    const source = await readFile(file, "utf8");
    if (ADMIN_HELP_REDIRECTS.some((entry) => entry.route === route)) {
      // A redirect-only route has no gate of its own; its destination's entry carries the readiness.
      assert.doesNotMatch(source, /notFound\(\)/u, `${route} is redirect-only and must not grow a gate`);
      continue;
    }
    const page = byRoute.get(route);
    assert.ok(page, `${route} has no help entry`);

    const constantGate = /if \(!([A-Z][A-Z0-9_]*)\) notFound\(\)/u.exec(source)?.[1] ?? null;
    const consoleGate = /if \(!me\?\.([A-Za-z][A-Za-z0-9]*)\) notFound\(\)/u.exec(source)?.[1] ?? null;

    if (constantGate === null) {
      assert.equal(page.ready, undefined, `${route} is ungated but its help entry declares one`);
    } else {
      assert.ok(constantGate in CONTRACT_CONSTANTS, `${route} gates on an unknown constant`);
      assert.equal(
        page.ready,
        CONTRACT_CONSTANTS[constantGate],
        `${route} gates on ${constantGate}; its help entry must carry the same value`,
      );
    }

    assert.equal(
      page.consoleReady,
      consoleGate ?? undefined,
      `${route} gates on ${consoleGate ?? "nothing"}; its help entry must name the same projection`,
    );
  }
});

test("a guide is withheld exactly while its screen refuses to render", () => {
  // Dormant build constant: no operator, however privileged, can reach it.
  assert.equal(PROFILE_TEXT_MODERATION_CONTRACT_READY, false);
  assert.equal(adminHelpGuideForPath("/text-moderation", ALL_READY), null);
  assert.equal(adminHelpPageForPath("/text-moderation")?.key, "profileTextModeration");

  // Core-projected gates: reachable for an operator Core has enabled, withheld
  // for one it has not. Both directions, so the gate cannot be inverted.
  for (const [route, key] of [
    ["/persona", "personaConsoleReady"],
    ["/verification", "verificationConsoleReady"],
    ["/audience-visibility", "audienceVisibilityConsoleReady"],
  ] as const) {
    assert.ok(adminHelpGuideForPath(route, ALL_READY), `${route} must guide a ready operator`);
    assert.equal(
      adminHelpGuideForPath(route, { ...ALL_READY, [key]: false }),
      null,
      `${route} must withhold its guide from an operator Core has not enabled`,
    );
  }

  // An ungated screen is unaffected by any projection.
  assert.equal(
    adminHelpGuideForPath("/users", {
      personaConsoleReady: false,
      verificationConsoleReady: false,
      audienceVisibilityConsoleReady: false,
      profileTextModerationConsoleReady: false,
    })?.key,
    "users",
  );
});

test("a section is shown or withheld exactly as its own panel renders", () => {
  assert.equal(FEATURE_SWITCHES_CONTRACT_READY, true);
  assert.equal(ADMIN_GRANTED_VERIFICATION_CONTRACT_READY, false);
  assert.equal(PERSONA_START_EDITOR_VISIBLE, false);

  // T-687 released the feature-switch cutover (T-686 C-1), so both of its
  // sections are shown. Their `sectionReady` gates STAY and keep carrying the
  // live constant, so a rollback flip withholds them again with no edit here.
  const released: Array<[string, string]> = [
    ["/configuration", "featureSwitches"],
    ["/footprints", "featureSwitchesPointer"],
  ];

  for (const [route, section] of released) {
    const page = adminHelpPageForPath(route);
    assert.ok(page, `${route} has no help entry`);
    assert.ok(page.sections.includes(section), `${section} must stay in the ${route} census`);
    assert.equal(
      page.sectionReady?.[section],
      FEATURE_SWITCHES_CONTRACT_READY,
      `${route} must keep gating ${section} on the released constant, not on a literal`,
    );
    assert.ok(
      adminHelpSections(page).includes(section),
      `${route} must show ${section} now that its panel renders`,
    );
  }

  const gated: Array<[string, string]> = [
    ["/users/example-id", "adminGrantedVerification"],
    ["/persona", "startConfig"],
    ["/persona", "preview"],
  ];

  for (const [route, section] of gated) {
    const page = adminHelpPageForPath(route);
    assert.ok(page, `${route} has no help entry`);
    assert.ok(page.sections.includes(section), `${section} must stay in the ${route} census`);
    assert.ok(
      !adminHelpSections(page).includes(section),
      `${route} must withhold ${section} while its panel is not rendered`,
    );
  }

  // Nothing else is withheld, and no entry hides a section it does not have.
  for (const page of ADMIN_HELP_PAGES) {
    const shown = adminHelpSections(page);
    const hidden = page.sections.filter((section) => !shown.includes(section));
    assert.deepEqual(
      hidden.sort(),
      gated.filter(([route]) => page.matches(route)).map(([, section]) => section).sort(),
      `${page.route} withholds an unexpected section`,
    );
    for (const section of Object.keys(page.sectionReady ?? {})) {
      assert.ok(
        page.sections.includes(section),
        `${page.route} gates ${section}, which is not one of its sections`,
      );
    }
  }
});

test("gated copy stays in both locale files so either side of a switch has its guide", async () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const pages = record(record(messages.adminHelp, "adminHelp").pages, "adminHelp.pages");
    for (const [pageKey, sectionKey] of [
      ["configuration", "featureSwitches"],
      ["footprints", "featureSwitchesPointer"],
      ["userDetail", "adminGrantedVerification"],
      ["profileTextModeration", "queue"],
      ["persona", "startConfig"],
      ["persona", "preview"],
    ] as const) {
      const copy = record(pages[pageKey], `${locale}.${pageKey}`);
      const sections = record(copy.sections, `${locale}.${pageKey}.sections`);
      assert.ok(sections[sectionKey], `${locale}.${pageKey}.${sectionKey} must survive the gate`);
    }
  }
});

/**
 * T-569/T-567. The remaining conditional panel on /users/<uid> is DERIVED from
 * the page source rather than restated here. Audience visibility is always
 * mounted after its spent build switch was retired; its own Core projection
 * still decides whether it returns content.
 *
 * What this cannot cover, and why the copy says it instead: `AudienceVisibilityUserPanel` calls
 * `admin_me` itself and returns `null` when Core does not project
 * `audience_visibility_member_detail` to the current operator. That decision happens after the
 * panel's own round trip, so no catalogue value can express it — the class T-566 reported as having
 * no mechanism. A `sectionReady` entry for it would be a guess; the guidance names the gate.
 */
test("the user-detail section gates are derived from the panels that page renders", async () => {
  const source = await readFile(
    path.join(root, "app", "(dashboard)", "users", "[uid]", "page.tsx"),
    "utf8",
  );
  const page = adminHelpPageForPath("/users/example-id");
  assert.ok(page, "/users/<uid> has no help entry");

  const sectionForPanel: Record<string, string> = {
    AdminGrantedVerificationPanel: "adminGrantedVerification",
  };
  const seen = new Set<string>();
  for (const [, constant, component] of source.matchAll(
    /\{([A-Z][A-Z0-9_]*) \? <([A-Za-z][A-Za-z0-9]*)/gu,
  )) {
    const section = sectionForPanel[component];
    assert.ok(section, `${component} is rendered behind ${constant} with no help section mapped`);
    assert.ok(constant in CONTRACT_CONSTANTS, `${component} gates on an unknown constant`);
    assert.ok(page.sections.includes(section), `${section} must stay in the /users/<uid> census`);
    assert.equal(
      page.sectionReady?.[section],
      CONTRACT_CONSTANTS[constant],
      `${component} renders behind ${constant}; its help section must carry the same value`,
    );
    seen.add(component);
  }
  assert.deepEqual([...seen].sort(), Object.keys(sectionForPanel).sort());

  // The released panel and its guide are no longer behind a source switch.
  // T-653 gave it two props: Core's served detailed-gender catalogue and the
  // page re-read a successful identity write needs. Neither is a gate.
  assert.match(source, /<AudienceVisibilityUserPanel uid=\{uid\} onIdentitySaved=\{load\} \/>/);
  assert.equal(page.sectionReady?.audienceVisibility, undefined);
  assert.ok(adminHelpSections(page).includes("audienceVisibility"));
});

/**
 * The gap T-566 found and correctly declined to fill: the console's newest operator surface had no
 * guidance in either locale. The copy has to name the per-operator Core gate, because nothing else
 * can.
 */
test("the audience-visibility member panel is documented in both locales", async () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
    const pages = record(record(messages.adminHelp, "adminHelp").pages, "adminHelp.pages");
    const sections = record(
      record(record(pages.userDetail, `${locale}.userDetail`).sections, `${locale}.userDetail.sections`),
      `${locale}.userDetail.sections`,
    );
    const section = record(sections.audienceVisibility, `${locale}.userDetail.audienceVisibility`);
    const guidance = nonEmpty(section.guidance, `${locale}.userDetail.audienceVisibility.guidance`, 45);
    // Honest about the gate the catalogue cannot express: the panel is per-operator.
    assert.match(guidance, /Core/u, `${locale} guidance must name the Core projection that gates the panel`);
  }
});

test("member help explains restoring PLUS after re-registration with the panel's own controls", async () => {
  const page = ADMIN_HELP_PAGES.find((entry) => entry.key === "userDetail");
  assert.ok(page);
  const order = page.sections as readonly string[];
  assert.equal(order.indexOf("membershipRestore"), order.indexOf("membership") + 1, "the topic follows the membership panel");
  const english = JSON.parse(await readFile(path.join(root, "messages", "en.json"), "utf8"));
  const hungarian = JSON.parse(await readFile(path.join(root, "messages", "hu.json"), "utf8"));
  const topic = (messages: { adminHelp: { pages: { userDetail: { sections: Record<string, unknown> } } } }) =>
    JSON.stringify(messages.adminHelp.pages.userDetail.sections.membershipRestore);
  const en = topic(english);
  // The procedure names the controls exactly as the panel labels them.
  for (const label of [
    english.membershipUser.grant.startNow,
    english.membershipUser.grant.customExpiry,
    english.membershipUser.manage.newExpiry,
    english.nav.support,
  ]) {
    assert.ok(en.includes(label), `EN restore help names "${label}"`);
  }
  for (const phrase of [/deleted their Friending account/, /still active/, /Apple period end/, /Each period/, /cancels/, /Never move, copy or edit store rows/]) {
    assert.match(en, phrase);
  }
  const hu = topic(hungarian);
  for (const label of [
    `„${hungarian.membershipUser.grant.startNow}”`,
    `„${hungarian.membershipUser.manage.newExpiry}”`,
    hungarian.nav.support,
  ]) {
    assert.ok(hu.includes(label), `HU restore help names ${label}`);
  }
  for (const phrase of [/újra regisztrált/, /még aktív/, /egyéni lejárattal/, /Minden időszakban/, /lemondja/, /Store-sorokat és vásárlási kötéseket soha ne mozgass/]) {
    assert.match(hu, phrase);
  }
});

test("the retry boundary and the square-thumbnail wording say what the console actually does", async () => {
  const english = JSON.parse(await readFile(path.join(root, "messages", "en.json"), "utf8"));
  const hungarian = JSON.parse(await readFile(path.join(root, "messages", "hu.json"), "utf8"));
  // Most panels' retry only reloads; only some keep a pending change and resend the same request.
  assert.doesNotMatch(english.adminHelp.sourceBoundary, /use the panel's own Retry, which resends the same request/);
  assert.ok(english.adminHelp.sourceBoundary.includes(english.common.retry), "EN names the generic reload button");
  assert.match(english.adminHelp.sourceBoundary, /Some panels keep an uncertain change pending/);
  assert.ok(hungarian.adminHelp.sourceBoundary.includes(`az ${hungarian.common.retry} gomb csak újra betölti`), "HU names the generic reload button");
  assert.match(hungarian.adminHelp.sourceBoundary, /Néhány panel függőben tartja/);

  const values = (value: unknown): string[] => typeof value === "string"
    ? [value]
    : value && typeof value === "object" ? Object.values(value).flatMap(values) : [];
  const allHungarian = values(hungarian).join("\n");
  assert.doesNotMatch(allHungarian, /kocka-thumb|thumbot|\bthumb\b/iu, "one Hungarian term: négyzetes bélyegkép");
  assert.equal(hungarian.imageEditor.squareEdit, "Négyzetes bélyegkép");
  assert.match(hungarian.imageEditor.squareSaved, /^A négyzetes bélyegképet elmentettük\./u);
  assert.ok(allHungarian.includes(`„${hungarian.pinger.icon.useBundled}”`), "the bundled-icons label is quoted where the help names it");
  assert.doesNotMatch(allHungarian, /A gomb feliratának módosítása lejjebb/u);
});

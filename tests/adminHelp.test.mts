import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_HELP_PAGES,
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

test("all authenticated page routes have one closed contextual help entry", async () => {
  const files = await pageFiles(path.join(root, "app", "(dashboard)"));
  const actualRoutes = files.map(routeForPageFile).sort();
  const helpRoutes = ADMIN_HELP_PAGES.map((page) => page.route).sort();

  // 39: 41 with T-468's Appearance & placements page (the map document lives
  // outside the dashboard shell), minus the two T-565 retired ones. T-683 adds
  // the into-tag moderation queue (40).
  assert.equal(actualRoutes.length, 40, "the current screen census changed; review every new or removed screen");
  assert.deepEqual(helpRoutes, actualRoutes);
  assert.equal(new Set(helpRoutes).size, helpRoutes.length, "a screen may have only one help document");
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
  assert.equal(totalSections, 246, "review the functional-section census when the UI changes");
  assert.deepEqual(
    ADMIN_HELP_PAGES.find((page) => page.route === "/signup-options")?.sections,
    ["systemQuestions", "pageLayout", "questionPalette", "draftSaving", "answersElsewhere"],
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
  assert.match(source, /<AudienceVisibilityUserPanel uid=\{uid\} identityGroups=\{identityGroups\} onIdentitySaved=\{load\} \/>/);
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

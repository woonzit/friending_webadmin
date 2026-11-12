import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator, type AbstractIntlMessages } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { ClientMessageCensus, covers, examplePath, type CensusRow } from "../scripts/clientMessageCensus.mts";
import { ADMIN_HELP_CHROME, CLIENT_MESSAGE_SCOPES, clientMessagePaths, pickClientMessages, type ClientMessageScopeName } from "../lib/clientMessageScopes.ts";
import { ADMIN_HELP_PAGES, ADMIN_HELP_REDIRECTS, adminHelpGuideForPath, adminHelpPageForPath } from "../lib/adminHelp.ts";

/**
 * Scoped client messages (audit finding 1). Each layout's provider ships only what the
 * client components under it read; nested providers replace, not merge. These tests
 * derive the reads from source (`scripts/clientMessageCensus.mts`) and hold every
 * scope in `lib/clientMessageScopes.ts` to them, so no screen can show a raw key.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "hu"] as const;
const catalogue = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(readFileSync(path.join(root, "messages", `${locale}.json`), "utf8"))])) as Record<(typeof LOCALES)[number], AbstractIntlMessages>;
const HELP_FILE = "components/AdminHelp.tsx";
const REDIRECTS = new Set(ADMIN_HELP_REDIRECTS.map((entry) => entry.route));

type Scopes = Record<string, readonly string[]>;
const SHIPPED: Scopes = Object.fromEntries(Object.keys(CLIENT_MESSAGE_SCOPES).map((scope) => [scope, clientMessagePaths(scope as ClientMessageScopeName)]));
const census = new ClientMessageCensus(root).census();

function lookup(tree: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), tree);
}

/** Every read whose serving scope does not ship it, as `route  scope  path  file`. */
function uncovered(rows: CensusRow[], scopes: Scopes): string[] {
  const misses = new Set<string>();
  for (const { route, scope, file, requirement } of rows) {
    if (requirement.optional) continue;
    const shipped = scope === null ? undefined : scopes[scope];
    if (!shipped?.some((entry) => covers(entry, requirement.path))) misses.add(`${route}  ${scope ?? "(no provider)"}  ${requirement.path}  ${file} (${requirement.why})`);
  }
  return [...misses].sort();
}

/** For each screen with a guide: the scopes whose help mount would show it. */
function guideMounts(rows: CensusRow[], scopes: Scopes): Map<string, string[]> {
  const mounts = new Map<string, Set<string>>();
  for (const { route, scope, file } of rows) {
    if (file !== HELP_FILE || scope === null) continue;
    if (!mounts.has(route)) mounts.set(route, new Set());
    mounts.get(route)!.add(scope);
  }
  const showing = new Map<string, string[]>();
  for (const { route, file } of census.routes) {
    if (!file.includes(`${path.sep}(dashboard)${path.sep}`) || REDIRECTS.has(route)) continue;
    const page = adminHelpPageForPath(examplePath(route));
    assert.ok(page, `${route} has a guide (tests/adminHelp.test.mts)`);
    showing.set(route, [...(mounts.get(route) ?? [])].filter((scope) => scopes[scope]?.includes(`adminHelp.pages.${page.key}`)));
  }
  return showing;
}

function wrongMounts(rows: CensusRow[], scopes: Scopes): string[] {
  return [...guideMounts(rows, scopes)].filter(([, showing]) => showing.length !== 1).map(([route, showing]) => `${route}: ${showing.length} mounts show its guide (${showing.join(", ")})`);
}

test("the census derives every read: no namespace built at run time, no whole-catalogue hook, no unscoped provider", () => {
  assert.deepEqual(census.problems, []);
  assert.equal(census.routes.length, ADMIN_HELP_PAGES.length + ADMIN_HELP_REDIRECTS.length + 2, "every dashboard screen, the sign-in page and the map frame");
  assert.ok(census.rows.length > 1000, "the census sees the client reads");
});

test("every client read on every route is shipped by the provider that serves it", () => {
  assert.deepEqual(uncovered(census.rows, SHIPPED), []);
});

test("every screen's guide is shown by exactly one help mount, and only dashboard screens have one", () => {
  assert.deepEqual(wrongMounts(census.rows, SHIPPED), []);
  for (const scope of ["root", "login", "frames"] as const) {
    assert.ok(!census.rows.some((row) => row.scope === scope && row.file === HELP_FILE), `${scope} renders no help`);
    assert.ok(!SHIPPED[scope].some((entry) => entry.startsWith("adminHelp")), `${scope} ships no help copy`);
  }
});

test("no scope ships a path nothing under it reads, lists a path twice, or goes unused", () => {
  const stale: string[] = [];
  for (const [scope, entries] of Object.entries(SHIPPED)) {
    const reads = census.rows.filter((row) => row.scope === scope).map((row) => row.requirement.path);
    for (const entry of entries) {
      if (!reads.some((read) => covers(entry, read))) stale.push(`${scope}: ${entry}`);
      if (entries.some((other) => other !== entry && covers(other, entry))) stale.push(`${scope}: ${entry} is inside another entry`);
    }
    assert.equal(new Set(entries).size, entries.length, `${scope} lists an entry twice`);
  }
  assert.deepEqual(stale, []);
  const declared = new Set([...census.chains.values()].flat());
  assert.deepEqual(Object.keys(SHIPPED).filter((scope) => !declared.has(scope)), [], "every scope is declared by a layout");
  assert.ok([...declared].every((scope) => scope === null || scope in SHIPPED), "every layout names a defined scope");
});

test("a dashboard segment's scope is named by its directory and the help chrome is complete", () => {
  for (const { file, layouts } of census.routes) {
    for (const layout of layouts) {
      const relative = path.relative(path.join(root, "app", "(dashboard)"), path.dirname(layout)).split(path.sep).join("/");
      if (relative.startsWith("..") || relative === "") continue;
      assert.match(readFileSync(layout, "utf8"), new RegExp(`dashboardSegmentLayout\\(${JSON.stringify(relative).replace(/[[\]]/g, "\\$&")}\\)`), `${path.relative(root, file)}: ${relative}`);
    }
  }
  const chrome = Object.keys(catalogue.en.adminHelp as Record<string, unknown>).filter((key) => key !== "pages").map((key) => `adminHelp.${key}`).sort();
  assert.deepEqual([...ADMIN_HELP_CHROME].sort(), chrome);
});

test("each shipped path exists in both locales, and next-intl resolves every read from the picked messages exactly as from the catalogue", () => {
  for (const locale of LOCALES) {
    for (const [scope, entries] of Object.entries(SHIPPED)) {
      for (const entry of entries) assert.notEqual(lookup(catalogue[locale], entry), undefined, `${locale} ${scope}: ${entry}`);
      const picked = pickClientMessages(catalogue[locale], entries);
      // Missing messages fail loudly: next-intl's onError throws instead of
      // rendering the key as the fallback text.
      const t = createTranslator({ locale, messages: picked, onError: (error) => { throw error; } });
      const full = createTranslator({ locale, messages: catalogue[locale], onError: (error) => { throw error; } });
      const reads = new Set(census.rows.filter((row) => row.scope === scope && !row.requirement.optional).map((row) => row.requirement.path));
      for (const read of reads) assert.deepEqual(t.raw(read as never), full.raw(read as never), `${locale} ${scope}: ${read}`);
    }
  }
});

test("the picker copies only the named paths and never writes into the catalogue", () => {
  const messages = { a: { b: { c: "1", d: "2" }, e: "3" }, f: "4" } as AbstractIntlMessages;
  const before = JSON.stringify(messages);
  assert.deepEqual(pickClientMessages(messages, ["a.b.c", "f", "missing.path"]), { a: { b: { c: "1" } }, f: "4" });
  assert.deepEqual(pickClientMessages(messages, ["a.b.c", "a.b", "a.e"]), { a: { b: { c: "1", d: "2" }, e: "3" } });
  assert.equal(JSON.stringify(messages), before);
  const picked = pickClientMessages(catalogue.en, SHIPPED.login);
  assert.ok(JSON.stringify(picked).length < JSON.stringify(catalogue.en).length / 50, "the sign-in page ships a small fraction of the catalogue");
});

test("negative controls: a removed namespace, a removed guide, an unread entry and an unknown read all fail", () => {
  // A namespace deliberately removed from a scope is reported for every screen that reads it.
  const withoutUserDetail = { ...SHIPPED, "users/[uid]": SHIPPED["users/[uid]"].filter((entry) => entry !== "userDetail") };
  const missing = uncovered(census.rows, withoutUserDetail);
  assert.ok(missing.length > 0 && missing.every((line) => line.startsWith("/users/[uid]  users/[uid]  userDetail")), missing.join("\n"));
  const withoutCommon = { ...SHIPPED, login: SHIPPED.login.filter((entry) => entry !== "common") };
  assert.ok(uncovered(census.rows, withoutCommon).some((line) => line.startsWith("/login  login  common.")), "common removed from login");

  // A guide nobody ships, or two scopes shipping the same guide, is reported.
  const withoutOverview = { ...SHIPPED, dashboard: SHIPPED.dashboard.filter((entry) => entry !== "adminHelp.pages.overview") };
  assert.deepEqual(wrongMounts(census.rows, withoutOverview), ["/: 0 mounts show its guide ()"]);
  const twice = { ...SHIPPED, users: [...SHIPPED.users, "adminHelp.pages.userDetail"] };
  assert.deepEqual(wrongMounts(census.rows, twice), ["/users/[uid]: 2 mounts show its guide (users, users/[uid])"]);

  // A new read in a shell component that the dashboard scope lists by key.
  const notice = "components/DatesResearchNavigationNotice.tsx";
  const reading = new ClientMessageCensus(root, {
    [notice]: readFileSync(path.join(root, notice), "utf8").replace('t("navigation.leave")', 't("followups.title")'),
  }).census();
  assert.ok(uncovered(reading.rows, SHIPPED).some((line) => line.startsWith("/  dashboard  datesAdmin.research.followups.title")), "a new key read in the shell");

  // Constructions the census refuses to guess about.
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  const refused = new ClientMessageCensus(root, {
    "components/Shell.tsx": read("components/Shell.tsx").replace('const nav = useTranslations("nav");', 'const nav = useTranslations(["n", "av"].join(""));'),
    "components/LoginForm.tsx": read("components/LoginForm.tsx").replace('import { useTranslations } from "next-intl";', 'import { useMessages, useTranslations } from "next-intl";').replace('const t = useTranslations("login");', 'const t = useTranslations("login"); useMessages();'),
    "app/login/layout.tsx": read("app/login/layout.tsx").replace("return <NextIntlClientProvider", "return <><NextIntlClientProvider").replace("{children}</NextIntlClientProvider>;", "{null}</NextIntlClientProvider>{children}</>;"),
    "app/(frames)/layout.tsx": read("app/(frames)/layout.tsx").replace('messages={await clientMessages("frames")}', 'messages={{}}'),
  }).census();
  const expected = [
    "components/Shell.tsx:", "builds the useTranslations namespace at run time",
    "components/LoginForm.tsx:", "calls useMessages",
    "app/login/layout.tsx:", "renders children outside its provider",
    "app/(frames)/layout.tsx:", "NextIntlClientProvider must receive",
  ];
  for (let index = 0; index < expected.length; index += 2) {
    assert.ok(refused.problems.some((problem) => problem.startsWith(expected[index]) && problem.includes(expected[index + 1])), `${expected[index]} ${expected[index + 1]}\n${refused.problems.join("\n")}`);
  }
  const stray = new ClientMessageCensus(root, {
    "components/AdminLogoutButton.tsx": read("components/AdminLogoutButton.tsx") + "\nexport const provider = NextIntlClientProvider;\n",
  }).census();
  assert.deepEqual(stray.problems, ["components/AdminLogoutButton.tsx: only a layout or components/DashboardSegmentLayout.tsx may render a message provider"]);

  // A translator that is passed on needs its whole namespace.
  const passed = new ClientMessageCensus(root, {
    [notice]: readFileSync(path.join(root, notice), "utf8").replace('notice.title ?? t("navigation.title")', 'notice.title ?? String([t].length)'),
  }).census();
  assert.ok(uncovered(passed.rows, SHIPPED).some((line) => line.startsWith("/  dashboard  datesAdmin.research ") && line.includes("passes the translator on")), "a translator passed on");
});

// Rendering below: the shell and every help mount exactly as the layouts nest them,
// with the scoped messages and an onError that throws, so a missing message fails.
const react = await import("react");
(globalThis as Record<string, unknown>).React = react;
const { default: Shell } = await import("../components/Shell.tsx");
const { AdminHelpMount } = await import("../components/AdminHelp.tsx");
const { default: LoginForm } = await import("../components/LoginForm.tsx");
const { default: AdminMembershipUnavailable } = await import("../components/AdminMembershipUnavailable.tsx");

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const throwOnError = (error: unknown) => { throw error; };

function provider(locale: string, scope: string, children: ReactElement | ReactElement[]): ReactElement {
  return createElement(NextIntlClientProvider, {
    locale, timeZone: "UTC", onError: throwOnError, messages: pickClientMessages(catalogue[locale as "en"], SHIPPED[scope]),
  }, children);
}

function inRouter(pathname: string, element: ReactElement): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(PathnameContext.Provider, { value: pathname }, element)));
}

test("every dashboard screen renders the shell and exactly one help trigger, with its own guide, from the scoped messages", () => {
  const readiness = { personaConsoleReady: true, verificationConsoleReady: true, audienceVisibilityConsoleReady: true, profileTextModerationConsoleReady: true, friendingGoConsoleReady: true };
  for (const locale of LOCALES) {
    for (const { route, file } of census.routes) {
      if (!file.includes(`${path.sep}(dashboard)${path.sep}`) || REDIRECTS.has(route)) continue;
      const chain = census.chains.get(route)!.filter((scope): scope is string => scope !== null && scope !== "root");
      assert.equal(chain[0], "dashboard", route);
      // Segment layouts nest inside the shell, each with its children and then its mount.
      let content: ReactElement = createElement("div", { className: "probe" }, "content");
      for (const scope of chain.slice(1).reverse()) {
        content = provider(locale, scope, [createElement(react.Fragment, { key: "children" }, content), createElement(AdminHelpMount, { key: "help" })]);
      }
      const html = inRouter(examplePath(route), provider(locale, "dashboard", createElement(Shell, { adminEmail: "ops@example.test", ...readiness, children: content })));
      assert.equal(html.split('class="admin-help-trigger"').length - 1, 1, `${locale} ${route}`);
      // A guide withheld by a build constant (its screen answers 404) falls back to the
      // shell's mount and the unavailable copy, as before scoped messages.
      const guide = adminHelpGuideForPath(examplePath(route), readiness);
      const title = lookup(catalogue[locale], guide ? `adminHelp.pages.${guide.key}.title` : "adminHelp.unavailableTitle") as string;
      assert.ok(html.includes(title.replace(/&/g, "&amp;").replace(/"/g, "&quot;")), `${locale} ${route}: the trigger names ${guide?.key ?? "no guide"}`);
      assert.doesNotMatch(html, /adminHelp\.|nav\.|common\./, `${locale} ${route}: no raw key`);
    }
  }
});

test("outside the dashboard: the sign-in form and the neutral membership page render from their own scopes", () => {
  for (const locale of LOCALES) {
    const login = inRouter("/login", provider(locale, "login", createElement(LoginForm)));
    assert.ok(login.includes((catalogue[locale].login as Record<string, string>).title), locale);
    for (const scope of ["root", "login", "frames"]) {
      const neutral = inRouter("/", provider(locale, scope, createElement(AdminMembershipUnavailable, { checkId: "derived" })));
      assert.ok(neutral.includes((catalogue[locale].adminMembership as Record<string, string>).title), `${locale} ${scope}`);
    }
  }
});

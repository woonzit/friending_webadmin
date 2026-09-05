import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

/**
 * `components/Shell.tsx` carries its icon table as top-level JSX and, like
 * `LocaleSwitcher`/`AdminHelp`, does not import React as a value; tsx compiles
 * the repo's `"jsx": "preserve"` with the CLASSIC runtime, so the emitted
 * `React.createElement` needs a global. Publishing it before the component
 * modules are evaluated keeps this a test-only shim — the Next build uses the
 * automatic runtime and is untouched.
 */
const react = await import("react");
(globalThis as Record<string, unknown>).React = react;
const { default: Shell } = await import("../components/Shell.tsx");

const router = {
  push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {},
};

async function renderShell(locale: "en" | "hu"): Promise<string> {
  const messages = JSON.parse(await readFile(
    new URL(`../messages/${locale}.json`, import.meta.url),
    "utf8",
  ));
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router as never },
    createElement(
      PathnameContext.Provider,
      { value: "/" },
      createElement(
        NextIntlClientProvider,
        { locale, messages, timeZone: "UTC" },
        createElement(Shell, {
          adminEmail: "ops@friending.com",
          personaConsoleReady: true,
          verificationConsoleReady: true,
          audienceVisibilityConsoleReady: true,
          profileTextModerationConsoleReady: true,
          children: createElement("div", { className: "probe" }, "content"),
        }),
      ),
    ),
  ));
}

/**
 * T-799. The owner asked for the account block "ne legalulra, hanem közvetlen
 * a felső logó alá": it must render AFTER the brand logo and BEFORE the
 * scrolling nav, in exactly one place, with the same four controls.
 */
test("the sidebar account block renders after the logo and before the nav", async () => {
  for (const locale of ["en", "hu"] as const) {
    const html = await renderShell(locale);

    const logo = html.indexOf('<img src="/logo.svg"');
    const account = html.indexOf('class="sidebar-account"');
    const nav = html.indexOf('class="main-nav"');

    assert.ok(logo >= 0, `${locale}: the brand logo must render`);
    assert.ok(account >= 0, `${locale}: the account block must render`);
    assert.ok(nav >= 0, `${locale}: the nav must render`);
    assert.ok(logo < account, `${locale}: the account block must follow the logo`);
    assert.ok(account < nav, `${locale}: the account block must precede the nav`);

    // One block only — the old bottom-of-sidebar copy is gone, not duplicated.
    assert.equal(html.split('class="sidebar-account"').length - 1, 1);
    assert.doesNotMatch(html, /sidebar-footer/);

    const block = html.slice(account, nav);
    assert.match(block, /class="avatar-dot">O</, `${locale}: the initial stays`);
    assert.match(block, /title="ops@friending\.com">ops@friending\.com</);
    assert.match(block, /class="locale-picker"/);
    assert.match(block, /<option value="en"[^>]*>EN<\/option>/);
    assert.match(block, /<option value="hu"[^>]*>HU<\/option>/);
    assert.match(block, locale === "en" ? /class="text-button">Sign out</ : /class="text-button">Kijelentkezés</);
  }
});

/**
 * The block sits above the nav, so it must not be the flex item that scrolls:
 * `.main-nav` keeps the sidebar's only scroll area, and the account block is
 * fixed-height, which is what keeps it reachable on a 700px-tall viewport.
 */
test("the sidebar CSS gives the nav the scroll and the account block a fixed height", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  const account = /\.sidebar-account \{([^}]*)\}/.exec(css);
  assert.ok(account, ".sidebar-account must be styled");
  assert.match(account[1], /flex:\s*0 0 auto/);
  assert.match(account[1], /border-bottom:\s*1px solid var\(--border\)/);
  assert.doesNotMatch(account[1], /margin-top:\s*auto/);
  assert.doesNotMatch(account[1], /overflow/);

  const nav = /\.main-nav \{([^}]*)\}/.exec(css);
  assert.ok(nav, ".main-nav must be styled");
  assert.match(nav[1], /flex:\s*1 1 auto/);
  assert.match(nav[1], /min-height:\s*0/);
  assert.match(nav[1], /overflow-y:\s*auto/);

  assert.doesNotMatch(css, /\.sidebar-footer\b/);
});

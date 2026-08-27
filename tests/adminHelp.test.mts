import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_HELP_PAGES,
  adminHelpPageForPath,
} from "../lib/adminHelp.ts";

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
  // 235 since T-218: the Footprints visits switch is its own contract with its
  // own permission and revision, so it earns its own Help section.
  assert.equal(totalSections, 235, "review the functional-section census when the UI changes");

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

test("the authenticated shell always renders the visible accessible Help control", async () => {
  const shell = await readFile(path.join(root, "components", "Shell.tsx"), "utf8");
  const component = await readFile(path.join(root, "components", "AdminHelp.tsx"), "utf8");

  assert.match(shell, /import AdminHelp from "@\/components\/AdminHelp"/);
  assert.match(shell, /<AdminHelp \/>/);
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /<HelpIcon \/>/);
  assert.match(component, /t\("button"\)/);
  assert.match(component, /page\.sections\.map/);
});

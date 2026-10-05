import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ResearchAreaEditor, ResearchDefaultsEditor, ResearchSourceEditor } from "../components/DatesResearchEditors.tsx";
import { ResearchCommandFeedback, ResearchHelp, ResearchReason, ResearchValuesFields } from "../components/DatesResearchControls.tsx";
import DatesResearchRuns from "../components/DatesResearchRuns.tsx";
import DatesResearchBatch from "../components/DatesResearchBatch.tsx";
import { DATES_RESEARCH_VALUE_FIELDS } from "../lib/datesResearchAdmin.ts";
import { researchAuditReason } from "../lib/datesResearchProxy.ts";
import { GENUINE_AREA, GENUINE_DEFAULTS, GENUINE_LIMITS, GENUINE_SOURCE } from "./support/datesResearchCorpus.ts";

// Static renders of real components; no browser, mounted effects or provider
// integration is claimed. Inputs are genuine rows or explicitly DERIVED mutations.
const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function render(locale: string, ...children: ReactNode[]) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, ...children));
  assert.deepEqual(errors, [], `${locale}: all rendered messages resolve`);
  assert.doesNotMatch(html, new RegExp(["free", "love"].join(""), "i"));
  return html;
}
const props = { actor: "operator@example.test", manage: true, limits: GENUINE_LIMITS, reload: async () => {}, close: () => {} };
for (const locale of ["en", "hu"]) {
  test(`DERIVED render ${locale}: reason input does not narrow Core's trimmed Unicode bounds`, () => {
    for (const reason of ["😀".repeat(1000), `${" ".repeat(1001)}abc${" ".repeat(1001)}`]) {
      assert.equal(researchAuditReason(reason), true);
      const html = render(locale, createElement(ResearchReason, { value: reason, disabled: false, onChange: () => {} }));
      assert.match(html, /<textarea required="">/);
      assert.doesNotMatch(html, /\b(?:minlength|maxlength)=/i);
      assert.ok(html.includes(escaped(reason)));
    }
  });
  test(`DERIVED render ${locale}: defaults include every effective value, purpose, effect and cost`, () => {
    const copy = messages(locale).datesAdmin.research;
    const html = render(locale, createElement(ResearchDefaultsEditor, { ...props, defaults: GENUINE_DEFAULTS }));
    assert.ok(html.includes(escaped(copy.sections.defaults)));
    for (const field of [...DATES_RESEARCH_VALUE_FIELDS, "enabled", "auto_cities_enabled", "reason"]) {
      assert.ok(html.includes(escaped(copy.fields[field])), field);
      for (const part of ["purpose", "effect", "cost"]) assert.ok(html.includes(escaped(copy.help[field][part])), `${field}.${part}`);
    }
    assert.match(html, /min="6" max="2160"/);
    assert.match(html, /min="1" max="200"/);
  });
  test(`DERIVED render ${locale}: city inheritance and read-only map keep all field help`, () => {
    const copy = messages(locale).datesAdmin.research;
    const scope = { kind: "radius" as const, radius_km: 16.09344 };
    const row = { ...GENUINE_AREA, label: '<script>alert("city")</script>', country_code: "US", overrides: { ...GENUINE_AREA.overrides, scope }, effective: { ...GENUINE_AREA.effective, scope } };
    // A fake public key enables only the static iframe branch, not Google's
    // script or a mounted map. No socket or provider is reached by this render.
    const before = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "test-public-map-key-0000000000";
    let html: string;
    try { html = render(locale, createElement(ResearchAreaEditor, { ...props, row, defaults: GENUINE_DEFAULTS })); }
    finally { if (before === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY; else process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = before; }
    assert.ok(html.includes(escaped(row.label))); assert.equal(html.includes(row.label), false);
    assert.equal((html.match(new RegExp(escaped(copy.useGlobal), "g")) ?? []).length, 6);
    assert.ok(html.includes('value="mi" selected=""'));
    assert.ok(html.includes(escaped(messages(locale).appearance.map.mapReadOnlyHint)));
    assert.match(html, /appearance-map-iframe is-disabled/); assert.match(html, /tabindex="-1" aria-disabled="true"/);
    assert.ok(html.includes(escaped(copy.help.radius_km.cost)));
    assert.ok(html.includes(escaped(copy.help.mode.effect)));
  });
  test(`DERIVED render ${locale}: all sources can override the window; only official sources can autopublish`, () => {
    const copy = messages(locale).datesAdmin.research;
    const html = render(locale, createElement(ResearchSourceEditor, { ...props, row: GENUINE_SOURCE, defaults: GENUINE_DEFAULTS, areas: [GENUINE_AREA] }));
    for (const field of ["url", "label", "type", "city", "cadence_hours", "max_events", "window_days", "autopublish", "source_enabled", "archived", "reason"]) {
      assert.ok(html.includes(escaped(copy.fields[field])), field);
      assert.ok(html.includes(escaped(copy.help[field].cost)), `${field}.cost`);
    }
    assert.equal((html.match(new RegExp(escaped(copy.useInherited), "g")) ?? []).length, 2);
    const aggregator = render(locale, createElement(ResearchSourceEditor, { ...props, row: { ...GENUINE_SOURCE, type: "aggregator" }, defaults: GENUINE_DEFAULTS, areas: [GENUINE_AREA] }));
    assert.ok(aggregator.includes(escaped(copy.aggregatorHint)));
    assert.equal(aggregator.includes(escaped(copy.fields.autopublish)), false);
    assert.equal(aggregator.includes(escaped(copy.fields.window_days)), true);
    assert.equal((aggregator.match(new RegExp(escaped(copy.useInherited), "g")) ?? []).length, 1);
  });
  test(`DERIVED render ${locale}: read-only defaults expose no save, and run/batch filters resolve copy`, () => {
    const copy = messages(locale).datesAdmin.research;
    const html = render(locale, createElement(ResearchDefaultsEditor, { ...props, defaults: GENUINE_DEFAULTS, manage: false }));
    assert.equal(html.includes('type="submit"'), false); assert.ok(html.includes("disabled"));
    const filters = render(locale, createElement(DatesResearchRuns, { areas: [GENUINE_AREA], sources: [GENUINE_SOURCE], focusRunId: null, refresh: 0 }),
      createElement(DatesResearchBatch, { runId: "xrr_render_only", rows: [], actor: props.actor, manage: true, reload: props.reload }));
    for (const field of ["source", "city", "runKind"]) assert.ok(filters.includes(escaped(copy.fields[field])));
    for (const field of ["source", "public_venue", "timezone", "content_safe"]) assert.ok(filters.includes(escaped(copy.batch.confirmations[field])));
  });
  test(`render ${locale}: every help entry and command state resolves without fallback`, () => {
    const copy = messages(locale).datesAdmin.research;
    render(locale, ...Object.keys(copy.help).map((field) => createElement(ResearchHelp, { key: field, field, effective: "Example", own: true })));
    for (const kind of ["success", "conflict", "refused", "uncertain"] as const) {
      const command: any = { outcome: kind === "success" ? { kind, receipt: {} } : { kind, error: "example-refusal" }, pending: kind === "uncertain" ? {} : null,
        busy: false, retry: async () => {}, submit: async () => {}, clear: () => {} };
      const html = render(locale, createElement(ResearchCommandFeedback, { command }));
      assert.ok(html.includes(escaped(copy.command[kind])));
      assert.equal(html.includes(escaped(messages(locale).common.retry)), kind === "uncertain");
    }
  });
}
test("research EN/HU key trees match exactly, including help and closed vocabulary labels", () => {
  const paths = (value: unknown, prefix = ""): string[] => value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => paths(child, `${prefix}.${key}`)).sort() : [prefix];
  assert.deepEqual(paths(messages("en").datesAdmin.research), paths(messages("hu").datesAdmin.research));
});
test("DERIVED render: controls accept provider limits rather than client constants", () => {
  const html = render("en", createElement(ResearchValuesFields, { values: GENUINE_AREA.effective, limits: { ...GENUINE_LIMITS, target_events: { min: 9, max: 37 } },
    disabled: false, unit: "km", onUnit: () => {}, onChange: () => {} }));
  assert.match(html, /min="9" max="37"/);
});

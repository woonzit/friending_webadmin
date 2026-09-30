import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalProvenance from "../components/DatesExternalProvenance.tsx";
import { decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";

for (const locale of ["en", "hu"]) test(`safe external provenance renders actual Core content in ${locale} on both detail surfaces`, () => {
  const body = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8"));
  const event = decodeDatesExternalDetail(body, body.event.external_event_id)!.event;
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  const errors: unknown[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: (error) => errors.push(error) },
    createElement(DatesExternalProvenance, { event })));
  assert.deepEqual(errors, []);
  assert.ok(html.includes(messages.datesAdmin.external.provenance.adminEntered));
  assert.ok(html.includes(messages.datesAdmin.external.provenance.noAi));
  assert.ok(html.includes(event.sources[0].url));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /UID[ :]+0|operator@|admin_email|private_evidence/);
  for (const page of ["../components/DatesExternalEditorPage.tsx", "../app/(dashboard)/dates/[activityId]/page.tsx"])
    assert.match(readFileSync(new URL(page, import.meta.url), "utf8"), /<DatesExternalProvenance event=/);
});

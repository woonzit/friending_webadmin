import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ResearchFollowupCard, ResearchFollowupReason, researchFollowupWhen } from "../components/DatesResearchFollowups.tsx";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { ADMIN_ACTION_ACCESS, isAdminActionAllowed } from "../lib/adminActions.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { decodeResearchCommandReceipt, prepareResearchCommand, readResearchFollowups, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { datesResearchProxyCapabilityAuthorized, normalizeDatesResearchProxyBody } from "../lib/datesResearchProxy.ts";
import {
  decodeResearchFollowup, decodeResearchFollowupList, decodeResearchFollowupState, researchFollowupLink, researchFollowupNote, researchFollowupNoteValid,
  researchFollowupReasonWords, researchFollowupSearchUrl, type ResearchFollowup,
} from "../lib/datesResearchFollowups.ts";

// GENUINE: byte copies of Core's own corpus of the two follow-up routes (tests/fixtures/dates_event_research_followup_wire/provenance.txt).
// Every use below goes through the bridge's projection first, as the browser receives them. DERIVED cases say so.
const FIXTURES = new URL("./fixtures/dates_event_research_followup_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, FIXTURES));
const raw = (file: string) => JSON.parse(bytes(file).toString("utf8"));
const routeOf = (name: string) => name.startsWith("webadmin-followup-save-") ? "dates_event_research_followup_save" : "dates_event_research_followups";
const wire = (name: string): any => projectDatesAdminBody(routeOf(name), raw(`${name}.json`));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const listOf = (name: string) => { const list = decodeResearchFollowupList(wire(name)); assert.ok(list, name); return list; };
const OPEN = listOf("webadmin-followups-open");
const byTitle = (title: string): ResearchFollowup => { const row = OPEN.followups.rows.find((item) => item.title === title); assert.ok(row, title); return row; };
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
// DERIVED admin_me bodies: the Dates principal Core projects for an administrator and a moderator (lib/datesAdmin.ts).
const principal = (role: string, rank: number, capabilities: string[]) => ({ success: true, status_code: 200,
  dates: { email: "admin@example.test", role, rank, linked_uid: null, sensitive_location: false, break_glass: false, capabilities } });
const administrator = principal("administrator", 40, ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage"]);
const moderatorPrincipal = principal("moderator", 20, ["dates_external_event_read", "dates_external_event_review"]);

test("the corpus is Core's, byte for byte: every body has the sha256 its manifest names", () => {
  const manifest = raw("manifest.json") as { contract: string; source_commit: string; fixture_set_sha256: string; fixtures: { file: string; sha256: string; route: string }[] };
  assert.equal(manifest.contract, "dates-event-research-followup-v1");
  // The pin (docs/WIRE_CORPUS_PINNING.md): a body or a manifest changed here does not pass as Core's.
  assert.equal(manifest.fixture_set_sha256, "9c960f51d5c0c8f7b0118e041199bbd56b974349e1d7ed6fdf5a962e475f0d5e");
  assert.equal(manifest.source_commit, "fae3e450a0fff0f6056d597f7957760cea909cd8");
  const lines = manifest.fixtures.map(({ file, sha256 }) => {
    assert.equal(createHash("sha256").update(bytes(file)).digest("hex"), sha256, file);
    return `${file}\0${sha256}`;
  });
  assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), manifest.fixture_set_sha256);
  assert.deepEqual(readdirSync(FIXTURES).sort(), [...manifest.fixtures.map((item) => item.file), "manifest.json", "provenance.txt"].sort());
  for (const item of manifest.fixtures) assert.equal(item.route, `/v1/webadmin/${routeOf(item.file)}`, item.file);
});

test("the projection names every field Core serves: a genuine body reaches the browser whole", () => {
  for (const file of readdirSync(FIXTURES).filter((name) => name.startsWith("webadmin-"))) {
    const body = raw(file);
    assert.deepEqual(projectDatesAdminBody(routeOf(file), body), body, file);
  }
});

test("genuine list: nine rows newest first, every one decoded, the facets and the horizon", () => {
  assert.deepEqual(OPEN.followups.unreadable, []);
  assert.deepEqual(OPEN.followups.rows.map((row) => [row.group, row.reason]), [["fetch", "fetch_failed"], ["validation", "validation_failed"], ["fetch", "over_cap"],
    ["other", "blocked_domain"], ["other", "no_event_page"], ["gate", "research_not_publishable"], ["fetch", "robots_disallowed"], ["validation", "validation_failed"], ["fetch", "fetch_failed"]]);
  assert.deepEqual(OPEN.counts.states, { open: 9, done: 0, dismissed: 0 });
  assert.deepEqual(OPEN.counts.groups, { fetch: 4, validation: 2, gate: 1, other: 2 });
  assert.equal(OPEN.counts.areas[0].label, "Berkeley"); assert.equal(OPEN.counts.areas[1].area_id, null);
  assert.equal(OPEN.horizon_days, 60); assert.equal(OPEN.truncated, false); assert.equal(OPEN.next_cursor, null);
  const page1 = listOf("webadmin-followups-page-1"), page2 = listOf("webadmin-followups-page-2");
  assert.deepEqual([...page1.followups.rows, ...page2.followups.rows].map((row) => row.key), OPEN.followups.rows.slice(0, 6).map((row) => row.key));
  assert.ok(page1.next_cursor && page2.next_cursor);
  // A search that finds nothing is a PROVEN empty list (decoded, zero counts), not a read failure.
  const empty = listOf("webadmin-followups-empty");
  assert.deepEqual(empty.followups, { rows: [], unreadable: [] }); assert.deepEqual(empty.counts.states, { open: 0, done: 0, dismissed: 0 });
  assert.deepEqual(listOf("webadmin-followups-group-gate").followups.rows.map((row) => row.reason), ["research_not_publishable"]);
  assert.deepEqual(listOf("webadmin-followups-area-none").followups.rows.map((row) => row.run_kind), ["source"]);
  assert.equal(listOf("webadmin-followups-done").followups.rows[0].state, "done");
  assert.equal(listOf("webadmin-followups-all").followups.rows.length, 9);
});

test("genuine rows: what was found, the link, and the reason in the console's words", () => {
  const ra = byTitle("Dekmantel Soundsystem");
  assert.equal(ra.url, "https://ra.co/events/2071111"); assert.equal(ra.detail.http_status, 403); assert.equal(ra.seen_count, 2);
  assert.deepEqual(researchFollowupReasonWords(ra), { key: "fetchRefused", values: { status: 403 } });
  const sfmoma = byTitle("Art of Noise");
  assert.deepEqual(researchFollowupReasonWords(sfmoma), { key: "validationHardFails" });
  assert.equal(researchFollowupWhen(sfmoma.found), "2026-11-01 10:00 – 2027-04-04 17:00 (America/Los_Angeles)");
  assert.equal(sfmoma.topic, "art exhibitions");
  assert.deepEqual(researchFollowupReasonWords(byTitle("Lantern Parade")), { key: "fetchBudget" });
  assert.deepEqual(researchFollowupReasonWords(byTitle("Campus Film Night")), { key: "robots" });
  assert.deepEqual(researchFollowupReasonWords(byTitle("Sunset Jazz Picnic")), { key: "fetchFailed" });
  assert.deepEqual(researchFollowupReasonWords(byTitle("Őszi Kamarakoncert")), { key: "validationTitle" });
  assert.deepEqual(researchFollowupReasonWords(byTitle("Pop-up Gallery")), { key: "noEventPage" });
  assert.deepEqual(researchFollowupReasonWords(byTitle("Club Night")), { key: "blockedDomain" });
  const gate = byTitle("Jazz at the Freight");
  assert.deepEqual(researchFollowupReasonWords(gate), { key: "gate" }); assert.equal(gate.detail.gate, "venue-unverified");
  assert.equal(researchFollowupWhen(gate.found), "2027-01-20 20:00 (America/Los_Angeles)");
  assert.equal(byTitle("Pop-up Gallery").url, null);
  const search = new URL(researchFollowupSearchUrl(sfmoma));
  assert.equal(search.origin + search.pathname, "https://www.google.com/search");
  assert.equal(search.searchParams.get("q"), "Art of Noise SFMOMA 2026-11-01");
  assert.equal(new URL(researchFollowupSearchUrl(byTitle("Pop-up Gallery"))).searchParams.get("q"), "Pop-up Gallery A warehouse This weekend");
  assert.equal(new URL(researchFollowupSearchUrl(byTitle("Őszi Kamarakoncert"))).searchParams.get("q"), "Őszi Kamarakoncert 2027-01-28T19:00:00+01:00");
  // DERIVED: the status words of the other fetch answers.
  const status = (http_status: number | null) => researchFollowupReasonWords({ reason: "fetch_failed", detail: { ...ra.detail, http_status } }).key;
  assert.deepEqual([401, 451, 404, 410, 429, 500, null].map(status), ["fetchRefused", "fetchRefused", "fetchNotFound", "fetchNotFound", "fetchRateLimited", "fetchStatus", "fetchFailed"]);
});

test("DERIVED rows fail closed one by one; the list never turns a malformed row into an empty one", () => {
  const good = raw("webadmin-followups-open.json").followups[1];
  for (const [label, mutate] of [
    ["a group that is not its reason's", (row: any) => { row.group = "other"; }],
    ["a gate row without its intake", (row: any) => { row.group = "gate"; row.reason = "research_not_publishable"; }],
    ["a script link", (row: any) => { row.url = "javascript:alert(1)"; }],
    ["a credentialed link", (row: any) => { row.url = "https://user:pass@ra.co/events/1"; }],
    ["an unsaved row with a note", (row: any) => { row.note = "typed"; }],
    ["a saved row without its updater", (row: any) => { row.revision = 1; row.updated_at = 1; }],
    ["an unknown state", (row: any) => { row.state = "closed"; }],
    ["a missing key", (row: any) => { delete row.seen_count; }],
    ["a found record without a key", (row: any) => { row.found = {}; }],
    ["an HTTP status outside 100-599", (row: any) => { row.detail.http_status = 700; }],
    ["a malformed key", (row: any) => { row.key = "rfu_x"; }],
  ] as const) {
    const row = copy(good); mutate(row);
    assert.equal(decodeResearchFollowup(row), null, label);
    const body = copy(raw("webadmin-followups-open.json")); body.followups[1] = row;
    const list = decodeResearchFollowupList(body);
    assert.ok(list, label); assert.deepEqual(list.followups.unreadable.map((item) => item.index), [1], label);
  }
  const duplicate = copy(raw("webadmin-followups-open.json")); duplicate.followups[1].key = duplicate.followups[0].key;
  assert.deepEqual(decodeResearchFollowupList(duplicate)!.followups.unreadable.map((item) => item.index), [0, 1]);
  for (const mutate of [(body: any) => { body.counts.states.open = -1; }, (body: any) => { body.followups = {}; }, (body: any) => { body.next_cursor = "x"; },
    (body: any) => { body.success = false; }, (body: any) => { body.counts.areas.push(copy(body.counts.areas[0])); }]) {
    const body = copy(raw("webadmin-followups-open.json")); mutate(body);
    assert.equal(decodeResearchFollowupList(body), null);
  }
  assert.equal(researchFollowupLink("https://ra.co/events/1"), true);
  for (const value of ["ftp://ra.co/x", "/relative", "https://", "https://ra.co/a b", 5]) assert.equal(researchFollowupLink(value), false, String(value));
});

test("genuine reads through the console: ready with write authority, and each refusal kind", async () => {
  const send = (followups: unknown, me: unknown = administrator) => async (action: string) => action === "admin_me" ? me : followups;
  const ready = await readResearchFollowups(send(wire("webadmin-followups-open")), {});
  assert.equal(ready.kind, "ready"); assert.equal(ready.kind === "ready" && ready.manage, true);
  const read = await readResearchFollowups(send(wire("webadmin-followups-moderator"), moderatorPrincipal), {});
  assert.equal(read.kind === "ready" && read.manage, false);
  assert.deepEqual(await readResearchFollowups(send(wire("webadmin-followups-viewer-denied")), {}), { kind: "denied" });
  assert.deepEqual(await readResearchFollowups(send(wire("webadmin-followups-selector-denied")), {}), { kind: "unavailable" });
  assert.deepEqual(await readResearchFollowups(send(wire("webadmin-followups-filter-denied")), {}), { kind: "refused", error: "dates-research-filter-invalid" });
  assert.deepEqual(await readResearchFollowups(send({ success: true, status_code: 200 }), {}), { kind: "unconfirmed" });
  assert.deepEqual(await readResearchFollowups(async () => { throw new Error("offline"); }, {}), { kind: "unconfirmed" });
});

test("genuine save receipts settle the command; a conflict reloads; refusals that wrote nothing settle", async () => {
  const sfmoma = byTitle("Art of Noise");
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_followup_save",
    { key: sfmoma.key, state: "done", note: "Added by hand from the museum page.", expected_revision: 0 })!;
  assert.ok(command);
  const done = decodeResearchCommandReceipt(command, wire("webadmin-followup-save-done"));
  assert.equal(done?.kind, "success"); assert.equal(done?.kind === "success" && done.replayed, false);
  assert.deepEqual(done?.kind === "success" && done.receipt, decodeResearchFollowupState(raw("webadmin-followup-save-done.json").followup));
  assert.equal(decodeResearchCommandReceipt(command, wire("webadmin-followup-save-replay"))?.kind, "success");
  // The receipt must be of THIS save: another revision, state or note is not.
  for (const body of [{ ...command.body, expected_revision: 1 }, { ...command.body, state: "dismissed" }, { ...command.body, note: "Another note" }]) {
    assert.equal(decodeResearchCommandReceipt({ ...command, body }, wire("webadmin-followup-save-done")), null);
  }
  // Core trims the note; a padded draft is the same note.
  assert.equal(decodeResearchCommandReceipt({ ...command, body: { ...command.body, note: "  Added by hand from the museum page.\n" } }, wire("webadmin-followup-save-done"))?.kind, "success");
  const answer = (body: unknown) => runResearchCommand(async () => body, command);
  assert.deepEqual(await answer(wire("webadmin-followup-save-conflict")), { kind: "conflict", error: "dates-research-conflict", cause: "revision" });
  assert.deepEqual(await answer(wire("webadmin-followup-save-not-found")), { kind: "refused", error: "dates-research-not-found" });
  assert.deepEqual(await answer(wire("webadmin-followup-save-note-denied")), { kind: "refused", error: "dates-research-values-invalid" });
  assert.equal((await answer(wire("webadmin-followup-save-moderator-denied"))).kind, "uncertain");
  const reopen = prepareResearchCommand("admin@example.test", "dates_event_research_followup_save", { key: sfmoma.key, state: "open", expected_revision: 1 })!;
  assert.equal(decodeResearchCommandReceipt(reopen, wire("webadmin-followup-save-reopen"))?.kind, "success");
  assert.equal(researchFollowupNote("  \n"), null); assert.equal(researchFollowupNoteValid("x".repeat(500)), true);
  assert.equal(researchFollowupNoteValid("x".repeat(501)), false); assert.equal(researchFollowupNoteValid("bell\u0007"), false);
});

test("the bridge: allow-listed, the read is a reviewer's and the save an administrator's, closed request shapes", () => {
  assert.equal(isAdminActionAllowed("dates_event_research_followups"), true); assert.equal(isAdminActionAllowed("dates_event_research_followup_save"), true);
  assert.equal(ADMIN_ACTION_ACCESS.dates_event_research_followups, "dates_read"); assert.equal(ADMIN_ACTION_ACCESS.dates_event_research_followup_save, "dates_write");
  assert.equal(isAdminClientReadAction("dates_event_research_followups"), true); assert.equal(isAdminClientReadAction("dates_event_research_followup_save"), false);
  assert.equal(datesResearchProxyCapabilityAuthorized("dates_event_research_followups", moderatorPrincipal), true);
  assert.equal(datesResearchProxyCapabilityAuthorized("dates_event_research_followup_save", moderatorPrincipal), false);
  assert.equal(datesResearchProxyCapabilityAuthorized("dates_event_research_followup_save", administrator), true);
  // The bridge adds the research selector (and, as to every Dates action, the intake selector, which Core's research routes accept).
  for (const action of ["dates_event_research_followups", "dates_event_research_followup_save"]) {
    assert.equal(withDatesAdminContract(action, Object.create(null)).dates_event_research_admin_contract_version, 1, action);
  }
  const list = (body: Record<string, unknown>) => normalizeDatesResearchProxyBody("dates_event_research_followups", body);
  assert.deepEqual(list({}), {});
  assert.deepEqual(list({ area_id: "", group: "", state: "open", q: "", cursor: "" }), { state: "open" });
  assert.deepEqual(list({ area_id: "none", group: "gate", state: "all", q: "SFMOMA", limit: 100, cursor: `1800000000:rru_${"2".repeat(32)}:12` }),
    { area_id: "none", group: "gate", state: "all", q: "SFMOMA", limit: 100, cursor: `1800000000:rru_${"2".repeat(32)}:12` });
  for (const bad of [{ group: "gates" }, { state: "closed" }, { limit: 0 }, { limit: 101 }, { limit: "" }, { cursor: "x" }, { q: "a".repeat(201) }, { q: "a\nb" }, { area_id: 5 }, { other: "1" }]) {
    assert.equal(list(bad), null, JSON.stringify(bad));
  }
  const key = byTitle("Art of Noise").key;
  const save = (body: Record<string, unknown>) => normalizeDatesResearchProxyBody("dates_event_research_followup_save", body);
  const valid = { key, state: "done", expected_revision: 0, idempotency_key: "dates-research-0123456789abcdef" };
  assert.deepEqual(save(valid), valid); assert.deepEqual(save({ ...valid, note: "By hand." }), { ...valid, note: "By hand." });
  for (const bad of [{ ...valid, key: "rfu_x" }, { ...valid, state: "all" }, { ...valid, expected_revision: -1 }, { ...valid, note: "n".repeat(501) },
    { ...valid, idempotency_key: "short" }, { ...valid, extra: 1 }, { key, state: "done", idempotency_key: valid.idempotency_key }]) {
    assert.equal(save(bad), null, JSON.stringify(bad));
  }
});

const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function render(locale: string, child: ReactNode) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, child));
  assert.deepEqual(errors, [], `${locale}: every rendered message resolves`);
  return html;
}
const card = (row: ResearchFollowup, manage = true) => createElement(ResearchFollowupCard, { row, manage, busy: false, note: row.note ?? "", onNote: () => {}, onSave: () => {} });
for (const locale of ["en", "hu"]) {
  test(`render ${locale}: every genuine row in words, with its links opening in a new tab without a referrer`, () => {
    const copyOf = messagesOf(locale).datesAdmin.research.followups;
    for (const row of OPEN.followups.rows) {
      const html = render(locale, card(row));
      assert.ok(html.includes(escaped(row.title)), row.title);
      assert.ok(html.includes(`href="${escaped(researchFollowupSearchUrl(row))}" target="_blank" rel="noopener noreferrer"`), `${row.title}: Google search`);
      if (row.url) assert.ok(html.includes(`href="${escaped(row.url)}" target="_blank" rel="noopener noreferrer"`), `${row.title}: the page`);
      else assert.ok(html.includes(escaped(copyOf.noLink)));
      assert.ok(html.includes(escaped(copyOf.actions.done)) && html.includes(escaped(copyOf.actions.dismiss)) && !html.includes(escaped(copyOf.actions.reopen)));
    }
    const reason = (title: string) => render(locale, createElement(ResearchFollowupReason, { row: byTitle(title) }));
    const hardFails = copyOf.hardFails, blockers = messagesOf(locale).datesAdmin.research.closure.blockers;
    assert.ok(reason("Dekmantel Soundsystem").includes(escaped(copyOf.reasons.fetchRefused.replace("{status}", "403"))));
    assert.ok(reason("Art of Noise").includes(`${escaped(hardFails.venue_unresolved)} · ${escaped(hardFails.duration_too_long)}`));
    assert.ok(reason("Lantern Parade").includes(escaped(copyOf.reasons.fetchBudget)));
    assert.ok(reason("Jazz at the Freight").includes(`${escaped(copyOf.reasons.gate)}: ${escaped(blockers["venue-unverified"])}`));
    // A code the console does not word is shown as Core wrote it.
    const unknown = { ...byTitle("Jazz at the Freight"), detail: { ...byTitle("Jazz at the Freight").detail, gate: "dates-external-organizer-required" } };
    assert.ok(render(locale, createElement(ResearchFollowupReason, { row: unknown })).includes("<code>dates-external-organizer-required</code>"));
    const done = listOf("webadmin-followups-done").followups.rows[0];
    const doneHtml = render(locale, card(done));
    assert.ok(doneHtml.includes(escaped(copyOf.actions.reopen)) && !doneHtml.includes(escaped(copyOf.actions.dismiss)) && doneHtml.includes(escaped(done.note!)));
    const readOnly = render(locale, card(byTitle("Art of Noise"), false));
    assert.ok(!readOnly.includes("<button") && !readOnly.includes("<textarea"), "a reviewer without write authority gets no controls");
  });
}
test("American English copy for the new page", () => {
  const text = JSON.stringify([messagesOf("en").datesAdmin.research.followups, messagesOf("en").adminHelp.pages.datesResearchFollowups]);
  for (const british of ["colour", "organis", "cancell", "behaviour", "catalogue", "favour", "centre"]) assert.equal(text.toLowerCase().includes(british), false, british);
});

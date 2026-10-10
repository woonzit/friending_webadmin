import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { DatesCaseEventLink, DatesCaseTarget, DatesReportEntryPoint } from "../components/DatesCaseLabels.tsx";
import { DATES_CASE_TARGET_KINDS, DATES_NAMED_ENTRY_POINTS, DATES_REPORT_ENTRY_POINTS, datesCaseTargetKind,
  type DatesCaseSummary } from "../lib/datesAdmin.ts";
import { datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";

// How the queue and the case page name what a case is about, where its event is, and where a report came from.
//
// No pinned corpus carries a case about wall content yet (Core's own bodies arrive with the host-moderation contract),
// so the wall rows below are DERIVED and marked so: a genuine queue row, or a genuine case detail, given the ids of the
// genuinely reported wall post of the event-content corpus (`admin-wall-posts.json` lists it with its case) and of a
// genuine comment of that event. Every derived body goes through the production decoder before anything reads it.
const fixture = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), "utf8"));
const wallPosts = fixture("dates_event_content_wire/admin-wall-posts"), wallComments = fixture("dates_event_content_wire/admin-wall-comments");
const reportedPost = wallPosts.items.find((row: { case_id: string | null }) => row.case_id !== null);
const comment = wallComments.items.find((row: { state: string; root_id: string | null }) => row.state === "active" && row.root_id === null);
const EVENT: string = wallPosts.activity_id;
const POST: string = reportedPost.id, POST_CASE: string = reportedPost.case_id, COMMENT: string = comment.id;

const consoleQueue = fixture("dates_moderation_console_wire/admin-queue-page-one");
const heldChatQueue = fixture("dates_external_admin_wire/admin-chat-approve-queue");
const externalQueue = fixture("dates_external_admin_wire/admin-moderation-queue");
const reportDetail = fixture("dates_moderation_wire/admin-detail-report-viewer");

/** DERIVED: a genuine `reports` row of the console corpus as the message case Core opens for reported wall content. */
function wallQueue(targetId: string, caseId = POST_CASE) {
  const body = structuredClone(consoleQueue);
  Object.assign(body.cases[0], { case_id: caseId, queue: "messages", target_type: "message", target_id: targetId, activity_id: EVENT });
  const decoded = datesModerationQueue(body, { page: body.page, limit: body.limit });
  assert.ok(decoded, "the derived wall row passes the production queue decoder");
  return decoded.cases[0];
}
const decodedRows = (body: { page: number; limit: number }) => datesModerationQueue(body, { page: body.page, limit: body.limit })!.cases;

const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
function render(locale: string, element: ReturnType<typeof createElement>) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, element));
  assert.deepEqual(errors, [], "every message the label asks for exists");
  return html;
}
const target = (locale: string, item: Pick<DatesCaseSummary, "target_type" | "target_id">) => render(locale, createElement(DatesCaseTarget, { item }));

test("a message case about wall content is told from a chat message by Core's own id test, and by nothing looser", () => {
  assert.deepEqual([...DATES_CASE_TARGET_KINDS], ["wall_post", "wall_comment"]);
  assert.match(POST, /^wpo_[a-f0-9]{32}$/); assert.match(COMMENT, /^wco_[a-f0-9]{32}$/);
  assert.equal(datesCaseTargetKind(wallQueue(POST)), "wall_post");
  assert.equal(datesCaseTargetKind(wallQueue(COMMENT)), "wall_comment");
  // A reply is a row of the comments collection: its id says "comment", and the label does not claim more.
  const reply = wallComments.items.find((row: { root_id: string | null }) => row.root_id !== null);
  assert.equal(datesCaseTargetKind({ target_type: "message", target_id: reply.id }), "wall_comment");
  // Genuine rows that are not wall content: a held chat message (also a `message` case), an activity, an appeal, an external event.
  for (const row of [...decodedRows(heldChatQueue), ...decodedRows(consoleQueue), ...decodedRows(fixture("dates_moderation_console_wire/admin-queue-page-two")), ...decodedRows(externalQueue)]) {
    assert.equal(datesCaseTargetKind(row), null, `${row.target_type} ${row.target_id}`);
  }
  // The wall's ids name wall content only on a message case, and only in Core's exact form (DatesId::isValid).
  for (const target_type of ["activity", "user", "review", "appeal", "external_event", "Message", ""]) {
    assert.equal(datesCaseTargetKind({ target_type, target_id: POST }), null, target_type);
  }
  const hex = POST.slice(4);
  for (const target_id of [`wpo_${hex.slice(1)}`, `wpo_${hex}0`, `WPO_${hex}`, `wpo_${hex.toUpperCase()}`, ` wpo_${hex}`, `wpo_${hex}\n`, `wpo-${hex}`, `wpx_${hex}`,
    `msg_${hex}`, `x wco_${hex}`, "wpo_", "wco_", ""]) {
    assert.equal(datesCaseTargetKind({ target_type: "message", target_id }), null, JSON.stringify(target_id));
  }
  for (const target_id of [null, undefined, 1, [POST], { id: POST }]) {
    assert.equal(datesCaseTargetKind({ target_type: "message", target_id: target_id as unknown as string }), null, JSON.stringify(target_id));
  }
});

for (const locale of ["en", "hu"]) test(`${locale}: the queue row and the case overview name a wall post and a wall comment, and leave every other target as it was`, () => {
  const all = messagesOf(locale), kinds = all.datesAdmin.moderation.targetKinds;
  assert.equal(target(locale, wallQueue(POST)), `${kinds.wall_post} · ${POST}`);
  assert.equal(target(locale, wallQueue(COMMENT)), `${kinds.wall_comment} · ${COMMENT}`);
  assert.deepEqual([kinds.wall_post, kinds.wall_comment], locale === "en" ? ["Wall post", "Wall comment"] : ["Falposzt", "Falkomment"]);
  // Genuine rows: a held chat message stays a message, an activity an activity, an external event keeps its own name.
  const held = decodedRows(heldChatQueue)[0], activity = decodedRows(consoleQueue)[0], external = decodedRows(externalQueue)[0];
  assert.equal(target(locale, held), `message · ${held.target_id}`);
  assert.equal(target(locale, activity), `activity · ${activity.target_id}`);
  assert.equal(external.target_type, "external_event");
  assert.equal(target(locale, external), `${all.datesAdmin.external.moderation.target} · ${external.target_id}`);
  // A target type this console has never seen is printed, not named and not looked up.
  assert.equal(target(locale, { target_type: "future_surface", target_id: POST }), `future surface · ${POST}`);
  // The same from a case detail (DERIVED from the genuine report case: the wall post's ids and the wall's entry point).
  const body = structuredClone(reportDetail);
  Object.assign(body.case, { queue: "messages", target_type: "message", target_id: POST, activity_id: EVENT });
  body.reports[0].entry_point = "event_wall";
  const detail = datesCaseDetail(body, body.case.case_id);
  assert.ok(detail, "the derived wall case passes the production detail decoder");
  assert.equal(target(locale, detail.case), `${kinds.wall_post} · ${POST}`);
  assert.equal(render(locale, createElement(DatesReportEntryPoint, { value: detail.reports[0].entry_point })), all.datesAdmin.caseDetail.entryPoints.event_wall);
});

for (const locale of ["en", "hu"]) test(`${locale}: the case's event is a link to its page, and a report's entry point is named where the console has a name for it`, () => {
  const copy = messagesOf(locale).datesAdmin.caseDetail;
  const link = render(locale, createElement(DatesCaseEventLink, { activityId: EVENT }));
  assert.match(link, /^<a [^>]*>[^<]*<\/a>$/, "one link and nothing else");
  assert.ok(link.includes(` href="/dates/${EVENT}"`)); assert.ok(link.includes(` title="${copy.openEvent}"`)); assert.ok(link.endsWith(`>${EVENT}</a>`));
  assert.equal(copy.openEvent, locale === "en" ? "Open the event page" : "Az esemény oldalának megnyitása");
  // The genuine case detail's own event, as the decoder hands it over.
  const genuine = datesCaseDetail(reportDetail, reportDetail.case.case_id)!;
  assert.ok(render(locale, createElement(DatesCaseEventLink, { activityId: genuine.case.activity_id! })).includes(`href="/dates/${genuine.case.activity_id}"`));
  // An id is one path segment whatever it holds (the decoder admits only act_ + 32 hex; the link does not rely on it).
  assert.ok(render(locale, createElement(DatesCaseEventLink, { activityId: "../users/1?x=y#z" })).includes('href="/dates/..%2Fusers%2F1%3Fx%3Dy%23z"'));

  const entry = (value: string) => render(locale, createElement(DatesReportEntryPoint, { value }));
  assert.equal(entry("event_wall"), locale === "en" ? "Event wall" : "Eseményfal");
  // The genuine report's entry point has no name in the console: it is printed as before.
  assert.equal(genuine.reports[0].entry_point, "activity_detail");
  assert.equal(entry(genuine.reports[0].entry_point), "activity detail");
  assert.equal(entry("message_action"), "message action");
  // Core's text is never a message key: a value that happens to be a property name, or a path, is printed like any other.
  for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty", "entryPoints.event_wall", "event_wall.x", "EVENT_WALL", " event_wall"]) {
    assert.equal(entry(value), value.replace(/^dates_/, "").replaceAll("_", " "), value);
  }
});

test("both languages name exactly the target kinds and entry points the console names, and the pages only print what the one function answers", () => {
  for (const locale of ["en", "hu"]) {
    const dates = messagesOf(locale).datesAdmin;
    assert.deepEqual(Object.keys(dates.moderation.targetKinds), [...DATES_CASE_TARGET_KINDS], `${locale} target kinds`);
    assert.deepEqual(Object.keys(dates.caseDetail.entryPoints), [...DATES_NAMED_ENTRY_POINTS], `${locale} entry points`);
  }
  // A named entry point is one a reason can list.
  const known = Object.values(DATES_REPORT_ENTRY_POINTS).flat();
  for (const value of DATES_NAMED_ENTRY_POINTS) assert.ok(known.includes(value), value);

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const queuePage = read("../app/(dashboard)/dates/moderation/page.tsx"), casePage = read("../app/(dashboard)/dates/moderation/[caseId]/page.tsx");
  const labels = read("../components/DatesCaseLabels.tsx"), lib = read("../lib/datesAdmin.ts");
  assert.match(queuePage, /<span><DatesCaseTarget item=\{row\} \/><\/span>/);
  assert.match(casePage, /<dt>\{t\("target"\)\}<\/dt><dd><DatesCaseTarget item=\{item\} \/><\/dd>/);
  assert.match(casePage, /\{item\.activity_id && <> · <DatesCaseEventLink activityId=\{item\.activity_id\} \/><\/>\}/);
  assert.match(casePage, /<td><DatesReportEntryPoint value=\{report\.entry_point\} \/><\/td>/);
  // The event is no longer printed as text beside the subject, and the entry point no longer as a bare machine key.
  assert.doesNotMatch(casePage, /\$\{item\.activity_id\}|humanizeMachineKey\(report\.entry_point\)/);
  // One place reads an id for its meaning: the swap to a field Core serves is a change of that function alone.
  for (const [name, source] of [["queue page", queuePage], ["case page", casePage], ["labels", labels]] as const) {
    assert.doesNotMatch(source, /wpo_|wco_/, name);
  }
  assert.equal((queuePage + casePage).includes("datesCaseTargetKind"), false, "the pages mount the label; they do not decide it");
  assert.equal((labels.match(/datesCaseTargetKind\(/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wpo_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wco_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
});

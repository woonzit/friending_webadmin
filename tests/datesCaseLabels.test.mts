import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { DatesCaseEventLink, DatesCaseHostBadge, DatesCaseHostReview, DatesCaseTarget, DatesReportEntryPoint } from "../components/DatesCaseLabels.tsx";
import { DATES_CASE_HOST_STATES, DATES_CASE_TARGET_KINDS, DATES_HOST_DECISIONS, DATES_NAMED_ENTRY_POINTS, DATES_REPORT_ENTRY_POINTS, datesCaseTargetKind,
  type DatesCaseSummary } from "../lib/datesAdmin.ts";
import { formatDate } from "../lib/format.ts";
import { datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";

// How the queue and the case page name what a case is about, where its event is, where a report came from, and what
// the event's host did about it.
//
// GENUINE: Core's host moderation console corpus (tests/fixtures/dates_host_moderation_admin_wire; pinned in
// tests/datesHostModerationWire.test.mts) - a queue with wall, chat and member cases the host kept, acted on or has not
// decided, the case detail of one of them, and their `-released` twins without the additions; and the older corpora for
// the targets that are not about a message.
// DERIVED, and marked so at each use: what no genuine body holds. A body of a Core without host moderation that carries
// wall content (the PART-A rows: a genuine queue row or case detail given the ids of a genuine wall post and comment),
// a direct-chat case, a case the host is not shown, a member the host removed. Every derived body goes through the
// production decoder before anything reads it.
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
const hostQueue = fixture("dates_host_moderation_admin_wire/admin-moderation-queue"), hostQueueReleased = fixture("dates_host_moderation_admin_wire/admin-moderation-queue-released");
const hostDetail = fixture("dates_host_moderation_admin_wire/admin-moderation-detail"), hostDetailReleased = fixture("dates_host_moderation_admin_wire/admin-moderation-detail-released");
const HOST = 8101, DECIDED_AT = 1790000000;
/** A case no host is shown: no review, and no review of any event (the list is optional on every case; Core's final capture may carry it). */
const NOT_SHOWN = { host_visible: false, host_review: null, host_reviews: [] };

/** DERIVED: a genuine `reports` row of the console corpus as the message case Core opens for reported wall content. */
function wallQueue(targetId: string, caseId = POST_CASE) {
  const body = structuredClone(consoleQueue);
  Object.assign(body.cases[0], { case_id: caseId, queue: "messages", target_type: "message", target_id: targetId, activity_id: EVENT });
  const decoded = datesModerationQueue(body, { page: body.page, limit: body.limit });
  assert.ok(decoded, "the derived wall row passes the production queue decoder");
  return decoded.cases[0];
}
const decodedRows = (body: { page: number; limit: number }) => datesModerationQueue(body, { page: body.page, limit: body.limit })!.cases;
/** DERIVED: a genuine row of Core's host moderation queue with the given change, read by the production decoder. */
function hostRow(index: number, change: Record<string, unknown>) {
  const body = structuredClone(hostQueue); Object.assign(body.cases[index], change);
  const decoded = datesModerationQueue(body, { page: body.page, limit: body.limit });
  assert.ok(decoded, `the derived row passes the production queue decoder: ${JSON.stringify(change)}`);
  return decoded.cases[index];
}

const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
function render(locale: string, element: ReturnType<typeof createElement>) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, element));
  assert.deepEqual(errors, [], "every message the label asks for exists");
  return html;
}
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const target = (locale: string, item: Pick<DatesCaseSummary, "target_type" | "target_id"> & Pick<Partial<DatesCaseSummary>, "surface">) => render(locale, createElement(DatesCaseTarget, { item }));
type HostSide = Pick<Partial<DatesCaseSummary>, "host_visible" | "host_review" | "host_reviews">;
const badge = (locale: string, item: HostSide) => render(locale, createElement(DatesCaseHostBadge, { item }));
const review = (locale: string, item: HostSide) => render(locale, createElement(DatesCaseHostReview, { item }));
/**
 * DERIVED, announced for Core's final capture: a case about a member is one case for the whole app, so Core serves
 * `host_review: null` and one review per event in `host_reviews`. The genuine member case of Core's queue with that list.
 */
const MEMBER_CASE = 3, SECOND_EVENT = "act_" + "2".padStart(32, "0"), SECOND_HOST = 8201;
const memberCase = (reviews: unknown[]) => hostRow(MEMBER_CASE, { host_review: null, host_visible: reviews.length > 0, host_reviews: reviews });
const BANNED_THERE = { state: "handled", decision: "member_banned", by_uid: HOST, at: DECIDED_AT, activity_id: hostQueue.cases[MEMBER_CASE].activity_id };
const WAITING_HERE = { state: "open", decision: null, by_uid: null, at: DECIDED_AT - 600, activity_id: SECOND_EVENT };
const KEPT_HERE = { state: "handled", decision: "kept", by_uid: SECOND_HOST, at: DECIDED_AT - 300, activity_id: SECOND_EVENT };

test("a Core that does not serve the surface: wall content is told from a chat message by Core's own id test, and by nothing looser", () => {
  assert.deepEqual([...DATES_CASE_TARGET_KINDS], ["wall_post", "wall_comment", "event_wall", "activity_chat", "direct_chat"]);
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

for (const locale of ["en", "hu"]) test(`${locale}: the queue row and the case overview name a case by where its content lives - Core's surface when it is served, the wall's ids when it is not`, () => {
  const all = messagesOf(locale), kinds = all.datesAdmin.moderation.targetKinds;
  assert.deepEqual(Object.values(kinds), locale === "en" ? ["Wall post", "Wall comment", "Event wall content", "Event chat message", "Direct chat message"]
    : ["Falposzt", "Falkomment", "Eseményfal-tartalom", "Eseménychat-üzenet", "Privát beszélgetés üzenete"]);
  // GENUINE, with the selector: two wall posts, a wall comment, a message of the event's group chat, and a reported member.
  const rows = decodedRows(hostQueue);
  assert.deepEqual(rows.map((row) => target(locale, row)), [`${kinds.wall_post} · ${rows[0].target_id}`, `${kinds.wall_comment} · ${rows[1].target_id}`,
    `${kinds.activity_chat} · ${rows[2].target_id}`, `user · ${rows[3].target_id}`, `${kinds.wall_post} · ${rows[4].target_id}`]);
  // GENUINE, the released twin (no surface): the wall by its ids; the chat message cannot be told from its id and stays a message.
  const released = decodedRows(hostQueueReleased);
  assert.deepEqual(released.map((row) => target(locale, row)), [`${kinds.wall_post} · ${rows[0].target_id}`, `${kinds.wall_comment} · ${rows[1].target_id}`,
    `message · ${rows[2].target_id}`, `user · ${rows[3].target_id}`, `${kinds.wall_post} · ${rows[4].target_id}`]);
  // GENUINE case detail, both ways.
  const detail = datesCaseDetail(hostDetail, hostDetail.case.case_id)!, detailReleased = datesCaseDetail(hostDetailReleased, hostDetailReleased.case.case_id)!;
  assert.equal(target(locale, detail.case), `${kinds.wall_comment} · ${detail.case.target_id}`); assert.equal(target(locale, detailReleased.case), target(locale, detail.case));
  // DERIVED: a message of a direct thread; wall content of a kind this console does not know; a chat message Core cannot place.
  assert.equal(target(locale, hostRow(2, { surface: "direct_chat", ...NOT_SHOWN })), `${kinds.direct_chat} · ${rows[2].target_id}`);
  assert.equal(target(locale, hostRow(0, { target_id: "wxx_" + "0".repeat(32) })), `${kinds.event_wall} · wxx_${"0".repeat(32)}`);
  assert.equal(target(locale, hostRow(2, { surface: null })), `message · ${rows[2].target_id}`);
  // DERIVED (PART A): wall content from a Core that serves no surface.
  assert.equal(target(locale, wallQueue(POST)), `${kinds.wall_post} · ${POST}`);
  assert.equal(target(locale, wallQueue(COMMENT)), `${kinds.wall_comment} · ${COMMENT}`);
  // Genuine rows: a held chat message stays a message, an activity an activity, an external event keeps its own name.
  const held = decodedRows(heldChatQueue)[0], activity = decodedRows(consoleQueue)[0], external = decodedRows(externalQueue)[0];
  assert.equal(target(locale, held), `message · ${held.target_id}`);
  assert.equal(target(locale, activity), `activity · ${activity.target_id}`);
  assert.equal(external.target_type, "external_event");
  assert.equal(target(locale, external), `${all.datesAdmin.external.moderation.target} · ${external.target_id}`);
  // A target type this console has never seen is printed, not named and not looked up.
  assert.equal(target(locale, { target_type: "future_surface", target_id: POST }), `future surface · ${POST}`);
  // DERIVED (PART A): the same from a case detail of a Core that serves no surface.
  const body = structuredClone(reportDetail);
  Object.assign(body.case, { queue: "messages", target_type: "message", target_id: POST, activity_id: EVENT });
  body.reports[0].entry_point = "event_wall";
  const derived = datesCaseDetail(body, body.case.case_id);
  assert.ok(derived, "the derived wall case passes the production detail decoder");
  assert.equal(target(locale, derived.case), `${kinds.wall_post} · ${POST}`);
});

for (const locale of ["en", "hu"]) test(`${locale}: the queue's badge says whether the event's host is shown the case and what the host decided; nothing when Core does not say`, () => {
  const states = messagesOf(locale).datesAdmin.moderation.hostStates;
  assert.deepEqual(states, locale === "en"
    ? { not_shown: "Not shown to the host", shown: "Shown to the host", waiting: "Waiting for the host", kept: "Host kept it", content_removed: "Host removed the content",
      member_removed: "Host removed the member", member_banned: "Host banned the member" }
    : { not_shown: "A host nem látja", shown: "A host látja", waiting: "A host döntésére vár", kept: "A host megtartotta", content_removed: "A host eltávolította a tartalmat",
      member_removed: "A host eltávolította a tagot", member_banned: "A host kitiltotta a tagot" });
  const decided = (label: string) => `<span class="badge badge-active">${label}</span>`;
  // GENUINE: the host removed the content, kept it, banned the member (a chat case and a member case), and has not decided.
  assert.deepEqual(decodedRows(hostQueue).map((row) => badge(locale, row)), [decided(states.content_removed), decided(states.kept), decided(states.member_banned),
    decided(states.member_banned), `<span class="badge badge-info">${states.waiting}</span>`]);
  // GENUINE, the released twin: nothing is said of the host, so nothing is shown - not "not shown to the host".
  assert.deepEqual(decodedRows(hostQueueReleased).map((row) => badge(locale, row)), ["", "", "", "", ""]);
  for (const row of [...decodedRows(consoleQueue), ...decodedRows(externalQueue), ...decodedRows(heldChatQueue)]) assert.equal(badge(locale, row), "", row.case_id);
  // DERIVED: the states Core's capture does not hold.
  assert.equal(badge(locale, hostRow(3, { host_review: { state: "handled", decision: "member_removed", by_uid: HOST, at: DECIDED_AT } })), decided(states.member_removed));
  assert.equal(badge(locale, hostRow(0, NOT_SHOWN)), `<span class="badge">${states.not_shown}</span>`);
  assert.equal(badge(locale, hostRow(0, { ...NOT_SHOWN, host_visible: true })), `<span class="badge">${states.shown}</span>`);
  // A decision or a state this console has no name for is printed as what Core said, never as a named one.
  const unnamed = messagesOf(locale).datesAdmin.moderation.hostStateUnnamed;
  assert.equal(badge(locale, hostRow(0, { host_review: { state: "handled", decision: "member_warned", by_uid: HOST, at: DECIDED_AT } })), `<span class="badge">${unnamed.replace("{value}", "member warned")}</span>`);
  assert.equal(badge(locale, hostRow(0, { host_review: { state: "escalated", decision: null, by_uid: null, at: DECIDED_AT } })), `<span class="badge">${unnamed.replace("{value}", "escalated")}</span>`);

  // DERIVED: a member reported in two events. How many hosts were shown the case, and how many of them decided.
  const several = (hosts: number, decided: number) => messagesOf(locale).datesAdmin.moderation.hostStatesSeveral.replace("{hosts}", String(hosts)).replace("{decided}", String(decided));
  assert.equal(several(2, 1), locale === "en" ? "2 hosts shown, 1 decided" : "2 host látja, 1 döntött");
  assert.equal(badge(locale, memberCase([BANNED_THERE, WAITING_HERE])), `<span class="badge badge-info">${several(2, 1)}</span>`);
  assert.equal(badge(locale, memberCase([BANNED_THERE, KEPT_HERE])), `<span class="badge badge-active">${several(2, 2)}</span>`);
  // One host is that host's decision, as on a case about content; no host is "not shown".
  assert.equal(badge(locale, memberCase([BANNED_THERE])), decided(states.member_banned));
  assert.equal(badge(locale, memberCase([])), `<span class="badge">${states.not_shown}</span>`);
  // GENUINE today, with its one review as `host_review`: the same badge.
  assert.equal(badge(locale, decodedRows(hostQueue)[MEMBER_CASE]), badge(locale, memberCase([BANNED_THERE])));
});

for (const locale of ["en", "hu"]) test(`${locale}: the case page says what the host decided, when and who the host is - and that the decision does not close the case`, () => {
  const all = messagesOf(locale), copy = all.datesAdmin.caseDetail.hostReview, states = all.datesAdmin.moderation.hostStates;
  const row = (title: string, value: string) => `<dt>${escaped(title)}</dt><dd>${value}</dd>`;
  // GENUINE: the host kept a reported wall comment.
  const detail = datesCaseDetail(hostDetail, hostDetail.case.case_id)!;
  const html = review(locale, detail.case);
  assert.match(html, /^<section class="panel dates-section dates-host-review">/);
  assert.ok(html.includes(`<h2>${escaped(copy.title)}</h2><p>${escaped(copy.copy)}</p>`));
  assert.ok(html.includes(`<span class="badge badge-active">${states.kept}</span>`));
  assert.ok(html.includes(row(copy.state, states.kept)));
  assert.ok(html.includes(row(copy.decidedAt, formatDate(DECIDED_AT, locale, true))));
  assert.match(html, new RegExp(`<dt>${copy.host}</dt><dd><a [^>]*href="/users/${HOST}"[^>]*>${copy.uid.replace("{uid}", String(HOST))}</a></dd>`));
  assert.ok(html.includes(`<p class="field-hint">${escaped(copy.doesNotClose)}</p>`));
  assert.match(copy.doesNotClose, locale === "en" ? /^A host's decision does not close the case: / : /^A host döntése nem zárja le az ügyet: /u);
  assert.equal(detail.case.status, "new", "and the case is open");
  assert.equal(html.includes(escaped(copy.openedAt)), false);
  // The reporter's note is on the operators' page only: nothing of it in what is said of the host.
  assert.equal(html.includes("A note only the Friending team may read."), false);
  // GENUINE, the released twin: no section at all.
  assert.equal(review(locale, datesCaseDetail(hostDetailReleased, hostDetailReleased.case.case_id)!.case), "");
  assert.equal(review(locale, datesCaseDetail(reportDetail, reportDetail.case.case_id)!.case), "");

  // GENUINE queue row: in the host's inbox, not decided - no host yet, and the sentence still stands.
  const open = review(locale, decodedRows(hostQueue)[4]);
  assert.ok(open.includes(row(copy.state, states.waiting))); assert.ok(open.includes(row(copy.openedAt, formatDate(DECIDED_AT, locale, true))));
  assert.equal(open.includes(`<dt>${copy.host}</dt>`), false); assert.equal(open.includes(escaped(copy.decidedAt)), false); assert.ok(open.includes(escaped(copy.doesNotClose)));
  // DERIVED: a case the host is not shown says so and nothing more; a decision of an erased host names nobody.
  const hidden = review(locale, hostRow(0, NOT_SHOWN));
  assert.ok(hidden.includes(`<p class="page-subtitle">${escaped(copy.notShown)}</p>`)); assert.doesNotMatch(hidden, /<dl|<a /); assert.equal(hidden.includes(escaped(copy.doesNotClose)), false);
  assert.ok(review(locale, hostRow(0, { ...NOT_SHOWN, host_visible: true })).includes(escaped(copy.shownNoReview)));
  const erased = review(locale, hostRow(0, { host_review: { state: "handled", decision: "content_removed", by_uid: 0, at: DECIDED_AT } }));
  assert.ok(erased.includes(row(copy.host, "—"))); assert.doesNotMatch(erased, /href="\/users\//);
  // A case about content names its event in the overview: the section does not repeat it.
  assert.equal(html.includes(`<dt>${copy.event}</dt>`), false);

  // DERIVED: a member reported in two events - one line per event: the event as a link to its page, that host's
  // decision, the time, and the host. The host who has not decided has no name yet.
  const member = review(locale, memberCase([BANNED_THERE, WAITING_HERE]));
  const lists = member.split('<dl class="detail-list">').slice(1).map((part) => part.slice(0, part.indexOf("</dl>")));
  assert.equal(lists.length, 2);
  assert.match(lists[0], new RegExp(`<dt>${copy.event}</dt><dd><a [^>]*href="/dates/${BANNED_THERE.activity_id}"[^>]*>${BANNED_THERE.activity_id}</a></dd>`));
  assert.ok(lists[0].includes(row(copy.state, states.member_banned))); assert.ok(lists[0].includes(row(copy.decidedAt, formatDate(DECIDED_AT, locale, true))));
  assert.match(lists[0], new RegExp(`<dt>${copy.host}</dt><dd><a [^>]*href="/users/${HOST}"`));
  assert.match(lists[1], new RegExp(`<dt>${copy.event}</dt><dd><a [^>]*href="/dates/${SECOND_EVENT}"[^>]*>${SECOND_EVENT}</a></dd>`));
  assert.ok(lists[1].includes(row(copy.state, states.waiting))); assert.ok(lists[1].includes(row(copy.openedAt, formatDate(DECIDED_AT - 600, locale, true))));
  assert.equal(lists[1].includes(`<dt>${copy.host}</dt>`), false);
  assert.equal(member.split(escaped(copy.doesNotClose)).length - 1, 1, "said once, for all of them");
  assert.ok(member.includes(messagesOf(locale).datesAdmin.moderation.hostStatesSeveral.replace("{hosts}", "2").replace("{decided}", "1")), "the badge of the queue, in the section's head");
  // One host, and none.
  const lone = review(locale, memberCase([KEPT_HERE]));
  assert.equal(lone.split('<dl class="detail-list">').length - 1, 1); assert.ok(lone.includes(`href="/dates/${SECOND_EVENT}"`)); assert.ok(lone.includes(`href="/users/${SECOND_HOST}"`));
  assert.ok(review(locale, memberCase([])).includes(`<p class="page-subtitle">${escaped(copy.notShown)}</p>`));
  // The console shows what the hosts did; it has nothing to press here.
  for (const part of [html, open, hidden, member]) assert.doesNotMatch(part, /<button|<form|<input|<select/);
});

for (const locale of ["en", "hu"]) test(`${locale}: the case's event is a link to its page, and a report's entry point is named - all twelve a reason can list`, () => {
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
  assert.deepEqual(Object.fromEntries(DATES_NAMED_ENTRY_POINTS.map((value) => [value, entry(value)])), locale === "en"
    ? { detail: "Event details", participant: "Participant list", profile: "Member profile", check_in: "Post-event check-in", chat_header: "Chat header",
      direct_chat_header: "Direct chat header", message_action: "Message menu", card: "Event card", external_event: "External event", message: "Message",
      event_wall: "Event wall", review: "Review" }
    : { detail: "Esemény adatlapja", participant: "Résztvevőlista", profile: "Tag profilja", check_in: "Esemény utáni check-in", chat_header: "Chat fejléce",
      direct_chat_header: "Privát beszélgetés fejléce", message_action: "Üzenet menüje", card: "Eseménykártya", external_event: "Külső esemény", message: "Üzenet",
      event_wall: "Eseményfal", review: "Értékelés" });
  // GENUINE: the wall report of Core's case detail.
  const wall = datesCaseDetail(hostDetail, hostDetail.case.case_id)!;
  assert.equal(entry(wall.reports[0].entry_point), copy.entryPoints.event_wall);
  // GENUINE: an older report carries a value from before the vocabulary. It has no name and is printed as before.
  assert.equal(genuine.reports[0].entry_point, "activity_detail");
  assert.equal(entry(genuine.reports[0].entry_point), "activity detail");
  // Core's text is never a message key: a value that happens to be a property name, or a path, is printed like any other.
  for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty", "entryPoints.event_wall", "event_wall.x", "EVENT_WALL", " event_wall", "length", "0"]) {
    assert.equal(entry(value), value.replace(/^dates_/, "").replaceAll("_", " "), value);
  }
});

test("both languages name exactly what the console names, and the pages only print what the functions answer", () => {
  // Every entry point a reason can list, once, in Core's order of first appearance.
  assert.deepEqual([...DATES_NAMED_ENTRY_POINTS], ["detail", "participant", "profile", "check_in", "chat_header", "direct_chat_header", "message_action", "card", "external_event",
    "message", "event_wall", "review"]);
  assert.deepEqual([...DATES_NAMED_ENTRY_POINTS].sort(), [...new Set(Object.values(DATES_REPORT_ENTRY_POINTS).flat())].sort());
  assert.deepEqual([...DATES_CASE_HOST_STATES], ["not_shown", "shown", "waiting", "kept", "content_removed", "member_removed", "member_banned"]);
  assert.deepEqual([...DATES_HOST_DECISIONS], ["kept", "content_removed", "member_removed", "member_banned"], "Core's DatesHostModerationPolicy::HOST_DECISIONS");
  for (const locale of ["en", "hu"]) {
    const dates = messagesOf(locale).datesAdmin;
    assert.deepEqual(Object.keys(dates.moderation.targetKinds), [...DATES_CASE_TARGET_KINDS], `${locale} target kinds`);
    assert.deepEqual(Object.keys(dates.moderation.hostStates), [...DATES_CASE_HOST_STATES], `${locale} host states`);
    assert.deepEqual(Object.keys(dates.caseDetail.entryPoints), [...DATES_NAMED_ENTRY_POINTS], `${locale} entry points`);
    // The console's word for the member who hosts an event is "host" in both languages; "szervező" is the external organizer.
    assert.doesNotMatch(JSON.stringify([dates.moderation.hostStates, dates.caseDetail.hostReview]), /szervező|organizer/iu, locale);
  }

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const queuePage = read("../app/(dashboard)/dates/moderation/page.tsx"), casePage = read("../app/(dashboard)/dates/moderation/[caseId]/page.tsx");
  const labels = read("../components/DatesCaseLabels.tsx"), lib = read("../lib/datesAdmin.ts");
  assert.match(queuePage, /<span><DatesCaseTarget item=\{row\} \/><\/span>/);
  assert.match(queuePage, /<DatesCaseHostBadge item=\{row\} \/>/);
  assert.match(casePage, /<dt>\{t\("target"\)\}<\/dt><dd><DatesCaseTarget item=\{item\} \/><\/dd>/);
  assert.match(casePage, /\{item\.activity_id && <> · <DatesCaseEventLink activityId=\{item\.activity_id\} \/><\/>\}/);
  assert.match(casePage, /<td><DatesReportEntryPoint value=\{report\.entry_point\} \/><\/td>/);
  // The host's section sits between the claim panel and the reports, and is mounted once.
  assert.equal((casePage.match(/<DatesCaseHostReview item=\{item\} \/>/g) ?? []).length, 1);
  assert.ok(casePage.indexOf("<DatesCaseHostReview") > casePage.indexOf('{t("claimTitle")}') && casePage.indexOf("<DatesCaseHostReview") < casePage.indexOf('{t("reportsTitle")}'));
  // The event is no longer printed as text beside the subject, and the entry point no longer as a bare machine key.
  assert.doesNotMatch(casePage, /\$\{item\.activity_id\}|humanizeMachineKey\(report\.entry_point\)/);
  // One place reads a surface or an id for its meaning, and one the host's review: the pages and the labels only print.
  for (const [name, source] of [["queue page", queuePage], ["case page", casePage], ["labels", labels]] as const) {
    assert.doesNotMatch(source, /wpo_|wco_|\.surface\b|host_review\.|"event_wall"|"activity_chat"|"direct_chat"/, name);
  }
  // The labels take the host's side from the one function too: they never compare a review's state or decision themselves.
  assert.doesNotMatch(labels, /\.decision\b|"open"|"handled"|review\.state/);
  assert.equal((queuePage + casePage).includes("datesCaseTargetKind"), false, "the pages mount the label; they do not decide it");
  assert.equal((queuePage + casePage).includes("datesCaseHostState"), false);
  assert.equal((labels.match(/datesCaseTargetKind\(/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wpo_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wco_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
  // What a host did is shown, not done: the labels send nothing to Core.
  assert.doesNotMatch(labels, /adminCall|<button|<form|onClick|onSubmit/);
});

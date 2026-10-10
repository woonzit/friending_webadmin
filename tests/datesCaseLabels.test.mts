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
// the hosts who were shown the case did about it.
//
// GENUINE: Core's host moderation console corpus (tests/fixtures/dates_host_moderation_admin_wire; pinned in
// tests/datesHostModerationWire.test.mts) - a queue of thirteen cases about wall content, chat messages of an event and
// of a direct thread, and members; the case detail of a wall comment and of a member reported in two events; and their
// `-released` twins without the additions, as a Core without host moderation serves the same cases. The older corpora
// give the targets that are not about a message or a member.
// DERIVED, and marked so at each use, only what no genuine body holds: a value this console has no name for, and
// bodies Core's own rule does not produce (the labels are held to say them as they are, never as something else).
// Every derived body goes through the production decoder before anything reads it.
const fixture = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), "utf8"));
const wallComments = fixture("dates_event_content_wire/admin-wall-comments");
const consoleQueue = fixture("dates_moderation_console_wire/admin-queue-page-one");
const heldChatQueue = fixture("dates_external_admin_wire/admin-chat-approve-queue");
const externalQueue = fixture("dates_external_admin_wire/admin-moderation-queue");
const reportDetail = fixture("dates_moderation_wire/admin-detail-report-viewer");
const hostQueue = fixture("dates_host_moderation_admin_wire/admin-moderation-queue"), hostQueueReleased = fixture("dates_host_moderation_admin_wire/admin-moderation-queue-released");
const hostDetail = fixture("dates_host_moderation_admin_wire/admin-moderation-detail"), hostDetailReleased = fixture("dates_host_moderation_admin_wire/admin-moderation-detail-released");
const memberDetail = fixture("dates_host_moderation_admin_wire/admin-moderation-detail-member");
const HOST = 8101, DECIDED_AT = 1790000000;
/** The cases of Core's queue, by what they are (the order is Core's). */
const CASE = { wallPostRemoved: 0, wallCommentKept: 1, chatWaiting: 2, memberBanned: 3, memberRemoved: 6, memberTwoEvents: 7, memberNotShown: 8, directChat: 9, wallPostWaiting: 10, wallPostActioned: 11 };

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
type HostSide = Pick<Partial<DatesCaseSummary>, "host_visible" | "host_review" | "host_reviews">;
const target = (locale: string, item: Pick<DatesCaseSummary, "target_type" | "target_id"> & Pick<Partial<DatesCaseSummary>, "surface">) => render(locale, createElement(DatesCaseTarget, { item }));
const badge = (locale: string, item: HostSide) => render(locale, createElement(DatesCaseHostBadge, { item }));
const review = (locale: string, item: HostSide) => render(locale, createElement(DatesCaseHostReview, { item }));

test("a Core that does not serve the surface: wall content is told from a chat message by Core's own id test, and by nothing looser", () => {
  assert.deepEqual([...DATES_CASE_TARGET_KINDS], ["wall_post", "wall_comment", "event_wall", "activity_chat", "direct_chat"]);
  // GENUINE: the released twin of Core's queue - the cases as a Core without host moderation serves them.
  const released = decodedRows(hostQueueReleased), post = released[CASE.wallPostRemoved], comment = released[CASE.wallCommentKept];
  assert.match(post.target_id, /^wpo_[a-f0-9]{32}$/); assert.match(comment.target_id, /^wco_[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(post, "surface"), false);
  assert.equal(datesCaseTargetKind(post), "wall_post"); assert.equal(datesCaseTargetKind(comment), "wall_comment");
  // A reply is a row of the comments collection: its id says "comment", and the label does not claim more.
  const reply = wallComments.items.find((row: { root_id: string | null }) => row.root_id !== null);
  assert.equal(datesCaseTargetKind({ target_type: "message", target_id: reply.id }), "wall_comment");
  // Genuine rows that are not wall content: chat messages (also `message` cases), members, an activity, an appeal, an external event.
  for (const row of [released[CASE.chatWaiting], released[CASE.directChat], released[CASE.memberBanned], ...decodedRows(heldChatQueue), ...decodedRows(consoleQueue),
    ...decodedRows(fixture("dates_moderation_console_wire/admin-queue-page-two")), ...decodedRows(externalQueue)]) {
    assert.equal(datesCaseTargetKind(row), null, `${row.target_type} ${row.target_id}`);
  }
  // The wall's ids name wall content only on a message case, and only in Core's exact form (DatesId::isValid).
  for (const target_type of ["activity", "user", "review", "appeal", "external_event", "Message", ""]) {
    assert.equal(datesCaseTargetKind({ target_type, target_id: post.target_id }), null, target_type);
  }
  const hex = post.target_id.slice(4);
  for (const target_id of [`wpo_${hex.slice(1)}`, `wpo_${hex}0`, `WPO_${hex}`, `wpo_${"A".repeat(32)}`, `wpo_${hex.slice(1)}g`, ` wpo_${hex}`, `wpo_${hex}\n`, `wpo-${hex}`, `wpx_${hex}`,
    `msg_${hex}`, `x wco_${hex}`, "wpo_", "wco_", ""]) {
    assert.equal(datesCaseTargetKind({ target_type: "message", target_id }), null, JSON.stringify(target_id));
  }
  for (const target_id of [null, undefined, 1, [post.target_id], { id: post.target_id }]) {
    assert.equal(datesCaseTargetKind({ target_type: "message", target_id: target_id as unknown as string }), null, JSON.stringify(target_id));
  }
});

for (const locale of ["en", "hu"]) test(`${locale}: the queue row and the case overview name a case by where its content lives - Core's surface when it is served, the wall's ids when it is not`, () => {
  const all = messagesOf(locale), kinds = all.datesAdmin.moderation.targetKinds;
  assert.deepEqual(Object.values(kinds), locale === "en" ? ["Wall post", "Wall comment", "Event wall content", "Event chat message", "Direct chat message"]
    : ["Falposzt", "Falkomment", "Eseményfal-tartalom", "Eseménychat-üzenet", "Privát beszélgetés üzenete"]);
  // GENUINE, with the selector: wall posts and comments, messages of an event's chat and of a direct thread, and members.
  const rows = decodedRows(hostQueue), named = (kind: string | null, row: DatesCaseSummary) => `${kind ?? row.target_type} · ${row.target_id}`;
  assert.deepEqual(rows.map((row) => target(locale, row)), [named(kinds.wall_post, rows[0]), named(kinds.wall_comment, rows[1]), named(kinds.activity_chat, rows[2]), named(null, rows[3]),
    named(kinds.wall_comment, rows[4]), named(kinds.activity_chat, rows[5]), named(null, rows[6]), named(null, rows[7]), named(null, rows[8]), named(kinds.direct_chat, rows[9]),
    named(kinds.wall_post, rows[10]), named(kinds.wall_post, rows[11]), named(kinds.wall_post, rows[12])]);
  assert.equal(target(locale, rows[CASE.memberBanned]), "user · 8102");
  // GENUINE, the released twin (no surface): the wall by its ids; a chat message cannot be told from its id and stays a message.
  const released = decodedRows(hostQueueReleased);
  assert.deepEqual(released.map((row) => target(locale, row)), [named(kinds.wall_post, rows[0]), named(kinds.wall_comment, rows[1]), named(null, rows[2]), named(null, rows[3]),
    named(kinds.wall_comment, rows[4]), named(null, rows[5]), named(null, rows[6]), named(null, rows[7]), named(null, rows[8]), named(null, rows[9]),
    named(kinds.wall_post, rows[10]), named(kinds.wall_post, rows[11]), named(kinds.wall_post, rows[12])]);
  assert.equal(target(locale, released[CASE.directChat]), `message · ${rows[CASE.directChat].target_id}`);
  // GENUINE case details, both ways, and of a member.
  const detail = datesCaseDetail(hostDetail, hostDetail.case.case_id)!, detailReleased = datesCaseDetail(hostDetailReleased, hostDetailReleased.case.case_id)!;
  assert.equal(target(locale, detail.case), `${kinds.wall_comment} · ${detail.case.target_id}`); assert.equal(target(locale, detailReleased.case), target(locale, detail.case));
  assert.equal(target(locale, datesCaseDetail(memberDetail, memberDetail.case.case_id)!.case), "user · 8112");
  // Genuine rows of the older corpora: a held chat message stays a message, an activity an activity, an external event keeps its own name.
  const held = decodedRows(heldChatQueue)[0], activity = decodedRows(consoleQueue)[0], external = decodedRows(externalQueue)[0];
  assert.equal(target(locale, held), `message · ${held.target_id}`);
  assert.equal(target(locale, activity), `activity · ${activity.target_id}`);
  assert.equal(external.target_type, "external_event");
  assert.equal(target(locale, external), `${all.datesAdmin.external.moderation.target} · ${external.target_id}`);
  // DERIVED: wall content of a kind this console does not know is named by its surface; a chat message whose thread
  // Core cannot place (`surface: null`) is a message; a target type this console has never seen is printed, not looked up.
  assert.equal(target(locale, hostRow(CASE.wallPostRemoved, { target_id: "wxx_" + "0".repeat(32) })), `${kinds.event_wall} · wxx_${"0".repeat(32)}`);
  assert.equal(target(locale, hostRow(CASE.chatWaiting, { surface: null })), `message · ${rows[CASE.chatWaiting].target_id}`);
  assert.equal(target(locale, { target_type: "future_surface", target_id: rows[0].target_id }), `future surface · ${rows[0].target_id}`);
});

for (const locale of ["en", "hu"]) test(`${locale}: the queue's badge says whether a host is shown the case and what the host decided - or, for a member reported in several events, how many hosts and how many decided`, () => {
  const moderation = messagesOf(locale).datesAdmin.moderation, states = moderation.hostStates;
  assert.deepEqual(states, locale === "en"
    ? { not_shown: "Not shown to the host", shown: "Shown to the host", waiting: "Waiting for the host", kept: "Host kept it", content_removed: "Host removed the content",
      member_removed: "Host removed the member", member_banned: "Host banned the member" }
    : { not_shown: "A host nem látja", shown: "A host látja", waiting: "A host döntésére vár", kept: "A host megtartotta", content_removed: "A host eltávolította a tartalmat",
      member_removed: "A host eltávolította a tagot", member_banned: "A host kitiltotta a tagot" });
  const several = (hosts: number, decided: number) => moderation.hostStatesSeveral.replace("{hosts}", String(hosts)).replace("{decided}", String(decided));
  assert.equal(several(2, 1), locale === "en" ? "2 hosts shown, 1 decided" : "2 host látja, 1 döntött");
  const decided = (label: string) => `<span class="badge badge-active">${label}</span>`, waiting = `<span class="badge badge-info">${states.waiting}</span>`, hidden = `<span class="badge">${states.not_shown}</span>`;
  // GENUINE, all thirteen cases of Core's queue: content the host removed or kept, cases waiting in a host's inbox, a
  // member the host banned, one the host removed, a member reported in two events (one host decided, the other has
  // not), and four cases no host is shown - a member, a message of a direct thread, two posts the operators actioned.
  assert.deepEqual(decodedRows(hostQueue).map((row) => badge(locale, row)), [decided(states.content_removed), decided(states.kept), waiting, decided(states.member_banned), waiting, waiting,
    decided(states.member_removed), `<span class="badge badge-info">${several(2, 1)}</span>`, hidden, hidden, waiting, hidden, hidden]);
  // GENUINE, the released twin: nothing is said of a host, so nothing is shown - not "not shown to the host".
  assert.ok(decodedRows(hostQueueReleased).every((row) => badge(locale, row) === ""));
  for (const row of [...decodedRows(consoleQueue), ...decodedRows(externalQueue), ...decodedRows(heldChatQueue)]) assert.equal(badge(locale, row), "", row.case_id);

  // DERIVED: every host of a member case has decided (the capture's two-event case has one who has not).
  const both = hostQueue.cases[CASE.memberTwoEvents].host_reviews.map((entry: Record<string, unknown>) => ({ ...entry, state: "handled", decision: "kept", by_uid: HOST }));
  assert.equal(badge(locale, hostRow(CASE.memberTwoEvents, { host_reviews: both })), `<span class="badge badge-active">${several(2, 2)}</span>`);
  // DERIVED: a decision or a state this console has no name for is printed as what Core said, never as a named one.
  const content = hostQueue.cases[CASE.wallPostRemoved].host_review;
  assert.equal(badge(locale, hostRow(CASE.wallPostRemoved, { host_review: { ...content, decision: "member_warned" } })), `<span class="badge">${moderation.hostStateUnnamed.replace("{value}", "member warned")}</span>`);
  assert.equal(badge(locale, hostRow(CASE.wallPostRemoved, { host_review: { ...content, state: "escalated", decision: null } })), `<span class="badge">${moderation.hostStateUnnamed.replace("{value}", "escalated")}</span>`);
  // DERIVED (a body Core's rule does not produce): "shown" with no review is said as that, never as "not shown".
  assert.equal(badge(locale, hostRow(CASE.memberNotShown, { host_visible: true })), `<span class="badge">${states.shown}</span>`);
});

for (const locale of ["en", "hu"]) test(`${locale}: the case page says what each host decided, when and who the host is - and that a host's decision does not close the case`, () => {
  const all = messagesOf(locale), copy = all.datesAdmin.caseDetail.hostReview, states = all.datesAdmin.moderation.hostStates;
  const row = (title: string, value: string) => `<dt>${escaped(title)}</dt><dd>${value}</dd>`;
  const lists = (html: string) => html.split('<dl class="detail-list">').slice(1).map((part) => part.slice(0, part.indexOf("</dl>")));
  // GENUINE: the host kept a reported wall comment.
  const detail = datesCaseDetail(hostDetail, hostDetail.case.case_id)!;
  const html = review(locale, detail.case);
  assert.match(html, /^<section class="panel dates-section dates-host-review">/);
  assert.ok(html.includes(`<h2>${escaped(copy.title)}</h2><p>${escaped(copy.copy)}</p>`));
  assert.ok(html.includes(`<span class="badge badge-active">${states.kept}</span>`));
  assert.equal(lists(html).length, 1);
  assert.ok(html.includes(row(copy.state, states.kept)));
  assert.ok(html.includes(row(copy.decidedAt, formatDate(DECIDED_AT, locale, true))));
  assert.match(html, new RegExp(`<dt>${copy.host}</dt><dd><a [^>]*href="/users/${HOST}"[^>]*>${copy.uid.replace("{uid}", String(HOST))}</a></dd>`));
  assert.ok(html.includes(`<p class="field-hint">${escaped(copy.doesNotClose)}</p>`));
  assert.match(copy.doesNotClose, locale === "en" ? /^A host's decision does not close the case: / : /^A host döntése nem zárja le az ügyet: /u);
  assert.equal(detail.case.status, "new", "and the case is open");
  assert.equal(html.includes(escaped(copy.openedAt)), false);
  // A case about content names its event in the overview: the section does not repeat it, though Core serves it with the review.
  assert.equal(detail.case.host_reviews![0].activity_id, detail.case.activity_id); assert.equal(html.includes(`<dt>${copy.event}</dt>`), false);
  // The reporter's note is on the operators' page only: nothing of it in what is said of the host.
  assert.equal(html.includes("A note only the Friending team may read."), false);
  // GENUINE, the released twin: no section at all.
  assert.equal(review(locale, datesCaseDetail(hostDetailReleased, hostDetailReleased.case.case_id)!.case), "");
  assert.equal(review(locale, datesCaseDetail(reportDetail, reportDetail.case.case_id)!.case), "");

  // GENUINE: a member reported in two events - one block per event: the event as a link to its page, that host's
  // decision, the time, and the host. The host who has not decided has no name yet.
  const member = datesCaseDetail(memberDetail, memberDetail.case.case_id)!.case, [first, second] = member.host_reviews!;
  const page = review(locale, member), blocks = lists(page);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], new RegExp(`<dt>${copy.event}</dt><dd><a [^>]*href="/dates/${first.activity_id}"[^>]*>${first.activity_id}</a></dd>`));
  assert.ok(blocks[0].includes(row(copy.state, states.kept))); assert.ok(blocks[0].includes(row(copy.decidedAt, formatDate(first.at, locale, true))));
  assert.match(blocks[0], new RegExp(`<dt>${copy.host}</dt><dd><a [^>]*href="/users/${first.by_uid}"`));
  assert.match(blocks[1], new RegExp(`<dt>${copy.event}</dt><dd><a [^>]*href="/dates/${second.activity_id}"[^>]*>${second.activity_id}</a></dd>`));
  assert.ok(blocks[1].includes(row(copy.state, states.waiting))); assert.ok(blocks[1].includes(row(copy.openedAt, formatDate(second.at, locale, true))));
  assert.equal(blocks[1].includes(`<dt>${copy.host}</dt>`), false);
  assert.notEqual(first.activity_id, second.activity_id);
  assert.equal(page.split(escaped(copy.doesNotClose)).length - 1, 1, "said once, for all of them");
  assert.ok(page.includes(all.datesAdmin.moderation.hostStatesSeveral.replace("{hosts}", "2").replace("{decided}", "1")), "the badge of the queue, in the section's head");
  // GENUINE: a member one host banned - one block, with its event.
  const banned = review(locale, decodedRows(hostQueue)[CASE.memberBanned]);
  assert.equal(lists(banned).length, 1); assert.ok(banned.includes(row(copy.state, states.member_banned))); assert.ok(banned.includes(`<dt>${copy.event}</dt>`));

  // GENUINE: a wall post in the host's inbox, not decided - no host yet, and the sentence still stands.
  const open = review(locale, decodedRows(hostQueue)[CASE.wallPostWaiting]);
  assert.ok(open.includes(row(copy.state, states.waiting))); assert.ok(open.includes(row(copy.openedAt, formatDate(DECIDED_AT, locale, true))));
  assert.equal(open.includes(`<dt>${copy.host}</dt>`), false); assert.equal(open.includes(escaped(copy.decidedAt)), false); assert.ok(open.includes(escaped(copy.doesNotClose)));
  // GENUINE: cases no host is shown - a message of a direct thread, a member - say so and nothing more.
  for (const index of [CASE.directChat, CASE.memberNotShown]) {
    const hidden = review(locale, decodedRows(hostQueue)[index]);
    assert.ok(hidden.includes(`<p class="page-subtitle">${escaped(copy.notShown)}</p>`)); assert.doesNotMatch(hidden, /<dl|<a /); assert.equal(hidden.includes(escaped(copy.doesNotClose)), false);
  }
  // DERIVED (bodies Core's rule does not produce): "shown" with no review, and a decision that names no host.
  assert.ok(review(locale, hostRow(CASE.memberNotShown, { host_visible: true })).includes(escaped(copy.shownNoReview)));
  const unnamed = review(locale, hostRow(CASE.wallPostRemoved, { host_review: { ...hostQueue.cases[CASE.wallPostRemoved].host_review, by_uid: 0 } }));
  assert.ok(unnamed.includes(row(copy.host, "—"))); assert.doesNotMatch(unnamed, /href="\/users\//);
  // The console shows what the hosts did; it has nothing to press here.
  for (const part of [html, page, open, banned]) assert.doesNotMatch(part, /<button|<form|<input|<select/);
});

for (const locale of ["en", "hu"]) test(`${locale}: the case's event is a link to its page, and a report's entry point is named - all twelve a reason can list`, () => {
  const copy = messagesOf(locale).datesAdmin.caseDetail;
  const wall = datesCaseDetail(hostDetail, hostDetail.case.case_id)!, EVENT = wall.case.activity_id!;
  const link = render(locale, createElement(DatesCaseEventLink, { activityId: EVENT }));
  assert.match(link, /^<a [^>]*>[^<]*<\/a>$/, "one link and nothing else");
  assert.ok(link.includes(` href="/dates/${EVENT}"`)); assert.ok(link.includes(` title="${copy.openEvent}"`)); assert.ok(link.endsWith(`>${EVENT}</a>`));
  assert.equal(copy.openEvent, locale === "en" ? "Open the event page" : "Az esemény oldalának megnyitása");
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
  // GENUINE: the wall report of Core's case detail, and the reports of a member filed from an event's detail.
  assert.equal(entry(wall.reports[0].entry_point), copy.entryPoints.event_wall);
  const member = datesCaseDetail(memberDetail, memberDetail.case.case_id)!;
  assert.deepEqual(member.reports.map((report) => entry(report.entry_point)), [copy.entryPoints.detail, copy.entryPoints.detail]);
  // GENUINE: an older report carries a value from before the vocabulary. It has no name and is printed as before.
  const older = datesCaseDetail(reportDetail, reportDetail.case.case_id)!;
  assert.equal(older.reports[0].entry_point, "activity_detail");
  assert.equal(entry(older.reports[0].entry_point), "activity detail");
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
    assert.doesNotMatch(JSON.stringify([dates.moderation.hostStates, dates.moderation.hostStatesSeveral, dates.caseDetail.hostReview]), /szervező|organizer/iu, locale);
  }

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const queuePage = read("../app/(dashboard)/dates/moderation/page.tsx"), casePage = read("../app/(dashboard)/dates/moderation/[caseId]/page.tsx");
  const labels = read("../components/DatesCaseLabels.tsx"), lib = read("../lib/datesAdmin.ts");
  assert.match(queuePage, /<span><DatesCaseTarget item=\{row\} \/><\/span>/);
  assert.match(queuePage, /<DatesCaseHostBadge item=\{row\} \/>/);
  assert.match(casePage, /<dt>\{t\("target"\)\}<\/dt><dd><DatesCaseTarget item=\{item\} \/><\/dd>/);
  assert.match(casePage, /\{item\.activity_id && <> · <DatesCaseEventLink activityId=\{item\.activity_id\} \/><\/>\}/);
  assert.match(casePage, /<td><DatesReportEntryPoint value=\{report\.entry_point\} \/><\/td>/);
  // The hosts' section sits between the claim panel and the reports, and is mounted once.
  assert.equal((casePage.match(/<DatesCaseHostReview item=\{item\} \/>/g) ?? []).length, 1);
  assert.ok(casePage.indexOf("<DatesCaseHostReview") > casePage.indexOf('{t("claimTitle")}') && casePage.indexOf("<DatesCaseHostReview") < casePage.indexOf('{t("reportsTitle")}'));
  // The event is no longer printed as text beside the subject, and the entry point no longer as a bare machine key.
  assert.doesNotMatch(casePage, /\$\{item\.activity_id\}|humanizeMachineKey\(report\.entry_point\)/);
  // One place reads a surface or an id for its meaning, and one the hosts' reviews: the pages and the labels only print.
  for (const [name, source] of [["queue page", queuePage], ["case page", casePage], ["labels", labels]] as const) {
    assert.doesNotMatch(source, /wpo_|wco_|\.surface\b|host_review\.|host_reviews\b(?!")|"event_wall"|"activity_chat"|"direct_chat"/, name);
  }
  // The labels take the hosts' side from the functions too: they never compare a review's state or decision themselves.
  assert.doesNotMatch(labels, /\.decision\b|"open"|"handled"|review\.state/);
  assert.equal((queuePage + casePage).includes("datesCaseTargetKind"), false, "the pages mount the label; they do not decide it");
  assert.equal((queuePage + casePage).includes("datesCaseHostState"), false);
  assert.equal((labels.match(/datesCaseTargetKind\(/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wpo_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
  assert.equal((lib.match(/\^wco_\[a-f0-9\]\{32\}\$/g) ?? []).length, 1);
  // What a host did is shown, not done: the labels send nothing to Core.
  assert.doesNotMatch(labels, /adminCall|<button|<form|onClick|onSubmit/);
});

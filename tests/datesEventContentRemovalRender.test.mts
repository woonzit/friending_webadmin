import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import type { EventContentKind } from "../lib/datesEventContent.ts";
import { eventContentPanelInitial, eventContentPanelReducer, type EventContentPanelAction, type EventContentPanelState } from "../lib/datesEventContentPanel.ts";
import { formatDate } from "../lib/format.ts";

// "Content & signals" of an event page, on Core's host moderation bodies: who took a row down, and what Core kept of
// content the event's host removed. The panel as the browser first receives it (a server render), in both languages,
// from states the reducer reaches on what the bridge hands the browser.
//
// GENUINE: tests/fixtures/dates_host_moderation_admin_wire (pinned in tests/datesHostModerationWire.test.mts) - the wall
// with a post its author deleted and a post the host removed, the event chat with a message the host removed, and the
// wall as a Core without host moderation serves it. DERIVED rows are marked at their use.
const root = new URL("./fixtures/dates_host_moderation_admin_wire/", import.meta.url);
const body = (name: string) => JSON.parse(readFileSync(new URL(name + ".json", root), "utf8"));
const POSTS = body("admin-event-content-wall-posts"), RELEASED = body("admin-event-content-wall-posts-released"), MESSAGES = body("admin-event-content-messages");
const EVENT: string = POSTS.activity_id, HOST = 8101, REMOVED_AT = 1790000000;
const HOST_REMOVED = 2, AUTHOR_DELETED = 1, LIVE = 0;
const run = (state: EventContentPanelState, ...actions: EventContentPanelAction[]) => actions.reduce(eventContentPanelReducer, state);
/** The panel's state after the list of a tab was read: the browser's body is the projection of Core's. */
function listed(response: { kind: string }): EventContentPanelState {
  const sent = projectDatesAdminBody("dates_event_content", response);
  const shown = run(eventContentPanelInitial(EVENT), { type: "shown" });
  const state = response.kind === "wall_post" ? run(shown, { type: "readAnswered", ticket: 1, response: sent })
    : run(shown, { type: "listChosen", kind: response.kind as EventContentKind, postId: "" }, { type: "readAnswered", ticket: 2, response: sent });
  assert.equal(state.read.status, "ready", "the body is read as a page");
  return state;
}
/** DERIVED: Core's genuine wall with one row changed, as its own rule would serve that row (DatesEventContentAdminService::removal). */
const wallWith = (index: number, change: (row: any) => void) => { const changed = structuredClone(POSTS); change(changed.items[index]); return listed(changed); };

const principal = { email: "operator@example.test", role: "moderator" as const, rank: 20, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: ["dates_evidence_read", "dates_case_claim"] };
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The cards of a rendered list, in order. */
async function cards(locale: string, initialState: EventContentPanelState): Promise<string[]> {
  const { default: DatesEventContentPanel } = await import("../components/DatesEventContentPanel.tsx");
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesEventContentPanel as any, { activityId: EVENT, principal, deleted: false, onOpenCase: () => undefined, initialState })));
  assert.deepEqual(errors, [], "every message the panel asks for exists");
  return html.split("<article").slice(1).map((part) => part.slice(0, part.indexOf("</article>")));
}
/** The kept-content block of a card, whole (it holds no block of its own), or `null` when the card has none. */
function kept(card: string): string | null {
  const start = card.indexOf('<div class="dates-event-content-kept">');
  return start < 0 ? null : card.slice(start, card.indexOf("</div>", start) + "</div>".length);
}

for (const locale of ["en", "hu"]) test(`${locale}: a post the host removed says so and shows what Core kept of it; an author's own deletion is said to be that; a live row says nothing of it`, async () => {
  const copy = messagesOf(locale).datesAdmin.eventContent;
  assert.deepEqual(copy.removedBy, locale === "en" ? { author: "Deleted by its author.", host: "Removed by the event's host.", moderation: "Removed by a moderation decision." }
    : { author: "A szerzője törölte.", host: "Az esemény hostja távolította el.", moderation: "Moderációs döntés távolította el." });
  const wall = await cards(locale, listed(POSTS));
  assert.equal(wall.length, 4);

  // The post the host removed. The tombstone itself is as bare as any: deleted, no author, nothing to review.
  const removed = wall[HOST_REMOVED];
  assert.ok(removed.includes(POSTS.items[HOST_REMOVED].id)); assert.ok(removed.includes(escaped(copy.states.deleted))); assert.ok(removed.includes(escaped(copy.deletedCopy)));
  assert.ok(removed.includes(`<p class="field-hint">${escaped(copy.removedBy.host)}</p>`)); assert.equal(removed.includes(escaped(copy.openReview)), false);
  // What Core kept: who wrote it (the tombstone no longer says), the text, its kind, the shared link, when the host removed it and who the host is.
  const block = kept(removed);
  assert.ok(block);
  assert.ok(block.includes(`<h4>${escaped(copy.kept.title)}</h4>`));
  assert.ok(block.includes(`<p class="field-hint">${escaped(copy.kept.byline.replace("{author}", "UID 8102"))}</p>`));
  assert.ok(block.includes('<p class="dates-event-content-text">Buy my course, it is the best.</p>'), "the kept text, in the element live text is printed in");
  assert.ok(block.includes(`<p class="field-hint">${escaped(copy.kept.kind.replace("{kind}", copy.contentKinds.link))}</p>`));
  // The link is the member's: printed as its address, never a link on the page.
  assert.ok(block.includes(`<p class="field-hint">${escaped(copy.kept.link)} <code>https://example.org/course</code></p>`));
  assert.doesNotMatch(block, /href="https?:\/\/example\.org/);
  assert.match(block, new RegExp(`<p class="field-hint">${escaped(copy.kept.removedAt.replace("{date}", formatDate(REMOVED_AT, locale, true)))} · ${copy.kept.byHost} \\(<a href="/users/${HOST}">UID ${HOST}</a>\\)</p>`));
  assert.deepEqual([...block.matchAll(/href="([^"]*)"/g)].map((match) => match[1]), [`/users/${HOST}`], "the one link of the block is the host's own page");
  assert.equal(block.includes(escaped(copy.kept.hadMedia)), false, "it had no photo or video");
  assert.equal(POSTS.items[HOST_REMOVED].host_removed.had_media, false);

  // The post its author deleted: said to be that, and nothing was kept of it.
  const own = wall[AUTHOR_DELETED];
  assert.ok(own.includes(`<p class="field-hint">${escaped(copy.removedBy.author)}</p>`)); assert.equal(kept(own), null); assert.ok(own.includes(escaped(copy.noAuthor)));
  // Live rows: their text, and no word of a removal.
  for (const index of [LIVE, 3]) {
    assert.ok(wall[index].includes(escaped(POSTS.items[index].text)));
    for (const absent of Object.values<string>(copy.removedBy)) assert.equal(wall[index].includes(escaped(absent)), false, absent);
    assert.equal(kept(wall[index]), null);
  }

  // GENUINE: a message of the event chat the host removed - the text, its author, the host; a text has no kind line and no link.
  const chat = await cards(locale, listed(MESSAGES));
  const message = kept(chat[0]);
  assert.ok(message && chat[0].includes(escaped(copy.removedBy.host)));
  assert.ok(message.includes('<p class="dates-event-content-text">A message the host removes.</p>')); assert.ok(message.includes(escaped(copy.kept.byline.replace("{author}", "UID 8110"))));
  assert.doesNotMatch(message, /<code>/); assert.equal(message.includes(escaped(copy.kept.kind.split("{kind}")[0])), false);
  assert.equal(kept(chat[1]), null); assert.ok(chat[1].includes("A rude chat message by Pali."));

  // Absent - the same wall from a Core without host moderation: the cards as they always were, and nothing of a removal.
  const before = (await cards(locale, listed(RELEASED))).join("");
  for (const absent of [...Object.values<string>(copy.removedBy), copy.kept.title, "Buy my course", "example.org", `/users/${HOST}`]) assert.equal(before.includes(escaped(absent)), false, absent);
  assert.equal((await cards(locale, listed(RELEASED))).length, 4);
});

for (const locale of ["en", "hu"]) test(`${locale}: a moderation removal, kept media, an erased host and member-written text are each said as they are (derived rows)`, async () => {
  const copy = messagesOf(locale).datesAdmin.eventContent;
  // DERIVED: a moderation decision took a live post down. The row is "moderated", keeps its text, and says who removed it.
  const moderated = (await cards(locale, wallWith(LIVE, (row) => { row.state = "moderated"; row.removed_by = "moderation"; })))[LIVE];
  assert.ok(moderated.includes(`<p class="field-hint">${escaped(copy.removedBy.moderation)}</p>`)); assert.ok(moderated.includes(escaped(POSTS.items[LIVE].text)));
  assert.ok(moderated.includes(escaped(copy.states.moderated))); assert.equal(kept(moderated), null);
  // DERIVED: the removed post was a photo without text. The file is gone; that there was one is said.
  const photo = kept((await cards(locale, wallWith(HOST_REMOVED, (row) => { Object.assign(row.host_removed, { text: "", kind: "photo", link: null, had_media: true }); })))[HOST_REMOVED])!;
  assert.ok(photo.includes(`<p class="dates-event-content-text">${escaped(copy.kept.noText)}</p>`)); assert.ok(photo.includes(`<p class="field-hint">${escaped(copy.kept.hadMedia)}</p>`));
  assert.ok(photo.includes(escaped(copy.kept.kind.replace("{kind}", copy.contentKinds.photo)))); assert.doesNotMatch(photo, /<code>|<img|<video/);
  // DERIVED: the removing host's account is erased, and so is the author's name on the snapshot: nobody is linked.
  const erased = kept((await cards(locale, wallWith(HOST_REMOVED, (row) => { row.host_removed.by_uid = null; row.host_removed.author_uid = null; })))[HOST_REMOVED])!;
  assert.ok(erased.includes(`${escaped(copy.kept.removedAt.replace("{date}", formatDate(REMOVED_AT, locale, true)))} · ${escaped(copy.kept.hostErased)}</p>`));
  assert.ok(erased.includes(escaped(copy.kept.byline.replace("{author}", copy.noAuthor)))); assert.doesNotMatch(erased, /href=/);
  // DERIVED: the host removed it and nothing is kept (the author's account was erased since): the line, and no block.
  const bare = (await cards(locale, wallWith(HOST_REMOVED, (row) => { row.host_removed = null; })))[HOST_REMOVED];
  assert.ok(bare.includes(escaped(copy.removedBy.host))); assert.equal(kept(bare), null);
  // DERIVED: the kept text is what a member wrote. It is a text node, exactly as a live row's text is: markup in it is
  // not markup on the page, in the kept block and in the live row alike.
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script> & "quoted" </p></div>';
  const withText = await cards(locale, wallWith(HOST_REMOVED, (row) => { row.host_removed.text = hostile; }));
  assert.ok(kept(withText[HOST_REMOVED])!.includes(`<p class="dates-event-content-text">${escaped(hostile)}</p>`));
  const live = await cards(locale, wallWith(LIVE, (row) => { row.text = hostile; }));
  assert.ok(live[LIVE].includes(`<p class="dates-event-content-text">${escaped(hostile)}</p>`), "the same element, the same escaping");
  for (const card of [withText[HOST_REMOVED], live[LIVE]]) assert.doesNotMatch(card, /<img|<script|onerror="/);
  // A link Core would not have stored never reaches the page: the decoder refuses the body, and the panel says it cannot verify the list.
  const unsafe = structuredClone(POSTS); unsafe.items[HOST_REMOVED].host_removed.link.url = "javascript:alert(1)";
  const refused = run(run(eventContentPanelInitial(EVENT), { type: "shown" }), { type: "readAnswered", ticket: 1, response: projectDatesAdminBody("dates_event_content", unsafe) });
  assert.deepEqual(refused.read, { status: "failed", more: false, problem: { kind: "malformed" } }); assert.equal(refused.page, null);
});

test("the panel prints kept content as text: no link is made of anything a member wrote, and nothing is added to press", () => {
  const source = readFileSync(new URL("../components/DatesEventContentPanel.tsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("function EventContentKept("), source.indexOf("/** What the request is for, in words"));
  assert.ok(block.length > 200);
  assert.match(block, /<p className="dates-event-content-text">\{kept\.text \|\| t\("kept\.noText"\)\}<\/p>/);
  assert.match(block, /<code>\{kept\.link\.url\}<\/code>/);
  // The only link of the block is to a member's own console page, by a number Core served.
  assert.deepEqual([...block.matchAll(/href=\{([^}]*)\}/g)].map((match) => match[1]), ["`/users/${kept.by_uid"]);
  assert.doesNotMatch(block, /dangerouslySetInnerHTML|<a |<img|<video|<button|onClick|adminCall/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  // The row says who removed it by a closed vocabulary Core served and the decoder checked.
  assert.match(source, /\{row\.removed_by != null && <p className="field-hint">\{t\(`removedBy\.\$\{row\.removed_by\}`\)\}<\/p>\}/);
  for (const locale of ["en", "hu"]) {
    const copy = messagesOf(locale).datesAdmin.eventContent;
    assert.deepEqual(Object.keys(copy.removedBy), ["author", "host", "moderation"]);
    assert.deepEqual(Object.keys(copy.kept), ["title", "byline", "noText", "kind", "link", "hadMedia", "removedAt", "byHost", "hostErased"]);
    // The console's word for the member who hosts an event is "host" in both languages.
    assert.doesNotMatch(JSON.stringify([copy.removedBy, copy.kept]), /szervező|organizer/iu, locale);
  }
});

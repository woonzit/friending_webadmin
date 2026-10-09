import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  eventContentPanelInitial, eventContentPanelReducer, eventReviewRequest, eventReviewTargetOf,
  type EventContentPanelAction, type EventContentPanelState,
} from "../lib/datesEventContentPanel.ts";

// The panel as the browser first receives it (a server render), in both languages, from states the reducer reaches on Core's
// genuine bodies. Effects do not run in a server render: what is asserted is what is on the screen, and that nothing is asked.
const root = new URL("./fixtures/dates_event_content_wire/", import.meta.url);
const body = (name: string) => JSON.parse(readFileSync(new URL(name + ".json", root), "utf8"));
const posts = body("admin-wall-posts"), comments = body("admin-comments-page");
const activity: string = posts.activity_id;
const core = (status_code: number, error: string) => ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 });
const run = (state: EventContentPanelState, ...actions: EventContentPanelAction[]) => actions.reduce(eventContentPanelReducer, state);
const listed = () => run(eventContentPanelInitial(activity), { type: "shown" }, { type: "readAnswered", ticket: 1, response: posts });
const paged = () => run(listed(), { type: "listChosen", kind: "wall_comment", postId: "" }, { type: "readAnswered", ticket: 2, response: comments });
const KEY = "content:00000000-0000-4000-8000-000000000001";


const principal = (capabilities: string[], break_glass = false) => ({ email: "operator@example.test", role: "moderator" as const, rank: 20, linked_uid: null, sensitive_location: false, break_glass, capabilities });
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function render(locale: string, props: Record<string, unknown>) {
  const { default: DatesEventContentPanel } = await import("../components/DatesEventContentPanel.tsx");
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesEventContentPanel as any, { activityId: activity, principal: principal(["dates_evidence_read", "dates_case_claim"]), deleted: false, onOpenCase: () => undefined, ...props })));
  assert.deepEqual(errors, [], "every message the panel asks for exists");
  return html;
}

for (const locale of ["en", "hu"]) test(`${locale}: the panel starts closed - no member content on the screen, and nothing asked of Core`, async () => {
  const copy = messagesOf(locale).datesAdmin.eventContent;
  const html = await render(locale, {});
  assert.ok(html.includes(escaped(copy.show))); assert.ok(html.includes(escaped(copy.closedCopy)));
  assert.equal((html.match(/<button/g) ?? []).length, 2, "show, and moderate the event");
  for (const absent of [copy.kinds.wall_post, copy.loading, copy.empty, copy.more, posts.items[0].text, posts.items[0].id]) assert.equal(html.includes(escaped(absent)), false, absent);
  assert.doesNotMatch(html, /dates-event-content-card|dates-event-content-tabs/);
  // The component reads when the state asks for a read, and the closed state asks for none.
  const source = readFileSync(new URL("../components/DatesEventContentPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(state\.read\.status !== "loading"\) return;/);
  assert.equal((source.match(/adminCall\("dates_event_content"/g) ?? []).length, 1);
  assert.deepEqual(eventContentPanelInitial(activity).read, { status: "idle" });
  // Without the evidence capability there is no panel at all; without the right to take a case, no way to ask for one.
  assert.equal(await render(locale, { principal: principal([]) }), "");
  assert.equal((await render(locale, { principal: principal(["dates_evidence_read"]) })).includes(escaped(copy.reviewEvent)), false);
  assert.equal((await render(locale, { deleted: true })).includes(escaped(copy.reviewEvent)), false);
});

for (const locale of ["en", "hu"]) test(`${locale}: a tombstone shows that something was deleted and nothing of it - no text, author or review; the rows around it are named in words`, async () => {
  const copy = messagesOf(locale).datesAdmin.eventContent;
  const first = paged(), dead = first.page!.items.find((row) => row.state === "deleted")!, alive = first.page!.items.find((row) => row.can_review)!;
  const html = await render(locale, { initialState: first });
  const cards = html.split("<article").slice(1).map((part) => part.slice(0, part.indexOf("</article>")));
  assert.equal(cards.length, 20);
  const tombstone = cards.find((card) => card.includes(dead.id))!, living = cards.find((card) => card.includes(alive.id))!;
  assert.ok(tombstone.includes(escaped(copy.deletedCopy))); assert.ok(tombstone.includes(escaped(copy.states.deleted))); assert.ok(tombstone.includes(escaped(copy.noAuthor)));
  assert.doesNotMatch(tombstone, /UID \d/); assert.equal(tombstone.includes(escaped(copy.openReview)), false, "nothing to review");
  assert.equal(tombstone.includes(escaped(copy.attachmentOnly)), false, "deleted is not 'an attachment without text'");
  assert.ok(living.includes(escaped(alive.text))); assert.ok(living.includes(`UID ${alive.author_uid}`)); assert.ok(living.includes(escaped(copy.openReview)));
  assert.ok(living.includes(escaped(copy.rowKinds[alive.root_id ? "reply" : "wall_comment"])));
  // Twenty rows and a cursor: more can be asked for; nothing is selected, so there is no form.
  assert.ok(html.includes(escaped(copy.more))); assert.doesNotMatch(html, /<form|aria-current/);
  // A photo post is named as a photo in the operator's language, not by its machine word.
  const photo = await render(locale, { initialState: listed() });
  assert.ok(photo.includes(escaped(copy.attachment.replace("{kind}", copy.contentKinds.photo))));
});

for (const locale of ["en", "hu"]) test(`${locale}: the form sits in the card of the row it is for, names it in words, and no state of the panel is blank`, async () => {
  const all = messagesOf(locale), copy = all.datesAdmin.eventContent;
  const row = posts.items[0];
  const chosen = run(listed(), { type: "targetChosen", target: eventReviewTargetOf(row) }, { type: "reasonTyped", value: "Proactive safety check" });
  const html = await render(locale, { initialState: chosen });
  const card = html.split("<article").slice(1).map((part) => part.slice(0, part.indexOf("</article>"))).find((part) => part.includes("<form"))!;
  assert.ok(card.includes(row.id), "the form is inside the selected row's card"); assert.match(card, /aria-current="true"/); assert.ok(card.includes(escaped(copy.selected)));
  assert.equal((html.match(/<form/g) ?? []).length, 1); assert.equal((html.match(/aria-current/g) ?? []).length, 1);
  const named = copy.reviewTarget.replace("{kind}", copy.rowKinds.wall_post).replace("{author}", `UID ${row.author_uid}`).replace("{excerpt}", row.text);
  assert.ok(card.includes(escaped(named)), named);
  // The event as a whole has no row: its form is at the head of the panel, also while the list is closed.
  const whole = await render(locale, { initialState: run(eventContentPanelInitial(activity), { type: "targetChosen", target: { kind: "activity", id: activity } }) });
  assert.ok(whole.includes(escaped(copy.reviewTargetEvent))); assert.equal((whole.match(/<form/g) ?? []).length, 1); assert.doesNotMatch(whole, /<article/);

  // In doubt: what happened is said as it happened, the same request can go again, the list can be read, the request set aside.
  const request = eventReviewRequest(chosen, KEY)!, sending = run(chosen, { type: "reviewStarted", request });
  const silent = await render(locale, { initialState: run(sending, { type: "reviewAnswered", request, response: null }) });
  assert.ok(silent.includes(escaped(all.datesAdmin.commandOutcome.unknown))); assert.ok(silent.includes(escaped(copy.retrySame))); assert.ok(silent.includes(escaped(copy.setAside)));
  assert.ok(silent.includes(escaped(copy.doubtHint)));
  const answered = await render(locale, { initialState: run(sending, { type: "reviewAnswered", request, response: core(503, "dates-admin-unavailable") }) });
  assert.ok(answered.includes(escaped(all.datesAdmin.commandOutcome.unknownAnswered.replace("{error}", "dates-admin-unavailable"))));
  assert.equal(answered.includes(escaped(all.datesAdmin.commandOutcome.unknown)), false, "an answer came back: not 'no readable answer'");
  const refresh = (text: string) => new RegExp(`<button[^>]*class="button button-secondary"(?: type="button")?>${escaped(all.common.refresh)}</button>`).test(text);
  assert.equal(refresh(silent), true, "Refresh is not disabled while a request is in doubt");
  // Refused: the token is shown, beside the form that can be corrected.
  const refused = await render(locale, { initialState: run(sending, { type: "reviewAnswered", request, response: core(422, "dates-admin-reason-invalid") }) });
  assert.ok(refused.includes(escaped(copy.refused.replace("{error}", "dates-admin-reason-invalid")))); assert.ok(refused.includes(row.id));

  // Every state that has no list says why: loading, each problem, nothing in the category.
  const shown = run(eventContentPanelInitial(activity), { type: "shown" });
  assert.ok((await render(locale, { initialState: shown })).includes(escaped(copy.loading)));
  assert.ok((await render(locale, { initialState: run(shown, { type: "readAnswered", ticket: 1, response: { ...posts, items: [] } }) })).includes(escaped(copy.empty)));
  for (const [response, text] of [[core(404, "dates-event-content-unavailable"), copy.problems.notFound], [{ ...posts, items: "none" }, copy.problems.malformed],
    [null, copy.problems.noAnswer], [core(503, "dates-admin-unavailable"), copy.problems.unavailable.replace("{error}", "dates-admin-unavailable")],
    [core(422, "dates-event-content-invalid"), copy.problems.refused.replace("{error}", "dates-event-content-invalid")],
    [{ success: false, status_code: 403, error: "dates-admin-capability-required" }, copy.problems.forbidden.replace("{error}", "dates-admin-capability-required")],
    [{ success: false, status_code: 503, error: "admin-membership-unconfirmed" }, all.adminMembership.requestUnconfirmed], [core(403, "dates-moderation-conflict"), copy.problems.conflict]] as const) {
    const failed = await render(locale, { initialState: run(shown, { type: "readAnswered", ticket: 1, response }) });
    assert.ok(failed.includes(escaped(text)), text); assert.equal(failed.includes(escaped(copy.empty)), false, "a problem is never 'nothing here'");
  }
  // A conflict of interest points the operator who has emergency access at the control, which is opened for them.
  const conflict = run(shown, { type: "readAnswered", ticket: 1, response: core(403, "dates-moderation-conflict") });
  const urgent = principal(["dates_evidence_read", "dates_case_claim"], true);
  const pointed = await render(locale, { initialState: conflict, principal: urgent });
  assert.ok(pointed.includes(escaped(copy.problems.conflictBreakGlass))); assert.match(pointed, /<details[^>]* open=""/); assert.ok(pointed.includes(escaped(copy.breakGlassTitle)));
  assert.equal((await render(locale, { initialState: conflict })).includes(escaped(copy.breakGlassTitle)), false);
  // Once applied, emergency access is said above the control - also while the control is folded - for as long as it is on.
  const applied = await render(locale, { principal: urgent, initialState: run(listed(), { type: "accessApplied", access: { break_glass: true, reason: "Cleared by the duty lead" } }) });
  assert.ok(applied.includes(escaped(copy.breakGlassOn))); assert.ok(applied.indexOf(escaped(copy.breakGlassOn)) < applied.indexOf("<details"));
  assert.equal((await render(locale, { principal: urgent, initialState: listed() })).includes(escaped(copy.breakGlassOn)), false);
  // The control is there before the list is asked for too (closed until it is needed): the scope can be applied first.
  const before = await render(locale, { principal: urgent });
  assert.ok(before.includes(escaped(copy.breakGlassTitle))); assert.ok(before.includes(escaped(copy.show))); assert.doesNotMatch(before, /<details[^>]* open=""/);
  // A request for the event as a whole, refused for a conflict while the list is closed: the problem is said, the list stays closed.
  const wholeChosen = run(eventContentPanelInitial(activity), { type: "targetChosen", target: { kind: "activity", id: activity } }, { type: "reasonTyped", value: "The whole event" });
  const wholeRequest = eventReviewRequest(wholeChosen, KEY)!;
  const wholeRefused = await render(locale, { principal: urgent,
    initialState: run(wholeChosen, { type: "reviewStarted", request: wholeRequest }, { type: "reviewAnswered", request: wholeRequest, response: core(403, "dates-moderation-conflict") }) });
  assert.ok(wholeRefused.includes(escaped(copy.problems.conflictBreakGlass))); assert.ok(wholeRefused.includes(escaped(copy.show)));
  assert.ok(wholeRefused.includes(escaped(copy.refused.replace("{error}", "dates-moderation-conflict")))); assert.doesNotMatch(wholeRefused, /dates-event-content-tabs|<article/);
  // The next page failed: the rows are still there, and the failure is said beside them.
  const more = run(paged(), { type: "moreAsked" });
  const kept = await render(locale, { initialState: run(more, { type: "readAnswered", ticket: more.ticket, response: null }) });
  assert.ok(kept.includes(escaped(copy.problems.moreFailed))); assert.equal(kept.split("<article").length - 1, 20); assert.ok(kept.includes(escaped(copy.more)));
});

test("no copy of the panel is written in the component, and both languages name every kind, state and attachment", () => {
  const source = readFileSync(new URL("../components/DatesEventContentPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /UID|"—"|className="muted"|useState<EventContentPage|router\./);
  for (const locale of ["en", "hu"]) {
    const copy = messagesOf(locale).datesAdmin.eventContent;
    assert.deepEqual(Object.keys(copy.kinds).sort(), ["hidden", "message", "review", "wall_comment", "wall_post"]);
    assert.deepEqual(Object.keys(copy.rowKinds).sort(), ["message", "reply", "review", "wall_comment", "wall_post"]);
    assert.deepEqual(Object.keys(copy.states).sort(), ["active", "deleted", "moderated", "pending"]);
    assert.deepEqual(Object.keys(copy.contentKinds).sort(), ["link", "location", "photo", "text", "tiktok", "video", "youtube"]);
  }
  assert.doesNotMatch(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), /^\.muted\b/m);
  // The panel renders without a router: the page that mounts it hands it the way to a case, and remounts it per event.
  const page = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<DatesEventContentPanel key=\{activityId\} activityId=\{activityId\} principal=\{principal\} deleted=\{activity\.soft_deleted\}\s+onOpenCase=\{\(caseId\) => router\.push\(`\/dates\/moderation\/\$\{caseId\}`\)\} \/>/);
  assert.doesNotMatch(source, /next\/navigation/);
});

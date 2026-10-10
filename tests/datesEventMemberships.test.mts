import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesEventMemberships from "../components/DatesEventMemberships.tsx";
import { formatDate } from "../lib/format.ts";
import { datesMemberships } from "../lib/datesMemberships.ts";

// The members of an event on its page: who is removed or banned, when, by whom, and the host's note.
//
// GENUINE: Core's host moderation console corpus (tests/fixtures/dates_host_moderation_admin_wire, pinned in
// tests/datesHostModerationWire.test.mts, where the decoder is held to every row): the member rows of one event with
// the command contract selector and as a Core without host moderation serves them, and a whole event page of another
// event. DERIVED rows are marked at their use.
const corpus = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_host_moderation_admin_wire/${name}.json`, import.meta.url), "utf8"));
const ROWS = corpus("admin-activity-detail-memberships") as { with_contract: Record<string, any>[]; released: Record<string, any>[] };
const PAGE = corpus("admin-activity-detail") as { memberships: Record<string, any>[] };
const HOST = 8101, NOW = 1790000000;
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The list as the browser first receives it; one piece of markup per member, by the member's number. */
function entries(locale: string, rows: unknown): Map<number, string> {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(DatesEventMemberships, { rows: datesMemberships(rows).rows })));
  assert.deepEqual(errors, [], "every message the list asks for exists");
  assert.match(html, /^<div class="dates-scroll-list">.*<\/div>$/s);
  // Without the list's own closing tag, so that every piece ends where its member's entry ends.
  const parts = html.slice(0, -"</div>".length).split('<div class="dates-member-entry">').slice(1);
  return new Map(parts.map((part) => [Number(/UID (\d+)/.exec(part)![1]), part]));
}

for (const locale of ["en", "hu"]) test(`${locale}: a banned or removed member says so under their row - the state, when, by whom and the host's note; a lifted ban is said as lifted`, () => {
  const copy = messagesOf(locale).datesAdmin.activityDetail.members;
  assert.deepEqual(copy, locale === "en"
    ? { uid: "UID {uid}", banned: "Banned", removed: "Removed", banLifted: "Ban lifted", byHost: "By the host", byModeration: "By moderation", note: "Note from the host: {note}",
      bannedAt: "Banned: {date}", unreadable: "The removal and ban details of this member could not be read." }
    : { uid: "UID {uid}", banned: "Kitiltva", removed: "Eltávolítva", banLifted: "Kitiltás feloldva", byHost: "A host által", byModeration: "A moderáció által",
      note: "A host megjegyzése: {note}", bannedAt: "Kitiltva: {date}", unreadable: "Ennek a tagnak az eltávolítási és kitiltási adatai nem olvashatók." });
  const when = (at: number) => `<time dateTime="${new Date(at * 1000).toISOString()}">${formatDate(at, locale, true)}</time>`;
  const host = `<span>${copy.byHost} (<a href="/users/${HOST}">UID ${HOST}</a>)</span>`;
  const note = (text: string) => `<span class="dates-member-note">${escaped(copy.note.replace("{note}", text))}</span>`;
  const list = entries(locale, ROWS.with_contract);
  assert.deepEqual([...list.keys()], [8102, 8104, 8105, 8106, 8107, 8108, 8109, 8110], "every member, in Core's order");
  // The row itself is as before: the member and the relationship Core holds.
  for (const [uid, relationship] of [[8102, "removed"], [8104, "none"], [8105, "joined"], [8107, "none"]] as const) {
    assert.ok(list.get(uid)!.startsWith(`<div class="dates-list-row"><span>UID ${uid}</span><span class="badge">${relationship}</span></div>`), String(uid));
  }
  // Banned while a participant (the relationship is `removed`): shown as banned - a ban outranks a removal - with the host's note.
  assert.ok(list.get(8102)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.banned}</span>${when(NOW)}${host}${note("Kept insulting other guests.")}</p></div>`));
  assert.equal(list.get(8102)!.includes(`>${copy.removed}<`), false, "not also listed as removed");
  // Banned with no relationship, and no note.
  assert.ok(list.get(8104)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.banned}</span>${when(NOW)}${host}</p></div>`));
  // A ban that was lifted: said as lifted, with its date and the date it had been placed; the member is not banned.
  assert.ok(list.get(8107)!.endsWith(`<p class="dates-member-standing"><span class="badge">${copy.banLifted}</span>${when(NOW)}${host}<span>${escaped(copy.bannedAt.replace("{date}", formatDate(NOW, locale, true)))}</span></p></div>`));
  assert.equal(list.get(8107)!.includes(`>${copy.banned}<`), false);
  // Removed by the host, with the note; removed by moderation, which names no host and has no note.
  assert.ok(list.get(8108)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.removed}</span>${when(NOW)}${host}${note("Arrived drunk.")}</p></div>`));
  assert.ok(list.get(8109)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.removed}</span>${when(1789999950)}<span>${copy.byModeration}</span></p></div>`));
  assert.doesNotMatch(list.get(8109)!, /href=/);
  // A member who is neither has the row and nothing under it.
  for (const uid of [8105, 8106, 8110]) assert.equal(list.get(uid), `<div class="dates-list-row"><span>UID ${uid}</span><span class="badge">joined</span></div></div>`, String(uid));

  // GENUINE: the members of a whole event page. One was removed and then banned; the seat of another was released by a
  // Dates restriction - nobody removed that member, so the row names no host and the list says "by moderation".
  const page = entries(locale, PAGE.memberships);
  assert.deepEqual([...page.keys()], [8112, 8113, 8114, 8115, 8117]);
  assert.ok(page.get(8113)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.banned}</span>${when(NOW)}${host}</p></div>`));
  assert.ok(page.get(8117)!.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.removed}</span>${when(NOW)}<span>${copy.byModeration}</span></p></div>`));
  assert.doesNotMatch(page.get(8117)!, /href=|dates_restriction/);
  for (const uid of [8112, 8114, 8115]) assert.equal(page.get(uid), `<div class="dates-list-row"><span>UID ${uid}</span><span class="badge">joined</span></div></div>`, String(uid));

  // Absent - the same members from a Core without host moderation: what the row itself says of a removal is shown,
  // and nothing of a ban or a note. The member Core would list as banned is, to this console, a removed member.
  const released = entries(locale, ROWS.released);
  assert.ok(released.get(8102)!.endsWith(`<span class="badge badge-warning">${copy.removed}</span>${when(NOW)}${host}</p></div>`));
  assert.ok(released.get(8108)!.endsWith(`<span class="badge badge-warning">${copy.removed}</span>${when(NOW)}${host}</p></div>`));
  assert.ok(released.get(8109)!.includes(copy.byModeration));
  for (const uid of [8104, 8107]) assert.equal(released.get(uid), `<div class="dates-list-row"><span>UID ${uid}</span><span class="badge">none</span></div></div>`, String(uid));
  const all = [...released.values()].join("");
  for (const absent of [copy.banned, copy.banLifted, "Kept insulting other guests.", "Arrived drunk."]) assert.equal(all.includes(absent), false, absent);
});

for (const locale of ["en", "hu"]) test(`${locale}: facts that cannot be read are said to be unreadable, a note is printed as text, and the list has nothing to press`, () => {
  const copy = messagesOf(locale).datesAdmin.activityDetail.members;
  // DERIVED: the genuine banned row with a ban Core does not write.
  const broken = entries(locale, [{ ...ROWS.with_contract[0], ban: { ...ROWS.with_contract[0].ban, state: "suspended" } }]).get(8102)!;
  assert.ok(broken.endsWith(`<p class="dates-member-standing" role="status">${copy.unreadable}</p></div>`));
  assert.equal(broken.includes(`>${copy.removed}<`), false, "an unreadable row is not shown as merely removed");
  // DERIVED: the host's note is the host's own text. It is a text node: markup in it is not markup on the page.
  const hostile = '<img src=x onerror="alert(1)"> & </span><script>x</script>';
  const noted = entries(locale, [{ ...ROWS.with_contract[5], removal_note: hostile }]).get(8108)!;
  assert.ok(noted.includes(escaped(copy.note.replace("{note}", hostile)))); assert.doesNotMatch(noted, /<img|<script/);
  // DERIVED: a removed member whose row names nobody and no time says only that.
  const bare = entries(locale, [{ ...ROWS.with_contract[5], removed_at: null, removed_by_uid: null, removal_note: null }]).get(8108)!;
  assert.ok(bare.endsWith(`<p class="dates-member-standing"><span class="badge badge-warning">${copy.removed}</span></p></div>`));
  // The page shows what hosts did. There is no ban, unban or removal to press, and the component asks Core for nothing.
  const everything = [...entries(locale, ROWS.with_contract).values()].join("");
  assert.doesNotMatch(everything, /<button|<form|<input|<select/);
  const source = readFileSync(new URL("../components/DatesEventMemberships.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /adminCall|onClick|onSubmit|<button|<form/);
});

test("the event page lists its members through the decoder, and counts the removed and the banned only when Core says of everybody whether a ban stands", () => {
  const page = readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const memberships = datesMemberships\(data\.memberships\);/);
  assert.match(page, /<h3 className="dates-subheading">\{t\("memberships"\)\}<\/h3><DatesEventMemberships rows=\{memberships\.rows\} \/>/);
  // The existing tile stays; the two new ones sit beside it and carry the same "there are more" mark.
  assert.match(page, /<strong>\{data\.memberships\.length\}\{data\.memberships_truncated \? "\+" : ""\}<\/strong><span>\{t\("memberships"\)\}<\/span>/);
  assert.match(page, /\{memberships\.counts && <>\s+<div><strong>\{memberships\.counts\.removed\}\{data\.memberships_truncated \? "\+" : ""\}<\/strong><span>\{t\("removedMembers"\)\}<\/span><\/div>\s+<div><strong>\{memberships\.counts\.banned\}\{data\.memberships_truncated \? "\+" : ""\}<\/strong><span>\{t\("bannedMembers"\)\}<\/span><\/div>/);
  assert.deepEqual(datesMemberships(ROWS.with_contract).counts, { removed: 2, banned: 2 });
  assert.deepEqual(datesMemberships(PAGE.memberships).counts, { removed: 1, banned: 1 }, "the whole event page: one seat released, one member banned");
  assert.equal(datesMemberships(ROWS.released).counts, null, "a Core without host moderation: no tile claims that nobody is banned");
  // The page no longer prints a membership row itself.
  assert.doesNotMatch(page, /item\.relationship \|\| "unknown"/);
  for (const locale of ["en", "hu"]) {
    const copy = messagesOf(locale).datesAdmin.activityDetail;
    assert.deepEqual([copy.removedMembers, copy.bannedMembers], locale === "en" ? ["Removed", "Banned"] : ["Eltávolítva", "Kitiltva"]);
    // The console's word for the member who hosts an event is "host" in both languages; "szervező" is the external organizer.
    assert.doesNotMatch(JSON.stringify(copy.members), /szervező|organizer/iu, locale);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { datesCaseHostReviews, datesCaseHostState, datesCaseTargetKind } from "../lib/datesAdmin.ts";
import { DATES_ADMIN_COMMAND_CONTRACT_ROUTES, DATES_ADMIN_COMMAND_CONTRACT_SELECTOR, DATES_ADMIN_HOST_MODERATION_READS, datesAdminCommandContractParams,
  withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { DATES_ADMIN_NAMED, projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { eventContentPage, eventContentReadProblem, type EventContentKind } from "../lib/datesEventContent.ts";
import { datesMemberships } from "../lib/datesMemberships.ts";
import { datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";

// Host moderation v1 on the console plane (Core docs/EVENT_HOST_MODERATION_V1.md, "Console"): what Core appends to four
// reads for a request with the command contract selector, read from Core's own genuine bodies.
//
// GENUINE: tests/fixtures/dates_host_moderation_admin_wire, copied byte for byte from Core (docs/WIRE_CORPUS_PINNING.md,
// "Host moderation console corpus"). Each selector body has, where Core captured one, its `-released` twin: the same
// read as the released console asks it, without the selector.
// DERIVED, and marked so at each use: the states Core's capture does not hold (a direct-chat case, a case the host is
// not shown, a member the host removed, a moderation removal of wall content, kept media, an erased host, a seat a
// restriction released). Each is a genuine body with one stated change, read by the production decoder.
const CORPUS = "dates_host_moderation_admin_wire";
/**
 * THE PIN. This is Core's capture at its lane tip; Core's final tip regenerates it. The manifest is then re-bound
 * (`source_commit`) and - announced by the lead - bodies change as well: a case about a member carries its hosts as
 * `host_reviews` (and `host_review: null`), and report counts move. Re-vendoring is one mechanical step: copy the
 * directory from that Core commit and replace the five values below with what the new files say
 * (docs/WIRE_CORPUS_PINNING.md has the commands). The tests below read the hosts' side of a case through the one
 * function, which reads both shapes of the member case, and state the announced shape as DERIVED rows until then.
 * After that re-vendor a changed `set` is again what it always is: a body changed - stop and review, not a re-pin.
 */
const PIN = {
  /** The Core commit the directory was copied from, from its git objects. */
  core: "3b57e1869c04ab4025b8c176a1f5345c4ad7283c",
  /** sha256 of manifest.json. */
  manifest: "d4dde51c684354bdd98318df30ec1df233436af75a36ce16a8f6fc3abe4ce77c",
  /** The manifest's source binding. */
  source_commit: "692b8d40d48ea07b5e2e9da636438d0ac911196b",
  /** `fixture_set_sha256`: the ten bodies. */
  set: "f22076e8243bd5bbd75cb650c6b0daec5bd7354684c92d8c14607f964c1a9033",
  /** sha256 of Core's generator, tests/dates_host_moderation_fixture_dump.php. */
  generator: "8eb3e807b1a5865a4e120b40f52bb7a1144661a9247ddaa64e5a227aed7fad9d",
};
const DIRECTORY = new URL(`./fixtures/${CORPUS}/`, import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, DIRECTORY));
const fixture = (name: string) => JSON.parse(bytes(`${name}.json`).toString("utf8"));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Entry = { file: string; consumer: string; route: string; excerpt: boolean; http_status: number; status_code: number | null; request: Record<string, unknown>; sha256: string };
const MANIFEST = fixture("manifest") as { schema_version: number; contract: string; source_commit: string; fixture_set_sha256: string;
  selectors: Record<string, unknown>; provenance: Record<string, any>; fixtures: Entry[] };
const SELECTOR = DATES_ADMIN_COMMAND_CONTRACT_SELECTOR.parameter;
const actionOf = (entry: Entry) => entry.route.replace(/^\/v1\/webadmin\//, "");

const QUEUE = fixture("admin-moderation-queue"), QUEUE_RELEASED = fixture("admin-moderation-queue-released");
const DETAIL = fixture("admin-moderation-detail"), DETAIL_RELEASED = fixture("admin-moderation-detail-released");
const POSTS = fixture("admin-event-content-wall-posts"), POSTS_RELEASED = fixture("admin-event-content-wall-posts-released");
const COMMENTS = fixture("admin-event-content-wall-comments"), MESSAGES = fixture("admin-event-content-messages");
const MEMBERSHIPS = fixture("admin-activity-detail-memberships") as { note: string; with_contract: Record<string, any>[]; released: Record<string, any>[] };
const REFUSED = fixture("admin-contract-version-invalid-denied");
const EVENT: string = POSTS.activity_id;
/** What the browser receives of a body: its projection. The decoders below read that, as the pages do. */
const sent = (route: string, body: unknown) => projectDatesAdminBody(route, body, (line) => assert.fail(`nothing of a genuine or derived body is on the deny-list: ${line}`)) as any;
const queueOf = (body: any) => datesModerationQueue(sent("dates_moderation_queue", body), { page: body.page, limit: body.limit });
const detailOf = (body: any) => datesCaseDetail(sent("dates_moderation_detail", body), body.case?.case_id);
const pageOf = (body: any) => eventContentPage(sent("dates_event_content", body), EVENT, body.kind as EventContentKind);
/** An activity detail as the page receives it, with the given membership rows (DERIVED wrapper: a genuine detail body of another corpus). */
const DETAIL_BODY = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-activity-detail-external.json", import.meta.url), "utf8"));
const membershipsOf = (rows: unknown) => datesMemberships(sent("dates_activity_detail", { ...DETAIL_BODY, memberships: rows }).memberships);

test("the host moderation console corpus is Core's, byte for byte, with its requests", () => {
  assert.equal(sha256(bytes("manifest.json")), PIN.manifest);
  assert.deepEqual([MANIFEST.schema_version, MANIFEST.contract, MANIFEST.source_commit, MANIFEST.fixture_set_sha256, MANIFEST.provenance.generator_sha256],
    [1, "dates-host-moderation-v1", PIN.source_commit, PIN.set, PIN.generator]);
  assert.equal(MANIFEST.provenance.generator, "tests/dates_host_moderation_fixture_dump.php");
  assert.equal(MANIFEST.provenance.documentation, "docs/EVENT_HOST_MODERATION_V1.md");
  // The selector the capture sent is the one this console's bridge adds.
  assert.deepEqual(MANIFEST.selectors.webadmin, { [SELECTOR]: DATES_ADMIN_COMMAND_CONTRACT_SELECTOR.value });
  assert.equal(MANIFEST.fixtures.length, 10);
  const lines = MANIFEST.fixtures.map((entry) => {
    assert.equal(sha256(bytes(entry.file)), entry.sha256, entry.file);
    assert.equal(entry.consumer, "webadmin", entry.file); assert.equal(entry.http_status, 200, "Core answers 200 for a logical refusal too");
    const body = JSON.parse(bytes(entry.file).toString("utf8"));
    // An excerpt is not a route body (the memberships of an activity detail, both ways); everything else is one.
    assert.equal(entry.excerpt, entry.file === "admin-activity-detail-memberships.json", entry.file);
    assert.equal(entry.status_code, entry.excerpt ? null : body.status_code, entry.file);
    assert.ok(DATES_ADMIN_HOST_MODERATION_READS.includes(actionOf(entry)), `${entry.file}: ${entry.route}`);
    // A `-released` body was asked for as the released console asks: without the selector. One refusal asks for a version Core does not have.
    assert.equal(entry.request[SELECTOR], entry.file.endsWith("-released.json") ? undefined : entry.file.includes("version-invalid") ? 2 : 1, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(sha256(lines.join("\n")), PIN.set);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), [...MANIFEST.fixtures.map((entry) => entry.file), "manifest.json"].sort());
  // The four reads the selector goes with are the four routes of the capture.
  assert.deepEqual([...new Set(MANIFEST.fixtures.map(actionOf))].sort(), [...DATES_ADMIN_HOST_MODERATION_READS].sort());
});

test("the server asks the four reads for the additions, a browser cannot, and Core's refusal of another version is never a success", () => {
  assert.deepEqual([...DATES_ADMIN_HOST_MODERATION_READS], ["dates_activity_detail", "dates_event_content", "dates_moderation_queue", "dates_moderation_detail"]);
  for (const action of DATES_ADMIN_HOST_MODERATION_READS) {
    assert.deepEqual(datesAdminCommandContractParams(action), { [SELECTOR]: 1 }, action);
    // Written last into the merged parameters: whatever a browser put under the name does not survive.
    assert.equal(withDatesAdminContract(action, { [SELECTOR]: 2 })[SELECTOR], 1, action);
    assert.equal(DATES_ADMIN_COMMAND_CONTRACT_ROUTES.includes(action), false, "the two commands keep their own list");
  }
  // Their neighbours get nothing: the selector changes four reads, not the Dates console.
  for (const action of ["dates_activity_list", "dates_activity_location", "dates_event_content_review", "dates_moderation_evidence", "dates_moderation_sla", "dates_moderation_claim",
    "dates_moderation_resolve", "dates_moderation_legal_hold", "dates_configuration", "dates_reason_list", "users_list", "admin_me"]) {
    assert.deepEqual(datesAdminCommandContractParams(action), {}, action);
    assert.equal(Object.hasOwn(withDatesAdminContract(action, {}), SELECTOR), false, action);
  }
  // GENUINE: a selector that is present and not exactly 1 is refused (422), nothing served. The console sends 1; if
  // it ever did not, no page would read the answer as a list, a case or an event.
  assert.deepEqual(REFUSED, { success: false, status_code: 422, error: "dates-admin-contract-version-invalid", message: 200, status: 200, can_send: 0 });
  for (const action of DATES_ADMIN_HOST_MODERATION_READS) assert.deepEqual(sent(action, REFUSED), REFUSED, action);
  assert.equal(datesModerationQueue(REFUSED, { page: 1, limit: 40 }), null); assert.equal(datesCaseDetail(REFUSED, DETAIL.case.case_id), null);
  assert.equal(eventContentPage(REFUSED, EVENT, "wall_post"), null);
  assert.deepEqual(eventContentReadProblem(REFUSED), { kind: "refused", error: "dates-admin-contract-version-invalid" });
});

test("what Core appends with the selector is exactly the contract's keys: without them each body is its released twin", () => {
  const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
  // `host_reviews` (the hosts of a case about a member, one per event) is announced for Core's final capture and may
  // then follow the three on any case; the capture pinned here does not carry it yet.
  const CASE_KEYS = ["surface", "host_visible", "host_review"], LISTED = "host_reviews", ITEM_KEYS = ["removed_by", "host_removed"];
  const appended = (row: Record<string, unknown>, released: Record<string, unknown>) => Object.keys(row).filter((key) => !Object.hasOwn(released, key));
  assert.deepEqual({ ...QUEUE, cases: QUEUE.cases.map((row: any) => without(row, [...CASE_KEYS, LISTED])) }, QUEUE_RELEASED);
  assert.deepEqual({ ...DETAIL, case: without(DETAIL.case, [...CASE_KEYS, LISTED]) }, DETAIL_RELEASED);
  // Each read is audited: the two reads of the wall differ in their audit id, and in nothing else but the two keys.
  assert.notEqual(POSTS.audit_id, POSTS_RELEASED.audit_id);
  assert.deepEqual({ ...POSTS, audit_id: POSTS_RELEASED.audit_id, items: POSTS.items.map((row: any) => without(row, ITEM_KEYS)) }, POSTS_RELEASED);
  // Appended, and on every row: the last keys of each row, in the contract's order.
  const atTheEnd = (row: Record<string, unknown>, released: Record<string, unknown>) => {
    const keys = appended(row, released);
    assert.deepEqual(keys.filter((key) => key !== LISTED), CASE_KEYS, "the three, on every case");
    assert.deepEqual(Object.keys(row).slice(-keys.length), keys, "appended at the end of the row");
  };
  QUEUE.cases.forEach((row: any, index: number) => atTheEnd(row, QUEUE_RELEASED.cases[index]));
  atTheEnd(DETAIL.case, DETAIL_RELEASED.case);
  for (const body of [POSTS, COMMENTS, MESSAGES]) for (const row of body.items) assert.deepEqual(Object.keys(row).slice(-2), ITEM_KEYS);
  // A membership row is served whole. With the selector it carries all five keys (null where it has none); without it,
  // the three older facts where the row has them and never the ban or the host's note.
  const FACTS = ["removed_at", "removed_by_uid", "removed_reason", "removal_note", "ban"];
  assert.equal(MEMBERSHIPS.with_contract.length, 8); assert.equal(MEMBERSHIPS.released.length, 8);
  MEMBERSHIPS.with_contract.forEach((row, index) => {
    const released = MEMBERSHIPS.released[index];
    for (const key of FACTS) assert.ok(Object.hasOwn(row, key), `${row.uid}: ${key} is served`);
    assert.deepEqual(without(row, FACTS), without(released, FACTS), `${row.uid}: the rest of the row is the released row`);
    for (const key of ["removed_at", "removed_by_uid", "removed_reason"]) assert.equal(row[key], Object.hasOwn(released, key) ? released[key] : null, `${row.uid}: ${key}`);
    assert.equal(Object.hasOwn(released, "ban") || Object.hasOwn(released, "removal_note"), false, `${row.uid}: the released row has neither`);
  });
});

test("the projection names what the pages show of the additions: every genuine route body is itself, a membership row its named part", () => {
  for (const entry of MANIFEST.fixtures.filter((item) => !item.excerpt)) {
    const body = JSON.parse(bytes(entry.file).toString("utf8"));
    assert.deepEqual(sent(actionOf(entry), body), body, entry.file);
  }
  // A membership row is Core's whole stored row. The page lists the member and the relationship, and of what removed or
  // banned them the facts lib/datesMemberships.ts reads; the rest of the row does not leave the server.
  const NAMED = ["uid", "relationship", "live_access", "updated_at", "removed_at", "removed_by_uid", "removed_reason", "removal_note", "released_at", "ban"];
  assert.deepEqual(Object.keys((DATES_ADMIN_NAMED.dates_activity_detail as any).memberships[0]).sort(), [...NAMED].sort());
  assert.deepEqual(Object.keys((DATES_ADMIN_NAMED.dates_activity_detail as any).memberships[0].ban), ["state", "at", "by_uid", "note", "lifted_at", "lifted_by_uid"]);
  for (const rows of [MEMBERSHIPS.with_contract, MEMBERSHIPS.released]) {
    const projected = sent("dates_activity_detail", { ...DETAIL_BODY, memberships: rows }).memberships as Record<string, unknown>[];
    projected.forEach((row, index) => assert.deepEqual(row, Object.fromEntries(Object.entries(rows[index]).filter(([key]) => NAMED.includes(key))), String(rows[index].uid)));
    const withheld = new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !NAMED.includes(key))));
    assert.deepEqual([...withheld].sort(), ["activity_id", "created_at", "invited_at", "invited_by_uid", "joined_at", "rejoin_window_count", "rejoin_window_started_at"]);
  }
  // A ban is the whole subdocument, and nothing beside its six fields.
  const wider = copy(MEMBERSHIPS.with_contract); wider[0].ban.internal = "UNNAMED"; wider[0].request_message = "a member's words";
  assert.doesNotMatch(JSON.stringify(sent("dates_activity_detail", { ...DETAIL_BODY, memberships: wider })), /UNNAMED|a member's words/);
});

test("queue: Core's surface and the host's side of each case are read as served, and a Core that serves neither is read as before", () => {
  const queue = queueOf(QUEUE), released = queueOf(QUEUE_RELEASED);
  assert.ok(queue && released);
  assert.deepEqual(queue.cases, QUEUE.cases); assert.deepEqual(released.cases, QUEUE_RELEASED.cases);
  assert.deepEqual(queue.cases.map((row) => [row.target_type, row.target_id.slice(0, 4), row.surface]),
    [["message", "wpo_", "event_wall"], ["message", "wco_", "event_wall"], ["message", "msg_", "activity_chat"], ["user", "8102", null], ["message", "wpo_", "event_wall"]]);
  assert.deepEqual(queue.cases.map(datesCaseTargetKind), ["wall_post", "wall_comment", "activity_chat", null, "wall_post"]);
  assert.deepEqual(queue.cases.map(datesCaseHostState), [{ state: "content_removed" }, { state: "kept" }, { state: "member_banned" }, { state: "member_banned" }, { state: "waiting" }]);
  assert.ok(queue.cases.every((row) => row.host_visible === true), "every case of the capture is one the host is shown");
  // An open review has no decision and no host yet; `at` is when it was opened.
  assert.deepEqual(queue.cases[4].host_review, { state: "open", decision: null, by_uid: null, at: 1790000000 });
  assert.deepEqual(queue.cases[0].host_review, { state: "handled", decision: "content_removed", by_uid: 8101, at: 1790000000 });
  // The host's decision never closes the case: every decided case is still open for the operators.
  assert.ok(queue.cases.every((row) => row.status === "new" && row.capabilities.can_claim));

  // Absent (the released twin; a Core without host moderation): the wall is told by its ids as in PART A, a chat
  // message cannot be told and stays a message, and nothing is said of the host - no badge, no section.
  for (const row of released.cases) for (const key of ["surface", "host_visible", "host_review"]) assert.equal(Object.hasOwn(row, key), false, key);
  assert.deepEqual(released.cases.map(datesCaseTargetKind), ["wall_post", "wall_comment", null, null, "wall_post"]);
  assert.deepEqual(released.cases.map(datesCaseHostState), [null, null, null, null, null]);
});

test("queue: a served addition that is not what Core writes fails the queue as its neighbours do; one or two of the three is not a row", () => {
  const scope = { page: QUEUE.page, limit: QUEUE.limit };
  const broken = (change: (row: any) => void) => { const body = copy(QUEUE); change(body.cases[0]); return datesModerationQueue(sent("dates_moderation_queue", body), scope); };
  for (const [name, change] of Object.entries<(row: any) => void>({
    "surface: a number": (row) => { row.surface = 5; }, "surface: empty": (row) => { row.surface = ""; }, "surface: a list": (row) => { row.surface = ["event_wall"]; },
    "surface: too long": (row) => { row.surface = "x".repeat(41); },
    "host_visible: text": (row) => { row.host_visible = "true"; }, "host_visible: a number": (row) => { row.host_visible = 1; }, "host_visible: null": (row) => { row.host_visible = null; },
    "host_review: text": (row) => { row.host_review = "handled"; }, "host_review: without its fields": (row) => { row.host_review = { state: "handled" }; },
    "host_review.state: a number": (row) => { row.host_review.state = 5; }, "host_review.state: empty": (row) => { row.host_review.state = ""; },
    "host_review.decision: a number": (row) => { row.host_review.decision = 5; }, "host_review.decision: empty": (row) => { row.host_review.decision = ""; },
    "host_review.by_uid: text": (row) => { row.host_review.by_uid = "8101"; }, "host_review.by_uid: negative": (row) => { row.host_review.by_uid = -1; },
    "host_review.by_uid: a fraction": (row) => { row.host_review.by_uid = 1.5; }, "host_review.at: text": (row) => { row.host_review.at = "1790000000"; },
    "host_review.at: negative": (row) => { row.host_review.at = -1; }, "host_review.at: missing": (row) => { delete row.host_review.at; },
  })) assert.equal(broken(change), null, name);
  // The same strictness as the row's own fields, on the same body.
  assert.equal(broken((row) => { row.status = 5; }), null); assert.equal(broken((row) => { row.sla_breached = "true"; }), null);
  // All three or none.
  for (const keys of [["surface"], ["host_visible"], ["host_review"], ["surface", "host_visible"], ["surface", "host_review"], ["host_visible", "host_review"]]) {
    assert.equal(broken((row) => { for (const key of keys) delete row[key]; }), null, `without ${keys.join(" and ")}`);
  }
  assert.ok(broken((row) => { for (const key of ["surface", "host_visible", "host_review", "host_reviews"]) delete row[key]; }), "none of them: a row of a Core that does not serve them");
  // A list where the review is named is not passed on by the projection, so the row has two of three: not a row either.
  assert.equal(broken((row) => { row.host_review = []; }), null);
  // The hosts of a case about a member: a list of reviews, each of an event. It comes only with the three.
  for (const [name, change] of Object.entries<(row: any) => void>({
    "host_reviews: text": (row) => { row.host_reviews = "none"; }, "host_reviews: a number": (row) => { row.host_reviews = 2; },
    "an entry that is not a review": (row) => { row.host_reviews = [5]; }, "an empty entry": (row) => { row.host_reviews = [null]; },
    "an entry without its event": (row) => { row.host_reviews = [{ ...QUEUE.cases[0].host_review }]; },
    "an entry of something that is not an event": (row) => { row.host_reviews = [{ ...QUEUE.cases[0].host_review, activity_id: "8102" }]; },
    "an entry without a state": (row) => { row.host_reviews = [{ activity_id: EVENT, decision: null, by_uid: null, at: 1790000000 }]; },
    "an entry whose host is text": (row) => { row.host_reviews = [{ ...QUEUE.cases[0].host_review, activity_id: EVENT, by_uid: "8101" }]; },
    "the list without the three": (row) => { row.host_reviews = []; for (const key of ["surface", "host_visible", "host_review"]) delete row[key]; },
    "the list with two of the three": (row) => { row.host_reviews = []; delete row.surface; },
  })) assert.equal(broken(change), null, name);
  for (const list of [[], null, [{ ...QUEUE.cases[0].host_review, activity_id: EVENT }]]) assert.ok(broken((row) => { row.host_reviews = list; }), `a list Core may serve: ${JSON.stringify(list)?.slice(0, 40)}`);

  // A vocabulary is bounded text, as the status and the severity beside it: a value this console has no name for is
  // read, and printed as what it is - never as one of the named values.
  const future = copy(QUEUE);
  Object.assign(future.cases[0], { surface: "event_album", host_review: { state: "handled", decision: "warned", by_uid: 8101, at: 1790000000 } });
  future.cases[1].host_review.state = "escalated";
  const read = datesModerationQueue(sent("dates_moderation_queue", future), scope);
  assert.ok(read);
  assert.equal(datesCaseTargetKind(read.cases[0]), null, "an unknown surface names nothing: the case stays a message");
  assert.deepEqual(datesCaseHostState(read.cases[0]), { unnamed: "warned" }); assert.deepEqual(datesCaseHostState(read.cases[1]), { unnamed: "escalated" });
});

test("the one function: Core's surface is the answer when it is served, the id only where it is not (derived rows)", () => {
  const wall = QUEUE.cases[0], chat = QUEUE.cases[2], hex = "0".repeat(31) + "9";
  // DERIVED: a message of a direct thread. Core's capture has none (and the host is never shown one).
  assert.equal(datesCaseTargetKind({ ...chat, surface: "direct_chat", host_visible: false, host_review: null }), "direct_chat");
  // DERIVED: a chat message whose thread Core cannot place is served `surface: null`: a message, and no more.
  assert.equal(datesCaseTargetKind({ ...chat, surface: null }), null);
  // Served means served: the id is not read against Core's answer...
  assert.equal(datesCaseTargetKind({ ...wall, surface: null }), null);
  assert.equal(datesCaseTargetKind({ ...wall, surface: "activity_chat" }), "activity_chat");
  // ... except to say which of the wall's two collections a wall row is in; wall content of neither is named by its surface.
  assert.equal(datesCaseTargetKind({ ...wall, surface: "event_wall" }), "wall_post");
  assert.equal(datesCaseTargetKind({ ...wall, target_id: `wco_${hex}`, surface: "event_wall" }), "wall_comment");
  assert.equal(datesCaseTargetKind({ ...wall, target_id: `wxx_${hex}`, surface: "event_wall" }), "event_wall");
  // Only a message case has a surface (Core serves null for any other); a surface on another target names nothing.
  assert.equal(datesCaseTargetKind({ ...QUEUE.cases[3], surface: "activity_chat" }), null);
  // Not served: the derivation from the id, as before.
  const { surface: _surface, ...unserved } = wall;
  assert.equal(datesCaseTargetKind(unserved), "wall_post"); assert.equal(datesCaseTargetKind({ ...unserved, target_id: chat.target_id }), null);

  // DERIVED host states the capture does not hold.
  const decided = (decision: string | null, state = "handled") => ({ host_visible: true, host_review: { state, decision, by_uid: 8101, at: 1790000000 } });
  assert.deepEqual(datesCaseHostState(decided("member_removed")), { state: "member_removed" });
  assert.deepEqual(datesCaseHostState({ host_visible: false, host_review: null }), { state: "not_shown" });
  assert.deepEqual(datesCaseHostState({ host_visible: true, host_review: null }), { state: "shown" });
  // The review record is the fact: it is said whatever the flag beside it says.
  assert.deepEqual(datesCaseHostState({ ...decided("kept"), host_visible: false }), { state: "kept" });
  assert.deepEqual(datesCaseHostState(decided(null)), { unnamed: "handled" });
  // Not served, in whole or in part, says nothing.
  for (const item of [{}, { host_visible: true }, { host_review: null }, { host_reviews: [] }]) assert.equal(datesCaseHostState(item), null);
});

test("a case about a member is one case for the whole app: the hosts of several events can be shown it, each with a review of its own (derived rows)", () => {
  // DERIVED, announced by the lead for Core's final capture, which the corpus pinned here does not hold yet: on a case
  // about a member Core serves `host_review: null` and `host_reviews`, one review per event, and `host_visible` says
  // whether the list has an entry. Each row below is the genuine member case of Core's queue with that list in it, read
  // through the projection by the production decoder.
  const MEMBER = 3, OTHER_EVENT = "act_" + "2".padStart(32, "0"), THIRD_EVENT = "act_" + "3".padStart(32, "0");
  assert.equal(QUEUE.cases[MEMBER].target_type, "user");
  const banned = { state: "handled", decision: "member_banned", by_uid: 8101, at: 1790000000, activity_id: EVENT };
  const waiting = { state: "open", decision: null, by_uid: null, at: 1789999000, activity_id: OTHER_EVENT };
  const kept = { state: "handled", decision: "kept", by_uid: 8201, at: 1789999500, activity_id: THIRD_EVENT };
  const member = (change: Record<string, unknown>) => {
    const body = copy(QUEUE); Object.assign(body.cases[MEMBER], { host_review: null, ...change });
    const read = queueOf(body);
    assert.ok(read, JSON.stringify(change).slice(0, 80));
    return read.cases[MEMBER];
  };
  // Two hosts were shown the case; one banned the member, the other has not decided.
  const two = member({ host_visible: true, host_reviews: [banned, waiting] });
  assert.deepEqual(two.host_reviews, [banned, waiting], "the projection names the list and the event of each entry");
  assert.deepEqual(datesCaseHostState(two), { hosts: 2, decided: 1 });
  assert.deepEqual(datesCaseHostReviews(two), [{ event: EVENT, review: banned }, { event: OTHER_EVENT, review: waiting }]);
  assert.deepEqual(datesCaseHostState(member({ host_visible: true, host_reviews: [banned, waiting, kept] })), { hosts: 3, decided: 2 });
  // One entry is that host's decision; no entry is a case no host was shown.
  assert.deepEqual(datesCaseHostState(member({ host_visible: true, host_reviews: [banned] })), { state: "member_banned" });
  assert.deepEqual(datesCaseHostState(member({ host_visible: true, host_reviews: [waiting] })), { state: "waiting" });
  assert.deepEqual(datesCaseHostState(member({ host_visible: false, host_reviews: [] })), { state: "not_shown" });
  assert.deepEqual(datesCaseHostReviews(member({ host_visible: false, host_reviews: [] })), []);
  assert.deepEqual(datesCaseHostState(member({ host_visible: false, host_reviews: null })), { state: "not_shown" });
  // Still open for the operators, whatever the hosts decided.
  assert.equal(two.status, "new");

  // A case about content keeps its one review: Core may serve the list beside it, empty or with that review, and the
  // case reads the same either way - as it does today, without the list.
  const content = (list: unknown) => { const body = copy(QUEUE); body.cases[0].host_reviews = list; return queueOf(body)!.cases[0]; };
  const single = [{ ...QUEUE.cases[0].host_review, activity_id: EVENT }];
  for (const list of [[], single, null]) {
    assert.deepEqual(datesCaseHostState(content(list)), { state: "content_removed" });
    assert.deepEqual(datesCaseHostReviews(content(list)), [{ event: null, review: QUEUE.cases[0].host_review }]);
  }
  assert.deepEqual(datesCaseHostReviews(queueOf(QUEUE)!.cases[0]), [{ event: null, review: QUEUE.cases[0].host_review }]);
  // GENUINE: the member case of the capture pinned here carries its one review as `host_review`; the final capture will carry it in the list. Either shape reads as the same decision.
  assert.deepEqual(datesCaseHostState(queueOf(QUEUE)!.cases[MEMBER]), { state: "member_banned" });
  assert.deepEqual(datesCaseHostState(member({ host_visible: true, host_reviews: [banned] })), datesCaseHostState(queueOf(QUEUE)!.cases[MEMBER]));
  assert.equal(datesCaseHostReviews(queueOf(QUEUE_RELEASED)!.cases[MEMBER]), null, "not served");
});

test("case detail: the case carries the same three; a reporter's note stays on the operators' page", () => {
  const detail = detailOf(DETAIL), released = detailOf(DETAIL_RELEASED);
  assert.ok(detail && released);
  assert.deepEqual(detail.case, DETAIL.case); assert.deepEqual(released.case, DETAIL_RELEASED.case);
  assert.equal(datesCaseTargetKind(detail.case), "wall_comment"); assert.deepEqual(datesCaseHostState(detail.case), { state: "kept" });
  assert.deepEqual(detail.case.host_review, { state: "handled", decision: "kept", by_uid: 8101, at: 1790000000 });
  assert.equal(detail.case.status, "new", "kept by the host, and still open here");
  // The wall's entry point, and the note the host is never shown.
  assert.deepEqual(detail.reports.map((report) => [report.entry_point, report.note]), [["event_wall", "A note only the Friending team may read."]]);
  assert.equal(datesCaseTargetKind(released.case), "wall_comment", "by its id"); assert.equal(datesCaseHostState(released.case), null);
  for (const change of [(row: any) => { row.surface = 5; }, (row: any) => { row.host_visible = "yes"; }, (row: any) => { row.host_review = { state: "handled" }; },
    (row: any) => { row.host_review.by_uid = "8101"; }, (row: any) => { delete row.host_visible; }, (row: any) => { delete row.surface; delete row.host_review; }]) {
    const body = copy(DETAIL); change(body.case);
    assert.equal(datesCaseDetail(sent("dates_moderation_detail", body), body.case.case_id), null, change.toString());
  }
});

/** A row as the page holds it: of a kept link, the address. */
const shown = (row: any) => !row.host_removed?.link ? row : { ...row, host_removed: { ...row.host_removed, link: { url: row.host_removed.link.url } } };

test("event content: who took a row down and what a host removal kept are read as served; the released twin is read as before", () => {
  for (const body of [POSTS, COMMENTS, MESSAGES, POSTS_RELEASED]) {
    const page = pageOf(body);
    assert.ok(page, body.kind);
    assert.deepEqual(page.items, body.items.map(shown), body.kind);
  }
  assert.deepEqual(pageOf(POSTS)!.items.map((row) => [row.state, row.removed_by, row.host_removed === null ? null : row.host_removed!.kind]),
    [["active", null, null], ["deleted", "author", null], ["deleted", "host", "link"], ["active", null, null]]);
  assert.ok(pageOf(COMMENTS)!.items.every((row) => row.removed_by === null && row.host_removed === null));
  // What Core kept of the post the host removed: the text and the link, the author the tombstone no longer names, the host and the time.
  const post = pageOf(POSTS)!.items[2];
  assert.deepEqual([post.text, post.author_uid, post.has_media, post.can_review], ["", null, false, false], "the tombstone itself is as bare as any");
  assert.deepEqual(post.host_removed, { text: "Buy my course, it is the best.", kind: "link", link: { url: "https://example.org/course" }, had_media: false, at: 1790000000, by_uid: 8101, author_uid: 8102 });
  // ... and of a chat message the host removed.
  assert.deepEqual(pageOf(MESSAGES)!.items[0].host_removed, { text: "A message the host removes.", kind: "text", link: null, had_media: false, at: 1790000000, by_uid: 8101, author_uid: 8110 });
  // Absent: a row of the released twin has neither key, and the panel shows nothing of them.
  for (const row of pageOf(POSTS_RELEASED)!.items) { assert.equal(Object.hasOwn(row, "removed_by"), false); assert.equal(Object.hasOwn(row, "host_removed"), false); }

  // DERIVED, each a genuine row with what Core's own rule serves in that state (DatesEventContentAdminService::removal).
  const derived = (index: number, change: (row: any) => void) => { const body = copy(POSTS); change(body.items[index]); return pageOf(body); };
  // A moderation decision took a live row down: the row is `moderated` and still carries its text.
  assert.equal(derived(0, (row) => { row.state = "moderated"; row.removed_by = "moderation"; })?.items[0].removed_by, "moderation");
  // The removed post had a photo: only that there was one is kept.
  assert.equal(derived(2, (row) => { row.host_removed.kind = "photo"; row.host_removed.link = null; row.host_removed.had_media = true; })?.items[2].host_removed?.had_media, true);
  // The removing host's account is erased: the snapshot no longer names them.
  assert.equal(derived(2, (row) => { row.host_removed.by_uid = null; })?.items[2].host_removed?.by_uid, null);
  // Removed by the host with nothing kept (the author's account was erased, or the removal is older than the snapshot).
  assert.deepEqual(derived(2, (row) => { row.host_removed = null; })?.items[2].removed_by, "host");
});

test("event content: a served addition that is not what Core writes fails the page as a row's own fields do", () => {
  const broken = (index: number, change: (row: any) => void) => { const body = copy(POSTS); change(body.items[index]); return pageOf(body); };
  const KEPT = 2, AUTHOR = 1, LIVE = 0;
  for (const [name, change] of Object.entries<(row: any) => void>({
    "removed_by: unknown": (row) => { row.removed_by = "admin"; }, "removed_by: a number": (row) => { row.removed_by = 5; }, "removed_by: a list": (row) => { row.removed_by = ["host"]; },
    "removed_by: empty": (row) => { row.removed_by = ""; },
    "host_removed: text": (row) => { row.host_removed = "kept"; }, "host_removed: empty": (row) => { row.host_removed = {}; },
    "text: null": (row) => { row.host_removed.text = null; }, "text: a number": (row) => { row.host_removed.text = 5; }, "text: missing": (row) => { delete row.host_removed.text; },
    "kind: unknown": (row) => { row.host_removed.kind = "gif"; }, "kind: a list": (row) => { row.host_removed.kind = ["link"]; },
    "link: text": (row) => { row.host_removed.link = "https://example.org/course"; }, "link: without an address": (row) => { row.host_removed.link = { host: "example.org" }; },
    "link: missing": (row) => { delete row.host_removed.link; },
    "link.url: not https": (row) => { row.host_removed.link.url = "http://example.org/course"; }, "link.url: a script": (row) => { row.host_removed.link.url = "javascript:alert(1)"; },
    "link.url: with a space": (row) => { row.host_removed.link.url = "https://example.org/a b"; }, "link.url: two lines": (row) => { row.host_removed.link.url = "https://example.org/a\nhttps://b"; },
    "link.url: too long": (row) => { row.host_removed.link.url = "https://example.org/" + "a".repeat(2048); }, "link.url: a number": (row) => { row.host_removed.link.url = 5; },
    "had_media: a number": (row) => { row.host_removed.had_media = 1; }, "had_media: missing": (row) => { delete row.host_removed.had_media; },
    "at: negative": (row) => { row.host_removed.at = -1; }, "at: text": (row) => { row.host_removed.at = "1790000000"; },
    "by_uid: text": (row) => { row.host_removed.by_uid = "8101"; }, "by_uid: zero": (row) => { row.host_removed.by_uid = 0; }, "by_uid: missing": (row) => { delete row.host_removed.by_uid; },
    "author_uid: text": (row) => { row.host_removed.author_uid = "8102"; }, "author_uid: zero": (row) => { row.host_removed.author_uid = 0; },
  })) assert.equal(broken(KEPT, change), null, name);
  // The neighbours fail the same page the same way.
  assert.equal(broken(KEPT, (row) => { row.content_kind = "gif"; }), null); assert.equal(broken(KEPT, (row) => { row.report_count = "2"; }), null);
  // Both keys or neither.
  assert.equal(broken(KEPT, (row) => { delete row.host_removed; }), null); assert.equal(broken(KEPT, (row) => { delete row.removed_by; }), null);
  assert.ok(broken(KEPT, (row) => { delete row.removed_by; delete row.host_removed; }), "neither: a row of a Core that does not serve them");
  // What is said of a row agrees with the row: nobody took down a live row, moderation leaves a `moderated` one, an
  // author or the host a deleted one, and something is kept only of a removal by the host.
  assert.equal(broken(LIVE, (row) => { row.removed_by = "author"; }), null); assert.equal(broken(LIVE, (row) => { row.removed_by = "host"; }), null);
  assert.equal(broken(LIVE, (row) => { row.removed_by = "moderation"; }), null);
  assert.equal(broken(AUTHOR, (row) => { row.removed_by = "moderation"; }), null, "a deleted row was not moderated away");
  assert.equal(broken(LIVE, (row) => { row.state = "moderated"; row.removed_by = "host"; }), null);
  assert.equal(broken(AUTHOR, (row) => { row.host_removed = POSTS.items[KEPT].host_removed; }), null, "kept content beside an author's own deletion");
  assert.equal(broken(KEPT, (row) => { row.removed_by = null; }), null, "kept content of a row nobody is said to have removed");
  assert.equal(broken(LIVE, (row) => { row.host_removed = POSTS.items[KEPT].host_removed; }), null);
  // The kept link's other fields are named by the projection and not read: the panel prints the address only.
  const titled = broken(KEPT, (row) => { row.host_removed.link.title = { html: "<b>x</b>" }; row.host_removed.link.thumbnail_url = "javascript:alert(1)"; });
  assert.deepEqual(titled?.items[KEPT].host_removed?.link, { url: "https://example.org/course" });
});

test("memberships: who is removed or banned, when, by whom and the host's note - a ban outranks a removal, a lifted ban is said as lifted", () => {
  const read = membershipsOf(MEMBERSHIPS.with_contract);
  const host = 8101, now = 1790000000;
  assert.deepEqual(read.rows, [
    // Banned while a participant: the relationship is `removed`, and the row is listed as banned.
    { uid: 8102, relationship: "removed", standing: { state: "banned", at: now, by_uid: host, note: "Kept insulting other guests." }, lifted: null, unreadable: false },
    // Banned with no relationship (an invitation withdrawn by the ban).
    { uid: 8104, relationship: "none", standing: { state: "banned", at: now, by_uid: host, note: null }, lifted: null, unreadable: false },
    { uid: 8105, relationship: "joined", standing: null, lifted: null, unreadable: false },
    { uid: 8106, relationship: "joined", standing: null, lifted: null, unreadable: false },
    // A ban that was lifted: not banned, and said as lifted.
    { uid: 8107, relationship: "none", standing: null, lifted: { at: now, by_uid: host, banned_at: now }, unreadable: false },
    // Removed by the host, with the host's note.
    { uid: 8108, relationship: "removed", standing: { state: "removed", at: now, by: { kind: "host", uid: host }, note: "Arrived drunk." }, lifted: null, unreadable: false },
    // Removed by a moderation decision: no host, no note.
    { uid: 8109, relationship: "removed", standing: { state: "removed", at: 1789999950, by: { kind: "moderation" }, note: null }, lifted: null, unreadable: false },
    { uid: 8110, relationship: "joined", standing: null, lifted: null, unreadable: false },
  ]);
  assert.deepEqual(read.counts, { removed: 2, banned: 2 });
  assert.deepEqual(datesMemberships(MEMBERSHIPS.with_contract), read, "the projection takes nothing the page reads");

  // Absent (the released rows; a Core without host moderation): what the row itself says is still read - the host
  // removed two members and moderation one - and nothing is said of a ban, a note, or how many are banned.
  const released = membershipsOf(MEMBERSHIPS.released);
  assert.deepEqual(released.rows.filter((row) => row.standing !== null).map((row) => [row.uid, row.standing]), [
    [8102, { state: "removed", at: now, by: { kind: "host", uid: host }, note: null }], [8108, { state: "removed", at: now, by: { kind: "host", uid: host }, note: null }],
    [8109, { state: "removed", at: 1789999950, by: { kind: "moderation" }, note: null }]]);
  assert.ok(released.rows.every((row) => row.lifted === null && !row.unreadable));
  assert.equal(released.counts, null, "who is banned was not served: no count");
  assert.deepEqual(datesMemberships([]), { rows: [], counts: null }); assert.deepEqual(datesMemberships(null), { rows: [], counts: null });

  // DERIVED, each a genuine row with what Core's own rule reads in that state (DatesHostModerationPolicy::removedEntry).
  const one = (index: number, change: Record<string, unknown>) => membershipsOf([{ ...MEMBERSHIPS.with_contract[index], ...change }]).rows[0];
  const HOST_REMOVED = 5, MODERATED = 6, JOINED = 2;
  // A restriction released the seat: it writes `released_at` and names no host.
  assert.deepEqual(one(HOST_REMOVED, { removed_at: null, removed_by_uid: null, removal_note: null, released_at: 1789999999 }).standing,
    { state: "removed", at: 1789999999, by: { kind: "moderation" }, note: null });
  // The host removed the member again after an earlier release: the later of the two is the removal.
  assert.deepEqual(one(HOST_REMOVED, { released_at: now - 10 }).standing, { state: "removed", at: now, by: { kind: "host", uid: host }, note: "Arrived drunk." });
  assert.deepEqual(one(HOST_REMOVED, { released_at: now + 10 }).standing, { state: "removed", at: now + 10, by: { kind: "moderation" }, note: null });
  // A note an earlier host removal left on the row is not the operators': not shown beside a moderation removal.
  assert.equal(one(MODERATED, { removal_note: "An older note of the host." }).standing?.note, null);
  // A removed member whose row names nobody and no time: removed, and nothing is guessed.
  assert.deepEqual(one(HOST_REMOVED, { removed_at: null, removed_by_uid: null, removal_note: null }).standing, { state: "removed", at: null, by: { kind: "unknown" }, note: null });
  // A note that is only space is no note; a ban whose host is not named has no host to link.
  assert.equal(one(HOST_REMOVED, { removal_note: "   " }).standing?.note, null);
  assert.deepEqual(one(0, { ban: { ...MEMBERSHIPS.with_contract[0].ban, by_uid: 0 } }).standing, { state: "banned", at: now, by_uid: null, note: "Kept insulting other guests." });
  // The other facts of a member who is not removed say nothing (a re-invited member keeps an old `removed_at`).
  assert.equal(one(JOINED, { removed_at: now - 500, removed_by_uid: host }).standing, null);
});

test("memberships: a served fact that is not what Core writes makes that row unreadable - never 'not removed, not banned' - and stops the counts", () => {
  const BANNED = 0, LIFTED = 4, HOST_REMOVED = 5;
  const ban = (change: Record<string, unknown>) => ({ ban: { ...MEMBERSHIPS.with_contract[BANNED].ban, ...change } });
  const cases: Array<[string, number, Record<string, unknown>]> = [
    ["ban: text", BANNED, { ban: "active" }], ["ban: without its fields", BANNED, { ban: { state: "active" } }], ["ban.state: unknown", BANNED, ban({ state: "banned" })],
    ["ban.state: a list", BANNED, ban({ state: ["active"] })], ["ban.at: text", BANNED, ban({ at: "1790000000" })], ["ban.at: negative", BANNED, ban({ at: -1 })],
    ["ban.by_uid: text", BANNED, ban({ by_uid: "8101" })], ["ban.by_uid: negative", BANNED, ban({ by_uid: -1 })], ["ban.note: a number", BANNED, ban({ note: 5 })],
    ["ban.note: longer than Core takes", BANNED, ban({ note: "x".repeat(201) })], ["an active ban that says it was lifted", BANNED, ban({ lifted_at: 1790000000 })],
    ["a lifted ban without the time", LIFTED, { ban: { ...MEMBERSHIPS.with_contract[LIFTED].ban, lifted_at: null } }],
    ["a lifted ban by text", LIFTED, { ban: { ...MEMBERSHIPS.with_contract[LIFTED].ban, lifted_by_uid: "8101" } }],
    ["removed_at: text", HOST_REMOVED, { removed_at: "1790000000" }], ["removed_at: negative", HOST_REMOVED, { removed_at: -1 }],
    ["removed_by_uid: text", HOST_REMOVED, { removed_by_uid: "8101" }], ["removed_by_uid: a fraction", HOST_REMOVED, { removed_by_uid: 1.5 }],
    ["removed_reason: a number", HOST_REMOVED, { removed_reason: 5 }], ["removal_note: a number", HOST_REMOVED, { removal_note: 5 }],
    ["removal_note: longer than Core takes", HOST_REMOVED, { removal_note: "x".repeat(201) }], ["released_at: text", HOST_REMOVED, { released_at: "soon" }],
  ];
  for (const [name, index, change] of cases) {
    const rows = copy(MEMBERSHIPS.with_contract); Object.assign(rows[index], change);
    const read = membershipsOf(rows);
    assert.deepEqual(read.rows[index], { uid: rows[index].uid, relationship: rows[index].relationship, standing: null, lifted: null, unreadable: true }, name);
    assert.equal(read.rows.filter((row) => row.unreadable).length, 1, `${name}: the other rows are read`);
    assert.equal(read.counts, null, `${name}: no count that would leave the member out`);
  }
  // A note of exactly Core's limit is a note (200 characters, not UTF-16 units).
  assert.equal(membershipsOf([{ ...MEMBERSHIPS.with_contract[HOST_REMOVED], removal_note: "😀".repeat(200) }]).rows[0].unreadable, false);
  // A row that is not a row at all is said to be unreadable too; the member and the relationship are printed as before.
  assert.deepEqual(datesMemberships([null]).rows, [{ uid: null, relationship: null, standing: null, lifted: null, unreadable: true }]);
  assert.deepEqual(datesMemberships([{ uid: "8102", relationship: 5 }]).rows, [{ uid: null, relationship: null, standing: null, lifted: null, unreadable: false }]);
});

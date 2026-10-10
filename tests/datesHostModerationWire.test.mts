import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { datesCaseHostReviews, datesCaseHostState, datesCaseTargetKind } from "../lib/datesAdmin.ts";
import { DATES_ADMIN_COMMAND_CONTRACT_ROUTES, DATES_ADMIN_COMMAND_CONTRACT_SELECTOR, DATES_ADMIN_HOST_MODERATION_READS, datesAdminCommandContractParams,
  withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { DATES_ADMIN_NAMED, projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { eventContentPage, eventContentReadProblem, type EventContentKind } from "../lib/datesEventContent.ts";
import { decodeDatesActivityOriginDetail } from "../lib/datesExternalAdmin.ts";
import { datesMemberships } from "../lib/datesMemberships.ts";
import { datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";

// Host moderation v1 on the console plane (Core docs/EVENT_HOST_MODERATION_V1.md, "Console"): what Core appends to four
// reads for a request with the command contract selector, read from Core's own genuine bodies.
//
// GENUINE: tests/fixtures/dates_host_moderation_admin_wire, copied byte for byte from Core's final tip
// (docs/WIRE_CORPUS_PINNING.md, "Host moderation console corpus"): a queue of thirteen cases, two case details (a
// wall comment the host kept; a member reported in two events), a whole event page, the wall of three events, an event
// chat, and - where Core captured one - the `-released` twin of a read: the same read as the released console asks
// it, without the selector.
// DERIVED, and marked so at each use, only where no genuine body holds the state: a body that breaks a rule (the
// negative controls), a value this console has no name for, and a few states of a membership row and of kept content
// that Core's capture does not reach. Each is a genuine body with one stated change, read by the production decoder.
const CORPUS = "dates_host_moderation_admin_wire";
/**
 * THE PIN (docs/WIRE_CORPUS_PINNING.md). Re-vendoring is one mechanical step: copy the directory from the Core commit
 * and replace these five values with what the new files say. A changed `set` means a BODY changed: stop and review,
 * not a re-pin.
 */
const PIN = {
  /** The Core commit the directory was copied from, from its git objects. */
  core: "28439d7e5549e09cf8d663fcb6ff7cc85172decb",
  /** sha256 of manifest.json. */
  manifest: "2becdfadf11215a1043406403fe5731acab39401910b015e9feb8dc440d1c21d",
  /** The manifest's source binding. */
  source_commit: "50100ad334ca2a0c8d7be2515b3d458361e2a876",
  /** `fixture_set_sha256`: the fourteen bodies. */
  set: "abd639fbdd564de36a371dca6bfdf37990064ade00aee0e5bff991ac74ca4127",
  /** sha256 of Core's generator, tests/dates_host_moderation_fixture_dump.php. */
  generator: "95fa3b9d1630e7cdfb7646618bc50376811bac0b2d275aee38d89306fd9479b0",
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
const DETAIL = fixture("admin-moderation-detail"), DETAIL_RELEASED = fixture("admin-moderation-detail-released"), DETAIL_MEMBER = fixture("admin-moderation-detail-member");
const POSTS = fixture("admin-event-content-wall-posts"), POSTS_RELEASED = fixture("admin-event-content-wall-posts-released");
const POSTS_SECOND = fixture("admin-event-content-wall-posts-second-event"), COMMENTS_ERASED = fixture("admin-event-content-wall-comments-host-erased");
const COMMENTS = fixture("admin-event-content-wall-comments"), MESSAGES = fixture("admin-event-content-messages");
const ACTIVITY = fixture("admin-activity-detail");
const MEMBERSHIPS = fixture("admin-activity-detail-memberships") as { note: string; with_contract: Record<string, any>[]; released: Record<string, any>[] };
const REFUSED = fixture("admin-contract-version-invalid-denied");
const EVENT: string = POSTS.activity_id, SECOND_EVENT: string = POSTS_SECOND.activity_id, THIRD_EVENT: string = COMMENTS_ERASED.activity_id;
const HOST = 8101, NOW = 1790000000;
/** What the browser receives of a body: its projection. The decoders below read that, as the pages do. */
const sent = (route: string, body: unknown) => projectDatesAdminBody(route, body, (line) => assert.fail(`nothing of a genuine or derived body is on the deny-list: ${line}`)) as any;
const queueOf = (body: any) => datesModerationQueue(sent("dates_moderation_queue", body), { page: body.page, limit: body.limit });
const detailOf = (body: any) => datesCaseDetail(sent("dates_moderation_detail", body), body.case?.case_id);
const pageOf = (body: any) => eventContentPage(sent("dates_event_content", body), body.activity_id, body.kind as EventContentKind);
/** The member rows of an event page as the page reads them: Core's genuine event page with these rows, through the projection. */
const membershipsOf = (rows: unknown) => datesMemberships(sent("dates_activity_detail", { ...ACTIVITY, memberships: rows }).memberships);
/** The cases of Core's queue, by what they are (the order is Core's: severity, deadline, age). */
const CASE = { wallPostRemoved: 0, wallCommentKept: 1, chatWaiting: 2, memberBanned: 3, memberRemoved: 6, memberTwoEvents: 7, memberNotShown: 8, directChat: 9, wallPostWaiting: 10, wallPostActioned: 11 };

test("the host moderation console corpus is Core's, byte for byte, with its requests", () => {
  assert.equal(sha256(bytes("manifest.json")), PIN.manifest);
  assert.deepEqual([MANIFEST.schema_version, MANIFEST.contract, MANIFEST.source_commit, MANIFEST.fixture_set_sha256, MANIFEST.provenance.generator_sha256],
    [1, "dates-host-moderation-v1", PIN.source_commit, PIN.set, PIN.generator]);
  assert.equal(MANIFEST.provenance.generator, "tests/dates_host_moderation_fixture_dump.php");
  assert.equal(MANIFEST.provenance.documentation, "docs/EVENT_HOST_MODERATION_V1.md");
  // The selector the capture sent is the one this console's bridge adds.
  assert.deepEqual(MANIFEST.selectors.webadmin, { [SELECTOR]: DATES_ADMIN_COMMAND_CONTRACT_SELECTOR.value });
  assert.equal(MANIFEST.fixtures.length, 14);
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
  assert.equal(eventContentPage(REFUSED, EVENT, "wall_post"), null); assert.equal(decodeDatesActivityOriginDetail(REFUSED, EVENT, []), null);
  assert.deepEqual(eventContentReadProblem(REFUSED), { kind: "refused", error: "dates-admin-contract-version-invalid" });
});

test("what Core appends with the selector is exactly the contract's keys, in its order: without them each body is its released twin", () => {
  const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
  const CASE_KEYS = ["surface", "host_visible", "host_review", "host_reviews"], ITEM_KEYS = ["removed_by", "host_removed"];
  assert.equal(QUEUE.cases.length, 13); assert.equal(QUEUE_RELEASED.cases.length, 13);
  assert.deepEqual({ ...QUEUE, cases: QUEUE.cases.map((row: any) => without(row, CASE_KEYS)) }, QUEUE_RELEASED);
  assert.deepEqual({ ...DETAIL, case: without(DETAIL.case, CASE_KEYS) }, DETAIL_RELEASED);
  // Each read is audited: the two reads of the wall differ in their audit id, and in nothing else but the two keys.
  assert.notEqual(POSTS.audit_id, POSTS_RELEASED.audit_id);
  assert.deepEqual({ ...POSTS, audit_id: POSTS_RELEASED.audit_id, items: POSTS.items.map((row: any) => without(row, ITEM_KEYS)) }, POSTS_RELEASED);
  // Appended, and on every row: the last keys of each row, in the contract's order.
  for (const row of [...QUEUE.cases, DETAIL.case, DETAIL_MEMBER.case]) assert.deepEqual(Object.keys(row).slice(-4), CASE_KEYS, row.case_id);
  for (const body of [POSTS, POSTS_SECOND, COMMENTS, COMMENTS_ERASED, MESSAGES]) for (const row of body.items) assert.deepEqual(Object.keys(row).slice(-2), ITEM_KEYS);
  for (const row of [...QUEUE_RELEASED.cases, DETAIL_RELEASED.case]) for (const key of CASE_KEYS) assert.equal(Object.hasOwn(row, key), false, key);
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
  for (const row of ACTIVITY.memberships) for (const key of FACTS) assert.ok(Object.hasOwn(row, key), `${row.uid}: ${key} is served on the whole event page too`);
});

test("the projection names what the pages show: every genuine route body but the event page is itself, and the event page is itself but for what it withholds by design", () => {
  for (const entry of MANIFEST.fixtures.filter((item) => !item.excerpt && item.file !== "admin-activity-detail.json")) {
    const body = JSON.parse(bytes(entry.file).toString("utf8"));
    assert.deepEqual(sent(actionOf(entry), body), body, entry.file);
  }
  // A membership row is Core's whole stored row. The page lists the member and the relationship, and of what removed or
  // banned them the facts lib/datesMemberships.ts reads; the rest of the row does not leave the server.
  const NAMED = ["uid", "relationship", "live_access", "updated_at", "removed_at", "removed_by_uid", "removed_reason", "removal_note", "released_at", "ban"];
  const named = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => NAMED.includes(key)));
  assert.deepEqual(Object.keys((DATES_ADMIN_NAMED.dates_activity_detail as any).memberships[0]).sort(), [...NAMED].sort());
  assert.deepEqual(Object.keys((DATES_ADMIN_NAMED.dates_activity_detail as any).memberships[0].ban), ["state", "at", "by_uid", "note", "lifted_at", "lifted_by_uid"]);

  // GENUINE: a whole member-hosted event page, the first in any corpus of this console. Its projection is the body
  // itself in every part but four, each reduced by a rule that is older than host moderation or stated above:
  const page = sent("dates_activity_detail", ACTIVITY);
  const reduced = ["memberships", "reports", "moderation_cases", "moderation_decisions"];
  assert.deepEqual(Object.keys(page), Object.keys(ACTIVITY));
  assert.deepEqual(Object.keys(ACTIVITY).filter((key) => JSON.stringify(page[key]) !== JSON.stringify(ACTIVITY[key])), reduced);
  // - a membership row is its named part: the stored row's other fields stay on the server;
  assert.deepEqual(page.memberships, ACTIVITY.memberships.map(named));
  assert.deepEqual([...new Set(ACTIVITY.memberships.flatMap((row: any) => Object.keys(row).filter((key) => !NAMED.includes(key))))].sort(),
    ["activity_id", "created_at", "joined_at", "rejoin_window_count", "rejoin_window_started_at", "released_reason"]);
  // - a linked case is listed by the six fields the page's table has; Core also serves when it was resolved;
  assert.deepEqual(page.moderation_cases, ACTIVITY.moderation_cases.map(({ resolved_at: _resolved, ...row }: any) => row));
  // - a report and a decision are passed by Core as whole documents and reach the browser as their safe keys and a count
  //   of what was withheld: no moderator, no sanctioned member, no reason text, no before / after.
  assert.deepEqual(page.moderation_decisions, [{ decision_id: ACTIVITY.moderation_decisions[0].decision_id, target_type: "message", action: "remove_content", severity: "low", created_at: NOW, withheld_fields: 9 }]);
  assert.deepEqual(page.reports[0], { report_id: ACTIVITY.reports[0].report_id, target_type: "message", severity: "high", status: "new", created_at: ACTIVITY.reports[0].created_at,
    reporter_identity_redacted: true, withheld_fields: 3 });
  assert.equal(page.reports.length, ACTIVITY.reports.length);
  assert.doesNotMatch(JSON.stringify(page), /moderator@example\.test|subject_uid|user_visible_reason|moderated_removed|released_reason|rejoin_window|host_report/);
  // The page's own decoder reads it, and the member rows read as the page lists them.
  assert.ok(decodeDatesActivityOriginDetail(page, ACTIVITY.activity.activity_id, []), "a member-hosted event");
  assert.deepEqual(datesMemberships(page.memberships), datesMemberships(ACTIVITY.memberships), "the projection takes nothing the page reads");

  // The excerpt (the member rows of another event, with the selector and as the released console is served them) is
  // not a route body: its rows are read in the place of the genuine event page's own.
  for (const rows of [MEMBERSHIPS.with_contract, MEMBERSHIPS.released]) {
    assert.deepEqual(sent("dates_activity_detail", { ...ACTIVITY, memberships: rows }).memberships, rows.map(named));
    assert.deepEqual([...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !NAMED.includes(key))))].sort(),
      ["activity_id", "created_at", "invited_at", "invited_by_uid", "joined_at", "rejoin_window_count", "rejoin_window_started_at"]);
  }
  // A ban is the whole subdocument, and nothing beside its six fields. (Negative control: two keys Core does not serve.)
  const wider = copy(MEMBERSHIPS.with_contract); wider[0].ban.internal = "UNNAMED"; wider[0].request_message = "a member's words";
  assert.doesNotMatch(JSON.stringify(sent("dates_activity_detail", { ...ACTIVITY, memberships: wider })), /UNNAMED|a member's words/);
});

test("queue: where each case's content lives and what its hosts decided are read as served, and a Core that serves neither is read as before", () => {
  const queue = queueOf(QUEUE), released = queueOf(QUEUE_RELEASED);
  assert.ok(queue && released);
  assert.deepEqual(queue.cases, QUEUE.cases); assert.deepEqual(released.cases, QUEUE_RELEASED.cases);
  assert.deepEqual(queue.cases.map((row) => [row.target_type, row.target_id.slice(0, 4), row.surface]), [
    ["message", "wpo_", "event_wall"], ["message", "wco_", "event_wall"], ["message", "msg_", "activity_chat"], ["user", "8102", null], ["message", "wco_", "event_wall"],
    ["message", "msg_", "activity_chat"], ["user", "8113", null], ["user", "8112", null], ["user", "8116", null], ["message", "msg_", "direct_chat"],
    ["message", "wpo_", "event_wall"], ["message", "wpo_", "event_wall"], ["message", "wpo_", "event_wall"]]);
  assert.deepEqual(queue.cases.map(datesCaseTargetKind), ["wall_post", "wall_comment", "activity_chat", null, "wall_comment", "activity_chat", null, null, null, "direct_chat",
    "wall_post", "wall_post", "wall_post"]);
  assert.deepEqual(queue.cases.map(datesCaseHostState), [{ state: "content_removed" }, { state: "kept" }, { state: "waiting" }, { state: "member_banned" }, { state: "waiting" },
    { state: "waiting" }, { state: "member_removed" }, { hosts: 2, decided: 1 }, { state: "not_shown" }, { state: "not_shown" }, { state: "waiting" }, { state: "not_shown" },
    { state: "not_shown" }]);
  // `host_reviews` is the one rule for every case: `host_visible` says whether it has an entry, and `host_review`
  // repeats the single entry of a case about content without its event - never of a case about a member.
  for (const row of queue.cases) {
    assert.equal(row.host_visible, row.host_reviews!.length > 0, row.case_id);
    if (row.target_type === "user") assert.equal(row.host_review, null, `${row.case_id}: a member case has no single review`);
    else assert.deepEqual(row.host_reviews, row.host_review === null ? [] : [{ activity_id: row.activity_id, ...row.host_review }], row.case_id);
  }
  // An open review has no decision and no host yet; `at` is when it was opened. A decided one names the host.
  assert.deepEqual(queue.cases[CASE.wallPostWaiting].host_review, { state: "open", decision: null, by_uid: null, at: NOW });
  assert.deepEqual(queue.cases[CASE.wallPostRemoved].host_review, { state: "handled", decision: "content_removed", by_uid: HOST, at: NOW });
  // A message of a direct thread is never a host's to see; nor is a case the operators had before any host was shown it.
  assert.deepEqual([queue.cases[CASE.directChat].host_visible, queue.cases[CASE.directChat].host_reviews], [false, []]);
  assert.deepEqual([queue.cases[CASE.wallPostActioned].status, queue.cases[CASE.wallPostActioned].host_visible], ["actioned", false]);
  // A host's decision never closes the case: every case a host decided is still open for the operators.
  const decided = queue.cases.filter((row) => row.host_reviews!.some((review) => review.state === "handled"));
  assert.equal(decided.length, 5); assert.ok(decided.every((row) => row.status === "new" && row.capabilities.can_claim));

  // Absent (the released twin; a Core without host moderation): the wall is told by its ids, a chat message cannot be
  // told from its id - of the event's chat or of a direct thread - and stays a message, and nothing is said of a host.
  assert.deepEqual(released.cases.map(datesCaseTargetKind), ["wall_post", "wall_comment", null, null, "wall_comment", null, null, null, null, null, "wall_post", "wall_post", "wall_post"]);
  assert.ok(released.cases.every((row) => datesCaseHostState(row) === null && datesCaseHostReviews(row) === null));
});

test("a case about a member is one case for the whole app: each event whose host was shown it has a review of its own", () => {
  const queue = queueOf(QUEUE)!, detail = detailOf(DETAIL_MEMBER);
  assert.ok(detail);
  assert.deepEqual(detail.case, DETAIL_MEMBER.case); assert.deepEqual(detail.case, queue.cases[CASE.memberTwoEvents], "the queue row and the case detail are one row");
  // GENUINE: a member reported in two events. The host of one kept the member; the host of the other has not decided.
  const kept = { activity_id: SECOND_EVENT, state: "handled", decision: "kept", by_uid: HOST, at: NOW }, waiting = { activity_id: THIRD_EVENT, state: "open", decision: null, by_uid: null, at: NOW };
  assert.deepEqual([detail.case.target_type, detail.case.surface, detail.case.host_visible, detail.case.host_review], ["user", null, true, null]);
  assert.deepEqual(detail.case.host_reviews, [kept, waiting]);
  assert.deepEqual(datesCaseHostReviews(detail.case), [{ event: SECOND_EVENT, review: kept }, { event: THIRD_EVENT, review: waiting }]);
  assert.deepEqual(datesCaseHostState(detail.case), { hosts: 2, decided: 1 });
  assert.equal(detail.case.status, "new", "still open for the operators, whatever the hosts decided");
  // The reports are the operators': two of them, filed from an event's detail, each with the note no host is shown.
  assert.deepEqual(detail.reports.map((report) => [report.entry_point, report.note]), [["detail", "A note only the Friending team may read."], ["detail", "A note only the Friending team may read."]]);
  // GENUINE: one event - that host's decision; and a member no host was shown a report about.
  assert.deepEqual(datesCaseHostReviews(queue.cases[CASE.memberBanned]), [{ event: EVENT, review: { activity_id: EVENT, state: "handled", decision: "member_banned", by_uid: HOST, at: NOW } }]);
  assert.deepEqual(datesCaseHostState(queue.cases[CASE.memberBanned]), { state: "member_banned" });
  assert.deepEqual(datesCaseHostState(queue.cases[CASE.memberRemoved]), { state: "member_removed" });
  assert.deepEqual(datesCaseHostReviews(queue.cases[CASE.memberNotShown]), []); assert.deepEqual(datesCaseHostState(queue.cases[CASE.memberNotShown]), { state: "not_shown" });
  // GENUINE: a case about content keeps its one review, of the case's own event - which the page names once, in the overview.
  assert.deepEqual(datesCaseHostReviews(queue.cases[CASE.wallPostRemoved]), [{ event: null, review: QUEUE.cases[CASE.wallPostRemoved].host_review }]);
  assert.deepEqual(datesCaseHostReviews(queue.cases[CASE.directChat]), []);
});

test("case rows: an addition that is not what Core writes fails the queue as its neighbours do; some of the four without the others is not a row (negative controls)", () => {
  const scope = { page: QUEUE.page, limit: QUEUE.limit };
  const broken = (change: (row: any) => void, index = CASE.wallPostRemoved) => { const body = copy(QUEUE); change(body.cases[index]); return datesModerationQueue(sent("dates_moderation_queue", body), scope); };
  const review = QUEUE.cases[CASE.wallPostRemoved].host_review;
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
    "host_reviews: text": (row) => { row.host_reviews = "none"; }, "host_reviews: a number": (row) => { row.host_reviews = 2; }, "host_reviews: null": (row) => { row.host_reviews = null; },
    "an entry that is not a review": (row) => { row.host_reviews = [5]; }, "an empty entry": (row) => { row.host_reviews = [null]; },
    "an entry without its event": (row) => { row.host_reviews = [{ ...review }]; },
    "an entry of something that is not an event": (row) => { row.host_reviews = [{ ...review, activity_id: "8102" }]; },
    "an entry without a state": (row) => { row.host_reviews = [{ activity_id: EVENT, decision: null, by_uid: null, at: NOW }]; },
    "an entry whose host is text": (row) => { row.host_reviews = [{ ...review, activity_id: EVENT, by_uid: "8101" }]; },
  })) assert.equal(broken(change), null, name);
  // The same strictness as the row's own fields, on the same body.
  assert.equal(broken((row) => { row.status = 5; }), null); assert.equal(broken((row) => { row.sla_breached = "true"; }), null);
  // All four or none.
  const FOUR = ["surface", "host_visible", "host_review", "host_reviews"];
  for (const kept of FOUR) assert.equal(broken((row) => { for (const key of FOUR) if (key !== kept) delete row[key]; }), null, `only ${kept}`);
  for (const gone of FOUR) assert.equal(broken((row) => { delete row[gone]; }), null, `without ${gone}`);
  assert.ok(broken((row) => { for (const key of FOUR) delete row[key]; }), "none of them: a row of a Core that does not serve them");
  // A list where the review is named, and an object where the list is, are not passed on by the projection: three of four.
  assert.equal(broken((row) => { row.host_review = []; }), null); assert.equal(broken((row) => { row.host_reviews = {}; }), null);
  // The same on a case about a member, and on a case detail.
  assert.equal(broken((row) => { row.host_reviews[1].activity_id = "act_1"; }, CASE.memberTwoEvents), null);
  assert.equal(broken((row) => { delete row.host_reviews[0].decision; }, CASE.memberTwoEvents), null);
  for (const change of [(row: any) => { row.surface = 5; }, (row: any) => { row.host_visible = "yes"; }, (row: any) => { row.host_review = { state: "handled" }; },
    (row: any) => { row.host_review.by_uid = "8101"; }, (row: any) => { delete row.host_visible; }, (row: any) => { delete row.host_reviews; }, (row: any) => { row.host_reviews = [{}]; }]) {
    const body = copy(DETAIL); change(body.case);
    assert.equal(datesCaseDetail(sent("dates_moderation_detail", body), body.case.case_id), null, change.toString());
  }

  // DERIVED: a vocabulary is bounded text, as the status and the severity beside it. A value this console has no name
  // for is read, and printed as what it is - never as one of the named values.
  const future = copy(QUEUE);
  Object.assign(future.cases[CASE.wallPostRemoved], { surface: "event_album", host_review: { ...review, decision: "warned" } });
  future.cases[CASE.wallCommentKept].host_review.state = "escalated";
  const read = datesModerationQueue(sent("dates_moderation_queue", future), scope);
  assert.ok(read);
  assert.equal(datesCaseTargetKind(read.cases[CASE.wallPostRemoved]), null, "an unknown surface names nothing: the case stays a message");
  assert.deepEqual(datesCaseHostState(read.cases[CASE.wallPostRemoved]), { unnamed: "warned" }); assert.deepEqual(datesCaseHostState(read.cases[CASE.wallCommentKept]), { unnamed: "escalated" });
});

test("the one function: Core's surface is the answer when it is served, the id only where it is not", () => {
  const queue = queueOf(QUEUE)!, released = queueOf(QUEUE_RELEASED)!;
  const wall = queue.cases[CASE.wallPostRemoved], chat = queue.cases[CASE.chatWaiting], direct = queue.cases[CASE.directChat];
  // GENUINE: the same ids, told apart by the surface alone - a message of the event's chat and one of a direct thread.
  assert.deepEqual([chat.target_id.slice(0, 4), datesCaseTargetKind(chat)], ["msg_", "activity_chat"]); assert.deepEqual([direct.target_id.slice(0, 4), datesCaseTargetKind(direct)], ["msg_", "direct_chat"]);
  // GENUINE: not served (the released twin) - the derivation from the id; neither chat message can be told.
  assert.equal(datesCaseTargetKind(released.cases[CASE.wallPostRemoved]), "wall_post");
  assert.equal(datesCaseTargetKind(released.cases[CASE.chatWaiting]), null); assert.equal(datesCaseTargetKind(released.cases[CASE.directChat]), null);
  // DERIVED: no genuine body has a chat message whose thread Core cannot place. It is served `surface: null`: a message, and no more.
  assert.equal(datesCaseTargetKind({ ...chat, surface: null }), null);
  // DERIVED (bodies Core's rule does not produce): served means served - the id is not read against Core's answer ...
  assert.equal(datesCaseTargetKind({ ...wall, surface: null }), null);
  assert.equal(datesCaseTargetKind({ ...wall, surface: "activity_chat" }), "activity_chat");
  // ... except to say which of the wall's two collections a wall row is in; wall content of neither is named by its surface.
  assert.equal(datesCaseTargetKind({ ...wall, target_id: "wxx_" + "0".repeat(32), surface: "event_wall" }), "event_wall");
  // Only a message case has a surface (Core serves null for any other); a surface on another target names nothing.
  assert.equal(datesCaseTargetKind({ ...queue.cases[CASE.memberBanned], surface: "activity_chat" }), null);

  // DERIVED (bodies Core's rule does not produce): the review is the fact, whatever the flag beside it says; a case
  // that is "shown" with no review is said as that, not as "not shown"; a handled review without a decision is not named.
  const review = { state: "handled", decision: "kept", by_uid: HOST, at: NOW };
  assert.deepEqual(datesCaseHostState({ host_visible: false, host_review: review, host_reviews: [] }), { state: "kept" });
  assert.deepEqual(datesCaseHostState({ host_visible: true, host_review: null, host_reviews: [] }), { state: "shown" });
  assert.deepEqual(datesCaseHostState({ host_visible: true, host_review: { ...review, decision: null }, host_reviews: [] }), { unnamed: "handled" });
  // Not served, in whole or in part, says nothing.
  for (const item of [{}, { host_visible: true }, { host_review: null }, { host_reviews: [] }, { host_visible: false, host_review: null }, { host_visible: false, host_reviews: [] }]) {
    assert.equal(datesCaseHostState(item), null, JSON.stringify(item)); assert.equal(datesCaseHostReviews(item), null);
  }
});

test("case detail: the case carries the same four; a reporter's note stays on the operators' page", () => {
  const detail = detailOf(DETAIL), released = detailOf(DETAIL_RELEASED);
  assert.ok(detail && released);
  assert.deepEqual(detail.case, DETAIL.case); assert.deepEqual(released.case, DETAIL_RELEASED.case);
  assert.equal(datesCaseTargetKind(detail.case), "wall_comment"); assert.deepEqual(datesCaseHostState(detail.case), { state: "kept" });
  assert.deepEqual(detail.case.host_review, { state: "handled", decision: "kept", by_uid: HOST, at: NOW });
  assert.deepEqual(detail.case.host_reviews, [{ activity_id: EVENT, ...detail.case.host_review! }]);
  assert.equal(detail.case.status, "new", "kept by the host, and still open here");
  // The wall's entry point, and the note the host is never shown.
  assert.deepEqual(detail.reports.map((report) => [report.entry_point, report.note]), [["event_wall", "A note only the Friending team may read."]]);
  assert.equal(datesCaseTargetKind(released.case), "wall_comment", "by its id"); assert.equal(datesCaseHostState(released.case), null);
});

/** A row as the page holds it: of a kept link, the address. */
const shown = (row: any) => !row.host_removed?.link ? row : { ...row, host_removed: { ...row.host_removed, link: { url: row.host_removed.link.url } } };

test("event content: who took a row down and what a host removal kept are read as served; the released twin is read as before", () => {
  for (const body of [POSTS, POSTS_SECOND, COMMENTS, COMMENTS_ERASED, MESSAGES, POSTS_RELEASED]) {
    const page = pageOf(body);
    assert.ok(page, `${body.activity_id} ${body.kind}`);
    assert.deepEqual(page.items, body.items.map(shown), body.kind);
  }
  const facts = (body: any) => pageOf(body)!.items.map((row) => [row.state, row.removed_by, row.host_removed === null ? null : row.host_removed!.kind]);
  assert.deepEqual(facts(POSTS), [["active", null, null], ["deleted", "author", null], ["deleted", "host", "link"], ["active", null, null]]);
  // A moderation decision took a post down: the row is `moderated` and still carries its text. A photo the host removed.
  assert.deepEqual(facts(POSTS_SECOND), [["active", null, null], ["moderated", "moderation", null], ["deleted", "host", "photo"], ["active", null, null]]);
  assert.equal(pageOf(POSTS_SECOND)!.items[1].text, "A post the operators remove.");
  assert.ok(pageOf(COMMENTS)!.items.every((row) => row.removed_by === null && row.host_removed === null));
  // What Core kept of the post the host removed: the text and the link, the author the tombstone no longer names, the host and the time.
  const post = pageOf(POSTS)!.items[2];
  assert.deepEqual([post.text, post.author_uid, post.has_media, post.can_review], ["", null, false, false], "the tombstone itself is as bare as any");
  assert.deepEqual(post.host_removed, { text: "Buy my course, it is the best.", kind: "link", link: { url: "https://example.org/course" }, had_media: false, at: NOW, by_uid: HOST, author_uid: 8102 });
  // ... of a photo post: the text, and that it had a photo - the file itself is deleted;
  assert.deepEqual(pageOf(POSTS_SECOND)!.items[2].host_removed, { text: "Anna posts a photo.", kind: "photo", link: null, had_media: true, at: NOW, by_uid: HOST, author_uid: 8112 });
  // ... of a comment whose removing host has since been erased: nobody is named (`null` on the wire, never 0);
  assert.deepEqual(pageOf(COMMENTS_ERASED)!.items[0].host_removed, { text: "A comment the other host removes.", kind: "text", link: null, had_media: false, at: NOW, by_uid: null, author_uid: 8112 });
  // ... and of a chat message the host removed.
  assert.deepEqual(pageOf(MESSAGES)!.items[0].host_removed, { text: "A message the host removes.", kind: "text", link: null, had_media: false, at: NOW, by_uid: HOST, author_uid: 8110 });
  // Absent: a row of the released twin has neither key, and the panel shows nothing of them.
  for (const row of pageOf(POSTS_RELEASED)!.items) { assert.equal(Object.hasOwn(row, "removed_by"), false); assert.equal(Object.hasOwn(row, "host_removed"), false); }

  // DERIVED, each a genuine row with what Core's own rule serves in a state its capture does not reach
  // (DatesEventContentAdminService::removal): removed by the host with nothing kept (the author's account was erased
  // since, or the removal is older than the snapshot), and a snapshot of a row that no longer names its author.
  const derived = (change: (row: any) => void) => { const body = copy(POSTS); change(body.items[2]); return pageOf(body); };
  assert.deepEqual(derived((row) => { row.host_removed = null; })?.items[2].removed_by, "host");
  assert.equal(derived((row) => { row.host_removed.author_uid = null; })?.items[2].host_removed?.author_uid, null);
});

test("event content: an addition that is not what Core writes fails the page as a row's own fields do (negative controls)", () => {
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
    // An erased host is `null` on the wire, never 0.
    "by_uid: text": (row) => { row.host_removed.by_uid = "8101"; }, "by_uid: zero": (row) => { row.host_removed.by_uid = 0; }, "by_uid: missing": (row) => { delete row.host_removed.by_uid; },
    "author_uid: text": (row) => { row.host_removed.author_uid = "8102"; }, "author_uid: zero": (row) => { row.host_removed.author_uid = 0; },
  })) assert.equal(broken(KEPT, change), null, name);
  // The neighbours fail the same page the same way.
  assert.equal(broken(KEPT, (row) => { row.content_kind = "gif"; }), null); assert.equal(broken(KEPT, (row) => { row.report_count = "2"; }), null);
  // Both keys or neither.
  assert.equal(broken(KEPT, (row) => { delete row.host_removed; }), null); assert.equal(broken(KEPT, (row) => { delete row.removed_by; }), null);
  // ... on any row, also where the key that is left says nothing by itself: a tombstone with "nothing kept" and no word of who removed it.
  assert.equal(broken(AUTHOR, (row) => { delete row.removed_by; }), null); assert.equal(broken(AUTHOR, (row) => { delete row.host_removed; }), null);
  assert.equal(broken(LIVE, (row) => { delete row.removed_by; }), null); assert.equal(broken(LIVE, (row) => { delete row.host_removed; }), null);
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
  // GENUINE: the whole event page. A member banned after being removed, and a member whose seat a Dates restriction
  // released: no host removed them (`released_at`, and no `removed_at`), which Core's own rule reads as moderation.
  assert.deepEqual(ACTIVITY.memberships[4].released_reason, "dates_restriction");
  assert.deepEqual([ACTIVITY.memberships[4].released_at, ACTIVITY.memberships[4].removed_at, ACTIVITY.memberships[4].removed_by_uid], [NOW, null, null]);
  assert.deepEqual(datesMemberships(sent("dates_activity_detail", ACTIVITY).memberships), { rows: [
    { uid: 8112, relationship: "joined", standing: null, lifted: null, unreadable: false },
    { uid: 8113, relationship: "removed", standing: { state: "banned", at: NOW, by_uid: HOST, note: null }, lifted: null, unreadable: false },
    { uid: 8114, relationship: "joined", standing: null, lifted: null, unreadable: false },
    { uid: 8115, relationship: "joined", standing: null, lifted: null, unreadable: false },
    { uid: 8117, relationship: "removed", standing: { state: "removed", at: NOW, by: { kind: "moderation" }, note: null }, lifted: null, unreadable: false },
  ], counts: { removed: 1, banned: 1 } });

  // GENUINE: the member rows of the first event (the excerpt), with the selector.
  const read = membershipsOf(MEMBERSHIPS.with_contract);
  assert.deepEqual(read.rows, [
    // Banned while a participant: the relationship is `removed`, and the row is listed as banned.
    { uid: 8102, relationship: "removed", standing: { state: "banned", at: NOW, by_uid: HOST, note: "Kept insulting other guests." }, lifted: null, unreadable: false },
    // Banned with no relationship (an invitation withdrawn by the ban).
    { uid: 8104, relationship: "none", standing: { state: "banned", at: NOW, by_uid: HOST, note: null }, lifted: null, unreadable: false },
    { uid: 8105, relationship: "joined", standing: null, lifted: null, unreadable: false },
    { uid: 8106, relationship: "joined", standing: null, lifted: null, unreadable: false },
    // A ban that was lifted: not banned, and said as lifted.
    { uid: 8107, relationship: "none", standing: null, lifted: { at: NOW, by_uid: HOST, banned_at: NOW }, unreadable: false },
    // Removed by the host, with the host's note.
    { uid: 8108, relationship: "removed", standing: { state: "removed", at: NOW, by: { kind: "host", uid: HOST }, note: "Arrived drunk." }, lifted: null, unreadable: false },
    // Removed by a moderation decision: no host, no note.
    { uid: 8109, relationship: "removed", standing: { state: "removed", at: 1789999950, by: { kind: "moderation" }, note: null }, lifted: null, unreadable: false },
    { uid: 8110, relationship: "joined", standing: null, lifted: null, unreadable: false },
  ]);
  assert.deepEqual(read.counts, { removed: 2, banned: 2 });
  assert.deepEqual(datesMemberships(MEMBERSHIPS.with_contract), read, "the projection takes nothing the page reads");

  // Absent (the same rows as the released console is served them; a Core without host moderation): what the row itself
  // says is still read - the host removed two members and moderation one - and nothing is said of a ban, a note, or
  // how many are banned.
  const released = membershipsOf(MEMBERSHIPS.released);
  assert.deepEqual(released.rows.filter((row) => row.standing !== null).map((row) => [row.uid, row.standing]), [
    [8102, { state: "removed", at: NOW, by: { kind: "host", uid: HOST }, note: null }], [8108, { state: "removed", at: NOW, by: { kind: "host", uid: HOST }, note: null }],
    [8109, { state: "removed", at: 1789999950, by: { kind: "moderation" }, note: null }]]);
  assert.ok(released.rows.every((row) => row.lifted === null && !row.unreadable));
  assert.equal(released.counts, null, "who is banned was not served: no count");
  assert.deepEqual(datesMemberships([]), { rows: [], counts: null }); assert.deepEqual(datesMemberships(null), { rows: [], counts: null });

  // DERIVED, each a genuine row in a state Core's capture does not reach, read by Core's own rule
  // (DatesHostModerationPolicy::removedEntry).
  const one = (index: number, change: Record<string, unknown>) => membershipsOf([{ ...MEMBERSHIPS.with_contract[index], ...change }]).rows[0];
  const HOST_REMOVED = 5, MODERATED = 6, JOINED = 2;
  // The host removed the member again after an earlier release, and the other way round: the later of the two is the removal.
  assert.deepEqual(one(HOST_REMOVED, { released_at: NOW - 10 }).standing, { state: "removed", at: NOW, by: { kind: "host", uid: HOST }, note: "Arrived drunk." });
  assert.deepEqual(one(HOST_REMOVED, { released_at: NOW + 10 }).standing, { state: "removed", at: NOW + 10, by: { kind: "moderation" }, note: null });
  // A note an earlier host removal left on the row is not the operators': not shown beside a moderation removal.
  assert.equal(one(MODERATED, { removal_note: "An older note of the host." }).standing?.note, null);
  // A removed member whose row names nobody and no time: removed, and nothing is guessed.
  assert.deepEqual(one(HOST_REMOVED, { removed_at: null, removed_by_uid: null, removal_note: null }).standing, { state: "removed", at: null, by: { kind: "unknown" }, note: null });
  // A note that is only space is no note; a ban whose host is not named has no host to link.
  assert.equal(one(HOST_REMOVED, { removal_note: "   " }).standing?.note, null);
  assert.deepEqual(one(0, { ban: { ...MEMBERSHIPS.with_contract[0].ban, by_uid: 0 } }).standing, { state: "banned", at: NOW, by_uid: null, note: "Kept insulting other guests." });
  // The other facts of a member who is not removed say nothing (a re-invited member keeps an old `removed_at`).
  assert.equal(one(JOINED, { removed_at: NOW - 500, removed_by_uid: HOST }).standing, null);
});

test("memberships: a served fact that is not what Core writes makes that row unreadable - never 'not removed, not banned' - and stops the counts (negative controls)", () => {
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

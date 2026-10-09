import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DATES_ADMIN_ACTIONS } from "../lib/adminActions.ts";
import { DATES_RESEARCH_ACTIONS } from "../lib/datesResearchAdmin.ts";
import { OPERATIONAL_RECORD_SAFE_KEYS, operationalRecordSummary } from "../lib/auditLog.ts";
import {
  DATES_ADMIN_DENIED_KEYS, DATES_ADMIN_NAMED, DATES_ADMIN_OPAQUE, isDatesAdminRoute, projectDatesAdminBody, type DatesNamedTree,
} from "../lib/datesAdminProjection.ts";
import { eventContentPage } from "../lib/datesEventContent.ts";
import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalPlaces } from "../lib/datesExternalAdmin.ts";
import { datesExternalMessageResolutionReceipt } from "../lib/datesExternalMessageModeration.ts";
import { projectDatesIntakeDetail, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { datesCaseDetail, datesEvidenceRead, datesModerationQueue } from "../lib/datesModerationRead.ts";

// Lead's ruling on D-143: nothing unnamed reaches the browser. The bridge
// hands the browser the PROJECTION of a Dates Core body - the fields this
// console names - never the raw body. These tests hold the projection to the
// genuine bodies of every Dates corpus and to the deny-list.
const FIXTURES = new URL("./fixtures/", import.meta.url);
const CORPORA = ["dates_admin_command_wire", "dates_event_intake_admin_wire", "dates_external_admin_wire", "dates_external_admin_wire_released", "dates_moderation_console_wire",
  "dates_moderation_wire", "dates_event_icons_wire", "dates_external_pins_wire", "dates_suggestion_leaderboard_member_wire", "dates_event_content_wire"];
const read = (corpus: string, file: string) => JSON.parse(readFileSync(new URL(`${corpus}/${file}`, FIXTURES), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Which route answered a genuine body, by the corpus's file names. `null`: not a console body (the app's). */
function routeOf(corpus: string, file: string): string | null {
  const name = file.slice(0, -5);
  if (corpus === "dates_event_content_wire") return !name.startsWith("admin-") ? null : name === "admin-wall-review" ? "dates_event_content_review" : "dates_event_content";
  // The icon corpus names a file after its route, then "-" and the case (tests/fixtures/dates_event_icons_wire/provenance.txt).
  if (corpus === "dates_event_icons_wire") return name.split("-")[0];
  // The third-party pin corpus is Core's own (tests/fixtures/dates_external_pins_wire/provenance.txt): reads, saves, and one file of the app's side.
  if (corpus === "dates_external_pins_wire") return name.startsWith("member-") ? null : name.startsWith("webadmin-pins-save") ? "dates_external_pins_save" : "dates_external_pins";
  // Core's leaderboard corpus: the console's bodies in it are saves of a setting; the four-row excerpt of the configuration read is no route body.
  if (corpus === "dates_suggestion_leaderboard_member_wire") return name.startsWith("webadmin-setting-save-") ? "dates_configuration_save" : null;
  const first = (table: Array<[string, string]>) => table.find(([prefix]) => name.startsWith(prefix))?.[1];
  if (name.startsWith("member-")) return null;
  if (corpus === "dates_admin_command_wire") return first([["admin-hold-", "dates_moderation_legal_hold"], ["admin-trail-", "dates_moderation_trail_evidence"],
    ["admin-host-transfer", "dates_activity_host_transfer"], ["admin-activity-update", "dates_activity_update"], ["admin-activity-type-save", "dates_activity_type_save"],
    ["admin-activity-", "dates_activity_command"], ["admin-configuration-save", "dates_configuration_save"], ["admin-reason-deactivate", "dates_reason_deactivate"],
    ["admin-resolve-", "dates_moderation_resolve"], ["admin-evidence-", "dates_moderation_evidence"]]) ?? "?";
  if (corpus === "dates_event_intake_admin_wire") return first([["admin-list-", "dates_event_intake_list"], ["admin-detail-", "dates_event_intake_detail"],
    ["admin-create-", "dates_event_intake_create"], ["admin-lease-", "dates_event_intake_lease"], ["admin-reject-", "dates_event_intake_reject"],
    ["admin-duplicate-of-event", "dates_event_intake_reject"], ["admin-ask-member", "dates_event_intake_ask_member"], ["admin-publish", "dates_event_intake_publish"],
    ["admin-usage-", "dates_event_intake_usage"], ["admin-image-", "dates_event_intake_image"], ["admin-external-detail-", "dates_external_event_detail"],
    ["admin-external-list-", "dates_external_event_list"], ["admin-activity-detail-", "dates_activity_detail"], ["admin-activity-list-", "dates_activity_list"],
    ["admin-unauthorized", "dates_event_intake_list"],
    ["admin-configuration-save", "dates_configuration_save"], ["admin-configuration", "dates_configuration"],
    ["admin-revoked", "dates_event_intake_list"]]) ?? "?";
  if (corpus.startsWith("dates_external_admin_wire")) {
    if (name.startsWith("admin-chat-")) {
      const rest = name.split("-").slice(3).join("-");
      return rest.startsWith("queue") ? "dates_moderation_queue" : rest.startsWith("evidence") ? "dates_moderation_evidence" : rest.startsWith("claimed") ? "dates_moderation_detail"
        : rest.startsWith("claim") ? "dates_moderation_claim" : rest.startsWith("resolved") ? "dates_moderation_detail" : rest.startsWith("resolve") ? "dates_moderation_resolve"
          : rest.startsWith("stale") ? "dates_moderation_claim" : "dates_moderation_detail";
    }
    if (name.startsWith("admin-variety-")) return name.endsWith("-list") ? "dates_external_event_list" : "dates_external_event_detail";
    return first([["admin-activity-list-", "dates_activity_list"], ["admin-activity-detail-", "dates_activity_detail"], ["admin-activity-", "dates_activity_command"],
      ["admin-configuration-", "dates_configuration"], ["admin-moderation-detail-", "dates_moderation_detail"], ["admin-moderation-queue", "dates_moderation_queue"],
      ["admin-moderation-evidence", "dates_moderation_evidence"], ["admin-moderation-claim", "dates_moderation_claim"], ["admin-moderation-hold-", "dates_moderation_legal_hold"],
      ["admin-moderation-", "dates_moderation_resolve"], ["admin-reason-list", "dates_reason_list"], ["admin-reason-save", "dates_reason_save"], ["admin-reason-", "dates_reason_list"],
      ["admin-held-list", "dates_external_event_list"], ["admin-held-detail", "dates_external_event_detail"], ["admin-held-update", "dates_external_event_update"],
      ["admin-held-", "dates_external_event_command"], ["admin-list-", "dates_external_event_list"], ["admin-detail-", "dates_external_event_detail"],
      ["admin-places-", "dates_external_event_place_search"], ["admin-place-", "dates_external_event_place_search"], ["admin-publish", "dates_external_event_publish"],
      ["admin-update", "dates_external_event_update"], ["admin-official-update", "dates_external_event_command"], ["admin-reverify", "dates_external_event_command"],
      ["admin-cancel", "dates_external_event_command"], ["admin-withdraw", "dates_external_event_command"]]) ?? (name.endsWith("-denied") ? "dates_external_event_list" : "?");
  }
  if (corpus === "dates_moderation_console_wire") return first([["admin-claim", "dates_moderation_claim"], ["admin-escalate", "dates_moderation_escalate"],
    ["admin-heartbeat", "dates_moderation_heartbeat"], ["admin-note", "dates_moderation_note"], ["admin-queue-", "dates_moderation_queue"], ["admin-release", "dates_moderation_release"],
    ["admin-sla-", "dates_moderation_sla"]]) ?? "?";
  return name.startsWith("admin-detail-") ? "dates_moderation_detail" : "dates_moderation_evidence";
}
type Genuine = { corpus: string; file: string; route: string; body: any };
const GENUINE: Genuine[] = CORPORA.flatMap((corpus) => readdirSync(new URL(`${corpus}/`, FIXTURES)).filter((file) => file.endsWith(".json") && file !== "manifest.json").sort()
  .flatMap((file) => { const route = routeOf(corpus, file); return route === null ? [] : [{ corpus, file, route, body: read(corpus, file) }]; }));
const SUCCESSES = GENUINE.filter((item) => item.body.success === true && item.route !== "dates_event_intake_image");

test("every Dates Admin route this console calls has its named fields, and no other route is projected", () => {
  assert.deepEqual(GENUINE.filter((item) => item.route === "?").map((item) => item.file), [], "every genuine body is mapped to its route");
  // The generic actions of the bridge, plus the multipart create (its own route). The flyer read hands bytes to the browser, never JSON.
  const routes = [...DATES_ADMIN_ACTIONS.filter((action) => action !== "admin_me"), "dates_event_intake_create"].sort();
  assert.deepEqual(Object.keys(DATES_ADMIN_NAMED).sort(), routes);
  for (const route of routes) assert.equal(isDatesAdminRoute(route), true, route);
  for (const action of ["admin_me", "users_list", "list_audit", "date_x", "Dates_configuration"]) assert.equal(isDatesAdminRoute(action), false, action);
  // A Dates route without named fields has no body the browser may see: the bridge answers with its own error.
  assert.equal(projectDatesAdminBody("dates_future_route", { success: true, status_code: 200, anything: 1 }), undefined);
  assert.equal(projectDatesAdminBody("dates_event_intake_list", null), null);
  for (const odd of ["text", 5, [1], true]) assert.equal(projectDatesAdminBody("dates_event_intake_list", odd), undefined);
  const bridge = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(bridge, /if \(isDatesAdminRoute\(action\)\) \{[\s\S]{0,400}const projected = projectDatesAdminResponse\(action, result\.data\);\s+if \(projected === undefined\) return bridgeError\("invalid-core-response", 502\);\s+return NextResponse\.json\(projected,/);
  // The route handler itself writes to no log (a released test holds it to that); the one line of a denied key comes from the projection.
  assert.doesNotMatch(bridge, /console\./);
  const module = readFileSync(new URL("../lib/datesAdminProjection.ts", import.meta.url), "utf8");
  assert.equal((module.match(/console\.\w+\(/g) ?? []).length, 1); assert.match(module, /return projectDatesAdminBody\(action, body, \(line\) => console\.warn\(line\)\);/);
});

test("the projection of every genuine body is that body: no named field is lost, on any of the four corpora", () => {
  assert.ok(GENUINE.length > 450, String(GENUINE.length));
  const lines: string[] = [];
  let successes = 0, refusals = 0;
  for (const { corpus, file, route, body } of GENUINE) {
    if (route === "dates_event_intake_image") continue;
    assert.deepEqual(projectDatesAdminBody(route, body, (line) => lines.push(line)), body, `${corpus}/${file} (${route})`);
    if (body.success === true) successes++; else refusals++;
  }
  // Nothing of a genuine body is on the deny-list either.
  assert.deepEqual(lines, []);
  assert.ok(successes > 300 && refusals > 140, `${successes} / ${refusals}`);
  // Each route that has a genuine success body, by name - the others are listed with the reason they have none.
  const covered = new Set(SUCCESSES.map((item) => item.route));
  assert.deepEqual(Object.keys(DATES_ADMIN_NAMED).filter((route) => !(DATES_RESEARCH_ACTIONS as readonly string[]).includes(route) && !covered.has(route)).sort(), ["dates_activity_location"],
    "no genuine body: only the break-glass location (since T-891 every command receipt has Core's genuine bodies)");
});

/** Adds a key to every object the tree names (not inside a part kept whole): what the projection must take out again. */
function widen(value: any, tree: DatesNamedTree, added: { count: number }): void {
  if (tree === 1 || tree === "opaque" || value === null || typeof value !== "object") return;
  if (Array.isArray(tree)) { if (Array.isArray(value)) for (const item of value) widen(item, tree[0], added); return; }
  if (Array.isArray(value) || typeof (tree as { keys?: unknown }).keys !== "undefined" && tree.constructor !== Object) return;
  for (const [key, sub] of Object.entries(tree as Record<string, DatesNamedTree>)) if (Object.hasOwn(value, key)) widen(value[key], sub, added);
  value.future_key = { secret: "UNNAMED-VALUE" }; value.another_future_key = "UNNAMED-VALUE"; added.count++;
}

test("per route: a key this console does not name, at any depth, is not in what the browser receives", () => {
  const perRoute = new Map<string, number>();
  for (const { corpus, file, route, body } of SUCCESSES) {
    const wider = copy(body), added = { count: 0 };
    widen(wider, DATES_ADMIN_NAMED[route], added);
    assert.ok(added.count >= 1 && JSON.stringify(wider).includes("UNNAMED-VALUE"));
    const lines: string[] = [];
    const sent = projectDatesAdminBody(route, wider, (line) => lines.push(line));
    assert.deepEqual(sent, body, `${corpus}/${file} (${route})`);
    assert.equal(JSON.stringify(sent).includes("UNNAMED-VALUE"), false); assert.equal(JSON.stringify(sent).includes("future_key"), false);
    // An unknown key is an additive change of Core, not an alarm: nothing is logged for it.
    assert.deepEqual(lines, []);
    perRoute.set(route, (perRoute.get(route) ?? 0) + added.count);
  }
  // Every route family with a genuine body was exercised, and deep: the intake detail alone has dozens of named objects.
  assert.equal(perRoute.size, Object.keys(DATES_ADMIN_NAMED).length - DATES_RESEARCH_ACTIONS.length - 1);
  assert.ok(perRoute.get("dates_event_intake_detail")! > 500 && perRoute.get("dates_moderation_detail")! > 30 && perRoute.get("dates_external_event_detail")! > 100);
  // A refusal is Core's six keys and nothing beside them.
  const refusal = GENUINE.find((item) => item.body.success === false)!.body;
  assert.deepEqual(projectDatesAdminBody("dates_event_intake_list", { ...refusal, debug: { trace: "UNNAMED-VALUE" }, admin_email: "x@example.test" }), refusal);
  assert.deepEqual(projectDatesAdminBody("dates_future_route", { ...refusal, debug: 1 }), refusal, "a refusal needs no named route");
});

test("a named scalar is a scalar: an object or a list of objects in its place is not passed on", () => {
  const list = SUCCESSES.find((item) => item.file === "admin-list-in-review.json")!.body;
  for (const [change, gone] of [[(body: any) => { body.total = { nested: "UNNAMED-VALUE" }; }, "total"], [(body: any) => { body.capabilities = [{ nested: "UNNAMED-VALUE" }]; }, "capabilities"],
    [(body: any) => { body.intakes[0].first_title = { html: "UNNAMED-VALUE" }; }, "first_title"]] as const) {
    const body = copy(list); change(body);
    const sent = projectDatesAdminBody("dates_event_intake_list", body) as any;
    assert.equal(JSON.stringify(sent).includes("UNNAMED-VALUE"), false, gone);
    assert.equal(Object.hasOwn(gone === "first_title" ? sent.intakes[0] : sent, gone), false, `${gone} is dropped; the decoder then reports what is missing`);
  }
  // A list where an object is named, and an object where a list is named, carry no named field: dropped.
  const odd = copy(list); odd.status_counts = [1, 2]; odd.intakes = { "0": list.intakes[0] };
  assert.deepEqual(Object.keys(projectDatesAdminBody("dates_event_intake_list", odd) as object).filter((key) => key === "status_counts" || key === "intakes"), []);
  // A scalar where an object is named has no key to hide; it is left for the decoder to refuse.
  const flat = copy(list); flat.status_counts = "none"; flat.intakes = [null, 5, list.intakes[0]];
  const sent = projectDatesAdminBody("dates_event_intake_list", flat) as any;
  assert.equal(sent.status_counts, "none"); assert.deepEqual(sent.intakes, [null, 5, list.intakes[0]]);
  assert.equal(projectDatesIntakeQueue(sent, { page: list.page, limit: list.limit }), null);
});

/** The value at a path of the deny-list is set on every place the path reaches; returns how many places. */
function inject(body: any, path: string, value: unknown): number {
  const parts = path.split(".");
  const step = (node: any, index: number): number => {
    if (node === null || typeof node !== "object") return 0;
    const part = parts[index], list = part.endsWith("[]"), key = list ? part.slice(0, -2) : part;
    if (index === parts.length - 1) { node[key] = value; return 1; }
    const next = node[key];
    if (list) return Array.isArray(next) ? next.reduce((sum: number, item: unknown) => sum + step(item, index + 1), 0) : 0;
    return step(next, index + 1);
  };
  return step(body, 0);
}
/** That the page still renders: the decoder of the route reads what the browser received. */
const DECODES: Record<string, (sent: any) => boolean> = {
  dates_moderation_queue: (sent) => datesModerationQueue(sent, { page: sent.page, limit: sent.limit }) !== null,
  dates_moderation_detail: (sent) => datesCaseDetail(sent, sent.case.case_id) !== null,
  dates_moderation_evidence: (sent) => datesEvidenceRead(sent, { case_id: sent.case_id, appeal_id: sent.appeal_note?.appeal_id ?? null,
    include_sensitive_location: sent.evidence.some((row: any) => row.sensitive_location), break_glass: sent.break_glass_used }) !== null,
  dates_moderation_resolve: (sent) => sent.target_result.target_type !== "message" || typeof datesExternalMessageResolutionReceipt === "function",
  dates_event_content: (sent) => eventContentPage(sent, sent.activity_id, sent.kind) !== null,
  dates_external_event_list: (sent) => decodeDatesExternalList(sent, { page: sent.page, limit: sent.limit }) !== null,
  dates_external_event_detail: (sent) => decodeDatesExternalDetail(sent, sent.event.external_event_id) !== null,
  dates_activity_detail: (sent) => decodeDatesActivityOriginDetail(sent, sent.activity.activity_id, ["dates_external_event_read", "dates_external_event_manage"]) !== null,
  dates_external_event_place_search: (sent) => decodeDatesExternalPlaces(sent) !== null,
  dates_event_intake_list: (sent) => { const queue = projectDatesIntakeQueue(sent, { page: sent.page, limit: sent.limit }); return queue !== null && queue.unreadable_rows.length === 0; },
  dates_event_intake_detail: (sent) => { const detail = projectDatesIntakeDetail(sent, sent.intake.intake_id); return detail !== null && detail.intake.unreadable_sections.length === 0; },
};

for (const [route, contract] of Object.entries(DATES_ADMIN_DENIED_KEYS)) test(`deny-list ${contract.family}: a key Core must never send is dropped, the page still renders, and one warning names it - never its value`, () => {
  assert.ok(Object.hasOwn(DATES_ADMIN_NAMED, route) && Object.hasOwn(DECODES, route), route);
  assert.match(contract.family, /^[a-z][a-z-]+$/); assert.equal(new Set(contract.keys).size, contract.keys.length);
  for (const key of contract.keys) {
    // A genuine body of this route that has the place the key would sit in.
    const SECRET = `SENSITIVE-${key.replace(/\W+/g, "-")}-VALUE`;
    const carrier = SUCCESSES.filter((item) => item.route === route).find((item) => inject(copy(item.body), key, SECRET) > 0);
    assert.ok(carrier, `no genuine ${route} body has the place of ${key}`);
    const leaking = copy(carrier.body), places = inject(leaking, key, key.endsWith("before") || key.endsWith("after") ? { photo: { url: SECRET } } : SECRET);
    assert.ok(JSON.stringify(leaking).includes(SECRET));
    const lines: string[] = [];
    const sent = projectDatesAdminBody(route, leaking, (line) => lines.push(line)) as any;
    // Dropped: what the browser receives is the genuine body again.
    assert.deepEqual(sent, carrier.body, key); assert.equal(JSON.stringify(sent).includes(SECRET), false, key);
    // The page still renders.
    assert.equal(DECODES[route](sent), true, `${key}: ${carrier.file} still decodes`);
    // One warning for the response and key: the route, the family, the key's name, how often - and nothing of the value.
    assert.deepEqual(lines, [`webadmin.dates_denied_key route=${route} family=${contract.family} key=${key} count=${places}`], key);
    assert.equal(lines.join("\n").includes(SECRET), false, key); assert.equal(lines.join("\n").includes("SENSITIVE"), false, key);
    // The key is denied because it is not named: naming it later must be a decision, not a side effect.
    const parts = key.split(".");
    let tree: any = DATES_ADMIN_NAMED[route];
    for (const part of parts.slice(0, -1)) tree = part.endsWith("[]") ? tree[part.slice(0, -2)][0] : tree[part];
    assert.equal(Object.hasOwn(tree, parts.at(-1)!), false, `${key} is not a named field`);
  }
});

test("the deny-list is the one lead's ruling names, and more: every key the released decoders used to catch by refusing", () => {
  const all = Object.entries(DATES_ADMIN_DENIED_KEYS).flatMap(([route, contract]) => contract.keys.map((key) => `${route}:${key}`));
  for (const named of ["dates_moderation_detail:decisions[].before", "dates_moderation_detail:decisions[].actor_email", "dates_moderation_detail:decisions[].text",
    "dates_moderation_detail:reports[].reporter_uid", "dates_moderation_detail:appeal.note", "dates_moderation_detail:appeal.appellant_uid",
    "dates_moderation_detail:case.text", "dates_moderation_detail:case.snapshot", "dates_external_event_detail:event.intake.provider",
    "dates_external_event_detail:event.intake.admin_principal", "dates_activity_detail:external_event.intake.provider", "dates_moderation_queue:cases[].internal_notes",
    // found by comparing what Core stores with what its projections serve (Core main 07215298 / 75eb6052, read from git objects):
    "dates_moderation_detail:decisions[].subject_uid", "dates_moderation_detail:decisions[].after", "dates_event_intake_detail:intake.submitter_uid",
    "dates_event_intake_detail:intake.consent", "dates_event_intake_detail:intake.inputs.origin_hint", "dates_event_intake_detail:intake.inputs.images[].storage_key",
    "dates_event_intake_detail:intake.ai_runs[].prompt"]) assert.ok(all.includes(named), named);
  assert.equal(all.length, 75);
  // The document carries the same list, route by route and key by key.
  const document = readFileSync(new URL("../docs/DATES_EVENT_INTAKE_CONSOLE.md", import.meta.url), "utf8");
  for (const [route, contract] of Object.entries(DATES_ADMIN_DENIED_KEYS)) {
    assert.ok(document.includes(`\`${route}\``), route);
    for (const key of contract.keys) assert.ok(document.includes(`\`${key}\``), `${route}: ${key} is in the document`);
  }
});

test("the parts kept whole are exactly the listed ones, each bounded by its own route", () => {
  const found: Record<string, string[]> = {};
  const walk = (tree: DatesNamedTree, path: string, route: string) => {
    if (tree === "opaque") { (found[route] ??= []).push(path); return; }
    if (tree === 1 || tree.constructor !== Object && !Array.isArray(tree)) return;
    if (Array.isArray(tree)) { walk(tree[0], `${path}[]`, route); return; }
    for (const [key, sub] of Object.entries(tree as Record<string, DatesNamedTree>)) walk(sub, path === "" ? key : `${path}.${key}`, route);
  };
  for (const [route, tree] of Object.entries(DATES_ADMIN_NAMED)) walk(tree, "", route);
  assert.deepEqual(found, { ...DATES_ADMIN_OPAQUE });
  assert.deepEqual(Object.keys(DATES_ADMIN_OPAQUE).sort(), ["dates_activity_detail", "dates_activity_location", "dates_configuration", "dates_configuration_save",
    "dates_moderation_evidence"]);
  // Kept whole means whole: the evidence snapshot of the audited read arrives as Core served it.
  const evidence = SUCCESSES.find((item) => item.route === "dates_moderation_evidence" && item.body.evidence.length > 0)!.body, wider = copy(evidence);
  wider.evidence[0].snapshot.future = { any: "thing" };
  assert.deepEqual((projectDatesAdminBody("dates_moderation_evidence", wider) as any).evidence[0].snapshot, wider.evidence[0].snapshot);
  // ... and only there: beside the snapshot the row is named fields again.
  wider.evidence[0].reporter_uid = 5;
  assert.equal(Object.hasOwn((projectDatesAdminBody("dates_moderation_evidence", wider) as any).evidence[0], "reporter_uid"), false);
  const document = readFileSync(new URL("../docs/DATES_EVENT_INTAKE_CONSOLE.md", import.meta.url), "utf8");
  for (const [route, paths] of Object.entries(DATES_ADMIN_OPAQUE)) for (const path of paths) assert.ok(document.includes(`\`${route}\``) && document.includes(`\`${path}\``), `${route}: ${path}`);
});

/**
 * Every key a Core evidence writer can put on a `moderation_evidence` row, read from Core's source (git objects) on main
 * 07215298, the P2 branch b5b2b299 and the T-891 branch 33265e46 - the same keys on all three - and the same list the
 * Core lane states for main and its branch (team/chat/20261003T023124Z-opus-core-fix-to-lead-t891-core-pin-evidence.md;
 * no key is missing on either side):
 * - the inserts: DatesModerationEvidenceService::store (83-98), DatesPrepublicationModerationService (148-162, with
 *   `target_revision`), DatesTrailEvidenceService (33265e46: 242-268; 07215298: 166-191, with `restricted_access`);
 * - a legal hold placed: `legal_basis`, `hold_updated_at` (DatesModerationCommandService, 33265e46: 676-690; 07215298: 559-566);
 * - released: `hold_released_at`, `hold_release_reason`, `hold_release_legal_basis`, `hold_updated_at`, `purge_at` when a
 *   retention is set (33265e46: 693-710; 07215298: 567-587);
 * - an automatic hold closed: `automatic_hold_closed_at`, `purge_at` (DatesPrepublicationModerationService 24-56);
 * - an account erased with an open case: `restricted_access` (DatesAccountLifecycleService, 33265e46: 95-116).
 * `activity_id` is on the rows of the moderation corpus (its generator's own inserts) and stays named.
 */
const EVIDENCE_WRITER_KEYS = ["evidence_id", "case_id", "report_id", "evidence_type", "sensitive_location", "snapshot", "target_revision", "immutable", "legal_hold",
  "hold_started_at", "hold_reason", "review_at", "created_at", "restricted_access", "legal_basis", "hold_updated_at", "hold_released_at", "hold_release_reason",
  "hold_release_legal_basis", "purge_at", "automatic_hold_closed_at"];

test("review finding (opus-review-p2, MEDIUM): an evidence row after a hold, a release, an automatic close or an erasure reaches the browser whole", () => {
  const row = (DATES_ADMIN_NAMED.dates_moderation_evidence as any).evidence[0];
  for (const key of EVIDENCE_WRITER_KEYS) assert.ok(Object.hasOwn(row, key), `${key} is named`);
  assert.equal(row.purge_at, "opaque", "a MongoDB date is passed as served"); assert.equal(row.snapshot, "opaque");
  // GENUINE (Core 754b9eb3, command corpus): the evidence read after a legal hold was placed, amended and released - each
  // the body itself after the projection, no warning, read by the page's decoder.
  const served: Record<string, any> = {};
  for (const name of ["placed", "amended", "released"]) {
    const body = read("dates_admin_command_wire", `admin-evidence-hold-${name}.json`), lines: string[] = [];
    const sent = projectDatesAdminBody("dates_moderation_evidence", body, (line) => lines.push(line)) as any;
    assert.deepEqual(sent, body, name); assert.deepEqual(lines, [], `${name}: nothing to warn about`);
    assert.equal(DECODES.dates_moderation_evidence(sent), true, `${name}: the page reads it`);
    served[name] = body.evidence[0];
  }
  // They carry what the finding was about: the basis and the update time once held, the release fields and the purge
  // date (extended JSON, as served) once released.
  for (const key of ["legal_basis", "hold_updated_at"]) assert.ok(Object.hasOwn(served.placed, key) && Object.hasOwn(served.amended, key), key);
  for (const key of ["hold_released_at", "hold_release_reason", "hold_release_legal_basis", "purge_at"]) assert.ok(Object.hasOwn(served.released, key), key);
  assert.deepEqual(Object.keys(served.released.purge_at), ["$date"]);
  // DERIVED, NOT GENUINE - only where no genuine body covers the case: an automatic hold closed, a restricted trail
  // snapshot, an erased account. Each row is the genuine P1 evidence row with what the writer named above sets on it.
  const base = read("dates_external_admin_wire", "admin-moderation-evidence.json"), genuine = base.evidence[0], now = 1790000000;
  const purgeAt = { $date: { $numberLong: String((now + 30 * 86400) * 1000) } };
  const ROWS: Record<string, Record<string, unknown>> = {
    closed: { ...genuine, evidence_type: "activity_prepublication_snapshot", report_id: null, target_revision: 3, legal_hold: false, automatic_hold_closed_at: now, purge_at: purgeAt },
    trail: { ...genuine, evidence_type: "live_trail_window_snapshot", report_id: null, sensitive_location: true, restricted_access: true, hold_reason: "open_safety_case_trail_subset",
      snapshot: { activity_id: "act_" + "4".padStart(32, "0"), requested_window: { captured_from: now - 600, captured_to: now - 60 }, captured_window: { first_at: now - 540, last_at: now - 120 },
        point_count: 2, points: [{ lat: 47.49, lng: 19.04, captured_at: now - 540 }, { lat: 47.5, lng: 19.05, captured_at: now - 120 }] } },
    erased: { ...genuine, legal_hold: true, hold_started_at: now, hold_reason: "account_erasure_open_safety_case", restricted_access: true },
  };
  for (const [name, evidence] of Object.entries(ROWS)) {
    const body = { ...base, evidence: [evidence] }, lines: string[] = [];
    const sent = projectDatesAdminBody("dates_moderation_evidence", body, (line) => lines.push(line)) as any;
    // What the released console showed (it printed the row whole): the same row, key for key, value for value.
    assert.deepEqual(sent, body, name); assert.deepEqual(lines, [], `${name}: nothing to warn about`);
    assert.equal(DECODES.dates_moderation_evidence(sent), true, `${name}: the page reads it`);
  }
  assert.deepEqual((projectDatesAdminBody("dates_moderation_evidence", { ...base, evidence: [ROWS.closed] }) as any).evidence[0].purge_at, purgeAt);
  // Still named fields only: a key no writer sets is dropped beside them.
  const released = read("dates_admin_command_wire", "admin-evidence-hold-released.json");
  const unknown = projectDatesAdminBody("dates_moderation_evidence", { ...released, evidence: [{ ...released.evidence[0], future_key: "x" }] }) as any;
  assert.equal(Object.hasOwn(unknown.evidence[0], "future_key"), false); assert.equal(unknown.evidence[0].hold_release_reason, "Synthetic withdrawal.");
  // And the row is not kept whole: the snapshot and the purge date are the only parts passed as served.
  assert.deepEqual(DATES_ADMIN_OPAQUE.dates_moderation_evidence, ["evidence[].snapshot", "evidence[].purge_at"]);
});

test("a record Core passes through whole reaches the browser as its safe keys and a count of what was withheld", () => {
  const genuine = SUCCESSES.find((item) => item.route === "dates_activity_detail")!.body, body = copy(genuine);
  const decision = { decision_id: "dec_" + "1".repeat(32), action: "remove_content", severity: "high", created_at: 1790000000, actor_email: "moderator@example.test",
    subject_uid: 12500, before: { photo: { url: "https://cdn.example/private.jpg" } }, after: null, user_visible_reason: { en: "Removed", hu: "Eltávolítva" } };
  const audit = { audit_id: "aud_" + "2".repeat(32), action: "dates.activity.update", actor_email: "admin@example.test", actor_uid: 77, reason: "free text of an operator",
    before: { title: "A" }, after: { title: "B" }, created_at: 1790000000, session_metadata: { ip: "203.0.113.9" } };
  body.moderation_decisions = [decision]; body.audit_history = [audit];
  body.reports = [{ report_id: "rpt_" + "3".repeat(32), status: "new", severity: "medium", created_at: 1790000000, reporter_uid: 4242, note: "the reporter's words" }];
  body.notifications = [{ notification_id: "ntf_1", type: "dates.activity.canceled", uid: 4242, created_at: 1790000000 }];
  const sent = projectDatesAdminBody("dates_activity_detail", body) as any;
  assert.deepEqual(sent.moderation_decisions, [{ decision_id: decision.decision_id, action: "remove_content", severity: "high", created_at: 1790000000, withheld_fields: 5 }]);
  assert.deepEqual(sent.audit_history, [{ audit_id: audit.audit_id, action: "dates.activity.update", created_at: 1790000000, withheld_fields: 6 }]);
  assert.deepEqual(sent.reports, [{ report_id: body.reports[0].report_id, status: "new", severity: "medium", created_at: 1790000000, withheld_fields: 2 }]);
  assert.deepEqual(sent.notifications, [{ notification_id: "ntf_1", type: "dates.activity.canceled", created_at: 1790000000, withheld_fields: 1 }]);
  // No identity, no free text, no before / after left the server.
  assert.doesNotMatch(JSON.stringify(sent), /moderator@example\.test|admin@example\.test|12500|4242|private\.jpg|free text|reporter's words|203\.0\.113\.9/);
  // The history panel shows the same pairs as before and still says how much it does not show.
  assert.deepEqual(operationalRecordSummary(sent.moderation_decisions[0]), operationalRecordSummary(decision));
  assert.deepEqual(operationalRecordSummary(sent.audit_history[0]), operationalRecordSummary(audit));
  assert.deepEqual(operationalRecordSummary(sent.moderation_decisions[0]).shown.map((pair) => pair.key), ["action", "created_at", "decision_id", "severity"]);
  assert.equal(operationalRecordSummary(sent.moderation_decisions[0]).withheld, 5);
  // The safe keys are the page's own list; a nested value under a safe key is withheld too.
  const nested = copy(genuine); nested.audit_history = [{ audit_id: "aud_1", status: { leaked: "x" } }];
  assert.deepEqual((projectDatesAdminBody("dates_activity_detail", nested) as any).audit_history, [{ audit_id: "aud_1", withheld_fields: 1 }]);
  assert.ok(OPERATIONAL_RECORD_SAFE_KEYS.includes("decision_id") && !(OPERATIONAL_RECORD_SAFE_KEYS as readonly string[]).includes("actor_email"));
  // A member's activity: the members are named by their number, relationship and time - what the page lists.
  const member = copy(genuine); member.memberships = [{ uid: 12500, relationship: "joined", live_access: true, updated_at: 1790000000, display_name: "Anna", phone: "+3620" }];
  assert.deepEqual((projectDatesAdminBody("dates_activity_detail", member) as any).memberships, [{ uid: 12500, relationship: "joined", live_access: true, updated_at: 1790000000 }]);
});

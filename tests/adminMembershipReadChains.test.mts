import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminMembershipFailure } from "../lib/adminMembershipClientError.ts";
import { createAdminMembershipRecovery, createAdminWriteOutcomeNotice } from "../lib/adminMembershipRecovery.ts";
import { registerAdminReadRecovery } from "../lib/adminReadRecovery.ts";
import { ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE } from "../lib/requestGuard.ts";
import { runDatesIntakePublish } from "../lib/datesIntakeConsole.ts";
import { datesIntakeEditorDraft, projectDatesIntakeDetail } from "../lib/datesIntakeAdmin.ts";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { readDatesExternalMutationAccess } from "../lib/datesExternalMutations.ts";
import { readDatesExternalResolutionAccess, readDatesExternalResolution, prepareDatesExternalResolution } from "../lib/datesExternalModeration.ts";
import { DatesCaseReadFence, datesEvidenceRead } from "../lib/datesModerationRead.ts";
import { readUserContent, saveUserContent } from "../lib/userContent.ts";
import { DATES_EXTERNAL_MODERATION_ACTIONS } from "../lib/datesAdmin.ts";
import { confirmResearchRetryActor, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { membershipSubmitGrant } from "../lib/membershipFlows.ts";
import { membershipPinnedMutation, membershipUserDetail } from "../lib/membership.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";
import { membershipClock } from "./support/adminMembershipClock.mts";

// DERIVED real client + real read/command helpers and actual component handler
// AST bodies. Core/browser/hooks/valid command-send adapters are controlled.
// These are not mounted Next, real persistence or authenticated Core claims.
const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fixture = (path: string) => JSON.parse(file(`tests/fixtures/${path}.json`));
const tree = (path: string) => ts.createSourceFile(path, file(path), ts.ScriptTarget.Latest, true);
function functionSource(path: string, name: string) {
  const parsed = tree(path); let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; else ts.forEachChild(node, visit); };
  visit(parsed); assert.ok(found, name); return found.getText(parsed);
}
function compile(source: string, context: any) {
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const caps = ["dates_external_event_manage", "dates_external_event_read", "dates_external_event_review", "dates_case_resolve"];
const identity = (email = MEMBERSHIP_EMAIL) => ({ ...MEMBERSHIP_MEMBER, email,
  dates: { email, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: caps } });
const list = { ...MEMBERSHIP_MEMBER, events: [], page: 1, limit: 1, total: 0, server_now: 1790000000, capabilities: caps };
const externalId = "xev_" + "a".repeat(32), activityId = "act_" + "b".repeat(32);
const caseBody = fixture("dates_moderation_wire/admin-detail-report-viewer");
caseBody.case = { ...caseBody.case, queue: "activities", case_kind: "reports", target_type: "external_event", target_id: externalId, target_uid: 0,
  activity_id: activityId, revision: 2, status: "in_review", assignee_email: MEMBERSHIP_EMAIL, claim_expires_at: 1790001000, conflict_of_interest: false,
  external_revision: 7, external_status: "published", external_target_available: true, allowed_actions: [...DATES_EXTERNAL_MODERATION_ACTIONS],
  capabilities: { can_claim: false, can_read_evidence: true, can_resolve: true, can_break_glass: false } };
caseBody.server_now = 1790000000; caseBody.decisions = []; caseBody.appeal = null;
const resolutionBody = { case_id: caseBody.case.case_id, expected_revision: 2, expected_external_revision: 7, action: "remove_content", reason: "DERIVED reviewed source",
  user_visible_reason_en: "Removed", user_visible_reason_hu: "Eltávolítva", expires_at: null, break_glass: false, idempotency_key: "t899-original-resolution-0001" };
const baseline = { external_event_id: externalId, activity_id: activityId, activity_revision: 11 };
const grantContext: any = { exports: {}, ISO: "2026-08-15T12:00:00Z", LATER: "2026-09-15T12:00:00Z" };
compile(functionSource("tests/membershipFlows.test.mts", "grantWire") + "\n" + functionSource("tests/membershipFlows.test.mts", "detailWire")
  + "\nexports.detail=detailWire(grantWire('11111111-1111-4111-8111-111111111111',1));", grantContext);
const grantDetail = grantContext.exports.detail;
function client(failedRead: string | null, failure: "503" | "network" = "503") {
  const time = membershipClock(), requests: string[] = []; const state = { failedRead, actor: MEMBERSHIP_EMAIL, replies: {} as Record<string, any> };
  const parsed = tree("lib/adminClient.ts"), context: any = { exports: {}, JSON, File, FormData, AbortSignal, isAdminClientReadAction,
    ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, adminMembershipFailure, createAdminWriteOutcomeNotice,
    ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE, window: { location: { assign: () => assert.fail("an outage must not redirect") } },
    createAdminMembershipRecovery: (probe: any, redirect: any) => createAdminMembershipRecovery(probe, redirect, time.clock),
    fetch: async (url: string) => {
      const action = url.split("/").at(-1)!; requests.push(action);
      if (action === state.failedRead && failure === "network") throw new Error("DERIVED dropped connection");
      const data = action === state.failedRead ? { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED }
        : action === "admin_me" ? identity(state.actor) : state.replies[action] ?? (action === "dates_external_event_list" ? list : action === "dates_moderation_detail" ? caseBody
          : action === "membership_user_detail" ? { ...MEMBERSHIP_MEMBER, data: grantDetail }
            : { success: false, status_code: 502, error: "core-unavailable" });
      return new Response(JSON.stringify(data), { status: data.status_code });
    } };
  const api = compile(parsed.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(parsed)).join("\n"), context) as typeof import("../lib/adminClient.ts");
  return { api, time, state, requests, writes: () => requests.filter(action => !["admin_me", "dates_external_event_list", "dates_moderation_detail", "membership_user_detail"].includes(action)) };
}
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };
const noop = () => {};
const flows = [
  { name: "intake Publish", read: "dates_external_event_list", run: async (h: ReturnType<typeof client>) => {
    const detail = projectDatesIntakeDetail(fixture("dates_event_intake_admin_wire/admin-detail-in-review-official"), "xin_" + "0".repeat(31) + "4")!;
    const made = datesExternalDraftInput({ ...datesIntakeEditorDraft(detail.intake.events[0].editor_input!), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
    assert.ok(made.ok);
    return runDatesIntakePublish(h.api.adminCall, storage(), MEMBERSHIP_EMAIL, { candidate: { intake_id: detail.intake.intake_id, intake_revision: detail.intake.revision,
      event_index: 0, complete: false, event: made.event, reason: "DERIVED checked source" } });
  } },
  { name: "research Retry", read: "admin_me", run: async (h: ReturnType<typeof client>) => {
    const command = { actor: MEMBERSHIP_EMAIL, action: "dates_event_research_defaults_save", body: {} };
    const context: any = { exports: {}, busyRef: { current: false }, actorRef: { current: MEMBERSHIP_EMAIL }, outcome: { kind: "uncertain" },
      setBusy: noop, setPending: noop, setOutcome: noop, confirmResearchRetryActor, runResearchCommand, adminCall: h.api.adminCall, onSuccess: noop, onConflict: noop };
    compile(functionSource("components/DatesResearchControls.tsx", "execute") + "\nexports.run=execute;", context);
    return context.exports.run(command, true);
  } },
  { name: "membership grant Retry", read: "membership_user_detail", run: async (h: ReturnType<typeof client>) => {
    const pending = { pinned: membershipPinnedMutation(null, { uid: 321, preset_id: "plus_month", start_mode: "extend", custom_expires_at: null,
      reason: "DERIVED original grant", expected_revision: 1, expected_grant_id: grantDetail.admin_grant.grant_id }, () => "00000000-0000-4000-8000-000000000001"),
      baseline: { grant_id: grantDetail.admin_grant.grant_id, revision: 1 }, uncertain: true };
    return membershipSubmitGrant(h.api.adminCall, { actor: MEMBERSHIP_EMAIL, uid: 321, pending, detail: membershipUserDetail(grantDetail)!, preview: null,
      body: {}, mintRequestId: () => assert.fail("Retry must never mint another identity") });
  } },
  { name: "external-event command", read: "dates_external_event_list", run: async (h: ReturnType<typeof client>) => {
    const context: any = { exports: {}, busyRef: { current: false }, principal: { email: MEMBERSHIP_EMAIL }, lifetime: { current: 0 },
      setBusy: noop, setFeedback: noop, setCanManage: noop, setPending: noop, setCandidate: noop,
      readDatesExternalMutationAccess, adminCall: h.api.adminCall, datesExternalBrowserStorage: storage, readDatesExternalPending: () => ({ kind: "empty" }),
      runDatesExternalMutation: async (operation: any) => { await h.api.adminCall(operation.action, operation.body); return { kind: "uncertain" }; } };
    compile(functionSource("components/DatesExternalEditorPage.tsx", "execute") + "\nexports.run=execute;", context);
    return context.exports.run(null, { actor: MEMBERSHIP_EMAIL, action: "dates_external_event_update", body: { idempotency_key: "t899-retained-external-0001" } });
  } },
  { name: "external-event moderation resolution", read: "dates_moderation_detail", run: async (h: ReturnType<typeof client>) => {
    const pending = prepareDatesExternalResolution(MEMBERSHIP_EMAIL, resolutionBody, baseline, 1790000000)!; assert.ok(pending);
    const context: any = { exports: {}, mutationBusy: { current: false }, principal: { email: MEMBERSHIP_EMAIL }, lifetime: { current: 0 }, writeLocked: false,
      setBusy: noop, setEvidence: noop, setFeedback: noop, setConfirmed: noop, setExternalPending: noop, external: (key: string) => key,
      readFence: new DatesCaseReadFence(), readDatesExternalResolutionAccess, adminCall: h.api.adminCall, datesExternalBrowserStorage: storage, readDatesExternalResolution,
      runDatesExternalResolution: async (operation: any) => { await h.api.adminCall("dates_moderation_resolve", operation.body); return { kind: "uncertain" }; } };
    compile(functionSource("app/(dashboard)/dates/moderation/[caseId]/page.tsx", "executeExternalResolution") + "\nexports.run=executeExternalResolution;", context);
    return context.exports.run(null, pending);
  } },
];
for (const flow of flows) {
  test(`DERIVED read-before-write positive control: ${flow.name} can send exactly one explicit write when its reads succeed`, async () => {
    const h = client(null); await flow.run(h); assert.equal(h.writes().length, 1, "fixture/adapter actually reaches the writer; outage test cannot pass on invalid input");
  });
  for (const failure of ["503", "network"] as const) for (const actorAfter of [MEMBERSHIP_EMAIL, "other@example.test"]) test(`DERIVED ${flow.name}: ${failure} ends the handler; same/changed actor recovery sends ZERO writes (${actorAfter})`, async () => {
    const h = client(flow.read, failure); let settled = false;
    const pending = flow.run(h).then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, true, "the original handler is not suspended until recovery"); assert.equal(h.writes().length, 0);
    assert.equal(h.api.adminMembershipRecovery.getSnapshot(), true);
    h.state.failedRead = null; h.state.actor = actorAfter; await h.time.tick(); await pending;
    assert.equal(h.api.adminMembershipRecovery.getSnapshot(), false); assert.equal(h.writes().length, 0, "recovery cannot continue an old command chain");
    assert.equal(h.requests.at(-1), "admin_me", "only fresh membership probes ran after the stopped gesture");
  });
}
test("DERIVED membership Retry actor fence also blocks an explicit retry under a confirmed DIFFERENT account", async () => {
  const h = client(null); h.state.actor = "other@example.test"; await flows[2].run(h);
  assert.deepEqual(h.requests, ["admin_me"]); assert.equal(h.writes().length, 0);
});
const evidenceWire = fixture("dates_moderation_wire/admin-evidence-report-moderator");
const uiSites = [
  { name: "Reveal location", action: "dates_activity_location", path: "app/(dashboard)/dates/[activityId]/page.tsx", handler: "revealLocation",
    args: [{ preventDefault() {} }], reply: { ...MEMBERSHIP_MEMBER, private_location: { country_code: "DERIVED" } },
    context: (page: any, api: ReturnType<typeof client>["api"]) => ({ data: { activity: { host: {}, activity_id: "derived_activity" } }, busy: false,
      locationCaseId: "derived_case", locationReason: "Checked this location", locationBreakGlass: false, adminCall: api.adminCall,
      t: (key: string, values: unknown) => `${key}:${JSON.stringify(values)}`, setBusy: (value: boolean) => { page.busy = value; },
      setFeedback: (value: unknown) => { page.feedback = value; }, setPrivateLocation: () => { page.adopted = true; } }) },
  { name: "Read evidence", action: "dates_moderation_evidence", path: "app/(dashboard)/dates/moderation/[caseId]/page.tsx", handler: "readEvidence",
    args: [{ preventDefault() {} }], reply: evidenceWire,
    context: (page: any, api: ReturnType<typeof client>["api"]) => ({ data: { case: { conflict_of_interest: false, target_type: "activity" }, appeal: null },
      principal: { email: MEMBERSHIP_EMAIL }, busy: false, breakGlass: false, evidenceSensitive: false, evidenceReason: "", caseId: evidenceWire.case_id,
      datesExternalReviewAllowed: () => true, isDatesExternalMessageCase: () => false, readFence: { begin: () => 1, accepts: () => true },
      adminCall: api.adminCall, datesEvidenceRead, t: (key: string, values: unknown) => `${key}:${JSON.stringify(values)}`,
      setEvidence: (value: unknown) => { if (value !== null) page.adopted = true; }, setBusy: (value: boolean) => { page.busy = value; },
      setFeedback: (value: unknown) => { page.feedback = value; }, setResolutionReason: () => assert.fail("read failure must keep the resolution draft") }) },
  { name: "Save headline/about", action: "admin_save_user_content", path: "components/UserContentEditor.tsx", handler: "save", args: [],
    reply: { ...MEMBERSHIP_MEMBER, content: { headline: "Reviewed headline", about_me: "Reviewed about", revision: 4 } },
    context: (page: any, api: ReturnType<typeof client>["api"]) => ({ busy: false, conflict: undefined, revision: 3, uid: 5,
      headline: "Unsaved headline", about: "Unsaved about", saveUserContent, adminCall: api.adminCall,
      setBusy: (value: boolean) => { page.busy = value; }, setSaved: (value: boolean) => { page.saved = value; }, setError: (value: string) => { page.error = value; },
      setConflict: () => {}, setHeadline: () => { page.adopted = true; }, setAbout: () => { page.adopted = true; }, setRevision: () => {} }) },
];
for (const site of uiSites) {
  test(`DERIVED ${site.name}: healthy control reaches the actual handler's success branch`, async () => {
    const h = client(null), page: any = { busy: false }; h.state.replies[site.action] = site.reply;
    const context: any = { exports: {}, ...site.context(page, h.api) };
    const run = compile(functionSource(site.path, site.handler) + `\nexports.run=${site.handler};`, context).run;
    await run(...site.args); assert.equal(page.busy, false); assert.equal(page.adopted, true); assert.deepEqual(h.requests, [site.action]);
  });
  for (const failure of ["503", "network"] as const) test(`DERIVED ${site.name}: one ${failure} returns, clears busy and displays its ordinary failure without discarding edits`, async () => {
    const h = client(site.action, failure), page: any = { busy: false, resolutionReason: "Keep my typed resolution", feedback: null, error: "", adopted: false };
    const context: any = { exports: {}, ...site.context(page, h.api) };
    const run = compile(functionSource(site.path, site.handler) + `\nexports.run=${site.handler};`, context).run;
    await run(...site.args); assert.equal(page.busy, false); assert.ok(page.feedback || page.error); assert.equal(page.adopted, false);
    assert.equal(page.resolutionReason, "Keep my typed resolution");
    h.state.failedRead = null; await h.time.tick();
    assert.deepEqual(h.requests, [site.action, "admin_me"], "recovery sends no repeat, audited read or command");
    assert.equal(page.busy, false); assert.equal(page.resolutionReason, "Keep my typed resolution");
  });
}
test("DERIVED user-content adapter reads resolve their existing null failure instead of throwing", async () => {
  const h = client("user_detail", "network"); assert.equal(await readUserContent(h.api.adminCall, 5), null);
  h.state.failedRead = null; await h.time.tick(); assert.deepEqual(h.requests, ["user_detail", "admin_me"]);
});
test("DERIVED registered loader: recovery invokes only eligible never-loaded readers; unregister/new successful adoption prevents later runs", async () => {
  const time = membershipClock(), recovery = createAdminMembershipRecovery(async () => "confirmed", () => assert.fail(), time.clock);
  let eligible = true, loads = 0;
  const release = registerAdminReadRecovery(recovery, () => eligible, async () => { loads++; });
  recovery.markUnconfirmed(); await time.tick(); assert.equal(loads, 1);
  eligible = false; recovery.markUnconfirmed(); await time.tick(); assert.equal(loads, 1, "loaded drafts/data are left exactly alone");
  eligible = true; release(); recovery.markUnconfirmed(); await time.tick(); assert.equal(loads, 1, "unmounted/error-free pages are never refreshed implicitly");
});
test("DERIVED real client: a request-specific failure with healthy membership stops after the loader budget, with no audited read or write", async () => {
  const h = client("overview");
  const release = registerAdminReadRecovery(h.api.adminMembershipRecovery, () => true, async () => {
    assert.deepEqual(await h.api.adminCall("overview"), adminMembershipFailure());
  }, h.time.clock);
  assert.deepEqual(await h.api.adminCall("overview"), adminMembershipFailure());
  let ticks = 0;
  while (h.time.jobs.size > 0) { assert.ok(++ticks < 30, "specific-read recovery must finish"); await h.time.tick(); }
  assert.equal(h.requests.filter(action => action === "overview").length, 8, "one original request plus at most seven fresh loader attempts");
  assert.ok(h.requests.every(action => action === "overview" || action === "admin_me"));
  assert.equal(h.api.adminMembershipRecovery.getSnapshot(), false); release();
});
test("DERIVED source audit: conservative registrations are ONLY Overview and never-loaded Research; audit/evidence reads and command handlers are not registered", () => {
  for (const [path, expected] of [["app/(dashboard)/page.tsx", /useAdminReadRecovery\(load, data === null && state === "error"\)/],
    ["app/(dashboard)/dates/research/page.tsx", /useAdminReadRecovery\(reload, read === null && problem\?\.kind === "unconfirmed"\)/]] as const) assert.match(file(path), expected);
  assert.doesNotMatch(file("lib/adminClient.ts"), /waitUntilRecovered|for\s*\(\s*;;\s*\)|continue;/);
  assert.match(file("components/Shell.tsx"), /<AdminManualReload \/>/);
});
test("DERIVED stopped-call failure is a typed ordinary result, never an exception or suspended call", () => {
  assert.deepEqual(adminMembershipFailure(), { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED });
  assert.doesNotMatch(file("lib/adminClient.ts"), /throw\s|Promise\.reject/);
});
test("DERIVED manual reload presentation: no automatic refresh; a second in-page operator confirmation is required and Cancel keeps state", () => {
  let confirmed = false, reloads = 0, epoch = 0;
  const parsed = tree("components/AdminManualReload.tsx"), context: any = { exports: {},
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
    useState: () => [confirmed, (value: boolean) => { confirmed = value; }], useSyncExternalStore: () => epoch,
    useTranslations: () => (key: string) => key, adminMembershipRecovery: {}, window: { location: { reload: () => { reloads++; } } } };
  vm.runInNewContext(ts.transpileModule(parsed.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(parsed)).join("\n"),
    { fileName: "manual.tsx", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.children)] : [];
  const render = () => nodes(context.exports.default());
  const button = (key: string) => render().find(node => node.type === "button" && node.children.includes(key));
  assert.equal(context.exports.default(), null); epoch = 1;
  button("reload").props.onClick(); assert.equal(reloads, 0); assert.ok(render().some(node => node.children?.includes("reloadWarning")));
  button("keepPage").props.onClick(); assert.equal(confirmed, false); assert.equal(reloads, 0);
  button("reload").props.onClick(); button("reloadConfirm").props.onClick(); assert.equal(reloads, 1);
});

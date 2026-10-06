import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminMembershipFailure, adminRequestOutcomeUnknownFailure } from "../lib/adminMembershipClientError.ts";
import { adminMembershipFailureText } from "../lib/adminMembershipFailureText.ts";
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
    ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, adminMembershipFailure, adminRequestOutcomeUnknownFailure, createAdminWriteOutcomeNotice,
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
      t: (key: string, values: unknown) => `${key}:${JSON.stringify(values)}`, adminMembershipFailureText,
      membership: (key: string) => JSON.parse(file("messages/en.json")).adminMembership[key], setBusy: (value: boolean) => { page.busy = value; },
      setFeedback: (value: unknown) => { page.feedback = value; }, setPrivateLocation: () => { page.adopted = true; } }) },
  { name: "Read evidence", action: "dates_moderation_evidence", path: "app/(dashboard)/dates/moderation/[caseId]/page.tsx", handler: "readEvidence",
    args: [{ preventDefault() {} }], reply: evidenceWire,
    context: (page: any, api: ReturnType<typeof client>["api"]) => ({ data: { case: { conflict_of_interest: false, target_type: "activity" }, appeal: null },
      principal: { email: MEMBERSHIP_EMAIL }, busy: false, breakGlass: false, evidenceSensitive: false, evidenceReason: "", caseId: evidenceWire.case_id,
      datesExternalReviewAllowed: () => true, isDatesExternalMessageCase: () => false, readFence: { begin: () => 1, accepts: () => true },
      adminCall: api.adminCall, datesEvidenceRead, t: (key: string, values: unknown) => `${key}:${JSON.stringify(values)}`, adminMembershipFailureText,
      membership: (key: string) => JSON.parse(file("messages/en.json")).adminMembership[key],
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
    if (site.action === "admin_save_user_content" && failure === "network") assert.equal(page.error, "contentOutcomeUnknown");
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
for (const locale of ["en", "hu"]) for (const site of uiSites.slice(0, 2)) test(`DERIVED ${locale} ${site.name}: a dropped READ shows the operator sentence, keeps edits, and never repeats`, async () => {
  const h = client(site.action, "network"), page: any = { busy: false, adopted: false, resolutionReason: "Keep my typed reason" };
  const messages = JSON.parse(file(`messages/${locale}.json`));
  const context: any = { exports: {}, ...site.context(page, h.api), membership: (key: string) => messages.adminMembership[key] };
  await compile(functionSource(site.path, site.handler) + `\nexports.run=${site.handler};`, context).run(...site.args);
  assert.equal(page.feedback.text, messages.adminMembership.requestUnconfirmed);
  assert.ok(!page.feedback.text.includes(ADMIN_MEMBERSHIP_UNCONFIRMED)); assert.equal(page.busy, false); assert.equal(page.adopted, false);
  assert.equal(page.resolutionReason, "Keep my typed reason"); h.state.failedRead = null; await h.time.tick();
  assert.deepEqual(h.requests, [site.action, "admin_me"]); assert.equal(page.resolutionReason, "Keep my typed reason");
});
for (const locale of ["en", "hu"]) test(`DERIVED ${locale} profile-text lost answer: the actual handler chooses unknown-outcome copy, not a no-write/save-failed claim`, async () => {
  const site = uiSites[2], h = client(site.action, "network"), page: any = { busy: false };
  const context: any = { exports: {}, ...site.context(page, h.api) };
  await compile(functionSource(site.path, site.handler) + `\nexports.run=${site.handler};`, context).run();
  assert.equal(page.error, "contentOutcomeUnknown"); assert.equal(page.busy, false);
  const messages = JSON.parse(file(`messages/${locale}.json`));
  assert.ok(messages.moderation[page.error]); assert.notEqual(messages.moderation[page.error], messages.moderation.contentSaveFailed);
  h.state.failedRead = null; await h.time.tick(); assert.deepEqual(h.requests, [site.action, "admin_me"]);
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
type Source = { path: string; code: string };
function recoverySourceInventory(): Source[] {
  return ["app", "components", "lib"].flatMap(folder => readdirSync(new URL(`../${folder}/`, import.meta.url), { recursive: true })
    .filter(path => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)).map(path => ({ path: `${folder}/${path}`, code: file(`${folder}/${path}`) })));
}
function assertRecoveryTopology(sources: Source[]) {
  const targets = ["useAdminReadRecovery", "registerAdminReadRecovery", "subscribeRecovered"];
  const recoveryModules = ["components/useAdminReadRecovery", "lib/adminReadRecovery"];
  const stateMethods = new Set(["subscribe", "getSnapshot", "getServerSnapshot", "getRecoveryEpoch", "getServerRecoveryEpoch"]);
  const calls: string[] = [], imports: string[] = [], reexports: string[] = [], observers: string[] = [], stateEffects: string[] = [];
  for (const source of sources) {
    const parsed = ts.createSourceFile(source.path, source.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const modulePath = (module: string) => (module.startsWith("@/") ? module.slice(2)
      : module.startsWith(".") ? posix.join(posix.dirname(source.path), module) : module).replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, "").replace(/\/index$/, "");
    const aliases = new Map(targets.map(name => [name, name]));
    const membershipAliases = new Map([["adminMembershipRecovery", "root"], ["useAdminMembershipUnconfirmed", "hook"]]);
    const effectAliases = new Map([["useEffect", "useEffect"], ["useLayoutEffect", "useLayoutEffect"]]);
    const reference = (node: ts.Expression): string | undefined => ts.isIdentifier(node) ? aliases.get(node.text)
      : ts.isPropertyAccessExpression(node) ? aliases.get(node.name.text)
        : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? aliases.get(node.argumentExpression.text) : undefined;
    const membershipReference = (node: ts.Expression): string | undefined => {
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return membershipReference(node.expression);
      if (ts.isIdentifier(node)) return membershipAliases.get(node.text);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (name === "adminMembershipRecovery") return "root";
      if (name === "useAdminMembershipUnconfirmed") return "hook";
      return name && stateMethods.has(name) && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && membershipReference(node.expression) === "root" ? `state:${name}` : undefined;
    };
    for (const statement of parsed.statements) if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      const module = (statement.moduleSpecifier as ts.StringLiteral).text;
      if (recoveryModules.includes(modulePath(module))) imports.push(`${source.path}:@/${modulePath(module)}`);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        if (binding.isTypeOnly) continue;
        const original = binding.propertyName?.text ?? binding.name.text;
        if (targets.includes(original)) aliases.set(binding.name.text, original);
        if (membershipAliases.has(original)) membershipAliases.set(binding.name.text, membershipAliases.get(original)!);
        if (effectAliases.has(original)) effectAliases.set(binding.name.text, effectAliases.get(original)!);
      }
    }
    // Also follow local aliases of the hook/factory/direct subscriber.
    let changed = true;
    while (changed) {
      changed = false;
      const alias = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          const target = reference(node.initializer);
          if (target && !aliases.has(node.name.text)) { aliases.set(node.name.text, target); changed = true; }
          const member = membershipReference(node.initializer);
          if (member && !membershipAliases.has(node.name.text)) { membershipAliases.set(node.name.text, member); changed = true; }
        }
        ts.forEachChild(node, alias);
      };
      alias(parsed);
    }
    // Follow values derived from the membership hook/store, including an
    // already-approved Shell variable reused by a new recovery effect.
    const stateValues = new Set<string>();
    const containsState = (start: ts.Node): boolean => {
      let found = false;
      const inspect = (node: ts.Node) => {
        const member = ts.isCallExpression(node) ? membershipReference(node.expression)
          : ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? membershipReference(node) : undefined;
        if (member === "hook" || member?.startsWith("state:") || ts.isIdentifier(node) && stateValues.has(node.text)) found = true;
        if (!found) ts.forEachChild(node, inspect);
      };
      inspect(start); return found;
    };
    changed = true;
    while (changed) {
      changed = false;
      const value = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !stateValues.has(node.name.text) && containsState(node.initializer)) {
          stateValues.add(node.name.text); changed = true;
        }
        ts.forEachChild(node, value);
      };
      value(parsed);
    }
    const visit = (node: ts.Node) => {
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
        const module = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? modulePath(node.moduleSpecifier.text) : undefined;
        const names = node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.filter(item => !item.isTypeOnly).map(item => item.propertyName?.text ?? item.name.text) : undefined;
        const exportsRecovery = module && recoveryModules.includes(module)
          || module && ["components/AdminMembershipNotice", "lib/adminClient"].includes(module)
            && (!names || names.some(name => membershipAliases.has(name)))
          || !module && names?.some(name => aliases.has(name) || membershipAliases.has(name));
        if (exportsRecovery) reexports.push(`${source.path}:${module ?? "local alias"}`);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const member = membershipReference(node);
        if (member?.startsWith("state:")) observers.push(`${source.path}:${member.slice(6)}`);
      }
      if (ts.isCallExpression(node)) {
        const target = reference(node.expression); if (target) calls.push(`${source.path}:${target}`);
        const member = membershipReference(node.expression);
        if (member === "hook") observers.push(`${source.path}:useAdminMembershipUnconfirmed`);
        else if (ts.isIdentifier(node.expression) && member?.startsWith("state:")) observers.push(`${source.path}:${member.slice(6)}`);
        const effectName = ts.isIdentifier(node.expression) ? effectAliases.get(node.expression.text)
          : ts.isPropertyAccessExpression(node.expression) ? effectAliases.get(node.expression.name.text) : undefined;
        if (effectName && node.arguments.some(argument => containsState(argument))) stateEffects.push(`${source.path}:${effectName}`);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
          && recoveryModules.includes(modulePath(node.arguments[0].text))) imports.push(`${source.path}:@/${modulePath(node.arguments[0].text)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  assert.deepEqual(calls.sort(), ["app/(dashboard)/page.tsx:useAdminReadRecovery", "app/(dashboard)/dates/research/page.tsx:useAdminReadRecovery",
    "components/useAdminReadRecovery.ts:registerAdminReadRecovery", "lib/adminReadRecovery.ts:subscribeRecovered"].sort(), "no third loader, alternate factory or direct recovery subscriber");
  assert.deepEqual(imports.sort(), ["app/(dashboard)/page.tsx:@/components/useAdminReadRecovery", "app/(dashboard)/dates/research/page.tsx:@/components/useAdminReadRecovery",
    "components/useAdminReadRecovery.ts:@/lib/adminReadRecovery"].sort(), "no unreviewed recovery importer");
  assert.deepEqual(reexports, [], "no unreviewed recovery re-export or barrel");
  assert.deepEqual(observers.sort(), [
    ...Array<string>(7).fill("lib/adminClient.ts:getSnapshot"),
    "components/AdminMembershipNotice.tsx:subscribe", "components/AdminMembershipNotice.tsx:getSnapshot", "components/AdminMembershipNotice.tsx:getServerSnapshot",
    "components/AdminManualReload.tsx:subscribe", "components/AdminManualReload.tsx:getRecoveryEpoch", "components/AdminManualReload.tsx:getServerRecoveryEpoch",
    "components/AdminMembershipUnavailable.tsx:subscribe", "components/AdminMembershipUnavailable.tsx:getSnapshot",
    "components/Shell.tsx:useAdminMembershipUnconfirmed",
  ].sort(), "no unreviewed membership state observer outside gating/notices/manual/initial-neutral presentation");
  assert.deepEqual(stateEffects.sort(), ["components/AdminMembershipUnavailable.tsx:useEffect"],
    "no unreviewed membership-driven effect; only the existing initial-neutral refresh is exempt");
}
test("DERIVED source audit: ONLY Overview and never-loaded Research register; the entire production source inventory rejects any extra recovery path", () => {
  assertRecoveryTopology(recoverySourceInventory());
  for (const [path, expected] of [["app/(dashboard)/page.tsx", /useAdminReadRecovery\(load, data === null && state === "error"\)/],
    ["app/(dashboard)/dates/research/page.tsx", /useAdminReadRecovery\(reload, read === null && problem\?\.kind === "unconfirmed"\)/]] as const) assert.match(file(path), expected);
  assert.doesNotMatch(file("lib/adminClient.ts"), /waitUntilRecovered|for\s*\(\s*;;\s*\)|continue;/);
  assert.match(file("components/Shell.tsx"), /<AdminManualReload \/>/);
});
test("DERIVED recovery inventory negative controls: third loader, alias, direct subscriber and duplicate in an approved file all fail", () => {
  const sources = recoverySourceInventory();
  for (const code of ['useAdminReadRecovery(save, true);', 'import { useAdminReadRecovery as restart } from "@/components/useAdminReadRecovery"; restart(save, true);',
    'adminMembershipRecovery.subscribeRecovered(save);', 'const resume = adminMembershipRecovery.subscribeRecovered; resume(save);',
    'import * as recovery from "@/lib/adminReadRecovery"; recovery.registerAdminReadRecovery(adminMembershipRecovery, () => true, save);']) {
    assert.throws(() => assertRecoveryTopology([...sources, { path: "components/DERIVED_unapproved.tsx", code }]), /no third loader/);
  }
  assert.throws(() => assertRecoveryTopology(sources.map(source => source.path === "app/(dashboard)/page.tsx"
    ? { ...source, code: source.code + "\nuseAdminReadRecovery(save, true);" } : source)), /no third loader/);
});
test("DERIVED recovery inventory rejects barrel/local re-exports, including renamed and relative multi-hop forms", () => {
  const sources = recoverySourceInventory();
  assert.doesNotThrow(() => assertRecoveryTopology([...sources,
    { path: "components/DERIVED_ordinary.ts", code: 'export { formatDate } from "../lib/format"; useEffect(() => { load(); }, []);' },
  ]), "ordinary domain re-exports/initial effects are not recovery paths");
  for (const code of [
    'export { useAdminReadRecovery as restart } from "@/components/useAdminReadRecovery";',
    'export * from "./useAdminReadRecovery";',
    'export { useAdminReadRecovery as restart } from "./useAdminReadRecovery.js";',
    'export { registerAdminReadRecovery as restart } from "../lib/adminReadRecovery";',
    'import { useAdminReadRecovery as local } from "@/components/useAdminReadRecovery"; export { local as restart };',
    'export { useAdminMembershipUnconfirmed as healthy } from "@/components/AdminMembershipNotice";',
    'export { adminMembershipRecovery as member } from "../lib/adminClient";',
  ]) assert.throws(() => assertRecoveryTopology([...sources, { path: "components/DERIVED_barrel.ts", code }]), /no unreviewed recovery/);
  assert.throws(() => assertRecoveryTopology([...sources,
    { path: "components/DERIVED_first.ts", code: 'export { useAdminReadRecovery as first } from "./useAdminReadRecovery";' },
    { path: "components/DERIVED_second.ts", code: 'export { first as second } from "./DERIVED_first";' },
  ]), /no unreviewed recovery/);
  assert.throws(() => assertRecoveryTopology([...sources,
    { path: "components/DERIVED_barrel.js", code: 'export { registerAdminReadRecovery as restart } from "../lib/adminReadRecovery.js";' },
  ]), /no unreviewed recovery/);
});
test("DERIVED recovery inventory rejects ordinary membership-state effects, even reusing the approved Shell's existing state", () => {
  const sources = recoverySourceInventory();
  for (const code of [
    'adminMembershipRecovery.subscribe(() => { if (!adminMembershipRecovery.getSnapshot()) load(); });',
    'const epoch = useSyncExternalStore(adminMembershipRecovery.subscribe, adminMembershipRecovery.getRecoveryEpoch); useEffect(() => { if (epoch) load(); }, [epoch]);',
    'import { useAdminMembershipUnconfirmed as observe } from "@/components/AdminMembershipNotice"; const waiting = observe(); useEffect(() => { if (!waiting) load(); }, [waiting]);',
  ]) assert.throws(() => assertRecoveryTopology([...sources, { path: "components/DERIVED_effect.tsx", code }]), /no unreviewed membership/);
  const updated = sources.map(source => source.path === "components/Shell.tsx" ? { ...source, code: source.code.replace(
    'const membershipUnconfirmed = useAdminMembershipUnconfirmed();',
    'const membershipUnconfirmed = useAdminMembershipUnconfirmed(); useEffect(() => { if (!membershipUnconfirmed) window.location.reload(); }, [membershipUnconfirmed]);') } : source);
  assert.notEqual(updated.find(source => source.path === "components/Shell.tsx")!.code, sources.find(source => source.path === "components/Shell.tsx")!.code);
  assert.throws(() => assertRecoveryTopology(updated), /no unreviewed membership-driven effect/);
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

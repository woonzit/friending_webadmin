import { createAdminIdempotencyKey, datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { datesIntakeRefusal } from "@/lib/datesIntakeAdmin";
import { decodeResearchArea, decodeResearchBatchReceipt, decodeResearchBatchRows, decodeResearchDefaults, decodeResearchOverview, decodeResearchRunDetail, decodeResearchRunList,
  decodeResearchSource, researchInteger, researchRecord, researchSuccess, researchString, type DatesResearchAction, type ResearchBatchResult,
  type ResearchOverview, type ResearchRows, type ResearchRunDetail, type ResearchRunList } from "@/lib/datesResearchAdmin";
import { DATES_RESEARCH_READ_CAPABILITY, DATES_RESEARCH_WRITE_CAPABILITY, normalizeDatesResearchProxyBody, researchSourceCanonicalUrl } from "@/lib/datesResearchProxy";

export type ResearchSend = (action: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export type ResearchRead<T> = { kind: "ready"; value: T; operator: DatesAdminPrincipal; manage: boolean }
  | { kind: "unavailable" | "denied" | "unconfirmed" } | { kind: "refused"; error: string };
export async function readResearchOverview(send: ResearchSend, signal?: AbortSignal): Promise<ResearchRead<ResearchOverview>> {
  const replies = await Promise.allSettled([send("dates_event_research_overview", {}, signal), send("admin_me", {}, signal)]);
  const response = replies[0].status === "fulfilled" ? replies[0].value : null;
  const identity = replies[1].status === "fulfilled" ? replies[1].value : null;
  const operator = datesAdminPrincipal(identity), refusal = datesIntakeRefusal(response);
  if (operator && !hasDatesCapability(operator, DATES_RESEARCH_READ_CAPABILITY) || refusal.kind !== "unreadable" && refusal.status === 403 && refusal.error === "dates-admin-capability-required") return { kind: "denied" };
  if (refusal.kind !== "unreadable" && (refusal.status === 404 || refusal.status === 426)) return { kind: "unavailable" };
  const value = decodeResearchOverview(response);
  if (value && operator) return { kind: "ready", value, operator, manage: hasDatesCapability(operator, DATES_RESEARCH_WRITE_CAPABILITY) };
  return refusal.kind === "core" ? { kind: "refused", error: refusal.error } : { kind: "unconfirmed" };
}
export async function readResearchRuns(send: ResearchSend, filters: Record<string, unknown>, signal?: AbortSignal): Promise<ResearchRunList | null> {
  try { return decodeResearchRunList(await send("dates_event_research_run_list", filters, signal)); } catch { return null; }
}
export async function readResearchRun(send: ResearchSend, runId: string, signal?: AbortSignal): Promise<ResearchRunDetail | null> {
  try { return decodeResearchRunDetail(await send("dates_event_research_run_detail", { run_id: runId }, signal), runId); } catch { return null; }
}
export type ResearchCommand = { actor: string; action: DatesResearchAction; body: Record<string, unknown> };
export type ResearchRetryIssue = "actor_changed" | "unconfirmed" | "not_authorized";
/** Fresh session-bound membership read immediately before retry, never a browser-owned actor selector. */
export async function confirmResearchRetryActor(send: ResearchSend, command: ResearchCommand): Promise<ResearchRetryIssue | null> {
  try {
    const principal = datesAdminPrincipal(await send("admin_me", {}));
    if (!principal) return "unconfirmed";
    if (principal.email !== command.actor) return "actor_changed";
    return hasDatesCapability(principal, DATES_RESEARCH_WRITE_CAPABILITY) ? null : "not_authorized";
  } catch { return "unconfirmed"; }
}
export type ResearchCommandOutcome = { kind: "success"; replayed: boolean; receipt: unknown; runId?: string; results?: ResearchBatchResult[] }
  | { kind: "conflict"; error: string; cause?: "revision" | "source_open_run" | "source_archived" | "url_owned" | "archived_url_owned" | "city_registered" } | { kind: "refused"; error: string }
  | { kind: "uncertain"; error: string | null; partial?: ResearchRows<ResearchBatchResult>; retryBlocked?: ResearchRetryIssue; retryNoWrite?: true; discarded?: true };
/** Prepared once. The entire immutable request is kept while its outcome is not known. */
export function prepareResearchCommand(actor: string, action: DatesResearchAction, body: Record<string, unknown>): ResearchCommand | null {
  const request = { ...body, idempotency_key: createAdminIdempotencyKey("dates-research") };
  if (!actor || normalizeDatesResearchProxyBody(action, request) === null) return null;
  return { actor, action, body: JSON.parse(JSON.stringify(request)) as Record<string, unknown> };
}
export function decodeResearchCommandReceipt(command: ResearchCommand, response: unknown): ResearchCommandOutcome | null {
  if (!researchSuccess(response) || typeof response.replayed !== "boolean") return null;
  const { body, action } = command;
  // Batch children own their audits; Core returns no parent audit_id.
  if (action === "dates_event_intake_batch_decide") {
    const results = decodeResearchBatchReceipt(response, body.intake_ids as string[]);
    return results ? { kind: "success", replayed: response.replayed, receipt: response, results } : null;
  }
  const audited = researchString(response.audit_id) && response.audit_id !== "";
  // Reusing an open scheduled run changes no configuration and has no
  // original administrator audit. Only an explicit replay may carry null.
  const scheduledReplay = ["dates_event_research_source_run_now", "dates_event_research_area_run_now"].includes(action) && response.replayed === true && response.audit_id === null;
  if (!audited && !scheduledReplay) return null;
  if (action === "dates_event_research_defaults_save" || action === "dates_event_research_discovery_resume") {
    const row = decodeResearchDefaults(response.defaults);
    return row && row.revision === Number(body.expected_revision) + 1 ? { kind: "success", replayed: response.replayed, receipt: row } : null;
  }
  if (action === "dates_event_research_area_save") {
    const row = decodeResearchArea(response.area);
    const bound = row && (body.area_id ? row.area_id === body.area_id && row.revision === Number(body.expected_revision) + 1 : row.place_id === body.place_id);
    return bound ? { kind: "success", replayed: response.replayed, receipt: row } : null;
  }
  if (action === "dates_event_research_source_save") {
    const row = decodeResearchSource(response.source);
    const bound = row && row.url === researchSourceCanonicalUrl(body.url)
      && (body.source_id ? row.source_id === body.source_id && row.revision === Number(body.expected_revision) + 1 : row.revision === 1);
    return bound ? { kind: "success", replayed: response.replayed, receipt: row } : null;
  }
  if (action === "dates_event_research_source_run_now") {
    const next = Number(body.expected_revision) + 1;
    // A same-mode open run is reused before Core compares the submitted
    // revision. Only a genuinely new intent must advance expected by one.
    const boundRevision = response.replayed === true ? Number(response.source_revision) >= Number(body.expected_revision) : response.source_revision === next;
    return researchString(response.run_id) && response.run_id !== "" && response.source_id === body.source_id && response.dry_run === body.dry_run
      && researchInteger(response.source_revision, 2) && boundRevision
      ? { kind: "success", replayed: response.replayed, receipt: response, runId: response.run_id } : null;
  }
  if (action === "dates_event_research_area_run_now") {
    const next = Number(body.expected_revision) + 1;
    const boundRevision = response.replayed === true ? Number(response.area_revision) >= Number(body.expected_revision) : response.area_revision === next;
    return researchString(response.run_id) && response.run_id !== "" && response.area_id === body.area_id && response.dry_run === body.dry_run
      && researchInteger(response.area_revision, 2) && boundRevision ? { kind: "success", replayed: response.replayed, receipt: response, runId: response.run_id } : null;
  }
  return null;
}
// Only Core's no-write refusals settle an identity. Capability, transport, in-progress and unknown responses never do.
const NO_WRITE: Readonly<Record<string, number>> = {
  "dates-research-request-invalid": 400, "dates-research-values-invalid": 422, "dates-research-url-invalid": 422,
  "dates-research-aggregator-autopublish-invalid": 422, "dates-admin-reason-required": 422, "dates-admin-idempotency-invalid": 422,
  "dates-research-disabled": 409, "dates-research-source-disabled": 409,
  "dates-research-batch-invalid": 422, "dates-external-confirmation-required": 422,
  "dates-research-place-unavailable": 503, "dates-research-place-invalid": 422, "dates-research-scope-invalid": 422,
  "dates-research-id-invalid": 422, "dates-research-revision-invalid": 422, "dates-research-mode-invalid": 422,
  "dates-research-source-type-invalid": 422, "dates-research-not-found": 404, "dates-intake-reason-invalid": 422,
}; // Pinned HTTP witnesses and audited Core validation/rollback paths. Child refusals are batch receipts, not entries here.
function researchConflictCause(command: ResearchCommand, current: unknown): Extract<ResearchCommandOutcome, { kind: "conflict" }>["cause"] {
  const { action, body } = command;
  if (action === "dates_event_research_source_save" || action === "dates_event_research_source_run_now") {
    const row = decodeResearchSource(current);
    if (!row) return undefined;
    if (action === "dates_event_research_source_save" && row.url === researchSourceCanonicalUrl(body.url)
      && row.source_id !== body.source_id) return row.archived ? "archived_url_owned" : "url_owned";
    if (row.source_id !== body.source_id) return undefined;
    if (row.revision !== body.expected_revision) return "revision";
    if (row.archived) return "source_archived";
    if (row.last_check && ["queued", "running"].includes(row.last_check.status)) return "source_open_run";
    return undefined;
  }
  if (action === "dates_event_research_area_save") {
    const row = decodeResearchArea(current);
    if (!row) return undefined;
    if (!body.area_id && row.place_id === body.place_id) return "city_registered";
    return row.area_id === body.area_id && row.revision !== body.expected_revision ? "revision" : undefined;
  }
  const row = action === "dates_event_research_defaults_save" ? decodeResearchDefaults(current) : null;
  return row && row.revision !== body.expected_revision ? "revision" : undefined;
}
export async function runResearchCommand(send: ResearchSend, command: ResearchCommand): Promise<ResearchCommandOutcome> {
  let response: unknown;
  try { response = await send(command.action, command.body); } catch { return { kind: "uncertain", error: null }; }
  const receipt = decodeResearchCommandReceipt(command, response);
  if (receipt) return receipt;
  if (command.action === "dates_event_intake_batch_decide" && researchSuccess(response) && typeof response.replayed === "boolean") {
    const partial = decodeResearchBatchRows(response, command.body.intake_ids as string[]);
    if (partial) return { kind: "uncertain", error: null, partial };
  }
  const refusal = datesIntakeRefusal(response);
  if (refusal.kind === "core") {
    if (refusal.status === 409 && refusal.error === "dates-research-conflict") {
      const cause = researchConflictCause(command, researchRecord(response) ? response.current : null);
      return { kind: "conflict", error: refusal.error, ...(cause ? { cause } : {}) };
    }
    if (Object.hasOwn(NO_WRITE, refusal.error) && NO_WRITE[refusal.error] === refusal.status) return { kind: "refused", error: refusal.error };
  }
  return { kind: "uncertain", error: refusal.kind === "unreadable" ? null : refusal.error };
}

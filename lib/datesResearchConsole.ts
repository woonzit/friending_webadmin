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
export type ResearchCommandOutcome = { kind: "success"; receipt: unknown; runId?: string; results?: ResearchBatchResult[] }
  | { kind: "conflict"; error: string } | { kind: "refused"; error: string }
  | { kind: "uncertain"; error: string | null; partial?: ResearchRows<ResearchBatchResult> };
/** Prepared once. The entire immutable request is kept while its outcome is not known. */
export function prepareResearchCommand(actor: string, action: DatesResearchAction, body: Record<string, unknown>): ResearchCommand | null {
  const request = { ...body, idempotency_key: createAdminIdempotencyKey("dates-research") };
  if (!actor || normalizeDatesResearchProxyBody(action, request) === null) return null;
  return { actor, action, body: JSON.parse(JSON.stringify(request)) as Record<string, unknown> };
}
export function decodeResearchCommandReceipt(command: ResearchCommand, response: unknown): ResearchCommandOutcome | null {
  if (!researchSuccess(response) || typeof response.replayed !== "boolean" || !researchString(response.audit_id) || response.audit_id === "") return null;
  const { body, action } = command;
  if (action === "dates_event_research_defaults_save") {
    const row = decodeResearchDefaults(response.defaults);
    return row && row.revision === Number(body.expected_revision) + 1 ? { kind: "success", receipt: row } : null;
  }
  if (action === "dates_event_research_area_save") {
    const row = decodeResearchArea(response.area);
    const bound = row && (body.area_id ? row.area_id === body.area_id && row.revision === Number(body.expected_revision) + 1 : row.place_id === body.place_id);
    return bound ? { kind: "success", receipt: row } : null;
  }
  if (action === "dates_event_research_source_save") {
    const row = decodeResearchSource(response.source);
    const bound = row && row.url === researchSourceCanonicalUrl(body.url)
      && (body.source_id ? row.source_id === body.source_id && row.revision === Number(body.expected_revision) + 1 : row.revision === 1);
    return bound ? { kind: "success", receipt: row } : null;
  }
  if (action === "dates_event_research_source_run_now") {
    return researchString(response.run_id) && response.run_id !== "" && response.source_id === body.source_id && response.dry_run === body.dry_run
      && researchInteger(response.source_revision, 1) && response.source_revision === Number(body.expected_revision) + 1
      ? { kind: "success", receipt: response, runId: response.run_id } : null;
  }
  if (action === "dates_event_intake_batch_decide") {
    const results = decodeResearchBatchReceipt(response, body.intake_ids as string[], body.action as "publish" | "reject");
    return results ? { kind: "success", receipt: response, results } : null;
  }
  return null;
}
// Only Core's no-write refusals settle an identity. Capability, transport, in-progress and unknown responses never do.
const NO_WRITE: Readonly<Record<string, number>> = {
  "dates-research-request-invalid": 400, "dates-research-values-invalid": 422, "dates-research-url-invalid": 422,
  "dates-research-aggregator-autopublish-invalid": 422, "dates-admin-reason-required": 422, "dates-admin-idempotency-invalid": 422,
}; // Part A's genuine no-write captures; Part B extends this only with verified no-write refusals.
export async function runResearchCommand(send: ResearchSend, command: ResearchCommand): Promise<ResearchCommandOutcome> {
  let response: unknown;
  try { response = await send(command.action, command.body); } catch { return { kind: "uncertain", error: null }; }
  const receipt = decodeResearchCommandReceipt(command, response);
  if (receipt) return receipt;
  if (command.action === "dates_event_intake_batch_decide" && researchSuccess(response) && typeof response.replayed === "boolean"
    && researchString(response.audit_id) && response.audit_id !== "") {
    const partial = decodeResearchBatchRows(response, command.body.intake_ids as string[], command.body.action as "publish" | "reject");
    if (partial) return { kind: "uncertain", error: null, partial };
  }
  const refusal = datesIntakeRefusal(response);
  if (refusal.kind === "core" && refusal.status < 500) {
    if (refusal.status === 409 && refusal.error === "dates-research-conflict") return { kind: "conflict", error: refusal.error };
    if (Object.hasOwn(NO_WRITE, refusal.error) && NO_WRITE[refusal.error] === refusal.status) return { kind: "refused", error: refusal.error };
  }
  return { kind: "uncertain", error: refusal.kind === "unreadable" ? null : refusal.error };
}

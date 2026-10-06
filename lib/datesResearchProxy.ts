import { datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import { datesIntakeId, DATES_INTAKE_REJECT_REASONS } from "@/lib/datesIntakeAdmin";
import { DATES_RESEARCH_ACTIONS, DATES_RESEARCH_MODES, DATES_RESEARCH_SOURCE_TYPES, DATES_RESEARCH_RUN_KINDS,
  DATES_RESEARCH_VALUE_FIELDS, decodeResearchOverrides, decodeResearchValues, researchId, researchInteger, researchOneOf,
  DATES_RESEARCH_DOMAIN_TYPES, decodeResearchModels, researchRecord, researchString, type DatesResearchAction } from "@/lib/datesResearchAdmin";

export const DATES_RESEARCH_READ_CAPABILITY = "dates_external_event_review";
export const DATES_RESEARCH_WRITE_CAPABILITY = "dates_external_event_manage";
const READS: readonly string[] = ["dates_event_research_overview", "dates_event_research_run_list", "dates_event_research_run_detail"];
export function datesResearchProxyCapabilityAuthorized(action: string, membership: unknown): boolean | undefined {
  if (!(DATES_RESEARCH_ACTIONS as readonly string[]).includes(action)) return undefined;
  const principal = datesAdminPrincipal(membership);
  return principal !== null && hasDatesCapability(principal, READS.includes(action) ? DATES_RESEARCH_READ_CAPABILITY : DATES_RESEARCH_WRITE_CAPABILITY);
}
const keys = (body: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => required.every((key) => Object.hasOwn(body, key))
  && Object.keys(body).every((key) => required.includes(key) || optional.includes(key));
const keyValid = (value: unknown) => researchString(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value);
const command = (body: Record<string, unknown>) => keyValid(body.idempotency_key);
export function researchAuditReason(value: unknown): boolean {
  if (!researchString(value)) return false;
  // PHP trim + mb_strlen, matching this selected research contract rather than the older intake reason rule.
  const length = Array.from(value.replace(/^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/g, "")).length;
  return length >= 3 && length <= 1000;
}
/** Editor hint only; Core remains the authority for saved text. */
export function researchSourceLabel(value: string): boolean {
  const length = Array.from(value.replace(/^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/g, "")).length;
  return length >= 1 && length <= 160;
}
const audited = (body: Record<string, unknown>) => command(body) && researchAuditReason(body.reason);
const bool = (value: unknown) => typeof value === "boolean";
const scopeKeys = (value: unknown) => researchRecord(value) && keys(value, ["kind", "radius_km"]);
function exactValues(value: unknown, defaults: boolean) {
  return researchRecord(value) && keys(value, [...DATES_RESEARCH_VALUE_FIELDS, ...(defaults ? ["enabled", "auto_cities_enabled"] : [])], defaults ? ["research_models", "domains"] : [])
    && scopeKeys(value.scope) && decodeResearchValues(value) !== null
    && ["cadence_hours", "member_threshold", "target_events", "window_days"].every((key) => researchInteger(value[key], 1))
    && (!defaults || (bool(value.enabled) && bool(value.auto_cities_enabled)))
    && (!Object.hasOwn(value, "research_models") || researchRecord(value.research_models) && keys(value.research_models, ["openai", "gemini"]) && decodeResearchModels(value.research_models) !== null)
    && (!Object.hasOwn(value, "domains") || researchDomainsValid(value.domains));
}
/** Syntax only. Core alone owns the public-host, suffix and immutable deny-list decisions. */
export function researchDomainName(value: unknown): string | null {
  if (!researchString(value)) return null;
  const host = value.replace(/^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/g, "").toLowerCase();
  return host.length <= 253 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ? host : null;
}
export function researchDomainsValid(value: unknown): boolean {
  if (!Array.isArray(value)) return false; // Core owns the count bound; controls use overview.limits.domains.
  const seen = new Set<string>();
  return value.every((row) => {
    if (!researchRecord(row) || !keys(row, ["domain", "type"]) || !researchOneOf(row.type, DATES_RESEARCH_DOMAIN_TYPES)) return false;
    const domain = researchDomainName(row.domain);
    if (!domain || seen.has(domain)) return false;
    seen.add(domain); return true;
  });
}
function exactOverrides(value: unknown) {
  return researchRecord(value) && keys(value, DATES_RESEARCH_VALUE_FIELDS) && (value.scope === null || scopeKeys(value.scope)) && decodeResearchOverrides(value) !== null
    && ["cadence_hours", "member_threshold", "target_events", "window_days"].every((key) => value[key] === null || researchInteger(value[key], 1));
}
export function researchSourceUrl(value: unknown): boolean {
  if (!researchString(value) || value.trim() === "" || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.hostname !== "" && url.username === "" && url.password === ""; }
  catch { return false; }
}
/** Receipt identity only: mirrors Core SafeExternalFetch's stored spelling. Core alone decides URL safety. */
export function researchSourceCanonicalUrl(value: unknown): string | null {
  if (!researchSourceUrl(value) || !researchString(value)) return null;
  const parts = /^([A-Za-z]+):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/s.exec(value);
  if (!parts) return null;
  try {
    const parsed = new URL(`${parts[1]}://${parts[2]}/`);
    if (parsed.port) return null; // Core stores default ports without their spelling.
    const encode = (text: string) => text.replace(/[^\x21-\x7e]/gu, (character) => encodeURIComponent(character));
    const tracking = new Set(["fbclid", "gclid", "dclid", "msclkid", "igshid", "mc_cid", "mc_eid", "yclid"]);
    const query = (parts[4] ?? "").split("&").filter((pair) => {
      if (!pair) return false;
      // PHP rawurldecode leaves '+' unchanged and decodes even malformed UTF-8 byte sequences.
      const name = pair.split("=", 1)[0].replace(/%([a-f0-9]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))).toLowerCase();
      return !name.startsWith("utm_") && !tracking.has(name);
    }).join("&");
    return `${parts[1].toLowerCase()}://${parsed.hostname}${encode(parts[3] || "/")}${query ? `?${encode(query)}` : ""}`;
  } catch { return null; }
}
/** Closed browser requests; range limits belong to Core's overview and Core's own validator. */
export function normalizeDatesResearchProxyBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!(DATES_RESEARCH_ACTIONS as readonly string[]).includes(action)) return undefined;
  if (action === "dates_event_research_overview") return keys(body, []) ? {} : null;
  if (action === "dates_event_research_defaults_save") return keys(body, ["expected_revision", "values", "reason", "idempotency_key"])
    && researchInteger(body.expected_revision) && exactValues(body.values, true) && audited(body) ? body : null;
  if (action === "dates_event_research_discovery_resume") return keys(body, ["expected_revision", "reason", "idempotency_key"])
    && researchInteger(body.expected_revision) && audited(body) ? body : null;
  if (action === "dates_event_research_area_save") {
    if (!keys(body, ["mode", "overrides", "reason", "idempotency_key"], ["area_id", "expected_revision", "place_id", "label"])
      || !researchOneOf(body.mode, DATES_RESEARCH_MODES) || !exactOverrides(body.overrides) || !audited(body)
      || (Object.hasOwn(body, "label") && !researchString(body.label))) return null;
    const update = researchId(body.area_id) && researchInteger(body.expected_revision, 1) && !Object.hasOwn(body, "place_id");
    const create = researchId(body.place_id) && !Object.hasOwn(body, "area_id") && (!Object.hasOwn(body, "expected_revision") || body.expected_revision === 0);
    return update || create ? body : null;
  }
  if (action === "dates_event_research_source_save") {
    if (!keys(body, ["url", "label", "type", "area_id", "cadence_hours", "max_events", "window_days", "autopublish", "enabled", "archived", "reason", "idempotency_key"], ["source_id", "expected_revision"])
      || !researchSourceUrl(body.url) || !researchString(body.label) || !researchOneOf(body.type, DATES_RESEARCH_SOURCE_TYPES)
      || !(body.area_id === null || researchId(body.area_id)) || !researchInteger(body.cadence_hours, 1)
      || !researchInteger(body.max_events, 1) || !(body.window_days === null || researchInteger(body.window_days, 1)) || !(body.autopublish === null || bool(body.autopublish))
      || !bool(body.enabled) || !bool(body.archived) || !audited(body)) return null;
    if (body.type === "aggregator" && body.autopublish !== null) return null;
    const update = researchId(body.source_id) && researchInteger(body.expected_revision, 1);
    const create = !Object.hasOwn(body, "source_id") && (!Object.hasOwn(body, "expected_revision") || body.expected_revision === 0);
    return update || create ? body : null;
  }
  if (action === "dates_event_research_source_run_now") return keys(body, ["source_id", "expected_revision", "dry_run", "idempotency_key"])
    && researchId(body.source_id) && researchInteger(body.expected_revision, 1) && bool(body.dry_run) && command(body) ? body : null;
  if (action === "dates_event_research_area_run_now") return keys(body, ["area_id", "expected_revision", "dry_run", "idempotency_key"])
    && researchId(body.area_id) && researchInteger(body.expected_revision, 1) && bool(body.dry_run) && command(body) ? body : null;
  if (action === "dates_event_research_run_detail") return keys(body, ["run_id"]) && researchId(body.run_id) ? body : null;
  if (action === "dates_event_research_run_list") {
    if (!keys(body, [], ["source_id", "area_id", "kind", "cursor", "limit"])) return null;
    const result: Record<string, unknown> = {};
    for (const key of ["source_id", "area_id", "cursor"] as const) {
      if (!Object.hasOwn(body, key) || body[key] === "") continue;
      if (!researchId(body[key])) return null;
      result[key] = body[key];
    }
    if (Object.hasOwn(body, "kind") && body.kind !== "") { if (!researchOneOf(body.kind, DATES_RESEARCH_RUN_KINDS)) return null; result.kind = body.kind; }
    if (Object.hasOwn(body, "limit")) { if (!researchInteger(body.limit, 1)) return null; result.limit = body.limit; }
    return result;
  }
  return normalizeResearchBatchBody(body);
}
export function normalizeResearchBatchBody(body: Record<string, unknown>): Record<string, unknown> | null {
  if (!keys(body, ["intake_ids", "expected_revisions", "action", "reason", "idempotency_key"], ["confirmations", "reason_code"]) || !audited(body)
    || !Array.isArray(body.intake_ids) || body.intake_ids.length < 1 || !body.intake_ids.every(datesIntakeId)
    || new Set(body.intake_ids).size !== body.intake_ids.length || !researchRecord(body.expected_revisions)
    || body.intake_ids.some((id) => !researchInteger((body.expected_revisions as Record<string, unknown>)[id], 1))
    || Object.keys(body.expected_revisions).some((id) => !(body.intake_ids as string[]).includes(id))) return null;
  if (body.action === "reject") return !Object.hasOwn(body, "confirmations") && researchOneOf(body.reason_code, DATES_INTAKE_REJECT_REASONS) ? body : null;
  return body.action === "publish" && !Object.hasOwn(body, "reason_code") && researchRecord(body.confirmations)
    && keys(body.confirmations, ["source", "public_venue", "timezone", "content_safe"])
    && ["source", "public_venue", "timezone", "content_safe"].every((key) => body.confirmations && (body.confirmations as Record<string, unknown>)[key] === true) ? body : null;
}
export function isResearchAction(action: string): action is DatesResearchAction { return (DATES_RESEARCH_ACTIONS as readonly string[]).includes(action); }

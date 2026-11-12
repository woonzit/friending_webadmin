import { researchId, researchInteger, researchOneOf, researchRecord, researchRowList, researchString, researchSuccess, type ResearchRows } from "@/lib/datesResearchAdmin";

/**
 * Research follow-ups (owner request 2026-11-03; Core docs/DATES_EVENT_RESEARCH_ADMIN_V1.md "Research follow-ups"):
 * the research candidates the AI could not check, for an operator to look up by hand. Core decides which candidates
 * they are and keeps only the operator's state (open, done, dismissed, a note). Decoders fail closed per row: a row
 * that cannot be read is reported, never shown as an empty list.
 */
export const DATES_RESEARCH_FOLLOWUP_GROUPS = ["fetch", "validation", "gate", "other"] as const;
export const DATES_RESEARCH_FOLLOWUP_STATES = ["open", "done", "dismissed"] as const;
export const DATES_RESEARCH_FOLLOWUP_STATE_FILTERS = ["open", "done", "dismissed", "all"] as const;
/** Core's follow-up reasons: the candidate drop reasons it lists, and the gate's closure of an imported candidate. */
const DATES_RESEARCH_FOLLOWUP_REASONS = ["fetch_failed", "robots_disallowed", "over_cap", "validation_failed", "no_event_page",
  "blocked_domain", "research_not_publishable"] as const;
const GROUP_OF: Readonly<Record<ResearchFollowupReason, ResearchFollowupGroup>> = { fetch_failed: "fetch", robots_disallowed: "fetch", over_cap: "fetch",
  validation_failed: "validation", no_event_page: "other", blocked_domain: "other", research_not_publishable: "gate" };
const DATES_RESEARCH_FOLLOWUP_NOTE_MAX = 500;
const DATES_RESEARCH_FOLLOWUP_QUERY_MAX = 200;
export const DATES_RESEARCH_FOLLOWUP_LIMIT_MAX = 100;
/** Rows without a city (a registered source with none) are filtered with this area value. */
export const DATES_RESEARCH_FOLLOWUP_NO_AREA = "none";

type ResearchFollowupGroup = typeof DATES_RESEARCH_FOLLOWUP_GROUPS[number];
export type ResearchFollowupStateName = typeof DATES_RESEARCH_FOLLOWUP_STATES[number];
export type ResearchFollowupStateFilter = typeof DATES_RESEARCH_FOLLOWUP_STATE_FILTERS[number];
export type ResearchFollowupReason = typeof DATES_RESEARCH_FOLLOWUP_REASONS[number];
/** What the extraction read about the event's time and place; every key is always present. */
export type ResearchFollowupFound = { starts_local: string | null; ends_local: string | null; timezone: string | null; start_at: number | null;
  end_at: number | null; all_day: boolean | null; venue_name: string | null; venue_address: string | null; city: string | null };
type ResearchFollowupDetail = { stage: string | null; http_status: number | null; hard_fails: string[]; gate: string | null;
  title_match: string | null; extraction_result: string | null };
type ResearchFollowupState = { key: string; state: ResearchFollowupStateName; note: string | null; revision: number;
  updated_by: string | null; updated_at: number | null };
export type ResearchFollowup = Omit<ResearchFollowupState, never> & {
  group: ResearchFollowupGroup; reason: ResearchFollowupReason; title: string; extracted_title: string | null; date_text: string; venue_name: string | null;
  found: ResearchFollowupFound | null; url: string | null; url_host: string; topic: string | null; area_id: string | null; area_label: string | null;
  source_id: string | null; source_label: string | null; run_id: string; run_kind: "area" | "source"; run_dry_run: boolean; run_created_at: number;
  seen_count: number; intake_id: string | null; detail: ResearchFollowupDetail;
};
type ResearchFollowupAreaCount = { area_id: string | null; label: string | null; count: number };
export type ResearchFollowupList = {
  followups: ResearchRows<ResearchFollowup>; next_cursor: string | null; limit: number;
  counts: { states: Record<ResearchFollowupStateName, number>; groups: Record<ResearchFollowupGroup, number>; areas: ResearchFollowupAreaCount[] };
  horizon_days: number; runs_scanned: number; truncated: boolean; server_now: number;
};

const nullable = <T>(value: unknown, test: (value: unknown) => value is T): value is T | null => value === null || test(value);
const text = (maximum: number) => (value: unknown): value is string => researchString(value) && Array.from(value).length <= maximum;
const code = (value: unknown): value is string => researchString(value) && /^[a-z][a-z0-9_-]{0,95}$/.test(value);
const local = (value: unknown): value is string => researchString(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
const instant = (value: unknown): value is number => researchInteger(value, 1);
const bool = (value: unknown): value is boolean => typeof value === "boolean";
export const researchFollowupKey = (value: unknown): value is string => researchString(value) && /^rfu_[a-f0-9]{32}$/.test(value);
/** An address the console may link to: an absolute http(s) URL without credentials. */
export function researchFollowupLink(value: unknown): value is string {
  if (!researchString(value) || value.length > 2048 || /[\u0000- \u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.hostname !== "" && url.username === "" && url.password === ""; }
  catch { return false; }
}

function found(value: unknown): ResearchFollowupFound | null | undefined {
  if (value === null) return null;
  if (!researchRecord(value) || !nullable(value.starts_local, local) || !nullable(value.ends_local, local) || !nullable(value.timezone, text(64))
    || !nullable(value.start_at, instant) || !nullable(value.end_at, instant) || !nullable(value.all_day, bool)
    || !["venue_name", "venue_address", "city"].every((key) => nullable(value[key], text(300)))) return undefined;
  return { starts_local: value.starts_local, ends_local: value.ends_local, timezone: value.timezone, start_at: value.start_at, end_at: value.end_at,
    all_day: value.all_day, venue_name: value.venue_name as string | null, venue_address: value.venue_address as string | null, city: value.city as string | null };
}
function detail(value: unknown): ResearchFollowupDetail | null {
  if (!researchRecord(value) || !nullable(value.stage, code) || !nullable(value.http_status, (v): v is number => researchInteger(v, 100) && (v as number) <= 599)
    || !Array.isArray(value.hard_fails) || value.hard_fails.length > 100 || !value.hard_fails.every(code) || !nullable(value.gate, code)
    || !nullable(value.title_match, code) || !nullable(value.extraction_result, code)) return null;
  return { stage: value.stage, http_status: value.http_status, hard_fails: [...value.hard_fails as string[]], gate: value.gate,
    title_match: value.title_match, extraction_result: value.extraction_result };
}
/** The operator's state of one row (a save's receipt, a conflict's `current`, the state fields of a list row). */
export function decodeResearchFollowupState(value: unknown): ResearchFollowupState | null {
  if (!researchRecord(value) || !researchFollowupKey(value.key) || !researchOneOf(value.state, DATES_RESEARCH_FOLLOWUP_STATES)
    || !nullable(value.note, text(DATES_RESEARCH_FOLLOWUP_NOTE_MAX)) || !researchInteger(value.revision) || !nullable(value.updated_by, text(320))
    || !nullable(value.updated_at, instant)) return null;
  // Before the first save a row is open, without a note or an updater.
  if ((value.revision === 0) !== (value.updated_at === null) || (value.revision === 0) !== (value.updated_by === null)
    || (value.revision === 0 && (value.state !== "open" || value.note !== null))) return null;
  return { key: value.key, state: value.state, note: value.note, revision: value.revision, updated_by: value.updated_by, updated_at: value.updated_at };
}
export function decodeResearchFollowup(value: unknown): ResearchFollowup | null {
  const state = decodeResearchFollowupState(value);
  if (!state || !researchRecord(value) || !researchOneOf(value.group, DATES_RESEARCH_FOLLOWUP_GROUPS)
    || !researchOneOf(value.reason, DATES_RESEARCH_FOLLOWUP_REASONS) || GROUP_OF[value.reason] !== value.group
    || !text(300)(value.title) || !nullable(value.extracted_title, text(300)) || !text(500)(value.date_text) || !nullable(value.venue_name, text(300))
    || !nullable(value.url, researchFollowupLink) || !text(253)(value.url_host) || !nullable(value.topic, text(160))
    || !nullable(value.area_id, researchId) || !nullable(value.area_label, text(300)) || !nullable(value.source_id, researchId) || !nullable(value.source_label, text(300))
    || !researchId(value.run_id) || !researchOneOf(value.run_kind, ["area", "source"] as const) || !bool(value.run_dry_run) || !instant(value.run_created_at)
    || !researchInteger(value.seen_count, 1) || !nullable(value.intake_id, researchId) || (value.group === "gate") !== (value.intake_id !== null)) return null;
  const facts = found(value.found), why = detail(value.detail);
  if (facts === undefined || why === null) return null;
  return { ...state, group: value.group, reason: value.reason, title: value.title, extracted_title: value.extracted_title, date_text: value.date_text,
    venue_name: value.venue_name, found: facts, url: value.url, url_host: value.url_host, topic: value.topic, area_id: value.area_id,
    area_label: value.area_label, source_id: value.source_id, source_label: value.source_label, run_id: value.run_id, run_kind: value.run_kind,
    run_dry_run: value.run_dry_run, run_created_at: value.run_created_at, seen_count: value.seen_count, intake_id: value.intake_id, detail: why };
}
function counts(value: unknown): ResearchFollowupList["counts"] | null {
  if (!researchRecord(value) || !researchRecord(value.states) || !researchRecord(value.groups) || !Array.isArray(value.areas)) return null;
  const states = value.states, groups = value.groups;
  if (!DATES_RESEARCH_FOLLOWUP_STATES.every((key) => researchInteger(states[key])) || !DATES_RESEARCH_FOLLOWUP_GROUPS.every((key) => researchInteger(groups[key]))) return null;
  const areas: ResearchFollowupAreaCount[] = [];
  for (const row of value.areas) {
    if (!researchRecord(row) || !nullable(row.area_id, researchId) || !nullable(row.label, text(300)) || !researchInteger(row.count, 1)
      || areas.some((other) => other.area_id === row.area_id)) return null;
    areas.push({ area_id: row.area_id, label: row.label as string | null, count: row.count });
  }
  return { states: Object.fromEntries(DATES_RESEARCH_FOLLOWUP_STATES.map((key) => [key, states[key] as number])) as Record<ResearchFollowupStateName, number>,
    groups: Object.fromEntries(DATES_RESEARCH_FOLLOWUP_GROUPS.map((key) => [key, groups[key] as number])) as Record<ResearchFollowupGroup, number>, areas };
}
export function decodeResearchFollowupList(value: unknown): ResearchFollowupList | null {
  if (!researchSuccess(value) || !nullable(value.next_cursor, researchFollowupCursor) || !researchInteger(value.limit, 1)
    || !researchInteger(value.horizon_days, 1) || !researchInteger(value.runs_scanned) || !bool(value.truncated) || !instant(value.server_now)) return null;
  const rows = researchRowList(value.followups, decodeResearchFollowup, "key"), facets = counts(value.counts);
  return rows && facets ? { followups: rows, next_cursor: value.next_cursor, limit: value.limit, counts: facets, horizon_days: value.horizon_days,
    runs_scanned: value.runs_scanned, truncated: value.truncated, server_now: value.server_now } : null;
}
export function researchFollowupCursor(value: unknown): value is string {
  return researchString(value) && /^[1-9][0-9]{0,11}:rru_[a-f0-9]{32}:(0|[1-9][0-9]{0,3})$/.test(value);
}

/** PHP trim() of the characters Core trims; a note Core would store, or null for none. */
export function researchFollowupNote(value: string): string | null {
  const trimmed = value.replace(/^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/g, "");
  return trimmed === "" ? null : trimmed;
}
/** Core's note rule: plain text (line breaks allowed), at most 500 characters once trimmed. */
export function researchFollowupNoteValid(value: unknown): boolean {
  if (!researchString(value)) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
  const note = researchFollowupNote(value);
  return note === null || Array.from(note).length <= DATES_RESEARCH_FOLLOWUP_NOTE_MAX;
}
export function researchFollowupQueryValid(value: unknown): boolean {
  return researchString(value) && Array.from(value).length <= DATES_RESEARCH_FOLLOWUP_QUERY_MAX && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * The words of why a row needs a manual check: a message key under datesAdmin.research.followups.reasons with its
 * values, then the detail lines (hard fails, the gate's blocker) the page words through the existing vocabularies.
 */
type ResearchFollowupReasonWords = { key: string; values?: Record<string, string | number> };
export function researchFollowupReasonWords(row: Pick<ResearchFollowup, "reason" | "detail">): ResearchFollowupReasonWords {
  const status = row.detail.http_status;
  switch (row.reason) {
    case "fetch_failed":
      if (status === null) return { key: "fetchFailed" };
      if ([401, 403, 451].includes(status)) return { key: "fetchRefused", values: { status } };
      if ([404, 410].includes(status)) return { key: "fetchNotFound", values: { status } };
      if (status === 429) return { key: "fetchRateLimited", values: { status } };
      return { key: "fetchStatus", values: { status } };
    case "robots_disallowed": return { key: "robots" };
    case "over_cap": return { key: "fetchBudget" };
    case "validation_failed":
      if (row.detail.hard_fails.length > 0) return { key: "validationHardFails" };
      if (row.detail.stage === "page") return { key: "validationEmptyPage" };
      if (row.detail.stage === "title") return { key: "validationTitle" };
      if (row.detail.stage === "extraction") return { key: "validationExtraction" };
      return { key: "validationFailed" };
    case "no_event_page": return { key: "noEventPage" };
    case "blocked_domain": return { key: "blockedDomain" };
    case "research_not_publishable": return { key: "gate" };
  }
}

/** A Google search for the event: its title, venue and date as found. */
export function researchFollowupSearchUrl(row: Pick<ResearchFollowup, "title" | "extracted_title" | "venue_name" | "found" | "date_text" | "area_label">): string {
  const venue = row.venue_name ?? row.found?.venue_name ?? null;
  const date = row.found?.starts_local ? row.found.starts_local.slice(0, 10) : row.date_text;
  const terms = [row.title || row.extracted_title || "", venue ?? "", date, venue ? "" : row.area_label ?? ""].map((part) => part.trim()).filter((part) => part !== "");
  return `https://www.google.com/search?q=${encodeURIComponent(terms.join(" "))}`;
}

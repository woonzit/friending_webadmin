"use client";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { ResearchCommandFeedback, useResearchCommand } from "@/components/DatesResearchControls";
import { adminCall } from "@/lib/adminClient";
import { readResearchFollowups, type ResearchRead } from "@/lib/datesResearchConsole";
import { DATES_INTAKE_HARD_FAILS } from "@/lib/datesIntakeAdmin";
import { datesSystemClosureBlockerWorded } from "@/lib/datesSystemClosure";
import {
  DATES_RESEARCH_FOLLOWUP_GROUPS, DATES_RESEARCH_FOLLOWUP_NO_AREA, DATES_RESEARCH_FOLLOWUP_STATE_FILTERS, researchFollowupNote, researchFollowupNoteValid,
  researchFollowupQueryValid, researchFollowupReasonWords, researchFollowupSearchUrl, type ResearchFollowup, type ResearchFollowupFound,
  type ResearchFollowupList, type ResearchFollowupStateFilter, type ResearchFollowupStateName,
} from "@/lib/datesResearchFollowups";
import { formatDate, formatNumber } from "@/lib/format";

type Ready = Extract<ResearchRead<ResearchFollowupList>, { kind: "ready" }>;
type Problem = Exclude<ResearchRead<ResearchFollowupList>, Ready>;
type Filters = { area: string; group: string; state: ResearchFollowupStateFilter; q: string };
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The research console's two pages: configuration and runs, and the follow-ups. */
export function ResearchSubnav({ current }: { current: "console" | "followups" }) {
  const t = useTranslations("datesAdmin.research.followups");
  return <nav className="research-sections research-subnav" aria-label={t("subnavLabel")}>
    <Link href="/dates/research" aria-current={current === "console" ? "page" : undefined}>{t("subnavConsole")}</Link>
    <Link href="/dates/research/followups" aria-current={current === "followups" ? "page" : undefined}>{t("subnavFollowups")}</Link>
  </nav>;
}

const local = (value: string, allDay: boolean | null) => allDay ? value.slice(0, 10) : value.replace("T", " ");
/** The event's own clock, as the research read it: "2026-11-01 10:00 – 2027-04-04 17:00 (America/Los_Angeles)". */
export function researchFollowupWhen(found: ResearchFollowupFound | null): string | null {
  if (!found || found.starts_local === null) return null;
  const start = local(found.starts_local, found.all_day), end = found.ends_local === null ? null : local(found.ends_local, found.all_day);
  return `${start}${end !== null && end !== start ? ` – ${end}` : ""}${found.timezone ? ` (${found.timezone})` : ""}`;
}

/**
 * Why the row needs a manual check, in words: the fetch answer, the validator's hard fails ("Missing venue · Duration
 * too long") or the publication gate's blocker. A code the console does not know is shown as Core wrote it.
 */
export function ResearchFollowupReason({ row }: { row: ResearchFollowup }) {
  const t = useTranslations("datesAdmin.research.followups"), closure = useTranslations("datesAdmin.research.closure");
  const words = researchFollowupReasonWords(row), blocker = row.detail.gate;
  const fail = (code: string) => (DATES_INTAKE_HARD_FAILS as readonly string[]).includes(code) ? t(`hardFails.${code}`) : <code>{code}</code>;
  if (words.key === "validationHardFails") {
    return <div className="research-followup-reason"><strong>{row.detail.hard_fails.map((code, index) =>
      <React.Fragment key={code}>{index > 0 && " · "}{fail(code)}</React.Fragment>)}</strong></div>;
  }
  return <div className="research-followup-reason"><strong>{t(`reasons.${words.key}`, words.values ?? {})}
    {row.reason === "research_not_publishable" && blocker !== null && <>: {datesSystemClosureBlockerWorded(blocker) ? closure(`blockers.${blocker}`) : <code>{blocker}</code>}</>}</strong>
    {row.reason === "research_not_publishable" && row.detail.hard_fails.length > 0 && <div><small>{row.detail.hard_fails.map((code, index) =>
      <React.Fragment key={code}>{index > 0 && " · "}{fail(code)}</React.Fragment>)}</small></div>}</div>;
}

export function ResearchFollowupCard({ row, manage, busy, note, onNote, onSave }: { row: ResearchFollowup; manage: boolean; busy: boolean; note: string;
  onNote: (value: string) => void; onSave: (state: ResearchFollowupStateName) => void }) {
  const t = useTranslations("datesAdmin.research.followups"), research = useTranslations("datesAdmin.research"), locale = useLocale();
  const when = researchFollowupWhen(row.found);
  const venue = [row.found?.venue_name ?? row.venue_name, row.found?.venue_address, row.found?.city].filter((part, index, all): part is string =>
    typeof part === "string" && part !== "" && all.indexOf(part) === index);
  const discoveredVenue = row.venue_name && !venue.includes(row.venue_name) ? row.venue_name : null;
  const noteValid = researchFollowupNoteValid(note);
  const place = row.area_label ?? row.source_label ?? (row.area_id === null && row.source_id === null ? t("noCity") : row.area_id ?? row.source_id);
  return <article className="panel research-followup" data-state={row.state} data-group={row.group}>
    <header className="research-followup-head"><div><h3>{row.title || row.extracted_title || t("untitled")}</h3>
      {row.extracted_title && row.extracted_title !== row.title && <p className="field-hint">{t("onThePage", { title: row.extracted_title })}</p>}</div>
      <span className={`badge ${row.state === "open" ? "badge-warning" : row.state === "done" ? "badge-active" : "badge-inactive"}`}>{t(`states.${row.state}`)}</span></header>
    <dl className="research-followup-facts">
      <dt>{t("labels.when")}</dt><dd>{row.date_text || "—"}{when && <div><small>{t("whenFound", { when })}</small></div>}</dd>
      <dt>{t("labels.where")}</dt><dd>{venue.length > 0 ? venue.join(", ") : "—"}{discoveredVenue && <div><small>{t("venueDiscovered", { venue: discoveredVenue })}</small></div>}</dd>
      <dt>{t("labels.city")}</dt><dd>{place}{row.run_kind === "source" && <small> · {t("fromSource")}</small>}</dd>
      {row.topic && <><dt>{t("labels.topic")}</dt><dd>{row.topic}</dd></>}
      <dt>{t("labels.reason")}</dt><dd><ResearchFollowupReason row={row} /><small className="research-followup-group">{t(`groups.${row.group}`)}</small></dd>
      <dt>{t("labels.found")}</dt><dd>{formatDate(row.run_created_at, locale, true)}{row.run_dry_run && <> · {research("dryRun")}</>}
        {row.seen_count > 1 && <> · {t("seenCount", { count: row.seen_count })}</>}<div><small><code>{row.run_id}</code></small></div></dd>
      <dt>{t("labels.page")}</dt><dd>{row.url ? <a className="research-url" href={row.url} {...NEW_TAB}>{row.url}</a> : <>{t("noLink")}{row.url_host && <> (<code>{row.url_host}</code>)</>}</>}</dd>
    </dl>
    <div className="row-actions research-followup-links">
      {row.url && <a className="button button-secondary button-small" href={row.url} {...NEW_TAB}>{t("openPage")}</a>}
      <a className="button button-secondary button-small" href={researchFollowupSearchUrl(row)} {...NEW_TAB}>{t("searchGoogle")}</a>
      {row.intake_id && <Link className="button button-secondary button-small" href={`/dates/intakes/${encodeURIComponent(row.intake_id)}`}>{t("openIntake")}</Link>}
    </div>
    {row.note !== null && <p className="research-followup-note"><strong>{t("labels.note")}</strong> {row.note}</p>}
    {row.updated_by !== null && <p className="field-hint">{t("updated", { by: row.updated_by, at: formatDate(row.updated_at, locale, true) })}</p>}
    {manage && <div className="research-followup-actions">
      <label className="field field-full"><span>{t("labels.noteInput")}</span>
        <textarea value={note} disabled={busy} rows={2} onChange={(event) => onNote(event.target.value)} aria-invalid={!noteValid} />
        <small className="field-hint">{noteValid ? t("noteHint") : t("noteTooLong")}</small></label>
      <div className="row-actions">
        {row.state === "open" ? <>
          <button type="button" className="button button-primary button-small" disabled={busy || !noteValid} onClick={() => onSave("done")}>{t("actions.done")}</button>
          <button type="button" className="button button-secondary button-small" disabled={busy || !noteValid} onClick={() => onSave("dismissed")}>{t("actions.dismiss")}</button>
        </> : <button type="button" className="button button-secondary button-small" disabled={busy || !noteValid} onClick={() => onSave("open")}>{t("actions.reopen")}</button>}
      </div></div>}
  </article>;
}

export default function DatesResearchFollowups() {
  const t = useTranslations("datesAdmin.research.followups"), research = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const [filters, setFilters] = useState<Filters>({ area: "", group: "", state: "open", q: "" }), [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null), [previous, setPrevious] = useState<(string | null)[]>([]);
  const [read, setRead] = useState<Ready | null>(null), [problem, setProblem] = useState<Problem | null>(null), [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current; setLoading(true);
    const body = { ...(filters.area ? { area_id: filters.area } : {}), ...(filters.group ? { group: filters.group } : {}), state: filters.state,
      ...(filters.q ? { q: filters.q } : {}), ...(cursor ? { cursor } : {}) };
    const result = await readResearchFollowups(adminCall, body, signal);
    if (signal?.aborted || current !== generation.current) return;
    setLoading(false);
    if (result.kind === "ready") { setRead(result); setProblem(null); } else setProblem(result);
  }, [filters, cursor]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); ++generation.current; }; }, [load]);
  // No membership-recovery registration: only the overview and the research console register one (the recovery
  // inventory); an unconfirmed read here offers its own retry.
  const reload = useCallback(async () => { await load(); }, [load]);
  // A failed refresh is never a fresh actor or capability proof.
  const actor = problem === null ? read?.operator.email ?? "" : "";
  const manage = problem === null && read?.manage === true;
  const hidden = problem?.kind === "denied" || problem?.kind === "unavailable";
  // A note draft is kept until its save is known to have succeeded; an unknown outcome keeps it for the retry.
  const command = useResearchCommand(actor, async (answer) => {
    const key = (answer.receipt as { key?: unknown } | null)?.key;
    if (typeof key === "string") setNotes((value) => { const rest = { ...value }; delete rest[key]; return rest; });
    await reload();
  }, reload);
  const busy = command.busy || command.pending !== null;
  function change(next: Partial<Filters>) { setCursor(null); setPrevious([]); setFilters((value) => ({ ...value, ...next })); }
  function save(row: ResearchFollowup, state: ResearchFollowupStateName) {
    const draft = notes[row.key] ?? row.note ?? "";
    const note = researchFollowupNote(draft);
    void command.submit("dates_event_research_followup_save", { key: row.key, state, expected_revision: row.revision, ...(note === null ? {} : { note: draft }) });
  }
  const list = read?.value;
  const searchValid = researchFollowupQueryValid(search);
  return <>
    <PageHeader eyebrow={research("eyebrow")} title={t("title")} subtitle={t("subtitle")}
      actions={<button className="button button-secondary" disabled={loading} onClick={() => void load()}>{common("refresh")}</button>} />
    <DatesAdminTabs />
    <ResearchSubnav current="followups" />
    {problem?.kind === "unavailable" && <section className="panel research-panel"><p>{t("unavailable")}</p></section>}
    {loading && !read ? <LoadingPanel /> : problem?.kind !== "unavailable" && (!read || problem?.kind === "denied")
      ? <ErrorPanel message={research(problem?.kind === "denied" ? "denied" : "unconfirmed")} retry={() => void load()} /> : null}
    {read && list && <div hidden={hidden}>
      {problem && !hidden && <p className="alert alert-warning" role="status">{t("refreshFailed")}{problem.kind === "refused" ? <> <code>{problem.error}</code></> : null}</p>}
      <section className="panel research-panel research-followups-filters">
        <p>{t("hint", { days: list.horizon_days })}</p>
        {!read.manage && <p className="alert alert-info">{t("readOnly")}</p>}
        <div className="row-actions research-followup-states" role="group" aria-label={t("labels.state")}>
          {DATES_RESEARCH_FOLLOWUP_STATE_FILTERS.map((state) => <button key={state} type="button" aria-pressed={filters.state === state}
            className={`button button-small ${filters.state === state ? "button-primary" : "button-secondary"}`} onClick={() => change({ state })}>
            {t(`stateFilters.${state}`)}{state !== "all" && <> ({formatNumber(list.counts.states[state], locale)})</>}</button>)}
        </div>
        <div className="dates-filter-grid">
          <label className="field"><span>{t("labels.city")}</span><select value={filters.area} onChange={(event) => change({ area: event.target.value })}>
            <option value="">{common("all")}</option>
            {list.counts.areas.map((row) => <option key={row.area_id ?? DATES_RESEARCH_FOLLOWUP_NO_AREA} value={row.area_id ?? DATES_RESEARCH_FOLLOWUP_NO_AREA}>
              {row.area_id === null ? t("noCity") : row.label ?? row.area_id} ({formatNumber(row.count, locale)})</option>)}
            {filters.area !== "" && !list.counts.areas.some((row) => (row.area_id ?? DATES_RESEARCH_FOLLOWUP_NO_AREA) === filters.area)
              && <option value={filters.area}>{filters.area === DATES_RESEARCH_FOLLOWUP_NO_AREA ? t("noCity") : filters.area}</option>}
          </select></label>
          <label className="field"><span>{t("labels.group")}</span><select value={filters.group} onChange={(event) => change({ group: event.target.value })}>
            <option value="">{common("all")}</option>
            {DATES_RESEARCH_FOLLOWUP_GROUPS.map((group) => <option key={group} value={group}>{t(`groups.${group}`)} ({formatNumber(list.counts.groups[group], locale)})</option>)}
          </select></label>
          <form className="field" role="search" onSubmit={(event) => { event.preventDefault(); if (searchValid) change({ q: search.trim() }); }}>
            <label><span>{t("labels.search")}</span><input type="search" value={search} placeholder={t("searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} aria-invalid={!searchValid} /></label>
            <div className="row-actions"><button type="submit" className="button button-secondary button-small" disabled={!searchValid}>{t("searchSubmit")}</button>
              {filters.q !== "" && <button type="button" className="button button-secondary button-small" onClick={() => { setSearch(""); change({ q: "" }); }}>{t("searchClear")}</button>}</div>
          </form>
        </div>
        {list.truncated && <p className="alert alert-warning">{t("truncated", { runs: list.runs_scanned })}</p>}
        <ResearchCommandFeedback command={command} />
      </section>
      {list.followups.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{research("unreadableRow", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
      {list.followups.rows.length === 0 && list.followups.unreadable.length === 0 ? <section className="panel research-panel"><p>{t(filters.state === "open" ? "emptyOpen" : "empty")}</p></section>
        : list.followups.rows.map((row) => <ResearchFollowupCard key={row.key} row={row} manage={manage} busy={busy} note={notes[row.key] ?? row.note ?? ""}
          onNote={(value) => setNotes((current) => ({ ...current, [row.key]: value }))} onSave={(state) => save(row, state)} />)}
      <div className="row-actions research-followup-pages">
        <button className="button button-secondary button-small" disabled={loading || previous.length === 0} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious((rows) => rows.slice(0, -1)); }}>{common("previous")}</button>
        <button className="button button-secondary button-small" disabled={loading || list.next_cursor === null} onClick={() => { setPrevious((rows) => [...rows, cursor]); setCursor(list.next_cursor); }}>{common("next")}</button>
      </div>
    </div>}
  </>;
}

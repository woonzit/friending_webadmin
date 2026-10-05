"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesResearchRuns from "@/components/DatesResearchRuns";
import { ResearchAreaEditor, ResearchDefaultsEditor, ResearchSourceEditor } from "@/components/DatesResearchEditors";
import { ResearchCommandFeedback, ResearchHelp, ResearchValue, useResearchCommand } from "@/components/DatesResearchControls";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { readResearchOverview, type ResearchRead } from "@/lib/datesResearchConsole";
import { DATES_RESEARCH_VALUE_FIELDS, type ResearchArea, type ResearchDefaults, type ResearchOverview, type ResearchSource } from "@/lib/datesResearchAdmin";
import { researchCost, researchDistanceUnit, researchMonthlyEstimate, researchStock } from "@/lib/datesResearchView";
import { formatDate, formatNumber } from "@/lib/format";

type Ready = Extract<ResearchRead<ResearchOverview>, { kind: "ready" }>;
function SourceRow({ row, read, command, onEdit, editing }: { row: ResearchSource; read: Ready; command: ReturnType<typeof useResearchCommand>; onEdit: () => void; editing: boolean }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const newRunsAllowed = read.value.defaults?.enabled === true;
  return <tr><td><strong>{row.label || row.url}</strong><div className="research-url">{row.url}</div><small>{row.registrable_domain}</small>
    <div>{t(`sourceTypes.${row.type}`)} · {common(row.enabled ? "enabled" : "disabled")}{row.archived ? ` · ${t("archived")}` : ""}</div>
    <small>{row.area_id ? read.value.areas.rows.find((area) => area.area_id === row.area_id)?.label ?? t("unavailableCity", { id: row.area_id }) : t("noCity")}</small></td>
    <td>{formatNumber(row.cadence_hours, locale)} {t("hours")}<div>{t("stock", { count: row.stock.upcoming, target: row.stock.max })}</div><small>{t("missing", { count: row.stock.missing })}</small>
      <div><small>{t("sourceEffective", { days: row.effective.window_days, publish: common(row.effective.autopublish ? "yes" : "no") })}</small></div></td>
    <td>{t(`robotsStates.${row.robots.state}`)}<div><small>{formatDate(row.robots.checked_at, locale, true)}</small></div>
      {row.last_check && <div>{t(`runStatuses.${row.last_check.status}`)}<small> · {t("foundImported", { found: row.last_check.found, imported: row.last_check.imported })}</small></div>}</td>
    <td>{formatDate(row.last_check?.finished_at, locale, true)}<div><small>{t("next")}: {formatDate(row.next_check_at, locale, true)}</small></div></td>
    <td>{researchCost(row.month_cost_micro_usd, locale)}</td><td><div className="row-actions">
      <button className="button button-secondary button-small" disabled={editing || command.busy || command.pending !== null} onClick={onEdit}>{common("edit")}</button>
      {read.manage && <><button className="button button-secondary button-small" disabled={!newRunsAllowed || row.archived || command.busy || command.pending !== null}
        onClick={() => void command.submit("dates_event_research_source_run_now", { source_id: row.source_id, expected_revision: row.revision, dry_run: true })}>{t("test")}</button>
        <button className="button button-primary button-small" disabled={!newRunsAllowed || row.archived || !row.enabled || command.busy || command.pending !== null}
          onClick={() => void command.submit("dates_event_research_source_run_now", { source_id: row.source_id, expected_revision: row.revision, dry_run: false })}>{t("runNow")}</button></>}
    </div></td></tr>;
}
export default function DatesResearchPage() {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const [read, setRead] = useState<Ready | null>(null), [problem, setProblem] = useState<Exclude<ResearchRead<ResearchOverview>, Ready> | null>(null);
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [areaEditor, setAreaEditor] = useState<string | null>(null), [sourceEditor, setSourceEditor] = useState<string | null>(null);
  const [focusRun, setFocusRun] = useState<string | null>(null), generation = useRef(0);
  const [defaultsSnapshot, setDefaultsSnapshot] = useState<{ actor: string; row: ResearchDefaults } | null>(null);
  const [areaSnapshot, setAreaSnapshot] = useState<{ actor: string; row: ResearchArea } | null>(null), [sourceSnapshot, setSourceSnapshot] = useState<{ actor: string; row: ResearchSource } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current; setLoading(true);
    const result = await readResearchOverview(adminCall, signal);
    if (signal?.aborted || current !== generation.current) return;
    setLoading(false);
    if (result.kind === "ready") {
      setRead(result); setProblem(null); setRefresh((value) => value + 1);
      if (result.value.defaults) setDefaultsSnapshot({ actor: result.operator.email, row: result.value.defaults });
    }
    // Keep mounted drafts/unknown commands, but a failed refresh is never a
    // fresh actor/capability proof. Revoked/unsupported consoles are hidden.
    else setProblem(result);
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); ++generation.current; }; }, [load]);
  const reload = useCallback(async () => { await load(); }, [load]);
  // Keep the run identity outside the source rows: a later unreadable row must
  // not remove the only safe retry for a command whose outcome is unknown.
  const confirmedActor = problem === null ? read?.operator.email ?? "" : "";
  const manage = problem === null && read?.manage === true;
  const hidden = problem?.kind === "denied" || problem?.kind === "unavailable";
  const runCommand = useResearchCommand(confirmedActor, async (answer) => { if (answer.runId) setFocusRun(answer.runId); await reload(); }, reload);
  useEffect(() => { const id = new URL(window.location.href).searchParams.get("run_id"); if (id) setFocusRun(id); }, []);
  const overview = read?.value, defaults = overview?.defaults ?? (defaultsSnapshot?.actor === read?.operator.email ? defaultsSnapshot?.row : null);
  const estimate = overview ? researchMonthlyEstimate(overview.estimate, overview.budget) : null;
  const area = areaEditor && overview ? overview.areas.rows.find((row) => row.area_id === areaEditor) ?? null : null;
  const source = sourceEditor && overview ? overview.sources.rows.find((row) => row.source_id === sourceEditor) ?? null : null;
  const editedArea = area ?? (areaSnapshot?.actor === read?.operator.email && areaSnapshot?.row.area_id === areaEditor ? areaSnapshot.row : null);
  const editedSource = source ?? (sourceSnapshot?.actor === read?.operator.email && sourceSnapshot?.row.source_id === sourceEditor ? sourceSnapshot.row : null);
  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<button className="button button-secondary" disabled={loading} onClick={() => void load()}>{common("refresh")}</button>} />
    <DatesAdminTabs />
    {problem?.kind === "unavailable" && <section className="panel research-panel"><p>{t("unavailable")}</p></section>}
    {loading && !read ? <LoadingPanel /> : problem?.kind !== "unavailable" && (!read || !overview || problem?.kind === "denied")
      ? <ErrorPanel message={t(problem?.kind === "denied" ? "denied" : "unconfirmed")} retry={() => void load()} /> : null}
    {read && overview && <div hidden={hidden}>
      {problem && !hidden && <p className="alert alert-warning" role="status">{t("refreshFailed")}{problem.kind === "refused" ? <> <code>{problem.error}</code></> : null}</p>}
      {!read.manage && <p className="alert alert-info">{t("readOnly")}</p>}
      <nav className="research-sections" aria-label={t("sectionsLabel")}>{(["defaults", "cities", "sources", "runs"] as const).map((key) => <a key={key} href={`#research-${key}`}>{t(`sections.${key}`)}</a>)}</nav>
      <section className="panel research-panel" id="research-defaults"><h2>{t("budget")}</h2><div className="stat-grid">
        <div className="stat-card"><span className="stat-label">{t("budgetSpent", { month: overview.budget.month })}</span><strong className="stat-value">{researchCost(overview.budget.spent_micro_usd, locale)}</strong><small>{t("budgetCap", { amount: researchCost(overview.budget.cap_micro_usd, locale) })}</small></div>
        <div className="stat-card"><span className="stat-label">{t("researchSpent")}</span><strong className="stat-value">{researchCost(overview.budget.research_spent_micro_usd, locale)}</strong><small>{t("researchStop", { amount: researchCost(overview.budget.research_stop_at_micro_usd, locale) })}</small></div>
        <div className="stat-card"><span className="stat-label">{t("estimate")}</span><strong className="stat-value">{estimate?.microUsd === null ? t("notMeasured") : researchCost(estimate?.microUsd ?? 0, locale)}</strong><small>{t("monthlyChecks", { count: overview.estimate.monthly_checks })}</small></div>
      </div><p>{t("reserved", { amount: researchCost(overview.budget.reserved_micro_usd, locale) })}</p><ResearchHelp field="budget" /><ResearchHelp field="estimate" />
        {overview.budget.research_paused && <p className="alert alert-warning">{t("budgetPaused")}</p>}
      </section>
      {!overview.defaults && <p className="alert alert-warning">{t("defaultsUnreadable")}</p>}
      {defaults && <ResearchDefaultsEditor key={read.operator.email} defaults={defaults} actor={confirmedActor} manage={manage && overview.defaults !== null} limits={overview.limits} reload={reload} />}
      <section className="panel research-panel" id="research-cities"><div className="panel-header"><h2>{t("sections.cities")}</h2>{manage && overview.defaults && <button className="button button-primary" disabled={areaEditor !== null} onClick={() => setAreaEditor("new")}>{t("addCity")}</button>}</div>
        <p>{t("citiesHint")}</p>{overview.areas.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableRow", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
        {overview.areas.rows.length === 0 && overview.areas.unreadable.length === 0 ? <p>{t("citiesEmpty")}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>
          {["city", "members", "state", "effective", "stock", "time", "cost", "actions"].map((key) => <th key={key}>{t(`columns.${key}`)}</th>)}</tr></thead><tbody>
          {overview.areas.rows.map((row) => { const stock = researchStock(row.stock.upcoming, row.stock.target), unit = researchDistanceUnit(row.country_code);
            return <tr key={row.area_id}><td><strong>{row.label}</strong><div>{row.country_code}</div>{row.proposed && <span className="badge badge-warning">{t("proposed")}</span>}
              <div><small>{t(`modeValues.${row.mode}`)}</small></div></td><td>{formatNumber(row.member_count, locale)}<div><small>{formatDate(row.member_count_at, locale, true)}</small></div></td>
              <td><span className={`badge ${row.running ? "badge-active" : "badge-warning"}`}>{t(row.running ? "running" : "notRunning")}</span>{row.not_running_reason && <div>{t(`notRunningReasons.${row.not_running_reason}`)}</div>}</td>
              <td>{DATES_RESEARCH_VALUE_FIELDS.map((field) => <div key={field}><small>{t(`fields.${field}`)}: <ResearchValue field={field} values={row.effective} unit={unit} />{row.overrides[field] !== null && <> <span className="badge">{t("own")}</span></>}</small></div>)}</td>
              <td>{t("stock", { count: row.stock.upcoming, target: row.stock.target })}<div><small>{t("missing", { count: row.stock.missing })}</small></div><progress value={stock.upcoming} max={Math.max(1, stock.target)} aria-label={t("columns.stock")} /></td>
              <td>{formatDate(row.last_run?.finished_at, locale, true)}<div><small>{t("next")}: {formatDate(row.next_run_at, locale, true)}</small></div></td><td>{researchCost(row.month_cost_micro_usd, locale)}</td>
              <td><button className="button button-secondary button-small" disabled={!overview.defaults || areaEditor !== null} onClick={() => { setAreaSnapshot({ actor: read.operator.email, row }); setAreaEditor(row.area_id); }}>{common("edit")}</button></td></tr>;
          })}</tbody></table></div>}
      </section>
      {areaEditor !== null && defaults && (areaEditor === "new" || editedArea) && <ResearchAreaEditor key={`${read.operator.email}:${areaEditor}`} row={editedArea} defaults={defaults} actor={confirmedActor} manage={manage && overview.defaults !== null && (areaEditor === "new" || area !== null)} limits={overview.limits} reload={reload} close={() => setAreaEditor(null)} />}
      {areaEditor !== null && areaEditor !== "new" && !area && <p className="alert alert-warning">{t("editedRowUnavailable")}</p>}
      <section className="panel research-panel" id="research-sources"><div className="panel-header"><h2>{t("sections.sources")}</h2>{manage && overview.defaults && <button className="button button-primary" disabled={sourceEditor !== null} onClick={() => setSourceEditor("new")}>{t("addSource")}</button>}</div>
        <p>{t("sourcesHint")}</p>{overview.sources.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableRow", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
        {overview.sources.rows.length === 0 && overview.sources.unreadable.length === 0 ? <p>{t("sourcesEmpty")}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>
          {["source", "intervalStock", "robots", "time", "cost", "actions"].map((key) => <th key={key}>{t(`columns.${key}`)}</th>)}</tr></thead><tbody>
          {overview.sources.rows.map((row) => <SourceRow key={row.source_id} row={row} read={{ ...read, manage }} command={runCommand} onEdit={() => { setSourceSnapshot({ actor: read.operator.email, row }); setSourceEditor(row.source_id); }} editing={sourceEditor !== null || !overview.defaults} />)}</tbody></table></div>}
        <ResearchCommandFeedback command={runCommand} />
      </section>
      {sourceEditor !== null && defaults && (sourceEditor === "new" || editedSource) && <ResearchSourceEditor key={`${read.operator.email}:${sourceEditor}`} row={editedSource} defaults={defaults} areas={overview.areas.rows} actor={confirmedActor} manage={manage && overview.defaults !== null && (sourceEditor === "new" || source !== null)} limits={overview.limits} reload={reload} close={() => setSourceEditor(null)} />}
      {sourceEditor !== null && sourceEditor !== "new" && !source && <p className="alert alert-warning">{t("editedRowUnavailable")}</p>}
      <DatesResearchRuns areas={overview.areas.rows} sources={overview.sources.rows} focusRunId={focusRun} refresh={refresh} active={confirmedActor !== ""} />
    </div>}
  </>;
}

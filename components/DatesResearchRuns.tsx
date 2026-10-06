"use client";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { readResearchRun, readResearchRuns } from "@/lib/datesResearchConsole";
import { DATES_RESEARCH_RUN_KINDS, type ResearchArea, type ResearchRunDetail, type ResearchRunList, type ResearchSource } from "@/lib/datesResearchAdmin";
import { researchCost } from "@/lib/datesResearchView";
import { formatDate, formatNumber } from "@/lib/format";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { ResearchHelp } from "@/components/DatesResearchControls";

export default function DatesResearchRuns({ areas, sources, focusRunId, refresh, active = true, onRunFinished }: { areas: ResearchArea[]; sources: ResearchSource[]; focusRunId: string | null; refresh: number; active?: boolean; onRunFinished?: () => Promise<void> | void }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const [source, setSource] = useState(""), [area, setArea] = useState(""), [kind, setKind] = useState("");
  const [cursor, setCursor] = useState<string | null>(null), [previous, setPrevious] = useState<(string | null)[]>([]), [history, setHistory] = useState<ResearchRunList | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResearchRunDetail | null>(null), [detailError, setDetailError] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const generation = useRef(0), detailGeneration = useRef(0), finished = useRef(new Set<string>());
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!active) return;
    const current = ++generation.current; setLoading(true);
    const value = await readResearchRuns(adminCall, { ...(source ? { source_id: source } : {}), ...(area ? { area_id: area } : {}), ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) }, signal);
    if (signal?.aborted || current !== generation.current) return;
    setLoading(false); setError(value === null); if (value) setHistory(value);
  }, [source, area, kind, cursor, active]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); ++generation.current; }; }, [load, refresh]);
  useEffect(() => { if (focusRunId) setRunId(focusRunId); }, [focusRunId]);
  const loadDetail = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!runId || !active) return;
    const current = ++detailGeneration.current; if (!background) setDetailLoading(true);
    const value = await readResearchRun(adminCall, runId, signal);
    if (signal?.aborted || current !== detailGeneration.current) return;
    setDetailLoading(false); setDetailError(value === null); if (value) setDetail(value);
    if (value && !["queued", "running"].includes(value.run.status) && !finished.current.has(value.run.run_id)) {
      finished.current.add(value.run.run_id); await onRunFinished?.();
    }
  }, [runId, active, onRunFinished]);
  useEffect(() => {
    if (!active) return;
    setDetail(null); setDetailError(false);
    if (!runId) return;
    const controller = new AbortController(); void loadDetail(controller.signal); return () => { controller.abort(); ++detailGeneration.current; };
  }, [loadDetail, runId, active]);
  useEffect(() => {
    if (!active || !detail || !["queued", "running"].includes(detail.run.status)) return;
    const controller = new AbortController(), timer = window.setTimeout(() => { void loadDetail(controller.signal, true); void load(controller.signal); }, 10_000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [detail, loadDetail, load, active]);
  function changeFilter(setter: (value: string) => void, value: string) { setCursor(null); setPrevious([]); setHistory(null); setter(value); }
  return <section className="panel research-runs" id="research-runs"><div className="panel-header"><h2>{t("sections.runs")}</h2>
    <button className="button button-secondary" onClick={() => void load()} disabled={loading || !active}>{common("refresh")}</button></div>
    <div className="dates-filter-grid"><label className="field"><span>{t("fields.source")}</span><select value={source} onChange={(event) => changeFilter(setSource, event.target.value)}><option value="">{common("all")}</option>
      {sources.map((row) => <option key={row.source_id} value={row.source_id}>{row.label || row.url}</option>)}</select><ResearchHelp field="source" /></label>
      <label className="field"><span>{t("fields.city")}</span><select value={area} onChange={(event) => changeFilter(setArea, event.target.value)}><option value="">{common("all")}</option>
        {areas.map((row) => <option key={row.area_id} value={row.area_id}>{row.label}</option>)}</select><ResearchHelp field="city" /></label>
      <label className="field"><span>{t("fields.runKind")}</span><select value={kind} onChange={(event) => changeFilter(setKind, event.target.value)}><option value="">{common("all")}</option>
        {DATES_RESEARCH_RUN_KINDS.map((value) => <option key={value} value={value}>{t(`runKinds.${value}`)}</option>)}</select><ResearchHelp field="runKind" /></label></div>
    {error && <ErrorPanel message={t("runsUnreadable")} retry={() => void load()} />}
    {loading && !history ? <LoadingPanel /> : history && <>
      {history.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableRow", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
      {history.rows.length === 0 && history.unreadable.length === 0 ? <p>{t("runsEmpty")}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>
          {["run", "status", "found", "imported", "duplicates", "dropped", "runCost", "runTime"].map((key) => <th key={key}>{t(`columns.${key}`)}</th>)}</tr></thead>
        <tbody>{history.rows.map((row) => <tr key={row.run_id}><td><button type="button" className="button button-secondary button-small" onClick={() => setRunId(row.run_id)}>{t("openRun")}</button>
          <div><small>{row.source_id ? sources.find((value) => value.source_id === row.source_id)?.label || row.source_id : row.area_id ? areas.find((value) => value.area_id === row.area_id)?.label || row.area_id : "—"}</small></div>
          <small>{t(`runKinds.${row.kind}`)} · {t(`runTriggers.${row.trigger}`)}{row.dry_run ? ` · ${t("dryRun")}` : ""}</small></td>
          <td>{t(`runStatuses.${row.status}`)}</td><td>{formatNumber(row.found, locale)}</td><td>{formatNumber(row.imported, locale)}</td><td>{formatNumber(row.duplicates, locale)}</td>
          <td>{row.dropped.map((item) => <div key={item.reason}>{t(`dropReasons.${item.reason}`)}: {formatNumber(item.count, locale)}</div>)}</td><td>{researchCost(row.cost_micro_usd, locale)}</td>
          <td>{formatDate(row.started_at, locale, true)}<div><small>{formatDate(row.finished_at, locale, true)}</small></div></td></tr>)}</tbody></table></div>}
      <div className="row-actions"><button className="button button-secondary button-small" disabled={loading || previous.length === 0} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious((rows) => rows.slice(0, -1)); setHistory(null); }}>{common("previous")}</button>
        <button className="button button-secondary button-small" disabled={loading || history.next_cursor === null} onClick={() => { setPrevious((rows) => [...rows, cursor]); setCursor(history.next_cursor); setHistory(null); }}>{common("next")}</button></div>
    </>}
    {runId && <section className="research-run-detail"><div className="panel-header"><h3>{t("runDetail")}</h3><div className="row-actions">
      <button className="button button-secondary" disabled={detailLoading || !active} onClick={() => void loadDetail()}>{common("refresh")}</button>
      <button className="button button-secondary" onClick={() => { ++detailGeneration.current; setRunId(null); setDetail(null); }}>{common("close")}</button></div></div>
      {detailError && <ErrorPanel message={t("runUnreadable")} retry={() => void loadDetail()} />}
      {detailLoading && !detail ? <LoadingPanel /> : detail && <>
        <p><code>{detail.run.run_id}</code> · {t(`runStatuses.${detail.run.status}`)}{detail.run.dry_run ? ` · ${t("dryRun")}` : ""}</p>
        <p>{t("runCounts", { found: detail.run.found, imported: detail.run.imported, duplicates: detail.run.duplicates, dropped: detail.run.dropped.reduce((sum, row) => sum + row.count, 0) })} · {researchCost(detail.run.cost_micro_usd, locale)}</p>
        {detail.run.dry_run && <p className="alert alert-info">{t("dryRunHint")}</p>}
        {!detail.run.dry_run && <Link className="button button-secondary" href={`/dates/intakes?research_run_id=${encodeURIComponent(detail.run.run_id)}`}>{t("openIntakes")}</Link>}
        {detail.candidates === null ? <p className="alert alert-warning">{t("candidatesUnreadable")}</p> : <>
          {detail.candidates.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableRow", { row: row.index + 1 })}</p>)}
          {detail.candidates.rows.length === 0 && detail.candidates.unreadable.length === 0 ? <p>{t("candidatesEmpty")}</p> : <div className="table-wrap"><table className="data-table"><thead><tr>
            {["candidate", "date", "host", "outcome", "reason", "intake"].map((key) => <th key={key}>{t(`columns.${key}`)}</th>)}</tr></thead><tbody>
            {detail.candidates.rows.map((row, index) => <tr key={index}><td>{row.title}</td><td>{row.date_text}</td><td>{row.url_host}</td><td>{t(`outcomes.${row.outcome}`)}</td><td>{row.reason ? t(`dropReasons.${row.reason}`) : "—"}</td>
              <td>{row.intake_id ? <Link href={`/dates/intakes/${encodeURIComponent(row.intake_id)}`}>{t("columns.intake")}</Link> : "—"}</td></tr>)}</tbody></table></div>}
        </>}
      </>}
    </section>}
  </section>;
}

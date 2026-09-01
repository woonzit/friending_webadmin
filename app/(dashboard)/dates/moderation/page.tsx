"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  datesModerationSla,
  humanizeMachineKey,
  type DatesCaseSummary,
  type DatesModerationSla,
} from "@/lib/datesAdmin";
import { formatDate, formatNumber } from "@/lib/format";

type Filters = {
  queue: string;
  status: string;
  assignee: string;
  search: string;
  slaBreached: boolean;
};

const EMPTY_FILTERS: Filters = { queue: "all", status: "open", assignee: "all", search: "", slaBreached: false };
const PAGE_SIZE = 40;

function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 3600) return `${Math.max(0, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default function DatesModerationQueuePage() {
  const t = useTranslations("datesAdmin.moderation");
  const common = useTranslations("common");
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<DatesCaseSummary[]>([]);
  const [sla, setSla] = useState<DatesModerationSla | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (rows.length === 0) setState("loading");
    const [response, slaResponse] = await Promise.all([
      adminCall("dates_moderation_queue", {
        queue: filters.queue,
        status: filters.status,
        assignee: filters.assignee,
        search: filters.search,
        sla_breached: filters.slaBreached,
        page,
        limit: PAGE_SIZE,
      }, signal),
      adminCall("dates_moderation_sla", {}, signal),
    ]);
    const nextSla = datesModerationSla(slaResponse);
    if (!response?.success || !Array.isArray(response.cases) || !nextSla) {
      if (!signal?.aborted) {
        setSla(null);
        setState("error");
      }
      return;
    }
    setRows(response.cases as DatesCaseSummary[]);
    setTotal(Number(response.total) || 0);
    setSla(nextSla);
    setState("ready");
  }, [filters, page, rows.length]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draft, search: draft.search.trim() });
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>} />
      <DatesAdminTabs />

      {state === "ready" && sla && <div className="stat-grid dates-sla-grid">
        <article className="stat-card"><span className="stat-label">{t("openCases")}</span><strong className="stat-value">{formatNumber(sla.open_count, locale)}</strong></article>
        <article className="stat-card pink"><span className="stat-label">{t("unassigned")}</span><strong className="stat-value">{formatNumber(sla.unassigned_count, locale)}</strong><small className="dates-stat-note">{sla.oldest_unassigned_at ? t("oldest", { date: formatDate(sla.oldest_unassigned_at, locale, true) }) : t("noneWaiting")}</small></article>
        <article className="stat-card"><span className="stat-label">{t("slaBreaches")}</span><strong className="stat-value dates-danger-text">{formatNumber(sla.sla_breach_count, locale)}</strong></article>
        <article className="stat-card"><span className="stat-label">{t("appealsWaiting")}</span><strong className="stat-value">{formatNumber(sla.appeals_waiting, locale)}</strong></article>
        <article className="stat-card green"><span className="stat-label">{t("medianClaim")}</span><strong className="stat-value">{duration(sla.median_seconds_to_claim)}</strong></article>
        <article className="stat-card green"><span className="stat-label">{t("medianResolve")}</span><strong className="stat-value">{duration(sla.median_seconds_to_resolve)}</strong></article>
      </div>}

      <form className="dates-filter-grid" onSubmit={apply}>
        <label className="field"><span>{t("queue")}</span><select value={draft.queue} onChange={(event) => setDraft((value) => ({ ...value, queue: event.target.value }))}>{["all", "activities", "users", "messages", "reviews", "appeals"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`queues.${value}`)}</option>)}</select></label>
        <label className="field"><span>{common("status")}</span><select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>{["open", "all", "new", "in_review", "actioned", "dismissed", "appealed", "closed"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`statuses.${value}`)}</option>)}</select></label>
        <label className="field"><span>{t("assignee")}</span><select value={draft.assignee} onChange={(event) => setDraft((value) => ({ ...value, assignee: event.target.value }))}><option value="all">{common("all")}</option><option value="mine">{t("mine")}</option><option value="unassigned">{t("unassigned")}</option></select></label>
        <label className="field dates-search-field"><span>{t("searchLabel")}</span><input maxLength={96} value={draft.search} placeholder={t("searchPlaceholder")} onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={draft.slaBreached} onChange={(event) => setDraft((value) => ({ ...value, slaBreached: event.target.checked }))} /><span>{t("onlyBreached")}</span></label>
        <div className="row-actions dates-filter-actions"><button className="button button-primary" type="submit">{t("apply")}</button><button className="button button-secondary" type="button" onClick={reset}>{t("reset")}</button></div>
      </form>

      {state === "loading" ? <LoadingPanel /> : state === "error" ? <ErrorPanel message={t("loadError")} retry={() => void load()} /> : <>
        <div className="list-summary"><strong>{t("resultCount", { count: total })}</strong><span>{t("page", { page })}</span></div>
        <div className="table-wrap">{rows.length === 0 ? <div className="empty-state"><div className="empty-state-inner"><h3>{t("empty")}</h3><p>{t("emptyCopy")}</p></div></div> : <table className="data-table dates-case-table">
          <thead><tr><th>{t("case")}</th><th>{t("target")}</th><th>{common("status")}</th><th>{t("severity")}</th><th>{t("reports")}</th><th>{t("assignee")}</th><th>{t("sla")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.case_id} className={row.sla_breached ? "dates-row-breached" : ""}>
            <td><div className="cell-stack"><strong>{row.case_id}</strong><small>{t(`queues.${row.queue}`)} · {humanizeMachineKey(row.case_kind)}</small>{row.conflict_of_interest && <small className="dates-danger-text">{t("conflict")}</small>}</div></td>
            <td><div className="cell-stack"><span>{humanizeMachineKey(row.target_type)} · {row.target_id}</span><small>{row.activity_id || `UID ${row.target_uid}`}</small></div></td>
            <td><span className={`badge ${row.status === "new" || row.status === "in_review" ? "badge-warning" : ""}`}>{t(`statuses.${row.status}`)}</span></td>
            <td><span className={`badge ${row.severity === "high" || row.severity === "critical" ? "badge-warning" : ""}`}>{humanizeMachineKey(row.severity)}</span>{row.escalated && <small className="table-subline dates-danger-text">{t("escalated")}</small>}</td>
            <td>{row.report_count}<small className="table-subline">{t("distinct", { count: row.distinct_reporter_count })}</small></td>
            <td>{row.assignee_email || t("unassigned")}</td>
            <td>{row.sla_due_at ? formatDate(row.sla_due_at, locale, true) : "—"}{row.sla_breached && <small className="table-subline dates-danger-text">{t("breached")}</small>}</td>
            <td><Link className="button button-secondary button-small" href={`/dates/moderation/${encodeURIComponent(row.case_id)}`}>{common("view")}</Link></td>
          </tr>)}</tbody>
        </table>}</div>
        <div className="pagination"><span>{formatNumber(total, locale)}</span><div className="pagination-buttons"><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{common("previous")}</button><button className="button button-secondary button-small" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>{common("next")}</button></div></div>
      </>}
    </>
  );
}

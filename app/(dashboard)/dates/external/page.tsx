"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesExternalReviewMark from "@/components/DatesExternalReviewMark";
import DatesIntakeSourceEntry from "@/components/DatesIntakeSourceEntry";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { DATES_EXTERNAL_CATEGORIES, datesExternalTimeFromInput } from "@/lib/datesExternalInput";
import { DATES_EXTERNAL_CHANNELS, DATES_EXTERNAL_STATUSES, DATES_EXTERNAL_TIERS,
  decodeDatesExternalList, type DatesCommandOutcome, type DatesExternalList } from "@/lib/datesExternalAdmin";
import { datesExternalReviewRefusalKey } from "@/lib/datesExternalReview";
import { formatDate, formatNumber } from "@/lib/format";

type Filters = { status: string; tier: string; category: string; channel: string; city: string; query: string; startFrom: string; startTo: string; reviewed: string };
const EMPTY_FILTERS: Filters = { status: "", tier: "", category: "", channel: "", city: "", query: "", startFrom: "", startTo: "", reviewed: "" };
/** D-149 W1: what the AI published and nobody has looked at yet. */
const RESEARCH_UNREVIEWED: Filters = { ...EMPTY_FILTERS, status: "published", channel: "ai_research", reviewed: "false" };
const REVIEWED_VALUES = ["true", "false"] as const;
const PAGE_SIZE = 40;

export default function DatesExternalEventsPage() {
  const t = useTranslations("datesAdmin.external");
  const common = useTranslations("common");
  const locale = useLocale();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DatesExternalList | null>(null);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [filterError, setFilterError] = useState(false);
  const [reviewOutcome, setReviewOutcome] = useState<DatesCommandOutcome | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const generation = ++loadGeneration.current;
    setState("loading");
    const body: Record<string, unknown> = { status: filters.status, tier: filters.tier, category: filters.category,
      channel: filters.channel, city: filters.city, query: filters.query, page, limit: PAGE_SIZE };
    // D-149: served with the external admin contract selector v2; empty (both) is not sent.
    if (filters.reviewed) body.reviewed = filters.reviewed;
    if (filters.startFrom) body.start_from = datesExternalTimeFromInput(filters.startFrom, "+00:00", "UTC");
    if (filters.startTo) body.start_to = datesExternalTimeFromInput(filters.startTo, "+00:00", "UTC");
    const [response, identity] = await Promise.all([
      adminCall("dates_external_event_list", body, signal), adminCall("admin_me", {}, signal),
    ]);
    if (signal?.aborted || generation !== loadGeneration.current) return;
    const decoded = decodeDatesExternalList(response, { page, limit: PAGE_SIZE });
    const nextPrincipal = datesAdminPrincipal(identity);
    if (!decoded || !nextPrincipal || !hasDatesCapability(nextPrincipal, "dates_external_event_read")) {
      setData(null); setPrincipal(null); setState("error"); return;
    }
    setData(decoded); setPrincipal(nextPrincipal); setState("ready");
  }, [filters, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); ++loadGeneration.current; };
  }, [load]);

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const from = draft.startFrom ? datesExternalTimeFromInput(draft.startFrom, "+00:00", "UTC") : null;
    const to = draft.startTo ? datesExternalTimeFromInput(draft.startTo, "+00:00", "UTC") : null;
    if ((draft.startFrom && from === null) || (draft.startTo && to === null) || (from !== null && to !== null && from > to)) {
      setFilterError(true); return;
    }
    setFilterError(false); setPage(1); setFilters({ ...draft, city: draft.city.trim(), query: draft.query.trim() });
  }
  const canCreate = state === "ready" && principal && hasDatesCapability(principal, "dates_external_event_manage")
    && data?.capabilities.includes("dates_external_event_manage");
  const canManage = canCreate === true;
  // The review columns exist only when Core served them (v2); a released Core keeps the released table.
  const reviewServed = data?.events.some((row) => row.admin_review !== undefined) ?? false;
  const quickView = JSON.stringify(filters) === JSON.stringify(RESEARCH_UNREVIEWED);
  const totalPages = data ? Math.max(page, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")}
      actions={<div className="row-actions"><button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>
        {canCreate && <Link className="button button-primary" href="/dates/external/new">{t("create")}</Link>}</div>} />
    <DatesAdminTabs />
    <DatesIntakeSourceEntry />
    <div className="row-actions dates-quick-views"><span>{t("review.quickViews")}</span>
      <button type="button" className={`button button-small ${quickView ? "button-primary" : "button-secondary"}`} aria-pressed={quickView} onClick={() => {
        setDraft(RESEARCH_UNREVIEWED); setFilters(RESEARCH_UNREVIEWED); setPage(1); setFilterError(false);
      }}>{t("review.researchUnreviewed")}</button></div>
    <form className="dates-filter-grid" onSubmit={apply}>
      {(["query", "city"] as const).map((key) => <label className="field" key={key}><span>{t(`filters.${key}`)}</span><input value={draft[key]} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      {([["status", DATES_EXTERNAL_STATUSES], ["tier", DATES_EXTERNAL_TIERS], ["category", DATES_EXTERNAL_CATEGORIES], ["channel", DATES_EXTERNAL_CHANNELS]] as const).map(([key, values]) =>
        <label className="field" key={key}><span>{t(`filters.${key}`)}</span><select value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}>
          <option value="">{common("all")}</option>{values.map((value) => <option key={value} value={value}>{key === "category" ? t(`form.categories.${value}`) : t(`${key}Values.${value}`)}</option>)}
        </select></label>)}
      <label className="field"><span>{t("filters.reviewed")}</span><select value={draft.reviewed} onChange={(event) => setDraft((current) => ({ ...current, reviewed: event.target.value }))}>
        <option value="">{common("all")}</option>{REVIEWED_VALUES.map((value) => <option key={value} value={value}>{t(`review.filterValues.${value}`)}</option>)}</select></label>
      {(["startFrom", "startTo"] as const).map((key) => <label className="field" key={key}><span>{t(`filters.${key}`)}</span><input type="datetime-local" step={1} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      <div className="row-actions"><button className="button button-primary" type="submit">{t("apply")}</button><button className="button button-secondary" type="button" onClick={() => {
        setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); setFilterError(false);
      }}>{t("reset")}</button></div>
    </form>
    {filterError && <p className="alert alert-error" role="alert">{t("filterError")}</p>}
    {reviewOutcome && reviewOutcome.kind !== "success" && <p className="alert alert-error" role="status">{reviewOutcome.kind === "uncertain" ? t("review.uncertain")
      : t(`review.refusals.${datesExternalReviewRefusalKey(reviewOutcome.error)}`)}</p>}
    {state === "loading" ? <LoadingPanel /> : state === "error" || !data ? <ErrorPanel message={t("loadError")} retry={() => void load()} /> : <>
      <p className="field-hint">{t("operatorCounts")}</p>
      {data.events.length === 0 ? <section className="panel"><p>{t(data.total === 0 ? "empty" : "emptyPage")}</p></section> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("columns.event")}</th><th>{t("columns.status")}</th>{reviewServed && <th>{t("columns.reviewed")}</th>}<th>{t("columns.venue")}</th><th>{t("columns.start")}</th><th>{t("columns.counts")}</th><th>{t("columns.recheck")}</th></tr></thead>
        <tbody>{data.events.map((row) => <tr key={row.external_event_id}>
          <td><Link href={`/dates/external/${row.external_event_id}`}>{row.title}</Link><div><span className="badge badge-demo">{t("badge")}</span>{row.ai_assisted && <span className="badge badge-warning">{t("aiBadge")}</span>}
            {row.possible_duplicate_of && <Link className="badge badge-warning" href={`/dates/external/${row.possible_duplicate_of}`} title={t("review.duplicateHint")}>{t("review.duplicate")}</Link>}</div><small>{row.organizer_name}</small>
            {(row.open_corrections ?? 0) > 0 && <div><Link href="/dates/corrections"><small>{t("review.openCorrections", { count: row.open_corrections ?? 0 })}</small></Link></div>}
            {(row.open_reports ?? 0) > 0 && <div><Link href={`/dates/${row.activity_id}`}><small>{t("review.openReports", { count: row.open_reports ?? 0 })}</small></Link></div>}</td>
          <td>{t(`statusValues.${row.status}`)}<div><small>{t(`tierValues.${row.verification_tier}`)}</small></div></td>
          {reviewServed && <td>{row.admin_review ? <DatesExternalReviewMark target={row} review={row.admin_review} canManage={canManage} compact
            onSettled={async (outcome) => { setReviewOutcome(outcome.kind === "success" ? null : outcome); await load(); }} /> : "—"}</td>}
          <td>{row.venue_name}<div><small>{row.city} · {row.country_code}</small></div></td>
          <td><time dateTime={row.start_local}>{new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "medium", timeStyle: "short" }).format(row.start_at * 1000)}</time><div><small>{row.timezone}</small></div></td>
          <td>{t("counts", { going: formatNumber(row.going_count, locale), interested: formatNumber(row.interested_count, locale) })}</td>
          <td>{formatDate(row.next_reverify_at, locale, true)}
            {row.last_recheck && <div><small>{t("review.lastRecheck", { status: t(`recheck.statuses.${row.last_recheck.status}`) })}</small></div>}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="pagination"><span>{t("pagination", { page, pages: totalPages, total: data.total })}</span><div className="row-actions">
        <button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t("previous")}</button>
        <button className="button button-secondary button-small" disabled={page >= totalPages || page >= 10000} onClick={() => setPage((current) => current + 1)}>{t("next")}</button>
      </div></div>
    </>}
  </>;
}

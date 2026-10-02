"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesIntakeSourceEntry from "@/components/DatesIntakeSourceEntry";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { DATES_EXTERNAL_CATEGORIES, datesExternalTimeFromInput } from "@/lib/datesExternalInput";
import { DATES_EXTERNAL_CHANNELS, DATES_EXTERNAL_STATUSES, DATES_EXTERNAL_TIERS,
  decodeDatesExternalList, type DatesExternalList } from "@/lib/datesExternalAdmin";
import { formatDate, formatNumber } from "@/lib/format";

type Filters = { status: string; tier: string; category: string; channel: string; city: string; query: string; startFrom: string; startTo: string };
const EMPTY_FILTERS: Filters = { status: "", tier: "", category: "", channel: "", city: "", query: "", startFrom: "", startTo: "" };
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
  const loadGeneration = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const generation = ++loadGeneration.current;
    setState("loading");
    const body: Record<string, unknown> = { status: filters.status, tier: filters.tier, category: filters.category,
      channel: filters.channel, city: filters.city, query: filters.query, page, limit: PAGE_SIZE };
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
  const totalPages = data ? Math.max(page, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")}
      actions={<div className="row-actions"><button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>
        {canCreate && <Link className="button button-primary" href="/dates/external/new">{t("create")}</Link>}</div>} />
    <DatesAdminTabs />
    <DatesIntakeSourceEntry />
    <form className="dates-filter-grid" onSubmit={apply}>
      {(["query", "city"] as const).map((key) => <label className="field" key={key}><span>{t(`filters.${key}`)}</span><input value={draft[key]} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      {([["status", DATES_EXTERNAL_STATUSES], ["tier", DATES_EXTERNAL_TIERS], ["category", DATES_EXTERNAL_CATEGORIES], ["channel", DATES_EXTERNAL_CHANNELS]] as const).map(([key, values]) =>
        <label className="field" key={key}><span>{t(`filters.${key}`)}</span><select value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}>
          <option value="">{common("all")}</option>{values.map((value) => <option key={value} value={value}>{key === "category" ? t(`form.categories.${value}`) : t(`${key}Values.${value}`)}</option>)}
        </select></label>)}
      {(["startFrom", "startTo"] as const).map((key) => <label className="field" key={key}><span>{t(`filters.${key}`)}</span><input type="datetime-local" step={1} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      <div className="row-actions"><button className="button button-primary" type="submit">{t("apply")}</button><button className="button button-secondary" type="button" onClick={() => {
        setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); setFilterError(false);
      }}>{t("reset")}</button></div>
    </form>
    {filterError && <p className="alert alert-error" role="alert">{t("filterError")}</p>}
    {state === "loading" ? <LoadingPanel /> : state === "error" || !data ? <ErrorPanel message={t("loadError")} retry={() => void load()} /> : <>
      <p className="field-hint">{t("operatorCounts")}</p>
      {data.events.length === 0 ? <section className="panel"><p>{t(data.total === 0 ? "empty" : "emptyPage")}</p></section> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("columns.event")}</th><th>{t("columns.status")}</th><th>{t("columns.venue")}</th><th>{t("columns.start")}</th><th>{t("columns.counts")}</th><th>{t("columns.recheck")}</th></tr></thead>
        <tbody>{data.events.map((row) => <tr key={row.external_event_id}>
          <td><Link href={`/dates/external/${row.external_event_id}`}>{row.title}</Link><div><span className="badge badge-demo">{t("badge")}</span></div><small>{row.organizer_name}</small></td>
          <td>{t(`statusValues.${row.status}`)}<div><small>{t(`tierValues.${row.verification_tier}`)}</small></div></td>
          <td>{row.venue_name}<div><small>{row.city} · {row.country_code}</small></div></td>
          <td><time dateTime={row.start_local}>{new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "medium", timeStyle: "short" }).format(row.start_at * 1000)}</time><div><small>{row.timezone}</small></div></td>
          <td>{t("counts", { going: formatNumber(row.going_count, locale), interested: formatNumber(row.interested_count, locale) })}</td>
          <td>{formatDate(row.next_reverify_at, locale, true)}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="pagination"><span>{t("pagination", { page, pages: totalPages, total: data.total })}</span><div className="row-actions">
        <button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t("previous")}</button>
        <button className="button button-secondary button-small" disabled={page >= totalPages || page >= 10000} onClick={() => setPage((current) => current + 1)}>{t("next")}</button>
      </div></div>
    </>}
  </>;
}

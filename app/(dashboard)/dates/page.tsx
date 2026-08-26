"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { epochFromLocalInput, humanizeMachineKey, normalizeDatesPrincipal, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { formatDate, formatNumber } from "@/lib/format";

type ActivityRow = {
  activity_id: string;
  title: string;
  activity_type: string;
  host: { uid: number; display_name: string };
  lifecycle: string;
  moderation_state: string;
  pending_public_moderation_state: string | null;
  time_mode: string;
  start_at: number | null;
  end_at: number | null;
  location_mode: string;
  city: string | null;
  country_code: string | null;
  join_mode: string;
  maximum_people: number | null;
  going_count: number;
  pending_count: number;
  report_count: number;
  soft_deleted: boolean;
  revision: number;
  created_at: number;
  updated_at: number;
};

type Filters = {
  search: string;
  lifecycle: string;
  moderation: string;
  deleted: string;
  activityType: string;
  timeMode: string;
  locationMode: string;
  city: string;
  joinMode: string;
  capacityState: string;
  hostUid: string;
  goingMin: string;
  goingMax: string;
  pendingMin: string;
  pendingMax: string;
  reportMin: string;
  reportMax: string;
  maximumMin: string;
  maximumMax: string;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  timeFrom: string;
  timeTo: string;
  sort: string;
  direction: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  lifecycle: "all",
  moderation: "all",
  deleted: "no",
  activityType: "all",
  timeMode: "all",
  locationMode: "all",
  city: "",
  joinMode: "all",
  capacityState: "all",
  hostUid: "",
  goingMin: "",
  goingMax: "",
  pendingMin: "",
  pendingMax: "",
  reportMin: "",
  reportMax: "",
  maximumMin: "",
  maximumMax: "",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: "",
  timeFrom: "",
  timeTo: "",
  sort: "updated_at",
  direction: "desc",
};
const PAGE_SIZE = 40;

function badgeClass(value: string, warning = false): string {
  if (warning || ["pending", "reported", "canceled", "soft_deleted"].includes(value)) return "badge badge-warning";
  if (["active", "ok", "approved", "scheduled"].includes(value)) return "badge badge-active";
  return "badge";
}

export default function DatesActivitiesPage() {
  const t = useTranslations("datesAdmin.activities");
  const common = useTranslations("common");
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (rows.length === 0) setState("loading");
    const payload: Record<string, unknown> = {
      search: filters.search,
      lifecycle: filters.lifecycle,
      moderation_state: filters.moderation,
      deleted: filters.deleted,
      activity_type: filters.activityType,
      time_mode: filters.timeMode,
      location_mode: filters.locationMode,
      join_mode: filters.joinMode,
      capacity_state: filters.capacityState,
      sort: filters.sort,
      direction: filters.direction,
      page,
      limit: PAGE_SIZE,
    };
    const textFilters: Array<[keyof Filters, string]> = [["city", "city"], ["hostUid", "host_uid"], ["goingMin", "going_min"], ["goingMax", "going_max"], ["pendingMin", "pending_min"], ["pendingMax", "pending_max"], ["reportMin", "report_min"], ["reportMax", "report_max"], ["maximumMin", "maximum_min"], ["maximumMax", "maximum_max"]];
    for (const [source, target] of textFilters) {
      if (filters[source].trim() !== "") payload[target] = filters[source].trim();
    }
    const dateFilters: Array<[keyof Filters, string]> = [["createdFrom", "created_from"], ["createdTo", "created_to"], ["updatedFrom", "updated_from"], ["updatedTo", "updated_to"], ["timeFrom", "time_from"], ["timeTo", "time_to"]];
    for (const [source, target] of dateFilters) {
      const epoch = epochFromLocalInput(filters[source]);
      if (epoch) payload[target] = epoch;
    }
    const [response, identity] = await Promise.all([
      adminCall("dates_activity_list", payload, signal),
      adminCall("admin_me", {}, signal),
    ]);
    if (!response?.success || !Array.isArray(response.activities)) {
      if (!signal?.aborted) setState("error");
      return;
    }
    setRows(response.activities as ActivityRow[]);
    setTotal(Number(response.total) || 0);
    setPrincipal(normalizeDatesPrincipal(identity?.dates));
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
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={principal && <span className="badge badge-demo">{t(`roles.${principal.role}`)}</span>}
      />
      <DatesAdminTabs />
      <form className="dates-filter-grid" onSubmit={apply}>
        <label className="field dates-search-field">
          <span>{t("searchLabel")}</span>
          <input value={draft.search} maxLength={100} placeholder={t("searchPlaceholder")} onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))} />
        </label>
        <label className="field">
          <span>{t("lifecycle")}</span>
          <select value={draft.lifecycle} onChange={(event) => setDraft((value) => ({ ...value, lifecycle: event.target.value }))}>
            {["all", "draft", "active", "ended", "canceled"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}
          </select>
        </label>
        <label className="field"><span>{t("locationMode")}</span><select value={draft.locationMode} onChange={(event) => setDraft((value) => ({ ...value, locationMode: event.target.value }))}>{["all", "live", "exact", "city"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}</select></label>
        <label className="field"><span>{t("joinMode")}</span><select value={draft.joinMode} onChange={(event) => setDraft((value) => ({ ...value, joinMode: event.target.value }))}>{["all", "auto", "approval"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}</select></label>
        <label className="field">
          <span>{t("moderation")}</span>
          <select value={draft.moderation} onChange={(event) => setDraft((value) => ({ ...value, moderation: event.target.value }))}>
            {["all", "ok", "pending", "approved", "rejected", "removed", "appealed"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("deleted")}</span>
          <select value={draft.deleted} onChange={(event) => setDraft((value) => ({ ...value, deleted: event.target.value }))}>
            <option value="all">{common("all")}</option><option value="no">{common("no")}</option><option value="yes">{common("yes")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("activityType")}</span>
          <select value={draft.activityType} onChange={(event) => setDraft((value) => ({ ...value, activityType: event.target.value }))}>
            {["all", "sport", "date", "travel", "hangout"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("timeMode")}</span>
          <select value={draft.timeMode} onChange={(event) => setDraft((value) => ({ ...value, timeMode: event.target.value }))}>
            {["all", "scheduled", "now", "tbd"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`values.${value}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("sort")}</span>
          <select value={draft.sort} onChange={(event) => setDraft((value) => ({ ...value, sort: event.target.value }))}>
            {["updated_at", "created_at", "start_at", "going_count", "pending_count", "report_count", "title"].map((value) => <option key={value} value={value}>{t(`sortValues.${value}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("direction")}</span>
          <select value={draft.direction} onChange={(event) => setDraft((value) => ({ ...value, direction: event.target.value }))}>
            <option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option>
          </select>
        </label>
        <div className="row-actions dates-filter-actions">
          <button className="button button-primary" type="submit">{t("apply")}</button>
          <button className="button button-secondary" type="button" onClick={reset}>{t("reset")}</button>
        </div>
        <details className="dates-advanced-filters">
          <summary>{t("advancedFilters")}</summary>
          <div className="dates-advanced-filter-grid">
            <label className="field"><span>{t("city")}</span><input maxLength={120} value={draft.city} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} /></label>
            <label className="field"><span>{t("hostUid")}</span><input type="number" min={1} value={draft.hostUid} onChange={(event) => setDraft((value) => ({ ...value, hostUid: event.target.value }))} /></label>
            <label className="field"><span>{t("capacity")}</span><select value={draft.capacityState} onChange={(event) => setDraft((value) => ({ ...value, capacityState: event.target.value }))}><option value="all">{common("all")}</option><option value="open">{t("values.open")}</option><option value="full">{t("values.full")}</option></select></label>
            <RangeFields label={t("goingRange")} minimum={draft.goingMin} maximum={draft.goingMax} onMinimum={(goingMin) => setDraft((value) => ({ ...value, goingMin }))} onMaximum={(goingMax) => setDraft((value) => ({ ...value, goingMax }))} />
            <RangeFields label={t("pendingRange")} minimum={draft.pendingMin} maximum={draft.pendingMax} onMinimum={(pendingMin) => setDraft((value) => ({ ...value, pendingMin }))} onMaximum={(pendingMax) => setDraft((value) => ({ ...value, pendingMax }))} />
            <RangeFields label={t("reportRange")} minimum={draft.reportMin} maximum={draft.reportMax} onMinimum={(reportMin) => setDraft((value) => ({ ...value, reportMin }))} onMaximum={(reportMax) => setDraft((value) => ({ ...value, reportMax }))} />
            <RangeFields label={t("maximumRange")} minimum={draft.maximumMin} maximum={draft.maximumMax} onMinimum={(maximumMin) => setDraft((value) => ({ ...value, maximumMin }))} onMaximum={(maximumMax) => setDraft((value) => ({ ...value, maximumMax }))} />
            <DateRangeFields label={t("createdRange")} from={draft.createdFrom} to={draft.createdTo} onFrom={(createdFrom) => setDraft((value) => ({ ...value, createdFrom }))} onTo={(createdTo) => setDraft((value) => ({ ...value, createdTo }))} />
            <DateRangeFields label={t("updatedRange")} from={draft.updatedFrom} to={draft.updatedTo} onFrom={(updatedFrom) => setDraft((value) => ({ ...value, updatedFrom }))} onTo={(updatedTo) => setDraft((value) => ({ ...value, updatedTo }))} />
            <DateRangeFields label={t("activityTimeRange")} from={draft.timeFrom} to={draft.timeTo} onFrom={(timeFrom) => setDraft((value) => ({ ...value, timeFrom }))} onTo={(timeTo) => setDraft((value) => ({ ...value, timeTo }))} />
          </div>
        </details>
      </form>

      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={() => void load()} />
      ) : (
        <>
          <div className="list-summary"><strong>{t("resultCount", { count: total })}</strong><span>{t("page", { page })}</span></div>
          <div className="table-wrap">
            {rows.length === 0 ? <div className="empty-state"><div className="empty-state-inner"><h3>{t("empty")}</h3><p>{t("emptyCopy")}</p></div></div> : (
              <table className="data-table dates-activity-table">
                <thead><tr><th>{t("activity")}</th><th>{t("host")}</th><th>{t("state")}</th><th>{t("schedule")}</th><th>{t("attendance")}</th><th>{t("reports")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.activity_id}>
                    <td><div className="cell-stack"><strong>{row.title || t("untitled")}</strong><small>{row.activity_id} · {t(`values.${row.activity_type}`)}</small><small>{[row.city, row.country_code].filter(Boolean).join(", ") || "—"}</small></div></td>
                    <td><div className="cell-stack"><span>{row.host?.display_name || `#${row.host?.uid || 0}`}</span><small>UID {row.host?.uid || 0}</small></div></td>
                    <td><div className="cell-stack"><span className={badgeClass(row.lifecycle, row.soft_deleted)}>{row.soft_deleted ? t("softDeleted") : t(`values.${row.lifecycle}`)}</span><span className={badgeClass(row.moderation_state)}>{t(`values.${row.moderation_state}`)}</span></div></td>
                    <td><div className="cell-stack"><span>{t(`values.${row.time_mode}`)}</span><small>{row.start_at ? formatDate(row.start_at, locale, true) : "—"}</small></div></td>
                    <td>{row.going_count}{row.maximum_people ? ` / ${row.maximum_people}` : ""}<small className="table-subline">{t("pendingCount", { count: row.pending_count })}</small></td>
                    <td><span className={badgeClass(row.report_count > 0 ? "reported" : "ok")}>{formatNumber(row.report_count, locale)}</span></td>
                    <td><Link className="button button-secondary button-small" href={`/dates/${encodeURIComponent(row.activity_id)}`}>{common("view")}</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="pagination"><span>{formatNumber(total, locale)}</span><div className="pagination-buttons"><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{common("previous")}</button><button className="button button-secondary button-small" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>{common("next")}</button></div></div>
        </>
      )}
    </>
  );
}

function RangeFields({ label, minimum, maximum, onMinimum, onMaximum }: { label: string; minimum: string; maximum: string; onMinimum: (value: string) => void; onMaximum: (value: string) => void }) {
  return <fieldset className="dates-range-field"><legend>{label}</legend><input type="number" min={0} value={minimum} aria-label={`${label} 1`} onChange={(event) => onMinimum(event.target.value)} /><span>–</span><input type="number" min={0} value={maximum} aria-label={`${label} 2`} onChange={(event) => onMaximum(event.target.value)} /></fieldset>;
}

function DateRangeFields({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void }) {
  return <fieldset className="dates-range-field dates-date-range"><legend>{label}</legend><input type="datetime-local" value={from} aria-label={`${label} 1`} onChange={(event) => onFrom(event.target.value)} /><span>–</span><input type="datetime-local" value={to} aria-label={`${label} 2`} onChange={(event) => onTo(event.target.value)} /></fieldset>;
}

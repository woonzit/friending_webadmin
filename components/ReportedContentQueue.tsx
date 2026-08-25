"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import {
  REPORTED_CONTENT_CONTRACT_VERSION,
  REPORTED_CONTENT_PAGE_SIZE,
  REPORTED_CONTENT_STATUS_FILTERS,
  REPORTED_CONTENT_TARGET_FILTERS,
  reportedContentCanDecide,
  reportedContentListResponse,
  reportedContentReportsAreOrdered,
  type ReportedContentListData,
  type ReportedContentPrincipal,
  type ReportedContentReport,
  type ReportedContentStatusFilter,
  type ReportedContentTargetFilter,
} from "@/lib/reportedContent";

function principalsMatch(
  left: ReportedContentPrincipal | null,
  right: ReportedContentPrincipal,
): boolean {
  return left === null || (
    left.role === right.role
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability, index) => capability === right.capabilities[index])
  );
}

function identityLabel(report: ReportedContentReport, side: "reporter" | "subject"): string {
  const identity = report[side];
  return identity.display_name || identity.username || `#${identity.uid}`;
}

export default function ReportedContentQueue() {
  const t = useTranslations("reportedContent.queue");
  const common = useTranslations("common");
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState<ReportedContentStatusFilter>("pending");
  const [targetFilter, setTargetFilter] = useState<ReportedContentTargetFilter>("all");
  const [rows, setRows] = useState<ReportedContentReport[]>([]);
  const [principal, setPrincipal] = useState<ReportedContentPrincipal | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const rowsRef = useRef<ReportedContentReport[]>([]);
  const principalRef = useRef<ReportedContentPrincipal | null>(null);
  const requestGeneration = useRef(0);

  const adopt = useCallback((data: ReportedContentListData, append: boolean): boolean => {
    if (
      data.filter.status !== statusFilter
      || data.filter.target_type !== targetFilter
      || data.filter.report_id !== null
      || !principalsMatch(principalRef.current, data.principal)
    ) return false;

    const nextRows = append ? [...rowsRef.current, ...data.reports] : data.reports;
    if (
      new Set(nextRows.map((row) => row.report_id)).size !== nextRows.length
      || !reportedContentReportsAreOrdered(nextRows, statusFilter)
      || nextRows.length > data.total
      || (data.next_cursor === null && nextRows.length !== data.total)
    ) return false;
    rowsRef.current = nextRows;
    principalRef.current = data.principal;
    setRows(nextRows);
    setPrincipal(data.principal);
    setTotal(data.total);
    setNextCursor(data.next_cursor);
    setState("ready");
    return true;
  }, [statusFilter, targetFilter]);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (append) setLoadingMore(true);
    else setState("loading");
    const response = await adminCall("moderation_reported_list", {
      contract_version: REPORTED_CONTENT_CONTRACT_VERSION,
      status: statusFilter,
      target_type: targetFilter,
      page_size: REPORTED_CONTENT_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    if (requestGeneration.current !== generation) return;
    setLoadingMore(false);
    const parsed = reportedContentListResponse(response);
    if (!parsed || !adopt(parsed, append)) setState("error");
  }, [adopt, statusFilter, targetFilter]);

  useEffect(() => {
    rowsRef.current = [];
    principalRef.current = null;
    setRows([]);
    setPrincipal(null);
    setTotal(0);
    setNextCursor(null);
    setLoadingMore(false);
    void load(null, false);
  }, [load]);

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !principal) {
    return <ErrorPanel message={t("loadError")} retry={() => void load(null, false)} />;
  }

  const canDecide = reportedContentCanDecide(principal);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button className="button button-secondary" onClick={() => void load(null, false)}>
            {common("refresh")}
          </button>
        }
      />

      <section className="panel reported-content-filter-panel">
        <div className="panel-body">
          <div className="reported-content-filters">
            <label className="field">
              <span>{common("status")}</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ReportedContentStatusFilter)}
              >
                {REPORTED_CONTENT_STATUS_FILTERS.map((value) => (
                  <option value={value} key={value}>{t(`statuses.${value}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("targetFilter")}</span>
              <select
                value={targetFilter}
                onChange={(event) => setTargetFilter(event.target.value as ReportedContentTargetFilter)}
              >
                {REPORTED_CONTENT_TARGET_FILTERS.map((value) => (
                  <option value={value} key={value}>{t(`targets.${value}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="reported-content-summary">
            <strong>{formatNumber(total, locale)}</strong>
            <span>{t("matchingReports")}</span>
            <small>{canDecide ? t("decisionAccess") : t("readOnlyAccess")}</small>
          </div>
        </div>
      </section>

      <section className="panel reported-content-queue-panel">
        <div className="panel-header">
          <div><h2>{t("queueTitle")}</h2><p>{t("queueCopy")}</p></div>
          <span className="badge">{t("loaded", { count: rows.length })}</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-inner"><h3>{t("emptyTitle")}</h3><p>{t("emptyCopy")}</p></div>
          </div>
        ) : (
          <div className="table-wrap reported-content-table-wrap">
            <table className="data-table reported-content-table">
              <thead>
                <tr>
                  <th>{t("subject")}</th>
                  <th>{t("reporter")}</th>
                  <th>{t("target")}</th>
                  <th>{t("reason")}</th>
                  <th>{common("status")}</th>
                  <th>{common("createdAt")}</th>
                  <th>{common("actions")}</th>
                </tr>
              </thead>
              <tbody>{rows.map((report) => (
                <tr key={report.report_id}>
                  <td data-label={t("subject")}>
                    <div className="cell-stack"><strong>{identityLabel(report, "subject")}</strong><small>{t("uid", { uid: report.subject.uid })}</small></div>
                  </td>
                  <td data-label={t("reporter")}>
                    <div className="cell-stack"><span>{identityLabel(report, "reporter")}</span><small>{t("uid", { uid: report.reporter.uid })}</small></div>
                  </td>
                  <td data-label={t("target")}><span className="badge">{t(`targets.${report.target_type}`)}</span></td>
                  <td data-label={t("reason")}><div className="cell-stack"><code>{report.reason_code}</code><small>{report.reason_text || t("noReasonText")}</small></div></td>
                  <td data-label={common("status")}><span className={`badge reported-status status-${report.status}`}>{t(`statuses.${report.status}`)}</span></td>
                  <td data-label={common("createdAt")}>{formatDate(report.created_at, locale, true)}</td>
                  <td data-label={common("actions")}><Link className="button button-secondary button-small" href={`/reported-content/${encodeURIComponent(report.report_id)}`}>{common("view")}</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {nextCursor ? (
          <div className="reported-content-load-more">
            <button className="button button-secondary" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>
              {loadingMore ? common("loading") : t("loadMore")}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

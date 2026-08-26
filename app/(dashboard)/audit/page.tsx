"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { auditDetailSummary, auditRows, type AuditRow } from "@/lib/auditLog";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const t = useTranslations("audit");
  const common = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_audit", { page, page_size: PAGE_SIZE });
    // A malformed success payload is an error, never a proven empty log: an audit view that renders
    // blanks for rows it could not read is worse than one that says it could not read them.
    const parsed = response?.success ? auditRows(response.data) : null;
    if (!response || !parsed) {
      setState("error");
      return;
    }
    setRows(parsed);
    setTotal(Number(response.total) || 0);
    setState("ready");
  }, [page, rows.length]);

  useEffect(() => { void load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>}
      />
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rows.length === 0 ? (
        <EmptyPanel title={t("empty")} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("time")}</th>
                  <th>{t("actor")}</th>
                  <th>{t("action")}</th>
                  <th>{t("target")}</th>
                  <th>{t("details")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { shown, withheld } = auditDetailSummary(row.details);
                  return (
                    <tr key={row.id}>
                      <td>{formatDate(row.created_at, locale, true)}</td>
                      <td>{row.actor_email || "—"}</td>
                      <td><span className="badge badge-active">{row.action}</span></td>
                      <td>{row.target || "—"}</td>
                      <td>
                        <span className="audit-details">
                          {shown.length === 0 && withheld === 0 ? "—" : null}
                          {shown.map((entry) => (
                            <span className="audit-detail-pair" key={entry.key}>
                              <code>{entry.key}</code>
                              <span>{entry.value}</span>
                            </span>
                          ))}
                          {withheld > 0 ? (
                            <span className="audit-detail-withheld">{t("withheld", { count: withheld })}</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>{t("page", { page })}</span>
            <div className="pagination-buttons">
              <button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                {common("previous")}
              </button>
              <button className="button button-secondary button-small" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>
                {common("next")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import { DatesExternalCorrectionReject, DatesExternalCorrectionView } from "@/components/DatesExternalCorrectionView";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import {
  DATES_EXTERNAL_CORRECTION_STATUSES, decodeDatesExternalCorrectionList,
  type DatesExternalCorrection, type DatesExternalCorrectionList, type DatesExternalCorrectionStatus,
} from "@/lib/datesExternalAdmin";

/**
 * D-149 W4: members' corrections of published external events. Nothing a member sends is shown to other members
 * before a moderator approves it. "Approve and edit" opens the event's editor prefilled with the proposed values and
 * saves through the ordinary update with the correction's id; "Reject" records a reason code.
 */
export default function DatesCorrectionsPage() {
  const t = useTranslations("datesAdmin.corrections"), common = useTranslations("common");
  const [status, setStatus] = useState<DatesExternalCorrectionStatus | "">("pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DatesExternalCorrectionList | null>(null);
  const [manage, setManage] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [rejecting, setRejecting] = useState<DatesExternalCorrection | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; key: string } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const current = ++generation.current;
    setState("loading");
    const [response, identity] = await Promise.all([
      adminCall("dates_external_correction_list", { ...(status ? { status } : {}), page }, signal), adminCall("admin_me", {}, signal)]);
    if (signal?.aborted || current !== generation.current) return;
    const decoded = decodeDatesExternalCorrectionList(response, { page, status });
    const principal = datesAdminPrincipal(identity);
    if (!decoded || !principal || !hasDatesCapability(principal, "dates_external_event_read")) { setData(null); setState("error"); return; }
    setData(decoded); setManage(hasDatesCapability(principal, "dates_external_event_manage")); setState("ready");
  }, [status, page]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); ++generation.current; };
  }, [load]);

  const pageSize = data ? data.limit ?? Math.max(data.rows.length + data.unreadable.length, 1) : 1;
  const hasNext = data !== null && page * pageSize < data.total && page < 10000;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")}
      actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>} />
    <DatesAdminTabs />
    <p className="alert alert-info">{t("boundary")}</p>
    <form className="dates-filter-grid" onSubmit={(event) => event.preventDefault()}>
      <label className="field"><span>{t("statusFilter")}</span><select value={status} onChange={(event) => { setPage(1); setNotice(null); setStatus(event.target.value as DatesExternalCorrectionStatus | ""); }}>
        <option value="">{common("all")}</option>
        {DATES_EXTERNAL_CORRECTION_STATUSES.map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}</select></label>
    </form>
    {notice && <p className={`alert alert-${notice.tone}`} role="status">{t(notice.key)}</p>}
    {state === "loading" ? <LoadingPanel /> : state === "error" || !data ? <ErrorPanel message={t("loadError")} retry={() => void load()} /> : <>
      {data.unreadable.map((row) => <p className="alert alert-error" key={`unreadable-${row.index}`}>{t("unreadableRow", { row: row.index + 1 })}{row.id ? <> · <code>{row.id}</code></> : null}</p>)}
      {data.rows.length === 0 && data.unreadable.length === 0 ? <section className="panel"><p>{t(data.total === 0 ? "empty" : "emptyPage")}</p></section>
        : <div className="dates-correction-list">{data.rows.map((correction) => <section className="panel" key={correction.correction_id}>
          <div className="panel-header"><span className={`badge ${correction.status === "pending" ? "badge-warning" : correction.status === "approved" ? "badge-active" : "badge-inactive"}`}>
            {t(`statuses.${correction.status}`)}</span>
            {correction.status === "pending" && manage && <div className="row-actions">
              <Link className="button button-primary button-small" href={`/dates/external/${correction.external_event_id}?correction=${correction.correction_id}`}>{t("approveEdit")}</Link>
              <button type="button" className="button button-danger button-small" onClick={() => { setNotice(null); setRejecting(correction); }}>{t("reject")}</button></div>}</div>
          <DatesExternalCorrectionView correction={correction} />
        </section>)}</div>}
      <div className="pagination"><span>{t("pagination", { page, total: data.total })}</span><div className="row-actions">
        <button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{common("previous")}</button>
        <button className="button button-secondary button-small" disabled={!hasNext} onClick={() => setPage((value) => value + 1)}>{common("next")}</button>
      </div></div>
    </>}
    {rejecting && <DatesExternalCorrectionReject correction={rejecting} onCancel={() => setRejecting(null)} onSettled={async (outcome) => {
      if (outcome.kind === "success") { setRejecting(null); setNotice({ tone: "success", key: "rejected" }); }
      await load();
    }} />}
  </>;
}

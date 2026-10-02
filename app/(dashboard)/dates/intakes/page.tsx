"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import DatesIntakeSourcePanel from "@/components/DatesIntakeSourcePanel";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { DATES_INTAKE_STATUSES, datesIntakeAffordances, type DatesIntakeLeaseAction, type DatesIntakeQueue, type DatesIntakeQueueRow } from "@/lib/datesIntakeAdmin";
import { readDatesIntakeQueue, runDatesIntakeLease, type DatesIntakeOperator } from "@/lib/datesIntakeConsole";
import { formatDate, formatNumber } from "@/lib/format";

const PAGE_SIZE = 40;
type Problem = { kind: "denied" } | { kind: "unconfirmed" } | { kind: "refused"; error: string };
type Notice = { tone: "success" | "error"; key: string; error?: string };

export default function DatesIntakeQueuePage() {
  const t = useTranslations("datesAdmin.intake");
  const common = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState("in_review");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<DatesIntakeQueue | null>(null);
  const [operator, setOperator] = useState<DatesIntakeOperator | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState("");
  const loadGeneration = useRef(0), busyRef = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const generation = ++loadGeneration.current;
    setState("loading");
    const result = await readDatesIntakeQueue(adminCall, { status, channel: "", page, limit: PAGE_SIZE }, signal);
    // A reply to an earlier filter, page or refresh never replaces a newer one.
    if (signal?.aborted || generation !== loadGeneration.current) return;
    if (result.kind !== "ready") {
      setQueue(null); setOperator(null); setState("error");
      setProblem(result.kind === "refused" ? { kind: "refused", error: result.error } : { kind: result.kind });
      return;
    }
    setQueue(result.queue); setOperator(result.operator); setProblem(null); setState("ready");
  }, [status, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); ++loadGeneration.current; };
  }, [load]);

  async function lease(row: DatesIntakeQueueRow, action: DatesIntakeLeaseAction) {
    if (busyRef.current || row.revision === null) return;
    busyRef.current = true; setBusy(row.intake_id); setNotice(null);
    const generation = loadGeneration.current;
    try {
      const outcome = await runDatesIntakeLease(adminCall, { intake_id: row.intake_id, expected_revision: row.revision, action });
      if (generation !== loadGeneration.current) return;
      setNotice(outcome.kind === "success" ? { tone: "success", key: `lease.done.${action}` }
        : outcome.kind === "refused" ? { tone: "error", key: "refused", error: outcome.error } : { tone: "error", key: "lease.uncertain" });
      // The queue is read again either way: a hold changes the row's revision.
      await load();
    } finally { busyRef.current = false; setBusy(""); }
  }

  const totalPages = queue ? Math.max(page, Math.ceil(queue.total / PAGE_SIZE)) : 1;
  const access = { review: operator?.review === true, manage: operator?.manage === true, superadmin: operator?.superadmin === true,
    draftsEnabled: queue?.drafts_enabled === true };

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("queue.title")} subtitle={t("queue.subtitle")}
      actions={<div className="row-actions"><button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>
        <Link className="button button-secondary" href="/dates/ai-usage">{t("usage.open")}</Link></div>} />
    <DatesAdminTabs />
    <p className="alert alert-info">{t("aiNotice")}</p>
    {operator?.manage && queue && <DatesIntakeSourcePanel entry={{ state: queue.drafts_enabled ? "available" : "disabled" }} onCreated={(intakeId) => router.push(`/dates/intakes/${intakeId}`)} />}
    <form className="dates-filter-grid" onSubmit={(event) => event.preventDefault()}>
      <label className="field"><span>{t("queue.statusFilter")}</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
        <option value="">{common("all")}</option>
        {DATES_INTAKE_STATUSES.map((value) => <option key={value} value={value}>{t(`statusValues.${value}`)}{queue ? ` (${formatNumber(queue.status_counts[value], locale)})` : ""}</option>)}
      </select></label>
    </form>
    {notice && (notice.key === "refused" && notice.error ? <DatesIntakeRefusal error={notice.error} />
      : <p className={`alert alert-${notice.tone}`} role="status">{t(notice.key)}</p>)}
    {state === "loading" ? <LoadingPanel /> : state === "error" || !queue ? <>
      {problem?.kind === "refused" && <DatesIntakeRefusal error={problem.error} />}
      <ErrorPanel message={t(problem?.kind === "denied" ? "access.denied" : problem?.kind === "refused" ? "access.refused" : "access.unconfirmed")} retry={() => void load()} />
    </> : <>
      {!queue.drafts_enabled && <p className="alert alert-info">{t("queue.draftsOff")}</p>}
      <p className="field-hint">{t(status === "in_review" ? "queue.orderReview" : "queue.orderNewest")}</p>
      {queue.unreadable_rows.map((row) => <p className="alert alert-error" key={`unreadable-${row.index}`}>{t("queue.unreadableRow", { row: row.index + 1 })}{row.intake_id ? <> · <code>{row.intake_id}</code></> : null}</p>)}
      {queue.intakes.length === 0 && queue.unreadable_rows.length === 0 ? <section className="panel"><p>{t(queue.total === 0 ? "queue.empty" : "queue.emptyPage")}</p></section> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("queue.columns.intake")}</th><th>{t("queue.columns.status")}</th><th>{t("queue.columns.source")}</th><th>{t("queue.columns.findings")}</th><th>{t("queue.columns.created")}</th><th>{t("queue.columns.hold")}</th></tr></thead>
        <tbody>{queue.intakes.map((row) => {
          const can = datesIntakeAffordances(row, access), working = busy === row.intake_id;
          return <tr key={row.intake_id}>
            <td><Link href={`/dates/intakes/${row.intake_id}`}>{row.first_title ?? t("queue.untitled")}</Link>
              <div><small>{row.event_count === null ? "—" : t("queue.events", { count: row.event_count, published: row.published_count ?? 0 })}</small></div>
              {row.unreadable_fields.length > 0 && <div><small role="status">{common("unreadableField")} · {row.unreadable_fields.join(", ")}</small></div>}</td>
            <td>{t(`statusValues.${row.status}`)}{row.status_detail && <div><small>{t(`statusDetailValues.${row.status_detail}`)}</small></div>}
              {row.decision_action && <div><small>{t(`decisionValues.${row.decision_action}`)}</small></div>}</td>
            <td>{row.channel ? t(`channelValues.${row.channel}`) : "—"}<div><small>{row.input_kind ? t(`inputKindValues.${row.input_kind}`) : "—"}{row.source_host ? ` · ${row.source_host}` : ""}{row.image_count ? ` · ${t("queue.images", { count: row.image_count })}` : ""}</small></div>
              {row.provider && <div><small>{t(`providerValues.${row.provider}`)}</small></div>}</td>
            <td>{row.hard_fails === null ? "—" : row.hard_fails.length === 0 ? t("queue.noHardFails") : <span className="badge badge-warning">{t("queue.hardFails", { count: row.hard_fails.length })}</span>}
              {row.hard_fails?.map((fail) => <div key={fail}><small>{t(`hardFails.${fail}`)}</small></div>)}
              <div><small>{row.warning_count === null ? "—" : t("queue.warnings", { count: row.warning_count })}{row.dedupe_decision ? ` · ${t(`dedupeValues.${row.dedupe_decision}`)}` : ""}</small></div></td>
            <td>{formatDate(row.created_at, locale, true)}{row.earliest_start_at ? <div><small>{t("queue.starts", { date: formatDate(row.earliest_start_at, locale, true) })}</small></div> : null}</td>
            <td>{row.lease === null ? "—" : row.lease.active ? <>{row.lease.mine ? t("lease.mine") : t("lease.other", { holder: row.lease.holder ?? "—" })}<div><small>{t("lease.until", { time: formatDate(row.lease.until, locale, true) })}</small></div></> : row.status === "in_review" ? t("lease.free") : "—"}
              <div className="row-actions">
                {can.claim && <button className="button button-secondary button-small" disabled={working || busy !== ""} onClick={() => void lease(row, "claim")}>{t("lease.claim")}</button>}
                {can.release && <button className="button button-secondary button-small" disabled={working || busy !== ""} onClick={() => void lease(row, "release")}>{t("lease.release")}</button>}
                {can.overrideRelease && <button className="button button-danger button-small" disabled={working || busy !== ""} onClick={() => void lease(row, "release")}>{t("lease.override")}</button>}
              </div></td>
          </tr>;
        })}</tbody>
      </table></div>}
      <div className="pagination"><span>{t("queue.pagination", { page, pages: totalPages, total: queue.total })}</span><div className="row-actions">
        <button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{common("previous")}</button>
        <button className="button button-secondary button-small" disabled={page >= totalPages || page >= 10000} onClick={() => setPage((current) => current + 1)}>{common("next")}</button>
      </div></div>
    </>}
  </>;
}

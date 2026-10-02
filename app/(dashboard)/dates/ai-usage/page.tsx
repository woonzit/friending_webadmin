"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAiUsageMonth, datesAiUsageShare, datesMicroUsd, type DatesAiUsageRead } from "@/lib/datesIntakeAdmin";
import { readDatesAiUsage } from "@/lib/datesIntakeConsole";
import { formatDate, formatNumber } from "@/lib/format";

type Problem = { kind: "denied" } | { kind: "unconfirmed" } | { kind: "refused"; error: string };

/** What the event AI has cost this month, against the cap an administrator set. Usage figures only: no prompt, no content. */
export default function DatesAiUsagePage() {
  const t = useTranslations("datesAdmin.intake"), common = useTranslations("common"), locale = useLocale();
  const [month, setMonth] = useState("");
  const [draft, setDraft] = useState("");
  const [read, setRead] = useState<{ usage: DatesAiUsageRead; awaitingBudget: number | null; review: boolean } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const generation = ++loadGeneration.current;
    setState("loading");
    const result = await readDatesAiUsage(adminCall, month === "" ? null : month, signal);
    if (signal?.aborted || generation !== loadGeneration.current) return;
    if (result.kind !== "ready") {
      setRead(null); setState("error");
      setProblem(result.kind === "refused" ? { kind: "refused", error: result.error } : { kind: result.kind });
      return;
    }
    setRead({ usage: result.usage, awaitingBudget: result.awaitingBudget, review: result.operator.review }); setProblem(null); setState("ready");
  }, [month]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); ++loadGeneration.current; };
  }, [load]);

  const usage = read?.usage.usage ?? null, share = usage ? datesAiUsageShare(usage) : null;
  const percent = (value: number) => new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("usage.title")} subtitle={t("usage.subtitle")}
      actions={<div className="row-actions"><Link className="button button-secondary" href="/dates/intakes">{t("detail.back")}</Link>
        <button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button></div>} />
    <DatesAdminTabs />
    <form className="dates-filter-grid" onSubmit={(event) => { event.preventDefault(); if (draft === "" || datesAiUsageMonth(draft)) setMonth(draft); }}>
      <label className="field"><span>{t("usage.month")}</span><input type="month" value={draft} min="2026-01" onChange={(event) => setDraft(event.target.value)} />
        <small>{t("usage.monthHint")}</small></label>
      <div className="row-actions"><button className="button button-primary" type="submit">{t("usage.show")}</button>
        <button className="button button-secondary" type="button" onClick={() => { setDraft(""); setMonth(""); }}>{t("usage.current")}</button></div>
    </form>
    {state === "loading" ? <LoadingPanel /> : state === "error" || !read || !usage ? <>
      {problem?.kind === "refused" && <DatesIntakeRefusal error={problem.error} />}
      <ErrorPanel message={t(problem?.kind === "denied" ? "access.denied" : problem?.kind === "refused" ? "access.refused" : "access.unconfirmed")} retry={() => void load()} />
    </> : <>
      {!read.usage.drafts_enabled && <p className="alert alert-info">{t("queue.draftsOff")}</p>}
      {usage.cap_usd === 0 && <p className="alert alert-warning" role="status">{t("usage.capZero")}</p>}
      {usage.exhausted && usage.cap_usd > 0 && <p className="alert alert-error" role="status">{t("usage.exhausted")}</p>}
      {usage.alert && !usage.exhausted && <p className="alert alert-warning" role="status">{t("usage.alert")}{usage.alert_at !== null ? ` ${t("usage.alertAt", { date: formatDate(usage.alert_at, locale, true) })}` : ""}</p>}
      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">{t("usage.spent", { month: usage.month })}</span><strong className="stat-value">{datesMicroUsd(usage.spent_micro_usd, locale)}</strong>
          <span className="stat-meta">{share === null ? t("usage.noCap") : t("usage.ofCap", { share: percent(share), cap: datesMicroUsd(usage.cap_usd * 1_000_000, locale) })}</span></div>
        <div className="stat-card"><span className="stat-label">{t("usage.remaining")}</span><strong className="stat-value">{datesMicroUsd(usage.remaining_micro_usd, locale)}</strong>
          <span className="stat-meta">{t("usage.reserved", { amount: datesMicroUsd(usage.reserved_micro_usd, locale) })}</span></div>
        <div className="stat-card"><span className="stat-label">{t("usage.calls")}</span><strong className="stat-value">{formatNumber(usage.calls, locale)}</strong>
          <span className="stat-meta">{t("usage.callsHint")}</span></div>
        <div className="stat-card"><span className="stat-label">{t("usage.awaitingBudget")}</span><strong className="stat-value">{read.awaitingBudget === null ? "—" : formatNumber(read.awaitingBudget, locale)}</strong>
          <span className="stat-meta">{t(read.awaitingBudget !== null ? "usage.awaitingBudgetHint" : read.review ? "usage.awaitingBudgetUnread" : "usage.awaitingBudgetReviewOnly")}</span></div>
      </div>
      {share !== null && <progress className="dates-intake-budget" max={1} value={share} aria-label={t("usage.progress")} />}
      <section className="panel dates-external-fields">
        <h2>{t("usage.breakdown")}</h2>
        <p className="field-hint">{t("usage.breakdownHint")}</p>
        {usage.unreadable_rows.length > 0 && <p className="alert alert-error" role="status">{t("usage.unreadableRows", { count: usage.unreadable_rows.length })}</p>}
        {usage.rows.length === 0 ? <p>{t("usage.empty")}</p> : <div className="table-wrap"><table className="data-table">
          <thead><tr><th>{t("usage.columns.provider")}</th><th>{t("usage.columns.task")}</th><th>{t("usage.columns.channel")}</th><th>{t("usage.columns.calls")}</th><th>{t("usage.columns.tokens")}</th><th>{t("usage.columns.cost")}</th></tr></thead>
          <tbody>{usage.rows.map((row, index) => <tr key={index}>
            <td>{t.has(`providerValues.${row.provider}`) ? t(`providerValues.${row.provider}`) : row.provider}<div><small><code>{row.model || "—"}</code></small></div></td>
            <td>{t.has(`taskValues.${row.task}`) ? t(`taskValues.${row.task}`) : row.task}</td>
            <td>{t.has(`channelValues.${row.channel}`) ? t(`channelValues.${row.channel}`) : row.channel}</td>
            <td>{formatNumber(row.calls, locale)}{row.unanswered_calls > 0 ? <div><small>{t("usage.unanswered", { count: row.unanswered_calls })}</small></div> : null}</td>
            <td>{formatNumber(row.input_tokens, locale)} / {formatNumber(row.output_tokens, locale)}
              <div><small>{t("usage.tokenDetail", { read: formatNumber(row.cache_read_tokens, locale), write: formatNumber(row.cache_write_tokens, locale), reasoning: formatNumber(row.reasoning_tokens, locale) })}</small></div></td>
            <td>{datesMicroUsd(row.cost_micro_usd, locale)}{row.estimated_cost_calls > 0 ? <div><small>{t("usage.estimatedCalls", { count: row.estimated_cost_calls })}</small></div> : null}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </>;
}

"use client";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { readResearchOverview } from "@/lib/datesResearchConsole";
import { type ResearchBatchResult } from "@/lib/datesResearchAdmin";
import { datesIntakeAuditNote, DATES_INTAKE_REJECT_REASONS, type DatesIntakeQueueRow } from "@/lib/datesIntakeAdmin";
import { adminCall } from "@/lib/adminClient";
import { ResearchCommandFeedback, ResearchReason, useResearchCommand } from "@/components/DatesResearchControls";

const confirmations = ["source", "public_venue", "timezone", "content_safe"] as const;
const unchecked = () => ({ source: false, public_venue: false, timezone: false, content_safe: false });
export default function DatesResearchBatch({ runId, rows, actor, manage, reload }: { runId: string; rows: DatesIntakeQueueRow[]; actor: string; manage: boolean; reload: () => Promise<void> }) {
  const t = useTranslations("datesAdmin.research"), intake = useTranslations("datesAdmin.intake");
  const [maximum, setMaximum] = useState<number | null>(null), [unavailable, setUnavailable] = useState(false), [selected, setSelected] = useState<Record<string, number>>({});
  const [checks, setChecks] = useState(unchecked), [reason, setReason] = useState(""), [reasonCode, setReasonCode] = useState<string>(DATES_INTAKE_REJECT_REASONS[0]);
  const [results, setResults] = useState<ResearchBatchResult[] | null>(null), [resultOwner, setResultOwner] = useState(""), [resultRun, setResultRun] = useState(""), [pendingRun, setPendingRun] = useState("");
  const generation = useRef(0), pendingRunRef = useRef("");
  useEffect(() => {
    if (!runId || !manage) return;
    const controller = new AbortController(), current = ++generation.current;
    void readResearchOverview(adminCall, controller.signal).then((read) => {
      if (controller.signal.aborted || current !== generation.current) return;
      setUnavailable(read.kind === "unavailable"); setMaximum(read.kind === "ready" && read.manage ? read.value.limits.batch_intakes?.max ?? null : null);
    });
    return () => { controller.abort(); ++generation.current; };
  }, [runId, actor, manage]);
  useEffect(() => { setSelected({}); setChecks(unchecked()); setReason(""); }, [runId, actor]);
  const eligible = useMemo(() => rows.filter((row) => row.channel === "ai_research" && row.research_run_id === runId && row.status === "in_review"
    && row.controls && row.revision !== null && row.lease?.active && row.lease.mine), [rows, runId]);
  const ids = Object.keys(selected), selectionCurrent = ids.every((id) => eligible.some((row) => row.intake_id === id && row.revision === selected[id]));
  const command = useResearchCommand(actor, async (answer) => { setResults(answer.results ?? null); setResultOwner(actor); setResultRun(pendingRunRef.current); setSelected({}); setChecks(unchecked()); await reload(); }, reload);
  const visibleResults = resultOwner === actor ? results : null;
  if (!actor) return null;
  if (!runId && command.pending === null && visibleResults === null) return null;
  if (!manage && command.pending === null) return null;
  function choose(row: DatesIntakeQueueRow, checked: boolean) {
    if (row.revision === null) return;
    setSelected((current) => { const next = { ...current }; if (checked) next[row.intake_id] = row.revision!; else delete next[row.intake_id]; return next; });
    setChecks(unchecked()); setResults(null);
  }
  const ready = manage && !!runId && maximum !== null && ids.length > 0 && ids.length <= maximum && selectionCurrent && datesIntakeAuditNote(reason) && !command.busy && command.pending === null;
  async function decide(action: "publish" | "reject") {
    if (!ready || action === "publish" && !confirmations.every((key) => checks[key])) return;
    setPendingRun(runId);
    pendingRunRef.current = runId;
    await command.submit("dates_event_intake_batch_decide", { intake_ids: ids, expected_revisions: selected, action, reason,
      ...(action === "publish" ? { confirmations: checks } : { reason_code: reasonCode }) });
  }
  return <section className="panel research-batch"><h2>{t("batch.title")}</h2><p><code>{command.pending ? pendingRun : runId || resultRun}</code></p>
    {maximum === null ? <p className="alert alert-warning">{t(unavailable ? "batch.unavailable" : "unconfirmed")}</p> : <p>{t("batch.hint", { count: maximum })}</p>}
    <p className="field-hint">{t("batch.reviewHint")}</p>
    <div className="research-batch-selection">{eligible.map((row) => <label key={row.intake_id}><input type="checkbox" aria-label={t("batch.select")} checked={Object.hasOwn(selected, row.intake_id)}
      disabled={command.busy || command.pending !== null || maximum === null || ids.length >= maximum && !Object.hasOwn(selected, row.intake_id)} onChange={(event) => choose(row, event.target.checked)} />
      <Link href={`/dates/intakes/${row.intake_id}`}>{row.first_title ?? row.intake_id}</Link></label>)}</div>
    <p>{t("batch.selected", { count: ids.length })}</p>
    {!selectionCurrent && <p className="alert alert-warning">{t("batch.selectionChanged")}</p>}
    <button className="button button-secondary button-small" disabled={command.busy || command.pending !== null} onClick={() => { setSelected({}); setChecks(unchecked()); }}>{t("batch.clearSelection")}</button>
    <div className="research-batch-confirmations">{confirmations.map((key) => <label key={key}><input type="checkbox" checked={checks[key]} disabled={command.busy || command.pending !== null || ids.length === 0 || !selectionCurrent}
      onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })} />{t(`batch.confirmations.${key}`)}</label>)}</div>
    <ResearchReason value={reason} onChange={setReason} disabled={command.busy || command.pending !== null} />
    <label className="field"><span>{t("batch.reasonCode")}</span><select value={reasonCode} disabled={command.busy || command.pending !== null} onChange={(event) => setReasonCode(event.target.value)}>
      {DATES_INTAKE_REJECT_REASONS.map((key) => <option key={key} value={key}>{intake(`rejectReasons.${key}`)}</option>)}</select></label>
    <div className="row-actions"><button className="button button-primary" disabled={!ready || !confirmations.every((key) => checks[key])} onClick={() => void decide("publish")}>{t("batch.publish")}</button>
      <button className="button button-danger" disabled={!ready} onClick={() => void decide("reject")}>{t("batch.reject")}</button></div>
    <ResearchCommandFeedback command={command} />
    {visibleResults && <div><h3>{t("batch.results")}</h3><p><code>{resultRun}</code></p>{visibleResults.map((row) => <p key={row.intake_id}>
      <Link href={`/dates/intakes/${row.intake_id}`}>{row.intake_id}</Link> · {t(`batch.outcomes.${row.outcome}`)}{row.refusal ? <> · <code>{row.refusal}</code></> : null}
      {row.external_event_id ? <> · <Link href={`/dates/external/${row.external_event_id}`}>{row.external_event_id}</Link></> : null}</p>)}</div>}
  </section>;
}

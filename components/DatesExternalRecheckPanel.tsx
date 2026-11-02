"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import {
  DATES_EXTERNAL_RECHECK_INSTRUCTIONS_MAX, DATES_EXTERNAL_RECHECK_OPEN, datesExternalRecheckInstructions, datesExternalRechecks,
  decodeDatesExternalDetail, type DatesExternalDetailRow, type DatesExternalRecheck, type DatesExternalRows,
} from "@/lib/datesExternalAdmin";
import {
  datesExternalReviewRefusalKey, prepareDatesExternalRecheck, readDatesExternalRecheckPending, runDatesExternalRecheck,
  type DatesExternalRecheckPendingRead, type DatesExternalRecheckStorage,
} from "@/lib/datesExternalReview";
import { formatDate } from "@/lib/format";

/** PROVISIONAL: the job reasons the console words; any other code Core reports is shown as it was written. */
export const DATES_EXTERNAL_RECHECK_REASONS = ["no_change", "not_same_event", "no_valid_page", "fetch_failed", "robots_disallowed", "validation_failed",
  "provider_unavailable", "budget_paused", "event_not_published", "event_changed", "timeout"] as const;
/** The change-set fields the console names in words (the editor's labels); any other is shown as Core wrote it. */
const FIELD_LABELS: Readonly<Record<string, string>> = { title: "title", start_at: "startLocal", starts_local: "startLocal", start_local: "startLocal",
  end_at: "endLocal", ends_local: "endLocal", end_local: "endLocal", venue: "venueName", venue_name: "venueName", venue_address: "venueAddress",
  formatted_address: "venueAddress", official_url: "officialUrl", ticket_url: "ticketUrl", price_text: "priceText", is_free: "isFree",
  organizer_name: "organizerName", timezone: "timezone", all_day: "allDay", category: "category" };

function storage(): DatesExternalRecheckStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
const POLL_MS = 10_000;

/**
 * D-149 W2: "Re-research with AI" for one external event. The job is Core's: one targeted discovery call, fetching the
 * known and found pages, extraction with the administrator's instructions, validation, and - when it is the same event
 * and facts changed - an update through the publisher. This panel asks for it, shows the job while it is open (reading
 * the event again every ten seconds, without touching the editor), and lists the last five with their change sets.
 */
export default function DatesExternalRecheckPanel({ event, serverNow, actor, canManage, onFactsChanged }: {
  event: DatesExternalDetailRow; serverNow: number; actor: string; canManage: boolean; onFactsChanged: () => void;
}) {
  const t = useTranslations("datesAdmin.external.recheck"), review = useTranslations("datesAdmin.external.review");
  const form = useTranslations("datesAdmin.external.form"), common = useTranslations("common"), locale = useLocale();
  const [jobs, setJobs] = useState<DatesExternalRows<DatesExternalRecheck> | null>(() => datesExternalRechecks(event, serverNow));
  // Read from this tab's session storage after mounting (null: not read yet - nothing can be started until it is).
  const [pending, setPending] = useState<DatesExternalRecheckPendingRead | null>(null);
  const [instructions, setInstructions] = useState(""), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pollError, setPollError] = useState(false);
  const busyRef = useRef(false), revision = useRef(event.revision), alive = useRef(true);
  // The caller's callback may be a new function on every render; the poll must not restart because of it.
  const factsChanged = useRef(onFactsChanged);
  factsChanged.current = onFactsChanged;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setPending(readDatesExternalRecheckPending(storage(), actor, event.external_event_id)); }, [actor, event.external_event_id]);

  const open = jobs?.rows.find((job) => DATES_EXTERNAL_RECHECK_OPEN.includes(job.status)) ?? null;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    let response: unknown;
    try { response = await adminCall("dates_external_event_detail", { external_event_id: event.external_event_id }, signal); } catch { response = null; }
    if (signal?.aborted || !alive.current) return;
    const detail = decodeDatesExternalDetail(response, event.external_event_id);
    if (!detail) { setPollError(true); return; }
    setPollError(false); setJobs(datesExternalRechecks(detail.event, detail.server_now));
    // A job that applied facts moved the ledger: the page's revision is stale, so its writes wait for a reload.
    if (detail.event.revision !== revision.current) { revision.current = detail.event.revision; factsChanged.current(); }
  }, [event.external_event_id]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), timer = window.setTimeout(() => void refresh(controller.signal), POLL_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, jobs, refresh]);

  async function send(retry: boolean) {
    if (busyRef.current || !canManage) return;
    const store = storage();
    const saved = readDatesExternalRecheckPending(store, actor, event.external_event_id);
    if (saved.kind === "blocked" || (!retry && saved.kind === "pending")) { setPending(saved); setNotice({ tone: "error", text: t("pendingBlocked") }); return; }
    const request = retry ? (saved.kind === "pending" ? saved.pending : null)
      : prepareDatesExternalRecheck(actor, event.external_event_id, instructions, serverNow);
    if (!request) { setNotice({ tone: "error", text: t("invalid") }); return; }
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const outcome = await runDatesExternalRecheck(adminCall, store, request);
      if (!alive.current) return;
      setPending(readDatesExternalRecheckPending(store, actor, event.external_event_id));
      if (outcome.kind === "success") {
        setConfirming(false); setInstructions("");
        setNotice({ tone: outcome.retained ? "error" : "success", text: t(outcome.retained ? "retained" : "queued") });
      } else if (outcome.kind === "refused") {
        setConfirming(false);
        setNotice({ tone: "error", text: review(`refusals.${datesExternalReviewRefusalKey(outcome.error)}`) });
      } else setNotice({ tone: "error", text: t(outcome.kind === "blocked" ? "pendingBlocked" : "uncertain") });
      await refresh();
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  const length = Array.from(instructions).length;
  const instructionsValid = instructions.trim() === "" || datesExternalRecheckInstructions(instructions);
  const usd = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
  const shown = (value: string | number | boolean | null) => value === null ? t("empty") : typeof value === "boolean" ? common(value ? "yes" : "no") : String(value);
  const startable = canManage && !open && pending?.kind === "empty" && (event.status === "published" || event.status === "rechecking") && !event.soft_deleted;

  return <section className="panel dates-external-fields" id="recheck" aria-labelledby="recheck-title">
    <div className="panel-header"><h2 id="recheck-title">{t("title")}</h2>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void refresh()}>{common("refresh")}</button></div>
    <p>{t("copy")}</p>
    {pollError && <p className="alert alert-warning" role="status">{t("pollError")}</p>}
    {pending?.kind === "pending" && <div className="alert alert-info" role="status"><p>{t("pendingCopy")}</p>
      {pending.pending.body.instructions && <p className="preserve-whitespace">{pending.pending.body.instructions}</p>}
      <button type="button" className="button button-primary button-small" disabled={busy || !canManage} onClick={() => void send(true)}>{busy ? common("working") : t("retry")}</button></div>}
    {pending?.kind === "blocked" && <p className="alert alert-error" role="status">{t("pendingBlocked")}</p>}
    {open && <p className="alert alert-info" role="status">{t("openJob", { status: t(`statuses.${open.status}`), at: formatDate(open.created_at, locale, true) })}</p>}
    {notice && <p className={`alert alert-${notice.tone}`} role="status">{notice.text}</p>}
    {canManage && <div className="dates-external-fields">
      <label className="field"><span>{t("instructions")}</span>
        <textarea rows={4} maxLength={DATES_EXTERNAL_RECHECK_INSTRUCTIONS_MAX * 2} value={instructions} disabled={!startable || busy}
          onChange={(change) => setInstructions(change.target.value)} />
        <small className={length > DATES_EXTERNAL_RECHECK_INSTRUCTIONS_MAX ? "forced-copy-counter is-over" : "forced-copy-counter"}>
          {t("counter", { count: length, max: DATES_EXTERNAL_RECHECK_INSTRUCTIONS_MAX })}</small>
        <small>{t("instructionsHint")}</small></label>
      <div className="row-actions"><button type="button" className="button button-primary" disabled={!startable || busy || !instructionsValid}
        onClick={() => { setNotice(null); setConfirming(true); }}>{t("start")}</button></div>
      {!startable && !open && pending?.kind === "empty" && <p className="field-hint">{t("notStartable")}</p>}
    </div>}
    {jobs === null ? null : <>
      <h3>{t("history")}</h3>
      {jobs.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableJob", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
      {jobs.rows.length === 0 && jobs.unreadable.length === 0 ? <p>{t("none")}</p> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("columns.status")}</th><th>{t("columns.requested")}</th><th>{t("columns.instructions")}</th><th>{t("columns.result")}</th><th>{t("columns.cost")}</th></tr></thead>
        <tbody>{jobs.rows.slice(0, 5).map((job) => <tr key={job.recheck_id}>
          <td>{t(`statuses.${job.status}`)}<div><small><code>{job.recheck_id}</code></small></div></td>
          <td>{formatDate(job.created_at, locale, true)}{job.requested_by && <div><small>{job.requested_by}</small></div>}
            {job.finished_at !== null && <div><small>{t("finished", { at: formatDate(job.finished_at, locale, true) })}</small></div>}</td>
          <td className="preserve-whitespace">{job.instructions ?? t("noInstructions")}</td>
          <td>{job.reason !== null && <p>{(DATES_EXTERNAL_RECHECK_REASONS as readonly string[]).includes(job.reason) ? t(`reasons.${job.reason}`) : <code>{job.reason}</code>}</p>}
            {job.changes.length > 0 && <table className="data-table dates-embedded-table"><thead><tr><th>{t("columns.field")}</th><th>{t("columns.before")}</th><th>{t("columns.after")}</th></tr></thead>
              <tbody>{job.changes.map((change, index) => <tr key={`${change.field}-${index}`}>
                <td>{Object.hasOwn(FIELD_LABELS, change.field) ? form(FIELD_LABELS[change.field]) : <code>{change.field}</code>}</td>
                <td className="preserve-whitespace">{shown(change.before)}</td><td className="preserve-whitespace">{shown(change.after)}</td></tr>)}</tbody></table>}
            {job.reason === null && job.changes.length === 0 && "—"}</td>
          <td>{job.cost_usd === null ? "—" : usd(job.cost_usd)}</td>
        </tr>)}</tbody></table></div>}
    </>}
    {confirming && <ConfirmDialog title={t("confirmTitle")} copy={t("confirmCopy")} confirmLabel={t("start")} tone="primary" busy={busy}
      error={notice?.tone === "error" ? notice.text : ""} onCancel={() => { if (!busyRef.current) setConfirming(false); }} onConfirm={() => void send(false)}>
      <p className="preserve-whitespace">{instructions.trim() === "" ? t("noInstructions") : instructions}</p>
    </ConfirmDialog>}
  </section>;
}

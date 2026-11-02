"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import {
  DATES_EXTERNAL_RECHECK_INSTRUCTIONS_MAX, DATES_EXTERNAL_RECHECK_OPEN, datesExternalRecheckInstructions, datesExternalRechecks,
  type DatesExternalDetailRow, type DatesExternalRecheck, type DatesExternalRows,
} from "@/lib/datesExternalAdmin";
import { datesExternalRecheckStatus, pollDatesExternalRecheck } from "@/lib/datesExternalRecheckPoll";
import {
  datesExternalReviewRefusalKey, prepareDatesExternalRecheck, readDatesExternalRecheckPending, runDatesExternalRecheck,
  type DatesExternalRecheckPendingRead, type DatesExternalRecheckStorage,
} from "@/lib/datesExternalReview";
import { formatDate } from "@/lib/format";

/** A job's reason codes (Core-B c268ae4b), which the console words; any other code Core reports is shown as it was written. */
export const DATES_EXTERNAL_RECHECK_REASONS = ["same_facts", "event_unavailable", "research_disabled", "budget_paused", "provider_unavailable", "no_page",
  "not_same_event", "validation_failed", "publisher_refused", "interrupted"] as const;
/** The change-set fields (Core-B c268ae4b) in the editor's words; any other is shown as Core wrote it. */
const FIELD_LABELS: Readonly<Record<string, string>> = { title: "title", start_at: "startLocal", end_at: "endLocal", all_day: "allDay",
  venue: "venueName", official_url: "officialUrl", ticket_url: "ticketUrl", organizer: "organizerName", price_text: "priceText", is_free: "isFree" };
/** Times of a change set are epoch seconds, shown in the event's own time zone. */
const TIME_FIELDS = new Set(["start_at", "end_at"]);

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
  const form = useTranslations("datesAdmin.external.form"), external = useTranslations("datesAdmin.external"), common = useTranslations("common"), locale = useLocale();
  const [jobs, setJobs] = useState<DatesExternalRows<DatesExternalRecheck> | null>(() => datesExternalRechecks(event, serverNow));
  // Read from this tab's session storage after mounting (null: not read yet - nothing can be started until it is).
  const [pending, setPending] = useState<DatesExternalRecheckPendingRead | null>(null);
  const [instructions, setInstructions] = useState(""), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pollError, setPollError] = useState(false);
  const busyRef = useRef(false), revision = useRef(event.revision), alive = useRef(true);
  // Reads of the detail: how many are in flight, and the newest one's number (an older answer never replaces a newer one).
  const reading = useRef(0), latestRead = useRef(0);
  // The caller's callback may be a new function on every render; the poll must not restart because of it.
  const factsChanged = useRef(onFactsChanged);
  factsChanged.current = onFactsChanged;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setPending(readDatesExternalRecheckPending(storage(), actor, event.external_event_id)); }, [actor, event.external_event_id]);

  const open = jobs?.rows.find((job) => DATES_EXTERNAL_RECHECK_OPEN.includes(job.status)) ?? null;
  /** Reads the detail again; resolves to whether a job is still open, or may be (a failed or undecodable read). */
  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const read = ++latestRead.current;
    ++reading.current;
    let response: unknown;
    try { response = await adminCall("dates_external_event_detail", { external_event_id: event.external_event_id }, signal); } catch { response = null; }
    finally { --reading.current; }
    if (signal?.aborted || !alive.current) return false;
    if (read !== latestRead.current) return true;
    const status = datesExternalRecheckStatus(response, event.external_event_id);
    if (!status) { setPollError(true); return true; }
    setPollError(false); setJobs(status.jobs);
    // A job that applied facts moved the ledger: the page's revision is stale, so its writes wait for a reload.
    if (status.detail.event.revision !== revision.current) { revision.current = status.detail.event.revision; factsChanged.current(); }
    return status.open;
  }, [event.external_event_id]);
  // Codex F4: while a job is open, the next read is scheduled when the previous one settled - after a failed or
  // undecodable read too - and not by a change of `jobs`. A tick that finds a read in flight (Refresh) waits for the next.
  const polling = open !== null;
  useEffect(() => {
    if (!polling) return;
    return pollDatesExternalRecheck((signal) => reading.current > 0 ? Promise.resolve(true) : refresh(signal), POLL_MS);
  }, [polling, refresh]);

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
  // A fact the event did not know is null: "not known", like everywhere else on the page.
  const shown = (field: string, value: string | number | boolean | null) => value === null ? external("unknownFact")
    : typeof value === "boolean" ? common(value ? "yes" : "no")
      : typeof value === "number" && TIME_FIELDS.has(field) ? new Intl.DateTimeFormat(locale, { timeZone: event.timezone, dateStyle: "medium", timeStyle: "short" }).format(value * 1000)
        : String(value);
  // Core-B: published, rechecking or in review, active, undeleted (Core checks again, and refuses an ended one).
  const startable = canManage && !open && pending?.kind === "empty" && ["published", "rechecking", "in_review"].includes(event.status)
    && event.lifecycle === "active" && !event.soft_deleted;

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
                <td className="preserve-whitespace">{shown(change.field, change.before)}</td><td className="preserve-whitespace">{shown(change.field, change.after)}</td></tr>)}</tbody></table>}
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

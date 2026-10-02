"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesExternalEventForm from "@/components/DatesExternalEventForm";
import DatesIntakeEventPanel from "@/components/DatesIntakeEventPanel";
import { DatesIntakeCompletionChoice, DatesIntakeExtractionPanel, DatesIntakeInputsPanel, DatesIntakeRejectWarning, DatesIntakeRunsPanel, DatesIntakeStatusPanel } from "@/components/DatesIntakePanels";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import type { DatesExternalManualEvent } from "@/lib/datesExternalInput";
import { datesExternalBrowserStorage, readDatesExternalPending, type DatesExternalPending, type DatesExternalPendingRead } from "@/lib/datesExternalMutations";
import {
  DATES_INTAKE_HEARTBEAT_SECONDS, DATES_INTAKE_REJECT_REASONS, datesIntakeAffordances, datesIntakeCompleteFlag, datesIntakeCompletion,
  datesIntakeEditorDraft, datesIntakeEditorGaps,
  datesIntakeHeartbeatDelay, datesIntakeId, datesIntakePublishableEvents,
  type DatesIntakeDetailRead, type DatesIntakeLeaseAction,
} from "@/lib/datesIntakeAdmin";
import {
  createDatesIntakeSerial, datesIntakePollDelay, prepareDatesIntakeReject, readDatesIntakeDetail, runDatesIntakeLease, runDatesIntakePublish,
  runDatesIntakeReject, type DatesIntakeOperator, type DatesIntakeRejectCommand,
} from "@/lib/datesIntakeConsole";
import { formatDate } from "@/lib/format";

type Problem = { kind: "denied" } | { kind: "unconfirmed" } | { kind: "refused"; error: string };
type Notice = { tone: "success" | "error" | "info"; key: string; error?: string; eventId?: string };
type Candidate = { eventIndex: number; event: DatesExternalManualEvent; reason: string; complete: boolean; unreadable: number };
/** Core's refusals that mean the opened event can no longer be published from this intake at all. */
const GONE = ["dates-intake-event-unavailable", "dates-intake-state-invalid", "dates-intake-unavailable"];

/**
 * One intake for the reviewer: what was submitted, what the AI made of it with
 * the evidence for each field, what Core's checks say - and the three things
 * a person can do with it: hold it, reject it, or open one of its events in
 * the P1 editor and publish that through the P1 publisher. The AI never
 * publishes, and nothing here is shown to members.
 */
export default function DatesIntakeReviewPage({ intakeId }: { intakeId: string }) {
  const t = useTranslations("datesAdmin.intake"), external = useTranslations("datesAdmin.external"), common = useTranslations("common");
  const locale = useLocale();
  const [result, setResult] = useState<{ read: DatesIntakeDetailRead; draftsEnabled: boolean | null } | null>(null);
  const [operator, setOperator] = useState<DatesIntakeOperator | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<DatesExternalPendingRead>({ kind: "blocked" });
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const [complete, setComplete] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [rejectCode, setRejectCode] = useState<string>(DATES_INTAKE_REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectCommand, setRejectCommand] = useState<DatesIntakeRejectCommand | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0), lifetime = useRef(0), busyRef = useRef(false), revision = useRef<number | null>(null);
  const serial = useRef(createDatesIntakeSerial()), startedAt = useRef(Date.now()), pendingRef = useRef(false);

  /**
   * `initial` replaces the page; `quiet` (after a command, while waiting for
   * the worker) and `refresh` (the button) keep what is on screen - the
   * reviewer's unsaved editor included - unless Core says the intake or the
   * permission is gone.
   */
  const load = useCallback(async (signal?: AbortSignal, mode: "initial" | "quiet" | "refresh" = "initial") => {
    if (signal?.aborted) return;
    const current = ++generation.current;
    if (mode === "initial") setState("loading");
    const next = await readDatesIntakeDetail(adminCall, intakeId, signal);
    // A reply to an earlier read never replaces a newer one.
    if (signal?.aborted || current !== generation.current) return;
    if (next.kind !== "ready") {
      // A read that merely failed proves nothing: the page stays as it was, and a Refresh says so.
      if (mode !== "initial" && next.kind === "unconfirmed") {
        if (mode === "refresh") setNotice({ tone: "error", key: "detail.refreshFailed" });
        return;
      }
      setResult(null); setOperator(null); revision.current = null; setState("error");
      setProblem(next.kind === "refused" ? { kind: "refused", error: next.error } : { kind: next.kind });
      return;
    }
    const saved = readDatesExternalPending(datesExternalBrowserStorage(), next.operator.principal.email);
    revision.current = next.read.intake.revision; pendingRef.current = saved.kind !== "empty";
    setResult({ read: next.read, draftsEnabled: next.draftsEnabled }); setOperator(next.operator); setPending(saved);
    setProblem(null); setState("ready");
  }, [intakeId]);

  useEffect(() => {
    const controller = new AbortController();
    startedAt.current = Date.now();
    void load(controller.signal);
    return () => { controller.abort(); ++generation.current; ++lifetime.current; };
  }, [load]);

  const intake = result?.read.intake ?? null;
  const status = intake?.status ?? null, mine = intake?.lease?.mine === true;

  // While the worker still owns the intake the page asks again by itself.
  useEffect(() => {
    if (state !== "ready" || status === null) return;
    const delay = datesIntakePollDelay(status, Date.now() - startedAt.current);
    if (delay === null) return;
    const life = lifetime.current;
    // A check that fails changes nothing on the page; the tick keeps the next one coming.
    const timer = setTimeout(() => { void load(undefined, "quiet").finally(() => { if (life === lifetime.current) setTick((value) => value + 1); }); }, delay);
    return () => clearTimeout(timer);
  }, [state, status, tick, load]);

  // The reviewer's hold lasts five minutes; it is renewed while this page is open.
  const firstBeat = useRef(0);
  firstBeat.current = datesIntakeHeartbeatDelay(intake?.lease ?? null, result?.read.server_now ?? 0);
  useEffect(() => {
    if (!mine) return;
    const life = lifetime.current;
    const beat = () => {
      void serial.current(async () => {
        // A saved publish command keeps the revision it was written with.
        if (life !== lifetime.current || busyRef.current || pendingRef.current || revision.current === null) return;
        const expected = revision.current;
        const outcome = await runDatesIntakeLease(adminCall, { intake_id: intakeId, expected_revision: expected, action: "heartbeat" });
        if (life !== lifetime.current) return;
        if (outcome.kind !== "success") { await load(undefined, "quiet"); return; }
        revision.current = outcome.receipt.intake.revision;
        setResult((current) => current && current.read.intake.revision === expected ? { ...current, read: { ...current.read,
          intake: { ...current.read.intake, revision: outcome.receipt.intake.revision, lease: outcome.receipt.intake.lease } } } : current);
      });
    };
    // A hold taken a while ago (from the queue, or before a reload) is renewed before it runs out, not on the next round.
    const early = firstBeat.current < DATES_INTAKE_HEARTBEAT_SECONDS * 1000 ? setTimeout(beat, firstBeat.current) : null;
    const timer = setInterval(beat, DATES_INTAKE_HEARTBEAT_SECONDS * 1000);
    return () => { if (early !== null) clearTimeout(early); clearInterval(timer); };
  }, [mine, intakeId, load]);

  /** One command at a time, each against the newest revision this page holds. */
  async function command(task: (life: number) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    const life = lifetime.current;
    try { await serial.current(() => task(life)); } finally {
      busyRef.current = false;
      if (life === lifetime.current) setBusy(false);
    }
  }

  function lease(action: DatesIntakeLeaseAction) {
    return command(async (life) => {
      if (revision.current === null) return;
      const outcome = await runDatesIntakeLease(adminCall, { intake_id: intakeId, expected_revision: revision.current, action });
      if (life !== lifetime.current) return;
      setNotice(outcome.kind === "success" ? { tone: "success", key: `lease.done.${action}` }
        : outcome.kind === "refused" ? { tone: "error", key: "refused", error: outcome.error } : { tone: "error", key: "lease.uncertain" });
      if (action === "release") { setOpenEvent(null); setCandidate(null); }
      await load(undefined, "quiet");
    });
  }

  function reject(retry: DatesIntakeRejectCommand | null) {
    return command(async (life) => {
      const prepared = retry ?? prepareDatesIntakeReject({ intake_id: intakeId, revision: revision.current }, rejectCode, rejectNote);
      setConfirmReject(false);
      if (!prepared) { setNotice({ tone: "error", key: "reject.invalid" }); return; }
      const outcome = await runDatesIntakeReject(adminCall, prepared);
      if (life !== lifetime.current) return;
      if (outcome.kind === "uncertain") {
        // The same command, with the same identity, is the only safe retry.
        setRejectCommand(prepared); setNotice({ tone: "error", key: "reject.uncertain" });
      } else {
        setRejectCommand(null);
        setNotice(outcome.kind === "success" ? { tone: "success", key: "reject.done" } : { tone: "error", key: "refused", error: outcome.error });
        if (outcome.kind === "success") { setOpenEvent(null); setRejectNote(""); }
      }
      await load(undefined, "quiet");
    });
  }

  function publish(input: { candidate: Candidate } | { retry: DatesExternalPending }) {
    return command(async (life) => {
      const actor = operator?.principal.email;
      if (!actor || ("candidate" in input && revision.current === null)) return;
      const storage = datesExternalBrowserStorage();
      const outcome = await runDatesIntakePublish(adminCall, storage, actor, "retry" in input ? input : { candidate: {
        intake_id: intakeId, intake_revision: revision.current!, event_index: input.candidate.eventIndex, complete: input.candidate.complete,
        event: input.candidate.event, reason: input.candidate.reason } });
      // Once sent, the journal finishes reconciling the receipt even after
      // navigation; only what this page shows is guarded by its lifetime.
      if (life !== lifetime.current) return;
      const saved = readDatesExternalPending(storage, actor);
      pendingRef.current = saved.kind !== "empty"; setPending(saved); setCandidate(null);
      if (outcome.kind === "success") {
        setNotice({ tone: "success", key: outcome.retained ? "publish.doneRetained" : outcome.receipt && "intake" in outcome.receipt
          && outcome.receipt.intake.status === "in_review" ? "publish.donePartial" : "publish.done", eventId: outcome.receipt.external_event_id });
        setOpenEvent(null); setComplete(false);
      } else if (outcome.kind === "refused") {
        setNotice({ tone: "error", key: outcome.retained ? "publish.refusedRetained" : "refused", error: outcome.error });
        if (GONE.includes(outcome.error)) setOpenEvent(null);
      } else setNotice({ tone: "error", key: `publish.${outcome.kind}` });
      await load(undefined, "quiet");
    });
  }

  /**
   * The reviewed form becomes the command to confirm. Whether it closes the
   * intake is implied only when nothing else is left and nothing is unknown;
   * with an event this console could not read it is the reviewer's explicit
   * choice, and the default leaves the intake open.
   */
  function propose(facts: DatesExternalManualEvent, reason: string) {
    if (writeBlocked || !can?.publish || openEvent === null || completion === null) return;
    setCandidate({ eventIndex: openEvent, event: facts, reason, complete: datesIntakeCompleteFlag(completion, complete), unreadable: completion.unreadable });
  }

  const access = { review: operator?.review === true, manage: operator?.manage === true, superadmin: operator?.superadmin === true,
    // Unknown is not "off": Core answers with its own refusal when the switch is off.
    draftsEnabled: result?.draftsEnabled !== false };
  const can = intake ? datesIntakeAffordances(intake, access) : null;
  const publishable = intake ? datesIntakePublishableEvents(intake) : [];
  const events = intake?.events ?? null;
  const editing = openEvent !== null && events ? events[openEvent] ?? null : null;
  const completion = intake && openEvent !== null ? datesIntakeCompletion(intake, openEvent) : null;
  const ownPending = pending.kind === "pending" && pending.pending.action === "dates_event_intake_publish"
    && pending.pending.body.intake_id === intakeId ? pending.pending : null;
  // A hold or a rejection needs no journal; a publication does, and only one command may be outstanding in it.
  const commandBlocked = busy || candidate !== null || ownPending !== null;
  const writeBlocked = busy || candidate !== null || pending.kind !== "empty";
  const otherPending = pending.kind === "pending" && !ownPending ? pending.pending : null;
  const otherTarget = !otherPending ? null : otherPending.action === "dates_event_intake_publish" && datesIntakeId(otherPending.body.intake_id)
    ? `/dates/intakes/${otherPending.body.intake_id}` : otherPending.action === "dates_external_event_publish" ? "/dates/external/new"
      : otherPending.baseline ? `/dates/external/${otherPending.baseline.external_event_id}` : null;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={intake?.first_title ?? t("detail.title")} subtitle={t("detail.subtitle")}
      actions={<div className="row-actions"><Link className="button button-secondary" href="/dates/intakes">{t("detail.back")}</Link>
        <button className="button button-secondary" disabled={busy} onClick={() => { setNotice(null); void load(undefined, result ? "refresh" : "initial"); }}>{common("refresh")}</button></div>} />
    <DatesAdminTabs />
    <p className="alert alert-warning" role="note">{t("aiNotice")}</p>
    {notice && (notice.key === "refused" && notice.error ? <DatesIntakeRefusal error={notice.error} />
      : <p className={`alert alert-${notice.tone}`} role="status">{t(notice.key)}{notice.error ? <> <code>{notice.error}</code></> : null}
        {notice.eventId ? <> <Link href={`/dates/external/${notice.eventId}`}>{t("publish.openEvent")}</Link></> : null}</p>)}
    {state === "loading" && <LoadingPanel />}
    {state === "error" && <>
      {problem?.kind === "refused" && <DatesIntakeRefusal error={problem.error} />}
      <ErrorPanel message={t(problem?.kind === "denied" ? "access.denied" : problem?.kind === "refused" ? "access.refused" : "access.unconfirmed")} retry={() => void load()} />
    </>}
    {operator && pending.kind !== "empty" && <section className="panel dates-external-fields" aria-label={external("pending.title")}>
      <h2>{external("pending.title")}</h2>
      <p className="alert alert-info">{external(pending.kind === "blocked" ? "pending.blocked" : "pending.copy")}</p>
      {ownPending && <>
        <p>{t("publish.pendingEvent", { index: Number(ownPending.body.event_index) + 1 })} · {formatDate(ownPending.issued_at, locale, true)} · <code>{String(ownPending.body.idempotency_key)}</code></p>
        <p className="preserve-whitespace">{String(ownPending.body.reason)}</p>
        <button className="button button-primary" disabled={busy || state !== "ready"} onClick={() => void publish({ retry: ownPending })}>{busy ? common("working") : external("pending.retry")}</button>
      </>}
      {otherPending && otherTarget && <Link className="button button-secondary" href={otherTarget}>{external("pending.open")}</Link>}
    </section>}
    {state === "ready" && intake && can && <>
      <DatesIntakeStatusPanel intake={intake} polling={datesIntakePollDelay(intake.status, Date.now() - startedAt.current) !== null} />

      {intake.status === "in_review" && <section className="panel dates-external-fields" aria-label={t("lease.title")}>
        <h2>{t("lease.title")}</h2>
        <p>{intake.lease === null ? t("lease.unreadable") : !intake.lease.active ? t("lease.free")
          : intake.lease.mine ? t("lease.mineUntil", { time: formatDate(intake.lease.until, locale, true) })
            : t("lease.otherUntil", { holder: intake.lease.holder ?? "—", time: formatDate(intake.lease.until, locale, true) })}</p>
        <p className="field-hint">{t("lease.copy")}</p>
        {!intake.controls && <p className="alert alert-error" role="status">{t("detail.noControls")}</p>}
        {!access.review && <p className="alert alert-info">{t("access.reviewRequired")}</p>}
        <div className="row-actions">
          {can.claim && <button className="button button-primary" disabled={commandBlocked} onClick={() => void lease("claim")}>{t("lease.claim")}</button>}
          {can.release && <button className="button button-secondary" disabled={commandBlocked} onClick={() => void lease("release")}>{t("lease.release")}</button>}
          {can.overrideRelease && <button className="button button-danger" disabled={commandBlocked} onClick={() => void lease("release")}>{t("lease.override")}</button>}
        </div>
      </section>}

      <DatesIntakeInputsPanel intake={intake} />

      <DatesIntakeExtractionPanel intake={intake} manage={access.manage} draftsOff={result?.draftsEnabled === false} />
      {events?.map((event, index) => event === null
        ? <p className="alert alert-error" key={index} role="status">{t("detail.unreadableEvent", { index: index + 1 })}</p>
        : <DatesIntakeEventPanel key={index} event={event} total={events.length}>
          {intake.status === "in_review" && event.published_external_event_id === null && <div className="row-actions">
            {event.editor_unreadable ? <p className="alert alert-error" role="status">{t("editor.unreadable")}</p>
              : event.editor_input === null ? <p className="field-hint">{t("editor.noPrefill")}</p>
                : can.publish ? <button className="button button-primary" disabled={writeBlocked || openEvent === index}
                  onClick={() => { setNotice(null); setComplete(false); setOpenEvent(index); }}>{t("editor.open")}</button>
                  : <p className="field-hint">{t(mine ? "editor.cannotPublish" : "editor.holdFirst")}</p>}
          </div>}
        </DatesIntakeEventPanel>)}

      {editing && editing.editor_input && openEvent !== null && publishable.includes(openEvent) && <section className="panel dates-external-fields" aria-label={t("editor.title")}>
        <div className="row-actions"><h2>{t("editor.title")}: {t("detail.eventTitle", { index: openEvent + 1, total: events?.length ?? 0 })}</h2>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setOpenEvent(null); setCandidate(null); }}>{t("editor.close")}</button></div>
        <p className="alert alert-warning">{t("editor.notice")}</p>
        {/* A lost hold keeps what the reviewer typed; the form only waits for the hold to be taken again. */}
        {!can.publish && <p className="alert alert-info" role="status">{t(mine ? "editor.cannotPublish" : "editor.holdFirst")}</p>}
        {datesIntakeEditorGaps(editing.editor_input).length > 0 && <p className="alert alert-info">{t("editor.gaps", {
          fields: datesIntakeEditorGaps(editing.editor_input).map((gap) => t(`editor.gapFields.${gap}`)).join(", ") })}</p>}
        {completion && <DatesIntakeCompletionChoice completion={completion} close={complete} disabled={writeBlocked} onChange={setComplete} />}
        <DatesExternalEventForm key={`${intakeId}:${openEvent}`} initialDraft={datesIntakeEditorDraft(editing.editor_input)} notice={t("editor.formNotice")}
          disabled={writeBlocked || !can.publish} submitLabel={external("editor.reviewPublish")} onSubmit={propose} />
      </section>}

      <DatesIntakeRunsPanel intake={intake} />

      {intake.status === "in_review" && access.review && <section className="panel dates-external-fields" aria-label={t("reject.title")}>
        <h2>{t("reject.title")}</h2>
        <p>{t("reject.copy")}</p>
        <DatesIntakeRejectWarning intake={intake} />
        {!can.reject && <p className="field-hint">{t(intake.published_count ? "reject.afterPublish" : "reject.holdFirst")}</p>}
        <form onSubmit={(submit) => { submit.preventDefault(); if (can.reject && !commandBlocked && rejectNote.trim() !== "") setConfirmReject(true); }}>
          <fieldset className="dates-external-fields" disabled={!can.reject || commandBlocked}>
            <label className="field"><span>{t("reject.reason")}</span><select value={rejectCode} onChange={(change) => { setRejectCommand(null); setRejectCode(change.target.value); }}>
              {DATES_INTAKE_REJECT_REASONS.map((code) => <option key={code} value={code}>{t(`rejectReasons.${code}`)}</option>)}</select>
              <small>{t("reject.statementHint")}</small></label>
            <label className="field"><span>{t("reject.note")}</span><textarea required rows={2} maxLength={1000} value={rejectNote}
              onChange={(change) => { setRejectCommand(null); setRejectNote(change.target.value); }} /><small>{t("reject.noteHint")}</small></label>
            <div className="row-actions"><button type="submit" className="button button-danger">{t("reject.review")}</button>
              {rejectCommand && <button type="button" className="button button-secondary" onClick={() => void reject(rejectCommand)}>{t("reject.retry")}</button>}</div>
          </fieldset>
        </form>
      </section>}
    </>}
    {confirmReject && <ConfirmDialog title={t("reject.title")} copy={t("reject.confirm")} confirmLabel={t("reject.submit")} busy={busy}
      onCancel={() => { if (!busyRef.current) setConfirmReject(false); }} onConfirm={() => void reject(null)}>
      <p><strong>{t(`rejectReasons.${rejectCode}`)}</strong></p><p className="preserve-whitespace">{rejectNote.trim()}</p>
    </ConfirmDialog>}
    {candidate && <ConfirmDialog title={external("editor.publish")} copy={t("editor.confirm")} confirmLabel={external("editor.publish")} tone="primary" busy={busy}
      onCancel={() => { if (!busyRef.current) setCandidate(null); }} onConfirm={() => void publish({ candidate })}>
      <p><strong>{candidate.event.title}</strong></p>
      <p>{candidate.complete && candidate.unreadable > 0 ? t("editor.confirmCloseUnreadable", { count: candidate.unreadable })
        : t(candidate.complete ? "editor.confirmComplete" : "editor.confirmPartial")}</p>
      <p className="preserve-whitespace">{candidate.reason}</p>
    </ConfirmDialog>}
  </>;
}

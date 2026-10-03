"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesExternalEventForm from "@/components/DatesExternalEventForm";
import DatesIntakeEventPanel from "@/components/DatesIntakeEventPanel";
import DatesIntakeMemberPanel, { DatesIntakeAskSection, DatesIntakeMemberPublishNotes, DatesIntakeMemberRejectNotes, datesIntakeSecondLookOpen, datesIntakeSecondLookStrike,
  type DatesIntakeAskDraft } from "@/components/DatesIntakeMemberPanel";
import { DatesIntakeAlreadySubmitted, DatesIntakeCompletionChoice, DatesIntakeExtractionPanel, DatesIntakeInputsPanel, DatesIntakeRejectWarning, DatesIntakeRunsPanel, DatesIntakeStatusPanel } from "@/components/DatesIntakePanels";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import type { DatesExternalManualEvent } from "@/lib/datesExternalInput";
import { datesExternalBrowserStorage, readDatesExternalPending, type DatesExternalPending, type DatesExternalPendingRead } from "@/lib/datesExternalMutations";
import {
  DATES_INTAKE_HEARTBEAT_SECONDS, DATES_INTAKE_REJECT_REASONS, datesExternalEventId, datesIntakeAffordances, datesIntakeAskState, datesIntakeAskValid, datesIntakeCompleteFlag, datesIntakeCompletion,
  datesIntakeCandidateCurrent, datesIntakeCompletionChoice, datesIntakeEditorDraft, datesIntakeEditorGaps, type DatesIntakeCompletionAnswer,
  datesIntakeHeartbeatDelay, datesIntakeId, datesIntakePublishableEvents,
  type DatesIntakeDetailRead, type DatesIntakeLeaseAction,
} from "@/lib/datesIntakeAdmin";
import {
  createDatesIntakeSerial, datesIntakeLandedOnExisting, datesIntakePollDelay, forgetDatesIntakeLanding, prepareDatesIntakeAsk, prepareDatesIntakeReject, readDatesIntakeDetail,
  runDatesIntakeAsk, runDatesIntakeLease, runDatesIntakePublish, runDatesIntakeReject, type DatesIntakeAskCommand, type DatesIntakeOperator, type DatesIntakeRejectCommand,
} from "@/lib/datesIntakeConsole";
import { formatDate } from "@/lib/format";

type Problem = { kind: "denied" } | { kind: "unconfirmed" } | { kind: "refused"; error: string };
type Notice = { tone: "success" | "error" | "info"; key: string; error?: string; eventId?: string;
  /** A time Core answered with, for a message that names it. */
  time?: number };
type Candidate = { eventIndex: number; event: DatesExternalManualEvent; reason: string; complete: boolean; unreadable: number;
  /** The completion question this publication was prepared for (see `datesIntakeCompletion`). */
  question: string };
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
  const [result, setResult] = useState<{ read: DatesIntakeDetailRead; draftsEnabled: boolean | null; suggestionsEnabled: boolean | null } | null>(null);
  const [operator, setOperator] = useState<DatesIntakeOperator | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<DatesExternalPendingRead>({ kind: "blocked" });
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  // The reviewer's completion choice, with the question it answers: it is never applied to another one.
  const [answer, setAnswer] = useState<DatesIntakeCompletionAnswer | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [rejectCode, setRejectCode] = useState<string>(DATES_INTAKE_REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectCommand, setRejectCommand] = useState<DatesIntakeRejectCommand | null>(null);
  // The event a duplicate is a duplicate OF, as typed or picked; only the reason "duplicate" carries it.
  const [duplicateOf, setDuplicateOf] = useState("");
  const [askDraft, setAskDraft] = useState<DatesIntakeAskDraft | null>(null);
  const [askCommand, setAskCommand] = useState<DatesIntakeAskCommand | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [tick, setTick] = useState(0);
  // The last read could not be used because its revision was unreadable; the page shows the state it last read whole.
  const [staleRead, setStaleRead] = useState(false);
  // Core answered the operator's create with this draft (`existing`): said once, here; a reload does not say it again.
  const [alreadySubmitted, setAlreadySubmitted] = useState(() => datesIntakeLandedOnExisting(intakeId));
  useEffect(() => forgetDatesIntakeLanding, []);
  const generation = useRef(0), lifetime = useRef(0), busyRef = useRef(false), revision = useRef<number | null>(null);
  const serial = useRef(createDatesIntakeSerial()), startedAt = useRef(Date.now()), pendingRef = useRef(false);

  /**
   * `initial` replaces the page; `quiet` (after a command, while waiting for
   * the worker) and `refresh` (the button) keep what is on screen - the
   * reviewer's unsaved editor included - unless Core says the intake or the
   * permission is gone.
   */
  const read = useCallback(async (signal?: AbortSignal, mode: "initial" | "quiet" | "refresh" = "initial") => {
    if (signal?.aborted) return;
    const current = ++generation.current;
    // A first read (or a retry after an error) starts from nothing: the page holds no revision to protect.
    if (mode === "initial") { setState("loading"); revision.current = null; }
    for (let attempt = 0; ; attempt++) {
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
      // The page's revision only moves forward. A body Core served before this page's own heartbeat or
      // command succeeded is older than what the page already holds: it is not adopted, and the read is
      // issued once more instead.
      const served = next.read.intake.revision;
      // A body whose revision this console cannot read proves no newer state. It never replaces a revision the page
      // knows: the page keeps what it last read whole - its hold, its renewal and its controls with it - and says
      // that it could not refresh.
      if (revision.current !== null && served === null) {
        setStaleRead(true);
        if (mode === "refresh") setNotice({ tone: "error", key: "detail.refreshFailed" });
        return;
      }
      if (revision.current !== null && served !== null && served < revision.current) {
        if (attempt === 0) continue;
        if (mode === "refresh") setNotice({ tone: "error", key: "detail.refreshFailed" });
        return;
      }
      const saved = readDatesExternalPending(datesExternalBrowserStorage(), next.operator.principal.email);
      revision.current = served; pendingRef.current = saved.kind !== "empty";
      setResult({ read: next.read, draftsEnabled: next.draftsEnabled, suggestionsEnabled: next.suggestionsEnabled }); setOperator(next.operator); setPending(saved);
      setProblem(null); setState("ready"); setStaleRead(false);
      return;
    }
  }, [intakeId]);

  /**
   * Reads take their turn with the heartbeat and the commands: one queue orders
   * everything that reads or moves the intake's revision, so a slow read can
   * neither overtake a heartbeat nor be overtaken by one. Code that already
   * runs inside the queue (a command, the heartbeat) calls `read` directly.
   */
  const load = useCallback((signal?: AbortSignal, mode: "initial" | "quiet" | "refresh" = "initial") =>
    serial.current(() => read(signal, mode)), [read]);

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
  /** A receipt raises the revision this page holds; nothing ever lowers it. */
  function advance(next: number) {
    if (revision.current === null || next > revision.current) revision.current = next;
  }

  /** One renewal of the hold. It runs inside the queue, with the revision the page holds at that moment. */
  async function heartbeat(life: number) {
    // A saved publish command keeps the revision it was written with.
    if (life !== lifetime.current || busyRef.current || pendingRef.current || revision.current === null) return;
    const expected = revision.current;
    const outcome = await runDatesIntakeLease(adminCall, { intake_id: intakeId, expected_revision: expected, action: "heartbeat" });
    if (life !== lifetime.current) return;
    if (outcome.kind !== "success") { await read(undefined, "quiet"); return; }
    advance(outcome.receipt.intake.revision);
    setResult((current) => current && current.read.intake.revision === expected ? { ...current, read: { ...current.read,
      intake: { ...current.read.intake, revision: outcome.receipt.intake.revision, lease: outcome.receipt.intake.lease } } } : current);
  }
  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;
  useEffect(() => {
    if (!mine) return;
    const life = lifetime.current;
    const beat = () => { void serial.current(() => heartbeatRef.current(life)); };
    // A hold taken a while ago (from the queue, or before a reload) is renewed before it runs out, not on the next round.
    const early = firstBeat.current < DATES_INTAKE_HEARTBEAT_SECONDS * 1000 ? setTimeout(beat, firstBeat.current) : null;
    const timer = setInterval(beat, DATES_INTAKE_HEARTBEAT_SECONDS * 1000);
    return () => { if (early !== null) clearTimeout(early); clearInterval(timer); };
  }, [mine]);

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
      // The receipt is the newest revision this page knows, whatever the read that follows returns.
      if (outcome.kind === "success") advance(outcome.receipt.intake.revision);
      if (life !== lifetime.current) return;
      setNotice(outcome.kind === "success" ? { tone: "success", key: `lease.done.${action}` }
        : outcome.kind === "refused" ? { tone: "error", key: "refused", error: outcome.error }
          : { tone: "error", key: "lease.uncertain", ...(outcome.error === null ? {} : { error: outcome.error }) });
      if (action === "release") { setOpenEvent(null); setCandidate(null); }
      await read(undefined, "quiet");
    });
  }

  function reject(retry: DatesIntakeRejectCommand | null) {
    return command(async (life) => {
      const prepared = retry ?? prepareDatesIntakeReject({ intake_id: intakeId, revision: revision.current }, rejectCode, rejectNote,
        rejectCode === "duplicate" ? duplicateOf : "");
      setConfirmReject(false);
      if (!prepared) { setNotice({ tone: "error", key: "reject.invalid" }); return; }
      const outcome = await runDatesIntakeReject(adminCall, prepared);
      if (outcome.kind === "success") advance(outcome.receipt.intake.revision);
      if (life !== lifetime.current) return;
      if (outcome.kind === "uncertain") {
        // The same command, with the same identity, is the only safe retry.
        setRejectCommand(prepared); setNotice({ tone: "error", key: "reject.uncertain", ...(outcome.error === null ? {} : { error: outcome.error }) });
      } else {
        setRejectCommand(null);
        setNotice(outcome.kind === "success" ? { tone: "success", key: outcome.receipt.intake.status === "duplicate" ? "reject.doneDuplicate" : "reject.done" }
          : { tone: "error", key: "refused", error: outcome.error });
        if (outcome.kind === "success") { setOpenEvent(null); setRejectNote(""); setDuplicateOf(""); }
      }
      await read(undefined, "quiet");
    });
  }

  /** Sends the draft back to the member. Like a rejection, an unanswered request keeps its identity for the retry. */
  function ask(retry: DatesIntakeAskCommand | null) {
    return command(async (life) => {
      const prepared = retry ?? (askDraft ? prepareDatesIntakeAsk({ intake_id: intakeId, revision: revision.current }, askDraft.fields, askDraft.note, askDraft.reason) : null);
      setAskDraft(null);
      if (!prepared) { setNotice({ tone: "error", key: "ask.invalid" }); return; }
      const outcome = await runDatesIntakeAsk(adminCall, prepared);
      if (outcome.kind === "success") advance(outcome.receipt.intake.revision);
      if (life !== lifetime.current) return;
      if (outcome.kind === "uncertain") {
        setAskCommand(prepared); setNotice({ tone: "error", key: "ask.uncertain", ...(outcome.error === null ? {} : { error: outcome.error }) });
      } else {
        setAskCommand(null);
        setNotice(outcome.kind === "success" ? { tone: "success", key: "ask.done", time: outcome.receipt.asked.due_at } : { tone: "error", key: "refused", error: outcome.error });
        // The suggestion left the reviewer's hold with the request: nothing of it stays open here.
        if (outcome.kind === "success") { setOpenEvent(null); setCandidate(null); }
      }
      await read(undefined, "quiet");
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
      if (outcome.kind === "success" && outcome.receipt && "intake" in outcome.receipt) advance(outcome.receipt.intake.revision);
      // Once sent, the journal finishes reconciling the receipt even after
      // navigation; only what this page shows is guarded by its lifetime.
      if (life !== lifetime.current) return;
      const saved = readDatesExternalPending(storage, actor);
      pendingRef.current = saved.kind !== "empty"; setPending(saved); setCandidate(null);
      if (outcome.kind === "success") {
        setNotice({ tone: "success", key: outcome.retained ? "publish.doneRetained" : outcome.receipt && "intake" in outcome.receipt
          && outcome.receipt.intake.status === "in_review" ? "publish.donePartial" : "publish.done", eventId: outcome.receipt.external_event_id });
        setOpenEvent(null); setAnswer(null);
      } else if (outcome.kind === "refused") {
        setNotice({ tone: "error", key: outcome.retained ? "publish.refusedRetained" : "refused", error: outcome.error });
        if (GONE.includes(outcome.error)) setOpenEvent(null);
      } else setNotice({ tone: "error", key: `publish.${outcome.kind}` });
      await read(undefined, "quiet");
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
    setCandidate({ eventIndex: openEvent, event: facts, reason, complete: datesIntakeCompleteFlag(completion, close), unreadable: completion.unreadable,
      question: completion.question });
  }

  const access = { review: operator?.review === true, manage: operator?.manage === true, superadmin: operator?.superadmin === true,
    // Unknown is not "off": Core answers with its own refusal when the switch is off.
    draftsEnabled: result?.draftsEnabled !== false, suggestionsEnabled: result?.suggestionsEnabled !== false };
  const can = intake ? datesIntakeAffordances(intake, access) : null;
  const suggestion = intake?.channel === "member_suggestion";
  const asking = intake ? datesIntakeAskState(intake, { review: access.review, suggestionsEnabled: result?.suggestionsEnabled ?? null }) : null;
  // Events Core's own duplicate check pointed at: offered as the event a duplicate is a duplicate of.
  const duplicateCandidates = [...new Set((intake?.events ?? []).flatMap((event) => (event?.dedupe?.candidates ?? [])
    .flatMap((item) => item.kind === "event" && datesExternalEventId(item.id) ? [item.id] : [])))];
  const namedDuplicate = rejectCode === "duplicate" ? duplicateOf.trim() : "";
  const publishable = intake ? datesIntakePublishableEvents(intake) : [];
  const events = intake?.events ?? null;
  const editing = openEvent !== null && events ? events[openEvent] ?? null : null;
  const completion = intake && openEvent !== null ? datesIntakeCompletion(intake, openEvent) : null;
  // A choice made for one set of events is not an answer to another: after a read that changes the set, or what is
  // unreadable in it, the choice is back at the safe default and the reviewer chooses again.
  const close = datesIntakeCompletionChoice(answer, completion);
  // The same for a publication already waiting for its confirmation.
  const confirmable = datesIntakeCandidateCurrent(candidate, intake) ? candidate : null;
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
    {alreadySubmitted && <DatesIntakeAlreadySubmitted onDismiss={() => setAlreadySubmitted(false)} />}
    {staleRead && state === "ready" && <p className="alert alert-warning" role="status">{t("detail.revisionUnreadable")}</p>}
    {notice && (notice.key === "refused" && notice.error ? <DatesIntakeRefusal error={notice.error} />
      : <p className={`alert alert-${notice.tone}`} role="status">{notice.time === undefined ? t(notice.key) : t(notice.key, { time: formatDate(notice.time, locale, true) })}{notice.error ? <> <code>{notice.error}</code></> : null}
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
      {datesIntakeSecondLookOpen(intake) && <p className="alert alert-warning" role="status">{t("detail.secondLook")}</p>}
      {suggestion && result?.suggestionsEnabled === false && intake.status === "in_review" && <p className="alert alert-info" role="status">{t("detail.suggestionsOff")}
        {" "}<Link href="/dates/configuration">{t("source.disabledLink")}</Link></p>}
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

      <DatesIntakeMemberPanel intake={intake} />

      <DatesIntakeInputsPanel intake={intake} />

      <DatesIntakeExtractionPanel intake={intake} manage={access.manage} draftsOff={result?.draftsEnabled === false} />
      {events?.map((event, index) => event === null
        ? <p className="alert alert-error" key={index} role="status">{t("detail.unreadableEvent", { index: index + 1 })}</p>
        : <DatesIntakeEventPanel key={index} event={event} total={events.length}>
          {intake.status === "in_review" && event.published_external_event_id === null && <div className="row-actions">
            {event.editor_unreadable ? <p className="alert alert-error" role="status">{t("editor.unreadable")}</p>
              : event.editor_input === null ? <p className="field-hint">{t("editor.noPrefill")}</p>
                : can.publish ? <button className="button button-primary" disabled={writeBlocked || openEvent === index}
                  onClick={() => { setNotice(null); setAnswer(null); setCandidate(null); setOpenEvent(index); }}>{t("editor.open")}</button>
                  : <p className="field-hint">{t(!mine ? "editor.holdFirst" : suggestion ? "editor.cannotPublishSuggestion" : "editor.cannotPublish")}</p>}
          </div>}
        </DatesIntakeEventPanel>)}

      {editing && editing.editor_input && openEvent !== null && publishable.includes(openEvent) && <section className="panel dates-external-fields" aria-label={t("editor.title")}>
        <div className="row-actions"><h2>{t("editor.title")}: {t("detail.eventTitle", { index: openEvent + 1, total: events?.length ?? 0 })}</h2>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setOpenEvent(null); setCandidate(null); }}>{t("editor.close")}</button></div>
        <p className="alert alert-warning">{t("editor.notice")}</p>
        {/* A lost hold keeps what the reviewer typed; the form only waits for the hold to be taken again. */}
        {!can.publish && <p className="alert alert-info" role="status">{t(!mine ? "editor.holdFirst" : suggestion ? "editor.cannotPublishSuggestion" : "editor.cannotPublish")}</p>}
        {datesIntakeEditorGaps(editing.editor_input).length > 0 && <p className="alert alert-info">{t("editor.gaps", {
          fields: datesIntakeEditorGaps(editing.editor_input).map((gap) => t(`editor.gapFields.${gap}`)).join(", ") })}</p>}
        {completion && <DatesIntakeCompletionChoice completion={completion} close={close} disabled={writeBlocked}
          onChange={(next) => setAnswer({ question: completion.question, close: next })} />}
        {candidate && !confirmable && <p className="alert alert-warning" role="status">{t("editor.changed")}</p>}
        <DatesExternalEventForm key={`${intakeId}:${openEvent}`} initialDraft={datesIntakeEditorDraft(editing.editor_input)} notice={t("editor.formNotice")}
          disabled={writeBlocked || !can.publish} submitLabel={external("editor.reviewPublish")} onSubmit={propose} />
      </section>}

      <DatesIntakeRunsPanel intake={intake} />

      {asking && <DatesIntakeAskSection state={asking} busy={commandBlocked} retry={askCommand !== null} onChanged={() => setAskCommand(null)}
        onReview={(draft) => { if (datesIntakeAskValid(draft.fields, draft.note, draft.reason)) setAskDraft(draft); else setNotice({ tone: "error", key: "ask.invalid" }); }}
        onRetry={() => { if (askCommand) void ask(askCommand); }} />}

      {intake.status === "in_review" && access.review && <section className="panel dates-external-fields" aria-label={t("reject.title")}>
        <h2>{t("reject.title")}</h2>
        <p>{t("reject.copy")}</p>
        <DatesIntakeRejectWarning intake={intake} />
        {!can.reject && <p className="field-hint">{t(intake.published_count ? "reject.afterPublish" : "reject.holdFirst")}</p>}
        <form onSubmit={(submit) => { submit.preventDefault(); if (!can.reject || commandBlocked || rejectNote.trim() === "") return;
          // A name that is not an event id is said to be one before anything is confirmed; it is never dropped silently.
          if (namedDuplicate !== "" && !datesExternalEventId(namedDuplicate)) { setNotice({ tone: "error", key: "reject.duplicateInvalid" }); return; }
          setConfirmReject(true); }}>
          <fieldset className="dates-external-fields" disabled={!can.reject || commandBlocked}>
            <label className="field"><span>{t("reject.reason")}</span><select value={rejectCode} onChange={(change) => { setRejectCommand(null); setDuplicateOf(""); setRejectCode(change.target.value); }}>
              {DATES_INTAKE_REJECT_REASONS.map((code) => <option key={code} value={code}>{t(`rejectReasons.${code}`)}</option>)}</select>
              <small>{t("reject.statementHint")}</small></label>
            {rejectCode === "duplicate" && <label className="field"><span>{t("reject.duplicateOf")}</span>
              <input type="text" value={duplicateOf} maxLength={36} placeholder="xev_" spellCheck={false} autoComplete="off"
                onChange={(change) => { setRejectCommand(null); setDuplicateOf(change.target.value); }} />
              <small>{t("reject.duplicateOfHint")}</small>
              {namedDuplicate !== "" && !datesExternalEventId(namedDuplicate) && <small role="status">{t("reject.duplicateInvalid")}</small>}
              {duplicateCandidates.length > 0 && <span className="row-actions">{duplicateCandidates.map((candidateId) => <button type="button" className="button button-secondary" key={candidateId}
                onClick={() => { setRejectCommand(null); setDuplicateOf(candidateId); }}>{t("reject.duplicatePick", { id: candidateId })}</button>)}</span>}</label>}
            <DatesIntakeMemberRejectNotes intake={intake} reasonCode={rejectCode} namesEvent={namedDuplicate !== ""} />
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
      <p><strong>{t(`rejectReasons.${rejectCode}`)}</strong></p>
      {namedDuplicate !== "" && <p>{t("reject.confirmDuplicateOf")} <code>{namedDuplicate}</code></p>}
      {intake && <DatesIntakeMemberRejectNotes intake={intake} reasonCode={rejectCode} namesEvent={namedDuplicate !== ""} />}
      <p className="preserve-whitespace">{rejectNote.trim()}</p>
    </ConfirmDialog>}
    {askDraft && <ConfirmDialog title={t("ask.title")} copy={t("ask.confirm")} confirmLabel={t("ask.submit")} tone="primary" busy={busy}
      onCancel={() => { if (!busyRef.current) setAskDraft(null); }} onConfirm={() => void ask(null)}>
      <p><strong>{t("ask.confirmFields", { fields: askDraft.fields.map((field) => t(`memberFieldValues.${field}`)).join(", ") })}</strong></p>
      {askDraft.note.trim() === "" ? <p>{t("ask.confirmNoNote")}</p> : <><p>{t("ask.confirmNote")}</p><blockquote className="preserve-whitespace">{askDraft.note.trim()}</blockquote></>}
      <p className="preserve-whitespace">{askDraft.reason.trim()}</p>
    </ConfirmDialog>}
    {confirmable && <ConfirmDialog title={external("editor.publish")} copy={t("editor.confirm")} confirmLabel={external("editor.publish")} tone="primary" busy={busy}
      onCancel={() => { if (!busyRef.current) setCandidate(null); }} onConfirm={() => void publish({ candidate: confirmable })}>
      <p><strong>{confirmable.event.title}</strong></p>
      {suggestion && intake && <DatesIntakeMemberPublishNotes member={intake.member} events={intake.events?.length ?? 0} secondLookStrike={datesIntakeSecondLookStrike(intake)} />}
      <p>{confirmable.complete && confirmable.unreadable > 0 ? t("editor.confirmCloseUnreadable", { count: confirmable.unreadable })
        : t(confirmable.complete ? "editor.confirmComplete" : "editor.confirmPartial")}</p>
      <p className="preserve-whitespace">{confirmable.reason}</p>
    </ConfirmDialog>}
  </>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import { DatesExternalCorrectionReject, DatesExternalCorrectionView } from "@/components/DatesExternalCorrectionView";
import DatesExternalEventForm from "@/components/DatesExternalEventForm";
import DatesExternalProvenance from "@/components/DatesExternalProvenance";
import DatesExternalRecheckPanel from "@/components/DatesExternalRecheckPanel";
import DatesExternalReviewMark from "@/components/DatesExternalReviewMark";
import DatesExternalWhen from "@/components/DatesExternalWhen";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { DATES_EXTERNAL_COMMANDS, datesExternalCorrections, datesExternalOfficialText, datesExternalUnknownFactsAllowed, decodeDatesExternalDetail, decodeDatesExternalList,
  type DatesExternalCorrection, type DatesExternalDetail, type DatesExternalMutationAction, type DatesExternalMutationBaseline } from "@/lib/datesExternalAdmin";
import { datesExternalCorrectionPrefill } from "@/lib/datesExternalReview";
import { datesExternalBrowserStorage, prepareDatesExternalPending, readDatesExternalMutationAccess, readDatesExternalPending,
  runDatesExternalMutation, type DatesExternalPending, type DatesExternalPendingRead } from "@/lib/datesExternalMutations";
import { formatDate } from "@/lib/format";

type Candidate = { action: DatesExternalMutationAction; body: Record<string, unknown>; baseline: DatesExternalMutationBaseline | null };
const ACTIVITY_COMMANDS = ["end", "soft_delete", "restore", "purge"] as const;
type Command = typeof DATES_EXTERNAL_COMMANDS[number] | typeof ACTIVITY_COMMANDS[number];
type Feedback = { tone: "success" | "error"; key: string };
const FRESH = { source: false, public_venue: false, timezone: false, content_safe: false };

export default function DatesExternalEditorPage({ externalId, correctionId }: { externalId?: string;
  /** D-149 W4: "approve and edit" - the member correction whose proposed values prefill the editor and whose id the save carries. */
  correctionId?: string }) {
  const t = useTranslations("datesAdmin.external"), common = useTranslations("common");
  const locale = useLocale(), router = useRouter();
  const [data, setData] = useState<DatesExternalDetail | null>(null);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [editorOpened, setEditorOpened] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState<DatesExternalPendingRead>({ kind: "blocked" });
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [completedCreate, setCompletedCreate] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [formGeneration, setFormGeneration] = useState(0);
  const [command, setCommand] = useState<Command>("reverify");
  const [commandReason, setCommandReason] = useState("");
  const [commandText, setCommandText] = useState("");
  const [confirmations, setConfirmations] = useState(FRESH);
  const [formDirty, setFormDirty] = useState(false);
  const [rejecting, setRejecting] = useState<DatesExternalCorrection | null>(null);
  // D-149: the correction a status-only approval (cancel / official update) carries, set by its approve button.
  const [commandCorrection, setCommandCorrection] = useState<string | null>(null);
  const generation = useRef(0), lifetime = useRef(0), busyRef = useRef(false);
  const commandsRef = useRef<HTMLElement>(null), commandReasonRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const current = ++generation.current;
    setState("loading");
    if (externalId !== undefined && !/^xev_[a-f0-9]{32}$/.test(externalId)) {
      setPrincipal(null); setCanManage(false); setState("error"); return;
    }
    const [identity, response] = await Promise.all([adminCall("admin_me", {}, signal), externalId
      ? adminCall("dates_external_event_detail", { external_event_id: externalId }, signal)
      : adminCall("dates_external_event_list", { page: 1, limit: 1 }, signal)]);
    if (signal?.aborted || current !== generation.current) return;
    const nextPrincipal = datesAdminPrincipal(identity);
    const detail = externalId ? decodeDatesExternalDetail(response, externalId) : null;
    const decoded = externalId ? detail : decodeDatesExternalList(response, { page: 1, limit: 1 });
    const saved = nextPrincipal ? readDatesExternalPending(datesExternalBrowserStorage(), nextPrincipal.email) : null;
    if (!decoded && nextPrincipal && saved?.kind === "pending" && saved.pending.baseline?.external_event_id === externalId) {
      // A successful purge may have removed the detail before its receipt was
      // received. Recover through independent fresh access, not missing detail.
      const access = await readDatesExternalMutationAccess((action, body) => adminCall(action, body, signal), saved.pending);
      if (signal?.aborted || current !== generation.current) return;
      if (access?.actor === nextPrincipal.email) {
        setData(null); setEditorOpened(false); setPrincipal(nextPrincipal); setCanManage(true); setPending(saved);
        setState("ready"); setFeedback({ tone: "error", key: "recoveryOnly" }); return;
      }
    }
    if (!nextPrincipal || !hasDatesCapability(nextPrincipal, "dates_external_event_read") || !decoded) {
      setPrincipal(null); setCanManage(false); setState("error"); return;
    }
    setData(detail); setPrincipal(nextPrincipal);
    setCanManage(hasDatesCapability(nextPrincipal, "dates_external_event_manage") && decoded.capabilities.includes("dates_external_event_manage"));
    if (hasDatesCapability(nextPrincipal, "dates_external_event_manage") && decoded.capabilities.includes("dates_external_event_manage")) setEditorOpened(true);
    setPending(saved!);
    setNeedsReload(false); setState("ready"); setFormGeneration((value) => value + 1); setFormDirty(false);
    setConfirmations(FRESH); setCommandReason(""); setCommandText(""); setCommandCorrection(null);
  }, [externalId]);

  /**
   * D-149: after the review mark, a re-research or a correction decision changed the event elsewhere. An untouched
   * editor is simply read again; one with unsaved work is never reloaded under it - the page asks for an explicit
   * refresh instead, like any stale revision.
   */
  const eventChangedElsewhere = useCallback(async () => {
    if (!externalId) return;
    if (!formDirty) { await load(); return; }
    let response: unknown = null;
    try { response = await adminCall("dates_external_event_detail", { external_event_id: externalId }); } catch { /* unread */ }
    const detail = decodeDatesExternalDetail(response, externalId);
    // The same revisions: only the review fields moved, the editor's baseline is still current.
    if (detail && data && detail.event.revision === data.event.revision && detail.event.activity_revision === data.event.activity_revision) { setData(detail); return; }
    setNeedsReload(true); setFeedback({ tone: "error", key: "changedElsewhere" });
  }, [externalId, formDirty, load, data]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); ++generation.current; ++lifetime.current; };
  }, [load]);

  function baseline(): DatesExternalMutationBaseline | null {
    if (!data) return null;
    const { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted } = data.event;
    return { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted };
  }
  const event = data?.event;
  // D-149 W4: the event's corrections (v2), and the pending one an "approve and edit" link names.
  const corrections = event && data ? datesExternalCorrections(event, data.server_now) : null;
  const approving = correctionId && corrections ? corrections.rows.find((row) => row.correction_id === correctionId && row.status === "pending") ?? null : null;
  const prefill = approving && event ? datesExternalCorrectionPrefill(event.editor_input, approving) : null;
  // Rejecting a correction is a moderation decision: the review capability (Core-B 4b58099c), not manage.
  const canReview = principal !== null && hasDatesCapability(principal, "dates_external_event_review") && state === "ready";
  const writeLocked = busy || candidate !== null || pending.kind !== "empty" || needsReload || completedCreate || state !== "ready" || !canManage;
  const locked = writeLocked || (externalId !== undefined && !event?.can_edit);
  // P2a: a publication begun from an AI intake is resumed where its draft and its hold are.
  const pendingTarget = pending.kind === "pending" ? (pending.pending.action === "dates_event_intake_publish"
    ? `/dates/intakes/${String(pending.pending.body.intake_id)}` : pending.pending.action === "dates_external_event_publish"
      ? "/dates/external/new" : `/dates/external/${pending.pending.baseline!.external_event_id}`) : null;
  const currentTarget = externalId ? `/dates/external/${externalId}` : "/dates/external/new";

  function commandAllowed(action: Command): boolean {
    if (!event || !principal) return false;
    // Correcting held facts is not permission to write to its read-only thread.
    if (action === "official_update" && event.status === "in_review") return false;
    if (ACTIVITY_COMMANDS.includes(action as typeof ACTIVITY_COMMANDS[number])) {
      if (!hasDatesCapability(principal, "dates_activity_command")) return false;
      if (action === "purge") return event.soft_deleted && hasDatesCapability(principal, "dates_activity_purge");
      if (action === "restore") return event.soft_deleted;
      if (action === "soft_delete") return !event.soft_deleted;
    }
    return event.can_edit;
  }

  async function execute(proposed: Candidate | null, retry: DatesExternalPending | null = null) {
    if (busyRef.current || !principal || (!proposed && !retry)) return;
    busyRef.current = true; setBusy(true); setFeedback(null);
    const currentLifetime = lifetime.current;
    try {
      const access = await readDatesExternalMutationAccess(adminCall, retry ?? proposed ?? undefined);
      if (currentLifetime !== lifetime.current) return;
      if (!access || access.actor !== principal.email || (retry && access.actor !== retry.actor)) {
        setCanManage(false); setFeedback({ tone: "error", key: "access" }); return;
      }
      const operation = retry ?? (proposed && prepareDatesExternalPending(access.actor, proposed.action, proposed.body, proposed.baseline, access.serverNow));
      if (!operation) { setFeedback({ tone: "error", key: "invalid" }); return; }
      const storage = datesExternalBrowserStorage();
      const result = await runDatesExternalMutation(operation, storage, access.serverNow, adminCall);
      // Once dispatched, the durable runner finishes receipt reconciliation even
      // after navigation; only UI state adoption is guarded by this lifetime.
      if (currentLifetime !== lifetime.current) return;
      setPending(readDatesExternalPending(storage, access.actor)); setCandidate(null);
      if (result.kind === "success") {
        // An edit, a cancellation or an official update that carried a correction approved it in the same step.
        const approved = typeof operation.body.correction_id === "string";
        setFeedback({ tone: "success", key: result.retained ? "successRetained" : approved ? "correctionApproved" : "success" });
        if (!result.retained && approved && externalId) router.replace(`/dates/external/${externalId}`);
        if (!result.retained) {
          if ("purged" in result.receipt) { setCompletedCreate(true); router.replace("/dates/external"); }
          else if (operation.action === "dates_external_event_publish") {
            setCompletedCreate(true); router.replace(`/dates/external/${result.receipt.external_event_id}`);
          } else await load();
        }
      } else if (result.kind === "refused") {
        const conflict = ["dates-external-conflict", "dates-external-content-state-invalid", "dates-external-command-state-invalid",
          "dates-external-projection-unavailable", "dates-external-unavailable", "dates-admin-stale-revision",
          "dates-admin-activity-not-deleted", "dates-admin-activity-deleted", "dates-admin-activity-terminal"].includes(result.error);
        setNeedsReload(conflict);
        // D-149: an approval that changed nothing writes nothing (reject the correction instead); one whose correction is
        // no longer pending here cannot approve it.
        const correction = result.error === "dates-correction-no-change" ? "correctionNoChange"
          : ["dates-correction-state-invalid", "dates-correction-unavailable", "dates-correction-action-invalid"].includes(result.error) ? "correctionClosed" : null;
        setFeedback({ tone: "error", key: result.retained ? "refusedRetained" : conflict ? "conflict" : correction !== null ? correction
          : result.error === "dates-external-duplicate" ? "duplicate" : result.error === "dates-external-publishing-disabled" ? "publishingDisabled"
            // D-149 yield: the category's span and the ongoing-start rule, in words.
            : result.error === "dates-external-duration-invalid" ? "durationInvalid" : result.error === "dates-external-start-invalid" ? "startInvalid" : "refused" });
      } else setFeedback({ tone: "error", key: result.kind });
    } finally {
      busyRef.current = false;
      if (currentLifetime === lifetime.current) setBusy(false);
    }
  }

  /** D-149 W3: "Remove" is the withdraw command, with its reason and its confirmation. */
  function startRemove() {
    setCommand("withdraw"); setConfirmations(FRESH); setFeedback(null); setCommandCorrection(null);
    window.requestAnimationFrame(() => { commandsRef.current?.scrollIntoView({ block: "start" }); commandReasonRef.current?.focus(); });
  }

  /**
   * D-149 (Core-B c268ae4b): a status-only correction is approved by the command that says so, with its `correction_id`:
   * "canceled" by recording the organizer's cancellation, "postponed" by an official update.
   */
  function startApproveCommand(action: "cancel" | "official_update") {
    if (!approving) return;
    setCommand(action); setConfirmations(FRESH); setFeedback(null); setCommandCorrection(approving.correction_id);
    window.requestAnimationFrame(() => { commandsRef.current?.scrollIntoView({ block: "start" }); commandReasonRef.current?.focus(); });
  }
  const commandApproves = commandCorrection !== null && approving?.correction_id === commandCorrection && (command === "cancel" || command === "official_update");

  function proposeCommand(submit: React.FormEvent) {
    submit.preventDefault();
    if (writeLocked || !event || !commandAllowed(command)) return;
    if (commandReason.trim().length < 3 || (command === "official_update" && !datesExternalOfficialText(commandText))
      || (command === "reverify" && Object.values(confirmations).some((value) => !value))) {
      setFeedback({ tone: "error", key: "invalid" }); return;
    }
    const generic = ACTIVITY_COMMANDS.includes(command as typeof ACTIVITY_COMMANDS[number]);
    const body: Record<string, unknown> = { ...(generic ? { activity_id: event.activity_id, expected_revision: event.activity_revision }
      : { external_event_id: externalId, expected_revision: event.revision }), action: command, reason: commandReason.trim() };
    if (command === "reverify") body.confirmations = { ...confirmations };
    if (command === "official_update") body.text = commandText;
    if (commandApproves) body.correction_id = commandCorrection;
    setCandidate({ action: generic ? "dates_activity_command" : "dates_external_event_command", body, baseline: baseline() });
  }
  function operationLabel(action: string, body: Record<string, unknown>) {
    return action === "dates_external_event_publish" || action === "dates_event_intake_publish" ? t("editor.publish") : action === "dates_external_event_update"
      ? typeof body.correction_id === "string" ? t("review.approveSave") : t("editor.save") : t(`commands.${String(body.action)}.label`);
  }

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={externalId ? event?.title ?? t("editor.detailTitle") : t("editor.createTitle")}
      subtitle={t("editor.subtitle")} actions={<div className="row-actions"><Link className="button button-secondary" href="/dates/external">{t("editor.back")}</Link>
        {canManage && event && commandAllowed("withdraw") && <button type="button" className="button button-danger" disabled={writeLocked} onClick={startRemove}>{t("review.remove")}</button>}
        <button className="button button-secondary" disabled={busy || candidate !== null} onClick={() => setConfirmReload(true)}>{common("refresh")}</button></div>} />
    <DatesAdminTabs />
    {feedback && <p className={`alert alert-${feedback.tone}`} role="status">{t(`feedback.${feedback.key}`)}</p>}
    {state === "error" && <ErrorPanel message={t("loadError")} retry={() => setConfirmReload(true)} />}
    {state === "loading" && <LoadingPanel />}
    {principal && pending.kind !== "empty" && <section className="panel dates-external-fields" aria-label={t("pending.title")}>
      <h2>{t("pending.title")}</h2><p className="alert alert-info">{t(pending.kind === "blocked" ? "pending.blocked" : "pending.copy")}</p>
      {pending.kind === "pending" && <>
        <strong>{operationLabel(pending.pending.action, pending.pending.body)}</strong>
        <p>{formatDate(pending.pending.issued_at, locale, true)} · <code>{String(pending.pending.body.idempotency_key)}</code></p>
        <p className="preserve-whitespace">{String(pending.pending.body.reason)}</p>
        <details><summary>{t("pending.payload")}</summary><pre className="dates-external-payload">{JSON.stringify(pending.pending.body, null, 2)}</pre></details>
        {pendingTarget !== currentTarget ? <Link className="button button-secondary" href={pendingTarget!}>{t("pending.open")}</Link>
          : <button className="button button-primary" disabled={busy || state !== "ready" || !canManage} onClick={() => void execute(null, pending.pending)}>{busy ? common("working") : t("pending.retry")}</button>}
      </>}
    </section>}
    {event && <section className="panel dates-external-fields">
      <div className="row-actions"><span className="badge badge-demo">{t("badge")}</span>{event.ai_assisted && <span className="badge badge-warning">{t("aiBadge")}</span>}<span>{t(`statusValues.${event.status}`)}</span>
        <span>{t(`tierValues.${event.verification_tier}`)}</span><Link href={`/dates/${event.activity_id}`}>{t("editor.activity")}</Link></div>
      <p>{t("editor.revisions", { ledger: event.revision, activity: event.activity_revision })}</p>
      {event.admin_review && <DatesExternalReviewMark target={event} review={event.admin_review} canManage={canManage && !needsReload} onSettled={() => eventChangedElsewhere()} />}
      {event.possible_duplicate_of && <p className="alert alert-warning">{t("review.duplicateCopy")} <Link href={`/dates/external/${event.possible_duplicate_of}`}>{t("review.duplicateOpen")}</Link></p>}
      {((event.open_corrections ?? 0) > 0 || (event.open_reports ?? 0) > 0) && <p>
        {(event.open_corrections ?? 0) > 0 && <a href="#corrections">{t("review.openCorrections", { count: event.open_corrections ?? 0 })}</a>}
        {(event.open_corrections ?? 0) > 0 && (event.open_reports ?? 0) > 0 && " · "}
        {(event.open_reports ?? 0) > 0 && <Link href={`/dates/${event.activity_id}`}>{t("review.openReports", { count: event.open_reports ?? 0 })}</Link>}</p>}
      <p>{t("editor.moderationNotice")}</p>
      {event.soft_deleted && <p className="alert alert-info">{t("editor.deleted")}</p>}
      <dl className="dates-external-facts">
        <dt>{t("form.category")}</dt><dd>{t(`form.categories.${event.category}`)}</dd>
        <dt>{t("form.summaryEn")}</dt><dd className="preserve-whitespace">{event.facts.summary.en}</dd>
        <dt>{t("form.summaryHu")}</dt><dd className="preserve-whitespace">{event.facts.summary.hu}</dd>
        <dt>{t("form.venueTitle")}</dt><dd>{event.venue.name} · {event.venue.formatted_address} · {event.city} · {event.country_code}<br />{event.venue.point.coordinates[1]}, {event.venue.point.coordinates[0]}</dd>
        <dt>{t("form.timeTitle")}</dt><dd><DatesExternalWhen row={{ ...event, all_day: event.facts.all_day }} now={data!.server_now} detail />
          <div><small><time dateTime={event.start_local}>{event.start_local}</time> — <time dateTime={event.end_local}>{event.end_local}</time> · {event.timezone}</small></div>
          {event.facts.end_estimated && <p>{t("editor.estimated")}</p>}</dd>
        <dt>{t("form.organizerName")}</dt><dd>{event.organizer.name ?? t("unknownFact")}{event.organizer.website && <> · <a href={event.organizer.website} target="_blank" rel="noopener noreferrer">{t("editor.organizerSite")}</a></>}</dd>
        <dt>{t("form.priceText")}</dt><dd>{event.facts.is_free === null ? t("unknownFact") : event.facts.is_free ? t("form.isFree") : event.facts.price_text ?? t("editor.priceUnknown")}{event.facts.age_restriction !== null && <> · {t("editor.minimumAge", { age: event.facts.age_restriction })}</>}</dd>
        <dt>{t("form.attendeeList")}</dt><dd>{t(event.attendee_list === "visible" ? "form.attendeeVisible" : "form.attendeeCountOnly")}{event.sensitive && <> · {event.facts.sensitive.reason}</>}</dd>
      </dl>
      <p>{t("counts", { going: event.going_count, interested: event.interested_count })} · {t("operatorCounts")}</p><p>{t("form.imagePolicy")}</p>
    </section>}
    {event && <DatesExternalProvenance event={event} />}
    {event && data && principal && event.rechecks !== undefined && <DatesExternalRecheckPanel key={formGeneration} event={event} serverNow={data.server_now}
      actor={principal.email} canManage={canManage} onFactsChanged={() => void eventChangedElsewhere()} />}
    {event && corrections && <section className="panel dates-external-fields" id="corrections" aria-labelledby="corrections-title">
      <h2 id="corrections-title">{t("review.correctionsTitle")}</h2>
      {corrections.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("review.unreadableCorrection", { row: row.index + 1 })}{row.id ? <> <code>{row.id}</code></> : null}</p>)}
      {corrections.rows.length === 0 && corrections.unreadable.length === 0 ? <p>{t("review.noCorrections")}</p> : corrections.rows.map((row) =>
        <div className="dates-correction-item" key={row.correction_id}>
          {row.status === "pending" && (canManage || canReview) && <div className="row-actions">
            {canManage && row.correction_id !== correctionId && <Link className="button button-primary button-small" href={`/dates/external/${event.external_event_id}?correction=${row.correction_id}`}>{t("review.approveEdit")}</Link>}
            {canReview && <button type="button" className="button button-danger button-small" onClick={() => setRejecting(row)}>{t("review.reject")}</button>}</div>}
          <DatesExternalCorrectionView correction={row} showEvent={false} /></div>)}
    </section>}
    {principal && !canManage && <p className="alert alert-info">{t("editor.readOnly")}</p>}
    {editorOpened && <section className="panel dates-external-fields">
      <h2>{t(externalId ? "editor.editTitle" : "editor.createTitle")}</h2>
      {externalId && !event?.can_edit && <p className="alert alert-info">{t("editor.terminal")}</p>}
      {event?.status === "in_review" && <p className="alert alert-info">{t("editor.held")}</p>}
      {correctionId && state === "ready" && event && !approving && <p className="alert alert-warning">{t("review.correctionNotPending")}</p>}
      {approving && prefill && <div className="alert alert-info dates-correction-approve" role="status"><strong>{t("review.approveTitle")}</strong>
        <p>{t("review.approveCopy")}</p>
        <DatesExternalCorrectionView correction={approving} showEvent={false} />
        {prefill.venue !== null && <p>{t("review.venueHint", { venue: prefill.venue })}</p>}
        {prefill.status !== null && <p>{t(prefill.status === "canceled" ? "review.statusCanceledHint" : "review.statusPostponedHint")}</p>}
        {prefill.unapplied.length > 0 && <p>{t("review.unappliedHint")}</p>}
        {canManage && prefill.status !== null && <div className="row-actions">
          {prefill.status === "canceled" && <button type="button" className="button button-danger button-small" disabled={writeLocked || !commandAllowed("cancel")}
            onClick={() => startApproveCommand("cancel")}>{t("review.approveCancel")}</button>}
          {prefill.status === "postponed" && <button type="button" className="button button-secondary button-small" disabled={writeLocked || !commandAllowed("official_update")}
            onClick={() => startApproveCommand("official_update")}>{t("review.approvePostponed")}</button>}</div>}</div>}
      <DatesExternalEventForm key={formGeneration} initial={event?.editor_input} initialDraft={prefill?.draft} disabled={locked}
        onEdit={() => setFormDirty(true)} unknownAllowed={externalId !== undefined && event !== undefined && datesExternalUnknownFactsAllowed(event)}
        submitLabel={approving ? t("review.approveReview") : t(externalId ? "editor.reviewSave" : "editor.reviewPublish")} onSubmit={(facts, reason) => {
          if (locked) return;
          setCandidate({ action: externalId ? "dates_external_event_update" : "dates_external_event_publish", baseline: baseline(),
            body: { event: facts, reason, ...(externalId && event ? { external_event_id: externalId, expected_revision: event.revision } : {}),
              ...(externalId && approving ? { correction_id: approving.correction_id } : {}) } });
        }} />
    </section>}
    {canManage && event && <section className="panel dates-external-fields" ref={commandsRef}><h2>{t("editor.commandsTitle")}</h2>
      <form onSubmit={proposeCommand}><fieldset className="dates-external-fields" disabled={writeLocked}>
        <label className="field"><span>{t("editor.command")}</span><select value={command} onChange={(change) => { setCommand(change.target.value as Command); setConfirmations(FRESH); setCommandCorrection(null); }}>
          {[...DATES_EXTERNAL_COMMANDS, ...ACTIVITY_COMMANDS].map((action) => <option key={action} value={action} disabled={!commandAllowed(action)}>{t(`commands.${action}.label`)}</option>)}</select></label>
        <p>{t(`commands.${command}.copy`)}</p>
        {commandApproves && <p className="alert alert-info">{t("review.approveCommandNote")}</p>}
        {command === "reverify" && <div className="dates-checkbox-stack">{Object.keys(FRESH).map((key) => <label key={key} className="checkbox-field"><input type="checkbox" required checked={confirmations[key as keyof typeof FRESH]} onChange={(change) => setConfirmations((value) => ({ ...value, [key]: change.target.checked }))} /><span>{t(`editor.confirmations.${key}`)}</span></label>)}</div>}
        {command === "official_update" && <label className="field"><span>{t("editor.updateText")}</span><textarea required rows={4} maxLength={32000} value={commandText} onChange={(change) => setCommandText(change.target.value)} /></label>}
        <label className="field"><span>{t("form.reason")}</span><textarea ref={commandReasonRef} required minLength={3} maxLength={1000} rows={2} value={commandReason} onChange={(change) => setCommandReason(change.target.value)} /></label>
        <button type="submit" className="button button-secondary" disabled={!commandAllowed(command)}>{t("editor.reviewCommand")}</button>
      </fieldset></form>
    </section>}
    {candidate && <ConfirmDialog title={operationLabel(candidate.action, candidate.body)} copy={candidate.body.action ? t(`commands.${String(candidate.body.action)}.copy`) : t("editor.confirmCopy")}
      confirmLabel={operationLabel(candidate.action, candidate.body)} tone={["withdraw", "cancel", "soft_delete", "purge"].includes(String(candidate.body.action)) ? "danger" : "primary"}
      busy={busy} error={feedback?.tone === "error" ? t(`feedback.${feedback.key}`) : ""}
      onCancel={() => { if (!busyRef.current) setCandidate(null); }} onConfirm={() => void execute(candidate)}>
      <p className="preserve-whitespace">{String(candidate.body.reason)}</p>
      {candidate.body.action === "official_update" && <p className="preserve-whitespace">{String(candidate.body.text)}</p>}
      {typeof candidate.body.correction_id === "string" && candidate.action === "dates_external_event_command" && <p className="alert alert-info">{t("review.approveCommandNote")}</p>}
    </ConfirmDialog>}
    {rejecting && <DatesExternalCorrectionReject correction={rejecting} onCancel={() => setRejecting(null)} onSettled={async (outcome) => {
      const current = rejecting.correction_id === correctionId;
      if (outcome.kind === "success") { setRejecting(null); setFeedback({ tone: "success", key: "correctionRejected" }); }
      // Rejecting the correction this editor was prefilled with ends its approval: the form returns to the stored facts.
      if (outcome.kind === "success" && current && externalId) { router.replace(`/dates/external/${externalId}`); await load(); } else await eventChangedElsewhere();
    }} />}
    {confirmReload && <ConfirmDialog title={common("refresh")} copy={t("editor.reloadCopy")} confirmLabel={common("refresh")} tone="primary"
      onCancel={() => setConfirmReload(false)} onConfirm={() => { setConfirmReload(false); setFeedback(null); void load(); }} />}
  </>;
}

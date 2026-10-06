"use client";

import { adminMembershipRefusalForUi } from "@/lib/adminMembershipClientError";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesExternalEventForm from "@/components/DatesExternalEventForm";
import DatesExternalProvenance from "@/components/DatesExternalProvenance";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { datesAdminPrincipal, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { DATES_EXTERNAL_COMMANDS, datesExternalOfficialText, decodeDatesExternalDetail, decodeDatesExternalList,
  type DatesExternalDetail, type DatesExternalMutationAction, type DatesExternalMutationBaseline } from "@/lib/datesExternalAdmin";
import { datesExternalBrowserStorage, prepareDatesExternalPending, readDatesExternalMutationAccess, readDatesExternalPending,
  runDatesExternalMutation, type DatesExternalPending, type DatesExternalPendingRead } from "@/lib/datesExternalMutations";
import { formatDate } from "@/lib/format";

type Candidate = { action: DatesExternalMutationAction; body: Record<string, unknown>; baseline: DatesExternalMutationBaseline | null };
const ACTIVITY_COMMANDS = ["end", "soft_delete", "restore", "purge"] as const;
type Command = typeof DATES_EXTERNAL_COMMANDS[number] | typeof ACTIVITY_COMMANDS[number];
type Feedback = { tone: "success" | "error"; key: string };
const FRESH = { source: false, public_venue: false, timezone: false, content_safe: false };

export default function DatesExternalEditorPage({ externalId }: { externalId?: string }) {
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
  const generation = useRef(0), lifetime = useRef(0), busyRef = useRef(false);

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
      const access = await readDatesExternalMutationAccess((action, body) => adminCall(action, body, signal).catch(adminMembershipRefusalForUi), saved.pending);
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
    setNeedsReload(false); setState("ready"); setFormGeneration((value) => value + 1);
    setConfirmations(FRESH); setCommandReason(""); setCommandText("");
  }, [externalId]);

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
        setFeedback({ tone: "success", key: result.retained ? "successRetained" : "success" });
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
        setFeedback({ tone: "error", key: result.retained ? "refusedRetained" : conflict ? "conflict"
          : result.error === "dates-external-duplicate" ? "duplicate" : result.error === "dates-external-publishing-disabled" ? "publishingDisabled" : "refused" });
      } else setFeedback({ tone: "error", key: result.kind });
    } finally {
      busyRef.current = false;
      if (currentLifetime === lifetime.current) setBusy(false);
    }
  }

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
    setCandidate({ action: generic ? "dates_activity_command" : "dates_external_event_command", body, baseline: baseline() });
  }
  function operationLabel(action: string, body: Record<string, unknown>) {
    return action === "dates_external_event_publish" || action === "dates_event_intake_publish" ? t("editor.publish") : action === "dates_external_event_update"
      ? t("editor.save") : t(`commands.${String(body.action)}.label`);
  }

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={externalId ? event?.title ?? t("editor.detailTitle") : t("editor.createTitle")}
      subtitle={t("editor.subtitle")} actions={<div className="row-actions"><Link className="button button-secondary" href="/dates/external">{t("editor.back")}</Link>
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
      <p>{t("editor.moderationNotice")}</p>
      {event.soft_deleted && <p className="alert alert-info">{t("editor.deleted")}</p>}
      <dl className="dates-external-facts">
        <dt>{t("form.category")}</dt><dd>{t(`form.categories.${event.category}`)}</dd>
        <dt>{t("form.summaryEn")}</dt><dd className="preserve-whitespace">{event.facts.summary.en}</dd>
        <dt>{t("form.summaryHu")}</dt><dd className="preserve-whitespace">{event.facts.summary.hu}</dd>
        <dt>{t("form.venueTitle")}</dt><dd>{event.venue.name} · {event.venue.formatted_address} · {event.city} · {event.country_code}<br />{event.venue.point.coordinates[1]}, {event.venue.point.coordinates[0]}</dd>
        <dt>{t("form.timeTitle")}</dt><dd><time dateTime={event.start_local}>{event.start_local}</time> — <time dateTime={event.end_local}>{event.end_local}</time> · {event.timezone}{event.facts.end_estimated && <p>{t("editor.estimated")}</p>}</dd>
        <dt>{t("form.organizerName")}</dt><dd>{event.organizer.name}{event.organizer.website && <> · <a href={event.organizer.website} target="_blank" rel="noopener noreferrer">{t("editor.organizerSite")}</a></>}</dd>
        <dt>{t("form.priceText")}</dt><dd>{event.facts.is_free ? t("form.isFree") : event.facts.price_text ?? t("editor.priceUnknown")}{event.facts.age_restriction !== null && <> · {t("editor.minimumAge", { age: event.facts.age_restriction })}</>}</dd>
        <dt>{t("form.attendeeList")}</dt><dd>{t(event.attendee_list === "visible" ? "form.attendeeVisible" : "form.attendeeCountOnly")}{event.sensitive && <> · {event.facts.sensitive.reason}</>}</dd>
      </dl>
      <p>{t("counts", { going: event.going_count, interested: event.interested_count })} · {t("operatorCounts")}</p><p>{t("form.imagePolicy")}</p>
    </section>}
    {event && <DatesExternalProvenance event={event} />}
    {principal && !canManage && <p className="alert alert-info">{t("editor.readOnly")}</p>}
    {editorOpened && <section className="panel dates-external-fields">
      <h2>{t(externalId ? "editor.editTitle" : "editor.createTitle")}</h2>
      {externalId && !event?.can_edit && <p className="alert alert-info">{t("editor.terminal")}</p>}
      {event?.status === "in_review" && <p className="alert alert-info">{t("editor.held")}</p>}
      <DatesExternalEventForm key={formGeneration} initial={event?.editor_input} disabled={locked}
        submitLabel={t(externalId ? "editor.reviewSave" : "editor.reviewPublish")} onSubmit={(facts, reason) => {
          if (locked) return;
          setCandidate({ action: externalId ? "dates_external_event_update" : "dates_external_event_publish", baseline: baseline(),
            body: { event: facts, reason, ...(externalId && event ? { external_event_id: externalId, expected_revision: event.revision } : {}) } });
        }} />
    </section>}
    {canManage && event && <section className="panel dates-external-fields"><h2>{t("editor.commandsTitle")}</h2>
      <form onSubmit={proposeCommand}><fieldset className="dates-external-fields" disabled={writeLocked}>
        <label className="field"><span>{t("editor.command")}</span><select value={command} onChange={(change) => { setCommand(change.target.value as Command); setConfirmations(FRESH); }}>
          {[...DATES_EXTERNAL_COMMANDS, ...ACTIVITY_COMMANDS].map((action) => <option key={action} value={action} disabled={!commandAllowed(action)}>{t(`commands.${action}.label`)}</option>)}</select></label>
        <p>{t(`commands.${command}.copy`)}</p>
        {command === "reverify" && <div className="dates-checkbox-stack">{Object.keys(FRESH).map((key) => <label key={key} className="checkbox-field"><input type="checkbox" required checked={confirmations[key as keyof typeof FRESH]} onChange={(change) => setConfirmations((value) => ({ ...value, [key]: change.target.checked }))} /><span>{t(`editor.confirmations.${key}`)}</span></label>)}</div>}
        {command === "official_update" && <label className="field"><span>{t("editor.updateText")}</span><textarea required rows={4} maxLength={32000} value={commandText} onChange={(change) => setCommandText(change.target.value)} /></label>}
        <label className="field"><span>{t("form.reason")}</span><textarea required minLength={3} maxLength={1000} rows={2} value={commandReason} onChange={(change) => setCommandReason(change.target.value)} /></label>
        <button type="submit" className="button button-secondary" disabled={!commandAllowed(command)}>{t("editor.reviewCommand")}</button>
      </fieldset></form>
    </section>}
    {candidate && <ConfirmDialog title={operationLabel(candidate.action, candidate.body)} copy={candidate.body.action ? t(`commands.${String(candidate.body.action)}.copy`) : t("editor.confirmCopy")}
      confirmLabel={operationLabel(candidate.action, candidate.body)} tone={["withdraw", "cancel", "soft_delete", "purge"].includes(String(candidate.body.action)) ? "danger" : "primary"}
      busy={busy} error={feedback?.tone === "error" ? t(`feedback.${feedback.key}`) : ""}
      onCancel={() => { if (!busyRef.current) setCandidate(null); }} onConfirm={() => void execute(candidate)}>
      <p className="preserve-whitespace">{String(candidate.body.reason)}</p>
      {candidate.body.action === "official_update" && <p className="preserve-whitespace">{String(candidate.body.text)}</p>}
    </ConfirmDialog>}
    {confirmReload && <ConfirmDialog title={common("refresh")} copy={t("editor.reloadCopy")} confirmLabel={common("refresh")} tone="primary"
      onCancel={() => setConfirmReload(false)} onConfirm={() => { setConfirmReload(false); setFeedback(null); void load(); }} />}
  </>;
}

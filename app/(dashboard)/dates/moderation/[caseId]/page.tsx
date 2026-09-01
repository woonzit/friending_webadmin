"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  createAdminIdempotencyKey,
  datesAdminPrincipal,
  epochFromLocalInput,
  hasDatesCapability,
  humanizeMachineKey,
  resolutionActions,
  type DatesAdminPrincipal,
  type DatesCaseSummary,
} from "@/lib/datesAdmin";
import { formatDate } from "@/lib/format";

type ReportRow = {
  report_id: string;
  reason_id: string;
  reason_key: string;
  reason_label_snapshot: unknown;
  entry_point: string;
  note: string | null;
  severity: string;
  status: string;
  created_at: number;
  reporter_identity_redacted: boolean;
};

type CaseDetail = {
  case: DatesCaseSummary;
  reports: ReportRow[];
  decisions: Array<Record<string, unknown>>;
  appeal: Record<string, unknown> | null;
  evidence_requires_separate_audited_read: boolean;
};

type Feedback = { tone: "success" | "error"; text: string };
type ConfirmedOperation = { kind: "resolve" | "legal_hold"; label: string; payload: Record<string, unknown> };

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export default function DatesModerationCasePage() {
  const t = useTranslations("datesAdmin.caseDetail");
  const common = useTranslations("common");
  const locale = useLocale();
  const params = useParams<{ caseId: string }>();
  const caseId = useMemo(() => decodeURIComponent(params.caseId || ""), [params.caseId]);
  const [data, setData] = useState<CaseDetail | null>(null);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [evidence, setEvidence] = useState<Array<Record<string, unknown>> | null>(null);
  const [evidenceRedacted, setEvidenceRedacted] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedOperation | null>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [evidenceSensitive, setEvidenceSensitive] = useState(false);
  const [evidenceReason, setEvidenceReason] = useState("");
  const [trailFrom, setTrailFrom] = useState("");
  const [trailTo, setTrailTo] = useState("");
  const [trailReason, setTrailReason] = useState("");
  const [note, setNote] = useState("");
  const [noteReason, setNoteReason] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [resolutionAction, setResolutionAction] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [visibleReasonEn, setVisibleReasonEn] = useState("");
  const [visibleReasonHu, setVisibleReasonHu] = useState("");
  const [restrictionExpiry, setRestrictionExpiry] = useState("");
  const [holdAction, setHoldAction] = useState("place");
  const [holdReason, setHoldReason] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [holdReviewAt, setHoldReviewAt] = useState("");

  const load = useCallback(async () => {
    if (!/^cas_[A-Za-z0-9_-]+$/.test(caseId)) {
      setState("not-found");
      return;
    }
    if (!data) setState("loading");
    const [response, identity] = await Promise.all([
      adminCall("dates_moderation_detail", { case_id: caseId }),
      adminCall("admin_me"),
    ]);
    if (response?.error === "dates-moderation-case-unavailable") {
      setState("not-found");
      return;
    }
    const nextPrincipal = datesAdminPrincipal(identity);
    if (!response?.success || !response.case || !nextPrincipal) {
      setPrincipal(null);
      setState("error");
      return;
    }
    const next = response as unknown as CaseDetail;
    setData(next);
    setPrincipal(nextPrincipal);
    setResolutionAction((current) => current || resolutionActions(next.case)[0] || "dismiss");
    setState("ready");
  }, [caseId, data]);

  useEffect(() => { void load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutate(action: string, payload: Record<string, unknown>, successMessage: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    const response = await adminCall(action, payload);
    setBusy(false);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return false;
    }
    setFeedback({ tone: "success", text: successMessage });
    await load();
    return true;
  }

  async function claim() {
    if (!data) return;
    const usedBreakGlass = data.case.conflict_of_interest && breakGlass;
    if (usedBreakGlass && breakGlassReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("breakGlassReasonRequired") });
      return;
    }
    await mutate("dates_moderation_claim", {
      case_id: caseId,
      expected_revision: data.case.revision,
      break_glass: usedBreakGlass,
      reason: usedBreakGlass ? breakGlassReason.trim() : null,
      idempotency_key: createAdminIdempotencyKey("dates-case-claim"),
    }, t("claimed"));
  }

  async function lease(operation: "heartbeat" | "release") {
    if (!data) return;
    await mutate(`dates_moderation_${operation}`, {
      case_id: caseId,
      expected_revision: data.case.revision,
      reason: breakGlassReason.trim() || null,
      idempotency_key: createAdminIdempotencyKey(`dates-case-${operation}`),
    }, t(operation === "heartbeat" ? "leaseExtended" : "released"));
  }

  async function readEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy) return;
    const conflictBreakGlass = data.case.conflict_of_interest && breakGlass;
    if ((evidenceSensitive || conflictBreakGlass) && evidenceReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("evidenceReasonRequired") });
      return;
    }
    setBusy(true);
    const response = await adminCall("dates_moderation_evidence", {
      case_id: caseId,
      include_sensitive_location: evidenceSensitive,
      break_glass: conflictBreakGlass,
      reason: evidenceReason.trim() || null,
    });
    setBusy(false);
    if (!response?.success || !Array.isArray(response.evidence)) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return;
    }
    setEvidence(response.evidence as Array<Record<string, unknown>>);
    setEvidenceRedacted(Number(response.redacted_sensitive_location_count) || 0);
    setFeedback({ tone: "success", text: t("evidenceLoaded") });
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!data || note.trim().length < 1) return;
    if (data.case.conflict_of_interest && breakGlass && noteReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("breakGlassReasonRequired") });
      return;
    }
    const ok = await mutate("dates_moderation_note", {
      case_id: caseId,
      expected_revision: data.case.revision,
      note: note.trim(),
      break_glass: data.case.conflict_of_interest && breakGlass,
      reason: noteReason.trim() || null,
      idempotency_key: createAdminIdempotencyKey("dates-case-note"),
    }, t("noteAdded"));
    if (ok) { setNote(""); setNoteReason(""); }
  }

  async function captureTrailEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy || !data.case.activity_id) return;
    const capturedFrom = epochFromLocalInput(trailFrom);
    const capturedTo = epochFromLocalInput(trailTo);
    if (!capturedFrom || !capturedTo || capturedTo <= capturedFrom || trailReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("trailEvidenceInputInvalid") });
      return;
    }
    const ok = await mutate("dates_moderation_trail_evidence", {
      case_id: caseId,
      expected_revision: data.case.revision,
      captured_from: capturedFrom,
      captured_to: capturedTo,
      reason: trailReason.trim(),
      break_glass: data.case.conflict_of_interest && breakGlass,
      idempotency_key: createAdminIdempotencyKey("dates-case-trail-evidence"),
    }, t("trailEvidenceCaptured"));
    if (ok) {
      setTrailFrom("");
      setTrailTo("");
      setTrailReason("");
      setEvidence(null);
    }
  }

  async function escalate(event: React.FormEvent) {
    event.preventDefault();
    if (!data || escalationReason.trim().length < 3) return;
    const ok = await mutate("dates_moderation_escalate", {
      case_id: caseId,
      expected_revision: data.case.revision,
      reason: escalationReason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-case-escalate"),
    }, t("escalated"));
    if (ok) setEscalationReason("");
  }

  function prepareResolution(event: React.FormEvent) {
    event.preventDefault();
    if (!data || resolutionReason.trim().length < 3 || visibleReasonEn.trim().length < 1 || visibleReasonHu.trim().length < 1) return;
    setConfirmed({
      kind: "resolve",
      label: t(`actions.${resolutionAction}`),
      payload: {
        case_id: caseId,
        expected_revision: data.case.revision,
        action: resolutionAction,
        reason: resolutionReason.trim(),
        user_visible_reason_en: visibleReasonEn.trim(),
        user_visible_reason_hu: visibleReasonHu.trim(),
        expires_at: resolutionAction === "restrict_dates" ? epochFromLocalInput(restrictionExpiry) : null,
        break_glass: data.case.conflict_of_interest && breakGlass,
        idempotency_key: createAdminIdempotencyKey("dates-case-resolve"),
      },
    });
  }

  function prepareLegalHold(event: React.FormEvent) {
    event.preventDefault();
    if (holdReason.trim().length < 3 || legalBasis.trim().length < 3 || (holdAction === "place" && !holdReviewAt)) return;
    setConfirmed({
      kind: "legal_hold",
      label: t(holdAction === "place" ? "placeHold" : "releaseHold"),
      payload: {
        case_id: caseId,
        action: holdAction,
        reason: holdReason.trim(),
        legal_basis: legalBasis.trim(),
        review_at: holdAction === "place" ? epochFromLocalInput(holdReviewAt) : null,
        idempotency_key: createAdminIdempotencyKey(`dates-legal-hold-${holdAction}`),
      },
    });
  }

  async function executeConfirmed() {
    if (!confirmed) return;
    const operation = confirmed;
    const ok = await mutate(operation.kind === "resolve" ? "dates_moderation_resolve" : "dates_moderation_legal_hold", operation.payload, t(operation.kind === "resolve" ? "resolved" : "legalHoldUpdated"));
    setConfirmed(null);
    if (ok && operation.kind === "resolve") {
      setResolutionReason(""); setVisibleReasonEn(""); setVisibleReasonHu(""); setRestrictionExpiry("");
    }
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") return <ErrorPanel message={t("notFound")} retry={() => void load()} />;
  if (state === "error" || !data || !principal) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const item = data.case;
  const assignedToMe = item.assignee_email?.toLowerCase() === principal.email.toLowerCase();
  const leaseActive = (item.claim_expires_at || 0) > Math.floor(Date.now() / 1000);
  const canBreakGlass = item.capabilities.can_break_glass && principal.break_glass;
  const mayClaim = item.capabilities.can_claim || (item.conflict_of_interest && canBreakGlass);
  const mayReadEvidence = item.capabilities.can_read_evidence || (item.conflict_of_interest && canBreakGlass);
  const mayCaptureTrail = Boolean(
    item.activity_id
    && principal.sensitive_location
    && hasDatesCapability(principal, "dates_trail_evidence_capture")
    && (!item.conflict_of_interest || (canBreakGlass && breakGlass)),
  );
  const mayResolve = item.capabilities.can_resolve || (item.conflict_of_interest && canBreakGlass && assignedToMe && leaseActive);
  const actions = resolutionActions(item);

  return (
    <>
      <Link className="back-link" href="/dates/moderation">← {t("back")}</Link>
      <PageHeader eyebrow={t("eyebrow")} title={item.case_id} subtitle={t("subtitle", { queue: humanizeMachineKey(item.queue), revision: item.revision })} actions={<button className="button button-secondary" onClick={() => void load()} disabled={busy}>{common("refresh")}</button>} />
      <DatesAdminTabs />
      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}</div>}
      {item.conflict_of_interest && <div className="alert alert-error page-alert"><strong>{t("conflictTitle")}</strong> {t("conflictCopy")}</div>}

      <div className="dates-detail-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("caseOverview")}</h2><p>{t("caseOverviewCopy")}</p></div><div className="row-actions"><span className={`badge ${["new", "in_review", "appealed"].includes(item.status) ? "badge-warning" : "badge-active"}`}>{humanizeMachineKey(item.status)}</span><span className={`badge ${["high", "critical"].includes(item.severity) ? "badge-warning" : ""}`}>{humanizeMachineKey(item.severity)}</span></div></div>
          <div className="panel-body"><dl className="detail-list">
            <div className="detail-row"><dt>{t("queue")}</dt><dd>{humanizeMachineKey(item.queue)} · {humanizeMachineKey(item.case_kind)}</dd></div>
            <div className="detail-row"><dt>{t("target")}</dt><dd>{humanizeMachineKey(item.target_type)} · {item.target_id}</dd></div>
            <div className="detail-row"><dt>{t("subject")}</dt><dd>UID {item.target_uid}{item.activity_id ? ` · ${item.activity_id}` : ""}</dd></div>
            <div className="detail-row"><dt>{t("reports")}</dt><dd>{item.report_count} · {t("distinctReporters", { count: item.distinct_reporter_count })}</dd></div>
            <div className="detail-row"><dt>{t("assignee")}</dt><dd>{item.assignee_email || t("unassigned")}</dd></div>
            <div className="detail-row"><dt>{t("claimExpiry")}</dt><dd>{item.claim_expires_at ? formatDate(item.claim_expires_at, locale, true) : "—"}</dd></div>
            <div className="detail-row"><dt>{t("slaDue")}</dt><dd className={item.sla_breached ? "dates-danger-text" : ""}>{item.sla_due_at ? formatDate(item.sla_due_at, locale, true) : "—"}{item.sla_breached ? ` · ${t("breached")}` : ""}</dd></div>
            <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{formatDate(item.created_at, locale, true)}</dd></div>
          </dl></div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("claimTitle")}</h2><p>{t("claimCopy")}</p></div></div>
          <div className="panel-body form-stack">
            {item.conflict_of_interest && canBreakGlass && <><label className="checkbox-field"><input type="checkbox" checked={breakGlass} onChange={(event) => setBreakGlass(event.target.checked)} /><span>{t("useBreakGlass")}</span></label><label className="field"><span>{t("breakGlassReason")}</span><textarea required={breakGlass} value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} /></label></>}
            <div className="row-actions">
              {mayClaim && <button className="button button-primary" onClick={() => void claim()} disabled={busy || (item.conflict_of_interest && !breakGlass)}>{t("claim")}</button>}
              {assignedToMe && leaseActive && <><button className="button button-secondary" onClick={() => void lease("heartbeat")} disabled={busy}>{t("heartbeat")}</button><button className="button button-danger" onClick={() => void lease("release")} disabled={busy}>{t("release")}</button></>}
            </div>
            {!mayClaim && !assignedToMe && <p className="page-subtitle">{t("claimUnavailable")}</p>}
          </div>
        </section>
      </div>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("reportsTitle")}</h2><p>{t("reportsCopy")}</p></div></div>
        <div className="table-wrap dates-embedded-table">{data.reports.length === 0 ? <div className="empty-state dates-compact-empty"><p>{t("noReports")}</p></div> : <table className="data-table"><thead><tr><th>{t("reportId")}</th><th>{t("reason")}</th><th>{t("entryPoint")}</th><th>{t("note")}</th><th>{common("createdAt")}</th></tr></thead><tbody>{data.reports.map((report) => <tr key={report.report_id}><td>{report.report_id}</td><td><div className="cell-stack"><span>{displayReason(report.reason_label_snapshot, locale)}</span><small>{report.reason_key} · {humanizeMachineKey(report.severity)}</small></div></td><td>{humanizeMachineKey(report.entry_point)}</td><td className="dates-wrapping-cell">{report.note || "—"}</td><td>{formatDate(report.created_at, locale, true)}</td></tr>)}</tbody></table>}</div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("evidenceTitle")}</h2><p>{t("evidenceCopy")}</p></div></div>
        <div className="panel-body">
          {!mayReadEvidence ? <p className="page-subtitle">{t("evidenceUnavailable")}</p> : <form className="dates-evidence-controls" onSubmit={readEvidence}>
            {principal.sensitive_location && <label className="checkbox-field"><input type="checkbox" checked={evidenceSensitive} onChange={(event) => setEvidenceSensitive(event.target.checked)} /><span>{t("includeSensitiveLocation")}</span></label>}
            <label className="field"><span>{t("auditReason")}</span><input value={evidenceReason} required={evidenceSensitive || (item.conflict_of_interest && breakGlass)} onChange={(event) => setEvidenceReason(event.target.value)} placeholder={t("auditReasonPlaceholder")} /></label>
            <button className="button button-danger" type="submit" disabled={busy || (item.conflict_of_interest && !breakGlass)}>{t("readEvidence")}</button>
          </form>}
          {evidence && <div className="dates-evidence-list">{evidence.length === 0 ? <p className="page-subtitle">{t("noEvidence")}</p> : evidence.map((entry, index) => <article key={String(entry.evidence_id || index)}><div className="dates-evidence-header"><strong>{String(entry.evidence_id || t("evidenceItem", { index: index + 1 }))}</strong><span className="badge">{humanizeMachineKey(String(entry.evidence_type || entry.kind || "evidence"))}</span></div><pre>{safeJson(entry)}</pre></article>)}{evidenceRedacted > 0 && <p className="alert alert-info">{t("redactedEvidence", { count: evidenceRedacted })}</p>}</div>}
        </div>
      </section>

      {principal.sensitive_location && hasDatesCapability(principal, "dates_trail_evidence_capture") && item.activity_id && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("trailEvidenceTitle")}</h2><p>{t("trailEvidenceCopy")}</p></div></div>
        <div className="panel-body">
          <form className="dates-evidence-controls" onSubmit={captureTrailEvidence}>
            <label className="field"><span>{t("trailFrom")}</span><input type="datetime-local" required value={trailFrom} onChange={(event) => setTrailFrom(event.target.value)} /></label>
            <label className="field"><span>{t("trailTo")}</span><input type="datetime-local" required value={trailTo} onChange={(event) => setTrailTo(event.target.value)} /></label>
            <label className="field"><span>{t("trailReason")}</span><input required minLength={3} maxLength={500} value={trailReason} onChange={(event) => setTrailReason(event.target.value)} /></label>
            <button className="button button-danger" type="submit" disabled={busy || !mayCaptureTrail}>{t("captureTrailEvidence")}</button>
          </form>
        </div>
      </section>}

      {assignedToMe && leaseActive && <div className="section-grid dates-section">
        {hasDatesCapability(principal, "dates_case_note") && <section className="panel"><div className="panel-header"><div><h2>{t("noteTitle")}</h2><p>{t("noteCopy")}</p></div></div><form className="panel-body form-stack" onSubmit={addNote}><label className="field"><span>{t("internalNote")}</span><textarea required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label><label className="field"><span>{t("auditReasonOptional")}</span><input value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={busy}>{t("addNote")}</button></form></section>}
        {hasDatesCapability(principal, "dates_case_resolve") && !item.conflict_of_interest && <section className="panel"><div className="panel-header"><div><h2>{t("escalateTitle")}</h2><p>{t("escalateCopy")}</p></div></div><form className="panel-body form-stack" onSubmit={escalate}><label className="field"><span>{t("auditReason")}</span><textarea required value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} /></label><button className="button button-danger" type="submit" disabled={busy || item.escalated}>{item.escalated ? t("alreadyEscalated") : t("escalate")}</button></form></section>}
      </div>}

      {mayResolve && <section className="panel dates-section dates-resolution-panel">
        <div className="panel-header"><div><h2>{t("resolutionTitle")}</h2><p>{t("resolutionCopy")}</p></div></div>
        <form className="panel-body form-grid" onSubmit={prepareResolution}>
          <label className="field"><span>{t("action")}</span><select value={resolutionAction} onChange={(event) => setResolutionAction(event.target.value)}>{actions.map((action) => <option key={action} value={action}>{t(`actions.${action}`)}</option>)}</select></label>
          {resolutionAction === "restrict_dates" && <label className="field"><span>{t("restrictionExpiry")}</span><input type="datetime-local" value={restrictionExpiry} onChange={(event) => setRestrictionExpiry(event.target.value)} /></label>}
          <label className="field field-full"><span>{t("internalReason")}</span><textarea required maxLength={1000} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} /></label>
          <label className="field"><span>{t("visibleReasonEn")}</span><textarea required maxLength={500} value={visibleReasonEn} onChange={(event) => setVisibleReasonEn(event.target.value)} /></label>
          <label className="field"><span>{t("visibleReasonHu")}</span><textarea required maxLength={500} value={visibleReasonHu} onChange={(event) => setVisibleReasonHu(event.target.value)} /></label>
          <div className="field-full"><button className="button button-danger" type="submit" disabled={busy || (item.conflict_of_interest && !breakGlass)}>{t("prepareResolution")}</button></div>
        </form>
      </section>}

      {hasDatesCapability(principal, "dates_legal_hold") && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("legalHoldTitle")}</h2><p>{t("legalHoldCopy")}</p></div></div>
        <form className="panel-body form-grid" onSubmit={prepareLegalHold}>
          <label className="field"><span>{t("holdAction")}</span><select value={holdAction} onChange={(event) => setHoldAction(event.target.value)}><option value="place">{t("placeHold")}</option><option value="release">{t("releaseHold")}</option></select></label>
          {holdAction === "place" && <label className="field"><span>{t("reviewAt")}</span><input type="datetime-local" required value={holdReviewAt} onChange={(event) => setHoldReviewAt(event.target.value)} /></label>}
          <label className="field"><span>{t("auditReason")}</span><textarea required value={holdReason} onChange={(event) => setHoldReason(event.target.value)} /></label>
          <label className="field"><span>{t("legalBasis")}</span><textarea required value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)} /></label>
          <div className="field-full"><button className="button button-danger" type="submit" disabled={busy}>{t("prepareLegalHold")}</button></div>
        </form>
      </section>}

      {(data.decisions.length > 0 || data.appeal) && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("historyTitle")}</h2><p>{t("historyCopy")}</p></div></div>
        <div className="panel-body dates-evidence-list">{data.appeal && <article><div className="dates-evidence-header"><strong>{t("appeal")}</strong></div><pre>{safeJson(data.appeal)}</pre></article>}{data.decisions.map((decision, index) => <article key={String(decision.decision_id || index)}><div className="dates-evidence-header"><strong>{String(decision.decision_id || t("decision", { index: index + 1 }))}</strong></div><pre>{safeJson(decision)}</pre></article>)}</div>
      </section>}

      {confirmed && <ConfirmDialog title={t("confirmTitle", { action: confirmed.label })} copy={t("confirmCopy")} confirmLabel={t("confirmAction")} busy={busy} onCancel={() => setConfirmed(null)} onConfirm={() => void executeConfirmed()} />}
    </>
  );
}

function displayReason(value: unknown, locale: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    const key = locale.startsWith("hu") ? "hu" : "en";
    return String(row[key] || row.en || row.hu || "—");
  }
  return value ? String(value) : "—";
}

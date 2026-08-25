"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  REPORTED_CONTENT_CONTRACT_VERSION,
  REPORTED_CONTENT_DECISIONS,
  isReportedContentReportId,
  normalizeReportedContentReason,
  reportedContentActionResponse,
  reportedContentCanDecide,
  reportedContentConflictResponse,
  reportedContentDecisionConverged,
  reportedContentDecisionPayload,
  reportedContentErrorKey,
  reportedContentErrorResponse,
  reportedContentListResponse,
  reportedContentPayloadFromPending,
  reportedContentPendingDecision,
  reportedContentPendingFromPayload,
  reportedContentPendingStorageKey,
  reportedContentPersistBeforeMutation,
  reportedContentReportConverged,
  reportedContentShouldRetainDecision,
  type ReportedContentDecision,
  type ReportedContentPendingDecision,
  type ReportedContentPrincipal,
  type ReportedContentReport,
} from "@/lib/reportedContent";

type Notice = { tone: "success" | "error" | "info"; text: string };

function decodedReportId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function identityLabel(identity: ReportedContentReport["reporter"]): string {
  return identity.display_name || identity.username || `#${identity.uid}`;
}

export default function ReportedContentDetail() {
  const t = useTranslations("reportedContent.detail");
  const common = useTranslations("common");
  const locale = useLocale();
  const params = useParams<{ reportId: string }>();
  const id = useMemo(() => decodedReportId(params.reportId || ""), [params.reportId]);
  const [report, setReport] = useState<ReportedContentReport | null>(null);
  const [principal, setPrincipal] = useState<ReportedContentPrincipal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [action, setAction] = useState<ReportedContentDecision>("confirmed");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<ReportedContentPendingDecision | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const pendingRef = useRef<ReportedContentPendingDecision | null>(null);

  const rememberPending = useCallback((value: ReportedContentPendingDecision | null): boolean => {
    if (!isReportedContentReportId(id)) return false;
    const key = reportedContentPendingStorageKey(id);
    try {
      if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
      else window.sessionStorage.removeItem(key);
    } catch {
      setStorageAvailable(false);
      // A terminal result still clears its in-memory retry control. A reload
      // will reconcile any stale storage entry against authoritative state.
      if (value === null) {
        pendingRef.current = null;
        setPending(null);
      }
      return false;
    }
    pendingRef.current = value;
    setPending(value);
    setStorageAvailable(true);
    return true;
  }, [id]);

  const load = useCallback(async () => {
    if (!isReportedContentReportId(id)) {
      setState("not-found");
      return;
    }
    if (!report) setState("loading");
    const response = await adminCall("moderation_reported_list", {
      contract_version: REPORTED_CONTENT_CONTRACT_VERSION,
      report_id: id,
      page_size: 1,
    });
    const parsed = reportedContentListResponse(response);
    if (!parsed || parsed.filter.report_id !== id || parsed.reports.length > 1) {
      setState("error");
      return;
    }
    if (parsed.reports.length === 0) {
      rememberPending(null);
      setState("not-found");
      return;
    }
    const current = parsed.reports[0];
    const durable = pendingRef.current;
    setPrincipal(parsed.principal);
    setReport(current);
    if (durable && reportedContentReportConverged(current, durable)) {
      const cleared = rememberPending(null);
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t("decisionObserved") : t("errors.persistenceCleanupFailed"),
      });
    } else if (
      durable
      && (current.status !== "pending" || current.revision !== durable.expectedRevision)
    ) {
      rememberPending(null);
      setNotice({ tone: "error", text: t("errors.conflict") });
    }
    setState("ready");
  }, [id, rememberPending, report, t]);

  useEffect(() => {
    if (!isReportedContentReportId(id)) {
      setState("not-found");
      return;
    }
    let serialized: string | null;
    try {
      serialized = window.sessionStorage.getItem(reportedContentPendingStorageKey(id));
    } catch {
      setStorageAvailable(false);
      setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
      void load();
      return;
    }
    if (serialized) {
      try {
        const restored = reportedContentPendingDecision(JSON.parse(serialized));
        if (restored && restored.reportId === id) {
          pendingRef.current = restored;
          setPending(restored);
          setAction(restored.action);
          setReason(restored.reason);
          setStorageAvailable(true);
        } else {
          rememberPending(null);
        }
      } catch {
        rememberPending(null);
      }
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function prepareDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!report || pending || busy) return;
    if (!storageAvailable) {
      setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
      return;
    }
    if (!normalizeReportedContentReason(reason)) {
      setNotice({ tone: "error", text: t("errors.reasonInvalid") });
      return;
    }
    setConfirming(true);
  }

  async function executeDecision() {
    if (!report || busy) return;
    const payload = pending
      ? reportedContentPayloadFromPending(pending)
      : reportedContentDecisionPayload(report, action, reason, crypto.randomUUID());
    if (!payload) {
      setConfirming(false);
      setNotice({ tone: "error", text: t("errors.reasonInvalid") });
      return;
    }

    const durable = pending ?? reportedContentPendingFromPayload(payload);
    const persisted = await reportedContentPersistBeforeMutation(
      window.sessionStorage,
      durable,
      async () => {
        pendingRef.current = durable;
        setPending(durable);
        setStorageAvailable(true);
        setBusy(true);
        setConfirming(false);
        setNotice(null);
        return adminCall("moderation_report_action", payload);
      },
    );
    if (!persisted.ok) {
      setStorageAvailable(false);
      setConfirming(false);
      setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
      return;
    }
    const response = persisted.response;
    const result = reportedContentActionResponse(response);
    if (result && reportedContentDecisionConverged(result, durable)) {
      setReport(result.report);
      const cleared = rememberPending(null);
      setReason("");
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared
          ? result.replayed ? t("decisionReplayed") : t("decisionSaved")
          : t("errors.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    const conflict = reportedContentConflictResponse(response);
    if (conflict && conflict.report.report_id === durable.reportId) {
      setReport(conflict.report);
      rememberPending(null);
      setNotice({ tone: "error", text: t("errors.conflict") });
      setBusy(false);
      return;
    }

    const error = reportedContentErrorResponse(response);
    if (!reportedContentShouldRetainDecision(error)) rememberPending(null);
    setNotice({ tone: "error", text: t(`errors.${reportedContentErrorKey(error)}`) });
    setBusy(false);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") {
    return <ErrorPanel message={t("errors.notFound")} retry={() => void load()} />;
  }
  if (state === "error" || !report || !principal) {
    return <ErrorPanel message={t("loadError")} retry={() => void load()} />;
  }

  const canDecide = reportedContentCanDecide(principal);
  const pendingOpen = report.status === "pending";
  const subjectContent = report.subject_content;

  return (
    <>
      <Link className="back-link" href="/reported-content">← {t("back")}</Link>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title", { reportId: report.report_id })}
        subtitle={t("subtitle", { revision: report.revision })}
        actions={<button className="button button-secondary" disabled={busy} onClick={() => void load()}>{common("refresh")}</button>}
      />

      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {pending ? (
        <div className="alert alert-info page-alert reported-content-pending" role="status">
          <div><strong>{t("pendingTitle")}</strong> {t("pendingCopy", { action: t(`decisions.${pending.action}`) })}</div>
          {canDecide && storageAvailable ? <button className="button button-secondary button-small" disabled={busy} onClick={() => void executeDecision()}>{t("retryPending")}</button> : null}
        </div>
      ) : null}
      {!canDecide ? <div className="alert alert-info page-alert">{t("viewerNotice")}</div> : null}

      <div className="section-grid reported-content-detail-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("identitiesTitle")}</h2><p>{t("identitiesCopy")}</p></div><span className={`badge reported-status status-${report.status}`}>{t(`statuses.${report.status}`)}</span></div>
          <div className="panel-body reported-content-identities">
            {(["reporter", "subject"] as const).map((side) => {
              const identity = report[side];
              return <article key={side}><span>{t(side)}</span><strong>{identityLabel(identity)}</strong><small>{t("uid", { uid: identity.uid })}{identity.username ? ` · @${identity.username}` : ""}</small><Link href={`/users/${identity.uid}`}>{t("openUser")}</Link></article>;
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("reportTitle")}</h2><p>{t("reportCopy")}</p></div></div>
          <div className="panel-body"><dl className="detail-list">
            <div className="detail-row"><dt>{t("reportId")}</dt><dd><code>{report.report_id}</code></dd></div>
            <div className="detail-row"><dt>{t("target")}</dt><dd>{t(`targets.${report.target_type}`)}</dd></div>
            <div className="detail-row"><dt>{t("reasonCode")}</dt><dd><code>{report.reason_code}</code></dd></div>
            <div className="detail-row">
              <dt>{t("reasonText")}</dt>
              <dd>
                {report.reason_text || t("noReasonText")}
                {report.reason_truncated ? <small className="muted"> {t("reasonTruncated")}</small> : null}
              </dd>
            </div>
            <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{formatDate(report.created_at, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("revision")}</dt><dd>{report.revision}</dd></div>
          </dl></div>
        </section>
      </div>

      <section className="panel reported-content-material-panel">
        <div className="panel-header"><div><h2>{t("materialTitle")}</h2><p>{t("materialCopy")}</p></div>{subjectContent.kind === "chat_message" && subjectContent.has_restricted_evidence ? <span className="badge badge-warning">{t("restrictedEvidence")}</span> : null}</div>
        <div className="panel-body reported-content-material">
          {subjectContent.kind === "profile" ? (
            <><strong>{t("profileSummary")}</strong><p>{subjectContent.summary || t("unavailableMaterial")}</p></>
          ) : (
            <>
              <dl className="detail-list compact">
                <div className="detail-row"><dt>{t("availability")}</dt><dd>{t(`availabilityValues.${subjectContent.availability}`)}</dd></div>
                <div className="detail-row"><dt>{t("messageId")}</dt><dd><code>{subjectContent.message_id || t("unavailableMaterial")}</code></dd></div>
                <div className="detail-row"><dt>{t("sentAt")}</dt><dd>{subjectContent.sent_at === null ? t("unavailableMaterial") : formatDate(subjectContent.sent_at, locale, true)}</dd></div>
              </dl>
              <blockquote>{subjectContent.text || t("unavailableMaterial")}</blockquote>
            </>
          )}
        </div>
      </section>

      {report.resolution ? (
        <section className="panel reported-content-resolution-panel">
          <div className="panel-header"><div><h2>{t("resolutionTitle")}</h2><p>{t("resolutionCopy")}</p></div></div>
          <div className="panel-body"><dl className="detail-list">
            <div className="detail-row"><dt>{t("decision")}</dt><dd>{t(`decisions.${report.resolution.decision}`)}</dd></div>
            <div className="detail-row"><dt>{t("operatorReason")}</dt><dd>{report.resolution.reason}</dd></div>
            <div className="detail-row"><dt>{t("decidedBy")}</dt><dd>{report.resolution.decided_by}</dd></div>
            <div className="detail-row"><dt>{t("decidedAt")}</dt><dd>{formatDate(report.resolution.decided_at, locale, true)}</dd></div>
          </dl></div>
        </section>
      ) : null}

      <section className="panel reported-content-decision-panel">
        <div className="panel-header"><div><h2>{t("decisionTitle")}</h2><p>{t("decisionCopy")}</p></div></div>
        <div className="panel-body">
          {!pendingOpen ? <p className="page-subtitle">{t("decisionClosed")}</p> : !canDecide ? <p className="page-subtitle">{t("decisionUnavailable")}</p> : !storageAvailable ? <p className="page-subtitle">{t("persistenceUnavailable")}</p> : pending ? <p className="page-subtitle">{t("pendingControlsLocked")}</p> : (
            <form className="form-stack" onSubmit={prepareDecision}>
              <label className="field"><span>{t("decision")}</span><select value={action} disabled={busy} onChange={(event) => setAction(event.target.value as ReportedContentDecision)}>{REPORTED_CONTENT_DECISIONS.map((value) => <option value={value} key={value}>{t(`decisions.${value}`)}</option>)}</select></label>
              <label className="field"><span>{t("operatorReason")}</span><textarea rows={5} maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /><small>{t("reasonHint", { count: Array.from(reason).length })}</small></label>
              <button className={`button ${action === "confirmed" ? "button-danger" : "button-secondary"}`} disabled={busy} type="submit">{t(`submit.${action}`)}</button>
            </form>
          )}
        </div>
      </section>

      {confirming ? <ConfirmDialog title={t(`confirm.${action}Title`)} copy={t(`confirm.${action}Copy`)} confirmLabel={t(`submit.${action}`)} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void executeDecision()} /> : null}
    </>
  );
}

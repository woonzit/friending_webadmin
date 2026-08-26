"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { isAdminWriteRole } from "@/lib/authPolicy";
import { formatDate, formatNumber } from "@/lib/format";
import {
  PROFILE_VERIFICATION_REJECTION_REASONS,
  profileVerificationDetail,
  profileVerificationEvidenceUrl,
  profileVerificationResponseData,
  type ProfileVerificationDetail,
} from "@/lib/profileVerification";

type DecisionAction = "approve" | "reject" | "request_new_video";
type Feedback = { tone: "success" | "error"; text: string };
type Confirmation = { action: DecisionAction };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

export default function ProfileVerificationDetailPage() {
  const t = useTranslations("profileVerification.detail");
  const common = useTranslations("common");
  const locale = useLocale();
  const params = useParams<{ caseId: string }>();
  const search = useSearchParams();
  const slug = useMemo(() => decodeURIComponent(params.caseId || ""), [params.caseId]);
  const uid = Number(search.get("uid") ?? slug.replace(/^uid-/, ""));
  const requestedCaseId = /^[a-f0-9]{32}$/.test(slug) ? slug : "";
  const [detail, setDetail] = useState<ProfileVerificationDetail | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [action, setAction] = useState<DecisionAction>("approve");
  const [reason, setReason] = useState(PROFILE_VERIFICATION_REJECTION_REASONS[0]);
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(uid) || uid <= 0 || (requestedCaseId === "" && !slug.startsWith("uid-"))) {
      setState("not-found");
      return;
    }
    if (!detail) setState("loading");
    const [response, identity] = await Promise.all([
      adminCall("profile_verification_detail", { uid, case_id: requestedCaseId }),
      adminCall("admin_me"),
    ]);
    if (response?.error === "profile-verification-state-not-found" || response?.error === "profile-verification-case-not-found") {
      setState("not-found");
      return;
    }
    const parsed = response?.success
      ? profileVerificationDetail(profileVerificationResponseData(response))
      : null;
    if (!parsed) {
      setState("error");
      return;
    }
    const actor = record(identity);
    setAdminEmail(typeof actor?.email === "string" ? actor.email.toLowerCase() : "");
    setCanWrite(isAdminWriteRole(actor?.role));
    setDetail(parsed);
    setState("ready");
  }, [detail, requestedCaseId, slug, uid]);

  useEffect(() => { void load(); }, [slug, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lease(operation: "claim" | "heartbeat" | "release") {
    if (!detail?.case || busy) return;
    setBusy(true);
    setFeedback(null);
    const response = await adminCall("profile_verification_lease", {
      case_id: detail.case.case_id,
      action: operation,
      expected_revision: detail.case.revision,
    });
    setBusy(false);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      await load();
      return;
    }
    setFeedback({ tone: "success", text: t(`lease.${operation}Success`) });
    await load();
  }

  function prepareDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!detail?.case || detail.case.status !== "pending") return;
    if (action !== "approve" && !PROFILE_VERIFICATION_REJECTION_REASONS.includes(reason as never)) {
      setFeedback({ tone: "error", text: t("reasonRequired") });
      return;
    }
    setConfirmation({ action });
  }

  async function executeDecision() {
    if (!confirmation || !detail?.case || busy) return;
    setBusy(true);
    setFeedback(null);
    const response = await adminCall("profile_verification_decision", {
      case_id: detail.case.case_id,
      action: confirmation.action,
      reason: confirmation.action === "approve" ? "" : reason,
      note: note.trim(),
      expected_revision: detail.case.revision,
      request_id: crypto.randomUUID(),
    });
    setBusy(false);
    setConfirmation(null);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      await load();
      return;
    }
    setNote("");
    setFeedback({ tone: "success", text: t(`decisions.${confirmation.action}Success`) });
    setEvidenceOpen(false);
    await load();
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") return <ErrorPanel message={t("notFound")} retry={() => void load()} />;
  if (state === "error" || !detail) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const item = detail.case;
  const currentAvatarMissing = detail.user.current_avatar_hash === "";
  const avatarChanged = Boolean(item && item.avatar_hash !== detail.user.current_avatar_hash);
  const leaseActive = Boolean(item?.lease_expires_at && item.lease_expires_at > Math.floor(Date.now() / 1000));
  const assignedToMe = Boolean(item?.lease_owner && item.lease_owner.toLowerCase() === adminEmail);
  const mayDecide = canWrite && item?.status === "pending" && !avatarChanged && !currentAvatarMissing;
  const profileIncomplete = !detail.user.gender || !detail.user.birthday;
  const videoUrl = item ? profileVerificationEvidenceUrl(item.case_id, "video") : "";
  const snapshotUrl = item ? profileVerificationEvidenceUrl(item.case_id, "avatar_snapshot") : "";

  return (
    <>
      <Link className="back-link" href="/profile-verification">← {t("back")}</Link>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={detail.user.display_name || `UID ${detail.user.uid}`}
        subtitle={t("subtitle", { uid: detail.user.uid, status: t(`statuses.${detail.state.status}`) })}
        actions={<div className="row-actions"><Link className="button button-secondary" href={`/users/${detail.user.uid}`}>{t("openUser")}</Link><button className="button button-secondary" disabled={busy} onClick={() => void load()}>{common("refresh")}</button></div>}
      />

      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}</div>}
      {avatarChanged && <div className="alert alert-error page-alert"><strong>{t("warnings.avatarChangedTitle")}</strong> {t("warnings.avatarChangedCopy")}</div>}
      {currentAvatarMissing && <div className="alert alert-info page-alert"><strong>{t("warnings.avatarMissingTitle")}</strong> {t("warnings.avatarMissingCopy")}</div>}
      {canWrite && profileIncomplete && <div className="alert alert-error page-alert">{t("warnings.profileIncomplete")}</div>}
      {!canWrite && <div className="alert alert-info page-alert">{t("viewerNotice")}</div>}

      <div className="verification-detail-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("memberTitle")}</h2><p>{t("memberCopy")}</p></div><span className={`badge verification-status-badge status-${detail.state.status}`}>{t(`statuses.${detail.state.status}`)}</span></div>
          <div className="panel-body verification-member-overview">
            <div className="verification-current-avatar">
              {detail.user.current_avatar_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={detail.user.current_avatar_url} alt={t("currentAvatar")} referrerPolicy="no-referrer" />
                : <span aria-label={t("avatarUnavailable")}>?</span>}
            </div>
            <dl className="detail-list">
              <div className="detail-row"><dt>UID</dt><dd>{detail.user.uid}</dd></div>
              <div className="detail-row"><dt>{t("gender")}</dt><dd>{detail.user.gender || "—"}</dd></div>
              <div className="detail-row"><dt>{t("birthday")}</dt><dd>{detail.user.birthday ? formatDate(detail.user.birthday, locale) : "—"}</dd></div>
              <div className="detail-row"><dt>{t("currentAvatarHash")}</dt><dd><code>{detail.user.current_avatar_hash || "—"}</code></dd></div>
              <div className="detail-row"><dt>{t("approvedAvatarHash")}</dt><dd><code>{detail.state.approved_avatar_hash || "—"}</code></dd></div>
              <div className="detail-row"><dt>{t("lastUpdated")}</dt><dd>{detail.state.updated_at ? formatDate(detail.state.updated_at, locale, true) : "—"}</dd></div>
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("caseTitle")}</h2><p>{t("caseCopy")}</p></div></div>
          <div className="panel-body">
            {!item ? <p className="page-subtitle">{t("noActiveCase")}</p> : <dl className="detail-list">
              <div className="detail-row"><dt>{t("caseId")}</dt><dd><code>{item.case_id}</code></dd></div>
              <div className="detail-row"><dt>{common("status")}</dt><dd>{humanize(item.status)}</dd></div>
              <div className="detail-row"><dt>{t("trigger")}</dt><dd>{humanize(item.trigger)}</dd></div>
              <div className="detail-row"><dt>{t("revision")}</dt><dd>{item.revision}</dd></div>
              <div className="detail-row"><dt>{t("caseAvatarHash")}</dt><dd><code>{item.avatar_hash}</code></dd></div>
              <div className="detail-row"><dt>{t("assignee")}</dt><dd>{item.lease_owner || t("unassigned")}{item.lease_expires_at ? ` · ${formatDate(item.lease_expires_at, locale, true)}` : ""}</dd></div>
              <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{item.created_at ? formatDate(item.created_at, locale, true) : "—"}</dd></div>
              {item.decision && <><div className="detail-row"><dt>{t("decision")}</dt><dd>{humanize(item.decision)}{item.decision_reason ? ` · ${humanize(item.decision_reason)}` : ""}</dd></div><div className="detail-row"><dt>{t("decidedBy")}</dt><dd>{item.decided_by || "—"}</dd></div></>}
            </dl>}
          </div>
        </section>
      </div>

      {item && <section className="panel verification-review-controls">
        <div className="panel-header"><div><h2>{t("lease.title")}</h2><p>{t("lease.copy")}</p></div></div>
        <div className="panel-body">
          {!canWrite ? <p className="page-subtitle">{t("lease.writerRequired")}</p> : item.status !== "pending" ? <p className="page-subtitle">{t("lease.closed")}</p> : <div className="row-actions">
            {(!item.lease_owner || !leaseActive || assignedToMe) && <button className="button button-primary" disabled={busy || (assignedToMe && leaseActive)} onClick={() => void lease("claim")}>{assignedToMe && leaseActive ? t("lease.claimedByYou") : t("lease.claim")}</button>}
            {assignedToMe && leaseActive && <button className="button button-secondary" disabled={busy} onClick={() => void lease("heartbeat")}>{t("lease.heartbeat")}</button>}
            {item.lease_owner && <button className="button button-danger" disabled={busy || (!assignedToMe && item.lease_owner !== adminEmail)} onClick={() => void lease("release")}>{t("lease.release")}</button>}
          </div>}
        </div>
      </section>}

      <section className="panel verification-evidence-panel">
        <div className="panel-header"><div><h2>{t("evidence.title")}</h2><p>{t("evidence.copy")}</p></div>{canWrite && item && !evidenceOpen && <button className="button button-danger" onClick={() => setEvidenceOpen(true)}>{t("evidence.open")}</button>}</div>
        <div className="panel-body">
          {!item ? <p className="page-subtitle">{t("evidence.noCase")}</p> : !canWrite ? <p className="page-subtitle">{t("evidence.writerRequired")}</p> : !evidenceOpen ? <p className="page-subtitle">{t("evidence.closedHint")}</p> : <div className="verification-evidence-grid">
            <article>
              <h3>{t("evidence.video")}</h3>
              {detail.submission?.has_video && videoUrl ? <video controls playsInline preload="metadata" src={videoUrl} /> : <p className="page-subtitle">{t("evidence.missing")}</p>}
              {detail.submission && <dl className="detail-list compact">
                <div className="detail-row"><dt>{t("duration")}</dt><dd>{detail.submission.duration_seconds.toFixed(2)} s</dd></div>
                <div className="detail-row"><dt>{t("dimensions")}</dt><dd>{detail.submission.width}×{detail.submission.height}</dd></div>
                <div className="detail-row"><dt>{t("size")}</dt><dd>{formatNumber(detail.submission.bytes, locale)} B</dd></div>
                <div className="detail-row"><dt>{t("codec")}</dt><dd>{detail.submission.codec} · {detail.submission.audio ? t("withAudio") : t("silent")}</dd></div>
              </dl>}
            </article>
            <article>
              <h3>{t("evidence.avatarSnapshot")}</h3>
              {item.has_avatar_snapshot && snapshotUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={snapshotUrl} alt={t("evidence.avatarSnapshot")} />
                : <p className="page-subtitle">{t("evidence.missing")}</p>}
              <dl className="detail-list compact">
                <div className="detail-row"><dt>{t("displayNameAtCase")}</dt><dd>{item.identity_snapshot.display_name || "—"}</dd></div>
                <div className="detail-row"><dt>{t("gender")}</dt><dd>{item.identity_snapshot.gender || "—"}</dd></div>
                <div className="detail-row"><dt>{t("birthday")}</dt><dd>{item.identity_snapshot.birthday ? formatDate(item.identity_snapshot.birthday, locale) : "—"}</dd></div>
              </dl>
            </article>
          </div>}
          {detail.submission && <div className="verification-challenge-sequence"><h3>{t("challengeTitle")}</h3><p>{t("challengeCopy")}</p><ol>{detail.submission.actions.map((prompt) => <li key={prompt}>{t.has(`prompts.${prompt}`) ? t(`prompts.${prompt}`) : humanize(prompt)}</li>)}</ol></div>}
        </div>
      </section>

      {item && <section className="panel verification-decision-panel">
        <div className="panel-header"><div><h2>{t("decisions.title")}</h2><p>{t("decisions.copy")}</p></div></div>
        <div className="panel-body">
          {!mayDecide ? <p className="page-subtitle">{item.status !== "pending" ? t("decisions.closed") : t("decisions.unavailable")}</p> : <form className="form-stack" onSubmit={prepareDecision}>
            <label className="field"><span>{t("decisions.action")}</span><select value={action} disabled={busy} onChange={(event) => setAction(event.target.value as DecisionAction)}>{(["approve", "reject", "request_new_video"] as const).map((value) => <option value={value} key={value}>{t(`decisions.actions.${value}`)}</option>)}</select></label>
            {action !== "approve" && <label className="field"><span>{t("decisions.reason")}</span><select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as typeof reason)}>{PROFILE_VERIFICATION_REJECTION_REASONS.map((value) => <option value={value} key={value}>{t(`reasons.${value}`)}</option>)}</select></label>}
            <label className="field"><span>{t("decisions.note")}</span><textarea rows={4} maxLength={1000} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /><small>{t("decisions.noteHint")}</small></label>
            <button className={`button ${action === "approve" ? "button-primary" : "button-danger"}`} type="submit" disabled={busy || (action === "approve" && profileIncomplete)}>{t(`decisions.actions.${action}`)}</button>
          </form>}
        </div>
      </section>}

      <section className="panel verification-history-panel">
        <div className="panel-header"><div><h2>{t("history.title")}</h2><p>{t("history.copy")}</p></div></div>
        {detail.history.length === 0 ? <div className="empty-state"><p>{t("history.empty")}</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("history.event")}</th><th>{t("history.transition")}</th><th>{t("history.actor")}</th><th>{t("history.reason")}</th><th>{common("createdAt")}</th></tr></thead><tbody>{detail.history.map((event) => <tr key={event.event_id}><td><div className="cell-stack"><strong>{humanize(event.event_type)}</strong><small>{event.case_id || "—"}</small></div></td><td>{event.previous_status || "—"} → {event.new_status || "—"}</td><td>{event.actor_kind}{event.actor_id ? ` · ${event.actor_id}` : ""}</td><td>{event.reason ? humanize(event.reason) : "—"}</td><td>{event.created_at ? formatDate(event.created_at, locale, true) : "—"}</td></tr>)}</tbody></table></div>}
      </section>

      {confirmation && <ConfirmDialog title={t(`decisions.confirm.${confirmation.action}Title`)} copy={t(`decisions.confirm.${confirmation.action}Copy`)} confirmLabel={t(`decisions.actions.${confirmation.action}`)} busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => void executeDecision()} />}
    </>
  );
}

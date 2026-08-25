"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import {
  verificationGrantDraftError,
  verificationMaxLevel,
  verificationTextLength,
  type VerificationLevel,
  type VerificationUserFixture,
} from "@/lib/verificationAdmin";

export default function VerificationUserPanel({ data }: { data: VerificationUserFixture }) {
  const t = useTranslations("userDetail.verificationGrant");
  const locale = useLocale();
  const [level, setLevel] = useState<"light" | "strong">("strong");
  const [reason, setReason] = useState("");
  const [expiryMode, setExpiryMode] = useState<"none" | "date">("none");
  const [expiry, setExpiry] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const canRead = data.capabilities.includes("verification_grant_read");
  const canEdit = data.capabilities.includes("verification_grant_edit");
  const expiryTimestamp = expiryMode === "date" && expiry
    ? Math.floor(new Date(expiry).getTime() / 1_000)
    : null;
  const error = verificationGrantDraftError({ level, reason, expiresAt: expiryTimestamp }, data.evaluatedAt);
  const previewLevel = verificationMaxLevel(
    data.derivedLevel,
    data.imported?.level ?? "none",
    level,
  );
  const immediateChange = previewLevel !== data.effectiveLevel;
  const sourceLabel = t(`sources.${data.effectiveSource}`);
  const statusRows = useMemo(() => ([
    { method: "video" as const, value: data.methods.video },
    { method: "persona" as const, value: data.methods.persona },
  ]), [data.methods.persona, data.methods.video]);

  if (!canRead) return null;

  function previewGrant() {
    if (error) return;
    setNotice(t("previewed", { level: t(`levels.${level}`) }));
  }

  return (
    <section className="panel verification-user-panel">
      <div className="panel-header">
        <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
        <span className={`verification-level-pill level-${data.effectiveLevel}`}>{t(`levels.${data.effectiveLevel}`)}</span>
      </div>
      <div className="panel-body verification-user-layout">
        <div className="verification-user-summary">
          <div className="alert alert-info">{t("localOnly")}</div>
          <dl className="detail-list">
            <div className="detail-row"><dt>{t("scope")}</dt><dd>{data.scopeDisplay}</dd></div>
            <div className="detail-row"><dt>{t("evaluatedAt")}</dt><dd>{formatDate(data.evaluatedAt, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("derivedLevel")}</dt><dd>{t(`levels.${data.derivedLevel}`)}</dd></div>
            <div className="detail-row"><dt>{t("effectiveLevel")}</dt><dd>{t(`levels.${data.effectiveLevel}`)} · {sourceLabel}</dd></div>
            <div className="detail-row"><dt>{t("badgeVisibility")}</dt><dd>{data.badgeVisible ? t("badgeVisible") : t("badgeHidden")}</dd></div>
          </dl>
          <p className="field-hint">{t("badgePrivacy")}</p>
          <div className="verification-method-statuses">{statusRows.map((row) => <article key={row.method}><span>{t(`methods.${row.method}`)}</span><strong className={`status-badge status-${row.value === "verified" ? "accepted" : row.value === "pending" ? "pending" : row.value === "rejected" ? "denied" : "inactive"}`}>{t(`statuses.${row.value}`)}</strong></article>)}</div>
          {data.rejection ? <div className="verification-provenance-card verification-rejection-card"><div><strong>{t("rejection.title")}</strong><span className="status-badge status-denied">{t(`methods.${data.rejection.method}`)}</span></div><dl className="detail-list"><div className="detail-row"><dt>{t("rejection.reason")}</dt><dd>{data.rejection.memberSafeReason}</dd></div><div className="detail-row"><dt>{t("rejection.attempt", { attempt: data.rejection.attempt, maximum: data.rejection.maxAttempts })}</dt><dd>{data.rejection.manualReviewAvailable ? t("rejection.manualReview") : t("rejection.manualReviewUnavailable")}</dd></div></dl></div> : null}
          {data.imported ? <div className="verification-provenance-card"><strong>{t("imported.title")}</strong><p>{t("imported.copy", { level: t(`levels.${data.imported.level}`), method: t(`methodHints.${data.imported.methodHint}`), date: formatDate(data.imported.importedAt, locale, true) })}</p></div> : null}
          {data.grant ? <div className="verification-provenance-card"><div><strong>{t("grant.title")}</strong><span className={`status-badge ${data.grant.status === "active" ? "status-accepted" : "status-denied"}`}>{t(`grant.status.${data.grant.status}`)}</span></div><dl className="detail-list"><div className="detail-row"><dt>{t("grant.level")}</dt><dd>{t(`levels.${data.grant.level}`)}</dd></div><div className="detail-row"><dt>{t("grant.reason")}</dt><dd>{data.grant.reason}</dd></div><div className="detail-row"><dt>{t("grant.grantedBy")}</dt><dd>{data.grant.grantedBy}</dd></div><div className="detail-row"><dt>{t("grant.grantedAt")}</dt><dd>{formatDate(data.grant.grantedAt, locale, true)}</dd></div><div className="detail-row"><dt>{t("grant.expiry")}</dt><dd>{data.grant.expiresAt ? formatDate(data.grant.expiresAt, locale, true) : t("grant.noExpiry")}</dd></div><div className="detail-row"><dt>{t("grant.revision")}</dt><dd>{data.grant.revision}</dd></div></dl></div> : <p className="page-subtitle">{t("grant.empty")}</p>}
        </div>

        <div className="verification-grant-editor">
          <header><h3>{t("editor.title")}</h3><p>{t("editor.copy")}</p></header>
          {!canEdit ? <div className="alert alert-info">{t("editor.readOnly")}</div> : <div className="form-stack">
            <label className="field"><span>{t("editor.level")}</span><select value={level} onChange={(event) => { setLevel(event.target.value as typeof level); setNotice(null); }}><option value="light">{t("levels.light")}</option><option value="strong">{t("levels.strong")}</option></select></label>
            <label className="field"><span>{t("editor.reason")}</span><textarea rows={4} maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); setNotice(null); }} /><small className={error === "reason" ? "field-error" : "field-hint"}>{verificationTextLength(reason)}/300 · {t("editor.reasonPrivate")}</small></label>
            <label className="field"><span>{t("editor.expiryMode")}</span><select value={expiryMode} onChange={(event) => { setExpiryMode(event.target.value as typeof expiryMode); setNotice(null); }}><option value="none">{t("editor.noExpiry")}</option><option value="date">{t("editor.chooseExpiry")}</option></select></label>
            {expiryMode === "date" ? <label className="field"><span>{t("editor.expiry")}</span><input type="datetime-local" value={expiry} onChange={(event) => { setExpiry(event.target.value); setNotice(null); }} />{error === "expiry" ? <small className="field-error">{t("editor.expiryError")}</small> : <small className="field-hint">{t("editor.expiryHint")}</small>}</label> : null}
            <div className="verification-grant-impact"><span>{t("editor.previewLevel")}</span><strong>{t(`levels.${previewLevel}`)}</strong><small>{immediateChange ? t("editor.changesNow") : t("editor.noImmediateChange")}</small></div>
            {level === "strong" ? <div className="alert alert-info">{t("editor.strongWarning")}</div> : null}
            {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
            <div className="row-actions verification-grant-actions"><button type="button" className="button button-danger" onClick={() => setNotice(t("editor.removePreview"))}>{t("editor.remove")}</button><button type="button" className="button button-primary" disabled={Boolean(error)} onClick={previewGrant}>{t("editor.preview")}</button></div>
            <p className="field-hint">{t("editor.noRevocation")}</p>
          </div>}
        </div>
      </div>
    </section>
  );
}

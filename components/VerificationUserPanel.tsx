"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import { ADMIN_GRANTED_VERIFICATION_CONTRACT_READY } from "@/lib/contractReadiness";
import {
  VERIFICATION_PENDING_STORAGE_KEY,
  verificationConflictResponse,
  verificationErrorResponse,
  verificationGrantDraftError,
  verificationGrantMutationResponse,
  verificationGrantPreviewResponse,
  verificationPendingFrom,
  verificationPendingMutation,
  verificationPersistBeforeMutation,
  verificationShouldRetainMutation,
  verificationTextLength,
  verificationUserDetailResponse,
  type VerificationAccess,
  type VerificationGrantPreviewData,
  type VerificationLevel,
  type VerificationPendingMutation,
  type VerificationUserProjection,
} from "@/lib/verificationAdmin";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

export default function VerificationUserPanel({ uid, access }: { uid: number; access: VerificationAccess | null }) {
  const t = useTranslations("userDetail.verificationGrant");
  const locale = useLocale();
  const [data, setData] = useState<VerificationUserProjection | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [level, setLevel] = useState<"light" | "strong">("light");
  const [reason, setReason] = useState("");
  const [expiryMode, setExpiryMode] = useState<"none" | "date">("none");
  const [expiry, setExpiry] = useState("");
  const [preview, setPreview] = useState<VerificationGrantPreviewData | null>(null);
  const [strongConfirmed, setStrongConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<VerificationPendingMutation | null>(null);
  const pendingRef = useRef<VerificationPendingMutation | null>(null);
  const canRead = access?.contract_ready === true && access.capabilities.includes("verification_grant_read");
  const legacyEditorTransitioned = ADMIN_GRANTED_VERIFICATION_CONTRACT_READY;
  const canEdit = !legacyEditorTransitioned
    && access?.contract_ready === true
    && access.capabilities.includes("verification_grant_edit");

  const load = useCallback(async () => {
    if (!canRead) return;
    setState((current) => current === "ready" ? current : "loading");
    const response = await adminCall("verification_user_detail", { contract_version: 1, uid });
    const parsed = verificationUserDetailResponse(response);
    if (!parsed || parsed.verification.uid !== uid) {
      setState("error");
      return;
    }
    setData(parsed.verification);
    setState("ready");
  }, [canRead, uid]);

  useEffect(() => {
    if (!canRead) return;
    try {
      const serialized = window.sessionStorage.getItem(VERIFICATION_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = verificationPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else window.sessionStorage.removeItem(VERIFICATION_PENDING_STORAGE_KEY);
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [canRead, load, t]);

  const expiryTimestamp = useMemo(() => {
    if (expiryMode !== "date" || !expiry) return null;
    const milliseconds = new Date(expiry).getTime();
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1_000) : Number.NaN;
  }, [expiry, expiryMode]);
  const validation = data ? verificationGrantDraftError({ level, reason, expiresAt: expiryTimestamp }, data.evaluated_at) : "reason";

  function updateDraft(next: () => void) {
    next();
    setPreview(null);
    setStrongConfirmed(false);
    setNotice(null);
  }

  function clearPending(): boolean {
    try { window.sessionStorage.removeItem(VERIFICATION_PENDING_STORAGE_KEY); } catch { return false; }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  async function executeMutation(next: VerificationPendingMutation) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const existing = pendingRef.current;
    let response: AdminResponse | null;
    if (existing) response = await adminCall(existing.action, existing.payload);
    else {
      const persisted = await verificationPersistBeforeMutation(window.sessionStorage, next, () => adminCall(next.action, next.payload));
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      pendingRef.current = next;
      setPending(next);
      response = persisted.response;
    }
    const parsed = verificationGrantMutationResponse(response);
    if (parsed && parsed.verification.uid === uid) {
      setData(parsed.verification);
      setPreview(null);
      const cleared = clearPending();
      setNotice({ tone: cleared ? "success" : "error", text: cleared ? t(parsed.replayed ? "live.replayed" : "live.saved") : t("live.persistenceCleanupFailed") });
      setBusy(false);
      return;
    }
    const conflict = verificationConflictResponse(response);
    if (conflict?.kind === "grant" && conflict.verification.uid === uid) {
      setData(conflict.verification);
      const cleared = clearPending();
      setNotice({ tone: "error", text: cleared ? t("live.conflict") : t("live.persistenceCleanupFailed") });
      setBusy(false);
      return;
    }
    const error = verificationErrorResponse(response);
    if (!verificationShouldRetainMutation(error)) clearPending();
    setNotice({ tone: "error", text: t("live.errorCode", { code: error ?? t("live.unknownError") }) });
    setBusy(false);
  }

  async function previewGrant() {
    if (!data || validation || busy) return;
    setBusy(true);
    const response = await adminCall("verification_grant_preview", {
      contract_version: 1,
      uid,
      level,
      reason,
      ...(expiryTimestamp === null ? {} : { expires_at: expiryTimestamp }),
      expected_revision: data.grant_revision,
    });
    const parsed = verificationGrantPreviewResponse(response);
    if (!parsed || parsed.current.uid !== uid || parsed.preview.granted_level !== level) {
      setPreview(null);
      setNotice({ tone: "error", text: t("live.previewFailed") });
    } else {
      setData(parsed.current);
      setPreview(parsed);
      setStrongConfirmed(false);
      setNotice({ tone: "info", text: t("previewed", { level: t(`levels.${level}`) }) });
    }
    setBusy(false);
  }

  function saveGrant() {
    if (!data || !preview || preview.current.grant_revision !== data.grant_revision || (level === "strong" && !strongConfirmed)) return;
    const mutation = verificationPendingMutation("verification_grant_save", `uid:${uid}`, {
      contract_version: 1,
      uid,
      level,
      reason,
      ...(expiryTimestamp === null ? {} : { expires_at: expiryTimestamp }),
      expected_revision: data.grant_revision,
      request_id: crypto.randomUUID(),
    });
    if (!mutation) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    void executeMutation(mutation);
  }

  function removeGrant() {
    if (!data?.grant || data.grant.status !== "active") return;
    const mutation = verificationPendingMutation("verification_grant_remove", `uid:${uid}`, {
      contract_version: 1,
      uid,
      reason,
      expected_revision: data.grant_revision,
      request_id: crypto.randomUUID(),
    });
    if (!mutation) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    void executeMutation(mutation);
  }

  if (!canRead) return null;
  if (state === "loading") return <section className="panel"><div className="panel-body"><p className="page-subtitle">{t("live.loading")}</p></div></section>;
  if (state === "error" || !data) return <section className="panel"><div className="panel-body"><div className="alert alert-error">{t("live.loadError")}</div><button type="button" className="button button-secondary" onClick={() => void load()}>{t("live.retryLoad")}</button></div></section>;

  const locked = busy || pending !== null;
  const rows = (["video", "persona"] as const).map((method) => ({ method, data: data.methods[method] }));

  return (
    <section className="panel verification-user-panel">
      <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("copy")}</p></div><span className={`verification-level-pill level-${data.effective_level}`}>{t(`levels.${data.effective_level}`)}</span></div>
      <div className="panel-body verification-user-layout">
        <div className="verification-user-summary">
          {pending ? <div className="alert alert-info"><strong>{t("live.pendingMutation")}</strong> {pending.action} · {pending.target}{pending.target === `uid:${uid}` && pending.action.startsWith("verification_grant_") ? <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void executeMutation(pending)}>{t("live.retryExact")}</button> : null}</div> : null}
          {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}
          <dl className="detail-list">
            <div className="detail-row"><dt>{t("scope")}</dt><dd>{data.scope.display} · {data.scope.scope_key}</dd></div>
            <div className="detail-row"><dt>{t("evaluatedAt")}</dt><dd>{formatDate(data.evaluated_at, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("derivedLevel")}</dt><dd>{t(`levels.${data.derived_level}`)}</dd></div>
            <div className="detail-row"><dt>{t("effectiveLevel")}</dt><dd>{t(`levels.${data.effective_level}`)} · {t(`sources.${data.effective_source}`)}</dd></div>
            <div className="detail-row"><dt>{t("badgeVisibility")}</dt><dd>{data.badge_visible ? t("badgeVisible") : t("badgeHidden")}</dd></div>
            <div className="detail-row"><dt>{t("live.importIntegrity")}</dt><dd>{t(`live.integrity.${data.import_integrity}`)}</dd></div>
          </dl>
          <div className="verification-method-statuses">{rows.map((row) => <article key={row.method}><span>{t(`methods.${row.method}`)}</span><strong className={`status-badge status-${row.data.status === "verified" ? "accepted" : row.data.status === "pending" ? "pending" : row.data.status === "rejected" ? "denied" : "inactive"}`}>{t(`statuses.${row.data.status}`)}</strong>{row.data.member_safe_reason ? <small>{row.data.member_safe_reason}</small> : null}</article>)}</div>
          {data.imported ? <div className="verification-provenance-card"><strong>{t("imported.title")}</strong><p>{t("imported.copy", { level: t(`levels.${data.imported.level}`), method: t(`methodHints.${data.imported.method_hint}`), date: formatDate(data.imported.imported_at, locale, true) })}</p></div> : null}
          {data.grant ? <div className="verification-provenance-card"><div><strong>{t("grant.title")}</strong><span className={`status-badge ${data.grant.status === "active" ? "status-accepted" : "status-denied"}`}>{t(`grant.status.${data.grant.status}`)}</span></div><dl className="detail-list"><div className="detail-row"><dt>{t("grant.level")}</dt><dd>{t(`levels.${data.grant.level}`)}</dd></div><div className="detail-row"><dt>{t("grant.reason")}</dt><dd>{data.grant.reason}</dd></div><div className="detail-row"><dt>{t("grant.grantedBy")}</dt><dd>{data.grant.granted_by}</dd></div><div className="detail-row"><dt>{t("grant.grantedAt")}</dt><dd>{formatDate(data.grant.granted_at, locale, true)}</dd></div><div className="detail-row"><dt>{t("grant.expiry")}</dt><dd>{data.grant.expires_at ? formatDate(data.grant.expires_at, locale, true) : t("grant.noExpiry")}</dd></div><div className="detail-row"><dt>{t("grant.revision")}</dt><dd>{data.grant.revision}</dd></div></dl></div> : <p className="page-subtitle">{t("grant.empty")}</p>}
        </div>

        <div className="verification-grant-editor">
          <header><h3>{t("editor.title")}</h3><p>{t("editor.copy")}</p></header>
          {!canEdit ? <div className="alert alert-info">{t(legacyEditorTransitioned ? "editor.transitionReadOnly" : "editor.readOnly")}</div> : <div className="form-stack">
            <label className="field"><span>{t("editor.level")}</span><select disabled={locked} value={level} onChange={(event) => updateDraft(() => setLevel(event.target.value as typeof level))}><option value="light">{t("levels.light")}</option><option value="strong">{t("levels.strong")}</option></select></label>
            <label className="field"><span>{t("editor.reason")}</span><textarea disabled={locked} rows={4} maxLength={300} value={reason} onChange={(event) => updateDraft(() => setReason(event.target.value))} /><small className={validation === "reason" ? "field-error" : "field-hint"}>{verificationTextLength(reason)}/300 · {t("editor.reasonPrivate")}</small></label>
            <label className="field"><span>{t("editor.expiryMode")}</span><select disabled={locked} value={expiryMode} onChange={(event) => updateDraft(() => setExpiryMode(event.target.value as typeof expiryMode))}><option value="none">{t("editor.noExpiry")}</option><option value="date">{t("editor.chooseExpiry")}</option></select></label>
            {expiryMode === "date" ? <label className="field"><span>{t("editor.expiry")}</span><input disabled={locked} type="datetime-local" value={expiry} onChange={(event) => updateDraft(() => setExpiry(event.target.value))} />{validation === "expiry" ? <small className="field-error">{t("editor.expiryError")}</small> : <small className="field-hint">{t("editor.expiryHint")}</small>}</label> : null}
            <button type="button" className="button button-secondary" disabled={locked || Boolean(validation)} onClick={() => void previewGrant()}>{t("editor.preview")}</button>
            {preview ? <div className="verification-grant-impact"><span>{t("editor.previewLevel")}</span><strong>{t(`levels.${preview.preview.effective_level}`)}</strong><small>{preview.preview.changes_effective_level ? t("editor.changesNow") : t("editor.noImmediateChange")}</small></div> : null}
            {preview?.preview.strong_grant_warning ? <label className="checkbox-field"><input type="checkbox" checked={strongConfirmed} onChange={(event) => setStrongConfirmed(event.target.checked)} /><span>{t("live.confirmStrong")}</span></label> : null}
            <div className="row-actions verification-grant-actions"><button type="button" className="button button-danger" disabled={locked || !data.grant || data.grant.status !== "active" || reason.trim() === ""} onClick={removeGrant}>{t("editor.remove")}</button><button type="button" className="button button-primary" disabled={locked || !preview || (level === "strong" && !strongConfirmed)} onClick={saveGrant}>{t("live.saveGrant")}</button></div>
            <p className="field-hint">{t("editor.noRevocation")}</p>
          </div>}
        </div>
      </div>
    </section>
  );
}

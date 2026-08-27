"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY,
  adminGrantedVerificationAdminMe,
  adminGrantedVerificationConflictMatchesPending,
  adminGrantedVerificationConflictResponse,
  adminGrantedVerificationError,
  adminGrantedVerificationErrorKey,
  adminGrantedVerificationMutationConverged,
  adminGrantedVerificationMutationResponse,
  adminGrantedVerificationNormalizeReason,
  adminGrantedVerificationPendingFrom,
  adminGrantedVerificationPendingMutation,
  adminGrantedVerificationPersistBeforeMutation,
  adminGrantedVerificationResourceConverged,
  adminGrantedVerificationSelectedDetailResponse,
  adminGrantedVerificationShouldRetainMutation,
  adminGrantedVerificationTextLength,
  type AdminGrantedVerificationAdminMe,
  type AdminGrantedVerificationMethod,
  type AdminGrantedVerificationPendingMutation,
  type AdminGrantedVerificationResource,
} from "@/lib/adminGrantedVerification";
import {
  PERSONA_PENDING_STORAGE_KEY,
  personaPendingFrom,
  type PersonaPendingMutation,
} from "@/lib/personaAdmin";
import {
  VERIFICATION_PENDING_STORAGE_KEY,
  verificationPendingFrom,
  type VerificationPendingMutation,
} from "@/lib/verificationAdmin";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

function pendingUid(pending: AdminGrantedVerificationPendingMutation): number | null {
  const uid = pending.payload.uid;
  return typeof uid === "number" && Number.isInteger(uid) ? uid : null;
}

export default function AdminGrantedVerificationPanel({ uid }: { uid: number }) {
  const t = useTranslations("userDetail.adminGrantedVerification");
  const locale = useLocale();
  const [state, setState] = useState<"loading" | "ready" | "error" | "hidden">("loading");
  const [capability, setCapability] = useState<AdminGrantedVerificationAdminMe | null>(null);
  const [resource, setResource] = useState<AdminGrantedVerificationResource | null>(null);
  const [method, setMethod] = useState<AdminGrantedVerificationMethod>("video");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AdminGrantedVerificationPendingMutation | null>(null);
  const pendingRef = useRef<AdminGrantedVerificationPendingMutation | null>(null);
  const [legacyPending, setLegacyPending] = useState<VerificationPendingMutation | null>(null);
  const [personaAliasPending, setPersonaAliasPending] = useState<PersonaPendingMutation | null>(null);
  const loadSequenceRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const canEdit = capability?.contract_ready === true
    && capability.principal.capabilities.includes("verification_grant_edit")
    && capability.actions.includes("verification_grant")
    && capability.actions.includes("verification_revoke");
  const normalizedReason = useMemo(
    () => adminGrantedVerificationNormalizeReason(reason),
    [reason],
  );

  const adopt = useCallback((next: AdminGrantedVerificationResource) => {
    setResource(next);
    setConfirmed(false);
    setMethod((current) => next.enabled_methods.includes(current)
      ? current
      : next.enabled_methods[0] ?? "video");
  }, []);

  const clearPending = useCallback((): boolean => {
    try {
      window.sessionStorage.removeItem(ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }, []);

  const readLegacyPending = useCallback(() => {
    try {
      const serialized = window.sessionStorage.getItem(VERIFICATION_PENDING_STORAGE_KEY);
      if (serialized === null) {
        setLegacyPending(null);
      } else {
        const restored = verificationPendingFrom(JSON.parse(serialized));
        setLegacyPending(restored);
        if (!restored) window.sessionStorage.removeItem(VERIFICATION_PENDING_STORAGE_KEY);
      }
    } catch {
      setLegacyPending(null);
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    try {
      const serialized = window.sessionStorage.getItem(PERSONA_PENDING_STORAGE_KEY);
      if (serialized === null) {
        setPersonaAliasPending(null);
        return;
      }
      const restored = personaPendingFrom(JSON.parse(serialized));
      setPersonaAliasPending(
        restored?.action === "admin_apply_fake_persona"
          || restored?.action === "admin_revoke_fake_persona"
          ? restored
          : null,
      );
    } catch {
      setPersonaAliasPending(null);
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
  }, [t]);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setState((current) => current === "ready" ? current : "loading");
    const meResponse = await adminCall("admin_me", {});
    if (sequence !== loadSequenceRef.current) return;
    const block = adminGrantedVerificationAdminMe(meResponse?.admin_granted_verification);
    if (!block) {
      setState("error");
      return;
    }
    setCapability(block);
    if (!block.contract_ready
      || !block.principal.capabilities.includes("verification_grant_read")) {
      setState("hidden");
      return;
    }
    const response = await adminCall("verification_user_detail", {
      contract_version: 1,
      uid,
      admin_granted_verification_contract_version: 1,
    });
    if (sequence !== loadSequenceRef.current) return;
    const selected = adminGrantedVerificationSelectedDetailResponse(response);
    if (uidRef.current !== uid) return;
    if (!selected || selected.admin_granted_verification.uid !== uid) {
      setState("error");
      return;
    }
    const next = selected.admin_granted_verification;
    adopt(next);
    const candidate = pendingRef.current;
    if (candidate && pendingUid(candidate) === uid
      && await adminGrantedVerificationResourceConverged(candidate, next)) {
      const cleared = clearPending();
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t("live.converged") : t("live.persistenceCleanupFailed"),
      });
    }
    setState("ready");
  }, [adopt, clearPending, t, uid]);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY);
      if (serialized !== null) {
        const restored = adminGrantedVerificationPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    readLegacyPending();
    void load();
  }, [load, readLegacyPending, t]);

  async function executeMutation(next: AdminGrantedVerificationPendingMutation) {
    if (mutationInFlightRef.current || legacyPending || personaAliasPending) return;
    mutationInFlightRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const existing = pendingRef.current;
      let response: AdminResponse | null;
      if (existing) {
        response = await adminCall(existing.action, existing.payload);
      } else {
        const persisted = await adminGrantedVerificationPersistBeforeMutation(
          window.sessionStorage,
          next,
          () => {
            pendingRef.current = next;
            setPending(next);
            return adminCall(next.action, next.payload);
          },
        );
        if (!persisted.ok) {
          setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
          return;
        }
        response = persisted.response;
      }

      const command = existing ?? next;
      const mutation = adminGrantedVerificationMutationResponse(response);
      if (mutation && await adminGrantedVerificationMutationConverged(command, mutation)) {
        // A completed receipt replay returns the original canonical bytes even
        // when a later command has already changed the grant. It proves this
        // pending command converged, but it is not necessarily current state.
        if (!mutation.replayed
          && mutation.admin_granted_verification.uid === uidRef.current) {
          adopt(mutation.admin_granted_verification);
        }
        setReason("");
        setConfirmed(false);
        const cleared = clearPending();
        if (cleared && mutation.replayed
          && mutation.admin_granted_verification.uid === uidRef.current) {
          await load();
        }
        setNotice({
          tone: cleared ? "success" : "error",
          text: cleared
            ? t(mutation.replayed ? "live.replayed" : "live.saved")
            : t("live.persistenceCleanupFailed"),
        });
        return;
      }

      const conflict = adminGrantedVerificationConflictResponse(response);
      if (conflict) {
        if (adminGrantedVerificationConflictMatchesPending(command, conflict)) {
          if (conflict.admin_granted_verification.uid === uidRef.current) {
            adopt(conflict.admin_granted_verification);
          }
          setReason("");
          setConfirmed(false);
          const cleared = clearPending();
          setNotice({
            tone: "error",
            text: cleared
              ? t(`errors.${adminGrantedVerificationErrorKey(conflict.error)}`)
              : t("live.persistenceCleanupFailed"),
          });
        } else {
          setNotice({ tone: "error", text: t("live.unknownError") });
        }
        return;
      }

      const error = adminGrantedVerificationError(response);
      if (!adminGrantedVerificationShouldRetainMutation(error) && !clearPending()) {
        setNotice({ tone: "error", text: t("live.persistenceCleanupFailed") });
        return;
      }
      setNotice({
        tone: "error",
        text: error ? t(`errors.${adminGrantedVerificationErrorKey(error)}`) : t("live.unknownError"),
      });
    } finally {
      mutationInFlightRef.current = false;
      setBusy(false);
    }
  }

  function submit(action: "verification_grant" | "verification_revoke") {
    if (!resource || !canEdit || busy || mutationInFlightRef.current || pendingRef.current
      || legacyPending || personaAliasPending
      || !normalizedReason || !confirmed) return;
    const activeGrant = resource.admin_grant?.status === "active" ? resource.admin_grant : null;
    const selectedMethod = action === "verification_revoke" ? activeGrant?.method : method;
    if (!selectedMethod
      || (action === "verification_grant" && !resource.enabled_methods.includes(selectedMethod))) return;
    const mutation = adminGrantedVerificationPendingMutation(action, {
      contract_version: 1,
      uid,
      method: selectedMethod,
      reason: normalizedReason,
      request_id: crypto.randomUUID(),
      expected_revision: resource.grant_revision,
    });
    if (!mutation) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    void executeMutation(mutation);
  }

  if (state === "hidden") return null;
  if (state === "loading") return (
    <section className="panel admin-granted-verification-panel">
      <div className="panel-body"><p className="page-subtitle">{t("live.loading")}</p></div>
    </section>
  );
  if (state === "error" || !resource || !capability) return (
    <section className="panel admin-granted-verification-panel">
      <div className="panel-body">
        <div className="alert alert-error">{t("live.loadError")}</div>
        <button type="button" className="button button-secondary" onClick={() => void load()}>{t("live.retryLoad")}</button>
      </div>
    </section>
  );

  const activeGrant = resource.admin_grant?.status === "active" ? resource.admin_grant : null;
  const legacyAuthorityPending = legacyPending ?? personaAliasPending;
  const locked = busy || pending !== null || legacyAuthorityPending !== null;
  const reasonCount = adminGrantedVerificationTextLength(normalizedReason ?? reason);

  return (
    <section className="panel admin-granted-verification-panel">
      <div className="panel-header">
        <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
        <span className={`verification-level-pill level-${resource.effective_level}`}>
          {t(`levels.${resource.effective_level}`)}
        </span>
      </div>
      <div className="panel-body verification-user-layout">
        <div className="verification-user-summary">
          {legacyAuthorityPending ? (
            <div className="alert alert-info">
              <strong>{t("transition.title")}</strong> {t("transition.copy", {
                action: legacyAuthorityPending.action,
                target: legacyAuthorityPending.target,
              })}
              <button type="button" className="button button-secondary button-small" onClick={readLegacyPending}>
                {t("transition.recheck")}
              </button>
            </div>
          ) : null}
          {pending ? (
            <div className="alert alert-info admin-granted-verification-pending">
              <div>
                <strong>{t("live.pendingMutation")}</strong><br />
                <code>{pending.action} · {pending.target}</code>
                <small>{t("live.pendingMaterial", {
                  method: t(`methods.${String(pending.payload.method)}`),
                  revision: Number(pending.payload.expected_revision),
                })}</small>
              </div>
              {pendingUid(pending) !== uid ? (
                <Link className="button button-secondary button-small" href={`/users/${pendingUid(pending)}`}>
                  {t("live.openPendingMember")}
                </Link>
              ) : null}
              {pendingUid(pending) === uid ? (
                <button type="button" className="button button-secondary button-small" disabled={busy || legacyAuthorityPending !== null} onClick={() => void executeMutation(pending)}>
                  {t("live.retryExact")}
                </button>
              ) : null}
            </div>
          ) : null}
          {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}
          <dl className="detail-list">
            <div className="detail-row"><dt>{t("evaluatedAt")}</dt><dd>{formatDate(resource.evaluated_at, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("enabledMethods")}</dt><dd>{resource.enabled_methods.length > 0 ? resource.enabled_methods.map((entry) => t(`methods.${entry}`)).join(" · ") : t("noEnabledMethods")}</dd></div>
            <div className="detail-row"><dt>{t("grantRevision")}</dt><dd>{resource.grant_revision}</dd></div>
            <div className="detail-row"><dt>{t("effectiveLevel")}</dt><dd>{t(`levels.${resource.effective_level}`)} · {t(`sources.${resource.effective_source}`)}</dd></div>
            <div className="detail-row"><dt>{t("externalSeal")}</dt><dd>{resource.external_seal_would_show ? t("sealVisible") : t("sealHidden")}</dd></div>
          </dl>
          {resource.admin_grant ? (
            <div className="verification-provenance-card">
              <div>
                <strong>{t("grant.title")}</strong>
                <span className={`status-badge ${resource.admin_grant.status === "active" ? "status-accepted" : "status-denied"}`}>
                  {t(`statuses.${resource.admin_grant.status}`)}
                </span>
              </div>
              <p>{t("grant.noProviderEvidence")}</p>
              <dl className="detail-list">
                <div className="detail-row"><dt>{t("grant.method")}</dt><dd>{t(`methods.${resource.admin_grant.method}`)}</dd></div>
                <div className="detail-row"><dt>{t("grant.level")}</dt><dd>{t(`levels.${resource.admin_grant.level}`)}</dd></div>
                <div className="detail-row"><dt>{t("grant.actor")}</dt><dd>{resource.admin_grant.granted_by}</dd></div>
                <div className="detail-row"><dt>{t("grant.grantedAt")}</dt><dd>{formatDate(resource.admin_grant.granted_at, locale, true)}</dd></div>
                <div className="detail-row"><dt>{t("grant.expiry")}</dt><dd>{resource.admin_grant.expires_at === null ? t("grant.noExpiry") : formatDate(resource.admin_grant.expires_at, locale, true)}</dd></div>
                <div className="detail-row"><dt>{t("grant.reasonMetadata")}</dt><dd>{t("grant.reasonWitness", { length: resource.admin_grant.reason_length })}<br /><code>{resource.admin_grant.reason_sha256}</code></dd></div>
              </dl>
            </div>
          ) : <p className="page-subtitle">{t("grant.empty")}</p>}
        </div>

        <div className="verification-grant-editor">
          <header><h3>{t("editor.title")}</h3><p>{t("editor.copy")}</p></header>
          {!canEdit ? <div className="alert alert-info">{t("editor.readOnly")}</div> : (
            <div className="form-stack">
              <label className="field">
                <span>{t("editor.method")}</span>
                <select disabled={locked || resource.enabled_methods.length === 0} value={method} onChange={(event) => { setMethod(event.target.value as AdminGrantedVerificationMethod); setConfirmed(false); setNotice(null); }}>
                  {resource.enabled_methods.map((entry) => <option key={entry} value={entry}>{t(`methods.${entry}`)}</option>)}
                </select>
                <small className="field-hint">{resource.enabled_methods.length > 0 ? t("editor.methodHint") : t("editor.noMethod")}</small>
              </label>
              <label className="field">
                <span>{t("editor.reason")}</span>
                <textarea disabled={locked} rows={4} maxLength={600} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false); setNotice(null); }} />
                <small className={reason !== "" && !normalizedReason ? "field-error" : "field-hint"}>{reasonCount}/300 · {t("editor.reasonPrivate")}</small>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" disabled={locked || !normalizedReason} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>{t("editor.confirm")}</span>
              </label>
              <div className="row-actions verification-grant-actions">
                <button type="button" className="button button-danger" disabled={locked || !activeGrant || !normalizedReason || !confirmed} onClick={() => submit("verification_revoke")}>
                  {t("editor.revoke", { method: activeGrant ? t(`methods.${activeGrant.method}`) : "" })}
                </button>
                <button type="button" className="button button-primary" disabled={locked || resource.enabled_methods.length === 0 || !normalizedReason || !confirmed} onClick={() => submit("verification_grant")}>
                  {t("editor.grant", { method: t(`methods.${method}`) })}
                </button>
              </div>
              <p className="field-hint">{activeGrant && !resource.enabled_methods.includes(activeGrant.method) ? t("editor.revokeDisabledMethod") : t("editor.authorityNote")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

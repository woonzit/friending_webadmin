"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import {
  PRODUCT_POPUP_BUTTON_ACTIONS,
  PRODUCT_POPUP_CONTRACT_VERSION,
  PRODUCT_POPUP_REPEAT_MODES,
  normalizeProductPopupAuditReason,
  productPopupCanWrite,
  productPopupClearPayload,
  productPopupClearResponse,
  productPopupConflictResponse,
  productPopupDefaultExpiry,
  productPopupErrorKey,
  productPopupErrorResponse,
  productPopupMutationConverged,
  productPopupPendingClear,
  productPopupPendingMutation,
  productPopupPendingSet,
  productPopupPendingStorageKey,
  productPopupReadResponse,
  productPopupResourceConverged,
  productPopupSetMaterial,
  productPopupSetPayload,
  productPopupSetResponse,
  productPopupShouldRetainMutation,
  type ProductPopupDraft,
  type ProductPopupDraftError,
  type ProductPopupPendingMutation,
  type ProductPopupResourceData,
  type ProductPopupSetMaterial,
} from "@/lib/productPopup";

type Notice = { tone: "success" | "error" | "info"; text: string };
type Confirmation = "set" | "clear" | null;

type DraftFields = {
  title: string;
  message: string;
  repeatMode: ProductPopupDraft["repeatMode"];
  expiresAt: string;
  buttonAction: ProductPopupDraft["buttonAction"];
  buttonTitle: string;
  buttonUrl: string;
  auditReason: string;
};

const EMPTY_DRAFT: DraftFields = {
  title: "",
  message: "",
  repeatMode: "once",
  expiresAt: "",
  buttonAction: "none",
  buttonTitle: "",
  buttonUrl: "",
  auditReason: "",
};

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function localInputFromEpoch(value: number): string {
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function epochFromLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(normalized);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) return null;
  const seconds = milliseconds / 1000;
  return localInputFromEpoch(seconds) === normalized ? seconds : null;
}

function draftFromFields(fields: DraftFields): ProductPopupDraft {
  return {
    title: fields.title,
    message: fields.message,
    repeatMode: fields.repeatMode,
    expiresAt: epochFromLocalInput(fields.expiresAt) ?? -1,
    buttonAction: fields.buttonAction,
    buttonTitle: fields.buttonTitle,
    buttonUrl: fields.buttonUrl,
    auditReason: fields.auditReason,
  };
}

function fieldsFromResource(resource: ProductPopupResourceData): DraftFields {
  const popup = resource.popup;
  if (popup) {
    return {
      title: popup.title,
      message: popup.message,
      repeatMode: popup.repeat_mode,
      expiresAt: localInputFromEpoch(popup.expires_at),
      buttonAction: popup.button.action,
      buttonTitle: popup.button.title,
      buttonUrl: popup.button.url,
      auditReason: "",
    };
  }
  const expiry = productPopupDefaultExpiry(currentUnixSeconds());
  return {
    ...EMPTY_DRAFT,
    expiresAt: expiry === null ? "" : localInputFromEpoch(expiry),
  };
}

function fieldsFromPending(pending: ProductPopupPendingMutation): DraftFields | null {
  if (pending.action !== "set") return null;
  const payload = pending.payload;
  return {
    title: payload.title,
    message: payload.message,
    repeatMode: payload.repeat_mode,
    expiresAt: localInputFromEpoch(payload.expires_at),
    buttonAction: payload.button_action,
    buttonTitle: payload.button_title,
    buttonUrl: payload.button_url,
    auditReason: payload.audit_reason,
  };
}

function setMaterialMatches(
  preview: ProductPopupSetMaterial,
  payload: Extract<ProductPopupPendingMutation, { action: "set" }>["payload"],
): boolean {
  return preview.audit_reason === payload.audit_reason
    && preview.title === payload.title
    && preview.message === payload.message
    && preview.repeat_mode === payload.repeat_mode
    && preview.expires_at === payload.expires_at
    && preview.button_action === payload.button_action
    && preview.button_title === payload.button_title
    && preview.button_url === payload.button_url;
}

export default function ProductPopupPanel({ uid }: { uid: number }) {
  const t = useTranslations("productPopup");
  const common = useTranslations("common");
  const locale = useLocale();
  const [resource, setResource] = useState<ProductPopupResourceData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<ProductPopupSetMaterial | null>(null);
  const [pending, setPending] = useState<ProductPopupPendingMutation | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pendingRef = useRef<ProductPopupPendingMutation | null>(null);

  const rememberPending = useCallback((value: ProductPopupPendingMutation | null): boolean => {
    const key = productPopupPendingStorageKey(uid);
    try {
      if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
      else window.sessionStorage.removeItem(key);
    } catch {
      setStorageAvailable(false);
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
  }, [uid]);

  const adoptResource = useCallback((value: ProductPopupResourceData, refreshDraft: boolean) => {
    if (value.uid !== uid) return false;
    setResource(value);
    if (refreshDraft) {
      setDraft(fieldsFromResource(value));
      setPreview(null);
    }
    return true;
  }, [uid]);

  const load = useCallback(async () => {
    setState((current) => current === "ready" ? current : "loading");
    setNotice(null);
    const response = await adminCall("admin_get_user_popup", {
      contract_version: PRODUCT_POPUP_CONTRACT_VERSION,
      uid,
    });
    const parsed = productPopupReadResponse(response);
    if (!parsed || parsed.uid !== uid) {
      setState("error");
      return;
    }

    const durable = pendingRef.current;
    if (durable && productPopupResourceConverged(parsed, durable)) {
      adoptResource(parsed, true);
      const cleared = rememberPending(null);
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t("notices.observed") : t("errors.persistenceCleanupFailed"),
      });
    } else if (durable && parsed.resource_revision !== durable.payload.expected_revision) {
      adoptResource(parsed, true);
      const cleared = rememberPending(null);
      setNotice({
        tone: "error",
        text: cleared ? t("errors.conflict") : t("errors.persistenceCleanupFailed"),
      });
    } else {
      adoptResource(parsed, durable === null);
    }
    setState("ready");
  }, [adoptResource, rememberPending, t, uid]);

  useEffect(() => {
    let serialized: string | null = null;
    try {
      serialized = window.sessionStorage.getItem(productPopupPendingStorageKey(uid));
    } catch {
      setStorageAvailable(false);
      setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
    }

    if (serialized) {
      try {
        const restored = productPopupPendingMutation(JSON.parse(serialized));
        if (restored && restored.payload.uid === uid) {
          pendingRef.current = restored;
          setPending(restored);
          setStorageAvailable(true);
          const restoredDraft = fieldsFromPending(restored);
          if (restoredDraft) setDraft(restoredDraft);
          else setDraft((current) => ({
            ...current,
            auditReason: restored.payload.audit_reason,
          }));
        } else {
          rememberPending(null);
        }
      } catch {
        rememberPending(null);
      }
    }
    void load();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateDraft(values: Partial<DraftFields>) {
    setDraft((current) => ({ ...current, ...values }));
    setPreview(null);
    setNotice(null);
  }

  function validationError(error: ProductPopupDraftError): string {
    return t(`validation.${error}`);
  }

  function buildPreview() {
    const result = productPopupSetMaterial(draftFromFields(draft), currentUnixSeconds());
    if (!result.ok) {
      setPreview(null);
      setNotice({ tone: "error", text: validationError(result.error) });
      return;
    }
    setPreview(result.payload);
    setNotice({ tone: "info", text: t("notices.previewReady") });
  }

  function prepareSet() {
    if (!resource || !preview || pending || busy) return;
    const result = productPopupSetMaterial(draftFromFields(draft), currentUnixSeconds());
    if (!result.ok) {
      setPreview(null);
      setNotice({ tone: "error", text: validationError(result.error) });
      return;
    }
    if (JSON.stringify(result.payload) !== JSON.stringify(preview)) {
      setPreview(result.payload);
      setNotice({ tone: "info", text: t("notices.previewChanged") });
      return;
    }
    setConfirming("set");
  }

  function prepareClear() {
    if (!resource?.popup || pending || busy) return;
    if (!normalizeProductPopupAuditReason(draft.auditReason)) {
      setNotice({ tone: "error", text: t("validation.auditReason") });
      return;
    }
    setConfirming("clear");
  }

  async function executeMutation() {
    const intendedAction = pendingRef.current?.action ?? confirming;
    if (!resource || !intendedAction || busy) return;

    let durable = pendingRef.current;
    if (!durable) {
      if (!storageAvailable || !productPopupCanWrite(resource.principal)) {
        setConfirming(null);
        setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
        return;
      }
      const requestId = crypto.randomUUID();
      if (intendedAction === "set") {
        const result = productPopupSetPayload(
          uid,
          resource.resource_revision,
          draftFromFields(draft),
          requestId,
          currentUnixSeconds(),
        );
        if (!result.ok) {
          setConfirming(null);
          setPreview(null);
          setNotice({ tone: "error", text: validationError(result.error) });
          return;
        }
        if (!preview || !setMaterialMatches(preview, result.payload)) {
          setConfirming(null);
          setPreview(null);
          setNotice({ tone: "info", text: t("notices.previewChanged") });
          return;
        }
        durable = productPopupPendingSet(result.payload);
      } else {
        const result = productPopupClearPayload(
          uid,
          resource.resource_revision,
          draft.auditReason,
          requestId,
        );
        if (!result.ok) {
          setConfirming(null);
          setNotice({ tone: "error", text: validationError(result.error) });
          return;
        }
        durable = productPopupPendingClear(result.payload);
      }
      if (!rememberPending(durable)) {
        setConfirming(null);
        setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
        return;
      }
    }

    setBusy(true);
    setConfirming(null);
    setNotice(null);
    const response = await adminCall(
      durable.action === "set" ? "admin_set_user_popup" : "admin_clear_user_popup",
      durable.payload,
    );
    const result = durable.action === "set"
      ? productPopupSetResponse(response)
      : productPopupClearResponse(response);
    if (result && productPopupMutationConverged(result, durable)) {
      adoptResource(result, true);
      const cleared = rememberPending(null);
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared
          ? result.replayed ? t("notices.replayed") : t("notices.saved")
          : t("errors.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    const conflict = productPopupConflictResponse(response);
    const applicableConflict = conflict
      && conflict.resource.uid === durable.payload.uid
      && (conflict.error === "product-popup-conflict" || durable.action === "clear");
    if (applicableConflict) {
      adoptResource(conflict.resource, true);
      const cleared = rememberPending(null);
      setNotice({
        tone: cleared && conflict.error === "product-popup-already-clear" ? "info" : "error",
        text: cleared
          ? t(`errors.${productPopupErrorKey(conflict.error)}`)
          : t("errors.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    const error = productPopupErrorResponse(response);
    if (!productPopupShouldRetainMutation(error)) {
      rememberPending(null);
      setPreview(null);
    }
    setNotice({ tone: "error", text: t(`errors.${productPopupErrorKey(error)}`) });
    setBusy(false);
  }

  const canWrite = resource ? productPopupCanWrite(resource.principal) : false;
  const fieldsLocked = busy || pending !== null || !canWrite || !storageAvailable;
  const current = resource?.popup ?? null;
  const localeName = locale === "hu" ? "hu-HU" : "en-US";

  const instant = useCallback((value: number) => {
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) return common("notAvailable");
    return new Intl.DateTimeFormat(localeName, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }, [common, localeName]);

  const exactInstant = useCallback((value: number) => {
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) return common("notAvailable");
    return `${instant(value)} · ${date.toISOString()} · ${t("epoch", { value: String(value) })}`;
  }, [common, instant, t]);

  const confirmationCopy = useMemo(() => {
    if (confirming === "set" && preview) {
      return t("confirm.setCopy", { expiry: exactInstant(preview.expires_at) });
    }
    return t("confirm.clearCopy");
  }, [confirming, exactInstant, preview, t]);

  return (
    <section className="panel product-popup-panel">
      <div className="panel-header product-popup-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <button
          className="button button-secondary button-small"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >{common("refresh")}</button>
      </div>
      <div className="panel-body product-popup-body">
        {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}
        {state === "loading" ? <p className="page-subtitle">{common("loading")}</p> : null}
        {state === "error" ? (
          <div className="empty-state product-popup-load-error">
            <p>{t("errors.load")}</p>
            <button className="button button-secondary button-small" type="button" onClick={() => void load()}>{common("retry")}</button>
          </div>
        ) : null}

        {state === "ready" && resource ? (
          <>
            {pending ? (
              <div className="alert alert-info product-popup-pending" role="status">
                <div>
                  <strong>{t("pending.title")}</strong>
                  <span>{t("pending.copy", { action: t(`actions.${pending.action}`) })}</span>
                </div>
                <div className="product-popup-pending-actions">
                  <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void load()}>{t("pending.reconcile")}</button>
                  {canWrite ? <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void executeMutation()}>{t("pending.retry")}</button> : null}
                </div>
              </div>
            ) : null}
            {!canWrite ? <div className="alert alert-info">{t("viewerNotice")}</div> : null}
            {!storageAvailable ? <div className="alert alert-error">{t("errors.persistenceUnavailable")}</div> : null}

            <div className="product-popup-current-grid">
              <article className="product-popup-current">
                <header>
                  <div>
                    <span className="eyebrow">{t("current.eyebrow")}</span>
                    <h3>{t("current.title")}</h3>
                  </div>
                  <span className={`badge ${current ? `status-${current.status}` : "status-inactive"}`}>
                    {current ? t(`statuses.${current.status}`) : t("statuses.empty")}
                  </span>
                </header>
                {current ? (
                  <div className="product-popup-card product-popup-card-current">
                    <strong>{current.title}</strong>
                    <p>{current.message}</p>
                    {current.button.action !== "none" ? <span className="product-popup-button-preview">{current.button.title}</span> : null}
                  </div>
                ) : <p className="page-subtitle">{t("current.empty")}</p>}
              </article>
              <dl className="detail-list product-popup-meta">
                <div className="detail-row"><dt>{t("current.resourceRevision")}</dt><dd>{resource.resource_revision}</dd></div>
                <div className="detail-row"><dt>{t("current.evaluatedAt")}</dt><dd>{exactInstant(resource.evaluated_at)}</dd></div>
                {current ? (
                  <>
                    <div className="detail-row"><dt>{t("current.popId")}</dt><dd><code>{current.pop_id}</code></dd></div>
                    <div className="detail-row"><dt>{t("current.repeatMode")}</dt><dd>{t(`repeatModes.${current.repeat_mode}`)}</dd></div>
                    <div className="detail-row"><dt>{t("current.expiresAt")}</dt><dd>{exactInstant(current.expires_at)}</dd></div>
                    <div className="detail-row"><dt>{t("current.button")}</dt><dd>{t(`buttonActions.${current.button.action}`)}</dd></div>
                    <div className="detail-row"><dt>{t("current.created")}</dt><dd>{t("actorInstant", { actor: current.created_by, instant: exactInstant(current.created_at) })}</dd></div>
                    <div className="detail-row"><dt>{t("current.updated")}</dt><dd>{t("actorInstant", { actor: current.updated_by, instant: exactInstant(current.updated_at) })}</dd></div>
                  </>
                ) : null}
              </dl>
            </div>

            <div className="product-popup-editor-grid">
              <form className="form-stack product-popup-form" onSubmit={(event) => { event.preventDefault(); buildPreview(); }}>
                <div className="product-popup-form-heading">
                  <div><h3>{t("editor.title")}</h3><p>{t("editor.copy")}</p></div>
                  <span>{t("editor.revision", { revision: resource.resource_revision })}</span>
                </div>
                <label className="field">
                  <span>{t("fields.title")}</span>
                  {/* HTML counts UTF-16 units; the contract validator below counts Unicode scalars. */}
                  <input maxLength={200} value={draft.title} disabled={fieldsLocked} onChange={(event) => updateDraft({ title: event.target.value })} />
                  <small>{t("characters", { count: Array.from(draft.title).length, maximum: 100 })}</small>
                </label>
                <label className="field">
                  <span>{t("fields.message")}</span>
                  <textarea rows={6} maxLength={2000} value={draft.message} disabled={fieldsLocked} onChange={(event) => updateDraft({ message: event.target.value })} />
                  <small>{t("characters", { count: Array.from(draft.message).length, maximum: 1000 })}</small>
                </label>
                <div className="form-grid two-columns">
                  <label className="field">
                    <span>{t("fields.repeatMode")}</span>
                    <select value={draft.repeatMode} disabled={fieldsLocked} onChange={(event) => updateDraft({ repeatMode: event.target.value as ProductPopupDraft["repeatMode"] })}>
                      {PRODUCT_POPUP_REPEAT_MODES.map((value) => <option key={value} value={value}>{t(`repeatModes.${value}`)}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("fields.expiresAt")}</span>
                    <input type="datetime-local" step="1" value={draft.expiresAt} disabled={fieldsLocked} onChange={(event) => updateDraft({ expiresAt: event.target.value })} />
                    <small>{t("fields.expiryHint")}</small>
                  </label>
                </div>
                <div className="form-grid two-columns">
                  <label className="field">
                    <span>{t("fields.buttonAction")}</span>
                    <select value={draft.buttonAction} disabled={fieldsLocked} onChange={(event) => {
                      const action = event.target.value as ProductPopupDraft["buttonAction"];
                      updateDraft({
                        buttonAction: action,
                        ...(action === "none" ? { buttonTitle: "", buttonUrl: "" } : {}),
                        ...(action === "rate" ? { buttonUrl: "" } : {}),
                      });
                    }}>
                      {PRODUCT_POPUP_BUTTON_ACTIONS.map((value) => <option key={value} value={value}>{t(`buttonActions.${value}`)}</option>)}
                    </select>
                  </label>
                  {draft.buttonAction !== "none" ? (
                    <label className="field">
                      <span>{t("fields.buttonTitle")}</span>
                      <input maxLength={120} value={draft.buttonTitle} disabled={fieldsLocked} onChange={(event) => updateDraft({ buttonTitle: event.target.value })} />
                      <small>{t("characters", { count: Array.from(draft.buttonTitle).length, maximum: 60 })}</small>
                    </label>
                  ) : null}
                </div>
                {draft.buttonAction === "url" ? (
                  <label className="field">
                    <span>{t("fields.buttonUrl")}</span>
                    <input type="url" inputMode="url" maxLength={1000} placeholder={t("fields.buttonUrlPlaceholder")} value={draft.buttonUrl} disabled={fieldsLocked} onChange={(event) => updateDraft({ buttonUrl: event.target.value })} />
                    <small>{t("fields.buttonUrlHint")}</small>
                  </label>
                ) : null}
                <label className="field">
                  <span>{t("fields.auditReason")}</span>
                  <textarea rows={3} maxLength={1000} value={draft.auditReason} disabled={fieldsLocked} onChange={(event) => updateDraft({ auditReason: event.target.value })} />
                  <small>{t("fields.auditReasonHint", { count: Array.from(draft.auditReason).length })}</small>
                </label>
                <div className="product-popup-form-actions">
                  <button className="button button-secondary" type="submit" disabled={fieldsLocked}>{t("editor.preview")}</button>
                  <button className="button button-primary" type="button" disabled={fieldsLocked || !preview} onClick={prepareSet}>
                    {current ? t("editor.replace") : t("editor.create")}
                  </button>
                  {current ? <button className="button button-danger" type="button" disabled={fieldsLocked} onClick={prepareClear}>{t("editor.clear")}</button> : null}
                </div>
              </form>

              <aside className="product-popup-preview" aria-live="polite">
                <div className="product-popup-preview-heading">
                  <div><span className="eyebrow">{t("preview.eyebrow")}</span><h3>{t("preview.title")}</h3></div>
                  <span className={`badge ${preview ? "status-active" : "status-inactive"}`}>{preview ? t("preview.valid") : t("preview.required")}</span>
                </div>
                {preview ? (
                  <>
                    <div className="product-popup-phone">
                      <div className="product-popup-phone-top" aria-hidden="true"><span /></div>
                      <div className="product-popup-card">
                        <strong>{preview.title}</strong>
                        <p>{preview.message}</p>
                        {preview.button_action !== "none" ? <span className="product-popup-button-preview">{preview.button_title}</span> : null}
                      </div>
                    </div>
                    <dl className="detail-list compact">
                      <div className="detail-row"><dt>{t("preview.repeatMode")}</dt><dd>{t(`repeatModes.${preview.repeat_mode}`)}</dd></div>
                      <div className="detail-row"><dt>{t("preview.expiresAt")}</dt><dd>{exactInstant(preview.expires_at)}</dd></div>
                      <div className="detail-row"><dt>{t("preview.button")}</dt><dd>{t(`buttonActions.${preview.button_action}`)}</dd></div>
                      {preview.button_action === "url" ? <div className="detail-row"><dt>{t("preview.canonicalUrl")}</dt><dd><code>{preview.button_url}</code></dd></div> : null}
                    </dl>
                    <p className="product-popup-preview-note">{t("preview.exactCopy")}</p>
                  </>
                ) : <p className="page-subtitle">{t("preview.empty")}</p>}
              </aside>
            </div>
          </>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmDialog
          title={t(`confirm.${confirming}Title`)}
          copy={confirmationCopy}
          confirmLabel={t(`confirm.${confirming}Button`)}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void executeMutation()}
        />
      ) : null}
    </section>
  );
}

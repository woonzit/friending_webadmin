"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, adminUploadPingerIcon, type PingerIconVariant } from "@/lib/adminClient";
import {
  PINGER_COPY_KEYS,
  pingerIconURL,
  pingerAdminPayload,
  pingerConfigurationWire,
  validatePingerConfiguration,
  type PingerAuditRow,
  type PingerConfiguration,
  type PingerCopyKey,
  type PingerLimits,
} from "@/lib/pinger";

function clone(configuration: PingerConfiguration): PingerConfiguration {
  return JSON.parse(JSON.stringify(configuration)) as PingerConfiguration;
}

/// Four slots: two states, each in both appearances. The resting pair keeps the
/// original `light`/`dark` variant names so artwork uploaded before the liked
/// state existed stays exactly where it is.
const ICON_SLOTS = [
  { variant: "light", group: "icon", field: "lightUrl", label: "light" },
  { variant: "dark", group: "icon", field: "darkUrl", label: "dark" },
  { variant: "liked_light", group: "iconLiked", field: "lightUrl", label: "likedLight" },
  { variant: "liked_dark", group: "iconLiked", field: "darkUrl", label: "likedDark" },
] as const satisfies readonly {
  variant: PingerIconVariant;
  group: "icon" | "iconLiked";
  field: "lightUrl" | "darkUrl";
  label: string;
}[];

export default function PingerPage() {
  const t = useTranslations("pinger");
  const common = useTranslations("common");
  const [saved, setSaved] = useState<PingerConfiguration | null>(null);
  const [draft, setDraft] = useState<PingerConfiguration | null>(null);
  const [audit, setAudit] = useState<PingerAuditRow[]>([]);
  const [limits, setLimits] = useState<PingerLimits | null>(null);
  const [chatContractReady, setChatContractReady] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<PingerIconVariant | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const adopt = useCallback((raw: unknown): boolean => {
    const payload = pingerAdminPayload(raw);
    if (!payload) return false;
    setSaved(payload.configuration);
    setDraft(clone(payload.configuration));
    setAudit(payload.audit);
    setLimits(payload.limits);
    setChatContractReady(payload.capabilities.chatContractReady);
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setNotice(null);
    const response = await adminCall("pinger_admin");
    setState(response?.success && adopt(response) ? "ready" : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)),
    [draft, saved],
  );

  function patch(next: Partial<PingerConfiguration>) {
    setDraft((current) => current ? { ...current, ...next } : current);
  }

  function patchCopy(key: PingerCopyKey, language: "en" | "hu", value: string) {
    setDraft((current) => current ? {
      ...current,
      copy: {
        ...current.copy,
        [key]: { ...current.copy[key], [language]: value },
      },
    } : current);
  }

  async function uploadIcon(file: File, variant: PingerIconVariant) {
    setUploading(variant);
    setNotice(null);
    const response = await adminUploadPingerIcon(file, variant);
    setUploading(null);
    const mediaUrl = pingerIconURL(response?.media_url) ?? "";
    if (!response?.success || !mediaUrl) {
      const code = typeof response?.error === "string" ? response.error : "";
      setNotice({ tone: "error", text: code ? t("errors.rejected", { code }) : t("errors.upload") });
      return;
    }
    const slot = ICON_SLOTS.find((candidate) => candidate.variant === variant);
    if (!slot) return;
    setDraft((current) => current ? {
      ...current,
      [slot.group]: { ...current[slot.group], [slot.field]: mediaUrl },
    } : current);
    setNotice({ tone: "success", text: t("icon.staged") });
  }

  async function save() {
    if (!draft || !limits) return;
    const validation = validatePingerConfiguration(draft, limits);
    if (Object.keys(validation).length > 0) {
      setNotice({ tone: "error", text: t("errors.validation") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const response = await adminCall("save_pinger_config", {
      expected_revision: draft.revision,
      configuration: pingerConfigurationWire(draft),
    });
    setBusy(false);
    if (response?.success && adopt(response)) {
      setNotice({ tone: "success", text: t("saved") });
      return;
    }
    if (response?.error === "pinger-config-conflict") {
      if (!adopt(response)) await load();
      setNotice({ tone: "error", text: t("errors.conflict") });
      return;
    }
    const code = typeof response?.error === "string" ? response.error : "";
    setNotice({ tone: "error", text: code ? t("errors.rejected", { code }) : t("errors.save") });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !draft || !limits) return <ErrorPanel message={t("errors.load")} retry={() => void load()} />;

  const validation = validatePingerConfiguration(draft, limits);
  const hasValidationErrors = Object.keys(validation).length > 0;
  const fieldError = (key: string) => validation[key]
    ? <small className="field-error">{t("errors.field")}</small>
    : null;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={(
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load()}>{common("refresh")}</button>
            <button className="button button-primary" type="button" disabled={busy || !dirty || uploading !== null || hasValidationErrors} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
          </div>
        )}
      />

      {notice && <div className={`notice ${notice.tone === "error" ? "notice-error" : "notice-success"}`} role="status">{notice.text}</div>}

      <section className="panel pinger-panel">
        <div className="panel-header">
          <div><h2>{t("runtime.title")}</h2><p>{t("runtime.copy")}</p></div>
          <label className="switch-field">
            <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => patch({ enabled: event.target.checked })} />
            <span>{draft.enabled ? common("enabled") : common("disabled")}</span>
          </label>
        </div>
        <div className="panel-body form-grid pinger-form-grid">
          <label className="field"><span>{t("runtime.actionKey")}</span><input value={draft.actionKey} maxLength={32} disabled={busy} onChange={(event) => patch({ actionKey: event.target.value.toLowerCase() })} /><small>{t("runtime.actionKeyHelp")}</small>{fieldError("actionKey")}</label>
          <label className="field"><span>{t("runtime.cooldown")}</span><input type="number" min={limits.cooldownMin} max={limits.cooldownMax} value={draft.cooldownSeconds} disabled={busy} onChange={(event) => patch({ cooldownSeconds: Number(event.target.value) })} /><small>{t("runtime.seconds")}</small>{fieldError("cooldownSeconds")}</label>
          <label className="field"><span>{t("runtime.retention")}</span><input type="number" min={limits.retentionMin} max={limits.retentionMax} value={draft.retentionSeconds} disabled={busy} onChange={(event) => patch({ retentionSeconds: Number(event.target.value) })} /><small>{t("runtime.seconds")}</small>{fieldError("retentionSeconds")}</label>
          <label className="field"><span>{t("runtime.chatContract")}</span><select value={draft.chatContractVersion} disabled={busy || (!chatContractReady && draft.chatContractVersion === 0)} onChange={(event) => patch({ chatContractVersion: Number(event.target.value) as 0 | 1 })}><option value={0}>{t("runtime.chatContractOff")}</option><option value={1} disabled={!chatContractReady}>{t("runtime.chatContractOn")}</option></select><small>{chatContractReady ? t("runtime.chatContractHelp") : t("runtime.chatContractLocked")}</small>{fieldError("chatContractVersion")}</label>
          <label className="switch-field pinger-gate-switch"><input type="checkbox" checked={draft.chatGateDefault} disabled={busy} onChange={(event) => patch({ chatGateDefault: event.target.checked })} /><span>{t("runtime.gateDefault")}</span></label>
        </div>
      </section>

      <section className="panel pinger-panel">
        <div className="panel-header"><div><h2>{t("icon.title")}</h2><p>{t("icon.copy")}</p></div></div>
        <div className="panel-body">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.useBundledIcons}
              disabled={busy}
              onChange={(event) => setDraft((current) => current
                ? { ...current, useBundledIcons: event.target.checked }
                : current)}
            />
            <span>
              <strong>{t("icon.useBundled")}</strong>
              <em>{t("icon.useBundledHint")}</em>
            </span>
          </label>
          {/* The uploads stay visible and stay stored while the switch is on:
              turning it off must bring the previous artwork back rather than
              ask for four files again. */}
          <div className="pinger-icons" aria-disabled={draft.useBundledIcons}>
            {ICON_SLOTS.map((slot) => {
              const url = draft[slot.group][slot.field];
              const ignored = draft.useBundledIcons;
              return (
                <div className={`pinger-icon-card ${slot.variant}`} key={slot.variant}>
                  <div className="pinger-icon-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url && !ignored ? <img src={url} alt="" /> : <span>{t("icon.empty")}</span>}
                  </div>
                  <strong>{t(`icon.${slot.label}`)}</strong>
                  <label className="button button-secondary">
                    {uploading === slot.variant ? t("icon.uploading") : t("icon.choose")}
                    <input type="file" accept="image/png,image/svg+xml" disabled={busy || ignored || uploading !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadIcon(file, slot.variant); event.target.value = ""; }} />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel pinger-panel">
        <div className="panel-header"><div><h2>{t("copy.title")}</h2><p>{t("copy.copy")}</p></div></div>
        <div className="panel-body pinger-copy-grid">
          {PINGER_COPY_KEYS.map((key) => (
            <div className="pinger-copy-row" key={key}>
              <div><strong>{t(`copy.keys.${key}`)}</strong><code>{key}</code></div>
              {(["en", "hu"] as const).map((language) => (
                <label className="field" key={language}><span>{language.toUpperCase()}</span><textarea value={draft.copy[key][language]} rows={2} disabled={busy} onChange={(event) => patchCopy(key, language, event.target.value)} /><small>{Array.from(draft.copy[key][language]).length}/{limits.copyMaxLength}</small>{fieldError(`copy.${key}.${language}`)}</label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="panel pinger-panel">
        <div className="panel-header"><div><h2>{t("audit.title")}</h2><p>{t("audit.copy")}</p></div><span className="status-pill">r{draft.revision}</span></div>
        <div className="panel-body audit-feed">
          {audit.length === 0 && <p className="muted">{t("audit.empty")}</p>}
          {audit.map((row) => (
            <div className="audit-feed-row" key={`${row.id}-${row.createdAt}`}>
              <div><strong>{row.action}</strong><span>{row.actorEmail || t("audit.system")} · r{row.oldRevision}→r{row.newRevision}</span></div>
              <time>{new Date(row.createdAt * 1000).toLocaleString()}</time>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

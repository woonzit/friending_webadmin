"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  INVITE_OVERRIDE_MAX_COUNT,
  INVITE_REQUIRED_LANGUAGES,
  INVITE_TEMPLATE_MAX_LENGTH,
  cloneInviteConfiguration,
  inviteDraftIssue,
  inviteSaveBody,
  normalizedStorefront,
  parseInviteConfigurationPayload,
  type InviteConfiguration,
  type InviteDeliveryMode,
  type InviteMessages,
} from "@/lib/inviteConfiguration";

function setMessage(messages: InviteMessages, language: string, value: string): InviteMessages {
  return { ...messages, [language]: Array.from(value).slice(0, INVITE_TEMPLATE_MAX_LENGTH).join("") };
}

function preview(template: string): string {
  return template
    .replaceAll("{display_name}", "Alex")
    .replaceAll("{user_url}", "https://friending.com/@alex_427");
}

export default function InviteConfigurationPage() {
  const t = useTranslations("inviteConfiguration");
  const common = useTranslations("common");
  const [saved, setSaved] = useState<InviteConfiguration | null>(null);
  const [draft, setDraft] = useState<InviteConfiguration | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setStatusMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [newLanguage, setNewLanguage] = useState("");

  const adopt = useCallback((raw: unknown): boolean => {
    const parsed = parseInviteConfigurationPayload(raw);
    if (!parsed) return false;
    setSaved(parsed.configuration);
    setDraft(cloneInviteConfiguration(parsed.configuration));
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setStatusMessage(null);
    const response = await adminCall("invite_configuration");
    setState(response?.success && adopt(response.data) ? "ready" : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)),
    [draft, saved],
  );

  const languages = useMemo(() => {
    if (!draft) return [...INVITE_REQUIRED_LANGUAGES];
    const keys = new Set<string>(INVITE_REQUIRED_LANGUAGES);
    Object.keys(draft.global.messages).forEach((key) => keys.add(key));
    draft.overrides.forEach((item) => Object.keys(item.messages).forEach((key) => keys.add(key)));
    return [...keys].sort((a, b) => {
      const fixedA = INVITE_REQUIRED_LANGUAGES.indexOf(a as "en" | "hu");
      const fixedB = INVITE_REQUIRED_LANGUAGES.indexOf(b as "en" | "hu");
      if (fixedA >= 0 || fixedB >= 0) return (fixedA >= 0 ? fixedA : 99) - (fixedB >= 0 ? fixedB : 99);
      return a.localeCompare(b);
    });
  }, [draft]);

  function patch(next: Partial<InviteConfiguration>) {
    setDraft((current) => current ? { ...current, ...next } : current);
  }

  function setGlobalMode(mode: InviteDeliveryMode) {
    setDraft((current) => current ? { ...current, global: { ...current.global, mode } } : current);
  }

  function setGlobalMessage(language: string, value: string) {
    setDraft((current) => current ? {
      ...current,
      global: { ...current.global, messages: setMessage(current.global.messages, language, value) },
    } : current);
  }

  function patchOverride(index: number, next: Partial<InviteConfiguration["overrides"][number]>) {
    setDraft((current) => current ? {
      ...current,
      overrides: current.overrides.map((item, position) => position === index ? { ...item, ...next } : item),
    } : current);
  }

  function setOverrideMessage(index: number, language: string, value: string) {
    setDraft((current) => current ? {
      ...current,
      overrides: current.overrides.map((item, position) => position === index
        ? { ...item, messages: setMessage(item.messages, language, value) }
        : item),
    } : current);
  }

  function addLanguage() {
    const language = newLanguage.trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(language) || languages.includes(language)) {
      setStatusMessage({ tone: "error", text: t("languageInvalid") });
      return;
    }
    setDraft((current) => current ? {
      ...current,
      global: { ...current.global, messages: { ...current.global.messages, [language]: "" } },
    } : current);
    setNewLanguage("");
    setStatusMessage(null);
  }

  function removeLanguage(language: string) {
    if ((INVITE_REQUIRED_LANGUAGES as readonly string[]).includes(language)) return;
    setDraft((current) => {
      if (!current) return current;
      const globalMessages = { ...current.global.messages };
      delete globalMessages[language];
      return {
        ...current,
        global: { ...current.global, messages: globalMessages },
        overrides: current.overrides.map((item) => {
          const messages = { ...item.messages };
          delete messages[language];
          return { ...item, messages };
        }),
      };
    });
  }

  function addOverride() {
    if (!draft || draft.overrides.length >= INVITE_OVERRIDE_MAX_COUNT) return;
    patch({
      overrides: [
        ...draft.overrides,
        { storefront: "", mode: draft.global.mode, active: true, messages: {} },
      ],
    });
  }

  function removeOverride(index: number) {
    if (!draft) return;
    patch({ overrides: draft.overrides.filter((_, position) => position !== index) });
  }

  async function save() {
    if (!draft) return;
    const issue = inviteDraftIssue(draft);
    if (issue) {
      setStatusMessage({ tone: "error", text: t(`validation.${issue}`) });
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    const response = await adminCall("save_invite_configuration", inviteSaveBody(draft));
    setBusy(false);
    if (response?.success && adopt(response.data)) {
      setStatusMessage({ tone: "success", text: t("saved") });
      return;
    }
    if (response?.error === "invite-configuration-conflict") {
      setStatusMessage({ tone: "error", text: t("errors.conflict") });
      await load();
      return;
    }
    const code = typeof response?.error === "string" ? response.error : "";
    setStatusMessage({ tone: "error", text: code ? t("errors.rejected", { code }) : t("errors.save") });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !saved || !draft) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const modeControl = (value: InviteDeliveryMode, onChange: (mode: InviteDeliveryMode) => void, id: string) => (
    <div className="invite-mode-grid" id={id}>
      {(["server_sms", "device_sms"] as InviteDeliveryMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`invite-mode-card${value === mode ? " active" : ""}`}
          aria-pressed={value === mode}
          disabled={busy}
          onClick={() => onChange(mode)}
        >
          <strong>{t(`modes.${mode}.title`)}</strong>
          <span>{t(`modes.${mode}.copy`)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={(
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load()}>{common("refresh")}</button>
            <button className="button button-primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
          </div>
        )}
      />

      {message && <div className={`notice ${message.tone === "error" ? "notice-error" : "notice-success"}`} role="status">{message.text}</div>}

      <section className="panel invite-config-panel">
        <div className="panel-header">
          <div><h2>{t("global.title")}</h2><p>{t("global.copy")}</p></div>
          <label className="switch-field">
            <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => patch({ enabled: event.target.checked })} />
            <span>{draft.enabled ? common("enabled") : common("disabled")}</span>
          </label>
        </div>
        <div className="panel-body invite-config-body">
          <div className="field">
            <span>{t("deliveryMode")}</span>
            {modeControl(draft.global.mode, setGlobalMode, "invite-global-mode")}
          </div>
          <div className="invite-template-heading">
            <div><h3>{t("templates.title")}</h3><p>{t("templates.copy")}</p></div>
            <div className="invite-language-add">
              <input aria-label={t("addLanguageLabel")} placeholder={t("addLanguagePlaceholder")} value={newLanguage} maxLength={3} onChange={(event) => setNewLanguage(event.target.value.replace(/[^a-zA-Z]/g, ""))} />
              <button className="button button-secondary" type="button" disabled={busy} onClick={addLanguage}>{t("addLanguage")}</button>
            </div>
          </div>
          <div className="invite-placeholder-note">
            <span>{t("templates.placeholders")}</span>
            <code>{"{user_url}"}</code><strong>{t("templates.required")}</strong>
            <code>{"{display_name}"}</code><span>{t("templates.optional")}</span>
          </div>
          <div className="invite-template-grid">
            {languages.map((language) => {
              const template = draft.global.messages[language] ?? "";
              const required = (INVITE_REQUIRED_LANGUAGES as readonly string[]).includes(language);
              return (
                <article className="invite-template-card" key={language}>
                  <header><strong>{language.toUpperCase()}</strong>{!required && <button className="text-button" type="button" onClick={() => removeLanguage(language)}>{t("removeLanguage")}</button>}</header>
                  <textarea rows={4} value={template} disabled={busy} aria-label={t("templateLabel", { language: language.toUpperCase() })} onChange={(event) => setGlobalMessage(language, event.target.value)} />
                  <div className="invite-template-meta"><span>{Array.from(template).length} / {INVITE_TEMPLATE_MAX_LENGTH}</span><span>{template.includes("{user_url}") ? t("urlPresent") : t("urlMissing")}</span></div>
                  <p className="invite-template-preview"><span>{t("preview")}</span>{preview(template)}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel invite-config-panel">
        <div className="panel-header">
          <div><h2>{t("overrides.title")}</h2><p>{t("overrides.copy")}</p></div>
          <button className="button button-secondary" type="button" disabled={busy || draft.overrides.length >= INVITE_OVERRIDE_MAX_COUNT} onClick={addOverride}>{t("overrides.add")}</button>
        </div>
        <div className="panel-body invite-overrides">
          {draft.overrides.length === 0 && <div className="empty-state-inner"><h3>{t("overrides.empty")}</h3><p>{t("overrides.emptyCopy")}</p></div>}
          {draft.overrides.map((item, index) => (
            <article className="invite-override-card" key={`${index}-${item.storefront}`}>
              <header>
                <div>
                  <label className="field invite-storefront-field"><span>{t("overrides.storefront")}</span><input value={item.storefront} maxLength={3} placeholder="HUN" disabled={busy} onChange={(event) => patchOverride(index, { storefront: normalizedStorefront(event.target.value) })} /></label>
                  <p>{t("overrides.storefrontHint")}</p>
                </div>
                <div className="row-actions">
                  <label className="switch-field"><input type="checkbox" checked={item.active} disabled={busy} onChange={(event) => patchOverride(index, { active: event.target.checked })} /><span>{item.active ? common("active") : common("inactive")}</span></label>
                  <button className="button button-danger" type="button" disabled={busy} onClick={() => removeOverride(index)}>{common("delete")}</button>
                </div>
              </header>
              <div className="field"><span>{t("deliveryMode")}</span>{modeControl(item.mode, (mode) => patchOverride(index, { mode }), `invite-mode-${index}`)}</div>
              <h3>{t("overrides.templates")}</h3>
              <p className="field-hint">{t("overrides.inherit")}</p>
              <div className="invite-template-grid">
                {languages.map((language) => (
                  <label className="field" key={language}>
                    <span>{t("templateLabel", { language: language.toUpperCase() })}</span>
                    <textarea rows={3} value={item.messages[language] ?? ""} disabled={busy} placeholder={t("overrides.inheritPlaceholder")} onChange={(event) => setOverrideMessage(index, language, event.target.value)} />
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="invite-sticky-actions">
        <span>{dirty ? t("unsaved") : t("revision", { revision: saved.revision })}</span>
        <div className="row-actions">
          <button className="button button-secondary" type="button" disabled={busy || !dirty} onClick={() => setDraft(cloneInviteConfiguration(saved))}>{t("discard")}</button>
          <button className="button button-primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
        </div>
      </div>
    </>
  );
}

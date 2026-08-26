"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  PROFILE_VERIFICATION_BADGE_STATUSES,
  PROFILE_VERIFICATION_DETAIL_STATUSES,
  cloneProfileVerificationConfig,
  isProfileVerificationColor,
  normalizeProfileVerificationConfig,
  profileVerificationResponseData,
  profileVerificationSavePayload,
  type ProfileVerificationConfig,
  type ProfileVerificationIconColor,
  type ProfileVerificationLocalizedText,
} from "@/lib/profileVerification";

type Language = "en" | "hu";
type Feedback = { tone: "success" | "error"; text: string };

function plainText(value: string, maximum: number): string {
  const clean = value.replace(/[\u0000-\u001F\u007F]/gu, " ");
  return Array.from(clean).slice(0, maximum).join("");
}

function LocalizedFields({
  value,
  onChange,
  labelEn,
  labelHu,
  maximum,
  multiline = false,
  disabled = false,
}: {
  value: ProfileVerificationLocalizedText;
  onChange: (language: Language, value: string) => void;
  labelEn: string;
  labelHu: string;
  maximum: number;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="verification-localized-pair">
      {(["en", "hu"] as const).map((language) => (
        <label className="field" key={language}>
          <span>{language === "en" ? labelEn : labelHu}</span>
          {multiline ? (
            <textarea
              rows={3}
              maxLength={maximum}
              value={value[language]}
              disabled={disabled}
              onChange={(event) => onChange(language, plainText(event.target.value, maximum))}
            />
          ) : (
            <input
              maxLength={maximum}
              value={value[language]}
              disabled={disabled}
              onChange={(event) => onChange(language, plainText(event.target.value, maximum))}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function ColorFields({
  value,
  onChange,
  lightLabel,
  darkLabel,
  disabled,
}: {
  value: ProfileVerificationIconColor;
  onChange: (mode: "light" | "dark", value: string) => void;
  lightLabel: string;
  darkLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="verification-color-grid">
      {(["light", "dark"] as const).map((mode) => {
        const current = value[mode];
        return (
          <label className="field" key={mode}>
            <span>{mode === "light" ? lightLabel : darkLabel}</span>
            <span className="verification-color-control">
              <input
                type="color"
                value={current}
                disabled={disabled}
                aria-label={mode === "light" ? lightLabel : darkLabel}
                onChange={(event) => onChange(mode, event.target.value.toUpperCase())}
              />
              <input
                value={current}
                maxLength={7}
                spellCheck={false}
                disabled={disabled}
                aria-invalid={!isProfileVerificationColor(current)}
                onChange={(event) => onChange(mode, event.target.value.toUpperCase())}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function ProfileVerificationConfiguration() {
  const t = useTranslations("profileVerification.configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const previewLanguage: Language = locale === "hu" ? "hu" : "en";
  const [stored, setStored] = useState<ProfileVerificationConfig | null>(null);
  const [draft, setDraft] = useState<ProfileVerificationConfig | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const adopt = useCallback((raw: unknown): boolean => {
    const parsed = normalizeProfileVerificationConfig(raw);
    if (!parsed) return false;
    setStored(parsed);
    setDraft(cloneProfileVerificationConfig(parsed));
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setFeedback(null);
    const response = await adminCall("profile_verification_config");
    setState(response?.success && adopt(profileVerificationResponseData(response)) ? "ready" : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => Boolean(stored && draft
    && JSON.stringify(profileVerificationSavePayload(stored))
      !== JSON.stringify(profileVerificationSavePayload(draft))), [stored, draft]);

  function change(mutator: (next: ProfileVerificationConfig) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneProfileVerificationConfig(current);
      mutator(next);
      return next;
    });
    setFeedback(null);
  }

  function setLocalized(
    target: ProfileVerificationLocalizedText,
    language: Language,
    value: string,
  ) {
    target[language] = value;
  }

  async function save() {
    if (!draft || !stored || busy) return;
    const validated = normalizeProfileVerificationConfig(draft);
    if (!validated) {
      setFeedback({ tone: "error", text: t("invalid") });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const response = await adminCall("save_profile_verification_config", {
      configuration: profileVerificationSavePayload(validated),
      expected_revision: stored.revision,
    });
    setBusy(false);
    const authoritative = profileVerificationResponseData(response);
    if (!response?.success) {
      if (response?.error === "profile-verification-config-conflict" && adopt(authoritative)) {
        setFeedback({ tone: "error", text: t("conflict") });
        return;
      }
      const message = response?.error === "profile-verification-enablement-locked"
        ? t("enablementLocked")
        : t("saveError", { error: String(response?.error || "core-unavailable") });
      setFeedback({ tone: "error", text: message });
      return;
    }
    if (!adopt(authoritative)) {
      setFeedback({ tone: "error", text: t("invalidResponse") });
      return;
    }
    setFeedback({ tone: "success", text: t("saved") });
  }

  if (state === "loading") {
    return <section id="profile-verification" className="panel verification-config-panel"><div className="panel-body"><p className="page-subtitle">{common("loading")}</p></div></section>;
  }
  if (state === "error" || !stored || !draft) {
    return <section id="profile-verification" className="panel verification-config-panel"><div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div></div><div className="panel-body"><div className="alert alert-error">{t("loadError")}</div><button className="button button-secondary" onClick={() => void load()}>{common("retry")}</button></div></section>;
  }

  const locked = busy;
  return (
    <section id="profile-verification" className="panel verification-config-panel">
      <div className="panel-header verification-config-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
          <div className="setting-meta">
            <span>{t("revision", { revision: stored.revision })}</span>
            <span>{t("updatedAt")}: {stored.updated_at ? formatDate(stored.updated_at, locale, true) : "—"}</span>
            {stored.updated_by && <span>{t("updatedBy")}: {stored.updated_by}</span>}
          </div>
        </div>
        <div className="row-actions">
          <button className="button button-secondary" type="button" disabled={locked || !dirty} onClick={() => { setDraft(cloneProfileVerificationConfig(stored)); setFeedback(null); }}>{t("reset")}</button>
          <button className="button button-primary" type="button" disabled={locked || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
        </div>
      </div>
      <div className="panel-body verification-config-body">
        {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"}`} role="status">{feedback.text}</div>}
        {dirty && !feedback && <div className="alert alert-info" role="status">{t("unsaved")}</div>}

        <label className="switch-row verification-feature-switch">
          <input type="checkbox" checked={draft.enabled} disabled={locked} onChange={(event) => change((next) => { next.enabled = event.target.checked; })} />
          <span><strong>{t("enabled")}</strong><small>{t("enabledHint")}</small></span>
        </label>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("account.title")}</h3><p>{t("account.copy")}</p></div>
          <div className="verification-status-editor-grid">
            {PROFILE_VERIFICATION_BADGE_STATUSES.map((status) => {
              const card = draft.copy.account_card[status];
              return (
                <article className="verification-status-editor" key={status}>
                  <div className="verification-status-editor-heading">
                    <div><span className="badge">{t(`statusLabels.${status}`)}</span><code>{status}</code></div>
                    <div className="verification-color-preview" aria-label={t("account.colorPreview")}>
                      <span className="light" style={{ color: card.icon_color.light }}>✓</span>
                      <span className="dark" style={{ color: card.icon_color.dark }}>✓</span>
                    </div>
                  </div>
                  <LocalizedFields value={card.title} maximum={160} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.account_card[status].title, language, value))} />
                  <LocalizedFields value={card.subtitle} maximum={320} disabled={locked} labelEn={t("fields.subtitleEn")} labelHu={t("fields.subtitleHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.account_card[status].subtitle, language, value))} />
                  <ColorFields value={card.icon_color} disabled={locked} lightLabel={t("fields.lightColor")} darkLabel={t("fields.darkColor")} onChange={(mode, value) => change((next) => { next.copy.account_card[status].icon_color[mode] = value; })} />
                  <div className="verification-account-preview">
                    <span className="verification-account-preview-icon" style={{ color: card.icon_color.dark }}>✓</span>
                    <span><strong>{card.title[previewLanguage]}</strong><small>{card.subtitle[previewLanguage]}</small></span>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="field-hint">{t("account.publicBadgeHint")}</p>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("intro.title")}</h3><p>{t("intro.copy")}</p></div>
          <LocalizedFields value={draft.copy.intro.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.title, language, value))} />
          <LocalizedFields value={draft.copy.intro.body} maximum={1200} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.intro.body, language, value))} />
          {draft.copy.intro.steps.map((step, index) => (
            <div className="verification-copy-row" key={step.key}>
              <div className="verification-copy-row-title"><span className="verification-step-number">{index + 1}</span><code>{step.key}</code></div>
              <LocalizedFields value={step.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.steps[index].title, language, value))} />
              <LocalizedFields value={step.body} maximum={700} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.intro.steps[index].body, language, value))} />
            </div>
          ))}
          <LocalizedFields value={draft.copy.intro.action} maximum={120} disabled={locked} labelEn={t("fields.actionEn")} labelHu={t("fields.actionHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.action, language, value))} />
          <div className="verification-intro-preview">
            <span className="verification-preview-camera">▣</span>
            <h4>{draft.copy.intro.title[previewLanguage]}</h4>
            <p>{draft.copy.intro.body[previewLanguage]}</p>
            {draft.copy.intro.steps.map((step, index) => <div key={step.key}><b>{index + 1}</b><span><strong>{step.title[previewLanguage]}</strong><small>{step.body[previewLanguage]}</small></span></div>)}
            <button type="button" disabled>{draft.copy.intro.action[previewLanguage]}</button>
          </div>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("camera.title")}</h3><p>{t("camera.copy")}</p></div>
          {(["title", "framing", "ready", "recording"] as const).map((key) => (
            <LocalizedFields key={key} value={draft.copy.camera[key]} maximum={key === "framing" ? 320 : key === "recording" ? 240 : 180} disabled={locked} labelEn={t(`camera.fields.${key}En`)} labelHu={t(`camera.fields.${key}Hu`)} multiline={key === "framing" || key === "recording"} onChange={(language, value) => change((next) => setLocalized(next.copy.camera[key], language, value))} />
          ))}
          <div className="verification-camera-preview">
            <h4>{draft.copy.camera.title[previewLanguage]}</h4>
            <div className="verification-face-oval"><span>☺</span></div>
            <p>{draft.copy.camera.framing[previewLanguage]}</p>
            <button type="button" disabled>{draft.copy.camera.ready[previewLanguage]}</button>
          </div>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("preview.title")}</h3><p>{t("preview.copy")}</p></div>
          <LocalizedFields value={draft.copy.preview.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.title, language, value))} />
          <LocalizedFields value={draft.copy.preview.body} maximum={700} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.preview.body, language, value))} />
          <LocalizedFields value={draft.copy.preview.retake} maximum={120} disabled={locked} labelEn={t("preview.retakeEn")} labelHu={t("preview.retakeHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.retake, language, value))} />
          <LocalizedFields value={draft.copy.preview.submit} maximum={120} disabled={locked} labelEn={t("preview.submitEn")} labelHu={t("preview.submitHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.submit, language, value))} />
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("details.title")}</h3><p>{t("details.copy")}</p></div>
          <div className="verification-status-copy-list">
            {PROFILE_VERIFICATION_DETAIL_STATUSES.map((status) => (
              <article className="verification-copy-row" key={status}>
                <div className="verification-copy-row-title"><span className="badge">{t(`statusLabels.${status}`)}</span><code>{status}</code></div>
                <LocalizedFields value={draft.copy.status[status].title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.status[status].title, language, value))} />
                <LocalizedFields value={draft.copy.status[status].subtitle} maximum={500} disabled={locked} labelEn={t("fields.subtitleEn")} labelHu={t("fields.subtitleHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.status[status].subtitle, language, value))} />
              </article>
            ))}
          </div>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("prompts.title")}</h3><p>{t("prompts.copy")}</p></div>
          <div className="verification-prompt-list">
            {draft.prompts.map((prompt, index) => {
              const mandatory = prompt.key === "turn_left" || prompt.key === "turn_right";
              return (
                <article className="verification-copy-row" key={prompt.key}>
                  <label className="switch-row verification-prompt-switch">
                    <input type="checkbox" checked={prompt.enabled} disabled={locked || mandatory} onChange={(event) => change((next) => { next.prompts[index].enabled = event.target.checked; })} />
                    <span><strong>{t(`promptLabels.${prompt.key}`)}</strong><small>{mandatory ? t("prompts.mandatory") : prompt.key}</small></span>
                  </label>
                  <LocalizedFields value={prompt.label} maximum={180} disabled={locked} labelEn={t("fields.labelEn")} labelHu={t("fields.labelHu")} onChange={(language, value) => change((next) => setLocalized(next.prompts[index].label, language, value))} />
                </article>
              );
            })}
          </div>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("consent.title")}</h3><p>{t("consent.copy")}</p></div>
          <LocalizedFields value={draft.copy.consent.body} maximum={1800} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.consent.body, language, value))} />
          <LocalizedFields value={draft.copy.consent.link_title} maximum={180} disabled={locked} labelEn={t("consent.linkTitleEn")} labelHu={t("consent.linkTitleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.consent.link_title, language, value))} />
          <label className="field"><span>{t("consent.linkUrl")}</span><input type="url" value={draft.copy.consent.link_url} maxLength={2048} disabled={locked} onChange={(event) => change((next) => { next.copy.consent.link_url = plainText(event.target.value, 2048); })} /></label>
        </div>

        <div className="row-actions verification-bottom-actions">
          <button className="button button-secondary" type="button" disabled={locked || !dirty} onClick={() => { setDraft(cloneProfileVerificationConfig(stored)); setFeedback(null); }}>{t("reset")}</button>
          <button className="button button-primary" type="button" disabled={locked || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  PERSONA_START_SECTIONS,
  canonicalPersonaUid,
  clonePersonaStartConfig,
  personaAdminCapabilitiesFrom,
  personaAdminErrorKey,
  personaAdminFailureResponse,
  personaCapabilityAllows,
  personaEmptyMutationResponse,
  personaForceMutationResponse,
  personaHighlightParts,
  personaPreviewColor,
  personaPreviewImageUrl,
  personaStartConfigPatch,
  personaStartConfigResponse,
  personaStartDraftWithValue,
  personaStartFieldKind,
  personaStartHtmlMaxLength,
  personaStartStringCap,
  personaStartUpdateResponse,
  personaTargetFromUserDetail,
  personaUidPayload,
  type PersonaAdminCapabilities,
  type PersonaAdminCapabilityAction,
  type PersonaStartConfig,
  type PersonaStartFieldKey,
  type PersonaStartStringKey,
  type PersonaTarget,
} from "@/lib/personaAdmin";

type LoadState = "loading" | "ready" | "dormant" | "error";
type Feedback = { tone: "success" | "error" | "info"; text: string };
type MemberAction = "apply_fake" | "revoke_fake" | "force_verify";
type Confirmation = { kind: "config" } | { kind: MemberAction };

const MEMBER_ENDPOINTS: Record<MemberAction, string> = {
  apply_fake: "admin_apply_fake_persona",
  revoke_fake: "admin_revoke_fake_persona",
  force_verify: "admin_force_persona_verify",
};

function HighlightedCopy({
  template,
  highlight,
  highlightColor,
}: {
  template: string;
  highlight: string;
  highlightColor: string;
}) {
  return personaHighlightParts(template, highlight).map((part, index) => (
    part.highlighted
      ? <span key={`${index}-${part.text}`} style={{ color: highlightColor }}>{part.text}</span>
      : <span key={`${index}-${part.text}`}>{part.text}</span>
  ));
}

function PreviewIcon({
  imageUrl,
  color,
  background,
}: {
  imageUrl: string;
  color: string;
  background: string;
}) {
  const safeImage = personaPreviewImageUrl(imageUrl);
  return (
    <span
      className="persona-preview-icon"
      style={{
        color: personaPreviewColor(color, "#7A7FFD"),
        backgroundColor: personaPreviewColor(background, "#EFEFFE"),
      }}
    >
      {safeImage
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={safeImage} alt="" />
        : <span aria-hidden="true">◆</span>}
    </span>
  );
}

function PersonaStartPreview({ config }: { config: PersonaStartConfig }) {
  const t = useTranslations("personaAdmin.preview");
  const pageBackground = personaPreviewColor(config.page_bg_color, "#FAFAFC");
  const titleColor = personaPreviewColor(config.title_color, "#0A0A19");
  const titleHighlight = personaPreviewColor(config.title_highlight_color, "#7A7FFD");
  const subtitleColor = personaPreviewColor(config.subtitle_color, "#5C5C72");
  const subtitleHighlight = personaPreviewColor(config.subtitle_highlight_color, "#7A7FFD");
  const headerLogo = personaPreviewImageUrl(config.header_logo_url);

  return (
    <aside className="persona-preview-column" aria-label={t("label")}>
      <div className="persona-preview-heading">
        <div><h3>{t("title")}</h3><p>{t("copy")}</p></div>
        <span className={`badge ${config.active ? "badge-active" : "badge-inactive"}`}>
          {config.active ? t("active") : t("inactive")}
        </span>
      </div>
      <div className="persona-phone-frame">
        <div className="persona-device-screen" style={{ backgroundColor: pageBackground }}>
          <div className="persona-device-header">
            <div className="persona-device-brand" style={{ color: personaPreviewColor(config.header_brand_color, "#000000"), fontSize: config.header_brand_size }}>
              {headerLogo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={headerLogo} alt="" />
                : <span className="persona-device-brand-mark" aria-hidden="true">◇</span>}
              <strong>{config.header_brand_text}</strong>
            </div>
            {config.progress_active && (
              <div className="persona-device-progress" style={{ backgroundColor: personaPreviewColor(config.progress_track_color, "#E6E7F3") }}>
                <span style={{
                  backgroundColor: personaPreviewColor(config.progress_filled_color, "#7A7FFD"),
                  width: `${config.progress_value * 100}%`,
                }} />
              </div>
            )}
          </div>

          <h2 style={{ color: titleColor, fontSize: config.title_size }}>
            <HighlightedCopy template={config.title_main} highlight={config.title_highlight} highlightColor={titleHighlight} />
          </h2>
          <p className="persona-device-subtitle" style={{ color: subtitleColor, fontSize: config.subtitle_size }}>
            <HighlightedCopy template={config.subtitle_text} highlight={config.subtitle_highlight} highlightColor={subtitleHighlight} />
          </p>

          <div className="persona-device-benefits">
            {([1, 2, 3] as const).map((index) => {
              const prefix = `benefit${index}` as const;
              return (
                <article key={prefix}>
                  <PreviewIcon
                    imageUrl={config[`${prefix}_icon_url`]}
                    color={config[`${prefix}_icon_color`]}
                    background={config[`${prefix}_icon_bg_color`]}
                  />
                  <strong style={{ fontSize: config.benefit_title_size }}>{config[`${prefix}_title`]}</strong>
                  <p style={{ fontSize: config.benefit_body_size }}>{config[`${prefix}_body`]}</p>
                </article>
              );
            })}
          </div>

          {config.trust_active && (
            <div className="persona-device-trust" style={{ backgroundColor: personaPreviewColor(config.trust_card_bg_color, "#F4F4FA"), color: personaPreviewColor(config.trust_text_color, "#0A0A19") }}>
              <PreviewIcon imageUrl={config.trust_icon_url} color={config.trust_icon_color} background={config.trust_icon_bg_color} />
              <span>
                <strong style={{ fontSize: config.trust_title_size }}>{config.trust_title}</strong>
                <small style={{ fontSize: config.trust_body_size }}>{config.trust_body_prefix}<b style={{ color: personaPreviewColor(config.trust_link_color, "#7A7FFD") }}>{config.trust_body_link_text}</b></small>
              </span>
            </div>
          )}

          <button
            className="persona-device-cta"
            type="button"
            disabled
            style={{
              color: personaPreviewColor(config.cta_text_color, "#FFFFFF"),
              backgroundColor: personaPreviewColor(config.cta_bg_color, "#7A7FFD"),
              fontSize: config.cta_title_size,
            }}
          >
            <span aria-hidden="true">◇</span>{config.cta_title}
          </button>
          <p className="persona-device-secured" style={{ color: personaPreviewColor(config.secured_text_color, "#8B8BA0"), fontSize: config.secured_text_size }}>
            <span aria-hidden="true">◇</span>{config.secured_text}
          </p>
          <div
            className="persona-device-about"
            style={{
              color: personaPreviewColor(config.about_text_color, "#7A7FFD"),
              backgroundColor: personaPreviewColor(config.about_pill_bg_color, "#FFFFFF"),
              borderColor: personaPreviewColor(config.about_pill_border_color, "#E6E7F3"),
              fontSize: config.about_title_size,
            }}
          >
            <span aria-hidden="true" style={{ color: personaPreviewColor(config.about_icon_color, "#7A7FFD") }}>◇</span>{config.about_title}
          </div>

          {config.safety_active && (
            <div className="persona-device-safety" style={{ backgroundColor: personaPreviewColor(config.safety_card_bg_color, "#F4F4FA") }}>
              <PreviewIcon imageUrl={config.safety_icon_url} color={config.safety_icon_color} background={config.safety_icon_bg_color} />
              <span>
                <strong style={{ color: personaPreviewColor(config.safety_title_color, "#0A0A19"), fontSize: config.safety_title_size }}>{config.safety_title}</strong>
                <small style={{ color: personaPreviewColor(config.safety_body_color, "#5C5C72"), fontSize: config.safety_body_size }}>{config.safety_body}</small>
              </span>
            </div>
          )}

          {config.skip_active && (
            <button type="button" className="persona-device-skip" disabled style={{ color: personaPreviewColor(config.skip_text_color, "#8B8BA0"), fontSize: config.skip_title_size }}>
              {config.skip_title}
            </button>
          )}
        </div>
      </div>
      <p className="field-hint">{t("imageBoundary")}</p>
    </aside>
  );
}

export default function PersonaAdminConsole() {
  const t = useTranslations("personaAdmin");
  const common = useTranslations("common");
  const [state, setState] = useState<LoadState>("loading");
  const [capabilities, setCapabilities] = useState<PersonaAdminCapabilities | null>(null);
  const [stored, setStored] = useState<PersonaStartConfig | null>(null);
  const [draft, setDraft] = useState<PersonaStartConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [configRecoveryRequired, setConfigRecoveryRequired] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<Feedback | null>(null);
  const [uidInput, setUidInput] = useState("");
  const [target, setTarget] = useState<PersonaTarget | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberRecoveryRequired, setMemberRecoveryRequired] = useState(false);
  const [memberFeedback, setMemberFeedback] = useState<Feedback | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setConfigFeedback(null);
    setMemberFeedback(null);
    setConfigRecoveryRequired(false);
    setMemberRecoveryRequired(false);
    setConfirmation(null);
    const membership = await adminCall("admin_me");
    const parsedCapabilities = personaAdminCapabilitiesFrom(membership);
    if (!parsedCapabilities) {
      setState("error");
      return;
    }
    setCapabilities(parsedCapabilities);
    if (!parsedCapabilities.contract_ready) {
      setStored(null);
      setDraft(null);
      setState("dormant");
      return;
    }
    if (!personaCapabilityAllows(parsedCapabilities, "read_start_config")) {
      setState("error");
      return;
    }
    const response = await adminCall("persona_start_get_config_admin");
    const parsedConfig = personaStartConfigResponse(response);
    if (!parsedConfig) {
      setState("error");
      return;
    }
    setStored(parsedConfig);
    setDraft(clonePersonaStartConfig(parsedConfig));
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = useMemo(() => (
    stored && draft ? personaStartConfigPatch(stored, draft) : null
  ), [draft, stored]);
  const preview = review?.normalized ?? null;
  const dirty = Boolean(review && review.fields.length > 0);
  const normalized = Boolean(preview && draft
    && JSON.stringify(preview) !== JSON.stringify(draft));
  const canWriteConfig = personaCapabilityAllows(capabilities, "write_start_config");
  const controlsLocked = busy || configRecoveryRequired || !canWriteConfig;

  function updateField(key: PersonaStartFieldKey, value: string | number | boolean) {
    setDraft((current) => current ? personaStartDraftWithValue(current, key, value) : current);
    setConfigFeedback(null);
    setConfirmation(null);
  }

  function renderConfigField(key: PersonaStartFieldKey) {
    if (!draft) return null;
    const kind = personaStartFieldKind(key);
    const value = draft[key];
    if (kind === "boolean") {
      return (
        <label className="switch-row persona-config-switch" key={key}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={controlsLocked}
            onChange={(event) => updateField(key, event.target.checked)}
          />
          <span><strong>{t(`fields.${key}`)}</strong><small><code>{key}</code></small></span>
        </label>
      );
    }
    if (kind === "progress" || kind === "size") {
      return (
        <label className="field persona-config-field" key={key}>
          <span>{t(`fields.${key}`)}</span>
          <input
            type="number"
            inputMode={kind === "size" ? "numeric" : "decimal"}
            min={kind === "size" ? 8 : 0}
            max={kind === "size" ? 80 : 1}
            step={kind === "size" ? 1 : 0.01}
            value={Number(value)}
            disabled={controlsLocked}
            onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber)) {
                updateField(key, event.target.valueAsNumber);
              }
            }}
          />
          <small>{kind === "size" ? t("limits.size") : t("limits.progress")}</small>
        </label>
      );
    }

    const stringKey = key as PersonaStartStringKey;
    const stringValue = String(value);
    const maximum = personaStartStringCap(stringKey);
    const input = kind === "multiline" ? (
      <textarea
        rows={3}
        value={stringValue}
        maxLength={personaStartHtmlMaxLength(stringKey)}
        disabled={controlsLocked}
        onChange={(event) => updateField(key, event.target.value)}
      />
    ) : (
      <input
        type={kind === "url" ? "url" : "text"}
        value={stringValue}
        maxLength={personaStartHtmlMaxLength(stringKey)}
        spellCheck={kind !== "url" && kind !== "color" && kind !== "icon"}
        disabled={controlsLocked}
        onChange={(event) => updateField(key, event.target.value)}
      />
    );
    return (
      <label className="field persona-config-field" key={key}>
        <span>{t(`fields.${key}`)}</span>
        {kind === "color" ? (
          <span className="persona-color-field">
            <i style={{ backgroundColor: personaPreviewColor(stringValue, "transparent") }} aria-hidden="true" />
            {input}
          </span>
        ) : input}
        <small>{t(`limits.${kind}`, { maximum })} · <code>{key}</code></small>
      </label>
    );
  }

  async function saveConfig() {
    if (!review || review.fields.length === 0 || !capabilities || busy) return;
    if (!personaCapabilityAllows(capabilities, "write_start_config")) {
      setConfigFeedback({ tone: "error", text: t("config.writeRequired") });
      setConfirmation(null);
      return;
    }
    setBusy(true);
    setConfigFeedback(null);
    const response = await adminCall("persona_start_update_config", review.payload);
    setBusy(false);
    setConfirmation(null);
    const canonical = personaStartUpdateResponse(response);
    if (canonical) {
      setStored(canonical);
      setDraft(clonePersonaStartConfig(canonical));
      setConfigFeedback({ tone: "success", text: t("config.saved") });
      return;
    }
    const failure = personaAdminFailureResponse(response);
    setConfigRecoveryRequired(true);
    if (failure) {
      setConfigFeedback({ tone: "error", text: t(`errors.${personaAdminErrorKey(failure.error)}`) });
    } else {
      setConfigFeedback({ tone: "error", text: t("config.uncertain") });
    }
  }

  async function lookupTarget() {
    const uid = canonicalPersonaUid(uidInput);
    if (uid === null || targetBusy || memberBusy) return;
    setTargetBusy(true);
    setTarget(null);
    setMemberFeedback(null);
    setMemberRecoveryRequired(false);
    setConfirmation(null);
    const response = await adminCall("user_detail", { uid });
    setTargetBusy(false);
    const parsedTarget = personaTargetFromUserDetail(response);
    if (!parsedTarget) {
      setMemberFeedback({
        tone: "error",
        text: response?.error === "user-not-found"
          ? t("member.notFound")
          : t("member.lookupError"),
      });
      return;
    }
    setTarget(parsedTarget);
    setMemberFeedback({ tone: "info", text: t("member.targetReady") });
  }

  async function runMemberMutation(action: MemberAction) {
    if (!target || !capabilities || memberBusy) return;
    if (!personaCapabilityAllows(capabilities, action)) {
      setMemberFeedback({ tone: "error", text: t("member.writeRequired") });
      setConfirmation(null);
      return;
    }
    const payload = personaUidPayload(target.uid);
    if (!payload) return;
    setMemberBusy(true);
    setMemberFeedback(null);
    const response = await adminCall(MEMBER_ENDPOINTS[action], payload);
    setMemberBusy(false);
    setConfirmation(null);
    const success = action === "force_verify"
      ? personaForceMutationResponse(response) !== null
      : personaEmptyMutationResponse(response) !== null;
    setMemberRecoveryRequired(true);
    if (success) {
      setMemberFeedback({ tone: "success", text: t(`member.success.${action}`) });
      return;
    }
    const failure = personaAdminFailureResponse(response);
    setMemberFeedback({
      tone: "error",
      text: failure
        ? t(`errors.${personaAdminErrorKey(failure.error)}`)
        : t("member.uncertain"),
    });
  }

  function confirmationCopy(): string {
    if (!confirmation) return "";
    if (confirmation.kind === "config") {
      return t("config.confirmCopy", { count: review?.fields.length ?? 0 });
    }
    if (!target) return "";
    return t(`member.confirm.${confirmation.kind}`, {
      name: target.displayName || t("member.uidFallback", { uid: String(target.uid) }),
      uid: String(target.uid),
    });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error") return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  if (state === "dormant") {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
        <section className="panel persona-readiness-panel">
          <div className="panel-header"><div><h2>{t("readiness.title")}</h2><p>{t("readiness.copy")}</p></div><span className="badge badge-warning">{t("readiness.dormant")}</span></div>
          <div className="panel-body"><div className="alert alert-info">{t("readiness.contractLocked")}</div></div>
        </section>
      </>
    );
  }

  if (!stored || !draft || !preview || !capabilities) {
    return <ErrorPanel message={t("loadError")} retry={() => void load()} />;
  }

  const memberActions: MemberAction[] = ["apply_fake", "revoke_fake", "force_verify"];
  const uid = canonicalPersonaUid(uidInput);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-secondary" type="button" onClick={() => void load()} disabled={busy || memberBusy}>{common("refresh")}</button>}
      />

      <section className="panel persona-readiness-panel">
        <div className="panel-header">
          <div><h2>{t("readiness.title")}</h2><p>{t("readiness.readyCopy")}</p></div>
          <div className="row-actions">
            <span className="badge badge-active">{t("readiness.version", { version: capabilities.contract_version })}</span>
            <span className={`badge ${capabilities.can_write ? "badge-active" : "badge-inactive"}`}>{capabilities.can_write ? t("readiness.writer") : t("readiness.viewer")}</span>
          </div>
        </div>
      </section>

      <section className="panel persona-member-panel">
        <div className="panel-header"><div><h2>{t("member.title")}</h2><p>{t("member.copy")}</p></div></div>
        <div className="panel-body">
          {memberFeedback && <div className={`alert ${memberFeedback.tone === "success" ? "alert-success" : memberFeedback.tone === "info" ? "alert-info" : "alert-error"}`} role="status">{memberFeedback.text}</div>}
          <div className="persona-target-lookup">
            <label className="field">
              <span>{t("member.uidLabel")}</span>
              <input
                inputMode="numeric"
                value={uidInput}
                disabled={targetBusy || memberBusy}
                aria-invalid={uidInput !== "" && uid === null}
                onChange={(event) => {
                  setUidInput(event.target.value);
                  setTarget(null);
                  setMemberFeedback(null);
                  setMemberRecoveryRequired(false);
                  setConfirmation(null);
                }}
              />
              <small>{t("member.uidHint")}</small>
            </label>
            <button className="button button-secondary" type="button" disabled={uid === null || targetBusy || memberBusy} onClick={() => void lookupTarget()}>
              {targetBusy ? common("loading") : t("member.lookup")}
            </button>
          </div>
          {target && (
            <div className="persona-target-card">
              <span className="persona-target-avatar" aria-hidden="true">{(target.displayName || String(target.uid)).slice(0, 1).toUpperCase()}</span>
              <span><strong>{target.displayName || t("member.uidFallback", { uid: String(target.uid) })}</strong><small>{t("member.uidValue", { uid: String(target.uid) })}</small></span>
            </div>
          )}
          {memberRecoveryRequired && (
            <div className="persona-recovery-callout">
              <p>{t("member.reloadRequired")}</p>
              <button className="button button-secondary button-small" type="button" disabled={targetBusy || memberBusy || uid === null} onClick={() => void lookupTarget()}>{t("member.reloadTarget")}</button>
            </div>
          )}
          <div className="persona-operation-grid">
            {memberActions.map((action) => {
              const allowed = personaCapabilityAllows(capabilities, action as PersonaAdminCapabilityAction);
              return (
                <article key={action}>
                  <div><h3>{t(`member.actions.${action}.title`)}</h3><p>{t(`member.actions.${action}.copy`)}</p></div>
                  <button
                    className={`button ${action === "force_verify" || action === "revoke_fake" ? "button-danger" : "button-secondary"}`}
                    type="button"
                    disabled={!target || memberBusy || memberRecoveryRequired || !allowed}
                    onClick={() => setConfirmation({ kind: action })}
                  >
                    {t(`member.actions.${action}.button`)}
                  </button>
                  {!allowed && <small className="field-hint">{t("member.capabilityUnavailable")}</small>}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel persona-config-panel">
        <div className="panel-header persona-config-header">
          <div><h2>{t("config.title")}</h2><p>{t("config.copy")}</p></div>
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={controlsLocked || !dirty} onClick={() => { setDraft(clonePersonaStartConfig(stored)); setConfigFeedback(null); setConfirmation(null); }}>{t("config.reset")}</button>
            <button className="button button-primary" type="button" disabled={controlsLocked || !dirty || !review} onClick={() => setConfirmation({ kind: "config" })}>{t("config.review")}</button>
          </div>
        </div>
        <div className="panel-body">
          {configFeedback && <div className={`alert ${configFeedback.tone === "success" ? "alert-success" : configFeedback.tone === "info" ? "alert-info" : "alert-error"}`} role="status">{configFeedback.text}</div>}
          {!canWriteConfig && <div className="alert alert-info">{t("config.readOnly")}</div>}
          {dirty && !configFeedback && <div className="alert alert-info">{t("config.unsaved", { count: review?.fields.length ?? 0 })}</div>}
          {normalized && <div className="alert alert-info">{t("config.normalized")}</div>}
          {!review && <div className="alert alert-error">{t("config.invalid")}</div>}
          {configRecoveryRequired && (
            <div className="persona-recovery-callout">
              <p>{t("config.reloadRequired")}</p>
              <button className="button button-secondary button-small" type="button" disabled={busy || memberBusy} onClick={() => void load()}>{t("config.reload")}</button>
            </div>
          )}
          <div className="persona-config-layout">
            <div className="persona-editor-sections">
              {PERSONA_START_SECTIONS.map((section) => (
                <details className="persona-editor-section" key={section.key} open={section.key === "general" || section.key === "header" || section.key === "title"}>
                  <summary><span><strong>{t(`sections.${section.key}.title`)}</strong><small>{t(`sections.${section.key}.copy`)}</small></span><span className="badge">{section.fields.length}</span></summary>
                  <div className="persona-field-grid">{section.fields.map(renderConfigField)}</div>
                </details>
              ))}
            </div>
            <PersonaStartPreview config={preview} />
          </div>
        </div>
      </section>

      {confirmation && (
        <ConfirmDialog
          title={confirmation.kind === "config" ? t("config.confirmTitle") : t(`member.confirmTitles.${confirmation.kind}`)}
          copy={confirmationCopy()}
          confirmLabel={confirmation.kind === "config" ? t("config.confirmButton") : t(`member.actions.${confirmation.kind}.button`)}
          busy={busy || memberBusy}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (confirmation.kind === "config") void saveConfig();
            else void runMemberMutation(confirmation.kind);
          }}
        />
      )}
    </>
  );
}

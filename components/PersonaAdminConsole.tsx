"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import PersonaScreensCard from "@/components/PersonaScreensCard";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  PERSONA_START_EDITOR_VISIBLE,
} from "@/lib/contractReadiness";
import {
  personaScreensProjectionFrom,
  type PersonaScreensProjection,
} from "@/lib/personaScreens";
import {
  PERSONA_ADMIN_CONTRACT_VERSION,
  PERSONA_PENDING_STORAGE_KEY,
  PERSONA_START_SECTIONS,
  canonicalPersonaUid,
  clonePersonaStartConfig,
  personaAdminCapabilitiesFrom,
  personaAdminErrorKey,
  personaAdminFailureResponse,
  personaCapabilityAllows,
  personaConflictResponse,
  personaForceMutationResponse,
  personaHighlightParts,
  personaMemberMutationConverged,
  personaMemberMutationResponse,
  personaPendingFrom,
  personaPendingMutation,
  personaPersistBeforeMutation,
  personaPreviewColor,
  personaPreviewImageUrl,
  personaShouldRetainMutation,
  personaStartConfigPatch,
  personaStartConfigResponse,
  personaStartDraftWithValue,
  personaStartFieldKind,
  personaStartHtmlMaxLength,
  personaStartResourceConverged,
  personaStartStringCap,
  personaStartUpdateResponse,
  personaTargetLookupResponse,
  normalizePersonaReason,
  type PersonaAdminCapabilities,
  type PersonaAdminCapabilityAction,
  type PersonaAdminMutationAction,
  type PersonaPendingMutation,
  type PersonaStartConfig,
  type PersonaStartConfigResource,
  type PersonaStartFieldKey,
  type PersonaStartStringKey,
  type PersonaTarget,
} from "@/lib/personaAdmin";

type LoadState = "loading" | "ready" | "dormant" | "error";
type Feedback = { tone: "success" | "error" | "info"; text: string };
type MemberAction = "apply_fake" | "revoke_fake" | "force_verify";
type Confirmation = { kind: "config" } | { kind: MemberAction };

const MEMBER_ENDPOINTS = {
  apply_fake: "admin_apply_fake_persona",
  revoke_fake: "admin_revoke_fake_persona",
  force_verify: "admin_force_persona_verify",
} as const satisfies Record<MemberAction, PersonaAdminMutationAction>;

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
                  width: `${Math.max(0, Math.min(1, config.progress_value)) * 100}%`,
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
  /** Core's separate Persona-screens projection, read from the same membership answer. */
  const [screensProjection, setScreensProjection] = useState<PersonaScreensProjection>({ kind: "unreadable" });
  const [stored, setStored] = useState<PersonaStartConfigResource | null>(null);
  const [draft, setDraft] = useState<PersonaStartConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [configRecoveryRequired, setConfigRecoveryRequired] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<Feedback | null>(null);
  const [configReason, setConfigReason] = useState("");
  const [uidInput, setUidInput] = useState("");
  const [target, setTarget] = useState<PersonaTarget | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberRecoveryRequired, setMemberRecoveryRequired] = useState(false);
  const [memberFeedback, setMemberFeedback] = useState<Feedback | null>(null);
  const [memberReason, setMemberReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState<PersonaPendingMutation | null>(null);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);
  const pendingRef = useRef<PersonaPendingMutation | null>(null);

  const clearPending = useCallback((): boolean => {
    try {
      window.sessionStorage.removeItem(PERSONA_PENDING_STORAGE_KEY);
    } catch {
      setPersistenceAvailable(false);
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }, []);

  const load = useCallback(async (
    pendingCandidate: PersonaPendingMutation | null = pendingRef.current,
  ) => {
    setState("loading");
    setConfigFeedback(null);
    setMemberFeedback(null);
    setConfigRecoveryRequired(false);
    setMemberRecoveryRequired(false);
    setConfirmation(null);
    const membership = await adminCall("admin_me");
    setScreensProjection(personaScreensProjectionFrom(membership));
    const parsedCapabilities = personaAdminCapabilitiesFrom(
      membership,
      ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
    );
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
    if (!PERSONA_START_EDITOR_VISIBLE
      && pendingCandidate?.action !== "persona_start_update_config") {
      setStored(null);
      setDraft(null);
      setState("ready");
      return;
    }
    if (!personaCapabilityAllows(parsedCapabilities, "read_start_config")) {
      setState("error");
      return;
    }
    const response = await adminCall("persona_start_get_config_admin", {
      contract_version: PERSONA_ADMIN_CONTRACT_VERSION,
    });
    const resource = personaStartConfigResponse(response);
    if (!resource) {
      setState("error");
      return;
    }
    setStored(resource);
    setDraft(clonePersonaStartConfig(resource.config));
    if (pendingCandidate?.action === "persona_start_update_config"
      && personaStartResourceConverged(resource, pendingCandidate)) {
      const cleared = clearPending();
      setConfigFeedback({
        tone: cleared ? "success" : "error",
        text: cleared ? t("receipts.converged") : t("receipts.persistenceCleanupFailed"),
      });
    }
    setState("ready");
  }, [clearPending, t]);

  useEffect(() => {
    let restored: PersonaPendingMutation | null = null;
    try {
      const serialized = window.sessionStorage.getItem(PERSONA_PENDING_STORAGE_KEY);
      if (serialized !== null) {
        try {
          restored = personaPendingFrom(JSON.parse(serialized));
        } catch {
          restored = null;
        }
        if (!restored) setPersistenceAvailable(false);
      }
    } catch {
      setPersistenceAvailable(false);
    }
    pendingRef.current = restored;
    setPending(restored);
    if (restored && restored.action !== "persona_start_update_config") {
      setUidInput(String(restored.payload.uid));
    }
    void load(restored);
  }, [load]);

  const review = useMemo(() => (
    stored && draft ? personaStartConfigPatch(stored.config, draft) : null
  ), [draft, stored]);
  const preview = review?.normalized ?? null;
  const dirty = Boolean(review && review.fields.length > 0);
  const normalized = Boolean(preview && draft
    && JSON.stringify(preview) !== JSON.stringify(draft));
  const canWriteConfig = personaCapabilityAllows(capabilities, "write_start_config");
  const controlsLocked = busy
    || memberBusy
    || pending !== null
    || configRecoveryRequired
    || !persistenceAvailable
    || !canWriteConfig;

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
            min={kind === "size" ? 8 : undefined}
            max={kind === "size" ? 80 : undefined}
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

  async function lookupTarget() {
    const uid = canonicalPersonaUid(uidInput);
    if (uid === null
      || targetBusy
      || memberBusy
      || busy
      || pendingRef.current?.action === "persona_start_update_config") return;
    setTargetBusy(true);
    setTarget(null);
    setMemberFeedback(null);
    setMemberRecoveryRequired(false);
    setConfirmation(null);
    const response = await adminCall("persona-member", { uid: String(uid) });
    setTargetBusy(false);
    const parsedTarget = personaTargetLookupResponse(response);
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

  function finishMutationBusy(action: PersonaAdminMutationAction) {
    if (action === "persona_start_update_config") setBusy(false);
    else setMemberBusy(false);
  }

  function mutationFeedback(
    action: PersonaAdminMutationAction,
    feedback: Feedback,
  ) {
    if (action === "persona_start_update_config") setConfigFeedback(feedback);
    else setMemberFeedback(feedback);
  }

  async function executeMutation(next: PersonaPendingMutation) {
    if (busy || memberBusy) return;
    const existing = pendingRef.current;
    const durable = existing ?? next;
    if (durable.action === "persona_start_update_config") setBusy(true);
    else setMemberBusy(true);
    setConfirmation(null);
    mutationFeedback(durable.action, { tone: "info", text: t("receipts.sending") });

    let response;
    if (existing) {
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await personaPersistBeforeMutation(
        window.sessionStorage,
        next,
        () => {
          pendingRef.current = next;
          setPending(next);
          return adminCall(next.action, next.payload);
        },
      );
      if (!persisted.ok) {
        setPersistenceAvailable(false);
        mutationFeedback(durable.action, {
          tone: "error",
          text: t("receipts.persistenceUnavailable"),
        });
        finishMutationBusy(durable.action);
        return;
      }
      response = persisted.response;
    }

    const active = pendingRef.current ?? durable;
    if (active.action === "persona_start_update_config") {
      const result = personaStartUpdateResponse(response);
      if (result && personaStartResourceConverged(result, active)) {
        const cleared = clearPending();
        setStored({
          contract_version: 1,
          resource_revision: result.resource_revision,
          config: result.config,
        });
        setDraft(clonePersonaStartConfig(result.config));
        setConfigReason("");
        setConfigRecoveryRequired(false);
        setConfigFeedback({
          tone: cleared ? "success" : "error",
          text: cleared
            ? t(result.replayed ? "receipts.replayed" : "config.saved")
            : t("receipts.persistenceCleanupFailed"),
        });
        finishMutationBusy(active.action);
        return;
      }
    } else {
      const result = active.action === "admin_force_persona_verify"
        ? personaForceMutationResponse(response)
        : personaMemberMutationResponse(response);
      if (result && personaMemberMutationConverged(result, active)) {
        const cleared = clearPending();
        setTarget((current) => current && current.uid === result.uid
          ? { ...current, revision: result.revision }
          : current);
        setMemberReason("");
        setMemberRecoveryRequired(false);
        const action = Object.entries(MEMBER_ENDPOINTS).find(([, endpoint]) => (
          endpoint === active.action
        ))?.[0] as MemberAction | undefined;
        setMemberFeedback({
          tone: cleared ? "success" : "error",
          text: cleared
            ? t(result.replayed
              ? "receipts.replayed"
              : `member.success.${action ?? "apply_fake"}`)
            : t("receipts.persistenceCleanupFailed"),
        });
        finishMutationBusy(active.action);
        return;
      }
    }

    const conflict = personaConflictResponse(response);
    const failure = personaAdminFailureResponse(response);
    const conflictWithoutData = failure?.error === "persona-conflict";
    const conflictMatches = active.action === "persona_start_update_config"
      ? conflict?.kind === "config"
      : conflict?.kind === "member" && conflict.uid === active.payload.uid;
    if (conflictWithoutData || conflictMatches) {
      const cleared = clearPending();
      if (active.action === "persona_start_update_config") {
        setConfigRecoveryRequired(true);
      } else {
        setTarget(null);
        setMemberRecoveryRequired(true);
      }
      mutationFeedback(active.action, {
        tone: "error",
        text: cleared ? t("receipts.conflict") : t("receipts.persistenceCleanupFailed"),
      });
      finishMutationBusy(active.action);
      return;
    }

    const retain = personaShouldRetainMutation(failure?.error);
    if (!retain) clearPending();
    mutationFeedback(active.action, {
      tone: "error",
      text: failure
        ? t(`errors.${personaAdminErrorKey(failure.error)}`)
        : t("receipts.uncertain"),
    });
    finishMutationBusy(active.action);
  }

  function saveConfig() {
    const reason = normalizePersonaReason(configReason);
    if (!review
      || review.fields.length === 0
      || !stored
      || !capabilities
      || !reason
      || pendingRef.current
      || busy
      || memberBusy) return;
    if (!personaCapabilityAllows(capabilities, "write_start_config")) {
      setConfigFeedback({ tone: "error", text: t("config.writeRequired") });
      setConfirmation(null);
      return;
    }
    const mutation = personaPendingMutation("persona_start_update_config", {
      contract_version: PERSONA_ADMIN_CONTRACT_VERSION,
      request_id: crypto.randomUUID(),
      expected_revision: stored.resource_revision,
      reason,
      ...review.payload,
    });
    if (!mutation) {
      setConfigFeedback({ tone: "error", text: t("config.invalid") });
      setConfirmation(null);
      return;
    }
    void executeMutation(mutation);
  }

  function runMemberMutation(action: MemberAction) {
    const reason = normalizePersonaReason(memberReason);
    if (!target
      || !capabilities
      || !reason
      || pendingRef.current
      || memberBusy
      || busy) return;
    if (!personaCapabilityAllows(capabilities, action)) {
      setMemberFeedback({ tone: "error", text: t("member.writeRequired") });
      setConfirmation(null);
      return;
    }
    const mutation = personaPendingMutation(MEMBER_ENDPOINTS[action], {
      contract_version: PERSONA_ADMIN_CONTRACT_VERSION,
      uid: target.uid,
      request_id: crypto.randomUUID(),
      expected_revision: target.revision,
      reason,
    });
    if (!mutation) {
      setMemberFeedback({ tone: "error", text: t("member.invalidReason") });
      setConfirmation(null);
      return;
    }
    void executeMutation(mutation);
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

  if (!capabilities
    || (PERSONA_START_EDITOR_VISIBLE && (!stored || !draft || !preview))) {
    return <ErrorPanel message={t("loadError")} retry={() => void load()} />;
  }

  const allMemberActions: MemberAction[] = ["apply_fake", "revoke_fake", "force_verify"];
  const memberActions = allMemberActions
    .filter((action) => !ADMIN_GRANTED_VERIFICATION_CONTRACT_READY || action === "force_verify");
  const uid = canonicalPersonaUid(uidInput);
  const memberReasonNormalized = normalizePersonaReason(memberReason);
  const configReasonNormalized = normalizePersonaReason(configReason);

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

      {!persistenceAvailable && (
        <div className="alert alert-error" role="alert">{t("receipts.persistenceUnavailable")}</div>
      )}

      {pending && (
        <section className="panel persona-readiness-panel">
          <div className="panel-header">
            <div>
              <h2>{t("receipts.pendingTitle")}</h2>
              <p>{t("receipts.pendingCopy", {
                action: t(`receipts.actions.${pending.action}`),
                target: pending.target,
              })}</p>
            </div>
            <span className="badge badge-warning">{t("receipts.retained")}</span>
          </div>
          <div className="panel-body">
            <p className="field-hint">{t("receipts.requestId", {
              requestId: String(pending.payload.request_id),
            })}</p>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy || memberBusy || !persistenceAvailable}
              onClick={() => void executeMutation(pending)}
            >
              {t("receipts.retryExact")}
            </button>
          </div>
        </section>
      )}

      <section className="panel persona-member-panel">
        <div className="panel-header"><div><h2>{t("member.title")}</h2><p>{t("member.copy")}</p></div></div>
        <div className="panel-body">
          {ADMIN_GRANTED_VERIFICATION_CONTRACT_READY ? <div className="alert alert-info">{t("member.adminGrantTransition")}</div> : null}
          {memberFeedback && <div className={`alert ${memberFeedback.tone === "success" ? "alert-success" : memberFeedback.tone === "info" ? "alert-info" : "alert-error"}`} role="status">{memberFeedback.text}</div>}
          <div className="persona-target-lookup">
            <label className="field">
              <span>{t("member.uidLabel")}</span>
              <input
                inputMode="numeric"
                value={uidInput}
                disabled={targetBusy || memberBusy || busy || pending !== null}
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
            <button className="button button-secondary" type="button" disabled={uid === null || targetBusy || memberBusy || busy || pending?.action === "persona_start_update_config"} onClick={() => void lookupTarget()}>
              {targetBusy ? common("loading") : t("member.lookup")}
            </button>
          </div>
          {target && (
            <div className="persona-target-card">
              <span className="persona-target-avatar" aria-hidden="true">{(target.displayName || String(target.uid)).slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{target.displayName || t("member.uidFallback", { uid: String(target.uid) })}</strong>
                <small>{t("member.uidValue", { uid: String(target.uid) })} · {t("member.revision", { revision: target.revision })}</small>
              </span>
            </div>
          )}
          {memberRecoveryRequired && (
            <div className="persona-recovery-callout">
              <p>{t("member.reloadRequired")}</p>
              <button className="button button-secondary button-small" type="button" disabled={targetBusy || memberBusy || uid === null} onClick={() => void lookupTarget()}>{t("member.reloadTarget")}</button>
            </div>
          )}
          {capabilities.can_write && (
            <label className="field persona-config-field">
              <span>{t("member.reasonLabel")}</span>
              <input
                type="text"
                value={memberReason}
                maxLength={600}
                disabled={memberBusy || busy || pending !== null || !persistenceAvailable}
                aria-invalid={memberReason !== "" && memberReasonNormalized === null}
                onChange={(event) => {
                  setMemberReason(event.target.value);
                  setMemberFeedback(null);
                  setConfirmation(null);
                }}
              />
              <small>{t("limits.reason", { count: Array.from(memberReason).length, maximum: 300 })}</small>
            </label>
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
                    disabled={!target || memberBusy || busy || pending !== null || memberRecoveryRequired || !persistenceAvailable || !memberReasonNormalized || !allowed}
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

      {PERSONA_START_EDITOR_VISIBLE && stored && draft && preview ? (
        <section className="panel persona-config-panel">
          <div className="panel-header persona-config-header">
            <div><h2>{t("config.title")}</h2><p>{t("config.copy")}</p><small>{t("config.revision", { revision: stored.resource_revision })}</small></div>
            <div className="row-actions">
              <button className="button button-secondary" type="button" disabled={controlsLocked || !dirty} onClick={() => { setDraft(clonePersonaStartConfig(stored.config)); setConfigFeedback(null); setConfirmation(null); }}>{t("config.reset")}</button>
              <button className="button button-primary" type="button" disabled={controlsLocked || !dirty || !review || !configReasonNormalized} onClick={() => setConfirmation({ kind: "config" })}>{t("config.review")}</button>
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
            {canWriteConfig && (
              <label className="field persona-config-field">
                <span>{t("config.reasonLabel")}</span>
                <input
                  type="text"
                  value={configReason}
                  maxLength={600}
                  disabled={controlsLocked}
                  aria-invalid={configReason !== "" && configReasonNormalized === null}
                  onChange={(event) => {
                    setConfigReason(event.target.value);
                    setConfigFeedback(null);
                    setConfirmation(null);
                  }}
                />
                <small>{t("limits.reason", { count: Array.from(configReason).length, maximum: 300 })}</small>
              </label>
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
      ) : null}

      {/*
        T-551. The replacement T-581 promised, in the place T-581 emptied. This
        card edits the copy of the three screens the app shows TODAY, through
        Core's own `persona_screens` contract; the legacy start-screen editor
        above stays hidden behind `PERSONA_START_EDITOR_VISIBLE` because nothing
        on the client reads what it edits.
      */}
      <PersonaScreensCard
        projection={screensProjection}
        locked={busy || memberBusy || pending !== null}
      />

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

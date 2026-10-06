"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import LocalizedFields, { plainText, type Language } from "@/components/LocalizedFields";
import PhotoGestureCatalogue, { PhotoFlowWording, type PhotoCoverage } from "@/components/PhotoVerificationEditor";
import { adminCall } from "@/lib/adminClient";
import { isAdminWriteRole } from "@/lib/authPolicy";
import { formatDate } from "@/lib/format";
import { forcedStorefrontName } from "@/lib/forcedVerification";
import {
  documentUsesMethod,
  liveNonVideoStorefronts,
  liveVideoStorefronts,
  photoStorefronts,
  verificationMethodConsoleResponse,
  type VerificationMethodConsoleData,
} from "@/lib/verificationMethod";
import {
  PROFILE_VERIFICATION_BADGE_STATUSES,
  PROFILE_VERIFICATION_DETAIL_STATUSES,
  cloneProfileVerificationConfig,
  isProfileVerificationColor,
  normalizeProfileVerificationConfig,
  profileVerificationConfigIssues,
  profileVerificationResponseData,
  profileVerificationSavePayload,
  trimProfileVerificationDraft,
  type ProfileVerificationConfig,
  type ProfileVerificationFieldProblem,
  type ProfileVerificationIconColor,
  type ProfileVerificationLocalizedText,
} from "@/lib/profileVerification";

type Feedback = { tone: "success" | "error"; text: string };

function ColorFields({
  value,
  onChange,
  lightLabel,
  darkLabel,
  disabled,
  errors,
}: {
  value: ProfileVerificationIconColor;
  onChange: (mode: "light" | "dark", value: string) => void;
  lightLabel: string;
  darkLabel: string;
  disabled: boolean;
  errors?: Partial<Record<"light" | "dark", string>>;
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
            {errors?.[mode] ? <small className="field-error" role="alert">{errors[mode]}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

export default function ProfileVerificationConfiguration() {
  const t = useTranslations("profileVerification.configuration");
  const methodReason = useTranslations("verificationAdmin.live.methodReasons");
  const common = useTranslations("common");
  const locale = useLocale();
  const previewLanguage: Language = locale === "hu" ? "hu" : "en";
  const [stored, setStored] = useState<ProfileVerificationConfig | null>(null);
  const [draft, setDraft] = useState<ProfileVerificationConfig | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /**
   * Viewers read, editors and owners write. The role comes from `admin_me`;
   * an unreadable role fails closed to read-only (Core refuses the save anyway
   * with `admin-write-required`).
   */
  const [canWrite, setCanWrite] = useState(false);
  /** Field problems are shown after the first save attempt (and after a Core refusal). */
  const [showIssues, setShowIssues] = useState(false);
  /** The last save was refused because a LIVE photo scope needs more gestures than the draft keeps. */
  const [countRefused, setCountRefused] = useState(false);
  /**
   * T-617 contract §7.3 / surprise #11: video enablement is DERIVED from the
   * unified method policy, so this page reads `verification_method_console`
   * rather than inferring anything from its own config document. `null` means
   * "not read yet or refused" and fails closed — the line then says the
   * authoritative coverage could not be loaded instead of claiming a state.
   */
  const [coverage, setCoverage] = useState<VerificationMethodConsoleData | null>(null);

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
    setShowIssues(false);
    setCountRefused(false);
    const [response, methodResponse, identity] = await Promise.all([
      adminCall("profile_verification_config"),
      adminCall("verification_method_console", { contract_version: 1 }),
      adminCall("admin_me"),
    ]);
    setCoverage(verificationMethodConsoleResponse(methodResponse));
    setCanWrite(identity?.success === true && isAdminWriteRole(identity.role));
    setState(response?.success && adopt(profileVerificationResponseData(response)) ? "ready" : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => Boolean(stored && draft
    && JSON.stringify(profileVerificationSavePayload(stored))
      !== JSON.stringify(profileVerificationSavePayload(draft))), [stored, draft]);

  function change(mutator: (next: ProfileVerificationConfig) => void) {
    if (!canWrite) return;
    setDraft((current) => {
      if (!current) return current;
      const next = cloneProfileVerificationConfig(current);
      mutator(next);
      return next;
    });
    setFeedback(null);
  }

  /**
   * Field-by-field problems of the TRIMMED draft — exactly what a save would
   * send. Core answers an invalid document with one code and no field, so this
   * is how an operator learns which field to fix.
   */
  const issues = useMemo(() => {
    const map = new Map<string, ProfileVerificationFieldProblem>();
    if (!draft) return map;
    for (const issue of profileVerificationConfigIssues(trimProfileVerificationDraft(draft))) {
      if (!map.has(issue.path)) map.set(issue.path, issue.problem);
    }
    return map;
  }, [draft]);

  function fieldError(path: string, language?: Language): string | undefined {
    if (!showIssues) return undefined;
    const problem = issues.get(language ? `${path}.${language}` : path);
    if (!problem) return undefined;
    // An example image is uploaded, never typed: say what to do instead of "required"/"invalid".
    if (path.endsWith("_image_url") && (problem === "required" || problem === "invalid")) {
      return t(problem === "required" ? "problems.requiredImage" : "problems.invalidImage");
    }
    return t(`problems.${problem}`);
  }

  function localizedErrors(path: string): Partial<Record<Language, string>> {
    return { en: fieldError(path, "en"), hu: fieldError(path, "hu") };
  }

  function setLocalized(
    target: ProfileVerificationLocalizedText,
    language: Language,
    value: string,
  ) {
    target[language] = value;
  }

  async function save() {
    if (!draft || !stored || busy || uploading || !canWrite) return;
    const trimmed = trimProfileVerificationDraft(draft);
    const validated = normalizeProfileVerificationConfig(trimmed);
    if (!validated || issues.size > 0) {
      setShowIssues(true);
      setFeedback({ tone: "error", text: issues.size > 0 ? t("invalidFields", { count: issues.size }) : t("invalid") });
      return;
    }
    setBusy(true);
    setFeedback(null);
    setCountRefused(false);
    const response = await adminCall("save_profile_verification_config", {
      configuration: profileVerificationSavePayload(validated),
      expected_revision: stored.revision,
    });
    setBusy(false);
    const authoritative = profileVerificationResponseData(response);
    if (!response?.success) {
      const error = String(response?.error || "core-unavailable");
      if (error === "profile-verification-config-conflict" && adopt(authoritative)) {
        setFeedback({ tone: "error", text: t("conflict") });
        return;
      }
      if (error === "profile-verification-gestures-insufficient") {
        // Core: a LIVE scope mandates `photo`, so the catalogue must keep one full set drawable.
        setCountRefused(true);
        setFeedback({ tone: "error", text: t("gesturesInsufficient", { count: validated.photo_gesture_count }) });
        return;
      }
      if (error === "profile-verification-config-invalid") {
        // Core names no field; the local walker found none either (it ran above), so the
        // remaining Core-only rule is the example image host.
        setShowIssues(true);
        setFeedback({ tone: "error", text: t("coreInvalid") });
        return;
      }
      if (error === "admin-write-required") {
        setFeedback({ tone: "error", text: t("writeRequired") });
        return;
      }
      setFeedback({ tone: "error", text: t("saveError", { error }) });
      return;
    }
    if (!adopt(authoritative)) {
      setFeedback({ tone: "error", text: t("invalidResponse") });
      return;
    }
    setShowIssues(false);
    setFeedback({ tone: "success", text: t("saved") });
  }

  if (state === "loading") {
    return <section id="profile-verification" className="panel verification-config-panel"><div className="panel-body"><p className="page-subtitle">{common("loading")}</p></div></section>;
  }
  if (state === "error" || !stored || !draft) {
    return <section id="profile-verification" className="panel verification-config-panel"><div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div></div><div className="panel-body"><div className="alert alert-error">{t("loadError")}</div><button className="button button-secondary" onClick={() => void load()}>{common("retry")}</button></div></section>;
  }

  const locked = busy || uploading || !canWrite;
  /** Where the gesture photo selfie is mandated (live / draft); `null` when the console read failed. */
  const photoCoverage: PhotoCoverage = coverage
    ? { live: documentUsesMethod(coverage.policy.live.document, "photo"), draft: documentUsesMethod(coverage.policy.draft.document, "photo") }
    : null;
  /**
   * The exact §7.3 sentence for the live document: nowhere, storefront-only,
   * global, or global with non-video overrides, plus Core's own availability
   * reason when new video starts are unavailable. A missing or refused read
   * never renders as "not selected anywhere".
   */
  const derivedAvailability = ((): string => {
    if (!coverage) return t("availabilityLoadError");
    const live = coverage.policy.live.document;
    const videoStorefronts = liveVideoStorefronts(live);
    const names = (codes: string[]): string => codes
      .map((code) => `${forcedStorefrontName(code, locale)} · ${code}`)
      .join(", ");
    let sentence: string;
    if (live.global === "video") {
      const others = liveNonVideoStorefronts(live);
      sentence = others.length === 0
        ? t("videoGlobal")
        : t("videoGlobalExcept", { storefronts: names(others) });
    } else if (videoStorefronts.length > 0) {
      sentence = t("videoStorefronts", { storefronts: names(videoStorefronts) });
    } else {
      sentence = t("videoNowhere");
    }
    const video = coverage.method_availability.video;
    return video.new_start_available || video.reason === null
      ? sentence
      : `${sentence} ${t("videoUnavailable", { reason: methodReason(video.reason) })}`;
  })();
  /** The same sentence for the gesture photo selfie (D-135). */
  const derivedPhotoAvailability = ((): string | null => {
    if (!coverage) return null;
    const live = coverage.policy.live.document;
    const names = (codes: string[]): string => codes
      .map((code) => `${forcedStorefrontName(code, locale)} · ${code}`)
      .join(", ");
    let sentence: string;
    if (live.global === "photo") {
      const others = Object.keys(live.overrides).filter((key) => live.overrides[key] !== "photo").sort();
      sentence = others.length === 0 ? t("photoGlobal") : t("photoGlobalExcept", { storefronts: names(others) });
    } else if (photoStorefronts(live).length > 0) {
      sentence = t("photoStorefronts", { storefronts: names(photoStorefronts(live)) });
    } else {
      sentence = t("photoNowhere");
    }
    const photo = coverage.method_availability.photo;
    return photo.new_start_available || photo.reason === null
      ? sentence
      : `${sentence} ${t("photoUnavailable", { reason: methodReason(photo.reason) })}`;
  })();

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
        {canWrite ? (
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={locked || !dirty} onClick={() => { setDraft(cloneProfileVerificationConfig(stored)); setFeedback(null); setShowIssues(false); }}>{t("reset")}</button>
            <button className="button button-primary" type="button" disabled={locked || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
          </div>
        ) : null}
      </div>
      <div className="panel-body verification-config-body">
        {!canWrite && <div className="alert alert-info" data-profile-verification-read-only="true">{t("readOnly")}</div>}
        {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"}`} role="status">{feedback.text}</div>}
        {dirty && !feedback && <div className="alert alert-info" role="status">{t("unsaved")}</div>}

        <div className="switch-row verification-feature-switch">
          <span>
            <strong>{t("derivedAvailabilityLabel")}</strong>
            <small>{derivedAvailability}</small>
            {derivedPhotoAvailability ? <small>{derivedPhotoAvailability}</small> : null}
          </span>
        </div>

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
                  <LocalizedFields errors={localizedErrors(`copy.account_card.${status}.title`)} value={card.title} maximum={160} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.account_card[status].title, language, value))} />
                  <LocalizedFields errors={localizedErrors(`copy.account_card.${status}.subtitle`)} value={card.subtitle} maximum={320} disabled={locked} labelEn={t("fields.subtitleEn")} labelHu={t("fields.subtitleHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.account_card[status].subtitle, language, value))} />
                  <ColorFields value={card.icon_color} errors={{ light: fieldError(`copy.account_card.${status}.icon_color.light`), dark: fieldError(`copy.account_card.${status}.icon_color.dark`) }} disabled={locked} lightLabel={t("fields.lightColor")} darkLabel={t("fields.darkColor")} onChange={(mode, value) => change((next) => { next.copy.account_card[status].icon_color[mode] = value; })} />
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
          <LocalizedFields errors={localizedErrors("copy.intro.title")} value={draft.copy.intro.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.title, language, value))} />
          <LocalizedFields errors={localizedErrors("copy.intro.body")} value={draft.copy.intro.body} maximum={1200} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.intro.body, language, value))} />
          {draft.copy.intro.steps.map((step, index) => (
            <div className="verification-copy-row" key={step.key}>
              <div className="verification-copy-row-title"><span className="verification-step-number">{index + 1}</span><code>{step.key}</code></div>
              <LocalizedFields errors={localizedErrors(`copy.intro.steps.${index}.title`)} value={step.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.steps[index].title, language, value))} />
              <LocalizedFields errors={localizedErrors(`copy.intro.steps.${index}.body`)} value={step.body} maximum={700} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.intro.steps[index].body, language, value))} />
            </div>
          ))}
          <LocalizedFields errors={localizedErrors("copy.intro.action")} value={draft.copy.intro.action} maximum={120} disabled={locked} labelEn={t("fields.actionEn")} labelHu={t("fields.actionHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.intro.action, language, value))} />
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
            <LocalizedFields errors={localizedErrors(`copy.camera.${key}`)} key={key} value={draft.copy.camera[key]} maximum={key === "framing" ? 320 : key === "recording" ? 240 : 180} disabled={locked} labelEn={t(`camera.fields.${key}En`)} labelHu={t(`camera.fields.${key}Hu`)} multiline={key === "framing" || key === "recording"} onChange={(language, value) => change((next) => setLocalized(next.copy.camera[key], language, value))} />
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
          <LocalizedFields errors={localizedErrors("copy.preview.title")} value={draft.copy.preview.title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.title, language, value))} />
          <LocalizedFields errors={localizedErrors("copy.preview.body")} value={draft.copy.preview.body} maximum={700} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.preview.body, language, value))} />
          <LocalizedFields errors={localizedErrors("copy.preview.retake")} value={draft.copy.preview.retake} maximum={120} disabled={locked} labelEn={t("preview.retakeEn")} labelHu={t("preview.retakeHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.retake, language, value))} />
          <LocalizedFields errors={localizedErrors("copy.preview.submit")} value={draft.copy.preview.submit} maximum={120} disabled={locked} labelEn={t("preview.submitEn")} labelHu={t("preview.submitHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.preview.submit, language, value))} />
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("details.title")}</h3><p>{t("details.copy")}</p></div>
          <div className="verification-status-copy-list">
            {PROFILE_VERIFICATION_DETAIL_STATUSES.map((status) => (
              <article className="verification-copy-row" key={status}>
                <div className="verification-copy-row-title"><span className="badge">{t(`statusLabels.${status}`)}</span><code>{status}</code></div>
                <LocalizedFields errors={localizedErrors(`copy.status.${status}.title`)} value={draft.copy.status[status].title} maximum={180} disabled={locked} labelEn={t("fields.titleEn")} labelHu={t("fields.titleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.status[status].title, language, value))} />
                <LocalizedFields errors={localizedErrors(`copy.status.${status}.subtitle`)} value={draft.copy.status[status].subtitle} maximum={500} disabled={locked} labelEn={t("fields.subtitleEn")} labelHu={t("fields.subtitleHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.status[status].subtitle, language, value))} />
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
                  <LocalizedFields errors={localizedErrors(`prompts.${index}.label`)} value={prompt.label} maximum={180} disabled={locked} labelEn={t("fields.labelEn")} labelHu={t("fields.labelHu")} onChange={(language, value) => change((next) => setLocalized(next.prompts[index].label, language, value))} />
                </article>
              );
            })}
          </div>
        </div>

        <div className="verification-editor-section">
          <div className="verification-section-heading"><h3>{t("consent.title")}</h3><p>{t("consent.copy")}</p></div>
          <LocalizedFields errors={localizedErrors("copy.consent.body")} value={draft.copy.consent.body} maximum={1800} disabled={locked} labelEn={t("fields.bodyEn")} labelHu={t("fields.bodyHu")} multiline onChange={(language, value) => change((next) => setLocalized(next.copy.consent.body, language, value))} />
          <LocalizedFields errors={localizedErrors("copy.consent.link_title")} value={draft.copy.consent.link_title} maximum={180} disabled={locked} labelEn={t("consent.linkTitleEn")} labelHu={t("consent.linkTitleHu")} onChange={(language, value) => change((next) => setLocalized(next.copy.consent.link_title, language, value))} />
          <label className="field"><span>{t("consent.linkUrl")}</span><input type="url" value={draft.copy.consent.link_url} maxLength={2048} disabled={locked} aria-invalid={fieldError("copy.consent.link_url") ? true : undefined} onChange={(event) => change((next) => { next.copy.consent.link_url = plainText(event.target.value, 2048); })} />{fieldError("copy.consent.link_url") ? <small className="field-error" role="alert">{fieldError("copy.consent.link_url")}</small> : null}</label>
        </div>

        <PhotoGestureCatalogue
          value={draft}
          disabled={busy || !canWrite}
          change={change}
          onBusyChange={setUploading}
          fieldError={fieldError}
          coverage={photoCoverage}
          countRefused={countRefused}
        />
        <PhotoFlowWording value={draft} disabled={locked} change={change} fieldError={fieldError} />

        {canWrite ? (
          <div className="row-actions verification-bottom-actions">
            <button className="button button-secondary" type="button" disabled={locked || !dirty} onClick={() => { setDraft(cloneProfileVerificationConfig(stored)); setFeedback(null); setShowIssues(false); }}>{t("reset")}</button>
            <button className="button button-primary" type="button" disabled={locked || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

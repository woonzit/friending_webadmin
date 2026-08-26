"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ImageUploadField from "@/components/ImageUploadField";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  MAX_CAPTION_LENGTH,
  MAX_LINK_TITLE_LENGTH,
  MAX_MODERATION_TEXT_LENGTH,
  MAX_PHOTO_COUNT,
  MAX_SORT_ORDER,
  MAX_SUBTITLE_LENGTH,
  MAX_TIP_ITEMS,
  MAX_TIP_KEY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MIN_PHOTO_COUNT,
  draftFromConfig,
  movedTipItem,
  newTipItem,
  normalizeTipOrder,
  signupPhotoConfig,
  signupPhotoFailureCode,
  signupPhotoSavePayload,
  validateSignupPhotoDraft,
  withLocale,
  type SignupPhotoConfig,
  type SignupPhotoDraft,
  type SignupPhotoFailureCode,
  type SignupPhotoLocalizedText,
  type SignupPhotoTipDraft,
} from "@/lib/signupPhotoConfig";

const PHOTO_COUNTS = Array.from(
  { length: MAX_PHOTO_COUNT - MIN_PHOTO_COUNT + 1 },
  (_, index) => MIN_PHOTO_COUNT + index,
);

/**
 * Every stored string is rendered by the app as a single label, and the parser refuses control
 * characters, so a pasted newline is normalised to a space here instead of being accepted and then
 * rejected by the very next load.
 */
function plainText(value: string, max: number): string {
  const collapsed = value.replace(/[\r\n\t\v\f]+/gu, " ").replace(/[\u0000-\u001F\u007F]/gu, "");
  return Array.from(collapsed).slice(0, max).join("");
}

function stableKeyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, MAX_TIP_KEY_LENGTH);
}

export default function SignupPhotosPage() {
  const t = useTranslations("signupPhotos");
  const common = useTranslations("common");
  const locale = useLocale();

  const [config, setConfig] = useState<SignupPhotoConfig | null>(null);
  const [draft, setDraft] = useState<SignupPhotoDraft | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const adopt = useCallback((raw: unknown): boolean => {
    const parsed = signupPhotoConfig(raw);
    if (!parsed) return false;
    setConfig(parsed);
    setDraft(draftFromConfig(parsed));
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    const response = await adminCall("signup_photo_config");
    // A malformed success payload is an error, never a proven empty configuration: this editor
    // writes whole documents, so rendering a fabricated blank form would offer the operator a
    // one-click way to erase the live configuration.
    setState(response?.success && adopt(response.config) ? "ready" : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const dirty = useMemo(() => {
    if (!config || !draft) return false;
    return JSON.stringify(signupPhotoSavePayload(draft))
      !== JSON.stringify(signupPhotoSavePayload(draftFromConfig(config)));
  }, [config, draft]);

  const trackUpload = useCallback((isBusy: boolean) => {
    setUploading((count) => Math.max(0, count + (isBusy ? 1 : -1)));
  }, []);

  function failureMessage(code: SignupPhotoFailureCode | ""): string {
    switch (code) {
      case "signup-photo-config-conflict": return t("errors.conflict");
      case "signup-photo-config-invalid-count": return t("errors.invalidCount");
      case "signup-photo-config-invalid-moderation": return t("errors.invalidModeration");
      case "signup-photo-config-invalid-avatar": return t("errors.invalidAvatar");
      case "signup-photo-config-invalid-tips": return t("errors.invalidTips");
      case "signup-photo-config-invalid-image-url": return t("errors.invalidImageUrl");
      case "signup-photo-config-duplicate-tip-key": return t("errors.duplicateTipKey");
      case "signup-photo-config-too-many-tips": return t("errors.tooManyTips");
      // The two 500s Core's handler emits. They are opposites — one means the change landed and one
      // means it did not — so neither may share the generic message.
      case "signup-photo-config-write-failed": return t("errors.writeFailed");
      case "audit-write-failed": return t("errors.auditWriteFailed");
      default: return t("errors.saveFailed");
    }
  }

  function patch(next: Partial<SignupPhotoDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function patchTip(uid: string, next: Partial<SignupPhotoTipDraft>) {
    setDraft((current) => current && {
      ...current,
      tips: {
        ...current.tips,
        items: current.tips.items.map((item) => (item.uid === uid ? { ...item, ...next } : item)),
      },
    });
  }

  function setTips(items: SignupPhotoTipDraft[]) {
    setDraft((current) => current && { ...current, tips: { ...current.tips, items } });
  }

  async function save() {
    if (!draft) return;
    const issue = validateSignupPhotoDraft(draft);
    if (issue) {
      setError(t(`validation.${issue}`));
      return;
    }
    setBusy(true);
    setError("");
    const response = await adminCall("save_signup_photo_config", signupPhotoSavePayload(draft));
    setBusy(false);

    const failure = signupPhotoFailureCode(response);
    if (failure === "signup-photo-config-conflict") {
      // §4.2: the local draft is discarded and the authoritative copy is adopted, never merged. A
      // merge could silently reinstate a tip another administrator had just removed.
      setError(t("errors.conflict"));
      setToast({ tone: "error", text: t("errors.conflict") });
      if (!adopt((response as Record<string, unknown> | null)?.config)) {
        // The conflict body was unreadable, so re-read the document rather than keep a draft the
        // contract says is no longer valid.
        await load();
      }
      return;
    }
    if (failure === "audit-write-failed") {
      // Not a failed save: Core wrote the document and bumped `revision`, then failed the call
      // because the `admin_audit_log` row could not be written, and attached the saved `config`
      // precisely so the caller can adopt it. Keeping the draft here would leave the operator with
      // a stale `expected_revision` — their next save would 409 against their own write — on top of
      // being told a change that did land had not. The message says so; the audit gap is a
      // person-to-person escalation, not something this page can repair.
      const message = failureMessage(failure);
      setError(message);
      setToast({ tone: "error", text: message });
      if (!adopt(response?.config)) {
        await load();
      }
      return;
    }
    if (!response?.success) {
      // Both a page-level alert and a toast: the tip list is long enough that the operator can be
      // far away from the top of the page when the save they just pressed comes back.
      // `signup-photo-config-write-failed` lands here on purpose: nothing was stored, Core sends no
      // `config`, and the draft is the only copy of the operator's edit, so it is kept untouched.
      const message = failureMessage(failure);
      setError(message);
      setToast({ tone: "error", text: message });
      return;
    }
    // Core is not contractually obliged to echo the saved document, so adopt it when it does and
    // re-read when it does not. Either way the draft stops being the source of truth.
    if (!adopt(response.config)) {
      await load();
    }
    setToast({ tone: "success", text: t("saved") });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !config || !draft) return <ErrorPanel message={t("loadError")} retry={load} />;

  const locked = busy || uploading > 0;
  const tips = draft.tips.items;
  const atCap = tips.length >= MAX_TIP_ITEMS;

  const localizedField = (
    label: string,
    map: SignupPhotoLocalizedText,
    language: "en" | "hu",
    max: number,
    apply: (next: SignupPhotoLocalizedText) => void,
    multiline = false,
  ) => (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={map[language] ?? ""}
          disabled={locked}
          onChange={(event) => apply(withLocale(map, language, plainText(event.target.value, max)))}
        />
      ) : (
        <input
          value={map[language] ?? ""}
          disabled={locked}
          onChange={(event) => apply(withLocale(map, language, plainText(event.target.value, max)))}
        />
      )}
    </label>
  );

  const saveButtons = (
    <div className="row-actions">
      <button
        className="button button-secondary"
        type="button"
        disabled={locked || !dirty}
        onClick={() => { setDraft(draftFromConfig(config)); setError(""); }}
      >{t("reset")}</button>
      <button
        className="button button-primary"
        type="button"
        disabled={locked || !dirty}
        onClick={() => void save()}
      >{busy ? common("saving") : common("save")}</button>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={locked} onClick={() => void load()}>{common("refresh")}</button>
            <button className="button button-primary" type="button" disabled={locked || !dirty} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button>
          </div>
        }
      />

      {dirty ? <p className="alert alert-info page-alert" role="status">{t("unsaved")}</p> : null}
      {error ? <p className="alert alert-error page-alert" role="alert">{error}</p> : null}

      <section className="panel signup-photo-panel">
        <div className="panel-header">
          <div>
            <h2>{t("photosPanelTitle")}</h2>
            <p>{t("photosPanelCopy")}</p>
          </div>
        </div>
        <div className="panel-body form-grid">
          <label className="field">
            <span>{t("minPhotos")}</span>
            <select
              value={draft.min_photos}
              disabled={locked}
              onChange={(event) => {
                const min = Number(event.target.value);
                patch({ min_photos: min, max_photos: Math.max(min, draft.max_photos) });
              }}
            >
              {PHOTO_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
            <small className="field-hint">{t("minPhotosHint")}</small>
          </label>
          <label className="field">
            <span>{t("maxPhotos")}</span>
            <select
              value={draft.max_photos}
              disabled={locked}
              onChange={(event) => {
                const max = Number(event.target.value);
                patch({ max_photos: max, min_photos: Math.min(max, draft.min_photos) });
              }}
            >
              {PHOTO_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
            <small className="field-hint">{t("maxPhotosHint")}</small>
          </label>

          <label className="switch-row field-full signup-photo-switch">
            <input
              type="checkbox"
              checked={draft.moderation.enabled}
              disabled={locked}
              onChange={(event) => patch({ moderation: { ...draft.moderation, enabled: event.target.checked } })}
            />
            <span>
              <strong>{t("moderationEnabled")}</strong>
              <small>{t("moderationEnabledHint")}</small>
            </span>
          </label>

          {localizedField(t("moderationTextEn"), draft.moderation.text, "en", MAX_MODERATION_TEXT_LENGTH,
            (text) => patch({ moderation: { ...draft.moderation, text } }), true)}
          {localizedField(t("moderationTextHu"), draft.moderation.text, "hu", MAX_MODERATION_TEXT_LENGTH,
            (text) => patch({ moderation: { ...draft.moderation, text } }), true)}
          {localizedField(t("moderationLinkTitleEn"), draft.moderation.link_title, "en", MAX_LINK_TITLE_LENGTH,
            (link_title) => patch({ moderation: { ...draft.moderation, link_title } }))}
          {localizedField(t("moderationLinkTitleHu"), draft.moderation.link_title, "hu", MAX_LINK_TITLE_LENGTH,
            (link_title) => patch({ moderation: { ...draft.moderation, link_title } }))}

          <label className="field field-full">
            <span>{t("moderationLinkUrl")}</span>
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://freelove.hu/moderalasi-elvek"
              value={draft.moderation.link_url}
              disabled={locked}
              onChange={(event) => patch({
                moderation: {
                  ...draft.moderation,
                  link_url: plainText(event.target.value, MAX_URL_LENGTH).trim(),
                },
              })}
            />
            <small className="field-hint">{t("moderationLinkUrlHint")}</small>
          </label>
        </div>
      </section>

      <section className="panel signup-photo-panel">
        <div className="panel-header">
          <div>
            <h2>{t("avatarPanelTitle")}</h2>
            <p>{t("avatarPanelCopy")}</p>
          </div>
        </div>
        <div className="panel-body form-grid">
          {localizedField(t("avatarTitleEn"), draft.avatar.title, "en", MAX_TITLE_LENGTH,
            (title) => patch({ avatar: { ...draft.avatar, title } }))}
          {localizedField(t("avatarTitleHu"), draft.avatar.title, "hu", MAX_TITLE_LENGTH,
            (title) => patch({ avatar: { ...draft.avatar, title } }))}
          {localizedField(t("avatarSubtitleEn"), draft.avatar.subtitle, "en", MAX_SUBTITLE_LENGTH,
            (subtitle) => patch({ avatar: { ...draft.avatar, subtitle } }), true)}
          {localizedField(t("avatarSubtitleHu"), draft.avatar.subtitle, "hu", MAX_SUBTITLE_LENGTH,
            (subtitle) => patch({ avatar: { ...draft.avatar, subtitle } }), true)}
          {localizedField(t("tipsBoxTitleEn"), draft.tips.title, "en", MAX_TITLE_LENGTH,
            (title) => patch({ tips: { ...draft.tips, title } }))}
          {localizedField(t("tipsBoxTitleHu"), draft.tips.title, "hu", MAX_TITLE_LENGTH,
            (title) => patch({ tips: { ...draft.tips, title } }))}
        </div>

        <div className="panel-header signup-photo-tips-header">
          <div>
            <h3>{t("tipsTitle")}</h3>
            <p>{t("tipsCopy", { max: MAX_TIP_ITEMS })}</p>
          </div>
          <div className="row-actions">
            <span className="signup-photo-tip-count">{t("tipCount", { count: tips.length, max: MAX_TIP_ITEMS })}</span>
            <button
              className="button button-primary"
              type="button"
              disabled={locked || atCap}
              onClick={() => setTips(normalizeTipOrder([...tips, newTipItem(tips)]))}
            >{t("addTip")}</button>
          </div>
        </div>

        <div className="panel-body signup-photo-tips">
          {atCap ? <p className="alert alert-warning" role="status">{t("tipCapReached", { max: MAX_TIP_ITEMS })}</p> : null}
          {tips.length === 0 ? <p className="signup-photo-tips-empty">{t("tipsEmpty")}</p> : null}

          {tips.map((item, index) => (
            <article className="signup-photo-tip" key={item.uid}>
              <header className="signup-photo-tip-header">
                <h4>{t("tipHeading", { position: index + 1 })}</h4>
                <div className="row-actions">
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={locked || index === 0}
                    aria-label={t("moveUp")}
                    title={t("moveUp")}
                    onClick={() => setTips(movedTipItem(tips, index, -1))}
                  >↑</button>
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={locked || index === tips.length - 1}
                    aria-label={t("moveDown")}
                    title={t("moveDown")}
                    onClick={() => setTips(movedTipItem(tips, index, 1))}
                  >↓</button>
                  <button
                    className="button button-danger button-small"
                    type="button"
                    disabled={locked}
                    onClick={() => setTips(tips.filter((row) => row.uid !== item.uid))}
                  >{t("removeTip")}</button>
                </div>
              </header>

              <div className="signup-photo-tip-body">
                <div className="signup-photo-tip-images">
                  <ImageUploadField
                    label={t("tipImageFemale")}
                    hint={t("tipImageFemaleHint")}
                    required
                    value={item.image_female}
                    disabled={busy}
                    onBusyChange={trackUpload}
                    onChange={(url) => patchTip(item.uid, { image_female: url })}
                  />
                  <ImageUploadField
                    label={t("tipImageMale")}
                    hint={t("tipImageMaleHint")}
                    value={item.image_male ?? ""}
                    disabled={busy}
                    onBusyChange={trackUpload}
                    onChange={(url) => patchTip(item.uid, { image_male: url === "" ? null : url })}
                  />
                </div>

                <div className="form-grid signup-photo-tip-fields">
                  {localizedField(t("tipCaptionEn"), item.caption, "en", MAX_CAPTION_LENGTH,
                    (caption) => patchTip(item.uid, { caption }))}
                  {localizedField(t("tipCaptionHu"), item.caption, "hu", MAX_CAPTION_LENGTH,
                    (caption) => patchTip(item.uid, { caption }))}
                  <label className="field">
                    <span>{t("tipVerdict")}</span>
                    <select
                      value={item.verdict}
                      disabled={locked}
                      onChange={(event) => patchTip(item.uid, { verdict: event.target.value === "bad" ? "bad" : "good" })}
                    >
                      <option value="good">{t("verdictGood")}</option>
                      <option value="bad">{t("verdictBad")}</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("tipOrder")}</span>
                    {/* The list re-sorts on blur, not on change: moving the row while a value is
                        still being typed would take the field out from under the caret. */}
                    <input
                      type="number"
                      min={0}
                      max={MAX_SORT_ORDER}
                      value={item.sort_order}
                      disabled={locked}
                      onChange={(event) => patchTip(item.uid, {
                        sort_order: Math.max(0, Math.min(MAX_SORT_ORDER, Math.trunc(Number(event.target.value) || 0))),
                      })}
                      onBlur={() => setTips(normalizeTipOrder(tips))}
                    />
                    <small className="field-hint">{t("tipOrderHint")}</small>
                  </label>
                  <label className="field">
                    <span>{t("tipKey")}</span>
                    <input
                      value={item.key}
                      spellCheck={false}
                      disabled={locked}
                      onChange={(event) => patchTip(item.uid, { key: stableKeyText(event.target.value) })}
                    />
                    <small className="field-hint">{t("tipKeyHint")}</small>
                  </label>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel signup-photo-panel">
        <div className="panel-body signup-photo-save">
          <div>
            <p><strong>{t("revision", { revision: config.revision })}</strong></p>
            <p className="field-hint">
              {config.updated_at === null
                ? t("neverSaved")
                : t("lastSaved", {
                  date: formatDate(config.updated_at, locale, true),
                  admin: config.updated_by === "" ? common("notAvailable") : config.updated_by,
                })}
            </p>
          </div>
          {saveButtons}
        </div>
      </section>

      {toast ? (
        <div className={`toast${toast.tone === "error" ? " toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>
          {toast.text}
        </div>
      ) : null}
    </>
  );
}

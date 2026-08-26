"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import ImageUploadField from "@/components/ImageUploadField";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  isHttpsUrl,
  isIsoCountryCode,
  isValidLatitude,
  isValidLongitude,
} from "@/lib/format";

type AppLandingScope = "global" | "country" | "city";

type AppLandingRule = {
  id: string;
  name: string;
  scope: AppLandingScope;
  country_code: string;
  city_name: string;
  latitude: number | null;
  longitude: number | null;
  radius_miles: number;
  background_type: "image" | "video";
  background_url: string;
  background_poster_url: string;
  title_type: "text" | "image";
  title_text_en: string;
  title_text_hu: string;
  title_image_url: string;
  description_en: string;
  description_hu: string;
  priority: number;
  active: boolean;
  created_at: number;
  updated_at: number;
  updated_by: string;
};

const EMPTY_RULE: AppLandingRule = {
  id: "",
  name: "",
  scope: "global",
  country_code: "",
  city_name: "",
  latitude: null,
  longitude: null,
  radius_miles: 40,
  background_type: "image",
  background_url: "",
  background_poster_url: "",
  title_type: "text",
  title_text_en: "",
  title_text_hu: "",
  title_image_url: "",
  description_en: "",
  description_hu: "",
  priority: 0,
  active: true,
  created_at: 0,
  updated_at: 0,
  updated_by: "",
};

// Built-in app defaults mirrored from Core's AppLandingService so the preview
// resolves exactly like production: rule → global rule → built-in default.
const DEFAULT_TITLE = "freelove.";
const DEFAULT_DESCRIPTION_EN = "Meet people near you — and wherever you're headed next.";
const DEFAULT_DESCRIPTION_HU = "Ismerj meg embereket a közeledben — és bárhol, ahová tartasz.";

type ResolvedContent = {
  backgroundType: "image" | "video";
  backgroundUrl: string;
  posterUrl: string;
  titleType: "text" | "image";
  titleText: string;
  titleImageUrl: string;
  description: string;
};

// A document only wins when it has the requested language or the English base;
// the language fallback never mixes two documents' copy (Core parity).
function localizedCopy(
  entries: Array<{ local: string; en: string } | null>,
  fallback: string,
): string {
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.local.trim()) return entry.local.trim();
    if (entry.en.trim()) return entry.en.trim();
  }
  return fallback;
}

function localizedDocument(
  doc: AppLandingRule | null,
  local: (value: AppLandingRule) => string,
  english: (value: AppLandingRule) => string,
  fallback: string,
): string {
  if (!doc) return fallback;
  return local(doc).trim() || english(doc).trim() || fallback;
}

function usableTitleOwner(
  rule: AppLandingRule | null,
  global: AppLandingRule | null,
  language: "en" | "hu",
): AppLandingRule | null {
  return [rule, global].find((doc) => {
    if (!doc) return false;
    if (doc.title_type === "image") return doc.title_image_url.trim() !== "";
    const local = language === "hu" ? doc.title_text_hu : doc.title_text_en;
    return local.trim() !== "" || doc.title_text_en.trim() !== "";
  }) ?? null;
}

function resolveContent(
  rule: AppLandingRule | null,
  global: AppLandingRule | null,
  language: "en" | "hu",
): ResolvedContent {
  // The doc that owns the non-empty background URL also owns its type, so a
  // blank override inherits the global type and URL as one consistent pair.
  const backgroundOwner = [rule, global].find((doc) => doc && doc.background_url.trim() !== "") ?? null;
  const backgroundUrl = backgroundOwner ? backgroundOwner.background_url.trim() : "";
  const backgroundType = backgroundUrl && backgroundOwner?.background_type === "video" ? "video" : "image";
  const posterUrl = backgroundOwner ? backgroundOwner.background_poster_url.trim() : "";

  const titleOwner = usableTitleOwner(rule, global, language);
  let titleType: "text" | "image" = titleOwner?.title_type === "image" ? "image" : "text";
  let titleImageUrl = titleOwner ? titleOwner.title_image_url.trim() : "";
  if (titleType !== "image" || titleImageUrl === "") {
    titleType = "text";
    titleImageUrl = "";
  }
  const titleText = localizedDocument(
    titleOwner,
    (doc) => language === "hu" ? doc.title_text_hu : doc.title_text_en,
    (doc) => doc.title_text_en,
    DEFAULT_TITLE,
  );

  const description = localizedCopy(
    [rule, global].map((doc) => (doc ? {
      local: language === "hu" ? doc.description_hu : doc.description_en,
      en: doc.description_en,
    } : null)),
    language === "hu" ? DEFAULT_DESCRIPTION_HU : DEFAULT_DESCRIPTION_EN,
  );

  return { backgroundType, backgroundUrl, posterUrl, titleType, titleText, titleImageUrl, description };
}

function PhonePreview({
  content,
  fallbackLabel,
}: {
  content: ResolvedContent;
  fallbackLabel: string;
}) {
  return (
    <div className="app-landing-phone">
      {isHttpsUrl(content.backgroundUrl) ? (
        content.backgroundType === "video" ? (
          <video
            className="app-landing-phone-media"
            src={content.backgroundUrl}
            poster={isHttpsUrl(content.posterUrl) ? content.posterUrl : undefined}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="app-landing-phone-media" src={content.backgroundUrl} alt="" />
        )
      ) : (
        <span className="app-landing-phone-fallback">{fallbackLabel}</span>
      )}
      <div className="app-landing-phone-overlay">
        {content.titleType === "image" && isHttpsUrl(content.titleImageUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="app-landing-phone-title-image" src={content.titleImageUrl} alt="" />
        ) : (
          <strong className="app-landing-phone-title">{content.titleText}</strong>
        )}
        {content.description && (
          <p className="app-landing-phone-description">{content.description}</p>
        )}
      </div>
    </div>
  );
}

function AppLandingDialog({
  value,
  globalRule,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: AppLandingRule;
  globalRule: AppLandingRule | null;
  busy: boolean;
  error: string;
  onChange: (value: AppLandingRule) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("appLanding");
  const common = useTranslations("common");
  const locale = useLocale();
  const [uploadingField, setUploadingField] = useState<"background" | "poster" | "title" | null>(null);
  const locked = busy || uploadingField !== null;
  const isPersistedGlobal = value.id !== "" && value.scope === "global";

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [locked, onClose]);

  const preview = useMemo(
    () => resolveContent(value, value.scope === "global" ? null : globalRule, locale === "hu" ? "hu" : "en"),
    [value, globalRule, locale],
  );

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="app-landing-dialog-title">
        <div className="dialog-header">
          <h2 id="app-landing-dialog-title">{value.id ? t("editTitle") : t("createTitle")}</h2>
          <button className="dialog-close" onClick={onClose} disabled={locked} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <label className="field">
            <span>{t("name")}</span>
            <input
              value={value.name}
              maxLength={80}
              autoFocus
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder={t("namePlaceholder")}
            />
          </label>
          <label className="field">
            <span>{t("scope")}</span>
            <select
              value={value.scope}
              disabled={locked || isPersistedGlobal}
              onChange={(event) => {
                const scope = event.target.value as AppLandingScope;
                onChange({
                  ...value,
                  scope,
                  country_code: scope === "global" ? "" : value.country_code,
                  city_name: scope === "city" ? value.city_name : "",
                  latitude: scope === "city" ? value.latitude : null,
                  longitude: scope === "city" ? value.longitude : null,
                });
              }}
            >
              <option value="global">{t("scopeGlobal")}</option>
              <option value="country">{t("scopeCountry")}</option>
              <option value="city">{t("scopeCity")}</option>
            </select>
          </label>

          {value.scope !== "global" && (
            <label className="field">
              <span>{t("countryCode")}</span>
              <input
                value={value.country_code}
                maxLength={2}
                autoCapitalize="characters"
                onChange={(event) => onChange({
                  ...value,
                  country_code: event.target.value.replace(/[^a-z]/gi, "").toUpperCase(),
                })}
                placeholder="HU"
              />
              <small className="field-hint">{t("countryCodeHint")}</small>
            </label>
          )}
          <label className="field">
            <span>{t("priority")}</span>
            <input
              type="number"
              min="0"
              max="10000"
              value={value.priority}
              onChange={(event) => onChange({ ...value, priority: Number(event.target.value) || 0 })}
            />
            <small className="field-hint">{t("priorityHint")}</small>
          </label>

          {value.scope === "city" && (
            <>
              <label className="field field-full">
                <span>{t("cityName")}</span>
                <input
                  value={value.city_name}
                  maxLength={100}
                  onChange={(event) => onChange({ ...value, city_name: event.target.value })}
                  placeholder="Budapest"
                />
              </label>
              <label className="field">
                <span>{t("latitude")}</span>
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="0.000001"
                  value={value.latitude ?? ""}
                  onChange={(event) => onChange({
                    ...value,
                    latitude: event.target.value === "" ? null : Number(event.target.value),
                  })}
                  placeholder="47.497900"
                />
              </label>
              <label className="field">
                <span>{t("longitude")}</span>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="0.000001"
                  value={value.longitude ?? ""}
                  onChange={(event) => onChange({
                    ...value,
                    longitude: event.target.value === "" ? null : Number(event.target.value),
                  })}
                  placeholder="19.040200"
                />
              </label>
              <label className="field">
                <span>{t("radius")}</span>
                <input
                  type="number"
                  min="1"
                  max="250"
                  step="1"
                  value={value.radius_miles}
                  onChange={(event) => onChange({ ...value, radius_miles: Number(event.target.value) || 40 })}
                />
                <small className="field-hint">{t("radiusHint")}</small>
              </label>
            </>
          )}

          <label className="field">
            <span>{t("backgroundType")}</span>
            <select
              value={value.background_type}
              disabled={locked}
              onChange={(event) => {
                const backgroundType = event.target.value as AppLandingRule["background_type"];
                if (backgroundType === value.background_type) return;
                onChange({
                  ...value,
                  background_type: backgroundType,
                  background_url: "",
                  background_poster_url: "",
                });
              }}
            >
              <option value="image">{t("backgroundImage")}</option>
              <option value="video">{t("backgroundVideo")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("titleType")}</span>
            <select
              value={value.title_type}
              disabled={locked}
              onChange={(event) => {
                const titleType = event.target.value as AppLandingRule["title_type"];
                if (titleType === value.title_type) return;
                onChange({
                  ...value,
                  title_type: titleType,
                  title_text_en: titleType === "image" ? "" : value.title_text_en,
                  title_text_hu: titleType === "image" ? "" : value.title_text_hu,
                  title_image_url: titleType === "text" ? "" : value.title_image_url,
                });
              }}
            >
              <option value="text">{t("titleText")}</option>
              <option value="image">{t("titleImage")}</option>
            </select>
          </label>

          {value.background_type === "image" ? (
            <ImageUploadField
              className="field-full"
              label={t("backgroundImageLabel")}
              value={value.background_url}
              disabled={locked}
              hint={t("backgroundImageHint")}
              onBusyChange={(isBusy) => setUploadingField(isBusy ? "background" : null)}
              onChange={(url) => onChange({ ...value, background_url: url })}
            />
          ) : (
            <>
              <label className="field field-full">
                <span>{t("videoUrl")}</span>
                <input
                  type="url"
                  inputMode="url"
                  value={value.background_url}
                  onChange={(event) => onChange({ ...value, background_url: event.target.value.slice(0, 2048) })}
                  placeholder="https://cdn.example.com/landing.mp4"
                />
                <small className="field-hint">{t("videoUrlHint")}</small>
              </label>
              <ImageUploadField
                className="field-full"
                label={t("posterImage")}
                value={value.background_poster_url}
                disabled={locked}
                hint={t("posterHint")}
                onBusyChange={(isBusy) => setUploadingField(isBusy ? "poster" : null)}
                onChange={(url) => onChange({ ...value, background_poster_url: url })}
              />
            </>
          )}

          {value.title_type === "text" ? (
            <>
              <label className="field">
                <span>{t("titleTextEn")}</span>
                <input
                  value={value.title_text_en}
                  maxLength={80}
                  onChange={(event) => onChange({ ...value, title_text_en: event.target.value })}
                  placeholder={DEFAULT_TITLE}
                />
              </label>
              <label className="field">
                <span>{t("titleTextHu")}</span>
                <input
                  value={value.title_text_hu}
                  maxLength={80}
                  onChange={(event) => onChange({ ...value, title_text_hu: event.target.value })}
                  placeholder={DEFAULT_TITLE}
                />
                <small className="field-hint">{t("titleTextHint")}</small>
              </label>
            </>
          ) : (
            <ImageUploadField
              className="field-full"
              label={t("titleImageLabel")}
              value={value.title_image_url}
              required
              disabled={locked}
              hint={t("titleImageHint")}
              onBusyChange={(isBusy) => setUploadingField(isBusy ? "title" : null)}
              onChange={(url) => onChange({ ...value, title_image_url: url })}
            />
          )}

          <label className="field">
            <span>{t("descriptionEn")}</span>
            <textarea
              rows={3}
              maxLength={300}
              value={value.description_en}
              onChange={(event) => onChange({ ...value, description_en: event.target.value })}
              placeholder={DEFAULT_DESCRIPTION_EN}
            />
          </label>
          <label className="field">
            <span>{t("descriptionHu")}</span>
            <textarea
              rows={3}
              maxLength={300}
              value={value.description_hu}
              onChange={(event) => onChange({ ...value, description_hu: event.target.value })}
              placeholder={DEFAULT_DESCRIPTION_HU}
            />
            <small className="field-hint">{t("descriptionHint")}</small>
          </label>

          <div className="app-landing-preview field-full" aria-label={t("preview")}>
            <PhonePreview content={preview} fallbackLabel={t("builtInBackground")} />
            <span className="app-landing-preview-hint">{t("previewHint")}</span>
          </div>

          <label className="checkbox-field field-full">
            <input
              type="checkbox"
              checked={value.active}
              onChange={(event) => onChange({ ...value, active: event.target.checked })}
            />
            <span>{t("isActive")}</span>
          </label>
          {error && <div className="alert alert-error field-full" role="alert">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} disabled={locked}>{common("cancel")}</button>
          <button className="button button-primary" onClick={onSave} disabled={locked}>
            {busy ? common("saving") : common("save")}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function AppLandingPage() {
  const t = useTranslations("appLanding");
  const common = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<AppLandingRule[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<AppLandingRule | null>(null);
  const [deleting, setDeleting] = useState<AppLandingRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_app_landing");
    if (!response?.success || !Array.isArray(response.data)) {
      setState("error");
      return;
    }
    setRows(response.data as AppLandingRule[]);
    setState("ready");
  }, [rows.length]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);
  const globalRow = useMemo(() => rows.find((row) => row.scope === "global") ?? null, [rows]);
  const language: "en" | "hu" = locale === "hu" ? "hu" : "en";

  function validate(rule: AppLandingRule): string {
    if (!rule.name.trim()) return t("nameInvalid");
    if (!isHttpsUrl(rule.background_url, true)) return t("backgroundInvalid");
    if (!isHttpsUrl(rule.background_poster_url, true)) return t("posterInvalid");
    if (rule.title_type === "image" && !isHttpsUrl(rule.title_image_url)) {
      return t("titleImageRequired");
    }
    if (rule.scope !== "global" && !isIsoCountryCode(rule.country_code)) {
      return t("countryInvalid");
    }
    if (rule.scope === "city") {
      if (
        !rule.city_name.trim()
        || rule.latitude === null
        || rule.longitude === null
        || !isValidLatitude(rule.latitude)
        || !isValidLongitude(rule.longitude)
        || (rule.latitude === 0 && rule.longitude === 0)
        || !Number.isFinite(rule.radius_miles)
        || rule.radius_miles < 1
        || rule.radius_miles > 250
      ) {
        return t("geoInvalid");
      }
    }
    if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 10000) {
      return t("priorityInvalid");
    }
    return "";
  }

  async function save() {
    if (!draft) return;
    const validation = validate(draft);
    if (validation) {
      setFormError(validation);
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("save_app_landing", draft);
    setBusy(false);
    if (!response?.success || !response.landing) {
      setFormError(
        response?.error === "global-exists"
          ? t("globalExists")
          : response?.error === "global-protected"
            ? t("globalProtected")
            : t("saveError"),
      );
      return;
    }
    const saved = response.landing as AppLandingRule;
    setRows((current) => [...current.filter((row) => row.id !== saved.id), saved]);
    setDraft(null);
    setToast({ tone: "success", text: t("updated") });
  }

  async function remove() {
    if (!deleting) return;
    if (deleting.scope === "global") {
      setFormError(t("globalProtected"));
      setDeleting(null);
      return;
    }
    setBusy(true);
    const response = await adminCall("delete_app_landing", { id: deleting.id });
    setBusy(false);
    if (!response?.success) {
      setToast({ tone: "error", text: response?.error === "global-protected" ? t("globalProtected") : t("deleteError") });
      setDeleting(null);
      return;
    }
    setRows((current) => current.filter((row) => row.id !== deleting.id));
    setDeleting(null);
    setToast({ tone: "success", text: t("deleted") });
  }

  function newRule() {
    setFormError("");
    setDraft({
      ...EMPTY_RULE,
      scope: globalRow ? "country" : "global",
      name: globalRow ? t("newRegionalName") : t("newGlobalName"),
      priority: globalRow ? 10 : 0,
    });
  }

  function scopeLabel(rule: AppLandingRule): string {
    if (rule.scope === "global") return t("scopeGlobal");
    if (rule.scope === "country") return `${t("scopeCountry")} · ${rule.country_code}`;
    return `${t("scopeCity")} · ${rule.city_name}, ${rule.country_code} · ${rule.radius_miles} mi`;
  }

  function inheritedLabel(rule: AppLandingRule): string {
    return rule.scope === "global" ? t("fallbackDefault") : t("fallbackInherit");
  }

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-primary" onClick={newRule}>{t("newRule")}</button>}
      />
      <div className="list-summary">
        <strong>{t("activeCount", { active: activeCount, total: rows.length })}</strong>
        <span>{t("precedence")}</span>
      </div>
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rows.length === 0 ? (
        <EmptyPanel title={t("empty")} copy={t("emptyCopy")} />
      ) : (
        <section className="landing-rule-list">
          {rows.map((row) => {
            const resolved = resolveContent(row, row.scope === "global" ? null : globalRow, language);
            return (
              <article className="landing-rule-card" key={row.id}>
                <div className="landing-rule-image">
                  {isHttpsUrl(resolved.backgroundUrl) && (resolved.backgroundType === "video" ? (
                    <video
                      src={resolved.backgroundUrl}
                      poster={isHttpsUrl(resolved.posterUrl) ? resolved.posterUrl : undefined}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolved.backgroundUrl} alt="" loading="lazy" />
                  ))}
                  <div className="landing-rule-overlay">
                    <strong>{row.name}</strong>
                    <span>{scopeLabel(row)}</span>
                  </div>
                </div>
                <div className="landing-rule-body">
                  <div className="hero-meta">
                    <span className={`badge ${row.active ? "badge-active" : "badge-inactive"}`}>
                      {row.active ? common("active") : common("inactive")}
                    </span>
                    <span className="badge">{t("priorityValue", { value: row.priority })}</span>
                  </div>
                  <div className="landing-variants">
                    <span>
                      {t("backgroundLabel")}: {row.background_url
                        ? (row.background_type === "video" ? t("backgroundVideo") : t("backgroundImage"))
                        : inheritedLabel(row)}
                    </span>
                    <span>
                      {t("titleLabel")}: {row.title_type === "image" && row.title_image_url
                        ? t("titleImage")
                        : (row.title_text_en || row.title_text_hu) ? t("titleText") : inheritedLabel(row)}
                    </span>
                    <span>
                      {t("descriptionLabel")}: {(row.description_en || row.description_hu) ? "✓" : inheritedLabel(row)}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button className="button button-secondary button-small" onClick={() => { setFormError(""); setDraft({ ...row }); }}>
                      {common("edit")}
                    </button>
                    {row.scope !== "global" && (
                      <button className="button button-danger button-small" onClick={() => setDeleting(row)}>
                        {common("delete")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {draft && (
        <AppLandingDialog
          value={draft}
          globalRule={globalRow && globalRow.id !== draft.id ? globalRow : null}
          busy={busy}
          error={formError}
          onChange={setDraft}
          onClose={() => { if (!busy) setDraft(null); }}
          onSave={() => void save()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          busyLabel={common("deleting")}
          title={t("deleteTitle")}
          copy={t("deleteCopy", { name: deleting.name })}
          confirmLabel={common("delete")}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
      {toast && <div className={`toast${toast.tone === "error" ? " toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.text}</div>}
    </>
  );
}

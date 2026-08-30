"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import AppearanceLandingPreview, { type AppearanceAuthPreviewMode } from "@/components/AppearanceLandingPreview";
import ImageUploadField from "@/components/ImageUploadField";
import VideoUploadField from "@/components/VideoUploadField";
import { adminCall } from "@/lib/adminClient";
import {
  APPEARANCE_LANDING_ALIGNS,
  APPEARANCE_LANDING_APPLE_STYLES,
  APPEARANCE_LANDING_FONTS,
  appearanceLandingBackgroundSelection,
  appearanceLandingLogoHintVisible,
  appearanceLandingLogoSelection,
  appearanceLandingPreviewDraft,
  appearanceLandingWire,
  compareAppearanceLandingWithPreview,
  decodeAppearancePreviewResponse,
  isAppearanceStorefront,
  resolveAppearanceLanding,
  resolveAppearancePalette,
  type AppearanceFullPalette,
  type AppearanceLanding,
  type AppearanceLandingBackgroundType,
  type AppearanceLandingDifference,
  type AppearanceLandingDraft,
  type AppearanceLandingFont,
  type AppearanceLandingFlatSources,
  type AppearanceLandingKey,
  type AppearanceRule,
  type AppearanceRuleDraft,
  type LocalizedAppearanceCountry,
} from "@/lib/appearanceRules";

type Props = {
  rule: AppearanceRuleDraft;
  persistedRule: AppearanceRule | null;
  inherited: AppearanceLandingDraft;
  defaults: AppearanceLandingDraft;
  palette: AppearanceFullPalette;
  countries: readonly LocalizedAppearanceCountry[];
  disabled: boolean;
  onChange: (landing: AppearanceLandingDraft) => void;
  onBusyChange: (busy: boolean) => void;
};

type ParentState =
  | { kind: "waiting" }
  | { kind: "loading" }
  | {
    kind: "ready";
    fields: AppearanceLandingDraft;
    defaults: AppearanceLandingDraft;
    sources: AppearanceLandingFlatSources;
    palette: AppearanceFullPalette;
  }
  | { kind: "error" };

type ComparisonState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; differences: AppearanceLandingDifference[] };

type PreviewTarget = Record<string, string | number>;

const LOCALIZED_ENGLISH_FALLBACKS: Partial<Record<AppearanceLandingKey, AppearanceLandingKey>> = {
  title_text_hu: "title_text_en",
  description_hu: "description_en",
  button_phone_label_hu: "button_phone_label_en",
  button_email_label_hu: "button_email_label_en",
  footer_text_hu: "footer_text_en",
};

function draftTarget(rule: AppearanceRuleDraft, testStorefront: string): PreviewTarget | null {
  if (rule.scope === "global") return { location_mode: "none" };
  if (rule.scope === "storefront") {
    return isAppearanceStorefront(rule.storefront_country)
      ? { location_mode: "none", storefront_country: rule.storefront_country }
      : null;
  }
  const latitude = Number(rule.latitude);
  const longitude = Number(rule.longitude);
  if (rule.latitude.trim() === "" || rule.longitude.trim() === ""
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return isAppearanceStorefront(testStorefront)
    ? { latitude, longitude, storefront_country: testStorefront }
    : { latitude, longitude };
}

function storedTarget(rule: AppearanceRule, testStorefront: string): PreviewTarget {
  if (rule.scope === "storefront") return { location_mode: "none", storefront_country: rule.storefront_country };
  if (rule.scope === "geo" && rule.center) {
    return isAppearanceStorefront(testStorefront)
      ? { latitude: rule.center.latitude, longitude: rule.center.longitude, storefront_country: testStorefront }
      : { latitude: rule.center.latitude, longitude: rule.center.longitude };
  }
  return { location_mode: "none" };
}

function projectLocalizedFields(
  chain: readonly AppearanceLanding[],
  defaults: AppearanceLandingDraft,
  language: "en" | "hu",
): AppearanceLandingDraft {
  const resolved = resolveAppearanceLanding(chain, defaults, language);
  const fields = { ...resolved.effective };
  fields[`title_text_${language}`] = resolved.titleType === "text" ? resolved.titleText : "";
  fields[`description_${language}`] = resolved.description;
  fields[`button_phone_label_${language}`] = resolved.phoneLabel;
  fields[`button_email_label_${language}`] = resolved.emailLabel;
  fields[`footer_text_${language}`] = resolved.footerText;
  if (resolved.backgroundType === "image") fields.background_poster_url = "";
  if (resolved.titleType !== "image") fields.title_image_url = "";
  return fields;
}

function validHex(value: string): boolean {
  return /^#[0-9A-F]{6}$/.test(value);
}

function FieldMeta({
  inherited,
  effective,
  inheritLabel,
  onClear,
  disabled,
}: {
  inherited: boolean;
  effective: string;
  inheritLabel: string;
  onClear: () => void;
  disabled: boolean;
}) {
  return (
    <small className="appearance-landing-field-meta">
      <span>{effective}</span>
      <button type="button" className="text-button" disabled={disabled || inherited} onClick={onClear}>{inheritLabel}</button>
    </small>
  );
}

function TextField({
  label, value, effective, maximum, rows, disabled, inheritLabel, effectiveLabel, onChange,
}: {
  label: string; value: string; effective: string; maximum: number; rows?: number; disabled: boolean;
  inheritLabel: string; effectiveLabel: string; onChange: (value: string) => void;
}) {
  const control = rows ? (
    <textarea rows={rows} value={value} maxLength={maximum} disabled={disabled} placeholder={effective} onChange={(event) => onChange(event.target.value)} />
  ) : (
    <input value={value} maxLength={maximum} disabled={disabled} placeholder={effective} onChange={(event) => onChange(event.target.value)} />
  );
  return (
    <label className="field">
      <span>{label}</span>
      {control}
      <FieldMeta inherited={value === ""} effective={value === "" ? effectiveLabel : effective} inheritLabel={inheritLabel} disabled={disabled} onClear={() => onChange("")} />
    </label>
  );
}

function SelectField({
  label, value, effective, effectiveLabel, options, disabled, inheritValue, error, onChange,
}: {
  label: string; value: string; effective: string; options: readonly { value: string; label: string }[];
  effectiveLabel: string; disabled: boolean; inheritValue: string; error?: string; onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)}>
        <option value="">{inheritValue}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <small className="appearance-landing-effective-value">{value === "" || error ? effectiveLabel : effective}</small>
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function ColorField({
  label, value, effective, disabled, inheritLabel, effectiveLabel, error, onChange,
}: {
  label: string; value: string; effective: string; disabled: boolean; inheritLabel: string;
  effectiveLabel: string; error?: string; onChange: (value: string) => void;
}) {
  const picker = validHex(value) ? value : validHex(effective) ? effective : "#000000";
  return (
    <label className="field appearance-landing-color-field">
      <span>{label}</span>
      <span className="appearance-landing-color-row">
        <input value={value} maxLength={7} disabled={disabled} spellCheck={false} aria-invalid={error ? true : undefined} placeholder={effective} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <input type="color" value={picker} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      </span>
      <FieldMeta inherited={value === ""} effective={value === "" || error ? effectiveLabel : effective} inheritLabel={inheritLabel} disabled={disabled} onClear={() => onChange("")} />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function RangeField({
  label, value, effective, minimum, maximum, step, disabled, inheritLabel, effectiveLabel, error, onChange,
}: {
  label: string; value: string; effective: string; minimum: number; maximum: number; step: number;
  disabled: boolean; inheritLabel: string; effectiveLabel: string; error?: string; onChange: (value: string) => void;
}) {
  const parsed = Number(value === "" ? effective : value);
  const rangeValue = Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : minimum;
  const canonical = (next: number) => step < 1 ? next.toFixed(2) : String(Math.round(next));
  return (
    <label className="field appearance-landing-range-field">
      <span>{label}</span>
      <span className="appearance-landing-range-row">
        <input type="range" min={minimum} max={maximum} step={step} value={rangeValue} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onChange(canonical(Number(event.target.value)))} />
        <input
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          placeholder={effective}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) onChange(canonical(Number(event.target.value)));
          }}
        />
      </span>
      <FieldMeta inherited={value === ""} effective={value === "" || error ? effectiveLabel : effective} inheritLabel={inheritLabel} disabled={disabled} onClear={() => onChange("")} />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function ComposerSection({ title, copy, children }: { title: string; copy: string; children: ReactNode }) {
  return (
    <section className="appearance-landing-composer-section">
      <header><h4>{title}</h4><p>{copy}</p></header>
      <div className="form-grid">{children}</div>
    </section>
  );
}

export default function AppearanceLandingComposer({
  rule,
  persistedRule,
  inherited,
  defaults,
  palette,
  countries,
  disabled,
  onChange,
  onBusyChange,
}: Props) {
  const t = useTranslations("appearance.landingComposer");
  const [language, setLanguage] = useState<"en" | "hu">("en");
  const [paletteMode, setPaletteMode] = useState<"light" | "dark">("light");
  const [authMethods, setAuthMethods] = useState<AppearanceAuthPreviewMode>("both");
  const [testStorefront, setTestStorefront] = useState("");
  const [parentState, setParentState] = useState<ParentState>({ kind: "loading" });
  const [parentReload, setParentReload] = useState(0);
  const [comparison, setComparison] = useState<ComparisonState>({ kind: "idle" });
  const [pendingBackgroundType, setPendingBackgroundType] = useState<AppearanceLandingBackgroundType | null>(null);

  const target = useMemo(
    () => draftTarget(rule, testStorefront),
    [rule.scope, rule.storefront_country, rule.latitude, rule.longitude, testStorefront],
  );
  const targetKey = target === null ? "" : JSON.stringify(target);

  useEffect(() => {
    setPendingBackgroundType(null);
  }, [rule.id, rule.scope]);

  useEffect(() => {
    setComparison({ kind: "idle" });
    if (target === null) {
      setParentState({ kind: "waiting" });
      return;
    }
    setParentState({ kind: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const base: Record<string, unknown> = { ...target, appearance_schema: 2 };
      if (rule.id !== "") base.exclude_rule_id = rule.id;
      void adminCall("appearance_rules_preview", { ...base, lang: "en" }, controller.signal).then((response) => {
        if (controller.signal.aborted) return;
        const decoded = decodeAppearancePreviewResponse(response);
        if (!decoded.ok || decoded.value.landing.schema !== 2
          || decoded.value.landing_flat === null || decoded.value.landing_flat_sources === null
          || decoded.value.landing_flat_defaults === null) {
          setParentState({ kind: "error" });
          return;
        }
        setParentState({
          kind: "ready",
          palette: decoded.value.palette,
          fields: decoded.value.landing_flat,
          defaults: decoded.value.landing_flat_defaults,
          sources: decoded.value.landing_flat_sources,
        });
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // targetKey is the stable target identity; target itself is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, rule.id, parentReload]);

  const parent = parentState.kind === "ready" ? parentState.fields : inherited;
  const activeDefaults = parentState.kind === "ready" ? parentState.defaults : defaults;
  const draftWire = useMemo(() => appearanceLandingWire(rule.landing), [rule.landing]);
  const previewDraft = useMemo(() => appearanceLandingPreviewDraft(rule.landing), [rule.landing]);
  const invalidPreviewFields = useMemo(() => new Set(previewDraft.invalidFields), [previewDraft]);
  const contentByLanguage = useMemo(
    () => ({
      en: resolveAppearanceLanding([previewDraft.landing, parent], activeDefaults, "en"),
      hu: resolveAppearanceLanding([previewDraft.landing, parent], activeDefaults, "hu"),
    }),
    [previewDraft, parent, activeDefaults],
  );
  const content = contentByLanguage[language];
  const previewPalette = useMemo(
    () => parentState.kind === "ready" ? resolveAppearancePalette([rule.palette, parentState.palette], palette).values : palette,
    [parentState, rule.palette, palette],
  );
  const effective = useMemo(() => ({
    ...content.effective,
    title_text_en: contentByLanguage.en.titleText,
    title_text_hu: contentByLanguage.hu.titleText,
    description_en: contentByLanguage.en.description,
    description_hu: contentByLanguage.hu.description,
    button_phone_label_en: contentByLanguage.en.phoneLabel,
    button_phone_label_hu: contentByLanguage.hu.phoneLabel,
    button_email_label_en: contentByLanguage.en.emailLabel,
    button_email_label_hu: contentByLanguage.hu.emailLabel,
    footer_text_en: contentByLanguage.en.footerText,
    footer_text_hu: contentByLanguage.hu.footerText,
  }), [content.effective, contentByLanguage]);

  function patch(field: AppearanceLandingKey, value: string) {
    onChange({ ...rule.landing, [field]: value });
  }

  function patchMany(next: Partial<AppearanceLandingDraft>) {
    onChange({ ...rule.landing, ...next });
  }

  const inheritLabel = t("inherit");
  const metaEffective = (key: AppearanceLandingKey, value: string) => {
    const displayValue = value || "—";
    if (parentState.kind !== "ready") return t("effectiveValueApproximate", { value: displayValue });
    let sourceKey = key;
    const englishFallback = LOCALIZED_ENGLISH_FALLBACKS[key];
    if (englishFallback && parentState.fields[key] === "") {
      // The local draft's English sibling wins before any parent English
      // value. It has no Core provenance, so do not invent a source hint.
      if (draftWire[englishFallback] !== undefined) return t("effectiveValue", { value: displayValue });
      if (parentState.fields[englishFallback] !== "") sourceKey = englishFallback;
    }
    const source = parentState.sources[sourceKey];
    const sourceLabel = t(`source.${source.scope}`, { id: source.rule_id });
    return t("effectiveValueSource", { value: displayValue, source: sourceLabel });
  };
  const uploadHint = (key: AppearanceLandingKey, value: string) => rule.landing[key] === "" ? metaEffective(key, value) : value;
  const previewError = (key: AppearanceLandingKey) => invalidPreviewFields.has(key) ? t("invalidPreviewValue") : undefined;
  const inheritValue = (value: string) => t("inheritValue", { value });
  const fontOptions = APPEARANCE_LANDING_FONTS.map((font) => ({ value: font, label: t(`font.${font as AppearanceLandingFont}`) }));
  const alignOptions = APPEARANCE_LANDING_ALIGNS.map((align) => ({ value: align, label: t(`align.${align}`) }));
  const selectedBackgroundType = pendingBackgroundType ?? rule.landing.background_type;
  const uploadBackgroundType = selectedBackgroundType === "video"
    || (selectedBackgroundType === "" && effective.background_type === "video")
    ? "video"
    : "image";

  function selectBackgroundType(value: string) {
    const selection = appearanceLandingBackgroundSelection(rule.landing, value);
    setPendingBackgroundType(selection.pendingType);
    if (selection.draft !== rule.landing) onChange(selection.draft);
  }

  async function compareSaved() {
    if (!persistedRule || parentState.kind !== "ready" || comparison.kind === "loading") return;
    setComparison({ kind: "loading" });
    const targetBody = storedTarget(persistedRule, testStorefront);
    const base = { ...targetBody, appearance_schema: 2, lang: language };
    const [resolvedResponse, parentResponse] = await Promise.all([
      adminCall("appearance_rules_preview", base),
      adminCall("appearance_rules_preview", { ...base, exclude_rule_id: persistedRule.id }),
    ]);
    const resolved = decodeAppearancePreviewResponse(resolvedResponse);
    const parentPreview = decodeAppearancePreviewResponse(parentResponse);
    if (!resolved.ok || !parentPreview.ok || resolved.value.landing.schema !== 2 || parentPreview.value.landing.schema !== 2
      || resolved.value.landing_flat === null || resolved.value.landing_flat_sources === null
      || resolved.value.landing_flat_defaults === null
      || parentPreview.value.landing_flat === null || parentPreview.value.landing_flat_sources === null
      || parentPreview.value.landing_flat_defaults === null
      || JSON.stringify(resolved.value.landing_flat_defaults) !== JSON.stringify(parentPreview.value.landing_flat_defaults)) {
      setComparison({ kind: "error" });
      return;
    }
    const local = projectLocalizedFields(
      [persistedRule.landing, parentPreview.value.landing_flat],
      parentPreview.value.landing_flat_defaults,
      language,
    );
    setComparison({ kind: "ready", differences: compareAppearanceLandingWithPreview(local, resolved.value.landing, language) });
  }

  return (
    <div className="appearance-landing-composer field-full">
      <div className="appearance-landing-composer-fields">
        <ComposerSection title={t("background.title")} copy={t("background.copy")}>
          <SelectField
            label={t("background.type")}
            value={selectedBackgroundType}
            effective={pendingBackgroundType === null ? effective.background_type : metaEffective("background_type", effective.background_type)}
            effectiveLabel={metaEffective("background_type", effective.background_type)}
            disabled={disabled}
            inheritValue={inheritValue(effective.background_type)}
            options={[{ value: "image", label: t("background.image") }, { value: "video", label: t("background.video") }]}
            onChange={selectBackgroundType}
          />
          {pendingBackgroundType !== null && (
            <small className="field-hint field-full">{t("background.pendingUpload", { type: t(`background.${pendingBackgroundType}`) })}</small>
          )}
          {uploadBackgroundType === "video" ? (
            <VideoUploadField
              className="field-full"
              label={t("background.videoUpload")}
              value={rule.landing.background_url}
              poster={rule.landing.background_poster_url || effective.background_poster_url}
              disabled={disabled}
              hint={uploadHint("background_url", effective.background_url)}
              onBusyChange={onBusyChange}
              onChange={(url) => {
                setPendingBackgroundType(null);
                patchMany({ background_url: url, background_type: url === "" ? "" : "video" });
              }}
            />
          ) : (
            <ImageUploadField
              className="field-full"
              label={t("background.imageUpload")}
              value={rule.landing.background_url}
              disabled={disabled}
              hint={uploadHint("background_url", effective.background_url)}
              onBusyChange={onBusyChange}
              onChange={(url) => {
                setPendingBackgroundType(null);
                patchMany({ background_url: url, background_type: url === "" ? "" : "image" });
              }}
            />
          )}
          <ImageUploadField className="field-full" label={t("background.poster")} value={rule.landing.background_poster_url} disabled={disabled} hint={uploadHint("background_poster_url", effective.background_poster_url)} onBusyChange={onBusyChange} onChange={(url) => patch("background_poster_url", url)} />
          <ColorField label={t("background.overlayColor")} value={rule.landing.overlay_color} effective={effective.overlay_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("overlay_color", effective.overlay_color)} error={previewError("overlay_color")} onChange={(value) => patch("overlay_color", value)} />
          <RangeField label={t("background.overlayAlpha")} value={rule.landing.overlay_alpha} effective={effective.overlay_alpha} minimum={0} maximum={1} step={0.01} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("overlay_alpha", effective.overlay_alpha)} error={previewError("overlay_alpha")} onChange={(value) => patch("overlay_alpha", value)} />
        </ComposerSection>

        <ComposerSection title={t("title.title")} copy={t("title.copy")}>
          <SelectField
            label={t("title.type")}
            value={rule.landing.title_type}
            effective={effective.title_type}
            effectiveLabel={metaEffective("title_type", effective.title_type)}
            disabled={disabled}
            inheritValue={inheritValue(effective.title_type)}
            options={[{ value: "text", label: t("title.text") }, { value: "image", label: t("title.image") }, { value: "none", label: t("title.none") }]}
            onChange={(value) => patch("title_type", value)}
          />
          <TextField label={t("title.textEn")} value={rule.landing.title_text_en} effective={effective.title_text_en} maximum={80} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_text_en", effective.title_text_en)} onChange={(value) => patch("title_text_en", value)} />
          <TextField label={t("title.textHu")} value={rule.landing.title_text_hu} effective={effective.title_text_hu} maximum={80} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_text_hu", effective.title_text_hu)} onChange={(value) => patch("title_text_hu", value)} />
          <SelectField label={t("title.font")} value={rule.landing.title_font} effective={effective.title_font} effectiveLabel={metaEffective("title_font", effective.title_font)} disabled={disabled} inheritValue={inheritValue(t(`font.${effective.title_font as AppearanceLandingFont}`))} options={fontOptions} error={previewError("title_font")} onChange={(value) => patch("title_font", value)} />
          <RangeField label={t("title.size")} value={rule.landing.title_size} effective={effective.title_size} minimum={12} maximum={72} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_size", effective.title_size)} error={previewError("title_size")} onChange={(value) => patch("title_size", value)} />
          <ColorField label={t("title.color")} value={rule.landing.title_color} effective={effective.title_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_color", effective.title_color)} error={previewError("title_color")} onChange={(value) => patch("title_color", value)} />
          <SelectField label={t("title.align")} value={rule.landing.title_align} effective={effective.title_align} effectiveLabel={metaEffective("title_align", effective.title_align)} disabled={disabled} inheritValue={inheritValue(t(`align.${effective.title_align}`))} options={alignOptions} error={previewError("title_align")} onChange={(value) => patch("title_align", value)} />
          <ImageUploadField className="field-full" label={t("title.logo")} value={rule.landing.title_image_url} disabled={disabled} pngOnly hint={`${t("title.logoHint")} ${uploadHint("title_image_url", effective.title_image_url || "—")}`} onBusyChange={onBusyChange} onChange={(url) => onChange(appearanceLandingLogoSelection(rule.landing, url))} />
          {appearanceLandingLogoHintVisible(rule.landing, content.titleType) && (
            <small className="field-hint field-full">{t("title.logoTypeHint")}</small>
          )}
          <RangeField label={t("title.logoWidth")} value={rule.landing.title_image_width_percent} effective={effective.title_image_width_percent} minimum={20} maximum={100} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_image_width_percent", effective.title_image_width_percent)} error={previewError("title_image_width_percent")} onChange={(value) => patch("title_image_width_percent", value)} />
          <RangeField label={t("title.logoOffset")} value={rule.landing.title_image_offset_percent} effective={effective.title_image_offset_percent} minimum={-40} maximum={40} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("title_image_offset_percent", effective.title_image_offset_percent)} error={previewError("title_image_offset_percent")} onChange={(value) => patch("title_image_offset_percent", value)} />
        </ComposerSection>

        <ComposerSection title={t("subtitle.title")} copy={t("subtitle.copy")}>
          <TextField label={t("subtitle.textEn")} value={rule.landing.description_en} effective={effective.description_en} maximum={300} rows={3} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_en", effective.description_en)} onChange={(value) => patch("description_en", value)} />
          <TextField label={t("subtitle.textHu")} value={rule.landing.description_hu} effective={effective.description_hu} maximum={300} rows={3} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_hu", effective.description_hu)} onChange={(value) => patch("description_hu", value)} />
          <SelectField label={t("subtitle.font")} value={rule.landing.description_font} effective={effective.description_font} effectiveLabel={metaEffective("description_font", effective.description_font)} disabled={disabled} inheritValue={inheritValue(t(`font.${effective.description_font as AppearanceLandingFont}`))} options={fontOptions} error={previewError("description_font")} onChange={(value) => patch("description_font", value)} />
          <RangeField label={t("subtitle.size")} value={rule.landing.description_size} effective={effective.description_size} minimum={10} maximum={40} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_size", effective.description_size)} error={previewError("description_size")} onChange={(value) => patch("description_size", value)} />
          <ColorField label={t("subtitle.color")} value={rule.landing.description_color} effective={effective.description_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_color", effective.description_color)} error={previewError("description_color")} onChange={(value) => patch("description_color", value)} />
          <SelectField label={t("subtitle.align")} value={rule.landing.description_align} effective={effective.description_align} effectiveLabel={metaEffective("description_align", effective.description_align)} disabled={disabled} inheritValue={inheritValue(t(`align.${effective.description_align}`))} options={alignOptions} error={previewError("description_align")} onChange={(value) => patch("description_align", value)} />
          <ColorField label={t("subtitle.backdropColor")} value={rule.landing.description_backdrop_color} effective={effective.description_backdrop_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_backdrop_color", effective.description_backdrop_color)} error={previewError("description_backdrop_color")} onChange={(value) => patch("description_backdrop_color", value)} />
          <RangeField label={t("subtitle.backdropAlpha")} value={rule.landing.description_backdrop_alpha} effective={effective.description_backdrop_alpha} minimum={0} maximum={1} step={0.01} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("description_backdrop_alpha", effective.description_backdrop_alpha)} error={previewError("description_backdrop_alpha")} onChange={(value) => patch("description_backdrop_alpha", value)} />
        </ComposerSection>

        <ComposerSection title={t("buttons.title")} copy={t("buttons.copy")}>
          <RangeField label={t("buttons.radius")} value={rule.landing.button_corner_radius} effective={effective.button_corner_radius} minimum={0} maximum={32} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_corner_radius", effective.button_corner_radius)} error={previewError("button_corner_radius")} onChange={(value) => patch("button_corner_radius", value)} />
          <div className="field field-full appearance-landing-method-heading"><strong>{t("buttons.phone")}</strong></div>
          <TextField label={t("buttons.labelEn")} value={rule.landing.button_phone_label_en} effective={effective.button_phone_label_en} maximum={40} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_phone_label_en", effective.button_phone_label_en)} onChange={(value) => patch("button_phone_label_en", value)} />
          <TextField label={t("buttons.labelHu")} value={rule.landing.button_phone_label_hu} effective={effective.button_phone_label_hu} maximum={40} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_phone_label_hu", effective.button_phone_label_hu)} onChange={(value) => patch("button_phone_label_hu", value)} />
          <ColorField label={t("buttons.background")} value={rule.landing.button_phone_bg} effective={effective.button_phone_bg} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_phone_bg", effective.button_phone_bg)} error={previewError("button_phone_bg")} onChange={(value) => patch("button_phone_bg", value)} />
          <ColorField label={t("buttons.textColor")} value={rule.landing.button_phone_text_color} effective={effective.button_phone_text_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_phone_text_color", effective.button_phone_text_color)} error={previewError("button_phone_text_color")} onChange={(value) => patch("button_phone_text_color", value)} />
          <SelectField label={t("buttons.font")} value={rule.landing.button_phone_font} effective={effective.button_phone_font} effectiveLabel={metaEffective("button_phone_font", effective.button_phone_font)} disabled={disabled} inheritValue={inheritValue(t(`font.${effective.button_phone_font as AppearanceLandingFont}`))} options={fontOptions} error={previewError("button_phone_font")} onChange={(value) => patch("button_phone_font", value)} />
          <RangeField label={t("buttons.size")} value={rule.landing.button_phone_size} effective={effective.button_phone_size} minimum={12} maximum={24} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_phone_size", effective.button_phone_size)} error={previewError("button_phone_size")} onChange={(value) => patch("button_phone_size", value)} />
          <div className="field field-full appearance-landing-method-heading"><strong>{t("buttons.email")}</strong></div>
          <TextField label={t("buttons.labelEn")} value={rule.landing.button_email_label_en} effective={effective.button_email_label_en} maximum={40} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_email_label_en", effective.button_email_label_en)} onChange={(value) => patch("button_email_label_en", value)} />
          <TextField label={t("buttons.labelHu")} value={rule.landing.button_email_label_hu} effective={effective.button_email_label_hu} maximum={40} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_email_label_hu", effective.button_email_label_hu)} onChange={(value) => patch("button_email_label_hu", value)} />
          <ColorField label={t("buttons.background")} value={rule.landing.button_email_bg} effective={effective.button_email_bg} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_email_bg", effective.button_email_bg)} error={previewError("button_email_bg")} onChange={(value) => patch("button_email_bg", value)} />
          <ColorField label={t("buttons.textColor")} value={rule.landing.button_email_text_color} effective={effective.button_email_text_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_email_text_color", effective.button_email_text_color)} error={previewError("button_email_text_color")} onChange={(value) => patch("button_email_text_color", value)} />
          <SelectField label={t("buttons.font")} value={rule.landing.button_email_font} effective={effective.button_email_font} effectiveLabel={metaEffective("button_email_font", effective.button_email_font)} disabled={disabled} inheritValue={inheritValue(t(`font.${effective.button_email_font as AppearanceLandingFont}`))} options={fontOptions} error={previewError("button_email_font")} onChange={(value) => patch("button_email_font", value)} />
          <RangeField label={t("buttons.size")} value={rule.landing.button_email_size} effective={effective.button_email_size} minimum={12} maximum={24} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("button_email_size", effective.button_email_size)} error={previewError("button_email_size")} onChange={(value) => patch("button_email_size", value)} />
          <SelectField
            label={t("buttons.apple")}
            value={rule.landing.button_apple_style}
            effective={effective.button_apple_style}
            effectiveLabel={metaEffective("button_apple_style", effective.button_apple_style)}
            disabled={disabled}
            inheritValue={inheritValue(t(`apple.${effective.button_apple_style}`))}
            options={APPEARANCE_LANDING_APPLE_STYLES.map((style) => ({ value: style, label: t(`apple.${style}`) }))}
            error={previewError("button_apple_style")}
            onChange={(value) => patch("button_apple_style", value)}
          />
        </ComposerSection>

        <ComposerSection title={t("footer.title")} copy={t("footer.copy")}>
          <TextField label={t("footer.textEn")} value={rule.landing.footer_text_en} effective={effective.footer_text_en} maximum={300} rows={4} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_text_en", effective.footer_text_en)} onChange={(value) => patch("footer_text_en", value)} />
          <TextField label={t("footer.textHu")} value={rule.landing.footer_text_hu} effective={effective.footer_text_hu} maximum={300} rows={4} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_text_hu", effective.footer_text_hu)} onChange={(value) => patch("footer_text_hu", value)} />
          <ColorField label={t("footer.background")} value={rule.landing.footer_bg_color} effective={effective.footer_bg_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_bg_color", effective.footer_bg_color)} error={previewError("footer_bg_color")} onChange={(value) => patch("footer_bg_color", value)} />
          <RangeField label={t("footer.alpha")} value={rule.landing.footer_bg_alpha} effective={effective.footer_bg_alpha} minimum={0} maximum={1} step={0.01} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_bg_alpha", effective.footer_bg_alpha)} error={previewError("footer_bg_alpha")} onChange={(value) => patch("footer_bg_alpha", value)} />
          <ColorField label={t("footer.textColor")} value={rule.landing.footer_text_color} effective={effective.footer_text_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_text_color", effective.footer_text_color)} error={previewError("footer_text_color")} onChange={(value) => patch("footer_text_color", value)} />
          <SelectField label={t("footer.font")} value={rule.landing.footer_font} effective={effective.footer_font} effectiveLabel={metaEffective("footer_font", effective.footer_font)} disabled={disabled} inheritValue={inheritValue(t(`font.${effective.footer_font as AppearanceLandingFont}`))} options={fontOptions} error={previewError("footer_font")} onChange={(value) => patch("footer_font", value)} />
          <RangeField label={t("footer.size")} value={rule.landing.footer_size} effective={effective.footer_size} minimum={10} maximum={18} step={1} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("footer_size", effective.footer_size)} error={previewError("footer_size")} onChange={(value) => patch("footer_size", value)} />
        </ComposerSection>

        <ComposerSection title={t("qr.title")} copy={t("qr.copy")}>
          <SelectField
            label={t("qr.enabled")}
            value={rule.landing.qr_enabled}
            effective={effective.qr_enabled}
            effectiveLabel={metaEffective("qr_enabled", effective.qr_enabled)}
            disabled={disabled}
            inheritValue={inheritValue(t(effective.qr_enabled === "true" ? "qr.on" : "qr.off"))}
            options={[{ value: "true", label: t("qr.on") }, { value: "false", label: t("qr.off") }]}
            onChange={(value) => patch("qr_enabled", value)}
          />
          <ColorField label={t("qr.background")} value={rule.landing.qr_bg_color} effective={effective.qr_bg_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("qr_bg_color", effective.qr_bg_color)} error={previewError("qr_bg_color")} onChange={(value) => patch("qr_bg_color", value)} />
          <ColorField label={t("qr.icon")} value={rule.landing.qr_icon_color} effective={effective.qr_icon_color} disabled={disabled} inheritLabel={inheritLabel} effectiveLabel={metaEffective("qr_icon_color", effective.qr_icon_color)} error={previewError("qr_icon_color")} onChange={(value) => patch("qr_icon_color", value)} />
        </ComposerSection>
      </div>

      <aside className="appearance-landing-preview-column">
        <div className="appearance-landing-preview-toolbar" aria-label={t("preview.controls")}>
          <div className="segmented-control">
            {(["en", "hu"] as const).map((entry) => <button type="button" key={entry} className={language === entry ? "active" : ""} onClick={() => setLanguage(entry)}>{t(`preview.language.${entry}`)}</button>)}
          </div>
          <div className="segmented-control">
            {(["light", "dark"] as const).map((entry) => <button type="button" key={entry} className={paletteMode === entry ? "active" : ""} onClick={() => setPaletteMode(entry)}>{t(`preview.palette.${entry}`)}</button>)}
          </div>
          <div className="segmented-control appearance-landing-auth-toggle">
            {(["both", "phone", "email"] as const).map((entry) => <button type="button" key={entry} className={authMethods === entry ? "active" : ""} onClick={() => setAuthMethods(entry)}>{t(`preview.auth.${entry}`)}</button>)}
          </div>
          {rule.scope === "geo" && (
            <label className="appearance-landing-preview-storefront">
              <span>{t("preview.testStorefront")}</span>
              <select value={testStorefront} onChange={(event) => setTestStorefront(event.target.value)}>
                <option value="">{t("preview.storefrontNone")}</option>
                {countries.map((country) => (
                  <option key={country.alpha3} value={country.alpha3}>{country.name} · {country.alpha3}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {parentState.kind === "loading" && <div className="alert alert-info">{t("preview.parentLoading")}</div>}
        {parentState.kind === "waiting" && <div className="alert alert-info">{t("preview.targetNeeded")}</div>}
        {parentState.kind === "error" && (
          <div className="alert alert-error appearance-landing-parent-error">
            <span>{t("preview.parentError")}</span>
            <button type="button" className="button button-secondary button-small" onClick={() => setParentReload((value) => value + 1)}>{t("preview.retry")}</button>
          </div>
        )}
        {parentState.kind !== "ready" && (
          <div className="alert alert-warning">{t("preview.approximate")}</div>
        )}
        <div className="appearance-landing-preview-scroll">
          <AppearanceLandingPreview
            content={content}
            fallbackLabel={t("preview.builtInBackground")}
            palette={previewPalette[paletteMode]}
            paletteMode={paletteMode}
            authMethods={authMethods}
            labels={{ apple: t("preview.apple"), divider: t("preview.divider"), qr: t("preview.qr") }}
          />
        </div>
        <div className="appearance-landing-core-compare">
          <button type="button" className="button button-secondary" disabled={!persistedRule || parentState.kind !== "ready" || comparison.kind === "loading"} onClick={() => void compareSaved()}>
            {comparison.kind === "loading" ? t("compare.running") : t("compare.run")}
          </button>
          <small>{!persistedRule ? t("compare.saveFirst") : parentState.kind !== "ready" ? t("compare.parentUnavailable") : t("compare.savedOnly")}</small>
          {comparison.kind === "error" && <div className="alert alert-error">{t("compare.error")}</div>}
          {comparison.kind === "ready" && comparison.differences.length === 0 && <div className="alert alert-success">{t("compare.same")}</div>}
          {comparison.kind === "ready" && comparison.differences.length > 0 && (
            <div className="alert alert-warning">
              <strong>{t("compare.differences", { count: comparison.differences.length })}</strong>
              <ul>
                {comparison.differences.map((difference) => (
                  <li key={difference.field}>
                    <code>{difference.field}</code>
                    <span>{t("compare.local")}: {difference.local || "—"}</span>
                    <span>{t("compare.core")}: {difference.core || "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

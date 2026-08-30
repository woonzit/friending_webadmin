"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AppearanceHeroEditor from "@/components/AppearanceHeroEditor";
import AppearanceLandingComposer from "@/components/AppearanceLandingComposer";
import AppearanceMapPicker from "@/components/AppearanceMapPicker";
import AppearancePaletteEditor from "@/components/AppearancePaletteEditor";
import {
  MAX_APPEARANCE_NAME_LENGTH,
  MAX_APPEARANCE_PLACE_LABEL_LENGTH,
  MAX_APPEARANCE_PRIORITY,
  MAX_APPEARANCE_RADIUS_KM,
  MIN_APPEARANCE_RADIUS_KM,
  appearanceLandingDraft,
  appearanceTimestampFromLocalInput,
  appearanceTimestampToLocalInput,
  resolveAppearanceHero,
  resolveAppearanceLandingFields,
  resolveAppearancePalette,
  type AppearanceFullPalette,
  type AppearanceLandingDraft,
  type AppearanceRule,
  type AppearanceRuleDraft,
  type AppearanceScope,
  type LocalizedAppearanceCountry,
} from "@/lib/appearanceRules";

type Props = {
  value: AppearanceRuleDraft;
  persistedRule: AppearanceRule | null;
  /** The global rule this draft inherits from; null for the global rule itself or when none exists yet. */
  globalRule: AppearanceRule | null;
  defaults: { palette: AppearanceFullPalette; landing: AppearanceLandingDraft };
  countries: readonly LocalizedAppearanceCountry[];
  busy: boolean;
  /** An unproven write is pending: saving is withheld until the operator reloads. */
  uncertain: boolean;
  error: string;
  onChange: (value: AppearanceRuleDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onReload: () => void;
};

type UploadField = "landing" | "hero";

function SectionHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="field-full appearance-section-heading">
      <h3>{title}</h3>
      <small className="field-hint">{copy}</small>
    </div>
  );
}

/**
 * One rule end to end: targeting, active window, landing content, hero
 * carousel and palette, with the inheritance previews resolved against the
 * global rule and the compiled defaults. The page owns the draft and the save.
 */
export default function AppearanceRuleEditor({
  value,
  persistedRule,
  globalRule,
  defaults,
  countries,
  busy,
  uncertain,
  error,
  onChange,
  onClose,
  onSave,
  onReload,
}: Props) {
  const t = useTranslations("appearance.editor");
  const common = useTranslations("common");
  const locale = useLocale();
  const language: "en" | "hu" = locale === "hu" ? "hu" : "en";
  const [uploading, setUploading] = useState<UploadField | null>(null);
  const [windowError, setWindowError] = useState<"starts" | "ends" | null>(null);
  const locked = busy || uploading !== null;
  const isPersistedGlobal = value.id !== "" && value.scope === "global";
  const globalExists = globalRule !== null;

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [locked, onClose]);

  const inheritedChain = useMemo(() => (value.scope === "global" || !globalRule ? [] : [globalRule]), [value.scope, globalRule]);
  const inheritedLanding = useMemo(
    () => resolveAppearanceLandingFields(inheritedChain.map((rule) => rule.landing), appearanceLandingDraft({})),
    [inheritedChain],
  );
  const palettePreview = useMemo(
    () => resolveAppearancePalette([value.palette, ...inheritedChain.map((rule) => rule.palette)], defaults.palette),
    [value.palette, inheritedChain, defaults.palette],
  );
  const inheritedHeroItems = useMemo(() => resolveAppearanceHero(inheritedChain.map((rule) => rule.hero)), [inheritedChain]);
  const center = useMemo(() => {
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    return value.latitude.trim() !== "" && value.longitude.trim() !== "" && Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      ? { latitude, longitude }
      : null;
  }, [value.latitude, value.longitude]);
  const radiusKm = useMemo(() => {
    const radius = Number(value.radius_km);
    return value.radius_km.trim() !== "" && Number.isFinite(radius) && radius >= MIN_APPEARANCE_RADIUS_KM && radius <= MAX_APPEARANCE_RADIUS_KM ? radius : null;
  }, [value.radius_km]);

  function patch(next: Partial<AppearanceRuleDraft>) {
    onChange({ ...value, ...next });
  }

  function setScope(scope: AppearanceScope) {
    patch({
      scope,
      storefront_country: scope === "storefront" ? value.storefront_country : "",
      country_code: scope === "geo" ? value.country_code : "",
      latitude: scope === "geo" ? value.latitude : "",
      longitude: scope === "geo" ? value.longitude : "",
      radius_km: scope === "geo" ? value.radius_km : "",
      place_label: scope === "geo" ? value.place_label : "",
    });
  }

  function setWindow(field: "starts_at" | "ends_at", raw: string) {
    const converted = appearanceTimestampFromLocalInput(raw);
    if (converted === undefined) {
      setWindowError(field === "starts_at" ? "starts" : "ends");
      return;
    }
    setWindowError(null);
    patch({ [field]: converted });
  }

  const scopeOptions: AppearanceScope[] = isPersistedGlobal ? ["global"] : globalExists ? ["storefront", "geo"] : ["global", "storefront", "geo"];

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section className="dialog dialog-wide appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-dialog-title">
        <div className="dialog-header">
          <h2 id="appearance-dialog-title">{value.id ? t("editTitle") : t("createTitle")}</h2>
          <button className="dialog-close" onClick={onClose} disabled={locked} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <SectionHeading title={t("targetingTitle")} copy={t("targetingCopy")} />
          <label className="field">
            <span>{t("name")}</span>
            <input
              value={value.name}
              maxLength={MAX_APPEARANCE_NAME_LENGTH}
              autoFocus
              disabled={locked}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={t("namePlaceholder")}
            />
          </label>
          <label className="field">
            <span>{t("scopeLabel")}</span>
            <select value={value.scope} disabled={locked || isPersistedGlobal} onChange={(event) => setScope(event.target.value as AppearanceScope)}>
              {scopeOptions.map((scope) => (
                <option key={scope} value={scope}>{t(`scopeOption.${scope}`)}</option>
              ))}
            </select>
            <small className="field-hint">{isPersistedGlobal ? t("globalScopeLocked") : t(`scopeHint.${value.scope}`)}</small>
          </label>

          {value.scope === "storefront" && (
            <label className="field field-full">
              <span>{t("storefront")}</span>
              <select value={value.storefront_country} disabled={locked} aria-invalid={!value.storefront_country} onChange={(event) => patch({ storefront_country: event.target.value })}>
                <option value="">{t("storefrontPlaceholder")}</option>
                {countries.map((country) => (
                  <option key={country.alpha3} value={country.alpha3}>{country.name} · {country.alpha3}</option>
                ))}
              </select>
              <small className="field-hint">{t("storefrontHint")}</small>
            </label>
          )}

          {value.scope === "geo" && (
            <>
              <label className="field">
                <span>{t("placeLabel")}</span>
                <input
                  value={value.place_label}
                  maxLength={MAX_APPEARANCE_PLACE_LABEL_LENGTH}
                  disabled={locked}
                  onChange={(event) => patch({ place_label: event.target.value })}
                  placeholder={t("placeLabelPlaceholder")}
                />
                <small className="field-hint">{t("placeLabelHint")}</small>
              </label>
              <label className="field">
                <span>{t("countryCode")}</span>
                <select value={value.country_code} disabled={locked} onChange={(event) => patch({ country_code: event.target.value })}>
                  <option value="">{t("countryCodeNone")}</option>
                  {countries.map((country) => (
                    <option key={country.alpha2} value={country.alpha2}>{country.name} · {country.alpha2}</option>
                  ))}
                </select>
                <small className="field-hint">{t("countryCodeHint")}</small>
              </label>
              <label className="field">
                <span>{t("latitude")}</span>
                <input type="number" min={-90} max={90} step="0.000001" value={value.latitude} disabled={locked} onChange={(event) => patch({ latitude: event.target.value })} placeholder="47.497900" />
              </label>
              <label className="field">
                <span>{t("longitude")}</span>
                <input type="number" min={-180} max={180} step="0.000001" value={value.longitude} disabled={locked} onChange={(event) => patch({ longitude: event.target.value })} placeholder="19.040200" />
              </label>
              <label className="field">
                <span>{t("radius")}</span>
                <input type="number" min={MIN_APPEARANCE_RADIUS_KM} max={MAX_APPEARANCE_RADIUS_KM} step="1" value={value.radius_km} disabled={locked} onChange={(event) => patch({ radius_km: event.target.value })} placeholder="25" />
                <small className="field-hint">{t("radiusHint")}</small>
              </label>
              <AppearanceMapPicker
                center={center}
                radiusKm={radiusKm}
                language={language}
                disabled={locked}
                onMove={(moved) => patch({ latitude: String(moved.latitude), longitude: String(moved.longitude) })}
                onCandidate={(candidate) => patch({
                  place_label: candidate.place_label,
                  country_code: candidate.country_code,
                  latitude: String(candidate.center.latitude),
                  longitude: String(candidate.center.longitude),
                  radius_km: String(candidate.radius_km),
                })}
              />
            </>
          )}

          <label className="field">
            <span>{t("priority")}</span>
            <input
              type="number"
              min={0}
              max={MAX_APPEARANCE_PRIORITY}
              value={value.priority}
              disabled={locked}
              onChange={(event) => patch({ priority: Math.max(0, Math.min(MAX_APPEARANCE_PRIORITY, Math.trunc(Number(event.target.value) || 0))) })}
            />
            <small className="field-hint">{t("priorityHint")}</small>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={value.active} disabled={locked} onChange={(event) => patch({ active: event.target.checked })} />
            <span>{t("isActive")}</span>
          </label>
          <label className="field">
            <span>{t("startsAt")}</span>
            <input type="datetime-local" value={appearanceTimestampToLocalInput(value.starts_at)} disabled={locked} aria-invalid={windowError === "starts"} onChange={(event) => setWindow("starts_at", event.target.value)} />
            <small className="field-hint">{t("windowHint")}</small>
          </label>
          <label className="field">
            <span>{t("endsAt")}</span>
            <input type="datetime-local" value={appearanceTimestampToLocalInput(value.ends_at)} disabled={locked} aria-invalid={windowError === "ends"} onChange={(event) => setWindow("ends_at", event.target.value)} />
            <small className="field-hint">{value.starts_at || value.ends_at ? t("windowUtc", { starts: value.starts_at ?? "—", ends: value.ends_at ?? "—" }) : t("windowAlways")}</small>
          </label>

          <SectionHeading title={t("landingTitle")} copy={value.scope === "global" ? t("landingCopyGlobal") : t("landingCopyOverride")} />
          <AppearanceLandingComposer
            rule={value}
            persistedRule={persistedRule}
            inherited={inheritedLanding}
            defaults={defaults.landing}
            palette={palettePreview.values}
            countries={countries}
            disabled={locked}
            onBusyChange={(isBusy) => setUploading(isBusy ? "landing" : null)}
            onChange={(landing) => onChange({ ...value, landing })}
          />

          <SectionHeading title={t("heroTitle")} copy={t("heroCopy")} />
          <AppearanceHeroEditor
            value={value.hero}
            inheritedItems={inheritedHeroItems}
            isGlobal={value.scope === "global"}
            disabled={locked}
            onChange={(hero) => patch({ hero })}
            onBusyChange={(isBusy) => setUploading(isBusy ? "hero" : null)}
          />

          <SectionHeading title={t("paletteTitle")} copy={value.scope === "global" ? t("paletteCopyGlobal") : t("paletteCopyOverride")} />
          <AppearancePaletteEditor
            value={value.palette}
            inherited={inheritedChain.map((rule) => rule.palette)}
            defaults={defaults.palette}
            disabled={locked}
            onChange={(palette) => patch({ palette })}
          />

          {(error || windowError) && (
            <div className="alert alert-error field-full" role="alert">{error || t("windowInvalid")}</div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} disabled={locked}>{common("cancel")}</button>
          {uncertain ? (
            <button className="button button-primary" onClick={onReload} disabled={locked}>
              {busy ? common("loading") : t("reloadList")}
            </button>
          ) : (
            <button className="button button-primary" onClick={onSave} disabled={locked}>
              {busy ? common("saving") : common("save")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

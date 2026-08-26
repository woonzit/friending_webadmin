"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import ImageUploadField from "@/components/ImageUploadField";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import VideoUploadField from "@/components/VideoUploadField";
import { adminCall } from "@/lib/adminClient";
import {
  isHttpsUrl,
  isIsoCountryCode,
  isValidLatitude,
  isValidLongitude,
} from "@/lib/format";

type LandingScope = "fallback" | "global" | "country" | "city";
type LandingBackgroundMode = "none" | "image" | "video";

type LandingRule = {
  id: string;
  name: string;
  scope: LandingScope;
  country_code: string;
  city_name: string;
  latitude: number | null;
  longitude: number | null;
  radius_miles: number;
  background_mode: LandingBackgroundMode;
  desktop_image_url: string;
  tablet_image_url: string;
  mobile_image_url: string;
  desktop_video_url: string;
  tablet_video_url: string;
  mobile_video_url: string;
  desktop_overlay_color: string;
  desktop_overlay_intensity: number;
  tablet_overlay_override: boolean;
  tablet_overlay_color: string;
  tablet_overlay_intensity: number;
  mobile_overlay_override: boolean;
  mobile_overlay_color: string;
  mobile_overlay_intensity: number;
  desktop_auth_card_color: string;
  desktop_auth_card_intensity: number;
  tablet_auth_card_override: boolean;
  tablet_auth_card_color: string;
  tablet_auth_card_intensity: number;
  mobile_auth_card_override: boolean;
  mobile_auth_card_color: string;
  mobile_auth_card_intensity: number;
  priority: number;
  active: boolean;
  is_fallback: boolean;
  created_at: number;
  updated_at: number;
};

const EMPTY_RULE: LandingRule = {
  id: "",
  name: "",
  scope: "global",
  country_code: "",
  city_name: "",
  latitude: null,
  longitude: null,
  radius_miles: 40,
  background_mode: "image",
  desktop_image_url: "",
  tablet_image_url: "",
  mobile_image_url: "",
  desktop_video_url: "",
  tablet_video_url: "",
  mobile_video_url: "",
  desktop_overlay_color: "#117097",
  desktop_overlay_intensity: 95,
  tablet_overlay_override: false,
  tablet_overlay_color: "#117097",
  tablet_overlay_intensity: 95,
  mobile_overlay_override: false,
  mobile_overlay_color: "#117097",
  mobile_overlay_intensity: 95,
  desktop_auth_card_color: "#080B10",
  desktop_auth_card_intensity: 72,
  tablet_auth_card_override: false,
  tablet_auth_card_color: "#080B10",
  tablet_auth_card_intensity: 72,
  mobile_auth_card_override: false,
  mobile_auth_card_color: "#080B10",
  mobile_auth_card_intensity: 72,
  priority: 0,
  active: true,
  is_fallback: false,
  created_at: 0,
  updated_at: 0,
};

const EMPTY_FALLBACK_RULE: LandingRule = {
  ...EMPTY_RULE,
  id: "builtin-no-image",
  name: "Default without image",
  scope: "fallback",
  is_fallback: true,
};

const HEX_COLOR = /^#[0-9A-F]{6}$/;

function isHttpsVideoUrl(value: string, optional = false): boolean {
  if (optional && value === "") return true;
  if (!isHttpsUrl(value)) return false;
  try {
    return /\.(?:mp4|webm)$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function normalizeRule(value: Partial<LandingRule>): LandingRule {
  const isFallback = value.scope === "fallback" || value.is_fallback === true;
  const backgroundMode: LandingBackgroundMode = isFallback
    ? "none"
    : value.background_mode === "video" || (
      value.background_mode !== "image"
      && typeof value.desktop_video_url === "string"
      && value.desktop_video_url !== ""
    )
      ? "video"
      : "image";
  const desktopColor = typeof value.desktop_overlay_color === "string"
    && HEX_COLOR.test(value.desktop_overlay_color.toUpperCase())
    ? value.desktop_overlay_color.toUpperCase()
    : EMPTY_RULE.desktop_overlay_color;
  const desktopIntensity = Number.isInteger(value.desktop_overlay_intensity)
    && Number(value.desktop_overlay_intensity) >= 0
    && Number(value.desktop_overlay_intensity) <= 100
    ? Number(value.desktop_overlay_intensity)
    : EMPTY_RULE.desktop_overlay_intensity;
  const desktopAuthCardColor = typeof value.desktop_auth_card_color === "string"
    && HEX_COLOR.test(value.desktop_auth_card_color.toUpperCase())
    ? value.desktop_auth_card_color.toUpperCase()
    : EMPTY_RULE.desktop_auth_card_color;
  const desktopAuthCardIntensity = Number.isInteger(value.desktop_auth_card_intensity)
    && Number(value.desktop_auth_card_intensity) >= 0
    && Number(value.desktop_auth_card_intensity) <= 100
    ? Number(value.desktop_auth_card_intensity)
    : EMPTY_RULE.desktop_auth_card_intensity;
  const normalized = {
    ...EMPTY_RULE,
    ...value,
    background_mode: backgroundMode,
    desktop_overlay_color: desktopColor,
    desktop_overlay_intensity: desktopIntensity,
    tablet_overlay_override: value.tablet_overlay_override === true,
    tablet_overlay_color: typeof value.tablet_overlay_color === "string"
      && HEX_COLOR.test(value.tablet_overlay_color.toUpperCase())
      ? value.tablet_overlay_color.toUpperCase()
      : desktopColor,
    tablet_overlay_intensity: Number.isInteger(value.tablet_overlay_intensity)
      && Number(value.tablet_overlay_intensity) >= 0
      && Number(value.tablet_overlay_intensity) <= 100
      ? Number(value.tablet_overlay_intensity)
      : desktopIntensity,
    mobile_overlay_override: value.mobile_overlay_override === true,
    mobile_overlay_color: typeof value.mobile_overlay_color === "string"
      && HEX_COLOR.test(value.mobile_overlay_color.toUpperCase())
      ? value.mobile_overlay_color.toUpperCase()
      : desktopColor,
    mobile_overlay_intensity: Number.isInteger(value.mobile_overlay_intensity)
      && Number(value.mobile_overlay_intensity) >= 0
      && Number(value.mobile_overlay_intensity) <= 100
      ? Number(value.mobile_overlay_intensity)
      : desktopIntensity,
    desktop_auth_card_color: desktopAuthCardColor,
    desktop_auth_card_intensity: desktopAuthCardIntensity,
    tablet_auth_card_override: value.tablet_auth_card_override === true,
    tablet_auth_card_color: typeof value.tablet_auth_card_color === "string"
      && HEX_COLOR.test(value.tablet_auth_card_color.toUpperCase())
      ? value.tablet_auth_card_color.toUpperCase()
      : desktopAuthCardColor,
    tablet_auth_card_intensity: Number.isInteger(value.tablet_auth_card_intensity)
      && Number(value.tablet_auth_card_intensity) >= 0
      && Number(value.tablet_auth_card_intensity) <= 100
      ? Number(value.tablet_auth_card_intensity)
      : desktopAuthCardIntensity,
    mobile_auth_card_override: value.mobile_auth_card_override === true,
    mobile_auth_card_color: typeof value.mobile_auth_card_color === "string"
      && HEX_COLOR.test(value.mobile_auth_card_color.toUpperCase())
      ? value.mobile_auth_card_color.toUpperCase()
      : desktopAuthCardColor,
    mobile_auth_card_intensity: Number.isInteger(value.mobile_auth_card_intensity)
      && Number(value.mobile_auth_card_intensity) >= 0
      && Number(value.mobile_auth_card_intensity) <= 100
      ? Number(value.mobile_auth_card_intensity)
      : desktopAuthCardIntensity,
  };
  return isFallback ? {
    ...normalized,
    name: EMPTY_FALLBACK_RULE.name,
    scope: "fallback",
    country_code: "",
    city_name: "",
    latitude: null,
    longitude: null,
    desktop_image_url: "",
    tablet_image_url: "",
    mobile_image_url: "",
    desktop_video_url: "",
    tablet_video_url: "",
    mobile_video_url: "",
    background_mode: "none",
    priority: 0,
    active: true,
    is_fallback: true,
  } : normalized;
}

function landingGradient(color: string, intensity: number, endStop = 80): string {
  const normalized = HEX_COLOR.test(color.toUpperCase()) ? color.toUpperCase() : "#117097";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const strength = Math.max(0, Math.min(100, intensity)) / 100;
  return `linear-gradient(180deg, transparent 30%, rgba(${red}, ${green}, ${blue}, ${strength}) ${endStop}%)`;
}

function translucentColor(color: string, intensity: number): string {
  const normalized = HEX_COLOR.test(color.toUpperCase()) ? color.toUpperCase() : "#080B10";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const strength = Math.max(0, Math.min(100, intensity)) / 100;
  return `rgba(${red}, ${green}, ${blue}, ${strength})`;
}

function DevicePreview({
  label,
  mode,
  url,
  posterUrl,
  ratio,
  fallbackLabel,
  overlayColor,
  overlayIntensity,
  gradientEndStop,
  authCardColor,
  authCardIntensity,
  imageFree = false,
}: {
  label: string;
  mode: LandingBackgroundMode;
  url: string;
  posterUrl?: string;
  ratio: string;
  fallbackLabel: string;
  overlayColor: string;
  overlayIntensity: number;
  gradientEndStop: number;
  authCardColor: string;
  authCardIntensity: number;
  imageFree?: boolean;
}) {
  return (
    <div className="landing-device-preview">
      <span>{label}</span>
      <div className={imageFree ? "is-image-free" : undefined} style={{ aspectRatio: ratio }}>
        {mode === "video" && isHttpsVideoUrl(url) ? (
          <video
            src={url}
            poster={isHttpsUrl(posterUrl ?? "") ? posterUrl : undefined}
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
          />
        ) : mode === "image" && isHttpsUrl(url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" />
        ) : (
          <small>{fallbackLabel}</small>
        )}
        <div
          className="landing-preview-overlay"
          style={{ background: landingGradient(overlayColor, overlayIntensity, gradientEndStop) }}
          aria-hidden="true"
        />
        <div
          className="landing-preview-auth-card"
          style={{ background: translucentColor(authCardColor, authCardIntensity) }}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

function OverlayValueFields({
  title,
  color,
  intensity,
  disabled,
  colorLabel,
  intensityLabel,
  onColorChange,
  onIntensityChange,
}: {
  title: string;
  color: string;
  intensity: number;
  disabled: boolean;
  colorLabel: string;
  intensityLabel: string;
  onColorChange: (color: string) => void;
  onIntensityChange: (intensity: number) => void;
}) {
  return (
    <div className="landing-overlay-value-fields">
      <strong>{title}</strong>
      <label className="field">
        <span>{colorLabel}</span>
        <div className="landing-color-control">
          <input
            type="color"
            value={HEX_COLOR.test(color.toUpperCase()) ? color : "#117097"}
            disabled={disabled}
            onChange={(event) => onColorChange(event.target.value.toUpperCase())}
          />
          <input
            type="text"
            value={color}
            maxLength={7}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => onColorChange(event.target.value.toUpperCase())}
          />
        </div>
      </label>
      <label className="field landing-intensity-field">
        <span>{intensityLabel} <output>{intensity}%</output></span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={intensity}
          disabled={disabled}
          onChange={(event) => onIntensityChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}

function LandingDialog({
  value,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: LandingRule;
  busy: boolean;
  error: string;
  onChange: (value: LandingRule) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("landing");
  const common = useTranslations("common");
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const locked = busy || uploadingField !== null;
  const isFallback = value.scope === "fallback";

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [locked, onClose]);

  const desktopPreview = value.background_mode === "video"
    ? value.desktop_video_url
    : value.desktop_image_url;
  const tabletPreview = value.background_mode === "video"
    ? value.tablet_video_url || value.desktop_video_url
    : value.tablet_image_url || value.desktop_image_url;
  const mobilePreview = value.background_mode === "video"
    ? value.mobile_video_url || value.desktop_video_url
    : value.mobile_image_url || value.desktop_image_url;
  const tabletPoster = value.tablet_image_url || value.desktop_image_url;
  const mobilePoster = value.mobile_image_url || value.desktop_image_url;
  const tabletOverlayColor = value.tablet_overlay_override
    ? value.tablet_overlay_color
    : value.desktop_overlay_color;
  const tabletOverlayIntensity = value.tablet_overlay_override
    ? value.tablet_overlay_intensity
    : value.desktop_overlay_intensity;
  const mobileOverlayColor = value.mobile_overlay_override
    ? value.mobile_overlay_color
    : value.desktop_overlay_color;
  const mobileOverlayIntensity = value.mobile_overlay_override
    ? value.mobile_overlay_intensity
    : value.desktop_overlay_intensity;
  const tabletAuthCardColor = value.tablet_auth_card_override
    ? value.tablet_auth_card_color
    : value.desktop_auth_card_color;
  const tabletAuthCardIntensity = value.tablet_auth_card_override
    ? value.tablet_auth_card_intensity
    : value.desktop_auth_card_intensity;
  const mobileAuthCardColor = value.mobile_auth_card_override
    ? value.mobile_auth_card_color
    : value.desktop_auth_card_color;
  const mobileAuthCardIntensity = value.mobile_auth_card_override
    ? value.mobile_auth_card_intensity
    : value.desktop_auth_card_intensity;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="landing-dialog-title">
        <div className="dialog-header">
          <h2 id="landing-dialog-title">
            {isFallback ? t("fallbackEditTitle") : value.id ? t("editTitle") : t("createTitle")}
          </h2>
          <button className="dialog-close" onClick={onClose} disabled={locked} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          {isFallback && (
            <div className="landing-fallback-intro field-full">
              <span className="badge badge-active">{t("fallbackBadge")}</span>
              <div>
                <strong>{t("fallbackName")}</strong>
                <p>{t("fallbackDescription")}</p>
              </div>
            </div>
          )}
          {!isFallback && <label className="field">
            <span>{t("name")}</span>
            <input
              value={value.name}
              maxLength={80}
              autoFocus
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder={t("namePlaceholder")}
            />
          </label>}
          {!isFallback && <label className="field">
            <span>{t("scope")}</span>
            <select
              value={value.scope}
              onChange={(event) => {
                const scope = event.target.value as LandingScope;
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
          </label>}

          {!isFallback && value.scope !== "global" && (
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
          {!isFallback && <label className="field">
            <span>{t("priority")}</span>
            <input
              type="number"
              min="0"
              max="10000"
              value={value.priority}
              onChange={(event) => onChange({ ...value, priority: Number(event.target.value) || 0 })}
            />
            <small className="field-hint">{t("priorityHint")}</small>
          </label>}

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

          {!isFallback && (
            <>
              <fieldset className="landing-media-options field-full">
                <legend>{t("mediaType")}</legend>
                <label>
                  <input
                    type="radio"
                    name="landing-background-mode"
                    value="image"
                    checked={value.background_mode === "image"}
                    disabled={locked}
                    onChange={() => onChange({ ...value, background_mode: "image" })}
                  />
                  <span>{t("mediaImage")}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="landing-background-mode"
                    value="video"
                    checked={value.background_mode === "video"}
                    disabled={locked}
                    onChange={() => onChange({ ...value, background_mode: "video" })}
                  />
                  <span>{t("mediaVideo")}</span>
                </label>
              </fieldset>
              {value.background_mode === "video" ? (
                <>
                  <VideoUploadField
                    className="field-full"
                    label={t("desktopVideo")}
                    value={value.desktop_video_url}
                    poster={value.desktop_image_url}
                    required
                    disabled={locked}
                    hint={t("desktopVideoHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "desktop-video" : null)}
                    onChange={(url) => onChange({ ...value, desktop_video_url: url })}
                  />
                  <VideoUploadField
                    label={t("tabletVideo")}
                    value={value.tablet_video_url}
                    poster={tabletPoster}
                    disabled={locked}
                    hint={t("optionalVideoHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "tablet-video" : null)}
                    onChange={(url) => onChange({ ...value, tablet_video_url: url })}
                  />
                  <VideoUploadField
                    label={t("mobileVideo")}
                    value={value.mobile_video_url}
                    poster={mobilePoster}
                    disabled={locked}
                    hint={t("optionalVideoHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "mobile-video" : null)}
                    onChange={(url) => onChange({ ...value, mobile_video_url: url })}
                  />
                  <div className="landing-poster-heading field-full">
                    <strong>{t("posterTitle")}</strong>
                    <p>{t("posterDescription")}</p>
                  </div>
                  <ImageUploadField
                    className="field-full"
                    label={t("desktopPoster")}
                    value={value.desktop_image_url}
                    disabled={locked}
                    hint={t("posterHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "desktop-poster" : null)}
                    onChange={(url) => onChange({ ...value, desktop_image_url: url })}
                  />
                  <ImageUploadField
                    label={t("tabletPoster")}
                    value={value.tablet_image_url}
                    disabled={locked}
                    hint={t("posterHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "tablet-poster" : null)}
                    onChange={(url) => onChange({ ...value, tablet_image_url: url })}
                  />
                  <ImageUploadField
                    label={t("mobilePoster")}
                    value={value.mobile_image_url}
                    disabled={locked}
                    hint={t("posterHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "mobile-poster" : null)}
                    onChange={(url) => onChange({ ...value, mobile_image_url: url })}
                  />
                </>
              ) : (
                <>
                  <ImageUploadField
                    className="field-full"
                    label={t("desktopImage")}
                    value={value.desktop_image_url}
                    required
                    disabled={locked}
                    hint={t("desktopHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "desktop-image" : null)}
                    onChange={(url) => onChange({ ...value, desktop_image_url: url })}
                  />
                  <ImageUploadField
                    label={t("tabletImage")}
                    value={value.tablet_image_url}
                    disabled={locked}
                    hint={t("optionalVariantHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "tablet-image" : null)}
                    onChange={(url) => onChange({ ...value, tablet_image_url: url })}
                  />
                  <ImageUploadField
                    label={t("mobileImage")}
                    value={value.mobile_image_url}
                    disabled={locked}
                    hint={t("optionalVariantHint")}
                    onBusyChange={(isBusy) => setUploadingField(isBusy ? "mobile-image" : null)}
                    onChange={(url) => onChange({ ...value, mobile_image_url: url })}
                  />
                </>
              )}
            </>
          )}

          <section className="landing-overlay-editor field-full" aria-labelledby="landing-overlay-heading">
            <div className="landing-overlay-editor-heading">
              <div>
                <h3 id="landing-overlay-heading">{t("overlayTitle")}</h3>
                <p>{t("overlayHint")}</p>
              </div>
              <span className="badge">{t("overlayGradientBadge")}</span>
            </div>
            <OverlayValueFields
              title={t("desktopOverlay")}
              color={value.desktop_overlay_color}
              intensity={value.desktop_overlay_intensity}
              disabled={locked}
              colorLabel={t("overlayColor")}
              intensityLabel={t("overlayIntensity")}
              onColorChange={(color) => onChange({ ...value, desktop_overlay_color: color })}
              onIntensityChange={(intensity) => onChange({ ...value, desktop_overlay_intensity: intensity })}
            />
            <div className="landing-overlay-override">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={value.tablet_overlay_override}
                  disabled={locked}
                  onChange={(event) => onChange({
                    ...value,
                    tablet_overlay_override: event.target.checked,
                  })}
                />
                <span>{t("tabletOverlayOverride")}</span>
              </label>
              {value.tablet_overlay_override ? (
                <OverlayValueFields
                  title={t("tabletOverlay")}
                  color={value.tablet_overlay_color}
                  intensity={value.tablet_overlay_intensity}
                  disabled={locked}
                  colorLabel={t("overlayColor")}
                  intensityLabel={t("overlayIntensity")}
                  onColorChange={(color) => onChange({ ...value, tablet_overlay_color: color })}
                  onIntensityChange={(intensity) => onChange({ ...value, tablet_overlay_intensity: intensity })}
                />
              ) : <p>{t("inheritsDesktopOverlay")}</p>}
            </div>
            <div className="landing-overlay-override">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={value.mobile_overlay_override}
                  disabled={locked}
                  onChange={(event) => onChange({
                    ...value,
                    mobile_overlay_override: event.target.checked,
                  })}
                />
                <span>{t("mobileOverlayOverride")}</span>
              </label>
              {value.mobile_overlay_override ? (
                <OverlayValueFields
                  title={t("mobileOverlay")}
                  color={value.mobile_overlay_color}
                  intensity={value.mobile_overlay_intensity}
                  disabled={locked}
                  colorLabel={t("overlayColor")}
                  intensityLabel={t("overlayIntensity")}
                  onColorChange={(color) => onChange({ ...value, mobile_overlay_color: color })}
                  onIntensityChange={(intensity) => onChange({ ...value, mobile_overlay_intensity: intensity })}
                />
              ) : <p>{t("inheritsDesktopOverlay")}</p>}
            </div>
          </section>

          <section className="landing-overlay-editor field-full" aria-labelledby="landing-auth-card-heading">
            <div className="landing-overlay-editor-heading">
              <div>
                <h3 id="landing-auth-card-heading">{t("authCardTitle")}</h3>
                <p>{t("authCardHint")}</p>
              </div>
              <span className="badge">{t("authCardBadge")}</span>
            </div>
            <OverlayValueFields
              title={t("desktopAuthCard")}
              color={value.desktop_auth_card_color}
              intensity={value.desktop_auth_card_intensity}
              disabled={locked}
              colorLabel={t("authCardColor")}
              intensityLabel={t("authCardIntensity")}
              onColorChange={(color) => onChange({ ...value, desktop_auth_card_color: color })}
              onIntensityChange={(intensity) => onChange({ ...value, desktop_auth_card_intensity: intensity })}
            />
            <div className="landing-overlay-override">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={value.tablet_auth_card_override}
                  disabled={locked}
                  onChange={(event) => onChange({
                    ...value,
                    tablet_auth_card_override: event.target.checked,
                  })}
                />
                <span>{t("tabletAuthCardOverride")}</span>
              </label>
              {value.tablet_auth_card_override ? (
                <OverlayValueFields
                  title={t("tabletAuthCard")}
                  color={value.tablet_auth_card_color}
                  intensity={value.tablet_auth_card_intensity}
                  disabled={locked}
                  colorLabel={t("authCardColor")}
                  intensityLabel={t("authCardIntensity")}
                  onColorChange={(color) => onChange({ ...value, tablet_auth_card_color: color })}
                  onIntensityChange={(intensity) => onChange({ ...value, tablet_auth_card_intensity: intensity })}
                />
              ) : <p>{t("inheritsDesktopAuthCard")}</p>}
            </div>
            <div className="landing-overlay-override">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={value.mobile_auth_card_override}
                  disabled={locked}
                  onChange={(event) => onChange({
                    ...value,
                    mobile_auth_card_override: event.target.checked,
                  })}
                />
                <span>{t("mobileAuthCardOverride")}</span>
              </label>
              {value.mobile_auth_card_override ? (
                <OverlayValueFields
                  title={t("mobileAuthCard")}
                  color={value.mobile_auth_card_color}
                  intensity={value.mobile_auth_card_intensity}
                  disabled={locked}
                  colorLabel={t("authCardColor")}
                  intensityLabel={t("authCardIntensity")}
                  onColorChange={(color) => onChange({ ...value, mobile_auth_card_color: color })}
                  onIntensityChange={(intensity) => onChange({ ...value, mobile_auth_card_intensity: intensity })}
                />
              ) : <p>{t("inheritsDesktopAuthCard")}</p>}
            </div>
          </section>

          <div className="landing-device-grid field-full" aria-label={t("preview")}>
            <DevicePreview label={t("desktop")} mode={value.background_mode} url={desktopPreview} posterUrl={value.desktop_image_url} ratio="16 / 7" fallbackLabel={isFallback ? t("noMedia") : t("noPreview")} overlayColor={value.desktop_overlay_color} overlayIntensity={value.desktop_overlay_intensity} gradientEndStop={80} authCardColor={value.desktop_auth_card_color} authCardIntensity={value.desktop_auth_card_intensity} imageFree={isFallback} />
            <DevicePreview label={t("tablet")} mode={value.background_mode} url={tabletPreview} posterUrl={tabletPoster} ratio="4 / 3" fallbackLabel={isFallback ? t("noMedia") : t("desktopFallback")} overlayColor={tabletOverlayColor} overlayIntensity={tabletOverlayIntensity} gradientEndStop={60} authCardColor={tabletAuthCardColor} authCardIntensity={tabletAuthCardIntensity} imageFree={isFallback} />
            <DevicePreview label={t("mobile")} mode={value.background_mode} url={mobilePreview} posterUrl={mobilePoster} ratio="9 / 16" fallbackLabel={isFallback ? t("noMedia") : t("desktopFallback")} overlayColor={mobileOverlayColor} overlayIntensity={mobileOverlayIntensity} gradientEndStop={70} authCardColor={mobileAuthCardColor} authCardIntensity={mobileAuthCardIntensity} imageFree={isFallback} />
          </div>

          {!isFallback && <label className="checkbox-field field-full">
            <input
              type="checkbox"
              checked={value.active}
              onChange={(event) => onChange({ ...value, active: event.target.checked })}
            />
            <span>{t("isActive")}</span>
          </label>}
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

export default function LandingPage() {
  const t = useTranslations("landing");
  const common = useTranslations("common");
  const [rows, setRows] = useState<LandingRule[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<LandingRule | null>(null);
  const [deleting, setDeleting] = useState<LandingRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_landing");
    if (!response?.success || !Array.isArray(response.data)) {
      setState("error");
      return;
    }
    setRows(response.data.map((row) => normalizeRule(row as Partial<LandingRule>)));
    setState("ready");
  }, [rows.length]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const mediaRows = useMemo(() => rows.filter((row) => row.scope !== "fallback"), [rows]);
  const activeCount = useMemo(() => mediaRows.filter((row) => row.active).length, [mediaRows]);
  const hasGlobal = useMemo(() => rows.some((row) => row.scope === "global"), [rows]);

  function validate(rule: LandingRule): string {
    if (rule.scope !== "fallback") {
      if (!rule.name.trim()) return t("nameInvalid");
      if (rule.background_mode === "video") {
        if (
          !isHttpsVideoUrl(rule.desktop_video_url)
          || !isHttpsVideoUrl(rule.tablet_video_url, true)
          || !isHttpsVideoUrl(rule.mobile_video_url, true)
        ) {
          return t("videoUrlInvalid");
        }
        if (!isHttpsUrl(rule.desktop_image_url, true)
          || !isHttpsUrl(rule.tablet_image_url, true)
          || !isHttpsUrl(rule.mobile_image_url, true)) {
          return t("urlInvalid");
        }
      } else {
        if (!isHttpsUrl(rule.desktop_image_url)) return t("urlInvalid");
        if (!isHttpsUrl(rule.tablet_image_url, true) || !isHttpsUrl(rule.mobile_image_url, true)) {
          return t("urlInvalid");
        }
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
    }
    if (
      !HEX_COLOR.test(rule.desktop_overlay_color)
      || (rule.tablet_overlay_override && !HEX_COLOR.test(rule.tablet_overlay_color))
      || (rule.mobile_overlay_override && !HEX_COLOR.test(rule.mobile_overlay_color))
    ) {
      return t("overlayColorInvalid");
    }
    if (
      !Number.isInteger(rule.desktop_overlay_intensity)
      || rule.desktop_overlay_intensity < 0
      || rule.desktop_overlay_intensity > 100
      || (rule.tablet_overlay_override && (
        !Number.isInteger(rule.tablet_overlay_intensity)
        || rule.tablet_overlay_intensity < 0
        || rule.tablet_overlay_intensity > 100
      ))
      || (rule.mobile_overlay_override && (
        !Number.isInteger(rule.mobile_overlay_intensity)
        || rule.mobile_overlay_intensity < 0
        || rule.mobile_overlay_intensity > 100
      ))
    ) {
      return t("overlayIntensityInvalid");
    }
    if (
      !HEX_COLOR.test(rule.desktop_auth_card_color)
      || (rule.tablet_auth_card_override && !HEX_COLOR.test(rule.tablet_auth_card_color))
      || (rule.mobile_auth_card_override && !HEX_COLOR.test(rule.mobile_auth_card_color))
    ) {
      return t("authCardColorInvalid");
    }
    if (
      !Number.isInteger(rule.desktop_auth_card_intensity)
      || rule.desktop_auth_card_intensity < 0
      || rule.desktop_auth_card_intensity > 100
      || (rule.tablet_auth_card_override && (
        !Number.isInteger(rule.tablet_auth_card_intensity)
        || rule.tablet_auth_card_intensity < 0
        || rule.tablet_auth_card_intensity > 100
      ))
      || (rule.mobile_auth_card_override && (
        !Number.isInteger(rule.mobile_auth_card_intensity)
        || rule.mobile_auth_card_intensity < 0
        || rule.mobile_auth_card_intensity > 100
      ))
    ) {
      return t("authCardIntensityInvalid");
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
    const response = await adminCall("save_landing", draft);
    setBusy(false);
    if (!response?.success || !response.landing) {
      setFormError(response?.error === "global-exists" ? t("globalExists") : t("saveError"));
      return;
    }
    const saved = normalizeRule(response.landing as Partial<LandingRule>);
    setRows((current) => {
      const remaining = current.filter((row) => saved.scope === "fallback"
        ? row.scope !== "fallback"
        : row.id !== saved.id);
      return saved.scope === "fallback" ? [saved, ...remaining] : [...remaining, saved];
    });
    setDraft(null);
    setToast({ tone: "success", text: t("updated") });
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await adminCall("delete_landing", { id: deleting.id });
    setBusy(false);
    if (!response?.success) {
      setToast({ tone: "error", text: t("deleteError") });
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
      scope: hasGlobal ? "country" : "global",
      name: hasGlobal ? t("newRegionalName") : t("newGlobalName"),
      priority: hasGlobal ? 10 : 0,
    });
  }

  function scopeLabel(rule: LandingRule): string {
    if (rule.scope === "fallback") return t("scopeFallback");
    if (rule.scope === "global") return t("scopeGlobal");
    if (rule.scope === "country") return `${t("scopeCountry")} · ${rule.country_code}`;
    return `${t("scopeCity")} · ${rule.city_name}, ${rule.country_code} · ${rule.radius_miles} mi`;
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
        <strong>{t("activeCount", { active: activeCount, total: mediaRows.length })}</strong>
        <span>{t("precedence")}</span>
      </div>
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rows.length === 0 ? (
        <EmptyPanel title={t("empty")} copy={t("emptyCopy")} />
      ) : (
        <section className="landing-rule-list">
          {rows.map((row) => (
            <article className={`landing-rule-card ${row.scope === "fallback" ? "is-fallback" : ""}`} key={row.id}>
              <div className={`landing-rule-image ${row.scope === "fallback" ? "is-image-free" : ""}`}>
                {row.scope !== "fallback" && row.background_mode === "video" ? (
                  <video
                    src={row.desktop_video_url}
                    poster={row.desktop_image_url || undefined}
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls={false}
                    preload="metadata"
                    disablePictureInPicture
                    disableRemotePlayback
                    aria-hidden="true"
                  />
                ) : row.scope !== "fallback" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.desktop_image_url} alt="" loading="lazy" />
                )}
                <div
                  className="landing-rule-tint"
                  style={{ background: landingGradient(row.desktop_overlay_color, row.desktop_overlay_intensity) }}
                  aria-hidden="true"
                />
                {row.scope === "fallback" && (
                  <div
                    className="landing-preview-auth-card landing-rule-auth-card"
                    style={{ background: translucentColor(row.desktop_auth_card_color, row.desktop_auth_card_intensity) }}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </div>
                )}
                <div className="landing-rule-overlay">
                  <strong>{row.name}</strong>
                  <span>{scopeLabel(row)}</span>
                </div>
              </div>
              <div className="landing-rule-body">
                <div className="hero-meta">
                  {row.scope === "fallback" ? (
                    <span className="badge badge-active">{t("fallbackBadge")}</span>
                  ) : (
                    <>
                      <span className={`badge ${row.active ? "badge-active" : "badge-inactive"}`}>
                        {row.active ? common("active") : common("inactive")}
                      </span>
                      <span className="badge">{t("priorityValue", { value: row.priority })}</span>
                    </>
                  )}
                </div>
                <div className="landing-variants">
                  {row.scope === "fallback" ? (
                    <span>{t("noMedia")}</span>
                  ) : (
                    <>
                      <span>{row.background_mode === "video" ? t("mediaVideo") : t("mediaImage")}</span>
                      <span>{t("desktop")}: ✓</span>
                      <span>{t("tablet")}: {(row.background_mode === "video" ? row.tablet_video_url : row.tablet_image_url) ? "✓" : t("fallbackShort")}</span>
                      <span>{t("mobile")}: {(row.background_mode === "video" ? row.mobile_video_url : row.mobile_image_url) ? "✓" : t("fallbackShort")}</span>
                    </>
                  )}
                  <span>{t("overlaySummary", { value: row.desktop_overlay_intensity })}</span>
                  <span>{t("authCardSummary", { value: row.desktop_auth_card_intensity })}</span>
                </div>
                <div className="row-actions">
                  <button className="button button-secondary button-small" onClick={() => { setFormError(""); setDraft({ ...row }); }}>
                    {common("edit")}
                  </button>
                  {row.scope !== "fallback" && (
                    <button className="button button-danger button-small" onClick={() => setDeleting(row)}>
                      {common("delete")}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {draft && (
        <LandingDialog
          value={draft}
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

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ImageUploadField from "@/components/ImageUploadField";
import { classifyHeroImageRatio } from "@/lib/appearanceHeroImage";
import {
  APPEARANCE_HERO_TEXT_WEIGHTS,
  appearanceTrim,
  emptyAppearanceHeroItem,
  MAX_APPEARANCE_HERO_ITEMS,
  type AppearanceHero,
  type AppearanceHeroItem,
  type AppearanceHeroPlatform,
  type AppearanceHeroText,
} from "@/lib/appearanceRules";

const HEX_COLOR = /^#[0-9a-f]{6}$/;

type HeroImageMeasurement =
  | { url: string; status: "measured"; width: number; height: number }
  | { url: string; status: "unavailable" };

function formattedAspectRatio(width: number, height: number): string {
  return (width / height).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

type Props = {
  value: AppearanceHero;
  /** Items the rule would inherit (the global rule's carousel); empty for the global rule itself. */
  inheritedItems: readonly AppearanceHeroItem[];
  isGlobal: boolean;
  disabled: boolean;
  onChange: (value: AppearanceHero) => void;
  onBusyChange: (busy: boolean) => void;
};

function StyleFields({
  item,
  platform,
  disabled,
  onChange,
}: {
  item: AppearanceHeroItem;
  platform: AppearanceHeroPlatform;
  disabled: boolean;
  onChange: (item: AppearanceHeroItem) => void;
}) {
  const t = useTranslations("appearance.hero");
  return (
    <>
      {(["title", "subtitle"] as AppearanceHeroText[]).map((text) => {
        const sizeKey = `${text}_size_${platform}` as const;
        const colorKey = `${text}_color_${platform}` as const;
        const weightKey = `${text}_weight_${platform}` as const;
        const color = item[colorKey];
        const label = `${t(platform)} · ${t(text)}`;
        return (
          <div className="field" key={`${platform}-${text}`}>
            <span>{label}</span>
            <div className="hero-style-controls">
              <input
                type="number"
                min={10}
                max={120}
                value={item[sizeKey] ?? ""}
                disabled={disabled}
                placeholder={t("sizeDefault")}
                aria-label={`${label} ${t("sizePx")}`}
                onChange={(event) => {
                  const raw = event.target.value;
                  onChange({ ...item, [sizeKey]: raw === "" ? null : Math.max(10, Math.min(120, Math.trunc(Number(raw) || 10))) });
                }}
              />
              <select
                value={item[weightKey]}
                disabled={disabled}
                aria-label={`${label} ${t("weightLabel")}`}
                onChange={(event) => onChange({ ...item, [weightKey]: event.target.value })}
              >
                {APPEARANCE_HERO_TEXT_WEIGHTS.map((weight) => (
                  <option key={weight || "default"} value={weight}>{t(weight ? `weight.${weight}` : "weight.default")}</option>
                ))}
              </select>
              <div className="landing-color-control">
                <input
                  type="color"
                  value={HEX_COLOR.test(color) ? color : "#ffffff"}
                  disabled={disabled}
                  aria-label={`${label} ${t("colorHex")}`}
                  onChange={(event) => onChange({ ...item, [colorKey]: event.target.value.toLowerCase() })}
                />
                <input
                  type="text"
                  value={color}
                  maxLength={7}
                  spellCheck={false}
                  disabled={disabled}
                  placeholder={t("colorDefault")}
                  onChange={(event) => onChange({ ...item, [colorKey]: appearanceTrim(event.target.value).toLowerCase() })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function HeroItemCard({
  item,
  index,
  count,
  disabled,
  onChange,
  onRemove,
  onMove,
  onBusyChange,
}: {
  item: AppearanceHeroItem;
  index: number;
  count: number;
  disabled: boolean;
  onChange: (item: AppearanceHeroItem) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("appearance.hero");
  const common = useTranslations("common");
  const [showTypography, setShowTypography] = useState(false);
  const [imageMeasurement, setImageMeasurement] = useState<HeroImageMeasurement | null>(null);
  const currentMeasurement = imageMeasurement?.url === item.media_url ? imageMeasurement : null;
  const ratioClassification = currentMeasurement?.status === "measured"
    ? classifyHeroImageRatio(currentMeasurement.width, currentMeasurement.height)
    : null;
  return (
    <article className="appearance-hero-item">
      <header className="appearance-hero-item-head">
        <strong>{t("itemTitle", { index: index + 1 })}</strong>
        <div className="row-actions">
          <button type="button" className="button button-secondary button-small" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={t("moveUp")}>↑</button>
          <button type="button" className="button button-secondary button-small" disabled={disabled || index === count - 1} onClick={() => onMove(1)} aria-label={t("moveDown")}>↓</button>
          <button type="button" className="button button-danger button-small" disabled={disabled} onClick={onRemove}>{common("delete")}</button>
        </div>
      </header>
      <div className="form-grid">
        <label className="field">
          <span>{t("mediaType")}</span>
          <select
            value={item.type}
            disabled={disabled}
            onChange={(event) => {
              const type = event.target.value as AppearanceHeroItem["type"];
              onChange({ ...item, type, media_url: type === item.type ? item.media_url : "" });
            }}
          >
            <option value="image">{t("image")}</option>
            <option value="video">{t("video")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("sortOrder")}</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={item.sort_order}
            disabled={disabled}
            onChange={(event) => onChange({ ...item, sort_order: Math.max(0, Math.min(10000, Math.trunc(Number(event.target.value) || 0))) })}
          />
        </label>
        {item.type === "image" ? (
          <>
            <ImageUploadField
              className="field-full"
              label={t("campaignImage")}
              value={item.media_url}
              required
              disabled={disabled}
              hint={t("campaignImageHint")}
              onBusyChange={onBusyChange}
              onChange={(url) => onChange({ ...item, media_url: url })}
            />
            <small className="field-hint field-full appearance-hero-image-guidance">
              {t("campaignImageRecommendation")}
            </small>
            {item.media_url && (
              <figure className="field-full appearance-hero-crop-preview">
                <div className="appearance-hero-crop-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={item.media_url}
                    src={item.media_url}
                    alt=""
                    onLoad={(event) => {
                      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                      setImageMeasurement(width > 0 && height > 0
                        ? { url: item.media_url, status: "measured", width, height }
                        : { url: item.media_url, status: "unavailable" });
                    }}
                    onError={() => setImageMeasurement({ url: item.media_url, status: "unavailable" })}
                  />
                </div>
                <figcaption>
                  <strong>{t("cropPreviewTitle")}</strong>
                  {currentMeasurement?.status === "measured" && (
                    <span>
                      {t("imageDimensions", {
                        width: currentMeasurement.width,
                        height: currentMeasurement.height,
                        ratio: formattedAspectRatio(currentMeasurement.width, currentMeasurement.height),
                      })}
                    </span>
                  )}
                  {ratioClassification === "crop-top-bottom" && (
                    <span className="appearance-hero-ratio-warning" role="status">{t("cropTopBottom")}</span>
                  )}
                  {ratioClassification === "crop-left-right" && (
                    <span className="appearance-hero-ratio-warning" role="status">{t("cropLeftRight")}</span>
                  )}
                  {currentMeasurement?.status === "unavailable" && (
                    <span className="appearance-hero-dimensions-unavailable" role="status">
                      {t("dimensionsUnavailable")}
                    </span>
                  )}
                </figcaption>
              </figure>
            )}
          </>
        ) : (
          <label className="field field-full">
            <span>{t("videoUrl")}</span>
            <input
              type="url"
              inputMode="url"
              value={item.media_url}
              disabled={disabled}
              onChange={(event) => onChange({ ...item, media_url: event.target.value.slice(0, 2048) })}
              placeholder="https://cdn.example.com/campaign.mp4"
            />
            <small className="field-hint">{t("videoUrlHint")}</small>
          </label>
        )}
        <label className="field field-full">
          <span>{t("destinationUrl")}</span>
          <input
            type="url"
            inputMode="url"
            value={item.forward_url}
            disabled={disabled}
            onChange={(event) => onChange({ ...item, forward_url: event.target.value.slice(0, 2048) })}
            placeholder="https://friending.com/campaign"
          />
          <small className="field-hint">{t("destinationUrlHint")}</small>
        </label>
        <label className="field">
          <span>{t("titleEn")}</span>
          <input value={item.title_en} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...item, title_en: event.target.value })} />
        </label>
        <label className="field">
          <span>{t("titleHu")}</span>
          <input value={item.title_hu} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...item, title_hu: event.target.value })} />
        </label>
        <label className="field">
          <span>{t("subtitleEn")}</span>
          <input value={item.subtitle_en} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...item, subtitle_en: event.target.value })} />
        </label>
        <label className="field">
          <span>{t("subtitleHu")}</span>
          <input value={item.subtitle_hu} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...item, subtitle_hu: event.target.value })} />
        </label>
        <label className="field">
          <span>{t("linkTitleEn")}</span>
          <input value={item.link_title_en} maxLength={80} disabled={disabled} onChange={(event) => onChange({ ...item, link_title_en: event.target.value })} />
          <small className="field-hint">{t("linkTitleHint")}</small>
        </label>
        <label className="field">
          <span>{t("linkTitleHu")}</span>
          <input value={item.link_title_hu} maxLength={80} disabled={disabled} onChange={(event) => onChange({ ...item, link_title_hu: event.target.value })} />
        </label>
        <div className="field-full hero-typography-head">
          <button type="button" className="button-link" onClick={() => setShowTypography((current) => !current)}>
            {showTypography ? t("hideTypography") : t("showTypography")}
          </button>
          <small className="field-hint">{t("typographyHint")}</small>
        </div>
        {showTypography && (
          <>
            <StyleFields item={item} platform="web" disabled={disabled} onChange={onChange} />
            <StyleFields item={item} platform="mobile" disabled={disabled} onChange={onChange} />
          </>
        )}
        <label className="checkbox-field field-full">
          <input type="checkbox" checked={item.active} disabled={disabled} onChange={(event) => onChange({ ...item, active: event.target.checked })} />
          <span>{t("itemActive")}</span>
        </label>
      </div>
    </article>
  );
}

/**
 * Hero carousel of one rule: inherit the chain's carousel or replace it with
 * this rule's own items. Core lets an empty non-global replacement fall
 * through to the next scope instead of hiding the global hero (T-638).
 */
export default function AppearanceHeroEditor({ value, inheritedItems, isGlobal, disabled, onChange, onBusyChange }: Props) {
  const t = useTranslations("appearance.hero");
  const items = value.items;

  function setItems(next: AppearanceHeroItem[]) {
    onChange({ mode: "replace", items: next });
  }

  return (
    <div className="appearance-hero-editor field-full">
      <div className="appearance-hero-mode" role="radiogroup" aria-label={t("mode")}>
        <label className="checkbox-field">
          <input
            type="radio"
            name="appearance-hero-mode"
            checked={value.mode === "inherit"}
            disabled={disabled}
            onChange={() => onChange({ mode: "inherit", items: [] })}
          />
          <span>
            {t("modeInherit")}
            {" · "}
            <small>{isGlobal ? t("inheritNoneGlobal") : t("inheritCount", { count: inheritedItems.length })}</small>
          </span>
        </label>
        <label className="checkbox-field">
          <input
            type="radio"
            name="appearance-hero-mode"
            checked={value.mode === "replace"}
            disabled={disabled}
            onChange={() => onChange({ mode: "replace", items: value.items })}
          />
          <span>{t("modeReplace")} · <small>{t("replaceHint")}</small></span>
        </label>
      </div>
      {value.mode === "replace" && (
        <div className="appearance-hero-items">
          {items.length === 0 && (
            <p className="appearance-hero-empty">{t(isGlobal ? "replaceEmptyGlobal" : "replaceEmpty")}</p>
          )}
          {items.map((item, index) => (
            <HeroItemCard
              key={`${item.id || "new"}-${index}`}
              item={item}
              index={index}
              count={items.length}
              disabled={disabled}
              onBusyChange={onBusyChange}
              onChange={(next) => setItems(items.map((current, position) => (position === index ? next : current)))}
              onRemove={() => setItems(items.filter((_, position) => position !== index))}
              onMove={(direction) => {
                const target = index + direction;
                if (target < 0 || target >= items.length) return;
                const next = [...items];
                const [moved] = next.splice(index, 1);
                if (!moved) return;
                next.splice(target, 0, moved);
                setItems(next.map((entry, position) => ({ ...entry, sort_order: (position + 1) * 10 })));
              }}
            />
          ))}
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled || items.length >= MAX_APPEARANCE_HERO_ITEMS}
            onClick={() => setItems([...items, emptyAppearanceHeroItem(((items.at(-1)?.sort_order ?? 0) + 10))])}
          >
            {t("addItem")}
          </button>
        </div>
      )}
    </div>
  );
}

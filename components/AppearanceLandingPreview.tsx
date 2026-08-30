"use client";

import { Fragment } from "react";
import {
  APPEARANCE_DEFAULT_LANDING,
  appearanceLandingLayoutPixels,
  appearanceLandingPreviewDraft,
  isAppearanceHttpsUrl,
  resolveAppearanceLandingFields,
  type AppearanceFullPaletteValues,
  type ResolvedAppearanceLanding,
} from "@/lib/appearanceRules";

export type AppearanceAuthPreviewMode = "both" | "phone" | "email";

export type AppearanceLandingPreviewLabels = {
  apple: string;
  divider: string;
  qr: string;
};

function rgba(hex: string, alpha: string): string {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(hex);
  const parsedAlpha = Number(alpha);
  if (!match || !Number.isFinite(parsedAlpha)) return "transparent";
  return `rgba(${Number.parseInt(match[1]!, 16)}, ${Number.parseInt(match[2]!, 16)}, ${Number.parseInt(match[3]!, 16)}, ${Math.max(0, Math.min(1, parsedAlpha))})`;
}

function fontClass(font: string): string {
  return `appearance-landing-font-${font.replace(/[^a-z_]/g, "")}`;
}

function aligned(align: string): "left" | "center" | "right" {
  return align === "center" || align === "right" ? align : "left";
}

function number(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function FooterText({ text }: { text: string }) {
  const pieces = text.split(/(<terms>[\s\S]*?<\/terms>|<privacy>[\s\S]*?<\/privacy>)/g);
  return (
    <>
      {pieces.map((piece, index) => {
        const terms = /^<terms>([\s\S]*)<\/terms>$/.exec(piece);
        const privacy = /^<privacy>([\s\S]*)<\/privacy>$/.exec(piece);
        return terms || privacy ? <u key={`${index}-${piece}`}>{(terms ?? privacy)![1]}</u> : <Fragment key={`${index}-${piece}`}>{piece}</Fragment>;
      })}
    </>
  );
}

function QrGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 8h2v2H8zM14 8h2v2h-2zM8 14h2v2H8zM13 13h3v3h-3z" />
    </svg>
  );
}

/** D-061's 390×844 landing screen, rendered entirely from effective values. */
export default function AppearanceLandingPreview({
  content,
  fallbackLabel,
  palette,
  paletteMode,
  authMethods,
  labels,
}: {
  content: ResolvedAppearanceLanding;
  fallbackLabel: string;
  palette: AppearanceFullPaletteValues;
  paletteMode: "light" | "dark";
  authMethods: AppearanceAuthPreviewMode;
  labels: AppearanceLandingPreviewLabels;
}) {
  // The composer already removes invalid draft styles so they inherit. Keep
  // the render boundary defensive as this component also has other callers.
  const fields = resolveAppearanceLandingFields(
    [appearanceLandingPreviewDraft(content.effective).landing],
    APPEARANCE_DEFAULT_LANDING,
  );
  const hasBackground = isAppearanceHttpsUrl(content.backgroundUrl);
  const showPhone = authMethods === "both" || authMethods === "phone";
  const showEmail = authMethods === "both" || authMethods === "email";
  const buttonRadius = number(fields.button_corner_radius, 28);
  const layout = appearanceLandingLayoutPixels(fields);
  const showTitleText = content.titleType === "text" && content.titleText !== "";
  const showDescription = !content.descriptionHidden && content.description !== "";
  const showTextBlock = showTitleText || showDescription;
  const appleStyle = fields.button_apple_style === "black" || fields.button_apple_style === "white_outline"
    ? fields.button_apple_style
    : "white";

  return (
    <div
      className={`appearance-landing-composition-phone is-${paletteMode}`}
      style={{ backgroundColor: palette.accent_faint_bg, color: palette.on_accent }}
      aria-label={fallbackLabel}
    >
      {hasBackground ? (
        content.backgroundType === "video" ? (
          <video
            className="appearance-landing-composition-media"
            src={content.backgroundUrl}
            poster={isAppearanceHttpsUrl(content.posterUrl) ? content.posterUrl : undefined}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="appearance-landing-composition-media" src={content.backgroundUrl} alt="" />
        )
      ) : (
        <div className="appearance-landing-composition-fallback" style={{ color: palette.accent }}>
          <span>{fallbackLabel}</span>
        </div>
      )}
      <div
        className="appearance-landing-composition-overlay"
        style={{ backgroundColor: rgba(fields.overlay_color, fields.overlay_alpha) }}
      />
      <div className="appearance-landing-safe-area appearance-landing-safe-area-top" aria-hidden="true">
        <span>9:41</span><i /><b>●</b>
      </div>
      {fields.qr_enabled === "true" && (
        <span
          className="appearance-landing-qr"
          title={labels.qr}
          style={{ backgroundColor: fields.qr_bg_color, color: fields.qr_icon_color }}
        >
          <QrGlyph />
        </span>
      )}

      {content.titleType === "image" && isAppearanceHttpsUrl(content.titleImageUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="appearance-landing-composition-logo"
          src={content.titleImageUrl}
          alt=""
          style={{
            width: `${number(fields.title_image_width_percent, 60)}%`,
            top: `${50 + number(fields.title_image_offset_percent, -10)}%`,
          }}
        />
      )}

      <div className="appearance-landing-composition-content">
        <div className="appearance-landing-composition-body">
          {showTextBlock && (
            <div className="appearance-landing-composition-text-block" style={{ marginBottom: `${layout.textGap}px` }}>
              {showTitleText && (
                <strong
                  className={`appearance-landing-composition-title ${fontClass(fields.title_font)}`}
                  style={{ color: fields.title_color, fontSize: `${number(fields.title_size, 44)}px`, textAlign: aligned(fields.title_align) }}
                >
                  {content.titleText}
                </strong>
              )}
              {showDescription && (
                <p
                  className={`appearance-landing-composition-description ${fontClass(fields.description_font)}`}
                  style={{
                    backgroundColor: rgba(fields.description_backdrop_color, fields.description_backdrop_alpha),
                    color: fields.description_color,
                    fontSize: `${number(fields.description_size, 17)}px`,
                    textAlign: aligned(fields.description_align),
                  }}
                >
                  {content.description}
                </p>
              )}
            </div>
          )}

          <div className="appearance-landing-composition-actions">
            {showPhone && (
              <span
                className={`appearance-landing-method-button ${fontClass(fields.button_phone_font)}`}
                style={{
                  backgroundColor: fields.button_phone_bg,
                  borderRadius: `${buttonRadius}px`,
                  color: fields.button_phone_text_color,
                  fontSize: `${number(fields.button_phone_size, 17)}px`,
                }}
              >
                {content.phoneLabel}
              </span>
            )}
            {showPhone && showEmail && <span className="appearance-landing-divider">{labels.divider}</span>}
            {showEmail && (
              <span
                className={`appearance-landing-method-button ${fontClass(fields.button_email_font)}`}
                style={{
                  backgroundColor: fields.button_email_bg,
                  borderRadius: `${buttonRadius}px`,
                  color: fields.button_email_text_color,
                  fontSize: `${number(fields.button_email_size, 17)}px`,
                }}
              >
                {content.emailLabel}
              </span>
            )}
            <span
              className={`appearance-landing-apple-button is-${appleStyle}`}
              style={{ borderRadius: `${buttonRadius}px` }}
            >
              <b aria-hidden="true"></b> {labels.apple}
            </span>
          </div>
        </div>

        <div
          className={`appearance-landing-composition-footer ${fontClass(fields.footer_font)}`}
          style={{
            backgroundColor: rgba(fields.footer_bg_color, fields.footer_bg_alpha),
            color: fields.footer_text_color,
            fontSize: `${number(fields.footer_size, 12)}px`,
            minHeight: `${layout.footerMinHeight}px`,
          }}
        >
          <span className="appearance-landing-composition-footer-copy">
            <FooterText text={content.footerText} />
          </span>
        </div>
      </div>
      <div className="appearance-landing-safe-area appearance-landing-safe-area-bottom" aria-hidden="true"><i /></div>
    </div>
  );
}

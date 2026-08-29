"use client";

import { isAppearanceHttpsUrl, type ResolvedAppearanceLanding } from "@/lib/appearanceRules";

/**
 * Phone-shaped preview of the resolved app landing screen. It mirrors the
 * legacy App landing preview so operators see the inheritance result — this
 * rule → global rule → compiled default — not the editor's blank fields.
 */
export default function AppearanceLandingPreview({
  content,
  fallbackLabel,
  accent,
  onAccent,
  buttonLabel,
}: {
  content: ResolvedAppearanceLanding;
  fallbackLabel: string;
  accent: string;
  onAccent: string;
  buttonLabel: string;
}) {
  const hasBackground = isAppearanceHttpsUrl(content.backgroundUrl);
  return (
    <div className="app-landing-phone appearance-landing-phone" aria-hidden="true">
      {hasBackground ? (
        content.backgroundType === "video" ? (
          <video
            className="app-landing-phone-media"
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
          <img className="app-landing-phone-media" src={content.backgroundUrl} alt="" />
        )
      ) : (
        <span className="app-landing-phone-fallback">{fallbackLabel}</span>
      )}
      <div className="app-landing-phone-overlay">
        {content.titleType === "image" && isAppearanceHttpsUrl(content.titleImageUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="app-landing-phone-title-image" src={content.titleImageUrl} alt="" />
        ) : (
          <strong className="app-landing-phone-title">{content.titleText}</strong>
        )}
        {content.description && (
          <p className="app-landing-phone-description">{content.description}</p>
        )}
        <span className="appearance-landing-phone-button" style={{ background: accent, color: onAccent }}>
          {buttonLabel}
        </span>
      </div>
    </div>
  );
}

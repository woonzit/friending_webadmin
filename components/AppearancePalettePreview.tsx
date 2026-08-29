"use client";

import { useTranslations } from "next-intl";
import type { AppearanceFullPaletteValues, AppearancePaletteMode } from "@/lib/appearanceRules";

const CANVAS: Record<AppearancePaletteMode, { background: string; surface: string; text: string; muted: string }> = {
  light: { background: "#FFFFFF", surface: "#F4F1F3", text: "#1C1C1E", muted: "#6B6668" },
  dark: { background: "#0F0F12", surface: "#1B1B20", text: "#F7F8FA", muted: "#B5B8BE" },
};

function Glyph({ color, d }: { color: string; d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/**
 * The key elements of the V3 Discover frames (For you / Nearby / Activity
 * tabs, location bar, hero card, primary and pressed buttons, faint chip,
 * bottom tab bar) painted with one resolved palette. Colours are inline on
 * purpose: they are data, not design tokens of the console.
 */
export default function AppearancePalettePreview({
  mode,
  palette,
}: {
  mode: AppearancePaletteMode;
  palette: AppearanceFullPaletteValues;
}) {
  const t = useTranslations("appearance.palettePreview");
  const canvas = CANVAS[mode];
  return (
    <div
      className="appearance-palette-preview"
      data-mode={mode}
      style={{ background: canvas.background, color: canvas.text, borderColor: mode === "dark" ? "#2A2A31" : "#E3DFE2" }}
      aria-label={t("label", { mode: t(mode) })}
    >
      <div className="appearance-palette-preview-tabs">
        <span style={{ color: palette.accent, borderBottomColor: palette.accent }}>{t("forYou")}</span>
        <span style={{ color: palette.inactive }}>{t("nearby")}</span>
        <span style={{ color: palette.inactive }}>{t("activity")}</span>
      </div>
      <div className="appearance-palette-preview-location" style={{ color: canvas.muted }}>
        <Glyph color={palette.accent} d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <span>{t("location")}</span>
      </div>
      <div className="appearance-palette-preview-hero" style={{ background: palette.accent_faint_bg, borderColor: palette.accent }}>
        <strong style={{ color: palette.accent }}>{t("heroTitle")}</strong>
        <span style={{ color: canvas.muted }}>{t("heroSubtitle")}</span>
      </div>
      <div className="appearance-palette-preview-buttons">
        <span style={{ background: palette.accent, color: palette.on_accent }}>{t("primaryButton")}</span>
        <span style={{ background: palette.accent_pressed, color: palette.on_accent }}>{t("pressedButton")}</span>
        <span style={{ background: palette.accent_faint_bg, color: palette.accent }}>{t("chip")}</span>
      </div>
      <div className="appearance-palette-preview-bar" style={{ background: canvas.surface }}>
        <Glyph color={palette.accent} d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" />
        <Glyph color={palette.inactive} d="M8.5 4.4a2.6 3.6 0 1 0 0 7.2 2.6 3.6 0 1 0 0-7.2M15.5 9.4a2.6 3.6 0 1 0 0 7.2 2.6 3.6 0 1 0 0-7.2" />
        <Glyph color={palette.inactive} d="M4 5h16v12H10l-5 3v-3H4z" />
        <Glyph color={palette.inactive} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" />
      </div>
    </div>
  );
}

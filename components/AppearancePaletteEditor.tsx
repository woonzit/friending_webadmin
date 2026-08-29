"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import AppearancePalettePreview from "@/components/AppearancePalettePreview";
import {
  APPEARANCE_PALETTE_MODES,
  APPEARANCE_PALETTE_ROLES,
  appearanceTrim,
  normalizeAppearancePaletteHex,
  resolveAppearancePalette,
  type AppearanceFullPalette,
  type AppearancePalette,
  type AppearancePaletteMode,
  type AppearancePaletteRole,
} from "@/lib/appearanceRules";

type Props = {
  value: AppearancePalette;
  /** Palettes this rule inherits from, most specific first (the global rule for an override; empty for the global rule). */
  inherited: readonly AppearancePalette[];
  defaults: AppearanceFullPalette;
  disabled: boolean;
  onChange: (value: AppearancePalette) => void;
};

/**
 * Light and dark side by side. Each role is either inherited (checkbox on,
 * value shown read-only with its source) or set on this rule (colour input
 * plus a hex field). The previews below paint the resolved result.
 */
export default function AppearancePaletteEditor({ value, inherited, defaults, disabled, onChange }: Props) {
  const t = useTranslations("appearance.palette");
  const resolved = useMemo(() => resolveAppearancePalette([value, ...inherited], defaults), [value, inherited, defaults]);

  function setRole(mode: AppearancePaletteMode, role: AppearancePaletteRole, hex: string | null) {
    const next: AppearancePalette = { light: { ...value.light }, dark: { ...value.dark } };
    if (hex === null) delete next[mode][role];
    else next[mode][role] = hex;
    onChange(next);
  }

  return (
    <div className="appearance-palette-editor field-full">
      <div className="appearance-palette-columns">
        {APPEARANCE_PALETTE_MODES.map((mode) => (
          <section className="appearance-palette-column" key={mode} aria-label={t(mode)}>
            <h4>{t(mode)}</h4>
            {APPEARANCE_PALETTE_ROLES.map((role) => {
              const own = value[mode][role];
              const inherits = own === undefined;
              const shown = resolved.values[mode][role];
              const source = resolved.sources[mode][role];
              const inputId = `palette-${mode}-${role}`;
              return (
                <div className="appearance-palette-role" key={role}>
                  <div className="appearance-palette-role-head">
                    <label htmlFor={inputId}>{t(`role.${role}`)}</label>
                    <label className="appearance-palette-inherit">
                      <input
                        type="checkbox"
                        checked={inherits}
                        disabled={disabled}
                        onChange={(event) => setRole(mode, role, event.target.checked ? null : shown)}
                      />
                      <span>{t("inherit")}</span>
                    </label>
                  </div>
                  <div className="landing-color-control">
                    <input
                      id={inputId}
                      type="color"
                      value={shown.toLowerCase()}
                      disabled={disabled || inherits}
                      aria-label={`${t(mode)} · ${t(`role.${role}`)}`}
                      onChange={(event) => {
                        const hex = normalizeAppearancePaletteHex(event.target.value);
                        if (hex) setRole(mode, role, hex);
                      }}
                    />
                    <input
                      type="text"
                      value={inherits ? shown : own}
                      maxLength={7}
                      spellCheck={false}
                      disabled={disabled || inherits}
                      aria-label={`${t(mode)} · ${t(`role.${role}`)} · ${t("hex")}`}
                      onChange={(event) => {
                        const raw = appearanceTrim(event.target.value);
                        const hex = normalizeAppearancePaletteHex(raw);
                        // Keep typing possible: an incomplete value is stored as typed and refused on save.
                        setRole(mode, role, hex ?? raw);
                      }}
                    />
                  </div>
                  <small className="field-hint">
                    {inherits
                      ? (source === "inherited" ? t("fromGlobal") : t("fromDefault"))
                      : t("setHere")}
                  </small>
                </div>
              );
            })}
            <AppearancePalettePreview mode={mode} palette={resolved.values[mode]} />
          </section>
        ))}
      </div>
      <small className="field-hint">{t("hint")}</small>
    </div>
  );
}

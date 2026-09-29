"use client";

import React from "react";
import type { ProfileVerificationLocalizedText } from "@/lib/profileVerification";

export type Language = "en" | "hu";

/**
 * Drop control characters and bound the code-point length while the operator types. The class
 * must stay identical to `CONTROL` in lib/profileVerification.ts, so nothing the input accepts
 * can fail validation at save time.
 */
export function plainText(value: string, maximum: number): string {
  const clean = value.replace(/[\u0000-\u001F\u007F]/gu, " ");
  return Array.from(clean).slice(0, maximum).join("");
}

/**
 * One English/Hungarian pair of the profile-verification editor. `errors`
 * carries the already-translated field-level problem for either language; the
 * input is then marked invalid and the message is shown under it.
 */
export default function LocalizedFields({
  value,
  onChange,
  labelEn,
  labelHu,
  maximum,
  multiline = false,
  disabled = false,
  errors,
}: {
  value: ProfileVerificationLocalizedText;
  onChange: (language: Language, value: string) => void;
  labelEn: string;
  labelHu: string;
  maximum: number;
  multiline?: boolean;
  disabled?: boolean;
  errors?: Partial<Record<Language, string>>;
}) {
  return (
    <div className="verification-localized-pair">
      {(["en", "hu"] as const).map((language) => {
        const error = errors?.[language];
        return (
          <label className="field" key={language}>
            <span>{language === "en" ? labelEn : labelHu}</span>
            {multiline ? (
              <textarea
                rows={3}
                maxLength={maximum}
                value={value[language]}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChange(language, plainText(event.target.value, maximum))}
              />
            ) : (
              <input
                maxLength={maximum}
                value={value[language]}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChange(language, plainText(event.target.value, maximum))}
              />
            )}
            {error ? <small className="field-error" role="alert">{error}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

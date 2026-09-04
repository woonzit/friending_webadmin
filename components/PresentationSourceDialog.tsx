"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import ProfileIconUploadField from "@/components/ProfileIconUploadField";
import {
  localizedText,
  normalizeManagedIcon,
  presentationOptionRows,
  sourceTakesOptionIcons,
  type PresentationBuiltinSource,
} from "@/lib/profilePresentation";

/**
 * The built-in presentation source editor: bilingual label, one source icon,
 * and — for a source that carries a per-value vocabulary — one row per option
 * with its own bilingual label and its own icon upload (D-122, T-730).
 *
 * The option rows appear ONLY when the served source carries a non-empty
 * `option_icons` map. That is Core's own signal for "this source takes option
 * icons", and it is the difference between "generation has four buckets and
 * none of them is uploaded yet" and "work has no buckets at all". The console
 * never hard-codes genZ/millennial/genX/boomer: whatever keys Core serves are
 * the rows it draws, in the order Core served them.
 *
 * Lifted out of the page so the rendered markup can be asserted directly.
 */
export function PresentationSourceDialog({
  source,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  source: PresentationBuiltinSource;
  busy: boolean;
  error: string;
  onChange: (source: PresentationBuiltinSource) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("profilePresentation");
  const common = useTranslations("common");
  const locale = useLocale();
  const optionRows = sourceTakesOptionIcons(source) ? presentationOptionRows(source) : [];

  function changeOptionLabel(optionKey: string, language: "en" | "hu", value: string) {
    onChange({
      ...source,
      option_labels: {
        ...source.option_labels,
        [optionKey]: { ...(source.option_labels[optionKey] ?? {}), [language]: value },
      },
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section className="dialog profile-presentation-source-dialog" role="dialog" aria-modal="true" aria-labelledby="presentation-source-title">
        <div className="dialog-header">
          <div><h2 id="presentation-source-title">{t("sourceEditorTitle")}</h2><p>{t("sourceEditorCopy")}</p></div>
          <button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <label className="field field-full"><span>{t("stableKey")}</span><input value={source.key} disabled /></label>
          <label className="field"><span>{t("labelEn")}</span><input maxLength={100} disabled={busy} value={source.labels.en ?? ""} onChange={(event) => onChange({ ...source, labels: { ...source.labels, en: event.target.value } })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input maxLength={100} disabled={busy} value={source.labels.hu ?? ""} onChange={(event) => onChange({ ...source, labels: { ...source.labels, hu: event.target.value } })} /></label>
          <div className="field-full">
            <ProfileIconUploadField
              label={t("icon")}
              hint={t("iconHint")}
              chooseLabel={t("chooseIcon")}
              removeLabel={t("removeIcon")}
              uploadingLabel={t("uploadingIcon")}
              errorLabel={t("iconError")}
              value={source.icon.url}
              disabled={busy}
              onChange={(icon) => {
                const normalized = normalizeManagedIcon(icon);
                if (normalized) onChange({ ...source, icon: normalized });
              }}
            />
          </div>
          {optionRows.length > 0 ? (
            <section className="field-full presentation-option-icons" aria-labelledby="presentation-option-icons-title">
              <h3 id="presentation-option-icons-title">{t("optionIconsTitle")}</h3>
              <p className="page-subtitle">{t("optionIconsCopy")}</p>
              <ul className="presentation-option-icon-list">
                {optionRows.map((row) => (
                  <li className="presentation-option-icon-row" key={row.key} data-option-key={row.key}>
                    <div className="presentation-option-icon-heading">
                      <strong>{localizedText(row.labels, locale) || row.key}</strong>
                      <code>{row.key}</code>
                    </div>
                    <div className="form-grid">
                      <label className="field"><span>{t("labelEn")}</span><input maxLength={100} disabled={busy} value={row.labels.en ?? ""} onChange={(event) => changeOptionLabel(row.key, "en", event.target.value)} /></label>
                      <label className="field"><span>{t("labelHu")}</span><input maxLength={100} disabled={busy} value={row.labels.hu ?? ""} onChange={(event) => changeOptionLabel(row.key, "hu", event.target.value)} /></label>
                    </div>
                    <ProfileIconUploadField
                      label={t("optionIcon", { name: localizedText(row.labels, locale) || row.key })}
                      hint={t("iconHint")}
                      chooseLabel={t("chooseIcon")}
                      removeLabel={t("removeIcon")}
                      uploadingLabel={t("uploadingIcon")}
                      errorLabel={t("iconError")}
                      value={row.icon.url}
                      disabled={busy}
                      onChange={(icon) => {
                        const normalized = normalizeManagedIcon(icon);
                        if (!normalized) return;
                        onChange({
                          ...source,
                          option_icons: { ...source.option_icons, [row.key]: normalized },
                        });
                      }}
                    />
                  </li>
                ))}
              </ul>
              <small className="field-hint">{t("optionIconsUntouched")}</small>
            </section>
          ) : null}
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{common("cancel")}</button><button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

export default PresentationSourceDialog;

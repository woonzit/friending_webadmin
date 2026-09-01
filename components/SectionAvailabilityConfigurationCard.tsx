"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import {
  SECTION_AVAILABILITY_SECTIONS,
  sectionAvailabilityDraftWithSection,
  type SectionAvailabilityConfiguration,
  type SectionAvailabilitySection,
} from "@/lib/sectionAvailability";
import { localizedAuthPolicyStorefronts } from "@/lib/authPolicyConfiguration";

type Props = {
  value: SectionAvailabilityConfiguration;
  busy: boolean;
  conflictRevision: number | null;
  onSave: () => void;
  onChange: (value: SectionAvailabilityConfiguration) => void;
};

export default function SectionAvailabilityConfigurationCard({
  value,
  busy,
  conflictRevision,
  onSave,
  onChange,
}: Props) {
  const t = useTranslations("configuration.sectionAvailability");
  const common = useTranslations("common");
  const locale = useLocale();
  const storefronts = useMemo(
    () => localizedAuthPolicyStorefronts(value.vocabulary, locale),
    [locale, value.vocabulary],
  );
  const warningCodes = [...new Set(SECTION_AVAILABILITY_SECTIONS.flatMap(
    (section) => value[section].invalidCodes,
  ))].sort((left, right) => left.localeCompare(right));

  function patch(
    section: SectionAvailabilitySection,
    changes: Parameters<typeof sectionAvailabilityDraftWithSection>[2],
  ) {
    onChange(sectionAvailabilityDraftWithSection(value, section, changes));
  }

  return (
    <section className="panel section-availability-panel" id="section-availability">
      <div className="panel-header section-availability-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <div className="section-availability-header-actions">
          <span className="status-badge neutral">{t("revision", { revision: value.revision })}</span>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={onSave}
          >
            {busy ? common("saving") : t("save")}
          </button>
        </div>
      </div>
      <div className="panel-body section-availability-body">
        <p className="section-availability-boundary">{t("visibilityOnly")}</p>
        {conflictRevision !== null ? (
          <div className="alert alert-error" role="status">
            {t("conflictReloaded", { revision: conflictRevision })}
          </div>
        ) : null}
        {warningCodes.length > 0 ? (
          <div className="alert alert-error" role="alert">
            {t("vocabularyWarning", { codes: warningCodes.join(", ") })}
          </div>
        ) : null}

        <div className="section-availability-grid">
          {SECTION_AVAILABILITY_SECTIONS.map((section) => {
            const control = value[section];
            const usedStorefronts = new Set(control.overrides.map((row) => row.storefront));
            const hasPendingRow = control.overrides.some((row) => !row.storefront);
            const everyKnownStorefrontUsed = storefronts.every(
              (storefront) => usedStorefronts.has(storefront.alpha3),
            );
            return (
              <article className="section-availability-control" key={section}>
                <div className="section-availability-control-heading">
                  <div>
                    <h3>{t(`${section}.title`)}</h3>
                    <p>{t(`${section}.copy`)}</p>
                  </div>
                  <span className={`badge ${control.enabled ? "badge-active" : "badge-inactive"}`}>
                    {control.enabled ? common("enabled") : common("disabled")}
                  </span>
                </div>

                <label className="section-availability-global">
                  <span>
                    <strong>{t("globalTitle")}</strong>
                    <small>{t("globalCopy")}</small>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={control.enabled}
                      disabled={busy}
                      onChange={(event) => patch(section, { enabled: event.target.checked })}
                    />
                    <span className="switch-track" />
                  </span>
                </label>

                <div className="section-availability-overrides-heading">
                  <div>
                    <h4>{t("overridesTitle")}</h4>
                    <p>{t("overridesCopy")}</p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={busy || hasPendingRow || everyKnownStorefrontUsed}
                    onClick={() => patch(section, {
                      overrides: [
                        ...control.overrides,
                        { storefront: "", enabled: !control.enabled },
                      ],
                    })}
                  >
                    {t("addOverride")}
                  </button>
                </div>

                {control.overrides.length > 0 ? (
                  <div className="section-availability-overrides">
                    {control.overrides.map((row, index) => {
                      const known = !row.storefront
                        || storefronts.some((storefront) => storefront.alpha3 === row.storefront);
                      return (
                        <div className="section-availability-override" key={`${row.storefront}-${index}`}>
                          <label>
                            <span>{t("storefront")}</span>
                            <select
                              className="input"
                              value={row.storefront}
                              disabled={busy}
                              aria-invalid={!row.storefront || !known}
                              onChange={(event) => patch(section, {
                                overrides: control.overrides.map((candidate, candidateIndex) => (
                                  candidateIndex === index
                                    ? { ...candidate, storefront: event.target.value }
                                    : candidate
                                )),
                              })}
                            >
                              <option value="">{t("selectStorefront")}</option>
                              {!known ? (
                                <option value={row.storefront}>
                                  {t("unknownStorefront", { code: row.storefront })}
                                </option>
                              ) : null}
                              {storefronts.map((storefront) => (
                                <option
                                  key={storefront.alpha3}
                                  value={storefront.alpha3}
                                  disabled={storefront.alpha3 !== row.storefront
                                    && usedStorefronts.has(storefront.alpha3)}
                                >
                                  {storefront.name} · {storefront.alpha3}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{t("availability")}</span>
                            <select
                              className="input"
                              value={row.enabled ? "true" : "false"}
                              disabled={busy}
                              onChange={(event) => patch(section, {
                                overrides: control.overrides.map((candidate, candidateIndex) => (
                                  candidateIndex === index
                                    ? { ...candidate, enabled: event.target.value === "true" }
                                    : candidate
                                )),
                              })}
                            >
                              <option value="true">{t("available")}</option>
                              <option value="false">{t("unavailable")}</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            className="button button-ghost button-danger button-small"
                            disabled={busy}
                            onClick={() => patch(section, {
                              overrides: control.overrides.filter(
                                (_, candidateIndex) => candidateIndex !== index,
                              ),
                            })}
                          >
                            {t("removeOverride")}
                          </button>
                          {!known ? (
                            <small className="field-error" role="alert">
                              {t("unknownStorefront", { code: row.storefront })}
                            </small>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="auth-policy-empty">{t("emptyOverrides")}</p>
                )}

                <div className="setting-meta section-availability-meta">
                  <span>
                    {t("globalUpdated")}: {formatDate(control.enabledUpdatedAt, locale, true)}
                    {control.enabledUpdatedBy ? ` · ${t("updatedBy")}: ${control.enabledUpdatedBy}` : ""}
                  </span>
                  <span>
                    {t("overridesUpdated")}: {formatDate(control.overridesUpdatedAt, locale, true)}
                    {control.overridesUpdatedBy ? ` · ${t("updatedBy")}: ${control.overridesUpdatedBy}` : ""}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

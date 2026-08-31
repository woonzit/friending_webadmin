"use client";

import React, { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import {
  PHONE_DIAL_FORMAT_MAX_LENGTH,
  authPolicyDraftWithChanges,
  authPolicySelectedCallingCodes,
  localizedAuthPolicyCallingCodes,
  localizedAuthPolicyRegions,
  localizedAuthPolicyStorefronts,
  phoneDialFormatMask,
  phoneDialMaskValid,
  renderPhoneDialFormatSample,
  updatePhoneDialFormat,
  type AuthPolicyConfiguration,
  type LocalizedAuthPolicyCallingCode,
  type LocalizedAuthPolicyRegion,
  type LocalizedAuthPolicyStorefront,
  type PhoneDialFormat,
  type RegionRule,
} from "@/lib/authPolicyConfiguration";

type Props = {
  value: AuthPolicyConfiguration;
  busy: boolean;
  conflictRevision: number | null;
  onSave: () => void;
  onChange: (value: AuthPolicyConfiguration) => void;
};

type StorefrontSelectProps = {
  value: string;
  storefronts: readonly LocalizedAuthPolicyStorefront[];
  usedStorefronts: ReadonlySet<string>;
  busy: boolean;
  label: string;
  placeholder: string;
  unknownLabel: (code: string) => string;
  onChange: (value: string) => void;
};

function StorefrontSelect({
  value,
  storefronts,
  usedStorefronts,
  busy,
  label,
  placeholder,
  unknownLabel,
  onChange,
}: StorefrontSelectProps) {
  const known = !value || storefronts.some((storefront) => storefront.alpha3 === value);
  return (
    <label className="auth-policy-storefront-field">
      <span>{label}</span>
      <select
        className="input"
        value={value}
        disabled={busy}
        aria-invalid={!value || !known}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {!known ? <option value={value}>{unknownLabel(value)}</option> : null}
        {storefronts.map((storefront) => (
          <option
            key={storefront.alpha3}
            value={storefront.alpha3}
            disabled={storefront.alpha3 !== value && usedStorefronts.has(storefront.alpha3)}
          >
            {storefront.name} · {storefront.alpha3}
          </option>
        ))}
      </select>
    </label>
  );
}

type RegionControlProps = {
  id: string;
  value: RegionRule;
  regions: readonly LocalizedAuthPolicyRegion[];
  busy: boolean;
  onChange: (value: RegionRule) => void;
};

function MethodPreview({ scope, phone, email }: { scope: string; phone: boolean; email: boolean }) {
  const t = useTranslations("configuration.authPolicy");
  const methods = [
    phone ? t("phone.short") : null,
    email ? t("email.short") : null,
    t("apple.preview"),
  ].filter((method): method is string => method !== null);
  return (
    <p className="auth-policy-method-preview">
      {t("methodPreview", { scope, methods: methods.join(" + ") })}
    </p>
  );
}

function RegionControl({
  id,
  value,
  regions,
  busy,
  onChange,
}: RegionControlProps) {
  const t = useTranslations("configuration.authPolicy");
  const [selectedRegion, setSelectedRegion] = useState("");
  const selectedRegions = value === "ALL" ? [] : value;
  const selectedSet = new Set(selectedRegions);
  const regionMap = new Map(regions.map((region) => [region.alpha2, region]));

  function addRegion() {
    const region = regions.find((candidate) => candidate.alpha2 === selectedRegion);
    if (!region || value === "ALL") return;
    const next = [...new Set([...value, region.alpha2])]
      .sort((left, right) => left.localeCompare(right));
    onChange(next);
    setSelectedRegion("");
  }

  return (
    <fieldset className="auth-policy-dial-control">
      <legend className="sr-only">{t("regionRule")}</legend>
      <div className="auth-policy-rule-options">
        <label className={value === "ALL" ? "selected" : ""}>
          <input
            type="radio"
            name={`${id}-mode`}
            checked={value === "ALL"}
            disabled={busy}
            onChange={() => onChange("ALL")}
          />
          <span>{t("allCountries")}</span>
        </label>
        <label className={value !== "ALL" ? "selected" : ""}>
          <input
            type="radio"
            name={`${id}-mode`}
            checked={value !== "ALL"}
            disabled={busy}
            onChange={() => onChange([])}
          />
          <span>{t("selectedCountries")}</span>
        </label>
      </div>
      {value !== "ALL" ? (
        <div className="auth-policy-dial-picker">
          <div className="auth-policy-dial-add">
            <label>
              <span>{t("country")}</span>
              <select
                className="input"
                value={selectedRegion}
                disabled={busy}
                onChange={(event) => setSelectedRegion(event.target.value)}
              >
                <option value="">{t("selectCountry")}</option>
                {regions.map((region) => (
                  <option
                    key={region.alpha2}
                    value={region.alpha2}
                    disabled={selectedSet.has(region.alpha2)}
                  >
                    {region.name} · {region.alpha2} · +{region.callingCode}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || !selectedRegion}
              onClick={addRegion}
            >
              {t("addCountry")}
            </button>
          </div>
          {selectedRegions.length ? (
            <div className="auth-policy-region-chips" aria-label={t("selectedCountryList")}>
              {selectedRegions.map((code) => {
                const region = regionMap.get(code);
                return (
                  <div className="auth-policy-region-chip-stack" key={code}>
                    <span
                      className={`auth-policy-region-chip${region ? "" : " is-invalid"}`}
                      aria-invalid={!region}
                    >
                      <span>
                        <strong>{region?.name ?? t("unknownCountry", { code })}</strong>
                        <small>{region ? `${region.alpha2} · +${region.callingCode}` : code}</small>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t("removeCountry", { country: region?.name ?? code })}
                        onClick={() => onChange(selectedRegions.filter((candidate) => candidate !== code))}
                      >
                        ×
                      </button>
                    </span>
                    {!region ? (
                      <small className="field-error" role="alert">
                        {t("unknownCountry", { code })}
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="auth-policy-empty">{t("noCountries")}</p>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}

type PhoneFormatControlsProps = {
  codes: readonly string[];
  formats: readonly PhoneDialFormat[];
  callingCodes: readonly LocalizedAuthPolicyCallingCode[];
  busy: boolean;
  onChange: (code: string, mask: string) => void;
};

function PhoneFormatControls({
  codes,
  formats,
  callingCodes,
  busy,
  onChange,
}: PhoneFormatControlsProps) {
  const t = useTranslations("configuration.authPolicy");
  const callingCodeMap = new Map(callingCodes.map((entry) => [entry.code, entry]));
  if (codes.length === 0) return <p className="auth-policy-empty">{t("emptyDialFormats")}</p>;
  return (
    <div className="auth-policy-dial-chips">
      {codes.map((code) => {
        const mask = phoneDialFormatMask(formats, code);
        const valid = mask === "" || phoneDialMaskValid(mask);
        const callingCode = callingCodeMap.get(code);
        const sample = mask === "" ? null : renderPhoneDialFormatSample(code, mask);
        const hintId = `auth-policy-format-${code}-hint`;
        return (
          <div className="auth-policy-dial-format-row" data-format-code={code} key={code}>
            <div className="auth-policy-dial-chip-stack">
              <span
                className={`auth-policy-dial-chip${callingCode ? "" : " is-invalid"}`}
                aria-invalid={!callingCode}
              >
                +{code}
              </span>
              <small className={callingCode ? "field-hint" : "field-error"}>
                {callingCode
                  ? callingCode.exampleName
                  : t("unknownCallingCode", { code: `+${code}` })}
              </small>
            </div>
            <label className="auth-policy-dial-format-field">
              <span>{t("dialFormatLabel", { code: `+${code}` })}</span>
              <input
                className="input"
                value={mask}
                maxLength={PHONE_DIAL_FORMAT_MAX_LENGTH}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!valid}
                aria-describedby={hintId}
                placeholder={t("dialFormatPlaceholder")}
                onChange={(event) => onChange(code, event.target.value)}
              />
              {valid ? (
                <small className="field-hint" id={hintId}>
                  {sample ? t("dialFormatSample", { sample }) : t("dialFormatAutomatic")}
                </small>
              ) : (
                <small className="field-error" id={hintId} role="alert">
                  {t("dialFormatInvalid")}
                </small>
              )}
            </label>
          </div>
        );
      })}
    </div>
  );
}

export default function AuthPolicyConfigurationCard({
  value,
  busy,
  conflictRevision,
  onSave,
  onChange,
}: Props) {
  const t = useTranslations("configuration.authPolicy");
  const common = useTranslations("common");
  const locale = useLocale();
  const storefronts = useMemo(
    () => localizedAuthPolicyStorefronts(value.vocabulary, locale),
    [locale, value.vocabulary],
  );
  const callingCodes = useMemo(
    () => localizedAuthPolicyCallingCodes(value.vocabulary, locale),
    [locale, value.vocabulary],
  );
  const regions = useMemo(
    () => localizedAuthPolicyRegions(value.vocabulary, locale),
    [locale, value.vocabulary],
  );
  const methodStorefronts = new Set(value.methodOverrides.map((row) => row.storefront));
  const regionStorefronts = new Set(value.regionOverrides.map((row) => row.storefront));
  const formatCodes = [...new Set([
    ...authPolicySelectedCallingCodes(value),
    ...value.phoneDialFormats.map((row) => row.code),
  ])].sort((left, right) => Number(left) - Number(right));
  const warningCodes = [...new Set(value.vocabularyWarnings.flatMap((warning) => warning.codes))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  function patch(next: Partial<AuthPolicyConfiguration>) {
    onChange(authPolicyDraftWithChanges(value, next));
  }

  function addMethodOverride() {
    if (value.methodOverrides.some((row) => !row.storefront)) return;
    patch({
      methodOverrides: [
        ...value.methodOverrides,
        { storefront: "", ...value.defaultMethods },
      ],
    });
  }

  function addRegionOverride() {
    if (value.regionOverrides.some((row) => !row.storefront)) return;
    patch({
      regionOverrides: [
        ...value.regionOverrides,
        {
          storefront: "",
          regions: value.defaultRegions === "ALL" ? "ALL" : [...value.defaultRegions],
        },
      ],
    });
  }

  function changeDialFormat(code: string, mask: string) {
    patch({
      phoneDialFormats: updatePhoneDialFormat(value.phoneDialFormats, code, mask),
    });
  }

  return (
    <section className="panel auth-policy-panel">
      <div className="panel-header auth-policy-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <div className="auth-policy-header-actions">
          <span className="status-badge neutral">{t("revision", { revision: value.revision })}</span>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={onSave}
          >
            {busy ? common("saving") : t("savePolicy")}
          </button>
        </div>
      </div>
      <div className="panel-body auth-policy-body">
        {conflictRevision !== null ? (
          <div className="alert alert-error auth-policy-inline-alert" role="status">
            {t("conflictReloaded", { revision: conflictRevision })}
          </div>
        ) : null}
        {warningCodes.length > 0 ? (
          <div className="alert alert-error auth-policy-inline-alert" role="alert">
            {t("vocabularyWarning", { codes: warningCodes.join(", ") })}
          </div>
        ) : null}
        <section className="auth-policy-section">
          <div className="setting-copy">
            <h3>{t("globalTitle")}</h3>
            <p>{t("globalCopy")}</p>
          </div>
          <div className="auth-policy-method-grid">
            {(["phone", "email"] as const).map((method) => (
              <label className="auth-policy-method" key={method}>
                <span>
                  <strong>{t(`${method}.title`)}</strong>
                  <small>{t(`${method}.copy`)}</small>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={value.defaultMethods[method]}
                    disabled={busy}
                    onChange={(event) => patch({
                      defaultMethods: {
                        ...value.defaultMethods,
                        [method]: event.target.checked,
                      },
                    })}
                  />
                  <span className="switch-track" />
                </span>
              </label>
            ))}
            <label className="auth-policy-method is-readonly">
              <span>
                <strong>{t("apple.title")}</strong>
                <small>{t("apple.copy")}</small>
              </span>
              <span className="switch is-disabled">
                <input type="checkbox" checked disabled readOnly />
                <span className="switch-track" />
              </span>
            </label>
          </div>
          <MethodPreview
            scope={t("globalPreview")}
            phone={value.defaultMethods.phone}
            email={value.defaultMethods.email}
          />
          {!value.defaultMethods.phone && !value.defaultMethods.email ? (
            <p className="field-error auth-policy-inline-error" role="alert">
              {t("errors.noMethod")}
            </p>
          ) : null}
        </section>

        <section className="auth-policy-section">
          <div className="auth-policy-section-heading">
            <div className="setting-copy">
              <h3>{t("overridesTitle")}</h3>
              <p>{t("overridesCopy")}</p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy
                || value.methodOverrides.length >= storefronts.length
                || value.methodOverrides.some((row) => !row.storefront)}
              onClick={addMethodOverride}
            >
              {t("addOverride")}
            </button>
          </div>
          {value.methodOverrides.length ? (
            <div className="auth-policy-override-list">
              {value.methodOverrides.map((row, index) => (
                <article className="auth-policy-override-row" key={`${row.storefront}-${index}`}>
                  <div className="auth-policy-storefront-stack">
                    <StorefrontSelect
                      value={row.storefront}
                      storefronts={storefronts}
                      usedStorefronts={methodStorefronts}
                      busy={busy}
                      label={t("storefront")}
                      placeholder={t("selectStorefront")}
                      unknownLabel={(code) => t("unknownStorefront", { code })}
                      onChange={(storefront) => patch({
                        methodOverrides: value.methodOverrides.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, storefront } : candidate
                        )),
                      })}
                    />
                    <MethodPreview
                      scope={row.storefront || t("pendingStorefrontPreview")}
                      phone={row.phone}
                      email={row.email}
                    />
                  </div>
                  <div className="auth-policy-row-methods">
                    {(["phone", "email"] as const).map((method) => (
                      <label key={method}>
                        <input
                          type="checkbox"
                          checked={row[method]}
                          disabled={busy}
                          onChange={(event) => patch({
                            methodOverrides: value.methodOverrides.map((candidate, candidateIndex) => (
                              candidateIndex === index
                                ? { ...candidate, [method]: event.target.checked }
                                : candidate
                            )),
                          })}
                        />
                        <span>{t(`${method}.short`)}</span>
                      </label>
                    ))}
                    <span className="auth-policy-apple-fixed">{t("apple.short")}</span>
                  </div>
                  <button
                    type="button"
                    className="button button-ghost button-danger"
                    disabled={busy}
                    onClick={() => patch({
                      methodOverrides: value.methodOverrides.filter((_, candidateIndex) => candidateIndex !== index),
                    })}
                  >
                    {t("removeOverride")}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="auth-policy-empty">{t("emptyOverrides")}</p>
          )}
        </section>

        <section className="auth-policy-section">
          <div className="setting-copy">
            <h3>{t("dialTitle")}</h3>
            <p>{t("dialCopy")}</p>
          </div>
          <RegionControl
            id="auth-policy-global-region"
            value={value.defaultRegions}
            regions={regions}
            busy={busy}
            onChange={(defaultRegions) => patch({ defaultRegions })}
          />
        </section>

        <section className="auth-policy-section">
          <div className="auth-policy-section-heading">
            <div className="setting-copy">
              <h3>{t("dialOverridesTitle")}</h3>
              <p>{t("dialOverridesCopy")}</p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy
                || value.regionOverrides.length >= storefronts.length
                || value.regionOverrides.some((row) => !row.storefront)}
              onClick={addRegionOverride}
            >
              {t("addDialOverride")}
            </button>
          </div>
          {value.regionOverrides.length ? (
            <div className="auth-policy-dial-overrides">
              {value.regionOverrides.map((row, index) => (
                <article className="auth-policy-dial-override" key={`${row.storefront}-${index}`}>
                  <div className="auth-policy-dial-override-heading">
                    <StorefrontSelect
                      value={row.storefront}
                      storefronts={storefronts}
                      usedStorefronts={regionStorefronts}
                      busy={busy}
                      label={t("storefront")}
                      placeholder={t("selectStorefront")}
                      unknownLabel={(code) => t("unknownStorefront", { code })}
                      onChange={(storefront) => patch({
                        regionOverrides: value.regionOverrides.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, storefront } : candidate
                        )),
                      })}
                    />
                    <button
                      type="button"
                      className="button button-ghost button-danger"
                      disabled={busy}
                      onClick={() => patch({
                        regionOverrides: value.regionOverrides.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      })}
                    >
                      {t("removeDialOverride")}
                    </button>
                  </div>
                  <RegionControl
                    id={`auth-policy-region-${index}`}
                    value={row.regions}
                    regions={regions}
                    busy={busy}
                    onChange={(selectedRegions) => patch({
                      regionOverrides: value.regionOverrides.map((candidate, candidateIndex) => (
                        candidateIndex === index
                          ? { ...candidate, regions: selectedRegions }
                          : candidate
                      )),
                    })}
                  />
                </article>
              ))}
            </div>
          ) : (
            <p className="auth-policy-empty">{t("emptyDialOverrides")}</p>
          )}
        </section>

        <section className="auth-policy-section">
          <div className="setting-copy">
            <h3>{t("dialFormatsTitle")}</h3>
            <p>{t("dialFormatHelp")}</p>
          </div>
          <PhoneFormatControls
            codes={formatCodes}
            formats={value.phoneDialFormats}
            callingCodes={callingCodes}
            busy={busy}
            onChange={changeDialFormat}
          />
        </section>

        <div className="setting-meta auth-policy-meta">
          <span>{t("updatedAt")}: {formatDate(value.updatedAt, locale, true)}</span>
          {value.updatedBy ? <span>{t("updatedBy")}: {value.updatedBy}</span> : null}
        </div>
      </div>
    </section>
  );
}

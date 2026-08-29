"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import {
  localizedAuthPolicyCountries,
  type AuthPolicyConfiguration,
  type DialCodeRule,
  type LocalizedAuthPolicyCountry,
} from "@/lib/authPolicyConfiguration";

type Props = {
  value: AuthPolicyConfiguration;
  busy: boolean;
  onSave: () => void;
  onChange: (value: AuthPolicyConfiguration) => void;
};

type StorefrontSelectProps = {
  value: string;
  countries: readonly LocalizedAuthPolicyCountry[];
  usedStorefronts: ReadonlySet<string>;
  busy: boolean;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
};

function StorefrontSelect({
  value,
  countries,
  usedStorefronts,
  busy,
  label,
  placeholder,
  onChange,
}: StorefrontSelectProps) {
  return (
    <label className="auth-policy-storefront-field">
      <span>{label}</span>
      <select
        className="input"
        value={value}
        disabled={busy}
        aria-invalid={!value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {countries.map((country) => (
          <option
            key={country.alpha3}
            value={country.alpha3}
            disabled={country.alpha3 !== value && usedStorefronts.has(country.alpha3)}
          >
            {country.name} · {country.alpha3}
          </option>
        ))}
      </select>
    </label>
  );
}

type DialCodeControlProps = {
  id: string;
  value: DialCodeRule;
  countries: readonly LocalizedAuthPolicyCountry[];
  busy: boolean;
  onChange: (value: DialCodeRule) => void;
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

function DialCodeControl({ id, value, countries, busy, onChange }: DialCodeControlProps) {
  const t = useTranslations("configuration.authPolicy");
  const [selectedCountry, setSelectedCountry] = useState("");
  const selectedCodes = value === "ALL" ? [] : value;
  const selectedSet = new Set(selectedCodes);

  function addCountry() {
    const country = countries.find((candidate) => candidate.alpha3 === selectedCountry);
    if (!country || value === "ALL") return;
    const next = [...new Set([...value, ...country.dialCodes])]
      .sort((left, right) => Number(left) - Number(right));
    onChange(next);
    setSelectedCountry("");
  }

  return (
    <fieldset className="auth-policy-dial-control">
      <legend className="sr-only">{t("dialRule")}</legend>
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
              <span>{t("callingCodeCountry")}</span>
              <select
                className="input"
                value={selectedCountry}
                disabled={busy}
                onChange={(event) => setSelectedCountry(event.target.value)}
              >
                <option value="">{t("selectCallingCodeCountry")}</option>
                {countries.map((country) => (
                  <option
                    key={country.alpha3}
                    value={country.alpha3}
                    disabled={country.dialCodes.every((code) => selectedSet.has(code))}
                  >
                    {country.name} · {country.dialCodes.map((code) => `+${code}`).join(", ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || !selectedCountry}
              onClick={addCountry}
            >
              {t("addCallingCode")}
            </button>
          </div>
          {selectedCodes.length ? (
            <div className="auth-policy-dial-chips" aria-label={t("selectedCallingCodes")}>
              {selectedCodes.map((code) => (
                <span className="auth-policy-dial-chip" key={code}>
                  +{code}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t("removeCallingCode", { code: `+${code}` })}
                    onClick={() => onChange(selectedCodes.filter((candidate) => candidate !== code))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="auth-policy-empty">{t("noCallingCodes")}</p>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}

export default function AuthPolicyConfigurationCard({ value, busy, onSave, onChange }: Props) {
  const t = useTranslations("configuration.authPolicy");
  const common = useTranslations("common");
  const locale = useLocale();
  const countries = useMemo(() => localizedAuthPolicyCountries(locale), [locale]);
  const methodStorefronts = new Set(value.methodOverrides.map((row) => row.storefront));
  const dialStorefronts = new Set(value.dialCodeOverrides.map((row) => row.storefront));

  function patch(next: Partial<AuthPolicyConfiguration>) {
    onChange({ ...value, ...next });
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

  function addDialOverride() {
    if (value.dialCodeOverrides.some((row) => !row.storefront)) return;
    patch({
      dialCodeOverrides: [
        ...value.dialCodeOverrides,
        {
          storefront: "",
          dialCodes: value.defaultDialCodes === "ALL" ? "ALL" : [...value.defaultDialCodes],
        },
      ],
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
                || value.methodOverrides.length >= countries.length
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
                      countries={countries}
                      usedStorefronts={methodStorefronts}
                      busy={busy}
                      label={t("storefront")}
                      placeholder={t("selectStorefront")}
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
          <DialCodeControl
            id="auth-policy-global-dial"
            value={value.defaultDialCodes}
            countries={countries}
            busy={busy}
            onChange={(defaultDialCodes) => patch({ defaultDialCodes })}
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
                || value.dialCodeOverrides.length >= countries.length
                || value.dialCodeOverrides.some((row) => !row.storefront)}
              onClick={addDialOverride}
            >
              {t("addDialOverride")}
            </button>
          </div>
          {value.dialCodeOverrides.length ? (
            <div className="auth-policy-dial-overrides">
              {value.dialCodeOverrides.map((row, index) => (
                <article className="auth-policy-dial-override" key={`${row.storefront}-${index}`}>
                  <div className="auth-policy-dial-override-heading">
                    <StorefrontSelect
                      value={row.storefront}
                      countries={countries}
                      usedStorefronts={dialStorefronts}
                      busy={busy}
                      label={t("storefront")}
                      placeholder={t("selectStorefront")}
                      onChange={(storefront) => patch({
                        dialCodeOverrides: value.dialCodeOverrides.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, storefront } : candidate
                        )),
                      })}
                    />
                    <button
                      type="button"
                      className="button button-ghost button-danger"
                      disabled={busy}
                      onClick={() => patch({
                        dialCodeOverrides: value.dialCodeOverrides.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      })}
                    >
                      {t("removeDialOverride")}
                    </button>
                  </div>
                  <DialCodeControl
                    id={`auth-policy-dial-${index}`}
                    value={row.dialCodes}
                    countries={countries}
                    busy={busy}
                    onChange={(dialCodes) => patch({
                      dialCodeOverrides: value.dialCodeOverrides.map((candidate, candidateIndex) => (
                        candidateIndex === index ? { ...candidate, dialCodes } : candidate
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

        <div className="setting-meta auth-policy-meta">
          <span>{t("updatedAt")}: {formatDate(value.updatedAt, locale, true)}</span>
          {value.updatedBy ? <span>{t("updatedBy")}: {value.updatedBy}</span> : null}
        </div>
      </div>
    </section>
  );
}

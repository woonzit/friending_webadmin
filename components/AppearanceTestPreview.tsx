"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import AppearanceLandingPreview from "@/components/AppearanceLandingPreview";
import AppearancePalettePreview from "@/components/AppearancePalettePreview";
import { adminCall } from "@/lib/adminClient";
import {
  APPEARANCE_PALETTE_MODES,
  APPEARANCE_PALETTE_ROLES,
  APPEARANCE_DEFAULT_LANDING,
  appearanceTrim,
  appearancePreviewLandingFields,
  decodeAppearancePreviewResponse,
  resolveAppearanceLanding,
  type AppearancePreviewPayload,
  type LocalizedAppearanceCountry,
} from "@/lib/appearanceRules";

type Props = {
  countries: readonly LocalizedAppearanceCountry[];
  ruleNames: ReadonlyMap<string, string>;
};

/**
 * "Preview for a test location": Core's resolver answers exactly what the app
 * would receive for the given storefront, coordinates or IP. No rule is
 * resolved here; the panel only adapts Core's authoritative presentation to
 * the shared phone component.
 */
export default function AppearanceTestPreview({ countries, ruleNames }: Props) {
  const t = useTranslations("appearance.testPreview");
  const [storefront, setStorefront] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [ip, setIp] = useState("");
  const [lang, setLang] = useState<"en" | "hu">("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AppearancePreviewPayload | null>(null);

  async function run() {
    if (busy) return;
    const body: Record<string, unknown> = { lang, appearance_schema: 2 };
    if (storefront) body.storefront_country = storefront;
    if (latitude.trim() !== "" || longitude.trim() !== "") {
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      if (latitude.trim() === "" || longitude.trim() === "" || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
        || parsedLatitude < -90 || parsedLatitude > 90 || parsedLongitude < -180 || parsedLongitude > 180) {
        setError(t("coordinatesInvalid"));
        return;
      }
      body.latitude = parsedLatitude;
      body.longitude = parsedLongitude;
    }
    // Finding 26: the Core-bound IP is PHP-trimmed only; Unicode padding reaches the strict proxy boundary and is refused there.
    const ipValue = appearanceTrim(ip);
    if (ipValue !== "") body.ip = ipValue;
    setBusy(true);
    setError("");
    const response = await adminCall("appearance_rules_preview", body);
    setBusy(false);
    const decoded = decodeAppearancePreviewResponse(response);
    if (!decoded.ok) {
      setError(decoded.kind === "refused" && decoded.error === "invalid-input" ? t("inputInvalid") : t("previewError"));
      setResult(null);
      return;
    }
    if (decoded.value.landing.schema !== 2
      || decoded.value.landing_flat === null || decoded.value.landing_flat_sources === null
      || decoded.value.landing_flat_defaults === null) {
      setError(t("previewError"));
      setResult(null);
      return;
    }
    setResult(decoded.value);
  }

  const matchedRuleName = result && result.matched.rule_id ? ruleNames.get(result.matched.rule_id) ?? result.matched.rule_id : "";

  return (
    <section className="panel appearance-test-preview">
      <div className="panel-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="form-grid appearance-test-form">
          <label className="field">
            <span>{t("storefront")}</span>
            <select value={storefront} disabled={busy} onChange={(event) => setStorefront(event.target.value)}>
              <option value="">{t("storefrontAny")}</option>
              {countries.map((country) => (
                <option key={country.alpha3} value={country.alpha3}>{country.name} · {country.alpha3}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("language")}</span>
            <select value={lang} disabled={busy} onChange={(event) => setLang(event.target.value === "hu" ? "hu" : "en")}>
              <option value="en">{t("languageEn")}</option>
              <option value="hu">{t("languageHu")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("latitude")}</span>
            <input type="number" min={-90} max={90} step="0.000001" value={latitude} disabled={busy} onChange={(event) => setLatitude(event.target.value)} placeholder="47.497900" />
          </label>
          <label className="field">
            <span>{t("longitude")}</span>
            <input type="number" min={-180} max={180} step="0.000001" value={longitude} disabled={busy} onChange={(event) => setLongitude(event.target.value)} placeholder="19.040200" />
          </label>
          <label className="field">
            <span>{t("ip")}</span>
            <input value={ip} maxLength={45} disabled={busy} spellCheck={false} onChange={(event) => setIp(event.target.value)} placeholder="203.0.113.7" />
            <small className="field-hint">{t("ipHint")}</small>
          </label>
          <div className="field appearance-test-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void run()}>
              {busy ? t("running") : t("run")}
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {result && (
          <div className="appearance-test-result">
            <div className="hero-meta">
              <span className={`badge ${result.matched.scope === "default" ? "badge-inactive" : "badge-active"}`}>
                {t(`matched.${result.matched.scope}`)}
                {matchedRuleName ? ` · ${matchedRuleName}` : ""}
              </span>
              <span className="badge">{t(`source.${result.matched.location_source}`)}</span>
              <span className="badge">{t("revision", { revision: result.revision, version: result.content_version })}</span>
            </div>
            <div className="appearance-test-grid">
              <div className="app-landing-preview">
                <AppearanceLandingPreview
                  content={resolveAppearanceLanding(
                    [appearancePreviewLandingFields(result.landing, lang)],
                    result.landing_flat_defaults ?? APPEARANCE_DEFAULT_LANDING,
                    lang,
                  )}
                  fallbackLabel={t("builtInBackground")}
                  palette={result.palette.light}
                  paletteMode="light"
                  authMethods="both"
                  labels={{ apple: t("appleButton"), divider: t("divider"), qr: t("qrButton") }}
                />
              </div>
              <div className="appearance-test-palettes">
                {APPEARANCE_PALETTE_MODES.map((mode) => (
                  <div key={mode} className="appearance-test-palette">
                    <AppearancePalettePreview mode={mode} palette={result.palette[mode]} />
                    <ul className="appearance-swatch-list">
                      {APPEARANCE_PALETTE_ROLES.map((role) => (
                        <li key={role}>
                          <span className="appearance-swatch" style={{ background: result.palette[mode][role] }} aria-hidden="true" />
                          <code>{result.palette[mode][role]}</code>
                          <span>{t(`role.${role}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <h3>{t("hero", { count: result.hero.length })}</h3>
            {result.hero.length === 0 ? (
              <p className="appearance-hero-empty">{t("heroEmpty")}</p>
            ) : (
              <ul className="appearance-test-hero-list">
                {result.hero.map((item) => (
                  <li key={item.id}>
                    <span className="badge">{item.type === "video" ? t("typeVideo") : t("typeImage")}</span>
                    <strong>{item.title || item.media_url}</strong>
                    {item.subtitle && <span>{item.subtitle}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

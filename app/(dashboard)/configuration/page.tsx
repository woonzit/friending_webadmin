"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import ProfilePresenceConfiguration from "@/components/ProfilePresenceConfiguration";
import ProfileVerificationConfiguration from "@/components/ProfileVerificationConfiguration";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  normalizeRuntimeSettings,
  runtimeSettingsSavePayload,
  sessionIdleMinutesValid,
  type RuntimeSettings,
} from "@/lib/runtimeConfiguration";

export default function ConfigurationPage() {
  const t = useTranslations("configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!settings) setState("loading");
    const response = await adminCall("get_settings");
    if (!response?.success || !response.settings || typeof response.settings !== "object") {
      setState("error");
      return;
    }
    const normalized = normalizeRuntimeSettings(response.settings);
    if (!normalized) {
      setState("error");
      return;
    }
    setSettings(normalized);
    setState("ready");
  }, [settings]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setBooleanValue(key: "people_hero_enabled" | "demo_system_enabled", value: boolean) {
    setSettings((current) => current ? {
      ...current,
      [key]: { ...current[key], value },
    } : current);
    setMessage(null);
  }

  async function save() {
    if (!settings) return;
    if (!sessionIdleMinutesValid(settings.join_session_idle_minutes.value)) {
      setMessage({ tone: "error", text: t("sessionIdleInvalid") });
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await adminCall("set_settings", {
      settings: runtimeSettingsSavePayload(settings),
    });
    setBusy(false);
    if (!response?.success || !response.settings) {
      setMessage({ tone: "error", text: t("saveError") });
      return;
    }
    const normalized = normalizeRuntimeSettings(response.settings);
    if (!normalized) {
      setMessage({ tone: "error", text: t("saveError") });
      return;
    }
    setSettings(normalized);
    setMessage({ tone: "success", text: t("saved") });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !settings) return <ErrorPanel message={t("loadError")} retry={load} />;

  const rows: Array<{
    key: "people_hero_enabled" | "demo_system_enabled";
    section: string;
    title: string;
    copy: string;
  }> = [
    {
      key: "people_hero_enabled",
      section: t("discovery"),
      title: t("peopleHeroEnabled"),
      copy: t("peopleHeroEnabledCopy"),
    },
    {
      key: "demo_system_enabled",
      section: t("demo"),
      title: t("demoSystemEnabled"),
      copy: t("demoSystemEnabledCopy"),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button className="button button-primary" onClick={() => void save()} disabled={busy}>
            {busy ? common("saving") : common("save")}
          </button>
        }
      />
      {message && <div className={`alert ${message.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{message.text}</div>}
      <div className="section-grid">
        {rows.map((row) => {
          const setting = settings[row.key];
          return (
            <section className="panel" key={row.key}>
              <div className="panel-header"><div><h2>{row.section}</h2></div></div>
              <div className="panel-body settings-list">
                <div className="setting-row">
                  <div>
                    <h3>{row.title}</h3>
                    <p>{row.copy}</p>
                    <div className="setting-meta">
                      <span>{t("updatedAt")}: {formatDate(setting.updated_at, locale, true)}</span>
                      {setting.updated_by && <span>{t("updatedBy")}: {setting.updated_by}</span>}
                    </div>
                  </div>
                  <label className="switch">
                    <span className="sr-only">{row.title}</span>
                    <input
                      type="checkbox"
                      checked={setting.value}
                      onChange={(event) => setBooleanValue(row.key, event.target.checked)}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>
            </section>
          );
        })}
        <section className="panel session-setting-panel">
          <div className="panel-header"><div><h2>{t("session")}</h2></div></div>
          <div className="panel-body settings-list">
            <div className="setting-row session-timeout-row">
              <div>
                <h3>{t("sessionIdleTitle")}</h3>
                <p>{t("sessionIdleCopy")}</p>
                <div className="setting-meta">
                  <span>{t("updatedAt")}: {formatDate(settings.join_session_idle_minutes.updated_at, locale, true)}</span>
                  {settings.join_session_idle_minutes.updated_by && <span>{t("updatedBy")}: {settings.join_session_idle_minutes.updated_by}</span>}
                </div>
              </div>
              <label className="session-timeout-control">
                <span>{t("sessionIdleLabel")}</span>
                <input
                  className="input session-timeout-input"
                  type="number"
                  inputMode="numeric"
                  min={settings.join_session_idle_minutes.minimum ?? 30}
                  max={settings.join_session_idle_minutes.maximum ?? 525600}
                  step={1}
                  value={settings.join_session_idle_minutes.value}
                  aria-invalid={!sessionIdleMinutesValid(settings.join_session_idle_minutes.value)}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setSettings((current) => current ? {
                      ...current,
                      join_session_idle_minutes: {
                        ...current.join_session_idle_minutes,
                        value,
                      },
                    } : current);
                    setMessage(null);
                  }}
                />
                <small>{t("sessionIdleHint", {
                  minimum: settings.join_session_idle_minutes.minimum ?? 30,
                  maximum: settings.join_session_idle_minutes.maximum ?? 525600,
                })}</small>
              </label>
            </div>
          </div>
        </section>
        <section className="panel appearance-setting-panel">
          <div className="panel-header"><div><h2>{t("appearance")}</h2></div></div>
          <div className="panel-body">
            <div className="setting-copy">
              <h3>{t("appearanceMode")}</h3>
              <p>{t("appearanceModeCopy")}</p>
            </div>
            <div className="appearance-mode-options" role="radiogroup" aria-label={t("appearanceMode")}>
              {(["system", "light", "dark"] as const).map((mode) => (
                <label
                  className={`appearance-mode-option${settings.app_appearance_mode.value === mode ? " selected" : ""}`}
                  key={mode}
                >
                  <input
                    type="radio"
                    name="app-appearance-mode"
                    value={mode}
                    checked={settings.app_appearance_mode.value === mode}
                    onChange={() => {
                      setSettings((current) => current ? {
                        ...current,
                        app_appearance_mode: { ...current.app_appearance_mode, value: mode },
                      } : current);
                      setMessage(null);
                    }}
                  />
                  <span className={`appearance-mode-preview ${mode}`} aria-hidden="true">
                    <i />
                  </span>
                  <span>
                    <strong>{t(`appearanceModes.${mode}.title`)}</strong>
                    <small>{t(`appearanceModes.${mode}.copy`)}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="setting-meta appearance-setting-meta">
              <span>{t("updatedAt")}: {formatDate(settings.app_appearance_mode.updated_at, locale, true)}</span>
              {settings.app_appearance_mode.updated_by && <span>{t("updatedBy")}: {settings.app_appearance_mode.updated_by}</span>}
            </div>
          </div>
        </section>
        {settings.public_profile_base_url.allowed_values?.length || settings.public_web_base.value ? (
          <section className="panel">
            <div className="panel-header"><div><h2>{t("profileLink")}</h2></div></div>
            <div className="panel-body">
              {settings.public_web_base.value ? (
                <>
                  <div className="setting-copy">
                    <h3>{t("webBase")}</h3>
                    <p>{t("webBaseCopy")}</p>
                  </div>
                  <label className="session-timeout-control">
                    <input
                      type="url"
                      inputMode="url"
                      spellCheck={false}
                      value={settings.public_web_base.value}
                      onChange={(event) => {
                        const next = event.target.value;
                        setSettings((current) => current ? {
                          ...current,
                          public_web_base: { ...current.public_web_base, value: next },
                        } : current);
                        setMessage(null);
                      }}
                    />
                  </label>
                  <div className="setting-meta">
                    <span>{t("updatedAt")}: {formatDate(settings.public_web_base.updated_at, locale, true)}</span>
                    {settings.public_web_base.updated_by && (
                      <span>{t("updatedBy")}: {settings.public_web_base.updated_by}</span>
                    )}
                  </div>
                </>
              ) : null}
              {settings.public_profile_base_url.allowed_values?.length ? (
              <>
              <div className="setting-copy">
                <h3>{t("profileLinkBase")}</h3>
                <p>{t("profileLinkBaseCopy")}</p>
              </div>
              <div role="radiogroup" aria-label={t("profileLinkBase")}>
                {settings.public_profile_base_url.allowed_values.map((base) => (
                  <label key={base} className="profile-link-base-option">
                    <input
                      type="radio"
                      name="public-profile-base-url"
                      value={base}
                      checked={settings.public_profile_base_url.value === base}
                      onChange={() => {
                        setSettings((current) => current ? {
                          ...current,
                          public_profile_base_url: {
                            ...current.public_profile_base_url,
                            value: base,
                          },
                        } : current);
                        setMessage(null);
                      }}
                    />
                    <span>{base}/@username</span>
                  </label>
                ))}
              </div>
              <div className="setting-meta">
                <span>{t("updatedAt")}: {formatDate(settings.public_profile_base_url.updated_at, locale, true)}</span>
                {settings.public_profile_base_url.updated_by && (
                  <span>{t("updatedBy")}: {settings.public_profile_base_url.updated_by}</span>
                )}
              </div>
              </>
              ) : null}
            </div>
          </section>
        ) : null}
        <aside className="panel safety-panel">
          <div className="panel-header"><h2>{t("safetyTitle")}</h2></div>
          <div className="panel-body"><p className="page-subtitle">{t("safetyCopy")}</p></div>
        </aside>
      </div>
      <ProfilePresenceConfiguration />
      <ProfileVerificationConfiguration />
    </>
  );
}

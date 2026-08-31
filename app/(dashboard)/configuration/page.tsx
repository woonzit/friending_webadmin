"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthPolicyConfigurationCard from "@/components/AuthPolicyConfigurationCard";
import FeatureSwitchesPanel from "@/components/FeatureSwitchesPanel";
import PageHeader from "@/components/PageHeader";
import ProfilePresenceConfiguration from "@/components/ProfilePresenceConfiguration";
import ProfileVerificationConfiguration from "@/components/ProfileVerificationConfiguration";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  authPolicyConflict,
  authPolicyDraftAfterConflict,
  authPolicyDraftIssue,
  authPolicySavePayload,
  authPolicySettingsResponse,
  phoneDialFormatRefusal,
  phoneRegionRefusal,
  type AuthPolicyConfiguration,
  type AuthPolicyDraftIssue,
  type AuthPolicyVocabulary,
} from "@/lib/authPolicyConfiguration";
import {
  FEATURE_SWITCHES_CONTRACT_READY,
} from "@/lib/contractReadiness";
import { formatDate } from "@/lib/format";
import {
  PUSH_DELIVERY_MODES,
  pushAdminError,
  pushDeliverySavePayload,
  pushLocalWriteDenial,
  pushSettingsResponse,
  type PushAdminError,
  type PushDeliverySetting,
} from "@/lib/pushAdmin";
import {
  normalizeRuntimeSettings,
  runtimeSettingsSavePayload,
  sessionIdleMinutesValid,
  type RuntimeSettings,
} from "@/lib/runtimeConfiguration";

type ConfigurationSnapshot = {
  runtime: RuntimeSettings;
  push: PushDeliverySetting | null;
  authPolicy: AuthPolicyConfiguration;
};

function configurationSnapshot(
  response: AdminResponse | null,
  fallbackVocabulary?: AuthPolicyVocabulary,
): ConfigurationSnapshot | null {
  if (!response?.success || !response.settings || typeof response.settings !== "object") {
    return null;
  }
  const runtime = normalizeRuntimeSettings(response.settings);
  if (!runtime) return null;
  const push = pushSettingsResponse(response);
  const authPolicy = authPolicySettingsResponse(response, fallbackVocabulary);
  if (!authPolicy || !push) return null;
  return { runtime, push, authPolicy };
}

export default function ConfigurationPage() {
  const t = useTranslations("configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [pushSetting, setPushSetting] = useState<PushDeliverySetting | null>(null);
  const [authPolicy, setAuthPolicy] = useState<AuthPolicyConfiguration | null>(null);
  const [authPolicyConflictRevision, setAuthPolicyConflictRevision] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const saveInFlight = useRef(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const response = await adminCall("get_settings");
    const snapshot = configurationSnapshot(response);
    if (!snapshot) {
      setState("error");
      return;
    }
    setSettings(snapshot.runtime);
    setPushSetting(snapshot.push);
    setAuthPolicy(snapshot.authPolicy);
    setAuthPolicyConflictRevision(null);
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setBooleanValue(key: "people_hero_enabled" | "demo_system_enabled", value: boolean) {
    setSettings((current) => current ? {
      ...current,
      [key]: { ...current[key], value },
    } : current);
    setMessage(null);
  }

  async function commitSettings(
    payload: Record<string, unknown>,
    kind: "runtime" | "authPolicy",
    expectedRevision?: number,
  ) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const currentAuthPolicy = authPolicy;
    const response = await adminCall("set_settings", {
      settings: payload,
      ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
    });
    const saved = configurationSnapshot(response, currentAuthPolicy?.vocabulary);
    if (saved) {
      if (kind === "runtime") {
        setSettings(saved.runtime);
        setPushSetting(saved.push);
      } else {
        setAuthPolicy(saved.authPolicy);
        setAuthPolicyConflictRevision(null);
      }
      saveInFlight.current = false;
      setBusy(false);
      setMessage({
        tone: "success",
        text: kind === "authPolicy"
          ? t("authPolicy.saved", { revision: saved.authPolicy.revision })
          : t("saved"),
      });
      return;
    }

    const conflict = kind === "authPolicy" ? authPolicyConflict(response) : null;
    const error = pushAdminError(response) ?? pushLocalWriteDenial(response);
    const recovered = configurationSnapshot(await adminCall("get_settings"));
    if (!recovered) {
      saveInFlight.current = false;
      setBusy(false);
      setState("error");
      return;
    }
    if (conflict && currentAuthPolicy) {
      const rebased = authPolicyDraftAfterConflict(currentAuthPolicy, recovered.authPolicy, conflict);
      if (!rebased) {
        saveInFlight.current = false;
        setBusy(false);
        setState("error");
        return;
      }
      setAuthPolicy(rebased);
      setAuthPolicyConflictRevision(rebased.revision);
      saveInFlight.current = false;
      setBusy(false);
      return;
    }
    if (kind === "runtime") {
      setSettings(recovered.runtime);
      setPushSetting(recovered.push);
    } else {
      setAuthPolicy(recovered.authPolicy);
      setAuthPolicyConflictRevision(null);
    }
    saveInFlight.current = false;
    setBusy(false);
    setMessage({
      tone: "error",
      text: kind === "authPolicy"
        ? authPolicySaveError(t, response, error)
        : pushSaveError(t, error),
    });
  }

  async function save() {
    if (!settings) return;
    if (!sessionIdleMinutesValid(settings.join_session_idle_minutes.value)) {
      setMessage({ tone: "error", text: t("sessionIdleInvalid") });
      return;
    }
    const pushPayload = pushDeliverySavePayload(pushSetting?.value);
    if (!pushPayload) {
      setMessage({ tone: "error", text: t("push.invalid") });
      return;
    }
    await commitSettings({
      ...runtimeSettingsSavePayload(settings),
      ...(pushPayload ?? {}),
    }, "runtime");
  }

  async function saveAuthPolicy() {
    if (!authPolicy) return;
    const authPolicyIssue = authPolicyDraftIssue(authPolicy);
    const authPolicyPayload = authPolicySavePayload(authPolicy);
    if (authPolicyIssue || !authPolicyPayload) {
      setMessage({
        tone: "error",
        text: authPolicyIssueMessage(t, authPolicyIssue ?? "revision"),
      });
      return;
    }
    await commitSettings(authPolicyPayload, "authPolicy", authPolicy.revision);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !settings || !authPolicy) {
    return <ErrorPanel message={t("loadError")} retry={load} />;
  }

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
      {FEATURE_SWITCHES_CONTRACT_READY ? <FeatureSwitchesPanel /> : null}
      <AuthPolicyConfigurationCard
        value={authPolicy}
        busy={busy}
        conflictRevision={authPolicyConflictRevision}
        onSave={() => void saveAuthPolicy()}
        onChange={(next) => {
          setAuthPolicy(next);
          setMessage(null);
        }}
      />
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
                      disabled={busy}
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
                  disabled={busy}
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
                    disabled={busy}
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
        {pushSetting ? (
          <section className="panel push-mode-panel">
            <div className="panel-header"><div><h2>{t("push.section")}</h2></div></div>
            <div className="panel-body">
              <div className="setting-copy">
                <h3>{t("push.title")}</h3>
                <p>{t("push.copy")}</p>
              </div>
              <div className="push-mode-options" role="radiogroup" aria-label={t("push.title")}>
                {PUSH_DELIVERY_MODES.map((mode) => (
                  <label
                    className={`push-mode-option${pushSetting.value === mode ? " selected" : ""}`}
                    key={mode}
                  >
                    <input
                      type="radio"
                      name="push-delivery-mode"
                      value={mode}
                      checked={pushSetting.value === mode}
                      disabled={busy}
                      onChange={() => {
                        setPushSetting((current) => current ? { ...current, value: mode } : current);
                        setMessage(null);
                      }}
                    />
                    <span>
                      <strong>{t(`push.modes.${mode}.title`)}</strong>
                      <small>{t(`push.modes.${mode}.copy`)}</small>
                    </span>
                  </label>
                ))}
              </div>
              <p className="page-subtitle push-mode-note">{t("push.separate")}</p>
              <div className="setting-meta">
                <span>{t("updatedAt")}: {formatDate(pushSetting.updated_at, locale, true)}</span>
                {pushSetting.updated_by && <span>{t("updatedBy")}: {pushSetting.updated_by}</span>}
              </div>
            </div>
          </section>
        ) : null}
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
                      disabled={busy}
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
                      disabled={busy}
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

function pushSaveError(
  t: ReturnType<typeof useTranslations<"configuration">>,
  error: PushAdminError | null,
): string {
  if (error === "admin-write-required") return t("push.writeRequired");
  if (error === "settings-invalid" || error === "setting-invalid") return t("push.invalid");
  if (error === "write-failed" || error === null) return t("push.uncertain");
  return t("saveError");
}

function authPolicyIssueMessage(
  t: ReturnType<typeof useTranslations<"configuration">>,
  issue: AuthPolicyDraftIssue,
): string {
  if (issue === "noMethod") return t("authPolicy.errors.noMethod");
  if (issue === "storefront") return t("authPolicy.errors.storefront");
  if (issue === "duplicateStorefront") return t("authPolicy.errors.duplicateStorefront");
  if (issue === "regions") return t("authPolicy.errors.regions");
  if (issue === "vocabulary") return t("authPolicy.errors.vocabulary");
  if (issue === "dialFormatCode") return t("authPolicy.errors.dialFormatCode");
  if (issue === "duplicateDialFormat") return t("authPolicy.errors.duplicateDialFormat");
  if (issue === "dialFormatMask") return t("authPolicy.errors.dialFormatMask");
  return t("authPolicy.errors.revision");
}

function authPolicySaveError(
  t: ReturnType<typeof useTranslations<"configuration">>,
  response: AdminResponse | null,
  error: PushAdminError | null,
): string {
  if (error === "admin-write-required") return t("authPolicy.writeRequired");
  if (
    response?.success === false
    && response.status_code === 422
    && response.error === "auth-policy-no-method"
  ) return t("authPolicy.errors.noMethod");
  const dialFormatRefusal = phoneDialFormatRefusal(response);
  if (dialFormatRefusal?.field === "code") return t("authPolicy.errors.dialFormatCode");
  if (dialFormatRefusal?.field === "mask") return t("authPolicy.errors.dialFormatMask");
  if (dialFormatRefusal?.field === "phone_dial_formats") {
    return t("authPolicy.errors.dialFormats");
  }
  if (phoneRegionRefusal(response)) return t("authPolicy.errors.regions");
  return t("authPolicy.saveError");
}

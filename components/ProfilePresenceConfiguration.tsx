"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  MANDATORY_PROFILE_PRESENCE_MODES,
  OPTIONAL_PROFILE_PRESENCE_MODES,
  PROFILE_PRESENCE_MODES,
  enabledProfilePresenceModes,
  parseProfilePresenceConfigurationPayload,
  profilePresenceConfigurationResponseData,
  profilePresenceConfigurationSaveBody,
  reconciledProfilePresenceCount,
  type ProfilePresenceConfigurationPayload,
  type ProfilePresenceMode,
} from "@/lib/profilePresenceConfiguration";

type Draft = { date_enabled: boolean; now_enabled: boolean };
type Feedback = { tone: "success" | "error"; text: string };

function draftFrom(payload: ProfilePresenceConfigurationPayload): Draft {
  return {
    date_enabled: payload.configuration.date_enabled,
    now_enabled: payload.configuration.now_enabled,
  };
}

export default function ProfilePresenceConfiguration() {
  const t = useTranslations("profilePresence.configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [stored, setStored] = useState<ProfilePresenceConfigurationPayload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmation, setConfirmation] = useState<ProfilePresenceMode[] | null>(null);

  const adopt = useCallback((raw: unknown): boolean => {
    const parsed = parseProfilePresenceConfigurationPayload(raw);
    if (!parsed) return false;
    setStored(parsed);
    setDraft(draftFrom(parsed));
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setFeedback(null);
    const response = await adminCall("profile_presence_configuration");
    setState(response?.success && adopt(profilePresenceConfigurationResponseData(response))
      ? "ready"
      : "error");
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const dirty = Boolean(stored && draft && (
    stored.configuration.date_enabled !== draft.date_enabled
    || stored.configuration.now_enabled !== draft.now_enabled
  ));

  const disabledModes = useMemo(() => {
    if (!stored || !draft) return [];
    return OPTIONAL_PROFILE_PRESENCE_MODES.filter((mode) => {
      const key = `${mode}_enabled` as const;
      return stored.configuration[key] && !draft[key];
    });
  }, [stored, draft]);

  function change(mode: "date" | "now", enabled: boolean) {
    setDraft((current) => current ? { ...current, [`${mode}_enabled`]: enabled } : current);
    setFeedback(null);
  }

  async function executeSave() {
    if (!stored || !draft || busy) return;
    setBusy(true);
    setFeedback(null);
    const candidate = {
      ...stored.configuration,
      ...draft,
      enabled_modes: enabledProfilePresenceModes(draft.date_enabled, draft.now_enabled),
    };
    const response = await adminCall(
      "save_profile_presence_configuration",
      profilePresenceConfigurationSaveBody(candidate),
    );
    setBusy(false);
    setConfirmation(null);

    const authoritative = profilePresenceConfigurationResponseData(response);
    if (!response?.success) {
      if (response?.error === "profile-presence-configuration-conflict" && adopt(authoritative)) {
        setFeedback({ tone: "error", text: t("conflict") });
        return;
      }
      setFeedback({
        tone: "error",
        text: t("saveError", { error: String(response?.error || "core-unavailable") }),
      });
      return;
    }
    const reconciled = reconciledProfilePresenceCount(response);
    if (!adopt(authoritative) || reconciled === null) {
      setFeedback({ tone: "error", text: t("invalidResponse") });
      return;
    }
    setFeedback({
      tone: "success",
      text: reconciled > 0 ? t("savedWithFallback", { count: reconciled }) : t("saved"),
    });
  }

  function requestSave() {
    if (!dirty || busy) return;
    if (disabledModes.length > 0) {
      setConfirmation([...disabledModes]);
      return;
    }
    void executeSave();
  }

  if (state === "loading") {
    return <section id="profile-presence" className="panel presence-config-panel"><div className="panel-body"><p className="page-subtitle">{common("loading")}</p></div></section>;
  }
  if (state === "error" || !stored || !draft) {
    return <section id="profile-presence" className="panel presence-config-panel"><div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div></div><div className="panel-body"><div className="alert alert-error">{t("loadError")}</div><button className="button button-secondary" type="button" onClick={() => void load()}>{common("retry")}</button></div></section>;
  }

  const number = new Intl.NumberFormat(locale);
  const confirmationCount = (confirmation ?? []).reduce(
    (total, mode) => total + stored.selected_counts[mode],
    0,
  );
  const confirmationNames = (confirmation ?? []).map((mode) => t(`modes.${mode}.title`)).join(", ");
  const enabled = new Set(enabledProfilePresenceModes(draft.date_enabled, draft.now_enabled));

  return (
    <>
      <section id="profile-presence" className="panel presence-config-panel">
        <div className="panel-header presence-config-header">
          <div>
            <h2>{t("title")}</h2>
            <p>{t("subtitle")}</p>
            <div className="setting-meta">
              <span>{t("revision", { revision: stored.configuration.revision })}</span>
              <span>{t("updatedAt")}: {stored.configuration.updated_at > 0 ? formatDate(stored.configuration.updated_at, locale, true) : "—"}</span>
              {stored.configuration.updated_by && <span>{t("updatedBy")}: {stored.configuration.updated_by}</span>}
            </div>
          </div>
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={busy || !dirty} onClick={() => { setDraft(draftFrom(stored)); setFeedback(null); }}>{t("reset")}</button>
            <button className="button button-primary" type="button" disabled={busy || !dirty} onClick={requestSave}>{busy ? common("saving") : common("save")}</button>
          </div>
        </div>
        <div className="panel-body presence-config-body">
          {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"}`} role="status">{feedback.text}</div>}
          {dirty && !feedback && <div className="alert alert-info" role="status">{t("unsaved")}</div>}
          <div className="presence-mode-grid">
            {PROFILE_PRESENCE_MODES.map((mode) => {
              const mandatory = MANDATORY_PROFILE_PRESENCE_MODES.includes(mode as "online" | "invisible");
              const active = enabled.has(mode);
              return (
                <article className={`presence-mode-card${active ? " is-active" : ""}`} key={mode}>
                  <div className="presence-mode-heading">
                    <span className={`presence-mode-dot presence-mode-dot-${mode}`} aria-hidden="true" />
                    <div>
                      <h3>{t(`modes.${mode}.title`)}</h3>
                      <p>{t(`modes.${mode}.copy`)}</p>
                    </div>
                  </div>
                  <div className="presence-mode-footer">
                    <span className="presence-mode-count">{t("selectedCount", { count: number.format(stored.selected_counts[mode]) })}</span>
                    <label className="switch">
                      <span className="sr-only">{t(`modes.${mode}.title`)}</span>
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={busy || mandatory}
                        onChange={(event) => {
                          if (mode === "date" || mode === "now") change(mode, event.target.checked);
                        }}
                      />
                      <span className="switch-track" />
                    </label>
                  </div>
                  <span className={`presence-mode-state${mandatory ? " is-locked" : ""}`}>
                    {mandatory ? t("alwaysAvailable") : active ? t("available") : t("unavailable")}
                  </span>
                </article>
              );
            })}
          </div>
          <p className="presence-config-footnote">{t("fallbackRule")}</p>
        </div>
      </section>
      {confirmation && (
        <ConfirmDialog
          title={t("disableConfirmTitle")}
          copy={t("disableConfirmCopy", {
            modes: confirmationNames,
            count: number.format(confirmationCount),
          })}
          confirmLabel={t("disableConfirmAction")}
          busyLabel={common("saving")}
          busy={busy}
          onCancel={() => { if (!busy) setConfirmation(null); }}
          onConfirm={() => void executeSave()}
        />
      )}
    </>
  );
}

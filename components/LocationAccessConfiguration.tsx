"use client";

import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  LOCATION_ACCESS_POLICY_FLAGS,
  LOCATION_ACCESS_POLICY_INITIAL_MODEL,
  locationAccessPolicyCanSave,
  locationAccessPolicyDirty,
  locationAccessPolicyNewlyRequired,
  locationAccessPolicyReadOutcome,
  locationAccessPolicyReducer,
  locationAccessPolicySaveBody,
  locationAccessPolicySaveOutcome,
  type LocationAccessPolicyFlag,
  type LocationAccessPolicyModel,
} from "@/lib/locationAccessPolicy";

/**
 * The location access panel on Configuration (P-073 Part B). It transacts on
 * its own: one read, one compare-and-set save against Core's revision, and one
 * conflict path, independent of every other card on the page.
 */
export function LocationAccessPolicyView({
  model,
  onToggle,
  onSave,
  onDiscard,
  onReload,
}: {
  model: LocationAccessPolicyModel;
  onToggle: (flag: LocationAccessPolicyFlag, value: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  const t = useTranslations("configuration.locationAccess");
  const locale = useLocale();
  const heading = (
    <div>
      <h2>{t("title")}</h2>
      <p>{t("subtitle")}</p>
    </div>
  );

  if (model.phase !== "ready" || !model.stored || !model.draft) {
    const failure = model.phase === "unavailable" ? t("unavailable")
      : model.phase === "error" ? t("loadError")
        : null;
    return (
      <section id="location-access" className="panel presence-config-panel" data-location-access-phase={model.phase}>
        <div className="panel-header presence-config-header">{heading}</div>
        <div className="panel-body presence-config-body">
          {failure ? (
            <>
              <div className="alert alert-error" role="alert">{failure}</div>
              <div className="row-actions">
                <button className="button button-secondary" type="button" disabled={model.busy} onClick={onReload}>{t("reload")}</button>
              </div>
            </>
          ) : <p className="page-subtitle">{t("loading")}</p>}
        </div>
      </section>
    );
  }

  const { configuration, can_write: canWrite } = model.stored;
  const draft = model.draft;
  const dirty = locationAccessPolicyDirty(configuration, draft);
  const notice = model.notice;
  const noticeText = notice === null ? null
    : notice.key === "conflict"
      // "Your choices are still shown" is true only while the kept draft
      // differs from the winning revision; otherwise Save is disabled anyway.
      ? [t("conflict", { revision: notice.revision }), dirty ? t("conflictDraftKept") : null]
        .filter(Boolean).join(" ")
      : notice.key === "saved"
        ? t("saved", { revision: notice.revision })
        : t(notice.key);
  const showReload = !dirty || notice?.tone === "error";

  return (
    <section id="location-access" className="panel presence-config-panel" data-location-access-phase="ready">
      <div className="panel-header presence-config-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
          <div className="setting-meta">
            <span>{t("revision", { revision: configuration.revision })}</span>
            {configuration.revision === 0 ? <span>{t("neverSaved")}</span> : (
              <>
                <span>{t("updatedAt")}: {formatDate(configuration.updated_at, locale, true)}</span>
                {configuration.updated_by ? <span>{t("updatedBy")}: {configuration.updated_by}</span> : null}
              </>
            )}
          </div>
        </div>
        <div className="row-actions">
          {showReload ? (
            <button className="button button-secondary" type="button" disabled={model.busy} onClick={onReload}>{t("reload")}</button>
          ) : null}
          {canWrite ? (
            <>
              <button className="button button-secondary" type="button" disabled={model.busy || !dirty} onClick={onDiscard}>{t("discard")}</button>
              <button className="button button-primary" type="button" data-location-access-save="save" disabled={model.busy || !dirty} onClick={onSave}>
                {model.busy ? t("saving") : t("save")}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="panel-body presence-config-body">
        {noticeText ? (
          <div
            className={`alert ${notice?.tone === "success" ? "alert-success" : "alert-error"}`}
            role={notice?.tone === "success" ? "status" : "alert"}
            data-location-access-notice={notice?.key}
          >
            {noticeText}
          </div>
        ) : null}
        {!canWrite ? <div className="alert alert-info" data-location-access-read-only="true">{t("readOnly")}</div> : null}
        {canWrite && dirty && !noticeText ? <div className="alert alert-info" role="status">{t("unsaved")}</div> : null}
        <div className="presence-mode-grid location-access-grid">
          {LOCATION_ACCESS_POLICY_FLAGS.map((flag) => {
            const required = draft[flag];
            const inputId = `location-access-${flag}`;
            return (
              <article className={`presence-mode-card${required ? " is-active" : ""}`} key={flag} data-location-access-flag={flag}>
                <div className="presence-mode-heading">
                  <div>
                    <h3>{t(`flags.${flag}.title`)}</h3>
                    <p>{t(`flags.${flag}.copy`)}</p>
                  </div>
                </div>
                <div className="presence-mode-footer">
                  <span className="presence-mode-state">
                    {[
                      required ? t("required") : t("notRequired"),
                      required !== configuration[flag] ? t("changed") : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  <label className="switch" htmlFor={inputId}>
                    <span className="sr-only">{t(`flags.${flag}.title`)}</span>
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={required}
                      disabled={model.busy || !canWrite}
                      onChange={(event) => onToggle(flag, event.target.checked)}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
        <p className="presence-config-footnote">{t("scope")}</p>
        <p className="presence-config-footnote">{t("reviewRisk")}</p>
      </div>
    </section>
  );
}

export default function LocationAccessConfiguration() {
  const t = useTranslations("configuration.locationAccess");
  const [model, dispatch] = useReducer(locationAccessPolicyReducer, LOCATION_ACCESS_POLICY_INITIAL_MODEL);
  const [confirming, setConfirming] = useState<LocationAccessPolicyFlag[] | null>(null);
  // One request at a time: a second click can never race a save or a reload.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "loadStarted" });
    const response = await adminCall("location_access_policy");
    dispatch({ type: "loaded", outcome: locationAccessPolicyReadOutcome(response) });
    inFlight.current = false;
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function executeSave() {
    if (inFlight.current || model.busy || !locationAccessPolicyCanSave(model)
      || !model.stored || !model.draft) return;
    inFlight.current = true;
    const body = locationAccessPolicySaveBody(model.stored.configuration.revision, model.draft);
    dispatch({ type: "saveStarted" });
    const response = await adminCall("save_location_access_policy", body);
    const outcome = locationAccessPolicySaveOutcome(response, body);
    setConfirming(null);
    dispatch({ type: "saveFinished", outcome });
    if (outcome.kind === "conflict") {
      // Read the revision that won, but keep the operator's draft on top of it.
      const current = await adminCall("location_access_policy");
      dispatch({ type: "conflictReloaded", outcome: locationAccessPolicyReadOutcome(current) });
    }
    inFlight.current = false;
  }

  function requestSave() {
    if (model.busy || !locationAccessPolicyCanSave(model) || !model.stored || !model.draft) return;
    if (!locationAccessPolicyDirty(model.stored.configuration, model.draft)) return;
    const newlyRequired = locationAccessPolicyNewlyRequired(model.stored.configuration, model.draft);
    if (newlyRequired.length > 0) {
      setConfirming(newlyRequired);
      return;
    }
    void executeSave();
  }

  const confirmCopy = confirming ? [
    t("confirmCopy", { flags: confirming.map((flag) => t(`flags.${flag}.short`)).join(", ") }),
    confirming.includes("required_for_signup") ? t("confirmSignupRisk") : "",
  ].filter(Boolean).join(" ") : "";

  return (
    <>
      <LocationAccessPolicyView
        model={model}
        onToggle={(flag, value) => dispatch({ type: "toggled", flag, value })}
        onSave={requestSave}
        onDiscard={() => dispatch({ type: "discarded" })}
        onReload={() => void load()}
      />
      {confirming ? (
        <ConfirmDialog
          title={t("confirmTitle")}
          copy={confirmCopy}
          confirmLabel={t("confirmAction")}
          busyLabel={t("saving")}
          busy={model.busy}
          onCancel={() => { if (!model.busy) setConfirming(null); }}
          onConfirm={() => void executeSave()}
        />
      ) : null}
    </>
  );
}

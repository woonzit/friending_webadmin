"use client";

import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  FRIENDING_START_METHODS,
  FRIENDING_START_POLICY_INITIAL_MODEL,
  friendingStartPolicyDirty,
  friendingStartPolicyNewlyDisabled,
  friendingStartPolicyReadOutcome,
  friendingStartPolicyReducer,
  friendingStartPolicySaveBody,
  friendingStartPolicySaveOutcome,
  friendingStartPolicySendable,
  friendingStartPolicyUsable,
  type FriendingStartMethod,
  type FriendingStartPolicyModel,
} from "@/lib/friendingStartPolicy";

/**
 * The Friending Start panel on Configuration: which of the two in-person
 * methods - the list of people nearby (radar), phones touched together
 * (touch) - may make two members friends. Like the location access panel it
 * is modelled on, it transacts on its own: one read, one compare-and-set save
 * against Core's revision, and one conflict path, independent of every other
 * card on the page.
 */
export function FriendingStartPolicyView({
  model,
  onToggle,
  onSave,
  onDiscard,
  onReload,
}: {
  model: FriendingStartPolicyModel;
  onToggle: (method: FriendingStartMethod, value: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  const t = useTranslations("configuration.friendingStart");
  const locale = useLocale();

  if (model.phase !== "ready" || !model.stored || !model.draft) {
    // A read that failed shows nothing of the setting: neither switch is drawn, so "unknown" can never read as "off".
    const failure = model.phase === "unavailable" ? t("unavailable")
      : model.phase === "error" ? t("loadError")
        : null;
    return (
      <section id="friending-start" className="panel presence-config-panel" data-friending-start-phase={model.phase}>
        <div className="panel-header presence-config-header">
          <div>
            <h2>{t("title")}</h2>
            <p>{t("subtitle")}</p>
          </div>
        </div>
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
  const dirty = friendingStartPolicyDirty(configuration, draft);
  // Both methods off may be on the screen on the way from one method to the other; it is never sent.
  const bothOff = canWrite && !friendingStartPolicyUsable(draft);
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
    <section id="friending-start" className="panel presence-config-panel" data-friending-start-phase="ready">
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
              <button className="button button-primary" type="button" data-friending-start-save="save"
                disabled={!friendingStartPolicySendable(model)} aria-describedby={bothOff ? "friending-start-both-off" : undefined} onClick={onSave}>
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
            data-friending-start-notice={notice?.key}
          >
            {noticeText}
          </div>
        ) : null}
        {!canWrite ? <div className="alert alert-info" data-friending-start-read-only="true">{t("readOnly")}</div> : null}
        {bothOff ? <div id="friending-start-both-off" className="alert alert-error" role="alert" data-friending-start-both-off="true">{t("bothOff")}</div> : null}
        {canWrite && dirty && !bothOff && !noticeText ? <div className="alert alert-info" role="status">{t("unsaved")}</div> : null}
        <div className="presence-mode-grid friending-start-grid">
          {FRIENDING_START_METHODS.map((method) => {
            const enabled = draft[method];
            const inputId = `friending-start-${method}`;
            return (
              <article className={`presence-mode-card${enabled ? " is-active" : ""}`} key={method} data-friending-start-method={method}>
                <div className="presence-mode-heading">
                  <div>
                    <h3>{t(`methods.${method}.title`)}</h3>
                    <p>{t(`methods.${method}.copy`)}</p>
                  </div>
                </div>
                <div className="presence-mode-footer">
                  <span className="presence-mode-state">
                    {[
                      enabled ? t("enabled") : t("disabled"),
                      enabled !== configuration[method] ? t("changed") : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  <label className="switch" htmlFor={inputId}>
                    <span className="sr-only">{t(`methods.${method}.title`)}</span>
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={enabled}
                      disabled={model.busy || !canWrite}
                      onChange={(event) => onToggle(method, event.target.checked)}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
        <p className="presence-config-footnote">{t("scope")}</p>
        <p className="presence-config-footnote">{t("meetNote")}</p>
      </div>
    </section>
  );
}

export default function FriendingStartConfiguration() {
  const t = useTranslations("configuration.friendingStart");
  const [model, dispatch] = useReducer(friendingStartPolicyReducer, FRIENDING_START_POLICY_INITIAL_MODEL);
  const [confirming, setConfirming] = useState<FriendingStartMethod[] | null>(null);
  // One request at a time: a second click can never race a save or a reload.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "loadStarted" });
    const response = await adminCall("friending_start_policy");
    dispatch({ type: "loaded", outcome: friendingStartPolicyReadOutcome(response) });
    inFlight.current = false;
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function executeSave() {
    // Both methods off never leaves the browser: `friendingStartPolicySendable` refuses it, and the panel says why.
    if (inFlight.current || !friendingStartPolicySendable(model) || !model.stored || !model.draft) return;
    inFlight.current = true;
    const body = friendingStartPolicySaveBody(model.stored.configuration.revision, model.draft);
    dispatch({ type: "saveStarted" });
    const response = await adminCall("save_friending_start_policy", body);
    const outcome = friendingStartPolicySaveOutcome(response, body);
    setConfirming(null);
    dispatch({ type: "saveFinished", outcome });
    if (outcome.kind === "conflict") {
      // Read the revision that won, but keep the operator's draft on top of it.
      const current = await adminCall("friending_start_policy");
      dispatch({ type: "conflictReloaded", outcome: friendingStartPolicyReadOutcome(current) });
    }
    inFlight.current = false;
  }

  function requestSave() {
    if (!friendingStartPolicySendable(model) || !model.stored || !model.draft) return;
    // Switching a method off takes a way to make friends away from members: ask first.
    const newlyDisabled = friendingStartPolicyNewlyDisabled(model.stored.configuration, model.draft);
    if (newlyDisabled.length > 0) {
      setConfirming(newlyDisabled);
      return;
    }
    void executeSave();
  }

  return (
    <>
      <FriendingStartPolicyView
        model={model}
        onToggle={(method, value) => dispatch({ type: "toggled", method, value })}
        onSave={requestSave}
        onDiscard={() => dispatch({ type: "discarded" })}
        onReload={() => void load()}
      />
      {confirming ? (
        <ConfirmDialog
          title={t("confirmTitle")}
          copy={t("confirmCopy", { methods: confirming.map((method) => t(`methods.${method}.short`)).join(", ") })}
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

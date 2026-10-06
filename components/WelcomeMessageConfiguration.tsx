"use client";

import { adminMembershipRefusalForUi } from "@/lib/adminMembershipClientError";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { isAdminWriteRole } from "@/lib/authPolicy";
import { formatDate } from "@/lib/format";
import {
  WELCOME_MESSAGE_LOCALES,
  WELCOME_MESSAGE_MAX_BODY,
  welcomeMessageBodyIssue,
  welcomeMessageEqual,
  welcomeMessageLength,
  welcomeMessageSaveBody,
  welcomeMessageSaveOutcome,
  welcomeMessageSettingsRead,
  type WelcomeMessageLocale,
  type WelcomeMessageStored,
  type WelcomeMessageValue,
} from "@/lib/welcomeMessageConfiguration";

export type WelcomeMessagePhase = "loading" | "ready" | "corrupt" | "error";
export type WelcomeMessageNotice = {
  tone: "success" | "error";
  key: "saved" | "invalid" | "writeRequired" | "refused" | "notApplied";
  error?: string;
};

export type WelcomeMessageModel = {
  phase: WelcomeMessagePhase;
  canWrite: boolean;
  /** The stored value; null while loading, on a load error, or for a damaged row. */
  stored: WelcomeMessageStored | null;
  draft: WelcomeMessageValue | null;
  busy: boolean;
  notice: WelcomeMessageNotice | null;
  /** Save and change metadata of a damaged row (`value: null`). */
  corruptMeta?: { updatedAt: number; updatedBy: string };
};

function draftChanged(model: WelcomeMessageModel): boolean {
  if (!model.draft) return false;
  if (!model.stored) return true;
  const payload = welcomeMessageSaveBody(model.draft);
  return payload
    ? !welcomeMessageEqual(payload.settings.welcome_message, model.stored.value)
    : true;
}

/**
 * The welcome message panel on Configuration. It saves on its own through
 * `set_settings`, sending only the `welcome_message` entry.
 */
export function WelcomeMessageView({
  model,
  onToggle,
  onBody,
  onSave,
  onDiscard,
  onReload,
  onReplace,
}: {
  model: WelcomeMessageModel;
  onToggle: (enabled: boolean) => void;
  onBody: (locale: WelcomeMessageLocale, text: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
  onReplace: () => void;
}) {
  const t = useTranslations("configuration.welcomeMessage");
  const locale = useLocale();
  const heading = (
    <div>
      <h2>{t("title")}</h2>
      <p>{t("subtitle")}</p>
    </div>
  );
  const shell = (children: React.ReactNode, header?: React.ReactNode) => (
    <section id="welcome-message" className="panel presence-config-panel" data-welcome-message-phase={model.phase}>
      <div className="panel-header presence-config-header">{heading}{header}</div>
      <div className="panel-body presence-config-body">{children}</div>
    </section>
  );

  if (model.phase === "loading") return shell(<p className="page-subtitle">{t("loading")}</p>);
  if (model.phase === "error") {
    return shell(<>
      <div className="alert alert-error" role="alert">{t("loadError")}</div>
      <div className="row-actions">
        <button className="button button-secondary" type="button" onClick={onReload}>{t("reload")}</button>
      </div>
    </>);
  }
  if (model.phase === "corrupt" && !model.draft) {
    return shell(<>
      <div className="alert alert-error" role="alert">{t("corrupt")}</div>
      {model.corruptMeta && model.corruptMeta.updatedAt > 0 ? (
        <div className="setting-meta">
          <span>{t("updatedAt")}: {formatDate(model.corruptMeta.updatedAt, locale, true)}</span>
          {model.corruptMeta.updatedBy ? <span>{t("updatedBy")}: {model.corruptMeta.updatedBy}</span> : null}
        </div>
      ) : null}
      <div className="row-actions">
        <button className="button button-secondary" type="button" onClick={onReload}>{t("reload")}</button>
        {model.canWrite ? (
          <button className="button button-primary" type="button" onClick={onReplace}>{t("replace")}</button>
        ) : null}
      </div>
      {!model.canWrite ? <div className="alert alert-info" data-welcome-message-read-only="true">{t("readOnly")}</div> : null}
    </>);
  }

  const draft = model.draft!;
  const stored = model.stored;
  const dirty = draftChanged(model);
  const issues = WELCOME_MESSAGE_LOCALES.map((entry) => welcomeMessageBodyIssue(draft.body[entry]));
  const valid = issues.every((issue) => issue === null);
  const locked = model.busy || !model.canWrite;
  const notice = model.notice;
  const noticeText = notice
    ? notice.key === "refused" ? t("refused", { error: notice.error ?? "" }) : t(notice.key)
    : null;

  const actions = model.canWrite ? (
    <div className="row-actions">
      <button className="button button-secondary" type="button" disabled={model.busy || !dirty} onClick={onDiscard}>{t("discard")}</button>
      <button className="button button-primary" type="button" disabled={model.busy || !dirty || !valid} onClick={onSave}>
        {model.busy ? t("saving") : t("save")}
      </button>
    </div>
  ) : null;

  return shell(<>
    <div className="presence-config-footnote">{t("defaultOn")}</div>
    <div className="setting-meta">
      {stored && stored.updatedAt > 0 ? (
        <>
          <span>{t("updatedAt")}: {formatDate(stored.updatedAt, locale, true)}</span>
          {stored.updatedBy ? <span>{t("updatedBy")}: {stored.updatedBy}</span> : null}
        </>
      ) : stored ? <span>{t("neverSaved")}</span> : <span>{t("replacing")}</span>}
    </div>
    {noticeText ? (
      <div className={`alert ${notice!.tone === "success" ? "alert-success" : "alert-error"}`} role={notice!.tone === "success" ? "status" : "alert"}>
        {noticeText}
      </div>
    ) : null}
    {!model.canWrite ? <div className="alert alert-info" data-welcome-message-read-only="true">{t("readOnly")}</div> : null}
    {model.canWrite && dirty && !noticeText ? <div className="alert alert-info" role="status">{t("unsaved")}</div> : null}
    <div className="setting-row">
      <div>
        <h3>{t("enabled")}</h3>
        <p>{draft.enabled ? t("enabledOn") : t("enabledOff")}</p>
      </div>
      <label className="switch">
        <span className="sr-only">{t("enabled")}</span>
        <input type="checkbox" checked={draft.enabled} disabled={locked} onChange={(event) => onToggle(event.target.checked)} />
        <span className="switch-track" />
      </label>
    </div>
    <div className="welcome-message-languages">
      {WELCOME_MESSAGE_LOCALES.map((entry, index) => {
        const issue = issues[index];
        const length = welcomeMessageLength(draft.body[entry]);
        return (
          <label className="field" key={entry}>
            <span>{t(`locales.${entry}`)}</span>
            <textarea
              rows={14}
              value={draft.body[entry]}
              disabled={locked}
              aria-invalid={issue !== null}
              onChange={(event) => onBody(entry, event.target.value)}
            />
            <small className="field-hint">{t("length", { count: length, maximum: WELCOME_MESSAGE_MAX_BODY })}</small>
            {issue ? <small className="field-error">{t(`issues.${issue}`, { maximum: WELCOME_MESSAGE_MAX_BODY })}</small> : null}
          </label>
        );
      })}
    </div>
  </>, actions);
}

type Access = "write" | "read" | null;

async function readAccess(signal?: AbortSignal): Promise<Access> {
  const response = await adminCall("admin_me", {}, signal);
  if (response?.success !== true || typeof response.role !== "string") return null;
  return isAdminWriteRole(response.role) ? "write" : "read";
}

export default function WelcomeMessageConfiguration() {
  const [model, setModel] = useState<WelcomeMessageModel>({
    phase: "loading", canWrite: false, stored: null, draft: null, busy: false, notice: null,
  });
  const saving = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setModel((current) => ({ ...current, phase: "loading", notice: null }));
    const [access, response] = await Promise.all([
      readAccess(signal),
      adminCall("get_settings", {}, signal),
    ]);
    if (signal?.aborted) return;
    const read = welcomeMessageSettingsRead(response);
    // An unreadable role fails closed: the panel does not guess who may edit.
    if (access === null || read.kind === "invalid") {
      setModel({ phase: "error", canWrite: false, stored: null, draft: null, busy: false, notice: null });
      return;
    }
    const canWrite = access === "write";
    if (read.kind === "corrupt") {
      setModel({
        phase: "corrupt", canWrite, stored: null, draft: null, busy: false, notice: null,
        corruptMeta: { updatedAt: read.updatedAt, updatedBy: read.updatedBy },
      });
      return;
    }
    setModel({ phase: "ready", canWrite, stored: read.stored, draft: read.stored.value, busy: false, notice: null });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function edit(change: (draft: WelcomeMessageValue) => WelcomeMessageValue) {
    setModel((current) => current.draft && !current.busy
      ? { ...current, draft: change(current.draft), notice: null }
      : current);
  }

  async function save() {
    const draft = model.draft;
    const payload = draft ? welcomeMessageSaveBody(draft) : null;
    if (!payload || !model.canWrite || saving.current || !draftChanged(model)) return;
    saving.current = true;
    const sent = payload.settings.welcome_message;
    setModel((current) => ({ ...current, busy: true, notice: null }));
    try {
      const outcome = welcomeMessageSaveOutcome(await adminCall("set_settings", payload).catch(adminMembershipRefusalForUi), sent);
      if (outcome.kind === "saved") {
        setModel((current) => ({
          ...current, phase: "ready", stored: outcome.stored, draft: outcome.stored.value, busy: false,
          notice: { tone: "success", key: "saved" },
        }));
        return;
      }
      if (outcome.kind !== "unknown") {
        // A definite refusal wrote nothing; the draft stays for the operator to fix.
        setModel((current) => ({
          ...current, busy: false,
          canWrite: outcome.kind === "writeRequired" ? false : current.canWrite,
          notice: outcome.kind === "refused"
            ? { tone: "error", key: "refused", error: outcome.error }
            : { tone: "error", key: outcome.kind },
        }));
        return;
      }
      // A lost or unreadable answer may follow a stored change. Read the
      // authority back before another save is possible; never guess.
      const read = welcomeMessageSettingsRead(await adminCall("get_settings"));
      if (read.kind === "ready") {
        const applied = welcomeMessageEqual(read.stored.value, sent);
        setModel((current) => ({
          ...current, phase: "ready", stored: read.stored,
          // Keep what the operator typed when it did not land, so it is not lost.
          draft: applied ? read.stored.value : current.draft,
          busy: false,
          notice: applied ? { tone: "success", key: "saved" } : { tone: "error", key: "notApplied" },
        }));
        return;
      }
      if (read.kind === "corrupt") {
        // Still the damaged row: nothing landed. Keep the replacement draft.
        setModel((current) => ({ ...current, busy: false, notice: { tone: "error", key: "notApplied" } }));
        return;
      }
      setModel({ phase: "error", canWrite: false, stored: null, draft: null, busy: false, notice: null });
    } finally {
      saving.current = false;
    }
  }

  return (
    <WelcomeMessageView
      model={model}
      onToggle={(enabled) => edit((draft) => ({ ...draft, enabled }))}
      onBody={(locale, text) => edit((draft) => ({ ...draft, body: { ...draft.body, [locale]: text } }))}
      onSave={() => void save()}
      onDiscard={() => setModel((current) => ({
        ...current,
        // A replacement of a damaged row goes back to the damaged-row notice.
        draft: current.stored ? current.stored.value : null,
        notice: null,
      }))}
      onReload={() => void load()}
      onReplace={() => setModel((current) => current.phase === "corrupt" && current.canWrite
        ? { ...current, draft: { enabled: true, body: { hu: "", en: "" } }, notice: null }
        : current)}
    />
  );
}

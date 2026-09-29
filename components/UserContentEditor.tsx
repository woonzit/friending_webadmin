"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { readUserContent, saveUserContent, type UserContent, type UserContentRevision } from "@/lib/userContent";

export function UserContentConflict({ current, busy, onReview, onReload }: {
  current: UserContent | null;
  busy: boolean;
  onReview: () => void;
  onReload: () => void;
}) {
  const t = useTranslations("moderation");
  return (
    <div className="form-stack">
      <p className="alert alert-warning" role="alert">{t("contentConflict")}</p>
      {current ? <>
        <label className="field">
          <span>{t("contentCurrentHeadline")}</span>
          <input readOnly value={current.headline} />
        </label>
        <label className="field">
          <span>{t("contentCurrentAbout")}</span>
          <textarea readOnly rows={5} value={current.about} />
        </label>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onReview}>{t("contentReviewed")}</button>
      </> : <>
        <p className="alert alert-error">{t("contentReloadFailed")}</p>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onReload}>{t("contentReload")}</button>
      </>}
    </div>
  );
}

// Keep the draft and its read revision together. Reviewing a conflict advances only the revision;
// the operator still chooses whether to edit and save the draft in a separate action.
export default function UserContentEditor({
  uid,
  initialHeadline,
  initialAbout,
  initialRevision,
}: {
  uid: number;
  initialHeadline: string;
  initialAbout: string;
  initialRevision?: UserContentRevision;
}) {
  const t = useTranslations("moderation");
  const [headline, setHeadline] = useState(initialHeadline);
  const [about, setAbout] = useState(initialAbout);
  const [revision, setRevision] = useState(initialRevision);
  const [conflict, setConflict] = useState<UserContent | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(initialRevision === null ? "contentRevisionInvalid" : "");

  async function save() {
    if (busy || conflict !== undefined || revision === null) return;
    setBusy(true);
    setSaved(false);
    setError("");
    const result = await saveUserContent(adminCall, { uid, headline, about, revision });
    setBusy(false);
    if (result.kind === "conflict") {
      setConflict(result.current);
      return;
    }
    if (result.kind === "failed") {
      setError(result.errorKey);
      return;
    }
    setHeadline(result.content.headline);
    setAbout(result.content.about);
    setRevision(result.content.revision);
    setSaved(true);
  }

  async function reloadConflict() {
    if (busy) return;
    setBusy(true);
    setConflict(await readUserContent(adminCall, uid));
    setBusy(false);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{t("contentTitle")}</h2>
          <p>{t("contentCopy")}</p>
        </div>
      </div>
      <div className="panel-body">
        {error ? <p className="alert alert-error" role="alert">{t(error)}</p> : null}
        {saved ? <p className="alert alert-success" role="status">{t("contentSaved")}</p> : null}
        {conflict !== undefined ? <UserContentConflict current={conflict} busy={busy}
          onReload={() => void reloadConflict()}
          onReview={() => {
            if (!conflict || busy) return;
            setRevision(conflict.revision);
            setConflict(undefined);
          }} /> : null}
        <label className="field">
          <span>{t("headlineLabel")}</span>
          <input type="text" disabled={busy} maxLength={200} value={headline} onChange={(event) => { setHeadline(event.target.value); setSaved(false); }} />
        </label>
        <label className="field">
          <span>{t("aboutLabel")}</span>
          <textarea rows={5} disabled={busy} maxLength={3000} value={about} onChange={(event) => { setAbout(event.target.value); setSaved(false); }} />
        </label>
        <button type="button" className="button-primary" disabled={busy || conflict !== undefined || revision === null} onClick={() => void save()}>
          {busy ? "…" : t("contentSave")}
        </button>
      </div>
    </section>
  );
}

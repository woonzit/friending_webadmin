"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";

// Admin edit of the member's own headline/about texts. Core reuses the
// member save path (bounded lengths, accepted status, revision bump), keyed
// on the member's current revision server-side, so there is no draft state
// to reconcile here: what was saved is what the response echoes back.
export default function UserContentEditor({
  uid,
  initialHeadline,
  initialAbout,
}: {
  uid: number;
  initialHeadline: string;
  initialAbout: string;
}) {
  const t = useTranslations("moderation");
  const [headline, setHeadline] = useState(initialHeadline);
  const [about, setAbout] = useState(initialAbout);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setSaved(false);
    setError("");
    const response = await adminCall("admin_save_user_content", { uid, headline, about });
    setBusy(false);
    if (!response?.success) {
      setError(typeof response?.error === "string" && response.error ? response.error : "request-failed");
      return;
    }
    const content = response.content as { headline?: unknown; about_me?: unknown } | undefined;
    if (content && typeof content.headline === "string") setHeadline(content.headline);
    if (content && typeof content.about_me === "string") setAbout(content.about_me);
    setSaved(true);
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
        {error ? <p className="alert alert-error" role="alert">{t("actionError", { code: error })}</p> : null}
        {saved ? <p className="alert alert-success" role="status">{t("contentSaved")}</p> : null}
        <label className="field">
          <span>{t("headlineLabel")}</span>
          <input type="text" maxLength={200} value={headline} onChange={(event) => { setHeadline(event.target.value); setSaved(false); }} />
        </label>
        <label className="field">
          <span>{t("aboutLabel")}</span>
          <textarea rows={5} maxLength={3000} value={about} onChange={(event) => { setAbout(event.target.value); setSaved(false); }} />
        </label>
        <button type="button" className="button-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "…" : t("contentSave")}
        </button>
      </div>
    </section>
  );
}

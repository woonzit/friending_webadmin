"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { parseIdentityConfiguration, parseIdentityPayload, type IdentityConfiguration, type IdentityPayload, type IdentityProvider } from "@/lib/identityVerification";

export default function IdentityVerificationConfiguration() {
  const t = useTranslations("identityVerification");
  const common = useTranslations("common");
  const [stored, setStored] = useState<IdentityPayload | null>(null);
  const [draft, setDraft] = useState<IdentityConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    const reply = await adminCall("identity_verification_configuration");
    const payload = reply?.success ? parseIdentityPayload(reply.data) : null;
    setStored(payload);
    setDraft(payload ? { provider: payload.configuration.provider, min_ios_build: payload.configuration.min_ios_build, workflow_id: payload.configuration.workflow_id } : null);
    setFeedback(payload ? null : t("loadError"));
    setBusy(false);
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (!stored?.can_write || !draft || busy || !parseIdentityConfiguration(draft)) return;
    setBusy(true);
    const reply = await adminCall("identity_verification_configuration_save", {
      expected_revision: stored.configuration.revision, configuration_json: JSON.stringify(draft),
    });
    const payload = reply?.success ? parseIdentityPayload(reply.data) : null;
    if (payload) {
      setStored(payload);
      setFeedback(t("saved"));
    } else {
      // An uncertain write is settled by a fresh authority read; the old
      // revision is never retried as a new logical mutation.
      await load();
      setFeedback(t(reply?.status_code === 409 ? "conflict" : "saveError"));
    }
    setBusy(false);
  }
  const valid = draft && parseIdentityConfiguration(draft);
  const dirty = stored && draft && (stored.configuration.provider !== draft.provider
    || stored.configuration.workflow_id !== draft.workflow_id || stored.configuration.min_ios_build !== draft.min_ios_build);
  return <section id="identity-verification" className="panel">
    <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>{common("refresh")}</button>
    </div>
    <div className="panel-body">
      <p className="alert alert-info">{t("legacy")}</p>
      {feedback && <p role="status" className="alert">{feedback}</p>}
      {stored && draft && <>
        <fieldset className="form-stack" disabled={busy || !stored.can_write}>
          <label className="field">{t("provider")}<select value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value as IdentityProvider })}>
            <option value="persona">Persona</option><option value="didit">Didit</option><option value="disabled">{t("paused")}</option>
          </select></label>
          <label className="field">{t("minimumBuild")}<input type="number" min={245} max={2147483647} value={draft.min_ios_build} onChange={e => setDraft({ ...draft, min_ios_build: Number(e.target.value) })} /></label>
          <label className="field">{t("workflow")}<input value={draft.workflow_id} maxLength={36} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={e => setDraft({ ...draft, workflow_id: e.target.value })} /></label>
        </fieldset>
        <p>{t("environment")}: {t(stored.didit.environment)} · {t("revision", { revision: stored.configuration.revision })}</p>
        <ul>{(["api_key", "webhook_secret", "application_id", "media_hosts", "environment_allowed"] as const).map(key =>
          <li key={key}>{t(key)}: {t(stored.didit[key] ? "ready" : "missing")}</li>)}</ul>
        <p>{t("secrets")}</p>
        <button type="button" className="button button-primary" disabled={busy || !stored.can_write || !dirty || !valid || (draft.provider === "didit" && !stored.didit.ready)} onClick={() => void save()}>
          {busy ? common("saving") : common("save")}
        </button>
      </>}
    </div>
  </section>;
}

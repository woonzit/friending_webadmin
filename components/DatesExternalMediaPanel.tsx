"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminExternalMedia } from "@/lib/adminClient";
import { decodeExternalMedia, decodeExternalMediaPending, externalMediaNoWrite, type ExternalMedia, type ExternalMediaPending } from "@/lib/datesExternalMedia";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function DatesExternalMediaPanel({ externalId, actor, revision, canManage, disabled, onChanged, onLockChange }: {
  externalId: string; actor: string; revision: number; canManage: boolean; disabled: boolean; onChanged: () => void | Promise<void>; onLockChange: (locked: boolean) => void;
}) {
  const t = useTranslations("datesAdmin.external.media");
  const [media, setMedia] = useState<ExternalMedia | null>(null);
  const [pending, setPending] = useState<ExternalMediaPending | null>(null);
  const [blocked, setBlocked] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null), [reason, setReason] = useState("");
  const [provenance, setProvenance] = useState<"ai_generated" | "owned">("ai_generated"), [rights, setRights] = useState(false);
  const [message, setMessage] = useState(""), [candidate, setCandidate] = useState<{ action: "remove" | "feature"; photoId: string } | null>(null);
  const running = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const storageKey = `dates-external-media:v1:${actor}:${externalId}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await adminExternalMedia({ action: "read", external_event_id: externalId }, signal);
    if (signal?.aborted) return;
    const decoded = decodeExternalMedia(result, externalId);
    setMedia(decoded); if (!decoded) setMessage("loadError");
  }, [externalId]);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false); setBlocked(false); setPending(null);
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const operation = decodeExternalMediaPending(JSON.parse(saved), actor, externalId);
        if (operation) setPending(operation); else setBlocked(true);
      }
    } catch { setBlocked(true); }
    setReady(true); void load(controller.signal);
    return () => controller.abort();
  }, [storageKey, actor, externalId, load, revision]);
  useEffect(() => { onLockChange(!ready || busy || pending !== null || blocked); }, [ready, busy, pending, blocked, onLockChange]);
  const locked = disabled || busy || blocked || !ready || !canManage || (!media?.can_manage && !pending);

  async function execute(action: "upload" | "remove" | "feature", photoId?: string) {
    if (running.current || locked || !media) return;
    running.current = true; setBusy(true); setMessage("");
    let dispatched = false;
    try {
      let operation = pending;
      let hash: string | null = null;
      if ((operation?.request.action ?? action) === "upload") {
        if (!file || file.size <= 0 || file.size > 10 * 1024 * 1024) { setMessage("fileRequired"); return; }
        hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
      }
      if (operation && operation.file_sha256 !== hash) { setMessage("sameFile"); return; }
      if (!operation) {
        if (reason.trim().length < 3 || (action === "upload" && !rights)) { setMessage("attestationRequired"); return; }
        const request = { action, external_event_id: externalId, expected_revision: media.revision, reason: reason.trim(),
          idempotency_key: `external-media:${crypto.randomUUID()}`,
          ...(action === "upload" ? { provenance, rights_confirmed: "1" as const } : { photo_id: photoId }) };
        operation = decodeExternalMediaPending({ version: 1, actor, request, file_sha256: hash }, actor, externalId);
        if (!operation) { setMessage("attestationRequired"); return; }
        // Persist the original request BEFORE dispatch. A reload requires the
        // exact same file, hash, revision and key; no duplicate logical upload.
        window.localStorage.setItem(storageKey, JSON.stringify(operation));
        if (window.localStorage.getItem(storageKey) !== JSON.stringify(operation)) throw new Error("journal");
        setPending(operation);
      }
      let body: FormData | Record<string, unknown> = operation.request;
      if (operation.request.action === "upload") {
        body = new FormData();
        for (const [key, value] of Object.entries(operation.request)) body.set(key, String(value));
        body.set("image", file!, file!.name);
      }
      dispatched = true;
      const answer = await adminExternalMedia(body);
      const decoded = decodeExternalMedia(answer, externalId, true);
      if (decoded && decoded.revision === operation.request.expected_revision + 1) {
        window.localStorage.removeItem(storageKey);
        setPending(null); setCandidate(null); setFile(null); if (fileInput.current) fileInput.current.value = "";
        setReason(""); setRights(false); setMessage("saved");
        await load(); await onChanged();
      } else {
        // Only an explicit, complete no-write input/state refusal ends this
        // request. Timeouts, failed storage and malformed successes retain it.
        const terminal = externalMediaNoWrite(answer);
        if (terminal) {
          window.localStorage.removeItem(storageKey); setPending(null); setCandidate(null); await load(); await onChanged();
          setMessage(terminal);
        } else setMessage("uncertain");
      }
    } catch { setMessage(dispatched ? "uncertain" : "storageError"); }
    finally { running.current = false; setBusy(false); }
  }

  return <section className="panel dates-external-fields" aria-labelledby="external-media-title">
    <h2 id="external-media-title">{t("title")}</h2><p>{t("policy")}</p>
    {message && <p className={`alert alert-${message === "saved" ? "success" : "info"}`} role="status">{t(message)}</p>}
    {blocked && <p className="alert alert-error">{t("storageError")}</p>}
    {pending && <p className="alert alert-warning">{t("pending")} <code>{pending.request.idempotency_key}</code></p>}
    {media && <><p>{t("count", { count: media.photos.length })}</p>
      <div className="dates-event-photo-grid">{media.photos.map((photo, index) => <figure key={photo.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={t(index === 0 ? "featured" : "gallery", { index: index + 1 })} loading="lazy" referrerPolicy="no-referrer" />
        <figcaption>{t(index === 0 ? "featured" : "gallery", { index: index + 1 })}</figcaption>
        {media.can_manage && canManage && <div className="row-actions">
          {index > 0 && <button type="button" className="button button-secondary button-small" disabled={locked || pending !== null || reason.trim().length < 3} onClick={() => setCandidate({ action: "feature", photoId: photo.id })}>{t("feature")}</button>}
          <button type="button" className="button button-danger button-small" disabled={locked || pending !== null || media.photos.length <= 1 || reason.trim().length < 3} onClick={() => setCandidate({ action: "remove", photoId: photo.id })}>{t("remove")}</button>
        </div>}
      </figure>)}</div>
      {canManage && (media.can_manage || pending) && <fieldset disabled={locked} className="dates-external-fields">
        {(pending?.request.action === "upload" || !pending) && <label className="field"><span>{t("file")}</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
        {!pending && <>
          <label className="field"><span>{t("provenance")}</span><select value={provenance} onChange={event => { setProvenance(event.target.value as typeof provenance); setRights(false); }}><option value="ai_generated">{t("aiGenerated")}</option><option value="owned">{t("owned")}</option></select></label>
          <label className="checkbox-field"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /><span>{t("rights")}</span></label>
          <label className="field"><span>{t("reason")}</span><textarea value={reason} minLength={3} maxLength={1000} rows={2} onChange={event => setReason(event.target.value)} /></label>
        </>}
        {pending ? <button type="button" className="button button-primary" onClick={() => void execute(pending.request.action)}>{t("retry")}</button>
          : <button type="button" className="button button-primary" disabled={!file || !rights || reason.trim().length < 3 || media.photos.length >= 8} onClick={() => void execute("upload")}>{t("upload")}</button>}
      </fieldset>}
      {!media.can_manage && <p>{t("readOnly")}</p>}
    </>}
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>{t("refresh")}</button>
    {candidate && <ConfirmDialog title={t(candidate.action)} copy={t("commandCopy")} confirmLabel={t(candidate.action)} busy={busy}
      onCancel={() => { if (!busy) setCandidate(null); }} onConfirm={() => void execute(candidate.action, candidate.photoId)} />}
  </section>;
}

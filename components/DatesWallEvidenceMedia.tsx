"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Bytes exist only in this mounted evidence view, never a public URL or persistent cache. */
export default function DatesWallEvidenceMedia({ source, caseId, evidenceId, breakGlass, sensitive, reason }: {
  source: unknown; caseId: string; evidenceId: string; breakGlass: boolean; sensitive: boolean; reason: string;
}) {
  const t = useTranslations("datesAdmin.caseDetail");
  const [url, setURL] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef<AbortController | null>(null);
  const ownedURL = useRef<string | null>(null);
  const key = JSON.stringify([caseId, evidenceId, breakGlass, sensitive, reason]);
  useEffect(() => {
    setURL(null); setBusy(false); setFailed(false);
    return () => { active.current?.abort(); if (ownedURL.current) URL.revokeObjectURL(ownedURL.current); ownedURL.current = null; };
  }, [key]);
  const snapshot = source && typeof source === "object" ? source as Record<string, unknown> : null;
  const media = snapshot?.wall_media as { mime?: unknown } | undefined;
  if (media?.mime !== "image/jpeg" && media?.mime !== "video/mp4") return null;
  const mime = media.mime;
  async function open() {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setFailed(false);
    try {
      const response = await fetch("/api/admin/dates-wall-media", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-friending-admin-request": "1" }, signal: controller.signal,
        body: JSON.stringify({ case_id: caseId, evidence_id: evidenceId, break_glass: breakGlass, include_sensitive_location: sensitive, reason: reason.trim() || null }) });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== mime) throw new Error("unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.size > 12 * 1024 * 1024) throw new Error("unavailable");
      ownedURL.current = URL.createObjectURL(blob); setURL(ownedURL.current);
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="dates-wall-evidence-media">
    {!url && <button className="button button-secondary" disabled={busy} onClick={() => void open()}>{busy ? t("wallMediaLoading") : t("wallMediaOpen")}</button>}
    {failed && <p role="alert">{t("wallMediaFailed")}</p>}
    {url && (mime === "video/mp4" ? <video src={url} controls playsInline preload="metadata" aria-label={t("wallMediaOpen")} />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={url} alt={t("wallMediaOpen")} />)}
  </div>;
}

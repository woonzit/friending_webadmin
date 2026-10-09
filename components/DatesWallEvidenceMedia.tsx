"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminWallEvidenceMedia } from "@/lib/adminClient";
import { adminMembershipFailureText } from "@/lib/adminMembershipFailureText";
import { WALL_MEDIA_LIMIT, wallMediaType, type DatesWallMediaAccess } from "@/lib/datesWallMedia";

/**
 * The private photo or clip of one evidence row. The bytes exist only while
 * this view is mounted: an object URL in memory, revoked when the view goes -
 * never a public URL or a cache.
 *
 * `access` is the scope the evidence list was READ with (the reason, break-glass
 * and the sensitive-location flag as they were sent), not what the form above
 * the list says now. The operator may go on typing a reason there without
 * losing an opened clip, and Core audits the media under the reason of the read
 * that showed it.
 */
export default function DatesWallEvidenceMedia({ source, caseId, evidenceId, access }: {
  source: unknown; caseId: string; evidenceId: string; access: DatesWallMediaAccess;
}) {
  const t = useTranslations("datesAdmin.caseDetail");
  const membership = useTranslations("adminMembership");
  const [url, setURL] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const ownedURL = useRef<string | null>(null);
  // Another row or another read of the list: what was opened under the earlier one goes.
  const scope = JSON.stringify([caseId, evidenceId, access.break_glass, access.include_sensitive_location, access.reason]);
  useEffect(() => {
    setURL(null); setBusy(false); setFailure(null);
    return () => {
      active.current?.abort();
      if (ownedURL.current) URL.revokeObjectURL(ownedURL.current);
      ownedURL.current = null;
    };
  }, [scope]);

  const mime = wallMediaType(source);
  if (mime === null) return null;

  async function open() {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setFailure(null);
    const answer = await adminWallEvidenceMedia({ case_id: caseId, evidence_id: evidenceId, ...access }, controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    // The bytes are shown only as the type the evidence row names, and never beyond Core's own cap on a wall asset.
    if (answer instanceof Blob && answer.type.split(";")[0] === mime && answer.size > 0 && answer.size <= WALL_MEDIA_LIMIT) {
      ownedURL.current = URL.createObjectURL(answer);
      setURL(ownedURL.current);
      return;
    }
    setFailure(adminMembershipFailureText(answer instanceof Blob ? null : answer?.error, t("wallMediaFailed"), membership("requestUnconfirmed")));
  }

  return <div className="dates-wall-evidence-media">
    {!url && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void open()}>{busy ? t("wallMediaLoading") : t("wallMediaOpen")}</button>}
    {failure && <p className="alert alert-error" role="alert">{failure}</p>}
    {url && (mime === "video/mp4" ? <video src={url} controls playsInline preload="metadata" aria-label={t("wallMediaVideoLabel")} />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={url} alt={t("wallMediaPhotoAlt")} />)}
  </div>;
}

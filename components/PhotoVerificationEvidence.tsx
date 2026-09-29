"use client";

import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import {
  profileVerificationEvidenceUrl,
  profileVerificationPhotoLoadKey,
  type ProfileVerificationPhoto,
} from "@/lib/profileVerification";

/**
 * One photo of a gesture set on the review page: the member's private photo
 * (through the audited, no-store evidence bridge) beside the public example
 * of the gesture it was asked to copy. The page learns through
 * `onAvailability` whether the private photo actually rendered; Approve waits
 * for every photo of the case.
 */
export default function PhotoVerificationEvidence({
  caseId,
  photo,
  count,
  onAvailability,
}: {
  caseId: string;
  photo: ProfileVerificationPhoto;
  count: number;
  onAvailability: (key: string, loaded: boolean) => void;
}) {
  const t = useTranslations("profileVerification.detail.photo");
  const detail = useTranslations("profileVerification.detail");
  const locale = useLocale() === "hu" ? "hu" : "en";
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = profileVerificationPhotoLoadKey(caseId, photo.kind);
  const url = profileVerificationEvidenceUrl(caseId, photo.kind);
  const step = t("step", { index: photo.position, count });
  const examples = photo.gesture.preferred_example === "both"
    ? (["male", "female"] as const)
    : ([photo.gesture.preferred_example] as const);

  return (
    <article className="verification-photo-evidence" data-photo-kind={photo.kind}>
      <div className="verification-photo-heading">
        <span className="badge">{step}</span>
        <strong>{photo.gesture.title[locale]}</strong>
      </div>
      <p className="field-hint">{photo.gesture.subtitle[locale]}</p>
      <div className="verification-photo-pair">
        <figure>
          <figcaption>{t("submitted")}</figcaption>
          {photo.has_photo && url && !failed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={attempt}
              src={url}
              alt={step}
              referrerPolicy="same-origin"
              onLoad={() => onAvailability(key, true)}
              onError={() => { setFailed(true); onAvailability(key, false); }}
            />
          ) : (
            <div className="verification-photo-unavailable">
              <p role="alert">{photo.has_photo ? t("unavailable") : t("missing")}</p>
              {photo.has_photo ? (
                <button type="button" className="button button-secondary button-small" onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>
                  {t("retry")}
                </button>
              ) : null}
            </div>
          )}
        </figure>
        <figure>
          <figcaption>{t("example")}</figcaption>
          {examples.map((gender) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={gender}
              src={photo.gesture[`${gender}_image_url`]}
              alt={t(gender === "male" ? "exampleMale" : "exampleFemale")}
              title={t(gender === "male" ? "exampleMale" : "exampleFemale")}
              referrerPolicy="no-referrer"
            />
          ))}
        </figure>
      </div>
      <dl className="detail-list compact">
        <div className="detail-row"><dt>{detail("dimensions")}</dt><dd>{photo.width}×{photo.height}</dd></div>
        <div className="detail-row"><dt>{detail("size")}</dt><dd>{formatNumber(photo.bytes, locale)} B</dd></div>
      </dl>
    </article>
  );
}

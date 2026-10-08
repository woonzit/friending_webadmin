"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React from "react";
import { useTranslations } from "next-intl";

/** The moderation states a photo row can carry (Core: DatesActivityPhotoPolicy::PHOTO_STATES). */
const PHOTO_STATES = ["pending", "approved", "rejected", "removed", "appealed"] as const;
type PhotoState = typeof PHOTO_STATES[number];

/** Only render photo fields from an already authorized detail/evidence read. */
export default function DatesEventPhotos({ source }: { source: unknown }) {
  const t = useTranslations("datesAdmin.activityDetail");
  const values = useTranslations("datesAdmin.activities.values");
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = source as Record<string, unknown>;
  const candidates = Array.isArray(value.photos) ? value.photos : value.photo ? [value.photo] : [];
  const photos = candidates.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.url !== "string") return [];
    try { if (new URL(item.url).protocol !== "https:") return []; } catch { return []; }
    // A state this console does not know is not shown as if it were one; the caption then names the photo only.
    const state = (PHOTO_STATES as readonly unknown[]).includes(item.moderation_state) ? item.moderation_state as PhotoState : null;
    return [{ id: item.id, url: item.url, state }];
  });
  if (!photos.length) return null;
  return <div className="dates-event-photo-grid">{photos.map((photo, index) => <figure key={photo.id}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={photo.url} alt={t("galleryPhoto", { index: index + 1 })} loading="lazy" referrerPolicy="no-referrer" />
    <figcaption>{[index === 0 ? t("featuredPhoto") : t("galleryPhoto", { index: index + 1 }), ...(photo.state === null ? [] : [values(photo.state)])].join(" · ")}</figcaption>
  </figure>)}</div>;
}

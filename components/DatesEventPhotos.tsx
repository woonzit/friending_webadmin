"use client";

import { useTranslations } from "next-intl";

/** Only render photo fields from an already authorized detail/evidence read. */
export default function DatesEventPhotos({ source }: { source: unknown }) {
  const t = useTranslations("datesAdmin.activityDetail");
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = source as Record<string, unknown>;
  const candidates = Array.isArray(value.photos) ? value.photos : value.photo ? [value.photo] : [];
  const photos = candidates.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.url !== "string") return [];
    try { if (new URL(item.url).protocol !== "https:") return []; } catch { return []; }
    return [{ id: item.id, url: item.url, state: String(item.moderation_state ?? "") }];
  });
  if (!photos.length) return null;
  return <div className="dates-event-photo-grid">{photos.map((photo, index) => <figure key={photo.id}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={photo.url} alt={t("galleryPhoto", { index: index + 1 })} loading="lazy" referrerPolicy="no-referrer" />
    <figcaption>{index === 0 ? t("featuredPhoto") : t("galleryPhoto", { index: index + 1 })} · {photo.state}</figcaption>
  </figure>)}</div>;
}

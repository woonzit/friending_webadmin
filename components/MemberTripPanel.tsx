"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import type { UserDetailTrip } from "@/lib/userDetail";

function TripDate({ seconds, locale, withTime = false }: { seconds: number; locale: string; withTime?: boolean }) {
  if (seconds === 0) return <>—</>;
  const date = new Date(seconds * 1000);
  // Trip dates describe UTC calendar days, regardless of the operator's time zone.
  const label = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const : {}),
  }).format(date);
  return <time dateTime={date.toISOString()}>{label}</time>;
}

export function MemberTripPanel({ trip }: { trip: UserDetailTrip | null }) {
  const t = useTranslations("userDetail.trip");
  const locale = useLocale();
  return (
    <section className="panel member-trip-panel" aria-labelledby="member-trip-title">
      <div className="panel-header"><h2 id="member-trip-title">{t("title")}</h2></div>
      <div className="panel-body">
        {trip === null ? <p className="empty-inline">{t("empty")}</p> : (
          <dl className="detail-list">
            <div className="detail-row"><dt>{t("destination")}</dt><dd>{[trip.city, trip.country].filter(Boolean).join(", ")}</dd></div>
            <div className="detail-row"><dt>{t("arrival")}</dt><dd><TripDate seconds={trip.arrival_at} locale={locale} /></dd></div>
            <div className="detail-row"><dt>{t("departure")}</dt><dd><TripDate seconds={trip.departure_at} locale={locale} /></dd></div>
            <div className="detail-row"><dt>{t("visibleToLocals")}</dt><dd>{t(trip.show_to_locals ? "yes" : "no")}</dd></div>
            <div className="detail-row"><dt>{t("intentsLabel")}</dt><dd>
              {trip.intents.length === 0 ? "—" : <div className="tag-list">{trip.intents.map((intent) => (
                <span className="tag" key={intent}>{t(`intents.${intent}`)}</span>
              ))}</div>}
            </dd></div>
            <div className="detail-row"><dt>{t("status")}</dt><dd>{trip.status === "active" || trip.status === "cancelled" ? t(`statuses.${trip.status}`) : trip.status}</dd></div>
            <div className="detail-row"><dt>{t("updatedAt")}</dt><dd><TripDate seconds={trip.updated_at} locale={locale} withTime /></dd></div>
          </dl>
        )}
      </div>
    </section>
  );
}

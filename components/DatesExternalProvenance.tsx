"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import type { DatesExternalDetailRow } from "@/lib/datesExternalAdmin";

/** Only the validated, deliberately safe Core projection reaches this panel. */
export default function DatesExternalProvenance({ event }: { event: DatesExternalDetailRow }) {
  const t = useTranslations("datesAdmin.external"), locale = useLocale();
  return <section className="panel dates-external-fields">
    <h2>{t("provenance.title")}</h2>
    <dl className="dates-external-facts">
      <dt>{t("provenance.tier")}</dt><dd>{t(`tierValues.${event.verification_tier}`)}</dd>
      <dt>{t("editor.checked")}</dt><dd>{formatDate(event.checked_at, locale, true)} · {t("columns.recheck")}: {formatDate(event.next_reverify_at, locale, true)}</dd>
      <dt>{t("provenance.submitter")}</dt><dd>{event.credit.channel === "admin" ? t("provenance.adminEntered")
        : event.credit.anonymous || event.credit.submitted_by_uid === null ? t("provenance.anonymous") : t("provenance.member", { uid: event.credit.submitted_by_uid })}</dd>
      <dt>{t("provenance.channel")}</dt><dd>{t(`channelValues.${event.credit.channel}`)}</dd>
      <dt>{t("provenance.assistance")}</dt><dd>{event.ai_assisted
        ? <><span className="badge badge-warning">{t("aiBadge")}</span> {t("provenance.aiAssisted")}</> : t("provenance.noAi")}</dd>
      <dt>{t("provenance.venue")}</dt><dd>{event.venue.place_id === null ? t("provenance.venuePin")
        : <>{t("provenance.venuePlaces")} <code>{event.venue.place_id}</code></>}</dd>
      <dt>{t("form.sourceTitle")}</dt><dd>{event.sources.map((source) => <p key={source.source_id}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a><br />{formatDate(source.confirmed_at, locale, true)}</p>)}
        {event.links.official_url && <p><a href={event.links.official_url} target="_blank" rel="noopener noreferrer">{t("form.officialUrl")}</a></p>}
        {event.links.ticket_url && <p><a href={event.links.ticket_url} target="_blank" rel="noopener noreferrer">{t("form.ticketUrl")}</a></p>}</dd>
    </dl>
    <p>{t("provenance.boundary")}</p>
  </section>;
}

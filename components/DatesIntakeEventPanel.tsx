"use client";

import Link from "next/link";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesIntakeUrl from "@/components/DatesIntakeUrl";
import {
  DATES_INTAKE_EVIDENCE_FIELDS, datesIntakeReferenceHref,
  type DatesIntakeEvent, type DatesIntakeEvidenceState,
} from "@/lib/datesIntakeAdmin";

type Field = typeof DATES_INTAKE_EVIDENCE_FIELDS[number];
type Translate = ReturnType<typeof useTranslations>;

function known(t: Translate, group: string, value: string): string {
  return t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
}

/** A field is "verified" only when Core found the quote in the source and did not find it to say something else. */
export function datesIntakeFieldVerified(state: DatesIntakeEvidenceState): boolean {
  return state.quoted && state.verified && state.denotes !== false;
}

function percent(value: number | null, locale: string): string {
  return value === null ? "—" : new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

/**
 * One extracted event: what the AI wrote, the quote it gave for it, and what
 * Core's deterministic checks made of both. Presentation only; the controls
 * arrive as children.
 */
export default function DatesIntakeEventPanel({ event, total, children }: { event: DatesIntakeEvent; total: number; children?: React.ReactNode }) {
  const t = useTranslations("datesAdmin.intake"), form = useTranslations("datesAdmin.external.form"), common = useTranslations("common");
  const locale = useLocale();
  const { draft, validation, field_evidence: evidence, dedupe } = event;
  const yesNo = (value: boolean | null) => value === null ? t("detail.notChecked") : value ? common("yes") : common("no");
  const claimed: Record<Field, React.ReactNode> = {
    title: draft.title,
    date: <>{draft.date_text_verbatim ?? "—"}{draft.starts_local ? <><br /><small>{t("detail.readAs", { value: draft.starts_local })}</small></> : null}
      {draft.year_inferred && <><br /><small>{t("detail.yearInferred")}</small></>}</>,
    time: draft.start_time_stated ? draft.starts_local?.slice(11) ?? "—" : t("detail.timeNotStated"),
    venue: [draft.venue.name, draft.venue.address_text, draft.venue.city, draft.venue.country_code].filter(Boolean).join(" · ") || "—",
    organizer: draft.organizer_name ?? "—",
    price: draft.is_free === true ? form("isFree") : draft.price_text ?? (draft.is_free === null ? t("detail.priceUnknown") : "—"),
    status: known(t, "statusSignals", draft.status_signal),
  };
  const unverified = evidence ? DATES_INTAKE_EVIDENCE_FIELDS.filter((field) => !datesIntakeFieldVerified(evidence[field])) : [];
  const venue = validation?.venue ?? null;

  return <section className="panel dates-external-fields" aria-label={t("detail.eventTitle", { index: event.index + 1, total })}>
    <div className="row-actions">
      <h3>{t("detail.eventTitle", { index: event.index + 1, total })}: {draft.title}</h3>
      <span className="badge badge-warning">{t("badgeExtracted")}</span>
      {validation?.tier && <span className="badge">{t(`tierValues.${validation.tier}`)}</span>}
      {validation?.needs_more_info && <span className="badge badge-warning">{t("detail.needsMoreInfo")}</span>}
      {event.published_external_event_id && <Link className="badge badge-active" href={`/dates/external/${event.published_external_event_id}`}>{t("detail.published")}</Link>}
    </div>
    {validation === null && <p className="alert alert-info">{t("detail.notValidated")}</p>}
    {validation && validation.hard_fails.length > 0 && <div className="alert alert-error" role="status"><strong>{t("detail.hardFails")}</strong>
      <ul>{validation.hard_fails.map((item) => <li key={item}>{t(`hardFails.${item}`)}</li>)}</ul></div>}
    {validation && validation.warnings.length > 0 && <div className="alert alert-warning" role="status"><strong>{t("detail.warnings")}</strong>
      <ul>{validation.warnings.map((item) => <li key={item}>{t(`warnings.${item}`)}</li>)}</ul></div>}
    {validation?.needs_public_venue_confirmation && <p className="alert alert-warning">{t("detail.publicVenueConfirmation")}</p>}

    <h4>{t("detail.evidenceTitle")}</h4>
    {evidence === null ? <p className="alert alert-info">{t("detail.noEvidence")}</p> : <>
      <p className={unverified.length > 0 ? "alert alert-warning" : "alert alert-info"}>{unverified.length > 0
        ? t("detail.unverifiedFields", { fields: unverified.map((field) => t(`evidenceFields.${field}`)).join(", ") }) : t("detail.allVerified")}</p>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("detail.columns.field")}</th><th>{t("detail.columns.claimed")}</th><th>{t("detail.columns.quote")}</th><th>{t("detail.columns.check")}</th></tr></thead>
        <tbody>{DATES_INTAKE_EVIDENCE_FIELDS.map((field) => {
          const state = evidence[field], verified = datesIntakeFieldVerified(state);
          return <tr key={field}>
            <td>{t(`evidenceFields.${field}`)}</td>
            <td className="preserve-whitespace">{claimed[field]}</td>
            <td className="preserve-whitespace">{state.quote === null ? t("detail.noQuote") : <q>{state.quote}</q>}
              {state.source && <div><small>{t("detail.quoteSource", { source: sourceLabel(t, state.source) })}</small></div>}</td>
            <td><span className={`badge ${verified ? "badge-active" : "badge-warning"}`}>{t(verified ? "detail.verified" : "detail.unverified")}</span>
              <div><small>{!state.quoted ? t("detail.checkNoQuote") : state.verified ? t("detail.checkFound", { match: state.match ? t(`matchValues.${state.match}`) : "—" }) : t("detail.checkNotFound")}</small></div>
              {state.denotes !== null && <div><small>{t(state.denotes ? "detail.denotes" : "detail.denotesNot")}</small></div>}
              {state.confidence !== null && <div><small>{t("detail.confidence", { value: percent(state.confidence, locale) })}</small></div>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </>}

    <h4>{t("detail.draftTitle")}</h4>
    <dl className="dates-external-facts">
      <dt>{form("category")}</dt><dd>{form(`categories.${draft.category}`)}</dd>
      <dt>{form("summaryHu")}</dt><dd className="preserve-whitespace">{draft.summary_hu || "—"}</dd>
      <dt>{form("summaryEn")}</dt><dd className="preserve-whitespace">{draft.summary_en || "—"}</dd>
      <dt>{t("detail.attendance")}</dt><dd>{known(t, "attendanceModes", draft.attendance_mode)}</dd>
      <dt>{form("sensitive")}</dt><dd>{yesNo(draft.sensitive)}{draft.sensitive_reason ? ` · ${draft.sensitive_reason}` : ""}</dd>
      <dt>{form("ageRestriction")}</dt><dd>{draft.age_restriction ?? "—"}</dd>
      <dt>{t("detail.draftEnds")}</dt><dd>{draft.ends_local ?? t("detail.notStated")}{draft.all_day ? ` · ${form("allDay")}` : ""}</dd>
      <dt>{t("detail.publicVenueClaim")}</dt><dd>{yesNo(draft.venue.is_public_venue)}</dd>
    </dl>

    {validation && <>
      <h4>{t("detail.scheduleTitle")}</h4>
      <dl className="dates-external-facts">
        <dt>{form("timezone")}</dt><dd>{validation.schedule.timezone ?? t("detail.unknown")}</dd>
        <dt>{form("startLocal")}</dt><dd>{validation.schedule.start_local ?? t("detail.unknown")}</dd>
        <dt>{form("endLocal")}</dt><dd>{validation.schedule.end_local ?? (validation.schedule.end_estimated ? t("detail.endEstimated") : t("detail.unknown"))}</dd>
      </dl>

      <h4>{t("detail.venueTitle")}</h4>
      {venue === null ? <p className="alert alert-warning">{t("detail.venueUnresolved")}</p> : <dl className="dates-external-facts">
        <dt>{form("venueName")}</dt><dd>{venue.name ?? t("detail.purged")}</dd>
        <dt>{form("venueAddress")}</dt><dd>{venue.formatted_address ?? t("detail.purged")}{venue.city ? ` · ${venue.city}` : ""}{venue.country_code ? ` · ${venue.country_code}` : ""}</dd>
        <dt>{t("detail.coordinates")}</dt><dd>{venue.latitude !== null && venue.longitude !== null ? `${venue.latitude}, ${venue.longitude}` : "—"}{venue.timezone ? ` · ${venue.timezone}` : ""}</dd>
        <dt>{t("detail.placeId")}</dt><dd><code>{venue.place_id ?? "—"}</code>{venue.website_domain ? ` · ${venue.website_domain}` : ""}{venue.business_status ? ` · ${venue.business_status}` : ""}</dd>
        <dt>{t("detail.similarity")}</dt><dd>{percent(validation.venue_similarity, locale)}</dd>
      </dl>}
      {validation.venue_candidates.length > 0 && <details><summary>{t("detail.venueCandidates", { count: validation.venue_candidates.length })}</summary>
        <ul>{validation.venue_candidates.map((candidate, position) => <li key={`${position}-${candidate.place_id ?? ""}`}>
          {candidate.name ?? t("detail.purged")} · {candidate.formatted_address ?? "—"} · {percent(candidate.similarity, locale)}
          {candidate.public_venue_warning && <> · <span className="badge badge-warning">{t("detail.privateAddressWarning")}</span></>}</li>)}</ul></details>}

      <h4>{t("detail.checksTitle")}</h4>
      <dl className="dates-external-facts">
        {(["weekday_match", "venue_resolved", "public_place", "tz_from_venue", "urls_from_evidence", "quotes_verified", "content_safe"] as const).map((check) =>
          <React.Fragment key={check}><dt>{t(`checks.${check}`)}</dt><dd>{yesNo(validation.checks[check])}</dd></React.Fragment>)}
        <dt>{t("checks.witness")}</dt><dd>{validation.checks.witness.present ? (["date", "time", "venue"] as const).map((part) =>
          `${t(`evidenceFields.${part}`)}: ${t(`witnessValues.${validation.checks.witness[part]}`)}`).join(" · ") : t("detail.noWitness")}</dd>
      </dl>

      <h4>{t("detail.linksTitle")}</h4>
      <dl className="dates-external-facts">
        {(["official_url", "ticket_url", "organizer_url"] as const).map((link) =>
          <React.Fragment key={link}><dt>{t(`linkFields.${link}`)}</dt><dd><DatesIntakeUrl value={validation.links[link]} /></dd></React.Fragment>)}
      </dl>
      {validation.links.dropped.length > 0 && <ul>{validation.links.dropped.map((item, position) =>
        <li key={position}>{t("detail.droppedLink", { field: known(t, "linkFields", item.field), reason: t(`linkDropReasons.${item.reason}`) })}</li>)}</ul>}

      <h4>{t("detail.automaticTitle")}</h4>
      <p>{t(validation.auto_publishable ? "detail.automaticYes" : "detail.automaticNo")}</p>
      {validation.auto_blockers.length > 0 && <ul>{validation.auto_blockers.map((item) => <li key={item}>{t(`autoBlockers.${item}`)}</li>)}</ul>}
    </>}

    <h4>{t("detail.dedupeTitle")}</h4>
    {dedupe === null ? <p>{t("detail.notChecked")}</p> : <>
      <p>{t(`dedupeValues.${dedupe.decision}`)}</p>
      {dedupe.candidates.length > 0 && <ul>{dedupe.candidates.map((candidate, position) => {
        const href = datesIntakeReferenceHref(candidate);
        return <li key={position}>{t(`dedupeKinds.${candidate.kind}`)} · {href ? <Link href={href}><code>{candidate.id}</code></Link> : <code>{candidate.id}</code>}
          {" · "}{percent(candidate.similarity, locale)} · {t(`dedupeVerdicts.${candidate.verdict}`)}</li>;
      })}</ul>}
    </>}
    {children}
  </section>;
}

/** `image:1`, `page:1`, `text:1` as words. */
export function sourceLabel(t: Translate, label: string): string {
  const [kind, number] = label.split(":");
  return t.has(`sourceLabels.${kind}`) ? t(`sourceLabels.${kind}`, { number }) : label;
}

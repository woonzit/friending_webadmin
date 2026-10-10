"use client";

// The default import keeps the components renderable where JSX compiles to React.createElement (the test runner).
import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { DATES_NAMED_ENTRY_POINTS, datesCaseHostReviews, datesCaseHostState, datesCaseTargetKind, datesHostReviewState, humanizeMachineKey,
  type DatesCaseSummary, type DatesHostReviewState } from "@/lib/datesAdmin";
import { formatDate } from "@/lib/format";

type Translate = ReturnType<typeof useTranslations>;
type CaseHostSide = Pick<Partial<DatesCaseSummary>, "host_visible" | "host_review" | "host_reviews">;
const eventHref = (activityId: string) => `/dates/${encodeURIComponent(activityId)}`;

/**
 * What a case is about, with the id Core knows it by. The queue row and the
 * case overview say it the same way: an external event, wall content and a
 * chat message by their name in the operator's language, anything else by its
 * target type.
 */
export function DatesCaseTarget({ item }: { item: Pick<DatesCaseSummary, "target_type" | "target_id"> & Pick<Partial<DatesCaseSummary>, "surface"> }) {
  const t = useTranslations("datesAdmin.moderation"), external = useTranslations("datesAdmin.external");
  const kind = datesCaseTargetKind(item);
  const name = item.target_type === "external_event" ? external("moderation.target")
    : kind !== null ? t(`targetKinds.${kind}`) : humanizeMachineKey(item.target_type);
  return <>{name} · {item.target_id}</>;
}

/** The event a case belongs to, as the way to its page. */
export function DatesCaseEventLink({ activityId }: { activityId: string }) {
  const t = useTranslations("datesAdmin.caseDetail");
  return <Link href={eventHref(activityId)} title={t("openEvent")}>{activityId}</Link>;
}

/** Where a report was sent from: by its name where the console has one, by its humanized machine key otherwise. */
export function DatesReportEntryPoint({ value }: { value: string }) {
  const t = useTranslations("datesAdmin.caseDetail");
  return <>{DATES_NAMED_ENTRY_POINTS.includes(value) ? t(`entryPoints.${value}`) : humanizeMachineKey(value)}</>;
}

/** One host's side in words; a state or decision the console has no name for is printed as its machine key. */
const hostWord = (side: DatesHostReviewState, t: Translate): string => "state" in side ? t(`hostStates.${side.state}`) : t("hostStateUnnamed", { value: humanizeMachineKey(side.unnamed) });

/**
 * The hosts' side of a case as one badge: the case is not shown to a host, it
 * waits in the host's inbox, or what the host decided; for a member reported
 * in several events, how many hosts were shown the case and how many decided.
 * Nothing at all when Core does not serve it.
 */
export function DatesCaseHostBadge({ item }: { item: CaseHostSide }) {
  const t = useTranslations("datesAdmin.moderation");
  const side = datesCaseHostState(item);
  if (side === null) return null;
  if ("hosts" in side) return <span className={`badge ${side.decided === side.hosts ? "badge-active" : "badge-info"}`}>{t("hostStatesSeveral", side)}</span>;
  const tone = !("state" in side) || side.state === "not_shown" || side.state === "shown" ? "" : side.state === "waiting" ? " badge-info" : " badge-active";
  return <span className={`badge${tone}`}>{hostWord(side, t)}</span>;
}

/**
 * The case page's section on the hosts: whether a host is shown the case, and
 * of each host who is - one for a case about content, one per event for a case
 * about a member - what they decided, when, and who they are; and that a
 * host's decision does not close the case. Nothing at all when Core does not
 * serve it. The console only shows what hosts did; it decides nothing here.
 */
export function DatesCaseHostReview({ item }: { item: CaseHostSide }) {
  const t = useTranslations("datesAdmin.caseDetail.hostReview"), queue = useTranslations("datesAdmin.moderation"), locale = useLocale();
  const reviews = datesCaseHostReviews(item);
  if (reviews === null) return null;
  return <section className="panel dates-section dates-host-review">
    <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("copy")}</p></div><div className="row-actions"><DatesCaseHostBadge item={item} /></div></div>
    <div className="panel-body">
      {reviews.length === 0 ? <p className="page-subtitle">{t(item.host_visible ? "shownNoReview" : "notShown")}</p> : <>
        {reviews.map(({ event, review }, index) => {
          const side = datesHostReviewState(review);
          // Not decided yet: the time is when the case reached the host's inbox, and there is no deciding host to name.
          const waiting = "state" in side && side.state === "waiting";
          return <dl className="detail-list" key={`${event ?? "case"}-${index}`}>
            {/* A case about a member names the event of each host; a case about content has one event, linked in the overview. */}
            {event !== null && <div className="detail-row"><dt>{t("event")}</dt><dd><Link href={eventHref(event)}>{event}</Link></dd></div>}
            <div className="detail-row"><dt>{t("state")}</dt><dd>{hostWord(side, queue)}</dd></div>
            <div className="detail-row"><dt>{t(waiting ? "openedAt" : "decidedAt")}</dt><dd>{review.at === null ? "—" : formatDate(review.at, locale, true)}</dd></div>
            {!waiting && <div className="detail-row"><dt>{t("host")}</dt>
              <dd>{review.by_uid ? <Link href={`/users/${review.by_uid}`}>{t("uid", { uid: review.by_uid })}</Link> : "—"}</dd></div>}
          </dl>;
        })}
        <p className="field-hint">{t("doesNotClose")}</p>
      </>}
    </div>
  </section>;
}

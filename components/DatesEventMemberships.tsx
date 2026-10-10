"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { humanizeMachineKey } from "@/lib/datesAdmin";
import type { DatesMembershipRow } from "@/lib/datesMemberships";
import { formatDate } from "@/lib/format";

type Translate = ReturnType<typeof useTranslations>;
const moment = (at: number, locale: string) => <time dateTime={new Date(at * 1000).toISOString()}>{formatDate(at, locale, true)}</time>;
/** "By the host", with the host's number as the way to their own page when the row names one. */
const byHost = (uid: number | null, t: Translate) => <span>{t("byHost")}{uid !== null && <> (<Link href={`/users/${uid}`}>{t("uid", { uid })}</Link>)</>}</span>;

/**
 * The members of an event: each with the relationship Core holds, and - where
 * Core serves it - what removed or banned them: the state (a ban outranks a
 * removal), when, by whom (the event's host, or moderation) and the host's
 * note; a ban that was lifted is said as lifted, with its date. The page only
 * shows what hosts did: there is nothing to press here.
 */
export default function DatesEventMemberships({ rows }: { rows: readonly DatesMembershipRow[] }) {
  const t = useTranslations("datesAdmin.activityDetail.members"), locale = useLocale();
  return <div className="dates-scroll-list">{rows.map((row, index) => {
    const { standing, lifted } = row;
    return <div className="dates-member-entry" key={`${row.uid ?? 0}-${index}`}>
      <div className="dates-list-row"><span>{t("uid", { uid: row.uid ?? 0 })}</span><span className="badge">{humanizeMachineKey(row.relationship ?? "unknown")}</span></div>
      {/* Facts that were served and cannot be read are said to be that, never left out as if there were none. */}
      {row.unreadable && <p className="dates-member-standing" role="status">{t("unreadable")}</p>}
      {standing?.state === "banned" && <p className="dates-member-standing">
        <span className="badge badge-warning">{t("banned")}</span>{moment(standing.at, locale)}{byHost(standing.by_uid, t)}
        {standing.note !== null && <span className="dates-member-note">{t("note", { note: standing.note })}</span>}
      </p>}
      {standing?.state === "removed" && <p className="dates-member-standing">
        <span className="badge badge-warning">{t("removed")}</span>{standing.at !== null && moment(standing.at, locale)}
        {standing.by.kind === "host" && byHost(standing.by.uid, t)}
        {standing.by.kind === "moderation" && <span>{t("byModeration")}</span>}
        {standing.note !== null && <span className="dates-member-note">{t("note", { note: standing.note })}</span>}
      </p>}
      {lifted !== null && <p className="dates-member-standing">
        <span className="badge">{t("banLifted")}</span>{moment(lifted.at, locale)}{lifted.by_uid !== null && byHost(lifted.by_uid, t)}
        <span>{t("bannedAt", { date: formatDate(lifted.banned_at, locale, true) })}</span>
      </p>}
    </div>;
  })}</div>;
}

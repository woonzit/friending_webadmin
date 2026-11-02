"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { datesExternalSchedule, type DatesExternalScheduleInput } from "@/lib/datesExternalSchedule";

/**
 * D-149 yield: an external event's time in its own zone - a date range for a multi-day span, no clock time for an
 * all-day event (its end is exclusive), and "running, until <last day>" while a span is under way (`now` is Core's).
 */
export default function DatesExternalWhen({ row, now, detail = false }: { row: DatesExternalScheduleInput; now: number; detail?: boolean }) {
  const t = useTranslations("datesAdmin.external.schedule"), locale = useLocale();
  const schedule = datesExternalSchedule(row, now, locale);
  return <span className="dates-external-when">
    <time dateTime={row.start_local}>{schedule.text}</time>
    {schedule.allDay && <> · {t("allDay")}</>}
    {schedule.until !== null && <div><span className="badge badge-info">{t("until", { date: schedule.until })}</span></div>}
    {detail && schedule.allDay && <div><small>{t("allDayStored")}</small></div>}
  </span>;
}

"use client";

// The default import keeps the components renderable where JSX compiles to React.createElement (the test runner).
import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DATES_NAMED_ENTRY_POINTS, datesCaseTargetKind, humanizeMachineKey, type DatesCaseSummary } from "@/lib/datesAdmin";

/**
 * What a case is about, with the id Core knows it by. The queue row and the
 * case overview say it the same way: an external event and wall content by
 * their name in the operator's language, anything else by its target type.
 */
export function DatesCaseTarget({ item }: { item: Pick<DatesCaseSummary, "target_type" | "target_id"> }) {
  const t = useTranslations("datesAdmin.moderation"), external = useTranslations("datesAdmin.external");
  const kind = datesCaseTargetKind(item);
  const name = item.target_type === "external_event" ? external("moderation.target")
    : kind !== null ? t(`targetKinds.${kind}`) : humanizeMachineKey(item.target_type);
  return <>{name} · {item.target_id}</>;
}

/** The event a case belongs to, as the way to its page. */
export function DatesCaseEventLink({ activityId }: { activityId: string }) {
  const t = useTranslations("datesAdmin.caseDetail");
  return <Link href={`/dates/${encodeURIComponent(activityId)}`} title={t("openEvent")}>{activityId}</Link>;
}

/** Where a report was sent from: by its name where the console has one, by its humanized machine key otherwise. */
export function DatesReportEntryPoint({ value }: { value: string }) {
  const t = useTranslations("datesAdmin.caseDetail");
  return <>{DATES_NAMED_ENTRY_POINTS.includes(value) ? t(`entryPoints.${value}`) : humanizeMachineKey(value)}</>;
}

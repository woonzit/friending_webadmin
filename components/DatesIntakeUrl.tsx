"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { datesIntakeLink } from "@/lib/datesIntakeAdmin";

/**
 * A web address that came with an intake - submitted, fetched or extracted.
 * It is untrusted: only an `https:` address becomes a link; anything else
 * (plain `http:`, another scheme, credentials in the address) is shown as
 * text with a note, so that the console never sends a reviewer over cleartext
 * or to a scheme a browser would act on. The one helper for these screens.
 */
export default function DatesIntakeUrl({ value }: { value: string | null }) {
  const t = useTranslations("datesAdmin.intake.detail");
  if (value === null) return <>—</>;
  const href = datesIntakeLink(value);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{value}</a>
    : <span>{value} <small>{t("notLinked")}</small></span>;
}

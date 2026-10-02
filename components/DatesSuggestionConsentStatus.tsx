"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DatesSuggestionConsent } from "@/lib/datesIntakeAdmin";

/**
 * Where the text of the suggestion terms stands, shown beside the member
 * switch so that whoever turns it sees it. Core does not enforce it on the
 * switch: `draft` and `approved` are states of the text; `missing` is a
 * problem - the member channel is closed whatever the switch says. A status
 * this console does not know is said to be unreadable, never taken as approved.
 */
export default function DatesSuggestionConsentStatus({ consent }: { consent: DatesSuggestionConsent }) {
  const t = useTranslations("datesAdmin.configuration.suggestionConsent");
  if (consent.kind === "absent") return null;
  if (consent.kind === "unreadable") return <p className="alert alert-error" role="status">{t("unreadable")}</p>;
  const version = consent.required_version;
  if (consent.text_status === "missing") return <p className="alert alert-error" role="alert"><strong>{t("missingTitle")}</strong> {t("missing", { version })}</p>;
  return <p className={consent.text_status === "draft" ? "alert alert-warning" : "alert alert-info"} role="status">
    <strong>{t(consent.text_status === "draft" ? "draftTitle" : "approvedTitle")}</strong> {t(consent.text_status, { version })}</p>;
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * A refusal, shown as what it is: the console's explanation where it has
 * one, and always the token Core (or the bridge) actually answered with.
 */
export default function DatesIntakeRefusal({ error, tone = "error" }: { error: string; tone?: "error" | "info" }) {
  const t = useTranslations("datesAdmin.intake.refusals");
  return <p className={`alert alert-${tone}`} role="alert">
    {t.has(error) ? t(error) : t("unknown")} <code>{error}</code>
  </p>;
}

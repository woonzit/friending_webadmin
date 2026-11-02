"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { DATES_RESEARCH_PUBLICATION_BLOCKERS } from "@/lib/datesResearchAdmin";

/**
 * D-149 W5: the system's "not publishable" decision on a research intake - the automatic publication gate's blocker,
 * in words when the console knows the code, otherwise as Core wrote it. Nobody has to act on it.
 */
export default function DatesResearchBlocker({ code }: { code: string | null }) {
  const t = useTranslations("datesAdmin.research.publication");
  return <small className="dates-research-blocker">{t("notPublishable")}{code !== null && <> · {(DATES_RESEARCH_PUBLICATION_BLOCKERS as readonly string[]).includes(code)
    ? t(`blockers.${code}`) : <code>{code}</code>}</>}</small>;
}

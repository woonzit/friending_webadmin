"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { PINGER_HELP_SECTIONS, type PingerHelpSection } from "@/lib/pingerHelp";

/** A native disclosure keeps each explanation beside the settings it describes. */
export default function PingerSectionHelp({ section }: { section: PingerHelpSection }) {
  const t = useTranslations("pinger.sectionHelp");
  return (
    <details className="pinger-section-help" data-pinger-help={section}>
      <summary>{t(`sections.${section}`)}</summary>
      <div className="pinger-help-grid">
        {PINGER_HELP_SECTIONS[section].map((key) => (
          <article key={key}>
            <h3>{t(`topics.${key}.title`)}</h3>
            <p>{t(`topics.${key}.purpose`)}</p>
            <p><strong>{t("effect")}</strong> {t(`topics.${key}.effect`)}</p>
            <p className="pinger-help-example"><strong>{t("example")}</strong> {t(`topics.${key}.example`)}</p>
          </article>
        ))}
      </div>
    </details>
  );
}

"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { DATES_AI_AMBIGUOUS_SOURCES, datesMicroUsd, type DatesAiAmbiguous } from "@/lib/datesIntakeAdmin";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * The AI calls whose cost is not known (Core D-145): each was sent, and its answer never arrived or could not be
 * settled, so the provider may have charged for it. Core counts it as spent at its whole reservation. This says so
 * plainly and lists the newest of them; when Core's figures cannot be read it says that, never "none". Nothing is
 * drawn for a Core that does not serve them, or when there are none.
 */
export default function DatesAiAmbiguousCalls({ ambiguous }: { ambiguous: DatesAiAmbiguous }) {
  const t = useTranslations("datesAdmin.intake"), locale = useLocale();
  // The failure as Core names it: a curl code of the transport, an answer too large to read, an answer without usage
  // figures (Core 2034a93a). Any other token is shown as it is.
  const ambiguousFailure = (failure: string) => /^curl-\d{1,3}$/.test(failure) ? t("usage.ambiguousFailures.curl", { code: failure })
    : failure === "no-usage" || failure === "response-too-large" ? t(`usage.ambiguousFailures.${failure}`) : t("usage.ambiguousFailure", { failure });
  return <>
      {ambiguous.kind === "unreadable" && <p className="alert alert-error" role="status">{t("usage.ambiguousUnreadable")}</p>}
      {ambiguous.kind === "known" && ambiguous.calls > 0 && <section className="panel dates-external-fields" aria-label={t("usage.ambiguousTitle")}>
        <h2>{t("usage.ambiguousTitle")}</h2>
        <p className="alert alert-warning" role="status">{t("usage.ambiguous", { count: formatNumber(ambiguous.calls, locale), amount: datesMicroUsd(ambiguous.micro_usd, locale) })}</p>
        <p className="field-hint">{ambiguous.runs.length + ambiguous.unreadable_runs.length < ambiguous.calls
          ? t("usage.ambiguousListedSome", { shown: formatNumber(ambiguous.runs.length + ambiguous.unreadable_runs.length, locale), count: formatNumber(ambiguous.calls, locale) })
          : t("usage.ambiguousListed")}</p>
        {ambiguous.unreadable_runs.length > 0 && <p className="alert alert-error" role="status">{t("usage.ambiguousUnreadableRuns", { count: ambiguous.unreadable_runs.length })}</p>}
        {ambiguous.runs.length > 0 && <div className="table-wrap"><table className="data-table">
          <thead><tr><th>{t("usage.ambiguousColumns.at")}</th><th>{t("usage.columns.provider")}</th><th>{t("usage.columns.task")}</th><th>{t("usage.columns.channel")}</th>
            <th>{t("usage.ambiguousColumns.why")}</th><th>{t("usage.ambiguousColumns.booked")}</th></tr></thead>
          <tbody>{ambiguous.runs.map((run, index) => <tr key={index}>
            <td>{formatDate(run.at, locale, true)}</td>
            <td>{t.has(`providerValues.${run.provider}`) ? t(`providerValues.${run.provider}`) : run.provider}<div><small><code>{run.model || "—"}</code></small></div></td>
            <td>{t.has(`taskValues.${run.task}`) ? t(`taskValues.${run.task}`) : run.task}</td>
            <td>{t.has(`channelValues.${run.channel}`) ? t(`channelValues.${run.channel}`) : run.channel}</td>
            <td>{(DATES_AI_AMBIGUOUS_SOURCES as readonly string[]).includes(run.source) ? t(`usage.ambiguousSources.${run.source}`) : <code>{run.source}</code>}
              {run.failure !== "" && <div><small>{ambiguousFailure(run.failure)}</small></div>}</td>
            <td>{datesMicroUsd(run.booked_micro_usd, locale)}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>}
  </>;
}

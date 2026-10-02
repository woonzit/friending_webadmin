"use client";

import Link from "next/link";
import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sourceLabel } from "@/components/DatesIntakeEventPanel";
import {
  datesIntakeInProgress, datesIntakeLink, datesIntakeMediaUrl, datesIntakeReferenceHref, datesMicroUsd,
  type DatesIntakeDetail,
} from "@/lib/datesIntakeAdmin";
import { formatDate, formatNumber } from "@/lib/format";

/** Where the intake stands, in words: the status, why it stopped, who decided and what is kept for how long. */
export function DatesIntakeStatusPanel({ intake, polling = false }: { intake: DatesIntakeDetail; /** The page is still asking Core by itself. */ polling?: boolean }) {
  const t = useTranslations("datesAdmin.intake"), common = useTranslations("common"), locale = useLocale();
  const decision = intake.decision, duplicate = intake.duplicate_of;
  const duplicateHref = duplicate ? datesIntakeReferenceHref(duplicate) : null;
  return <section className="panel dates-external-fields" aria-label={t("detail.statusTitle")}>
    <div className="row-actions"><h2>{t("detail.statusTitle")}</h2><span className="badge">{t(`statusValues.${intake.status}`)}</span>
      {intake.status_detail && <span className="badge badge-warning">{t(`statusDetailValues.${intake.status_detail}`)}</span>}</div>
    <p className={["failed", "awaiting_budget", "duplicate", "expired"].includes(intake.status) ? "alert alert-warning" : "alert alert-info"} role="status">
      {t(`statusHelp.${intake.status}`)}{datesIntakeInProgress(intake.status) && intake.status !== "awaiting_budget" ? ` ${t(polling ? "detail.progress" : "detail.progressStopped")}` : ""}</p>
    {intake.status_detail && <p>{t(`statusDetailHelp.${intake.status_detail}`)}</p>}
    {intake.unreadable_fields.length > 0 && <p className="alert alert-error" role="status">{common("unreadableField")} · {intake.unreadable_fields.join(", ")}</p>}
    {intake.unreadable_sections.length > 0 && <p className="alert alert-error" role="status">{t("detail.unreadableSections", { sections: intake.unreadable_sections.join(", ") })}</p>}
    {intake.prompt_injection_suspected && <p className="alert alert-warning" role="status">{t("detail.injection")}</p>}
    {intake.content_purged_at !== null && <p className="alert alert-info">{t("detail.purgedAt", { date: formatDate(intake.content_purged_at, locale, true) })}</p>}
    <dl className="dates-external-facts">
      <dt>{t("detail.channel")}</dt><dd>{intake.channel ? t(`channelValues.${intake.channel}`) : "—"}{intake.admin_principal ? ` · ${intake.admin_principal}` : ""}</dd>
      <dt>{t("queue.columns.created")}</dt><dd>{formatDate(intake.created_at, locale, true)} · {t("detail.updated", { date: formatDate(intake.updated_at, locale, true) })}</dd>
      <dt>{t("detail.revision")}</dt><dd>{intake.revision ?? "—"}</dd>
      <dt>{t("detail.result")}</dt><dd>{intake.result ? t(`resultValues.${intake.result}`) : t("detail.noResult")}{intake.result_note ? ` · ${intake.result_note}` : ""}
        {intake.prohibited_category ? ` · ${t.has(`prohibitedCategories.${intake.prohibited_category}`) ? t(`prohibitedCategories.${intake.prohibited_category}`) : intake.prohibited_category}` : ""}</dd>
      {intake.budget_waiting_since !== null && <><dt>{t("detail.waitingSince")}</dt><dd>{formatDate(intake.budget_waiting_since, locale, true)}</dd></>}
      {decision && <><dt>{t("detail.decision")}</dt><dd>{t(`decisionValues.${decision.action}`)} · {decision.by === "system" ? t("detail.bySystem") : decision.by} · {formatDate(decision.at, locale, true)}
        {decision.reason_code && <div>{t(`rejectReasons.${decision.reason_code}`)}</div>}
        {decision.statement && <blockquote className="preserve-whitespace">{locale === "hu" ? decision.statement.hu : decision.statement.en}</blockquote>}</dd></>}
      {duplicate && <><dt>{t("detail.duplicateOf")}</dt><dd>{t(`dedupeKinds.${duplicate.kind}`)} · {duplicateHref
        ? <Link href={duplicateHref}><code>{duplicate.id}</code></Link> : <code>{duplicate.id}</code>}</dd></>}
      {intake.images_delete_after !== null && <><dt>{t("detail.retention")}</dt><dd>{t("detail.retentionCopy", {
        content: formatDate(intake.images_delete_after, locale), record: formatDate(intake.retention_until, locale) })}</dd></>}
    </dl>
  </section>;
}

/**
 * What was handed in, and the text Core holds of it. A flyer is private
 * evidence: it is fetched only when the reviewer asks for it, through the
 * console's own audited route, and is never offered as an event image.
 */
export function DatesIntakeInputsPanel({ intake }: { intake: DatesIntakeDetail }) {
  const t = useTranslations("datesAdmin.intake"), locale = useLocale();
  const [shown, setShown] = useState<number[]>([]);
  const inputs = intake.inputs, url = inputs?.url ?? null, link = datesIntakeLink(url);
  return <section className="panel dates-external-fields" aria-label={t("detail.inputsTitle")}>
    <h2>{t("detail.inputsTitle")}</h2>
    {inputs === null ? <p className="alert alert-error" role="status">{t("detail.unreadableInputs")}</p> : <dl className="dates-external-facts">
      <dt>{t("detail.kind")}</dt><dd>{t(`inputKindValues.${inputs.kind}`)}</dd>
      {url !== null && <><dt>{t("source.url")}</dt><dd>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{url}</a> : url}</dd></>}
      {inputs.text !== null && <><dt>{t("source.text")}</dt><dd className="preserve-whitespace">{inputs.text}</dd></>}
      {intake.fetch && <><dt>{t("detail.fetch")}</dt><dd>{intake.fetch.final_url} · HTTP {intake.fetch.http_status} · {formatDate(intake.fetch.fetched_at, locale, true)}
        {intake.fetch.truncated ? ` · ${t("detail.truncated")}` : ""}</dd></>}
    </dl>}
    {inputs && inputs.images.unreadable.length > 0 && <p className="alert alert-error" role="status">{t("detail.unreadableImages", { count: inputs.images.unreadable.length })}</p>}
    {inputs?.images.items.map((image) => {
      const src = datesIntakeMediaUrl(intake.intake_id, image.index), visible = shown.includes(image.index);
      return <figure key={image.index} className="dates-intake-flyer">
        <figcaption><strong>{t("detail.flyer", { index: image.index })}</strong>
          {image.width !== null && image.height !== null ? ` · ${image.width}×${image.height}` : ""}
          {image.safe_search ? ` · ${t("detail.safeSearch", { adult: t(`likelihoodValues.${image.safe_search.adult}`), violence: t(`likelihoodValues.${image.safe_search.violence}`) })}` : ""}
        </figcaption>
        <p className="field-hint">{t("detail.flyerPrivate")}</p>
        {!image.ready || src === "" ? <p className="alert alert-info">{t("detail.flyerNotReady")}</p>
          : visible
            // eslint-disable-next-line @next/next/no-img-element -- private, uncacheable bytes from the console's own route
            ? <img src={src} alt={t("detail.flyerAlt", { index: image.index })} referrerPolicy="same-origin" loading="lazy" decoding="async" />
            : <button type="button" className="button button-secondary" onClick={() => setShown((current) => [...current, image.index])}>{t("detail.flyerShow")}</button>}
      </figure>;
    })}
    {intake.source_texts.unreadable.length > 0 && <p className="alert alert-error" role="status">{t("detail.unreadableTexts", { count: intake.source_texts.unreadable.length })}</p>}
    {intake.source_texts.items.map((text) => <details key={text.label}>
      <summary>{sourceLabel(t, text.label)}{text.truncated ? ` · ${t("detail.truncated")}` : ""}</summary>
      <pre className="dates-external-payload">{text.text}</pre>
    </details>)}
  </section>;
}

/** The AI calls made for this intake: which provider and model answered, and what each cost. */
export function DatesIntakeRunsPanel({ intake }: { intake: DatesIntakeDetail }) {
  const t = useTranslations("datesAdmin.intake"), locale = useLocale();
  const runs = intake.ai_runs;
  return <section className="panel dates-external-fields" aria-label={t("detail.runsTitle")}>
    <h2>{t("detail.runsTitle")}</h2>
    {runs.unreadable.length > 0 && <p className="alert alert-error" role="status">{t("detail.unreadableRuns", { count: runs.unreadable.length })}</p>}
    {runs.items.length === 0 ? <p>{t("detail.noRuns")}</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>{t("usage.columns.provider")}</th><th>{t("usage.columns.task")}</th><th>{t("detail.columns.outcome")}</th><th>{t("usage.columns.tokens")}</th><th>{t("usage.columns.cost")}</th><th>{t("detail.columns.at")}</th></tr></thead>
      <tbody>{runs.items.map((run, index) => <tr key={index}>
        <td>{t(`providerValues.${run.provider}`)}<div><small><code>{run.model || "—"}</code></small></div></td>
        <td>{t.has(`taskValues.${run.task}`) ? t(`taskValues.${run.task}`) : run.task}</td>
        <td>{t(`outcomeValues.${run.outcome}`)}</td>
        <td>{formatNumber(run.input_tokens, locale)} / {formatNumber(run.output_tokens, locale)}</td>
        <td>{datesMicroUsd(run.cost_micro_usd, locale)}{run.cost_estimated ? ` · ${t("usage.estimated")}` : ""}</td>
        <td>{formatDate(run.at, locale, true)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

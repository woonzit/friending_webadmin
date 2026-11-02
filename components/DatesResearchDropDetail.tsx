"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { DATES_AI_OUTCOMES, DATES_INTAKE_HARD_FAILS, DATES_INTAKE_RESULTS } from "@/lib/datesIntakeAdmin";
import { DATES_RESEARCH_DROP_STAGES, DATES_RESEARCH_TITLE_MATCHES, type ResearchDropDetail } from "@/lib/datesResearchAdmin";
import { DATES_RESEARCH_GATE_BLOCKERS } from "@/lib/datesSystemClosure";

const known = (list: readonly string[], value: string) => list.includes(value);

/**
 * D-149 yield: why a research candidate stopped before it became an intake - the stage, the extraction's answer and
 * result, how its title matched discovery's, the validator's hard fails, what the publication gate would have said and
 * the page's fetch status. A code the console knows is in words; any other is shown as Core wrote it.
 */
export default function DatesResearchDropDetail({ detail }: { detail: ResearchDropDetail }) {
  const t = useTranslations("datesAdmin.research.dropDetail"), intake = useTranslations("datesAdmin.intake");
  const closure = useTranslations("datesAdmin.research.closure");
  const code = (value: string) => <code>{value}</code>;
  const rows: Array<[string, React.ReactNode]> = [
    ["stage", known(DATES_RESEARCH_DROP_STAGES, detail.stage) ? t(`stages.${detail.stage}`) : code(detail.stage)],
  ];
  if (detail.http_status !== null) rows.push(["httpStatus", t("httpStatusValue", { status: detail.http_status })]);
  if (detail.provider_outcome !== null) rows.push(["providerOutcome", known(DATES_AI_OUTCOMES, detail.provider_outcome) ? intake(`outcomeValues.${detail.provider_outcome}`) : code(detail.provider_outcome)]);
  if (detail.extraction_result !== null) rows.push(["extractionResult", <>{known(DATES_INTAKE_RESULTS, detail.extraction_result) ? intake(`resultValues.${detail.extraction_result}`) : code(detail.extraction_result)}
    {detail.events_extracted !== null && <> · {t("eventsExtracted", { count: detail.events_extracted })}</>}</>]);
  if (detail.title_match !== null) rows.push(["titleMatch", <>{known(DATES_RESEARCH_TITLE_MATCHES, detail.title_match) ? t(`titleMatches.${detail.title_match}`) : code(detail.title_match)}
    {detail.extracted_title !== null && <> · <q>{detail.extracted_title}</q></>}</>]);
  if (detail.hard_fails.length > 0) rows.push(["hardFails", <ul>{detail.hard_fails.map((fail) => <li key={fail}>{known(DATES_INTAKE_HARD_FAILS, fail) ? intake(`hardFails.${fail}`) : code(fail)}</li>)}</ul>]);
  if (detail.gate !== null) rows.push(["gate", known(DATES_RESEARCH_GATE_BLOCKERS, detail.gate) ? closure(`blockers.${detail.gate}`) : code(detail.gate)]);
  return <dl className="dates-research-drop-detail">{rows.map(([key, value]) => <React.Fragment key={key}><dt><small>{t(`labels.${key}`)}</small></dt><dd><small>{value}</small></dd></React.Fragment>)}</dl>;
}

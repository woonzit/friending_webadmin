"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { humanizeMachineKey } from "@/lib/datesAdmin";
import type { DatesAppealMetadata, DatesDecisionMetadata } from "@/lib/datesModerationRead";
import { formatDate } from "@/lib/format";

/** Only decoded metadata reaches history; private snapshots belong to audited evidence. */
export default function DatesCaseHistory({ decisions, appeal }: {
  decisions: DatesDecisionMetadata[]; appeal: DatesAppealMetadata | null;
}) {
  const t = useTranslations("datesAdmin.caseDetail");
  const common = useTranslations("common");
  const queue = useTranslations("datesAdmin.moderation");
  const locale = useLocale();
  const time = (value: number | null) => value === null ? "—" : formatDate(value, locale, true);
  // Resolved outcomes describe the original decision, not a new moderation action.
  const resolvedAppealLabel = (value: string) => value === "upheld" || value === "overturned"
    ? t(`appealOutcomes.${value}`) : null;
  if (decisions.length === 0 && !appeal) return null;
  return <section className="panel dates-section">
    <div className="panel-header"><div><h2>{t("historyTitle")}</h2><p>{t("historyCopy")}</p></div></div>
    <div className="panel-body dates-evidence-list">
      {appeal && <article>
        <div className="dates-evidence-header"><strong>{t("appeal")}</strong></div>
        <dl className="detail-list">
          <div className="detail-row"><dt>{t("recordId")}</dt><dd>{appeal.appeal_id}</dd></div>
          <div className="detail-row"><dt>{t("originalDecision")}</dt><dd>{appeal.decision_id}</dd></div>
          <div className="detail-row"><dt>{t("recordStatus")}</dt><dd>{resolvedAppealLabel(appeal.status) ?? (queue.has(`statuses.${appeal.status}`) ? queue(`statuses.${appeal.status}`) : humanizeMachineKey(appeal.status))}</dd></div>
          <div className="detail-row"><dt>{t("appealOutcome")}</dt><dd>{appeal.resolution ? (resolvedAppealLabel(appeal.resolution) ?? (t.has(`actions.${appeal.resolution}`) ? t(`actions.${appeal.resolution}`) : humanizeMachineKey(appeal.resolution))) : "—"}</dd></div>
          <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{time(appeal.created_at)}</dd></div>
          <div className="detail-row"><dt>{t("resolvedAt")}</dt><dd>{time(appeal.resolved_at)}</dd></div>
          <div className="detail-row"><dt>{t("visibleReasonEn")}</dt><dd>{appeal.user_visible_reason?.en ?? "—"}</dd></div>
          <div className="detail-row"><dt>{t("visibleReasonHu")}</dt><dd>{appeal.user_visible_reason?.hu ?? "—"}</dd></div>
        </dl>
        <p className="field-hint">{t("appealNoteAuditedOnly")}</p>
      </article>}
      {decisions.map((decision) => <article key={decision.decision_id}>
        <div className="dates-evidence-header"><strong>{decision.decision_id}</strong></div>
        <dl className="detail-list">
          <div className="detail-row"><dt>{t("action")}</dt><dd>{t.has(`actions.${decision.action}`) ? t(`actions.${decision.action}`) : humanizeMachineKey(decision.action)}</dd></div>
          <div className="detail-row"><dt>{t("target")}</dt><dd>{humanizeMachineKey(decision.target_type)} · {decision.target_id}</dd></div>
          <div className="detail-row"><dt>{t("targetRevision")}</dt><dd>{humanizeMachineKey(decision.target_path)}</dd></div>
          <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{time(decision.created_at)}</dd></div>
          <div className="detail-row"><dt>{t("decisionExpiresAt")}</dt><dd>{time(decision.expires_at)}</dd></div>
          <div className="detail-row"><dt>{t("visibleReasonEn")}</dt><dd>{decision.user_visible_reason?.en ?? "—"}</dd></div>
          <div className="detail-row"><dt>{t("visibleReasonHu")}</dt><dd>{decision.user_visible_reason?.hu ?? "—"}</dd></div>
          <div className="detail-row"><dt>{t("appealOutcome")}</dt><dd>{decision.appeal_outcome ? (resolvedAppealLabel(decision.appeal_outcome) ?? humanizeMachineKey(decision.appeal_outcome)) : "—"}</dd></div>
          <div className="detail-row"><dt>{t("resolvedAt")}</dt><dd>{time(decision.appeal_resolved_at)}</dd></div>
        </dl>
      </article>)}
    </div>
  </section>;
}

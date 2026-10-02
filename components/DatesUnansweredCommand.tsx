"use client";

import Link from "next/link";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { DATES_EXTERNAL_RETRY_SECONDS } from "@/lib/datesExternalMutations";
import type { DatesKeptCommandRead } from "@/lib/datesKeptCommand";
import { formatDate } from "@/lib/format";

/**
 * The saved command of a case action Core does not fence (a legal hold, a
 * live-trail capture) whose outcome is not known. It is shown on every case
 * page while the browser's storage holds it. The only way on is the same
 * request again - Core answers with the first attempt's receipt if it landed -
 * from the page of the case it belongs to. There is no discard: nothing the
 * operator can see says whether it landed.
 */
export default function DatesUnansweredCommand({ read, caseId, now, busy, onRetry }: {
  read: DatesKeptCommandRead; caseId: string;
  /** Seconds; a command older than Core keeps its receipt is not sent again. */
  now: number; busy: boolean; onRetry: () => void;
}) {
  const t = useTranslations("datesAdmin.commandOutcome");
  const common = useTranslations("common");
  const locale = useLocale();
  if (read.kind === "empty") return null;
  if (read.kind === "blocked") return <p className="alert alert-error page-alert" role="alert">{t("blocked")}</p>;
  const { command } = read, body = command.body;
  const here = body.case_id === caseId, expired = now - command.issued_at >= DATES_EXTERNAL_RETRY_SECONDS;
  const action = command.action === "dates_moderation_trail_evidence" ? "actionTrail" : body.action === "release" ? "actionHoldRelease" : "actionHoldPlace";
  return <section className="panel dates-section" aria-label={t("saved")}>
    <div className="panel-body form-stack">
      <p className="alert alert-warning" role="status"><strong>{t("saved")}</strong> {t("pending")}</p>
      <p><strong>{t(action)}</strong> · {formatDate(command.issued_at, locale, true)} · <code>{String(body.case_id)}</code></p>
      <p className="preserve-whitespace">{String(body.reason)}</p>
      {!here ? <Link className="button button-secondary" href={`/dates/moderation/${String(body.case_id)}`}>{t("open")}</Link>
        : expired ? <p className="alert alert-error">{t("expired")}</p>
          : <div className="row-actions"><button type="button" className="button button-primary" disabled={busy} onClick={onRetry}>{busy ? common("working") : t("retry")}</button></div>}
    </div>
  </section>;
}

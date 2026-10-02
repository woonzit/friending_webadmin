"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * A case command whose outcome is not known and that Core does not fence by a
 * revision. While the page is open it can be sent again as the same request,
 * key included, which Core answers with the first attempt's receipt if that
 * landed. It is an offer, not a state: nothing is locked, and the operator
 * may dismiss it.
 */
export default function DatesUnansweredCommand({ busy, onRetry, onDiscard }: { busy: boolean; onRetry: () => void; onDiscard: () => void }) {
  const t = useTranslations("datesAdmin.commandOutcome");
  return <div className="field-full alert alert-warning" role="status">
    <p>{t("pending")}</p>
    <div className="row-actions">
      <button type="button" className="button button-primary" disabled={busy} onClick={onRetry}>{t("retry")}</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onDiscard}>{t("discard")}</button>
    </div>
    <p className="field-hint">{t("discardHint")}</p>
  </div>;
}

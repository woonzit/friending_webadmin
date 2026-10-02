"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * A command whose outcome is not known and that no revision fences: the page
 * keeps it - idempotency key included - until Core answers. The only ways on
 * are the same request again (Core replays the first attempt's receipt if it
 * landed) or the operator's explicit decision to give it up.
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

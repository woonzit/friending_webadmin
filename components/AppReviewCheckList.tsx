"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  APP_REVIEW_CHECK_KEYS,
  type AppReviewCheck,
  type AppReviewCheckKey,
} from "@/lib/appReviewSandbox";

/**
 * The App Review readiness census, rendered with its three states (T-812).
 *
 * Core (`AppReviewSandboxService::NOT_APPLICABLE`, `api` f96b3935, T-788)
 * answers a check whose feature is switched off as
 * `{ ok: true, actual: "not_applicable", expected: <the normal expectation> }`:
 * the reviewer cannot reach that content, so neither a pass nor a red failure
 * is the truth, and the check stops being a witness of completeness. `ok` stays
 * true, so readiness stays green — but a plain green tick told the owner the
 * fixture had content that is not there. That third state gets its own muted
 * row here; the passed and failed rows are exactly what they were.
 *
 * The sentinel is a VALUE, not a key: `lib/appReviewSandbox.ts` decodes
 * `actual` through its scalar guard and its closed key set is unchanged, so
 * nothing about the decoder moves for this.
 */
export const APP_REVIEW_NOT_APPLICABLE = "not_applicable";

const CHECK_STATES = {
  ok: { row: "check-ok", badge: "badge-success", glyph: "✓" },
  failed: { row: "check-failed", badge: "badge-error", glyph: "✕" },
  notApplicable: { row: "check-na", badge: "badge-muted", glyph: "—" },
} as const;

/** True while a check passes only because its feature is switched off. */
export function appReviewCheckNotApplicable(check: AppReviewCheck): boolean {
  return check.ok && check.actual === APP_REVIEW_NOT_APPLICABLE;
}

function scalarText(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function AppReviewCheckList({ checks }: { checks: readonly AppReviewCheck[] }) {
  const t = useTranslations("appReview");
  return (
    <ul className="check-list">
      {checks.map((check) => {
        const notApplicable = appReviewCheckNotApplicable(check);
        const state = notApplicable
          ? CHECK_STATES.notApplicable
          : check.ok ? CHECK_STATES.ok : CHECK_STATES.failed;
        return (
          <li key={check.key} className={state.row}>
            <span className={`badge ${state.badge}`} aria-hidden="true">
              {state.glyph}
            </span>
            <span>{t(`checks.${check.key as AppReviewCheckKey}`)}</span>
            {notApplicable && (
              <small>
                {" "}{t("checkNotApplicable")}
              </small>
            )}
            {!check.ok && (
              <small>
                {" "}{t("checkActual", { actual: scalarText(check.actual) })}
                {" · "}{t("checkExpected", { expected: scalarText(check.expected) })}
              </small>
            )}
          </li>
        );
      })}
      {APP_REVIEW_CHECK_KEYS.every((key) => checks.some((check) => check.key === key)) ? null : (
        <li className="check-failed"><small>{t("checkExpected", { expected: APP_REVIEW_CHECK_KEYS.join(", ") })}</small></li>
      )}
    </ul>
  );
}

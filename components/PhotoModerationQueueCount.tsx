"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * The toolbar total of the photo moderation queue. Only a successful read of the selected tab is
 * evidence of how many pictures wait: while a tab loads, or after its read failed, the rows still in
 * memory belong to an earlier tab (or to none), so the total is withheld instead of claiming an
 * empty queue or repeating a stale count.
 */
export default function PhotoModerationQueueCount({ state, count }: {
  state: "loading" | "ready" | "error";
  count: number;
}) {
  const t = useTranslations("photoModeration");
  const common = useTranslations("common");
  return <span role="status">{state === "ready" ? t("queueCount", { count })
    : state === "loading" ? common("loading") : t("queueUnavailable")}</span>;
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  featureSwitchesValue,
  type FeatureSwitch,
  type FeatureSwitchesState,
} from "@/lib/featureSwitches";
import type {
  MembershipPlanPreview,
  MembershipPlanValidationIssue,
  MembershipQuotaKey,
  MembershipTier,
} from "@/lib/membership";

export const MEMBERSHIP_QUOTA_FEATURE_FAMILIES = {
  footprint_send: "footprints",
  pinger_send: "hey",
  private_album_access: null,
  quick_phrase_slots: null,
} as const satisfies Record<MembershipQuotaKey, FeatureSwitch | null>;

export type MembershipQuotaFeatureState = "on" | "off" | "unreadable" | "not-switchable";

export function membershipQuotaFeatureState(
  quota: MembershipQuotaKey,
  featureSwitches: FeatureSwitchesState | null,
): MembershipQuotaFeatureState {
  const family = MEMBERSHIP_QUOTA_FEATURE_FAMILIES[quota];
  if (family === null) return "not-switchable";
  if (featureSwitches === null) return "unreadable";
  const enabled = featureSwitchesValue(featureSwitches, family);
  return enabled === null ? "unreadable" : enabled ? "on" : "off";
}

type MembershipQuotaPreviewListProps = {
  quotas: MembershipPlanPreview["tiers"][number]["quotas"];
  tier: MembershipTier;
  validationIssues: MembershipPlanValidationIssue[];
  featureSwitches: FeatureSwitchesState | null;
};

export function MembershipQuotaPreviewList({
  quotas,
  tier,
  validationIssues,
  featureSwitches,
}: MembershipQuotaPreviewListProps) {
  const t = useTranslations("membershipConfig");
  return (
    <ul>{quotas.map((quota) => {
      const featureState = membershipQuotaFeatureState(quota.key, featureSwitches);
      const featureUnavailable = featureState === "off" || featureState === "unreadable";
      const invalid = !featureUnavailable && validationIssues.some((issue) => (
        issue.quota === quota.key && (issue.tier === null || issue.tier === tier)
      ));
      const value = featureState === "off"
        ? t("preview.switchedOff")
        : featureState === "unreadable"
          ? t("preview.switchStateUnreadable")
          : invalid
            ? t("preview.invalidRule")
            : quota.mode === "disabled"
              ? t("preview.unavailable")
              : quota.mode === "unlimited"
                ? t("preview.unlimited")
                : quota.scope === "utc_day"
                  ? t("preview.finiteUtcDay", { value: quota.value ?? 0 })
                  : t("preview.finiteConcurrent", { value: quota.value ?? 0 });
      return (
        <li
          data-membership-quota={quota.key}
          data-feature-switch-state={featureState}
          key={quota.key}
        >
          <span>{t(`quotas.${quota.key}`)}</span>
          <strong className={featureUnavailable
            ? "membership-preview-feature-unavailable"
            : invalid ? "membership-preview-invalid" : ""}>
            {value}
          </strong>
        </li>
      );
    })}</ul>
  );
}

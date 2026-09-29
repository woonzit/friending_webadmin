"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  MEMBERSHIP_CAPABILITIES,
  MEMBERSHIP_QUOTAS,
  MEMBERSHIP_TIERS,
  type MembershipCapabilityKey,
  type MembershipConfiguration,
  type MembershipPlanConfiguration,
  type MembershipPlanEditAccess,
  type MembershipPlanValidationIssue,
  type MembershipQuotaKey,
  type MembershipQuotaMode,
  type MembershipTier,
} from "@/lib/membership";

/**
 * Says why the plan editor is read-only while the stored plan is marked ready for enforcement
 * (P-058). The copy matches Core's `membership-configuration-owner-required` save refusal; every
 * other access state renders nothing.
 */
export function MembershipPlanAccessNotice({ access }: { access: MembershipPlanEditAccess }) {
  const t = useTranslations("membershipConfig");
  if (access !== "liveOwnerOnly") return null;
  return (
    <div className="alert alert-warning membership-plan-access-notice" role="status" data-plan-access={access}>
      <strong>{t("liveLock.title")}</strong>
      <p>{t("liveLock.copy")}</p>
    </div>
  );
}

/** FREE/PLUS capability switches; every switch is disabled unless the plan is editable. */
export function MembershipCapabilityTable({
  draft,
  editable,
  onChange,
}: {
  draft: MembershipPlanConfiguration;
  editable: boolean;
  onChange: (key: MembershipCapabilityKey, tier: MembershipTier, value: boolean) => void;
}) {
  const t = useTranslations("membershipConfig");
  return (
    <div className="table-wrap membership-config-table">
      <table className="data-table">
        <thead><tr><th>{t("benefits.capability")}</th><th>{t("tiers.free")}</th><th>{t("tiers.plus")}</th></tr></thead>
        <tbody>{MEMBERSHIP_CAPABILITIES.map((key) => (
          <tr key={key}>
            <td><strong>{t(`capabilities.${key}`)}</strong><small className="table-subline">{t(`capabilityHelp.${key}`)}</small></td>
            {MEMBERSHIP_TIERS.map((tier) => (
              <td key={tier}>
                <label className="switch membership-switch">
                  <span className="sr-only">{t("benefits.capabilityToggle", { capability: t(`capabilities.${key}`), tier: t(`tiers.${tier}`) })}</span>
                  <input type="checkbox" disabled={!editable} checked={draft.capabilities[key][tier]} onChange={(event) => onChange(key, tier, event.target.checked)} />
                  <span className="switch-track" />
                </label>
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** FREE/PLUS quota rules; every mode select and value input is disabled unless the plan is editable. */
export function MembershipQuotaTable({
  draft,
  bounds,
  editable,
  validationIssues,
  onMode,
  onValue,
}: {
  draft: MembershipPlanConfiguration;
  bounds: MembershipConfiguration["bounds"];
  editable: boolean;
  validationIssues: MembershipPlanValidationIssue[];
  onMode: (key: MembershipQuotaKey, tier: MembershipTier, mode: MembershipQuotaMode) => void;
  onValue: (key: MembershipQuotaKey, tier: MembershipTier, raw: string) => void;
}) {
  const t = useTranslations("membershipConfig");
  return (
    <div className="table-wrap membership-config-table">
      <table className="data-table">
        <thead><tr><th>{t("limits.quota")}</th><th>{t("limits.scope")}</th><th>{t("tiers.free")}</th><th>{t("tiers.plus")}</th></tr></thead>
        <tbody>{MEMBERSHIP_QUOTAS.map((key) => {
          const bound = bounds[key];
          return (
            <tr key={key}>
              <td><strong>{t(`quotas.${key}`)}</strong><small className="table-subline">{t("limits.bounds", { min: bound.min, max: bound.max })}</small></td>
              <td>{t(`scopes.${draft.quotas[key].scope}`)}</td>
              {MEMBERSHIP_TIERS.map((tier) => {
                const rule = draft.quotas[key][tier];
                return (
                  <td key={tier}>
                    <div className="membership-rule-control">
                      <select disabled={!editable} value={rule.mode} aria-label={t("limits.modeLabel", { quota: t(`quotas.${key}`), tier: t(`tiers.${tier}`) })} onChange={(event) => onMode(key, tier, event.target.value as MembershipQuotaMode)}>
                        <option value="disabled">{t("modes.disabled")}</option>
                        <option value="finite">{t("modes.finite")}</option>
                        <option value="unlimited">{t("modes.unlimited")}</option>
                      </select>
                      {rule.mode === "finite" ? (
                        <input
                          disabled={!editable}
                          type="number"
                          min={bound.min}
                          max={bound.max}
                          step={1}
                          value={rule.value ?? ""}
                          aria-invalid={validationIssues.some((issue) => issue.quota === key && (issue.tier === null || issue.tier === tier))}
                          aria-label={t("limits.valueLabel", { quota: t(`quotas.${key}`), tier: t(`tiers.${tier}`) })}
                          onChange={(event) => onValue(key, tier, event.target.value)}
                        />
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

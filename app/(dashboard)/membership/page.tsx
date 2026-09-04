"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MembershipQuotaPreviewList } from "@/components/MembershipQuotaPreview";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  featureSwitchesStateResponse,
  type FeatureSwitchesState,
} from "@/lib/featureSwitches";
import {
  MEMBERSHIP_CAPABILITIES,
  MEMBERSHIP_QUOTAS,
  MEMBERSHIP_TIERS,
  membershipActionErrorKey,
  membershipConfiguration,
  membershipConfigurationCandidate,
  membershipPlanIsDirty,
  membershipPlanPreview,
  membershipPlanValidationIssues,
  membershipShouldGuardInternalNavigation,
  membershipStoreProductRows,
  type MembershipConfiguration,
  type MembershipPlanConfiguration,
  type MembershipPlanValidationIssue,
  type MembershipQuotaKey,
  type MembershipQuotaMode,
  type MembershipTier,
} from "@/lib/membership";

function formatUpdated(epochSeconds: number, locale: string): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "—";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

export default function MembershipConfigurationPage() {
  const t = useTranslations("membershipConfig");
  const membershipErrors = useTranslations("membershipErrors");
  const common = useTranslations("common");
  const locale = useLocale();
  const [catalogue, setCatalogue] = useState<MembershipConfiguration | null>(null);
  const [draft, setDraft] = useState<MembershipPlanConfiguration | null>(null);
  const [featureSwitches, setFeatureSwitches] = useState<FeatureSwitchesState | null>(null);
  const [adminRole, setAdminRole] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const dirty = useMemo(
    () => Boolean(catalogue && draft && membershipPlanIsDirty(catalogue.configuration, draft)),
    [catalogue, draft],
  );
  const validationIssues = useMemo(
    () => catalogue && draft ? membershipPlanValidationIssues(draft, catalogue.bounds) : [],
    [catalogue, draft],
  );
  const planPreview = useMemo(() => draft ? membershipPlanPreview(draft) : null, [draft]);

  const adopt = useCallback((value: unknown): boolean => {
    const parsed = membershipConfiguration(value);
    if (!parsed) return false;
    setCatalogue(parsed);
    setDraft(parsed.configuration);
    setState("ready");
    return true;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setNotice(null);
    setFeatureSwitches(null);
    const [response, principal, featureSwitchesResponse] = await Promise.all([
      adminCall("membership_configuration"),
      adminCall("admin_me"),
      adminCall("feature_switches_get", { contract_version: 1 }),
    ]);
    setFeatureSwitches(featureSwitchesStateResponse(featureSwitchesResponse));
    const role = typeof principal?.role === "string"
      ? principal.role.trim().toLowerCase()
      : "";
    setAdminRole(role);
    if (!response?.success || !adopt(response.data) || !["owner", "admin", "viewer"].includes(role)) {
      setState("error");
    }
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor
        || anchor.hasAttribute("download")
        || (anchor.target !== "" && anchor.target !== "_self")
        || !membershipShouldGuardInternalNavigation(window.location.href, anchor.href)
        || window.confirm(t("dirty.leaveConfirm"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty, t]);

  function capability(key: (typeof MEMBERSHIP_CAPABILITIES)[number], tier: MembershipTier, value: boolean) {
    setDraft((current) => current ? {
      ...current,
      capabilities: {
        ...current.capabilities,
        [key]: { ...current.capabilities[key], [tier]: value },
      },
    } : current);
  }

  function quotaMode(key: MembershipQuotaKey, tier: MembershipTier, mode: MembershipQuotaMode) {
    if (!catalogue) return;
    setDraft((current) => {
      if (!current) return current;
      const old = current.quotas[key][tier];
      const value = mode === "finite"
        ? old.value ?? catalogue.bounds[key].min
        : null;
      return {
        ...current,
        quotas: {
          ...current.quotas,
          [key]: {
            ...current.quotas[key],
            [tier]: { mode, value },
          },
        },
      };
    });
  }

  function quotaValue(key: MembershipQuotaKey, tier: MembershipTier, raw: string) {
    const parsed = raw.trim() === "" ? null : Number(raw);
    const value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    setDraft((current) => current ? {
      ...current,
      quotas: {
        ...current.quotas,
        [key]: {
          ...current.quotas[key],
          [tier]: { mode: "finite", value },
        },
      },
    } : current);
  }

  async function save() {
    const editor = adminRole === "owner" || adminRole === "admin";
    if (!catalogue || !draft || saving || !editor || !dirty || validationIssues.length > 0) return;
    if (draft.ready_for_enforcement !== catalogue.configuration.ready_for_enforcement
      && adminRole !== "owner") {
      setNotice({ tone: "error", text: t("readiness.ownerOnly") });
      return;
    }
    if (draft.ready_for_enforcement && !catalogue.configuration.ready_for_enforcement
      && !window.confirm(t("readyConfirm"))) return;
    setSaving(true);
    setNotice(null);
    const response = await adminCall("save_membership_configuration", {
      expected_revision: catalogue.configuration.revision,
      configuration: membershipConfigurationCandidate(draft),
      request_id: crypto.randomUUID(),
    });
    setSaving(false);
    if (!response?.success) {
      const errorKey = membershipActionErrorKey("configuration_save", response?.error);
      // Only a revision conflict is allowed to replace a dirty draft, and only
      // when its attached authoritative catalogue passes the strict parser.
      const conflictAdopted = errorKey === "configurationConflict"
        && adopt(response?.data);
      setNotice({
        tone: "error",
        text: membershipErrors(conflictAdopted ? "configurationConflictAdopted" : errorKey),
      });
      return;
    }
    if (!adopt(response.data)) {
      setNotice({ tone: "error", text: membershipErrors("invalidResponse") });
      return;
    }
    setNotice({ tone: "success", text: t("saved") });
  }

  function validationIssueText(issue: MembershipPlanValidationIssue): string {
    const quota = t(`quotas.${issue.quota}`);
    const tier = issue.tier ? t(`tiers.${issue.tier}`) : "";
    switch (issue.kind) {
      case "scope_mismatch":
        return t("validation.scopeMismatch", {
          quota,
          scope: t(`scopes.${issue.expected_scope}`),
        });
      case "mode_invalid":
        return t("validation.modeInvalid", { quota, tier });
      case "non_finite_value":
        return t("validation.nonFiniteValue", { quota, tier });
      case "finite_value_invalid":
        return t("validation.finiteValueInvalid", {
          quota,
          tier,
          min: issue.min,
          max: issue.max,
        });
    }
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !catalogue || !draft || !planPreview) return <ErrorPanel message={t("loadError")} retry={load} />;

  const rollout = catalogue.rollout;
  const storeProducts = membershipStoreProductRows(catalogue);
  const editor = adminRole === "owner" || adminRole === "admin";
  const owner = adminRole === "owner";
  const saveDisabled = saving || !editor || !dirty || validationIssues.length > 0;
  return (
    <div className="membership-config-page">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={(
          <div className="membership-page-actions">
            <span className={`badge ${dirty ? "badge-warning" : "badge-active"}`} role="status">
              {dirty ? t("dirty.unsaved") : t("dirty.clean")}
            </span>
            <button type="button" className="button button-primary" disabled={saveDisabled} onClick={() => void save()}>{saving ? common("saving") : t("save")}</button>
          </div>
        )}
      />

      {notice ? <p className={`alert ${notice.tone === "success" ? "alert-success" : "alert-error"}`} role="status">{notice.text}</p> : null}

      <div
        className={`alert membership-validation-summary ${validationIssues.length === 0 ? "alert-success" : "alert-error"}`}
        role={validationIssues.length === 0 ? "status" : "alert"}
      >
        <strong>{validationIssues.length === 0 ? t("validation.validTitle") : t("validation.invalidTitle")}</strong>
        <p>{validationIssues.length === 0
          ? t("validation.validCopy")
          : t("validation.invalidCopy", { count: validationIssues.length })}</p>
        {validationIssues.length > 0 ? (
          <ul>{validationIssues.map((issue, index) => (
            <li key={`${issue.kind}-${issue.quota}-${issue.tier ?? "scope"}-${index}`}>
              {validationIssueText(issue)}
            </li>
          ))}</ul>
        ) : null}
      </div>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("rollout.title")}</h2><p>{t("rollout.copy")}</p></div></div>
        <div className="panel-body">
          <div className="membership-rollout-grid">
            {([
              ["projection", rollout.projection_writes_enabled],
              ["enforcement", rollout.feature_enforcement_enabled],
              ["legacy", rollout.legacy_compat_enabled],
            ] as const).map(([key, enabled]) => (
              <div key={key} className={enabled ? "is-enabled" : "is-disabled"}>
                <span>{t(`rollout.${key}`)}</span>
                <strong>{enabled ? t("enabled") : t("disabled")}</strong>
              </div>
            ))}
          </div>
          {!rollout.feature_enforcement_enabled ? <p className="alert alert-warning membership-rollout-warning">{t("rollout.shadowWarning")}</p> : null}
          <p className="alert alert-info membership-rollout-warning">{t("rollout.featureDependencyUnknown")}</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header membership-config-heading">
          <div><h2>{t("benefits.title")}</h2><p>{t("benefits.copy")}</p></div>
          <div className="membership-config-meta">
            <span>{t("revision", { revision: draft.revision })}</span>
            <span>{t("updated", { date: formatUpdated(draft.updated_at, locale), actor: draft.updated_by || "—" })}</span>
          </div>
        </div>
        <div className="panel-body">
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
                        <input type="checkbox" disabled={!editor} checked={draft.capabilities[key][tier]} onChange={(event) => capability(key, tier, event.target.checked)} />
                        <span className="switch-track" />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("limits.title")}</h2><p>{t("limits.copy")}</p></div></div>
        <div className="panel-body">
          <div className="table-wrap membership-config-table">
            <table className="data-table">
              <thead><tr><th>{t("limits.quota")}</th><th>{t("limits.scope")}</th><th>{t("tiers.free")}</th><th>{t("tiers.plus")}</th></tr></thead>
              <tbody>{MEMBERSHIP_QUOTAS.map((key) => {
                const bound = catalogue.bounds[key];
                return (
                  <tr key={key}>
                    <td><strong>{t(`quotas.${key}`)}</strong><small className="table-subline">{t("limits.bounds", { min: bound.min, max: bound.max })}</small></td>
                    <td>{t(`scopes.${draft.quotas[key].scope}`)}</td>
                    {MEMBERSHIP_TIERS.map((tier) => {
                      const rule = draft.quotas[key][tier];
                      return (
                        <td key={tier}>
                          <div className="membership-rule-control">
                            <select disabled={!editor} value={rule.mode} aria-label={t("limits.modeLabel", { quota: t(`quotas.${key}`), tier: t(`tiers.${tier}`) })} onChange={(event) => quotaMode(key, tier, event.target.value as MembershipQuotaMode)}>
                              <option value="disabled">{t("modes.disabled")}</option>
                              <option value="finite">{t("modes.finite")}</option>
                              <option value="unlimited">{t("modes.unlimited")}</option>
                            </select>
                            {rule.mode === "finite" ? (
                              <input
                                disabled={!editor}
                                type="number"
                                min={bound.min}
                                max={bound.max}
                                step={1}
                                value={rule.value ?? ""}
                                aria-invalid={validationIssues.some((issue) => issue.quota === key && (issue.tier === null || issue.tier === tier))}
                                aria-label={t("limits.valueLabel", { quota: t(`quotas.${key}`), tier: t(`tiers.${tier}`) })}
                                onChange={(event) => quotaValue(key, tier, event.target.value)}
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
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("preview.title")}</h2><p>{t("preview.copy")}</p></div></div>
        <div className="panel-body membership-plan-preview">
          <div className="membership-tier-preview-grid">
            {planPreview.tiers.map((tierPreview) => (
              <article className="membership-tier-preview" key={tierPreview.tier}>
                <div className="membership-tier-preview-head">
                  <h3>{t("preview.memberTier", { tier: t(`tiers.${tierPreview.tier}`) })}</h3>
                  <span className={`badge ${tierPreview.tier === "plus" ? "badge-active" : "badge-inactive"}`}>
                    {t(`tiers.${tierPreview.tier}`)}
                  </span>
                </div>
                <div>
                  <h4>{t("preview.capabilities")}</h4>
                  <ul>{tierPreview.capabilities.map((capability) => (
                    <li key={capability.key}>
                      <span className="membership-preview-benefit-copy">
                        {t(`capabilities.${capability.key}`)}
                        <small>{t(`capabilityHelp.${capability.key}`)}</small>
                      </span>
                      <strong>{capability.enabled ? t("preview.included") : t("preview.notIncluded")}</strong>
                    </li>
                  ))}</ul>
                </div>
                <div>
                  <h4>{t("preview.quotas")}</h4>
                  <MembershipQuotaPreviewList
                    quotas={tierPreview.quotas}
                    tier={tierPreview.tier}
                    validationIssues={validationIssues}
                    featureSwitches={featureSwitches}
                  />
                </div>
              </article>
            ))}
          </div>
          <p className="alert alert-info membership-rollout-warning">{t("rollout.featureDependencyUnknown")}</p>
          <div className="membership-preset-summary">
            <div>
              <h3>{t("preview.presetsTitle")}</h3>
              <p>{t("preview.presetsCopy")}</p>
            </div>
            <div className="membership-preset-grid">
              {planPreview.presets.map((preset) => (
                <div key={preset.key}>
                  <strong>{t(`preview.periods.${preset.period}`)}</strong>
                  <span>{t("preview.presetResult", { tier: t(`tiers.${preset.tier}`) })}</span>
                  <small>{preset.key}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("products.title")}</h2><p>{t("products.copy")}</p></div></div>
        <div className="panel-body">
          <div className="membership-products">
            {storeProducts.map((product) => (
              <div key={`${product.platform}-${product.product_id}`}>
                <span>{t(`products.platforms.${product.platform}`)}</span>
                <strong>{product.product_id}</strong>
                <span>{product.tier.toUpperCase()} · {product.period}</span>
              </div>
            ))}
            {catalogue.store_products.google.length === 0 ? <div><strong>{t("products.googlePending")}</strong><span>{t("products.googlePendingCopy")}</span></div> : null}
          </div>
        </div>
      </section>

      <section className="panel membership-readiness-panel">
        <div className="panel-header"><div><h2>{t("readiness.title")}</h2><p>{t("readiness.copy")}</p></div></div>
        <div className="panel-body">
          <label className="checkbox-field">
            <input type="checkbox" disabled={!owner} checked={draft.ready_for_enforcement} onChange={(event) => setDraft((current) => current ? { ...current, ready_for_enforcement: event.target.checked } : current)} />
            <span>{t("readiness.label")}</span>
          </label>
          <p className="field-hint">{t("readiness.hint")}</p>
          {!owner ? <p className="field-hint">{t("readiness.ownerOnly")}</p> : null}
          <div className="row-actions membership-save-row">
            <button type="button" className="button button-primary" disabled={saveDisabled} onClick={() => void save()}>{saving ? common("saving") : t("save")}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

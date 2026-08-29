"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AppearanceRuleEditor from "@/components/AppearanceRuleEditor";
import AppearanceTestPreview from "@/components/AppearanceTestPreview";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  APPEARANCE_PALETTE_ROLES,
  appearanceRuleDraft,
  appearanceRuleInputFromDraft,
  appearanceRuleIsLive,
  localizedAppearanceCountries,
  newAppearanceRuleDraft,
  parseAppearanceListPayload,
  parseAppearanceRule,
  sortAppearanceRules,
  validateAppearanceRuleDraft,
  type AppearanceDraftError,
  type AppearanceListPayload,
  type AppearanceRule,
  type AppearanceRuleDraft,
} from "@/lib/appearanceRules";
import { formatDate } from "@/lib/format";

type LoadState = "loading" | "ready" | "error";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The Appearance & placements console. The page wrapper gates it behind the
 * readiness switch; this component owns the list, the editor and the
 * test-location preview, and never computes a resolution the browser would
 * present as Core's answer.
 */
export default function AppearanceConsole() {
  const t = useTranslations("appearance");
  const common = useTranslations("common");
  const locale = useLocale();
  const [payload, setPayload] = useState<AppearanceListPayload | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState<AppearanceRuleDraft | null>(null);
  const [deleting, setDeleting] = useState<AppearanceRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const countries = useMemo(() => localizedAppearanceCountries(locale), [locale]);

  const load = useCallback(async () => {
    if (!payload) setState("loading");
    const response = await adminCall("appearance_rules_list");
    const parsed = response?.success ? parseAppearanceListPayload(response.data) : null;
    if (!parsed) {
      // A read error must never render as a proven empty state.
      setState("error");
      return;
    }
    setPayload(parsed);
    setState("ready");
  }, [payload]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const rules = useMemo(() => sortAppearanceRules(payload?.rules ?? []), [payload]);
  const globalRule = useMemo(() => rules.find((rule) => rule.scope === "global") ?? null, [rules]);
  const ruleNames = useMemo(() => new Map(rules.map((rule) => [rule.id, rule.name])), [rules]);
  const now = Date.now();
  const liveCount = rules.filter((rule) => appearanceRuleIsLive(rule, now)).length;

  function draftErrorMessage(code: AppearanceDraftError): string {
    return t(`validation.${code}`);
  }

  function coreErrorMessage(error: unknown, fallback: string): string {
    const code = typeof error === "string" ? error : "";
    if (code === "appearance-rule-conflict") return t("errors.conflict");
    if (code === "appearance-rule-not-found") return t("errors.notFound");
    if (code === "appearance-rule-global-protected") return t("errors.globalProtected");
    if (code === "admin-write-required") return t("errors.writeRequired");
    if (code === "core-timeout") return t("errors.timeout");
    if (code.startsWith("appearance-rule-")) return t("errors.rejected", { code });
    return fallback;
  }

  async function save() {
    if (!draft) return;
    const validation = validateAppearanceRuleDraft(draft);
    if (validation) {
      setFormError(draftErrorMessage(validation));
      return;
    }
    const rule = appearanceRuleInputFromDraft(draft);
    if (!rule) {
      setFormError(t("validation.name"));
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("appearance_rules_save", { id: draft.id, expected_revision: draft.revision, rule });
    setBusy(false);
    const saved = response?.success ? parseAppearanceRule(record(response.data)?.rule) : null;
    if (!saved) {
      const message = coreErrorMessage(response?.error, t("errors.save"));
      setFormError(message);
      if (response?.error === "appearance-rule-conflict" || response?.error === "core-timeout") {
        // Never replay an uncertain or stale write: reload the authoritative list instead.
        void load();
      }
      return;
    }
    setPayload((current) => current
      ? { ...current, rules: [...current.rules.filter((row) => row.id !== saved.id), saved] }
      : current);
    setDraft(null);
    setToast({ tone: "success", text: t("toast.saved") });
  }

  async function remove() {
    if (!deleting) return;
    if (deleting.scope === "global") {
      setToast({ tone: "error", text: t("errors.globalProtected") });
      setDeleting(null);
      return;
    }
    setBusy(true);
    const response = await adminCall("appearance_rules_delete", { id: deleting.id, expected_revision: deleting.revision });
    setBusy(false);
    if (!response?.success) {
      setToast({ tone: "error", text: coreErrorMessage(response?.error, t("errors.delete")) });
      setDeleting(null);
      if (response?.error === "appearance-rule-conflict" || response?.error === "appearance-rule-not-found") void load();
      return;
    }
    setPayload((current) => current ? { ...current, rules: current.rules.filter((row) => row.id !== deleting.id) } : current);
    setDeleting(null);
    setToast({ tone: "success", text: t("toast.deleted") });
  }

  function newRule() {
    setFormError("");
    setDraft(globalRule
      ? newAppearanceRuleDraft("geo", t("newGeoName"), 10)
      : newAppearanceRuleDraft("global", t("newGlobalName"), 0));
  }

  function scopeLabel(rule: AppearanceRule): string {
    if (rule.scope === "global") return t("scope.global");
    if (rule.scope === "storefront") {
      const country = countries.find((entry) => entry.alpha3 === rule.storefront_country);
      return `${t("scope.storefront")} · ${country ? `${country.name} (${rule.storefront_country})` : rule.storefront_country}`;
    }
    return `${t("scope.geo")} · ${rule.place_label}${rule.country_code ? `, ${rule.country_code}` : ""} · ${rule.radius_km ?? "—"} km`;
  }

  function windowLabel(rule: AppearanceRule): string {
    if (rule.starts_at === null && rule.ends_at === null) return t("list.always");
    const starts = rule.starts_at ? formatDate(Date.parse(rule.starts_at) / 1000, locale, true) : "…";
    const ends = rule.ends_at ? formatDate(Date.parse(rule.ends_at) / 1000, locale, true) : "…";
    return `${starts} → ${ends}`;
  }

  function setsLabel(rule: AppearanceRule): string {
    const parts: string[] = [];
    if (Object.keys(rule.landing).length > 0) parts.push(t("list.setsLanding"));
    if (rule.hero.mode === "replace") parts.push(t("list.setsHero", { count: rule.hero.items.length }));
    const roles = new Set([...Object.keys(rule.palette.light), ...Object.keys(rule.palette.dark)]);
    if (roles.size > 0) parts.push(t("list.setsPalette", { count: roles.size, total: APPEARANCE_PALETTE_ROLES.length }));
    return parts.length > 0 ? parts.join(" · ") : t("list.setsNothing");
  }

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-primary" disabled={state !== "ready"} onClick={newRule}>{globalRule ? t("newRule") : t("newGlobalRule")}</button>}
      />
      <div className="list-summary">
        <strong>{t("liveCount", { live: liveCount, total: rules.length })}</strong>
        <span>{t("precedence")}</span>
      </div>
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rules.length === 0 ? (
        <EmptyPanel title={t("empty")} copy={t("emptyCopy")} />
      ) : (
        <section className="landing-rule-list appearance-rule-list">
          {rules.map((rule) => {
            const live = appearanceRuleIsLive(rule, now);
            return (
              <article className="landing-rule-card appearance-rule-card" key={rule.id} data-scope={rule.scope}>
                <div className="landing-rule-body">
                  <div className="appearance-rule-title">
                    <strong>{rule.name}</strong>
                    <span className={`badge badge-info appearance-scope-badge appearance-scope-${rule.scope}`}>{scopeLabel(rule)}</span>
                  </div>
                  <div className="hero-meta">
                    <span className={`badge ${live ? "badge-active" : "badge-inactive"}`}>
                      {rule.active ? (live ? common("active") : t("list.scheduled")) : common("inactive")}
                    </span>
                    <span className="badge">{t("list.priority", { value: rule.priority })}</span>
                    {rule.migrated_from === "country" && <span className="badge badge-warning">{t("list.migrated")}</span>}
                  </div>
                  <div className="landing-variants">
                    <span>{t("list.window")}: {windowLabel(rule)}</span>
                    <span>{t("list.sets")}: {setsLabel(rule)}</span>
                    <span>{t("list.revision", { revision: rule.revision, by: rule.updated_by || "—" })}</span>
                  </div>
                  <div className="appearance-rule-swatches" aria-hidden="true">
                    {(["light", "dark"] as const).map((mode) => (
                      <span key={mode} className="appearance-rule-swatch-row">
                        {APPEARANCE_PALETTE_ROLES.map((role) => (
                          <span
                            key={role}
                            className={`appearance-swatch${rule.palette[mode][role] ? "" : " appearance-swatch-inherit"}`}
                            style={{ background: rule.palette[mode][role] ?? "transparent" }}
                          />
                        ))}
                      </span>
                    ))}
                  </div>
                  <div className="row-actions">
                    <button className="button button-secondary button-small" onClick={() => { setFormError(""); setDraft(appearanceRuleDraft(rule)); }}>
                      {common("edit")}
                    </button>
                    {rule.scope !== "global" && (
                      <button className="button button-danger button-small" onClick={() => setDeleting(rule)}>
                        {common("delete")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {state === "ready" && <AppearanceTestPreview countries={countries} ruleNames={ruleNames} />}
      {draft && payload && (
        <AppearanceRuleEditor
          value={draft}
          globalRule={globalRule && globalRule.id !== draft.id ? globalRule : null}
          defaults={payload.defaults}
          countries={countries}
          busy={busy}
          error={formError}
          onChange={setDraft}
          onClose={() => { if (!busy) setDraft(null); }}
          onSave={() => void save()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          busyLabel={common("deleting")}
          title={t("deleteTitle")}
          copy={t("deleteCopy", { name: deleting.name })}
          confirmLabel={common("delete")}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
      {toast && <div className={`toast${toast.tone === "error" ? " toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.text}</div>}
    </>
  );
}

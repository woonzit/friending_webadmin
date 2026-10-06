"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AppearanceRuleEditor from "@/components/AppearanceRuleEditor";
import AppearanceTestPreview from "@/components/AppearanceTestPreview";
import ConfirmDialog from "@/components/ConfirmDialog";
import ModeCardsPanel from "@/components/ModeCardsPanel";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  APPEARANCE_PALETTE_ROLES,
  appearanceRuleDraft,
  appearanceRuleInputFromDraft,
  appearanceRuleIsLive,
  decodeAppearanceDeleteResponse,
  decodeAppearanceListResponse,
  decodeAppearanceSaveResponse,
  localizedAppearanceCountries,
  newAppearanceRuleDraft,
  reconcileAppearanceCreate,
  reconcileAppearanceUpdate,
  sortAppearanceRules,
  validateAppearanceRuleDraft,
  type AppearanceDraftError,
  type AppearanceListPayload,
  type AppearanceRule,
  type AppearanceRuleDraft,
  type AppearanceRuleInput,
} from "@/lib/appearanceRules";
import { formatDate } from "@/lib/format";

type LoadState = "loading" | "ready" | "error";

/**
 * A write whose outcome is not proven. While one is pending the operator can
 * only reload; a create is never retried until the authoritative list proves
 * it did not land (or the landed rule is adopted by its material).
 */
type UncertainWrite =
  | { kind: "create"; baseline_ids: string[]; input: AppearanceRuleInput }
  | { kind: "update"; id: string; expected_revision: number; input: AppearanceRuleInput }
  | { kind: "delete"; id: string };

/**
 * The Appearance & placements console. The dashboard layout gates the page on
 * the session and the role; this component owns the list, the editor and the
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
  const [uncertain, setUncertain] = useState<UncertainWrite | null>(null);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const countries = useMemo(() => localizedAppearanceCountries(locale), [locale]);

  /** One authoritative read; `null` means the list could not be proven (never an empty state). */
  const fetchList = useCallback(async (): Promise<AppearanceListPayload | null> => {
    const decoded = decodeAppearanceListResponse(await adminCall("appearance_rules_list"));
    if (!decoded.ok) {
      setState("error");
      return null;
    }
    setPayload(decoded.value);
    setState("ready");
    return decoded.value;
  }, []);

  const load = useCallback(async () => {
    if (!payload) setState("loading");
    await fetchList();
  }, [payload, fetchList]);

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

  function refusalMessage(code: string, fallback: string): string {
    if (code === "appearance-rule-conflict") return t("errors.conflict");
    if (code === "appearance-rule-not-found") return t("errors.notFound");
    if (code === "appearance-rule-global-protected") return t("errors.globalProtected");
    if (code === "admin-write-required") return t("errors.writeRequired");
    if (code.startsWith("appearance-rule-")) return t("errors.rejected", { code });
    return fallback;
  }

  /**
   * Resolve an uncertain write against the authoritative list. Nothing is
   * retried automatically; the operator regains the save control only once the
   * reload has proven what happened.
   */
  async function reconcile(pending: UncertainWrite) {
    setUncertain(pending);
    const fresh = await fetchList();
    if (!fresh) {
      setFormError(t("errors.uncertainReloadFailed"));
      if (pending.kind === "delete") setToast({ tone: "error", text: t("errors.uncertainReloadFailed") });
      return;
    }
    setUncertain(null);
    if (pending.kind === "create") {
      // T-468b finding 25: only a row whose id was absent from the pre-request baseline proves the create.
      const landed = reconcileAppearanceCreate(pending, fresh.rules).adopt;
      if (landed) {
        setDraft(null);
        setFormError("");
        setToast({ tone: "success", text: t("toast.recovered") });
      } else {
        setFormError(t("errors.uncertainNotLanded"));
      }
      return;
    }
    if (pending.kind === "update") {
      // T-468b finding 21: revision-aware — the stale draft is never rebased onto a newer row.
      const decision = reconcileAppearanceUpdate(pending, fresh.rules.find((rule) => rule.id === pending.id) ?? null);
      switch (decision.outcome) {
        case "missing":
          setDraft(null);
          setFormError("");
          setToast({ tone: "error", text: t("errors.notFound") });
          return;
        case "landed":
          setDraft(null);
          setFormError("");
          setToast({ tone: "success", text: t("toast.recovered") });
          return;
        case "not-landed":
          // Proven no-land at the unchanged revision: the draft keeps its expected revision and may be retried deliberately.
          setFormError(t("errors.uncertainNotLanded"));
          return;
        case "conflict":
        case "superseded":
          // Someone else's material owns a newer revision: close the stale draft; the operator reopens the authoritative row.
          setDraft(null);
          setFormError("");
          setToast({ tone: "error", text: t(decision.outcome === "conflict" ? "errors.uncertainConflict" : "errors.uncertainSuperseded") });
          return;
      }
    }
    const stillThere = fresh.rules.some((rule) => rule.id === pending.id);
    setToast(stillThere
      ? { tone: "error", text: t("errors.uncertainNotLanded") }
      : { tone: "success", text: t("toast.deletedRecovered") });
  }

  async function save() {
    if (!draft || uncertain) return;
    const validation = validateAppearanceRuleDraft(draft);
    if (validation) {
      setFormError(draftErrorMessage(validation));
      return;
    }
    const input = appearanceRuleInputFromDraft(draft);
    if (!input) {
      setFormError(t("validation.name"));
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("appearance_rules_save", { id: draft.id, expected_revision: draft.revision, rule: input });
    const decoded = decodeAppearanceSaveResponse(response, { id: draft.id, expected_revision: draft.revision, input });
    if (decoded.ok) {
      const saved = decoded.value;
      setPayload((current) => current
        ? { ...current, rules: [...current.rules.filter((row) => row.id !== saved.id), saved] }
        : current);
      setBusy(false);
      setDraft(null);
      setToast({ tone: "success", text: t("toast.saved") });
      return;
    }
    if (decoded.kind === "refused") {
      setFormError(refusalMessage(decoded.error, t("errors.save")));
      if (decoded.error === "appearance-rule-conflict" || decoded.error === "appearance-rule-not-found") {
        // Stale revision: show the authoritative list; the operator redoes the change.
        await fetchList();
      }
      setBusy(false);
      return;
    }
    await reconcile(draft.id === "" ? { kind: "create", baseline_ids: rules.map((rule) => rule.id), input } : { kind: "update", id: draft.id, expected_revision: draft.revision, input });
    setBusy(false);
  }

  async function remove() {
    if (!deleting || uncertain) return;
    if (deleting.scope === "global") {
      setToast({ tone: "error", text: t("errors.globalProtected") });
      setDeleting(null);
      return;
    }
    setBusy(true);
    const target = deleting;
    const response = await adminCall("appearance_rules_delete", { id: target.id, expected_revision: target.revision });
    const decoded = decodeAppearanceDeleteResponse(response, target.id);
    setDeleting(null);
    if (decoded.ok) {
      setPayload((current) => current ? { ...current, rules: current.rules.filter((row) => row.id !== target.id) } : current);
      setBusy(false);
      setToast({ tone: "success", text: t("toast.deleted") });
      return;
    }
    if (decoded.kind === "refused") {
      setToast({ tone: "error", text: refusalMessage(decoded.error, t("errors.delete")) });
      if (decoded.error === "appearance-rule-conflict" || decoded.error === "appearance-rule-not-found") await fetchList();
      setBusy(false);
      return;
    }
    await reconcile({ kind: "delete", id: target.id });
    setBusy(false);
  }

  async function reloadAfterUncertain() {
    if (!uncertain || busy) return;
    setBusy(true);
    await reconcile(uncertain);
    setBusy(false);
  }

  function newRule() {
    if (uncertain) return;
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
        actions={state === "ready" ? <button className="button button-primary" disabled={uncertain !== null} onClick={newRule}>{globalRule ? t("newRule") : t("newGlobalRule")}</button> : null}
      />
      {state === "ready" && <div className="list-summary">
        <strong>{t("liveCount", { live: liveCount, total: rules.length })}</strong>
        <span>{t("precedence")}</span>
      </div>}
      {uncertain && !draft && (
        <div className="alert alert-warning" role="alert">
          <span>{t("errors.uncertainReloadFailed")}</span>
          <button className="button button-secondary button-small" disabled={busy} onClick={() => void reloadAfterUncertain()}>{common("retry")}</button>
        </div>
      )}
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={uncertain ? () => void reloadAfterUncertain() : load} />
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
                    {rule.migrated_from !== null && <span className="badge badge-warning">{t("list.migrated")}</span>}
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
                    <button className="button button-secondary button-small" disabled={uncertain !== null} onClick={() => { setFormError(""); setDraft(appearanceRuleDraft(rule)); }}>
                      {common("edit")}
                    </button>
                    {rule.scope !== "global" && (
                      <button className="button button-danger button-small" disabled={uncertain !== null} onClick={() => setDeleting(rule)}>
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
      {/*
        T-706 / D-115. Its own revision, its own receipt and its own save: the
        mode switcher is one global answer, while an appearance rule is a
        targeted, geo-scoped document. Folding it into the rule draft would let
        a copy edit conflict with an unrelated city rule.
      */}
      {state === "ready" && <ModeCardsPanel />}
      {draft && payload && (
        <AppearanceRuleEditor
          value={draft}
          persistedRule={draft.id === "" ? null : rules.find((rule) => rule.id === draft.id) ?? null}
          globalRule={globalRule && globalRule.id !== draft.id ? globalRule : null}
          defaults={payload.defaults}
          countries={countries}
          busy={busy}
          uncertain={uncertain !== null}
          error={formError}
          onChange={setDraft}
          onClose={() => { if (!busy) { setDraft(null); setFormError(""); } }}
          onSave={() => void save()}
          onReload={() => void reloadAfterUncertain()}
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

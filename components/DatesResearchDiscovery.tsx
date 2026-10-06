"use client";
import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ResearchCommandFeedback, ResearchHelp, ResearchReason, useResearchCommand } from "@/components/DatesResearchControls";
import { useResearchDraft } from "@/components/DatesResearchEditors";
import { DATES_RESEARCH_DOMAIN_TYPES, type ResearchArea, type ResearchDefaults, type ResearchDiscoveryAdmission, type ResearchDomain,
  type ResearchEstimate, type ResearchLimits, type ResearchModelOptions, type ResearchModels } from "@/lib/datesResearchAdmin";
import { researchAuditReason, researchDomainsValid } from "@/lib/datesResearchProxy";
import { researchCost, researchDefaultValues } from "@/lib/datesResearchView";
import { formatDate, formatNumber } from "@/lib/format";

type PolicyDraft = { research_models: ResearchModels; domains: ResearchDomain[] };
const policyDraft = (row: ResearchDefaults): PolicyDraft => ({ research_models: { ...row.research_models ?? { openai: "", gemini: "" } }, domains: row.domains?.rows.map((entry) => ({ ...entry })) ?? [] });
export function ResearchDomainEditor({ defaults, options, limits, actor, manage, reload }: {
  defaults: ResearchDefaults; options: ResearchModelOptions | null | undefined; limits: ResearchLimits; actor: string; manage: boolean; reload: () => Promise<void>;
}) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common");
  const model = useResearchDraft(policyDraft(defaults), defaults.revision), [reason, setReason] = useState("");
  const command = useResearchCommand(actor, async (answer) => {
    // The command decoder has already returned the typed defaults model.
    // Its domains are a row-local collection, not a raw wire array to decode twice.
    const row = answer.receipt as ResearchDefaults;
    if (row.research_models && row.domains && row.domains.unreadable.length === 0) model.adopt(policyDraft(row), row.revision);
    setReason(""); await reload();
  }, reload);
  const range = limits.domains;
  const readable = !!defaults.research_models && !!defaults.domains && !!options && !!range;
  const incomplete = !readable || defaults.domains!.unreadable.length !== 0;
  const disabled = !manage || command.busy || command.retained || incomplete;
  const valid = readable && researchDomainsValid(model.draft.domains)
    && model.draft.domains.length >= range!.min && model.draft.domains.length <= range!.max
    && options!.openai.includes(model.draft.research_models.openai) && options!.gemini.includes(model.draft.research_models.gemini);
  return <form className="panel research-editor" id="research-domains" onSubmit={(event) => { event.preventDefault(); if (disabled || !valid) return;
    void command.submit("dates_event_research_defaults_save", { expected_revision: model.revision, reason,
      values: { ...researchDefaultValues(defaults), enabled: defaults.enabled, auto_cities_enabled: defaults.auto_cities_enabled, ...model.draft } }); }}>
    <h2>{t("discovery.policyTitle")}</h2><p>{t("discovery.policyHint")}</p>
    {!readable && <p className="alert alert-warning">{t("discovery.policyUnavailable")}</p>}
    {defaults.domains?.unreadable.map((row) => <p className="alert alert-warning" key={row.index}>{t("unreadableRow", { row: row.index + 1 })}{row.id && <> <code>{row.id}</code></>}</p>)}
    {readable && <><div className="form-grid">{(["openai", "gemini"] as const).map((provider) => {
      const current = model.draft.research_models[provider];
      return <label className="field" key={provider}><span>{t(`discovery.models.${provider}`)}</span>
        <select value={current} disabled={disabled} onChange={(event) => model.set({ ...model.draft, research_models: { ...model.draft.research_models, [provider]: event.target.value } })}>
          {!options![provider].includes(current) && <option value={current}>{current}</option>}
          {options![provider].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>;
    })}</div><ResearchHelp field="research_models" />
      <h3>{t("discovery.domainsTitle")}</h3><ResearchHelp field="domains" /><p className="field-hint">{t("discovery.domainLimits", { min: range!.min, max: range!.max })}</p>
      {model.draft.domains.length === 0 && <p>{t("discovery.domainsEmpty")}</p>}
      {model.draft.domains.map((row, index) => <div className="form-grid" key={index}>
        <label className="field"><span>{t("discovery.domain")}</span><input value={row.domain} disabled={disabled} placeholder={t("discovery.domainPlaceholder")}
          onChange={(event) => model.set({ ...model.draft, domains: model.draft.domains.map((entry, at) => at === index ? { ...entry, domain: event.target.value } : entry) })} /></label>
        <label className="field"><span>{t("discovery.domainType")}</span><select value={row.type} disabled={disabled}
          onChange={(event) => model.set({ ...model.draft, domains: model.draft.domains.map((entry, at) => at === index ? { ...entry, type: event.target.value as ResearchDomain["type"] } : entry) })}>
          {DATES_RESEARCH_DOMAIN_TYPES.map((type) => <option key={type} value={type}>{t(`discovery.domainTypes.${type}`)}</option>)}</select></label>
        {manage && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => model.set({ ...model.draft, domains: model.draft.domains.filter((_entry, at) => at !== index) })}>{t("discovery.removeDomain")}</button>}
      </div>)}
      {manage && <><button type="button" className="button button-secondary" disabled={disabled || model.draft.domains.length >= range!.max}
        onClick={() => { if (!disabled && model.draft.domains.length < range!.max) model.set({ ...model.draft, domains: [...model.draft.domains, { domain: "", type: "official" }] }); }}>{t("discovery.addDomain")}</button>
        <ResearchReason value={reason} onChange={setReason} disabled={disabled} /><button type="submit" className="button button-primary"
          disabled={disabled || !valid || !researchAuditReason(reason)}>{common(command.busy ? "saving" : "save")}</button></>}
    </>}
    <ResearchCommandFeedback command={command} />
  </form>;
}
export function ResearchDiscoveryAdmissionPanel({ admission, defaults, actor, manage, reload }: {
  admission: ResearchDiscoveryAdmission | null; defaults: ResearchDefaults | null; actor: string; manage: boolean; reload: () => Promise<void>;
}) {
  const t = useTranslations("datesAdmin.research"), locale = useLocale(), [reason, setReason] = useState("");
  const command = useResearchCommand(actor, async () => { setReason(""); await reload(); }, reload);
  return <section className="panel research-panel"><h2>{t("discovery.title")}</h2>
    {!admission ? <p className="alert alert-warning">{t("discovery.admissionUnavailable")}</p> : <>
      <p>{t(admission.openai_admitted ? "discovery.openaiAdmitted" : "discovery.openaiPaused")}</p>
      <p>{t("discovery.geminiUnavailable")}</p><p className="field-hint">{t("discovery.marginHint")}</p>
      {admission.pause && <><p className="alert alert-warning">{t(`discovery.pauseReasons.${admission.pause.reason}`)} · <code>{admission.pause.run_id}</code> · {formatDate(admission.pause.at, locale, true)}</p>
        <p>{t("discovery.resumeHint")}</p>{manage && defaults && <form onSubmit={(event) => { event.preventDefault(); void command.submit("dates_event_research_discovery_resume", { expected_revision: defaults.revision, reason }); }}>
          <ResearchReason value={reason} onChange={setReason} disabled={command.busy || command.retained} />
          <button type="submit" className="button button-primary" disabled={command.busy || command.retained || !researchAuditReason(reason)}>{t("discovery.resume")}</button>
        </form>}</>}
    </>}
    <ResearchCommandFeedback command={command} />
  </section>;
}
export function ResearchAreaRunButtons({ row, defaults, admission, manage, command }: {
  row: ResearchArea; defaults: ResearchDefaults | null; admission: ResearchDiscoveryAdmission | null | undefined; manage: boolean; command: ReturnType<typeof useResearchCommand>;
}) {
  const t = useTranslations("datesAdmin.research");
  if (!manage || admission === undefined) return null;
  const disabled = defaults?.enabled !== true || !row.running || admission?.openai_admitted !== true || command.busy || command.retained;
  return <><button type="button" className="button button-secondary button-small" disabled={disabled}
    onClick={() => void command.submit("dates_event_research_area_run_now", { area_id: row.area_id, expected_revision: row.revision, dry_run: true })}>{t("test")}</button>
    <button type="button" className="button button-primary button-small" disabled={disabled}
      onClick={() => void command.submit("dates_event_research_area_run_now", { area_id: row.area_id, expected_revision: row.revision, dry_run: false })}>{t("discovery.runNow")}</button></>;
}
export function ResearchEstimateComponents({ estimate, onRun }: { estimate: ResearchEstimate; onRun: (id: string) => void }) {
  const t = useTranslations("datesAdmin.research"), locale = useLocale();
  if (estimate.area === undefined && estimate.source === undefined) return null;
  return <div><p>{t("discovery.estimateHint")}</p><div className="stat-grid">{(["area", "source"] as const).map((kind) => {
    const value = estimate[kind];
    return <div className="stat-card" key={kind}><span className="stat-label">{t(`discovery.estimates.${kind}`)}</span>
      {!value ? <p>{t("effectiveUnavailable")}</p> : <><strong className="stat-value">{value.monthly_cost_micro_usd === null ? t("notMeasured") : researchCost(value.monthly_cost_micro_usd, locale)}</strong>
        <small>{t("monthlyChecks", { count: value.monthly_checks })}</small>
        <small>{t("discovery.lastMeasuredCost", { amount: value.last_run_cost_micro_usd === null ? t("notMeasured") : researchCost(value.last_run_cost_micro_usd, locale) })}</small>
        {value.last_run_id && <button type="button" className="button button-secondary button-small" onClick={() => onRun(value.last_run_id!)}>{t("openRun")}</button>}
      </>}
    </div>;
  })}</div></div>;
}

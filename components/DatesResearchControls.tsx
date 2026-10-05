"use client";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { DATES_RESEARCH_VALUE_FIELDS, type DatesResearchAction, type ResearchLimits, type ResearchOverrides, type ResearchScope, type ResearchValues } from "@/lib/datesResearchAdmin";
import { prepareResearchCommand, runResearchCommand, type ResearchCommand, type ResearchCommandOutcome } from "@/lib/datesResearchConsole";
import { researchDistanceFromKm, researchDistanceToKm, researchInputNumber, researchTimeFromHours, researchTimeToHours, type ResearchDistanceUnit, type ResearchTimeUnit } from "@/lib/datesResearchView";
import { formatNumber } from "@/lib/format";

export function ResearchHelp({ field, effective, own = false }: { field: string; effective?: string; own?: boolean }) {
  const t = useTranslations("datesAdmin.research");
  return <div className="research-field-help"><small>{t(`help.${field}.purpose`)}</small>
    {effective !== undefined && <small>{t("effective", { value: effective, source: t(own ? "own" : "global") })}</small>}
    <small>{t(`help.${field}.effect`)}</small><small>{t(`help.${field}.cost`)}</small></div>;
}
export function ResearchDuration({ hours, range, disabled, onChange }: { hours: number; range: { min: number; max: number }; disabled: boolean; onChange: (value: number) => void }) {
  const t = useTranslations("datesAdmin.research"), [unit, setUnit] = useState<ResearchTimeUnit>("hours");
  return <><div className="research-unit-input"><input type="number" step="any" min={researchTimeFromHours(range.min, unit)} max={researchTimeFromHours(range.max, unit)}
    value={Number.isFinite(hours) ? researchInputNumber(researchTimeFromHours(hours, unit)) : ""} disabled={disabled}
    onChange={(event) => onChange(event.target.value === "" ? NaN : researchTimeToHours(Number(event.target.value), unit))} />
    <select aria-label={t("timeUnit")} value={unit} disabled={disabled} onChange={(event) => setUnit(event.target.value as ResearchTimeUnit)}>
      <option value="hours">{t("hours")}</option><option value="days">{t("days")}</option></select></div><small>{t("unitsHint")}</small></>;
}
export function ResearchScopeInput({ scope, range, unit, disabled, onUnit, onChange }: { scope: ResearchScope; range: { min: number; max: number };
  unit: ResearchDistanceUnit; disabled: boolean; onUnit: (value: ResearchDistanceUnit) => void; onChange: (value: ResearchScope) => void }) {
  const t = useTranslations("datesAdmin.research");
  return <div className="research-scope-input"><select value={scope.kind} disabled={disabled} onChange={(event) => onChange(event.target.value === "city"
    ? { kind: "city", radius_km: null } : { kind: "radius", radius_km: range.min })}>
    <option value="city">{t("scopeValues.city")}</option><option value="radius">{t("scopeValues.radius")}</option></select>
    {scope.kind === "radius" && <div className="research-unit-input"><input type="number" step="any" aria-label={t("fields.radius_km")}
      value={Number.isFinite(scope.radius_km) ? researchInputNumber(researchDistanceFromKm(scope.radius_km, unit)) : ""}
      min={researchDistanceFromKm(range.min, unit)} max={researchDistanceFromKm(range.max, unit)} disabled={disabled}
      onChange={(event) => onChange({ kind: "radius", radius_km: event.target.value === "" ? NaN : researchDistanceToKm(Number(event.target.value), unit) })} />
      <select aria-label={t("distanceUnit")} value={unit} disabled={disabled} onChange={(event) => onUnit(event.target.value as ResearchDistanceUnit)}>
        <option value="km">{t("km")}</option><option value="mi">{t("mi")}</option></select></div>}{scope.kind === "radius" && <><small>{t("unitsHint")}</small><ResearchHelp field="radius_km" /></>}</div>;
}
export function ResearchValue({ field, values, unit }: { field: keyof ResearchValues; values: ResearchValues; unit: ResearchDistanceUnit }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  if (field === "scope") return <>{values.scope.kind === "city" ? t("scopeValues.city") : `${formatNumber(researchDistanceFromKm(values.scope.radius_km, unit), locale)} ${t(unit)}`}</>;
  if (field === "autopublish") return <>{common(values.autopublish ? "yes" : "no")}</>;
  return <>{formatNumber(values[field], locale)}{field === "cadence_hours" ? ` ${t("hours")}` : field === "window_days" ? ` ${t("days")}` : ""}</>;
}
export function ResearchValuesFields({ values, limits, disabled, unit, onUnit, onChange, inheritance }: {
  values: ResearchValues; limits: ResearchLimits; disabled: boolean; unit: ResearchDistanceUnit; onUnit: (value: ResearchDistanceUnit) => void;
  onChange: (value: ResearchValues) => void; inheritance?: { overrides: ResearchOverrides; onChange: (value: ResearchOverrides) => void };
}) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  function change<K extends keyof ResearchValues>(key: K, value: ResearchValues[K]) {
    if (inheritance) inheritance.onChange({ ...inheritance.overrides, [key]: value }); else onChange({ ...values, [key]: value });
  }
  function effective(key: keyof ResearchValues) {
    if (key === "autopublish") return common(values.autopublish ? "yes" : "no");
    if (key === "scope") return values.scope.kind === "city" ? t("scopeValues.city") : `${formatNumber(researchDistanceFromKm(values.scope.radius_km, unit), locale)} ${t(unit)}`;
    return `${formatNumber(values[key], locale)}${key === "cadence_hours" ? ` ${t("hours")}` : key === "window_days" ? ` ${t("days")}` : ""}`;
  }
  return <div className="form-grid">{DATES_RESEARCH_VALUE_FIELDS.map((key) => {
    const inherited = inheritance?.overrides[key] === null, locked = disabled || inherited;
    return <div className="field research-field" key={key}><label><span>{t(`fields.${key}`)}</span>
      {key === "scope" ? <ResearchScopeInput scope={values.scope} range={limits.radius_km} unit={unit} onUnit={onUnit} disabled={locked} onChange={(value) => change("scope", value)} />
        : key === "cadence_hours" ? <ResearchDuration hours={values.cadence_hours} range={limits.cadence_hours} disabled={locked} onChange={(value) => change("cadence_hours", value)} />
          : key === "autopublish" ? <input type="checkbox" checked={values.autopublish} disabled={locked} onChange={(event) => change("autopublish", event.target.checked)} />
            : <input type="number" step="1" value={Number.isFinite(values[key]) ? values[key] : ""} min={limits[key].min} max={limits[key].max} disabled={locked}
              onChange={(event) => change(key, event.target.value === "" ? NaN : Number(event.target.value))} />}</label>
      {inheritance && <label className="research-inherit"><input type="checkbox" checked={inherited} disabled={disabled}
        onChange={(event) => inheritance.onChange({ ...inheritance.overrides, [key]: event.target.checked ? null : values[key] })} />{t("useGlobal")}</label>}
      <ResearchHelp field={key} effective={effective(key)} own={!!inheritance && !inherited} />
    </div>;
  })}</div>;
}
export function ResearchReason({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const t = useTranslations("datesAdmin.research");
  // Parents and the proxy use researchAuditReason: native length limits count
  // untrimmed UTF-16 units, unlike Core's trimmed Unicode character count.
  return <label className="field field-full"><span>{t("fields.reason")}</span><textarea value={value} disabled={disabled} required onChange={(event) => onChange(event.target.value)} />
    <ResearchHelp field="reason" /></label>;
}
export function useResearchCommand(actor: string, onSuccess: (outcome: Extract<ResearchCommandOutcome, { kind: "success" }>) => Promise<void> | void,
  onConflict: () => Promise<void>) {
  const [pending, setPending] = useState<ResearchCommand | null>(null), [outcome, setOutcome] = useState<ResearchCommandOutcome | null>(null), [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(actor), busyRef = useRef(false), actorRef = useRef(actor); actorRef.current = actor;
  useEffect(() => { if (actor && actor !== owner) { setOwner(actor); setPending(null); setOutcome(null); } }, [actor, owner]);
  async function execute(command: ResearchCommand) {
    if (busyRef.current || command.actor !== actorRef.current) return;
    busyRef.current = true; setBusy(true); setPending(command); setOutcome(null);
    try {
      const answer = await runResearchCommand(adminCall, command);
      if (command.actor !== actorRef.current) {
        // A failed identity refresh must not erase an in-flight command. A
        // confirmed different actor is cleared by the owner effect above.
        if (!actorRef.current) setOutcome({ kind: "uncertain", error: null });
        return;
      }
      setOutcome(answer);
      if (answer.kind === "uncertain") setPending(command);
      else { setPending(null); if (answer.kind === "success") await onSuccess(answer); else if (answer.kind === "conflict") await onConflict(); }
    } finally { busyRef.current = false; setBusy(false); }
  }
  const visiblePending = owner === actor ? pending : null, visibleOutcome = owner === actor ? outcome : null;
  return { busy, retained: pending !== null, pending: visiblePending, outcome: visibleOutcome, clear: () => setOutcome(null), retry: () => visiblePending ? execute(visiblePending) : Promise.resolve(),
    submit: async (action: DatesResearchAction, body: Record<string, unknown>) => {
      if (busyRef.current || pending) return;
      const command = prepareResearchCommand(actor, action, body);
      if (!command) { setOutcome({ kind: "refused", error: "invalid-input" }); return; }
      await execute(command);
    } };
}
export function ResearchCommandFeedback({ command, children }: { command: ReturnType<typeof useResearchCommand>; children?: ReactNode }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common");
  const outcome = command.outcome;
  if (!outcome) return null;
  return <div className={`alert alert-${outcome.kind === "success" ? "success" : outcome.kind === "conflict" ? "warning" : "error"}`} role="status">
    <p>{t(`command.${outcome.kind}`)}{outcome.kind !== "success" && outcome.error ? <> <code>{outcome.error}</code></> : null}</p>
    {outcome.kind === "refused" && t.has(`commandErrors.${outcome.error}`) && <p>{t(`commandErrors.${outcome.error}`)}</p>}
    {command.pending && <button type="button" className="button button-secondary" disabled={command.busy} onClick={() => void command.retry()}>{common("retry")}</button>}{children}</div>;
}

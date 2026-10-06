"use client";
import React, { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AppearanceMapPicker from "@/components/AppearanceMapPicker";
import { ResearchCommandFeedback, ResearchDuration, ResearchHelp, ResearchReason, ResearchValuesFields, useResearchCommand } from "@/components/DatesResearchControls";
import { decodeResearchArea, decodeResearchDefaults, decodeResearchSource, DATES_RESEARCH_MODES, DATES_RESEARCH_SOURCE_TYPES,
  type ResearchArea, type ResearchCenter, type ResearchDefaults, type ResearchLimits, type ResearchOverrides, type ResearchSource, type ResearchSourceType } from "@/lib/datesResearchAdmin";
import { researchDefaultValues, researchDistanceUnit, researchEditsAfterConflict, researchEffectiveValues, researchEmptyOverrides, researchValuesIssue, type ResearchDistanceUnit } from "@/lib/datesResearchView";
import { researchAuditReason, researchSourceUrl } from "@/lib/datesResearchProxy";
import { formatNumber } from "@/lib/format";

function useResearchDraft<T extends object>(authority: T, revision: number) {
  const [state, setState] = useState({ baseline: authority, draft: authority, revision });
  useEffect(() => {
    setState((current) => revision < current.revision ? current : { baseline: authority, revision,
      draft: researchEditsAfterConflict(current.baseline, current.draft, authority) });
  // Authority is fenced by its revision. Equal-revision rerenders must not overwrite local edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  return { ...state, set: (draft: T) => setState((current) => ({ ...current, draft })),
    adopt: (draft: T, nextRevision: number) => setState({ baseline: draft, draft, revision: nextRevision }) };
}
type EditorProps = { actor: string; manage: boolean; limits: ResearchLimits; reload: () => Promise<void> };
const defaultDraft = (row: ResearchDefaults) => ({ ...researchDefaultValues(row), enabled: row.enabled, auto_cities_enabled: row.auto_cities_enabled });
export function ResearchDefaultsEditor({ defaults, actor, manage, limits, reload }: EditorProps & { defaults: ResearchDefaults }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common");
  const model = useResearchDraft(defaultDraft(defaults), defaults.revision), [reason, setReason] = useState(""), [unit, setUnit] = useState<ResearchDistanceUnit>("km");
  const command = useResearchCommand(actor, async (answer) => { const row = decodeResearchDefaults(answer.receipt); if (row) model.adopt(defaultDraft(row), row.revision); setReason(""); await reload(); }, reload);
  const disabled = !manage || command.busy, issue = researchValuesIssue(model.draft, limits);
  return <form className="panel research-editor" onSubmit={(event) => { event.preventDefault(); void command.submit("dates_event_research_defaults_save", { expected_revision: model.revision, values: model.draft, reason }); }}>
    <h2>{t("sections.defaults")}</h2><div className="form-grid">{(["enabled", "auto_cities_enabled"] as const).map((key) => {
      return <label className="field" key={key}><span>{t(`fields.${key}`)}</span><input type="checkbox" checked={model.draft[key]} disabled={disabled}
        onChange={(event) => model.set({ ...model.draft, [key]: event.target.checked })} /><ResearchHelp field={key} effective={common(model.draft[key] ? "yes" : "no")} /></label>;
    })}</div>
    <ResearchValuesFields values={model.draft} limits={limits} disabled={disabled} unit={unit} onUnit={setUnit} onChange={(values) => model.set({ ...model.draft, ...values })} />
    {manage && <><ResearchReason value={reason} onChange={setReason} disabled={command.busy} /><button className="button button-primary" type="submit"
      disabled={command.busy || command.pending !== null || issue !== null || !researchAuditReason(reason)}>{common(command.busy ? "saving" : "save")}</button></>}
    <ResearchCommandFeedback command={command} />
  </form>;
}
type AreaDraft = { mode: ResearchArea["mode"]; label: string; overrides: ResearchOverrides };
const areaDraft = (row: ResearchArea | null): AreaDraft => ({ mode: row?.mode ?? "auto", label: row?.label ?? "", overrides: row?.overrides ?? researchEmptyOverrides() });
export function ResearchAreaEditor({ row, defaults, actor, manage, limits, reload, close }: EditorProps & { row: ResearchArea | null; defaults: ResearchDefaults; close: () => void }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const model = useResearchDraft(areaDraft(row), row?.revision ?? 0), [placeId, setPlaceId] = useState(row?.place_id ?? ""), [country, setCountry] = useState(row?.country_code ?? "");
  const [center, setCenter] = useState<ResearchCenter | null>(row?.center ?? null), [unit, setUnit] = useState<ResearchDistanceUnit>(researchDistanceUnit(country)), [reason, setReason] = useState("");
  const effective = researchEffectiveValues(defaults, model.draft.overrides), disabled = !manage, issue = researchValuesIssue(effective, limits);
  const command = useResearchCommand(actor, async (answer) => { const saved = decodeResearchArea(answer.receipt); if (saved) model.adopt(areaDraft(saved), saved.revision); await reload(); close(); }, reload);
  return <form className="panel research-editor" onSubmit={(event) => { event.preventDefault(); void command.submit("dates_event_research_area_save", {
    ...(row ? { area_id: row.area_id, expected_revision: model.revision, label: model.draft.label } : { place_id: placeId }), mode: model.draft.mode, overrides: model.draft.overrides, reason }); }}>
    <div className="panel-header"><h2>{t(row ? "editCity" : "addCity")}</h2><button type="button" className="button button-secondary" disabled={command.busy || command.retained} onClick={close}>{common("close")}</button></div>
    <label className="field"><span>{t("fields.city")}</span><input value={model.draft.label} readOnly={!row} disabled={disabled || command.busy} onChange={(event) => model.set({ ...model.draft, label: event.target.value })} /><ResearchHelp field="city" effective={model.draft.label || "—"} own /></label>
    <AppearanceMapPicker center={center} radiusKm={effective.scope.kind === "radius" ? effective.scope.radius_km : null} language={locale === "hu" ? "hu" : "en"}
      disabled={disabled || command.busy || row !== null} mapReadOnly onMove={() => undefined} onCandidate={(candidate) => { setPlaceId(candidate.place_id); setCountry(candidate.country_code ?? "");
        setUnit(researchDistanceUnit(candidate.country_code ?? "")); setCenter(candidate.center); model.set({ ...model.draft, label: candidate.place_label }); }} />
    <p className="field-hint">{t("mapHint")}</p>
    <label className="field"><span>{t("fields.mode")}</span><select value={model.draft.mode} disabled={disabled || command.busy} onChange={(event) => model.set({ ...model.draft, mode: event.target.value as ResearchArea["mode"] })}>
      {DATES_RESEARCH_MODES.map((mode) => <option key={mode} value={mode}>{t(`modeValues.${mode}`)}</option>)}</select><ResearchHelp field="mode" effective={t(`modeValues.${model.draft.mode}`)} own /></label>
    <ResearchValuesFields values={effective} limits={limits} disabled={disabled || command.busy} unit={unit} onUnit={setUnit} onChange={() => undefined}
      inheritance={{ overrides: model.draft.overrides, onChange: (overrides) => model.set({ ...model.draft, overrides }) }} />
    {manage && <><ResearchReason value={reason} onChange={setReason} disabled={command.busy} /><button className="button button-primary" type="submit"
      disabled={command.busy || command.pending !== null || (!row && !placeId) || issue !== null || !researchAuditReason(reason)}>{common(command.busy ? "saving" : "save")}</button></>}
    <ResearchCommandFeedback command={command} />
  </form>;
}
type SourceDraft = Pick<ResearchSource, "url" | "label" | "type" | "area_id" | "cadence_hours" | "max_events" | "window_days" | "autopublish" | "enabled" | "archived">;
const sourceDraft = (row: ResearchSource | null, defaults: ResearchDefaults, limits: ResearchLimits): SourceDraft => row ? { url: row.url, label: row.label, type: row.type, area_id: row.area_id,
  cadence_hours: row.cadence_hours, max_events: row.max_events, window_days: row.window_days, autopublish: row.autopublish, enabled: row.enabled, archived: row.archived }
  : { url: "", label: "", type: "official", area_id: null, cadence_hours: defaults.cadence_hours, max_events: Math.min(defaults.target_events, limits.max_events.max), window_days: null, autopublish: null, enabled: false, archived: false };
export function ResearchSourceEditor({ row, defaults, areas, actor, manage, limits, reload, close }: EditorProps & { row: ResearchSource | null; defaults: ResearchDefaults; areas: ResearchArea[]; close: () => void }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common"), locale = useLocale();
  const model = useResearchDraft(sourceDraft(row, defaults, limits), row?.revision ?? 0), [reason, setReason] = useState("");
  const command = useResearchCommand(actor, async (answer) => { const saved = decodeResearchSource(answer.receipt); if (saved) model.adopt(sourceDraft(saved, defaults, limits), saved.revision); await reload(); close(); }, reload);
  const disabled = !manage || command.busy, values = model.draft;
  const area = areas.find((item) => item.area_id === values.area_id), unavailableInheritance = values.area_id !== null && !area;
  // Stored inheritance is known only for fields that were already inherited.
  // A source override cannot reveal an unreadable city's value underneath it.
  const stored = row && values.area_id === row.area_id ? row : null;
  const inherited = area?.effective ?? (unavailableInheritance ? {
    window_days: stored?.window_days === null ? stored.effective.window_days : null,
    autopublish: stored?.autopublish === null ? stored.effective.autopublish : null,
  } : defaults);
  const windowDays = values.window_days ?? inherited.window_days, autopublish = values.autopublish ?? inherited.autopublish;
  const valid = researchSourceUrl(values.url) && Number.isSafeInteger(values.cadence_hours) && values.cadence_hours >= limits.cadence_hours.min && values.cadence_hours <= limits.cadence_hours.max
    && Number.isSafeInteger(values.max_events) && values.max_events >= limits.max_events.min && values.max_events <= limits.max_events.max
    && (values.window_days === null || Number.isSafeInteger(values.window_days) && values.window_days >= limits.window_days.min && values.window_days <= limits.window_days.max);
  return <form className="panel research-editor" onSubmit={(event) => { event.preventDefault(); void command.submit("dates_event_research_source_save", {
    ...(row ? { source_id: row.source_id, expected_revision: model.revision } : {}), ...values, reason }); }}>
    <div className="panel-header"><h2>{t(row ? "editSource" : "addSource")}</h2><button className="button button-secondary" type="button" disabled={command.busy || command.retained} onClick={close}>{common("close")}</button></div>
    <div className="form-grid">{(["url", "label"] as const).map((key) => {
      return <label className="field" key={key}><span>{t(`fields.${key}`)}{key === "label" && <> · {t("requiredField")}</>}</span><input type={key === "url" ? "url" : "text"} value={values[key]} disabled={disabled} required
        onChange={(event) => model.set({ ...values, [key]: event.target.value })} /><ResearchHelp field={key} effective={values[key] || "—"} own /></label>;
    })}
      <label className="field"><span>{t("fields.type")}</span><select value={values.type} disabled={disabled} onChange={(event) => { const type = event.target.value as ResearchSourceType;
        model.set({ ...values, type, ...(type === "aggregator" ? { autopublish: null } : {}) }); }}>{DATES_RESEARCH_SOURCE_TYPES.map((type) => <option key={type} value={type}>{t(`sourceTypes.${type}`)}</option>)}</select><ResearchHelp field="type" effective={t(`sourceTypes.${values.type}`)} own /></label>
      <label className="field"><span>{t("fields.city")}</span><select value={values.area_id ?? ""} disabled={disabled} onChange={(event) => model.set({ ...values, area_id: event.target.value || null })}>
        <option value="">{t("noCity")}</option>{values.area_id && !area && <option value={values.area_id}>{t("unavailableCity", { id: values.area_id })}</option>}
        {areas.map((item) => <option key={item.area_id} value={item.area_id}>{item.label}</option>)}</select><ResearchHelp field="city" effective={area?.label ?? (values.area_id ? t("unavailableCity", { id: values.area_id }) : t("noCity"))} own /></label>
      <label className="field"><span>{t("fields.cadence_hours")}</span><ResearchDuration hours={values.cadence_hours} range={limits.cadence_hours} disabled={disabled} onChange={(cadence_hours) => model.set({ ...values, cadence_hours })} /><ResearchHelp field="cadence_hours" effective={`${formatNumber(values.cadence_hours, locale)} ${t("hours")}`} own /></label>
      <label className="field"><span>{t("fields.max_events")}</span><input type="number" step="1" min={limits.max_events.min} max={limits.max_events.max} value={Number.isFinite(values.max_events) ? values.max_events : ""} disabled={disabled}
        onChange={(event) => model.set({ ...values, max_events: event.target.value === "" ? NaN : Number(event.target.value) })} /><ResearchHelp field="max_events" effective={formatNumber(values.max_events, locale)} own /></label>
      <div className="field"><label><span>{t("fields.window_days")}</span><input type="number" step="1" min={limits.window_days.min} max={limits.window_days.max} value={windowDays !== null && Number.isFinite(windowDays) ? windowDays : ""} placeholder={windowDays === null ? t("effectiveUnavailable") : undefined} disabled={disabled || values.window_days === null}
          onChange={(event) => model.set({ ...values, window_days: Number(event.target.value) })} /></label><label className="research-inherit"><input type="checkbox" checked={values.window_days === null} disabled={disabled}
            onChange={(event) => model.set({ ...values, window_days: event.target.checked ? null : inherited.window_days ?? row?.effective.window_days ?? defaults.window_days })} />{t("useInherited")}</label><ResearchHelp field="window_days" effective={windowDays === null ? t("effectiveUnavailable") : `${formatNumber(windowDays, locale)} ${t("days")}`} own={values.window_days !== null || !!area && area.overrides.window_days !== null} unavailableInheritance={values.window_days === null && unavailableInheritance} /></div>
      {values.type === "official" && <div className="field"><label><span>{t("fields.autopublish")}</span>{autopublish === null ? <span>{t("effectiveUnavailable")}</span> : <input type="checkbox" checked={autopublish} disabled={disabled || values.autopublish === null}
          onChange={(event) => model.set({ ...values, autopublish: event.target.checked })} />}</label><label className="research-inherit"><input type="checkbox" checked={values.autopublish === null} disabled={disabled}
          onChange={(event) => model.set({ ...values, autopublish: event.target.checked ? null : inherited.autopublish ?? row?.effective.autopublish ?? defaults.autopublish })} />{t("useInherited")}</label><ResearchHelp field="autopublish" effective={autopublish === null ? t("effectiveUnavailable") : common(autopublish ? "yes" : "no")} own={values.autopublish !== null || !!area && area.overrides.autopublish !== null} unavailableInheritance={values.autopublish === null && unavailableInheritance} /></div>}
      {(["enabled", "archived"] as const).map((key) => <label className="field" key={key}><span>{t(`fields.${key === "enabled" ? "source_enabled" : key}`)}</span><input type="checkbox" checked={values[key]} disabled={disabled}
        onChange={(event) => model.set({ ...values, [key]: event.target.checked })} /><ResearchHelp field={key === "enabled" ? "source_enabled" : key} effective={common(values[key] ? "yes" : "no")} own /></label>)}
    </div>{values.type === "aggregator" && <p className="alert alert-info">{t("aggregatorHint")}</p>}
    {manage && <><ResearchReason value={reason} onChange={setReason} disabled={command.busy} /><button type="submit" className="button button-primary" disabled={command.busy || command.pending !== null || !valid || !researchAuditReason(reason)}>{common(command.busy ? "saving" : "save")}</button></>}
    <ResearchCommandFeedback command={command} />
  </form>;
}

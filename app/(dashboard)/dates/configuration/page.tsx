"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesRuntimeSettingsHelp from "@/components/DatesRuntimeSettingsHelp";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  configurationInputValue,
  datesConfigurationRawValue,
  createAdminIdempotencyKey,
  DATES_REPORT_SCOPES,
  datesAdminPrincipal,
  datesActivityTypeRetired,
  datesReasonEntryPoints,
  datesReasonEntryPointsRefused,
  datesReportEntryPointsFor,
  DATES_AI_MODEL_SETTING_KEYS,
  datesModelIdValid,
  datesRuntimeSettingVisible,
  datesSettingEditable,
  datesSettingEffectiveText,
  datesStringListFromInput,
  datesStringListProblem,
  datesSettingStorefrontEffective,
  hasDatesCapability,
  humanizeMachineKey,
  type DatesAdminPrincipal,
} from "@/lib/datesAdmin";
import {
  DATES_LIVE_TRAIL_RETENTION_KEY,
  datesLiveRetentionUnset,
} from "@/lib/datesRuntimeHelp";
import { formatDate } from "@/lib/format";
import { projectDatesAdminReasons, datesReasonSaveReceipt, type DatesReasonDisplayRow as Reason, type DatesReasonUnreadableRow } from "@/lib/datesReasons";

type Setting = {
  key: string;
  type: string;
  value: unknown;
  effective_value: unknown;
  /** AYI-074: per-storefront answers of a rollout switch; absent on an older Core. */
  effective_by_storefront?: unknown;
  default_value: unknown;
  minimum: number | null;
  maximum: number | null;
  allowed_values: string[] | null;
  system_owned: boolean;
  deletable: false;
  valid: boolean;
  revision: number;
  updated_at: number | null;
};

type ActivityType = {
  key: string;
  name_en: string;
  name_hu: string;
  order: number;
  active: boolean;
  revision: number;
  system_owned: boolean;
  deletable: false;
  updated_at: number | null;
};

type Feedback = { tone: "success" | "error"; text: string };

export default function DatesConfigurationPage() {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [unreadableReasons, setUnreadableReasons] = useState<DatesReasonUnreadableRow[]>([]);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [scope, setScope] = useState("all");
  const [limitation, setLimitation] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [runtimeHelpOpen, setRuntimeHelpOpen] = useState(false);

  const load = useCallback(async () => {
    if (settings.length === 0) setState("loading");
    const [configuration, reasonResponse, identity] = await Promise.all([
      adminCall("dates_configuration"),
      adminCall("dates_reason_list", { scope }),
      adminCall("admin_me"),
    ]);
    const nextPrincipal = datesAdminPrincipal(identity);
    const nextReasons = projectDatesAdminReasons(reasonResponse, scope);
    if (!configuration?.success || !Array.isArray(configuration.settings) || !Array.isArray(configuration.activity_types) || !nextReasons || !nextPrincipal) {
      setPrincipal(null);
      setState("error");
      return;
    }
    setSettings((configuration.settings as Setting[]).filter(
      (setting) => datesRuntimeSettingVisible(setting?.key),
    ));
    setActivityTypes(configuration.activity_types as ActivityType[]);
    setReasons(nextReasons.reasons); setUnreadableReasons(nextReasons.unreadable_rows);
    setLimitation(String(configuration.known_limitation || ""));
    setPrincipal(nextPrincipal);
    setState("ready");
  }, [scope, settings.length]);

  useEffect(() => { void load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  function success(message: string) { setFeedback({ tone: "success", text: message }); }
  function failure(error: unknown) { setFeedback({ tone: "error", text: t("operationFailed", { error: String(error || "core-unavailable") }) }); }
  /** An inline refusal replaces the page-level error of an earlier attempt, which would otherwise stay above it. */
  function clearFailure() { setFeedback((current) => current?.tone === "error" ? null : current); }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !principal) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const canManageConfiguration = hasDatesCapability(principal, "dates_configuration_manage");
  const canManageReasons = hasDatesCapability(principal, "dates_reason_manage");

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>} />
      <DatesAdminTabs />
      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}</div>}
      {!canManageConfiguration && <div className="alert alert-info page-alert">{t("readOnly")}</div>}
      {datesLiveRetentionUnset(settings) && <div className="alert alert-warning page-alert" role="status"><strong>{t("liveRetentionUnsetTitle")}</strong> {t("liveRetentionUnsetCopy")}</div>}

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("runtimeTitle")}</h2><p>{t("runtimeCopy")}</p></div><div className="row-actions"><button className="button button-secondary button-small dates-help-trigger" type="button" onClick={() => setRuntimeHelpOpen(true)}>{t("runtimeHelp.button")}</button><span className="badge">{t("settingCount", { count: settings.length })}</span></div></div>
        {settings.some((setting) => datesSettingStorefrontEffective(setting).status === "unsupported") && <p className="alert alert-info">{t("effectiveByStorefrontUnsupported")}</p>}
        <div className="dates-setting-list">
          {settings.map((setting) => <SettingEditor key={`${setting.key}-${setting.revision}`} setting={setting} canManage={canManageConfiguration} onSaved={async () => { success(t("settingSaved")); await load(); }} onError={failure} />)}
        </div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("typesTitle")}</h2><p>{t("typesCopy")}</p></div></div>
        <div className="dates-card-list">
          {activityTypes.map((activityType) => <ActivityTypeEditor key={`${activityType.key}-${activityType.revision}`} activityType={activityType} canManage={canManageConfiguration} locale={locale} onSaved={async () => { success(t("typeSaved")); await load(); }} onError={failure} />)}
        </div>
      </section>

      {limitation && <div className="alert alert-info dates-section"><strong>{t("knownLimitation")}</strong> {t("knownLimitationCopy")}</div>}

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("reasonsTitle")}</h2><p>{t("reasonsCopy")}</p></div><label className="field dates-scope-filter"><span>{t("scope")}</span><select value={scope} onChange={(event) => setScope(event.target.value)}>{["all", "user", "activity", "message", "review"].map((value) => <option key={value} value={value}>{value === "all" ? common("all") : t(`scopes.${value}`)}</option>)}</select></label></div>
        <div className="dates-card-list">
          {canManageReasons && <ReasonEditor reason={null} defaultScope={scope === "all" ? "activity" : scope} onSaved={async () => { success(t("reasonCreated")); await load(); }} onError={failure} onInlineError={clearFailure} />}
          {unreadableReasons.map((reason) => <div className="alert alert-error" key={`unreadable-${reason.index}`}>{common("unreadableField")} · {reason.reason_id ?? `#${reason.index + 1}`}</div>)}
          {reasons.map((reason) => <div key={`${reason.reason_id}-${reason.revision}`}>
            {reason.unreadable_fields?.length ? <p role="status">{common("unreadableField")} · {reason.unreadable_fields.join(", ")}</p> : null}
            <ReasonEditor reason={reason} defaultScope={reason.scope} canManage={canManageReasons && !reason.unreadable_fields?.length} onSaved={async () => { success(t("reasonSaved")); await load(); }} onError={failure} onInlineError={clearFailure} />
          </div>)}
        </div>
      </section>
      {runtimeHelpOpen && <DatesRuntimeSettingsHelp settings={settings} onClose={() => setRuntimeHelpOpen(false)} />}
    </>
  );
}

function SettingEditor({ setting, canManage, onSaved, onError }: { setting: Setting; canManage: boolean; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const [value, setValue] = useState(datesConfigurationRawValue(setting.type, setting.value));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const providers = useTranslations("datesAdmin.intake.providerValues");
  const itemLabel = (item: string) => providers.has(item) ? providers(item) : humanizeMachineKey(item);
  // A row type this console does not know is shown as Core sent it and cannot be saved from here.
  const editable = datesSettingEditable(setting.type);
  const items = setting.type === "string_list" ? datesStringListFromInput(value) : [];
  const ordered = setting.type === "string_list" && Array.isArray(setting.allowed_values) ? setting.allowed_values : null;

  function change(next: string) { setValue(next); setProblem(""); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editable || reason.trim().length < 3 || busy) return;
    // The console's own check only spares a round trip; Core validates every value again.
    if (setting.type === "string" && (DATES_AI_MODEL_SETTING_KEYS as readonly string[]).includes(setting.key) && !datesModelIdValid(value.trim())) {
      setProblem(t("modelIdInvalid")); return;
    }
    const listProblem = setting.type === "string_list" ? datesStringListProblem(setting, items) : null;
    if (listProblem) { setProblem(t(`stringListProblems.${listProblem}`, { minimum: setting.minimum ?? 0, maximum: setting.maximum ?? 0 })); return; }
    setProblem("");
    setBusy(true);
    const response = await adminCall("dates_configuration_save", {
      key: setting.key,
      value: configurationInputValue(setting.type, value, setting.key),
      expected_revision: setting.revision,
      reason: reason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-configuration-save"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
    await onSaved();
  }

  const quiet = setting.type === "quiet_hours" ? value.split("|") : null;
  const booleans = { on: common("enabled"), off: common("disabled") };
  const storefronts = datesSettingStorefrontEffective(setting);
  return <form className="dates-setting-row" onSubmit={save}>
    <div className="dates-setting-copy"><strong>{humanizeMachineKey(setting.key)}</strong><small>{t("revision", { revision: setting.revision })} · {t("effective", { value: datesSettingEffectiveText(setting.type, setting.effective_value, booleans) })}</small>{storefronts.status === "ready" && storefronts.rows.length > 0 && <small>{t("effectiveByStorefront", { values: storefronts.rows.map((row) => `${row.storefront}: ${row.effective ? booleans.on : booleans.off}`).join(" · ") })}</small>}{storefronts.status === "invalid" && <span className="dates-danger-text">{t("effectiveByStorefrontInvalid")}</span>}{!setting.valid && <span className="dates-danger-text">{t("invalidStoredValue")}</span>}</div>
    <div className="dates-setting-control">
      {setting.type === "boolean" ? <select value={value} disabled={!canManage || busy} onChange={(event) => setValue(event.target.value)}><option value="true">{common("enabled")}</option><option value="false">{common("disabled")}</option></select>
        : setting.type === "enum" ? <select value={value} disabled={!canManage || busy} onChange={(event) => setValue(event.target.value)}>{(setting.allowed_values || []).map((item) => <option key={item} value={item}>{humanizeMachineKey(item)}</option>)}</select>
          : setting.type === "storefront_overrides" ? <label className="field"><span>{t("storefrontOverridesLabel")}</span><textarea value={value} maxLength={16000} rows={4} spellCheck={false} disabled={!canManage || busy} onChange={(event) => setValue(event.target.value)} /><small>{t("storefrontOverridesHelp")}</small></label>
            : quiet ? <div className="dates-quiet-hours"><input type="time" value={quiet[0] || ""} disabled={!canManage || busy} onChange={(event) => setValue(`${event.target.value}|${quiet[1] || ""}`)} /><span>→</span><input type="time" value={quiet[1] || ""} disabled={!canManage || busy} onChange={(event) => setValue(`${quiet[0] || ""}|${event.target.value}`)} /></div>
            : !editable ? <label className="field"><span>{t("unknownTypeLabel", { type: setting.type })}</span><code className="dates-external-payload">{datesConfigurationRawValue(setting.type, setting.value) || "—"}</code><small>{t("unknownTypeHelp")}</small></label>
            : setting.type === "string" ? <label className="field"><span>{t("stringLabel")}</span><input type="text" value={value} maxLength={253} spellCheck={false} autoCapitalize="none" autoCorrect="off" disabled={!canManage || busy} onChange={(event) => change(event.target.value)} /><small>{t((DATES_AI_MODEL_SETTING_KEYS as readonly string[]).includes(setting.key) ? "modelIdHelp" : "stringHelp")}</small></label>
            : ordered ? <div className="field"><span>{t("orderedListLabel")}</span><ol className="dates-ordered-list">{items.map((item, index) => <li key={item}>
                <span>{itemLabel(item)}</span>
                <span className="row-actions">
                  <button type="button" className="button button-secondary button-small" disabled={!canManage || busy || index === 0} aria-label={t("orderedListUp", { item: itemLabel(item) })} onClick={() => change(items.map((entry, position) => position === index - 1 ? item : position === index ? items[index - 1] : entry).join("\n"))}>↑</button>
                  <button type="button" className="button button-secondary button-small" disabled={!canManage || busy || index === items.length - 1} aria-label={t("orderedListDown", { item: itemLabel(item) })} onClick={() => change(items.map((entry, position) => position === index + 1 ? item : position === index ? items[index + 1] : entry).join("\n"))}>↓</button>
                  <button type="button" className="button button-secondary button-small" disabled={!canManage || busy} aria-label={t("orderedListRemove", { item: itemLabel(item) })} onClick={() => change(items.filter((entry) => entry !== item).join("\n"))}>×</button>
                </span></li>)}</ol>
                {ordered.filter((item) => !items.includes(item)).map((item) => <button key={item} type="button" className="button button-secondary button-small" disabled={!canManage || busy} onClick={() => change([...items, item].join("\n"))}>{t("orderedListAdd", { item: itemLabel(item) })}</button>)}
                <small>{t("orderedListHelp")}</small></div>
            : setting.type === "string_list" ? <label className="field"><span>{t("stringListLabel")}</span><textarea value={value} rows={Math.min(12, Math.max(4, items.length + 1))} maxLength={16000} spellCheck={false} autoCapitalize="none" disabled={!canManage || busy} onChange={(event) => change(event.target.value)} /><small>{t(setting.key === "dates_event_ticket_domains" ? "ticketDomainsHelp" : "stringListHelp")}</small></label>
            : <input type="number" min={setting.minimum ?? undefined} max={setting.maximum ?? undefined} value={value} disabled={!canManage || busy} placeholder={setting.key === DATES_LIVE_TRAIL_RETENTION_KEY ? t("liveRetentionPlaceholder") : setting.type === "nullable_integer" ? t("noLimit") : undefined} onChange={(event) => setValue(event.target.value)} />}
      {problem && <small className="field-error" role="alert">{problem}</small>}
    </div>
    {canManage && editable && <><label className="field"><span>{t("auditReason")}</span><input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="button button-primary button-small" disabled={busy} type="submit">{busy ? common("saving") : common("save")}</button></>}
  </form>;
}

function ActivityTypeEditor({ activityType, canManage, locale, onSaved, onError }: { activityType: ActivityType; canManage: boolean; locale: string; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const retired = datesActivityTypeRetired(activityType.key);
  const [nameEn, setNameEn] = useState(retired ? t("retiredNameEn") : activityType.name_en);
  const [nameHu, setNameHu] = useState(retired ? t("retiredNameHu") : activityType.name_hu);
  const [order, setOrder] = useState(String(activityType.order));
  const [active, setActive] = useState(!retired && activityType.active);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3 || busy) return;
    setBusy(true);
    const response = await adminCall("dates_activity_type_save", {
      key: activityType.key,
      name_en: nameEn.trim(), name_hu: nameHu.trim(), order: Number(order), active: !retired && active,
      expected_revision: activityType.revision,
      reason: reason.trim(), idempotency_key: createAdminIdempotencyKey("dates-activity-type-save"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
    await onSaved();
  }

  return <form className="dates-config-card" onSubmit={save}>
    <div className="dates-config-card-heading"><div><strong>{retired ? t("retiredType") : activityType.key}</strong><small>{t("revision", { revision: activityType.revision })}{activityType.updated_at ? ` · ${formatDate(activityType.updated_at, locale, true)}` : ""}</small></div><span className={`badge ${active ? "badge-active" : "badge-inactive"}`}>{retired ? t("retiredBadge") : active ? common("active") : common("inactive")}</span></div>
    {retired && <p>{t("retiredTypeCopy")}</p>}
    {retired && activityType.active && <p className="alert alert-warning">{t("retirementPending")}</p>}
    <div className="form-grid"><label className="field"><span>{t("nameEn")}</span><input required maxLength={80} disabled={!canManage || busy || retired} value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label><label className="field"><span>{t("nameHu")}</span><input required maxLength={80} disabled={!canManage || busy || retired} value={nameHu} onChange={(event) => setNameHu(event.target.value)} /></label><label className="field"><span>{t("order")}</span><input type="number" min={0} max={100000} disabled={!canManage || busy} value={order} onChange={(event) => setOrder(event.target.value)} /></label><label className="checkbox-field"><input type="checkbox" disabled={!canManage || busy || retired} checked={active} onChange={(event) => setActive(event.target.checked)} /><span>{t("activeType")}</span></label>{canManage && <label className="field field-full"><span>{t("auditReason")}</span><input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}</div>
    {canManage && <button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? common("saving") : common("save")}</button>}
  </form>;
}

function ReasonEditor({ reason, defaultScope, canManage = true, onSaved, onError, onInlineError }: { reason: Reason | null; defaultScope: string; canManage?: boolean; onSaved: () => Promise<void>; onError: (error: unknown) => void; onInlineError: () => void }) {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const isNew = reason === null;
  const [expanded, setExpanded] = useState(isNew ? false : false);
  const [scope, setScope] = useState(reason?.scope || defaultScope);
  const [keyName, setKeyName] = useState(reason?.key || "");
  const [nameEn, setNameEn] = useState(reason?.name_en || "");
  const [nameHu, setNameHu] = useState(reason?.name_hu || "");
  const [explanationEn, setExplanationEn] = useState(reason?.explanation_en || "");
  const [explanationHu, setExplanationHu] = useState(reason?.explanation_hu || "");
  const [severity, setSeverity] = useState(reason?.severity || "medium");
  const [order, setOrder] = useState(String(reason?.order ?? 100));
  const [active, setActive] = useState(reason?.active ?? true);
  const [commentRequired, setCommentRequired] = useState(reason?.comment_required ?? false);
  const [entryPoints, setEntryPoints] = useState((reason?.entry_points || []).join(", "));
  const [entryPointsError, setEntryPointsError] = useState<string | null>(null);
  const [escalationCategory, setEscalationCategory] = useState(reason?.escalation_category || "");
  const [auditReason, setAuditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const allowedEntryPoints = datesReportEntryPointsFor(scope, reason?.entry_points).join(", ");

  function showEntryPointsError(message: string) {
    setEntryPointsError(message);
    onInlineError();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || reason?.unreadable_fields?.length || auditReason.trim().length < 3 || busy) return;
    const parsedEntryPoints = datesReasonEntryPoints(scope, entryPoints, reason?.entry_points);
    if (!parsedEntryPoints.ok) {
      showEntryPointsError(parsedEntryPoints.error === "empty"
        ? t("entryPointsEmpty")
        : parsedEntryPoints.error === "mixedExternal" ? t("entryPointsMixedExternal")
        : parsedEntryPoints.error === "cohort" ? t("entryPointsCohort")
        : t("entryPointsUnknown", { values: parsedEntryPoints.tokens.join(", "), allowed: allowedEntryPoints }));
      return;
    }
    setEntryPointsError(null);
    setBusy(true);
    const submitted = {
      reason_id: reason?.reason_id || "", scope, key: keyName.trim().toLowerCase(),
      name_en: nameEn.trim(), name_hu: nameHu.trim(),
      explanation_en: explanationEn.trim() || null, explanation_hu: explanationHu.trim() || null,
      severity, order: Number(order), active, comment_required: commentRequired,
      entry_points: parsedEntryPoints.entryPoints, escalation_category: escalationCategory.trim() || null,
      ...(reason ? { expected_revision: reason.revision } : {}),
      reason: auditReason.trim(), idempotency_key: createAdminIdempotencyKey("dates-reason-save"),
    };
    const response = await adminCall("dates_reason_save", submitted);
    setBusy(false);
    if (!response?.success) {
      if (datesReasonEntryPointsRefused(response?.error)) {
        showEntryPointsError(t("entryPointsRefused", { allowed: allowedEntryPoints }));
        return;
      }
      onError(response?.error);
      return;
    }
    if (!datesReasonSaveReceipt(response, submitted)) { onError("dates-reason-contract-invalid"); return; }
    await onSaved();
  }

  async function deactivate() {
    if (!reason || auditReason.trim().length < 3 || busy) return;
    setBusy(true);
    const response = await adminCall("dates_reason_deactivate", {
      reason_id: reason.reason_id, expected_revision: reason.revision,
      reason: auditReason.trim(), idempotency_key: createAdminIdempotencyKey("dates-reason-deactivate"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
    await onSaved();
  }

  return <article className={`dates-config-card ${isNew ? "dates-new-reason" : ""}`}>
    <button className="dates-config-card-heading dates-card-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <div><strong>{isNew ? t("newReason") : `${reason.reason_id} · ${localeLabel(reason)}`}</strong><small>{isNew ? t("newReasonCopy") : `${t(`scopes.${reason.scope}`)} · ${humanizeMachineKey(reason.severity)} · ${t("revision", { revision: reason.revision })}`}</small></div><span className={`badge ${reason?.active || isNew ? "badge-active" : "badge-inactive"}`}>{expanded ? t("collapse") : (isNew ? common("create") : common("edit"))}</span>
    </button>
    {expanded && <form className="dates-reason-form" onSubmit={save}>
      <div className="form-grid"><label className="field"><span>{t("scope")}</span><select value={scope} disabled={!isNew || !canManage || busy} onChange={(event) => { setScope(event.target.value); setEntryPointsError(null); }}>{DATES_REPORT_SCOPES.map((value) => <option key={value} value={value}>{t(`scopes.${value}`)}</option>)}</select></label><label className="field"><span>{t("reasonKey")}</span><input required pattern="[a-z][a-z0-9_]{1,63}" disabled={!isNew || !canManage || busy} value={keyName} onChange={(event) => setKeyName(event.target.value.toLowerCase())} /></label><label className="field"><span>{t("nameEn")}</span><input required maxLength={120} disabled={!canManage || busy} value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label><label className="field"><span>{t("nameHu")}</span><input required maxLength={120} disabled={!canManage || busy} value={nameHu} onChange={(event) => setNameHu(event.target.value)} /></label><label className="field"><span>{t("explanationEn")}</span><textarea maxLength={500} disabled={!canManage || busy} value={explanationEn} onChange={(event) => setExplanationEn(event.target.value)} /></label><label className="field"><span>{t("explanationHu")}</span><textarea maxLength={500} disabled={!canManage || busy} value={explanationHu} onChange={(event) => setExplanationHu(event.target.value)} /></label><label className="field"><span>{t("severity")}</span><select value={severity} disabled={!canManage || busy} onChange={(event) => setSeverity(event.target.value)}>{["low", "medium", "high", "critical"].map((value) => <option key={value} value={value}>{humanizeMachineKey(value)}</option>)}</select></label><label className="field"><span>{t("order")}</span><input type="number" min={0} max={100000} value={order} disabled={!canManage || busy} onChange={(event) => setOrder(event.target.value)} /></label><label className="field field-full"><span>{t("entryPoints")}</span><input value={entryPoints} disabled={!canManage || busy} aria-invalid={entryPointsError ? true : undefined} onChange={(event) => { setEntryPoints(event.target.value); setEntryPointsError(null); }} placeholder={allowedEntryPoints} /><small className="field-hint">{t("entryPointsHint", { values: allowedEntryPoints })}</small>{entryPointsError && <small className="field-error" role="alert">{entryPointsError}</small>}</label><label className="field"><span>{t("escalationCategory")}</span><input value={escalationCategory} disabled={!canManage || busy} onChange={(event) => setEscalationCategory(event.target.value)} /></label><div className="dates-checkbox-stack"><label className="checkbox-field"><input type="checkbox" checked={active} disabled={!canManage || busy || (!isNew && reason?.active === true)} onChange={(event) => setActive(event.target.checked)} /><span>{t("activeReason")}</span></label><label className="checkbox-field"><input type="checkbox" checked={commentRequired} disabled={!canManage || busy} onChange={(event) => setCommentRequired(event.target.checked)} /><span>{t("commentRequired")}</span></label></div>{canManage && <label className="field field-full"><span>{t("auditReason")}</span><textarea required value={auditReason} onChange={(event) => setAuditReason(event.target.value)} /></label>}</div>
      {canManage && <div className="row-actions"><button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? common("saving") : common("save")}</button>{reason?.active && <button className="button button-danger button-small" type="button" onClick={() => void deactivate()} disabled={busy}>{t("deactivate")}</button>}</div>}
    </form>}
  </article>;
}

function localeLabel(reason: Reason): string {
  return reason.name_en || reason.name_hu || reason.key;
}

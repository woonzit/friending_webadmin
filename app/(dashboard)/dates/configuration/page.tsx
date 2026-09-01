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
  createAdminIdempotencyKey,
  datesRuntimeSettingVisible,
  hasDatesCapability,
  humanizeMachineKey,
  normalizeDatesPrincipal,
  parseEntryPoints,
  type DatesAdminPrincipal,
} from "@/lib/datesAdmin";
import { formatDate } from "@/lib/format";

type Setting = {
  key: string;
  type: string;
  value: unknown;
  effective_value: unknown;
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

type Reason = {
  reason_id: string;
  scope: string;
  key: string;
  name_en: string;
  name_hu: string;
  explanation_en: string | null;
  explanation_hu: string | null;
  active: boolean;
  order: number;
  severity: string;
  comment_required: boolean;
  entry_points: string[];
  escalation_category: string | null;
  system_owned: boolean;
  catalog_version: number;
  revision: number;
  updated_at: number;
};

type Feedback = { tone: "success" | "error"; text: string };

function settingRawValue(setting: Setting): string {
  if (setting.type === "quiet_hours" && setting.value && typeof setting.value === "object") {
    const row = setting.value as Record<string, unknown>;
    return `${String(row.start || "22:00")}|${String(row.end || "08:00")}`;
  }
  if (setting.value === null || setting.value === undefined) return "";
  return String(setting.value);
}

export default function DatesConfigurationPage() {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
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
    if (!configuration?.success || !Array.isArray(configuration.settings) || !Array.isArray(configuration.activity_types) || !reasonResponse?.success || !Array.isArray(reasonResponse.reasons)) {
      setState("error");
      return;
    }
    setSettings((configuration.settings as Setting[]).filter(
      (setting) => datesRuntimeSettingVisible(setting?.key),
    ));
    setActivityTypes(configuration.activity_types as ActivityType[]);
    setReasons(reasonResponse.reasons as Reason[]);
    setLimitation(String(configuration.known_limitation || ""));
    setPrincipal(normalizeDatesPrincipal(identity?.dates));
    setState("ready");
  }, [scope, settings.length]);

  useEffect(() => { void load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  function success(message: string) { setFeedback({ tone: "success", text: message }); }
  function failure(error: unknown) { setFeedback({ tone: "error", text: t("operationFailed", { error: String(error || "core-unavailable") }) }); }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error") return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const canManageConfiguration = hasDatesCapability(principal, "dates_configuration_manage");
  const canManageReasons = hasDatesCapability(principal, "dates_reason_manage");

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>} />
      <DatesAdminTabs />
      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}</div>}
      {!canManageConfiguration && <div className="alert alert-info page-alert">{t("readOnly")}</div>}

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("runtimeTitle")}</h2><p>{t("runtimeCopy")}</p></div><div className="row-actions"><button className="button button-secondary button-small dates-help-trigger" type="button" onClick={() => setRuntimeHelpOpen(true)}>{t("runtimeHelp.button")}</button><span className="badge">{t("settingCount", { count: settings.length })}</span></div></div>
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
          {canManageReasons && <ReasonEditor reason={null} defaultScope={scope === "all" ? "activity" : scope} onSaved={async () => { success(t("reasonCreated")); await load(); }} onError={failure} />}
          {reasons.map((reason) => <ReasonEditor key={`${reason.reason_id}-${reason.revision}`} reason={reason} defaultScope={reason.scope} canManage={canManageReasons} onSaved={async () => { success(t("reasonSaved")); await load(); }} onError={failure} />)}
        </div>
      </section>
      {runtimeHelpOpen && <DatesRuntimeSettingsHelp settings={settings} onClose={() => setRuntimeHelpOpen(false)} />}
    </>
  );
}

function SettingEditor({ setting, canManage, onSaved, onError }: { setting: Setting; canManage: boolean; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const [value, setValue] = useState(settingRawValue(setting));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3 || busy) return;
    setBusy(true);
    const response = await adminCall("dates_configuration_save", {
      key: setting.key,
      value: configurationInputValue(setting.type, value),
      expected_revision: setting.revision,
      reason: reason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-configuration-save"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
    await onSaved();
  }

  const quiet = setting.type === "quiet_hours" ? value.split("|") : null;
  return <form className="dates-setting-row" onSubmit={save}>
    <div className="dates-setting-copy"><strong>{humanizeMachineKey(setting.key)}</strong><small>{t("revision", { revision: setting.revision })} · {t("effective", { value: setting.type === "quiet_hours" ? value.replace("|", "–") : String(setting.effective_value ?? "null") })}</small>{!setting.valid && <span className="dates-danger-text">{t("invalidStoredValue")}</span>}</div>
    <div className="dates-setting-control">
      {setting.type === "boolean" ? <select value={value} disabled={!canManage || busy} onChange={(event) => setValue(event.target.value)}><option value="true">{common("enabled")}</option><option value="false">{common("disabled")}</option></select>
        : setting.type === "enum" ? <select value={value} disabled={!canManage || busy} onChange={(event) => setValue(event.target.value)}>{(setting.allowed_values || []).map((item) => <option key={item} value={item}>{humanizeMachineKey(item)}</option>)}</select>
          : quiet ? <div className="dates-quiet-hours"><input type="time" value={quiet[0] || ""} disabled={!canManage || busy} onChange={(event) => setValue(`${event.target.value}|${quiet[1] || ""}`)} /><span>→</span><input type="time" value={quiet[1] || ""} disabled={!canManage || busy} onChange={(event) => setValue(`${quiet[0] || ""}|${event.target.value}`)} /></div>
            : <input type="number" min={setting.minimum ?? undefined} max={setting.maximum ?? undefined} value={value} disabled={!canManage || busy} placeholder={setting.type === "nullable_integer" ? t("noLimit") : undefined} onChange={(event) => setValue(event.target.value)} />}
    </div>
    {canManage && <><label className="field"><span>{t("auditReason")}</span><input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="button button-primary button-small" disabled={busy} type="submit">{busy ? common("saving") : common("save")}</button></>}
  </form>;
}

function ActivityTypeEditor({ activityType, canManage, locale, onSaved, onError }: { activityType: ActivityType; canManage: boolean; locale: string; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
  const t = useTranslations("datesAdmin.configuration");
  const common = useTranslations("common");
  const [nameEn, setNameEn] = useState(activityType.name_en);
  const [nameHu, setNameHu] = useState(activityType.name_hu);
  const [order, setOrder] = useState(String(activityType.order));
  const [active, setActive] = useState(activityType.active);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3 || busy) return;
    setBusy(true);
    const response = await adminCall("dates_activity_type_save", {
      key: activityType.key,
      name_en: nameEn.trim(), name_hu: nameHu.trim(), order: Number(order), active,
      expected_revision: activityType.revision,
      reason: reason.trim(), idempotency_key: createAdminIdempotencyKey("dates-activity-type-save"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
    await onSaved();
  }

  return <form className="dates-config-card" onSubmit={save}>
    <div className="dates-config-card-heading"><div><strong>{activityType.key}</strong><small>{t("revision", { revision: activityType.revision })}{activityType.updated_at ? ` · ${formatDate(activityType.updated_at, locale, true)}` : ""}</small></div><span className={`badge ${active ? "badge-active" : "badge-inactive"}`}>{active ? common("active") : common("inactive")}</span></div>
    <div className="form-grid"><label className="field"><span>{t("nameEn")}</span><input required maxLength={80} disabled={!canManage || busy} value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label><label className="field"><span>{t("nameHu")}</span><input required maxLength={80} disabled={!canManage || busy} value={nameHu} onChange={(event) => setNameHu(event.target.value)} /></label><label className="field"><span>{t("order")}</span><input type="number" min={0} max={100000} disabled={!canManage || busy} value={order} onChange={(event) => setOrder(event.target.value)} /></label><label className="checkbox-field"><input type="checkbox" disabled={!canManage || busy} checked={active} onChange={(event) => setActive(event.target.checked)} /><span>{t("activeType")}</span></label>{canManage && <label className="field field-full"><span>{t("auditReason")}</span><input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}</div>
    {canManage && <button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? common("saving") : common("save")}</button>}
  </form>;
}

function ReasonEditor({ reason, defaultScope, canManage = true, onSaved, onError }: { reason: Reason | null; defaultScope: string; canManage?: boolean; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
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
  const [escalationCategory, setEscalationCategory] = useState(reason?.escalation_category || "");
  const [auditReason, setAuditReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (auditReason.trim().length < 3 || busy) return;
    setBusy(true);
    const response = await adminCall("dates_reason_save", {
      reason_id: reason?.reason_id || "", scope, key: keyName.trim().toLowerCase(),
      name_en: nameEn.trim(), name_hu: nameHu.trim(),
      explanation_en: explanationEn.trim() || null, explanation_hu: explanationHu.trim() || null,
      severity, order: Number(order), active, comment_required: commentRequired,
      entry_points: parseEntryPoints(entryPoints), escalation_category: escalationCategory.trim() || null,
      ...(reason ? { expected_revision: reason.revision } : {}),
      reason: auditReason.trim(), idempotency_key: createAdminIdempotencyKey("dates-reason-save"),
    });
    setBusy(false);
    if (!response?.success) { onError(response?.error); return; }
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
      <div className="form-grid"><label className="field"><span>{t("scope")}</span><select value={scope} disabled={!isNew || !canManage || busy} onChange={(event) => setScope(event.target.value)}>{["user", "activity", "message", "review"].map((value) => <option key={value} value={value}>{t(`scopes.${value}`)}</option>)}</select></label><label className="field"><span>{t("reasonKey")}</span><input required pattern="[a-z][a-z0-9_]{1,63}" disabled={!isNew || !canManage || busy} value={keyName} onChange={(event) => setKeyName(event.target.value.toLowerCase())} /></label><label className="field"><span>{t("nameEn")}</span><input required maxLength={120} disabled={!canManage || busy} value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></label><label className="field"><span>{t("nameHu")}</span><input required maxLength={120} disabled={!canManage || busy} value={nameHu} onChange={(event) => setNameHu(event.target.value)} /></label><label className="field"><span>{t("explanationEn")}</span><textarea maxLength={500} disabled={!canManage || busy} value={explanationEn} onChange={(event) => setExplanationEn(event.target.value)} /></label><label className="field"><span>{t("explanationHu")}</span><textarea maxLength={500} disabled={!canManage || busy} value={explanationHu} onChange={(event) => setExplanationHu(event.target.value)} /></label><label className="field"><span>{t("severity")}</span><select value={severity} disabled={!canManage || busy} onChange={(event) => setSeverity(event.target.value)}>{["low", "medium", "high", "critical"].map((value) => <option key={value} value={value}>{humanizeMachineKey(value)}</option>)}</select></label><label className="field"><span>{t("order")}</span><input type="number" min={0} max={100000} value={order} disabled={!canManage || busy} onChange={(event) => setOrder(event.target.value)} /></label><label className="field field-full"><span>{t("entryPoints")}</span><input value={entryPoints} disabled={!canManage || busy} onChange={(event) => setEntryPoints(event.target.value)} placeholder={t("entryPointsPlaceholder")} /></label><label className="field"><span>{t("escalationCategory")}</span><input value={escalationCategory} disabled={!canManage || busy} onChange={(event) => setEscalationCategory(event.target.value)} /></label><div className="dates-checkbox-stack"><label className="checkbox-field"><input type="checkbox" checked={active} disabled={!canManage || busy || (!isNew && reason?.active === true)} onChange={(event) => setActive(event.target.checked)} /><span>{t("activeReason")}</span></label><label className="checkbox-field"><input type="checkbox" checked={commentRequired} disabled={!canManage || busy} onChange={(event) => setCommentRequired(event.target.checked)} /><span>{t("commentRequired")}</span></label></div>{canManage && <label className="field field-full"><span>{t("auditReason")}</span><textarea required value={auditReason} onChange={(event) => setAuditReason(event.target.value)} /></label>}</div>
      {canManage && <div className="row-actions"><button className="button button-primary button-small" type="submit" disabled={busy}>{busy ? common("saving") : common("save")}</button>{reason?.active && <button className="button button-danger button-small" type="button" onClick={() => void deactivate()} disabled={busy}>{t("deactivate")}</button>}</div>}
    </form>}
  </article>;
}

function localeLabel(reason: Reason): string {
  return reason.name_en || reason.name_hu || reason.key;
}

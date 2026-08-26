"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { operationalRecordSummary } from "@/lib/auditLog";
import {
  createAdminIdempotencyKey,
  epochFromLocalInput,
  hasDatesCapability,
  humanizeMachineKey,
  localInputFromEpoch,
  normalizeDatesPrincipal,
  type DatesAdminPrincipal,
} from "@/lib/datesAdmin";
import { formatDate } from "@/lib/format";

type Activity = {
  activity_id: string;
  title: string;
  details: string | null;
  photo: unknown;
  activity_type: string;
  host: { uid: number; display_name: string };
  lifecycle: string;
  moderation_state: string;
  pending_public_moderation_state: string | null;
  pending_public_revision: Record<string, unknown> | null;
  time_mode: string;
  start_at: number | null;
  end_at: number | null;
  auto_end_at: number | null;
  tbd_expires_at: number | null;
  timezone: string | null;
  location_mode: string;
  city: string | null;
  country_code: string | null;
  audience: Record<string, unknown> | null;
  join_mode: string;
  maximum_people: number | null;
  going_count: number;
  pending_count: number;
  report_count: number;
  live_sharing_state: string;
  soft_deleted: boolean;
  purge_eligible_at: number | null;
  revision: number;
  created_at: number;
  updated_at: number;
};

type CaseRow = { case_id: string; queue: string; status: string; case_kind: string; severity: string; created_at: number };
type Membership = { uid?: number; relationship?: string; live_access?: boolean; updated_at?: number };
type Chat = { thread_id?: string; kind?: string; read_only?: boolean; member_count?: number; message_count?: number; updated_at?: number };
type Report = { report_id?: string; case_id?: string; target_type?: string; status?: string; severity?: string; created_at?: number };
type ActivityDetail = {
  activity: Activity;
  location: { mode?: string; city?: string | null; country_code?: string | null; public_location?: unknown; exact_location_redacted?: boolean };
  memberships: Membership[];
  memberships_truncated?: boolean;
  chats: Chat[];
  reports: Report[];
  notifications: Array<Record<string, unknown>>;
  moderation_cases: CaseRow[];
  moderation_decisions: Array<Record<string, unknown>>;
  audit_history: Array<Record<string, unknown>>;
};

type EditDraft = {
  title: string;
  details: string;
  activityType: string;
  locationMode: string;
  city: string;
  countryCode: string;
  timeMode: string;
  startAt: string;
  endAt: string;
  timezone: string;
  joinMode: string;
  maximumPeople: string;
  audience: string;
  reason: string;
};

type Feedback = { tone: "success" | "error"; text: string };
type PendingCommand = { action: string; reason: string };

function draftFromActivity(activity: Activity): EditDraft {
  return {
    title: activity.title || "",
    details: activity.details || "",
    activityType: activity.activity_type,
    locationMode: activity.location_mode,
    city: activity.city || "",
    countryCode: activity.country_code || "",
    timeMode: activity.time_mode,
    startAt: localInputFromEpoch(activity.start_at),
    endAt: localInputFromEpoch(activity.end_at),
    timezone: activity.timezone || "Europe/Budapest",
    joinMode: activity.join_mode,
    maximumPeople: activity.maximum_people ? String(activity.maximum_people) : "",
    audience: JSON.stringify(activity.audience ?? {}, null, 2),
    reason: "",
  };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function DatesActivityDetailPage() {
  const t = useTranslations("datesAdmin.activityDetail");
  const values = useTranslations("datesAdmin.activities.values");
  const common = useTranslations("common");
  const locale = useLocale();
  const params = useParams<{ activityId: string }>();
  const activityId = useMemo(() => decodeURIComponent(params.activityId || ""), [params.activityId]);
  const [data, setData] = useState<ActivityDetail | null>(null);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [commandAction, setCommandAction] = useState("end");
  const [commandReason, setCommandReason] = useState("");
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [locationCaseId, setLocationCaseId] = useState("");
  const [locationReason, setLocationReason] = useState("");
  const [locationBreakGlass, setLocationBreakGlass] = useState(false);
  const [privateLocation, setPrivateLocation] = useState<Record<string, unknown> | null>(null);
  const [transferUid, setTransferUid] = useState("");
  const [transferReason, setTransferReason] = useState("");

  const load = useCallback(async () => {
    if (!/^act_[A-Za-z0-9_-]+$/.test(activityId)) {
      setState("not-found");
      return;
    }
    if (!data) setState("loading");
    const [response, identity] = await Promise.all([
      adminCall("dates_activity_detail", { activity_id: activityId }),
      adminCall("admin_me"),
    ]);
    if (response?.error === "dates-admin-activity-unavailable") {
      setState("not-found");
      return;
    }
    if (!response?.success || !response.activity) {
      setState("error");
      return;
    }
    const next = response as unknown as ActivityDetail;
    setData(next);
    setDraft(draftFromActivity(next.activity));
    setPrincipal(normalizeDatesPrincipal(identity?.dates));
    setState("ready");
  }, [activityId, data]);

  useEffect(() => { void load(); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveActivity(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !draft || busy) return;
    setFeedback(null);
    let audience: Record<string, unknown>;
    try {
      const parsed = JSON.parse(draft.audience || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      audience = parsed as Record<string, unknown>;
    } catch {
      setFeedback({ tone: "error", text: t("audienceInvalid") });
      return;
    }
    if (draft.reason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("reasonRequired") });
      return;
    }
    const changes: Record<string, unknown> = {
      title: draft.title.trim(),
      details: draft.details.trim() || null,
      activity_type: draft.activityType,
      location_mode: draft.locationMode,
      city: draft.city.trim() || null,
      country_code: draft.countryCode.trim().toUpperCase() || null,
      time_mode: draft.timeMode,
      timezone: draft.timezone.trim(),
      audience,
      join_mode: draft.joinMode,
      maximum_people: draft.joinMode === "auto" ? Number.parseInt(draft.maximumPeople, 10) : null,
    };
    if (draft.timeMode === "scheduled") {
      changes.start_at = epochFromLocalInput(draft.startAt);
      changes.end_at = epochFromLocalInput(draft.endAt);
    }
    setBusy(true);
    const response = await adminCall("dates_activity_update", {
      activity_id: data.activity.activity_id,
      expected_revision: data.activity.revision,
      changes,
      reason: draft.reason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-activity-update"),
    });
    setBusy(false);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return;
    }
    setFeedback({ tone: "success", text: t("saved") });
    await load();
  }

  async function executeCommand() {
    if (!data || !pendingCommand || busy) return;
    setBusy(true);
    const response = await adminCall("dates_activity_command", {
      activity_id: data.activity.activity_id,
      expected_revision: data.activity.revision,
      action: pendingCommand.action,
      reason: pendingCommand.reason,
      idempotency_key: createAdminIdempotencyKey(`dates-activity-${pendingCommand.action}`),
    });
    setBusy(false);
    setPendingCommand(null);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return;
    }
    if (response.purged === true) {
      window.location.assign("/dates");
      return;
    }
    setCommandReason("");
    setFeedback({ tone: "success", text: t("commandDone") });
    await load();
  }

  async function revealLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy || !locationCaseId.trim() || locationReason.trim().length < 3) return;
    setBusy(true);
    const response = await adminCall("dates_activity_location", {
      activity_id: data.activity.activity_id,
      case_id: locationCaseId.trim(),
      reason: locationReason.trim(),
      break_glass: locationBreakGlass,
    });
    setBusy(false);
    if (!response?.success || !response.private_location || typeof response.private_location !== "object") {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return;
    }
    setPrivateLocation(response.private_location as Record<string, unknown>);
    setFeedback({ tone: "success", text: t("locationRevealed") });
  }

  async function requestTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy || !Number.isInteger(Number(transferUid)) || transferReason.trim().length < 3) return;
    setBusy(true);
    const response = await adminCall("dates_activity_host_transfer", {
      activity_id: data.activity.activity_id,
      target_uid: Number(transferUid),
      expected_revision: data.activity.revision,
      reason: transferReason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-host-transfer"),
    });
    setBusy(false);
    if (!response?.success) {
      setFeedback({ tone: "error", text: t("operationFailed", { error: String(response?.error || "core-unavailable") }) });
      return;
    }
    setTransferUid("");
    setTransferReason("");
    setFeedback({ tone: "success", text: t("transferRequested") });
    await load();
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") return <ErrorPanel message={t("notFound")} retry={() => void load()} />;
  if (state === "error" || !data || !draft) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const activity = data.activity;
  const canEdit = hasDatesCapability(principal, "dates_activity_edit");
  const canCommand = hasDatesCapability(principal, "dates_activity_command");
  const canTransfer = hasDatesCapability(principal, "dates_host_transfer");
  const canLocation = principal?.sensitive_location && hasDatesCapability(principal, "dates_evidence_read");

  return (
    <>
      <Link className="back-link" href="/dates">← {t("back")}</Link>
      <PageHeader eyebrow={t("eyebrow")} title={activity.title || activity.activity_id} subtitle={t("subtitle", { id: activity.activity_id, revision: activity.revision })} actions={<button className="button button-secondary" onClick={() => void load()} disabled={busy}>{common("refresh")}</button>} />
      <DatesAdminTabs />
      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}</div>}

      <div className="dates-detail-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("overview")}</h2><p>{t("overviewCopy")}</p></div><div className="row-actions"><span className={`badge ${activity.soft_deleted ? "badge-warning" : "badge-active"}`}>{activity.soft_deleted ? t("softDeleted") : values(activity.lifecycle)}</span><span className={`badge ${activity.moderation_state === "ok" || activity.moderation_state === "approved" ? "badge-active" : "badge-warning"}`}>{values(activity.moderation_state)}</span></div></div>
          <div className="panel-body"><dl className="detail-list">
            <div className="detail-row"><dt>{t("host")}</dt><dd>{activity.host.display_name || "—"} · UID {activity.host.uid}</dd></div>
            <div className="detail-row"><dt>{t("type")}</dt><dd>{values(activity.activity_type)}</dd></div>
            <div className="detail-row"><dt>{t("schedule")}</dt><dd>{values(activity.time_mode)} · {activity.start_at ? formatDate(activity.start_at, locale, true) : "—"} → {activity.end_at ? formatDate(activity.end_at, locale, true) : "—"}</dd></div>
            <div className="detail-row"><dt>{t("location")}</dt><dd>{values(activity.location_mode)} · {[activity.city, activity.country_code].filter(Boolean).join(", ") || "—"}</dd></div>
            <div className="detail-row"><dt>{t("publicLocation")}</dt><dd>{displayValue(data.location.public_location)}</dd></div>
            <div className="detail-row"><dt>{t("photo")}</dt><dd>{displayValue(activity.photo)}</dd></div>
            <div className="detail-row"><dt>{t("attendance")}</dt><dd>{t("attendanceValue", { going: activity.going_count, pending: activity.pending_count, maximum: activity.maximum_people ?? "—" })}</dd></div>
            <div className="detail-row"><dt>{t("liveSharing")}</dt><dd>{humanizeMachineKey(activity.live_sharing_state)}</dd></div>
            <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{formatDate(activity.created_at, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("updated")}</dt><dd>{formatDate(activity.updated_at, locale, true)}</dd></div>
            {activity.purge_eligible_at && <div className="detail-row"><dt>{t("purgeEligible")}</dt><dd>{formatDate(activity.purge_eligible_at, locale, true)}</dd></div>}
            {activity.pending_public_revision && <div className="detail-row"><dt>{t("pendingRevision")}</dt><dd><pre className="dates-inline-json">{JSON.stringify(activity.pending_public_revision, null, 2)}</pre></dd></div>}
          </dl></div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("operationalHistory")}</h2><p>{t("operationalHistoryCopy")}</p></div></div>
          <div className="panel-body dates-count-grid">
            <div><strong>{data.memberships.length}{data.memberships_truncated ? "+" : ""}</strong><span>{t("memberships")}</span></div>
            <div><strong>{data.chats.length}</strong><span>{t("chats")}</span></div>
            <div><strong>{data.reports.length}</strong><span>{t("reports")}</span></div>
            <div><strong>{data.moderation_cases.length}</strong><span>{t("cases")}</span></div>
            <div><strong>{data.moderation_decisions.length}</strong><span>{t("decisions")}</span></div>
            <div><strong>{data.audit_history.length}</strong><span>{t("auditEntries")}</span></div>
          </div>
        </section>
      </div>

      {canEdit && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("editTitle")}</h2><p>{t("editCopy")}</p></div></div>
        <form className="panel-body form-grid" onSubmit={saveActivity}>
          <label className="field field-full"><span>{t("titleLabel")}</span><input required minLength={3} maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="field field-full"><span>{t("detailsLabel")}</span><textarea maxLength={2000} value={draft.details} onChange={(event) => setDraft({ ...draft, details: event.target.value })} /></label>
          <label className="field"><span>{t("type")}</span><select value={draft.activityType} onChange={(event) => setDraft({ ...draft, activityType: event.target.value })}>{["sport", "date", "travel", "hangout"].map((value) => <option key={value} value={value}>{values(value)}</option>)}</select></label>
          <label className="field"><span>{t("locationMode")}</span><select value={draft.locationMode} onChange={(event) => setDraft({ ...draft, locationMode: event.target.value })}>{["live", "exact", "city"].map((value) => <option key={value} value={value}>{values(value)}</option>)}</select></label>
          <label className="field"><span>{t("city")}</span><input maxLength={120} value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
          <label className="field"><span>{t("countryCode")}</span><input maxLength={3} value={draft.countryCode} onChange={(event) => setDraft({ ...draft, countryCode: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>{t("timeMode")}</span><select value={draft.timeMode} onChange={(event) => setDraft({ ...draft, timeMode: event.target.value })}>{["now", "scheduled", "tbd"].map((value) => <option key={value} value={value}>{values(value)}</option>)}</select></label>
          <label className="field"><span>{t("timezone")}</span><input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label>
          {draft.timeMode === "scheduled" && <><label className="field"><span>{t("startAt")}</span><input type="datetime-local" required value={draft.startAt} onChange={(event) => setDraft({ ...draft, startAt: event.target.value })} /></label><label className="field"><span>{t("endAt")}</span><input type="datetime-local" required value={draft.endAt} onChange={(event) => setDraft({ ...draft, endAt: event.target.value })} /></label></>}
          <label className="field"><span>{t("joinMode")}</span><select value={draft.joinMode} onChange={(event) => setDraft({ ...draft, joinMode: event.target.value })}><option value="auto">{values("auto")}</option><option value="approval">{values("approval")}</option></select></label>
          <label className="field"><span>{t("maximumPeople")}</span><input type="number" min={2} disabled={draft.joinMode !== "auto"} required={draft.joinMode === "auto"} value={draft.maximumPeople} onChange={(event) => setDraft({ ...draft, maximumPeople: event.target.value })} /></label>
          <label className="field field-full"><span>{t("audienceJson")}</span><textarea className="code-textarea" value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} /></label>
          <label className="field field-full"><span>{t("adminReason")}</span><textarea required maxLength={1000} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder={t("reasonPlaceholder")} /></label>
          <div className="row-actions field-full"><button className="button button-primary" type="submit" disabled={busy}>{busy ? common("saving") : common("save")}</button></div>
        </form>
      </section>}

      <div className="section-grid dates-section">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("exactLocation")}</h2><p>{t("exactLocationCopy")}</p></div></div>
          <div className="panel-body">
            {!canLocation ? <p className="page-subtitle">{t("locationCapabilityRequired")}</p> : <form className="form-stack" onSubmit={revealLocation}>
              <label className="field"><span>{t("caseId")}</span><input required value={locationCaseId} onChange={(event) => setLocationCaseId(event.target.value)} placeholder="cas_…" /></label>
              <label className="field"><span>{t("adminReason")}</span><textarea required value={locationReason} onChange={(event) => setLocationReason(event.target.value)} /></label>
              {principal?.break_glass && <label className="checkbox-field"><input type="checkbox" checked={locationBreakGlass} onChange={(event) => setLocationBreakGlass(event.target.checked)} /><span>{t("breakGlass")}</span></label>}
              <button className="button button-danger" type="submit" disabled={busy}>{t("revealLocation")}</button>
            </form>}
            {privateLocation && <dl className="detail-list dates-sensitive-result">{Object.entries(privateLocation).filter(([key]) => !["activity_id", "created_at", "updated_at"].includes(key)).map(([key, value]) => <div className="detail-row" key={key}><dt>{humanizeMachineKey(key)}</dt><dd>{displayValue(value)}</dd></div>)}</dl>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("commands")}</h2><p>{t("commandsCopy")}</p></div></div>
          <div className="panel-body">
            {!canCommand ? <p className="page-subtitle">{t("commandCapabilityRequired")}</p> : <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (commandReason.trim().length >= 3) setPendingCommand({ action: commandAction, reason: commandReason.trim() }); }}>
              <label className="field"><span>{t("command")}</span><select value={commandAction} onChange={(event) => setCommandAction(event.target.value)}>{["end", "cancel", "soft_delete", "restore", ...(hasDatesCapability(principal, "dates_activity_purge") ? ["purge"] : [])].map((value) => <option key={value} value={value}>{t(`commandsList.${value}`)}</option>)}</select></label>
              <label className="field"><span>{t("adminReason")}</span><textarea required value={commandReason} onChange={(event) => setCommandReason(event.target.value)} /></label>
              <button className={`button ${["soft_delete", "purge", "cancel"].includes(commandAction) ? "button-danger" : "button-secondary"}`} type="submit" disabled={busy}>{t("prepareCommand")}</button>
            </form>}
          </div>
        </section>
      </div>

      {canTransfer && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("hostTransfer")}</h2><p>{t("hostTransferCopy")}</p></div></div>
        <form className="panel-body dates-inline-form" onSubmit={requestTransfer}>
          <label className="field"><span>{t("targetUid")}</span><input type="number" min={1} required value={transferUid} onChange={(event) => setTransferUid(event.target.value)} /></label>
          <label className="field"><span>{t("adminReason")}</span><input required maxLength={1000} value={transferReason} onChange={(event) => setTransferReason(event.target.value)} /></label>
          <button className="button button-danger" type="submit" disabled={busy}>{t("requestTransfer")}</button>
        </form>
      </section>}

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("moderationCases")}</h2><p>{t("moderationCasesCopy")}</p></div></div>
        <div className="table-wrap dates-embedded-table">{data.moderation_cases.length === 0 ? <div className="empty-state dates-compact-empty"><div><p>{t("noCases")}</p></div></div> : <table className="data-table"><thead><tr><th>{t("caseId")}</th><th>{common("status")}</th><th>{t("severity")}</th><th>{common("createdAt")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead><tbody>{data.moderation_cases.map((item) => <tr key={item.case_id}><td>{item.case_id}</td><td><span className="badge">{humanizeMachineKey(item.status)}</span></td><td>{humanizeMachineKey(item.severity)}</td><td>{formatDate(item.created_at, locale, true)}</td><td><Link className="button button-secondary button-small" href={`/dates/moderation/${encodeURIComponent(item.case_id)}`}>{common("view")}</Link></td></tr>)}</tbody></table>}</div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("membershipsAndChats")}</h2><p>{t("membershipsAndChatsCopy")}</p></div></div>
        <div className="panel-body section-grid">
          <div><h3 className="dates-subheading">{t("memberships")}</h3><div className="dates-scroll-list">{data.memberships.map((item, index) => <div className="dates-list-row" key={`${item.uid || 0}-${index}`}><span>UID {item.uid || 0}</span><span className="badge">{humanizeMachineKey(item.relationship || "unknown")}</span></div>)}</div></div>
          <div><h3 className="dates-subheading">{t("chats")}</h3><div className="dates-scroll-list">{data.chats.map((item, index) => <div className="dates-list-row" key={item.thread_id || index}><span>{item.thread_id || "—"}</span><small>{t("chatSummary", { members: item.member_count || 0, messages: item.message_count || 0 })}</small></div>)}</div></div>
        </div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("boundedHistory")}</h2><p>{t("boundedHistoryCopy")}</p></div></div>
        <div className="panel-body dates-history-sections">
          <OperationalRecords title={t("reports")} empty={t("noHistoryRecords")} records={data.reports as unknown as Array<Record<string, unknown>>} withheldLabel={(count) => t("recordWithheld", { count })} />
          <OperationalRecords title={t("notifications")} empty={t("noHistoryRecords")} records={data.notifications || []} withheldLabel={(count) => t("recordWithheld", { count })} />
          <OperationalRecords title={t("decisions")} empty={t("noHistoryRecords")} records={data.moderation_decisions} withheldLabel={(count) => t("recordWithheld", { count })} />
          <OperationalRecords title={t("auditEntries")} empty={t("noHistoryRecords")} records={data.audit_history} withheldLabel={(count) => t("recordWithheld", { count })} />
        </div>
      </section>

      {pendingCommand && <ConfirmDialog title={t("confirmCommandTitle", { action: t(`commandsList.${pendingCommand.action}`) })} copy={t("confirmCommandCopy", { reason: pendingCommand.reason })} confirmLabel={t("confirmCommand")} busy={busy} onCancel={() => setPendingCommand(null)} onConfirm={() => void executeCommand()} />}
    </>
  );
}

// Core passes `moderation_decisions` and `audit_history` through as whole documents, so rendering
// them raw printed the acting moderator's email and member UID, the free-text reason and the
// before/after blocks to every administrator. Same allow-list treatment as /audit.
function OperationalRecords({ title, empty, records, withheldLabel }: { title: string; empty: string; records: Array<Record<string, unknown>>; withheldLabel: (count: number) => string }) {
  return <details className="dates-history-group"><summary>{title} <span>{records.length}</span></summary>{records.length === 0 ? <p>{empty}</p> : <div className="dates-history-records">{records.map((record, index) => {
    const { shown, withheld } = operationalRecordSummary(record);
    return <div className="audit-details" key={String(record.audit_id || record.decision_id || record.notification_id || record.report_id || index)}>
      {shown.length === 0 && withheld === 0 ? "—" : null}
      {shown.map((entry) => <span className="audit-detail-pair" key={entry.key}><code>{entry.key}</code><span>{entry.value}</span></span>)}
      {withheld > 0 ? <span className="audit-detail-withheld">{withheldLabel(withheld)}</span> : null}
    </div>;
  })}</div>}</details>;
}

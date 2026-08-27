"use client";

// Footprints v1 operations (design §6): global limits, the badge catalogue
// with its two-sided audiences, the per-user daily-limit override, and the
// reported-footprints queue.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import FootprintsVisitsPanel from "@/components/FootprintsVisitsPanel";
import ImageUploadField from "@/components/ImageUploadField";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { FOOTPRINTS_VISITS_CONTRACT_READY } from "@/lib/contractReadiness";
import {
  FOOTPRINT_GENDERS,
  footprintReports,
  footprintsAdminPayload,
  type FootprintBadge,
  type FootprintReport,
  type FootprintsAdminPayload,
} from "@/lib/footprints";

type BadgeDraft = {
  isNew: boolean;
  id: string;
  revision: number;
  labelEn: string;
  labelHu: string;
  imageUrl: string;
  senderCustom: boolean;
  senderGenders: string[];
  senderGroupIds: string[];
  recipientCustom: boolean;
  recipientGenders: string[];
  recipientGroupIds: string[];
  sortOrder: number;
  active: boolean;
};

function draftFrom(badge: FootprintBadge | null): BadgeDraft {
  return {
    isNew: badge === null,
    id: badge?.id ?? "",
    revision: badge?.revision ?? 0,
    labelEn: badge?.labels.en ?? "",
    labelHu: badge?.labels.hu ?? "",
    imageUrl: badge?.imageUrl ?? "",
    senderCustom: (badge?.senderGenders.length ?? 0) > 0 || (badge?.senderGroupIds.length ?? 0) > 0,
    senderGenders: badge?.senderGenders ?? [],
    senderGroupIds: badge?.senderGroupIds ?? [],
    recipientCustom: (badge?.recipientGenders.length ?? 0) > 0 || (badge?.recipientGroupIds.length ?? 0) > 0,
    recipientGenders: badge?.recipientGenders ?? [],
    recipientGroupIds: badge?.recipientGroupIds ?? [],
    sortOrder: badge?.sortOrder ?? 1000,
    active: badge?.active ?? true,
  };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function FootprintsPage() {
  const locale = useLocale();
  const t = useTranslations("footprints");
  const common = useTranslations("common");

  const [payload, setPayload] = useState<FootprintsAdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [dailyLimit, setDailyLimit] = useState("5");
  const [messageMax, setMessageMax] = useState("40");

  const [overrideUid, setOverrideUid] = useState("");
  const [overrideLimit, setOverrideLimit] = useState("");

  const [draft, setDraft] = useState<BadgeDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [badgeError, setBadgeError] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<FootprintBadge | null>(null);

  const [reports, setReports] = useState<FootprintReport[] | null>(null);
  const [reportStatus, setReportStatus] = useState<"open" | "resolved">("open");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsFailed, setReportsFailed] = useState(false);
  const reportRequest = useRef(0);

  const adopt = useCallback((parsed: FootprintsAdminPayload) => {
    setPayload(parsed);
    setDailyLimit(String(parsed.settings.dailyLimit));
    setMessageMax(String(parsed.settings.messageMaxLength));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const response = await adminCall("footprints_admin", {});
    const parsed = response?.success ? footprintsAdminPayload(response) : null;
    setLoading(false);
    if (!parsed) {
      setLoadFailed(true);
      return;
    }
    adopt(parsed);
  }, [adopt]);

  const loadReports = useCallback(async (status: "open" | "resolved") => {
    const requestId = ++reportRequest.current;
    setReportStatus(status);
    setReportsLoading(true);
    setReportsFailed(false);
    const response = await adminCall("footprint_reports", { status });
    if (requestId !== reportRequest.current) return;
    const parsed = response?.success ? footprintReports(response, status) : null;
    setReportsLoading(false);
    setReportsFailed(parsed === null);
    setReports(parsed);
  }, []);

  useEffect(() => {
    void load();
    void loadReports("open");
  }, [load, loadReports]);

  async function saveSettings() {
    if (!payload) return;
    setBusy(true);
    setNotice("");
    const response = await adminCall("save_footprint_settings", {
      daily_limit: Number(dailyLimit),
      message_max_length: Number(messageMax),
      expected_revision: payload.settings.revision,
    });
    setBusy(false);
    const parsed = response?.success ? footprintsAdminPayload(response) : null;
    if (!parsed) {
      setNotice(t("saveError"));
      void load();
      return;
    }
    adopt(parsed);
    setNotice(t("saved"));
  }

  async function saveOverride() {
    const uid = Number(overrideUid);
    if (!Number.isInteger(uid) || uid <= 0) {
      setNotice(t("overrideUidInvalid"));
      return;
    }
    setBusy(true);
    setNotice("");
    const response = await adminCall("set_footprint_user_limit", {
      uid,
      limit: overrideLimit.trim() === "" ? "" : Number(overrideLimit),
    });
    setBusy(false);
    setNotice(response?.success ? t("overrideSaved", { uid }) : t("saveError"));
  }

  async function saveBadge() {
    if (!draft) return;
    const senderInvalid = draft.senderCustom
      && draft.senderGenders.length === 0
      && draft.senderGroupIds.length === 0;
    const recipientInvalid = draft.recipientCustom
      && draft.recipientGenders.length === 0
      && draft.recipientGroupIds.length === 0;
    if (senderInvalid || recipientInvalid) {
      setBadgeError(t("audienceRequired"));
      return;
    }
    setBusy(true);
    setNotice("");
    setBadgeError("");
    const request: Record<string, unknown> = {
      labels_json: JSON.stringify({ en: draft.labelEn.trim(), hu: draft.labelHu.trim() }),
      image_url: draft.imageUrl,
      sender_genders_json: JSON.stringify(draft.senderCustom ? draft.senderGenders : []),
      sender_group_ids_json: JSON.stringify(draft.senderCustom ? draft.senderGroupIds : []),
      recipient_genders_json: JSON.stringify(draft.recipientCustom ? draft.recipientGenders : []),
      recipient_group_ids_json: JSON.stringify(draft.recipientCustom ? draft.recipientGroupIds : []),
      sort_order: draft.sortOrder,
      active: draft.active ? "1" : "0",
    };
    if (!draft.isNew) {
      request.id = draft.id;
      request.expected_revision = draft.revision;
    }
    const response = await adminCall("save_footprint_badge", request);
    setBusy(false);
    const parsed = response?.success ? footprintsAdminPayload(response) : null;
    if (!parsed) {
      const code = typeof response?.error === "string" ? response.error : "";
      const error = code ? t("saveErrorCode", { code }) : t("saveError");
      setBadgeError(error);
      setNotice(error);
      if (code.includes("conflict")) void load();
      return;
    }
    adopt(parsed);
    setDraft(null);
    setNotice(t("saved"));
  }

  async function archiveBadge() {
    if (!archiveTarget) return;
    setBusy(true);
    const response = await adminCall("archive_footprint_badge", {
      id: archiveTarget.id,
      expected_revision: archiveTarget.revision,
    });
    setBusy(false);
    setArchiveTarget(null);
    const parsed = response?.success ? footprintsAdminPayload(response) : null;
    if (parsed) {
      adopt(parsed);
      setNotice(t("archived"));
    } else {
      setNotice(t("saveError"));
      void load();
    }
  }

  async function resolveReport(report: FootprintReport) {
    setBusy(true);
    const response = await adminCall("resolve_footprint_report", { id: report.id });
    setBusy(false);
    if (response?.success) {
      void loadReports(reportStatus);
      void load();
    } else {
      setNotice(t("saveError"));
    }
  }

  const groupLabel = useCallback(
    (id: string) => {
      const group = payload?.castGroups.find((item) => item.id === id);
      if (!group) return id;
      return locale.startsWith("hu") ? group.labels.hu : group.labels.en;
    },
    [locale, payload],
  );

  const audienceSummary = useCallback(
    (genders: string[], groupIds: string[]) => {
      if (genders.length === 0 && groupIds.length === 0) return t("audienceGlobal");
      const parts = [
        ...genders.map((gender) => t(`gender.${gender}`)),
        ...groupIds.map(groupLabel),
      ];
      return parts.join(", ");
    },
    [groupLabel, t],
  );

  if (loading && !payload) return <LoadingPanel />;
  if (loadFailed || !payload) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const draftSenderInvalid = Boolean(
    draft?.senderCustom
    && draft.senderGenders.length === 0
    && draft.senderGroupIds.length === 0,
  );
  const draftRecipientInvalid = Boolean(
    draft?.recipientCustom
    && draft.recipientGenders.length === 0
    && draft.recipientGroupIds.length === 0,
  );

  return (
    <div className="footprints-page">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {notice ? <p className="footprints-notice" role="status">{notice}</p> : null}

      {/*
        T-218: the visits switch is its own contract with its own capability,
        revision and receipt, so it owns its state and never shares this page's
        `payload.settings.revision`. It renders first because it is the widest
        decision on the page — everything below it stays available either way.

        Dormant until the T-123 provider release. The panel has no route or
        navigation entry of its own, so this local switch is its whole reviewed
        activation: while it is false the panel does not render at all and its
        two proxy actions are absent from the allow-list. Core's own
        `contract_ready` plus the exact action capability gate it again at
        runtime once it does render.
      */}
      {FOOTPRINTS_VISITS_CONTRACT_READY ? <FootprintsVisitsPanel /> : null}

      <section className="panel">
        <h2>{t("settingsTitle")}</h2>
        <p className="panel-lead">{t("settingsLead")}</p>
        <div className="footprints-settings-grid">
          <label className="field">
            <span>{t("dailyLimit")}</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("messageMax")}</span>
            <input
              type="number"
              min={1}
              max={500}
              value={messageMax}
              onChange={(event) => setMessageMax(event.target.value)}
            />
          </label>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveSettings()}>
            {common("save")}
          </button>
        </div>
        <div className="footprints-settings-grid footprints-override">
          <label className="field">
            <span>{t("overrideUid")}</span>
            <input
              type="number"
              min={1}
              value={overrideUid}
              onChange={(event) => setOverrideUid(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("overrideLimit")}</span>
            <input
              type="number"
              min={0}
              max={1000}
              placeholder={t("overrideDefault")}
              value={overrideLimit}
              onChange={(event) => setOverrideLimit(event.target.value)}
            />
          </label>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void saveOverride()}>
            {t("overrideSave")}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>{t("badgesTitle")}</h2>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setBadgeError("");
              setDraft(draftFrom(null));
            }}
          >
            {t("newBadge")}
          </button>
        </div>
        {payload.badges.length === 0 ? <p className="panel-lead">{t("noBadges")}</p> : null}
        <div className="footprints-badge-grid">
          {payload.badges.map((badge) => (
            <article
              className={`footprints-badge-card${badge.archived ? " is-archived" : badge.active ? "" : " is-inactive"}`}
              key={badge.id}
            >
              {badge.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={badge.imageUrl} alt="" />
              ) : (
                <span className="footprints-badge-blank" aria-hidden="true" />
              )}
              <div>
                <strong>{badge.labels.en}</strong>
                <small>{badge.labels.hu}</small>
                <p>
                  <b>{t("senderShort")}:</b> {audienceSummary(badge.senderGenders, badge.senderGroupIds)}
                </p>
                <p>
                  <b>{t("recipientShort")}:</b> {audienceSummary(badge.recipientGenders, badge.recipientGroupIds)}
                </p>
                {badge.archived ? <p className="footprints-state">{t("stateArchived")}</p> : null}
                {!badge.archived && !badge.active ? <p className="footprints-state">{t("stateInactive")}</p> : null}
              </div>
              <div className="footprints-badge-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setBadgeError("");
                    setDraft(draftFrom(badge));
                  }}
                >
                  {common("edit")}
                </button>
                {!badge.archived ? (
                  <button type="button" className="text-button is-danger" onClick={() => setArchiveTarget(badge)}>
                    {t("archive")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>{t("reportsTitle", { count: payload.openReports })}</h2>
          <div className="footprints-report-tabs" role="tablist">
            {(["open", "resolved"] as const).map((status) => (
              <button
                type="button"
                role="tab"
                aria-selected={reportStatus === status}
                className={reportStatus === status ? "is-active" : ""}
                key={status}
                onClick={() => void loadReports(status)}
              >
                {t(`reportStatus.${status}`)}
              </button>
            ))}
          </div>
        </div>
        {reportsLoading ? (
          <p className="panel-lead">{common("loading")}</p>
        ) : reportsFailed ? (
          <div className="footprints-report-error" role="alert">
            <p>{t("reportLoadError")}</p>
            <button type="button" className="button button-secondary button-small" onClick={() => void loadReports(reportStatus)}>
              {common("retry")}
            </button>
          </div>
        ) : reports === null ? (
          <p className="panel-lead">{t("reportLoadError")}</p>
        ) : reports.length === 0 ? (
          <p className="panel-lead">{t("noReports")}</p>
        ) : (
          <table className="data-table footprints-report-table">
            <thead>
              <tr>
                <th>{t("reportWhen")}</th>
                <th>{t("reportReporter")}</th>
                <th>{t("reportSender")}</th>
                <th>{t("reportBadge")}</th>
                <th>{t("reportMessage")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.createdAt ? new Date(report.createdAt * 1000).toLocaleString() : "—"}</td>
                  <td>{report.reporter ? `${report.reporter.name} (#${report.reporter.id})` : "—"}</td>
                  <td>{report.sender ? `${report.sender.name} (#${report.sender.id})` : "—"}</td>
                  <td>
                    <span className="footprints-report-badge">
                      {report.badgeImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={report.badgeImage} alt="" />
                      ) : null}
                      {report.badgeLabel || "—"}
                    </span>
                  </td>
                  <td className="footprints-report-message">{report.message || "—"}</td>
                  <td>
                    {report.status === "open" ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={busy}
                        onClick={() => void resolveReport(report)}
                      >
                        {t("resolve")}
                      </button>
                    ) : (
                      <small>{report.resolvedBy}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {draft ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog footprints-badge-dialog" role="dialog" aria-modal="true">
            <div className="dialog-header">
              <div>
                <h2>{draft.isNew ? t("newBadge") : t("editBadge")}</h2>
                <p className="footprints-dialog-lead">{t("audienceIntro")}</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="footprints-rule-preview" aria-label={t("audiencePreviewLabel")}>
              <span>
                <small>{t("senderShort")}</small>
                <strong>{draft.senderCustom
                  ? audienceSummary(draft.senderGenders, draft.senderGroupIds)
                  : t("audienceGlobal")}</strong>
              </span>
              <b aria-hidden="true">→</b>
              <span className="is-badge">
                <small>{t("previewBadge")}</small>
                <strong>{draft.labelEn.trim() || t("newBadge")}</strong>
              </span>
              <b aria-hidden="true">→</b>
              <span>
                <small>{t("recipientShort")}</small>
                <strong>{draft.recipientCustom
                  ? audienceSummary(draft.recipientGenders, draft.recipientGroupIds)
                  : t("audienceGlobal")}</strong>
              </span>
              </div>
              <div className="footprints-dialog-grid">
              <ImageUploadField
                className="field-full"
                label={t("badgeImage")}
                value={draft.imageUrl}
                required
                disabled={busy}
                onBusyChange={setUploading}
                onChange={(imageUrl) => {
                  setBadgeError("");
                  setDraft({ ...draft, imageUrl });
                }}
              />
              <label className="field">
                <span>{t("labelEn")}</span>
                <input
                  value={draft.labelEn}
                  maxLength={80}
                  onChange={(event) => {
                    setBadgeError("");
                    setDraft({ ...draft, labelEn: event.target.value });
                  }}
                />
              </label>
              <label className="field">
                <span>{t("labelHu")}</span>
                <input
                  value={draft.labelHu}
                  maxLength={80}
                  onChange={(event) => {
                    setBadgeError("");
                    setDraft({ ...draft, labelHu: event.target.value });
                  }}
                />
              </label>
              <div className="footprints-audience-grid field-full">
                {(
                  [
                    ["sender", draft.senderCustom, draft.senderGenders, draft.senderGroupIds, draftSenderInvalid] as const,
                    ["recipient", draft.recipientCustom, draft.recipientGenders, draft.recipientGroupIds, draftRecipientInvalid] as const,
                  ]
                ).map(([side, custom, genders, groupIds, invalid], index) => (
                  <fieldset
                    className={`footprints-audience${invalid ? " is-invalid" : ""}`}
                    key={side}
                  >
                    <legend>
                      <span className="footprints-audience-step">{index + 1}</span>
                      <span>
                        <strong>{t(`${side}Audience`)}</strong>
                        <small>{t(`${side}AudienceHelp`)}</small>
                      </span>
                    </legend>
                    <div className="footprints-mode" role="radiogroup" aria-label={t(`${side}Audience`)}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!custom}
                        className={custom ? "" : "is-active"}
                        onClick={() => {
                          setBadgeError("");
                          setDraft(
                            side === "sender"
                              ? { ...draft, senderCustom: false }
                              : { ...draft, recipientCustom: false },
                          );
                        }}
                      >
                        {t("audienceGlobal")}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={custom}
                        className={custom ? "is-active" : ""}
                        onClick={() => {
                          setBadgeError("");
                          setDraft(
                            side === "sender"
                              ? { ...draft, senderCustom: true }
                              : { ...draft, recipientCustom: true },
                          );
                        }}
                      >
                        {t("audienceCustom")}
                      </button>
                    </div>
                    {custom ? (
                      <>
                        <p className="footprints-chip-title">
                          {t("chipGenders")} <span>{t("matchAny")}</span>
                        </p>
                        <div className="footprints-chips">
                          {FOOTPRINT_GENDERS.map((gender) => {
                            const on = genders.includes(gender);
                            return (
                              <button
                                type="button"
                                className={`footprints-chip${on ? " is-on" : ""}`}
                                aria-pressed={on}
                                key={gender}
                                onClick={() => {
                                  setBadgeError("");
                                  setDraft(
                                    side === "sender"
                                      ? { ...draft, senderGenders: toggle(genders, gender) }
                                      : { ...draft, recipientGenders: toggle(genders, gender) },
                                  );
                                }}
                              >
                                <span aria-hidden="true">{on ? "✓" : "+"}</span>
                                {t(`gender.${gender}`)}
                              </button>
                            );
                          })}
                        </div>
                        <p className="footprints-chip-title">
                          {t("chipGroups")} <span>{t("matchAny")}</span>
                        </p>
                        <div className="footprints-group-grid">
                          {payload.castGroups.map((group) => {
                            const on = groupIds.includes(group.id);
                            return (
                              <button
                                type="button"
                                className={`footprints-group-option${on ? " is-on" : ""}${group.active ? "" : " is-inactive"}`}
                                aria-pressed={on}
                                disabled={!group.active && !on}
                                key={group.id}
                                onClick={() => {
                                  setBadgeError("");
                                  setDraft(
                                    side === "sender"
                                      ? { ...draft, senderGroupIds: toggle(groupIds, group.id) }
                                      : { ...draft, recipientGroupIds: toggle(groupIds, group.id) },
                                  );
                                }}
                              >
                                <span className="footprints-group-check" aria-hidden="true">{on ? "✓" : ""}</span>
                                <span>
                                  <strong>{groupLabel(group.id)}</strong>
                                  {!group.active ? <small>{t("groupInactive")}</small> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <p className={`footprints-audience-summary${invalid ? " is-error" : ""}`}>
                          {invalid
                            ? t("audienceRequired")
                            : `${t(side === "sender" ? "senderShort" : "recipientShort")}: ${audienceSummary(genders, groupIds)}`}
                        </p>
                        {genders.length > 0 && groupIds.length > 0 ? (
                          <p className="footprints-match-logic">{t("matchBothAxes")}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="footprints-audience-summary">{t("globalHint")}</p>
                    )}
                  </fieldset>
                ))}
              </div>
              <label className="field">
                <span>{t("sortOrder")}</span>
                <input
                  type="number"
                  min={0}
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })}
                />
              </label>
              <label className="footprints-check field">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                />
                <span>{t("active")}</span>
              </label>
              </div>
              {badgeError ? <p className="footprints-dialog-error" role="alert">{badgeError}</p> : null}
            </div>
            <div className="dialog-actions">
              <button type="button" className="text-button" disabled={busy} onClick={() => setDraft(null)}>
                {common("cancel")}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={
                  busy
                  || uploading
                  || !draft.imageUrl
                  || draft.labelEn.trim() === ""
                  || draft.labelHu.trim() === ""
                  || draftSenderInvalid
                  || draftRecipientInvalid
                }
                onClick={() => void saveBadge()}
              >
                {common("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {archiveTarget && (
        <ConfirmDialog
          busyLabel={common("saving")}
          title={t("archiveTitle")}
          copy={t("archiveBody", { label: archiveTarget.labels.en })}
          confirmLabel={t("archive")}
          busy={busy}
          onCancel={() => { if (!busy) setArchiveTarget(null); }}
          onConfirm={() => void archiveBadge()}
        />
      )}
    </div>
  );
}

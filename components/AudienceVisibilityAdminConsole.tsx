"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  AUDIENCE_VISIBILITY_ADMIN_ACTIONS,
  AUDIENCE_VISIBILITY_GENDERS,
  AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY,
  AUDIENCE_VISIBILITY_VALUES,
  audienceVisibilityAdminMe,
  audienceVisibilityCatalogResponse,
  audienceVisibilityConflict,
  audienceVisibilityConflictMatchesPending,
  audienceVisibilityError,
  audienceVisibilityGroupDraft,
  audienceVisibilityGroupMutationResponse,
  audienceVisibilityIntentMutationResponse,
  audienceVisibilityMutationConverged,
  audienceVisibilityPendingFrom,
  audienceVisibilityPendingMutation,
  audienceVisibilityPersistBeforeMutation,
  audienceVisibilityShouldRetainMutation,
  type AudienceVisibilityAdminAction,
  type AudienceVisibilityCatalog,
  type AudienceVisibilityGroup,
  type AudienceVisibilityIntent,
  type AudienceVisibilityMutationAction,
  type AudienceVisibilityPendingMutation,
  type AudienceVisibilityRule,
  type AudienceVisibilityTab,
  type AudienceVisibilityValue,
} from "@/lib/audienceVisibilityAdmin";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;
type GroupDraft = {
  id: string;
  key: string;
  labels: { en: string; hu: string };
  rules: AudienceVisibilityRule[];
  sort_order: number;
  active: boolean;
  protected: boolean;
  revision: number;
  isNew: boolean;
};
type IntentDraft = {
  key: string;
  labels: { en: string; hu: string };
  sort_order: number;
  isNew: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function groupDraft(group: AudienceVisibilityGroup): GroupDraft {
  return {
    id: group.id,
    key: group.key,
    labels: clone(group.labels),
    rules: clone(group.rules),
    sort_order: group.sort_order,
    active: group.active,
    protected: group.protected,
    revision: group.revision,
    isNew: false,
  };
}

function sortGroups(groups: AudienceVisibilityGroup[]): AudienceVisibilityGroup[] {
  return [...groups].sort((left, right) => left.sort_order - right.sort_order
    || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

function replaceGroup(catalog: AudienceVisibilityCatalog, group: AudienceVisibilityGroup): AudienceVisibilityCatalog {
  const found = catalog.groups.some((row) => row.id === group.id);
  return {
    ...catalog,
    groups: sortGroups(found
      ? catalog.groups.map((row) => row.id === group.id ? group : row)
      : [...catalog.groups, group]),
  };
}

function canonicalToggle<T extends string>(values: readonly T[], current: T[], value: T, checked: boolean): T[] {
  const selected = new Set(current);
  if (checked) selected.add(value);
  else selected.delete(value);
  return values.filter((entry) => selected.has(entry));
}

function unicodeLength(value: string): number {
  return [...value].length;
}

export default function AudienceVisibilityAdminConsole({ initialTab }: { initialTab: AudienceVisibilityTab }) {
  const t = useTranslations("audienceVisibilityAdmin");
  const common = useTranslations("common");
  const locale = useLocale() === "hu" ? "hu" : "en";
  const [tab, setTab] = useState<AudienceVisibilityTab>(initialTab);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [catalog, setCatalog] = useState<AudienceVisibilityCatalog | null>(null);
  const [actions, setActions] = useState<AudienceVisibilityAdminAction[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<AudienceVisibilityPendingMutation | null>(null);
  const pendingRef = useRef<AudienceVisibilityPendingMutation | null>(null);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<GroupDraft | null>(null);
  const [intent, setIntent] = useState<IntentDraft | null>(null);
  const [reason, setReason] = useState("");
  const [selectionMax, setSelectionMax] = useState(5);
  const [limitReason, setLimitReason] = useState("");

  const can = useCallback((action: AudienceVisibilityAdminAction): boolean => actions.includes(action), [actions]);

  const load = useCallback(async () => {
    setState((current) => current === "ready" ? current : "loading");
    const [meResponse, catalogResponse] = await Promise.all([
      adminCall("admin_me", {}),
      adminCall("audience_visibility_catalog", { contract_version: 1 }),
    ]);
    const adminMe = audienceVisibilityAdminMe(meResponse?.audience_visibility);
    if (!adminMe?.contract_ready || !adminMe.actions.includes("audience_visibility_catalog")) {
      setActions(adminMe?.actions ?? []);
      setState(adminMe ? "forbidden" : "error");
      return;
    }
    const parsed = audienceVisibilityCatalogResponse(catalogResponse);
    if (!parsed) {
      setState("error");
      return;
    }
    setActions(adminMe.actions);
    setCatalog(parsed);
    setSelectionMax(parsed.intents.selection_max);
    setState("ready");
  }, []);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = audienceVisibilityPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [load, t]);

  function chooseTab(next: AudienceVisibilityTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }

  function clearPending(): boolean {
    try {
      window.sessionStorage.removeItem(AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  async function executeMutation(next: AudienceVisibilityPendingMutation) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const existing = pendingRef.current;
    let response: AdminResponse | null;
    if (existing) {
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await audienceVisibilityPersistBeforeMutation(
        window.sessionStorage,
        next,
        () => adminCall(next.action, next.payload),
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      pendingRef.current = next;
      setPending(next);
      response = persisted.response;
    }

    const command = existing ?? next;
    const action = command.action;
    if (action === "save_audience_visibility_group" || action === "archive_audience_visibility_group") {
      const result = audienceVisibilityGroupMutationResponse(response);
      if (result && audienceVisibilityMutationConverged(command, result)) {
        setCatalog((current) => current ? replaceGroup(current, result.group) : current);
        setGroup(null);
        setReason("");
        const cleared = clearPending();
        setNotice({
          tone: cleared ? "success" : "error",
          text: cleared ? t(result.replayed ? "live.replayed" : "live.saved") : t("live.persistenceCleanupFailed"),
        });
        setBusy(false);
        return;
      }
    } else {
      const result = audienceVisibilityIntentMutationResponse(response);
      if (result && audienceVisibilityMutationConverged(command, result)) {
        setCatalog((current) => current ? { ...current, intents: result.intents } : current);
        setSelectionMax(result.intents.selection_max);
        setIntent(null);
        setReason("");
        setLimitReason("");
        const cleared = clearPending();
        setNotice({
          tone: cleared ? "success" : "error",
          text: cleared ? t(result.replayed ? "live.replayed" : "live.saved") : t("live.persistenceCleanupFailed"),
        });
        setBusy(false);
        return;
      }
    }

    const conflict = audienceVisibilityConflict(response);
    if (conflict && audienceVisibilityConflictMatchesPending(command, conflict)) {
      if (conflict.kind === "group") {
        setCatalog((current) => current ? replaceGroup(current, conflict.group) : current);
        setGroup(null);
      } else {
        setCatalog((current) => current ? { ...current, intents: conflict.intents } : current);
        setSelectionMax(conflict.intents.selection_max);
        setIntent(null);
      }
      setReason("");
      setLimitReason("");
      const cleared = clearPending();
      setNotice({ tone: "error", text: cleared ? t("live.conflict") : t("live.persistenceCleanupFailed") });
      setBusy(false);
      return;
    }

    const error = audienceVisibilityError(response);
    if (!audienceVisibilityShouldRetainMutation(error)) clearPending();
    setNotice({
      tone: "error",
      text: t("live.errorCode", { code: error ?? t("live.unknownError") }),
    });
    setBusy(false);
  }

  function makeMutation(
    action: AudienceVisibilityMutationAction,
    target: string,
    payload: Record<string, unknown>,
  ) {
    const mutation = audienceVisibilityPendingMutation(action, target, {
      ...payload,
      contract_version: 1,
      request_id: crypto.randomUUID(),
    });
    if (!mutation) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    void executeMutation(mutation);
  }

  function saveGroup() {
    if (!group || !can("save_audience_visibility_group")) return;
    const material = audienceVisibilityGroupDraft({
      key: group.key,
      labels: group.labels,
      rules: group.rules,
      sort_order: group.sort_order,
      active: group.active,
    });
    if (!material || (group.protected && !group.id)) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    makeMutation("save_audience_visibility_group", group.id || `new:${group.key}`, {
      expected_revision: group.revision,
      audit_reason: reason,
      id: group.id,
      group_key: material.key,
      labels_json: material.labels,
      rules_json: material.rules,
      sort_order: material.sort_order,
      active: material.active,
    });
  }

  function archiveGroup() {
    if (!group || group.isNew || group.protected || !can("archive_audience_visibility_group")) return;
    makeMutation("archive_audience_visibility_group", group.id, {
      expected_revision: group.revision,
      audit_reason: reason,
      id: group.id,
      archived: group.active,
    });
  }

  function saveIntent() {
    if (!catalog || !intent || !can("save_audience_visibility_intent")) return;
    makeMutation("save_audience_visibility_intent", intent.key, {
      expected_intents_revision: catalog.intents.intents_revision,
      audit_reason: reason,
      key: intent.key,
      labels_json: intent.labels,
      sort_order: intent.sort_order,
    });
  }

  function archiveIntent(row: AudienceVisibilityIntent) {
    if (!catalog || !can("archive_audience_visibility_intent")) return;
    makeMutation("archive_audience_visibility_intent", row.key, {
      expected_intents_revision: catalog.intents.intents_revision,
      audit_reason: reason,
      key: row.key,
      archived: !row.archived,
    });
  }

  function saveLimit() {
    if (!catalog || !can("set_audience_visibility_intent_limit")) return;
    makeMutation("set_audience_visibility_intent_limit", "selection-max", {
      expected_intents_revision: catalog.intents.intents_revision,
      audit_reason: limitReason,
      selection_max: selectionMax,
    });
  }

  function startNewGroup() {
    const nextOrder = Math.min(100_000, Math.max(0, ...(catalog?.groups.map((row) => row.sort_order + 10) ?? [0])));
    setGroup({
      id: "",
      key: "",
      labels: { en: "", hu: "" },
      rules: [{ genders: ["man"], visible_to: ["both"] }],
      sort_order: nextOrder,
      active: true,
      protected: false,
      revision: 0,
      isNew: true,
    });
    setReason("");
    setNotice(null);
  }

  function startIntent(row?: AudienceVisibilityIntent) {
    const nextOrder = Math.min(100_000, Math.max(0, ...(catalog?.intents.items.map((item) => item.sort_order + 10) ?? [0])));
    setIntent(row ? { key: row.key, labels: clone(row.labels), sort_order: row.sort_order, isNew: false } : {
      key: "",
      labels: { en: "", hu: "" },
      sort_order: nextOrder,
      isNew: true,
    });
    setReason("");
    setNotice(null);
  }

  const locked = busy || pending !== null;
  const reasonValid = reason === reason.trim() && reason === reason.normalize("NFC")
    && unicodeLength(reason) >= 1 && unicodeLength(reason) <= 300;
  const limitReasonValid = limitReason === limitReason.trim() && limitReason === limitReason.normalize("NFC")
    && unicodeLength(limitReason) >= 1 && unicodeLength(limitReason) <= 300;
  const groupMaterialValid = useMemo(() => group ? Boolean(audienceVisibilityGroupDraft({
    key: group.key,
    labels: group.labels,
    rules: group.rules,
    sort_order: group.sort_order,
    active: group.active,
  })) : false, [group]);

  if (state === "loading") return <LoadingPanel />;
  if (state === "forbidden") return <ErrorPanel message={t("forbidden")} retry={load} />;
  if (state === "error" || !catalog) return <ErrorPanel message={t("loadError")} retry={load} />;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <div className="admin-tabs audience-visibility-tabs" role="tablist" aria-label={t("tabs.label")}>
        {(["groups", "retirement", "intents"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => chooseTab(key)}
          >{t(`tabs.${key}`)}</button>
        ))}
      </div>
      {pending ? (
        <div className="alert alert-info audience-visibility-pending">
          <div><strong>{t("live.pendingMutation")}</strong><br /><code>{pending.action}</code> · {pending.target}</div>
          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void executeMutation(pending)}>{t("live.retryExact")}</button>
        </div>
      ) : null}
      {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}

      {tab === "groups" ? (
        <div className="audience-visibility-workspace">
          <section className="panel">
            <div className="panel-header">
              <div><h2>{t("groups.title")}</h2><p>{t("groups.copy")}</p></div>
              {can("save_audience_visibility_group") ? <button className="button button-primary" type="button" disabled={locked} onClick={startNewGroup}>{t("groups.add")}</button> : null}
            </div>
            <div className="panel-body audience-visibility-list">
              {catalog.groups.map((row) => (
                <article className="audience-visibility-row" key={row.id}>
                  <div>
                    <div className="audience-visibility-row-title"><strong>{row.labels[locale]}</strong><code>{row.key}</code></div>
                    <p>{row.rules.map((rule) => `${rule.genders.map((value) => t(`genders.${value}`)).join(" + ")} → ${rule.visible_to.map((value) => t(`visibleTo.${value}`)).join(" + ")}`).join("; ")}</p>
                    <div className="status-list">
                      <span className={`status-badge ${row.active ? "status-active" : "status-inactive"}`}>{t(row.active ? "states.active" : "states.archived")}</span>
                      <span className="status-badge status-inactive">{t(row.protected ? "groups.protected" : "groups.custom")}</span>
                      {row.legacy_segment ? <code>{row.legacy_segment}</code> : null}
                      <span>{t("groups.revision", { revision: row.revision })}</span>
                    </div>
                  </div>
                  {can("save_audience_visibility_group") ? <button className="button button-secondary button-small" type="button" disabled={locked} onClick={() => { setGroup(groupDraft(row)); setReason(""); setNotice(null); }}>{t("edit")}</button> : null}
                </article>
              ))}
            </div>
          </section>

          {group ? (
            <section className="panel audience-visibility-editor">
              <div className="panel-header"><div><h2>{t(group.isNew ? "groups.newTitle" : "groups.editTitle")}</h2><p>{group.protected ? t("groups.protectedHint") : t("groups.customHint")}</p></div><button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => setGroup(null)}>{common("cancel")}</button></div>
              <div className="panel-body form-grid">
                <label className="field"><span>{t("fields.key")}</span><input value={group.key} maxLength={64} readOnly={group.protected} disabled={locked} onChange={(event) => setGroup({ ...group, key: event.target.value })} /></label>
                <label className="field"><span>{t("fields.order")}</span><input type="number" min={0} max={100000} value={group.sort_order} disabled={locked} onChange={(event) => setGroup({ ...group, sort_order: Number(event.target.value) })} /></label>
                <label className="field"><span>{t("fields.labelEn")}</span><input value={group.labels.en} maxLength={160} disabled={locked} onChange={(event) => setGroup({ ...group, labels: { ...group.labels, en: event.target.value } })} /></label>
                <label className="field"><span>{t("fields.labelHu")}</span><input value={group.labels.hu} maxLength={160} disabled={locked} onChange={(event) => setGroup({ ...group, labels: { ...group.labels, hu: event.target.value } })} /></label>
                {!group.protected ? (
                  <fieldset className="field field-full audience-visibility-rules">
                    <legend>{t("groups.rules")}</legend>
                    <p className="field-hint">{t("groups.rulesHint")}</p>
                    {group.rules.map((rule, index) => (
                      <div className="audience-visibility-rule" key={index}>
                        <header><strong>{t("groups.rule", { number: index + 1 })}</strong>{group.rules.length > 1 ? <button className="button button-danger button-small" type="button" disabled={locked} onClick={() => setGroup({ ...group, rules: group.rules.filter((_, at) => at !== index) })}>{t("remove")}</button> : null}</header>
                        <div><span>{t("groups.genderAxis")}</span><div className="profile-field-radio-row">{AUDIENCE_VISIBILITY_GENDERS.map((value) => <label key={value}><input type="checkbox" disabled={locked} checked={rule.genders.includes(value)} onChange={(event) => {
                          const genders = canonicalToggle(AUDIENCE_VISIBILITY_GENDERS, rule.genders, value, event.target.checked);
                          const visibleTo = value === "nonbinary" && event.target.checked ? ["both"] as AudienceVisibilityValue[] : rule.visible_to;
                          setGroup({ ...group, rules: group.rules.map((entry, at) => at === index ? { genders, visible_to: visibleTo } : entry) });
                        }} /><span>{t(`genders.${value}`)}</span></label>)}</div></div>
                        <div><span>{t("groups.visibleAxis")}</span><div className="profile-field-radio-row">{AUDIENCE_VISIBILITY_VALUES.map((value) => <label key={value}><input type="checkbox" disabled={locked || (rule.genders.includes("nonbinary") && value !== "both")} checked={rule.visible_to.includes(value)} onChange={(event) => {
                          const visibleTo = canonicalToggle(AUDIENCE_VISIBILITY_VALUES, rule.visible_to, value, event.target.checked);
                          setGroup({ ...group, rules: group.rules.map((entry, at) => at === index ? { ...entry, visible_to: visibleTo } : entry) });
                        }} /><span>{t(`visibleTo.${value}`)}</span></label>)}</div></div>
                      </div>
                    ))}
                    <button className="button button-secondary button-small" type="button" disabled={locked || group.rules.length >= 20} onClick={() => setGroup({ ...group, rules: [...group.rules, { genders: ["man"], visible_to: ["both"] }] })}>{t("groups.addRule")}</button>
                  </fieldset>
                ) : (
                  <div className="alert alert-info field-full">{t("groups.protectedFields")}</div>
                )}
                {!group.protected ? <label className="checkbox-field field-full"><input type="checkbox" checked={group.active} disabled={locked} onChange={(event) => setGroup({ ...group, active: event.target.checked })} /><span>{t("states.active")}</span></label> : null}
                <label className="field field-full"><span>{t("fields.auditReason")}</span><textarea rows={3} maxLength={600} value={reason} disabled={locked} onChange={(event) => setReason(event.target.value)} /><small className={reason && !reasonValid ? "field-error" : "field-hint"}>{t("fields.auditHint", { count: unicodeLength(reason) })}</small></label>
                <div className="row-actions field-full">
                  {!group.isNew && !group.protected && can("archive_audience_visibility_group") ? <button className={group.active ? "button button-danger" : "button button-secondary"} type="button" disabled={locked || !reasonValid} onClick={archiveGroup}>{t(group.active ? "archive" : "restore")}</button> : null}
                  <button className="button button-primary" type="button" disabled={locked || !reasonValid || !groupMaterialValid} onClick={saveGroup}>{busy ? common("saving") : common("save")}</button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "retirement" ? (
        <div className="audience-visibility-workspace">
          <section className="panel"><div className="panel-header"><div><h2>{t("retirement.title")}</h2><p>{t("retirement.copy")}</p></div></div><div className="panel-body">
            <dl className="detail-list">
              <div className="detail-row"><dt>{t("retirement.orientation")}</dt><dd><span className="status-badge status-inactive">{t("states.retired")}</span></dd></div>
              <div className="detail-row"><dt>{t("retirement.layer1")}</dt><dd><span className="status-badge status-inactive">{t("states.retired")}</span></dd></div>
              <div className="detail-row"><dt>{t("retirement.manifest")}</dt><dd><code>{catalog.retirement_manifest.sha256}</code></dd></div>
            </dl>
          </div></section>
          <section className="panel"><div className="panel-header"><div><h2>{t("retirement.questionsTitle")}</h2><p>{t("retirement.questionsCopy")}</p></div></div><div className="panel-body audience-visibility-list">{catalog.retirement_manifest.profile_questions.map((row) => <article className="audience-visibility-row" key={row.key}><div><div className="audience-visibility-row-title"><strong>{row.labels[locale]}</strong><code>{row.key}</code></div><p>{t("retirement.datingSpecific")}</p></div><span className="status-badge status-inactive">{t("states.retired")}</span></article>)}</div></section>
          {catalog.retirement_manifest.retained_questions.length > 0 ? (
            <section className="panel"><div className="panel-header"><div><h2>{t("retirement.retainedTitle")}</h2><p>{t("retirement.retainedCopy")}</p></div></div><div className="panel-body audience-visibility-list">{catalog.retirement_manifest.retained_questions.map((row) => <article className="audience-visibility-row" key={row.key}><div><div className="audience-visibility-row-title"><strong>{row.labels[locale]}</strong><code>{row.key}</code></div><p>{t("retirement.neutral")}</p></div><span className="status-badge status-active">{t("states.active")}</span></article>)}</div></section>
          ) : null}
          <section className="panel"><div className="panel-header"><div><h2>{t("retirement.legacyTitle")}</h2><p>{t("retirement.legacyCopy")}</p></div></div><div className="panel-body"><div className="tag-list">{catalog.retirement_manifest.legacy_catalogue_types.map((row) => <code className="tag" key={row}>{row}</code>)}</div></div></section>
        </div>
      ) : null}

      {tab === "intents" ? (
        <div className="audience-visibility-workspace">
          <section className="panel">
            <div className="panel-header"><div><h2>{catalog.intents.title[locale]}</h2><p>{t("intents.copy")}</p></div>{can("save_audience_visibility_intent") ? <button className="button button-primary" type="button" disabled={locked} onClick={() => startIntent()}>{t("intents.add")}</button> : null}</div>
            <div className="panel-body">
              <div className="alert alert-info">{t("intents.noLayer1")}</div>
              <div className="audience-visibility-limit">
                <label className="field"><span>{t("intents.selectionMax")}</span><select value={selectionMax} disabled={locked || !can("set_audience_visibility_intent_limit")} onChange={(event) => setSelectionMax(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select><small className="field-hint">{t("intents.selectionMin")}</small></label>
                {can("set_audience_visibility_intent_limit") ? <><label className="field"><span>{t("fields.auditReason")}</span><input maxLength={600} value={limitReason} disabled={locked} onChange={(event) => setLimitReason(event.target.value)} /><small className={limitReason && !limitReasonValid ? "field-error" : "field-hint"}>{t("fields.auditHint", { count: unicodeLength(limitReason) })}</small></label><button className="button button-secondary" type="button" disabled={locked || !limitReasonValid || selectionMax === catalog.intents.selection_max} onClick={saveLimit}>{t("intents.saveLimit")}</button></> : null}
              </div>
              <div className="audience-visibility-list">{catalog.intents.items.map((row) => <article className="audience-visibility-row" key={row.key}><div><div className="audience-visibility-row-title"><strong>{row.labels[locale]}</strong><code>{row.key}</code></div><div className="status-list"><span className={`status-badge ${row.archived ? "status-inactive" : "status-active"}`}>{t(row.archived ? "states.archived" : "states.active")}</span><span>{t("intents.order", { order: row.sort_order })}</span></div></div>{can("save_audience_visibility_intent") ? <button className="button button-secondary button-small" type="button" disabled={locked} onClick={() => startIntent(row)}>{t("edit")}</button> : null}</article>)}</div>
            </div>
          </section>
          {intent ? <section className="panel audience-visibility-editor"><div className="panel-header"><div><h2>{t(intent.isNew ? "intents.newTitle" : "intents.editTitle")}</h2><p>{t("intents.editorCopy")}</p></div><button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => setIntent(null)}>{common("cancel")}</button></div><div className="panel-body form-grid">
            <label className="field"><span>{t("fields.key")}</span><input maxLength={64} value={intent.key} readOnly={!intent.isNew} disabled={locked} onChange={(event) => setIntent({ ...intent, key: event.target.value })} /></label>
            <label className="field"><span>{t("fields.order")}</span><input type="number" min={0} max={100000} value={intent.sort_order} disabled={locked} onChange={(event) => setIntent({ ...intent, sort_order: Number(event.target.value) })} /></label>
            <label className="field"><span>{t("fields.labelEn")}</span><input maxLength={360} value={intent.labels.en} disabled={locked} onChange={(event) => setIntent({ ...intent, labels: { ...intent.labels, en: event.target.value } })} /></label>
            <label className="field"><span>{t("fields.labelHu")}</span><input maxLength={360} value={intent.labels.hu} disabled={locked} onChange={(event) => setIntent({ ...intent, labels: { ...intent.labels, hu: event.target.value } })} /></label>
            <label className="field field-full"><span>{t("fields.auditReason")}</span><textarea rows={3} maxLength={600} value={reason} disabled={locked} onChange={(event) => setReason(event.target.value)} /><small className={reason && !reasonValid ? "field-error" : "field-hint"}>{t("fields.auditHint", { count: unicodeLength(reason) })}</small></label>
            <div className="row-actions field-full">{!intent.isNew && can("archive_audience_visibility_intent") ? <button className={catalog.intents.items.find((row) => row.key === intent.key)?.archived ? "button button-secondary" : "button button-danger"} type="button" disabled={locked || !reasonValid} onClick={() => { const row = catalog.intents.items.find((entry) => entry.key === intent.key); if (row) archiveIntent(row); }}>{t(catalog.intents.items.find((row) => row.key === intent.key)?.archived ? "restore" : "archive")}</button> : null}<button className="button button-primary" type="button" disabled={locked || !reasonValid || !intent.key || !intent.labels.en || !intent.labels.hu} onClick={saveIntent}>{busy ? common("saving") : common("save")}</button></div>
          </div></section> : null}
        </div>
      ) : null}
      <p className="page-subtitle audience-visibility-contract-note">{t("contractNote", { actions: AUDIENCE_VISIBILITY_ADMIN_ACTIONS.length })}</p>
    </>
  );
}

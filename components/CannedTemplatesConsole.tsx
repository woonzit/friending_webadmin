"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  CANNED_TEMPLATE_CHANNELS,
  CANNED_TEMPLATE_PAGE_SIZE,
  CANNED_TEMPLATE_PENDING_STORAGE_KEY,
  cannedTemplateCanWrite,
  cannedTemplateConflictMatches,
  cannedTemplateConflictResponse,
  cannedTemplateDeleteConverged,
  cannedTemplateDeletePayload,
  cannedTemplateDeleteResponse,
  cannedTemplateDraftMaterial,
  cannedTemplateEmailPreviewDocument,
  cannedTemplateErrorKey,
  cannedTemplateErrorResponse,
  cannedTemplateListPayload,
  cannedTemplateListResponse,
  cannedTemplatePendingDelete,
  cannedTemplatePendingMutation,
  cannedTemplatePendingSave,
  cannedTemplateSaveConverged,
  cannedTemplateSavePayload,
  cannedTemplateSaveResponse,
  cannedTemplateShouldRetainMutation,
  mergeCannedTemplatePages,
  normalizeCannedTemplateQuery,
  type CannedTemplate,
  type CannedTemplateChannel,
  type CannedTemplateDraft,
  type CannedTemplateDraftError,
  type CannedTemplateDraftMaterial,
  type CannedTemplateListData,
  type CannedTemplatePendingMutation,
} from "@/lib/cannedTemplates";
import { formatDate } from "@/lib/format";

type LoadState = "loading" | "ready" | "error";
type Notice = { tone: "success" | "error" | "info"; text: string };
type Confirmation = "save" | "delete" | null;

const EMPTY_DRAFT: CannedTemplateDraft = {
  name: "",
  subject: "",
  body: "",
  auditReason: "",
};

function fieldsFromTemplate(template: CannedTemplate): CannedTemplateDraft {
  return {
    name: template.name,
    subject: template.subject,
    body: template.body,
    auditReason: "",
  };
}

function fieldsFromPending(
  pending: CannedTemplatePendingMutation,
): CannedTemplateDraft | null {
  if (pending.action !== "save") return null;
  return {
    name: pending.payload.name,
    subject: pending.payload.subject,
    body: pending.payload.body,
    auditReason: pending.payload.audit_reason,
  };
}

function materialMatchesTemplate(
  material: CannedTemplateDraftMaterial,
  template: CannedTemplate,
): boolean {
  return material.name === template.name
    && material.subject === template.subject
    && material.body === template.body;
}

function CannedTemplatePreview({
  channel,
  selected,
  draft,
}: {
  channel: CannedTemplateChannel;
  selected: CannedTemplate | null;
  draft: CannedTemplateDraftMaterial | null;
}) {
  const t = useTranslations("cannedTemplates.preview");
  const canonicalDocument = selected?.channel === "email"
    ? cannedTemplateEmailPreviewDocument(selected.body)
    : null;

  return (
    <aside className="canned-preview-column" aria-label={t("label")}>
      <div className="canned-preview-heading">
        <div><h3>{t("title")}</h3><p>{t("copy")}</p></div>
        <span className="badge">{t(`channels.${channel}`)}</span>
      </div>

      {selected ? (
        <section className="canned-canonical-preview">
          <div className="canned-preview-label"><strong>{t("storedTitle")}</strong><span>{t("revision", { revision: selected.revision })}</span></div>
          {selected.channel === "email" && canonicalDocument ? (
            <iframe
              className="canned-email-frame"
              sandbox=""
              srcDoc={canonicalDocument}
              title={t("emailFrameTitle", { name: selected.name })}
            />
          ) : selected.channel === "sms" ? (
            <div className="canned-phone-preview"><div className="canned-sms-bubble">{selected.body}</div></div>
          ) : (
            <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{selected.subject}</strong><p>{selected.body}</p></div></div>
          )}
        </section>
      ) : <div className="empty-state compact"><p>{t("noStored")}</p></div>}

      <section className="canned-draft-preview">
        <div className="canned-preview-label"><strong>{t("draftTitle")}</strong><span>{draft ? t("normalized") : t("invalid")}</span></div>
        {!draft ? <p className="field-hint">{t("draftInvalid")}</p> : channel === "email" ? (
          <div className="canned-email-source"><p>{t("emailSourceOnly")}</p><pre>{draft.body}</pre></div>
        ) : channel === "sms" ? (
          <div className="canned-phone-preview"><div className="canned-sms-bubble">{draft.body}</div></div>
        ) : (
          <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{draft.subject}</strong><p>{draft.body}</p></div></div>
        )}
      </section>
    </aside>
  );
}

export default function CannedTemplatesConsole() {
  const t = useTranslations("cannedTemplates");
  const common = useTranslations("common");
  const locale = useLocale();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<LoadState>("loading");
  const [channel, setChannel] = useState<CannedTemplateChannel>("email");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<CannedTemplateListData | null>(null);
  const [selected, setSelected] = useState<CannedTemplate | null>(null);
  const [draft, setDraft] = useState<CannedTemplateDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState<CannedTemplatePendingMutation | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pendingRef = useRef<CannedTemplatePendingMutation | null>(null);
  const listRef = useRef<CannedTemplateListData | null>(null);
  const loadSequenceRef = useRef(0);

  const rememberPending = useCallback((value: CannedTemplatePendingMutation | null): boolean => {
    try {
      if (value) window.sessionStorage.setItem(
        CANNED_TEMPLATE_PENDING_STORAGE_KEY,
        JSON.stringify(value),
      );
      else window.sessionStorage.removeItem(CANNED_TEMPLATE_PENDING_STORAGE_KEY);
    } catch {
      setStorageAvailable(false);
      if (value === null) {
        pendingRef.current = null;
        setPending(null);
      }
      return false;
    }
    pendingRef.current = value;
    setPending(value);
    setStorageAvailable(true);
    return true;
  }, []);

  const loadPage = useCallback(async (
    channelValue: CannedTemplateChannel,
    queryValue: string,
    cursorValue = "",
    append = false,
  ): Promise<CannedTemplateListData | null> => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const request = cannedTemplateListPayload(
      channelValue,
      queryValue,
      cursorValue,
      CANNED_TEMPLATE_PAGE_SIZE,
    );
    if (!request) {
      setState("error");
      return null;
    }
    if (!append) setState("loading");
    const response = await adminCall("list_canned", request);
    if (sequence !== loadSequenceRef.current) return null;
    const parsed = cannedTemplateListResponse(response, request);
    if (!parsed) {
      setState("error");
      return null;
    }
    if (append) {
      const current = listRef.current;
      const merged = current?.next_cursor === cursorValue
        ? mergeCannedTemplatePages(current, parsed)
        : null;
      if (!merged) {
        setState("error");
        return null;
      }
      listRef.current = merged;
      setList(merged);
      setState("ready");
      return merged;
    } else {
      listRef.current = parsed;
      setList(parsed);
    }
    setState("ready");
    return parsed;
  }, []);

  useEffect(() => {
    let serialized: string | null = null;
    try {
      serialized = window.sessionStorage.getItem(CANNED_TEMPLATE_PENDING_STORAGE_KEY);
    } catch {
      setStorageAvailable(false);
      setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
    }
    if (serialized) {
      try {
        const restored = cannedTemplatePendingMutation(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
          setChannel(restored.channel);
          const restoredDraft = fieldsFromPending(restored);
          if (restoredDraft) setDraft(restoredDraft);
        } else {
          rememberPending(null);
        }
      } catch {
        rememberPending(null);
      }
    }
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      const loaded = await loadPage(channel, query);
      const durable = pendingRef.current;
      if (!loaded || !durable) return;
      const id = durable.payload.id;
      const current = id === ""
        ? null
        : loaded.templates.find((template) => template.template_id === id) ?? null;
      setSelected(current);
      if (durable.action === "delete" && current) {
        setDraft({ ...fieldsFromTemplate(current), auditReason: durable.payload.audit_reason });
      }
      setNotice({ tone: "info", text: t("pending.restored") });
    })();
  }, [channel, hydrated, loadPage, query, t]);

  const materialResult = useMemo(
    () => cannedTemplateDraftMaterial(channel, draft),
    [channel, draft],
  );
  const material = materialResult.ok ? materialResult.value : null;
  const normalized = Boolean(material && (
    material.name !== draft.name
    || material.subject !== draft.subject
    || material.body !== draft.body
    || material.audit_reason !== draft.auditReason
  ));
  const contentChanged = Boolean(material && (
    selected === null || !materialMatchesTemplate(material, selected)
  ));
  const hasDraftInput = Object.values(draft).some((value) => value !== "");
  const canWrite = Boolean(list && cannedTemplateCanWrite(list.principal));
  const locked = busy || pending !== null || !canWrite;

  function validationMessage(error: CannedTemplateDraftError): string {
    return t(`validation.${error}`);
  }

  function updateDraft(values: Partial<CannedTemplateDraft>) {
    setDraft((current) => ({ ...current, ...values }));
    setNotice(null);
    setConfirmation(null);
  }

  function selectTemplate(template: CannedTemplate) {
    if (pending || busy) return;
    setSelected(template);
    setDraft(fieldsFromTemplate(template));
    setNotice(null);
    setConfirmation(null);
  }

  function createTemplate() {
    if (pending || busy) return;
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setNotice(null);
    setConfirmation(null);
  }

  async function refreshAfterMutation(target: CannedTemplate | null) {
    const loaded = await loadPage(channel, query);
    if (!loaded) return;
    setSelected(target);
    setDraft(target ? fieldsFromTemplate(target) : EMPTY_DRAFT);
  }

  function prepareSave() {
    if (!materialResult.ok) {
      setNotice({ tone: "error", text: validationMessage(materialResult.error) });
      return;
    }
    if (!contentChanged) {
      setNotice({ tone: "info", text: t("notices.noChanges") });
      return;
    }
    setConfirmation("save");
  }

  function prepareDelete() {
    if (!selected) return;
    const check = cannedTemplateDeletePayload(selected, draft.auditReason, crypto.randomUUID());
    if (!check.ok) {
      setNotice({ tone: "error", text: validationMessage(check.error) });
      return;
    }
    setConfirmation("delete");
  }

  async function executeMutation() {
    const action = pendingRef.current?.action ?? confirmation;
    if (!action || !list || busy) return;
    let durable = pendingRef.current;
    if (!durable) {
      if (!storageAvailable || !cannedTemplateCanWrite(list.principal)) {
        setConfirmation(null);
        setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
        return;
      }
      if (action === "save") {
        const result = cannedTemplateSavePayload(
          channel,
          selected,
          draft,
          crypto.randomUUID(),
        );
        if (!result.ok) {
          setConfirmation(null);
          setNotice({ tone: "error", text: validationMessage(result.error) });
          return;
        }
        durable = cannedTemplatePendingSave(result.value);
      } else {
        if (!selected) return;
        const result = cannedTemplateDeletePayload(
          selected,
          draft.auditReason,
          crypto.randomUUID(),
        );
        if (!result.ok) {
          setConfirmation(null);
          setNotice({ tone: "error", text: validationMessage(result.error) });
          return;
        }
        durable = cannedTemplatePendingDelete(channel, result.value);
      }
      if (!rememberPending(durable)) {
        setConfirmation(null);
        setNotice({ tone: "error", text: t("errors.persistenceUnavailable") });
        return;
      }
    }

    setBusy(true);
    setConfirmation(null);
    setNotice(null);
    const response = await adminCall(
      durable.action === "save" ? "save_canned" : "delete_canned",
      durable.payload,
    );

    if (durable.action === "save") {
      const result = cannedTemplateSaveResponse(response);
      if (result && cannedTemplateSaveConverged(result, durable)) {
        const cleared = rememberPending(null);
        await refreshAfterMutation(result.template);
        setNotice({
          tone: cleared ? "success" : "error",
          text: cleared
            ? result.replayed ? t("notices.saveReplayed") : t("notices.saved")
            : t("errors.persistenceCleanupFailed"),
        });
        setBusy(false);
        return;
      }
    } else {
      const result = cannedTemplateDeleteResponse(response);
      if (result && cannedTemplateDeleteConverged(result, durable)) {
        const cleared = rememberPending(null);
        await refreshAfterMutation(null);
        setNotice({
          tone: cleared ? "success" : "error",
          text: cleared
            ? result.replayed ? t("notices.deleteReplayed") : t("notices.deleted")
            : t("errors.persistenceCleanupFailed"),
        });
        setBusy(false);
        return;
      }
    }

    const conflict = cannedTemplateConflictResponse(response);
    if (conflict && cannedTemplateConflictMatches(conflict, durable)) {
      rememberPending(null);
      const refreshed = await loadPage(channel, query);
      if (!refreshed) {
        setBusy(false);
        return;
      }
      if (conflict.template) {
        setSelected(conflict.template);
        setDraft(fieldsFromTemplate(conflict.template));
      } else {
        setSelected(null);
        setDraft(EMPTY_DRAFT);
      }
      setNotice({ tone: "error", text: t("errors.conflict") });
      setBusy(false);
      return;
    }

    const error = cannedTemplateErrorResponse(response);
    if (!cannedTemplateShouldRetainMutation(error)) {
      rememberPending(null);
      if (error === "canned-template-not-found"
        || error === "canned-template-read-required"
        || error === "canned-template-write-required"
        || error === "admin-write-required") {
        const refreshed = await loadPage(channel, query);
        if (!refreshed) {
          setBusy(false);
          return;
        }
        if (error === "canned-template-not-found") {
          setSelected(null);
          setDraft(EMPTY_DRAFT);
        }
      }
    }
    setNotice({ tone: "error", text: t(`errors.${cannedTemplateErrorKey(error)}`) });
    setBusy(false);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    const normalizedQuery = normalizeCannedTemplateQuery(queryInput);
    if (normalizedQuery === null) {
      setNotice({ tone: "error", text: t("validation.query") });
      return;
    }
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setQueryInput(normalizedQuery);
    setQuery(normalizedQuery);
    setNotice(null);
  }

  if (!hydrated || state === "loading") return <LoadingPanel />;
  if (state === "error" || !list) {
    return <ErrorPanel message={t("loadError")} retry={() => void loadPage(channel, query)} />;
  }

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-secondary" type="button" disabled={busy} onClick={() => void loadPage(channel, query)}>{common("refresh")}</button>}
      />

      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {pending ? (
        <div className="alert alert-info page-alert canned-pending-alert" role="status">
          <div><strong>{t("pending.title")}</strong> {t(`pending.${pending.action}`)}</div>
          {canWrite && storageAvailable ? <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void executeMutation()}>{t("pending.retry")}</button> : null}
        </div>
      ) : null}
      {!canWrite ? <div className="alert alert-info page-alert">{t("viewerNotice")}</div> : null}

      <section className="panel canned-toolbar-panel">
        <div className="panel-body canned-toolbar">
          <div className="segmented-tabs" role="tablist" aria-label={t("channelNavigation")}>{CANNED_TEMPLATE_CHANNELS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={channel === value}
              className={channel === value ? "active" : ""}
              disabled={busy || pending !== null}
              onClick={() => {
                setChannel(value);
                setQuery("");
                setQueryInput("");
                setSelected(null);
                setDraft(EMPTY_DRAFT);
                setNotice(null);
              }}
            >{t(`channels.${value}`)}</button>
          ))}</div>
          <form className="canned-search" onSubmit={applySearch}>
            <label className="field"><span>{t("search.label")}</span><input value={queryInput} maxLength={160} disabled={busy || pending !== null} placeholder={t("search.placeholder")} onChange={(event) => setQueryInput(event.target.value)} /></label>
            <button className="button button-secondary" type="submit" disabled={busy || pending !== null}>{t("search.button")}</button>
          </form>
        </div>
      </section>

      <div className="canned-workspace">
        <section className="panel canned-list-panel">
          <div className="panel-header">
            <div><h2>{t("list.title")}</h2><p>{t("list.copy", { channel: t(`channels.${channel}`), query: list.query || t("search.all") })}</p></div>
            <div className="row-actions"><span className="badge">{t("list.total", { total: list.total })}</span><button className="button button-primary button-small" type="button" disabled={locked} onClick={createTemplate}>{t("editor.new")}</button></div>
          </div>
          <div className="panel-body canned-template-list">
            {list.templates.length === 0 ? <div className="empty-state"><h3>{t("list.emptyTitle")}</h3><p>{t("list.emptyCopy")}</p></div> : list.templates.map((template) => (
              <button
                className={`canned-template-row${selected?.template_id === template.template_id ? " active" : ""}`}
                type="button"
                key={template.template_id}
                disabled={busy || pending !== null}
                onClick={() => selectTemplate(template)}
              >
                <span className={`canned-channel-mark channel-${template.channel}`} aria-hidden="true">{template.channel.slice(0, 1).toUpperCase()}</span>
                <span><strong>{template.name}</strong><small>{template.subject || t("list.noSubject")}</small><small>{t("list.updated", { date: formatDate(template.updated_at, locale, true), revision: template.revision })}</small></span>
              </button>
            ))}
            {list.next_cursor ? <button className="button button-secondary canned-load-more" type="button" disabled={busy || pending !== null} onClick={() => void loadPage(channel, query, list.next_cursor ?? "", true)}>{t("list.loadMore")}</button> : null}
          </div>
        </section>

        <section className="panel canned-editor-panel">
          <div className="panel-header canned-editor-header">
            <div><h2>{selected ? t("editor.editTitle") : t("editor.createTitle")}</h2><p>{selected ? t("editor.editCopy", { revision: selected.revision }) : t("editor.createCopy", { channel: t(`channels.${channel}`) })}</p></div>
            {selected ? <span className="badge">{selected.template_id}</span> : null}
          </div>
          <div className="panel-body canned-editor-layout">
            <div className="canned-editor-form">
              <label className="field"><span>{t("editor.name")}</span><input value={draft.name} maxLength={240} disabled={locked} onChange={(event) => updateDraft({ name: event.target.value })} /><small>{t("limits.name", { count: Array.from(draft.name).length })}</small></label>
              {channel !== "sms" ? <label className="field"><span>{channel === "push" ? t("editor.pushTitle") : t("editor.subject")}</span><input value={draft.subject} maxLength={channel === "push" ? 160 : 400} disabled={locked} onChange={(event) => updateDraft({ subject: event.target.value })} /><small className={channel === "push" && Array.from(draft.subject).length > 40 ? "field-warning" : ""}>{t(channel === "push" ? "limits.pushTitle" : "limits.subject", { count: Array.from(draft.subject).length })}</small></label> : null}
              <label className="field"><span>{channel === "email" ? t("editor.htmlBody") : t("editor.body")}</span><textarea rows={channel === "email" ? 16 : 9} value={draft.body} maxLength={channel === "email" ? 100_000 : channel === "sms" ? 3_200 : 2_000} disabled={locked} onChange={(event) => updateDraft({ body: event.target.value })} /><small className={channel === "sms" && Array.from(draft.body).length > 160 ? "field-warning" : ""}>{t(`limits.${channel}Body`, { count: Array.from(draft.body).length })}</small></label>
              <label className="field"><span>{t("editor.auditReason")}</span><textarea rows={3} value={draft.auditReason} maxLength={1_000} disabled={locked} onChange={(event) => updateDraft({ auditReason: event.target.value })} /><small>{t("limits.auditReason", { count: Array.from(draft.auditReason).length })}</small></label>
              {normalized ? <div className="alert alert-info">{t("editor.normalized")}</div> : null}
              {canWrite && (selected !== null || hasDraftInput) && !materialResult.ok
                ? <div className="alert alert-error">{validationMessage(materialResult.error)}</div>
                : null}
              <div className="row-actions canned-editor-actions">
                {selected ? <button className="button button-danger" type="button" disabled={locked} onClick={prepareDelete}>{t("editor.delete")}</button> : null}
                <button className="button button-primary" type="button" disabled={locked || !contentChanged || !material} onClick={prepareSave}>{selected ? t("editor.reviewUpdate") : t("editor.reviewCreate")}</button>
              </div>
              <p className="field-hint">{t("editor.channelImmutable")}</p>
            </div>
            <CannedTemplatePreview channel={channel} selected={selected} draft={material} />
          </div>
        </section>
      </div>

      {confirmation ? <ConfirmDialog
        title={confirmation === "save" ? selected ? t("confirm.updateTitle") : t("confirm.createTitle") : t("confirm.deleteTitle")}
        copy={confirmation === "delete" && selected
          ? t("confirm.deleteCopy", { name: selected.name, revision: selected.revision, channel: t(`channels.${channel}`) })
          : t(selected ? "confirm.updateCopy" : "confirm.createCopy", { name: material?.name ?? draft.name, revision: selected?.revision ?? 0, channel: t(`channels.${channel}`) })}
        confirmLabel={confirmation === "delete" ? t("confirm.deleteButton") : t("confirm.saveButton")}
        busy={busy}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void executeMutation()}
      /> : null}
    </>
  );
}

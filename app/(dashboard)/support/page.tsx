"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import SupportImageLightbox from "@/components/SupportImageLightbox";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, adminUploadSupportImage } from "@/lib/adminClient";
import {
  supportConversation,
  supportMediaEnabled,
  supportSourceLabel,
  supportThreads,
  type SupportClientContext,
  type SupportConversation,
  type SupportThreadRow,
} from "@/lib/supportInbox";

const THREAD_POLL_MS = 5_000;
const MESSAGE_POLL_MS = 3_000;

function timeLabel(timestamp: number, locale: string): string {
  if (timestamp <= 0) return "";
  return new Date(timestamp * 1000).toLocaleString(locale === "hu" ? "hu-HU" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function newRequestId(): string {
  return crypto.randomUUID();
}

type DiagnosticKey =
  | "source" | "app" | "os" | "device" | "browser" | "screen" | "viewport"
  | "locale" | "timezone" | "appearance" | "accent" | "textSize"
  | "accessibility" | "notifications" | "standalone" | "userAgent";

type DiagnosticValueLabels = {
  reduceMotion: string;
  boldText: string;
  on: string;
  off: string;
  yes: string;
  no: string;
};

function diagnosticFacts(
  context: SupportClientContext,
  labels: DiagnosticValueLabels,
): Array<{ key: DiagnosticKey; value: string }> {
  const facts: Array<{ key: DiagnosticKey; value: string }> = [];
  const add = (key: DiagnosticKey, value: string) => { if (value) facts.push({ key, value }); };
  add("source", supportSourceLabel(context.source));
  add("app", [context.appVersion, context.appBuild ? `(${context.appBuild})` : ""].filter(Boolean).join(" "));
  add("os", [context.osName, context.osVersion].filter(Boolean).join(" "));
  add("device", [context.deviceFamily, context.deviceModel].filter(Boolean).join(" · "));
  add("browser", [context.browserName, context.browserVersion].filter(Boolean).join(" "));
  if (context.screenWidthPx && context.screenHeightPx) {
    add("screen", `${context.screenWidthPx} × ${context.screenHeightPx} px${context.displayScale ? ` @${context.displayScale}×` : ""}`);
  }
  if (context.viewportWidthPx && context.viewportHeightPx) {
    add("viewport", `${context.viewportWidthPx} × ${context.viewportHeightPx} px`);
  }
  add("locale", context.locale);
  add("timezone", context.timezone);
  add("appearance", [context.appearance, context.effectiveAppearance].filter(Boolean).join(" → "));
  add("accent", context.accent);
  add("textSize", context.textSize);
  const accessibility = [
    context.reduceMotion === null
      ? ""
      : `${labels.reduceMotion}: ${context.reduceMotion ? labels.on : labels.off}`,
    context.boldText === null
      ? ""
      : `${labels.boldText}: ${context.boldText ? labels.on : labels.off}`,
  ].filter(Boolean).join(", ");
  add("accessibility", accessibility);
  add("notifications", context.notificationPermission);
  if (context.standalone !== null) add("standalone", context.standalone ? labels.yes : labels.no);
  add("userAgent", context.userAgent);
  return facts;
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path d="M4 5.5h16v13H4zM7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-2 7 4-4 2.8 2.7 2.2-2.2 4 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function SupportInboxPage() {
  const t = useTranslations("support");
  const locale = useLocale();
  const [threads, setThreads] = useState<SupportThreadRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedUid, setSelectedUid] = useState(0);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [imageSending, setImageSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [lightbox, setLightbox] = useState("");
  const [failedImage, setFailedImage] = useState<{
    uid: number; file: File; requestId: string;
  } | null>(null);
  const failedImageRef = useRef<typeof failedImage>(null);
  failedImageRef.current = failedImage;
  const failedTextRef = useRef<{ uid: number; body: string; requestId: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<SupportConversation | null>(null);
  const conversationGenerationRef = useRef(0);
  const activeConversationLoadRef = useRef<number | null>(null);
  const selectedRef = useRef(0);
  selectedRef.current = selectedUid;

  const loadThreads = useCallback(async () => {
    const response = await adminCall("support_threads", { limit: 100 });
    const parsed = response?.success ? supportThreads(response) : null;
    if (!parsed) {
      setState((current) => (current === "ready" ? current : "error"));
      return;
    }
    setMediaEnabled(supportMediaEnabled(response));
    setThreads(parsed);
    setState("ready");
  }, []);

  const loadConversation = useCallback(async (uid: number, generation: number) => {
    if (uid <= 0 || activeConversationLoadRef.current === generation) return;
    activeConversationLoadRef.current = generation;
    try {
      let current = conversationRef.current;
      let messages = current?.messages ?? [];
      let cursor = messages.reduce((maximum, message) => Math.max(maximum, message.smid), 0);

      // Core pages support history at 200 rows. Drain bounded pages now and
      // continue from the received cursor on the next poll if a huge thread
      // exceeds this per-pass cap.
      for (let page = 0; page < 25; page += 1) {
        const response = await adminCall("support_messages", { uid, since: cursor });
        const parsed = response?.success ? supportConversation(response) : null;
        if (
          !parsed
          || selectedRef.current !== uid
          || conversationGenerationRef.current !== generation
        ) return;

        const confirmedRequestIDs = new Set(
          parsed.messages.map((message) => message.requestId).filter(Boolean),
        );
        const failedImageIntent = failedImageRef.current;
        if (
          failedImageIntent
          && failedImageIntent.uid === uid
          && confirmedRequestIDs.has(failedImageIntent.requestId)
        ) {
          setFailedImage(null);
          setSendError("");
        }
        const failedTextIntent = failedTextRef.current;
        if (
          failedTextIntent
          && failedTextIntent.uid === uid
          && confirmedRequestIDs.has(failedTextIntent.requestId)
        ) {
          failedTextRef.current = null;
          setDraft((value) => value.trim() === failedTextIntent.body ? "" : value);
          setSendError("");
        }

        const bySMID = new Map(messages.map((message) => [message.smid, message]));
        parsed.messages.forEach((message) => bySMID.set(message.smid, message));
        messages = [...bySMID.values()].sort((left, right) => left.smid - right.smid);
        current = { ...parsed, messages };
        conversationRef.current = current;
        setConversation(current);
        setMediaEnabled(parsed.mediaEnabled);

        const received = parsed.messages.reduce(
          (maximum, message) => Math.max(maximum, message.smid),
          cursor,
        );
        if (received <= cursor || received >= parsed.lastSmid) break;
        cursor = received;
      }

      if (!current) return;
      const receivedThrough = current.messages.reduce(
        (maximum, message) => Math.max(maximum, message.smid),
        0,
      );
      setThreads((rows) => rows?.map((row) => (
        row.uid === uid
          ? {
              ...row,
              unreadAdmin: receivedThrough >= current!.lastSmid ? 0 : row.unreadAdmin,
              clientContext: current!.clientContext ?? row.clientContext,
            }
          : row
      )) ?? rows);
      window.requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    } finally {
      if (activeConversationLoadRef.current === generation) {
        activeConversationLoadRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadThreads();
    const timer = window.setInterval(() => void loadThreads(), THREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (selectedUid <= 0) return;
    const generation = conversationGenerationRef.current + 1;
    conversationGenerationRef.current = generation;
    conversationRef.current = null;
    setConversation(null);
    setSendError("");
    void loadConversation(selectedUid, generation);
    const timer = window.setInterval(
      () => void loadConversation(selectedUid, generation),
      MESSAGE_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [selectedUid, loadConversation]);

  async function sendText() {
    const body = draft.trim();
    if (!body || sending || imageSending || selectedUid <= 0) return;
    const prior = failedTextRef.current;
    const intent = prior && prior.uid === selectedUid && prior.body === body
      ? prior
      : { uid: selectedUid, body, requestId: newRequestId() };
    failedTextRef.current = intent;
    setSending(true);
    setSendError("");
    const response = await adminCall("support_send", {
      uid: intent.uid,
      body: intent.body,
      request_id: intent.requestId,
    });
    setSending(false);
    if (!response?.success) {
      if (response?.error === "support-idempotency-conflict") failedTextRef.current = null;
      setSendError(t("sendError"));
      return;
    }
    failedTextRef.current = null;
    setDraft((current) => current.trim() === body ? "" : current);
    void loadConversation(intent.uid, conversationGenerationRef.current);
    void loadThreads();
  }

  async function sendImage(intent: { uid: number; file: File; requestId: string }) {
    if (imageSending || sending) return;
    setImageSending(true);
    setSendError("");
    const response = await adminUploadSupportImage(intent.uid, intent.file, intent.requestId);
    setImageSending(false);
    if (!response?.success) {
      const error = typeof response?.error === "string" ? response.error : "";
      const terminal = error === "support-image-under-review"
        || error.includes("invalid")
        || error.includes("too-large")
        || error === "support-idempotency-conflict";
      setFailedImage(terminal ? null : intent);
      setSendError(error === "support-image-under-review" ? t("imageReview") : t("imageSendError"));
      return;
    }
    setFailedImage((current) => current?.requestId === intent.requestId ? null : current);
    void loadConversation(intent.uid, conversationGenerationRef.current);
    void loadThreads();
  }

  function pickImage(file: File | undefined) {
    if (!file || !mediaEnabled || selectedUid <= 0) return;
    const intent = { uid: selectedUid, file, requestId: newRequestId() };
    setFailedImage(intent);
    void sendImage(intent);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !threads) {
    return <ErrorPanel message={t("loadError")} retry={loadThreads} />;
  }

  const selected = threads.find((row) => row.uid === selectedUid) ?? null;
  const clientContext = conversation?.clientContext ?? selected?.clientContext ?? null;
  const busy = sending || imageSending;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <div className="support-workspace">
        <aside className="panel support-thread-list">
          <div className="panel-body">
            {threads.length === 0 ? <p className="support-empty">{t("empty")}</p> : null}
            {threads.map((row) => (
              <button
                type="button"
                key={row.uid}
                className={`support-thread-row${row.uid === selectedUid ? " is-active" : ""}`}
                onClick={() => setSelectedUid(row.uid)}
              >
                <span className="support-thread-avatar">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {row.avatar ? <img src={row.avatar} alt="" /> : <span aria-hidden>👤</span>}
                </span>
                <span className="support-thread-copy">
                  <strong>{row.displayName} <small>#{row.uid}</small></strong>
                  <small>
                    {row.lastSender === "admin" ? `${t("you")}: ` : ""}
                    {row.lastKind === "image" ? t("photo") : row.lastText}
                  </small>
                </span>
                <span className="support-thread-meta">
                  {row.clientContext ? (
                    <span className={`support-source is-${row.clientContext.source}`}>
                      {supportSourceLabel(row.clientContext.source)}
                    </span>
                  ) : null}
                  <time>{timeLabel(row.lastAt, locale)}</time>
                  {row.unreadAdmin > 0 ? <b>{row.unreadAdmin}</b> : null}
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="panel support-conversation">
          {selected === null ? (
            <div className="panel-body support-empty">{t("pickThread")}</div>
          ) : (
            <>
              <header className="support-conversation-header">
                <div><h2>{selected.displayName}</h2><small>#{selected.uid}</small></div>
                {clientContext ? (
                  <details className="support-diagnostics">
                    <summary>
                      <span className={`support-source is-${clientContext.source}`}>
                        {supportSourceLabel(clientContext.source)}
                      </span>
                      {t("diagnostics.title")}
                    </summary>
                    <dl>
                      {diagnosticFacts(clientContext, {
                        reduceMotion: t("diagnostics.values.reduceMotion"),
                        boldText: t("diagnostics.values.boldText"),
                        on: t("diagnostics.values.on"),
                        off: t("diagnostics.values.off"),
                        yes: t("diagnostics.values.yes"),
                        no: t("diagnostics.values.no"),
                      }).map((fact) => (
                        <div key={fact.key}>
                          <dt>{t(`diagnostics.fields.${fact.key}`)}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p>{t("diagnostics.note")}</p>
                  </details>
                ) : <small className="support-no-diagnostics">{t("diagnostics.empty")}</small>}
              </header>
              <div className="support-messages" ref={listRef}>
                {conversation === null ? <div className="fl-loader">{t("loading")}</div> : null}
                {conversation?.messages.map((message) => (
                  <article key={message.id} className={`support-message is-${message.sender}`}>
                    {message.kind === "image" ? (
                      message.imageRemoved ? (
                        <div className="support-image-removed">{t("photoRemoved")}</div>
                      ) : (
                        <button
                          type="button"
                          className="support-image-button"
                          aria-label={t("openPhoto")}
                          onClick={() => setLightbox(message.imageUrl)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={message.imageUrl}
                            alt={t("photoAlt")}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            width={message.imageWidth || undefined}
                            height={message.imageHeight || undefined}
                          />
                        </button>
                      )
                    ) : <p>{message.body}</p>}
                    <footer>
                      {message.clientContext ? (
                        <span className={`support-source is-${message.clientContext.source}`}>
                          {supportSourceLabel(message.clientContext.source)}
                        </span>
                      ) : null}
                      <time>{timeLabel(message.createdAt, locale)}</time>
                    </footer>
                  </article>
                ))}
                {conversation !== null && conversation.messages.length === 0 ? (
                  <p className="support-empty">{t("noMessages")}</p>
                ) : null}
              </div>
              <footer className="support-composer">
                <textarea
                  value={draft}
                  maxLength={4000}
                  placeholder={t("composerPlaceholder")}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendText();
                    }
                  }}
                />
                <div className="support-composer-actions">
                  <span className="support-composer-status" role="status" aria-live="polite">
                    {sendError || (imageSending ? t("imageSending") : "")}
                  </span>
                  {failedImage?.uid === selectedUid && !imageSending ? (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void sendImage(failedImage)}
                    >{t("retryPhoto")}</button>
                  ) : null}
                  {mediaEnabled ? (
                    <>
                      <input
                        ref={fileRef}
                        className="support-file-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          pickImage(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="support-photo-button"
                        aria-label={t("sendPhoto")}
                        title={t("sendPhoto")}
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                      ><PhotoIcon /></button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || draft.trim() === ""}
                    onClick={() => void sendText()}
                  >{sending ? t("sending") : t("send")}</button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
      {lightbox ? (
        <SupportImageLightbox
          src={lightbox}
          alt={t("photoAlt")}
          closeLabel={t("closePhoto")}
          onClose={() => setLightbox("")}
        />
      ) : null}
    </>
  );
}

import {
  CANNED_TEMPLATE_PAGE_SIZE,
  cannedTemplateListPayload,
  cannedTemplateListResponse,
  mergeCannedTemplatePages,
  type CannedTemplate,
  type CannedTemplateListData,
} from "./cannedTemplates";
import {
  mergeOutboundHistoryPages,
  outboundHistoryDetailPayload,
  outboundHistoryPayload,
  outboundHistoryResponse,
  outboundHistoryRowWithDetailState,
  outboundMessageDraftMaterial,
  outboundMessagingAccess,
  outboundMessagingErrorKey,
  outboundMessagingErrorResponse,
  outboundPendingObserved,
  outboundPendingSend,
  outboundPendingSendValue,
  outboundPreviewCoreNow,
  outboundPreviewMsLeft,
  outboundPreviewPayload,
  outboundRecipientPreviewResponse,
  outboundSendPayload,
  type OutboundContentSource,
  type OutboundHistoryDetailEntry,
  type OutboundMessageDraft,
  type OutboundMessageHistoryData,
  type OutboundMessageHistoryDetailData,
  type OutboundMessageSendData,
  type OutboundMessagingChannel,
  type OutboundMessagingErrorKey,
  type OutboundPendingSend,
  type OutboundRecipientPreviewData,
  type OutboundSendOutcome,
} from "./outboundMessaging";

/**
 * What the member page's "Outbound message" panel is doing, as one pure state: who may do what, the
 * reads it wants and what they returned, the operator's draft, and the one send whose outcome may not
 * be known. The component (components/OutboundMessagingPanel.tsx) renders this state, sends the reads
 * it asks for and keeps the pending send in the tab's storage; every rule below is tested without a
 * browser (tests/outboundMessagingPanel.test.mts).
 *
 * - The panel exists only while Core's `admin_me.outbound_messaging` is contract version 1 and ready.
 *   An unreadable answer is an error with a retry, never "no panel" and never a grant. History is read
 *   for every operator the block admits; the recipient preview, the templates and the composer only
 *   with Core's send capability, never from the role.
 * - Every read carries a ticket; an answer to an older ticket is dropped. A read that fails is a named
 *   problem, never an empty list.
 * - A preview is used for a send only within its lifetime, measured on this browser's clock from when
 *   it arrived (Core's clock may differ). One that expired, or that a send was refused over, is asked
 *   again; it is never reused.
 * - A send has one caller-minted request id, stored with the exact payload before it leaves. The same
 *   id and payload are the only thing ever sent again after a timeout, a lost answer or a reload, and
 *   the record is settled only by an observed outcome: Core's answer, a definite refusal, or a history
 *   row carrying that request id. While it is pending nothing else can be sent.
 */

export type OutboundPanelProblem = { error: string | null; key: OutboundMessagingErrorKey };

export type OutboundPanelNotice = {
  tone: "success" | "error" | "info";
  /** A message path under `outboundMessaging`. */
  key: string;
  values?: Record<string, string | number>;
};

type ReadStatus = "idle" | "loading" | "ready" | "failed";

export type OutboundDraft = {
  channel: OutboundMessagingChannel;
  source: OutboundContentSource;
  /** The exact revision chosen from the canned-template list of `channel`. */
  template: CannedTemplate | null;
  subject: string;
  body: string;
  auditReason: string;
};

export type OutboundPanelState = {
  uid: number;
  access:
    | { status: "loading" }
    /** Core serves no version-1 outbound surface: the panel is not shown. */
    | { status: "hidden" }
    | { status: "failed" }
    | { status: "ready"; canSend: boolean; operator: string };
  /** The tab's stored pending send was read and reconciled; from now on storage follows `command`. */
  hydrated: boolean;
  ticket: number;
  history: { ticket: number; status: ReadStatus; more: boolean; data: OutboundMessageHistoryData | null; problem: OutboundPanelProblem | null };
  detail: { ticket: number; messageId: string | null; status: ReadStatus; value: OutboundHistoryDetailEntry | null; problem: OutboundPanelProblem | null };
  preview: {
    ticket: number;
    status: ReadStatus | "expired";
    value: OutboundRecipientPreviewData | null;
    /** When the preview arrived, on this browser's clock (milliseconds). */
    receivedAt: number;
    problem: OutboundPanelProblem | null;
    /** The operator asked to review the send while the preview was being read: review when it arrives. */
    reviewWhenReady: boolean;
  };
  templates: { ticket: number; channel: OutboundMessagingChannel; status: ReadStatus; more: boolean; list: CannedTemplateListData | null; problem: OutboundPanelProblem | null };
  draft: OutboundDraft;
  /** The confirmation step is open: it shows exactly who gets what, on which channel. */
  confirming: boolean;
  command:
    | { status: "idle" }
    | { status: "sending"; pending: OutboundPendingSend }
    /** The outcome is not known. `restored`: found in the tab's storage when the panel mounted. */
    | { status: "doubt"; pending: OutboundPendingSend; problem: OutboundPanelProblem | null; restored: boolean };
  /** Core's answer to the last settled send. */
  result: OutboundMessageSendData | null;
  notice: OutboundPanelNotice | null;
};

export type OutboundPanelAction =
  /** Core's `admin_me` answer, and what the tab's storage held for this member (raw, decoded here). */
  | { type: "accessAnswered"; response: unknown; stored: unknown }
  | { type: "accessAsked" }
  | { type: "historyAsked"; more: boolean }
  | { type: "historyAnswered"; ticket: number; response: unknown }
  | { type: "rowChosen"; messageId: string }
  /** The detail read, already parsed and hash-checked (`outboundHistoryDetailResponse` is asynchronous). */
  | { type: "detailAnswered"; ticket: number; parsed: OutboundMessageHistoryDetailData | null; response: unknown }
  | { type: "previewAsked" }
  | { type: "previewAnswered"; ticket: number; response: unknown; now: number }
  /** The preview's usable lifetime has run out on this browser's clock. */
  | { type: "previewLapsed"; now: number }
  | { type: "templatesAsked"; more: boolean }
  | { type: "templatesAnswered"; ticket: number; response: unknown }
  | { type: "channelChosen"; channel: OutboundMessagingChannel }
  | { type: "sourceChosen"; source: OutboundContentSource }
  | { type: "templateChosen"; templateId: string }
  | { type: "fieldTyped"; field: "subject" | "body" | "auditReason"; value: string }
  | { type: "reviewAsked"; now: number }
  | { type: "reviewClosed" }
  /** The pending send was stored and is leaving now (a first send, or the same request again). */
  | { type: "sendStarted"; pending: OutboundPendingSend }
  /** The browser refused to store the pending send: it was not sent. */
  | { type: "storageRefused" }
  /** The confirmed send could not be built (the preview lapsed, the draft changed): it was not sent. */
  | { type: "sendBlocked"; notice: OutboundPanelNotice }
  | { type: "sendAnswered"; pending: OutboundPendingSend; outcome: OutboundSendOutcome }
  | { type: "noticeDismissed" };

const EMPTY_DRAFT: OutboundDraft = { channel: "email", source: "template", template: null, subject: "", body: "", auditReason: "" };

export function outboundPanelInitial(uid: number): OutboundPanelState {
  return {
    uid,
    access: { status: "loading" },
    hydrated: false,
    ticket: 0,
    history: { ticket: 0, status: "idle", more: false, data: null, problem: null },
    detail: { ticket: 0, messageId: null, status: "idle", value: null, problem: null },
    preview: { ticket: 0, status: "idle", value: null, receivedAt: 0, problem: null, reviewWhenReady: false },
    templates: { ticket: 0, channel: "email", status: "idle", more: false, list: null, problem: null },
    draft: EMPTY_DRAFT,
    confirming: false,
    command: { status: "idle" },
    result: null,
    notice: null,
  };
}

function problemOf(response: unknown): OutboundPanelProblem {
  const error = outboundMessagingErrorResponse(response);
  return { error, key: outboundMessagingErrorKey(error) };
}

function canSend(state: OutboundPanelState): boolean {
  return state.access.status === "ready" && state.access.canSend;
}

function askHistory(state: OutboundPanelState, more: boolean): OutboundPanelState {
  const ticket = state.ticket + 1;
  return { ...state, ticket, history: { ...state.history, ticket, status: "loading", more, problem: null } };
}

function askPreview(state: OutboundPanelState, reviewWhenReady: boolean): OutboundPanelState {
  const ticket = state.ticket + 1;
  return { ...state, ticket, preview: { ...state.preview, ticket, status: "loading", problem: null, reviewWhenReady } };
}

function askTemplates(state: OutboundPanelState, more: boolean): OutboundPanelState {
  const ticket = state.ticket + 1;
  const list = more && state.templates.channel === state.draft.channel ? state.templates.list : null;
  return { ...state, ticket, templates: { ticket, channel: state.draft.channel, status: "loading", more, list, problem: null } };
}

// ------------------------------------------------------------------ the requests the state asks for

export function outboundPanelHistoryRequest(state: OutboundPanelState) {
  const cursor = state.history.more ? state.history.data?.next_cursor ?? null : "";
  return cursor === null ? null : outboundHistoryPayload(state.uid, cursor);
}

export function outboundPanelDetailRequest(state: OutboundPanelState) {
  return state.detail.messageId ? outboundHistoryDetailPayload(state.uid, state.detail.messageId) : null;
}

export function outboundPanelPreviewRequest(state: OutboundPanelState) {
  return outboundPreviewPayload([state.uid]);
}

export function outboundPanelTemplatesRequest(state: OutboundPanelState) {
  const cursor = state.templates.more ? state.templates.list?.next_cursor ?? null : "";
  return cursor === null ? null : cannedTemplateListPayload(state.templates.channel, "", cursor, CANNED_TEMPLATE_PAGE_SIZE);
}

// ------------------------------------------------------------------ the draft and the command

/** The draft as the wire carries it: an exact template revision, or custom content with no template. */
export function outboundPanelWireDraft(draft: OutboundDraft): OutboundMessageDraft {
  const template = draft.source === "template";
  return {
    channel: draft.channel,
    contentSource: draft.source,
    templateId: template ? draft.template?.template_id ?? "" : "",
    templateRevision: template ? draft.template?.revision ?? 0 : 0,
    subject: template || draft.channel === "sms" ? "" : draft.subject,
    body: template ? "" : draft.body,
    // One explicit recipient: an unavailable channel stops the send (recipient conflict) rather than
    // recording a skipped row. Partial sending applies only to a request naming several members.
    allowPartial: 0,
    auditReason: draft.auditReason,
  };
}

type ReviewCheck = { ok: true } | { ok: false; notice: OutboundPanelNotice };

/** Whether the draft and a usable preview allow the confirmation step; why not, otherwise. */
function reviewCheck(state: OutboundPanelState, preview: OutboundRecipientPreviewData): ReviewCheck {
  if (state.draft.source === "template" && !state.draft.template) {
    return { ok: false, notice: { tone: "error", key: "validation.templateRequired" } };
  }
  const material = outboundMessageDraftMaterial(outboundPanelWireDraft(state.draft));
  if (!material.ok) return { ok: false, notice: { tone: "error", key: `validation.${material.error}` } };
  const recipient = preview.recipients.find((row) => row.uid === state.uid);
  if (!recipient) return { ok: false, notice: { tone: "error", key: "validation.preview" } };
  const availability = recipient.channels[state.draft.channel];
  if (availability !== "available") {
    return { ok: false, notice: { tone: "error", key: "notices.channelUnavailable", values: { channel: state.draft.channel, state: availability } } };
  }
  const bucket = state.draft.channel === "email" ? preview.limits.overall : preview.limits.sms_push;
  if (preview.limits.overall.remaining < 1 || bucket.remaining < 1) {
    return { ok: false, notice: { tone: "error", key: "notices.capacityExhausted" } };
  }
  return { ok: true };
}

/** A usable preview for a send now, or null when it must be asked again. */
export function outboundPanelUsablePreview(state: OutboundPanelState, now: number): OutboundRecipientPreviewData | null {
  const preview = state.preview;
  return preview.status === "ready" && preview.value && outboundPreviewMsLeft(preview.value, preview.receivedAt, now) > 0
    ? preview.value
    : null;
}

type SendCommand = { ok: true; pending: OutboundPendingSend } | { ok: false; notice: OutboundPanelNotice };

/**
 * The pending record of a NEW send from the confirmed draft, with the freshly minted request id. The
 * caller stores it before it sends it; a retry never comes here, it sends the stored record again.
 */
export function outboundPanelNewSend(state: OutboundPanelState, requestId: string, now: number): SendCommand {
  if (state.access.status !== "ready" || !state.access.canSend || state.command.status !== "idle" || !state.confirming) {
    return { ok: false, notice: { tone: "error", key: "errors.sendRequired" } };
  }
  const preview = outboundPanelUsablePreview(state, now);
  if (!preview) return { ok: false, notice: { tone: "error", key: "notices.previewLapsed" } };
  const check = reviewCheck(state, preview);
  if (!check.ok) return check;
  const payload = outboundSendPayload(
    preview, [state.uid], outboundPanelWireDraft(state.draft), requestId,
    outboundPreviewCoreNow(preview, state.preview.receivedAt, now),
  );
  if (!payload.ok) return { ok: false, notice: { tone: "error", key: `validation.${payload.error}` } };
  const pending = outboundPendingSend(payload.value, state.access.operator, Math.floor(now / 1000));
  return pending ? { ok: true, pending } : { ok: false, notice: { tone: "error", key: "validation.requestId" } };
}

/** The tab's stored pending send of this member, as the panel adopts it; null when there is none to adopt. */
function restoredPending(stored: unknown, uid: number, operator: string): OutboundPendingSend | null {
  const pending = outboundPendingSendValue(stored);
  return pending && pending.payload.uids === String(uid) && pending.operator === operator ? pending : null;
}

const PREVIEW_REFUSALS: ReadonlySet<string> = new Set([
  "outbound-message-preview-expired",
  "outbound-message-preview-conflict",
  "outbound-message-preview-id-invalid",
  "outbound-message-recipient-conflict",
  "outbound-message-rate-limited",
]);
const TEMPLATE_REFUSALS: ReadonlySet<string> = new Set([
  "outbound-message-template-not-found",
  "outbound-message-template-conflict",
]);

/** The same stored record, whatever the order of its keys (a record read back from storage is rebuilt). */
function samePending(left: OutboundPendingSend, right: OutboundPendingSend): boolean {
  const stable = (value: OutboundPendingSend) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : item);
  return stable(left) === stable(right);
}

function settled(state: OutboundPanelState): OutboundPanelState {
  return { ...state, command: { status: "idle" }, confirming: false };
}

// ------------------------------------------------------------------ the reducer

export function outboundPanelReducer(state: OutboundPanelState, action: OutboundPanelAction): OutboundPanelState {
  switch (action.type) {
    case "accessAsked":
      return state.access.status === "failed" ? { ...state, access: { status: "loading" } } : state;

    case "accessAnswered": {
      if (state.access.status !== "loading") return state;
      const response = action.response as Record<string, unknown> | null;
      const operator = response?.success === true && typeof response.email === "string" ? response.email.trim().toLowerCase() : "";
      const access = operator ? outboundMessagingAccess(response) : { kind: "invalid" as const };
      if (access.kind === "absent") return { ...state, access: { status: "hidden" } };
      if (access.kind === "invalid") return { ...state, access: { status: "failed" } };
      // A pending send is adopted only by the operator who stored it, for this member, while Core still
      // grants the send: nobody else can settle it, and storage drops what is not adopted.
      const pending = access.canSend ? restoredPending(action.stored, state.uid, operator) : null;
      let next: OutboundPanelState = {
        ...state,
        access: { status: "ready", canSend: access.canSend, operator },
        hydrated: true,
        command: pending ? { status: "doubt", pending, problem: null, restored: true } : { status: "idle" },
      };
      next = askHistory(next, false);
      if (access.canSend) next = askTemplates(askPreview(next, false), false);
      return next;
    }

    case "historyAsked": {
      if (state.access.status !== "ready" || state.history.status === "loading") return state;
      if (action.more && !state.history.data?.next_cursor) return state;
      return askHistory(state, action.more);
    }

    case "historyAnswered": {
      if (action.ticket !== state.history.ticket || state.history.status !== "loading") return state;
      const request = outboundPanelHistoryRequest(state);
      const parsed = request ? outboundHistoryResponse(action.response, request) : null;
      if (!parsed) {
        return { ...state, history: { ...state.history, status: "failed", problem: problemOf(action.response) } };
      }
      let data: OutboundMessageHistoryData | null = parsed;
      if (state.history.more) {
        data = state.history.data ? mergeOutboundHistoryPages(state.history.data, parsed) : null;
        // The history changed under the pages (a newer message, another total): read it from the top again.
        if (!data) return askHistory(state, false);
      }
      let next: OutboundPanelState = { ...state, history: { ...state.history, status: "ready", data, problem: null } };
      if (state.command.status === "doubt") {
        const row = outboundPendingObserved(data, state.command.pending);
        if (row) {
          next = { ...settled(next), notice: { tone: "success", key: "notices.earlierRecorded", values: { status: row.status } } };
        }
      }
      return next;
    }

    case "rowChosen": {
      if (state.access.status !== "ready" || !state.history.data?.messages.some((row) => row.message_id === action.messageId)) return state;
      const ticket = state.ticket + 1;
      return { ...state, ticket, detail: { ticket, messageId: action.messageId, status: "loading", value: null, problem: null } };
    }

    case "detailAnswered": {
      if (action.ticket !== state.detail.ticket || state.detail.status !== "loading") return state;
      const message = action.parsed?.message ?? null;
      if (!message || message.message_id !== state.detail.messageId) {
        return { ...state, detail: { ...state.detail, status: "failed", problem: problemOf(action.response) } };
      }
      const history = state.history.data;
      const row = history?.messages.find((entry) => entry.message_id === message.message_id) ?? null;
      const refreshed = row ? outboundHistoryRowWithDetailState(row, message) : null;
      if (row && !refreshed) {
        return { ...state, detail: { ...state.detail, status: "failed", problem: { error: null, key: "storedInvalid" } } };
      }
      return {
        ...state,
        detail: { ...state.detail, status: "ready", value: message, problem: null },
        history: history && refreshed
          ? { ...state.history, data: { ...history, messages: history.messages.map((entry) => entry.message_id === refreshed.message_id ? refreshed : entry) } }
          : state.history,
      };
    }

    case "previewAsked":
      return canSend(state) && state.preview.status !== "loading" && state.command.status === "idle"
        ? askPreview(state, false)
        : state;

    case "previewAnswered": {
      if (action.ticket !== state.preview.ticket || state.preview.status !== "loading") return state;
      const request = outboundPanelPreviewRequest(state);
      const value = request ? outboundRecipientPreviewResponse(action.response, request) : null;
      if (!value) {
        return { ...state, preview: { ...state.preview, status: "failed", value: null, problem: problemOf(action.response), reviewWhenReady: false } };
      }
      const next: OutboundPanelState = {
        ...state,
        preview: { ...state.preview, status: "ready", value, receivedAt: action.now, problem: null, reviewWhenReady: false },
      };
      if (!state.preview.reviewWhenReady || state.command.status !== "idle") return next;
      const check = reviewCheck(next, value);
      return check.ok ? { ...next, confirming: true, notice: null } : { ...next, notice: check.notice };
    }

    case "previewLapsed": {
      if (state.preview.status !== "ready" || !state.preview.value
        || outboundPreviewMsLeft(state.preview.value, state.preview.receivedAt, action.now) > 0) return state;
      const lapsed: OutboundPanelState = { ...state, preview: { ...state.preview, status: "expired" } };
      // An open confirmation cannot send on it any more; a send already leaving is Core's to judge.
      return state.confirming && state.command.status === "idle"
        ? { ...lapsed, confirming: false, notice: { tone: "info", key: "notices.previewLapsed" } }
        : lapsed;
    }

    case "templatesAsked": {
      if (!canSend(state) || state.templates.status === "loading") return state;
      if (action.more && !(state.templates.channel === state.draft.channel && state.templates.list?.next_cursor)) return state;
      return askTemplates(state, action.more);
    }

    case "templatesAnswered": {
      if (action.ticket !== state.templates.ticket || state.templates.status !== "loading") return state;
      const request = outboundPanelTemplatesRequest(state);
      const parsed = request ? cannedTemplateListResponse(action.response, request) : null;
      if (!parsed) {
        return { ...state, templates: { ...state.templates, status: "failed", problem: problemOf(action.response) } };
      }
      const list = state.templates.more && state.templates.list ? mergeCannedTemplatePages(state.templates.list, parsed) : parsed;
      if (!list) return askTemplates(state, false);
      // A first page that no longer lists the chosen revision drops it: only an exact listed revision is sent.
      const chosen = state.draft.template;
      const listed = chosen ? list.templates.find((item) => item.template_id === chosen.template_id) ?? null : null;
      const keep = chosen && (state.templates.more || listed?.revision === chosen.revision) ? chosen : null;
      return {
        ...state,
        templates: { ...state.templates, status: "ready", list, problem: null },
        draft: { ...state.draft, template: keep },
      };
    }

    case "channelChosen": {
      if (!canSend(state) || state.command.status !== "idle" || state.draft.channel === action.channel) return state;
      const next: OutboundPanelState = {
        ...state,
        confirming: false,
        notice: null,
        draft: { ...state.draft, channel: action.channel, template: null, subject: "", body: "" },
      };
      return askTemplates(next, false);
    }

    case "sourceChosen":
      if (state.command.status !== "idle" || state.draft.source === action.source) return state;
      return { ...state, confirming: false, notice: null, draft: { ...state.draft, source: action.source } };

    case "templateChosen": {
      if (state.command.status !== "idle" || state.templates.channel !== state.draft.channel) return state;
      const template = state.templates.list?.templates.find((item) => item.template_id === action.templateId) ?? null;
      return template && template.channel === state.draft.channel
        ? { ...state, confirming: false, notice: null, draft: { ...state.draft, template } }
        : state;
    }

    case "fieldTyped":
      if (state.command.status !== "idle") return state;
      return { ...state, confirming: false, notice: null, draft: { ...state.draft, [action.field]: action.value } };

    case "reviewAsked": {
      if (!canSend(state) || state.command.status !== "idle" || state.confirming) return state;
      if (state.preview.status === "loading") return { ...state, preview: { ...state.preview, reviewWhenReady: true } };
      if (state.draft.source === "template" && !state.draft.template) {
        return { ...state, notice: { tone: "error", key: "validation.templateRequired" } };
      }
      const material = outboundMessageDraftMaterial(outboundPanelWireDraft(state.draft));
      if (!material.ok) return { ...state, notice: { tone: "error", key: `validation.${material.error}` } };
      const preview = outboundPanelUsablePreview(state, action.now);
      // An expired, refused or missing preview is asked again, and the review continues when it arrives.
      if (!preview) return { ...askPreview(state, true), notice: { tone: "info", key: "notices.previewRefreshing" } };
      const check = reviewCheck(state, preview);
      return check.ok ? { ...state, confirming: true, notice: null } : { ...state, notice: check.notice };
    }

    case "reviewClosed":
      return state.command.status === "sending" ? state : { ...state, confirming: false };

    case "sendStarted": {
      if (!canSend(state)) return state;
      const current = state.command;
      // A retry sends exactly the stored record; a new send only from the idle, confirming panel.
      const retry = current.status === "doubt" && samePending(current.pending, action.pending);
      if (!retry && !(current.status === "idle" && state.confirming)) return state;
      return { ...state, command: { status: "sending", pending: action.pending }, notice: null, result: retry ? state.result : null };
    }

    case "storageRefused":
      return state.command.status === "idle"
        ? { ...state, confirming: false, notice: { tone: "error", key: "notices.storageUnavailable" } }
        : state;

    case "sendBlocked":
      return state.command.status === "idle" ? { ...state, confirming: false, notice: action.notice } : state;

    case "sendAnswered": {
      if (state.command.status !== "sending" || !samePending(state.command.pending, action.pending)) return state;
      const outcome = action.outcome;
      if (outcome.kind === "unknown") {
        // Not known: keep the identity, and read history, which settles it if Core admitted the send.
        const doubt: OutboundPanelState = {
          ...state,
          confirming: false,
          command: { status: "doubt", pending: action.pending, problem: { error: outcome.error, key: outcome.key }, restored: false },
        };
        return state.history.status === "loading" ? doubt : askHistory(doubt, false);
      }
      if (outcome.kind === "sent") {
        let next: OutboundPanelState = {
          ...settled(state),
          result: outcome.data,
          notice: { tone: "success", key: outcome.data.replayed ? "notices.replayed" : "notices.sent" },
          draft: { ...state.draft, template: null, subject: "", body: "", auditReason: "" },
        };
        next = askHistory(next, false);
        // The capacity figures moved and the preview was used: it is asked again, never reused.
        return askPreview(next, false);
      }
      let next: OutboundPanelState = { ...settled(state), notice: { tone: "error", key: `errors.${outcome.key}` } };
      if (PREVIEW_REFUSALS.has(outcome.error)) next = askPreview(next, false);
      if (TEMPLATE_REFUSALS.has(outcome.error)) next = askTemplates({ ...next, draft: { ...next.draft, template: null } }, false);
      return askHistory(next, false);
    }

    case "noticeDismissed":
      return { ...state, notice: null };
  }
}

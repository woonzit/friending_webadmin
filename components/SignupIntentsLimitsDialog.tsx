"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  SIGNUP_INTENTS_AUDIT_REASON_MAX_LENGTH,
  SIGNUP_INTENTS_CONTRACT_VERSION,
  SIGNUP_INTENTS_LIMITS_REQUEST_STORAGE_KEY,
  SIGNUP_INTENTS_REVISION_READ_ACTION,
  SIGNUP_INTENTS_SELECTION_LIMITS_ACTION,
  signupIntentsLimitsBody,
  signupIntentsLimitsConflict,
  signupIntentsLimitsIssues,
  signupIntentsLimitsRead,
  signupIntentsLimitsRefused,
  signupIntentsLimitsRequestId,
  signupIntentsLimitsSaved,
  signupIntentsSelectionCeiling,
  type SignupIntentsLimitsDraft,
  type SignupIntentsLimitsField,
  type SignupIntentsLimitsIssue,
  type SignupIntentsLimitsIssueCode,
  type SignupIntentsLimitsReceipt,
  type SignupIntentsSelectionLimits,
  type SignupSystemQuestion,
} from "@/lib/signupPages";

const ISSUE_KEYS: Record<SignupIntentsLimitsIssueCode, string> = {
  "max-range": "limitsIssueMaxRange",
  "min-range": "limitsIssueMinRange",
  "min-above-max": "limitsIssueMinAboveMax",
  "reason-required": "limitsIssueReasonRequired",
  refused: "limitsIssueRefused",
};

type Notice = { tone: "success" | "error"; text: string };

export type SignupIntentsLimitsDialogProps = {
  question: SignupSystemQuestion;
  /**
   * `changed` is true once Core has moved (or proved it already had): the card
   * behind this dialog is then stale and its page must re-read.
   */
  onClose: (changed: boolean) => void;
};

/** A number field must survive being emptied while it is typed in. */
function numberValue(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

function readStoredRequestId(): string | null {
  try {
    return signupIntentsLimitsRequestId(
      window.sessionStorage.getItem(SIGNUP_INTENTS_LIMITS_REQUEST_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function writeStoredRequestId(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(SIGNUP_INTENTS_LIMITS_REQUEST_STORAGE_KEY);
    else window.sessionStorage.setItem(SIGNUP_INTENTS_LIMITS_REQUEST_STORAGE_KEY, value);
  } catch {
    // A browser that refuses storage still gets the in-memory durable id below;
    // it simply cannot survive a reload. That is a weaker guarantee, not a
    // reason to refuse the write.
  }
}

/**
 * D-114. One receipted write for the "What are you looking for?" row's maximum
 * and required minimum.
 *
 * Two axes travel with the command and neither is invented here: the request id
 * is minted once and REUSED until the outcome is certain, so a retry after a
 * lost response is a replay rather than a second decision; and
 * `expected_intents_revision` comes from a catalogue read this browser actually
 * made, because `list_signup_options` serves the pair but no revision.
 */
export default function SignupIntentsLimitsDialog({
  question,
  onClose,
}: SignupIntentsLimitsDialogProps) {
  const t = useTranslations("signupOptions");
  const common = useTranslations("common");
  const locale = useLocale();
  const label = locale.toLowerCase().startsWith("hu") ? question.labels.hu : question.labels.en;
  const ceiling = signupIntentsSelectionCeiling(question);

  const [draft, setDraft] = useState<SignupIntentsLimitsDraft>({
    selection_max: question.max,
    selection_required_min: question.required_min,
    audit_reason: "",
  });
  const [limits, setLimits] = useState<SignupIntentsSelectionLimits | null>(null);
  const [revisionState, setRevisionState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [serverIssues, setServerIssues] = useState<SignupIntentsLimitsIssue[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipt, setReceipt] = useState<SignupIntentsLimitsReceipt | null>(null);
  const [changed, setChanged] = useState(false);
  /**
   * The audit reason is empty when the dialog opens and again after a save, and
   * an untouched empty field is not a mistake the operator has made yet. Local
   * reasons therefore appear once they have edited something or asked to save;
   * a reason Core sent always appears.
   */
  const [showIssues, setShowIssues] = useState(false);
  const requestRef = useRef<string | null>(null);

  const readRevision = useCallback(async () => {
    setRevisionState("loading");
    const response = await adminCall(SIGNUP_INTENTS_REVISION_READ_ACTION, {
      contract_version: SIGNUP_INTENTS_CONTRACT_VERSION,
    });
    const parsed = signupIntentsLimitsRead(response);
    if (!parsed) {
      setRevisionState("error");
      return;
    }
    setLimits(parsed);
    setRevisionState("ready");
  }, []);

  useEffect(() => {
    requestRef.current = readStoredRequestId();
    void readRevision();
  }, [readRevision]);

  const localIssues = signupIntentsLimitsIssues(draft, ceiling);
  const issues = [...(showIssues ? localIssues : []), ...serverIssues];
  const issueFor = (field: SignupIntentsLimitsField): SignupIntentsLimitsIssue | undefined => (
    issues.find((issue) => issue.field === field)
  );

  function issueText(issue: SignupIntentsLimitsIssue): string {
    return t(ISSUE_KEYS[issue.code], { ceiling, max: draft.selection_max });
  }

  function fieldNote(field: SignupIntentsLimitsField, hint: string) {
    const issue = issueFor(field);
    return issue
      ? <small className="field-error" role="alert">{issueText(issue)}</small>
      : <small className="field-hint">{hint}</small>;
  }

  function change(next: Partial<SignupIntentsLimitsDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setServerIssues([]);
    setNotice(null);
    setShowIssues(true);
  }

  async function save() {
    setShowIssues(true);
    if (busy || revisionState !== "ready" || !limits || localIssues.length > 0) return;
    // Durable identity: the id survives an uncertain answer AND a reload, so
    // the retry Core sees is the same command it may already have applied.
    const request = requestRef.current ?? crypto.randomUUID();
    const body = signupIntentsLimitsBody(draft, ceiling, request, limits.intents_revision);
    if (!body) {
      setNotice({ tone: "error", text: t("limitsInvalidDraft") });
      return;
    }
    requestRef.current = request;
    writeStoredRequestId(request);
    setBusy(true);
    setNotice(null);
    setServerIssues([]);
    const response = await adminCall(SIGNUP_INTENTS_SELECTION_LIMITS_ACTION, body);
    setBusy(false);

    const saved = signupIntentsLimitsSaved(response);
    if (saved) {
      requestRef.current = null;
      writeStoredRequestId(null);
      setLimits(saved.limits);
      setDraft({
        selection_max: saved.limits.selection_max,
        selection_required_min: saved.limits.selection_required_min,
        audit_reason: "",
      });
      setReceipt({ request_id: request, limits: saved.limits, replayed: saved.replayed });
      setChanged(true);
      setShowIssues(false);
      setNotice({
        tone: "success",
        text: saved.replayed ? t("limitsReplayed") : t("limitsSaved"),
      });
      return;
    }

    const conflict = signupIntentsLimitsConflict(response);
    if (conflict) {
      // The 409 carries the CURRENT singleton, so authority is recovered from
      // the refusal itself: adopt it, tell the operator, and let them re-apply.
      requestRef.current = null;
      writeStoredRequestId(null);
      setLimits(conflict);
      setDraft({
        selection_max: conflict.selection_max,
        selection_required_min: conflict.selection_required_min,
        audit_reason: draft.audit_reason,
      });
      setReceipt(null);
      setChanged(true);
      setNotice({ tone: "error", text: t("limitsConflict") });
      return;
    }

    if (signupIntentsLimitsRefused(response)) {
      // A 422 is terminal — the pure parser refused before storage was read, so
      // nothing was written and the id must not be replayed.
      //
      // Core's refusal carries NO per-field details, and this draft already
      // satisfied every rule the console knows (Save is disabled otherwise), so
      // the honest per-field statement is that Core refused these two numbers.
      // Both are named because the rule that binds them is about the pair.
      requestRef.current = null;
      writeStoredRequestId(null);
      setServerIssues([
        { field: "selection_max", code: "refused" },
        { field: "selection_required_min", code: "refused" },
      ]);
      setNotice({ tone: "error", text: t("limitsRefused") });
      return;
    }

    // Unknown outcome: the durable id is KEPT so the next attempt is a replay.
    setNotice({ tone: "error", text: t("limitsSaveError") });
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose(changed);
      }}
    >
      <section
        className="dialog dialog-small signup-limits-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-intents-limits-title"
      >
        <div className="dialog-header">
          <div>
            <h2 id="signup-intents-limits-title">{t("limitsTitle")}</h2>
            <p>{t("limitsCopy", { question: label, ceiling })}</p>
          </div>
          <button
            className="dialog-close"
            type="button"
            disabled={busy}
            onClick={() => onClose(changed)}
            aria-label={common("close")}
          >
            ×
          </button>
        </div>

        <div className="dialog-body form-stack">
          {revisionState === "loading" ? (
            <p className="page-subtitle">{t("limitsRevisionLoading")}</p>
          ) : null}
          {revisionState === "error" ? (
            <div className="alert alert-error" role="alert">{t("limitsRevisionError")}</div>
          ) : null}
          {notice ? (
            <div
              className={`alert ${notice.tone === "success" ? "alert-success" : "alert-error"}`}
              role={notice.tone === "success" ? "status" : "alert"}
            >
              {notice.text}
            </div>
          ) : null}

          <label className="field">
            <span>{t("limitsMax")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={ceiling}
              step={1}
              value={Number.isFinite(draft.selection_max) ? draft.selection_max : ""}
              disabled={busy || revisionState !== "ready"}
              onChange={(event) => change({ selection_max: numberValue(event.target.value) })}
            />
            {fieldNote("selection_max", t("limitsMaxHint", { ceiling }))}
          </label>

          <label className="field">
            <span>{t("limitsMin")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={ceiling}
              step={1}
              value={Number.isFinite(draft.selection_required_min) ? draft.selection_required_min : ""}
              disabled={busy || revisionState !== "ready"}
              onChange={(event) => change({
                selection_required_min: numberValue(event.target.value),
              })}
            />
            {fieldNote("selection_required_min", t("limitsMinHint"))}
          </label>

          <label className="field">
            <span>{t("limitsReason")}</span>
            <input
              maxLength={SIGNUP_INTENTS_AUDIT_REASON_MAX_LENGTH}
              value={draft.audit_reason}
              disabled={busy || revisionState !== "ready"}
              onChange={(event) => change({ audit_reason: event.target.value })}
            />
            {fieldNote("audit_reason", t("limitsReasonHint", {
              count: [...draft.audit_reason].length,
              max: SIGNUP_INTENTS_AUDIT_REASON_MAX_LENGTH,
            }))}
          </label>

          {receipt ? (
            <dl className="detail-list signup-limits-receipt">
              <div className="detail-row">
                <dt>{t("limitsReceiptOutcome")}</dt>
                <dd>{receipt.replayed ? t("limitsReceiptReplayed") : t("limitsReceiptApplied")}</dd>
              </div>
              <div className="detail-row">
                <dt>{t("limitsReceiptRequestId")}</dt>
                <dd><code>{receipt.request_id}</code></dd>
              </div>
              <div className="detail-row">
                <dt>{t("limitsReceiptLimits")}</dt>
                <dd>{t("selectionRange", {
                  min: receipt.limits.selection_required_min,
                  max: receipt.limits.selection_max,
                })}</dd>
              </div>
              <div className="detail-row">
                <dt>{t("limitsReceiptRevision")}</dt>
                <dd>{receipt.limits.intents_revision}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => onClose(changed)}
          >
            {common("close")}
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={busy || revisionState !== "ready" || localIssues.length > 0}
            onClick={() => void save()}
          >
            {busy ? common("saving") : common("save")}
          </button>
        </div>
      </section>
    </div>
  );
}

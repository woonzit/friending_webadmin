"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatNumber } from "@/lib/format";
import type { FriendingGoPendingEmail, FriendingGoRunProgress } from "@/lib/friendinggoConsole";

/**
 * The state of the tab's one email command, shared by the Email and Sent tabs: while it runs, what it is
 * doing (how far a send is, or what it waits for); when its outcome is unknown, the choice between
 * retrying the same request and forgetting it (the page asks first, with `FriendingGoDiscardDialog`).
 */
export default function FriendingGoCommandStatus({
  pending,
  busy,
  progress,
  canRetry,
  onRetry,
  onAskDiscard,
}: {
  pending: FriendingGoPendingEmail | null;
  busy: boolean;
  progress: FriendingGoRunProgress | null;
  canRetry: boolean;
  onRetry: () => void;
  onAskDiscard: () => void;
}) {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  const num = (value: number) => formatNumber(value, locale);
  const command = pending?.command ?? null;
  if (!command) return null;
  const subject = command.mode === "resume" ? "" : command.subject;
  return (
    <>
      {busy ? (
        <div className="alert alert-info page-alert friendinggo-progress" role="status" aria-live="polite">
          {progress?.waitSeconds != null
            ? progress.waitReason === "timeout"
              ? t("email.progress.timeout", { seconds: num(progress.waitSeconds) })
              : t(`email.progress.waiting.${command.mode}`, { seconds: num(progress.waitSeconds) })
            : progress?.progress
              ? t("email.progress.sending", { processed: num(progress.progress.processed), total: num(progress.progress.total) })
              : t(`email.progress.working.${command.mode}`)}
          {progress?.progress ? (
            <progress max={progress.progress.total} value={progress.progress.processed}>
              {num(progress.progress.processed)} / {num(progress.progress.total)}
            </progress>
          ) : null}
        </div>
      ) : (
        <div className="alert alert-warning page-alert friendinggo-pending" role="status">
          <div>
            <strong>{t("pending.title")}</strong>{" "}
            {t(`email.pending.${command.mode}`, { subject })} {t("email.pending.copy")}
          </div>
          <div className="row-actions">
            <button className="button button-primary button-small" type="button" disabled={!canRetry} onClick={onRetry}>{t("pending.retry")}</button>
            <button className="button button-secondary button-small" type="button" onClick={onAskDiscard}>{t("pending.discard")}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Forgetting an unknown command names what may happen: a send forgotten and written again mails everyone twice. */
export function FriendingGoDiscardDialog({ pending, onCancel, onConfirm }: {
  pending: FriendingGoPendingEmail;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("friendinggo");
  const mode = pending.command.mode;
  return (
    <ConfirmDialog
      title={t("email.discard.title")}
      copy={t(mode === "send" ? "email.discard.copySend" : mode === "resume" ? "email.discard.copyResume" : "email.discard.copy")}
      confirmLabel={t("email.discard.confirm")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export default function ConfirmDialog({
  title,
  copy,
  confirmLabel,
  busyLabel,
  busy,
  tone = "danger",
  confirmDisabled = false,
  error = "",
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  copy: string;
  confirmLabel: string;
  /** Defaults to a neutral "Working…". Pass `common("deleting")` only when it really deletes. */
  busyLabel?: string;
  busy?: boolean;
  /** `primary` for a confirmation that removes nothing. */
  tone?: "danger" | "primary";
  confirmDisabled?: boolean;
  /** Already localized failure text, announced when it appears. */
  error?: string;
  /** Optional fields (a note, a reason) rendered under the copy. */
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const common = useTranslations("common");
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-header">
          <h2 id="confirm-title">{title}</h2>
          <button className="dialog-close" onClick={onCancel} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body">
          <p className="page-subtitle">{copy}</p>
          {children}
          {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} className="button button-secondary" onClick={onCancel} disabled={busy}>{common("cancel")}</button>
          <button
            className={`button ${tone === "primary" ? "button-primary" : "button-danger"}`}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? (busyLabel ?? common("working")) : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

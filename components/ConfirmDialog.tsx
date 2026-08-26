"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export default function ConfirmDialog({
  title,
  copy,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  copy: string;
  confirmLabel: string;
  /** Defaults to a neutral "Working…". Pass `common("deleting")` only when it really deletes. */
  busyLabel?: string;
  busy?: boolean;
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
        <div className="dialog-body"><p className="page-subtitle">{copy}</p></div>
        <div className="dialog-actions">
          <button ref={cancelRef} className="button button-secondary" onClick={onCancel} disabled={busy}>{common("cancel")}</button>
          <button className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? common("working")) : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

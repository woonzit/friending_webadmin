"use client";

import { useTranslations } from "next-intl";

export function LoadingPanel() {
  const common = useTranslations("common");
  return (
    <div className="panel loading-state" role="status">
      <div>
        <div className="spinner" aria-hidden="true" />
        <span className="sr-only">{common("loading")}</span>
      </div>
    </div>
  );
}

export function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  const common = useTranslations("common");
  return (
    <div className="panel error-state" role="alert">
      <div className="error-state-inner">
        <h3>{message}</h3>
        <button className="button button-secondary" onClick={retry}>{common("retry")}</button>
      </div>
    </div>
  );
}

export function EmptyPanel({ title, copy }: { title: string; copy?: string }) {
  return (
    <div className="panel empty-state">
      <div className="empty-state-inner">
        <h3>{title}</h3>
        {copy && <p>{copy}</p>}
      </div>
    </div>
  );
}

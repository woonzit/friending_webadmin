"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { adminHelpPageForPath } from "@/lib/adminHelp";

type CopyRecord = Record<string, unknown>;

function record(value: unknown): CopyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CopyRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string[] {
  const row = record(value);
  if (!row) return [];
  return Object.keys(row)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((key) => text(row[key]))
    .filter(Boolean);
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.08c-.9.52-1.4 1.04-1.4 2.17" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function AdminHelp() {
  const pathname = usePathname();
  const t = useTranslations("adminHelp");
  const page = adminHelpPageForPath(pathname);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const instanceId = useId().replace(/:/g, "");

  const pageCopy = page ? record(t.raw(`pages.${page.key}`)) : null;
  const pageTitle = text(pageCopy?.title) || t("unavailableTitle");
  const summary = text(pageCopy?.summary) || t("unavailableCopy");
  const steps = textList(pageCopy?.steps);
  const sectionCopies = record(pageCopy?.sections);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const titleId = `${instanceId}-admin-help-title`;
  const summaryId = `${instanceId}-admin-help-summary`;

  return (
    <>
      <button
        ref={triggerRef}
        className="admin-help-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("openLabel", { page: pageTitle })}
        onClick={() => setOpen(true)}
      >
        <HelpIcon />
        <span>{t("button")}</span>
      </button>

      {open && (
        <div
          className="admin-help-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            className="admin-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={summaryId}
          >
            <header className="admin-help-header">
              <div className="admin-help-heading">
                <span className="admin-help-heading-icon"><HelpIcon /></span>
                <div>
                  <p className="eyebrow">{t("eyebrow")}</p>
                  <h2 id={titleId}>{pageTitle}</h2>
                </div>
              </div>
              <button
                ref={closeRef}
                className="dialog-close"
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("closeLabel")}
              >×</button>
            </header>

            <div className="admin-help-body">
              <section className="admin-help-overview" aria-labelledby={`${instanceId}-overview-title`}>
                <p className="eyebrow">{t("overviewEyebrow")}</p>
                <h3 id={`${instanceId}-overview-title`}>{t("overviewTitle")}</h3>
                <p id={summaryId}>{summary}</p>
              </section>

              {steps.length > 0 && (
                <section className="admin-help-start" aria-labelledby={`${instanceId}-start-title`}>
                  <h3 id={`${instanceId}-start-title`}>{t("startTitle")}</h3>
                  <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
                </section>
              )}

              {page && page.sections.length > 0 && (
                <>
                  <nav className="admin-help-nav" aria-label={t("sectionNavigationLabel")}>
                    {page.sections.map((sectionKey) => {
                      const copy = record(sectionCopies?.[sectionKey]);
                      const title = text(copy?.title);
                      return title ? (
                        <a key={sectionKey} href={`#${instanceId}-admin-help-${sectionKey}`}>{title}</a>
                      ) : null;
                    })}
                  </nav>

                  <section className="admin-help-sections" aria-labelledby={`${instanceId}-sections-title`}>
                    <div className="admin-help-sections-heading">
                      <p className="eyebrow">{t("sectionsEyebrow")}</p>
                      <h3 id={`${instanceId}-sections-title`}>{t("sectionsTitle")}</h3>
                      <p>{t("sectionsCopy")}</p>
                    </div>
                    {page.sections.map((sectionKey, index) => {
                      const copy = record(sectionCopies?.[sectionKey]);
                      const title = text(copy?.title);
                      const purpose = text(copy?.purpose);
                      const actions = textList(copy?.actions);
                      const guidance = text(copy?.guidance);
                      if (!title || !purpose || actions.length === 0 || !guidance) return null;
                      return (
                        <article
                          className="admin-help-section-card"
                          id={`${instanceId}-admin-help-${sectionKey}`}
                          key={sectionKey}
                        >
                          <header>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <div><h4>{title}</h4><p>{purpose}</p></div>
                          </header>
                          <div className="admin-help-section-actions">
                            <strong>{t("actionsTitle")}</strong>
                            <ul>{actions.map((action) => <li key={action}>{action}</li>)}</ul>
                          </div>
                          <aside><strong>{t("guidanceTitle")}</strong> {guidance}</aside>
                        </article>
                      );
                    })}
                  </section>
                </>
              )}

              <aside className="admin-help-boundary">
                <h3>{t("boundaryTitle")}</h3>
                <p>{t("roleBoundary")}</p>
                <p>{t("sourceBoundary")}</p>
              </aside>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import React, { useMemo, useState, type DragEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  SIGNUP_PAGE_ITEM_LIMIT,
  SIGNUP_PAGE_LIMIT,
  addItem,
  moveItem,
  movePage,
  removeItem,
  removePage,
  setHidden,
  setRequired,
  setSubtitle,
  setTitle,
  type SignupDroppedItem,
  type SignupEligibleField,
  type SignupPageIssue,
  type SignupPageIssueCode,
  type SignupPageLayout,
  type SignupSystemQuestion,
} from "@/lib/signupPages";

type Dragged =
  | { kind: "page"; pageKey: string }
  | { kind: "item"; fieldKey: string };

const ISSUE_KEYS: Record<SignupPageIssueCode, string> = {
  "page-limit": "issuePageLimit",
  "item-limit": "issueItemLimit",
  "unknown-field": "issueUnknownField",
  "field-not-selectable": "issueFieldNotSelectable",
  "field-archived": "issueFieldArchived",
  "duplicate-field": "issueDuplicateField",
  "blank-title": "issueBlankTitle",
};

function localeText(value: { en: string; hu: string }, locale: string): string {
  return locale.toLowerCase().startsWith("hu") ? value.hu : value.en;
}

function fallbackLetter(label: string): string {
  return Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "?";
}

function dragData(event: DragEvent, identity: string) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", identity);
}

export type SignupPageComposerProps = {
  layout: SignupPageLayout;
  eligibleFields: SignupEligibleField[];
  systemQuestions: SignupSystemQuestion[];
  droppedItems: SignupDroppedItem[];
  issues: SignupPageIssue[];
  busy: boolean;
  dirty: boolean;
  notice?: string;
  error?: string;
  onChange: (layout: SignupPageLayout) => void;
  onCreatePage: () => void;
  onReset: () => void;
  onSave: () => void;
};

export default function SignupPageComposer({
  layout,
  eligibleFields,
  systemQuestions,
  droppedItems,
  issues,
  busy,
  dirty,
  notice = "",
  error = "",
  onChange,
  onCreatePage,
  onReset,
  onSave,
}: SignupPageComposerProps) {
  const t = useTranslations("signupOptions");
  const locale = useLocale();
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const fieldMap = useMemo(
    () => new Map(eligibleFields.map((field) => [field.field_key, field])),
    [eligibleFields],
  );
  const placed = useMemo(
    () => new Set(layout.pages.flatMap((page) => page.items.map((item) => item.field_key))),
    [layout.pages],
  );
  const palette = eligibleFields.filter((field) => !placed.has(field.field_key));

  function issueMessage(issue: SignupPageIssue): string {
    return t(ISSUE_KEYS[issue.code], { field: issue.field_key ?? "" });
  }

  function placeItem(fieldKey: string, pageKey: string, index?: number) {
    const alreadyPlaced = layout.pages.some((page) => (
      page.items.some((item) => item.field_key === fieldKey)
    ));
    onChange(alreadyPlaced
      ? moveItem(layout, fieldKey, pageKey, index)
      : addItem(layout, pageKey, fieldKey, index));
  }

  function dropOnPage(pageKey: string, pageIndex: number) {
    if (dragged?.kind === "page") onChange(movePage(layout, dragged.pageKey, pageIndex));
    if (dragged?.kind === "item") placeItem(dragged.fieldKey, pageKey);
    setDragged(null);
  }

  function fieldIcon(field: SignupEligibleField | undefined, fieldKey: string) {
    const label = field ? localeText(field.labels, locale) : fieldKey;
    return (
      <span className="presentation-source-icon" aria-hidden="true">
        {field?.icon.url ? <img src={field.icon.url} alt="" /> : <b>{fallbackLetter(label)}</b>}
      </span>
    );
  }

  function answerPreview(field: SignupEligibleField | undefined) {
    if (!field) return null;
    return (
      <div className="signup-answer-preview" aria-label={t("answersPreview")}>
        <span>{t("answersPreview")}</span>
        <ul>{field.options.map((option) => (
          <li key={option.key}>{localeText(option.labels, locale)}</li>
        ))}</ul>
      </div>
    );
  }

  const untargetedIssues = issues.filter((issue) => !issue.page_key);

  return (
    <>
      {notice ? <div className="alert alert-success page-alert" role="status">{notice}</div> : null}

      <section className="panel signup-system-panel">
        <div className="panel-header">
          <div><h2>{t("systemTitle")}</h2><p>{t("systemCopy")}</p></div>
          <span className="badge">{systemQuestions.length}</span>
        </div>
        <div className="signup-system-grid">
          {systemQuestions.map((question) => {
            const label = localeText(question.labels, locale);
            return (
              <article className="signup-system-card" key={question.key} data-system-question={question.key}>
                <span className="presentation-source-icon" aria-hidden="true">
                  {question.icon.url ? <img src={question.icon.url} alt="" /> : <b>{fallbackLetter(label)}</b>}
                </span>
                <div className="signup-system-copy">
                  <div><strong>{label}</strong><code>{question.key}</code></div>
                  <span className="badge badge-warning">{t("systemLocked")}</span>
                  <ul>{question.options.map((option) => (
                    <li key={option.key}>{localeText(option.labels, locale)}</li>
                  ))}</ul>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="signup-pages-workspace" aria-labelledby="signup-pages-title">
        <div className="signup-pages-heading">
          <div>
            <h2 id="signup-pages-title">{t("pagesTitle")}</h2>
            <p>{t("pagesCopy")}</p>
          </div>
          <div className="row-actions">
            <span className="badge">{t("pageCount", { used: layout.pages.length, max: SIGNUP_PAGE_LIMIT })}</span>
            {layout.pages.length > 0 ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || layout.pages.length >= SIGNUP_PAGE_LIMIT}
                onClick={onCreatePage}
              >
                {t("addPage")}
              </button>
            ) : null}
          </div>
        </div>

        {untargetedIssues.length > 0 ? (
          <ul className="signup-inline-errors" aria-label={t("validationErrors")}>
            {untargetedIssues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issueMessage(issue)}</li>)}
          </ul>
        ) : null}

        {droppedItems.length > 0 ? (
          <div className="signup-dropped-notice" role="status">
            <strong>{t("droppedTitle")}</strong>
            <p>{t("droppedNotice", {
              count: droppedItems.length,
              keys: droppedItems.map((item) => item.field_key).join(", "),
            })}</p>
          </div>
        ) : null}

        {layout.pages.length === 0 ? (
          <div className="panel signup-pages-empty-state">
            <div className="empty-state">
              <h3>{t("emptyTitle")}</h3>
              <p>{t("emptyCopy")}</p>
              <button className="button button-primary" type="button" disabled={busy} onClick={onCreatePage}>
                {t("firstPage")}
              </button>
            </div>
          </div>
        ) : (
          <div className="signup-page-list">
            {layout.pages.map((page, pageIndex) => {
              const pageIssues = issues.filter((issue) => issue.page_key === page.key && !issue.field_key);
              const pageName = page.title[locale.toLowerCase().startsWith("hu") ? "hu" : "en"].trim()
                || t("pageFallback", { number: pageIndex + 1 });
              return (
                <article
                  className={`panel signup-page-card${page.hidden ? " is-hidden" : ""}`}
                  key={page.key}
                  draggable={!busy}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    dragData(event, `page:${page.key}`);
                    setDragged({ kind: "page", pageKey: page.key });
                  }}
                  onDragEnd={() => setDragged(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    dropOnPage(page.key, pageIndex);
                  }}
                >
                  <div className="signup-page-card-header">
                    <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                    <div>
                      <span>{t("pagePosition", { number: pageIndex + 1 })}</span>
                      <h3>{pageName}</h3>
                      <code>{page.key}</code>
                    </div>
                    <div className="signup-page-card-actions">
                      <span className="badge">{t("itemCount", { count: page.items.length })}</span>
                      {page.hidden ? <span className="badge badge-inactive">{t("hiddenBadge")}</span> : null}
                      <button className="icon-action" type="button" disabled={busy || pageIndex === 0} onClick={() => onChange(movePage(layout, page.key, pageIndex - 1))} aria-label={t("movePageUp", { name: pageName })}>↑</button>
                      <button className="icon-action" type="button" disabled={busy || pageIndex === layout.pages.length - 1} onClick={() => onChange(movePage(layout, page.key, pageIndex + 1))} aria-label={t("movePageDown", { name: pageName })}>↓</button>
                      <button className="text-button danger-text" type="button" disabled={busy} onClick={() => onChange(removePage(layout, page.key))}>{t("removePage")}</button>
                    </div>
                  </div>

                  <div className="form-grid profile-layout-copy-fields signup-page-copy-fields">
                    <label className="field"><span>{t("pageTitleEn")}</span><input maxLength={80} disabled={busy} value={page.title.en} onChange={(event) => onChange(setTitle(layout, page.key, "en", event.target.value))} /></label>
                    <label className="field"><span>{t("pageTitleHu")}</span><input maxLength={80} disabled={busy} value={page.title.hu} onChange={(event) => onChange(setTitle(layout, page.key, "hu", event.target.value))} /></label>
                    <label className="field"><span>{t("pageSubtitleEn")}</span><input maxLength={240} disabled={busy} value={page.subtitle.en} onChange={(event) => onChange(setSubtitle(layout, page.key, "en", event.target.value))} /></label>
                    <label className="field"><span>{t("pageSubtitleHu")}</span><input maxLength={240} disabled={busy} value={page.subtitle.hu} onChange={(event) => onChange(setSubtitle(layout, page.key, "hu", event.target.value))} /></label>
                    <label className="checkbox-field field-full">
                      <input type="checkbox" checked={page.hidden} disabled={busy} onChange={(event) => onChange(setHidden(layout, page.key, event.target.checked))} />
                      <span>{t("hiddenToggle")}</span>
                    </label>
                  </div>

                  {pageIssues.length > 0 ? (
                    <ul className="signup-inline-errors">
                      {pageIssues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issueMessage(issue)}</li>)}
                    </ul>
                  ) : null}

                  <ol className="presentation-placement-list signup-page-items">
                    {page.items.map((item, itemIndex) => {
                      const field = fieldMap.get(item.field_key);
                      const label = field ? localeText(field.labels, locale) : item.field_key;
                      const itemIssues = issues.filter((issue) => (
                        issue.page_key === page.key && issue.field_key === item.field_key
                      ));
                      return (
                        <li
                          className="presentation-source-card signup-page-item"
                          key={item.field_key}
                          draggable={!busy}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            dragData(event, `field:${item.field_key}`);
                            setDragged({ kind: "item", fieldKey: item.field_key });
                          }}
                          onDragEnd={() => setDragged(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (dragged?.kind === "item") {
                              placeItem(dragged.fieldKey, page.key, itemIndex);
                              setDragged(null);
                            } else if (dragged?.kind === "page") {
                              dropOnPage(page.key, pageIndex);
                            }
                          }}
                        >
                          <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                          {fieldIcon(field, item.field_key)}
                          <div className="signup-page-item-copy">
                            <div><strong>{label}</strong><code>{item.field_key}</code></div>
                            {answerPreview(field)}
                            {itemIssues.length > 0 ? (
                              <ul className="signup-inline-errors signup-item-errors">
                                {itemIssues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issueMessage(issue)}</li>)}
                              </ul>
                            ) : null}
                          </div>
                          <div className="signup-page-item-controls">
                            <label className="checkbox-field signup-required-toggle">
                              <input type="checkbox" checked={item.required} disabled={busy} onChange={(event) => onChange(setRequired(layout, item.field_key, event.target.checked))} />
                              <span>{t("requiredToggle")}</span>
                            </label>
                            <div className="row-actions">
                              <button className="icon-action" type="button" disabled={busy || itemIndex === 0} onClick={() => onChange(moveItem(layout, item.field_key, page.key, itemIndex - 1))} aria-label={t("moveItemUp", { name: label })}>↑</button>
                              <button className="icon-action" type="button" disabled={busy || itemIndex === page.items.length - 1} onClick={() => onChange(moveItem(layout, item.field_key, page.key, itemIndex + 1))} aria-label={t("moveItemDown", { name: label })}>↓</button>
                              <button className="text-button danger-text" type="button" disabled={busy} onClick={() => onChange(removeItem(layout, item.field_key))}>{t("removeItem")}</button>
                            </div>
                            <Link className="text-button" href={`/profile-fields#${encodeURIComponent(field?.profile_field ?? item.field_key)}`}>{t("editAnswers")}</Link>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {page.items.length === 0 ? <div className="presentation-empty-drop signup-page-empty-drop">{t("pageEmpty")}</div> : null}
                </article>
              );
            })}
          </div>
        )}

        <section className="panel signup-palette-panel">
          <div className="panel-header">
            <div><h3>{t("paletteTitle")}</h3><p>{t("paletteCopy")}</p></div>
            <span className="badge">{palette.length}</span>
          </div>
          {palette.length > 0 ? (
            <div className="presentation-source-inventory signup-palette-grid">
              {palette.map((field) => {
                const label = localeText(field.labels, locale);
                return (
                  <article
                    className="presentation-inventory-card signup-palette-card"
                    draggable={!busy && layout.pages.length > 0}
                    onDragStart={(event) => {
                      dragData(event, `field:${field.field_key}`);
                      setDragged({ kind: "item", fieldKey: field.field_key });
                    }}
                    onDragEnd={() => setDragged(null)}
                    key={field.field_key}
                  >
                    {fieldIcon(field, field.field_key)}
                    <div className="signup-page-item-copy">
                      <div><strong>{label}</strong><code>{field.field_key}</code></div>
                      {answerPreview(field)}
                      <Link className="text-button" href={`/profile-fields#${encodeURIComponent(field.profile_field)}`}>{t("editAnswers")}</Link>
                    </div>
                    <div className="signup-palette-actions">
                      {layout.pages.map((page, pageIndex) => (
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          key={page.key}
                          disabled={busy || page.items.length >= SIGNUP_PAGE_ITEM_LIMIT}
                          onClick={() => placeItem(field.field_key, page.key)}
                        >
                          {t("addHere", { page: pageIndex + 1 })}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className="empty-state signup-palette-empty"><p>{t("paletteEmpty")}</p></div>}
        </section>
      </section>

      <section className="panel presentation-toolbar-panel signup-composer-toolbar">
        <div className="panel-body presentation-toolbar">
          <div><strong>{t("layoutRevision", { revision: layout.revision })}</strong><p>{t("draftCopy")}</p></div>
          <div className="row-actions">
            <button className="button button-secondary" type="button" disabled={!dirty || busy} onClick={onReset}>{t("discardDraft")}</button>
            <button className="button button-primary" type="button" disabled={!dirty || busy || issues.length > 0} onClick={onSave}>{busy ? t("savingChanges") : t("saveChanges")}</button>
          </div>
        </div>
        {error ? <div className="alert alert-error presentation-page-alert" role="alert">{error}</div> : null}
      </section>
    </>
  );
}

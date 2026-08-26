"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  emptyLocaleContent,
  HELP_BLOCK_TYPES,
  HELP_CALLOUT_TONES,
  HELP_LOCALES,
  HELP_RUN_EMPHASES,
  helpCmsPayload,
  localesWire,
  type HelpArticle,
  type HelpBlock,
  type HelpCategory,
  type HelpCmsPayload,
  type HelpLocale,
  type HelpRun,
} from "@/lib/helpCms";

type CategoryDraft = {
  isNew: boolean;
  key: string;
  iconKey: string;
  sortOrder: number;
  active: boolean;
  titleEn: string;
  summaryEn: string;
  titleHu: string;
  summaryHu: string;
  revision: number;
};

type ArticleDraft = {
  id: string;
  slug: string;
  categoryKey: string;
  featuredRank: number;
  revision: number;
  locales: Record<HelpLocale, ReturnType<typeof emptyLocaleContent>>;
};

function articleDraft(article?: HelpArticle, categoryKey = ""): ArticleDraft {
  return {
    id: article?.id ?? "",
    slug: article?.slug ?? "",
    categoryKey: article?.categoryKey ?? categoryKey,
    featuredRank: article?.featuredRank ?? 0,
    revision: article?.revision ?? 0,
    locales: {
      en: structuredClone(article?.locales.en ?? emptyLocaleContent()),
      hu: structuredClone(article?.locales.hu ?? emptyLocaleContent()),
    },
  };
}

function defaultBlock(type: string): HelpBlock {
  switch (type) {
    case "divider": return { type };
    case "heading": return { type, level: 2, runs: [{ text: "", emphasis: "normal" }] };
    case "callout": return { type, tone: "info", runs: [{ text: "", emphasis: "normal" }] };
    case "bullet_list":
    case "number_list":
      return { type, items: [[{ text: "", emphasis: "normal" }]] };
    default: return { type: "paragraph", runs: [{ text: "", emphasis: "normal" }] };
  }
}

export default function HelpCmsPage() {
  const t = useTranslations("helpCms");
  const common = useTranslations("common");
  const [payload, setPayload] = useState<HelpCmsPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [article, setArticle] = useState<ArticleDraft | null>(null);
  const [localeTab, setLocaleTab] = useState<HelpLocale>("en");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [archiving, setArchiving] = useState<HelpArticle | null>(null);

  const load = useCallback(async () => {
    if (!payload) setState("loading");
    const response = await adminCall("help_admin_list");
    const parsed = response?.success ? helpCmsPayload(response) : null;
    if (!parsed) {
      setState("error");
      return;
    }
    setPayload(parsed);
    setState("ready");
  }, [payload]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function adopt(raw: unknown): boolean {
    const parsed = helpCmsPayload(raw);
    if (!parsed) return false;
    setPayload(parsed);
    return true;
  }

  // ------------------------------------------------------------ categories

  async function saveCategory() {
    if (!categoryDraft) return;
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(categoryDraft.key)) {
      setFormError(t("keyInvalid"));
      return;
    }
    if (!categoryDraft.titleEn.trim() || !categoryDraft.titleHu.trim()) {
      setFormError(t("titlesRequired"));
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("save_help_category", {
      key: categoryDraft.key,
      icon_key: categoryDraft.iconKey || "faq",
      sort_order: categoryDraft.sortOrder,
      active: categoryDraft.active,
      labels_json: JSON.stringify({
        en: { title: categoryDraft.titleEn.trim(), summary: categoryDraft.summaryEn.trim() },
        hu: { title: categoryDraft.titleHu.trim(), summary: categoryDraft.summaryHu.trim() },
      }),
      expected_revision: categoryDraft.revision,
    });
    setBusy(false);
    if (!response?.success || !adopt(response)) {
      if (response?.error === "help-category-conflict") {
        setCategoryDraft(null);
        setToast(t("conflict"));
        void load();
        return;
      }
      setFormError(t("saveError"));
      return;
    }
    setCategoryDraft(null);
    setToast(t("saved"));
  }

  // -------------------------------------------------------------- articles

  async function saveArticle(): Promise<boolean> {
    if (!article) return false;
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(article.slug)) {
      setFormError(t("slugInvalid"));
      return false;
    }
    if (!article.categoryKey) {
      setFormError(t("categoryRequired"));
      return false;
    }
    const locales: Record<string, unknown> = {};
    for (const locale of HELP_LOCALES) {
      const content = article.locales[locale];
      if (content.title.trim() === "" && content.blocks.length === 0) continue;
      locales[locale] = content;
    }
    if (Object.keys(locales).length === 0) {
      setFormError(t("localeRequired"));
      return false;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("save_help_article", {
      id: article.id,
      slug: article.slug,
      category_key: article.categoryKey,
      featured_rank: article.featuredRank,
      locales_json: JSON.stringify(localesWire(
        Object.fromEntries(Object.entries(locales)) as ArticleDraft["locales"],
      )),
      expected_revision: article.revision,
    });
    setBusy(false);
    if (!response?.success || !adopt(response)) {
      if (response?.error === "help-article-conflict") {
        setArticle(null);
        setToast(t("conflict"));
        void load();
        return false;
      }
      setFormError(t("articleErrors", { code: String(response?.error ?? "save") }));
      return false;
    }
    setToast(t("saved"));
    return true;
  }

  async function saveArticleAndClose() {
    if (await saveArticle()) setArticle(null);
  }

  async function publishArticle() {
    if (!article || article.id === "") {
      setFormError(t("saveBeforePublish"));
      return;
    }
    // Publish acts on the STORED draft: save first so the operator publishes
    // what they see, then publish against the fresh revision.
    if (!(await saveArticle())) return;
    const saved = helpArticleBySlug(article.slug);
    if (!saved) return;
    setBusy(true);
    const response = await adminCall("publish_help_article", {
      id: saved.id,
      expected_revision: saved.revision,
    });
    setBusy(false);
    if (!response?.success || !adopt(response)) {
      setFormError(response?.error === "help-article-locale-incomplete"
        ? t("localeIncomplete")
        : t("publishError"));
      return;
    }
    setArticle(null);
    setToast(t("published"));
  }

  function helpArticleBySlug(slug: string): HelpArticle | null {
    return payload?.articles.find((row) => row.slug === slug) ?? null;
  }

  async function archiveArticle() {
    if (!archiving) return;
    setBusy(true);
    const response = await adminCall("archive_help_article", {
      id: archiving.id,
      expected_revision: archiving.revision,
    });
    setBusy(false);
    setArchiving(null);
    if (!response?.success || !adopt(response)) {
      setToast(t("archiveError"));
      void load();
      return;
    }
    setToast(t("archived"));
  }

  // ------------------------------------------------------------ block edit

  function updateContent(mutate: (content: ReturnType<typeof emptyLocaleContent>) => void) {
    setArticle((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutate(next.locales[localeTab]);
      return next;
    });
  }

  function runsEditor(
    runs: HelpRun[],
    onChange: (runs: HelpRun[]) => void,
  ) {
    return (
      <div className="help-runs">
        {runs.map((run, index) => (
          <div className="help-run-row" key={index}>
            <input
              type="text"
              value={run.text}
              maxLength={1000}
              placeholder={t("runText")}
              onChange={(event) => {
                const next = runs.map((row, at) => (
                  at === index ? { ...row, text: event.target.value } : row
                ));
                onChange(next);
              }}
            />
            <select
              value={run.emphasis}
              onChange={(event) => {
                const next = runs.map((row, at) => (
                  at === index ? { ...row, emphasis: event.target.value } : row
                ));
                onChange(next);
              }}
            >
              {HELP_RUN_EMPHASES.map((value) => (
                <option key={value} value={value}>{t(`emphasis.${value}`)}</option>
              ))}
            </select>
            <input
              type="url"
              value={run.link ?? ""}
              placeholder="https://"
              onChange={(event) => {
                const next = runs.map((row, at) => {
                  if (at !== index) return row;
                  const value = event.target.value.trim();
                  const { link: _link, ...rest } = row;
                  return value ? { ...rest, link: value } : rest;
                });
                onChange(next);
              }}
            />
            <button
              type="button"
              className="button button-danger button-small"
              disabled={runs.length <= 1}
              onClick={() => onChange(runs.filter((_, at) => at !== index))}
              aria-label={t("removeRun")}
            >×</button>
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => onChange([...runs, { text: "", emphasis: "normal" }])}
        >{t("addRun")}</button>
      </div>
    );
  }

  function blockEditor(block: HelpBlock, index: number, blocks: HelpBlock[]) {
    const replace = (next: HelpBlock) => updateContent((content) => {
      content.blocks[index] = next;
    });
    return (
      <div className="help-block" key={index}>
        <div className="help-block-head">
          <strong>{t(`block.${block.type}` as never) || block.type}</strong>
          <div className="help-block-tools">
            <button type="button" disabled={index === 0} onClick={() => updateContent((content) => {
              [content.blocks[index - 1], content.blocks[index]] = [content.blocks[index], content.blocks[index - 1]];
            })} aria-label={t("moveUp")}>↑</button>
            <button type="button" disabled={index === blocks.length - 1} onClick={() => updateContent((content) => {
              [content.blocks[index + 1], content.blocks[index]] = [content.blocks[index], content.blocks[index + 1]];
            })} aria-label={t("moveDown")}>↓</button>
            <button type="button" className="is-danger" onClick={() => updateContent((content) => {
              content.blocks.splice(index, 1);
            })} aria-label={common("delete")}>×</button>
          </div>
        </div>
        {block.type === "heading" ? (
          <select
            value={String(block.level ?? 2)}
            onChange={(event) => replace({ ...block, level: Number(event.target.value) })}
          >
            <option value="2">H2</option>
            <option value="3">H3</option>
          </select>
        ) : null}
        {block.type === "callout" ? (
          <select
            value={block.tone ?? "info"}
            onChange={(event) => replace({ ...block, tone: event.target.value })}
          >
            {HELP_CALLOUT_TONES.map((tone) => (
              <option key={tone} value={tone}>{t(`tone.${tone}`)}</option>
            ))}
          </select>
        ) : null}
        {block.runs !== undefined
          ? runsEditor(block.runs, (runs) => replace({ ...block, runs }))
          : null}
        {block.items !== undefined ? (
          <div className="help-list-items">
            {block.items.map((item, itemIndex) => (
              <div className="help-list-item" key={itemIndex}>
                {runsEditor(item, (runs) => {
                  const items = (block.items ?? []).map((row, at) => (
                    at === itemIndex ? runs : row
                  ));
                  replace({ ...block, items });
                })}
                <button
                  type="button"
                  className="button button-danger button-small"
                  disabled={(block.items ?? []).length <= 1}
                  onClick={() => replace({
                    ...block,
                    items: (block.items ?? []).filter((_, at) => at !== itemIndex),
                  })}
                >{t("removeItem")}</button>
              </div>
            ))}
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => replace({
                ...block,
                items: [...(block.items ?? []), [{ text: "", emphasis: "normal" }]],
              })}
            >{t("addItem")}</button>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------- render

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !payload) return <ErrorPanel message={t("loadError")} retry={load} />;

  const content = article?.locales[localeTab];

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast && <div className="alert alert-success page-alert" role="status">{toast}</div>}

      {article && content ? (
        <section className="panel help-article-editor">
          <div className="panel-header signup-option-group-header">
            <div>
              <div className="signup-option-title-line">
                <h2>{article.id === "" ? t("newArticle") : article.slug}</h2>
              </div>
              <p>{t("editorCopy")}</p>
            </div>
            <button className="button button-secondary button-small" disabled={busy} onClick={() => setArticle(null)}>{common("cancel")}</button>
          </div>
          <div className="panel-body help-editor-body">
            <div className="form-grid">
              <label className="field">
                <span>{t("slug")}</span>
                <input
                  value={article.slug}
                  disabled={article.id !== "" || busy}
                  maxLength={64}
                  spellCheck={false}
                  onChange={(event) => setArticle({
                    ...article,
                    slug: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  })}
                />
                <small className="field-hint">{t("slugHint")}</small>
              </label>
              <label className="field">
                <span>{t("category")}</span>
                <select
                  value={article.categoryKey}
                  disabled={busy}
                  onChange={(event) => setArticle({ ...article, categoryKey: event.target.value })}
                >
                  <option value="">—</option>
                  {payload.categories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.labels.en?.title ?? category.key}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("featured")}</span>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={article.featuredRank}
                  disabled={busy}
                  onChange={(event) => setArticle({
                    ...article,
                    featuredRank: Math.max(0, Math.min(1000, Number(event.target.value) || 0)),
                  })}
                />
                <small className="field-hint">{t("featuredHint")}</small>
              </label>
            </div>

            <nav className="help-locale-tabs" aria-label={t("locales")}>
              {HELP_LOCALES.map((locale) => (
                <button
                  key={locale}
                  type="button"
                  className={locale === localeTab ? "is-active" : ""}
                  onClick={() => setLocaleTab(locale)}
                >{locale.toUpperCase()}</button>
              ))}
            </nav>

            <div className="form-grid">
              <label className="field field-full">
                <span>{t("articleTitle")}</span>
                <input
                  value={content.title}
                  maxLength={160}
                  disabled={busy}
                  onChange={(event) => updateContent((row) => { row.title = event.target.value; })}
                />
              </label>
              <label className="field field-full">
                <span>{t("articleSummary")}</span>
                <textarea
                  value={content.summary}
                  maxLength={300}
                  disabled={busy}
                  onChange={(event) => updateContent((row) => { row.summary = event.target.value; })}
                />
              </label>
              <label className="field field-full">
                <span>{t("keywords")}</span>
                <input
                  value={content.keywords.join(", ")}
                  disabled={busy}
                  onChange={(event) => updateContent((row) => {
                    row.keywords = event.target.value
                      .split(",")
                      .map((keyword) => keyword.trim())
                      .filter(Boolean)
                      .slice(0, 20);
                  })}
                />
                <small className="field-hint">{t("keywordsHint")}</small>
              </label>
            </div>

            <div className="help-blocks">
              {content.blocks.map((block, index) => blockEditor(block, index, content.blocks))}
              <div className="help-add-block">
                {HELP_BLOCK_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="button button-secondary button-small"
                    disabled={busy || content.blocks.length >= 80}
                    onClick={() => updateContent((row) => { row.blocks.push(defaultBlock(type)); })}
                  >+ {t(`block.${type}`)}</button>
                ))}
              </div>
            </div>

            {formError && <div className="alert alert-error" role="alert">{formError}</div>}
            <div className="dialog-actions help-editor-actions">
              <button className="button button-secondary" disabled={busy} onClick={() => void saveArticleAndClose()}>{t("saveDraft")}</button>
              <button className="button button-primary" disabled={busy} onClick={() => void publishArticle()}>{busy ? common("saving") : t("publish")}</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-header signup-option-group-header">
              <div>
                <div className="signup-option-title-line"><h2>{t("categories")}</h2></div>
                <p>{t("categoriesCopy")}</p>
              </div>
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setFormError("");
                  setCategoryDraft({
                    isNew: true, key: "", iconKey: "faq",
                    sortOrder: (payload.categories.length + 1) * 100,
                    active: true, titleEn: "", summaryEn: "", titleHu: "", summaryHu: "",
                    revision: 0,
                  });
                }}
              >{t("addCategory")}</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>{t("key")}</th><th>EN</th><th>HU</th><th>{t("order")}</th><th>{t("status")}</th><th /></tr></thead>
                <tbody>
                  {payload.categories.map((category) => (
                    <tr key={category.key} className={!category.active ? "signup-option-inactive" : ""}>
                      <td><code>{category.key}</code></td>
                      <td>{category.labels.en?.title ?? ""}</td>
                      <td>{category.labels.hu?.title ?? ""}</td>
                      <td>{category.sortOrder}</td>
                      <td><span className={`badge ${category.active ? "badge-active" : "badge-inactive"}`}>{category.active ? t("active") : t("inactive")}</span></td>
                      <td>
                        <button
                          className="button button-secondary button-small"
                          onClick={() => {
                            setFormError("");
                            setCategoryDraft({
                              isNew: false,
                              key: category.key,
                              iconKey: category.iconKey,
                              sortOrder: category.sortOrder,
                              active: category.active,
                              titleEn: category.labels.en?.title ?? "",
                              summaryEn: category.labels.en?.summary ?? "",
                              titleHu: category.labels.hu?.title ?? "",
                              summaryHu: category.labels.hu?.summary ?? "",
                              revision: category.revision,
                            });
                          }}
                        >{common("edit")}</button>
                      </td>
                    </tr>
                  ))}
                  {payload.categories.length === 0 && (
                    <tr><td colSpan={6} className="signup-options-empty">{t("noCategories")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header signup-option-group-header">
              <div>
                <div className="signup-option-title-line"><h2>{t("articles")}</h2></div>
                <p>{t("articlesCopy")}</p>
              </div>
              <button
                className="button button-primary button-small"
                disabled={payload.categories.length === 0}
                onClick={() => {
                  setFormError("");
                  setLocaleTab("en");
                  setArticle(articleDraft(undefined, payload.categories[0]?.key ?? ""));
                }}
              >{t("addArticle")}</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>{t("slug")}</th><th>{t("category")}</th><th>EN</th><th>HU</th><th>{t("status")}</th><th>{t("featured")}</th><th /></tr></thead>
                <tbody>
                  {payload.articles.map((row) => (
                    <tr key={row.id}>
                      <td><code>{row.slug}</code></td>
                      <td><code>{row.categoryKey}</code></td>
                      <td>{row.locales.en?.title ?? ""}</td>
                      <td>{row.locales.hu?.title ?? ""}</td>
                      <td><span className={`badge ${row.status === "published" ? "badge-active" : row.status === "archived" ? "badge-inactive" : "badge-warning"}`}>{t(`state.${row.status}`)}</span></td>
                      <td>{row.featuredRank > 0 ? row.featuredRank : "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="button button-secondary button-small"
                            onClick={() => {
                              setFormError("");
                              setLocaleTab("en");
                              setArticle(articleDraft(row));
                            }}
                          >{common("edit")}</button>
                          {row.status !== "archived" && (
                            <button
                              className="button button-danger button-small"
                              onClick={() => setArchiving(row)}
                            >{t("archive")}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {payload.articles.length === 0 && (
                    <tr><td colSpan={7} className="signup-options-empty">{t("noArticles")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {categoryDraft && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setCategoryDraft(null);
        }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="help-category-title">
            <div className="dialog-header">
              <div><h2 id="help-category-title">{categoryDraft.isNew ? t("addCategory") : t("editCategory")}</h2></div>
              <button className="dialog-close" onClick={() => setCategoryDraft(null)} disabled={busy} aria-label={common("close")}>×</button>
            </div>
            <div className="dialog-body form-grid">
              <label className="field">
                <span>{t("key")}</span>
                <input
                  value={categoryDraft.key}
                  disabled={!categoryDraft.isNew || busy}
                  maxLength={64}
                  spellCheck={false}
                  onChange={(event) => setCategoryDraft({
                    ...categoryDraft,
                    key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  })}
                />
              </label>
              <label className="field">
                <span>{t("order")}</span>
                <input
                  type="number" min="0" max="100000"
                  value={categoryDraft.sortOrder}
                  disabled={busy}
                  onChange={(event) => setCategoryDraft({
                    ...categoryDraft,
                    sortOrder: Math.max(0, Math.min(100000, Number(event.target.value) || 0)),
                  })}
                />
              </label>
              <label className="field"><span>{t("titleEn")}</span><input value={categoryDraft.titleEn} maxLength={120} disabled={busy} onChange={(event) => setCategoryDraft({ ...categoryDraft, titleEn: event.target.value })} /></label>
              <label className="field"><span>{t("titleHu")}</span><input value={categoryDraft.titleHu} maxLength={120} disabled={busy} onChange={(event) => setCategoryDraft({ ...categoryDraft, titleHu: event.target.value })} /></label>
              <label className="field"><span>{t("summaryEn")}</span><input value={categoryDraft.summaryEn} maxLength={300} disabled={busy} onChange={(event) => setCategoryDraft({ ...categoryDraft, summaryEn: event.target.value })} /></label>
              <label className="field"><span>{t("summaryHu")}</span><input value={categoryDraft.summaryHu} maxLength={300} disabled={busy} onChange={(event) => setCategoryDraft({ ...categoryDraft, summaryHu: event.target.value })} /></label>
              <label className="checkbox-field">
                <input type="checkbox" checked={categoryDraft.active} disabled={busy} onChange={(event) => setCategoryDraft({ ...categoryDraft, active: event.target.checked })} />
                <span>{t("active")}</span>
              </label>
              {formError && <div className="alert alert-error field-full" role="alert">{formError}</div>}
            </div>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={() => setCategoryDraft(null)} disabled={busy}>{common("cancel")}</button>
              <button className="button button-primary" onClick={() => void saveCategory()} disabled={busy}>{busy ? common("saving") : common("save")}</button>
            </div>
          </section>
        </div>
      )}

      {archiving && (
        <ConfirmDialog
          busyLabel={common("saving")}
          title={t("archiveTitle")}
          copy={t("archiveCopy", { slug: archiving.slug })}
          confirmLabel={t("archive")}
          busy={busy}
          onCancel={() => { if (!busy) setArchiving(null); }}
          onConfirm={() => void archiveArticle()}
        />
      )}
    </>
  );
}

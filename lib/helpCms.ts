/**
 * Help-centre CMS models (help-support-v1). The article body is a typed
 * block tree — the closed vocabulary Core's HelpContentPolicy validates —
 * with inline formatting as runs. Both locales live on one article and
 * publish together.
 *
 * Fail-closed parser: one unreadable row invalidates the payload. The
 * EDITOR side is tolerant the other way: a stored block whose type this
 * build does not know is preserved verbatim so a save never drops it.
 */

export const HELP_LOCALES = ["en", "hu"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];

export const HELP_BLOCK_TYPES = [
  "paragraph", "heading", "bullet_list", "number_list", "callout", "divider",
] as const;
export const HELP_CALLOUT_TONES = ["info", "warning", "success"] as const;
export const HELP_RUN_EMPHASES = ["normal", "strong", "accent"] as const;

export type HelpRun = {
  text: string;
  emphasis: string;
  link?: string;
};

export type HelpBlock = {
  type: string;
  level?: number;
  tone?: string;
  runs?: HelpRun[];
  items?: HelpRun[][];
};

export type HelpLocaleContent = {
  title: string;
  summary: string;
  keywords: string[];
  blocks: HelpBlock[];
};

export type HelpCategory = {
  id: string;
  key: string;
  iconKey: string;
  sortOrder: number;
  active: boolean;
  labels: Record<string, { title: string; summary: string }>;
  revision: number;
};

export type HelpArticle = {
  id: string;
  slug: string;
  categoryKey: string;
  status: "draft" | "published" | "archived";
  featuredRank: number;
  revision: number;
  locales: Partial<Record<HelpLocale, HelpLocaleContent>>;
  publishedAt: number;
  updatedAt: number;
};

export type HelpCmsPayload = {
  categories: HelpCategory[];
  articles: HelpArticle[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function run(value: unknown): HelpRun | null {
  const source = record(value);
  const body = text(source?.text, 1000);
  if (!source || body === "") return null;
  const result: HelpRun = {
    text: body,
    emphasis: text(source.emphasis, 20) || "normal",
  };
  const link = text(source.link, 500);
  if (link) result.link = link;
  return result;
}

function runs(value: unknown): HelpRun[] | null {
  if (!Array.isArray(value)) return null;
  const rows: HelpRun[] = [];
  for (const raw of value) {
    const parsed = run(raw);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

function block(value: unknown): HelpBlock | null {
  const source = record(value);
  if (!source) return null;
  const type = text(source.type, 30);
  if (!type) return null;
  const result: HelpBlock = { type };
  if (source.level !== undefined) result.level = integer(source.level);
  if (source.tone !== undefined) result.tone = text(source.tone, 20);
  if (source.runs !== undefined) {
    const parsed = runs(source.runs);
    if (!parsed) return null;
    result.runs = parsed;
  }
  if (source.items !== undefined) {
    if (!Array.isArray(source.items)) return null;
    const items: HelpRun[][] = [];
    for (const rawItem of source.items) {
      const parsed = runs(rawItem);
      if (!parsed) return null;
      items.push(parsed);
    }
    result.items = items;
  }
  return result;
}

function localeContent(value: unknown): HelpLocaleContent | null {
  const source = record(value);
  if (!source) return null;
  const blocks: HelpBlock[] = [];
  if (source.blocks !== undefined) {
    if (!Array.isArray(source.blocks)) return null;
    for (const raw of source.blocks) {
      const parsed = block(raw);
      if (!parsed) return null;
      blocks.push(parsed);
    }
  }
  const keywords = Array.isArray(source.keywords)
    ? source.keywords.filter((item): item is string => typeof item === "string")
    : [];
  return {
    title: text(source.title, 160),
    summary: text(source.summary, 300),
    keywords,
    blocks,
  };
}

export function helpCmsPayload(value: unknown): HelpCmsPayload | null {
  const source = record(value);
  if (!source || !Array.isArray(source.categories) || !Array.isArray(source.articles)) {
    return null;
  }
  const categories: HelpCategory[] = [];
  for (const raw of source.categories) {
    const row = record(raw);
    if (!row || typeof row.key !== "string") return null;
    const labels: HelpCategory["labels"] = {};
    const rawLabels = record(row.labels) ?? {};
    for (const locale of Object.keys(rawLabels)) {
      const label = record(rawLabels[locale]);
      labels[locale] = {
        title: text(label?.title, 120),
        summary: text(label?.summary, 300),
      };
    }
    categories.push({
      id: text(row.id, 40),
      key: row.key,
      iconKey: text(row.icon_key, 40) || "faq",
      sortOrder: integer(row.sort_order),
      active: row.active === true,
      labels,
      revision: Math.max(1, integer(row.revision)),
    });
  }
  const articles: HelpArticle[] = [];
  for (const raw of source.articles) {
    const row = record(raw);
    if (!row || typeof row.slug !== "string" || typeof row.id !== "string") return null;
    const status = row.status === "published"
      ? "published"
      : row.status === "archived"
        ? "archived"
        : "draft";
    const draft = record(record(row.draft)?.locales) ?? {};
    const locales: HelpArticle["locales"] = {};
    for (const locale of HELP_LOCALES) {
      if (draft[locale] === undefined) continue;
      const parsed = localeContent(draft[locale]);
      if (!parsed) return null;
      locales[locale] = parsed;
    }
    articles.push({
      id: row.id,
      slug: row.slug,
      categoryKey: text(row.category_key, 64),
      status,
      featuredRank: Math.max(0, integer(row.featured_rank)),
      revision: Math.max(1, integer(row.revision)),
      locales,
      publishedAt: integer(row.published_at),
      updatedAt: integer(row.updated_at),
    });
  }
  return { categories, articles };
}

/** The wire shape `save_help_article` expects under `locales_json`. */
export function localesWire(
  locales: Partial<Record<HelpLocale, HelpLocaleContent>>,
): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const locale of HELP_LOCALES) {
    const content = locales[locale];
    if (!content) continue;
    wire[locale] = {
      title: content.title,
      summary: content.summary,
      keywords: content.keywords,
      blocks: content.blocks,
    };
  }
  return wire;
}

export function emptyLocaleContent(): HelpLocaleContent {
  return { title: "", summary: "", keywords: [], blocks: [] };
}

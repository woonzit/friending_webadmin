export const SIGNUP_PAGE_LIMIT = 5;
export const SIGNUP_PAGE_ITEM_LIMIT = 8;

export type SignupPageLanguage = "en" | "hu";

export type SignupPageText = {
  en: string;
  hu: string;
};

export type SignupPageIcon = {
  url: string;
  mime: "" | "image/png" | "image/svg+xml";
};

export type SignupPageOption = {
  key: string;
  labels: SignupPageText;
};

export type SignupEligibleField = {
  field_key: string;
  profile_field: string;
  labels: SignupPageText;
  icon: SignupPageIcon;
  selection: {
    mode: "single" | "multi";
    max_selected: number;
  };
  options: SignupPageOption[];
};

export type SignupSystemQuestion = {
  key: "gender" | "visible_to";
  labels: SignupPageText;
  icon: SignupPageIcon;
  required: true;
  locked: true;
  options: SignupPageOption[];
};

export type SignupPageItem = {
  field_key: string;
  required: boolean;
};

export type SignupPage = {
  key: string;
  hidden: boolean;
  title: SignupPageText;
  subtitle: SignupPageText;
  items: SignupPageItem[];
};

export type SignupPageLayout = {
  revision: number;
  updated_at: number;
  updated_by: string;
  pages: SignupPage[];
};

export type SignupDroppedItem = {
  page_key: string;
  field_key: string;
};

export type SignupPagesPayload = {
  pages: SignupPageLayout;
  eligible_fields: SignupEligibleField[];
  system_questions: [SignupSystemQuestion, SignupSystemQuestion];
  dropped_items: SignupDroppedItem[];
};

export const SIGNUP_PAGE_ISSUE_CODES = [
  "page-limit",
  "item-limit",
  "unknown-field",
  "field-not-selectable",
  "field-archived",
  "duplicate-field",
  "blank-title",
] as const;

export type SignupPageIssueCode = (typeof SIGNUP_PAGE_ISSUE_CODES)[number];

export type SignupPageIssue = {
  code: SignupPageIssueCode;
  page_key?: string;
  field_key?: string;
};

export type SignupPageSaveBody = {
  expected_revision: number;
  pages: Array<{
    key: string;
    hidden: boolean;
    title: SignupPageText;
    subtitle: SignupPageText;
    items: SignupPageItem[];
  }>;
};

const FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_KEY = /^[a-z0-9][a-z0-9_+\-]{0,63}$/;
const PAGE_KEY = /^p_[0-9a-f]{8}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): Record<T[number], unknown> | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? source as Record<T[number], unknown>
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function pageText(value: unknown, nonBlank: boolean): SignupPageText | null {
  const source = exactRecord(value, ["en", "hu"] as const);
  if (!source || typeof source.en !== "string" || typeof source.hu !== "string") return null;
  if (nonBlank && (!source.en.trim() || !source.hu.trim())) return null;
  return { en: source.en, hu: source.hu };
}

function pageIcon(value: unknown): SignupPageIcon | null {
  const source = exactRecord(value, ["url", "mime"] as const);
  if (!source || typeof source.url !== "string" || typeof source.mime !== "string") return null;
  if (source.url === "" && source.mime === "") return { url: "", mime: "" };
  if (source.mime !== "image/png" && source.mime !== "image/svg+xml") return null;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "img.friending.co") return null;
  } catch {
    return null;
  }
  return { url: source.url, mime: source.mime };
}

function option(value: unknown): SignupPageOption | null {
  const source = exactRecord(value, ["key", "labels"] as const);
  const labels = pageText(source?.labels, true);
  if (!source || typeof source.key !== "string" || !OPTION_KEY.test(source.key) || !labels) return null;
  return { key: source.key, labels };
}

function options(value: unknown): SignupPageOption[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) return null;
  const parsed = value.map(option);
  if (parsed.some((row) => row === null)) return null;
  const result = parsed as SignupPageOption[];
  if (new Set(result.map((row) => row.key)).size !== result.length) return null;
  return result;
}

function eligibleField(value: unknown): SignupEligibleField | null {
  const source = exactRecord(
    value,
    ["field_key", "profile_field", "labels", "icon", "selection", "options"] as const,
  );
  const labels = pageText(source?.labels, true);
  const icon = pageIcon(source?.icon);
  const selection = exactRecord(source?.selection, ["mode", "max_selected"] as const);
  const maxSelected = integer(selection?.max_selected, 1, 100);
  const parsedOptions = options(source?.options);
  if (
    !source
    || typeof source.field_key !== "string"
    || !FIELD_KEY.test(source.field_key)
    || typeof source.profile_field !== "string"
    || !FIELD_KEY.test(source.profile_field)
    || !labels
    || !icon
    || !selection
    || (selection.mode !== "single" && selection.mode !== "multi")
    || maxSelected === null
    || (selection.mode === "single" && maxSelected !== 1)
    || !parsedOptions
  ) return null;
  return {
    field_key: source.field_key,
    profile_field: source.profile_field,
    labels,
    icon,
    selection: { mode: selection.mode, max_selected: maxSelected },
    options: parsedOptions,
  };
}

function systemQuestion(value: unknown): SignupSystemQuestion | null {
  const source = exactRecord(
    value,
    ["key", "labels", "icon", "required", "locked", "options"] as const,
  );
  const labels = pageText(source?.labels, true);
  const icon = pageIcon(source?.icon);
  const parsedOptions = options(source?.options);
  if (
    !source
    || (source.key !== "gender" && source.key !== "visible_to")
    || source.required !== true
    || source.locked !== true
    || !labels
    || !icon
    || !parsedOptions
  ) return null;
  return {
    key: source.key,
    labels,
    icon,
    required: true,
    locked: true,
    options: parsedOptions,
  };
}

function pageItem(value: unknown): SignupPageItem | null {
  const source = exactRecord(value, ["field_key", "required"] as const);
  if (
    !source
    || typeof source.field_key !== "string"
    || !FIELD_KEY.test(source.field_key)
    || typeof source.required !== "boolean"
  ) return null;
  return { field_key: source.field_key, required: source.required };
}

function page(value: unknown): SignupPage | null {
  const source = exactRecord(value, ["key", "hidden", "title", "subtitle", "items"] as const);
  const title = pageText(source?.title, false);
  const subtitle = pageText(source?.subtitle, false);
  if (
    !source
    || typeof source.key !== "string"
    || !PAGE_KEY.test(source.key)
    || typeof source.hidden !== "boolean"
    || !title
    || !subtitle
    || !Array.isArray(source.items)
    || source.items.length > SIGNUP_PAGE_ITEM_LIMIT
  ) return null;
  const parsedItems = source.items.map(pageItem);
  if (parsedItems.some((row) => row === null)) return null;
  return {
    key: source.key,
    hidden: source.hidden,
    title,
    subtitle,
    items: parsedItems as SignupPageItem[],
  };
}

function layout(value: unknown): SignupPageLayout | null {
  const source = exactRecord(value, ["revision", "updated_at", "updated_by", "pages"] as const);
  const revision = integer(source?.revision);
  const updatedAt = integer(source?.updated_at);
  if (
    !source
    || revision === null
    || updatedAt === null
    || typeof source.updated_by !== "string"
    || source.updated_by.length > 320
    || !Array.isArray(source.pages)
    || source.pages.length > SIGNUP_PAGE_LIMIT
  ) return null;
  const parsedPages = source.pages.map(page);
  if (parsedPages.some((row) => row === null)) return null;
  const pages = parsedPages as SignupPage[];
  const pageKeys = pages.map((row) => row.key);
  if (new Set(pageKeys).size !== pageKeys.length) return null;
  const fieldKeys = pages.flatMap((row) => row.items.map((item) => item.field_key));
  if (new Set(fieldKeys).size !== fieldKeys.length) return null;
  return {
    revision,
    updated_at: updatedAt,
    updated_by: source.updated_by,
    pages,
  };
}

function droppedItem(value: unknown): SignupDroppedItem | null {
  const source = exactRecord(value, ["page_key", "field_key"] as const);
  if (
    !source
    || typeof source.page_key !== "string"
    || !PAGE_KEY.test(source.page_key)
    || typeof source.field_key !== "string"
    || !FIELD_KEY.test(source.field_key)
  ) return null;
  return { page_key: source.page_key, field_key: source.field_key };
}

/**
 * Decode the additive composer blocks on `list_signup_options`. Unrelated
 * legacy envelope/catalogue siblings are ignored, while every known block is
 * all-or-nothing. A malformed read can therefore never masquerade as an
 * intentionally empty page layout.
 */
export function signupPagesPayload(value: unknown): SignupPagesPayload | null {
  const source = record(value);
  const parsedLayout = layout(source?.pages);
  if (
    !source
    || !parsedLayout
    || !Array.isArray(source.eligible_fields)
    || source.eligible_fields.length > 500
    || !Array.isArray(source.system_questions)
    || source.system_questions.length !== 2
    || !Array.isArray(source.dropped_items)
    || source.dropped_items.length > 500
  ) return null;

  const fields = source.eligible_fields.map(eligibleField);
  const questions = source.system_questions.map(systemQuestion);
  const dropped = source.dropped_items.map(droppedItem);
  if (
    fields.some((row) => row === null)
    || questions.some((row) => row === null)
    || dropped.some((row) => row === null)
  ) return null;

  const eligibleFields = fields as SignupEligibleField[];
  const systemQuestions = questions as SignupSystemQuestion[];
  const droppedItems = dropped as SignupDroppedItem[];
  if (new Set(eligibleFields.map((row) => row.field_key)).size !== eligibleFields.length) return null;
  if (new Set(systemQuestions.map((row) => row.key)).size !== 2) return null;
  if (systemQuestions[0].key !== "gender" || systemQuestions[1].key !== "visible_to") return null;
  const eligibleKeys = new Set(eligibleFields.map((row) => row.field_key));
  if (parsedLayout.pages.some((row) => row.items.some((item) => !eligibleKeys.has(item.field_key)))) return null;
  const droppedKeys = droppedItems.map((row) => `${row.page_key}:${row.field_key}`);
  if (new Set(droppedKeys).size !== droppedKeys.length) return null;

  return {
    pages: parsedLayout,
    eligible_fields: eligibleFields,
    system_questions: systemQuestions as [SignupSystemQuestion, SignupSystemQuestion],
    dropped_items: droppedItems,
  };
}

function replacePage(
  layout: SignupPageLayout,
  pageKey: string,
  update: (page: SignupPage) => SignupPage,
): SignupPageLayout {
  let changed = false;
  const pages = layout.pages.map((row) => {
    if (row.key !== pageKey) return row;
    changed = true;
    return update(row);
  });
  return changed ? { ...layout, pages } : layout;
}

export function addPage(layout: SignupPageLayout, pageKey: string): SignupPageLayout {
  if (
    layout.pages.length >= SIGNUP_PAGE_LIMIT
    || !PAGE_KEY.test(pageKey)
    || layout.pages.some((row) => row.key === pageKey)
  ) return layout;
  return {
    ...layout,
    pages: [...layout.pages, {
      key: pageKey,
      hidden: false,
      title: { en: "", hu: "" },
      subtitle: { en: "", hu: "" },
      items: [],
    }],
  };
}

export function removePage(layout: SignupPageLayout, pageKey: string): SignupPageLayout {
  const pages = layout.pages.filter((row) => row.key !== pageKey);
  return pages.length === layout.pages.length ? layout : { ...layout, pages };
}

export function movePage(layout: SignupPageLayout, pageKey: string, destinationIndex: number): SignupPageLayout {
  const sourceIndex = layout.pages.findIndex((row) => row.key === pageKey);
  if (sourceIndex < 0 || destinationIndex < 0 || destinationIndex >= layout.pages.length) return layout;
  const pages = [...layout.pages];
  const [moved] = pages.splice(sourceIndex, 1);
  pages.splice(destinationIndex, 0, moved);
  return pages.every((row, index) => row === layout.pages[index]) ? layout : { ...layout, pages };
}

export function addItem(
  layout: SignupPageLayout,
  pageKey: string,
  fieldKey: string,
  destinationIndex?: number,
): SignupPageLayout {
  if (
    !FIELD_KEY.test(fieldKey)
    || layout.pages.some((row) => row.items.some((item) => item.field_key === fieldKey))
  ) return layout;
  return replacePage(layout, pageKey, (row) => {
    if (row.items.length >= SIGNUP_PAGE_ITEM_LIMIT) return row;
    const items = [...row.items];
    const index = destinationIndex === undefined
      ? items.length
      : Math.max(0, Math.min(items.length, destinationIndex));
    items.splice(index, 0, { field_key: fieldKey, required: false });
    return { ...row, items };
  });
}

export function removeItem(layout: SignupPageLayout, fieldKey: string): SignupPageLayout {
  let changed = false;
  const pages = layout.pages.map((row) => {
    const items = row.items.filter((item) => item.field_key !== fieldKey);
    if (items.length === row.items.length) return row;
    changed = true;
    return { ...row, items };
  });
  return changed ? { ...layout, pages } : layout;
}

export function moveItem(
  layout: SignupPageLayout,
  fieldKey: string,
  destinationPageKey: string,
  destinationIndex?: number,
): SignupPageLayout {
  let source: SignupPageItem | null = null;
  for (const page of layout.pages) {
    const found = page.items.find((item) => item.field_key === fieldKey);
    if (found) source = found;
  }
  const destination = layout.pages.find((row) => row.key === destinationPageKey);
  if (!source || !destination) return layout;
  const destinationCount = destination.items.filter((item) => item.field_key !== fieldKey).length;
  if (destinationCount >= SIGNUP_PAGE_ITEM_LIMIT) return layout;

  const without = layout.pages.map((row) => ({
    ...row,
    items: row.items.filter((item) => item.field_key !== fieldKey),
  }));
  const pages = without.map((row) => {
    if (row.key !== destinationPageKey) return row;
    const items = [...row.items];
    const index = destinationIndex === undefined
      ? items.length
      : Math.max(0, Math.min(items.length, destinationIndex));
    items.splice(index, 0, source as SignupPageItem);
    return { ...row, items };
  });
  const next = { ...layout, pages };
  return sameLayout(layout, next) ? layout : next;
}

export function setRequired(
  layout: SignupPageLayout,
  fieldKey: string,
  required: boolean,
): SignupPageLayout {
  let changed = false;
  const pages = layout.pages.map((row) => ({
    ...row,
    items: row.items.map((item) => {
      if (item.field_key !== fieldKey || item.required === required) return item;
      changed = true;
      return { ...item, required };
    }),
  }));
  return changed ? { ...layout, pages } : layout;
}

export function setHidden(
  layout: SignupPageLayout,
  pageKey: string,
  hidden: boolean,
): SignupPageLayout {
  return replacePage(layout, pageKey, (row) => row.hidden === hidden ? row : { ...row, hidden });
}

export function setTitle(
  layout: SignupPageLayout,
  pageKey: string,
  language: SignupPageLanguage,
  title: string,
): SignupPageLayout {
  return replacePage(layout, pageKey, (row) => (
    row.title[language] === title
      ? row
      : { ...row, title: { ...row.title, [language]: title } }
  ));
}

export function setSubtitle(
  layout: SignupPageLayout,
  pageKey: string,
  language: SignupPageLanguage,
  subtitle: string,
): SignupPageLayout {
  return replacePage(layout, pageKey, (row) => (
    row.subtitle[language] === subtitle
      ? row
      : { ...row, subtitle: { ...row.subtitle, [language]: subtitle } }
  ));
}

export function validate(
  layout: SignupPageLayout,
  eligibleFields: readonly SignupEligibleField[],
): SignupPageIssue[] {
  const issues: SignupPageIssue[] = [];
  if (layout.pages.length > SIGNUP_PAGE_LIMIT) issues.push({ code: "page-limit" });
  const eligible = new Set(eligibleFields.map((row) => row.field_key));
  const seen = new Set<string>();
  for (const row of layout.pages) {
    if (row.items.length < 1 || row.items.length > SIGNUP_PAGE_ITEM_LIMIT) {
      issues.push({ code: "item-limit", page_key: row.key });
    }
    if (!row.title.en.trim() || !row.title.hu.trim()) {
      issues.push({ code: "blank-title", page_key: row.key });
    }
    for (const item of row.items) {
      if (!eligible.has(item.field_key)) {
        issues.push({ code: "unknown-field", page_key: row.key, field_key: item.field_key });
      }
      if (seen.has(item.field_key)) {
        issues.push({ code: "duplicate-field", page_key: row.key, field_key: item.field_key });
      }
      seen.add(item.field_key);
    }
  }
  return issues;
}

export function sameLayout(left: SignupPageLayout, right: SignupPageLayout): boolean {
  return JSON.stringify(left.pages) === JSON.stringify(right.pages);
}

export function serialize(layout: SignupPageLayout): SignupPageSaveBody {
  return {
    expected_revision: layout.revision,
    pages: layout.pages.map((row) => ({
      key: row.key,
      hidden: row.hidden,
      title: { en: row.title.en.trim(), hu: row.title.hu.trim() },
      subtitle: { en: row.subtitle.en.trim(), hu: row.subtitle.hu.trim() },
      items: row.items.map((item) => ({ ...item })),
    })),
  };
}

export function withRevision(layout: SignupPageLayout, revision: number): SignupPageLayout | null {
  return Number.isSafeInteger(revision) && revision === layout.revision + 1
    ? { ...layout, revision }
    : null;
}

export function signupPageSaveRevision(value: unknown): number | null {
  const source = record(value);
  const revision = integer(source?.revision);
  return source?.success === true
    && source.status_code === 200
    && revision !== null
    ? revision
    : null;
}

export function signupPageConflict(value: unknown): boolean {
  const source = record(value);
  return source?.success === false
    && source.status_code === 409
    && source.error === "signup-page-layout-conflict";
}

function issue(value: unknown): SignupPageIssue | null {
  const source = record(value);
  const issueKeys = Object.keys(source ?? {});
  if (
    !source
    || issueKeys.length < 1
    || issueKeys.some((key) => !["code", "page_key", "field_key"].includes(key))
    || typeof source.code !== "string"
    || !SIGNUP_PAGE_ISSUE_CODES.includes(source.code as SignupPageIssueCode)
    || (source.page_key !== undefined && (typeof source.page_key !== "string" || !PAGE_KEY.test(source.page_key)))
    || (source.field_key !== undefined && (typeof source.field_key !== "string" || !FIELD_KEY.test(source.field_key)))
  ) return null;
  const parsed: SignupPageIssue = { code: source.code as SignupPageIssueCode };
  if (typeof source.page_key === "string") parsed.page_key = source.page_key;
  if (typeof source.field_key === "string") parsed.field_key = source.field_key;
  if ((parsed.code === "blank-title" || parsed.code === "item-limit") && !parsed.page_key) return null;
  if (["unknown-field", "field-not-selectable", "field-archived", "duplicate-field"].includes(parsed.code)
    && (!parsed.page_key || !parsed.field_key)) return null;
  return parsed;
}

/** Decode only the 422 policy refusal; callers must render every row inline. */
export function signupPageSaveIssues(value: unknown): SignupPageIssue[] | null {
  const source = record(value);
  if (
    !source
    || source.success !== false
    || source.status_code !== 422
    || source.error !== "signup-page-layout-invalid"
    || !Array.isArray(source.errors)
    || source.errors.length < 1
    || source.errors.length > 100
  ) return null;
  const parsed = source.errors.map(issue);
  return parsed.some((row) => row === null) ? null : parsed as SignupPageIssue[];
}

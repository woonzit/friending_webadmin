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

export const SIGNUP_SYSTEM_QUESTION_KEYS = ["gender", "visible_to", "intents"] as const;

export type SignupSystemQuestionKey = (typeof SIGNUP_SYSTEM_QUESTION_KEYS)[number];

export type SignupEligibleField = {
  /**
   * Core serves BOTH names for the same value on purpose
   * (`SignupPageCatalog::eligibleFieldRow`): `key` is what every other
   * catalogue row on this wire calls its identity, `field_key` is what a
   * PLACEMENT calls it, and the console reads a palette row and a placed item
   * through this one decoder. Placements are matched on `field_key`.
   */
  key: string;
  field_key: string;
  profile_field: string;
  labels: SignupPageText;
  icon: SignupPageIcon;
  selection: {
    mode: "single" | "multi";
    min_selected: number;
    max_selected: number;
  };
  sort_order: number;
  options: SignupPageOption[];
};

export type SignupSystemQuestion = {
  key: SignupSystemQuestionKey;
  kind: "identity" | "audience" | "system";
  /**
   * Core omits this key, rather than serving `false`, on the deployed gender
   * row. The two compiled questions (`visible_to` and `intents`) serve `true`.
   */
  synthetic: boolean;
  /** Additive on T-702; deployed two-row bodies decode an absent value as 0. */
  required_min: number;
  /**
   * Additive on T-702 beside `required_min`. Absent means the catalogue's own
   * maximum — every answer the row offers — which is what the two deployed rows
   * carry and what a System question with no admin-settable limit means. Only
   * the `intents` row is served with an explicit value today (D-114: 2).
   */
  max: number;
  labels: SignupPageText;
  icon: SignupPageIcon;
  /** System membership itself locks the card; the new row need not repeat it. */
  locked: true;
  options: SignupPageOption[];
};

export type SignupPagesWarning = {
  code: "unknown-system-question";
  key: string;
  index: number;
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

/**
 * One row of `dropped_items` on a read or a save, and — the same shape, from
 * the same `SignupPagePolicy::issue()` builder — one row of `details.items[]`
 * on a 422. `field_key` is the empty string when the reason is about the page
 * rather than one of its items.
 */
export type SignupDroppedItem = {
  index: number;
  page_key: string;
  field_key: string;
  reason: SignupPageIssueCode;
};

export type SignupPagesPayload = {
  pages: SignupPageLayout;
  eligible_fields: SignupEligibleField[];
  system_questions: SignupSystemQuestion[];
  dropped_items: SignupDroppedItem[];
  warnings: SignupPagesWarning[];
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
/** `ProfileFieldPolicy::localizedMap`'s language tag, verbatim. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const LAYOUT_SCHEMA_VERSION = 1;
const LAYOUT_KEY = "signup_pages_v1";

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

/**
 * A record whose keys are all drawn from `keys`, but which need not carry
 * every one of them. Core omits an absent optional member instead of serving a
 * null (`synthetic` on the gender System question, `sort_order` on a System
 * question's options), so an exact match would fail closed on a body that is
 * correct.
 */
function allowedRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): Partial<Record<T[number], unknown>> | null {
  const source = record(value);
  if (!source) return null;
  return Object.keys(source).every((key) => keys.includes(key))
    ? source as Partial<Record<T[number], unknown>>
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

/**
 * Every bilingual string on this wire is a `ProfileFieldPolicy::localizedMap`:
 * a map of language tag to non-blank label, `ksort`ed, carrying both `en` and
 * `hu` only where Core declares the map REQUIRED — and JSON-encoded as `[]`,
 * not `{}`, when it is empty, which is what an optional page subtitle nobody
 * filled in looks like on the wire. The console renders two languages, so it
 * keeps `en`/`hu`, tolerates any further tag Core may carry, and treats an
 * absent one as blank rather than refusing the whole read.
 */
function localizedText(value: unknown, required: boolean): SignupPageText | null {
  if (Array.isArray(value)) {
    return !required && value.length === 0 ? { en: "", hu: "" } : null;
  }
  const source = record(value);
  if (!source) return null;
  for (const [language, label] of Object.entries(source)) {
    if (!LANGUAGE_TAG.test(language) || typeof label !== "string" || label.trim() === "") return null;
  }
  const en = typeof source.en === "string" ? source.en : "";
  const hu = typeof source.hu === "string" ? source.hu : "";
  if (required && (en.trim() === "" || hu.trim() === "")) return null;
  return { en, hu };
}

function pageIcon(value: unknown): SignupPageIcon | null {
  const source = exactRecord(value, ["url", "mime"] as const);
  if (!source || typeof source.url !== "string" || typeof source.mime !== "string") return null;
  if (source.url === "" && source.mime === "") return { url: "", mime: "" };
  if (source.mime !== "image/png" && source.mime !== "image/svg+xml") return null;
  // Core's own normalizer (`ProfileFieldPolicy::httpsUrl`) accepts ANY https
  // host, and `/profile-fields` — which produces these very icons — decodes
  // them with no host rule either. Pinning one host here would have blanked
  // the whole composer the first time an operator uploaded an icon. The https
  // scheme and the two-mime allow-list stay.
  try {
    if (new URL(source.url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url: source.url, mime: source.mime };
}

function option(value: unknown): SignupPageOption | null {
  // A catalogue option carries `sort_order`; a System question's option does
  // not. The array Core sends is already in that order, so the value is
  // validated and then dropped rather than re-sorted here.
  const source = allowedRecord(value, ["key", "labels", "sort_order"] as const);
  const labels = localizedText(source?.labels, true);
  if (
    !source
    || typeof source.key !== "string"
    || !OPTION_KEY.test(source.key)
    || !labels
    || (source.sort_order !== undefined && integer(source.sort_order, 0, 100_000) === null)
  ) return null;
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
    [
      "key",
      "field_key",
      "profile_field",
      "labels",
      "descriptions",
      "icon",
      "selection",
      "sort_order",
      "options",
    ] as const,
  );
  const labels = localizedText(source?.labels, true);
  // Validated and dropped: the composer never renders a field description, but
  // a body whose descriptions are not a localized map is not a body Core sent.
  const descriptions = localizedText(source?.descriptions, false);
  const icon = pageIcon(source?.icon);
  const selection = exactRecord(
    source?.selection,
    ["mode", "min_selected", "max_selected"] as const,
  );
  const minSelected = integer(selection?.min_selected, 0, 20);
  const maxSelected = integer(selection?.max_selected, 1, 20);
  const sortOrder = integer(source?.sort_order, 0, 100_000);
  const parsedOptions = options(source?.options);
  if (
    !source
    || typeof source.key !== "string"
    || !FIELD_KEY.test(source.key)
    || typeof source.field_key !== "string"
    || !FIELD_KEY.test(source.field_key)
    || typeof source.profile_field !== "string"
    || !FIELD_KEY.test(source.profile_field)
    || !labels
    || !descriptions
    || !icon
    || !selection
    || (selection.mode !== "single" && selection.mode !== "multi")
    || minSelected === null
    || maxSelected === null
    || minSelected > maxSelected
    || (selection.mode === "single" && maxSelected !== 1)
    || sortOrder === null
    || !parsedOptions
  ) return null;
  return {
    key: source.key,
    field_key: source.field_key,
    profile_field: source.profile_field,
    labels,
    icon,
    selection: {
      mode: selection.mode,
      min_selected: minSelected,
      max_selected: maxSelected,
    },
    sort_order: sortOrder,
    options: parsedOptions,
  };
}

function isSignupSystemQuestionKey(value: string): value is SignupSystemQuestionKey {
  return SIGNUP_SYSTEM_QUESTION_KEYS.includes(value as SignupSystemQuestionKey);
}

const SYSTEM_QUESTION_CONTRACT = {
  gender: { kind: "identity", synthetic: false },
  visible_to: { kind: "audience", synthetic: true },
  intents: { kind: "system", synthetic: true },
} as const;

function systemQuestion(value: unknown): SignupSystemQuestion | null {
  // The first deployed rows still carry `locked`, `required`, and `icon`; the
  // T-702 additive contract does not need to repeat them on a System-owned
  // question. Validate legacy members when present and normalize the missing
  // lock/icon values instead of making the new row imitate the old envelope.
  const source = allowedRecord(
    value,
    [
      "key",
      "kind",
      "locked",
      "synthetic",
      "required",
      "required_min",
      "max",
      "labels",
      "icon",
      "options",
    ] as const,
  );
  const labels = localizedText(source?.labels, true);
  const icon = source?.icon === undefined ? { url: "", mime: "" } as const : pageIcon(source.icon);
  const parsedOptions = options(source?.options);
  if (!source || typeof source.key !== "string" || !isSignupSystemQuestionKey(source.key)) return null;
  const contract = SYSTEM_QUESTION_CONTRACT[source.key];
  const synthetic = source.synthetic === undefined ? false : source.synthetic;
  const requiredMin = source.required_min === undefined
    ? 0
    : integer(source.required_min, 0, 1_000);
  // An absent maximum is the CATALOGUE maximum, not an unbounded one: a row
  // that names no limit lets a member pick every answer it offers. Both
  // deployed rows are read that way, and the pair is then held to Core's own
  // `0 <= min <= max <= option count` rule so a stored inversion cannot reach
  // the card. Core clamps the same pair on the member wire
  // (`VisibilityIntentsPolicy::requiredMin()`), so the two never disagree.
  const maximum = parsedOptions === null
    ? null
    : source.max === undefined
      ? parsedOptions.length
      : integer(source.max, 1, parsedOptions.length);
  if (
    source.kind !== contract.kind
    || synthetic !== contract.synthetic
    || (source.required !== undefined && source.required !== true)
    || (source.locked !== undefined && source.locked !== true)
    || requiredMin === null
    || maximum === null
    || !labels
    || !icon
    || !parsedOptions
    || requiredMin > maximum
  ) return null;
  return {
    key: source.key,
    kind: contract.kind,
    synthetic: contract.synthetic,
    required_min: requiredMin,
    max: maximum,
    labels,
    icon,
    locked: true,
    options: parsedOptions,
  };
}

function systemQuestions(value: unknown): {
  questions: SignupSystemQuestion[];
  warnings: SignupPagesWarning[];
} | null {
  if (!Array.isArray(value) || value.length > 1_000) return null;
  const questions: SignupSystemQuestion[] = [];
  const warnings: SignupPagesWarning[] = [];
  let previousKnownIndex = -1;

  for (const [index, raw] of value.entries()) {
    const source = record(raw);
    if (
      !source
      || typeof source.key !== "string"
      || source.key.length < 1
      || source.key.length > 128
    ) return null;

    if (!isSignupSystemQuestionKey(source.key)) {
      warnings.push({ code: "unknown-system-question", key: source.key, index });
      continue;
    }

    const knownIndex = SIGNUP_SYSTEM_QUESTION_KEYS.indexOf(source.key);
    // Any subset is safe, but known rows remain unique and in Core's fixed
    // order even when an unknown future row is interleaved and skipped.
    if (knownIndex <= previousKnownIndex) return null;
    const question = systemQuestion(raw);
    if (!question) return null;
    questions.push(question);
    previousKnownIndex = knownIndex;
  }

  return { questions, warnings };
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
  // Neither is required HERE even though Core requires a title on the way in:
  // a stored title the console cannot read must surface as the `blank-title`
  // row `validate()` already renders on that page card, not as a dead page.
  const title = localizedText(source?.title, false);
  const subtitle = localizedText(source?.subtitle, false);
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

/**
 * The WHOLE stored document, not a bare array of pages: Core serves
 * `schema_version`, `key` and the read's own `dropped_items` beside the three
 * values the console edits. They are pinned here and then dropped — the
 * console never writes them back, and `signupPagesPayload` takes the dropped
 * rows from the top-level sibling Core repeats them in.
 */
function layout(value: unknown): SignupPageLayout | null {
  const source = exactRecord(
    value,
    [
      "schema_version",
      "key",
      "pages",
      "dropped_items",
      "revision",
      "updated_at",
      "updated_by",
    ] as const,
  );
  const revision = integer(source?.revision);
  const updatedAt = integer(source?.updated_at);
  if (
    !source
    || source.schema_version !== LAYOUT_SCHEMA_VERSION
    || source.key !== LAYOUT_KEY
    || revision === null
    || updatedAt === null
    || typeof source.updated_by !== "string"
    || source.updated_by.length > 320
    || droppedItems(source.dropped_items) === null
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

/**
 * One `SignupPagePolicy::issue()` row. Core builds `dropped_items` (what a read
 * or a save healed) and `details.items[]` (what a 422 refused) from the same
 * function, so one decoder reads both. `field_key` is `""` when the reason is
 * about the page rather than one of its items.
 */
function droppedItem(value: unknown): SignupDroppedItem | null {
  const source = exactRecord(value, ["index", "page_key", "field_key", "reason"] as const);
  const index = integer(source?.index, 0, SIGNUP_PAGE_LIMIT * 100);
  if (
    !source
    || index === null
    || typeof source.page_key !== "string"
    || !PAGE_KEY.test(source.page_key)
    || typeof source.field_key !== "string"
    || (source.field_key !== "" && !FIELD_KEY.test(source.field_key))
    || typeof source.reason !== "string"
    || !SIGNUP_PAGE_ISSUE_CODES.includes(source.reason as SignupPageIssueCode)
  ) return null;
  return {
    index,
    page_key: source.page_key,
    field_key: source.field_key,
    reason: source.reason as SignupPageIssueCode,
  };
}

function droppedItems(value: unknown): SignupDroppedItem[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const parsed = value.map(droppedItem);
  return parsed.some((row) => row === null) ? null : parsed as SignupDroppedItem[];
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
  const dropped = droppedItems(source?.dropped_items);
  const parsedSystemQuestions = systemQuestions(source?.system_questions);
  if (
    !source
    || !parsedLayout
    || !dropped
    || !parsedSystemQuestions
    || !Array.isArray(source.eligible_fields)
    || source.eligible_fields.length > 500
  ) return null;

  const fields = source.eligible_fields.map(eligibleField);
  if (fields.some((row) => row === null)) return null;

  const eligibleFields = fields as SignupEligibleField[];
  if (new Set(eligibleFields.map((row) => row.field_key)).size !== eligibleFields.length) return null;
  const eligibleKeys = new Set(eligibleFields.map((row) => row.field_key));
  if (parsedLayout.pages.some((row) => row.items.some((item) => !eligibleKeys.has(item.field_key)))) return null;

  return {
    pages: parsedLayout,
    eligible_fields: eligibleFields,
    system_questions: parsedSystemQuestions.questions,
    dropped_items: dropped,
    warnings: parsedSystemQuestions.warnings,
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

/**
 * The accepted save. Core answers with the whole payload beside the new
 * revision — the stored document, the catalogue and the System questions — so
 * the console adopts that answer instead of reading a second time; this is only
 * the CAS number out of it.
 */
export function signupPageSaveRevision(value: unknown): number | null {
  const source = record(value);
  const revision = integer(source?.revision);
  return source?.success === true
    && source.status_code === 200
    && revision !== null
    ? revision
    : null;
}

/**
 * Core's conflict is `signup-page-conflict`. This console shipped pinned on
 * `signup-page-layout-conflict`, a name Core has never sent (T-670 landing
 * report, "two names it got wrong"), so every lost race fell through to the
 * generic save error.
 */
export function signupPageConflict(value: unknown): boolean {
  const source = record(value);
  return source?.success === false
    && source.status_code === 409
    && source.error === "signup-page-conflict";
}

/**
 * A 409 carries the CURRENT document under `pages`, so a console that lost the
 * race can recover authority from the refusal itself rather than guessing.
 */
export function signupPageConflictLayout(value: unknown): SignupPageLayout | null {
  if (!signupPageConflict(value)) return null;
  return layout(record(value)?.pages);
}

/**
 * One refused row, in the shape the composer renders: the reason becomes the
 * issue code, and an empty `field_key` becomes an absent one so the row lands
 * on its page card rather than on an item that does not exist.
 */
function issue(value: unknown): SignupPageIssue | null {
  const row = droppedItem(value);
  if (!row) return null;
  const parsed: SignupPageIssue = { code: row.reason, page_key: row.page_key };
  if (row.field_key !== "") parsed.field_key = row.field_key;
  return parsed;
}

/**
 * Decode only the 422 policy refusal; callers must render every row inline.
 *
 * Core's refusal is `signup-page-layout-refused` with `details.items[]` — rows
 * of `{index, page_key, field_key, reason}`. This console shipped pinned on
 * `signup-page-layout-invalid` with a top-level `errors[]` of
 * `{code, page_key, field_key}`, neither of which Core sends, so every refusal
 * rendered as the generic save error with no row to fix (T-670 landing
 * report). `signup-page-layout-invalid` IS a real Core name — the whole
 * request being unreadable — but it never carries per-item reasons, so it
 * belongs in the generic branch, not here.
 */
export function signupPageSaveIssues(value: unknown): SignupPageIssue[] | null {
  const source = record(value);
  const details = record(source?.details);
  if (
    !source
    || source.success !== false
    || source.status_code !== 422
    || source.error !== "signup-page-layout-refused"
    || !details
    || Object.keys(details).some((key) => key !== "items")
    || !Array.isArray(details.items)
    || details.items.length < 1
    || details.items.length > 500
  ) return null;
  const parsed = details.items.map(issue);
  return parsed.some((row) => row === null) ? null : parsed as SignupPageIssue[];
}

/* -------------------------------------------------------------------------- *
 * D-114 — the "What are you looking for?" row's selection limits
 *
 * The owner rules that the intents row is multi-select with a maximum of 2 and
 * a required minimum of 1, and that BOTH numbers are editable from the console.
 * Core T-702 publishes one receipted, revision-guarded write for the pair
 * (`save_intents_selection_limits`); this block is the console half of it.
 * -------------------------------------------------------------------------- */

/**
 * The one System row whose limits an operator may edit. `gender` and
 * `visible_to` have no admin-settable pair: their maximum is structural, so the
 * settings control and the range caption belong to this key alone.
 */
export const SIGNUP_SELECTION_LIMITS_QUESTION_KEY = "intents" as const;

/**
 * Core's action name, verbatim.
 *
 * It is deliberately NOT a member of `audience_visibility.actions`: that array
 * is decoded with an exact ordered match, so an eighth entry would darken the
 * whole `/audience-visibility` workspace and break the capability check for the
 * seven actions that already work (the T-653 lesson, repeated in the T-702
 * report §6.2). It rides a sibling `admin_me` block instead, and on this side
 * it is a plain write-floor action in `lib/adminActions.ts`.
 */
export const SIGNUP_INTENTS_SELECTION_LIMITS_ACTION = "save_intents_selection_limits" as const;

/**
 * `list_signup_options` serves the row's CURRENT pair but no revision, and this
 * write is revision-guarded, so the console reads `intents_revision` from the
 * catalogue action before it may post. Reading it is a `read`-floor action; the
 * write itself stays at the write floor.
 */
export const SIGNUP_INTENTS_REVISION_READ_ACTION = "audience_visibility_catalog" as const;

export const SIGNUP_INTENTS_CONTRACT_VERSION = 1 as const;

/**
 * The ceiling is 5, NOT the option count.
 *
 * The owner said "at most the option count"; the installed iOS decoder
 * validates the served maximum against the closed 1...5 range and throws out of
 * the WHOLE schema-2 catalogue on a 6 — the same class of failure as risk K-1.
 * So the rule is `0 <= min <= max <= min(5, option count)`: the option count
 * can only LOWER this bound, never raise it (T-702 report §6.1).
 */
export const SIGNUP_INTENTS_SELECTION_MAX_CEILING = 5;

/** `AudienceVisibilityAdminPolicy`'s audit reason bound, mirrored for the form. */
export const SIGNUP_INTENTS_AUDIT_REASON_MAX_LENGTH = 300;

/** Survives a reload so an uncertain write is retried as a replay, not a second command. */
export const SIGNUP_INTENTS_LIMITS_REQUEST_STORAGE_KEY =
  "friending.signup-options.intents-limits.request.v1";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * The three numbers this console reads off the intents singleton.
 *
 * Deliberately narrow: the vocabulary itself — adding, renaming and archiving
 * the fourteen answers — belongs to `/audience-visibility` and its own decoder.
 * This one is used for three bodies that all carry the same block: the
 * catalogue read that supplies the revision, the accepted write, and the 409.
 */
export type SignupIntentsSelectionLimits = {
  intents_revision: number;
  /** Additive on T-702; a Core that predates it reads as the shipped 0. */
  selection_required_min: number;
  selection_max: number;
};

export type SignupIntentsLimitsDraft = {
  selection_max: number;
  selection_required_min: number;
  audit_reason: string;
};

export type SignupIntentsLimitsField =
  | "selection_max"
  | "selection_required_min"
  | "audit_reason";

export const SIGNUP_INTENTS_LIMITS_ISSUE_CODES = [
  "max-range",
  "min-range",
  "min-above-max",
  "reason-required",
  "refused",
] as const;

export type SignupIntentsLimitsIssueCode = (typeof SIGNUP_INTENTS_LIMITS_ISSUE_CODES)[number];

export type SignupIntentsLimitsIssue = {
  field: SignupIntentsLimitsField;
  code: SignupIntentsLimitsIssueCode;
};

export type SignupIntentsLimitsReceipt = {
  request_id: string;
  limits: SignupIntentsSelectionLimits;
  /** Core answered a request id it had already applied; nothing was written twice. */
  replayed: boolean;
};

/**
 * `min(5, option count)`. The row Core serves today has fourteen answers, so
 * the ceiling is 5; a vocabulary archived down to three answers lowers it to 3.
 */
export function signupIntentsSelectionCeiling(question: SignupSystemQuestion): number {
  return Math.min(SIGNUP_INTENTS_SELECTION_MAX_CEILING, question.options.length);
}

/** The row whose limits are editable, or `null` when Core is not serving it yet. */
export function signupSelectionLimitsQuestion(
  questions: readonly SignupSystemQuestion[],
): SignupSystemQuestion | null {
  return questions.find((row) => row.key === SIGNUP_SELECTION_LIMITS_QUESTION_KEY) ?? null;
}

/**
 * The audit reason rule Core's `AudienceVisibilityAdminPolicy` enforces, so the
 * form refuses locally what the route would refuse anyway rather than spending
 * a receipt on a certain refusal. Core stays the authority.
 */
function auditReason(value: string): string | null {
  if (value !== value.trim() || value !== value.normalize("NFC")) return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return null;
  }
  const length = [...value].length;
  return length >= 1 && length <= SIGNUP_INTENTS_AUDIT_REASON_MAX_LENGTH ? value : null;
}

/**
 * Every reason this draft cannot be posted, one row per field.
 *
 * Core's 422 is `audience-visibility-request-invalid` and carries NO per-field
 * details — the refusal happens in the pure parser before storage is read at
 * all — so these rows are the ONLY per-field reasons an operator can be shown.
 * They are therefore computed from Core's own published rule rather than from a
 * looser console convenience: `0 <= min <= max <= min(5, option count)`.
 */
export function signupIntentsLimitsIssues(
  draft: SignupIntentsLimitsDraft,
  ceiling: number,
): SignupIntentsLimitsIssue[] {
  const issues: SignupIntentsLimitsIssue[] = [];
  const maximum = integer(draft.selection_max, 1, ceiling);
  const minimum = integer(draft.selection_required_min, 0, ceiling);
  if (maximum === null) issues.push({ field: "selection_max", code: "max-range" });
  if (minimum === null) issues.push({ field: "selection_required_min", code: "min-range" });
  if (maximum !== null && minimum !== null && minimum > maximum) {
    issues.push({ field: "selection_required_min", code: "min-above-max" });
  }
  if (auditReason(draft.audit_reason) === null) {
    issues.push({ field: "audit_reason", code: "reason-required" });
  }
  return issues;
}

/**
 * The exact six-field command, in the contract's order, or `null`.
 *
 * `expected_intents_revision` comes from a read this browser actually made —
 * never from a number the operator can type — so a console that never read the
 * catalogue cannot guess a revision to guard with.
 */
export function signupIntentsLimitsBody(
  draft: SignupIntentsLimitsDraft,
  ceiling: number,
  requestId: string,
  expectedRevision: number,
): Record<string, unknown> | null {
  const reason = auditReason(draft.audit_reason);
  const maximum = integer(draft.selection_max, 1, ceiling);
  const minimum = integer(draft.selection_required_min, 0, ceiling);
  const revision = integer(expectedRevision, 1, 2_147_483_647);
  if (
    signupIntentsLimitsIssues(draft, ceiling).length > 0
    || !REQUEST_ID.test(requestId)
    || reason === null
    || maximum === null
    || minimum === null
    || revision === null
  ) return null;
  return {
    contract_version: SIGNUP_INTENTS_CONTRACT_VERSION,
    request_id: requestId,
    expected_intents_revision: revision,
    audit_reason: reason,
    selection_max: maximum,
    selection_required_min: minimum,
  };
}

/** A persisted request id is reused only when it is still a v4 UUID. */
export function signupIntentsLimitsRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

/**
 * The intents singleton's limits, from any body that carries the block.
 *
 * `selection_min` is pinned to the literal 0 it must stay forever (risk K-1:
 * the installed iOS decoder asserts it and throws out of the whole schema-2
 * catalogue on anything else), and `selection_required_min` — the additive key
 * that carries the real minimum — defaults to 0 on a Core that predates T-702.
 */
export function signupIntentsSelectionLimits(value: unknown): SignupIntentsSelectionLimits | null {
  const source = record(value);
  const revision = integer(source?.intents_revision, 1, 2_147_483_647);
  const maximum = integer(source?.selection_max, 1, SIGNUP_INTENTS_SELECTION_MAX_CEILING);
  const minimum = source?.selection_required_min === undefined
    ? 0
    : integer(source.selection_required_min, 0, SIGNUP_INTENTS_SELECTION_MAX_CEILING);
  if (
    !source
    || source.schema_version !== 2
    || source.selection_min !== 0
    || revision === null
    || maximum === null
    || minimum === null
    || minimum > maximum
  ) return null;
  return {
    intents_revision: revision,
    selection_required_min: minimum,
    selection_max: maximum,
  };
}

function dataSuccess(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  return source?.success === true && source.status_code === 200 ? record(source.data) : null;
}

/** `audience_visibility_catalog`'s 200, read for the one axis this write guards on. */
export function signupIntentsLimitsRead(value: unknown): SignupIntentsSelectionLimits | null {
  const data = dataSuccess(value);
  return data?.contract_version === SIGNUP_INTENTS_CONTRACT_VERSION
    ? signupIntentsSelectionLimits(data.intents)
    : null;
}

/** The accepted write: the whole singleton beside the replay flag. */
export function signupIntentsLimitsSaved(
  value: unknown,
): { limits: SignupIntentsSelectionLimits; replayed: boolean } | null {
  const data = dataSuccess(value);
  const limits = data?.contract_version === SIGNUP_INTENTS_CONTRACT_VERSION
    ? signupIntentsSelectionLimits(data.intents)
    : null;
  return limits && typeof data?.replayed === "boolean"
    ? { limits, replayed: data.replayed }
    : null;
}

/**
 * A lost race. The 409 carries the CURRENT singleton, so the console recovers
 * authority from the refusal itself instead of guessing a revision.
 */
export function signupIntentsLimitsConflict(value: unknown): SignupIntentsSelectionLimits | null {
  const source = record(value);
  if (
    source?.success !== false
    || source.status_code !== 409
    || source.error !== "audience-visibility-conflict"
  ) return null;
  const data = record(source.data);
  return data?.contract_version === SIGNUP_INTENTS_CONTRACT_VERSION
    ? signupIntentsSelectionLimits(data.intents)
    : null;
}

/**
 * The pure parser's refusal. It carries no `details`, so the caller renders the
 * per-field rows `signupIntentsLimitsIssues` derives from Core's own rule.
 */
export function signupIntentsLimitsRefused(value: unknown): boolean {
  const source = record(value);
  return source?.success === false
    && source.status_code === 422
    && source.error === "audience-visibility-request-invalid";
}

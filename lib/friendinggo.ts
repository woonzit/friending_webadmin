import { isCanonicalCannedEmailHtml } from "@/lib/cannedTemplates";
import { webadminErrorEnvelope } from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/**
 * FriendingGO preorders (D-153, T-937): the console's closed model of Core's five Webadmin routes
 * (`docs/GO_PREORDERS_V1.md`, contract version 1).
 *
 * This module closes what the same-origin bridge forwards (exactly the fields each route accepts,
 * already canonical, plus `contract_version=1`) and parses Core's answers, failing closed: a
 * partial, loosely typed, self-contradicting or mismatched answer is an error, never a list an
 * operator could read as "nobody signed up" or a send it could read as done. The bridge runs the
 * same parsers before anything reaches the browser and adds one floor of its own: an operator
 * without a write role never receives an unmasked address or phone number, whatever Core sends.
 */

export const FRIENDINGGO_CONTRACT_VERSION = 1 as const;

export const FRIENDINGGO_ACTIONS = [
  "go_preorders",
  "go_preorder_set_status",
  "go_email_preview",
  "go_email_send",
  "go_email_campaigns",
] as const;
export type FriendingGoAction = (typeof FRIENDINGGO_ACTIONS)[number];

export const FRIENDINGGO_STATUSES = ["active", "unsubscribed", "bounced", "complained"] as const;
export type FriendingGoStatus = (typeof FRIENDINGGO_STATUSES)[number];
/** The two statuses an operator may set; `bounced` and `complained` come only from delivery. */
export const FRIENDINGGO_SETTABLE_STATUSES = ["active", "unsubscribed"] as const;
export type FriendingGoSettableStatus = (typeof FRIENDINGGO_SETTABLE_STATUSES)[number];
/**
 * Who made the last status change (Core round 2, contract §10.2): the person (`self`: the unsubscribe
 * link, one-click, or resubscribing there), an administrator in this console (`admin`), or delivery
 * feedback (`feedback`: a bounce, a spam report, a Mailgun unsubscribe). `null` until the first change.
 */
export const FRIENDINGGO_STATUS_SOURCES = ["self", "admin", "feedback"] as const;
export type FriendingGoStatusSource = (typeof FRIENDINGGO_STATUS_SOURCES)[number];
/** The Email delivery log's states, which Core joins onto a confirmation and a recipient. */
export const FRIENDINGGO_DELIVERY_STATES = ["delivered", "pending", "retrying", "failed", "not_sent"] as const;
export type FriendingGoDeliveryState = (typeof FRIENDINGGO_DELIVERY_STATES)[number];
/** A confirmation may also be `skipped` (round 2: at most three a day per base mailbox); it has no outbox row then. */
export type FriendingGoConfirmationState = FriendingGoDeliveryState | "skipped";
/** A campaign's delivery counts add `purged`: a queued message whose outbox row is gone (30 days). */
export const FRIENDINGGO_DELIVERY_COUNT_KEYS = [...FRIENDINGGO_DELIVERY_STATES, "purged"] as const;
export type FriendingGoDeliveryCountKey = (typeof FRIENDINGGO_DELIVERY_COUNT_KEYS)[number];
export const FRIENDINGGO_KINDS = ["direct", "newsletter"] as const;
export type FriendingGoKind = (typeof FRIENDINGGO_KINDS)[number];
export const FRIENDINGGO_CAMPAIGN_STATES = ["draft", "sending", "sent"] as const;
export type FriendingGoCampaignState = (typeof FRIENDINGGO_CAMPAIGN_STATES)[number];
export const FRIENDINGGO_AUDIENCES = ["selected", "all_active"] as const;
export type FriendingGoAudience = (typeof FRIENDINGGO_AUDIENCES)[number];
/** `resume` (Core round 3) finishes a `sending` campaign whose own request is gone, under a fresh request id. */
export const FRIENDINGGO_SEND_MODES = ["test", "send", "save_draft", "resume"] as const;
export type FriendingGoSendMode = (typeof FRIENDINGGO_SEND_MODES)[number];
export const FRIENDINGGO_RECIPIENT_STATES = ["queued", "suppressed"] as const;
export type FriendingGoRecipientState = (typeof FRIENDINGGO_RECIPIENT_STATES)[number];

/** Core's `GoPreorderPolicy` bounds. */
export const FRIENDINGGO_PAGE_SIZE = 50;
export const FRIENDINGGO_CAPS: Readonly<Record<FriendingGoKind, number>> = { direct: 100, newsletter: 5000 };
export const FRIENDINGGO_EXPORT_LIMIT = 5000;
export const FRIENDINGGO_SUBJECT_MAX = 150;
export const FRIENDINGGO_PREHEADER_MAX = 200;
/**
 * One body limit, 50,000 characters (Core round 2, `GoPreorderPolicy::BODY_MAX`): Core checks it on the
 * body as submitted (`go-email-body-too-large`) and its sanitizer applies the same limit to its output.
 * The tag set is the canned templates' (`CannedTemplateHtmlSanitizer`), whose validator caps at 50,000 too.
 */
export const FRIENDINGGO_BODY_MAX = 50_000;
export const FRIENDINGGO_QUERY_MAX = 100;
export const FRIENDINGGO_MERGE_TAGS = ["{{first_name}}", "{{city}}"] as const;
export const FRIENDINGGO_SAMPLE = {
  first_name: "Alex",
  city: "Raleigh, NC",
  unsubscribe_url: "https://friending.com/go/unsubscribe.php?t=preview",
} as const;
const MAX_PAGE = 9999;
/** `expected_sendable` on the wire: `0|[1-9][0-9]{0,4}`; the console never confirms more than the newsletter cap. */
const MAX_EXPECTED_SENDABLE = FRIENDINGGO_CAPS.newsletter;
/** A preview document larger than this is not Core's layout around a 50,000-character body. */
const PREVIEW_HTML_MAX = 400_000;
const MASK = "•••";

export type FriendingGoListFilters = { q: string; status: FriendingGoStatus | ""; page: number };
export const DEFAULT_FRIENDINGGO_LIST_FILTERS: FriendingGoListFilters = { q: "", status: "", page: 1 };

export type FriendingGoPreorder = {
  id: string;
  name: string;
  first_name: string;
  email: string;
  phone: string | null;
  city_label: string;
  city_id: string | null;
  city_from_list: boolean;
  status: FriendingGoStatus;
  status_changed_at: number;
  status_source: FriendingGoStatusSource | null;
  source: string;
  consent: { text_version: string; captured_at: number };
  /** Whether the console may turn this address back on: only an unsubscribe an administrator made (contract §10.2). */
  can_resubscribe: boolean;
  confirmation: { outbound_id: string | null; state: FriendingGoConfirmationState | null };
  created_at: number;
  updated_at: number;
};
export type FriendingGoTotals = Record<"all" | FriendingGoStatus, number>;
export type FriendingGoPreorderList = {
  contract_version: 1;
  filters: FriendingGoListFilters;
  totals: FriendingGoTotals;
  matching: number;
  page: number;
  page_size: number;
  has_more: boolean;
  can_see_addresses: boolean;
  can_write: boolean;
  rows: FriendingGoPreorder[];
};
export type FriendingGoExport = {
  contract_version: 1;
  export: true;
  filters: { q: string; status: FriendingGoStatus | "" };
  limit: number;
  row_count: number;
  truncated: boolean;
  audit_id: string;
  rows: FriendingGoPreorder[];
};
export type FriendingGoReceipt = { request_id: string; audit_id: string; replayed: boolean };
export type FriendingGoStatusResult = {
  contract_version: 1;
  changed: boolean;
  preorder: FriendingGoPreorder;
  receipt: FriendingGoReceipt;
};
export const FRIENDINGGO_SUPPRESSION_REASONS = ["unsubscribed", "bounced", "complained"] as const;
export type FriendingGoSuppressionReason = (typeof FRIENDINGGO_SUPPRESSION_REASONS)[number];
/** Who is left out, by reason; the reasons add up to `suppressed` (review P3-9, every count since Core round 2). */
export type FriendingGoReasons = Record<FriendingGoSuppressionReason, number>;
export type FriendingGoCounts = { selected: number; sendable: number; suppressed: number; suppressed_by_reason: FriendingGoReasons };
export type FriendingGoPreview = {
  contract_version: 1;
  kind: FriendingGoKind;
  subject: string;
  preheader: string;
  body_html: string;
  html: string;
  sample: { first_name: string; city: string; unsubscribe_url: string };
  merge_tags: string[];
  counts: FriendingGoCounts;
  cap: number;
};
export type FriendingGoCampaignCounts = { selected: number; queued: number; suppressed: number; suppressed_by_reason: FriendingGoReasons };
export type FriendingGoCampaign = {
  id: string;
  kind: FriendingGoKind;
  state: FriendingGoCampaignState;
  subject: string;
  preheader: string;
  audience: { mode: FriendingGoAudience; count: number | null };
  counts: FriendingGoCampaignCounts | null;
  created_by: string;
  sent_by: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
};
/** How far a send is: preorders processed (queued or left out) of the audience. */
export type FriendingGoProgress = { processed: number; total: number };
/**
 * A campaign as the list and the detail read it (Core round 3): `resumable` (a `sending` campaign with no
 * progress for 120 s, which `mode=resume` may finish) and its `progress` (`null` for a draft).
 */
export type FriendingGoListedCampaign = FriendingGoCampaign & { resumable: boolean; progress: FriendingGoProgress | null };
export type FriendingGoCampaignDetailCampaign = Omit<FriendingGoListedCampaign, "audience"> & {
  audience: { mode: FriendingGoAudience; count: number | null; preorder_ids: string[] };
  body_html: string;
};
export type FriendingGoRecipient = {
  preorder_id: string;
  name: string | null;
  email: string;
  state: FriendingGoRecipientState;
  suppressed_reason: Exclude<FriendingGoStatus, "active"> | null;
  outbound_id: string | null;
  delivery_state: FriendingGoDeliveryState | null;
  delivered_at: number | null;
  created_at: number;
};
export const FRIENDINGGO_CAMPAIGN_FILTERS = ["", ...FRIENDINGGO_CAMPAIGN_STATES] as const;
export type FriendingGoCampaignFilter = (typeof FRIENDINGGO_CAMPAIGN_FILTERS)[number];
export type FriendingGoCampaignList = {
  contract_version: 1;
  filters: { state: FriendingGoCampaignFilter };
  page: number;
  page_size: number;
  has_more: boolean;
  campaigns: FriendingGoListedCampaign[];
};
export type FriendingGoCampaignDetail = {
  contract_version: 1;
  campaign: FriendingGoCampaignDetailCampaign;
  delivery_counts: Record<FriendingGoDeliveryCountKey, number>;
  page: number;
  page_size: number;
  has_more: boolean;
  can_see_addresses: boolean;
  recipients: FriendingGoRecipient[];
};
export type FriendingGoSendResult =
  | { contract_version: 1; mode: "test"; to: string; outbound_id: string; receipt: FriendingGoReceipt }
  | { contract_version: 1; mode: "save_draft"; campaign: FriendingGoCampaign; receipt: FriendingGoReceipt }
  /** Core slices a send (and a resume): `campaign.state` is `sending` until the last call answers `sent`. */
  | { contract_version: 1; mode: "send" | "resume"; campaign: FriendingGoCampaign; progress: FriendingGoProgress; receipt: FriendingGoReceipt };

/** What the browser sends for a preview (and, with the send fields, for a send). Canonical. */
export type FriendingGoEmailContent = {
  kind: FriendingGoKind;
  subject: string;
  preheader: string;
  body_html: string;
  audience: FriendingGoAudience;
  preorder_ids: string[];
};
export type FriendingGoSendBody =
  | { mode: "test"; kind: FriendingGoKind; subject: string; preheader: string; body_html: string; request_id: string }
  | (FriendingGoEmailContent & { mode: "save_draft"; campaign_id: string; request_id: string })
  | (FriendingGoEmailContent & { mode: "send"; campaign_id: string; request_id: string; expected_sendable: number })
  /** Finish a stalled send: the campaign and a fresh request id, nothing else (Core round 3). */
  | { mode: "resume"; campaign_id: string; request_id: string };
export type FriendingGoStatusBody = { preorder_id: string; status: FriendingGoSettableStatus; request_id: string };

// ------------------------------------------------------------------ primitives

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const epoch = (value: unknown): value is number => count(value) && value > 0;
/** A float Core may send integer-valued (`delivered_at`). */
const instant = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const codePoints = (value: string): number => [...value].length;
const boundedText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && codePoints(value) >= min && codePoints(value) <= max;

const OBJECT_ID = /^[a-f0-9]{24}$/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CITY_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const CONSENT_VERSION = /^[A-Za-z0-9._-]{1,40}$/u;
const PHONE = /^\+1[2-9]\d{2}[2-9]\d{6}$/u;
const MASKED_PHONE = /^\+1•••••••\d{3}$/u;
const MASKED_EMAIL = /^[^\s@•]{0,2}•••@[^\s@•]{1,253}$/u;
const EMAIL = /^[^\s@•]{1,64}@[^\s@•]{1,253}$/u;
const AUDIT_ID = /^[A-Za-z0-9:_-]{1,200}$/u;
const CONTROL = /\p{Cc}/u;

export const isFriendingGoObjectId = (value: unknown): value is string => typeof value === "string" && OBJECT_ID.test(value);
export const isFriendingGoRequestId = (value: unknown): value is string => typeof value === "string" && REQUEST_ID.test(value);
const address = (value: unknown): value is string => typeof value === "string" && value.length <= 320 && EMAIL.test(value);

// ------------------------------------------------------------------ capability

/**
 * Core's `admin_me.friendinggo`: exactly `{ready: true, contract_version: 1}`. Anything else (an older
 * Core without the block, another version, a loose value) keeps the section away.
 */
export function friendingGoAdminMe(value: unknown): boolean {
  const block = record(value);
  return Boolean(block && exactKeys(block, ["ready", "contract_version"])
    && block.ready === true && block.contract_version === FRIENDINGGO_CONTRACT_VERSION);
}

/** The section's readiness for one `admin_me` membership document. */
export function friendingGoConsoleReady(membership: unknown): boolean {
  return friendingGoAdminMe(record(membership)?.friendinggo);
}

/**
 * The bridge's capability gate: `null` for every other action; for a FriendingGO action, whether Core
 * advertises the section. A Core without the block never receives a FriendingGO call.
 */
export function friendingGoProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  return oneOf(FRIENDINGGO_ACTIONS, action) ? friendingGoConsoleReady(membership) : null;
}

// ------------------------------------------------------------------ canonical input

/**
 * Core's search grammar (`GoPreorderPolicy::parseList`): trimmed, at most 100 characters, no control
 * character, compared lower-case. The canonical form is what Core echoes in `filters.q`.
 */
export function friendingGoQuery(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL.test(value)) return null;
  const query = value.trim().toLowerCase();
  return codePoints(query) <= FRIENDINGGO_QUERY_MAX ? query : null;
}

/**
 * One line as Core stores a subject or a preheader (`normalizedLine`): no control character, every run
 * of spaces collapsed to one, trimmed. `null` when it carries a control character.
 */
export function friendingGoLine(value: unknown): string | null {
  // In a `u` regular expression a surrogate pair is one code point, so this matches only a lone half.
  if (typeof value !== "string" || CONTROL.test(value) || /[\uD800-\uDFFF]/u.test(value)) return null;
  return value.replace(/\p{Z}+/gu, " ").replace(/^ +| +$/gu, "");
}

/** The body as it travels: trimmed, NFC, and inside the canned-template tag set; `null` otherwise. */
export function friendingGoBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim().normalize("NFC");
  return codePoints(body) <= FRIENDINGGO_BODY_MAX && isCanonicalCannedEmailHtml(body) ? body : null;
}

export function friendingGoSubject(value: unknown): string | null {
  const line = friendingGoLine(value);
  return line !== null && boundedText(line, 1, FRIENDINGGO_SUBJECT_MAX) ? line : null;
}

export function friendingGoPreheader(value: unknown): string | null {
  const line = friendingGoLine(value);
  return line !== null && boundedText(line, 0, FRIENDINGGO_PREHEADER_MAX) ? line : null;
}

/** Unique ids in a stable order (Core sorts and de-duplicates them too); `null` for anything else. */
export function friendingGoIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > FRIENDINGGO_CAPS.newsletter) return null;
  if (!value.every(isFriendingGoObjectId)) return null;
  const ids = [...new Set(value as string[])].sort();
  return ids.length === value.length ? ids : null;
}

/** The filters a browser body (or the bridge's own Core params) asks for, or null for anything else. */
export function friendingGoListFilters(body: Record<string, unknown>): FriendingGoListFilters | null {
  if (!onlyKeys(body, ["q", "status", "page"])) return null;
  const { q = "", status = "", page = 1 } = body;
  const query = friendingGoQuery(q);
  if (query === null || query !== q) return null;
  if (status !== "" && !oneOf(FRIENDINGGO_STATUSES, status)) return null;
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > MAX_PAGE) return null;
  return { q: query, status: status as FriendingGoListFilters["status"], page: page as number };
}

/** The kind and the wording, each already in its canonical form, or null. */
function wording(body: Record<string, unknown>): Pick<FriendingGoEmailContent, "kind" | "subject" | "preheader" | "body_html"> | null {
  const { kind, subject, preheader, body_html: html } = body;
  if (!oneOf(FRIENDINGGO_KINDS, kind)) return null;
  if (typeof subject !== "string" || friendingGoSubject(subject) !== subject) return null;
  if (typeof preheader !== "string" || friendingGoPreheader(preheader) !== preheader) return null;
  if (typeof html !== "string" || friendingGoBody(html) !== html) return null;
  return { kind, subject, preheader, body_html: html };
}

/** The filters of a CSV export: the list's search and status, nothing else. */
export function friendingGoExportFilters(body: Record<string, unknown>): { q: string; status: FriendingGoStatus | "" } | null {
  if (!onlyKeys(body, ["q", "status"])) return null;
  const filters = friendingGoListFilters({ q: body.q ?? "", status: body.status ?? "" });
  return filters ? { q: filters.q, status: filters.status } : null;
}

/** The content of a preview, canonical and inside Core's audience rules, or null. */
export function friendingGoEmailContent(body: Record<string, unknown>): FriendingGoEmailContent | null {
  const words = wording(body);
  const { audience, preorder_ids: rawIds } = body;
  if (!words || !oneOf(FRIENDINGGO_AUDIENCES, audience)) return null;
  const { kind, subject, preheader, body_html: html } = words;
  const ids = friendingGoIds(rawIds);
  if (!ids || (rawIds as string[]).some((id, index) => ids[index] !== id)) return null;
  // `direct` is to chosen people only; `all_active` names nobody; `selected` names one to 5,000.
  if (kind === "direct" && audience !== "selected") return null;
  if (audience === "all_active" ? ids.length !== 0 : ids.length === 0) return null;
  return { kind, subject, preheader, body_html: html, audience, preorder_ids: ids };
}

const CONTENT_KEYS = ["kind", "subject", "preheader", "body_html", "audience", "preorder_ids"] as const;

/** A send command from the browser, exactly as the console builds it, or null. */
export function friendingGoSendBody(body: Record<string, unknown>): FriendingGoSendBody | null {
  const mode = body.mode;
  if (!isFriendingGoRequestId(body.request_id)) return null;
  if (mode === "test") {
    // A test goes to the operator's own address, so it carries no audience at all.
    if (!exactKeys(body, ["mode", "kind", "subject", "preheader", "body_html", "request_id"])) return null;
    const words = wording(body);
    return words ? { mode, ...words, request_id: body.request_id as string } : null;
  }
  if (mode === "resume") {
    return exactKeys(body, ["mode", "campaign_id", "request_id"]) && isFriendingGoObjectId(body.campaign_id)
      ? { mode, campaign_id: body.campaign_id, request_id: body.request_id as string }
      : null;
  }
  if (mode !== "save_draft" && mode !== "send") return null;
  const keys = [...CONTENT_KEYS, "mode", "campaign_id", "request_id", ...(mode === "send" ? ["expected_sendable"] : [])];
  if (!exactKeys(body, keys)) return null;
  const content = friendingGoEmailContent(body);
  if (!content) return null;
  if (body.campaign_id !== "" && !isFriendingGoObjectId(body.campaign_id)) return null;
  const common = { ...content, campaign_id: body.campaign_id as string, request_id: body.request_id as string };
  if (mode === "save_draft") return { mode, ...common };
  const expected = body.expected_sendable;
  if (!Number.isSafeInteger(expected) || (expected as number) < 1 || (expected as number) > MAX_EXPECTED_SENDABLE) return null;
  if ((expected as number) > content.preorder_ids.length && content.audience === "selected") return null;
  return { mode, ...common, expected_sendable: expected as number };
}

/** A status change from the browser, or null. */
export function friendingGoStatusBody(body: Record<string, unknown>): FriendingGoStatusBody | null {
  if (!exactKeys(body, ["preorder_id", "status", "request_id"])) return null;
  if (!isFriendingGoObjectId(body.preorder_id) || !oneOf(FRIENDINGGO_SETTABLE_STATUSES, body.status)
    || !isFriendingGoRequestId(body.request_id)) return null;
  return { preorder_id: body.preorder_id, status: body.status, request_id: body.request_id };
}

/**
 * A campaigns read from the browser: the list (a page, optionally of one state) or one campaign (an id
 * and a page of recipients). Core refuses a state filter together with an id.
 */
export function friendingGoCampaignsRequest(body: Record<string, unknown>): { campaign_id: string; page: number; state: FriendingGoCampaignFilter } | null {
  if (!onlyKeys(body, ["campaign_id", "page", "state"])) return null;
  const { campaign_id: id = "", page = 1, state = "" } = body;
  if (id !== "" && !isFriendingGoObjectId(id)) return null;
  if (!oneOf(FRIENDINGGO_CAMPAIGN_FILTERS, state) || (state !== "" && id !== "")) return null;
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > MAX_PAGE) return null;
  return { campaign_id: id as string, page: page as number, state };
}

/** Core's form body (`coreCall` stringifies numbers): the contract version and exactly the route's fields. */
export type FriendingGoCoreParams = Record<string, string | number>;

/**
 * The same-origin bridge forwards a FriendingGO action with exactly its closed, canonical fields and
 * `contract_version=1`, and nothing else; anything else is refused before Core is called. `undefined`
 * for every other action. `export` is never forwarded from here: the CSV has its own write route.
 */
export function normalizeFriendingGoProxyBody(
  action: string,
  body: Record<string, unknown>,
): FriendingGoCoreParams | null | undefined {
  if (!oneOf(FRIENDINGGO_ACTIONS, action)) return undefined;
  const version = { contract_version: FRIENDINGGO_CONTRACT_VERSION };
  const params = (() => {
    switch (action) {
      case "go_preorders": {
        const filters = friendingGoListFilters(body);
        return filters ? { ...version, q: filters.q, status: filters.status, page: filters.page } : null;
      }
      case "go_preorder_set_status": {
        const command = friendingGoStatusBody(body);
        return command ? { ...version, ...command } : null;
      }
      case "go_email_preview": {
        if (!exactKeys(body, CONTENT_KEYS)) return null;
        const content = friendingGoEmailContent(body);
        return content ? { ...version, ...content, preorder_ids: content.preorder_ids.join(",") } : null;
      }
      case "go_email_send": {
        const command = friendingGoSendBody(body);
        if (!command) return null;
        if (command.mode === "test" || command.mode === "resume") return { ...version, ...command };
        const { campaign_id: campaignId, ...rest } = command;
        return { ...version, ...rest, preorder_ids: command.preorder_ids.join(","), ...(campaignId ? { campaign_id: campaignId } : {}) };
      }
      case "go_email_campaigns": {
        const request = friendingGoCampaignsRequest(body);
        return request ? {
          ...version,
          page: request.page,
          ...(request.campaign_id ? { campaign_id: request.campaign_id } : {}),
          ...(request.state ? { state: request.state } : {}),
        } : null;
      }
    }
  })();
  return params ? Object.assign(Object.create(null) as FriendingGoCoreParams, params) : null;
}

// ------------------------------------------------------------------ answers

/** A success envelope with or without the legacy trio (the bridge forwards only the parsed answer). */
function successData(response: unknown): Record<string, unknown> | null {
  const envelope = record(response);
  if (envelope?.success !== true || envelope.status_code !== 200 || Object.hasOwn(envelope, "error")) return null;
  const data = record(envelope.data);
  return data && data.contract_version === FRIENDINGGO_CONTRACT_VERSION ? data : null;
}

function receipt(value: unknown): FriendingGoReceipt | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["request_id", "audit_id", "replayed"])) return null;
  if (!isFriendingGoRequestId(entry.request_id) || typeof entry.audit_id !== "string" || !AUDIT_ID.test(entry.audit_id)
    || typeof entry.replayed !== "boolean") return null;
  return { request_id: entry.request_id, audit_id: entry.audit_id, replayed: entry.replayed };
}

/** One preorder row; `masked` is the view's own `can_see_addresses === false`. */
/** The closed key set of a preorder row (Core round 2); an unknown or missing key fails the row (review P3-4). */
const PREORDER_KEYS = [
  "id", "name", "first_name", "email", "phone", "city_label", "city_id", "city_from_list", "status", "status_changed_at",
  "status_source", "can_resubscribe", "source", "consent", "confirmation", "created_at", "updated_at",
] as const;

function preorder(value: unknown, masked: boolean): FriendingGoPreorder | null {
  const row = record(value);
  if (!row || !exactKeys(row, PREORDER_KEYS) || !isFriendingGoObjectId(row.id) || !boundedText(row.name, 1, 200) || !boundedText(row.first_name, 0, 40)) return null;
  // A masked view carries only masked addresses and phones; an unmasked one never carries the mask.
  if (typeof row.email !== "string" || !(masked ? MASKED_EMAIL.test(row.email) : address(row.email))) return null;
  if (!(row.phone === null || (typeof row.phone === "string" && (masked ? MASKED_PHONE : PHONE).test(row.phone)))) return null;
  if (!boundedText(row.city_label, 0, 200) || !(row.city_id === null || (typeof row.city_id === "string" && CITY_ID.test(row.city_id)))) return null;
  if (typeof row.city_from_list !== "boolean" || (row.city_from_list && row.city_id === null)) return null;
  if (!oneOf(FRIENDINGGO_STATUSES, row.status) || !epoch(row.status_changed_at)) return null;
  if (!(row.status_source === null || oneOf(FRIENDINGGO_STATUS_SOURCES, row.status_source))) return null;
  if (!boundedText(row.source, 0, 200)) return null;
  const consent = record(row.consent);
  if (!consent || !exactKeys(consent, ["text_version", "captured_at"]) || typeof consent.text_version !== "string"
    || !CONSENT_VERSION.test(consent.text_version) || !epoch(consent.captured_at)) return null;
  const confirmation = record(row.confirmation);
  if (!confirmation || !exactKeys(confirmation, ["outbound_id", "state"])) return null;
  if (!(confirmation.outbound_id === null || isFriendingGoObjectId(confirmation.outbound_id))) return null;
  // A delivery state is read from an outbox row; `skipped` (the mailbox limit) means there is none.
  if (confirmation.outbound_id === null
    ? !(confirmation.state === null || confirmation.state === "skipped")
    : !(confirmation.state === null || oneOf(FRIENDINGGO_DELIVERY_STATES, confirmation.state))) return null;
  if (!epoch(row.created_at) || !epoch(row.updated_at) || row.updated_at < row.created_at) return null;
  // Core's rule, held to: only an unsubscribe an administrator made can be undone from the console.
  if (typeof row.can_resubscribe !== "boolean"
    || row.can_resubscribe !== (row.status === "unsubscribed" && row.status_source === "admin")) return null;
  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    email: row.email,
    phone: row.phone as string | null,
    city_label: row.city_label,
    city_id: row.city_id as string | null,
    city_from_list: row.city_from_list,
    status: row.status,
    status_changed_at: row.status_changed_at,
    status_source: row.status_source as FriendingGoStatusSource | null,
    can_resubscribe: row.can_resubscribe,
    source: row.source,
    consent: { text_version: consent.text_version, captured_at: consent.captured_at },
    confirmation: { outbound_id: confirmation.outbound_id as string | null, state: confirmation.state as FriendingGoConfirmationState | null },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function totals(value: unknown): FriendingGoTotals | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["all", ...FRIENDINGGO_STATUSES])) return null;
  if (![entry.all, ...FRIENDINGGO_STATUSES.map((status) => entry[status])].every(count)) return null;
  const sum = FRIENDINGGO_STATUSES.reduce((total, status) => total + (entry[status] as number), 0);
  if (sum !== entry.all) return null;
  return {
    all: entry.all as number,
    active: entry.active as number,
    unsubscribed: entry.unsubscribed as number,
    bounced: entry.bounced as number,
    complained: entry.complained as number,
  };
}

/** Rows newest first, unique, and matching the status filter they were listed under. */
function preorderRows(value: unknown, masked: boolean, status: FriendingGoStatus | "", limit: number): FriendingGoPreorder[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const rows: FriendingGoPreorder[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = preorder(item, masked);
    if (!parsed || seen.has(parsed.id)) return null;
    if (rows.length > 0 && rows[rows.length - 1]!.created_at < parsed.created_at) return null;
    if (status !== "" && parsed.status !== status) return null;
    seen.add(parsed.id);
    rows.push(parsed);
  }
  return rows;
}

/**
 * Core's list for exactly these filters, or null. `viewer` is the bridge's own floor: when the
 * signed-in operator holds no write role, an answer that offers addresses or writes is refused.
 */
export function friendingGoPreorders(
  response: unknown,
  filters: FriendingGoListFilters,
  options: { viewer?: boolean } = {},
): FriendingGoPreorderList | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "filters", "totals", "matching", "page", "page_size", "has_more", "can_see_addresses", "can_write", "rows"])) return null;
  // The answer is for the view that asked: a late answer for other filters is never shown.
  const echo = record(data.filters);
  if (!echo || !exactKeys(echo, ["q", "status", "page"]) || echo.q !== filters.q || echo.status !== filters.status
    || echo.page !== filters.page || data.page !== filters.page || data.page_size !== FRIENDINGGO_PAGE_SIZE) return null;
  if (typeof data.can_see_addresses !== "boolean" || typeof data.can_write !== "boolean" || typeof data.has_more !== "boolean") return null;
  if (options.viewer === true && (data.can_see_addresses || data.can_write)) return null;
  const parsedTotals = totals(data.totals);
  if (!parsedTotals || !count(data.matching)) return null;
  if (data.matching > (filters.status === "" ? parsedTotals.all : parsedTotals[filters.status])) return null;
  const rows = preorderRows(data.rows, !data.can_see_addresses, filters.status, FRIENDINGGO_PAGE_SIZE);
  if (!rows) return null;
  if (data.has_more && rows.length !== FRIENDINGGO_PAGE_SIZE) return null;
  if (rows.length + (filters.page - 1) * FRIENDINGGO_PAGE_SIZE > data.matching) return null;
  return {
    contract_version: FRIENDINGGO_CONTRACT_VERSION,
    filters: { q: filters.q, status: filters.status, page: filters.page },
    totals: parsedTotals,
    matching: data.matching,
    page: filters.page,
    page_size: FRIENDINGGO_PAGE_SIZE,
    has_more: data.has_more,
    can_see_addresses: data.can_see_addresses,
    can_write: data.can_write,
    rows,
  };
}

/** Core's export (`go_preorders` with `export=1`) for exactly these filters: every row unmasked, or null. */
export function friendingGoExport(response: unknown, filters: { q: string; status: FriendingGoStatus | "" }): FriendingGoExport | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "export", "filters", "limit", "row_count", "truncated", "audit_id", "rows"]) || data.export !== true) return null;
  const echo = record(data.filters);
  if (!echo || !exactKeys(echo, ["q", "status"]) || echo.q !== filters.q || echo.status !== filters.status) return null;
  if (data.limit !== FRIENDINGGO_EXPORT_LIMIT || !count(data.row_count) || typeof data.truncated !== "boolean") return null;
  if (typeof data.audit_id !== "string" || !AUDIT_ID.test(data.audit_id)) return null;
  const rows = preorderRows(data.rows, false, filters.status, FRIENDINGGO_EXPORT_LIMIT);
  if (!rows || rows.length !== data.row_count || (data.truncated && rows.length !== FRIENDINGGO_EXPORT_LIMIT)) return null;
  return {
    contract_version: FRIENDINGGO_CONTRACT_VERSION,
    export: true,
    filters: { q: filters.q, status: filters.status },
    limit: FRIENDINGGO_EXPORT_LIMIT,
    row_count: rows.length,
    truncated: data.truncated,
    audit_id: data.audit_id,
    rows,
  };
}

/** Core's answer to a status change: the row as it now is (a writer's view, so unmasked) and its receipt. */
export function friendingGoStatusResult(response: unknown): FriendingGoStatusResult | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "changed", "preorder", "receipt"]) || typeof data.changed !== "boolean") return null;
  const row = preorder(data.preorder, false);
  const parsedReceipt = receipt(data.receipt);
  return row && parsedReceipt
    ? { contract_version: FRIENDINGGO_CONTRACT_VERSION, changed: data.changed, preorder: row, receipt: parsedReceipt }
    : null;
}

/** Whether a status answer settles exactly this pending change. */
export function friendingGoStatusConverged(result: FriendingGoStatusResult, pending: FriendingGoStatusBody): boolean {
  return result.receipt.request_id === pending.request_id
    && result.preorder.id === pending.preorder_id
    && result.preorder.status === pending.status;
}

/** `{unsubscribed, bounced, complained}`, adding up to the left-out count. */
function reasons(value: unknown, suppressed: number): FriendingGoReasons | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, FRIENDINGGO_SUPPRESSION_REASONS)
    || !FRIENDINGGO_SUPPRESSION_REASONS.every((reason) => count(entry[reason]))) return null;
  const parsed = Object.fromEntries(FRIENDINGGO_SUPPRESSION_REASONS.map((reason) => [reason, entry[reason] as number])) as FriendingGoReasons;
  return FRIENDINGGO_SUPPRESSION_REASONS.reduce((sum, reason) => sum + parsed[reason], 0) === suppressed ? parsed : null;
}

function previewCounts(value: unknown): FriendingGoCounts | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["selected", "sendable", "suppressed", "suppressed_by_reason"])) return null;
  if (!count(entry.selected) || !count(entry.sendable) || !count(entry.suppressed)) return null;
  if (entry.selected !== entry.sendable + entry.suppressed) return null;
  const byReason = reasons(entry.suppressed_by_reason, entry.suppressed);
  return byReason ? { selected: entry.selected, sendable: entry.sendable, suppressed: entry.suppressed, suppressed_by_reason: byReason } : null;
}

/**
 * The real layout as Core rendered it, safe to place in `<iframe sandbox="" srcDoc>`: a whole document
 * that holds none of the elements a sandboxed preview has no use for, with a policy of its own added
 * first in its head (images from the FriendingGO host only, inline styles, nothing else). `null` for a
 * document that is not Core's layout.
 */
export function friendingGoPreviewDocument(html: unknown): string | null {
  if (typeof html !== "string" || html.length > PREVIEW_HTML_MAX || !/^<!doctype html>/iu.test(html)) return null;
  if (/<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|form|input|button|base|link|svg|math)\b/iu.test(html)) return null;
  if (/<meta\b[^>]*http-equiv/iu.test(html) || /<[^>]*\son[a-z]+\s*=/iu.test(html)) return null;
  const head = /<head>/iu.exec(html);
  if (!head || head.index === undefined) return null;
  const at = head.index + head[0].length;
  const policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https://friending.com; "
    + "style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";
  return `${html.slice(0, at)}${policy}${html.slice(at)}`;
}

/** Core's preview for exactly this content: the rendered layout, the sanitized body and the audience counts. */
export function friendingGoPreview(response: unknown, request: FriendingGoEmailContent): FriendingGoPreview | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "kind", "subject", "preheader", "body_html", "html", "sample", "merge_tags", "counts", "cap"])) return null;
  if (data.kind !== request.kind || data.subject !== request.subject || data.preheader !== request.preheader) return null;
  if (!isCanonicalCannedEmailHtml(data.body_html) || friendingGoPreviewDocument(data.html) === null) return null;
  const sample = record(data.sample);
  if (!sample || !exactKeys(sample, ["first_name", "city", "unsubscribe_url"]) || sample.first_name !== FRIENDINGGO_SAMPLE.first_name
    || sample.city !== FRIENDINGGO_SAMPLE.city || sample.unsubscribe_url !== FRIENDINGGO_SAMPLE.unsubscribe_url) return null;
  if (!Array.isArray(data.merge_tags) || data.merge_tags.length !== FRIENDINGGO_MERGE_TAGS.length
    || data.merge_tags.some((tag, index) => tag !== FRIENDINGGO_MERGE_TAGS[index])) return null;
  const counts = previewCounts(data.counts);
  if (!counts || data.cap !== FRIENDINGGO_CAPS[request.kind]) return null;
  // Everyone named is counted once; `all_active` counts only active rows, so nobody is left out of it.
  if (request.audience === "selected" ? counts.selected !== request.preorder_ids.length : counts.suppressed !== 0) return null;
  return {
    contract_version: FRIENDINGGO_CONTRACT_VERSION,
    kind: request.kind,
    subject: request.subject,
    preheader: request.preheader,
    body_html: data.body_html as string,
    html: data.html as string,
    sample: { ...FRIENDINGGO_SAMPLE },
    merge_tags: [...FRIENDINGGO_MERGE_TAGS],
    counts,
    cap: FRIENDINGGO_CAPS[request.kind],
  };
}

function campaignCounts(value: unknown): FriendingGoCampaignCounts | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["selected", "queued", "suppressed", "suppressed_by_reason"])) return null;
  if (!count(entry.selected) || !count(entry.queued) || !count(entry.suppressed)) return null;
  const byReason = reasons(entry.suppressed_by_reason, entry.suppressed);
  return byReason ? { selected: entry.selected, queued: entry.queued, suppressed: entry.suppressed, suppressed_by_reason: byReason } : null;
}

const SUMMARY_KEYS = ["id", "kind", "state", "subject", "preheader", "audience", "counts", "created_by", "sent_by", "created_at", "updated_at", "sent_at"] as const;

/** One campaign summary, as a draft save, a send and a resume answer it. */
function campaign(value: unknown): FriendingGoCampaign | null {
  return campaignOf(value, "answer");
}

/**
 * Whether the campaign may be finished by `mode=resume` and how far it is, as the list and the detail read
 * it (Core round 3): only a `sending` campaign is resumable; a draft has no progress; a sent one is whole.
 */
function listedState(entry: Record<string, unknown>, summary: FriendingGoCampaign): { resumable: boolean; progress: FriendingGoProgress | null } | null {
  if (typeof entry.resumable !== "boolean" || (entry.resumable && summary.state !== "sending")) return null;
  if (summary.state === "draft") return entry.progress === null ? { resumable: false, progress: null } : null;
  const progress = progressOf(entry.progress, summary, false);
  return progress ? { resumable: entry.resumable, progress } : null;
}

/** One campaign as the list reads it: the summary, `resumable` and `progress`. */
function listedCampaign(value: unknown): FriendingGoListedCampaign | null {
  const summary = campaignOf(value, "list");
  const extra = summary ? listedState(value as Record<string, unknown>, summary) : null;
  return summary && extra ? { ...summary, ...extra } : null;
}

/** One campaign as its detail read answers it: the listed campaign, its body and the audience's ids. */
function campaignWithBody(value: unknown): FriendingGoCampaignDetailCampaign | null {
  const summary = campaignOf(value, "detail");
  const entry = record(value);
  const audience = record(entry?.audience);
  if (!summary || !entry || !audience) return null;
  const extra = listedState(entry, summary);
  const ids = audience.preorder_ids;
  if (!extra || !Array.isArray(ids) || !ids.every(isFriendingGoObjectId) || new Set(ids).size !== ids.length
    || ids.length !== (summary.audience.count ?? 0)) return null;
  if (typeof entry.body_html !== "string" || !isCanonicalCannedEmailHtml(entry.body_html)) return null;
  return { ...summary, ...extra, audience: { ...summary.audience, preorder_ids: [...ids] }, body_html: entry.body_html };
}

function campaignOf(value: unknown, variant: "answer" | "list" | "detail"): FriendingGoCampaign | null {
  const entry = record(value);
  const keys = [...SUMMARY_KEYS, ...(variant === "answer" ? [] : ["resumable", "progress"]), ...(variant === "detail" ? ["body_html"] : [])];
  const detail = variant === "detail";
  if (!entry || !exactKeys(entry, keys)) return null;
  if (!isFriendingGoObjectId(entry.id) || !oneOf(FRIENDINGGO_KINDS, entry.kind) || !oneOf(FRIENDINGGO_CAMPAIGN_STATES, entry.state)) return null;
  if (!boundedText(entry.subject, 1, FRIENDINGGO_SUBJECT_MAX) || !boundedText(entry.preheader, 0, FRIENDINGGO_PREHEADER_MAX)) return null;
  const audience = record(entry.audience);
  if (!audience || !exactKeys(audience, detail ? ["mode", "count", "preorder_ids"] : ["mode", "count"])) return null;
  if (!oneOf(FRIENDINGGO_AUDIENCES, audience.mode) || !(audience.count === null || count(audience.count))) return null;
  // Only an `all_active` draft has no count yet: a send snapshots who was active.
  if (audience.count === null && !(audience.mode === "all_active" && entry.state === "draft")) return null;
  if (entry.kind === "direct" && audience.mode !== "selected") return null;
  if (!address(entry.created_by) || !epoch(entry.created_at) || !epoch(entry.updated_at) || entry.updated_at < entry.created_at) return null;
  const counts = entry.counts === null ? null : campaignCounts(entry.counts);
  if (entry.state === "draft") {
    // A draft has not been sent: no counts, no sender, no time.
    if (entry.counts !== null || entry.sent_by !== null || entry.sent_at !== null) return null;
  } else {
    if (!counts || !address(entry.sent_by) || !epoch(entry.sent_at) || entry.sent_at < entry.created_at) return null;
    if (counts.selected !== audience.count) return null;
    // Sent: everyone is accounted for. Sending (a sliced send, Core round 2): the counts so far.
    if (entry.state === "sent" ? counts.selected !== counts.queued + counts.suppressed
      : counts.queued + counts.suppressed > counts.selected) return null;
  }
  return {
    id: entry.id,
    kind: entry.kind,
    state: entry.state,
    subject: entry.subject,
    preheader: entry.preheader,
    audience: { mode: audience.mode, count: audience.count as number | null },
    counts,
    created_by: entry.created_by,
    sent_by: entry.sent_by as string | null,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    sent_at: entry.sent_at as number | null,
  };
}

/** Core's answer to a test send, a draft save or a send, for exactly that command. */
export function friendingGoSendResult(response: unknown, command: FriendingGoSendBody): FriendingGoSendResult | null {
  const data = successData(response);
  if (!data || data.mode !== command.mode) return null;
  const parsedReceipt = receipt(data.receipt);
  if (!parsedReceipt || parsedReceipt.request_id !== command.request_id) return null;
  if (command.mode === "test") {
    if (!exactKeys(data, ["contract_version", "mode", "to", "outbound_id", "receipt"]) || !address(data.to)
      || !isFriendingGoObjectId(data.outbound_id)) return null;
    return { contract_version: FRIENDINGGO_CONTRACT_VERSION, mode: "test", to: data.to, outbound_id: data.outbound_id, receipt: parsedReceipt };
  }
  if (!exactKeys(data, ["contract_version", "mode", "campaign", ...(command.mode === "save_draft" ? [] : ["progress"]), "receipt"])) return null;
  const parsed = campaign(data.campaign);
  if (!parsed) return null;
  if (command.mode === "resume") {
    // A resume names only its campaign; the content is the campaign's own.
    const progress = progressOf(data.progress, parsed, true);
    return parsed.id === command.campaign_id && parsed.state !== "draft" && progress
      ? { contract_version: FRIENDINGGO_CONTRACT_VERSION, mode: "resume", campaign: parsed, progress, receipt: parsedReceipt }
      : null;
  }
  // The campaign is the one this command wrote: its kind and wording, its draft when it named one, its state.
  if (parsed.kind !== command.kind || parsed.subject !== command.subject || parsed.preheader !== command.preheader
    || parsed.audience.mode !== command.audience) return null;
  if (command.campaign_id !== "" && parsed.id !== command.campaign_id) return null;
  if (command.mode === "save_draft") {
    return parsed.state === "draft"
      ? { contract_version: FRIENDINGGO_CONTRACT_VERSION, mode: "save_draft", campaign: parsed, receipt: parsedReceipt }
      : null;
  }
  const progress = progressOf(data.progress, parsed, true);
  return parsed.state !== "draft" && progress
    ? { contract_version: FRIENDINGGO_CONTRACT_VERSION, mode: command.mode, campaign: parsed, progress, receipt: parsedReceipt }
    : null;
}

/**
 * A campaign's progress: the preorders processed (queued or left out) of the audience. A send or resume
 * answer that says `sending` has some left to do (`strict`); a listed `sending` campaign may have written
 * its last batch before it was marked `sent`.
 */
function progressOf(value: unknown, sent: FriendingGoCampaign, strict: boolean): FriendingGoProgress | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["processed", "total"]) || !count(entry.processed) || !count(entry.total)) return null;
  const counts = sent.counts;
  if (!counts || entry.total !== counts.selected || entry.processed !== counts.queued + counts.suppressed) return null;
  if (sent.state === "sent" ? entry.processed !== entry.total : strict ? entry.processed >= entry.total : entry.processed > entry.total) return null;
  return { processed: entry.processed, total: entry.total };
}

/** Core's campaign list for this page and state filter: newest first, every state unless filtered. */
export function friendingGoCampaigns(response: unknown, page: number, state: FriendingGoCampaignFilter = ""): FriendingGoCampaignList | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "filters", "page", "page_size", "has_more", "campaigns"])) return null;
  const echo = record(data.filters);
  if (!echo || !exactKeys(echo, ["state"]) || echo.state !== state) return null;
  if (data.page !== page || data.page_size !== FRIENDINGGO_PAGE_SIZE || typeof data.has_more !== "boolean") return null;
  if (!Array.isArray(data.campaigns) || data.campaigns.length > FRIENDINGGO_PAGE_SIZE) return null;
  if (data.has_more && data.campaigns.length !== FRIENDINGGO_PAGE_SIZE) return null;
  const campaigns: FriendingGoListedCampaign[] = [];
  for (const item of data.campaigns) {
    const parsed = listedCampaign(item);
    if (!parsed || campaigns.some((seen) => seen.id === parsed.id) || (state !== "" && parsed.state !== state)) return null;
    if (campaigns.length > 0 && campaigns[campaigns.length - 1]!.created_at < parsed.created_at) return null;
    campaigns.push(parsed);
  }
  return { contract_version: FRIENDINGGO_CONTRACT_VERSION, filters: { state }, page, page_size: FRIENDINGGO_PAGE_SIZE, has_more: data.has_more, campaigns };
}

function recipient(value: unknown, masked: boolean): FriendingGoRecipient | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ["preorder_id", "name", "email", "state", "suppressed_reason", "outbound_id", "delivery_state", "delivered_at", "created_at"])) return null;
  if (!isFriendingGoObjectId(entry.preorder_id) || !(entry.name === null || boundedText(entry.name, 0, 200))) return null;
  if (typeof entry.email !== "string" || !(masked ? MASKED_EMAIL.test(entry.email) : address(entry.email))) return null;
  if (!oneOf(FRIENDINGGO_RECIPIENT_STATES, entry.state) || !epoch(entry.created_at)) return null;
  if (entry.state === "suppressed") {
    // Recorded and counted, never mailed: a reason, no message, no delivery.
    if (!oneOf(["unsubscribed", "bounced", "complained"] as const, entry.suppressed_reason) || entry.outbound_id !== null
      || entry.delivery_state !== null || entry.delivered_at !== null) return null;
  } else {
    if (entry.suppressed_reason !== null || !isFriendingGoObjectId(entry.outbound_id)) return null;
    if (!(entry.delivery_state === null || oneOf(FRIENDINGGO_DELIVERY_STATES, entry.delivery_state))) return null;
    // A delivery time is read from the outbox row, so it comes with a state (a delayed bounce keeps it).
    if (!(entry.delivered_at === null || (instant(entry.delivered_at) && entry.delivery_state !== null))) return null;
  }
  return {
    preorder_id: entry.preorder_id,
    name: entry.name as string | null,
    email: entry.email,
    state: entry.state,
    suppressed_reason: entry.suppressed_reason as FriendingGoRecipient["suppressed_reason"],
    outbound_id: entry.outbound_id as string | null,
    delivery_state: entry.delivery_state as FriendingGoDeliveryState | null,
    delivered_at: entry.delivered_at as number | null,
    created_at: entry.created_at,
  };
}

/**
 * One campaign and a page of its recipients, for exactly this campaign and page. `viewer` is the
 * bridge's floor, as for the list.
 */
export function friendingGoCampaignDetail(
  response: unknown,
  campaignId: string,
  page: number,
  options: { viewer?: boolean } = {},
): FriendingGoCampaignDetail | null {
  const data = successData(response);
  if (!data || !exactKeys(data, ["contract_version", "campaign", "delivery_counts", "page", "page_size", "has_more", "can_see_addresses", "recipients"])) return null;
  if (data.page !== page || data.page_size !== FRIENDINGGO_PAGE_SIZE || typeof data.has_more !== "boolean") return null;
  if (typeof data.can_see_addresses !== "boolean" || (options.viewer === true && data.can_see_addresses)) return null;
  const parsed = campaignWithBody(data.campaign);
  if (!parsed || parsed.id !== campaignId) return null;
  const deliveries = record(data.delivery_counts);
  if (!deliveries || !exactKeys(deliveries, FRIENDINGGO_DELIVERY_COUNT_KEYS)
    || !FRIENDINGGO_DELIVERY_COUNT_KEYS.every((key) => count(deliveries[key]))) return null;
  const deliveryCounts = Object.fromEntries(FRIENDINGGO_DELIVERY_COUNT_KEYS.map((key) => [key, deliveries[key] as number])) as
    Record<FriendingGoDeliveryCountKey, number>;
  const delivered = FRIENDINGGO_DELIVERY_COUNT_KEYS.reduce((sum, key) => sum + deliveryCounts[key], 0);
  // Every queued message is counted once, in its delivery state or as purged.
  if (parsed.state === "sent" ? delivered !== parsed.counts!.queued : parsed.state === "draft" && delivered !== 0) return null;
  if (!Array.isArray(data.recipients) || data.recipients.length > FRIENDINGGO_PAGE_SIZE) return null;
  if (data.has_more && data.recipients.length !== FRIENDINGGO_PAGE_SIZE) return null;
  const recipients: FriendingGoRecipient[] = [];
  for (const item of data.recipients) {
    const row = recipient(item, !data.can_see_addresses);
    // By preorder id, each once.
    if (!row || (recipients.length > 0 && recipients[recipients.length - 1]!.preorder_id >= row.preorder_id)) return null;
    recipients.push(row);
  }
  const total = parsed.counts?.selected ?? 0;
  if (recipients.length + (page - 1) * FRIENDINGGO_PAGE_SIZE > total) return null;
  return {
    contract_version: FRIENDINGGO_CONTRACT_VERSION,
    campaign: parsed,
    delivery_counts: deliveryCounts,
    page,
    page_size: FRIENDINGGO_PAGE_SIZE,
    has_more: data.has_more,
    can_see_addresses: data.can_see_addresses,
    recipients,
  };
}

// ------------------------------------------------------------------ the bridge's projection

/**
 * What the bridge sends the browser for Core's successful answer to the forwarded `params`: only the
 * parsed answer, or null (an unknown Core response) when it does not parse in full or does not belong
 * to the request. `viewer` is the floor for an operator without a write role.
 */
export function normalizeFriendingGoResponse(
  action: string,
  response: unknown,
  params: FriendingGoCoreParams,
  options: { viewer: boolean },
): { success: true; status_code: 200; data: unknown } | null {
  const { contract_version: version, ...rest } = params;
  if (version !== FRIENDINGGO_CONTRACT_VERSION) return null;
  const wrap = (data: unknown) => data ? { success: true as const, status_code: 200 as const, data } : null;
  const ids = (value: unknown) => typeof value === "string" && value !== "" ? value.split(",") : [];
  switch (action) {
    case "go_preorders": {
      const filters = friendingGoListFilters(rest);
      return filters ? wrap(friendingGoPreorders(response, filters, options)) : null;
    }
    case "go_preorder_set_status": {
      const command = friendingGoStatusBody(rest);
      const result = command ? friendingGoStatusResult(response) : null;
      return wrap(result && command && result.receipt.request_id === command.request_id ? result : null);
    }
    case "go_email_preview": {
      const content = friendingGoEmailContent({ ...rest, preorder_ids: ids(rest.preorder_ids) });
      return content ? wrap(friendingGoPreview(response, content)) : null;
    }
    case "go_email_send": {
      const body: Record<string, unknown> = { ...rest };
      if (body.mode === "save_draft" || body.mode === "send") {
        body.preorder_ids = ids(body.preorder_ids);
        body.campaign_id ??= "";
      }
      const command = friendingGoSendBody(body);
      return command ? wrap(friendingGoSendResult(response, command)) : null;
    }
    case "go_email_campaigns": {
      const request = friendingGoCampaignsRequest(rest);
      if (!request) return null;
      return wrap(request.campaign_id === ""
        ? friendingGoCampaigns(response, request.page, request.state)
        : friendingGoCampaignDetail(response, request.campaign_id, request.page, options));
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ refusals

/**
 * Every refusal the section can meet, with its logical status: Core's (`GoPreorderPolicy::ERRORS`
 * that the five Webadmin routes answer) and the bridge's own. The value is the message key under
 * `friendinggo.errors`. Anything else is `generic`.
 */
export const FRIENDINGGO_ERRORS = {
  "unauthorized": { status: 401, key: "sessionInvalid" },
  "admin-session-invalid": { status: 401, key: "sessionInvalid" },
  "admin-revoked": { status: 403, key: "sessionInvalid" },
  "admin-write-required": { status: 403, key: "writeRequired" },
  "go-request-invalid": { status: 422, key: "requestInvalid" },
  "go-filter-invalid": { status: 422, key: "filterInvalid" },
  "go-request-id-invalid": { status: 422, key: "requestInvalid" },
  "go-request-id-conflict": { status: 409, key: "requestIdConflict" },
  "go-request-in-progress": { status: 409, key: "requestInProgress" },
  "go-preorder-not-found": { status: 404, key: "preorderNotFound" },
  "go-preorder-status-invalid": { status: 422, key: "statusInvalid" },
  "go-preorder-status-locked": { status: 409, key: "statusLocked" },
  "go-email-mode-invalid": { status: 422, key: "requestInvalid" },
  "go-email-kind-invalid": { status: 422, key: "kindInvalid" },
  "go-email-content-invalid": { status: 422, key: "contentInvalid" },
  "go-email-body-too-large": { status: 422, key: "bodyTooLarge" },
  "go-email-body-invalid": { status: 422, key: "bodyInvalid" },
  "go-email-audience-invalid": { status: 422, key: "audienceInvalid" },
  "go-email-audience-empty": { status: 422, key: "audienceEmpty" },
  "go-email-audience-changed": { status: 409, key: "audienceChanged" },
  "go-email-audience-too-large": { status: 422, key: "audienceTooLarge" },
  "go-email-rate-limited": { status: 429, key: "rateLimited" },
  "go-campaign-not-found": { status: 404, key: "campaignNotFound" },
  "go-campaign-not-draft": { status: 409, key: "campaignNotDraft" },
  "go-campaign-not-resumable": { status: 409, key: "campaignNotResumable" },
  "go-preorders-unavailable": { status: 503, key: "unavailable" },
  // The same-origin bridge's refusals.
  "invalid-input": { status: 400, key: "requestInvalid" },
  "too-large": { status: 413, key: "requestInvalid" },
  "friendinggo-capability-required": { status: 403, key: "capabilityRequired" },
  "core-timeout": { status: 504, key: "outcomeUnknown" },
  "core-unavailable": { status: 502, key: "coreUnavailable" },
  "invalid-core-response": { status: 502, key: "outcomeUnknown" },
  "admin-request-outcome-unknown": { status: 502, key: "outcomeUnknown" },
  "admin-membership-unconfirmed": { status: 503, key: "membershipUnconfirmed" },
} as const satisfies Record<string, { status: number; key: string }>;
export type FriendingGoError = keyof typeof FRIENDINGGO_ERRORS;
/** The console's own two messages: an unnamed failure, and a browser that cannot keep a request for its retry. */
export const FRIENDINGGO_CONSOLE_ERROR_KEYS = ["generic", "storageUnavailable"] as const;
export type FriendingGoErrorKey = (typeof FRIENDINGGO_ERRORS)[FriendingGoError]["key"] | (typeof FRIENDINGGO_CONSOLE_ERROR_KEYS)[number];

/**
 * A write whose outcome these answers do not settle: the request may have run. The pending command
 * is kept and retried with the SAME request id. Every other named refusal is final for its id (Core
 * stores a receipted refusal), so the next attempt draws a new one.
 */
const OUTCOME_UNKNOWN: ReadonlySet<string> = new Set([
  "go-request-in-progress",
  "go-preorders-unavailable",
  "core-timeout",
  "core-unavailable",
  "invalid-core-response",
  "admin-request-outcome-unknown",
  "admin-membership-unconfirmed",
]);

/** The named refusal of an answer, when its status is the one that name carries; otherwise null. */
export function friendingGoError(response: unknown): FriendingGoError | null {
  const envelope = webadminErrorEnvelope(response, "required") ?? webadminErrorEnvelope(response) ?? adminBridgeErrorEnvelope(response);
  if (!envelope || !Object.hasOwn(FRIENDINGGO_ERRORS, envelope.error)) return null;
  const error = envelope.error as FriendingGoError;
  return FRIENDINGGO_ERRORS[error].status === envelope.status_code ? error : null;
}

export function friendingGoErrorKey(error: FriendingGoError | null): FriendingGoErrorKey {
  return error === null ? "generic" : FRIENDINGGO_ERRORS[error].key;
}

/** Whether a write's pending command must be kept (unknown outcome) rather than cleared. */
export function friendingGoOutcomeUnknown(response: unknown): boolean {
  // `null`: the caller gave up or the page is leaving for /login; the request may have been sent.
  if (response === null) return true;
  const error = friendingGoError(response);
  return error === null || OUTCOME_UNKNOWN.has(error);
}

/** The audience counts a receipted send refusal carries (changed, empty, too large), and its cap. */
export function friendingGoRefusalCounts(response: unknown): { counts: FriendingGoCounts; cap: number | null } | null {
  const envelope = webadminErrorEnvelope(response, "required");
  const data = record(envelope?.data);
  const counts = previewCounts(data?.counts);
  if (!counts) return null;
  const cap = data?.cap === undefined ? null : data.cap;
  if (cap !== null && !(cap === FRIENDINGGO_CAPS.direct || cap === FRIENDINGGO_CAPS.newsletter)) return null;
  return { counts, cap: cap as number | null };
}

/** The limit of a rate-limited newsletter send: how many sends per how many seconds. */
export function friendingGoRateLimit(response: unknown): { limit: number; window_seconds: number } | null {
  const envelope = webadminErrorEnvelope(response, "required");
  const data = record(envelope?.data);
  return data && count(data.limit) && data.limit > 0 && count(data.window_seconds) && data.window_seconds > 0
    ? { limit: data.limit, window_seconds: data.window_seconds }
    : null;
}

/** Why the console may not turn an address back on; the message key under `preorders.status.locked`. */
export type FriendingGoLockReason = "self" | "feedback" | "bounced" | "complained" | "unsubscribed";

/** The reason for a status and the source that set it (contract §10.2). */
export function friendingGoLockReason(status: FriendingGoStatus, source: FriendingGoStatusSource | null): FriendingGoLockReason {
  if (status === "bounced" || status === "complained") return status;
  return source === "self" || source === "feedback" ? source : "unsubscribed";
}

/**
 * The lock of Core's `go-preorder-status-locked` refusal (`data.status`, `data.status_source`): a bounced
 * or complained row, or an unsubscribe the person or delivery feedback made. `null` for anything else.
 */
export function friendingGoLock(response: unknown): FriendingGoLockReason | null {
  const envelope = webadminErrorEnvelope(response, "required");
  const data = record(envelope?.data);
  if (envelope?.error !== "go-preorder-status-locked" || !data || !oneOf(FRIENDINGGO_STATUSES, data.status)
    || !(data.status_source === null || oneOf(FRIENDINGGO_STATUS_SOURCES, data.status_source))) return null;
  return friendingGoLockReason(data.status, data.status_source as FriendingGoStatusSource | null);
}

/**
 * Core's `go-campaign-not-resumable` (round 3): the campaign is no longer `sending` (`state`), or it is
 * still making progress and becomes resumable after `retry_after_seconds`. Final for its request id.
 */
export function friendingGoNotResumable(response: unknown): { state: FriendingGoCampaignState | null; retry_after_seconds: number | null } | null {
  const envelope = webadminErrorEnvelope(response, "required");
  const data = record(envelope?.data);
  if (envelope?.error !== "go-campaign-not-resumable" || !data) return null;
  const state = oneOf(FRIENDINGGO_CAMPAIGN_STATES, data.state) ? data.state : null;
  const seconds = count(data.retry_after_seconds) && data.retry_after_seconds > 0 ? data.retry_after_seconds : null;
  return { state, retry_after_seconds: seconds };
}

/**
 * The documented `data` fields of Core's refusals (counts and cap, receipt, rate limit, lock, wait,
 * campaign state). A refusal carrying anything else is not forwarded (review P3-5).
 */
const REFUSAL_DATA_KEYS = ["counts", "cap", "receipt", "limit", "window_seconds", "status", "status_source", "retry_after_seconds", "state"] as const;

/**
 * What the bridge sends the browser for Core's refusal of a FriendingGO action: the canonical Webadmin
 * envelope with a known error name at its own status and only the documented data fields, each parsed.
 * `null` (an unknown Core response) for anything else, so nothing unparsed reaches the page.
 */
export function normalizeFriendingGoRefusal(response: unknown, status: number): Record<string, unknown> | null {
  const envelope = webadminErrorEnvelope(response, "required") ?? webadminErrorEnvelope(response);
  if (!envelope || envelope.status_code !== status || !Object.hasOwn(FRIENDINGGO_ERRORS, envelope.error)) return null;
  const error = envelope.error as FriendingGoError;
  if (FRIENDINGGO_ERRORS[error].status !== status) return null;
  const base = { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 };
  if (!Object.hasOwn(envelope, "data")) return base;
  const raw = record(envelope.data);
  if (!raw || !onlyKeys(raw, REFUSAL_DATA_KEYS)) return null;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    const parsed = key === "counts" ? previewCounts(value)
      : key === "receipt" ? receipt(value)
        : key === "cap" ? (value === FRIENDINGGO_CAPS.direct || value === FRIENDINGGO_CAPS.newsletter ? value : null)
          : key === "status" ? (oneOf(FRIENDINGGO_STATUSES, value) ? value : null)
            : key === "status_source" ? (value === null || oneOf(FRIENDINGGO_STATUS_SOURCES, value) ? value ?? "null" : null)
              : key === "state" ? (oneOf(FRIENDINGGO_CAMPAIGN_STATES, value) ? value : null)
                : count(value) && value > 0 ? value : null;
    if (parsed === null) return null;
    data[key] = key === "status_source" && parsed === "null" ? null : parsed;
  }
  return { ...base, data };
}

/** How long Core asks to wait before the same request id is tried again (`go-request-in-progress`). */
export function friendingGoRetryAfter(response: unknown): number | null {
  const envelope = webadminErrorEnvelope(response, "required");
  const seconds = record(envelope?.data)?.retry_after_seconds;
  return envelope?.error === "go-request-in-progress" && count(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Whether a row's status may be changed from the console, and to what: an active row may always be
 * unsubscribed; an unsubscribed one turned back on only when Core says so (`can_resubscribe`, true for
 * an administrator's unsubscribe only); bounced and complained rows never.
 */
export function friendingGoNextStatus(row: Pick<FriendingGoPreorder, "status" | "can_resubscribe">): FriendingGoSettableStatus | null {
  if (row.status === "active") return "unsubscribed";
  return row.status === "unsubscribed" && row.can_resubscribe ? "active" : null;
}

export { MASK as FRIENDINGGO_MASK };

/** Closed browser model for the canned-template Webadmin contract v1. */

export const CANNED_TEMPLATE_CONTRACT_VERSION = 1 as const;
export const CANNED_TEMPLATE_PAGE_SIZE = 50;

export const CANNED_TEMPLATE_ACTIONS = [
  "list_canned",
  "save_canned",
  "delete_canned",
] as const;

export const CANNED_TEMPLATE_CHANNELS = ["email", "sms", "push"] as const;
export const CANNED_TEMPLATE_CAPABILITIES = [
  "canned_templates_read",
  "canned_templates_write",
] as const;

export type CannedTemplateAction = (typeof CANNED_TEMPLATE_ACTIONS)[number];
export type CannedTemplateChannel = (typeof CANNED_TEMPLATE_CHANNELS)[number];
export type CannedTemplateCapability = (typeof CANNED_TEMPLATE_CAPABILITIES)[number];
export type CannedTemplateFormat = "sanitized_html" | "plain_text";

export type CannedTemplatePrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: CannedTemplateCapability[];
};

export type CannedTemplate = {
  template_id: string;
  channel: CannedTemplateChannel;
  revision: number;
  name: string;
  format: CannedTemplateFormat;
  subject: string;
  body: string;
  created_at: number;
  created_by: string;
  updated_at: number;
  updated_by: string;
};

export type CannedTemplateListRequest = {
  contract_version: 1;
  type: CannedTemplateChannel;
  query: string;
  page_size: number;
  cursor: string;
};

export type CannedTemplateListData = {
  contract_version: 1;
  principal: CannedTemplatePrincipal;
  channel: CannedTemplateChannel;
  query: string;
  templates: CannedTemplate[];
  next_cursor: string | null;
  total: number;
};

export type CannedTemplateDraft = {
  name: string;
  subject: string;
  body: string;
  auditReason: string;
};

export type CannedTemplateDraftMaterial = {
  name: string;
  subject: string;
  body: string;
  audit_reason: string;
};

export type CannedTemplateSavePayload = {
  contract_version: 1;
  id: string;
  type: CannedTemplateChannel;
  expected_revision: number;
  request_id: string;
  audit_reason: string;
  name: string;
  subject: string;
  body: string;
};

export type CannedTemplateDeletePayload = {
  contract_version: 1;
  id: string;
  expected_revision: number;
  request_id: string;
  audit_reason: string;
};

export type CannedTemplateDeleted = {
  template_id: string;
  channel: CannedTemplateChannel;
  revision: number;
  deleted_at: number;
};

export type CannedTemplateSaveData = {
  contract_version: 1;
  template: CannedTemplate;
  replayed: boolean;
};

export type CannedTemplateDeleteData = {
  contract_version: 1;
  deleted: CannedTemplateDeleted;
  replayed: boolean;
};

export type CannedTemplateConflictData =
  | { contract_version: 1; template: CannedTemplate; deleted: null }
  | { contract_version: 1; template: null; deleted: CannedTemplateDeleted };

export type CannedTemplatePendingMutation =
  | {
      version: 1;
      action: "save";
      channel: CannedTemplateChannel;
      payload: CannedTemplateSavePayload;
    }
  | {
      version: 1;
      action: "delete";
      channel: CannedTemplateChannel;
      payload: CannedTemplateDeletePayload;
    };

export type CannedTemplateDraftError =
  | "channel"
  | "templateId"
  | "revision"
  | "requestId"
  | "auditReason"
  | "name"
  | "subject"
  | "body";

export type CannedTemplateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CannedTemplateDraftError };

const TEMPLATE_ID = /^[0-9a-f]{24}$/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR = /^[A-Za-z0-9_-]{1,256}$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const DISALLOWED_C0_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const ANY_CONTROL = /\p{Cc}/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const ACTION_SET: ReadonlySet<string> = new Set(CANNED_TEMPLATE_ACTIONS);
const ALLOWED_EMAIL_TAGS: ReadonlySet<string> = new Set([
  "p", "br", "h1", "h2", "h3", "strong", "em", "u", "ul", "ol", "li",
  "blockquote", "a",
]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  if (!raw) return null;
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? raw
    : null;
}

function integer(
  value: unknown,
  minimum: number,
  maximum = 2_147_483_647,
): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : null;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function canonicalWireText(
  value: unknown,
  minimum: number,
  maximum: number,
  controls: "text" | "body" = "body",
): string | null {
  if (typeof value !== "string"
    || value.trim() !== value
    || value.normalize("NFC") !== value
    || UNPAIRED_SURROGATE.test(value)
    || (controls === "text" ? ANY_CONTROL.test(value) : DISALLOWED_C0_CONTROL.test(value))) {
    return null;
  }
  const length = scalarLength(value);
  return length >= minimum && length <= maximum ? value : null;
}

function normalizedDraftText(
  value: unknown,
  minimum: number,
  maximum: number,
  controls: "text" | "body" = "body",
): string | null {
  if (typeof value !== "string" || UNPAIRED_SURROGATE.test(value)) return null;
  return canonicalWireText(value.trim().normalize("NFC"), minimum, maximum, controls);
}

function canonicalEmail(value: unknown): string | null {
  const parsed = canonicalWireText(value, 3, 320, "text");
  return parsed && parsed === parsed.toLowerCase() && EMAIL.test(parsed) ? parsed : null;
}

function templateId(value: unknown): string | null {
  return typeof value === "string" && TEMPLATE_ID.test(value) ? value : null;
}

function requestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

export function normalizeCannedTemplateRequestId(value: unknown): string | null {
  return typeof value === "string" ? requestId(value.toLowerCase()) : null;
}

function cursor(value: unknown, allowEmpty: boolean): string | null {
  if (allowEmpty && value === "") return "";
  return typeof value === "string" && CURSOR.test(value) ? value : null;
}

export function normalizeCannedTemplateQuery(value: unknown): string | null {
  return normalizedDraftText(value, 0, 80, "text");
}

function decodeHtmlAttribute(value: string): string | null {
  if (/&(?!amp;|quot;|apos;|lt;|gt;|#\d{1,7};|#x[0-9A-Fa-f]{1,6};)/u.test(value)) {
    return null;
  }
  let valid = true;
  const decoded = value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[0-9A-Fa-f]{1,6});/gu,
    (entity) => {
      if (entity === "&amp;") return "&";
      if (entity === "&quot;") return '"';
      if (entity === "&apos;") return "'";
      if (entity === "&lt;") return "<";
      if (entity === "&gt;") return ">";
      const hexadecimal = entity.startsWith("&#x");
      const raw = entity.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint)
        || codePoint <= 0
        || codePoint > 0x10FFFF
        || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
        valid = false;
        return "";
      }
      return String.fromCodePoint(codePoint);
    },
  );
  return valid ? decoded : null;
}

function safeCanonicalEmailHref(value: string): boolean {
  const decoded = decodeHtmlAttribute(value);
  if (!decoded || ANY_CONTROL.test(decoded) || UNPAIRED_SURROGATE.test(decoded)) return false;
  if (decoded.startsWith("mailto:")) {
    const address = decoded.slice(7).split("?", 1)[0];
    return address.length >= 3 && address.length <= 320 && EMAIL.test(address);
  }
  try {
    const parsed = new URL(decoded);
    return parsed.protocol === "https:"
      && parsed.hostname !== ""
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

function canonicalLinkAttributes(value: string): boolean {
  let remaining = value.trim();
  const seen = new Set<string>();
  let href: string | null = null;
  while (remaining !== "") {
    const match = /^([a-z]+)\s*=\s*(["'])(.*?)\2(?:\s+|$)/u.exec(remaining);
    if (!match) return false;
    const [, name, , attributeValue] = match;
    if ((name !== "href" && name !== "title") || seen.has(name)) return false;
    if (attributeValue.includes("<") || attributeValue.includes(">")) return false;
    if (name === "href") href = attributeValue;
    else if (decodeHtmlAttribute(attributeValue) === null) return false;
    seen.add(name);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return href !== null && safeCanonicalEmailHref(href);
}

/**
 * Validate the sanitizer's canonical fragment before it is ever used as HTML.
 * The accepted contract has a tiny closed tag/attribute vocabulary, so the
 * consumer can fail closed instead of trusting a provider-shaped string.
 */
export function isCanonicalCannedEmailHtml(value: unknown): value is string {
  const body = canonicalWireText(value, 1, 50_000, "body");
  if (!body || /<!--|<!DOCTYPE|<\?|<!\[CDATA\[/iu.test(body)) return false;

  const stack: string[] = [];
  const tokens = /<[^>]*>/gu;
  let end = 0;
  for (const match of body.matchAll(tokens)) {
    const index = match.index ?? -1;
    if (index < end || body.slice(end, index).includes("<")) return false;
    const token = match[0];
    const parsed = /^<(\/)?([a-z][a-z0-9]*)([^<>]*?)(\/?)>$/u.exec(token);
    if (!parsed) return false;
    const [, closing, tag, rawAttributes, selfClosing] = parsed;
    if (!ALLOWED_EMAIL_TAGS.has(tag)) return false;
    if (closing) {
      if (selfClosing || rawAttributes.trim() !== "" || stack.pop() !== tag) return false;
    } else if (tag === "br") {
      if (rawAttributes.trim() !== "") return false;
    } else {
      if (selfClosing) return false;
      if (tag === "a") {
        if (!canonicalLinkAttributes(rawAttributes)) return false;
      } else if (rawAttributes.trim() !== "") return false;
      stack.push(tag);
    }
    end = index + token.length;
  }
  return !body.slice(end).includes("<") && stack.length === 0;
}

/** Sandboxed preview document for already-canonical Core output only. */
export function cannedTemplateEmailPreviewDocument(body: unknown): string | null {
  if (!isCanonicalCannedEmailHtml(body)) return null;
  const inertBody = body
    .replace(/<a\b[^>]*>/gu, '<span class="canonical-link">')
    .replace(/<\/a>/gu, "</span>");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'"><style>html{color-scheme:light}body{margin:0;padding:20px;background:#fff;color:#14151a;font:15px/1.55 Arial,sans-serif;overflow-wrap:anywhere}.canonical-link{color:#5d61d8;text-decoration:underline}blockquote{margin:12px 0;padding-left:12px;border-left:3px solid #c9caee}h1,h2,h3{line-height:1.2}</style></head><body>${inertBody}</body></html>`;
}

function principal(value: unknown): CannedTemplatePrincipal | null {
  const raw = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, ["viewer", "admin", "owner"] as const);
  if (!raw || role === null || !Array.isArray(raw.capabilities)) return null;
  const capabilities: CannedTemplateCapability[] = [];
  for (const item of raw.capabilities) {
    const parsed = oneOf(item, CANNED_TEMPLATE_CAPABILITIES);
    if (parsed === null || capabilities.includes(parsed)) return null;
    capabilities.push(parsed);
  }
  if (!capabilities.includes("canned_templates_read")
    || capabilities.some((item, index) => index > 0 && capabilities[index - 1] > item)) {
    return null;
  }
  return { role, capabilities };
}

export function cannedTemplateCanWrite(value: CannedTemplatePrincipal): boolean {
  return value.capabilities.includes("canned_templates_write");
}

export function cannedTemplate(value: unknown): CannedTemplate | null {
  const raw = exactObject(value, [
    "template_id",
    "channel",
    "revision",
    "name",
    "format",
    "subject",
    "body",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
  ]);
  if (!raw) return null;
  const id = templateId(raw.template_id);
  const channel = oneOf(raw.channel, CANNED_TEMPLATE_CHANNELS);
  const revision = integer(raw.revision, 1);
  const name = canonicalWireText(raw.name, 1, 120, "text");
  const format = oneOf(raw.format, ["sanitized_html", "plain_text"] as const);
  const createdAt = integer(raw.created_at, 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = integer(raw.updated_at, 0, Number.MAX_SAFE_INTEGER);
  const createdBy = canonicalEmail(raw.created_by);
  const updatedBy = canonicalEmail(raw.updated_by);
  if (!id || !channel || revision === null || !name || !format
    || createdAt === null || updatedAt === null || !createdBy || !updatedBy
    || updatedAt < createdAt) return null;

  let subject: string | null = null;
  let body: string | null = null;
  if (channel === "email") {
    subject = canonicalWireText(raw.subject, 1, 200, "text");
    body = isCanonicalCannedEmailHtml(raw.body) ? raw.body : null;
    if (format !== "sanitized_html") return null;
  } else if (channel === "sms") {
    subject = raw.subject === "" ? "" : null;
    body = canonicalWireText(raw.body, 1, 1_600, "body");
    if (format !== "plain_text") return null;
  } else {
    subject = canonicalWireText(raw.subject, 1, 80, "text");
    body = canonicalWireText(raw.body, 1, 1_000, "body");
    if (format !== "plain_text") return null;
  }
  return subject === null || body === null ? null : {
    template_id: id,
    channel,
    revision,
    name,
    format,
    subject,
    body,
    created_at: createdAt,
    created_by: createdBy,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

export function cannedTemplateListPayload(
  channelValue: unknown,
  queryValue: unknown,
  cursorValue: unknown = "",
  pageSizeValue: unknown = CANNED_TEMPLATE_PAGE_SIZE,
): CannedTemplateListRequest | null {
  const channel = oneOf(channelValue, CANNED_TEMPLATE_CHANNELS);
  const query = normalizeCannedTemplateQuery(queryValue);
  const parsedCursor = cursor(cursorValue, true);
  const pageSize = integer(pageSizeValue, 1, 100);
  return !channel || query === null || parsedCursor === null || pageSize === null ? null : {
    contract_version: 1,
    type: channel,
    query,
    page_size: pageSize,
    cursor: parsedCursor,
  };
}

function templatesAreOrdered(rows: readonly CannedTemplate[]): boolean {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous.updated_at < current.updated_at) return false;
    if (previous.updated_at === current.updated_at
      && previous.template_id > current.template_id) return false;
  }
  return true;
}

export function cannedTemplateListData(
  value: unknown,
  expected: CannedTemplateListRequest,
): CannedTemplateListData | null {
  const raw = exactObject(value, [
    "contract_version",
    "principal",
    "channel",
    "query",
    "templates",
    "next_cursor",
    "total",
  ]);
  const actor = principal(raw?.principal);
  const channel = oneOf(raw?.channel, CANNED_TEMPLATE_CHANNELS);
  const query = canonicalWireText(raw?.query, 0, 80, "text");
  const nextCursor = raw?.next_cursor === null ? null : cursor(raw?.next_cursor, false);
  const total = integer(raw?.total, 0, Number.MAX_SAFE_INTEGER);
  if (!raw || raw.contract_version !== 1 || !actor || !channel || query === null
    || channel !== expected.type || query !== expected.query
    || !Array.isArray(raw.templates) || raw.templates.length > expected.page_size
    || (raw.next_cursor !== null && nextCursor === null) || total === null) return null;

  const templates: CannedTemplate[] = [];
  const ids = new Set<string>();
  for (const item of raw.templates) {
    const parsed = cannedTemplate(item);
    if (!parsed || parsed.channel !== channel || ids.has(parsed.template_id)) return null;
    ids.add(parsed.template_id);
    templates.push(parsed);
  }
  if (!templatesAreOrdered(templates)
    || total < templates.length
    || (templates.length === 0 && (total !== 0 || nextCursor !== null))
    || (expected.cursor === "" && nextCursor === null && total !== templates.length)
    || (nextCursor !== null && total <= templates.length)
    || (expected.cursor !== "" && nextCursor === expected.cursor)) return null;
  return {
    contract_version: 1,
    principal: actor,
    channel,
    query,
    templates,
    next_cursor: nextCursor,
    total,
  };
}

export function cannedTemplateListResponse(
  value: unknown,
  expected: CannedTemplateListRequest,
): CannedTemplateListData | null {
  const raw = exactObject(value, ["success", "status_code", "data"]);
  return raw?.success === true && raw.status_code === 200
    ? cannedTemplateListData(raw.data, expected)
    : null;
}

export function mergeCannedTemplatePages(
  current: CannedTemplateListData,
  next: CannedTemplateListData,
): CannedTemplateListData | null {
  if (current.next_cursor === null
    || current.channel !== next.channel
    || current.query !== next.query
    || current.total !== next.total
    || JSON.stringify(current.principal) !== JSON.stringify(next.principal)) return null;
  const templates = [...current.templates, ...next.templates];
  if (new Set(templates.map((item) => item.template_id)).size !== templates.length
    || !templatesAreOrdered(templates)
    || templates.length > current.total
    || (next.next_cursor === null && templates.length !== current.total)
    || (next.next_cursor !== null && templates.length >= current.total)) return null;
  return { ...next, templates };
}

function normalizedDraftBody(channel: CannedTemplateChannel, value: unknown): string | null {
  if (channel === "email") {
    return normalizedDraftText(value, 1, 50_000, "body");
  }
  return normalizedDraftText(value, 1, channel === "sms" ? 1_600 : 1_000, "body");
}

export function cannedTemplateDraftMaterial(
  channelValue: unknown,
  draft: CannedTemplateDraft,
): CannedTemplateResult<CannedTemplateDraftMaterial> {
  const channel = oneOf(channelValue, CANNED_TEMPLATE_CHANNELS);
  if (!channel) return { ok: false, error: "channel" };
  const name = normalizedDraftText(draft.name, 1, 120, "text");
  if (!name) return { ok: false, error: "name" };
  const auditReason = normalizedDraftText(draft.auditReason, 1, 500, "body");
  if (!auditReason) return { ok: false, error: "auditReason" };

  let subject: string | null;
  if (channel === "sms") subject = draft.subject === "" ? "" : null;
  else subject = normalizedDraftText(draft.subject, 1, channel === "push" ? 80 : 200, "text");
  if (subject === null) return { ok: false, error: "subject" };
  const body = normalizedDraftBody(channel, draft.body);
  if (!body) return { ok: false, error: "body" };
  return { ok: true, value: { name, subject, body, audit_reason: auditReason } };
}

export function cannedTemplateSavePayload(
  channelValue: unknown,
  current: CannedTemplate | null,
  draft: CannedTemplateDraft,
  requestIdValue: unknown,
): CannedTemplateResult<CannedTemplateSavePayload> {
  const channel = oneOf(channelValue, CANNED_TEMPLATE_CHANNELS);
  if (!channel || (current !== null && current.channel !== channel)) {
    return { ok: false, error: "channel" };
  }
  const canonicalRequestId = normalizeCannedTemplateRequestId(requestIdValue);
  if (!canonicalRequestId) return { ok: false, error: "requestId" };
  const material = cannedTemplateDraftMaterial(channel, draft);
  if (!material.ok) return material;
  return {
    ok: true,
    value: {
      contract_version: 1,
      id: current?.template_id ?? "",
      type: channel,
      expected_revision: current?.revision ?? 0,
      request_id: canonicalRequestId,
      ...material.value,
    },
  };
}

export function cannedTemplateDeletePayload(
  current: CannedTemplate,
  auditReasonValue: unknown,
  requestIdValue: unknown,
): CannedTemplateResult<CannedTemplateDeletePayload> {
  const id = templateId(current.template_id);
  if (!id) return { ok: false, error: "templateId" };
  const revision = integer(current.revision, 1);
  if (revision === null) return { ok: false, error: "revision" };
  const canonicalRequestId = normalizeCannedTemplateRequestId(requestIdValue);
  if (!canonicalRequestId) return { ok: false, error: "requestId" };
  const auditReason = normalizedDraftText(auditReasonValue, 1, 500, "body");
  if (!auditReason) return { ok: false, error: "auditReason" };
  return {
    ok: true,
    value: {
      contract_version: 1,
      id,
      expected_revision: revision,
      request_id: canonicalRequestId,
      audit_reason: auditReason,
    },
  };
}

function structuralSavePayload(value: unknown): CannedTemplateSavePayload | null {
  const raw = exactObject(value, [
    "contract_version",
    "id",
    "type",
    "expected_revision",
    "request_id",
    "audit_reason",
    "name",
    "subject",
    "body",
  ]);
  const channel = oneOf(raw?.type, CANNED_TEMPLATE_CHANNELS);
  const revision = integer(raw?.expected_revision, 0);
  const id = raw?.id === "" ? "" : templateId(raw?.id);
  const canonicalRequestId = requestId(raw?.request_id);
  if (!raw || raw.contract_version !== 1 || !channel || revision === null || id === null
    || !canonicalRequestId || ((id === "") !== (revision === 0))) return null;
  const material = cannedTemplateDraftMaterial(channel, {
    name: typeof raw.name === "string" ? raw.name : "",
    subject: typeof raw.subject === "string" ? raw.subject : "",
    body: typeof raw.body === "string" ? raw.body : "",
    auditReason: typeof raw.audit_reason === "string" ? raw.audit_reason : "",
  });
  if (!material.ok
    || material.value.name !== raw.name
    || material.value.subject !== raw.subject
    || material.value.body !== raw.body
    || material.value.audit_reason !== raw.audit_reason) return null;
  return {
    contract_version: 1,
    id,
    type: channel,
    expected_revision: revision,
    request_id: canonicalRequestId,
    ...material.value,
  };
}

function structuralDeletePayload(value: unknown): CannedTemplateDeletePayload | null {
  const raw = exactObject(value, [
    "contract_version",
    "id",
    "expected_revision",
    "request_id",
    "audit_reason",
  ]);
  const id = templateId(raw?.id);
  const revision = integer(raw?.expected_revision, 1);
  const canonicalRequestId = requestId(raw?.request_id);
  const auditReason = canonicalWireText(raw?.audit_reason, 1, 500, "body");
  return raw?.contract_version === 1 && id && revision !== null
    && canonicalRequestId && auditReason ? {
      contract_version: 1,
      id,
      expected_revision: revision,
      request_id: canonicalRequestId,
      audit_reason: auditReason,
    } : null;
}

function structuralListPayload(value: unknown): CannedTemplateListRequest | null {
  const raw = exactObject(value, ["contract_version", "type", "query", "page_size", "cursor"]);
  if (raw?.contract_version !== 1) return null;
  const parsed = cannedTemplateListPayload(raw.type, raw.query, raw.cursor, raw.page_size);
  return parsed
    && parsed.query === raw.query
    && parsed.cursor === raw.cursor
    ? parsed
    : null;
}

/**
 * Action-specific same-origin proxy boundary. `undefined` is not a canned
 * action; `null` is refused material; an object is the only outbound payload.
 */
export function normalizeCannedTemplateProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!ACTION_SET.has(action)) return undefined;
  const parsed = action === "list_canned"
    ? structuralListPayload(body)
    : action === "save_canned"
      ? structuralSavePayload(body)
      : structuralDeletePayload(body);
  return parsed ? Object.assign(Object.create(null), parsed) : null;
}

export function cannedTemplatePendingSave(
  payload: CannedTemplateSavePayload,
): CannedTemplatePendingMutation {
  return { version: 1, action: "save", channel: payload.type, payload: { ...payload } };
}

export function cannedTemplatePendingDelete(
  channel: CannedTemplateChannel,
  payload: CannedTemplateDeletePayload,
): CannedTemplatePendingMutation {
  return { version: 1, action: "delete", channel, payload: { ...payload } };
}

export function cannedTemplatePendingMutation(value: unknown): CannedTemplatePendingMutation | null {
  const raw = exactObject(value, ["version", "action", "channel", "payload"]);
  const channel = oneOf(raw?.channel, CANNED_TEMPLATE_CHANNELS);
  if (!raw || raw.version !== 1 || !channel) return null;
  if (raw.action === "save") {
    const payload = structuralSavePayload(raw.payload);
    return payload && payload.type === channel ? cannedTemplatePendingSave(payload) : null;
  }
  if (raw.action === "delete") {
    const payload = structuralDeletePayload(raw.payload);
    return payload ? cannedTemplatePendingDelete(channel, payload) : null;
  }
  return null;
}

export const CANNED_TEMPLATE_PENDING_STORAGE_KEY =
  "friending.canned-templates.pending-mutation.v1";

function deleted(value: unknown): CannedTemplateDeleted | null {
  const raw = exactObject(value, ["template_id", "channel", "revision", "deleted_at"]);
  const id = templateId(raw?.template_id);
  const channel = oneOf(raw?.channel, CANNED_TEMPLATE_CHANNELS);
  const revision = integer(raw?.revision, 2);
  const deletedAt = integer(raw?.deleted_at, 0, Number.MAX_SAFE_INTEGER);
  return id && channel && revision !== null && deletedAt !== null ? {
    template_id: id,
    channel,
    revision,
    deleted_at: deletedAt,
  } : null;
}

export function cannedTemplateSaveResponse(value: unknown): CannedTemplateSaveData | null {
  const envelope = exactObject(value, ["success", "status_code", "data"]);
  const raw = exactObject(envelope?.data, ["contract_version", "template", "replayed"]);
  const template = cannedTemplate(raw?.template);
  return envelope?.success === true
    && envelope.status_code === 200
    && raw?.contract_version === 1
    && template
    && typeof raw.replayed === "boolean"
    ? { contract_version: 1, template, replayed: raw.replayed }
    : null;
}

export function cannedTemplateDeleteResponse(value: unknown): CannedTemplateDeleteData | null {
  const envelope = exactObject(value, ["success", "status_code", "data"]);
  const raw = exactObject(envelope?.data, ["contract_version", "deleted", "replayed"]);
  const tombstone = deleted(raw?.deleted);
  return envelope?.success === true
    && envelope.status_code === 200
    && raw?.contract_version === 1
    && tombstone
    && typeof raw.replayed === "boolean"
    ? { contract_version: 1, deleted: tombstone, replayed: raw.replayed }
    : null;
}

export function cannedTemplateConflictResponse(value: unknown): CannedTemplateConflictData | null {
  const envelope = exactObject(value, ["success", "status_code", "error", "data"]);
  const raw = exactObject(envelope?.data, ["contract_version", "template", "deleted"]);
  if (envelope?.success !== false
    || envelope.status_code !== 409
    || envelope.error !== "canned-template-conflict"
    || raw?.contract_version !== 1) return null;
  if (raw.template !== null && raw.deleted === null) {
    const parsed = cannedTemplate(raw.template);
    return parsed ? { contract_version: 1, template: parsed, deleted: null } : null;
  }
  if (raw.template === null && raw.deleted !== null) {
    const parsed = deleted(raw.deleted);
    return parsed ? { contract_version: 1, template: null, deleted: parsed } : null;
  }
  return null;
}

export function cannedTemplateConflictMatches(
  conflict: CannedTemplateConflictData,
  pending: CannedTemplatePendingMutation,
): boolean {
  const target = conflict.template ?? conflict.deleted;
  return pending.payload.id !== ""
    && target.template_id === pending.payload.id
    && target.channel === pending.channel;
}

export function cannedTemplateSaveConverged(
  result: CannedTemplateSaveData,
  pending: Extract<CannedTemplatePendingMutation, { action: "save" }>,
): boolean {
  const { payload } = pending;
  const template = result.template;
  if (template.channel !== pending.channel
    || template.name !== payload.name
    || template.subject !== payload.subject
    || template.revision !== payload.expected_revision + 1
    || (payload.id === "" ? template.revision !== 1 : template.template_id !== payload.id)) {
    return false;
  }
  return template.channel === "email" || template.body === payload.body;
}

export function cannedTemplateDeleteConverged(
  result: CannedTemplateDeleteData,
  pending: Extract<CannedTemplatePendingMutation, { action: "delete" }>,
): boolean {
  return result.deleted.template_id === pending.payload.id
    && result.deleted.channel === pending.channel
    && result.deleted.revision === pending.payload.expected_revision + 1;
}

export const CANNED_TEMPLATE_ERROR_KEYS = {
  "canned-template-contract-version-invalid": "contractVersionInvalid",
  "canned-template-parameter-invalid": "parameterInvalid",
  "canned-template-channel-invalid": "channelInvalid",
  "canned-template-id-invalid": "idInvalid",
  "canned-template-name-invalid": "nameInvalid",
  "canned-template-subject-invalid": "subjectInvalid",
  "canned-template-body-invalid": "bodyInvalid",
  "canned-template-html-invalid": "htmlInvalid",
  "canned-template-audit-reason-invalid": "auditReasonInvalid",
  "canned-template-revision-invalid": "revisionInvalid",
  "canned-template-request-id-invalid": "requestIdInvalid",
  "canned-template-cursor-invalid": "cursorInvalid",
  "canned-template-not-found": "notFound",
  "canned-template-conflict": "conflict",
  "canned-template-channel-conflict": "channelConflict",
  "canned-template-request-id-conflict": "requestIdConflict",
  "canned-template-request-in-progress": "requestInProgress",
  "canned-template-read-required": "readRequired",
  "canned-template-write-required": "writeRequired",
  "canned-template-audit-write-failed": "auditWriteFailed",
  "canned-template-stored-invalid": "storedInvalid",
  "canned-template-read-failed": "readFailed",
  "canned-template-write-failed": "writeFailed",
  "admin-revoked": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-write-required": "writeRequired",
} as const;

export const CANNED_TEMPLATE_ERROR_STATUSES: Record<
  keyof typeof CANNED_TEMPLATE_ERROR_KEYS,
  number
> = {
  "canned-template-contract-version-invalid": 400,
  "canned-template-parameter-invalid": 400,
  "canned-template-channel-invalid": 422,
  "canned-template-id-invalid": 422,
  "canned-template-name-invalid": 422,
  "canned-template-subject-invalid": 422,
  "canned-template-body-invalid": 422,
  "canned-template-html-invalid": 422,
  "canned-template-audit-reason-invalid": 422,
  "canned-template-revision-invalid": 422,
  "canned-template-request-id-invalid": 422,
  "canned-template-cursor-invalid": 422,
  "canned-template-not-found": 404,
  "canned-template-conflict": 409,
  "canned-template-channel-conflict": 409,
  "canned-template-request-id-conflict": 409,
  "canned-template-request-in-progress": 409,
  "canned-template-read-required": 403,
  "canned-template-write-required": 403,
  "canned-template-audit-write-failed": 503,
  "canned-template-stored-invalid": 503,
  "canned-template-read-failed": 503,
  "canned-template-write-failed": 503,
  "admin-revoked": 403,
  "admin-session-invalid": 403,
  "admin-write-required": 403,
};

export type CannedTemplateErrorKey =
  | (typeof CANNED_TEMPLATE_ERROR_KEYS)[keyof typeof CANNED_TEMPLATE_ERROR_KEYS]
  | "generic";

const ERROR_KEY_MAP = new Map<string, CannedTemplateErrorKey>(
  Object.entries(CANNED_TEMPLATE_ERROR_KEYS),
);

const RETAIN_PENDING_ERRORS: ReadonlySet<string | null> = new Set([
  null,
  "canned-template-request-in-progress",
  "canned-template-audit-write-failed",
  "canned-template-stored-invalid",
  "canned-template-read-failed",
  "canned-template-write-failed",
]);

export function cannedTemplateErrorKey(value: unknown): CannedTemplateErrorKey {
  return typeof value === "string" ? ERROR_KEY_MAP.get(value) ?? "generic" : "generic";
}

export function cannedTemplateErrorResponse(value: unknown): string | null {
  const raw = exactObject(value, ["success", "status_code", "error"]);
  if (!raw || raw.success !== false || typeof raw.error !== "string") return null;
  const status = CANNED_TEMPLATE_ERROR_STATUSES[
    raw.error as keyof typeof CANNED_TEMPLATE_ERROR_STATUSES
  ];
  return status !== undefined && raw.status_code === status ? raw.error : null;
}

export function cannedTemplateShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.prototype.hasOwnProperty.call(CANNED_TEMPLATE_ERROR_STATUSES, error)
    || RETAIN_PENDING_ERRORS.has(error);
}

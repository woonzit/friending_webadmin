/** Runtime decoder for the additive help-support-v2 admin contract. */

export type SupportSource = "ios" | "android" | "web";

export function supportSourceLabel(source: SupportSource): string {
  if (source === "android") return "Android";
  if (source === "web") return "Web";
  return "iOS";
}

export type SupportClientContext = {
  schemaVersion: 1;
  source: SupportSource;
  appVersion: string;
  appBuild: string;
  osName: string;
  osVersion: string;
  deviceFamily: string;
  deviceModel: string;
  browserName: string;
  browserVersion: string;
  userAgent: string;
  screenWidthPx: number;
  screenHeightPx: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  displayScale: number;
  locale: string;
  timezone: string;
  appearance: string;
  effectiveAppearance: string;
  accent: string;
  textSize: string;
  reduceMotion: boolean | null;
  boldText: boolean | null;
  notificationPermission: string;
  standalone: boolean | null;
};

export type SupportThreadRow = {
  uid: number;
  status: string;
  lastText: string;
  lastKind: "text" | "image";
  lastSender: string;
  lastAt: number;
  unreadAdmin: number;
  displayName: string;
  avatar: string;
  clientContext: SupportClientContext | null;
};

export type SupportMessage = {
  id: string;
  smid: number;
  sender: "user" | "admin";
  kind: "text" | "image";
  body: string;
  createdAt: number;
  requestId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  imageRemoved: boolean;
  clientContext: SupportClientContext | null;
};

export type SupportConversation = {
  messages: SupportMessage[];
  lastSmid: number;
  status: string;
  clientContext: SupportClientContext | null;
  mediaEnabled: boolean;
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

function decimal(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mediaCapability(value: unknown): boolean {
  return record(value)?.support_media === true;
}

export function supportMediaEnabled(value: unknown): boolean {
  return mediaCapability(record(value)?.capabilities);
}

export function supportClientContext(value: unknown): SupportClientContext | null {
  const row = record(value);
  if (!row || integer(row.schema_version) !== 1) return null;
  const source = row.source === "ios" || row.source === "android" || row.source === "web"
    ? row.source
    : null;
  if (!source) return null;
  return {
    schemaVersion: 1,
    source,
    appVersion: text(row.app_version, 32),
    appBuild: text(row.app_build, 64),
    osName: text(row.os_name, 32),
    osVersion: text(row.os_version, 64),
    deviceFamily: text(row.device_family, 32),
    deviceModel: text(row.device_model, 64),
    browserName: text(row.browser_name, 64),
    browserVersion: text(row.browser_version, 64),
    userAgent: text(row.user_agent, 512),
    screenWidthPx: Math.max(0, integer(row.screen_width_px)),
    screenHeightPx: Math.max(0, integer(row.screen_height_px)),
    viewportWidthPx: Math.max(0, integer(row.viewport_width_px)),
    viewportHeightPx: Math.max(0, integer(row.viewport_height_px)),
    displayScale: Math.max(0, decimal(row.display_scale)),
    locale: text(row.locale, 32),
    timezone: text(row.timezone, 64),
    appearance: text(row.appearance, 24),
    effectiveAppearance: text(row.effective_appearance, 24),
    accent: text(row.accent, 32),
    textSize: text(row.text_size, 32),
    reduceMotion: optionalBoolean(row.reduce_motion),
    boldText: optionalBoolean(row.bold_text),
    notificationPermission: text(row.notification_permission, 32),
    standalone: optionalBoolean(row.standalone),
  };
}

/** Only Core-managed, uncredentialed HTTPS support locators may render. */
export function supportImageUrl(value: unknown): string {
  const raw = text(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.hostname !== "pic.freelove.hu"
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
      || !/^\/api\/cache\/support\/[1-9][0-9]*\/[0-9]{4}\/[0-9]{2}\/[0-9a-f]{32}\.jpg$/.test(url.pathname)
    ) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** The hydrated user model's display name / avatar, tolerantly. */
function userBits(value: unknown): { name: string; avatar: string } {
  const user = record(value);
  const displayname = record(user?.displayname);
  const name = text(displayname?.value ?? user?.displayname ?? user?.username, 80);
  const avatar = text(user?.avatar, 500);
  return { name, avatar };
}

export function supportThreads(value: unknown): SupportThreadRow[] | null {
  const source = record(value);
  if (!source || !Array.isArray(source.threads)) return null;
  const rows: SupportThreadRow[] = [];
  for (const raw of source.threads) {
    const row = record(raw);
    if (!row) return null;
    const uid = integer(row.uid);
    if (uid <= 0) return null;
    const bits = userBits(row.user);
    rows.push({
      uid,
      status: text(row.status, 20) || "open",
      lastText: text(row.last_text, 200),
      lastKind: row.last_kind === "image" ? "image" : "text",
      lastSender: text(row.last_sender, 10),
      lastAt: integer(row.last_at),
      unreadAdmin: Math.max(0, integer(row.unread_admin)),
      displayName: bits.name || `#${uid}`,
      avatar: bits.avatar,
      clientContext: supportClientContext(row.client_context),
    });
  }
  return rows;
}

export function supportConversation(value: unknown): SupportConversation | null {
  const source = record(value);
  if (!source || !Array.isArray(source.messages)) return null;
  const messages: SupportMessage[] = [];
  for (const raw of source.messages) {
    const row = record(raw);
    if (!row) return null;
    const sender = row.sender === "admin" ? "admin" : row.sender === "user" ? "user" : null;
    if (!sender) return null;
    const kind = row.kind === "image" ? "image" : "text";
    const body = text(row.body, 4000);
    const imageRemoved = row.image_removed === true;
    const imageUrl = supportImageUrl(row.image_url);
    if (
      (kind === "text" && (body === "" || imageRemoved || imageUrl !== ""))
      || (kind === "image" && (body !== "" || (!imageRemoved && imageUrl === "")))
    ) {
      return null;
    }
    const smid = integer(row.smid);
    if (smid <= 0) return null;
    messages.push({
      id: text(row.id, 40) || String(smid),
      smid,
      sender,
      kind,
      body,
      createdAt: integer(row.created_at),
      requestId: text(row.request_id, 64),
      imageUrl,
      imageWidth: Math.max(0, integer(row.image_width)),
      imageHeight: Math.max(0, integer(row.image_height)),
      imageRemoved,
      clientContext: supportClientContext(row.client_context),
    });
  }
  return {
    messages,
    lastSmid: Math.max(0, integer(source.last_smid)),
    status: text(source.status, 20) || "open",
    clientContext: supportClientContext(source.client_context),
    mediaEnabled: mediaCapability(source.capabilities),
  };
}

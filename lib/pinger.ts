// Strict Webadmin projection for handoffs/pinger-v1/CONTRACT.md.

export const PINGER_COPY_KEYS = [
  "button_label",
  "success_toast",
  "cooldown_error",
  "refusal_generic",
  "collector_tab_title",
  "push_title",
  "push_body",
  "banner_text",
  "chat_locked_gate",
] as const;

export type PingerCopyKey = (typeof PINGER_COPY_KEYS)[number];
export type PingerLocalizedCopy = { en: string; hu: string };

export type PingerConfiguration = {
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  actionKey: string;
  /// The resting state. Keeps its name and shape, so an existing upload stays
  /// exactly where it is.
  icon: { lightUrl: string; darkUrl: string };
  /// The state after a member has liked the person they are looking at.
  iconLiked: { lightUrl: string; darkUrl: string };
  /// Ship the app's own artwork and skip all four uploads.
  useBundledIcons: boolean;
  cooldownSeconds: number;
  retentionSeconds: number;
  chatGateDefault: boolean;
  chatContractVersion: 0 | 1;
  copy: Record<PingerCopyKey, PingerLocalizedCopy>;
};

export type PingerAuditRow = {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  oldRevision: number;
  newRevision: number;
  createdAt: number;
};

export type PingerLimits = {
  cooldownMin: number;
  cooldownMax: number;
  retentionMin: number;
  retentionMax: number;
  copyMaxLength: number;
};

export type PingerAdminPayload = {
  configuration: PingerConfiguration;
  audit: PingerAuditRow[];
  limits: PingerLimits;
  capabilities: { chatContractReady: boolean };
};

const REQUIRED_TOKENS: Record<PingerCopyKey, string[]> = {
  button_label: [],
  success_toast: [],
  cooldown_error: ["{remaining}"],
  refusal_generic: [],
  collector_tab_title: [],
  push_title: [],
  push_body: ["{sender}"],
  banner_text: ["{sender}"],
  chat_locked_gate: [],
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function string(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return parsed !== "" || allowEmpty ? parsed : null;
}

export function pingerIconURL(value: unknown): string | null {
  const parsed = string(value, true);
  if (parsed === null) return null;
  if (parsed === "") return parsed;
  try {
    const url = new URL(parsed);
    const decodedPath = decodeURIComponent(url.pathname);
    const segments = decodedPath.split("/");
    if (
      url.protocol !== "https:" || url.hostname !== "img.friending.co"
      || (url.port !== "" && url.port !== "443") || url.username || url.password
      || url.search || url.hash || decodedPath !== url.pathname
      || !url.pathname.startsWith("/api/cache/") || url.pathname.includes("//")
      || segments.includes(".") || segments.includes("..")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function exactTokens(value: string, expected: string[]): boolean {
  const matches = value.match(/\{[a-z_]+\}/g) ?? [];
  const braceMatches = value.match(/\{[^{}]*\}/g) ?? [];
  const opens = Array.from(value).filter((character) => character === "{").length;
  const closes = Array.from(value).filter((character) => character === "}").length;
  return opens === braceMatches.length && closes === braceMatches.length
    && matches.length === expected.length
    && matches.every((token, index) => token === expected[index]);
}

export function validatePingerConfiguration(
  value: PingerConfiguration,
  limits: PingerLimits,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(value.actionKey.trim().toLowerCase())) {
    errors.actionKey = "action_key";
  }
  if (!Number.isSafeInteger(value.cooldownSeconds)
    || value.cooldownSeconds < limits.cooldownMin
    || value.cooldownSeconds > limits.cooldownMax) errors.cooldownSeconds = "cooldown_seconds";
  if (!Number.isSafeInteger(value.retentionSeconds)
    || value.retentionSeconds < limits.retentionMin
    || value.retentionSeconds > limits.retentionMax) errors.retentionSeconds = "retention_seconds";
  if (value.chatContractVersion !== 0 && value.chatContractVersion !== 1) {
    errors.chatContractVersion = "chat_contract_version";
  }
  if (pingerIconURL(value.icon.lightUrl) === null) errors.lightIcon = "icon.light_url";
  if (pingerIconURL(value.icon.darkUrl) === null) errors.darkIcon = "icon.dark_url";
  if (pingerIconURL(value.iconLiked.lightUrl) === null) errors.likedLightIcon = "icon_liked.light_url";
  if (pingerIconURL(value.iconLiked.darkUrl) === null) errors.likedDarkIcon = "icon_liked.dark_url";
  for (const key of PINGER_COPY_KEYS) {
    for (const language of ["en", "hu"] as const) {
      const copy = value.copy[key][language].trim();
      if (!copy || scalarLength(copy) > limits.copyMaxLength
        || !exactTokens(copy, REQUIRED_TOKENS[key])) {
        errors[`copy.${key}.${language}`] = `copy.${key}.${language}`;
      }
    }
  }
  return errors;
}

function configuration(value: unknown, limits: PingerLimits): PingerConfiguration | null {
  const row = record(value);
  if (!row) return null;
  const schemaVersion = integer(row.schema_version, 1, 1);
  const revision = integer(row.revision, 0);
  const enabled = boolean(row.enabled);
  const actionKey = string(row.action_key);
  const icon = record(row.icon);
  const lightUrl = pingerIconURL(icon?.light_url);
  const darkUrl = pingerIconURL(icon?.dark_url);
  // Additive on the wire, so a configuration written before the state pair
  // existed still loads: an absent liked icon is an empty one, and the bundled
  // switch defaults to whatever preserves that configuration's behaviour —
  // bundled when nothing was ever uploaded, custom when something was.
  const likedIcon = record(row.icon_liked) ?? {};
  // `?? ""` and not a bare read: an absent key must mean "no artwork", the same
  // as an empty string. Passed through as undefined it would fail the URL check
  // and reject the whole configuration — which is the opposite of additive.
  const likedLightUrl = pingerIconURL(likedIcon.light_url ?? "");
  const likedDarkUrl = pingerIconURL(likedIcon.dark_url ?? "");
  const storedUseBundled = boolean(row.use_bundled_icons);
  const cooldownSeconds = integer(row.cooldown_seconds, limits.cooldownMin, limits.cooldownMax);
  const retentionSeconds = integer(row.retention_seconds, limits.retentionMin, limits.retentionMax);
  const chatGateDefault = boolean(row.chat_gate_default);
  const chatContractVersion = integer(row.chat_contract_version, 0, 1);
  const copyRow = record(row.copy);
  if (
    schemaVersion !== 1 || revision === null || enabled === null
    || !actionKey || !/^[a-z][a-z0-9_]{1,31}$/.test(actionKey)
    || !icon || lightUrl === null || darkUrl === null
    || likedLightUrl === null || likedDarkUrl === null
    || cooldownSeconds === null || retentionSeconds === null
    || chatGateDefault === null || (chatContractVersion !== 0 && chatContractVersion !== 1)
    || !copyRow
  ) return null;

  const copy = {} as Record<PingerCopyKey, PingerLocalizedCopy>;
  for (const key of PINGER_COPY_KEYS) {
    const localized = record(copyRow[key]);
    const en = string(localized?.en);
    const hu = string(localized?.hu);
    if (!localized || !en || !hu
      || scalarLength(en) > limits.copyMaxLength
      || scalarLength(hu) > limits.copyMaxLength
      || !exactTokens(en, REQUIRED_TOKENS[key])
      || !exactTokens(hu, REQUIRED_TOKENS[key])) return null;
    copy[key] = { en, hu };
  }
  const parsed: PingerConfiguration = {
    schemaVersion: 1,
    revision,
    enabled,
    actionKey,
    icon: { lightUrl, darkUrl },
    iconLiked: { lightUrl: likedLightUrl, darkUrl: likedDarkUrl },
    useBundledIcons: storedUseBundled ?? (lightUrl === "" && darkUrl === ""),
    cooldownSeconds,
    retentionSeconds,
    chatGateDefault,
    chatContractVersion,
    copy,
  };
  return Object.keys(validatePingerConfiguration(parsed, limits)).length === 0 ? parsed : null;
}

export function pingerAdminPayload(value: unknown): PingerAdminPayload | null {
  const root = record(value);
  const body = record(root?.data) ?? root;
  if (!body) return null;
  const limits = record(body.limits);
  const cooldownMin = integer(limits?.cooldown_min, 1);
  const cooldownMax = integer(limits?.cooldown_max, 1);
  const retentionMin = integer(limits?.retention_min, 1);
  const retentionMax = integer(limits?.retention_max, 1);
  const copyMaxLength = integer(limits?.copy_max_length, 1, 10_000);
  const capabilities = record(body.capabilities);
  const chatContractReady = boolean(capabilities?.chat_contract_ready);
  const parsedLimits = cooldownMin !== null && cooldownMax !== null
    && retentionMin !== null && retentionMax !== null && copyMaxLength !== null
    ? { cooldownMin, cooldownMax, retentionMin, retentionMax, copyMaxLength }
    : null;
  const parsedConfiguration = parsedLimits ? configuration(body.configuration, parsedLimits) : null;
  if (
    !parsedConfiguration || !limits || !Array.isArray(body.audit)
    || cooldownMin === null || cooldownMax === null || cooldownMax < cooldownMin
    || retentionMin === null || retentionMax === null || retentionMax < retentionMin
    || copyMaxLength === null || chatContractReady === null
  ) return null;

  const audit: PingerAuditRow[] = [];
  for (const value of body.audit) {
    const row = record(value);
    const id = string(row?.id, true);
    const actorEmail = string(row?.actor_email, true);
    const actorRole = string(row?.actor_role, true);
    const action = string(row?.action);
    const oldRevision = integer(row?.old_revision, 0);
    const newRevision = integer(row?.new_revision, 0);
    const createdAt = integer(row?.created_at, 0);
    if (!row || id === null || actorEmail === null || actorRole === null || !action
      || oldRevision === null || newRevision === null || createdAt === null) return null;
    audit.push({ id, actorEmail, actorRole, action, oldRevision, newRevision, createdAt });
  }

  return {
    configuration: parsedConfiguration,
    audit,
    limits: { cooldownMin, cooldownMax, retentionMin, retentionMax, copyMaxLength },
    capabilities: { chatContractReady },
  };
}

export function pingerConfigurationWire(value: PingerConfiguration): Record<string, unknown> {
  return {
    schema_version: 1,
    enabled: value.enabled,
    action_key: value.actionKey.trim().toLowerCase(),
    icon: {
      light_url: value.icon.lightUrl,
      dark_url: value.icon.darkUrl,
    },
    icon_liked: {
      light_url: value.iconLiked.lightUrl,
      dark_url: value.iconLiked.darkUrl,
    },
    use_bundled_icons: value.useBundledIcons,
    cooldown_seconds: value.cooldownSeconds,
    retention_seconds: value.retentionSeconds,
    chat_gate_default: value.chatGateDefault,
    chat_contract_version: value.chatContractVersion,
    copy: value.copy,
  };
}

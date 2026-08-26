export const INVITE_DELIVERY_MODES = ["server_sms", "device_sms"] as const;
export type InviteDeliveryMode = (typeof INVITE_DELIVERY_MODES)[number];

export const INVITE_REQUIRED_LANGUAGES = ["en", "hu"] as const;
export const INVITE_TEMPLATE_MAX_LENGTH = 600;
export const INVITE_OVERRIDE_MAX_COUNT = 250;

export type InviteMessages = Record<string, string>;

export type InviteGlobalRule = {
  mode: InviteDeliveryMode;
  messages: InviteMessages;
};

export type InviteStorefrontOverride = {
  storefront: string;
  mode: InviteDeliveryMode;
  active: boolean;
  messages: InviteMessages;
};

export type InviteConfiguration = {
  schema_version: 2;
  revision: number;
  enabled: boolean;
  global: InviteGlobalRule;
  overrides: InviteStorefrontOverride[];
  updated_at: number;
};

export type InviteConfigurationPayload = {
  configuration: InviteConfiguration;
  modes: InviteDeliveryMode[];
  placeholders: string[];
  limits: { template_length: number; overrides: number };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function mode(value: unknown): InviteDeliveryMode | null {
  return typeof value === "string" && INVITE_DELIVERY_MODES.includes(value as InviteDeliveryMode)
    ? value as InviteDeliveryMode
    : null;
}

function messages(value: unknown, required: boolean): InviteMessages | null {
  const source = record(value);
  if (!source || Object.keys(source).length > 20) return null;
  const result: InviteMessages = {};
  for (const [language, rawTemplate] of Object.entries(source)) {
    if (!/^[a-z]{2,3}$/.test(language) || typeof rawTemplate !== "string") return null;
    if (rawTemplate.trim() !== rawTemplate || Array.from(rawTemplate).length > INVITE_TEMPLATE_MAX_LENGTH) return null;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(rawTemplate)) return null;
    if (rawTemplate !== "" && !rawTemplate.includes("{user_url}")) return null;
    if (rawTemplate !== "") result[language] = rawTemplate;
  }
  if (required && INVITE_REQUIRED_LANGUAGES.some((language) => !result[language])) return null;
  return result;
}

function rule(value: unknown): InviteGlobalRule | null {
  const source = record(value);
  if (!source) return null;
  const parsedMode = mode(source.mode);
  const parsedMessages = messages(source.messages, true);
  return parsedMode && parsedMessages ? { mode: parsedMode, messages: parsedMessages } : null;
}

function override(value: unknown): InviteStorefrontOverride | null {
  const source = record(value);
  if (!source || typeof source.active !== "boolean") return null;
  const storefront = typeof source.storefront === "string" ? source.storefront : "";
  const parsedMode = mode(source.mode);
  const parsedMessages = messages(source.messages, false);
  if (!/^[A-Z]{3}$/.test(storefront) || !parsedMode || !parsedMessages) return null;
  return { storefront, mode: parsedMode, active: source.active, messages: parsedMessages };
}

export function parseInviteConfigurationPayload(value: unknown): InviteConfigurationPayload | null {
  const source = record(value);
  const rawConfiguration = record(source?.configuration);
  const rawLimits = record(source?.limits);
  if (!source || !rawConfiguration || !rawLimits) return null;
  if (rawConfiguration.schema_version !== 2 || typeof rawConfiguration.enabled !== "boolean") return null;
  const revision = integer(rawConfiguration.revision);
  const updatedAt = integer(rawConfiguration.updated_at);
  const global = rule(rawConfiguration.global);
  if (revision === null || updatedAt === null || !global || !Array.isArray(rawConfiguration.overrides)) return null;
  if (rawConfiguration.overrides.length > INVITE_OVERRIDE_MAX_COUNT) return null;
  const overrides: InviteStorefrontOverride[] = [];
  const seen = new Set<string>();
  for (const raw of rawConfiguration.overrides) {
    const parsed = override(raw);
    if (!parsed || seen.has(parsed.storefront)) return null;
    seen.add(parsed.storefront);
    overrides.push(parsed);
  }
  const modes = Array.isArray(source.modes) ? source.modes.map(mode) : [];
  const placeholders = Array.isArray(source.placeholders)
    ? source.placeholders.filter((item): item is string => typeof item === "string")
    : [];
  if (
    modes.some((item) => item === null)
    || modes.length !== INVITE_DELIVERY_MODES.length
    || new Set(modes).size !== INVITE_DELIVERY_MODES.length
    || INVITE_DELIVERY_MODES.some((item) => !modes.includes(item))
  ) return null;
  if (!placeholders.includes("{user_url}")) return null;
  if (rawLimits.template_length !== INVITE_TEMPLATE_MAX_LENGTH || rawLimits.overrides !== INVITE_OVERRIDE_MAX_COUNT) return null;
  return {
    configuration: {
      schema_version: 2,
      revision,
      enabled: rawConfiguration.enabled,
      global,
      overrides,
      updated_at: updatedAt,
    },
    modes: modes as InviteDeliveryMode[],
    placeholders,
    limits: {
      template_length: INVITE_TEMPLATE_MAX_LENGTH,
      overrides: INVITE_OVERRIDE_MAX_COUNT,
    },
  };
}

export function cloneInviteConfiguration(configuration: InviteConfiguration): InviteConfiguration {
  return {
    ...configuration,
    global: { ...configuration.global, messages: { ...configuration.global.messages } },
    overrides: configuration.overrides.map((item) => ({
      ...item,
      messages: { ...item.messages },
    })),
  };
}

export function normalizedStorefront(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

export function inviteDraftIssue(configuration: InviteConfiguration): string | null {
  if (!INVITE_DELIVERY_MODES.includes(configuration.global.mode)) return "globalMode";
  for (const language of INVITE_REQUIRED_LANGUAGES) {
    const template = configuration.global.messages[language] ?? "";
    if (!template || !template.includes("{user_url}") || Array.from(template).length > INVITE_TEMPLATE_MAX_LENGTH) {
      return "globalMessages";
    }
  }
  if (configuration.overrides.length > INVITE_OVERRIDE_MAX_COUNT) return "tooManyOverrides";
  const seen = new Set<string>();
  for (const item of configuration.overrides) {
    if (!/^[A-Z]{3}$/.test(item.storefront)) return "storefront";
    if (seen.has(item.storefront)) return "duplicateStorefront";
    seen.add(item.storefront);
    if (!INVITE_DELIVERY_MODES.includes(item.mode)) return "overrideMode";
    for (const template of Object.values(item.messages)) {
      if (
        template !== ""
        && (!template.includes("{user_url}") || Array.from(template).length > INVITE_TEMPLATE_MAX_LENGTH)
      ) return "overrideMessages";
    }
  }
  return null;
}

export function inviteSaveBody(configuration: InviteConfiguration): Record<string, unknown> {
  return {
    expected_revision: configuration.revision,
    configuration: {
      enabled: configuration.enabled,
      global: configuration.global,
      overrides: configuration.overrides,
    },
  };
}

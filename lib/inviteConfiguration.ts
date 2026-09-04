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

/**
 * The invite-attribution summary Core (T-768) appends to `adminPayload()` as one additive sibling
 * key. It is STATISTICS, not configuration: this console renders it read-only and never posts it
 * back, so it is decoded FAIL-OPEN — absent, `null` or malformed all become `null` and the
 * configuration form keeps working. Every rule below the `attribution` key stays fail-closed.
 */
export const INVITE_ATTRIBUTION_CHANNELS = ["device_sms", "server_sms"] as const;
export type InviteAttributionChannel = (typeof INVITE_ATTRIBUTION_CHANNELS)[number];

export type InviteAttributionChannelCounts = {
  recorded: number;
  converted: number;
  expiring_within_7d: number;
};

export type InviteAttributionTotals = {
  recorded: number;
  converted: number;
  senders: number;
  converted_members: number;
  expiring_within_7d: number;
  by_channel: Record<InviteAttributionChannel, InviteAttributionChannelCounts>;
};

export type InviteAttributionSender = {
  uid: number;
  display_name: string;
  recorded: number;
  converted: number;
  last_recorded_at: number;
  last_converted_at: number;
};

export type InviteAttributionSummary = {
  schema_version: 1;
  generated_at: number;
  totals: InviteAttributionTotals;
  senders: InviteAttributionSender[];
  limit: number;
  truncated: boolean;
};

export type InviteConfigurationPayload = {
  configuration: InviteConfiguration;
  modes: InviteDeliveryMode[];
  placeholders: string[];
  limits: { template_length: number; overrides: number };
  attribution: InviteAttributionSummary | null;
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

function attributionChannelCounts(value: unknown): InviteAttributionChannelCounts | null {
  const source = record(value);
  if (!source) return null;
  const recorded = integer(source.recorded);
  const converted = integer(source.converted);
  const expiring = integer(source.expiring_within_7d);
  if (recorded === null || converted === null || expiring === null) return null;
  return { recorded, converted, expiring_within_7d: expiring };
}

function attributionSender(value: unknown): InviteAttributionSender | null {
  const source = record(value);
  if (!source || typeof source.display_name !== "string") return null;
  const uid = integer(source.uid);
  const recorded = integer(source.recorded);
  const converted = integer(source.converted);
  const lastRecordedAt = integer(source.last_recorded_at);
  // 0 is the value Core serves for a sender who has converted nobody yet; it is a real answer,
  // not a missing one, and the console prints an em dash for it (T-768 assumption 1).
  const lastConvertedAt = integer(source.last_converted_at);
  if (uid === null || uid <= 0 || recorded === null || converted === null) return null;
  if (lastRecordedAt === null || lastConvertedAt === null) return null;
  return {
    uid,
    display_name: source.display_name,
    recorded,
    converted,
    last_recorded_at: lastRecordedAt,
    last_converted_at: lastConvertedAt,
  };
}

/**
 * Fail-open by contract: every refusal below returns `null`, which the page renders as "statistics
 * are not available right now" beside a fully working configuration form. `senders: []` and a
 * populated `senders` are EQUALLY valid — the first conversion of the cohort moves that array from
 * empty to populated and that is normal operation, never a schema change (RULES 47, and the T-768
 * report's decoder note).
 */
export function parseInviteAttributionSummary(value: unknown): InviteAttributionSummary | null {
  const source = record(value);
  if (!source || source.schema_version !== 1 || typeof source.truncated !== "boolean") return null;
  const generatedAt = integer(source.generated_at);
  const limit = integer(source.limit);
  const rawTotals = record(source.totals);
  if (generatedAt === null || limit === null || limit <= 0 || !rawTotals) return null;
  if (!Array.isArray(source.senders) || source.senders.length > limit) return null;
  const rawChannels = record(rawTotals.by_channel);
  if (!rawChannels) return null;
  const channelKeys = Object.keys(rawChannels);
  if (
    channelKeys.length !== INVITE_ATTRIBUTION_CHANNELS.length
    || INVITE_ATTRIBUTION_CHANNELS.some((channel) => !channelKeys.includes(channel))
  ) return null;
  const byChannel = {} as Record<InviteAttributionChannel, InviteAttributionChannelCounts>;
  for (const channel of INVITE_ATTRIBUTION_CHANNELS) {
    const counts = attributionChannelCounts(rawChannels[channel]);
    if (!counts) return null;
    byChannel[channel] = counts;
  }
  const recorded = integer(rawTotals.recorded);
  const converted = integer(rawTotals.converted);
  const senderCount = integer(rawTotals.senders);
  const convertedMembers = integer(rawTotals.converted_members);
  const expiring = integer(rawTotals.expiring_within_7d);
  if (recorded === null || converted === null || senderCount === null) return null;
  if (convertedMembers === null || expiring === null) return null;
  const senders: InviteAttributionSender[] = [];
  for (const raw of source.senders) {
    const parsed = attributionSender(raw);
    if (!parsed) return null;
    senders.push(parsed);
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    totals: {
      recorded,
      converted,
      senders: senderCount,
      converted_members: convertedMembers,
      expiring_within_7d: expiring,
      by_channel: byChannel,
    },
    senders,
    limit,
    truncated: source.truncated,
  };
}

/**
 * `converted / recorded`, or `null` when nothing has been recorded — a console that printed "0%"
 * for a cohort with no invites at all would be reporting a failure that has not happened.
 */
export function inviteConversionRate(recorded: number, converted: number): number | null {
  return Number.isFinite(recorded) && recorded > 0 ? converted / recorded : null;
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
    // Fail-open, and deliberately the LAST thing decoded: nothing above this line can be refused
    // because the statistics half is missing or wrong.
    attribution: parseInviteAttributionSummary(source.attribution),
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

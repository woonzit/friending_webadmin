export const PROFILE_PRESENCE_MODES = ["online", "date", "now", "invisible"] as const;
export type ProfilePresenceMode = (typeof PROFILE_PRESENCE_MODES)[number];

export const MANDATORY_PROFILE_PRESENCE_MODES = ["online", "invisible"] as const;
export const OPTIONAL_PROFILE_PRESENCE_MODES = ["date", "now"] as const;

export type ProfilePresenceConfiguration = {
  schema_version: 1;
  revision: number;
  date_enabled: boolean;
  now_enabled: boolean;
  enabled_modes: ProfilePresenceMode[];
  updated_at: number;
  updated_by: string;
};

export type ProfilePresenceConfigurationPayload = {
  configuration: ProfilePresenceConfiguration;
  mandatory_modes: Array<(typeof MANDATORY_PROFILE_PRESENCE_MODES)[number]>;
  optional_modes: Array<(typeof OPTIONAL_PROFILE_PRESENCE_MODES)[number]>;
  selected_counts: Record<ProfilePresenceMode, number>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function exactStrings<const T extends readonly string[]>(value: unknown, expected: T): value is T[number][] {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

export function enabledProfilePresenceModes(
  dateEnabled: boolean,
  nowEnabled: boolean,
): ProfilePresenceMode[] {
  const modes: ProfilePresenceMode[] = ["online"];
  if (dateEnabled) modes.push("date");
  if (nowEnabled) modes.push("now");
  modes.push("invisible");
  return modes;
}

export function parseProfilePresenceConfigurationPayload(
  value: unknown,
): ProfilePresenceConfigurationPayload | null {
  const source = record(value);
  const configuration = record(source?.configuration);
  const counts = record(source?.selected_counts);
  if (!source || !configuration || !counts) return null;
  if (
    configuration.schema_version !== 1
    || typeof configuration.date_enabled !== "boolean"
    || typeof configuration.now_enabled !== "boolean"
    || !exactStrings(source.mandatory_modes, MANDATORY_PROFILE_PRESENCE_MODES)
    || !exactStrings(source.optional_modes, OPTIONAL_PROFILE_PRESENCE_MODES)
  ) return null;

  const revision = nonNegativeInteger(configuration.revision);
  const updatedAt = nonNegativeInteger(configuration.updated_at);
  const updatedBy = configuration.updated_by;
  const expectedEnabled = enabledProfilePresenceModes(
    configuration.date_enabled,
    configuration.now_enabled,
  );
  if (
    revision === null
    || updatedAt === null
    || typeof updatedBy !== "string"
    || updatedBy.trim() !== updatedBy
    || updatedBy.length > 320
    || !exactStrings(configuration.enabled_modes, expectedEnabled)
  ) return null;

  const selectedCounts = {} as Record<ProfilePresenceMode, number>;
  for (const mode of PROFILE_PRESENCE_MODES) {
    const count = nonNegativeInteger(counts[mode]);
    if (count === null) return null;
    selectedCounts[mode] = count;
  }

  return {
    configuration: {
      schema_version: 1,
      revision,
      date_enabled: configuration.date_enabled,
      now_enabled: configuration.now_enabled,
      enabled_modes: expectedEnabled,
      updated_at: updatedAt,
      updated_by: updatedBy,
    },
    mandatory_modes: [...MANDATORY_PROFILE_PRESENCE_MODES],
    optional_modes: [...OPTIONAL_PROFILE_PRESENCE_MODES],
    selected_counts: selectedCounts,
  };
}

export function profilePresenceConfigurationResponseData(response: unknown): unknown {
  return record(response)?.data;
}

export function profilePresenceConfigurationSaveBody(
  configuration: ProfilePresenceConfiguration,
): Record<string, unknown> {
  return {
    expected_revision: configuration.revision,
    configuration: {
      schema_version: 1,
      date_enabled: configuration.date_enabled,
      now_enabled: configuration.now_enabled,
    },
  };
}

export function reconciledProfilePresenceCount(response: unknown): number | null {
  const saveResult = record(record(response)?.data)?.save_result;
  const source = record(saveResult);
  if (!source || typeof source.changed !== "boolean") return null;
  const count = nonNegativeInteger(source.reconciled_count);
  return count;
}

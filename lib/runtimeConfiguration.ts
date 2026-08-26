export const SESSION_IDLE_MINUTES_MIN = 30;
export const SESSION_IDLE_MINUTES_MAX = 525_600;

export type Setting<T> = {
  value: T;
  type?: string;
  allowed_values?: string[];
  minimum?: number | null;
  maximum?: number | null;
  updated_at: number;
  updated_by: string;
};

export type AppearanceMode = "system" | "light" | "dark";

export type RuntimeSettings = {
  people_hero_enabled: Setting<boolean>;
  demo_system_enabled: Setting<boolean>;
  app_appearance_mode: Setting<AppearanceMode>;
  join_session_idle_minutes: Setting<number>;
  /**
   * The origin members' public profile links are minted from. The choices come
   * from the server rather than from this file, so adding a host later is a
   * Core change alone — and Core only offers hosts that shipped clients accept,
   * because a base no client recognises removes their profile QR entirely
   * rather than degrading it.
   *
   * `allowed_values` empty means this Core does not manage the setting; the
   * section hides instead of taking the whole page down with it.
   */
  public_profile_base_url: Setting<string>;
  /**
   * The website origin legal, marketing and giveaway links are built from.
   *
   * Free text, unlike the profile base above, and the difference is the point:
   * these values only ever become links a browser opens, so a wrong one costs a
   * broken link rather than a removed screen. The server still validates it as
   * an https origin. An empty value means this Core does not manage it.
   */
  public_web_base: Setting<string>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function settingMetadata(value: Record<string, unknown> | null) {
  return {
    updated_at: typeof value?.updated_at === "number" ? value.updated_at : 0,
    updated_by: typeof value?.updated_by === "string" ? value.updated_by : "",
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

export function sessionIdleMinutesValid(value: unknown): value is number {
  return boundedInteger(
    value,
    SESSION_IDLE_MINUTES_MIN,
    SESSION_IDLE_MINUTES_MAX,
  ) !== null;
}

export function normalizeRuntimeSettings(raw: unknown): RuntimeSettings | null {
  const value = record(raw);
  if (!value) return null;
  const people = record(value.people_hero_enabled);
  const demo = record(value.demo_system_enabled);
  const appearance = record(value.app_appearance_mode);
  const session = record(value.join_session_idle_minutes);
  if (typeof people?.value !== "boolean" || typeof demo?.value !== "boolean") return null;

  const appearanceValue = appearance?.value;
  const mode: AppearanceMode = appearanceValue === "light" || appearanceValue === "dark"
    ? appearanceValue
    : "system";
  const minimum = boundedInteger(session?.minimum, 1, SESSION_IDLE_MINUTES_MAX)
    ?? SESSION_IDLE_MINUTES_MIN;
  const maximum = boundedInteger(
    session?.maximum,
    Math.max(minimum, SESSION_IDLE_MINUTES_MIN),
    SESSION_IDLE_MINUTES_MAX,
  ) ?? SESSION_IDLE_MINUTES_MAX;
  const sessionMinutes = boundedInteger(session?.value, minimum, maximum);
  if (sessionMinutes === null) return null;

  const profileBase = record(value.public_profile_base_url);
  const profileBaseAllowed = Array.isArray(profileBase?.allowed_values)
    ? profileBase.allowed_values.filter((entry): entry is string => typeof entry === "string")
    : [];
  // Absent or unrecognised falls back to the first offered base rather than
  // rejecting the payload: a Core that does not manage this setting must still
  // be able to serve the rest of the configuration page.
  const profileBaseValue = typeof profileBase?.value === "string"
      && profileBaseAllowed.includes(profileBase.value)
    ? profileBase.value
    : (profileBaseAllowed[0] ?? "");

  const webBase = record(value.public_web_base);
  const webBaseValue = typeof webBase?.value === "string" ? webBase.value : "";

  return {
    people_hero_enabled: { value: people.value, ...settingMetadata(people) },
    demo_system_enabled: { value: demo.value, ...settingMetadata(demo) },
    app_appearance_mode: { value: mode, ...settingMetadata(appearance) },
    public_profile_base_url: {
      value: profileBaseValue,
      allowed_values: profileBaseAllowed,
      ...settingMetadata(profileBase),
    },
    public_web_base: { value: webBaseValue, ...settingMetadata(webBase) },
    join_session_idle_minutes: {
      value: sessionMinutes,
      minimum,
      maximum,
      ...settingMetadata(session),
    },
  };
}

export function runtimeSettingsSavePayload(settings: RuntimeSettings) {
  const payload: Record<string, unknown> = {
    people_hero_enabled: settings.people_hero_enabled.value,
    demo_system_enabled: settings.demo_system_enabled.value,
    app_appearance_mode: settings.app_appearance_mode.value,
    join_session_idle_minutes: settings.join_session_idle_minutes.value,
  };
  // Omitted rather than sent empty when this Core does not manage it: the
  // server validates every key it is given, so one unmanaged value would
  // refuse the whole save and block the settings that ARE managed.
  if (settings.public_profile_base_url.value) {
    payload.public_profile_base_url = settings.public_profile_base_url.value;
  }
  if (settings.public_web_base.value) {
    payload.public_web_base = settings.public_web_base.value;
  }
  return payload;
}

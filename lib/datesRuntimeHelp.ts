export const DATES_RUNTIME_HELP_GROUPS = [
  {
    id: "rollout",
    settingKeys: [
      "dates_creation_enabled",
      "dates_live_sharing_enabled",
      "dates_reviews_enabled",
      "dates_digest_enabled",
    ],
  },
  {
    id: "activityLifecycle",
    settingKeys: [
      "dates_default_scheduled_duration_minutes",
      "dates_tbd_expiry_days",
      "dates_now_lifetime_hours",
      "dates_now_warning_minutes",
      "dates_decline_cooldown_hours",
      "dates_invalidated_visibility_hours",
      "dates_maximum_headcount_limit",
    ],
  },
  {
    id: "rateLimits",
    settingKeys: [
      "dates_creation_rate_limit",
      "dates_request_rate_limit",
      "dates_rejoin_rate_limit",
      "dates_chat_message_rate_limit",
      "dates_live_point_rate_limit",
    ],
  },
  {
    id: "safetyRetention",
    settingKeys: [
      "dates_report_sla_hours",
      "dates_distinct_report_suspend_threshold",
      "dates_activity_soft_delete_retention_days",
      "dates_live_trail_retention_days",
      "moderation_evidence_retention_days",
    ],
  },
  {
    id: "digest",
    settingKeys: [
      "dates_digest_frequency",
      "dates_digest_quiet_hours",
    ],
  },
] as const;

export const DATES_RUNTIME_HELP_KEYS = DATES_RUNTIME_HELP_GROUPS.flatMap(
  (group) => [...group.settingKeys],
);

export const DATES_RUNTIME_HELP_KEY_SET = new Set<string>(DATES_RUNTIME_HELP_KEYS);

export const DATES_LIVE_TRAIL_RETENTION_KEY = "dates_live_trail_retention_days";

/**
 * Whether live sharing is refused because no live-trail retention is set.
 *
 * While the effective `dates_live_trail_retention_days` is below one day, Core
 * refuses every live-sharing operation (start, location points, pause, resume,
 * stop and the live map) with dates-live-retention-unconfigured, whatever the
 * live-sharing switch says. Since Core be03922a the dates-worker no longer
 * stops for it: it logs a warning and keeps delivering notifications, expiring
 * activities and running scheduled purges. A missing row proves nothing, so
 * it is not reported as unset; a malformed value cannot prove a positive
 * retention, so it is.
 */
export function datesLiveRetentionUnset(
  settings: ReadonlyArray<{ key: unknown; effective_value: unknown }>,
): boolean {
  const setting = settings.find((item) => item?.key === DATES_LIVE_TRAIL_RETENTION_KEY);
  if (!setting) return false;
  return !(Number.isInteger(setting.effective_value) && Number(setting.effective_value) >= 1);
}

/** Presentation metadata only. This neither authorizes nor retries an action.
 * The server bridge owns its independent allow-list/roles/capabilities.
 * Tests require exact parity with its active read classifications.
 * Audited reads in this set must NEVER be recovery-loader registrations.
 */
export const ADMIN_CLIENT_READ_ACTIONS = [
  "overview", "list_users", "registration_platform_stats", "user_detail", "user_moderation_insight",
  "membership_configuration", "membership_user_detail", "app_review_sandbox_status", "list_landing", "get_settings",
  "invite_configuration", "list_signup_options", "list_profile_fields", "support_threads", "support_messages", "help_admin_list",
  "footprints_admin", "pinger_admin", "footprint_reports", "profile_verification_config", "profile_presence_configuration",
  "location_access_policy", "profile_verification_queue", "profile_verification_detail", "user_moderation", "list_icebreakers",
  "user_profile_fields", "moderation_pic_list", "user_profile_albums", "admin_get_image_data", "profile_location_policies",
  "profile_presentation", "profile_tag_catalogs", "profile_tag_catalog_preview", "profile_photo_insights", "list_admins",
  "list_audit", "signup_photo_config", "admin_get_user_popup", "list_canned", "user_history", "user_history_detail",
  "moderation_reported_list", "into_tag_moderation_list", "persona_start_get_config_admin", "verification_console",
  "verification_simulate", "verification_pending_summary", "verification_user_detail", "verification_method_console",
  "persona_screens_console", "audience_visibility_catalog", "audience_visibility_member_detail", "feature_switches_get",
  "appearance_rules_list", "appearance_rules_preview", "mode_cards_get", "section_teasers_get", "admin_me",
  "dates_activity_list", "dates_activity_detail", "dates_activity_location", "dates_configuration", "dates_moderation_queue",
  "dates_moderation_detail", "dates_moderation_evidence", "dates_moderation_sla", "dates_reason_list", "dates_external_event_list",
  "dates_external_event_detail", "dates_event_intake_list", "dates_event_intake_detail", "dates_event_intake_usage",
  "dates_event_research_overview", "dates_event_research_run_list", "dates_event_research_run_detail",
] as const;
const reads: ReadonlySet<string> = new Set(ADMIN_CLIENT_READ_ACTIONS);
// Dedicated URI, not an allow-listed generic Core action. Its existing writer
// role/capability gate remains unchanged; a failed lookup is not a lost write.
const dedicatedReads: ReadonlySet<string> = new Set(["persona-member"]);
export function isAdminClientReadAction(action: string): boolean { return reads.has(action) || dedicatedReads.has(action); }

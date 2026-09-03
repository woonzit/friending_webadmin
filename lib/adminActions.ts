import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  FEATURE_SWITCHES_CONTRACT_READY,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "@/lib/contractReadiness";
import { ADMIN_GRANTED_VERIFICATION_ACTIONS } from "@/lib/adminGrantedVerification";
import { APPEARANCE_ACTIONS } from "@/lib/appearanceRules";
import {
  AUDIENCE_VISIBILITY_ADMIN_ACTIONS,
  AUDIENCE_VISIBILITY_IDENTITY_ACTIONS,
} from "@/lib/audienceVisibilityAdmin";
import { FEATURE_SWITCHES_ACTIONS } from "@/lib/featureSwitches";
import { INTO_TAG_MODERATION_ACTIONS } from "@/lib/intoTagModeration";
import { MODE_CARDS_ACTIONS } from "@/lib/modeCards";
import { PROFILE_TEXT_MODERATION_ACTIONS } from "@/lib/profileTextModeration";
import { VERIFICATION_METHOD_ACTIONS } from "@/lib/verificationMethod";
import { OUTBOUND_MESSAGING_ACTIONS } from "@/lib/outboundMessaging";
import { PERSONA_ADMIN_ACTIONS } from "@/lib/personaAdmin";
import { PERSONA_SCREENS_ACTIONS } from "@/lib/personaScreens";
import {
  MAX_VERIFICATION_BADGE_FORM_BYTES,
  VERIFICATION_ADMIN_ACTIONS,
} from "@/lib/verificationAdmin";

export const DATES_ADMIN_ACTIONS = [
  "admin_me",
  "dates_activity_list",
  "dates_activity_detail",
  "dates_activity_location",
  "dates_activity_update",
  "dates_activity_command",
  "dates_activity_host_transfer",
  "dates_configuration",
  "dates_configuration_save",
  "dates_activity_type_save",
  "dates_moderation_queue",
  "dates_moderation_detail",
  "dates_moderation_evidence",
  "dates_moderation_trail_evidence",
  "dates_moderation_claim",
  "dates_moderation_heartbeat",
  "dates_moderation_release",
  "dates_moderation_note",
  "dates_moderation_escalate",
  "dates_moderation_resolve",
  "dates_moderation_legal_hold",
  "dates_moderation_sla",
  "dates_reason_list",
  "dates_reason_save",
  "dates_reason_deactivate",
] as const;

const REPORTED_CONTENT_ADMIN_ACTIONS = ["moderation_reported_list", "moderation_report_action"] as const;

const PRODUCT_POPUP_ADMIN_ACTIONS = ["admin_get_user_popup", "admin_set_user_popup", "admin_clear_user_popup"] as const;

const CANNED_TEMPLATE_ADMIN_ACTIONS = ["list_canned", "save_canned", "delete_canned"] as const;

/** Strict v1 outbound actions; Core rechecks its own history/send capability on every call. */
const ACTIVE_OUTBOUND_MESSAGING_ACTIONS = OUTBOUND_MESSAGING_ACTIONS;

/** Receipt-era Persona routes; Core authors the exact per-action capability block. */
const ACTIVE_PERSONA_ADMIN_ACTIONS = PERSONA_ADMIN_ACTIONS;

/** Released verification actions; each one is rechecked against Core's capability projection. */
const ACTIVE_VERIFICATION_ADMIN_ACTIONS = VERIFICATION_ADMIN_ACTIONS;

/** Dormant T-219 actions: the provider is unreleased, so they stay behind their own switch. */
const ACTIVE_ADMIN_GRANTED_VERIFICATION_ACTIONS = ADMIN_GRANTED_VERIFICATION_CONTRACT_READY
  ? ADMIN_GRANTED_VERIFICATION_ACTIONS
  : [] as const;

/** Released T-617 actions (D-092), gated by Core's `admin_me.verification_method` block. */
const ACTIVE_VERIFICATION_METHOD_ACTIONS = VERIFICATION_METHOD_ACTIONS;

/** Released T-550 actions (D-080 Persona screens), gated by Core's `admin_me.persona_screens` block. */
const ACTIVE_PERSONA_SCREENS_ACTIONS = PERSONA_SCREENS_ACTIONS;

/** Dormant T-216 actions stay absent until the reviewed T-120 provider release. */
const ACTIVE_PROFILE_TEXT_MODERATION_ACTIONS = PROFILE_TEXT_MODERATION_CONTRACT_READY
  ? PROFILE_TEXT_MODERATION_ACTIONS
  : [] as const;

/**
 * Released T-218b actions (T-687), gated by Core's `admin_me.feature_switches`
 * block: the proxy re-checks `contract_ready` and the principal's capability on
 * every call, so this constant is the rollback lever, not the authorization.
 */
const ACTIVE_FEATURE_SWITCHES_ACTIONS = FEATURE_SWITCHES_CONTRACT_READY
  ? FEATURE_SWITCHES_ACTIONS
  : [] as const;

/** Released D-052 appearance-rule actions; Core rechecks its editor gate on every mutation. */
const ACTIVE_APPEARANCE_ACTIONS = APPEARANCE_ACTIONS;

/**
 * T-706 / D-115 mode cards. Released with their Core provider: the copy they
 * edit reaches members only through the existing public `ios_appconfig` read,
 * and an unsaved singleton serves the app's compiled strings, so a console that
 * is live before an operator touches it changes nothing.
 */
const ACTIVE_MODE_CARDS_ACTIONS = MODE_CARDS_ACTIONS;

export const ADMIN_ACTIONS = [
  "overview",
  "list_users",
  "user_detail",
  "membership_configuration",
  "save_membership_configuration",
  "membership_user_detail",
  "membership_admin_grant_preview",
  "membership_admin_grant",
  "membership_admin_grant_update",
  "membership_admin_grant_revoke",
  "app_review_sandbox_status",
  "app_review_sandbox_reset",
  "set_demo_visibility_permission",
  "list_landing",
  "save_landing",
  "delete_landing",
  "get_settings",
  "set_settings",
  "invite_configuration",
  "save_invite_configuration",
  "list_signup_options",
  "save_signup_page_layout",
  "save_intents_selection_limits",
  "list_profile_fields",
  "support_threads",
  "support_messages",
  "support_send",
  "help_admin_list",
  "save_help_category",
  "save_help_article",
  "publish_help_article",
  "archive_help_article",
  "footprints_admin",
  "pinger_admin",
  "save_pinger_config",
  "save_footprint_settings",
  "save_footprint_badge",
  "archive_footprint_badge",
  "set_footprint_user_limit",
  "footprint_reports",
  "resolve_footprint_report",
  "profile_verification_config",
  "save_profile_verification_config",
  "profile_presence_configuration",
  "save_profile_presence_configuration",
  "profile_verification_queue",
  "profile_verification_detail",
  "profile_verification_decision",
  "profile_verification_lease",
  "profile_verification_evidence",
  "user_moderation",
  "suspend_user",
  "unsuspend_user",
  "ban_user",
  "unban_user",
  "ban_user_ip",
  "remove_ip_ban",
  "force_logout_user",
  "admin_save_user_content",
  "admin_set_main_photo",
  "list_icebreakers",
  "save_icebreaker_prompt",
  "archive_icebreaker_prompt",
  "save_profile_section_layout",
  "save_profile_field",
  "archive_profile_field",
  "save_profile_field_option",
  "archive_profile_field_option",
  "user_profile_fields",
  "save_user_profile_fields",
  "save_user_profile_identity",
  "moderation_pic_list",
  "moderation_image_action",
  "user_profile_albums",
  "admin_delete_profile_album_image",
  "admin_get_image_data",
  "admin_replace_image",
  "set_image_square_crop",
  "profile_location_policies",
  "save_profile_location_policy",
  "delete_profile_location_policy",
  "profile_presentation",
  "save_profile_presentation",
  "save_profile_presentation_source",
  "profile_tag_catalogs",
  "profile_tag_catalog_preview",
  "save_profile_tag_catalog",
  "profile_photo_insights",
  "list_admins",
  "add_admin",
  "update_admin",
  "delete_admin",
  "list_audit",
  "signup_photo_config",
  "save_signup_photo_config",
  ...PRODUCT_POPUP_ADMIN_ACTIONS,
  ...CANNED_TEMPLATE_ADMIN_ACTIONS,
  ...ACTIVE_OUTBOUND_MESSAGING_ACTIONS,
  ...REPORTED_CONTENT_ADMIN_ACTIONS,
  ...INTO_TAG_MODERATION_ACTIONS,
  ...ACTIVE_PERSONA_ADMIN_ACTIONS,
  ...ACTIVE_VERIFICATION_ADMIN_ACTIONS,
  ...ACTIVE_ADMIN_GRANTED_VERIFICATION_ACTIONS,
  ...ACTIVE_VERIFICATION_METHOD_ACTIONS,
  ...ACTIVE_PERSONA_SCREENS_ACTIONS,
  ...AUDIENCE_VISIBILITY_ADMIN_ACTIONS,
  ...AUDIENCE_VISIBILITY_IDENTITY_ACTIONS,
  ...ACTIVE_PROFILE_TEXT_MODERATION_ACTIONS,
  ...ACTIVE_FEATURE_SWITCHES_ACTIONS,
  ...ACTIVE_APPEARANCE_ACTIONS,
  ...ACTIVE_MODE_CARDS_ACTIONS,
  ...DATES_ADMIN_ACTIONS,
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * What a principal must hold to invoke an action, mirroring the gate Core runs
 * for the same route:
 *
 * - `read` — `requireAdminActor()`. Any active administrator, `viewer` included.
 * - `write` — `requireAdminEditor()`. `owner` or `admin` only.
 * - `owner` — `requireAdminActor($request, true)`. `owner` only.
 * - `dates_read` / `dates_write` — the separate Dates capability ladder in
 *   `DatesAdminAuthorizationService`, whose read-only rung is `support_viewer`.
 */
export type AdminActionAccess = "read" | "write" | "owner" | "dates_read" | "dates_write";

/**
 * The classification is exhaustive by type: `Record<AdminAction, …>` fails the
 * typecheck when an action is added to the allow-list without a class, and the
 * runtime lookup denies anything it does not find. Adding an action therefore
 * cannot silently grant write access.
 *
 * The historically permissive campaign, landing, demo-visibility and media
 * handlers now use Core's editor gate too. Their explicit `write` rows remain
 * valuable defence in depth: a future backend regression still cannot widen
 * the browser surface to a read-only viewer.
 */
export const ADMIN_ACTION_ACCESS = {
  overview: "read",
  list_users: "read",
  user_detail: "read",
  membership_configuration: "read",
  save_membership_configuration: "write",
  membership_user_detail: "read",
  membership_admin_grant_preview: "write",
  membership_admin_grant: "write",
  membership_admin_grant_update: "write",
  membership_admin_grant_revoke: "owner",
  // App Review sandbox: the status names no credential (only whether one is
  // configured), so every active admin may read it. The reset rebuilds only
  // documents carrying the sandbox scope and is audited on Core, so `admin`
  // suffices — it matches Core's `viewer`-refusing write gate, never weaker.
  app_review_sandbox_status: "read",
  app_review_sandbox_reset: "write",
  set_demo_visibility_permission: "write",
  list_landing: "read",
  save_landing: "write",
  delete_landing: "write",
  get_settings: "read",
  set_settings: "write",
  invite_configuration: "read",
  save_invite_configuration: "write",
  list_signup_options: "read",
  save_signup_page_layout: "write",
  // D-114 (T-702 §6). One receipted, revision-guarded write for the "What are
  // you looking for?" row's maximum and required minimum, posted from the
  // signup composer's System card. It is deliberately NOT a member of
  // `AUDIENCE_VISIBILITY_ADMIN_ACTIONS`: that array is decoded against Core's
  // `audience_visibility.actions` with an exact ordered match, so an eighth
  // entry would darken the whole `/audience-visibility` workspace and refuse
  // the seven actions that already work (the T-653 lesson). Core publishes it
  // in a sibling `admin_me` block instead and rechecks `CAP_INTENT_WRITE` on
  // every call; this row adds the independent global editor floor, matching
  // Core's `viewer`-refusing write gate and never weaker than it.
  save_intents_selection_limits: "write",
  list_profile_fields: "read",
  support_threads: "read",
  // Reading a member's messages clears the operator-side unread counter —
  // the bell feed's read-clears-counter rule, mirrored by Core's actor gate.
  support_messages: "read",
  support_send: "write",
  help_admin_list: "read",
  save_help_category: "write",
  save_help_article: "write",
  publish_help_article: "write",
  archive_help_article: "write",
  footprints_admin: "read",
  pinger_admin: "read",
  save_pinger_config: "write",
  save_footprint_settings: "write",
  save_footprint_badge: "write",
  archive_footprint_badge: "write",
  set_footprint_user_limit: "write",
  footprint_reports: "read",
  resolve_footprint_report: "write",
  // Profile Video Verification V1: queue/config metadata is visible to every
  // active admin. Configuration writes, evidence and review commands match
  // Core's editor/owner gate; a viewer can never obtain biometric bytes.
  profile_verification_config: "read",
  save_profile_verification_config: "write",
  // Presence availability is visible to every active administrator. Disabling
  // a mode rewrites affected member profiles, so only editors may save it.
  profile_presence_configuration: "read",
  save_profile_presence_configuration: "write",
  profile_verification_queue: "read",
  profile_verification_detail: "read",
  profile_verification_decision: "write",
  profile_verification_lease: "write",
  profile_verification_evidence: "write",
  // moderation v1: status is a read; every command is a write matching
  // Core's requireAdminEditor gate.
  user_moderation: "read",
  suspend_user: "write",
  unsuspend_user: "write",
  ban_user: "write",
  unban_user: "write",
  ban_user_ip: "write",
  remove_ip_ban: "write",
  force_logout_user: "write",
  admin_save_user_content: "write",
  admin_set_main_photo: "write",
  list_icebreakers: "read",
  save_icebreaker_prompt: "write",
  archive_icebreaker_prompt: "write",
  save_profile_section_layout: "write",
  save_profile_field: "write",
  archive_profile_field: "write",
  save_profile_field_option: "write",
  archive_profile_field_option: "write",
  user_profile_fields: "read",
  save_user_profile_fields: "write",
  save_user_profile_identity: "write",
  moderation_pic_list: "read",
  moderation_image_action: "write",
  user_profile_albums: "read",
  admin_delete_profile_album_image: "write",
  // Returns one picture as a data URL. Same exposure as `user_profile_albums`,
  // which already shows these pictures, so it classifies the same way. It is a
  // data URL rather than a proxied fetch because a cross-origin image would
  // taint the editor's canvas and make the save throw.
  admin_get_image_data: "read",
  // Overwrites the member's own picture in public media storage and marks it
  // accepted. That is a write in the strongest sense the console has.
  admin_replace_image: "write",
  set_image_square_crop: "write",
  profile_location_policies: "read",
  save_profile_location_policy: "write",
  delete_profile_location_policy: "write",
  profile_presentation: "read",
  save_profile_presentation: "write",
  save_profile_presentation_source: "write",
  profile_tag_catalogs: "read",
  profile_tag_catalog_preview: "read",
  save_profile_tag_catalog: "write",
  profile_photo_insights: "read",
  list_admins: "read",
  add_admin: "owner",
  update_admin: "owner",
  delete_admin: "owner",
  list_audit: "read",

  // Signup photo experience, contract §4.1/§4.2. Core gates the read on `requireAdminActor` and the
  // write on `requireAdminEditor`; both classifications here are at least as strict.
  signup_photo_config: "read",
  save_signup_photo_config: "write",

  // Product-popup reads are safe for every active administrator. Creating,
  // replacing, or clearing the member-bound popup requires the global editor
  // role here and Core's narrower capability/revision checks afterward.
  admin_get_user_popup: "read",
  admin_set_user_popup: "write",
  admin_clear_user_popup: "write",

  // Core authors the narrower canned-template capabilities on every response;
  // the bridge also enforces the global viewer/editor ladder in depth.
  list_canned: "read",
  save_canned: "write",
  delete_canned: "write",

  // Core authors the narrower history/send capabilities on every action.
  // These rows add only the independent global viewer/editor floor.
  outbound_message_preview: "write",
  send_message: "write",
  user_history: "read",
  user_history_detail: "read",

  // The list is safe for every active administrator. A browser-side decision
  // also requires the global editor role; Core then rechecks its narrower
  // reported-content capability before accepting any mutation.
  moderation_reported_list: "read",
  moderation_report_action: "write",

  // Into-tag moderation (D-107 R10). Core gates these on its own
  // `into_tag_moderation_read` / `into_tag_moderation` capabilities and
  // rechecks them on every call; these rows add only the independent global
  // viewer/editor floor. A decision approves a tag into everyone's vocabulary
  // or bans it out of every profile that holds it, so both mutations sit at
  // the write floor and the queue read sits at the read floor.
  into_tag_moderation_list: "read",
  into_tag_moderation_decide: "write",
  into_tag_moderation_settings: "write",

  // Persona has its own exact per-action capability block, rechecked by the
  // bridge. These rows add the independent global viewer/editor floor.
  persona_start_get_config_admin: "read",
  persona_start_update_config: "write",
  admin_force_persona_verify: "write",
  admin_apply_fake_persona: "write",
  admin_revoke_fake_persona: "write",

  // Core authors the exact per-action verification capability projection and
  // rechecks it on every call; these rows add the global viewer/editor floor.
  verification_console: "read",
  verification_policy_save_draft: "write",
  verification_policy_impact_preview: "owner",
  verification_policy_apply: "owner",
  verification_copy_save: "write",
  verification_copy_remove: "write",
  verification_pending_settings_save: "write",
  verification_badge_upload: "write",
  verification_badge_remove: "write",
  verification_places_city_search: "write",
  verification_places_city_detail: "write",
  verification_simulate: "read",
  verification_pending_summary: "read",
  verification_user_detail: "read",
  verification_grant_preview: "write",
  verification_grant_save: "write",
  verification_grant_remove: "write",

  ...(ADMIN_GRANTED_VERIFICATION_CONTRACT_READY ? {
    verification_grant: "write" as const,
    verification_revoke: "write" as const,
  } : {}),

  // T-617 contract §2.1: the console read is open to any active administrator,
  // the CAS draft save is an editor write, and both the counts-only impact
  // preview and the publication are owner-only. Core authors the exact
  // `verification_method` capability list and rechecks it on every call, so
  // these rows only add the independent global floor.
  verification_method_console: "read",
  verification_method_save: "write",
  verification_method_impact: "owner",
  verification_method_apply: "owner",

  // Persona screens contract §5: the console read is open to any active
  // administrator; the revisioned save is an editor write. Core authors the
  // exact per-action `persona_screens` capability list and rechecks it on every
  // call, so these rows only add the independent global viewer/editor floor.
  persona_screens_console: "read",
  persona_screens_save: "write",

  // Released audience-visibility routes. Core authors the exact per-action
  // capability projection; these rows add only the independent global
  // viewer/editor floor.
  audience_visibility_catalog: "read",
  audience_visibility_member_detail: "read",
  save_audience_visibility_group: "write",
  archive_audience_visibility_group: "write",
  save_audience_visibility_intent: "write",
  archive_audience_visibility_intent: "write",
  set_audience_visibility_intent_limit: "write",

  // T-653. The member identity write is authorized by Core's SIBLING
  // `admin_me.audience_visibility_identity` block, whose ladder starts at
  // editor; this row adds only the independent global editor floor.
  save_audience_visibility_member_identity: "write",

  ...(PROFILE_TEXT_MODERATION_CONTRACT_READY ? {
    moderation_profile_text_list: "read" as const,
    moderation_profile_text_action: "write" as const,
  } : {}),

  ...(FEATURE_SWITCHES_CONTRACT_READY ? {
    feature_switches_get: "read" as const,
    feature_switches_set: "write" as const,
  } : {}),

  // D-052 appearance rules. Listing and the test-location preview are safe
  // reads for every active administrator; save and delete match Core's editor
  // gate and audit. The city lookup spends Google geocoding quota, so it is a
  // write on this ladder exactly like `verification_places_city_search`.
    appearance_rules_list: "read",
    appearance_rules_save: "write",
    appearance_rules_delete: "write",
    appearance_rules_preview: "read",
    appearance_city_geocode: "write",

  // T-706 mode cards. The read is safe for every active administrator; the save
  // matches Core's editor gate, its receipt and its audit row.
    mode_cards_get: "read",
    save_mode_cards: "write",

  admin_me: "read",
  dates_activity_list: "dates_read",
  dates_activity_detail: "dates_read",
  dates_activity_location: "dates_read",
  dates_activity_update: "dates_write",
  dates_activity_command: "dates_write",
  dates_activity_host_transfer: "dates_write",
  dates_configuration: "dates_read",
  dates_configuration_save: "dates_write",
  dates_activity_type_save: "dates_write",
  dates_moderation_queue: "dates_read",
  dates_moderation_detail: "dates_read",
  dates_moderation_evidence: "dates_read",
  dates_moderation_trail_evidence: "dates_write",
  dates_moderation_claim: "dates_write",
  dates_moderation_heartbeat: "dates_write",
  dates_moderation_release: "dates_write",
  dates_moderation_note: "dates_write",
  dates_moderation_escalate: "dates_write",
  dates_moderation_resolve: "dates_write",
  dates_moderation_legal_hold: "dates_write",
  dates_moderation_sla: "dates_read",
  dates_reason_list: "dates_read",
  dates_reason_save: "dates_write",
  dates_reason_deactivate: "dates_write",
} as Record<AdminAction, AdminActionAccess>;

// A Map, not the record itself: a plain-object lookup would resolve inherited
// keys such as `constructor` to a truthy value for an action nobody allow-listed.
const ACTION_ACCESS: ReadonlyMap<string, AdminActionAccess> = new Map(
  Object.entries(ADMIN_ACTION_ACCESS),
);

/** Global roles Core's `WebadminRolePolicy` lets write. `viewer` is read-only. */
const GLOBAL_WRITE_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

/** The Dates rung that holds no write capability at all. */
const DATES_READ_ONLY_ROLE = "support_viewer";

const DATES_ROLES: ReadonlySet<string> = new Set([
  "support_viewer",
  "moderator",
  "senior_moderator",
  "administrator",
  "superadmin",
]);

export type AdminPrincipal = {
  /** `owner`, `admin` or `viewer`; `""` when the membership payload was unusable. */
  role: string;
  /** Resolved Dates rung; `""` when no rung can be established. */
  datesRole: string;
};

/**
 * Core derives the same fallback when an `admin_emails` row carries no explicit
 * `dates_role` (`DatesAdminAuthorizationService::role`). It is reproduced here so
 * a Core response without a `dates` block does not lock every Dates operator
 * out. Unlike Core, an unrecognised global role resolves to no rung at all
 * rather than to `administrator`: this layer fails closed.
 */
function datesRoleFromGlobalRole(role: string): string {
  if (role === "owner") return "superadmin";
  if (role === "admin") return "administrator";
  if (role === "viewer") return DATES_READ_ONLY_ROLE;
  return "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function lowercaseString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Read the principal out of a Core `admin_me` payload. Anything unexpected
 * resolves to a role that grants nothing, so a malformed membership response
 * denies writes instead of inheriting them.
 */
export function adminPrincipalFrom(value: unknown): AdminPrincipal {
  const row = record(value);
  const role = lowercaseString(row?.role);
  const datesRole = lowercaseString(record(row?.dates)?.role);
  return {
    role,
    datesRole: DATES_ROLES.has(datesRole) ? datesRole : datesRoleFromGlobalRole(role),
  };
}

/**
 * Per-action request-body ceiling. Everything caps at 256 KB except explicitly bounded bulk
 * documents.
 */
const DEFAULT_BODY_LIMIT_BYTES = 256_000;
const TAG_CATALOG_BODY_LIMIT_BYTES = 1_100_000;
// T-517: all 249 regions collapse to the semantic ALL token, so the true
// maximum is 249 storefront overrides carrying 248 enumerated regions, all
// 205 derived E.164 calling codes and 205 maximal masks. The proven browser
// JSON is 629,851 bytes; 694,000 keeps just over ten percent headroom.
const RUNTIME_SETTINGS_BODY_LIMIT_BYTES = 694_000;
// The Core contract permits every ISO storefront to carry localized templates.
// Row, language and template caps still bound the decoded document; this limit
// keeps the bridge from rejecting a configuration valid at those maxima.
const INVITE_CONFIGURATION_BODY_LIMIT_BYTES = 16_000_000;
/**
 * The re-cropped picture travels as base64 inside the JSON body, which costs
 * about a third on top of the JPEG. Core refuses a decoded image over 8 MiB, so
 * this sits just under the point where a body could still decode to an accepted
 * image: anything larger is rejected here, cheaply, instead of after the upload.
 */
const REPLACE_IMAGE_BODY_LIMIT_BYTES = 6_000_000;
/**
 * One appearance rule may replace the hero carousel with up to 100 items, each
 * carrying three 2048-character URLs plus bounded bilingual copy — roughly
 * 750 KB at the caps — so the save shares the tag-catalogue ceiling.
 */
const APPEARANCE_RULE_BODY_LIMIT_BYTES = TAG_CATALOG_BODY_LIMIT_BYTES;
/**
 * T-617 method policy. One canonical `draft_json` may name all 249 storefronts,
 * each row carrying its scalar method AND both locale containers of its copy
 * override filled to the contract caps (title 60, subtitle 90, description 400
 * code points of four-byte UTF-8, plus a 2048-byte ASCII `help_url`), with the
 * same two full blocks in `waiting_room_copy.default`. `tests/adminActionLimits.
 * test.mts` derives the exact maximum from the caps, builds the document and
 * proves the proxy parser admits it. The ceiling sits above it and stays a
 * finite per-request bound (Apache 2.4.52 does not apply `LimitRequestBody` to
 * the proxied path, so this is the effective guard). The impact preview and the
 * publication carry only a revision, so they keep the default ceiling.
 */
const VERIFICATION_METHOD_BODY_LIMIT_BYTES = 2_400_000;

/**
 * `save_signup_photo_config` deliberately does NOT appear below. Its `tips_json` carries at most 12
 * items, each bounded by the caps in `lib/signupPhotoConfig.ts`, so a maximal document — every
 * string filled to its cap with four-byte characters and both image URLs at 2048 characters — is
 * roughly a third of the default ceiling. `tests/adminActionLimits.test.mts` builds that maximal
 * document and asserts it fits, so the bound is proven from the caps rather than assumed; raising a
 * cap far enough to break it fails that test instead of producing a silent 413.
 */
const ADMIN_ACTION_BODY_LIMIT: Readonly<Record<string, number>> = {
  save_profile_tag_catalog: TAG_CATALOG_BODY_LIMIT_BYTES,
  save_invite_configuration: INVITE_CONFIGURATION_BODY_LIMIT_BYTES,
  set_settings: RUNTIME_SETTINGS_BODY_LIMIT_BYTES,
  admin_replace_image: REPLACE_IMAGE_BODY_LIMIT_BYTES,
  appearance_rules_save: APPEARANCE_RULE_BODY_LIMIT_BYTES,
  verification_method_save: VERIFICATION_METHOD_BODY_LIMIT_BYTES,
  // A1: this is the effective guard on Apache 2.4.52 and therefore stays
  // pinned independently of the Verification capability projection.
  verification_badge_upload: MAX_VERIFICATION_BADGE_FORM_BYTES,
};

const ACTION_BODY_LIMIT: ReadonlyMap<string, number> = new Map(
  Object.entries(ADMIN_ACTION_BODY_LIMIT),
);

export function adminActionBodyLimit(action: string): number {
  return ACTION_BODY_LIMIT.get(action) ?? DEFAULT_BODY_LIMIT_BYTES;
}

/**
 * Per-action Core timeout.
 *
 * The bridge used to pass none, so `coreCall`'s 10 s default applied to every action and an abort
 * surfaced to the operator as `core-unavailable` — "Core is down" — for what was really one slow
 * call. The three upload routes already opt into 30 s deliberately; these are the read and write
 * paths that carry the same weight.
 *
 * The listed actions all traverse the migrated catalogue: three catalogues, 17 groups and 627 items,
 * with the save running inside a Mongo transaction. Anything unlisted keeps the 10 s default.
 *
 * Rule for a new action: raise it only with a measured reason. A generous timeout on a *mutating*
 * call is not free — it widens the window in which the operator cannot tell whether the write
 * landed, which is why `core-timeout` is reported distinctly from `core-unavailable`.
 */
const DEFAULT_CORE_TIMEOUT_MS = 10_000;
const BULK_CATALOG_TIMEOUT_MS = 30_000;
/**
 * Matches the three upload routes. Core decodes the JPEG and writes six files —
 * two originals plus four resized variants — before it answers, which is more
 * work than the 10 s default assumes for a body of this size.
 */
const REPLACE_IMAGE_TIMEOUT_MS = 30_000;

const ADMIN_ACTION_TIMEOUT_MS: Partial<Record<AdminAction, number>> = {
  admin_replace_image: REPLACE_IMAGE_TIMEOUT_MS,
  profile_tag_catalogs: BULK_CATALOG_TIMEOUT_MS,
  profile_tag_catalog_preview: BULK_CATALOG_TIMEOUT_MS,
  save_profile_tag_catalog: BULK_CATALOG_TIMEOUT_MS,
  profile_presentation: BULK_CATALOG_TIMEOUT_MS,
  save_profile_presentation: BULK_CATALOG_TIMEOUT_MS,
};

const ACTION_TIMEOUT: ReadonlyMap<string, number> = new Map(
  Object.entries(ADMIN_ACTION_TIMEOUT_MS),
);

export function adminActionTimeoutMs(action: string): number {
  return ACTION_TIMEOUT.get(action) ?? DEFAULT_CORE_TIMEOUT_MS;
}

export function isAdminActionAllowed(action: string): boolean {
  return ACTION_ACCESS.has(action);
}

export function adminActionAccess(action: string): AdminActionAccess | null {
  return ACTION_ACCESS.get(action) ?? null;
}

/**
 * Whether an already-authenticated, membership-checked principal may run this
 * action. Membership is the caller's responsibility; this answers the role
 * question only. An unknown or unclassified action is denied.
 */
export function isAdminActionAuthorized(action: string, principal: AdminPrincipal): boolean {
  const access = ACTION_ACCESS.get(action);
  switch (access) {
    case "read":
    case "dates_read":
      return true;
    case "write":
      return GLOBAL_WRITE_ROLES.has(principal.role);
    case "owner":
      return principal.role === "owner";
    case "dates_write":
      return principal.datesRole !== "" && principal.datesRole !== DATES_READ_ONLY_ROLE;
    default:
      return false;
  }
}

/**
 * Compose the generic Webadmin role floor with independent capability blocks.
 * Actions in these named versioned families are already authorized by their
 * exact Core-authored `admin_me` projection and must not be reinterpreted from
 * the top-level role. Every other family keeps the existing generic policy.
 */
export function isAdminBridgeActionAuthorized(
  action: string,
  principal: AdminPrincipal,
  audienceVisibilityAuthorized: boolean | null,
  profileTextModerationAuthorized: boolean | null = null,
  featureSwitchesAuthorized: boolean | null = null,
): boolean {
  if ((AUDIENCE_VISIBILITY_ADMIN_ACTIONS as readonly string[]).includes(action)
    || (AUDIENCE_VISIBILITY_IDENTITY_ACTIONS as readonly string[]).includes(action)) {
    return audienceVisibilityAuthorized === true;
  }
  if ((PROFILE_TEXT_MODERATION_ACTIONS as readonly string[]).includes(action)) {
    return profileTextModerationAuthorized === true;
  }
  if ((FEATURE_SWITCHES_ACTIONS as readonly string[]).includes(action)) {
    return featureSwitchesAuthorized === true;
  }
  return isAdminActionAuthorized(action, principal);
}

/**
 * Only a failed membership/session check should send an operator back to the
 * login page. A role or Dates-capability denial is a valid authenticated 403
 * and must stay a 403 so the UI can report authorization accurately.
 */
export function invalidatesAdminSession(status: number, rawError: unknown): boolean {
  const error = String(rawError ?? "");
  return status === 401
    || (status === 403 && (error === "admin-revoked" || error === "admin-session-invalid"));
}

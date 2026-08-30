/**
 * Provider-contract activation switches.
 *
 * A consumer may be reviewed and shipped before its matching Core provider,
 * but no route, navigation item, or proxy action becomes reachable until the
 * matching release is verified. Keep these server/client-safe booleans free of
 * environment fallbacks: activation is an explicit reviewed source change.
 *
 * These are cutover tools, never product settings (D-060). A switch lives only
 * while its provider is unreleased: the release after a completed cutover
 * deletes the switch together with the branches it guarded, so the only on/off
 * an operator ever sees is the feature's own setting in the admin UI. Every
 * switch below therefore names a provider that is still dormant.
 */

/**
 * T-125/T-219 is not released. Even after this flips, Core's separate
 * `admin_me.admin_granted_verification` block must be exact and ready before
 * the selector or either mutation can cross the proxy.
 */
export const ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: boolean = false;

/**
 * Core T-121 is released dormant. The complete v1 consumer remains unreachable
 * until migration, independent consumer review, and separate cutover approval.
 */
export const AUDIENCE_VISIBILITY_CONTRACT_READY: boolean = false;

/** T-120 is not published; the dormant T-216 consumer remains unreachable. */
export const PROFILE_TEXT_MODERATION_CONTRACT_READY: boolean = false;

/**
 * T-126 is not released; the dormant T-218b consumer remains unreachable.
 * This is the CONSUMER cutover, not either product state. Both Core values
 * default to enabled (A1); launch posture is a later explicit administrator
 * flip (Hey on, Footprints off), never an inverted code default.
 */
export const FEATURE_SWITCHES_CONTRACT_READY: boolean = false;

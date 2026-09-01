/**
 * Reviewed source switches for provider cutovers and temporary surface gates.
 *
 * A consumer may be reviewed and shipped before its matching Core provider,
 * but no route, navigation item, or proxy action becomes reachable until the
 * matching release is verified. Keep these server/client-safe booleans free of
 * environment fallbacks: activation is an explicit reviewed source change.
 *
 * These are release tools, never product settings (D-060). Provider-readiness
 * switches live only through their reviewed cutover and rollback release.
 * Temporary visibility switches may instead preserve a dormant implementation
 * when the owner explicitly requires a single reversible source gate.
 *
 * After a provider cutover's rollback release has shipped, delete its source
 * switch and guarded branches rather than retaining a permanent `true` value.
 */

/**
 * T-125 and T-219 are deployed dormant. Core's own
 * `ADMIN_GRANTED_CONTRACT_READY` remains false, and no consumer cutover is
 * released. Even after this flips, Core's `admin_me.admin_granted_verification`
 * block must be exact and ready before either mutation can cross the proxy.
 */
export const ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: boolean = false;

/** T-120/T-216 are deployed dormant; their activation has not been released. */
export const PROFILE_TEXT_MODERATION_CONTRACT_READY: boolean = false;

/**
 * T-126/T-218b are deployed dormant; their consumer cutover has not been
 * released.
 * This is the CONSUMER cutover, not either product state. Both Core values
 * default to enabled (A1); launch posture is a later explicit administrator
 * flip (Hey on, Footprints off), never an inverted code default.
 */
export const FEATURE_SWITCHES_CONTRACT_READY: boolean = false;

/**
 * T-581 reversible visibility gate. The current app does not read the legacy
 * PersonaStartConfig surface, so `false` hides its editor and device preview
 * without deleting their implementation, contract, or recovery path. Change
 * this one constant to `true` to restore both panels and their Help sections.
 */
export const PERSONA_START_EDITOR_VISIBLE: boolean = false;

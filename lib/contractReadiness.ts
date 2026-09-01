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
 * A provider-readiness switch set to `true` is therefore on its way out, kept
 * for exactly one release as the documented consumer rollback lever, and
 * deleted with its branches in the next one.
 */

/**
 * T-125/T-219 is not released. Even after this flips, Core's separate
 * `admin_me.admin_granted_verification` block must be exact and ready before
 * the selector or either mutation can cross the proxy.
 */
export const ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: boolean = false;

/**
 * RELEASED 2026-09-01 (T-539). Core's provider is live: T-529 retired the Core
 * activation switch so readiness is derived from the verified migration marker
 * plus the stored schema, and `/v1/app/ios_appconfig` publishes
 * `audience_visibility.contract_ready: true` at Core `50ff00b`.
 *
 * Core stays authoritative. This constant only stops the console from asking;
 * it can never make Core answer something Core would refuse. Every surface it
 * opens re-checks `admin_me.audience_visibility` — the page and nav item
 * through `audienceVisibilityConsoleReady`, the member panel and the proxy
 * through `audienceVisibilityAdminMe` — so a Core that goes unready closes them
 * again without a console release.
 *
 * Retained for one release as the rollback lever named in
 * `reports/cutover-visibility-v2-commands.md` §8: reverting this to `false` and
 * redeploying is how the console is made unreachable. Delete it and the
 * branches it guards in the release after that, per D-060.
 */
export const AUDIENCE_VISIBILITY_CONTRACT_READY: boolean = true;

/** T-120 is not published; the dormant T-216 consumer remains unreachable. */
export const PROFILE_TEXT_MODERATION_CONTRACT_READY: boolean = false;

/**
 * T-126 is not released; the dormant T-218b consumer remains unreachable.
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

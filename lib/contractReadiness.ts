/**
 * Provider-contract activation switches.
 *
 * A consumer may be reviewed and shipped before its matching Core provider,
 * but no route, navigation item, or proxy action becomes reachable until the
 * matching release is verified. Keep these server/client-safe booleans free of
 * environment fallbacks: activation is an explicit reviewed source change.
 */
export const REPORTED_CONTENT_CONTRACT_READY: boolean = true;
export const PRODUCT_POPUP_CONTRACT_READY: boolean = true;
/**
 * Local half of the Persona cutover. Even after this reviewed release switch
 * changes, every control still requires Core's `admin_me.persona.contract_ready`
 * and exact action capability at runtime.
 */
export const PERSONA_ADMIN_PROXY_RELEASED: boolean = true;
/** Core T-108c is released; all three CRUD actions remain capability/revision gated. */
export const CANNED_TEMPLATES_CONTRACT_READY: boolean = true;
/** Core T-108d is released; the versioned outbound bridge is available behind Core capabilities. */
export const OUTBOUND_MESSAGING_CONTRACT_READY: boolean = true;
/** T-107 is released; push settings and per-member channel projections are required. */
export const PUSH_MODE_CONTRACT_READY: boolean = true;
/** Core T-109 S2 is released; all 17 actions remain gated by Core's current projection. */
export const VERIFICATION_CONTRACT_READY: boolean = true;
/**
 * Core T-121 is released dormant. The complete v1 consumer remains unreachable
 * until migration, independent consumer review, and separate cutover approval.
 */
export const AUDIENCE_VISIBILITY_CONTRACT_READY: boolean = false;
/** T-120 is not published; the dormant T-216 consumer remains unreachable. */
export const PROFILE_TEXT_MODERATION_CONTRACT_READY: boolean = false;

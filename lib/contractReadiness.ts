/**
 * Provider-contract activation switches.
 *
 * A consumer may be reviewed and shipped before its matching Core provider,
 * but no route, navigation item, or proxy action becomes reachable until the
 * matching release is verified. Keep these server/client-safe booleans free of
 * environment fallbacks: activation is an explicit reviewed source change.
 */
export const REPORTED_CONTENT_CONTRACT_READY: boolean = false;
export const PRODUCT_POPUP_CONTRACT_READY: boolean = false;
/**
 * Local half of the Persona cutover. Even after this reviewed release switch
 * changes, every control still requires Core's `admin_me.persona.contract_ready`
 * and exact action capability at runtime.
 */
export const PERSONA_ADMIN_PROXY_RELEASED: boolean = false;

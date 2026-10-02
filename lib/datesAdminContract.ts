/**
 * D-143: the Admin intake contract selector.
 *
 * Core serves the P2 additions on the P1 Dates Admin routes (`ai_assisted` on
 * an external list row, `intake` on an event's detail and on the event of an
 * activity detail, the settings of the intake channels in the configuration
 * read) ONLY to a request that carries this selector. A request without it is
 * answered with bodies byte-identical to the released P1 Admin corpus, so the
 * released console keeps reading them while the two are deployed one after
 * the other.
 *
 * The parameter's name and its value are Core's to announce. Until the Core
 * lane does, this is `null` and nothing is sent: the console's decoders accept
 * both shapes (every addition is optional with a defined default), so it
 * reads a Core that serves the additions unconditionally, one that serves
 * them on the selector, and the live Core that does not know them.
 *
 * This is the ONE place to change when the name is announced:
 *
 *   export const DATES_ADMIN_INTAKE_CONTRACT_SELECTOR = { parameter: "<name>", value: <version> } as const;
 */
export const DATES_ADMIN_INTAKE_CONTRACT_SELECTOR: { readonly parameter: string; readonly value: number | string } | null = null;

/**
 * What the SERVER adds to a request to Core, by action: the selector on every
 * Dates Admin route (`dates_*`), nothing on any other. It is merged after the
 * browser's body, so the browser can neither set nor remove it.
 */
export function datesAdminContractParams(action: string): Record<string, number | string> {
  const selector = DATES_ADMIN_INTAKE_CONTRACT_SELECTOR;
  return selector !== null && /^dates_[a-z0-9_]+$/.test(action) ? { [selector.parameter]: selector.value } : {};
}

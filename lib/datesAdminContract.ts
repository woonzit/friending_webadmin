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
 * The parameter's name and its value are Core's (announced by the Core lane,
 * `team/chat/20261002T181620Z-opus-core-p2-to-opus-admin-p2-p2b-queue-second-look-mark.md`):
 * `dates_event_intake_admin_contract_version=1`, "exactly 1 is the selector;
 * anything else is without". The console's decoders accept both shapes
 * (every addition is optional with a defined default), so it reads a Core that
 * answers the selector and the live Core that does not know the parameter
 * (Core main reads named parameters only and ignores it).
 *
 * This is the ONE place that names it. `null` would send nothing.
 */
export type DatesAdminContractSelector = { readonly parameter: string; readonly value: number | string };
export const DATES_ADMIN_INTAKE_CONTRACT_SELECTOR: DatesAdminContractSelector | null = { parameter: "dates_event_intake_admin_contract_version", value: 1 };

/**
 * What the SERVER adds to a request to Core, by action: the selector on every
 * Dates Admin route (`dates_*`), nothing on any other. It is merged after the
 * browser's body, so the browser can neither set nor remove it. `selector` is
 * the constant above; it is a parameter only so that the rule can be tested
 * before the name is announced.
 */
export function datesAdminContractParams(action: string, selector: DatesAdminContractSelector | null = DATES_ADMIN_INTAKE_CONTRACT_SELECTOR):
  Record<string, number | string> {
  return selector !== null && /^dates_[a-z0-9_]+$/.test(action) ? { [selector.parameter]: selector.value } : {};
}

/**
 * T-891: the command contract selector. With it Core's receipt of a live-trail
 * capture adds `revision` (the case revision after it) and `existing` (the
 * window was already captured: the same snapshot, nothing stored), and the
 * receipt of a host-transfer request adds `activity_revision`. Without it Core
 * answers with the released keys, so the released console keeps reading them.
 * Present and not exactly 1 is refused by Core (`dates-admin-contract-version-
 * invalid`, nothing written). Named by the Core lane opus-core-fix
 * (team/chat/20261002T233953Z-opus-core-fix-to-opus-admin-p2-t891-core-pin.md).
 * Of the commands it goes with these two only; the selector never changes what
 * a command does. The legal hold has no selector: its extension is asked for by
 * the request's own `expected_revision`, which the page sends.
 */
export const DATES_ADMIN_COMMAND_CONTRACT_SELECTOR: DatesAdminContractSelector = { parameter: "dates_admin_command_contract_version", value: 1 };
export const DATES_ADMIN_COMMAND_CONTRACT_ROUTES: readonly string[] = ["dates_moderation_trail_evidence", "dates_activity_host_transfer"];

/**
 * Host moderation v1 (Core docs/EVENT_HOST_MODERATION_V1.md, "Console"): the
 * same selector asks four READS for what an event's host did. With it Core
 * appends
 * - to every membership row of `dates_activity_detail`: `removed_at`,
 *   `removed_by_uid`, `removed_reason`, `removal_note` and `ban`;
 * - to every item of `dates_event_content`: `removed_by` and `host_removed`;
 * - to every case of `dates_moderation_queue` and to the case of
 *   `dates_moderation_detail`: `surface`, `host_visible` and `host_review`
 *   (and `host_reviews`, the hosts of a case about a member, one per event).
 * Without it those reads keep their released bodies. The selector changes the
 * shape of an answer only, never what is read or who may read it.
 *
 * A Core that does not know host moderation (main 47702611 and before) reads
 * named parameters only on these four routes and never looks at the selector:
 * it answers exactly as it does without it. So every addition is optional in
 * this console's decoders - absent means "not served", and what would show it
 * is not rendered - and the console reads a Core of either kind.
 */
export const DATES_ADMIN_HOST_MODERATION_READS: readonly string[] = ["dates_activity_detail", "dates_event_content", "dates_moderation_queue", "dates_moderation_detail"];

/** What the SERVER adds for the command contract: the selector on its two commands and on the four host moderation reads, nothing on any other route. */
export function datesAdminCommandContractParams(action: string): Record<string, number | string> {
  return DATES_ADMIN_COMMAND_CONTRACT_ROUTES.includes(action) || DATES_ADMIN_HOST_MODERATION_READS.includes(action)
    ? { [DATES_ADMIN_COMMAND_CONTRACT_SELECTOR.parameter]: DATES_ADMIN_COMMAND_CONTRACT_SELECTOR.value } : {};
}

/** T-896 / D-143: added by the server to research actions and the selected intake queue. */
export const DATES_ADMIN_RESEARCH_CONTRACT_SELECTOR: DatesAdminContractSelector = { parameter: "dates_event_research_admin_contract_version", value: 1 };
export function datesAdminResearchContractParams(action: string, params: Record<string, unknown> = {}): Record<string, number | string> {
  const research = /^dates_event_research_[a-z0-9_]+$/.test(action) || action === "dates_event_intake_batch_decide"
    || action === "dates_event_intake_list" && (Object.hasOwn(params, "research_run_id") || params.channel === "ai_research");
  return research ? { [DATES_ADMIN_RESEARCH_CONTRACT_SELECTOR.parameter]: DATES_ADMIN_RESEARCH_CONTRACT_SELECTOR.value } : {};
}

/**
 * The parameters the generic bridge hands to Core, with the selectors written
 * LAST into the same object: whatever the browser's body carried under those
 * names is overwritten, and the object keeps the null prototype
 * `mergeCoreParams` gave it.
 */
export function withDatesAdminContract(action: string, params: Record<string, unknown>,
  selector: DatesAdminContractSelector | null = DATES_ADMIN_INTAKE_CONTRACT_SELECTOR): Record<string, unknown> {
  for (const [key, value] of Object.entries({ ...datesAdminContractParams(action, selector), ...datesAdminCommandContractParams(action), ...datesAdminResearchContractParams(action, params) })) params[key] = value;
  if (action === "dates_event_icons" || action === "dates_event_icons_save") params.dates_event_icon_contract_version = 2;
  if (["dates_activity_detail", "dates_moderation_evidence", "dates_moderation_resolve"].includes(action)) params.dates_event_media_contract_version = 1;
  return params;
}

/**
 * D-149: why the SYSTEM closed a research intake (Core-B c268ae4b, docs/DATES_EXTERNAL_ADMIN_V1.md "The review
 * contract selector"). Served with the external admin contract selector v2, appended to every intake list row, to the
 * intake detail and to every research run candidate:
 * - `{decision: "research_not_publishable", blocker}`: automatic publication's gate refused it;
 * - `{decision: "duplicate", blocker: "duplicate"}`: the same event was found again;
 * - null: a person decided, or research publication did not close it (a candidate without an intake: null).
 * Released bodies keep serving such an intake as `rejected` / `duplicate`.
 */
export const DATES_SYSTEM_CLOSURE_DECISIONS = ["research_not_publishable", "duplicate"] as const;
export type DatesSystemClosureDecision = typeof DATES_SYSTEM_CLOSURE_DECISIONS[number];
/**
 * The gate's blocker codes (`DatesResearchPublicationPolicy::AUTOMATIC_BLOCKERS`), which the console words. A blocker
 * may also be the machine code of the publication writer that refused an event the gate let through (at most 96
 * characters, for example `dates-external-paid-official-link-required`); such a code is shown as Core wrote it.
 */
export const DATES_RESEARCH_GATE_BLOCKERS = ["not-a-single-event", "hard-fail", "title-unverified", "date-unverified", "time-unverified",
  "venue-unverified", "sensitive", "prompt-injection", "canceled-or-postponed", "possibly-private", "blocked-domain", "aggregator-reclassified",
  "start-passed", "outside-window", "outside-area", "duplicate"] as const;
export type DatesSystemClosure = { decision: DatesSystemClosureDecision; blocker: string };

/** A served closure, or null when it is not one: the field is then shown as unreadable, never as "no closure". */
export function decodeDatesSystemClosure(value: unknown): DatesSystemClosure | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!(DATES_SYSTEM_CLOSURE_DECISIONS as readonly unknown[]).includes(row.decision) || typeof row.blocker !== "string"
    || !/^[a-z][a-z0-9_-]{0,95}$/.test(row.blocker) || (row.decision === "duplicate" && row.blocker !== "duplicate")) return null;
  return { decision: row.decision as DatesSystemClosureDecision, blocker: row.blocker };
}

export function datesSystemClosureBlockerWorded(blocker: string): boolean {
  return (DATES_RESEARCH_GATE_BLOCKERS as readonly string[]).includes(blocker);
}

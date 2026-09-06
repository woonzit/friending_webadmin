/** Rolling UTC ranges use the existing inclusive list_users timestamp fields. */
export const REGISTRATION_PERIODS = ["all", "24h", "48h", "72h", "7d"] as const;
export type RegistrationPeriod = typeof REGISTRATION_PERIODS[number];

export function isRegistrationPeriod(value: string): value is RegistrationPeriod {
  return (REGISTRATION_PERIODS as readonly string[]).includes(value);
}

export function registrationRange(period: RegistrationPeriod, asOf: number): Record<string, number> {
  if (period === "all") return {};
  if (!Number.isSafeInteger(asOf) || asOf < 604800) throw new Error("Invalid signup range instant");
  const seconds = { "24h": 86400, "48h": 172800, "72h": 259200, "7d": 604800 }[period];
  if (seconds === undefined) throw new Error("Invalid signup range period");
  return { registered_after: asOf - seconds, registered_before: asOf };
}

export type SignupCohort = { total: number; persona_verified: number };
export type SignupMetrics = {
  schema_version: 1;
  as_of: number;
  last_24h: SignupCohort;
  last_7d: SignupCohort;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cohort(value: unknown): SignupCohort | null {
  const row = object(value);
  if (!row || !keys(row, ["total", "persona_verified"])
    || !count(row.total) || !count(row.persona_verified) || row.persona_verified > row.total) return null;
  return { total: row.total, persona_verified: row.persona_verified };
}

/** Missing old-Core or malformed metrics are unavailable, never zero signups. */
export function parseSignupMetrics(value: unknown): SignupMetrics | null {
  const row = object(value);
  if (!row || !keys(row, ["schema_version", "as_of", "last_24h", "last_7d"])
    || row.schema_version !== 1 || !count(row.as_of) || row.as_of < 604800) return null;
  const day = cohort(row.last_24h);
  const week = cohort(row.last_7d);
  if (!day || !week || day.total > week.total || day.persona_verified > week.persona_verified) return null;
  return { schema_version: 1, as_of: row.as_of, last_24h: day, last_7d: week };
}

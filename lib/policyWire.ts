/**
 * The wire rules shared by the console's revisioned singleton policies - the
 * location access policy (lib/locationAccessPolicy.ts) and the Friending Start
 * methods (lib/friendingStartPolicy.ts). Core serves each as `{configuration,
 * can_write}` with a compare-and-set revision and the saver's e-mail, and
 * states the key sets as the contract.
 *
 * Pure: no `server-only` import, so the proxy normalizes with the same rules
 * the browser decodes with and the tests exercise them under plain Node.
 */
export type PolicyJsonObject = Record<string, unknown>;

const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export function policyRecord(value: unknown): PolicyJsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as PolicyJsonObject
    : null;
}

/** Exact key sets: Core states them as the contract, so an extra key is a provider change. */
export function policyExactObject(value: unknown, keys: readonly string[]): PolicyJsonObject | null {
  const source = policyRecord(value);
  if (!source) return null;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? source
    : null;
}

export function policyInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum
    ? value
    : null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** The saver's e-mail as Core stores it: trimmed, control-free, at most `maxBytes` UTF-8 bytes. */
export function policyActor(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" || value !== value.trim()
    || hasUnpairedSurrogate(value) || PLAIN_TEXT_CONTROL.test(value)) return null;
  return new TextEncoder().encode(value).length <= maxBytes ? value : null;
}

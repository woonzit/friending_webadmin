/** Optional profile-disclosure values that are never matching-axis values. */
export const DISCLOSURE_ONLY_ORIENTATION_KEYS = [
  "asexual",
  "demisexual",
  "pansexual",
  "queer",
  "straight",
] as const;

const disclosureOnlyOrientationKeys = new Set<string>(
  DISCLOSURE_ONLY_ORIENTATION_KEYS,
);

export function isDisclosureOnlyOrientation(value: unknown): boolean {
  return typeof value === "string"
    && disclosureOnlyOrientationKeys.has(value.trim().toLowerCase());
}

export const containsDisclosureOnlyOrientation = (values: readonly string[]): boolean =>
  values.some(isDisclosureOnlyOrientation);

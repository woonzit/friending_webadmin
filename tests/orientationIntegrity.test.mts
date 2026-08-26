import assert from "node:assert/strict";
import test from "node:test";
import {
  containsDisclosureOnlyOrientation,
  DISCLOSURE_ONLY_ORIENTATION_KEYS,
  isDisclosureOnlyOrientation,
} from "../lib/orientationIntegrity.ts";

test("matching guard pins the disclosure-only vocabulary", () => {
  assert.deepEqual(DISCLOSURE_ONLY_ORIENTATION_KEYS, [
    "asexual",
    "demisexual",
    "pansexual",
    "queer",
    "straight",
  ]);
  for (const key of DISCLOSURE_ONLY_ORIENTATION_KEYS) {
    assert.equal(isDisclosureOnlyOrientation(key), true);
    assert.equal(isDisclosureOnlyOrientation(key.toUpperCase()), true);
  }
  for (const key of ["hetero", "gay", "lesbian", "bisexual", "other", "custom_match"]) {
    assert.equal(isDisclosureOnlyOrientation(key), false);
  }
  assert.equal(containsDisclosureOnlyOrientation(["hetero", "straight"]), true);
  assert.equal(containsDisclosureOnlyOrientation(["hetero", "custom_match"]), false);
  assert.equal(isDisclosureOnlyOrientation(null), false);
});

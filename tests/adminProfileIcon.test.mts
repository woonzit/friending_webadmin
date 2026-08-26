import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminProfileIconError,
  detectAdminProfileIconMime,
  validateAdminProfileIcon,
} from "../lib/adminProfileIcon.ts";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');

test("the icon type comes from the bytes, not from the declared MIME", () => {
  assert.equal(detectAdminProfileIconMime(PNG), "image/png");
  assert.equal(detectAdminProfileIconMime(SVG), "image/svg+xml");
  assert.equal(detectAdminProfileIconMime(Buffer.from("GIF89a nope")), null);
});

test("a file whose content disagrees with the declared MIME never reaches Core", () => {
  assert.throws(
    () => validateAdminProfileIcon(SVG, "image/png"),
    (error: unknown) => error instanceof AdminProfileIconError && error.status === 422,
  );
  assert.throws(
    () => validateAdminProfileIcon(PNG, "image/svg+xml"),
    (error: unknown) => error instanceof AdminProfileIconError && error.status === 422,
  );
  assert.equal(validateAdminProfileIcon(PNG, "image/png").mime, "image/png");
  assert.equal(validateAdminProfileIcon(SVG, "image/svg+xml").mime, "image/svg+xml");
});

test("empty and oversized icons are refused before any Core round trip", () => {
  assert.throws(
    () => validateAdminProfileIcon(Buffer.alloc(0), "image/png"),
    (error: unknown) => error instanceof AdminProfileIconError && error.status === 400,
  );
  const oversized = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  assert.throws(
    () => validateAdminProfileIcon(oversized, "image/png"),
    (error: unknown) => error instanceof AdminProfileIconError && error.status === 413,
  );
});

test("a hostile SVG is still forwarded for Core sanitization, not silently accepted here", () => {
  // The console only decides the type; Core owns element/attribute allow-listing.
  const hostile = Buffer.from('<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(validateAdminProfileIcon(hostile, "image/svg+xml").mime, "image/svg+xml");
});

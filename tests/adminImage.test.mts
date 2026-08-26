import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  AdminImageError,
  normalizeAdminImage,
} from "../lib/adminImage.ts";
import { MAX_ADMIN_IMAGE_OUTPUT_BYTES } from "../lib/adminImageConfig.ts";
import { createAdminImageUploadPayload } from "../lib/adminImageUploadPayload.ts";

test("Core image uploads carry the authenticated admin identity", () => {
  assert.deepEqual(
    createAdminImageUploadPayload(
      "admin@example.test",
      Buffer.from([0, 1, 255]),
    ),
    {
      admin_email: "admin@example.test",
      image_b64: "AAH/",
    },
  );
});

test("admin images are normalized to a bounded public format", async () => {
  const input = await sharp({
    create: {
      width: 800,
      height: 500,
      channels: 3,
      background: { r: 12, g: 90, b: 150 },
    },
  }).png().toBuffer();

  const result = await normalizeAdminImage(input);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(result.width, 800);
  assert.equal(result.height, 500);
  assert.ok(result.buffer.length <= MAX_ADMIN_IMAGE_OUTPUT_BYTES);
});

test("invalid and undersized images fail before reaching Core", async () => {
  await assert.rejects(
    () => normalizeAdminImage(Buffer.from("not an image")),
    (error: unknown) => error instanceof AdminImageError && error.code === "image-invalid",
  );

  const undersized = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).jpeg().toBuffer();
  await assert.rejects(
    () => normalizeAdminImage(undersized),
    (error: unknown) => error instanceof AdminImageError && error.code === "image-dimensions-invalid",
  );
});

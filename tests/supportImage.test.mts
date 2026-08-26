import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  MAX_SUPPORT_IMAGE_EDGE,
  MAX_SUPPORT_IMAGE_INPUT_BYTES,
  MAX_SUPPORT_IMAGE_OUTPUT_BYTES,
  normalizeSupportImage,
  SupportImageError,
} from "../lib/supportImage.ts";

test("support images are orientation-baked, metadata-free bounded JPEGs", async () => {
  const input = await sharp({
    create: {
      width: 2400,
      height: 1200,
      channels: 4,
      background: { r: 30, g: 70, b: 120, alpha: 0.5 },
    },
  }).png().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeSupportImage(input);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.mime, "image/jpeg");
  assert.ok(result.width <= MAX_SUPPORT_IMAGE_EDGE);
  assert.ok(result.height <= MAX_SUPPORT_IMAGE_EDGE);
  assert.ok(result.buffer.length <= MAX_SUPPORT_IMAGE_OUTPUT_BYTES);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.hasAlpha, false);
});

test("support image input bounds and formats fail before Core", async () => {
  await assert.rejects(
    () => normalizeSupportImage(Buffer.alloc(MAX_SUPPORT_IMAGE_INPUT_BYTES + 1)),
    (error: unknown) => error instanceof SupportImageError
      && error.code === "support-image-too-large",
  );
  await assert.rejects(
    () => normalizeSupportImage(Buffer.from("not an image")),
    (error: unknown) => error instanceof SupportImageError
      && error.code === "support-image-invalid",
  );
});

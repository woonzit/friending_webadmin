import sharp, { type Metadata } from "sharp";

export const MAX_SUPPORT_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_SUPPORT_IMAGE_OUTPUT_BYTES = 3_000_000;
export const MAX_SUPPORT_IMAGE_EDGE = 1600;
const MAX_SOURCE_EDGE = 6000;
const MAX_INPUT_PIXELS = 32_000_000;
const MIN_DIMENSION = 32;

export type NormalizedSupportImage = {
  buffer: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
};

export type SupportImageErrorCode =
  | "support-image-invalid"
  | "support-image-format-invalid"
  | "support-image-dimensions-invalid"
  | "support-image-too-large";

export class SupportImageError extends Error {
  constructor(
    public readonly code: SupportImageErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "SupportImageError";
  }
}

function source(buffer: Buffer) {
  return sharp(buffer, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  });
}

export async function normalizeSupportImage(input: Buffer): Promise<NormalizedSupportImage> {
  if (input.length === 0) {
    throw new SupportImageError("support-image-invalid", 422);
  }
  if (input.length > MAX_SUPPORT_IMAGE_INPUT_BYTES) {
    throw new SupportImageError("support-image-too-large", 413);
  }

  let metadata: Metadata;
  try {
    metadata = await source(input).metadata();
  } catch {
    throw new SupportImageError("support-image-invalid", 422);
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new SupportImageError("support-image-format-invalid", 422);
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (
    sourceWidth < MIN_DIMENSION
    || sourceHeight < MIN_DIMENSION
    || sourceWidth > MAX_SOURCE_EDGE
    || sourceHeight > MAX_SOURCE_EDGE
    || sourceWidth * sourceHeight > MAX_INPUT_PIXELS
  ) {
    throw new SupportImageError("support-image-dimensions-invalid", 422);
  }

  for (const quality of [85, 78, 70]) {
    let output: Buffer;
    try {
      output = await source(input)
        .rotate()
        .resize({
          width: MAX_SUPPORT_IMAGE_EDGE,
          height: MAX_SUPPORT_IMAGE_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .jpeg({ quality, progressive: true, chromaSubsampling: "4:2:0" })
        .toBuffer();
    } catch {
      throw new SupportImageError("support-image-invalid", 422);
    }
    if (output.length <= MAX_SUPPORT_IMAGE_OUTPUT_BYTES) {
      const described = await sharp(output).metadata();
      const width = described.width ?? 0;
      const height = described.height ?? 0;
      if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
        throw new SupportImageError("support-image-dimensions-invalid", 422);
      }
      return { buffer: output, mime: "image/jpeg", width, height };
    }
  }
  throw new SupportImageError("support-image-too-large", 413);
}

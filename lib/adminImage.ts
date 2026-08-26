import sharp, { type Metadata } from "sharp";
import {
  MAX_ADMIN_IMAGE_INPUT_BYTES,
  MAX_ADMIN_IMAGE_OUTPUT_BYTES,
} from "@/lib/adminImageConfig";

const MAX_INPUT_PIXELS = 32_000_000;
const MIN_DIMENSION = 64;

export type NormalizedAdminImage = {
  buffer: Buffer;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

export type AdminImageErrorCode =
  | "image-invalid"
  | "image-format-invalid"
  | "image-dimensions-invalid"
  | "image-too-large";

export class AdminImageError extends Error {
  constructor(
    public readonly code: AdminImageErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AdminImageError";
  }
}

type OutputCandidate = {
  maxDimension: number;
  quality?: number;
};

const JPEG_CANDIDATES: OutputCandidate[] = [
  { maxDimension: 4096, quality: 88 },
  { maxDimension: 3200, quality: 84 },
  { maxDimension: 2560, quality: 82 },
  { maxDimension: 2048, quality: 78 },
  { maxDimension: 1600, quality: 76 },
  { maxDimension: 1280, quality: 74 },
];

const PNG_CANDIDATES: OutputCandidate[] = [
  { maxDimension: 4096 },
  { maxDimension: 3072 },
  { maxDimension: 2048 },
  { maxDimension: 1536 },
  { maxDimension: 1024 },
  { maxDimension: 768 },
];

function source(buffer: Buffer) {
  return sharp(buffer, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  });
}

async function describeOutput(
  buffer: Buffer,
  mime: NormalizedAdminImage["mime"],
): Promise<NormalizedAdminImage> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new AdminImageError("image-dimensions-invalid", 422);
  }
  return { buffer, mime, width, height };
}

export async function normalizeAdminImage(input: Buffer): Promise<NormalizedAdminImage> {
  if (input.length === 0) {
    throw new AdminImageError("image-invalid", 422);
  }
  if (input.length > MAX_ADMIN_IMAGE_INPUT_BYTES) {
    throw new AdminImageError("image-too-large", 413);
  }

  let metadata: Metadata;
  try {
    metadata = await source(input).metadata();
  } catch {
    throw new AdminImageError("image-invalid", 422);
  }

  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new AdminImageError("image-format-invalid", 422);
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width < MIN_DIMENSION
    || height < MIN_DIMENSION
    || width * height > MAX_INPUT_PIXELS
  ) {
    throw new AdminImageError("image-dimensions-invalid", 422);
  }

  const keepsTransparency = metadata.hasAlpha === true;
  const candidates = keepsTransparency ? PNG_CANDIDATES : JPEG_CANDIDATES;
  for (const candidate of candidates) {
    try {
      const pipeline = source(input)
        .rotate()
        .resize({
          width: candidate.maxDimension,
          height: candidate.maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toColourspace("srgb");
      const output = keepsTransparency
        ? await pipeline.png({
          compressionLevel: 9,
          adaptiveFiltering: true,
        }).toBuffer()
        : await pipeline.jpeg({
          quality: candidate.quality,
          progressive: true,
          chromaSubsampling: "4:2:0",
        }).toBuffer();
      if (output.length <= MAX_ADMIN_IMAGE_OUTPUT_BYTES) {
        return describeOutput(output, keepsTransparency ? "image/png" : "image/jpeg");
      }
    } catch (error) {
      if (error instanceof AdminImageError) throw error;
      throw new AdminImageError("image-invalid", 422);
    }
  }

  throw new AdminImageError("image-too-large", 413);
}

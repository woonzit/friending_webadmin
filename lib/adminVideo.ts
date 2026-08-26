import { MAX_ADMIN_VIDEO_INPUT_BYTES } from "@/lib/adminVideoConfig";

export class AdminVideoError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export type ValidatedAdminVideo = {
  buffer: Buffer;
  mime: "video/mp4" | "video/webm";
  sizeBytes: number;
};

function isValidMp4(input: Buffer): boolean {
  let offset = 0;
  let boxIndex = 0;
  let hasMovie = false;
  let hasMedia = false;
  while (offset + 8 <= input.length) {
    let boxSize = input.readUInt32BE(offset);
    const boxType = input.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (boxSize === 1) {
      if (offset + 16 > input.length || input.readUInt32BE(offset + 8) !== 0) {
        return false;
      }
      boxSize = input.readUInt32BE(offset + 12);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = input.length - offset;
    }

    if (boxSize < headerSize || boxSize > input.length - offset) {
      return false;
    }
    if (boxIndex === 0 && (boxType !== "ftyp" || boxSize < 16)) {
      return false;
    }
    if (boxType === "moov") hasMovie = true;
    if (boxType === "mdat" || boxType === "moof") hasMedia = true;

    offset += boxSize;
    boxIndex += 1;
  }

  return offset === input.length && hasMovie && hasMedia;
}

function isValidWebm(input: Buffer): boolean {
  if (
    input.length < 16
    || input[0] !== 0x1a
    || input[1] !== 0x45
    || input[2] !== 0xdf
    || input[3] !== 0xa3
  ) {
    return false;
  }
  const header = input.subarray(0, Math.min(input.length, 4096));
  return header.indexOf(Buffer.from("webm", "ascii")) >= 0;
}

export function validateAdminVideo(input: Buffer): ValidatedAdminVideo {
  if (input.length === 0) throw new AdminVideoError("video-missing", 400);
  if (input.length > MAX_ADMIN_VIDEO_INPUT_BYTES) {
    throw new AdminVideoError("video-too-large", 413);
  }

  if (isValidMp4(input)) {
    return { buffer: input, mime: "video/mp4", sizeBytes: input.length };
  }
  if (isValidWebm(input)) {
    return { buffer: input, mime: "video/webm", sizeBytes: input.length };
  }

  throw new AdminVideoError("video-format-invalid", 422);
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminVideoError,
  validateAdminVideo,
} from "../lib/adminVideo.ts";
import { createAdminVideoUploadPayload } from "../lib/adminVideoUploadPayload.ts";

function box(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function minimalMp4(): Buffer {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000isom", "ascii")),
    box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

function minimalWebm(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x84]),
    Buffer.from("webm", "ascii"),
    Buffer.from([0x18, 0x53, 0x80, 0x67]),
  ]);
}

test("Core video uploads carry the authenticated admin identity", () => {
  assert.deepEqual(
    createAdminVideoUploadPayload("admin@example.test", Buffer.from([0, 1, 255])),
    { admin_email: "admin@example.test", video_b64: "AAH/" },
  );
});

test("admin video validation accepts an MP4 container with movie and media boxes", () => {
  const input = minimalMp4();
  const result = validateAdminVideo(input);
  assert.equal(result.mime, "video/mp4");
  assert.equal(result.sizeBytes, input.length);
  assert.equal(result.buffer, input);
});

test("admin video validation accepts a WebM EBML header", () => {
  const input = minimalWebm();
  const result = validateAdminVideo(input);
  assert.equal(result.mime, "video/webm");
  assert.equal(result.sizeBytes, input.length);
});

test("admin video validation rejects arbitrary and incomplete files", () => {
  assert.throws(
    () => validateAdminVideo(Buffer.from("not a video")),
    (error: unknown) => error instanceof AdminVideoError && error.code === "video-format-invalid",
  );
  assert.throws(
    () => validateAdminVideo(Buffer.concat([
      box("ftyp", Buffer.from("isom0000isom", "ascii")),
      box("mdat", Buffer.from([1])),
    ])),
    (error: unknown) => error instanceof AdminVideoError && error.code === "video-format-invalid",
  );
});

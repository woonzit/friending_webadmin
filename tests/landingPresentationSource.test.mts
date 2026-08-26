import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("landing editor exposes responsive login contrast-card controls and preview", async () => {
  const source = await readFile(
    new URL("../app/(dashboard)/landing/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /desktop_auth_card_color:\s*"#080B10"/);
  assert.match(source, /desktop_auth_card_intensity:\s*72/);
  assert.match(source, /tablet_auth_card_override/);
  assert.match(source, /mobile_auth_card_override/);
  assert.match(source, /className="landing-preview-auth-card"/);
});

test("landing editor keeps a protected editable image-free fallback", async () => {
  const source = await readFile(
    new URL("../app/(dashboard)/landing/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /scope:\s*"fallback"/);
  assert.match(source, /id:\s*"builtin-no-image"/);
  assert.match(source, /is_fallback:\s*true/);
  assert.match(source, /row\.scope !== "fallback"/);
  assert.match(source, /imageFree=\{isFallback\}/);
});

test("landing editor supports uploaded responsive MP4 and WebM backgrounds", async () => {
  const source = await readFile(
    new URL("../app/(dashboard)/landing/page.tsx", import.meta.url),
    "utf8",
  );
  const uploader = await readFile(
    new URL("../components/VideoUploadField.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /background_mode:\s*LandingBackgroundMode/);
  assert.match(source, /desktop_video_url/);
  assert.match(source, /<VideoUploadField/);
  assert.match(source, /\.\(\?:mp4\|webm\)/);
  assert.match(uploader, /autoPlay/);
  assert.match(uploader, /muted/);
  assert.match(uploader, /loop/);
  assert.match(uploader, /controls=\{false\}/);
});

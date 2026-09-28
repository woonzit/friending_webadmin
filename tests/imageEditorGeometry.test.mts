import assert from "node:assert/strict";
import test from "node:test";
import {
  cropGeometry, INITIAL_CROP, panCrop, pinchCrop, squareCropInOriginalSpace,
} from "../lib/imageEditorGeometry.ts";

const image = { width: 1200, height: 800 };
const portrait = { width: 720, height: 900 };
const square = { width: 720, height: 720 };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("all quarter turns and zoom levels cover the export canvas without empty bars", () => {
  for (const rotation of [0, 90, 180, 270]) for (const zoom of [1, 1.15, 2, 3]) {
    for (const source of [image, { width: 800, height: 1200 }]) {
      const g = cropGeometry(source, portrait, { ...INITIAL_CROP, rotation, zoom, positionX: 1, positionY: -1 });
      const rotated = rotation % 180 === 90;
      assert.ok((rotated ? source.height : source.width) * g.scale >= portrait.width);
      assert.ok((rotated ? source.width : source.height) * g.scale >= portrait.height);
      near(g.offsetX, g.overflowX / 2);
      near(g.offsetY, -g.overflowY / 2);
    }
  }
});

test("one-finger dragging follows the finger by the exact CSS distance, at any zoom and rotation", () => {
  const viewport = { width: 240, height: 300 };
  for (const rotation of [0, 90, 180, 270]) for (const zoom of [1.5, 2, 3]) {
    const before = { ...INITIAL_CROP, rotation, zoom };
    const next = panCrop(image, portrait, viewport, before, { x: 12, y: -8 });
    const a = cropGeometry(image, portrait, before);
    const b = cropGeometry(image, portrait, next);
    near((b.offsetX - a.offsetX) * viewport.width / portrait.width, 12);
    near((b.offsetY - a.offsetY) * viewport.height / portrait.height, -8);
  }
});

test("dragging clamps at the image edge and ignores axes with no overflow", () => {
  assert.deepEqual(panCrop(image, portrait, portrait, INITIAL_CROP, { x: 10000, y: -10000 }), {
    ...INITIAL_CROP, positionX: 1, positionY: 0,
  });
  assert.deepEqual(panCrop(image, portrait, { width: 0, height: 0 }, INITIAL_CROP, { x: 10, y: 10 }), INITIAL_CROP);
});

test("two-finger zoom keeps the same source point under a moving off-centre midpoint", () => {
  const before = { ...INITIAL_CROP, zoom: 1.5, positionX: 0.1, positionY: -0.1 };
  const next = pinchCrop(image, portrait, before, [{ x: 240, y: 380 }, { x: 400, y: 380 }], [{ x: 220, y: 410 }, { x: 460, y: 410 }]);
  near(next.zoom, 2.25);
  const a = cropGeometry(image, portrait, before);
  const b = cropGeometry(image, portrait, next);
  near((320 - portrait.width / 2 - a.offsetX) / a.scale, (340 - portrait.width / 2 - b.offsetX) / b.scale);
  near((380 - portrait.height / 2 - a.offsetY) / a.scale, (410 - portrait.height / 2 - b.offsetY) / b.scale);
});

test("pinch is bounded and coincident fingers cannot corrupt the crop", () => {
  assert.equal(pinchCrop(image, square, INITIAL_CROP, [{ x: 300, y: 360 }, { x: 420, y: 360 }], [{ x: 0, y: 360 }, { x: 720, y: 360 }]).zoom, 3);
  assert.equal(pinchCrop(image, square, INITIAL_CROP, [{ x: 0, y: 360 }, { x: 720, y: 360 }], [{ x: 300, y: 360 }, { x: 420, y: 360 }]).zoom, 1);
  assert.deepEqual(pinchCrop(image, square, INITIAL_CROP, [{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 10 }]), INITIAL_CROP);
});

test("square export uses original pixels, not the resized preview bitmap", () => {
  const original = { width: 2400, height: 1600 };
  assert.deepEqual(squareCropInOriginalSpace(image, square, original, INITIAL_CROP), { x: 400, y: 0, size: 1600 });
  assert.deepEqual(squareCropInOriginalSpace(image, square, original, { ...INITIAL_CROP, zoom: 2, positionX: 1, positionY: -1 }), { x: 0, y: 800, size: 800 });
  assert.deepEqual(squareCropInOriginalSpace(image, square, original, { ...INITIAL_CROP, zoom: 2, positionX: -1, positionY: 1 }), { x: 1600, y: 0, size: 800 });
});

test("square export refuses rotation, non-square output and unknown or too small originals", () => {
  assert.equal(squareCropInOriginalSpace(image, square, image, { ...INITIAL_CROP, rotation: 90 }), null);
  assert.equal(squareCropInOriginalSpace(image, portrait, image, INITIAL_CROP), null);
  for (const width of [0, -1, 49, NaN, Infinity]) assert.equal(squareCropInOriginalSpace(image, square, { width, height: 800 }, INITIAL_CROP), null);
});

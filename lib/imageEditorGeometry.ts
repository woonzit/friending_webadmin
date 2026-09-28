/** Shared preview/export geometry. Pan is a fraction of the available overflow. */
export type ImageSize = { width: number; height: number };
export type CropPoint = { x: number; y: number };
export type CropTransform = { zoom: number; rotation: number; positionX: number; positionY: number };

export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 3;
export const INITIAL_CROP: CropTransform = { zoom: 1, rotation: 0, positionX: 0, positionY: 0 };

const clampPosition = (value: number) => Math.min(1, Math.max(-1, value));
export const clampCropZoom = (value: number) => Math.min(MAX_CROP_ZOOM, Math.max(MIN_CROP_ZOOM, value));

export function cropGeometry(image: ImageSize, canvas: ImageSize, transform: CropTransform) {
  const swapped = Math.abs(transform.rotation % 180) === 90;
  const width = swapped ? image.height : image.width;
  const height = swapped ? image.width : image.height;
  const scale = Math.max(canvas.width / width, canvas.height / height) * transform.zoom;
  const overflowX = Math.max(0, width * scale - canvas.width);
  const overflowY = Math.max(0, height * scale - canvas.height);
  return {
    scale, overflowX, overflowY,
    offsetX: transform.positionX * overflowX / 2,
    offsetY: transform.positionY * overflowY / 2,
  };
}

/** Pointer deltas are in CSS pixels; the image follows the finger exactly, not inversely. */
export function panCrop(
  image: ImageSize, canvas: ImageSize, viewport: ImageSize,
  transform: CropTransform, delta: CropPoint,
): CropTransform {
  if (viewport.width <= 0 || viewport.height <= 0) return transform;
  const geometry = cropGeometry(image, canvas, transform);
  return {
    ...transform,
    positionX: geometry.overflowX > 0
      ? clampPosition(transform.positionX + delta.x * canvas.width / viewport.width * 2 / geometry.overflowX) : 0,
    positionY: geometry.overflowY > 0
      ? clampPosition(transform.positionY + delta.y * canvas.height / viewport.height * 2 / geometry.overflowY) : 0,
  };
}

/** Keep the source point under the pinch midpoint fixed, except at the no-empty-bars boundary. */
export function pinchCrop(
  image: ImageSize, canvas: ImageSize, transform: CropTransform,
  before: [CropPoint, CropPoint], after: [CropPoint, CropPoint],
): CropTransform {
  const distance = (points: [CropPoint, CropPoint]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const previousDistance = distance(before);
  if (previousDistance < 1) return transform;
  const zoom = clampCropZoom(transform.zoom * distance(after) / previousDistance);
  const previous = cropGeometry(image, canvas, transform);
  const next = cropGeometry(image, canvas, { ...transform, zoom });
  const midpoint = (points: [CropPoint, CropPoint], axis: "x" | "y") => (points[0][axis] + points[1][axis]) / 2;
  const offset = (axis: "x" | "y", length: number, current: number) =>
    midpoint(after, axis) - length / 2 - (midpoint(before, axis) - length / 2 - current) * zoom / transform.zoom;
  return {
    ...transform, zoom,
    positionX: next.overflowX > 0 ? clampPosition(2 * offset("x", canvas.width, previous.offsetX) / next.overflowX) : 0,
    positionY: next.overflowY > 0 ? clampPosition(2 * offset("y", canvas.height, previous.offsetY) / next.overflowY) : 0,
  };
}

/** Invert the same preview geometry into Core's original pixel coordinates. */
export function squareCropInOriginalSpace(
  image: ImageSize, canvas: ImageSize, original: ImageSize, transform: CropTransform,
): { x: number; y: number; size: number } | null {
  if (transform.rotation !== 0 || canvas.width !== canvas.height
    || ![image.width, image.height, original.width, original.height].every((value) => Number.isFinite(value) && value > 0)
    || Math.min(original.width, original.height) < 50) return null;
  const { scale, offsetX, offsetY } = cropGeometry(image, canvas, transform);
  const factor = original.width / image.width;
  const size = Math.max(50, Math.min(Math.round(canvas.width / scale * factor), original.width, original.height));
  const x = Math.round((image.width / 2 - (canvas.width / 2 + offsetX) / scale) * factor);
  const y = Math.round((image.height / 2 - (canvas.height / 2 + offsetY) / scale) * factor);
  return {
    x: Math.max(0, Math.min(x, original.width - size)),
    y: Math.max(0, Math.min(y, original.height - size)),
    size,
  };
}

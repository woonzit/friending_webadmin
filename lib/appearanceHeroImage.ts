export const HERO_IMAGE_MIN_ASPECT_RATIO = 1.75;
export const HERO_IMAGE_MAX_ASPECT_RATIO = 2;

export type HeroImageRatioClassification =
  | "within-range"
  | "crop-top-bottom"
  | "crop-left-right"
  | "unavailable";

/**
 * Presentation-only guidance for the full-bleed Discover slot. This result
 * must never participate in save validation; Core remains the media authority.
 */
export function classifyHeroImageRatio(width: number, height: number): HeroImageRatioClassification {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "unavailable";
  }

  const ratio = width / height;
  if (ratio < HERO_IMAGE_MIN_ASPECT_RATIO) return "crop-top-bottom";
  if (ratio > HERO_IMAGE_MAX_ASPECT_RATIO) return "crop-left-right";
  return "within-range";
}

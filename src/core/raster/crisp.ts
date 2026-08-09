/**
 * Crisp mode — docs/03 §5. Threshold alpha at 128 and re-saturate colour so every
 * surviving pixel is exactly the object's own colour (pixel-art-safe shapes and text).
 * Pure: operates on an RGBA buffer, so it is unit-testable without a canvas.
 */
import type { Rgb } from '../model/types';

export const CRISP_THRESHOLD = 128;

export function thresholdAlpha(pixels: Uint8ClampedArray, color: Rgb, threshold = CRISP_THRESHOLD) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] >= threshold) {
      pixels[i] = color.r;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.b;
      pixels[i + 3] = 255;
    } else {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
    }
  }
}

/**
 * Paint bucket — docs/02 §5. Region growth reads the full visual composite (A3), so text and
 * shape edges bound a fill, while the colour is written into the auto-selected top raster
 * layer (Rule 1).
 */
import { hexToRgb } from '../core/color/convert';
import type { MonetDoc } from '../core/model/types';
import { StrokeCommand } from '../core/model/commands';
import { ensureTopRasterLayer } from '../core/model/document';
import { floodFill, toleranceToThreshold } from '../core/raster/floodfill';
import { blendOver } from '../core/raster/pixels';
import { compositePixels } from '../engine/compose';
import { activeRenderer } from '../engine/renderer';
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { getComposeOpts } from '../ui/sceneHooks';
import type { Tool, ToolPointerEvent } from './types';

/**
 * Flood-fill `doc` at a point. `pick` is the pixel field region growth reads — the visual
 * composite for the active 2D document, or the texture-store composite on the 3D path.
 */
export function applyBucket(doc: MonetDoc, x: number, y: number, pick: Uint8ClampedArray): void {
  const ds = useDocStore.getState();
  const ts = useToolStore.getState();
  const region = floodFill(
    pick,
    doc.width,
    doc.height,
    x,
    y,
    toleranceToThreshold(ts.bucket.tolerancePct),
  );
  if (!region) return;
  fillRegion(ds, doc, region);
}

export const bucketTool: Tool = {
  id: 'bucket',
  cursor: 'crosshair',

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    const ds = useDocStore.getState();
    const doc = ds.active();
    if (!doc) return;

    const pick = activeRenderer()?.compositeSnapshot() ?? compositePixels(doc, getComposeOpts());
    applyBucket(doc, e.doc.x, e.doc.y, pick);
  },
};

function fillRegion(
  ds: ReturnType<typeof useDocStore.getState>,
  doc: MonetDoc,
  region: NonNullable<ReturnType<typeof floodFill>>,
): void {
  const ts = useToolStore.getState();

  const layer = ensureTopRasterLayer(doc);
  const before = new Map([[layer.id, new Uint8ClampedArray(layer.pixels)]]);
  const { r, g, b } = hexToRgb(ts.color);
  const alpha = ts.alpha;

  for (let y = region.rect.y; y < region.rect.y + region.rect.h; y++) {
    for (let x = region.rect.x; x < region.rect.x + region.rect.w; x++) {
      if (!region.mask[y * doc.width + x]) continue;
      const i = (y * doc.width + x) * 4;
      if (alpha >= 1) {
        // Exact replacement at full alpha — no rounding through the blend.
        layer.pixels[i] = r;
        layer.pixels[i + 1] = g;
        layer.pixels[i + 2] = b;
        layer.pixels[i + 3] = 255;
      } else {
        blendOver(layer.pixels, i, r, g, b, alpha);
      }
    }
  }

  const cmd = StrokeCommand.capture(doc, 'Paint bucket', [layer.id], region.rect, before);
  cmd.undo(doc);
  ds.executeOn(doc.id, cmd);
  useToolStore.getState().commitRecent();
}

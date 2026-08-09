/**
 * Paint bucket — docs/02 §5. Region growth reads the full visual composite (A3), so text and
 * shape edges bound a fill, while the colour is written into the auto-selected top raster
 * layer (Rule 1).
 */
import { hexToRgb } from '../core/color/convert';
import { StrokeCommand } from '../core/model/commands';
import { ensureTopRasterLayer } from '../core/model/document';
import { floodFill, toleranceToThreshold } from '../core/raster/floodfill';
import { blendOver } from '../core/raster/pixels';
import { compositePixels } from '../engine/compose';
import { useDocStore } from '../app/docStore';
import { useToolStore } from '../app/toolStore';
import { getComposeOpts } from '../ui/sceneHooks';
import type { Tool, ToolPointerEvent } from './types';

export const bucketTool: Tool = {
  id: 'bucket',
  cursor: 'crosshair',

  onPointerDown(e: ToolPointerEvent) {
    if (e.button !== 0) return;
    const ds = useDocStore.getState();
    const doc = ds.active();
    if (!doc) return;

    const ts = useToolStore.getState();
    const pick = compositePixels(doc, getComposeOpts());
    const region = floodFill(
      pick,
      doc.width,
      doc.height,
      e.doc.x,
      e.doc.y,
      toleranceToThreshold(ts.bucket.tolerancePct),
    );
    if (!region) return;

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
    ds.execute(cmd);
    useToolStore.getState().commitRecent();
  },
};

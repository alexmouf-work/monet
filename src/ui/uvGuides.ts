/**
 * UV guides — docs/11 §9.3: while editing a texture that an open model maps faces into, the 2D
 * canvas outlines every face's uv rect, labelled at high zoom. This is the point of the whole
 * link — painting a 16×16 block texture while seeing which 4×4 patch is the top face.
 * Registered once as an overlay painter; drawing nothing costs nothing.
 */
import type { Rect } from '../core/model/types';
import { FACES, type FaceHit } from '../core/model3d/types';
import { faceUVRect } from '../app/modelActions';
import { useDocStore } from '../app/docStore';
import { themeColors } from '../engine/themeColors';
import { registerOverlayPainter } from './sceneHooks';

/** Every face rect of every open model that maps into the texture at (sourceId, path). */
function guidesFor(sourceId: string, path: string): { rect: Rect; label: string }[] {
  const out: { rect: Rect; label: string }[] = [];
  const models = Object.values(useDocStore.getState().models);
  for (const model of models) {
    for (const el of model.elements) {
      for (const face of FACES) {
        const f = el.faces[face];
        if (!f) continue;
        const ref = model.textures[f.texture];
        if (!ref || ref.kind !== 'file' || ref.sourceId !== sourceId || ref.path !== path) continue;
        const hit: FaceHit = {
          elementId: el.id,
          face,
          point: { x: 0, y: 0, z: 0 },
          uvNorm: { u: 0, v: 0 },
          textureVar: f.texture,
          distance: 0,
        };
        const rect = faceUVRect(model, hit);
        // n/s/e/w/u/d are all distinct first letters — enough at guide scale.
        if (rect) out.push({ rect, label: `${el.name}·${face[0]}` });
      }
    }
  }
  return out;
}

let installed = false;

export function installUVGuides(): void {
  if (installed) return;
  installed = true;
  registerOverlayPainter((ctx, view) => {
    const ds = useDocStore.getState();
    const doc = ds.active();
    const binding = doc?.binding;
    if (!doc || !binding || binding.region) return;
    const guides = guidesFor(binding.sourceId, binding.path);
    if (!guides.length) return;

    const accent = themeColors().accent;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.75;
    for (const g of guides) {
      const x = view.panX + g.rect.x * view.zoom;
      const y = view.panY + g.rect.y * view.zoom;
      const w = g.rect.w * view.zoom;
      const h = g.rect.h * view.zoom;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (view.zoom >= 12 && w > 34) {
        ctx.setLineDash([]);
        ctx.font = '10px system-ui, sans-serif';
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = accent;
        ctx.fillText(g.label, x + 3, y + 11, w - 6);
        ctx.globalAlpha = 0.75;
        ctx.setLineDash([4, 3]);
      }
    }
    ctx.restore();
  });
}

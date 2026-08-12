/**
 * UV tab — docs/11 §10.2 (M17). Per-face uv rects over the LIVE texture: numeric fields
 * (arithmetic), rotation in 90° steps, mirror U/V (endpoint swap), fit-to-face, copy/paste,
 * and box-UV auto-mapping for the whole element. The canvas draws the resolved texture from
 * the model's pixel store and lets the selected rect be moved/resized with texel snapping;
 * every edit is one PatchElementCommand (drag commits via the gizmo's rewind pattern).
 */
import { useEffect, useRef, useState } from 'react';
import { useDocStore } from '../../app/docStore';
import { invalidate, onInvalidate } from '../../app/bus';
import { modelTextures } from '../../app/modelActions';
import { PatchElementCommand } from '../../core/model3d/commands';
import type { Face, ModelElement, ModelFace } from '../../core/model3d/types';
import { FACES } from '../../core/model3d/types';
import {
  boxUV,
  cycleRotation,
  fitUV,
  mirrorUVu,
  mirrorUVv,
  uvTexelRect,
  type UVRect,
  type UVRotation,
} from '../../core/model3d/uv';
import { themeColors } from '../../engine/themeColors';
import { NumField } from '../controls/NumField';

const FACE_LETTER: Record<Face, string> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
  up: 'U',
  down: 'D',
};

/** Copy/paste between faces — module state, survives face/element switches. */
let uvClipboard: { uv: UVRect; rotation?: UVRotation } | null = null;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function UVPanel() {
  const doc = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  const selectedId = useDocStore((s) => s.selectedElementId);
  const storeFace = useDocStore((s) => s.selectedFace);
  useDocStore((s) => s.rev);
  const [face, setFace] = useState<Face>('north');
  // Depth-2 selection from the viewport (click-cycling, docs/11 §10.1) drives this panel.
  useEffect(() => {
    if (storeFace) setFace(storeFace);
  }, [storeFace]);
  const [origin, setOrigin] = useState({ u: 0, v: 0 });
  const [, force] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live drag state: mutate the face directly for feedback, commit one command on release.
  const dragRef = useRef<{
    mode: 'move' | 0 | 1 | 2 | 3;
    before: ModelElement;
    startUV: UVRect;
    startX: number;
    startY: number;
  } | null>(null);

  const el = doc?.elements.find((e) => e.id === selectedId) ?? doc?.elements[0] ?? null;
  const f: ModelFace | null = el?.faces[face] ?? null;
  const entry = doc && f ? modelTextures(doc.id).get(f.texture) : null;

  // ---- drawing ---------------------------------------------------------------------
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const ds = useDocStore.getState();
      const model = ds.activeId ? ds.models[ds.activeId] : null;
      const element =
        model?.elements.find((e) => e.id === ds.selectedElementId) ?? model?.elements[0];
      const fc = element?.faces[face];
      if (!canvas || !model || !element) return;
      const tex = fc ? modelTextures(model.id).get(fc.texture) : null;
      const tw = tex?.width ?? 16;
      const th = tex?.height ?? 16;
      const zoom = Math.max(1, Math.floor(256 / tw));
      canvas.width = tw * zoom;
      canvas.height = th * zoom;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      // Checker ground, then the live pixels.
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#3a3a3a' : '#464646';
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      if (tex) {
        const off = new OffscreenCanvas(tw, th);
        const octx = off.getContext('2d')!;
        octx.putImageData(new ImageData(new Uint8ClampedArray(tex.pixels), tw, th), 0, 0);
        ctx.drawImage(off, 0, 0, tw * zoom, th * zoom);
      }

      // Every face of this element that shares the drawn texture, dim; selected face accent.
      const accent = themeColors().accent;
      for (const other of FACES) {
        const of = element.faces[other];
        if (!of || (fc && of.texture !== fc.texture)) continue;
        const r = uvTexelRect(of.uv, tw, th);
        const x = Math.min(r.x, r.x + r.w) * zoom;
        const y = Math.min(r.y, r.y + r.h) * zoom;
        const w = Math.abs(r.w) * zoom;
        const h = Math.abs(r.h) * zoom;
        const isSel = other === face;
        ctx.strokeStyle = isSel ? accent : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
        ctx.fillStyle = isSel ? accent : 'rgba(255,255,255,0.7)';
        ctx.font = `${Math.max(10, zoom)}px sans-serif`;
        ctx.fillText(FACE_LETTER[other], x + 3, y + Math.max(10, zoom));
        if (isSel) {
          // Corner handles, in uv order: (u1,v1) (u2,v1) (u2,v2) (u1,v2).
          const cs: [number, number][] = [
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x + r.w, r.y + r.h],
            [r.x, r.y + r.h],
          ];
          for (const [cx, cy] of cs) {
            ctx.fillStyle = accent;
            ctx.fillRect(cx * zoom - 3, cy * zoom - 3, 6, 6);
          }
        }
      }
    };
    draw();
    return onInvalidate(draw);
  });

  if (!doc) return null;

  const ds = useDocStore.getState();

  const patch = (label: string, fn: (draft: ModelElement) => void) => {
    if (!el) return;
    const after = clone(el);
    fn(after);
    ds.executeModel(new PatchElementCommand(label, el, after));
  };

  const patchFace = (label: string, fn: (draft: ModelFace) => void) =>
    patch(label, (d) => {
      const df = d.faces[face];
      if (df) fn(df);
    });

  // ---- canvas interaction ----------------------------------------------------------
  const texelFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const tw = entry?.width ?? 16;
    const th = entry?.height ?? 16;
    return {
      x: ((e.clientX - r.left) / r.width) * tw,
      y: ((e.clientY - r.top) / r.height) * th,
      tw,
      th,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!el || !f || !entry) return;
    const p = texelFromEvent(e);
    const r = uvTexelRect(f.uv, p.tw, p.th);
    const corners: [number, number][] = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ];
    const grab = (Math.max(p.tw, p.th) / 256) * 8; // ~8 css px in texels
    let mode: 'move' | 0 | 1 | 2 | 3 | null = null;
    for (let i = 0; i < corners.length; i++) {
      const [cx, cy] = corners[i];
      if (Math.abs(p.x - cx) < grab && Math.abs(p.y - cy) < grab) mode = i as 0 | 1 | 2 | 3;
    }
    if (mode === null) {
      const inX = p.x >= Math.min(r.x, r.x + r.w) && p.x <= Math.max(r.x, r.x + r.w);
      const inY = p.y >= Math.min(r.y, r.y + r.h) && p.y <= Math.max(r.y, r.y + r.h);
      if (inX && inY) mode = 'move';
    }
    if (mode === null) {
      // Click another face's rect (same texture) to select it.
      for (const other of FACES) {
        const of = el.faces[other];
        if (!of || other === face || of.texture !== f.texture) continue;
        const or = uvTexelRect(of.uv, p.tw, p.th);
        const inX = p.x >= Math.min(or.x, or.x + or.w) && p.x <= Math.max(or.x, or.x + or.w);
        const inY = p.y >= Math.min(or.y, or.y + or.h) && p.y <= Math.max(or.y, or.y + or.h);
        if (inX && inY) {
          setFace(other);
          return;
        }
      }
      return;
    }
    dragRef.current = {
      mode,
      before: clone(el),
      startUV: [...f.uv] as UVRect,
      startX: p.x,
      startY: p.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !el || !f || !entry) return;
    const p = texelFromEvent(e);
    // Texel lattice by default, ⇧ half, Alt free — the gizmo's snapping rule (§10.1).
    const step = e.altKey ? 0 : e.shiftKey ? 0.5 : 1;
    const snap = (t: number) => (step ? Math.round(t / step) * step : t);
    const dxT = p.x - drag.startX;
    const dyT = p.y - drag.startY;
    const toU = (t: number) => (t * 16) / p.tw;
    const toV = (t: number) => (t * 16) / p.th;
    const uv: UVRect = [...drag.startUV];
    if (drag.mode === 'move') {
      const du = toU(snap(dxT));
      const dv = toV(snap(dyT));
      uv[0] = drag.startUV[0] + du;
      uv[2] = drag.startUV[2] + du;
      uv[1] = drag.startUV[1] + dv;
      uv[3] = drag.startUV[3] + dv;
    } else {
      // Corner k owns (u,v) pair: 0=(u1,v1) 1=(u2,v1) 2=(u2,v2) 3=(u1,v2).
      const startR = uvTexelRect(drag.startUV, p.tw, p.th);
      const cx = drag.mode === 0 || drag.mode === 3 ? startR.x : startR.x + startR.w;
      const cy = drag.mode === 0 || drag.mode === 1 ? startR.y : startR.y + startR.h;
      const nx = snap(cx + dxT);
      const ny = snap(cy + dyT);
      if (drag.mode === 0 || drag.mode === 3) uv[0] = toU(nx);
      else uv[2] = toU(nx);
      if (drag.mode === 0 || drag.mode === 1) uv[1] = toV(ny);
      else uv[3] = toV(ny);
    }
    f.uv = uv;
    invalidate(true);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag || !el) return;
    dragRef.current = null;
    const after = clone(el);
    // Rewind to the grab-time snapshot, then commit one command (the gizmo pattern).
    const idx = doc.elements.findIndex((x) => x.id === el.id);
    doc.elements[idx] = clone(drag.before);
    if (JSON.stringify(after) !== JSON.stringify(drag.before)) {
      ds.executeModel(new PatchElementCommand('Edit UV', drag.before, after));
    } else {
      invalidate(true);
    }
  };

  const defaultVar = () => (doc.textures['all'] ? 'all' : (Object.keys(doc.textures)[0] ?? 'all'));

  return (
    <div className="panel">
      <h3 className="panel__title">UV</h3>

      {!el && <p className="panel__hint">Add an element on the Model tab first.</p>}

      {el && (
        <>
          <div className="field-row">
            <span className="field-label">
              #{el.id} {el.name}
            </span>
            <div className="segmented">
              {FACES.map((x) => (
                <button
                  key={x}
                  className={x === face ? 'is-active' : ''}
                  style={el.faces[x] ? undefined : { opacity: 0.4 }}
                  title={x + (el.faces[x] ? '' : ' (face off)')}
                  onClick={() => {
                    setFace(x);
                    if (el.id === selectedId) ds.selectFace(x);
                  }}
                >
                  {FACE_LETTER[x]}
                </button>
              ))}
            </div>
          </div>

          {!f && (
            <div className="field-row">
              <span className="panel__hint">This face is off — it does not render.</span>
              <button
                className="btn"
                onClick={() =>
                  patch(`Add ${face} face`, (d) => {
                    d.faces[face] = { uv: fitUV(face, el), texture: defaultVar() };
                  })
                }
              >
                + Add face
              </button>
            </div>
          )}

          {f && (
            <>
              <div className="field-row">
                <span className="field-label">Rect</span>
                <NumField
                  label="u1"
                  width={40}
                  value={f.uv[0]}
                  onCommit={(v) => patchFace('UV u1', (d) => (d.uv[0] = v))}
                />
                <NumField
                  label="v1"
                  width={40}
                  value={f.uv[1]}
                  onCommit={(v) => patchFace('UV v1', (d) => (d.uv[1] = v))}
                />
                <NumField
                  label="u2"
                  width={40}
                  value={f.uv[2]}
                  onCommit={(v) => patchFace('UV u2', (d) => (d.uv[2] = v))}
                />
                <NumField
                  label="v2"
                  width={40}
                  value={f.uv[3]}
                  onCommit={(v) => patchFace('UV v2', (d) => (d.uv[3] = v))}
                />
              </div>

              <div className="field-row">
                <span className="field-label">Texture</span>
                <select
                  value={f.texture}
                  onChange={(e) => patchFace('Face texture', (d) => (d.texture = e.target.value))}
                >
                  {Object.keys(doc.textures).map((k) => (
                    <option key={k} value={k}>
                      #{k}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  title="Rotate the face texture 90°"
                  onClick={() =>
                    patchFace('Rotate UV', (d) => {
                      const r = cycleRotation(d.rotation);
                      if (r === 0) delete d.rotation;
                      else d.rotation = r;
                    })
                  }
                >
                  ↻ {f.rotation ?? 0}°
                </button>
                <div className="segmented" title="Mirror by swapping rect endpoints">
                  <button onClick={() => patchFace('Mirror U', (d) => (d.uv = mirrorUVu(d.uv)))}>
                    ⇋u
                  </button>
                  <button onClick={() => patchFace('Mirror V', (d) => (d.uv = mirrorUVv(d.uv)))}>
                    ⇋v
                  </button>
                </div>
              </div>

              <div className="field-row">
                <button
                  className="btn"
                  title="Vanilla projection of this face of the box"
                  onClick={() => patchFace('Fit UV', (d) => (d.uv = fitUV(face, el)))}
                >
                  Fit
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    uvClipboard = { uv: [...f.uv] as UVRect, rotation: f.rotation };
                    force((n) => n + 1);
                  }}
                >
                  Copy UV
                </button>
                <button
                  className="btn"
                  disabled={!uvClipboard}
                  onClick={() =>
                    patchFace('Paste UV', (d) => {
                      if (!uvClipboard) return;
                      d.uv = [...uvClipboard.uv] as UVRect;
                      if (uvClipboard.rotation) d.rotation = uvClipboard.rotation;
                      else delete d.rotation;
                    })
                  }
                >
                  Paste UV
                </button>
                <button
                  className="btn btn--danger"
                  title="Turn this face off (it stops rendering)"
                  onClick={() => patch(`Remove ${face} face`, (d) => delete d.faces[face])}
                >
                  Off
                </button>
              </div>
            </>
          )}

          <div className="field-row" title="Unwrap all faces onto the sheet from this texel origin">
            <span className="field-label">Box-UV</span>
            <NumField
              label="u"
              width={40}
              value={origin.u}
              onCommit={(u) => setOrigin((o) => ({ ...o, u }))}
            />
            <NumField
              label="v"
              width={40}
              value={origin.v}
              onCommit={(v) => setOrigin((o) => ({ ...o, v }))}
            />
            <button
              className="btn"
              onClick={() => {
                const tw = entry?.width ?? 16;
                const th = entry?.height ?? 16;
                patch('Box-UV', (d) => {
                  const rects = boxUV(d, tw, th, origin.u, origin.v);
                  for (const x of FACES) {
                    const df = d.faces[x];
                    if (df) df.uv = rects[x];
                  }
                });
              }}
            >
              Apply
            </button>
          </div>

          <canvas
            ref={canvasRef}
            className="uvcanvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <p className="panel__hint">
            Drag the rect to move it, its corners to resize (⇧ = ½ texel, Alt = free). Click another
            rect to select that face. The texture is live — paint in 2D or 3D and it updates here.
          </p>
        </>
      )}
    </div>
  );
}

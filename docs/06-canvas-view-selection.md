# 06 — Canvas, view & selection

## 1. Canvas settings (the Canvas feature tab, [09 §3.6])

### 1.1 Background

- Segmented control **Transparent | Colour** + colour swatch (enabled in Colour
  mode).
- Model: `background = { mode, color }` [01 §3]. Toggling mode **never clears
  `color`**; picking a colour while in Transparent mode switches to Colour mode.
  Both survive save/reload — this is the required "remember transparency and bg
  colour across toggles".
- Renderer: checkerboard in Transparent mode (view chrome only), flat colour rect
  in Colour mode. Export: Transparent → alpha-preserving formats keep alpha;
  Colour → the colour is composited under everything.
- Changing background = `BackgroundCommand` (undoable).

### 1.2 Resize dialog (also `Ctrl+E`)

Fields and rules:

- **Width / Height** numeric fields + unit dropdown **px | %** (percent converts
  live: `px = round(orig * pct/100)`, clamps 1–4096; switching unit converts the
  displayed values).
- **Lock aspect ratio** checkbox (default on): editing one field updates the other
  from the ratio captured **when the dialog opened** (avoid drift on re-edits).
- **Resize image with canvas** checkbox (default **on**):
  - **on** → content scales to the new size. Raster layers resample; vector
    objects scale: for scale factors `kx = W'/W`, `ky = H'/H`:
    `cx *= kx; cy *= ky; w *= kx; h *= ky` (rotation unchanged). Resample method
    dropdown appears: **Nearest (default)** | Bilinear.
  - **off** → canvas re-canvases: content keeps its pixel position, anchored
    **top-left**; growing pads transparent; shrinking crops. Raster layers copy
    through `copyRect/pasteRect`; objects keep their transforms (possibly now
    off-canvas — fine, they remain selectable via marquee-less click).
- OK → `CanvasResizeCommand` (full snapshot).

Nearest resample (`core/raster/transform.ts`):
`src(floor((x + 0.5) * W / W'), floor((y + 0.5) * H / H'))` per destination pixel.
Bilinear: standard 4-tap weighted average on un-premultiplied RGBA with
**alpha-weighted colour** (weight each colour tap by its alpha, divide by total
alpha; alpha itself plain bilinear) to avoid dark fringes.

### 1.3 Rotate 90° CW / ACW, flips

Buttons in the Canvas tab (+ shortcuts [09 §7]). Whole-document operations —
raster layers remap, objects transform, doc W/H swap on rotates. All are
snapshot commands.

Raster remaps (new buffer, `W' = H, H' = W` for rotates):

```
CW : dst(x, y) = src(y, H − 1 − x)
ACW: dst(x, y) = src(W − 1 − y, x)
FlipH: dst(x, y) = src(W − 1 − x, y)
FlipV: dst(x, y) = src(x, H − 1 − y)
```

Object transforms (continuous coords, old size `W,H`):

```
CW : (cx, cy) → (H − cy, cx);   rotation += 90
ACW: (cx, cy) → (cy, W − cx);   rotation −= 90
FlipH: cx → W − cx;  flipX = !flipX;  rotation → (360 − rotation) % 360
FlipV: cy → H − cy;  flipY = !flipY;  rotation → (360 − rotation) % 360
```

(Unit-test object corners against raster remaps: rotate a doc containing one
rectangle object and one identical baked rectangle — they must stay pixel-aligned.)

## 2. View: zoom, pan, grid — `engine/viewport.ts`

State per document: `{ zoom, panX, panY }`; doc→screen:
`screen = doc * zoom + pan`.

- **Mouse wheel = zoom** (required: up in, down out): factor
  `f = deltaY < 0 ? 1.25 : 1/1.25`, **anchored at the cursor**:
  `zoom' = clamp(zoom * f, 1/16, 128)` then
  `pan' = cursor − (cursor − pan) * (zoom'/zoom)`. `Ctrl+wheel` is intercepted
  (`preventDefault`) and does the same (pinch-zoom trackpads).
- **Pan**: hold `Space` + drag, or middle-button drag; cursor `grab/grabbing`.
- **Fit** (`Ctrl+0`): zoom = largest of the 1/16…128 range that fits
  `doc + 32 px padding` in the workspace, centred. New/opened docs start fitted.
  **100 %** (`Ctrl+1`) centres at zoom 1. Zoom readout + slider in the status bar.
- **Pixel grid**: mode `auto | on | off` (default auto = shown when zoom ≥ 8).
  1-device-px lines at every pixel boundary, `rgba(128,128,128,0.35)`, drawn in
  screen space after snapping doc gridlines to device pixels. At zoom ≥ 32 add a
  heavier line every 16 px (Minecraft sub-tile guide), `rgba(64,160,255,0.35)`.
- **Checkerboard**: §1.1; 8-px screen-space squares independent of zoom.

## 3. Tiling preview (essential for seamless Minecraft textures)

`View → Tiling preview` (`Ctrl+T`) toggles: the renderer draws the document
composite in a 3×3 grid (offsets −W..+W, −H..+H), the centre tile outlined
1 px white/black double line; painting remains fully live — strokes apply to the
centre tile's coordinates modulo nothing (tools receive doc coords from the centre
tile only; pointer positions over neighbour tiles map by modulo:
`docX = ((x mod W) + W) mod W` so you can draw across a seam and it wraps). Grid
and marquee overlays render on the centre tile only.

## 4. Rectangular selection — `tools/select.ts`

One Select tool, two behaviours on pointer-down (see [03 §2.2] for object hits):
hit an object → object transform mode; otherwise → **marquee**.

### 4.1 Marquee lifecycle

```ts
interface SelectionState {
  rect: Rect;                                  // integer, clamped to doc
  floating?: {                                 // present once lifted
    pixels: Uint8ClampedArray;                 // rect.w * rect.h * 4
    x: number; y: number;                      // current top-left, doc space
  };
}
```

1. **Drag** on empty canvas → live dashed rect (marching ants: 4-px dashes,
   `lineDashOffset` animated 60 Hz), snapped to pixel boundaries, clamped to the
   document. Release with `w·h ≥ 1` → selection set. Plain click clears.
2. **Lift (float)**: the first drag *inside* the rect — or any of cut/paste —
   converts the region to a floating selection: `pixels` = composite of **raster
   layers only** within the rect ([A2]; objects render above/below unaffected);
   every raster layer's rect region is cleared (`FloatCommand`, undoable).
3. **Move**: dragging the float updates `x,y` (arrow keys nudge 1 px / `Shift`
   10 px). The renderer draws the float above the whole stack.
4. **Anchor**: `Esc`, `Enter`, clicking outside, switching tools, or starting any
   brush stroke anchors: float composites (`blendOver`) into the **top raster
   layer** (Rule 1 — created if the top item is an object) via `AnchorCommand`.
   Selection clears.
5. **Delete** (`Del`): with a float → discard it (`AnchorCommand` variant that
   restores nothing); without → clear the rect in all raster layers
   (`StrokeCommand`).
6. **Scale**: the float shows 8 handles; dragging resizes it with **nearest**
   resampling from the originally-lifted pixels (never re-resample the
   resampled). `Shift` keeps aspect.

`Ctrl+A` selects the whole canvas. Selection state lives in `docStore.selection`
(per active doc) and is **not** persisted into `.monet`.

### 4.2 Clipboard

- **Copy `Ctrl+C`** — rect (or float) → PNG via an offscreen →
  `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`, plus an
  internal in-memory copy (fallback when clipboard permissions fail).
- **Cut `Ctrl+X`** — copy + lift-then-discard (one undo step).
- **Paste `Ctrl+V`** — `navigator.clipboard.read()` (fallback: `paste` event, then
  internal copy); decode PNG → new floating selection centred in the viewport
  (clamped inside the doc; images larger than the doc are pasted un-scaled and can
  be moved/anchored — they crop on anchor). Pasting with no document open creates
  a doc of the image's size.
- **Crop to selection** (`Ctrl+Shift+X`, Edit menu; enabled with a non-floating
  rect): canvas resize to `rect` — raster layers `copyRect`, object centres shift
  by `(−rect.x, −rect.y)`; implemented as a `CanvasResizeCommand` variant.

### 4.3 Flatten (Edit menu, `Ctrl+Shift+F`)

Renders the full stack (objects included, crisp modes respected) at 1:1 into a
single new `RasterLayer`, replaces the stack with `[that layer]`
(`FlattenCommand`). Background stays a document property. Needed before
noise/recolour/eraser can affect text & shapes (A2 hint links here).

## 5. Acceptance

- Background: toggle → colour → toggle → toggle: the chosen colour returns; save
  and reload preserves both fields.
- Resize 16→32 px with "resize image" **on**/Nearest doubles every pixel exactly;
  **off** pads transparent right/bottom; % mode with lock keeps ratio; 4096 clamp
  works.
- Rotate CW then ACW = identity (bytes); four CWs = identity; flips are
  involutions; a doc with a text object + its baked twin stays pixel-aligned
  through all six ops.
- Wheel zooms about the cursor (the hovered doc pixel stays under the pointer);
  range 1/16–128; `Ctrl+0` fits.
- Tiling preview: drawing across the centre tile's right edge continues on the
  left edge (wrap), and the 3×3 layout matches the composite (E2E screenshot).
- Marquee: lift/move/anchor round-trip with undo at every step; deleting clears
  all raster layers but not objects; copy → paste in a second document carries
  exact pixels; crop shifts objects correctly.
- Flatten of the owner scenario stack produces a single layer whose composite is
  pixel-identical to the pre-flatten render.

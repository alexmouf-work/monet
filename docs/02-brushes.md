# 02 — Brushes & colour

Covers the four required brushes (pixel pen, marker, eraser, paint bucket), the
shared stroke engine, and the colour system (incl. eyedropper). UI placement for
every control is in [09 §3.1].

## 1. Colour system

- Active colour = `toolStore.color = { hex: '#RRGGBB', alpha: 0–1 }`. One primary
  colour (Paint-3D style); no secondary.
- Colour panel [09 §5]: MS-Paint 20-swatch palette, custom swatches (`+` persists to
  settings), 12 most-recent, hex input accepting `#RGB`, `#RRGGBB`, `#RRGGBBAA`
  (pasting an 8-digit hex sets alpha too), an alpha slider 0–100 %, and an HSV
  picker (hue strip + SV square — implement with two canvases and pointer drags;
  maths via `color/convert.ts` [05 §2]).
- **Eyedropper**: dedicated tool + `Alt`+click from any brush/shape tool. Picks the
  **visual composite** colour (incl. objects & background) at the hovered pixel:
  read from the renderer's last composite buffer. Left-click sets `{hex, alpha}`
  (alpha from the composite pixel; over the checkerboard → alpha 0 with hex
  unchanged). Escape/`Alt` release returns to the previous tool.

`core/color/convert.ts` must provide (unit-tested):
`hexToRgb`, `rgbToHex`, `parseHexA` (8-digit), `rgbToHsl`, `hslToRgb`, `rgbToHsv`,
`hsvToRgb` — formulas in [05 §2].

## 2. Brush tips (masks) — `core/raster/stamp.ts`

Every brush has `size` (integer px, 1–64, default 4) and `tip: 'circle' | 'square'`.
A tip is precomputed as a coverage mask whenever `(size, tip)` changes:

```ts
export interface TipMask { size: number; a: Float32Array; } // size*size coverage 0–1

export function makeTip(size: number, tip: 'circle' | 'square'): TipMask {
  const a = new Float32Array(size * size);
  if (tip === 'square') { a.fill(1); return { size, a }; }
  const c = (size - 1) / 2, r = size / 2;          // centre & radius
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d2 = (x - c) ** 2 + (y - c) ** 2;
    a[y * size + x] = d2 <= r * r ? 1 : 0;         // hard, aliased disc (pixel-art correct)
  }
  return { size, a };
}
```

- `size` 1 and 2 circles degenerate to squares — that is correct and expected.
- Stamp placement: pointer doc-space float position `p` → top-left
  `sx = round(p.x) - floor(size / 2)`, same for `sy`. (Odd sizes centre on the
  hovered pixel; even sizes bias up-left — stable and predictable at high zoom.)
- The marker uses **graded** tips instead (see §4) — same placement rule.

## 3. The stroke engine (shared by pen, marker, eraser)

A stroke = pointer-down → moves → pointer-up, producing **one** `StrokeCommand`.
Compositing per-stamp directly into the layer is wrong (overlapping semi-transparent
stamps inside one stroke would darken repeatedly). Instead every stroke accumulates
into a **scratch coverage buffer**, composited **once** on pointer-up.

### 3.1 Scratch state (owned by the active brush tool)

```ts
interface StrokeScratch {
  cov: Float32Array;            // doc W*H, max-combined coverage 0–1
  dirty: Rect | null;           // running union of touched pixels
  scratchCanvas: HTMLCanvasElement; // preview image of the stroke (engine-owned)
}
```

### 3.2 Stamping

On pointer-down stamp once at `p₀`. On each move from `pPrev` to `p`, walk the
segment and stamp at every step:

- pen & eraser: integer steps via **Bresenham** between `round(pPrev)` and
  `round(p)` (gap-free 1-px lines even for size 1);
- marker: fixed spacing `max(1, size * 0.25)` px along the segment (smooth falloff
  overlap).

Each stamp merges the tip into `cov` with **max**, not addition:

```ts
for each tip cell (tx, ty) with coverage m > 0:
  const x = sx + tx, y = sy + ty;
  if (inside doc) { const i = y * W + x; if (m > cov[i]) { cov[i] = m; growDirty(x, y); } }
```

`max` keeps one stroke perfectly even no matter how slowly the user draws.

### 3.3 Commit (pointer-up)

Target layer per auto-layering Rule 1 [01 §3.1] (eraser: all raster layers, A2).
With active colour `(r,g,b)` and alpha `A`:

- **pen / marker**: for every pixel in `dirty` with `cov[i] > 0` →
  `blendOver(layer.pixels, i*4, r, g, b, cov[i] * A)`.
- **pen specifically**: `cov` values are only 0|1 (hard tip), so a pen stroke at
  alpha 1 is an exact pixel replacement — "always the same pixel colour applied
  across the radius".
- **eraser**: for every raster layer:
  `pixels[i*4+3] = round(pixels[i*4+3] * (1 - cov[i]))` (colour channels untouched;
  eraser strength is always 100 %).

Record `before`/`after` crops of `dirty` per layer into the `StrokeCommand`, patch
`layerCache`, clear scratch.

### 3.4 Live preview contract (renderer ↔ tool)

- pen/marker: after drawing the target layer, the renderer draws `scratchCanvas`
  (the scratch tinted with the active colour: regenerate its dirty rect each frame
  via `putImageData` of `[r,g,b, cov*A*255]`).
- eraser: while a stroke is live the renderer draws **each raster layer** through
  the inverse scratch: draw layer to a doc-sized temp canvas, then
  `globalCompositeOperation='destination-out'` + draw `scratchCanvas`, then blit the
  temp. (Simple, correct; canvases are tiny.)
- Brush cursor: `drawOverlay` draws the tip outline (circle/square of
  `size × zoom`) centred on the cursor, 1-px black + 1-px white double outline.
  The CSS cursor stays `crosshair`, **not** `none` — the outline supplements the
  pointer, it does not replace it [09 §8].

## 4. Marker tip (graded)

The marker's tip mask is graded from 1 at the centre to 0 at the radius:

```ts
export function makeMarkerTip(size: number, tip: 'circle' | 'square'): TipMask {
  const a = new Float32Array(size * size);
  const c = (size - 1) / 2, r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.abs(x - c), dy = Math.abs(y - c);
    const d = tip === 'circle' ? Math.hypot(dx, dy) : Math.max(dx, dy); // Chebyshev = square falloff
    const t = Math.min(1, d / r);
    a[y * size + x] = (1 - t) ** 2;        // soft quadratic falloff to transparency
  }
  return { size, a };
}
```

Gradient runs **main colour → transparent** across the radius as required; square
markers fade toward the square's edges (Chebyshev distance). Successive overlapping
*strokes* still build up (each stroke composites once), matching Paint 3D marker
feel.

## 5. Paint bucket — `core/raster/floodfill.ts`

Controls: tolerance slider 0–100 % (default 15 %). `T = round(pct/100 * 255)`.

- **Pick surface** (A3): the full visual composite RGBA buffer (background colour
  incl., objects incl.) — the renderer exposes `compositeSnapshot()`. Region growth
  happens on this surface, so text/shape edges bound fills naturally.
- **Write target**: the top raster layer per Rule 1 (created if needed). The fill
  colour is written with the active alpha through `blendOver` — except when the
  active alpha is 1, write raw RGBA directly (exact replacement).
- **Match predicate** (A8): seed colour `(r₀,g₀,b₀,a₀)` from the pick surface;
  pixel matches iff `max(|Δr|,|Δg|,|Δb|,|Δa|) ≤ T`. Tolerance 0 = exact colour
  only; "does not fill a colour outside the tolerance" holds by construction.
- 4-connectivity, contiguous only.

Reference implementation (scanline span fill — fast and recursion-free):

```ts
export function floodFill(pick: Uint8ClampedArray, W: number, H: number,
                          sx: number, sy: number, T: number): { mask: Uint8Array; rect: Rect } | null {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const s = idx(sx, sy, W);
  const r0 = pick[s], g0 = pick[s+1], b0 = pick[s+2], a0 = pick[s+3];
  const match = (i: number) =>
    Math.max(Math.abs(pick[i]-r0), Math.abs(pick[i+1]-g0),
             Math.abs(pick[i+2]-b0), Math.abs(pick[i+3]-a0)) <= T;
  const mask = new Uint8Array(W * H);
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    let x0 = x;                                   // walk left to span start
    while (x0 >= 0 && !mask[y*W + x0] && match(idx(x0, y, W))) x0--;
    x0++;
    let x1 = x;                                   // walk right to span end
    while (x1 < W && !mask[y*W + x1] && match(idx(x1, y, W))) x1++;
    x1--;
    if (x1 < x0) continue;
    for (let xi = x0; xi <= x1; xi++) mask[y*W + xi] = 1;       // fill the span
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y);  maxY = Math.max(maxY, y);
    for (const ny of [y - 1, y + 1]) {            // seed matching runs above/below
      if (ny < 0 || ny >= H) continue;
      let xi = x0;
      while (xi <= x1) {
        if (!mask[ny*W + xi] && match(idx(xi, ny, W))) {
          stack.push(xi, ny);
          while (xi <= x1 && !mask[ny*W + xi] && match(idx(xi, ny, W))) xi++;
        } else xi++;
      }
    }
  }
  return { mask, rect: { x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1 } };
}
```

The tool then writes the active colour through `mask` into the target layer and
records one `StrokeCommand`. Cursor: bucket icon with the hot-spot at the spout.

## 6. Tool options (right panel) summary

| Tool | Controls |
| ---- | -------- |
| Pixel pen | size slider 1–64 + numeric, tip toggle ◯/▢ |
| Marker | size 1–64, tip ◯/▢ |
| Eraser | size 1–64, tip ◯/▢ |
| Bucket | tolerance 0–100 % slider + numeric |
| Eyedropper | (none) — status bar shows hovered hex |

All settings persist per tool in `toolStore.perTool` across sessions.

## 7. Acceptance

- Pen, size 1, alpha 1: a slow wiggly drag produces a gap-free 1-px line whose
  pixels all equal the active colour exactly.
- Pen with 50 % alpha: one stroke self-crossing shows **no** darker overlap inside
  the stroke; a second stroke over it does darken.
- Marker stamp at size 16 measured along a radius decreases monotonically to 0 at
  the edge; square marker isolines are squares.
- Eraser removes pixels from *all* paint layers under the tip but leaves a text
  object intact (owner scenario + eraser).
- Bucket at 0 % on a dithered checker fills exactly one colour's connected run;
  at 100 % it fills the entire canvas; fills never escape a 1-px pen outline drawn
  in a distinct colour; `floodFill` unit tests cover seed-on-edge, single-pixel
  regions, and full-canvas fills.
- Eyedropper over a semi-transparent marker stroke picks the *composited* colour,
  and picks alpha 0 over bare checkerboard.

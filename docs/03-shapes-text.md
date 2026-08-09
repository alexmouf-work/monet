# 03 — 2D shapes & text

Shapes and text are **live objects** ([01 §3]): parameters + `Transform`, rendered
every frame, editable until flattened. This doc gives exact geometry for all ten
shapes, the create/transform interactions, and the full text tool.

## 1. Shape geometry — `core/shapes/geometry.ts`

All shapes are defined in **unit space** `[0,1]²` (x right, y down) and mapped to the
document by the object matrix [01 §4.1]. Each `ShapeType` provides
`buildPath(shape, points?): Path2D` in unit space.

| Shape | Unit-space definition |
| ----- | --------------------- |
| `rectangle` | polygon (0,0) (1,0) (1,1) (0,1) |
| `triangle` | polygon (0.5,0) (1,1) (0,1) — apex top-centre, base bottom |
| `pentagon` | regular 5-gon: `vₖ = (0.5 + 0.5·cos φₖ, 0.5 + 0.5·sin φₖ)`, `φₖ = -90° + k·72°`, k=0..4 (point up) |
| `hexagon` | regular 6-gon, same formula with `φₖ = -90° + k·60°` (point up) |
| `ellipse` | `path.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, 2π)` |
| `circle` | identical path to ellipse; the **tool** locks the transform square (§2.1) and the panel links W/H |
| `arrow` | block arrow, filled polygon: (0,0.30) (0.60,0.30) (0.60,0) (1,0.5) (0.60,1) (0.60,0.70) (0,0.70) |
| `arrowhead` | open chevron **polyline** through `points` default (0,0) (1,0.5) (0,1) — stroked; if fill is enabled the path is closed implicitly |
| `line` | segment between `points[0]`,`points[1]` (defaults (0,0.5)→(1,0.5)); stroke only — the fill section is disabled in the panel |
| `spline` | Catmull-Rom curve through `points` (§4); stroke; fill optional (closes the path) |

Regular polygons are inscribed in the unit square, so a non-square transform
stretches them (Paint-3D behaviour). The rotation handle covers any orientation
preference (e.g. flat-top hexagon = rotation 30°).

## 2. Creating and editing shapes

### 2.1 Drag-create

Shape tool active + chosen type: pointer-down anchors `p₀`, drag to `p₁`, on
pointer-up create the object (via `AddItemCommand`):

```
cx=(p₀.x+p₁.x)/2  cy=(p₀.y+p₁.y)/2  w=|p₁.x−p₀.x|  h=|p₁.y−p₀.y|  rotation=0
```

- Degenerate drags (`w`&`h` < 3 px) create a default 32×32 (or ¼ of the canvas's
  short side, whichever is smaller) at the click point.
- `Shift` constrains: `w = h = max(|dx|,|dy|)` (rect→square, ellipse→circle); for
  `line`, snaps the angle to 45° steps.
- **circle** always applies the square constraint.
- **line**: `points = [(0,0.5),(1,0.5)]` and the transform spans the dragged
  segment (h = max(strokeWidth, 1)); endpoint handles afterwards (§2.3).
- **spline**: different flow — each click **appends a point**; a preview curve
  follows the cursor; `Enter` or double-click commits, `Esc` cancels, `Backspace`
  removes the last point. Minimum 2 points. On commit, compute the points' bounding
  box → that becomes the transform; normalise points into unit space.
- **arrowhead**: created by drag like other shapes (its default `points` span the
  unit square).

After creation the object is selected and the options panel shows its style.

### 2.2 Selection & transform handles (select tool + just-created objects)

- Click hit-test top-down over objects (§3); hit → select object (marquee mode
  otherwise, [06 §4]).
- Selected object chrome (screen-space overlay, constant size regardless of zoom):
  dashed bounding box, **8 scale handles** (corners + edge midpoints, 8×8 px), one
  **rotation handle** 24 px above the top-centre, connected by a stick.
- **Move**: drag inside the box → `cx,cy` follow (arrow keys nudge 1 px, `Shift`
  10 px).
- **Scale**: dragging a handle maps the pointer into local space
  (`localFromWorld`), keeps the opposite handle/edge fixed, recomputes `w,h`
  (and `cx,cy` so the fixed point stays put). `Shift` preserves aspect. Minimum
  size 1×1. Negative drag-through flips via `flipX/flipY`.
- **Rotate**: `rotation = atan2(pointer − centre) + 90°`, degrees, normalised
  0–360; `Shift` snaps to 15° steps. The options panel has a numeric **Rotation
  0–360°** field (required feature) plus W/H/X/Y numeric fields.
- **Delete** removes the object; `Ctrl+D` duplicates (offset +8,+8 px).
- `Esc` deselects. All edits coalesce per drag into one `UpdateItemCommand`.
- **line/spline/arrowhead extra**: when selected, each `points[]` vertex shows a
  round handle (drag to move; the transform is left untouched — points move in unit
  space via `localFromWorld`). Spline: `Alt`+click a segment inserts a point,
  `Alt`+click a point removes it (min 2 remain).

### 2.3 Style — fill & outline (required controls)

Options panel per selected object / next-to-create defaults:

- **Fill**: enable checkbox, colour swatch (opens colour panel), **opacity 0–100 %**.
- **Outline**: enable checkbox, colour swatch, **opacity 0–100 %**, **weight
  1–64 px** slider+numeric.

#### 2.4 Outline disabled ≠ no outline (owner directive 2026-08-09)

An outline is **always painted**. Unchecking *Outline* only switches its colour and
opacity to the **fill's**, keeping the same weight — so:

- the shape's footprint is identical whether the outline is on or off; the toggle
  changes the edge's colour, never the geometry;
- an edge that would otherwise be dropped by the crisp threshold stays solid;
- a `line` (no fill) or a shape with *Fill* also off stays **visible** instead of
  becoming an object you can select but not see.

Same-colour fill and edge must composite as **one** pass at the fill's alpha
(`drawObjects.singlePass`, and the single crisp pass): painting them separately
blends the boundary twice and leaves a darker rim below full opacity. Hit-testing
therefore always tests the stroke too (docs/03 §2.6 step 3).
- **Crisp edges** checkbox (§5) — default **on** for docs ≤ 128 px short side,
  else off (per-object after creation).

Rendering order: fill first, then outline. Outline is centre-aligned
(`ctx.lineWidth = stroke.width`, `lineJoin = 'round'`... **no** — use
`lineJoin: 'miter'`, `lineCap: 'butt'` for pixel work). Outline weight is in doc px
and does **not** rescale with the object (A4): the renderer must set the line width
*after* establishing the transform using
`ctx.lineWidth = stroke.width / avgScale` — instead, to keep exactness, build the
path in unit space, transform the path's points to doc space
(`worldFromLocal`) into a doc-space `Path2D`, and stroke with
`ctx.lineWidth = stroke.width` under the identity doc transform. **Implement this
doc-space-path approach for all shapes** — it makes stroke width uniform even for
stretched shapes and keeps hit-testing consistent. (Ellipse: approximate with 4
Béziers via the standard κ = 0.5522847498 construction before transforming.)

Alpha: apply `fill.alpha` / `stroke.alpha` via `ctx.globalAlpha` per pass (colour
stays `#RRGGBB`).

## 3. Hit-testing

In the renderer's coordinate world, per object top→bottom:

1. Build the doc-space `Path2D` (as in §2.3).
2. Fill hit: `ctx.isPointInPath(path, x, y)` when fill enabled.
3. Outline hit: `ctx.lineWidth = max(stroke.width, 6 / zoom)` (fat finger margin)
   then `ctx.isPointInStroke(path, x, y)` when stroke enabled.
4. Text objects: hit = point inside the rotated layout box (use `localFromWorld`,
   check `0≤x≤1 && 0≤y≤1`).

First hit wins; none → marquee. Use a dedicated 1×1 hidden canvas context for
hit-testing (never the visible one mid-frame).

## 4. Spline maths — `core/shapes/spline.ts` (reference implementation)

Uniform Catmull-Rom through `P₀…Pₙ₋₁` (n ≥ 2), endpoint-clamped by duplication,
converted to cubic Béziers for `Path2D`:

```ts
export function catmullRomToBezier(pts: Vec2[]): { c1: Vec2; c2: Vec2; to: Vec2 }[] {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[0];
    const p1 = pts[i], p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[pts.length - 1];
    segs.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    });
  }
  return segs;
}
```

n = 2 degenerates to a straight segment — correct. Unit-test: symmetric inputs give
symmetric control points; a colinear point set yields colinear controls.

## 5. Crisp mode — `core/raster/crisp.ts`

Canvas 2D always anti-aliases paths and text; Minecraft textures usually need hard
pixels. `crisp: true` objects render through:

1. Draw the object (doc-space path or text) onto a transparent doc-sized offscreen.
2. `getImageData` → for every pixel: `a' = a ≥ 128 ? 255 : 0`; when `a' = 255`
   **re-saturate colour**: because AA edge pixels have blended colour toward
   transparency, set RGB to the object's own fill/stroke colour (single-colour
   passes: run the threshold separately for the fill pass and the outline pass so
   each keeps its exact colour).
3. Cache the result per `(itemId, contentVersion)`; invalidate on any property
   change. The compositor draws the cached canvas.

Result: every rendered pixel is exactly the chosen colour at exactly the chosen
opacity — pixel-art-safe shapes and text.

## 6. Text objects

### 6.1 Model

See `TextObject` [01 §3]. `transform.w` is the wrap width; height is derived from
the line count and kept mirrored into `transform.h` after every edit (rotation
pivots at the box centre).

### 6.2 Fonts

- **Bundled** (OFL, installed as `@fontsource/*` packages and preloaded via
  `document.fonts.load` before the first text render): **Silkscreen** (the default —
  closest of the three to Minecraft's proportional pixel font and legible at 8px),
  **Press Start 2P**, **VT323**.
  (Corrected 2026-08-09: the original list named **Monocraft** as default, but it is not
  published on npm and the build environment cannot fetch font binaries from GitHub. Adding
  it later is one `@font-face` plus one entry in `src/ui/fonts.ts`.)
- **Generic**: `sans-serif`, `serif`, `monospace`.
- Stretch (Chromium): "Use system fonts…" button → `queryLocalFonts()` populates
  the dropdown; feature is hidden when the API is missing. Not required for done.

### 6.3 Creating & editing

- Text tool: click on canvas → creates a `TextObject` at the click (default: font
  Monocraft, size = clamp(docShortSide/8, 8, 32) px, colour = active colour,
  align left, w = 40 % of doc width) and enters **edit mode**.
- Edit mode = an absolutely-positioned `<textarea>` overlay, transformed with CSS
  to exactly cover the object's box (`translate(...) rotate(...) scale(zoom)`),
  styled with the same font/size/line-height, transparent background, no border,
  caret visible; the canvas render of that object is suppressed while editing.
  Commit on outside-click or `Esc` (empty text ⇒ the object is removed);
  double-click an existing text object (select tool) re-enters edit mode.
- Options panel (visible whenever a text object is selected/edited): font family
  dropdown, size 4–256 px, **B / I / U** toggles, align left/centre/right, colour +
  opacity, rotation 0–360°, crisp checkbox.

### 6.4 Rendering — `core/text/…` + engine

- Split on `\n`; `lineHeight = ceil(sizePx * 1.25)`.
- Font string: `` `${italic?'italic ':''}${bold?'bold ':''}${sizePx}px "${fontFamily}"` ``.
- Layout box: width `w`; each line x-offset by align (left 0, centre
  `(w−lineW)/2`, right `w−lineW`) with `lineW = ctx.measureText(line).width`;
  baseline of line k at `y = k*lineHeight + ascent`, `ascent =
  round(sizePx * 0.8)` (fixed ratio — stable across browsers; do **not** rely on
  `fontBoundingBoxAscent`).
- `h = lines.length * lineHeight` → mirror into `transform.h`.
- **Underline**: per line, a filled rect from the line's x-offset spanning `lineW`,
  at `y = baseline + max(2, round(sizePx/8))`, thickness
  `max(1, round(sizePx/12))`.
- Draw into the object's doc-space box via the object matrix; `crisp` goes through
  §5 (threshold + colour re-saturation).
- No wrapping beyond explicit `\n` (Paint-3D-like); typing long lines grows `w`
  to fit while editing (mirror back on commit).

## 7. Acceptance

- All ten shapes create by drag, render with independent fill/outline
  colour+opacity and outline weight 1–64, rotate via handle **and** via a numeric
  0–360° field, scale from any of 8 handles with the opposite point fixed, and
  survive save/reload of `.monet` byte-identically.
- Shift-drag creates exact squares/circles; the circle tool constrains without
  Shift.
- A stretched pentagon (w=2h) has uniform outline thickness everywhere.
- Line endpoints and spline points are individually draggable; spline passes
  through every control point; `Alt`+click inserts/removes spline points.
- Arrow renders as the block arrow above; arrowhead as an open chevron whose
  stroke weight and colour obey the outline controls.
- Crisp mode: every non-transparent pixel of a crisp red circle is exactly
  `#FF0000` at the set opacity (unit test on the offscreen buffer).
- Text: multiline with alignment, B/I/U all visibly effective (incl. underline
  thickness rule), Monocraft renders by default, rotation works, editing overlay
  matches the rendered position at every zoom (E2E screenshot at 100 % and 800 %),
  moving text leaves raster strokes untouched (owner scenario).

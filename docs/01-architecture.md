# 01 — Architecture

## 1. Stack

| Concern | Choice | Notes |
| ------- | ------ | ----- |
| Build | **Vite** (latest major; tested with 7.x) | `npm create vite@latest . -- --template react-ts` in the repo root |
| UI | **React** 19 + **TypeScript** (strict) | Function components only |
| State | **Zustand** 5 | Small stores, no Redux ceremony |
| Rendering | **Canvas 2D** + `Uint8ClampedArray` pixel buffers | No WebGL, no OffscreenCanvas workers |
| Zip (jars, `.monet`) | **jszip** | |
| PDF | **pdf-lib** | |
| Small persistent KV | **idb-keyval** (IndexedDB) | tokens live in `localStorage`, big blobs in IndexedDB |
| PWA | **vite-plugin-pwa** | added in M12 |
| Unit tests | **Vitest** | all of `src/core` is DOM-free and tested |
| E2E | **Playwright** (chromium) | smoke tests per milestone |
| Lint | ESLint + Prettier (defaults) | |

Node ≥ 20 for development. No other runtime dependencies without a spec change.

## 2. Repository layout

```
monet/
  index.html  vite.config.ts  tsconfig.json  package.json
  public/                     app icons, favicon
  src/
    main.tsx  App.tsx
    app/                      Zustand stores (§7)
      docStore.ts  viewStore.ts  toolStore.ts  sourcesStore.ts  settingsStore.ts
    core/                     PURE logic — no DOM, no React, fully unit-tested
      model/types.ts          canonical data shapes (§3)
      model/document.ts       create/clone/flatten/hit helpers
      model/commands.ts       undo/redo command types (§6)
      raster/pixels.ts        buffer helpers, source-over, dirty rects (§5)
      raster/floodfill.ts     [02 §5]
      raster/stamp.ts         brush tip masks + stroke scratch [02]
      raster/transform.ts     rotate90/flip/resize resample [06]
      raster/crisp.ts         alpha thresholding [03 §5]
      color/convert.ts        hex↔rgba, rgb↔hsl [05 §2]
      color/palette.ts        default palette [09 §5]
      shapes/geometry.ts      unit-space geometry for all 10 shapes [03]
      shapes/spline.ts        Catmull-Rom → Bézier [03 §4]
      noise/fields.ts         the 13 noise fields [04]
      noise/apply.ts          brightness/hue application [04 §5]
      recolor/replace.ts      mode A [05 §3]
      recolor/tint.ts         mode B [05 §4]
      io/monetFile.ts         .monet read/write [07 §8]
      io/ico.ts  io/bmp.ts    byte-level encoders [07 §5, §6]
      io/pdfExport.ts         [07 §7]
      io/exporters.ts         png/jpeg/webp via canvas [07 §3]
    engine/                   DOM-facing rendering & input
      renderer.ts             the compositor + rAF loop (§4)
      viewport.ts             zoom/pan maths [06 §6]
      pointerRouter.ts        pointer events → active tool
      layerCache.ts           RasterLayer id → HTMLCanvasElement cache (§4)
      overlay.ts              grid, marquee ants, handles, brush cursor
      themeColors.ts          cached CSS-variable chrome colours [09 §9]
    tools/                    one module per tool, common Tool interface (§8)
      select.ts pen.ts marker.ts eraser.ts bucket.ts eyedropper.ts
      shapeTool.ts textTool.ts panTool.ts
    integrations/
      github/api.ts           typed REST wrapper [08 §4]
      github/repoSource.ts    connect/browse/save/sync [08 §5–7]
      jar/jarSource.ts        jszip parsing, asset tree [08 §2]
      fsa/folderSource.ts     File System Access source [08 §3]
      idb.ts                  idb-keyval wrappers, autosave [07 §9]
    ui/                       React components; no business logic
      TopBar.tsx  Toolbar.tsx  FeatureTabs.tsx  OptionsPanel/…  SourcesSidebar/…
      StatusBar.tsx  ColorPanel.tsx  dialogs/…  theme.css
  tests/                      Vitest specs + golden files
  docs/                       this spec
```

**Dependency rule:** `core` imports nothing from `engine`/`ui`/`tools`. `tools` and
`engine` import `core`. `ui` imports stores and dispatches actions. This keeps every
algorithm testable in Node without a browser.

## 3. The document model (hybrid raster/vector stack)

Canonical types — `src/core/model/types.ts`. All other docs refer to these.

```ts
export type Hex = string;                 // '#RRGGBB' (alpha carried separately 0–1)

export interface Transform {
  cx: number; cy: number;                 // centre, doc-space px (float)
  w: number; h: number;                   // unrotated size, doc-space px (>0)
  rotation: number;                       // degrees, 0–360, clockwise
  flipX: boolean; flipY: boolean;
}

export interface FillStyle   { enabled: boolean; color: Hex; alpha: number; }        // alpha 0–1
export interface StrokeStyle { enabled: boolean; color: Hex; alpha: number; width: number; } // px ≥1

export type ShapeType =
  | 'triangle' | 'rectangle' | 'pentagon' | 'hexagon' | 'circle' | 'ellipse'
  | 'arrow' | 'arrowhead' | 'line' | 'spline';

export interface RasterLayer {
  kind: 'raster'; id: number;
  pixels: Uint8ClampedArray;              // width*height*4, RGBA, doc-sized, source of truth
}

export interface ShapeObject {
  kind: 'shape'; id: number;
  shape: ShapeType;
  transform: Transform;
  fill: FillStyle; stroke: StrokeStyle;
  points?: { x: number; y: number }[];    // line/spline/arrowhead: unit space [0..1]²
  crisp: boolean;                         // threshold alpha on render [03 §5]
}

export interface TextObject {
  kind: 'text'; id: number;
  transform: Transform;                   // w = wrap width; h = derived, kept in sync
  text: string;                           // '\n' separated
  fontFamily: string; sizePx: number;
  bold: boolean; italic: boolean; underline: boolean;
  align: 'left' | 'center' | 'right';
  color: Hex; alpha: number;
  crisp: boolean;
}

export type Item = RasterLayer | ShapeObject | TextObject;

export interface Background { mode: 'transparent' | 'color'; color: Hex; } // color persists across mode toggles

export interface SourceBinding {                    // where Ctrl+S goes [08]
  sourceId: string;                                 // key into sourcesStore
  path: string;                                     // repo/folder-relative PNG path
}

export interface MonetDoc {
  id: string; name: string;
  width: number; height: number;                    // 1–4096
  background: Background;
  stack: Item[];                                    // index 0 = bottom
  nextItemId: number;
  binding?: SourceBinding;
  dirty: boolean;
}
```

`RasterLayer.pixels` is the **only** source of truth for raster content. Canvases are
render caches (§4). Never mutate `pixels` without going through a command (§6).

### 3.1 The auto-layering rule (D4)

There is no layers UI. The stack is managed by two rules:

- **Rule 1 — brush target.** When a brush stroke (pen/marker) or bucket fill begins:
  if the **topmost item** of the stack is a `RasterLayer`, paint into it; otherwise
  **push a new transparent RasterLayer on top** and paint into that.
- **Rule 2 — objects float.** Adding a shape or text pushes the object on top of the
  stack. Selecting/moving/editing an object never reorders or alters raster layers.

The eraser is the exception to Rule 1: it edits **every** RasterLayer in the stack
(A2), so erasing feels like erasing "the picture", while objects survive.

**Why this satisfies the owner's scenario:**
1. Draw background → stack `[R1]` (Rule 1 creates R1).
2. Add text → `[R1, T2]`.
3. Draw on top of the text → top item is T2 (not raster) → Rule 1 creates R3 →
   `[R1, T2, R3]`. The strokes visually cover the text.
4. Move the text → only `T2.transform` changes → `[R1, T2, R3]` unchanged. The
   strokes stay exactly where they were **and** stay above the text. ∎

This scenario is a mandatory E2E test (10 §M6).

### 3.2 Adjustments and flattening

Noise [04] and recolour [05] are per-pixel maps applied to **each RasterLayer
independently** (A2). They cannot see or change objects. The **Flatten** command
(Edit menu) rasterises the whole stack (objects included, via the compositor at 1:1)
into a single RasterLayer — users run it when they want noise/recolour/eraser to
affect text or shapes. When any objects exist and a bake is requested, show an info
line in the panel: *"Shapes & text are not affected — Flatten first to include them."*

## 4. Rendering pipeline

One visible `<canvas>` fills the workspace. `engine/renderer.ts` owns a
`requestAnimationFrame` loop gated by an `invalidate()` flag — **draw only when
something changed** (state mutation, pointer move with a tool, view change).

Per frame, with `view = { zoom, panX, panY }` (§ [06 §6]) and DPR handled by sizing
the canvas backing store to `cssSize × devicePixelRatio`:

1. Clear; paint the **workspace surround** — the themed `--surround`, read through
   `engine/themeColors.ts` rather than as a literal [09 §9].
2. Compute the doc→screen transform; `ctx.imageSmoothingEnabled = false` (always —
   nearest-neighbour at every zoom).
3. **Checkerboard** for transparency, screen-space 8-px squares (`#ffffff`/`#d4d4d4`),
   clipped to the document rect (skip when background mode is `color`). The squares are
   deliberately light: the pixel grid (§7, `rgba(128,128,128,0.35)`) is invisible against a
   mid-grey checker, and reading pixel boundaries over transparency is exactly what the grid
   is for. (Corrected 2026-08-09 after seeing it on screen; matches Photoshop's default.)
4. Background colour rect when `background.mode === 'color'`.
5. **Stack, bottom→top**:
   - `RasterLayer` → `drawImage(layerCache.get(id))`. `layerCache` keeps one
     offscreen canvas per layer; when a command touches pixels it calls
     `layerCache.patch(id, dirtyRect)` which does a single `putImageData` of that
     rect from `pixels`.
   - In-progress stroke: the active tool exposes a *scratch overlay* per [02 §3];
     the renderer draws it immediately after (pen/marker) or applies it as a mask
     while drawing each layer (eraser preview) — exact contract in [02 §3.4].
   - `ShapeObject`/`TextObject` → set the object's matrix (§4.1), build its
     `Path2D`/text and fill/stroke it. `crisp` objects render via
     `raster/crisp.ts`: draw to a doc-sized offscreen, threshold alpha at 128,
     cache by `(id, contentVersion)`, then `drawImage`.
   - When a **noise/recolour preview** is live, raster layers are drawn from the
     preview buffers instead ([04 §6], [05 §5]).
6. **Floating selection** pixels, if any [06 §4].
7. Reset transform; draw **overlays** in screen space: pixel grid (zoom ≥ 8), marquee
   ants, object handles, brush tip outline at the cursor, text caret box.
8. **Tiling preview mode** replaces steps 3–6 with the composite drawn 3×3 around the
   origin tile [06 §7].

Export composition = steps 3–6 onto a `width × height` offscreen at zoom 1 with the
checkerboard omitted (transparent stays transparent) and floating selection drawn at
its current position.

### 4.1 Object matrix

Local space is the unit square `[0,1]²`. World (doc) transform, applied via
`ctx.setTransform` composed **translate(cx,cy) · rotateCW(rotation) ·
scale(w·(flipX?-1:1), h·(flipY?-1:1)) · translate(-0.5,-0.5)`. The same matrix
(inverted) maps pointer positions into local space for hit-tests and handle drags —
implement `worldFromLocal(t, p)` / `localFromWorld(t, p)` in `shapes/geometry.ts`
with plain trig (no DOMMatrix — keep it testable):

```ts
export function worldFromLocal(t: Transform, p: Vec2): Vec2 {
  const lx = (p.x - 0.5) * t.w * (t.flipX ? -1 : 1);
  const ly = (p.y - 0.5) * t.h * (t.flipY ? -1 : 1);
  const r = (t.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: t.cx + lx * c - ly * s, y: t.cy + lx * s + ly * c };
}
export function localFromWorld(t: Transform, p: Vec2): Vec2 {
  const dx = p.x - t.cx, dy = p.y - t.cy;
  const r = (-t.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  let lx = dx * c - dy * s, ly = dx * s + dy * c;
  lx /= t.w * (t.flipX ? -1 : 1); ly /= t.h * (t.flipY ? -1 : 1);
  return { x: lx + 0.5, y: ly + 0.5 };
}
```

## 5. Pixel buffer utilities — `core/raster/pixels.ts` (reference implementation)

All raster maths is done on un-premultiplied RGBA `Uint8ClampedArray`s. Never
round-trip pixels through `getImageData` repeatedly (premultiplication rounding
destroys low-alpha colour); read from `pixels`, write to `pixels`, then patch the
cache.

```ts
export interface Rect { x: number; y: number; w: number; h: number; } // ints, doc space

export const idx = (x: number, y: number, width: number) => (y * width + x) * 4;

/** Un-premultiplied source-over: composite src pixel onto dst buffer at i. */
export function blendOver(dst: Uint8ClampedArray, i: number,
                          sr: number, sg: number, sb: number, sa: number /*0–1*/): void {
  if (sa <= 0) return;
  const da = dst[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { dst[i] = dst[i+1] = dst[i+2] = dst[i+3] = 0; return; }
  dst[i]     = Math.round((sr * sa + dst[i]     * da * (1 - sa)) / oa);
  dst[i + 1] = Math.round((sg * sa + dst[i + 1] * da * (1 - sa)) / oa);
  dst[i + 2] = Math.round((sb * sa + dst[i + 2] * da * (1 - sa)) / oa);
  dst[i + 3] = Math.round(oa * 255);
}

export function copyRect(src: Uint8ClampedArray, srcW: number, r: Rect): Uint8ClampedArray;
export function pasteRect(dst: Uint8ClampedArray, dstW: number, r: Rect, data: Uint8ClampedArray): void;
export function clampRect(r: Rect, width: number, height: number): Rect; // intersect with doc
export function unionRect(a: Rect | null, b: Rect): Rect;
```

(`copyRect`/`pasteRect` are straightforward row loops — implement and unit-test
round-tripping.)

## 6. Undo / redo — `core/model/commands.ts`

Command pattern; **every** document mutation goes through
`docStore.execute(command)`. History per document, capped at **200** entries
(drop oldest).

```ts
export interface Command {
  label: string;                 // 'Pixel pen', 'Move text', 'Resize canvas', …
  do(doc: MonetDoc): void;       // apply (also used for redo)
  undo(doc: MonetDoc): void;
}
```

Concrete commands and what they capture:

| Command | Captured state |
| ------- | -------------- |
| `StrokeCommand` (pen/marker/bucket/eraser/noise-bake/recolour-bake/selection ops) | per touched layer: `{layerId, rect, before, after}` pixel crops (`copyRect`) |
| `AddItemCommand` / `RemoveItemsCommand` | the item JSON + stack index |
| `UpdateItemCommand` (move/resize/rotate/style/text edit) | before/after JSON of the item; **drags coalesce** into one command committed on pointer-up |
| `CanvasResizeCommand`, `RotateCanvasCommand`, `FlipCanvasCommand` | full before/after document snapshot (cheap at these sizes) |
| `BackgroundCommand` | before/after `Background` |
| `FlattenCommand` | before stack (JSON + pixel buffers) / after layer |
| `FloatCommand` / `AnchorCommand` (selection lift/drop) | selection state + affected layer rects |

Eraser strokes touch many layers → `StrokeCommand` holds an array of per-layer
patches. Undo/redo must also restore `dirty`, patch `layerCache`, and `invalidate()`.

Shortcuts: `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo. History survives tab
switches (it lives in the store), not reloads.

## 7. Zustand stores (state shapes)

```ts
// docStore
{ docs: Record<string, MonetDoc>, order: string[], activeId: string | null,
  histories: Record<string, { undo: Command[]; redo: Command[] }>,
  selection: SelectionState | null,            // [06 §4]
  execute(cmd), undo(), redo(), newDoc(), openDoc(), closeDoc(), setActive() }

// viewStore  (per active doc; keyed map docId → view)
{ zoom: number, panX: number, panY: number, grid: 'auto'|'on'|'off',
  tiling: boolean, zoomAt(screenPt, factor), fit(), setPan() }

// toolStore
{ active: ToolId, perTool: { pen: {size, tip}, marker: {size, tip},
  eraser: {size, tip}, bucket: {tolerancePct}, shape: {type, fill, stroke, crisp},
  text: {…defaults}, noise: NoisePanelState, recolor: RecolorPanelState },
  color: { hex: Hex, alpha: number }, swatches: Hex[], recent: Hex[] }

// sourcesStore   [08]
{ sources: SourceEntry[], addJar(), addFolder(), addRepo(), remove(), refresh() }

// settingsStore  (persisted via idb-keyval; token in localStorage)
{ lastDocSize, palette customs, defaultExport, pdfPageSize: 'A4',
  theme: 'system'|'light'|'dark' [09 §9], githubToken? }
```

## 8. Tool interface — `tools/`

```ts
export interface Tool {
  id: ToolId;
  cursor: string;                              // CSS cursor; brushes use 'crosshair' [09 §8]
  onPointerDown(e: ToolPointerEvent): void;    // e has doc-space float coords, buttons, mods
  onPointerMove(e: ToolPointerEvent): void;
  onPointerUp(e: ToolPointerEvent): void;
  onKey?(e: KeyboardEvent): void;              // e.g. Esc/Enter for spline & text
  drawOverlay?(ctx: CanvasRenderingContext2D, view: View): void; // screen space
  deactivate?(): void;                         // commit pending state on tool switch
}
```

`engine/pointerRouter.ts` converts DOM pointer events (with pointer capture) into
doc-space events, routes `Alt`+click to the eyedropper regardless of active brush,
and space-bar-hold to the pan tool.

## 9. Persistence map

| Data | Where | Doc |
| ---- | ----- | --- |
| `.monet` project files | user's disk / repo | [07 §8] |
| Autosave snapshots (30 s, per dirty doc) | IndexedDB `autosave:<docId>` | [07 §9] |
| Jar bytes, folder handles, repo metadata | IndexedDB | [08] |
| GitHub PAT | `localStorage` `monet.github.token` | [08 §4] |
| Settings, custom swatches, recents | IndexedDB `settings` | [09] |

## 10. Acceptance (architecture milestone gates)

- `npm test` runs `core/**` suites in Node with zero DOM shims beyond `ImageData`
  polyfill-free code (canvases only in `engine`).
- Compositor renders a 3-item stack (raster, text, raster) correctly vs. a golden
  PNG at zoom 1 (Playwright screenshot compare, tolerance 0).
- The §3.1 scenario passes as an automated E2E test.
- 200-step undo across mixed command types leaves the document byte-identical to a
  recorded snapshot (deep-equal on JSON + pixel buffers).

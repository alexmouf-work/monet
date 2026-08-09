# Monet — architecture (as built)

Rule (CLAUDE.md): this file maps what **exists on `main`**, overview first, details after.
Update it in the same commit as any architecture-affecting change. The *target* design is the
numbered spec (`docs/00`–`docs/10`) — do not duplicate it here; describe reality and point.

## State: v1 complete (2026-08-09, M0–M12)

Every feature in `docs/00 §3` is implemented and exercised in a real browser. 101 unit tests
over `src/core`; behaviour verified by harness scenarios (below).

## Tree

```
CLAUDE.md  README.md  docs/            charter, public docs, spec + live state
index.html                             SPA entry (inline SVG favicon)
package.json  tsconfig.json            deps per docs/01 §1 + @fontsource/*, vite-plugin-pwa
vite.config.ts                         app build, base './', PWA manifest + workbox
vitest.config.ts                       unit tests, node env, plugin-free (note below)
eslint.config.js .prettierrc.json      lint/format
playwright.config.ts                   e2e (build + preview on :4173)
public/icon-{192,512}.png              app icons (generated)
.github/workflows/ci.yml               format → lint → typecheck → test → build
vercel.json                            Vercel preset, output dist/, PWA cache headers

src/core/                              PURE: no DOM, no React, all unit-tested
  model/{types,document,commands}.ts   canonical shapes, auto-layering, undo commands
  raster/{pixels,stamp,floodfill,transform,crisp}.ts
  color/{convert,palette}.ts           HSL/HSV/hex, MS-Paint 20
  shapes/{geometry,spline,transformOps}.ts  contours, Catmull-Rom, handle scaling
  noise/{fields,apply}.ts              13 fields from one hash, brightness/hue apply
  recolor/{replace,tint}.ts
  io/{monetFile,ico,bmp,pdfFit,pdfExport}.ts

src/engine/                            DOM-facing rendering
  renderer.ts                          rAF loop gated on invalidate; surround, checker,
                                       grid, 3×3 tiling, overlays
  compose.ts                           the compositor (shared by viewport, export, flatten)
  layerCache.ts                        layer id → canvas cache + imageDataFrom
  drawObjects.ts paths.ts textLayout.ts objectChrome.ts hitTest.ts
  viewport.ts exporters.ts
  themeColors.ts                       cached --surround/--accent for canvas chrome

src/tools/                             one module per tool over a common interface
  registry.ts index.ts types.ts        registration; unknown ids degrade to a no-op
  strokeEngine.ts brushTools.ts bucketTool.ts eyedropperTool.ts
  selectTool.ts marquee.ts shapeTool.ts textTool.ts panTool.ts

src/app/                               stores + action layer
  docStore viewStore toolStore settingsStore    zustand
  bus.ts                               invalidate + toast fan-out
  fileActions exportActions editActions selectionActions canvasActions
  adjustSession.ts                     shared preview/bake for noise + recolour
  themeMode.ts                         system|light|dark, data-theme stamping
  autosave.ts debugBridge.ts

src/integrations/
  sources.ts sourceSave.ts             provider façade + `.monet` mirror path
  github/{api,repoSource}.ts           REST wrapper; connect/browse/commit+push/sync
  jar/jarSource.ts                     jszip + IndexedDB cache, mcmeta badges
  fsa/{localFile,folderSource}.ts      pickers with download fallback; folder source
  idb.ts                               idb-keyval wrappers + autosave store

src/ui/                                React; no business logic
  App.tsx TopBar Toolbar AppMenu DocTabs Workspace StatusBar OptionsPanel ColorPanel
  SourcesSidebar TextEditOverlay UpdatePrompt sceneHooks useShortcuts fonts theme.css
  panels/{Brushes,Shapes,Text,Canvas,Noise,Recolour}Panel.tsx
  controls/{Slider,ColorField}.tsx
  dialogs/{Dialog,NewDoc,Resize,Export,SaveAs,ConnectRepo,Sync,Settings,Recover,Confirm,Shortcuts}

tests/                                 vitest specs; manual/ = the GUI harness
```

## The GUI harness (owner request 2026-08-09)

`tests/manual/harness.{mjs,sh}` runs Vite's dev server, a real browser and a scenario in one
process; it screenshots each step, builds a **contact sheet** of the whole flow, and reads app
state back through `src/app/debugBridge.ts` (`window.__monet`: doc, stack, stores, `countColor`,
`pixelAt`). `npm run harness`; usage in `tests/manual/README.md`. `--headed` wraps the run in
`xvfb-run`. Scenarios assert on real pixels and store values, not on screenshots.

Scenarios: `smoke` · `full` · `layering` (the owner's scenario) · `text` · `selection` ·
`canvas` · `noise` · `recolour` · `export` · `save` · `sources` (GitHub against a mocked API) ·
`theme` (toolbar wiring, brush cursor, theme cycling + persistence) · `perf` (frame and
handler costs).

`shot()` waits two `requestAnimationFrame`s before capturing. A full-page screenshot taken
immediately after a CSS-only change (a theme toggle) can otherwise return the *previous*
compositor frame — which reads as "the feature is broken" when it is not (seen 2026-08-09).

CI runs unit tests + build, not the harness or Playwright (no browser in the runner).

## Hosting (Vercel, owner decision 2026-08-09)

Deploys come from Vercel's Git integration — push to `main` ships production, every other
branch gets a preview URL — so there is no deploy workflow in `.github/`. `vercel.json` pins
the Vite preset and output directory and sets PWA-correct caching: hashed `/assets/*`
immutable for a year, but `sw.js`, `registerSW.js`, the workbox runtime, the manifest and
`index.html` `must-revalidate`, or an updated service worker could never be picked up.

`npm run check:vercel` (in CI) validates `vercel.json` with Vercel's own route parser
(`@vercel/routing-utils`). `source` is **path-to-regexp, not raw regex** — a nested group like
`/(a|b-(.*).js)` is rejected — and without the check that only shows up as a failed deploy,
which is how it was first found (2026-08-09).

**No catch-all rewrite on purpose.** Monet has no client-side routing, and `base: './'` keeps
asset URLs relative (so a build also works from a subpath or `file://`). Rewriting an unknown
nested path to `index.html` would make those relative URLs resolve against the wrong
directory, so unknown paths correctly 404 instead.

## Deviations from the spec's module list (docs/01 §2), with reasons

- **Canvas-backed exporters live in `engine/exporters.ts`**, not `core/io/exporters.ts`: they
  need a real canvas encoder and `core` must stay DOM-free. Byte-level writers (`.monet`, ICO,
  BMP, PDF fit) stay pure in `core/io`.
- **`core/raster/crisp.ts`** holds only the pure alpha-threshold pass; drawing to an offscreen
  lives in `engine/drawObjects.ts`.
- **`engine/textLayout.ts`** exists because layout needs `measureText`.
- **Tools register** through `tools/registry.ts` + `tools/index.ts` rather than a static map.
- **`vitest.config.ts` is separate** from `vite.config.ts`: vitest 2 bundles vite 5, whose
  `Plugin` type clashes with vite 6's. Legitimate because tests only cover `src/core`.
- **`integrations/sources.ts`** is a provider façade so `fileActions` never branches on
  jar/folder/repo.
- **`app/adjustSession.ts`** is shared preview/bake infrastructure the spec described twice
  (docs/04 §6 and docs/05 §5).
- **Fonts** are `@fontsource` packages (Silkscreen default), not Monocraft — docs/03 §6.2.
- **Checkerboard** lightened to `#ffffff`/`#d4d4d4` — docs/01 §4 step 3.
- **Brushes keep a visible `crosshair` cursor** instead of `cursor: none` — docs/09 §8, owner
  directive 2026-08-09. The tip outline is an addition to the pointer, not a replacement.
- **`ui/Toolbar.tsx` is a second chrome row** the spec's layout did not have — owner directive
  2026-08-09 ("as few clicks away as possible"). It duplicates ☰-menu actions rather than
  replacing them; docs/09 §1 updated.
- **Theming is real, not "polish out of scope"** — docs/09 §9. `app/themeMode.ts` owns the
  `data-theme` attribute and `engine/themeColors.ts` the renderer's cached copies. `themeMode`
  lives in `app/`, not `ui/`, because `app/settingsStore.ts` calls it and `app` must not import
  `ui` (the dependency rule in docs/01 §2).

## Performance rules (2026-08-09, after an owner lag report)

Measure with `npm run harness -- tests/manual/scenarios/perf.mjs`. It reports renderer frame
cost from `window.__monet.perf()` **and** synchronous handler cost from a tight loop of
synthetic `pointermove`s — Playwright's own mouse is paced far slower than a real 500–1000 Hz
mouse, so only the synthetic loop exposes per-event work. Frame timings measure CPU-side
submission, not GPU rasterisation.

- **`willReadFrequently` only on canvases we read back.** It requests a CPU-backed surface;
  on the visible canvas it costs GPU acceleration for every frame. `ctx2d` (readback) vs
  `ctx2dDraw` (draw-only, used for the on-screen canvas).
- **Per-event work must scale with the event, not with the document.** The stroke overlay
  uploads `pending` (touched since the last upload), not `dirty` (the whole stroke): the
  cumulative version cost 0.074→0.103 ms/event and rose as the stroke grew; it is now
  0.033→0.028 ms/event and flat.
- **Nothing samples the document by recompositing it.** `activeRenderer()?.compositeSnapshot()`
  lends this frame's composite, cached until the next content invalidation; eyedropper drag
  went 1.808 → 0.033 ms/event (300 events: 542 ms → 10 ms). Keep the `compositePixels`
  fallback — the renderer is absent in tests and before mount.
- **React's `wheel`/`touchstart`/`touchmove` root listeners are passive**, so `preventDefault`
  in an `onWheel` prop is ignored and the page scrolls while you zoom. Register wheel natively
  with `{ passive: false }`.
- **Pointer-rate notifications get coalesced to a frame** (`reportCursor` → one rAF), or a
  fast mouse renders React hundreds of times a second for a coordinate readout.
- **Always-mounted components use narrow selectors.** `useDocStore()` with no selector
  re-renders on every store change — for the toolbar that meant 21 buttons per pan event.
- Crisp mode reuses one scratch canvas (`drawObjects.scratch`); it runs one thresholded pass
  per colour per object per frame, so allocation there is per-frame allocation.

## Invariants worth knowing before editing

- **Zustand selectors must not allocate.** A fresh object or array per call breaks referential
  equality and re-renders forever (React error #185). Read stored values and apply defaults
  *outside* the selector.
- `RasterLayer.pixels` is the only truth for raster content; canvases in `layerCache` are
  caches, patched via `patchLayer` after every mutation.
- Every document mutation goes through `docStore.execute(cmd)`. Tools that mutate pixels
  directly build the command with a `before` snapshot, call `cmd.undo(doc)` to rewind, then
  `execute` it — so history and the live document can never disagree.
- ImageData construction goes through `layerCache.imageDataFrom` (one deliberate cast at the
  DOM boundary).
- `isTypingTarget` must match only real text entry: counting checkboxes and sliders as typing
  silently disables every keyboard shortcut.
- The async clipboard and the File System Access pickers can **hang rather than reject** — they
  wait on permission UI that may never appear. Race them against a timeout and keep a fallback.
- A lifted floating selection has already been cleared from its layers, so anything that ends a
  selection must **anchor** it, never discard it.
- Adjustment sessions must `resyncAdjust()` when the document changes underneath them, or
  previews outlive the pixels they were derived from.
- The text editing overlay commits on a real outside click, not on blur: the pointer-up that
  places the text moves focus to `<body>`, and committing there would delete it.
- **No chrome colour may exist only inside a `@media` or `[data-theme]` block.** Every token
  needs its base definition on bare `:root`, or one theme state renders unstyled.
- Anything the renderer paints from CSS goes through `themeColors()`; after changing the theme,
  call `refreshThemeColors()` and `invalidate()` or the canvas keeps the old surround until the
  next unrelated redraw.

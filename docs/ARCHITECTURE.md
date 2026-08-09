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

src/tools/                             one module per tool over a common interface
  registry.ts index.ts types.ts        registration; unknown ids degrade to a no-op
  strokeEngine.ts brushTools.ts bucketTool.ts eyedropperTool.ts
  selectTool.ts marquee.ts shapeTool.ts textTool.ts panTool.ts

src/app/                               stores + action layer
  docStore viewStore toolStore settingsStore    zustand
  bus.ts                               invalidate + toast fan-out
  fileActions exportActions editActions selectionActions canvasActions
  adjustSession.ts                     shared preview/bake for noise + recolour
  autosave.ts debugBridge.ts

src/integrations/
  sources.ts sourceSave.ts             provider façade + `.monet` mirror path
  github/{api,repoSource}.ts           REST wrapper; connect/browse/commit+push/sync
  jar/jarSource.ts                     jszip + IndexedDB cache, mcmeta badges
  fsa/{localFile,folderSource}.ts      pickers with download fallback; folder source
  idb.ts                               idb-keyval wrappers + autosave store

src/ui/                                React; no business logic
  App.tsx TopBar AppMenu DocTabs Workspace StatusBar OptionsPanel ColorPanel
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
`canvas` · `noise` · `recolour` · `export` · `save` · `sources` (GitHub against a mocked API).

CI runs unit tests + build, not the harness or Playwright (no browser in the runner).

## Hosting (Vercel, owner decision 2026-08-09)

Deploys come from Vercel's Git integration — push to `main` ships production, every other
branch gets a preview URL — so there is no deploy workflow in `.github/`. `vercel.json` pins
the Vite preset and output directory and sets PWA-correct caching: hashed `/assets/*`
immutable for a year, but `sw.js`, `registerSW.js`, the workbox runtime, the manifest and
`index.html` `must-revalidate`, or an updated service worker could never be picked up.

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

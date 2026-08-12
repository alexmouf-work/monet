# Monet — architecture (as built)

Rule (CLAUDE.md): this file maps what **exists on `main`**, overview first, details after.
Update it in the same commit as any architecture-affecting change. The *target* design is the
numbered spec (`docs/00`–`docs/10`) — do not duplicate it here; describe reality and point.

## State: v1 complete (2026-08-09, M0–M12), plus owner requests since

Every feature in `docs/00 §3` is implemented and exercised in a real browser. 193 unit tests
(`src/core` plus the pure GitHub OAuth helpers); behaviour verified by harness scenarios (below).

**3D model mode** (`docs/11-3d-model-mode.md`) is complete through M19a: M13 viewport, M14
face→texture + live link, M15 painting on the model, M16 modelling (element CRUD, numeric
properties, translate gizmo, vanilla validation), M17 UV editing (box-UV, per-face
rects/rotation/mirror, the UV tab over the live texture), M18 Onshape interaction (inference
snapping, measurement, depth cycling, context menus), M19 export/round-trip (source-merged Java
writer, Bedrock geometry, `.monet_model`, icon renders) and M19a display slots + preview.
Outstanding: M18's selection filters and multi-select transforms.

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
.github/workflows/ci.yml               manual only (workflow_dispatch) — note below
vercel.json                            Vercel preset, output dist/, PWA cache headers
.env.example                           optional GitHub App config (docs/GITHUB-APP.md)

api/github/token.ts                    THE only server-side code: GitHub App token exchange
                                       (Edge, stateless, holds the client secret)

src/core/                              PURE: no DOM, no React, all unit-tested
  model/{types,document,commands}.ts   canonical shapes, auto-layering, undo commands
  raster/{pixels,stamp,floodfill,transform,crisp}.ts
  color/{convert,palette}.ts           HSL/HSV/hex, MS-Paint 20
  shapes/{geometry,spline,transformOps}.ts  contours, Catmull-Rom, handle scaling
  noise/{fields,apply}.ts              13 fields from one hash, brightness/hue apply
  recolor/{replace,tint}.ts
  io/{monetFile,ico,bmp,pdfFit,pdfExport}.ts

src/core/model3d/                      PURE 3D: types, vec/mat4, orbit camera, java model
  {types,vec,camera,javaModel,vanillaParents,geometry,pick}.ts    parsing, mesh, ray picking
  commands.ts                          Add/Remove/PatchElement — snapshot-based, docStore.executeModel
  edit.ts validate.ts expr.ts          newCube/duplicate/mirror; vanilla legality; field arithmetic
  javaModelWriter.ts                   vanilla JSON out, MERGED OVER the source file: parent +
                                       unknown keys survive; inherited geometry stays inherited
  bedrockWriter.ts                     .geo.json 1.12.0 — mirrored x, pixel uvs, negated y/z spin
  monetModelFile.ts                    .monet_model zip: manifest + model + camera (no pixels)
  uv.ts                                box-UV cross, mirror = endpoint swap, fit = vanilla projection
  infer.ts                             alignment inference on a drag axis; box gaps (measurement)
  display.ts                           display slots → model matrix + vanilla per-slot defaults

src/engine3d/glRenderer.ts             raw WebGL2 viewport (D11.1): mesh+line programs,
                                       NEAREST textures, frontFace(CW), context-loss rebuild

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
  modelPaint.ts                        3D→2D paint routing: FaceHit → texel → stroke engine;
                                       per-face segmentation, background doc creation

src/app/                               stores + action layer
  docStore viewStore toolStore settingsStore    zustand
  bus.ts                               invalidate + toast fan-out
  fileActions exportActions editActions selectionActions canvasActions
  adjustSession.ts                     shared preview/bake for noise + recolour
  themeMode.ts                         system|light|dark, data-theme stamping
  modelActions.ts                      open/new/save models; per-doc texture pixel store;
                                       face→texture opening (uv-rect selection, region extract)
  modelTextureSync.ts                  the live 2-way link: open image docs ARE their textures
  modelEditActions.ts                  add/duplicate/delete/mirror/face-off — panel, keys and
                                       context menu share one undoable route per edit
  modelExportActions.ts                java / bedrock / .monet_model / render-to-PNG downloads
  modelViewState.ts overlayRegistry.ts leaf modules: hover/renderer registry, overlay painters,
                                       live gizmo-drag readout, previewed display slot
  launchFiles.ts                       OS "open with" launches → docs bound to their handles
  installPrompt.ts                     beforeinstallprompt capture (installing enables that)
  autosave.ts debugBridge.ts

src/integrations/
  sources.ts sourceSave.ts             provider façade + `.monet` mirror path
  github/{api,repoSource}.ts           REST wrapper; connect/browse/commit+push/sync
  github/{oauth,auth}.ts               sign-in: pure flow helpers + session/refresh/installations
  jar/jarSource.ts                     jszip + IndexedDB cache, mcmeta badges
  fsa/{localFile,folderSource}.ts      pickers with download fallback; folder source
  idb.ts                               idb-keyval wrappers + autosave store

src/ui/                                React; no business logic
  App.tsx TopBar Toolbar AppMenu DocTabs Workspace StatusBar OptionsPanel ColorPanel
  GithubAccount.tsx                    sign-in / signed-in block, shared by two dialogs
  ModelWorkspace.tsx                   3D workspace: renderer lifecycle, Onshape navigation,
                                       hover picking, translate gizmo, DOM view cube;
                                       panels/{Model,UV}Panel.tsx (outliner + numeric properties;
                                       uv rects over the live texture), controls/NumField.tsx
  InstallBanner.tsx                    install offer; its pitch is the file association
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
handler costs) · `eyedropper-shapes-clipboard` (the three 2026-08-09 owner requests) ·
`github-login` (the App sign-in flow against a mocked GitHub) · `file-handler` (an OS launch,
with fake handles that record what gets written back) · `model3d` (M13 acceptance against a
fixture jar with a real parent chain) · `model3d-face` (M14: face→texture triggers, uv-rect
selection, the live 2-way link, uv guides) · `model3d-paint` (M15: brushes on the model, stroke
segmentation, cross-history undo order) · `model3d-edit` (M16: the stool build — fields,
duplicate/mirror, gizmo snapping, vanillaMode, JSON save) · `model3d-uv` (M17: box-UV on a
64×32 sheet, fill-lands-in-rect, face editors, rect dragging) · `model3d-snap` (M18: fractional
inference alignment, measurement, depth cycling, context menus) · `model3d-export` (M19: clean
Java round-trip, Bedrock conversion, project zip, icon render) · `model3d-display` (M19a: slot
preview matrices, paused editing, slot edit → saved JSON). Fixture jars are built fresh each run by
`tests/manual/fixtures/jar.mjs` (Node-side zip + hand-rolled PNG encoder) — nothing depends on
leftover /tmp files. The harness launches Chromium with swiftshader flags so WebGL2 works
headless.

`shot()` waits two `requestAnimationFrame`s before capturing. A full-page screenshot taken
immediately after a CSS-only change (a theme toggle) can otherwise return the *previous*
compositor frame — which reads as "the feature is broken" when it is not (seen 2026-08-09).

**CI is `workflow_dispatch` only** (owner directive 2026-08-09: Actions storage full). Nothing
in `.github/` deploys — Vercel's Git integration does — and the same gates run locally before
each commit, so the workflow existed only to repeat them. `cache: npm` was dropped with it: each
run wrote a fresh cache entry. Run it from the Actions tab for a clean-room check. It would not
run the harness or Playwright anyway (no browser in the runner).

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

## GitHub App sign-in (2026-08-10, owner request)

Monet is a GitHub App; users sign in and Monet acts **as them** on the repositories they install
it on. Spec: docs/08 §4.1. Owner setup: docs/GITHUB-APP.md.

`api/github/token.ts` is the whole server side and exists only because GitHub leaves no choice:
the `code`→token exchange needs the App's client secret (cannot be in a bundle) and
`github.com/login/oauth/access_token` sends **no CORS headers**, so a browser cannot call it even
as a public client — GitHub supports neither PKCE nor any browser-only flow. The function is
stateless, keeps nothing, allowlists origins, and returns only token fields.

- `oauth.ts` is pure (authorize URL, state, expiry arithmetic, stored-session validation) and
  unit-tested; `auth.ts` holds the session, refreshes single-flight ~5 min before expiry, and
  reads installations. `api.ts` just asks `authToken()` and never learns which credential it got.
- **Unconfigured is a supported state**: no `VITE_GITHUB_CLIENT_ID` ⇒ no sign-in button, PAT only.
  That is what `npm run dev` and any static self-host see, so neither regressed.
- A stale-write hazard worth remembering: anything that reads the session, awaits, then writes it
  back can discard a token refreshed while it waited (`refreshIdentity` did exactly that until the
  harness log showed the old token stored behind the new one). Merge via `patchSession`, which
  re-reads at write time.

## Opening files from the OS (2026-08-10, owner request)

Spec: docs/07 §10. Manifest `file_handlers` + `window.launchQueue`; Windows Explorer's
"Open with → Monet" works once the PWA is **installed**, which is why there is now an install
banner at all. Because the launch delivers `FileSystemFileHandle`s, an opened file is bound to its
handle and `Ctrl+S` overwrites it in place with no dialog.

Three things that bite here:

- `launchQueue.setConsumer` must be called **before any await** in boot (the queue holds a launch
  only until a consumer exists) and **once** — StrictMode's double mount opened every file twice
  until `startFileHandling` became idempotent.
- The handler `action` has to be a served URL. With no catch-all rewrite, anything but `/` would
  404 on launch; `prodboot.mjs` fetches each action to keep that honest.
- `beforeinstallprompt` fires once and the event is single-use: capture it, `preventDefault`, keep
  it, and drop it after `prompt()` — hence `installPrompt.ts` rather than inline component state.

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
- Geometry of one colour that overlaps itself must be composited **once** (`singlePass`, or a
  single crisp pass). Two passes double-blend the overlap, which shows as a darker seam at any
  alpha below 1.
- **Registries that get written during module evaluation live in LEAF modules** (zero runtime
  imports — `app/overlayRegistry`, `app/modelViewState`). Tools register overlay painters at
  module-eval time from inside the sceneHooks→tools import cycle; a registry declared in a
  cycling module hits its own TDZ and takes the whole boot down.
- **Never `loseContext()` on a canvas another renderer may reuse.** A canvas keeps its one WebGL
  context forever; StrictMode's double mount made the second renderer compile shaders into a
  permanently lost context (null info logs — maddening). Dispose deletes GL objects instead.
- 3D model docs live in `docStore.models`, parallel to `docs` and sharing order/activeId;
  `active()` returns null for them so every 2D consumer degrades to its no-document state
  unchanged. Both workspaces stay mounted; CSS hides the inactive one (`.workspace-slot`), so
  selector-driven code must target `.workspace:not(.workspace--model)` for the 2D canvas.
- 3D strokes commit through `executeOn(docId, cmd)` — `execute()` targets the ACTIVE document,
  which is the model while painting in 3D, and would silently drop the command. Stroke
  segmentation identity is the target DOCUMENT, never the texture variable: a cube's six vars
  usually resolve to one file.
- With a model active, edits span TWO histories (its geometry, the texture last painted from
  3D). Every command gets a global `seq` stamp at execute time; Ctrl+Z/Y and the toolbar go
  through `undoNewest`/`redoNewest`, which compare top-of-stack stamps — preferring either
  history unconditionally undoes the wrong thing or goes dead when that stack empties.
- Model geometry mutations go through `executeModel` + `ModelCommand` snapshots (never live
  references — the commands test proves later edits cannot corrupt history). The gizmo applies
  its drag live but REWINDS to the grab-time snapshot before committing one PatchElementCommand,
  the same rewind-then-execute pattern strokes use.
- A click on the SELECTED element's gizmo arm grabs the gizmo, not the element — correct, but it
  means viewport click tests must aim away from the arms (they reach 7 units from the centre).
- Model undo/redo drops a stale element selection: undoing an Add otherwise leaves the gizmo and
  panel pointing at an element that no longer exists.
- A model document's `raw` (its source file's own JSON) and `baseline` (element signature at load)
  are the round-trip contract — never rebuild a save from the resolved/flattened model alone, or
  `parent`, mod keys and inherited geometry are silently rewritten.
- The 3D canvas is `alpha: true` with straight alpha, and normal frames clear opaque; only
  render-to-PNG clears transparent, through a scene filter that also drops grid/gizmo/selection.
  An export must be the model, not a screenshot of the editor.
- `Ctrl+S`/`Ctrl+Shift+S`/`Ctrl+Shift+E` are the only chords allowed to fire while a text or
  numeric field has focus: no field claims them, and suppressing them made saving after typing a
  value do nothing at all.
- Minecraft's `display` slots are `[x, y, z]` ARRAYS on disk and vectors in memory; convert at
  both ends (`javaModel` in, `javaModelWriter` out). Writing the in-memory shape produces a file
  Minecraft cannot read.
- Previewing a display slot transforms only the MESH, so the CPU pick geometry no longer matches
  the screen: picking, painting and the gizmo must stand down for the duration (they do).
- The clipboard holds either pixels or an object. When both could apply, the system clipboard
  wins **unless** its bytes are the PNG we last wrote — that is our own object copy returning.
- The text editing overlay commits on a real outside click, not on blur: the pointer-up that
  places the text moves focus to `<body>`, and committing there would delete it.
- **No chrome colour may exist only inside a `@media` or `[data-theme]` block.** Every token
  needs its base definition on bare `:root`, or one theme state renders unstyled.
- Anything the renderer paints from CSS goes through `themeColors()`; after changing the theme,
  call `refreshThemeColors()` and `invalidate()` or the canvas keeps the old surround until the
  next unrelated redraw.

# 10 — Milestones, testing & delivery

Build strictly in this order — every milestone ends **runnable and demoable**, and
its acceptance list (plus the referenced per-doc Acceptance sections) is the
definition of done. Don't start Mn+1 with Mn's checklist red.

A usable pixel editor exists from **M3**; the full owner workflow lands at **M11**.

**M13–M19 (3D model mode) are specified separately in `docs/11-3d-model-mode.md` §16** and are
not yet started. They follow the same rule: each ends runnable and demoable, and M13 alone is
already useful (view a model, jump from a face to its texture).

## M0 — Scaffold & rails
Vite React-TS app in the repo root; ESLint + Prettier; Vitest wired
(`npm test`); Playwright wired with one trivial spec; GitHub Actions workflow
(`.github/workflows/ci.yml`: install → lint → typecheck → vitest → playwright,
chromium only); Prettier-checked. Top bar renders "Monet".
**Accept:** fresh clone → `npm i && npm run dev` shows the shell; CI green.

## M1 — Document, renderer, view
`core/model` types + docStore; compositor with layer cache; checkerboard;
viewport (wheel zoom at cursor, space/middle pan, fit, 100 %); pixel grid +
16-px guide; new-doc dialog + doc tabs; status bar (coords, size, zoom).
**Accept:** [01 §10] compositor golden; [06 §5] zoom/fit items; create 16×16 and
512×512 docs, tabs switch, grid appears ≥ 8×.

## M2 — Pen, eraser, undo, PNG out, .monet
Stroke engine (scratch, Bresenham, commit); pixel pen + eraser (tips, sizes,
preview, cursor outline); command system + history (200); `Ctrl+S`/Save-As via
FS Access + download fallback; PNG export; `.monet` save/load; autosave +
recover dialog.
**Accept:** [02 §7] pen/eraser items; [01 §10] undo integrity; [07 §10] `.monet`
round-trip + recovery.

## M3 — Colour system, marker, bucket
Colour panel (palette, HSV picker, hex+alpha, custom, recents); eyedropper tool
+ `Alt`-pick; marker (graded tips, max-accumulate); flood fill + tolerance.
**Accept:** remaining [02 §7] items; `color/convert` + `floodfill` unit suites
green.

## M4 — Shapes
All ten types: geometry, drag-create, spline click-flow; select/transform
(move/scale/rotate handles + numeric rotation), point editing; fill/outline
styles; crisp mode; hit-testing; duplicate/delete.
**Accept:** [03 §7] shape items.

## M5 — Text
TextObject, bundled fonts (Monocraft default), edit overlay, B/I/U, align,
crisp; the **owner layering scenario E2E** (draw → text → draw on top → move
text) locked as a test.
**Accept:** [03 §7] text items incl. the scenario.

## M6 — Selection, clipboard, flatten
Marquee lifecycle (lift/move/scale/anchor/delete), `Ctrl+A`, crop to selection,
system clipboard copy/cut/paste + internal fallback, Flatten command.
**Accept:** [06 §5] selection/flatten items; owner scenario extended with
eraser-through-layers ([02 §7]).

## M7 — Canvas operations
Background controls (remembered colour); resize dialog (px/%, aspect lock,
resize-image toggle, NN + bilinear); rotate 90 CW/ACW; flips; tiling preview
with cross-seam painting.
**Accept:** [06 §5] canvas/tiling items (incl. object↔raster alignment test).

## M8 — Noise
Fields module (13 types, deterministic), map builder, apply (brightness/hue),
panel with preview/bake lifecycle.
**Accept:** [04 §7] in full.

## M9 — Recolour
Replace (chips, tolerance, preview) + Tint (amount) + shared lifecycle.
**Accept:** [05 §6] in full.

## M10 — Export formats
JPEG (quality, matte), WebP (feature-detected), ICO writer, BMP writer, PDF
export; export dialog; extra import decoders (bmp/gif/ico best-effort).
**Accept:** [07 §10] format items; golden-byte suites for ico/bmp; pdf fit
fixtures.

## M11 — Sources & GitHub
Sources sidebar; jar sources (IndexedDB cache, tree, thumbnails, search,
mcmeta badge); folder sources (FS Access, mirror saves); GitHub: token settings,
connect (branch create), browse/open (project-aware), save = commit+push with
retry, Sync (ff → merge fallback), status badges; Save-As path picker with
assets-root suggester.
**Accept:** [08 §8] in full (E2E with mocked API + one manual run against a real
scratch repo).

## M12 — PWA & polish
vite-plugin-pwa (installable, offline shell, update toast); app icons; shortcuts
overlay; toasts everywhere they're specced; unsaved-changes guards
(`beforeunload` + tab close dialog); Recover/Settings dialogs finished; a
performance pass at 1024² (stroke latency < 16 ms mid-stroke); README updated
with user-facing usage docs; **Vercel** deployment (owner decision 2026-08-09:
Vercel rather than GitHub Pages) — `vercel.json` pins the Vite preset, output
`dist/`, and PWA-correct cache headers; the repo is connected in Vercel's
dashboard so every push to `main` deploys and every branch gets a preview.
Domain `monet.mouftools.com` is added in Vercel → Settings → Domains.
**Accept:** Lighthouse PWA installable; offline reload works for local editing;
all doc Acceptance sections pass end-to-end; tag `v1.0.0`.

## Testing strategy (cumulative, enforced in CI from M0)

- **Unit (Vitest, Node, no DOM):** everything in `core/` — pixels, floodfill,
  colour maths, geometry/spline, noise determinism, recolour, ico/bmp goldens,
  pdf fit maths, `.monet` round-trip, command undo symmetry (property-style:
  random command sequences, undo-all ⇒ initial state).
- **E2E (Playwright, chromium):** one spec per milestone exercising the new
  surface through real pointer events; screenshot goldens for the compositor,
  noise gallery, default UI; GitHub flows against `page.route`-mocked
  `api.github.com` with recorded fixtures.
- **Manual QA checklist** (append per milestone in `docs/QA.md`, created at M1):
  the things automation can't see — cursor feel, marching-ants motion, Windows
  Explorer opening the ICO, a real repo round-trip.

## Working conventions (for the implementing junior)

- One PR per milestone (or per coherent slice of one); CI must be green; include
  the milestone checklist in the PR description and tick it live.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
- No new runtime dependencies beyond [01 §1]'s table without updating that table
  in the same PR (spec change = doc change).
- When implementation must deviate from this spec, **edit the spec in the same
  PR** — these docs stay the source of truth.
- Reference implementations in docs 02–08 are meant to be typed in as-is first,
  then refactored freely once their tests are green.

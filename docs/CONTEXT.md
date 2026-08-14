# Monet — context (scope, durable decisions, shipped state)

Claude-readable. Decisions are superseded explicitly, never silently edited away.
Update rules: CLAUDE.md §Progress docs.

## Scope

Client-side Paint 3D-style 2D editor + Minecraft/GitHub texture workflow.
Full feature inventory (the contract): `docs/00-overview.md` §3.
Exclusions (do not build): §4 — stickers, magic select, extra Paint 3D brushes, lasso
select, effects beyond noise/recolour, animation/mcmeta editing, collaboration.
**"3D anything" and "any server component" no longer apply** — see the superseded table.
3D model mode: spec `docs/11-3d-model-mode.md`; **M13–M19 + M19a all built and verified** —
every milestone in §16 is green. Outstanding by choice: view-cube refinements; seam-aware
painting (§8.4, out of scope by decision); dirty-rect texture uploads (fine at MC texture sizes).

## Durable owner decisions

| date | decision |
| ---- | -------- |
| 2026-08-09 | Platform: client-side web app + PWA, target `monet.mouftools.com`; no Electron, no server, no backend. |
| 2026-08-09 | Scope: owner's feature lists + editor essentials (undo/redo, eyedropper, palette, clipboard, shortcuts, pixel grid, tiling preview, autosave); NO extra Paint 3D brushes, not even as stretch. |
| 2026-08-09 | Repo saves store editable project data in a repo-root `.monet/` mirror (never sidecars inside assets trees). |
| 2026-08-09 | GitHub integration via REST API + user-supplied fine-grained PAT; branch-per-repo default name `monet`; push on every save; Sync = ff-only ref update with merge-commit fallback; never force-push. |
| 2026-08-09 | Repo governance: all work on `main`; small commits pushed promptly; progress docs updated before every commit, claude-readable-first (charter directives 1–3). |
| 2026-08-09 | Hosting: **Vercel** (owner request, after the spec was written). Static output, no serverless functions — nothing in Monet needs a server. Deploys via Vercel's Git integration, not a GitHub Action. |
| 2026-08-09 | UI density: **nothing needed while working may live only in a menu.** An always-visible toolbar row carries file/history/clipboard/canvas/view actions; the ☰ menu stays as a discoverable list of the same actions with their shortcuts. |
| 2026-08-09 | The painting cursor stays **visible** — the brush tip outline supplements the system cursor rather than replacing it. |
| 2026-08-09 | The **eyedropper belongs to the colour panel**, not the Brushes tool grid — it is a colour action and that panel is visible from every tab. |
| 2026-08-09 | Picking a colour is **momentary**: the previous tool returns on release (via 💧, `I` or `Alt`). |
| 2026-08-09 | **An outline is always drawn.** Unchecking *Outline* recolours it to the fill's colour/opacity at the same weight; it never removes geometry. |
| 2026-08-09 | **Copy/paste covers objects**, not only pixel selections: a copied shape or text pastes back as a live, editable object. |
| 2026-08-09 | **Dark mode** is in scope (the spec had called theming out-of-scope polish): `system` / `light` / `dark`, default `system`, persisted, toggled from the toolbar. |
| 2026-08-10 | Monet is a **GitHub App** with **"Sign in with GitHub"**; the fine-grained PAT stays as a fallback. Repository access = the App's installation, chosen by the user. Setup: docs/GITHUB-APP.md. |
| 2026-08-10 | Serverless functions are **allowed** (owner) — superseding "static output, no serverless functions". Exactly one exists, `api/github/token.ts`, because GitHub's token endpoint needs the client secret and sends no CORS headers. It is stateless and stores nothing. |
| 2026-08-10 | The owner also has a **Hetzner server** available for anything needing persistence. Not used by sign-in, which is stateless — noted so a future feature that genuinely needs storage knows the option exists. |
| 2026-08-10 | Image files **open in Monet from the OS file manager** (Explorer "Open with"), and `Ctrl+S` then overwrites that file in place. Requires the PWA to be installed, so an install banner exists whose pitch is exactly that. Chromium desktop only; other browsers keep drag-and-drop + Ctrl+O. |
| 2026-08-10 | **3D model mode is in scope** (owner request): load a Minecraft model + its texture/atlas, orbit and pan it, paint on it with the existing brushes, jump from a face to its texture, and build models (Blockbench capability, Onshape interaction). Spec: `docs/11`. Decided 2026-08-10: renderer = **raw WebGL2** (no three.js), navigation = **Onshape mapping** (middle-drag orbit, Ctrl/Shift+middle or Space pan, wheel dolly, right-drag orbit alias). |
| spec | Design decisions D1–D8 and vetoable assumptions A1–A8: `docs/00-overview.md` §1, §5. PDF fit interpretation (contain; long-edges coincide for aspect ≥ √2): `docs/07` §6. |

## Shipped

**v1 complete (M0–M12).** Every feature in docs/00 §3 is implemented and verified in a real
browser. See docs/ARCHITECTURE.md for the as-built map and ROADMAP.csv for per-milestone notes.

| date | item |
| ---- | ---- |
| 2026-08-09 | v1 technical specification, docs/00–10 (commit 081e6de). |
| 2026-08-09 | Charter + progress-docs system (this governance layer). |
| 2026-08-11 | **Relight mode** (owner request): Recolour's cousin that only changes brightness and never hue. Match picks a colour and the brightness to give it — a pale blue matched to a dark green becomes a dark blue at that brightness — and the whole image follows the same curve so the shading stays coherent; the mapping (scale/curve/shift), the measure (HSL lightness or perceived luma) and an optional per-colour limit are all choices. Adjust is brightness + contrast. |
| 2026-08-11 | **Brush lands on the pixel under the cursor** (owner report): stamps rounded the pointer position instead of flooring it, so painting anywhere past a pixel's midpoint hit the next pixel — one right and/or below. The eyedropper, bucket and status bar already floored, so the readout and the paint disagreed. |
| 2026-08-11 | **Multi-select (completing M18)**: Ctrl/⇧-click toggles elements, dragging from empty space box-selects, Ctrl+A takes all; the whole selection moves with one gizmo drag as a single undo step, and duplicate/delete/mirror act on all of it. Selected elements are outlined in the viewport, with the last-clicked one as the primary the number fields edit. A "Click picks: Elements / Faces" filter sends a single click straight to a face when you want that. |
| 2026-08-11 | **M19a — display transforms**: a Display section on the Model tab edits the eight `display` slots numerically and previews each one by drawing the model through Minecraft's own transform for that slot (vanilla defaults shown for slots the model has not declared), so "right in the editor, wrong in hand" is catchable; editing is paused during a preview, and a slot edit is one undo step that reaches the saved JSON. |
| 2026-08-11 | **M19 — export and round-trip**: saving a model merges over the source file, so `parent`, unknown mod keys and inherited-but-untouched geometry all survive (a parent-only model saves byte-identical); the Export dialog offers Java JSON, Bedrock `.geo.json` (real coordinate conversion, unit-tested but not verified in-game), the `.monet_model` project, and render-to-PNG — model only, on transparency, so it is an icon. Display slots round-trip but have no editor yet (ROADMAP M19a). |
| 2026-08-11 | **M18 — Onshape interaction**: gizmo drags infer alignments against other elements' faces and centres (reaching fractional coordinates the lattice cannot), drawing the aligned plane and a live Δaxis readout; the status bar measures the gap between the selected and hovered elements in texels; clicking cycles selection depth element→face with Esc climbing out; right-click opens a content-aware context menu. Selection filters, multi-select transforms and view-cube refinements are deferred. |
| 2026-08-11 | **M17 — UV editing**: a UV tab (models only) with per-face rects as numeric fields, box-UV auto-mapping (classic cross, texel origin, one undo step), 90° rotation cycling, mirror by endpoint swap, fit-to-face (vanilla projection), copy/paste UV, face on/off, and a live-texture canvas where rects drag/resize on the texel lattice. |
| 2026-08-11 | **M16 — modelling I**: cubes added/duplicated/mirrored/deleted through commands; numeric-first properties (fields take arithmetic, snap illegal rotations in vanillaMode, flag them in free mode); translate gizmo with 1/16-lattice snapping (⇧ half, Alt free); selectable outliner; vanilla-JSON save that Minecraft loads; `S`/`H` switch select/pan on models; undo spans geometry + painted-texture histories newest-first. Deviations in docs/11 §12/§13.1/§16. |
| 2026-08-10 | **M15 — painting on the model**: the 2D brushes (pen/marker/eraser/bucket/eyedropper, same settings, texel-sized) paint directly on the 3D model through the existing stroke engine; one drag = one undo step even across faces, with no interpolation across UV discontinuities; Ctrl+Z from the model tab undoes on the texture; erasing punches real cutout holes. |
| 2026-08-10 | **M14 — faces to textures**: double-click / middle-click / Enter (viewport-centre fallback) open the texture behind a face with its uv rect selected; open texture docs are live-linked both ways with the 3D view; UV guides overlay the 2D editor; region write-back plumbed for sheet atlases. |
| 2026-08-10 | **M13 — 3D viewport**: model documents beside image tabs; Java model parsing with jar parent chains + builtin fallbacks; raw WebGL2 renderer (MC shading, cutout, grid/bounds/axes, view cube); Onshape navigation; hover picking; ortho/standard views; per-tab cameras. |
| 2026-08-09 | M0 scaffold; M1 compositor/viewport/shell; M2 stroke engine + brushes + file IO; M3 colour/eyedropper/bucket; M4 shapes; M5 text (+ GUI harness); M6 selection/clipboard/flatten; M7 canvas ops; M8 noise; M9 recolour; M10 export formats; M11 jar/folder/GitHub sources; M12 PWA + deploy. |

## Owner-visible behaviour worth remembering

- The owner's layering scenario is a verified invariant, not an aspiration: harness scenario
  `layering.mjs` asserts stack order raster/text/raster and an identical stroke pixel count
  before and after moving the text.
- Ctrl+S into a repo = exactly one commit carrying the PNG and its `.monet` mirror; Sync
  fast-forwards the target branch and falls back to a merge commit; Monet never force-pushes.
- Jars are read-only: saving a vanilla texture routes to Save As, which suggests the repo's own
  assets root plus the jar path's `assets/...` tail.
- A texture opened from Explorer stays connected to that file: no "where should I put it?" on save.
- Scroll-to-zoom now suppresses the browser's own scroll/zoom (it could not before — see
  docs/ARCHITECTURE.md §Performance rules on React's passive wheel listener).

## Superseded / cut

| date | change |
| ---- | ------ |
| 2026-08-09 | Bundled font default: Monocraft → **Silkscreen**. Monocraft is not published on npm and the build environment cannot fetch font binaries from GitHub. Adding it later is one @font-face plus one entry in src/ui/fonts.ts. (docs/03 §6.2 updated) |
| 2026-08-09 | Checkerboard #cfcfcf/#a8a8a8 → **#ffffff/#d4d4d4**: the specced grey pixel grid was invisible against a mid-grey checker, which defeats the grid's purpose on transparent canvases. (docs/01 §4, docs/06 §2 updated) |
| 2026-08-09 | PDF fit is **contain**, not a literal longest-edge match, so images squarer than the page are not cropped; identical to the literal rule for anything at least as elongated as A4. (docs/07 §6) |
| 2026-08-09 | Deploy target: GitHub Pages workflow → **Vercel** (owner request). `.github/workflows/deploy.yml` deleted; `vercel.json` added. CI in `.github/` still lints/tests/builds. |
| 2026-08-09 | "Light theme, hard-code the palette; theme work is polish, not v1 scope" (docs/09 preamble) → **superseded**: owner asked for a dark mode, so the palette is tokenised and there are three theme states. (docs/09 §9 rewritten) |
| 2026-08-10 | "Static output, no serverless functions — nothing in Monet needs a server" (D1) → **one Edge Function**, for the GitHub App token exchange only. Forced by GitHub: the exchange needs the client secret and the endpoint has no CORS, so there is no browser-only route. |
| 2026-08-10 | Scope exclusion "**3D anything**" (docs/00 §4) → **superseded**: 3D model mode is in scope, specified in docs/11. 2D documents are unaffected — the 3D viewport is an addition, not a migration. |
| 2026-08-10 | "Canvas 2D; **no WebGL**, no workers" (docs/01 §1) → WebGL2 is permitted **for the 3D viewport only**, pending the renderer decision in docs/11 §D11.1. |
| 2026-08-09 | Brushes' `cursor: none` → **`crosshair`** (owner request). The overlay outline is 1–2 px wide at low zoom, so hiding the pointer left nothing to track. (docs/02 §3.4, docs/09 §8) |

# Monet — context (scope, durable decisions, shipped state)

Claude-readable. Decisions are superseded explicitly, never silently edited away.
Update rules: CLAUDE.md §Progress docs.

## Scope

Client-side Paint 3D-style 2D editor + Minecraft/GitHub texture workflow.
Full feature inventory (the contract): `docs/00-overview.md` §3.
Exclusions (do not build): §4 — stickers, magic select, extra Paint 3D brushes, lasso
select, effects beyond noise/recolour, animation/mcmeta editing, collaboration.
**"3D anything" and "any server component" no longer apply** — see the superseded table.
3D model mode is specified in `docs/11-3d-model-mode.md` (spec only, M13–M19, nothing built).

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

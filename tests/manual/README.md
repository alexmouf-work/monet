# GUI harness

Drives the real app in a real browser, screenshots each step, and reads app state back out
of the page. One process per run (dev server + browser + scenario), because detached
processes do not survive between agent shell calls.

```bash
npm run harness                                   # default scenario (scenarios/smoke.mjs)
npm run harness -- tests/manual/scenarios/text.mjs
npm run harness -- <scenario> --out /tmp/run1     # where screenshots go
npm run harness -- <scenario> --headed            # real Chromium (wrapped in xvfb-run)
npm run harness -- <scenario> --verbose           # forward all page console output
npm run harness -- <scenario> --slow 250 --keep   # slow-motion, keep the browser open
npm run harness -- <scenario> --width 1600 --height 1000
```

Every run writes `NN-label.png` per shot **plus `contact.png`** — a contact sheet of the whole
interaction, so a full flow can be reviewed in one image. `report.json` lists the shots and
any page errors. The dev server is Vite's, so editing `src/` and re-running picks the change
up with no build step.

## Writing a scenario

`tests/manual/scenarios/*.mjs` default-export `async ({ page, ui, shot, state, log }) => {}`.

- `ui.newDoc(64)` · `ui.tab('Shapes')` · `ui.tool('Marker')` · `ui.paletteColor(3)` ·
  `ui.setNumber('Size', 12)` — drive the UI by meaning, not selectors.
- `ui.atDoc(x, y)` — the screen point of a **document pixel**, computed from the live view
  transform. `ui.at(fx, fy)` takes canvas fractions. `ui.drag(a, b)`, `ui.click(p)`.
- `state.stack()` · `state.stores()` · `state.doc()` · `state.editingTextId()` ·
  `state.countColor('#ED1C24')` · `state.pixelAt(x, y)` — read real state through
  `src/app/debugBridge.ts` (`window.__monet`), including pixels of the flattened composite.
  Assert on these rather than eyeballing screenshots.
- `shot('label')` for a screenshot, `log(...)` for a line in the run output.
- Export `beforeLoad()` to inject an init script before the app boots (see `save.mjs`, which
  stubs the File System Access picker that headless Chromium cannot present).

## Scenarios

| file | covers |
| ---- | ------ |
| `smoke.mjs` | tour of every built feature, ending in undo-all |
| `layering.mjs` | the owner's layering scenario (docs/01 §3.1) with pixel-level assertions |
| `text.mjs` | text placement, typing, styling, re-editing |
| `save.mjs` | Ctrl+S routing: FSA handle, silent re-save, `.monet`, download fallback |
| `sources.mjs` | jar browsing + the whole GitHub flow against a mocked `api.github.com` |
| `canvas.mjs` `noise.mjs` `recolour.mjs` `export.mjs` | one per feature tab / format set |
| `theme.mjs` | toolbar buttons actually fire, brush cursor is visible, theme cycles and persists |
| `perf.mjs` | frame cost **and** handler cost; also asserts wheel-zoom can cancel page scroll |
| `eyedropper-shapes-clipboard.mjs` | momentary picking, outline-off edges, object copy/paste |
| `file-handler.mjs` | an OS "open with" launch: fake `launchQueue` + handles, then Ctrl+S writing back to the launched file |
| `model3d.mjs` | M13: models from a fixture jar, WebGL2 render probe, Onshape navigation, hover picking, banner |
| `model3d-face.mjs` | M14: dblclick/Enter/middle-click → texture, uv-rect selection, live 2-way link, uv guides |
| `model3d-paint.mjs` | M15: brushes on the model, segmentation (no chord across faces), background texture doc, undo routing, eraser holes |
| `github-login.mjs` | GitHub App sign-in: authorize URL, exchange, refresh, installations, forged-state refusal — all against a mocked GitHub |

`shot()` deliberately waits two `requestAnimationFrame`s before capturing: a full-page
screenshot taken straight after a CSS-only change can return the previous compositor frame, so a
correct app looks broken. If a screenshot disagrees with `state()`, trust `state()`.

## Production output check

`node tests/manual/prodboot.mjs` (after `npx vite build`) serves `dist/` the way a static host
does — this is what Vercel serves — and asserts the shell renders, the manifest and service
worker resolve, the SW registers at scope `/`, the manifest's `file_handlers` are intact with a
resolvable `action`, and a document can be drawn in. Use it after any
change to `vite.config.ts`, `vercel.json` or the PWA setup.

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

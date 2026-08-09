# Monet

**Monet** is a Paint 3D–style 2D image editor built for **Minecraft texture making** —
a fully client-side web app (installable as a PWA) that connects directly to Minecraft
jars, mods, and GitHub repositories.

Named for the painter; part of the [mouftools](https://mouftools.com) family, intended
to live at `monet.mouftools.com`.

## What it does

- Paint-3D-style editor: brushes, 2D shapes, text, canvas tools — plus **noise** and
  **recolour** systems purpose-built for texture work.
- Open textures straight out of a **Minecraft jar / mod jar** (parsed in the browser),
  a **local folder**, or a **GitHub repository**.
- GitHub workflow: Monet creates a working branch, **every save commits and pushes**
  to it, and a **Sync button fast-forwards** any branch (default `main`) to the same
  state.
- Exports PNG (default), JPEG, WebP, ICO, BMP and PDF; saves layered projects as
  `.monet` files.

## Status

**Specification stage.** The complete, implementation-ready technical specification
lives in [`docs/`](docs/) — start at [`docs/00-overview.md`](docs/00-overview.md).
No application code exists yet.

## The spec, in reading order

| Doc | Contents |
| --- | --- |
| [00-overview](docs/00-overview.md) | Product overview, locked decisions, feature inventory, exclusions, assumptions |
| [01-architecture](docs/01-architecture.md) | Stack, module layout, the document model (hybrid raster/vector stack), rendering pipeline, undo/redo, canonical TypeScript types |
| [02-brushes](docs/02-brushes.md) | Pixel pen, marker, eraser, paint bucket; the stroke engine; colour system |
| [03-shapes-text](docs/03-shapes-text.md) | All ten 2D shapes with exact geometry, transforms/handles, splines; the text tool |
| [04-noise](docs/04-noise.md) | The noise system: 13 noise types with reference implementations, rotation/zoom/intensity, brightness/hue application |
| [05-recolour](docs/05-recolour.md) | Targeted recolour (multi-target → result) and uniform tint (brightness-preserving) |
| [06-canvas-view-selection](docs/06-canvas-view-selection.md) | Canvas settings & operations, zoom/pan/grid/tiling preview, rectangular selection & clipboard |
| [07-file-io](docs/07-file-io.md) | Every import/export format incl. byte-level ICO/BMP writers and exact PDF fit maths; the `.monet` project format; autosave |
| [08-minecraft-github](docs/08-minecraft-github.md) | Jar/mod parsing, local folder sources, and the full GitHub integration (token, branch, push-on-save, fast-forward sync) |
| [09-ui](docs/09-ui.md) | Complete UI spec: layout, every panel and control, dialogs, shortcuts, cursors |
| [10-milestones](docs/10-milestones.md) | Build order M0–M12 with per-milestone tasks and acceptance checklists; testing strategy; CI |

## Conventions used throughout the spec

- **Prose uses UK spelling** (colour, rasterise); **code uses US spelling**
  (`color`, `rasterize`) — matching web platform APIs.
- Code blocks marked *reference implementation* are canonical: type them in as
  written (they are deliberately dependency-free and unit-testable).
- The TypeScript interfaces in `01-architecture` are the single source of truth for
  data shapes; other docs refer to them.
- Every feature section ends with **Acceptance** — concrete checks that define done.

## Running (once M0 is complete)

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest unit tests
npm run build      # production build in dist/
```

# Monet

**Monet** is a Paint 3D–style 2D image editor built for **Minecraft texture making** —
a fully client-side web app (installable as a PWA) that connects directly to Minecraft
jars, mods, and GitHub repositories.

Named for the painter; part of the [mouftools](https://mouftools.com) family, deployed on
**Vercel** at `monet.mouftools.com`.

```bash
npm install
npm run dev        # Vite dev server
npm test           # unit tests (src/core)
npm run harness    # drive the real app in a browser and screenshot it
npm run build      # production build in dist/
```

## What it does

**Brushes** — pixel pen (hard, one exact colour across the tip), marker (fades to
transparency across the radius), eraser, and a paint bucket with tolerance. Square or
circular tips, sizes 1–64. `Alt` picks a colour with any tool.

**2D shapes** — triangle, rectangle, pentagon, hexagon, circle, ellipse, arrow,
arrowhead, line and spline. Independent fill and outline colour, opacity and weight;
rotate through 360° by handle or number; drag any of eight handles; drag line/spline
points individually and `Alt`-click to add or remove them.

**Text** — bundled pixel fonts (Silkscreen, Press Start 2P, VT323) plus the generic
families, bold/italic/underline, alignment, opacity, rotation, edited in place on the
canvas.

**Noise** — 13 types (Perlin, clouds, soft blobs, Worley cells, marble, wood, stripes,
zigzag, checker, rings, up/down gradient, radial, white) with rotation, scale,
intensity, a seed you can re-roll, and a choice of affecting brightness, hue or both.
Live preview, one click to bake.

**Recolour** — swap any number of target colours for one result colour with a
tolerance, or tint the whole image to one colour while keeping every pixel's
brightness. Live preview, one click to bake.

**Canvas** — transparent or coloured background (the colour is remembered across
toggles), resize in px or %, aspect lock, resize-image-with-canvas, 90° rotations and
flips.

**Everywhere** — scroll to zoom at the cursor, rectangular select with lift/move/
anchor, clipboard, crop, flatten, undo/redo 200 deep, pixel grid, **3×3 tiling
preview** for checking seams, autosave with crash recovery, and a light/dark theme
that follows your system by default.

**Export** — PNG (default), JPEG, WebP, ICO (multi-size), BMP and PDF.

### Layers, without a layers panel

Brush strokes rasterise; shapes and text stay live objects. The stack is managed for
you: draw a background, add text, draw on top of the text, then move the text — the
strokes stay exactly where they were *and* stay above the text. Flatten (`Ctrl+Shift+F`)
when you want noise, recolour or the eraser to affect shapes and text too.

### Minecraft & GitHub

Add a **Minecraft or mod jar** and browse its `assets/**` textures (cached, so it
survives reloads; animated strips are badged). Add a **local folder**, or a **GitHub
repository**.

For a repository, Monet creates a working branch (`monet` by default), **every save is
one commit and push** carrying the PNG *and* its layered project, and **Sync**
fast-forwards `main` — or any branch — to match, falling back to a merge commit when
the branches have diverged. It never force-pushes. Editing a vanilla texture and saving
it into your mod repo suggests the right path automatically.

**Sign in with GitHub** in Settings and pick which repositories Monet may touch — Monet is a
GitHub App, so its access is exactly the repositories you install it on, and nothing else. A
fine-grained personal access token (**Contents: Read and write**) still works instead, and is the
route when self-hosting. Either way the credential is stored in your browser and sent only to
`api.github.com`.

## Installing, and opening files from Explorer

Install Monet (the **Install** button in the app, or the install icon in Chrome/Edge's address
bar) and it registers itself with the operating system as an image editor. After that, in Windows
File Explorer:

- **right-click a PNG → Open with → Monet** — or set Monet as the default for `.png` and
  double-click;
- the file opens in Monet's own window, and **`Ctrl+S` saves straight back to that file** — no
  dialog, no "where do you want to put it";
- select several files and they open as several tabs in one window.

Registered types: `.png .jpg .jpeg .webp .bmp .gif .ico` and Monet's own `.monet` projects. This
needs Chrome or Edge on the desktop (Windows, macOS or Linux) — the underlying File Handling API
does not exist in Firefox or Safari, where drag-and-drop onto the window and `Ctrl+O` still work.

Installing also gets you the offline app shell, so Monet keeps working on a plane with local
files.

## Layered project files

Saving into a repo or folder writes the flat PNG where it belongs plus a `.monet`
project into a mirrored `.monet/` tree at the root — so the text and shapes stay
editable, from any machine, without ever being packaged into a built jar.

## Deploying

Hosted on Vercel as a static build. One serverless function exists, `api/github/token.ts`, purely
to exchange the GitHub App's OAuth code for a token — that step needs the App's client secret and
GitHub's endpoint sends no CORS headers, so it cannot happen in the browser. The editor itself
needs no server. Setting the App up is [`docs/GITHUB-APP.md`](docs/GITHUB-APP.md).

1. In Vercel, **Add New → Project** and import `alexmouf-work/monet`. The Vite preset is
   detected automatically; `vercel.json` pins it anyway, along with `dist` as the output
   directory and the cache headers a service worker needs.
2. **Settings → Domains → Add** `monet.mouftools.com`, then point that DNS record at Vercel.

After that, every push to `main` deploys to production and every other branch gets its own
preview URL. GitHub Actions does not deploy, and no longer runs on push either — the workflow is
manual (`workflow_dispatch`) because the checks it repeats already run locally before each commit.

To ship from a terminal instead: `npx vercel --prod`.

## Docs

Working rules and live state: [`CLAUDE.md`](CLAUDE.md) (agent charter) ·
[`docs/CONTEXT.md`](docs/CONTEXT.md) (decisions, shipped) ·
[`docs/ROADMAP.csv`](docs/ROADMAP.csv) (status) ·
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (as-built map) ·
[`tests/manual/README.md`](tests/manual/README.md) (the GUI harness).

The design specification — the contract the implementation follows — is
[`docs/00-overview.md`](docs/00-overview.md) through
[`docs/10-milestones.md`](docs/10-milestones.md).

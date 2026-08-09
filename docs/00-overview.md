# 00 — Overview

Monet is a **2D raster-first image editor in the style of Microsoft Paint 3D**,
specialised for **Minecraft texture making**. It runs entirely in the browser as a
static single-page app, installable as a PWA. There is **no backend server**: jars are
parsed client-side, files are saved via the File System Access API (or download), and
GitHub integration talks straight to GitHub's CORS-enabled REST API with a personal
access token.

This doc fixes the product's shape. Everything ambiguous in the original brief is
resolved here; later docs only add mechanism.

## 1. Locked decisions

| # | Decision | Rationale |
| - | -------- | --------- |
| D1 | **Platform: client-side web app + PWA**, hosted on **Vercel** (owner-confirmed; Vercel chosen 2026-08-09) | Matches the mouftools pattern (static app per subdomain); every required function — jar parsing, painting, exports, GitHub branch/push/merge — works client-side. Canvas performance is identical to a wrapped native app. Nothing in the app needs a server, so Vercel serves it as static output with zero functions. |
| D2 | **Stack: Vite + React + TypeScript + Zustand, Canvas 2D rendering** | Most-documented path for a junior; textures are small (≤4096², typically ≤512²) so Canvas 2D + typed arrays is plenty. No WebGL. |
| D3 | **Scope: the owner's feature lists + editor essentials; no extra Paint 3D brushes** (owner-confirmed) | Essentials = undo/redo, eyedropper, palette, clipboard, shortcuts, pixel grid, tiling preview, autosave. Explicitly excluded: pencil/crayon/spray/calligraphy/oil/watercolour brushes, stickers, magic select, 3D anything, effects beyond noise & recolour. |
| D4 | **Hybrid layer model, invisible to the user** | Brush strokes rasterise into *paint layers*; shapes and text stay live vector *objects*; the z-order is an interleaved stack managed automatically ("layering behind the scenes"). No layers panel. See `01-architecture §3`. |
| D5 | **GitHub via REST API + fine-grained PAT** | `api.github.com` sends CORS headers, so the browser can create branches, commit+push on save, and fast-forward branches directly. No git binary, no server, no OAuth app registration. |
| D6 | **Editable project data for repo saves lives in a repo-root `.monet/` mirror** (owner-confirmed) | e.g. texture `src/main/resources/assets/star/textures/item/sword.png` ↔ project `.monet/src/main/resources/assets/star/textures/item/sword.monet`. Committed (survives machines), but never packaged into built jars because it sits outside the resources tree. |
| D7 | **Chromium-first** | Primary browsers: Chrome/Edge (owner is a Windows / Paint 3D user). Firefox/Safari must not break for editing, but may lose: WebP export, File System Access saves (falls back to download), local-font enumeration. Feature-detect, never UA-sniff. |
| D8 | **Optimised for tiny canvases** | First-class sizes 16²–512². Hard cap 4096². Full-canvas per-pixel passes (noise, recolour) are simple synchronous loops — at 512² (262 144 px) they run in ~10 ms; no workers needed. |

## 2. Who uses it, for what (the core loop)

Alex (and anyone else) making Minecraft textures:

1. **Connect sources** once: the vanilla jar (picked from disk), a mod jar, a local
   folder, and/or a GitHub repo (e.g. a Fabric mod repo).
2. **Open** a texture from a source — or start a blank 16×16.
3. **Edit** with pixel-exact tools at high zoom: pen, bucket, shapes, text, noise,
   recolour, tiling preview to check seams.
4. **Save** (`Ctrl+S`):
   - repo source → Monet writes the PNG + `.monet` project into the repo's working
     branch as **one commit, and pushes**;
   - folder source → writes files in place;
   - unsaved/new → Save-As dialog (download or local file).
5. When happy, press **Sync** → fast-forward `main` (or any chosen branch) to the
   working branch's state.

## 3. Feature inventory (the contract)

Everything below is **required**. Bracketed references say which doc specifies it.

### Brushes [02]
- **Pixel pen** — hard, aliased stamp; identical colour across the whole tip; square
  or circular tip; size 1–64 px.
- **Marker** — tip fades from the active colour at the centre to transparent at the
  radius; square or circular; smooth accumulation.
- **Eraser** — square or circular; erases through all paint layers; never touches
  shape/text objects.
- **Paint bucket** — flood fill with tolerance 0–100 %; never crosses pixels outside
  the tolerance; contiguous.
- **Eyedropper** (essential) — pick any on-canvas colour; `Alt`+click from any brush.

### 2D shapes [03]
Triangle, rectangle, pentagon, hexagon, circle, ellipse, arrow (→), arrowhead (>),
straight line (two endpoints), spline (arbitrary point count). All shapes:
- rotatable through 360° (handle + numeric field);
- independent **fill** {on/off, colour, opacity} and **outline** {on/off, colour,
  opacity, weight in px};
- stay live/movable objects until explicitly flattened.

### Text [03]
Font family (bundled pixel fonts + generic families), size, bold/italic/underline,
alignment, colour + opacity, 360° rotation, multiline, in-canvas editing, optional
**crisp mode** (thresholded alpha → pixel-pure glyphs). Text objects stay live.

### Noise [04]
- Type chosen from a **large list** (13 types incl. radial, Perlin, zigzag, up/down
  gradient — full list in 04).
- **Rotate 0–360°**, **zoom** in/out, **intensity 0–100 %**, seeded + re-rollable.
- Affects **brightness**, **hue**, or **both**.
- Live preview; **Apply** bakes.

### Recolour [05]
- **Mode A (Replace):** one or more **target** hex colours (added via `+`), one
  **result** hex colour, **preview toggle**, **Recolour** button bakes.
- **Mode B (Tint):** one result hex colour; the whole image becomes that colour
  **respecting only pixel brightness**; **0–100 % amount slider**; preview; bake.

### Canvas [06]
- Transparent or coloured background; the colour and the transparent flag are
  **remembered independently across toggles**.
- Resize with width/height fields in **px or %**, **aspect-ratio lock**, and a
  **"resize image with canvas"** option.
- Rotate 90° CW / ACW; flip horizontal / vertical.

### Generic [06, 07]
- **Zoom with mouse scroll** (up = in, down = out), zoom at cursor.
- **Rectangular selection**: move/cut/copy/paste/delete/crop; floating selection.
- **Hybrid layering** (D4) satisfying the owner's scenario: *draw a background → add
  text → draw on top of the text → move the text* ⇒ the strokes stay where they were
  **and** stay above the text.
- Save formats: **PNG (default), JPEG, WebP, ICO, BMP, PDF** — PDF fits the image's
  largest edge to the page's longest edge, landscape/portrait respected, no margin.
- Essentials: undo/redo (≥200 steps), palette + custom swatches, hex + alpha colour
  input, clipboard interop, keyboard shortcuts, pixel grid, **3×3 tiling preview**,
  autosave/crash recovery, `.monet` layered project files.

### Minecraft & GitHub [08]
- **Sources panel**: add a Minecraft jar, a mod jar (both = zip archives picked from
  disk, cached in IndexedDB), a local folder (File System Access), or a GitHub repo.
- Jar sources: browse `assets/**` PNGs as a namespace tree with thumbnails and
  search; read-only (save redirects into a writable source).
- GitHub sources: connect with a PAT; Monet **creates a working branch** (default
  name `monet`); **every save = one commit + push**; a **Sync** button
  **fast-forwards a chosen branch (default `main`)** to the working branch, with a
  merge-commit fallback when fast-forward isn't possible.

## 4. Explicit exclusions

Not in scope, at any priority — do not build:
3D shapes/models/library, stickers, magic select, Paint 3D "effects" filters, the
extra Paint 3D brushes (pencil, crayon, spray can, calligraphy, oil, watercolour),
free-form (lasso) selection, animation/`.mcmeta` editing, multi-user collaboration,
any server component.

## 5. Standing assumptions (owner may veto — each is one small change)

| # | Assumption | Where to change |
| - | ---------- | --------------- |
| A1 | PDF page size is **A4** (Letter available via a setting later) | `07 §7` |
| A2 | Bucket/marquee/eraser act on **paint layers only**; live objects are unaffected (use **Flatten** first to affect them) | `01 §3`, `06 §4` |
| A3 | Bucket region detection reads the **full visual composite** (so text/shape edges bound fills) but writes into the top paint layer | `02 §5` |
| A4 | Outline weight is in canvas px and does **not** scale when an object is resized | `03 §2` |
| A5 | Default working-branch name for repo sources is **`monet`** (editable at connect time) | `08 §5` |
| A6 | JPEG export mattes transparency onto **white** | `07 §3` |
| A7 | New-document default is **16×16, transparent** (remembers last used) | `09 §6` |
| A8 | Fill tolerance metric is per-channel max difference (Chebyshev over RGBA) | `02 §5` |

## 6. Glossary

| Term | Meaning |
| ---- | ------- |
| **Document** | One open image: size, background, and a stack of items. |
| **Item** | One entry in the stack: a *paint layer*, a *shape object*, or a *text object*. |
| **Paint layer** | Document-sized RGBA pixel buffer; brush tools write here. |
| **Object** | Live vector item (shape or text): parameters + transform, rendered each frame. |
| **Flatten** | Rasterise objects into a single paint layer (explicit command). |
| **Floating selection** | Pixels lifted by the marquee, movable until anchored. |
| **Bake** | Apply a previewed adjustment (noise/recolour) destructively to paint layers. |
| **Source** | A connected content provider: jar, folder, or GitHub repo. |
| **Working branch** | The branch Monet creates and pushes to for a repo source. |
| **Doc space** | Pixel coordinates of the document, origin top-left. |
| **Screen space** | CSS-pixel coordinates of the viewport canvas. |

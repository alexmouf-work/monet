# 07 — File I/O: open, save, export formats, projects, autosave

## 1. Save & open routing

| Action | Shortcut | Behaviour |
| ------ | -------- | --------- |
| **Save** | `Ctrl+S` | `doc.binding` set → save into that source ([08 §6]: repo = commit+push, folder = write in place) as **PNG + `.monet` mirror**. No binding → Save-As. |
| **Save As** | `Ctrl+Shift+S` | Choose: a writable connected source (+ path within it), or a local file. Local = File System Access `showSaveFilePicker` (fallback: download). Sets `binding` when saved into a source. |
| **Export** | `Ctrl+Shift+E` | Format + options dialog (§3–§7); never changes `binding`. |
| **Open** | `Ctrl+O` | Source browser or local picker; also window-wide drag-drop. Accepts `.monet`, `.png`, `.jpg/.jpeg`, `.webp`, `.bmp`, `.gif` (first frame), `.ico` (browser-decoded, best-effort size pick). |
| **New** | `Ctrl+N` | New-doc dialog [09 §6]. |

Decoding raster imports: `createImageBitmap(file)` → draw to an offscreen →
`getImageData` → that becomes the single `RasterLayer` of a new doc (docs larger
than 4096² are rejected with a message). Opening a PNG from a repo/folder source
that has a `.monet` mirror opens the **project** instead (full stack) — see
[08 §6.2].

## 2. The flattened composite

All raster exports share `renderComposite(doc): Uint8ClampedArray` — the [01 §4]
pipeline steps 3–6 at zoom 1 onto a `width × height` offscreen: background colour
(when mode `color`), stack bottom→top (objects rendered live, crisp respected),
floating selection at its position. Transparent background stays transparent.

## 3. PNG / JPEG / WebP (canvas-native)

```ts
canvas.toBlob(cb, 'image/png')                          // default format
canvas.toBlob(cb, 'image/jpeg', q)                      // q slider 0.05–1, default 0.92
canvas.toBlob(cb, 'image/webp', q)                      // q slider 0.05–1, default 0.90
```

- JPEG/BMP-24 have no alpha: matte the composite first onto `background.color` when
  mode is `color`, else **white** (A6).
- WebP encode support is feature-detected once at startup (encode a 1×1 and check
  the blob's type); the option hides when unsupported (Firefox/Safari, D7).
- PNG is the default everywhere and the format written into sources.

## 4. ICO — `core/io/ico.ts` (reference implementation)

Container of PNG-compressed entries (valid for all sizes on Windows Vista+ and all
browsers). Export dialog: size multi-select from {16, 24, 32, 48, 64, 128, 256},
default {16, 32, 48, 256}. Each entry: nearest-neighbour scale of the composite to
`s × s` (letterbox non-square sources onto transparent square first, centred), PNG-
encode, then pack:

```
ICONDIR   (6 bytes):  u16 reserved = 0 · u16 type = 1 · u16 count = N
ICONDIRENTRY ×N (16): u8 width (0 ⇒ 256) · u8 height (0 ⇒ 256) · u8 colours = 0
                      u8 reserved = 0 · u16 planes = 1 · u16 bitCount = 32
                      u32 bytesInRes = PNG byte length · u32 imageOffset
PNG blobs, ascending size order; offsets = 6 + 16·N + Σ(previous lengths)
```

All integers little-endian; build with a `DataView`. Unit test: golden bytes for a
2-size export of a fixed 4×4 image (record once, assert thereafter), plus header
arithmetic for 1/3/7 sizes.

## 5. BMP — `core/io/bmp.ts` (reference implementation)

32-bit BGRA with a V4 header so alpha survives:

```
BITMAPFILEHEADER (14): 'B''M' · u32 fileSize · u16 0 · u16 0 · u32 pixelOffset = 122
BITMAPV4HEADER  (108): u32 108 · i32 W · i32 H (positive ⇒ bottom-up rows)
                       u16 planes = 1 · u16 bpp = 32 · u32 compression = 3 (BI_BITFIELDS)
                       u32 imageSize = W·H·4 · i32 2835 · i32 2835 · u32 0 · u32 0
                       u32 redMask   = 0x00FF0000 · u32 greenMask = 0x0000FF00
                       u32 blueMask  = 0x000000FF · u32 alphaMask = 0xFF000000
                       u32 csType = 0x73524742 ('sRGB') · 36 zero bytes (endpoints)
                       u32 0 · u32 0 · u32 0 (gammas)
Pixels: rows bottom-up, each pixel bytes B,G,R,A; stride = W·4 (no padding at 32 bpp)
```

Little-endian `DataView` throughout. `fileSize = 122 + W·H·4`. Golden-byte unit
test on a fixed 3×2 image with partial alpha.

## 6. PDF — `core/io/pdfExport.ts` (reference implementation)

Page size **A4** (A1): `595.28 × 841.89` pt. Orientation follows the image:
`w ≥ h ⇒ landscape`. Fit = **contain**: the image's largest edge matches the
page's longest edge exactly whenever the image is at least as elongated as A4
(aspect ≥ √2 ≈ 1.414 — the required "largest edge to longest edge, no margin");
squarer images are governed by the short axis instead so nothing crops. The
governed axis is flush (no margin); the other axis centres.

```ts
import { PDFDocument } from 'pdf-lib';
const A4: [number, number] = [595.28, 841.89];

export async function exportPdf(png: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const [pw, ph] = w >= h ? [A4[1], A4[0]] : A4;      // landscape iff image is wide
  const s = Math.min(pw / w, ph / h);
  const dw = w * s, dh = h * s;
  const page = doc.addPage([pw, ph]);
  page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  return doc.save();
}
```

Unit tests (pure maths, extract the fit into `fitToPage(w,h) → {pw,ph,dw,dh,x,y}`):
1920×1080 → landscape, `dw = 841.89`, `x = 0`; 1080×1920 → portrait, `dh = 841.89`,
`y = 0`; 512×512 → landscape, `dh = 595.28`, `y = 0`, `x > 0`. Transparency renders
over the page (white) — matte beforehand like JPEG only when the owner asks (not
v1).

## 7. The `.monet` project format — `core/io/monetFile.ts`

A zip (jszip, DEFLATE) — **no canvas involvement, fully unit-testable in Node**:

```
manifest.json                the document, verbatim JSON (see below)
layers/<id>.raw              each RasterLayer's pixels, raw RGBA bytes (W·H·4)
```

`manifest.json` = `MonetDoc` [01 §3] minus runtime fields, plus envelope:

```json
{ "format": "monet", "version": 1,
  "name": "sword", "width": 16, "height": 16,
  "background": { "mode": "transparent", "color": "#FFFFFF" },
  "nextItemId": 7,
  "stack": [ { "kind": "raster", "id": 1, "file": "layers/1.raw" },
             { "kind": "text", "id": 2, "...": "full TextObject JSON" } ] }
```

- Raw (not PNG) layer storage ⇒ **byte-exact** round-trips (no premultiply loss)
  and no decoder in `core`; DEFLATE keeps pixel-art tiny.
- Read: validate `format`/`version` (reject newer versions with a clear message —
  no migration machinery, version 1 only for now); validate sizes (`file` length
  must equal `W·H·4`); unknown `kind` ⇒ reject.
- Selection state and view state are **not** saved.
- Round-trip acceptance: save → load → deep-equal JSON and byte-equal buffers.

## 8. Local files: File System Access with download fallback

`src/integrations/fsa/` wraps:

- `showSaveFilePicker({ suggestedName, types })` / `showOpenFilePicker` when
  available (Chromium); keep returned handles per doc so plain `Ctrl+S` on a
  local-file doc overwrites silently (re-request permission via
  `handle.requestPermission({ mode: 'readwrite' })` after reload).
- Fallback (Firefox/Safari): open via `<input type=file>`, save via
  `URL.createObjectURL` + anchor download (no silent overwrite — every save
  downloads).

## 9. Autosave & crash recovery

- Every 30 s, each dirty doc serialises to `.monet` bytes → IndexedDB
  `autosave:<docId>` `{ name, savedAt, bytes }` (idb-keyval). Keep ≤ 10, LRU.
- Clean close of a doc (or successful save) deletes its entry.
- On boot, existing entries raise a **Recover work?** dialog: list (name, age,
  16-px thumbnail decoded from the bytes), buttons Open / Discard per row.

## 10. Acceptance

- Export each format from a 16×16 test doc with semi-transparency:
  PNG round-trips exactly; JPEG mattes white; WebP appears only on Chromium; ICO
  opens in Windows Explorer and as a favicon with all selected sizes present
  (verify entry count/bytes in the unit test; eyeball once manually); BMP opens in
  Windows Photos/Paint with alpha intact in apps that honour V4 alpha; PDF page
  orientation/fit passes the §6 fixtures.
- `.monet` round-trip is byte-exact; a corrupted zip and a bad version both show a
  clean error toast, never a crash.
- With FS Access available, `Ctrl+S` on a local file overwrites in place after one
  permission grant; fallback path downloads.
- Kill the tab mid-edit → relaunch offers recovery; recovered doc matches the last
  autosave tick.

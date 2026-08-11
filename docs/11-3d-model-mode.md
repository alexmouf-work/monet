# 11 — 3D model mode (design)

**Status: in build** (started 2026-08-10; owner approved, D11.1 = raw WebGL2, D11.2 = Onshape mapping). This is the contract for
M13–M19; `docs/ARCHITECTURE.md` continues to describe what exists.

Supersedes the exclusion "3D anything" in `docs/00 §4` / `docs/CONTEXT.md §Scope` — owner request
2026-08-10.

---

## 1. What this is

A second **document kind**. Monet gains model documents alongside image documents; both live in
the same tab bar, the same window and the same chrome. A model document shows a Minecraft object
in a 3D viewport that you can orbit and pan, paint on directly with the existing brushes, edit
the geometry of (Blockbench's capability, Onshape's interaction discipline), and from which you
can jump to the exact texture behind any face you are looking at.

Four capabilities, in the owner's words, with where each is specified:

| Ask | Section |
| --- | ------- |
| Take a Minecraft model + its texture atlas | §4 |
| Move it in 3D — rotate and pan around space | §6 |
| Same UI, different sections | §11 |
| Build models like Blockbench, edit like Onshape | §10 |
| Brushes on the object in 3D | §8 |
| Double-click / middle-click / keybind → that face's texture, extracted on demand | §9 |

**Non-goals for this design**: animation/keyframes, entity rigging beyond static bones, particle
or shader work, importing arbitrary triangle meshes (OBJ/glTF), physics, multiplayer.

---

## 2. Decisions that need making before M13

These change the shape of the work; everything else follows from them.

### D11.1 — Renderer: raw WebGL2 (recommended) vs three.js — **DECIDED: raw WebGL2** (owner, 2026-08-10)

| | raw WebGL2 | three.js |
| --- | --- | --- |
| Bundle | ~0 (hand-written, ~800–1200 LOC) | +150 KB gzipped, and it is a runtime dependency the 01 §1 table has to admit |
| Fit | Geometry is axis-aligned boxes with nearest-sampled textures — the easy case | General-purpose; most of it unused |
| Control | Exact texel sampling, exact pixel snapping, our own picking | Fights you on nearest filtering, colour management, and pixel-exactness |
| Free stuff | none | OrbitControls, transform gizmos, raycaster, glTF loaders |
| Risk | Our own bugs in camera maths and picking | Version churn; a large dep in a project whose identity is "no heavy deps" |

**Recommendation: raw WebGL2.** Boxes are trivial to build and to intersect analytically, we need
pixel-exact control that three.js makes awkward, and the charter's dependency rule exists for a
reason. The cost is roughly a week of camera/gizmo work that three.js would have given free. If
the owner would rather trade bundle size for speed of delivery, three.js is a legitimate answer —
it is a one-way door, so decide before M13 rather than during.

*(WebGL2 supersedes docs/01 §1's "Canvas 2D; no WebGL". 2D documents keep their Canvas 2D
renderer untouched — this is an addition, not a migration.)*

### D11.2 — Navigation mapping — **DECIDED: the Onshape-leaning table below** (owner, 2026-08-10)

Monet's 2D mode already means: middle-drag = pan, `Space`+drag = pan, wheel = zoom at cursor.
Blockbench uses left-drag to orbit; Onshape uses middle-drag to orbit and `Ctrl`+middle to pan.
Left-drag cannot orbit here — it paints.

**Recommendation (Onshape-leaning, and consistent with 2D):**

| Input | 3D |
| ----- | -- |
| middle-drag | **orbit** |
| `Ctrl`/`Shift` + middle-drag, or `Space`+drag | pan |
| wheel | dolly (zoom at cursor) |
| right-drag | orbit (alias, for mice without a usable middle button) |
| left-drag | the active tool (paint, select, gizmo) |

This moves middle-drag off "pan", which is a real break with the 2D habit. Mitigation: `Space` is
pan in both modes, and a **Navigation preference** offers a Blockbench preset. Worth confirming.

### D11.3 — What "open the texture for this face" opens

Two behaviours, and the right one depends on the model (§9.2): the **whole texture file** with the
face's UV rect selected, or **just the UV region**, extracted into its own small document that
writes back into the sheet. Recommendation: pick automatically per face, with a preference to
force one. Needs a decision only if the owner disagrees with the automatic rule.

---

## 3. Document model

```ts
// A tab is now one of two things.
type Doc = ImageDoc | ModelDoc;          // ImageDoc = today's MonetDoc, renamed

interface ModelDoc {
  kind: 'model';
  id: string; name: string; dirty: boolean;
  binding?: SourceBinding;               // unchanged: repo/folder/jar + path
  format: 'java_block' | 'java_item' | 'bedrock_geo' | 'monet_model';
  unit: 16;                              // model units per block; fixed, but explicit
  elements: ModelElement[];              // flat; hierarchy via groupId
  groups: ModelGroup[];
  textures: Record<string, TextureRef>;  // "all", "layer0", … (the '#' is not stored)
  display?: Record<DisplaySlot, DisplayTransform>;
  ambientocclusion?: boolean;
  guiLight?: 'front' | 'side';
  camera: CameraState;                   // persisted with the doc, per tab
  vanillaMode: boolean;                  // enforce §13.2 legality while editing
}

interface ModelElement {
  id: number; name: string;
  groupId: number | null;
  from: Vec3; to: Vec3;                  // model units, -16..32 (vanilla), any (free)
  rotation?: { origin: Vec3; axis: Axis; angle: number; rescale?: boolean };
  faces: Partial<Record<Face, ModelFace>>;
  shade?: boolean;
  visible: boolean; locked: boolean;
}

interface ModelFace {
  uv: [number, number, number, number];  // 0..16 in the referenced texture's space
  texture: string;                       // key into ModelDoc.textures
  rotation?: 0 | 90 | 180 | 270;
  cullface?: Face;
  tintindex?: number;
}

interface ModelGroup {                   // Blockbench "bone"/folder
  id: number; name: string;
  parentId: number | null;
  origin: Vec3;                          // pivot
  rotation?: Vec3;                       // Euler, free-form models only
  visible: boolean; locked: boolean;
}

type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
type Axis = 'x' | 'y' | 'z';

/** Where a texture variable's pixels actually live. */
type TextureRef =
  | { kind: 'file'; sourceId: string; path: string; width: number; height: number }
  | { kind: 'region'; sourceId: string; path: string;   // an atlas/sheet
      rect: Rect; sheetWidth: number; sheetHeight: number }
  | { kind: 'unresolved'; ref: string };                 // parent not available (§4.2)

interface CameraState {
  target: Vec3;                          // orbit centre, model units
  yaw: number; pitch: number;            // degrees
  distance: number;
  projection: 'perspective' | 'orthographic';
  fov: number;                           // perspective only
}
```

**Undo**: unchanged mechanism. Element edits are `Command`s through `docStore.execute`, so 3D
edits share the 200-step history, the dirty flag and autosave. `docs/ARCHITECTURE.md`'s rule
still holds: every mutation goes through a command.

**Autosave / `.monet`**: a model document serialises to `.monet_model` (same zip container as
`.monet`: `model.json` + `camera.json` + a manifest). Texture pixels are **not** copied in — the
model references textures, and duplicating them would create two truths.

---

## 4. Input: models and textures

### 4.1 Formats read

| Format | Where from | Notes |
| ------ | ---------- | ----- |
| **Java block model** `assets/<ns>/models/block/*.json` | jar, repo, folder, local file | The main case. `parent` resolution per §4.2. |
| **Java item model** `.../models/item/*.json` | same | `parent: item/generated` is *generated geometry* (§4.4) — read-only in v1. |
| **Bedrock geometry** `*.geo.json` | repo, folder, local file | `texture_width/height` + box UV; maps cleanly onto §3. |
| **Blockbench** `*.bbmodel` | local file | Superset; import only, later milestone. |

### 4.2 Parent resolution

Vanilla models are mostly `{"parent": "minecraft:block/cube_all", "textures": {...}}` — the
geometry lives in the parent. Resolution order:

1. the document's own source (repo/folder), then
2. any **connected jar source** (this is why jar sources already exist — `docs/08 §2`), then
3. a small built-in table of the ~20 most common vanilla parents (`cube_all`, `cube`, `slab`,
   `stairs`, `cross`, `orientable`, …) so a model opens usefully with **no jar connected**.

Unresolved parent ⇒ the document still opens, with a banner naming the missing model and the
elements it could not build. Textures resolve the same way; an unresolved texture renders as the
classic magenta/black checker so it is unmistakable.

Merge rules (vanilla semantics, and they matter): a child's `elements` **replace** the parent's
entirely; `textures` **merge**, child wins; `display` merges per slot; `#var` chains are followed
to a fixed point with a cycle guard.

### 4.3 "The associated texture atlas" — what that means in practice

Two different things wear this name, and the distinction drives §9:

- **Block/item models do not use an authoring atlas.** Each face names a texture *variable*, which
  resolves to a standalone PNG (usually 16×16). Minecraft stitches a runtime atlas; that stitched
  sheet is not what anyone edits. Here, "the face's texture" = that whole PNG → `TextureRef.file`.
- **Sheet-mapped models** (entity textures, Bedrock geometry, many mod models) put every face in
  one sheet with UVs in sheet pixels. That is a real atlas, and "the face's texture" is a
  *rectangle within it* → `TextureRef.region`.

Monet supports both and picks per texture variable, so the owner's "extract on demand from the
atlas" is exactly what happens in the sheet case, and the whole-file open is what happens when a
face's texture *is* a file. An explicit **"Attach atlas…"** action also lets the user point a
model at a sheet manually, for mod formats we do not parse.

### 4.4 Generated item models

`item/generated` builds geometry by extruding the alpha silhouette of `layer0` — an outline trace
plus 1/16-thick walls. Rendering these is straightforward; *editing* them means editing the
sprite, not the geometry. v1: render + paint, geometry read-only. Flag as its own item.

---

## 5. The viewport

One WebGL2 canvas replacing the 2D canvas inside the existing `.workspace` region. Same
`invalidate()` bus, same rAF gating, same "nothing is drawn unless something changed" rule.

**Geometry build**: elements → interleaved vertex buffer (position, normal, uv, faceId), 24
vertices / 36 indices per box. Rebuilt on model change only. Tens of boxes ⇒ rebuild is
sub-millisecond; no need for incremental updates.

**Textures**: one GL texture per `TextureRef`, `NEAREST` min/mag, no mipmaps (Minecraft's look,
and mipmaps would blur texel edges at distance). Updates use `texSubImage2D` **over the dirty
rect only** — per the performance rules, per-event work must scale with the event, not the
document.

**Shading**: Minecraft's fixed directional multipliers so what you paint looks like what you get —
`up 1.0, down 0.5, north/south 0.8, east/west 0.6`. Toggle: *Minecraft shading* / *flat* /
*ambient occlusion preview*.

**Transparency**: alpha-test (`discard` below 0.1) by default = MC's `cutout`. A per-model
*translucent* toggle switches to back-to-front sorted blending.

**Scene furniture**: the 16³ block bounding box, a ground grid on the 1/16 lattice, an origin
axis triad, an optional "in-game context" of neighbour blocks for tiling checks, hover highlight
on the face under the cursor, selection outline on the active element, and the view cube (§6).

---

## 6. Camera and navigation

Orbit camera: `{target, yaw, pitch, distance}` (§3). Pitch clamped to ±89.9° to avoid gimbal
flip at the poles. Zoom is a dolly toward the cursor's ray, matching 2D's zoom-at-cursor feel.

- **Projection toggle** perspective ⇄ orthographic. Ortho matters: it is the only way to judge
  pixel alignment honestly, and it matches how Minecraft draws items in the GUI.
- **View cube**, top-right of the viewport (Onshape's, and the reason to have one): click a face
  → snap to that orthographic view; click an edge/corner → the 45° views; drag it to orbit. This
  doubles as the answer to "which way am I looking?", which matters once faces are being edited.
- **Standard views**: `1`/`3`/`7`-style numeric shortcuts (front/side/top), `5` toggles ortho.
- **Frame**: `Ctrl+0` frames the whole model, `.` frames the selection — the same keys 2D uses for
  fit, so the muscle memory survives.
- Camera state persists per document, so switching tabs does not lose your viewpoint.

---

## 7. Picking

**CPU ray casting, not a GPU ID buffer.** Cast a ray from the camera through the cursor; for each
element, transform the ray into the element's local space (inverse of its rotation about its
origin) and run a slab test against its AABB; keep the nearest hit. Boxes make this exact and
cheap — tens of elements is microseconds, versus a `readPixels` stall per pointer event, which
§14 forbids.

A hit yields everything downstream needs:

```ts
interface FaceHit {
  elementId: number;
  face: Face;
  point: Vec3;              // model space
  uvNorm: Vec2;             // 0..1 within the face's UV rect, face rotation applied
  texture: TextureRef;
  texel: Vec2;              // integer pixel in the texture's own space
  distance: number;
}
```

Rules: back faces are ignored; invisible/locked elements are skipped; faces with no `uv` inherit
the element's projected extent (vanilla default) so they are still hittable and paintable.

*(If non-box geometry ever arrives — generated item models with real outlines, imported meshes —
the ID-buffer approach becomes the fallback. Designed for, not built.)*

---

## 8. Painting in 3D

**The 3D tools do not paint. They generate texture coordinates and hand them to the existing 2D
stroke engine**, which already owns coverage accumulation, max-blending, undo commands and
preview overlays. Pen, marker, eraser, bucket and eyedropper all work unchanged; brush size stays
in *texture* pixels, so a 4 px brush covers the same texels it would in 2D.

Per pointer event: ray → `FaceHit` → texel → feed the stroke engine for the texture document that
owns that texture.

Four things this has to get right:

1. **Interpolation happens in texture space, not screen space.** Consecutive hits on the *same
   face* are joined with the existing Bresenham walk. When a drag crosses to a different face or
   a different texture, the current segment **ends and a new one begins** — interpolating across
   a UV discontinuity would draw a line through unrelated texels.
2. **One stroke, one undo step**, even when it crossed four faces of one texture: the stroke
   engine already commits once on pointer-up over the union of its dirty rect.
3. **Live preview** comes from re-uploading the stroke overlay's dirty rect to the GL texture each
   frame the stroke changes.
4. **Seams are not solved in v1.** A brush crossing a UV island edge stops at the edge, and the
   adjacent island keeps its old pixels — the classic seam. Options for later, in order of cost:
   post-stroke edge bleed (dilate N texels into neighbouring islands), or true 3D-distance
   painting that finds every island within the brush radius in *model* space. Say so in the UI
   rather than pretending: a *seam bleed: off/1px/2px* control, defaulting to off.

**Targeting when the texture is not open**: painting a face whose texture has no open document
opens one silently (a background document, in the tab bar) so there is always a real
`ImageDoc` — and therefore a real undo history and a real save path — behind every stroke.

---

## 9. Face → texture ("open what I am looking at")

### 9.1 Triggers

| Input | Behaviour |
| ----- | --------- |
| **double-click** a face | open its texture |
| **middle-click** a face | open its texture (no camera move; middle-drag still orbits — a drag beyond ~3 px cancels the click) |
| **`Enter`** | open the texture of the *selected* face, else the face under the cursor, else **the face at the centre of the viewport** — literally "the one I am looking at" |
| `Ctrl+Enter` | open the whole sheet/atlas even when the face maps to a region |
| double-click empty space | frame the model (harmless, discoverable) |

### 9.2 What opens, and how it stays connected

- `TextureRef.file` (block/item case): open that PNG as a normal image document, and **select the
  face's UV rect** so the relevant area is obvious. Everything already built — save, push, undo —
  applies unchanged.
- `TextureRef.region` (sheet/atlas case): **extract the rect on demand** into an image document
  whose binding carries the region:

  ```ts
  binding = { sourceId, path: 'textures/entity/chair.png', region: { x, y, w, h } }
  ```

  Saving blits the region back into the sheet (read sheet → replace rect → write), so `Ctrl+S`
  behaves exactly as it does for a whole file, including repo commit-and-push. Extraction is
  cached per region, so re-opening the same face returns the same document rather than a second
  copy that could diverge.

### 9.3 The link is live and two-way

While a texture document is open, **it is the source of truth for that texture** and the 3D view
renders from its pixels — so painting in 2D updates the model instantly, and painting in 3D
updates the 2D canvas instantly. This falls out of the existing invariant ("`pixels` is truth,
canvases are caches") extended to GL textures, and it is the feature that makes the two modes feel
like one program.

Extras that follow cheaply once faces map to rects:
- **UV guides** in the 2D editor: outlines of every face that maps into this texture, labelled,
  toggleable. Painting a 16×16 block texture while seeing which 4×4 patch is the top face is the
  whole point.
- **Hover reciprocity**: hovering a face in 3D highlights its rect in the open 2D document, and
  vice-versa.

---

## 10. Modelling: Blockbench capability, Onshape interaction

### 10.1 The Onshape idea that actually applies

Onshape's defining trait is that nothing is destructive: every operation stays in a feature tree
you can reopen and re-parameterise forever. Copying that literally would mean building a replay
graph on top of the command history — weeks of work and a second source of truth.

**It is not needed here, because a Minecraft model already _is_ its own parameter list.** Every
cube is `{from, to, rotation, faces}` and stays editable by number for as long as it exists;
there is no "extrude" whose inputs get baked away. So Monet gets Onshape's *actual* benefit —
reopen any parameter at any time — for free, and the **outliner is the feature tree**.

What is worth taking from Onshape, in priority order:

1. **Numeric-first editing.** Every property is a typed field with units; dragging a gizmo is a
   convenience over the number, never the only way to reach it. Fields accept arithmetic
   (`8+2`, `16/3`) and fractions of a block.
2. **Inference and snapping** while dragging: the 1/16 lattice by default (⇧ for 1/2 texel, `Alt`
   for free), plus snapping to other elements' faces, edges, centres and shared planes, with
   transient inference lines when an axis aligns with something.
3. **A real selection hierarchy**: group → element → face → edge/vertex, with a selection filter
   so box-select can be told to take only faces. Click cycles depth; `Esc` climbs out.
4. **Constrained gizmos**: translate/rotate/scale with per-axis handles, planar handles, and a
   live numeric readout that is also an input while dragging.
5. **Context menus on right-click** carrying the operations relevant to what is selected.
6. **Measurement**: a dimension readout between selected faces/edges, in model units *and*
   texels — this is how you check a chair leg is 2 px thick without counting.

Deliberately not taken: sketches and extrusion (there is nothing to extrude — boxes are primitive
here), assemblies, mates, configurations, the rollback bar.

### 10.2 Blockbench capability parity

Element ops: add cube (at origin, on a picked face, or by dragging a box in the viewport), delete,
duplicate, mirror across an axis, rename, colour-tag, lock, hide. Group ops: create/nest, set
pivot, rotate about pivot, drag between groups in the outliner.

Transforms: move/resize by face-handle dragging or by number; rotate about the element origin;
"inflate" (uniform grow, MC's `inflate` idiom); pivot editing with a visible origin marker.

UV: per-face rect with numeric fields, box-UV auto-mapping for sheet models, face rotation in 90°
steps, mirror U/V, "fit to element face", copy/paste UV between faces, and a UV editor panel that
draws the rects over the texture (the 2D document, live).

Display transforms: the `display` slots (gui, head, thirdperson_*, firstperson_*, ground, fixed)
with a preview that renders the model exactly as Minecraft would in that context — the fastest way
to catch a model that looks right in the editor and wrong in hand.

---

## 11. UI: the same shell, different sections

The owner's constraint is that the chrome does not move. It does not: every region keeps its
position, size and behaviour; only the contents of the workspace and the contextual panels differ.
The mode follows the **active document**, so a `.json` model and a `.png` texture are two tabs in
the same window and switching between them switches modes.

| Region | 2D document | Model document |
| ------ | ----------- | -------------- |
| Top bar | unchanged | unchanged |
| Feature tabs | Brushes · Shapes · Text · Noise · Recolour · Canvas | **Model · UV · Brushes · Noise · Recolour · Display** |
| Tool rail (Select/Pan) | marquee / pan | element+face select / camera pan |
| Toolbar row | file · history · clipboard · canvas · view | file · history · clipboard · **element** (add/duplicate/delete/mirror) · view (**view cube presets, ortho toggle, shading**) |
| Sources sidebar | textures | textures **and models** (new node type, cube badge) |
| Doc tabs | unchanged — both kinds, model tabs carry a cube glyph |
| **Workspace** | Canvas 2D | **WebGL2 viewport** (§5) |
| Options panel | tool settings | **selected element/face properties**: from/to, rotation, pivot, UV, texture variable, face flags |
| Colour panel | unchanged — 3D painting uses the same colour, alpha, palette and eyedropper |
| Status bar | coords · size · zoom · colour · save | **hovered element + face · texel under cursor · selection dims · camera** · colour · save |

Feature tabs that are meaningless on a model (Shapes, Text, Canvas) are hidden rather than
disabled — they reappear the moment a texture document is focused, which is one click away via
§9. Noise and Recolour stay, and act on the active face's texture.

---

## 12. Keymap

3D-only bindings, chosen not to collide with the 2D map in `docs/09 §7`:

| Keys | Action |
| ---- | ------ |
| `Enter` | open the texture for the selected/looked-at face (§9.1) |
| `Ctrl+Enter` | open the whole sheet |
| `1` `3` `7` | front / side / top view · `5` ortho toggle · `9` opposite view |
| `Ctrl+0` / `.` | frame model / frame selection |
| `N` | new cube · `Ctrl+D` duplicate (as in 2D) · `Del` delete |
| `G` `R` `S` | translate / rotate / scale gizmo (Blender-familiar, and `G` is free here) |
| `X` `Y` `Z` | constrain the active gizmo to an axis; twice → the plane |
| `Tab` | cycle selection depth (group → element → face) |
| `Alt` (hold) | disable snapping · `Shift` (hold) | fine snap |
| `B` `M` `E` `F` `I` | brushes, unchanged — they paint on the model |

`G` is currently unbound in 2D; `N` and `Enter` are free. Nothing in the 2D map changes.

---

## 13. Saving, exporting, validating

### 13.1 Round-trip

`Ctrl+S` on a model document writes the model back to its binding — repo commit-and-push, folder
write, or Save-As — in the format it was read as, **preserving unknown keys** so a mod's custom
fields survive an edit. Vanilla JSON is written in Minecraft's own key order and 0–16 numbers,
formatted so a diff against the original stays readable.

### 13.2 Vanilla legality (the `vanillaMode` flag)

Free-form editing can produce models Minecraft silently refuses. Validate continuously and mark
offences in the outliner:

- element rotation: **one axis only**, angle ∈ {−45, −22.5, 0, 22.5, 45};
- coordinates within −16..32;
- UVs within 0..16; face `texture` resolves; `cullface` is a real direction;
- non-integer or sub-1/16 coordinates warn (they render, but light and cull oddly).

`vanillaMode: true` *prevents* the illegal edit (snapping the angle to the nearest legal value);
`false` allows it and flags it, for Bedrock/mod targets where the rules differ.

### 13.3 Export

Java block/item JSON · Bedrock `.geo.json` · `.monet_model` project · plus **render to PNG** from
the current camera (an isometric icon of the model is a thing people actually need) using the
existing export pipeline once the framebuffer is read back.

---

## 14. Performance rules (extending `docs/ARCHITECTURE.md §Performance rules`)

- **No `readPixels` per pointer event.** Picking is CPU ray casting (§7). The one legitimate
  readback is PNG render-export, which is user-initiated and rare.
- **Texture uploads are dirty-rect** (`texSubImage2D`), never whole-texture per frame.
- **Geometry rebuilds on model change, not per frame**; a camera move re-renders without touching
  buffers.
- The renderer keeps the existing invalidate gate: **orbiting is the only continuous redraw**, and
  it must hold 60 fps on integrated graphics for a 200-element model.
- Model documents must not slow 2D documents: the GL context is created on first model open and
  released (with `WEBGL_lose_context`) when the last model tab closes.
- Add `model-orbit`, `model-paint` and `model-pick` measurements to `tests/manual/scenarios/perf`.

---

## 15. Risks and open questions

| # | Risk | Mitigation / where it is decided |
| - | ---- | -------------------------------- |
| 1 | Renderer choice is a one-way door | D11.1, decide before M13 |
| 2 | Middle-drag conflict with 2D pan habit | D11.2 + a navigation preference |
| 3 | Seam painting is genuinely hard | v1 ships without it, says so in the UI (§8.4) |
| 4 | Two faces sharing overlapping UVs — editing one silently changes the other | Detect overlaps at load; warn on the affected faces; highlight all users of a rect on hover |
| 5 | Parent resolution needs a jar | Built-in table for common parents; explicit banner otherwise (§4.2) |
| 6 | Generated item models are not box geometry | Render + paint only in v1 (§4.4) |
| 7 | WebGL context loss (tab suspend, driver reset) | Handle `webglcontextlost`, rebuild from the document — the document is the truth, the GL state is a cache |
| 8 | Animated textures (`.mcmeta` strips) | Show frame 0; paint the strip as a whole; animation preview is a later item |
| 9 | Scope: this is comparable in size to everything built so far | Milestones are independently useful — M13 alone (view + face→texture) is already a better texture workflow than none |

**Open questions for the owner**: ~~D11.1 renderer~~ (decided: raw WebGL2), ~~D11.2 navigation~~
(decided: Onshape mapping), and whether Bedrock `.geo.json` matters in v1 or Java-only is
enough to start (building Java-first until told otherwise).

---

## 16. Milestones

Each ends runnable and demoable, per `docs/10`.

### M13 — Model documents and the viewport
Model document kind; Java block/item JSON parsing with parent + texture resolution (§4);
WebGL2 renderer with MC shading, cutout alpha, block bounds, grid (§5); orbit/pan/dolly, ortho
toggle, view cube, standard views (§6); models in the sources tree; camera persisted per tab.
**Accept:** open `block/stairs.json` from a vanilla jar with no other setup and orbit it at 60 fps;
a model tab and a texture tab coexist and switch cleanly; an unresolved parent degrades to a
banner, never a crash.

### M14 — Faces to textures
Ray picking + hover highlight (§7); double-click / middle-click / `Enter` → texture (§9.1);
region extraction with a region binding and write-back (§9.2); the live two-way link (§9.3); UV
guides in the 2D editor.
**Accept:** `Enter` with nothing under the cursor opens the texture for the face at the viewport
centre; a region edited and saved lands in the right rectangle of the sheet, byte-compared; edits
in 2D appear in 3D without a save.

### M15 — Painting on the model
Brushes/eraser/bucket/eyedropper through `FaceHit` into the stroke engine (§8); per-face stroke
segmentation; dirty-rect GPU upload; undo unified with the texture's history.
**Accept:** one drag across three faces of one texture = one undo step and no line through
unrelated texels; brush size in texels matches 2D exactly; painting a face whose texture is not
open still produces a saveable document.

### M16 — Modelling I
Add/delete/duplicate/mirror cubes; numeric properties panel; translate/rotate/scale gizmos with
axis constraint, snapping and live numeric readout; groups, pivots, outliner; vanilla validation
(§13.2).
**Accept:** build a four-legged stool from scratch, save it as vanilla JSON, and load it in
Minecraft unmodified; every illegal rotation is refused in `vanillaMode` and flagged outside it.

### M17 — UV editing
Per-face UV rects with numeric fields; box-UV auto-map; face rotation/mirror; fit-to-face;
copy/paste UV; the UV editor panel over the live texture.
**Accept:** box-UV a new cube onto a 64×32 sheet and see all six faces land in the right places in
both the UV panel and the 3D view.

### M18 — Onshape-grade interaction
Inference and snapping engine; selection filters and depth cycling; measurement readouts;
context menus; view-cube refinements; multi-select transforms.
**Accept:** align a cube face-to-face with another using only inference (no typing); measure a
2-texel gap and have it agree with the numbers.

### M19 — Export and round-trip
Java block/item writer preserving unknown keys and key order; Bedrock `.geo.json`;
`.monet_model`; display-transform editor with per-slot preview; render-to-PNG.
**Accept:** read → edit → write a vanilla model and diff cleanly against the original except for
the intended change; the `gui` display preview matches Minecraft's inventory rendering.

---

## 17. Acceptance for the mode as a whole

- Open a Minecraft model and its texture, orbit it, paint on it, and save — with the same
  toolbar, sidebar, colour panel and shortcuts as 2D, and no mode switch beyond picking a tab.
- Look at any face, press one key, edit that texture, and see the model update as you paint.
- Build a model that Minecraft loads without modification.

# 04 — Noise

The Noise feature tab applies procedural texture to the image — the core "make this
surface look like stone/wood/cloth" tool for Minecraft textures. It is a
**previewed, bakeable adjustment**: parameters drive a live preview; **Apply** bakes
into the paint layers via one undoable command; **Cancel/Reset** discards.

Noise affects **raster layers only** (A2; the panel shows the standing hint when
objects exist). It applies to the whole canvas — no selection interaction in v1.

## 1. Parameters (panel spec — placement in [09 §3.4])

| Control | Range / values | Default |
| ------- | -------------- | ------- |
| **Type** | 13 types, grouped dropdown (§3) | `perlin` |
| **Rotation** | 0–360°, slider + numeric | 0 |
| **Scale** ("zoom") | slider over log₂ ∈ [−3, +3] → `z = 2^s` ∈ [0.125, 8] | 1 |
| **Intensity** | 0–100 % | 50 |
| **Affect** | checkboxes **Brightness**, **Hue** (both allowed; both-off disables Apply) | Brightness ✓, Hue ✗ |
| **Seed** | uint32 numeric + 🎲 re-roll (`crypto.getRandomValues`) | random at panel-open |
| Buttons | **Apply** (bake), **Reset** (back to defaults + fresh preview) | |

## 2. Sampling model

Every noise type is a scalar field `n(x, y) ∈ [−1, 1]` evaluated per document pixel.
The pattern is positioned by centring, rotating and zooming the *lookup*:

```
q  = (x + 0.5 − W/2,  y + 0.5 − H/2)            // centred doc coords
u  =  qx·cosθ + qy·sinθ                          // inverse-rotate the lookup ⇒
v  = −qx·sinθ + qy·cosθ                          //   the pattern rotates CW by θ
nx = u / (CELL · z),  ny = v / (CELL · z)        // CELL = 8 px base feature size
n  = field(type, nx, ny, seed)                   // except the canvas-extent types, §3
```

Zoom `z` therefore scales feature size (z = 2 → features twice as large); rotation
spins the pattern about the canvas centre. Rotating `radial`/`rings` is a no-op by
symmetry (fine). The `white` type uses `CELL = 1` so it is per-pixel at z = 1.

The field is evaluated once into a `Float32Array(W*H)` **noise map** whenever any of
{type, rotation, scale, seed, doc size} changes; intensity/affect changes reuse the
map (they only alter application, §5). At 512² this is ≤ 15 ms for the priciest
type — synchronous is fine.

## 3. The 13 noise types — `core/noise/fields.ts` (reference implementation)

Grouped in the dropdown:

- **Organic**: `perlin`, `clouds`, `value` (soft blobs), `cells` (Worley), `marble`, `wood`
- **Geometric**: `stripes`, `zigzag`, `checker`, `rings`
- **Gradients**: `gradient` (up/down), `radial`
- **Random**: `white`

All are built from one deterministic integer hash — **no `Math.random()` anywhere**:

```ts
/** Deterministic hash → [0,1). Never change these constants once shipped. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
        ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
const frac = (t: number) => t - Math.floor(t);
const tri  = (t: number) => 1 - 4 * Math.abs(frac(t) - 0.5);        // triangle wave, [−1,1]

function gdot(ix: number, iy: number, dx: number, dy: number, seed: number): number {
  const a = hash2(ix, iy, seed) * Math.PI * 2;                       // hashed unit gradient
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

export function perlin(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const u = fade(fx), v = fade(fy);
  const n00 = gdot(x0,     y0,     fx,     fy,     seed);
  const n10 = gdot(x0 + 1, y0,     fx - 1, fy,     seed);
  const n01 = gdot(x0,     y0 + 1, fx,     fy - 1, seed);
  const n11 = gdot(x0 + 1, y0 + 1, fx - 1, fy - 1, seed);
  return clamp1(lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) / 0.70710678);
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const u = fade(x - x0), v = fade(y - y0);
  return lerp(lerp(hash2(x0, y0,     seed), hash2(x0 + 1, y0,     seed), u),
              lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), u), v) * 2 - 1;
}

export function fbm(x: number, y: number, seed: number): number {   // 4 octaves of perlin
  let sum = 0, amp = 0.5;
  for (let o = 0; o < 4; o++) {
    sum += amp * perlin(x * (1 << o), y * (1 << o), seed + o);
    amp *= 0.5;
  }
  return clamp1(sum / 0.9375);
}

export function cells(x: number, y: number, seed: number): number {  // Worley F1
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = Infinity;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const px = cx + hash2(cx, cy, seed), py = cy + hash2(cx, cy, seed + 101);
    f1 = Math.min(f1, Math.hypot(px - x, py - y));
  }
  return clamp1(Math.min(f1, 1) * 2 - 1);                            // −1 at cell centres
}
```

The remaining types, defined over the §2 coordinates (`nx, ny` and, where noted, the
raw centred `q` plus doc size):

```ts
export type NoiseType = 'perlin'|'clouds'|'value'|'cells'|'marble'|'wood'
  |'stripes'|'zigzag'|'checker'|'rings'|'gradient'|'radial'|'white';

export interface NoiseEnv {          // everything §2 computed for this pixel
  qx: number; qy: number;            // centred doc coords (unrotated)
  u: number; v: number;              // rotated doc coords (px)
  z: number; W: number; H: number;
}

export function sampleNoise(t: NoiseType, nx: number, ny: number, seed: number,
                            e: NoiseEnv): number {
  switch (t) {
    case 'perlin':  return perlin(nx, ny, seed);
    case 'clouds':  return fbm(nx, ny, seed);
    case 'value':   return valueNoise(nx, ny, seed);
    case 'cells':   return cells(nx, ny, seed);
    case 'marble':  return clamp1(Math.sin(2 * Math.PI * (nx + 1.5 * fbm(nx * 0.5, ny * 0.5, seed))));
    case 'wood':    return tri(Math.hypot(nx, ny) + 0.8 * fbm(nx * 0.7, ny * 0.7, seed + 7));
    case 'stripes': return frac(nx) < 0.5 ? 1 : -1;
    case 'zigzag':  return tri(nx + 0.5 * tri(ny));                  // chevrons
    case 'checker': return ((Math.floor(nx) + Math.floor(ny)) & 1) ? -1 : 1;
    case 'rings':   return Math.sin(2 * Math.PI * Math.hypot(nx, ny));
    case 'gradient':                                                 // up/down; rotation gives any direction
      return clamp1(e.v / (e.z * e.H / 2));
    case 'radial':                                                   // centre bright → edge dark
      return clamp1(1 - 2 * Math.min(1, Math.hypot(e.qx, e.qy) / (e.z * Math.min(e.W, e.H) / 2)));
    case 'white':                                                    // per-pixel at z=1 (CELL=1)
      return hash2(Math.floor(e.u / e.z), Math.floor(e.v / e.z), seed) * 2 - 1;
  }
  return 0;
}
```

Keep the switch in one function so the noise-map builder stays a single double loop.

## 4. The noise map builder — `core/noise/apply.ts`

```ts
export interface NoiseParams { type: NoiseType; rotationDeg: number; z: number;
                               seed: number; intensity: number;      // 0–100
                               brightness: boolean; hue: boolean; }

export function buildNoiseMap(W: number, H: number, p: NoiseParams): Float32Array {
  const out = new Float32Array(W * H);
  const th = (p.rotationDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const CELL = 8 * p.z;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const qx = x + 0.5 - W / 2, qy = y + 0.5 - H / 2;
    const u = qx * c + qy * s, v = -qx * s + qy * c;
    out[y * W + x] = sampleNoise(p.type, u / CELL, v / CELL, p.seed,
                                 { qx, qy, u, v, z: p.z, W, H });
  }
  return out;
}
```

## 5. Applying to pixels (brightness / hue / both)

Per raster layer, from a **snapshot** taken at panel-open (`before` buffers), into a
preview buffer (`after`), skipping fully transparent pixels; alpha never changes:

```ts
export function applyNoise(before: Uint8ClampedArray, after: Uint8ClampedArray,
                           map: Float32Array, p: NoiseParams): void {
  const k = p.intensity / 100;
  for (let px = 0, i = 0; px < map.length; px++, i += 4) {
    const a = before[i + 3];
    if (a === 0 || (!p.brightness && !p.hue)) {
      after[i] = before[i]; after[i+1] = before[i+1]; after[i+2] = before[i+2]; after[i+3] = a;
      continue;
    }
    let [h, s, l] = rgbToHsl(before[i], before[i + 1], before[i + 2]);   // h 0–360, s/l 0–1
    const n = map[px];
    if (p.brightness) l = Math.max(0, Math.min(1, l + n * k * 0.5));     // ±50 % L at full intensity
    if (p.hue)        h = (h + n * k * 180 + 360) % 360;                 // ±180° at full intensity
    const [r, g, b] = hslToRgb(h, s, l);
    after[i] = r; after[i + 1] = g; after[i + 2] = b; after[i + 3] = a;
  }
}
```

Notes: hue shifts are invisible on pure greys (saturation 0) — expected, mention in
a tooltip. Brightness at |n·k| = 1 clamps at black/white — fine.

## 6. Preview / bake lifecycle

1. **Panel opens** (Noise tab selected): snapshot every raster layer's `pixels`
   (`Map<layerId, Uint8ClampedArray>`); build the noise map; compute previews.
2. **Param change**: rebuild the map only when {type, rotation, scale, seed}
   changed; re-run `applyNoise` per layer; the renderer draws preview buffers in
   place of layer caches ([01 §4] step 5). Recompute is synchronous on the change
   event (fast at our sizes); slider drags recompute on each input event but ≤ 30 Hz
   (throttle with `requestAnimationFrame`).
3. **Apply**: write previews into `pixels` via one `StrokeCommand` (full-canvas
   rect, before = snapshot, after = preview) per bake; keep the panel open with a
   **fresh snapshot** (so consecutive bakes stack); re-roll nothing.
4. **Leave tab / Reset / doc switch**: drop previews and snapshots; the document is
   untouched unless Apply was pressed. Undo after Apply restores exactly.

## 7. Acceptance

- Determinism: same {type, seed, rotation, scale, size} ⇒ byte-identical noise map
  (unit test with locked expected values for `hash2`, `perlin`, `fbm` at fixed
  inputs; record-once then assert).
- Every type renders visibly distinct patterns on a 64² grey canvas (E2E screenshot
  gallery, manual eyeball once, then locked as goldens).
- Rotation 90° on `stripes` turns vertical bars horizontal; scale 2 doubles bar
  width; `gradient` at rotation 0 runs dark-top → light-bottom at Brightness mode.
- Intensity 0 ⇒ preview identical to source; 100 ⇒ full ±0.5 L swing.
- Hue-only mode leaves L untouched (assert per-pixel HSL L equal within ±1/255).
- Transparent pixels stay untouched byte-for-byte; alpha channel never changes.
- Apply → Undo restores the pre-bake buffers exactly; Apply twice stacks.

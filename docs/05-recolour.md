# 05 — Recolour and Relight

Two modes in one feature tab, switched by a segmented control: **Replace** (swap
specific colours) and **Tint** (uniform recolour respecting brightness). Both are
previewed adjustments with the same snapshot/preview/bake lifecycle as noise
([04 §6]); both act on **raster layers only** (A2), whole canvas, alpha preserved.

## 1. Panel spec (placement in [09 §3.5])

**Mode: Replace**

| Control | Behaviour |
| ------- | --------- |
| **Target colours** | vertical chip list; each chip = swatch + hex field + eyedropper button + ✕ remove. **`+` button appends a chip** (no limit). Starts with one chip pre-filled with the active colour. |
| **Tolerance** | 0–100 % slider, default **0** (exact match), same metric as the bucket (A8) |
| **Similar colours** | segmented: **Keep their differences** (default) / **Flatten to one** — §3.1. A hint line below says which is in force, and that at 0 % tolerance it makes no difference. |
| **Result colour** | one swatch + hex field + eyedropper |
| **Preview** | toggle switch, default **on** |
| **Recolour** | bakes (disabled while no valid target) |

**Mode: Tint**

| Control | Behaviour |
| ------- | --------- |
| **Result colour** | swatch + hex + eyedropper |
| **Amount** | 0–100 % slider, default 100 |
| **Preview** | toggle, default on |
| **Recolour** | bakes |

Chip hex fields accept `#RGB`/`#RRGGBB`; invalid text outlines the chip red and the
chip is skipped. The eyedropper button arms a one-shot canvas pick into that chip.

## 2. Colour conversions — `core/color/convert.ts` (reference implementation)

Canonical for the whole app (noise uses these too). `r,g,b ∈ 0–255` ints;
`h ∈ [0,360)`, `s,l ∈ [0,1]`.

```ts
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else                 h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0, gn = 0, bn = 0;
  if (hp < 1)      [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else             [rn, gn, bn] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((rn + m) * 255), Math.round((gn + m) * 255), Math.round((bn + m) * 255)];
}
```

Unit tests: round-trip every 8th RGB value (`|Δ| ≤ 1` per channel), plus exact
fixtures for primaries, greys, black, white. `hexToRgb`/`rgbToHex` live here too.

## 3. Mode A — Replace — `core/recolor/replace.ts`

```ts
export interface ReplaceParams { targets: Rgb[]; tolerance: number /*0–255*/; result: Rgb; }

export function applyReplace(before: Uint8ClampedArray, after: Uint8ClampedArray,
                             p: ReplaceParams): void {
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    let hit = false;
    if (a !== 0) {
      for (const t of p.targets) {
        if (Math.max(Math.abs(before[i] - t.r), Math.abs(before[i+1] - t.g),
                     Math.abs(before[i+2] - t.b)) <= p.tolerance) { hit = true; break; }
      }
    }
    after[i]     = hit ? p.result.r : before[i];
    after[i + 1] = hit ? p.result.g : before[i + 1];
    after[i + 2] = hit ? p.result.b : before[i + 2];
    after[i + 3] = a;                                   // alpha always preserved
  }
}
```

- Matching ignores alpha (a 50 %-alpha red pixel still counts as red and keeps its
  50 % alpha after replacement).
- Fully transparent pixels are never rewritten (their hidden RGB stays).
- Tolerance is per-channel max over RGB, `T = round(pct/100 * 255)` — identical
  feel to the bucket.

### 3.1 What happens to the *other* matched colours (owner request 2026-08-11)

The snippet above — every matched pixel becomes `result` — is mode **`flat`**. It is no longer
the default, because with any tolerance at all it destroys shading: a sprite's dark green and
very dark green both land on one flat purple.

**`relative` (default)**: each matched pixel is recoloured *relative to the target it matched*,
so the target lands exactly on the result and everything else keeps its distance from it. A
dark green → dark purple takes the very dark green → very dark purple.

Per matched pixel, in HSL, against the target it matched:

| channel | transform | why |
| ------- | --------- | --- |
| hue | `h + (h_result − h_target)` | relative hue differences inside the matched set survive |
| saturation | `matchMap(s_target, s_result, 'shift')` | see below |
| lightness | `matchMap(l_target, l_result, 'shift')` | see below |

- **`shift`, not `scale`** (contrast with §7, where `scale` is the default). Matched pixels are
  by definition *near* the target, so their differences from it are small, and shift is the
  mapping that carries a small difference across unchanged. A ratio would multiply it by
  `result/target`, which for a near-black target is enormous — a 2-step difference could become
  a 50-step one. `matchMap` is imported from `core/relight` rather than reimplemented: one
  definition of "shift", already unit-tested.
- **The target lands on the result exactly**, short-circuited before the HSL round trip, which
  otherwise costs ±1 per channel. It is the anchor everything else is measured from.
- **Achromatic guards.** A grey *target* has no hue to rotate away from, so the result's hue is
  used outright. A grey *pixel* likewise: if it gains saturation here, it gains the result's
  hue, not an arbitrary rotation of an undefined one.
- **At tolerance 0 the two modes are identical** — only the exact target matches, and that is
  the anchor. So this changes nothing for exact-match work, and the panel says so.
- Tolerance still bounds everything: a colour outside it is untouched under either blend.

Properties (asserted in `tests/recolor.test.ts`): the owner's two-greens example lands on a dark
purple and a *darker* purple whose lightness gap equals the greens'; a five-shade ramp comes out
as five distinct shades in the same order; each pixel follows the target *it* matched when there
are several; `flat` still flattens.

## 4. Mode B — Tint — `core/recolor/tint.ts`

"Change the whole image to a certain colour, respecting only the brightness of
pixels" = classic **colourise**: every pixel takes the result colour's hue and
saturation and keeps its own lightness; the amount slider linearly blends the
effect.

```ts
export interface TintParams { result: Rgb; amount: number /*0–1*/; }

export function applyTint(before: Uint8ClampedArray, after: Uint8ClampedArray,
                          p: TintParams): void {
  const [th, ts] = rgbToHsl(p.result.r, p.result.g, p.result.b);   // target hue & saturation
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3];
    if (a === 0) { after.set(before.subarray(i, i + 4), i); continue; }
    const l = rgbToHsl(before[i], before[i + 1], before[i + 2])[2]; // keep pixel lightness
    const [tr, tg, tb] = hslToRgb(th, ts, l);
    after[i]     = Math.round(before[i]     + (tr - before[i])     * p.amount);
    after[i + 1] = Math.round(before[i + 1] + (tg - before[i + 1]) * p.amount);
    after[i + 2] = Math.round(before[i + 2] + (tb - before[i + 2]) * p.amount);
    after[i + 3] = a;
  }
}
```

Properties (assert in tests):
- amount 1 on a greyscale image ⇒ a monochrome ramp of the result colour whose HSL
  lightness per pixel equals the source lightness (±1/255);
- amount 0 ⇒ identity;
- tinting with pure grey (`s = 0`) desaturates while preserving lightness;
- alpha untouched everywhere.

## 5. Preview & bake

Identical lifecycle to noise [04 §6]: snapshot raster layers at tab-open; recompute
previews on any param change (throttled to rAF); **Preview off** shows the
snapshot (not the live document — the two are the same until baked); **Recolour**
writes previews through one `StrokeCommand`, then re-snapshots so repeated bakes
stack; leaving the tab discards. The standing "objects not affected — Flatten
first" hint appears when the stack contains shapes/text.

Both modes recompute in one pass over ≤ 4096² pixels; Replace's inner target loop
is over a handful of chips — no optimisation needed.

## 6. Acceptance

- Replace with targets {grass greens ×3} → result brown on a 16² grass texture
  changes exactly the matching pixels; a 1-off-colour pixel is untouched at
  tolerance 0 and caught at 1 %.
- The `+` button grows the target list arbitrarily; removing chips works; invalid
  hex chips are skipped and flagged.
- Preview toggle flips the canvas between source and previewed states with no
  document mutation (undo stack length unchanged until Recolour).
- Tint 100 % turns a stone texture uniformly blue with shading intact (lightness
  histogram before = after within rounding); 50 % is a visible half-blend.
- Undo after each bake restores byte-identical buffers.
- Semi-transparent pixels keep their exact alpha through both modes.

---

## 7. Relight — `core/relight/relight.ts` (owner request 2026-08-11)

Recolour's cousin. It **never touches hue**: it changes only how bright a pixel is, and
carries the whole image along one curve so shading stays coherent.

### 7.1 What "brightness" means

A choice, because the word is ambiguous and the two readings disagree:

| Measure | Definition | Behaviour |
| ------- | ---------- | --------- |
| `lightness` (**default**) | HSL `L` | Hue **and saturation** survive exactly, and every target is reachable. A pale blue set to a dark green's L becomes a dark blue of that hue. |
| `luma` ("Perceived") | Rec.709 `0.2126R + 0.7152G + 0.0722B` | Truer when comparing across hues, but **not always reachable**: pure blue's luma tops out at 0.07, so matching a mid green means blending toward white. It clamps rather than shifting hue. |

Setting a new brightness: `lightness` goes through HSL and is exact. `luma` scales the
channels down (hue-preserving) or blends toward white to go up — the only way to raise a
saturated colour's luma at all.

### 7.2 Mode A — Match

Pick a colour in the image (`from`) and the brightness to give it (`to`, itself picked from
any colour). The pair defines a monotone map over the whole 0–1 range, applied to every
pixel — that is the point: relighting one colour alone would break the shading against its
neighbours.

| Mapping | Curve | Keeps | Costs |
| ------- | ----- | ----- | ----- |
| `scale` (**default**) | `l · (to/from)` | shading **ratios** — the physical model of "the light got dimmer" | bright pixels clip |
| `curve` | `l^γ`, `γ = ln(to)/ln(from)` | black and white pinned; nothing clips | shades below the anchor compress hard |
| `shift` | `l + (to − from)` | the **spacing** between shades, exactly | both ends clip |

All three hit the anchor exactly and are monotone, so shading order never inverts.
Degenerate anchors (0 or 1) fall back to a two-segment line, since no exponent moves them.

Optional **"only this colour (and near it)"** restricts the effect with Replace's per-channel
Chebyshev tolerance; off by default.

### 7.3 Mode B — Adjust

Brightness (shift) and Contrast (pivot at mid-grey, factor `(1+c)/(1−c)` so ±c are
reciprocal) over the whole image, same measure choice, same hue guarantee.

### 7.4 Preview, bake and amount

Shares §5's session. `amount` blends the relit pixel against the original.

**Baking consumes the adjustment**: the session re-snapshots from the baked pixels so bakes
can stack, so an unchanged panel would relight the already-relit image a second time the
instant you click. Match re-anchors `from` on the colour it became (making the map an
identity); Adjust zeroes its sliders. What you see after the bake is what you baked.

### 7.5 Acceptance

- A pale blue matched to a dark green's brightness becomes a **dark blue at that brightness**,
  hue within a degree, and the rest of the sprite darkens with it in the same order.
- Every mapping hits the anchor; the three differ away from it (verified: a mid band lands at
  13 %, 1 % and 0 % under scale, curve and shift).
- Hue never moves under any mapping, mode or measure.
- The limit leaves every other colour byte-identical.
- Alpha is preserved exactly, including partial alpha; fully transparent pixels are untouched.

# Monet — logo brief

The prompt below is written to be pasted into ChatGPT (image generation) as-is. It exists in
the repo so the brief and the reasoning behind it survive; the interim mark it replaces is the
inline SVG in the mouftools card (`banner--monet`).

## Why it is written this way

- **The name is a trap.** "Monet" invites Impressionism — water lilies, soft brushwork, pastel
  smears. The product is the opposite: hard-edged pixels at 16×16. The prompt names that
  tension and resolves it toward pixels, keeping one nod to painting so the name still lands.
- **The house style is real, but it is not stated anywhere** — it has to be read off the
  existing cards. All three siblings are a *single centred emblem* on a *dark banner*, flat and
  geometric, with luminous edges and a saturated accent: MultiBoy Advance is an emerald gem in
  green gradient with thin light strokes on near-black; BERMUDA is neon-teal occult line art on
  pure black; Starcores is the Minecraft grass block on warm white (the outlier, and it is a
  borrowed asset rather than a designed mark). So: **glowing geometric emblem on near-black** is
  the convention worth matching.
- **"Not Microsoft-y, more tech-bro"** is a real constraint: no ribbon-toolbar cheerfulness, no
  primary-colour paint splats, no skeuomorphic tipping bucket. The register to aim at is a
  modern developer tool — Linear, Raycast, Vercel — geometry, gradient, glow, restraint.
- Banners render at roughly 250 px tall on desktop and about 24 px in the app's own source
  tree, so the mark has to survive being small. That drives "one idea, four to six shapes".

## The prompt

> You are designing a logo for a developer tool. I need a square app-icon-style mark.
>
> **The product.** It is called **Monet**. It is a browser-based image editor built for making
> **Minecraft textures** — pixel art, usually 16×16 or 32×32, edited at high zoom where every
> individual pixel is visible and deliberate. Its distinguishing feature is that it is wired
> into version control: it opens textures straight out of a Minecraft `.jar` or a GitHub
> repository, and every time you save, it commits and pushes for you.
>
> **What the mark must communicate**, in order of priority:
> 1. Deliberate work at the level of individual pixels — a grid, hard square cells, stepped
>    edges. This is the core idea and should read instantly, even at 24 px.
> 2. Painting or drawing — one gesture, one stroke. Enough that the painter's name makes sense.
> 3. If it can be done without clutter: a hint of version control — a branch, a fork, a node.
>    Drop this entirely rather than crowd the mark.
>
> **Resolve the name deliberately.** "Monet" suggests Impressionism, and that is the wrong
> read: this tool makes hard-edged pixel art, not soft brushwork. Lean pixel and technical, and
> let the painterly reference be a single stroke or gesture rather than any Impressionist
> styling. No water lilies, no haystacks, no visible-brushwork texture, no pastel smudging.
>
> **Style.** Flat, geometric, vector — the register of a modern developer tool (think Linear,
> Raycast, Vercel), not a consumer paint program. A single centred emblem on a very dark, near-
> black background, with a luminous edge or a soft outer glow so it lifts off that background.
> Confident and minimal: one idea, four to six shapes, no scene, no perspective, no mascot.
>
> **Palette.** Cool blues on near-black. A gradient running from a deep blue (#1C6F9C) through
> a mid cyan-blue (#3FA7D6) to a pale ice blue (#9FE0FA), on a background around #0A1622. One
> accent only — keep it monochromatic-blue. Do not use a multicolour or rainbow palette.
>
> **Composition.** Square, 1:1. The mark centred with generous breathing room — roughly 15%
> clear margin on every side. It must stay legible when scaled down to 24×24 pixels, so no thin
> hairlines, no fine detail, no text, no lettering, no letterforms, no wordmark, no "M"
> monogram.
>
> **Avoid:** paint buckets, tipping cans, paint splatters or drips, artist palettes with
> thumb-holes, rainbow swatch rows, watercolour washes, easels, berets, 3D bevels, glossy
> Web-2.0 highlights, drop shadows, photorealism, skeuomorphism, stock "creative" iconography,
> Minecraft's own trade dress (do not copy the grass block, the creeper face, or the Minecraft
> logotype — this must be original and must not imply an official association).
>
> **Deliver three distinct concepts**, each as a separate square image on the dark background,
> and for each one tell me in a sentence what idea it is built on. Then I will pick one and ask
> you for a transparent-background version.

## Follow-ups to send after picking a concept

1. "Re-render concept N with a fully transparent background, still 1:1, same margins."
2. "Show it at 24×24, 48×48 and 256×256 side by side so I can check it holds up small."
3. "Give me a version with the glow removed, for use on a light background."

Save the chosen mark as `logos/monet.png` in the **mouftools** repo (square, transparent, at
least 512×512) and replace the inline `<svg>` in Monet's card with
`<img src="logos/monet.png" alt="" />`. The `.banner--monet` background already supplies the
dark glow, so the file itself does not need one baked in.

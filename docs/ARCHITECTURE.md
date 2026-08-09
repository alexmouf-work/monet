# Monet — architecture (as built)

Rule (CLAUDE.md): this file maps what **exists on `main`**, overview first, details
after. Update it in the same commit as any architecture-affecting change. The
*target* design lives in the numbered spec (`docs/01-architecture.md` et al.) — do
not duplicate it here; describe reality and point.

## Current state (2026-08-09)

**No application code.** Repo = governance layer + v1 spec:

```
CLAUDE.md            agent charter (branch/commit/progress-doc directives, project facts)
README.md            public intro + spec index
docs/00..10-*.md     the v1 specification (design contract)
docs/CONTEXT.md      scope + durable decisions + shipped log
docs/ROADMAP.csv     work items + status (S/G/M ids)
docs/ARCHITECTURE.md this file
.gitignore           node/vite/test artefacts (pre-created for M0)
```

Next change to this file: M0 lands the Vite scaffold → record the real tree, build
commands, and CI shape.

## Target shape (one-paragraph summary; authoritative detail in the spec)

Vite/React/TS SPA, Canvas 2D. `src/core` = pure DOM-free algorithms (pixels,
floodfill, colour, geometry, noise, recolour, encoders, `.monet` zip I/O);
`src/engine` = compositor + viewport + pointer routing with per-layer canvas
caches; `src/tools` = one module per tool over a common interface; `src/ui` =
React panels (Paint-3D layout: feature tabs top, options right, sources left);
`src/integrations` = GitHub REST (PAT; branch-per-repo `monet`; one commit+push
per save; ff Sync with merge fallback), jar parsing (jszip + IndexedDB cache),
File System Access folders. Document model = interleaved stack of raster paint
layers and live shape/text objects with auto-layering (no layers UI); undo =
command pattern (200 steps); persistence = `.monet` zip (manifest JSON + raw RGBA
layers); PWA shell from M12.

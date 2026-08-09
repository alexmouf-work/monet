# Monet — architecture (as built)

Rule (CLAUDE.md): this file maps what **exists on `main`**, overview first, details
after. Update it in the same commit as any architecture-affecting change. The
*target* design lives in the numbered spec (`docs/01-architecture.md` et al.) — do
not duplicate it here; describe reality and point.

## Current state (2026-08-09) — M0 scaffold

```
CLAUDE.md  README.md  docs/          governance + v1 spec (design contract)
index.html                           SPA entry, mounts #root
package.json                         deps per docs/01 §1; scripts below
tsconfig.json                        strict, noEmit, react-jsx, types vite/client+node
vite.config.ts                       app build (base './' for static hosting)
vitest.config.ts                     unit tests, node env, plugin-free (see note)
eslint.config.js  .prettierrc.json   lint/format
playwright.config.ts                 e2e, chromium, builds+previews on :4173
.github/workflows/ci.yml             format:check -> lint -> typecheck -> test -> build
src/main.tsx  src/App.tsx            React entry + app shell
src/ui/theme.css                     workspace palette tokens (docs/09 §9)
tests/smoke.test.ts                  harness proof
tests/e2e/shell.spec.ts              shell loads
```

Scripts: `dev` · `build` (tsc -b && vite build) · `preview` · `typecheck` · `lint` ·
`format`/`format:check` · `test` (vitest run) · `test:watch` · `e2e`.

Note: vitest 2 bundles vite 5, whose `Plugin` type is incompatible with vite 6's, so
unit tests use a **separate plugin-free `vitest.config.ts`**. Legitimate because
tests only cover `src/core` (pure TS, no JSX/DOM) per the docs/01 §2 dependency rule.

Next: M1 — document model, compositor, viewport, doc tabs.

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

# Monet — context (scope, durable decisions, shipped state)

Claude-readable. Decisions are superseded explicitly, never silently edited away.
Update rules: CLAUDE.md §Progress docs.

## Scope

Client-side Paint 3D-style 2D editor + Minecraft/GitHub texture workflow.
Full feature inventory (the contract): `docs/00-overview.md` §3.
Exclusions (do not build): §4 — 3D anything, stickers, magic select, extra Paint 3D
brushes, lasso select, effects beyond noise/recolour, animation/mcmeta editing,
collaboration, any server component.

## Durable owner decisions

| date | decision |
| ---- | -------- |
| 2026-08-09 | Platform: client-side web app + PWA, target `monet.mouftools.com`; no Electron, no server, no backend. |
| 2026-08-09 | Scope: owner's feature lists + editor essentials (undo/redo, eyedropper, palette, clipboard, shortcuts, pixel grid, tiling preview, autosave); NO extra Paint 3D brushes, not even as stretch. |
| 2026-08-09 | Repo saves store editable project data in a repo-root `.monet/` mirror (never sidecars inside assets trees). |
| 2026-08-09 | GitHub integration via REST API + user-supplied fine-grained PAT; branch-per-repo default name `monet`; push on every save; Sync = ff-only ref update with merge-commit fallback; never force-push. |
| 2026-08-09 | Repo governance: all work on `main`; small commits pushed promptly; progress docs updated before every commit, claude-readable-first (charter directives 1–3). |
| spec | Design decisions D1–D8 and vetoable assumptions A1–A8: `docs/00-overview.md` §1, §5. PDF fit interpretation (contain; long-edges coincide for aspect ≥ √2): `docs/07` §6. |

## Shipped

(nothing yet — no application code)

| date | item |
| ---- | ---- |
| 2026-08-09 | v1 technical specification, docs/00–10 (commit 081e6de). |
| 2026-08-09 | Charter + progress-docs system (this governance layer). |

## Superseded / cut

(none)

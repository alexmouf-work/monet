# Monet — agent charter

Read first, every session. Monet = fully client-side Paint 3D-style web app / PWA
for Minecraft texture making (jar/mod browsing, GitHub push-on-save + ff-sync).

Sources of truth:
- **Design contract**: the numbered spec `docs/00-overview.md` … `docs/10-milestones.md`.
  Implementation deviations require editing the spec **in the same commit** — the spec
  stays authoritative.
- **Live state**: `docs/CONTEXT.md` (scope, durable owner decisions, shipped),
  `docs/ROADMAP.csv` (work items + status), `docs/ARCHITECTURE.md` (as-built map).

## Branch policy (owner directive, 2026-08-09)

**All work happens directly on `main`.** Pull from `main`, commit to `main`, push to
`origin/main`. Do NOT create or push other branches (no `claude/...` branches) unless
the owner explicitly asks. If a session starts on another branch: switch to `main`,
reconcile, continue there.

(Disambiguation: Monet-the-app creates a `monet` working branch in *end-user* repos —
that is product behaviour [docs/08], unrelated to how this repo is developed.)

## Commit cadence (owner directive, 2026-08-09)

Commit in **small, coherent chunks** as work progresses — never one big batch at the
end. **Push promptly after each commit**: sessions often run in remote environments
that can reset without warning, so uncommitted or unpushed work must be assumed lost.
Several small commits per task beat one large one; a broken-but-committed
intermediate state on `main` is acceptable, silent data loss is not (note the state
in ROADMAP if leaving something red).

## Progress docs (owner directive, 2026-08-09)

**Before every commit**, bring the progress docs in line with that commit's content:

- `docs/ROADMAP.csv` — statuses from {planned, in-progress, done, cut}; add rows for
  newly discovered work; one row per trackable item.
- `docs/CONTEXT.md` — append new durable owner decisions; move features to Shipped
  when they land; never silently rewrite history (supersede explicitly).
- `docs/ARCHITECTURE.md` — update in the **same commit** as any change affecting the
  as-built architecture (modules, data flow, formats, integrations, build).

Style for all three: **Claude-readable-first** — terse, structured,
information-dense, technically accurate, complete; no narrative fluff, no
restating what git history already says. Human-readable polish only where the owner
asks for it.

## Context budget (owner directive, mirrored from starcore, 2026-08-01)

Do not worry about the context window unless over 85 % used. Do not hedge, hand off,
or stop short of finishing on the grounds of running low. Past 85 %: compact, then
pick up exactly where you left off without asking further questions.

## Project facts

- Stack: Vite + React + TypeScript (strict) + Zustand; Canvas 2D + typed-array pixel
  buffers; jszip, pdf-lib, idb-keyval; Vitest (unit, `src/core` is DOM-free) +
  Playwright (E2E, chromium). Full table + layout: `docs/01-architecture.md` §1–2.
- No backend, no server, no git binary: GitHub via REST API + user PAT; jars parsed
  in-browser; local files via File System Access (download fallback).
- Status: spec complete; **no application code yet** — next is M0 (scaffold), then
  M1–M12 per `docs/10-milestones.md`. Commands once M0 lands:
  `npm install` / `npm run dev` / `npm test` / `npm run build`.
- Milestone rule: don't start Mn+1 while Mn's acceptance checklist is red.
- Pre-1.0: no backwards-compatibility obligations; `.monet` is version-1-only with
  no migration machinery (`docs/07` §7).
- Conventions: prose UK spelling, code US spelling; conventional commits
  (`feat:`/`fix:`/`docs:`/`test:`); no new runtime dependencies beyond the 01 §1
  table without updating that table in the same commit.
- Owner Q&A decisions (platform = web PWA, scope = owner lists + essentials with no
  extra Paint 3D brushes, repo-root `.monet/` mirror) are logged in
  `docs/CONTEXT.md` — do not relitigate them.
- Deploy target: **Vercel** (owner decision 2026-08-09), static output of `dist/`, domain
  `monet.mouftools.com`. `vercel.json` holds the preset and cache headers; deploys come from
  Vercel's Git integration, so there is no deploy workflow in `.github/`.
- **Do not add automatic GitHub Actions runs** (owner directive 2026-08-09: Actions storage is
  full). `.github/workflows/ci.yml` is `workflow_dispatch` only and must stay that way; run the
  gates locally (`npx prettier --check . && npx eslint . && npx tsc --noEmit && npx vitest run &&
  npm run check:vercel && npx vite build`) before every commit instead.

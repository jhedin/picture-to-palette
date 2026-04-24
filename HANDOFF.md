# Handoff — picture-to-palette

This doc orients a fresh Claude Code session (or human reader) to the
current state of the repo and tells them exactly what to do next. Read
this, then read `SCOPING.md` and the files it points to.

## Where we are (as of 2026-04-23)

A long brainstorming session landed on a **new MVP shape** for this app:
interactive, on-device, Axiom-style. Take a photo → mean-shift extracts
dominant colors → user taps 2 anchors → app fills intermediates along
the OKLab path between them → save a PNG preview. No LLM in the core
loop. Embroidery / wool-pattern / URL-scraping become post-MVP
extensions, not part of M1.

### What's committed

| Path | What it is | Status |
|------|-----------|--------|
| `SCOPING.md` | Original Gemini-authored architecture doc. Kept as background. | Authoritative for the overall arc, **superseded for M1 by the spec below.** |
| `docs/computational-colorimetry.md` | Long-form research companion (Mean Shift math, OKLab matrices, Axiom analogy). | Reference. |
| `docs/references-notes.md` | Survey of every external URL in SCOPING.md, with API-drift notes. | Reference. |
| `docs/superpowers/specs/2026-04-23-photo-to-gradient-mvp-design.md` | **The approved M1 design spec.** | **Authoritative for M1.** |
| `docs/superpowers/plans/2026-04-23-photo-to-gradient-mvp.md` | **The bite-sized TDD implementation plan for M1.** | **Follow this to build M1.** |
| `/root/.claude/plans/ok-lets-start-figuring-floofy-duckling.md` | Original approved Claude Code plan (M1-M7). | M1 superseded by the spec above; M2-M7 shape is still roughly correct but has been revised in the spec. |
| `src/` | Ionic React + Vite + TS scaffold that boots to a placeholder Home page. | Mechanical scaffold; no business logic yet. |
| `prototype/` | Archived vanilla-JS sketch. | Ignore. Not the architecture. |
| `public/fixtures/` | 4 real yarn-store photos (downsampled) for E2E use. | Used by Task 12's E2E test. |

### What's NOT committed

- Any M1 business logic: mean-shift, color math, palette store, canvas
  rendering, the three pages. All specced, all planned, none written.
- `node_modules` (obviously). The first `npm install` hasn't been run
  in this environment.

## What to do next

The plan file is the handholding source of truth. Start there.

### Step 1 — Verify the Superpowers plugin loaded

Run `/plugin` in Claude Code. Confirm `superpowers@superpowers-dev` is
enabled. If it isn't, the plugin is at `~/.claude/plugins/superpowers/`
and registered in `~/.claude/settings.json` under both
`extraKnownMarketplaces` and `enabledPlugins`; restart Claude Code once
to activate.

### Step 2 — Invoke `superpowers:using-superpowers`

This orients the session to the skill system. Do it at the very start;
it tells you how to think about every subsequent step.

### Step 3 — Read the spec

`docs/superpowers/specs/2026-04-23-photo-to-gradient-mvp-design.md`.
Confirm you understand the user flow, non-goals, tech decisions, and
design sections. Don't re-brainstorm — it's approved.

### Step 4 — Read the plan

`docs/superpowers/plans/2026-04-23-photo-to-gradient-mvp.md`. Twelve
tasks, each TDD (write failing test → verify it fails → implement →
verify green → commit). Every step has literal code and literal shell
commands — no reinterpretation needed.

### Step 5 — Execute

Two options (the plan's `writing-plans` skill offered the choice):

**A. Subagent-driven (recommended).** Invoke
`superpowers:subagent-driven-development`. It dispatches a fresh
subagent per task with a code-review step between tasks. Best
isolation; context stays clean.

**B. Inline.** Invoke `superpowers:executing-plans` and work through
the tasks in this session. Faster if the tasks are going smoothly,
but your context fills up with all 12 tasks.

Start with Task 1 either way. It's a ~60-second install + smoke check
to confirm the scaffold actually boots with the new dep.

## Skills you will use

The following are the Superpowers skills this flow depends on. All
live at `~/.claude/plugins/superpowers/skills/<name>/SKILL.md`. **Invoke
via the `Skill` tool** — do not `Read` them.

- `using-superpowers` — entry point. Call this first every session.
- `subagent-driven-development` — the outer loop that dispatches per task.
- `executing-plans` — inline alternative if you prefer.
- `test-driven-development` — the inner loop for every task: red, green, refactor.
- `verification-before-completion` — run at the end of every task before claiming it done.
- `systematic-debugging` — if a test fails in a way you can't explain.
- `requesting-code-review` / `receiving-code-review` — between tasks.
- `finishing-a-development-branch` — when M1 is done and you want to merge.

For future work (M2 onward), the earlier entries in the flow also apply:

- `brainstorming` — required before any creative work (new feature, changed behavior). Has a hard-gate: no implementation until the user approves a written spec.
- `writing-plans` — after brainstorming produces a spec, before touching code.
- `dispatching-parallel-agents` — when you have independent tasks you can fan out.
- `using-git-worktrees` — if you want each task in its own worktree.
- `writing-skills` — to add a custom skill.

## The revised milestone arc (for orientation, not M1)

From the spec, superseding the original Claude Code plan:

| # | Milestone | User-visible outcome |
|---|-----------|----------------------|
| **M1** (THIS) | Photo → mean-shift → anchor pick → gradient → PNG save | Core loop works end-to-end |
| **M2** | Auto-suggest + multi-stop (3+) anchors | Browse auto-generated palette candidates |
| **M3** | RxDB persistence | Palettes and saved gradients survive reloads |
| **M4** | Capacitor native Android | Real APK, native camera, native share-sheet |
| **M5** | Embroidery extension (DMC match) | Palette snaps to DMC codes; thread shopping list |
| **M6** | Wool-pattern extension | Stitch-by-stitch output + Floyd-Steinberg / Bayer dithering |
| **M7** | Pattern-URL scraping | LangChain + Browserless yarn-shopping-list agent |

Each milestone gets its own spec (brainstorming skill) and its own plan
(writing-plans skill) before implementation.

## Gotchas the plan doesn't spell out

- **The plan file `palette-store.ts` actually ends up as `palette-store.tsx`** because it contains JSX in `PaletteProvider`. Task 6's Step 3 flags this inline. Don't skim past it.
- **Tests import from `./palette-store`** (no extension) — that works because Vite/Vitest resolve `.tsx`. If you see a resolution error, check the import path.
- **jsdom canvas support** is required for `gradient-canvas.test.ts`. If `canvas.toDataURL` isn't implemented in your jsdom build, install the `canvas` npm package as a devDep.
- **Color.js bundle size** — the plan uses `new Color(hex)` / `color.to("oklab")` which pulls in a decent chunk. Task 2 doesn't micro-optimize imports because Vite tree-shakes reasonably; revisit only if the production bundle exceeds ~250KB gzipped.
- **The existing `e2e/smoke.spec.ts` gets replaced in Task 11, then deleted in Task 12.** Don't add anything to it in the meantime.

## Committing norms on this branch

- Work on `claude/add-gemini-api-integration-UpOn7` (this branch). Do not push to `main` except via merge of this branch's PR.
- Commit after every task per the plan. Messages follow the style used
  in existing commits (imperative, no leading prefix, a blank line before
  body if you need a body).
- The PR #1 at <https://github.com/jhedin/picture-to-palette/pull/1> is the
  long-lived review surface; keep pushing to this branch, don't open new PRs
  for each M1 task.

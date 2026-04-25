# Claude Code – project preferences

## PR workflow
- **Auto-merge all PRs** — do not ask the user to review or merge. Once CI passes, squash-merge immediately.
- **Watch for deploy** after merging — poll `https://jhedin.github.io/picture-to-palette/` for a new bundle filename, then tell the user the deploy is live and what SHA to look for in the Capture header.
- Create PRs as **ready for review** (not draft) so they can be merged immediately after CI.

## Dev branch
All work goes on `claude/continue-handoff-Ayn42` → PR into `main`.

## Stack
- React + Ionic + Vite + TypeScript
- Vitest for unit tests (`npm test`)
- Playwright for e2e (`npm run test:e2e`)
- GitHub Pages deploy via Actions on push to `main`
- PWA via `vite-plugin-pwa`; Workbox precache limit set to 30 MB (ONNX WASM is 23.6 MB)

## Segmentation defaults
- `segmentMethod: "spatial-meanshift"`, `preBlurSigma: 0.5`
- `subtractBackground` tests pinned to `segmentMethod: "slic"` (MBD propagation is tuned for SLIC shapes)

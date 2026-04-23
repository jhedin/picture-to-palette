# Photo-to-Gradient MVP Design

> Status: **approved** (user sign-off 2026-04-23).
> Author: brainstorming session 2026-04-23.
> Next step: `superpowers:writing-plans` → `docs/superpowers/plans/2026-04-23-photo-to-gradient-mvp.md`.

## Context

The repo was initially scoped around a Gemini-vision picture-to-palette tool
(see [`SCOPING.md`](../../../SCOPING.md),
[`docs/computational-colorimetry.md`](../../computational-colorimetry.md)).
That framing centered on autonomous palette extraction via a cloud LLM.

During brainstorming the user clarified a different MVP: an **interactive,
on-device photo-to-gradient picker** inspired by Minecraft's Axiom mod
Gradient Helper. The user picks anchor colors, the app fills in the
between. No LLM needed in the core loop. Material-specific logic (DMC
thread matching, wool patterns, pattern-URL scraping) moves to **extensions
layered on top of the MVP**, not part of it.

The earlier approved roadmap in
`/root/.claude/plans/ok-lets-start-figuring-floofy-duckling.md` described a
Gemini-first M1 and Mean-Shift-as-serverless M5. This spec supersedes that
shape for M1 and reshuffles the surrounding milestones accordingly; the
earlier roadmap is preserved for reference but no longer authoritative.

## Goal

**Let the user photograph something, tap two colors they like from the
extracted palette, and save a visual gradient preview that shows both anchor
colors plus a few intermediate colors from the palette that sit on the
OKLab path between them.**

One screen flow. Fully on-device. No LLM, no server, no account, no sync.

## Non-goals

The following are explicitly **out of scope for M1**:

- Auto-suggesting palette subsets via color theory. *(M2 fast-follow.)*
- Multi-stop anchors (3+). *(M2.)*
- Persisting palettes or gradients across browser sessions. *(M3.)*
- Capacitor native build, native camera plugin, native share-sheet save. *(M4.)*
- DMC thread matching via CIEDE2000, shopping-list output. *(M5 extension.)*
- Stitch-by-stitch pattern output, dithering. *(M6 extension.)*
- Pattern-URL scraping (LangChain + Browserless). *(M7 extension.)*
- Cloud-hosted models, API keys, BYO-provider plumbing. *(None of that is needed until an extension wants it.)*

Violating any of these belongs in a different milestone's plan, not M1's.

## User flow (MVP)

1. **Capture.** User opens the app → Capture screen → taps "Take / upload photo" → phone's native camera/picker opens (via `<input type="file" accept="image/*" capture="environment">`). Photo loads.
2. **Extract.** Web Worker runs mean-shift on a downsampled (128×128) copy of the image; returns ~8 candidate colors.
3. **Pick.** Candidates appear as chips overlaying the photo. User taps each they want (or "Accept all"). Picked chips flow into the session palette.
4. **Repeat.** User can "Add another photo" to add more candidate colors. Palette dedupes near-duplicates via ΔE00 < 3.
5. **Anchor.** User navigates to the Palette screen showing all accumulated colors. Taps exactly **2** as anchors.
6. **Generate.** Taps "Generate gradients". New screen shows 3–4 candidate gradients differing in how many intermediates are injected (*k* ∈ {0, 1, 2, 3}); intermediates are palette colors whose OKLab coordinates sit closest to the straight-line OKLab path between anchors.
7. **Save.** User taps a candidate, then "Save". Browser downloads a ~1080×240 PNG of the chosen gradient with hex codes annotated.

Total time from open to saved PNG on a prepared palette: target <30 seconds.

## Design sections

### Section 1 · Capture screen

- One route, `/capture`, entry point of the app.
- Single primary action: **Take / upload photo** → triggers `<input type="file" accept="image/*" capture="environment">`. No dropzone for M1; Ionic's file button is enough.
- Once a photo is loaded:
  - Display the photo large in an `<IonContent>` container (respect safe-areas).
  - Extraction fires automatically on load (no extra tap).
  - While mean-shift runs, show `<IonProgressBar type="indeterminate">`.
  - On completion, render candidate chips as a horizontal scrollable row at the bottom of the screen.
- Each chip is a colored circle with a small "+" badge; tap flips to "✓ Added" state and the color enters the session palette.
- **Accept all** secondary button adds every non-added chip.
- **Add another photo** button returns to the photo picker while keeping current palette.
- **Next → Palette** button (enabled when palette has ≥ 2 colors) navigates to `/palette`.
- **Edge cases:**
  - Mean-shift returns 0 clusters (flat-color image): show toast "Couldn't find distinct colors in this photo" and allow the user to retry or pick another photo. No chips rendered.
  - Mean-shift returns 1 cluster: render the single chip as usual. User can add it; palette just needs ≥ 2 colors total (possibly from a second photo) before Next unlocks.
  - Extraction exceeds 3s on the user's device: progress bar stays indeterminate; no timeout in M1 (tune after measuring real devices).

### Section 2 · Palette screen

- Route `/palette`. Shows the accumulated session palette as an `<IonGrid>` of swatches, 3–4 per row.
- Each swatch displays: the color, its hex code below (small monospace), and a remove × in the corner.
- **Anchor selection state machine** (exhaustive):
  - State 0 (no anchors): tap any swatch → that swatch becomes anchor-A (thick ring + "A" badge). → State 1.
  - State 1 (anchor-A only): tap anchor-A → deselects it, back to State 0. Tap any other swatch → becomes anchor-B ("B" badge). → State 2.
  - State 2 (both anchors): tap anchor-A → deselects it; previous anchor-B stays B (so now State 1 with only B). Tap anchor-B → deselects it; A stays (State 1). Tap a third swatch → anchor-A drops, anchor-B promotes to A, the tapped swatch becomes the new B. → stays in State 2.
- Long-press (500ms) or the × corner icon removes the swatch from the palette. Removing a current anchor moves state down accordingly.
- Footer: **Generate gradients** button (enabled only in State 2); **Back to Capture** link.

### Section 3 · Gradient candidates screen

- Route `/gradients`. Shows 3–4 candidate gradient strips stacked vertically.
- Each strip: 1080px-wide rendered via Canvas/CSS `linear-gradient` in OKLab; anchor swatches at the ends; intermediates as labeled markers along the strip.
- Candidates: `k=0` (no intermediates, pure anchor-to-anchor), `k=1`, `k=2`, `k=3`. If fewer than *k* suitable intermediates exist in the palette, skip that candidate.
- **Intermediate selection rule**: for each candidate of size *k*, pick the *k* palette colors (excluding anchors) that minimize sum of ΔE₀₀ to the straight-line OKLab path between anchors, *and* are spread along the path (no two intermediates collapse onto the same position).
- Tap a candidate → selected ring; tap "Save" at the bottom.

### Section 4 · Save action

- Canvas draws the selected gradient at 1080×240 px:
  - Top 200px: the smooth OKLab gradient strip with intermediates as solid colored vertical bands, blended into each other via OKLab.
  - Bottom 40px: hex codes of each anchor and intermediate in small monospace.
- Download via `<a href="{dataURL}" download="palette-YYYY-MM-DD-HHmm.png" />` triggered by the tap.
- Show an Ionic toast: "Saved to downloads".

### Section 5 · Auto-suggest (M2 fast-follow — not M1)

Documented here for completeness since the user explicitly wants it as a fast-follow; implemented in M2's plan, not M1's:

- Button on the Palette screen: **Suggest palettes**.
- Color-theory engine generates 10–20 candidate 3–4 color subsets from the accumulated palette using hue-angle rules in OKLCH:
  - **Analogous**: 3 colors within 30° hue of each other.
  - **Complementary**: 2 colors ≈180° apart.
  - **Triadic**: 3 colors ≈120° apart.
  - **Split-complementary**: base + 2 colors flanking its complement by ~30°.
  - **Tetradic**: 4 colors forming a rectangle on the wheel.
- Output rendered as a scrollable list of gradient strips. Tap one → routes to `/gradients` with that subset preloaded as anchors + forced intermediates.

## Technical decisions

### Stack (already decided)

- **Ionic React 8 + React 18 + TypeScript** for the UI layer.
- **Vite 6** as the bundler, **vite-plugin-pwa** for manifest + service worker.
- **Vitest + React Testing Library** for unit/component tests.
- **Playwright** (chromium + mobile-chrome projects) for E2E.

### Core algorithms

| Concern | Choice | Rationale |
|---|---|---|
| Color extraction | Mean-shift in a Web Worker, downsampled 128×128 sRGB pixels | On-device, ~8 clusters typical, <500ms on mid-range phones. Avoids LLM and avoids the user-input burden of picking a cluster count. |
| Bandwidth | `estimate_bandwidth` equivalent with `quantile=0.2` | Gives ~5–10 clusters on typical wool/craft photos. |
| Dedup across photos | ΔE₀₀ < 3.0 | Just below JND (2.3); any closer pair is visually redundant. |
| Color space for gradients | **OKLab** via [Color.js](https://colorjs.io) | SCOPING.md §2C and research doc agree. Avoids muddy mid-tones. |
| Color distance | **CIEDE2000 (ΔE₀₀)** via Color.js | Canonical. Used for dedup (Section 1) and intermediate ranking (Section 3). |
| Intermediate ranking | Score = ΔE₀₀ from palette color to OKLab straight-line path (perpendicular distance), plus a spread penalty so intermediates don't collapse. | Direct adaptation of Axiom's Gradient Helper behavior. |
| Gradient rendering | CSS `linear-gradient(in oklab, ...)` where supported; Canvas fallback that interpolates in OKLab per-pixel. | CSS `in oklab` interpolation requires Chrome 111+, Firefox 113+, Safari 16.4+ — covers every Android PWA target but not legacy WebViews. Canvas fallback is ~30 lines. |
| PNG export | HTML `<canvas>` + `toDataURL("image/png")` + `<a download>` | Zero deps, works in every browser. |

### Libraries to add (M1 only)

- `colorjs.io` — OKLab, OKLCH, ΔE₀₀, color parsing. [docs](https://colorjs.io/docs/color-difference)
  - Use sub-module imports (`colorjs.io/src/color`, `colorjs.io/src/spaces/oklab`, etc.) to keep the bundle tight. The full `colorjs.io` import pulls ~80 KB gzipped; targeted imports are ~20 KB.
- Mean-shift implementation: **write our own ~120 line module** (no good tree-shakable npm package for browsers; sklearn is Python). Uses bin-seeding on a ≤16k-pixel downsampled image (128×128).

Nothing else beyond what's already in `package.json`.

### Folder layout (M1)

```
src/
  main.tsx               (entry, Ionic setup)
  App.tsx                (router, routes: /capture, /palette, /gradients)
  pages/
    Capture.tsx          (Section 1)
    Palette.tsx          (Section 2)
    Gradients.tsx        (Section 3)
  lib/
    palette-store.ts     (React context + reducer for session palette state)
    mean-shift.ts        (pure function: pixel array → cluster centers)
    mean-shift.worker.ts (Web Worker wrapper)
    color.ts             (OKLab, ΔE₀₀, dedup, intermediate selection — wraps Color.js)
    gradient-canvas.ts   (Canvas rendering + PNG export)
  theme/variables.css
  setupTests.ts
e2e/
  capture-to-save.spec.ts (full flow with a fixture photo)
public/
  fixtures/              (small test images committed for tests)
```

### Test strategy

Mandatory per the plan-file testing norm. M1 tests:

- **Unit** (`src/lib/*.test.ts`):
  - `mean-shift.test.ts` — seeded-input test: a synthesized 3-flat-color image must produce exactly 3 cluster centers matching the input within ΔE₀₀ ≤ 2.
  - `color.test.ts` — ΔE₀₀ golden values sourced from `michel-leonard/ciede2000-color-matching` repo (published test vectors); OKLab midpoint goldens from Ottosson's post.
  - `color.test.ts` — dedup threshold behavior, intermediate-selection spread penalty.
- **Component** (`src/pages/*.test.tsx`):
  - Capture: photo load triggers extraction worker mock; chips render; tap flips state.
  - Palette: anchor state machine (tap 1 → 2 → 3-becomes-promote); long-press removes.
  - Gradients: candidates render given a mocked palette state; selecting enables Save.
- **E2E** (`e2e/capture-to-save.spec.ts`):
  - Playwright uploads a fixture image, advances through pages, asserts a PNG download trigger.

Coverage gate: every behavior in this design doc must have at least one failing-if-regressed test. No percentage target.

## Open questions (deferred — not M1 blockers)

- Should photos survive a page reload? *(No, until M3 persistence.)*
- Anchor selection for >2 in M2 — how? *(M2 spec.)*
- How many candidate auto-suggestions in M2 — paginated or all-at-once? *(M2 spec.)*
- Bitmap PWA icons instead of SVG. *(Polish, can wait.)*

## Revised milestone plan

Supersedes the M1 description in the earlier Claude Code plan.

| # | Milestone | User-visible outcome |
|---|-----------|----------------------|
| **M1** | **This spec.** Photo → mean-shift → anchor pick → gradient → PNG save | Core loop works end-to-end |
| **M2** | Auto-suggest + multi-stop (3+) anchors | Browse auto-generated palette candidates, save a multi-stop gradient |
| **M3** | RxDB persistence | Palettes and saved gradients survive reloads; stash browsing |
| **M4** | Capacitor native Android | Real APK, native camera, native share-sheet save |
| **M5** | Embroidery extension (DMC match) | Palette snaps to DMC codes via ΔE₀₀; thread shopping list |
| **M6** | Wool-pattern extension | Stitch-by-stitch pattern output + Floyd-Steinberg / Bayer dithering |
| **M7** | Pattern-URL scraping | Paste a pattern URL → LangChain + Browserless returns a structured yarn shopping list |

## References

- [`../../../SCOPING.md`](../../../SCOPING.md) — project-level architecture doc (Gemini-authored).
- [`../../computational-colorimetry.md`](../../computational-colorimetry.md) — long-form rationale (Gemini PDF).
- [`../../references-notes.md`](../../references-notes.md) — API/library survey.
- [Axiom Gradient Helper](https://axiomdocs.moulberry.com/builder/gradienthelper.html) — the pattern this MVP mirrors.
- [Color.js color-difference](https://colorjs.io/docs/color-difference), [OKLab by Björn Ottosson](https://bottosson.github.io/posts/oklab/).
- `michel-leonard/ciede2000-color-matching` — published CIEDE2000 test vectors.

# Reference survey notes

Findings from fetching every URL listed in [`../SCOPING.md`](../SCOPING.md) and
[`computational-colorimetry.md`](./computational-colorimetry.md). Captured here
so later implementation agents don't re-fetch and can spot API drift early.

Date of survey: 2026-04-23.

## Color math libraries

### `seanockert/rgb-to-dmc` — DMC thread JSON

- **URL:** <https://github.com/seanockert/rgb-to-dmc/blob/master/rgb-dmc.json>
- **Entry shape:** `{ floss, description, r, g, b, hex, row }` — 7 fields.
- **Size:** ~500 entries (the DMC floss set).
- **License:** **Not stated in the repo.** Must confirm before bundling. If unclear, fall back to the Wolfram dataset which is the authoritative, sourced one.

### Wolfram DMC Thread Colors

- **URL:** <https://datarepository.wolframcloud.com/resources/JonMcLoone_DMC-Thread-Colors/>
- **Entry shape:** 3 columns (floss id, name, color) across 454 rows.
- **Formats:** CSV, JSON, TSV, WL. Grab CSV or JSON for the PWA.
- **Provenance:** Averaged from camelia.sk, 123stitch.com, and a CrossStitch GitHub project. Published 2022-04 by Jon McLoone.
- **License:** Check Wolfram Data Repository terms.

**Recommendation for M3:** start with `rgb-to-dmc` (richer schema — already has hex + per-channel RGB), but switch to or supplement with the Wolfram CSV if the license turns out to be unclear.

### `michel-leonard/ciede2000-color-matching`

- **URL:** <https://github.com/michel-leonard/ciede2000-color-matching>
- **API:** one function `ciede_2000(...)`; accepts hex, rgb triple, or a mix.
- **Size:** ~3KB minified. Pure JS, no deps, no polyfills needed.
- **Distribution:** **no npm package**. Use the jsdelivr CDN build or vendor the source.
- **Perf:** ~1M comparisons in 500ms on modern browsers.
- **Bonus:** the repo also contains **CIEDE2000 test vectors** — usable as our conformance suite instead of relying on Sharma's site (which is currently 503).

### `hamada147/IsThisColourSimilar`

- **URL:** <https://github.com/hamada147/IsThisColourSimilar>
- **API:** `Colour.hex2lab(hex)`, `Colour.deltaE00(lab1, lab2)`, `Colour.rgba2lab(...)`.
- **Distribution:** jsdelivr / clone; no explicit npm package.
- **Notes:** TypeScript source; fine fallback if Color.js is too heavy.

### Color.js (`colorjs.io`)

- **URL (difference):** <https://colorjs.io/docs/color-difference>
- **API:** `color1.deltaE(color2, "2000")` or `Color.deltaE(a, b, "2000")`. **Default is ΔE76** — must pass `"2000"` explicitly or set `Color.defaults.deltaE = "2000"`.
- **OKLab:** handled by Color.js as a color space (separate `/docs/interpolation` doc for interpolation API — not captured in this sweep; read during M6).
- **ESM + tree-shakable.**
- **JND hint:** ΔE ≥ 2.3 is the canonical just-noticeable-difference threshold.

**Recommendation:** adopt Color.js as the single color-math library (ΔE00 + OKLab + conversions in one dep) rather than combining `ciede2000-color-matching` + a separate OKLab helper. Keep the `ciede2000-color-matching` repo as the source of conformance test vectors for M3 goldens.

### Sharma et al. CIEDE2000 page

- **URL:** <http://www2.ece.rochester.edu/~gsharma/ciede2000/>
- **Status:** **503 on 2026-04-23** (multiple retries). The canonical paper's 34-pair conformance table is mirrored inside `ciede2000-color-matching` — use that.

### OKLab (Björn Ottosson)

- **URL:** <https://bottosson.github.io/posts/oklab/>
- **Captured:** the full sRGB → linear sRGB → LMS (matrix 1) → cube-root → Lab (matrix 2) pipeline with all 18 matrix coefficients. Implementation-ready for TypeScript.
- **OKLch cylindrical form:** `C = √(a² + b²)`, `h° = atan2(b, a)`.

## Clustering / backend

### `sklearn.cluster.MeanShift`

- **URL:** <https://scikit-learn.org/stable/modules/generated/sklearn.cluster.MeanShift.html>
- **Constructor:** `MeanShift(bandwidth=None, seeds=None, bin_seeding=False, min_bin_freq=1, cluster_all=True, n_jobs=None, max_iter=300)`.
- **Outputs:** `cluster_centers_` (n_clusters × n_features), `labels_` (n_samples).
- **Bandwidth:** use `estimate_bandwidth(X, quantile=0.3)` — this is the perf bottleneck; set `min_bin_freq` higher to cut seed count.
- **Complexity:** O(T·n·log n) in low-dim, O(T·n²) in higher.

## Gradient tooling (M6)

### Axiom Gradient Painter

- **URL:** <https://axiomdocs.moulberry.com/tools/painting/gradientpainter.html>
- **Confirmed:** Planar + Spherical spatial modes; Nearest / Linear / Bezier interpolation.
- **Unknown:** no Bezier math in docs, no color space stated. Axiom is closed-source, so replication = standard cubic Bezier against OKLab interpolation; don't chase bit-exact parity.

### Axiom Gradient Helper

- **URL:** <https://axiomdocs.moulberry.com/builder/gradienthelper.html>
- **Confirmed:** takes "two or more input blocks" — multi-stop gradients. Uses OKLab. Can export to Gradient Painter.
- **Unknown:** probability-weighting details.

### HueBlocks

- **URL:** <https://github.com/1280px/hueblocks>
- **Stack:** Vue 3 + TypeScript, OKLab is the default color space.
- **Algorithm location:** the README says "very modular" — look at `vueblocks/` subdir for the snap logic. Needs deeper source-code reading during M6.

## Scraping / P1

### LangChain `BrowserlessLoader`

- **URL:** <https://reference.langchain.com/v0.3/python/community/document_loaders/langchain_community.document_loaders.browserless.BrowserlessLoader.html>
- **API:** `BrowserlessLoader(api_token, urls, text_content=True)` — returns `Document` list via `load()` / `lazy_load()`.
- **Module:** `langchain_community.document_loaders.browserless`.
- **Requires:** a Browserless subscription / API token.

### LangChain structured output — **API drift alert**

- **URL:** <https://docs.langchain.com/oss/python/langchain/structured-output>
- SCOPING.md's blueprint uses `llm.with_structured_output(Schema)`. That still works for ChatModels.
- **Current docs push `create_agent(model=..., response_format=Schema)`** — the result lands in `result["structured_response"]`. Auto-selects `ProviderStrategy` (native, for Anthropic/OpenAI/xAI/Gemini) or `ToolStrategy` (fallback).
- For P1 implementation, prefer `create_agent(response_format=...)` — it's the actively-documented path.

### Crawl4AI

- **URL:** <https://docs.crawl4ai.com/core/quickstart/>
- **Self-contained:** runs its own Chromium, no Browserless subscription needed.
- **Two extraction modes:** `JsonCssExtractionStrategy` (fast, no LLM) and `LLMExtractionStrategy` (Pydantic + instructions).
- **Considered as P1 alternative** to Browserless+LangChain — simpler infra (no extra subscription) at the cost of the LangChain-ecosystem features.

## Updates this implies for the project docs

1. **SCOPING.md P1 code blueprint:** note that `.with_structured_output(...)` is fine but `create_agent(response_format=...)` is the newer path. Don't rewrite — just annotate.
2. **SCOPING.md color-math choice:** point at Color.js as primary, `ciede2000-color-matching` as conformance-vector source.
3. **Plan file M3 Verify bullet:** conformance data comes from `michel-leonard/ciede2000-color-matching` (Sharma's server is flaky).
4. **M3 DMC dataset choice:** `rgb-to-dmc` first, but license unknown — task M3 with confirming this before bundling.

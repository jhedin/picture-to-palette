# Color Picking Learnings

Notes distilled from color theory resources, primarily:

- **Snarple** — "Color Theory for Minecraft Builders" (Part 1)
  https://m.youtube.com/watch?v=jrCNMHACGik

---

## How Axiom's gradient tool works (the UX model we're imitating)

- Pick two anchor blocks (colors). The tool shows which blocks from your palette fall
  "between" them on the color picker — hue slider, value (up/down), saturation (left/right).
- You sort and trim manually: put blocks in hue order, then check if value and saturation
  are also consistent. Outliers get dropped.
- Short gradients (3–4 blocks) are often better than long ones. If a block is off in
  value or saturation relative to its neighbors, remove it rather than keeping a 6-block
  gradient that doesn't flow.
- The result is always real palette blocks, never interpolated colors.

---

## Hue, Value, Saturation — what each axis means for gradient quality

**Hue** — which color it is (position on the wheel). A good gradient follows the shorter
arc between two hues, passing through the intermediate hues in order. Jumping across the
wheel mid-gradient feels wrong.

**Value** — lightness/darkness. Gradients should change value smoothly and monotonically.
A block that is significantly darker or lighter than its neighbors creates a "crater" that
breaks the flow. In OKLab, value = L.

**Saturation (chroma)** — purity/intensity. A highly desaturated block inserted into a
gradient of saturated colors looks washed out and breaks consistency. In OKLab,
chroma = √(a² + b²).

The key insight: a good gradient changes primarily along **one axis** at a time, with the
other two staying roughly consistent. Mixing heavy hue rotation with heavy value change
in the same gradient is hard to make look good.

---

## Actionable implications for the math

### 1. Perpendicular distance filter (most important)

Our current `gradientBetween` "natural" mode projects each color onto the A→B line in
OKLab and keeps colors where the projection t ∈ (0, 1). But a color could have t = 0.5
(perfectly between the anchors in projection) while being far off to the side perceptually
— it lands between A and B in depth but is a completely different hue.

**Fix**: add a perpendicular-distance cap. Only keep colors whose distance to the A→B
line is below some threshold (e.g. 20–30% of |AB|). This is equivalent to keeping colors
inside a cylinder around the A→B segment rather than the whole half-space.

```
perp² = |AP|² − t² * |AB|²
keep if perp < threshold * |AB|
```

### 2. Consistency scoring / outlier removal

Before presenting inbetween candidates to the user, score each one for how well it fits
the gradient's value and saturation trend. A block that is an outlier in either dimension
relative to its sorted neighbors could be flagged or deprioritized.

A simple proxy: after sorting, compute the std dev of L (value) and C (chroma) across the
full sequence [anchorA, ...inbetween, anchorB]. Flag any block that is >1.5 SD from the
trend line.

### 3. Hue arc direction matters

When sorting by hue, always use the **shorter arc** between the two anchors' hue angles
(we already do this in hue mode). For natural mode, the OKLab projection implicitly
handles this, but it's worth verifying that natural mode doesn't accidentally sort via the
long arc for hue-distant anchor pairs.

---

## Actionable implications for the UX

- **Show value + saturation alongside the block strip** — small L and C values below each
  swatch would let users spot outliers the same way Axiom's color picker does.
- **Highlight outliers** — if a candidate's L or C deviates significantly from its
  neighbors, visually flag it (lighter border, warning dot) rather than silently including
  or excluding it.
- **"Remove outlier" affordance** — let users tap a swatch in the gradient strip to
  exclude it without changing the anchor or count.
- **Shorter is often better** — the default count of 1 is correct; resist the urge to
  default to showing everything.

---

## General color theory notes (useful for future features)

- **Complementary** (opposite on wheel) = maximum contrast. Good for focal points.
- **Analogous** (adjacent on wheel) = harmony. Good for gradients and backgrounds.
- **Triadic** (equally spaced) = vibrant but balanced.
- **Monochromatic** = same hue, varying value/saturation only. Easy to make cohesive.
- **Simultaneous contrast**: a color looks different depending on what surrounds it.
  A medium gray next to blue will look slightly orange. Relevant when displaying swatches
  side by side.
- **Contrast of extension**: a small accent color surrounded by a large background of a
  complementary color pops disproportionately. Relevant for how we display the gradient
  strip — equal-width blocks may not reflect perceptual weight accurately.
- **CMYK vs RYB vs RGB**: for our purposes (digital display of yarn colors) RGB/OKLab is
  correct. Yarn itself is subtractive (RYB or CMY), but we're photographing it and
  displaying digitally, so RGB/OKLab is the right space throughout.

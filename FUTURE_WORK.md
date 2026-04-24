# Future Work

## Storage / multiple projects

Currently all state is in-memory and lost on page reload. The right shape is
named projects, not just single-state persistence:

- Project list as a home screen (name, original image thumbnail, thread count)
- Each project stores: original image blob, extracted palette, DMC set, gradient
  sequence, and eventually drawing annotations
- Create / rename / delete projects
- Requires restructuring `palette-store` from one global state to a list of
  named states with an active pointer — worth doing before the drawing layer,
  since annotations are per-project data

localStorage is the natural first backing store; could add cloud sync later.

## Shopping list / coverage estimates

The DMC page's "Copy thread list" gives ID, name, hex. For actually buying
wool at a shop:

- Sort threads by coverage (area in the image), not match order
- Coverage is calculable: pixel counts per SLIC segment → sum per matched DMC
  color → percentage of total image area
- Export as a simple text list (ID and name only, sorted by area descending)
  suitable for reading at a craft shop
- Optionally: rough skein estimates given a target finished size

## Pattern drawing

The user draws an embroidery pattern manually using a stylus in a drawing app
(Procreate etc.), with cartoony/interpretive choices that beat automation.
The app's role in this flow is to supply the DMC palette as a reference color
set. Possible integration points:

- Export DMC set as an ASE / Procreate swatches file so the palette loads
  directly in the drawing app
- Display the DMC hex values and IDs prominently on-screen as a reference
  panel while drawing on a second device/window
- In-app drawing canvas with DMC color picker is a stretch goal; the
  segmentation quality needs to be good enough first for any flood-fill
  assistance to be worth the complexity

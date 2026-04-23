# picture-to-palette

A tool for turning photos of wool/yarn balls (or traced designs) into constrained
DMC/yarn palettes and shopping lists, with procedural gradient generation for
crochet/knit patterns.

## Scoping

The design and phasing document is in [SCOPING.md](./SCOPING.md). It was
authored by Gemini and is the source of truth for architecture, algorithms,
and references. Start there before touching code.

## Prototype

This branch also includes a thin P0-flavored spike at the repo root:

- `index.html`, `app.js`, `styles.css` — a static web page that uploads an
  image, sends it to Gemini (`gemini-2.5-flash`), and renders a palette of
  named colors with suggested DMC/Anchor/yarn codes and a rough shopping
  quantity.

It demonstrates the cloud-delegated pattern (UI local, intelligence remote)
but does **not** implement Mean Shift, CIEDE2000 matching, OKLab gradients,
or the LangChain/Browserless scraping agent described in SCOPING.md. Treat
it as a quick sanity check, not the intended architecture.

### Running the prototype

Open `index.html` in a browser (or serve the folder with any static server),
paste a Gemini API key from <https://aistudio.google.com/app/apikey>, drop
an image, and click **Extract palette**. The key stays in `localStorage` if
you tick "Remember in this browser".

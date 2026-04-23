# Prototype (archived)

This folder contains the original vanilla-JS prototype that proved the
Gemini-vision cloud-delegated pattern. It is kept as a reference — the main
app (Ionic React + Vite + TS) lives at the repo root.

Open `index.html` in a browser (or any static server), paste a Google AI
Studio API key, drop a photo, click **Extract palette**. Key is stored in
`localStorage` if you tick "Remember in this browser".

The palette-provider logic in `app.js` is the canonical reference for the
Gemini implementation in `src/lib/providers/gemini.ts`.

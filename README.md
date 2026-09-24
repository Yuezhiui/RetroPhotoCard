# Retro Memory Studio

Retro Memory Studio is a privacy-friendly, browser-local photo editor for turning everyday images into retro memory cards, film-inspired prints, postcards, and contact sheets.

It combines an analog-inspired visual workflow with modern editing controls while keeping photos on the user's device.

## What makes this version different

- Five original card layouts: Instant, Square, 35mm, Postcard, and Editorial.
- Multi-photo rolls with a printable/exportable contact-sheet view.
- Non-destructive Film Lab controls for exposure, contrast, saturation, sepia, warmth, fade, grain, vignette, and softness.
- Built-in film recipes plus locally saved custom recipes.
- Drag-to-reframe, zoom, pan, and rotation controls.
- Two-sided cards: a designed photo front and a postcard-style memory-note back.
- Local project persistence with IndexedDB, plus portable JSON import/export.
- Local file metadata display. Photos stay in the browser unless the user explicitly exports a project file.
- PNG export for either a single card or a full contact sheet.
- Undo/redo for editing state.

## Run locally

```bash
npm install
npm run dev
```

Build for production with:

```bash
npm run build
```

## Privacy

The app has no photo-upload API. Image editing and project storage happen in the browser.

## Author

Created and maintained by **Koshi**.

## License

Licensed under the [MIT License](LICENSE).

# Testing Canvas Studio

Run commands from the repository root. Use Node.js 24 to match the Pages workflow.

## Fast regression checks

These checks use Node's built-in assertions and VM. They do not need npm dependencies,
a running Vite server, browser permissions, or a headless browser:

```sh
node scripts/test-selection.mjs
node scripts/test-pdf-scroll.mjs
```

- `test-selection.mjs` extracts production selection and clipboard handlers from
  `app.js`. It covers marquee selection, Ctrl/Cmd toggles, group moves and scaling,
  undo, stacking, deletion, mixed styling, copy/cut/paste, and card-child handling.
- `test-pdf-scroll.mjs` exercises the production wheel handler and PDF viewport with
  controlled page renders. It covers continuous scroll, boundaries, wheel units,
  zoom scaling, hit routing, clipping, resizing, and saved-page restoration.

Because the tests extract functions from source text, a refactor can break their
fixtures before it changes user behavior. Investigate extraction failures instead
of removing the assertions. Passing these checks does not test the real DOM,
PDF decoding, media capture, storage permissions, or video encoding.

## Production build

```sh
npm ci
npm run build
npx vite preview --host 127.0.0.1
```

Open the preview URL under `/canvas/`. Both development and production use that
base path. The `predev` and `prebuild` hooks copy PDF.js `cmaps`,
`standard_fonts`, `wasm`, and `iccs` from the installed dependency into
`public/pdfjs/`. Use the npm scripts so that preparation is not skipped.

If the hook cannot find `node_modules/pdfjs-dist`, run `npm ci` before retrying.
Do not hand-edit generated PDF support files to fix a build.

## Manual browser smoke check

Use a separate browser profile or export the existing workspace first; opening
another project replaces the current workspace.

1. Add text, a rectangle, and an image. Select them together, move and resize
   them, then undo. Copy and paste a selection into a second canvas.
2. Import a small multipage PDF. Scroll through it, resize it, and confirm its
   viewport clips pages without unexpectedly zooming the whole presentation.
3. Add notes to two canvases. Save the project, reload, and verify browser
   restoration. Then reopen the downloaded JSON and verify both canvases and
   their notes. A live screen source must be shared again after reopening.
4. Start a short recording without microphone access. Change canvases, pause,
   resume, stop, and download the result. Play the file outside the app and
   check that only the presentation frame is captured.
5. Separately test microphone, webcam, and screen sharing after granting the
   desired permissions. A canceled permission prompt should leave the editor
   usable. Screen audio depends on the source and the browser's sharing picker.
6. Resize the browser and inspect the console for uncaught errors. Repeat the
   relevant edited flow after the final change, not just before it.

Record browser/version, the tested commit, checks run, and any failures or skipped
permission-dependent steps. Do not label a build-only pass as a recording test.

## Deployment boundary

`.github/workflows/pages.yml` runs both Node checks and the build, then publishes
`dist/` on every push to `main`, including Markdown-only changes. A normal
non-main documentation branch does not trigger this workflow. Review its diff
before merging when the site should remain unchanged.

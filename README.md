# Canvas Studio

[**Open the live app →**](https://malikahed.github.io/canvas/)

A browser canvas for arranging and recording presentations. Add text, drawings, arrows, images, PDFs, video, and live screen sources; organize multiple canvases; keep private notes; and record only the presentation frame.

- Move, resize, select multiple objects, copy/paste, and undo.
- Import and scroll PDFs, with their rendering assets bundled locally.
- Record with optional microphone, webcam, and screen audio; pause and resume.
- Save/open project files and automatically save work in this browser.
- Includes three editable Arabic lesson slides.

## Run locally

Requires Node.js 22.12+ (Node.js 24 is used for deployment).

```sh
npm ci
npm run dev
```

Open the `/canvas/` URL printed by Vite. Microphone, camera, and screen sharing require browser permission; recording works best in desktop Chrome or Edge. Project data stays in your browser unless you export it.

## Save and reopen work

- **Save project** downloads `canvas-project.json`, including all canvases, their notes, imported media, and presentation settings. Treat it as a private document when sharing it.
- **Open project** restores that exported JSON. Live screen sources are deliberately excluded and must be shared again; reconnect live camera and microphone sources before recording.
- Browser autosave uses IndexedDB for the current browser profile and origin. It is not a synced backup: the live site, localhost, a different port, and another browser profile have separate storage. Export before clearing site data or moving between them.
- If the app reports that local saving or restoration failed, use **Save project** or open an existing backup. Download the finished recording separately; saving the project is not a recording export.

## Check and build

```sh
node scripts/test-selection.mjs
node scripts/test-pdf-scroll.mjs
npm run build
```

The two Node checks run without a browser or development server; they exercise extracted production handlers rather than end-to-end recording. For a production preview after building, run `npx vite preview --host 127.0.0.1` and open the printed URL under `/canvas/`.

GitHub Actions builds and publishes `dist/` to GitHub Pages. Only source, the lockfile, required lesson assets, focused checks, and deployment configuration are committed. Dependencies, build output, generated PDF assets, recordings, and recovery files are excluded. PDF support assets are copied from `pdfjs-dist` during the build.

The application source was recovered from its development history in September 2026. Bundled fonts include their license notices in `public/lessons/assets/`.

## License

Original contributions by Malik Abuallatta are licensed under the
[MIT License](LICENSE). Third-party code, adaptations, dependencies, and assets
retain their existing licenses and notices. This license does not grant new
rights to third-party material.

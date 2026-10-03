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

Open the `/canvas/` URL printed by Vite. Microphone, camera, and screen sharing require browser permission; recording works best in desktop Chrome or Edge. Project data stays in your browser unless you export it. Export important projects as a backup.

```sh
node scripts/test-selection.mjs
node scripts/test-pdf-scroll.mjs
npm run build
```

GitHub Actions builds and publishes `dist/` to GitHub Pages. Only source, the lockfile, required lesson assets, focused checks, and deployment configuration are committed. Dependencies, build output, generated PDF assets, recordings, and recovery files are excluded. PDF support assets are copied from `pdfjs-dist` during the build.

The application source was recovered from its development history in September 2026. Bundled fonts include their license notices in `public/lessons/assets/`.

## License

Original contributions by Malik Abuallatta are licensed under the
[MIT License](LICENSE). Third-party code, adaptations, dependencies, and assets
retain their existing licenses and notices. This license does not grant new
rights to third-party material.

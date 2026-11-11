# Visual map exports

The editable sources are in [docs/workspace/maps](../../docs/workspace/maps/README.md). The same folder contains an offline HTML viewer, a bookmarked PDF atlas and standalone SVG diagrams under `rendered/`.

## Regenerate

The exporter uses Node.js, a local Chromium browser, a Mermaid browser bundle and Python with `pypdf`. It does not change the application's npm dependencies.

If a local Mermaid bundle is not already available, install the export tool separately:

```powershell
npm.cmd install --prefix tmp/map-tools --no-save --package-lock=false mermaid@11.17.2
python -m pip install pypdf
node tools/docs/export-maps.mjs --mermaid tmp/map-tools/node_modules/mermaid/dist/mermaid.min.js
```

The script detects standard Edge/Chrome locations on Windows and common Chromium paths on Linux. Override them with `--browser <executable>` and `--python <executable>` as needed. Environments that cannot start Chromium's nested sandbox can pass `--no-sandbox`.

The result contains one contents page plus one vector page per diagram, with topic and diagram bookmarks. The SVGs and HTML are self-contained and work without network access. Layout-only line breaks are applied to long flowchart labels; the Mermaid source is unchanged.

Temporary pages and rendering dependencies stay under `tmp/pdfs/`. For visual QA, `--pdfjs <pdfjs-dist-package-folder>` renders every final PDF page to PNGs under `tmp/pdfs/qa/`. Inspect those images before delivering updated exports. Keep temporary tools out of commits.

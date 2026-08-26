# Map Studio

Map Studio is an interactive geographic-visualization editor and production render platform for India, USA, China, and world data stories. It combines clickable maps, district/constituency drilldowns, infographic templates, data binding, export tools, and a horizontally scalable batch-rendering pipeline.

## What it includes

- Interactive India, USA, China, and world maps with state/province, district/county/prefecture, and electoral-map modes.
- Official-source-aware India boundary handling, including Jammu & Kashmir and Ladakh presentation modes.
- A chart engine with 13 chart kinds: horizontal/vertical/ranked bars, line, area, donut, percentage bars, KPI cards, comparison table, timeline, pictogram, scatter, and bubble.
- 10 layout compositions that place the map, charts, headline, and source in one frame for canvas, social, story, presentation, and report surfaces.
- Data ingestion from CSV, TSV, XLSX, JSON, a pasted table, a public Google Sheets link, or a REST JSON URL, with column mapping, duplicate detection, missing-value policy, region-name overrides, and dataset provenance.
- Named projects in browser storage with autosave, version history, duplicate/archive/restore, brand kits, read-only share links, and owner/editor/viewer roles.
- Composition-aware export to PNG, JPG, SVG, PDF, PPTX, XLSX, and CSV at social, story, presentation, 4K, and print-A4 sizes.
- A video studio that submits mp4/webm/gif jobs to the render platform, and pixel-video sequencing in the editor.
- A production factory panel that submits sharded rendering jobs and tracks progress.
- A stateless rendering API, Redis/BullMQ work queues for batches and videos, Chromium render workers, FFmpeg encoding, S3-compatible object storage, metrics, per-key quotas, health checks, retries, cancellation, and idempotency.

## Panels

The left rail opens one panel at a time.

- **Data** — connect a dataset, map columns to region/value/year, resolve duplicates and unmatched region names, and record publisher, release date, notes, and whether the numbers are synthetic. The recorded provenance produces the attribution line on every export.
- **Charts** — pick a composition, then override the chart in any chart block (kind, sort, row limit, value labels, legend, grid, annotations). Switching a composition re-lays out the frame; it never discards the dataset.
- **Projects** — create, rename, duplicate, archive, and restore projects; save and restore versions (the newest 20 are kept); apply a brand kit; copy a read-only share link.
- **Video studio** — choose a mode (year choropleth, bar race, camera tour, counter), preset, format, duration, frame rate, intro/outro, and transition; scrub the preview locally, then submit the job to the render platform and watch frame progress.
- **Export** — export the current composition at a size preset, optionally with a transparent background, to an image, vector, document, deck, or spreadsheet.
- **Production** — submit a sharded NDJSON batch to the render platform and poll it.

## Local editor

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`.

The bundled `public/data/` files are the current map fixtures. Refresh them only when you intentionally update source data:

```bash
npm run prepare:data
```

## First run

1. Open **Data** and load a dataset — drop a CSV/TSV/XLSX/JSON file, paste a table, or paste a public Google Sheets link or REST JSON URL.
2. Confirm the suggested column mapping, choose a missing-value policy, and fix any unmatched region names from the suggested matches.
3. Fill in publisher, release date, and notes so the source line is accurate. Mark the dataset synthetic if it is.
4. Open **Charts**, pick a composition, and tune the chart in each chart block.
5. Open **Projects** to name the project, save a version, or apply a brand kit.
6. Open **Export** for a still, or **Video studio** for an animation.

Projects, brand kits, and version history live in the browser's `localStorage`. They are not synced to a server; a share link carries a read-only copy of the project encoded in the URL fragment.

## Production batch rendering and video

Copy [`.env.example`](.env.example), replace every sample credential, then start the full local production stack:

```bash
docker compose up --build
```

The web app is available at `http://127.0.0.1:4174`, the production API at `http://127.0.0.1:8787`, and MinIO's local development console at `http://127.0.0.1:9001`. The stack runs Redis, MinIO, the web app, the API, two shard workers, a Chromium renderer, and one video worker.

Open **Production** in the editor rail. A batch is submitted as a sharded NDJSON manifest—one object per `{shard}` index. Each line contains the map project to render:

```json
{"id":"india-000001","outputName":"india-000001","viewMode":"india","project":{"rows":[{"id":"delhi","region":"Delhi","value":42,"raw":{"region":"Delhi","value":42}}],"config":{"title":"Example data story"},"annotations":[]}}
```

Open **Video studio** to submit a video job. The video worker replays the composition in a headless browser, screenshots the whole frame once per video frame, and pipes the PNG sequence into FFmpeg. FFmpeg must be installed for the video worker to start; the Docker image installs it.

See [PRODUCTION.md](PRODUCTION.md) for deployment, scaling, security, quotas, and the video job API.

## Verification

```bash
npm run verify
```

This runs editor type checks and tests, render-platform tests and compilation, and the optimized web build. CI runs the same gate on every pull request.

## Repository layout

- `src/` — React/MapLibre editor.
- `src/domain/` — pure modules: chart model and layout, compositions, data ingestion, projects and sharing, export, and the video timeline.
- `public/data/` — prepared geographic fixtures and provenance.
- `services/render-platform/` — API, shard queue worker, Chromium renderer, and video worker/encoder.
- `scripts/loadtest/` — zero-dependency batch and video load-test clients.
- `docker-compose.yml` — runnable development production stack.
- `.github/workflows/ci.yml` — continuous verification.

## Important data note

Map boundaries and electoral geographies can be sensitive, disputed, or regularly revised. Use the provenance in `public/data/`, verify the appropriate jurisdictional source for each publication, and update the prepared data before claiming an output is official.

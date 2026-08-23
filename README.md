# Map Studio

Map Studio is an interactive geographic-visualization editor and production render platform for India, USA, China, and world data stories. It combines clickable maps, district/constituency drilldowns, infographic templates, data binding, export tools, and a horizontally scalable batch-rendering pipeline.

## What it includes

- Interactive India, USA, China, and world maps with state/province, district/county/prefecture, and electoral-map modes.
- Official-source-aware India boundary handling, including Jammu & Kashmir and Ladakh presentation modes.
- Infographic templates, annotations, choropleths, legends, data import, and export.
- Pixel-video sequencing in the editor.
- A production factory panel that submits sharded rendering jobs and tracks progress.
- A stateless rendering API, Redis/BullMQ work queue, Chromium render workers, S3-compatible object storage, metrics, rate limits, health checks, retries, cancellation, and idempotency.

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

## Production batch rendering

Copy [`.env.example`](.env.example), replace every sample credential, then start the full local production stack:

```bash
docker compose up --build
```

The web app is available at `http://127.0.0.1:4174`, the production API at `http://127.0.0.1:8787`, and MinIO’s local development console at `http://127.0.0.1:9001`.

Open **Production** in the editor rail. A batch is submitted as a sharded NDJSON manifest—one object per `{shard}` index. Each line contains the map project to render:

```json
{"id":"india-000001","outputName":"india-000001","viewMode":"india","project":{"rows":[{"id":"delhi","region":"Delhi","value":42,"raw":{"region":"Delhi","value":42}}],"config":{"title":"Example data story"},"annotations":[]}}
```

See [PRODUCTION.md](PRODUCTION.md) for deployment, scaling, security, and manifest details.

## Verification

```bash
npm run verify
```

This runs editor type checks and tests, render-platform tests and compilation, and the optimized web build. CI runs the same gate on every pull request.

## Repository layout

- `src/` — React/MapLibre editor.
- `public/data/` — prepared geographic fixtures and provenance.
- `services/render-platform/` — API, queue worker, and Chromium renderer.
- `docker-compose.yml` — runnable development production stack.
- `.github/workflows/ci.yml` — continuous verification.

## Important data note

Map boundaries and electoral geographies can be sensitive, disputed, or regularly revised. Use the provenance in `public/data/`, verify the appropriate jurisdictional source for each publication, and update the prepared data before claiming an output is official.

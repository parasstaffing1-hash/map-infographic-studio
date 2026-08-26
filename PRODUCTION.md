# Production operating guide

## Architecture

```text
Editor / CI clients
        |
        v
 Fastify API -- Redis status + idempotency + per-key quota
        |
        +--> BullMQ shard queue --> N stateless workers --> M isolated Chromium renderers --> S3/R2/MinIO
        |
        +--> BullMQ video queue --> N video workers (Chromium frames -> FFmpeg) --> S3/R2/MinIO
                                        |
                                        +--> map-studio-video-dead-letter
```

The API accepts a batch manifest, not millions of individual browser requests. It creates one retryable queue job per shard. Workers stream NDJSON records with bounded concurrency, submit render tasks to isolated Chromium contexts, and write deterministic image objects to S3-compatible storage. This design scales horizontally by increasing worker and renderer replicas.

## Capacity model

The request contract supports up to **10,000,000 records per batch**. A manifest can contain up to 10,000 shards; the default operational limit is 5,000 records per shard. Actual throughput depends on template complexity, data size, browser startup/cache behavior, object storage latency, and the number of worker/renderer replicas. Benchmark your real templates before publishing a throughput or SLA claim.

For a large batch:

1. Split input into evenly sized NDJSON shards named `000000.ndjson`, `000001.ndjson`, and so on.
2. Put the files behind an approved HTTPS host or object-store origin.
3. Add only that hostname to `MANIFEST_ALLOWED_HOSTS`.
4. Upload via the Production panel or `POST /v1/render-jobs`.
5. Poll `GET /v1/render-jobs/:batchId` and retrieve output objects from your storage prefix.

## API request

```json
{
  "templateId": "india-growth",
  "viewMode": "india",
  "idempotencyKey": "campaign-2026-08-23-v1",
  "manifest": {
    "urlTemplate": "https://data.example.com/campaign/{shard}.ndjson",
    "shardCount": 2000,
    "expectedRecords": 2000000
  },
  "output": {
    "format": "png",
    "width": 1920,
    "height": 1080,
    "scale": 1,
    "prefix": "campaigns/2026-08"
  }
}
```

Send a unique `idempotencyKey` for a logical batch. Replaying that request returns the original batch rather than adding duplicate queue work. `DELETE /v1/render-jobs/:batchId` cancels new work; a currently rendering image may finish before the worker observes cancellation.

## Video job API

`POST /v1/video-jobs` renders one composed infographic as an animation. The body is validated by `VideoRenderRequestSchema` in `services/render-platform/src/video-contracts.ts`; unknown properties are rejected.

```json
{
  "idempotencyKey": "delhi-growth-2026-08-v1",
  "templateId": "india-growth",
  "viewMode": "india",
  "compositionId": "map-ranked",
  "outputPrefix": "videos",
  "project": { "rows": [], "config": { "title": "Example data story" }, "annotations": [] },
  "spec": {
    "mode": "year-choropleth",
    "preset": "landscape-1080",
    "format": "mp4",
    "durationSeconds": 12,
    "fps": 30,
    "introSeconds": 1.5,
    "outroSeconds": 1.5,
    "transition": "fade",
    "showTitle": true,
    "showSource": true,
    "showLogo": false,
    "raceSize": 10,
    "loop": false
  }
}
```

- `mode`: `year-choropleth`, `bar-race`, `camera-tour`, `counter`.
- `preset`: `landscape-1080` (1920×1080), `vertical-1080` (1080×1920), `square-1080` (1080×1080), `landscape-4k` (3840×2160).
- `format`: `mp4` (libx264), `webm` (libvpx-vp9), `gif` (palettegen/paletteuse).
- `durationSeconds` 1–180, `fps` 1–60.

A 202 response returns the job status; the same shape is returned by `GET /v1/video-jobs/:jobId`:

```json
{
  "jobId": "H1s5v9RmS0kQ2xJ4bT7d",
  "status": "rendering",
  "framesRendered": 120,
  "totalFrames": 360,
  "format": "mp4",
  "createdAt": "2026-08-26T10:00:00.000Z",
  "updatedAt": "2026-08-26T10:00:31.000Z",
  "outputUri": "s3://map-studio-renders/videos/H1s5v9RmS0kQ2xJ4bT7d.mp4",
  "downloadUrl": "https://cdn.example.com/renders/videos/H1s5v9RmS0kQ2xJ4bT7d.mp4",
  "attempts": 1
}
```

`status` is one of `queued`, `rendering`, `encoding`, `complete`, `failed`, `canceled`. `outputUri` and `downloadUrl` appear only when the job completes. `downloadUrl` is `PUBLIC_DOWNLOAD_BASE_URL` joined to the object key — the API does not serve the file, so point that variable at the public base of your bucket or CDN.

Other responses:

- `400 invalid_request` — the payload failed schema validation; `issues` carries the Zod issues.
- `413 render_too_large` — `width × height × frames` exceeds `MAX_PIXEL_BUDGET` (3840 × 2160 × 1800). Reduce resolution, frame rate, or duration.
- `429 quota_exceeded` — the hourly key quota is spent; `retry-after` and `resetSeconds` give the window remainder.
- Replaying an `idempotencyKey` returns `200` with the original job instead of re-rendering.

`DELETE /v1/video-jobs/:jobId` sets a cancel flag, marks the status `canceled`, and removes the queued job. A worker polls the flag every 2 seconds, so an in-flight frame capture or encode can run briefly past the request. `409 already_complete` is returned for a finished job.

## Quotas

Quotas are per API key, fixed hourly windows in Redis (`map-studio:quota:<scope>:<digest>:<window>`). Only a non-reversible digest of the key is stored, and the counters expire on their own.

- `BATCH_JOBS_PER_KEY_PER_HOUR` (default 120) guards `POST /v1/render-jobs`.
- `VIDEO_JOBS_PER_KEY_PER_HOUR` (default 60) guards `POST /v1/video-jobs`.

Rejections increment `map_studio_quota_rejections_total{scope}`. Quotas are separate from the 120 requests/minute rate limit that applies to every route.

## Video workers and FFmpeg

The video worker (`services/render-platform/dist/video-worker.js`) requires a usable FFmpeg binary. It probes `FFMPEG_PATH` on startup and exits with an error if the probe fails, because a worker without FFmpeg can never complete a job. `services/render-platform/Dockerfile` installs `ffmpeg` and sets `FFMPEG_PATH=/usr/bin/ffmpeg`. FFmpeg is spawned with an argument list and `shell: false`, and is killed on `VIDEO_ENCODE_TIMEOUT_MS` or on cancellation.

Each job is attempted 3 times with exponential backoff starting at 5 s. After the final attempt the job is pushed to the `map-studio-video-dead-letter` queue with the original request, the error message, and a timestamp, and the status becomes `failed` with a dead-letter note. Dead-letter entries are kept, not auto-removed: inspect them, fix the cause, and replay by resubmitting the stored request with a fresh idempotency key. Alert on dead-letter depth — a growing queue usually means a missing FFmpeg, a broken template, or a renderer that cannot reach the web app.

Give video workers a large `/dev/shm` (the compose file uses `shm_size: 1gb`) and size `VIDEO_WORKER_CONCURRENCY` against CPU: each concurrent job holds a browser context at the full output resolution plus an encoder process. The BullMQ lock duration is derived from `VIDEO_ENCODE_TIMEOUT_MS`, so raising the timeout also lengthens the time a crashed worker's job stays locked.

## Metrics

The API registry (`GET /metrics`) exposes default Node metrics prefixed `map_studio_` plus:

- `map_studio_batches_submitted_total`
- `map_studio_video_jobs_submitted_total{format}`
- `map_studio_quota_rejections_total{scope}`

The video worker builds its own registry (default metrics prefixed `map_studio_video_`) with the counters below. It does not currently expose an HTTP scrape endpoint of its own, so surface these through your own exporter if you need them in Prometheus:

- `map_studio_video_jobs_total{outcome,format}`
- `map_studio_video_duration_seconds` (histogram, buckets 5–600 s)
- `map_studio_video_active_jobs`

## Deployment checklist

- Use managed Redis with persistence, private networking, TLS, and backups.
- Use S3, Cloudflare R2, or equivalent object storage. Configure lifecycle rules for outputs.
- Keep API, worker, renderer, Redis, and object storage on private network paths; expose only the web app/API through an authenticated gateway.
- Replace sample `API_KEYS` and `INTERNAL_RENDER_TOKEN` with distinct long random secrets held in a secret manager.
- Keep `MANIFEST_ALLOWED_HOSTS` to owned data origins only. This prevents server-side fetches to arbitrary addresses.
- Set `CORS_ORIGINS` to the real editor origins. Do not use `*` with authenticated API access.
- Run at least two worker replicas and multiple renderer replicas across failure domains. Autoscale on queue depth and render latency.
- Scrape `/metrics`, alert on growing queue age, worker failure rate, renderer errors, Redis memory, storage errors, and API 5xx rate.
- Run at least one video worker with FFmpeg installed if `/v1/video-jobs` is exposed, and alert on `map-studio-video-dead-letter` depth.
- Set `PUBLIC_DOWNLOAD_BASE_URL` to a base that actually serves your output objects, otherwise `downloadUrl` will not resolve.
- Set `BATCH_JOBS_PER_KEY_PER_HOUR` and `VIDEO_JOBS_PER_KEY_PER_HOUR` to what each key is entitled to; the defaults are conservative.
- Use a load test with representative templates and assets before accepting a high-volume customer batch. Published throughput figures should come from your own measurements.

## Security boundaries

The API requires a bearer key, rate-limits traffic, validates all payloads, redacts authorization logs, enforces size and shard limits, and restricts manifest hosts. The renderer requires a separate internal token. It uses a fresh browser context for every record and does not persist an editor API key. This reduces, but does not eliminate, rendering-risk exposure: run renderers in isolated containers with egress controls and regularly patch Chromium and Node.js.

## Scaling calculations

Each worker has two dials:

- `WORKER_CONCURRENCY`: simultaneous shard jobs per worker process.
- `RECORD_CONCURRENCY`: simultaneous renderer submissions inside one shard.

Start conservatively (for example, `8 × 4`) and tune using renderer CPU/RAM and p95 image time. Renderer replicas are typically CPU/memory constrained; workers are usually queue/network constrained. A queue backlog is an autoscaling signal, not an error condition.

## Load testing

`scripts/loadtest/` holds three zero-dependency Node scripts for measuring a running stack. They report what they measured and nothing more; no throughput figure in this repository is a benchmark result.

- `serve-manifest.mjs` — serves synthetic NDJSON shards that validate against `ManifestRecordSchema`, so a batch test has a manifest host to point at. Add its hostname to `MANIFEST_ALLOWED_HOSTS`.
- `submit-batches.mjs` — measures API submission throughput, latency percentiles, and 429s from the quota and rate limiter. Accepting a batch only enqueues shard jobs, so its "accepted" count is not a rendered count.
- `submit-videos.mjs` — submits video jobs and polls each to a terminal state, reporting queue wait, render time, frames/second, and end-to-end p50/p95. Timings are sampled by polling, so each boundary carries up to one poll interval of error.

Run `node scripts/loadtest/submit-videos.mjs --help` for the flags. Use an API key that is in `API_KEYS`, and raise the key's quota first if the run is larger than the hourly limit.

## Local stack

`docker compose up --build` starts Redis, MinIO, web, API, two shard workers, a renderer, and a video worker. Its default credentials are local-only convenience defaults. They are not suitable for an internet-facing deployment.

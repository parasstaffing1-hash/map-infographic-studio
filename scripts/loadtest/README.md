# Render platform load-testing tools

Three zero-dependency Node scripts (built-in `fetch` + `node:util` `parseArgs`
only) for putting measured load on the render platform in
`services/render-platform`.

| Script | Purpose |
| --- | --- |
| `serve-manifest.mjs` | Serves synthetic NDJSON shard manifests so batch jobs have a manifest host to fetch |
| `submit-batches.mjs` | Submission load test for `POST /v1/render-jobs` |
| `submit-videos.mjs` | End-to-end load test for `POST /v1/video-jobs` + status polling |

> **No numbers are baked in.** Nothing in this directory reports throughput
> figures from a run that already happened. These scripts exist so that *you*
> can measure *your* deployment. See `docs/CAPACITY.md` for the modelled
> arithmetic and its assumptions.

---

## What these scripts measure

### `submit-batches.mjs`

Measures the **API tier only**:

- total submitted / accepted (HTTP 202, plus 200 idempotent replays)
- rejected with HTTP 429, split by cause (`quota_exceeded` from
  `BATCH_JOBS_PER_KEY_PER_HOUR`, versus the Fastify rate limiter's 120 req/min)
- network and other HTTP errors, with samples
- submission throughput (req/s and accepted/s over the run's wall clock)
- submission latency p50 / p95 / p99 (plus min/max)
- number of shard jobs enqueued (`accepted x --shards`)
- optionally (`--poll`) the terminal state of each batch

### `submit-videos.mjs`

Measures the **full video path**, black-box, from a client's point of view:

- the same submission counters, plus HTTP 413 rejections from the pixel budget
- **queue wait** — submit -> first status observation that is not `queued`
- **render time** — that first non-`queued` observation -> terminal state
- **frames/sec** — the status document's `totalFrames` divided by render time
- **end-to-end** — submit -> terminal state, reported as p50 / p95 (and p99)

Each accepted job starts being polled immediately on acceptance, so a slow
submission phase does not get charged to a later job's queue wait.

### `serve-manifest.mjs`

Not a measurement tool. It emits NDJSON lines that validate against
`ManifestRecordSchema` in `services/render-platform/src/contracts.ts`, at the
URL shape the shard worker expects (`{shard}` replaced by a zero-padded 6-digit
index — see `manifestUrl()` in `src/ndjson.ts`).

---

## What these scripts do **NOT** prove

Read this section before quoting any number a run produces.

1. **`accepted` is not `rendered`.** `POST /v1/render-jobs` writes a status hash
   and bulk-enqueues `shardCount` BullMQ jobs, then returns 202. The rendering
   happens later, in the shard worker and the renderer pool. A batch submission
   run that reports thousands of req/s has measured Redis enqueue speed and
   Fastify overhead, nothing about rendering capacity.
2. **They do not measure still-render throughput at all.** There is no
   per-record timing here. If you need seconds-per-still, instrument the
   renderer or time a single known-size batch end to end and divide.
3. **Timings are polled, not instrumented.** Queue wait and render time each
   carry up to one `--poll-interval` of error at each boundary. For short video
   jobs, lower the interval — but a very low interval adds its own request load
   and can trip the 120 req/min rate limiter.
4. **The synthetic project is not your project.** `serve-manifest.mjs` emits a
   small tabular project (a dozen rows by default). Real projects with large
   row counts, many annotations, or heavier map view modes will render slower.
   Numbers from synthetic data are a floor, not a forecast.
5. **The client is a bottleneck too.** A single Node process doing thousands of
   concurrent `fetch` calls will saturate before a properly scaled API tier
   does. If latency percentiles climb with concurrency but server CPU is flat,
   suspect the load generator.
6. **One machine is not a cluster.** Running the API, worker, renderer, Redis,
   FFmpeg and this load generator on one laptop measures contention on that
   laptop.
7. **Nothing here validates output correctness.** A "complete" batch is not a
   claim that the rendered images look right.

---

## Prerequisites

- Node 20+ (built-in `fetch`, `parseArgs`, `AbortSignal.timeout`).
- A running render platform: the API, at least one shard worker, and the
  renderer (for batches) or a video worker with FFmpeg available (for videos),
  plus Redis. See `PRODUCTION.md` / `docker-compose.yml`.
- An API key that is present in the `API_KEYS` env var of the API process.

Set these once to avoid repeating flags:

```bash
export LOADTEST_API_URL=http://127.0.0.1:8787
export LOADTEST_API_KEY=your-key-here
```

---

## Running

### 1. Manifest host

The shard worker validates the manifest hostname against
`MANIFEST_ALLOWED_HOSTS` (default `127.0.0.1,localhost`). If the worker runs in
a container, the manifest host must be reachable *from that container* and its
hostname must be in that allow-list.

```bash
npm run loadtest:manifest -- --port 8899 --records-per-shard 25
```

Check it:

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/shards/000000.ndjson | head -1
```

### 2. Batch submission test

```bash
npm run loadtest:batches -- \
  --api-url "$LOADTEST_API_URL" \
  --api-key "$LOADTEST_API_KEY" \
  --count 100 \
  --concurrency 8 \
  --shards 4 \
  --records 100 \
  --manifest "http://127.0.0.1:8899/shards/{shard}.ndjson"
```

Add `--poll` to follow each accepted batch to a terminal state
(`complete` / `partial` / `failed` / `canceled`), and `--json` for machine-readable
output.

Use `--rate` to hold a steady submissions-per-second instead of firing as fast
as concurrency allows — this is the honest way to find the point where p95
latency degrades.

### 3. Video job test

```bash
npm run loadtest:videos -- \
  --api-url "$LOADTEST_API_URL" \
  --api-key "$LOADTEST_API_KEY" \
  --count 10 \
  --concurrency 2 \
  --duration 6 \
  --fps 24 \
  --preset landscape-1080 \
  --format mp4
```

`--no-poll` submits without waiting (useful purely to probe the quota).
`--poll-timeout` defaults to 10 minutes per job; raise it for long or 4K jobs.

---

## Quotas and rate limits you will hit

These are not failures of the scripts — they are the platform working.

| Limit | Where | Default | Response |
| --- | --- | --- | --- |
| `BATCH_JOBS_PER_KEY_PER_HOUR` | `src/config.ts`, fixed hourly window per API key | 120 | 429 `quota_exceeded` + `retry-after` |
| `VIDEO_JOBS_PER_KEY_PER_HOUR` | same | 60 | 429 `quota_exceeded` + `retry-after` |
| Fastify rate limit | `src/server.ts`, `@fastify/rate-limit` | 120 req / minute | 429 |
| `MAX_SHARDS_PER_BATCH` | `src/config.ts` | 10 000 | 413 `too_many_shards` |
| `MAX_PIXEL_BUDGET` | `src/video-contracts.ts` | `3840 x 2160 x 1800` | 413 `render_too_large` |
| Body limit | `src/server.ts` | 1 MiB | 413 |

Both submission scripts count 429s rather than crashing, and honour
`retry-after` **once** when the wait is short (<= 10 s). The quota is a fixed
hourly window, so a genuinely exhausted quota reports a `retry-after` of up to
3600 s; the scripts do not sleep for that — they record the rejection and move
on. To run a large test, raise the two `*_PER_KEY_PER_HOUR` env vars, or spread
load across several API keys by running the script once per key.

Each run uses a fresh random run id in its idempotency keys, so re-running does
not silently return old jobs. Cross-run replays would show up as
`idempotentReplays` in the report.

---

## Reading the results honestly

- Report the **configuration** alongside every number: count, concurrency,
  rate, shard count, video spec, and the hardware everything ran on. A
  throughput figure without those is meaningless.
- Look at **p95/p99**, not the mean. The mean hides the queue.
- A rising `errors` count with flat latency usually means the client or a
  network hop gave up, not that the server got slow.
- If `--poll` shows batches in `partial` or `failed`, check the shard worker
  logs first: the usual causes are a manifest host not in
  `MANIFEST_ALLOWED_HOSTS`, or renderer timeouts (`RENDER_TIMEOUT_MS`).
- `/metrics` on the API exposes `map_studio_batches_submitted_total`,
  `map_studio_video_jobs_submitted_total` and
  `map_studio_quota_rejections_total`. Cross-check the script's counters
  against those; a mismatch means requests are being lost before the handler.

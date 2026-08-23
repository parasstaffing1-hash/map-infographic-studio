# Production operating guide

## Architecture

```text
Editor / CI clients
        |
        v
 Fastify API -- Redis status + idempotency
        |
        v
 BullMQ shard queue --> N stateless workers --> M isolated Chromium renderers --> S3/R2/MinIO
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

## Deployment checklist

- Use managed Redis with persistence, private networking, TLS, and backups.
- Use S3, Cloudflare R2, or equivalent object storage. Configure lifecycle rules for outputs.
- Keep API, worker, renderer, Redis, and object storage on private network paths; expose only the web app/API through an authenticated gateway.
- Replace sample `API_KEYS` and `INTERNAL_RENDER_TOKEN` with distinct long random secrets held in a secret manager.
- Keep `MANIFEST_ALLOWED_HOSTS` to owned data origins only. This prevents server-side fetches to arbitrary addresses.
- Set `CORS_ORIGINS` to the real editor origins. Do not use `*` with authenticated API access.
- Run at least two worker replicas and multiple renderer replicas across failure domains. Autoscale on queue depth and render latency.
- Scrape `/metrics`, alert on growing queue age, worker failure rate, renderer errors, Redis memory, storage errors, and API 5xx rate.
- Use a load test with representative templates and assets before accepting a high-volume customer batch.

## Security boundaries

The API requires a bearer key, rate-limits traffic, validates all payloads, redacts authorization logs, enforces size and shard limits, and restricts manifest hosts. The renderer requires a separate internal token. It uses a fresh browser context for every record and does not persist an editor API key. This reduces, but does not eliminate, rendering-risk exposure: run renderers in isolated containers with egress controls and regularly patch Chromium and Node.js.

## Scaling calculations

Each worker has two dials:

- `WORKER_CONCURRENCY`: simultaneous shard jobs per worker process.
- `RECORD_CONCURRENCY`: simultaneous renderer submissions inside one shard.

Start conservatively (for example, `8 × 4`) and tune using renderer CPU/RAM and p95 image time. Renderer replicas are typically CPU/memory constrained; workers are usually queue/network constrained. A queue backlog is an autoscaling signal, not an error condition.

## Local stack

`docker compose up --build` starts Redis, MinIO, web, API, two workers, and a renderer. Its default credentials are local-only convenience defaults. They are not suitable for an internet-facing deployment.

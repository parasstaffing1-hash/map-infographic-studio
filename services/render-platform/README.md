# Map Studio render platform

This workspace contains three deployable processes:

- `server.ts` — authenticated batch API, queue submission, health, readiness, and Prometheus metrics.
- `shard-worker.ts` — streaming NDJSON worker with retry, cancellation, idempotent status counters, and bounded record concurrency.
- `renderer.ts` — authenticated isolated Chromium screenshot service that stores PNG/JPEG outputs in S3-compatible storage or a safe local directory.

Use the root project scripts:

```bash
npm run production:api
npm run production:worker
npm run production:renderer
```

Production configuration and manifest semantics are documented in [PRODUCTION.md](../../PRODUCTION.md).

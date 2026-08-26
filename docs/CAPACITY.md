# Capacity planning — Map Studio render platform

> ## ⚠️ Read this first: these are modelled estimates, not measurements
>
> **No large-scale load test has ever been executed in this repository.** Every
> number below that is not a code constant is an **assumption** — a plausible
> starting figure, clearly labelled, that has *not* been measured on real
> hardware with real projects.
>
> This document gives you the **arithmetic**, not the answers. The load-testing
> scripts in [`scripts/loadtest/`](../scripts/loadtest/README.md) exist so that
> an operator can measure their own values for the assumption table and
> re-run the model with real inputs.
>
> Do not quote any figure from this document as a benchmark, in a proposal, or
> to a customer. Replace the assumptions with measurements first.

---

## 1. The scaling model

The platform separates *accepting* work from *doing* work. That is the single
most important fact for capacity planning: the API can accept far more work
than the render fleet can perform, and it will happily do so.

```
                    ┌──────────────────────────┐
   client  ────────▶│  API (Fastify)           │  stateless, horizontally
                    │  POST /v1/render-jobs    │  scalable behind a LB
                    │  POST /v1/video-jobs     │
                    └────────────┬─────────────┘
                                 │ enqueue + status hash
                                 ▼
                    ┌──────────────────────────┐
                    │  Redis (BullMQ)          │  ◀── single shared dependency,
                    │  shard queue + video     │      state of record for status
                    │  queue + quota counters  │
                    └───────┬──────────┬───────┘
                            │          │
            ┌───────────────▼───┐  ┌───▼─────────────────┐
            │ Shard workers     │  │ Video workers       │
            │ WORKER_CONCURRENCY│  │ VIDEO_WORKER_       │
            │ shards in flight, │  │ CONCURRENCY jobs,   │
            │ RECORD_CONCURRENCY│  │ Chromium capture +  │
            │ records per shard │  │ FFmpeg encode       │
            └───────┬───────────┘  └─────────────────────┘
                    │ HTTP POST /v1/render
                    ▼
            ┌───────────────────┐
            │ Renderer pool     │  Chromium contexts; the real
            │ (Playwright)      │  constraint on still throughput
            └───────────────────┘
```

**Layer by layer:**

| Layer | Scaling property | Bounded by |
| --- | --- | --- |
| API | Stateless. Add instances behind a load balancer; nothing is held in process except metrics counters and the rate-limit window. | Request rate, Redis round-trips per request, 1 MiB body limit |
| Redis | Not horizontally scaled in this design. Single instance holds both queues, all batch/video status hashes, idempotency keys and quota counters. | Single-node throughput and memory; **this is the shared fate point** |
| Shard workers | Horizontally scalable — add processes, BullMQ distributes shards. Each process runs `WORKER_CONCURRENCY` shards, each shard fans out `RECORD_CONCURRENCY` concurrent record renders. | Fan-out demand it places on the renderer pool |
| Renderer pool | Horizontally scalable behind `RENDERER_URL`. Each browser context is one still render at a time. | Chromium CPU + RAM per context |
| Video workers | Horizontally scalable, but **each job is a Chromium frame-capture loop followed by an FFmpeg encode**, both CPU-heavy. `VIDEO_WORKER_CONCURRENCY` defaults to 2 for that reason. | FFmpeg/Chromium CPU; effectively vCPU-bound |

Two consequences worth internalising:

1. **A 202 from `POST /v1/render-jobs` means "enqueued", not "rendered."** The
   handler writes one status hash and bulk-adds `shardCount` jobs. Submission
   throughput and render throughput are unrelated quantities.
2. **Shard workers are demand generators, not capacity.** One shard worker
   process with default settings can drive up to
   `WORKER_CONCURRENCY x RECORD_CONCURRENCY` = 8 x 4 = **32 concurrent HTTP
   calls into the renderer pool**. If the pool cannot serve 32 concurrent
   renders, you get renderer queueing and eventually `RENDER_TIMEOUT_MS`
   failures — adding *more* shard workers makes this worse, not better.

---

## 2. Assumptions (replace these with your own measurements)

Everything in this table is **unmeasured**. The "how to measure" column tells
you how to replace it.

| ID | Assumption | Assumed value | How to measure it yourself |
| --- | --- | --- | --- |
| **A1** | Wall-clock seconds for one still render (1920x1080 PNG, ~12-row project, `india` view) | **3.0 s** | Submit one batch of known record count with a warm renderer and time it end to end; divide by records and by effective concurrency. Or instrument `renderRecord()`. |
| **A2** | Concurrent Chromium contexts one renderer instance sustains without thrashing | **4** | Raise concurrency until p95 render latency inflects; that is the ceiling. |
| **A3** | Peak-hour multiplier over the flat monthly average | **3.0x** | From your own access logs: busiest hour ÷ (monthly total ÷ 720). |
| **A4** | Target steady-state utilisation of the render fleet (headroom for bursts, retries, deploys) | **0.60** | A policy choice, not a measurement. Lower it if your peak factor is uncertain. |
| **A5** | Wall-clock seconds to capture one video frame at 1080p | **0.35 s** | Run `submit-videos.mjs` with one job and read `frames/sec`; invert it. |
| **A6** | 4K per-frame cost relative to 1080p | **4.0x** (pixel-proportional) | Run the same job at `--preset landscape-4k` and compare. |
| **A7** | FFmpeg encode seconds per second of output video (mp4) | **0.5 s** | Time the `encoding` phase in the job status; or run `ffmpeg` on a captured frame directory. |
| **A8** | vCPU consumed per concurrent video slot (Chromium capture + FFmpeg) | **2.0** | Watch host CPU while `VIDEO_WORKER_CONCURRENCY` slots are saturated. |
| **A9** | Hours in a planning month | **720** (30 x 24) | Fixed convention. |

Code constants (**not** assumptions — these are read from
`services/render-platform/src/config.ts` and `video-contracts.ts`):

| Constant | Default |
| --- | --- |
| `WORKER_CONCURRENCY` | 8 |
| `RECORD_CONCURRENCY` | 4 |
| `VIDEO_WORKER_CONCURRENCY` | 2 |
| `RENDER_TIMEOUT_MS` | 45 000 |
| `VIDEO_ENCODE_TIMEOUT_MS` | 600 000 |
| `MAX_SHARDS_PER_BATCH` | 10 000 |
| `MAX_RECORDS_PER_SHARD` | 5 000 |
| `BATCH_JOBS_PER_KEY_PER_HOUR` | 120 |
| `VIDEO_JOBS_PER_KEY_PER_HOUR` | 60 |
| `MAX_PIXEL_BUDGET` | 3840 x 2160 x 1800 = 14 929 920 000 px |
| API rate limit | 120 req / minute |
| API body limit | 1 MiB |

---

## 3. Sizing the still-render fleet

### The formula

```
  flat_hourly_stills   = M_stills_per_month / H            (H = A9 = 720)
  peak_hourly_stills   = flat_hourly_stills x P            (P = A3 = 3.0)

                         peak_hourly_stills x S_still
  render_slots (N)     = ─────────────────────────────     (S_still = A1, U = A4)
                                  3600 x U

  renderer_instances   = ceil( N / C_contexts )            (C_contexts = A2)

  shard_workers (W)    = ceil( N / (WORKER_CONCURRENCY x RECORD_CONCURRENCY) )
```

### Worked example: 1 000 000 stills per month

```
  flat_hourly   = 1 000 000 / 720                 = 1 388.9 stills/hour
  peak_hourly   = 1 388.9 x 3.0                   = 4 166.7 stills/hour

  N             = (4 166.7 x 3.0) / (3600 x 0.60)
                = 12 500.0 / 2 160
                = 5.79                            -> 6 render slots

  renderers     = ceil(5.79 / 4)                  = 2 renderer instances
  shard_workers = ceil(5.79 / (8 x 4)) = ceil(0.18) = 1 shard worker process
```

**Interpretation:** under these assumptions a million stills a month is a
*small* amount of compute — roughly 833 CPU-hours spread over a 720-hour month.
The fleet is sized by the **peak hour**, not the monthly total. That is why A3
(peak factor) matters more than the headline volume: if your traffic is
genuinely bursty at 10x rather than 3x, N becomes 19.3 and you need 5 renderer
instances for the same monthly volume.

**The shard-worker result deserves a warning.** The formula says one worker
process suffices, but one process with default settings will drive up to 32
concurrent renders against a pool sized for ~8. Either:

- lower `RECORD_CONCURRENCY` / `WORKER_CONCURRENCY` so that
  `W x WORKER_CONCURRENCY x RECORD_CONCURRENCY ≈ N`, or
- accept renderer-side queueing and make sure `RENDER_TIMEOUT_MS` is generous
  enough to absorb it.

Keeping worker fan-out roughly equal to renderer capacity is the single most
useful tuning rule in this system.

### Sensitivity

Because N is linear in `S_still` (A1), a measurement showing stills actually
take 9 s rather than 3 s triples the fleet. **Measure A1 before buying
anything.**

| S_still (A1) | N at 1M/month | Renderer instances |
| --- | --- | --- |
| 1.0 s | 1.93 | 1 |
| 3.0 s | 5.79 | 2 |
| 9.0 s | 17.36 | 5 |
| 20.0 s | 38.58 | 10 |

---

## 4. Sizing the video fleet

### The formula

```
  frames_per_job    = round(duration_seconds x fps)          (min 1)
  capture_seconds   = frames_per_job x S_frame x R_preset    (S_frame = A5, R_preset = A6)
  encode_seconds    = duration_seconds x E_encode            (E_encode = A7)
  job_seconds       = capture_seconds + encode_seconds

  worker_seconds    = V_videos_per_month x job_seconds
  flat_concurrency  = worker_seconds / (H x 3600)            (H = A9)
  peak_concurrency  = flat_concurrency x P                   (P = A3)

  video_slots (S)   = peak_concurrency / U                   (U = A4)
  video_hosts       = ceil( S / VIDEO_WORKER_CONCURRENCY )
  vCPU_per_host     = VIDEO_WORKER_CONCURRENCY x A8
```

### Worked example: 10 000 videos per month, 12 s @ 30 fps, 1080p mp4

```
  frames_per_job   = round(12 x 30)               = 360 frames
  capture_seconds  = 360 x 0.35 x 1.0             = 126.0 s
  encode_seconds   = 12 x 0.5                     = 6.0 s
  job_seconds                                     = 132.0 s   (~2.2 min)

  worker_seconds   = 10 000 x 132.0               = 1 320 000 s
                                                  = 366.7 worker-hours
  flat_concurrency = 366.7 / 720                  = 0.509
  peak_concurrency = 0.509 x 3.0                  = 1.528

  S                = 1.528 / 0.60                 = 2.55      -> 3 video slots
  video_hosts      = ceil(3 / 2)                  = 2 hosts
  vCPU_per_host    = 2 x 2.0                      = 4 vCPU per host
```

So: **2 video worker hosts at 4 vCPU each**, under these assumptions.

### The same volume in 4K

Substituting `R_preset` = A6 = 4.0:

```
  capture_seconds  = 360 x 0.35 x 4.0             = 504.0 s
  job_seconds      = 504.0 + 6.0                  = 510.0 s   (8.5 min)
  worker_seconds   = 10 000 x 510                 = 5 100 000 s = 1 416.7 h
  flat_concurrency = 1 416.7 / 720                = 1.968
  S                = (1.968 x 3.0) / 0.60         = 9.84      -> 10 video slots
  video_hosts      = ceil(10 / 2)                 = 5 hosts (20 vCPU total)
```

**Roughly 4x the fleet for the same job count.** 4K is the most expensive
decision in the product. Consider a separate queue or a stricter quota for it.

### What the pixel budget already forbids

`MAX_PIXEL_BUDGET` = 3840 x 2160 x 1800 caps *frames*, not duration, at 4K:
1800 frames = 60 s @ 30 fps or 30 s @ 60 fps. At 1080p the same budget allows
7200 frames (240 s), but `VideoSpecSchema` caps `durationSeconds` at 180 and
`fps` at 60 independently. So the worst single job the API will accept is
bounded, and that bound — combined with A5 — gives you the worst-case
occupancy of one video slot. Under A5/A6 a maximal 4K job is
`1800 x 0.35 x 4.0 ≈ 2520 s = 42 min` of one slot, which is why
`VIDEO_ENCODE_TIMEOUT_MS` (10 min default, encode phase only) and the BullMQ
lock duration deserve a look before you allow 4K broadly.

---

## 5. Sizing the API tier and Redis

The API tier is sized by **request rate**, not render work, and is the easy
part: it is stateless, so add instances. The things to watch:

- **Redis round-trips per submission.** A batch submission performs roughly:
  quota `INCR` + `EXPIRE` + `TTL`, an idempotency `GET`, a status `HSET`, an
  idempotency `SET NX`, then `addBulk` of `shardCount` jobs. A 10 000-shard
  batch is one HTTP request but ten thousand queue entries.
- **The rate limiter's store.** `@fastify/rate-limit` is registered without an
  explicit store in `src/server.ts`, so the 120 req/min window is **per API
  instance**, not global. Scaling the API tier multiplies the effective rate
  limit. If a global limit matters to you, give the plugin a Redis store.
- **The quota, by contrast, is global** — it lives in Redis
  (`src/quota.ts`, fixed hourly window keyed by a digest of the API key), so
  it does not multiply with instance count.

**Redis load from the workers is the part people underestimate.** In
`shard-worker.ts`, each record render performs a `readStatus` (an `HGETALL`) to
check for cancellation, plus an `SADD` for output dedupe and an `HINCRBY` on
the status hash. That is on the order of 3-4 Redis operations *per rendered
record*, not per shard. At the 1M stills/month peak (4 167 stills/hour ≈ 1.16/s)
this is trivial; at 100x that volume it is worth re-checking, and the dedupe
sets (`map-studio:batch:<id>:outputs:complete`) grow one member per output and
live until `STATUS_TTL_SECONDS` (30 days by default) expires the batch.

---

## 6. Known bottlenecks

Ordered by how likely they are to bite first.

1. **Renderer pool CPU (stills).** The hard limit on still throughput. Symptom:
   rising render latency, then `RENDER_TIMEOUT_MS` failures surfacing as
   `failedOutputs`, then batches finishing `partial`.
2. **Shard-worker fan-out overwhelming the renderer pool.** Default fan-out per
   worker process is 32 concurrent renders. Adding worker processes to "go
   faster" amplifies the overload. Fix by tuning concurrency down, not up.
3. **FFmpeg + Chromium CPU (video).** Video work is genuinely CPU-bound and
   does not benefit from more concurrency on a fixed core count — oversubscribing
   `VIDEO_WORKER_CONCURRENCY` past `vCPU / A8` makes every job slower and risks
   `VIDEO_ENCODE_TIMEOUT_MS`.
4. **Video worker memory.** Frames are captured before encoding. A 1080p frame
   buffer times 1800 frames is substantial; this is the reason `MAX_PIXEL_BUDGET`
   exists. Watch RSS on video hosts before raising it.
5. **Redis as shared fate.** Queues, status, idempotency and quotas all live in
   one instance. If it is unavailable, `/ready` fails, submissions fail, and
   in-flight status updates are lost. It is also the memory-growth surface
   (dedupe sets, status hashes, `STATUS_TTL_SECONDS`).
6. **Manifest host throughput and the allow-list.** Every shard fetches its
   manifest over HTTP within `RENDER_TIMEOUT_MS`. A slow manifest host stalls
   shards while holding a worker slot; a host missing from
   `MANIFEST_ALLOWED_HOSTS` fails the shard outright.
7. **The 1 MiB body limit for video jobs.** A video request embeds the whole
   project. Large projects (`StoredProjectSchema` permits up to 100 000 rows)
   will be rejected with 413 long before they are a compute problem.
8. **Per-instance rate limiting.** See section 5 — an apparent capacity increase
   from scaling the API tier is partly just a looser rate limit.

---

## 7. The knobs

| Knob | Default | Raise it when | Lower it when |
| --- | --- | --- | --- |
| `WORKER_CONCURRENCY` | 8 | Shards sit queued while the renderer pool is idle | Renderer p95 latency is climbing or renders are timing out |
| `RECORD_CONCURRENCY` | 4 | Individual shards are slow but renderers are underused | The renderer pool is saturated; this is the finer-grained of the two fan-out knobs |
| `VIDEO_WORKER_CONCURRENCY` | 2 | Host CPU is idle while video jobs queue (rare — video is CPU-bound) | Jobs are slowing each other down, or hitting the encode timeout. Keep `<= vCPU / A8` |
| `RENDER_TIMEOUT_MS` | 45 000 | Legitimately heavy projects are being killed mid-render; also raise if you deliberately run the renderer hot | You want fast failure over long stalls. Note the worker lock is `max(4 x this, 120 s)` |
| `VIDEO_ENCODE_TIMEOUT_MS` | 600 000 | Long or 4K jobs are being killed during encode | You want stuck FFmpeg processes reaped sooner |
| `BATCH_JOBS_PER_KEY_PER_HOUR` | 120 | A legitimate tenant is being throttled; also raise temporarily to run a load test | You need to protect the fleet from one key |
| `VIDEO_JOBS_PER_KEY_PER_HOUR` | 60 | Same | Same — video is far more expensive per job, so keep this well below the batch quota |
| `MAX_SHARDS_PER_BATCH` | 10 000 | Genuinely enormous batches are needed | You want to bound the size of a single `addBulk` against Redis |
| `MAX_RECORDS_PER_SHARD` | 5 000 | Manifests legitimately carry more per shard | Shards are running long enough to risk lock expiry |
| `MAX_PIXEL_BUDGET` | 14.93 Gpx | Never, without measuring video worker RSS first | You are seeing video worker OOMs |
| `STATUS_TTL_SECONDS` | 2 592 000 (30 d) | You need longer status retention | Redis memory is the constraint |

---

## 8. How to replace this model with measurements

1. Start the platform (`docker-compose.yml` / `PRODUCTION.md`) on hardware that
   resembles production. One box running everything measures contention on one
   box, not capacity.
2. Start the synthetic manifest host: `npm run loadtest:manifest`.
3. Raise `BATCH_JOBS_PER_KEY_PER_HOUR` / `VIDEO_JOBS_PER_KEY_PER_HOUR` for the
   duration of the test, or spread load across several API keys — otherwise you
   will measure the quota rather than the fleet.
4. **Measure A1**: run `npm run loadtest:batches -- --count 1 --shards 1 --poll`
   with a known `--records-per-shard` on the manifest host, and divide the
   batch's wall-clock time by the record count and the effective concurrency.
5. **Measure A5 and A7**: run `npm run loadtest:videos -- --count 1` and read
   the reported `frames/sec` and the render-vs-encode split.
6. **Measure A2 and A8**: raise concurrency stepwise while watching host CPU
   and p95 latency; the inflection point is the real value.
7. **Measure A3**: read it off your own production access logs. Do not guess it.
8. Re-run sections 3 and 4 with your values, and record the date, the hardware,
   and the exact flags next to the result.

Until steps 4-7 have actually been run, every number in this document is a
model output, not a fact.

---

## References

- Load-test tooling and its caveats: [`scripts/loadtest/README.md`](../scripts/loadtest/README.md)
- Config surface: `services/render-platform/src/config.ts`
- API contracts and quotas: `services/render-platform/src/server.ts`, `src/quota.ts`
- Video pixel budget: `services/render-platform/src/video-contracts.ts`
- Worker fan-out logic: `services/render-platform/src/shard-worker.ts`, `src/video-worker.ts`

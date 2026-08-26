# Architecture

## Current vertical slice

The current app keeps the deterministic core independent of the renderer:

```text
command bar
  -> parser.ts
  -> MapRequestSchema
  -> place resolver / source catalog
  -> local GeoJSON fixture
  -> MapLibre GL renderer
  -> selection + editor state
  -> saved-view shell
```

The renderer now has three reusable geographic scopes: `world` country context, India/Uttarakhand boundary layers, and `place` mode for a resolved city/town marker. Country and place requests are typed before rendering; arbitrary place names use the configured open geocoder adapter when they are not in the local catalog.

`src/domain/` contains typed request, parser, resolver, source, and entity adapters. `src/components/MapCanvas.tsx` is the renderer boundary. `src/store/useMapStudio.ts` owns editable project state and command history. Canonical geometry is never mutated by style changes.

## Domain modules

`src/domain/` holds the deterministic core. Every module below is pure enough to test without a browser render, and the React components are thin surfaces over them.

- `charts.ts` — `buildChartModel(spec, rows, config, activeYear)` turns rows into a normalized series model; `layoutChart(model, spec, config, width, height)` turns that model into marks and hotspots in a fixed coordinate box. Neither function touches the DOM. `ChartSurface.tsx` renders the layout as SVG and adds tooltips, arrow-key navigation, and aria labels.
- `composition.ts` — a composition is a named set of blocks (`map`, `chart`, `headline`, `source`, `note`, `kpi`) positioned in percentage space with a surface (`canvas`, `social`, `story`, `presentation`, `report`). `blockRect` resolves a block to pixels for any output size. A composition describes layout only; it never owns data, so switching compositions re-lays out the same dataset. `CompositionCanvas.tsx` renders the blocks.
- `dataSources.ts` — ingestion and cleaning: delimited/JSON/XLSX parsing, Google Sheets link to CSV export URL, guarded remote fetch, column mapping suggestion, missing-value policy, duplicate detection, region-name overrides with fuzzy suggestions, and dataset provenance that produces the attribution line.
- `projects.ts` / `store/useStudioProject.ts` — named projects, autosave, capped version history, duplicate/archive/restore, brand kits, base64url share payloads read from `?view=shared#d=…`, and role capabilities. Persistence is `localStorage`; there is no project server.
- `exportComposition.ts`, `chartSvg.ts`, `officeExport.ts` — composition-aware export. The composition is redrawn at the target size rather than screenshotted, and the OOXML writers produce real PPTX and XLSX packages.
- `videoTimeline.ts` — a pure frame model. `frameState(spec, frame, rows, config, years)` maps a frame index to what should be on screen: intro/outro, transition progress, interpolated year, and bar-race ordering. The same function drives the in-editor preview and the server render, so a preview and a rendered video agree by construction.

## Browser/renderer frame bridge

Server-side video rendering reuses the editor instead of reimplementing it.

```text
video worker
  -> playwright page at WEB_APP_URL?render=1&mode=video&viewMode=…&composition=…
  -> app writes project + spec into localStorage before load
  -> app exposes window.__mapStudioVideo
  -> worker sets each frame, waits for settled, screenshots .map-frame
  -> PNG sequence -> FFmpeg -> object storage
```

The bridge type lives in `services/render-platform/src/video-renderer.ts` so both sides share one definition:

- `ready: boolean` — the app has mounted in render mode and is safe to drive. The worker waits for this before the first frame.
- `totalFrames: number` — the frame count the app derived from the spec.
- `setFrame(frame: number): void` — request frame `frame`; the app clears `settled` and applies the frame state.
- `settled: boolean` — the requested frame is fully painted. The worker waits for it before every screenshot.

Two rules keep this contract honest. The screenshot targets `.map-frame`, which is the whole composition — map, charts, headline, legend, and source — not the MapLibre canvas, so server output matches what the editor shows. And the app must set `settled` only after the frame is actually painted; the worker has no other way to know, and screenshotting early produces a torn frame rather than an error.

## Production target

```text
Next.js / React editor
  -> FastAPI REST API
  -> MapRequest / resolver services
  -> PostGIS entity graph + boundary versions
  -> object storage / PMTiles / vector tile service
  -> MapLibre + deck.gl + D3 export renderer
```

The renderer should consume layer contracts rather than political-specific assumptions. Political results are a domain module that binds stable constituency IDs and election periods to generic geographic layers.

## Important boundaries

- Natural-language input creates typed requests only; it never becomes SQL or geometry.
- Sources, boundary versions, and processing history are first-class records.
- User styling, annotations, label offsets, filters, and selections live in a map project, never in canonical geography.
- The browser receives the smallest useful dataset for the current view. National-scale layers move to vector tiles/PMTiles.
- Missing political or demographic data renders as unavailable, not as synthetic values.
- Layout, data, and animation are separate concerns: a composition holds no rows, a dataset holds no styling, and the video spec holds no geometry.
- The video frame model is deterministic. The same spec and rows produce the same frame in the editor preview and on the render worker.
- World coverage is provider-backed and resolution-aware: the bundled country fixture is low-resolution context, while small-place coordinates come from the geocoder and should be promoted to versioned authoritative boundaries before analytical publication.

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
- World coverage is provider-backed and resolution-aware: the bundled country fixture is low-resolution context, while small-place coordinates come from the geocoder and should be promoted to versioned authoritative boundaries before analytical publication.
